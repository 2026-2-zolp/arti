# ARTI 통합·리팩토링 실행계획 v2.1

최신 정리: 2026-11-09 KST / dev/임준억. [현재 W 상태·다음 순서](12-current-status.md)와 [37개 이슈 재정합화](records/reconciliation-2026-11-09/README.md)를 먼저 확인한다. 과거 push CI 성공과 최신 로컬 전용 변경을 구분한다.

[통합 준비 문서](../../통합준비문서.md) · [누적 작업기록](../../작업기록/README.md)

## 기준과 절차

기준은 동섭 통합본 ae0e58e다. 기존 준억 이력과 병합했으며 기준 파일 tree 동일성을 확인했다. 상태는 execution.json이 단일 기준이다. 계약/회귀 통과와 실제 제품·모델·클라우드 통과를 구별한다.

| 문서 | 내용 |
| --- | --- |
| [01-assignment.md](01-assignment.md) | 과업 범위·산출물·완료 조건 |
| [02-procedure.md](02-procedure.md) | 선후 관계와 실행 순서 |
| [03-quality-gates.md](03-quality-gates.md) | 단계별 통과 기준·재검증 절차 |
| [04-issues.md](04-issues.md) | 미해결 이슈와 처리 상태 |
| [05-contracts-and-decisions.md](05-contracts-and-decisions.md) | API·데이터 계약과 결정 근거 |
| [06-operations.md](06-operations.md) | 실행 환경·배포 운영 방침 |
| [07-records-and-handoff.md](07-records-and-handoff.md) | 증거 보존과 후속 인수 절차 |
| [08-document-review.md](08-document-review.md) | 현재 검토 결과와 커밋 연결 |
| [09-baseline-and-data.md](09-baseline-and-data.md) | 통합 기준선과 데이터 인수 조건 |
| [10-persona-review-and-improvements.md](10-persona-review-and-improvements.md) | 검증단 관점과 개선 사항 |
| [11-plan-readiness-review.md](11-plan-readiness-review.md) | 착수 준비도와 잔여 조건 |
| [12-current-status.md](12-current-status.md) | 현재 W 상태·검수 대기 중 실행 순서·다음 한 작업 |

## 단계별 증거

- [W05 구현·검증 완료](records/W05/README.md) / [G4 통과](records/W05/gate-review.md): 복구·관리자·예외 재시험 및 명시 Git기준 인수 결정을 반영했다.

- [W01 / G0 검토](records/W01/gate-review.md)
- [W02 / G1 검토](records/W02/gate-review.md)
- [W03 / G2 검토](records/W03/gate-review.md)
- [W04 / G3 검토](records/W04/gate-review.md)

W01~W05/G0~G4는 통과했다. [새 API 실행 안내](../../../backend-django/README.md). W06은16점 비공개 인수·평가/검수 준비 후 사람 확인 대기다. W07은 실제 GPT·분류모델·운영 안정성의 선행 실적이 있지만 정식 품질/G5는 미통과다. W11은 과거 원격 push 성공·최신 로컬 재현과 PR 인수 대기를 구분한다. 로컬 고유자료 별도 이전·AWS/CD·실기기 전체여정은 미완료다. 아래 날짜별 후속 문장은 당시 기록이며 최신 판정은 현재 상태 문서와 execution.json을 따른다.

## 과거 자료

[조사 아카이브](../../project-baseline/2026-11-06/README.md)와 [v1 계획](../2026-11-06/README.md)은 당시 기록 그대로다. 개인 PC/조사 사본 경로가 남아 있어 새 체크아웃의 실행 경로로 사용하지 않는다. 실제 카톡·DB·키·임시 pytest 폴더는 복제하지 않았다. 원시 logs는 fixtures/fake 환경의 과거 증거이며 자동 재실행 결과로 오인하지 않는다.

2026-11-08 후속: [W11 CI 도입](records/W11/README.md)은 workflow/로컬 Linux 검증 완료·원격 run 대기다. [W07 텍스트 provider 준비](records/W07-preparation/README.md)는 실제 모델 게이트를 통과시킨 것이 아니다.

후속 원격 결과: [W11 push4job 실제 성공](records/W11/remote-run-1.json), PR 이벤트는 아직 없어 AC07/GCI 완료와 구분한다. [누적 원격 기록](../../../docs/작업기록/2026-11-08_최종검토와원격CI검증.md).

2026-11-09 후속: [유영국16점 전시 구성·관리자 지도 확인과 남은W 순서](../../../docs/operations/2026-11-09_유영국전시구성과동선검토.md). W06 실제 자료 준비와 지도 API부분 확인, W11/W12 병행·W07/W08~W10 의존관계를 연결한다. EVALUATOR/SENIOR는 사용자 동의로 추가한 AI검토 관점이며 실제 외부 승인 아님.
