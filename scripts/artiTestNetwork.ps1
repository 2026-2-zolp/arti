function New-ArtiTestNetwork {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [switch]$Internal,
        [switch]$ExplicitSubnet
    )

    $create = @('network', 'create', '--driver', 'bridge', '--label', "com.arti.test-network=$Name")
    if ($Internal) { $create += '--internal' }
    if (!$ExplicitSubnet) {
        $id = docker @create $Name 2>&1
        if ($LASTEXITCODE -eq 0) { return @{ id = $id; name = $Name; allocation = 'default' } }
        if (($id -join ' ') -notmatch 'all predefined address pools have been fully subnetted|could not find an available, non-overlapping IPv4 address pool') {
            throw "Could not create test network '$Name' (Docker exit $LASTEXITCODE)."
        }
    }

    for ($attempt = 0; $attempt -lt 8; $attempt++) {
        $prefix = "10.247.$(Get-Random -Maximum 256)"
        $block = (Get-Random -Maximum 16) * 16
        $id = docker @create --subnet "$prefix.$block/28" --ip-range "$prefix.$block/29" $Name 2>&1
        if ($LASTEXITCODE -eq 0) {
            # Keep the upper addresses outside the dynamic range for upstream replacement.
            return @{ id = $id; name = $Name; allocation = 'explicit'; firstApi = "$prefix.$($block + 9)"; nextApi = "$prefix.$($block + 10)" }
        }
        if (($id -join ' ') -notmatch 'pool overlaps') {
            throw "Could not create an explicit subnet for test network '$Name' (Docker exit $LASTEXITCODE)."
        }
    }
    throw "No unused subnet found for test network '$Name'."
}

function Remove-ArtiTestNetwork($Network) {
    $owner = docker network inspect --format '{{index .Labels "com.arti.test-network"}}' $Network.id 2>&1
    if ($LASTEXITCODE -ne 0 -or $owner -cne $Network.name) {
        throw "Could not confirm ownership of test network '$($Network.name)'."
    }
    docker network rm $Network.id 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not remove test network '$($Network.name)'." }
}
