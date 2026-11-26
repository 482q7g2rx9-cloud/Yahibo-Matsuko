#!/usr/bin/env bash
# macOS 用の FFmpeg / FFprobe を、LGPL 構成でソースからビルドする。
# H.264 の書き出しは macOS の VideoToolbox を使う（GPL の libx264 は使わない）。
#   使い方: scripts/build-ffmpeg-macos.sh <出力フォルダ>
set -euo pipefail
VER=7.1.1
out="$1"; mkdir -p "$out"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
curl -fL --retry 3 "https://ffmpeg.org/releases/ffmpeg-$VER.tar.xz" | tar -xJ -C "$work"
cd "$work/ffmpeg-$VER"
# --disable-autodetect：ランナーに入っている外部ライブラリ（Homebrew など）を勝手に取り込まない
./configure \
  --disable-autodetect --disable-doc --disable-ffplay --disable-network --disable-debug \
  --enable-static --disable-shared \
  --enable-videotoolbox --enable-audiotoolbox --enable-zlib \
  --extra-ldflags="-mmacosx-version-min=11.0" --extra-cflags="-mmacosx-version-min=11.0"
make -j"$(sysctl -n hw.ncpu)" ffmpeg ffprobe
cp ffmpeg ffprobe "$out/"
