#!/usr/bin/env bash
# DriveMate Native — macOS 1-Click Launcher
# Double-click in Finder to launch DriveMate Native on Mac!

DIR="$(cd "$(dirname "$0")" && pwd)"
clear
echo "=========================================================="
echo "      DriveMate Native — Standalone Google Drive Downloader"
echo "=========================================================="
echo ""
echo "[*] Launching DriveMate Native desktop application..."
echo ""

chmod +x "$DIR/DriveMate.app/Contents/MacOS/DriveMate" 2>/dev/null
xattr -cr "$DIR/DriveMate.app" 2>/dev/null

open "$DIR/DriveMate.app"
echo "[+] DriveMate Native is running!"
