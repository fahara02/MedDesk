$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$BuildRoot = [IO.Path]::GetFullPath((Join-Path $Root 'tmp\bridge-package'))
$Payload = Join-Path $BuildRoot 'payload'
$null = New-Item -ItemType Directory -Path (Join-Path $Payload 'server') -Force
$Modules = @('bridge-daemon','bridge-queue','band-reader','reading','consultations','clinical-model','document-model','document-projection')
foreach ($Module in $Modules) { Copy-Item -LiteralPath (Join-Path $Root "apps\server\dist\$Module.js") -Destination (Join-Path $Payload 'server') -Force }
[IO.File]::WriteAllText((Join-Path $Payload 'server\package.json'),'{"type":"module"}')
Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $Payload 'node.exe') -Force
Copy-Item -LiteralPath (Join-Path $Root 'read-band-vitals.ps1') -Destination $Payload -Force
foreach ($File in @('install.ps1','bridge-tray.ps1','uninstall.ps1')) { Copy-Item -LiteralPath (Join-Path $Root "desktop\$File") -Destination $Payload -Force }
$Archive = Join-Path $BuildRoot 'payload.zip'
Compress-Archive -Path (Join-Path $Payload '*') -DestinationPath $Archive -Force -CompressionLevel Optimal
$Destination = Join-Path $Root 'releases'
$null = New-Item -ItemType Directory -Path $Destination -Force
$Compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$Framework = Split-Path -Parent $Compiler
$Output = Join-Path $Destination 'MedDesk-Bridge-Setup.exe'
& $Compiler /nologo /target:winexe /platform:x64 "/out:$Output" "/resource:$Archive,payload.zip" "/reference:$Framework\System.IO.Compression.dll" "/reference:$Framework\System.IO.Compression.FileSystem.dll" "/reference:$Framework\System.Windows.Forms.dll" (Join-Path $Root 'desktop\Setup.cs')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
$Check = Start-Process -FilePath $Output -ArgumentList '--check-package' -WindowStyle Hidden -PassThru -Wait
if ($Check.ExitCode -ne 0) { throw 'Installer payload verification failed.' }
$Hasher = [Security.Cryptography.SHA256]::Create()
$Stream = [IO.File]::OpenRead($Output)
try { $Hash = [BitConverter]::ToString($Hasher.ComputeHash($Stream)).Replace('-','').ToLowerInvariant() } finally { $Stream.Dispose(); $Hasher.Dispose() }
[IO.File]::WriteAllText(($Output + '.sha256'),($Hash + '  MedDesk-Bridge-Setup.exe' + [Environment]::NewLine))
Write-Output ('Built and verified: ' + $Output)
Write-Output ('SHA256: ' + $Hash)
