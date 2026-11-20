
param([switch]$Quiet, [switch]$NoPause)
. (Join-Path $PSScriptRoot 'common.ps1')
Stop-InstalledHost
foreach ($browser in $browsers) {
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree("Software\$browser\NativeMessagingHosts\$hostName", $false)
}
$list = Get-InstallPath 'installed-files.txt'
if (Test-Path -LiteralPath $list) {
    foreach ($rel in @(Get-Content -LiteralPath $list -Encoding UTF8)) { Remove-ProductFile $rel }
}
foreach ($rel in @('installed-files.txt','config.json','host.log','host.log.1','update.log',"$hostName.json")) { Remove-ProductFile $rel }
$statusDir = Get-InstallPath 'update-status'
if ([IO.Directory]::Exists($statusDir)) { Get-ChildItem -LiteralPath $statusDir -File | ForEach-Object { Remove-ProductFile "update-status\$($_.Name)" } }
if ([IO.Directory]::Exists($installDir) -and ![IO.Directory]::GetFileSystemEntries($installDir).Length) { [IO.Directory]::Delete($installDir) }
Write-Host 'Помощник удалён. Скачанные файлы сохранены. Расширение можно удалить на chrome://extensions.'
