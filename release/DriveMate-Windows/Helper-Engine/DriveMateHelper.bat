@echo off
setlocal
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    python -u "%~dp0drivemate_helper.py" %*
    exit /b %ERRORLEVEL%
)
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    py -u "%~dp0drivemate_helper.py" %*
    exit /b %ERRORLEVEL%
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0drivemate_helper.ps1" %*
exit /b %ERRORLEVEL%
