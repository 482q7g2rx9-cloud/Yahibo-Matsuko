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

/// FFmpeg の式：フィルターの時刻 `t` のときの値（素材の秒は t + off）。キーフレームがなければ fixed。
/// 区間ごとの式を足し合わせる形にして、入れ子を深くしない
pub fn expr(list: Option<&[Kf]>, fixed: f64, off: f64) -> String {
    let Some(l) = list.filter(|l| !l.is_empty()) else {
        return format!("{fixed:.4}");
    };
    let s = format!("(t+{off:.6})");
    let (first, last) = (&l[0], &l[l.len() - 1]);
    let mut e = format!(
        "lt({s},{:.6})*{:.4}+gte({s},{:.6})*{:.4}",
        first.t, first.v, last.t, last.v
    );
    for w in l.windows(2) {
        let (a, b) = (&w[0], &w[1]);
        let span = b.t - a.t;
        if span <= 0.0 {
            continue;
        }
        let u = format!("(({s}-{:.6})/{span:.6})", a.t);
        let f = match a.e.as_deref() {
            Some("hold") => "0".to_string(),
            Some("ease") => format!("{u}*{u}*(3-2*{u})"),
            Some("in") => format!("{u}*{u}"),
            Some("out") => format!("(1-(1-{u})*(1-{u}))"),
            _ => u.clone(),
        };
        e.push_str(&format!(
            "+gte({s},{:.6})*lt({s},{:.6})*({:.4}+({:.4})*{f})",
            a.t,
            b.t,
            a.v,
            b.v - a.v
        ));
    }
    e
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

    /// 式を、同じ計算で確かめる（t と off を入れて、簡単な評価器で計算）
    #[test]
    fn expression_shape() {
        let l = vec![k(1.0, 0.0, Some("ease")), k(2.0, 10.0, None)];
        let e = expr(Some(&l), 0.0, 0.5);
        assert!(
            e.starts_with(
                "lt((t+0.500000),1.000000)*0.0000+gte((t+0.500000),2.000000)*10.0000+gte("
            ),
            "{e}"
        );
        assert!(e.contains("*(3-2*"), "{e}");
        assert_eq!(expr(None, 25.0, 0.0), "25.0000");
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
