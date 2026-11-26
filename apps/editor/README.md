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

## 書き出し

出力ページの「書き出し」で、FFmpeg を使って MP4（H.264 + AAC）か M4A（音声だけ）を作ります。書き出す場所は、始める前に選びます。

- タイムラインを、クリップやテロップが切り替わるところで区間に分け、区間ごとに映像を作ってからつなげます。素材は必要な部分だけを読むので、長い 4K の素材から少しだけ使うときも速く書き出せます。
- H.264 のエンコーダーは、macOS は VideoToolbox、Windows は Media Foundation、使えなければ OpenH264 を使います。
- テロップは、画面のプレビューと同じ描き方で画像にして重ねます。
- 中止はできますが、一時停止はありません。
- 組み立てと実行は [crates/matsuko-core](../../crates/matsuko-core) の `export.rs`・`run.rs` です。

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

- 画面は等倍（環境設定の「表示サイズ」：大 125%・デフォルト 100%・小 85%）で表示し、ウインドウが大きいときは広くなった分をプレビューやタイムラインなどの作業スペースに使います（基準の 1180×720 より広い高さは CSS の変数 `--xh` で各ページに渡す）。ウインドウが 1180×720 より小さいときだけ、全体を縮小して収めます。拡大・縮小は CSS の `zoom` で行い（文字や部品をその大きさで描き直すので、ぼやけない）、`zoom` で位置の値が変わるブラウザでは `transform` に戻します（起動したときに調べる）。
- プロジェクト設定（プロジェクト → プロジェクト設定…）で、シーケンスの解像度・フレームレート、プレビューの画質、プロキシの高さ（デスクトップ版）、音声のサンプリング周波数を決めます。設定はプロジェクトの中に保存します（`src/ui/projectSettings.ts`）。M4 では、ここに台本連携の設定を足します。
- 編集ページ・エフェクトページの左右のパネルは、内側の端をつかんでドラッグすると幅を変えられます（左 240px・右 280px から、画面の幅の 36%・最大 560px まで）。幅は覚えておき、端をダブルクリックすると元に戻ります（`src/ui/panels.ts`）。
- macOS では、メニュー（ファイル・編集・表示・プロジェクト・ヘルプ）を Mac のメニューバーに出し、画面の中のメニューバーは隠します（`src-tauri/src/menu.rs`）。⌘ を使うショートカットだけを Mac のメニューに登録し、コピー・切り取り・貼り付けは Mac の標準の項目にします（文字の入力欄ではその文字に、ほかではクリップに働く）。

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
      ├─ menu.rs         macOS のメニューバー
      ├─ media.rs        素材：ダイアログ・ドロップ・ffprobe・サムネイル／波形／プロキシの作業キュー
      ├─ export.rs       書き出し（保存先の選択・開始・中止・進み具合）
      ├─ files.rs        ファイルの保存
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
