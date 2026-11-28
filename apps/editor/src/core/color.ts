// 色補正（M6）。クリップや調整レイヤーの色を、明るさ・コントラスト・彩度・色温度・色かぶり・ガンマと、
// 読み込んだ LUT（.cube）で変える。
//
// プレビューと書き出しで同じ色にするため、補正はすべて 1 つの 3D LUT（格子 33×33×33）にまとめる。
// - プレビュー：画面（ui/colorGL.ts）が、この LUT を WebGL の 3D テクスチャにして、3 次元の直線補間で引く
// - 書き出し：画面が同じ LUT を .cube にして渡し、FFmpeg の lut3d（interp=trilinear）で引く
//   （FFmpeg の eq は GPL なので、配布する LGPL 版にはない。lut3d は LGPL）

/** 色補正の値（クリップに平らに持つ。どれも -100〜100、0 で変化なし。LUT の適用量だけ 0〜100） */
export interface ColorParams {
  /** 明るさ（±100 で ±1 段：2 倍・半分） */
  ccExp?: number;
  /** コントラスト（中間の灰色を中心に、-100 で平ら、+100 で 2 倍） */
  ccCon?: number;
  /** 彩度（-100 で白黒、+100 で 2 倍） */
  ccSat?: number;
  /** 色温度（+ で暖かい・赤み、- で涼しい・青み） */
  ccTemp?: number;
  /** 色かぶり（+ でマゼンタ、- で緑） */
  ccTint?: number;
  /** ガンマ（+ で中間を明るく、- で暗く） */
  ccGam?: number;
  /** 読み込んだ LUT（.cube）。name は表示名、path はデスクトップ版のファイルの場所 */
  ccLut?: { name: string; path?: string } | null;
  /** LUT の適用量（%） */
  ccLutAmt?: number;
}

export const COLOR_KEYS = ['ccExp', 'ccCon', 'ccSat', 'ccTemp', 'ccTint', 'ccGam'] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

/** 読み込んだ LUT（.cube を読んだもの）。data は R がいちばん速く変わる順の RGB（0〜1） */
export interface Cube {
  size: number;
  data: Float32Array;
  title?: string;
}

/** 書き出し・プレビューで使う LUT の格子の数 */
export const LUT_SIZE = 33;

/** 調整レイヤーに色補正の値がないとき（前の版の調整レイヤー）の値。前と同じ見た目（彩度 1.08・コントラスト 1.04） */
export const ADJ_DEFAULT: ColorParams = { ccSat: 8, ccCon: 4 };

/** 色補正のプリセット（「プリセット」から選ぶ） */
export const COLOR_PRESETS: { id: string; name: string; v: ColorParams }[] = [
  { id: 'warm', name: '暖かく', v: { ccTemp: 35, ccTint: 5 } },
  { id: 'cool', name: '涼しく', v: { ccTemp: -35 } },
  { id: 'vivid', name: '鮮やか', v: { ccSat: 30, ccCon: 12 } },
  { id: 'soft', name: '落ち着いた', v: { ccSat: -25, ccCon: -12, ccGam: 6 } },
  { id: 'bright', name: '明るく', v: { ccExp: 25, ccGam: 10 } },
  { id: 'night', name: '夕方・夜', v: { ccExp: -30, ccTemp: -20, ccSat: -15, ccCon: 10 } },
  { id: 'mono', name: '白黒', v: { ccSat: -100, ccCon: 10 } },
];

/** クリップに色補正があれば true（値が 0 でない、または LUT がある） */
export function hasColor(c: ColorParams | null | undefined): boolean {
  if (!c) return false;
  if (COLOR_KEYS.some((k) => Math.abs(c[k] || 0) > 1e-9)) return true;
  return !!(c.ccLut && (c.ccLutAmt == null || c.ccLutAmt > 0));
}

/** 実際に使う値：調整レイヤーで値が 1 つもなければ ADJ_DEFAULT */
export function colorOf(c: (ColorParams & { type?: string }) | null | undefined): ColorParams | null {
  if (!c) return null;
  const any = COLOR_KEYS.some((k) => c[k] != null) || c.ccLut != null;
  if (c.type === 'adj' && !any) return { ...ADJ_DEFAULT };
  return hasColor(c) ? c : null;
}

/** 色補正の値の組を表す文字列（同じ補正の LUT を使い回すための鍵）。LUT はその名前と場所で区別する */
export function colorKey(c: ColorParams): string {
  const v = COLOR_KEYS.map((k) => +(c[k] || 0).toFixed(3));
  const lut = c.ccLut ? (c.ccLut.path || c.ccLut.name) + '@' + (c.ccLutAmt == null ? 100 : c.ccLutAmt) : '';
  return v.join(',') + '|' + lut;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** LUT を引く（3 次元の直線補間）。rgb は 0〜1 */
export function sampleCube(cube: Cube, r: number, g: number, b: number): [number, number, number] {
  const n = cube.size,
    m = n - 1,
    d = cube.data;
  const fr = clamp01(r) * m,
    fg = clamp01(g) * m,
    fb = clamp01(b) * m;
  const r0 = Math.min(m - 1, Math.floor(fr)),
    g0 = Math.min(m - 1, Math.floor(fg)),
    b0 = Math.min(m - 1, Math.floor(fb));
  const tr = fr - r0,
    tg = fg - g0,
    tb = fb - b0;
  const out: [number, number, number] = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const at = (ri: number, gi: number, bi: number) => d[((bi * n + gi) * n + ri) * 3 + ch];
    const c00 = at(r0, g0, b0) * (1 - tr) + at(r0 + 1, g0, b0) * tr;
    const c10 = at(r0, g0 + 1, b0) * (1 - tr) + at(r0 + 1, g0 + 1, b0) * tr;
    const c01 = at(r0, g0, b0 + 1) * (1 - tr) + at(r0 + 1, g0, b0 + 1) * tr;
    const c11 = at(r0, g0 + 1, b0 + 1) * (1 - tr) + at(r0 + 1, g0 + 1, b0 + 1) * tr;
    const c0 = c00 * (1 - tg) + c10 * tg,
      c1 = c01 * (1 - tg) + c11 * tg;
    out[ch] = c0 * (1 - tb) + c1 * tb;
  }
  return out;
}

/** 1 つの色に補正をかける（rgb は 0〜1）。順番：LUT → 色温度・色かぶり → 明るさ → コントラスト → ガンマ → 彩度 */
export function applyColor(c: ColorParams, rgb: [number, number, number], cube?: Cube | null): [number, number, number] {
  let [r, g, b] = rgb;
  if (cube && c.ccLut) {
    const a = c.ccLutAmt == null ? 1 : clamp01(c.ccLutAmt / 100);
    const [lr, lg, lb] = sampleCube(cube, r, g, b);
    r += (lr - r) * a;
    g += (lg - g) * a;
    b += (lb - b) * a;
  }
  const t = (c.ccTemp || 0) / 100,
    ti = (c.ccTint || 0) / 100;
  r *= 1 + 0.2 * t + 0.05 * ti;
  g *= 1 - 0.15 * ti;
  b *= 1 - 0.2 * t + 0.05 * ti;
  const k = Math.pow(2, (c.ccExp || 0) / 100);
  r *= k;
  g *= k;
  b *= k;
  const con = 1 + (c.ccCon || 0) / 100;
  r = (r - 0.5) * con + 0.5;
  g = (g - 0.5) * con + 0.5;
  b = (b - 0.5) * con + 0.5;
  const ga = Math.pow(2, -(c.ccGam || 0) / 100);
  if (ga !== 1) {
    r = Math.pow(clamp01(r), ga);
    g = Math.pow(clamp01(g), ga);
    b = Math.pow(clamp01(b), ga);
  }
  const s = 1 + (c.ccSat || 0) / 100;
  if (s !== 1) {
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = y + (r - y) * s;
    g = y + (g - y) * s;
    b = y + (b - y) * s;
  }
  return [clamp01(r), clamp01(g), clamp01(b)];
}

/** 補正を 3D LUT にする（R がいちばん速く変わる順の RGB。.cube と同じ順） */
export function buildLut(c: ColorParams, cube?: Cube | null, size = LUT_SIZE): Float32Array {
  const out = new Float32Array(size * size * size * 3),
    m = size - 1;
  let i = 0;
  for (let bi = 0; bi < size; bi++)
    for (let gi = 0; gi < size; gi++)
      for (let ri = 0; ri < size; ri++) {
        const v = applyColor(c, [ri / m, gi / m, bi / m], cube);
        out[i++] = v[0];
        out[i++] = v[1];
        out[i++] = v[2];
      }
  return out;
}

/** LUT を .cube の文字にする（FFmpeg の lut3d が読む） */
export function toCube(lut: Float32Array, size = LUT_SIZE, title = 'Matsuko Editor'): string {
  const lines = ['TITLE "' + title.replace(/"/g, '') + '"', 'LUT_3D_SIZE ' + size, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let i = 0; i < lut.length; i += 3) lines.push(lut[i].toFixed(6) + ' ' + lut[i + 1].toFixed(6) + ' ' + lut[i + 2].toFixed(6));
  return lines.join('\n') + '\n';
}

/** .cube を読む（3D の LUT だけ。DOMAIN_MIN / MAX に対応）。読めなければ理由を投げる */
export function parseCube(text: string): Cube {
  let size = 0,
    title: string | undefined,
    min = [0, 0, 0],
    max = [1, 1, 1];
  const vals: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const head = line.split(/\s+/)[0].toUpperCase();
    if (head === 'TITLE') title = line.replace(/^TITLE\s+/i, '').replace(/^"|"$/g, '');
    else if (head === 'LUT_3D_SIZE') size = parseInt(line.split(/\s+/)[1], 10);
    else if (head === 'LUT_1D_SIZE') throw new Error('1D の LUT には対応していません（3D の LUT を選んでください）');
    else if (head === 'DOMAIN_MIN') min = line.split(/\s+/).slice(1, 4).map(Number);
    else if (head === 'DOMAIN_MAX') max = line.split(/\s+/).slice(1, 4).map(Number);
    else if (/^[A-Z_]+$/.test(head)) continue;
    else {
      const p = line.split(/\s+/).map(Number);
      if (p.length < 3 || p.slice(0, 3).some((x) => !isFinite(x))) throw new Error('LUT の数値を読めませんでした');
      vals.push(p[0], p[1], p[2]);
    }
  }
  if (!(size >= 2 && size <= 256)) throw new Error('LUT_3D_SIZE がありません');
  if (vals.length !== size * size * size * 3) throw new Error('LUT の数値の数が合いません');
  const data = new Float32Array(vals.length);
  for (let i = 0; i < vals.length; i++) {
    const ch = i % 3,
      span = max[ch] - min[ch] || 1;
    data[i] = (vals[i] - min[ch]) / span;
  }
  return { size, data, title };
}
