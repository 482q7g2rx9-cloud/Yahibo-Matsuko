// タイムラインの計算と編集（画面に依存しない）。仕様は docs/timeline-spec.md。
// どの関数も、渡されたプロジェクト p をその場で書き換える。画面の更新・元に戻す・通知は呼ぶ側（src/ui/editOps.ts）が行う。
import type { Clip, IdMaker, Media, Project, Track, TrackKind } from './model';
import { hasColor, type ColorParams } from './color';

/** 時刻を比べるときの誤差 */
export const EPS = 1e-6;
/** 分割できる最小の長さ（秒）。クリップの端からこれより近い位置では分割しない */
export const MIN_SPLIT = 0.04;

/** 編集のときに使うもの：プロジェクト・id の作り方・クリップを消したときの知らせ */
export interface Ctx {
  p: Project;
  id: IdMaker;
  /** クリップを取り除いたとき（画面は再生用の要素を片付ける） */
  removed?: (c: Clip) => void;
}

// ---------- 調べる ----------
export const cLen = (c: Clip): number => Math.max(0, c.out - c.in);
export const cEnd = (c: Clip): number => c.start + cLen(c);
export const mediaOf = (p: Project, id: string | undefined): Media | null => p.media.find((m) => m.id === id) ?? null;
export const trackOf = (p: Project, id: string): Track | null => p.tracks.find((t) => t.id === id) ?? null;
export const clipOf = (p: Project, id: string): Clip | null => p.clips.find((c) => c.id === id) ?? null;
/** 番組の長さ（いちばん最後に終わるクリップの終わり） */
export const duration = (p: Project): number => p.clips.reduce((a, c) => Math.max(a, cEnd(c)), 0);
/** トラックのクリップ（開始の早い順） */
export const onTrack = (p: Project, tid: string): Clip[] => p.clips.filter((c) => c.tr === tid).sort((a, b) => a.start - b.start);
/** 時刻 t に映る・鳴るクリップ */
export const activeAt = (p: Project, t: number): Clip[] => p.clips.filter((c) => c.start <= t + 1e-9 && t < cEnd(c) - 1e-9);
export const tracksOf = (p: Project, kind: TrackKind): Track[] => p.tracks.filter((t) => t.kind === kind);
export const hasAudio = (m: Media | null | undefined): boolean => !!m && m.k === '映像' && !m.noAudio;
export const isUsed = (p: Project, m: Media): boolean => p.clips.some((c) => c.m === m.id);
/** 素材の中で使える範囲（テロップなどは制限なし） */
export const srcMin = (c: Clip): number => (c.type === 'media' ? 0 : -1e9);
export function srcMax(p: Project, c: Clip): number {
  if (c.type !== 'media') return 1e9;
  const m = mediaOf(p, c.m);
  return !m || m.k === '画像' ? 1e9 : m.d || c.out;
}
export const v1End = (p: Project): number => onTrack(p, 'V1').reduce((a, c) => Math.max(a, cEnd(c)), 0);
/** 位置・拡大率などを変えてあるか */
export const hasFx = (c: Clip): boolean =>
  !!(c.x || c.y || c.rot || (c.scale != null && c.scale != 100) || (c.op != null && c.op != 100)) || hasColor(c as ColorParams) || !!(c.kf && Object.keys(c.kf).length) || !!(c.fxBlur || c.fxMosaic || c.fxVig);
/** 同じ組（リンク）のほかのクリップ */
export const linked = (p: Project, c: Clip | null): Clip[] => (c && c.link ? p.clips.filter((x) => x.link === c.link && x !== c) : []);
/** ロックしたトラック（または、ないトラック）のクリップか */
export function locked(p: Project, c: Clip): boolean {
  const t = trackOf(p, c.tr);
  return !t || !!t.lock;
}
/** トラック tid の [a, b) にクリップがあるか */
export const busy = (p: Project, tid: string, a: number, b: number): boolean => p.clips.some((c) => c.tr === tid && c.start < b - EPS && cEnd(c) > a + EPS);

// ---------- 編集 ----------
function clone(c: Clip, o: Partial<Clip>): Clip {
  return { ...(JSON.parse(JSON.stringify(c)) as Clip), ...o };
}
function remove(x: Ctx, c: Clip): void {
  const i = x.p.clips.indexOf(c);
  if (i >= 0) x.p.clips.splice(i, 1);
  x.removed?.(c);
}

/** トラック tid の [a, b) にあるクリップを上書きで削る（skip のクリップは除く） */
export function carve(x: Ctx, tid: string, a: number, b: number, skip?: Record<string, unknown>): void {
  for (const c of x.p.clips.slice()) {
    if (c.tr !== tid || (skip && skip[c.id])) continue;
    const s = c.start, e = cEnd(c);
    if (e <= a + EPS || s >= b - EPS) continue;
    if (s >= a - EPS && e <= b + EPS) remove(x, c);
    else if (s < a && e > b) {
      const c2 = clone(c, { id: x.id('c'), start: b, in: c.in + (b - s), link: null });
      c.out = c.in + (a - s);
      x.p.clips.push(c2);
    } else if (s < a) c.out = c.in + (a - s);
    else {
      c.in += b - s;
      c.start = b;
    }
  }
}

/** クリップ c を時刻 t で2つに分ける。分けられなければ null */
export function splitClip(x: Ctx, c: Clip, t: number): Clip | null {
  if (t <= c.start + MIN_SPLIT || t >= cEnd(c) - MIN_SPLIT) return null;
  const c2 = clone(c, { id: x.id('c'), start: t, in: c.in + (t - c.start) });
  c.out = c.in + (t - c.start);
  x.p.clips.push(c2);
  return c2;
}

/** いくつかのクリップを時刻 t で分ける。リンクした組は、分けたあとも組のまま。後ろ半分を返す */
export function splitList(x: Ctx, list: Clip[], t: number): Clip[] {
  const re: Record<string, string> = {};
  const made: Clip[] = [];
  for (const c of list) {
    const c2 = splitClip(x, c, t);
    if (!c2) continue;
    if (c.link) {
      re[c.link] = re[c.link] || x.id('L');
      c2.link = re[c.link];
    }
    made.push(c2);
  }
  return made;
}

/** 時刻 t で分けられるクリップ（ids を渡せばその中から、なければ t にあるもの） */
export function splittable(p: Project, t: number, list: Clip[]): Clip[] {
  return list.filter((c) => !locked(p, c) && t > c.start + MIN_SPLIT && t < cEnd(c) - MIN_SPLIT);
}

/** [a, b) を詰める。自分のトラックは必ず、ほかのトラックはその範囲が空いていれば詰める。
 *  自分のトラックの [a, b) は空いていること（削除したあと・すき間を詰めるときに使う） */
export function closeRange(p: Project, tid: string, a: number, b: number): void {
  const d = b - a;
  if (d <= EPS) return;
  for (const tr of p.tracks) {
    if (tr.lock) continue;
    if (tr.id !== tid && busy(p, tr.id, a, b)) continue;
    for (const c of p.clips) if (c.tr === tr.id && c.start >= b - EPS) c.start -= d;
  }
}

/** 時刻 t に長さ len の場所を空ける（ロックしていない全トラック。t をまたぐクリップは分割する） */
export function openRange(x: Ctx, t: number, len: number, skip?: Record<string, unknown>): void {
  const p = x.p;
  const spans = p.clips.filter((c) => !(skip && skip[c.id]) && !locked(p, c) && c.start < t - EPS && cEnd(c) > t + EPS);
  // 端に近すぎて分けられないクリップ（分けると MIN_SPLIT より短いかけらが残る）は、そのかけら（1コマほど）を切り落とす。
  // 頭のかけらなら頭を、お尻のかけらならお尻を落とし、空けた場所と重ならないようにする
  for (const c of spans) {
    const head = t - c.start, tail = cEnd(c) - t;
    if (head <= MIN_SPLIT) {
      c.in += head;
      c.start = t;
    } else if (tail <= MIN_SPLIT) c.out -= tail;
  }
  splitList(x, spans.filter((c) => c.start < t - EPS && cEnd(c) > t + EPS), t);
  for (const c of p.clips) {
    if ((skip && skip[c.id]) || locked(p, c)) continue;
    if (c.start >= t - EPS) c.start += len;
  }
}

/** クリップを取り除く（ripple なら、取り除いたあとを詰める）。後ろから順に行う */
export function deleteClips(x: Ctx, list: Clip[], ripple: boolean): void {
  for (const c of list.slice().sort((a, b) => b.start - a.start)) {
    const a = c.start, b = cEnd(c), tid = c.tr;
    remove(x, c);
    if (ripple) closeRange(x.p, tid, a, b);
  }
}

/** トラック tid の時刻 t にあるすき間 [a, b)。すき間でなければ null */
export function gapAt(p: Project, tid: string, t: number): [number, number] | null {
  const L = onTrack(p, tid);
  let a = 0;
  for (const c of L) {
    const s = c.start, e = cEnd(c);
    if (t >= s - EPS && t < e) return null;
    if (e <= t + EPS) a = Math.max(a, e);
    else if (s > t) return s - a > EPS ? [a, s] : null;
  }
  return null;
}

/** [a, b) が空いている音声トラック（なければ最初の音声トラック）。ロックしたトラックは除く */
export function freeAudio(p: Project, a: number, b: number): string | undefined {
  const L = tracksOf(p, 'a').filter((t) => !t.lock);
  return (L.filter((t) => !busy(p, t.id, a, b))[0] || L[0])?.id;
}

const newClip = (x: Ctx, m: Media, tid: string, start: number, a: number, b: number, link: string | null): Clip =>
  ({ id: x.id('c'), tr: tid, type: 'media', m: m.id, start, in: a, out: b, link: link || null });

/** 素材を置いた結果。error があれば置いていない */
export interface Placed {
  made: Clip[];
  error?: string;
}

/** 素材 m の [a, b) を、トラック tid の start に置く（ins なら挿入、そうでなければ上書き）。映像の素材は音声もリンクして置く */
export function placeMedia(x: Ctx, m: Media, tid: string, start: number, a: number, b: number, ins: boolean): Placed {
  const p = x.p, tr = trackOf(p, tid), len = b - a, made: Clip[] = [];
  if (!tr || tr.lock) return { made, error: 'ロックしたトラックには置けません' };
  if (len < 0.05) return { made };
  start = Math.max(0, start);
  const isV = m.k === '映像' || m.k === '画像';
  let vt: string | null = null, at: string | null | undefined = null, L: string | null = null;
  if (!isV) at = tr.kind === 'a' ? tid : freeAudio(p, start, start + len);
  else if (tr.kind === 'a') {
    if (!hasAudio(m)) return { made, error: 'この素材には音声がありません' };
    at = tid;
  } else {
    vt = tid;
    if (hasAudio(m)) {
      at = freeAudio(p, start, start + len);
      L = x.id('L');
    }
  }
  if (ins) openRange(x, start, len);
  else {
    if (vt) carve(x, vt, start, start + len);
    if (at) carve(x, at, start, start + len);
  }
  if (vt) made.push(newClip(x, m, vt, start, a, b, at ? L : null));
  if (at) made.push(newClip(x, m, at, start, a, b, vt ? L : null));
  p.clips.push(...made);
  return { made };
}

/** 素材のいくつかの区間 segs を、V1 の t0 から順に挿入する */
export function insertSegs(x: Ctx, m: Media, segs: [number, number][], t0: number): Clip[] {
  let t = t0, all: Clip[] = [];
  for (const g of segs) {
    all = all.concat(placeMedia(x, m, 'V1', t, g[0], g[1], true).made);
    t += g[1] - g[0];
  }
  return all;
}

/** V1 の並べ替え（カットページの仮編集）：c（とリンク先）を、to の前（after なら後ろ）へ移す */
export function reorderV1(x: Ctx, c: Clip, to: Clip, after: boolean): void {
  const p = x.p, grp = [c, ...linked(p, c)], len = cLen(c), a = c.start;
  for (const g of grp) p.clips.splice(p.clips.indexOf(g), 1);
  closeRange(p, 'V1', a, a + len);
  const t = after ? cEnd(to) : to.start;
  openRange(x, t, len);
  for (const g of grp) {
    g.start = t;
    p.clips.push(g);
  }
}

/** トラックを足す（映像は上に、音声は下に） */
export function addTrack(p: Project, kind: TrackKind): Track {
  const n = p.tracks.filter((t) => t.kind === kind).reduce((a, t) => Math.max(a, +t.id.slice(1) || 0), 0) + 1;
  const t: Track = { id: (kind === 'v' ? 'V' : 'A') + n, kind, h: kind === 'v' ? 48 : 44 };
  if (kind === 'v') p.tracks.unshift(t);
  else p.tracks.push(t);
  return t;
}

/** トラックを消せるか。消せなければ理由を返す */
export function cannotDeleteTrack(p: Project, t: Track): string | null {
  if (p.clips.some((c) => c.tr === t.id)) return 'クリップが残っているトラックは削除できません';
  if (p.tracks.filter((x) => x.kind === t.kind).length <= 1) return '最後の' + (t.kind === 'v' ? '映像' : '音声') + 'トラックは削除できません';
  return null;
}

/** コピーしたもの：一番早いクリップの開始（base）と、クリップの写し */
export interface Clipboard {
  base: number;
  clips: Clip[];
}

export function copyClips(list: Clip[]): Clipboard {
  return { base: Math.min(...list.map((c) => c.start)), clips: JSON.parse(JSON.stringify(list)) as Clip[] };
}

/** 時刻 t に貼り付ける（上書き）。ロックした・ないトラックのものは貼らない */
export function pasteClips(x: Ctx, t: number, src: Clipboard): Clip[] {
  const re: Record<string, string> = {}, made: Clip[] = [];
  for (const o of src.clips) {
    const tr = trackOf(x.p, o.tr);
    if (!tr || tr.lock) continue;
    const c = clone(o, { id: x.id('c'), start: t + (o.start - src.base) });
    if (o.link) {
      re[o.link] = re[o.link] || x.id('L');
      c.link = re[o.link];
    }
    carve(x, c.tr, c.start, cEnd(c));
    x.p.clips.push(c);
    made.push(c);
  }
  return made;
}

/** クリップを dt 秒動かす（上書き）。0 より前に出るなら動かさず false */
export function nudge(x: Ctx, list: Clip[], dt: number): boolean {
  if (list.some((c) => c.start + dt < -EPS)) return false;
  const skip: Record<string, number> = {};
  for (const c of list) {
    skip[c.id] = 1;
    c.start += dt;
  }
  for (const c of list) carve(x, c.tr, c.start, cEnd(c), skip);
  return true;
}

/** テロップの長さ（秒）と、最初に入れておく文字 */
export const TITLE_LEN: Record<string, number> = { name: 4, q: 4, sub: 4, credit: 8 };
export const TITLE_TEXT: Record<string, string> = { center: '', name: '名前・肩書き', q: '質問を入力', sub: '字幕を入力', credit: '出演\n協力\n制作' };

/** テロップを置く。tid のトラックが空いていればそこ、なければ V1 より上の空いている映像トラック、なければトラックを足す */
export function addTitle(x: Ctx, st: string, t: number, tid?: string): Clip {
  const p = x.p;
  t = Math.max(0, t || 0);
  const d = st === 'credit' ? 8 : 4;
  const free = (tr: Track) => !tr.lock && !busy(p, tr.id, t, t + d);
  const want = tid ? trackOf(p, tid) : null;
  let tr = want && want.kind === 'v' && free(want) ? want : tracksOf(p, 'v').filter((v) => v.id !== 'V1').reverse().filter(free)[0];
  if (!tr) tr = addTrack(p, 'v');
  const c: Clip = { id: x.id('t'), tr: tr.id, type: 'title', start: t, in: 0, out: d, st, sz: '中', label: TITLE_TEXT[st] };
  p.clips.push(c);
  return c;
}

/** 同じトラックの中でクリップが重なっていないか（テスト・確認用）。重なっている組を返す */
export function overlaps(p: Project): [Clip, Clip][] {
  const out: [Clip, Clip][] = [];
  for (const tr of p.tracks) {
    const L = onTrack(p, tr.id);
    for (let i = 1; i < L.length; i++) if (cEnd(L[i - 1]) > L[i].start + 1e-4) out.push([L[i - 1], L[i]]);
  }
  return out;
}
