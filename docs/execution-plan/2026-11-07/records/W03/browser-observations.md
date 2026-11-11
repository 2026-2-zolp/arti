# 실제 화면 관측 기록

2026-11-08 KST / CUA IAB, localhost5177 React→4017 fixture API. 실제 사용자 실험이나 실제AI 시험이 아니다. 아래 AX 발췌는 도구가 반환한 화면 관측을 옮긴 기록이며 원본 자동덤프와 구별한다.

## B01 시간 변경 — 정상 회귀

로그인→U05 다섯쌍선택→30분/추천3점→뒤로→1시간/추천5점.

두 번째 U08의 관측: “취향과 관람 시간을 바탕으로 5개 작품을 골랐습니다.” 목록은 그랑드자트섬의 일요일 오후/절규/인상,해돋이/별이빛나는밤/붉은방 5점. time-change.png와 HTTP journal의 두 차례 추천 요청군으로 뒷받침한다. UI에서 새POST가 발생하므로 reducer 단독 시험만으로 과거목록잔존을 단정한 결론을 정정한다.

## B02 만료 회원 영수증 — 잘못된 성공 표시

같은 시험회원으로 지도→관람시작. 시험호스트의 __fixture/expire로 user세션만삭제, known receipt URL 직접진입. 실제 CUA getAXState 응답 발췌:

```text
URL: http://127.0.0.1:5177/exhibitions/ex-mvp/receipt
heading 아트 영수증
관람 작품 0점 / 추천 작품 5점
text AI 취향 해석
text 다음 관람에서는 평소와 다른 분위기의 작품도 한 점 골라 천천히 비교해 보세요.
button (disabled) 이미지 준비 중…
text 관람기록에 저장되었어요.
button 관람 완료
```

HTTP journal의 해당 요청군(UTC 원본로그): 19:18:53.733 /visits/interpret200→19:18:53.753 /visits200, memberVisitRows=0. 화면발췌는 실제도구관측이며 저장직후 3초간 표시되는 메시지다. **expired-member-receipt.png를 저장했을 때는 메시지가 이미 숨겨져 사진만으로 저장완료문구를 증명하지 못한다.** 이 이미지는 같은영수증/관람0·추천5점 화면의 보조자료로만 사용한다. 실제AX관측+HTTP/DB건수+U12의then(saved)/서버guest처리를 함께 근거로 삼는다. 실모델이 아니라 키없는 규칙문장이 표시됐다.

이 사례는 전체관람 완주가 아닌 영수증 직접재진입이다. 올바른 계약은 만료Bearer401과pendingReceipt보존/동일회원재인증, 저장true 확인 전 완료표시금지다.

## B03 A04 가이드 저장 — 기존 보완 정상

시험호스트의 demo admin으로 aw-01편집. 도입/질문|힌트를 회귀검사용 문자열로 교체→가이드확정→reload.

guide-reloaded-ax.txt는 실제 도구 반환을 파일로 저장한 원본AX다. 가이드 상태 확정, 도입 “회귀검사용 가이드 도입”, 질문/힌트 “회귀검사용 관찰 질문 | 회귀검사용 힌트”, 버튼 “확정 해제”가 유지된다. guide-reloaded.png와 PUT200→GET200도 연결된다. AI생성은 R03의 local fake 생성→수정→저장 검사와 구분한다.

시험이 끝나면 임시 API/Vite프로세스를 종료한다. 인메모리계정/수정값은 사라지고 실제소스/DB/업로드는 바뀌지 않는다.
