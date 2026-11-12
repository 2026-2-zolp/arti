# TP2 서버 취향 검증과 저장

기준 커밋 `11edcff`에서 TP1b의 점수·근거·revision을 이어받았다. 동점 정책과 저장 보호의 설계 기준은 [상세 계획](../../taste-tie-implementation-plan-2026-11-11/README.md)과 [D1–D7 결정](../../taste-tie-implementation-plan-2026-11-11/decisions.md)이다.

## API 계약

| 요청 | 사용 방식 |
| --- | --- |
| `GET /api/taste-pool` | 기존 `poolVersion`과 쌍을 사용한다. `supportedTasteProfileVersions`에 2가 있고 `tasteTieV2Enabled`가 참일 때 새 v2 선택을 시작한다. `tieContext.tieContextVersion`도 같이 보관한다. |
| `POST /api/taste-profiles/resolve` | `tasteProfile`에 v2와 출처, 선택 태그를 보낸다. picks는 두 버전과 다섯 선택을, saved는 본인 저장 버전을 포함한다. 응답의 정규화된 프로필·`tagOrder`·그룹별 판정을 표시한다. `userConfirmed`는 false다. |
| `POST /api/recommendations` | 요청 시점의 근거를 다시 확인한다. 동일 빈도 태그의 커버리지 시도 순서에 preview와 같은 정책을 쓴다. 저장된 v2 프로필은 당시 순서를 사용한다. |
| `PUT /api/users/{userId}/tastes` | 새 v2 저장에 현재 `expectedSavedProfileVersion`과 UUID `clientMutationId`를 보낸다. 성공은 204다. 응답이 유실되면 같은 ID와 원 요청을 재전송한다. |
| `POST /api/visits` | preview의 `visitEvidenceReceipt`를 `tasteEvidenceReceipt`로 보낸다. preview에 UUID v4 `visitId`를 보내면 서명 근거를 발급한다. 그때 `exhibitionId`도 보내면 해당 전시에 묶인다. |

태그 빈도와 추천 가중치는 기존 공식을 쓴다. 동점에 한해 선택한 다섯 작품의 그룹 내 점수를 소수 여섯 자리로 반올림해 정수로 합산한다. 승인한 출처 또는 해당 그룹의 점수가 하나라도 빠지면 그룹 전체에 기존 TAGS 순서를 적용한다. 합이 같을 때도 같은 순서를 쓴다. 모델별 승인 식별은 검증된 `signatureSha256`과 설정값을 대조한다. `tieContextVersion`은 승인 식별자와 선택하지 않은 작품을 포함한 조사풀 열 점의 근거를 반영한다.

회원 저장은 계정→풀 ID→작품 ID 순서로 잠근다. 마지막 mutation의 요청 해시와 계정 상태를 확인해 중복 저장 없이 204를 돌려준다. 같은 snapshot의 새 mutation은 마지막 요청 증거만 교체한다. 프로필 버전은 실제 내용 변경 시에 증가한다. v1 계정의 기존 무버전 저장은 유지하며 이미 v2가 저장된 계정의 v1 쓰기에는 현재 저장 버전이 필요하다.

관람 서명은 actor·visit ID·프로필·발급 시각에 묶이며 8KiB와 72시간 한도가 있다. 원본 서명 대신 해시를 저장해 이미 기록된 동일 원문 재시도를 구분한다. 첫 저장에는 현재 공개 전시와 작품 소속 검증이 적용된다. 400은 입력 검증, 401은 인증, 403은 계정 소유 경계, 409는 버전·재시도 충돌 또는 만료, 재시도 가능한 503은 잠금 대기 초과다. 기능을 끈 상태의 새 v2 preview·저장·추천에는 `FEATURE_DISABLED`를 반환한다.

기본 설정은 `ARTI_TASTE_PROFILE_V2_ENABLED=false`와 빈 승인 해시다. 저장된 v2의 frozen 순서, 기존 관람 서명, 같은 mutation의 재시도는 이 설정에서도 처리한다. `0004`는 마지막 쓰기 증거용 nullable 필드만 추가한다.

## 검증과 다음 단계

P2-01~P2-09의 결과와 시험 단위는 [검증 결과](validation.json)에 기록했다. 30개 합성 반례는 제품의 공통 resolver로 비교했고, 모델 입력 바인딩과 API 동작은 별도의 격리 PostgreSQL 시험으로 확인했다.

다음 TP3에서는 선택 초안 → preview → 사용자 확인 → 회원 CAS 또는 이번 관람만 적용 → 관람 화면 반영을 연결한다. 409·503과 지연 응답에서 작성 중인 선택과 기존 관람을 보존한다. 동섭님 종합본 기준으로 UI 변경을 대조하고, 실제 모델과 브라우저 전체 흐름은 TP4에서 검증한다.
