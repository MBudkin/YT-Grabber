param(
    [string]$Python = "$env:LOCALAPPDATA\Python\bin\python.exe",
    [string]$FFmpegArchive,
    [ValidateNotNullOrEmpty()][string]$YtDlp
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path $PSScriptRoot
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('YT-Grabber-build-' + [guid]::NewGuid())
$package = Join-Path $scratch 'YT-Grabber'
$app = Join-Path $package 'app'
$bin = Join-Path $app 'bin'
$ffmpeg = Join-Path $bin 'ffmpeg'
$downloads = Join-Path $scratch 'downloads'
New-Item -ItemType Directory -Path $downloads,$ffmpeg | Out-Null
function Check-Exit($step) { if ($LASTEXITCODE -ne 0) { throw "$step failed ($LASTEXITCODE)" } }
function Download([string]$url, [string]$target) {
    & curl.exe --fail --silent --show-error --location --retry 3 --output $target $url
    Check-Exit $url
}
function Check-Digest($path, $digest) {
    if ("sha256:$((Get-FileHash -LiteralPath $path).Hash)" -ne $digest) { throw "Digest mismatch: $path" }
}
try {
    $manifestVersion = (Get-Content -Raw -LiteralPath "$root\extension\manifest.json" | ConvertFrom-Json).version
    $hostSource = Get-Content -Raw -LiteralPath "$root\host\ytdl_host.py"
    $hostVersion = [regex]::Match([string]$hostSource, '(?m)^VERSION[ \t]*=[ \t]*"(\d+\.\d+\.\d+)"[ \t]*\r?$').Groups[1].Value
    if (-not $hostVersion -or -not $manifestVersion -or $manifestVersion -ne $hostVersion) {
        throw "Version mismatch: manifest $manifestVersion, host $hostVersion"
    }
    & $Python -c "import platform, sys; sys.exit(platform.machine().upper() != 'AMD64' or sys.maxsize <= 2**32)"
    Check-Exit 'x64 Python check'
    & $Python -m venv "$scratch\venv"
    Check-Exit 'venv'
    $py = "$scratch\venv\Scripts\python.exe"
    & $py -m pip install --disable-pip-version-check pyinstaller==6.22.3
    Check-Exit 'pip'
    & $py -m PyInstaller --clean --noconfirm --console --onedir --noupx --distpath "$scratch\frozen" --workpath "$scratch\work" --specpath $scratch "$root\host\ytdl_host.py"
    Check-Exit 'PyInstaller'
    Get-ChildItem -LiteralPath "$scratch\frozen\ytdl_host" | Copy-Item -Destination $app -Recurse
    $release = Invoke-RestMethod 'https://api.github.com/repos/yt-dlp/FFmpeg-Builds/releases/latest'
    $asset = $release.assets | Where-Object name -eq 'ffmpeg-master-latest-win64-gpl-shared.zip'
    $zip = "$downloads\ffmpeg.zip"
    if ($FFmpegArchive) { Copy-Item -LiteralPath $FFmpegArchive -Destination $zip } else { Download $asset.browser_download_url $zip }
    Check-Digest $zip $asset.digest
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName -match '/bin/(ffmpeg\.exe|ffprobe\.exe|[^/]+\.dll)$|/LICENSE\.txt$') {
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $ffmpeg $entry.Name))
            }
        }
    } finally { $archive.Dispose() }
    foreach ($tool in @('ffprobe','ffmpeg')) { & "$ffmpeg\$tool.exe" -version | Out-Null; Check-Exit $tool }
    $qjsTag = 'v0.18.0'
    Download "https://github.com/quickjs-ng/quickjs/releases/download/$qjsTag/qjs-windows-x86_64.exe" "$downloads\qjs.exe"
    Check-Digest "$downloads\qjs.exe" 'sha256:ff03398d74ea6e6bd3a8e58058f7003225abcac229d7d57775b7aaae812a49c7'
    Copy-Item -LiteralPath "$downloads\qjs.exe" -Destination $bin
    if (-not $YtDlp) {
        $ytTag = (Invoke-RestMethod 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest').tag_name
        $ytRelease = "https://github.com/yt-dlp/yt-dlp/releases/download/$ytTag"
        $YtDlp = "$downloads\yt-dlp.exe"
        $sums = "$downloads\SHA2-256SUMS"
        Download "$ytRelease/yt-dlp.exe" $YtDlp
        Download "$ytRelease/SHA2-256SUMS" $sums
        $entries = @(Select-String -LiteralPath $sums -CaseSensitive -Pattern '^([0-9A-Fa-f]{64})[ \t]+\*?yt-dlp\.exe[ \t]*$')
        if ($entries.Count -ne 1) { throw 'Expected one checksum for yt-dlp.exe in SHA2-256SUMS' }
        Check-Digest $YtDlp "sha256:$($entries[0].Matches[0].Groups[1].Value)"
    }
    Copy-Item -LiteralPath $YtDlp -Destination "$bin\yt-dlp.exe"
    $plugins = New-Item -ItemType Directory -Path "$bin\yt-dlp-plugins"
    & $py -m zipfile -c "$plugins\ytgrabber.zip" "$root\host\yt-dlp-plugins\ytgrabber\yt_dlp_plugins"
    Check-Exit 'yt-dlp launcher plugin'
    Download "https://raw.githubusercontent.com/quickjs-ng/quickjs/$qjsTag/LICENSE" "$bin\QuickJS-LICENSE.txt"
    Copy-Item -LiteralPath "$root\extension" -Recurse -Destination $app
    Copy-Item -LiteralPath "$root\setup" -Recurse -Destination $package
    foreach ($name in @('Install.bat','Uninstall.bat')) { Copy-Item -LiteralPath "$root\$name" -Destination "$package\$name" }
    Copy-Item -LiteralPath "$PSScriptRoot\README.txt" -Destination $package
    [IO.File]::WriteAllText("$package\VERSION.txt", $manifestVersion, [Text.Encoding]::ASCII)
    $dest = Join-Path $root 'dist'
    [IO.Directory]::CreateDirectory($dest) | Out-Null
    & $py -m zipfile -c "$scratch\YT-Grabber.zip" $package
    Check-Exit 'archive'
    Copy-Item -LiteralPath "$scratch\YT-Grabber.zip" -Destination "$dest\YT-Grabber.zip" -Force
    Get-Item -LiteralPath "$dest\YT-Grabber.zip" | Select-Object FullName, Length
} finally {
    $resolved = (Resolve-Path -LiteralPath $scratch).ProviderPath
    if ($resolved -eq $scratch -and [IO.Path]::GetDirectoryName($resolved) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and (Split-Path -Leaf $resolved) -match '^YT-Grabber-build-[0-9a-f-]{36}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
