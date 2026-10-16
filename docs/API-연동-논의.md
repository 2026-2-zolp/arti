# 프론트엔드·백엔드 연동 결정 대기 목록

자료: [10/15 궁금점](https://app.notion.com/p/3fa34713f16780beb95ec4e5879ba25b), [10/15 막힌거](https://app.notion.com/p/3fa34713f16780cd8e60c42f5873f688).

다음은 **확정 API 명세가 아니라 팀 논의용 체크리스트**입니다.

- [ ] QR 진입 기준: `exhibitionId` 또는 `museumId`
- [ ] 방문 ID(`visitId`) 생성 및 게스트 상태 저장 주체
- [ ] 추천 API 입력·응답(선호 작품, 관람 시간, 추천 이유·순서)
- [ ] 추천 → 2D 지도 → 감상에서 공유할 ID·작품 좌표
- [ ] 공식 작품 설명/출처/검수 상태/AI 생성 설명 필드
- [ ] 감상 질문·근거 기반 Q&A 방식과 실패 응답
- [ ] 인증 필요 범위, 회원 가입 필드·세션 정책 (후순위)
- [ ] 아트 영수증·기록 저장 규격 (후순위)
- [ ] TTS를 브라우저에서 수행할지 서버 음성을 받을지 (후순위)

### 최소 데이터 계약 후보
`exhibition_id`, `artwork_id`, `title`, `artist`, `official_description`, `source_url`, `review_status`, `image_url`, `image_rights_status`, `map_id`, `x_ratio`, `y_ratio`

이는 필드 **후보**입니다. 본격 구현 전에 한 가지 명명법을 확정해야 합니다.
