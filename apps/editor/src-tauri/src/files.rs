//! 書き出したファイルの保存。保存先は Rust 側のダイアログで選び、選ばれた場所にだけ書く。

use std::path::PathBuf;

use tauri::ipc::{InvokeBody, Request};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::state::state;

/// 保存先を選ぶ。`name` は最初に入っている名前、`ext` は拡張子（mp4 / webm など）
#[tauri::command]
pub async fn save_pick(app: AppHandle, name: String, ext: String) -> Option<String> {
    let a = app.clone();
    let start = state(&app).current().map(|p| p.dir);
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut d = a
            .dialog()
            .file()
            .set_title("書き出す")
            .set_file_name(&name)
            .add_filter(ext.to_uppercase(), &[ext.as_str()]);
        if let Some(dir) = start {
            d = d.set_directory(dir);
        }
        d.blocking_save_file()
    })
    .await
    .ok()??;
    let p: PathBuf = picked.into_path().ok()?;
    *state(&app).save_target.lock().unwrap() = Some(p.clone());
    Some(p.to_string_lossy().into_owned())
}

/// 選ばれた保存先に、送られてきたバイト列をそのまま書く
#[tauri::command]
pub async fn save_write(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let target = state(&app)
        .save_target
        .lock()
        .unwrap()
        .take()
        .ok_or("保存先が選ばれていません")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("保存する内容がありません".into());
    };
    tokio::fs::write(&target, bytes)
        .await
        .map_err(|e| format!("保存できませんでした：{e}"))
}
