param([switch]$ListVoices)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
$Synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
$Wave = $null
try {
    if ($ListVoices) {
        $Voices = @($Synthesizer.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { @{ name=$_.VoiceInfo.Name; language=$_.VoiceInfo.Culture.Name } })
        ConvertTo-Json -InputObject $Voices -Compress
    } else {
        $Request = [Console]::In.ReadToEnd() | ConvertFrom-Json
        if ($Request.text -isnot [string] -or $Request.text.Length -gt 8000 -or [string]::IsNullOrWhiteSpace($Request.text)) { throw 'Invalid speech text.' }
        $Synthesizer.SelectVoice([string]$Request.voice)
        if ($Request.text -match '[\u0980-\u09FF]' -and $Synthesizer.Voice.Culture.TwoLetterISOLanguageName -ne 'bn') { throw 'Select a Bengali voice for Bengali text.' }
        $Synthesizer.Rate = [Math]::Min(3,[Math]::Max(-3,[int]$Request.rate))
        $Wave = New-Object IO.MemoryStream
        $Synthesizer.SetOutputToWaveStream($Wave)
        $Synthesizer.Speak([string]$Request.text)
        $Synthesizer.SetOutputToNull()
        $Bytes = $Wave.ToArray()
        $Output = [Console]::OpenStandardOutput()
        $Output.Write($Bytes,0,$Bytes.Length)
        $Output.Flush()
    }
} catch {
    [Console]::Error.WriteLine('Windows speech synthesis failed. Check the selected voice and language.')
    exit 1
} finally {
    $Synthesizer.Dispose()
    if ($null -ne $Wave) { $Wave.Dispose() }
}
