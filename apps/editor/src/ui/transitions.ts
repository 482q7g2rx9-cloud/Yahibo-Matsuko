// トランジション（映像のクリップのつなぎ目）。
// つなぎ目の後ろのクリップに xin: { k: 種類, d: 長さ（秒） } として持たせ、つなぎ目を中心に d 秒かけて切り替える。
// プレビュー（engine.ts）はここの mix で描き、デスクトップ版の書き出しは FFmpeg の xfade（ff の名前）で同じ切り替えを作る。

export interface TransitionDef {
  id: string;
  name: string;
  /** FFmpeg の xfade の transition */
  ff: string;
}

export const TRANSITIONS: TransitionDef[] = [
  { id: 'fade', name: 'クロスディゾルブ', ff: 'fade' },
  { id: 'fadeblack', name: '黒を挟む', ff: 'fadeblack' },
  { id: 'fadewhite', name: '白を挟む', ff: 'fadewhite' },
  { id: 'wipeleft', name: 'ワイプ（左へ）', ff: 'wipeleft' },
  { id: 'wiperight', name: 'ワイプ（右へ）', ff: 'wiperight' },
  { id: 'wipeup', name: 'ワイプ（上へ）', ff: 'wipeup' },
  { id: 'slideleft', name: 'スライド（左へ）', ff: 'slideleft' },
  { id: 'slideright', name: 'スライド（右へ）', ff: 'slideright' },
  { id: 'circleopen', name: '円で開く', ff: 'circleopen' },
  { id: 'circleclose', name: '円で閉じる', ff: 'circleclose' },
  { id: 'zoomin', name: 'ズームイン', ff: 'zoomin' },
  { id: 'pixelize', name: 'モザイク', ff: 'pixelize' },
  { id: 'wipedown', name: 'ワイプ（下へ）', ff: 'wipedown' },
  { id: 'wipetl', name: 'ワイプ（左上へ）', ff: 'wipetl' },
  { id: 'wipetr', name: 'ワイプ（右上へ）', ff: 'wipetr' },
  { id: 'wipebl', name: 'ワイプ（左下へ）', ff: 'wipebl' },
  { id: 'wipebr', name: 'ワイプ（右下へ）', ff: 'wipebr' },
  { id: 'slideup', name: 'スライド（上へ）', ff: 'slideup' },
  { id: 'slidedown', name: 'スライド（下へ）', ff: 'slidedown' },
  { id: 'coverleft', name: 'かぶせる（左へ）', ff: 'coverleft' },
  { id: 'coverright', name: 'かぶせる（右へ）', ff: 'coverright' },
  { id: 'coverup', name: 'かぶせる（上へ）', ff: 'coverup' },
  { id: 'coverdown', name: 'かぶせる（下へ）', ff: 'coverdown' },
  { id: 'revealleft', name: 'めくる（左へ）', ff: 'revealleft' },
  { id: 'revealright', name: 'めくる（右へ）', ff: 'revealright' },
  { id: 'smoothleft', name: 'ぼかしワイプ（左へ）', ff: 'smoothleft' },
  { id: 'smoothright', name: 'ぼかしワイプ（右へ）', ff: 'smoothright' },
  { id: 'vertopen', name: '左右に開く', ff: 'vertopen' },
  { id: 'vertclose', name: '左右から閉じる', ff: 'vertclose' },
  { id: 'horzopen', name: '上下に開く', ff: 'horzopen' },
  { id: 'horzclose', name: '上下から閉じる', ff: 'horzclose' },
  { id: 'diagtl', name: '斜め（左上へ）', ff: 'diagtl' },
  { id: 'diagbr', name: '斜め（右下へ）', ff: 'diagbr' },
  { id: 'radial', name: '時計回り', ff: 'radial' },
  { id: 'rectcrop', name: '四角で切り替え', ff: 'rectcrop' },
  { id: 'circlecrop', name: '円で切り替え', ff: 'circlecrop' },
  { id: 'dissolve', name: '砂のように', ff: 'dissolve' },
  { id: 'hblur', name: '横ぶれ', ff: 'hblur' },
  { id: 'fadegrays', name: 'モノクロを挟む', ff: 'fadegrays' },
  { id: 'squeezeh', name: '上下に縮む', ff: 'squeezeh' },
  { id: 'hlslice', name: 'スライス（左へ）', ff: 'hlslice' },
  { id: 'hlwind', name: '風（左へ）', ff: 'hlwind' },
];

/** 一覧の分類（見出しと、そこに並べる種類） */
export const TRANSITION_GROUPS: [string, string[]][] = [
  ['基本', ['fade', 'fadeblack', 'fadewhite', 'fadegrays', 'dissolve']],
  ['ワイプ', ['wipeleft', 'wiperight', 'wipeup', 'wipedown', 'wipetl', 'wipetr', 'wipebl', 'wipebr', 'smoothleft', 'smoothright']],
  ['スライド', ['slideleft', 'slideright', 'slideup', 'slidedown', 'coverleft', 'coverright', 'coverup', 'coverdown', 'revealleft', 'revealright']],
  ['開く・閉じる', ['vertopen', 'vertclose', 'horzopen', 'horzclose', 'squeezeh']],
  ['図形', ['circleopen', 'circleclose', 'circlecrop', 'rectcrop', 'radial', 'diagtl', 'diagbr']],
  ['効果', ['zoomin', 'pixelize', 'hblur', 'hlslice', 'hlwind']],
];

export const TRANSITION_DEFAULT_D = 1;

export function transitionById(id: string | undefined): TransitionDef | undefined {
  return TRANSITIONS.find((t) => t.id === id);
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

let pixCanvas: HTMLCanvasElement | null = null;
let tmpCanvas: HTMLCanvasElement | null = null;
function tmp(W: number, H: number): HTMLCanvasElement {
  if (!tmpCanvas) tmpCanvas = document.createElement('canvas');
  if (tmpCanvas.width !== W || tmpCanvas.height !== H) {
    tmpCanvas.width = W;
    tmpCanvas.height = H;
  }
  return tmpCanvas;
}

/** FFmpeg と同じ乱数（vf_xfade.c の frand） */
function frand(x: number, y: number): number {
  const r = Math.sin(x * 12.9898 + y * 78.233) * 43758.545;
  return r - Math.floor(r);
}
let maskCanvas: HTMLCanvasElement | null = null;
/**
 * 後ろの絵 b を、場所ごとの濃さ f(u, v)（0〜1、u・v は 0〜1 の位置）で前の絵 a の上に重ねる。
 * 濃さは mw×mh の細かさで計算して引き伸ばす（smooth が偽なら、ぼかさずに引き伸ばす）
 */
function maskMix(
  cx: CanvasRenderingContext2D,
  a: CanvasImageSource,
  b: CanvasImageSource,
  W: number,
  H: number,
  mw: number,
  mh: number,
  f: (u: number, v: number, x: number, y: number) => number,
  smooth = true,
): void {
  mw = Math.max(1, Math.round(mw));
  mh = Math.max(1, Math.round(mh));
  if (!maskCanvas) maskCanvas = document.createElement('canvas');
  if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
    maskCanvas.width = mw;
    maskCanvas.height = mh;
  }
  const mc = maskCanvas.getContext('2d');
  const t = tmp(W, H), tc = t.getContext('2d');
  if (!mc || !tc) return;
  const img = mc.createImageData(mw, mh), d = img.data;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const k = (y * mw + x) * 4;
      d[k + 3] = Math.round(Math.max(0, Math.min(1, f((x + 0.5) / mw, (y + 0.5) / mh, x, y))) * 255);
    }
  }
  mc.putImageData(img, 0, 0);
  tc.save();
  tc.globalCompositeOperation = 'source-over';
  tc.clearRect(0, 0, W, H);
  tc.drawImage(b, 0, 0, W, H);
  tc.globalCompositeOperation = 'destination-in';
  tc.imageSmoothingEnabled = smooth;
  tc.drawImage(maskCanvas, 0, 0, W, H);
  tc.restore();
  cx.drawImage(a, 0, 0, W, H);
  cx.drawImage(t, 0, 0, W, H);
}
let grayCanvas: HTMLCanvasElement | null = null;
/** 白黒にした絵（彩度を 0 にする） */
function gray(img: CanvasImageSource, W: number, H: number, k: number): HTMLCanvasElement {
  if (!grayCanvas) grayCanvas = document.createElement('canvas');
  const g = k === 0 ? grayCanvas : document.createElement('canvas');
  g.width = W;
  g.height = H;
  const gc = g.getContext('2d');
  if (gc) {
    gc.drawImage(img, 0, 0, W, H);
    gc.globalCompositeOperation = 'saturation';
    gc.fillStyle = '#808080';
    gc.fillRect(0, 0, W, H);
    gc.globalCompositeOperation = 'source-over';
  }
  return g;
}
let blurCanvas: HTMLCanvasElement | null = null;
/** 横にだけぼかした絵（横に縮めてから引き伸ばす） */
function hblurred(img: CanvasImageSource, W: number, H: number, size: number): CanvasImageSource {
  if (size <= 1.5) return img;
  if (!blurCanvas) blurCanvas = document.createElement('canvas');
  const sw = Math.max(1, Math.round(W / size));
  blurCanvas.width = sw;
  blurCanvas.height = H;
  const bc = blurCanvas.getContext('2d');
  if (!bc) return img;
  bc.imageSmoothingEnabled = true;
  bc.drawImage(img, 0, 0, sw, H);
  return blurCanvas;
}

/**
 * a（前のクリップ）から b（後ろのクリップ）へ、進み p（0〜1）の絵を cx に描く。
 * a・b は同じ大きさ（W×H）の絵（黒の上にクリップを描いたもの）
 */
export function mixTransition(
  cx: CanvasRenderingContext2D,
  id: string,
  a: CanvasImageSource,
  b: CanvasImageSource,
  p: number,
  W: number,
  H: number,
): void {
  p = Math.max(0, Math.min(1, p));
  cx.save();
  const full = (img: CanvasImageSource, alpha = 1) => {
    cx.globalAlpha = alpha;
    cx.drawImage(img, 0, 0, W, H);
    cx.globalAlpha = 1;
  };
  const clipRect = (x: number, y: number, w: number, h: number, img: CanvasImageSource) => {
    cx.save();
    cx.beginPath();
    cx.rect(x, y, w, h);
    cx.clip();
    cx.drawImage(img, 0, 0, W, H);
    cx.restore();
  };
  switch (id) {
    case 'fadeblack':
    case 'fadewhite': {
      // FFmpeg の fadeblack・fadewhite と同じ重み：はじめの 2 割で黒（白）になり、そのあと後ろの絵が出てくる
      const pr = 1 - p, ph = 0.2;
      const wA = smooth(1 - ph, 1, pr) * pr, wB = (1 - smooth(ph, 1, pr)) * (1 - pr);
      cx.fillStyle = id === 'fadeblack' ? '#000' : '#fff';
      cx.fillRect(0, 0, W, H);
      if (wA > 0 && wB < 1) full(a, Math.min(1, wA / (1 - wB)));
      if (wB > 0) full(b, wB);
      break;
    }
    case 'wipeleft':
      full(a);
      clipRect(W * (1 - p), 0, W * p, H, b);
      break;
    case 'wiperight':
      full(a);
      clipRect(0, 0, W * p, H, b);
      break;
    case 'wipeup':
      full(a);
      clipRect(0, H * (1 - p), W, H * p, b);
      break;
    case 'slideleft':
      cx.drawImage(a, -W * p, 0, W, H);
      cx.drawImage(b, W * (1 - p), 0, W, H);
      break;
    case 'slideright':
      cx.drawImage(a, W * p, 0, W, H);
      cx.drawImage(b, -W * (1 - p), 0, W, H);
      break;
    case 'circleopen':
    case 'circleclose': {
      // FFmpeg と同じく、ふちをぼかした円（中心からの距離で後ろの絵の濃さが決まる）
      const pr = 1 - p, c = (pr - 0.5) * 3, z = Math.hypot(W / 2, H / 2), open = id === 'circleopen';
      full(a);
      const t = tmp(W, H);
      const tc = t.getContext('2d');
      if (tc) {
        tc.globalCompositeOperation = 'source-over';
        tc.clearRect(0, 0, W, H);
        tc.drawImage(b, 0, 0, W, H);
        const g = tc.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, z);
        for (let i = 0; i <= 20; i++) {
          const r = i / 20, wB = open ? 1 - smooth(0, 1, r + c) : smooth(0, 1, r - c);
          g.addColorStop(r, 'rgba(0,0,0,' + wB.toFixed(3) + ')');
        }
        tc.globalCompositeOperation = 'destination-in';
        tc.fillStyle = g;
        tc.fillRect(0, 0, W, H);
        tc.globalCompositeOperation = 'source-over';
        cx.drawImage(t, 0, 0, W, H);
      }
      break;
    }
    case 'zoomin': {
      // FFmpeg の zoomin：前半で前の絵を真ん中へ拡大し、後半で後ろの絵へ切り替える
      const pr = 1 - p, zf = Math.max(0.004, smooth(0.5, 1, pr));
      const sw = W * zf, sh = H * zf;
      cx.drawImage(a, (W - sw) / 2, (H - sh) / 2, sw, sh, 0, 0, W, H);
      full(b, 1 - smooth(0, 0.5, pr));
      break;
    }
    case 'pixelize': {
      // FFmpeg の pixelize：真ん中に向けてモザイクを粗くしながら、前の絵から後ろの絵へ重ねて切り替える
      const d = Math.ceil(Math.min(p, 1 - p) * 50) / 50, sq = (2 * d * Math.min(W, H)) / 20;
      const t = tmp(W, H), tc = t.getContext('2d');
      if (!tc) break;
      tc.globalCompositeOperation = 'source-over';
      tc.globalAlpha = 1;
      tc.drawImage(a, 0, 0, W, H);
      tc.globalAlpha = p;
      tc.drawImage(b, 0, 0, W, H);
      tc.globalAlpha = 1;
      if (sq < 1.5) {
        cx.drawImage(t, 0, 0, W, H);
        break;
      }
      const sw = Math.max(1, Math.round(W / sq)), sh = Math.max(1, Math.round(H / sq));
      if (!pixCanvas) pixCanvas = document.createElement('canvas');
      pixCanvas.width = sw;
      pixCanvas.height = sh;
      const pc = pixCanvas.getContext('2d');
      if (pc) {
        pc.drawImage(t, 0, 0, sw, sh);
        cx.imageSmoothingEnabled = false;
        cx.drawImage(pixCanvas, 0, 0, sw, sh, 0, 0, W, H);
        cx.imageSmoothingEnabled = true;
      }
      break;
    }
    /* ---------- 追加の 30 種類（FFmpeg の xfade と同じ式。pr は FFmpeg の進み＝1−p） ---------- */
    case 'wipedown':
      full(a);
      clipRect(0, 0, W, H * p, b);
      break;
    case 'wipetl':
    case 'wipetr':
    case 'wipebl':
    case 'wipebr': {
      // 前の絵が、角に向かって小さくなる四角に残る
      const q = 1 - p, x0 = id === 'wipetr' || id === 'wipebr' ? W * p : 0, y0 = id === 'wipebl' || id === 'wipebr' ? H * p : 0;
      full(b);
      clipRect(x0, y0, W * q, H * q, a);
      break;
    }
    case 'slideup':
      cx.drawImage(a, 0, -H * p, W, H);
      cx.drawImage(b, 0, H * (1 - p), W, H);
      break;
    case 'slidedown':
      cx.drawImage(a, 0, H * p, W, H);
      cx.drawImage(b, 0, -H * (1 - p), W, H);
      break;
    case 'coverleft':
      full(a);
      cx.drawImage(b, W * (1 - p), 0, W, H);
      break;
    case 'coverright':
      full(a);
      cx.drawImage(b, -W * (1 - p), 0, W, H);
      break;
    case 'coverup':
      full(a);
      cx.drawImage(b, 0, H * (1 - p), W, H);
      break;
    case 'coverdown':
      full(a);
      cx.drawImage(b, 0, -H * (1 - p), W, H);
      break;
    case 'revealleft':
      full(b);
      cx.drawImage(a, -W * p, 0, W, H);
      break;
    case 'revealright':
      full(b);
      cx.drawImage(a, W * p, 0, W, H);
      break;
    case 'smoothleft':
      maskMix(cx, a, b, W, H, 256, 1, (u) => smooth(0, 1, u + 2 * p - 1));
      break;
    case 'smoothright':
      maskMix(cx, a, b, W, H, 256, 1, (u) => smooth(0, 1, 1 - u + 2 * p - 1));
      break;
    case 'vertopen':
      maskMix(cx, a, b, W, H, 256, 1, (u) => smooth(0, 1, 2 * p - Math.abs(2 * u - 1)));
      break;
    case 'vertclose':
      maskMix(cx, a, b, W, H, 256, 1, (u) => smooth(0, 1, Math.abs(2 * u - 1) + 2 * p - 1));
      break;
    case 'horzopen':
      maskMix(cx, a, b, W, H, 1, 256, (_u, v) => smooth(0, 1, 2 * p - Math.abs(2 * v - 1)));
      break;
    case 'horzclose':
      maskMix(cx, a, b, W, H, 1, 256, (_u, v) => smooth(0, 1, Math.abs(2 * v - 1) + 2 * p - 1));
      break;
    case 'diagtl':
      maskMix(cx, a, b, W, H, 160, 90, (u, v) => smooth(0, 1, u * v + 2 * p - 1));
      break;
    case 'diagbr':
      maskMix(cx, a, b, W, H, 160, 90, (u, v) => smooth(0, 1, (1 - u) * (1 - v) + 2 * p - 1));
      break;
    case 'radial': {
      const pr = 1 - p;
      maskMix(cx, a, b, W, H, 192, 108, (u, v) => smooth(0, 1, Math.atan2((u - 0.5) * W, (v - 0.5) * H) - (pr - 0.5) * Math.PI * 2.5));
      break;
    }
    case 'rectcrop':
    case 'circlecrop': {
      // 黒の中の四角（円）に、前半は前の絵、後半は後ろの絵を見せる
      const e = Math.abs(0.5 - p);
      cx.fillStyle = '#000';
      cx.fillRect(0, 0, W, H);
      cx.save();
      cx.beginPath();
      if (id === 'rectcrop') cx.rect(W / 2 - e * W, H / 2 - e * H, 2 * e * W, 2 * e * H);
      else cx.arc(W / 2, H / 2, Math.max(0.01, Math.pow(2 * e, 3) * Math.hypot(W / 2, H / 2)), 0, Math.PI * 2);
      cx.clip();
      cx.drawImage(p > 0.5 ? b : a, 0, 0, W, H);
      cx.restore();
      break;
    }
    case 'dissolve': {
      // 点ごとの乱数より進みが大きいところから、後ろの絵になる
      const mw = Math.min(W, 960), mh = Math.round((H * mw) / W);
      maskMix(cx, a, b, W, H, mw, mh, (_u, _v, x, y) => (frand(x, y) < p ? 1 : 0), false);
      break;
    }
    case 'hblur': {
      const pr = 1 - p, k = pr <= 0.5 ? pr * 2 : (1 - pr) * 2, size = 1 + (W / 2) * k;
      full(hblurred(a, W, H, size));
      full(hblurred(b, W, H, size), p);
      break;
    }
    case 'fadegrays': {
      // fadeblack と同じ重みで、黒のかわりに、それぞれの絵を白黒にしたものを挟む
      const pr = 1 - p, ph = 0.2, s1 = smooth(1 - ph, 1, pr), s2 = smooth(ph, 1, pr);
      const wA = s1 * pr, wGA = (1 - s1) * pr, wGB = s2 * (1 - pr), wB = (1 - s2) * (1 - pr);
      const L: [CanvasImageSource, number][] = [
        [a, wA],
        [gray(a, W, H, 0), wGA],
        [gray(b, W, H, 1), wGB],
        [b, wB],
      ];
      let acc = 0;
      cx.fillStyle = '#000';
      cx.fillRect(0, 0, W, H);
      for (const [img, w] of L) {
        if (w <= 0) continue;
        acc += w;
        full(img, Math.min(1, w / acc));
      }
      break;
    }
    case 'squeezeh':
      full(b);
      cx.drawImage(a, 0, (H * p) / 2, W, H * (1 - p));
      break;
    case 'hlslice': {
      const pr = 1 - p;
      maskMix(cx, a, b, W, H, Math.min(W, 960), 1, (u) => {
        const sm = smooth(-0.5, 0, u - pr * 1.5), fr = 10 * u - Math.floor(10 * u);
        return sm <= fr ? 0 : 1;
      }, false);
      break;
    }
    case 'hlwind': {
      const pr = 1 - p, mh = Math.min(H, 540);
      maskMix(cx, a, b, W, H, 256, mh, (u, _v, _x, y) => smooth(0, -0.2, (1 - u) * 0.8 + 0.2 * frand(0, Math.round((y * H) / mh)) - (1 - pr) * 1.2), true);
      break;
    }
    default:
      full(a);
      full(b, p);
  }
  cx.restore();
}

/* 一覧に出す見本（A＝濃いグレー、B＝明るいグレーのカードを、進み 0.4 で切り替えた絵） */
const thumbs: Record<string, string> = {};
/* 見本の進み（形がわかりやすいところ） */
const THUMB_P: Record<string, number> = { fadeblack: 0.6, fadewhite: 0.6, circleopen: 0.45, circleclose: 0.55, zoomin: 0.3, pixelize: 0.4, fadegrays: 0.5, rectcrop: 0.75, circlecrop: 0.75, dissolve: 0.5, hblur: 0.35, radial: 0.5, diagtl: 0.5, diagbr: 0.5, hlwind: 0.5, hlslice: 0.5 };
function card(label: string, bg: string, fg: string, W: number, H: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  if (x) {
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, bg);
    g.addColorStop(1, fg);
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,255,255,.92)';
    x.font = '700 ' + Math.round(H * 0.5) + 'px sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(label, W / 2, H / 2 + 2);
  }
  return c;
}
export function transitionThumb(id: string): string {
  if (thumbs[id]) return thumbs[id];
  const W = 256, H = 144;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const cx = c.getContext('2d');
  if (!cx) return '';
  mixTransition(cx, id, card('A', '#4a4a4a', '#2e2e2e', W, H), card('B', '#a3a3a3', '#7a7a7a', W, H), THUMB_P[id] || 0.4, W, H);
  return (thumbs[id] = c.toDataURL('image/png'));
}
