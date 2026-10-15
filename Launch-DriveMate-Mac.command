#!/usr/bin/env bash
# DriveMate Native — macOS 1-Click Launcher & Gatekeeper Healer
DIR="$(cd "$(dirname "$0")" && pwd)"
clear
echo "=========================================================="
echo "   🚀 DriveMate Native — macOS 1-Click Launcher"
echo "=========================================================="
echo ""

APP_PATH=""
if [ -d "$DIR/DriveMate.app" ]; then
    APP_PATH="$DIR/DriveMate.app"
elif [ -d "/Applications/DriveMate.app" ]; then
    APP_PATH="/Applications/DriveMate.app"
elif [ -d "$HOME/Applications/DriveMate.app" ]; then
    APP_PATH="$HOME/Applications/DriveMate.app"
elif [ -d "$HOME/Desktop/DriveMate.app" ]; then
    APP_PATH="$HOME/Desktop/DriveMate.app"
fi

if [ -z "$APP_PATH" ]; then
    echo "[-] DriveMate.app not found. Please drag DriveMate.app to Applications."
    echo "    Or place DriveMate.app in this same folder."
    read -p "Press Enter to exit..."
    exit 1
fi

echo "[*] Unlocking macOS Gatekeeper quarantine for: $APP_PATH"
xattr -cr "$APP_PATH" 2>/dev/null || true
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
chmod +x "$APP_PATH/Contents/MacOS/DriveMate" 2>/dev/null || true

# Refresh local ad-hoc signature if needed
codesign --force --deep -s - "$APP_PATH" 2>/dev/null || true

echo "[*] Launching DriveMate Native..."
open "$APP_PATH"
echo ""
echo "✅ DriveMate Native is now running!"
sleep 2
