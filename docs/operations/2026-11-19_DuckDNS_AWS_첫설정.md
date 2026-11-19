# ARTI 시연 서버 첫 설정

서울 EC2 `t3a.small`(Linux x86_64), 암호화 gp3 20 GiB, Elastic IP 한 개를 사용한다. 시연 주소 후보는 `arti-exhibit.duckdns.org`다. 등록할 수 없으면 `arti-demo-2026.duckdns.org`를 쓰고 아래 생성 명령의 호스트명도 함께 바꾼다. 운영 종료 제안일은 12/8 성적평가 이후다. 같은 날까지 24시간 운영하면 시작·종료 시각에 따라 약 $14~15이며, 크레딧·세금·사용량 변동 비용은 별도다. [AWS 첫 배포 비용·복귀](2026-11-18_AWS_CICD_첫배포.md)

## 1. 콘솔에서 먼저 채울 값

1. 개인 AWS 계정의 MFA와 Billing → Credits를 확인한다. 운영 종료일과 비용 알림 수신자를 기록한다. EC2와 ECR 콘솔 리전을 서울(`ap-northeast-2`)로 맞춘다.
2. IAM에서 EC2용 역할을 생성하고 `AmazonSSMManagedInstanceCore`를 연결한다. 서울의 ECR Private repositories에 `arti-api`와 `arti-web`을 만든다. 현재 이미지와 복귀 후보 이미지가 둘 다 남도록 보관 정책을 확인한다.
3. Ubuntu 24.04 LTS x86_64의 `t3a.small`을 온디맨드, CPU 크레딧 Standard, 암호화 gp3 20 GiB, IMDSv2 필수로 연다. 인터넷 게이트웨이로 연결된 퍼블릭 서브넷과 앞에서 만든 역할을 선택한다. HTTPS 443은 시연·심사에 필요한 범위로 연다. HTTP 80은 Let’s Encrypt HTTP-01 발급·갱신에 필요하다. 접속은 Session Manager를 사용하고 SSH·Django·PostgreSQL 인바운드 포트는 열지 않는다. [SSM 접속 요건](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-create-vpc.html) · [HTTP-01](https://letsencrypt.org/docs/challenge-types/)
4. Elastic IP를 하나 할당해 그 EC2에 연결한다. DuckDNS 화면에서 선택한 이름을 등록하고 IPv4 값에 Elastic IP를 입력한다. DNS 응답의 A 레코드가 정확히 일치하는지 확인한다. IPv6를 설정하지 않았다면 AAAA가 없는지도 확인한다. [DuckDNS 사양](https://www.duckdns.org/spec.jsp)

## 2. 로컬에서 서버 묶음과 IAM 정책 생성

저장소 루트의 PowerShell에서 실행한다. 실제로 확인한 계정 ID와 인스턴스 ID를 입력한다. 이 명령은 로컬 파일만 만든다.

```powershell
$artiAccountId = Read-Host 'AWS account ID'
$artiInstanceId = Read-Host 'EC2 instance ID'
$artiHostname = 'arti-exhibit.duckdns.org'
python ops/aws/prepare-staging.py --account-id $artiAccountId --instance-id $artiInstanceId --hostname $artiHostname --output-dir data/private/arti-aws-staging
```

| 파일 | 적용 위치 |
| --- | --- |
| `ec2-ecr-pull.json` | EC2 역할의 인라인 정책. 두 ECR 저장소의 이미지 pull에 사용 |
| `github-trust.json`, `github-release.json` | IAM 역할 `arti-staging-deploy`의 신뢰 정책과 인라인 권한. OIDC 제공자와 실제 GitHub subject가 기존 [배포 가이드](2026-11-18_AWS_CICD_첫배포.md#aws와-github-준비)와 일치하는지 확인 |
| `github-variables.txt` | GitHub Settings → Environments → `arti-staging`의 환경 변수. 허용 배포 브랜치는 `main` |
| `arti-host-bootstrap.tar.gz` | Nginx HTTP·HTTPS, Compose, 호스트 배포 스크립트와 빈 환경 파일 양식 |

Systems Manager → Documents에는 저장소의 [ARTI-DeployRelease.json](../../ops/aws/ARTI-DeployRelease.json)을 이름 `ARTI-DeployRelease`, 유형 `Command`로 등록한다. 현행 워크플로는 문서 버전 1을 사용한다. **`ARTI_AWS_CD_ENABLED`는 첫 배포 승인 전에는 꺼 둔다.**

## 3. Session Manager에서 호스트 준비

Docker 공식 Ubuntu 설치 절차대로 Engine, Buildx, Compose 플러그인을 설치한다. AWS CLI v2와 SSM Agent 버전, Nginx와 Certbot 설치도 확인한다. Compose는 v2.35 이상, SSM Agent는 3.3.2746.0 이상을 사용한다. [Docker 설치](https://docs.docker.com/engine/install/ubuntu/) · [AWS CLI v2 설치](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) · [SSM Agent 환경 변수](https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-troubleshooting.html) · [Certbot 설치 안내](https://eff-certbot.readthedocs.io/en/stable/install.html)

SSH 없이 파일을 전달하려면 같은 리전의 비공개 S3 버킷에 `setup/arti-host-bootstrap.tar.gz`를 업로드한다. EC2 역할에는 제공할 객체 ARN의 `s3:GetObject`만 일시적으로 부여한다. EC2 Session Manager에서 다음 명령을 실행한다. 실제 버킷명을 입력하고, 다운로드한 묶음의 SHA-256을 로컬에서 `Get-FileHash`로 확인한 값과 대조한 뒤 압축을 푼다.

```bash
set -e
read -r -p 'Private S3 bucket name: ' arti_bucket
arti_setup="$(mktemp -d)"
chmod 700 "$arti_setup"
cd "$arti_setup"
aws s3 cp "s3://$arti_bucket/setup/arti-host-bootstrap.tar.gz" . --region ap-northeast-2
sha256sum arti-host-bootstrap.tar.gz
tar -tzf arti-host-bootstrap.tar.gz
```

아래는 **새 호스트**의 최초 설치에 사용한다. 기존 `/opt/arti/compose.env`가 있으면 기존 릴리스 상태부터 확인한다.

```bash
set -e
tar -xzf arti-host-bootstrap.tar.gz
cd arti-host-bootstrap
sudo test ! -e /opt/arti/compose.env
sudo install -d -m 0700 /opt/arti /opt/arti/bin
sudo install -m 0644 compose.yaml compose.deploy.yaml ecr-registry https-origin /opt/arti/
sudo install -m 0755 bin/deploy-release.sh /opt/arti/bin/
sudo install -m 0644 bin/check_release_schema.py /opt/arti/bin/
sudo install -m 0600 compose.env.example /opt/arti/compose.env
```

`sudoedit /opt/arti/compose.env`에서 `ARTI_DB_IMAGE`에 PostgreSQL 17의 고정 digest를 넣는다. `a45fef8` 합성 검수의 후보는 `postgres@sha256:3540c0362c809df084ffac0ae69fe794515f9de92692f02178bcdce0ef0302ac`다. 배포에 승인한 digest를 사용하고 호스트에서 pull이 되는지 확인한다. `openssl rand -hex 32`를 각각 실행해 나온 별도 값으로 `ARTI_DB_PASSWORD`와 `DJANGO_SECRET_KEY`를 채운다. 이 값은 서버에서만 보관한다. 처음에는 SMTP, 카카오, 모델 키를 비워 두고 합성 자료로 확인한다.

## 4. 인증서와 첫 HTTPS 확인

아래는 바로 위에서 압축을 푼 디렉터리에서 실행한다. 443 설정은 인증서 발급 뒤에 설치한다. Certbot 기본 Nginx 설정 변경 대신 webroot를 사용한다.

```bash
set -e
arti_host="$(sudo cat /opt/arti/https-origin)"
arti_host="${arti_host#https://}"
read -r -p 'Certificate contact email: ' arti_cert_email
sudo install -d -m 0755 /var/lib/arti-acme
sudo install -m 0644 arti-http-acme.conf /etc/nginx/conf.d/arti-http-acme.conf
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/lib/arti-acme -d "$arti_host" \
  --cert-name "$arti_host" --email "$arti_cert_email" --agree-tos --non-interactive
sudo install -m 0644 arti-https.conf /etc/nginx/conf.d/arti-https.conf
sudo nginx -t
sudo systemctl reload nginx
sudo install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\n/usr/sbin/nginx -t && systemctl reload nginx\n' |
  sudo tee /etc/letsencrypt/renewal-hooks/deploy/arti-nginx >/dev/null
sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/arti-nginx
sudo certbot renew --dry-run --run-deploy-hooks
systemctl list-timers --all | grep certbot
curl --silent --show-error --noproxy '*' --resolve "$arti_host:443:127.0.0.1" \
  -o /dev/null -w '%{http_code}\n' "https://$arti_host/password/reset"
```

첫 릴리스 전 HTTPS 프록시는 upstream이 비어 `502`를 반환할 수 있다. 위 단계에서는 정상 인증서와 TLS 연결을 확인한다. 릴리스 뒤 외부 PC에서 `/api/ready`가 PostgreSQL과 함께 `200`이고 정적 화면이 뜨는지 확인한다. 백업 본과 평가용 주소를 기록하고 임시 S3 전달 객체의 권한을 회수한다. [Certbot 갱신 훅](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates) · [릴리스와 합성 전시 검수](2026-11-18_AWS_CICD_첫배포.md#첫-실행과-복귀)

11/23~24 발표 전에 같은 HTTPS 빌드에서 시연 MP4를 확보한다. 평가 기간에는 승인된 릴리스 SHA와 API·웹 digest를 기록해 둔다. 12/8에 운영을 마치면 영수증·미디어 백업 인수를 확인하고 EC2·EBS·Elastic IP·ECR·S3 보관 비용을 대조한다.
