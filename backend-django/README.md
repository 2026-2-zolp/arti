# ARTI Django API — W04 기반

이 디렉터리는 동섭 통합본 ae0e58e에서 옮기는 **새 서비스 API**다. 기존 backend/ Express와 ai-service/ FastAPI는 보존한다. 현재는 전시/작품 공개조회·추천·관리자읽기·DB/컨테이너 기반까지다. 전체 백엔드 전환 완료가 아니다.

## 구현 범위와 계약 차이

- 기존 /api·camelCase DTO·외부 문자열ID·year문자열·xy0~100·시간3/5/7점을 유지한다.
- running/approved만 공개, 미검수 AI내용은 서버에서 빈문자열/빈배열/null로 제거한다. draft/closed 직접URL은404, 이미지숨김도 파일접근까지 제한한다.
- GET /api/admin/exhibitions(/:id), /api/admin/artworks(/:id)는 X-Admin-Token이 필요하고 미검수 자료를 유지한다. opaque 관리자로그인/로그아웃과 명시적 bootstrap을 최소 구현했다.
- 관리자 비공개 이미지/도면은 /api/admin/uploads를 헤더인증으로 fetch한 뒤 임시objectURL로 표시한다. 토큰을URL에넣거나외부이미지에전송하지않고화면이바뀌면취소/해제한다.
- POST /api/recommendations는 기존 {exhibitionId,tastes,duration}를 받고 tasteProfile을 선택적으로 검증한다. picks빈도는 서버pool로 재계산, 출처가없는 과거태그는균등가중한다. empty tastes는일반추천0점. saved는 본인서버snapshot만 허용하고 회원로그인/프로필저장은 W05에서 연결한다.
- GET /api/exhibitions/:id/taste-pool는 정확히10점5쌍 또는 ready:false다. 현 U05는 아직 기존 목록기반 UI이며 pool/profile전달 연결은 W05다.
- 상태확인: /api/health는 process/AI미연결 표시, /api/ready는 실제 PostgreSQL과 migration된 테이블 확인.
- 전용 쓰기/분석/회원/영수증/도슨트는 W05/W07 후속이다. 미구현 경로는501 또는 읽기전용 경로의405다. Express에 숨은 fallback은 없다. 501을 성공/실제AI로 표시하지 않는다.

## 로컬 실행 — 저장소 루트에서

Docker Desktop Linux engine + Compose가 필요하다. 기본 포트는 API4018/UI5178이고 localhost에만 공개하며 DB포트는 호스트에 공개하지 않는다.

```powershell
python scripts/init_dev_env.py
docker compose --env-file .env.compose -p arti-dev up -d --build api
```

init_dev_env.py는 무작위 개발용 DB비밀번호/SECRET_KEY를 **Git무시 .env.compose**에 만들며 기존파일을 덮지 않는다. 서버기동은 migration만 수행하고 자료/계정을 자동생성하지 않는다. 운영환경에서는 이 개발 Compose를 그대로 사용하지 않는다. 이 DB사용자는 개발/테스트DB생성용 권한이며 운영 최소권한 구성은 W12/W08에서 따로 검증한다.

개발 fixture가 필요할 때만 .env.compose의 ALLOW_TEST_FIXTURES=true로 명시 변경하고 API를 재생성한 뒤 실행한다.

```powershell
docker compose --env-file .env.compose -p arti-dev up -d api
docker compose --env-file .env.compose -p arti-dev exec api python manage.py load_test_fixture
docker compose --env-file .env.compose -p arti-dev --profile ui up -d --build frontend
```

브라우저 [개발 UI](http://127.0.0.1:5178)에서 검증전시가 보인다. fixture는 실제전시가아닌 명시적개발검증자료로13작품/2전시이며 계정은없다. 실제자료 import/기존SQLite 데이터이전은 아직 구현하지 않았고 자동승인하지 않는다. 운영(ARTI_ENV=production)은 플래그가켜져있어도 fixture명령이실패한다.

관리자는 자동계정 대신 명시적으로 생성한다. 아래 명령의 숨김프롬프트에 영문/숫자가포함된12~128자비밀번호를 입력한다. 명령줄인자에 비밀번호를 넣지 않는다. 계정중복시기존비밀번호를바꾸지않고실패한다.

```powershell
docker compose --env-file .env.compose -p arti-dev exec api python manage.py bootstrap_admin --login-id your-admin-id --name 관리자
```

자동검증에서는 일회성 ARTI_BOOTSTRAP_PASSWORD 환경변수를 지원하되 값/토큰을 로그·문서에 남기지 않는다. 실제운영의 관리자/회원전체계정 이관이 아니다.

## 프론트/API 선택과 연결

Compose UI는 VITE_API_PROXY=http://api:8000와 VITE_API_TARGET=django를 명시한다. 관리자 helper는 이 모드에서만 admin읽기API를 쓰며 공개자료와섞지않는다. 기존 호스트 npm run dev의 기본은 Express4000으로 보존해 비교할 수 있다. 새API를 호스트 Vite에서 확인하려면 두환경변수를 모두 지정한다.

```powershell
$env:VITE_API_PROXY='http://127.0.0.1:4018'
$env:VITE_API_TARGET='django'
npm --prefix frontend run dev
```

관람조회/추천/가이드표시 최소경로만 확인한다. 회원가입/회원로그인·관리자저장·AI·기록까지 작동한다고 보지 않는다. A04는초안읽기까지가능하며저장/분석은후속이다. 과거영수증의현재catalog의존제거도W05다.

## 검사와 영속성

```powershell
docker compose --env-file .env.compose -p arti-dev exec api python manage.py test arti.tests --noinput -v 2
docker compose --env-file .env.compose -p arti-dev exec api python manage.py makemigrations --check --dry-run
```

테스트는 실제PostgreSQL의 별도 test_arti DB와 임시 media를 사용하며SQLite로대체하지않는다. DB/미디어는서로다른named volume이다. 컨테이너재생성시보존되며 `down`은볼륨을지우지않는다. `down -v`는데이터삭제이므로일상종료명령으로사용하지않는다. 운영backup/restore검증은W08이다.

종료: `docker compose --env-file .env.compose -p arti-dev --profile ui down`.

## 버전 근거

requirements.in에서 Django5.2 LTS/DRF3.16 경계를정하고 requirements.lock의직접/전이패키지버전으로Linux이미지설치를검증했다. [Django 지원정책](https://www.djangoproject.com/download/), [DRF5.2지원](https://www.django-rest-framework.org/community/3.16-announcement/), [Compose 준비/기동순서](https://docs.docker.com/compose/how-tos/startup-order/)를참고했다. Python3.12/PostgreSQL17을사용하며 이미지실제digest/검사환경은실행증거에기록한다. AWS배포·RDS·CI가완료됐다는뜻은아니다.
