"""Accumulate text-model counters for one ARTI request without retaining provider content."""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass


@dataclass
class TextModelUsage:
    attempts: int = 0
    measured: int = 0
    input_tokens: int = 0
    output_tokens: int = 0


current_usage = ContextVar('text_model_usage', default=None)


@contextmanager
def collect_text_usage():
    usage = TextModelUsage()
    token = current_usage.set(usage)
    try:
        yield usage
    finally:
        current_usage.reset(token)


def record_text_attempt():
    usage = current_usage.get()
    if usage is not None:
        usage.attempts += 1


def record_text_tokens(response):
    usage = current_usage.get()
    if usage is None or not isinstance(response, dict):
        return
    counts = response.get('usage')
    if not isinstance(counts, dict):
        return
    input_tokens, output_tokens = counts.get('prompt_tokens'), counts.get('completion_tokens')
    if not all(type(count) is int and 0 <= count <= 2**31 - 1 for count in (input_tokens, output_tokens)):
        return
    usage.measured += 1
    usage.input_tokens += input_tokens
    usage.output_tokens += output_tokens
