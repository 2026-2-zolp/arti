# 11/16 Compose 기동 실패와 Nginx 복구

- **검수 환경** · `1b8b8ee`에서 Django/Gunicorn과 프로덕션 정적 Nginx 이미지를 만들었다. Docker 28.1.1, Compose 2.35.1, PostgreSQL 17 Alpine을 사용했다. 원본과 후보에 각각 Compose 프로젝트, 브리지 네트워크, DB·미디어 볼륨을 할당하고 Nginx만 루프백 5281·5282에 열었다. 합성 회원의 영수증 1건을 저장한 뒤 검수를 시작했다. 도슨트와 분석은 비활성 상태였다. [기존 로컬 복구 검수](2026-11-16_운영형기동실패복구.md)
- **후보 마이그레이션 실패** · 후보 `migrate` 서비스에만 잘못된 PostgreSQL 비밀번호를 넣었다. 인증 실패로 마이그레이션과 `docker compose up --wait web`이 각각 종료 코드 1을 반환했다. 후보 DB에는 테이블이 0개였고 API와 Nginx는 시작되지 않았다. 원본 주소에서는 회원 영수증과 관리자 회원별 목록·상세가 모두 200이었고 영수증 본문도 같았다.
- **후보 복원** · 비밀번호를 바로잡고 빈 후보 DB에 원본 덤프를 단일 트랜잭션으로 복원한 뒤 미디어 사본을 넣었다. `migrate --check`와 Nginx 경유 `/api/ready`가 통과했다. DB 계정·영수증·반응은 각각 `2|1|1`이었고 미디어 SHA-256 두 건이 일치했다. 같은 영수증 ID·본문과 공개 이미지 200, 익명 비공개 이미지 404, 관리자 비공개 이미지 200을 양쪽에서 확인했다.
- **Nginx 복구 문제** · 후보 API 정지 중에는 Nginx 경유 `/api/ready`가 5xx이고 정적 영수증 경로는 200이었다. Nginx를 계속 띄워 둔 채 후보 API를 `10.247.82.10`에서 `10.247.82.11`로 재생성하자 API 직접 응답은 200이고 Docker 내부 DNS도 새 IP를 반환했다. 기존 Nginx 설정은 6초 이상 간격을 둔 두 번의 확인에서 계속 5xx였다. 원본 주소는 해당 확인 시점에도 영수증과 관리자 기록을 반환했다.
- **설정 보완** · Nginx가 Docker 임베디드 DNS를 사용해 `api` 이름을 다시 조회하도록 프록시 대상에 변수를 사용했다. 응답의 DNS 캐시 유효기간을 5초로 두고, 기존 `proxy_next_upstream off`와 프록시 연결·읽기·전송 제한을 유지했다. [Nginx proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass) · [Docker 내부 DNS](https://docs.docker.com/engine/network/#dns-services)
- **수정 후 재검수** · 저장소와 바이트가 같은 Nginx 설정으로 새 후보 이미지를 만들고 `nginx -t`와 위 전 과정을 통과했다. 새 IP의 API가 준비된 후 같은 Nginx 컨테이너 ID에서 `/api/ready` 200이 돌아왔다. 회원·관리자 영수증 본문, 관리자 검색 쿼리, 미디어 접근 200/404/200, DB 행 수 `2|1|1`을 재확인했다. PC Chrome에서도 과거 영수증과 관리자 회원 페이지를 직접 열어 동일 영수증과 작품 1점·5분을 확인했다.

## 재현 순서

1. [시연·복구 체크리스트](../operations/2026-11-11_main_시연복구체크리스트.md#1115-운영형-로컬-시연-재현)의 원본·후보 구성에 서로 다른 Compose 프로젝트명과 포트를 준다. 후보 오버레이에서 `services.migrate.environment.PGPASSWORD`에만 틀린 값을 주고 `docker compose ... up -d --no-build --wait web`의 종료 코드, 후보의 마이그레이션·API·Nginx 상태, 원본의 `/api/ready`와 영수증을 확인한다.
2. 후보 마이그레이션의 비밀번호를 복구한다. 빈 후보 DB에 `pg_restore --exit-on-error --single-transaction --no-owner --no-acl`로 복원하고 미디어 사본을 넣는다. 시작 후 `migrate --check`, `nginx -t`, 영수증의 회원·관리자 조회, 공개·비공개 미디어를 확인한다.
3. 후보 Nginx ID를 기록하고 후보 API만 정지한다. 후보 네트워크의 IPAM에서 다른 정적 IPv4를 지정한 뒤 `docker compose ... up -d --no-deps --force-recreate --wait api`를 실행한다. API 직접 응답과 Nginx 컨테이너에서 조회한 `api` 주소를 확인하고, 같은 Nginx에서 `/api/ready` 및 회원·관리자 조회가 돌아오는지 확인한다.
