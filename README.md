# mdnote

Markdown の見た目を確認しながら、そのまま編集できるエディターです。Linux のデスクトップアプリとして使えます。

**[使い方ガイドを読む →](https://suke-toudara.github.io/mdnote/)**

## 主な機能

- プレビューを直接編集するモードと、Markdown を入力するソースモード。両方を並べて表示することもできます。
- 複数ファイルをタブで開く機能と、フォルダ内のファイル一覧、見出しから移動できる目次。
- 検索・置換、表の編集、画像の貼り付け。
- 自動保存、未保存の下書きの復元、ほかのアプリで変更された内容の確認。
- HTML・PDF への書き出しと、印刷時の用紙・余白の設定。

## 起動する

Node.js・npm、Rust、Tauri 2 の開発に必要なライブラリを用意してください。詳しくは[インストールと起動](https://suke-toudara.github.io/mdnote/01-install.html)を参照してください。

```sh
git clone https://github.com/suke-toudara/mdnote.git
cd mdnote
./start.sh
```

初回は必要な npm パッケージをインストールし、アプリをビルドしてから起動します。

## 開発する

```sh
npm install
npm run app       # デスクトップアプリを開発モードで起動
npm run build     # 型チェックと画面のビルド
npm run app:build # Debian パッケージを作成
```

`npm run dev` でブラウザ向けの開発サーバーも起動できます。ブラウザ版のエディターは公開していません。フォルダ操作など、デスクトップ版でのみ使える機能があります。

## ガイドを更新する

本文は `docs-src/` にあります。`main` に変更を push すると、GitHub Actions が mkbook でページを生成し、GitHub Pages に公開します。見た目は `docs-src/docs-theme.css`、ページの構成は `scripts/style_docs.py` で調整しています。
