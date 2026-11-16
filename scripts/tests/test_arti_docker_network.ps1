#Requires -Version 7.3
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
. (Join-Path $PSScriptRoot '../artiTestNetwork.ps1')

$calls = [System.Collections.Generic.List[string[]]]::new()
$responses = [System.Collections.Generic.Queue[hashtable]]::new()

function docker {
    $calls.Add([string[]]$args)
    if (!$responses.Count) { throw 'Unexpected Docker call.' }
    $response = $responses.Dequeue()
    $global:LASTEXITCODE = $response.exitCode
    $response.output
}

function Add-DockerResponse($ExitCode, $Output) {
    $responses.Enqueue(@{ exitCode = $ExitCode; output = $Output })
}

function Assert-NetworkTest($Condition, $Message) {
    if (!$Condition) { throw $Message }
}

function Assert-Throws([scriptblock]$Action, [string]$Message) {
    $caught = $null
    try { & $Action } catch { $caught = $_.Exception.Message }
    Assert-NetworkTest ($caught -like "*$Message*") "Expected '$Message', got '$caught'."
}

Add-DockerResponse 0 'default-id'
$network = New-ArtiTestNetwork 'test-default'
Assert-NetworkTest ($network.allocation -eq 'default' -and $calls.Count -eq 1 -and '--subnet' -notin $calls[0]) 'Default allocation must succeed without an explicit subnet.'
Assert-NetworkTest ('com.arti.test-network=test-default' -in $calls[0]) 'The test network must carry its ownership label.'

Add-DockerResponse 0 'test-default'
Add-DockerResponse 0 'default-id'
Remove-ArtiTestNetwork $network
Assert-NetworkTest (($calls[2] -join ' ') -eq 'network rm default-id') 'Owned network cleanup must use the returned ID.'

$calls.Clear()
Add-DockerResponse 1 'Error response from daemon: all predefined address pools have been fully subnetted'
Add-DockerResponse 1 'Pool overlaps with other one on this address space'
Add-DockerResponse 0 'explicit-id'
$network = New-ArtiTestNetwork 'test-fallback'
Assert-NetworkTest ($network.allocation -eq 'explicit' -and $calls.Count -eq 3 -and '--subnet' -notin $calls[0] -and '--subnet' -in $calls[1] -and '--subnet' -in $calls[2]) 'Pool exhaustion must reserve an explicit subnet and retry an overlap.'
Assert-NetworkTest ('--ip-range' -in $calls[2] -and $network.firstApi -ne $network.nextApi) 'Explicit networks must keep two distinct API addresses outside the dynamic range.'

$calls.Clear()
Add-DockerResponse 1 'Error response from daemon: permission denied'
Assert-Throws { New-ArtiTestNetwork 'test-denied' } 'Could not create test network'
Assert-NetworkTest ($calls.Count -eq 1) 'Other Docker failures must never trigger a fallback.'

$calls.Clear()
for ($attempt = 0; $attempt -lt 8; $attempt++) {
    Add-DockerResponse 1 'Pool overlaps with other one on this address space'
}
Assert-Throws { New-ArtiTestNetwork 'test-overlap' -Internal -ExplicitSubnet } 'No unused subnet found'
Assert-NetworkTest ($calls.Count -eq 8 -and '--internal' -in $calls[0] -and '--subnet' -in $calls[0]) 'An explicitly reserved internal network must stop after eight conflicts.'

$calls.Clear()
Add-DockerResponse 0 'different-run'
Assert-Throws { Remove-ArtiTestNetwork $network } 'Could not confirm ownership'
Assert-NetworkTest ($calls.Count -eq 1 -and $calls[0][1] -eq 'inspect' -and !$responses.Count) 'Foreign network IDs must not be removed.'

'PASS Docker default, exhausted pool fallback, bounded overlap retry, and ownership guard'
