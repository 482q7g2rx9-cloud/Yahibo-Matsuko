// @ts-nocheck
/* オーディオページ（M6）：台本の行ごとにナレーションを録る。録音の仕組みは recorder.ts */
import { P, T } from '../project';
import { S } from '../state';
import { A, btn, h, ic, ph, tc, waveOf } from '../util';
import { HOST } from '../desktop';
import { R } from './media';
import { RC, lvPct, loadDevices, recRow, rowTakes } from '../recorder';
import { excerpt, nums } from '../scriptLink';

/* 左：台本の行（取り込んだ台本）。行ごとのテイクの数と、採用したテイクがあれば「済」 */
function scriptList() {
  if (!P.script) return '<div class="mu" style="padding:16px">台本がまだありません</div>';
  var nn = nums(), rows = P.script.rows.filter(function (r) { return !r.deleted; }).sort(function (a, b) { return a.order - b.order; });
  if (!rows.length) return '<div class="mu" style="padding:16px">行がありません</div>';
  return rows.map(function (r) {
    var L = rowTakes(r.id), done = L.some(function (m) { return m.adopt; }), on = S.recRow === r.id;
    return '<div class="li' + (on ? ' selr' : '') + '" role="button" tabindex="0"' + A('recRow', r.id) + ' style="display:grid;grid-template-columns:52px 1fr 24px;padding:12px 10px;border-bottom:1px solid var(--dv)">' +
      '<span class="t2">' + h(nn[r.id] || '') + '</span><span style="min-width:0"><span style="display:block;font-size:14px;' + (done ? 'color:var(--mu)' : '') + '">' + h(excerpt(r.body, 60)) + '</span>' +
      (r.video ? '<span class="t2" style="display:block;margin-top:6px">映像：' + h(excerpt(r.video, 30)) + '</span>' : '') + '</span>' +
      '<span>' + (done ? '<span class="t-ok">済</span>' : L.length ? '<span class="mu">' + L.length + '</span>' : on ? '<span style="display:block;width:11px;height:11px;border-radius:50%;background:#f06060;margin-top:4px" aria-label="録音する行"></span>' : '') + '</span></div>';
  }).join('');
}

/* 録音の操作：入力・レベル・時間・録音／停止 */
function recPanel() {
  var devs = RC.devs || [], live = RC.on || RC.count;
  var devSel = '<select class="inp" data-in="recDev" aria-label="入力"' + (live ? ' disabled' : '') + '>' + (devs.length ? devs.map(function (d) { return '<option value="' + h(d.id) + '"' + (d.id === RC.dev ? ' selected' : '') + '>' + h(d.name) + '</option>'; }).join('') : '<option value="">' + (RC.devs ? (HOST ? 'マイクが見つかりません' : '既定のマイク') : '読み込み中…') + '</option>') + '</select>';
  var big = RC.count ? '<span style="color:var(--wn)">' + RC.count + '</span>' : tc(RC.on ? RC.t : 0);
  return '<div class="grow" style="display:flex;flex-direction:column;gap:6px;min-width:0">' +
    '<div class="fg" style="grid-template-columns:64px 1fr;min-height:30px"><span>入力</span>' + devSel + '</div>' +
    '<div class="row" style="gap:10px"><span class="t2" style="width:54px">レベル L</span><span class="lvl"><i data-lvl="0" style="width:' + (RC.on ? lvPct(RC.lv[0]) : 0) + '%"></i></span></div>' +
    '<div class="row" style="gap:10px"><span class="t2" style="width:54px">レベル R</span><span class="lvl"><i data-lvl="1" style="width:' + (RC.on ? lvPct(RC.lv[1]) : 0) + '%"></i></span></div>' +
    '<div data-rec style="font-size:24px;color:' + (RC.on ? 'var(--er)' : 'var(--ac)') + '">' + big + '</div>' +
    '<div class="row" style="gap:8px"><button class="b" aria-label="' + (live ? '停止' : '録音') + '" title="' + (live ? '停止' : '録音') + '"' + A('recGo') + ' style="width:48px;height:34px;color:var(--er)' + (live ? ';background:var(--erb);border-color:var(--er)' : '') + '">' + ic(live ? 'stop' : 'rec', 14) + '</button>' +
    '<button class="b" aria-label="停止" title="停止"' + A('recStop') + (live ? '' : ' disabled') + ' style="width:40px;height:34px">' + ic('stop', 14) + '</button>' +
    '<button class="b" aria-label="先頭へ" title="先頭へ"' + A('recTop') + (live ? ' disabled' : '') + ' style="width:40px;height:34px">' + ic('toStart', 14) + '</button>' +
    '<label class="row" style="gap:6px;margin-left:6px"><input type="checkbox" data-in="countin"' + (S.countin ? ' checked' : '') + (live ? ' disabled' : '') + ' style="margin:0">カウントイン</label></div></div>';
}

/* テイクの一覧（選んでいる行のもの。行を選んでいなければ、行なしで録ったもの） */
function takeList(L) {
  if (!L.length) return '<div class="mu" style="padding:14px">テイクはまだありません</div>';
  return '<div class="tk h"><span>テイク</span><span>波形</span><span>長さ</span><span>試聴</span><span>削除</span><span>採用</span></div>' +
    L.map(function (m, i) {
      var on = S.takeSel === m.id, pl = RC.playId === m.id;
      return '<div class="tk r li' + (on ? ' selr' : '') + '"' + A('takeSel', m.id) + ' style="' + (on ? 'box-shadow:none' : '') + '"><b style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + h(m.n) + '">テイク' + (m.take && m.take.no || i + 1) + '</b>' +
        '<span class="mw">' + waveOf(m, 0, m.d || 1, 60, 'currentColor') + '</span><span>' + (m.d || 0).toFixed(1) + ' 秒</span>' +
        '<span><button class="b s" style="width:40px;padding:0" aria-label="' + h(m.n) + 'を' + (pl ? '止める' : '試聴') + '"' + A('takePlay', m.id) + '>' + ic(pl ? 'stop' : 'play', 12) + '</button></span>' +
        '<span><button class="b s" style="width:40px;padding:0" aria-label="' + h(m.n) + 'を削除"' + A('takeDel', m.id) + '>' + ic('trash', 12) + '</button></span>' +
        '<span><input type="radio" name="take" aria-label="' + h(m.n) + 'を採用"' + (m.adopt ? ' checked' : '') + A('takeAdopt', m.id) + '></span></div>';
    }).join('');
}

/* 右：音声トラックのミュート・ソロ（タイムラインと同じ） */
function mixer() {
  var L = P.tracks.filter(function (t) { return t.kind === 'a'; });
  return '<div style="padding:8px 12px;display:flex;flex-direction:column;gap:4px">' + L.map(function (t) {
    return '<div class="row" style="gap:8px;height:34px;padding:0 10px;border-radius:4px;background:var(--bg2)"><b style="font-weight:500;width:34px">' + h(t.id) + '</b><span class="grow mu" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + h(t.name || '') + '</span>' +
      '<span class="ms"><button aria-pressed="' + !!t.mute + '" aria-label="' + h(t.id) + ' ミュート"' + A('tmute', t.id) + '>M</button><button aria-pressed="' + !!t.solo + '" aria-label="' + h(t.id) + ' ソロ"' + A('tsolo', t.id) + '>S</button></span></div>';
  }).join('') + '</div>';
}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init() {
  R.audio = function () {
    loadDevices();
    var row = recRow(), L = rowTakes(row ? row.id : null), sel = L.filter(function (m) { return m.id === S.takeSel; })[0] || L.filter(function (m) { return m.adopt; })[0] || L[L.length - 1];
    var sync = S.rmode !== 'free', nn = nums();
    var dest = (row ? (nn[row.id] || '') : '台本行なし');
    return '<div class="pn l" style="width:330px">' + ph('台本') + '<div class="scroll">' + scriptList() + '</div>' +
      (P.script ? '<div style="padding:10px 16px;border-top:1px solid var(--dv)">' + btn('行を選ばずに録音', 'recRow', '', 's' + (S.recRow ? '' : ' on')) + '</div>' : '') + '</div>' +
      '<div class="pc">' +
      '<div class="row" style="height:42px;flex:none;padding:0 16px;border-bottom:1px solid var(--dv);background:var(--bg1)"><span class="seg">' + btn('動画に合わせて録音', 'rmode', 'sync', sync ? 'on' : '') + btn('自由に録音', 'rmode', 'free', sync ? '' : 'on') + '</span><span class="grow"></span><span class="mu">録音先：' + h(dest) + '</span></div>' +
      '<div class="row" style="height:200px;flex:none;gap:12px;padding:14px;align-items:flex-start;background:var(--bg0)">' +
      '<div style="width:290px;height:172px;flex:none;background:#000;position:relative;display:flex;align-items:center;justify-content:center">' +
      (sync ? '<canvas data-prog width="640" height="360" style="width:290px;height:163px"></canvas><span style="position:absolute;left:6px;bottom:2px;color:#9a9a9a;font-size:11px" data-time="edit">' + tc(S.t.edit) + '</span>' : '<span style="color:#9a9a9a">自由録音（映像なし）</span>') + '</div>' +
      recPanel() + '</div>' +
      ph(sel ? h(sel.n) + ' の波形' : '波形', sel ? '<span class="x">' + tc(sel.d || 0) + '</span>' : '') +
      '<div style="height:116px;flex:none;padding:8px 10px;background:var(--bg1);border-bottom:1px solid var(--dv)"><div style="height:100%;background:#2f78b7;border:1px solid #8cc4ee">' + (sel ? waveOf(sel, 0, sel.d || 1, 360) : '') + '</div></div>' +
      ph('テイク一覧') + '<div class="scroll" style="flex:1">' + takeList(L) + '</div>' +
      '<div class="row" style="gap:8px;padding:12px 16px;border-top:1px solid var(--dv)">' + btn('タイムラインに配置', 'takePlace', sel ? sel.id : '') +
      '<span class="grow"></span>' + (sel && sel.take && sel.take.at != null ? '<span class="mu">録音した位置：' + tc(sel.take.at) + '</span>' : '') + '</div></div>' +
      '<div class="pn r" style="width:300px">' + ph('ミキサー') + mixer() + '</div>';
  };
}
