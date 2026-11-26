import { describe, expect, it } from 'vitest';
import { detectSilence, keepSegments, numberIn } from './silence';

/** 1秒に10個のピーク。loud の区間（秒）だけ音がある */
function peaks(seconds: number, loud: [number, number][]): number[] {
  return Array.from({ length: seconds * 10 }, (_, i) => (loud.some(([a, b]) => i / 10 >= a && i / 10 < b) ? 1 : 0.001));
}
const o = { thresholdDb: 35, minLength: 0.5 };
const round = (L: { a: number; b: number }[]) => L.map((k) => [+k.a.toFixed(2), +k.b.toFixed(2)]);

describe('無音の検出', () => {
  it('話と話の間の無音を、両端を少し残して見つける', () => {
    const L = detectSilence(peaks(10, [[0, 2], [5, 10]]), 10, o);
    expect(round(L)).toEqual([[2.1, 4.9]]);
    expect(L[0]).toMatchObject({ k: '無音', done: false });
  });
  it('素材の最初と最後に接する無音は端まで', () => {
    expect(round(detectSilence(peaks(10, [[3, 7]]), 10, o))).toEqual([[0, 2.9], [7.1, 10]]);
  });
  it('最短の長さより短い無音は数えない', () => {
    expect(detectSilence(peaks(10, [[0, 4], [4.4, 10]]), 10, o)).toEqual([]);
  });
  it('しきい値（-35 dB ≒ 0.0178）より大きい音は無音にしない', () => {
    const pk = peaks(10, [[0, 2], [5, 10]]).map((v) => (v < 1 ? 0.02 : v));
    expect(detectSilence(pk, 10, o)).toEqual([]);
    expect(detectSilence(pk, 10, { ...o, thresholdDb: 30 })).toHaveLength(1);
  });
});

describe('無音を除いた区間', () => {
  const marks = [{ a: 2, b: 3, k: '無音', done: true }, { a: 5, b: 6, k: '無音', done: false }, { a: 7, b: 7.05, k: '無音', done: true }];
  it('削除にしたものだけを除く', () => {
    expect(keepSegments(marks, 0, 10)).toEqual([[0, 2], [3, 7], [7.05, 10]]);
  });
  it('イン〜アウトの外は関係しない。短すぎる区間は残さない', () => {
    expect(keepSegments(marks, 2.95, 4)).toEqual([[3, 4]]);
    expect(keepSegments(marks, 2.5, 3.05)).toEqual([]);
    expect(keepSegments(undefined, 1, 2)).toEqual([[1, 2]]);
  });
  it('表記から数を取り出す', () => {
    expect(numberIn('-35 dB')).toBe(35);
    expect(numberIn('0.5 秒')).toBe(0.5);
    expect(numberIn('なし')).toBe(0);
  });
});
