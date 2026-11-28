// @ts-nocheck
/* ================================================================
   テロップのアニメーション（M6）：登場（tin）と退場（tout）。{k: 種類, d: 長さ（秒）}
   - 文字のまとまりごと：フェード・下から／下へ・左から／右へ・ズーム・ポップ・ワイプ
   - 1 文字ずつ：タイプライター・1文字ずつ（フェード）・1文字ずつ落ちる
   プレビューも書き出しも、同じ描き方（engine.ts の drawTitle）。書き出しでは、動いている間のフレームを画像にして渡す（exporter.ts）
   ================================================================ */
export var TITLE_IN = [['', 'なし'], ['fade', 'フェード'], ['up', '下から'], ['left', '左から'], ['zoom', 'ズーム'], ['pop', 'ポップ'], ['wipe', 'ワイプ'], ['type', 'タイプライター'], ['charFade', '1文字ずつ'], ['charDrop', '1文字ずつ落ちる']];
export var TITLE_OUT = [['', 'なし'], ['fade', 'フェード'], ['down', '下へ'], ['right', '右へ'], ['zoom', 'ズーム'], ['wipe', 'ワイプ'], ['charFade', '1文字ずつ']];
export var CHAR_KINDS = { type: 1, charFade: 1, charDrop: 1 };
export var ANIM_DEF = 0.6;

/** 登場・退場の長さ（秒）。足してクリップより長ければ、半分ずつまでに縮める */
export function animDur(c) {
  var len = Math.max(0, (c.out || 0) - (c.in || 0));
  var din = c.tin && c.tin.k ? Math.min(c.tin.d || ANIM_DEF, len / 2) : 0, dout = c.tout && c.tout.k ? Math.min(c.tout.d || ANIM_DEF, len / 2) : 0;
  return [din, dout, len];
}
export function hasTitleAnim(c) { return c && c.type === 'title' && c.st !== 'credit' && (c.tin && c.tin.k || c.tout && c.tout.k); }
/** タイムラインの時刻 t のアニメーション：{k, u（0 で見えない〜1 で見えている）}。動いていなければ null */
export function animAt(c, t) {
  if (!hasTitleAnim(c)) return null;
  var d = animDur(c), lc = t - c.start;
  if (d[0] > 0 && lc < d[0]) return { k: c.tin.k, u: Math.max(0, lc / d[0]) };
  if (d[1] > 0 && lc > d[2] - d[1]) return { k: c.tout.k, u: Math.max(0, (d[2] - lc) / d[1]) };
  return null;
}
function eo(u) { return 1 - Math.pow(1 - u, 3); }
/** 文字のまとまりの動き（rect は文字のまとまりの範囲 [x, y, w, h]） */
export function blockAnim(cx, a, r, W, H) {
  if (!a || CHAR_KINDS[a.k]) return;
  var u = Math.max(0, Math.min(1, a.u)), cxm = r[0] + r[2] / 2, cym = r[1] + r[3] / 2;
  if (a.k === 'fade') cx.globalAlpha *= u;
  else if (a.k === 'up' || a.k === 'down') { cx.translate(0, (1 - eo(u)) * H * 0.06); cx.globalAlpha *= u; }
  else if (a.k === 'left') { cx.translate(-(1 - eo(u)) * W * 0.08, 0); cx.globalAlpha *= u; }
  else if (a.k === 'right') { cx.translate((1 - eo(u)) * W * 0.08, 0); cx.globalAlpha *= u; }
  else if (a.k === 'zoom' || a.k === 'pop') {
    var s = a.k === 'zoom' ? 0.6 + 0.4 * eo(u) : u < 0.7 ? eo(u / 0.7) * 1.12 : 1.12 - 0.12 * ((u - 0.7) / 0.3);
    cx.translate(cxm, cym); cx.scale(Math.max(0.001, s), Math.max(0.001, s)); cx.translate(-cxm, -cym);
    cx.globalAlpha *= a.k === 'zoom' ? u : Math.min(1, u * 3);
  } else if (a.k === 'wipe') { cx.beginPath(); cx.rect(r[0] - 2, r[1] - H, (r[2] + 4) * u, r[3] + 2 * H); cx.clip(); }
}
/** 1 文字ずつの動き：i 番目（全部で n 文字）の {a: 不透明度, dy: 上下のずれ（文字の大きさに対する割合）} */
export function charAnim(a, i, n) {
  var u = Math.max(0, Math.min(1, a.u));
  if (a.k === 'type') return { a: i < Math.floor(u * n + 1e-6) ? 1 : 0, dy: 0 };
  var w = 0.35, st = n > 1 ? i / (n - 1) * (1 - w) : 0, lc = Math.max(0, Math.min(1, (u - st) / w));
  return { a: lc, dy: a.k === 'charDrop' ? -(1 - eo(lc)) * 0.8 : 0 };
}
/** 背景の帯（質問・字幕）の不透明度 */
export function boxAlpha(a) { return a && CHAR_KINDS[a.k] ? Math.min(1, a.u * 4) : 1; }
