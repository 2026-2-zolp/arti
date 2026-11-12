# ARTI · 나만의 전시 관람을 돕는 AI 어시스턴트

ARTI는 미술 감상이 익숙하지 않은 관람객이 취향과 관람 시간에 맞춰 작품을 찾고, 작품 앞에서 무엇을 볼지 스스로 탐색하도록 돕는 모바일 웹 서비스입니다. 가천대학교 2026학년도 2학기 졸업프로젝트로 개발하고 있습니다.

[개발 실행](docs/개발실행-Django.md) · [PC·휴대폰 검증](docs/operations/프론트인수_PC와휴대폰검증.md) · [작업기록](docs/작업기록/README.md) · [팀 Notion](https://app.notion.com/p/26-2-ARTI-a3534713f16782789905811787871032)

## 관람 흐름

1. 전시 링크를 열고, 전시와 별도로 구성한 5쌍의 작품을 비교해 취향을 확인합니다. 이 흐름을 시연하려면 활성 조사풀과 취향 확인 설정이 필요합니다. 회원은 기존 취향을 쓰거나 새 취향을 계정에 저장할 수 있고, 비회원도 이번 관람에 취향을 적용할 수 있습니다.
2. 관람 시간을 고르면 추천 작품과 이유, 전시 도면 위의 작품 위치와 추천 순서를 확인할 수 있습니다. 지도는 전시 입구나 직전에 본 작품을 기준으로 관람 진행을 보여 줍니다.
3. 작품해설과 관람가이드를 읽고, 궁금한 해설이나 관찰 질문을 AI 도슨트로 이어갈 수 있습니다. 도슨트는 현재 작품과 진입한 해설·질문의 맥락을 이어받습니다.
4. 관람을 마치면 오늘 본 작품과 취향 키워드를 아트 영수증으로 볼 수 있습니다. 회원은 마이페이지에서 관람 기록을 다시 열 수 있습니다.

## 구현과 검증 현황

| 영역 | 확인한 범위 | 시연 전 확인할 일 |
| --- | --- | --- |
| 취향·추천·지도 | 전시 독립 조사, 서버 동점 처리, 취향 적용·저장, 추천·지도 연결을 격리 PostgreSQL과 API에서 검증했습니다. | 조사 후보 10점·5쌍과 실제 전시 배치를 확정하고, 검수된 자료로 추천과 동선을 다시 확인합니다. |
| 감상·도슨트·영수증 | 작품해설·관람가이드에서 도슨트로 이어지고, 회원·비회원 관람을 영수증까지 완주하는 흐름을 확인했습니다. | 작품 비교 화면, 영수증 뒤로가기, 저장 PNG 등 갤럭시 관찰 항목을 보완하고 같은 기기에서 재확인합니다. |
| 전시 콘텐츠 | 유영국 작품 후보 16점을 비공개로 인수하고, 핵심 3점의 식별·출처·태그·설명 검수 자료를 준비했습니다. | 팀 독립 검수로 시연 작품, 해설·가이드, 이미지 사용 범위를 확인합니다. |
| AI·운영 | 격리 환경에서 GPT 텍스트 실호출과 CLIP·mDeBERTa 분석 연동을 각각 확인했습니다. GitHub Actions에서 프론트, Django·PostgreSQL, 모델 서비스 모의 응답, 계획·계약을 검사합니다. | 검수된 실제 콘텐츠로 도슨트 품질을 다시 보고, 운영 환경에서 접근·백업·복원·시연을 확인합니다. |

[11/11 작업일지와 다음 과업](docs/작업기록/일지/2026-11-11.md#다음-작업) · [모델·도슨트 검증 기록](docs/작업기록/일지/2026-11-09_모델도슨트검증.md) · [실행계획과 단계별 상태](docs/execution-plan/2026-11-07/README.md) · [GitHub Actions](https://github.com/2026-2-zolp/arti/actions)

## 로컬에서 실행하기

저장소 루트에서 PowerShell을 열고 Docker Desktop의 Linux 엔진과 호스트 Python 3을 준비합니다. 팀이 사용하는 Python 버전은 3.12이며, 호스트 Vite를 쓸 때는 Node.js 22가 필요합니다.

~~~powershell
if (-not (Test-Path .env.compose)) { python scripts/init_dev_env.py }
docker compose --env-file .env.compose -p arti-dev --profile ui up -d --build frontend
~~~

화면은 [http://127.0.0.1:5178](http://127.0.0.1:5178), API 준비 상태는 [http://127.0.0.1:4018/api/ready](http://127.0.0.1:4018/api/ready)에서 확인합니다. 새 개발 DB에는 계정·전시 데이터가 자동으로 들어가지 않습니다. **처음부터 관람 흐름을 확인하려면** 별도 DB에 합성 전시를 만드는 PC·휴대폰 검증 가이드를 따라 주세요. [Django 실행과 호스트 Vite](docs/개발실행-Django.md) · [합성 전시와 모바일 검증](docs/operations/프론트인수_PC와휴대폰검증.md)

AI 호출은 초기 설정에서 꺼져 있습니다. 텍스트 도슨트는 서버의 OpenAI 호환 provider를, 작품 태그·감정 분석은 별도 FastAPI 모델 서비스를 사용합니다. 실제 키는 Git에서 제외된 `.env.compose`에만 설정합니다. 실제 작품 이미지와 로컬 DB·덤프는 별도로 인수합니다. [GPT 설정 가이드](docs/operations/GPT_API키_로컬설정가이드.md) · [데이터 관리](data/README.md)

## 저장소 구조

| 경로 | 역할 |
| --- | --- |
| [frontend/](frontend/README.md) | React·Vite 관람객 및 운영자 화면 |
| [backend-django/](backend-django/README.md) | Django REST Framework·PostgreSQL API. 전시·작품, 취향·추천, 검수, 계정과 관람 기록 |
| [ai-service/](ai-service/README.md) | FastAPI 기반 CLIP·mDeBERTa 분석 서비스와 평가 자료 |
| [backend/](backend/README.md) | 통합 이전 Express·SQLite 원본과 비교용 실행 경로 |
| [data/](data/README.md) · [scripts/](scripts/README.md) | 자료 출처·검수 기록과 데이터 준비 도구 |
| [docs/](docs/README.md) · [compose.yaml](compose.yaml) | 실행·인수·검증 문서와 개발 환경 구성 |

현재 기본 실행 경로는 **React·Vite → Django API → PostgreSQL**입니다. 통합 이전 구조와 보존 자료를 찾을 때는 별도 안내를 참고해 주세요. [현재 구조와 기존 코드](docs/operations/현재구조와legacy의존.md)

## 팀 작업 이어가기

`main`이 팀 공통 개발 기준입니다. 개인 작업을 보존한 뒤 최신 `origin/main`을 작업 브랜치에 반영하고, 변경 내용과 확인한 결과를 PR에 적습니다. 담당·일정·회의 결정은 Notion에서 확인하고, 코드·실행 근거·일일 작업기록은 GitHub에서 확인합니다.

- 처음 설정하거나 브랜치를 갱신할 때 [팀원 시작 안내](docs/처음-시작하기.md) · [협업 규칙](docs/협업-규칙.md)
- 프론트 최신본과 갤럭시 관찰 항목을 대조할 때 [프론트 인수와 재검증](docs/작업기록/2026-11-11_실기기피드백_프론트인수.md)
- 작품·태그·취향 조사 후보를 검수할 때 [팀 검수 묶음 안내](docs/작업기록/2026-11-11_W06_팀검수통합전달묶음.md)
