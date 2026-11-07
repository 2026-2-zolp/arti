"""
초보자용 글쓰기 — 해설 요약 + 초보자 가이드(쉬운 설명 · 관찰 질문 · 힌트)

모델: 카카오 Kanana 1.5 2.1B instruct (Apache 2.0, 한국어 대화형 모델, CPU에서 작품 1개에 30~40초)
- 작은 대화형 모델 4종(KoBART · Kanana · Qwen3 4B · EXAONE 4.0 1.2B)을 같은 해설 5개로 비교해 골랐다:
  한국어 해요체가 가장 자연스럽고, 형식(요약 + 질문 3개)을 지키며, 지어낸 연도·숫자가 없었다.
- 관리자가 「AI 분석」을 누를 때 한 번 만들고(「AI 제안」), 관리자가 확인·확정해야 사용자 화면에 보인다.

안전장치 (작은 모델은 가끔 원문에 없는 내용을 쓴다)
1) 원문에 없는 3~4자리 숫자(연도 등)가 들어간 문장·질문은 버린다
2) 정해진 형식으로 답하지 않으면 실패로 보고 None (백엔드가 원문 앞 문장으로 대체)
"""
from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Protocol

from . import config

log = logging.getLogger("arti.ai")

SYSTEM = (
    "당신은 미술관에서 미술 초보자와 함께 그림을 보는 도슨트입니다. "
    "반드시 <해설> 안에 있는 사실만 쓰고, 해설에 없는 연도·이름·장소·일화는 절대 지어내지 마세요. "
    "어려운 미술 용어는 쉬운 말로 풀고, 해요체로 쓰세요."
)

TASK = """아래 형식 그대로, 다른 말 없이 답하세요.
요약: (해설의 핵심을 3~4문장으로. 무엇을 그렸는지, 색·붓질 같은 표현의 특징, 작가나 시대 이야기를 해설에 있는 만큼 담기)
키워드: (해설에 나오는 짧은 명사 3개, 쉼표로 구분)
쉬운 설명: (그림을 보기 전에 읽을 쉬운 설명 2문장)
관찰 질문:
1. (그림에서 색·빛·형태·구도·인물의 자세처럼 직접 찾아볼 수 있는 질문) | (어디를 보면 되는지 힌트 한 문장)
2. (질문) | (힌트)
3. (질문) | (힌트)"""


@dataclass
class WriteResult:
    summary: str
    keywords: list[str]
    intro: str
    questions: list[str]
    hints: list[str]
    model: str
    seconds: float = 0.0
    dropped: list[str] = field(default_factory=list)  # 안전장치로 버린 문장 (확인용)


class Writer(Protocol):
    @property
    def loaded(self) -> bool: ...

    def generate(self, system: str, user: str) -> str: ...


class KananaWriter:
    """Hugging Face transformers로 Kanana를 CPU에서 실행 (처음 쓸 때 한 번 불러온다, 약 4GB)"""

    def __init__(self, model: str = config.WRITER_MODEL):
        self.name = model
        self._lock = threading.Lock()
        self._tok = None
        self._model = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        with self._lock:
            if self.loaded:
                return
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer

            t0 = time.time()
            log.warning("글쓰기 모델(%s, %s) 불러오는 중… 처음이면 약 4GB를 내려받아요", self.name, config.WRITER_DTYPE)
            self._tok = AutoTokenizer.from_pretrained(self.name)
            dtype = getattr(torch, config.WRITER_DTYPE, torch.float32)
            self._model = AutoModelForCausalLM.from_pretrained(self.name, dtype=dtype).eval()
            log.warning("글쓰기 모델 준비 완료 (%.0f초)", time.time() - t0)

    def generate(self, system: str, user: str) -> str:
        import torch

        self.load()
        msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        ids = self._tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt")
        t0 = time.time()
        log.warning("글쓰기 시작 (요약 + 초보자 가이드)")
        with self._lock, torch.no_grad():  # 한 번에 하나씩 (CPU 메모리·속도)
            out = self._model.generate(
                ids, attention_mask=torch.ones_like(ids), max_new_tokens=500, do_sample=False, repetition_penalty=1.05
            )
        n = out.shape[1] - ids.shape[1]
        log.warning("글쓰기 완료: %d토큰, %.0f초", n, time.time() - t0)
        return self._tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True).strip()


_NUM = re.compile(r"\d{3,4}")


def _invented(text: str, source: str) -> bool:
    """원문에 없는 3~4자리 숫자(연도 등)가 있으면 지어낸 것으로 본다"""
    return bool(set(_NUM.findall(text)) - set(_NUM.findall(source)))


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?。])\s+", text) if s.strip()]


def _field(raw: str, name: str) -> str:
    """'요약:' 같은 머리말 뒤의 내용 (다음 머리말 전까지)"""
    # 다음 머리말이 같은 줄에 붙어 나오는 경우도 있다 ("…특징이에요. 키워드: 명암, …")
    m = re.search(rf"{name}\s*[:：]\s*(.*?)(?=(요약|키워드|쉬운 설명|관찰 질문)\s*[:：]|\Z)", raw, re.S)
    return m.group(1).strip() if m else ""


def parse(raw: str, source: str, model: str) -> WriteResult | None:
    """모델 답을 칸별로 나누고 안전장치를 적용한다. 요약이나 질문이 하나도 안 남으면 None"""
    dropped: list[str] = []

    def keep(sentences: list[str]) -> list[str]:
        ok = [s for s in sentences if not _invented(s, source)]
        dropped.extend(s for s in sentences if s not in ok)
        return ok

    summary = " ".join(keep(_sentences(_field(raw, "요약"))))
    intro = " ".join(keep(_sentences(_field(raw, "쉬운 설명"))))
    keywords = [k.strip(" .·#") for k in re.split(r"[,，、]", _field(raw, "키워드"))]
    keywords = [k for k in keywords if k and len(k) <= 15 and not _invented(k, source)][:3]

    questions, hints = [], []
    for line in _field(raw, "관찰 질문").splitlines():
        m = re.match(r"\s*\d+[.)]\s*(.+)", line)
        if not m:
            continue
        q, _, h = m.group(1).partition("|")
        q = q.strip()
        h = re.sub(r"^\(?\s*(어디를 보면 되는지\s*)?힌트\s*[:：]?\s*", "", h.strip()).strip(" ()")
        if not q or _invented(q, source):
            dropped.append(line.strip())
            continue
        questions.append(q)
        hints.append("" if _invented(h, source) else h)
    questions, hints = questions[:3], hints[:3]

    if not summary or not questions:
        return None
    return WriteResult(summary, keywords, intro, questions, hints, model, dropped=dropped)


def write(writer: Writer, title: str, artist: str, year: str, description: str, model: str) -> WriteResult | None:
    if not description.strip():
        return None
    head = f"작품: {title} / 작가: {artist} / 연도: {year}\n" if title else ""
    t0 = time.time()
    raw = writer.generate(SYSTEM, f"{head}<해설>{description.strip()}</해설>\n\n{TASK}")
    result = parse(raw, f"{title} {artist} {year} {description}", model)
    if result:
        result.seconds = round(time.time() - t0, 1)
    return result
