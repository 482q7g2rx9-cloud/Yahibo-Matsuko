// @ts-nocheck
/* ================================================================
   エフェクトページ（M6）：選んだクリップのエフェクトとキーフレーム。
   - 左：エフェクトの一覧（色補正のプリセット・ぼかし・モザイク・周辺を暗く・動きのプリセット）。押すと、選んでいるクリップに付ける
   - 中：プレビュー（番組そのもの。「適用前」はそのクリップの色補正・エフェクトを外して見せる）、キーフレームの操作、
         クリップの長さのタイムライン（プロパティごとのキーフレーム。◇はドラッグで動かせる。選んだプロパティは値の線も出す）
   - 右：エフェクトコントロール（モーション・色補正・ぼかし／モザイク・周辺を暗く・開始トランジション）
   キーフレームの計算は core/keyframes.ts、プレビューの色補正・エフェクトは colorGL.ts、書き出しは matsuko-core の export.rs
   ================================================================ */
import { pw, splitter } from '../panels';
import { C, M, P, T, cEnd, cLen, vTracks } from '../project';
import { S } from '../state';
import { A, TRI, btn, diamond, fsec, h, ibtn, ph, playBtn, tc } from '../util';
import { E, redrawProg, setProg, trPairs } from '../engine';
import { frameSec } from '../projectSettings';
import { changed, mark } from '../store';
import { draw } from '../render';
import { canvasAttrs } from '../projectSettings';
import { COLOR_PRESETS } from '../../core/color';
import { KF_PROPS, MOTION_PRESETS, kfIndex, kfList, kfTimes, srcTime, valueAt } from '../../core/keyframes';
import { TRANSITIONS } from '../transitions';
import { primary } from '../editOps';
import { PROPS, colorForm, maskForm, numRow, titleAnimForm } from './edit';
import { R } from './media';
import { TITLE_IN, TITLE_OUT } from '../titleAnim';
import { HOST } from '../desktop';
import { TRK, isVideoClip } from '../tracking';

export var KF_LABEL = { x: '位置 X', y: '位置 Y', scale: '拡大率', rot: '回転', op: '不透明度' };

/* エフェクトの一覧：[分類, [[id, 名前, 見本の色]...]] */
export function fxLib() {
  return [
    ['色補正', COLOR_PRESETS.map(function (p) { return ['cc:' + p.id, p.name, { warm: 'linear-gradient(135deg,#f6c27a,#e07b39)', cool: 'linear-gradient(135deg,#9fd3f5,#3b7bd1)', vivid: 'linear-gradient(135deg,#ff5f6d,#ffc371)', soft: 'linear-gradient(135deg,#c9bfb2,#8e8a84)', bright: 'linear-gradient(135deg,#fff3c4,#f5c542)', night: 'linear-gradient(135deg,#3a4a7a,#141a33)', mono: 'linear-gradient(135deg,#eee,#333)' }[p.id]]; })],
    ['ぼかし・モザイク', [['blur', 'ぼかし', 'radial-gradient(circle,#9ab 0,#cde 70%)'], ['mosaic', 'モザイク', 'repeating-conic-gradient(#889 0 25%,#bbc 0 50%) 0 0/8px 8px']]],
    ['スタイル', [['vig', '周辺を暗く', 'radial-gradient(circle,#ddd 30%,#222 100%)']]],
    ['テロップの登場', TITLE_IN.slice(1).map(function (x) { return ['ti:' + x[0], x[1], 'linear-gradient(90deg,transparent 0 20%,var(--ac) 20% 80%,transparent 80%),var(--bg4)']; })],
    ['テロップの退場', TITLE_OUT.slice(1).map(function (x) { return ['to:' + x[0], x[1], 'linear-gradient(90deg,var(--ac) 0 60%,transparent 60%),var(--bg4)']; })],
    ['動き（キーフレーム）', MOTION_PRESETS.map(function (p) { return ['mo:' + p.id, p.name, 'linear-gradient(90deg,var(--bg4) 0 38%,var(--ac) 38% 62%,var(--bg4) 62%)']; })],
  ];
}

/** エフェクトを付けるクリップ：選んでいる映像トラックのクリップ。なければ、再生ヘッドの位置でいちばん上に見えているもの */
export function fxClip() {
  var c = primary(), t = c && T(c.tr);
  if (c && t && t.kind === 'v') return c;
  var L = vTracks();
  for (var i = 0; i < L.length; i++) {
    if (L[i].hide) continue;
    var hit = P.clips.filter(function (x) { return x.tr === L[i].id && S.t.edit >= x.start - 1e-6 && S.t.edit < cEnd(x); })[0];
    if (hit) return hit;
  }
  return null;
}
function clipName(c) { if (!c) return ''; if (c.type === 'title') return c.label ? String(c.label).split('\n')[0] : 'テロップ'; if (c.type === 'adj') return '調整レイヤー'; var m = M(c.m); return m ? m.n : ''; }
/** 付けられるエフェクトか：色補正・ぼかしなどは映像・画像と調整レイヤー、動きは映像・画像・テロップ（クレジット以外） */
export function canFx(c, id) {
  if (!c) return false;
  var m = c.m && M(c.m), pic = c.type === 'media' && m && (m.k === '映像' || m.k === '画像');
  if (id.indexOf('mo:') === 0) return pic || c.type === 'title' && c.st !== 'credit';
  if (id.indexOf('ti:') === 0 || id.indexOf('to:') === 0) return c.type === 'title' && c.st !== 'credit';
  return pic || c.type === 'adj';
}
export function canKf(c) { return kfPropsOf(c).length > 0; }
/** 選んでいるプロパティ（そのクリップで選べないものなら最初のもの） */
export function curProp(c) { var L = kfPropsOf(c); return L.indexOf(S.kfProp) >= 0 ? S.kfProp : L[0] || 'scale'; }
/** キーフレームを付けられるプロパティ（調整レイヤーは、範囲があるときの位置だけ） */
export function kfPropsOf(c) { if (!c) return []; if (c.type === 'media' || c.type === 'title' && c.st !== 'credit') return KF_PROPS.slice(); if (c.type === 'adj' && ((c.maskW != null && c.maskW < 100) || (c.maskH != null && c.maskH < 100))) return ['x', 'y']; return []; }

/* 左：エフェクトの一覧 */
function libPanel(c) {
  var q = (S.fxq || '').trim();
  return fxLib().map(function (g) {
    var items = g[1].filter(function (e) { return !q || e[1].indexOf(q) >= 0; });
    if (!items.length) return '';
    var closed = !!S.fxClosed[g[0]] && !q;
    return '<button' + A('fxg', g[0]) + ' aria-expanded="' + !closed + '" style="width:100%;height:30px;display:flex;align-items:center;gap:10px;padding:0 16px;border:0;border-top:1px solid var(--dv);border-bottom:1px solid var(--dv);background:var(--bg2);color:var(--tx2)">' + (closed ? TRI.rr : TRI.d) + '<span>' + h(g[0]) + '</span></button>' +
      (closed ? '' : items.map(function (e) {
        var ok = canFx(c, e[0]);
        return '<div class="li' + (S.fx === e[0] ? ' selr' : '') + '" role="button" tabindex="0"' + A('fxApply', e[0]) + ' title="' + h(ok ? e[1] + ' を付ける' : 'このクリップには付けられません') + '" style="display:flex;align-items:center;gap:10px;height:34px;padding:0 16px' + (ok ? '' : ';opacity:.45') + '"><span style="width:24px;height:24px;border-radius:3px;background:' + e[2] + ';border:1px solid var(--bd2);flex:none"></span><span>' + h(e[1]) + '</span></div>';
      }).join(''));
  }).join('');
}

/* 中：クリップの長さのタイムライン。行はプロパティごと、◇はキーフレーム */
function kfTimeline(c) {
  if (!c) return '<div class="tl" style="display:flex;align-items:center;justify-content:center"><span class="mu">クリップがありません</span></div>';
  var a = c.start, b = cEnd(c), len = Math.max(0.01, b - a), pct = function (t) { return Math.max(0, Math.min(100, (t - a) / len * 100)); };
  var y = 36, hd = '<div class="hd tch" data-time="fx">' + tc(S.t.edit) + '</div>', ar = '', ru = '<div class="ru"></div>', props = kfPropsOf(c), cur = curProp(c);
  for (var i = 0; i <= 4; i++) ru += '<div class="rl" style="left:' + (i * 25) + '%">' + tc(a + len * i / 4) + '</div>';
  props.forEach(function (p) {
    var on = p === cur, hgt = on ? 64 : 28, L = kfList(c, p) || [];
    hd += '<div class="hd" style="top:' + y + 'px;height:' + hgt + 'px' + (on ? ';color:var(--ac)' : '') + '" role="button" tabindex="0"' + A('kfProp', p) + '><span>' + h(KF_LABEL[p]) + '</span></div>';
    ar += '<div class="lane" data-kfarea="' + p + '" style="top:' + y + 'px;height:' + hgt + 'px"></div>';
    /* 選んだプロパティは、値の線（クリップの長さを 80 に分けて計算） */
    if (on && L.length) {
      var lo = Infinity, hi = -Infinity, pts = [];
      for (var k = 0; k <= 80; k++) { var t = a + len * k / 80, v = valueAt(c, p, t); pts.push([k / 80 * 100, v]); lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
      ar += '<svg style="position:absolute;left:0;top:' + (y + 6) + 'px;width:100%;height:' + (hgt - 12) + 'px;pointer-events:none" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="var(--ac)" stroke-width="1.5" vector-effect="non-scaling-stroke" points="' + pts.map(function (q) { return q[0].toFixed(2) + ',' + (100 - (q[1] - lo) / (hi - lo) * 100).toFixed(2); }).join(' ') + '"/></svg>';
    }
    L.forEach(function (k, j) {
      var T0 = a + (k.t - c.in), at = Math.abs(T0 - S.t.edit) < 0.02;
      ar += '<div class="kd" data-kfd="' + p + '|' + j + '" title="' + h(KF_LABEL[p]) + '　' + tc(T0) + '　' + (+k.v.toFixed(2)) + '" style="left:' + pct(T0) + '%;top:' + (y + hgt / 2 - 6) + 'px;cursor:ew-resize">' + diamond(at) + '</div>';
    });
    y += hgt + 4;
  });
  if (!props.length) ar += '<div class="mu" style="position:absolute;left:16px;top:48px">このクリップにはキーフレームを付けられません</div>';
  var ph0 = pct(S.t.edit);
  ar += '<div class="phl" data-fxhead data-a="' + a + '" data-b="' + b + '" style="left:' + ph0 + '%"></div><div class="phk" data-fxhead data-a="' + a + '" data-b="' + b + '" style="left:' + ph0 + '%"></div>';
  return '<div class="tl" data-fxtl data-s="' + a + '" data-e="' + b + '">' + hd + '<div class="ar" data-fxar>' + ru + ar + '</div></div>';
}

/* キーフレームの操作の列 */
function kfBar(c) {
  var ok = canKf(c), p = curProp(c), i = ok ? kfIndex(c, p, srcTime(c, S.t.edit)) : -1, k = i >= 0 ? kfList(c, p)[i] : null, e = k ? k.e || 'linear' : null;
  var dis = ok ? '' : ' disabled';
  var mode = function (v, l, aria) { return '<button class="b s' + (e === v ? ' on' : '') + '"' + A('kfEase', v) + (k ? '' : ' disabled') + ' aria-label="' + aria + '" title="' + aria + '">' + l + '</button>'; };
  return '<div class="row" style="height:40px;flex:none;gap:6px;padding:0 12px;border-bottom:1px solid var(--dv)"><span style="font-weight:500;margin-right:4px;white-space:nowrap">キーフレーム</span>' +
    '<button class="b s" aria-label="前のキーフレーム" title="前のキーフレーム"' + A('kfPrev') + dis + '>' + TRI.l + '</button>' +
    '<button class="b s' + (k ? ' on' : '') + '" aria-label="キーフレームを追加／削除" title="キーフレームを追加／削除"' + A('kfToggle') + dis + '>' + diamond(!!k) + '追加／削除</button>' +
    '<button class="b s" aria-label="次のキーフレーム" title="次のキーフレーム"' + A('kfNext') + dis + '>' + TRI.r + '</button><span class="vsep"></span>' +
    mode('linear', 'リニア', '一定の速さで変える') + mode('ease', 'ベジェ', '始めと終わりをゆっくり') + mode('hold', '停止', '次のキーフレームまで変えない') + '<span class="vsep"></span>' +
    mode('in', 'イン', 'だんだん速く') + mode('out', 'アウト', 'だんだん遅く') +
    '<span class="grow"></span><select class="inp" data-in="kfProp" aria-label="対象プロパティ" style="height:26px"' + dis + '>' + kfPropsOf(c).map(function (q) { return '<option value="' + q + '"' + (q === p ? ' selected' : '') + '>' + KF_LABEL[q] + '</option>'; }).join('') + '</select>' +
    btn('すべて外す', 'kfClear', '', 's', 'このプロパティのキーフレームをすべて外す') + '</div>';
}

/* トラッキング（デスクトップ版・映像のクリップ）：囲む → 追う → 追従させる・隠す */
function trackForm(c) {
  var run = TRK.job && TRK.job.cid === c.id, L = c.track && c.track.pts || [], has = L.length > 1, box = S.trBox && S.trBox.cid === c.id;
  var range = has ? tc(c.start + (L[0][0] - c.in)) + '〜' + tc(c.start + (L[L.length - 1][0] - c.in)) : '';
  var others = P.clips.filter(function (x) { var t = T(x.tr); return x !== c && t && t.kind === 'v' && x.type !== 'adj' && x.start < cEnd(c) && cEnd(x) > c.start; });
  var name = function (x) { return x.type === 'title' ? 'テロップ：' + String(x.label || '').split('\n')[0] : (M(x.m) || {}).n || x.id; };
  return '<div style="display:flex;flex-direction:column;gap:8px;padding:4px 0">' +
    '<div class="row" style="gap:6px;flex-wrap:wrap">' + btn('範囲を囲む', 'trSel', '', 's' + (S.trSel ? ' on' : ''), 'プレビューで追うものを囲む') + (box ? '<span class="t-ok">囲みました</span>' : '') + '</div>' +
    '<div class="row" style="gap:6px">' + btn(TRI.l + '後方へ', 'trGo', 'back', 's', '後方へ追跡') + btn('止める', 'trStop', '', 's') + btn('前方へ' + TRI.r, 'trGo', 'fwd', 's', '前方へ追跡') + '</div>' +
    (run ? '<div class="row" style="gap:8px"><span class="prog" style="flex:1"><i data-trbar style="width:' + Math.round(TRK.job.p * 100) + '%"></i></span><span class="t-ac">追跡中</span></div>' :
      '<div class="fg"><span>状態</span><span>' + (has ? '<span class="t-ok">追跡済み</span>　' + range : '<span class="mu">なし</span>') + '</span></div>') +
    (has ? '<div class="fg"><span>追従先</span><select class="inp" data-in="trTarget" aria-label="追従させるクリップ"><option value="">選ぶ…</option>' + others.map(function (x) { return '<option value="' + x.id + '"' + (S.trTarget === x.id ? ' selected' : '') + '>' + h(name(x)) + '</option>'; }).join('') + '</select></div>' +
      '<div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">' + btn('追従させる', 'trFollow', '', 's') + btn('モザイクで隠す', 'trHide', 'mosaic', 's') + btn('ぼかしで隠す', 'trHide', 'blur', 's') + btn('追跡を消す', 'trClear', '', 's') + '</div>' : '') + '</div>';
}

/* 右：エフェクトコントロール */
function controls(c) {
  if (!c) return '<div class="mu" style="padding:16px">再生ヘッドの位置にクリップがありません</div>';
  var m = c.m && M(c.m), pic = c.type === 'media' && m && (m.k === '映像' || m.k === '画像'), out = '';
  if (HOST && HOST.track && isVideoClip(c)) out += fsec('track', 'トラッキング', null, trackForm(c), 1);
  if (c.type === 'adj') out += fsec('mask', '範囲', null, maskForm(c), 1);
  if (c.type === 'title' && c.st !== 'credit') out += fsec('tanim', 'アニメーション', null, titleAnimForm(c), 1);
  if (c.type !== 'adj' && canKf(c)) out += fsec('fxmotion', 'モーション', null, ['x', 'y', 'scale', 'rot', 'op'].map(function (p) { return numRow(KF_LABEL[p], c, p); }).join('') +
    '<div class="row" style="justify-content:flex-end;padding-top:8px">' + btn('元に戻す', 'mreset', c.id, 's') + '</div>', 1);
  if (pic || c.type === 'adj') {
    out += fsec('color', '色補正', null, colorForm(c), 1);
    out += fsec('fxblur', 'ぼかし・モザイク', null, numRow('ぼかし', c, 'fxBlur') + numRow('モザイク', c, 'fxMosaic'), 1);
    out += fsec('fxvig', '周辺を暗く', null, numRow('強さ', c, 'fxVig'), 1);
  }
  var tq = c.type === 'media' && trPairs().filter(function (q) { return q.b === c; })[0];
  out += fsec('tin', '開始トランジション', null, tq ? '<div class="fg"><span>種類</span><select class="inp" data-in="trk" aria-label="トランジションの種類">' + TRANSITIONS.map(function (x) { return '<option value="' + x.id + '"' + (x.id === tq.k ? ' selected' : '') + '>' + h(x.name) + '</option>'; }).join('') + '</select></div>' + numRow('長さ', c, 'xd') + '<div class="row" style="justify-content:flex-end;padding-top:8px">' + btn('外す', 'trDel', c.id, 's') + '</div>' : '<div class="mu" style="padding:6px 0">なし</div>', 1);
  return out;
}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
/* クリップの長さのタイムライン：押した位置へ再生ヘッドを動かす（そのまま左右に動かせる）。◇は左右にドラッグでキーフレームの時刻を変える */
function onDown(e) {
  if (S.page !== 'fx' || e.button !== 0) return;
  var ar = e.target.closest && e.target.closest('[data-fxar]'); if (!ar) return;
  var tl = ar.closest('[data-fxtl]'), a = +tl.dataset.s, b = +tl.dataset.e, r = ar.getBoundingClientRect(), c = fxClip(); if (!c) return;
  var fr = frameSec() || 1 / 30, tAt = function (x) { return a + (b - a) * Math.max(0, Math.min(1, (x - r.left) / r.width)); };
  e.preventDefault();
  var d = e.target.closest('[data-kfd]'), moved = false, x0 = e.clientX;
  if (d) {
    var q = d.dataset.kfd.split('|'), p = q[0], j = +q[1], L = c.kf && c.kf[p], k = L && L[j]; if (!k) return;
    var lo = j > 0 ? L[j - 1].t + fr : -1e9, hi = j < L.length - 1 ? L[j + 1].t - fr : 1e9;
    var mv = function (ev) {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      if (!moved) { mark(); moved = true; }
      var T0 = Math.round(tAt(ev.clientX) / fr) * fr, s0 = Math.max(lo, Math.min(hi, c.in + (T0 - c.start)));
      k.t = +s0.toFixed(4); d.style.left = Math.max(0, Math.min(100, (c.start + (k.t - c.in) - a) / Math.max(0.01, b - a) * 100)) + '%';
      setProg(c.start + (k.t - c.in));
    };
    var up = function () { removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      if (moved) changed(); else { S.kfProp = p; setProg(c.start + (k.t - c.in)); draw(); } };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
    return;
  }
  setProg(tAt(e.clientX));
  var mv2 = function (ev) { setProg(tAt(ev.clientX)); };
  var up2 = function () { removeEventListener('pointermove', mv2); removeEventListener('pointerup', up2); draw(); };
  addEventListener('pointermove', mv2); addEventListener('pointerup', up2);
}

export function init() {
  document.addEventListener('pointerdown', onDown);
  R.fx = function () {
    var c = fxClip(), after = S.ba !== 'before';
    E.noFx = after || !c ? null : c.id;
    if (c && S.sel.indexOf(c.id) < 0) S.sel = [c.id];
    return '<div class="pn l" style="width:' + pw('fxL') + 'px">' + splitter('fxL', 'l') + ph('エフェクト') +
      '<div style="padding:10px 12px"><input class="inp" type="search" placeholder="エフェクトを検索" aria-label="エフェクトを検索" data-in="fxq" value="' + h(S.fxq || '') + '" style="width:100%"></div><div class="scroll">' + libPanel(c) + '</div></div>' +
      '<div class="pc">' + ph('プレビュー', '<span class="x">' + h(clipName(c)) + '</span><span class="seg">' + btn('適用前', 'ba', 'before', 's' + (after ? '' : ' on')) + btn('適用後', 'ba', 'after', 's' + (after ? ' on' : '')) + '</span>') +
      '<div class="mon" style="height:calc(290px + var(--xh,0px)*.5)"><canvas data-prog ' + canvasAttrs() + ' style="height:calc(270px + var(--xh,0px)*.5);width:auto;aspect-ratio:var(--ar,16/9);max-width:100%;object-fit:contain;display:block"></canvas>' +
      (c && isVideoClip(c) && HOST ? '<canvas data-trov="' + c.id + '" style="position:absolute;' + (S.trSel ? 'cursor:crosshair' : 'pointer-events:none') + '"></canvas>' : '') + '</div>' +
      '<div class="tp"><span class="tc" data-time="edit">' + tc(S.t.edit) + '</span><span class="mid">' + ibtn('toStart', '前のカットへ', 'fxPrevCut') + playBtn(E.playing) + ibtn('nextCut', '次のカットへ', 'fxNextCut') + '</span><span class="end"></span></div>' +
      kfBar(c) + kfTimeline(c) + '</div>' +
      '<div class="pn r" style="width:' + pw('fxR') + 'px">' + splitter('fxR', 'r') + ph('エフェクトコントロール', '<span class="x">' + h(clipName(c)) + '</span>') + '<div class="scroll">' + controls(c) + '</div></div>';
  };
}
