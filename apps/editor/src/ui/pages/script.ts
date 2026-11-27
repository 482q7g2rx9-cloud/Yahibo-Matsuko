// @ts-nocheck
// 台本ページ（M4）：取り込んだ台本（控え）を、シーンごとに行で並べる。
// 行ごとに紐づいたクリップを出し、「未配置の行」「更新された行」「台本で削除された行（孤立したクリップ）」で絞り込める。
import { C, M, P, T, cEnd } from '../project';
import { S } from '../state';
import { A, btn, h, tc } from '../util';
import { HOST } from '../desktop';
import { R } from './media';
import { LABEL_FIELD, counts, excerpt, linksOfRow, nums, scriptSettings, stateOf } from '../scriptLink';
import { ROW_TEXT_KEYS } from '../../core/link';

function clipName(c) { var m = c.m && M(c.m); return c.type === 'title' ? (String(c.label || '').split('\n')[0] || 'テロップ') : m ? m.n : c.label || 'クリップ'; }
function chipFor(l) {
  var c = C(l.clipId), st = stateOf(l);
  return '<span class="slc ' + st + '"><button class="lnk"' + A('scrClip', c.id) + ' title="編集ページで見る">' + h(c.tr) + '　' + h(excerpt(clipName(c), 16)) + '　' + tc(c.start) + '</button>' +
    '<button class="x" aria-label="紐づけを解除" title="紐づけを解除"' + A('scrUnlink', l.id) + '>×</button></span>';
}

export function init() {
R.script = function () {
  if (!P.script) return '<div class="pc" style="align-items:center;justify-content:center;background:var(--bg1);text-align:center;gap:14px">' +
    '<div style="font-size:16px;font-weight:500">台本がまだありません</div>' +
    '<div>' + btn('台本の連携ファイルを読み込む…', 'scrPick', '', 'pri') + '</div></div>';
  var s = P.script, nn = nums(), ct = counts(), f = S.scrFilter || 'all', st = scriptSettings(), sel = S.sel.filter(function (id) { return C(id); });
  var scenes = s.scenes.slice().sort(function (a, b) { return a.order - b.order; });
  var rows = s.rows.slice().sort(function (a, b) { return a.order - b.order; });
  var show = function (r) {
    var ls = linksOfRow(r.id);
    if (f === 'unplaced') return !r.deleted && !ls.length;
    if (f === 'stale') return ls.some(function (l) { return stateOf(l) === 'stale'; });
    if (f === 'orphan') return ls.some(function (l) { return stateOf(l) === 'orphan'; });
    return !r.deleted || ls.length;
  };
  var rowHtml = function (r) {
    var ls = linksOfRow(r.id), stale = ls.filter(function (l) { return stateOf(l) === 'stale'; }), orph = r.deleted;
    var opts = orph ? rows.filter(function (x) { return !x.deleted; }).map(function (x) { return '<option value="' + x.id + '">' + h(nn[x.id] + '　' + excerpt(x.body || x.video, 24)) + '</option>'; }).join('') : '';
    return '<div class="srow' + (S.scrRow === r.id ? ' on' : '') + (orph ? ' del' : '') + '" data-srow="' + r.id + '">' +
      '<div class="sno">' + (orph ? '<span class="t-er">削除</span>' : h(nn[r.id] || '')) + '</div>' +
      '<div class="stm">' + h(r.time || '') + '</div>' +
      '<div class="smu">' + h(r.music || '') + '</div>' +
      '<div class="svi">' + h(r.video || '') + '</div>' +
      '<div class="sbd">' + h(r.body || '') + (r.type ? '<span class="chip c-mu" style="margin-left:6px">' + h(r.type) + '</span>' : '') +
        stale.map(function (l) {
          var sn = l.seen || {}, diff = ROW_TEXT_KEYS.filter(function (k) { return (sn[k] || '') !== (r[k] || ''); });
          return '<div class="sdf"><div class="t-wn" style="font-weight:500">台本が更新されました（' + h(C(l.clipId).tr) + '　' + h(excerpt(clipName(C(l.clipId)), 14)) + '）</div>' +
            diff.map(function (k) { return '<div><span class="mu">' + LABEL_FIELD[k] + '</span><del>' + h(sn[k] || '（なし）') + '</del><ins>' + h(r[k] || '（なし）') + '</ins></div>'; }).join('') +
            '<div class="row" style="justify-content:flex-end;margin-top:4px">' + btn('確認しました', 'scrOk', l.id, 's') + '</div></div>';
        }).join('') +
      '</div>' +
      '<div class="scl">' + ls.map(chipFor).join('') +
        (orph ? (ls.length ? '<div class="row" style="gap:6px;margin-top:4px"><select class="inp" data-in="scrRelink" data-row="' + r.id + '" aria-label="付け替える行" style="height:26px;min-width:0;flex:1"><option value="">別の行へ付け替える…</option>' + opts + '</select></div>' : '')
          : '<button class="b s"' + A('scrLink', r.id) + (sel.length ? '' : ' disabled') + ' title="編集ページで選んでいるクリップを、この行に紐づける">＋ 選んだクリップ</button>') +
      '</div></div>';
  };
  var body = '', any = false;
  scenes.forEach(function (sc, i) {
    var L = rows.filter(function (r) { return r.sceneId === sc.id && show(r); });
    if (!L.length) return;
    any = true;
    body += '<div class="shd"><b>S' + (i + 1) + '</b>　' + h(sc.title || '') + '<span class="mu" style="margin-left:10px">' + h(sc.time || '') + '</span></div>' + L.map(rowHtml).join('');
  });
  var lost = rows.filter(function (r) { return !scenes.some(function (sc) { return sc.id === r.sceneId; }) && show(r); });
  if (lost.length) { any = true; body += '<div class="shd">シーンなし</div>' + lost.map(rowHtml).join(''); }
  if (!any) body = '<div class="mu" style="padding:28px">該当する行はありません</div>';
  var seg = [['all', 'すべて', ''], ['unplaced', '未配置の行', ct.unplaced], ['stale', '更新された行', ct.stale], ['orphan', '台本で削除された行', ct.orphan]];
  return '<div class="pc" style="background:var(--bg1)">' +
    '<div class="row" style="height:50px;flex:none;gap:10px;padding:0 16px;border-bottom:1px solid var(--dv)">' +
      '<b style="font-size:14px">' + h(s.title || '台本') + '</b><span class="mu">書き出し #' + s.exportSeq + '　取り込み ' + h(new Date(s.importedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</span>' +
      (S.scrNotice ? '<span class="chip c-wn">台本が更新されました</span>' : '') +
      '<span class="grow"></span>' + (P.scriptBackup ? btn('取り込みを元に戻す', 'scrUndo', '', 's') : '') + btn(HOST && st.path ? '取り込む' : '取り込む…', 'scrImport', '', S.scrNotice ? 'pri' : '') + '</div>' +
    '<div class="row" style="flex:none;gap:6px;padding:8px 16px;border-bottom:1px solid var(--dv)"><span class="seg">' + seg.map(function (x) { return btn(x[1] + (x[2] !== '' ? ' ' + x[2] : ''), 'scrFilter', x[0], 's' + (f === x[0] ? ' on' : '')); }).join('') + '</span></div>' +
    '<div class="srh"><div>番号</div><div>時間</div><div>図画・音楽</div><div>映像</div><div>内容</div><div>クリップ</div></div>' +
    '<div class="scroll">' + body + '</div></div>';
};
}
