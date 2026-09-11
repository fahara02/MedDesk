param([switch]$SaveToServer)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -gt 5) {
    $ChildArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath)
    if ($SaveToServer) { $ChildArguments += '-SaveToServer' }
    & powershell.exe @ChildArguments
    exit $LASTEXITCODE
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Bluetooth.GenericAttributeProfile.GattDeviceServicesResult, Windows.Devices.Bluetooth, ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicsResult, Windows.Devices.Bluetooth, ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Bluetooth.GenericAttributeProfile.GattReadResult, Windows.Devices.Bluetooth, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IBuffer, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null

$AsTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Wait-BandOperation($Operation, [Type]$ResultType) {
    $Task = $AsTaskMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    if (-not $Task.Wait(15000)) { throw 'Bluetooth operation timed out after 15 seconds.' }
    return $Task.Result
}

$AddressText = [Environment]::GetEnvironmentVariable('BLUETOOTH_ADDRESS', 'Process')
$EnvFile = Join-Path $PSScriptRoot '.env'
if (-not $AddressText -and (Test-Path -LiteralPath $EnvFile)) {
    foreach ($Line in [IO.File]::ReadAllLines($EnvFile)) {
        if ($Line -match '^\s*BLUETOOTH_ADDRESS\s*=(.*)$') {
            $AddressText = $Matches[1].Trim()
            if ($AddressText.Length -ge 2 -and (
                ($AddressText[0] -eq '"' -and $AddressText[$AddressText.Length - 1] -eq '"') -or
                ($AddressText[0] -eq "'" -and $AddressText[$AddressText.Length - 1] -eq "'"))) {
                $AddressText = $AddressText.Substring(1, $AddressText.Length - 2)
            }
        }
    }
}
if ($AddressText -notmatch '^(?:[0-9a-fA-F]{12}|(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}|(?:[0-9a-fA-F]{2}-){5}[0-9a-fA-F]{2})$') {
    throw 'A valid BLUETOOTH_ADDRESS is required in .env.'
}
$Address = [Convert]::ToUInt64(($AddressText -replace '[:-]', ''), 16)
$Band = Wait-BandOperation ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromBluetoothAddressAsync($Address)) ([Windows.Devices.Bluetooth.BluetoothLEDevice])
if ($null -eq $Band) { throw 'Windows could not open the configured Bluetooth device.' }
$Services = $null
try {
    $CacheMode = [Windows.Devices.Bluetooth.BluetoothCacheMode]::Uncached
    $Services = Wait-BandOperation ($Band.GetGattServicesForUuidAsync([Guid]'0000180f-0000-1000-8000-00805f9b34fb', $CacheMode)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattDeviceServicesResult])
    if ($Services.Status.ToString() -ne 'Success' -or @($Services.Services).Count -ne 1) {
        throw 'The band did not expose an accessible standard battery service.'
    }
    $Service = @($Services.Services)[0]
    $Characteristics = Wait-BandOperation ($Service.GetCharacteristicsForUuidAsync([Guid]'00002a19-0000-1000-8000-00805f9b34fb', $CacheMode)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicsResult])
    if ($Characteristics.Status.ToString() -ne 'Success' -or @($Characteristics.Characteristics).Count -ne 1) {
        throw 'The band did not expose an accessible battery-level characteristic.'
    }
    $Characteristic = @($Characteristics.Characteristics)[0]
    $Read = Wait-BandOperation ($Characteristic.ReadValueAsync($CacheMode)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattReadResult])
    $ObservedAt = [DateTime]::UtcNow.ToString('o')
    if ($Read.Status.ToString() -ne 'Success' -or $null -eq $Read.Value) {
        throw ('Battery read failed: ' + $Read.Status.ToString())
    }
    # Reflection preserves the WinRT IBuffer conversion in Windows PowerShell.
    $ToArray = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'ToArray' -and $_.GetParameters().Count -eq 1
    } | Select-Object -First 1
    $Bytes = $ToArray.Invoke($null, @($Read.Value))
    if ($Bytes.Length -ne 1 -or $Bytes[0] -gt 100) { throw 'The band returned an invalid battery percentage.' }
    $Reading = @{ source='band'; deviceName=$Band.Name; observedAt=$ObservedAt; batteryPercent=[int]$Bytes[0] }
    if ($SaveToServer) {
        $null = Invoke-RestMethod -Uri 'http://localhost:8787/api/readings' -Method Post -ContentType 'application/json' -Body ($Reading | ConvertTo-Json -Compress) -TimeoutSec 5
    }
    [pscustomobject]@{ Reading=$Reading; Paired=$Band.DeviceInformation.Pairing.IsPaired; Connection=$Band.ConnectionStatus.ToString(); SavedToServer=[bool]$SaveToServer } | ConvertTo-Json -Depth 3 -Compress
} finally {
    if ($null -ne $Services) { foreach ($Service in $Services.Services) { $Service.Dispose() } }
    $Band.Dispose()
}
