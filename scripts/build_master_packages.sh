#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# DriveMate Master Distribution Packaging Script
# Creates all 4 versions in one unified buyer package and dedicated platform zips:
#  1. DriveMate Windows (Standalone Native App + Launcher)
#  2. DriveMate Mac (Ad-hoc signed .app + DMG + 1-Click Gatekeeper Bypass Launcher)
#  3. DriveMate Chrome Extension (Ready-to-use for Windows & Mac)
#  4. Crystal-Clear Bengali & English Guides + Interactive HTML Manual
# ==============================================================================

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WORKSPACE_ROOT"

echo "=================================================================="
echo "  🚀 Assembling Complete 4-in-1 DriveMate Buyer Packages"
echo "=================================================================="

# 1. Compile fresh Chrome Extension
echo "[1/6] Building production Chrome Extension..."
(cd "$WORKSPACE_ROOT/extension" && npm run build)

# 2. Prepare Master Buyer Directory
MASTER_DIR="$WORKSPACE_ROOT/👉-SEND-THIS-TO-BUYER-DriveMate"
rm -rf "$MASTER_DIR"
mkdir -p "$MASTER_DIR"
mkdir -p "$MASTER_DIR/1-DriveMate-Windows"
mkdir -p "$MASTER_DIR/2-DriveMate-Mac"
mkdir -p "$MASTER_DIR/3-DriveMate-Chrome-Extension"

# 3. Assemble Windows Section
echo "[2/6] Assembling Windows Package..."
if [ -f "$WORKSPACE_ROOT/scratch/windows-dev/DriveMate.exe" ]; then
    cp "$WORKSPACE_ROOT/scratch/windows-dev/DriveMate.exe" "$MASTER_DIR/1-DriveMate-Windows/"
elif [ -f "$WORKSPACE_ROOT/DriveMate-Windows/DriveMate.exe" ]; then
    cp "$WORKSPACE_ROOT/DriveMate-Windows/DriveMate.exe" "$MASTER_DIR/1-DriveMate-Windows/"
fi

cat << 'EOF' > "$MASTER_DIR/1-DriveMate-Windows/⚡-1-Click-Start-Windows.bat"
@echo off
setlocal
cd /d "%~dp0"
title DriveMate PRO — Windows Launcher
cls
echo ==========================================================
echo        ⚡ Starting DriveMate PRO (Windows)
echo ==========================================================
echo.
if exist "DriveMate.exe" (
    start "" "DriveMate.exe"
    exit /b 0
)
echo [-] Error: DriveMate.exe not found in this folder.
pause
exit /b 1
EOF

cat << 'EOF' > "$MASTER_DIR/1-DriveMate-Windows/🛠️-Install-Desktop-Shortcut.bat"
@echo off
setlocal
cd /d "%~dp0"
title DriveMate PRO — Desktop Shortcut Installer
cls
echo ==========================================================
echo    ⚡ DriveMate PRO — Creating Desktop Shortcut
echo ==========================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\DriveMate PRO.lnk'); $sc.TargetPath = '%~dp0DriveMate.exe'; $sc.WorkingDirectory = '%~dp0'; $sc.Description = 'DriveMate PRO - High Speed Google Drive Downloader'; $sc.Save();"
if %ERRORLEVEL% EQU 0 (
    echo [✓] Shortcut 'DriveMate PRO' created on your Desktop!
) else (
    echo [!] Could not create Desktop shortcut automatically.
)
echo.
echo Launching DriveMate PRO...
start "" "%~dp0DriveMate.exe"
exit /b 0
EOF

cat << 'EOF' > "$MASTER_DIR/1-DriveMate-Windows/README-Windows.txt"
================================================================================
                    ⚡ DriveMate PRO — Windows Quick Start
================================================================================

HOW TO RUN:
1. Simply double-click "DriveMate.exe" (or "⚡-1-Click-Start-Windows.bat").
2. Optional: Double-click "🛠️-Install-Desktop-Shortcut.bat" to add a shortcut on your Desktop.

IF WINDOWS DEFENDER SMART SCREEN SHOWS:
- Click "More info" (আরও তথ্য)
- Click "Run anyway" (যেকোনো উপায়ে চালান)

================================================================================
EOF

# 4. Assemble Mac Section
echo "[3/6] Assembling Mac Package..."
# Copy clean DriveMate.app
if [ -d "$WORKSPACE_ROOT/DriveMate-macOS/DriveMate.app" ]; then
    cp -R "$WORKSPACE_ROOT/DriveMate-macOS/DriveMate.app" "$MASTER_DIR/2-DriveMate-Mac/"
elif [ -d "$WORKSPACE_ROOT/DriveMate.app" ]; then
    cp -R "$WORKSPACE_ROOT/DriveMate.app" "$MASTER_DIR/2-DriveMate-Mac/"
fi

# Clean up nested apps or quarantine
rm -rf "$MASTER_DIR/2-DriveMate-Mac/DriveMate.app/DriveMate.app" 2>/dev/null || true
xattr -cr "$MASTER_DIR/2-DriveMate-Mac/DriveMate.app" 2>/dev/null || true
codesign --force --deep --sign - "$MASTER_DIR/2-DriveMate-Mac/DriveMate.app" 2>/dev/null || true

# Copy DMG if available
if [ -f "$WORKSPACE_ROOT/DriveMate.dmg" ]; then
    cp "$WORKSPACE_ROOT/DriveMate.dmg" "$MASTER_DIR/2-DriveMate-Mac/"
fi

cat << 'EOF' > "$MASTER_DIR/2-DriveMate-Mac/⚡-1-Click-Start-Mac.command"
#!/usr/bin/env bash
# DriveMate PRO — macOS 1-Click Launcher
# Automatically removes quarantine attribute and launches DriveMate
DIR="$(cd "$(dirname "$0")" && pwd)"
APP_PATH="$DIR/DriveMate.app"

clear
echo "=========================================================="
echo "          🚀 Launching DriveMate PRO (macOS)"
echo "=========================================================="
echo ""

if [ -d "$APP_PATH" ]; then
    echo "[*] Ensuring Gatekeeper permissions..."
    xattr -cr "$APP_PATH" 2>/dev/null || true
    codesign --force --deep --sign - "$APP_PATH" 2>/dev/null || true
    echo "[*] Opening DriveMate..."
    open "$APP_PATH"
    echo "✅ DriveMate is now running!"
else
    echo "[-] DriveMate.app not found in $DIR"
fi
EOF
chmod +x "$MASTER_DIR/2-DriveMate-Mac/⚡-1-Click-Start-Mac.command"

cat << 'EOF' > "$MASTER_DIR/2-DriveMate-Mac/🛠️-Fix-Gatekeeper-If-Blocked.command"
#!/usr/bin/env bash
# If macOS says "is damaged and can't be opened. Move to Bin", double-click this!
DIR="$(cd "$(dirname "$0")" && pwd)"
clear
echo "=========================================================="
echo "    🛡️ DriveMate macOS Gatekeeper Security Fix"
echo "=========================================================="
echo ""
echo "Removing macOS quarantine flags..."
xattr -cr "$DIR/DriveMate.app" 2>/dev/null || true
xattr -cr /Applications/DriveMate.app 2>/dev/null || true
codesign --force --deep --sign - "$DIR/DriveMate.app" 2>/dev/null || true
codesign --force --deep --sign - /Applications/DriveMate.app 2>/dev/null || true
echo ""
echo "✅ Gatekeeper permission granted successfully!"
echo ""
read -p "Press Enter to launch DriveMate now..."
open "$DIR/DriveMate.app" 2>/dev/null || open /Applications/DriveMate.app 2>/dev/null || true
EOF
chmod +x "$MASTER_DIR/2-DriveMate-Mac/🛠️-Fix-Gatekeeper-If-Blocked.command"

cat << 'EOF' > "$MASTER_DIR/2-DriveMate-Mac/README-Mac.txt"
================================================================================
                    🍎 DriveMate PRO — macOS Quick Start
================================================================================

HOW TO RUN:
Option 1: Double-click "⚡-1-Click-Start-Mac.command" to open immediately.
Option 2: Drag "DriveMate.app" into your Applications folder.

IF MACOS SAYS "DAMAGED OR CANNOT BE OPENED":
- Simply double-click "🛠️-Fix-Gatekeeper-If-Blocked.command".
- Or go to System Settings > Privacy & Security > Click "Open Anyway".

================================================================================
EOF

# 5. Assemble Chrome Extension Section (Windows & Mac)
echo "[4/6] Assembling Chrome Extension Package..."
cp -R "$WORKSPACE_ROOT/extension/dist/"* "$MASTER_DIR/3-DriveMate-Chrome-Extension/"

cat << 'EOF' > "$MASTER_DIR/3-DriveMate-Chrome-Extension/🌐-Open-Chrome-Extensions-(Windows).bat"
@echo off
start chrome "chrome://extensions"
cls
echo ==========================================================
echo        🌐 Google Chrome Extensions Page Opened
echo ==========================================================
echo.
echo 1. Turn ON 'Developer mode' in the top-right corner.
echo 2. Click 'Load unpacked' button in the top-left corner.
echo 3. Select this folder:
echo    %~dp0
echo.
echo ==========================================================
pause
EOF

cat << 'EOF' > "$MASTER_DIR/3-DriveMate-Chrome-Extension/🌐-Open-Chrome-Extensions-(Mac).command"
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
clear
echo "=========================================================="
echo "        🌐 Opening Google Chrome Extensions"
echo "=========================================================="
echo ""
open -a "Google Chrome" "chrome://extensions" 2>/dev/null || open "chrome://extensions" 2>/dev/null || true
echo "👉 Instructions:"
echo "1. Turn ON 'Developer mode' (top-right corner)."
echo "2. Click 'Load unpacked' (top-left corner)."
echo "3. Select this folder:"
echo "   $DIR"
echo ""
echo "=========================================================="
EOF
chmod +x "$MASTER_DIR/3-DriveMate-Chrome-Extension/🌐-Open-Chrome-Extensions-(Mac).command"

cat << 'EOF' > "$MASTER_DIR/3-DriveMate-Chrome-Extension/HOW-TO-INSTALL-EXTENSION.txt"
================================================================================
             🌐 DriveMate Chrome Extension Setup (Windows & Mac)
================================================================================

Setup takes 30 seconds:

1. Open Google Chrome.
2. In the address bar, type: chrome://extensions (and press Enter).
   (Or run the shortcut file for Windows/Mac in this folder).
3. In the top-right corner, turn ON "Developer mode".
4. In the top-left corner, click "Load unpacked".
5. Select this "3-DriveMate-Chrome-Extension" folder!
6. Click the Extensions puzzle icon in Chrome toolbar and Pin DriveMate.

DONE! DriveMate is now ready to download public Google Drive files.
================================================================================
EOF

# 6. Create Comprehensive Master Guides (Bangla & English + HTML)
echo "[5/6] Creating Master User Manuals..."

cat << 'EOF' > "$MASTER_DIR/📖-START-HERE-কিভাবে-চালাবেন-(BANGLA).txt"
================================================================================
                   🚀 DriveMate PRO — ব্যবহারকারী সহায়িকা (বাংলা)
          পাবলিক গুগল ড্রাইভ হাই-স্পিড ডাউনলোড সফটওয়্যার ও এক্সটেনশন
================================================================================

স্বাগতম! এই ফোল্ডারে আপনার প্রয়োজনীয় সব ভার্সন সম্পূর্ণ প্রস্তুত অবস্থায় দেওয়া আছে।
কোনো রকম ঝামেলা ছাড়াই মাত্র ১ মিনিটে চালু করতে নিচের সহজ ধাপগুলো অনুসরণ করুন:

--------------------------------------------------------------------------------
📁 ফোল্ডারের পরিচিতি:
--------------------------------------------------------------------------------
1. "1-DriveMate-Windows"          -> উইন্ডোজ (Windows) কম্পিউটার ব্যবহারকারীদের জন্য
2. "2-DriveMate-Mac"              -> অ্যাপল ম্যাক (macOS) কম্পিউটার ব্যবহারকারীদের জন্য
3. "3-DriveMate-Chrome-Extension"  -> গুগল ক্রোম এক্সটেনশন (উইন্ডোজ ও ম্যাক উভয়ের জন্য)

================================================================================
🪟 উইন্ডোজ (Windows) ব্যবহারকারীদের নিয়ম:
================================================================================
১. "1-DriveMate-Windows" ফোল্ডারে ঢুকুন।
২. "DriveMate.exe" অথবা "⚡-1-Click-Start-Windows.bat"-এ ডাবল ক্লিক করুন।
৩. সফটওয়্যার সাথে সাথে চালু হয়ে যাবে!
* টিপস: আপনি চাইলে "🛠️-Install-Desktop-Shortcut.bat"-এ ডাবল ক্লিক করে আপনার 
  ডেস্কটপে একটি সরাসরি শর্টকাট আইকন বানিয়ে নিতে পারেন।

* যদি Windows Defender SmartScreen ওয়ার্নিং দেখায়:
  - "More info" বা "অতিরিক্ত তথ্য"-তে ক্লিক করুন।
  - তারপর "Run anyway" বা "চালিয়ে যান"-এ ক্লিক করুন।

================================================================================
🍏 ম্যাক (macOS) ব্যবহারকারীদের নিয়ম:
================================================================================
১. "2-DriveMate-Mac" ফোল্ডারে ঢুকুন।
২. "⚡-1-Click-Start-Mac.command" ফাইলে ডাবল ক্লিক করুন—অ্যাপ সরাসরি ওপেন হয়ে যাবে!
   (অথবা "DriveMate.app" টি ড্র্যাগ করে আপনার Applications ফোল্ডারে রেখে দিন)।

* যদি ম্যাকওএস বলে "is damaged and can't be opened. Move to Bin":
  - চিন্তার কোনো কারণ নেই, এটি ম্যাকের সাধারণ গেটকিপার নোটিফিকেশন।
  - এই ফোল্ডারের "🛠️-Fix-Gatekeeper-If-Blocked.command" ফাইলে ডাবল ক্লিক করুন, 
    অথবা Mac-এর System Settings > Privacy & Security-তে গিয়ে "Open Anyway" ক্লিক করুন।

================================================================================
🌐 গুগল ক্রোম এক্সটেনশন (Google Chrome Extension) ইনস্টল করার নিয়ম:
(উইন্ডোজ ও ম্যাক উভয় ব্যবহারকারীদের জন্য)
================================================================================
১. আপনার গুগল ক্রোম (Google Chrome) ব্রাউজারটি ওপেন করুন।
২. ব্রাউজারের অ্যাড্রেস বারে লিখুন: chrome://extensions (এবং এন্টার চাপুন)।
৩. পেজের উপরে ডানদিকের "Developer mode" টগলটি অন (ON) করুন।
৪. পেজের উপরে বামদিকে থাকা "Load unpacked" বাটনে ক্লিক করুন।
৫. এই প্যাকেজের মধ্যে থাকা "3-DriveMate-Chrome-Extension" ফোল্ডারটি সিলেক্ট করুন।
৬. ব্রাউজারের উপরে ডানদিকের এক্সটেনশন পাজল আইকন থেকে DriveMate পিন (Pin) করে নিন।

================================================================================
🔑 PRO লাইসেন্স কী (License Key) অ্যাক্টিভেশন নিয়ম:
================================================================================
১. ব্রাউজারে বা সফটওয়্যারে DriveMate ওপেন করুন।
২. "Activate Pro License" অপশনে ক্লিক করুন।
৩. আপনার দেওয়া লাইসেন্স কী-টি (যেমন: DM-PRO-XXXX-XXXX-XXXX-XXXX) পেস্ট করুন এবং 
   "Activate" বাটনে চাপুন।
৪. সাথে সাথে আপনার অ্যাকাউন্টটি UNLIMITED লাইসেন্সে আপগ্রেড হয়ে যাবে!

যেকোনো প্রয়োজনে আমাদের সাপোর্ট টিমের সাথে যোগাযোগ করুন। ধন্যবাদ!
================================================================================
EOF

cat << 'EOF' > "$MASTER_DIR/📖-START-HERE-HOW-TO-RUN-(ENGLISH).txt"
================================================================================
                  🚀 DriveMate PRO — Complete User Guide
          High-Speed Google Drive Downloader (Windows, Mac & Chrome)
================================================================================

Welcome! Everything you need is completely pre-configured inside this folder.
Follow these quick steps to get started in less than 60 seconds:

--------------------------------------------------------------------------------
📁 FOLDER DIRECTORY:
--------------------------------------------------------------------------------
1. "1-DriveMate-Windows"          -> For Windows users (Windows 10/11)
2. "2-DriveMate-Mac"              -> For Apple macOS users (M1/M2/M3/Intel)
3. "3-DriveMate-Chrome-Extension"  -> Ready-to-use Chrome Extension (Win & Mac)

================================================================================
🪟 WINDOWS INSTRUCTIONS:
================================================================================
1. Open the "1-DriveMate-Windows" folder.
2. Double-click "DriveMate.exe" or "⚡-1-Click-Start-Windows.bat".
3. The application will start immediately.
* Optional: Double-click "🛠️-Install-Desktop-Shortcut.bat" to add a shortcut on your Desktop.

* If Windows Defender SmartScreen appears:
  - Click "More info".
  - Click "Run anyway".

================================================================================
🍏 MACOS INSTRUCTIONS:
================================================================================
1. Open the "2-DriveMate-Mac" folder.
2. Double-click "⚡-1-Click-Start-Mac.command" to launch instantly!
   (Or drag "DriveMate.app" to your Applications folder).

* If macOS shows "is damaged and can't be opened. Move to Bin":
  - This is macOS Gatekeeper's standard notice for ad-hoc apps.
  - Simply double-click "🛠️-Fix-Gatekeeper-If-Blocked.command" in the folder.
  - Or go to System Settings > Privacy & Security > Click "Open Anyway".

================================================================================
🌐 CHROME EXTENSION INSTRUCTIONS (Windows & Mac):
================================================================================
1. Open Google Chrome.
2. In the address bar, type: chrome://extensions (and press Enter).
3. Toggle ON "Developer mode" in the top-right corner.
4. Click the "Load unpacked" button in the top-left corner.
5. Select the "3-DriveMate-Chrome-Extension" folder.
6. Pin DriveMate to your Chrome toolbar from the puzzle icon.

================================================================================
🔑 HOW TO ACTIVATE YOUR PRO LICENSE:
================================================================================
1. Open DriveMate.
2. Click "Activate Pro License".
3. Paste your 16-character license key (e.g. DM-PRO-XXXX-XXXX-XXXX-XXXX).
4. Click "Activate" — your daily quota is now UNLIMITED!

Enjoy unlimited high-speed Google Drive downloads!
================================================================================
EOF

cat << 'EOF' > "$MASTER_DIR/📖-QUICK-GUIDE.html"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>DriveMate PRO — Quick Start Guide</title>
  <style>
    :root { --bg: #0f172a; --card: #1e293b; --text: #f8fafc; --muted: #94a3b8; --primary: #38bdf8; --success: #34d399; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 40px 20px; line-height: 1.6; max-width: 900px; margin: 0 auto; }
    h1 { font-size: 28px; color: var(--primary); margin-bottom: 8px; display: flex; align-items: center; gap: 12px; }
    .subtitle { color: var(--muted); margin-bottom: 30px; font-size: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .card { background: var(--card); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 24px; }
    .card-title { font-size: 18px; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; color: #fff; }
    .step-list { padding-left: 20px; margin: 0; }
    .step-list li { margin-bottom: 10px; color: #cbd5e1; font-size: 14px; }
    .badge { display: inline-block; background: rgba(56, 189, 248, 0.15); color: var(--primary); padding: 3px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
    .alert-box { background: rgba(52, 211, 153, 0.1); border-left: 4px solid var(--success); padding: 16px; border-radius: 8px; margin-top: 20px; }
    code { background: rgba(0,0,0,0.4); padding: 2px 6px; border-radius: 4px; font-family: monospace; color: var(--primary); }
  </style>
</head>
<body>
  <h1>🚀 DriveMate PRO — Complete Quick Start Guide</h1>
  <div class="subtitle">High-Speed Google Drive Downloader • Zero Login Required • Unlimited Downloads</div>

  <div class="grid">
    <div class="card">
      <span class="badge">WINDOWS 10 / 11</span>
      <div class="card-title">🪟 Windows Setup</div>
      <ol class="step-list">
        <li>Open folder: <code>1-DriveMate-Windows</code></li>
        <li>Double-click <code>⚡-1-Click-Start-Windows.bat</code> or <code>DriveMate.exe</code></li>
        <li>Optional: Run <code>🛠️-Install-Desktop-Shortcut.bat</code> to place on your Desktop.</li>
      </ol>
    </div>

    <div class="card">
      <span class="badge">APPLE SILICON & INTEL</span>
      <div class="card-title">🍏 macOS Setup</div>
      <ol class="step-list">
        <li>Open folder: <code>2-DriveMate-Mac</code></li>
        <li>Double-click <code>⚡-1-Click-Start-Mac.command</code></li>
        <li>If blocked by Gatekeeper: Run <code>🛠️-Fix-Gatekeeper-If-Blocked.command</code></li>
      </ol>
    </div>

    <div class="card">
      <span class="badge">WIN & MAC CHROME</span>
      <div class="card-title">🌐 Chrome Extension</div>
      <ol class="step-list">
        <li>Open Chrome and navigate to <code>chrome://extensions</code></li>
        <li>Turn ON <b>Developer mode</b> (top-right).</li>
        <li>Click <b>Load unpacked</b> and select <code>3-DriveMate-Chrome-Extension</code></li>
        <li>Pin DriveMate to your toolbar!</li>
      </ol>
    </div>
  </div>

  <div class="alert-box">
    <b style="color: var(--success);">🔑 Pro License Activation:</b><br>
    Click on <b>Activate Pro License</b> inside the app or extension, paste your 16-character license key (e.g. <code>DM-PRO-XXXX-XXXX-XXXX-XXXX</code>), and click Activate to unlock unlimited downloads!
  </div>
</body>
</html>
EOF

# 7. Package ZIP Archives
echo "[6/6] Generating clean, cross-platform ZIP files..."
export COPYFILE_DISABLE=1

# Clean hidden metadata
find "$MASTER_DIR" -name "._*" -delete 2>/dev/null || true
find "$MASTER_DIR" -name ".DS_Store" -delete 2>/dev/null || true

# A. Complete Master Package (Windows + Mac + Extension)
echo "  -> Packaging 👉-SEND-THIS-TO-BUYER-DriveMate.zip..."
rm -f "$WORKSPACE_ROOT/👉-SEND-THIS-TO-BUYER-DriveMate.zip"
zip -r -q "$WORKSPACE_ROOT/👉-SEND-THIS-TO-BUYER-DriveMate.zip" "👉-SEND-THIS-TO-BUYER-DriveMate" -x "*.DS_Store" "*._*" "*__MACOSX*"

# B. Dedicated Windows + Extension Package
echo "  -> Packaging 👉-SEND-THIS-TO-BUYER-DriveMate-Windows.zip..."
TEMP_WIN="$WORKSPACE_ROOT/scratch/temp_win_pkg"
rm -rf "$TEMP_WIN"
mkdir -p "$TEMP_WIN/DriveMate-Windows"
cp -R "$MASTER_DIR/1-DriveMate-Windows/"* "$TEMP_WIN/DriveMate-Windows/"
cp -R "$MASTER_DIR/3-DriveMate-Chrome-Extension" "$TEMP_WIN/"
cp "$MASTER_DIR/📖-START-HERE-কিভাবে-চালাবেন-(BANGLA).txt" "$TEMP_WIN/"
cp "$MASTER_DIR/📖-START-HERE-HOW-TO-RUN-(ENGLISH).txt" "$TEMP_WIN/"
cp "$MASTER_DIR/📖-QUICK-GUIDE.html" "$TEMP_WIN/"
find "$TEMP_WIN" -name "._*" -delete 2>/dev/null || true
find "$TEMP_WIN" -name ".DS_Store" -delete 2>/dev/null || true
rm -f "$WORKSPACE_ROOT/👉-SEND-THIS-TO-BUYER-DriveMate-Windows.zip"
(cd "$WORKSPACE_ROOT/scratch" && zip -r -q "$WORKSPACE_ROOT/👉-SEND-THIS-TO-BUYER-DriveMate-Windows.zip" "temp_win_pkg" -x "*.DS_Store" "*._*" "*__MACOSX*")
rm -rf "$TEMP_WIN"

# C. Dedicated Mac + Extension Package
echo "  -> Packaging 👉-SEND-THIS-TO-BUYER-DriveMate-Mac.zip..."
TEMP_MAC="$WORKSPACE_ROOT/scratch/temp_mac_pkg"
rm -rf "$TEMP_MAC"
mkdir -p "$TEMP_MAC/DriveMate-Mac"
cp -R "$MASTER_DIR/2-DriveMate-Mac/"* "$TEMP_MAC/DriveMate-Mac/"
cp -R "$MASTER_DIR/3-DriveMate-Chrome-Extension" "$TEMP_MAC/"
cp "$MASTER_DIR/📖-START-HERE-কিভাবে-চালাবেন-(BANGLA).txt" "$TEMP_MAC/"
cp "$MASTER_DIR/📖-START-HERE-HOW-TO-RUN-(ENGLISH).txt" "$TEMP_MAC/"
cp "$MASTER_DIR/📖-QUICK-GUIDE.html" "$TEMP_MAC/"
find "$TEMP_MAC" -name "._*" -delete 2>/dev/null || true
find "$TEMP_MAC" -name ".DS_Store" -delete 2>/dev/null || true
rm -f "$WORKSPACE_ROOT/👉-SEND-THIS-TO-BUYER-DriveMate-Mac.zip"
(cd "$WORKSPACE_ROOT/scratch" && zip -r -q "$WORKSPACE_ROOT/👉-SEND-THIS-TO-BUYER-DriveMate-Mac.zip" "temp_mac_pkg" -x "*.DS_Store" "*._*" "*__MACOSX*")
rm -rf "$TEMP_MAC"

echo ""
echo "=================================================================="
echo "  ✅ ALL BUYER PACKAGES BUILT SUCCESSFULLY!"
echo "=================================================================="
ls -lh "$WORKSPACE_ROOT"/👉-SEND-THIS-TO-BUYER-*.zip
