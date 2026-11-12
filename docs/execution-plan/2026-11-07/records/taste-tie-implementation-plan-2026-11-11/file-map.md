# 단계별 변경 파일 지도

모두 미래 변경 대상이다.현재파일/신규예정/앞단계생성예정을구분하며 이번에는제품파일을수정하지않는다.신규migration번호·실행기록날짜는실제착수시확인한다.

## TP1 점수 출처 저장

| 파일 | 구분 | 변경 목적 |
| --- | --- | --- |
| [ai-service/app/config.py](../../../../../ai-service/app/config.py) | existing | CLIP revision pin과 메타데이터 생성 설정;기존 NLI/추론 파라미터 유지 |
| [ai-service/app/analyzer.py](../../../../../ai-service/app/analyzer.py) | existing | 실제 로드 artifact/processor와 태그 프롬프트의 출처를 로딩 완료 시 게시 |
| [ai-service/app/main.py](../../../../../ai-service/app/main.py) | existing | nullable tagEvidence 응답 추가,분석과 동일 calibration/이미지 바이트에 결합 |
| [ai-service/app/image_fetch.py](../../../../../ai-service/app/image_fetch.py) | existing | 디코드 전 실제 수신 원본 바이트 SHA256을 추적;이미지 처리는 유지 |
| `ai-service/app/provenance.py` | proposed_new | 정규 signature/해시 구성과 불명확 provenance 표시 |
| [ai-service/app/runtime.py](../../../../../ai-service/app/runtime.py) | existing | 성공한 로드와 근거가 함께 게시되는 경계 확인;필요 시 최소 변경 |
| [backend-django/arti/model_service.py](../../../../../backend-django/arti/model_service.py) | existing | 전송한 이미지 SHA256과 응답 근거 일치·형식/크기 검증 |
| [backend-django/arti/providers.py](../../../../../backend-django/arti/providers.py) | existing | tag 생성에서 점수와 provenance를 함께 반환,기존 감정 경계 유지 |
| [backend-django/arti/models.py](../../../../../backend-django/arti/models.py) | existing | Artwork tag_score_revision·tag_score_evidence nullable/additive 필드 |
| `backend-django/arti/migrations/0003_tag_score_evidence.py` | proposed_new | 구조만 추가,기존행 revision0/evidence null,인수/공개 자동화 없음 |
| [backend-django/arti/editing.py](../../../../../backend-django/arti/editing.py) | existing | 분석 저장 트랜잭션에 점수/근거/revision 원자 반영,실패/오래된 source 보호 |
| [backend-django/arti/serializers.py](../../../../../backend-django/arti/serializers.py) | existing | 새 출처는 관리자용만,공개 DTO에 로컬 경로/내부입력 노출 금지 |
| `ai-service/tests/test_provenance.py` | proposed_new | 실제 artifact/해시/fake 경계와 구형 nullable 호환 |
| [ai-service/tests/test_api.py](../../../../../ai-service/tests/test_api.py) | existing | 구형 응답호환·신규 근거 구조 |
| [ai-service/tests/test_runtime.py](../../../../../ai-service/tests/test_runtime.py) | existing | 부분 로드/동시요청·재기동 회귀 |
| [backend-django/arti/tests/test_model_service.py](../../../../../backend-django/arti/tests/test_model_service.py) | existing | 수신/전송 해시·기존 응답·잘못된 근거 |
| [backend-django/arti/tests/test_model_operations.py](../../../../../backend-django/arti/tests/test_model_operations.py) | existing | 점수/근거/기존 확정 보호·timeout/429/503/504 |
| [backend-django/config/settings.py](../../../../../backend-django/config/settings.py) | existing | 서버 승인 signature 해시 설정,등록 없으면 AI동점 불가 |
| [.env.example](../../../../../.env.example) | existing | 기존 루트 예시에 승인 signature·모델 revision/생성 enable 설명만 추가;실제env 유지 |
| [.env.compose.example](../../../../../.env.compose.example) | existing | 설정 전달 예시만,실제 env 파일 변경 없음 |
| [compose.yaml](../../../../../compose.yaml) | existing | 새 비밀 아닌 설정 전달;서비스/볼륨 구성 유지 |
| [docs/operations/모델서비스_로컬운영.md](../../../../operations/모델서비스_로컬운영.md) | existing | Compose 밖 로컬 FastAPI revision/cache/근거/구형응답 운영 재현 |

단계진입: 9234371 계약·이 계획 검토와 제품 작업 별도 승인 / 필드/응답 추가 전 기존 AI 오류·저장 보호 회귀 기준 확보

통과조건: 실제 바이트/로더 artifact와 결합한 근거만 보존,불명확 정보 추정 금지 / 점수/근거/revision 함께 저장,실패 시 셋 모두 무변경 / 기존행/승인/공개/프로필 무변경·구형 FastAPI 응답 허용 / TP1 검증 전 새 v2 생성 비활성

되돌릴범위: 필드를 남기는 additive rollback,구형 응답·점수 경로로 복귀 / live DB의0003역마이그레이션·새근거 삭제 금지

커밋: TP1a 모델/transport nullable 근거와 fake 회귀 통과 후 로컬 커밋 / TP1b additive migration·원자 저장·구형 호환 통과 후 로컬 커밋

## TP2 서버 사전 검증·저장 호환/충돌 보호

| 파일 | 구분 | 변경 목적 |
| --- | --- | --- |
| `backend-django/arti/taste_resolution.py` | proposed_new | 카운트/동점/preview·snapshot 공통 순수 helper와 DB 읽기 경계 |
| `backend-django/arti/taste_evidence.py` | proposed_new | 근거 hash/서버 승인 signature·관람증거 purpose/actor/visit 검증 |
| [backend-django/arti/survey.py](../../../../../backend-django/arti/survey.py) | existing | 동일 DB snapshot에서 pool/tieContext 생성,기존 poolVersion 식 유지 |
| [backend-django/arti/serializers.py](../../../../../backend-django/arti/serializers.py) | existing | 명시 v1/v2 union·엄격 입력/resolve·mutation/receipt 스키마 |
| [backend-django/arti/views.py](../../../../../backend-django/arti/views.py) | existing | GET capability/enable 상태·v2 추천 경로·기존 배열 응답 유지 |
| [backend-django/config/urls.py](../../../../../backend-django/config/urls.py) | existing | POST/api/taste-profiles/resolve만 추가 |
| [backend-django/arti/recommendations.py](../../../../../backend-django/arti/recommendations.py) | existing | v1 경로 동결,v2 동일빈도 커버리지 우선순위만 공유 |
| [backend-django/arti/member.py](../../../../../backend-django/arti/member.py) | existing | 계정 lock 내 CAS·동일 mutation 재시도/no-op·옛 저장 호환 |
| [backend-django/arti/models.py](../../../../../backend-django/arti/models.py) | existing | Account 마지막 taste_write_receipt nullable JSON필드 |
| `backend-django/arti/migrations/0004_taste_write_receipt.py` | proposed_new | idempotency 마지막요청 구조만 추가,기존 프로필 이관 없음 |
| [backend-django/arti/records.py](../../../../../backend-django/arti/records.py) | existing | v2 영수증에 서버검증 관람 근거 재사용,기존 visitId 재시도 우선 |
| [backend-django/arti/editing.py](../../../../../backend-django/arti/editing.py) | existing | 다중작품 confirm_ai 잠금을Artwork ID순으로통일;요청순서와무관하게교착방지 |
| [backend-django/arti/management/commands/configure_taste_survey.py](../../../../../backend-django/arti/management/commands/configure_taste_survey.py) | existing | 풀/작품 잠금 순서와 현재풀 일관성 대조;필요한 경계만 변경 |
| [backend-django/config/settings.py](../../../../../backend-django/config/settings.py) | existing | 신규v2 생성 enable 기본false;기존 저장/관람 읽기와 분리 |
| [.env.example](../../../../../.env.example) | existing | 기존 루트 예시에 승인 signature·모델 revision/생성 enable 설명만 추가;실제env 유지 |
| [.env.compose.example](../../../../../.env.compose.example) | existing | 테스트에서만v2 enable하는 설명 |
| [compose.yaml](../../../../../compose.yaml) | existing | enable 설정 전달,일반 환경 값 변경 없음 |
| `backend-django/arti/tests/test_taste_resolution.py` | proposed_new | 정책 반례·API/v1/v2·그룹fallback·preview무쓰기 |
| `backend-django/arti/tests/test_taste_concurrency.py` | proposed_new | 실제PG 두연결+barrier CAS/풀교체/재시도 |
| [backend-django/arti/tests/test_survey.py](../../../../../backend-django/arti/tests/test_survey.py) | existing | 구형 snapshot·전역풀·10점 자격·공개 회귀 |
| [backend-django/arti/tests/test_integration.py](../../../../../backend-django/arti/tests/test_integration.py) | existing | 관람/영수증/계정 경계 및 구형 flow 회귀 |

단계진입: TP1 통과 및 additive필드 사용 가능 / 보완 결정D1~D7의 범위 확인;기존계약 자동 변경으로 취급하지 않음

통과조건: preview는 DB write/모델 호출0;원자 snapshot·버전 검증 / v1/옛snapshot 소급변경 없음,v2서버 점수만 사용 / CAS 두요청 한건성공/한건409,응답유실 재시도 한차례 저장 / 풀교체 중 혼합근거0·관람중 풀교체 후 v2 영수증 보존 / capability 생성은 기본off,기존v2 읽기/재시도와 분리

되돌릴범위: 신규v2 생성 disable,미확정 UI입력 보존 / 알려진v2 읽기·frozen순서·이미 발행된 관람증거·동일mutation 재시도 유지 / 확장schema 남김;v2정보 모르는 구형 이미지로 무조건rollback하지 않음

커밋: TP2a resolve·context·v1/v2 추천·preview무쓰기 회귀 통과 후 커밋 / TP2b snapshot/CAS/idempotency/관람증거·PG병렬 회귀 통과 후 커밋

## TP3 프론트 확인 흐름·UI 선별 병합

| 파일 | 구분 | 변경 목적 |
| --- | --- | --- |
| [frontend/src/types.ts](../../../../../frontend/src/types.ts) | existing | v1/v2·preview·write/visit 근거 타입 union |
| [frontend/src/api/client.ts](../../../../../frontend/src/api/client.ts) | existing | 전역풀 capability·resolve·CAS/mutation·관람근거;204/배열 유지 |
| `frontend/src/lib/tasteDraft.ts` | proposed_new | 미확정 초안/입력 의미 hash·editRevision·응답 적용 조건 |
| [frontend/src/lib/tasteFromPicks.ts](../../../../../frontend/src/lib/tasteFromPicks.ts) | existing | v1 유지,v2 서버 결과만 사용;로컬AI 점수계산 추가 금지 |
| [frontend/src/pages/user/U05Taste.tsx](../../../../../frontend/src/pages/user/U05Taste.tsx) | existing | 태그 부분집합/manual확인·preview-first·명시확인/저장·충돌 보존 |
| [frontend/src/pages/user/U06SavedTaste.tsx](../../../../../frontend/src/pages/user/U06SavedTaste.tsx) | existing | 서버 저장버전 재사용,신구 profile union |
| [frontend/src/pages/user/U07Time.tsx](../../../../../frontend/src/pages/user/U07Time.tsx) | existing | 기존 동일시간 빠른복귀 보존,필요할 때만 상태 경계 확인 |
| [frontend/src/pages/user/U08Recommend.tsx](../../../../../frontend/src/pages/user/U08Recommend.tsx) | existing | 서버 tie profile/버전오류 안내·지연응답 guard |
| [frontend/src/store/visitReducer.ts](../../../../../frontend/src/store/visitReducer.ts) | existing | 확정 한차례 commit/no-op·visitId와 근거 binding·계정/세대 경계 |
| [frontend/src/store/VisitContext.tsx](../../../../../frontend/src/store/VisitContext.tsx) | existing | session draft/proof 복구와 actor change 폐기,token 인증값 노출 없음 |
| [frontend/src/lib/receiptPayload.ts](../../../../../frontend/src/lib/receiptPayload.ts) | existing | 관람근거 outer필드 전달·기존 retry body 유지 |
| [frontend/src/pages/user/U12Receipt.tsx](../../../../../frontend/src/pages/user/U12Receipt.tsx) | existing | pending receipt 동결·풀/계정 변화 후 기존관람 분리 |
| [frontend/src/components/MobileShell.tsx](../../../../../frontend/src/components/MobileShell.tsx) | existing | 동섭 종합본과 중복헤더/주제목 계층 선별 검토 |
| [frontend/src/styles/app.css](../../../../../frontend/src/styles/app.css) | existing | 오류색/경고색/이유강조만 선별,contain·문단 CSS 보존 |
| [frontend/src/pages/admin/A04Artworks.tsx](../../../../../frontend/src/pages/admin/A04Artworks.tsx) | existing | ZIP error-text hunk만 검토 |
| [frontend/src/pages/admin/A07Reactions.tsx](../../../../../frontend/src/pages/admin/A07Reactions.tsx) | existing | ZIP error-text hunk만 검토 |
| `frontend/tests/tasteDraft.test.mts` | proposed_new | 초안/no-op·역순응답·실패 보존 |
| [frontend/tests/actorRequests.test.mts](../../../../../frontend/tests/actorRequests.test.mts) | existing | 기존 전역API·계정401 guard·저장/api.me 실패 |
| [frontend/tests/visitReducer.test.mts](../../../../../frontend/tests/visitReducer.test.mts) | existing | 기존동일시간·확정1회·다른계정지연응답·복구 |
| [frontend/tests/receiptPayload.test.mts](../../../../../frontend/tests/receiptPayload.test.mts) | existing | proof binding·pending body 동일 재시도 |
| [frontend/src/pages/user/U10Artwork.tsx](../../../../../frontend/src/pages/user/U10Artwork.tsx) | existing | 팀 종합 확인 후 error-text hunk만 검토;원문문단/U10→도슨트 맥락 보존 |
| [frontend/src/pages/user/U11AskAI.tsx](../../../../../frontend/src/pages/user/U11AskAI.tsx) | existing | 팀 종합 확인 후 error-text hunk만 검토;원문문단/U10→도슨트 맥락 보존 |

단계진입: TP2 통과·확정할v2 wire형식 고정 / 성현/동섭의 최신 종합본 기준 commit/파일/hunk 재확인;미확인이면 기존 ZIP을 참고만 하고 UI병합 보류

통과조건: 초안/취소/409/저장실패는 현재관람·계정·반응 무변경 / 응답유실/api.me실패·actor/editRevision변경 시 잘못된commit0 / 전체이미지/문단/전역API/동일시간/닉네임100/회귀 보존 / 서버지원+enable때만v2 생성,옛profile 읽기 지속 / 추가태그 manual전환 명시,빈선택 거절·대표3강제 없음

되돌릴범위: 새UI 생성 경로 disable 후 기존 저장읽기/진행 유지 / 미확정 draft/proof는actor-bound로보존/재검증,옛state를v1으로위조전환 금지 / ZIP 전체덮기·다른팀원 작업 branch강제초기화 금지

커밋: TP3a types/API/draft/reducer·계정 경계 회귀 통과 후 커밋 / TP3b 화면/영수증 확인흐름·선별UI·브라우저 점검 통과 후 커밋

## TP4 격리 통합 검증·인수 준비

| 파일 | 구분 | 변경 목적 |
| --- | --- | --- |
| `backend-django/arti/tests/test_taste_concurrency.py` | created_in_prior_phase | 실제PG 동시성과 barrier 오류 재현 |
| `backend-django/arti/tests/test_taste_resolution.py` | created_in_prior_phase | v1/v2 전범위와 동일입력 추천 비교 |
| `ai-service/tests/test_provenance.py` | created_in_prior_phase | 직렬화/부분로드·구형응답 계약 |
| `frontend/tests/tasteDraft.test.mts` | created_in_prior_phase | 역순/실패/no-op·저장 재시도 재현 |
| [.github/workflows/ci.yml](../../../../../.github/workflows/ci.yml) | existing | 기존4job 안의 deterministic 시험 인수;원격실행은추후push승인 이후 |
| [docs/operations/취향조사풀-운영.md](../../../../operations/취향조사풀-운영.md) | existing | signature/enable·rollback·비활성pool 유지 절차 |
| `docs/execution-plan/2026-11-07/records/taste-tie-implementation-results-2026-11-11/README.md` | proposed_new | 후속실행시 단계별환경/명령/원수/남은조건 누적,날짜는실제실행일로 |

단계진입: TP1~TP3 통과;격리 PostgreSQL/미디어/port/프로젝트 선택 확인 / 실제모델 cached artifact 확인 가능;불가 시 실제출처smoke는대기하고TP4완료주장 금지

통과조건: 격리fake10점·권한/3·5·7추천/동선/도슨트진입·영수증/재시도 완주 / v1추천출력불변,v2가중치불변·선정/방문순서변화 구분 / 실제cached 모델1회 근거/바이트해시일치,모델재학습/최적화/유료GPT0 / 일반arti-dev·원본16·미디어·활성풀 전후동일 / 로컬CI해당시험통과,실제GitHubActions/사람품질/공개는별도대기

되돌릴범위: 실패단계만 수정→관련회귀→통합검증 반복,pass증거없이다음단계진행 금지 / 시험출력/DB만소유확인후정리;일반환경down-v/원본삭제금지

커밋: TP4 통합보완·작업기록·로컬 검증 증거 통과 후 커밋;원격push 별도
