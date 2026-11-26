//! タイムラインの計算。ブラウザ版の progDur / activeAt / xRange と同じ結果を返す。

use crate::model::{Clip, Project, Track, TrackKind};

/// 番組の長さ：全トラックで一番後ろにあるクリップの終わり（秒）
pub fn duration(p: &Project) -> f64 {
    p.clips.iter().map(Clip::end).fold(0.0, f64::max)
}

/// トラック tid のクリップを、開始の早い順に
pub fn on_track<'a>(p: &'a Project, tid: &str) -> Vec<&'a Clip> {
    let mut v: Vec<&Clip> = p.clips.iter().filter(|c| c.tr == tid).collect();
    v.sort_by(|a, b| a.start.total_cmp(&b.start));
    v
}

/// 音声トラックが鳴るか（ミュートでなく、ソロがあればソロのトラックだけ）
pub fn audible(p: &Project, t: &Track) -> bool {
    if t.mute {
        return false;
    }
    let any_solo = p.tracks.iter().any(|x| x.kind == TrackKind::Audio && x.solo);
    !any_solo || t.solo
}

/// 時刻 t に画面に描く映像のクリップを、重ねる順（V1 から上へ）に返す。表示を切ったトラックは除く
pub fn visible_at(p: &Project, t: f64) -> Vec<&Clip> {
    p.tracks
        .iter()
        .rev()
        .filter(|tr| tr.kind == TrackKind::Video && !tr.hide)
        .flat_map(|tr| p.clips.iter().filter(move |c| c.tr == tr.id && c.covers(t)))
        .collect()
}

/// 時刻 t に鳴る音声のクリップ
pub fn audible_at(p: &Project, t: f64) -> Vec<&Clip> {
    p.clips
        .iter()
        .filter(|c| c.covers(t))
        .filter(|c| p.track(&c.tr).is_some_and(|tr| tr.kind == TrackKind::Audio && audible(p, tr)))
        .collect()
}

/// 1つのトラックの中でクリップが重なっていないか（編集操作のあとで必ず成り立つ）
pub fn overlaps(p: &Project) -> Vec<(String, String)> {
    let mut out = vec![];
    for tr in &p.tracks {
        let v = on_track(p, &tr.id);
        for w in v.windows(2) {
            if w[1].start < w[0].end() - 1e-6 {
                out.push((w[0].id.clone(), w[1].id.clone()));
            }
        }
    }
    out
}

/// 書き出す範囲（秒）。イン・アウト点を使い、なければ全体
pub fn export_range(p: &Project, use_points: bool) -> (f64, f64) {
    let d = duration(p);
    if use_points && (p.pin.is_some() || p.pout.is_some()) {
        (p.pin.unwrap_or(0.0).min(d), p.pout.unwrap_or(d).min(d))
    } else {
        (0.0, d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ClipType;

    fn sample() -> Project {
        Project::from_json(include_str!("../tests/fixtures/sample-project.json")).unwrap()
    }

    #[test]
    fn duration_is_end_of_last_clip() {
        assert_eq!(duration(&sample()), 120.0);
        assert_eq!(duration(&Project::default()), 0.0);
    }

    #[test]
    fn sample_has_no_overlaps() {
        assert!(overlaps(&sample()).is_empty());
    }

    #[test]
    fn layers_are_drawn_from_v1_upwards() {
        let p = sample();
        let ids: Vec<&str> = visible_at(&p, 50.0).iter().map(|c| c.id.as_str()).collect();
        // V1 の映像 → V2 のテロップ → V3 の調整レイヤー
        assert_eq!(ids, vec!["c3", "t2", "adj"]);
        assert_eq!(visible_at(&p, 50.0)[1].kind, ClipType::Title);
    }

    #[test]
    fn hidden_and_muted_tracks_are_skipped() {
        let mut p = sample();
        p.tracks.iter_mut().find(|t| t.id == "V2").unwrap().hide = true;
        assert!(visible_at(&p, 50.0).iter().all(|c| c.tr != "V2"));
        let a: Vec<&str> = audible_at(&p, 5.0).iter().map(|c| c.id.as_str()).collect();
        assert_eq!(a, vec!["c1a", "b1", "n1"]);
        p.tracks.iter_mut().find(|t| t.id == "A2").unwrap().solo = true;
        let a: Vec<&str> = audible_at(&p, 5.0).iter().map(|c| c.id.as_str()).collect();
        assert_eq!(a, vec!["b1"]);
    }

    #[test]
    fn linked_clips_share_a_link() {
        let p = sample();
        let v = p.clips.iter().find(|c| c.id == "c3").unwrap();
        let a = p.clips.iter().find(|c| c.id == "c3a").unwrap();
        assert_eq!(v.link, a.link);
        assert_eq!((v.start, v.src_in, v.src_out), (41.0, 41.0, 95.0));
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

    #[test]
    fn round_trips_through_json() {
        let p = sample();
        let back = Project::from_json(&serde_json::to_string(&p).unwrap()).unwrap();
        assert_eq!(p, back);
    }
}
