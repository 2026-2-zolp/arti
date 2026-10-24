# 💻 Windows에서 ARTI 실행하기 (VS Code 기준)

[← 문서 안내](README.md) · [AI·추천 정리](AI-감정분석-추천-정리.md)

`dev/김광권` 구현본(화면 + 백엔드 + 감정 분석 AI 서버)을 내 컴퓨터에서 처음부터 실행하는 방법입니다. 서버 3개를 각각 다른 터미널에서 켭니다.

| 서버 | 폴더 | 주소 | 역할 |
|---|---|---|---|
| ① AI 서버 | `ai-service` | http://localhost:8000 | 작품 감정 분석 (Python) |
| ② 백엔드 | `backend` | http://localhost:4000 | API·DB·추천 (Node) |
| ③ 화면 | `frontend` | http://localhost:5173 | 사용자·관리자 웹 (React) |

## 0. 처음 한 번만 설치

| 프로그램 | 버전 | 주의 |
|---|---|---|
| [Git](https://git-scm.com/download/win) | 아무 버전 | 기본값으로 설치 (ZIP으로 받을 거면 없어도 됨) |
| [Node.js](https://nodejs.org) | **22.13 이상** (LTS) | |
| [Python](https://www.python.org/downloads/) | **3.10 이상** (3.12 추천) | 설치 첫 화면에서 **"Add python.exe to PATH" 체크** |

설치 후 **VS Code를 껐다 켜고**, 터미널(`` Ctrl + ` ``)에서 `node -v`, `python --version`으로 확인합니다.

## 1. 코드 받기

**Git:**
```powershell
git clone -b dev/김광권 https://github.com/2026-2-zolp/arti.git
```
**ZIP:** [최신 dev/김광권 ZIP](https://github.com/2026-2-zolp/arti/archive/refs/heads/dev/%EA%B9%80%EA%B4%91%EA%B6%8C.zip) (GitHub 로그인 필요) → 압축 풀기 → 폴더 이름을 `arti`로.
폴더 경로에 한글이 없으면 더 안전합니다. VS Code **File → Open Folder**로 `arti`를 엽니다.

## 2. 처음 실행

**터미널 ① AI 서버**
```powershell
cd ai-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```
- `pip install`은 5~15분, 첫 실행 때 모델 약 1.7GB를 내려받습니다.
- http://localhost:8000/health 에서 `"modelsLoaded": true`면 준비 완료.

**터미널 ② 백엔드** (터미널 오른쪽 위 `+`)
```powershell
cd backend
npm install
copy .env.example .env
npm run dev
```

**터미널 ③ 화면**
```powershell
cd frontend
npm install
npm run dev
```
→ http://localhost:5173 을 `Ctrl + 클릭`

| 구분 | 주소 | ID | 비밀번호 |
|---|---|---|---|
| 사용자 | http://localhost:5173 | demo@arti.app | arti1234 |
| 관리자 | http://localhost:5173/admin | admin | admin1234 |

## 3. 다음부터 켤 때

```powershell
cd ai-service; .venv\Scripts\activate; uvicorn app.main:app --port 8000   # ①
cd backend; npm run dev                                                   # ②
cd frontend; npm run dev                                                  # ③
```
끌 때는 각 터미널에서 `Ctrl + C`. AI 서버를 켜지 않아도 나머지 기능은 동작합니다(「AI 분석」만 안 됨).

## 4. 코드가 바뀌었을 때 (업데이트)

- **Git:** `git pull`
- **ZIP:** 새 ZIP의 `ai-service`, `backend`, `frontend` 폴더를 기존 `arti`에 덮어쓰기. `.venv`, `node_modules`, `backend\.env`, `backend\data`(등록한 작품·분석 결과·올린 이미지)는 그대로 남습니다.
- `package.json`이나 `requirements.txt`가 바뀐 경우에만 `npm install` / `pip install -r requirements.txt`를 다시 합니다. DB에 필요한 새 칸은 백엔드를 켤 때 자동으로 추가됩니다.

## 5. 자주 나는 문제

| 증상 | 원인 → 해결 |
|---|---|
| `'git' 용어가 … 인식되지 않습니다` | Git 미설치 또는 VS Code 재시작 안 함 → 설치 후 VS Code를 완전히 껐다 켜기 (또는 ZIP) |
| `activate`에서 "스크립트를 실행할 수 없으므로" | PowerShell 실행 정책 → `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 후 다시 |
| `pip install`에서 `UnicodeDecodeError: 'cp949'` | 예전 requirements.txt의 한글 주석 (현재 버전은 수정됨) → 최신 파일로 바꾸거나 `$env:PYTHONUTF8=1` 후 다시 |
| `'vite'(또는 'tsx')은(는) … 명령이 아닙니다` | 그 폴더에서 `npm install`을 안 함 → 해당 폴더에서 `npm install` |
| 백엔드 에러 `node:sqlite` | Node 버전이 낮음 → `node -v`가 22.13 미만이면 새로 설치 |
| "포트가 이미 사용 중" | 전에 켠 서버가 남아 있음 → 그 터미널에서 `Ctrl + C` 또는 VS Code 재시작 |
| 「AI 분석」이 "서버에 연결할 수 없어요" | 터미널 ①이 꺼졌거나 모델 로딩 중 → `/health`의 `modelsLoaded` 확인 |
| AI 서버 로그의 `Using a slow image processor`, `FutureWarning` | 경고일 뿐 정상. `POST /analyze 200 OK`가 보이면 성공 |
| 요약이 원문 앞부분 그대로 | Claude API 키 없음 → `backend\.env`의 `ANTHROPIC_API_KEY`에 키 입력 후 백엔드 재시작 (감정 분석은 키 없이 동작) |

## 6. 내 폰으로 접속하기 (QR)

**같은 와이파이 (가장 간단)**
1. 터미널 ③을 `npm run dev -- --host`로 다시 켭니다.
2. `Network:` 주소 중 **실제 와이파이 주소**를 고릅니다(`ipconfig` → 「무선 LAN 어댑터 Wi-Fi」의 IPv4). 끝이 `.1`인 주소는 보통 가상 네트워크입니다.
3. 폰 브라우저에 `http://<그 주소>:5173` (꼭 `http://`). 전시 입구 QR 주소는 `http://<그 주소>:5173/exhibitions/ex-mvp`.
4. Windows 방화벽 창이 뜨면 **허용**. 학교 와이파이는 기기끼리 접속을 막는 경우가 많습니다 → 아래 핫스팟.

**폰 데이터로: 핫스팟** — 폰 핫스팟을 켜고 컴퓨터를 거기에 연결한 뒤 1~3번과 같이 합니다.

**다른 사람 폰·발표장: 터널** (가입 없이 무료, 컴퓨터를 켜 둔 동안만)
```powershell
winget install --id Cloudflare.cloudflared     # 처음 한 번, 설치 후 VS Code 재시작
cloudflared tunnel --url http://localhost:5173  # 서버 3개를 켠 상태에서 새 터미널
```
나온 `https://….trycloudflare.com` 주소 뒤에 `/exhibitions/ex-mvp`를 붙여 QR을 만듭니다. 켤 때마다 주소가 바뀌고, 주소를 아는 누구나 들어올 수 있으니 시연 전 관리자 비밀번호를 바꾸세요. (`frontend/vite.config.ts`에 이 주소를 허용하는 설정이 들어 있습니다.)

QR은 크롬 주소창의 공유 → 「QR 코드 만들기」 또는 QR 생성 사이트에서 만듭니다. 일부 사이트는 내부 주소(`192.168…`, `172.16…`)나 `:5173`을 "유효하지 않은 URL"로 거절합니다.

## 7. 저장 공간

- AI 모델(약 1.7GB)은 `C:\Users\<사용자>\.cache\huggingface`에 저장되어, `arti` 폴더를 지우거나 새로 받아도 다시 받지 않습니다. 필요 없으면 이 폴더를 지우면 됩니다(다음 실행 때 다시 받음).
- `ai-service\.venv`(PyTorch 포함, 수 GB)는 폴더를 옮기면 동작하지 않습니다. 새 위치에서는 `pip install`을 다시 합니다.
