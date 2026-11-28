// @ts-nocheck
// M5：自動更新（デスクトップ版）とログ。
// 起動して少ししたら新しい版を確かめ（環境設定で止められる）、あれば知らせる。ヘルプ → 更新を確認… で画面を出し、
// 「更新する」で入れ直して起動し直す。画面のエラーは、デスクトップ版のログ（matsuko.log）に書く。
import { S } from './state';
import { HOST } from './desktop';
import { toast } from './menus';
import { PREF } from './prefs';
import { A, btn, h } from './util';

var U = null; /* {enabled,current} */
var AV = null; /* 見つかった版 */
var BUSY = false;

function dlgHtml(inner) {
  var d = document.getElementById('dlg');
  d.innerHTML = '<div class="dlg upd" role="dialog" aria-modal="true" aria-labelledby="dlgT"><div class="ph2"><h2 id="dlgT">更新</h2></div>' + inner + '</div>';
  d.hidden = false;
}
function render(state, extra) {
  var cur = U ? U.current : '';
  if (state === 'checking') return dlgHtml('<p>確認しています…</p>');
  if (state === 'none') return dlgHtml('<p>お使いの版（' + h(cur) + '）が最新です。</p><div class="row" style="justify-content:flex-end">' + btn('閉じる', 'dlgNo', '', 'pri') + '</div>');
  if (state === 'error') return dlgHtml('<p class="t-er">' + h(extra || '') + '</p><div class="row" style="justify-content:flex-end">' + btn('閉じる', 'dlgNo', '', 'pri') + '</div>');
  if (state === 'off') return dlgHtml('<p>このビルドには、更新の機能が入っていません。</p><div class="row" style="justify-content:flex-end">' + btn('閉じる', 'dlgNo', '', 'pri') + '</div>');
  if (state === 'found') return dlgHtml('<p>新しい版 <b>' + h(AV.version) + '</b> があります（いまの版 ' + h(cur) + '）。</p>' +
    (AV.notes ? '<div class="box" style="max-height:220px;overflow:auto;white-space:pre-wrap;margin:10px 0">' + h(AV.notes) + '</div>' : '') +
    '<div class="row" style="justify-content:flex-end;gap:8px">' + btn('あとで', 'dlgNo', '', 'sec') + btn('更新して起動し直す', 'updInstall', '', 'pri') + '</div>');
  if (state === 'installing') return dlgHtml('<p>' + h(AV.version) + ' を入れています…</p><div class="prog" style="width:100%"><i data-updp style="width:' + Math.round((extra || 0) * 100) + '%"></i></div>');
}

/* ヘルプ → 更新を確認… */
export function checkUpdate(quiet) {
  if (!HOST || !HOST.update || BUSY) return;
  var go = function () {
    if (!U.enabled) { if (!quiet) render('off'); return; }
    if (!quiet) render('checking');
    HOST.update.check().then(function (a) {
      AV = a;
      if (a) { if (quiet) toast('新しい版 ' + a.version + ' があります（ヘルプ → 更新を確認…）'); else render('found'); }
      else if (!quiet) render('none');
    }).catch(function (e) { if (!quiet) render('error', String(e)); });
  };
  if (U) go(); else HOST.update.info().then(function (i) { U = i; go(); }).catch(function () {});
}
export function installUpdate() {
  if (!AV || BUSY) return;
  BUSY = true; render('installing', 0);
  HOST.update.install().catch(function (e) { BUSY = false; render('error', String(e)); });
}

export function init() {
  if (!HOST || !HOST.update) return;
  HOST.update.onProgress(function (e) { var i = document.querySelector('[data-updp]'); if (i) i.style.width = Math.round(e.p * 100) + '%'; });
  HOST.update.info().then(function (i) { U = i; if (i.enabled && PREF.autoUpdate) setTimeout(function () { checkUpdate(true); }, 8000); }).catch(function () {});
  /* 画面のエラーをログに残す（不具合の報告に使う） */
  var last = '', n = 0;
  var put = function (lv, msg) { if (msg === last || n > 200) return; last = msg; n++; HOST.log.write(lv, msg).catch(function () {}); };
  addEventListener('error', function (e) { put('error', (e.message || '') + (e.filename ? ' @' + e.filename.split('/').pop() + ':' + e.lineno : '') + (e.error && e.error.stack ? '\n' + e.error.stack : '')); });
  addEventListener('unhandledrejection', function (e) { var r = e.reason; put('error', 'Promise: ' + (r && r.stack ? r.stack : String(r))); });
}
