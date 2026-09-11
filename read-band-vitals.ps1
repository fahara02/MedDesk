param([ValidateRange(10,60)][int]$Seconds = 35, [switch]$SaveToServer, [switch]$Continuous, [switch]$ControlStdin)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -gt 5) {
    $ChildArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-Seconds', $Seconds)
    if ($SaveToServer) { $ChildArguments += '-SaveToServer' }
    if ($Continuous) { $ChildArguments += '-Continuous' }
    if ($ControlStdin) { $ChildArguments += '-ControlStdin' }
    & powershell.exe @ChildArguments
    exit $LASTEXITCODE
}
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType=WindowsRuntime]
$null = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattDeviceServicesResult, Windows.Devices.Bluetooth, ContentType=WindowsRuntime]
$null = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicsResult, Windows.Devices.Bluetooth, ContentType=WindowsRuntime]
$null = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattReadResult, Windows.Devices.Bluetooth, ContentType=WindowsRuntime]
$null = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattWriteResult, Windows.Devices.Bluetooth, ContentType=WindowsRuntime]
$null = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristic, Windows.Devices.Bluetooth, ContentType=WindowsRuntime]
$null = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattValueChangedEventArgs, Windows.Devices.Bluetooth, ContentType=WindowsRuntime]
$null = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCommunicationStatus, Windows.Devices.Bluetooth, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IBuffer, Windows.Storage.Streams, ContentType=WindowsRuntime]
Add-Type -TypeDefinition @'
using System.Collections.Concurrent;
public sealed class BandValueQueue {
    public readonly ConcurrentQueue<object> Values = new ConcurrentQueue<object>();
    public void OnChanged<TSender, TArgs>(TSender sender, TArgs args) { Values.Enqueue(args); }
    public static System.Threading.Tasks.Task<string> StopCommand() { return System.Threading.Tasks.Task.Run(() => System.Console.ReadLine()); }
}
'@
$AsTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
$ToArray = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions].GetMethods() | Where-Object { $_.Name -eq 'ToArray' -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
$Cache = [Windows.Devices.Bluetooth.BluetoothCacheMode]::Uncached
$Subscriptions = New-Object Collections.Generic.List[object]
$Services = New-Object Collections.Generic.List[object]
$Band = $null
$Control = $null
$Started = $false
$Authenticated = $false
$HeartCount = 0
$Failure = $false
$BandMutex = $null
$OwnsBandMutex = $false
$StopTask = if ($ControlStdin) { [BandValueQueue]::StopCommand() } else { $null }

function Emit-Status([string]$Phase, [string]$Message) { @{ event='status'; phase=$Phase; message=$Message } | ConvertTo-Json -Compress }
function Await-Band($Operation, [Type]$ResultType) {
    $Task = $AsTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    if (-not $Task.Wait(15000)) { throw 'Bluetooth operation timed out. Keep the band nearby and release the phone connection.' }
    return $Task.Result
}
function Get-Characteristic([string]$ServiceId, [string]$CharacteristicId) {
    $Result = Await-Band ($Band.GetGattServicesForUuidAsync([guid]$ServiceId, $Cache)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattDeviceServicesResult])
    if ($Result.Status.ToString() -ne 'Success' -or @($Result.Services).Count -ne 1) {
        throw ('Band service unavailable: ' + $Result.Status.ToString() + '. Turn off the phone Bluetooth and keep the band nearby.')
    }
    $Service = @($Result.Services)[0]
    $Services.Add($Service)
    $Chars = Await-Band ($Service.GetCharacteristicsForUuidAsync([guid]$CharacteristicId, $Cache)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicsResult])
    if ($Chars.Status.ToString() -ne 'Success' -or @($Chars.Characteristics).Count -ne 1) { throw ('Band characteristic unavailable: ' + $Chars.Status.ToString()) }
    return @($Chars.Characteristics)[0]
}
function Send-Band($Characteristic, [byte[]]$Bytes) {
    $Writer = New-Object Windows.Storage.Streams.DataWriter
    try {
        $Writer.WriteBytes($Bytes)
        $Method = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristic].GetMethods() | Where-Object { $_.Name -eq 'WriteValueWithResultAsync' -and $_.GetParameters().Count -eq 2 } | Select-Object -First 1
        $WriteOption = if (($Characteristic.CharacteristicProperties -band [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicProperties]::WriteWithoutResponse) -ne 0) { [Windows.Devices.Bluetooth.GenericAttributeProfile.GattWriteOption]::WriteWithoutResponse } else { [Windows.Devices.Bluetooth.GenericAttributeProfile.GattWriteOption]::WriteWithResponse }
        $Operation = $Method.Invoke($Characteristic, @($Writer.DetachBuffer(), $WriteOption))
        $Result = Await-Band $Operation ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattWriteResult])
        if ($Result.Status.ToString() -ne 'Success') { throw ('Band command refused: ' + $Result.Status.ToString() + ' (ATT ' + $Result.ProtocolError + ').') }
    } finally { $Writer.Dispose() }
}
function Subscribe-Band($Characteristic) {
    $Sink = New-Object BandValueQueue
    $EventInfo = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristic].GetEvent('ValueChanged')
    $HandlerMethod = [BandValueQueue].GetMethod('OnChanged').MakeGenericMethod($EventInfo.EventHandlerType.GetGenericArguments())
    $Handler = [Delegate]::CreateDelegate($EventInfo.EventHandlerType, $Sink, $HandlerMethod)
    $Token = $EventInfo.GetAddMethod().Invoke($Characteristic, @($Handler))
    $Subscriptions.Add(@{ Characteristic=$Characteristic; EventInfo=$EventInfo; Token=$Token; Handler=$Handler })
    $Result = Await-Band ($Characteristic.WriteClientCharacteristicConfigurationDescriptorAsync([Windows.Devices.Bluetooth.GenericAttributeProfile.GattClientCharacteristicConfigurationDescriptorValue]::Notify)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattCommunicationStatus])
    if ($Result.ToString() -ne 'Success') { throw ('Band notifications refused: ' + $Result.ToString()) }
    return $Sink
}
function Read-Band($Characteristic) {
    $Result = Await-Band ($Characteristic.ReadValueAsync($Cache)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattReadResult])
    if ($Result.Status.ToString() -ne 'Success' -or $null -eq $Result.Value) { throw ('Band read refused: ' + $Result.Status.ToString() + ' (ATT ' + $Result.ProtocolError + ').') }
    return ,$ToArray.Invoke($null, @($Result.Value))
}
function Emit-Reading($Metrics, [string]$ObservedAt) {
    $Reading = @{ source='band'; deviceName=$Band.Name; observedAt=$ObservedAt }
    foreach ($Metric in $Metrics.Keys) { $Reading[$Metric] = $Metrics[$Metric] }
    if ($SaveToServer) { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/readings' -Method Post -ContentType 'application/json' -Body ($Reading | ConvertTo-Json -Compress) -TimeoutSec 5 }
    @{ event='reading'; reading=$Reading } | ConvertTo-Json -Depth 3 -Compress
}
try {
    $Configuration = @{}
    $EnvironmentFile = Join-Path $PSScriptRoot '.env'
    $EnvironmentLines = if (Test-Path -LiteralPath $EnvironmentFile) { [IO.File]::ReadAllLines($EnvironmentFile) } else { @() }
    foreach ($Line in $EnvironmentLines) {
        if ($Line -match '^\s*(BLUETOOTH_ADDRESS|Key|BAND_AUTH_KEY|AUTH_KEY)\s*=(.*)$') {
            $Field = $Matches[1]; $Value = $Matches[2].Trim()
            if ($Value.Length -ge 2 -and (($Value[0] -eq '"' -and $Value[-1] -eq '"') -or ($Value[0] -eq "'" -and $Value[-1] -eq "'"))) { $Value = $Value.Substring(1, $Value.Length - 2) }
            $Configuration[$Field] = $Value
        }
    }
    foreach ($Field in @('BLUETOOTH_ADDRESS','BAND_AUTH_KEY')) {
        $ProcessValue = [Environment]::GetEnvironmentVariable($Field, 'Process')
        if ($ProcessValue) { $Configuration[$Field] = $ProcessValue }
    }
    $Address = $Configuration['BLUETOOTH_ADDRESS'] -replace '[:-]', ''
    $KeyText = @($Configuration['BAND_AUTH_KEY'], $Configuration['AUTH_KEY'], $Configuration['Key'] | Where-Object { $_ }) | Select-Object -First 1
    $KeyText = $KeyText -replace '^0[xX]', ''
    if ($Address -notmatch '^[0-9a-fA-F]{12}$' -or $KeyText -notmatch '^[0-9a-fA-F]{32}$') { throw 'Set BLUETOOTH_ADDRESS and a valid 16-byte Key in the local .env file.' }
    $BandMutex = New-Object Threading.Mutex($false, ('Local\MedDeskBluetooth-' + $Address.ToUpperInvariant()))
    try { $OwnsBandMutex = $BandMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $OwnsBandMutex = $true }
    if (-not $OwnsBandMutex) { throw 'Another MedDesk process is already monitoring this band. Stop it before connecting this bridge.' }
    [byte[]]$KeyBytes = for ($Index=0; $Index -lt 32; $Index+=2) { [Convert]::ToByte($KeyText.Substring($Index,2),16) }
    Emit-Status 'connecting' 'Opening the configured band through Windows Bluetooth.'
    $Band = Await-Band ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromBluetoothAddressAsync([Convert]::ToUInt64($Address,16))) ([Windows.Devices.Bluetooth.BluetoothLEDevice])
    if ($null -eq $Band) { throw 'Windows could not open the band. Keep it nearby with phone Bluetooth off.' }
    $Auth = Get-Characteristic '0000fee1-0000-1000-8000-00805f9b34fb' '00000009-0000-3512-2118-0009af100700'
    $AuthQueue = Subscribe-Band $Auth
    Emit-Status 'authenticating' 'Authenticating with the private local band key.'
    Send-Band $Auth ([byte[]]@(0x02,0x00))
    $AuthDeadline = [DateTime]::UtcNow.AddSeconds(15)
    while (-not $Authenticated -and [DateTime]::UtcNow -lt $AuthDeadline) {
        $Notification = $null
        if (-not $AuthQueue.Values.TryDequeue([ref]$Notification)) { Start-Sleep -Milliseconds 100; continue }
        $Bytes = $ToArray.Invoke($null, @($Notification.CharacteristicValue))
        if ($Bytes.Length -lt 3 -or $Bytes[0] -ne 0x10) { continue }
        if ($Bytes[1] -eq 0x02 -and $Bytes[2] -eq 0x01) {
            if ($Bytes.Length -ne 19) { throw 'The band returned an invalid authentication challenge.' }
            $Aes = [Security.Cryptography.Aes]::Create()
            try {
                $Aes.Mode = [Security.Cryptography.CipherMode]::ECB
                $Aes.Padding = [Security.Cryptography.PaddingMode]::None
                $Aes.Key = $KeyBytes
                $Encryptor = $Aes.CreateEncryptor()
                try { $Encrypted = $Encryptor.TransformFinalBlock([byte[]]$Bytes[3..18],0,16) } finally { $Encryptor.Dispose() }
                Send-Band $Auth ([byte[]](@(0x03,0x00) + $Encrypted))
            } finally { $Aes.Dispose() }
        } elseif ($Bytes[1] -eq 0x03 -and $Bytes[2] -eq 0x01) { $Authenticated = $true }
        elseif ($Bytes[1] -in @(0x02,0x03)) { throw 'The band rejected the authentication key. Verify the current Zepp key for this band.' }
    }
    if (-not $Authenticated) { throw 'Band authentication timed out. Release any phone or browser connection and retry.' }
    Emit-Status 'authenticated' 'Band authentication succeeded. Reading current observations.'
    try {
        $Battery = Get-Characteristic '0000fee0-0000-1000-8000-00805f9b34fb' '00000006-0000-3512-2118-0009af100700'
        $Bytes = Read-Band $Battery
        if ($Bytes.Length -ge 2 -and $Bytes[1] -le 100) { Emit-Reading @{batteryPercent=[int]$Bytes[1]} ([DateTime]::UtcNow.ToString('o')) }
    } catch { Emit-Status 'partial' 'Battery was unavailable in this session.' }
    try {
        $Activity = Get-Characteristic '0000fee0-0000-1000-8000-00805f9b34fb' '00000007-0000-3512-2118-0009af100700'
        $Bytes = Read-Band $Activity
        if ($Bytes.Length -lt 3) { throw 'Invalid activity packet.' }
        $Metrics = @{ steps=[int][BitConverter]::ToUInt16($Bytes,1) }
        if ($Bytes.Length -ge 9) { $Metrics.distanceMeters=[int][BitConverter]::ToUInt32($Bytes,5) }
        if ($Bytes.Length -ge 13) { $Metrics.calories=[int][BitConverter]::ToUInt32($Bytes,9) }
        Emit-Reading $Metrics ([DateTime]::UtcNow.ToString('o'))
    } catch { Emit-Status 'partial' 'Activity totals were unavailable in this session.' }
    $Heart = Get-Characteristic '0000180d-0000-1000-8000-00805f9b34fb' '00002a37-0000-1000-8000-00805f9b34fb'
    $Control = Get-Characteristic '0000180d-0000-1000-8000-00805f9b34fb' '00002a39-0000-1000-8000-00805f9b34fb'
    Send-Band $Control ([byte[]]@(0x15,0x02,0x00))
    Send-Band $Control ([byte[]]@(0x15,0x01,0x00))
    $HeartQueue = Subscribe-Band $Heart
    Send-Band $Control ([byte[]]@(0x15,0x01,0x01))
    $Started = $true
    Emit-Status 'measuring' 'Measuring heart rate. Keep the band on your wrist and remain still.'
    $Deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    $Heartbeat = [DateTime]::UtcNow.AddSeconds(10)
    $NextSummary = [DateTime]::UtcNow.AddSeconds(10)
    $PendingPulse = $null
    $PendingPulseAt = $null
    while ($Continuous -or [DateTime]::UtcNow -lt $Deadline) {
        if ($null -ne $StopTask -and $StopTask.IsCompleted) { break }
        if ([DateTime]::UtcNow -ge $Heartbeat) { Send-Band $Control ([byte[]]@(0x16)); $Heartbeat=[DateTime]::UtcNow.AddSeconds(10) }
        if ([DateTime]::UtcNow -ge $NextSummary) {
            if ($null -ne $PendingPulse) {
                Emit-Reading @{heartRate=$PendingPulse} $PendingPulseAt
                $PendingPulse = $null
                $HeartCount++
            }
            if ($null -ne $Activity) {
                $Bytes = Read-Band $Activity
                if ($Bytes.Length -ge 3) {
                    $Metrics = @{ steps=[int][BitConverter]::ToUInt16($Bytes,1) }
                    if ($Bytes.Length -ge 9) { $Metrics.distanceMeters=[int][BitConverter]::ToUInt32($Bytes,5) }
                    if ($Bytes.Length -ge 13) { $Metrics.calories=[int][BitConverter]::ToUInt32($Bytes,9) }
                    Emit-Reading $Metrics ([DateTime]::UtcNow.ToString('o'))
                }
            }
            if ($null -ne $Battery) {
                $Bytes = Read-Band $Battery
                if ($Bytes.Length -ge 2 -and $Bytes[1] -le 100) { Emit-Reading @{batteryPercent=[int]$Bytes[1]} ([DateTime]::UtcNow.ToString('o')) }
            }
            $NextSummary = $NextSummary.AddSeconds(10)
            if ($NextSummary -lt [DateTime]::UtcNow) { $NextSummary=[DateTime]::UtcNow.AddSeconds(10) }
        }
        $Notification = $null
        if (-not $HeartQueue.Values.TryDequeue([ref]$Notification)) { Start-Sleep -Milliseconds 100; continue }
        $Bytes = $ToArray.Invoke($null, @($Notification.CharacteristicValue))
        if ($Bytes.Length -lt 2) { continue }
        $Pulse = if (($Bytes[0] -band 1) -eq 1) { if ($Bytes.Length -lt 3) { continue }; [int][BitConverter]::ToUInt16($Bytes,1) } else { [int]$Bytes[1] }
        if ($Pulse -ge 25 -and $Pulse -le 250) { $PendingPulse=$Pulse; $PendingPulseAt=$Notification.Timestamp.UtcDateTime.ToString('o') }
    }
    @{ event='complete'; authenticated=$Authenticated; heartRateReadings=$HeartCount; message=$(if ($HeartCount) { 'Fresh band measurements received.' } else { 'Connected, but no heart-rate sample arrived. Check wrist contact and retry.' }) } | ConvertTo-Json -Compress
} catch {
    $Failure = $true
    Emit-Status 'error' $_.Exception.Message
} finally {
    if ($Started -and $null -ne $Control) { try { Send-Band $Control ([byte[]]@(0x15,0x01,0x00)) } catch {} }
    foreach ($Subscription in $Subscriptions) {
        try { $null = Await-Band ($Subscription.Characteristic.WriteClientCharacteristicConfigurationDescriptorAsync([Windows.Devices.Bluetooth.GenericAttributeProfile.GattClientCharacteristicConfigurationDescriptorValue]::None)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattCommunicationStatus]) } catch {}
        try { $null = $Subscription.EventInfo.GetRemoveMethod().Invoke($Subscription.Characteristic, @($Subscription.Token)) } catch {}
    }
    foreach ($Service in $Services) { try { $Service.Dispose() } catch {} }
    if ($null -ne $Band) { $Band.Dispose() }
    if ($null -ne $KeyBytes) { [Array]::Clear($KeyBytes,0,$KeyBytes.Length) }
    if ($OwnsBandMutex) { $BandMutex.ReleaseMutex() }
    if ($null -ne $BandMutex) { $BandMutex.Dispose() }
}
if ($Failure) { exit 1 }
