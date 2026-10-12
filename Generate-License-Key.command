#!/usr/bin/env bash
# DriveMate PRO — 1-Click License Key Generator for macOS
# Double-click to generate a key and automatically copy to clipboard!

DIR="$(cd "$(dirname "$0")" && pwd)"
clear
echo "=========================================================="
echo "      🔑 DriveMate PRO — 1-Click License Generator"
echo "=========================================================="
echo ""

KEY=$(python3 "$DIR/scripts/generate_license.py" | grep "License Key:" | head -n 1 | awk '{print $3}')

if [ -n "$KEY" ]; then
  # Copy to Mac clipboard
  echo -n "$KEY" | pbcopy
  echo "✅ NEW LICENSE KEY GENERATED:"
  echo ""
  echo "    👉  \033[1;32m$KEY\033[0m  👈"
  echo ""
  echo "📋 [COPIED TO CLIPBOARD!] Direct paste with Cmd + V"
  echo "💬 Send this key to your buyer on WhatsApp or Messenger."
  echo ""
else
  echo "[-] Failed to generate key. Ensure python3 is available."
fi

echo "=========================================================="
echo "Press [ENTER] to exit..."
read -r
