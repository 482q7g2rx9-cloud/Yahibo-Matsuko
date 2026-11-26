#!/usr/bin/env bash
# macOS 用の FFmpeg / FFprobe を、LGPL 構成でソースからビルドする。
# H.264 の書き出しは macOS の VideoToolbox を使う（GPL の libx264 は使わない）。
#   使い方: scripts/build-ffmpeg-macos.sh <出力フォルダ> [ターゲット]
#   ターゲット：aarch64-apple-darwin（Apple シリコン）／x86_64-apple-darwin（Intel）。
#   省略すると、ビルドする Mac と同じもの。Apple シリコンの Mac で Intel 版も作れる（クロスコンパイル）。
set -euo pipefail
VER=7.1.1
out="$1"; mkdir -p "$out"
target="${2:-}"
case "$target" in
  x86_64-apple-darwin) arch=x86_64 ;;
  aarch64-apple-darwin) arch=arm64 ;;
  "") arch="$(uname -m)" ;;
  *) echo "未対応のターゲット: $target" >&2; exit 2 ;;
esac
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
curl -fL --retry 3 "https://ffmpeg.org/releases/ffmpeg-$VER.tar.xz" | tar -xJ -C "$work"
cd "$work/ffmpeg-$VER"
flags="-arch $arch -mmacosx-version-min=11.0"
extra=()
# ビルドする Mac と違う CPU 向けなら、クロスコンパイルにする
if [[ "$arch" != "$(uname -m)" ]]; then
  extra+=(--enable-cross-compile --target-os=darwin --arch="$arch" --cc="clang -arch $arch")
fi
# Intel 版の高速化（アセンブリ）には nasm が要る。なければ、遅くなるが無しで作る
if [[ "$arch" == x86_64 ]] && ! command -v nasm >/dev/null; then
  echo "注意: nasm がないため、アセンブリなしでビルドします（brew install nasm で入れられます）" >&2
  extra+=(--disable-x86asm)
fi
# --disable-autodetect：ランナーに入っている外部ライブラリ（Homebrew など）を勝手に取り込まない
./configure \
  --disable-autodetect --disable-doc --disable-ffplay --disable-network --disable-debug \
  --enable-static --disable-shared \
  --enable-videotoolbox --enable-audiotoolbox --enable-zlib \
  --extra-ldflags="$flags" --extra-cflags="$flags" \
  ${extra[@]+"${extra[@]}"}
make -j"$(sysctl -n hw.ncpu)" ffmpeg ffprobe
# できたものの CPU を確かめる
for t in ffmpeg ffprobe; do
  got="$(lipo -archs "$t")"
  [[ "$got" == "$arch" ]] || { echo "エラー: $t の CPU が $got です（$arch のはず）" >&2; exit 1; }
done
cp ffmpeg ffprobe "$out/"
