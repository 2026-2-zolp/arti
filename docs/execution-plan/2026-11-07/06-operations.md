# Docker·AWS·GitHub Actions 실행 절차 v2

## 현재와 권장안

2026-11-09 최신: 현재 개발 기준은 Django/DRF·PostgreSQL·Compose·CI다. [W12 운영 구성·예산 결정안](../../operations/W12_운영구성과예산결정안.md)에 실제 코드/모델 실측·서울 단가·A/B 후보·배포 차이·복원/종료 조건을 연결했다. W12는 결정안 준비 in_progress이며 계정/담당·상한·운영 선택/주소/종료일이 미확인이라 AC33/GOPS는 미통과다.

통합본 출발 시점에는 SQLite/data/uploads·localhost 모델·Vite 프록시였고 당시 기준 SHA에는 Docker/Actions가 없었다. 아래 절차는 과업별 목표이며 지금 모두 미구현이라는 뜻이 아니다. 현재 S3는 직접 앱 미디어 저장소가 아니라 비공개 백업 후보로 먼저 검토한다.

권장 출발 구성은 **React 정적파일 + API 컨테이너 / PostgreSQL 운영환경(RDS 후보) / 파일저장(S3 후보) / 필요한 로컬 모델 서비스 / GitHub Actions**다. API 실행은 EC2+Compose가 작은 후보이며, 모델은 같은 호스트에 무조건 배치하지 않는다. 프론트를 같은 웹서버로 제공할지 S3/CloudFront로 분리할지는 W12에서 선택한다. W02는 API경로/호출계약만 정한다. ECS·Kubernetes·ALB·NAT Gateway·벡터DB를 기본 필수로 추가하지 않는다.

AWS는 Django 선택의 필수 근거가 아니다. Express도 RDS와 연결 가능하다. RDS는 PostgreSQL을 관리형으로 운영하는 선택이며 “DB접속주소만 바꾸면 검증 끝”이 아니다.

## 1. Docker 최소 구성 — W04

1. 런타임/의존성을 고정하고 API image를 만든다. 개발용 devserver 대신 선택한 프레임워크의 운영 실행 명령을 정한다.
2. 개발 Postgres volume·healthcheck·환경변수 예시를 만든다. DB준비 확인 후 migration을 수행한다.
3. uploads·모델캐시와 소스/컨테이너를 분리한다. 이미지 재생성으로 데이터를 잃지 않게 한다.
4. 컨테이너 간 호출은 서비스DNS/설정주소를 사용한다. 다른 컨테이너의 localhost를 모델 주소로 사용하지 않는다.
5. 새 환경에서 build→up→migration→fixture→smoke→restart→재조회한다. 포트·버전·CPU/메모리 조건을 기록한다.

참고: [Compose 시작·준비 상태](https://docs.docker.com/compose/how-tos/startup-order/).

## 2. AWS 시험 배포 — W12 결정 후 W08

| 순서 | 작업 | 반드시 남길 증거 |
| --- | --- | --- |
| A | 계정·리전·예산·리소스 담당 확인. 예상 월비용·정리 기준·알림 결정. W05 전 초기환경 접근 제한 | 비용가정/담당/리소스 목록. 실제 사용자자료·고정 데모계정 비공개, 무료라고 추정하지 않음 |
| B | API실행환경·PostgreSQL 버전(RDS 채택 시 RDS 지원버전)·네트워크/보안그룹·TLS·자격증명 전달 결정 | 실제 연결·실패·허용범위 확인. DB/모델은 불필요한 공개노출 금지 |
| C | migration·검증용 fixture를 AWS DB에서 실행하고 재연결. 운영모드 데모 자동시드 차단·초기관리자 별도 생성 | schema/ID·기본조회·저장 로그, 알려진 데모/관리자 자격으로 로그인 불가 |
| D | S3 또는 선택 저장소의 업로드/열람/삭제/모델입력 연결 | 권한별 파일검사·서버재생성 후 보존 |
| E | 도메인·HTTPS·정적파일·SPAfallback·API경로·인증callback 구성 | 진입/상세재진입·API/로그인·영수증 저장 결과 |
| F | 모델 readiness·반복추론·지연·메모리 확인 | 프로세스/모델 준비별 상태, 자원·오류 로그 |
| G | DB백업복원·미디어보존·로그·중단/정리 연습 | 실제 복원·배포실패·비용정리 절차 |

RDS는 자동백업·시점복구·VPC/SSL 등을 지원하지만 설정과 실제복원 확인이 필요하다. [RDS PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html).

## 3. 파일·이미지 경계

현재 API는 로컬파일을 읽어 base64로 모델에 보내거나 imageUrl을 넘긴다. S3로 옮기면 이 경로도 바뀐다. 저장객체키와 일시적 URL을 구분하고, 만료된 presigned URL을 영구 이미지URL로 DB에 저장하지 않는다.

관리자 업로드 권한, 공개/제한 이미지, 모델의 읽기 권한을 분리한다. 제한파일이 API의 공개 uploads경로로 우회 노출되지 않는지 확인한다. 외부URL 입력은 사설/메타데이터 주소·리다이렉트·크기·형식을 검토하고, 필요한 경우 서버가 허용한 저장소 객체만 모델에 전달한다. 이는 배포 전 검증 항목이며 현재 악용 재현을 했다는 뜻은 아니다.

원격 이미지로 영수증을 만들 때 CORS·폰트·iPhone 이미지저장/공유를 실제 배포 URL에서 확인한다. S3 업로드는 presigned URL 방식도 선택 가능하나 필수는 아니다. [S3 공식 문서](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html).

## 4. 모델 실행·긴 작업

기준 README 안내: 태그/감정 모델 다운로드 약1.7GB, Kanana 글쓰기 다운로드 약4GB, float32 메모리 약9GB·16GB PC권장. 실제 AWS 메모리 측정이 아니다. 같은 image/환경으로 측정 후 인스턴스·동시 실행수를 정한다. 모델가중치를 Git/매PR image에 불필요하게 넣지 않고 캐시/버전·준비 절차를 관리한다.

태그·감정 분석은 관리자 작품 등록 과정에서 수행하고 검수결과를 저장할 수 있다. 관람객 추천마다 재추론할 필요는 없다. 외부LLM 호출은 API에서 직접 가능하다. FastAPI 유지 이유는 Python이라는 이름보다 로컬모델 로딩·자원·장애 경계에 있다. 단일머신이면 CPU/RAM 경쟁은 남으며 분리 자체가 추론을 빠르게 하지 않는다.

기준 Express의 분석180초/글쓰기300초와 현재 Django를 구분한다. 현재 LLM 호출25초·공유 모델 HTTP30초·브라우저 분석90초/일반35초·gunicorn90초다. 전체 관리자 분석과 대기·DB/프록시의 총 예산/클라이언트 중단 처리는 다음 기술 점검 항목이다. 외부 프록시/ALB를 채택하면 해당 제한도 확인하되 모든 timeout 연장이나 작업큐 도입을 자동 해법으로 두지 않는다. [ALB 속성](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html).

health 응답200과 모델준비 완료는 다르다. cold start·다운로드실패·동시추론·모델정지 상황을 별도로 확인한다. worker 증가 시 모델 메모리 중복도 측정한다. [FastAPI 배포·메모리](https://fastapi.tiangolo.com/deployment/concepts/).

## 5. PR CI — W11 (로컬 W03·대상 API W04와 분리)

- 프론트: lockfile 설치, 타입/빌드, 추천무효화·가이드 저장·오류 등 의미있는 회귀.
- API: 타입/검사, 인증·권한·승인 필터·중복저장·계약. Django 채택 후 Postgres service DB에서 migration·관계·저장 검증.
- 모델: 기본 CI는 fake/provider대체로 스키마·분기·실패를 검사한다. 실제 모델성공을 주장하지 않는다.
- 실제모델/유료LLM/장시간평가: 변경 범위에 맞춘 별도 명시 실행. 입력·비용·캐시·결과를 기록한다.
- 실패하는 필수검사는 merge 통과조건에서 제외하지 않는다. 알려진 결함 탐지job은 상태를 드러내고 수정 후 required로 전환한다.
- CI status와 브랜치보호/필수checks는 별개다. 저장소 권한·플랜에서 가능한 범위를 확인하고 설정 결과를 기록한다.

## 6. CD — W09 (실모델 평가와 독립 시험 가능)

1. 배포대상 브랜치/태그·환경과 권한을 고정한다. PR이 배포 권한을 임의로 획득하지 않게 한다.
2. GitHub OIDC→제한된 AWS역할로 임시 자격을 사용한다. 저장소·브랜치/환경 범위를 trust policy와 실제 토큰 형식에 맞춘다.
3. CI 통과 커밋의 image를 registry(ECR 후보)에 등록하고 tag 외 digest/커밋을 보존한다. 같은 빌드 산출물을 배포한다.
4. 환경별 concurrency로 배포를 직렬화한다. migration은 한 번만 실행하고 실패하면 배포를 중단한다.
5. 가능한 확장형 schema 변경을 사용한다. 제거/비호환 변경은 데이터 보존·복구 경로를 별도로 검증한다.
6. 배포→readiness→전시/작품/추천/기록 smoke→결과 기록 순으로 확인한다. 실사용 자료를 훼손하지 않는 테스트 범위를 정한다.
7. 실패하면 이전 image 복귀를 실행하고 상태를 확인한다. DBschema/데이터는 자동으로 돌아오지 않으므로 호환성 또는 별도 복원 절차를 따른다.
8. 최초는 같은 절차의 수동 실행/명시적 workflow 실행로 검증하고, 확인 후 합의한 자동 트리거를 적용한다.

OIDC는 장기 AWS키를 GitHub에 저장하지 않고 임시권한을 쓰는 방식이다. LLM키 등 애플리케이션 비밀은 별도 관리하고 로그/프론트번들/image에 넣지 않는다. [GitHub OIDC AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws), [배포 제어](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments).

## 독립 준비와 공개 릴리스

W12/GOPS에서 PostgreSQL 운영방식을 정한다. RDS는 후보이며 미채택이면 선택환경의 연결·TLS/접근·migration·백업복구를 검증한다. RDS라는 제품명 자체가 AC23 합격조건은 아니다.

W11 CI권한과 AWS예산이 미정이어도 W03 로컬회귀·W04/W05 개발은 가능하다. W09 CD는 W05/W08/W11 후 fixture로 검증할 수 있고 W07 실제AI 완료를 선행조건으로 요구하지 않는다. 실제AI·전시·모바일을 포함한 G5/G7을 통과하기 전 공개릴리스 금지.

## 7. 범위와 공수 재산정

로컬 Compose 성공과 AWS 운영 통과는 별개다. 기존 추정에 AWS 네트워크·도메인·모델자원·S3·CI/CD·복원시간을 더한 총공수는 아직 확정하지 않는다. W12에서 계정과 배포규모를 정하고 과업별로 재산정한다. 대형 모델을 상시운영하지 않아도 되는 선택으로 비용·복잡도를 줄일 수 있는지 비교한다.


