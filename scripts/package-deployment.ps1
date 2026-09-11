$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Stage = Join-Path $Root ('tmp\deploy-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $Stage -Force
foreach ($Name in @('package.json','package-lock.json','.dockerignore')) { Copy-Item -LiteralPath (Join-Path $Root $Name) -Destination $Stage }
foreach ($Name in @('apps\server\src','apps\web\src','apps\web\public')) {
    $Source = Join-Path $Root $Name
    if (Test-Path -LiteralPath $Source) { $Target = Join-Path $Stage (Split-Path -Parent $Name); $null = New-Item -ItemType Directory -Path $Target -Force; Copy-Item -LiteralPath $Source -Destination $Target -Recurse }
}
foreach ($Workspace in @('server','web')) {
    foreach ($File in Get-ChildItem -LiteralPath (Join-Path $Root "apps\$Workspace") -File) {
        if ($File.Name -match '^(package\.json|tsconfig.*\.json|vite\.config\.ts|index\.html)$') { Copy-Item -LiteralPath $File.FullName -Destination (Join-Path $Stage "apps\$Workspace") }
    }
}
$null = New-Item -ItemType Directory -Path (Join-Path $Stage 'deploy'),(Join-Path $Stage 'releases') -Force
foreach ($Name in @('Dockerfile','compose.yml','compose.nginx.yml','Caddyfile','nginx.conf','nginx-http.conf','README.md')) { Copy-Item -LiteralPath (Join-Path $Root "deploy\$Name") -Destination (Join-Path $Stage 'deploy') }
foreach ($Name in @('MedDesk-Bridge-Setup.exe','MedDesk-Bridge-Setup.exe.sha256')) { Copy-Item -LiteralPath (Join-Path $Root "releases\$Name") -Destination (Join-Path $Stage 'releases') }
$Archive = Join-Path $Root 'releases\meddesk-server.tar.gz'
& tar.exe -czf $Archive -C $Stage .
if ($LASTEXITCODE -ne 0) { throw 'Deployment archive failed.' }
Write-Output ('Prepared source and installer without local credentials or patient data: ' + $Archive)
