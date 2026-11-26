// @ts-nocheck
// 左右のパネルの幅を、内側の端をつかんでドラッグで変える（編集ページ・エフェクトページ）。
// 幅は localStorage（matsuko.panels）に覚え、端をダブルクリックすると元の幅に戻す。
import { draw } from './render';
import { SCALE } from './fit';

/* 覚えている幅と、元の幅（px） */
export var PW, PW_DEF;
var DRAG = null, LAST = null;

/* パネルの幅：変えていなければ元の幅 */
export function pw(k) { return PW[k] || PW_DEF[k]; }

/* つかむところ。side は l（左のパネル。右の端をつかむ）か r（右のパネル。左の端をつかむ） */
export function splitter(k, side) {
  return '<div class="split ' + side + '" data-split="' + k + '" role="separator" aria-orientation="vertical" aria-label="パネルの幅" title="ドラッグで幅を変える（ダブルクリックで元に戻す）"></div>';
}

/* 狭すぎ・広すぎにしない：左のパネルは 240px、右のパネルは 280px から（タブや数値の欄が切れないように）、
   画面の幅の 36%（最大 560px）まで */
function clamp(k, w) {
  var app = document.getElementById('app'), aw = app ? app.clientWidth : 1180, min = /L$/.test(k) ? 240 : 280;
  return Math.round(Math.max(min, Math.min(w, Math.max(min, Math.min(560, aw * 0.36)))));
}
function save() { try { localStorage.setItem('matsuko.panels', JSON.stringify(PW)); } catch (e) {} }

export function init() {
  PW_DEF = { editL: 250, editR: 320, fxL: 260, fxR: 320 };
  PW = {};
  try {
    var o = JSON.parse(localStorage.getItem('matsuko.panels') || '{}');
    Object.keys(PW_DEF).forEach(function (k) { if (typeof o[k] === 'number') PW[k] = o[k]; });
  } catch (e) {}
  document.addEventListener('pointerdown', function (e) {
    var h = e.target.closest && e.target.closest('[data-split]');
    if (!h || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    var pn = h.parentElement, now = Date.now();
    /* 同じ端を素早く2回押したら、元の幅に戻す（ダブルクリック） */
    if (LAST && LAST.k === h.dataset.split && now - LAST.t < 400) { LAST = null; delete PW[h.dataset.split]; save(); draw(); return; }
    LAST = { k: h.dataset.split, t: now };
    DRAG = { k: h.dataset.split, x: e.clientX, w: pn.getBoundingClientRect().width / SCALE, pn: pn, h: h, left: h.classList.contains('l') };
    h.classList.add('on'); document.body.classList.add('resizing');
  }, true);
  document.addEventListener('pointermove', function (e) {
    if (!DRAG) return;
    var dx = (e.clientX - DRAG.x) / SCALE, w = clamp(DRAG.k, DRAG.w + (DRAG.left ? dx : -dx));
    if (Math.abs(dx) > 2) DRAG.moved = true;
    DRAG.pn.style.width = w + 'px'; PW[DRAG.k] = w;
  }, true);
  function end() {
    if (!DRAG) return;
    var moved = DRAG.moved;
    DRAG.h.classList.remove('on'); DRAG = null; document.body.classList.remove('resizing');
    if (moved) { LAST = null; save(); draw(); } /* 幅を変えたときだけ、タイムラインなどを新しい幅で描き直す */
  }
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', end, true);
}
