"""Render SSH-free ARTI staging configuration locally without AWS calls."""

import argparse
import io
import json
import re
import tarfile
from pathlib import Path


REGION = "ap-northeast-2"
HOSTNAME = "arti-exhibit.duckdns.org"
ACCOUNT = r"[0-9]{12}"
INSTANCE = r"i-(?:[a-f0-9]{8}|[a-f0-9]{17})"
DUCKDNS = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.duckdns\.org"
OIDC_HOST = "token.actions.githubusercontent.com"
OIDC_SUBJECT = "repo:2026-2-zolp@343662137/arti@1422562616:environment:arti-staging"
REPOSITORIES = ("arti-api", "arti-web")
NGINX = Path(__file__).resolve().parents[1] / "nginx"
ROOT = NGINX.parents[1]
HOST_FILES = ("arti-http-acme.conf", "arti-https.conf", "ecr-registry", "https-origin", "compose.env.example")
RELEASE_FILES = {
    "compose.yaml": "compose.yaml",
    "compose.deploy.yaml": "compose.deploy.yaml",
    "bin/deploy-release.sh": "ops/aws/deploy-release.sh",
    "bin/check_release_schema.py": "scripts/check_release_schema.py",
}


def allow(actions, resource, **conditions):
    return {"Effect": "Allow", "Action": actions, "Resource": resource, **conditions}


def policy(*statements):
    return json.dumps({"Version": "2012-10-17", "Statement": statements}, indent=2) + "\n"


def render(account_id, instance_id, hostname):
    ecr_arn = f"arn:aws:ecr:{REGION}:{account_id}"
    repo_arns = [f"{ecr_arn}:repository/{name}" for name in REPOSITORIES]
    ecr_login = allow("ecr:GetAuthorizationToken", "*", Condition={"StringEquals": {"aws:RequestedRegion": REGION}})
    deploy_role = f"arn:aws:iam::{account_id}:role/arti-staging-deploy"
    trust = {
        "Effect": "Allow",
        "Principal": {"Federated": f"arn:aws:iam::{account_id}:oidc-provider/{OIDC_HOST}"},
        "Action": "sts:AssumeRoleWithWebIdentity",
        "Condition": {"StringEquals": {f"{OIDC_HOST}:aud": "sts.amazonaws.com", f"{OIDC_HOST}:sub": OIDC_SUBJECT}},
    }
    http = (NGINX / "arti-http-acme.conf.template").read_text(encoding="utf-8").replace("@ARTI_HTTPS_HOST@", hostname)
    https = (NGINX / "arti-https.conf.template").read_text(encoding="utf-8")
    values = {
        "@ARTI_HTTPS_HOST@": hostname,
        "@ARTI_TLS_CERT@": f"/etc/letsencrypt/live/{hostname}/fullchain.pem",
        "@ARTI_TLS_KEY@": f"/etc/letsencrypt/live/{hostname}/privkey.pem",
        "@ARTI_WEB_UPSTREAM@": "http://127.0.0.1:8080",
        "@ARTI_EDGE_RESOLVER@": "",
    }
    for placeholder, value in values.items():
        https = https.replace(placeholder, value)
    return {
        "ec2-ecr-pull.json": policy(ecr_login, allow(
            ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"], repo_arns
        )),
        "github-trust.json": policy(trust),
        "github-release.json": policy(
            ecr_login,
            allow(["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
                   "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage"], repo_arns),
            allow("ssm:SendCommand", [
                f"arn:aws:ssm:{REGION}:{account_id}:document/ARTI-DeployRelease",
                f"arn:aws:ec2:{REGION}:{account_id}:instance/{instance_id}",
            ]),
            allow("ssm:GetCommandInvocation", "*", Condition={"StringEquals": {"aws:RequestedRegion": REGION}}),
        ),
        "github-variables.txt": (
            f"ARTI_AWS_REGION={REGION}\nARTI_AWS_ACCOUNT_ID={account_id}\n"
            f"ARTI_AWS_INSTANCE_ID={instance_id}\nARTI_AWS_ROLE_ARN={deploy_role}\n"
        ),
        "arti-http-acme.conf": http,
        "arti-https.conf": https,
        "ecr-registry": f"{account_id}.dkr.ecr.{REGION}.amazonaws.com\n",
        "https-origin": f"https://{hostname}\n",
        "compose.env.example": (
            f"DJANGO_ALLOWED_HOSTS={hostname},localhost,127.0.0.1,api\n"
            "ARTI_DEPLOY_HTTP_PORT=8080\nARTI_TASTE_PROFILE_V2_ENABLED=true\n"
            "ARTI_DB_IMAGE=\nARTI_DB_PASSWORD=\nDJANGO_SECRET_KEY=\n"
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--instance-id", required=True)
    parser.add_argument("--hostname", default=HOSTNAME)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    for name, pattern in (("account_id", ACCOUNT), ("instance_id", INSTANCE), ("hostname", DUCKDNS)):
        if not re.fullmatch(pattern, getattr(args, name)):
            parser.error(f"Invalid {name.replace('_', '-')}")
    files = render(args.account_id, args.instance_id, args.hostname)
    try:
        args.output_dir.mkdir(parents=True)
    except FileExistsError:
        parser.error("Output directory already exists. Choose a new directory.")
    for name, content in files.items():
        (args.output_dir / name).write_text(content, encoding="utf-8", newline="\n")
    bundle = args.output_dir / "arti-host-bootstrap.tar.gz"
    with tarfile.open(bundle, "w:gz") as archive:
        for name in HOST_FILES:
            archive.add(args.output_dir / name, arcname=f"arti-host-bootstrap/{name}")
        for name, source in RELEASE_FILES.items():
            data = (ROOT / source).read_bytes().replace(b"\r\n", b"\n")
            member = tarfile.TarInfo(f"arti-host-bootstrap/{name}")
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
    print(f"Prepared {len(files)} local configuration files and {bundle.name} in {args.output_dir}")


if __name__ == "__main__":
    main()
