//! 音声の波形（音量のピーク）。ブラウザ版の peaksOf と同じ形：
//! 1秒あたり 10 個（50〜12000 個）、最大を 1 にそろえ、小数第3位まで。
//! FFmpeg から流れてくるモノラルの f32 を少しずつ受け取り、全体をメモリに持たずに計算する。

/// 波形の計算に使うサンプリング周波数（FFmpeg に `-ar` で指定する）
pub const PEAK_RATE: u32 = 8000;

/// 素材の長さから、ピークの個数を決める
pub fn bucket_count(duration: f64) -> usize {
    ((duration * 10.0).round() as i64).clamp(50, 12000) as usize
}

/// 流れてくるサンプルからピークを集める
#[derive(Debug, Clone)]
pub struct PeakAccumulator {
    per_bucket: f64,
    peaks: Vec<f32>,
    seen: u64,
}

impl PeakAccumulator {
    /// `duration` 秒、`rate` Hz の音声を受け取る準備をする
    pub fn new(duration: f64, rate: u32) -> Self {
        let n = bucket_count(duration);
        let total = (duration.max(0.0) * rate as f64).max(1.0);
        Self {
            per_bucket: (total / n as f64).max(1.0),
            peaks: vec![0.0; n],
            seen: 0,
        }
    }

    pub fn push(&mut self, samples: &[f32]) {
        let n = self.peaks.len();
        for &s in samples {
            let i = ((self.seen as f64 / self.per_bucket) as usize).min(n - 1);
            let a = s.abs();
            if a.is_finite() && a > self.peaks[i] {
                self.peaks[i] = a;
            }
            self.seen += 1;
        }
    }

    /// little-endian の f32 が並んだバイト列を受け取る。端数のバイトは返すので、次の塊の先頭に足す
    pub fn push_bytes<'a>(&mut self, bytes: &'a [u8]) -> &'a [u8] {
        let whole = bytes.len() / 4 * 4;
        let samples: Vec<f32> = bytes[..whole]
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();
        self.push(&samples);
        &bytes[whole..]
    }

    /// 受け取ったサンプル数
    pub fn samples(&self) -> u64 {
        self.seen
    }

    /// 最大を 1 にそろえ、小数第3位までにしたピーク
    pub fn finish(self) -> Vec<f64> {
        let mx = self.peaks.iter().cloned().fold(0.0f32, f32::max);
        let mx = if mx > 0.0 { mx } else { 1.0 };
        self.peaks
            .iter()
            .map(|&v| ((v / mx) as f64 * 1000.0).round() / 1000.0)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts() {
        assert_eq!(bucket_count(1.0), 50);
        assert_eq!(bucket_count(60.0), 600);
        assert_eq!(bucket_count(4.0 * 3600.0), 12000);
    }

    #[test]
    fn normalised_and_in_place() {
        // 10 秒：前半は小さく、7 秒目に大きな音
        let mut acc = PeakAccumulator::new(10.0, 100);
        let mut s = vec![0.1f32; 1000];
        for v in &mut s[700..710] {
            *v = -0.5;
        }
        acc.push(&s[..333]);
        acc.push(&s[333..]);
        let p = acc.finish();
        assert_eq!(p.len(), 100);
        assert_eq!(p[70], 1.0);
        assert_eq!(p[10], 0.2);
    }

    #[test]
    fn bytes_with_remainder() {
        let mut acc = PeakAccumulator::new(1.0, 50);
        let bytes: Vec<u8> = [0.25f32, -1.0, 0.5]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        let rest = acc.push_bytes(&bytes[..7]).to_vec();
        assert_eq!(rest.len(), 3);
        let mut next = rest;
        next.extend_from_slice(&bytes[7..]);
        assert!(acc.push_bytes(&next).is_empty());
        assert_eq!(acc.samples(), 3);
        let p = acc.finish();
        assert_eq!(p[0], 0.25);
        assert_eq!(p[1], 1.0);
    }

    #[test]
    fn silence_is_zero() {
        let mut acc = PeakAccumulator::new(5.0, 10);
        acc.push(&[0.0; 50]);
        assert!(acc.finish().iter().all(|&v| v == 0.0));
    }
}
