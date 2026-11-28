//! 録音（M6）：マイクの音を cpal で受け取り、WAV（16 ビット）でプロジェクトフォルダーの「録音」に書く。
//!
//! - 画面がマイクを選んで始める（rec_start）。音の大きさ（ピーク）を "rec-level" で 20 回／秒ほど知らせる
//! - 止める（rec_stop）と、ファイルの場所と長さを返す。画面はそれを素材（テイク）として読み込む
//! - やめる（rec_cancel）と、書きかけのファイルを消す
//!
//! cpal のストリームは OS によってスレッドをまたげないので、録音ごとにスレッドを 1 つ作り、その中で持つ。

use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::state;

type Wav = hound::WavWriter<BufWriter<std::fs::File>>;

/// 動いている録音
struct Active {
    stop: mpsc::Sender<()>,
    done: mpsc::Receiver<Result<(), String>>,
    path: PathBuf,
    rate: u32,
    frames: Arc<AtomicU64>,
}

#[derive(Default)]
pub struct Recorder {
    active: Mutex<Option<Active>>,
}

#[derive(Serialize)]
pub struct RecDevice {
    name: String,
    default: bool,
}

#[derive(Serialize)]
pub struct RecDone {
    path: String,
    seconds: f64,
}

/// 使えるマイクの一覧
#[tauri::command]
pub fn rec_devices() -> Vec<RecDevice> {
    let host = cpal::default_host();
    let def = host.default_input_device().and_then(|d| d.name().ok());
    host.input_devices()
        .map(|it| {
            it.filter_map(|d| d.name().ok())
                .map(|name| RecDevice {
                    default: Some(&name) == def.as_ref(),
                    name,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// ファイル名に使えない文字を除く
fn safe_name(s: &str) -> String {
    let t: String = s
        .chars()
        .map(|c| {
            if "\\/:*?\"<>|".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let t = t.trim().trim_matches('.').to_string();
    if t.is_empty() {
        "録音".into()
    } else {
        t.chars().take(60).collect()
    }
}

/// 録音を始める。device は名前（なければ既定のマイク）、name はファイル名のもと
#[tauri::command]
pub fn rec_start(app: AppHandle, device: Option<String>, name: String) -> Result<String, String> {
    let rec = app.state::<Recorder>();
    let mut slot = rec.active.lock().unwrap();
    if slot.is_some() {
        return Err("録音中です".into());
    }
    let proj = state(&app)
        .current()
        .ok_or("プロジェクトを開いてから録音してください")?;
    let dir = proj.dir.join("録音");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("録音のフォルダーを作れませんでした：{e}"))?;
    let base = safe_name(&name);
    let mut path = dir.join(format!("{base}.wav"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{base}_{n}.wav"));
        n += 1;
    }

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<u32, String>>();
    let (done_tx, done_rx) = mpsc::channel::<Result<(), String>>();
    let frames = Arc::new(AtomicU64::new(0));
    let (p2, f2, app2) = (path.clone(), frames.clone(), app.clone());
    std::thread::spawn(move || {
        let r = run(&app2, device, &p2, f2, stop_rx, &ready_tx);
        if let Err(e) = &r {
            let _ = ready_tx.send(Err(e.clone()));
        }
        let _ = done_tx.send(r);
    });
    let rate = ready_rx
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "マイクが応答しません".to_string())??;
    *slot = Some(Active {
        stop: stop_tx,
        done: done_rx,
        path: path.clone(),
        rate,
        frames,
    });
    Ok(path.to_string_lossy().into_owned())
}

/// 録音のスレッド：ストリームを開いて、止める合図まで書き続ける
fn run(
    app: &AppHandle,
    device: Option<String>,
    path: &PathBuf,
    frames: Arc<AtomicU64>,
    stop: mpsc::Receiver<()>,
    ready: &mpsc::Sender<Result<u32, String>>,
) -> Result<(), String> {
    let host = cpal::default_host();
    let dev = match device.filter(|s| !s.is_empty()) {
        Some(n) => host
            .input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.name().ok().as_deref() == Some(n.as_str()))
            .or_else(|| host.default_input_device()),
        None => host.default_input_device(),
    }
    .ok_or("マイクが見つかりません")?;
    let cfg = dev
        .default_input_config()
        .map_err(|e| format!("マイクを使えません：{e}"))?;
    let ch_in = cfg.channels() as usize;
    let ch_out = ch_in.clamp(1, 2);
    let rate = cfg.sample_rate().0;
    let spec = hound::WavSpec {
        channels: ch_out as u16,
        sample_rate: rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let writer: Arc<Mutex<Option<Wav>>> = Arc::new(Mutex::new(Some(
        hound::WavWriter::create(path, spec)
            .map_err(|e| format!("録音のファイルを作れませんでした：{e}"))?,
    )));
    let peak = Arc::new(Mutex::new([0f32; 2]));
    let failed: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    // どの形式の音でも、-1〜1 の f32 にしてから書く
    fn feed(
        data: &[f32],
        ch_in: usize,
        ch_out: usize,
        w: &Mutex<Option<Wav>>,
        peak: &Mutex<[f32; 2]>,
        frames: &AtomicU64,
    ) {
        let mut pk = [0f32; 2];
        let mut g = w.lock().unwrap();
        let Some(w) = g.as_mut() else { return };
        for f in data.chunks(ch_in) {
            for (c, pkc) in pk.iter_mut().enumerate().take(ch_out) {
                let v = f.get(c).copied().unwrap_or(0.0).clamp(-1.0, 1.0);
                *pkc = pkc.max(v.abs());
                let _ = w.write_sample((v * 32767.0) as i16);
            }
        }
        frames.fetch_add((data.len() / ch_in.max(1)) as u64, Ordering::Relaxed);
        let mut p = peak.lock().unwrap();
        p[0] = p[0].max(pk[0]);
        p[1] = p[1].max(if ch_out > 1 { pk[1] } else { pk[0] });
    }
    let err_fn = {
        let failed = failed.clone();
        move |e: cpal::StreamError| {
            *failed.lock().unwrap() = Some(format!("録音が止まりました：{e}"));
        }
    };
    let (w, pk, fr) = (writer.clone(), peak.clone(), frames.clone());
    let sc: cpal::StreamConfig = cfg.clone().into();
    let stream = match cfg.sample_format() {
        cpal::SampleFormat::F32 => dev.build_input_stream(
            &sc,
            move |d: &[f32], _: &_| feed(d, ch_in, ch_out, &w, &pk, &fr),
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => dev.build_input_stream(
            &sc,
            move |d: &[i16], _: &_| {
                let v: Vec<f32> = d.iter().map(|x| *x as f32 / 32768.0).collect();
                feed(&v, ch_in, ch_out, &w, &pk, &fr)
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I32 => dev.build_input_stream(
            &sc,
            move |d: &[i32], _: &_| {
                let v: Vec<f32> = d.iter().map(|x| *x as f32 / 2_147_483_648.0).collect();
                feed(&v, ch_in, ch_out, &w, &pk, &fr)
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::U16 => dev.build_input_stream(
            &sc,
            move |d: &[u16], _: &_| {
                let v: Vec<f32> = d.iter().map(|x| (*x as f32 - 32768.0) / 32768.0).collect();
                feed(&v, ch_in, ch_out, &w, &pk, &fr)
            },
            err_fn,
            None,
        ),
        f => return Err(format!("このマイクの音の形式には対応していません（{f}）")),
    }
    .map_err(|e| format!("マイクを使えません：{e}"))?;
    stream
        .play()
        .map_err(|e| format!("録音を始められませんでした：{e}"))?;
    let _ = ready.send(Ok(rate));

    let t0 = Instant::now();
    while let Err(mpsc::RecvTimeoutError::Timeout) = stop.recv_timeout(Duration::from_millis(50)) {
        if let Some(e) = failed.lock().unwrap().take() {
            drop(stream);
            let _ = finish(&writer);
            return Err(e);
        }
        let p = std::mem::take(&mut *peak.lock().unwrap());
        let _ = app.emit(
            "rec-level",
            json!({"l": p[0], "r": p[1], "t": t0.elapsed().as_secs_f64()}),
        );
    }
    drop(stream);
    finish(&writer)
}

fn finish(w: &Mutex<Option<Wav>>) -> Result<(), String> {
    match w.lock().unwrap().take() {
        Some(w) => w
            .finalize()
            .map_err(|e| format!("録音のファイルを書けませんでした：{e}")),
        None => Ok(()),
    }
}

/// 録音を止めて、ファイルの場所と長さ（秒）を返す
#[tauri::command]
pub fn rec_stop(app: AppHandle) -> Result<RecDone, String> {
    let a = app
        .state::<Recorder>()
        .active
        .lock()
        .unwrap()
        .take()
        .ok_or("録音していません")?;
    let _ = a.stop.send(());
    a.done
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "録音を止められませんでした".to_string())??;
    state(&app).allow(&app, &a.path);
    let seconds = a.frames.load(Ordering::Relaxed) as f64 / a.rate.max(1) as f64;
    Ok(RecDone {
        path: a.path.to_string_lossy().into_owned(),
        seconds,
    })
}

/// 録音をやめる（ファイルを消す）
#[tauri::command]
pub fn rec_cancel(app: AppHandle) {
    let a = app.state::<Recorder>().active.lock().unwrap().take();
    if let Some(a) = a {
        let _ = a.stop.send(());
        let _ = a.done.recv_timeout(Duration::from_secs(10));
        let _ = std::fs::remove_file(&a.path);
    }
}

/// アプリを終えるとき：録音中なら止めて、書いたところまで残す
pub fn stop_all(app: &AppHandle) {
    let a = app.state::<Recorder>().active.lock().unwrap().take();
    if let Some(a) = a {
        let _ = a.stop.send(());
        let _ = a.done.recv_timeout(Duration::from_secs(5));
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn file_names_are_safe() {
        assert_eq!(super::safe_name("R-001 ナレーション"), "R-001 ナレーション");
        assert_eq!(super::safe_name("a/b:c?"), "a_b_c_");
        assert_eq!(super::safe_name("  ..  "), "録音");
    }
}
