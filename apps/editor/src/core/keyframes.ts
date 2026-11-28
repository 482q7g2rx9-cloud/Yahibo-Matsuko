// キーフレーム（エフェクトページ）。モーション（位置 X・Y、拡大率、回転、不透明度）を、時間に沿って変える。
// Rust 側の crates/matsuko-core/src/keyframes.rs と同じ計算（書き出しでも同じ動きになる）。
//
// キーフレームの時刻 t は「素材の中の秒」（クリップの in と同じ基準）。クリップを分割したり、頭を詰めたりしても、
// 素材のその場面に付いたまま動かない。タイムラインの時刻 T のときの素材の秒は、c.in + (T - c.start)。
// e は、そのキーフレームから次のキーフレームまでの変わり方。

export const KF_PROPS = ['x', 'y', 'scale', 'rot', 'op'] as const;
export type KfProp = (typeof KF_PROPS)[number];
/** 変わり方：linear 一定、ease 始めと終わりをゆっくり（ベジェ）、in だんだん速く、out だんだん遅く、hold 次まで止める */
export type Ease = 'linear' | 'ease' | 'in' | 'out' | 'hold';

export interface Kf {
  t: number;
  v: number;
  e?: Ease;
}
export type KfMap = Partial<Record<KfProp, Kf[]>>;

/** キーフレームを持てるクリップ（core/model.ts の Clip のうち、使うところ） */
export interface KfClip {
  start: number;
  in: number;
  out: number;
  x?: number;
  y?: number;
  scale?: number;
  rot?: number;
  op?: number;
  kf?: KfMap | null;
}

/** 値がないときの値 */
export const KF_DEF: Record<KfProp, number> = { x: 0, y: 0, scale: 100, rot: 0, op: 100 };

/** 同じキーフレームとみなす時刻の差（秒）：1 フレームの半分より小さい */
export const KF_EPS = 0.004;

/** 変わり方の曲線（0〜1 → 0〜1） */
export function ease(e: Ease | undefined, u: number): number {
  switch (e) {
    case 'hold':
      return 0;
    case 'ease':
      return u * u * (3 - 2 * u);
    case 'in':
      return u * u;
    case 'out':
      return 1 - (1 - u) * (1 - u);
    default:
      return u;
  }
}

/** キーフレームの列から、素材の秒 s のときの値 */
export function interp(list: Kf[], s: number): number {
  if (s <= list[0].t) return list[0].v;
  const last = list[list.length - 1];
  if (s >= last.t) return last.v;
  let i = 0;
  while (i < list.length - 2 && s >= list[i + 1].t) i++;
  const a = list[i],
    b = list[i + 1],
    span = b.t - a.t;
  const u = span > 0 ? (s - a.t) / span : 1;
  return a.v + (b.v - a.v) * ease(a.e, u);
}

export function kfList(c: KfClip, p: KfProp): Kf[] | null {
  const l = c.kf && c.kf[p];
  return l && l.length ? l : null;
}
/** キーフレームを持っているか */
export function hasKf(c: KfClip, p?: KfProp): boolean {
  return p ? !!kfList(c, p) : KF_PROPS.some((q) => !!kfList(c, q));
}
/** 素材の秒（タイムラインの時刻 T のとき） */
export function srcTime(c: KfClip, T: number): number {
  return c.in + (T - c.start);
}
/** タイムラインの時刻 T のときの値（キーフレームがなければ、クリップの値） */
export function valueAt(c: KfClip, p: KfProp, T: number): number {
  const l = kfList(c, p);
  if (l) return interp(l, srcTime(c, T));
  const v = c[p];
  return v == null ? KF_DEF[p] : v;
}
/** 素材の秒 s にあるキーフレームの番号（なければ -1） */
export function kfIndex(c: KfClip, p: KfProp, s: number): number {
  const l = kfList(c, p);
  return l ? l.findIndex((k) => Math.abs(k.t - s) < KF_EPS) : -1;
}

function put(c: KfClip, p: KfProp, list: Kf[]) {
  if (!c.kf) c.kf = {};
  list.sort((a, b) => a.t - b.t);
  c.kf[p] = list;
}
/** キーフレームを置く（同じ時刻にあれば値を変える）。e を渡さなければ、前の変わり方を引き継ぐ */
export function setKf(c: KfClip, p: KfProp, T: number, v: number, e?: Ease): void {
  const s = +srcTime(c, T).toFixed(4),
    l = (kfList(c, p) || []).slice(),
    i = l.findIndex((k) => Math.abs(k.t - s) < KF_EPS);
  if (i >= 0) l[i] = { ...l[i], v, ...(e ? { e } : {}) };
  else {
    const prev = l.filter((k) => k.t < s).pop();
    const k: Kf = { t: s, v };
    const ee = e || prev?.e;
    if (ee && ee !== 'linear') k.e = ee;
    l.push(k);
  }
  put(c, p, l);
}
/** キーフレームを消す。最後の 1 つを消したら、その値をクリップの値にする */
export function delKf(c: KfClip, p: KfProp, T: number): void {
  const s = srcTime(c, T),
    l = kfList(c, p);
  if (!l) return;
  const keep = l.filter((k) => Math.abs(k.t - s) >= KF_EPS);
  if (keep.length === l.length) return;
  if (!keep.length) {
    c[p] = l[0].v;
    clearKf(c, p);
  } else put(c, p, keep);
}
/** キーフレームを置く・消す（◇のボタン） */
export function toggleKf(c: KfClip, p: KfProp, T: number): 'added' | 'removed' {
  if (kfIndex(c, p, srcTime(c, T)) >= 0) {
    delKf(c, p, T);
    return 'removed';
  }
  setKf(c, p, T, valueAt(c, p, T));
  return 'added';
}
/** 値を変える：キーフレームがあれば、その時刻にキーフレームを置く（なければ作る）。なければクリップの値 */
export function setValue(c: KfClip, p: KfProp, T: number, v: number): void {
  if (kfList(c, p)) setKf(c, p, T, v);
  else c[p] = v;
}
/** キーフレームをすべて外す（値はその時刻の値にする） */
export function clearKf(c: KfClip, p: KfProp, T?: number): void {
  if (T != null && kfList(c, p)) c[p] = valueAt(c, p, T);
  if (c.kf) {
    delete c.kf[p];
    if (!Object.keys(c.kf).length) delete c.kf;
  }
}
/** そのキーフレームの変わり方を変える */
export function setEase(c: KfClip, p: KfProp, T: number, e: Ease): boolean {
  const l = kfList(c, p),
    i = l ? kfIndex(c, p, srcTime(c, T)) : -1;
  if (!l || i < 0) return false;
  const n = l.slice();
  n[i] = { ...n[i], e };
  if (e === 'linear') delete n[i].e;
  put(c, p, n);
  return true;
}
/** キーフレームの時刻（タイムラインの秒）の一覧。p がなければ全部（重なりは 1 つ） */
export function kfTimes(c: KfClip, p?: KfProp): number[] {
  const out: number[] = [];
  for (const q of p ? [p] : KF_PROPS)
    for (const k of kfList(c, q) || []) {
      const T = c.start + (k.t - c.in);
      if (!out.some((x) => Math.abs(x - T) < KF_EPS)) out.push(T);
    }
  return out.sort((a, b) => a - b);
}

/** 動きのプリセット（エフェクトページの「動き」）。クリップの長さに合わせてキーフレームを作る */
export const MOTION_PRESETS: { id: string; name: string }[] = [
  { id: 'zoomIn', name: 'ズームイン' },
  { id: 'zoomOut', name: 'ズームアウト' },
  { id: 'slideL', name: '左から入る' },
  { id: 'slideR', name: '右から入る' },
  { id: 'slideUp', name: '下から入る' },
  { id: 'fadeIn', name: 'フェードイン' },
  { id: 'fadeOut', name: 'フェードアウト' },
  { id: 'spin', name: '回転して入る' },
];
export function applyMotionPreset(c: KfClip, id: string): boolean {
  const a = c.in,
    b = c.out,
    len = Math.max(0.1, b - a),
    d = Math.min(0.6, len / 2);
  const base = (p: KfProp) => (c[p] == null ? KF_DEF[p] : (c[p] as number));
  const set = (p: KfProp, l: Kf[]) => put(c, p, l);
  const sc = base('scale');
  switch (id) {
    case 'zoomIn':
      set('scale', [{ t: a, v: sc }, { t: b, v: sc * 1.2 }]);
      break;
    case 'zoomOut':
      set('scale', [{ t: a, v: sc * 1.2 }, { t: b, v: sc }]);
      break;
    case 'slideL':
    case 'slideR':
      set('x', [{ t: a, v: id === 'slideL' ? -100 : 100, e: 'out' }, { t: a + d, v: base('x') }]);
      break;
    case 'slideUp':
      set('y', [{ t: a, v: 100, e: 'out' }, { t: a + d, v: base('y') }]);
      break;
    case 'fadeIn':
      set('op', [{ t: a, v: 0 }, { t: a + Math.min(0.5, len / 2), v: base('op') }]);
      break;
    case 'fadeOut':
      set('op', [{ t: b - Math.min(0.5, len / 2), v: base('op') }, { t: b, v: 0 }]);
      break;
    case 'spin':
      set('rot', [{ t: a, v: base('rot') - 180, e: 'out' }, { t: a + d, v: base('rot') }]);
      set('scale', [{ t: a, v: 0, e: 'out' }, { t: a + d, v: sc }]);
      break;
    default:
      return false;
  }
  return true;
}
