# 회귀와 실행 추적

2026-11-09, 신규 PostgreSQL17 프로젝트 arti-intake-expand-check. Python3.12, ARTI_ENV=test, ALLOW_TEST_FIXTURES=true, ARTI_LLM_PROVIDER=disabled, OPENAI_API_KEY 비움.

```text
docker compose --env-file .env.compose -p arti-intake-expand-check up -d --wait db
docker compose --env-file .env.compose -p arti-intake-expand-check run --build --rm --no-deps -e ARTI_LLM_PROVIDER=disabled -e OPENAI_API_KEY= -e ARTI_ENV=test -e ALLOW_TEST_FIXTURES=true -e DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,testserver api python manage.py test arti.tests --noinput -v 1
```

초기83개31.629초 OK. 일반/공식 초안까지 재분류하지 않도록 기존 시연 표시 검사와 해당 회귀를 보완한 최종83개32.376초 OK. 새5개는 명시 append의 dry-run/기존 확정 콘텐츠·입구 보존, 옵션/상태/version 조건, 제목/장소/기간·중복 ID 거절, 실패 시 subtitle/version/신규 파일 rollback, lock 구간의 version 재검사를 다룬다. 마지막 경합 사례는 잠금 재검사 지점의 동시 변경을 흉내낸 결정적 예외 시험이며 여러 프로세스 경합 부하 시험은 아니다.

실제 arti-dev에서 manage.py check 문제0, makemigrations --check --dry-run No changes detected. 프론트·모델 서비스 회귀/원격CI는 이번 변경으로 재실행하지 않았다. 추가 유료 추론0. 실제83개 전체 출력은 Git제외 data/private/yyk-expand-preserve-20261109/django-tests.txt에 보존한다.

## 실제 추가 인수 순서

현재 자료를 수정하는 재실행 안내가 아니라 version1 당시 수행한 명령의 핵심 기록이다. 기존 DB/미디어에 무조건 재적용하지 않는다.

1. `docker compose --env-file .env.compose -p arti-dev stop api`로 쓰기 구간을 멈췄다.
2. db에서 `pg_dump -U arti -d arti -Fc -f /tmp/yyk-expand-before.dump` 후 docker cp로 private/arti.dump에 보관했다. 읽기 전용 arti-dev_media_data mount의 파일별 해시와 media.tar를 같은 보존 디렉터리에 만들었다. dump는 Git에 넣지 않았다.
3. snapshot.py를 provider disabled·key 비움의 일회성 api에서 실행했다. read-only /intake의 manifest로 `python manage.py import_exhibition_bundle /intake --append-to-draft --expected-version 1 --dry-run`을 실행하고 snapshot 무변경을 확인했다.
4. 같은 명령의 --dry-run을 제거해 명시 추가했다. `up -d --wait api frontend`로 기동했고 실제 provider 설정은 유지됐다.
5. verify.py는 원래 core3 manifest와 추가12 manifest, before.json을 read-only mount해 기존3점/전체15점·공개/관리자 API·중복거절을 검사했다. 실제 관리자 계정을 만들지 않았다.
6. API 컨테이너 restart→up --wait 후 snapshot 재비교. DB 컨테이너는 재시작하지 않았으며 전체 domain 행/미디어 값의 지속성만 비교했다.

사전보존 위치/덤프·tar 해시는 result.json에 있다. 재현은 반드시 별도 빈 프로젝트에서 core3 최초 적재→추가12 흐름으로 수행한다. 현재 arti-dev에 재적재하면 기존 작품 충돌로 중단되는 것이 정상이다. 시험 프로젝트는 down(no -v)하고 볼륨을 보존하며 일반 앱은 계속 실행한다.
