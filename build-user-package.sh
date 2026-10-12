#!/usr/bin/env bash
set -euo pipefail

# DriveMate: Build Self-Contained End-User Distribution Package
# For Direct Distribution via Personal Website / Facebook / Blog / Drive / GitHub

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$SCRIPT_DIR/extension/dist"
HELPER_BIN="$SCRIPT_DIR/native-helper/.build/release/DriveMateHelper"
PACKAGE_ROOT="$SCRIPT_DIR/release/DriveMate-User-Package"
OUTPUT_ZIP="$SCRIPT_DIR/release/DriveMate-User-Package.zip"

echo "=========================================================="
echo "  Building DriveMate End-User Distribution Package"
echo "=========================================================="

# 1. Compile extension dist
echo "[*] Building extension frontend..."
(cd "$SCRIPT_DIR/extension" && npm run build)

# 2. Check helper binary
if [ ! -f "$HELPER_BIN" ]; then
  echo "[-] Helper binary not found at $HELPER_BIN"
  exit 1
fi

# 3. Clean and prepare packaging directory
echo "[*] Assembling package structure..."
rm -rf "$PACKAGE_ROOT" "$OUTPUT_ZIP"
mkdir -p "$PACKAGE_ROOT"
mkdir -p "$PACKAGE_ROOT/DriveMate-Extension"
mkdir -p "$PACKAGE_ROOT/Helper-Engine"

# 4. Copy Extension Files
echo "[*] Copying extension production assets..."
cp -R "$DIST_DIR/"* "$PACKAGE_ROOT/DriveMate-Extension/"

# 5. Copy Native Helper Binary
echo "[*] Copying native helper engine..."
cp "$HELPER_BIN" "$PACKAGE_ROOT/Helper-Engine/DriveMateHelper"
chmod +x "$PACKAGE_ROOT/Helper-Engine/DriveMateHelper"

# 6. Create Mac One-Click Installer Command
cat << 'EOF' > "$PACKAGE_ROOT/1. Install Helper (Mac).command"
#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
APP_SUP="$HOME/Library/Application Support/DriveMate"
HELPER_SRC="$DIR/Helper-Engine/DriveMateHelper"
EXT_DIR="$DIR/DriveMate-Extension"
DEFAULT_EXT_ID="nhnlodcpjfepoegoemhhmhckmjgalnha"

clear
echo "=========================================================="
echo "         🚀 DriveMate Engine Setup for macOS"
echo "=========================================================="
echo ""

# 1. Install Helper to Application Support
echo "[1/3] Installing DriveMate Helper Engine..."
mkdir -p "$APP_SUP"
cp -f "$HELPER_SRC" "$APP_SUP/DriveMateHelper"
chmod +x "$APP_SUP/DriveMateHelper"
xattr -d com.apple.quarantine "$APP_SUP/DriveMateHelper" 2>/dev/null || true
codesign --force --sign - "$APP_SUP/DriveMateHelper" 2>/dev/null || true
echo "      ✅ Helper engine installed to: $APP_SUP/DriveMateHelper"

# 2. Register Chrome Native Messaging Host
echo "[2/3] Registering browser bridges (Chrome, Brave, Edge)..."
TARGET_DIRS=(
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
)

MANIFEST_CONTENT=$(cat <<MANIFEST_EOF
{
  "name": "com.drivemate.helper",
  "description": "DriveMate High-Speed Native Download Helper",
  "path": "$APP_SUP/DriveMateHelper",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$DEFAULT_EXT_ID/"
  ]
}
MANIFEST_EOF
)

for target_dir in "${TARGET_DIRS[@]}"; do
  mkdir -p "$target_dir"
  echo "$MANIFEST_CONTENT" > "$target_dir/com.drivemate.helper.json"
done
echo "      ✅ Native Messaging bridge registered successfully."

# 3. Next steps instructions
echo "[3/3] Final Step: Activate Extension in Chrome"
echo ""
echo "=========================================================="
echo "               🎉 SETUP COMPLETED!"
echo "=========================================================="
echo ""
echo "👉 এক্সটেনশন চালু করতে নিচের ২টি কাজ করুন:"
echo "   1. গুগল ক্রোমে যান এবং অ্যাড্রেস বারে লিখুন: chrome://extensions"
echo "   2. উপরের ডানপাশের 'Developer mode' অন (ON) করুন।"
echo "   3. বামপাশের 'Load unpacked' বাটনে ক্লিক করে এই প্যাকেজের"
echo "      'DriveMate-Extension' ফোল্ডারটি সিলেক্ট করুন।"
echo ""
echo "   ফোল্ডার পাথ:"
echo "   $EXT_DIR"
echo "=========================================================="
echo ""

read -p "আপনি কি এখন Google Chrome Extensions পেজটি খুলতে চান? (y/n): " answer
if [[ "$answer" =~ ^[Yy]$ ]]; then
  open -a "Google Chrome" "chrome://extensions" 2>/dev/null || open "chrome://extensions" 2>/dev/null || true
fi

echo ""
echo "সব প্রস্তুত! এই উইন্ডোটি বন্ধ করতে পারেন।"
echo ""
EOF
chmod +x "$PACKAGE_ROOT/1. Install Helper (Mac).command"

# 7. Create Quick Chrome Extensions Opener Command
cat << 'EOF' > "$PACKAGE_ROOT/2. Open Chrome Extensions.command"
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$DIR/DriveMate-Extension"

clear
echo "=========================================================="
echo "          🌐 Open Chrome Extensions Page"
echo "=========================================================="
echo ""
echo "Opening chrome://extensions in Google Chrome..."
open -a "Google Chrome" "chrome://extensions" 2>/dev/null || open "chrome://extensions" 2>/dev/null || true

echo ""
echo "👉 ইনস্ট্রাকশন:"
echo "1. উপরের ডানপাশের 'Developer mode' টগলটি ON করুন।"
echo "2. বামপাশে 'Load unpacked' বাটনে ক্লিক করুন।"
echo "3. এই ফোল্ডারটি সিলেক্ট করুন:"
echo "   $EXT_DIR"
echo ""
echo "=========================================================="
EOF
chmod +x "$PACKAGE_ROOT/2. Open Chrome Extensions.command"

# 8. Create Bengali Installation Guide
cat << 'EOF' > "$PACKAGE_ROOT/INSTALL_GUIDE_BANGLA.txt"
================================================================================
                    🚀 DriveMate ইনস্টলেশন গাইড (বাংলা)
          পাবলিক গুগল ড্রাইভ থেকে হাই-স্পিড ডাউনলোড এক্সটেনশন
================================================================================

DriveMate সেটআপ করতে মাত্র ১ মিনিট সময় লাগবে। নিচের ৩টি সহজ ধাপ অনুসরণ করুন:

--------------------------------------------------------------------------------
ধাপ ১: নেটিভ ইঞ্জিন ইনস্টল (এক ক্লিকে)
--------------------------------------------------------------------------------
এই ফোল্ডারে থাকা "1. Install Helper (Mac).command" ফাইলে ডাবল-ক্লিক (Double-click) করুন।
একটি টার্মিনাল উইন্ডো খুলবে এবং সফলভাবে নেটিভ হেল্পার ইনস্টল হয়ে যাবে।
(প্রম্পট আসলে কীবোর্ডে 'y' চেপে এন্টার দিতে পারেন)।

--------------------------------------------------------------------------------
ধাপ ২: ক্রোম এক্সটেনশন লোড করুন
--------------------------------------------------------------------------------
১. আপনার গুগল ক্রোম (Google Chrome) ব্রাউজার ওপেন করুন।
২. অ্যাড্রেস বারে লিখুন: chrome://extensions (এবং এন্টার চাপুন)।
   (অথবা এই ফোল্ডারের "2. Open Chrome Extensions.command" ফাইলে ডাবল-ক্লিক করুন)।
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

# 9. Create English Installation Guide
cat << 'EOF' > "$PACKAGE_ROOT/INSTALL_GUIDE_ENGLISH.txt"
================================================================================
                    🚀 DriveMate Quick Installation Guide
           High-Speed Public Google Drive Downloader (Zero Login)
================================================================================

Setup takes less than 1 minute. Follow these 3 easy steps:

--------------------------------------------------------------------------------
STEP 1: Install Local Native Engine
--------------------------------------------------------------------------------
Double-click on "1. Install Helper (Mac).command" in this folder.
A terminal window will open and automatically configure the high-speed helper engine.
Press 'y' when prompted to launch Chrome.

--------------------------------------------------------------------------------
STEP 2: Load Extension in Google Chrome
--------------------------------------------------------------------------------
1. Open Google Chrome.
2. In the address bar, type: chrome://extensions (and press Enter).
   (Or double-click "2. Open Chrome Extensions.command").
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

# 10. Create Package Readme
cat << 'EOF' > "$PACKAGE_ROOT/README.md"
# DriveMate — Standalone Distribution Package

This package allows macOS users to run DriveMate directly without installing from the Chrome Web Store.

### Contents:
- `1. Install Helper (Mac).command` — Auto-installs and registers the native helper engine.
- `2. Open Chrome Extensions.command` — Quick shortcut to open Chrome's extension management page.
- `DriveMate-Extension/` — Production build of the Chrome extension (Manifest V3).
- `Helper-Engine/DriveMateHelper` — Precompiled Apple Silicon / macOS native engine.
- `INSTALL_GUIDE_BANGLA.txt` — Bangla step-by-step installation instructions.
- `INSTALL_GUIDE_ENGLISH.txt` — English step-by-step installation instructions.
EOF

# 11. Pack into Clean ZIP without macOS AppleDouble resource forks
echo "[*] Cleaning hidden metadata files..."
find "$PACKAGE_ROOT" -name "._*" -delete 2>/dev/null || true
find "$PACKAGE_ROOT" -name ".DS_Store" -delete 2>/dev/null || true

echo "[*] Creating final user ZIP package..."
export COPYFILE_DISABLE=1
(cd "$SCRIPT_DIR/release" && zip -r -q "DriveMate-User-Package.zip" "DriveMate-User-Package" -x "*.DS_Store" "*._*" "*__MACOSX*")

echo "[+] Done!"
echo "    Package ZIP: $OUTPUT_ZIP"
echo "    Unpacked:    $PACKAGE_ROOT"
