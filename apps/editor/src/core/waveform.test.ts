import { describe, expect, it } from 'vitest';
import { WaveformBuilder, dq8, q8, waveColumns, waveRate } from './waveform';

function sine(sec: number, sr: number, amp: number, hz = 220): Float32Array {
  const a = new Float32Array(Math.round(sec * sr));
  for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
  return a;
}

describe('waveform', () => {
  it('バケット数は短い素材で 100/秒、長い素材は全体で 15 万個まで', () => {
    expect(waveRate(60)).toBe(100);
    expect(waveRate(3600)).toBe(41);
    expect(waveRate(10 * 3600)).toBe(10);
  });

  it('1 バイトにしても値がほぼ戻る', () => {
    for (const v of [-1, -0.5, 0, 0.25, 1]) expect(Math.abs(dq8(q8(v)) - v)).toBeLessThan(0.01);
  });

  it('左右のチャンネルを別々に持ち、上・下・実効値が合う', () => {
    const sr = 8000, L = sine(2, sr, 0.5), R = new Float32Array(L.length);
    const b = new WaveformBuilder(2, sr, 2);
    // 少しずつ渡しても同じになる
    for (let i = 0; i < L.length; i += 1000) b.push([L.subarray(i, i + 1000), R.subarray(i, i + 1000)]);
    const w = b.finish();
    expect(w.ch).toBe(2);
    expect(w.n).toBe(200);
    const c = waveColumns(w, 0, 2, 10);
    for (let x = 0; x < 10; x++) {
      expect(c.max[x * 2]).toBeCloseTo(0.5, 1);
      expect(c.min[x * 2]).toBeCloseTo(-0.5, 1);
      expect(c.rms[x * 2]).toBeCloseTo(0.5 / Math.SQRT2, 1);
      expect(c.max[x * 2 + 1]).toBe(0);
      expect(c.rms[x * 2 + 1]).toBe(0);
    }
  });

  it('クリップの音量（倍率）を掛け、範囲の一部だけを取り出せる', () => {
    const sr = 8000, a = sine(1, sr, 0.2), s = new Float32Array(sr * 2);
    s.set(a, sr); // 後半の 1 秒だけ音がある
    const b = new WaveformBuilder(2, sr, 1);
    b.push([s]);
    const w = b.finish();
    expect(waveColumns(w, 0, 0.9, 4).max.every((v) => v === 0)).toBe(true);
    const c = waveColumns(w, 1.1, 1.9, 4, 2);
    expect(c.max[0]).toBeCloseTo(0.4, 1);
    expect(c.ch).toBe(1);
  });
});
