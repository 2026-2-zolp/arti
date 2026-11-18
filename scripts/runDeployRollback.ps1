#Requires -Version 7.4
param(
    [string]$Revision = 'aea8f9a',
    [string]$PreviousRevision = '99c36f5',
    [string]$IncompatibleRevision = '63aafe8'
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
. (Join-Path $PSScriptRoot 'artiTestNetwork.ps1')
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$project = 'arti-deploy-check-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$reportDir = Join-Path $repo "data/private/$project"
$scratch = Join-Path $reportDir 'scratch'
$report = [ordered]@{ status = 'failed'; project = $project }
$stage = 'prerequisites'
$images = [System.Collections.Generic.List[string]]::new()
$environment = @{}
$network = $null
$started = $false

function Invoke-DeployDocker {
    $result = & docker.exe @args 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Docker $($args[0]) exited $LASTEXITCODE." }
    $result | Where-Object { $_ -is [string] }
}

function Build-Release($ref, $role, [switch]$ApiOnly) {
    $commit = git rev-parse --verify --end-of-options "$ref^{commit}"
    if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') { throw 'Invalid release revision.' }
    $archive = Join-Path $scratch "$role.zip"
    $checkout = Join-Path $scratch $role
    git archive --format=zip --output=$archive $commit backend-django frontend
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the release archive.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $checkout
    $label = "org.opencontainers.image.revision=$commit"
    $api = "${project}-${role}-api:local"
    Write-Host "[build] $role $commit"
    Invoke-DeployDocker build --label $label -t $api "$checkout/backend-django" | Out-Null
    $images.Add($api)
    $web = $null
    if (!$ApiOnly) {
        $web = "${project}-${role}-web:local"
        Invoke-DeployDocker build --label $label -t $web -f "$checkout/frontend/Dockerfile.static" "$checkout/frontend" | Out-Null
        $images.Add($web)
    }
    @{ commit = $commit; api = $api; web = $web }
}

function Request($path, $expected, $headers = @{}, $body = $null, [switch]$StatusOnly) {
    $options = @('--silent', '--show-error', '--noproxy', '*', '--max-time', '10',
        '--cacert', $certificate, '--write-out', '\n%{http_code}', "$origin$path")
    foreach ($name in $headers.Keys) { $options += @('--header', "${name}: $($headers[$name])") }
    $lines = if ($null -eq $body) { curl.exe @options } else {
        ConvertTo-Json -InputObject $body -Depth 8 -Compress |
            curl.exe @options --header 'Content-Type: application/json; charset=utf-8' --data-binary '@-'
    }
    $lines = @($lines)
    if ($LASTEXITCODE -ne 0 -or !$lines.Count -or $expected -notcontains $lines[-1]) {
        throw "HTTPS check failed at $path (expected $($expected -join ' or '))."
    }
    if ($StatusOnly) { return [int]$lines[-1] }
    $lines[0..($lines.Count - 2)] -join "`n"
}

function Test-ProtectedResponse($path, $status) {
    $headers = (curl.exe --silent --show-error --noproxy '*' --max-time 10 --cacert $certificate -D - -o NUL "$origin$path") -join "`n"
    $curlStatus = $LASTEXITCODE
    $actualStatus = [regex]::Match($headers, '(?m)^HTTP/1\.1 (\d{3}) ').Groups[1].Value
    $noStore = $headers -match '(?im)^Cache-Control: no-store\s*$'
    $noReferrer = $headers -match '(?im)^Referrer-Policy: no-referrer\s*$'
    if ($curlStatus -ne 0 -or $status -notcontains $actualStatus -or !$noStore -or !$noReferrer) {
        $report.protectedResponseFailure = @{ endpoint = ($path -split '\?', 2)[0]; expected = $status;
            status = $actualStatus; curl = $curlStatus;
            noStore = $noStore; noReferrer = $noReferrer }
        throw 'The protected edge response did not match the expectation.'
    }
    return [int]$actualStatus
}

function Container($service) { Invoke-DeployDocker compose @compose ps -q $service }

function Test-ReleaseImages($release) {
    foreach ($service in 'api', 'web') {
        $live = Invoke-DeployDocker inspect --format '{{.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}}' (Container $service)
        $expected = Invoke-DeployDocker image inspect --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}' $release[$service]
        if ($live -ne $expected -or !$expected.EndsWith(" $($release.commit)")) { throw "Unexpected $service image." }
    }
}

function Test-StaticEntry($receiptRoute) {
    $page = Request '/' 200
    $runningPage = (Invoke-DeployDocker compose @compose exec -T web cat /usr/share/nginx/html/index.html) -join "`n"
    if (!$page -or $page.TrimEnd("`n") -cne $runningPage.TrimEnd("`n")) {
        throw 'Expected the HTTPS entry point to match the running web image.'
    }
    if ((Request $receiptRoute 200) -cne $page) { throw 'Expected the same SPA at the direct receipt route.' }
    $asset = [regex]::Match($page, '<script[^>]*src="(?<url>/assets/[^"?]+\.js)"').Groups['url'].Value
    if (!$asset) { throw 'The release SPA does not reference a bundled script.' }
    Request $asset 200 | Out-Null
    $asset
}

function Get-DataIdentity {
    $cluster = Invoke-DeployDocker compose @compose exec -T db psql -U arti -d arti -tAc 'select system_identifier from pg_control_system()'
    $migrationSet = Invoke-DeployDocker compose @compose exec -T db psql -U arti -d arti -tAc 'select app || chr(58) || name from django_migrations order by app, name'
    $storage = foreach ($service in 'db', 'api') {
        Invoke-DeployDocker inspect --format '{{range .Mounts}}{{.Name}}{{end}}' (Container $service)
    }
    $media = Invoke-DeployDocker compose @compose exec -T api sha256sum /app/media/fixture-public.png /app/media/fixture-private.png
    @($cluster) + @($migrationSet) + @($storage) + @($media)
}

Push-Location $repo
try {
    Get-Command docker.exe, git, curl.exe, python -ErrorAction Stop | Out-Null
    New-Item -ItemType Directory -Path $scratch | Out-Null
    $stage = 'build'
    $candidate = Build-Release $Revision 'candidate'
    $previous = Build-Release $PreviousRevision 'previous'
    $incompatible = Build-Release $IncompatibleRevision 'incompatible' -ApiOnly
    if (@($candidate.commit, $previous.commit, $incompatible.commit | Select-Object -Unique).Count -ne 3) {
        throw 'The candidate and both comparison revisions must be distinct.'
    }
    $report.revisions = @{ candidate = $candidate.commit; previous = $previous.commit; incompatible = $incompatible.commit }

    $stage = 'compose-config'
    $variables = @([regex]::Matches(((Get-Content -Raw compose.yaml), (Get-Content -Raw compose.deploy.yaml) -join "`n"),
        '\$\{([A-Z][A-Z0-9_]*)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
    foreach ($name in $variables + @('COMPOSE_PROFILES')) {
        $environment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    $env:ARTI_API_IMAGE = $candidate.api
    $env:ARTI_WEB_IMAGE = $candidate.web
    $env:ARTI_DB_IMAGE = 'postgres:17-alpine'
    $env:ARTI_DEPLOY_HTTP_PORT = '0'
    $env:ARTI_DB_PASSWORD = [guid]::NewGuid().ToString('N')
    $env:DJANGO_SECRET_KEY = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
    $env:ARTI_TASTE_PROFILE_V2_ENABLED = 'true'
    $password = 'synthetic-demo-' + [guid]::NewGuid().ToString('N')
    $dotenv = Join-Path $scratch 'compose.env'
    '# Values are limited to this process.' | Set-Content -LiteralPath $dotenv -Encoding ascii
    $deploy = @('--env-file', $dotenv, '-p', $project, '-f', 'compose.yaml', '-f', 'compose.deploy.yaml')
    $active = @(Invoke-DeployDocker compose @deploy config --services)
    $cfg = (Invoke-DeployDocker compose @deploy --profile migration --profile reset-mail config --format json) -join "`n" | ConvertFrom-Json
    if ((Compare-Object @('db', 'api', 'web') $active) -or $cfg.services.api.ports -or $cfg.services.db.ports -or
        $cfg.services.api.build -or $cfg.services.migrate.build -or $cfg.services.'reset-mail'.build -or
        $cfg.services.api.environment.ARTI_ENV -ne 'production' -or $cfg.services.api.environment.ALLOW_TEST_FIXTURES -ne 'false' -or
        $cfg.services.api.depends_on.migrate -or $cfg.services.web.ports.host_ip -ne '127.0.0.1') { throw 'Unsafe resolved release configuration.' }

    $stage = 'deploy-https'
    Write-Host '[deploy-https] Start the release behind a separate trusted loopback TLS proxy'
    Invoke-DeployDocker run --rm --pull never --network none --user 0 --entrypoint python -v "$scratch`:/tls" $candidate.api -c "from pathlib import Path; from arti.tests.kakao_browser_server import write_certificate; write_certificate(Path('/tls'))" | Out-Null
    $certificate = Join-Path $scratch 'cert.pem'
    $edgeConf = Join-Path $scratch 'edge.conf'
    $edgeTemplate = Get-Content -Raw -LiteralPath 'ops/nginx/arti-https.conf.template'
    $edgeTemplate.Replace('@ARTI_HTTPS_HOST@', '127.0.0.1').Replace('@ARTI_TLS_CERT@', '/tls/cert.pem').
        Replace('@ARTI_TLS_KEY@', '/tls/key.pem').Replace('@ARTI_WEB_UPSTREAM@', 'http://web:80').
        Replace('@ARTI_EDGE_RESOLVER@', 'resolver 127.0.0.11 valid=1s ipv6=off;') |
            Set-Content -LiteralPath $edgeConf -Encoding utf8NoBOM
    $network = New-ArtiTestNetwork $project -ExplicitSubnet
    $overlay = Join-Path $scratch 'compose.rehearsal.yaml'
    $mount = $scratch.Replace('\', '/')
    @"
services:
  edge:
    image: $($candidate.web)
    ports: ['127.0.0.1::443']
    volumes:
      - "$mount/edge.conf:/etc/nginx/conf.d/default.conf:ro"
      - "${mount}:/tls:ro"
networks:
  default:
    external: true
    name: $($network.name)
"@ | Set-Content -LiteralPath $overlay -Encoding utf8NoBOM
    $compose = $deploy + @('-f', $overlay)
    $started = $true
    Invoke-DeployDocker compose @compose up -d --pull never --wait db | Out-Null
    Invoke-DeployDocker compose @compose run --rm --pull never --no-deps -T migrate | Out-Null
    Invoke-DeployDocker compose @compose up -d --pull never --wait web edge | Out-Null
    if ((Invoke-DeployDocker compose @compose port web 80) -notmatch '^127\.0\.0\.1:\d+$') { throw 'The web port is not loopback.' }
    $binding = Invoke-DeployDocker compose @compose port edge 443
    if ($binding -notmatch '^127\.0\.0\.1:\d+$') { throw 'The TLS proxy is not loopback.' }
    $origin = "https://$binding"
    Invoke-DeployDocker compose @compose exec -T web nginx -t | Out-Null
    Invoke-DeployDocker compose @compose exec -T edge nginx -t | Out-Null
    Test-ReleaseImages $candidate
    foreach ($feature in 'mail', 'kakao') {
        python scripts/probe_account_https.py $origin $feature --local-ca $certificate --expect-disabled
        if ($LASTEXITCODE -ne 0) { throw 'HTTPS account route or headers did not match.' }
    }
    $guard = & docker.exe compose @compose exec -T -e ALLOW_TEST_FIXTURES=true api python manage.py load_test_fixture 2>&1
    if ($LASTEXITCODE -ne 1 -or ($guard -join ' ') -notmatch 'Test fixtures require development/test') {
        throw 'The deployed API did not reject production fixture loading.'
    }
    Invoke-DeployDocker compose @compose exec -T -e ARTI_ENV=test -e ALLOW_TEST_FIXTURES=true api python manage.py load_test_fixture | Out-Null
    Invoke-DeployDocker compose @compose exec -T -e "ARTI_BOOTSTRAP_PASSWORD=$password" api python manage.py bootstrap_admin --login-id release-test --name 'Synthetic administrator' | Out-Null
    $signup = @{ password = $password; termsAccepted = $true; termsVersion = '2026-11-14-draft.1' }
    $owner = (Request '/api/auth/signup' 200 @{} ($signup + @{ email = 'release-owner@example.test' })) | ConvertFrom-Json
    $other = (Request '/api/auth/signup' 200 @{} ($signup + @{ email = 'release-other@example.test' })) | ConvertFrom-Json
    $admin = (Request '/api/admin/login' 200 @{} @{ id = 'release-test'; password = $password }) | ConvertFrom-Json
    $ownerHeaders = @{ Authorization = "Bearer $($owner.token)" }
    $otherHeaders = @{ Authorization = "Bearer $($other.token)" }
    $adminHeaders = @{ 'X-Admin-Token' = $admin.token }
    $visit = @{ visitId = [guid]::NewGuid().ToString(); exhibitionId = 'fixture-ex01'; viewedArtworkIds = @('fixture-art01');
        date = [DateTime]::UtcNow.ToString('o'); durationMin = 5; selectedDuration = '30m'; recommendedCount = 1; requestGeneration = 1;
        reactions = @{ 'fixture-art01' = 'like' }; reactionReasons = @{ 'fixture-art01' = 'Synthetic release' } }
    $created = (Request '/api/visits' 201 $ownerHeaders $visit) | ConvertFrom-Json
    if (!$created.id -or $created.visitId -ne $visit.visitId -or $created.userId -ne $owner.user.id) {
        throw 'The candidate receipt did not match the submitted visit.'
    }
    $receiptRoute = "/receipt/$($created.id)"
    $receiptApi = "/api/visits/$($created.id)"
    $receiptBefore = Request $receiptApi 200 $ownerHeaders
    $candidateAsset = Test-StaticEntry $receiptRoute
    $dataBefore = Get-DataIdentity
    $edge = Container 'edge'
    $marker = 'SYNTHETIC-EDGE-' + [guid]::NewGuid().ToString('N')
    Test-ProtectedResponse "/api/auth/kakao/callback?probe=$marker" 404 | Out-Null
    Test-ProtectedResponse "/password/reset?probe=$marker" 200 | Out-Null
    $report.deploy = @{ ready = 200; ownerSave = 201; tlsTrusted = $true; implicitMigration = $false; fixtureGuard = 'passed' }

    $stage = 'rollback-schema'
    Write-Host '[rollback-schema] Reject an older migration set and accept the same-schema release'
    $check = Get-Content -Raw -LiteralPath 'scripts/check_release_schema.py'
    $env:ARTI_API_IMAGE = $incompatible.api
    $mismatch = & docker.exe compose @compose run --rm --pull never --no-deps -T api python manage.py shell -c $check 2>&1
    if ($LASTEXITCODE -ne 3 -or ($mismatch -join ' ') -notmatch 'Release schema differs: 0 missing, [1-9]\d* extra') {
        throw 'Expected the incompatible image check to block an image-only rollback.'
    }
    Test-ReleaseImages $candidate
    $env:ARTI_API_IMAGE = $previous.api
    $env:ARTI_WEB_IMAGE = $previous.web
    Invoke-DeployDocker compose @compose run --rm --pull never --no-deps -T api python manage.py shell -c $check | Out-Null
    $report.schema = @{ olderImageBlocked = $true; previousImageAllowed = $true }

    $stage = 'rollback'
    Write-Host '[rollback] Simulate API outage and restore the prior Django/Nginx images without migration'
    $gatewayErrors = @(502, 504)
    Invoke-DeployDocker compose @compose stop api | Out-Null
    $apiOutageStatus = Request '/api/ready' $gatewayErrors -StatusOnly
    Test-StaticEntry $receiptRoute | Out-Null
    Invoke-DeployDocker compose @compose stop web | Out-Null
    $protectedOutage = @{
        kakao = Test-ProtectedResponse "/api/auth/kakao/callback?probe=$marker" $gatewayErrors
        reset = Test-ProtectedResponse "/password/reset?probe=$marker" $gatewayErrors
    }
    Request '/api/ready?probe=release-outage-control' $gatewayErrors | Out-Null
    # Compose captures both access and error output. Keep the synthetic marker out of the report.
    $edgeLog = (& docker.exe compose @compose logs --no-color edge 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $edgeLog.Contains($marker) -or !$edgeLog.Contains('release-outage-control')) {
        throw 'Edge logs retained a protected query or lost the ordinary outage.'
    }
    Invoke-DeployDocker compose @compose up -d --pull never --no-deps --wait api | Out-Null
    Invoke-DeployDocker compose @compose up -d --pull never --no-deps web | Out-Null
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        try {
            $ready = (Request '/api/ready' 200) | ConvertFrom-Json
            if ($ready.database -eq 'postgresql') { break }
        } catch {
            if ($attempt -eq 11) { throw }
        }
        Start-Sleep -Seconds 1
    }
    if ($ready.database -ne 'postgresql' -or (Container 'edge') -ne $edge) { throw 'The same TLS endpoint did not recover.' }
    Test-ReleaseImages $previous
    $previousAsset = Test-StaticEntry $receiptRoute
    if ((Compare-Object $dataBefore (Get-DataIdentity)) -or $candidateAsset -eq $previousAsset) {
        throw 'Expected the original DB and media with a different frontend bundle.'
    }
    if ((Request $receiptApi 200 $ownerHeaders) -cne $receiptBefore -or
        (Request "/api/admin/visits/$($created.id)" 200 $adminHeaders) -cne $receiptBefore) { throw 'Receipt identity changed after rollback.' }
    Request $receiptApi 403 $otherHeaders | Out-Null
    Request $receiptApi 401 | Out-Null
    $counts = Invoke-DeployDocker compose @compose exec -T db psql -U arti -d arti -tAc 'select (select count(*) from arti_visit), (select count(*) from arti_visitreaction)'
    if ($counts -ne '1|1') { throw 'Expected one visit and reaction after rollback.' }
    $report.rollback = @{ ready = @(200, $apiOutageStatus, 200); sameTlsProxy = $true; bundleChanged = $true; httpsIndexMatchesWebBeforeAndAfter = $true; sameDatabaseAndMedia = $true;
        sameReceipt = $true; receipts = 1; reactions = 1; permissions = @(200, 200, 403, 401);
        protectedOutage = $protectedOutage; protectedOutageLogs = 'passed' }
    $report.status = 'passed'
} catch {
    $report.failedStage = $stage
    $report.failedLine = $_.InvocationInfo.ScriptLineNumber
    Write-Host "Rehearsal failed at $stage line $($report.failedLine)."
} finally {
    $report.cleanup = 'passed'
    if ($started) {
        try { Invoke-DeployDocker compose @compose --profile migration --profile reset-mail down --volumes | Out-Null }
        catch { $report.cleanup = 'failed' }
    }
    if ($network) {
        try { Remove-ArtiTestNetwork $network }
        catch { $report.cleanup = 'failed' }
    }
    if ($images.Count) {
        try { Invoke-DeployDocker image rm @images | Out-Null }
        catch { $report.cleanup = 'failed' }
    }
    foreach ($name in $environment.Keys) { [Environment]::SetEnvironmentVariable($name, $environment[$name], 'Process') }
    if (Test-Path -LiteralPath $scratch) {
        try {
            $resolved = (Resolve-Path -LiteralPath $scratch).Path
            if ($resolved -ne (Join-Path (Resolve-Path -LiteralPath $reportDir).Path 'scratch')) { throw 'Unexpected scratch path.' }
            Remove-Item -LiteralPath $resolved -Recurse -Force
        } catch { $report.cleanup = 'failed' }
    }
    if ($report.cleanup -ne 'passed') { $report.status = 'failed' }
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $reportDir 'result.json') -Encoding utf8
    Pop-Location
}
if ($report.status -ne 'passed') { throw "Deployment rollback rehearsal failed. See $reportDir/result.json." }
Write-Output "PASS $reportDir/result.json"
