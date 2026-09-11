param([switch]$NoStart)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security
$Directory = Split-Path -Parent $PSScriptRoot
$Created = $false
$Mutex = New-Object Threading.Mutex($true, 'Local\MedDeskDesktopBridge', [ref]$Created)
if (-not $Created) { $Mutex.Dispose(); exit }
$Tray = New-Object Windows.Forms.NotifyIcon
$Tray.Icon = [Drawing.SystemIcons]::Information
$Tray.Text = 'MedDesk Bluetooth Bridge'
$Tray.Visible = $true
$Menu = New-Object Windows.Forms.ContextMenuStrip
$Open = $Menu.Items.Add('Open dashboard')
$Status = $Menu.Items.Add('Show connection status')
$Start = $Menu.Items.Add('Start bridge')
$Pause = $Menu.Items.Add('Stop bridge')
$null = $Menu.Items.Add('-')
$Exit = $Menu.Items.Add('Exit')
$Tray.ContextMenuStrip = $Menu
$script:Child = $null
$script:WantRunning = -not $NoStart
$script:Origin = 'https://medesk.lifeplusbd.tech'
function Stop-Bridge {
    [IO.File]::WriteAllText((Join-Path $Directory 'stop'),'stop')
    if ($script:Child -and -not $script:Child.HasExited) { $null = $script:Child.WaitForExit(25000) }
}
function Start-Bridge {
    if ($script:Child -and -not $script:Child.HasExited) { return }
    $Protected = [IO.File]::ReadAllBytes((Join-Path $Directory 'credentials.bin'))
    $Plain = [Security.Cryptography.ProtectedData]::Unprotect($Protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { $Config = [Text.Encoding]::UTF8.GetString($Plain) | ConvertFrom-Json } finally { [Array]::Clear($Plain,0,$Plain.Length) }
    $script:Origin = $Config.server
    $Info = New-Object Diagnostics.ProcessStartInfo
    $Info.FileName = Join-Path $PSScriptRoot 'node.exe'
    $Info.Arguments = '"' + (Join-Path $PSScriptRoot 'server\bridge-daemon.js') + '"'
    $Info.WorkingDirectory = $PSScriptRoot
    $Info.UseShellExecute = $false
    $Info.CreateNoWindow = $true
    $Info.EnvironmentVariables['MEDDESK_BRIDGE_DIR'] = $Directory
    $Info.EnvironmentVariables['MEDDESK_BRIDGE_ORIGIN'] = $Config.server
    $Info.EnvironmentVariables['MEDDESK_BRIDGE_TOKEN'] = $Config.token
    $Info.EnvironmentVariables['MEDDESK_BRIDGE_ID'] = $Config.id
    $Info.EnvironmentVariables['BLUETOOTH_ADDRESS'] = $Config.address
    $Info.EnvironmentVariables['BAND_AUTH_KEY'] = $Config.key
    $script:Child = [Diagnostics.Process]::Start($Info)
    $Config = $null
}
$Open.add_Click({ Start-Process ($script:Origin + '/#vitals') })
$Status.add_Click({
    try {
        $State = Get-Content -LiteralPath (Join-Path $Directory 'status.json') -Raw | ConvertFrom-Json
        $Running = $script:Child -and -not $script:Child.HasExited
        $Text = "Process running: $Running`nBluetooth: $($State.message)`nUpload: $($State.uploadMessage)`nQueued readings: $($State.queued)`nLast server contact: $($State.lastUploadAt)"
    } catch { $Text = 'The bridge has not reported status yet. Check enrollment, Windows Bluetooth and the band key.' }
    [Windows.Forms.MessageBox]::Show($Text,'MedDesk Bridge') | Out-Null
})
$Start.add_Click({ $script:WantRunning = $true; try { Start-Bridge } catch { [Windows.Forms.MessageBox]::Show('The bridge could not start. Run setup to check enrollment.','MedDesk Bridge') | Out-Null } })
$Pause.add_Click({ $script:WantRunning = $false; Stop-Bridge })
$Exit.add_Click({ [Windows.Forms.Application]::Exit() })
$Tray.add_DoubleClick({ Start-Process ($script:Origin + '/#vitals') })
$Timer = New-Object Windows.Forms.Timer
$Timer.Interval = 15000
$Timer.add_Tick({
    if ($script:WantRunning -and $script:Child -and $script:Child.HasExited) {
        try {
            $State = Get-Content -LiteralPath (Join-Path $Directory 'status.json') -Raw | ConvertFrom-Json
            if ($State.revoked) { $script:WantRunning = $false; return }
        } catch {}
        try { Start-Bridge } catch {}
    }
})
$Timer.Start()
try {
    if (-not $NoStart) { Start-Bridge }
    [Windows.Forms.Application]::Run()
} finally {
    Stop-Bridge
    $Timer.Stop(); $Timer.Dispose()
    $Tray.Visible = $false
    $Tray.Dispose()
    $Mutex.ReleaseMutex()
    $Mutex.Dispose()
}
