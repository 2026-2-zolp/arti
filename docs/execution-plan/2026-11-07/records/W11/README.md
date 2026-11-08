# W11 CI 도입 — 로컬 구현 검증 완료, 원격 실행 대기

2026-11-08 KST / 출발25c027d / dev/임준억. 사용자가 CI 도입을 요청해 기존 검토를 실행으로 옮겼다. **W11 in_progress / AC07·GCI not_run**: 원격 push를 하지 않아 Actions run/PR 성공 증거는 아직 없다.

## 왜·어디를·어떻게 바꿨는가

이전에는 팀원이 합친 코드의 타입/계약/저장 오류를 각자 로컬에서 발견해야 했다. [.github/workflows/ci.yml](../../../../../.github/workflows/ci.yml)에4job을 추가했다. pull_request(모든 대상), main·dev/** push, 수동 실행을 지원한다. path filter로 필수 job을 생략하지 않고 job 이름을 고정했다.

| job | 실행 |
| --- | --- |
| Frontend checks | Node22·npm ci→실제13회귀→타입→빌드 |
| Django PostgreSQL checks | Python3.12·PG17 service→시스템 check→migration drift→migrate→전체 arti.tests. SQLite 대체 없음 |
| Model service fake checks | Python3.12·requirements-dev→17회귀, preload/offline 설정. Torch·모델·유료 키 없음 |
| Plan and contract checks | 전체 Git history checkout→계획·guardrail·W02 pinned 계약 검사. 로컬 branch 전용 인수 검사는 넣지 않음 |

frontend/package.json·package-lock.json에 tsx를 자체 개발 의존성과 npm test로 추가했다. 이전 backend/node_modules 실행기 의존을 없앴다. 프론트 제품 기능은 변경하지 않았다.

Actions 공식v6의 조회한 commit SHA를 고정하고 checkout persist-credentials=false, contents:read, 중복 실행 취소·job timeout을 적용했다. Django job은 provider disabled/OPENAI_API_KEY 빈 값, 별도 시험secret/DB/MEDIA_ROOT만 사용한다. fork PR에 저장소 비밀값을 주거나 pull_request_target을 사용하지 않는다. AWS/CD·브랜치 보호 설정은 바꾸지 않았다.

## 검증 루프와 결과

실제 Docker Linux에서 Node22의 깨끗한 npm ci·13회귀·타입·빌드, Python3.12 FastAPI17, Python3.12 계획/guardrail/계약 검사 모두 통과했다. Django는 Linux Python3.12+실제 PG17에서 전체63검사를 통과했다(같은 작업에서 별도 준비한 provider12회귀 포함). 의존성 설치와 실행 로그는 이 폴더와 W07-preparation에 나눠 보존한다.

actionlint 첫 검사에서 job env의 runner.temp context 사용 오류를 발견해 격리 Linux의 /tmp/arti-ci-media로 고쳤다. 재검사 exit0. 모델17회귀에는 Starlette/httpx deprecation warning1개가 있지만 실패는 없다. requirements-dev가 범위 버전이므로 의존성 변경으로 향후 실패할 경우 lock 도입/업데이트를 별도 검토한다.

독립 기술 검토에서 CI 범위·격리·키 제외·history 조건을 확인했으며 필수 추가 지적은 없다. 실제 GitHub runner/조직 정책/토큰/branch rule까지 로컬에서 확인했다고 주장하지 않는다.

## 푸시 이후 남은 확인

사용자 확인 후 dev/임준억에 push하면 push trigger가 실행된다. Actions 허용 여부·4job 성공·실제 run URL/SHA를 확보하고, PR 검사도 확인한 뒤 AC07/GCI/W11 종결 여부를 판단한다. 수동 workflow_dispatch는 저장소 기본브랜치의 workflow 등록 조건도 확인해야 한다. 필수 브랜치 검사 지정은 첫 실제 성공 이후 별도 결정한다. 실제 모델 시험은 일반 CI에 키를 넣지 않고 W07에서 진행한다.

이는 로컬 Docker로 job 명령을 재현한 결과이며 GitHub Actions 실행 기록은 아니다. [검사 요약](validation-summary.json), [CI/CD 검토](../../../../operations/CI-CD_적용검토.md).
