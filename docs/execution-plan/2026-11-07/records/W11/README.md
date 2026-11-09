# W11 CI 도입 — 원격 push 성공, PR 인수 대기

2026-11-09 최신 후속: [현재 코드의 로컬 CI 인수 준비](local-current-2026-11-09/README.md). 아래17/63개 등 수치는 최초 CI 도입 당시 실행 결과이며 최신 테스트 수가 아니다. W11/GCI 정식 PR 인수는 여전히 대기다.

2026-11-08 KST / 출발25c027d / dev/임준억. 사용자가 CI 도입을 요청해 기존 검토를 실행으로 옮겼다. **W11 in_progress / AC07·GCI not_run**: 원격 push의4job 성공은 확인했다. AC07이 요구한 PR 이벤트 실행은 아직 없어 전체 게이트 완료로 올리지 않는다.

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

## 실제 원격 실행과 남은 PR 확인

사용자 최종 승인 후 dev/임준억에 일반 push했다. 첫 실행 SHA는 `3750e13215db86c2b437c83ea0e410cbe289ed36`, event=push, run `42448758269`이며 [실제 Actions](https://github.com/2026-2-zolp/arti/actions/runs/42448758269)의4job이 모두 success다. 프론트13·타입/빌드, Django 실제PG63·migration, fake모델17, 계획/guardrail/계약 모두 원격 로그로 확인했다. 첫 원격 실행 실패는 없고 실패 job 숨김/skip/테스트 약화/재시도 없이 통과했다.

[원격 run/job 증거](remote-run-1.json), remote-frontend/model/django/plan.log는 연결 GitHub API로 받은 해당 job 로그다. key는 disabled/빈값, 실제유료AI/AWS배포는 없다. 이후 결과 기록만 추가한 최종 문서 커밋도 별도 push하고 해당 최신 SHA의4job까지 확인한다. 이 문서 자체의 포함 커밋과 증거 run SHA를 혼동하지 않는다.

현재 열린 대상 PR은 없다. 이번 요청대로 브랜치 push와 실제 Actions를 검증했고, PR 생성·main 병합·브랜치 보호 변경은 하지 않았다. AC07이 요구한 PR 이벤트와 required-check 적용 여부는 별도 확인 대상으로 남긴다. 따라서 W11 in_progress·AC07/GCI not_run을 유지하되 원격 push실행 성공은 별도 사실로 기록한다. GPT 키 삽입/실검증·확장·하네스는 사용자 결정에 따라 추후 함께 논의한다.

[검사 요약](validation-summary.json), [CI/CD 검토](../../../../operations/CI-CD_적용검토.md), [최종 검토/원격 기록](../../../../작업기록/2026-11-08_최종검토와원격CI검증.md).
