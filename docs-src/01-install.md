---
title = "インストールと起動"
---

## 配布パッケージを選ぶ

mdnote は Linux 用のアプリです。[GitHub Releases](https://github.com/suke-toudara/mdnote/releases) で、使いたいバージョンの「Assets」からパッケージをダウンロードします。利用するだけなら、Node.js や Rust は不要です。

- **deb**：Ubuntu・Debian 系で、アプリ一覧に登録して使いたい場合。
- **AppImage**：インストールせず、ファイルから起動したい場合。

初回リリースは準備中です。パッケージが掲載されるまでは、下の「ソースコードから起動する」を利用してください。配布時にはリリースの説明で対応 OS と CPU を確認してください。`amd64`・`x86_64` は Intel / AMD の 64 ビット PC 向けで、ARM 向けではありません。

## deb をインストールする

ダウンロードしたファイルのあるフォルダで、次を実行します。`ファイル名.deb` は、実際の名前に置き換えてください。

```sh
sudo apt install ./ファイル名.deb
```

インストール後は、アプリ一覧から **mdnote** を起動できます。ターミナルからは `mdnote`、ファイルを指定する場合は `mdnote ~/Documents/notes.md` で開けます。

更新するときも、新しい deb をダウンロードして同じ方法でインストールします。GitHub からダウンロードする方式なので、`apt upgrade` だけでは新しいバージョンに更新されません。

アンインストールする場合は、次を実行します。

```sh
sudo apt remove mdnote
```

## AppImage を起動する

ダウンロードしたファイルのあるフォルダで、実行権限を付けて起動します。`ファイル名.AppImage` は、実際の名前に置き換えてください。

```sh
chmod +x ./ファイル名.AppImage
./ファイル名.AppImage
```

AppImage は自動でアプリ一覧には登録されません。保管した場所から起動してください。更新するときはアプリを終了し、新しい AppImage に置き換えて、実行権限を付け直します。

FUSE に関するエラーが出る場合は、[AppImage 公式の対処方法](https://docs.appimage.org/user-guide/troubleshooting/fuse.html)を参照してください。AppImage も OS やシステムライブラリの条件があるため、すべての Linux で動くわけではありません。

## ソースコードから起動する（開発者向け）

Node.js・npm、Rust の安定版、[Tauri 2 の開発に必要なシステムライブラリ](https://v2.tauri.app/start/prerequisites/#linux)を用意します。

```sh
git clone https://github.com/suke-toudara/mdnote.git
cd mdnote
./start.sh
```

初回は npm パッケージのインストールとビルドを行います。開発モードでは `./start.sh --dev`、ビルドだけなら `./start.sh --build` を使います。

ソースコードからビルドしたアプリを現在のユーザーのアプリ一覧へ登録する場合は、`./install.sh` を実行します。アイコンの作成には ImageMagick の `convert` が必要です。登録解除は `./install.sh --uninstall` です。deb でインストールした場合、この操作は不要です。
