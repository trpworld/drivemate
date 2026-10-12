#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

clear
echo "=========================================================="
echo "      🚀 DriveMate: 1-Click Automatic GitHub Uploader"
echo "=========================================================="
echo ""

# 1. Check if logged into GitHub CLI
if ! gh auth status >/dev/null 2>&1; then
  echo "[1/3] GitHub লগইন প্রয়োজন..."
  echo "👉 ব্রাউজার ওপেন হবে। শুধু স্ক্রিনে দেখানো কোডটি দিয়ে 'Authorize' বাটনে চাপুন।"
  echo ""
  gh auth login --web -p https -h github.com
fi

echo ""
echo "[2/3] GitHub ক্রেডেনশিয়াল সফলভাবে কানেক্ট হয়েছে!"
USERNAME=$(gh api user --jq .login 2>/dev/null || echo "gobindabiswas")
echo "      ইউজার: $USERNAME"
echo ""

# 2. Check if repo exists or create it
echo "[3/3] GitHub-এ রিপোজিটরি তৈরি ও কোড পুশ করা হচ্ছে..."
if gh repo view "$USERNAME/drivemate" >/dev/null 2>&1; then
  echo "      'drivemate' রিপোজিটরি ইতিমধ্যে বিদ্যমান।"
  git remote set-url origin "https://github.com/$USERNAME/drivemate.git"
  git push -u origin main
else
  echo "      নতুন পাবলিক রিপোজিটরি তৈরি হচ্ছে: $USERNAME/drivemate ..."
  gh repo create "drivemate" --public --source=. --remote=origin --push
fi

echo ""
echo "=========================================================="
echo "  🎉 অভিনন্দন! সম্পূর্ণ DriveMate কোডবেস GitHub-এ আপলোড সম্পন্ন!"
echo "  🌐 রিপোজিটরি লিংক: https://github.com/$USERNAME/drivemate"
echo "=========================================================="
echo ""
read -p "উইন্ডো বন্ধ করতে [Enter] চাপুন..."
