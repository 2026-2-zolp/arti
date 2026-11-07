# ARTI 통합·리팩토링 실행계획 v2.1

정리: 2026-11-08 KST / dev/임준억 / 실제 수행 후 과업별 회고 커밋. 원격 푸시 없음.

[통합 준비 문서](../../통합준비문서.md) · [누적 작업기록](../../작업기록/README.md)

## 기준과 절차

기준은 동섭 통합본 ae0e58e다. 기존 준억 이력과 병합했으며 기준 파일 tree 동일성을 확인했다. 상태는 execution.json이 단일 기준이다. 계약/회귀 통과와 실제 제품·모델·클라우드 통과를 구별한다.

| 문서 | 내용 |
| --- | --- |
| [01-assignment.md](01-assignment.md) | 과업·검증·이슈·결정·운영 상세 |
| [02-procedure.md](02-procedure.md) | 과업·검증·이슈·결정·운영 상세 |
| [03-quality-gates.md](03-quality-gates.md) | 과업·검증·이슈·결정·운영 상세 |
| [04-issues.md](04-issues.md) | 과업·검증·이슈·결정·운영 상세 |
| [05-contracts-and-decisions.md](05-contracts-and-decisions.md) | 과업·검증·이슈·결정·운영 상세 |
| [06-operations.md](06-operations.md) | 과업·검증·이슈·결정·운영 상세 |
| [07-records-and-handoff.md](07-records-and-handoff.md) | 과업·검증·이슈·결정·운영 상세 |
| [08-document-review.md](08-document-review.md) | 과업·검증·이슈·결정·운영 상세 |
| [09-baseline-and-data.md](09-baseline-and-data.md) | 과업·검증·이슈·결정·운영 상세 |
| [10-persona-review-and-improvements.md](10-persona-review-and-improvements.md) | 과업·검증·이슈·결정·운영 상세 |
| [11-plan-readiness-review.md](11-plan-readiness-review.md) | 과업·검증·이슈·결정·운영 상세 |

## 단계별 증거

이 커밋은 준비 문서와 계획만 포함한다. W01~W04는 실제 수행 기록에 따라 뒤따르는 커밋으로 순서대로 연결한다.

## 과거 자료

[조사 아카이브](../../project-baseline/2026-11-06/README.md)와 [v1 계획](../2026-11-06/README.md)은 당시 기록 그대로다. 개인 PC/조사 사본 경로가 남아 있어 새 체크아웃의 실행 경로로 사용하지 않는다. 실제 카톡·DB·키·임시 pytest 폴더는 복제하지 않았다. 원시 logs는 fixtures/fake 환경의 과거 증거이며 자동 재실행 결과로 오인하지 않는다.
