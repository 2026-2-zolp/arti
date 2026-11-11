# Django 기준 개발 실행

공식 개발 API는 Django·PostgreSQL이다. 유영국 작품·GPT 키 없이 실행할 수 있다. 기존 Express/FastAPI는 비교용으로 보존하며 자동 fallback하지 않는다.

## API 준비(저장소 루트)

Docker Desktop Linux engine과 Node22가 필요하다. 초기 환경파일 생성 명령에는 호스트 Python3(프로젝트 기준3.12)도 필요하다. 이미 환경파일이 있으면 다시 생성하지 않는다. 최초에만 `python scripts/init_dev_env.py`로 ignored .env.compose를 만든다. 이미 있으면 그대로 사용하며 삭제·덮어쓰기하지 않는다.

```powershell
docker compose --env-file .env.compose -p arti-dev up -d --build api
```

API는127.0.0.1:4018이며 DB 외부 포트는 없다. 자동 계정/전시 생성은 없다. fixture와 관리자 명시 생성은 [API 안내](../backend-django/README.md)를 따른다. AI 기본은 disabled/503이다.

## 화면: 두 방식 중 하나

호스트 Vite는 추가 설정 없이 Django4018에 연결한다.

```powershell
npm --prefix frontend ci --ignore-scripts --no-audit --no-fund
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5178 --strictPort
```

또는 Compose UI를 사용한다. 같은5178 포트에 호스트 Vite를 함께 켜지 않는다.

```powershell
docker compose --env-file .env.compose -p arti-dev --profile ui up -d --build frontend
```

둘 다 http://127.0.0.1:5178 이다. Compose는 내부주소 http://api:8000을 명시한다. 종료는 해당 Vite터미널 Ctrl+C 또는 사용한 프로젝트의 `docker compose --env-file .env.compose -p arti-dev down`. -v를 붙여 볼륨을 삭제하지 않는다.

## 선택 설정과 preview

frontend/.env.example을 ignored frontend/.env.local로 복사할 수 있다. 기본 실행에는 필요 없다. .env.compose는 프론트 환경파일이 아니다. 프로세스 환경변수 > frontend의 mode별 .env 파일 순으로 적용한다. 설정 변경 후 dev를 재시작한다.

| 설정 | 의미 |
| --- | --- |
| VITE_API_TARGET | django 기본 / express 명시 legacy. 알 수 없는 값·빈 값은 오류 |
| VITE_API_PROXY | HTTP(S) origin만. Django4018/Express4000 기본. Compose는 api:8000. /api 경로·query·인증정보 금지 |
| VITE_API_BASE | 기본 /api. 직접 다른 서버를 지정하면 CORS·인증·주소를 별도 확인 |

VITE_*는 공개값이므로 서버 키를 넣지 않는다. 필요한 target 한 값만 계산해 브라우저에 명시하고 서버 환경 전체를 주입하지 않는다.

```powershell
npm --prefix frontend run build
npm --prefix frontend run preview -- --host 127.0.0.1 --port 5181 --strictPort
```

preview는 기존 번들을 사용하므로 target/API_BASE를 바꾸면 동일 설정으로 재build해야 한다. build가 없거나 target/base가 다르면 시작을 거부한다. arti-build.json은 target/base만 포함한다. proxy 주소만 바꿀 때에도 실제 서버 종류가 같은지 확인한다. 포트로 종류를 자동 추정하지 않는다.

## 명시 Express 비교

기존 백엔드를 켠 후 다음처럼 둘 다 명시한다(환경파일에 이전 proxy가 있을 수 있다).

```powershell
$env:VITE_API_TARGET='express'
$env:VITE_API_PROXY='http://127.0.0.1:4000'
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5179 --strictPort
```

복귀할 때 두 프로세스 변수를 해제하고 frontend 환경파일도 확인해 재시작한다. [이전 Windows 안내](실행-가이드-Windows.md)는 legacy 자료이며 W05 새 기능 전체의 Express 호환을 뜻하지 않는다. Django 장애 시 Express로 자동 우회하지 않는다.

참고: [Vite 공식 환경변수 로딩](https://vite.dev/config/#using-environment-variables-in-config). 설치된 Vite6의 실제 loadEnv를 검사해 확인한다.
