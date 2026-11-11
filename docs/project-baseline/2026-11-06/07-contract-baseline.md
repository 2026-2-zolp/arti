# 통합 계약 대조표 — 착수용 초안

현재 코드에서 읽은 규격과 앞으로 정할 규격을 분리했다. 아래 “제안”은 구현된 필드가 아니다. 모든 경로 앞에는 현재 /api가 붙는다.

| 흐름 | 현재 프론트·백엔드 접점 | 차이/다음 계약 |
| --- | --- | --- |
| 전시/작품 | GET /exhibitions, /exhibitions/:id, /artworks?exhibitionId=..., /artworks/:id | 공개 승인 필터 서버 적용. 관리자 목록은 공개 목록과 별도 권한 경로 검토 |
| 취향 | U05 선택 ID는 화면 상태, tastesFromPicks는 최대6태그; 서버는 최대8태그 수신 | 프론트의 “서버 max6” 주석도 오래된 상태. 선택풀 버전·10점5쌍, selectedArtworkIds/tagCounts/editedTastes 제안. 최종 수식은 D02에서 확정 |
| 추천 | POST /recommendations {exhibitionId,tastes,duration}, Recommendation[] 응답 | duration은 30m/60m/relaxed. Recommendation은 artworkId/order/reason/matchedTags/matchedCard/score/aiTags. 입력 변경 시 무효화 |
| 지도 | position/entrance x,y:0~100; floorPlan width/height:원본픽셀 | 단위를 보존. 벽·통로 없는 선은 실제 최단 보행 경로로 표기하지 않음 |
| 작품 해설 | description,source,referenceUrl,reviewStatus / summary,summaryKeywords,summaryStatus | 공식 원문과 AI 요약은 구분. reviewStatus 승인만으로 모든 AI필드를 확정하지 않음 |
| 관찰 가이드 | 양쪽 guidedLooking; 백엔드만 guideIntro/guidedHints/guideStatus | 프론트 타입·병합에 3필드 누락. 생성 응답 전체 반영 및 서버 버전 검토 |
| 관리자 분석 | POST /admin/artworks/:id/analyze {useImage}; artwork/emotion/summary 응답 | 프론트 응답 타입도 guide/tag의 실제 상태를 제대로 반영하는지 점검. 생성 성공과 검수 확정은 분리 |
| 관리자 저장 | PUT /admin/artworks/:id 전체 객체 | 누락 필드 기본값으로 덮어쓰기 위험. 필드 PATCH 또는 버전 기반 저장 중 작은 방식 선택 |
| 질문 | POST /artworks/:id/ask {question} → {answer} | visitId·제한된 history·mode·sourceIds·유보/오류 표식 제안. 실제 모델 성공과 fallback 분리 |
| 맞춤설명 | POST /artworks/:id/explanation {tastes} → {text} | UI 요약과 개념 혼용. 실제 사용 경로·개인화 입력 확인 후 중복 줄임 |
| 영수증 해석 | POST /visits/interpret {viewedArtworkIds,reactions,dwell} → text/source/emotionProfile | 여기에는 이미 claude/fallback source가 있음. ask에도 같은 수준의 구별 필요. 저장 자체는 AI 결과 대기와 분리 |
| 관람 기록 | POST /visits → 회원201/비회원200. GET /users/:id/visits, /visits/:id | reactionReasons/dwell/선택원본은 VisitRecord에 없음. 어떤 항목을 최종 저장할지 확정; visitId/idempotency 제안 |
| 회원 | POST /auth/login,/auth/signup → user/token; Authorization Bearer | Django 전환 인증 계약 한 번 결정. 개인 OAuth 계획을 구현 완료로 세지 않음 |
| 관리자 | POST /admin/login → name/token; X-Admin-Token | 일반 회원 권한과 분리, 업로드·검수 권한 확인 |
| 미디어 | /uploads/:file, 작품 이미지/도면 업로드 전용 API | 현재 showImage=false는 사용자 이미지 숨김 의도. 공개 파일 직접 접근 정책도 목표 환경에서 확인 |

고정 코드 근거: [프론트 타입](../../../research/frontend-share-1106/frontend/src/types.ts), [API 클라이언트](../../../research/frontend-share-1106/frontend/src/api/client.ts), [백엔드 스키마](../../../research/kwangkwon-bb83a86/backend/src/schemas.ts), [백엔드 타입](../../../research/kwangkwon-bb83a86/backend/src/types.ts).

취향 태그는 landscape/people/abstract/light/vivid/cool/warm/soft, 감정은 calm/joy/sadness/tension/awe/nostalgia다. **light는 단순히 밝은 그림이라는 뜻이 아니라 빛·광원·광채 태그**라는 평가 자료 설명을 보존한다.

최소 결정 예시: A작품(풍경+따뜻함), B작품(풍경)을 고르면 풍경2/따뜻함1을 보존한다. 사용자가 따뜻함을 끄면 선택 원본은 남기고 추천 적용 프로필만 바뀌는지 정한다. 가중 추천 도입 전에도 원본을 보존해야 이후 평가가 가능하다.

현재 응답을 깨는 변경은 공통 타입·서버 검증·프론트 호출·회귀 사례를 같은 작업에서 바꾼다. 과거 설계의 museum_id/int PK를 프론트 exhibitionId/string ID에 바로 대입하지 않는다.

