$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $ProjectRoot "huami-token\.venv\Scripts\python.exe"
$Script = Join-Path $ProjectRoot "scripts\get_band_key.py"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "The huami-token environment is missing. See PAIRING.md for setup instructions."
}

& $Python $Script
exit $LASTEXITCODE
