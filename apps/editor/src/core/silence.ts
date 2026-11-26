// 無音の検出と、無音を除いた区間。波形（音量のピーク）から計算する。
// ピークは、いちばん大きい音を 1 にそろえた値（ブラウザ版も、デスクトップ版の FFmpeg で作ったものも同じ）。
import type { Mark } from './model';

export interface SilenceOptions {
  /** これより小さい音を無音とみなす（dB。いちばん大きい音が 0 dB。例：35 なら -35 dB） */
  thresholdDb: number;
  /** これより長く続いたときだけ無音とする（秒） */
  minLength: number;
}

/** 話の頭と終わりを切りすぎないよう、無音の両端に残す長さ（秒） */
export const SILENCE_PAD = 0.1;
/** 残す長さを引いたあと、これより短い無音は数えない（秒） */
export const SILENCE_MIN_MARK = 0.2;
/** これより短い区間は残さない（秒） */
export const MIN_KEEP = 0.1;

/**
 * 無音の区間を探す。
 * @param peaks 波形（素材の長さ duration 秒を等分した、各区間の最大の音量）
 */
export function detectSilence(peaks: number[], duration: number, o: SilenceOptions): Mark[] {
  const thr = Math.pow(10, -o.thresholdDb / 20), N = peaks.length, dt = duration / N, out: Mark[] = [];
  let st = -1;
  for (let i = 0; i <= N; i++) {
    const quiet = i < N && peaks[i] < thr;
    if (quiet && st < 0) st = i;
    if (!quiet && st >= 0) {
      const a = st * dt, b = i * dt;
      if (b - a >= o.minLength) {
        // 素材の最初・最後に接する無音は、端まで含める
        const a2 = st === 0 ? 0 : a + SILENCE_PAD, b2 = i === N ? duration : b - SILENCE_PAD;
        if (b2 - a2 >= SILENCE_MIN_MARK) out.push({ a: a2, b: b2, k: '無音', done: false });
      }
      st = -1;
    }
  }
  return out;
}

/** 素材の [a, b) から、削除にした（done の）不要部分を除いた区間 */
export function keepSegments(marks: Mark[] | undefined, a: number, b: number): [number, number][] {
  const cuts = (marks || [])
    .filter((k) => k.done)
    .map((k): [number, number] => [Math.max(a, k.a), Math.min(b, k.b)])
    .filter((c) => c[1] > c[0])
    .sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let p = a;
  for (const c of cuts) {
    if (c[0] - p >= MIN_KEEP) out.push([p, c[0]]);
    p = Math.max(p, c[1]);
  }
  if (b - p >= MIN_KEEP) out.push([p, b]);
  return out;
}

/** 「-35 dB」「0.5 秒」のような表記から数を取り出す */
export function numberIn(s: unknown): number {
  const m = String(s).match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}
