# G3 대상 API·DB·Docker 인수 검토

2026-11-08 KST / **W04·AC08~AC10·G3 pass**.

## 구현과 검증

| 기준 | 실제 증거 | 판정 |
| --- | --- | --- |
| AC08 계약 | Django/DRF전시·작품·coverage/pool/추천·관리자읽기,실제React최소흐름,계약차이표,타입/빌드,공개필터/보호미디어 | pass |
| AC09 PostgreSQL | 실제PostgreSQL17.11의새testDB migration/24검사·반복fixture·FK/JSON/null/날짜/외부ID/좌표/유일성·schema일치 | pass |
| AC10 Compose | 빈기동자료/계정0·DBhealthy→migration→APIready·실제컨테이너재생성/DB·파일보존·운영fixture거부·명시bootstrap | pass |

관련파일: README.md,contract-delta.md,browser-observations.md,postgres-tests.log,empty-startup.log,fixture.log,compose-check.json,compose-events.json,bootstrap.log,frontend-typecheck.log,frontend-build.log,frontend-container.log,source-state.json. PNG/AX/이미지DOM도별도보존했다.

## 독립 검증단

- technical_review: actual코드·실행로그·브라우저AX/보호이미지JSON·Compose재생성·42파일해시·최종빌드를대조해 **AC08~10/G3 기술검토통과**,남은필수지적없음.
- scope_review: 팀/교수/범위관점에서기존React재사용·실제Postgres/Compose·가상fixture표시·후속미구현경계·42파일SHA불일치0을확인해 **G3 최종인수통과**,남은필수지적없음.
- visitor_review: 비공개이미지의프론트연결누락을지적했고수정후헤더인증·내부URL제한·요청취소/objectURL해제·A04/A05연결을재검토해코드상해결확인. 이후작성자가실제pending작품/blob이미지·draft도면을브라우저에서검증했다.

이는별도AI검토와실제개발환경실행을함께사용한판정이다. 실제팀·교수승인/실제관람객실험/사람작품검수는아니다. 구현자와검토자역할을구분했고문서존재만으로통과시키지않았다.

## 보완 루프

순환import→호출시import; nullable/빈JSON검증→모델/migration일치; fixture중복ID→기존객체검증upsert; private media 프론트누락→인증fetch+blob; 빠른URL전환→기존resolved무효화; Django데모힌트→발급계정안내. 각보완후관련Postgres24건/타입·빌드/브라우저·독립검토를수행했다. 초기실패로그를보존했다.

## 통과의 제한

기존 backend/Express/ai-service코드는보존했으며새Django전체전환이완료된것이아니다. 관리자쓰기/검수변경·회원인증·관람기록·U10도슨트맥락은W05,실제LLM/태그모델은W07이다. 실제로컬팀DB자료인수/유영국사람검수/실기기전체여정/AWS/CI/CD/운영복구는미통과다. 단위모델/조회가있다는이유로해당F이슈들을closed하지않는다.

코드변경은로컬work/jun-eok-refactor작업트리이며source-state.json으로식별한다. 원격push/실제자료변경없음. 검증후임시관리자·세션을제거하고프로젝트컨테이너를정지하되namedvolume은보존한다. 다음은W05다.
