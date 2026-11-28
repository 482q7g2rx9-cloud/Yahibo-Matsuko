//! トラッキング（M6）：選んだ四角（テンプレート）を、次のフレームの近くで探して追う。
//!
//! - フレームはグレーの画素（幅 w × 高さ h）。速さのため、画面側は幅 480 に縮めたものを渡す
//! - 似ている度合いは正規化相互相関（明るさが変わっても追える）。まず 2 画素おきに探し、近くを 1 画素ずつ探し、
//!   最後に放物線で 1 画素より細かい位置を出す
//! - よく似ているときは、テンプレートを少しずつ今の絵に寄せる（向きや形が少しずつ変わっても追える）
//! - 似ている度合いが低くなったら、見失ったとして止める

/// 1 フレームの結果：四角の中心（画素）。見失ったら、そのフレームから先は返さない
pub type Point = (f64, f64);

/// 見失ったとみなす、似ている度合い
pub const LOST: f64 = 0.35;

struct Integral {
    w: usize,
    s: Vec<f64>,
    q: Vec<f64>,
}
impl Integral {
    fn new(f: &[u8], w: usize, h: usize) -> Self {
        let (mut s, mut q) = (vec![0.0; (w + 1) * (h + 1)], vec![0.0; (w + 1) * (h + 1)]);
        for y in 0..h {
            let (mut rs, mut rq) = (0.0, 0.0);
            for x in 0..w {
                let v = f[y * w + x] as f64;
                rs += v;
                rq += v * v;
                s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + rs;
                q[(y + 1) * (w + 1) + x + 1] = q[y * (w + 1) + x + 1] + rq;
            }
        }
        Integral { w: w + 1, s, q }
    }
    /// (x, y) から tw × th の和と二乗の和
    fn sum(&self, x: usize, y: usize, tw: usize, th: usize) -> (f64, f64) {
        let i = |a: &Vec<f64>| {
            a[(y + th) * self.w + x + tw] - a[y * self.w + x + tw] - a[(y + th) * self.w + x]
                + a[y * self.w + x]
        };
        (i(&self.s), i(&self.q))
    }
}

/// 追う。frames の最初のフレームの四角 (x, y, w, h)（画素）から始めて、各フレームの中心を返す
pub fn track(
    frames: &[Vec<u8>],
    w: usize,
    h: usize,
    init: (f64, f64, f64, f64),
    mut progress: impl FnMut(usize) -> bool,
) -> Vec<Point> {
    let tw = (init.2.round() as usize).clamp(6, w.saturating_sub(2).max(6));
    let th = (init.3.round() as usize).clamp(6, h.saturating_sub(2).max(6));
    if frames.is_empty() || tw >= w || th >= h {
        return vec![];
    }
    let n = (tw * th) as f64;
    let clampx = |x: f64| x.round().clamp(0.0, (w - tw) as f64) as usize;
    let clampy = |y: f64| y.round().clamp(0.0, (h - th) as f64) as usize;
    // テンプレート（平均を引いたもの）
    let patch = |f: &[u8], x: usize, y: usize| -> Vec<f64> {
        let mut v = Vec::with_capacity(tw * th);
        for yy in 0..th {
            for xx in 0..tw {
                v.push(f[(y + yy) * w + x + xx] as f64);
            }
        }
        v
    };
    let center0 = |v: &mut Vec<f64>| {
        let m = v.iter().sum::<f64>() / n;
        v.iter_mut().for_each(|x| *x -= m);
        v.iter().map(|x| x * x).sum::<f64>().sqrt().max(1e-6)
    };
    let (mut px, mut py) = (clampx(init.0), clampy(init.1));
    let mut tmpl = patch(&frames[0], px, py);
    let mut tn = center0(&mut tmpl);
    let mut out = vec![(px as f64 + tw as f64 / 2.0, py as f64 + th as f64 / 2.0)];
    let r = ((tw.max(th) as f64 * 0.6).round() as i64).clamp(8, 48);
    for (k, f) in frames.iter().enumerate().skip(1) {
        if !progress(k) {
            break;
        }
        let ii = Integral::new(f, w, h);
        let score = |x: usize, y: usize| -> f64 {
            let (s, q) = ii.sum(x, y, tw, th);
            let var = (q - s * s / n).max(0.0).sqrt();
            if var < 1e-6 {
                return -1.0;
            }
            let mut c = 0.0;
            for yy in 0..th {
                let row = &f[(y + yy) * w + x..(y + yy) * w + x + tw];
                let tr = &tmpl[yy * tw..yy * tw + tw];
                for (a, b) in row.iter().zip(tr) {
                    c += *a as f64 * b;
                }
            }
            c / (var * tn)
        };
        let (mut best, mut bx, mut by) = (-2.0, px, py);
        let look = |step: i64,
                    rad: i64,
                    cx: usize,
                    cy: usize,
                    best: &mut f64,
                    bx: &mut usize,
                    by: &mut usize| {
            let mut dy = -rad;
            while dy <= rad {
                let mut dx = -rad;
                while dx <= rad {
                    let (x, y) = (clampx(cx as f64 + dx as f64), clampy(cy as f64 + dy as f64));
                    let s = score(x, y);
                    if s > *best {
                        *best = s;
                        *bx = x;
                        *by = y;
                    }
                    dx += step;
                }
                dy += step;
            }
        };
        look(2, r, px, py, &mut best, &mut bx, &mut by);
        let (cx, cy) = (bx, by);
        look(1, 2, cx, cy, &mut best, &mut bx, &mut by);
        if best < LOST {
            break;
        }
        // 1 画素より細かい位置（放物線）
        let sub = |a: f64, b: f64, c: f64| {
            let d = a - 2.0 * b + c;
            if d.abs() < 1e-9 {
                0.0
            } else {
                (0.5 * (a - c) / d).clamp(-0.5, 0.5)
            }
        };
        let fx = if bx > 0 && bx < w - tw {
            sub(score(bx - 1, by), best, score(bx + 1, by))
        } else {
            0.0
        };
        let fy = if by > 0 && by < h - th {
            sub(score(bx, by - 1), best, score(bx, by + 1))
        } else {
            0.0
        };
        out.push((
            bx as f64 + fx + tw as f64 / 2.0,
            by as f64 + fy + th as f64 / 2.0,
        ));
        // よく似ていれば、テンプレートを今の絵に少し寄せる
        if best > 0.8 {
            let mut cur = patch(f, bx, by);
            center0(&mut cur);
            for (t, c) in tmpl.iter_mut().zip(&cur) {
                *t = 0.85 * *t + 0.15 * c;
            }
            tn = tmpl.iter().map(|x| x * x).sum::<f64>().sqrt().max(1e-6);
        }
        px = bx;
        py = by;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 模様のある四角が、斜めに動く（1 フレームに 3.5 画素・1.5 画素）
    #[test]
    fn follows_a_moving_square() {
        let (w, h) = (160, 90);
        let mut frames = vec![];
        for k in 0..20 {
            let (ox, oy) = (20.0 + 3.5 * k as f64, 20.0 + 1.5 * k as f64);
            let mut f = vec![0u8; w * h];
            for y in 0..h {
                for x in 0..w {
                    // 背景はゆるい縞
                    let mut v = 60.0 + 20.0 * ((x as f64) * 0.15).sin();
                    let (dx, dy) = (x as f64 - ox, y as f64 - oy);
                    if (0.0..16.0).contains(&dx) && (0.0..16.0).contains(&dy) {
                        v = if ((dx as i64 / 4) + (dy as i64 / 4)) % 2 == 0 {
                            230.0
                        } else {
                            120.0
                        };
                    }
                    f[y * w + x] = v as u8;
                }
            }
            frames.push(f);
        }
        let pts = track(&frames, w, h, (20.0, 20.0, 16.0, 16.0), |_| true);
        assert_eq!(pts.len(), 20);
        for (k, p) in pts.iter().enumerate() {
            let want = (28.0 + 3.5 * k as f64, 28.0 + 1.5 * k as f64);
            assert!(
                (p.0 - want.0).abs() < 1.0 && (p.1 - want.1).abs() < 1.0,
                "{k}: {p:?} / {want:?}"
            );
        }
    }

    /// 消えたら止める
    #[test]
    fn stops_when_lost() {
        let (w, h) = (80, 60);
        let mut a = vec![40u8; w * h];
        for y in 20..36 {
            for x in 20..36 {
                a[y * w + x] = if (x / 4 + y / 4) % 2 == 0 { 250 } else { 10 };
            }
        }
        let b: Vec<u8> = (0..w * h).map(|i| ((i * 7919) % 251) as u8).collect();
        let pts = track(
            &[a.clone(), a, b.clone(), b],
            w,
            h,
            (20.0, 20.0, 16.0, 16.0),
            |_| true,
        );
        assert_eq!(pts.len(), 2);
    }
}
