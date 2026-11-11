# W01 코드 인수·재현 증거
기준일: 2026-11-07 KST / 기준SHA ae0e58ebc338c17da6d4d17616fd802f03ba3bb6

## 실제 수행
- 전체 저장소를 C:/Proj/26-2-zolp/work/arti에 clone하고 로컬 work/jun-eok-refactor 브랜치 생성.
- AGENTS.md 파일은 기준 tree 검사에서 발견하지 못함.
- tracked271파일, 캡처40장·WikiArt79장 확인. Git status/diff에서 제품소스 변경0·미추적소스0 확인.
- Node22.23.1/npm8.19.4/Python3.12.14. frontend/backend는 잠금파일로 npm ci --ignore-scripts --no-audit --no-fund.
- AI test는 별도 ai-service/.venv와 requirements-dev.txt만 설치. torch/transformers·모델가중치 설치/실제추론 없음.

## 검사 결과

| 검사 | 결과 | 증거 |
| --- | --- | --- |
| frontend typecheck | 통과 | [로그](frontend-typecheck.log) |
| frontend production build | 통과,84modules | [로그](frontend-build.log) |
| backend typecheck | 통과 | [로그](backend-typecheck.log) |
| backend tests | 38/38 통과 | [로그](backend-tests.log) |
| ai-service fake unit tests | 17/17 통과 | [로그](ai-unit-tests.log) |
| 주요 회귀 조사 | 기대한 현재 결함 재현 | [JSON](regression-audit.json), [스크립트](regression-audit.mts), [로그](regression-audit.log) |

회귀: draft전시 공개200, pending작품 GET/ask200, 확정요약 재분석으로suggested, 출처URL만변경시확정유지, 빈도수치소실/추천동일, 취향/시간변경 후 이전추천유지를 확인했다. 이는 결함을 고쳤다는 뜻이 아니다. reducer/함수 검사는 실제브라우저 검사가 아니다.

Python test 최초 실행의 system temp 권한오류 및 제한환경 hang은 지정 basetemp/실행권한으로 재실행해 해결했다. 환경문제를 제품결함으로 집계하지 않는다. Starlette TestClient/httpx deprecation 경고1건은 기록하되 이번 단계에서 의존성을 무단업그레이드하지 않았다. 테스트환경 패키지는 [freeze](ai-test-packages.txt)에 보존했다.

## 팀 고유 데이터 인수

- 팀원 실제 arti.db/직접 업로드/수동확정 자료 존재여부: **회신 대기·미확인**.
- 저장소의 기본예시·이미지는 존재하지만 이를 로컬 고유값 부재라고 단정하지 않는다.
- 실제팀DB를 읽거나 초기화하지 않았다. 조사/API테스트는 인메모리DB와 가짜provider다.
- 현 작업공간 backend/data에는 .gitkeep만 확인. 이는 **우리 새clone의 상태**이며 팀원의 로컬상태 증거가 아니다.
- AC02의 비파괴 새개발DB 경로로 코드 인수는 가능. AC17 이관완료는 아니며 고유값인수 여부는 계속 열려 있다.
- 실제자료 인수에는 [작품manifest](../../templates/artwork-manifest.csv)를 사용하고 필요시 도메인데이터export+대응파일을 받는다. 회원/세션 전체를 기본요구로 하지 않는다.

## 아직 안 한 것

제품기능수정, Django API 구현, U10 맥락전달 구현, 실제LLM/CLIP 추론, 모바일/사람사용성, GitHub Actions 설정/푸시, AWS생성/배포는 안 했다. 이번 성과는 정식 코드기반 확보·현재동작 재현이다.

## 재현

- frontend: npm ci --ignore-scripts --no-audit --no-fund → npm run typecheck → npm run build.
- backend: npm ci --ignore-scripts --no-audit --no-fund → npm run typecheck → npm test. localhost 요청이 허용된 환경.
- ai-service: 격리venv → pip install -r requirements-dev.txt → ARTI_PRELOAD=false → pytest -q --basetemp <새임시경로>.
- 조사 regression-audit.mts는 이 작업공간의 절대경로를 참조하는 진단용이다. 정식 회귀테스트로 옮길 때 공개 API·기능수준으로 정리한다.

