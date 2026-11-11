# ARTI 프론트 인수 · PC와 휴대폰 검증

팀 공통 기준인 `main`으로 화면을 실행한다. 수정본을 확인할 때는 검증 대상 커밋이나 브랜치를 사용한다. [실기기 피드백과 수정 기준](../작업기록/2026-11-11_실기기피드백_프론트인수.md)

| 환경 | 먼저 볼 항목 | 활용 |
| --- | --- | --- |
| PC Chrome 모바일 모드 | 두 작품 동시 노출, 화면 밀림, 취향 적용 흐름, 반응 버튼 위치, 영수증 표시 | 수정마다 빠르게 반복. 320×667·360×740·412×820에서 비교하고 느린 네트워크도 적용한다. |
| 실제 휴대폰 브라우저 | 화면 키보드와 주소 표시줄, 터치, OS 뒤로가기, 한국어 음성, 실제 파일 저장 | PC에서 통과한 수정본을 한 번 더 확인한다. 같은 갤럭시 S24+의 전후 비교를 우선하고, iPhone을 쓸 수 있으면 Safari에서도 확인한다. |

## 1. PC에서 격리 환경 실행

저장소 루트의 PowerShell에서 실행한다. Docker Desktop을 켜고, 최신 팀 기준을 받은 새 작업 브랜치나 작업 폴더를 사용한다. 이미 다른 작업이 있는 브랜치는 그 작업을 커밋하거나 별도 폴더로 보존한 뒤 기준본을 받는다.

```powershell
git fetch origin
# 이 브랜치 이름이 이미 있다면 다른 새 이름을 사용한다.
git switch -c review/mobile-frontend origin/main
if (-not (Test-Path .env.compose)) { python scripts/init_dev_env.py }
$env:ARTI_ENV = 'test'
$env:ALLOW_TEST_FIXTURES = 'true'
$env:ARTI_API_PORT = '4019'
$env:ARTI_LLM_PROVIDER = 'disabled'
$env:OPENAI_API_KEY = ''
$env:ARTI_MODEL_SERVICE_URL = ''
$env:ARTI_TASTE_PROFILE_V2_ENABLED = 'true'
docker compose --env-file .env.compose -p arti-frontend-review up -d --wait --build api
docker compose --env-file .env.compose -p arti-frontend-review exec api python manage.py load_test_fixture
npm --prefix frontend ci --ignore-scripts --no-audit --no-fund
$env:VITE_API_TARGET = 'django'
$env:VITE_API_PROXY = 'http://127.0.0.1:4019'
$env:VITE_API_BASE = '/api'
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5188 --strictPort
```

PC Chrome에서 [합성 전시](http://127.0.0.1:5188/exhibitions/fixture-ex01)를 연다. 개발자 도구의 기기 모드에서 화면 크기를 선택한다. [DB 준비 응답](http://127.0.0.1:5188/api/ready)이 200인지 먼저 확인할 수 있다. 이 환경은 합성 데이터, 격리 DB, AI 비활성 설정으로 실행한다. 도슨트 화면 진입과 질문 실패 안내는 확인할 수 있고, 실제 응답 품질과 전시 도면은 팀이 별도로 준비한 시연 환경에서 확인한다. [Django 실행 안내](../개발실행-Django.md)

## 2. 같은 Wi-Fi에서 휴대폰으로 열기

PC에서 `ipconfig`를 실행해 실제로 연결된 Wi-Fi 어댑터의 IPv4를 찾는다. PC Vite를 Ctrl+C로 종료하고 마지막 실행 명령의 호스트만 Wi-Fi IPv4로 바꾼다. 아래 `192.168.0.10`은 예시다.

```powershell
$wifiIp = '192.168.0.10'
npm --prefix frontend run dev -- --host $wifiIp --port 5188 --strictPort
```

같은 Wi-Fi의 휴대폰에서 Chrome 또는 Safari로 `http://<PC의 Wi-Fi IPv4>:5188/exhibitions/fixture-ex01`을 연다. PC에서도 같은 주소로 열리는지 확인하고, 휴대폰에서만 안 열리면 같은 네트워크인지와 Windows 방화벽의 TCP 5188 허용 여부를 확인한다. 학교 네트워크가 기기 간 접속을 제한하면 서로 접속 가능한 Wi-Fi를 사용한다. 이 HTTP 주소에서는 다운로드·미리보기 저장 경로를 검사한다. 브라우저의 기본 파일 공유 메뉴는 HTTPS 시연 환경에서 확인한다.

## 3. 화면 순서와 회신

1. 전시 열기 → 비회원으로 계속 또는 시험 계정 가입 → 다섯 쌍 비교 → 취향 적용 → 30분 추천 → 지도. 두 작품이 동시에 보이는지와 다음 쌍 전환이 인지되는지 확인한다.
2. 작품해설·관람가이드 → 음성 재생·중지 → 도슨트 입력 → 돌아오기. 키보드가 입력과 전송을 가리는지, 뒤로가기 뒤 같은 작품과 탭이 보이는지 확인한다.
3. 좋아요·싫어요 이유 저장 → 관람 완료 → 영수증 이미지 저장. 버튼 위치가 유지되는지, PNG의 태그가 한 칩 안에서 갈라지지 않는지 확인한다.
4. 회원 관람은 영수증 새로고침 → 마이페이지 기록 한 건 확인 → 과거 영수증 열기 → 앱 뒤로가기와 OS 뒤로가기 순으로 확인한다.

회신에는 **기준 커밋 / PC 또는 휴대폰 기종·OS·브라우저 / 회원·비회원 / 통과·실패·미실행 / 누른 순서와 기대·실제 결과**를 적는다. UI 문제는 화면 캡처, 저장 문제는 PNG를 첨부한다. 기존 작업 상태를 알릴 때는 수정 파일과 변경이 담긴 커밋 또는 ZIP도 함께 적는다.

시험을 마치면 Vite를 Ctrl+C로 종료하고 `docker compose --env-file .env.compose -p arti-frontend-review down`을 실행한다.
