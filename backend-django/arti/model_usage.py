"""Accumulate text-model counters for one ARTI request without retaining provider content."""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
import re


@dataclass
class UsageCounts:
    attempts: int = 0
    measured: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_measured: int = 0
    cached_input_tokens: int = 0


@dataclass
class TextModelUsage(UsageCounts):
    by_task_model: dict[tuple[str, str], UsageCounts] = field(default_factory=dict)


current_usage = ContextVar('text_model_usage', default=None)


@contextmanager
def collect_text_usage():
    usage = TextModelUsage()
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


def record_text_tokens(counters, response):
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
    for usage in counters:
        usage.measured += 1
        usage.input_tokens += input_tokens
        usage.output_tokens += output_tokens
        if type(cached) is int and 0 <= cached <= input_tokens:
            usage.cache_measured += 1
            usage.cached_input_tokens += cached
