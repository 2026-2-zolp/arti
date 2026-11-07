# 기준선 변경·데이터 인수 판단

## 왜 새 통합본인가

사용자가 ae0e58e를 코드 출발점으로 확정했다. 광권 bb83a86에서 통합변경과 인수문서가 추가된 구조이며 기존 front/back 시점차·guide필드·최대태그수 등을 정리한 상태다. 기존 ZIP/광권코드를 다시 전체병합하지 않는다. 동섭문서의 “결정”은 구현선택 기록으로 읽고 팀최종합의/새사용자요구와 구분한다.

| 과거 조사/계획 | 새 관측/계획 |
| --- | --- |
| ZIP front+광권 backend를 별도조합 | ae0e58e 전체 저장소 기준 |
| front MAX_TASTES=6 | 8로 보완됨. 빈도는 여전히 tag[]로 소실 |
| 생성guide 필드가 front에 누락 | guideIntro/guidedLooking/guidedHints/guideStatus 반영 확인. round-trip은 회귀 확인 |
| 기존guide 자동confirmed | 새DB/새컬럼은 none, 이미confirmed인 로컬값까지 되돌리지 않음 |
| 평가이미지 Git부재 | 조사누락 정정: 캡처40장+WikiArt79장 존재(이전 bb에서도 확인) |
| W02에서 AWS예산까지 전부 확정 | W02개발 / W12운영 분리 |
| Actions완료가 로컬개발 선행 | W11 CI독립, 최종merge/release조건 유지 |
| RDS후보인데 AC필수 | 선택 Postgres 운영환경 검증, RDS 채택시 RDS |
| 도슨트 연결은 작품ID 위주 | 탭/질문/해설/history/복귀까지 후속계약/구현 |

## 실행으로 확인한 범위

research/merge-ae0e58e/backend는 기존 bb사본에 통합본의 변경 backend파일을 반영한 **부분 조사환경**이다. typecheck와 38테스트 통과. in-memory DB+fakeprovider audit에서 새전시/작품 등록, pending작품 GET/ask200, draft전시 GET200, 확정요약 재생성, URL만변경시 확정유지를 확인했다.

실제모델·전체front빌드/화면·팀원DB·AWS 검증이 아니며 G0 이상 통과로 승계하지 않는다. 원본코드/GitHub·기존 아카이브는 수정하지 않았다.

v2.1에서 정식 전체clone을 확보하고 추가검사를 실행했다. W01 실제기록 (W01 후속 커밋에서 기록 추가)을 참조한다. 위 부분조사기록을 삭제하거나 실제AI/브라우저 검증으로 승격하지 않는다.

## 로컬 arti.db·uploads가 필요한 경우

| 자료 | Git만으로 복원 |
| --- | --- |
| 테이블/기본예시/40점시드·원본캡처 | 가능 |
| 직접 수정한 해설·태그·질문·확정상태·AI분석 | 별도export 없으면 DB 필요 |
| 수동추가 전시·작품·좌표 | 별도원본 없으면 DB 필요 |
| 40장 캡처의 업로드복사본 | seed로 재생성 가능 |
| 직접업로드 도면/다른이미지 | Git에 없으면 파일 필요 |

개발착수에 로컬DB가 무조건 필수는 아니다. W01에서 고유자료 유무를 확인하고 필요하면 일관된 백업/export+대응파일manifest를 받는다. 회원/세션 전체를 기본이관 대상으로 두지 않는다. 원본보관과 개발데이터 선택을 구분한다.

이미자동변환돼 confirmed인 guide는 새코드가 초기화하지 않는다. 동섭님의 로컬 SQL수정 결과가 Git에 있지 않다는 점을 보존한다. 전체기록을 삭제해 통과하는 대신 선택적변환·검수를 정한다.

## 검수 두 층과 시드

reviewStatus는 작품/해설/출처, summary/guide/tag/emotionStatus는 AI산출물의 검수다. checkedAt:null인 capture-descriptions는 검수전AI초안인데 seed-captures는 reviewStatus approved·시연좌표·전시running으로 적재한다. “사람이 확인했다”는 증거가 아니다. 이후 로컬에서 확정한 여부는 실제export가 있어야 알 수 있다.

시드는 정상적인 초기/테스트 데이터 방법이다. 테스트격리에서는 유용하나 운영의 공식전시 승인으로 승계하면 안 된다. 새실제자료는 pending/source_check로 넣고 원자료와 AI결과를 별도로 검수한다. 태그가비어있는40점은 분석/수동등록 없이는 취향조사가 준비되지 않는다.

시드재실행은 기존행의 해설·출처를 갱신하므로 단순재생성이 아니다. 원본보관·변경diff와 guide포함 재검수 정책을 확인한 뒤 실행한다.

## 유영국 공간과 자료

전시/작품의 exhibitionId관계가 있어 새유영국 전시를 등록할 수 있다. 별도DB를 먼저 만들 필요는 없다. 자료존재·실제출품·동명작품 식별·사용가능이미지·검수태그·공식해설·좌표가 채워져야 실제관람이 된다.

20~40점은 제안범위, 파일럿3~5점은 연결검증용이며 최종전시나10점5쌍풀을 대체하지 않는다. 유영국작품이 비슷하다는 이유만으로 새모델/학습을 추가하지 말고 태그분포·동률·추천근거를 먼저 확인한다.

## 핵심 근거

- [고정 통합본](https://github.com/2026-2-zolp/arti/tree/ae0e58ebc338c17da6d4d17616fd802f03ba3bb6)
- [40점 적재 스크립트](https://github.com/2026-2-zolp/arti/blob/ae0e58ebc338c17da6d4d17616fd802f03ba3bb6/backend/scripts/seed-captures.ts)
- [해설 초안](https://github.com/2026-2-zolp/arti/blob/ae0e58ebc338c17da6d4d17616fd802f03ba3bb6/backend/scripts/capture-descriptions.json)
- [분석·상태변경 API](https://github.com/2026-2-zolp/arti/blob/ae0e58ebc338c17da6d4d17616fd802f03ba3bb6/backend/src/routes/admin.ts)
- [공개 조회·질문 API](https://github.com/2026-2-zolp/arti/blob/ae0e58ebc338c17da6d4d17616fd802f03ba3bb6/backend/src/routes/catalog.ts)

