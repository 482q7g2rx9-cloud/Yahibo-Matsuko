// テロップのスタイル（文字の色・ふち・グラデーション・光・影）。テロップタブの「スタイル」に一覧で出す。
// 選んだスタイルはテロップのクリップに look として持たせ、プレビュー・書き出しの両方で同じ描き方をする（engine.ts の drawTitle）。

/** ふち：[色, 太さ（文字の大きさに対する割合）] */
export type Stroke = [string, number];

export interface TitleLook {
  /** 文字の色（fill2 があれば、上から下へのグラデーション） */
  fill: string;
  fill2?: string;
  /** ふち（太いものから順に、外側に描く） */
  strokes?: Stroke[];
  /** 影：[色, ぼかし, 横のずれ, 縦のずれ]（大きさは文字の大きさに対する割合） */
  shadow?: [string, number, number, number];
  /** 光：[色, ぼかし] */
  glow?: [string, number];
}

export interface TitlePreset {
  id: string;
  name: string;
  look: TitleLook;
}

const COLORS: [string, string][] = [
  ['白', '#ffffff'], ['黄', '#ffe14d'], ['ピンク', '#ff6fb5'], ['赤', '#ff4040'], ['オレンジ', '#ff9a3c'],
  ['緑', '#4fdc78'], ['水色', '#4dd8ff'], ['青', '#4a7dff'], ['紫', '#b06bff'],
];

/** 白と混ぜて明るくした色（グラデーションの上側） */
function lighten(hex: string, k = 0.6): string {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const m = (v: number) => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0');
  return '#' + m(r) + m(g) + m(b);
}
/** 黒と混ぜて暗くした色 */
function darken(hex: string, k = 0.55): string {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const m = (v: number) => Math.round(v * (1 - k)).toString(16).padStart(2, '0');
  return '#' + m(r) + m(g) + m(b);
}

const pick = (names: string[]) => COLORS.filter((c) => names.includes(c[0]));
const ROW = ['白', '黄', 'ピンク', '赤', '緑', '水色', '青'];
const ROW2 = ['黄', 'ピンク', 'オレンジ', '赤', '緑', '水色', '紫'];

/** スタイルの一覧（7色 × 6種類） */
export const TITLE_PRESETS: TitlePreset[] = [
  ...pick(ROW).map(([n, c]) => ({ id: 'edge-' + n, name: n + '・黒ふち', look: { fill: c, strokes: [['#111111', 0.24]] as Stroke[] } })),
  ...pick(ROW2).map(([n, c]) => ({ id: 'double-' + n, name: n + '・二重ふち', look: { fill: c, strokes: [['#ffffff', 0.2], ['#151515', 0.38]] as Stroke[] } })),
  ...pick(ROW2).map(([n, c]) => ({ id: 'white-' + n, name: '白・' + n + 'ふち', look: { fill: '#ffffff', strokes: [[c, 0.24], [darken(c), 0.38]] as Stroke[] } })),
  ...pick(ROW2).map(([n, c]) => ({ id: 'grad-' + n, name: n + '・グラデーション', look: { fill: lighten(c), fill2: c, strokes: [['#ffffff', 0.16], ['#202020', 0.32]] as Stroke[] } })),
  ...pick(ROW2).map(([n, c]) => ({ id: 'glow-' + n, name: n + '・光る', look: { fill: '#ffffff', strokes: [[c, 0.1]] as Stroke[], glow: [c, 0.55] as [string, number] } })),
  ...pick(ROW).map(([n, c]) => ({ id: 'shadow-' + n, name: n + '・影', look: { fill: c, strokes: [['#000000', 0.12]] as Stroke[], shadow: ['rgba(0,0,0,.85)', 0.18, 0.07, 0.09] as [string, number, number, number] } })),
];

export function presetById(id: string | undefined): TitlePreset | undefined {
  return TITLE_PRESETS.find((p) => p.id === id);
}

/** 1行の文字をスタイルで描く。x・y は文字の基準点（textAlign・textBaseline は呼ぶ側で決める）、fs は文字の大きさ（px） */
export function drawLookText(cx: CanvasRenderingContext2D, text: string, x: number, y: number, fs: number, look: TitleLook): void {
  cx.save();
  cx.lineJoin = 'round';
  cx.miterLimit = 2;
  const strokes = (look.strokes || []).slice().sort((a, b) => b[1] - a[1]);
  const shadow = () => {
    if (!look.shadow) return;
    const [c, blur, dx, dy] = look.shadow;
    cx.shadowColor = c;
    cx.shadowBlur = blur * fs;
    cx.shadowOffsetX = dx * fs;
    cx.shadowOffsetY = dy * fs;
  };
  const noShadow = () => {
    cx.shadowColor = 'transparent';
    cx.shadowBlur = 0;
    cx.shadowOffsetX = 0;
    cx.shadowOffsetY = 0;
  };
  // 影はいちばん外側のものにだけ付ける
  shadow();
  strokes.forEach((s, i) => {
    cx.lineWidth = s[1] * fs;
    cx.strokeStyle = s[0];
    cx.strokeText(text, x, y);
    if (i === 0) noShadow();
  });
  if (!strokes.length) shadow();
  if (look.glow) {
    cx.shadowColor = look.glow[0];
    cx.shadowBlur = look.glow[1] * fs;
    cx.fillStyle = look.glow[0];
    cx.fillText(text, x, y);
    cx.fillText(text, x, y);
    noShadow();
  }
  let fill: string | CanvasGradient = look.fill;
  if (look.fill2) {
    const g = cx.createLinearGradient(0, y - fs * 0.5, 0, y + fs * 0.5);
    g.addColorStop(0, look.fill);
    g.addColorStop(1, look.fill2);
    fill = g;
  }
  cx.fillStyle = fill;
  cx.fillText(text, x, y);
  cx.restore();
}

/* 一覧に出す「あア」の見本（画像にして使い回す） */
const thumbs: Record<string, string> = {};
export function presetThumb(p: TitlePreset): string {
  if (thumbs[p.id]) return thumbs[p.id];
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const cx = c.getContext('2d');
  if (!cx) return '';
  const fs = 70;
  cx.font = '700 ' + fs + 'px "Noto Sans JP","Noto Sans JP Variable",sans-serif';
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  drawLookText(cx, 'あア', 128, 82, fs, p.look);
  return (thumbs[p.id] = c.toDataURL('image/png'));
}
/** 日本語のフォントが読み込まれたら、見本を描き直すために捨てる */
export function clearThumbs(): void {
  for (const k of Object.keys(thumbs)) delete thumbs[k];
}
