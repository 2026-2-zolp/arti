# GPT API 키 로컬 설정 가이드

2026-11-09 / 현재 Django의 OpenAI 호환 Chat Completions adapter 기준. 키 입력은 사용자가 로컬 파일에서 진행하며 이 안내 작성 중 실제 키 확인·유료 호출·모델 선택은 하지 않았다.

## 1. 입력할 파일

저장소 루트의 **`.env.compose`**를 편집한다. 공유용 `.env.compose.example`이나 프론트의 `VITE_*` 변수에 실제 키를 넣지 않는다. `.env.compose`는 이미 Git 제외 대상이다. 파일이 없다면 예시를 복사하고 DB 비밀번호·Django secret도 별도 준비한다. 기존 파일을 예시로 덮어쓰거나 기존 DB 비밀번호를 임의 교체하지 않는다.

아래 네 항목을 해당 위치에서 바꾼다. 실제 키를 채팅·터미널 명령 기록에 붙여넣을 필요는 없다.

```dotenv
ARTI_LLM_PROVIDER=openai_compatible
OPENAI_API_KEY=발급받은_실제_키
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=계정에서_사용가능한_모델_ID
```

위 값은 입력 설명용 placeholder다. 모델은 계정에서 사용 가능하며 현재 adapter의 Chat Completions·JSON 객체 응답과 호환되는 ID를 선택한다. 키만 넣고 provider가 disabled이거나 모델이 비어 있으면 연결되지 않는다. /chat/completions는 코드가 붙이므로 BASE_URL에 직접 덧붙이지 않는다.

처음에는 작업별 모델 변수5개를 비워 공통 OPENAI_MODEL로 확인하면 된다. JSON_MODE=true, TOKEN_PARAMETER=max_completion_tokens는 기존 기본값을 유지한다. 호환성 오류가 확인되면 응답 로그에 키를 노출하지 말고 모델·요청 형식부터 검토한다. 임의로 모든 오류에 옵션을 바꾸거나 자동fallback을 추가하지 않는다.

## 2. 실행 환경에 적용

Compose는 `.env.compose`를 자동 선택하지 않으므로 `--env-file`을 명시한다. 아래는 **새 개발 프로젝트 이름을 arti-dev로 정한 경우**의 예시다. 기존 개발 자료가 다른 프로젝트에 있다면 기존 이름을 사용한다. 프로젝트를 바꾸면 DB·미디어 볼륨도 달라질 수 있다. 기존 자료를 초기화하거나 시험프로젝트를 실제 자료용으로 착각하지 않는다.

```powershell
docker compose --env-file .env.compose -p arti-dev config --quiet
docker compose --env-file .env.compose -p arti-dev --profile ui up -d --build api frontend
```

API 기본주소는 http://127.0.0.1:4018, 프론트는 http://127.0.0.1:5178 이다. 포트를 바꿨으면 설정값을 따른다. 변경된 환경변수는 컨테이너 재생성 시 반영된다. `docker compose config` 전체 출력이나 `env`, `printenv`로 키를 화면에 출력하지 않는다.

실행한 PowerShell에 같은 이름의 환경변수가 이미 설정돼 있으면 Compose가 파일값보다 우선 사용할 수 있다. 파일 수정이 반영되지 않을 때는 기존 프로세스 환경 설정도 확인하되 실제 키를 출력하지 않는다.

Compose를 쓰지 않는 Django 직접 실행은 같은 변수를 **서버 프로세스 환경변수**로 전달해야 한다. settings.py는 `.env.compose`를 자동으로 읽지 않는다. React 개발서버에 키를 주는 방식으로 해결하지 않는다.

## 3. 동작 확인 순서

1. API `/api/ready`로 DB/서버 준비를 확인한다. 이 경로가 정상이어도 외부 모델 인증·호환성·잔액 검증이 끝난 것은 아니다.
2. 관리자가 허용된 시험 작품의 근거와 공개/검수 상태를 확인한다. 현재 유영국16점 인수표가 작성됐다는 사실만으로 관리자 승인·실전시 적재가 완료된 것은 아니다. 시험자료도 명시적으로 준비한다.
3. 사용자 작품해설/관람가이드에서 도슨트에 한 번 질문한다. 이때부터 실제 API 비용이 발생할 수 있다. 현재 작품과 질문의 맥락을 이어받는지 확인한다.
4. 관리자 요약/가이드 생성은 각각 제안 상태로 받으며 검수 후 별도 확정한다. 키 연결 성공이 콘텐츠 승인이나 W07 품질 통과를 뜻하지 않는다.
5. 모델명·작업종류·응답시간·성공/정제된 오류 코드만 공유한다. 키·인증헤더·전체환경값은 공유하지 않는다. 모델 확장과 평가 하네스는 이 실제 연결 검증 시 함께 논의한다.

| 응답 | 현재 코드에서 확인할 것 |
| --- | --- |
| 503 | provider/키/모델 누락 또는 upstream 인증·권한 등. 설정 유무만 보고 키가 유효하다고 단정하지 않음 |
| 429 | 호출 제한·할당량/예산 등을 공식 계정에서 확인 |
| 502 | 네트워크·호환 형식·응답 JSON·불완전 출력 등을 확인 |
| 504 | 현재25초 통신 timeout과 실제 지연을 확인 |
| 404/409 | 작품 공개·승인 범위 또는 콘텐츠 버전 문제를 먼저 확인 |

실제 GPT 호출·요약·가이드 연결과 CLIP/mDeBERTa 태그·감정 연동은 별개다. 키를 넣어도 현재 미연결 태그/감정 기능이 자동 완성되지 않는다. 새 Django는 보존된 Kanana 경로로 자동 전환하지 않는다.

연결을 끄려면 provider=disabled로 돌리고 API 컨테이너를 재생성한다. DB/미디어 볼륨 삭제는 필요 없다.

근거: [현재 AI 설정·모델 선택](AI_설정과모델선택.md), [서버 adapter](../../backend-django/arti/llm.py), [서버 설정](../../backend-django/config/settings.py), [OpenAI 공식 키 관리](https://developers.openai.com/api/docs/guides/api-keys). 공식 안내도 키를 서버의 비밀값으로 제공하도록 설명한다.
