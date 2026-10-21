#!/usr/bin/env bash
# MD Editor の起動スクリプト
#
#   ./start.sh [ファイル.md]          アプリを起動する (ソースが更新されていれば先にビルドする)
#   ./start.sh --dev [ファイル.md]    開発モード (ホットリロード) で起動する
#   ./start.sh --build                ビルドだけ行う
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

BIN=src-tauri/target/release/md-editor
LOG="${XDG_STATE_HOME:-$HOME/.local/state}/md-editor.log"

mode=run
case "${1:-}" in
  --dev) mode=dev; shift ;;
  --build) mode=build; shift ;;
  -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac

# 相対パスで渡されたファイルは、cd する前の場所を基準に解決する
files=()
for f in "$@"; do
  files+=("$(cd "$OLDPWD" && readlink -f -- "$f")")
done

if [ ! -d node_modules ]; then
  echo "依存パッケージをインストールしています..."
  npm install
fi

if [ "$mode" = dev ]; then
  exec npx tauri dev -- -- "${files[@]}"
fi

needs_build() {
  [ ! -x "$BIN" ] && return 0
  [ -n "$(find index.html package.json src public src-tauri/src src-tauri/capabilities \
    src-tauri/tauri.conf.json src-tauri/Cargo.toml -newer "$BIN" -print -quit 2>/dev/null)" ]
}

if [ "$mode" = build ] || needs_build; then
  echo "ビルドしています (初回や更新後は数分かかります)..."
  npx tauri build --no-bundle
fi

[ "$mode" = build ] && exit 0

mkdir -p "$(dirname "$LOG")"
nohup "$BIN" "${files[@]}" >"$LOG" 2>&1 &
disown
echo "MD Editor を起動しました (ログ: $LOG)"
