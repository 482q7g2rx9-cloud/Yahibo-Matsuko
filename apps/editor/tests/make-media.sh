#!/usr/bin/env bash
# 回帰テスト（tests/tour.mjs）で使う素材を FFmpeg で作る。素材はリポジトリに入れない。
#   test1.mp4  6秒の映像（640×360・H.264）と音声
#   bgm.wav    8秒の音
#   talk.webm  映像と、音のある区間・ない区間を交互にした音声（無音の検出用）
set -euo pipefail
out="${1:-$(dirname "$0")/media}"
mkdir -p "$out"
ff() { ffmpeg -v error -y "$@"; }
[ -f "$out/test1.mp4" ] || ff -f lavfi -i testsrc=size=640x360:rate=30 -f lavfi -i sine=frequency=440:sample_rate=44100 -t 6 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$out/test1.mp4"
[ -f "$out/bgm.wav" ] || ff -f lavfi -i sine=frequency=330:sample_rate=44100 -t 8 "$out/bgm.wav"
[ -f "$out/talk.webm" ] || ff -f lavfi -i testsrc2=size=640x360:rate=30 -f lavfi -i "aevalsrc=0.4*sin(2*PI*300*t)*lt(mod(t\,3)\,2):s=48000" -t 12 \
  -c:v libvpx -b:v 300k -c:a libopus -shortest "$out/talk.webm"
ls -la "$out"
