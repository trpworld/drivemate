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
