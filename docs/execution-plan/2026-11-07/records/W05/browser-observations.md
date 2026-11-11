# W05 실제 브라우저 관측

2026-11-08 KST. CUA IAB의 실제 React 화면, Vite5178→Django4018→arti-w05 PostgreSQL. 가상 전시13점/2전시와 가상 시험 계정만 사용했다. 외부 LLM은 연결하지 않았다.

## 관측한 성공 경로

1. 비회원으로 진입, 서버가 제공한10점·5쌍의 왼쪽 작품을 선택. 취향 확인→30분→추천3점→지도→작품 원문 연결.
2. U10 가이드 탭에서 두 번째 일반 관찰 팁의 질문별 버튼으로 U11 진입. “화면에서 가장 넓게 쓰인 색은 무엇인가요?”를 이어받는 표시 확인. “화면의 파란색이 가장 넓게 보여요.” 질문 전송은503 안내로 끝나며 입력은 유지되고 AI 답변/history로 추가되지 않음.
3. U10으로 돌아가 가이드 탭이 유지됐고 새로고침 뒤에도 선택된 가이드 탭을 확인. 이후3점을 끝내 비회원 영수증에 “서버에 저장하지 않아요. 이 기기의 현재 관람에서만 확인할 수 있어요.” 표시.
4. 시험회원 로그인→5쌍 재선택→계정 취향 저장→30분 추천3점→첫 작품 좋아요/“색감이 좋아요”→3점 관람 완료. 처음에는 “저장 중”, persisted 응답 뒤 “관람기록에 저장되었어요.” 표시. 해석 버튼은 저장 전 비활성이고 저장 뒤 누르면503 실패 안내가 나오지만 저장 완료는 유지.
5. 영수증 새로고침 뒤 저장 완료를 재확인. 실제 DB 조회에서 동일 관람1건·반응1건·사유/체류 초 보존. [DB 관측](data-and-browser-db.json), [전체 AX](member-receipt-ax.txt), [화면](member-receipt.png).
6. 다음 관람에서 U06이 계정에 저장된 “풍경” 취향을 읽고 같은 취향으로 새 추천·작품 진입.

## 실패를 확인하고 수정한 경로

시험회원 세션만 DB에서 만료시킨 뒤 추천3점/완료0점 상태로 영수증 URL을 직접 열었다. 전체 관람 완주 사례가 아니라 만료·중도 진입 시험이다.

- “아직 관람기록이 저장되지 않았어요”, “같은 계정으로 로그인한 뒤 마이페이지에서 미저장 기록을 복구” 안내, 해석 버튼 비활성을 관측했다. 비회원 saved로 표시하지 않았다. [만료 AX](expired-receipt-ax.txt).
- 동일 시험회원 재로그인 후 마이페이지에 pending 복구 항목이 나타났고, 명시 확인창을 거쳐 복구 POST를 시도했다. 입력 오류400으로 실패했다. [실패 AX](recovery-input-failure-ax.txt).
- 원인은 미완료 작품 체류시간이 완료 작품 목록 밖에 들어갈 수 있는 builder였다. 현재 builder는 완료 목록으로 dwell·반응·사유를 제한하며0점/부분 관람 회귀를 추가했다.
- 기존 실패 payload를 수정하거나 다른 회원으로 이관하지 않았다. 이후 새 관람으로 성공 재시험을 시도했으나 IAB 확인창 뒤 입력이 반영되지 않고 제어 timeout이 발생했다. 새 탭/연결 재초기화에서도 이동을 확인하지 못했다.

**아래 재시험 전 보류:** 당시에는 복구 성공·pending 제거·재조회를 관측하지 못했다. API/순수 helper 시험 통과를 이 브라우저 증거로 대신하지 않는다.

초기 docent/guide/guest AX 저장 시 diff가 “no change”만 담긴 파일은 capture-incomplete 접두사로 구별했다. 위1~3은 실제 도구 관측을 이 문서에 서술한 것이며 불완전 파일을 전체 AX 증거라고 인용하지 않는다. 당시 남은 관리자/예외 화면은 아래 최종 재시험에서 확인했다. 실제 모델 성공 대화·실기기/학습효과를 주장하지 않는다.

## 브라우저 문제 해결 후 최종 재시험

native JS confirm 뒤 전체 입력이 막힌 문제를 페이지 alertdialog로 교체했다. 명시 확인 절차·취소 기본 focus·Tab/Escape·경로/계정/관람 변경 취소·중복 요청 방지를 유지했다.

| 실제 경로 | 결과 | 증거(동명 png 포함) |
| --- | --- | --- |
| 새 회원관람1/3 완료 후 만료·중도 영수증 | 미저장 안내, guest강등 없음. 동일회원 재로그인→pending1점. 확인취소시 유지, 명시확인후 복구성공·pending제거·목록2건 | g4-expired-new-receipt-ax.txt, g4-recovery-confirmation-ax.txt, g4-recovery-success-ax.txt |
| 복구 역사 reload·DB | 해당 visitId1건, viewed/dwell fixture-art01, like/색감이 좋아요/9초. 최종화면 풍경·1점·선호1회 | g4-recovery-db.json, g4-recovered-history-final-ax.txt |
| 관리자 편집·확정·원문수정 | 독립확정 reload, sourceVersion증가·source_check·제안강등, 옛version 저장409 | g4-admin-confirmed-roundtrip-ax.txt, g4-admin-source-stale-ax.txt, g4-admin-version-conflict-ax.txt |
| 공개제한·재승인·미연결provider | public404, 재승인만 하면 suggested비공개, 독립재확정 뒤 analyze503에도 확정유지 | g4-source-check-public-404-ax.txt, g4-reapproved-suggested-filtered-ax.txt, g4-admin-provider-unavailable-ax.txt |
| 목록확정 동시수정 | 옛version확정409→검토선택해제/최신조회→새내용읽기/체크/명시확인→1점확정성공 | g4-admin-bulk-conflict-ax.txt, g4-admin-explicit-confirm-success-ax.txt |
| pool부족·후보0 | 10점미준비 안내, 후보0를 전시전체 작품없음으로 표현하지 않음 | g4-insufficient-pool-ax.txt, g4-zero-candidates-ax.txt |
| 404·재설정 | 잘못된 전시/작품의 재조회/목록, 메일미발송 안내·로그인링크 | g4-missing-exhibition-ax.txt, g4-admin-missing-artwork-ax.txt, g4-password-reset-disabled-ax.txt |
| 목록GET503·추천POST200 | spinner종료·지도비활성·목록독립retry. 정상화후 버튼으로3점목록/지도활성 | g4-catalog-unavailable-ax.txt, g4-catalog-retry-success-ax.txt, g4-fault-http.jsonl |
| 실제Vite5179중단뒤 retry | fetch연결끊김 안내·retry·지도비활성. 서버재시작뒤 개발HMR자동재연결로3점목록 회복 | g4-connection-lost-ax.txt, g4-connection-service-restored-ax.txt |

fault-proxy.mjs는 로컬시험 전용이며 제품/Compose에 연결하지 않는다. method/path/status만 기록하고 body/header/token은 남기지 않는다. 최초 catalog-once는 개발 이중effect로503후200이 되어 지속오류 검증에 부적합했다. catalog모드로 해당GET을503고정한 뒤 pass로 바꾸고 수동retry했다. 연결중단의 회복은 HMR자동재연결이며 수동retry성공으로 바꾸어 기록하지 않는다. 회귀는 test_arti, 브라우저는 arti-w05 DB로 분리했다.
