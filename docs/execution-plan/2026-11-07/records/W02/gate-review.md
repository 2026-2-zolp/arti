# G1 개발 계약 인수 검토

2026-11-08 KST / 판정: **pass**. 실제 제품 통과가 아닌 W02/AC03~AC05 계약 인수다.

## 근거

- source-inventory.json/md: ae0e58e의 실제 소스65개 해시, API등록34개, frontend직접호출51개. API prefix/method·화면/모듈 호출 확인.
- contracts.md/decisions.md: 유지/변경, 개발결정과 후속미결, 입력/출력·상태·한도·실패·권한·복귀 계약.
- cases.json 35사례, wire-examples.json 6전송예시: 정상/실패·빈도/저장/도슨트·구조화saved재사용·만료복구·출처stale. 실제 응답이라고 주장하지 않음.
- issue-implementation-map.md: F01~F37의 기준코드·반영여부·대상위치·담당·회귀/AC. Express 이중구현 제외.
- verify_contracts.py/contract-check.json: 소스해시/사례/수식예시/이슈매핑 검사 오류0. 이는 정적 검사다.

## 독립 AI 검토와 보완 루프

| 검토자 | 필수 지적·보완 | 최종 판정 |
| --- | --- | --- |
| technical_review 기술/API/운영 | 관리자읽기분리, 무효토큰guest강등, 산출물별보호/충돌버전, pendingReceipt보존충돌, raw If-Match, saved서버snapshot, 사실필드stale, 호출수정확성 | AC03~05/G1 기술검토통과·남은필수없음 |
| scope_review 팀/범위/교수 | U05직접편집없음정정, fresh/saved경계, 다른전시재사용, guest예시충돌, 개발결정과팀최종합의구분 | AC03~05/G1 문서계약인수통과가능·남은필수없음 |
| visitor_review 관람객/콘텐츠 | persisted/만료회원,기본팁vs작품가이드,DTO미노출표현,성공history,복귀격리,pendingReceipt별도복구 | G1 문서계약통과가능·남은필수없음 |

각 검토자는 실제 소스/최종 계약을 읽고 수정 후 재검토했다. 구현자와 별도 AI 검토이며 실제 팀·교수·관람객 승인 또는 작품 사람검수가 아니다. 작성자는 지적을 반영하고 최종 정합성을 확인했다.

## AC별 판정

- AC03 pass: 현재 U05/06와 개발선택/최종합의대기 구별, 선택풀/빈도/수정의미·콘텐츠4종·공개검수·ID/좌표·도슨트/복귀·회원/guest·쉬운/깊은설명·한작품trace의 정상/실패 예시 명시.
- AC04 pass: Django/DRF·Postgres·Docker 전환,opaque인증·provider경계·자료계약/조건/시간상한과 되돌림 근거 채택. AWS예산·실제평가·CI권한은 후속과업으로 격리.
- AC05 pass: 37개이슈 현행/미검증/보완분리·실제기준위치/예정대상/담당/검사 연결. 기존 F03 중복재구현/Express이중작업 배제.

## 제한과 다음 행동

제품코드 변경 없음, 이슈 closed 없음. 실제 새 API/브라우저/LLM/AWS는 미통과. W03에서 기존 Express의 정상·결함을 HTTP/데이터 기준으로 고정한다. 결함 재현 성공은 G2 회귀기반 수립의 근거이며 제품 결함 해결이 아니다. 이후 W04 신규API/DB/Compose로 진행한다.
