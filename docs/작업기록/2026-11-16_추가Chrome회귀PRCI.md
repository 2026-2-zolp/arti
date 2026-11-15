# 11/16 추가 Chrome 회귀 PR CI 연결

- **작업 기준** · `dev/임준억` `7eb1198`, `main` `c2ecdae`. 기존 PR Chrome 5개에 아래 네 작업을 추가했다. 기존 작업 이름과 PR·수동 실행 조건을 유지했다. `main` 및 개발 브랜치 푸시는 기존 프론트·Django·모의 모델·계획 검사를 실행한다. [워크플로](../../.github/workflows/ci.yml)
- **시험 환경** · 각 작업은 별도 GitHub Actions 러너의 합성 PostgreSQL 17과 미디어 경로를 사용한다. 실제 모델 설정과 카카오 앱 설정은 비운다. 합성 전시를 적재하고 관리자 접근을 검증하는 작업에는 해당 시험 계정을 생성한다. 영수증 해석은 루프백 Django 모의 제공자 표시 헤더를 확인한 뒤 Chrome을 실행한다. 카카오 브라우저 실행기는 일회용 루프백 HTTPS 인증서를 준비한다.

| PR 검사 | 합성 DB | 검증 범위 |
| --- | --- | --- |
| `Receipt Chrome (interpretation)` | `arti_receipt_interpret` | 회원·비회원의 502, 같은 요청 재시도, 해석 유지, 계정 전환 후 늦은 응답. [영수증 해석](2026-11-16_영수증해석502통합회귀.md) |
| `Admin Chrome (analysis conflict)` | `arti_admin_analysis` | 작품 변경과 분석 충돌 409, 최신 작품 조회 뒤 다시 분석, 확정 문안 유지. [관리자 분석](2026-11-16_관리자분석중작품변경Chrome.md) |
| `Visit Chrome (saved V2)` | `arti_visit_boundaries_saved_v2` | 구 조사풀의 저장 취향 재사용, 이번 관람만 변경, 저장 응답 유실, 두 탭의 취향 충돌과 복귀. [저장 V2](2026-11-16_저장V2취향재사용Chrome.md) |
| `Account Chrome (mock Kakao)` | `arti_kakao_browser` | 연결 취소, 연결·로그아웃·재로그인, 오래된 완료 탭 차단, 같은 계정·취향·영수증 확인. [카카오 모의 연동](2026-11-16_카카오모의연동Chrome.md) |

- **로컬 확인** · `actionlint`에서 워크플로 검사를 통과했다. 영수증 해석·기존 영수증 비공개 및 전시 종료·기존 도슨트 재시도는 YAML의 Bash 단계를 각각 별도 PostgreSQL에서 실행해 통과했다. Windows Git Bash의 환경 자동 경로 변환 때문에 첫 실행에서 Vite의 `/api` 확인이 실패해, 로컬 재현 과정에서 `MSYS2_ENV_CONV_EXCL`을 설정했다. 관리자 분석은 매트릭스와 같은 DB 이름과 부트스트랩 계정으로 실행했다. 확장 저장 V2와 기본 카카오 HTTPS Vite도 각각의 합성 DB에서 확인했고, 프론트 타입 검사와 테스트 44건이 통과했다.
- **실행 범위** · 위 결과는 로컬 실행 기록이다. GitHub Actions의 새 작업은 다음 PR에서 확인한다. Nginx HTTPS 카카오 콜백과 오류 로그는 별도 로컬 검수다. 실제 모델 호출과 실기기 검증은 보류했다. [Nginx HTTPS 콜백 검수](2026-11-16_NginxHTTPS카카오콜백로그.md)
