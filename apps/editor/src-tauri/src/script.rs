//! 台本連携（M4）：台本アプリが書き出す ○○.link.json を選ぶ・読む・更新を見張る。
//! M6 から、台本アプリのプロジェクトファイル（.swdx。ZIP）も選べる。そのときは中の project.json を取り出して渡す
//! （連携ファイルの形に直すのは画面側の src/core/swdx.ts）。
//! 差分の判定と反映は画面側（src/core/link.ts）で行う。ここはファイルの出し入れだけ。
//! 見張りは、ファイルの更新時刻と大きさを 1.5 秒ごとに調べる方式（ブラウザのダウンロードのように
//! ファイルを置き換えて保存するアプリや、ネットワーク上のフォルダーでも確実に気づけるようにするため）。

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::watch;

use crate::state::state;

/// 連携ファイルの大きさの上限（壊れたファイルや別のファイルを選んだときに、読み込みで固まらないように）
const MAX_BYTES: u64 = 50 * 1024 * 1024;

static WATCH: OnceLock<Mutex<Option<watch::Sender<bool>>>> = OnceLock::new();

fn stamp(p: &PathBuf) -> Option<(u64, u128)> {
    let m = std::fs::metadata(p).ok()?;
    let t = m
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis();
    Some((m.len(), t))
}

/// 連携ファイルを選ぶ
#[tauri::command]
pub async fn script_pick(app: AppHandle) -> Option<String> {
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        a.dialog()
            .file()
            .set_title("台本の連携ファイルを選ぶ")
            .add_filter("台本（.link.json・.swdx）", &["json", "swdx", "zip"])
            .blocking_pick_file()
    })
    .await
    .ok()??;
    let p: PathBuf = picked.into_path().ok()?;
    state(&app).allowed.lock().unwrap().insert(p.clone());
    Some(p.to_string_lossy().into_owned())
}

/// 連携ファイルを読む（選んだファイル、またはプロジェクトに紐づけてあるファイルだけ）
#[tauri::command]
pub async fn script_read(app: AppHandle, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    state(&app).check(&p)?;
    let len = std::fs::metadata(&p)
        .map_err(|_| format!("台本の連携ファイルが見つかりません：{path}"))?
        .len();
    if len > MAX_BYTES {
        return Err("台本の連携ファイルが大きすぎます".into());
    }
    let bytes = tokio::fs::read(&p)
        .await
        .map_err(|e| format!("台本の連携ファイルを読めませんでした：{e}"))?;
    if bytes.starts_with(b"PK\x03\x04") {
        return swdx_json(&bytes);
    }
    String::from_utf8(bytes)
        .map_err(|_| "台本の連携ファイルを読めませんでした（文字が壊れています）".into())
}

/// .swdx（ZIP）の mimetype を確かめ、project.json の中身を返す
pub fn swdx_json(b: &[u8]) -> Result<String, String> {
    use std::io::Read;
    const BAD: &str = "台本アプリの .swdx として読めませんでした";
    let u16_at = |i: usize| {
        b.get(i..i + 2)
            .map(|x| u16::from_le_bytes([x[0], x[1]]) as usize)
    };
    let u32_at = |i: usize| {
        b.get(i..i + 4)
            .map(|x| u32::from_le_bytes([x[0], x[1], x[2], x[3]]) as usize)
    };
    // 終わりの印（End of central directory）を後ろから探す
    let eocd = (0..=b.len().saturating_sub(22))
        .rev()
        .take(65_557)
        .find(|&i| u32_at(i) == Some(0x0605_4b50))
        .ok_or(BAD)?;
    let count = u16_at(eocd + 10).ok_or(BAD)?;
    let p = u32_at(eocd + 16).ok_or(BAD)?;
    let get = |name: &str| -> Result<Option<Vec<u8>>, String> {
        let mut q = p;
        for _ in 0..count {
            if u32_at(q) != Some(0x0201_4b50) {
                return Err(BAD.into());
            }
            let method = u16_at(q + 10).ok_or(BAD)?;
            let size = u32_at(q + 20).ok_or(BAD)?;
            let (nl, el, cl) = (
                u16_at(q + 28).ok_or(BAD)?,
                u16_at(q + 30).ok_or(BAD)?,
                u16_at(q + 32).ok_or(BAD)?,
            );
            let lo = u32_at(q + 42).ok_or(BAD)?;
            if b.get(q + 46..q + 46 + nl) == Some(name.as_bytes()) {
                if u32_at(lo) != Some(0x0403_4b50) {
                    return Err(BAD.into());
                }
                let start = lo + 30 + u16_at(lo + 26).ok_or(BAD)? + u16_at(lo + 28).ok_or(BAD)?;
                let data = b.get(start..start + size).ok_or(BAD)?;
                return match method {
                    0 => Ok(Some(data.to_vec())),
                    8 => {
                        let mut out = Vec::new();
                        flate2::read::DeflateDecoder::new(data)
                            .take(200 * 1024 * 1024)
                            .read_to_end(&mut out)
                            .map_err(|_| BAD.to_string())?;
                        Ok(Some(out))
                    }
                    _ => Err("この圧縮の形式には対応していません".into()),
                };
            }
            q += 46 + nl + el + cl;
        }
        Ok(None)
    };
    let mime = get("mimetype")?.ok_or(BAD)?;
    if String::from_utf8_lossy(&mime).trim() != "application/vnd.yahibo.swdx" {
        return Err("台本アプリの .swdx ではありません".into());
    }
    let json = get("project.json")?.ok_or(".swdx の中に project.json がありません")?;
    String::from_utf8(json).map_err(|_| BAD.into())
}

#[cfg(test)]
mod tests {
    use super::swdx_json;
    use std::io::Write;

    /// テスト用の ZIP（台本アプリの saveSwdx と同じ：mimetype は無圧縮、project.json は deflate）
    fn zip(files: &[(&str, &[u8], bool)]) -> Vec<u8> {
        let (mut out, mut cent) = (Vec::new(), Vec::new());
        for (name, raw, deflate) in files {
            let data = if *deflate {
                let mut e =
                    flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
                e.write_all(raw).unwrap();
                e.finish().unwrap()
            } else {
                raw.to_vec()
            };
            let method: u16 = if *deflate { 8 } else { 0 };
            let off = out.len() as u32;
            out.extend(0x0403_4b50u32.to_le_bytes());
            out.extend([0u8; 4]);
            out.extend(method.to_le_bytes());
            out.extend([0u8; 8]);
            out.extend((data.len() as u32).to_le_bytes());
            out.extend((raw.len() as u32).to_le_bytes());
            out.extend((name.len() as u16).to_le_bytes());
            out.extend([0u8; 2]);
            out.extend(name.as_bytes());
            out.extend(&data);
            cent.extend(0x0201_4b50u32.to_le_bytes());
            cent.extend([0u8; 6]);
            cent.extend(method.to_le_bytes());
            cent.extend([0u8; 8]);
            cent.extend((data.len() as u32).to_le_bytes());
            cent.extend((raw.len() as u32).to_le_bytes());
            cent.extend((name.len() as u16).to_le_bytes());
            cent.extend([0u8; 12]);
            cent.extend(off.to_le_bytes());
            cent.extend(name.as_bytes());
        }
        let co = out.len() as u32;
        out.extend(&cent);
        out.extend(0x0605_4b50u32.to_le_bytes());
        out.extend([0u8; 4]);
        out.extend((files.len() as u16).to_le_bytes());
        out.extend((files.len() as u16).to_le_bytes());
        out.extend((cent.len() as u32).to_le_bytes());
        out.extend(co.to_le_bytes());
        out.extend([0u8; 2]);
        out
    }

    #[test]
    fn reads_project_json_from_swdx() {
        let b = zip(&[
            ("mimetype", b"application/vnd.yahibo.swdx", false),
            (
                "project.json",
                "{\"app\":\"Yahibo Scenario Writer\",\"title\":\"商店街\"}".as_bytes(),
                true,
            ),
        ]);
        let j = swdx_json(&b).unwrap();
        assert!(j.contains("商店街"));
        let other = zip(&[("mimetype", b"application/zip", false)]);
        assert!(swdx_json(&other)
            .unwrap_err()
            .contains(".swdx ではありません"));
        assert!(swdx_json(b"PK\x03\x04 broken").is_err());
    }
}

/// 連携ファイルの更新を見張る（path が空なら見張りをやめる）。変わったら "script-changed" を送る
#[tauri::command]
pub async fn script_watch(app: AppHandle, path: Option<String>) -> Result<(), String> {
    let slot = WATCH.get_or_init(|| Mutex::new(None));
    if let Some(tx) = slot.lock().unwrap().take() {
        let _ = tx.send(true);
    }
    let Some(path) = path.filter(|s| !s.is_empty()) else {
        return Ok(());
    };
    let p = PathBuf::from(&path);
    state(&app).check(&p)?;
    let (tx, mut rx) = watch::channel(false);
    *slot.lock().unwrap() = Some(tx);
    tauri::async_runtime::spawn(async move {
        let mut last = stamp(&p);
        loop {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(1500)) => {}
                _ = rx.changed() => return,
            }
            if *rx.borrow() {
                return;
            }
            let now = stamp(&p);
            // 書きかけを読まないよう、変わってからもう一度同じになるのを待つ
            if now.is_some() && now != last {
                tokio::time::sleep(Duration::from_millis(400)).await;
                let again = stamp(&p);
                if again != now {
                    continue;
                }
                last = now;
                let _ = app.emit("script-changed", json!({ "path": path }));
            } else if now.is_none() {
                last = None;
            }
        }
    });
    Ok(())
}
