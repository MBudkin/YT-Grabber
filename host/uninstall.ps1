$ErrorActionPreference = 'Stop'
foreach ($browser in @('Google\Chrome', 'Google\Chrome for Testing', 'Microsoft\Edge')) {
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey("Software\$browser\NativeMessagingHosts\com.ytgrabber.host", $false)
    Write-Host "Регистрация хоста для $browser удалена."
}
Write-Host 'Удаление регистрации завершено. Скачанные файлы и настройки сохранены.'
