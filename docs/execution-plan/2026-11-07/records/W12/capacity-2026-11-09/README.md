# 1/2GiB 용량·전체 요청 예산: 로컬 준비 인수

2026-11-09, 기준 HEAD `c8fa850` + 이번 변경 작업트리. 일반 `arti-dev` 및 유영국 자료는 사용하지 않았다. 실제 AWS/원격 CI/사람 승인 인수와 구분한다. [판단·부트캠프/비용·AWS Core 검토](../../../../../operations/W12_저사양용량검증과AWS_Core.md).

## 재현

저장소 루트에서 Docker Desktop Linux engine을 켜고 Python으로 실행한다. AWS/GPT 자격은 필요 없다. 다음 명령은 전용 시험 프로젝트/볼륨을 만들고 일반 Compose와 공유하지 않는다. 출력 폴더는 신규 경로여야 한다.

```powershell
python scripts/capacity_probe.py --output <새로운-증거-폴더>
python scripts/request_budget_probe.py
python docs/execution-plan/2026-11-07/records/W12/capacity-2026-11-09/verify.py
```

`request_budget_probe.py`는 이 폴더의 `request-budget.json`을 덮어쓰지 않는다. 재실행 시 새 증거 경로를 코드/분기에서 명시하고 기존 증거를 보존한다. 시험 끝에 `down`으로 전용 컨테이너/네트워크만 종료하며 볼륨은 남긴다. 고정 합성 자격이 있는 `compose.capacity.yaml`은 운영 배포에 사용하지 않는다.

## 증거와 실패·보완

- 최초 `1024.json`/`2048.json`: 조회·쓰기·재시작은 성공했지만 cgroup v1에서 메모리 수집이 누락됐다. 최종 용량 통과로 사용하지 않으며 `passed=false`·대체 사유를 기록했다.
- `recheck/1024.json`, `recheck/2048.json`: v1/v2 경로 분기와 **수집 누락 시 실패**를 추가했다. CPU/메모리/swap 제한·샘플·peak·할당 실패/OOM·60초 지속 부하·행 수·파일 보존을 모두 확인했다. 샘플64/66개, 누락/할당 실패/OOM0. cgroup 값과 Docker OOM/restart 상태는 원시 JSON에 있다.
- `build.txt`, `recheck/build.txt`: 정적 웹·API 이미지 빌드 기록. 작은 목표 호스트의 실행 RAM에 Node 빌드를 포함하지 않는다.
- `request-budget.json`: 실제 Nginx/Gunicorn/PG와 합성 HTTP 제공자. 전체60.133초504/DB 동일, 분석 중100읽기 성공/p95 168.60ms, 복구200/버전+1, 연결 중단 후 저장+1·이전 버전 재시도409·추가 AI 호출0. 개발 도구의 import 범위·모의 서버 Python 경로 오류를 고친 뒤 실행했다. 유료 API·실제 모델 품질이 아니다.
- `static-assets.json`: JS/CSS200, JS100개/10동시 p95 107.59ms, 잘못된 API404. 상세 재진입200은 용량 JSON의 `httpSmoke`에 있다.
- `regression/linux-results.json` + 로그: 실제 PG17 기반 Django100개·프론트23개/typecheck/build·모델24개 Linux 회귀 통과. GitHub runner/PR 실행은 아니다. 오류·예산 테스트는 단위 시계 검증과 실제 HTTP/PG 검증을 함께 사용했다.
- `ec2-micro-price.json`: AWS 공식 서울 CSV의 Linux/Shared/Used/NA t3.micro 온디맨드 선택 행·SKU·단가. `aws-core.json`: 공식 Core manifest/보안 출처·연결 미실시 경계.
- `environment.json`: Docker/이미지 식별과 소스 해시. `validation.json`: 결과 기준과 자체 역할별 검토. 일반 개발 환경/배포 게이트는 변경하지 않았다.

## 통과 경계

혼합5/20/50동시,20동시 저장 재전송/60초 반복 조회의 p95<2초, 예상200/201만 발생, 메모리 증거 누락·할당 실패/OOM0, 실제100관람·100반응·재시작 후 파일 보존으로 **로컬 용량 준비 통과**다. 후보의 전체 OS RAM을 제한한 시험이 아니고 단13개 합성 작품이다. 웹 이미지·WAN·실제 GPT/모델 품질·장시간 CPU credit·TLS/실제 클라우드 백업은 미검증이다. 측정치만으로 실제50사용자·60초 SLA를 보장하지 않는다.

공통 예산은 제공자 호출·응답/저장 확인에 적용된다. DNS·소량 지속 전송·DB 잠금·worker 큐까지 강제 취소하는 전체 인프라 deadline은 아니다. 연결 중단도 서버 취소가 아니다. F19/F26/F27/F31 및 W08/GOPS를 종결하지 않는다.
