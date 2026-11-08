# ARTI CI/CD 적용 검토

2026-11-08 KST / W05 코드 및 GitHub 저장소 메타데이터 기준. **검토·준비 문서이며 workflow 생성·Actions 실행·AWS 배포는 하지 않았다.**

## 결론과 프로젝트에서의 효용

**CI는 적용 가능하고 지금 효과가 크다.** 팀원이 AI로 각자 수정한 코드를 합칠 때, API 계약/검수 상태/DB 저장/화면 타입이 다시 어긋나는 것을 PR마다 빠르게 찾는 용도다. 이번에 실제 실행한 Django51검사·프론트13검사·타입/빌드를 이미 재사용할 수 있다. 교수님에게도 단순 “실행됐다”보다 재현 가능한 회귀 근거를 제시할 수 있다. AI 답변의 사실성·작품 데이터 품질·사용성을 CI 성공으로 대신하지 않는다.

**CD도 가능하지만 AWS 운영 결정을 마친 뒤 적용한다.** 로컬 Compose 성공만으로 외부 배포와 DB 복구가 준비된 것은 아니다. 계획의 W11(CI), W12(운영 결정), W09(CD) 경계를 유지한다. 지금 외부 서비스나 복잡한 배포 플랫폼을 추가할 필요는 없다.

저장소는 public·기본 브랜치 main이고, 로컬에는 `.github/workflows`가 없다. 연결 계정의 저장소 push/admin 권한은 조회됐지만, 조직의 Actions 허용 정책·환경 승인 설정·로컬 Git 쓰기 인증은 별도 확인 대상이다. 원격 실행 기록이 없으므로 GCI/배포 게이트는 not_run으로 유지한다.

## W11에서 구현할 최소 CI

| 검사 | 실행 환경·명령의 핵심 | 통과 기준과 주의 |
| --- | --- | --- |
| React | Node22, lock 기반 npm ci, typecheck, build, 실제 frontend/tests | 13회귀·타입·빌드 성공. 현재 tsx 실행기는 legacy backend 의존성에 있어 backend npm ci도 필요하거나 frontend devDependency로 정리해야 함. Linux에서는 .cmd 제외 |
| Django/API/DB | Python3.12, requirements.lock, PostgreSQL17 service, check, makemigrations --check --dry-run, manage.py test arti.tests | 실제 PG51검사 성공. JSON/FK/잠금/동시성을 SQLite로 대체하지 않음. ARTI_ENV=test·ALLOW_TEST_FIXTURES=true·시험용 secret·격리 MEDIA_ROOT |
| FastAPI 회귀 | 기존 requirements-dev의 가벼운 fake 테스트 | 기존17회귀 재사용. Torch/모델 다운로드·실제 LLM/AWS 키를 PR에 요구하지 않음. 실모델 품질은 W07 평가 |
| 계획·계약 | verify_plan.py, verify_guardrails.py, W02/verify_contracts.py | 기준 커밋/보호 아카이브를 읽을 충분한 Git history 필요. 생성 JSON 보고서는 artifact로 보존하고 검사 중 tracked 파일 변경 여부를 구분 |

PR→main과 개발 브랜치 push/수동 실행을 중심으로 구성하고, 작업명은 고정해 추후 required checks로 연결한다. 중복 실행은 concurrency로 정리한다. 먼저 한 번 원격 실행해 Linux 경로·fixture·Postgres healthcheck를 확인한 뒤 브랜치 보호의 필수 검사로 지정한다.

`verify_repository_handoff.py`는 dev/임준억의 로컬 인수·커밋 이력을 확인하는 도구다. detached HEAD의 일반 PR 검사에 그대로 필수화하지 않는다. W03의 예전 결함 재현도 현재 제품의 성공 기준과 혼동하지 않는다. CI용 검사를 분리하거나 branch-neutral 옵션을 추가할 때에는 별도 변경/검증한다.

GitHub Actions는 PostgreSQL 서비스 컨테이너를 지원하며 컨테이너 서비스 job에는 Linux runner가 필요하다. runner에서 실행하는 job은 localhost/노출 포트로, container job은 서비스 이름으로 연결한다. [GitHub 공식 PostgreSQL service 안내](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers). push/PR/수동 실행은 [공식 trigger 안내](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)를 기준으로 구현한다.

## W12→W09에서 결정할 최소 CD

1. AWS 계정·리전·예산·공개 주소/TLS·운영 담당, PostgreSQL의 RDS/자체 운영 선택, 업로드 영속 저장소와 접근 정책을 먼저 결정한다. 로컬 PostgreSQL17 선택은 AWS 연동을 방해하지 않지만 서비스/버전/비용까지 확정한 것은 아니다.
2. CI를 통과한 동일 commit의 불변 이미지 digest를 배포한다. 초기에는 workflow_dispatch와 명시 환경 승인을 사용하고 배포는 한 번에 하나만 진행한다.
3. migration은 한 번 실행하며 실패 시 새 앱을 올리지 않는다. readiness와 회원/관리자/자료 비공개 smoke를 확인한다. 앱 이미지 rollback과 DB 백업/복구를 구분하고 실제 복구 연습을 한다.
4. AWS 인증은 장기 키를 저장하기보다 최소 권한 OIDC role을 검토한다. CI는 contents:read, 배포 job에만 필요한 id-token:write와 제한된 role/environment를 둔다. trust policy는 대상 조직·저장소·환경의 실제 claims로 제한한다. [GitHub 공식 AWS OIDC 안내](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).

현재 W05에서 workflow/CD까지 확대 구현하지 않았다. 다음 W의 실행 순서와 GCI/GOPS/GDEP 통과는 기존 계획 및 사용자 승인 범위에 따라 관리한다. 브랜치 푸시만으로 production에 자동 배포되도록 만들지 않는다.
