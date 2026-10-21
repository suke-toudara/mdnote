---
title = "インストールと起動"
---

# インストールと起動

## 用意するもの

Linux デスクトップでは、Node.js と npm、Rust の stable toolchain、Tauri 2 の Linux 開発用ライブラリが必要です。詳しい OS 依存パッケージは [Tauri の Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux)を確認してください。

## 起動

リポジトリを取得して、プロジェクトのディレクトリで起動します。

```sh
git clone git@github.com:suke-toudara/mdnote.git
cd mdnote
./start.sh
```

初回起動時は依存パッケージとアプリをビルドします。以後、ソースが変更されていなければビルド済みアプリを起動します。

Markdown ファイルを指定して起動することもできます。

```sh
./start.sh ~/Documents/notes.md
```

開発中は `./start.sh --dev` を使うと、ソース変更を反映する開発モードで起動します。ビルドだけ行う場合は `./start.sh --build` です。

## アプリ一覧に登録

```sh
./install.sh
```

ユーザー単位でアプリ一覧と Markdown ファイルの関連付けに登録します。登録解除は `./install.sh --uninstall` です。
