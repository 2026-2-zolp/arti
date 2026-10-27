"""
ARTI 감정 분석 서버 (FastAPI)

실행: uvicorn app.main:app --port 8000
- GET  /health   상태 확인 (모델 로딩 여부)
- GET  /emotions 감정 항목 목록
- POST /analyze  작품 해설(+업로드 이미지 base64 또는 이미지 URL) → 취향 태그 8개 점수 + 감정 점수

백엔드(backend/)가 관리자 화면의 「AI 분석」 요청을 받으면 이 서버를 호출한다.
"""
from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import config
from .analyzer import HuggingFaceScorer, Scorer, analyze, load_calibration, load_tag_thresholds
from .emotions import EMOTIONS
from .tags import TAGS
from .image_fetch import ImageFetchError, decode_base64_image, fetch_image

log = logging.getLogger("arti.ai")
scorer: Scorer = HuggingFaceScorer()
# 라벨 편향 보정값 (app/calibration.json). 파일이 없으면 보정 없이 동작
calibration = load_calibration() if config.CALIBRATE else {}
# 태그별 '해당함' 기준값 (app/tag_calibration.json). 파일이 없으면 모든 태그 0.5
tag_thresholds = load_tag_thresholds() if config.CALIBRATE else {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 모델을 백그라운드에서 미리 불러온다 (첫 분석 요청이 오래 걸리지 않도록). 실패해도 서버는 뜬다.
    if config.PRELOAD and isinstance(scorer, HuggingFaceScorer):
        def _load():
            try:
                scorer.load()
                log.info("모델 로딩 완료")
            except Exception:
                log.exception("모델 로딩 실패 — 첫 분석 요청 때 다시 시도합니다")
        threading.Thread(target=_load, daemon=True).start()
    yield


app = FastAPI(title="ARTI 감정 분석 서버", lifespan=lifespan)


class AnalyzeRequest(BaseModel):
    title: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=5000)
    imageUrl: str | None = Field(default=None, max_length=2000)
    # 관리자가 업로드한 이미지 파일 내용 (base64). 있으면 imageUrl보다 우선
    imageBase64: str | None = Field(default=None, max_length=15_000_000)


class AnalyzeResponse(BaseModel):
    emotions: dict[str, float]
    imageScores: dict[str, float] | None
    textScores: dict[str, float] | None
    usedImage: bool
    imageError: str | None
    models: dict[str, str]
    tags: dict[str, float] | None = None  # 취향 태그 8개 (0~1, 태그마다 독립, 0.5 이상 = 해당함) — 추천에 사용
    tagSource: str | None = None  # "image" | "text"
    tagsRaw: dict[str, float] | None = None  # 기준값 보정 전 점수 (검증용)


@app.get("/health")
def health():
    return {"ok": True, "modelsLoaded": scorer.loaded, "calibration": sorted(calibration), "tagThresholds": tag_thresholds}


@app.get("/emotions")
def emotions():
    return [{"key": e["key"], "label": e["ko"]} for e in EMOTIONS]


@app.get("/tags")
def tags():
    return [{"key": t["key"], "label": t["ko"]} for t in TAGS]


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze_artwork(req: AnalyzeRequest):
    # 제목은 해설이 없을 때의 보조 정보로만 쓴다
    text = req.description.strip() or req.title.strip()
    image, image_error = None, None
    if req.imageBase64 or req.imageUrl:
        try:
            image = decode_base64_image(req.imageBase64) if req.imageBase64 else fetch_image(req.imageUrl or "")
        except ImageFetchError as e:
            image_error = str(e)  # 이미지가 실패해도 텍스트만으로 분석을 계속한다
    if not text and image is None:
        raise HTTPException(status_code=400, detail=image_error or "작품 해설이나 이미지가 있어야 분석할 수 있어요.")
    try:
        result = analyze(scorer, text, image, image_error, calibration, tag_thresholds)
    except Exception as e:
        log.exception("분석 실패")
        raise HTTPException(status_code=503, detail="감정 분석 모델을 실행하지 못했어요.") from e
    return AnalyzeResponse(
        emotions=result.emotions,
        imageScores=result.image_scores,
        textScores=result.text_scores,
        usedImage=result.image_scores is not None,
        imageError=result.image_error,
        models={"image": config.CLIP_MODEL, "text": config.NLI_MODEL},
        tags=result.tags,
        tagSource=result.tag_source,
        tagsRaw=result.tags_raw,
    )
