#!/usr/bin/env bash
# mdnote をアプリケーション一覧に登録する (sudo 不要、このユーザーだけに入る)
#
#   ./install.sh               ビルドしてアプリ一覧・「このアプリで開く」に登録する
#   ./install.sh --uninstall   登録を解除する
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
APPS="$DATA/applications"
ICONS="$DATA/icons/hicolor"
DESKTOP="$APPS/mdnote.desktop"
BIN="$PWD/src-tauri/target/release/mdnote"
SIZES=(32 64 128 256 512)

refresh() {
  update-desktop-database "$APPS" 2>/dev/null || true
  gtk-update-icon-cache -f -t "$ICONS" 2>/dev/null || true
}

if [ "${1:-}" = --uninstall ]; then
  rm -f "$DESKTOP" "$ICONS/scalable/apps/mdnote.svg"
  for s in "${SIZES[@]}"; do rm -f "$ICONS/${s}x${s}/apps/mdnote.png"; done
  refresh
  echo "mdnote の登録を解除しました"
  exit 0
fi

./start.sh --build

mkdir -p "$APPS"
# 以前の SVG より、新しい PNG アイコンを優先する。
rm -f "$ICONS/scalable/apps/mdnote.svg"
for s in "${SIZES[@]}"; do
  mkdir -p "$ICONS/${s}x${s}/apps"
  case "$s" in
    256) icon=src-tauri/icons/128x128@2x.png ;;
    512) icon=src-tauri/icons/icon.png ;;
    *) icon="src-tauri/icons/${s}x${s}.png" ;;
  esac
  install -m 644 "$icon" "$ICONS/${s}x${s}/apps/mdnote.png"
done

cat >"$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=mdnote
GenericName=Markdown エディタ
Comment=プレビューのまま編集できる Markdown エディタ
Exec="$BIN" %F
Icon=mdnote
Terminal=false
Categories=Utility;TextEditor;
MimeType=text/markdown;text/x-markdown;
Keywords=markdown;md;editor;メモ;
StartupWMClass=mdnote
EOF

refresh
echo "mdnote をアプリケーション一覧に登録しました"
echo "  .md ファイルを右クリック →「別のアプリケーションで開く」からも選べます"
