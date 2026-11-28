//! 書き出し（M3）。組み立てと実行は matsuko-core（export.rs・run.rs）が行い、ここは画面とのやりとりを受け持つ。
//!
//! 1. 画面が保存先を選ぶ（export_pick）。選ばれた場所だけに書ける
//! 2. 画面がプロジェクト・設定・テロップの画像を渡して始める（export_start）
//! 3. 進み具合を "export-job" イベントで知らせる。中止は export_cancel

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use matsuko_core::export::{Fps, Settings, TitleImage, H264_ENCODERS};
use matsuko_core::model::Project;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::state::state;
use crate::tools;

/// 書き出しの状態：選ばれた保存先と、動いている書き出しの中止の合図
#[derive(Default)]
pub struct Exports {
    outputs: Mutex<HashSet<PathBuf>>,
    running: Mutex<Vec<(String, Arc<AtomicBool>)>>,
}

/// 保存先を選ぶ（name は最初に入れておく名前、ext は mp4 / m4a）
#[tauri::command]
pub async fn export_pick(app: AppHandle, name: String, ext: String) -> Option<String> {
    let a = app.clone();
    let start = state(&app).current().map(|p| p.dir);
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let label = if ext == "m4a" {
            "音声（M4A）"
        } else {
            "動画（MP4）"
        };
        let mut d = a
            .dialog()
            .file()
            .set_title("書き出す場所")
            .set_file_name(&name)
            .add_filter(label, &[ext.as_str()]);
        if let Some(dir) = start {
            d = d.set_directory(dir);
        }
        d.blocking_save_file()
    })
    .await
    .ok()??;
    let p = picked.into_path().ok()?;
    app.state::<Exports>()
        .outputs
        .lock()
        .unwrap()
        .insert(p.clone());
    Some(p.to_string_lossy().into_owned())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleReq {
    clip: String,
    /// PNG を base64 にしたもの
    png: String,
    #[serde(default)]
    scroll: bool,
}

/// 色補正の LUT（M6）。同じ補正のクリップは 1 つの LUT を使う
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LutReq {
    clips: Vec<String>,
    /// .cube の中身
    cube: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReq {
    id: String,
    out: String,
    project: Value,
    #[serde(default)]
    titles: Vec<TitleReq>,
    #[serde(default)]
    luts: Vec<LutReq>,
    width: u32,
    height: u32,
    fps: String,
    from: f64,
    to: f64,
    #[serde(default)]
    audio_only: bool,
    video_bitrate: u64,
    audio_bitrate: u64,
    /// 音声のサンプリング周波数（プロジェクト設定。既定は 48000）
    #[serde(default)]
    audio_rate: Option<u32>,
}

fn emit(app: &AppHandle, id: &str, st: &str, p: f64, data: Value) {
    let _ = app.emit(
        "export-job",
        json!({"id": id, "state": st, "p": p, "data": data}),
    );
}

/// 同梱の FFmpeg で使える H.264 のエンコーダー（好ましい順）
async fn h264_encoders() -> Vec<String> {
    let out = tools::command("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .output()
        .await;
    let text = out
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    let have: Vec<&str> = text
        .lines()
        .filter_map(|l| l.split_whitespace().nth(1))
        .collect();
    H264_ENCODERS
        .iter()
        .filter(|e| have.contains(e))
        .map(|e| e.to_string())
        .collect()
}

/// 書き出しを始める。すぐに戻り、進み具合と結果は "export-job" で届く
#[tauri::command]
pub async fn export_start(app: AppHandle, req: ExportReq) -> Result<(), String> {
    let out = PathBuf::from(&req.out);
    if !app
        .state::<Exports>()
        .outputs
        .lock()
        .unwrap()
        .contains(&out)
    {
        return Err("書き出す場所を選び直してください".into());
    }
    let project: Project = serde_json::from_value(req.project.clone())
        .map_err(|e| format!("プロジェクトを読めませんでした：{e}"))?;
    let work = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("export")
        .join(crate::project_safe_id(&req.id));
    std::fs::create_dir_all(&work)
        .map_err(|e| format!("作業用のフォルダーを作れませんでした：{e}"))?;
    let mut titles = vec![];
    for (i, t) in req.titles.iter().enumerate() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(t.png.trim_start_matches("data:image/png;base64,"))
            .map_err(|e| e.to_string())?;
        let path = work.join(format!("title{i:03}.png"));
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        titles.push(TitleImage {
            clip: t.clip.clone(),
            path,
            scroll: t.scroll,
        });
    }
    let mut luts = std::collections::HashMap::new();
    for (i, l) in req.luts.iter().enumerate() {
        let name = format!("lut{i:03}.cube");
        std::fs::write(work.join(&name), &l.cube).map_err(|e| e.to_string())?;
        for c in &l.clips {
            luts.insert(c.clone(), name.clone());
        }
    }
    let settings = Settings {
        width: req.width.max(16) / 2 * 2,
        height: req.height.max(16) / 2 * 2,
        fps: Fps::parse(&req.fps),
        from: req.from,
        to: req.to,
        audio_only: req.audio_only,
        video_bitrate: req.video_bitrate,
        audio_bitrate: req.audio_bitrate,
        audio_rate: req.audio_rate.unwrap_or(48_000),
        luts,
    };
    let encoders = h264_encoders().await;
    let cancel = Arc::new(AtomicBool::new(false));
    app.state::<Exports>()
        .running
        .lock()
        .unwrap()
        .push((req.id.clone(), cancel.clone()));
    let id = req.id.clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let ffmpeg = tools::tool_path("ffmpeg");
        let mut last = Instant::now() - Duration::from_secs(1);
        let r = matsuko_core::run::export(
            &ffmpeg,
            &project,
            &titles,
            &settings,
            &work,
            &out,
            &encoders,
            &cancel,
            |p| {
                if last.elapsed() > Duration::from_millis(250) {
                    last = Instant::now();
                    emit(&app2, &id, "progress", p, Value::Null);
                }
            },
        );
        matsuko_core::run::clean(&work);
        app2.state::<Exports>()
            .running
            .lock()
            .unwrap()
            .retain(|(j, _)| j != &id);
        match r {
            Ok(done) => {
                state(&app2).allow(&app2, &out);
                let size = std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
                emit(
                    &app2,
                    &id,
                    "done",
                    1.0,
                    json!({"out": out.to_string_lossy(), "elapsed": done.elapsed, "encoder": done.encoder, "size": size}),
                );
            }
            Err(e) => {
                if out.is_file() && cancel.load(Ordering::Relaxed) {
                    let _ = std::fs::remove_file(&out);
                }
                emit(&app2, &id, "error", 0.0, json!({"message": e}));
            }
        }
    });
    Ok(())
}

/// 書き出しを中止する
#[tauri::command]
pub fn export_cancel(app: AppHandle, id: String) {
    for (j, c) in app.state::<Exports>().running.lock().unwrap().iter() {
        if *j == id {
            c.store(true, Ordering::Relaxed);
        }
    }
}

/// アプリを終えるとき：動いている書き出しをすべて止める
pub fn cancel_all(app: &AppHandle) {
    for (_, c) in app.state::<Exports>().running.lock().unwrap().iter() {
        c.store(true, Ordering::Relaxed);
    }
}
