# W04 Django·PostgreSQL·Docker 구현 기록

2026-11-08 KST. 상태: **W04 완료·AC08~AC10/G3 통과**. [독립 인수 검토](gate-review.md). 실제 상태는 execution.json 기준.

## 구현과 실제 경계

- work/arti/backend-django에 Django5.2.19/DRF3.16.1 API, PostgreSQL전용 설정, 명시적0001 migration과6개도메인모델을 추가했다. SQLite fallback은없다.
- 공개전시/작품·coverage·taste-pool·추천, 관리자읽기/최소opaque로그인·로그아웃, 보호미디어, health/ready를구현했다. React는읽기helper와보호이미지연결만수정하고화면구조를유지했다.
- Compose의db healthy→별도migration성공→api ready→선택적frontend순으로기동한다. DB와media는서로다른namedvolume, API/UI는localhost4018/5178만공개하고DB호스트포트는없다. API는비root로실행한다.
- 기존backend/Express와ai-service/FastAPI는변경하지않았다. W05의관리자쓰기/검수stale/회원/대화/관람기록·W07실제AI는아직미구현이다. 공개릴리스/AWS/CI/실기기완주가아니다.

실행안내: [새 API README](../../../../../backend-django/README.md). 기존Express4000과새Django4018을구분한다. Compose UI는명시적으로VITE_API_TARGET=django를쓰며fallback하지않는다.

## AC08 — 계약과 첫 흐름

- [계약 차이/프론트 인수](contract-delta.md): 공개필터/DTO·관리자읽기·profile·미디어·미구현경계를구분한다.
- postgres-tests.log: 공개/관리자상태·UI안전DTO·추천형태/3·5·7점·pool·서버빈도·오류·보호미디어등실제API검사.
- browser-observations.md와react-recommendation-ax.txt/png: 실제기존React가Vite→Django→Postgres로전시진입·비회원선택·추천3점·지도·원문표시까지연결됐다. 실제미술품/AI품질/전체관람완주가아니다.
- admin-private-ax.txt/png/json와admin-draft-plan-ax.txt/png: 미검수작품/비공개전시를admin읽기API로조회, 보호이미지는헤더인증fetch→blob URL/decodedwidth1로표시. 1×1fixture이므로미술이미지품질은검증하지않았다.

## AC09 — 실제 PostgreSQL

- postgres-tests.log: **24건통과**, 새test_arti DB생성→arti/contenttypes migration→FK/JSON/null/문자열ID/연도/UTC/좌표/상태/관람유일성검사→시험DB제거. connection.vendor=postgresql을assert한다.
- empty-startup.log: 기본개발DB첫기동후전시/작품/계정/세션전부0.
- fixture.log: 명시적개발fixture2회적재,전시2·작품13·계정0. 기존human자료인수/자동승인으로사용하지않는다.
- migration-drift.log와Compose검사이벤트: makemigrations --check --dry-run에서변경없음.

## AC10 — Compose·영속·안전초기화

- compose-check.json/compose-events.json: 실제API와DB컨테이너ID모두변경되도록force-recreate. 전후전시2/작품13/계정0·markerVersion7·media SHA256 동일. PostgreSQL17.11실행확인. localhost상태확인성공.
- ARTI_ENV=production에서는ALLOW_TEST_FIXTURES=true여도load_test_fixture exit1. 시작명령에fixture/기본계정생성없음.
- bootstrap.log: 명시적검증용관리자생성. Postgres검사에서비밀번호해시/약한비밀번호거부/기존자격덮어쓰기거부/출력비노출을확인했다. 개발비밀번호/토큰은문서/증거파일에기록하지않는다.
- 운영용secret예제값을거부하고개발helper는무작위값을Git무시env에생성,기존파일을덮지않는다. Compose는개발용DB관리권한이며AWS최소권한/백업복구는W12/W08에서별도검증한다.

## 실패→수정→재검증 루프

| 회차 | 발견 | 조치와 증거 |
| --- | --- | --- |
| 구현초기 | DRF설정로딩중exception handler순환import | handler의DRF view import를호출시점으로이동,systemcheck정상 |
| DB1 | null위치의Django full_clean이blank오류 | nullable/빈JSON 의미를모델·migration에일치,초기실패로그보존 |
| DB2 | fixture재적재가새객체로기존PK중복검사 | 기존객체를검증후upsert,24/24재검증통과 |
| 검증단1 | 보호미디어API만있고React img인증누락 | 내부경로만헤더fetch·Abort/objectURL해제,실제미검수작품/도면표시확인 |
| 검증단2 | 빠른A→B→A이동시revoke된URL잔존가능 | 새보호요청시resolved초기화,타입/빌드검증. 토큰URL/외부전송없음 |
| 화면 | Django에도옛데모로그인힌트가표시됨 | Django대상은발급계정안내로전환,기존Express비교모드는유지 |

## 중복/범위 확인

F03가이드저장보완을재작성하지않았고기존Express기능도고치지않았다. sourceVersion/검수상태변경쓰기와visit-idempotency모델준비가있어도W05실제쓰기/동시성검증을통과한것은아니다. 제품F이슈는이단계만으로closed하지않는다. 기존아카이브38파일은보존한다.

W04관련소스의현재HEAD/diff/해시와실행환경은source-state.json을본다. 기반이후HEAD는아직ae0e58e이고코드변경은로컬작업트리이며원격push하지않았다. W02 source-inventory는수정전기준자료로보존한다.

W02검사기는기존인벤토리/해시를바꾸지않고고정Git기준선을읽도록보완했다. 이후의의도적작업트리수정을G1기준선손상으로오판하지않으며현재구현은W04의별도소스해시/실행검사로검증한다.

## 이번 저장소 이력 정리

위 원시 로그는 실제 구현/검증 시점의 기록이다. 2026-11-08에 dev/임준억으로 정리했고 로컬 과업별 커밋을 남겼다. 당시 work/jun-eok-refactor/절대경로 표기는 이력이며 현재 브랜치를 뜻하지 않는다. 재실행용 Python/MTS helper의 루트 탐색만 저장소 상대경로로 보완했다. 원래 source-state.json은 검증 당시 증거로 보존하며, 이번 커밋의 코드 동등성/이식 차이는 repository-handoff.json을 별도로 본다.

커밋 전 재확인: commit-recheck-postgres-tests.log의 실제Postgres24건통과, commit-recheck-frontend-typecheck.log/commit-recheck-frontend-build.log의타입·빌드통과. W03상대경로이식9회귀도재실행통과했다. verify_repository_handoff.py는병합원본tree/동섭원문바이트/검증된42파일내용/문서링크를검사한다. capture_source.py는과거증거를덮지않고별도 *-current 파일에현재상태를기록하도록보완했다.
