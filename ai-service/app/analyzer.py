"""
감정 분석 로직

1) 이미지  → CLIP 제로샷: 그림과 "a calm and peaceful painting" 같은 문장이 얼마나 닮았는지 감정별로 비교
2) 텍스트 → mDeBERTa 다국어 NLI 제로샷: 한국어 해설이 "작품의 분위기는 평온함이다"를 얼마나 뒷받침하는지
3) 두 결과를 가중 평균 → 가장 강한 감정을 1로 맞춘 0~1 상대 점수

학습 없이(제로샷) 우리가 정한 감정 이름 그대로 점수를 얻는다.
모델은 처음 쓸 때 한 번만 불러오고, 무작위 요소가 없어 같은 입력에는 항상 같은 결과가 나온다.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Protocol

from PIL import Image

from . import config
from .emotions import EMOTION_KEYS, EMOTIONS, NLI_HYPOTHESIS

Scores = dict[str, float]


class Scorer(Protocol):
    """실제 모델(HuggingFaceScorer)과 테스트용 가짜 모델이 같은 모양을 갖도록 정의"""

    @property
    def loaded(self) -> bool: ...

    def image_scores(self, image: Image.Image) -> Scores: ...

    def text_scores(self, text: str) -> Scores: ...


def normalize_sum(scores: Scores) -> Scores:
    """합이 1인 분포로 변환 (이미지·텍스트 결과를 같은 기준으로 섞기 위해)"""
    total = sum(max(scores.get(k, 0.0), 0.0) for k in EMOTION_KEYS)
    if total <= 0:
        return {k: 1 / len(EMOTION_KEYS) for k in EMOTION_KEYS}
    return {k: max(scores.get(k, 0.0), 0.0) / total for k in EMOTION_KEYS}


def scale_to_max(scores: Scores) -> Scores:
    """가장 강한 감정을 1로 맞춘 상대 점수 (화면 막대그래프·추천 유사도 계산용)"""
    top = max((scores.get(k, 0.0) for k in EMOTION_KEYS), default=0.0)
    if top <= 0:
        return {k: 0.0 for k in EMOTION_KEYS}
    return {k: round(scores.get(k, 0.0) / top, 3) for k in EMOTION_KEYS}


def combine(image: Scores | None, text: Scores | None, image_weight: float) -> Scores:
    if image is None and text is None:
        raise ValueError("분석할 이미지나 텍스트가 없습니다.")
    if image is None:
        return scale_to_max(normalize_sum(text))  # type: ignore[arg-type]
    if text is None:
        return scale_to_max(normalize_sum(image))
    a, b = normalize_sum(image), normalize_sum(text)
    return scale_to_max({k: a[k] * image_weight + b[k] * (1 - image_weight) for k in EMOTION_KEYS})


class HuggingFaceScorer:
    """Hugging Face transformers로 CLIP·mDeBERTa를 CPU에서 실행"""

    def __init__(self, clip_model: str = config.CLIP_MODEL, nli_model: str = config.NLI_MODEL):
        self.clip_name = clip_model
        self.nli_name = nli_model
        self._lock = threading.Lock()
        self._clip = None
        self._clip_processor = None
        self._nli = None

    @property
    def loaded(self) -> bool:
        return self._clip is not None and self._nli is not None

    def load(self) -> None:
        # torch·transformers는 무거워서 실제로 필요할 때만 import (테스트는 이것 없이도 돈다)
        with self._lock:
            if self.loaded:
                return
            from transformers import CLIPModel, CLIPProcessor, pipeline

            self._clip = CLIPModel.from_pretrained(self.clip_name).eval()
            self._clip_processor = CLIPProcessor.from_pretrained(self.clip_name)
            self._nli = pipeline("zero-shot-classification", model=self.nli_name, device=-1)

    def image_scores(self, image: Image.Image) -> Scores:
        import torch

        self.load()
        prompts = [p for e in EMOTIONS for p in e["clip"]]
        inputs = self._clip_processor(text=prompts, images=image, return_tensors="pt", padding=True)
        with torch.no_grad():
            logits = self._clip(**inputs).logits_per_image[0]  # 문장별 유사도
        # 감정마다 문장 점수를 평균 → 감정끼리 softmax → 분포
        per_emotion, i = [], 0
        for e in EMOTIONS:
            n = len(e["clip"])
            per_emotion.append(logits[i : i + n].mean())
            i += n
        probs = torch.softmax(torch.stack(per_emotion), dim=0).tolist()
        return dict(zip(EMOTION_KEYS, probs))

    def text_scores(self, text: str) -> Scores:
        self.load()
        labels = [e["nli"] for e in EMOTIONS]
        # multi_label=True: 감정마다 독립적인 0~1 확률 (여러 감정이 동시에 높을 수 있다)
        out = self._nli(text, candidate_labels=labels, hypothesis_template=NLI_HYPOTHESIS, multi_label=True)
        by_label = dict(zip(out["labels"], out["scores"]))
        return {e["key"]: float(by_label[e["nli"]]) for e in EMOTIONS}


@dataclass
class AnalysisResult:
    emotions: Scores
    image_scores: Scores | None
    text_scores: Scores | None
    image_error: str | None


def analyze(scorer: Scorer, text: str, image: Image.Image | None, image_error: str | None = None) -> AnalysisResult:
    text = text.strip()
    img = scale_to_max(normalize_sum(scorer.image_scores(image))) if image is not None else None
    txt = scale_to_max(normalize_sum(scorer.text_scores(text))) if text else None
    return AnalysisResult(
        emotions=combine(img, txt, config.IMAGE_WEIGHT),
        image_scores=img,
        text_scores=txt,
        image_error=image_error,
    )
