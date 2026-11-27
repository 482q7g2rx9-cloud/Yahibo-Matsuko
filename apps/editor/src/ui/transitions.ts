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
    default:
      full(a);
      full(b, p);
  }
  cx.restore();
}

/* 一覧に出す見本（A＝濃いグレー、B＝明るいグレーのカードを、進み 0.4 で切り替えた絵） */
const thumbs: Record<string, string> = {};
/* 見本の進み（形がわかりやすいところ） */
const THUMB_P: Record<string, number> = { fadeblack: 0.6, fadewhite: 0.6, circleopen: 0.45, circleclose: 0.55, zoomin: 0.3, pixelize: 0.4 };
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
