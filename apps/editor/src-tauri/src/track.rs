//! トラッキング（M6・デスクトップ版のみ）：素材のその部分を FFmpeg で幅 480 のグレーの絵にして読み、
//! matsuko-core の track で四角を追う。進み具合と結果は "track-job" で知らせる。

use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::state::state;
use crate::tools;

/// 解析する絵の幅
const AW: usize = 480;
/// 一度に追う長さの上限（秒）
const MAX_SECONDS: f64 = 180.0;

static RUNNING: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
fn running() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackReq {
    id: String,
    path: String,
    /// 追い始める素材の秒と、そのときの四角（絵の幅・高さに対する割合：左, 上, 幅, 高さ）
    at: f64,
    r#box: [f64; 4],
    /// 追う範囲の端（素材の秒）。前方なら終わり、後方なら始め
    until: f64,
    back: bool,
    fps: f64,
    /// 絵の幅 ÷ 高さ
    ar: f64,
}

fn emit(app: &AppHandle, id: &str, st: &str, p: f64, data: Value) {
    let _ = app.emit(
        "track-job",
        json!({"id": id, "state": st, "p": p, "data": data}),
    );
}

/// 追い始める。すぐに戻り、結果は "track-job" で届く（data.pts：[素材の秒, 中心の横の割合, 縦の割合] の列、data.lost：見失った素材の秒）
#[tauri::command]
pub fn track_start(app: AppHandle, req: TrackReq) -> Result<(), String> {
    let path = std::path::PathBuf::from(&req.path);
    if !path.is_file() {
        return Err("素材のファイルが見つかりません".into());
    }
    // 読み込んだ素材（プロジェクトの素材・選んだファイル）だけ読む
    state(&app).check(&path)?;
    let fps = req.fps.clamp(1.0, 120.0);
    let (a, b) = if req.back {
        (req.until.max(0.0), req.at)
    } else {
        (req.at, req.until)
    };
    let dur = (b - a).clamp(0.0, MAX_SECONDS);
    if dur < 1.0 / fps {
        return Err("追う長さがありません".into());
    }
    let ah = (((AW as f64 / req.ar.max(0.1)) / 2.0).round() as usize * 2).clamp(16, 2000);
    let cancel = Arc::new(AtomicBool::new(false));
    running()
        .lock()
        .unwrap()
        .insert(req.id.clone(), cancel.clone());
    std::thread::spawn(move || {
        let r = run(&app, &req, &path, a, dur, fps, ah, &cancel);
        running().lock().unwrap().remove(&req.id);
        match r {
            Ok(v) => emit(&app, &req.id, "done", 1.0, v),
            Err(e) => emit(&app, &req.id, "error", 0.0, json!({"message": e})),
        }
    });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn run(
    app: &AppHandle,
    req: &TrackReq,
    path: &std::path::Path,
    a: f64,
    dur: f64,
    fps: f64,
    ah: usize,
    cancel: &AtomicBool,
) -> Result<Value, String> {
    let total = (dur * fps).ceil().max(1.0) as usize;
    let mut c = Command::new(tools::tool_path("ffmpeg"));
    c.args([
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-ss",
        &format!("{a:.3}"),
        "-t",
        &format!("{dur:.3}"),
        "-i",
    ])
    .arg(path)
    .args([
        "-an",
        "-vf",
        &format!("fps={fps:.6},scale={AW}:{ah}:flags=area,format=gray"),
        "-f",
        "rawvideo",
        "-",
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let mut child = c
        .spawn()
        .map_err(|e| format!("FFmpeg を起動できませんでした：{e}"))?;
    let mut out = child.stdout.take().ok_or("FFmpeg の出力を読めません")?;
    let size = AW * ah;
    let mut frames: Vec<Vec<u8>> = Vec::with_capacity(total);
    loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            return Err("中止しました".into());
        }
        let mut f = vec![0u8; size];
        if out.read_exact(&mut f).is_err() {
            break;
        }
        frames.push(f);
        if frames.len() % 10 == 0 {
            emit(
                app,
                &req.id,
                "progress",
                0.5 * frames.len() as f64 / total as f64,
                Value::Null,
            );
        }
    }
    let _ = child.wait();
    if frames.is_empty() {
        return Err("素材を読めませんでした".into());
    }
    if req.back {
        frames.reverse();
    }
    let n = frames.len();
    let bx = req.r#box;
    let init = (
        bx[0] * AW as f64,
        bx[1] * ah as f64,
        bx[2] * AW as f64,
        bx[3] * ah as f64,
    );
    let mut last = std::time::Instant::now();
    let pts = matsuko_core::track::track(&frames, AW, ah, init, |k| {
        if last.elapsed().as_millis() > 150 {
            last = std::time::Instant::now();
            emit(
                app,
                &req.id,
                "progress",
                0.5 + 0.5 * k as f64 / n as f64,
                Value::Null,
            );
        }
        !cancel.load(Ordering::Relaxed)
    });
    if cancel.load(Ordering::Relaxed) {
        return Err("中止しました".into());
    }
    // 素材の秒：前方は at から、後方は at から戻る
    let first = if req.back {
        a + (n - 1) as f64 / fps
    } else {
        a
    };
    let sec = |k: usize| {
        if req.back {
            first - k as f64 / fps
        } else {
            a + k as f64 / fps
        }
    };
    let list: Vec<[f64; 3]> = pts
        .iter()
        .enumerate()
        .map(|(k, p)| {
            [
                (sec(k) * 1e4).round() / 1e4,
                p.0 / AW as f64,
                p.1 / ah as f64,
            ]
        })
        .collect();
    let lost = if pts.len() < n {
        Some(sec(pts.len()))
    } else {
        None
    };
    Ok(json!({"pts": list, "lost": lost, "back": req.back}))
}

/// 追うのをやめる
#[tauri::command]
pub fn track_cancel(id: String) {
    if let Some(c) = running().lock().unwrap().get(&id) {
        c.store(true, Ordering::Relaxed);
    }
}
