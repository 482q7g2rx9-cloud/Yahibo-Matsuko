// @ts-nocheck
/* ================================================================
   トラッキング（M6・デスクトップ版のみ）：エフェクトページで、映像のクリップの中の四角を追う。
   1. 「範囲を囲む」を押して、プレビューで追うものを四角で囲む
   2. 「前方へ」「後方へ」で追う（Rust の src-tauri/src/track.rs と matsuko-core の track.rs）
   3. 結果（c.track = {box: [幅, 高さ]（絵に対する割合）, pts: [[素材の秒, 中心の横, 縦]...], lost}）を、
      ほかのクリップに追従させる（位置のキーフレームにする）か、モザイク・ぼかしで隠す（範囲のある調整レイヤーを作る）
   位置の計算は回転を考えない（追うクリップを回転させているときはずれる）
   ================================================================ */
import { C, M, P, T, cEnd, uid } from './project';
import { S } from './state';
import { changed, mark } from './store';
import { HOST } from './desktop';
import { AFTER, E, redrawProg } from './engine';
import { toast } from './menus';
import { draw } from './render';
import { tc } from './util';
import { ps, seqWH } from './projectSettings';
import { fpsNum } from './exporter';
import { srcTime, valueAt } from '../core/keyframes';
import { addTrack } from './editOps';

/** 動いている追跡：{id, cid, p, back} */
export var TRK = { job: null };

/** 素材の絵の大きさ（読み込んだ映像の要素、なければ素材の解像度の文字） */
export function srcDims(c) {
  var e = E.els[c.id];
  if (e && e.videoWidth) return [e.videoWidth, e.videoHeight];
  var m = M(c.m), r = m && String(m.res || '').split(/[×x]/);
  return r && +r[0] && +r[1] ? [+r[0], +r[1]] : [1920, 1080];
}
/** クリップの絵の中の位置（割合 u, v）→ 画面（W×H）の位置。時刻 t のモーションで */
export function toCanvas(c, t, u, v, W, H) {
  var d = srcDims(c), s0 = Math.min(W / d[0], H / d[1]), sc = Math.max(0, valueAt(c, 'scale', t)) / 100, dw = d[0] * s0 * sc, dh = d[1] * s0 * sc;
  return [W / 2 + valueAt(c, 'x', t) / 100 * W + (u - 0.5) * dw, H / 2 + valueAt(c, 'y', t) / 100 * H + (v - 0.5) * dh, dw, dh];
}
export function fromCanvas(c, t, x, y, W, H) {
  var d = srcDims(c), s0 = Math.min(W / d[0], H / d[1]), sc = Math.max(0.001, valueAt(c, 'scale', t)) / 100, dw = d[0] * s0 * sc, dh = d[1] * s0 * sc;
  return [(x - (W / 2 + valueAt(c, 'x', t) / 100 * W)) / dw + 0.5, (y - (H / 2 + valueAt(c, 'y', t) / 100 * H)) / dh + 0.5];
}
/** 素材の秒 s のときの追跡の中心（範囲の外なら null） */
export function trackAt(c, s) {
  var L = c.track && c.track.pts; if (!L || !L.length) return null;
  if (s < L[0][0] - 1e-6 || s > L[L.length - 1][0] + 1e-6) return null;
  for (var i = 0; i < L.length - 1; i++) if (s <= L[i + 1][0]) { var a = L[i], b = L[i + 1], k = b[0] > a[0] ? (s - a[0]) / (b[0] - a[0]) : 0; return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  return [L[L.length - 1][1], L[L.length - 1][2]];
}
export function isVideoClip(c) { var m = c && c.type === 'media' && M(c.m); return !!(m && m.k === '映像' && m.path); }

/* ---------- 追う ---------- */
/** 追い始める（back：再生ヘッドからクリップの頭へ） */
export function trackStart(c, back) {
  if (!HOST || !HOST.track) return;
  if (TRK.job) return toast('追跡中です');
  var m = M(c.m), s = srcTime(c, S.t.edit), box = S.trBox && S.trBox.cid === c.id ? S.trBox : null;
  /* 囲んでいなければ、前の結果のその時刻の四角から続ける */
  if (!box) { var p = trackAt(c, s); if (p && c.track.box) box = { u: p[0], v: p[1], w: c.track.box[0], h: c.track.box[1] }; }
  if (!box) return toast('先にプレビューで追うものを囲んでください');
  var d = srcDims(c), id = uid('trk');
  TRK.job = { id: id, cid: c.id, p: 0, back: !!back, box: [box.w, box.h] };
  HOST.track.start({ id: id, path: m.path, at: s, box: [box.u - box.w / 2, box.v - box.h / 2, box.w, box.h], until: back ? c.in : c.out, back: !!back, fps: fpsNum(ps().fps), ar: d[0] / d[1] })
    .then(function () { draw(); }).catch(function (e) { TRK.job = null; toast(String(e)); draw(); });
}
export function trackCancel() { if (TRK.job && HOST) HOST.track.cancel(TRK.job.id); }
function onJob(e) {
  var j = TRK.job; if (!j || e.id !== j.id) return;
  if (e.state === 'progress') { j.p = e.p; var b = document.querySelector('[data-trbar]'); if (b) b.style.width = Math.round(e.p * 100) + '%'; return; }
  TRK.job = null;
  if (e.state === 'error') { toast(String(e.data && e.data.message || '追えませんでした')); draw(); return; }
  var c = C(j.cid); if (!c) { draw(); return; }
  var pts = (e.data.pts || []).slice().sort(function (a, b) { return a[0] - b[0]; });
  if (!pts.length) { toast('追えませんでした'); draw(); return; }
  mark();
  /* 前の結果のうち、今回追った範囲は置き換える */
  var lo = pts[0][0], hi = pts[pts.length - 1][0], old = c.track && c.track.pts || [];
  c.track = { box: j.box, pts: old.filter(function (q) { return q[0] < lo - 1e-4 || q[0] > hi + 1e-4; }).concat(pts).sort(function (a, b) { return a[0] - b[0]; }) };
  S.trBox = null; S.trSel = false;
  changed();
  if (e.data.lost != null) toast('見失いました（' + tc(c.start + (e.data.lost - c.in)) + '）。四角を囲み直して、続きから追えます');
  else toast('追跡しました（' + pts.length + ' フレーム）');
}
export function trackClear(c) { if (!c || !c.track) return; mark(); delete c.track; changed(); }

/* ---------- 結果を使う ---------- */
/** 点を減らす（直線で表せる点は省く。tol は % ） */
function simplify(L, tol) {
  if (L.length <= 2) return L.slice();
  var keep = new Array(L.length).fill(false); keep[0] = keep[L.length - 1] = true;
  (function rec(a, b) {
    var best = -1, bi = -1;
    for (var i = a + 1; i < b; i++) { var k = (L[i][0] - L[a][0]) / Math.max(1e-9, L[b][0] - L[a][0]), v = L[a][1] + (L[b][1] - L[a][1]) * k, d = Math.abs(L[i][1] - v); if (d > best) { best = d; bi = i; } }
    if (best > tol) { keep[bi] = true; rec(a, bi); rec(bi, b); }
  })(0, L.length - 1);
  return L.filter(function (_, i) { return keep[i]; });
}
/** 追跡の点を、タイムラインの時刻と画面の位置（%）の列にする */
function pathPct(c) {
  var wh = seqWH(), W = wh[0], H = wh[1];
  return (c.track && c.track.pts || []).map(function (q) {
    var t = c.start + (q[0] - c.in), p = toCanvas(c, t, q[1], q[2], W, H);
    return { t: t, x: (p[0] - W / 2) / W * 100, y: (p[1] - H / 2) / H * 100 };
  }).filter(function (q) { return q.t >= c.start - 1e-6 && q.t <= cEnd(c) + 1e-6; });
}
function toKf(target, list, key, add) {
  var L = simplify(list.map(function (q) { return [q.t, q[key] + add]; }), 0.05);
  return L.map(function (q) { return { t: +(target.in + (q[0] - target.start)).toFixed(4), v: +q[1].toFixed(3) }; });
}
/** ほかのクリップを追従させる：そのクリップの位置（x・y）を、追跡した動きに合わせたキーフレームにする（最初の位置関係を保つ） */
export function followTrack(c, tid) {
  var tg = C(tid); if (!tg) return toast('追従させるクリップを選んでください');
  var L = pathPct(c).filter(function (q) { return q.t >= tg.start - 1e-6 && q.t <= cEnd(tg) + 1e-6; });
  if (L.length < 2) return toast('追跡した時間と、そのクリップの時間が重なっていません');
  mark();
  var dx = valueAt(tg, 'x', L[0].t) - L[0].x, dy = valueAt(tg, 'y', L[0].t) - L[0].y;
  tg.kf = tg.kf || {};
  tg.kf.x = toKf(tg, L, 'x', dx); tg.kf.y = toKf(tg, L, 'y', dy);
  changed();
  toast('「' + (tg.label ? String(tg.label).split('\n')[0] : M(tg.m) ? M(tg.m).n : 'クリップ') + '」を追従させました');
}
/** モザイク・ぼかしで隠す：追跡した四角の大きさの、範囲のある調整レイヤーを、いちばん上の新しいトラックに作る */
export function hideTrack(c, kind) {
  var L = pathPct(c); if (L.length < 2) return toast('先に追跡してください');
  var wh = seqWH(), W = wh[0], H = wh[1], t0 = L[0].t, t1 = L[L.length - 1].t, b = c.track.box || [0.1, 0.1];
  var sz = toCanvas(c, t0, 0.5, 0.5, W, H);
  mark();
  var tr = addTrack('v'), a = { id: uid('c'), tr: tr.id, type: 'adj', start: t0, in: 0, out: Math.max(0.1, t1 - t0), label: kind === 'blur' ? 'ぼかし（追跡）' : 'モザイク（追跡）',
    ccSat: 0, maskW: Math.min(100, +(b[0] * sz[2] / W * 100 * 1.15).toFixed(2)), maskH: Math.min(100, +(b[1] * sz[3] / H * 100 * 1.15).toFixed(2)) };
  if (kind === 'blur') a.fxBlur = 14; else a.fxMosaic = 28;
  a.kf = { x: toKf(a, L, 'x', 0), y: toKf(a, L, 'y', 0) };
  P.clips.push(a); S.sel = [c.id];
  changed();
  toast((kind === 'blur' ? 'ぼかし' : 'モザイク') + 'の調整レイヤーを ' + tr.id + ' に作りました');
}

/* ---------- プレビューの上の表示：四角を囲む・追跡の四角と軌跡 ---------- */
export function drawOverlay() {
  var ov = document.querySelector('canvas[data-trov]'), pg = document.querySelector('.pc canvas[data-prog]');
  if (!ov || !pg) return;
  /* 画面の大きさの設定（CSS の zoom）に左右されないよう、レイアウトの位置で重ねる */
  ov.style.left = pg.offsetLeft + 'px'; ov.style.top = pg.offsetTop + 'px'; ov.style.width = pg.offsetWidth + 'px'; ov.style.height = pg.offsetHeight + 'px';
  if (ov.width !== pg.width || ov.height !== pg.height) { ov.width = pg.width; ov.height = pg.height; }
  var x = ov.getContext('2d'), W = ov.width, H = ov.height, c = C(ov.dataset.trov);
  x.clearRect(0, 0, W, H); if (!c) return;
  x.lineWidth = Math.max(1.5, W / 640); x.strokeStyle = '#ffb454'; x.fillStyle = '#ffb454';
  var t = S.t.edit;
  /* 軌跡（今の時刻の前後 2 秒） */
  (c.track && c.track.pts || []).forEach(function (q, i) { if (i % 2) return; var T0 = c.start + (q[0] - c.in); if (Math.abs(T0 - t) > 2) return; var p = toCanvas(c, t, q[1], q[2], W, H); x.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3); });
  var bx = null;
  if (S.trBox && S.trBox.cid === c.id) bx = S.trBox;
  else { var p0 = trackAt(c, srcTime(c, t)); if (p0 && c.track.box) bx = { u: p0[0], v: p0[1], w: c.track.box[0], h: c.track.box[1] }; }
  if (bx) {
    var a = toCanvas(c, t, bx.u - bx.w / 2, bx.v - bx.h / 2, W, H), b = toCanvas(c, t, bx.u + bx.w / 2, bx.v + bx.h / 2, W, H);
    x.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  }
  if (S.trDrag) { x.setLineDash([6, 4]); x.strokeRect(S.trDrag[0], S.trDrag[1], S.trDrag[2] - S.trDrag[0], S.trDrag[3] - S.trDrag[1]); x.setLineDash([]); }
}
function onDown(e) {
  var ov = e.target.closest && e.target.closest('canvas[data-trov]'); if (!ov || !S.trSel) return;
  var c = C(ov.dataset.trov); if (!c) return;
  e.preventDefault();
  var r = ov.getBoundingClientRect(), k = ov.width / r.width, at = function (ev) { return [(ev.clientX - r.left) * k, (ev.clientY - r.top) * k]; }, p0 = at(e);
  var mv = function (ev) { var p = at(ev); S.trDrag = [Math.min(p0[0], p[0]), Math.min(p0[1], p[1]), Math.max(p0[0], p[0]), Math.max(p0[1], p[1])]; drawOverlay(); };
  var up = function () {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    var d = S.trDrag; S.trDrag = null; if (!d || d[2] - d[0] < 6 || d[3] - d[1] < 6) { drawOverlay(); return; }
    var W = ov.width, H = ov.height, a = fromCanvas(c, S.t.edit, d[0], d[1], W, H), b = fromCanvas(c, S.t.edit, d[2], d[3], W, H);
    S.trBox = { cid: c.id, u: (a[0] + b[0]) / 2, v: (a[1] + b[1]) / 2, w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
    S.trSel = false; draw();
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}

/* 読み込んだときの準備（main.ts が順に呼ぶ） */
export function init() {
  if (HOST && HOST.track) HOST.track.onJob(onJob);
  document.addEventListener('pointerdown', onDown);
  AFTER.push(drawOverlay);
}
