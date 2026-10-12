#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$SCRIPT_DIR/extension/dist"
PACKAGE_ROOT="$SCRIPT_DIR/release/DriveMate-Windows"
OUTPUT_ZIP="$SCRIPT_DIR/release/DriveMate-Windows.zip"

echo "=========================================================="
echo "  Building DriveMate Windows Distribution Package"
echo "=========================================================="

# 1. Clean and recreate directory structure
rm -rf "$PACKAGE_ROOT" "$OUTPUT_ZIP"
mkdir -p "$PACKAGE_ROOT"
mkdir -p "$PACKAGE_ROOT/DriveMate-Extension"
mkdir -p "$PACKAGE_ROOT/Helper-Engine"

# 2. Copy extension files
echo "[*] Copying extension production assets..."
cp -R "$DIST_DIR/"* "$PACKAGE_ROOT/DriveMate-Extension/"

# 3. Copy helper engine files
echo "[*] Packaging Windows Native Helper Engine..."
cp "$SCRIPT_DIR/scripts/drivemate_helper_windows.py" "$PACKAGE_ROOT/Helper-Engine/drivemate_helper.py"
cp "$SCRIPT_DIR/scripts/drivemate_helper_windows.ps1" "$PACKAGE_ROOT/Helper-Engine/drivemate_helper.ps1"

# Create DriveMateHelper.bat
cat << 'EOF' > "$PACKAGE_ROOT/Helper-Engine/DriveMateHelper.bat"
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
EOF

# 4. Create 1. Install Helper (Windows).bat
cat << 'EOF' > "$PACKAGE_ROOT/1. Install Helper (Windows).bat"
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
EOF

# 5. Create 2. Open Chrome Extensions (Windows).bat
cat << 'EOF' > "$PACKAGE_ROOT/2. Open Chrome Extensions (Windows).bat"
@echo off
start chrome "chrome://extensions" 2>nul || start msedge "edge://extensions" 2>nul
EOF

# 6. Create Bengali Installation Guide
cat << 'EOF' > "$PACKAGE_ROOT/INSTALL_GUIDE_BANGLA.txt"
================================================================================
                    🚀 DriveMate ইনস্টলেশন গাইড (Windows 10/11)
          পাবলিক গুগল ড্রাইভ থেকে হাই-স্পিড ডাউনলোড এক্সটেনশন
================================================================================

DriveMate সেটআপ করতে মাত্র ১ মিনিট সময় লাগবে। নিচের ৩টি সহজ ধাপ অনুসরণ করুন:

--------------------------------------------------------------------------------
ধাপ ১: নেটিভ ইঞ্জিন ইনস্টল (এক ক্লিকে)
--------------------------------------------------------------------------------
এই ফোল্ডারে থাকা "1. Install Helper (Windows).bat" ফাইলে ডাবল-ক্লিক করুন।
একটি উইন্ডো খুলবে এবং সফলভাবে নেটিভ হেল্পার রেজিস্ট্রি কনফিগার হয়ে যাবে।
(প্রম্পট আসলে কীবোর্ডে 'y' চেপে এন্টার দিতে পারেন)।

--------------------------------------------------------------------------------
ধাপ ২: ক্রোম এক্সটেনশন লোড করুন
--------------------------------------------------------------------------------
১. আপনার গুগল ক্রোম (Google Chrome) ব্রাউজার ওপেন করুন।
২. অ্যাড্রেস বারে লিখুন: chrome://extensions (এবং এন্টার চাপুন)।
   (অথবা এই ফোল্ডারের "2. Open Chrome Extensions (Windows).bat" ফাইলে ডাবল-ক্লিক করুন)।
৩. পেজের উপরের ডানপাশে (Top-Right) থাকা "Developer mode" টগলটি ON করুন।
৪. পেজের বামপাশে আসা "Load unpacked" বাটনে ক্লিক করুন।
৫. এই প্যাকেজের মধ্যে থাকা "DriveMate-Extension" ফোল্ডারটি সিলেক্ট করুন।

--------------------------------------------------------------------------------
ধাপ ৩: ব্যবহার শুরু করুন
--------------------------------------------------------------------------------
১. ব্রাউজারের উপরে এক্সটেনশন (Extensions puzzle icon) থেকে DriveMate পিন (Pin) করুন।
২. যেকোনো পাবলিক গুগল ড্রাইভ ফোল্ডার লিংক পেস্ট করুন।
৩. সাথে সাথে ভিডিও (Footages), ছবি (Photos), অডিও ও ডকুমেন্টের মোট সংখ্যা দেখা যাবে।
৪. "START DOWNLOAD" চাপুন এবং হাই-স্পিডে ডাউনলোড করুন!

================================================================================
EOF

# 7. Create English Installation Guide
cat << 'EOF' > "$PACKAGE_ROOT/INSTALL_GUIDE_ENGLISH.txt"
================================================================================
                    🚀 DriveMate Quick Installation Guide (Windows)
           High-Speed Public Google Drive Downloader (Zero Login)
================================================================================

Setup takes less than 1 minute. Follow these 3 easy steps:

--------------------------------------------------------------------------------
STEP 1: Install Local Native Engine
--------------------------------------------------------------------------------
Double-click on "1. Install Helper (Windows).bat" in this folder.
It will configure the Windows registry for Chrome, Brave, and Edge automatically.

--------------------------------------------------------------------------------
STEP 2: Load Extension in Google Chrome
--------------------------------------------------------------------------------
1. Open Google Chrome.
2. In the address bar, type: chrome://extensions (and press Enter).
   (Or double-click "2. Open Chrome Extensions (Windows).bat").
3. Enable "Developer mode" toggle in the top-right corner.
4. Click the "Load unpacked" button in the top-left corner.
5. Select the "DriveMate-Extension" folder located inside this package.

--------------------------------------------------------------------------------
STEP 3: Start Downloading!
--------------------------------------------------------------------------------
1. Pin the DriveMate extension in your Chrome toolbar.
2. Paste any public Google Drive folder link.
3. Watch the instant breakdown of Footages, Photos, Audio, and Documents.
4. Click "START DOWNLOAD" to enjoy maximum speed transfers!

================================================================================
EOF

# 8. Create README
cat << 'EOF' > "$PACKAGE_ROOT/README.md"
# DriveMate — Windows Distribution Package (v0.3.0)

This package contains everything needed to run DriveMate on Windows 10 and Windows 11.

### Contents:
- `1. Install Helper (Windows).bat` — Registers native messaging host in Windows registry.
- `2. Open Chrome Extensions (Windows).bat` — Quick shortcut to open Chrome extension manager.
- `DriveMate-Extension/` — Production build of the Chrome extension (Manifest V3).
- `Helper-Engine/` — High-speed download engine (Python + PowerShell fallback).
- `INSTALL_GUIDE_BANGLA.txt` — Step-by-step instructions in Bengali.
- `INSTALL_GUIDE_ENGLISH.txt` — Step-by-step instructions in English.
EOF

# 9. Clean hidden macOS metadata
find "$PACKAGE_ROOT" -name "._*" -delete 2>/dev/null || true
find "$PACKAGE_ROOT" -name ".DS_Store" -delete 2>/dev/null || true

# 10. Create Clean ZIP
echo "[*] Creating final Windows ZIP package..."
export COPYFILE_DISABLE=1
(cd "$SCRIPT_DIR/release" && zip -r -q "DriveMate-Windows.zip" "DriveMate-Windows" -x "*.DS_Store" "*._*" "*__MACOSX*")

echo "[+] Done!"
echo "    Package ZIP: $OUTPUT_ZIP"
