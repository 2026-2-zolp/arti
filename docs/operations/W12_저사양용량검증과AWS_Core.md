# W12 저사양 용량 검증과 AWS Core 적용 검토

2026-11-09. 동섭 통합본 이후 Django·PostgreSQL 형상을 기준으로 검증했다. [기존 운영 결정안](W12_운영구성과예산결정안.md)의 4GB 후보는 최초 보수적 가정이며 최소 사양 확정이 아니었다. 이번 결과로 **모델을 제외한 1GB를 최소 시험 후보, 2GB를 운영 여유를 둔 권장 후보**로 좁힌다. 실제 AWS 계정·총예산·종료일·운영 승인은 여전히 미정이다.

## 무엇을 시험했나

`compose.capacity.yaml`은 공개 배포 구성이 아닌 **합성 자료 전용 격리 시험**이다. 고정 시험 암호/키가 들어 있으므로 AWS에 그대로 올리지 않는다. 일반 `arti-dev`·유영국·기존 자료 볼륨은 사용하거나 변경하지 않았다. 새 시험 프로젝트는 종료했고 시험 볼륨은 보존했다.

| 후보 | API / PG / Nginx 메모리 상한 | 합계 / 후보 내 미배정 |
| --- | --- | --- |
| 1GiB | 384 / 192 / 64MiB | 640 / 384MiB |
| 2GiB | 768 / 384 / 64MiB | 1,216 / 832MiB |

세 컨테이너의 CPU 상한 합계는 2코어(API1.4·PG0.5·웹0.1), swap 상한은 각 메모리 상한과 같게 두어 컨테이너 swap을 사용하지 않았다. Gunicorn은 기존 sync2worker, PostgreSQL17의 shared_buffers32MB·work_mem2MB·max_connections30·jit off를 사용했다. 웹은 CI/개발 호스트에서 Vite dist를 빌드한 뒤 Nginx로 제공했다. 작은 서버에서 Node/Vite 개발 서버나 이미지 빌드를 상시 실행하는 안이 아니다.

**이는 16GB Docker VM에서 개별 컨테이너 상한 합계를 제한한 시험이며 전체 1/2GB EC2 VM 시험이 아니다.** 미배정 메모리는 OS/Docker/관리·로그용 계획 여유이지 실제 OS 소비량 측정값이 아니다. 호스트에는 다른 기존 컨테이너도 실행 중이었고 이를 중지하지 않았다. x86 로컬 CPU·디스크·루프백망과 AWS CPU 크레딧/네트워크/디스크는 다르다. CPU 상한은 T 계열의 지속 baseline 성능을 보장하지 않는다.

자료는 기존 합성 fixture의 2전시·13작품, 최소 이미지와 합성 회원 1명이다. 실제 유영국 16점·대형 이미지·실제 GPT/CLIP/mDeBERTa 품질을 통과시킨 시험이 아니다. CLIP/mDeBERTa는 RAM 예산에서 제외하며 사전 분석 또는 별도 호스트가 전제다. 그 결과 인수·승인·전달 절차는 아직 별도 준비가 필요하다. GPT는 외부 API를 쓰는 구조다.

## 기준과 측정 결과

이번 로컬 준비의 기준은 혼합 조회·추천과 기록 저장 p95<2초, 예상한 HTTP 상태만 발생, 측정 누락 없음·메모리 할당 실패/OOM 없음, 재전송 중복 없음, 재시작 후 DB/미디어 보존이다. 제품 SLA나 실제 사용자 50명 보장은 아니다. 동시 수는 **진행 중 요청 수**다.

| 항목 | 1GiB 후보 | 2GiB 후보 |
| --- | --- | --- |
| 혼합 5동시 / 100요청 p95 | 95.40ms | 95.86ms |
| 혼합 20동시 / 400요청 p95 | 369.02ms | 373.51ms |
| 혼합 50동시 / 1,000요청 p95 | 848.06ms | 962.47ms |
| 20동시 저장·동일 ID 재전송 200요청 p95 | 571.98ms | 497.10ms |
| 20동시 60초 반복 조회 | 3,356건 / p95 473.03ms | 3,403건 / p95 469.37ms |
| 컨테이너별 메모리 피크 API / PG / 웹 | 124.79 / 78.21 / 13.58MiB | 142.29 / 79.38 / 13.82MiB |
| 샘플 시점 소비량 합계 최대 | 199.16MiB | 217.09MiB |
| 메모리 할당 실패 / OOM kill | 0 / 0 | 0 / 0 |
| 저장 후 실제 관람 / 반응 행 | 100 / 100 | 100 / 100 |
| API·DB 재시작 후 DB/파일 | 보존 | 보존 |

컨테이너별 피크는 서로 다른 시점일 수 있어 합계를 동시 최대라고 부르지 않는다. cgroup v1에서 failcnt·oom_kill 및 peak를 읽었다. 최초 실행은 v2 경로만 읽어 메모리가 누락됐으므로 불합격/대체로 남겼다. 수정 후 모든 측정·기준을 통과했다. 2GB가 빠르다고 결론 내리지 않는다. 현재 표본에서 병목은 메모리 부족으로 드러나지 않았다.

Nginx의 실제 JS/CSS200·상세 URL 재진입200·잘못된 API404도 확인했다. JS100요청/10동시 p95는107.59ms였다. WAN 전송·브라우저 렌더링·대형 이미지 스트레스는 별도다. [원시 측정·재현 절차](../execution-plan/2026-11-07/records/W12/capacity-2026-11-09/README.md).

## 전체 요청 시간과 저장 보호

기존에는 요약25초+가이드25초+공유 모델30초의 최대80초 수준이었고 각 호출만 제한됐다. 지금은 분석 시작 시 **공유60초 예산**을 만들고, 각 호출 timeout을 `min(호출 상한, 남은 전체 예산)`으로 줄인다. 응답 처리 후·저장 직전에도 만료를 확인한다. 전체 예산이 소진되면 먼저 받은 부분 결과도 버리고 버전/확정값을 유지한다. 태그·감정의 모델 호출 공유 및 오류 캐시는 유지한다. 예산 안의 일부 제공자 실패에 대한 기존 부분 성공 계약은 그대로다.

레이어 계획은 provider별25/30초 상한 → 분석 공통60초 → 시험 프록시 read70초 → Gunicorn90초·관리자 브라우저90초다. 일반 API 브라우저35초는 분석90초와 별도다. **프록시 read/socket timeout은 전체 wall-clock 제한이 아니다.** DNS·연속 소량 전송·DB 잠금·worker 큐 대기까지60초로 강제 취소하는 SLA/작업큐는 구현하지 않았다. 저장 시점의 만료 검사는 늦은 값을 차단하지만 서버/원격 모델 작업의 즉시 중단을 보장하지 않는다. F27·실제 배포 AC26은 유지한다.

1GB 후보의 실제 Nginx→Gunicorn→HTTP 모의 제공자에서 각21초 지연을 넣었다. 요약·가이드 후 모델에 남은 예산만 주어 **60.133초·504 AI_TIMEOUT**, 전체 DB 스냅샷 동일을 확인했다. 동시에 일반 조회100건200/p95 168.60ms였다. 복구 요청은0.394초/200이고 버전은 한 번만 증가했다. 모의 응답은 실제 GPT/모델 성능이 아니다.

클라이언트를0.2초에 끊으면 서버 처리가 즉시 취소되지는 않는다. 시험에서는 뒤늦게 한 번 저장됐고, 이전 버전 재시도는 추가 제공자 호출 없이409였다. 현재 화면의 오류 후 재시도는 조회로 최신 상태를 확인해야 한다. 사용자에게 “취소됐으니 저장 안 됨”이라고 안내하면 안 된다. 큐/작업ID는 이 측정만으로 도입하지 않고 실제 두 AI 요청 동시 점유·느린 전송·DB 대기 필요를 확인한 뒤 결정한다.

## 부트캠프 작은 EC2 방식과 비용

4차 프로젝트의 확인 기준은 main `ad3b9318fe839c475a24f9cf0ceef64d26791067`이다. [시스템 구성도](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN29-4TH-3Team/blob/ad3b9318fe839c475a24f9cf0ceef64d26791067/docs/final/시스템_구성도.md)는 t2.micro를 명시했고, React/Nginx·Django·FastAPI를 한 EC2에서 실행했다. DB는 SQLite 볼륨이고 LLM·embedding은 OpenAI API였다. [배포 가이드](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN29-4TH-3Team/blob/ad3b9318fe839c475a24f9cf0ceef64d26791067/docs/guides/도커_AWS_CI_CD_배포_가이드.md)는 작은 EC2 빌드 OOM을 피해 CI에서 이미지를 빌드하고 pull하도록 안내한다. 저장소로 실제 월 청구액·10달러 크레딧 소비는 확인하지 못했다.

우리가 가져올 부분은 **외부/사전 분석+외부 GPT, 정적 웹·API·PG 단일 소형 호스트, CI 빌드→이미지 pull**이다. SQLite·개발용 공개 포트·latest만으로 복귀하는 방식을 복사하지 않는다. 당시 t2.micro와 이번2코어 상한은 동일 성능이 아니다. 목표 EC2 후보는 t3.micro1GiB 또는 t3.small2GiB이며 실제 AWS에서 재측정해야 한다. 최종 프로젝트의 작은 EC2는 별도 RDS·RunPod가 있었으므로 전체 인프라 비용이 작은 EC2 요금과 같지 않다.

2026-11-09 공식 서울 리전 Linux/Shared/Used/NA 온디맨드 t3.micro는0.013달러/시간, t3.small은 기존 확인0.026달러/시간이다. gp3 20GB·IPv4 한 개를720시간 유지하고 S3 백업5GB를 가정한 **기본 소계**는 다음과 같다. EC2 tiny1/2GB에 모델을 같이 넣는 비용표가 아니다.

| 안 | 컴퓨트+디스크+IPv4+백업 소계 |
| --- | --- |
| EC2 t3.micro 720시간 | $14.91 |
| EC2 t3.small 720시간 | $24.27 |
| EC2 t3.micro 176시간 / 디스크·IPv4720시간 유지 | $7.84 |
| EC2 t3.small 176시간 / 디스크·IPv4720시간 유지 | $10.13 |
| Lightsail IPv4 1GB 월 번들+백업5GB | $7.13 |
| Lightsail IPv4 2GB 월 번들+백업5GB | $12.13 |

반올림은 합산 후 적용했다. LLM·트래픽 초과·CPU credit·추가 snapshot/로그·registry·도메인/DNS·세금/환율·외부 모델 호스트 비용은 제외다. EC2 중지 시간에는 함께 둔 DB/서비스도 접근할 수 없다. 자동 스케줄은 구현하지 않았다. Lightsail에는 번들 디스크/IPv4를 다시 더하지 않았고 일반 Lightsail은 중지해도 요금이 발생한다. “전체 비용 월10달러 보장”이 아니라 **저가 구성 가능성**이다. [EC2 공식 단가 원본](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-2/index.csv), [Lightsail 공식 가격](https://aws.amazon.com/lightsail/pricing/), [세부 단가·제외](../execution-plan/2026-11-07/records/W12/2026-11-09/pricebook.json).

## AWS Core 판단

사용자가 지목한 **AWS Core는 실제 AWS 공식 플러그인**이다. 이 세션 검색에는 AWS Data Analytics만 반환됐지만, [AWS 공식 안내](https://docs.aws.amazon.com/agent-toolkit/latest/userguide/plugins.html)와 [Core manifest](https://github.com/aws/agent-toolkit-for-aws/blob/main/plugins/aws-core/.codex-plugin/plugin.json)에서 별도 플러그인으로 확인했다. 확인 시 manifest1.2.0이며 스킬과 AWS MCP 설정을 제공한다. Data Analytics는 Glue/Athena 중심으로 이번 과업의 우선 도구가 아니다.

Core는 서비스 선택·IAM·비용·IaC·컨테이너·관측 검토에 유용하므로 **배포 준비 단계 도입을 권장**한다. 이를 이유로 ECS/Fargate·Bedrock·RDS를 추가하지 않는다. 작은 EC2/Lightsail+Compose 유지 여부와 별개로 검토 도구를 활용한다. 플러그인이 배포를 대신 보증하거나 비용 상한을 강제하지 않는다.

이번에는 설치·연결·계정 조회·리소스 생성을 하지 않았다. 도입한다면 문서/설계 검토부터 사용하고, 계정 연결은 SSO/임시 역할로 필요한 조회 권한부터 한정한다. 실제 생성/수정은 대상 리전·리소스·배포 역할/승인 경계를 별도 확정한다. manifest에는 Read/Write 둘 다 있으므로 “설치만 하면 읽기 전용”으로 가정하지 않는다. MCP 설정의 `--skip-auth`를 AWS 계정 API의 무권한 접근 허용으로 해석하지 않는다. [AWS MCP 보안](https://docs.aws.amazon.com/agent-toolkit/latest/userguide/security.html), [IAM·임시 자격 안내](https://docs.aws.amazon.com/agent-toolkit/latest/userguide/security-iam.html).

## 다음 한 작업

**운영형 설정·프록시 계약과 DB TLS/배포 준비를 로컬에서 정리한다.** 이번 static 이미지는 빌드·HTTP 경로 준비까지다. production 비밀 분리·TLS/접근 제한·DB 연결/잠금 예산·두 AI 요청 점유 시 큐 지연·실제 이미지/모델 전달·정합 백업 시 자원 여유는 후속이다. 계정/예산 결정 후 최소 후보의 실제 EC2/Lightsail에서 제한 접근·재시작·백업/복원·CPU credit·지연을 확인해야 W08/GOPS를 판단할 수 있다. 팀원 라벨/콘텐츠 승인 대기는 그대로 병행한다.
