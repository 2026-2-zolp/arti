# W 계획·37개 잔여 이슈 재정합화

2026-11-09 / 검토 대상7e8ec2e / dev/임준억. W05/G4 이후의 실제 구현·브라우저·DB·모델 실적이 옛 F 상태에 반영되지 않아 중복 구현/누락 위험이 있었다. 이번 과업은 상태와 증거를 정리하며 제품 기능이나 정식 품질 게이트를 추가 완료시키지 않는다.

## 기준과 변경 전후

[변경 전37개 관측](before-issues.json)에 원래 상태·관측·필수 범위와 계획 파일 해시를 보존했다. 원래 F 제목·W/AC 연결은 유지하고 execution.json의 status/observation/currentReview를 갱신했다. 과거 발생 사실과 현재 결함 여부를 구분하도록 04-issues.md를 현재 판정표로 바꿨다. 생성 예정 경로를 담은 W02 당시 표는 역사 기록으로 유지하고 최신 표로 안내한다.

**12건 종결:** F01/F02/F03/F04/F07/F11/F13/F14/F15/F16/F20/F34. 연결된 AC가 이미 pass이고 G4/후속 회귀 근거가 있는 현재 계약 범위에 한한다. resolvedCommit은 이번 검토의 코드 기준7e8ec2e이며 해당 기능 최초 도입 SHA를 뜻하지 않는다. 최초 구현/수정 이력은 Git과 각 작업기록으로 추적한다.

F10은 중앙 저장/관리자 조회 구현이 있어도 실제 다른 기기 확인을 하지 않았으므로 verification_pending이다. F12는 합성 GPT 연속성을 확인했어도 AC20 실제 전시 평가가 남아 in_progress다. F15 종결은 메일 발송 성공이 아니라 계약상501+UI 비활성 선택을 검증했다는 뜻이다. F14/F16은 Git 인수/신규 인증·PG 범위이며 실제 팀 로컬 계정/DB 이전 성공을 뜻하지 않는다.

F06/F08/F09/F29/F35/F36은 코드/자료 준비가 있어도 사람 검수·출처/시연 구성 채택이 남아 blocked로 구분한다. F18/F19/F26/F27/F30/F31은 실제 모델/복원 등 부분 실적을 연결하되 유영국 품질·대표 표본·배포 검증으로 확대하지 않는다. F24는 과거 push 성공과 이번 로컬 재현, 최신 원격/PR 미검증을 구분한다. F22/F25는 AWS/CD 실제 작업 대기로 유지한다. F21은 고급 알고리즘/최단보행 미구현 한계와 최종 범위 설명이 남아 open이다.

F37은 원본 보존·별도 인수 결정에 따라 blocked 상태로 유지하면서 releaseRequired=false로 바꿨다. 사람 승인 없이 자료를 버리는 결정이 아니라 사용자가 이미 정한 Git 인수 경계를 필수 이슈 조건에 반영한 것이다. 새 데이터 채택 요청이 오면 별도 export/해시/차이 검토부터 재개한다.

## 코드·시험 대조

| 범위 | 코드/검사 위치 | 판정 근거 |
| --- | --- | --- |
| 선택/profile/추천 | backend-django/arti/recommendations.py, frontend/tests/visitReducer.test.mts | W05 G4·격리 여정, 현재 회귀 |
| 콘텐츠·확정 보호 | backend-django/arti/editing.py, serializers.py, tests/test_integration.py | roundtrip/독립 확정/원문 변경/충돌·공개 상태 조합 |
| 반응·관람 저장 | backend-django/arti/records.py, tests/test_integration.py | 멱등성·사유/체류·guest 미저장·관리자 조회. 다기기는 후속 |
| 인증·도슨트 | authentication.py, docent.py, tests/test_integration.py | 계정/작품/관람 분리·서버 재구성·비활성 재설정 |
| 모델 운영 | ai-service/app/runtime.py, backend-django/arti/tests/test_model_operations.py | 실제 모델5시나리오와 현재 PG 회귀. UI 장애 여정 후속 |
| CI | .github/workflows/ci.yml | 과거 원격 run·이번 Linux 재현·PR 미실행 구분 |

## 자체 검증단과 통과 기준

- 기술/시니어: 전체37개를 누락 없이 대조하고 종결에는 pass AC·실제 파일 근거·Git 조상 SHA를 요구한다. 분리된 구현과 정식 완료를 혼동하지 않는다.
- 데이터/운영: 원래 관측과 아카이브를 보존하고 F37의 사용자 결정·원본 미변경·별도 인수 경계를 확인한다.
- 방문자/콘텐츠: 다른 기기·실제 유영국·실제 통로·실제 발송 미검증이 숨겨지지 않는지 확인한다.
- 팀/교수/평가위원: 생성/가상/실모델/사람 승인과 로컬/원격/배포의 주장 범위를 대조한다. 이 검토는 작성자의 관점별 자체 검토이며 실제 외부 승인으로 기록하지 않는다.

verify_plan.py는 현재 검토 필수 항목/증거 경로·원래 ID/W/AC 매핑·표와 manifest 상태 일치·종결 SHA 조상·F37 경계를 검사한다. 기존 pass AC 조건과 protected38개 검사는 유지한다. 계획 오류0·guardrail 통과와 현재 CI 회귀를 확인한 뒤 이번 문서 인수만 통과 판정한다.

다음: [최신 CI 준비 결과](../W11/local-current-2026-11-09/README.md)를 바탕으로 격리 브라우저의 모델 장애/복구 여정을 확인한다. W06 사람 확인·W07 정식 평가·GCI/운영 게이트를 자동 승격하지 않는다.
