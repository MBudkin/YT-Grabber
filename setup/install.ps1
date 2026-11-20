
param([switch]$Quiet, [switch]$NoPause)
. (Join-Path $PSScriptRoot 'common.ps1')
$package = Split-Path $PSScriptRoot
$app = Join-Path $package 'app'
if (!(Test-Path -LiteralPath "$app\ytdl_host.exe" -PathType Leaf)) { throw 'Распакуйте архив YT-Grabber.zip целиком.' }
Get-ChildItem -LiteralPath $package -File -Recurse | Unblock-File
Stop-InstalledHost
$files = @(Get-ChildItem -LiteralPath $app -Recurse -File | ForEach-Object { $_.FullName.Substring($app.Length + 1) })
$list = Get-InstallPath 'installed-files.txt'
$old = @()
if (Test-Path -LiteralPath $list) { $old = @(Get-Content -LiteralPath $list -Encoding UTF8) }
foreach ($rel in $files) {
    $dest = Get-InstallPath $rel
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest)) | Out-Null
    [IO.File]::Copy((Join-Path $app $rel), $dest, $true)
}
foreach ($rel in $old) { if ($files -notcontains $rel) { Remove-ProductFile $rel } }
[IO.File]::WriteAllLines($list, [string[]]$files, $utf8)
$config = Get-InstallPath 'config.json'
if (!(Test-Path -LiteralPath $config)) {
    $defaults = [ordered]@{ ytdlpPath="$installDir\bin\yt-dlp.exe"; ffmpegPath="$installDir\bin\ffmpeg"; defaultDir="$env:USERPROFILE\Downloads\YT Grabber"; maxConcurrent=2 }
    [IO.File]::WriteAllText($config, ($defaults | ConvertTo-Json), $utf8)
}
$null = Get-InstallPath "$hostName.json"
$data = [ordered]@{ name=$hostName; description='YT Grabber'; type='stdio'; path="$installDir\ytdl_host.exe"; allowed_origins=@('chrome-extension://ielgkfmkaipmjgmgabobogdjcgdmaejm/') }
[IO.File]::WriteAllText($manifest, ($data | ConvertTo-Json), $utf8)
foreach ($browser in $browsers) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\$browser\NativeMessagingHosts\$hostName")
    try { $key.SetValue('', $manifest) } finally { $key.Dispose() }
}
$ext = Join-Path $installDir 'extension'
Write-Host "Помощник установлен. Папка расширения: $ext"
if (!$Quiet) {
    try { Set-Clipboard -Value $ext } catch { Write-Warning 'Скопируйте путь вручную.' }
    Start-Process explorer.exe -ArgumentList ('"{0}"' -f $ext)
    $chrome = @(
        (Get-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction SilentlyContinue | ForEach-Object { $_.GetValue('') })
        (Get-Item 'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction SilentlyContinue | ForEach-Object { $_.GetValue('') })
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
    if ($chrome) { Start-Process -FilePath $chrome -ArgumentList 'chrome://extensions' }
}
Write-Host '1. Откройте chrome://extensions и включите «Режим разработчика».'
Write-Host '2. Нажмите «Загрузить распакованное расширение».'
Write-Host "3. Вставьте путь $ext и нажмите «Выбор папки»."
