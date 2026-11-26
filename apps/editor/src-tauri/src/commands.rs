//! 画面から呼ぶ命令のうち、どこにも属さないもの。型は apps/editor/src/host.ts と合わせる。

use serde::Serialize;
use tauri::AppHandle;

use crate::tools;

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
        ffmpeg: tools::version("ffmpeg").await,
        ffprobe: tools::version("ffprobe").await,
    }
}

/// 素材の URL の頭。Linux では内蔵のサーバー（server.rs）、ほかの OS では None（画面は asset: を使う）
#[tauri::command]
pub async fn media_base() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        // サーバーは起動直後に待ち受けを始めるので、少しだけ待つ
        for _ in 0..40 {
            if let Some(b) = crate::server::base() {
                return Some(b);
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        None
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}
