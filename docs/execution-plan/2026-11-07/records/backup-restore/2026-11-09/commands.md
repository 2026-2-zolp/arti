# 합성 시험의 실행 명령

저장소 루트 PowerShell 기준. private 스크립트 경로는 이 기록의 .py.txt 원문을 복사한 위치다. 실행 전 소스/대상 이름이 시험용이고 대상 DB/볼륨이 새 빈 상태인지 확인한다. 각 명령의 종료코드를 확인한 다음 진행한다. 이 문서를 기존 데이터에 통째로 실행하지 않는다. 키·암호는 출력하지 않는다.

```powershell
docker compose --env-file .env.compose -p arti-backup-src up -d --wait db
docker compose --env-file .env.compose -p arti-backup-src run --rm --no-deps -e ARTI_LLM_PROVIDER=disabled api python manage.py migrate --noinput
# scenario.py seed는 source가 비어 있어야 하며 fixture 적재를 명시 허용한다.
docker compose --env-file .env.compose -p arti-backup-src run --rm --no-deps -e ARTI_LLM_PROVIDER=disabled -e ALLOW_TEST_FIXTURES=true -v "${PWD}/data/private/backup-20261109/scenario.py:/tmp/scenario.py:ro" api python /tmp/scenario.py seed
docker compose --env-file .env.compose -p arti-backup-src exec -T db pg_dump -U arti -d arti -Fc -f /tmp/arti.dump
docker cp arti-backup-src-db-1:/tmp/arti.dump data/private/backup-20261109/arti.dump
docker run --rm -v arti-backup-src_media_data:/source:ro -v "${PWD}/data/private/backup-20261109:/backup" python:3.12-slim python /backup/archive_media.py

docker compose --env-file .env.compose -p arti-backup-dst up -d --wait db
docker cp data/private/backup-20261109/arti.dump arti-backup-dst-db-1:/tmp/arti.dump
docker compose --env-file .env.compose -p arti-backup-dst exec -T db pg_restore --no-owner --no-acl -U arti -d arti /tmp/arti.dump
docker volume create arti-backup-dst_media_data
docker run --rm -v arti-backup-dst_media_data:/target -v "${PWD}/data/private/backup-20261109:/backup:ro" python:3.12-slim python /backup/restore_media.py
docker run --rm -v arti-backup-dst_media_data:/target python:3.12-slim python -c "import os; from pathlib import Path; os.chown('/target',10001,10001); [os.chown(p,10001,10001) for p in Path('/target').iterdir() if p.is_file()]"
docker compose --env-file .env.compose -p arti-backup-dst run --rm --no-deps -e ARTI_LLM_PROVIDER=disabled -v "${PWD}/data/private/backup-20261109/scenario.py:/tmp/scenario.py:ro" api python /tmp/scenario.py verify
# source snapshot을 전/후에 실행해 비교하고 dest db restart 후 snapshot도 비교했다.
docker compose --env-file .env.compose -p arti-backup-dst restart db
docker compose --env-file .env.compose -p arti-backup-dst up -d --wait db
docker compose --env-file .env.compose -p arti-backup-dst run --rm --no-deps -e ARTI_LLM_PROVIDER=disabled -v "${PWD}/data/private/backup-20261109/scenario.py:/tmp/scenario.py:ro" api python /tmp/scenario.py snapshot
# 종료: 볼륨 삭제 옵션을 사용하지 않는다.
docker compose --env-file .env.compose -p arti-backup-src down
docker compose --env-file .env.compose -p arti-backup-dst down
```

source snapshot도 위 run의 프로젝트 이름만 arti-backup-src, 마지막 인자를 snapshot으로 실행한다. 결과에는 행 원문이 아닌 집계/논리 해시/파일 해시만 나온다. 아카이브 해시는 로컬 SHA256으로 확인한다. 소스 앱을 띄우지 않아 덤프/미디어 작성 중 쓰기가 없었다. 수동 생성한 dest 미디어 볼륨에 Compose 소유 라벨이 없어 경고가 나지만 이번에는 이름과 내용이 확인된 새 시험용 볼륨을 사용했다. 실제 운영 복원 자동화는 별도 설계 대상이다.
