# 구현 계획에서 추가로 구체화한 결정

기준 계약은 `9234371`의 [동점 계약](../taste-tie-contract-2026-11-11/README.md)이다. 아래는 이번 **계획상 설계 결정**이며 팀 합의·제품 적용 완료가 아니다. 이전 계약/반례/소스 고정 기록을 수정하지 않는다. D3·D4·D5는 이전 계약에서 부족했던 경계의 보완 제안이므로 제품 작업 승인 시 함께 확인한다.

## D1 실제 점수와 근거의 묶음

현재 FastAPI는 모델 이름을 돌려주고 Django의 tag 제공자는 scores만 남긴다. 이를 tagEvidence nullable 응답 → Django 제공자 → Artwork의 `tag_score_evidence`와 `tag_score_revision` 두 필드로 연결한다. 기존 행은 null/0이며 자동 채우기·승인·선정·재분석은 없다. 별도 모델 등록 플랫폼/벡터DB는 만들지 않는다. Django 설정의 서버 승인 signature hash 하나로 현재 비교 가능 범위를 제한한다.

원본 바이트 SHA256은 Django가 실제로 전송한 바이트와 FastAPI가 실제 디코드한 바이트 양쪽에서 계산·대조한다. URL·이름·제목의 해시로 대체하지 않는다. tagEvidence에는 모델/processor의 실제 artifact 식별,태그 프롬프트·전처리·보정·관련 라이브러리 정의를 묶은 signature,tagSource,imageSha256,inputImageFile token,sourceVersion을 보존한다. mDeBERTa 감정 provenance는 이미지 태그 provenance로 쓰지 않는다.

CLIP의 model과 processor에 같은 명시 revision을 적용하고 로더가 실제 읽은 artifact manifest를 검증한다. 로컬 폴더의 revision이 확인되지 않으면 cache 경로/모델명을 보고 추정하지 않고 근거 미확정으로 남긴다. 대용량 파일 해시는 로드 시 한 번 계산해 성공한 모델과 함께 게시한다. 재기동·실패·부분 로드의 잘못된 signature 재사용을 막는다. 기존 보정/가중치·프롬프트를 최적화하거나 바꾸는 작업이 아니다.

현재 업로드는 새 파일명을 발급하고 원본을 덮지 않는 구조다. 점수 저장 후 이미지/원문 sourceVersion·파일 token이 달라지거나 태그가 미확정이면 근거는 사용할 수 없다. 같은 경로의 원본을 수동 교체하는 운영은 허용하지 않고,그런 자료는 점수 사용을 중단한 뒤 재인수한다. 공개 GET마다10개 이미지를 다시 해싱하는 I/O는 추가하지 않는다. 실제 재분석 때 입력 바이트를 대조하고 새 revision을 발급한다.

기존 서비스에 tagEvidence가 없는 것은 호환 결측(null)이다. 필드가 존재하지만 잘못된 해시/스키마라면 분석 응답 오류로 처리하고 점수/근거/revision을 모두 저장하지 않는다. 성공한 새 분석은 suggested로만 저장하고 사람 확정 경계를 유지한다. 관리자 confirm이 없는 근거를 만들어 주거나 null을 승인으로 바꾸지 않는다. 공개 DTO에는 내부 입력·파일 경로·artifact 경로를 내보내지 않는다.

## D2 같은 DB 시점과 잠금 순서

현재 current_pool 조회와 계정 저장 전 snapshot 계산은 여러 DB 읽기로 이루어진다. `atomic()`만 감싸도 PostgreSQL READ COMMITTED의 여러 SELECT가 같은 시점이라고 보장되지는 않는다. 새 v2 경로는 짧은 transaction에서 **Account(회원 경로만) → SurveyPool ID순 전체 → 해당 Artwork ID순**으로 잠그고,그 객체 묶음 하나에서 자격·counts·poolVersion·tieContextVersion·정렬을 계산한다. 선택/preview 이후 사용자가 확인하는 동안에는 잠금을 유지하지 않고 실제 저장/추천에서 다시 검증한다.

현재 configure 명령은 풀→작품 ID순이지만 confirm_ai는 요청순으로 작품을 잠글 수 있다. 다중 confirm도 ID순으로 통일해야 한다. 단일작품 분석·업로드가 Account/Pool을 뒤늦게 잠그는 경로는 만들지 않는다. model/GPT 호출이나 네트워크 이미지 조회를 잠금 안에서 실행하지 않는다.

풀 자체가 없는 시점의 ready=false는 정상 결과다. 아직 없던 첫 활성풀과 경합하면 빈 상태 또는 새 상태 전체가 관측되면 되고 혼합된10점은 허용하지 않는다. 잠금 대기는 해당 transaction에서 최대2초로 제한하고,초과하면 쓰기 전체를 되돌린 뒤503 `TEMPORARY_UNAVAILABLE`과 동일입력 재시도 안내를 준다. 전역 DB 설정을 바꾸지 않는다. 실제 PG의 독립 연결·barrier로 풀교체/관리자 역순 confirm/점수재생성/계정쓰기 경합을 재현하며 SQLite 결과로 대체하지 않는다.

## D3 계정 저장 충돌·유실 응답·구형 쓰기

새 v2 쓰기는 outer request의 `expectedSavedProfileVersion`과 UUID `clientMutationId`를 필수로 받는다. 잠근 Account 안에서 버전/인증/계정 상태를 재확인하고 pool/점수 근거를 다시 계산한다. Account의 nullable `taste_write_receipt`에는 **마지막 한 요청**의 ID·정규 요청 hash·저장 후 버전·snapshot binding만 원자적으로 남긴다. 이벤트 저장소나 무제한 요청 이력 테이블은 추가하지 않는다.

- 같은 mutation/같은 요청이고 마지막 저장 결과와 현재 계정이 일치하면 pool을 다시 조회하기 전에204를 반환한다. 저장 응답만 유실된 재시도에서 중복 쓰기·버전 증가를 막는다.
- 같은 mutation에 다른 요청은409다. 다른 mutation은 CAS를 통과해야 하며,같은 N버전의 서로 다른 두 쓰기는 한건만204/나머지409다. 나중에 다른 저장이 이루어졌다면 오래된 요청을 성공으로 위장해 복원하지 않는다.
- UI가 같은 의미로 돌아온 경우 저장 자체를 보내지 않는 no-op이 우선이다. 서버도 현재 snapshot/선택과 정확히 같은 명시 요청을 덮어쓰지 않도록 한다. 읽기만으로 버전은 증가하지 않는다.
- v1 읽기/추천·옛 snapshot은 유지한다. 다만 **v1 요청이 이미 v2로 저장된 계정을 expected version 없이 덮어쓰는 것은409**로 거절한다. 이는 이전 계약의 포괄적인 ‘v1 유지’를 데이터 보호 측면에서 구체화한 호환 경계다. 기존 v1 계정끼리의 무버전 구형 쓰기는 과거 동작을 유지하므로 모든 구형 쓰기의 충돌을 해결했다고 주장하지 않는다. optional expected version이 있으면 v1도 CAS를 검사한다.

Account receipt 필드는 `0004_taste_write_receipt` 구조 migration으로만 추가한다. 동시성·응답유실·같은ID 다른본문·새 저장 뒤 오래된 재시도·위조 client tieEvidence는 실제 PG API 시험을 통과해야 한다.

## D4 관람 중 조사풀 교체와 영수증

현재 records.canonical도 profile_snapshot을 호출한다. 따라서 새 picks의 현재풀 검증을 그대로 재사용하면 **관람 도중 풀이 바뀐 뒤 영수증 저장이 막힐 수 있다.** 반대로 클라이언트가 보낸 counts/snapshot을 그대로 믿는 해결은 금지한다.

새 resolve의 읽기 전용 결과에 별도 `visitEvidenceReceipt`를 붙이는 소규모 방식을 계획한다. Django signing으로 purpose=`arti.taste-visit-evidence.v1`,버전1,actor(user ID 또는 guest),클라이언트가 정한 새 visit UUID,서버 정규화 snapshot·binding·발행시각을 인증한다. 상한8KiB·유효72시간이다. 기존 Django 서명키를 쓰되 키값을 응답/기록에 노출하지 않는다. 새 DB preview 행·모델 호출·새 인증 수단은 만들지 않는다.

이 증거는 **해당 시점에 계산한 취향 근거의 진위 확인만** 한다. 사람 검수·콘텐츠 승인·계정 저장·실제 관람 완료를 뜻하지 않는다. 새 추천/계정 저장은 이 증거가 있어도 현재 pool/tieContext/CAS를 다시 검증한다. 영수증 신규 저장에만 `tasteEvidenceReceipt` outer필드로 전달하여 목적/actor/visit/선택집합/바인딩/유효기간을 확인하고 당시 counts를 복원한다. 현재 계정 취향을 덮어쓰거나 현재풀의 새 선택으로 해석하지 않는다. guest 증거로 회원 기록을 만들 수 없고 회원은 기존 bearer 인증이 별도로 필요하다.

같은 visitId로 이미 저장한 동일 원문 재시도는 기존 check_retry 경로를 먼저 적용해 expiry/현재풀 조회에 앞서 반환한다. 다른 body/visit/actor,위변조·만료 증거는 거절하고 원래 pending payload는 보존한다. 재시도할 때 새 token으로 요청 body를 조용히 바꾸지 않는다.72시간 이후 최초 저장이나 키 교체로 검증 불가하면 명시 재확인/로컬 보존으로 안내하며 데이터를 지우지 않는다. 원래 전시 공개 조건·작품 소속 검증·회원/비회원 기록 정책은 유지한다.

구형 v1의 새 영수증은 과거 방식,기존 저장 기록의 재시도/조회는 그대로다. 이 설계는 기존 동점 계약의 ‘preview가 승인 토큰이 아님’과 양립하며,방문 기록용 근거를 **별도 목적**으로 보존하는 추가 설계다. 사용자/팀의 제품 작업 승인 전 발행하지 않는다.

## D5 기능 켜기와 되돌리기

새 서버는 알려진 profile 형식1/2를 읽되 `ARTI_TASTE_PROFILE_V2_ENABLED=false`를 기본으로 둔다. GET의 `supportedTasteProfileVersions`와 별도 `tasteTieV2Enabled`를 구분한다. 프론트는 둘 다 확인해야 새 v2를 생성한다. 설정 문자열만 보고 v2가 동작 중이라고 표시하지 않는다.

disable은 **새 v2 생성/preview/새 v2 쓰기/새 picks 추천**을 막는다. 기존 v2 저장 취향의 frozen 순서 읽기·관람증거 검증·이미 성공한 mutation 재시도·기존 영수증 재시도는 유지한다. disabled 응답은503 `FEATURE_DISABLED`,재조회가 필요한 버전변경은409로 구분하고 입력을 보존한다. v1이v2계정을 덮는 우회는 허용하지 않는다. 기능을 끄면 v2를 이해하지 못하는 옛 서버 바이너리로 무조건 되돌려도 된다는 뜻이 아니다.

추가 schema는 되돌릴 때 남긴다. 실행 취소는 enable/클라이언트 생성경로부터 적용하고 기존 읽기 코드를 보존한다. API/runtime 이미지 교체는 양쪽이 저장된 v2를 읽는지 확인한 뒤 한다. 열람만으로 v1으로 강등하거나 live DB를 역마이그레이션하지 않는다. 일반 arti-dev에는 이번 계획과 후속 격리시험 중 enable을 적용하지 않는다.

## D6 프론트 초안·확정·팀 UI 인수

v2는 선택 초안/preview/사용자확인/저장/현재관람 반영을 분리한다. 초안은 actor·현재 visit/requestGeneration·editRevision에 묶는다. 바뀐입력/계정/관람의 늦은 preview·PUT·api.me 응답은 현재관람에 적용하지 않는다. 인증 토큰의 값이나 지문을 화면/진단에 기록하지 않는다.

새관람 후보 UUID는 미확정 draft에서 안정적으로 생성하되 실제 visitId는 확인 성공 전 dispatch하지 않는다. 같은 의미의 선택으로 복귀하면 기존 visitId/추천/반응을 유지하고,새 UUID에 발급된 증거로 기존관람을 바꾸지 않는다. source·선택집합·서버 counts/원래 picks/조사·동점근거 버전 등 의미가 같아야 no-op이다. 단순 배열순서 차이는 무시한다.

회원은 preview 성공 → 실제 변경과 새관람 확인 → CAS 저장 → 최신 계정 확인 → actor/editRevision 재확인 → 확정 dispatch 한 번 순서다. PUT 성공 뒤 api.me 실패는 저장실패로 단정하지 않고 동일 mutation 확인/재조회로 분리한다. 이때 기존 관람을 지우지 않는다. 사용자가 명시적으로 ‘이번 관람만’ 선택하면 유효 preview/visit 증거로 관람만 반영하며 계정 재저장은 하지 않는다.409 후 다른 그림으로 자동 매핑·manual/v1 자동 전환은 없다.

같은 시간의 빠른 복귀·전역 조사 API·contain 전체이미지·원문/요약 문단·닉네임100자와 회귀를 보존한다. 전역풀로 이미 구현된 부분을 ZIP의 전시별 호환 별칭으로 되돌리지 않는다. ZIP의 danger/warn/error-text·이유강조/헤더 hunk만 선택 후보이며,동섭님 종합본의 기준 commit과 작업 파일을 다시 확인하기 전 UI hunk 적용을 보류한다. 그 회신 없이 TP1·TP2의 독립 작업은 진행 가능하다. 새주제/팔레트 재설계·토너먼트·대표3강제·U16은 범위 밖이다.

## D7 실행·검증·기록 경계

`0003`/`0004` 번호는 현재0001/0002 기준 제안이며 실제 착수 때 새 migration 충돌을 재확인한다. 적용된 migration 파일을 수정/재번호 매기지 않는다. 각 단계는 확장/하위호환을 먼저 준비하고 해당 단계 통과 뒤 다음 단계로 간다. 통과하지 못한 증거를 pass로 적거나 작은참조검사로 PG/실브라우저 인수를 대신하지 않는다.

기존 CI4job은 유지하고 해당 테스트가 자동 수집되는지 확인한다.실제 HF 가중치는 일반 CI에서 받지 않고 fake 계약/로딩 시험을 돌린다. 실제 cached 모델1회는 로컬 격리 검증에 따로 기록한다. GPT0·새작품선정0·일반DB쓰기0·원격push0이며,실제 GitHub Actions는 별도 push 후에만 통과라고 기록한다.

이번 문서의 verify는 계획/과거 소스 추적용이다. `--planning-worktree` 검사는 **제품 미적용을 검증하는 이번 시점 전용**이며 후속 구현 후 CI에 강제하지 않는다. 과거 소스는 pinned commit으로 검증하고 후속 작업에는 별도 실행 기록/새제품회귀 증거를 남긴다. 기존 W/G/AC 인수나 실제 사람 검수 상태를 이 계획으로 승격하지 않는다.
