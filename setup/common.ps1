
$ErrorActionPreference = 'Stop'
$local = [Environment]::GetFolderPath('LocalApplicationData')
$installDir = [IO.Path]::GetFullPath((Join-Path $local 'YT Grabber'))
$hostName = 'com.ytgrabber.host'
$browsers = @('Google\Chrome', 'Google\Chrome for Testing', 'Microsoft\Edge',
    'BraveSoftware\Brave-Browser', 'Chromium', 'Yandex\YandexBrowser', 'Vivaldi')
$manifest = Join-Path $installDir "$hostName.json"
$utf8 = New-Object Text.UTF8Encoding($false)
function Stop-InstalledHost {
    $exe = Join-Path $installDir 'ytdl_host.exe'
    Get-Process -Name ytdl_host -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | ForEach-Object {
        & "$env:SystemRoot\System32\taskkill.exe" /PID $_.Id /T /F | Out-Null
        if (!$_.WaitForExit(10000)) { throw 'Не удалось остановить помощник.' }
    }
}
function Get-InstallPath([string]$relative) {
    $path = [IO.Path]::GetFullPath((Join-Path $installDir $relative))
    if (!$path.StartsWith($installDir + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Недопустимый путь: $relative" }
    $node = $path
    while ($node -ne $local) {
        if ((Test-Path -LiteralPath $node) -and ((Get-Item -Force -LiteralPath $node).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Ссылка в пути установки: $node"
        }
        $node = [IO.Path]::GetDirectoryName($node)
    }
    return $path
}
function Remove-ProductFile([string]$relative) {
    $file = Get-InstallPath $relative
    if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -Force -LiteralPath $file }
    $dir = [IO.Path]::GetDirectoryName($file)
    while ($dir -ne $installDir -and [IO.Directory]::Exists($dir) -and ![IO.Directory]::GetFileSystemEntries($dir).Length) {
        [IO.Directory]::Delete($dir)
        $dir = [IO.Path]::GetDirectoryName($dir)
    }
}
