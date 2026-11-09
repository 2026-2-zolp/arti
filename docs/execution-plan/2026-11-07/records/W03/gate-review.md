# G2 회귀기반 인수 검토

2026-11-08 KST / AC06·W03·G2 **pass**. 결함 수정/새 API/실제AI 통과가 아니라 현재 동작의 재현 기반을 확보했다는 판정이다.

## 독립 검토

- technical_review: regression.test.mts의 실제 API/인메모리/fake 경계·9/9 로그·결과, R03 생성→수정→저장→재조회, 실제 A04 저장, 시간변경 정상정정, 만료회원 AX/HTTP/소스 연결을 확인. 최종 AC06/G2 기술검토통과·남은필수없음.
- scope_review: 정상과 결함의 분리·실제 U07 초기화·회귀3→5점·A04 확정/필드유지·만료회원 저장손실 및 직접영수증재진입 한계를 확인. AC06/G2 인수통과가능·남은필수없음.
- 작성자: 순간 저장문구는 도구AX관측 발췌로 기록하고 문구가 사라진PNG를 그문구의증거로사용하지않도록보완. 제품소스 Gitstatus clean 확인.

실제 팀/교수 승인이나 사람 사용자시험은 아니다. AI별도검토+실제브라우저/API실행의 증거를 구별했다.

## 증거

regression.test.mts / regression.log / results.json / browser-server.mts / browser-http.jsonl / browser-observations.md / time-change.png / guide-reloaded-ax.txt / guide-reloaded.png. expired-member-receipt.png는 영수증 렌더링 보조자료다. 기존 W01 빌드/타입/backend38/AI fake17 기준은 소스불변이므로 보존하고 중복실행하지 않았다.

## 정정·남은 범위

F02: W01 private reducer 단독관측으로 실제화면전체가이전추천을재사용한다고확대했던해석은정정한다. U07 30→60분은정상. 다른입력변경/늦은응답/관람중변경은 AC13에서 검증한다. F03 기존 보완은 실제API/UI에서 저장보존 확인했으므로 중복재구현하지 않고 대상API이식회귀로 관리한다.

F04/F10/F11/F14/F34/F35 등 재현된 문제는 아직 해결되지 않았다. 실제AI·모바일실기기·전체관람완주·AWS·실제자료이전·CI는 이 판정으로 통과하지 않는다. 임시 API/Vite를 종료했고 인메모리자료는 폐기됐다. 다음은 W04 모델/migration/첫공개조회·추천/Compose이며 선행 G2를 충족했다.
