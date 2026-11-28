// @ts-nocheck
// トランジションタブ：一覧、マウスを乗せたときの試し表示、押したときに付ける。
// 付け先は「選んでいる映像のクリップの頭のつなぎ目」、なければ「再生ヘッドにいちばん近いつなぎ目」。
import { C, M, P, T, cEnd } from './project';
import { S } from './state';
import { mark, changed } from './store';
import { E, heads, pairAt, progStop, redrawProg, sync, trPairs, activeVideos } from './engine';
import { primary } from './editOps';
import { toast } from './menus';
import { A, h } from './util';
import { TRANSITION_GROUPS, TRANSITION_DEFAULT_D, transitionById, transitionThumb } from './transitions';

/* つなぎ目の後ろのクリップ（同じ映像トラックで、すぐ前に映像・画像のクリップがあるもの） */
function prevOf(b) {
  return P.clips.filter(function (c) { return c !== b && c.tr === b.tr && c.type === 'media' && Math.abs(cEnd(c) - b.start) < 1e-3; })[0];
}
export function isCutB(b) {
  var tr = b && T(b.tr), m = b && M(b.m);
  return !!(b && b.type === 'media' && tr && tr.kind === 'v' && m && (m.k === '映像' || m.k === '画像') && prevOf(b));
}
export function trTarget() {
  var c = primary();
  if (c && isCutB(c)) return c;
  var t = S.t.edit, best = null;
  P.clips.forEach(function (b) { if (isCutB(b) && (!best || Math.abs(b.start - t) < Math.abs(best.start - t))) best = b; });
  return best;
}

/* 一覧 */
export function transGallery() {
  return TRANSITION_GROUPS.map(function (g) {
    return '<div class="tsh">' + h(g[0]) + '</div><div class="tsg" role="list" aria-label="' + h(g[0]) + '">' + g[1].map(function (id) {
      var x = transitionById(id);
      if (!x) return '';
      return '<button class="tsl" role="listitem" data-trn="' + x.id + '" title="' + h(x.name) + '" aria-label="' + h(x.name) + '"' + A('trApply', x.id) + '><span class="tsb"><img src="' + transitionThumb(x.id) + '" alt=""></span><span class="tsn">' + h(x.name) + '</span></button>';
    }).join('') + '</div>';
  }).join('');
}

/* 押したとき：つなぎ目に付ける（もう付いていれば種類を変える） */
export function applyTransition(id) {
  var b = trTarget(), def = transitionById(id);
  if (!def) return;
  if (!b) return toast('つなぎ目がありません');
  mark();
  b.xin = { k: id, d: (b.xin && b.xin.d) || TRANSITION_DEFAULT_D };
  changed();
  toast('「' + def.name + '」を適用しました');
}

/* マウスを乗せている間：つなぎ目の前後をくり返し再生して見せる（音は出さない） */
var PV = null;
function stopPreview() {
  if (!PV) return;
  cancelAnimationFrame(PV.raf);
  E.prevTr = null;
  S.t.edit = PV.saved;
  if (E.mon && PV.mon != null) E.mon.gain.value = PV.mon;
  PV = null;
  sync(S.t.edit, false);
  heads();
  redrawProg();
}
function startPreview(id) {
  stopPreview();
  var b = trTarget();
  if (!b || !transitionById(id)) return;
  if (E.playing) progStop();
  PV = { id: id, saved: S.t.edit, raf: 0, mon: null };
  E.prevTr = { bid: b.id, k: id, d: (b.xin && b.xin.d) || TRANSITION_DEFAULT_D };
  var q = trPairs().filter(function (x) { return x.b === b; })[0];
  if (!q) return stopPreview();
  if (E.mon) { PV.mon = E.mon.gain.value; E.mon.gain.value = 0; }
  var L0 = Math.max(0, q.w0 - 0.6), L1 = q.w1 + 0.6, len = L1 - L0, me = PV;
  sync(L0, false);
  var w0 = performance.now();
  (function ready() {
    if (PV !== me) return;
    var wait = activeVideos(L0).some(function (e) { return e.readyState < 2 || e.seeking; });
    if (wait && performance.now() - w0 < 1200) { me.raf = requestAnimationFrame(ready); return; }
    var t0 = performance.now(), last = -1;
    (function loop() {
      if (PV !== me) return;
      var k = (performance.now() - t0) / 1000, t = L0 + (k % len), wrap = Math.floor(k / len) !== last;
      last = Math.floor(k / len);
      S.t.edit = t;
      sync(t, !wrap);
      heads();
      redrawProg();
      me.raf = requestAnimationFrame(loop);
    })();
  })();
}

export function init() {
  PV = null;
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest && e.target.closest('[data-trn]');
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    startPreview(el.dataset.trn);
  });
  document.addEventListener('mouseout', function (e) {
    var el = e.target.closest && e.target.closest('[data-trn]');
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    stopPreview();
  });
  /* 一覧が消えたとき（タブやページを変えたとき）も止める */
  addEventListener('pointerdown', function (e) { if (PV && !(e.target.closest && e.target.closest('[data-trn]'))) stopPreview(); }, true);
}
export function previewing() { return !!PV; }
