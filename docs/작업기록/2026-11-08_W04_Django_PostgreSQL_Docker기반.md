# W04 Django·PostgreSQL·Docker 기반 구현

실제수행/기록정리: 2026-11-08 KST / 담당: 임준억·AI보조 / W04·AC08~10·G3.

이전: [W03 회귀](2026-11-08_W03_회귀기준과조사정정.md), 커밋 `63fb575`. 여기부터 실제 제품 코드 변경을 포함한다. 동섭통합본 ae0e58e의 기존 Express/React를기준으로, 먼저확정한계약의조회·추천·DB·실행기반을구현했다. 전체백엔드교체완료는아니다.

## 왜 구현했는가

제안/설계의Django/PostgreSQL과실제Express/SQLite차이를정리하고, 검수전자료공개·기본데모계정같은결함을새기반에복제하지않아야했다. 기존React를다시만들지않고작은API흐름부터연결하며실제DB/컨테이너에서검증하는방식을택했다.

## 변경 위치와 전후

| 위치 | 변경 전 | 변경 후 |
| --- | --- | --- |
| backend-django/config,manage.py,requirements.* | 새API/실행설정없음 | Django5.2.19·DRF3.16.1·Postgres전용설정·고정의존성·health/ready |
| arti/models.py,migrations/0001_initial.py | SQLite수동schema/JSON | 전시·작품·계정·세션·관람·반응모델,FK/좌표/상태/날짜/버전·관람유일성제약 |
| arti/views.py,serializers.py,recommendations.py | 공개조회가미검수/초안도반환 | running+approved공개·미확정AI값서버제거·관리자읽기분리·기존DTO추천형태/3·5·7점유지 |
| arti/management/commands | 시작시알려진계정/자료자동시드 | 명시bootstrap·약한비밀번호/덮어쓰기거부·명시testfixture와운영차단 |
| compose.yaml,Dockerfile,init_dev_env.py | 언어/DB설치가각PC에분산 | DBhealthy→migration성공→api ready→선택적UI,DB/media namedvolume,localhost포트·무작위개발설정 |
| frontend/src/api/client.ts,admin화면 | 공개/관리자읽기공유 | 명시django모드admin읽기helper,기존Express비교모드유지·자동fallback없음 |
| ArtImage/FloorMap/useProtectedImage,A04/A05 | 보호이미지를img헤더로읽을수없음 | 관리내부경로만헤더fetch→단기blob·취소/해제,public이미지와분리 |
| A01Login | 새API에서도옛demo계정안내 | Django는발급계정안내,자동기본관리자0 |

기존 backend/Express와ai-service/FastAPI는고치지않았다. U05/06의원본profile전달,쓰기검수·회원·도슨트·관람기록은W05다. 현재미구현경로는501또는GET전용경로405이며실제AI/fallback성공으로위장하지않는다.

## 검증 루프와 실제 결과

1. DRF설정순환import를실행시점import로수정하고systemcheck통과.
2. full_clean의null좌표/빈JSON오류를모델·migration과일치시킴. 반복fixture가새객체PK중복으로실패하는문제도기존객체검증upsert로수정.
3. 실제PostgreSQL17.11의새시험DB에서migration/공개정책/추천/형태/빈도/오류/FK/JSON/null/날짜/좌표/유일성등24검사통과. 실패로그도보존.
4. 빈기동시전시/작품/계정/세션0. 명시fixture2회에도2전시/13작품/0계정,운영은플래그가켜져도fixture거부.
5. DB/API컨테이너ID가바뀌도록재생성해도건수·markerVersion7·media SHA동일. 이는로컬영속성검사이며AWS백업복구가아님.
6. 실제React→Django→Postgres로전시→비회원선택→추천3점→지도→원문연결. admin목록13건과미검수작품이미지/draft도면의blob표시확인. 1픽셀가상fixture이므로실제작품/모델품질근거가아님.
7. 검증단이미디어API만있고UI인증누락을지적→보호fetch/hook연결. 빠른URL전환의이전blob정리도보완. 최종프론트타입/빌드통과.

기술·팀/교수/범위검토에서42개소스해시까지대조해잔여필수0으로G3인수. 관람객/콘텐츠검토의이미지지적도해결했다. 실제팀/교수승인·사람작품검수와는다르다.

증거: [W04상세](../execution-plan/2026-11-07/records/W04/README.md), [계약차이](../execution-plan/2026-11-07/records/W04/contract-delta.md), [G3검토](../execution-plan/2026-11-07/records/W04/gate-review.md), [실행안내](../../backend-django/README.md).

## 이번 커밋 정리에서 추가로 확인한 것

W04완료작업트리를stash로보존했다가W01~W03커밋뒤복원했다. 검증당시42파일의SHA와복원파일을대조하고,줄바꿈정규화가있으면LF/CRLF변환외내용변경이없음을확인한다. 원래source-state.json은이력으로보존하고repository-handoff.json에이번브랜치/경로·현재코드동등성·소스해시를연결한다.

새문서루트에서경로만이식한검사helper를확인하며,실제Docker/Postgres24검사와frontend타입/빌드를커밋전다시확인한다. 새클라우드/실제자료/외부AI는사용하지않는다. 원문아카이브·동섭기록은바이트동일성을유지한다.

## 남은 일

다음은W05의콘텐츠검수쓰기→추천/진행상태→회원/도슨트맥락→기록→실제자료이전이다. 모델·AWS·CI/CD는해당후속단계에서별도검증한다. 로컬42파일구현은이커밋에포함되지만제품이슈를일괄closed하지않는다. 검증용관리자/세션은정리했고컨테이너는종료,볼륨은보존한다. 원격푸시없음.
