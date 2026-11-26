import { describe, expect, it } from 'vitest';
import type { Clip, Media, Project } from './model';
import { emptyProject } from './project';
import { dueForSnapshot, formatTime, restoreFrom, sameContent, slimForSnapshot, summarize, toPrune } from './history';

const m = (id: string, extra: Partial<Media> = {}): Media => ({ id, n: id, k: '映像', d: 60, c: 'V', r: 'wn', f: id + '.mp4', ...extra });
const c = (id: string, mid: string, start: number, len: number): Clip => ({ id, tr: 'V1', type: 'media', m: mid, start, in: 0, out: len });
const proj = (media: Media[], clips: Clip[]): Project => ({ ...emptyProject(), media, clips });

describe('写しの中身', () => {
  it('素材は軽い情報だけを残す（URL・波形・サムネイルは残さない）', () => {
    const s = slimForSnapshot(proj([m('a', { url: 'blob:x', loading: 1, thumb: 'data:', peaks: [1], inP: 2, marks: [] })], [c('1', 'a', 0, 5)]));
    expect(s.media[0]).toEqual({ id: 'a', n: 'a', k: '映像', d: 60, c: 'V', r: 'wn', f: 'a.mp4', inP: 2, marks: [] });
    expect(s.clips).toHaveLength(1);
  });
  it('要約は、クリップの数・長さ・素材の数（見本は数えない）', () => {
    expect(summarize(proj([m('a'), m('b', { sample: 1 })], [c('1', 'a', 0, 30), c('2', 'a', 30, 95)]))).toBe('クリップ 2・長さ 2:05・素材 1');
  });
  it('中身が同じかを比べる（サムネイルなどの違いは数えない）', () => {
    const a = proj([m('a')], [c('1', 'a', 0, 5)]);
    expect(sameContent(a, { ...a, media: [m('a', { thumb: 'x' })] })).toBe(true);
    expect(sameContent(a, proj([m('a')], [c('1', 'a', 1, 5)]))).toBe(false);
    expect(sameContent(a, proj([m('a', { r: 'ok' })], [c('1', 'a', 0, 5)]))).toBe(false);
    expect(sameContent(null, a)).toBe(false);
  });
});

describe('残す時と、消すもの', () => {
  it('前の写しから 2 分たったら残す', () => {
    expect(dueForSnapshot(null, 0)).toBe(true);
    expect(dueForSnapshot(1000, 1000 + 119_000)).toBe(false);
    expect(dueForSnapshot(1000, 1000 + 120_000)).toBe(true);
  });
  it('多すぎるときは古いものから消す', () => {
    const list = [5, 1, 4, 2, 3].map((n) => ({ id: n, at: n * 10, kind: 'auto' as const, summary: '' }));
    expect(toPrune(list, 3).sort()).toEqual([1, 2]);
    expect(toPrune(list, 10)).toEqual([]);
  });
});

describe('写しから戻す', () => {
  it('タイムラインと素材のイン点・権利・不要部分を戻し、ファイルや URL はいまのものを使う', () => {
    const snap = proj([m('a', { inP: 1, outP: 9, r: 'ok', marks: [{ a: 1, b: 2, k: '無音', done: true }] })], [c('1', 'a', 0, 5), c('2', 'a', 5, 5)]);
    snap.pin = 2;
    const cur = proj([m('a', { url: 'blob:now', thumb: 't' }), m('b')], [c('9', 'b', 0, 3)]);
    const r = restoreFrom(cur, snap);
    expect(r.dropped).toBe(0);
    expect(r.project.clips.map((x) => x.id)).toEqual(['1', '2']);
    expect(r.project.media.map((x) => x.id)).toEqual(['a', 'b']);
    expect(r.project.media[0]).toMatchObject({ url: 'blob:now', thumb: 't', inP: 1, outP: 9, r: 'ok' });
    expect(r.project.pin).toBe(2);
    // 戻した後に写しを書き換えても、戻したプロジェクトは変わらない
    snap.clips[0].start = 99;
    expect(r.project.clips[0].start).toBe(0);
  });
  it('いまはない素材のクリップは戻さない。テロップは戻す', () => {
    const snap = proj([m('a'), m('gone')], [c('1', 'a', 0, 5), c('2', 'gone', 5, 5), { id: 't', tr: 'V2', type: 'title', start: 0, in: 0, out: 4, label: 'x' }]);
    const r = restoreFrom(proj([m('a')], []), snap);
    expect(r.dropped).toBe(1);
    expect(r.project.clips.map((x) => x.id)).toEqual(['1', 't']);
  });
});

describe('時刻の表示', () => {
  it('今日なら「今日」、それ以外は月/日', () => {
    const today = new Date(2026, 10, 26, 18, 0).getTime();
    expect(formatTime(new Date(2026, 10, 26, 9, 5).getTime(), today)).toBe('今日 09:05');
    expect(formatTime(new Date(2026, 10, 3, 14, 30).getTime(), today)).toBe('11/3 14:30');
  });
});
