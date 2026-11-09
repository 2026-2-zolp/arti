# F별 실제 기준 코드와 대상 수정·회귀 연결

이 표는 W02 계약 수립 당시의 코드/예정 작업 기록이다. 2026-11-09 이후의 현재 상태·수정 완료 여부는 [현재 이슈표](../../04-issues.md)와 [재정합화 근거](../reconciliation-2026-11-09/README.md)를 따른다. 아래 생성 예정 표현을 최신 미구현 목록으로 사용하지 않는다.

2026-11-08. 담당은 모두 준억의 통합작업 중심, AI보조. 팀원에게 새개발 배정/완료로 간주하지 않는다. 코드 경로는 work/arti 기준이다. 대상 Django 모듈 이름은 **생성 예정 위치**이며 현재 존재한다는 뜻이 아니다. 기존 tests는 정상 비교용, records/W03는 결함 재현용, 새 API 검사는 생성 후 backend-django/tests에 둔다. F는 제품 AC 통과 전 closed로 바꾸지 않는다.

| F | 현 코드·반영판정 | 대상 위치·작업 | 회귀/AC |
| --- | --- | --- | --- |
| F01 | frontend/lib/tasteFromPicks·VisitContext, backend/lib/recommend: 빈도소실 재현 | backend-django/taste,recommendations + U05/U06/client | 반대빈도 점수/원본 / AC03,AC13 |
| F02 | W03실제UI정정: U07.next가추천초기화·30→60분3→5정상. reducer단독관측을전체UI결함으로확대하지않음 | VisitContext/U07/U08 정상유지, requestGeneration·관람중변경정책보완 | 기타입력변경/늦은응답 / AC06,AC13 |
| F03 | A04Artworks guide필드 반영 보완됨, UI저장 미검증 | 새 admin serializer/UI회귀, 중복재작성 제외 | 가이드수정→저장→재조회 / AC06,AC11 |
| F04 | routes/catalog GET/ask draft/pending200 재현 | catalog/public serializers, admin읽기 + client | 공개상태조합/관리자편집 / AC06,AC12 |
| F05 | lib/ai fallback/외부결과혼재 | providers, client/U11/U12 | 키없음/오류/timeout/mode / AC03,AC20 |
| F06 | lib/ai 근거버전 검증부족 | sources/provider validation | 출처ID+내용 지지 / AC18,AC20,AC21 |
| F07 | Express/SQLite 실제확인 | backend-django/Compose, React계약전환 | fixture GET/추천 / AC04,AC08 |
| F08 | U05 앞10점/최대5쌍, U06 재실행 | taste-pool/profile·U05/06 | ready10/부족/중복/버전 / AC03,AC18,AC16 |
| F09 | seed/seed-captures 테스트전시 | fixtures/import command, manifest | 테스트/실전시격리 / AC18,AC29 |
| F10 | reactionLog 브라우저저장·visitInput이유없음 | VisitReaction/admin query + U12/A07 | 2기기서버재조회 / AC06,AC14 |
| F11 | U12 AI대기/flag선설정·visits매번newId | visits service/uniqueconstraint/U12 | AI실패/중복/401/persisted / AC14,AC16 |
| F12 | U11 작품키/history미전달 | chat schema/VisitContext/U10/U11 | 관람/계정/작품/버전격리 / AC15,AC20 |
| F13 | client401 storage만제거/useAsync 오류표시누락 | auth bootstrap/useAsync/페이지 | 만료/404/offline재시도 / AC15,AC16 |
| F14 | http·password opaque/scrypt | auth/session/legacy hasher조건부 | 토큰role/타인/해시대조 / AC04,AC15,AC17 |
| F15 | auth.reset console링크/실발송없음 | auth feature flag/U14/U15 | 501/비활성안내·민감로그없음 / AC15,AC16 |
| F16 | db/repo 수동schema·JSON | models/migrations/import | FK/JSON/null/날짜/ID / AC09,AC17 |
| F17 | lib/recommend 좌표거리최근접 | recommendation/map·설명 | 좌표범위/도면·최적주장제외 / AC03,AC18,AC30 |
| F18 | evaluation 이미지40+79 Git존재 | ai-service/evaluation/유영국평가 | 기존셋재실행범위·새표본 / AC19,AC22 |
| F19 | README/보고지연, 운영미실측 | providers/timeouts/evaluation | 반복·동시p50/p95표본 / AC22,AC26 |
| F20 | U10/libai 콘텐츠4종혼용위험 | sources/public DTO/provider | 원문/요약/guide/dialogue분리 / AC03,AC11 |
| F21 | lib/recommend 고급알고리즘없음 | 설계변경/trace설명,새모델학습제외 | 제한설명 / AC04,AC31 |
| F22 | 로컬config, 실제AWS미검증 | ops결정/deploy env | 실제PostgresTLS/권한 / AC33,AC23 |
| F23 | app static uploads공개 | media permissions/storage adapter | 미공개404/모델내부읽기/영속 / AC24 |
| F24 | 실제Actions미검증 | .github/workflows 생성예정 | migration/Postgres/계약/fake / AC07,AC09 |
| F25 | 실제CD/복귀미구성 | deployworkflow/runbook | digest/직렬화/실패복귀 / AC27,AC28 |
| F26 | ai-service모델/Kanana안내자원 | model boundary/readiness/운영결정 | CLIP/mDeBERTa실측·Kanana기본제외 / AC33,AC22,AC26 |
| F27 | config180/300초 | provider hardtimeout/배포프록시 | 25/60/75초초기상한·timeout실패 / AC19,AC20,AC26 |
| F28 | Viteproxy/ArtImage/ReceiptImageSave | frontendenv/media/render/deploy | SPA/HTTPS/이미지/CORS / AC25,AC30 |
| F29 | referenceUrl/source/작품식별 | sourceVersions/importmanifest | 동명/출품/출처충돌/stale / AC18,AC21,AC11 |
| F30 | publicAI/static/upload/modelclient | permissions/media/provider | URLfetch차단/지시문/미공개근거 / AC12,AC20,AC24 |
| F31 | /health process만 | /ready/logging/opsbackup | DB/model준비/비밀/복원 / AC26 |
| F32 | SQLite→target 이전예정 | import/migration/rollbackrunbook | 데이터복원≠image복귀 / AC17,AC28 |
| F33 | db/seed 자동기본계정 | bootstrap명령/fixture분리 | 빈운영DB기본계정0 / AC10,AC23,AC26 |
| F34 | admin.runAnalysis 확정요약덮임 재현 | analysisservice component보호 | 확정summary+미확정guide재분석 / AC06,AC11 |
| F35 | admin PUT URL변경미해제 재현/seed guide미해제 코드 | sourceVersion/importstale | source/reference/image별변경 / AC11,AC18 |
| F36 | seed-captures approved/running 테스트 | testfixture실자료import분리 | 실자료source_check·자동확정없음 / AC10,AC18 |
| F37 | 실제팀DB/고유파일미인수 | manifest/export/import비파괴 | 부재확인또는실이전/원본보존 / AC02,AC17 |

## 착수 경계

W03에서는 실제 기준 코드의 정상/결함 입력을 고정할 뿐 Express 기능은 고치지 않는다. W04는 backend-django 별도 골격·Postgres·Compose와 첫 공개조회/추천까지, W05에서 위 핵심수정을 넓힌다. 기존 TS의 순수계산/라벨/DTO 의미는 재사용하되 미검수노출·기본계정·fallback 성공위장은 호환결함으로 복제하지 않는다.
