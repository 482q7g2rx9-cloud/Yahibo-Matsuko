//! Matsuko Editor のデスクトップ版（Tauri）。
//!
//! M0：画面（WebView）を表示し、同梱した FFmpeg を呼べることを確かめる。
//! M1：プロジェクトフォルダーの新規・開く・自動保存、素材の読み込み（ダイアログ・ドロップ）、
//!     ffprobe の解析、サムネイル・波形・プロキシの作業キュー、素材のリンクし直し。
//! M2：変更履歴（history.sqlite）。
//! M3：書き出し（export.rs。組み立てと実行は matsuko-core）。
//! 計画は docs/tauri-plan.md。

mod commands;
mod export;
mod files;
mod history;
mod media;
mod project;
#[cfg(target_os = "linux")]
mod server;
mod state;
mod tools;

use tauri::{DragDropEvent, Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .manage(history::History::default())
        .manage(export::Exports::default())
        .setup(|app| {
            // 開発版だけ：MATSUKO_DEVTOOLS=1 で開発者ツールを開く（画面の不具合を調べるため）
            #[cfg(debug_assertions)]
            if std::env::var_os("MATSUKO_DEVTOOLS").is_some() {
                if let Some(w) = app.get_webview_window("main") {
                    w.open_devtools();
                }
            }
            #[cfg(target_os = "linux")]
            server::start(app.handle().clone());
            let _ = app;
            Ok(())
        })
        .on_window_event(|w, e| {
            // OS からのドロップは Rust で受け、使ってよいファイルとして覚えてから画面に知らせる
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, position }) = e {
                let scale = w.scale_factor().unwrap_or(1.0);
                let pos = position.to_logical::<f64>(scale);
                media::on_drop(w.app_handle(), paths, pos.x, pos.y);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::env_info,
            commands::media_base,
            project::project_default_location,
            project::project_pick_location,
            project::project_create,
            project::project_open_dialog,
            project::project_last,
            project::project_recent,
            project::project_open_recent,
            project::project_save,
            media::media_pick,
            media::media_probe,
            media::media_process,
            media::media_cancel,
            history::history_add,
            history::history_list,
            history::history_get,
            history::history_delete,
            export::export_pick,
            export::export_start,
            export::export_cancel,
            files::save_pick,
            files::save_write,
        ])
        .build(tauri::generate_context!())
        .expect("Matsuko Editor を起動できませんでした");
    app.run(|app, e| {
        if let RunEvent::Exit = e {
            // 作りかけのプロキシなどの FFmpeg を止める
            app.state::<state::AppState>().cancel_all();
            export::cancel_all(app);
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
    });
}

/// 画面から来た id を、フォルダー名に使える形にする
pub(crate) fn project_safe_id(id: &str) -> String {
    let s: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(40)
        .collect();
    format!("{s}-job")
}
