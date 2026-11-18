#!/usr/bin/env bash
set -euo pipefail
umask 077

root="${ARTI_RELEASE_ROOT:-/opt/arti}"
state="$root/state"
die() { printf '%s\n' "$*" >&2; exit 1; }
[[ $# == 3 ]] || die 'Expected the release SHA, API digest ref and web digest ref.'
sha="$1"
api="$2"
web="$3"
[[ -r "$root/ecr-registry" && -r "$root/https-origin" ]] || die 'Configure this host before deployment.'
registry="$(< "$root/ecr-registry")"
origin="$(< "$root/https-origin")"
[[ "$registry" =~ ^[0-9]{12}\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com$ ]] || die 'Invalid host ECR registry.'
region="${BASH_REMATCH[1]}"
[[ "$origin" =~ ^https://([a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z0-9]+)$ ]] || die 'Configure a fixed HTTPS origin.'
hostname="${BASH_REMATCH[1]}"

valid_release() {
    local commit="$1" api_ref="$2" web_ref="$3"
    local api_digest="${api_ref##*@}" web_digest="${web_ref##*@}"
    [[ "$commit" =~ ^[0-9a-f]{40}$ &&
       "$api_ref" == "$registry/arti-api@$api_digest" &&
       "$web_ref" == "$registry/arti-web@$web_digest" &&
       "$api_digest" =~ ^sha256:[0-9a-f]{64}$ &&
       "$web_digest" =~ ^sha256:[0-9a-f]{64}$ ]]
}

valid_release "$sha" "$api" "$web" || die 'Release must use digests from the two configured ARTI repositories.'
[[ -r "$root/compose.env" && -r "$root/compose.yaml" && -r "$root/compose.deploy.yaml" &&
   -r "$root/bin/check_release_schema.py" ]] || die 'Missing deployment files.'
mkdir -p "$state"
exec 9>"$state/deploy.lock"
flock -n 9 || die 'Another ARTI deployment holds the host lock.'

compose_args=(--env-file "$root/compose.env" -p arti-shared -f "$root/compose.yaml" -f "$root/compose.deploy.yaml")
compose() {
    COMPOSE_PROFILES='' ARTI_API_IMAGE="$api" ARTI_WEB_IMAGE="$web" docker compose "${compose_args[@]}" "$@"
}

schema_matches() {
    compose run --rm --pull never --no-deps -T api python manage.py shell -c "$schema_check"
}

images_match_release() {
    local ref revision
    for ref in "$api" "$web"; do
        revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$ref")" || return 1
        [[ "$revision" == "$sha" ]] || return 1
    done
}

verify_image() {
    local service="$1" ref="$2" container expected actual
    expected="$(docker image inspect --format '{{.Id}}' "$ref")" || return 1
    container="$(compose ps -q "$service")" || return 1
    [[ -n "$container" ]] || return 1
    actual="$(docker inspect --format '{{.Image}}' "$container")" || return 1
    [[ "$actual" == "$expected" ]]
}

https_get() {
    curl --silent --show-error --noproxy '*' --resolve "$hostname:443:127.0.0.1" \
        --connect-timeout 4 --max-time 8 "$@"
}

smoke() {
    local ready page running_page asset bundle headers
    ready="$(https_get --fail "$origin/api/ready")" || return 1
    [[ "$ready" =~ \"database\"[[:space:]]*:[[:space:]]*\"postgresql\" ]] || return 1
    page="$(https_get --fail "$origin/")" || return 1
    running_page="$(compose exec -T web cat /usr/share/nginx/html/index.html)" || return 1
    if [[ -z "$page" || "$page" != "$running_page" ]]; then
        printf 'The HTTPS page does not match the running web image.\n' >&2
        return 1
    fi
    asset="$(printf '%s' "$page" | grep -oE 'src="/assets/[A-Za-z0-9_.-]+\.js"' | head -n 1)" || return 1
    asset="${asset#src=\"}"
    asset="${asset%\"}"
    bundle="$(https_get --fail -o /dev/null -w '%{http_code} %{content_type}' "$origin$asset")" || return 1
    [[ "$bundle" =~ ^200\ (application|text)/javascript([[:space:]]|\;|$) ]] || return 1
    headers="$(https_get --fail -D - -o /dev/null "$origin/password/reset")" || return 1
    grep -qiE '^cache-control:.*no-store' <<< "$headers" &&
        grep -qiE '^referrer-policy:[[:space:]]*no-referrer' <<< "$headers"
}

start_release() {
    compose up -d --no-deps --pull never --wait --wait-timeout 60 api || return 1
    compose up -d --no-deps --pull never web || return 1
    verify_image api "$api" && verify_image web "$web" || return 1
    for _ in {1..8}; do
        if smoke; then return 0; fi
        sleep 2
    done
    return 1
}

write_state() {
    local destination="$1" scratch
    shift
    scratch="$(mktemp "$state/release.XXXXXX")"
    printf '%s\n' "$@" > "$scratch"
    mv -f -- "$scratch" "$destination"
}

previous=()
compose config --quiet
if [[ -f "$state/current" ]]; then
    mapfile -t previous < "$state/current"
    if [[ ${#previous[@]} != 3 ]] || ! valid_release "${previous[@]}"; then
        die 'The active release record is invalid.'
    fi
else
    existing="$(compose ps -a -q api web)"
    [[ -z "$existing" ]] || die 'Existing application containers require an active release record.'
fi

# Check the certificate and listener before starting containers. First installation can return an upstream error here.
https_get -o /dev/null "$origin/password/reset" ||
    die 'The local HTTPS listener or certificate failed before deployment.'

export DOCKER_CONFIG
DOCKER_CONFIG="$(mktemp -d "$state/docker-auth.XXXXXX")"
trap 'rm -rf -- "$DOCKER_CONFIG"' EXIT
aws ecr get-login-password --region "$region" |
    docker login --username AWS --password-stdin "$registry" >/dev/null
compose pull api web
images_match_release || die 'The downloaded images do not match the requested release revision.'
compose up -d --no-recreate --wait --wait-timeout 60 db
schema_check="$(< "$root/bin/check_release_schema.py")"
if schema_matches; then
    printf 'Database schema matches the candidate.\n'
else
    schema_status=$?
    [[ "$schema_status" == 3 && ${#previous[@]} == 0 ]] ||
        die 'Schema check failed before cutover. Review backup and migration through the operational procedure.'
    table_count="$(compose exec -T db psql -U arti -d arti -tAc "select count(*) from pg_tables where schemaname='public'")"
    [[ "$table_count" == 0 ]] || die 'Initial migration requires an empty database.'
    compose run --rm --pull never --no-deps -T migrate
    schema_matches
fi

if start_release; then
    if [[ ${#previous[@]} == 3 && "${previous[*]}" != "$sha $api $web" ]]; then
        write_state "$state/previous" "${previous[@]}"
    fi
    write_state "$state/current" "$sha" "$api" "$web"
    printf 'Release %s verified over HTTPS.\n' "$sha"
    exit 0
fi

printf 'Candidate cutover checks failed.\n' >&2
if [[ ${#previous[@]} == 0 ]]; then
    compose rm -fs api web
    die 'Initial deployment ended before activation. The database is retained for a retry.'
fi
sha="${previous[0]}"
api="${previous[1]}"
web="${previous[2]}"
if { images_match_release || { compose pull api web && images_match_release; }; } && schema_matches && start_release; then
    die "Candidate failed. Previous release $sha is serving again."
fi
die 'Candidate and image rollback checks failed. Use the operational recovery procedure.'
