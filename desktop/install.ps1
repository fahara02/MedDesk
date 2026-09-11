param([switch]$CheckPackage)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security
$Required = @('node.exe','read-band-vitals.ps1','bridge-tray.ps1','server\bridge-daemon.js','server\bridge-queue.js','server\package.json')
foreach ($Name in $Required) { if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $Name))) { throw "Installer is incomplete: $Name" } }
if ($CheckPackage) { Write-Output 'PASS: desktop installer contains the runtime and collector.'; exit }
$Directory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'MedDeskBridge'
$Form = New-Object Windows.Forms.Form
$Form.Text = 'MedDesk Bridge setup'
$Form.Size = New-Object Drawing.Size(590,560)
$Form.StartPosition = 'CenterScreen'
$Form.FormBorderStyle = 'FixedDialog'
$Form.MaximizeBox = $false
$Form.Font = New-Object Drawing.Font('Segoe UI',10)
$Intro = New-Object Windows.Forms.Label
$Intro.Text = 'Connect this Windows PC to your MedDesk dashboard. Pair the Mi Band 5 in Windows first. The band key stays encrypted on this PC.'
$Intro.SetBounds(24,20,530,65)
$Form.Controls.Add($Intro)
$Fields = @{}
$Labels = @('Server address','Enrollment code','Bluetooth address','Band authentication key')
for ($Index=0; $Index -lt $Labels.Count; $Index++) {
    $Label = New-Object Windows.Forms.Label
    $Label.Text = $Labels[$Index]
    $Label.SetBounds(24,92+$Index*66,520,22)
    $Input = New-Object Windows.Forms.TextBox
    $Input.SetBounds(24,116+$Index*66,520,28)
    if ($Index -in @(1,3)) { $Input.UseSystemPasswordChar = $true }
    $Form.Controls.Add($Label); $Form.Controls.Add($Input)
    $Fields[$Labels[$Index]] = $Input
}
$Fields['Server address'].Text = 'https://medesk.lifeplusbd.tech'
$Notice = New-Object Windows.Forms.Label
$Notice.Text = 'Create an enrollment code in the website: Vitals > Desktop Bluetooth bridge. Windows must remain signed in and awake for Bluetooth collection.'
$Notice.SetBounds(24,366,520,55)
$Form.Controls.Add($Notice)
$Install = New-Object Windows.Forms.Button
$Install.Text = 'Install and connect'
$Install.SetBounds(24,433,240,40)
$Form.Controls.Add($Install)
$Result = New-Object Windows.Forms.Label
$Result.SetBounds(24,480,520,30)
$Form.Controls.Add($Result)
$Install.add_Click({
    $Install.Enabled = $false
    try {
        $Server = $Fields['Server address'].Text.Trim().TrimEnd('/')
        $Code = $Fields['Enrollment code'].Text.Trim()
        $Address = $Fields['Bluetooth address'].Text.Trim() -replace '[:-]',''
        $Key = $Fields['Band authentication key'].Text.Trim() -replace '^0[xX]',''
        if ($Server -notmatch '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$') { throw 'Enter an HTTPS server address without a path.' }
        if ($Code -notmatch '^[a-f0-9]{32}$') { throw 'Enter the one-use enrollment code from the dashboard.' }
        if ($Address -notmatch '^[a-fA-F0-9]{12}$' -or $Key -notmatch '^[a-fA-F0-9]{32}$') { throw 'Enter a valid Bluetooth address and 16-byte hexadecimal band key.' }
        $Existing = $null
        try { $Existing = [Threading.Mutex]::OpenExisting('Local\MedDeskDesktopBridge') } catch [Threading.WaitHandleCannotBeOpenedException] {}
        if ($Existing) { $Existing.Dispose(); throw 'Exit MedDesk Bridge from its tray icon before installing an update.' }
        $Result.Text = 'Installing...'; $Form.Refresh()
        $null = New-Item -ItemType Directory -Path $Directory -Force
        $Identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $Acl = New-Object Security.AccessControl.DirectorySecurity
        $Acl.SetOwner($Identity); $Acl.SetAccessRuleProtection($true,$false)
        foreach ($Sid in @($Identity,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
            $Rule = New-Object Security.AccessControl.FileSystemAccessRule($Sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
            $Acl.AddAccessRule($Rule)
        }
        Set-Acl -LiteralPath $Directory -AclObject $Acl
        $AppDirectory = Join-Path $Directory 'app'
        $null = New-Item -ItemType Directory -Path $AppDirectory -Force
        foreach ($Item in Get-ChildItem -LiteralPath $PSScriptRoot) { Copy-Item -LiteralPath $Item.FullName -Destination $AppDirectory -Recurse -Force }
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $Enrollment = Invoke-RestMethod -Uri ($Server + '/api/bridge/enroll') -Method Post -ContentType 'application/json' -Body (@{code=$Code} | ConvertTo-Json -Compress) -TimeoutSec 15 -MaximumRedirection 0
        if ($Enrollment.token -notmatch '^[a-zA-Z0-9_-]{43}$' -or $Enrollment.id -notmatch '^[a-f0-9-]{36}$') { throw 'The server returned an invalid enrollment.' }
        $Config = @{server=$Server;token=$Enrollment.token;id=$Enrollment.id;address=$Address;key=$Key}
        $Bytes = [Text.Encoding]::UTF8.GetBytes(($Config | ConvertTo-Json -Compress))
        try { $Protected = [Security.Cryptography.ProtectedData]::Protect($Bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser) } finally { [Array]::Clear($Bytes,0,$Bytes.Length) }
        [IO.File]::WriteAllBytes((Join-Path $Directory 'credentials.bin'),$Protected)
        $Shell = New-Object -ComObject WScript.Shell
        foreach ($Folder in @([Environment]::GetFolderPath('Startup'),[Environment]::GetFolderPath('Programs'))) {
            $Shortcut = $Shell.CreateShortcut((Join-Path $Folder 'MedDesk Bridge.lnk'))
            $Shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
            $Shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File "' + (Join-Path $AppDirectory 'bridge-tray.ps1') + '"'
            $Shortcut.WorkingDirectory = $AppDirectory; $Shortcut.WindowStyle = 7; $Shortcut.Save()
        }
        Start-Process -FilePath $Shortcut.TargetPath -ArgumentList $Shortcut.Arguments -WindowStyle Hidden
        $Form.Close()
    } catch {
        $Result.Text = 'Setup did not complete.'
        $Message = if ($_.Exception -is [Net.WebException]) { 'Enrollment failed. Check the website address and use a fresh code.' } else { $_.Exception.Message }
        [Windows.Forms.MessageBox]::Show($Message,'MedDesk Bridge setup') | Out-Null
    } finally { $Install.Enabled = $true }
})
$null = $Form.ShowDialog()
$Form.Dispose()
