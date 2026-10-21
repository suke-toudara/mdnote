# MD Note

プレビューを見ながら編集できる、デスクトップ向け Markdown エディタです。Tauri 2 と Milkdown を使い、Markdown ファイルをローカルで開いて編集します。

## できること

- プレビュー編集・ソース・分割表示
- タブ、フォルダ内のファイル一覧、見出しアウトライン
- 検索と置換、表編集、画像の貼り付け・ドラッグ＆ドロップ
- 下書き復元、自動保存、外部アプリによる変更の検知
- HTML 書き出し、印刷プレビュー、PDF 書き出し

## 起動

Linux では依存パッケージを入れたあと、リポジトリ内で次を実行します。

```sh
./start.sh
```

開発モードは `./start.sh --dev`、アプリ一覧への登録は `./install.sh` です。ビルド要件や詳しい操作は[使い方ガイド](https://suke-toudara.github.io/mdnote/)を参照してください。

## 開発

```sh
npm install
npm run dev       # Web 開発サーバー
npm run build     # フロントエンドの型検査とビルド
npm run app       # Tauri 開発アプリ
npm run app:build # Debian パッケージ
```

このアプリはローカルファイルを扱います。ブラウザで起動した場合、一部のファイル機能はブラウザの対応状況に依存します。
