param([switch]$CheckConfiguration)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script = Join-Path $ProjectRoot "scripts\get_band_key.py"
$Values = @{}
$EnvFile = Join-Path $ProjectRoot ".env"

if (Test-Path -LiteralPath $EnvFile) {
    foreach ($Line in [IO.File]::ReadAllLines($EnvFile)) {
        if ($Line -match '^\s*(EMAIL|XIAOMI_PASSWORD|ACCOUNT_METHOD)\s*=(.*)$') {
            $Name = $Matches[1]
            $Value = $Matches[2].Trim()
            if ($Value.Length -ge 2 -and (
                ($Value[0] -eq '"' -and $Value[$Value.Length - 1] -eq '"') -or
                ($Value[0] -eq "'" -and $Value[$Value.Length - 1] -eq "'"))) {
                $Value = $Value.Substring(1, $Value.Length - 2)
            }
            $Values[$Name] = $Value
        }
    }
}

foreach ($Name in @('EMAIL', 'XIAOMI_PASSWORD', 'ACCOUNT_METHOD')) {
    $Override = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ($null -ne $Override) { $Values[$Name] = $Override }
}
if ($Values['ACCOUNT_METHOD'] -and $Values['ACCOUNT_METHOD'] -ne 'xiaomi') {
    throw "This wrapper uses the Xiaomi account. Set ACCOUNT_METHOD=xiaomi."
}
foreach ($Name in @('EMAIL', 'XIAOMI_PASSWORD')) {
    if ([string]::IsNullOrWhiteSpace($Values[$Name])) {
        throw "$Name is required. PASSWORD is reserved for Gmail and is never used here."
    }
}

$StartInfo = New-Object Diagnostics.ProcessStartInfo
$StartInfo.FileName = (Get-Command uv -ErrorAction Stop).Source
$StartInfo.Arguments = 'run --no-sync --project huami-token python "' + $Script + '"'
$StartInfo.WorkingDirectory = $ProjectRoot
$StartInfo.UseShellExecute = $false
$StartInfo.CreateNoWindow = $true
$StartInfo.EnvironmentVariables['EMAIL'] = $Values['EMAIL']
$StartInfo.EnvironmentVariables['ACCOUNT_METHOD'] = 'xiaomi'
# The existing extractor expects PASSWORD. Map only the Xiaomi secret in its child.
$StartInfo.EnvironmentVariables['PASSWORD'] = $Values['XIAOMI_PASSWORD']

if ($CheckConfiguration) {
    Write-Output 'Configuration OK: Xiaomi login uses XIAOMI_PASSWORD; Gmail PASSWORD is unused.'
    return
}

$Extractor = [Diagnostics.Process]::Start($StartInfo)
try {
    $Extractor.WaitForExit()
    $Result = $Extractor.ExitCode
} finally {
    $Extractor.Dispose()
}
exit $Result
