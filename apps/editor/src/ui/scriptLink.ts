// @ts-nocheck
// 台本連携（M4）の画面側：連携ファイルの選択・取り込み（差分の確認画面）・取り込みの取り消し・クリップと行の紐づけ。
// 差分の判定と反映の計算は core/link.ts。控えは P.script、紐づけは P.links、取り込む前の控えと紐づけは P.scriptBackup。
// 設定（紐づける連携ファイル・見張り・反映のしかた）は P.settings.script（プロジェクト設定の「台本連携」）。
import { C, M, P, T, cEnd, uid } from './project';
import { S } from './state';
import { changed, mark, saveP } from './store';
import { HOST } from './desktop';
import { toast } from './menus';
import { draw, go } from './render';
import { A, btn, h, tc } from './util';
import { ACT } from './actions';
import { CHANGE_AUTO, CHANGE_LABEL, ROW_TEXT_KEYS, applyLink, diffLink, linkState, rowNumbers, rowText } from '../core/link';
import { isSwdxProject, looksZip, swdxToLink, unzipSwdx } from '../core/swdx';

export function scriptSettings() { return (P.settings && P.settings.script) || {}; }
export function setScriptSetting(k, v) {
  var st = P.settings = Object.assign({}, P.settings || {});
  st.script = Object.assign({}, st.script || {});
  if (v === undefined || v === null || v === '') delete st.script[k]; else st.script[k] = v;
  saveP();
}
export function links() { return P.links || (P.links = []); }
export function rowById(id) { return P.script ? P.script.rows.filter(function (r) { return r.id === id; })[0] : null; }
export function linksOfClip(cid) { return links().filter(function (l) { return l.clipId === cid; }); }
export function linksOfRow(rid) { return links().filter(function (l) { return l.rowId === rid && C(l.clipId); }); }
export function stateOf(l) { return linkState(l, P.script); }
/* 消えたクリップの紐づけは捨てる */
export function pruneLinks() { if (!P.links) return; P.links = P.links.filter(function (l) { return !!C(l.clipId); }); }
export function counts() {
  var o = { unplaced: 0, stale: 0, orphan: 0 };
  if (!P.script) return o;
  P.script.rows.forEach(function (r) { if (!r.deleted && !linksOfRow(r.id).length) o.unplaced++; });
  links().forEach(function (l) { if (!C(l.clipId)) return; var s = stateOf(l); if (s === 'stale') o.stale++; else if (s === 'orphan') o.orphan++; });
  return o;
}
export var LABEL_FIELD = { time: '時間', music: '図画・音楽', video: '映像', body: '内容', type: '種別' };
export function excerpt(s, n) { s = String(s || '').replace(/\s+/g, ' '); return s.length > (n || 40) ? s.slice(0, n || 40) + '…' : s; }
export function nums() { return rowNumbers(P.script); }

/* ---------- 連携ファイルを選ぶ・読む ---------- */
export function pickScriptFile() {
  if (HOST) {
    HOST.script.pick().then(function (p) {
      if (!p) return;
      setScriptSetting('path', p);
      setScriptSetting('name', p.split(/[\\/]/).pop());
      syncScriptWatch(true);
      importScript();
    }).catch(function (e) { toast(String(e)); });
    return;
  }
  var i = document.getElementById('scriptIn');
  if (!i) { i = document.createElement('input'); i.type = 'file'; i.id = 'scriptIn'; i.accept = '.json,.swdx,.zip,application/json'; i.hidden = true; document.body.appendChild(i);
    i.addEventListener('change', function () { var f = i.files && i.files[0]; if (!f) return; i.value = '';
      /* 台本アプリのプロジェクトファイル（.swdx。ZIP）なら、中の project.json を取り出す */
      f.arrayBuffer().then(function (buf) { var u = new Uint8Array(buf); return looksZip(u) ? unzipSwdx(u, inflateRaw) : new TextDecoder().decode(u); })
        .then(function (t) { setScriptSetting('name', f.name); importText(t, f.name); }).catch(function (e) { toast(String(e && e.message || e)); }); }); }
  i.click();
}
/* deflate（ヘッダーなし）を戻す：ブラウザの DecompressionStream */
function inflateRaw(d) {
  if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('このブラウザでは .swdx を読めません'));
  return new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer().then(function (b) { return new Uint8Array(b); });
}
/* 紐づけてある連携ファイルを読み直す（ブラウザ版は、毎回選ぶ） */
export function importScript() {
  var st = scriptSettings();
  if (!HOST || !st.path) return pickScriptFile();
  HOST.script.read(st.path).then(function (t) { importText(t, st.name || st.path); }).catch(function (e) { toast(String(e)); });
}
export function importText(text, name) {
  var f, cards = null;
  try { f = JSON.parse(text); } catch (e) { return toast('連携ファイルを読めませんでした（JSON ではありません）'); }
  /* 台本アプリのプロジェクトファイル（.swdx）：連携ファイルの形に直し、絵コンテの画像を縮めて持つ（core/swdx.ts） */
  if (isSwdxProject(f)) {
    var r; try { r = swdxToLink(f); } catch (e) { return toast(e.message); }
    return shrinkCards(r.cards).then(function (cs) { importFile(r.file, name, cs); });
  }
  importFile(f, name, null);
}
function importFile(f, name, cards) {
  var d = diffLink(P.script, f);
  S.scrNotice = false;
  if (d.same) {
    if (cards && JSON.stringify(cards) !== JSON.stringify(P.script.cards || [])) { P.script.cards = cards; saveP(); }
    draw(); return toast('台本の更新はありません');
  }
  S.imp = { file: f, diff: d, name: name, accept: {}, relink: {}, force: false, cards: cards };
  renderImport();
}
/* 絵コンテ（Project.script.cards）：.swdx の画像は、長い辺 320px の JPEG に縮める。連携ファイル（画像なし）のときは、前の画像を id で引き継ぐ */
function shrinkCards(cards) {
  return Promise.all(cards.map(function (c) {
    var o = { id: c.id, sceneId: c.sceneId, caption: c.caption };
    if (!c.img) return o;
    return new Promise(function (ok) {
      var im = new Image();
      im.onload = function () { try { var k = Math.min(1, 320 / Math.max(im.naturalWidth, im.naturalHeight)), cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
        var x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(im, 0, 0, cv.width, cv.height); o.img = cv.toDataURL('image/jpeg', 0.8); } catch (e) {} ok(o); };
      im.onerror = function () { ok(o); };
      im.src = c.img;
    });
  }));
}
function mergeCards(prev, f) {
  var old = {}; (prev || []).forEach(function (c) { old[c.id] = c; });
  return (f.cards || []).filter(function (c) { return c && c.id; }).map(function (c) { var o = { id: c.id, sceneId: c.sceneId || '', caption: c.caption || '' }; if (c.hasImage && old[c.id] && old[c.id].img) o.img = old[c.id].img; return o; });
}
/** シーンの絵コンテの画像（最初の 1 枚） */
export function sceneCard(sid) { var L = P.script && P.script.cards || []; for (var i = 0; i < L.length; i++) if (L[i].sceneId === sid && L[i].img) return L[i]; return null; }

/* ---------- 取り込みの確認画面 ---------- */
export function renderImport() {
  var im = S.imp, dl = document.getElementById('dlg');
  if (!im) { dl.hidden = true; return; }
  var d = im.diff, f = im.file, all = !!scriptSettings().confirmAll, nn = rowNumbers(P.script), nx = {};
  /* 今回のファイルでの行番号 */
  f.rows && f.rows.filter(function (r) { return !r.deleted; }).slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (r, i) { nx[r.id] = 'R-' + String(i + 1).padStart(3, '0'); });
  var stop = d.block === 'invalid' || d.block === 'project', force = d.block === 'older' || d.block === 'missing';
  var auto = d.changes.filter(function (c) { return CHANGE_AUTO[c.kind]; }), conf = d.changes.filter(function (c) { return !CHANGE_AUTO[c.kind]; });
  var sum = {}; d.changes.forEach(function (c) { sum[c.kind] = (sum[c.kind] || 0) + 1; });
  var item = function (c, check) {
    var r = c.after, no = nx[c.rowId] || nn[c.rowId] || '', on = !(c.key in im.accept) || im.accept[c.key];
    var head = '<span class="chip ' + (CHANGE_AUTO[c.kind] ? 'c-mu' : 'c-wn') + '">' + CHANGE_LABEL[c.kind] + '</span><span class="mu">' + h(no) + '</span><span class="grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + h(excerpt(r.body || r.video, 48)) + '</span>';
    var more = '';
    if (c.kind === 'change') more = '<div class="impd">' + ROW_TEXT_KEYS.filter(function (k) { return (c.before[k] || '') !== (r[k] || ''); }).map(function (k) { return '<div><span class="mu">' + LABEL_FIELD[k] + '</span><del>' + h(c.before[k] || '（なし）') + '</del><ins>' + h(r[k] || '（なし）') + '</ins></div>'; }).join('') + '</div>';
    var lk = linksOfRow(c.rowId).length;
    if ((c.kind === 'delete' || c.kind === 'merge' || c.kind === 'change') && lk) more += '<div class="mu" style="margin:2px 0 0 28px">紐づいたクリップ ' + lk + ' 件</div>';
    if (c.kind === 'merge') { var to = f.rows.filter(function (x) { return x.id === c.other; })[0], rl = !(c.rowId in im.relink) || im.relink[c.rowId];
      more += '<div style="margin:4px 0 0 28px" class="row"><label class="row" style="gap:6px"><input type="radio" name="rl-' + c.rowId + '" data-impr="' + c.rowId + '" value="1"' + (rl ? ' checked' : '') + '>結合先（' + h(nx[c.other] || '') + ' ' + h(excerpt(to && to.body, 20)) + '）へ付け替える</label><label class="row" style="gap:6px;margin-left:12px"><input type="radio" name="rl-' + c.rowId + '" data-impr="' + c.rowId + '" value="0"' + (rl ? '' : ' checked') + '>孤立にする</label></div>'; }
    return '<div class="impi">' + (check ? '<input type="checkbox" data-impc="' + h(c.key) + '"' + (on ? ' checked' : '') + ' aria-label="反映する">' : '<span style="width:16px"></span>') + head + '</div>' + more;
  };
  var body = '';
  if (d.messages.length) body += '<div class="box" style="border-left:3px solid ' + (stop ? 'var(--er)' : 'var(--wn)') + ';margin-bottom:12px">' + d.messages.map(h).join('<br>') + (force ? '<label class="row" style="gap:6px;margin-top:8px"><input type="checkbox" data-impf' + (im.force ? ' checked' : '') + '>確認したうえで取り込む</label>' : '') + '</div>';
  if (!stop) {
    body += '<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">' + Object.keys(sum).map(function (k) { return '<span class="chip ' + (CHANGE_AUTO[k] ? 'c-mu' : 'c-wn') + '">' + CHANGE_LABEL[k] + ' ' + sum[k] + '</span>'; }).join('') + (d.sceneChanges ? '<span class="chip c-mu">シーン ' + d.sceneChanges + '</span>' : '') + (d.changes.length || d.sceneChanges ? '' : '<span class="mu">行の変更はありません</span>') + '</div>';
    if (conf.length) body += '<div class="imph">確認が必要な変更（' + conf.length + '）</div>' + conf.map(function (c) { return item(c, true); }).join('');
    if (auto.length) body += '<div class="imph">' + (all ? '反映する変更' : '自動で反映する変更') + '（' + auto.length + '）</div>' + auto.map(function (c) { return item(c, all); }).join('');
  }
  var canGo = !stop && (!force || im.force);
  dl.innerHTML = '<div class="dlg imp" role="dialog" aria-modal="true" aria-labelledby="dlgT"><div class="ph2"><h2 id="dlgT">台本の取り込み</h2>' + btn('閉じる', 'impNo', '', 's') + '</div>' +
    '<div class="mu" style="margin:-4px 0 12px">' + h(im.name || '') + (f && f.project ? '　' + h(f.project.title || '') : '') + (typeof (f && f.exportSeq) === 'number' ? '　書き出し #' + f.exportSeq : '') + (P.script ? '（前回 #' + P.script.exportSeq + '）' : '') + '</div>' +
    '<div class="impl">' + body + '</div>' +
    '<div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px">' + btn('やめる', 'impNo') + (stop ? '' : '<button class="b pri"' + A('impGo') + (canGo ? '' : ' disabled') + '>反映する</button>') + '</div></div>';
  dl.hidden = false;
}
export function closeImport() { S.imp = null; var dl = document.getElementById('dlg'); dl.hidden = true; dl.innerHTML = ''; }
export function applyImport() {
  var im = S.imp; if (!im) return;
  var d = im.diff, f = im.file, all = !!scriptSettings().confirmAll, acc = {};
  d.changes.forEach(function (c) { if (!CHANGE_AUTO[c.kind] || all) acc[c.key] = !(c.key in im.accept) || !!im.accept[c.key]; });
  mark();
  pruneLinks();
  P.scriptBackup = { script: P.script ? JSON.parse(JSON.stringify(P.script)) : null, links: JSON.parse(JSON.stringify(links())), at: new Date().toISOString() };
  var prevCards = P.script && P.script.cards;
  var r = applyLink(P.script, f, d, links(), { accept: acc, relink: im.relink });
  P.script = r.script; P.links = r.links;
  P.script.cards = im.cards || mergeCards(prevCards, f);
  closeImport();
  changed();
  var n = Object.keys(acc).filter(function (k) { return !acc[k]; }).length;
  toast('台本を取り込みました（書き出し #' + f.exportSeq + '）' + (n ? '。反映しなかった変更 ' + n + ' 件は、次の取り込みでまた表示します' : ''));
}
/* 取り込みを元に戻す（取り込む前の控えと紐づけに戻す） */
export function undoImport() {
  var b = P.scriptBackup; if (!b) return;
  mark();
  P.script = b.script; P.links = b.links || []; delete P.scriptBackup;
  changed();
  toast('取り込みを元に戻しました');
}

/* ---------- 紐づけ ---------- */
export function linkClips(rowId, clipIds) {
  var r = rowById(rowId); if (!r || r.deleted) return toast('この行には紐づけられません');
  var ids = (clipIds || []).filter(function (id) { var c = C(id); return c && !links().some(function (l) { return l.clipId === id && l.rowId === rowId; }); });
  if (!ids.length) return toast((clipIds || []).length ? 'もう紐づいています' : '編集ページでクリップを選んでから押してください');
  mark();
  ids.forEach(function (id) { links().push({ id: uid('lk'), clipId: id, rowId: rowId, rev: r.rev || 0, seen: rowText(r) }); });
  changed();
  toast(ids.length + ' 件のクリップを ' + (nums()[rowId] || '') + ' に紐づけました');
}
export function unlink(id) { mark(); P.links = links().filter(function (l) { return l.id !== id; }); changed(); }
export function confirmLink(id) { var l = links().filter(function (x) { return x.id === id; })[0], r = l && rowById(l.rowId); if (!l || !r) return; mark(); l.rev = r.rev || 0; l.seen = rowText(r); changed(); }
export function relink(id, rowId) { var l = links().filter(function (x) { return x.id === id; })[0], r = rowById(rowId); if (!l || !r || r.deleted) return; mark(); l.rowId = rowId; l.rev = r.rev || 0; l.seen = rowText(r); changed(); }
/* クリップの場所へ：編集ページで選び、再生ヘッドを頭に */
export function gotoClip(cid) { var c = C(cid); if (!c) return; S.sel = [cid]; S.t.edit = c.start; go('edit'); }
/* 台本ページのその行へ */
export function gotoRow(rid) { S.scrRow = rid; S.scrFilter = 'all'; go('script'); setTimeout(function () { var el = document.querySelector('[data-srow="' + rid + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); }, 30); }

/* ---------- 見張り（デスクトップ版） ---------- */
var WKEY = null;
export function syncScriptWatch(force) {
  if (!HOST || !HOST.script) return;
  var st = scriptSettings(), key = (HOST.project.current ? HOST.project.current.dir : '') + '|' + (st.path || '') + '|' + (st.watch === false ? 0 : 1);
  if (!force && key === WKEY) return;
  WKEY = key;
  HOST.script.watch(st.path && st.watch !== false && HOST.project.current ? st.path : null).catch(function () {});
}
/* ---------- カットページ：シーンと素材、行に合わせてカットを作る ---------- */
export function sceneMedia() { return P.sceneMedia || (P.sceneMedia = {}); }
export function scenesSorted() { return P.script ? P.script.scenes.slice().sort(function (a, b) { return a.order - b.order; }) : []; }
export function rowsOfScene(sid) { return P.script ? P.script.rows.filter(function (r) { return r.sceneId === sid && !r.deleted; }).sort(function (a, b) { return a.order - b.order; }) : []; }
export function assignScene(sid, mid) {
  if (!P.script) return;
  var sm = sceneMedia(), m = mid && M(mid), sc = P.script.scenes.filter(function (x) { return x.id === sid; })[0];
  if (!sc) return;
  if (m) sm[sid] = m.id; else delete sm[sid];
  changed();
  toast(m ? '「' + m.n + '」を ' + (sc.title || 'シーン') + ' に割り当てました' : '割り当てを外しました');
}
/* カットを作る行：選んだシーンの、まだクリップのない最初の行（選び直せる） */
export function cutRow() {
  if (!P.script || !S.scene) return null;
  var L = rowsOfScene(S.scene);
  if (S.cutRow && L.some(function (r) { return r.id === S.cutRow; })) return S.cutRow;
  var r = L.filter(function (x) { return !linksOfRow(x.id).length; })[0] || L[0];
  return r ? r.id : null;
}
/* 仮編集へ追加・上書きで新しくできたクリップを、カットを作る行に紐づけ、次の行へ進める */
function wrapCut(name) {
  var f = ACT[name]; if (!f || f.__wrapped) return;
  var g = function () {
    var before = {}; P.clips.forEach(function (c) { before[c.id] = 1; });
    var sm = P.script && S.scene ? sceneMedia()[S.scene] : null, rid = (!sm || sm === S.src) ? cutRow() : null;
    f.apply(this, arguments);
    var r = rid && rowById(rid); if (!r) return;
    var made = P.clips.filter(function (c) { return !before[c.id]; });
    if (!made.length) return;
    made.forEach(function (c) { links().push({ id: uid('lk'), clipId: c.id, rowId: r.id, rev: r.rev || 0, seen: rowText(r) }); });
    var L = rowsOfScene(S.scene), i = L.map(function (x) { return x.id; }).indexOf(r.id), nx = L.slice(i + 1).filter(function (x) { return !linksOfRow(x.id).length; })[0];
    S.cutRow = nx ? nx.id : r.id;
    saveP(); draw();
  };
  g.__wrapped = true;
  ACT[name] = g;
}
export function init() {
  wrapCut('cutIns'); wrapCut('cutOvr');
  S.imp = null; S.scrNotice = false; S.scrFilter = 'all'; S.scrRow = null;
  if (HOST && HOST.script) HOST.script.onChanged(function (p) {
    if (p !== scriptSettings().path) return;
    S.scrNotice = true;
    toast('台本が更新されました。台本ページの「取り込む」から反映できます');
    if (S.page === 'script') draw();
  });
}
