$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Directory = Join-Path $Root 'runtime\speech-source'
$Source = Join-Path $Directory 'espeak-ng-1.52.0'
$Archive = Join-Path $Directory 'espeak-ng-1.52.0.zip'
$ExpectedHash = 'b4517592e3cbc43703bb1c782702eafb98097659e0b7e96e69c32ee32ae5003a'
foreach ($Tool in @('cmake','ninja','gcc','git')) { $null = Get-Command $Tool -ErrorAction Stop }
$null = New-Item -ItemType Directory -Path $Directory -Force
if (-not (Test-Path -LiteralPath $Archive)) {
    Invoke-WebRequest -Uri 'https://codeload.github.com/espeak-ng/espeak-ng/zip/refs/tags/1.52.0' -OutFile $Archive -TimeoutSec 90
}
$Hasher = [Security.Cryptography.SHA256]::Create()
$Stream = [IO.File]::OpenRead($Archive)
try { $Hash = [BitConverter]::ToString($Hasher.ComputeHash($Stream)).Replace('-','').ToLowerInvariant() } finally { $Stream.Dispose(); $Hasher.Dispose() }
if ($Hash -ne $ExpectedHash) { throw 'Speech source hash does not match the pinned 1.52.0 archive.' }
if (-not (Test-Path -LiteralPath $Source)) { Expand-Archive -LiteralPath $Archive -DestinationPath $Directory }
$Build = Join-Path $Directory 'build'
& cmake -S $Source -B $Build -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF -DUSE_ASYNC=OFF -DUSE_LIBPCAUDIO=OFF -DUSE_LIBSONIC=OFF -DUSE_MBROLA=OFF -DESPEAK_BUILD_MANPAGES=OFF
if ($LASTEXITCODE -ne 0) { throw 'Speech source configuration failed.' }
& cmake --build $Build --parallel 2
if ($LASTEXITCODE -ne 0) { throw 'Speech source build failed.' }
& (Join-Path $Build 'src\espeak-ng.exe') ('--path='+$Build) --voices=bn
if ($LASTEXITCODE -ne 0) { throw 'Bengali voice verification failed.' }
Write-Output 'Offline speech is available to the next MedDesk server process. No Windows installer or system registration was used.'
