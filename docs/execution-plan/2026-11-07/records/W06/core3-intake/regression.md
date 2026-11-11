# 실제 회귀 실행 기록

2026-11-09 / PostgreSQL17 신규 프로젝트 arti-intake-check, Python3.12 이미지, ARTI_ENV=test·ALLOW_TEST_FIXTURES=true·ARTI_LLM_PROVIDER=disabled·OPENAI_API_KEY 비움. 시험 DB는 Django test runner가 생성/삭제했고 프로젝트 데이터 볼륨과 기존 개발 DB를 섞지 않았다.

```text
docker compose --env-file .env.compose -p arti-intake-check up -d --wait db
docker compose --env-file .env.compose -p arti-intake-check run --build --rm --no-deps -e ARTI_LLM_PROVIDER=disabled -e OPENAI_API_KEY= -e ARTI_ENV=test -e ALLOW_TEST_FIXTURES=true -e DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,testserver api python manage.py test arti.tests --noinput -v 1
```

첫 실행77/77,30.424초. 자체 검토로 커밋 후 출력 실패 보존 회귀를 추가한 두 번째 실행78/78,32.118초, OK. 모두 system check 문제0. 현재 제품 코드 변경 뒤 실행한 최종 결과는78개다. 새 회귀9개는 dry-run/공개 격리·재적재 보존·다중 전시/동명 작품·변조/누락/탈출/signature·승인/좌표/잘못된 질문쌍·기존 미디어·DB 실패 rollback·검사 후 입력 변경·commit 후 출력 실패를 다룬다.

arti-dev에서 manage.py check 정상, makemigrations --check --dry-run은 No changes detected. 프론트 코드 변경은 없으며 이번에 프론트 회귀/원격 CI는 재실행하지 않았다. 기존 CI의 python manage.py test arti.tests가 새 테스트 파일을 자동 발견한다.
