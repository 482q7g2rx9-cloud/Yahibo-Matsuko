import { describe, expect, it } from 'vitest';
import { applyMotionPreset, clearKf, ease, interp, kfTimes, setEase, setKf, setValue, toggleKf, valueAt, type KfClip } from './keyframes';

const clip = (o: Partial<KfClip> = {}): KfClip => ({ start: 10, in: 2, out: 6, ...o });

/** Rust 側（keyframes.rs）のテストと同じ値。どちらかを変えたら両方を変える */
export const VECTORS: [Parameters<typeof interp>[0], number, number][] = [
  [[{ t: 0, v: 0 }, { t: 1, v: 100 }], 0.5, 50],
  [[{ t: 0, v: 0, e: 'ease' }, { t: 1, v: 100 }], 0.25, 15.625],
  [[{ t: 0, v: 0, e: 'in' }, { t: 1, v: 100 }], 0.5, 25],
  [[{ t: 0, v: 0, e: 'out' }, { t: 1, v: 100 }], 0.5, 75],
  [[{ t: 0, v: 0, e: 'hold' }, { t: 1, v: 100 }], 0.99, 0],
  [[{ t: 0, v: 10 }, { t: 1, v: 20 }, { t: 3, v: -20 }], 2, 0],
  [[{ t: 1, v: 5 }, { t: 2, v: 9 }], 0, 5],
  [[{ t: 1, v: 5 }, { t: 2, v: 9 }], 3, 9],
];

describe('キーフレーム', () => {
  it('補間（Rust と同じ値）', () => {
    for (const [l, s, v] of VECTORS) expect(interp(l, s)).toBeCloseTo(v, 6);
    expect(ease('ease', 0.5)).toBeCloseTo(0.5);
  });
  it('キーフレームがなければクリップの値', () => {
    expect(valueAt(clip({ scale: 80 }), 'scale', 11)).toBe(80);
    expect(valueAt(clip(), 'op', 11)).toBe(100);
  });
  it('時刻は素材の秒で持つ（分割・頭の詰めで動かない）', () => {
    const c = clip();
    setKf(c, 'x', 10, 0);
    setKf(c, 'x', 12, 50);
    expect(c.kf!.x!.map((k) => k.t)).toEqual([2, 4]);
    expect(valueAt(c, 'x', 11)).toBe(25);
    // 頭を 1 秒詰めた（start も in も 1 秒進む）
    const d = { ...c, start: 11, in: 3 };
    expect(valueAt(d, 'x', 11)).toBe(25);
    expect(kfTimes(c)).toEqual([10, 12]);
  });
  it('◇で置く・消す。最後の 1 つを消すと、その値がクリップの値になる', () => {
    const c = clip({ rot: 30 });
    expect(toggleKf(c, 'rot', 11)).toBe('added');
    setValue(c, 'rot', 13, 90);
    expect(valueAt(c, 'rot', 12)).toBe(60);
    expect(toggleKf(c, 'rot', 13)).toBe('removed');
    expect(toggleKf(c, 'rot', 11)).toBe('removed');
    expect(c.kf).toBeUndefined();
    expect(c.rot).toBe(30);
  });
  it('キーフレームがないときの値の変更はクリップの値。すべて外すと、その時刻の値になる', () => {
    const c = clip();
    setValue(c, 'scale', 11, 50);
    expect(c.scale).toBe(50);
    expect(c.kf).toBeUndefined();
    setKf(c, 'scale', 10, 50);
    setKf(c, 'scale', 12, 150);
    clearKf(c, 'scale', 11);
    expect(c.scale).toBe(100);
    expect(c.kf).toBeUndefined();
  });
  it('変わり方を変える・引き継ぐ', () => {
    const c = clip();
    setKf(c, 'y', 10, 0);
    expect(setEase(c, 'y', 10, 'ease')).toBe(true);
    setKf(c, 'y', 12, 10);
    expect(c.kf!.y![1].e).toBe('ease');
    expect(setEase(c, 'y', 11, 'hold')).toBe(false);
  });
  it('動きのプリセット', () => {
    const c = clip({ scale: 50 });
    applyMotionPreset(c, 'zoomIn');
    expect(valueAt(c, 'scale', 10)).toBe(50);
    expect(valueAt(c, 'scale', 14)).toBeCloseTo(60);
    applyMotionPreset(c, 'fadeOut');
    expect(valueAt(c, 'op', 14)).toBe(0);
    expect(valueAt(c, 'op', 13)).toBe(100);
    applyMotionPreset(c, 'slideL');
    expect(valueAt(c, 'x', 10)).toBe(-100);
    expect(valueAt(c, 'x', 10.6)).toBe(0);
  });
});
