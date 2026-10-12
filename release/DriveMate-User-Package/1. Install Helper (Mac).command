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
