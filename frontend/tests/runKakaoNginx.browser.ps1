param(
    [Parameter(Mandatory)] [string]$ApiImage,
    [string]$WebImage = 'nginx:1.28-alpine',
    [ValidateRange(1024, 65535)] [int]$HttpsPort = 5623,
    [switch]$UseImageContents
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$apiMount = @()
$webMount = @()
if (-not $UseImageContents) {
    $apiMount = @('-v', "$repo/backend-django`:/app:ro")
    $webMount = @('-v', "$repo/frontend/dist`:/usr/share/nginx/html:ro")
}
if (-not $UseImageContents -and -not (Test-Path -LiteralPath "$repo/frontend/dist/index.html")) {
    throw 'Build the Django-target frontend before running this regression.'
}
$prefix = 'arti-kakao-https-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$scratch = Join-Path $repo "data/private/$prefix"
$previousPort = $env:ARTI_KAKAO_BROWSER_PORT
$net = $db = $api = $web = $null

function Invoke-ArtiDocker {
    docker @args
    if ($LASTEXITCODE -ne 0) { throw "Docker $($args[0]) failed." }
}

function Get-ArtiContainerLog([string]$Container) {
    (Invoke-ArtiDocker logs $Container 2>&1 | ForEach-Object { "$_" }) -join "`n"
}

Push-Location $repo
try {
    New-Item -ItemType Directory -Path $scratch | Out-Null
    Invoke-ArtiDocker run --rm --pull never --network none --user 0 --entrypoint python @apiMount -v "$scratch`:/run/kakao-https" $ApiImage -c "from pathlib import Path; from arti.tests.kakao_browser_server import write_certificate; write_certificate(Path('/run/kakao-https'))"

    $conf = if ($UseImageContents) {
        (Invoke-ArtiDocker run --rm --pull never --network none --entrypoint cat $WebImage /etc/nginx/conf.d/default.conf) -join "`n"
    } else {
        Get-Content -Raw -Encoding utf8 -LiteralPath "$repo/frontend/nginx.static.conf"
    }
    $tls = @'
    listen 443 ssl;
    ssl_certificate /run/kakao-https/cert.pem;
    ssl_certificate_key /run/kakao-https/key.pem;
'@
    if (-not $conf.Contains('    listen 80;')) { throw 'The static Nginx config no longer has the expected test overlay point.' }
    Set-Content -LiteralPath "$scratch/nginx.conf" -Encoding utf8NoBOM -NoNewline -Value $conf.Replace('    listen 80;', $tls)

    $net = Invoke-ArtiDocker network create $prefix
    $db = Invoke-ArtiDocker run --rm -d --pull never --name "$prefix-db" --network $net --network-alias api -e POSTGRES_DB=arti_kakao_browser_nginx -e POSTGRES_USER=arti -e POSTGRES_PASSWORD=only-nginx-kakao-fixture postgres:17-alpine
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        docker exec $db pg_isready -q -h 127.0.0.1 -U arti -d arti_kakao_browser_nginx
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Milliseconds 300
    }
    if ($LASTEXITCODE -ne 0) { throw 'The test database did not start.' }

    $apiProgram = @'
python manage.py migrate --noinput && python manage.py load_test_fixture &&
exec gunicorn 'arti.tests.kakao_browser_server:create_gunicorn_application()' --bind 0.0.0.0:8000 --workers 1 --timeout 90 --access-logfile - --access-logformat '%(h)s %(t)s %(m)s %(U)s %(s)s %(L)s'
'@
    $fixtureEnv = @(
        '-e','ARTI_ENV=test','-e','ALLOW_TEST_FIXTURES=true',
        '-e','ARTI_LLM_PROVIDER=disabled','-e','ARTI_MODEL_SERVICE_URL=','-e','OPENAI_API_KEY=',
        '-e','ARTI_KAKAO_CLIENT_ID=','-e','ARTI_KAKAO_CLIENT_SECRET=','-e','ARTI_KAKAO_CALLBACK_URL=',
        '-e',"ARTI_KAKAO_BROWSER_PORT=$HttpsPort",'-e','DJANGO_SETTINGS_MODULE=config.settings',
        '-e','DJANGO_SECRET_KEY=only-nginx-kakao-probe-test-resource',
        '-e','PGHOST=127.0.0.1','-e','PGPORT=5432','-e','PGDATABASE=arti_kakao_browser_nginx',
        '-e','PGUSER=arti','-e','PGPASSWORD=only-nginx-kakao-fixture','-e','MEDIA_ROOT=/tmp/fixture-media'
    )
    # Django shares only this test DB's network namespace to keep PGHOST on loopback.
    $api = Invoke-ArtiDocker run --rm -d --pull never --name "$prefix-api" --network "container:$db" @fixtureEnv @apiMount --entrypoint sh $ApiImage -ec $apiProgram
    $web = Invoke-ArtiDocker run --rm -d --pull never --name "$prefix-web" --network $net -p "127.0.0.1:${HttpsPort}:443" --entrypoint nginx -v "$scratch/nginx.conf`:/etc/nginx/conf.d/default.conf:ro" -v "$scratch`:/run/kakao-https:ro" @webMount $WebImage -g 'daemon off;'

    $base = "https://127.0.0.1:$HttpsPort"
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        $ready = curl.exe -ksS -o NUL -w '%{http_code}' --max-time 4 "$base/api/ready" 2>$null
        if ($ready -eq '200') { break }
        Start-Sleep -Milliseconds 500
    }
    if ($ready -ne '200') { throw 'Nginx did not reach the synthetic Django API.' }
    Invoke-ArtiDocker exec $web nginx -t

    $env:ARTI_KAKAO_BROWSER_PORT = "$HttpsPort"
    node frontend/tests/kakaoAuth.browser.mjs --external-proxy
    if ($LASTEXITCODE -ne 0) { throw 'Nginx HTTPS Chrome scenarios failed.' }

    $webHealthy = Get-ArtiContainerLog $web
    $apiHealthy = Get-ArtiContainerLog $api
    $sensitive = 'code=|state=|token=|Bearer |__Host-arti-kakao-flow|synthetic-browser-secret'
    if ($webHealthy -notmatch 'POST /api/auth/kakao/finish' -or $webHealthy -match '/api/auth/kakao/callback' -or $webHealthy -match $sensitive) {
        throw 'Unexpected OAuth data or missing control request in Nginx logs.'
    }
    if ($apiHealthy -notmatch 'GET /api/auth/kakao/callback 302' -or $apiHealthy -match $sensitive) {
        throw 'Unexpected OAuth data or missing path-only callback in Gunicorn logs.'
    }
    'PASS HTTPS normal callback: Nginx omits the request; Gunicorn records path and status only'

    Invoke-ArtiDocker stop $api | Out-Null
    $api = $null
    $headers = (curl.exe -ksS -D - -o NUL --max-time 10 "$base/api/auth/kakao/callback?code=SYNTHETIC-OUTAGE-CODE&state=SYNTHETIC-OUTAGE-STATE") -join "`n"
    if ($headers -notmatch '(?im)^HTTP/1\.1 502' -or $headers -notmatch '(?im)^Cache-Control: no-store\s*$' -or $headers -notmatch '(?im)^Referrer-Policy: no-referrer\s*$') {
        throw 'The callback outage did not retain 502 and privacy headers.'
    }
    $normal = curl.exe -ksS -o NUL -w '%{http_code}' --max-time 10 "$base/api/ready?probe=SYNTHETIC-NORMAL-ERROR-CONTROL"
    if ($normal -ne '502') { throw 'The normal API outage control did not return 502.' }
    $outageLogs = Get-ArtiContainerLog $web
    if ($outageLogs -match 'SYNTHETIC-OUTAGE-CODE|SYNTHETIC-OUTAGE-STATE' -or $outageLogs -notmatch '(?m)\[error\].*SYNTHETIC-NORMAL-ERROR-CONTROL') {
        throw 'The callback error log suppression or the normal API control failed.'
    }
    'PASS HTTPS callback outage: 502 retains no-store/no-referrer and hides code/state; normal API failure is logged'
} finally {
    foreach ($container in @($web, $api, $db)) {
        if ($container) { docker rm -f $container | Out-Null }
    }
    if ($net) { docker network rm $net | Out-Null }
    foreach ($file in @('nginx.conf', 'key.pem', 'cert.pem')) {
        Remove-Item -LiteralPath (Join-Path $scratch $file) -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch }
    $env:ARTI_KAKAO_BROWSER_PORT = $previousPort
    Pop-Location
}
