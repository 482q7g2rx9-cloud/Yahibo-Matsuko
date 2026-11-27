//! 台本連携（M4）：台本アプリが書き出す ○○.link.json を選ぶ・読む・更新を見張る。
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
            .add_filter("台本の連携ファイル（.link.json）", &["json"])
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
    tokio::fs::read_to_string(&p)
        .await
        .map_err(|e| format!("台本の連携ファイルを読めませんでした：{e}"))
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
