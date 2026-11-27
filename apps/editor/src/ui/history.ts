// @ts-nocheck
// 変更履歴・復元（docs/tauri-plan.md の M2）。
// 編集して保存するたびに、前の写しから 2 分たっていれば写しを残す。開いたとき・復元する前にも残す。
// 残す場所：デスクトップ版はプロジェクトフォルダーの history.sqlite、ブラウザ版は IndexedDB の history。
import { P, setP } from './project';
import { S } from './state';
import { btn, h } from './util';
import { IDB, changed, mark } from './store';
import { HOST } from './desktop';
import { E, dropEl } from './engine';
import { ask, toast } from './menus';
import { KIND_LABEL, dueForSnapshot, formatTime, restoreFrom, sameContent, slimForSnapshot, summarize, toPrune } from '../core/history';

/* 前に残した写しと、その時刻（同じ中身なら残さない・間隔をあける） */
var last = null, lastAt = null;

/* 写しの読み書き：デスクトップ版は Rust（SQLite）、ブラウザ版は IndexedDB */
var store = {
  add: function (at, kind, summary, data) {
    if (HOST) return HOST.history.add(at, kind, summary, data);
    return IDB.op('history', 'readwrite', function (st) { return st.add({ at: at, kind: kind, summary: summary, data: data }); });
  },
  list: function () {
    if (HOST) return HOST.history.list();
    return IDB.op('history', 'readonly', function (st) { return st.getAll(); }).then(function (all) {
      return (all || []).map(function (r) { return { id: r.id, at: r.at, kind: r.kind, summary: r.summary }; }).sort(function (a, b) { return b.at - a.at || b.id - a.id; });
    });
  },
  get: function (id) {
    if (HOST) return HOST.history.get(id);
    return IDB.op('history', 'readonly', function (st) { return st.get(id); }).then(function (r) { return r ? r.data : null; });
  },
  del: function (ids) {
    if (!ids.length) return Promise.resolve();
    if (HOST) return HOST.history.del(ids);
    return IDB.op('history', 'readwrite', function (st) { ids.forEach(function (id) { st.delete(id); }); return null; });
  },
};

/* 残せるか：デスクトップ版はプロジェクトを開いているとき、ブラウザ版は IndexedDB が使えるとき */
function ready() { return HOST ? !!HOST.project.current : !!(IDB && IDB.db); }

/* プロジェクトを開いたとき・切り替えたときに呼ぶ（前のプロジェクトの写しと比べないように） */
export function historyReset() { last = null; lastAt = null; }

/* 写しを残す（kind：auto は間隔がたったときだけ、open・restore はいつでも） */
export function historyTick(kind) {
  kind = kind || 'auto';
  if (!ready()) return Promise.resolve(null);
  var now = Date.now();
  if (kind === 'auto' && !dueForSnapshot(lastAt, now)) return Promise.resolve(null);
  var s = slimForSnapshot(P);
  if (kind !== 'restore' && sameContent(last, s)) return Promise.resolve(null);
  last = s; lastAt = now;
  return Promise.resolve(store.add(now, kind, summarize(P), s)).then(function (id) {
    return store.list().then(function (L) { return store.del(toPrune(L)); }).then(function () { return id; });
  }).catch(function () { return null; });
}

/* 一覧の窓 */
export function openHistory() {
  if (!ready()) return toast(HOST ? 'プロジェクトを開くと、変更履歴が残るようになります' : 'このブラウザでは変更履歴を使えません');
  var d = document.getElementById('dlg');
  d.innerHTML = '<div class="dlg hist" role="dialog" aria-modal="true" aria-labelledby="dlgT"><h2 id="dlgT">変更履歴・復元</h2>' +
    '<div class="hlist" data-hlist><div class="mu" style="padding:16px">読み込んでいます…</div></div>' +
    '<div class="row" style="justify-content:flex-end;margin-top:16px">' + btn('閉じる', 'dlgNo', '', 'pri') + '</div></div>';
  d.hidden = false;
  d.querySelector('[data-a="dlgNo"]').focus();
  Promise.resolve(store.list()).then(function (L) {
    var box = d.querySelector('[data-hlist]');
    if (!box) return;
    box.innerHTML = L.length ? L.map(function (r) {
      return '<div class="hsnap"><span>' + h(formatTime(r.at)) + '</span><span class="chip ' + (r.kind === 'auto' ? 'c-mu' : 'c-in') + '">' + h(KIND_LABEL[r.kind] || r.kind) + '</span>' +
        '<span class="t2">' + h(r.summary) + '</span>' + btn('復元', 'hRestore', r.id + '|' + r.at, 's') + '</div>';
    }).join('') : '<div class="mu" style="padding:16px">まだ履歴がありません</div>';
  }).catch(function (e) {
    var box = d.querySelector('[data-hlist]');
    if (box) box.innerHTML = '<div class="t-wn" style="padding:16px">変更履歴を読み込めませんでした：' + h(String(e)) + '</div>';
  });
}

/* 写しに戻す（いまの状態は「復元する前」として残し、Ctrl+Z でも戻せるようにする） */
export function restoreHistory(v) {
  var p = String(v).split('|'), id = +p[0], at = +p[1];
  ask('この時点に戻す', '「' + formatTime(at) + '」の状態に戻します。いまの状態は「復元する前」として履歴に残り、Ctrl+Z でも元に戻せます。', '復元', function () {
    Promise.resolve(store.get(id)).then(function (snap) {
      if (!snap) return toast('その履歴は見つかりませんでした');
      return historyTick('restore').then(function () {
        mark();
        var r = restoreFrom(P, snap);
        Object.keys(E.els).forEach(dropEl);
        setP(r.project);
        S.sel = [];
        last = slimForSnapshot(P); lastAt = Date.now();
        changed();
        toast(r.dropped ? '復元しました（いまはない素材のクリップ ' + r.dropped + '件は戻せませんでした）' : '「' + formatTime(at) + '」の状態に復元しました');
      });
    }).catch(function (e) { toast('復元できませんでした：' + e); });
  });
}
