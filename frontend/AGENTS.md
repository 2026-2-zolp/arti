# ARTI 프론트엔드 — 팀 합의 / 개발 가이드 (AGENTS.md)

> 사람과 AI 에이전트가 이 저장소에서 작업할 때 **반드시 먼저 읽는 문서**입니다.
> 기준 문서: `ARTI_5_화면UI설계_제안완료.docx` (5. 화면(UI) 설계)
> 합의 내용과 실제 구현이 달라진 부분은 맨 아래 **[변경 사항](#변경-사항-합의-대비-수정한-부분)** 에 표시합니다.

---

## 0. 빠른 시작

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc 타입체크 + vite 빌드
npm run lint       # ESLint
npm run format     # Prettier
```

- 현재는 **서버 연동 전 단계**라 모든 데이터가 `src/mocks/` 의 임시 데이터로 동작합니다. (`VITE_USE_MOCK` 기본값 `true`)
- 테스트 계정은 `src/mocks/seed.ts` 상단 주석에 있습니다. (사용자 / 관리자 각각 1개)
- 임시 데이터 초기화: 브라우저 콘솔에서 `__resetArtiMock()` (개발 모드 전용)

## 1. 기술 스택

| 구분            | 사용 기술                                                     |
| --------------- | ------------------------------------------------------------- |
| Framework       | React 19 + Vite                                               |
| Language        | TypeScript (strict)                                           |
| Styling         | CSS Modules (`*.module.css`) + `src/styles/global.css` 토큰   |
| Routing         | React Router (`createBrowserRouter`)                          |
| HTTP            | Axios (`src/api/client.ts`)                                   |
| Package Manager | npm                                                           |
| Code Style      | ESLint (flat config) + Prettier                               |
| 전역 상태 관리  | React Context (`src/contexts/`)                               |
| 서버 상태 관리  | TanStack Query (`src/hooks/queries/`) + Axios                 |

---

## 2. 라우팅 표

전시 관련 화면은 모두 **`/exhibition/:exhibitionId` 하위**에 둡니다. 전시관이 늘어나면 `exhibitionId` 만 바뀌고 화면/라우트는 그대로 재사용됩니다.
경로 문자열은 직접 쓰지 말고 `src/routes/paths.ts` 의 `paths` 헬퍼를 사용합니다.

### 사용자 (모바일 웹, 최소 360px)

| 화면 ID | 화면명               | 경로                                                  | 로그인 | 비고                                                    |
| ------- | -------------------- | ----------------------------------------------------- | ------ | ------------------------------------------------------- |
| -       | 서비스 기본 화면     | `/`                                                   | -      | 기본 전시 U-01 로 리다이렉트 (`VITE_DEFAULT_EXHIBITION_ID`) |
| U-01    | 서비스 시작          | `/exhibition/:exhibitionId`                           | -      | 전시 입구 QR / 전시 URL 진입 (첫 화면)                   |
| U-02    | 로그인 선택          | `/exhibition/:exhibitionId/start`                     | -      |                                                         |
| U-03    | 로그인               | `/login?returnUrl=...`                                | -      | 외부 로그인 URL 직접 진입                                |
| U-04    | 회원가입             | `/signup?returnUrl=...`                               | -      | 외부 회원가입 URL 직접 진입                              |
| U-05    | 취향 파악            | `/exhibition/:exhibitionId/taste`                     | -      | 2개 이상 선택                                           |
| U-06    | 저장 취향 확인       | `/exhibition/:exhibitionId/taste/saved`               | 필요   |                                                         |
| U-07    | 관람 시간 선택       | `/exhibition/:exhibitionId/time`                      | -      | 30분 / 1시간 / 여유롭게                                  |
| U-08    | 개인화 작품 추천     | `/exhibition/:exhibitionId/recommendations`           | -      |                                                         |
| U-09    | 추천 관람 경로(2D)   | `/exhibition/:exhibitionId/route`                     | -      | 작품 감상 후 "다음 작품 안내"에도 재사용                 |
| U-10    | 작품 감상            | `/exhibition/:exhibitionId/artworks/:artworkId`       | -      |                                                         |
| U-11    | AI 자유 질문         | `/exhibition/:exhibitionId/artworks/:artworkId/ask`   | -      |                                                         |
| U-12    | 아트 영수증          | `/exhibition/:exhibitionId/receipt`                   | -      | 현재 관람. 로그인 시 기록 자동 저장                      |
| U-12    | 아트 영수증(조회)    | `/history/:visitId`                                   | 필요   | U-13 에서 진입하는 과거 기록 조회 모드                   |
| U-13    | 관람기록             | `/history`                                            | 필요   | 미로그인 → `/login?returnUrl=/history` → 복귀            |
| U-14    | 비밀번호 찾기        | `/password/forgot`                                    | -      |                                                         |
| U-15    | 새 비밀번호 설정     | `/password/reset?token=...`                           | -      | 이메일 재설정 링크 URL                                   |

### 관리자 (데스크톱 웹, 1280px 이상)

| 화면 ID | 화면명          | 경로                                          | 로그인 | 비고                                       |
| ------- | --------------- | --------------------------------------------- | ------ | ------------------------------------------ |
| A-01    | 관리자 로그인   | `/admin/login?returnUrl=...`                  | -      |                                            |
| A-02    | 관리자 대시보드 | `/admin`                                      | 관리자 |                                            |
| A-03    | 전시 관리       | `/admin/exhibitions`                          | 관리자 | 등록/수정은 화면 내 모달                    |
| A-04    | 작품 목록       | `/admin/artworks?exhibitionId=`               | 관리자 | (추가) 작품 선택용 목록                     |
| A-04    | 작품 등록       | `/admin/artworks/new?exhibitionId=`           | 관리자 |                                            |
| A-04    | 작품 수정       | `/admin/artworks/:artworkId/edit`             | 관리자 |                                            |
| A-05    | 위치·지도 관리  | `/admin/map?exhibitionId=&artworkId=`         | 관리자 |                                            |
| A-06    | 회원 조회       | `/admin/members`                              | 관리자 | 행 선택 시 상세 모달                        |

### 주요 화면 전환 (UI 설계서 5.5.1 기준)

```
U-01 ─관람 시작하기→ U-02 ─로그인→ U-03(returnUrl=U-06) ─성공→ U-06 ─계속→ U-07
                        ├─비회원으로 계속→ U-05 ─선택 완료→ U-07
                        └─회원가입→ U-04(returnUrl=U-05) ─완료→ U-05
U-07 ─추천 받기→ U-08 ─지도에서 경로 보기→ U-09 ─관람 시작하기→ U-10
U-10 ─다음 작품 안내(남음)→ U-09 → U-10 …   U-10 ─관람 마치기(없음)→ U-12 ─관람 완료→ U-01
U-10 ─AI에게 질문하기→ U-11 ─뒤로→ U-10      U-10 ─지도 보기→ U-09
U-14 ─링크 요청→ (메일) → U-15 ─설정 완료/취소→ U-03
A-01 ─로그인 성공→ A-02 ─메뉴→ A-03 ~ A-06
```

---

## 3. 로그인 후 복귀 기준 (합의 3)

- 로그인이 필요한 화면을 비로그인으로 접근하면 `RequireAuth`(`src/routes/guards.tsx`)가
  `원래 화면 → /login?returnUrl=원래경로 → 로그인 성공 → 원래 화면` 으로 처리합니다.
- `returnUrl` 이 없는 일반 로그인은 서비스 기본 화면(`/` → 기본 전시 U-01)으로 이동합니다.
- `returnUrl` 은 `/` 로 시작하는 **내부 경로만** 허용합니다 (`src/utils/returnUrl.ts`, 오픈 리다이렉트 방지).
- 관리자도 동일하게 `/admin/login?returnUrl=` 을 사용합니다 (`RequireAdmin`).

## 4. API 응답 기준 (합의 4)

```ts
// 성공
{ success: true, data: {} }
// 실패
{ success: false, error: { code: 'ERROR_CODE', message: '사용자에게 표시할 메시지' } }
```

| HTTP | 의미        |
| ---- | ----------- |
| 200  | 성공        |
| 201  | 생성        |
| 400  | 잘못된 요청 |
| 401  | 로그인 필요 |
| 403  | 권한 없음   |
| 404  | 데이터 없음 |
| 409  | 중복        |
| 422  | 입력값 오류 |
| 500  | 서버 오류   |

- 타입: `src/api/types.ts` (`ApiResponse<T>`, `ApiError`)
- Axios 인터셉터가 실패 응답을 `ApiError(status, code, message)` 로 정규화합니다. 화면에서는 `getErrorMessage(error)` 로 메시지를 표시합니다.
- 서비스 함수는 `apiClient.get<ApiResponse<T>>(...).then(unwrap)` 형태로 작성해 `data` 만 반환합니다.
- 4xx 응답은 TanStack Query 에서 재시도하지 않습니다 (`src/app/queryClient.ts`).

## 5. 서버 통신 / 임시 데이터

- **지금은 서버 연동 전이므로 별도 지시가 있을 때까지 임시 데이터로 개발합니다.**
- `src/mocks/adapter.ts` 가 Axios `adapter` 를 대체합니다. 화면 → 서비스 → Axios → 인터셉터 경로는 실제 서버와 동일하고, 마지막 네트워크 단계만 목 핸들러(`src/mocks/handlers/*.ts`)가 응답합니다.
- 목 데이터는 `localStorage(arti.mockdb.v1)` 에 저장되어 새로고침/다른 탭(관리자 ↔ 사용자)에서 공유됩니다.
- **서버 연동 시:** `.env.local` 에 `VITE_USE_MOCK=false`, `VITE_API_BASE_URL=<서버 주소>` 설정 → 목 어댑터가 빠지고 실제 요청이 나갑니다. 엔드포인트는 `src/api/services/*.api.ts` 에 모여 있으니 서버 명세에 맞춰 이 파일들만 수정합니다.

### 현재 가정한 엔드포인트 (서버 명세 확정 시 수정)

| 메서드 | 경로                                              | 용도                          |
| ------ | ------------------------------------------------- | ----------------------------- |
| GET    | `/exhibitions/:exhibitionId`                      | 전시 정보 (U-01)              |
| GET    | `/exhibitions/:exhibitionId/taste-options`        | 취향 카드 (U-05)              |
| POST   | `/exhibitions/:exhibitionId/recommendations`      | 추천 (U-08) `{tasteIds, timeOption}` |
| GET    | `/exhibitions/:exhibitionId/artworks/:artworkId`  | 작품 상세 (U-10)              |
| GET    | `/exhibitions/:exhibitionId/map`                  | 평면도 + 좌표 (U-09)          |
| POST   | `/artworks/:artworkId/ai/explanation`             | AI 맞춤 설명                  |
| GET    | `/artworks/:artworkId/ai/suggested-questions`     | 추천 질문 (U-11)              |
| POST   | `/artworks/:artworkId/ai/questions`               | AI 질문 (U-11)                |
| POST   | `/auth/login`, `/auth/signup`, `/auth/logout`     | 인증                          |
| GET    | `/auth/me`                                        | 토큰으로 사용자 복원          |
| POST   | `/auth/password/forgot`, `/auth/password/reset`   | U-14 / U-15                   |
| GET/PUT| `/me/taste`                                       | 저장 취향 (U-06 / U-05)       |
| GET/POST | `/me/visits`, GET `/me/visits/:visitId`         | 관람 기록 (U-12 / U-13)       |
| POST   | `/admin/auth/login`, GET `/admin/auth/me`         | 관리자 인증                   |
| GET    | `/admin/dashboard`                                | A-02                          |
| GET/POST/PUT | `/admin/exhibitions(/:id)`                  | A-03                          |
| GET/POST/PUT | `/admin/artworks(/:id)`                     | A-04                          |
| GET    | `/admin/exhibitions/:exhibitionId/map`            | A-05                          |
| PUT    | `/admin/maps/:mapId/positions/:artworkId`         | A-05 좌표 저장 `{xRatio, yRatio}` |
| GET    | `/admin/members?keyword=`, `/admin/members/:id`   | A-06                          |

## 6. 비회원 상태 기준 (합의 6)

- 비회원도 핵심 관람 기능(취향 → 시간 → 추천 → 지도 → 감상 → 영수증)을 모두 사용할 수 있습니다.
- 유지 데이터: 선택한 취향, 관람 가능 시간, 추천 작품 목록, 추천 작품 순서, 현재 관람 위치, 작품 👍/👎, 현재 관람 세션
- 구현: `src/contexts/VisitSessionContext.tsx` — **React Context + useReducer + localStorage(`arti.visitSession.v1`)**
  - 페이지 새로고침해도 관람 상태 유지
  - 로그인/로그아웃과 독립된 상태라 **로그인으로 전환해도 진행 중인 관람이 유지**됩니다.
    (예: 비회원으로 관람 → U-12 에서 "로그인하고 기록 저장" → 로그인 → U-12 복귀 → 같은 세션이 서버에 저장)
  - 다른 전시(`exhibitionId`)로 들어가거나 "관람 완료"를 누르면 세션이 새로 시작/종료됩니다.

## 7. 화면 상태 공통 기준 (합의 7)

모든 API 연동 화면은 **`<QueryState>`**(`src/components/common/QueryState`)로 감싸 Loading / Success / Empty / Error / Retry 를 통일합니다.

```tsx
<QueryState query={query} loading={<SkeletonList />} empty={<EmptyState title="..." />}>
  {(data) => <List data={data} />}
</QueryState>
```

- Loading → 목록은 `Skeleton`, 그 외 `Spinner`(기본값)
- Empty → `EmptyState` (배열 길이 0 또는 null 이면 자동 판정, `isEmpty` 로 변경 가능)
- Error → `ErrorState` + "다시 시도" 버튼(`refetch`) 자동 표시
- 버튼 처리 중(Mutation) 상태는 `Button` 의 `loading` prop 사용

## 8. 공통 UI 기준 (합의 8)

- 모바일 웹 최소 360px (`MobileLayout`: 360~480px 중앙 정렬), 관리자 웹 1280px 이상 (`AdminLayout` `min-width: 1280px`)
- 공통 컴포넌트는 `src/components/common/` 에서만 가져다 씁니다 (`@/components/common` 배럴).
  `Button` · `Input`(+`Textarea`, `Select`) · `Card`(+`CardButton`) · `Modal` · `Toast`(`useToast`) · `Skeleton` · `Spinner` · `EmptyState` · `ErrorState`
  추가: `QueryState`, `Chip`, `Icon`
- **같은 역할의 버튼/입력창을 화면마다 새 디자인으로 만들지 않습니다.** 변형이 필요하면 공통 컴포넌트에 variant 를 추가합니다.
- 색상/간격/반경은 `src/styles/global.css` 의 CSS 변수(토큰)를 사용합니다.

## 9. 추천 데이터 전달 기준 (합의 9)

U-08 → U-09 로 넘기는 추천 작품(`RecommendedArtwork`, `src/types/domain.ts`)은 최소 다음 필드를 가집니다.

```ts
{ artworkId, title, imageUrl, recommendationReason, order, floorId }
// + 화면 표시용 artist, roomName (추가 필드 — 변경 사항 참고)
```

- 추천 순서는 **`order` 기준**으로 정렬해 표시합니다 (세션 저장 시 정렬).
- 전달 방식: U-08 이 추천 결과를 관람 세션(Context)에 저장 → U-09/U-10 이 세션에서 읽음.

## 10. 지도 좌표 기준 (합의 10)

- A-05 관리자 지도와 U-09 사용자 지도는 **같은 컴포넌트(`src/components/map/FloorMapView.tsx`)와 같은 좌표 데이터**를 사용합니다.
- 픽셀 좌표를 저장하지 않고 **0~1 정규화 좌표**만 저장합니다.

```ts
{ artworkId, mapId, floorId, xRatio, yRatio } // 예: xRatio 0.35, yRatio 0.62
```

- 평면도의 전시실(room)도 0~1 비율(`xRatio, yRatio, widthRatio, heightRatio`)로 정의하며, 평면도 비율은 `aspectRatio` 로 고정합니다.
- 관리자 PC(1440px)에서 저장한 위치가 모바일(360px)에서도 같은 위치에 표시되는 것을 통합 테스트로 확인했습니다.

## 13. 작품 반응 기준 (합의 13)

- 상태: 👍(`like`) / 👎(`dislike`) / 선택 안 함(키 없음) — 같은 버튼을 다시 누르면 선택 해제
- 선택하지 않아도 "다음 작품 안내"로 이동할 수 있습니다.

## 18. TanStack Query 기준 (합의 18)

- Query Key 는 **`src/api/queryKeys.ts` 한 곳에서 기능 단위**로 관리합니다.
  `exhibitions` · `tastes` · `recommendations` · `artworks` · `maps` · `ai` · `auth` · `visits` · `dashboard` · `members`
- 화면에서는 `src/hooks/queries/useUserQueries.ts`, `useAdminQueries.ts` 의 훅만 사용합니다 (화면에서 `useQuery` 직접 작성 X).
- 데이터 수정 후에는 관련 Query 를 `invalidateQueries({ queryKey: queryKeys.<기능>.all })` 로 갱신합니다.
  예) 작품 위치 저장 → `maps.all`, `artworks.all`, `dashboard.all` 무효화

## 19. 공통 폴더 구조 (합의 19)

개인별로 임의의 구조를 추가하지 말고 아래 구조를 우선 사용합니다.

```
src/
├─ app/                 # App, router, QueryClient, RootLayout
├─ api/                 # axios client, 응답 타입, queryKeys, tokenStorage
│  └─ services/         # 기능별 API 함수 (*.api.ts) ← 서버 연동 시 수정 지점
├─ hooks/
│  ├─ queries/          # TanStack Query 훅 (기능별)
│  └─ *.ts              # 공통 훅 (useGoBack, useSpeech, useRouteParams)
├─ contexts/            # 전역 상태 (Auth, AdminAuth, VisitSession)
├─ components/
│  ├─ common/           # 공통 UI 컴포넌트 (합의 8)
│  ├─ layout/           # MobileLayout, AdminLayout
│  ├─ map/              # FloorMapView (A-05 / U-09 공용)
│  └─ receipt/          # ArtReceipt (U-12 공용)
├─ pages/
│  ├─ user/             # U-01 ~ U-15
│  └─ admin/            # A-01 ~ A-06
├─ routes/              # paths.ts(경로 헬퍼), guards.tsx(RequireAuth/RequireAdmin)
├─ mocks/               # 임시 데이터 + 목 어댑터 (서버 연동 후 제거 가능)
├─ types/domain.ts      # 도메인 타입
├─ utils/               # storage, format, returnUrl, josa
├─ styles/global.css    # 디자인 토큰 + 리셋
└─ config.ts            # 기본 전시 ID, 목 모드 여부
```

- 파일명: 컴포넌트/페이지 `PascalCase.tsx`, 스타일 `같은이름.module.css`, 그 외 `camelCase.ts`
- import 는 `@/` 별칭 사용 (`@/components/common`)

## 20. 최소 통합 테스트 기준 (합의 20)

| 흐름 | 단계 | 결과 |
| ---- | ---- | ---- |
| 사용자 관람 | 전시 진입 → 취향 → 관람 시간 → 추천 → 지도 → 작품 감상 → 다음 작품 → 관람 종료 → 아트 영수증 | ✅ 통과 (임시 데이터, 새로고침 후 진행 위치 유지 확인) |
| 지도 | 관리자 작품 위치 저장 → 서버(목 DB) 저장 → 사용자 지도 조회 → 같은 위치에 작품 표시 | ✅ 통과 (1440px 관리자에서 저장한 x0.250/y0.299 가 모바일 지도에서 동일 비율로 렌더링) |
| 인증 | 로그인이 필요한 URL(`/history`) 접근 → 로그인 → 원래 URL 복귀 | ✅ 통과 (잘못된 비밀번호 401 메시지 표시 포함) |

> 서버 연동 후에는 같은 3개 흐름을 실제 API 로 다시 확인해야 합니다.

---

## 변경 사항 (합의 대비 수정한 부분)

합의 내용대로 구현이 어렵거나 보완이 필요했던 부분과 수정 위치입니다.

| # | 합의 항목 | 합의 내용 | 실제 구현 / 변경 내용 | 이유 | 위치 |
|---|-----------|-----------|----------------------|------|------|
| 1 | 6. 비회원 상태 | Zustand + localStorage (전역 상태면 Context, 안 되면 Zustand) | **Zustand 미사용. React Context + useReducer + localStorage** 로 구현 | Context 만으로 요구사항(새로고침 유지, 로그인 전환 시 유지) 충족 가능. 의존성 추가 불필요 | `src/contexts/VisitSessionContext.tsx` |
| 2 | 3. 로그인 후 복귀 | returnUrl 없는 로그인 → 서비스 기본 화면 | UI 설계서의 "U-03 로그인 성공 → U-06" 흐름은 **U-02 가 `returnUrl=/exhibition/:id/taste/saved` 를 붙여서** 로그인으로 보내는 방식으로 구현. 직접 `/login` 진입(returnUrl 없음)은 `/` → 기본 전시 U-01 | 합의(returnUrl 기준)와 UI 설계서(U-03→U-06) 를 동시에 만족시키기 위함 | `src/pages/user/LoginChoicePage.tsx`, `LoginPage.tsx` |
| 3 | 3. 로그인 후 복귀 | (명시 없음) | 회원가입도 `returnUrl` 지원. 로그인 화면에서 회원가입으로 넘어갈 때 `.../taste/saved` 는 `.../taste` 로 바꿔 전달 (신규 회원은 저장 취향이 없으므로 U-05 로) | UI 설계서 "U-04 가입 완료 → U-05" | `src/pages/user/LoginPage.tsx`, `SignupPage.tsx` |
| 4 | 9. 추천 데이터 전달 | `{artworkId, title, imageUrl, recommendationReason, order, floorId}` | 최소 필드 유지 + **`artist`, `roomName` 추가** | U-08 카드(작가)·U-09 다음 작품 카드(전시실)에 표시가 필요 | `src/types/domain.ts` `RecommendedArtwork` |
| 5 | 2. 라우팅 | `/exhibition/:exhibitionId` | `/` 접속 시 기본 전시로 리다이렉트 추가. 기본 전시 ID 는 `VITE_DEFAULT_EXHIBITION_ID` (기본 `mvp-2026`) | "서비스 기본 화면" 정의가 필요 | `src/config.ts`, `src/app/router.tsx` |
| 6 | A-04 | 작품 등록·수정 화면 1개 | 작품 **목록 화면(`/admin/artworks`) 추가** 후 등록(`/new`)·수정(`/:id/edit`) 분리 | 사이드바 "작품 관리"에서 수정할 작품을 고를 화면이 필요 | `src/pages/admin/ArtworksPage.tsx` |
| 7 | A-04 | 작품명·작가·연도·전시실·이미지·해설·출처·참고URL·검수 | **Guided Looking 질문 입력란 추가** | U-10 Guided Looking 탭의 데이터 출처가 필요 | `src/pages/admin/ArtworkFormPage.tsx` |
| 8 | 8. 공통 UI | 9개 공통 컴포넌트 | `QueryState`, `Chip`, `Icon` 추가 | 합의 7(상태 통일), 키워드/배지 공통화 | `src/components/common/` |
| 9 | U-10 TTS | 음성 설명(TTS) | 브라우저 **Web Speech API** 로 임시 구현 | 서버 TTS 미정. 교체 시 `useSpeech` 훅만 수정 | `src/hooks/useSpeech.ts` |
| 10 | U-09 | 지도 + 다음 작품 카드 | 지도 아래 **관람 순서 목록** 추가, 마커 탭 시 해당 작품 정보 미리보기, 위치 미등록 작품 안내 문구 | 실시간 내비가 아닌 "순서 안내" 수준을 보완 | `src/pages/user/RoutePage.tsx` |
| 11 | U-01 | 디자인에 없음 | 진행 중인 관람이 있으면 **"이어서 관람하기"** 버튼, 로그인 시 헤더에 **관람기록** 링크 | 새로고침/재진입 시 이어보기, U-13 진입점 확보 | `src/pages/user/ExhibitionStartPage.tsx` |
| 12 | U-14 | 이메일로 링크 발송 | 임시 데이터 모드에서는 발송 대신 **"(임시 데이터 모드) 재설정 링크 열기"** 링크 표시 | 메일 서버 없음. `VITE_USE_MOCK=false` 이면 표시 안 됨 | `src/pages/user/ForgotPasswordPage.tsx` |
| 13 | 4. API 응답 | - | 엔드포인트 경로는 **프론트에서 임시로 가정**한 것 (위 5번 표) | 서버 명세 미정 — 확정되면 `src/api/services/*` 수정 | `src/api/services/` |

> 새로 합의와 다르게 구현하는 부분이 생기면 **이 표에 행을 추가**해 주세요.
