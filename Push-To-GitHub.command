#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

clear
echo "=========================================================="
echo "          🚀 Push DriveMate Codebase to GitHub"
echo "=========================================================="
echo ""
echo "Remote Repository: https://github.com/gobindabiswas/drivemate.git"
echo "Local Branch:      main"
echo ""
echo "👉 ধাপ ১: আপনি যদি এখনও GitHub-এ 'drivemate' রিপোজিটরিটি তৈরি না করে থাকেন,"
echo "          তবে নিচের লিংকে গিয়ে একটি নতুন রিপোজিটরি তৈরি করুন:"
echo "          URL: https://github.com/new"
echo "          Repository name: drivemate"
echo "          (Public অথবা Private যেকোনো একটি সিলেক্ট করুন)"
echo ""
echo "----------------------------------------------------------"
read -p "GitHub-এ 'drivemate' তৈরি করা হয়ে গেলে [Enter] চাপুন..."
echo ""

echo "[*] গিটহাবে কোড পুশ করা হচ্ছে..."
echo "👉 দ্রষ্টব্য: GitHub পাসওয়ার্ডের জায়গায় আপনার Personal Access Token (PAT) চাইবে।"
echo "   (Token না থাকলে: GitHub Settings > Developer Settings > Personal access tokens > Tokens (classic) > Generate new token [repo tick])"
echo ""

git push -u origin main

echo ""
echo "=========================================================="
echo "      ✅ কোড সফলভাবে GitHub-এ আপলোড সম্পন্ন হয়েছে!"
echo "      রিপোজিটরি লিংক: https://github.com/gobindabiswas/drivemate"
echo "=========================================================="
echo ""
read -p "উইন্ডোটি বন্ধ করতে [Enter] চাপুন..."
