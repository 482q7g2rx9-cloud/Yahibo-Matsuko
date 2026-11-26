// プロジェクトを作る・前の形式から変える
import type { Clip, Media, Project, Track } from './model';

/** はじめのトラック。見本プロジェクトは高さと名前が少し違う */
export function defTracks(sample: boolean | 0 | 1): Track[] {
  return [
    { id: 'V3', kind: 'v', h: sample ? 24 : 40 },
    { id: 'V2', kind: 'v', h: sample ? 32 : 48, name: sample ? 'テロップ' : '' },
    { id: 'V1', kind: 'v', h: 80, name: '映像' },
    { id: 'A1', kind: 'a', h: 48 },
    { id: 'A2', kind: 'a', h: 40, name: sample ? 'BGM' : '' },
    { id: 'A3', kind: 'a', h: 40, name: sample ? 'NA' : '' },
  ];
}

export function emptyProject(): Project {
  return { v: 2, sample: 0, media: [], tracks: defTracks(0), clips: [] };
}

/** 前の形式（seq / titles / bgm / na）。v2 より前のブラウザ版が保存していた */
interface OldProject {
  sample?: 0 | 1;
  media?: Media[];
  seq?: { id: string; m: string; in: number; out: number }[];
  titles?: { id: string; t: number; d: number; st?: string; sz?: string; label?: string }[];
  adj?: unknown;
  bgm?: { id: string; m?: string; sample?: unknown; start: number; in: number; out: number }[];
  na?: { id: string; start: number; dur: number }[];
  pin?: number | null;
  pout?: number | null;
  clips?: Clip[];
  tracks?: Track[];
}

/** 前の形式で保存したプロジェクトを、新しい形式に変える。新しい形式ならそのまま返す */
export function migrate(o: OldProject | Project): Project {
  if (o.clips && o.tracks) return o as Project;
  const old = o as OldProject;
  const cl: Clip[] = [], med = old.media || [];
  let s = 0;
  for (const c of old.seq || []) {
    const m = med.find((x) => x.id === c.m), L = 'L' + c.id, d = Math.max(0, c.out - c.in);
    cl.push({ id: c.id, tr: 'V1', type: 'media', m: c.m, start: s, in: c.in, out: c.out, link: L });
    if (m && m.k === '映像' && !m.noAudio) cl.push({ id: c.id + 'a', tr: 'A1', type: 'media', m: c.m, start: s, in: c.in, out: c.out, link: L });
    s += d;
  }
  for (const t of old.titles || []) cl.push({ id: t.id, tr: 'V2', type: 'title', start: t.t, in: 0, out: t.d, st: t.st, sz: t.sz, label: t.label });
  if (old.adj && s) cl.push({ id: 'adj', tr: 'V3', type: 'adj', start: 0, in: 0, out: s, label: '調整レイヤー（色補正）' });
  for (const b of old.bgm || []) {
    const m = b.sample ? 'a01' : b.m;
    if (m) cl.push({ id: b.id, tr: 'A2', type: 'media', m, start: b.start, in: b.in, out: b.out });
  }
  for (const n of old.na || []) cl.push({ id: n.id, tr: 'A3', type: 'media', m: 'n02', start: n.start, in: 0, out: Math.min(10, n.dur) });
  return { v: 2, sample: old.sample ?? 0, media: med, tracks: defTracks(old.sample ?? 0), clips: cl, pin: old.pin, pout: old.pout };
}
