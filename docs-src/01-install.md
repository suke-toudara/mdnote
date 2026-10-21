---
title = "インストールと起動"
---

## 事前に用意するもの

Linux でソースコードから起動するには、Node.js と npm、Rust の安定版、Tauri 2 の開発に必要なシステムライブラリを用意します。必要なライブラリは Linux の種類によって異なります。[Tauri 公式のセットアップ手順](https://v2.tauri.app/start/prerequisites/#linux)を確認してください。

## アプリを起動する

ターミナルで次のコマンドを実行します。

```sh
git clone https://github.com/suke-toudara/mdnote.git
cd mdnote
./start.sh
```

初回は npm パッケージのインストールとアプリのビルドを行うため、起動までに時間がかかります。次回からは、ソースコードに変更がなければビルド済みのアプリを起動します。

ファイルを指定して開くこともできます。

```sh
./start.sh ~/Documents/notes.md
```

## アプリ一覧に登録する

```sh
./install.sh
```

現在のユーザーのアプリ一覧に登録します。Markdown ファイルを右クリックしたときの「別のアプリケーションで開く」からも選べるようになります。アイコンの作成には ImageMagick の `convert` コマンドが必要です。

登録を解除する場合は `./install.sh --uninstall` を実行します。登録後にプロジェクトのフォルダを移動した場合は、新しい場所で登録し直してください。

## 開発用の起動方法

`./start.sh --dev` は、ソースコードの変更を反映しながら開発するための起動方法です。アプリのビルドだけを行いたい場合は `./start.sh --build` を使います。
