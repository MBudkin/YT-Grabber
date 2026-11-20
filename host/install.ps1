$ErrorActionPreference = 'Stop'
$hostDir = $PSScriptRoot
$project = Split-Path $hostDir -Parent
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8($path, $value) {
    [IO.File]::WriteAllText($path, $value, $utf8)
}
try {
    $python = $null
    foreach ($candidate in @('py', 'python', "$env:LOCALAPPDATA\Python\bin\python.exe")) {
        $app = Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (!$app) { continue }
        $arguments = @('-c', 'import json, sys; print(json.dumps(sys.executable)) if sys.version_info.major == 3 else sys.exit(1)')
        if ($candidate -eq 'py') { $arguments = @('-3') + $arguments }
        $found = & $app.Source @arguments
        if ($LASTEXITCODE -ne 0 -or !$found) { continue }
        $found = ConvertFrom-Json -InputObject $found
        if (Test-Path -LiteralPath $found -PathType Leaf) { $python = $found; break }
    }
    if (!$python) { throw 'Python 3 не найден.' }
    $ytdlp = Join-Path $project 'yt-dlp.exe'
    if (!(Test-Path -LiteralPath $ytdlp -PathType Leaf)) { throw "Не найден $ytdlp" }
    $ffmpeg = (Get-Command ffmpeg.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (!$ffmpeg) { Write-Warning 'ffmpeg не найден. Объединение видео и конвертация аудио требуют ffmpeg.' }
    $configPath = Join-Path $hostDir 'config.json'
    $config = [ordered]@{ ytdlpPath=$ytdlp; ffmpegPath=[string]$ffmpeg; defaultDir=(Join-Path $env:USERPROFILE 'Downloads\YT Grabber'); maxConcurrent=2 }
    if (Test-Path -LiteralPath $configPath) {
        $old = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($old.defaultDir) { $config.defaultDir = $old.defaultDir }
        if ($old.maxConcurrent -gt 0) { $config.maxConcurrent = $old.maxConcurrent }
        if ($old.ytdlpPath -and (Test-Path -LiteralPath $old.ytdlpPath -PathType Leaf)) { $config.ytdlpPath = $old.ytdlpPath }
        if ($old.ffmpegPath -and (Test-Path -LiteralPath $old.ffmpegPath)) { $config.ffmpegPath = $old.ffmpegPath }
    }
    Write-Utf8 $configPath ($config | ConvertTo-Json)
    $launcher = Join-Path $hostDir 'ytdl_host.bat'
    $lines = @('@echo off', 'setlocal DisableDelayedExpansion', 'chcp 65001 >nul', ('"{0}" -u "%~dp0ytdl_host.py" %*' -f $python.Replace('%','%%')))
    Write-Utf8 $launcher (($lines -join "`r`n") + "`r`n")
    $name = 'com.ytgrabber.host'
    $manifest = Join-Path $hostDir "$name.json"
    Write-Utf8 $manifest ([ordered]@{ name=$name; description='YT Grabber'; type='stdio'; path=$launcher; allowed_origins=@('chrome-extension://ielgkfmkaipmjgmgabobogdjcgdmaejm/') } | ConvertTo-Json)
    foreach ($browser in @('Google\Chrome', 'Google\Chrome for Testing', 'Microsoft\Edge')) {
        $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\$browser\NativeMessagingHosts\$name")
        try { $key.SetValue('', $manifest) } finally { $key.Dispose() }
        Write-Host "Зарегистрирован хост для $browser."
    }
    Write-Host "Python: $python"
    Write-Host "yt-dlp: $ytdlp"
    Write-Host "ffmpeg: $ffmpeg"
    Write-Host 'Установка завершена.'
} catch { Write-Error $_; exit 1 }
