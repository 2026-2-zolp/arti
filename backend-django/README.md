# ARTI Django API — W04 기반 + W05 핵심 통합 검증 완료

이 디렉터리는 동섭 통합본 ae0e58e에서 옮기는 **새 서비스 API**다. 기존 backend/ Express와 ai-service/ FastAPI는 보존한다. W04 기반 위에 W05의 관리자 쓰기·회원·관람 저장·도슨트 맥락 처리를 구현하고 G4를 통과했다. Git 기준 인수이며 로컬 고유자료는 별도 보존·인수한다. 실제 모델·배포는 후속이다. 현재 판정과 경계는 [W05 기록](../docs/execution-plan/2026-11-07/records/W05/README.md)을 따른다.

## 구현 범위와 계약 차이

- 기존 /api·camelCase DTO·외부 문자열ID·year문자열·xy0~100·시간3/5/7점을 유지한다.
- running/approved만 공개, 미검수 AI내용은 서버에서 빈문자열/빈배열/null로 제거한다. draft/closed 직접URL은404, 이미지숨김도 파일접근까지 제한한다.
- GET /api/admin/exhibitions(/:id), /api/admin/artworks(/:id)는 X-Admin-Token이 필요하고 미검수 자료를 유지한다. opaque 관리자로그인/로그아웃과 명시적 bootstrap을 최소 구현했다.
- 관리자 비공개 이미지/도면은 /api/admin/uploads를 헤더인증으로 fetch한 뒤 임시objectURL로 표시한다. 토큰을URL에넣거나외부이미지에전송하지않고화면이바뀌면취소/해제한다.
- POST /api/recommendations는 기존 {exhibitionId,tastes,duration}를 받고 tasteProfile을 선택적으로 검증한다. picks빈도는 서버pool로 재계산, 출처가없는 과거태그는균등가중한다. empty tastes는일반추천0점. saved는 본인서버snapshot만 허용하고 회원 로그인/프로필 저장과 본인 snapshot 재사용을 연결했다.
- GET /api/exhibitions/:id/taste-pool는 정확히10점5쌍 또는 ready:false다. U05는 서버의 pool/version과 원본 선택·빈도를 전달한다.
- 상태확인: /api/health는 process/AI미연결 표시, /api/ready는 실제 PostgreSQL과 migration된 테이블 확인.
- W05 쓰기/회원/영수증과 도슨트 맥락 API를 구현했다. 실제 provider는 W07에서 연결하며 기본 호출은503 AI_UNAVAILABLE다. 비밀번호 재설정/전시 일괄 분석은501 FEATURE_DISABLED다. Express에 숨은 fallback은 없다. 501을 성공/실제AI로 표시하지 않는다.

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

브라우저 [개발 UI](http://127.0.0.1:5178)에서 검증전시가 보인다. fixture는 실제전시가아닌 명시적개발검증자료로13작품/2전시이며 계정은없다. Git 40점 자료의 명시적 bundle 가져오기는 아래 절차로 제공한다. 로컬 SQLite 고유 자료·회원/세션의 전체 이전은 아직 확인되지 않았고 자동승인하지 않는다. 운영(ARTI_ENV=production)은 플래그가켜져있어도 fixture명령이실패한다.

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

W05에서는 회원 가입·로그인·취향 저장, 버전 기반 관리자 저장·검수, 관람 저장과 historical snapshot을 연결했다. 실제 AI 연결은 아직 없고503을 반환한다. 본인 관람은 /api/visits/:id, 관리자 열람은 별도 /api/admin/visits/:id를 사용한다. 헤더 역할을 혼용하지 않는다. 검증된 범위와 미통과 항목은 W05 기록을 확인한다.

## 검사와 영속성

```powershell
docker compose --env-file .env.compose -p arti-dev exec api python manage.py test arti.tests --noinput -v 2
docker compose --env-file .env.compose -p arti-dev exec api python manage.py makemigrations --check --dry-run
```

테스트는 실제PostgreSQL의 별도 test_arti DB와 임시 media를 사용하며SQLite로대체하지않는다. DB/미디어는서로다른named volume이다. 컨테이너재생성시보존되며 `down`은볼륨을지우지않는다. `down -v`는데이터삭제이므로일상종료명령으로사용하지않는다. 운영backup/restore검증은W08이다.

종료: `docker compose --env-file .env.compose -p arti-dev --profile ui down`.

## 버전 근거

requirements.in에서 Django5.2 LTS/DRF3.16 경계를정하고 requirements.lock의직접/전이패키지버전으로Linux이미지설치를검증했다. [Django 지원정책](https://www.djangoproject.com/download/), [DRF5.2지원](https://www.django-rest-framework.org/community/3.16-announcement/), [Compose 준비/기동순서](https://docs.docker.com/compose/how-tos/startup-order/)를참고했다. Python3.12/PostgreSQL17을사용하며 이미지실제digest/검사환경은실행증거에기록한다. AWS배포·RDS·CI가완료됐다는뜻은아니다.

## Git 40점 자료를 검수 대기로 가져오기

저장소 루트에서 `python scripts/export_git_captures.py data/private/captures`를 실행한다. 메타데이터의 잘못된 .png 경로는 같은 작품 ID의 유일한 실제 이미지로 대응시키며 원래 경로·수정 여부·SHA256을 manifest에 남긴다. 여러 후보/누락은 실패한다. bundle은 Git 무시 디렉터리에만 생성한다.

컨테이너에 bundle을 전달한 뒤 `python manage.py import_capture_bundle /tmp/captures --dry-run`으로 검증하고, 같은 명령에서 --dry-run을 빼면 명시적으로 가져온다. 시작 시 자동 실행되지 않는다. 전시는 draft, 작품은 source_check, 태그/AI확정은 없음, mock 좌표는 버린다. 같은 전시/작품이 있으면 덮어쓰지 않고 실패한다. 파일 변조도 실패한다. 승인 전에 공개되지 않는다.

이는 Git 자료 복원이며 광권님 로컬 DB의 고유 수정이 없다는 증명이 아니다. 유영국 전시는 다른 외부 ID의 전시·작품으로 등록할 수 있지만 실제 자료와 사람 검수는 후속 과업이다. 사용자/세션 전체 이관을 포함하지 않는다.

교차 origin 프론트가 필요한 경우에만 API의 ARTI_ALLOWED_ORIGINS에 정확한 origin을 쉼표로 지정한다. 기본값은 빈 목록이며 Vite proxy의 같은 origin 요청을 권장한다. If-Match 요청/ETag 노출을 지원해도 실제 API 권한 검사는 유지한다.

## 텍스트 AI 연결 설정 준비

기본은 disabled/503이다. 사용자 요청으로 OpenAI 호환 Chat Completions adapter를 준비했다. 서버의 ignored .env.compose에 provider/key/base URL/model을 명시하면 텍스트5종만 연결된다. 태그/감정은 별도이며 Kanana 자동대체는 없다. [설정·지원범위](../docs/operations/AI_설정과모델선택.md), [로컬63검사·미검증경계](../docs/execution-plan/2026-11-07/records/W07-preparation/README.md). 실제 유료 모델 품질을 검증한 상태는 아니다.
