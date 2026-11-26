//! 画面から呼ぶ命令。型は apps/editor/src/ipc.ts と合わせる。

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

/// 動作環境の情報（ヘルプ → バージョン情報 で表示する）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvInfo {
    app_version: String,
    os: String,
    arch: String,
    /// `ffmpeg -version` の1行目。同梱されていない・起動できないときは None
    ffmpeg: Option<String>,
    ffprobe: Option<String>,
}

#[tauri::command]
pub async fn env_info(app: AppHandle) -> EnvInfo {
    EnvInfo {
        app_version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        ffmpeg: tool_version(&app, "ffmpeg").await,
        ffprobe: tool_version(&app, "ffprobe").await,
    }
}

/// 同梱したツール（sidecar）を `-version` で起動し、1行目を返す
async fn tool_version(app: &AppHandle, name: &str) -> Option<String> {
    let out = app.shell().sidecar(name).ok()?.args(["-version"]).output().await.ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    // 例：「ffmpeg version 7.1.1 Copyright (c) ...」→「ffmpeg version 7.1.1」
    let line = text.lines().next()?;
    Some(line.split(" Copyright").next().unwrap_or(line).trim().to_string())
}
