$ErrorActionPreference = 'Stop'
$Directory = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'MedDeskBridge'))
if ([IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)) -ne $Directory) { throw 'Run the installed uninstaller from MedDeskBridge\app.' }
[IO.File]::WriteAllText((Join-Path $Directory 'stop'),'stop')
foreach ($Folder in @([Environment]::GetFolderPath('Startup'),[Environment]::GetFolderPath('Programs'))) {
    $Shortcut = Join-Path $Folder 'MedDesk Bridge.lnk'
    if (Test-Path -LiteralPath $Shortcut) { Remove-Item -LiteralPath $Shortcut }
}
$Credentials = Join-Path $Directory 'credentials.bin'
if (Test-Path -LiteralPath $Credentials) { Remove-Item -LiteralPath $Credentials }
Write-Output 'Autostart and local credentials removed. Revoke this computer in the dashboard. Exit the tray app. Offline readings remain in LocalAppData\MedDeskBridge for recovery.'
