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

# 초보자용 글쓰기 모델 (해설 요약 + 초보자 가이드). 처음 /write 요청 때 불러온다 (약 4GB, 서버 시작 시 미리 부르지 않음)
WRITER_MODEL = os.getenv("ARTI_WRITER_MODEL", "kakaocorp/kanana-1.5-2.1b-instruct-2505")
# false면 /write 를 끈다 (메모리가 부족한 PC 등). 백엔드는 원문 앞 문장으로 대체한다
WRITER_ENABLED = os.getenv("ARTI_WRITER_ENABLED", "true").lower() in ("1", "true", "yes")
# 모델 숫자 형식. float32가 기본 — 일반 노트북 CPU는 bfloat16을 직접 계산하지 못해 수십 배 느려질 수 있다(Windows 노트북에서 1시간 넘게 멈춘 듯 보인 원인).
# float32는 메모리 약 9GB(16GB PC 권장), bfloat16은 약 4.5GB(최신 서버 CPU에서만 빠름)
WRITER_DTYPE = os.getenv("ARTI_WRITER_DTYPE", "float32")
