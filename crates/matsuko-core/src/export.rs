//! 書き出し：プロジェクトから FFmpeg の命令を組み立てる（M3）。
//!
//! 方式：タイムラインを「クリップやテロップが切り替わるところ」で区間に分け、区間ごとに映像を作る。
//! 区間の中では映るものが変わらないので、使う素材の必要な部分だけを `-ss`（入力側のシーク）で読めばよい。
//! 30分の 4K 素材から5秒だけ使うときも、その5秒だけを読む。
//! 音声は1回でまとめて作り、最後に区間の映像をつなげて（再エンコードしない）音声と合わせる。
//!
//! テロップは画面（WebView）がプレビューと同じ描き方で PNG にして渡す（[`TitleImage`]）。
//! 区間の境目はフレームの位置にそろえるので、つなげても長さがずれない。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::model::{Clip, ClipType, Media, Project, TrackKind};
use crate::timeline::audible;

/// フレームレート（分数）。29.97 は 30000/1001
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Fps {
    pub num: u32,
    pub den: u32,
}

impl Fps {
    /// 「29.97 fps」「30」のような表記から
    pub fn parse(s: &str) -> Fps {
        let v: f64 = s
            .trim()
            .trim_end_matches("fps")
            .trim()
            .parse()
            .unwrap_or(30.0);
        if (v - 29.97).abs() < 0.01 {
            Fps {
                num: 30000,
                den: 1001,
            }
        } else if (v - 59.94).abs() < 0.01 {
            Fps {
                num: 60000,
                den: 1001,
            }
        } else if (v - 23.976).abs() < 0.01 {
            Fps {
                num: 24000,
                den: 1001,
            }
        } else {
            Fps {
                num: v.round().max(1.0) as u32,
                den: 1,
            }
        }
    }
    pub fn value(&self) -> f64 {
        self.num as f64 / self.den as f64
    }
    /// 時刻（秒）に一番近いフレームの番号
    pub fn frame(&self, t: f64) -> u64 {
        (t * self.value()).round().max(0.0) as u64
    }
    /// フレームの番号の時刻（秒）
    pub fn time(&self, f: u64) -> f64 {
        f as f64 / self.value()
    }
    /// FFmpeg に渡す表記（30000/1001）
    pub fn arg(&self) -> String {
        if self.den == 1 {
            self.num.to_string()
        } else {
            format!("{}/{}", self.num, self.den)
        }
    }
}

/// キーフレームで動くクリップの区間の長さ（フレーム）
const ANIM_STEP: u64 = 60;

/// 書き出しの設定
#[derive(Debug, Clone)]
pub struct Settings {
    pub width: u32,
    pub height: u32,
    pub fps: Fps,
    /// 書き出す範囲（タイムラインの秒）
    pub from: f64,
    pub to: f64,
    /// 音声だけ（.m4a）
    pub audio_only: bool,
    /// 映像・音声のビットレート（bps）
    pub video_bitrate: u64,
    pub audio_bitrate: u64,
    /// 音声のサンプリング周波数（48000 か 44100。0 なら 48000）
    pub audio_rate: u32,
    /// 色補正（M6）：クリップの id → 作業用フォルダーに置いた LUT（.cube）のファイル名。
    /// 画面がプレビューと同じ LUT を作って渡す（src/core/color.ts）。FFmpeg は作業用フォルダーで動かすので、名前だけでよい
    pub luts: HashMap<String, String>,
}

/// 画面が作ったテロップの画像
#[derive(Debug, Clone)]
pub struct TitleImage {
    /// テロップのクリップの id
    pub clip: String,
    pub path: PathBuf,
    /// 流れるテロップ（クレジット）なら Some。画像は文字の部分だけ（幅は画面と同じ）で、下から上へ流す。
    /// そうでなければ画面と同じ大きさの透明な画像を重ねるだけ
    pub scroll: bool,
    /// テロップのアニメーション（M6）：登場・退場で動いている間のフレームの画像（クリップの頭・終わりのフレームから数える）
    pub anim_in: Option<Seq>,
    pub anim_out: Option<Seq>,
}

/// 連番の画像（`pattern` は `%05d` を含むパス）
#[derive(Debug, Clone)]
pub struct Seq {
    pub pattern: PathBuf,
    pub count: u64,
}

/// 実行する手順の1つ
#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    /// 区間の映像を作る（frames フレーム）
    Video {
        args: Vec<String>,
        frames: u64,
        output: PathBuf,
    },
    /// 音声をまとめて作る
    Audio {
        args: Vec<String>,
        seconds: f64,
        output: PathBuf,
    },
    /// 区間をつなげて音声と合わせる
    Mux {
        args: Vec<String>,
        list: PathBuf,
        list_text: String,
    },
}

/// 書き出しの手順
#[derive(Debug, Clone)]
pub struct Plan {
    pub steps: Vec<Step>,
    /// 映像のフレームの合計（進み具合の計算に使う）
    pub frames: u64,
    pub seconds: f64,
}

/// H.264 のエンコーダーの引数。配布する FFmpeg は LGPL なので libx264 は開発用
pub fn encoder_args(enc: &str, bitrate: u64, fps: Fps) -> Vec<String> {
    let br = bitrate.max(500_000).to_string();
    let gop = (fps.value() * 2.0).round().max(1.0).to_string();
    let mut a: Vec<String> = vec!["-c:v".into(), enc.into()];
    match enc {
        "h264_videotoolbox" => {
            a.extend(["-b:v", &br, "-allow_sw", "1", "-profile:v", "high"].map(String::from))
        }
        "h264_mf" => a.extend(["-b:v", &br, "-rate_control", "cbr"].map(String::from)),
        "libopenh264" => a.extend(["-b:v", &br].map(String::from)),
        _ => a.extend(["-preset", "veryfast", "-b:v", &br].map(String::from)),
    }
    a.extend(["-g", &gop, "-pix_fmt", "yuv420p"].map(String::from));
    a
}

/// 書き出しに使える H.264 のエンコーダー（好ましい順）
pub const H264_ENCODERS: &[&str] = &["h264_videotoolbox", "h264_mf", "libopenh264", "libx264"];

fn s(v: impl ToString) -> String {
    v.to_string()
}
fn f3(v: f64) -> String {
    format!("{:.3}", v)
}
/// FFmpeg の色の表記（#3b5f86 → 0x3b5f86）
fn color(c: Option<&String>) -> String {
    match c {
        Some(x) if x.starts_with('#') && x.len() == 7 => format!("0x{}", &x[1..]),
        _ => "0x333333".into(),
    }
}
fn has_file(m: &Media) -> bool {
    m.file == 1 && m.path.as_deref().is_some_and(|p| !p.is_empty())
}
const HEAD: [&str; 6] = ["-hide_banner", "-nostdin", "-y", "-v", "error", "-nostats"];

/// 書き出しの手順を組み立てる。
/// `work` は作業用のフォルダー（区間の映像・音声を置く）、`out` は出来上がりのファイル、`encoder` は H.264 のエンコーダー
pub fn plan(
    p: &Project,
    titles: &[TitleImage],
    st: &Settings,
    work: &Path,
    out: &Path,
    encoder: &str,
) -> Result<Plan, String> {
    let fps = st.fps;
    let f0 = fps.frame(st.from);
    let f1 = fps.frame(st.to);
    if f1 <= f0 {
        return Err("書き出す範囲が短すぎます".into());
    }
    let seconds = fps.time(f1) - fps.time(f0);
    // 素材のファイルがあるか（見本の素材は色の画面・無音にするので数えない）
    let mut missing: Vec<&str> = vec![];
    for c in &p.clips {
        if let Some(m) = c.m.as_deref().and_then(|id| p.media(id)) {
            if has_file(m)
                && !Path::new(m.path.as_deref().unwrap_or("")).is_file()
                && !missing.contains(&m.n.as_str())
            {
                missing.push(&m.n);
            }
        }
    }
    if !missing.is_empty() {
        return Err(format!(
            "素材のファイルが見つかりません：{}",
            missing.join("、")
        ));
    }

    let mut steps = vec![];
    let audio_out = if st.audio_only {
        out.to_path_buf()
    } else {
        work.join("audio.m4a")
    };
    steps.push(audio_step(p, st, f0, f1, &audio_out));
    if st.audio_only {
        return Ok(Plan {
            steps,
            frames: 0,
            seconds,
        });
    }

    // 映る映像のトラック（V1 から上へ）
    let vtracks: Vec<&str> = p
        .tracks
        .iter()
        .rev()
        .filter(|t| t.kind == TrackKind::Video && !t.hide)
        .map(|t| t.id.as_str())
        .collect();
    let visible = |c: &Clip| vtracks.contains(&c.tr.as_str()) && c.len() > 0.0;
    // 区間の境目：範囲の端と、範囲の中にあるクリップの端（フレームにそろえる）
    let mut cuts = vec![f0, f1];
    for c in p.clips.iter().filter(|c| visible(c)) {
        for t in [c.start, c.end()] {
            let f = fps.frame(t);
            if f > f0 && f < f1 {
                cuts.push(f);
            }
        }
    }
    // トランジションの始めと終わりも境目にする（その間は、前と後ろのクリップを xfade で切り替える）
    let prs = pairs(p, &vtracks);
    for q in &prs {
        for t in [q.w0, q.w1] {
            let f = fps.frame(t);
            if f > f0 && f < f1 {
                cuts.push(f);
            }
        }
    }
    // テロップの登場・退場のアニメーションの境目
    for t in titles {
        let Some(c) = p.clips.iter().find(|c| c.id == t.clip && visible(c)) else {
            continue;
        };
        let (cs, ce) = (fps.frame(c.start), fps.frame(c.end()));
        let mut add = |f: u64| {
            if f > f0 && f < f1 {
                cuts.push(f);
            }
        };
        if let Some(q) = &t.anim_in {
            add(cs + q.count);
        }
        if let Some(q) = &t.anim_out {
            add(ce.saturating_sub(q.count));
        }
    }
    // キーフレームで動くクリップは、2 秒（60 フレーム）ごとにも区間を分ける（1 区間のフィルターが大きくなりすぎないように）
    for c in p.clips.iter().filter(|c| visible(c) && c.animated()) {
        let (a, b) = (fps.frame(c.start), fps.frame(c.end()));
        let mut f = a + ANIM_STEP;
        while f < b {
            if f > f0 && f < f1 {
                cuts.push(f);
            }
            f += ANIM_STEP;
        }
    }
    cuts.sort_unstable();
    cuts.dedup();
    let mut list_text = String::new();
    for (i, w) in cuts.windows(2).enumerate() {
        let (a, b) = (w[0], w[1]);
        let output = work.join(format!("seg{:05}.mp4", i + 1));
        let args = segment_args(p, titles, st, a, b, &vtracks, &prs, &output, encoder);
        list_text.push_str(&format!(
            "file '{}'\n",
            output.file_name().unwrap().to_string_lossy()
        ));
        steps.push(Step::Video {
            args,
            frames: b - a,
            output,
        });
    }
    let list = work.join("list.txt");
    let mut mux: Vec<String> = HEAD.map(s).to_vec();
    mux.extend(["-f", "concat", "-safe", "0", "-i"].map(s));
    mux.push(list.to_string_lossy().into_owned());
    mux.push("-i".into());
    mux.push(audio_out.to_string_lossy().into_owned());
    mux.extend(
        [
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c",
            "copy",
            "-movflags",
            "+faststart",
        ]
        .map(s),
    );
    mux.push(out.to_string_lossy().into_owned());
    steps.push(Step::Mux {
        args: mux,
        list,
        list_text,
    });
    Ok(Plan {
        steps,
        frames: f1 - f0,
        seconds,
    })
}

/// 区間 [a, b)（フレーム）の映像を作る命令
#[allow(clippy::too_many_arguments)]
fn segment_args(
    p: &Project,
    titles: &[TitleImage],
    st: &Settings,
    a: u64,
    b: u64,
    vtracks: &[&str],
    prs: &[Pair],
    output: &Path,
    encoder: &str,
) -> Vec<String> {
    let fps = st.fps;
    let (ta, tb) = (fps.time(a), fps.time(b));
    let len = tb - ta;
    let mid = (ta + tb) / 2.0;
    let (w, h) = (st.width, st.height);
    let mut args: Vec<String> = HEAD.map(s).to_vec();
    // 0 番：黒い画面
    args.extend(["-f", "lavfi", "-i"].map(s));
    args.push(format!("color=c=black:s={w}x{h}:r={}", fps.arg()));
    let mut graph: Vec<String> = vec![format!("[0:v]setsar=1,format=yuv420p[b0]")];
    let mut cur = "b0".to_string();
    let mut n = 1; // 次の入力の番号
    let mut k = 0; // 重ねた数
    for tid in vtracks {
        // このトラックのトランジション（区間の真ん中がその間にあるもの）
        let pr = prs
            .iter()
            .find(|q| q.b.tr == *tid && q.w0 <= mid && mid < q.w1);
        if let Some(q) = pr {
            k += 1;
            let next = format!("b{k}");
            let mut lay = Vec::new();
            for (j, c) in [q.a, q.b].iter().enumerate() {
                let src = c.src_in + (q.w0 - c.start);
                let Some((f, dx, dy, pre, used)) =
                    clip_input(p, c, src, q.d + 1.0, n, st, &mut args)
                else {
                    continue;
                };
                n += used;
                // 黒い画面の上に置いてから切り替える（プレビューと同じ）
                args.extend(["-f", "lavfi", "-i"].map(s));
                args.push(format!(
                    "color=c=black:s={w}x{h}:r={}:d={}",
                    fps.arg(),
                    f3(q.d + 1.0)
                ));
                graph.push(format!(
                    "{f},tpad=start_mode=clone:start_duration={}:stop_mode=clone:stop_duration={}[x{k}c{j}]",
                    f3(pre),
                    f3(q.d + 1.0)
                ));
                graph.push(format!(
                    "[{n}:v]setsar=1,format=yuv420p[x{k}k{j}];[x{k}k{j}][x{k}c{j}]overlay=x=(main_w-overlay_w)/2+({}):y=(main_h-overlay_h)/2+({}):format=auto:eof_action=repeat,format=yuv420p[x{k}l{j}]",
                    f3(dx),
                    f3(dy)
                ));
                n += 1;
                lay.push(format!("x{k}l{j}"));
            }
            if lay.len() == 2 {
                graph.push(format!(
                    "[{}][{}]xfade=transition={}:duration={}:offset=0,trim=start={}:duration={},setpts=PTS-STARTPTS[x{k}]",
                    lay[0],
                    lay[1],
                    q.k,
                    f3(q.d),
                    f3((ta - q.w0).max(0.0)),
                    f3(len + 1.0)
                ));
                graph.push(format!(
                    "[{cur}][x{k}]overlay=x=0:y=0:format=auto:eof_action=repeat[{next}]"
                ));
                cur = next;
            } else {
                k -= 1;
            }
        }
        for c in p
            .clips
            .iter()
            .filter(|c| c.tr == *tid && c.start <= mid && mid < c.end())
            .filter(|c| pr.map_or(true, |q| c.id != q.a.id && c.id != q.b.id))
        {
            k += 1;
            let next = format!("b{k}");
            match c.kind {
                ClipType::Adj => {
                    // 調整レイヤー：それより下に重ねたもの全体の色補正・エフェクト（画面が作った LUT。プレビューと同じ）。
                    // eq フィルターは GPL なので（配布する LGPL 版の FFmpeg にはない）、色は lut3d で行う。
                    // 範囲（maskW・maskH）があれば、その四角の中だけ。四角の中心は x・y（キーフレームで動く）
                    let fx = effects(c, st);
                    if fx.is_empty() {
                        k -= 1;
                        continue;
                    }
                    let (mw, mh) = (c.mask_w.unwrap_or(100.0), c.mask_h.unwrap_or(100.0));
                    if mw < 100.0 || mh < 100.0 {
                        let even = |v: f64, max: u32| ((v / 2.0).round() as u32 * 2).clamp(2, max);
                        let (bw, bh) = (
                            even(w as f64 * mw / 100.0, w),
                            even(h as f64 * mh / 100.0, h),
                        );
                        let off = c.src_in + ta - c.start;
                        let ex = crate::keyframes::expr(c.kf_of("x"), c.x.unwrap_or(0.0), off);
                        let ey = crate::keyframes::expr(c.kf_of("y"), c.y.unwrap_or(0.0), off);
                        let x = format!("clip({w}/2+({ex})*{w}/100-{bw}/2,0,{})", w - bw);
                        let y = format!("clip({h}/2+({ey})*{h}/100-{bh}/2,0,{})", h - bh);
                        graph.push(format!(
                            "[{cur}]split[m{k}a][m{k}b];[m{k}b]crop=w={bw}:h={bh}:x='{x}':y='{y}'{fx}[m{k}c];[m{k}a][m{k}c]overlay=x='{x}':y='{y}':format=auto[{next}]"
                        ));
                    } else {
                        graph.push(format!("[{cur}]null{fx}[{next}]"));
                    }
                }
                ClipType::Title => {
                    let Some(img) = titles.iter().find(|t| t.clip == c.id) else {
                        k -= 1;
                        continue;
                    };
                    // 登場・退場のアニメーションの間は、そのフレームの画像を順に使う（区間はその境目で分けてある）
                    let (fa, cs, ce) = (a, fps.frame(c.start), fps.frame(c.end()));
                    let seq = match (&img.anim_in, &img.anim_out) {
                        (Some(q), _) if fa >= cs && fa < cs + q.count => Some((q, fa - cs)),
                        (_, Some(q)) if fa + q.count >= ce && fa < ce => {
                            Some((q, fa + q.count - ce))
                        }
                        _ => None,
                    };
                    if let Some((q, start)) = seq {
                        args.push("-framerate".into());
                        args.push(fps.arg());
                        args.push("-start_number".into());
                        args.push(start.to_string());
                        args.push("-i".into());
                        args.push(q.pattern.to_string_lossy().into_owned());
                    } else {
                        args.extend(["-loop", "1", "-framerate"].map(s));
                        args.push(fps.arg());
                        args.push("-t".into());
                        args.push(f3(len + 1.0));
                        args.push("-i".into());
                        args.push(img.path.to_string_lossy().into_owned());
                    }
                    if c.animated() && !img.scroll {
                        // キーフレームのあるテロップ：画面と同じ大きさの画像（動きなしで描いたもの）を、フレームごとに動かす
                        let s0 = c.src_in + (ta - c.start).max(0.0);
                        let base = format!("[{n}:v]setpts=PTS-STARTPTS,format=rgba,setsar=1");
                        let (f, used) = anim_chain(c, &base, s0, len + 1.0, n + 1, st, &mut args);
                        graph.push(format!("{f}[t{k}]"));
                        graph.push(format!(
                            "[{cur}][t{k}]overlay=x=0:y=0:format=auto:eof_action=repeat[{next}]"
                        ));
                        n += 1 + used;
                        cur = next;
                        continue;
                    }
                    let y = if img.scroll {
                        // 画面のプレビュー（drawTitle）と同じ動き：y = H - (H + 文字の高さ) × 進み
                        let off = ta - (c.start - c.src_in);
                        let dur = c.src_out.max(0.1);
                        format!("'main_h-(main_h+overlay_h)*(t+{})/{}'", f3(off), f3(dur))
                    } else {
                        "0".into()
                    };
                    graph.push(format!("[{n}:v]setpts=PTS-STARTPTS,format=rgba[t{k}]"));
                    graph.push(format!(
                        "[{cur}][t{k}]overlay=x=0:y={y}:format=auto:eof_action=repeat[{next}]"
                    ));
                    n += 1;
                }
                ClipType::Media => {
                    let src_at = c.src_in + (ta - c.start).max(0.0);
                    let Some((f, dx, dy, _, used)) =
                        clip_input(p, c, src_at, len + 1.0, n, st, &mut args)
                    else {
                        k -= 1;
                        continue;
                    };
                    graph.push(format!("{f}[v{k}]"));
                    graph.push(format!(
                        "[{cur}][v{k}]overlay=x=(main_w-overlay_w)/2+({}):y=(main_h-overlay_h)/2+({}):format=auto:eof_action=repeat[{next}]",
                        f3(dx),
                        f3(dy)
                    ));
                    n += used;
                }
            }
            cur = next;
        }
    }
    graph.push(format!("[{cur}]format=yuv420p[out]"));
    args.push("-filter_complex".into());
    args.push(graph.join(";"));
    args.extend(["-map", "[out]", "-an", "-frames:v"].map(s));
    args.push((b - a).to_string());
    args.push("-r".into());
    args.push(fps.arg());
    args.extend(encoder_args(encoder, st.video_bitrate, fps));
    args.extend(["-progress", "pipe:1"].map(s));
    args.push(output.to_string_lossy().into_owned());
    args
}

/// 音声をまとめて作る命令：鳴るトラックの、ファイルのある素材のクリップを、それぞれの位置に置いて混ぜる
fn audio_step(p: &Project, st: &Settings, f0: u64, f1: u64, output: &Path) -> Step {
    let fps = st.fps;
    let (t0, t1) = (fps.time(f0), fps.time(f1));
    let seconds = t1 - t0;
    let rate = if st.audio_rate == 0 {
        48_000
    } else {
        st.audio_rate
    };
    let mut args: Vec<String> = HEAD.map(s).to_vec();
    let mut parts = vec![];
    let mut n = 0;
    for c in &p.clips {
        let Some(tr) = p.track(&c.tr) else { continue };
        if tr.kind != TrackKind::Audio || !audible(p, tr) || c.kind != ClipType::Media {
            continue;
        }
        let Some(m) = c.m.as_deref().and_then(|id| p.media(id)) else {
            continue;
        };
        if !has_file(m) || m.k == "画像" || (m.k == "映像" && m.no_audio == 1) {
            continue;
        }
        let a = c.start.max(t0);
        let b = c.end().min(t1);
        if b - a < 0.01 {
            continue;
        }
        args.push("-ss".into());
        args.push(f3(c.src_in + (a - c.start)));
        args.push("-t".into());
        args.push(f3(b - a));
        args.push("-i".into());
        args.push(m.path.clone().unwrap_or_default());
        let gain = 10f64.powf(c.vol.unwrap_or(0.0) / 20.0);
        let delay = ((a - t0) * 1000.0).round() as u64;
        parts.push(format!(
            "[{n}:a]aresample={rate},aformat=sample_fmts=fltp:channel_layouts=stereo,{},adelay={delay}:all=1[a{n}]",
            volume_filter(c, gain, a - c.start)
        ));
        n += 1;
    }
    let graph = if n == 0 {
        args.extend(["-f", "lavfi", "-i"].map(s));
        args.push(format!("anullsrc=r={rate}:cl=stereo"));
        format!("[0:a]atrim=0:{}[out]", f3(seconds))
    } else {
        let ins: String = (0..n).map(|i| format!("[a{i}]")).collect();
        format!("{};{ins}amix=inputs={n}:normalize=0:duration=longest,apad=whole_dur={},atrim=0:{}[out]", parts.join(";"), f3(seconds), f3(seconds))
    };
    args.push("-filter_complex".into());
    args.push(graph);
    args.extend(["-map", "[out]", "-vn", "-c:a", "aac", "-b:a"].map(s));
    args.push(st.audio_bitrate.max(64_000).to_string());
    args.extend(["-progress", "pipe:1"].map(s));
    args.push(output.to_string_lossy().into_owned());
    Step::Audio {
        args,
        seconds,
        output: output.to_path_buf(),
    }
}

/// プレビューと同じ切り替えができるトランジション（画面側の transitions.ts と同じ名前。FFmpeg の xfade の transition）
pub const TRANSITIONS: [&str; 42] = [
    "fade",
    "fadeblack",
    "fadewhite",
    "wipeleft",
    "wiperight",
    "wipeup",
    "slideleft",
    "slideright",
    "circleopen",
    "circleclose",
    "zoomin",
    "pixelize",
    "wipedown",
    "wipetl",
    "wipetr",
    "wipebl",
    "wipebr",
    "slideup",
    "slidedown",
    "coverleft",
    "coverright",
    "coverup",
    "coverdown",
    "revealleft",
    "revealright",
    "smoothleft",
    "smoothright",
    "vertopen",
    "vertclose",
    "horzopen",
    "horzclose",
    "diagtl",
    "diagbr",
    "radial",
    "rectcrop",
    "circlecrop",
    "dissolve",
    "hblur",
    "fadegrays",
    "squeezeh",
    "hlslice",
    "hlwind",
];

/// トランジションのある、つなぎ目の前後のクリップ
pub struct Pair<'a> {
    pub a: &'a Clip,
    pub b: &'a Clip,
    pub k: &'static str,
    /// 長さ（2 つのクリップの短いほうまで）と、タイムライン上の始めと終わり（つなぎ目を中心に）
    pub d: f64,
    pub w0: f64,
    pub w1: f64,
}

fn is_picture(p: &Project, c: &Clip) -> bool {
    c.kind == ClipType::Media
        && c.m
            .as_deref()
            .and_then(|id| p.media(id))
            .is_some_and(|m| m.k == "映像" || m.k == "画像")
}

/// 映るトラックのトランジション（画面側の trPairs と同じ決め方）
pub fn pairs<'a>(p: &'a Project, vtracks: &[&str]) -> Vec<Pair<'a>> {
    let mut out = Vec::new();
    for b in &p.clips {
        let Some(x) = &b.xin else { continue };
        let Some(k) = TRANSITIONS.iter().find(|t| **t == x.k) else {
            continue;
        };
        if !vtracks.contains(&b.tr.as_str()) || !is_picture(p, b) {
            continue;
        }
        let Some(a) = p.clips.iter().find(|c| {
            c.id != b.id && c.tr == b.tr && is_picture(p, c) && (c.end() - b.start).abs() < 1e-3
        }) else {
            continue;
        };
        let d0 = if x.d > 0.0 { x.d } else { 1.0 };
        let d = d0.min(a.len()).min(b.len()).max(0.05);
        out.push(Pair {
            a,
            b,
            k,
            d,
            w0: b.start - d / 2.0,
            w1: b.start + d / 2.0,
        });
    }
    out
}

/// 映像・画像のクリップの入力を args に足し、拡大率・回転・不透明度をつけるフィルター（`[n:v]...`、出力の名前はなし）と、
/// 置く位置のずれ（x, y）、頭に足す長さ（素材の頭より前から始めるとき）、使った入力の数を返す
fn clip_input(
    p: &Project,
    c: &Clip,
    src: f64,
    len: f64,
    n: usize,
    st: &Settings,
    args: &mut Vec<String>,
) -> Option<(String, f64, f64, f64, usize)> {
    let m = c.m.as_deref().and_then(|id| p.media(id))?;
    if m.k != "映像" && m.k != "画像" {
        return None;
    }
    let fps = st.fps;
    let (w, h) = (st.width, st.height);
    let mut pre = 0.0;
    if has_file(m) && m.k == "画像" {
        args.extend(["-loop", "1", "-framerate"].map(s));
        args.push(fps.arg());
        args.push("-t".into());
        args.push(f3(len));
        args.push("-i".into());
        args.push(m.path.clone().unwrap_or_default());
    } else if has_file(m) {
        pre = (-src).max(0.0);
        args.push("-ss".into());
        args.push(f3(src.max(0.0)));
        args.push("-t".into());
        args.push(f3(len));
        args.push("-i".into());
        args.push(m.path.clone().unwrap_or_default());
    } else {
        // ファイルのない見本の素材：色の画面
        args.extend(["-f", "lavfi", "-i"].map(s));
        args.push(format!(
            "color=c={}:s={w}x{h}:r={}",
            color(m.col.first()),
            fps.arg()
        ));
    }
    let fx = effects(c, st);
    let head = format!("[{n}:v]setpts=PTS-STARTPTS,fps={}", fps.arg());
    // キーフレームがあるとき：画面いっぱいの透明な画像に、フレームごとの位置・大きさ・回転・不透明度で置いたものを返す
    if c.animated() {
        let base = format!(
            "{head},scale=w={w}:h={h}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1{fx}"
        );
        let s0 = if m.k == "画像" { src } else { src.max(0.0) };
        let (f, used) = anim_chain(c, &base, s0, len, n + 1, st, args);
        return Some((f, 0.0, 0.0, pre, 1 + used));
    }
    let sc = c.scale.unwrap_or(100.0) / 100.0;
    let rot = c.rot.unwrap_or(0.0);
    let op = (c.op.unwrap_or(100.0) / 100.0).clamp(0.0, 1.0);
    let (bw, bh) = (
        ((w as f64) * sc).round().max(2.0) as u32,
        ((h as f64) * sc).round().max(2.0) as u32,
    );
    let mut f = if fx.is_empty() || (sc - 1.0).abs() < 1e-9 {
        format!(
            "{head},scale=w={bw}:h={bh}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1{fx}"
        )
    } else {
        // エフェクトは 100% の大きさで掛けてから、拡大・縮小する（画面のプレビューと同じ）
        format!(
            "{head},scale=w={w}:h={h}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1{fx},scale=w='max(2,trunc(iw*{sc:.6}/2)*2)':h='max(2,trunc(ih*{sc:.6}/2)*2)'"
        )
    };
    if rot != 0.0 || op < 1.0 {
        f.push_str(",format=rgba");
        if rot != 0.0 {
            let r = format!("{:.6}", rot.to_radians());
            f.push_str(&format!(",rotate=a={r}:ow=rotw({r}):oh=roth({r}):c=none"));
        }
        if op < 1.0 {
            f.push_str(&format!(",colorchannelmixer=aa={:.3}", op));
        }
    }
    let dx = c.x.unwrap_or(0.0) / 100.0 * w as f64;
    let dy = c.y.unwrap_or(0.0) / 100.0 * h as f64;
    Some((f, dx, dy, pre, 1))
}

/// 色補正とエフェクト（ぼかし・モザイク・周辺を暗く）のフィルター（先頭に `,`）。画面の大きさ 100% の絵に掛ける。
/// 大きさは 1080p の画面での px なので、書き出す高さに合わせる。どれも LGPL のフィルター
fn effects(c: &Clip, st: &Settings) -> String {
    let mut f = String::new();
    if let Some(file) = st.luts.get(&c.id) {
        f.push(',');
        f.push_str(&lut_filter(file));
    }
    let k = st.height as f64 / 1080.0;
    let blur = c.fx_blur.unwrap_or(0.0) * k;
    if blur >= 0.1 {
        f.push_str(&format!(",gblur=sigma={blur:.3}:steps=3"));
    }
    let mosaic = (c.fx_mosaic.unwrap_or(0.0) * k).round();
    if mosaic >= 2.0 {
        f.push_str(&format!(
            ",pixelize=width={mosaic}:height={mosaic}:mode=avg"
        ));
    }
    let vig = c.fx_vig.unwrap_or(0.0).clamp(0.0, 100.0);
    if vig >= 0.5 {
        let a = vig / 100.0 * std::f64::consts::FRAC_PI_2;
        f.push_str(&format!(
            ",format=gbrp,vignette=angle={a:.6}:dither=0,format=yuv420p"
        ));
    }
    f
}

/// キーフレームで動くクリップの映像：フレームごとに位置・拡大率・回転・不透明度を決め、
/// 同じ値が続くところをまとめて、それぞれを画面と同じ大きさの透明な画像に置き、つなげる。
/// （FFmpeg のフィルターは途中で絵の大きさが変わると正しく動かないので、大きさの変わる部分を分けて作る）
/// base は 100% の大きさの絵（出力の名前なし）、s0 は最初のフレームの素材の秒。canvas の入力の番号は n。
/// 返すのは、出力の名前のないフィルターの文と、足した入力の数
fn anim_chain(
    c: &Clip,
    base: &str,
    s0: f64,
    len: f64,
    n: usize,
    st: &Settings,
    args: &mut Vec<String>,
) -> (String, usize) {
    let fps = st.fps;
    let (w, h) = (st.width as f64, st.height as f64);
    let frames = ((len * fps.value()).ceil() as u64).max(1);
    // 透明な画面（フレームごとに置く台）
    args.extend(["-f", "lavfi", "-i"].map(s));
    args.push(format!(
        "color=c=black@0.0:s={}x{}:r={}:d={},format=rgba",
        st.width,
        st.height,
        fps.arg(),
        f3(len)
    ));
    // 値が同じフレームをまとめる（位置は 0.05px、拡大率は 0.0001、回転は 0.01°、不透明度は 0.1% まで同じなら同じ）
    let key = |m: [f64; 5]| {
        [
            (m[0] / 100.0 * w * 20.0).round() as i64,
            (m[1] / 100.0 * h * 20.0).round() as i64,
            (m[2] * 100.0).round() as i64,
            (m[3] * 100.0).round() as i64,
            (m[4] * 10.0).round() as i64,
        ]
    };
    let mut groups: Vec<(u64, u64, [f64; 5])> = vec![];
    for i in 0..frames {
        let m = c.motion_at(s0 + i as f64 / fps.value());
        match groups.last_mut() {
            Some(g) if key(g.2) == key(m) => g.1 = i + 1,
            _ => groups.push((i, i + 1, m)),
        }
    }
    let g = groups.len();
    let tag = format!("a{n}");
    let mut parts = vec![format!(
        "{base},split={g}{}",
        (0..g).map(|i| format!("[{tag}s{i}]")).collect::<String>()
    )];
    parts.push(format!(
        "[{n}:v]setsar=1,split={g}{}",
        (0..g).map(|i| format!("[{tag}c{i}]")).collect::<String>()
    ));
    for (i, (a, b, m)) in groups.iter().enumerate() {
        let trim = if i + 1 == g {
            format!("trim=start_frame={a}")
        } else {
            format!("trim=start_frame={a}:end_frame={b}")
        };
        let sc = (m[2] / 100.0).max(0.0);
        let mut f = format!(
            "[{tag}s{i}]{trim},setpts=PTS-STARTPTS,scale=w='max(2,trunc(iw*{sc:.6}/2)*2)':h='max(2,trunc(ih*{sc:.6}/2)*2)',format=rgba"
        );
        if m[3] != 0.0 {
            let r = format!("{:.6}", m[3].to_radians());
            f.push_str(&format!(",rotate=a={r}:ow=rotw({r}):oh=roth({r}):c=none"));
        }
        let op = (m[4] / 100.0).clamp(0.0, 1.0);
        if op < 1.0 {
            f.push_str(&format!(",colorchannelmixer=aa={op:.3}"));
        }
        parts.push(format!("{f}[{tag}l{i}]"));
        parts.push(format!(
            "[{tag}c{i}]{trim},setpts=PTS-STARTPTS[{tag}b{i}];[{tag}b{i}][{tag}l{i}]overlay=x=(main_w-overlay_w)/2+({}):y=(main_h-overlay_h)/2+({}):format=auto:shortest=1,setsar=1[{tag}o{i}]",
            f3(m[0] / 100.0 * w),
            f3(m[1] / 100.0 * h)
        ));
    }
    // つなげたあとの時刻は、フレームの番号から付け直す（1 フレームだけの部分は長さが分からないため）
    parts.push(format!(
        "{}concat=n={g}:v=1:a=0,setpts=N/({})/TB,format=rgba",
        (0..g).map(|i| format!("[{tag}o{i}]")).collect::<String>(),
        fps.arg()
    ));
    (parts.join(";"), 1)
}

/// 色補正の LUT を引くフィルター。file は作業用フォルダーの中の名前（英数字・`.`・`_` だけにする）。
/// プレビュー（WebGL の 3D テクスチャ）と同じ 3 次元の直線補間
fn lut_filter(file: &str) -> String {
    let safe: String = file
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '.' || *ch == '_')
        .collect();
    format!("format=gbrp,lut3d=file={safe}:interp=trilinear,format=yuv420p")
}

/// 音量とフェード（直線）。off は、取り出した音声の頭がクリップの頭から何秒後か（範囲で頭を切ったとき）
fn volume_filter(c: &Clip, gain: f64, off: f64) -> String {
    let (fi, fo) = c.fades();
    if fi <= 0.0 && fo <= 0.0 {
        return format!("volume={gain:.4}");
    }
    let lt = format!("(t+{off:.4})");
    let mut e = format!("{gain:.4}");
    if fi > 0.0 {
        e.push_str(&format!("*min(1,max(0,{lt}/{fi:.4}))"));
    }
    if fo > 0.0 {
        e.push_str(&format!("*min(1,max(0,({:.4}-{lt})/{fo:.4}))", c.len()));
    }
    format!("volume='{e}':eval=frame")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Track, TrackKind};

    fn media(id: &str, k: &str, path: Option<&str>) -> Media {
        Media {
            id: id.into(),
            n: id.into(),
            k: k.into(),
            d: 60.0,
            file: path.is_some() as u8,
            path: path.map(String::from),
            col: vec!["#3b5f86".into()],
            ..Default::default()
        }
    }
    fn clip(
        id: &str,
        tr: &str,
        m: Option<&str>,
        kind: ClipType,
        start: f64,
        a: f64,
        b: f64,
    ) -> Clip {
        Clip {
            id: id.into(),
            tr: tr.into(),
            kind,
            m: m.map(String::from),
            start,
            src_in: a,
            src_out: b,
            ..Default::default()
        }
    }
    fn tracks() -> Vec<Track> {
        ["V2", "V1"]
            .iter()
            .map(|i| Track {
                id: (*i).into(),
                kind: TrackKind::Video,
                h: 40.0,
                ..Default::default()
            })
            .chain(["A1", "A2"].iter().map(|i| Track {
                id: (*i).into(),
                kind: TrackKind::Audio,
                h: 40.0,
                ..Default::default()
            }))
            .collect()
    }
    fn settings(from: f64, to: f64) -> Settings {
        Settings {
            width: 1280,
            height: 720,
            fps: Fps::parse("30 fps"),
            from,
            to,
            audio_only: false,
            video_bitrate: 4_000_000,
            audio_bitrate: 192_000,
            audio_rate: 48_000,
            luts: HashMap::new(),
        }
    }
    /// テスト用：ファイルがあることにする（実在するパス）
    fn exe() -> String {
        std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn fps_parsing_and_frames() {
        let f = Fps::parse("29.97 fps");
        assert_eq!(f.arg(), "30000/1001");
        assert_eq!(f.frame(1.0), 30);
        assert_eq!(f.frame(10.0), 300);
        assert_eq!(Fps::parse("60").arg(), "60");
    }

    #[test]
    fn segments_follow_cuts_and_titles() {
        let x = exe();
        let p = Project {
            v: 2,
            media: vec![media("v", "映像", Some(&x))],
            tracks: tracks(),
            clips: vec![
                clip("c1", "V1", Some("v"), ClipType::Media, 0.0, 10.0, 15.0),
                clip("c2", "V1", Some("v"), ClipType::Media, 5.0, 30.0, 40.0),
                clip("t", "V2", None, ClipType::Title, 3.0, 0.0, 4.0),
            ],
            ..Default::default()
        };
        let titles = vec![TitleImage {
            clip: "t".into(),
            path: "/tmp/t.png".into(),
            scroll: false,
            anim_in: None,
            anim_out: None,
        }];
        let pl = plan(
            &p,
            &titles,
            &settings(0.0, 15.0),
            Path::new("/w"),
            Path::new("/o.mp4"),
            "libx264",
        )
        .unwrap();
        // 音声・区間（0-3, 3-5, 5-7, 7-15）・つなぐ
        let segs: Vec<u64> = pl
            .steps
            .iter()
            .filter_map(|s| {
                if let Step::Video { frames, .. } = s {
                    Some(*frames)
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(segs, vec![90, 60, 60, 240]);
        assert_eq!(pl.frames, 450);
        // 2つ目の区間（3〜5 秒）：c1 の素材 13 秒から、テロップを重ねる
        let Step::Video { args, .. } = &pl.steps[2] else {
            panic!()
        };
        let j = args.join(" ");
        assert!(j.contains("-ss 13.000 -t 3.000 -i"), "{j}");
        assert!(
            j.contains("/tmp/t.png") && j.contains("overlay=x=0:y=0"),
            "{j}"
        );
        assert!(
            j.contains("-frames:v 60") && j.contains("-c:v libx264"),
            "{j}"
        );
        // 4つ目の区間（7〜15 秒）：c2 の素材 32 秒から
        let Step::Video { args, .. } = &pl.steps[4] else {
            panic!()
        };
        assert!(args.join(" ").contains("-ss 32.000 -t 9.000"));
        let Step::Mux { list_text, .. } = pl.steps.last().unwrap() else {
            panic!()
        };
        assert_eq!(list_text.lines().count(), 4);
    }

    #[test]
    fn range_trims_clips_and_audio_is_mixed_in_place() {
        let x = exe();
        let p = Project {
            v: 2,
            media: vec![
                media("v", "映像", Some(&x)),
                media("bgm", "音声", Some(&x)),
                media("smp", "映像", None),
            ],
            tracks: tracks(),
            clips: vec![
                Clip {
                    vol: Some(-6.0),
                    ..clip("a1", "A1", Some("v"), ClipType::Media, 2.0, 0.0, 10.0)
                },
                clip("bg", "A2", Some("bgm"), ClipType::Media, 0.0, 0.0, 30.0),
                clip("s", "A2", Some("smp"), ClipType::Media, 30.0, 0.0, 5.0),
            ],
            ..Default::default()
        };
        let pl = plan(
            &p,
            &[],
            &settings(5.0, 20.0),
            Path::new("/w"),
            Path::new("/o.mp4"),
            "libx264",
        )
        .unwrap();
        let Step::Audio { args, seconds, .. } = &pl.steps[0] else {
            panic!()
        };
        let j = args.join(" ");
        assert!((seconds - 15.0).abs() < 1e-9);
        // a1：範囲の頭（5 秒）は素材の 3 秒、7 秒ぶん。音量 -6 dB
        assert!(j.contains("-ss 3.000 -t 7.000"), "{j}");
        assert!(
            j.contains("volume=0.5012") && j.contains("adelay=0:all=1"),
            "{j}"
        );
        // BGM：素材の 5 秒から 15 秒ぶん
        assert!(j.contains("-ss 5.000 -t 15.000"), "{j}");
        assert!(
            j.contains("amix=inputs=2:normalize=0") && j.contains("apad=whole_dur=15.000"),
            "{j}"
        );
        // 見本の素材（ファイルなし）は音声に入れない
        assert_eq!(j.matches(" -i ").count(), 2);
    }

    #[test]
    fn transforms_samples_and_adjustment() {
        let x = exe();
        let p = Project {
            v: 2,
            media: vec![media("v", "映像", Some(&x)), media("smp", "映像", None)],
            tracks: tracks(),
            clips: vec![
                clip("s", "V1", Some("smp"), ClipType::Media, 0.0, 0.0, 4.0),
                Clip {
                    scale: Some(50.0),
                    x: Some(25.0),
                    rot: Some(90.0),
                    op: Some(50.0),
                    ..clip("p", "V2", Some("v"), ClipType::Media, 0.0, 0.0, 4.0)
                },
                clip("adj", "V2", None, ClipType::Adj, 4.0, 0.0, 2.0),
            ],
            ..Default::default()
        };
        let pl = plan(
            &p,
            &[],
            &settings(0.0, 4.0),
            Path::new("/w"),
            Path::new("/o.mp4"),
            "h264_mf",
        )
        .unwrap();
        let Step::Video { args, .. } = &pl.steps[1] else {
            panic!()
        };
        let j = args.join(" ");
        assert!(j.contains("color=c=0x3b5f86:s=1280x720"), "{j}");
        assert!(
            j.contains("scale=w=640:h=360")
                && j.contains("rotate=a=1.570796")
                && j.contains("colorchannelmixer=aa=0.500"),
            "{j}"
        );
        assert!(
            j.contains("overlay=x=(main_w-overlay_w)/2+(320.000)"),
            "{j}"
        );
        assert!(
            j.contains("-c:v h264_mf -b:v 4000000 -rate_control cbr"),
            "{j}"
        );
        assert!(!j.contains("lut3d"), "色補正の LUT がない");
        // 4〜6 秒：調整レイヤー（GPL の eq ではなく、画面が作った LUT を lut3d で）。素材のクリップにも LUT
        let mut st = settings(0.0, 6.0);
        st.luts.insert("adj".into(), "lut000.cube".into());
        st.luts.insert("p".into(), "lut001.cube".into());
        let pl = plan(
            &p,
            &[],
            &st,
            Path::new("/w"),
            Path::new("/o.mp4"),
            "h264_mf",
        )
        .unwrap();
        let Step::Video { args, .. } = &pl.steps[2] else {
            panic!("区間がない")
        };
        let j = args.join(" ");
        assert!(
            j.contains("lut3d=file=lut000.cube:interp=trilinear") && !j.contains("eq="),
            "{j}"
        );
        let Step::Video { args, .. } = &pl.steps[1] else {
            panic!()
        };
        let j = args.join(" ");
        assert!(
            j.contains("setsar=1,format=gbrp,lut3d=file=lut001.cube:interp=trilinear"),
            "{j}"
        );
    }

    #[test]
    fn missing_files_and_hidden_tracks() {
        let p = Project {
            v: 2,
            media: vec![media("gone", "映像", Some("/nope/gone.mp4"))],
            tracks: tracks(),
            clips: vec![clip(
                "c",
                "V1",
                Some("gone"),
                ClipType::Media,
                0.0,
                0.0,
                4.0,
            )],
            ..Default::default()
        };
        let e = plan(
            &p,
            &[],
            &settings(0.0, 4.0),
            Path::new("/w"),
            Path::new("/o.mp4"),
            "libx264",
        )
        .unwrap_err();
        assert!(e.contains("gone"));
        assert!(plan(
            &p,
            &[],
            &settings(3.0, 3.0),
            Path::new("/w"),
            Path::new("/o.mp4"),
            "libx264"
        )
        .is_err());
    }

    #[test]
    fn audio_sample_rate_follows_the_project() {
        let p = Project {
            v: 2,
            tracks: tracks(),
            ..Default::default()
        };
        let st = Settings {
            audio_only: true,
            audio_rate: 44_100,
            ..settings(0.0, 3.0)
        };
        let pl = plan(
            &p,
            &[],
            &st,
            Path::new("/w"),
            Path::new("/o.m4a"),
            "libx264",
        )
        .unwrap();
        let Step::Audio { args, .. } = &pl.steps[0] else {
            panic!()
        };
        assert!(args.join(" ").contains("anullsrc=r=44100"));
    }

    #[test]
    fn audio_only_writes_the_output_directly() {
        let p = Project {
            v: 2,
            tracks: tracks(),
            ..Default::default()
        };
        let st = Settings {
            audio_only: true,
            ..settings(0.0, 3.0)
        };
        let pl = plan(
            &p,
            &[],
            &st,
            Path::new("/w"),
            Path::new("/o.m4a"),
            "libx264",
        )
        .unwrap();
        assert_eq!(pl.steps.len(), 1);
        let Step::Audio { args, output, .. } = &pl.steps[0] else {
            panic!()
        };
        assert_eq!(output, Path::new("/o.m4a"));
        assert!(args.join(" ").contains("anullsrc"));
    }

    #[test]
    fn fades_become_a_volume_expression() {
        let mut c = clip("a", "A1", Some("v"), ClipType::Media, 0.0, 0.0, 10.0);
        assert_eq!(volume_filter(&c, 1.0, 0.0), "volume=1.0000");
        c.fin = Some(2.0);
        c.fout = Some(1.0);
        let f = volume_filter(&c, 0.5, 3.0);
        assert!(
            f.starts_with("volume='0.5000*min(1,max(0,(t+3.0000)/2.0000))"),
            "{f}"
        );
        assert!(
            f.contains("*min(1,max(0,(10.0000-(t+3.0000))/1.0000))':eval=frame"),
            "{f}"
        );
        // 足してクリップより長いフェードは縮める
        c.fin = Some(8.0);
        c.fout = Some(8.0);
        assert_eq!(c.fades(), (5.0, 5.0));
    }

    #[test]
    fn transitions_split_the_window_and_use_xfade() {
        let x = exe();
        let mut b = clip("b", "V1", Some("v"), ClipType::Media, 4.0, 0.0, 4.0);
        b.xin = Some(crate::model::Transition {
            k: "wipeleft".into(),
            d: 1.0,
        });
        let p = Project {
            v: 2,
            media: vec![media("v", "映像", Some(&x))],
            tracks: tracks(),
            clips: vec![
                clip("a", "V1", Some("v"), ClipType::Media, 0.0, 2.0, 6.0),
                b,
            ],
            ..Default::default()
        };
        let pl = plan(
            &p,
            &[],
            &settings(0.0, 8.0),
            Path::new("/w"),
            Path::new("/o.mp4"),
            "libx264",
        )
        .unwrap();
        let vids: Vec<String> = pl
            .steps
            .iter()
            .filter_map(|s| match s {
                Step::Video { args, .. } => Some(args.join(" ")),
                _ => None,
            })
            .collect();
        // 0〜3.5・3.5〜4・4〜4.5・4.5〜8 の 4 つ
        assert_eq!(vids.len(), 4, "{vids:?}");
        assert!(!vids[0].contains("xfade"));
        // 後ろのクリップは素材の頭より 0.5 秒前から：頭で止めた絵を足す
        assert!(
            vids[1].contains("xfade=transition=wipeleft:duration=1.000:offset=0,trim=start=0.000"),
            "{}",
            vids[1]
        );
        assert!(
            vids[1].contains("tpad=start_mode=clone:start_duration=0.500"),
            "{}",
            vids[1]
        );
        assert!(vids[2].contains("trim=start=0.500"), "{}", vids[2]);
        assert!(!vids[3].contains("xfade"));
        // 知らない種類は無視する
        let mut q = p.clone();
        q.clips[1].xin.as_mut().unwrap().k = "nope".into();
        assert!(pairs(&q, &["V1"]).is_empty());
    }

    #[test]
    fn animated_titles_and_effects() {
        use crate::keyframes::Kf;
        let x = exe();
        let mut kf = std::collections::BTreeMap::new();
        kf.insert(
            "op".to_string(),
            vec![
                Kf {
                    t: 0.0,
                    v: 0.0,
                    e: None,
                },
                Kf {
                    t: 1.0,
                    v: 100.0,
                    e: None,
                },
            ],
        );
        let p = Project {
            v: 2,
            media: vec![media("v", "映像", Some(&x))],
            tracks: tracks(),
            clips: vec![
                Clip {
                    fx_blur: Some(3.0),
                    fx_mosaic: Some(20.0),
                    fx_vig: Some(50.0),
                    scale: Some(50.0),
                    ..clip("p", "V1", Some("v"), ClipType::Media, 0.0, 0.0, 4.0)
                },
                Clip {
                    kf: Some(kf),
                    ..clip("t", "V2", None, ClipType::Title, 0.0, 0.0, 4.0)
                },
            ],
            ..Default::default()
        };
        let titles = [TitleImage {
            clip: "t".into(),
            path: PathBuf::from("/w/t.png"),
            scroll: false,
            anim_in: None,
            anim_out: None,
        }];
        let pl = plan(
            &p,
            &titles,
            &settings(0.0, 4.0),
            Path::new("/w"),
            Path::new("/o.mp4"),
            "libx264",
        )
        .unwrap();
        // キーフレームのあるクリップは 2 秒ごとに区間を分ける（0〜2・2〜4）
        let vids: Vec<String> = pl
            .steps
            .iter()
            .filter_map(|s| match s {
                Step::Video { args, .. } => Some(args.join(" ")),
                _ => None,
            })
            .collect();
        assert_eq!(vids.len(), 2);
        let j = &vids[0];
        // エフェクトは 100% の大きさで掛けてから縮める（720p なので 1080p の値の 2/3）
        assert!(
            j.contains("setsar=1,gblur=sigma=2.000:steps=3,pixelize=width=13:height=13:mode=avg,format=gbrp,vignette=angle=0.785398:dither=0,format=yuv420p,scale=w='max(2,trunc(iw*0.500000/2)*2)'"),
            "{j}"
        );
        // テロップの不透明度は、フレームごとに変わる（0〜1 秒は 30 通り、そのあとは 1 つ）
        assert!(j.contains("concat=n=31:v=1:a=0"), "{j}");
        assert!(
            j.contains("colorchannelmixer=aa=0.000") && j.contains("colorchannelmixer=aa=0.967"),
            "{j}"
        );
        // 2〜4 秒の区間は動かないので 1 つ
        assert!(vids[1].contains("concat=n=1:v=1:a=0"), "{}", vids[1]);
    }
}
