//! 音声の波形（音量のピーク）。ブラウザ版の peaksOf と同じ形：
//! 1秒あたり 10 個（50〜12000 個）、最大を 1 にそろえ、小数第3位まで。
//! FFmpeg から流れてくる f32 を少しずつ受け取り、全体をメモリに持たずに計算する。
//! タイムラインに描く詳しい波形（WaveformAccumulator）も、ここで作る。

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

/// 詳しい波形（タイムラインに描く）の 1 秒あたりのバケット数。画面側の core/waveform.ts の waveRate と同じ
pub fn wave_rate(duration: f64) -> u32 {
    if duration <= 0.0 || !duration.is_finite() {
        return 100;
    }
    ((150000.0 / duration).floor() as i64).clamp(10, 100) as u32
}

/// 詳しい波形に使うサンプリング周波数
pub const WAVE_RATE: u32 = 16000;

/// 詳しい波形：チャンネル（1 か 2）ごとに、バケットの「上・下・実効値」を集める。
/// 形は画面側の core/waveform.ts（WaveformBuilder）と同じ：バケットごと・チャンネルごとに 3 バイト
/// （上と下は -1〜1 を 0〜255 に、128 が 0。実効値は 0〜1 を 0〜255 に）。
/// 無音の検出に使う前の形式のピーク（PeakAccumulator）も、同時に作る。
#[derive(Debug, Clone)]
pub struct WaveformAccumulator {
    pub rate: u32,
    pub ch: usize,
    pub n: usize,
    per_bucket: f64,
    seen: u64,
    mx: Vec<f32>,
    mn: Vec<f32>,
    sq: Vec<f64>,
    cnt: Vec<u32>,
    peaks: PeakAccumulator,
}

fn q8(v: f32) -> u8 {
    ((v.clamp(-1.0, 1.0) * 127.0).round() as i32 + 128) as u8
}

impl WaveformAccumulator {
    pub fn new(duration: f64, sample_rate: u32, channels: usize) -> Self {
        let rate = wave_rate(duration);
        let ch = channels.clamp(1, 2);
        let n = ((duration.max(0.0) * rate as f64).ceil() as usize).max(1);
        Self {
            rate,
            ch,
            n,
            per_bucket: (sample_rate as f64 / rate as f64).max(1.0),
            seen: 0,
            mx: vec![0.0; n * ch],
            mn: vec![0.0; n * ch],
            sq: vec![0.0; n * ch],
            cnt: vec![0; n],
            peaks: PeakAccumulator::new(duration, sample_rate),
        }
    }

    /// チャンネルが交互に並んだサンプル（端数のフレームは捨てずに呼ぶ側で持つこと）
    pub fn push_frames(&mut self, interleaved: &[f32]) {
        let mut frame_abs = Vec::with_capacity(interleaved.len() / self.ch);
        for f in interleaved.chunks_exact(self.ch) {
            let b = ((self.seen as f64 / self.per_bucket) as usize).min(self.n - 1);
            let mut fa = 0.0f32;
            for (c, &s) in f.iter().enumerate() {
                if !s.is_finite() {
                    continue;
                }
                let k = b * self.ch + c;
                if s > self.mx[k] {
                    self.mx[k] = s;
                }
                if s < self.mn[k] {
                    self.mn[k] = s;
                }
                self.sq[k] += (s as f64) * (s as f64);
                fa = fa.max(s.abs());
            }
            self.cnt[b] += 1;
            self.seen += 1;
            frame_abs.push(fa);
        }
        self.peaks.push(&frame_abs);
    }

    /// little-endian の f32（チャンネルが交互）のバイト列を受け取る。端数のバイトは返すので、次の塊の先頭に足す
    pub fn push_bytes<'a>(&mut self, bytes: &'a [u8]) -> &'a [u8] {
        let frame = 4 * self.ch;
        let whole = bytes.len() / frame * frame;
        let samples: Vec<f32> = bytes[..whole]
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();
        self.push_frames(&samples);
        &bytes[whole..]
    }

    /// 受け取ったフレーム数
    pub fn samples(&self) -> u64 {
        self.seen
    }

    /// 詳しい波形のバイト列
    pub fn bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.n * self.ch * 3);
        for b in 0..self.n {
            for c in 0..self.ch {
                let k = b * self.ch + c;
                let rms = if self.cnt[b] > 0 {
                    (self.sq[k] / self.cnt[b] as f64).sqrt().min(1.0)
                } else {
                    0.0
                };
                out.push(q8(self.mx[k]));
                out.push(q8(self.mn[k]));
                out.push((rms * 255.0).round() as u8);
            }
        }
        out
    }

    /// （詳しい波形のバイト列, 前の形式のピーク）
    pub fn finish(self) -> (Vec<u8>, Vec<f64>) {
        let b = self.bytes();
        (b, self.peaks.finish())
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

    #[test]
    fn waveform_stereo() {
        // 2 秒・左は 0.5 の正弦波、右は無音
        let sr = 8000;
        let mut w = WaveformAccumulator::new(2.0, sr, 2);
        assert_eq!((w.rate, w.ch, w.n), (100, 2, 200));
        let mut inter = Vec::new();
        for i in 0..(2 * sr) {
            inter.push(0.5 * (2.0 * std::f32::consts::PI * 220.0 * i as f32 / sr as f32).sin());
            inter.push(0.0);
        }
        let bytes: Vec<u8> = inter.iter().flat_map(|v| v.to_le_bytes()).collect();
        let rest = w.push_bytes(&bytes[..1001]).to_vec();
        let mut next = rest;
        next.extend_from_slice(&bytes[1001..]);
        assert!(w.push_bytes(&next).is_empty());
        assert_eq!(w.samples(), 2 * sr as u64);
        let (b, peaks) = w.finish();
        assert_eq!(b.len(), 200 * 2 * 3);
        // 左：上は 0.5 → 128+64、下は -0.5 → 128-64、実効値は 0.354 → 90
        assert!((b[0] as i32 - 192).abs() <= 1);
        assert!((b[1] as i32 - 64).abs() <= 1);
        assert!((b[2] as i32 - 90).abs() <= 1);
        // 右は無音
        assert_eq!(&b[3..6], &[128, 128, 0]);
        assert_eq!(peaks.len(), 50);
        assert!(peaks.iter().all(|&v| v > 0.9));
    }

    #[test]
    fn waveform_rate() {
        assert_eq!(wave_rate(60.0), 100);
        assert_eq!(wave_rate(3600.0), 41);
        assert_eq!(wave_rate(36000.0), 10);
    }
}
