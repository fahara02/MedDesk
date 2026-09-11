param(
    [switch]$CheckConfiguration,
    [ValidateSet('amazfit', 'zepp', 'xiaomi')][string]$AccountMethod
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script = Join-Path $ProjectRoot "scripts\get_band_key.py"
$Values = @{}
$EnvFile = Join-Path $ProjectRoot ".env"

if (Test-Path -LiteralPath $EnvFile) {
    foreach ($Line in [IO.File]::ReadAllLines($EnvFile)) {
        if ($Line -match '^\s*(EMAIL|ZEPP_PASSWORD|XIAOMI_PASSWORD|ACCOUNT_METHOD)\s*=(.*)$') {
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

foreach ($Name in @('EMAIL', 'ZEPP_PASSWORD', 'XIAOMI_PASSWORD', 'ACCOUNT_METHOD')) {
    $Override = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ($null -ne $Override) { $Values[$Name] = $Override }
}
if (-not $AccountMethod) { $AccountMethod = $Values['ACCOUNT_METHOD'] }
if (-not $AccountMethod) {
    $AccountMethod = if ($Values['ZEPP_PASSWORD']) { 'amazfit' } else { 'xiaomi' }
}
if ($AccountMethod -eq 'zepp') { $AccountMethod = 'amazfit' }
if ($AccountMethod -notin @('amazfit', 'xiaomi')) {
    throw 'ACCOUNT_METHOD must be amazfit (Zepp) or xiaomi.'
}
$PasswordName = if ($AccountMethod -eq 'amazfit') { 'ZEPP_PASSWORD' } else { 'XIAOMI_PASSWORD' }
foreach ($Name in @('EMAIL', $PasswordName)) {
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
$StartInfo.RedirectStandardOutput = $true
$StartInfo.RedirectStandardError = $true
$StartInfo.EnvironmentVariables['EMAIL'] = $Values['EMAIL']
$StartInfo.EnvironmentVariables['ACCOUNT_METHOD'] = $AccountMethod
# The extractor expects PASSWORD; map only the selected provider's secret in its child.
$StartInfo.EnvironmentVariables['PASSWORD'] = $Values[$PasswordName]

if ($CheckConfiguration) {
    Write-Output "Configuration OK: $AccountMethod login uses $PasswordName; Gmail PASSWORD is unused."
    return
}

$Extractor = [Diagnostics.Process]::Start($StartInfo)
try {
    $OutputTask = $Extractor.StandardOutput.ReadToEndAsync()
    $ErrorTask = $Extractor.StandardError.ReadToEndAsync()
    $Extractor.WaitForExit()
    [Console]::Out.Write($OutputTask.GetAwaiter().GetResult())
    [Console]::Error.Write($ErrorTask.GetAwaiter().GetResult())
    $Result = $Extractor.ExitCode
} finally {
    $Extractor.Dispose()
}
exit $Result
