@echo off
chcp 65001 >nul
title DriveMate Windows Setup
cls
echo ==========================================================
echo          DriveMate Engine Setup for Windows 10/11
echo ==========================================================
echo.
set "INSTALL_DIR=%~dp0Helper-Engine"
set "BAT_PATH=%INSTALL_DIR%\DriveMateHelper.bat"
set "JSON_PATH=%INSTALL_DIR%\com.drivemate.helper.json"
set "EXT_ID=nhnlodcpjfepoegoemhhmhckmjgalnha"

:: Escape backslashes for JSON file
set "ESCAPED_PATH=%BAT_PATH:\=\\%"

echo [1/3] Registering DriveMate Native Engine...
(
  echo {
  echo   "name": "com.drivemate.helper",
  echo   "description": "DriveMate High-Speed Native Download Helper",
  echo   "path": "%ESCAPED_PATH%",
  echo   "type": "stdio",
  echo   "allowed_origins": [
  echo     "chrome-extension://%EXT_ID%/"
  echo   ]
  echo }
) > "%JSON_PATH%"

echo [2/3] Adding Registry keys for Chrome, Brave, and Edge...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.drivemate.helper" /ve /t REG_SZ /d "%JSON_PATH%" /f >nul 2>&1
reg add "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.drivemate.helper" /ve /t REG_SZ /d "%JSON_PATH%" /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.drivemate.helper" /ve /t REG_SZ /d "%JSON_PATH%" /f >nul 2>&1

echo [3/3] Native bridge registered successfully!
echo.
echo ==========================================================
echo                SETUP COMPLETED!
echo ==========================================================
echo.
echo 👉 এক্সটেনশন চালু করতে নিচের ৩টি কাজ করুন:
echo    1. গুগল ক্রোমে যান এবং অ্যাড্রেস বারে লিখুন: chrome://extensions
echo    2. উপরের ডানপাশের 'Developer mode' অন (ON) করুন।
echo    3. বামপাশের 'Load unpacked' বাটনে ক্লিক করে এই প্যাকেজের
echo       'DriveMate-Extension' ফোল্ডারটি সিলেক্ট করুন।
echo.
echo ফোল্ডার পাথ:
echo %~dp0DriveMate-Extension
echo ==========================================================
echo.
set /p choice="গুগল ক্রোম এক্সটেনশন পেজ খুলতে চান? (Y/N): "
if /i "%choice%"=="Y" (
  start chrome "chrome://extensions" 2>nul || start msedge "edge://extensions" 2>nul
)
echo.
echo সব প্রস্তুত! যেকোনো কি চেপে উইন্ডোটি বন্ধ করতে পারেন।
pause >nul
