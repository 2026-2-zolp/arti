"""Accumulate model counters for one ARTI request without retaining provider content."""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from decimal import Decimal
import re


@dataclass
class UsageCounts:
    attempts: int = 0
    measured: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_measured: int = 0
    cached_input_tokens: int = 0
    priced: int = 0
    estimated_cost_usd: Decimal = Decimal('0')


@dataclass
class VoiceUsage:
    intent: str
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_input_tokens: int | None = None
    output_audio_tokens: int | None = None
    estimated_cost_usd: Decimal | None = None


@dataclass
class RequestModelUsage(UsageCounts):
    by_task_model: dict[tuple[str, str], UsageCounts] = field(default_factory=dict)
    voice: VoiceUsage | None = None


current_usage = ContextVar('request_model_usage', default=None)


@contextmanager
def collect_model_usage():
    usage = RequestModelUsage()
    token = current_usage.set(usage)
    try:
        yield usage
    finally:
        current_usage.reset(token)


def record_text_attempt(task, model):
    usage = current_usage.get()
    if usage is None:
        return ()
    # Use the configured identifier. Provider-supplied names may contain arbitrary text.
    label = model if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_./:@-]{0,199}', model) else ''
    key = (task, label)
    if key not in usage.by_task_model:
        usage.by_task_model[key] = UsageCounts()
    group = usage.by_task_model[key]
    usage.attempts += 1
    group.attempts += 1
    return usage, group


def estimate_standard_luna_text(response, input_tokens, output_tokens, cached, details):
    writes = details.get('cache_write_tokens') if isinstance(details, dict) else None
    if (response.get('service_tier') not in (None, 'default') or input_tokens > 272_000
            or type(cached) is not int or type(writes) is not int or cached < 0 or writes < 0
            or cached + writes > input_tokens):
        return None
    lifetimes = details.get('cache_write_tokens_details')
    if lifetimes is not None and (
            not isinstance(lifetimes, dict) or lifetimes.get('ttl_30m_tokens') != writes
            or lifetimes.get('ttl_12h_tokens', 0) != 0):
        return None
    # USD per million tokens, Standard, with default 30-minute cache writes.
    rates = (Decimal('0.10'), Decimal('0.01'), Decimal('0.125'), Decimal('0.50'))
    billed = (input_tokens - cached - writes, cached, writes, output_tokens)
    return sum(tokens * rate for tokens, rate in zip(billed, rates)) / 1_000_000


def record_text_tokens(counters, response, *, standard_luna_text=False):
    if not counters or not isinstance(response, dict):
        return
    counts = response.get('usage')
    if not isinstance(counts, dict):
        return
    input_tokens, output_tokens = counts.get('prompt_tokens'), counts.get('completion_tokens')
    if not all(type(count) is int and 0 <= count <= 2**31 - 1 for count in (input_tokens, output_tokens)):
        return
    details = counts.get('prompt_tokens_details')
    cached = details.get('cached_tokens') if isinstance(details, dict) else None
    cost = estimate_standard_luna_text(response, input_tokens, output_tokens, cached, details) if standard_luna_text else None
    for usage in counters:
        usage.measured += 1
        usage.input_tokens += input_tokens
        usage.output_tokens += output_tokens
        if type(cached) is int and 0 <= cached <= input_tokens:
            usage.cache_measured += 1
            usage.cached_input_tokens += cached
        if cost is not None:
            usage.priced += 1
            usage.estimated_cost_usd += cost


# USD per million tokens, verified 2026-11-21 on the OpenAI model page.
# Stored estimates use the rate at measurement time. The provider bill can differ.
REALTIME_PRICE = {
    'gpt-realtime-2.1-mini': {
        'input': (Decimal('0.60'), Decimal('10.00'), Decimal('0.80')),
        'cached': (Decimal('0.06'), Decimal('0.30'), Decimal('0.08')),
        'output': (Decimal('2.40'), Decimal('20.00')),
    },
}


def record_voice_attempt(intent, model):
    usage = current_usage.get()
    if usage is not None:
        usage.voice = VoiceUsage(intent, model)
        return usage.voice


def record_voice_tokens(usage, tokens):
    if usage is None:
        return
    inputs = tuple(tokens.get(key) for key in ('inputText', 'inputAudio', 'inputImage'))
    outputs = tuple(tokens.get(key) for key in ('outputText', 'outputAudio'))
    cached_total = tokens.get('cachedInput')
    cached = tuple(tokens.get(key, 0) for key in ('cachedText', 'cachedAudio', 'cachedImage'))
    if None not in inputs:
        usage.input_tokens = sum(inputs)
        if cached_total is not None and cached_total <= usage.input_tokens:
            usage.cached_input_tokens = cached_total
    if None not in outputs:
        usage.output_tokens = sum(outputs)
    usage.output_audio_tokens = outputs[1]

    price = REALTIME_PRICE.get(usage.model)
    if (price is None or usage.input_tokens is None or usage.output_tokens is None
            or usage.cached_input_tokens != sum(cached) or any(used > total for used, total in zip(cached, inputs))):
        return
    input_cost = sum((total - reused) * rate for total, reused, rate in zip(inputs, cached, price['input']))
    cached_cost = sum(reused * rate for reused, rate in zip(cached, price['cached']))
    output_cost = sum(total * rate for total, rate in zip(outputs, price['output']))
    usage.estimated_cost_usd = (input_cost + cached_cost + output_cost) / 1_000_000
