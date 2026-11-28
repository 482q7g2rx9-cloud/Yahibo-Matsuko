// @ts-nocheck
/* 色補正（M6）の操作：プリセット・元に戻す・LUT の読み込み。値の計算は core/color.ts、プレビューは colorGL.ts */
import { ADJ_DEFAULT, COLOR_KEYS, COLOR_PRESETS, parseCube } from '../core/color';
import { CUBES, cubeId } from './colorGL';
import { C } from './project';
import { changed, mark } from './store';
import { HOST } from './desktop';
import { toast } from './menus';
import { applyMotionPreset } from '../core/keyframes';
import { canFx } from './pages/fx';

/** 前の版の調整レイヤー（値がない）は、変える前に前と同じ値を入れておく（1 つ変えたら、ほかが 0 にならないように） */
export function fillAdj(c) { if (c && c.type === 'adj' && !COLOR_KEYS.some(function (k) { return c[k] != null; }) && c.ccLut == null) Object.assign(c, ADJ_DEFAULT); }
function clear(c) { COLOR_KEYS.forEach(function (k) { delete c[k]; }); }
/** プリセットを当てる（LUT はそのまま） */
export function colorPreset(cid, id) {
  var c = C(cid), p = COLOR_PRESETS.filter(function (x) { return x.id === id; })[0]; if (!c || !p) return;
  mark(); clear(c); COLOR_KEYS.forEach(function (k) { c[k] = p.v[k] != null ? p.v[k] : 0; }); changed();
}
/** 色補正をすべて外す（調整レイヤーは、補正なしにする） */
export function colorReset(cid) {
  var c = C(cid); if (!c) return; mark(); clear(c); delete c.ccLut; delete c.ccLutAmt;
  if (c.type === 'adj') COLOR_KEYS.forEach(function (k) { c[k] = 0; });
  changed();
}
/** LUT（.cube）を読み込んでクリップに付ける */
export function pickLut(cid) {
  var c = C(cid); if (!c) return;
  var put = function (name, path, text) {
    var cube; try { cube = parseCube(text); } catch (e) { return toast('LUT を読めませんでした：' + e.message); }
    var lut = path ? { name: name, path: path } : { name: name };
    CUBES[cubeId(lut)] = cube;
    mark(); fillAdj(c); c.ccLut = lut; if (c.ccLutAmt == null) c.ccLutAmt = 100; changed();
  };
  if (HOST) {
    HOST.color.pickLut().then(function (p) { if (!p) return; return HOST.color.readLut(p).then(function (t) { put(p.split(/[\\/]/).pop(), p, t); }); })
      .catch(function (e) { toast(String(e)); });
    return;
  }
  var i = document.getElementById('lutIn');
  if (!i) { i = document.createElement('input'); i.type = 'file'; i.id = 'lutIn'; i.accept = '.cube'; i.hidden = true; document.body.appendChild(i); }
  i.onchange = function () { var f = i.files && i.files[0]; if (!f) return; f.text().then(function (t) { put(f.name, null, t); }); i.value = ''; };
  i.click();
}
export function lutOff(cid) { var c = C(cid); if (!c) return; mark(); delete c.ccLut; delete c.ccLutAmt; changed(); }

/** エフェクトページの一覧から付ける：cc:色補正のプリセット、blur・mosaic・vig、mo:動きのプリセット */
export function fxApply(c, id) {
  if (!c) return toast('クリップを選んでください');
  if (!canFx(c, id)) return toast('このクリップには付けられません');
  if (id.indexOf('cc:') === 0) return colorPreset(c.id, id.slice(3));
  mark();
  if (id === 'blur') c.fxBlur = c.fxBlur || 8;
  else if (id === 'mosaic') c.fxMosaic = c.fxMosaic || 24;
  else if (id === 'vig') c.fxVig = c.fxVig || 40;
  else if (id.indexOf('mo:') === 0) applyMotionPreset(c, id.slice(3));
  else if (id.indexOf('ti:') === 0) c.tin = { k: id.slice(3), d: c.tin && c.tin.d || 0.6 };
  else if (id.indexOf('to:') === 0) c.tout = { k: id.slice(3), d: c.tout && c.tout.d || 0.6 };
  changed();
}
