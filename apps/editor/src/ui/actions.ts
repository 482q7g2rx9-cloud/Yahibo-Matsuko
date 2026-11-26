// @ts-nocheck
import { openHistory, restoreHistory } from './history';
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { D } from './data';
import { C, M, P, T, cEnd, cLen, emptyProject, isUsed, progDur, sampleProject } from './project';
import { S } from './state';
import { h, mmss, tc } from './util';
import { IDB, changed, mark, redo, saveP, undo } from './store';
import { openPicker } from './importWeb';
import { HOST, JOBS, createProject, ensureProject, newProjectDlg, openProject, relink, saveNow } from './desktop';
import { E, heads, progPlay, progStop, setProg } from './engine';
import { REC, fxPlay, rec, setREC, srcPlay, srcSeek, stopAll } from './source';
import { addTitle, addToTimeline, addTrack, carve, closeRange, copySel, delClips, delTrack, fitZoom, insPoint, insertSegs, linked, locked, pasteAt, primary, rm, selIds, splitAt, toggleLink, zoomTo } from './editOps';
import { X, presetX, saveJob, xCancel, xPause, xStart } from './exporter';
import { PROPS, detectSilence, drawTL, keepSegs, propVal, selTitle, setProp } from './pages/edit';
import { newJob } from './pages/export';
import { draw, go } from './render';
import { applyDesign, ask, infoDlg, openCx, resetProject, toast } from './menus';
import { KB, KEYMAP, loadKeys, saveKeys } from './keys';
import { PREF, openPrefs, renderPrefs, savePref } from './prefs';
import { fit } from './fit';

/* ---------- 操作 ---------- */
export var ACT;
/* 前・次の編集点（クリップの端） */
export function jump(dir){var pts=[0,progDur()];P.clips.forEach(function(c){pts.push(c.start,cEnd(c));});pts.sort(function(a,b){return a-b;});var t=S.t.edit,n=dir<0?pts.filter(function(c){return c<t-0.02;}).pop():pts.filter(function(c){return c>t+0.02;})[0];if(n!=null){if(E.playing)progStop();setProg(n);heads(true);}}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
ACT={
  go:go,
  bin:function(v){S.bin=v;draw();},mrow:function(v){S.media=v;draw();},mview:function(v){S.mview=v;draw();},
  imp:openPicker,addtl:function(v){var m=M(v);if(m)addToTimeline(m);},
  mdel:function(v){var m=M(v);if(!m)return;if(isUsed(m))return toast('タイムラインで使っているため削除できません。先にクリップを削除してください');
    ask('素材を削除','「'+m.n+'」をプロジェクトから削除します。元のファイルはパソコンに残ります。','削除',function(){if(HOST){HOST.media.cancel([m.id]);delete JOBS[m.id];}else{if(m.url)URL.revokeObjectURL(m.url);IDB.del('files',m.id);}delete E.imgs[m.id];P.media=P.media.filter(function(x){return x!==m;});S.media=P.media[0]?P.media[0].id:null;if(S.src===m.id)S.src=null;saveP();draw();});},
  ctab:function(v){S.ctab=v;draw();},cflt:function(v){S.cflt=v;draw();},
  scene:function(v){S.scene=v;var s=D.scenes.filter(function(x){return x.id===v;})[0];if(s.m&&M(s.m)){stopAll();S.src=s.m;S.t.cut=0;}draw();},
  csrc:function(v){if(S.src!==v){stopAll();S.src=v;S.t.cut=0;}var s=D.scenes.filter(function(x){return x.m===v;})[0];if(s)S.scene=s.id;draw();},
  rsel:function(v){S.sel=selIds(v);draw();},
  rate:function(v){var m=M(S.src);if(m){mark();m.rate=v;saveP();}draw();},
  mark:function(v){var k=D.clip.marks[+v];k.done=!k.done;draw();},
  delAll:function(){var m=M(S.src);if(m&&!m.sample&&m.marks&&m.marks.length){mark();m.marks.forEach(function(k){k.done=true;});saveP();draw();return toast('見つかった無音 '+m.marks.length+'件をすべて削除にしました');}if(!(m&&m.sample&&m.id==='v03'))return toast('先に「無音を検出」を押してください');D.clip.marks.forEach(function(k){k.done=true;});draw();toast('不要部分を削除しました');},
  setIn:function(){var m=M(S.src);if(!m||m.k==='画像')return;mark();m.inP=Math.min(S.t.cut,(m.outP!=null?m.outP:m.d)-0.1);saveP();draw();},
  setOut:function(){var m=M(S.src);if(!m||m.k==='画像')return;mark();m.outP=Math.max(S.t.cut,(m.inP||0)+0.1);saveP();draw();},
  cutIns:function(){var m=M(S.src);if(!m)return toast('ソースの素材を選んでください');if(m.loading)return;if(T('V1')&&T('V1').lock)return toast('V1 がロックされています');var a=m.k==='画像'?0:(m.inP||0),b=m.k==='画像'?5:(m.outP!=null?m.outP:m.d);
    if(b-a<0.1)return toast('イン点とアウト点の間が短すぎます');var sg=m.k==='画像'?[[a,b]]:keepSegs(m,a,b);if(!sg.length)return toast('無音を除くと残る部分がありません');
    mark();insertSegs(m,sg,insPoint());changed();var tl=sg.reduce(function(s2,g){return s2+g[1]-g[0];},0);toast(sg.length>1?'無音を除いて '+sg.length+' カットで追加しました（'+mmss(tl)+'）':'仮編集に追加しました（'+mmss(tl)+'）');},
  cutOvr:function(){var m=M(S.src),p=primary();if(!m)return;if(!p||p.tr!=='V1')return toast('上書きするカットを仮編集で選んでください');var a=m.k==='画像'?0:(m.inP||0),b=m.k==='画像'?5:(m.outP!=null?m.outP:m.d),t0=p.start,grp=[p].concat(linked(p));
    mark();grp.forEach(function(g){rm(g);});closeRange('V1',t0,t0+cLen(p));insertSegs(m,m.k==='画像'?[[a,b]]:keepSegs(m,a,b),t0);changed();toast('カットを上書きしました');},
  detect:function(){var m=M(S.src);if(!m)return;var r=detectSilence(m);if(!r)return toast(m.sample?'見本の素材では検出できません':'この素材は音声の波形がないため検出できません');mark();m.marks=r;saveP();draw();toast(r.length?'無音を '+r.length+'件見つけました。削除する部分を選んでください':'無音は見つかりませんでした（音量や長さの設定を変えてみてください）');},
  smk:function(v){var m=M(S.src);if(!m||!m.marks)return;mark();m.marks[+v].done=!m.marks[+v].done;saveP();draw();},
  pin:function(){if(S.page!=='edit')return;mark();P.pin=S.t.edit;if(P.pout!=null&&P.pout<=P.pin)P.pout=null;saveP();draw();toast('イン点を '+tc(P.pin)+' にしました');},
  pout:function(){if(S.page!=='edit')return;mark();P.pout=S.t.edit;if(P.pin!=null&&P.pin>=P.pout)P.pin=null;saveP();draw();toast('アウト点を '+tc(P.pout)+' にしました');},
  pclear:function(){mark();P.pin=P.pout=null;saveP();draw();toast('書き出し範囲を消去しました');},
  addTitle:function(v){addTitle(v||'name',S.t.edit);},
  tToHead:function(){var c=selTitle();if(!c)return;mark();c.start=S.t.edit;carve(c.tr,c.start,cEnd(c),(function(){var o={};o[c.id]=1;return o;})());changed();},
  delSel:function(){delClips(S.sel.slice(),false);},rdel:function(){delClips(S.sel.slice(),true);},
  split:function(){if(S.page!=='edit')go('edit');var ids=S.sel.filter(function(id){var c=C(id);return c&&S.t.edit>c.start&&S.t.edit<cEnd(c);});splitAt(S.t.edit,ids);},
  copy:function(){if(copySel())toast('コピーしました');},cut2:function(){if(copySel())delClips(S.sel.slice(),false);},paste:function(){pasteAt(S.t.edit);},
  dup:function(){var L=copySel();if(!L)return;var end=Math.max.apply(null,L.map(cEnd));pasteAt(end);},
  selAll:function(){S.sel=P.clips.filter(function(c){return !locked(c);}).map(function(c){return c.id;});draw();},
  lnk:function(){toggleLink();},
  snapT:function(){S.snap=!S.snap;draw();toast('スナップを'+(S.snap?'入れました':'切りました'));},
  zin:function(){zoomTo((S.pps||10)*1.5);},zout:function(){zoomTo((S.pps||10)/1.5);},zfit:function(){fitZoom();drawTL();},
  addTrk:function(){var b=document.querySelector('[data-a="addTrk"]'),r=b?b.getBoundingClientRect():{left:300,bottom:300};openCx(r.left,r.bottom,[['映像トラックを追加','addV'],['音声トラックを追加','addA']]);},
  addV:function(){mark();var t=addTrack('v');changed();toast(t.id+' を追加しました');},addA:function(){mark();var t=addTrack('a');changed();toast(t.id+' を追加しました');},
  delTrk:function(){if(S.cxTrack)delTrack(S.cxTrack);},
  gapClose:function(){var g=S.cxGap;if(!g)return;mark();closeRange(g.tr,g.a,g.b);changed();toast('すき間を詰めました');},
  pasteHere:function(){var g=S.cxAt;if(g!=null)pasteAt(g);},
  thide:function(v){var t=T(v);if(!t)return;mark();t.hide=!t.hide;changed();},tlock:function(v){var t=T(v);if(!t)return;mark();t.lock=!t.lock;if(t.lock)S.sel=S.sel.filter(function(id){var c=C(id);return c&&c.tr!==v;});changed();},
  tmute:function(v){var t=T(v);if(!t)return;mark();t.mute=!t.mute;changed();},tsolo:function(v){var t=T(v);if(!t)return;mark();t.solo=!t.solo;changed();},
  cstep:function(v){var a=String(v).split('|'),c=C(a[0]),k=a[1];if(!c||!PROPS[k])return;mark();setProp(a[0],k,propVal(c,k)+(+a[2])*PROPS[k].step);drawTL();},
  kfTodo:function(){toast('キーフレームは、エフェクトページの本実装で使えるようになります');},
  mreset:function(v){var c=C(v);if(!c)return;mark();['x','y','scale','rot','op'].forEach(function(k){delete c[k];});changed();},
  keys:function(){openPrefs('keys');},prefs:function(){openPrefs();},ptab:function(v){S.ptab=v;S.capture=null;S.kFocus=null;renderPrefs.st=0;renderPrefs();},
  pUi:function(v){PREF.ui=+v;savePref();fit();draw();renderPrefs();},pTheme:function(v){S.theme=v;applyDesign();renderPrefs();},pAcc:function(v){S.accent=v;applyDesign();renderPrefs();},
  kSet:function(v){S.capture=v;S.kFocus=v;renderPrefs();},kCancel:function(){S.capture=null;renderPrefs();},kReset:function(v){var k=KB.filter(function(x){return x[0]===v;})[0];if(k){KEYMAP[v]=k[3].slice();saveKeys();}renderPrefs();},
  kResetAll:function(){try{localStorage.removeItem('matsuko.keys');}catch(e){}loadKeys();renderPrefs();toast('ショートカットを初期設定に戻しました');},
  undo:undo,redo:redo,
  sfb:function(){srcSeek(S.t.cut-1/30);},sff:function(){srcSeek(S.t.cut+1/30);},
  etab:function(v){S.etab=v;draw();},tool:function(v){S.tool=v;draw();if(v==='text')toast('タイムラインをクリックした位置にテロップを追加します');},
  sec:function(v){S.open[v]=!S.open[v];draw();},
  fxg:function(v){S.fxClosed[v]=!S.fxClosed[v];draw();},fxi:function(v){S.fx=v;draw();},ba:function(v){S.ba=v;draw();},kfm:function(v){S.kfMode=v;draw();},
  rmode:function(v){S.rmode=v;draw();},line:function(v){S.line=+v;draw();},tsel:function(v){S.tsel=+v;draw();},take:function(v){S.take=+v;S.tsel=+v;draw();},
  mute:function(v){S.mute[v]=!S.mute[v];draw();},solo:function(v){S.solo[v]=!S.solo[v];draw();},
  rec:rec,stop:function(){if(REC){clearInterval(REC);setREC(null);draw();}},recTop:function(){S.rec=0;var e=document.querySelector('[data-rec]');if(e)e.textContent=tc(0);},
  play:function(){if(S.page==='cut')srcPlay();else if(S.page==='fx')fxPlay();else progPlay();},
  prev:function(){jump(-1);},next:function(){jump(1);},fb:function(){if(E.playing)progStop();setProg(S.t.edit-1/30);},ff:function(){if(E.playing)progStop();setProg(S.t.edit+1/30);},
  top:function(){setProg(0);},end:function(){setProg(progDur());},
  preset:function(v){S.preset=+v;S.x=presetX(S.preset);draw();},
  qadd:function(){var j=newJob();if(j){draw();toast('キューに追加しました');}},
  xrun:function(){var j=newJob();if(!j)return;draw();if(X&&X.run)toast('いまの書き出しが終わったら始めます');else xStart(j);},
  xpause:function(){xPause();},xcancel:function(){xCancel();},
  xdel:function(v){S.queue=S.queue.filter(function(q){return q.id!==v;});draw();},
  xsave:function(v){saveJob(S.queue.filter(function(q){return q.id===v;})[0]);},
  xview:function(v){stopAll();S.xplay=v;draw();},xback:function(){S.xplay=null;draw();},
  chk:function(){S.bin='wn';var w=P.media.filter(function(m){return m.r==='wn';})[0];if(w)S.media=w.id;go('media');},
  link:function(){S.linked=true;draw();},
  save:function(){if(HOST){if(!HOST.project.current)return ensureProject().then(saveNow);saveNow().then(function(ok){if(ok)toast('保存しました');});return;}saveP();toast('保存しました');},
  open:function(){if(HOST)openProject(function(){return HOST.project.openDialog();});},
  npLoc:function(){newProjectDlg.pick();},npOk:function(){createProject();},relink:function(v){var m=M(v);if(m&&HOST)relink(m);},
  new:function(){if(HOST)return newProjectDlg();ask('新規プロジェクト','いまのプロジェクト（読み込んだ素材とタイムライン）を消して、空のプロジェクトを始めます。元のファイルはパソコンに残ります。','新規作成',function(){resetProject(emptyProject());go('media');});},
  sample:function(){ask('見本プロジェクトを開く','いまのプロジェクトを消して、見本プロジェクトに戻します。','開く',function(){resetProject(sampleProject());});},
  about:function(){var host=window.MatsukoHost;
    var show=function(rows){infoDlg('Matsuko Editor',rows.map(function(r){return '<div class="kv" style="padding:0"><span>'+h(r[0])+'</span><span style="word-break:break-all">'+h(r[1])+'</span></div>';}).join(''));};
    if(host&&host.envInfo)host.envInfo().then(function(i){show([['版',i.appVersion+'（デスクトップ版）'],['OS',i.os+' / '+i.arch],['FFmpeg',i.ffmpeg||'見つかりません'],['FFprobe',i.ffprobe||'見つかりません']]);}).catch(function(e){show([['版','デスクトップ版'],['エラー',String(e)]]);});
    else show([['版','ブラウザ版（試作）'],['動作環境',navigator.userAgent]]);},
  help:function(){toast('メディアで読み込み → カットでイン・アウトを決めて追加 → 編集で並べ替え・分割 → 出力で書き出し');},
  dlgOk:function(){document.getElementById('dlg').hidden=true;var f=ask.fn;ask.fn=null;if(f)f();},dlgNo:function(){document.getElementById('dlg').hidden=true;ask.fn=null;S.capture=null;if(S.page==='edit')draw();},
  hist:function(){openHistory();},hRestore:function(v){restoreHistory(v);},
  todo:function(){toast('この機能は、まだ使えません');}
};
}
