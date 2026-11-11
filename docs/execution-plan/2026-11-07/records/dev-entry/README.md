# Django 개발 실행 일관화 — 완료

2026-11-08 KST / 출발ad81f7c / dev/임준억. 기존 W04/W05 전환의 후속 보완이며 새 제품 기능·자료·모델 게이트를 통과시킨 것은 아니다.

| 완료 기준 | 실제 결과 |
| --- | --- |
| 기본 API/관리자 경로 일치 | 공통 apiTarget에서 undefined→django. dev/preview 기본4018, client 관리자 /admin 및 보호 uploads 적용 |
| Compose 유지 | http://api:8000 명시 override 유지. 실제 Compose관리자 로그인·미검수작품 조회·보호이미지 blob loaded=true |
| 호스트 실제 흐름 | VITE 설정 없는5180에서 회원로그인·저장취향·3점추천·지도·작품·영수증 저장 성공. Compose회원 마이페이지에서 같은3점 기록 재조회, 시험회원 총3기록 |
| 키 없는 AI | 호스트 U10→질문 전송503, 입력 보존. 실제키/유료호출 없음 |
| API 중단/복구 | 시험 Django 중단→UI오류 및 재시도, 복구→버튼 재시도 성공. 콘솔 연결실패 대상4018 확인, 자동다른API요청코드없음 |
| 설정 오류/우선순위 | 오타/빈target·부적절proxy거부, 실제 loadEnv+설정함수에서 frontend mode파일/process우선/Compose주소/target define 확인 |
| preview | Django build→실제preview5181 전시조회 성공. express설정만 바꾼 preview CLI는 exit1로 거부. missing/mismatched manifest hook 회귀 확인 |
| 명시legacy | express default4000의 설정·build manifest 확인. 별도ignored outDir에 Express번들 실제build 성공. 기존Express전체기능을 다시시연한것은아님 |
| 자동검사 | 프론트17회귀(기존13+신규4), 타입·Django/Express build 성공. Linux Node22 clean npm ci→17·타입·build 성공 |

## 변경 위치와 이유

frontend/src/lib/apiTarget.ts에 공유 대상/프록시 규칙을 만들었다. vite.config.ts는 frontend 위치에서 VITE_만 loadEnv하고 계산한 target1키만 define한다. admin 경로도 같은규칙을 사용한다. preview는 기존번들을 바꿀수없어 target/base만 담은 arti-build.json을 만들고 설정이 다르면 재build를 요청한다. 실제 서버 종류를 포트로 추정하지 않는다.

frontend/.env.example·현재 Django실행 안내를 추가했다. 루트/프론트/API/처음시작/Windows안내에서 현재기준과legacy를 구분했다. Python 초기화 도구 조건도 포함한다. GPT 키·provider·백엔드 모델·Compose DB설정·기존원본/아카이브는 바꾸지 않았다.

## 실패와 보완 루프

첫 프론트검사14/16: 신규검사의 관리자함수명을 잘못 적었고 직접 ESM로 설정함수를 실행하면서 기존 __dirname 사용도 드러났다. 실제 listAdminArtworks를 호출하고 configroot를 fileURLToPath로 통일한 뒤16통과. frontend mode파일/preview보호까지 검사1개를 추가해17통과했다. 최초 config API 오타를 통과로 처리하지 않았다.

기술 검증단이 preview가 기존번들의 target을 바꾸지 못함을 지적해 manifest/시작차단을 추가했다. 최종 코드 재검토에서 필수 추가 지적0. 검사 표현은 resolveConfig 전체가 아니라 실제 Vite loadEnv·설정함수·plugin hook 검사다.

범위/관람객 검토에서 API README의 옛Express기본 문단과 frontendREADME의 옛실행절차가 현재기준과충돌함을 지적했다. 문단을 새기본으로 바꾸고 frontend/Windows옛안내를legacy로 명시해보완했다. 문서만추가하고모순된본문을현재설명으로방치하지않았다. AI 검증역할이며 실제팀/교수의승인은아니다.

## 증거와 경계

동명 txt/png: host-member/recommend/ai-disabled/receipt/admin, compose-admin/private-work/protected-image/member-history, preview-django, host-django-stopped/reconnected. 보호이미지의 blob/loaded는 실제DOM읽기전용검사로확인했다. 단독 Vite5180·Compose5178·preview5181 모두 동일arti-w05 DB다. 기본5178 포트를 두개함께켜지않고시험포트만구분했다.

시험기록은계정재로그인후 실제저장했으며 자동fixture재적재/기존자료초기화는하지않았다. 종료때시험세션4개폐기·가상계정2개dormant, 모든이번검증서비스종료·기존DB/media볼륨보존. 원격push/CI재실행은하지않는다. 기존원격CI성공을이번소스검증으로재사용하지않는다. API제품코드는변경하지않아기존PG63전체를이번에재실행했다고쓰지않는다.

[현재 실행 안내](../../../../개발실행-Django.md), [작업기록](../../../../작업기록/일지/2026-11-08_개발환경과CI.md#다음-과업과-django-실행-일관화).
