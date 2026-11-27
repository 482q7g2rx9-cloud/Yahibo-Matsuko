// @ts-nocheck
// ビン：素材を分けておくフォルダー（プロジェクトの bins、素材の bin）。
// メディアページの左で作る・名前を変える・消す。素材はドラッグか、素材の詳細の「ビン」で入れる。
// 編集ページのアセットタブでも、ビンを選んで絞り込める。
import { D } from './data';
import { M, P, isUsed, uid } from './project';
import { S } from './state';
import { changed, mark } from './store';
import { toast } from './menus';
import { h } from './util';

export function bins() { return P.bins || (P.bins = []); }
export function binById(id) { return bins().filter(function (b) { return b.id === id; })[0]; }

/* 絞り込み：all（全素材）、種別（映像など）、スマートビン（used・unused・wn）、自分のビン（b:id） */
export function inBin(m, sel) {
  if (!sel || sel === 'all') return true;
  if (sel.indexOf('b:') === 0) return m.bin === sel.slice(2);
  if (sel === 'used') return isUsed(m);
  if (sel === 'unused') return !isUsed(m) && m.k !== '台本';
  if (sel === 'wn') return m.r === 'wn';
  return m.k === sel;
}
export function binLabel(sel) {
  if (sel && sel.indexOf('b:') === 0) { var b = binById(sel.slice(2)); return b ? b.name : '全素材'; }
  var all = D.bins.concat(D.smart).filter(function (x) { return x[0] === sel; })[0];
  return all ? all[1] : '全素材';
}
/* 選択肢（<option>）：全素材・種別・自分のビン・スマートビン */
export function binOptions(cur, kinds) {
  var o = function (v, t) { return '<option value="' + h(v) + '"' + (cur === v ? ' selected' : '') + '>' + h(t) + '</option>'; };
  var base = D.bins.filter(function (b) { return !kinds || b[0] === 'all' || kinds.indexOf(b[0]) >= 0; });
  return base.map(function (b) { return o(b[0], b[1]); }).join('') +
    (bins().length ? '<optgroup label="ビン">' + bins().map(function (b) { return o('b:' + b.id, b.name); }).join('') + '</optgroup>' : '') +
    '<optgroup label="スマートビン">' + D.smart.map(function (b) { return o(b[0], b[1]); }).join('') + '</optgroup>';
}

export function addBin() {
  mark();
  var n = 1, name;
  do { name = '新しいビン' + (n > 1 ? ' ' + n : ''); n++; } while (bins().some(function (b) { return b.name === name; }));
  var b = { id: uid('bin'), name: name };
  bins().push(b);
  S.bin = 'b:' + b.id;
  S.binEdit = b.id;
  changed();
  focusBinName();
}
export function renameBin(id, name) {
  var b = binById(id);
  S.binEdit = null;
  name = String(name || '').trim();
  if (!b || !name || name === b.name) { changed(); return; }
  mark();
  b.name = name;
  changed();
}
export function deleteBin(id) {
  var b = binById(id);
  if (!b) return;
  mark();
  P.bins = bins().filter(function (x) { return x !== b; });
  P.media.forEach(function (m) { if (m.bin === id) delete m.bin; });
  if (S.bin === 'b:' + id) S.bin = 'all';
  if (S.ebin === 'b:' + id) S.ebin = 'all';
  changed();
  toast('ビン「' + b.name + '」を削除しました');
}
/* 素材をビンに入れる（id が空ならビンから出す） */
export function moveToBin(mid, id) {
  var m = M(mid), b = id && binById(id);
  if (!m || (id && !b) || (m.bin || '') === (id || '')) return;
  mark();
  if (b) m.bin = b.id; else delete m.bin;
  changed();
  toast(b ? '「' + m.n + '」をビン「' + b.name + '」に入れました' : '「' + m.n + '」をビンから出しました');
}
/* 名前の入力欄にすぐ打てるようにする */
export function focusBinName() {
  var el = document.querySelector('[data-in="binname"]');
  if (el) { el.focus(); el.select(); }
}
