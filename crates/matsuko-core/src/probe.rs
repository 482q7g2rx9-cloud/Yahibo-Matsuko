//! ffprobe の JSON（`-print_format json -show_format -show_streams`）を読み、
//! 画面で使う素材の情報（種類・長さ・解像度・プロキシが必要か）にする。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 素材の種類（画面の表記と同じ）
pub const KIND_VIDEO: &str = "映像";
pub const KIND_AUDIO: &str = "音声";
pub const KIND_IMAGE: &str = "画像";

/// 解析した素材の情報
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    /// 映像・音声・画像
    pub kind: String,
    /// 長さ（秒）。画像は 0
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    /// 1秒あたりのコマ数。わからなければ 0
    pub fps: f64,
    pub has_video: bool,
    pub has_audio: bool,
    pub video_codec: String,
    pub audio_codec: String,
    /// 音声のサンプリング周波数とチャンネル数
    pub sample_rate: u32,
    pub channels: u32,
    /// 画面の再生（WebView）向けに軽い動画（音声だけの素材なら AAC）を作るべきか
    pub needs_proxy: bool,
    /// プロキシを作る前でも、元のファイルを WebView でそのまま再生できそうか
    pub playable: bool,
    /// 画面に出す「3840×2160 / 29.97fps」「48kHz / ステレオ」などの表記
    pub res: String,
}

/// 画像として扱うコーデック
const IMAGE_CODECS: &[&str] = &[
    "png", "mjpeg", "webp", "bmp", "gif", "tiff", "jpegls", "jpeg2000",
];
/// WebView でそのまま再生しやすい映像コーデック
const LIGHT_VIDEO_CODECS: &[&str] = &["h264", "vp8", "vp9", "av1"];
/// WebView でそのまま再生しやすい音声コーデック
const PLAYABLE_AUDIO_CODECS: &[&str] = &[
    "aac",
    "mp3",
    "opus",
    "vorbis",
    "flac",
    "pcm_s16le",
    "pcm_s24le",
    "pcm_f32le",
    "pcm_u8",
];
/// 編集用に軽くする目安（これより大きい映像はプロキシを作る）
const PROXY_PIXELS: u64 = 1920 * 1080;

fn num(v: Option<&Value>) -> f64 {
    match v {
        Some(Value::String(s)) => s.parse().unwrap_or(0.0),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        _ => 0.0,
    }
}

/// 「30000/1001」の形を数にする
fn ratio(s: &str) -> f64 {
    let mut it = s.split('/');
    let a: f64 = it.next().and_then(|x| x.trim().parse().ok()).unwrap_or(0.0);
    let b: f64 = it.next().and_then(|x| x.trim().parse().ok()).unwrap_or(1.0);
    if b == 0.0 {
        0.0
    } else {
        a / b
    }
}

fn fmt_fps(f: f64) -> String {
    let r = (f * 100.0).round() / 100.0;
    if (r - r.round()).abs() < 1e-9 {
        format!("{}", r as i64)
    } else {
        format!("{r}")
    }
}

/// ffprobe の JSON から素材の情報を作る。映像も音声もなければ None
pub fn parse_ffprobe(json: &str) -> Option<MediaInfo> {
    let v: Value = serde_json::from_str(json).ok()?;
    let streams = v.get("streams")?.as_array()?;
    let format = v.get("format");
    let fmt_name = format
        .and_then(|f| f.get("format_name"))
        .and_then(Value::as_str)
        .unwrap_or("");

    let mut info = MediaInfo::default();
    let mut vdur = 0.0;
    let mut adur = 0.0;
    let mut pix_fmt = String::new();
    let mut still = false;

    for s in streams {
        let ty = s.get("codec_type").and_then(Value::as_str).unwrap_or("");
        let codec = s
            .get("codec_name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        match ty {
            "video" if !info.has_video => {
                // 音声ファイルに付いたジャケット画像は映像として扱わない
                let attached = s
                    .pointer("/disposition/attached_pic")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    == 1;
                if attached {
                    continue;
                }
                info.has_video = true;
                info.width = s.get("width").and_then(Value::as_u64).unwrap_or(0) as u32;
                info.height = s.get("height").and_then(Value::as_u64).unwrap_or(0) as u32;
                let fr = s
                    .get("avg_frame_rate")
                    .and_then(Value::as_str)
                    .map(ratio)
                    .unwrap_or(0.0);
                info.fps = if fr > 0.0 && fr < 1000.0 {
                    fr
                } else {
                    s.get("r_frame_rate")
                        .and_then(Value::as_str)
                        .map(ratio)
                        .unwrap_or(0.0)
                };
                vdur = num(s.get("duration"));
                pix_fmt = s
                    .get("pix_fmt")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                still = IMAGE_CODECS.contains(&codec.as_str())
                    && (fmt_name.contains("image2")
                        || fmt_name.ends_with("_pipe")
                        || fmt_name == "gif");
                info.video_codec = codec;
            }
            "audio" if !info.has_audio => {
                info.has_audio = true;
                adur = num(s.get("duration"));
                info.sample_rate = num(s.get("sample_rate")) as u32;
                info.channels = s.get("channels").and_then(Value::as_u64).unwrap_or(0) as u32;
                info.audio_codec = codec;
            }
            _ => {}
        }
    }
    if !info.has_video && !info.has_audio {
        return None;
    }
    let fdur = num(format.and_then(|f| f.get("duration")));
    info.duration = [fdur, vdur, adur].into_iter().fold(0.0, f64::max);

    if info.has_video && still {
        info.kind = KIND_IMAGE.into();
        info.duration = 0.0;
        info.fps = 0.0;
        info.has_audio = false;
        info.res = format!("{}×{}", info.width, info.height);
        info.playable = true;
    } else if info.has_video {
        info.kind = KIND_VIDEO.into();
        let pixels = info.width as u64 * info.height as u64;
        let light = LIGHT_VIDEO_CODECS.contains(&info.video_codec.as_str())
            && (pix_fmt.is_empty() || pix_fmt == "yuv420p" || pix_fmt == "yuvj420p");
        info.needs_proxy = pixels > PROXY_PIXELS || !light;
        info.playable = light;
        info.res = if info.fps > 0.0 {
            format!("{}×{} / {}fps", info.width, info.height, fmt_fps(info.fps))
        } else {
            format!("{}×{}", info.width, info.height)
        };
    } else {
        info.kind = KIND_AUDIO.into();
        info.playable = PLAYABLE_AUDIO_CODECS.contains(&info.audio_codec.as_str());
        info.needs_proxy = !info.playable;
        let khz = info.sample_rate as f64 / 1000.0;
        let ch = match info.channels {
            1 => "モノラル".to_string(),
            2 => "ステレオ".to_string(),
            0 => String::new(),
            n => format!("{n}ch"),
        };
        info.res = match (info.sample_rate, ch.is_empty()) {
            (0, _) => "音声".into(),
            (_, true) => format!("{}kHz", fmt_fps(khz)),
            _ => format!("{}kHz / {}", fmt_fps(khz), ch),
        };
    }
    Some(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MP4: &str = r#"{"streams":[
      {"codec_name":"h264","codec_type":"video","width":3840,"height":2160,"pix_fmt":"yuv420p","r_frame_rate":"30000/1001","avg_frame_rate":"30000/1001","duration":"1800.0","disposition":{"attached_pic":0}},
      {"codec_name":"aac","codec_type":"audio","sample_rate":"48000","channels":2,"duration":"1800.02"}],
      "format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"1800.024"}}"#;

    #[test]
    fn video_4k_needs_proxy() {
        let i = parse_ffprobe(MP4).unwrap();
        assert_eq!(i.kind, KIND_VIDEO);
        assert!(i.has_audio && i.needs_proxy);
        assert_eq!(i.res, "3840×2160 / 29.97fps");
        assert!((i.duration - 1800.024).abs() < 1e-9);
    }

    #[test]
    fn hd_h264_is_light_but_prores_is_not() {
        let hd = MP4.replace("3840", "1920").replace("2160", "1080");
        assert!(!parse_ffprobe(&hd).unwrap().needs_proxy);
        let prores = hd.replace("\"h264\"", "\"prores\"");
        let p = parse_ffprobe(&prores).unwrap();
        assert!(p.needs_proxy && !p.playable);
        let ten_bit = hd.replace("yuv420p", "yuv420p10le");
        assert!(parse_ffprobe(&ten_bit).unwrap().needs_proxy);
    }

    #[test]
    fn audio_with_cover_art() {
        let j = r#"{"streams":[
          {"codec_name":"mp3","codec_type":"audio","sample_rate":"44100","channels":2,"duration":"180.5"},
          {"codec_name":"mjpeg","codec_type":"video","width":500,"height":500,"disposition":{"attached_pic":1}}],
          "format":{"format_name":"mp3","duration":"180.5"}}"#;
        let i = parse_ffprobe(j).unwrap();
        assert_eq!(i.kind, KIND_AUDIO);
        assert!(!i.has_video && !i.needs_proxy);
        assert_eq!(i.res, "44.1kHz / ステレオ");
        assert!(i.playable);
        let wma = j.replace("\"mp3\"", "\"wmav2\"");
        let w = parse_ffprobe(&wma).unwrap();
        assert!(w.needs_proxy && !w.playable);
    }

    #[test]
    fn still_image() {
        let j = r#"{"streams":[{"codec_name":"png","codec_type":"video","width":1280,"height":720,"r_frame_rate":"25/1"}],
          "format":{"format_name":"png_pipe"}}"#;
        let i = parse_ffprobe(j).unwrap();
        assert_eq!(i.kind, KIND_IMAGE);
        assert_eq!(i.duration, 0.0);
        assert_eq!(i.res, "1280×720");
    }

    #[test]
    fn nothing_playable() {
        assert!(parse_ffprobe(r#"{"streams":[{"codec_type":"data"}],"format":{}}"#).is_none());
        assert!(parse_ffprobe("not json").is_none());
    }
}
