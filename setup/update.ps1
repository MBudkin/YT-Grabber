param([int]$WaitPid, [string]$Version, [string]$Attempt, [string]$Cleanup)
# Started detached by the helper (self_update). Waits for the helper to exit, installs this
# package over the current installation, records the result in update-status.json (read by the
# helper's ping) and removes the temporary download folder.
$ErrorActionPreference = 'Stop'
$dataDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'YT Grabber'
$log = Join-Path $dataDir 'update.log'
$statusDir = Join-Path $dataDir 'update-status'
# Without a valid attempt id (legacy caller) the update still installs, just without a status record.
$statusFile = if ($Attempt -match '^[a-z0-9]{8,32}$') { Join-Path $statusDir "$Attempt.json" } else { $null }
$utf8 = New-Object Text.UTF8Encoding($false)
function Write-Log([string]$text) {
    try { Add-Content -LiteralPath $log -Value ("{0:s} {1}" -f (Get-Date), $text) -Encoding UTF8 } catch {}
}
function Write-Status([string]$status, [string]$err) {
    if (!$statusFile) { return }
    $data = [ordered]@{ version = $Version; attempt = $Attempt; status = $status; error = $err
        at = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }
    try { [IO.Directory]::CreateDirectory($statusDir) | Out-Null
        [IO.File]::WriteAllText($statusFile, ($data | ConvertTo-Json -Compress), $utf8) } catch {}
}
# Only one installer at a time (several browser profiles may request the same update).
$mutex = New-Object Threading.Mutex($false, 'Local\YTGrabberUpdate')
$code = 0
try {
    if (!$mutex.WaitOne([TimeSpan]::FromMinutes(5))) { throw 'another update is still running' }
    # Drop status records of old attempts.
    Get-ChildItem -LiteralPath $statusDir -Filter '*.json' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne "$Attempt.json" -and $_.LastWriteTime -lt (Get-Date).AddDays(-1) } |
        Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Status 'installing' ''
    if ($WaitPid) {
        $proc = Get-Process -Id $WaitPid -ErrorAction SilentlyContinue
        if ($proc) { $null = $proc.WaitForExit(30000) }
    }
    $installer = Join-Path $PSScriptRoot 'install.ps1'
    for ($try = 1; ; $try++) {
        try { & $installer -Quiet *> $null; break }
        catch {
            Write-Log "try ${try}: $_"
            if ($try -ge 4) { throw }
            Start-Sleep -Seconds 3
        }
    }
    Write-Status 'ok' ''
    Write-Log "installed $Version from $(Split-Path $PSScriptRoot)"
} catch {
    Write-Status 'failed' "$_"
    Write-Log "FAILED: $_"
    $code = 1
} finally {
    try { $mutex.ReleaseMutex() } catch {}
    if ($Cleanup) {
        $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
        $full = [IO.Path]::GetFullPath($Cleanup)
        if ([IO.Path]::GetDirectoryName($full) -eq $temp -and (Split-Path -Leaf $full) -like 'ytgrabber-update-*') {
            Set-Location -LiteralPath $temp
            Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
exit $code
