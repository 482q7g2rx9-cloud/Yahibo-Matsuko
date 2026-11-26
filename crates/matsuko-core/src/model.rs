//! プロジェクトの型（保存形式 v2）。JSON の項目名はブラウザ版（src/matsuko-editor.html の P）に合わせる。
//! タイムラインの仕様は docs/timeline-spec.md。

use serde::{Deserialize, Serialize};

/// 1つの番組（プロジェクト）
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Project {
    /// 保存形式の版（2）
    pub v: u32,
    /// 見本プロジェクトなら 1
    pub sample: u8,
    pub media: Vec<Media>,
    /// トラック。画面の上から V3, V2, V1, A1, A2, A3 の順
    pub tracks: Vec<Track>,
    /// すべてのトラックのクリップ
    pub clips: Vec<Clip>,
    /// 書き出し範囲のイン点（秒）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pin: Option<f64>,
    /// 書き出し範囲のアウト点（秒）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pout: Option<f64>,
}

/// トラックの種類
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub enum TrackKind {
    /// 映像（番号の大きいトラックが上に重なる）
    #[default]
    #[serde(rename = "v")]
    Video,
    /// 音声
    #[serde(rename = "a")]
    Audio,
}

/// トラック
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Track {
    /// V1・A1 など
    pub id: String,
    pub kind: TrackKind,
    /// 画面上の高さ（px）
    pub h: f64,
    /// 補足の名前（「テロップ」「BGM」など）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 映像トラックを表示しない
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub hide: bool,
    /// 編集できないようにする
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub lock: bool,
    /// 音声トラックを鳴らさない
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub mute: bool,
    /// 音声トラックのソロ（ソロのトラックがあれば、ソロだけを鳴らす）
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub solo: bool,
}

/// 素材
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Media {
    pub id: String,
    /// 表示名
    pub n: String,
    /// 種別：「映像」「音声」「テイク」「画像」「台本」
    pub k: String,
    /// 長さ（秒）。画像は 0
    pub d: f64,
    /// 記号（V-01 など）
    pub c: String,
    /// 権利の状態：ok / wn / free / own
    pub r: String,
    /// ファイル名
    pub f: String,
    /// ソースモニターのイン点・アウト点（秒）
    #[serde(rename = "inP", skip_serializing_if = "Option::is_none")]
    pub in_point: Option<f64>,
    #[serde(rename = "outP", skip_serializing_if = "Option::is_none")]
    pub out_point: Option<f64>,
    /// 無音などの不要部分
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub marks: Vec<Mark>,
    /// 読み込んだファイルなら 1（見本は 0）
    pub file: u8,
    /// 映像の素材に音声がないとき 1
    #[serde(rename = "noAudio")]
    pub no_audio: u8,
    /// デスクトップ版：素材ファイルのフルパスと、プロジェクトフォルダーからの相対パス（`/` 区切り）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rel: Option<String>,
}

/// クリップの種類
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ClipType {
    /// 素材（映像トラックなら絵、音声トラックなら音）
    #[default]
    Media,
    /// テロップ
    Title,
    /// 調整レイヤー（色補正）
    Adj,
}

/// クリップ
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Clip {
    pub id: String,
    /// 置いているトラックの id
    pub tr: String,
    #[serde(rename = "type")]
    pub kind: ClipType,
    /// タイムライン上の開始（秒）
    pub start: f64,
    /// 素材の中の開始（秒）。テロップなどは 0 からの長さ
    #[serde(rename = "in")]
    pub src_in: f64,
    /// 素材の中の終了（秒）
    #[serde(rename = "out")]
    pub src_out: f64,
    /// 素材の id（type が media のとき）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub m: Option<String>,
    /// 同じ素材から作った映像と音声を結ぶ番号
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    /// 位置 X・Y（画面の幅・高さに対する %）、拡大率（%）、回転（°）、不透明度（%）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rot: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub op: Option<f64>,
    /// 音量（dB）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vol: Option<f64>,
    /// テロップ：文字、種類（name / q / sub / credit）、大きさ（小 / 中 / 大）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub st: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sz: Option<String>,
}

impl Clip {
    /// クリップの長さ（秒）
    pub fn len(&self) -> f64 {
        (self.src_out - self.src_in).max(0.0)
    }
    /// タイムライン上の終了（秒）
    pub fn end(&self) -> f64 {
        self.start + self.len()
    }
    /// 時刻 t に映る・鳴るか（終わりの時刻は含まない）
    pub fn covers(&self, t: f64) -> bool {
        self.start <= t && t < self.end()
    }
}

/// 不要部分（無音など）
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Mark {
    pub a: f64,
    pub b: f64,
    pub k: String,
    /// 削除にしたら true
    pub done: bool,
}

impl Project {
    pub fn from_json(s: &str) -> serde_json::Result<Self> {
        serde_json::from_str(s)
    }
    pub fn media(&self, id: &str) -> Option<&Media> {
        self.media.iter().find(|m| m.id == id)
    }
    pub fn track(&self, id: &str) -> Option<&Track> {
        self.tracks.iter().find(|t| t.id == id)
    }
}
