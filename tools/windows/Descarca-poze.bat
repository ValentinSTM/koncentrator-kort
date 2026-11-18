@echo off
rem Dublu-clic pe acest fisier. Porneste descarca-poze.ps1 din acelasi folder.
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0descarca-poze.ps1" %*
echo.
pause
