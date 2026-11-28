//! 色補正（M6）：LUT（.cube）を選ぶ・読む。LUT の計算と、プレビュー・書き出しの LUT は画面側（src/core/color.ts）。

use std::path::PathBuf;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// .cube の大きさの上限（65×65×65 の LUT でも 10MB ほど）
const MAX_BYTES: u64 = 64 * 1024 * 1024;

/// LUT のファイルを選ぶ
#[tauri::command]
pub async fn lut_pick(app: AppHandle) -> Option<String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("LUT を選ぶ")
            .add_filter("3D LUT（.cube）", &["cube"])
            .blocking_pick_file()
    })
    .await
    .ok()??;
    let p: PathBuf = picked.into_path().ok()?;
    Some(p.to_string_lossy().into_owned())
}

/// LUT のファイルを読む（拡張子が .cube のファイルだけ）
#[tauri::command]
pub async fn lut_read(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let ok = p
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("cube"));
    if !ok {
        return Err("LUT（.cube）のファイルではありません".into());
    }
    let len = std::fs::metadata(&p)
        .map_err(|_| format!("LUT のファイルが見つかりません：{path}"))?
        .len();
    if len > MAX_BYTES {
        return Err("LUT のファイルが大きすぎます".into());
    }
    tokio::fs::read_to_string(&p)
        .await
        .map_err(|e| format!("LUT のファイルを読めませんでした：{e}"))
}
