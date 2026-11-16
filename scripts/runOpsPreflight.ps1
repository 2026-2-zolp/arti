#Requires -Version 7.3
[CmdletBinding()]
param(
    [string]$Revision = 'HEAD',
    [ValidateRange(1024, 65535)] [int]$HttpsPort = 5623
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$trial = 'arti-preflight-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$reportDir = Join-Path $repo "data/private/$trial"
$reportPath = Join-Path $reportDir 'result.json'
$scratch = Join-Path $reportDir 'scratch'
$apiImage = "${trial}-api:local"
$webImage = "${trial}-web:local"
$builtImages = @()
$pendingSource = $null
$pendingCandidate = $null
$faultNetwork = $null
$recoveryNetwork = $null
$report = [ordered]@{ run = $trial; revision = $null; status = 'failed'; failedStage = $null; stages = [ordered]@{} }
$stage = 'prerequisites'
$failure = $null

function Invoke-ProbeDocker {
    $output = & docker @args 2>&1
    if ($LASTEXITCODE -ne 0) {
        $report.nativeExit = $LASTEXITCODE
        $report.failedLine = (Get-PSCallStack)[1].ScriptLineNumber
        throw "Docker $($args[0]) exited $LASTEXITCODE."
    }
    $output
}

function Invoke-ProbeHttp($base, $path, $expected, $headers = @{}, $body = $null) {
    $request = @{ Uri = "$base$path"; Headers = $headers; SkipHttpErrorCheck = $true; NoProxy = $true; TimeoutSec = 10 }
    if ($null -ne $body) {
        $request.Method = 'Post'
        $request.ContentType = 'application/json'
        $request.Body = $body | ConvertTo-Json -Compress -Depth 5
    }
    $response = Invoke-WebRequest @request
    if ([int]$response.StatusCode -ne $expected) {
        $report.httpStatus = @{ expected = $expected; actual = [int]$response.StatusCode }
        throw 'Unexpected HTTP status.'
    }
    $response
}

function Convert-ProbeJson($response) {
    ConvertFrom-Json -InputObject $response.Content -NoEnumerate
}

function Get-ProbeWeb([string[]]$project) {
    $port = Invoke-ProbeDocker compose @project port web 80
    if ($port -notmatch '^127\.0\.0\.1:[0-9]+$') { throw 'The probe web service must use IPv4 loopback.' }
    "http://$port"
}

function Test-ProbeStartup([string[]]$project, $base) {
    foreach ($service in 'api', 'migrate', 'web') {
        $container = Invoke-ProbeDocker compose @project ps -a -q $service
        $state = Invoke-ProbeDocker inspect --format '{{.Image}} {{.State.Status}} {{.State.ExitCode}}' $container
        $expected = switch ($service) {
            'api' { "$apiId running 0" }
            'migrate' { "$apiId exited 0" }
            'web' { "$webId running 0" }
        }
        if ($state -ne $expected) { throw 'Unexpected container image or migration state.' }
    }
    Invoke-ProbeDocker compose @project exec -T api python manage.py migrate --check | Out-Null
    Invoke-ProbeDocker compose @project exec -T web nginx -t | Out-Null
    $ready = Convert-ProbeJson (Invoke-ProbeHttp $base '/api/ready' 200)
    $ai = (Convert-ProbeJson (Invoke-ProbeHttp $base '/api/health' 200)).aiConfiguration
    if ($ready.database -ne 'postgresql' -or $ai.docent -ne 'disabled' -or $ai.analysis -ne 'disabled') {
        throw 'Expected PostgreSQL readiness with AI disabled.'
    }
}

function New-ProbeNetwork($name, [switch]$Internal) {
    $mode = @(if ($Internal) { '--internal' })
    for ($attempt = 0; $attempt -lt 8; $attempt++) {
        $prefix = "10.247.$(Get-Random -Maximum 256)"
        $block = (Get-Random -Maximum 16) * 16
        $id = docker network create --driver bridge @mode --subnet "$prefix.$block/28" --ip-range "$prefix.$block/29" $name 2>&1
        if ($LASTEXITCODE -eq 0) {
            # Reserve the upper half of the subnet for deterministic API replacement addresses.
            return @{ id = $id; name = $name; firstApi = "$prefix.$($block + 9)"; nextApi = "$prefix.$($block + 10)" }
        }
        if (($id -join ' ') -notmatch 'Pool overlaps') { throw 'Could not create the isolated candidate network.' }
    }
    throw 'No unused subnet found for the isolated candidate network.'
}

function Wait-ProbeNginxReadyStatus($base, $expected) {
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        $response = Invoke-WebRequest "$base/api/ready?check=dns" -SkipHttpErrorCheck -NoProxy -TimeoutSec 10
        if ([int]$response.StatusCode -eq $expected) { return $response }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    $report.httpStatus = @{ expected = $expected; actual = [int]$response.StatusCode }
    throw 'Nginx did not return the expected readiness status after the API change.'
}

New-Item -ItemType Directory -Path $scratch | Out-Null
Push-Location $repo
try {
    Get-Command git, docker, node, curl.exe -ErrorAction Stop | Out-Null
    if (!$env:PLAYWRIGHT_MODULE -and !(Test-Path -LiteralPath 'frontend/node_modules/playwright/package.json')) {
        throw 'Install the locked frontend dependencies for Playwright.'
    }
    $report.docker = Invoke-ProbeDocker version --format '{{.Server.Version}}'
    $report.compose = Invoke-ProbeDocker compose version --short
    $report.stages[$stage] = 'passed'

    $stage = 'build'
    Write-Host '[build] Build images from the requested Git revision'
    $commit = git rev-parse --verify --end-of-options "$Revision^{commit}" 2>&1
    if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'Choose a Git commit that exists locally.' }
    $report.revision = $commit
    $archive = Join-Path $scratch 'source.zip'
    $checkout = Join-Path $scratch 'checkout'
    git archive --format=zip --output=$archive $commit
    if ($LASTEXITCODE -ne 0) { throw 'Could not archive the selected commit.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $checkout
    $label = "org.opencontainers.image.revision=$commit"
    Invoke-ProbeDocker build --label $label --tag $apiImage "$checkout/backend-django" | Out-Null
    $builtImages += $apiImage
    Invoke-ProbeDocker build --label $label --tag $webImage --file "$checkout/frontend/Dockerfile.static" "$checkout/frontend" | Out-Null
    $builtImages += $webImage
    $apiInfo, $webInfo = Invoke-ProbeDocker image inspect --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}' $apiImage $webImage
    $apiId, $apiRevision = $apiInfo -split ' ', 2
    $webId, $webRevision = $webInfo -split ' ', 2
    if ($apiRevision -cne $commit -or $webRevision -cne $commit) { throw 'Image revision does not match requested commit.' }
    $report.stages[$stage] = @{ apiImage = $apiId; webImage = $webId }

    $stage = 'source-startup'
    Write-Host '[source-startup] Start isolated PostgreSQL, Django and Nginx'
    $password = 'Synthetic-' + [guid]::NewGuid().ToString('N')
    $dbPassword = [guid]::NewGuid().ToString('N')
    $key = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
    $envFile = Join-Path $scratch 'compose.env'
    @("ARTI_DB_PASSWORD=$dbPassword", "DJANGO_SECRET_KEY=$key") | Set-Content -LiteralPath $envFile -Encoding utf8
    $overlay = Join-Path $scratch 'compose.preflight.yaml'
    @"
x-api: &runtime
  image: $apiImage
  environment:
    PGPASSWORD: '$dbPassword'
    DJANGO_SECRET_KEY: '$key'
    ARTI_ENV: production
    ALLOW_TEST_FIXTURES: 'false'
    ARTI_TASTE_PROFILE_V2_ENABLED: 'true'
    ARTI_TASTE_APPROVED_SIGNATURE_SHA256: ''
    ARTI_ALLOWED_ORIGINS: ''
    ARTI_LLM_PROVIDER: disabled
    OPENAI_API_KEY: ''
    ARTI_MODEL_SERVICE_URL: ''
    ARTI_KAKAO_CLIENT_ID: ''
    ARTI_KAKAO_CLIENT_SECRET: ''
    ARTI_KAKAO_CALLBACK_URL: ''
services:
  db:
    environment:
      POSTGRES_PASSWORD: '$dbPassword'
  api:
    <<: *runtime
    ports: !reset []
  migrate:
    <<: *runtime
  web:
    image: $webImage
    depends_on:
      api:
        condition: service_healthy
    ports:
      - '127.0.0.1::80'
"@ | Set-Content -LiteralPath $overlay -Encoding utf8
    $compose = @('--env-file', $envFile, '-f', "$checkout/compose.yaml", '-f', $overlay)
    $source = $compose + @('-p', "$trial-src")
    $restore = $compose + @('-p', "$trial-dst")
    $pendingSource = $source
    Invoke-ProbeDocker compose @source up -d --no-build --wait --wait-timeout 100 web | Out-Null
    $sourceUrl = Get-ProbeWeb $source
    Test-ProbeStartup $source $sourceUrl
    $accounts = Invoke-ProbeDocker compose @source exec -T db psql -U arti -d arti -tAc 'select count(*) from arti_account'
    $guard = docker compose @source exec -T -e ALLOW_TEST_FIXTURES=true api python manage.py load_test_fixture 2>&1
    if ($LASTEXITCODE -ne 1 -or ($guard -join ' ') -notmatch 'Test fixtures require development/test' -or $accounts -ne '0') {
        throw 'Expected a blank account table and the production fixture guard.'
    }
    $report.stages[$stage] = @{ ready = 200; database = 'postgresql'; migrateExit = 0; initialAccounts = 0; fixtureGuard = 'passed' }

    $stage = 'source-receipt'
    Write-Host '[source-receipt] Save and read a synthetic receipt on the source stack'
    Invoke-ProbeDocker compose @source exec -T -e ARTI_ENV=test -e ALLOW_TEST_FIXTURES=true api python manage.py load_test_fixture | Out-Null
    Invoke-ProbeDocker compose @source exec -T -e "ARTI_BOOTSTRAP_PASSWORD=$password" api python manage.py bootstrap_admin --login-id demo-admin --name 'Synthetic preflight' | Out-Null
    $ownerLogin = @{ email = 'preflight-owner@example.test'; password = $password }
    $owner = Convert-ProbeJson (Invoke-ProbeHttp $sourceUrl '/api/auth/signup' 200 @{} ($ownerLogin + @{ termsAccepted = $true; termsVersion = '2026-11-14-draft.1' }))
    $order = @('fixture-art01', 'fixture-art03', 'fixture-art05')
    $payload = @{
        visitId = [guid]::NewGuid().ToString(); exhibitionId = 'fixture-ex01'; viewedArtworkIds = $order
        date = [DateTime]::UtcNow.ToString('o'); durationMin = 5; selectedDuration = '30m'; recommendedCount = 3; requestGeneration = 1
        reactions = @{ 'fixture-art01' = 'like' }; reactionReasons = @{ 'fixture-art01' = 'Synthetic preflight' }
    }
    $sourceMemberHeaders = @{ Authorization = "Bearer $($owner.token)" }
    $original = Convert-ProbeJson (Invoke-ProbeHttp $sourceUrl '/api/visits' 201 $sourceMemberHeaders $payload)
    if (!$original.id -or $original.visitId -ne $payload.visitId) { throw 'The saved synthetic visit did not match its input.' }
    $path = "/api/visits/$($original.id)"
    $sourceReceipt = Invoke-ProbeHttp $sourceUrl $path 200 $sourceMemberHeaders
    $report.stages[$stage] = @{ created = 201; lookup = 200 }

    $stage = 'candidate-migration-failure'
    Write-Host '[candidate-migration-failure] Reject a bad migration credential while the source stays online'
    $faultNetwork = New-ProbeNetwork "$trial-fault" -Internal
    $faultOverlay = Join-Path $scratch 'compose.fault.yaml'
    @"
services:
  migrate:
    environment:
      PGPASSWORD: '${dbPassword}-invalid'
networks:
  default:
    external: true
    name: $($faultNetwork.name)
"@ | Set-Content -LiteralPath $faultOverlay -Encoding utf8
    $faulted = $restore + @('-f', $faultOverlay)
    $pendingCandidate = $faulted
    docker compose @faulted up -d --no-build --pull never --wait --wait-timeout 100 web 2>&1 | Out-Null
    $upExit = $LASTEXITCODE
    $migration = Invoke-ProbeDocker compose @faulted ps -a -q migrate
    $migrationState = Invoke-ProbeDocker inspect --format '{{.Image}} {{.State.Status}} {{.State.ExitCode}}' $migration
    $migrationLog = Invoke-ProbeDocker compose @faulted logs --no-color migrate
    if ($upExit -eq 0 -or $migrationState -ne "$apiId exited 1" -or
        ($migrationLog -join ' ') -notmatch 'password authentication failed') {
        throw 'The candidate migration did not fail specifically on database authentication.'
    }
    foreach ($service in 'api', 'web') {
        $blocked = Invoke-ProbeDocker compose @faulted ps -a -q $service
        if ($blocked -and (Invoke-ProbeDocker inspect --format '{{.State.Status}}' $blocked) -ne 'created') {
            throw 'A candidate service started before migration succeeded.'
        }
    }
    $tableCountSql = "select count(*) from pg_tables where schemaname='public'"
    $systemIdSql = 'select system_identifier from pg_control_system()'
    $faultTables = Invoke-ProbeDocker compose @faulted exec -T db psql -U arti -d arti -tAc $tableCountSql
    $candidateSystemId = Invoke-ProbeDocker compose @faulted exec -T db psql -U arti -d arti -tAc $systemIdSql
    if ($faultTables -ne '0' -or !$candidateSystemId) { throw 'The failed candidate must remain an initialized cluster with zero public tables.' }
    Invoke-ProbeHttp $sourceUrl '/api/ready' 200 | Out-Null
    $duringFailure = Invoke-ProbeHttp $sourceUrl $path 200 $sourceMemberHeaders
    if ($sourceReceipt.Content -cne $duringFailure.Content) { throw 'The source receipt changed during the candidate failure.' }
    $report.stages[$stage] = @{ composeUpExit = $upExit; migrateExit = 1; databaseAuthRejected = $true; candidateApiBlocked = $true; candidateWebBlocked = $true; publicTables = 0; sourceReady = 200; sourceReceipt = 200; sameSourceReceipt = $true }
    Invoke-ProbeDocker compose @faulted down | Out-Null
    $pendingCandidate = $restore
    Invoke-ProbeDocker network rm $faultNetwork.id | Out-Null
    $faultNetwork = $null

    $stage = 'synthetic-backup'
    Write-Host '[synthetic-backup] Back up the source PostgreSQL and media'
    Invoke-ProbeDocker compose @source stop web | Out-Null
    $hashCommand = 'cd /app/media && sha256sum fixture-public.png fixture-private.png'
    $before = Invoke-ProbeDocker compose @source exec -T api sh -ec $hashCommand
    Invoke-ProbeDocker compose @source exec -T db pg_dump -U arti -d arti -Fc -f /tmp/preflight.dump | Out-Null
    Invoke-ProbeDocker compose @source exec -T api tar -C /app/media -cf /tmp/preflight-media.tar fixture-public.png fixture-private.png | Out-Null
    Invoke-ProbeDocker compose @source cp db:/tmp/preflight.dump "$scratch/arti.dump" | Out-Null
    Invoke-ProbeDocker compose @source cp api:/tmp/preflight-media.tar "$scratch/media.tar" | Out-Null
    $report.stages[$stage] = @{
        databaseSha256 = (Get-FileHash -LiteralPath "$scratch/arti.dump").Hash
        mediaSha256 = (Get-FileHash -LiteralPath "$scratch/media.tar").Hash
    }
    Invoke-ProbeDocker compose @source down --volumes | Out-Null
    $pendingSource = $null

    $stage = 'isolated-restore'
    Write-Host '[isolated-restore] Correct the candidate configuration and restore its blank DB and media'
    $recoveryNetwork = New-ProbeNetwork "$trial-recovery"
    $recoveryOverlay = Join-Path $scratch 'compose.recovery.yaml'
    @"
services:
  api:
    networks:
      default:
        ipv4_address: $($recoveryNetwork.firstApi)
networks:
  default:
    external: true
    name: $($recoveryNetwork.name)
"@ | Set-Content -LiteralPath $recoveryOverlay -Encoding utf8
    $restore += @('-f', $recoveryOverlay)
    $pendingCandidate = $restore
    Invoke-ProbeDocker compose @restore up -d --wait --wait-timeout 60 db | Out-Null
    $tables = Invoke-ProbeDocker compose @restore exec -T db psql -U arti -d arti -tAc $tableCountSql
    $restoreSystemId = Invoke-ProbeDocker compose @restore exec -T db psql -U arti -d arti -tAc $systemIdSql
    if ($tables -ne '0' -or $restoreSystemId -ne $candidateSystemId) { throw 'Recovery must start with the same blank candidate cluster.' }
    Invoke-ProbeDocker compose @restore cp "$scratch/arti.dump" db:/tmp/preflight.dump | Out-Null
    Invoke-ProbeDocker compose @restore exec -T db pg_restore -U arti -d arti --exit-on-error --single-transaction --no-owner --no-acl /tmp/preflight.dump | Out-Null
    Invoke-ProbeDocker compose @restore run --rm --pull never --no-deps -T --user 0 -v "${scratch}:/backup:ro" api sh -ec 'test -z "$(ls -A /app/media)" && tar -xf /backup/media.tar -C /app/media fixture-public.png fixture-private.png && chown 10001:10001 /app/media /app/media/fixture-public.png /app/media/fixture-private.png' | Out-Null
    Invoke-ProbeDocker compose @restore up -d --no-build --pull never --wait --wait-timeout 100 web | Out-Null
    $restoreUrl = Get-ProbeWeb $restore
    Test-ProbeStartup $restore $restoreUrl
    $after = Invoke-ProbeDocker compose @restore exec -T api sh -ec $hashCommand
    $counts = Invoke-ProbeDocker compose @restore exec -T db psql -U arti -d arti -tAc 'select (select count(*) from arti_account), (select count(*) from arti_visit), (select count(*) from arti_visitreaction)'
    if (Compare-Object $before $after) { throw 'Restored media did not match the source hashes.' }
    if ($counts -ne '2|1|1') { throw 'Restored account, receipt or reaction count did not match.' }
    $report.stages[$stage] = @{ ready = 200; migrateExit = 0; initialTables = 0; reusedCandidateDatabase = $true; matchingMediaFiles = 2; accounts = 2; receipts = 1; reactions = 1 }

    $stage = 'restored-web-access'
    Write-Host '[restored-web-access] Verify direct SPA entry, receipt ownership and media access'
    $root = Invoke-ProbeHttp $restoreUrl '/' 200
    $direct = Invoke-ProbeHttp $restoreUrl "/receipt/$($original.id)" 200
    $asset = [regex]::Match($root.Content, '<script[^>]*src="(?<url>/assets/[^"?]+\.js)"').Groups['url'].Value
    if (!$asset -or $root.Content -cne $direct.Content) { throw 'Direct receipt entry did not return the expected SPA.' }
    Invoke-ProbeHttp $restoreUrl $asset 200 | Out-Null
    $owner = Convert-ProbeJson (Invoke-ProbeHttp $restoreUrl '/api/auth/login' 200 @{} $ownerLogin)
    $memberHeaders = @{ Authorization = "Bearer $($owner.token)" }
    $other = Convert-ProbeJson (Invoke-ProbeHttp $restoreUrl '/api/auth/signup' 200 @{} @{ email = 'preflight-other@example.test'; password = $password; termsAccepted = $true; termsVersion = '2026-11-14-draft.1' })
    $admin = Convert-ProbeJson (Invoke-ProbeHttp $restoreUrl '/api/admin/login' 200 @{} @{ id = 'demo-admin'; password = $password })
    $adminHeaders = @{ 'X-Admin-Token' = $admin.token }
    $memberPath = "/api/users/$($owner.user.id)/visits"
    $adminPath = "/api/admin/members/$($owner.user.id)/visits"
    foreach ($list in @((Convert-ProbeJson (Invoke-ProbeHttp $restoreUrl $memberPath 200 $memberHeaders)), (Convert-ProbeJson (Invoke-ProbeHttp $restoreUrl $adminPath 200 $adminHeaders)))) {
        if ($list.Count -ne 1 -or $list[0].id -ne $original.id) { throw 'The restored receipt was missing or duplicated.' }
    }
    $ownerDetail = Invoke-ProbeHttp $restoreUrl $path 200 $memberHeaders
    $adminDetail = Invoke-ProbeHttp $restoreUrl "/api/admin/visits/$($original.id)" 200 $adminHeaders
    $ownerRecord = Convert-ProbeJson $ownerDetail
    if ($ownerDetail.Content -cne $sourceReceipt.Content -or $ownerDetail.Content -cne $adminDetail.Content -or
        $ownerRecord.visitId -ne $original.visitId -or ($ownerRecord.viewedArtworkIds -join ',') -ne ($order -join ',')) {
        throw 'Restored receipt details did not match the original visit.'
    }
    Invoke-ProbeHttp $restoreUrl $path 403 @{ Authorization = "Bearer $($other.token)" } | Out-Null
    Invoke-ProbeHttp $restoreUrl $path 401 | Out-Null
    Invoke-ProbeHttp $restoreUrl "/api/admin/visits/$($original.id)" 401 @{ 'X-Admin-Token' = $owner.token } | Out-Null
    Invoke-ProbeHttp $restoreUrl '/api/uploads/fixture-public.png' 200 | Out-Null
    Invoke-ProbeHttp $restoreUrl '/api/uploads/fixture-private.png' 404 $memberHeaders | Out-Null
    Invoke-ProbeHttp $restoreUrl '/api/admin/uploads/fixture-private.png' 200 $adminHeaders | Out-Null
    $report.stages[$stage] = @{ spa = 200; asset = 200; sameReceipt = $true; owner = 200; admin = 200; other = 403; guest = 401; memberAsAdmin = 401; media = @(200, 404, 200) }

    $stage = 'nginx-api-recovery'
    Write-Host '[nginx-api-recovery] Recreate the upstream at a second IP while keeping Nginx running'
    $proxy = Invoke-ProbeDocker compose @restore ps -q web
    $proxyFormat = '{{.Id}} {{.State.StartedAt}}'
    $proxyBefore = Invoke-ProbeDocker inspect --format $proxyFormat $proxy
    $apiBefore = Invoke-ProbeDocker compose @restore ps -q api
    $ipFormat = '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
    $oldIp = Invoke-ProbeDocker inspect --format $ipFormat $apiBefore
    if ($oldIp -ne $recoveryNetwork.firstApi) { throw 'The old API did not use its reserved address.' }
    Invoke-ProbeHttp $restoreUrl '/api/ready?check=dns' 200 | Out-Null
    $memberQuery = '/api/admin/members?q=' + [uri]::EscapeDataString($ownerLogin.email)
    $queryBefore = Invoke-ProbeHttp $restoreUrl $memberQuery 200 $adminHeaders
    $queryMembers = Convert-ProbeJson $queryBefore
    if ($queryMembers.Count -ne 1 -or $queryMembers[0].id -ne $owner.user.id) {
        throw 'The proxied admin request did not apply its query filter.'
    }

    Invoke-ProbeDocker compose @restore stop api | Out-Null
    Wait-ProbeNginxReadyStatus $restoreUrl 502 | Out-Null
    $spaPath = "/receipt/$($original.id)"
    $spaDuring = Invoke-ProbeHttp $restoreUrl $spaPath 200
    if ($spaDuring.Content -cne $direct.Content) { throw 'The static receipt route changed during API outage.' }

    $movedOverlay = Join-Path $scratch 'compose.api-moved.yaml'
    @"
services:
  api:
    networks:
      default:
        ipv4_address: $($recoveryNetwork.nextApi)
"@ | Set-Content -LiteralPath $movedOverlay -Encoding utf8
    $moved = $restore + @('-f', $movedOverlay)
    $pendingCandidate = $moved
    Invoke-ProbeDocker compose @moved up -d --no-deps --no-build --pull never --force-recreate --wait --wait-timeout 100 api | Out-Null
    $apiAfter = Invoke-ProbeDocker compose @moved ps -q api
    $newIp = Invoke-ProbeDocker inspect --format $ipFormat $apiAfter
    if ($apiAfter -eq $apiBefore -or $newIp -eq $oldIp -or $newIp -ne $recoveryNetwork.nextApi) {
        throw 'The replacement API did not take the second address.'
    }
    $ready = Convert-ProbeJson (Wait-ProbeNginxReadyStatus $restoreUrl 200)
    $proxy = Invoke-ProbeDocker compose @moved ps -q web
    $proxyAfter = Invoke-ProbeDocker inspect --format $proxyFormat $proxy
    if ($ready.database -ne 'postgresql' -or $proxyAfter -ne $proxyBefore -or (Get-ProbeWeb $moved) -ne $restoreUrl) {
        throw 'The same Nginx service did not reconnect to the replacement API.'
    }
    $spaAfter = Invoke-ProbeHttp $restoreUrl $spaPath 200
    $queryAfter = Invoke-ProbeHttp $restoreUrl $memberQuery 200 $adminHeaders
    $ownerAfter = Invoke-ProbeHttp $restoreUrl $path 200 $memberHeaders
    $adminAfter = Invoke-ProbeHttp $restoreUrl "/api/admin/visits/$($original.id)" 200 $adminHeaders
    if ($spaAfter.Content -cne $direct.Content -or $queryAfter.Content -cne $queryBefore.Content -or
        $ownerAfter.Content -cne $ownerDetail.Content -or $adminAfter.Content -cne $adminDetail.Content) {
        throw 'The static route, query filter or restored receipt changed after API replacement.'
    }
    $report.stages[$stage] = @{ ready = @(200, 502, 200); oldApi = $oldIp; newApi = $newIp; sameNginx = $true; spa = @(200, 200); sameAdminQuery = $true; sameReceipt = $true }
    Invoke-ProbeDocker compose @moved down --volumes | Out-Null
    $pendingCandidate = $null
    Invoke-ProbeDocker network rm $recoveryNetwork.id | Out-Null
    $recoveryNetwork = $null

    $stage = 'https-callback-logs'
    Write-Host '[https-callback-logs] Run the signed mock Kakao Chrome and outage checks'
    & "$repo/frontend/tests/runKakaoNginx.browser.ps1" -ApiImage $apiImage -WebImage $webImage -HttpsPort $HttpsPort -UseImageContents | Out-Null
    $report.stages[$stage] = @{ browser = 'Chrome'; normalCallback = 302; outageCallback = 502; privateValuesOmitted = $true; ordinaryFailureLogged = $true }
    $report.status = 'passed'
} catch {
    $failure = $stage
    if (!$report.failedLine) { $report.failedLine = $_.InvocationInfo.ScriptLineNumber }
} finally {
    $report.cleanup = 'passed'
    foreach ($project in @($pendingCandidate, $pendingSource)) {
        if ($project) {
            try { Invoke-ProbeDocker compose @project down --volumes | Out-Null } catch { $report.cleanup = 'failed' }
        }
    }
    foreach ($network in @($faultNetwork, $recoveryNetwork)) {
        if ($network) {
            try { Invoke-ProbeDocker network rm $network.id | Out-Null } catch { $report.cleanup = 'failed' }
        }
    }
    if ($builtImages.Count) {
        try { Invoke-ProbeDocker image rm @builtImages | Out-Null } catch { $report.cleanup = 'failed' }
    }
    try {
        $resolved = (Resolve-Path -LiteralPath $scratch).Path
        if ($resolved -ne (Join-Path (Resolve-Path -LiteralPath $reportDir).Path 'scratch')) { throw 'Unexpected scratch path.' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    } catch {
        $report.cleanup = 'failed'
    }
    if ($report.cleanup -eq 'failed' -and !$failure) { $failure = 'cleanup' }
    if ($failure) { $report.status = 'failed'; $report.failedStage = $failure }
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding utf8
    Pop-Location
}
if ($failure) { throw "Preflight failed at $failure. See $reportPath." }
Write-Output "PASS $reportPath"
