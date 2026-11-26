#!/usr/bin/env bash
# 同梱する FFmpeg / FFprobe を src-tauri/binaries/ に用意する（Tauri の sidecar）。
#
#   使い方: scripts/fetch-ffmpeg.sh <ターゲット>   例: x86_64-pc-windows-msvc
#           scripts/fetch-ffmpeg.sh --system        開発用：PATH にある ffmpeg をコピー
#
# ライセンス：GPL の部品（libx264 など）を含まない LGPL 版だけを使う（docs/tauri-plan.md 7章）。
#   Windows / Linux … BtbN/FFmpeg-Builds の LGPL 版（最新のリリース系列）
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
# BtbN の最新リリースから、名前が「ffmpeg-n<版>-latest-<OS>-lgpl-<版>」の配布物を選ぶ（いちばん新しい版）。
# 配布物の名前は版が上がると変わるので、固定しない。GH_TOKEN があれば API の回数制限を避けられる。
btbn_url() { # btbn_url <win64|linux64> <zip|tar.xz>
  node -e '
    const [os, ext] = process.argv.slice(1);
    const h = { "User-Agent": "matsuko-editor-ci", Accept: "application/vnd.github+json" };
    if (process.env.GH_TOKEN) h.Authorization = "Bearer " + process.env.GH_TOKEN;
    fetch("https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest", { headers: h })
      .then(r => { if (!r.ok) throw new Error("GitHub API " + r.status); return r.json(); })
      .then(j => {
        const re = new RegExp("^ffmpeg-n(\\d+)\\.(\\d+)-latest-" + os + "-lgpl-[\\d.]+\\." + ext.replace(".", "\\.") + "$");
        const c = j.assets.map(a => ({ a, m: a.name.match(re) })).filter(x => x.m)
          .sort((x, y) => (y.m[1] - x.m[1]) || (y.m[2] - x.m[2]));
        if (!c.length) throw new Error("LGPL 版の配布物が見つかりません: " + os);
        console.log(c[0].a.browser_download_url);
      }).catch(e => { console.error(e.message); process.exit(1); });
  ' "$1" "$2"
}

put() { # put <取り出したbinフォルダ>
  for t in ffmpeg ffprobe; do cp "$1/$t$ext" "$bin/$t-$target$ext"; chmod +x "$bin/$t-$target$ext"; done
}

if [[ "$mode" == system ]]; then
  for t in ffmpeg ffprobe; do cp "$(command -v $t)" "$bin/$t-$target$ext"; done
elif [[ "$target" == x86_64-pc-windows-msvc ]]; then
  url="$(btbn_url win64 zip)"; echo "取得: $url"
  curl -fL --retry 3 -o "$work/ff.zip" "$url"
  powershell -NoProfile -Command "Expand-Archive -Path '$(cygpath -w "$work/ff.zip")' -DestinationPath '$(cygpath -w "$work")'"
  put "$(dirname "$(find "$work" -name ffmpeg.exe | head -1)")"
elif [[ "$target" == x86_64-unknown-linux-gnu ]]; then
  url="$(btbn_url linux64 tar.xz)"; echo "取得: $url"
  curl -fL --retry 3 -o "$work/ff.tar.xz" "$url"
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
