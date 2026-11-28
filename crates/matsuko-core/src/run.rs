//! 書き出しの手順（[`crate::export::Plan`]）を FFmpeg で実行する。
//!
//! 進み具合を 0〜1 で知らせ、中止の合図（`cancel`）が立てば FFmpeg を止める。
//! 最初の区間でエンコーダーが使えなければ、次のエンコーダーで組み立て直す
//! （Windows の Media Foundation など、OS の機能はパソコンによって使えないことがある）。

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::export::{plan, Plan, Settings, Step, TitleImage};
use crate::model::Project;

/// 実行の結果
#[derive(Debug, Clone, PartialEq)]
pub struct Done {
    /// 使った H.264 のエンコーダー（音声だけなら空）
    pub encoder: String,
    /// かかった時間（秒）
    pub elapsed: f64,
}

fn command(exe: &Path) -> Command {
    let mut c = Command::new(exe);
    c.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // コンソールの窓を出さない（CREATE_NO_WINDOW）
        c.creation_flags(0x0800_0000);
    }
    c
}

/// FFmpeg を1回動かす。`each` は -progress の1行ごとに呼ぶ
fn run_one(
    exe: &Path,
    work: &Path,
    args: &[String],
    cancel: &AtomicBool,
    mut each: impl FnMut(&str),
) -> Result<(), String> {
    // 作業用フォルダーで動かす（色補正の LUT を名前だけで指定するため）
    let mut child = command(exe)
        .current_dir(work)
        .args(args)
        .spawn()
        .map_err(|e| format!("FFmpeg を起動できませんでした：{e}"))?;
    let mut err = child.stderr.take();
    let errs = std::thread::spawn(move || {
        let mut v = Vec::new();
        if let Some(e) = err.as_mut() {
            let _ = e.read_to_end(&mut v);
        }
        v
    });
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines() {
            let Ok(line) = line else { break };
            if cancel.load(Ordering::Relaxed) {
                let _ = child.kill();
                let _ = child.wait();
                return Err("中止しました".into());
            }
            each(&line);
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let err = errs.join().unwrap_or_default();
    if cancel.load(Ordering::Relaxed) {
        return Err("中止しました".into());
    }
    if !status.success() {
        let text = String::from_utf8_lossy(&err);
        let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
        return Err(lines[lines.len().saturating_sub(3)..].join(" / "));
    }
    Ok(())
}

/// 手順ごとの重み（映像のフレームに対して、音声とつなぐ処理をどのくらいに数えるか）
fn weights(pl: &Plan) -> (f64, f64, f64) {
    let video = pl.frames as f64;
    let audio = (video * 0.08).max(1.0);
    let mux = (video * 0.02).max(1.0);
    (video, audio, mux)
}

/// 書き出す。`encoders` は試す順の H.264 のエンコーダー
#[allow(clippy::too_many_arguments)]
pub fn export(
    ffmpeg: &Path,
    p: &Project,
    titles: &[TitleImage],
    st: &Settings,
    work: &Path,
    out: &Path,
    encoders: &[String],
    cancel: &AtomicBool,
    mut progress: impl FnMut(f64),
) -> Result<Done, String> {
    let t0 = std::time::Instant::now();
    std::fs::create_dir_all(work)
        .map_err(|e| format!("作業用のフォルダーを作れませんでした：{e}"))?;
    if encoders.is_empty() && !st.audio_only {
        return Err("H.264 で書き出せるエンコーダーがありません".into());
    }
    let mut ei = 0;
    let mut pl = plan(
        p,
        titles,
        st,
        work,
        out,
        encoders.first().map(String::as_str).unwrap_or(""),
    )?;
    let (wv, wa, wm) = weights(&pl);
    let total = wv + wa + wm;
    let mut done = 0.0;
    let mut i = 0;
    let mut first_video = true;
    while i < pl.steps.len() {
        if cancel.load(Ordering::Relaxed) {
            return Err("中止しました".into());
        }
        let step = pl.steps[i].clone();
        match &step {
            Step::Audio { args, seconds, .. } => {
                let sec = seconds.max(0.001);
                run_one(ffmpeg, work, args, cancel, |l| {
                    if let Some(us) = l
                        .strip_prefix("out_time_us=")
                        .and_then(|v| v.trim().parse::<f64>().ok())
                    {
                        progress(
                            ((done + wa * (us / 1e6 / sec).clamp(0.0, 1.0)) / total).min(0.999),
                        );
                    }
                })?;
                done += wa;
            }
            Step::Video { args, frames, .. } => {
                let fr = (*frames).max(1) as f64;
                let r = run_one(ffmpeg, work, args, cancel, |l| {
                    if let Some(n) = l
                        .strip_prefix("frame=")
                        .and_then(|v| v.trim().parse::<f64>().ok())
                    {
                        progress(((done + n.min(fr)) / total).min(0.999));
                    }
                });
                if let Err(e) = r {
                    // 最初の区間でエンコーダーが原因で失敗したら、次のエンコーダーで組み立て直して、この区間からやり直す
                    // （フィルターなど、エンコーダーと関係のない失敗は、そのまま知らせる）
                    let low = e.to_lowercase();
                    let enc_err = low.contains("encoder")
                        || low.contains("unrecognized option")
                        || low.contains("option not found")
                        || e.contains(encoders[ei].as_str());
                    if first_video && enc_err && e != "中止しました" && ei + 1 < encoders.len()
                    {
                        ei += 1;
                        pl = plan(p, titles, st, work, out, &encoders[ei])?;
                        continue;
                    }
                    return Err(format!(
                        "映像を作れませんでした（{}）：{e}",
                        encoders.get(ei).map(String::as_str).unwrap_or("")
                    ));
                }
                first_video = false;
                done += fr;
            }
            Step::Mux {
                args,
                list,
                list_text,
            } => {
                std::fs::write(list, list_text).map_err(|e| e.to_string())?;
                run_one(ffmpeg, work, args, cancel, |_| {})?;
                done += wm;
            }
        }
        progress((done / total).min(0.999));
        i += 1;
    }
    progress(1.0);
    Ok(Done {
        encoder: if st.audio_only {
            String::new()
        } else {
            encoders[ei].clone()
        },
        elapsed: t0.elapsed().as_secs_f64(),
    })
}

/// 作業用のフォルダー（区間の映像など）を片付ける
pub fn clean(work: &PathBuf) {
    let _ = std::fs::remove_dir_all(work);
}
