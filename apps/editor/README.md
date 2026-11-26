# Matsuko Editor（デスクトップ版）

Rust + Tauri 2 で作る、Matsuko Editor のデスクトップアプリです。計画は [docs/tauri-plan.md](../../docs/tauri-plan.md) にあります。

いまは **M1（プロジェクトと素材）** まで進んでいます。
- ブラウザ版（`src/matsuko-editor.html`）の画面を、そのままアプリとして起動します。
- プロジェクトはフォルダーに自動保存し、次に起動したときは前回のプロジェクトを開きます（下の「プロジェクトフォルダー」）。
- 素材は、ファイル → 素材を読み込む、または OS からのドラッグで読み込みます。FFmpeg が裏でサムネイル・波形・プロキシを作るので、作っている間も編集を続けられます。
- 素材のファイルが見つからないときは、メディアページの「リンクし直す」で付け替えます。

## プロジェクトフォルダー

```
書類/Matsuko Editor/商店街 特集/   ← 新規プロジェクトの既定の場所（ファイル → 新規プロジェクト で変えられる）
├─ project.json        プロジェクト本体（編集するたびに自動保存。1つ前の版は project.json.bak）
├─ history.sqlite      変更履歴（2分ごとの写し。新しい順に100件。プロジェクト → 変更履歴・復元 から戻せる）
└─ cache/
   ├─ proxy/           プロキシ（高さ 720 以下の軽い動画。元の素材が重い・再生できない形式のときだけ作る）
   └─ thumb/           サムネイル
```

- 素材のファイルはコピーしません。フルパスと、プロジェクトフォルダーからの相対パスを両方保存します。素材とプロジェクトをまとめて別の場所や PC に移しても、相対パスで見つけます。
- プロキシは Windows では Media Foundation（`h264_mf`）、macOS では VideoToolbox で作ります。どちらも使えないときは OpenH264、それもなければ VP9（WebM）で作ります。
- 保存形式は beta までは `.json`（`project.json`）です。

## 用意するもの

| OS | 必要なもの |
|---|---|
| すべて | Node.js 22、Rust（stable） |
| Windows | Visual Studio Build Tools（「C++ によるデスクトップ開発」）、WebView2（Windows 10/11 には通常入っています） |
| macOS | Xcode Command Line Tools（`xcode-select --install`） |
| Linux | `libwebkit2gtk-4.1-dev` `libayatana-appindicator3-dev` `librsvg2-dev` `libxdo-dev` `libssl-dev` `build-essential`。動画の再生に `gstreamer1.0-plugins-good` `gstreamer1.0-libav` |

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

Intel の Mac 向けは、Apple シリコンの Mac でも作れます（クロスコンパイル）。

```bash
rustup target add x86_64-apple-darwin
```

```bash
scripts/fetch-ffmpeg.sh x86_64-apple-darwin
```

```bash
npm run tauri build -- --target x86_64-apple-darwin
```

できたものは `target/x86_64-apple-darwin/release/bundle/` に入ります。FFmpeg を速くするには、先に `brew install nasm` をしておきます。

開発用に起動します（画面を変えると自動で読み直します）。

```bash
npm run tauri dev
```

インストーラーを作ります。できたものはリポジトリ直下の `target/release/bundle/` に入ります。

```bash
npm run tauri build
```

## 画面のコードについて

M2 から、**画面のコードの元は `apps/editor/src/ui/`（TypeScript）**です。ブラウザ版の `src/matsuko-editor.html` は、ここから作る生成物です。

- ブラウザ版を作り直すときは `npm run build:web` を実行します。`src/matsuko-editor.html`（1つの HTML）ができるので、それを Artifact に載せます。`src/matsuko-editor.html` を直接編集しないでください。
- 画面のコードは、もとの1つのファイルを役割ごとのモジュールに分けたものです。読み込んだときの準備（変数の初期化やイベントの登録）は各モジュールの `init()` にまとめ、`src/ui/main.ts` がもとのファイルと同じ順番で呼びます。
- 型は少しずつ付けていきます。まだ型を付けていないモジュールは先頭に `// @ts-nocheck` があります。
- 日本語フォント（Noto Sans JP）は、デスクトップ版ではアプリに同梱します（学校の PC がネットにつながっていなくても同じ見た目にするため）。ブラウザ版は Google Fonts を使います。
- デスクトップ版だけの機能は `src/host.ts` が `window.MatsukoHost` に用意し、画面側は「あれば使う」形で呼びます。そのため、ブラウザ版もそのまま動きます。
- 画面の中のドラッグ（素材をタイムラインへ・仮編集の並べ替え）は、HTML のドラッグ＆ドロップではなくマウス操作で作っています。Windows では、OS からのファイルのドロップを受けると HTML のドラッグ＆ドロップが使えなくなるためです。
- ファイルのダイアログは Rust 側で開き、画面からは「ダイアログで選んだ・ドロップした・プロジェクトにある」ファイルしか扱えないようにしています。
- 素材を画面へ渡すときは、Windows・macOS は `asset:` を使います。Linux の WebKitGTK は `asset:` の動画を再生できないため、アプリの中の小さなサーバー（127.0.0.1 だけで待ち受け、起動ごとの合言葉つき）を使います。

### 回帰テスト

画面のコードを作り替えたら、前と後で操作の結果が変わらないことを確かめます。

```bash
tests/make-media.sh
```

```bash
node tests/tour.mjs ../../src/matsuko-editor.html /tmp/tour-after.txt
```

作り替える前の HTML でも同じように記録を取り、2つの記録を `diff` で比べます。

変更履歴・復元は、時計を進めながら確かめます。

```bash
node tests/history.mjs ../../src/matsuko-editor.html
```

中心部分（`src/core/`）の単体テストは `npm test` です。

## 開発中の確かめ方

- 開発版（`npm run tauri dev` や `tauri build --debug`）は、環境変数 `MATSUKO_DEVTOOLS=1` で起動すると開発者ツールが開きます。
- `MATSUKO_FFMPEG_DIR` で、使う FFmpeg のフォルダーを変えられます（例：`/usr/bin`）。
- 起動するときにプロジェクトフォルダー（または `project.json`）を引数で渡すと、それを開きます。

## フォルダ

```
apps/editor/
├─ index.html            画面の骨組み
├─ src/
│  ├─ main.ts            入り口（フォント・CSS・画面本体を読み込む）
│  ├─ host.ts            画面から呼ぶデスクトップ版の機能（window.MatsukoHost）
│  ├─ web.ts             ブラウザ版の入り口
│  ├─ core/              中心部分（型つき・画面に依存しない）：プロジェクトの型、タイムラインの編集、無音の検出、変更履歴
│  └─ ui/                画面本体（ブラウザ版と共通）。main.ts が入り口、pages/ が各ページ
├─ web.html              ブラウザ版の骨組み（npm run build:web）
├─ tests/                回帰テスト（tour.mjs）と、テスト用の素材を作るスクリプト
├─ scripts/
│  ├─ build-web.mjs      ブラウザ版を1つの HTML にまとめる
│  ├─ fetch-ffmpeg.sh    同梱する FFmpeg を用意する
│  └─ build-ffmpeg-macos.sh
└─ src-tauri/            Rust 側（Tauri）
   ├─ tauri.conf.json
   ├─ capabilities/      画面に許可する機能
   ├─ binaries/          FFmpeg（生成物。Git には入れない）
   └─ src/
      ├─ project.rs      プロジェクトフォルダー：新規・開く・自動保存・最近使ったもの
      ├─ media.rs        素材：ダイアログ・ドロップ・ffprobe・サムネイル／波形／プロキシの作業キュー
      ├─ files.rs        書き出したファイルの保存
      ├─ history.rs      変更履歴（history.sqlite）
      ├─ server.rs       Linux 用：素材を画面へ渡すサーバー
      ├─ state.rs        開いているプロジェクト・使ってよいファイル・動いている作業
      └─ tools.rs        同梱の FFmpeg の起動
```

中心部分（画面を持たない Rust のコード）は [crates/matsuko-core](../../crates/matsuko-core) にあります。

## CI

`.github/workflows/editor.yml` で、次のことを行います。
- 中心部分のテストと画面のビルド、デスクトップ側のテスト（Linux）
- Windows（NSIS）・macOS（dmg。Apple シリコン版と Intel 版）・Linux（deb / AppImage）のインストーラー作成

できたインストーラーは、実行結果の「Artifacts」からダウンロードできます。署名はまだしていないため、初回起動時に OS の警告が出ます。署名は M5 で対応します。
