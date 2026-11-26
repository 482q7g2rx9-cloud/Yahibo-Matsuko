#!/usr/bin/env bash
# 同梱する FFmpeg / FFprobe を src-tauri/binaries/ に用意する（Tauri の sidecar）。
#
#   使い方: scripts/fetch-ffmpeg.sh <ターゲット>   例: x86_64-pc-windows-msvc
#           scripts/fetch-ffmpeg.sh --system        開発用：PATH にある ffmpeg をコピー
#
# ライセンス：GPL の部品（libx264 など）を含まない LGPL 版だけを使う（docs/tauri-plan.md 7章）。
#   Windows / Linux … BtbN/FFmpeg-Builds の LGPL 版（n7.1 系）
#   macOS          … scripts/build-ffmpeg-macos.sh でソースから LGPL 構成でビルド
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
bin="$here/../src-tauri/binaries"
mkdir -p "$bin"
target="${1:-}"
if [[ -z "$target" ]]; then echo "ターゲットを指定してください（例: x86_64-pc-windows-msvc / --system）" >&2; exit 2; fi
if [[ "$target" == "--system" ]]; then target="$(rustc -vV | sed -n 's/^host: //p')"; mode=system; else mode=download; fi

ext=""; [[ "$target" == *windows* ]] && ext=".exe"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
BTBN="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"

put() { # put <取り出したbinフォルダ>
  for t in ffmpeg ffprobe; do cp "$1/$t$ext" "$bin/$t-$target$ext"; chmod +x "$bin/$t-$target$ext"; done
}

if [[ "$mode" == system ]]; then
  for t in ffmpeg ffprobe; do cp "$(command -v $t)" "$bin/$t-$target$ext"; done
elif [[ "$target" == x86_64-pc-windows-msvc ]]; then
  curl -fL --retry 3 -o "$work/ff.zip" "$BTBN/ffmpeg-n7.1-latest-win64-lgpl-7.1.zip"
  powershell -NoProfile -Command "Expand-Archive -Path '$(cygpath -w "$work/ff.zip")' -DestinationPath '$(cygpath -w "$work")'"
  put "$(dirname "$(find "$work" -name ffmpeg.exe | head -1)")"
elif [[ "$target" == x86_64-unknown-linux-gnu ]]; then
  curl -fL --retry 3 -o "$work/ff.tar.xz" "$BTBN/ffmpeg-n7.1-latest-linux64-lgpl-7.1.tar.xz"
  tar -xJf "$work/ff.tar.xz" -C "$work"
  put "$(dirname "$(find "$work" -name ffmpeg -type f | head -1)")"
elif [[ "$target" == *apple-darwin ]]; then
  "$here/build-ffmpeg-macos.sh" "$work/out"
  put "$work/out"
else
  echo "未対応のターゲット: $target" >&2; exit 2
fi

for t in ffmpeg ffprobe; do "$bin/$t-$target$ext" -hide_banner -version | head -1; done
if "$bin/ffmpeg-$target$ext" -hide_banner -buildconf 2>/dev/null | grep -q -- '--enable-gpl'; then
  if [[ "$mode" == system ]]; then echo "注意: 手元の FFmpeg は GPL 構成です。開発用にだけ使い、配布物には入れないでください" >&2
  else echo "エラー: GPL 構成の FFmpeg です。LGPL 版を使ってください" >&2; exit 1; fi
fi
