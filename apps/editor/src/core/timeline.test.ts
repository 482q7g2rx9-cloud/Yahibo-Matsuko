import { describe, expect, it } from 'vitest';
import type { Clip, Media, Project } from './model';
import { defTracks, emptyProject, migrate } from './project';
import * as K from './timeline';

/** 決まった順に id を作る */
function ids() {
  let n = 0;
  return (p: string) => `${p}${++n}`;
}
const vid: Media = { id: 'v', n: '映像', k: '映像', d: 60, c: 'V-01', r: 'ok', f: 'v.mp4' };
const mute: Media = { ...vid, id: 'mute', noAudio: 1 };
const img: Media = { ...vid, id: 'img', k: '画像', d: 0 };
const bgm: Media = { ...vid, id: 'bgm', k: '音声', d: 120 };
function proj(clips: Clip[] = []): Project {
  return { ...emptyProject(), media: [vid, mute, img, bgm], clips };
}
const clip = (id: string, tr: string, start: number, a: number, b: number, extra: Partial<Clip> = {}): Clip => ({ id, tr, type: 'media', m: 'v', start, in: a, out: b, ...extra });
const ctx = (p: Project) => ({ p, id: ids() });
const span = (p: Project, tr: string) => K.onTrack(p, tr).map((c) => [c.start, K.cEnd(c), c.in]);

describe('調べる', () => {
  it('長さ・終わり・番組の長さ', () => {
    const p = proj([clip('a', 'V1', 0, 2, 7), clip('b', 'A2', 10, 0, 3)]);
    expect(K.cLen(p.clips[0])).toBe(5);
    expect(K.cEnd(p.clips[1])).toBe(13);
    expect(K.duration(p)).toBe(13);
    expect(K.activeAt(p, 4.99).map((c) => c.id)).toEqual(['a']);
    expect(K.activeAt(p, 5).map((c) => c.id)).toEqual([]);
  });
  it('すき間', () => {
    const p = proj([clip('a', 'V1', 0, 0, 5), clip('b', 'V1', 8, 0, 2)]);
    expect(K.gapAt(p, 'V1', 6)).toEqual([5, 8]);
    expect(K.gapAt(p, 'V1', 2)).toBeNull();
    expect(K.gapAt(p, 'V1', 20)).toBeNull();
  });
});

describe('上書き（carve）', () => {
  it('中を削ると2つに分かれ、後ろはリンクを外す', () => {
    const p = proj([clip('a', 'V1', 0, 0, 10, { link: 'L' })]);
    K.carve(ctx(p), 'V1', 3, 5);
    expect(span(p, 'V1')).toEqual([[0, 3, 0], [5, 10, 5]]);
    expect(K.onTrack(p, 'V1')[1].link).toBeNull();
  });
  it('すっぽり入るものは消し、端は縮める', () => {
    const removed: string[] = [];
    const p = proj([clip('a', 'V1', 0, 0, 4), clip('b', 'V1', 4, 0, 2), clip('c', 'V1', 6, 0, 4)]);
    K.carve({ p, id: ids(), removed: (c) => removed.push(c.id) }, 'V1', 3, 7);
    expect(removed).toEqual(['b']);
    expect(span(p, 'V1')).toEqual([[0, 3, 0], [7, 10, 1]]);
  });
  it('skip と、ほかのトラックは触らない', () => {
    const p = proj([clip('a', 'V1', 0, 0, 10), clip('b', 'V2', 0, 0, 10)]);
    K.carve(ctx(p), 'V1', 0, 10, { a: 1 });
    expect(p.clips).toHaveLength(2);
  });
});

describe('分割', () => {
  it('端に近すぎるところでは分けない', () => {
    const p = proj([clip('a', 'V1', 0, 0, 10)]);
    expect(K.splitClip(ctx(p), p.clips[0], 0.03)).toBeNull();
    expect(K.splitClip(ctx(p), p.clips[0], 9.97)).toBeNull();
  });
  it('リンクした組は、分けたあとも組のまま（新しい組）', () => {
    const p = proj([clip('a', 'V1', 0, 0, 10, { link: 'L' }), clip('aa', 'A1', 0, 0, 10, { link: 'L' })]);
    const made = K.splitList(ctx(p), [...p.clips], 4);
    expect(made).toHaveLength(2);
    expect(made[0].link).toBe(made[1].link);
    expect(made[0].link).not.toBe('L');
    expect(span(p, 'V1')).toEqual([[0, 4, 0], [4, 10, 4]]);
  });
  it('ロックしたトラックは分けられない', () => {
    const p = proj([clip('a', 'V1', 0, 0, 10), clip('b', 'V2', 0, 0, 10)]);
    p.tracks.find((t) => t.id === 'V2')!.lock = true;
    expect(K.splittable(p, 5, p.clips).map((c) => c.id)).toEqual(['a']);
  });
});

describe('詰める・空ける・削除', () => {
  it('自分のトラックは詰め、ほかのトラックは空いていれば詰める', () => {
    const p = proj([clip('a', 'V1', 0, 0, 5), clip('b', 'V1', 8, 0, 2), clip('c', 'A1', 8, 0, 2), clip('d', 'A2', 6, 0, 4)]);
    K.closeRange(p, 'V1', 5, 8);
    expect(span(p, 'V1')).toEqual([[0, 5, 0], [5, 7, 0]]);
    expect(span(p, 'A1')).toEqual([[5, 7, 0]]);
    expect(span(p, 'A2')).toEqual([[6, 10, 0]]); // 範囲にクリップがあるので動かさない
  });
  it('空けるときは、またぐクリップを分けて後ろへずらす（ロックは除く）', () => {
    const p = proj([clip('a', 'V1', 0, 0, 10), clip('b', 'V2', 0, 0, 10)]);
    p.tracks.find((t) => t.id === 'V2')!.lock = true;
    K.openRange(ctx(p), 4, 3);
    expect(span(p, 'V1')).toEqual([[0, 4, 0], [7, 13, 4]]);
    expect(span(p, 'V2')).toEqual([[0, 10, 0]]);
  });
  it('端に近すぎて分けられないクリップは、かけらを落として重ならないようにする', () => {
    // 0.02 秒の位置に挿入（頭のかけら）と、9.98 秒の位置に挿入（お尻のかけら）
    const p = proj([clip('a', 'A1', 0, 0, 10, { m: 'bgm' }), clip('b', 'A1', 10, 0, 5, { m: 'bgm' })]);
    K.openRange(ctx(p), 0.02, 3);
    expect(span(p, 'A1').map((r) => r.map((v) => +v.toFixed(3)))).toEqual([[3.02, 13, 0.02], [13, 18, 0]]);
    const q = proj([clip('a', 'A1', 0, 0, 10, { m: 'bgm' }), clip('b', 'A1', 10, 0, 5, { m: 'bgm' })]);
    K.openRange(ctx(q), 9.98, 3);
    expect(span(q, 'A1').map((r) => r.map((v) => +v.toFixed(3)))).toEqual([[0, 9.98, 0], [13, 18, 0]]);
    expect(K.overlaps(q)).toEqual([]);
  });
  it('詰めて削除', () => {
    const p = proj([clip('a', 'V1', 0, 0, 5), clip('b', 'V1', 5, 0, 3), clip('c', 'V1', 8, 0, 2)]);
    K.deleteClips(ctx(p), [p.clips[1]], true);
    expect(span(p, 'V1')).toEqual([[0, 5, 0], [5, 7, 0]]);
  });
});

describe('素材を置く', () => {
  it('映像は音声もリンクして置き、空いている音声トラックを使う', () => {
    const p = proj([clip('x', 'A1', 0, 0, 30)]);
    const r = K.placeMedia(ctx(p), vid, 'V1', 2, 0, 5, false);
    expect(r.error).toBeUndefined();
    expect(r.made.map((c) => c.tr)).toEqual(['V1', 'A2']);
    expect(r.made[0].link).toBe(r.made[1].link);
  });
  it('音声のない映像・画像は映像だけ。音声トラックへは置けない', () => {
    const p = proj();
    expect(K.placeMedia(ctx(p), mute, 'V1', 0, 0, 5, false).made.map((c) => c.tr)).toEqual(['V1']);
    expect(K.placeMedia(ctx(p), img, 'V2', 0, 0, 5, false).made[0].link).toBeNull();
    expect(K.placeMedia(ctx(p), mute, 'A1', 0, 0, 5, false).error).toBe('この素材には音声がありません');
  });
  it('ロックしたトラックには置けない。短すぎるものは置かない', () => {
    const p = proj();
    p.tracks.find((t) => t.id === 'V1')!.lock = true;
    expect(K.placeMedia(ctx(p), vid, 'V1', 0, 0, 5, false).error).toBe('ロックしたトラックには置けません');
    expect(K.placeMedia(ctx(p), bgm, 'A1', 0, 0, 0.01, false).made).toHaveLength(0);
  });
  it('上書きは重なったところを削り、挿入は後ろをずらす', () => {
    const p = proj([clip('a', 'V1', 0, 0, 10)]);
    K.placeMedia(ctx(p), mute, 'V1', 4, 0, 2, false);
    expect(span(p, 'V1')).toEqual([[0, 4, 0], [4, 6, 0], [6, 10, 6]]);
    const q = proj([clip('a', 'V1', 0, 0, 10)]);
    K.insertSegs(ctx(q), mute, [[0, 2], [5, 6]], 4);
    expect(span(q, 'V1')).toEqual([[0, 4, 0], [4, 6, 0], [6, 7, 5], [7, 13, 4]]);
  });
});

describe('並べ替え・トラック・コピー・移動・テロップ', () => {
  it('V1 の並べ替え（リンク先も一緒）', () => {
    const p = proj([clip('a', 'V1', 0, 0, 3, { link: 'L' }), clip('aa', 'A1', 0, 0, 3, { link: 'L' }), clip('b', 'V1', 3, 10, 15)]);
    K.reorderV1(ctx(p), p.clips[0], p.clips[2], true);
    expect(span(p, 'V1')).toEqual([[0, 5, 10], [5, 8, 0]]);
    expect(span(p, 'A1')).toEqual([[5, 8, 0]]);
  });
  it('トラックを足す・消せるか', () => {
    const p = proj([clip('a', 'V1', 0, 0, 3)]);
    expect(K.addTrack(p, 'v').id).toBe('V4');
    expect(p.tracks[0].id).toBe('V4');
    expect(K.addTrack(p, 'a').id).toBe('A4');
    expect(K.cannotDeleteTrack(p, p.tracks.find((t) => t.id === 'V1')!)).toMatch('クリップが残っている');
    const one: Project = { ...emptyProject(), tracks: defTracks(0).filter((t) => t.id !== 'A2' && t.id !== 'A3') };
    expect(K.cannotDeleteTrack(one, one.tracks.find((t) => t.id === 'A1')!)).toBe('最後の音声トラックは削除できません');
  });
  it('貼り付けは位置を保ち、リンクを新しくする', () => {
    const p = proj([clip('a', 'V1', 2, 0, 3, { link: 'L' }), clip('aa', 'A1', 2, 0, 3, { link: 'L' })]);
    const made = K.pasteClips(ctx(p), 10, K.copyClips(p.clips));
    expect(made.map((c) => [c.tr, c.start])).toEqual([['V1', 10], ['A1', 10]]);
    expect(made[0].link).toBe(made[1].link);
    expect(made[0].link).not.toBe('L');
  });
  it('動かすと重なったところを上書きし、0 より前には動かさない', () => {
    const p = proj([clip('a', 'V1', 0, 0, 4), clip('b', 'V1', 5, 0, 4)]);
    expect(K.nudge(ctx(p), [p.clips[0]], -1)).toBe(false);
    expect(K.nudge(ctx(p), [p.clips[1]], -3)).toBe(true);
    expect(span(p, 'V1')).toEqual([[0, 2, 0], [2, 6, 0]]);
  });
  it('テロップは空いている V1 より上のトラック。なければトラックを足す', () => {
    const p = proj([clip('x', 'V2', 0, 0, 10), clip('y', 'V3', 0, 0, 10)]);
    const t1 = K.addTitle(ctx(p), 'q', 2);
    expect(t1.tr).toBe('V4');
    expect(t1.label).toBe('質問を入力');
    const t2 = K.addTitle(ctx(p), 'credit', 20, 'V2');
    expect([t2.tr, K.cLen(t2)]).toEqual(['V2', 8]);
  });
});

describe('前の形式からの変換', () => {
  it('seq・titles・bgm を v2 のクリップにする', () => {
    const p = migrate({
      media: [vid, mute],
      seq: [{ id: 's1', m: 'v', in: 2, out: 6 }, { id: 's2', m: 'mute', in: 0, out: 3 }],
      titles: [{ id: 't', t: 1, d: 2, st: 'name', label: 'A' }],
      bgm: [{ id: 'b', m: 'bgm', start: 0, in: 0, out: 7 }],
      adj: 1,
    });
    expect(p.clips.map((c) => [c.id, c.tr, c.start])).toEqual([['s1', 'V1', 0], ['s1a', 'A1', 0], ['s2', 'V1', 4], ['t', 'V2', 1], ['adj', 'V3', 0], ['b', 'A2', 0]]);
    expect(K.overlaps(p)).toEqual([]);
    const v2 = proj();
    expect(migrate(v2)).toBe(v2);
  });
});

describe('いろいろな操作を続けても重ならない', () => {
  it.each([7, 11, 2026, 99, 12345])('ランダムな 500 回の操作（種 %i）', (s0) => {
    let seed = s0;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const p = proj();
    const x = ctx(p);
    const tracks = ['V1', 'V2', 'A1', 'A2'];
    for (let i = 0; i < 500; i++) {
      const r = rnd(), t = Math.round(rnd() * 600) / 10, tr = tracks[Math.floor(rnd() * tracks.length)];
      const pick = () => p.clips[Math.floor(rnd() * p.clips.length)];
      if (r < 0.3) K.placeMedia(x, rnd() < 0.5 ? vid : bgm, tr, t, 0, 1 + rnd() * 8, rnd() < 0.5);
      else if (r < 0.45 && p.clips.length) K.splitList(x, K.splittable(p, t, K.activeAt(p, t)), t);
      else if (r < 0.6 && p.clips.length) K.deleteClips(x, [pick()], rnd() < 0.5);
      else if (r < 0.75 && p.clips.length) K.nudge(x, [pick()], rnd() * 6 - 3);
      else if (r < 0.85 && p.clips.length) K.pasteClips(x, t, K.copyClips([pick()]));
      else if (r < 0.92) K.addTitle(x, 'sub', t);
      else {
        // 詰めるのは、すき間（クリップのない範囲）だけ
        const g = K.gapAt(p, tr, t);
        if (g) K.closeRange(p, tr, g[0], g[1]);
      }
      const bad = K.overlaps(p);
      if (bad.length) throw new Error(`${i} 回目で重なりました：${JSON.stringify(bad[0])}`);
      for (const c of p.clips) expect(K.cLen(c)).toBeGreaterThan(0);
    }
    expect(p.clips.length).toBeGreaterThan(10);
  });
});
