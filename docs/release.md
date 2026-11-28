# 配布のしかた（M5）

Matsuko Editor（デスクトップ版）を、署名つきのインストーラーと自動更新で配る手順。作業は GitHub の画面と、手元のパソコンのターミナルで行う。

## 1. 仕組み

- `v` で始まるタグ（例：`v0.2.0`）を push すると、GitHub Actions（`.github/workflows/editor.yml`）が 4 種類のアプリをビルドし、Releases にインストーラーを置く。
- 版の番号はタグから取る（`tauri.conf.json` の `version` は、タグのないビルドで使う）。
- 自動更新：アプリは `https://github.com/482q7g2rx9-cloud/Yahibo-Matsuko/releases/latest/download/latest.json` を見て、新しい版があれば知らせる。更新のファイルは署名を確かめてから入れる。
- 署名や鍵は、リポジトリの Secrets / Variables にあるときだけ使う。ないときは、署名のないビルド・更新の機能のないビルドになる（ビルドは通る）。

| 設定する場所 | 名前 | 中身 | ないとき |
|---|---|---|---|
| Variables | `MATSUKO_UPDATER_PUBKEY` | 更新の署名の公開鍵 | 更新の機能が出ない |
| Secrets | `TAURI_SIGNING_PRIVATE_KEY` | 更新の署名の秘密鍵 | 更新のファイル（.sig・latest.json）を作らない |
| Secrets | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 秘密鍵のパスワード | パスワードなしの鍵として扱う |
| Secrets | `WINDOWS_CERTIFICATE` | コード署名の証明書（.pfx）を base64 にしたもの | Windows 版は署名なし |
| Secrets | `WINDOWS_CERTIFICATE_PASSWORD` | .pfx のパスワード | |
| Secrets | `APPLE_CERTIFICATE` | Developer ID Application の証明書（.p12）を base64 にしたもの | Mac 版は署名・公証なし |
| Secrets | `APPLE_CERTIFICATE_PASSWORD` | .p12 のパスワード | |
| Secrets | `APPLE_SIGNING_IDENTITY` | 例：`Developer ID Application: 名前 (TEAMID)` | |
| Secrets | `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | 公証に使う Apple ID、App 用パスワード、チーム ID | 署名だけして公証しない |

設定する場所：リポジトリの Settings → Secrets and variables → Actions。

## 2. 更新の署名の鍵を作る（最初の 1 回だけ）

手元のパソコンで（Node.js が入っていること）：

```bash
cd apps/editor
```

```bash
npx tauri signer generate -w ~/.tauri/matsuko-editor.key
```

- パスワードを聞かれるので決める（忘れないこと）。
- `~/.tauri/matsuko-editor.key.pub` の中身を Variables の `MATSUKO_UPDATER_PUBKEY` に、`~/.tauri/matsuko-editor.key` の中身を Secrets の `TAURI_SIGNING_PRIVATE_KEY` に、パスワードを `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` に入れる。
- 秘密鍵をなくすと、配ったアプリを更新できなくなる。安全な場所に控えを残す。秘密鍵はリポジトリに入れない。

## 3. コード署名（あれば）

- Windows：OV か EV のコード署名証明書。署名がないと、SmartScreen の「Windows によって PC が保護されました」が出る（「詳細情報」→「実行」で入れられる）。
- macOS：Apple Developer Program（年額）で「Developer ID Application」の証明書を作る。署名と公証がないと、初回は右クリック →「開く」が要る。
- .pfx / .p12 を base64 にするには：`base64 -i 証明書.p12 | pbcopy`（Mac）、`[Convert]::ToBase64String([IO.File]::ReadAllBytes("証明書.pfx")) | Set-Clipboard`（Windows の PowerShell）。

## 4. リリースを作る

1. `apps/editor/src-tauri/tauri.conf.json` の `version` を次の版にする（タグと合わせておくと分かりやすい）。
2. 更新の画面に出す説明を `docs/release-notes/v0.2.0.md` に書く（なくてもよい。1 行目を「# 題名」にすると、リリースの題名になる）。
3. コミットして push し、タグを付けて push する。

```bash
git tag v0.2.0
```

```bash
git push origin v0.2.0
```

   タグを push できないとき（GitHub の画面から出すとき）は、Actions →「editor」→「Run workflow」で、ブランチを選び、release に `v0.2.0` のように入れて実行する。ビルドしたコミットにタグを付けて、リリースを作る。
4. Actions の「editor」が終わると、Releases に次が置かれる：Windows の setup.exe、Mac の dmg（Apple シリコン・Intel）、Linux の deb・AppImage、更新用のファイル（.app.tar.gz・.sig）と `latest.json`。
5. 配ったアプリは、起動して少したつと新しい版に気づき、「ヘルプ → 更新を確認…」から入れ直せる。

## 5. 更新の対象

- Windows：setup.exe を使って入れ直す（このユーザーだけに入れる形式なので、管理者の権限は要らない）。
- macOS：アプリ本体（.app）を入れ替える。アプリを「アプリケーション」フォルダーなど、書き込める場所に置いていること。
- Linux：AppImage で起動しているときだけ更新できる（deb で入れたものは、新しい deb を入れ直す）。

## 6. ログ

- 場所：Windows `%LOCALAPPDATA%\jp.yahibo.matsuko-editor\logs`、macOS `~/Library/Logs/jp.yahibo.matsuko-editor`、Linux `~/.local/share/jp.yahibo.matsuko-editor/logs`。
- `matsuko.log`（5MB で切り替え、古いものは 5 つまで）。起動・更新・画面のエラーなどを書く。
- 「ヘルプ → ログを保存…」で 1 つのテキストにまとめて保存できる（不具合の報告に使う）。
