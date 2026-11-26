//! Matsuko Editor のデスクトップ版（Tauri）。
//!
//! M0：画面（WebView）を表示し、同梱した FFmpeg を呼べることを確かめる。
//! 素材の処理や書き出しは M1 以降でここに足していく（docs/tauri-plan.md）。

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![commands::env_info])
        .run(tauri::generate_context!())
        .expect("Matsuko Editor を起動できませんでした");
}
