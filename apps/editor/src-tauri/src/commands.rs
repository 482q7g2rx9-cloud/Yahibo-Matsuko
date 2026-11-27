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

/// PC に入っているフォント（テロップで使う）。family は canvas の font に入れる名前、name は画面に出す名前（日本語名があればそれ）
#[derive(Serialize, Clone)]
pub struct SysFont {
    pub family: String,
    pub name: String,
}

static SYS_FONTS: std::sync::OnceLock<Vec<SysFont>> = std::sync::OnceLock::new();

fn load_sys_fonts() -> Vec<SysFont> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut map = std::collections::BTreeMap::<String, String>::new();
    for face in db.faces() {
        let Some((family, _)) = face.families.first() else {
            continue;
        };
        // macOS の「.SF NS」のような、アプリから使わない内部のフォントは出さない
        if family.is_empty() || family.starts_with('.') {
            continue;
        }
        let ja = face
            .families
            .iter()
            .find(|(_, l)| *l == fontdb::Language::Japanese_Japan)
            .map(|(n, _)| n.clone());
        let e = map.entry(family.clone()).or_insert_with(|| family.clone());
        if let Some(ja) = ja {
            *e = ja;
        }
    }
    let mut v: Vec<SysFont> = map
        .into_iter()
        .map(|(family, name)| SysFont { family, name })
        .collect();
    v.sort_by_key(|a| a.name.to_lowercase());
    v
}

#[tauri::command]
pub async fn system_fonts() -> Vec<SysFont> {
    if let Some(v) = SYS_FONTS.get() {
        return v.clone();
    }
    let v = tokio::task::spawn_blocking(load_sys_fonts)
        .await
        .unwrap_or_default();
    SYS_FONTS.get_or_init(|| v).clone()
}
