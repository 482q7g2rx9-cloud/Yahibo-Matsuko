//! プロジェクトの型。JSON の項目名はブラウザ版に合わせる。

use serde::{Deserialize, Serialize};

/// 1つの番組（プロジェクト）
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Project {
    /// 保存形式の版
    pub v: u32,
    /// 見本プロジェクトなら 1
    pub sample: u8,
    /// 調整レイヤー（色補正）を使うなら 1
    pub adj: u8,
    pub media: Vec<Media>,
    /// V1（映像）のクリップ。前から順に、すき間なく並ぶ
    pub seq: Vec<Clip>,
    /// V2（テロップ）
    pub titles: Vec<Title>,
    /// A2（BGM）
    pub bgm: Vec<BgmClip>,
    /// 書き出し範囲のイン点（秒）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pin: Option<f64>,
    /// 書き出し範囲のアウト点（秒）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pout: Option<f64>,
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
}

/// タイムラインのクリップ（V1）
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Clip {
    pub id: String,
    /// 素材の id
    pub m: String,
    /// 素材の中の開始位置（秒）
    #[serde(rename = "in")]
    pub src_in: f64,
    /// 素材の中の終了位置（秒）
    #[serde(rename = "out")]
    pub src_out: f64,
}

impl Clip {
    /// クリップの長さ（秒）
    pub fn len(&self) -> f64 {
        (self.src_out - self.src_in).max(0.0)
    }
}

/// テロップ
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Title {
    pub id: String,
    /// 開始（秒）
    pub t: f64,
    /// 長さ（秒）
    pub d: f64,
    /// 種類：name / q / sub / credit
    pub st: String,
    /// 大きさ：小 / 中 / 大
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sz: Option<String>,
    /// 表示する文字（改行あり）
    pub label: String,
}

/// BGM のクリップ（A2）
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct BgmClip {
    pub id: String,
    /// 素材の id。見本の BGM は None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub m: Option<String>,
    /// タイムライン上の開始（秒）
    pub start: f64,
    #[serde(rename = "in")]
    pub src_in: f64,
    #[serde(rename = "out")]
    pub src_out: f64,
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
}
