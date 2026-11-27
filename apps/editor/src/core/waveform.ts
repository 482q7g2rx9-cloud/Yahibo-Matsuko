// 音声の波形（タイムラインに描く詳しい波形）。
// チャンネル（左右）ごとに、短い区間（バケット）の「いちばん上・いちばん下・実効値（RMS）」を持つ。
// 値は元の音の大きさのまま（0 dBFS が 1）で、最大にそろえない。クリップの音量を変えると、波形もその分だけ変わる。
// デスクトップ版（crates/matsuko-core/src/peaks.rs の WaveformAccumulator）も同じ形で作る。

/** 素材に持たせる波形 */
export interface Waveform {
  /** 形式の版 */
  v: 1;
  /** 1 秒あたりのバケット数 */
  r: number;
  /** チャンネル数（1 か 2） */
  ch: number;
  /** バケット数 */
  n: number;
  /** バケットごと・チャンネルごとに [上, 下, 実効値] の 3 バイト（base64） */
  d: string;
}

/** 1 秒あたりのバケット数：短い素材は 100（10 ミリ秒ごと）、長い素材は全体で 15 万個ほどまで */
export const WAVE_MAX_RATE = 100;
export const WAVE_MIN_RATE = 10;
export const WAVE_MAX_BUCKETS = 150000;
export function waveRate(duration: number): number {
  if (!(duration > 0)) return WAVE_MAX_RATE;
  return Math.max(WAVE_MIN_RATE, Math.min(WAVE_MAX_RATE, Math.floor(WAVE_MAX_BUCKETS / duration)));
}

/** -1〜1 を 1 バイトに（128 が 0） */
export function q8(v: number): number {
  const x = Math.round(Math.max(-1, Math.min(1, v)) * 127);
  return x + 128;
}
/** 1 バイトを -1〜1 に */
export function dq8(b: number): number {
  return (b - 128) / 127;
}

/**
 * サンプルを少しずつ受け取って波形を作る。
 * push には、チャンネルごとのサンプル（同じ長さ）を渡す
 */
export class WaveformBuilder {
  readonly rate: number;
  readonly ch: number;
  readonly n: number;
  private perBucket: number;
  private seen = 0;
  private mx: Float32Array;
  private mn: Float32Array;
  private sq: Float64Array;
  private cnt: Float64Array;

  constructor(duration: number, sampleRate: number, channels: number) {
    this.rate = waveRate(duration);
    this.ch = Math.max(1, Math.min(2, channels));
    this.n = Math.max(1, Math.ceil(Math.max(0, duration) * this.rate));
    this.perBucket = Math.max(1, sampleRate / this.rate);
    this.mx = new Float32Array(this.n * this.ch);
    this.mn = new Float32Array(this.n * this.ch);
    this.sq = new Float64Array(this.n * this.ch);
    this.cnt = new Float64Array(this.n);
  }

  push(chans: ArrayLike<number>[]): void {
    const len = chans[0] ? chans[0].length : 0;
    for (let i = 0; i < len; i++) {
      const b = Math.min(this.n - 1, Math.floor(this.seen / this.perBucket));
      for (let c = 0; c < this.ch; c++) {
        const s = (chans[c] || chans[0])[i];
        if (!Number.isFinite(s)) continue;
        const k = b * this.ch + c;
        if (s > this.mx[k]) this.mx[k] = s;
        if (s < this.mn[k]) this.mn[k] = s;
        this.sq[k] += s * s;
      }
      this.cnt[b]++;
      this.seen++;
    }
  }

  /** 受け取ったサンプル数（1 チャンネルあたり） */
  samples(): number {
    return this.seen;
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.n * this.ch * 3);
    for (let b = 0; b < this.n; b++) {
      for (let c = 0; c < this.ch; c++) {
        const k = b * this.ch + c, o = k * 3;
        out[o] = q8(this.mx[k]);
        out[o + 1] = q8(this.mn[k]);
        out[o + 2] = Math.round(Math.min(1, this.cnt[b] ? Math.sqrt(this.sq[k] / this.cnt[b]) : 0) * 255);
      }
    }
    return out;
  }

  finish(): Waveform {
    return { v: 1, r: this.rate, ch: this.ch, n: this.n, d: toBase64(this.bytes()) };
  }
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 0x8000)));
  return btoa(s);
}
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 波形のバイト列（読み直さないよう、文字列ごとに覚えておく） */
const cache = new Map<string, Uint8Array>();
export function waveBytes(w: Waveform): Uint8Array {
  let b = cache.get(w.d);
  if (!b) {
    b = fromBase64(w.d);
    if (cache.size > 64) cache.clear();
    cache.set(w.d, b);
  }
  return b;
}

/** 画面の 1 列ごとの値（チャンネルごとに並ぶ）。gain はクリップの音量（倍率） */
export interface WaveColumns {
  ch: number;
  n: number;
  max: Float32Array;
  min: Float32Array;
  rms: Float32Array;
}

/** 素材の a〜b 秒を n 列にまとめる */
export function waveColumns(w: Waveform, a: number, b: number, n: number, gain = 1): WaveColumns {
  const by = waveBytes(w), ch = w.ch, cols = Math.max(1, Math.round(n));
  const max = new Float32Array(cols * ch), min = new Float32Array(cols * ch), rms = new Float32Array(cols * ch);
  const per = ((b - a) * w.r) / cols;
  for (let x = 0; x < cols; x++) {
    const f0 = a * w.r + x * per, f1 = f0 + per;
    let i0 = Math.floor(f0), i1 = Math.max(i0 + 1, Math.ceil(f1));
    i0 = Math.max(0, i0);
    i1 = Math.min(w.n, i1);
    for (let c = 0; c < ch; c++) {
      let hi = 0, lo = 0, sq = 0, k = 0;
      for (let i = i0; i < i1; i++) {
        const o = (i * ch + c) * 3;
        const u = dq8(by[o]), d = dq8(by[o + 1]), r = by[o + 2] / 255;
        if (u > hi) hi = u;
        if (d < lo) lo = d;
        sq += r * r;
        k++;
      }
      const j = x * ch + c;
      max[j] = hi * gain;
      min[j] = lo * gain;
      rms[j] = (k ? Math.sqrt(sq / k) : 0) * gain;
    }
  }
  return { ch, n: cols, max, min, rms };
}
