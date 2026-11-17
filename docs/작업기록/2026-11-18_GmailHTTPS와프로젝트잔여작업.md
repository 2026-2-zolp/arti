# 2026-11-18 Gmail HTTPS 검수와 프로젝트 잔여 작업

## 이 PC에서 설정할 경로와 순서

Gmail 시험용 파일은 `C:/Proj/26-2-zolp/work/arti/.env.compose.gmail-trial`이다. Git 제외 여부를 확인했다. 이 파일은 Gmail 시험용 `arti-gmail-trial` 프로젝트가 읽는다. 시험 링크는 이 PC에서 여는 `https://127.0.0.1:55443/password/reset` 기준이다. 다른 기기나 팀원이 링크를 열려면 팀이 정한 HTTPS 주소와 인증서가 필요하다.

1. 발신 Google 계정에서 2단계 인증을 설정하고 앱 비밀번호를 발급한다. [앱 비밀번호 발급](https://myaccount.google.com/apppasswords) · [Google 안내](https://support.google.com/accounts/answer/185833?hl=ko)
2. `.env.compose.gmail-trial`에서 `ARTI_PASSWORD_RESET_FROM`과 `EMAIL_HOST_USER`에 같은 전체 Gmail 주소를 넣고, `EMAIL_HOST_PASSWORD`에 발급 화면의 구분 공백을 뺀 앱 비밀번호를 넣는다. `EMAIL_HOST=smtp.gmail.com`, `EMAIL_PORT=587`, `EMAIL_USE_TLS=true`, `EMAIL_USE_SSL=false`로 준비했다. [Google SMTP 설정](https://knowledge.workspace.google.com/admin/gmail/send-email-from-a-printer-scanner-or-app)
3. 저장소 루트의 PowerShell 7에서 아래 명령으로 설정 검사, API 반영, 인증서 검증을 한다. `check_live_config`와 HTTPS 확인은 SMTP 인증이나 발송 없이 동작한다.

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Set-Location 'C:/Proj/26-2-zolp/work/arti'
$trialPath = 'data/private/arti-gmail-https-1118'
$artiMailCompose = @('-p', 'arti-gmail-trial', '--env-file', '.env.compose.gmail-trial', '-f', 'compose.yaml', '-f', "$trialPath/https.yaml")
docker compose @artiMailCompose config --quiet
docker compose @artiMailCompose run --rm --no-deps -T api python manage.py check_live_config mail --origin https://127.0.0.1:55443
docker compose @artiMailCompose up -d --no-deps --force-recreate --wait api
python scripts/probe_account_https.py https://127.0.0.1:55443 mail --local-ca "$trialPath/cert.pem"
docker compose @artiMailCompose exec -T api python manage.py send_password_reset_mail --status
```

로컬 시험 인증서는 `C:/Proj/26-2-zolp/work/arti/data/private/arti-gmail-https-1118/cert.pem`이다. PowerShell의 검사기는 이 인증서로 사이트를 확인한다. OS 신뢰 저장소에 넣지 않은 자체 서명 인증서라 Chrome에서 경고가 나올 수 있다. 실제 발송 검수를 재개하면 팀 수신함으로 한 통부터 확인한 뒤 워커를 켠다. [첫 발송과 워커 순서](../operations/비밀번호재설정_로컬검수와배포준비.md)

## 실발송 전 합성 검수 결과

- `arti-reset-mock-1118`의 Nginx HTTPS에서 인증서, 마이그레이션, 준비 응답, 재설정 페이지, `no-store`와 `no-referrer`를 확인했다. 테스트 회원과 미등록 주소의 요청은 둘 다 `204`였고 익명 대기열은 워커 시작 전에 2건이었다.
- Compose `reset-mail`의 `--watch`로 합성 SMTP에 접속했다. STARTTLS와 인증을 통과한 뒤 합성 `451`로 등록 회원 요청 1건을 보류했다. 워커 시작 후 128초에 자동 재시도로 합성 수신함에 한 통만 도착했다. 링크는 같은 HTTPS 주소였고 한 번 사용한 뒤 재사용 `400`, 이전 세션 `401`, 새 비밀번호의 동일 회원 로그인을 확인했다. 앱·프록시·워커 로그에 링크 토큰과 수신 주소가 없는지 대조했다.
- 모의 프로젝트를 종료한 뒤 같은 주소에 별도 DB·미디어를 사용하는 `arti-gmail-trial`을 띄웠다. 합성 전시 2개·작품 13개를 넣고, 임시 값으로 실제 Gmail 프로젝트의 `check_live_config`를 통과했다. 현재 API·DB·HTTPS가 동작하며 Gmail 설정을 넣기 전 재설정 상태는 비활성, 대기열은 0건, 워커는 정지다. 시험 인증서와 설정은 Git 제외 경로에 보관했다.
- 병렬로 A-05·V2 Chrome 9개, A-04 가이드·운영 집계·모의 카카오 Django 21개, OpenAI 집계 정규화 3개, W06·취향 평가 준비 회귀 21개를 통과했다.

## 검수 대상과 릴리스 상태

- 원격 `main`은 `63aafe8`, PR #50의 head는 `7611856`이다. 원격 PR은 열려 있고 실행된 검사는 통과했으며, 리뷰 제출 0건을 확인했다. 이번 검수 코드는 직전 로컬 `adc7315`까지로 원격 head보다 앞선다. 팀 PC 검수에는 실제로 내려받아 실행한 커밋과 빌드 ID를 함께 기록한다. [PR #50](https://github.com/2026-2-zolp/arti/pull/50) · [팀 PC 검수표](../operations/2026-11-17_PR50_팀PC검수.md)

## 남은 작업과 완료 기준

잔여 비율은 이전과 같은 영역별 검수 기준 5개를 기준으로 한다. 팀 적용과 최종 인수에 필요한 항목을 함께 적었다.

| 영역 | 확인한 현황 | 다음 작업과 완료 기준 | 잔여 |
| --- | --- | --- | ---: |
| 비밀번호 재설정 | 로컬 HTTPS와 합성 SMTP용 격리 환경을 마련했다. | 준억이 Gmail 발송 설정을 적용한 뒤 시험 수신함에서 실제 인증·수신·반송과 동일 회원·영수증 복구를 확인하고, 운영 담당·주소 소유 확인 기준을 정한다. | 40% |
| 운영 로그·AI 비용 | ARTI 작업·모델별 토큰과 누락 구분, OpenAI 내보내기 변환이 준비됐다. | 같은 OpenAI 프로젝트·기간의 Usage/Costs를 실제 영수증과 대조해 표시할 비용과 차이를 정한다. | 40% |
| A-04·도슨트 모델 | 합성 Luna 생성·확정·관람 연결 이력과 가이드 근거 확인 모의 회귀가 있다. Kanana는 보류 상태다. | Luna 12쌍 가림 판정을 수합하고 위험 사례의 오탐·미탐을 대조해 적용 범위를 정한다. 실작품은 W06 승인 이후 평가한다. | 20% |
| A-05 지도·추천 | 합성의 문 개폐·복도·기둥과 V2 3·5·7점, 버전 충돌 복구를 반복 검수했다. | 권리 승인 도면·작품 좌표·개방 문으로 팀 PC에서 확인하고 직접 관람 적용 범위를 확정한다. | 40% |
| 카카오 OAuth | 기존 이메일 계정 연결·재로그인·메일 복구의 모의 회귀가 있다. | 팀 앱 관리자와 고정 HTTPS를 정하고 실제 연결·취소·중복·복구, 키 교체와 탈퇴 범위를 확인한다. | 40% |
| W06 도판·문안·취향 조사풀 | 준비 검증은 16점과 후보 10점·5쌍을 통과했다. 핵심 001·004·010 시연 채택은 인수표상 0/3이다. | 광권의 원 취득처·도판 버전을 받고 준억·매체 담당이 교내 시연·PDF·발표·영상·외부 URL 권리를 확인한다. 작성자 외 문안 승인과 8개 태그·6개 감정 판정 후 실제 작품과 조사풀을 확정한다. 실제 태그·감정 모델 적용 시 독립 라벨과 모델 호스트의 부하를 확인한다. | — |
| 사용자 화면·팀 PC·실기기 | 합성 관람·관리자 Chrome과 시연 후보 자료가 있다. | 준억·동섭·성현이 같은 빌드로 U-05 비교, U-09 경로, U-10 확대·반응, U-11 도슨트·입력, U-12 영수증·뒤로가기를 본다. 실기기 검수 재개 후 삼성 키보드·두 번째 기기·HTTPS PNG 공유를 확인한다. | — |
| 배포·복원·운영 인수 | 격리 Compose, 마이그레이션, Nginx HTTPS, 합성 백업·복원 검수 이력이 있다. | 팀이 배포 계정·도메인/TLS·예산 상한·운영 종료일과 담당을 확정한다. 고정 빌드로 백업 복원과 회원/관리자 권한을 재확인하고 운영 로그·복귀 절차를 인수한다. | — |
| 개인정보·최종 제출 | 가입 동의 기록과 시연·완료보고서·설계서 기술 초안이 있다. | 운영 주체·연락처·보유기간을 확정한다. 시연 커밋·데이터·주소를 통일한 뒤 시험결과서, 설계서, 완료보고서, PPT, 시연 영상의 담당과 최신 제출 일정을 팀에서 확인한다. | — |

팀 회신을 기다리는 동안에는 합성 시연 후보와 제출 자료를 같은 커밋 기준으로 대조할 수 있다. 운영 담당 배정과 실제 도판·도면 근거 수합은 병행한다. 실제 환경 검수 재개 후에는 Gmail 첫 발송, 카카오 기존 계정 연결, 실기기·시연 인수 순서로 사용 계정과 기록을 이어서 확인한다. [W06 인수표](../operations/2026-11-13_W06_팀검수통합인수표.md) · [운영·예산 결정안](../operations/W12_운영구성과예산결정안.md) · [발표·설계서 초안](../operations/2026-11-11_R09_발표설계서_기술검증초안.md)
