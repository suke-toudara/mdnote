#!/usr/bin/env bash
# ローカル版 mdnote を再ビルドし、現在のユーザーのアプリ一覧に反映する。
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
./install.sh
if pgrep -x mdnote >/dev/null; then
  echo "起動中の mdnote は古い版のままです。保存して閉じ、アプリ一覧から開き直してください。"
fi
