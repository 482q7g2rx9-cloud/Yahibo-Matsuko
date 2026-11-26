# Matsuko Editor（デスクトップ版）

Rust + Tauri 2 で作る、Matsuko Editor のデスクトップアプリです。計画は [docs/tauri-plan.md](../../docs/tauri-plan.md) にあります。

いまは **M0（土台）** の段階です。
- ブラウザ版（`src/matsuko-editor.html`）の画面を、そのままアプリとして起動します。
- 同梱した FFmpeg / FFprobe を Rust から呼べることを確かめられます（ヘルプ → バージョン情報）。

## 用意するもの

| OS | 必要なもの |
|---|---|
| すべて | Node.js 22、Rust（stable） |
| Windows | Visual Studio Build Tools（「C++ によるデスクトップ開発」）、WebView2（Windows 10/11 には通常入っています） |
| macOS | Xcode Command Line Tools（`xcode-select --install`） |
| Linux | `libwebkit2gtk-4.1-dev` `libayatana-appindicator3-dev` `librsvg2-dev` `libxdo-dev` `libssl-dev` `build-essential` |

詳しくは Tauri の [前提条件](https://v2.tauri.app/start/prerequisites/) を見てください。

## 動かし方

```bash
cd apps/editor
npm ci
```

同梱する FFmpeg を用意します。配布用の LGPL 版を取ってくる場合はターゲット名を指定します（macOS はソースからビルドするので時間がかかります）。手元の PC で試すだけなら `--system` で、PATH にある ffmpeg をコピーしてもかまいません。

```bash
scripts/fetch-ffmpeg.sh x86_64-pc-windows-msvc
```

```bash
scripts/fetch-ffmpeg.sh --system
```

開発用に起動します（画面を変えると自動で読み直します）。

```bash
npm run tauri dev
```

インストーラーを作ります。できたものはリポジトリ直下の `target/release/bundle/` に入ります。

```bash
npm run tauri build
```

## 画面のコードについて

M2 で TypeScript のモジュールに移植するまでは、**ブラウザ版の `src/matsuko-editor.html` が画面の唯一の元**です。

- `npm run dev` / `npm run build` の前に `scripts/sync-web-ui.mjs` が自動で動きます。ブラウザ版から CSS と JavaScript を取り出し、`src/legacy/` を作ります（生成物なので Git には入れません）。
- 日本語フォント（Noto Sans JP）はアプリに同梱します。学校の PC がネットにつながっていなくても、同じ見た目で表示するためです。
- デスクトップ版だけの機能は `src/main.ts` が `window.MatsukoHost` に用意し、画面側は「あれば使う」形で呼びます。そのため、ブラウザ版もそのまま動きます。

## フォルダ

```
apps/editor/
├─ index.html            画面の骨組み
├─ src/
│  ├─ main.ts            入り口（フォント・CSS・画面本体を読み込む）
│  ├─ ipc.ts             Rust への命令
│  └─ legacy/            生成物（ブラウザ版から作る）
├─ scripts/
│  ├─ sync-web-ui.mjs    ブラウザ版から画面を作る
│  ├─ fetch-ffmpeg.sh    同梱する FFmpeg を用意する
│  └─ build-ffmpeg-macos.sh
└─ src-tauri/            Rust 側（Tauri）
   ├─ tauri.conf.json
   ├─ capabilities/      画面に許可する機能
   ├─ binaries/          FFmpeg（生成物。Git には入れない）
   └─ src/
```

中心部分（画面を持たない Rust のコード）は [crates/matsuko-core](../../crates/matsuko-core) にあります。

## CI

`.github/workflows/editor.yml` で、次のことを行います。
- 中心部分のテストと画面のビルド
- Windows（NSIS）・macOS（dmg）・Linux（deb / AppImage）のインストーラー作成

できたインストーラーは、実行結果の「Artifacts」からダウンロードできます。署名はまだしていないため、初回起動時に OS の警告が出ます。署名は M5 で対応します。
