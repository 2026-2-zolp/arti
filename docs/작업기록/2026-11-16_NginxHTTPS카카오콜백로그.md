# 운영형 Nginx HTTPS 카카오 콜백·로그 검수

- 검수 기준은 `7eb1198`이다. PC Chrome → 루프백 Nginx HTTPS → Gunicorn·Django → 전용 합성 PostgreSQL 17을 연결했다. Nginx 1.28의 저장소 정적 설정에 시험용 TLS 리스너와 임시 자체서명 인증서만 얹었다. 브라우저의 카카오 인가와 Django의 토큰·JWKS 응답은 기존 서명 모의를 사용했다.
- 정상 콜백은 302로 같은 출처에 돌아왔고, 완료까지 `Secure`·`HttpOnly`·`SameSite=Lax` 흐름 쿠키를 사용했다. 카카오 연결 취소 뒤 기존 세션, 연결 뒤 재로그인 시 같은 회원·저장 V2·영수증 한 건이 유지됐다. 오래된 완료 탭은 400으로 차단됐다. 정상 요청은 Nginx 로그에서 콜백을 제외했고 Gunicorn은 경로와 응답 코드만 기록했다.
- 기존 설정의 업스트림 불가 시험에서 콜백은 502였다. Nginx 접근 로그의 콜백 제외 규칙은 적용됐지만, 별도 오류 로그의 전체 요청 줄에는 합성 인가 코드와 상태값이 남았다.
- 콜백 전용 위치에서만 Nginx 오류 로그를 차단했다. 모든 콜백 응답에 `Cache-Control: no-store`와 `Referrer-Policy: no-referrer`가 적용되도록 했다. 공통 프록시의 대상·DNS·타임아웃을 재사용한다.
- 수정 후 업스트림을 닫고 같은 요청을 보내면 502와 두 보안 헤더를 반환했고, Nginx 로그에서 합성 코드·상태가 검출되지 않았다. 같은 장애 상태에서 일반 `/api/ready` 요청은 502 오류 로그를 남겼다. 기존 HTTPS Vite 방식의 Chrome 검수도 통과했다.
- 별도 운영 Nginx 구성과 등록된 실제 카카오 앱·HTTPS 주소는 이후 확인 범위다. 실제 모델 호출과 실기기 검수는 보류했다.

## 재현

Django 대상으로 프론트를 빌드하고, 로컬에 PostgreSQL 17·Nginx 1.28 이미지와 백엔드 잠금 의존성이 포함된 런타임 이미지를 준비한다. 기존 런타임 이미지를 사용할 때도 실행 코드는 현재 작업본을 읽기 전용으로 마운트한다. 다음은 저장소 루트의 PowerShell 7 기준이다.

```powershell
$env:VITE_API_TARGET = 'django'
$env:VITE_API_BASE = '/api'
npm.cmd --prefix frontend run build
docker build --tag arti-kakao-nginx-check-api:local backend-django
& frontend/tests/runKakaoNginx.browser.ps1 -ApiImage arti-kakao-nginx-check-api:local -HttpsPort 5623
```

검사는 전용 Docker 네트워크에서 DB와 Gunicorn을 시작하며 Nginx HTTPS만 127.0.0.1에 공개한다. `-WebImage`로 이미 준비된 Nginx 1.28 런타임을 지정할 수 있다. 이번에는 `arti-ops-replay-e2f8127-api:local`과 `arti-ops-replay-e2f8127-web:local`의 런타임을 사용했다. 시험이 끝나면 이 실행의 컨테이너, 전용 네트워크와 임시 인증서가 정리된다. 기본 Vite 회귀의 합성 DB 설정과 실행 조건은 [카카오 Chrome 작업기록](2026-11-16_카카오모의연동Chrome.md)을 따른다.
