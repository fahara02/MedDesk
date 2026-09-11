$ErrorActionPreference = 'Stop'
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$TemporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$TestDirectory = Join-Path $TemporaryRoot ('meddesk-config-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $TestDirectory | Out-Null
$Names = @('EMAIL', 'ACCOUNT_METHOD', 'ZEPP_PASSWORD', 'XIAOMI_PASSWORD', 'PASSWORD')
$Previous = @{}
foreach ($Name in $Names) {
    $Previous[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
    Remove-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue
}
try {
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'get-band-key.ps1') -Destination $TestDirectory
    $TestWrapper = Join-Path $TestDirectory 'get-band-key.ps1'
    $FakeEnvironment = @'
EMAIL=fictional@example.invalid
ACCOUNT_METHOD=xiaomi
XIAOMI_PASSWORD=xiaomi-test-only
ZEPP_PASSWORD='zepp-test-$`"only'
PASSWORD=gmail-test-never-send
'@
    Set-Content -LiteralPath (Join-Path $TestDirectory '.env') -Value $FakeEnvironment
    & {
        . $TestWrapper -AccountMethod amazfit -CheckConfiguration
        if ($StartInfo.EnvironmentVariables['ACCOUNT_METHOD'] -ne 'amazfit' -or
            $StartInfo.EnvironmentVariables['PASSWORD'] -cne 'zepp-test-$`"only' -or
            $StartInfo.Arguments.Contains('zepp-test-') -or
            -not $StartInfo.RedirectStandardOutput -or -not $StartInfo.RedirectStandardError) {
            throw 'Zepp credential or output routing failed.'
        }
    }
    & {
        . $TestWrapper -AccountMethod zepp -CheckConfiguration
        if ($StartInfo.EnvironmentVariables['ACCOUNT_METHOD'] -ne 'amazfit') { throw 'Zepp alias failed.' }
    }
    & {
        . $TestWrapper -AccountMethod xiaomi -CheckConfiguration
        if ($StartInfo.EnvironmentVariables['PASSWORD'] -ne 'xiaomi-test-only') { throw 'Xiaomi routing failed.' }
    }
    Set-Content -LiteralPath (Join-Path $TestDirectory '.env') -Value "EMAIL=fictional@example.invalid`nPASSWORD=gmail-test-never-send`nXIAOMI_PASSWORD=xiaomi-test-only"
    $Refused = $false
    try { & $TestWrapper -AccountMethod amazfit -CheckConfiguration } catch { $Refused = $_.Exception.Message.Contains('ZEPP_PASSWORD is required') }
    if (-not $Refused) { throw 'Missing Zepp password did not refuse.' }
    Write-Output 'PASS: Zepp routing, alias, exact quoting, separate Xiaomi credentials, missing-password refusal, and captured output. No network calls.'
} finally {
    foreach ($Name in $Names) {
        if ($null -eq $Previous[$Name]) { Remove-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue }
        else { [Environment]::SetEnvironmentVariable($Name, $Previous[$Name], 'Process') }
    }
    $ResolvedTestDirectory = (Resolve-Path -LiteralPath $TestDirectory).Path
    if ((Split-Path -Parent $ResolvedTestDirectory) -ne $TemporaryRoot -or (Split-Path -Leaf $ResolvedTestDirectory) -notlike 'meddesk-config-*') { throw 'Unsafe test cleanup path.' }
    Remove-Item -LiteralPath $ResolvedTestDirectory -Recurse -Force
}
