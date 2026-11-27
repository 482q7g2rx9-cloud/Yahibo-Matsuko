//! 素材：選ぶ・解析する・サムネイル／波形／プロキシを作る。
//!
//! 重い処理はすべて FFmpeg の別プロセスで行い、進み具合を "media-job" イベントで画面に知らせる。
//! 画面は待たずに操作を続けられる（M1 の目安：30分の 4K 素材でもプロキシ作成中に操作が止まらない）。

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use base64::Engine;
use matsuko_core::{
    peaks::{WaveformAccumulator, WAVE_RATE},
    probe::{self, MediaInfo},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::sync::watch;

use crate::state::state;
use crate::tools;

const VIDEO_EXT: &[&str] = &[
    "mp4", "mov", "m4v", "webm", "mkv", "avi", "mts", "m2ts", "mxf", "wmv", "mpg", "mpeg",
];
const AUDIO_EXT: &[&str] = &[
    "mp3", "wav", "m4a", "aac", "ogg", "flac", "opus", "aif", "aiff", "wma",
];
const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"];

/// 素材を選ぶダイアログ。`multiple` が false なら1つだけ（リンクし直すとき）
#[tauri::command]
pub async fn media_pick(app: AppHandle, multiple: bool) -> Vec<String> {
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let all: Vec<&str> = VIDEO_EXT
            .iter()
            .chain(AUDIO_EXT)
            .chain(IMAGE_EXT)
            .copied()
            .collect();
        let d = a
            .dialog()
            .file()
            .set_title(if multiple {
                "素材を読み込む"
            } else {
                "素材をリンクし直す"
            })
            .add_filter("映像・音声・画像", &all)
            .add_filter("映像", VIDEO_EXT)
            .add_filter("音声", AUDIO_EXT)
            .add_filter("画像", IMAGE_EXT);
        if multiple {
            d.blocking_pick_files().unwrap_or_default()
        } else {
            d.blocking_pick_file().into_iter().collect()
        }
    })
    .await
    .unwrap_or_default();
    let st = state(&app);
    picked
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .map(|p| {
            st.allow(&app, &p);
            p.to_string_lossy().into_owned()
        })
        .collect()
}

/// OS からドロップされたファイル：使ってよい一覧に入れてから画面に知らせる
pub fn on_drop(app: &AppHandle, paths: &[PathBuf], x: f64, y: f64) {
    let st = state(app);
    let mut list = Vec::new();
    for p in paths {
        if p.is_file() {
            st.allow(app, p);
            list.push(p.to_string_lossy().into_owned());
        }
    }
    let _ = app.emit("files-dropped", json!({"paths": list, "x": x, "y": y}));
}

/// 解析の結果（1ファイルごと）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probed {
    pub path: String,
    /// ファイル名（拡張子つき）
    pub file: String,
    pub size: u64,
    pub info: Option<MediaInfo>,
    pub error: Option<String>,
}

/// ffprobe で素材を解析する
#[tauri::command]
pub async fn media_probe(app: AppHandle, paths: Vec<String>) -> Vec<Probed> {
    let mut out = Vec::new();
    for p in paths {
        let path = PathBuf::from(&p);
        let file = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let r = match state(&app).check(&path) {
            Err(e) => Err(e),
            Ok(()) => probe_one(&path).await,
        };
        let (info, error) = match r {
            Ok(i) => (Some(i), None),
            Err(e) => (None, Some(e)),
        };
        out.push(Probed {
            path: p,
            file,
            size,
            info,
            error,
        });
    }
    out
}

async fn probe_one(path: &Path) -> Result<MediaInfo, String> {
    let out = tools::command("ffprobe")
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .output()
        .await
        .map_err(|e| format!("ffprobe を起動できませんでした：{e}"))?;
    if !out.status.success() {
        return Err(format!(
            "読み込めない形式です（{}）",
            tools::tail(&out.stderr)
        ));
    }
    probe::parse_ffprobe(&String::from_utf8_lossy(&out.stdout))
        .ok_or_else(|| "映像も音声も入っていないファイルです".into())
}

/// 作ってほしいもの（1素材ごと）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobReq {
    pub id: String,
    pub path: String,
    /// 映像・音声・画像
    pub kind: String,
    pub duration: f64,
    #[serde(default)]
    pub thumb: bool,
    #[serde(default)]
    pub peaks: bool,
    #[serde(default)]
    pub proxy: bool,
    /// プロキシの高さ（プロジェクト設定。既定は 720）
    #[serde(default)]
    pub proxy_height: Option<u32>,
}

/// 画面に送る進み具合
#[derive(Debug, Clone, Serialize)]
struct JobEvent {
    id: String,
    kind: &'static str,
    /// progress / done / error
    state: &'static str,
    p: f64,
    data: Value,
}

fn emit(app: &AppHandle, id: &str, kind: &'static str, st: &'static str, p: f64, data: Value) {
    let _ = app.emit(
        "media-job",
        JobEvent {
            id: id.into(),
            kind,
            state: st,
            p,
            data,
        },
    );
}

/// サムネイル・波形・プロキシの作成をキューに入れる。すぐに戻り、結果はイベントで届く
#[tauri::command]
pub async fn media_process(app: AppHandle, items: Vec<JobReq>) -> Result<(), String> {
    let cur = state(&app)
        .current()
        .ok_or("プロジェクトが開かれていません")?;
    for it in items {
        let src = PathBuf::from(&it.path);
        state(&app).check(&src)?;
        let kinds: [(&'static str, bool); 3] = [
            ("thumb", it.thumb),
            ("peaks", it.peaks),
            ("proxy", it.proxy),
        ];
        for (kind, on) in kinds {
            if !on {
                continue;
            }
            let key = format!("{}:{kind}", it.id);
            let (tx, rx) = watch::channel(false);
            {
                let st = state(&app);
                let mut jobs = st.jobs.lock().unwrap();
                if jobs.contains_key(&key) {
                    continue;
                }
                jobs.insert(key.clone(), tx);
            }
            let (app2, it2, src2, dir) = (app.clone(), it.clone(), src.clone(), cur.clone());
            tauri::async_runtime::spawn(async move {
                let st = state(&app2);
                let sem = if kind == "proxy" {
                    &st.heavy
                } else {
                    &st.light
                };
                let permit = sem.acquire().await;
                let r = if *rx.borrow() {
                    Err("中止しました".to_string())
                } else {
                    match kind {
                        "thumb" => make_thumb(&it2, &src2, &dir.cache("thumb")).await,
                        "peaks" => {
                            make_peaks_cached(&app2, &it2, &src2, &dir.cache("wave"), rx.clone())
                                .await
                        }
                        _ => make_proxy(&app2, &it2, &src2, &dir.cache("proxy"), rx.clone()).await,
                    }
                };
                drop(permit);
                // 同じ作業が中止後に入れ直されていたら、その合図は消さない
                // 中止されたときは、合図はもう一覧から外れている（同じ作業が入れ直されていたら、そちらを残す）
                if !*rx.borrow() {
                    st.jobs.lock().unwrap().remove(&key);
                }
                match r {
                    Ok(data) => emit(&app2, &it2.id, kind, "done", 1.0, data),
                    Err(e) => emit(&app2, &it2.id, kind, "error", 0.0, json!({"message": e})),
                }
            });
        }
    }
    Ok(())
}

/// 素材の作業を止める（素材を削除したとき）
#[tauri::command]
pub fn media_cancel(app: AppHandle, ids: Vec<String>) {
    let st = state(&app);
    let mut jobs = st.jobs.lock().unwrap();
    let keys: Vec<String> = jobs
        .keys()
        .filter(|k| ids.iter().any(|id| k.starts_with(&format!("{id}:"))))
        .cloned()
        .collect();
    for k in keys {
        if let Some(tx) = jobs.remove(&k) {
            let _ = tx.send(true);
        }
    }
}

/// サムネイル（160×90 の JPEG）と、画面の色見本に使う平均の色
async fn make_thumb(it: &JobReq, src: &Path, dir: &Path) -> Result<Value, String> {
    let out = dir.join(format!("{}.jpg", it.id));
    let at = if it.kind == probe::KIND_VIDEO {
        (it.duration / 3.0).min(1.0).max(0.0)
    } else {
        0.0
    };
    let mut c = tools::command("ffmpeg");
    c.args(["-hide_banner", "-nostdin", "-y", "-v", "error"]);
    if at > 0.0 {
        c.args(["-ss", &format!("{at:.3}")]);
    }
    let r = c
        .arg("-i")
        .arg(src)
        .args([
            "-frames:v",
            "1",
            "-vf",
            "scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2:black",
            "-q:v",
            "5",
        ])
        .arg(&out)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status.success() || !out.is_file() {
        return Err(format!(
            "サムネイルを作れませんでした（{}）",
            tools::tail(&r.stderr)
        ));
    }
    let bytes = tokio::fs::read(&out).await.map_err(|e| e.to_string())?;
    let url = format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    );
    // 平均の色：1×1 に縮めた画素
    let mut c = tools::command("ffmpeg");
    c.args(["-hide_banner", "-nostdin", "-v", "error", "-i"])
        .arg(&out)
        .args([
            "-vf",
            "scale=1:1:flags=area",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ]);
    let col = match c.output().await {
        Ok(o) if o.stdout.len() >= 3 => {
            let (r, g, b) = (o.stdout[0] as f64, o.stdout[1] as f64, o.stdout[2] as f64);
            let hx = |v: f64| format!("{:02x}", v.clamp(0.0, 255.0) as u8);
            json!([
                format!("#{}{}{}", hx(r), hx(g), hx(b)),
                format!("#{}{}{}", hx(r * 0.72), hx(g * 0.72), hx(b * 0.72))
            ])
        }
        _ => Value::Null,
    };
    Ok(json!({"thumb": url, "col": col}))
}

/// 波形はプロジェクトの cache/wave に覚えておき、元のファイルが変わっていなければ作り直さない。
/// 詳しい波形は大きいので project.json には入れず（画面の forDisk で外す）、開くたびにここから読む
async fn make_peaks_cached(
    app: &AppHandle,
    it: &JobReq,
    src: &Path,
    dir: &Path,
    cancel: watch::Receiver<bool>,
) -> Result<Value, String> {
    let file = dir.join(format!("{}.json", it.id));
    let stamp = std::fs::metadata(src).ok().map(|m| {
        let t = m
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        json!([m.len(), t])
    });
    if let (Some(st), Ok(text)) = (&stamp, std::fs::read_to_string(&file)) {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            if v.get("stamp") == Some(st) && v.get("wf").is_some() {
                return Ok(json!({"peaks": v["peaks"], "wf": v["wf"]}));
            }
        }
    }
    let v = make_peaks(app, it, src, cancel).await?;
    if let (Some(st), Some(_)) = (stamp, v.get("wf")) {
        let _ = std::fs::create_dir_all(dir);
        let mut o = v.clone();
        o["stamp"] = st;
        let _ = std::fs::write(&file, o.to_string());
    }
    Ok(v)
}

/// 波形：16kHz の f32（左右があれば 2 チャンネル）を流してもらい、
/// タイムラインに描く詳しい波形と、無音の検出に使うピークを集める
async fn make_peaks(
    app: &AppHandle,
    it: &JobReq,
    src: &Path,
    mut cancel: watch::Receiver<bool>,
) -> Result<Value, String> {
    // チャンネル数（3 つ以上は 2 つにまとめる）。調べられなければモノラルにする
    let ch = match probe_one(src).await {
        Ok(info) if !info.has_audio => {
            return Ok(json!({"peaks": null, "noAudio": 1}));
        }
        Ok(info) => (info.channels as usize).clamp(1, 2),
        Err(_) => 1,
    };
    let mut child = tools::command("ffmpeg")
        .args(["-hide_banner", "-nostdin", "-v", "error", "-i"])
        .arg(src)
        .args([
            "-vn",
            "-ac",
            &ch.to_string(),
            "-ar",
            &WAVE_RATE.to_string(),
            "-f",
            "f32le",
            "pipe:1",
        ])
        .spawn()
        .map_err(|e| format!("FFmpeg を起動できませんでした：{e}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or("FFmpeg の出力を読めませんでした")?;
    let mut acc = WaveformAccumulator::new(it.duration, WAVE_RATE, ch);
    let mut buf = vec![0u8; 64 * 1024];
    let mut carry: Vec<u8> = Vec::new();
    let total = (it.duration * WAVE_RATE as f64).max(1.0);
    let mut last = Instant::now();
    loop {
        let n = tokio::select! {
            r = stdout.read(&mut buf) => r.map_err(|e| e.to_string())?,
            _ = cancel.changed() => { let _ = child.kill().await; return Err("中止しました".into()); }
        };
        if n == 0 {
            break;
        }
        carry.extend_from_slice(&buf[..n]);
        let rest = acc.push_bytes(&carry).to_vec();
        carry = rest;
        if last.elapsed() > Duration::from_millis(500) {
            last = Instant::now();
            emit(
                app,
                &it.id,
                "peaks",
                "progress",
                (acc.samples() as f64 / total).min(0.99),
                Value::Null,
            );
        }
    }
    let status = child.wait_with_output().await.map_err(|e| e.to_string())?;
    if !status.status.success() || acc.samples() == 0 {
        // 映像だけの素材など。画面では「音声なし」にする
        return Ok(json!({"peaks": null, "noAudio": 1}));
    }
    let (rate, n) = (acc.rate, acc.n);
    let (bytes, peaks) = acc.finish();
    Ok(json!({
        "peaks": peaks,
        "wf": {
            "v": 1,
            "r": rate,
            "ch": ch,
            "n": n,
            "d": base64::engine::general_purpose::STANDARD.encode(bytes),
        }
    }))
}

/// プロキシの作り方（エンコーダーごと）。上から順に、使えるものを試す。
/// 配布する FFmpeg は LGPL なので libx264 は入っていない（開発用の FFmpeg では使える）
fn encoder_args(enc: &str) -> Option<(&'static str, Vec<&'static str>)> {
    let aac = vec!["-c:a", "aac", "-b:a", "128k", "-ac", "2"];
    let v: Vec<&'static str> = match enc {
        "h264_videotoolbox" => vec!["-c:v", "h264_videotoolbox", "-b:v", "4M", "-allow_sw", "1"],
        "h264_mf" => vec!["-c:v", "h264_mf", "-b:v", "4M", "-rate_control", "cbr"],
        "libopenh264" => vec!["-c:v", "libopenh264", "-b:v", "4M"],
        "libx264" => vec!["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"],
        "libvpx-vp9" => {
            let mut a = vec![
                "-c:v",
                "libvpx-vp9",
                "-b:v",
                "2M",
                "-deadline",
                "realtime",
                "-cpu-used",
                "8",
                "-row-mt",
                "1",
            ];
            a.extend(["-c:a", "libopus", "-b:a", "128k", "-ac", "2"]);
            return Some(("webm", a));
        }
        _ => return None,
    };
    Some((
        "mp4",
        v.into_iter()
            .chain(aac)
            .chain(["-movflags", "+faststart"])
            .collect(),
    ))
}

const ENCODER_ORDER: &[&str] = &[
    "h264_videotoolbox",
    "h264_mf",
    "libopenh264",
    "libx264",
    "libvpx-vp9",
];

/// 同梱の FFmpeg で使えるエンコーダー（好ましい順）
async fn encoders(app: &AppHandle) -> Vec<String> {
    state(app)
        .encoders
        .get_or_init(|| async {
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
            ENCODER_ORDER
                .iter()
                .filter(|e| have.contains(e))
                .map(|e| e.to_string())
                .collect()
        })
        .await
        .clone()
}

/// プロキシ：高さ 720 以下・コマの間隔の短い（シークしやすい）軽い動画
async fn make_proxy(
    app: &AppHandle,
    it: &JobReq,
    src: &Path,
    dir: &Path,
    cancel: watch::Receiver<bool>,
) -> Result<Value, String> {
    // 音声だけの素材は AAC（m4a）にする
    if it.kind == probe::KIND_AUDIO {
        let args = vec!["-vn", "-c:a", "aac", "-b:a", "192k"];
        let p = encode(app, it, src, dir, "m4a", &args, cancel).await?;
        return Ok(json!({"proxyPath": p.to_string_lossy(), "encoder": "aac"}));
    }
    let list = encoders(app).await;
    if list.is_empty() {
        return Err("プロキシを作れるエンコーダーがありません".into());
    }
    let mut last_err = String::new();
    for enc in &list {
        let Some((ext, args)) = encoder_args(enc) else {
            continue;
        };
        match encode(app, it, src, dir, ext, &args, cancel.clone()).await {
            Ok(p) => return Ok(json!({"proxyPath": p.to_string_lossy(), "encoder": enc})),
            Err(e) if *cancel.borrow() => return Err(e),
            Err(e) => last_err = format!("{enc}：{e}"),
        }
    }
    Err(format!("プロキシを作れませんでした（{last_err}）"))
}

async fn encode(
    app: &AppHandle,
    it: &JobReq,
    src: &Path,
    dir: &Path,
    ext: &str,
    args: &[&str],
    mut cancel: watch::Receiver<bool>,
) -> Result<PathBuf, String> {
    let tmp = dir.join(format!("{}.part.{ext}", it.id));
    let out = dir.join(format!("{}.{ext}", it.id));
    // 操作が重くならないよう、CPU を1つ空けておく
    let ph = it.proxy_height.unwrap_or(720).clamp(240, 2160);
    let vf = format!("scale=w=-2:h='min({ph},ih)':flags=bilinear,format=yuv420p");
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(1).max(1))
        .unwrap_or(2);
    let mut child = tools::command("ffmpeg")
        .args([
            "-hide_banner",
            "-nostdin",
            "-y",
            "-v",
            "error",
            "-progress",
            "pipe:1",
            "-nostats",
            "-i",
        ])
        .arg(src)
        .args(if ext == "m4a" {
            vec!["-map", "0:a:0"]
        } else {
            vec![
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-sn",
                "-dn",
                "-vf",
                vf.as_str(),
                "-g",
                "15",
            ]
        })
        .args(["-threads", &threads.to_string()])
        .args(args)
        .arg(&tmp)
        .spawn()
        .map_err(|e| format!("FFmpeg を起動できませんでした：{e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("FFmpeg の出力を読めませんでした")?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or("FFmpeg の出力を読めませんでした")?;
    let err_task = tokio::spawn(async move {
        let mut v = Vec::new();
        let _ = stderr.read_to_end(&mut v).await;
        v
    });
    let mut lines = BufReader::new(stdout).lines();
    let mut last = Instant::now() - Duration::from_secs(1);
    let dur = it.duration.max(0.001);
    loop {
        let line = tokio::select! {
            l = lines.next_line() => l.map_err(|e| e.to_string())?,
            _ = cancel.changed() => {
                let _ = child.kill().await;
                let _ = tokio::fs::remove_file(&tmp).await;
                return Err("中止しました".into());
            }
        };
        let Some(line) = line else { break };
        if let Some(us) = line
            .strip_prefix("out_time_us=")
            .and_then(|v| v.trim().parse::<f64>().ok())
        {
            if last.elapsed() > Duration::from_millis(400) {
                last = Instant::now();
                emit(
                    app,
                    &it.id,
                    "proxy",
                    "progress",
                    (us / 1e6 / dur).clamp(0.0, 0.99),
                    Value::Null,
                );
            }
        }
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    let err = err_task.await.unwrap_or_default();
    if !status.success() {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(tools::tail(&err));
    }
    // 古い形式のプロキシ（mp4 と webm）を片付けてから入れ替える
    for e in ["mp4", "webm", "m4a"] {
        let _ = tokio::fs::remove_file(dir.join(format!("{}.{e}", it.id))).await;
    }
    tokio::fs::rename(&tmp, &out)
        .await
        .map_err(|e| e.to_string())?;
    state(app).allow(app, &out);
    Ok(out)
}
