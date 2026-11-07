# 기록·상태·인수인계

## 단일 상태 기준

실시간 상태는 execution.json에만 기록한다. 본문은 기준/절차 설명이며 매번 상태표를 수동 동기화하지 않는다. 이슈표의 현 관측은 작성일 기준이다. 필요할 때 JSON에서 요약을 생성한다.

- task: planned/in_progress/blocked/complete.
- issue: open/verification_pending/in_progress/blocked/accepted_deferred/closed.
- AC/gate: not_run/pass/fail/blocked.
- F03 verification_pending은 이미 정적수정이 보여 새구현 대신 회귀검증을 한다는 뜻이다.

착수/완료에 대한 선행조건은 03-quality-gates.md와 execution.json을 함께 따른다. validator는 구조·파일존재·상태조건을 검사하고 실제 증거 내용은 검토자가 확인한다.

## 실행 기록 양식

records/ 아래 작업별 기록에 다음을 남긴다.
- 날짜(KST), W/F/AC, 구현자/검토자(동일인 여부)
- 기준SHA ae0e58e와 실제 변경커밋, 환경/명령
- 입력·fixture·모델/프롬프트/보정 버전, 사전 기대
- 실제 결과·상태코드·종료코드·로그/Actions run
- 판정, 실패 원인, 수정·재검증 범위, 다음 한 작업

API/타입/상태가 프론트에 영향을 줄 때만 [계약 변경 요약](templates/contract-change.md)의 영향화면·이전→새계약·유지사항·재현법을 함께 쓴다. 작품 인수는 [최소manifest](templates/artwork-manifest.csv), 실제한작품 기술설명은 [입력→처리→출력 추적](templates/ai-trace.md)을 사용한다. 빈양식은 완료증거가 아니다.

AC pass는 evidencePaths에 실제 기록을 연결한다. gate pass는 reviewEvidence에 실제 검토기록을 연결한다. issue closed는 resolutionEvidence와 resolvedCommit을 남기고 연결 AC가 통과해야 한다. 로컬 검토 파일이 없으면 통과할 수 없다. 실제 사용한 키·세션·개인 대화·대용량 모델을 복제하지 않는다.

## 결정 기록 양식

D-ID / 상태(제안·결정·변경·폐기) / 결정주체·날짜 / 근거·대안 / API·데이터·front·운영 영향 / 범위·수치 / 되돌릴 조건 / 확인이 필요한 입력.

코드는 현재 동작의 근거이지 요구사항의 자동 결정권자가 아니다. 사용자 최신 정정·확인된 팀결정·실제 회의·제안설계·고정코드·개인제안을 문제에 맞게 대조한다. 최근 편집일만으로 이전 합의를 폐기하지 않는다.

## 자료 기준

- 원래 조사: [보존된 출처목록](../../project-baseline/2026-11-06/06-sources.md).
- v1와 차이: [새 기준선](09-baseline-and-data.md).
- 동섭 문서의 D/A/R 번호는 F와 별도다. 새 요구를 반영할 때 인수문서를 덮어쓰지 않는다.
- [조사 실행 JSON](supporting-research/handoff-audit.json)과 [백엔드38테스트 로그](supporting-research/backend-tests.log)는 부분 backend 조사 증거다. 실제 frontend/LLM/AWS/로컬DB 복원이 아니다.

## 회차 시작/종료

시작: 최신지시→현재계획→기준커밋/diff→선행과업/게이트→관련F/AC→작업공간.
종료: 변경커밋→검사/검토→JSON상태→열린 이슈/대기입력→다음명령.

## 첫 회차 체크리스트 양식

- [ ] 정식 전체 저장소에 ae0e58e 확보, 개발브랜치 기록
- [ ] 동섭 인수문서 D/A/R와 현재 F 대조
- [ ] frontend/backend 빌드·타입·테스트와 주요결함 재현
- [ ] 고유DB/업로드가 있는지 확인, 필요자료 backup/export
- [ ] 실제원본 없이 DB초기화·타인브랜치 덮어쓰기 하지 않음
- [ ] G0 증거·검토 후 W02 개발계약 진행
- [ ] 병행 W06 자료와 W12 운영결정의 대기/진행상태 구분

위는 반복사용 양식이며 현재상태를 수동동기화하지 않는다. 실제 W01수행·G0판정은 records/W01과 execution.json을 본다.


## 커밋 완료 규칙 (2026-11-08)

W별 검증과 검토 통과 후 코드·기록·증거·상태를 같은 커밋에 남긴다. 날짜가 바뀌면 새 기록에서 이전 기록/커밋을 연결한다. 원격 푸시는 별도 요청 전 보류한다. 기존 W01~W04는 실제 수행 후 이번에 회고 커밋하는 것이며 과거 커밋을 꾸미지 않는다.
