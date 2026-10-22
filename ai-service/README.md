# 🧠 AI Service — 작품 감정 분석 서버 (Python · FastAPI)

[← 메인 안내로](../README.md) · [백엔드](../backend/README.md)

관리자가 작품을 등록하고 **「AI 분석」**을 누르면, 백엔드가 이 서버에 작품 해설(과 이미지 URL)을 보내고 **감정 6가지 점수**를 받아 옵니다.
이 점수는 관리자가 확인·확정한 뒤 **사용자 취향과 비교하는 추천**(U-08), 작품 화면의 분위기 표시(U-10), 아트 영수증 해석(U-12)에 쓰입니다.

```text
[A-04 관리자] 「AI 분석」 ──▶ backend ──▶ ai-service /analyze ──▶ 감정 점수
                               └──▶ Claude API (해설 요약)
                    「AI 제안」 저장 ──▶ 관리자 확인·수정 ──▶ 「확정」 ──▶ 추천·사용자 화면에 반영
```

## 사용하는 오픈소스 모델 (학습 없이 쓰는 "제로샷")

| 대상 | 모델 | 방식 | 라이선스 |
|---|---|---|---|
| 작품 이미지 | [`openai/clip-vit-base-patch32`](https://huggingface.co/openai/clip-vit-base-patch32) (CLIP) | 그림과 "a calm and peaceful painting" 같은 감정 문장의 유사도를 비교 | OpenAI CLIP 저장소 MIT |
| 한국어 해설 | [`MoritzLaurer/mDeBERTa-v3-base-mnli-xnli`](https://huggingface.co/MoritzLaurer/mDeBERTa-v3-base-mnli-xnli) (다국어 NLI) | 해설이 "이 글이 묘사하는 작품의 분위기는 평온함이다"를 얼마나 뒷받침하는지 판단 | MIT |

- **감정 6가지:** 평온 · 기쁨 · 슬픔 · 긴장 · 경외 · 그리움 (`app/emotions.py`에서 이름·문장을 바꿀 수 있음)
- **합치는 방법:** 이미지 60% + 텍스트 40% 가중 평균 → 가장 강한 감정을 1로 맞춘 상대 점수(0~1). 이미지가 없거나 내려받지 못하면 텍스트만 사용
- **재현성:** 무작위 요소가 없어 같은 입력에는 항상 같은 점수가 나옵니다
- **한계:** 학습 없이 쓰는 방식이라 "대략적인 경향" 수준입니다. 그래서 결과는 **「AI 제안」**으로만 저장하고 관리자가 확인한 뒤 확정합니다

## 실행

Python **3.10 이상**이 필요합니다. 처음 실행할 때 모델 파일(약 1.5GB)을 Hugging Face에서 자동으로 내려받습니다.

```bash
cd ai-service
python -m venv .venv
# Windows: .venv\Scripts\activate   /   Mac·Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

- PyTorch 용량을 줄이려면(Linux, GPU 없음) 먼저 `pip install torch --index-url https://download.pytorch.org/whl/cpu` 후 나머지를 설치하세요. Windows·Mac은 기본 설치가 CPU 버전입니다.
- 서버가 뜨면 모델을 백그라운드에서 미리 불러옵니다. `http://localhost:8000/health`의 `modelsLoaded`가 `true`가 되면 준비 완료입니다.
- 백엔드는 기본으로 `http://localhost:8000`을 호출합니다. 주소를 바꾸면 `backend/.env`의 `EMOTION_SERVICE_URL`을 맞춰 주세요.

### 전체 실행 순서 (터미널 3개)

```bash
cd ai-service && uvicorn app.main:app --port 8000   # 1) 감정 분석 서버
cd backend && npm run dev                           # 2) API 서버 :4000
cd frontend && npm run dev                          # 3) 화면 :5173
```

감정 분석 서버를 띄우지 않아도 나머지 기능은 모두 동작합니다(「AI 분석」만 "서버에 연결할 수 없어요" 안내, 추천은 취향 태그 방식).

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | `{ ok, modelsLoaded }` |
| GET | `/emotions` | 감정 항목 목록 |
| POST | `/analyze` | `{ title, description, imageUrl? }` → `{ emotions, imageScores, textScores, usedImage, imageError, models }` |

```json
// POST /analyze 응답 예시
{
  "emotions": { "calm": 1.0, "joy": 0.41, "sadness": 0.12, "tension": 0.08, "awe": 0.63, "nostalgia": 0.55 },
  "usedImage": false,
  "imageError": null,
  "models": { "image": "openai/clip-vit-base-patch32", "text": "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli" }
}
```

## 테스트

실제 모델 없이 가짜 모델로 점수 계산·API 동작을 검사합니다(torch 설치 불필요).

```bash
pip install -r requirements-dev.txt
pytest
```

## 모델 비교 실험 (발표·보고서용)

`evaluation/` 폴더에 **감정 분석 모델 비교 실험** 스크립트가 있습니다. 같은 평가 데이터로 여러 모델·설정을 돌려 "작품의 대표 감정을 얼마나 맞히는지"를 비교합니다.

```bash
python -m evaluation.evaluate                    # 텍스트 모델 4종 비교 (CPU로 약 10~20분)
python -m evaluation.evaluate --configs current  # 특정 설정만
python -m evaluation.evaluate --image            # 이미지(CLIP) 분석도 평가 — eval_set.json에 imageUrl 필요
```

- **평가 데이터** `evaluation/eval_set.json`: 작품 해설 + 대표 감정 "정답" 1~2개. 지금 들어 있는 정답은 **사람이 판단한 예시 라벨**이므로 팀이 함께 검토해 수정하고, 실제 전시(유영국) 작품으로 바꿔 쓰세요. 여러 사람이 각자 라벨을 달고 다수결로 정하면 근거가 더 탄탄해집니다.
- **결과** `evaluation/results/report.md`(비교표·작품별 결과), `details.csv`(작품·설정별 점수). 표를 그대로 슬라이드에 쓸 수 있습니다.
- **지표:** Top-1 정확도(1위 감정이 정답에 포함), Top-2 정확도(1·2위 중 하나라도 정답), 작품당 처리 시간
- **보정(calibration):** 모든 작품의 평균 점수를 빼서 "어떤 작품에나 특정 감정을 높게 주는" 모델 편향을 줄인 결과입니다(정답은 사용하지 않음).
- 이미지 평가는 `imageUrl`에 **공개(저작권 만료) 이미지 주소**를 넣어 실행하세요. 예: 위키미디어 공용의 명화 이미지.

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `ARTI_CLIP_MODEL` | openai/clip-vit-base-patch32 | 이미지 모델 |
| `ARTI_NLI_MODEL` | MoritzLaurer/mDeBERTa-v3-base-mnli-xnli | 텍스트 모델 |
| `ARTI_IMAGE_WEIGHT` | 0.6 | 이미지 결과 비중 |
| `ARTI_PRELOAD` | true | 서버 시작 시 모델 미리 불러오기 |

## 더 발전시키려면

- **ArtEmis**(CVPR 2021): WikiArt 작품 약 8만 점에 사람이 느낀 감정을 단 데이터셋. 이 데이터로 CLIP을 추가 학습(파인튜닝)하면 미술 작품에 더 맞는 감정 분석이 가능합니다(GPU와 데이터 이용 조건 확인 필요).
- 작품 이미지는 **사용 허가가 확인된 경우에만** 분석에 쓰세요. 허가가 없으면 「이미지도 분석」을 끄고 해설만으로 분석할 수 있습니다.
