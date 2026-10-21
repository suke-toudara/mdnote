#!/usr/bin/env bash
# MD Editor をアプリケーション一覧に登録する (sudo 不要、このユーザーだけに入る)
#
#   ./install.sh               ビルドしてアプリ一覧・「このアプリで開く」に登録する
#   ./install.sh --uninstall   登録を解除する
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
APPS="$DATA/applications"
ICONS="$DATA/icons/hicolor"
DESKTOP="$APPS/md-editor.desktop"
BIN="$PWD/src-tauri/target/release/md-editor"
SIZES=(32 64 128 256 512)

refresh() {
  update-desktop-database "$APPS" 2>/dev/null || true
  gtk-update-icon-cache -f -t "$ICONS" 2>/dev/null || true
}

if [ "${1:-}" = --uninstall ]; then
  rm -f "$DESKTOP" "$ICONS/scalable/apps/md-editor.svg"
  for s in "${SIZES[@]}"; do rm -f "$ICONS/${s}x${s}/apps/md-editor.png"; done
  refresh
  echo "MD Editor の登録を解除しました"
  exit 0
fi

./start.sh --build

mkdir -p "$APPS" "$ICONS/scalable/apps"
install -m 644 src-tauri/icons/icon.svg "$ICONS/scalable/apps/md-editor.svg"
for s in "${SIZES[@]}"; do
  mkdir -p "$ICONS/${s}x${s}/apps"
  convert src-tauri/icons/icon-source.png -resize "${s}x${s}" "$ICONS/${s}x${s}/apps/md-editor.png"
done

cat >"$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=MD Editor
GenericName=Markdown エディタ
Comment=プレビューのまま編集できる Markdown エディタ
Exec="$BIN" %F
Icon=md-editor
Terminal=false
Categories=Utility;TextEditor;
MimeType=text/markdown;text/x-markdown;
Keywords=markdown;md;editor;メモ;
StartupWMClass=md-editor
EOF

refresh
echo "MD Editor をアプリケーション一覧に登録しました"
echo "  .md ファイルを右クリック →「別のアプリケーションで開く」からも選べます"
