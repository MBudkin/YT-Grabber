@echo off
setlocal DisableDelayedExpansion
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\uninstall.ps1" %*
set "rc=%errorlevel%"
for %%A in (%*) do if /i "%%~A"=="-NoPause" exit /b %rc%
for %%A in (%*) do if /i "%%~A"=="-Quiet" exit /b %rc%
pause
exit /b %rc%
