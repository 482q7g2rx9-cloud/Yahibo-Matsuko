//! キーフレーム（M6・エフェクトページ）。画面の `apps/editor/src/core/keyframes.ts` と同じ計算。
//!
//! キーフレームの時刻 `t` は「素材の中の秒」（クリップの `in` と同じ基準）。`e` はそのキーフレームから次までの変わり方。

use serde::{Deserialize, Serialize};

/// キーフレーム
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Kf {
    pub t: f64,
    pub v: f64,
    /// linear（なし）・ease・in・out・hold
    #[serde(skip_serializing_if = "Option::is_none")]
    pub e: Option<String>,
}

/// 変わり方の曲線（0〜1 → 0〜1）
pub fn ease(e: Option<&str>, u: f64) -> f64 {
    match e {
        Some("hold") => 0.0,
        Some("ease") => u * u * (3.0 - 2.0 * u),
        Some("in") => u * u,
        Some("out") => 1.0 - (1.0 - u) * (1.0 - u),
        _ => u,
    }
}

/// キーフレームの列から、素材の秒 s のときの値（列は時刻の順）
pub fn interp(list: &[Kf], s: f64) -> f64 {
    let (Some(first), Some(last)) = (list.first(), list.last()) else {
        return 0.0;
    };
    if s <= first.t {
        return first.v;
    }
    if s >= last.t {
        return last.v;
    }
    let mut i = 0;
    while i < list.len() - 2 && s >= list[i + 1].t {
        i += 1;
    }
    let (a, b) = (&list[i], &list[i + 1]);
    let span = b.t - a.t;
    let u = if span > 0.0 { (s - a.t) / span } else { 1.0 };
    a.v + (b.v - a.v) * ease(a.e.as_deref(), u)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn k(t: f64, v: f64, e: Option<&str>) -> Kf {
        Kf {
            t,
            v,
            e: e.map(String::from),
        }
    }

    /// 画面側（keyframes.test.ts の VECTORS）と同じ値
    #[test]
    fn same_values_as_the_screen() {
        let cases: Vec<(Vec<Kf>, f64, f64)> = vec![
            (vec![k(0.0, 0.0, None), k(1.0, 100.0, None)], 0.5, 50.0),
            (
                vec![k(0.0, 0.0, Some("ease")), k(1.0, 100.0, None)],
                0.25,
                15.625,
            ),
            (
                vec![k(0.0, 0.0, Some("in")), k(1.0, 100.0, None)],
                0.5,
                25.0,
            ),
            (
                vec![k(0.0, 0.0, Some("out")), k(1.0, 100.0, None)],
                0.5,
                75.0,
            ),
            (
                vec![k(0.0, 0.0, Some("hold")), k(1.0, 100.0, None)],
                0.99,
                0.0,
            ),
            (
                vec![k(0.0, 10.0, None), k(1.0, 20.0, None), k(3.0, -20.0, None)],
                2.0,
                0.0,
            ),
            (vec![k(1.0, 5.0, None), k(2.0, 9.0, None)], 0.0, 5.0),
            (vec![k(1.0, 5.0, None), k(2.0, 9.0, None)], 3.0, 9.0),
        ];
        for (l, s, v) in cases {
            assert!((interp(&l, s) - v).abs() < 1e-6, "{l:?} {s} → {v}");
        }
    }
}
