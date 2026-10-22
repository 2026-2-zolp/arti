"""환경 변수 설정"""
import os

CLIP_MODEL = os.getenv("ARTI_CLIP_MODEL", "openai/clip-vit-base-patch32")
NLI_MODEL = os.getenv("ARTI_NLI_MODEL", "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli")

# 이미지·텍스트 결과를 합칠 때 이미지 비중 (이미지가 없으면 텍스트 100%)
IMAGE_WEIGHT = float(os.getenv("ARTI_IMAGE_WEIGHT", "0.6"))

# 작품 이미지 다운로드 제한
IMAGE_MAX_BYTES = int(os.getenv("ARTI_IMAGE_MAX_BYTES", str(10 * 1024 * 1024)))
IMAGE_TIMEOUT_SEC = float(os.getenv("ARTI_IMAGE_TIMEOUT_SEC", "10"))

# 서버 시작 시 모델을 미리 불러올지 (false면 첫 분석 요청 때 불러온다)
PRELOAD = os.getenv("ARTI_PRELOAD", "true").lower() in ("1", "true", "yes")

# 라벨 편향 보정 사용 여부 (app/calibration.json 이 있을 때)
CALIBRATE = os.getenv("ARTI_CALIBRATE", "true").lower() in ("1", "true", "yes")
