#!/usr/bin/env bash
set -euo pipefail

# DriveMate — Chrome Web Store Production Package Builder
# Builds the production bundle and creates a compliant ZIP archive for the Chrome Developer Dashboard.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$SCRIPT_DIR/extension"
DIST_DIR="$EXTENSION_DIR/dist"
OUTPUT_DIR="$SCRIPT_DIR/release"
PACKAGE_NAME="drivemate-extension-v0.3.0.zip"
TARGET_ZIP="$OUTPUT_DIR/$PACKAGE_NAME"

echo "=========================================================="
echo "  DriveMate — Packaging for Chrome Web Store"
echo "=========================================================="

# 1. Clean & Build Extension
echo "[*] Compiling TypeScript & building distribution with Vite..."
(cd "$EXTENSION_DIR" && npm run typecheck && npm run build)

# 2. Verify dist contents
if [ ! -f "$DIST_DIR/manifest.json" ]; then
  echo "[-] ERROR: $DIST_DIR/manifest.json not found."
  exit 1
fi

if [ ! -f "$DIST_DIR/popup.html" ]; then
  echo "[-] ERROR: $DIST_DIR/popup.html not found."
  exit 1
fi

if [ ! -f "$DIST_DIR/icons/icon-128.png" ]; then
  echo "[-] ERROR: $DIST_DIR/icons/icon-128.png not found."
  exit 1
fi

# 3. Create Release output directory
mkdir -p "$OUTPUT_DIR"
rm -f "$TARGET_ZIP"

# 4. Create Clean ZIP archive directly from dist/
echo "[*] Creating production ZIP package: $PACKAGE_NAME..."
(
  cd "$DIST_DIR"
  zip -r -q "$TARGET_ZIP" . -x "*.DS_Store" "*._*" "*Thumbs.db"
)

echo "[+] ZIP Package created successfully!"
echo "    File: $TARGET_ZIP"
echo "    Size: $(du -h "$TARGET_ZIP" | cut -f1)"
echo ""
echo "[*] Verifying ZIP archive structure:"
unzip -l "$TARGET_ZIP" | head -n 25

echo "=========================================================="
echo "[+] Package is 100% ready for upload to Chrome Developer Dashboard."
