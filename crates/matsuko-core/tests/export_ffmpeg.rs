//! 書き出しの結合テスト：実際に FFmpeg で書き出し、ffprobe で長さ・形式・解像度を確かめる。
//! 素材は FFmpeg の lavfi で作る（リポジトリにファイルを入れない）。
//! FFmpeg が見つからなければ（MATSUKO_FFMPEG_DIR か PATH）、何もせずに通す。

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;

use matsuko_core::export::{Fps, Settings, TitleImage};
use matsuko_core::model::{Clip, ClipType, Media, Project, Track, TrackKind};
use matsuko_core::run::export;

fn tool(name: &str) -> Option<PathBuf> {
    let file = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    let p = match std::env::var_os("MATSUKO_FFMPEG_DIR") {
        Some(d) => PathBuf::from(d).join(&file),
        None => PathBuf::from(&file),
    };
    Command::new(&p)
        .arg("-version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|_| p)
}

fn ff(ffmpeg: &Path, args: &[&str]) {
    let o = Command::new(ffmpeg)
        .args(["-hide_banner", "-v", "error", "-y"])
        .args(args)
        .output()
        .unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
}

/// ffprobe で調べる：[長さ, 映像のコーデック, 幅, 高さ, フレーム数, 音声のコーデック, チャンネル数]
fn probe(ffprobe: &Path, f: &Path) -> serde_json::Value {
    let o = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-count_frames",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(f)
        .output()
        .unwrap();
    assert!(o.status.success());
    serde_json::from_slice(&o.stdout).unwrap()
}

fn stream<'a>(v: &'a serde_json::Value, ty: &str) -> Option<&'a serde_json::Value> {
    v["streams"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["codec_type"] == ty)
}

struct Fixture {
    dir: PathBuf,
    project: Project,
    titles: Vec<TitleImage>,
}

fn fixture(ffmpeg: &Path, name: &str) -> Fixture {
    let dir = std::env::temp_dir().join(format!("matsuko-export-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let p = |f: &str| dir.join(f).to_string_lossy().into_owned();
    ff(
        ffmpeg,
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=640x360:rate=25",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=44100",
            "-t",
            "10",
            "-pix_fmt",
            "yuv420p",
            "-shortest",
            &p("a.mp4"),
        ],
    );
    ff(
        ffmpeg,
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=1920x1080:rate=30",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=660:sample_rate=48000",
            "-t",
            "6",
            "-pix_fmt",
            "yuv420p",
            "-shortest",
            &p("b.mp4"),
        ],
    );
    ff(
        ffmpeg,
        &[
            "-f",
            "lavfi",
            "-i",
            "smptebars=size=800x600",
            "-frames:v",
            "1",
            &p("img.png"),
        ],
    );
    ff(
        ffmpeg,
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=220:sample_rate=48000",
            "-t",
            "12",
            &p("bgm.wav"),
        ],
    );
    // テロップの画像（画面と同じ大きさの透明な画像と、流れる文字の部分）
    ff(
        ffmpeg,
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=yellow@0.6:s=640x360,format=rgba",
            "-frames:v",
            "1",
            &p("title.png"),
        ],
    );
    ff(
        ffmpeg,
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=white@0.9:s=640x120,format=rgba",
            "-frames:v",
            "1",
            &p("credit.png"),
        ],
    );

    let m = |id: &str, k: &str, f: &str, d: f64| Media {
        id: id.into(),
        n: id.into(),
        k: k.into(),
        d,
        file: 1,
        path: Some(p(f)),
        ..Default::default()
    };
    let c =
        |id: &str, tr: &str, mid: Option<&str>, kind: ClipType, start: f64, a: f64, b: f64| Clip {
            id: id.into(),
            tr: tr.into(),
            kind,
            m: mid.map(String::from),
            start,
            src_in: a,
            src_out: b,
            ..Default::default()
        };
    let tr = |id: &str, kind: TrackKind| Track {
        id: id.into(),
        kind,
        h: 40.0,
        ..Default::default()
    };
    let project = Project {
        v: 2,
        media: vec![
            m("a", "映像", "a.mp4", 10.0),
            m("b", "映像", "b.mp4", 6.0),
            m("img", "画像", "img.png", 0.0),
            m("bgm", "音声", "bgm.wav", 12.0),
        ],
        tracks: vec![
            tr("V3", TrackKind::Video),
            tr("V2", TrackKind::Video),
            tr("V1", TrackKind::Video),
            tr("A1", TrackKind::Audio),
            tr("A2", TrackKind::Audio),
        ],
        clips: vec![
            c("c1", "V1", Some("a"), ClipType::Media, 0.0, 2.0, 6.0),
            c("c1a", "A1", Some("a"), ClipType::Media, 0.0, 2.0, 6.0),
            Clip {
                scale: Some(80.0),
                rot: Some(5.0),
                op: Some(90.0),
                ..c("c2", "V1", Some("b"), ClipType::Media, 4.0, 1.0, 5.0)
            },
            c("c2a", "A1", Some("b"), ClipType::Media, 4.0, 1.0, 5.0),
            c("c3", "V1", Some("img"), ClipType::Media, 8.0, 0.0, 2.0),
            c("t1", "V2", None, ClipType::Title, 1.0, 0.0, 2.0),
            c("cr", "V2", None, ClipType::Title, 6.0, 0.0, 3.0),
            c("adj", "V3", None, ClipType::Adj, 0.0, 0.0, 10.0),
            Clip {
                vol: Some(-12.0),
                ..c("bg", "A2", Some("bgm"), ClipType::Media, 0.0, 0.0, 10.0)
            },
        ],
        ..Default::default()
    };
    let titles = vec![
        TitleImage {
            clip: "t1".into(),
            path: dir.join("title.png"),
            scroll: false,
        },
        TitleImage {
            clip: "cr".into(),
            path: dir.join("credit.png"),
            scroll: true,
        },
    ];
    Fixture {
        dir,
        project,
        titles,
    }
}

fn settings(from: f64, to: f64) -> Settings {
    Settings {
        width: 640,
        height: 360,
        fps: Fps::parse("30 fps"),
        from,
        to,
        audio_only: false,
        video_bitrate: 2_000_000,
        audio_bitrate: 128_000,
    }
}

#[test]
fn exports_the_whole_programme() {
    let (Some(ffmpeg), Some(ffprobe)) = (tool("ffmpeg"), tool("ffprobe")) else {
        eprintln!("FFmpeg が見つからないため、書き出しの結合テストを省きます");
        return;
    };
    let fx = fixture(&ffmpeg, "all");
    let out = fx.dir.join("out.mp4");
    let mut last = 0.0;
    let mut steps = 0;
    // 1つ目のエンコーダーは存在しないので、2つ目以降に切り替わることも確かめる
    let encs: Vec<String> = ["no_such_encoder", "libopenh264", "libx264"]
        .map(String::from)
        .to_vec();
    let done = export(
        &ffmpeg,
        &fx.project,
        &fx.titles,
        &settings(0.0, 10.0),
        &fx.dir.join("work"),
        &out,
        &encs,
        &AtomicBool::new(false),
        |p| {
            assert!(p + 1e-9 >= last, "進み具合が戻った：{last} → {p}");
            last = p;
            steps += 1;
        },
    )
    .unwrap();
    assert_ne!(done.encoder, "no_such_encoder");
    assert_eq!(last, 1.0);
    assert!(steps > 5);
    let v = probe(&ffprobe, &out);
    let dur: f64 = v["format"]["duration"].as_str().unwrap().parse().unwrap();
    assert!((dur - 10.0).abs() < 0.1, "長さ {dur}");
    let vs = stream(&v, "video").unwrap();
    assert_eq!(vs["codec_name"], "h264");
    assert_eq!(
        (vs["width"].as_u64(), vs["height"].as_u64()),
        (Some(640), Some(360))
    );
    assert_eq!(vs["nb_read_frames"], "300");
    let au = stream(&v, "audio").unwrap();
    assert_eq!(au["codec_name"], "aac");
    assert_eq!(au["channels"], 2);
    eprintln!(
        "書き出し：{:.2} 秒（エンコーダー {}）",
        done.elapsed, done.encoder
    );
    // MATSUKO_KEEP_EXPORT があれば、目で確かめられるように残す
    if std::env::var_os("MATSUKO_KEEP_EXPORT").is_some() {
        eprintln!("残しました：{}", out.display());
    } else {
        let _ = std::fs::remove_dir_all(&fx.dir);
    }
}

#[test]
fn exports_a_range_and_audio_only() {
    let (Some(ffmpeg), Some(ffprobe)) = (tool("ffmpeg"), tool("ffprobe")) else {
        return;
    };
    let fx = fixture(&ffmpeg, "range");
    let encs: Vec<String> = ["libopenh264", "libx264"].map(String::from).to_vec();
    let out = fx.dir.join("range.mp4");
    export(
        &ffmpeg,
        &fx.project,
        &fx.titles,
        &settings(2.5, 7.0),
        &fx.dir.join("w1"),
        &out,
        &encs,
        &AtomicBool::new(false),
        |_| {},
    )
    .unwrap();
    let v = probe(&ffprobe, &out);
    let dur: f64 = v["format"]["duration"].as_str().unwrap().parse().unwrap();
    assert!((dur - 4.5).abs() < 0.1, "長さ {dur}");
    assert_eq!(stream(&v, "video").unwrap()["nb_read_frames"], "135");

    let m4a = fx.dir.join("audio.m4a");
    let st = Settings {
        audio_only: true,
        ..settings(0.0, 10.0)
    };
    export(
        &ffmpeg,
        &fx.project,
        &fx.titles,
        &st,
        &fx.dir.join("w2"),
        &m4a,
        &[],
        &AtomicBool::new(false),
        |_| {},
    )
    .unwrap();
    let v = probe(&ffprobe, &m4a);
    assert!(stream(&v, "video").is_none());
    let dur: f64 = v["format"]["duration"].as_str().unwrap().parse().unwrap();
    assert!((dur - 10.0).abs() < 0.1, "長さ {dur}");
    let _ = std::fs::remove_dir_all(&fx.dir);
}

#[test]
fn cancel_stops_quickly() {
    let Some(ffmpeg) = tool("ffmpeg") else { return };
    let fx = fixture(&ffmpeg, "cancel");
    let stop = AtomicBool::new(true);
    let r = export(
        &ffmpeg,
        &fx.project,
        &fx.titles,
        &settings(0.0, 10.0),
        &fx.dir.join("w"),
        &fx.dir.join("x.mp4"),
        &["libx264".into()],
        &stop,
        |_| {},
    );
    assert_eq!(r.unwrap_err(), "中止しました");
    assert!(!fx.dir.join("x.mp4").exists());
    let _ = std::fs::remove_dir_all(&fx.dir);
}

/// 8分の番組（96カット・テロップ・BGM・調整レイヤー）を書き出して、実時間より速いかを測る。
/// 素材が要るので、ふだんは動かさない：
///   MATSUKO_LONG_MEDIA=<src1〜4.mp4 と bgm.m4a のフォルダー> cargo test --test export_ffmpeg eight_minutes -- --ignored --nocapture
#[test]
#[ignore]
fn eight_minutes_faster_than_realtime() {
    let (Some(ffmpeg), Some(ffprobe)) = (tool("ffmpeg"), tool("ffprobe")) else {
        return;
    };
    let Some(dir) = std::env::var_os("MATSUKO_LONG_MEDIA").map(PathBuf::from) else {
        eprintln!("MATSUKO_LONG_MEDIA がないため省きます");
        return;
    };
    let work = std::env::temp_dir().join(format!("matsuko-8min-{}", std::process::id()));
    std::fs::create_dir_all(&work).unwrap();
    let m = |id: &str, k: &str, f: &str, d: f64| Media {
        id: id.into(),
        n: id.into(),
        k: k.into(),
        d,
        file: 1,
        path: Some(dir.join(f).to_string_lossy().into_owned()),
        ..Default::default()
    };
    let mut media: Vec<Media> = (1..=4)
        .map(|i| m(&format!("s{i}"), "映像", &format!("src{i}.mp4"), 150.0))
        .collect();
    media.push(m("bgm", "音声", "bgm.m4a", 480.0));
    let tr = |id: &str, kind: TrackKind| Track {
        id: id.into(),
        kind,
        h: 40.0,
        ..Default::default()
    };
    let mut clips = vec![];
    let mut seed: u64 = 3;
    for i in 0..96 {
        seed = seed * 16807 % 2147483647;
        let a = ((seed as f64 / 2147483647.0) * 140.0 * 10.0).round() / 10.0;
        let mid = format!("s{}", i % 4 + 1);
        let base = Clip {
            tr: "V1".into(),
            kind: ClipType::Media,
            m: Some(mid),
            start: i as f64 * 5.0,
            src_in: a,
            src_out: a + 5.0,
            link: Some(format!("L{i}")),
            ..Default::default()
        };
        clips.push(Clip {
            id: format!("v{i}"),
            ..base.clone()
        });
        clips.push(Clip {
            id: format!("a{i}"),
            tr: "A1".into(),
            vol: Some(-12.0),
            ..base
        });
    }
    clips.push(Clip {
        id: "bgm".into(),
        tr: "A2".into(),
        kind: ClipType::Media,
        m: Some("bgm".into()),
        start: 0.0,
        src_in: 0.0,
        src_out: 480.0,
        vol: Some(-18.0),
        ..Default::default()
    });
    let mut titles = vec![];
    ff(
        &ffmpeg,
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=yellow@0.7:s=1920x1080,format=rgba",
            "-frames:v",
            "1",
            &work.join("t.png").to_string_lossy(),
        ],
    );
    for t in (0..480).step_by(30) {
        clips.push(Clip {
            id: format!("t{t}"),
            tr: "V2".into(),
            kind: ClipType::Title,
            start: t as f64 + 2.0,
            src_in: 0.0,
            src_out: 4.0,
            ..Default::default()
        });
        titles.push(TitleImage {
            clip: format!("t{t}"),
            path: work.join("t.png"),
            scroll: false,
        });
    }
    clips.push(Clip {
        id: "adj".into(),
        tr: "V3".into(),
        kind: ClipType::Adj,
        start: 0.0,
        src_in: 0.0,
        src_out: 480.0,
        ..Default::default()
    });
    let p = Project {
        v: 2,
        media,
        tracks: vec![
            tr("V3", TrackKind::Video),
            tr("V2", TrackKind::Video),
            tr("V1", TrackKind::Video),
            tr("A1", TrackKind::Audio),
            tr("A2", TrackKind::Audio),
        ],
        clips,
        ..Default::default()
    };
    let st = Settings {
        width: 1920,
        height: 1080,
        fps: Fps::parse("29.97 fps"),
        from: 0.0,
        to: 480.0,
        audio_only: false,
        video_bitrate: 12_000_000,
        audio_bitrate: 192_000,
    };
    let out = work.join("8min.mp4");
    let encs: Vec<String> = ["libopenh264", "libx264"].map(String::from).to_vec();
    let done = export(
        &ffmpeg,
        &p,
        &titles,
        &st,
        &work.join("w"),
        &out,
        &encs,
        &AtomicBool::new(false),
        |_| {},
    )
    .unwrap();
    let v = probe(&ffprobe, &out);
    let dur: f64 = v["format"]["duration"].as_str().unwrap().parse().unwrap();
    eprintln!("8分の番組：{:.1} 秒で書き出し（実時間の {:.2} 倍の速さ、エンコーダー {}）、長さ {dur:.3} 秒", done.elapsed, 480.0 / done.elapsed, done.encoder);
    assert!((dur - 480.0).abs() < 0.2);
    assert!(
        done.elapsed < 480.0,
        "実時間より遅い：{:.1} 秒",
        done.elapsed
    );
    let _ = std::fs::remove_dir_all(&work);
}
