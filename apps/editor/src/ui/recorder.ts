// @ts-nocheck
/* ================================================================
   録音（M6）：オーディオページのナレーション録音。
   - デスクトップ版：Rust（src-tauri/src/rec.rs）が cpal でマイクの音を受け、プロジェクトフォルダーの「録音」に WAV で書く
   - ブラウザ版：getUserMedia の音を Web Audio で受け、WAV にしてブラウザの中（IndexedDB）に置く
   「動画に合わせて録音」は、再生ヘッドの位置からタイムラインを再生しながら録る。録ったテイクは、その位置に置ける。
   録ったものは素材（種類「テイク」）になる。m.take に {row: 台本行の id, at: 録り始めたタイムラインの秒（動画に合わせたとき）, no: 番号}
   ================================================================ */
import { C, M, P, T, cEnd, uid } from './project';
import { S } from './state';
import { IDB, changed, mark, saveP } from './store';
import { HOST, ensureProject, mediaUrl, queueJobs } from './desktop';
import { E, progPlay, progStop } from './engine';
import { toast } from './menus';
import { draw } from './render';
import { tc } from './util';
import { peaksOf } from './importWeb';
import { linksOfRow, nums, rowById } from './scriptLink';
import { busy } from '../core/timeline';
import { addTrack } from './editOps';

/** 録音の状態。on：録音中、count：カウントインの残り（秒）、t：録った長さ、lv：音の大きさ（左右） */
export var RC = { on: false, count: 0, t: 0, lv: [0, 0], devs: null, dev: '', at: null, row: null, play: null, playId: null, web: null };

/* ---------- マイク ---------- */
export function loadDevices() {
  if (RC.devs) return;
  RC.devs = [];
  var done = function (L) { RC.devs = L; if (!RC.dev) { var d = L.filter(function (x) { return x.default; })[0] || L[0]; RC.dev = d ? d.id : ''; } if (S.page === 'audio') draw(); };
  if (HOST) { HOST.rec.devices().then(function (L) { done((L || []).map(function (d) { return { id: d.name, name: d.name, default: d.default }; })); }).catch(function () { done([]); }); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return done([]);
  navigator.mediaDevices.enumerateDevices().then(function (L) {
    done(L.filter(function (d) { return d.kind === 'audioinput'; }).map(function (d, i) { return { id: d.deviceId, name: d.label || ('マイク ' + (i + 1)), default: d.deviceId === 'default' || i === 0 }; }));
  }).catch(function () { done([]); });
}

/* ---------- ブラウザ版の録音（Web Audio → WAV） ---------- */
function webStart(devId) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('このブラウザでは録音できません'));
  return navigator.mediaDevices.getUserMedia({ audio: { deviceId: devId ? { exact: devId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(function (st) {
    var AC = window.AudioContext || window.webkitAudioContext, ac = new AC(), src = ac.createMediaStreamSource(st), sp = ac.createScriptProcessor(4096, 2, 2), sink = ac.createGain();
    var w = { st: st, ac: ac, sp: sp, bufs: [[], []], n: 0, rate: ac.sampleRate, t0: performance.now() };
    sink.gain.value = 0; /* 自分の声をスピーカーから出さない */
    sp.onaudioprocess = function (e) {
      var ib = e.inputBuffer, l = ib.getChannelData(0), r = ib.numberOfChannels > 1 ? ib.getChannelData(1) : l, pl = 0, pr = 0;
      w.bufs[0].push(new Float32Array(l)); w.bufs[1].push(new Float32Array(r)); w.n += l.length;
      for (var i = 0; i < l.length; i += 4) { var a = Math.abs(l[i]), b = Math.abs(r[i]); if (a > pl) pl = a; if (b > pr) pr = b; }
      level({ l: pl, r: pr, t: w.n / w.rate });
    };
    src.connect(sp); sp.connect(sink); sink.connect(ac.destination);
    if (ac.state === 'suspended') ac.resume();
    RC.web = w;
    loadDevices.again = true;
  });
}
function webStop() {
  var w = RC.web; RC.web = null; if (!w) return Promise.reject(new Error('録音していません'));
  try { w.sp.disconnect(); w.st.getTracks().forEach(function (t) { t.stop(); }); w.ac.close(); } catch (e) {}
  return Promise.resolve({ blob: wav(w.bufs, w.n, w.rate), seconds: w.n / w.rate });
}
/** 16 ビット・ステレオの WAV */
export function wav(bufs, n, rate) {
  var ch = 2, b = new ArrayBuffer(44 + n * ch * 2), v = new DataView(b), s = function (o, t) { for (var i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * ch * 2, true);
  var o = 44;
  for (var k = 0; k < bufs[0].length; k++) { var L = bufs[0][k], R = bufs[1][k]; for (var i = 0; i < L.length; i++) { v.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true); v.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true); o += 4; } }
  return new Blob([b], { type: 'audio/wav' });
}

/* ---------- 音の大きさ（-60〜0 dB をメーターの 0〜100%） ---------- */
export function lvPct(v) { if (!(v > 0)) return 0; return Math.max(0, Math.min(100, (20 * Math.log10(v) + 60) / 60 * 100)); }
function level(e) {
  RC.lv = [Math.max(e.l, RC.lv[0] * 0.8), Math.max(e.r, RC.lv[1] * 0.8)]; RC.t = e.t;
  [0, 1].forEach(function (i) { var el = document.querySelector('[data-lvl="' + i + '"]'); if (el) el.style.width = lvPct(RC.lv[i]) + '%'; });
  var t = document.querySelector('[data-rec]'); if (t) t.textContent = tc(e.t);
}

/* ---------- 録る ---------- */
/** 今の台本行（台本がなければ null） */
export function recRow() { var r = S.recRow && rowById(S.recRow); return r && !r.deleted ? r : null; }
/** テイク（録った素材）。台本行を選んでいればその行のもの、なければ全部 */
export function takes(rowId) { return P.media.filter(function (m) { return m.k === 'テイク' && (!rowId || m.take && m.take.row === rowId); }); }
/** その行のテイク（行なし＝台本行を選ばずに録ったもの） */
export function rowTakes(rowId) { rowId = rowId || null; return P.media.filter(function (m) { return m.k === 'テイク' && (m.take && m.take.row || null) === rowId; }); }
function takeName(row) {
  var L = rowTakes(row ? row.id : null), no = L.reduce(function (a, m) { return Math.max(a, m.take && m.take.no || 0); }, 0) + 1;
  return { no: no, name: (row ? (nums()[row.id] || '台本行') + ' ' : 'ナレーション ') + 'テイク' + no };
}
export function recToggle() { if (RC.on || RC.count) return recStop(); recStart(); }
export function recStart() {
  if (RC.on || RC.count) return;
  if (E.playing) progStop();
  playTake(null);
  var ready = HOST ? ensureProject() : Promise.resolve();
  var count = S.countin ? 3 : 0;
  RC.row = S.recRow || null;
  ready.then(function () {
    if (!count) return go();
    /* カウントイン：3、2、1 のあとで録り始める（その間に停止を押したらやめる） */
    RC.cancel = false; RC.count = count; draw();
    var iv = setInterval(function () {
      if (RC.cancel) { clearInterval(iv); RC.cancel = false; RC.count = 0; draw(); return; }
      RC.count--;
      if (RC.count <= 0) { clearInterval(iv); go(); } else draw();
    }, 1000);
  }).catch(function (e) { toast(String(e)); });
  function go() {
    RC.count = 0;
    var nm = takeName(recRow());
    RC.name = nm;
    var p = HOST ? HOST.rec.start(RC.dev || null, nm.name) : webStart(RC.dev);
    p.then(function () {
      RC.on = true; RC.t = 0; RC.at = S.rmode === 'sync' ? S.t.edit : null;
      /* 動画に合わせて録音：再生ヘッドの位置から再生する */
      if (RC.at != null && P.clips.length) progPlay();
      draw();
    }).catch(function (e) { toast('録音を始められませんでした：' + (e && e.message || e)); draw(); });
  }
}
export function recStop() {
  if (RC.count) { RC.cancel = true; return; }
  if (!RC.on) return;
  RC.on = false; if (E.playing) progStop();
  var nm = RC.name, at = RC.at, row = RC.row;
  var p = HOST ? HOST.rec.stop() : webStop();
  p.then(function (r) {
    if (r.seconds < 0.2) { toast('短すぎるため、残しませんでした'); if (HOST) { /* ファイルは残る（録音フォルダー） */ } draw(); return; }
    var m = { id: uid('m'), n: nm.name, k: 'テイク', d: r.seconds, c: 'NA-' + String(nm.no).padStart(2, '0'), r: 'own', sr: row ? (nums()[row] || '—') : '—', res: '録音', px: -1, ho: '自分たち', src: '録音', pm: '—', ex: '—', line: '—', rate: '—', file: 1,
      col: ['#5a4a8a', '#3a2e5e'], added: new Date().toTimeString().slice(0, 5), take: { row: row, at: at, no: nm.no } };
    if (HOST) { m.path = r.path; m.f = r.path.split(/[\\/]/).pop(); m.pl = 1; m.np = 0; m.url = mediaUrl(m); }
    else { var f = new File([r.blob], nm.name + '.wav', { type: 'audio/wav' }); m.f = f.name; m.size = f.size; m.url = URL.createObjectURL(f); IDB.put('files', m.id, f); peaksOf(m, f); }
    mark(); P.media.push(m);
    /* その行の最初のテイクなら採用にする */
    if (!rowTakes(row).some(function (x) { return x !== m && x.adopt; })) m.adopt = 1;
    S.takeSel = m.id; changed();
    if (HOST) queueJobs(m);
    toast('「' + m.n + '」を録りました（' + r.seconds.toFixed(1) + ' 秒）');
  }).catch(function (e) { toast(String(e && e.message || e)); draw(); });
}
/** 録音を始める前の位置へ（動画に合わせて録音：選んだ台本行の映像のクリップの頭、なければ 0） */
export function recTop() {
  var row = recRow(), t = 0;
  if (row) { var cs = linksOfRow(row.id).map(function (l) { return C(l.clipId); }).filter(function (c) { return c && T(c.tr) && T(c.tr).kind === 'v'; }); if (cs.length) t = Math.min.apply(null, cs.map(function (c) { return c.start; })); }
  S.t.edit = t; draw();
}

/* ---------- 試聴・採用・配置 ---------- */
export function playTake(id) {
  if (RC.play) { try { RC.play.pause(); } catch (e) {} RC.play = null; var was = RC.playId; RC.playId = null; if (was === id || !id) { draw(); return; } }
  var m = id && M(id); if (!m || !m.url) { draw(); return; }
  var a = new Audio(m.url); RC.play = a; RC.playId = id; a.onended = function () { RC.play = null; RC.playId = null; draw(); };
  a.play().catch(function () { RC.play = null; RC.playId = null; draw(); }); draw();
}
export function adopt(id) { var m = M(id); if (!m) return; mark(); rowTakes(m.take && m.take.row).forEach(function (x) { delete x.adopt; }); m.adopt = 1; S.takeSel = id; changed(); }
/** 置く音声トラック：名前が NA・ナレーションのトラック → あいている音声トラック → 新しい音声トラック */
function narrationTrack(a, b) {
  var L = P.tracks.filter(function (t) { return t.kind === 'a' && !t.lock; });
  var na = L.filter(function (t) { return /^(NA|ナレーション)/.test(t.name || ''); });
  var free = na.concat(L).filter(function (t) { return !busy(P, t.id, a, b); })[0];
  return free ? free.id : addTrack('a').id;
}
/** テイクをタイムラインに置く（動画に合わせて録ったものは録った位置、そうでなければ再生ヘッドの位置）。台本行に紐づける */
export function placeTake(id) {
  var m = M(id); if (!m || !m.url) return toast('テイクを選んでください');
  var t = m.take && m.take.at != null ? m.take.at : S.t.edit, len = m.d || 1;
  mark();
  var tr = narrationTrack(t, t + len), c = { id: uid('c'), tr: tr, type: 'media', m: m.id, start: t, in: 0, out: len, link: null };
  P.clips.push(c);
  var row = m.take && m.take.row && rowById(m.take.row);
  if (row && !row.deleted) (P.links || (P.links = [])).push({ id: uid('lk'), clipId: c.id, rowId: row.id, rev: row.rev || 0, seen: { time: row.time || '', music: row.music || '', video: row.video || '', body: row.body || '', type: row.type || '' } });
  S.sel = [c.id];
  changed();
  toast('「' + m.n + '」を ' + tr + ' の ' + tc(t) + ' に置きました');
}
export function delTake(id) { var m = M(id); if (!m) return; if (P.clips.some(function (c) { return c.m === id; })) return toast('タイムラインで使っているテイクは消せません'); mark(); P.media = P.media.filter(function (x) { return x !== m; }); if (!HOST) IDB.del('files', id); if (S.takeSel === id) S.takeSel = null; changed(); }

/* 読み込んだときの準備（main.ts が順に呼ぶ） */
export function init() {
  if (HOST && HOST.rec) HOST.rec.onLevel(level);
}
