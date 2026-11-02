# ⚙️ Backend — 화면에 전달할 데이터와 로직

[← 메인 안내로](../README.md)

**역할:** 전시·작품 데이터 제공, 취향에 따른 추천 결과 생성, 지도 좌표 및 검증된 작품 해설·감상 기능을 API로 전달합니다.

## 백엔드가 맡는 흐름

```text
data/ 검수된 작품 정보
        ↓
전시·작품 조회 API
        ↓
관람객 취향·관람 시간 입력
        ↓
추천 로직 → 추천 작품 ID·이유·순서
        ↓
지도용 작품 좌표 + 작품 해설/출처
        ↓
frontend/ 화면
```

## 첫 구현에서 필요한 계약

| 기능 | 최소 확인 항목 |
| --- | --- |
| 전시·작품 조회 | 전시/작품 ID, 이름, 공식 해설, 출처, 검수 상태 |
| 추천 | 선택한 작품/취향, 관람 시간, 결과 작품 ID와 이유·순서 |
| 지도 | 어떤 평면도인지, 각 작품의 좌표·순서, 실제/가상 여부 |
| 작품 감상 | 공식 설명과 생성된 해석을 구분, 출처 제공 |
| 선택: Guided Looking/Q&A | 작품 ID로 근거 조회, 근거 부족 시 무리한 답변 금지 |

**API URL/필드명/인증 방식은 아직 확정되지 않았습니다.** 프론트와 합의 후 [API 논의사항](../docs/API-연동-논의.md)을 업데이트합니다. Django/DRF·PostgreSQL 등은 기존 논의의 **후보**이지 현재 코드에 설정된 것이 아닙니다.

## 첫 작업 순서
1. 프론트 담당과 ID 체계·최소 요청/응답을 먼저 합의
2. [data/](../data/)에서 검증된 샘플 작품 3~5점 준비
3. 전시/작품 조회 → 추천 → 지도/해설 API 순서로 구현
4. 같은 입력에는 재현 가능한 추천 결과·이유를 반환
5. 데이터 없음·잘못된 ID·에러 응답을 검증
6. 실행 명령·환경변수·테스트 방법을 기록한 뒤 PR

## 놓치지 말 것
- 작품 이미지 URL이 있다고 **사용 허가가 있다는 뜻은 아닙니다**.
- 2D 지도의 좌표는 관람 상태 기준 표시이지 실내 위치 측정이 아닙니다.
- 검증된 사실과 AI 생성 해석은 별도 취급합니다.

> **현재 상태 (2026-10-17, `dev/김광권`):** 아래 「구현본」의 **TypeScript(Node.js + Express) + SQLite** 백엔드가 이 브랜치에 올라가 있고, 로컬 실행과 통합 테스트 29개 통과까지 확인했습니다. 작품 감정 분석은 오픈소스 모델을 쓰는 [`ai-service/`](../ai-service/README.md)(Python)와 함께 동작합니다. 단, ① 기존 설계 문서의 Django/DRF·PostgreSQL 후보와 **스택이 다르고**, ② 작품 데이터는 **목업**(유영국 전시 아님)이며, ③ API 경로·필드명은 팀 합의 전 **제안안**입니다. 스택·규격은 팀 논의 후 확정합니다.

---

## 구현본 (김광권 · TypeScript 제안안)

> **먼저 확인할 것**
> - **목업 데이터:** `src/seed.ts`의 전시·작품(고흐·모네 등)은 화면·API 동작 확인용 예시입니다. 확정 전시인 〈유영국: 산은 내 안에 있다〉의 검증 데이터(`data/`)로 교체해야 합니다.
> - **API 제안안:** 아래 경로·필드명은 [API 논의사항](../docs/API-연동-논의.md)의 결정 전 제안입니다. 프론트와 합의하면 바뀔 수 있습니다.
> - **AI 구성:** 감정 분석은 오픈소스 모델(CLIP + mDeBERTa)을 쓰는 별도 Python 서버 [`ai-service/`](../ai-service/README.md), 해설 요약·맞춤 설명·질문 답변·영수증 해석은 Claude API입니다. 아래 「AI 기능 구성」 참고.
> - **Claude:** `ANTHROPIC_API_KEY`가 없으면 규칙 기반 결과로 대신합니다. 키를 넣었을 때의 Claude 응답은 아직 실제로 확인하지 않았습니다.

`frontend/`의 화면(U-01~U-15, A-01~A-06)이 쓰는 REST API 서버입니다.

### 실행

Node.js **22.13 이상**이 필요합니다(내장 SQLite `node:sqlite` 사용 → 별도 DB 설치·네이티브 빌드 없음).

```bash
cd backend
npm install
cp .env.example .env     # 필요하면 값 수정 (안 해도 기본값으로 동작)
npm run dev              # http://localhost:4000/api  (코드 수정 시 자동 재시작)
```

다른 터미널에서 프론트엔드를 띄우면 `/api` 요청이 자동으로 이 서버로 전달됩니다(Vite 프록시).

```bash
cd frontend
npm install
npm run dev              # http://localhost:5173
```

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 (tsx watch) |
| `npm run build` / `npm start` | 컴파일(`dist/`) 후 실행 |
| `npm test` | 통합 테스트 29개 (메모리 DB, 가짜 감정 분석 서버, 외부 호출 없음) |
| `npm run typecheck` | 타입 검사 |
| `npm run db:reset` | DB 파일 삭제 → 다음 실행 때 목업 데이터로 다시 생성 |
| `npm run seed:captures` | 캡처 40점(`ai-service/evaluation/images`)으로 「캡처 40점 테스트 전시」(`ex-capture`) 만들기 — 검수 완료·위치·해설(`scripts/capture-descriptions.json`, AI 작성 초안·검수 전)까지 넣음, 태그는 「전시 AI 일괄 분석」으로. 이미 있는 작품은 해설·출처만 갱신하고 AI 결과는 유지, `-- --reset`이면 다시 만듦 |

#### 데모 계정 (처음 실행 시 자동 생성)
| 구분 | ID | 비밀번호 |
|---|---|---|
| 사용자 | demo@arti.app | arti1234 |
| 관리자 | admin | admin1234 |

> 운영 전에 관리자 비밀번호를 반드시 바꾸고 `DEMO_MODE=false`로 설정하세요.

### 환경 변수 (`.env`)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 4000 | 서버 포트 |
| `DB_PATH` | data/arti.db | SQLite 파일 경로. 없으면 생성 후 `src/seed.ts` 데이터로 초기화 |
| `DEMO_MODE` | true (`NODE_ENV=production`이면 false) | 비밀번호 재설정 링크를 메일 대신 응답으로 돌려줌 |
| `SESSION_TTL_DAYS` | 14 | 로그인 유지 기간 |
| `CORS_ORIGIN` | (비움) | 프론트를 다른 주소에서 띄울 때만 설정 |
| `EMOTION_SERVICE_URL` | http://localhost:8000 | 감정 분석 서버(`ai-service`) 주소 |
| `WRITER_TIMEOUT_MS` | 600000 | `ai-service`의 `/write`(Kanana 요약·초보자 가이드) 응답 대기 시간. 처음엔 모델을 불러오느라 몇 분 걸릴 수 있어요 |
| `UPLOAD_DIR` | data/uploads | 관리자가 올린 작품 이미지 저장 폴더 (Git 제외) |
| `ANTHROPIC_API_KEY` | (비움) | 넣으면 해설 요약·초보자 가이드·맞춤 설명·질문 답변·영수증 해석이 Claude로 동작. 비우면 요약·초보자 가이드는 `ai-service`의 Kanana(로컬 모델), 나머지는 규칙 기반 결과 |
| `ARTI_AI_MODEL` | claude-opus-5-5 | 사용할 Claude 모델 |

### 폴더 구조

```
src/
├── index.ts          서버 진입점
├── app.ts            Express 앱 구성 (라우터 연결, 에러 처리)
├── config.ts         환경 변수
├── db.ts             SQLite 스키마 · 초기 데이터 입력
├── repo.ts           DB 행 ↔ 도메인 타입 변환 + 쿼리 (라우트는 SQL을 직접 쓰지 않음)
├── http.ts           인증 미들웨어, 에러 형식, 요청 횟수 제한
├── schemas.ts        요청 검증(zod) — 한국어 에러 메시지
├── types.ts          도메인 타입 (frontend/src/types.ts와 동일)
├── seed.ts           초기 데이터 (전시 2, 작품 12, 회원 3, 관람기록 3)
├── lib/
│   ├── recommend.ts  추천(고른 카드의 태그 강도 평균, 카드마다 최소 1점) + 관람 순서(입구 기준 최근접 이웃)
│   ├── tags.ts       취향 태그 8개·확정 점수 계산·예전 태그 옮기기
│   ├── emotion.ts    감정 항목·감정 프로필 계산 (설명·영수증용, AI 호출 없음)
│   ├── emotionClient.ts  AI 분석 서버(ai-service) 호출 (태그·감정)
│   ├── ai.ts         Claude: 해설 요약·맞춤 설명·질문 답변·영수증 해석 (실패 시 규칙 기반)
│   ├── password.ts   scrypt 비밀번호 해시, 토큰
│   └── josa.ts       한국어 조사 처리
└── routes/
    ├── catalog.ts    전시·작품 조회, 추천, AI
    ├── auth.ts       회원가입·로그인·취향·비밀번호 재설정
    ├── visits.ts     관람 기록(아트 영수증)
    └── admin.ts      관리자 API
test/api.test.ts      API 통합 테스트
test/ai.test.ts       AI 기능 통합 테스트 (가짜 감정 분석 서버 사용)
```

### API 목록

에러 응답은 모두 `{ "error": "한국어 메시지" }` 형식이고, 프론트는 이 메시지를 그대로 화면에 보여 줍니다.

**인증 헤더** — 사용자: `Authorization: Bearer <token>` / 관리자: `X-Admin-Token: <token>`

| 메서드 | 경로 | 권한 | 화면 | 설명 |
|---|---|---|---|---|
| GET | `/api/health` | - | - | 서버 상태, AI 모드 |
| GET | `/api/exhibitions` | - | A-02, A-03 | 전시 목록 |
| GET | `/api/exhibitions/:id` | - | U-01, U-09 | 전시 상세(전시실·입구 좌표 포함) |
| GET | `/api/artworks?exhibitionId=` | - | U-08, A-04 | 작품 목록 |
| GET | `/api/artworks/:id` | - | U-10 | 작품 상세 |
| POST | `/api/recommendations` | - | U-08 | `{exhibitionId, tastes, duration}` → 추천 + 관람 순서 |
| POST | `/api/artworks/:id/explanation` | - | U-10 | `{tastes}` → AI 맞춤 설명 |
| POST | `/api/artworks/:id/ask` | - | U-11 | `{question}` → AI 답변(+출처) |
| POST | `/api/auth/signup` | - | U-04 | → `{user, token}` |
| POST | `/api/auth/login` | - | U-03 | → `{user, token}` |
| POST | `/api/auth/logout` | 사용자 | U-13 | 세션 종료 |
| GET | `/api/auth/me` | 사용자 | - | 내 정보 |
| PUT | `/api/users/:id/tastes` | 본인/관리자 | U-05 | 취향 저장 |
| POST | `/api/auth/password-reset/request` | - | U-14 | `{email}` → `{demoToken}` (데모 모드에서만 값 있음) |
| POST | `/api/auth/password-reset/confirm` | - | U-15 | `{token, password}` |
| POST | `/api/visits` | 선택 | U-12 | 로그인 시 저장, 비회원은 저장 없이 영수증만 반환 |
| POST | `/api/visits/interpret` | - | U-12 | `{viewedArtworkIds, reactions, dwell}` → AI 취향 해석 + 감정 프로필 |
| GET | `/api/users/:id/visits` | 본인/관리자 | U-13, A-06 | 관람기록 목록 |
| GET | `/api/visits/:id` | 본인/관리자 | U-12(조회) | 관람기록 상세 |
| POST | `/api/admin/login` | - | A-01 | → `{name, token}` |
| POST | `/api/admin/logout` | 관리자 | - | |
| POST / PUT | `/api/admin/exhibitions[/:id]` | 관리자 | A-03 | 전시 등록 / 수정 |
| POST / PUT | `/api/admin/artworks[/:id]` | 관리자 | A-04, A-05 | 작품 등록 / 수정(위치 지정 포함) |
| POST | `/api/admin/artworks/:id/analyze` | 관리자 | A-04 | 취향 태그·감정 분석 + 해설 요약 → 「AI 제안」 저장 |
| POST / DELETE | `/api/admin/artworks/:id/image` | 관리자 | A-04 | 작품 이미지 파일 업로드(본문=파일, PNG·JPG·WEBP 10MB) / 삭제 |
| POST / DELETE | `/api/admin/exhibitions/:id/floor-plan?width=&height=` | 관리자 | A-05 | 미술관 평면도(안내도) 이미지 업로드(본문=파일, 쿼리=원본 픽셀 크기) / 삭제. 전시 정보 수정(PUT)으로는 바뀌지 않음 |
| GET | `/api/uploads/:file` | - | U-08~U-11 | 업로드한 작품 이미지 |
| POST | `/api/admin/exhibitions/:id/analyze` | 관리자 | A-04 | 전시 작품 전체 AI 분석 (확정된 작품 제외) |
| POST | `/api/admin/exhibitions/:id/confirm-ai` | 관리자 | A-04 | 전시의 「AI 제안」 모두 확정 (태그는 AI가 0.5 이상으로 본 태그를 켬) |
| GET | `/api/admin/members?q=` | 관리자 | A-06 | 회원 검색 + 관람 횟수 |

### AI 기능 구성

| 기능 | 화면 | 사용 AI | 실행 시점 |
|---|---|---|---|
| 작품 취향 태그 (풍경·인물·추상·빛·강렬한/차가운/따뜻한/부드러운 색감) | A-04 | **오픈소스** CLIP(그림, 없으면 mDeBERTa로 해설), `ai-service` | 작품 등록 시 1회 → 관리자 확인·수정 후 확정 |
| 작품 감정 분석 (평온·기쁨·슬픔·긴장·경외·그리움, 설명용) | A-04 → U-10·U-12 | **오픈소스** CLIP(이미지) + mDeBERTa(한국어 해설), `ai-service` | 작품 등록 시 1회 → 관리자 확정 |
| 해설 요약 (초보자용 3~4문장 + 키워드) | A-04 → U-10 | **Claude** | 작품 등록 시 1회 → 관리자 확정 |
| 태그 기반 추천 | U-08 | 계산 (확정된 AI 태그 점수 또는 관리자 태그) | 추천 요청 시 |
| AI 맞춤 설명 / AI 질문 | U-10 / U-11 | **Claude** | 사용자 요청 시 |
| 아트 영수증 취향 해석 | U-12 | **Claude** (+ 감정 프로필 계산) | 관람 종료 시 1회 |

**태그 기반 추천 방식** (계산 예시·검증 결과는 [AI·추천 정리](../docs/AI-감정분석-추천-정리.md))
1. 사용자 취향 카드 = 관리자 태그 = AI 태그 (같은 8개, `lib/tags.ts`) → 변환 없이 바로 비교
2. 작품의 태그 강도(0~1): AI 태그를 **확정**했으면 확정 점수(`tagScores`), 아니면 관리자가 켠 태그 1 / 나머지 0
3. 확정 점수는 서버가 계산: 관리자가 AI 판단(0.5 기준)을 그대로 둔 태그는 AI 점수, 바꾼 태그는 켬 1 / 끔 0 (사람의 판단 우선)
4. 작품 점수 = 고른 카드의 태그 강도 평균. 고른 카드마다 그 태그가 있는(0.5 이상) 작품을 최소 1점씩 먼저 넣고 나머지는 점수순 → 입구에서 가까운 순서로 동선
5. 추천 이유 = 고른 카드 중 이 작품에 해당하는 태그 (예: "풍경 · 빛", 응답의 `matchedTags`·`matchedCard`·`aiTags`)
6. 감정 분석은 추천에 쓰지 않고 작품 분위기 설명(U-10)·아트 영수증(U-12)에만 씁니다. 요약 키워드(`#연못`)는 표시만 합니다
7. 예전 6개 태그(고요한 풍경·감정 표현 …)로 저장된 DB는 서버를 켤 때 자동으로 옮겨집니다(고요한 풍경→풍경, 감정 표현은 삭제). 목업 작품 12점의 태그는 **개발자가 정한 예시 값**입니다

### 설계 메모

- **비밀번호**는 scrypt 해시로만 저장하고, **로그인 토큰·재설정 토큰**도 DB에는 SHA-256 해시만 저장합니다(DB가 유출돼도 바로 쓸 수 없음).
- 로그인 실패 메시지는 "이메일이 없음/비밀번호 틀림"을 구분하지 않고, 재설정 요청도 가입 여부와 무관하게 같은 응답을 돌려줍니다(가입 여부 노출 방지).
- 비밀번호를 재설정하면 그 계정의 기존 로그인 세션은 모두 끊깁니다. 재설정 링크는 30분 유효, 1회용입니다.
- 관람 기록의 소유자(`userId`)는 요청 본문이 아니라 **로그인 토큰**으로 정합니다. 남의 기록은 본인·관리자만 볼 수 있습니다.
- 로그인·회원가입·재설정은 IP당 분당 10회, AI 요청은 분당 20회로 제한합니다(메모리 기반, 서버 1대 기준).
- **추천**은 검수 완료(`approved`) + 위치 등록된 작품만 대상으로 합니다(설계서: 검증된 데이터만 서비스).
- **AI 결과는 사람이 확인한 뒤에만 쓴다:** 감정 분석·요약은 「AI 제안」으로 저장되고, 관리자가 A-04에서 확정해야 추천·사용자 화면에 쓰입니다. 확정 뒤 공식 해설이나 이미지를 바꾸면 자동으로 「AI 제안」으로 돌아갑니다. 공식 해설(`description`)과 AI 요약(`summary`)은 따로 저장합니다.
- **Claude 프롬프트**는 미술관이 등록한 자료(해설·관찰 포인트·출처·확정된 감정 분석)만 근거로 쓰고 없는 사실을 지어내지 말라고 지시합니다. 요약은 Structured Outputs(`betaZodOutputFormat`)로 형식을 고정합니다. 키가 없거나 실패·거절되면 규칙 기반 결과로 대체되어 화면이 멈추지 않습니다.
- 비밀번호 재설정 **메일 발송은 아직 없습니다.** 데모 모드에서는 링크를 화면에 보여 주고, 서버 콘솔에도 링크를 출력합니다. 운영 시 `routes/auth.ts`의 TODO 위치에 메일 서비스를 연결하세요.
