// @ts-nocheck
// プロジェクト設定（プロジェクト → プロジェクト設定…）。設定はプロジェクトの中（P.settings）に保存する。
//   シーケンス：解像度・フレームレート（プレビューの縦横の比率、タイムコード、1フレーム送りの幅、書き出し前のチェックに使う）
//   プレビュー：画質（プレビューを描く細かさ）
//   プロキシ  ：高さ（デスクトップ版。これから作るプロキシに使う）
//   音声      ：サンプリング周波数（書き出しに使う）
// M4（台本連携）では、ここに「台本連携」の分類を足す（docs/tauri-plan.md）。
import { P } from './project';
import { S } from './state';
import { A, btn, h, setTcFps } from './util';
import { saveP } from './store';
import { HOST, JOBS, mediaUrl } from './desktop';
import { E, dropEl } from './engine';
import { draw } from './render';
import { closeMenu, toast } from './menus';
import { prefRow } from './prefs';

export var RES_OPTS = [['1920×1080', '1920 × 1080（フル HD）'], ['3840×2160', '3840 × 2160（4K）'], ['1280×720', '1280 × 720（HD）'], ['1080×1920', '1080 × 1920（縦長・SNS）'], ['1080×1080', '1080 × 1080（正方形）']];
export var FPS_OPTS = ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'];
export var PQ_OPTS = [['high', '高画質', '1920 × 1080 の細かさで描く（重い）'], ['std', '標準', '960 × 540 の細かさで描く'], ['light', '軽量', '480 × 270 の細かさで描く（古いパソコン向け）']];
export var PROXY_OPTS = [[540, '540p（軽い）'], [720, '720p（標準）'], [1080, '1080p（きれい）']];
export var AR_OPTS = [[48000, '48 kHz（動画の標準）'], [44100, '44.1 kHz（音楽 CD と同じ）']];

/* いまの設定（足りないところは初期値） */
export function ps() {
  var s = P.settings || {};
  return { res: s.res || '1920×1080', fps: s.fps || '29.97', pq: s.pq || 'std', proxy: s.proxy || 720, ar: s.ar || 48000 };
}
/* シーケンスの幅と高さ */
export function seqWH() { var r = ps().res.split('×'); return [+r[0] || 1920, +r[1] || 1080]; }
/* 1フレームの長さ（秒） */
export function frameSec() { var f = parseFloat(ps().fps) || 30; return 1 / f; }
/* プレビューの canvas の大きさ（画質と、シーケンスの縦横の比率から） */
export function canvasAttrs() {
  var wh = seqWH(), base = { high: 1920, std: 960, light: 480 }[ps().pq] || 960, w, hh;
  if (wh[0] >= wh[1]) { w = base; hh = Math.round(base * wh[1] / wh[0]); } else { hh = base; w = Math.round(base * wh[0] / wh[1]); }
  return 'width="' + w + '" height="' + hh + '"';
}
/* プレビューの画質の名前（編集ページの再生操作の右に出す） */
export function pqLabel() { return { high: '高画質', std: '標準画質', light: '軽量' }[ps().pq] || '標準画質'; }

/* 設定を画面に反映する（プロジェクトを開いたとき・設定を変えたとき） */
export function applyProjectSettings() {
  var wh = seqWH(), a = document.getElementById('app');
  if (a) a.style.setProperty('--ar', wh[0] + ' / ' + wh[1]);
  setTcFps(parseFloat(ps().fps) || 30);
}

export function openProjectSettings(tab) { closeMenu(); S.pstab = tab || S.pstab || 'seq'; renderProjectSettings(); }

function seg(key, opts, cur) {
  return '<span class="seg">' + opts.map(function (o) { return btn(h(o[1]), 'psSet', key + '|' + o[0], 's' + (String(cur) === String(o[0]) ? ' on' : '')); }).join('') + '</span>';
}
function select(key, opts, cur, label) {
  return '<select class="inp" data-ps="' + key + '" aria-label="' + h(label) + '" style="min-width:220px">' +
    opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o + ' fps'; return '<option value="' + h(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + h(t) + '</option>'; }).join('') + '</select>';
}

export function renderProjectSettings() {
  var d = document.getElementById('dlg'), t = S.pstab, s = ps(), body = '';
  var tabs = [['seq', 'シーケンス'], ['preview', 'プレビュー']].concat(HOST ? [['proxy', 'プロキシ']] : []).concat([['audio', '音声']]);
  if (!tabs.some(function (x) { return x[0] === t; })) t = S.pstab = 'seq';
  if (t === 'seq') body = '<h3>シーケンス</h3>' +
    prefRow('解像度', select('res', RES_OPTS, s.res, '解像度'), 'プレビューの縦横の比率になります。書き出しの解像度がこれと違う比率のときは、書き出し前のチェックで知らせます。') +
    prefRow('フレームレート', select('fps', FPS_OPTS, s.fps, 'フレームレート'), 'タイムコードと、1フレームずつ動かすときの幅に使います。日本のテレビ放送は 29.97 fps です。');
  else if (t === 'preview') body = '<h3>プレビュー</h3>' +
    prefRow('画質', seg('pq', PQ_OPTS, s.pq), PQ_OPTS.map(function (o) { return o[1] + '：' + o[2]; }).join('<br>') + '<br>再生が途切れるときは、軽くしてください。書き出しの画質は変わりません。');
  else if (t === 'proxy') body = '<h3>プロキシ</h3>' +
    prefRow('プロキシの高さ', seg('proxy', PROXY_OPTS, s.proxy), '重い素材（4K など）を編集するときに使う、軽い動画の大きさです。これから作るプロキシに使います。書き出しには元の素材を使うので、書き出しの画質は変わりません。') +
    prefRow('作り直す', btn('いまのプロキシを作り直す', 'psProxy', '', 's'), '設定を変えたあと、作ってあるプロキシもこの高さにしたいときに押します。作っている間も編集を続けられます。');
  else body = '<h3>音声</h3>' +
    prefRow('サンプリング周波数', seg('ar', AR_OPTS, s.ar), '書き出す音声の細かさです。ふつうは 48 kHz のままでかまいません。');
  d.innerHTML = '<div class="dlg prefs" role="dialog" aria-modal="true" aria-labelledby="dlgT"><div class="ph2"><h2 id="dlgT">プロジェクト設定</h2>' + btn('閉じる', 'dlgNo', '', 's') + '</div><div class="pbody"><nav class="pnav" aria-label="設定の分類">' +
    tabs.map(function (x) { return '<button' + (t === x[0] ? ' aria-current="true"' : '') + A('psTab', x[0]) + '>' + x[1] + '</button>'; }).join('') + '</nav><div class="pcont">' + body +
    '<div class="mu" style="margin-top:16px;line-height:1.6">この設定はプロジェクトに保存されます（プロジェクトごとに違う設定にできます）。</div></div></div></div>';
  d.hidden = false;
  [].forEach.call(d.querySelectorAll('[data-ps]'), function (el) { el.addEventListener('change', function () { setPs(el.dataset.ps, el.value); }); });
}

/* 設定を1つ変える */
export function setPs(key, v) {
  var s = P.settings = Object.assign({}, P.settings || {});
  s[key] = key === 'proxy' || key === 'ar' ? +v : v;
  applyProjectSettings(); saveP(); draw(); renderProjectSettings();
}

/* デスクトップ版：作ってあるプロキシを、いまの高さで作り直す */
export function rebuildProxies() {
  if (!HOST) return;
  var L = P.media.filter(function (m) { return m.file && m.np && !m.missing && m.path; });
  if (!L.length) return toast('作り直すプロキシはありません');
  HOST.media.cancel(L.map(function (m) { return m.id; }));
  L.forEach(function (m) {
    m.px = 0; delete m.proxyPath; m.url = mediaUrl(m);
    Object.keys(E.els).forEach(function (id) { var c = P.clips.find(function (x) { return x.id === id; }); if (c && c.m === m.id) dropEl(id); });
    JOBS[m.id] = JOBS[m.id] || {}; JOBS[m.id].proxy = 0;
    HOST.media.process([{ id: m.id, path: m.path, kind: m.k, duration: m.d || 0, proxy: true, proxyHeight: ps().proxy }]);
  });
  saveP(); draw(); toast(L.length + '件のプロキシを ' + ps().proxy + 'p で作り直しています');
}
