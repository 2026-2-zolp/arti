# 격리 검증 행렬 — 모두 실행 전

아래26건은계획이다.지금의문서검사/기존합성반례통과와다르며제품API/PG/실제모델/브라우저를이번에실행하지않았다.수치는후속실행의원수를기록하며성공을가정하지않는다.

## TP1

| ID | 자극/재현 | 기대 결과 | 남길 증거 |
| --- | --- | --- | --- |
| P1-01 | 같은원본바이트로Django전송/FastAPI응답비교 | SHA동일·모델/processor실제artifact+설정결합;로컬경로비공개 | `tag-provenance.json` · not_run |
| P1-02 | 구형서비스응답·로컬모델revision불명 | 점수기존호환·근거null·AI동점fallback,추정revision금지 | `legacy-model-response.json` · not_run |
| P1-03 | 잘못된근거/timeout/429/503/504·stale아트버전 | 실패한tag점수/근거/revision·재생성대상아닌확정값무변경;전체예산초과는모든결과저장0 | `analysis-protection.json` · not_run |
| P1-04 | 빈DB·기존v1데이터에0003 | 기존행/태그/공개/회원snapshot동일,새필드0/null | `migration-evidence.json` · not_run |
| P1-05 | 부분load·재기동·동시요청 | 성공artifact와signature한번게시,추론/잠금회귀통과 | `runtime-results.json` · not_run |

## TP2

| ID | 자극/재현 | 기대 결과 | 남길 증거 |
| --- | --- | --- | --- |
| P2-01 | 30기존반례를제품helper/API에대조 | 태그집합/가중치불변·그룹전체fallback·정수합정렬동일 | `tie-parity.json` · not_run |
| P2-02 | 새preview전후8모델행/미디어/외부요청계측 | DB쓰기/계정버전증가/모델호출0 | `preview-readonly.json` · not_run |
| P2-03 | 실제PG barrier로pool교체/점수편집과resolve경쟁·관리자역순batch confirm 경합 | 구근거전체 또는 신근거전체/409;혼합context0·deadlock0 | `pg-snapshot-race.json` · not_run |
| P2-04 | 같은계정N버전서로다른mutation동시저장 | 한건204·한건409,버전N+1·한건만저장 | `pg-cas.json` · not_run |
| P2-05 | 저장성공응답유실→같은mutation/동일본문재시도 | 204,버전/쓰기1회;같은ID다른본문409 | `mutation-retry.json` · not_run |
| P2-06 | 풀/모델교체후v1/saved v2읽기·v1쓰기경쟁 | 옛snapshot무변경;v1이v2를CAS없이덮기409;기존v1끼리제약명시 | `legacy-matrix.json` · not_run |
| P2-07 | 관람중pool교체·72h경계·proof위변조/다른actor/visit | 유효proof로현재계정미변경영수증;invalid거절·이미저장동일재시도유지 | `visit-proof.json` · not_run |
| P2-08 | guest/user/admin·다른계정/전시·위조counts/evidence | 401/403/400구분·다른전시추천0·client근거불신 | `authorization.json` · not_run |
| P2-09 | 기능off·enable경쟁·옛발급증거재시도 | 신규v2생성차단,옛snapshot읽기/원문영수증/동일mutation유지 | `disable-compatibility.json` · not_run |

## TP3

| ID | 자극/재현 | 기대 결과 | 남길 증거 |
| --- | --- | --- | --- |
| P3-01 | 태그변경/취소/같은값복귀/배열순서만변경 | 실제확정전현관람/계정무변경·같은의미no-op | `draft-state.json` · not_run |
| P3-02 | 느린preview후추가편집/다른계정/다른관람진입 | editRevision+actor/requestGeneration guard로늦은응답무시 | `stale-response.json` · not_run |
| P3-03 | 근거태그제외/복귀·새태그추가·빈집합 | picks부분집합/manual균등명시·빈선택확정불가 | `edit-boundaries.json` · not_run |
| P3-04 | 계정저장409/네트워크유실/api.me실패 | oldvisit보존·변경미확정;명시이번관람만/같은mutation확인 | `save-failure-ui.json` · not_run |
| P3-05 | 선별색/헤더변경후세로/가로그림·문단·동일시간 | contain/전역API/문단·100자/주제목/회귀지속 | `ui-intake-checklist.json` · not_run |
| P3-06 | 새로고침·로그아웃·다른계정·pending receipt복원 | actor/visit/draft별분리,같은재시도body유지 | `storage-recovery.json` · not_run |

## TP4

| ID | 자극/재현 | 기대 결과 | 남길 증거 |
| --- | --- | --- | --- |
| P4-01 | 격리10점5쌍→3/5/7추천→지도→U10→U11→영수증 | 완주·전시경계/맥락연계·중복방문저장0 | `browser-journey.md` · not_run |
| P4-02 | 동일합성데이터의v1전후·v2서버순서비교 | v1ID/순서/score/matchedTags동일,v2가중치불변;우열주장금지 | `recommendation-diff.json` · not_run |
| P4-03 | 기존cached 이미지모델로비공개1회 | 입력SHA/실제로딩revision/processor/calibration일치;GPT0 | `real-provenance-smoke.json` · not_run |
| P4-04 | 격리검증전후일반환경8모델/미디어/풀상태확인 | arti-dev및원본16보존·공개풀변경0 | `ordinary-before-after.json` · not_run |
| P4-05 | 기존4job상당명령·새회귀전체실행 | 로컬성공범위기록,원격Actions는미실행으로분리 | `local-ci-results.json` · not_run |
| P4-06 | 격리에서disable·additive schema보존·중단재개 | 옛snapshot/영수증/재시도유지·새생성만차단·데이터무삭제 | `rollback-results.json` · not_run |

실행시각·코드commit·DB/서비스버전·픽스처/프로토콜hash·명령·원수·실패와수정·재시험범위를증거에연결한다.오류는한번수정후그경계재현→관련회귀→전체여정순으로확인하고,제품수정이없는날동일시험을장황하게반복하지않는다.실제모델cache없음/사람미회신은별도대기이며대체fake를실제성공으로표시하지않는다.
