# mdnote

Markdown の見た目を確認しながら、そのまま編集できるエディターです。Linux のデスクトップアプリとして使えます。

**[使い方ガイドを読む →](https://suke-toudara.github.io/mdnote/)**

## 主な機能

- プレビューを直接編集するモードと、Markdown を入力するソースモード。両方を並べて表示することもできます。
- 複数ファイルをタブで開く機能と、フォルダ内のファイル一覧、見出しから移動できる目次。
- 検索・置換、表の編集、画像の貼り付け、本文フォント・文字サイズ・テーマの切り替え。
- 自動保存、未保存の下書きの復元、ほかのアプリで変更された内容の確認。
- HTML・PDF への書き出しと、印刷時の用紙・余白の設定。
- デスクトップ版のチャット。自分の Claude API キーで文書への質問と変更案の作成ができます。

## チャットを使う

画面右上の「チャット」からパネルを開き、「設定」で [Claude Console](https://platform.claude.com/) の API キーを登録します。現在の接続先は Claude です。キーはアプリの起動中だけ保持し、終了すると消去します。環境変数 `ANTHROPIC_API_KEY` も使えます。ブラウザ版では利用できません。

質問は「送信」、文書の編集依頼は「変更案を作る」を押してください。送信時には現在の文書全体が Claude API に渡されます。変更案は内容を確認してから「文書に適用」を押すまで反映されません。API の利用には、設定したキーの所属組織のクレジットが使われます。

「フォルダを調べて実行」では、開いたフォルダ内の Markdown を検索・読込し、複数の文書の編集や新規作成を提案できます。未保存の文書は先に保存してください。提案はファイルごとの差分を確認し、適用するものを選んでから保存します。エージェントはフォルダ外のファイルやシェルにはアクセスできず、1 回の依頼で最大 6 回の応答と 3 ファイルの変更案に制限しています。

## インストールする

基本は、[GitHub Releases](https://github.com/suke-toudara/mdnote/releases) から配布パッケージをダウンロードして使います。Node.js や Rust の準備は不要です。

- **deb**：Ubuntu・Debian 系向け。`sudo apt install ./ファイル名.deb` でインストールし、アプリ一覧から起動します。
- **AppImage**：`chmod +x ./ファイル名.AppImage` で実行権限を付け、`./ファイル名.AppImage` で起動します。

初回リリースは準備中です。公開後は、リリースの説明で対応 OS と CPU を確認してください。詳しい操作や更新方法は[インストールと起動](https://suke-toudara.github.io/mdnote/01-install.html)にまとめています。

## 開発する

Node.js・npm、Rust、[Tauri 2 の開発用ライブラリ](https://v2.tauri.app/start/prerequisites/#linux)が必要です。

```sh
git clone https://github.com/suke-toudara/mdnote.git
cd mdnote
npm ci
./build.sh                 # ローカル版をビルドしてアプリ一覧に反映
npm run app                # 開発モードで起動
npm run app:build          # deb と AppImage を作成
npm run app:build:deb      # deb のみ作成
npm run app:build:appimage # AppImage のみ作成
```

生成先は `src-tauri/target/release/bundle/deb/` と `src-tauri/target/release/bundle/appimage/` です。

`npm run dev` でブラウザ向けの開発サーバーも起動できます。ブラウザ版のエディターは公開していません。フォルダ操作など、デスクトップ版でのみ使える機能があります。

## 配布する

バージョンを `package.json`・`package-lock.json`・`src-tauri/Cargo.toml`・`src-tauri/Cargo.lock`・`src-tauri/tauri.conf.json` で揃え、`v0.1.0` のようなタグを push すると、GitHub Actions が Linux x86_64 向けの deb と AppImage を作り、GitHub Releases の下書きに添付します。対応環境で動作を確認し、変更内容を記載して公開してください。初回の公開時には、この README とガイドの「初回リリースは準備中」の案内も更新します。

## ガイドを更新する

本文は `docs-src/` にあります。`main` に変更を push すると、GitHub Actions が mkbook でページを生成し、GitHub Pages に公開します。見た目は `docs-src/docs-theme.css`、ページの構成は `scripts/style_docs.py` で調整しています。
