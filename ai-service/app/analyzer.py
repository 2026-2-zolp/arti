# 모델 서비스: 이미지·텍스트 분석 모델을 묶어 결과를 구성합니다.
"""
감정 분석 로직

[취향 태그 8개 — 추천에 사용] (tags.py)
- 이미지가 있으면 CLIP: 태그마다 "해당하는 그림" 문장과 "해당하지 않는 그림" 문장 중 어느 쪽에 가까운지 → 0~1 (태그마다 독립)
- 이미지가 없으면 mDeBERTa NLI: 해설이 "작품의 특징은 자연 풍경이다"를 뒷받침하는 정도 (색감은 글로 판단하기 어려워 참고용)

[감정 6개 — 작품 분위기 설명·아트 영수증에만 사용] (emotions.py)
1) 이미지  → CLIP 제로샷: 그림과 "a calm and peaceful painting" 같은 문장이 얼마나 닮았는지 감정별로 비교
2) 텍스트 → mDeBERTa 다국어 NLI 제로샷: 한국어 해설이 "작품의 분위기는 평온함이다"를 얼마나 뒷받침하는지
3) 두 결과를 가중 평균 → 가장 강한 감정을 1로 맞춘 0~1 상대 점수

학습 없이(제로샷) 우리가 정한 감정 이름 그대로 점수를 얻는다.
모델은 처음 쓸 때 한 번만 불러오고, 무작위 요소가 없어 같은 입력에는 항상 같은 결과가 나온다.
"""
from __future__ import annotations

import json
import copy
import threading
from pathlib import Path
from dataclasses import dataclass
from typing import Protocol

from PIL import Image

from . import config
from .emotions import EMOTION_KEYS, EMOTIONS, NLI_HYPOTHESIS
from .tags import TAG_KEYS, TAG_NLI_HYPOTHESIS, TAGS
from .provenance import cached_snapshot, snapshot_manifest, loaded_provenance

Scores = dict[str, float]


# ───────────── 라벨 편향 보정 ─────────────
# 제로샷 모델은 어떤 글이든 특정 감정(예: '경외')에 높은 점수를 주는 편향이 있다.
# evaluation 실험(python -m evaluation.evaluate --save-calibration)으로 구한 "감정별 평균 점수"를 빼서 줄인다.
# 실험에서 Top-1 정확도 36% → 45%, Top-2 45% → 73% 로 개선 (evaluation/results/report.md)
CALIBRATION_FILE = Path(__file__).with_name("calibration.json")


def load_calibration(path: Path = CALIBRATION_FILE) -> dict[str, Scores]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {kind: {k: float(v[k]) for k in EMOTION_KEYS} for kind, v in data.get("prior", {}).items()}
    except (OSError, ValueError, KeyError, TypeError):
        return {}


TAG_CALIBRATION_FILE = Path(__file__).with_name("tag_calibration.json")


def load_tag_thresholds(path: Path = TAG_CALIBRATION_FILE) -> Scores:
    """태그별 '해당함' 기준값 (없으면 빈 dict → 모든 태그 0.5)"""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {k: float(data["thresholds"][k]) for k in TAG_KEYS}
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def calibrate_tags(scores: Scores, thresholds: Scores | None) -> Scores:
    """태그마다 기준값이 0.5가 되도록 다시 매긴다 (0~기준값 → 0~0.5, 기준값~1 → 0.5~1, 순서는 그대로).
    색 태그처럼 '해당함'을 너무 자주 주는 태그의 기준을 올려도 백엔드·화면은 계속 0.5로 판단하면 된다."""
    if not thresholds:
        return scores
    out = {}
    for k, s in scores.items():
        th = min(max(thresholds.get(k, 0.5), 0.01), 0.99)
        out[k] = round(0.5 * s / th if s < th else 0.5 + 0.5 * (s - th) / (1 - th), 3)
    return out


def apply_prior(scores: Scores, prior: Scores | None) -> Scores:
    """감정별 평균 점수(편향)를 뺀 뒤 가장 낮은 감정이 0이 되게 올린다 (편향을 뺀 순서를 그대로 유지).

    예전에는 음수를 0으로 자르고, 모두 0 이하면 보정 전 점수로 돌아갔다. 그러면 편향이 그대로 남거나
    (모두 0 이하인 작품) 2위 이하 순서가 사라졌다 → evaluation/ai_validation.ipynb 4장에서 발견해 수정.
    """
    if not prior:
        return scores
    adjusted = {k: scores.get(k, 0.0) - prior[k] for k in EMOTION_KEYS}
    low, high = min(adjusted.values()), max(adjusted.values())
    if high - low <= 0:  # 모든 감정이 똑같으면 보정으로 얻을 정보가 없다
        return scores
    return {k: v - low for k, v in adjusted.items()}


# 태그·감정 모델 점수 계산의 공통 인터페이스입니다.
class Scorer(Protocol):
    """실제 모델(HuggingFaceScorer)과 테스트용 가짜 모델이 같은 모양을 갖도록 정의"""

    @property
    def loaded(self) -> bool: ...

    def image_scores(self, image: Image.Image) -> Scores: ...

    def text_scores(self, text: str) -> Scores: ...

    def image_tag_scores(self, image: Image.Image) -> Scores: ...

    def text_tag_scores(self, text: str) -> Scores: ...


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


# Hugging Face 모델로 분석 점수를 계산합니다.
class HuggingFaceScorer:
    """Hugging Face transformers로 CLIP·mDeBERTa를 CPU에서 실행"""

    def __init__(self, clip_model: str = config.CLIP_MODEL, nli_model: str = config.NLI_MODEL,
                 clip_revision: str | None = config.CLIP_REVISION):
        self.clip_name = clip_model
        self.nli_name = nli_model
        self.clip_revision = clip_revision
        self._tag_model_provenance = None
        self._lock = threading.Lock()
        self._clip = None
        self._clip_processor = None
        self._nli = None
        self._tag_text = None  # 태그 문장들의 CLIP 텍스트 벡터 (한 번만 계산)

    @property
    def loaded(self) -> bool:
        return self._clip is not None and self._nli is not None

    @property
    def tag_model_provenance(self):
        # ready가 되기 전의 부분 로드 정보나 호출자가 수정할 수 있는 내부 dict를 게시하지 않습니다.
        return copy.deepcopy(self._tag_model_provenance) if self.loaded else None

    def load(self) -> None:
        # torch·transformers는 무거워서 실제로 필요할 때만 import (테스트는 이것 없이도 돈다)
        with self._lock:
            if self.loaded:
                return
            from transformers import CLIPModel, CLIPProcessor, pipeline

            # 모두 성공한 뒤에만 게시해 부분 초기화를 ready로 오인하지 않습니다.
            cached = cached_snapshot(self.clip_name, self.clip_revision)
            if cached:
                root, before = cached
                clip = CLIPModel.from_pretrained(str(root), local_files_only=True,
                                                use_safetensors=before['weightFormat'] == 'safetensors').eval()
                processor = CLIPProcessor.from_pretrained(str(root), local_files_only=True)
            else:
                options = {'revision': self.clip_revision} if self.clip_revision else {}
                clip = CLIPModel.from_pretrained(self.clip_name, **options).eval()
                processor = CLIPProcessor.from_pretrained(self.clip_name, **options)
            nli = pipeline("zero-shot-classification", model=self.nli_name, device=-1)
            provenance = None
            if cached and snapshot_manifest(root, self.clip_name, self.clip_revision) == before:
                provenance = loaded_provenance(before)
            # 출처 미확정은 기존 점수 동작을 막지 않되,성공한 모델 전체와 함께만 게시합니다.
            self._tag_model_provenance = provenance
            self._clip, self._clip_processor, self._nli = clip, processor, nli

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

    def image_tag_scores(self, image: Image.Image) -> Scores:
        """태그마다 '해당하는 그림' 문장 평균과 '해당하지 않는 그림' 문장 평균의 유사도 차이 → 시그모이드 → 0~1"""
        import torch

        self.load()
        with torch.no_grad():
            if self._tag_text is None:
                prompts = [s for t in TAGS for s in t["pos"] + t["neg"]]
                feats = self._clip.get_text_features(**self._clip_processor(text=prompts, return_tensors="pt", padding=True))
                self._tag_text = feats / feats.norm(dim=-1, keepdim=True)
            img = self._clip.get_image_features(**self._clip_processor(images=image, return_tensors="pt"))
            img = img / img.norm(dim=-1, keepdim=True)
            sims = (img @ self._tag_text.T)[0] * self._clip.logit_scale.exp()  # logits_per_image와 같은 척도
        out, i = {}, 0
        for t in TAGS:
            n_pos, n_neg = len(t["pos"]), len(t["neg"])
            diff = sims[i : i + n_pos].mean() - sims[i + n_pos : i + n_pos + n_neg].mean()
            out[t["key"]] = round(float(torch.sigmoid(diff)), 3)
            i += n_pos + n_neg
        return out

    def text_tag_scores(self, text: str) -> Scores:
        self.load()
        labels = [t["nli"] for t in TAGS]
        res = self._nli(text, candidate_labels=labels, hypothesis_template=TAG_NLI_HYPOTHESIS, multi_label=True)
        by_label = dict(zip(res["labels"], res["scores"]))
        return {t["key"]: round(float(by_label[t["nli"]]), 3) for t in TAGS}


# 분석 결과의 태그·감정·근거 정보를 묶습니다.
@dataclass
class AnalysisResult:
    emotions: Scores
    image_scores: Scores | None
    text_scores: Scores | None
    image_error: str | None
    tags: Scores | None = None  # 취향 태그 8개 점수 (0~1, 태그마다 독립, 기준값 보정 후 — 0.5 이상 = 해당함)
    tag_source: str | None = None  # "image" | "text"
    tags_raw: Scores | None = None  # 기준값 보정 전 점수 (검증용)


def analyze(
    scorer: Scorer,
    text: str,
    image: Image.Image | None,
    image_error: str | None = None,
    calibration: dict[str, Scores] | None = None,
    tag_thresholds: Scores | None = None,
) -> AnalysisResult:
    text = text.strip()
    cal = calibration or {}
    img = scale_to_max(normalize_sum(apply_prior(scorer.image_scores(image), cal.get("image")))) if image is not None else None
    txt = scale_to_max(normalize_sum(apply_prior(scorer.text_scores(text), cal.get("text")))) if text else None
    # 태그: 그림이 있으면 그림으로만 판단 (색·형태는 글보다 그림이 정확), 없으면 해설로
    if image is not None:
        tags, tag_source = scorer.image_tag_scores(image), "image"
    elif text:
        tags, tag_source = scorer.text_tag_scores(text), "text"
    else:
        tags, tag_source = None, None
    return AnalysisResult(
        emotions=combine(img, txt, config.IMAGE_WEIGHT),
        image_scores=img,
        text_scores=txt,
        image_error=image_error,
        # 기준값은 그림으로 판단한 점수로 정했으므로, 해설로 판단한 태그에는 적용하지 않는다
        tags=calibrate_tags(tags, tag_thresholds) if tags and tag_source == "image" else tags,
        tag_source=tag_source,
        tags_raw=tags,
    )
