# W02 개발 계약 v1 — 실제 ae0e58e에서 전환할 규격

2026-11-08 KST. 작성/개발 결정: 준억의 요청에 따른 통합 작업과 AI 보조. 본문은 **이번 개발에서 채택할 규격**이며 과거 팀 최종합의·구현 완료를 뜻하지 않는다. G1 판정은 gate-review.md와 execution.json을 따른다. 기준은 source-inventory.json의 SHA와 소스 해시다. 초안보다 이 문서가 우선한다.

## 1. 유지와 변경 경계

- React 화면 구조·U10 두 탭·8취향/6감정·/api prefix·현 URL·문자열 외부 ID·좌표0~100을 유지한다.
- Django/DRF + PostgreSQL + Docker로 서비스 API를 전환한다. FastAPI는 CLIP/mDeBERTa 모델의 별도 로딩/자원 경계로 유지한다. 생성형 챗봇/요약/가이드는 서비스 API의 provider 어댑터를 통해 외부 LLM을 호출한다. 새 벡터DB·학습·실내측위는 도입하지 않는다.
- 현재 U05는 앞 최대10점/인접 최대5독립쌍이며 직접 태그 편집 UI는 없다. U06 수정도 U05 재실행이다. 이를 토너먼트나 새 태그 편집 화면으로 바꾸지 않는다. 추천에 빈도를 반영하는 최소 개발 선택은 아래에 고정하며 최종 팀 UX 합의 도착 시 영향 검토한다.
- 공개 제한, 관리자 읽기 분리, 빈도 보존, 방문 중복방지, 대화 맥락 전달은 의도적 변경이다. Express에 같은 기능을 먼저 완성하지 않는다.

## 2. API 경로와 화면 영향

모든 경로는 /api 기준이다. 정적 등록과 직접 호출의 실제 개수/소스 행은 source-inventory.md와 contract-check.json에 있다. 기존 경로는 method까지 해당 인벤토리를 따른다. 별도 표시 없는 성공 응답은 기존 JSON object/array 형태와 필드명을 유지한다. 이 표는 요구 경로 전체를 포괄하며 서버 전용 /auth/me도 포함한다.

| 영역/화면 | 유지 경로 | 목표 차이/추가 |
| --- | --- | --- |
| U01/05/08/09/10 | GET /exhibitions, /exhibitions/:id, /artworks, /artworks/:id, /exhibitions/:id/tag-coverage | 공개 DTO/상태 제한. /artworks?exhibitionId 검증. coverage는 현재 추천 가능 후보 수 |
| A02~05/07 | 현재 위 공개 조회를 공유 | **GET /admin/exhibitions, /admin/exhibitions/:id, /admin/artworks, /admin/artworks/:id** 추가. 관리자 helper로 모두 전환. 회원/guest는 접근 불가 |
| U05 | 현재 listArtworks 앞10점 | **GET /exhibitions/:id/taste-pool** 추가: {poolVersion,ready,pairs:[{leftId,rightId}],artworks:PublicArtwork[]} |
| U03/04/13 | POST /auth/signup, /auth/login, /auth/logout; GET /auth/me; PUT /users/:id/tastes | token 형식 유지. /auth/me를 앱 bootstrap에 사용. tastes와 선택 출처 저장 확장 |
| U14/15 | POST /auth/password-reset/request, /auth/password-reset/confirm | 실제 메일 없이 발송 완료를 표시하지 않음. 1차 전환에서 기능 비활성501 FEATURE_DISABLED, 화면 안내/로그인 복귀. demoToken/로그 토큰 출력 제거 |
| U08 | POST /recommendations | 기존 tastes/duration 유지, 선택적 tasteProfile 추가. score 의미는 빈도가중 평균으로 명시 |
| U10 기존 미노출 개인화 | POST /artworks/:id/explanation | 호환 경로 유지, 승인자료+provider 사용, {text,mode,sourceRefs}; 새 탭 추가 없음 |
| U11 | POST /artworks/:id/ask | {question} 유지, visitId/entryContext/history 추가, {answer,mode,sourceRefs} 응답. history 자동 DB 저장 없음 |
| U12 | POST /visits, /visits/interpret; GET /visits/:id; GET /users/:id/visits | visitId 필수, persisted 명시. 저장/AI 분리, 소유자 검사 |
| A01/06 | POST /admin/login, /admin/logout; GET /admin/members?q=, /admin/members/:id/visits | 관리자 인증·회원 조회 유지 |
| A03~05 | POST/PUT /admin/exhibitions(/:id), /admin/artworks(/:id) | 별도 version 충돌검사, 서버필드 조작 금지, 검수/stale 규칙 |
| A04/05 | POST/DELETE /admin/artworks/:id/image, /admin/exhibitions/:id/floor-plan | raw PNG/JPEG/WEBP≤10MiB 유지, 권한/파일 공개 조건 추가 |
| A04 | POST /admin/artworks/:id/analyze | 산출물별 확정 보호, 부분실패 보고. 새 결과는 suggested |
| A04 전시분석 | POST /admin/exhibitions/:id/analyze | 1차는501 FEATURE_DISABLED와 UI 비활성/개별분석 안내. 수십 작품 동기 호출과 새 작업큐 도입을 피함. 한 작품 분석이 필수 흐름 |
| A04 전시확정 | POST /admin/exhibitions/:id/confirm-ai | 명시적 검토 목록 {items:[{id,version,fields:[...]}]} 필수. 빈본문400, 전시불일치400, stale409 전체무변경. 검토하지 않은 전작품 자동확정 없음 |
| A07 | 현재 browser reactionLog | **GET /admin/reactions?exhibitionId=** 추가. 회원이 저장한 visit의 반응/이유 중앙 조회, guest 수집으로 확대하지 않음 |
| 공통 | GET /health, GET /uploads/:file | health는 process 상태, **GET /ready**는 DB준비. 파일은 아래 권한 규칙 |

프론트 변경 요약: 관리자 읽기 helper 분리, askAI 반환값을 string에서 결과 object로 전환, saveVisit의 persisted 확인, 추천/저장 profile 추가, 버전/오류 처리. 기존 화면·경로와 원문/요약/가이드 표현은 유지한다. 재현 방법은 cases.json 및 W03 검사에 연결한다.

## 3. 기본 타입·모델·오류

- 외부ID: 1~64자 문자열, 기존 ID를 유지하고 DB 내부 키와 분리 가능. year는 문자열 유지. 날짜 YYYY-MM-DD, 관람 date/createdAt은 timezone 포함 ISO8601 UTC. 숫자는 유한값, null과 빈 배열/빈 문자열을 혼용하지 않는다.
- TasteTag 고정: landscape,people,abstract,light,vivid,cool,warm,soft. EmotionKey: calm,joy,sadness,tension,awe,nostalgia. score는0~1, emotion은 추천 입력 아님.
- 좌표는 x/y 각각0~100. roomId는 같은 전시 rooms 중 하나 또는 빈문자열(미배정); position null은 지도/추천 후보 제외. 도면 width/height는1~20000 정수 픽셀. 통로/축척 미검증이면 최단동선·실제 이동시간이라고 설명하지 않는다.
- 모델 최소 단위: Exhibition, Artwork, role 구분 Account/Session, Visit, VisitReaction, 작품의 AI 산출물 및 검수/버전. 선택 원본과 프로필은 Visit JSON snapshot 가능. 필요 없는 회원/세션 전체 이관이나 채팅 DB는 만들지 않는다.
- Artwork/Exhibition **version**은 변경마다 증가하는 정수(초기1), updatedAt은 표시용으로만 사용한다. 기존 날짜 문자열은 충돌 토큰으로 사용하지 않는다. PUT는 전체 편집 payload+version 필수, 누락 필수필드는400으로 거부하고 default로 지우지 않는다. 파일/분석/AI점수/updatedAt은 서버 소유; 기존 전체 DTO에 실려와도 쓰기에서 무시하며 분석은 전용 경로에서만 갱신한다.
- version 전달 위치: JSON PUT/analyze는 body.version, 기존 레코드의 raw image/floor-plan POST와 DELETE는 **If-Match: "5"**처럼 현재 정수 version을 담은 quoted ETag를 사용한다. 빠짐/잘못된 형식400, 불일치409이며 파일쓰기/삭제/분석호출 전에 검사한다. GET/수정응답은 body.version과 ETag를 함께 제공한다. 최초 POST생성에는 version/If-Match가 필요 없다. CORS 허용 헤더에 If-Match, 노출 헤더에 ETag를 포함한다.
- sourceVersion은 title/artist/year/description/source/referenceUrl/imageUrl/imageFile 변경 때 증가한다. 생성 입력인 사실필드도 승인근거에 포함한다. 전시 이동(exhibitionId 변경)은 새 전시의 출품/근거를 재검수하고 sourceVersion을 증가시킨다. 콘텐츠 종류별 revision(summaryRevision/guideRevision)은 해당 값 또는 확정/해제 시 증가. 공개 **contentVersion**은 노출 가능 내용/상태 변경 때 증가한다. 모두 양의 정수. 관리 버전이 먼저 일치해야 갱신 가능하다.
- 오류 JSON: {error:string,code:string,retryable:boolean,requestId:string}, fieldErrors는 선택. error 문자열 호환 유지. 400 VALIDATION_ERROR,401 AUTH_REQUIRED/SESSION_EXPIRED,403 FORBIDDEN,404 NOT_FOUND,409 VERSION_CONFLICT/CONTENT_CHANGED/IDEMPOTENCY_CONFLICT,413 PAYLOAD_TOO_LARGE,415 UNSUPPORTED_MEDIA,429 RATE_LIMITED,501 FEATURE_DISABLED,502 PROVIDER_ERROR,503 AI_UNAVAILABLE,504 AI_TIMEOUT. 입력/권한 오류는 자동재시도 안 함. 429는 Retry-After 제공. 알 수 없는 오류는500/재시도 안내이며 비밀/내부 stack을 보내지 않는다.

## 4. 공개·검수·파일

| 상태 | 공개 목록/상세/도슨트/신규 추천 | 관리자 |
| --- | --- | --- |
| exhibition draft | 목록 제외, 직접 URL/API404 | 인증 후 전체 편집/미리보기 |
| exhibition running | approved 작품만 | 전체 |
| exhibition closed | 목록 제외·공개 신규이용404, 과거 회원 영수증 snapshot은 소유자 조회 가능 | 전체 |
| artwork pending/source_check | 모든 공개 GET/ask/explanation/interpret근거 제외/404 | 전체 |
| artwork approved, position null | 감상 상세 가능, 추천/coverage 제외 | 위치 준비 표시 |
| approved + AI suggested/none | 승인 원문·수동검수 태그만, 미확정 AI값은 제거 | 초안 및 검수정보 |

PublicArtwork는 기존 UI가 사용하는 필드를 유지한다. 비공개 요약은 summary:'',summaryKeywords:[],summaryStatus:'none'; 비공개 가이드는 guideIntro:'',guidedLooking:[],guidedHints:[],guideStatus:'none'. analysis는 확정 감정만 최소 모델정보와 함께 제공하고 미확정 tag score/imageError 등 내부 결과 제외. tagScores는 confirmed일 때만, 그 외null. public status는 none/confirmed만 노출하고 원본 suggested 텍스트를 UI에 숨겨서만 보호하지 않는다. sourceVersion/contentVersion/guideRevision은 공개 참조용으로 제공한다.

위 sourceVersion 대상 사실필드/원문/출처/이미지 변경 시 sourceVersion 증가, reviewStatus=source_check, 기존 confirmed AI를 suggested로 내리고 공개/모델근거에서 제외한다. 같은 수정 요청에서 approved를 보내도 재승인하지 않는다. 새 버전을 조회한 별도 관리자 검토 요청으로 approved로 돌린다. 직접 승인한 태그는 해당 승인 sourceVersion에 묶는다. 도면 교체 시 좌표 재확인 필요를 표시하고 기존 좌표를 실제확인된 것으로 승계하지 않는다.

분석은 summary/guide/tag/emotion 각각 confirmed이면 기본 보존한다. 확정 항목의 재생성이 필요하면 {regenerateFields:[...],version} 명시 요청으로 해당 항목만 suggested 초안으로 바꾼다. 다른 확정 항목은 유지. 분석 중 원본/version이 바뀌면409로 결과 쓰기를 거부한다. guide/hints 길이는 맞춰 빈힌트를 허용하며 확정 가이드는 내용이 있어야 한다. 수동 작성도 명시 확정해야 노출된다.

파일 URL의 파일명을 아는 것만으로 비공개자료 접근을 허용하지 않는다. 공개 running/approved 및 showImage=true에 연결된 이미지/공개도면만 무토큰 열람. 그 외 admin 또는 내부 모델용 인증 경로에서만 읽는다. showImage=false이면 공개 DTO imageFile=null/imageUrl=''로 반환하고 공개 파일도404. 직접 외부URL은 관리자 승인 입력만 허용, 서버의 임의 URL fetch 금지; 모델 입력은 통제된 업로드 복사/허용된 출처로 제한한다. S3 객체키와 전달 URL은 분리하며 구체 저장소는 W12에서 결정한다.

## 5. 취향·추천·진행 상태

- ready pool은 같은 전시의 공개 승인+표시 가능한 실제이미지+검수된 태그가 있는10점을 외부ID 오름차순으로 고정한5독립쌍이다. poolVersion은 ordered IDs+태그/이미지 관련 버전으로 생성한 불투명 식별자. curated pool 도입은 최종 UX 합의 시 변경기록한다. 전시 앞10점의 우연한 DB 순서 의존은 제거한다.
- 10점 미만이면 ready=false,pairs:[]와 준비부족 안내. 1~4쌍을5쌍 완료처럼 저장하지 않는다. 재시도/이전 제공, 유효한 저장취향이 있는 회원은 U06 기존취향 경로로 진행 가능. 임의 작품/다음태그 자동 대체는 안 한다.
- tasteProfile={version:1,source:'picks'|'saved'|'manual',poolVersion:string|null,picks:[{pairIndex,artworkId}],counts:8태그 정수map,selectedTags:TasteTag[],savedProfileVersion?:positiveInteger}. source=saved는 savedProfileVersion 필수이며 서버의 본인계정 snapshot을 쓴다. source=picks는 같은 pool 각쌍 한개씩5개 필수. 선택 ID 중복/다른쌍/미검수/버전변경은400 또는409. 서버가 pool snapshot의 승인 태그로 counts를 재계산한다. 클라이언트 counts를 권위로 사용하지 않는다.
- 현재 없는 직접 편집 UI를 추가하지 않는다. manual은 향후 또는 기존 외부호출의 명시 태그 입력이며 picks:[],poolVersion:null,counts는0으로 표시해 선택 이력과 구별한다. 존재하지 않는 원본을 만들지 않는다.
- **새 선택과 저장취향 재사용은 구분한다.** source=picks만 현재 전시/pool의5쌍·버전을 검증한다. 회원 저장은 PUT /users/:id/tastes에 {tastes,tasteProfile?}를 받고 검증된 snapshot과 증가하는 tasteProfileVersion을 계정에 보존한다. User응답에도 해당 version과 profile을 제공한다. U06 재사용은 source=saved,savedProfileVersion을 보내고 서버가 인증된 본인 계정의 그 버전을 조회한다. 불일치409, 무회원401. 다른 전시/새pool이어도 원래 선택 provenance(originExhibitionId/originalPoolVersion/originalPicks)는 보존하고 **현재pool 선택으로 재검증하지 않는다**. 클라이언트가 보내는 saved counts/picks는 신뢰하지 않는다. 원래 빈도는 서버snapshot에서 재사용, 레거시 tastes[]만 있으면 picks:[],counts:0의 균등가중. guest는 saved가 아닌 현재picks 또는 manual 계약을 쓴다.
- PUT /users/:id/tastes 성공응답은 기존204 유지, 저장된 profile/version은 GET /auth/me에서 다시 읽는다. 저장실패를 현재관람 실패로 묶지 않되 “이번 관람에 적용됨/계정 저장 실패”를 구분하고 재시도를 제공한다.
- 선택빈도는 distinct 작품별 태그 출현수. selectedTags에 대해 rawWeight=counts[tag]>0?counts[tag]:1, 정규화 weight=rawWeight/합계. manual/과거 saved는 모두1로 균등. selectedTags 밖 weight0. API tastes와 selectedTags 불일치400. 빈 tastes는 전체 후보 균등0점의 일반 추천이며 개인화라고 표시하지 않는다.
- score=Σ(weight[tag]×tagStrength[artwork,tag]), 기존 confirmed tagScores 또는 승인 수동태그1/0 사용. 0.5 threshold 유지. 태그 대표 확보 순서는 weight내림차순→고정TAG_KEYS, 각태그 최상위 미선택 후보 추가 후 score내림차순→외부ID로 채움. 시간별3/5/7점, 후보가 적으면 가능한 수만+안내. 이후 기존 좌표 최근접 순서. 최단보행 주장은 하지 않는다. 출력 Recommendation[] 형태/score 3자리 반올림 유지. 빈도가 바뀌어도 최종 목록이 반드시 달라야 하는 조건은 없다.
- 취향/시간 변경은 추천 무효화+requestGeneration 증가, 이전 응답은 폐기. 아직 startedAt 전에는 진행 초기화. 관람 시작 후 변경은 기존 기록 소실 안내와 명시적 새관람 선택 후 새visitId; 취소하면 기존 유지. 전시/계정 변경·logout도 경계를 초기화한다. 단순 같은작품 왕복·새로고침은 유지한다.

## 6. 인증·계정·관람 식별

- 현 회원 opaque Bearer와 관리자 X-Admin-Token 유지. 서버는 무작위32byte 이상 토큰을 발급하고 해시만 저장, 14일 절대만료(재발급 정책 없이 만료 시 로그인). JWT·OAuth·쿠키세션으로 동시 변경하지 않는다. HTTPS는 운영 필수, 저장키는 현재 frontend 호환. 추후 HttpOnly전환은 별도 계약변경.
- 사용자 경로는 Bearer, 관리자 경로는 X-Admin-Token만 인증. 둘이 함께 와도 admin token이 회원 저장의 userId를 대체하지 않는다. 회원/관리자 logout은 해당 세션만 폐기. inactive/dormant는 로그인401 및 기존세션 무효화. /auth/me 만료 시 React user와 활성 방문/대화 캐시를 제거하되, 아래 pendingReceipt 복구 예외는 유지한다.
- 보호 경로는 타인403, 무인증401. 공개 경로는 불필요한 만료 user토큰 때문에 감상을 차단하지 않지만 UI에서 /auth/me로 만료를 복구한다. **POST /visits는 토큰 없음 guest, 토큰 제공했으나 무효면401**이며 guest로 조용히 강등하지 않는다.
- 새 계정은 Django 기본 hasher. 기존 계정은 기본 인수대상이 아니며 고유내용 중심 이관. 계정 보존이 명시적으로 필요하면 Node scrypt$hexsalt$hexhash를 bounded legacy verifier로 검증하고 성공 로그인 시 재해시; N=16384,r=8,p=1,dkLen=64,salt16byte만 허용. 미검증 포맷은 unusable로 두고 실제 재설정 수단 확인 전 로그인 가능이라 표시하지 않는다. 실제 호환검사는 AC17, 기존 세션은 이관하지 않는다.
- visitId는 브라우저가 최초 관람 상태 생성 시 발급하는 UUIDv4, 새관람·전시/계정변경 시 교체. 권한 토큰이 아니다. 회원DB 유일성은 (인증 userId,visitId), guest는 sessionStorage 격리키만 사용. 로그아웃/계정전환에는 이전 chat/영수증/UI복귀 캐시 제거. HTTP LAN에서도 안전 난수 생성 지원을 확인하며 불가능하면 명시 오류를 낸다.

## 7. U10→U11 대화·복귀

요청: {question(1~500자),visitId,entryContext?,history?:[{role:'user'|'assistant',text}]}.

entryContext={tab:'desc'|'guided',kind:'original'|'summary'|'guide'|'generic_tip',contentVersion,questionIndex?:0부터정수,tipVersion?:'basic-v1',excerpt?:{start,end}}. questionIndex는 guide/generic_tip에서만, excerpt는 original/summary에서만 사용한다. 범위는 해당 서버 텍스트의 Unicode code point offset, 최대500자. string[]의 질문 ID가 이미 있는 것처럼 기록하지 않고 **contentVersion+questionIndex**로 식별한다. 기본팁은 서버 보유 basic-v1 index0~2로 재조회한다.

서버는 URL artworkId의 현재 공개 승인자료로 맥락을 재구성한다. 클라이언트가 질문 원문/공식 출처를 덮어쓸 수 없다. contentVersion 불일치409 CONTENT_CHANGED이면 UI가 자료를 재조회하고 맥락이 변경됐다고 안내한 후 확인된 새맥락으로 재시도; 자동으로 기존 질문을 다른 질문으로 해석하지 않는다. 기존 {question} 단독 요청도 승인 작품의 일반질문으로 허용하지만 새 frontend는 visitId와 context를 보낸다.

history는 현재 actor/visit/전시/작품/contentVersion의 **성공한 최근4왕복(최대8메시지, 각1000자, 총8000자)**. system/tool 역할은400. 실패안내·typing·중복 재시도·초기환영문은 history 제외. 과거 assistant 발화도 공식근거가 아닌 대화참고이며 서버 승인자료가 우선한다. 관찰이 없으면 만들어내지 않는다. 내용 속 지시문으로 권한/근거 범위를 바꾸지 않는다.

응답: {answer,mode:'llm'|'fallback'|'refusal',sourceRefs:[{artworkId,sourceVersion,kind:'original'|'summary'|'guide',revision}],requestId}. sourceRefs는 실제 사용 승인자료만, 거절/일반팁은[] 가능. fallback은 명시된 비생성 관찰팁/서비스안내이며 “AI 응답”으로 표시하지 않는다. provider 키없음503,오류502,timeout504를 규칙답변으로 성공 위장하지 않는다. 자료밖 질문은200 refusal/확인불가 안내, 작품의 구체사실을 임의 생성하지 않는다.

UI는 관람가이드 “내 생각 이야기하기”, 작품해설 “이 부분 더 알아보기”로 현재 질문/구간을 보이게 전달한다. 관찰 입력란을 새로 강요하지 않는다. 선택 구간이 없으면 해당 원문/요약 전체 맥락으로 진입. U11 첫 안내에 이어받은 질문/해설을 표시하되 모델이 자동 답변한 것처럼 저장하지 않는다.

캐시 키는 actorKind/actorId-or-guest/visitId/exhibitionId/artworkId/contentVersion. U10 tab/summaryOn/expanded/openHints/scroll을 같은키에 저장, DOM복원 후 scroll 복원. 새 contentVersion은 낡은 대화근거를 보내지 않고 새 맥락 안내; tab 선호는 유지 가능하나 hints/excerpt는 초기화. 실패 시 입력 보존+재시도, 동일 pending 요청 재전송 금지·늦은응답 폐기. easily/deeply 요청은 사용자 question으로 표현, 새 수준설문/취향 기반 이해수준 추정 없음.

## 8. 기록·중복·영수증

POST /visits는 기존 VisitRecord 입력에 visitId,tasteProfile,reactionReasons,dwell,selectedDuration,requestGeneration을 추가. userId/exhibitionTitle/venue/interpretation/emotionProfile는 클라이언트 권위가 아니며 서버가 인증/전시/승인자료로 결정한다. viewedArtworkIds 최대200 중복제거, reactions/reasons/dwell 키는 같은 전시 viewed에 속해야 하고 사유≤500자,dwell0~86400초. 나중에 폐쇄/삭제된 작품의 최소 title/artist/year snapshot은 저장시 보존해 역사조회가 현재공개 catalog에 의존하지 않게 한다.

- 회원 최초201 {기존 record필드,persisted:true,visitId}, 동일payload재시도200 같은 id/persisted:true. canonical payload(날짜·선택·반응·시간 등)는 최초영수증 진입에 고정. 같은 (userId,visitId) 다른payload는409 IDEMPOTENCY_CONFLICT·기존기록보존. 동시 POST는 DB unique+transaction으로1건. actor는 본문 userId로 바꾸지 않는다.
- guest200 {기존 record필드,id:visitId,userId:null,persisted:false}. DB Visit/Reaction 저장0건. “이 기기의 현재 관람에서만 확인할 수 있어요”와 이미지저장 제공. 회원 자동이관/강제가입 없음. 명시적 로그인은 기존 진행을 초기화한다.
- 회원 저장은 AI 해석 전에 수행한다. persisted:true 확인 전 saved 표시 금지. 실패/401에는 actor+visit별 고정 payload 보존+재시도; 종료 버튼은 미저장 안내 후 명시적으로 나가기 가능, 저장완료라고 표시하지 않는다.
- 만료/저장실패 시 **pendingReceipt**를 활성방문과 별도의 sessionStorage namespace에 원래 userId+visitId로 보존한다. 같은회원 재인증을 확인한 뒤 사용자에게 명시적 복구/저장 재시도를 제공하며 새관람으로 자동편입하지 않는다. 다른 계정 로그인이나 명시 logout에는 해당 pendingReceipt도 제거/복구금지, 일반 로그인 시 진행초기화 원칙과 구분한다. 이탈 전 미저장 안내를 주며 영구/교차기기 복구를 보장하지 않는다. 새로고침으로 토큰이 이미 제거돼도 pendingReceipt를 guest로 POST하지 않는다.
- /visits/interpret는 {exhibitionId,visitId,viewedArtworkIds,reactions,dwell}. 공개 승인/확정 감정만으로 text/emotionProfile/source(mode호환)를 계산, 실패가 방문저장에 영향 없음. 회원은 저장된 자기visit의 canonical본문과 일치해야 하고 성공 시 interpretation만 별도 갱신; 최초관람본문 idempotency는 변하지 않는다. guest 결과는 DB에 쓰지 않는다. UI 새로고침/재시도에 cached해석과 저장상태를 구분한다.
- 재해석 중·실패 후에는 마지막 성공 해석과 해당 PNG를 유지한다. 성공 응답을 받으면 해석 캐시·화면을 갱신하고 PNG를 다시 준비한다. 준비 중에는 이전 PNG를 새 내용으로 표시해 저장하지 않는다. 해석 재시도는 관람기록 POST를 반복하지 않는다.
- 관리자 회원 선택은 `GET /admin/members/:id/visits`와 `X-Admin-Token`으로 저장된 관람기록을 읽는다. 일반 회원용 `/users/:id/visits`의 본인 제한은 그대로 유지한다. 관리자 목록은 최근 가입순 최대 100명이며 이메일·닉네임 검색을 지원한다. 미존재 회원·관리자 계정의 회원 기록 조회는 404, 관람이 없는 회원은 빈 목록, 조회 실패는 오류로 구분한다.
- GET 과거영수증은 소유자 또는 admin만. closed전시도 저장된 최소snapshot으로 표시. /admin/reactions는 VisitReaction의 회원 관람 데이터만 paging(기본50,최대100); 다른 기기의 저장결과가 보이는지 AC30에서 검증한다. 전체 guest행동추적 기능으로 확대하지 않는다.

## 9. Provider·시간·trace 경계

서비스 내부 인터페이스: generateSummary(승인source snapshot)→{summary,keywords}; generateGuide(snapshot)→{intro,questions,hints}; answer(snapshot,entry,history,question)→{answer,sourceRefs}; interpret(확정profile)→{text}. 모델이 요청/권한/검수 상태를 정하지 않는다. 생성결과는 스키마 검증 후 suggested, 승인원문이 없으면 생성하지 않고 준비상태로 둔다. 기존 Kanana는 선택적 실험 코드로 보존만 하며 기본 호출 경로에서 제외한다.

로컬 계약 기본 상한: text provider25초, browser ask35초; 개별 태그/감정60초, 개별 admin분석 전체75초/browser90초. 준비되지 않은 모델은503로 빠르게 실패. 재시도는 버튼으로만, 원치 않는 중복 유료요청 자동재시도 없음. 일괄분석 비활성 때문에 수십 작품 단일요청이 없다. 이는 품질 목표/실측치가 아닌 초기 hard timeout이며 W06의 사전 지연목표·W07 실측·W12 프록시 예산과 맞춰 공개 전에 재확정한다.

현재 프록시 없는 로컬 계약에서 rate limit은 로그인10회/분/IP, AI20회/분/IP·endpoint군, admin분석 동시1개로 시작. 배포에서 프록시 IP·다중프로세스 공유방식은 W12에서 결정하고 W08에서 우회검사한다. 요청/응답에 requestId만 추적, 비밀/개인 대화 원문을 기본 로그로 수집하지 않는다. 한작품 trace에는 입력 선택/빈도/시간·수식/버전·승인근거·U10맥락·실제출력/mode를 연결하고 모델 내부추론은 수집하지 않는다.

## 10. 결정 완료와 남겨둘 입력

D00은 사용자확정, D01~D08/D11은 이 개발 계약으로 채택한다. D03의 최종 UX 합의, D09 AWS/예산, D10 실제평가기준/모델선택, D12 실제 CI/CD권한·트리거는 해당 후속과업에서 확인한다. 고유 DB 회신 미도착은 원본 보존·새 개발 DB 사용으로 W02를 막지 않으며 AC17을 통과시키지도 않는다.

개발 결정 변경조건: 팀 U05/06 합의·실자료 형식·실제 provider 제한·계정인수 요청이 도착하면 영향 F/AC/예시를 먼저 갱신한다. 테스트후 목표를 낮추는 방식으로 통과시키지 않는다. 판단 대안/영향/되돌림은 decisions.md를 본다.
