# W04 프론트·API 인수 요약

2026-11-08 / W02 확정계약의 **기반 구현분**. 전체계약완료가아니다.

| 영향 화면/경로 | 이전→새 구현 | 유지/의도적 제한 | 재현 |
| --- | --- | --- | --- |
| U01·U05·U08·U09·U10 GET catalog | 전시/작품전체공유→running+approved만 | camelCase/문자열ID/year/xy0~100유지. 공개상세는위치null가능,추천은제외 | test_public_exhibition_policy/test_pending.../실제React기록 |
| U10 DTO | suggested텍스트까지전달→서버에서원문/확정필드만 | 미확정summary/guide는''/[]/none,analysis/tagScores는null. UI숨김만의보호아님 | test_public_dto... 및react-artwork-ax |
| A02~05/07 | 공개helper→명시django모드adminhelper | admin전용GET+X-Admin-Token,일반공개API에관리자라는이유로초안섞지않음 | adminreads검사/실제목록13건·미검수상세 |
| A01 | 알려진기본계정→수동bootstrap+opaque로그인 | 기존name/token형태·header분리유지,기본admin0. Django힌트에옛데모값없음 | bootstrap검사/명시계정실제로그인 |
| 이미지/도면 | 정적파일전체공개→연결작품/전시상태검사 | public image showImage=false는DTO/파일모두제한. admin은내부URL헤더fetch→단기blob,토큰URL금지 | test_media.../실제private-image·draft-plan |
| U08 POST recommendations | tastes[]균등→기존입력호환+선택적profile빈도 | Recommendation[]/필드·3/5/7·최근접순서유지. 프론트U05의profile전달은W05 | 추천형태/빈도/버전/중복400검사 |
| taste-pool 신규GET | 없음→version/ready/5쌍/DTO | 정확10점아니면ready:false. 1픽셀fixture는품질근거아님 | pool검사 |
| /health,/ready | rule-based표기→AI미연결/process와DB준비분리 | /ready는503 DB_NOT_READY 가능,DB테이블준비확인 | ready검사/실제Composehealthy |
| 관리자쓰기/회원/관람/AI | 아직대상API미구현 | 501 FEATURE_DISABLED 또는GET전용경로405. 이전Express로넘기거나성공처럼응답하지않음 | health/unimplemented검사 |

## 실제 요청/응답 예

```json
{"exhibitionId":"fixture-ex01","tastes":["landscape"],"duration":"30m"}
```

POST /api/recommendations→200 array, fixture-art01/03/05의순서·이유·matchedTags·matchedCard·score·aiTags로기존U08이표시한다. 공개GET /api/artworks/fixture-art11은404,admin GET동일ID는200이다. GET /api/uploads/fixture-private.png는404,유효X-Admin-Token의GET /api/admin/uploads/fixture-private.png는이미지200이다.

## 다음 W05 연결

- 태그선택원본/profile를U05/06/관람기록까지연결,requestGeneration/관람변경정책.
- 실제관리자쓰기의version/If-Match·source/fact변경stale·산출물별확정보호/검수로그.
- 회원인증/bootstrap상태·expired pendingReceipt·visit저장/중복·과거snapshot·관리자반응조회.
- U10→U11진입맥락/history/복귀·provider실패. 실제생성/태그모델평가는W07.

기존정상UI/DTO를보존하되위미구현경로를완료로표현하지않는다. 새환경실행은backend-django/README의Compose경로한가지를따르고기존Express비교는별도모드로만한다.
