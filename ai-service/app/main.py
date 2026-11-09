# 모델 서비스: 분석 API와 로딩·추론 상태를 제공합니다. Django는 분석 전용 경계로 연결합니다.
"""
ARTI 감정 분석 서버 (FastAPI)

실행: uvicorn app.main:app --port 8000
- GET  /health   상태 확인 (모델 로딩 여부)
- GET  /emotions 감정 항목 목록
- POST /analyze  작품 해설(+업로드 이미지 base64 또는 이미지 URL) → 취향 태그 8개 점수 + 감정 점수
- POST /write    작품 해설 → 초보자용 요약·키워드 + 초보자 가이드(쉬운 설명 · 관찰 질문 · 힌트) (Kanana)

백엔드(backend/)가 관리자 화면의 「AI 분석」 요청을 받으면 이 서버를 호출한다.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import config
from .runtime import ModelRuntime
from .analyzer import HuggingFaceScorer, Scorer, analyze, load_calibration, load_tag_thresholds
from .emotions import EMOTIONS
from .tags import TAGS
from .image_fetch import ImageFetchError, decode_base64_image, fetch_image
from .writer import KananaWriter, Writer, write

log = logging.getLogger("arti.ai")
scorer: Scorer = HuggingFaceScorer()
runtime = ModelRuntime()
# 라벨 편향 보정값 (app/calibration.json). 파일이 없으면 보정 없이 동작
calibration = load_calibration() if config.CALIBRATE else {}
# 태그별 '해당함' 기준값 (app/tag_calibration.json). 파일이 없으면 모든 태그 0.5
tag_thresholds = load_tag_thresholds() if config.CALIBRATE else {}
# 초보자용 글쓰기 모델 (처음 /write 요청 때 불러온다)
writer: Writer = KananaWriter()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 모델을 백그라운드에서 미리 불러온다 (첫 분석 요청이 오래 걸리지 않도록). 실패해도 서버는 뜬다.
    if config.PRELOAD and isinstance(scorer, HuggingFaceScorer):
        runtime.warmup(scorer)
    yield


app = FastAPI(title="ARTI 감정 분석 서버", lifespan=lifespan)


# 모델 분석 요청 형식을 검증합니다.
class AnalyzeRequest(BaseModel):
    title: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=5000)
    imageUrl: str | None = Field(default=None, max_length=2000)
    # 관리자가 업로드한 이미지 파일 내용 (base64). 있으면 imageUrl보다 우선
    imageBase64: str | None = Field(default=None, max_length=15_000_000)


# 모델 분석 결과의 응답 형식을 정의합니다.
class AnalyzeResponse(BaseModel):
    emotions: dict[str, float]
    imageScores: dict[str, float] | None
    textScores: dict[str, float] | None
    usedImage: bool
    usedText: bool = False  # 해설(또는 그림·해설이 없을 때 제목)을 분석에 썼는지
    imageError: str | None
    models: dict[str, str]
    tags: dict[str, float] | None = None  # 취향 태그 8개 (0~1, 태그마다 독립, 0.5 이상 = 해당함) — 추천에 사용
    tagSource: str | None = None  # "image" | "text"
    tagsRaw: dict[str, float] | None = None  # 기준값 보정 전 점수 (검증용)


@app.get("/health")
def health():
    return {
        "ok": True,
        "modelsLoaded": scorer.loaded,
        "modelState": runtime.state(scorer),
        "analysisBusy": runtime.busy(scorer),
        "busySeconds": runtime.busy_seconds(),
        "calibration": sorted(calibration),
        "tagThresholds": tag_thresholds,
        "writer": {"enabled": config.WRITER_ENABLED, "model": config.WRITER_MODEL, "loaded": writer.loaded},
    }


@app.get("/ready")
def ready():
    if not scorer.loaded:
        raise HTTPException(503,detail='분석 모델 준비 중',headers={'Retry-After':'5'})
    return {'ok':True,'modelState':'ready'}


@app.get("/emotions")
def emotions():
    return [{"key": e["key"], "label": e["ko"]} for e in EMOTIONS]


@app.get("/tags")
def tags():
    return [{"key": t["key"], "label": t["ko"]} for t in TAGS]


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze_artwork(req: AnalyzeRequest):
    with runtime.slot(scorer):
        return _analyze_artwork(req)


def _analyze_artwork(req: AnalyzeRequest):
    image, image_error = None, None
    if req.imageBase64 or req.imageUrl:
        try:
            image = decode_base64_image(req.imageBase64) if req.imageBase64 else fetch_image(req.imageUrl or "")
        except ImageFetchError as e:
            image_error = str(e)  # 이미지가 실패해도 텍스트만으로 분석을 계속한다
    # 제목은 그림도 해설도 없을 때만 쓴다. 제목은 짧아서(「작품」「산」) 분위기를 판단하기 어렵고,
    # 「…의 추억」 같은 단어 하나가 결과를 크게 바꾼다 (모르트퐁텐의 추억: 그림만 평온 1위 → 제목을 섞으면 그리움 1위)
    text = req.description.strip() or (req.title.strip() if image is None else "")
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
        usedText=result.text_scores is not None,
        imageError=result.image_error,
        models={"image": config.CLIP_MODEL, "text": config.NLI_MODEL},
        tags=result.tags,
        tagSource=result.tag_source,
        tagsRaw=result.tags_raw,
    )


# 요약·가이드 작성 요청을 검증합니다.
class WriteRequest(BaseModel):
    title: str = Field(default="", max_length=200)
    artist: str = Field(default="", max_length=200)
    year: str = Field(default="", max_length=50)
    description: str = Field(default="", max_length=5000)


# 요약·가이드 작성 응답을 정의합니다.
class WriteResponse(BaseModel):
    summary: str
    keywords: list[str]
    intro: str
    questions: list[str]
    hints: list[str]
    model: str
    seconds: float
    dropped: list[str]  # 원문에 없는 숫자가 들어가 버린 문장 (확인용)


@app.post("/write", response_model=WriteResponse)
def write_texts(req: WriteRequest):
    """관리자 「AI 분석」용: 해설 원문으로 요약 + 초보자 가이드 제안. CPU에서 작품 1개에 30~40초 (처음엔 모델 로딩 추가)"""
    if not config.WRITER_ENABLED:
        raise HTTPException(status_code=503, detail="글쓰기 모델이 꺼져 있어요 (ARTI_WRITER_ENABLED=false).")
    if not req.description.strip():
        raise HTTPException(status_code=400, detail="작품 해설이 있어야 요약과 가이드를 만들 수 있어요.")
    try:
        result = write(writer, req.title, req.artist, req.year, req.description, config.WRITER_MODEL)
    except Exception as e:
        log.exception("글쓰기 실패")
        raise HTTPException(status_code=503, detail="글쓰기 모델을 실행하지 못했어요.") from e
    if result is None:
        raise HTTPException(status_code=422, detail="모델 답이 정해진 형식이 아니라 쓰지 않았어요. 다시 시도하거나 직접 입력해 주세요.")
    return WriteResponse(**result.__dict__)
