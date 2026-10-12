#!/usr/bin/env bash
set -euo pipefail

# DriveMate Phase 1: Native Messaging Host Installer for macOS Chrome & Chromium Browsers
# Usage: ./install-host.sh [OPTIONAL_CUSTOM_EXTENSION_ID]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPER_BIN="$WORKSPACE_ROOT/native-helper/.build/release/DriveMateHelper"

DEFAULT_EXT_ID="nhnlodcpjfepoegoemhhmhckmjgalnha"
CUSTOM_EXT_ID="${1:-}"

echo "=========================================================="
echo "  DriveMate — Native Messaging Host Registration"
echo "=========================================================="

# 1. Verify Helper Binary
if [ ! -f "$HELPER_BIN" ]; then
  echo "[-] ERROR: Helper binary not found at:"
  echo "    $HELPER_BIN"
  echo "    Attempting to build with 'swift build -c release'..."
  (cd "$WORKSPACE_ROOT/native-helper" && swift build -c release)
fi

chmod +x "$HELPER_BIN"
echo "[+] Helper binary verified: $HELPER_BIN"

# 2. Ad-hoc Code Signing & Attributes Clean
echo "[*] Ensuring ad-hoc code signature and clean attributes..."
xattr -d com.apple.quarantine "$HELPER_BIN" 2>/dev/null || true
codesign --force --sign - "$HELPER_BIN" 2>/dev/null || true
echo "[+] Code signature verified."

# 3. Target browser directories for macOS
TARGET_DIRS=(
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
)

# Build allowed origins list
ORIGINS="\"chrome-extension://$DEFAULT_EXT_ID/\""
if [ -n "$CUSTOM_EXT_ID" ] && [ "$CUSTOM_EXT_ID" != "$DEFAULT_EXT_ID" ]; then
  ORIGINS="$ORIGINS,
    \"chrome-extension://$CUSTOM_EXT_ID/\""
fi

MANIFEST_CONTENT=$(cat <<EOF
{
  "name": "com.drivemate.helper",
  "description": "DriveMate High-Speed Native Download Helper",
  "path": "$HELPER_BIN",
  "type": "stdio",
  "allowed_origins": [
    $ORIGINS
  ]
}
EOF
)

# 4. Install into each target browser directory
for DIR in "${TARGET_DIRS[@]}"; do
  mkdir -p "$DIR"
  TARGET_MANIFEST="$DIR/com.drivemate.helper.json"
  echo "$MANIFEST_CONTENT" > "$TARGET_MANIFEST"
  chmod 644 "$TARGET_MANIFEST"
  echo "[+] Installed manifest to: $TARGET_MANIFEST"
done

# Also save copy in host-manifest folder
echo "$MANIFEST_CONTENT" > "$SCRIPT_DIR/com.drivemate.helper.json"

echo "=========================================================="
echo "[+] Native Messaging Host registration completed successfully across all browsers."
