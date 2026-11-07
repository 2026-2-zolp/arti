# W03 회귀기반 작업 기록

2026-11-08 / 상태: **complete**, [G2 검토](gate-review.md)에서 AC06 회귀기반 인수 통과. W02/G1 검토통과 후 착수했다. 결함 수정 완료가 아니다.

## 실제 실행

- 기준: work/arti ae0e58e, 제품 소스 변경 없음.
- 환경: Node22.23.1, 기존 backend tsx. 실제 Express 앱+각 검사마다 새 :memory: SQLite DB, 로컬 fake model HTTP. 실제 team arti.db/업로드/LLM키는 쓰지 않음.
- 명령: 프로젝트 루트에서 `work/arti/backend/node_modules/.bin/tsx.cmd --test docs/execution-plan/2026-11-07/records/W03/regression.test.mts`.
- 현재 저장소 루트의 재실행 명령: `backend/node_modules/.bin/tsx.cmd --test docs/execution-plan/2026-11-07/records/W03/regression.test.mts`. 위 명령의 `work/arti` 접두사는 편입 전 작업공간 기준이다. 먼저 backend 의존성을 설치해야 한다.
- 최초 제한환경 실행은 localhost fetch가 차단되어 9건 모두 환경오류. 로컬 HTTP 허용 실행에서 종료코드0, **9/9 통과**. 코드 결함이 없다는 뜻이 아니라 아래 현재 동작을 정확히 재현했다는 뜻이다.
- 결과: results.json, 전체 로그 regression.log. 테스트 fixture의 admin/admin1234는 기준 코드가 자동 생성하는 공개 데모값이며 실제 계정이 아니다. 테스트는 인메모리 DB 밖에 저장하지 않는다.

| 검사 | 실제 관측 | 목표 계약 |
| --- | --- | --- |
| R01 | draft/pending 조회와 질문 모두200 | 공개404·호출차단 |
| R02 | guide 미확정이면 confirmed summary를 새 초안으로 덮음 | 산출물별확정보호 |
| R03 | fake생성→guideIntro/질문/힌트/상태 수정→API저장→재조회 보존 | 보완된 부분 재구현 제외 |
| R04 | referenceUrl/artist 수정 후 confirmed 유지 | 근거버전/재검수 |
| R05 | 동일 회원·같은visitId 두POST→DB2건, 이유 누락 | DB1건·사유보존 |
| R06 | 무효Bearer→guest200·DB미저장 | 401/재인증·pending보존 |
| R07 | 무토큰guest200·DB추가0 | 정책유지+persisted:false |
| R08 | 반대 선택빈도인데 태그배열평탄화로 같은 점수 | counts보존·계약수식 |
| R09 | approved 위치없음0건/위치있음1건 추천 | 정책유지 |

## 실제 React 화면 검증

- 도구: CUA IAB의 실제 브라우저, 기존 React Vite5177→별도localhost API4017→:memory: DB. browser-server.mts가 시험계정을 생성하고 HTTP method/path/status/DB회원기록건수만 browser-http.jsonl에 저장한다. 개인정보/토큰본문 로그 없음. 실제AI/실기기 시험 아님.
- **정상 회귀/기존관측 정정:** 시험회원 로그인→U05 다섯쌍선택→U07 30분→U08 3작품. 뒤로→1시간→다시추천→U08 5작품. HTTP journal에 새POST /recommendations 확인, time-change.png에5개작품표시. U07.next의 setRecommendations([])가 정상 무효화한다. W01 reducer단독 결과는 실제이용경로전체의결함 증거가 아니며 과거 해석을 정정한다. F02의 다른변경/경합은 AC13 후속대상.
- **실패 회귀:** 5작품추천→지도→관람시작 후 fixture에서 해당 시험회원 세션만 만료. 실제UI에서 알려진 receipt URL로 직접진입(추천5점/완료관람0점의 재진입 사례). 실제 AX관측은 “관람기록에 저장되었어요”지만 POST /visits 200의 memberVisitRows=0. browser-observations.md에 도구관측 발췌+HTTP를 연결했다. expired-member-receipt.png는 3초문구가 숨겨진 후의 보조화면이며 문구증거로 쓰지 않는다. 전작품완주/정상회원저장 시험으로 주장하지 않는다. 무효Bearer가guest처리되는 R06과UI의2xx저장완료처리가 실제연결됨.
- **기존 가이드 저장 보완 확인:** admin로그인→aw-01 편집에서 guideIntro='회귀검사용 가이드 도입', 질문|힌트='회귀검사용 관찰 질문 | 회귀검사용 힌트'→가이드확정→페이지새로고침. 세값과확정상태모두유지. browser-http.jsonl PUT200/GET200과 guide-reloaded-ax.txt/guide-reloaded.png 연결. 실제모델 생성은R03 fake로만 검사했고 UI에서는수동수정/확정저장 경로를 확인했다.

기존 W01 frontend 타입/빌드·backend38·AI fake17 증거를 보존한다. 제품소스 불변이므로 새로 작성한9회귀를 실행했다. private reducer 복사/주입 검사는 이번 W03에 포함하지 않았다. 독립 검토에서 결과와 기준해석 정정의 적정성을 확인해 G2를 통과했다. 임시 API/Vite는 종료했다. 다음은 W04이며 실제모델·실기기·AWS·새API·제품이슈종결은 별도다.
