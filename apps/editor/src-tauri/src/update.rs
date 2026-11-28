//! M5：自動更新とログ。
//!
//! 更新：GitHub の Releases に置いた latest.json を見て、新しい版があれば署名を確かめてから入れ直す。
//! 署名の公開鍵は、ビルドのときの環境変数 MATSUKO_UPDATER_PUBKEY から埋め込む（CI ではリポジトリの変数）。
//! 鍵のないビルド（開発中や、鍵を設定する前の CI）では更新の機能を出さない。
//! Windows のインストーラーは「このユーザーだけ」に入れる形式なので、更新にも管理者の権限は要らない。
//!
//! ログ：アプリのログフォルダー（Windows は %LOCALAPPDATA%\jp.yahibo.matsuko-editor\logs など）に
//! matsuko.log として残す（5MB で切り替え、古いものは 5 つまで）。画面のエラーもここに書く。

use std::sync::Mutex;

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::{Update, UpdaterExt};

/// ビルドのときに埋め込んだ、更新の署名の公開鍵（ないときは空）
const PUBKEY_RAW: &str = match option_env!("MATSUKO_UPDATER_PUBKEY") {
    Some(k) => k,
    None => "",
};

/// 公開鍵（前後の空白・改行を除いたもの）
pub fn pubkey() -> &'static str {
    PUBKEY_RAW.trim()
}

#[derive(Default)]
pub struct Updates(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// 更新の機能が使えるか（公開鍵を埋め込んだビルドか）
    enabled: bool,
    current: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    version: String,
    notes: Option<String>,
    date: Option<String>,
}

#[tauri::command]
pub fn update_info(app: AppHandle) -> UpdateInfo {
    UpdateInfo {
        enabled: !pubkey().is_empty(),
        current: app.package_info().version.to_string(),
    }
}

/// 新しい版があるか調べる（なければ None）
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<Available>, String> {
    if pubkey().is_empty() {
        return Err("このビルドでは更新を確認できません".into());
    }
    let mut b = app.updater_builder().pubkey(pubkey());
    // 試験用：MATSUKO_UPDATE_URL で、確認する latest.json の場所を変えられる
    if let Some(url) = std::env::var("MATSUKO_UPDATE_URL")
        .ok()
        .and_then(|u| u.parse().ok())
    {
        b = b.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    let u = b
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| {
            log::warn!("更新の確認に失敗：{e}");
            format!("更新を確認できませんでした：{e}")
        })?;
    let out = u.as_ref().map(|u| Available {
        version: u.version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    });
    if let Some(a) = &out {
        log::info!("新しいバージョンがあります：{}", a.version);
    }
    *app.state::<Updates>().0.lock().unwrap() = u;
    Ok(out)
}

/// 見つけた版を入れて、アプリを起動し直す。進み具合は "update-progress"（0〜1）で送る
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let u = app
        .state::<Updates>()
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or("先に更新を確認してください")?;
    log::info!(
        "更新をインストールします：{} → {}",
        u.current_version,
        u.version
    );
    let (a, b) = (app.clone(), app.clone());
    let mut got: u64 = 0;
    u.download_and_install(
        move |n, total| {
            got += n as u64;
            let p = total.map(|t| got as f64 / t.max(1) as f64).unwrap_or(0.0);
            let _ = a.emit("update-progress", json!({ "p": p.min(1.0) }));
        },
        move || {
            let _ = b.emit("update-progress", json!({ "p": 1.0, "done": true }));
        },
    )
    .await
    .map_err(|e| {
        log::error!("更新をインストールできませんでした：{e}");
        format!("更新をインストールできませんでした：{e}")
    })?;
    log::info!("更新をインストールしました。再起動します");
    app.restart();
}

/// 画面から送られたログ（エラーなど）を書く
#[tauri::command]
pub fn log_write(level: String, message: String) {
    let m: String = message.chars().take(4000).collect();
    match level.as_str() {
        "error" => log::error!("[画面] {m}"),
        "warn" => log::warn!("[画面] {m}"),
        _ => log::info!("[画面] {m}"),
    }
}

fn log_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_log_dir().map_err(|e| e.to_string())
}

/// ログのフォルダーを開く（OS のファイル管理の画面で）
#[tauri::command]
pub fn log_open(app: AppHandle) -> Result<(), String> {
    let d = log_dir(&app)?;
    let _ = std::fs::create_dir_all(&d);
    let prog = if cfg!(target_os = "windows") {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    std::process::Command::new(prog)
        .arg(&d)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("ログのフォルダーを開けませんでした：{e}"))
}

/// ログをまとめて 1 つのファイルに保存する（先生や開発者に送るため）。保存先はダイアログで選ぶ
#[tauri::command]
pub async fn log_save(app: AppHandle) -> Result<Option<String>, String> {
    let d = log_dir(&app)?;
    let mut files: Vec<_> = std::fs::read_dir(&d)
        .map(|r| {
            r.flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "log"))
                .collect()
        })
        .unwrap_or_default();
    files.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
    let mut text = format!(
        "Matsuko Editor {}（{} / {}）\n",
        app.package_info().version,
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    for f in &files {
        text.push_str(&format!(
            "\n===== {} =====\n",
            f.file_name().unwrap_or_default().to_string_lossy()
        ));
        text.push_str(&String::from_utf8_lossy(
            &std::fs::read(f).unwrap_or_default(),
        ));
    }
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        a.dialog()
            .file()
            .set_title("ログを保存")
            .set_file_name("matsuko-editor-log.txt")
            .add_filter("テキスト", &["txt"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(p) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    std::fs::write(&p, text).map_err(|e| format!("保存できませんでした：{e}"))?;
    Ok(Some(p.to_string_lossy().into_owned()))
}

/// ログの設定（プラグイン）
pub fn log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
    tauri_plugin_log::Builder::new()
        .targets([
            Target::new(TargetKind::LogDir {
                file_name: Some("matsuko".into()),
            }),
            Target::new(TargetKind::Stdout),
        ])
        .level(log::LevelFilter::Info)
        .max_file_size(5 * 1024 * 1024)
        .rotation_strategy(RotationStrategy::KeepSome(5))
        .build()
}
