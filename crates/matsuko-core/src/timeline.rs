//! タイムラインの計算。ブラウザ版の seqDur / starts / at と同じ結果を返す。

use crate::model::{Clip, Project};

/// V1 の全長（秒）
pub fn duration(p: &Project) -> f64 {
    p.seq.iter().map(Clip::len).sum()
}

/// 各クリップのタイムライン上の開始位置（秒）
pub fn starts(p: &Project) -> Vec<f64> {
    let mut s = 0.0;
    p.seq
        .iter()
        .map(|c| {
            let r = s;
            s += c.len();
            r
        })
        .collect()
}

/// 時刻 t に映るクリップ
#[derive(Debug, PartialEq)]
pub struct Hit<'a> {
    pub clip: &'a Clip,
    pub index: usize,
    /// クリップの開始位置（タイムライン上、秒）
    pub start: f64,
    /// 素材の中の位置（秒）
    pub local: f64,
}

pub fn clip_at(p: &Project, t: f64) -> Option<Hit<'_>> {
    let mut s = 0.0;
    let last = p.seq.len().checked_sub(1)?;
    for (i, c) in p.seq.iter().enumerate() {
        let d = c.len();
        if t < s + d || (i == last && t <= s + d) {
            return Some(Hit { clip: c, index: i, start: s, local: c.src_in + (t - s).min(d) });
        }
        s += d;
    }
    None
}

/// 書き出す範囲（秒）。イン・アウト点がなければ全体
pub fn export_range(p: &Project, use_points: bool) -> (f64, f64) {
    let d = duration(p);
    if use_points && (p.pin.is_some() || p.pout.is_some()) {
        let a = p.pin.unwrap_or(0.0).min(d);
        let b = p.pout.unwrap_or(d).min(d);
        (a, b)
    } else {
        (0.0, d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Project {
        Project::from_json(include_str!("../tests/fixtures/sample-project.json")).unwrap()
    }

    #[test]
    fn duration_of_sample_is_two_minutes() {
        assert_eq!(duration(&sample()), 120.0);
    }

    #[test]
    fn starts_follow_clip_lengths() {
        assert_eq!(starts(&sample()), vec![0.0, 24.0, 41.0, 95.0]);
    }

    #[test]
    fn clip_at_maps_to_source_time() {
        let p = sample();
        let h = clip_at(&p, 50.0).unwrap();
        assert_eq!(h.clip.m, "v03");
        assert_eq!(h.start, 41.0);
        assert_eq!(h.local, 41.0 + 9.0);
        assert_eq!(clip_at(&p, 120.0).unwrap().index, 3);
        assert!(clip_at(&p, 120.5).is_none());
        assert!(clip_at(&Project::default(), 0.0).is_none());
    }

    #[test]
    fn export_range_uses_points() {
        let mut p = sample();
        assert_eq!(export_range(&p, true), (0.0, 120.0));
        p.pin = Some(10.0);
        p.pout = Some(200.0);
        assert_eq!(export_range(&p, true), (10.0, 120.0));
        assert_eq!(export_range(&p, false), (0.0, 120.0));
    }
}
