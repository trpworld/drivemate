#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_SRC="/tmp/drivemate-tauri-target/release/bundle/macos/DriveMate.app"
if [ ! -d "$APP_SRC" ]; then
  APP_SRC="$SCRIPT_DIR/DriveMate.app"
fi

STAGING_DIR="/tmp/drivemate-dmg-staging"
OUTPUT_DMG="$SCRIPT_DIR/DriveMate.dmg"
RELEASE_DMG="$SCRIPT_DIR/release/DriveMate.dmg"
BG_IMG="$SCRIPT_DIR/desktop/dmg-background.png"
ICON_FILE="$SCRIPT_DIR/desktop/src-tauri/icons/icon.icns"
BUNDLE_DMG_SH="/tmp/drivemate-tauri-target/release/bundle/dmg/bundle_dmg.sh"

echo "=========================================================="
echo "   🚀 Building Professional Drag-and-Drop macOS DMG"
echo "=========================================================="

# 1. Ensure background image exists
if [ ! -f "$BG_IMG" ]; then
  echo "[*] Generating DMG installer background image..."
  node "$SCRIPT_DIR/scripts/create_dmg_background.js" "$BG_IMG"
fi

# 2. Prepare staging folder
echo "[*] Preparing staging directory..."
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
cp -R "$APP_SRC" "$STAGING_DIR/DriveMate.app"

# Remove any macOS AppleDouble junk from staging
find "$STAGING_DIR" -name "._*" -delete 2>/dev/null || true
find "$STAGING_DIR" -name ".DS_Store" -delete 2>/dev/null || true

# 3. Remove existing DMG if any
rm -f "$OUTPUT_DMG" "$OUTPUT_DMG.temp" /tmp/rw.*.DriveMate.dmg 2>/dev/null || true

# 4. Execute create-dmg script
echo "[*] Executing create-dmg with layout coordinates & arrow..."
bash "$BUNDLE_DMG_SH" \
  --volname "DriveMate" \
  --volicon "$ICON_FILE" \
  --background "$BG_IMG" \
  --window-pos 400 200 \
  --window-size 660 400 \
  --icon-size 128 \
  --icon "DriveMate.app" 180 170 \
  --app-drop-link 480 170 \
  --hide-extension "DriveMate.app" \
  "$OUTPUT_DMG" \
  "$STAGING_DIR"

# 5. Mirror to release directory
cp -f "$OUTPUT_DMG" "$RELEASE_DMG"
cp -f "$OUTPUT_DMG" "$SCRIPT_DIR/release/DriveMate_1.0.0_aarch64.dmg"

echo "=========================================================="
echo "  ✅ SUCCESS: Drag-and-Drop DMG Created Successfully!"
echo "     File: $OUTPUT_DMG"
echo "     Size: $(du -h "$OUTPUT_DMG" | awk '{print $1}')"
echo "=========================================================="
