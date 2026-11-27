#!/usr/bin/env python3
"""リリースのファイルを集めて、自動更新の latest.json を作る（GitHub Actions の release ジョブで使う）。

使い方: make-release.py <ダウンロードした成果物のフォルダー> <出力フォルダー> <リリースノートの出力>
環境変数: TAG（例 v0.2.0）、REPO（owner/name）

- 名前の空白は「-」にする（GitHub は空白を「.」に変えるため、latest.json の URL と合わなくなる）
- 2 つの Mac（Apple シリコン・Intel）の更新ファイルは同じ名前なので、名前にアーキテクチャを足す
- リリースノートは docs/release-notes/<TAG>.md があればそれ。更新の画面にも出る
"""
import json
import os
import shutil
import sys
import urllib.parse
from datetime import datetime, timezone

src, out, notes_out = sys.argv[1], sys.argv[2], sys.argv[3]
tag = os.environ["TAG"]
repo = os.environ["REPO"]
ver = tag[1:] if tag.startswith("v") else tag
os.makedirs(out, exist_ok=True)

# 成果物のフォルダー名（matsuko-editor-<ターゲット>）から、latest.json のプラットフォーム名へ
PLATFORM = {
    "x86_64-pc-windows-msvc": ("windows-x86_64", "x64"),
    "aarch64-apple-darwin": ("darwin-aarch64", "aarch64"),
    "x86_64-apple-darwin": ("darwin-x86_64", "x64"),
    "x86_64-unknown-linux-gnu": ("linux-x86_64", "amd64"),
}

platforms = {}
files = []
for art in sorted(os.listdir(src)):
    target = art.replace("matsuko-editor-", "", 1)
    plat, arch = PLATFORM.get(target, (None, None))
    for root, _, names in os.walk(os.path.join(src, art)):
        for n in sorted(names):
            path = os.path.join(root, n)
            if n.endswith(".sig"):
                continue
            new = n.replace(" ", "-")
            if new.endswith(".app.tar.gz"):
                new = new[: -len(".app.tar.gz")] + "_" + ver + "_" + arch + ".app.tar.gz"
            dst = os.path.join(out, new)
            shutil.copyfile(path, dst)
            files.append(new)
            # 更新に使うファイル：Windows は setup.exe、Mac は .app.tar.gz、Linux は AppImage
            sig = path + ".sig"
            upd = n.endswith("-setup.exe") or n.endswith(".app.tar.gz") or n.endswith(".AppImage")
            if plat and upd and os.path.exists(sig):
                shutil.copyfile(sig, dst + ".sig")
                files.append(new + ".sig")
                with open(sig, encoding="utf-8") as f:
                    platforms[plat] = {
                        "signature": f.read().strip(),
                        "url": "https://github.com/%s/releases/download/%s/%s" % (repo, tag, urllib.parse.quote(new)),
                    }

notes_file = os.path.join("docs", "release-notes", tag + ".md")
notes = open(notes_file, encoding="utf-8").read().strip() if os.path.exists(notes_file) else ""
with open(notes_out, "w", encoding="utf-8") as f:
    f.write(notes or ("Matsuko Editor " + ver))

if platforms:
    latest = {
        "version": ver,
        "notes": notes,
        "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": platforms,
    }
    with open(os.path.join(out, "latest.json"), "w", encoding="utf-8") as f:
        json.dump(latest, f, ensure_ascii=False, indent=1)
    files.append("latest.json")
    print("latest.json:", ", ".join(sorted(platforms)))
else:
    print("更新の署名（.sig）がないため、latest.json は作りません（TAURI_SIGNING_PRIVATE_KEY を設定すると作ります）")
print("\n".join(files))
