// @ts-nocheck
import { SYS_PREFIX, canQueryLocalFonts, fontById, queryLocalFonts, systemFontsState } from './titleStyles';
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { D } from './data';
import { C, M, T, cEnd } from './project';
import { S } from './state';
import { HIST, changed, mark, saveP } from './store';
import { importFiles } from './importWeb';
import { HOST } from './desktop';
import { redrawProg } from './engine';
import { addToTimeline, carve, gapAt, locked, placeMedia, reorderV1, selClips, selIds, zoomTo } from './editOps';
import { drawTL, selTitle, setProp, syncTLScroll } from './pages/edit';
import { draw, go } from './render';
import { closeMenu, mbOpen, menuAct, openCx, openMenu, toast } from './menus';
import { KEY_GLOBAL, actionFor, comboOf, runKey } from './keys';
import { PREF, assignKey, renderPrefs, savePref } from './prefs';
import { ACT } from './actions';
import { bodyPos, rowAt, snapBy, snapPts } from './pointer';
import { SCALE } from './fit';

/* 画面の中のドラッグ（仮編集の並べ替え・素材をタイムラインへ）はマウス操作だけで行う。
   デスクトップ版（Windows）では OS からのファイルのドロップを受けると HTML のドラッグ＆ドロップが使えなくなるため。
   ファイルの読み込みは、ブラウザ版は HTML のドロップ、デスクトップ版は MatsukoHost.onFileDrag で受ける */
export function dtHas(e,t){return [].indexOf.call(e.dataTransfer.types,t)>=0;}
export function dropInfo(e){var mid=S.dragMedia,m=mid&&M(mid);var p=bodyPos(e),row=rowAt(p.y),t=Math.max(0,p.x/(S.pps||10));return {m:m,row:row,t:t,p:p};}
export function ghostAt(e){var g=document.querySelector('[data-ghost]'),i=dropInfo(e);if(!g)return;if(!i.row){g.hidden=true;S.dropT=null;return;}
  var m=i.m,len=m?(m.k==='画像'?5:(m.outP!=null?m.outP:m.d)-(m.inP||0)):4,t=i.t,sk={};
  var sb=snapBy([t,t+len],snapPts(sk));if(sb)t+=sb.d;S.dropT=t;g.hidden=false;g.style.cssText='left:'+(t*(S.pps||10))+'px;top:'+i.row.y+'px;width:'+Math.max(4,len*(S.pps||10))+'px;height:'+i.row.h+'px';}
export function dropMedia(e){var m=M(S.dragMedia),i=dropInfo(e),g=document.querySelector('[data-ghost]');if(g)g.hidden=true;if(!m||!i.row)return;if(m.loading)return toast('読み込みが終わるまでお待ちください');
  var a=m.k==='画像'?0:(m.inP||0),b=m.k==='画像'?5:(m.outP!=null?m.outP:m.d);mark();var made=placeMedia(m,i.row.id,S.dropT!=null?S.dropT:i.t,a,b,e.ctrlKey||e.metaKey);if(!made.length){HIST.pop();return;}changed();}
export var PD;
export function pdUnder(e,sel){var f=document.getElementById('dragf');if(f)f.style.display='none';var el=document.elementFromPoint(e.clientX,e.clientY);if(f)f.style.display='';return el&&el.closest&&el.closest(sel);}
export function pdMarks(){[].forEach.call(document.querySelectorAll('.dragl,.dragr'),function(x){x.classList.remove('dragl','dragr');});}
export function pdEnd(e,ok){var d=PD;PD=null;if(!d||!d.on)return;var f=document.getElementById('dragf');if(f)f.remove();document.body.classList.remove('dragging');pdMarks();
  /* ドラッグの後のクリック（選択など）は起こさない */
  var stop=function(x){x.stopPropagation();x.preventDefault();};document.addEventListener('click',stop,true);setTimeout(function(){document.removeEventListener('click',stop,true);},0);
  if(ok&&d.kind==='cut'){var t=pdUnder(e,'[data-rc]');if(t&&t.dataset.rc!==d.id){var rc=t.getBoundingClientRect();reorderV1(d.id,t.dataset.rc,e.clientX>rc.left+rc.width/2);}}
  else if(ok&&pdUnder(e,'[data-body]'))dropMedia(e);
  var g=document.querySelector('[data-ghost]');if(g)g.hidden=true;S.dropT=null;S.dragMedia=null;}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
document.addEventListener('wheel',function(e){var b=e.target.closest&&e.target.closest('[data-body],[data-rul]');if(!b||!(e.ctrlKey||e.metaKey))return;e.preventDefault();var bd=document.querySelector('[data-body]'),r=bd.getBoundingClientRect(),at=((e.clientX-r.left)/SCALE+bd.scrollLeft)/(S.pps||10);zoomTo((S.pps||10)*(e.deltaY<0?1.25:0.8),at);},{passive:false});
document.addEventListener('scroll',function(e){var t=e.target;if(t&&t.matches&&t.matches('[data-body]')){S.tlx=t.scrollLeft;S.tly=t.scrollTop;syncTLScroll();}},true);
PD=null;
document.addEventListener('pointerdown',function(e){if(e.button!==0)return;var r=e.target.closest&&e.target.closest('[data-rc]'),a=!r&&e.target.closest&&e.target.closest('[data-am]');if(!r&&!a)return;
  var id=r?r.dataset.rc:a.dataset.am,c=r&&C(id),mm=r?(c&&c.m&&M(c.m)):M(id);PD={kind:r?'cut':'media',id:id,x:e.clientX,y:e.clientY,on:false,label:mm?mm.n:''};});
document.addEventListener('pointermove',function(e){if(!PD)return;
  if(!PD.on){if(Math.abs(e.clientX-PD.x)+Math.abs(e.clientY-PD.y)<5)return;PD.on=true;if(PD.kind==='media')S.dragMedia=PD.id;
    var f=document.createElement('div');f.id='dragf';f.className='dragf';f.textContent=PD.label||'クリップ';document.getElementById('app').appendChild(f);document.body.classList.add('dragging');}
  e.preventDefault();var ar=document.getElementById('app').getBoundingClientRect(),f=document.getElementById('dragf');if(f){f.style.left=((e.clientX-ar.left)/SCALE+12)+'px';f.style.top=((e.clientY-ar.top)/SCALE+12)+'px';}
  if(PD.kind==='cut'){pdMarks();var t=pdUnder(e,'[data-rc]');if(t&&t.dataset.rc!==PD.id){var rc=t.getBoundingClientRect();t.classList.add(e.clientX>rc.left+rc.width/2?'dragr':'dragl');}return;}
  if(pdUnder(e,'[data-body]'))ghostAt(e);else{var g=document.querySelector('[data-ghost]');if(g)g.hidden=true;S.dropT=null;}});
document.addEventListener('pointerup',function(e){pdEnd(e,true);});
document.addEventListener('pointercancel',function(e){pdEnd(e,false);});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&PD&&PD.on){e.stopPropagation();pdEnd(e,false);}},true);
document.addEventListener('dragover',function(e){if(dtHas(e,'Files')){e.preventDefault();if(!HOST)document.getElementById('drop').hidden=false;}});
document.addEventListener('dragleave',function(e){if(!e.relatedTarget)document.getElementById('drop').hidden=true;});
document.addEventListener('drop',function(e){if(!dtHas(e,'Files'))return;e.preventDefault();document.getElementById('drop').hidden=true;if(HOST)return;
  if(e.dataTransfer.files&&e.dataTransfer.files.length){importFiles(e.dataTransfer.files);if(S.page!=='media'&&S.page!=='edit'&&S.page!=='cut')go('media');}});
document.addEventListener('click',function(e){
  var m=e.target.closest('[data-menu]');if(m){mbOpen===m.dataset.menu?closeMenu():openMenu(m);return;}
  var it=e.target.closest('.it');if(it){if(!it.disabled)menuAct(it.dataset.m);return;}
  if(!e.target.closest('.dd'))closeMenu();
  if(e.target.closest('[data-body]')&&!e.target.closest('[data-a]'))return;
  var a=e.target.closest('[data-a]'),fe=e.target.closest('input,select,textarea,label');if(fe&&a&&!fe.contains(a)&&fe!==a)return;
  var ib=e.target.closest('button');if(ib&&a&&!ib.hasAttribute('data-a')&&a.contains(ib)){toast('この機能は、まだ使えません');return;}
  if(a&&ACT[a.dataset.a]){if(a.tagName==='INPUT'&&a.type==='radio'){ACT[a.dataset.a](a.dataset.v);return;}e.preventDefault();ACT[a.dataset.a](a.dataset.v);return;}
  var b=e.target.closest('button');if(b&&!b.closest('#mb')&&!b.disabled&&b.closest('#page'))toast('この機能は、まだ使えません');
});
document.addEventListener('dblclick',function(e){var r=e.target.closest('[data-a="mrow"]');if(r){var m=M(r.dataset.v);if(m)addToTimeline(m);}});
document.addEventListener('mouseover',function(e){var m=e.target.closest&&e.target.closest('[data-menu]');if(m&&mbOpen!==null&&mbOpen!==m.dataset.menu)openMenu(m);});
document.addEventListener('contextmenu',function(e){
  if(e.target.closest('[data-kfarea]')){e.preventDefault();closeMenu();openCx(e.clientX,e.clientY);return;}
  var th=e.target.closest('[data-trh]');if(th){e.preventDefault();closeMenu();S.cxTrack=th.dataset.trh;openCx(e.clientX,e.clientY,[['映像トラックを追加','addV'],['音声トラックを追加','addA'],'-',[th.dataset.trh+' を削除','delTrk']]);return;}
  var bd=e.target.closest('[data-body]');if(!bd)return;e.preventDefault();closeMenu();var p=bodyPos(e),t=p.x/(S.pps||10),row=rowAt(p.y),ce=e.target.closest('[data-c]'),c=ce&&C(ce.dataset.c);
  if(c&&!locked(c)){if(S.sel.indexOf(c.id)<0){S.sel=selIds(c.id,e.altKey);draw();}var many=S.sel.length>1;
    openCx(e.clientX,e.clientY,[['再生ヘッドで分割','split','S'],'-',['切り取り','cut2','Ctrl+X'],['コピー','copy','Ctrl+C'],['複製','dup','Ctrl+D'],'-',['削除','delSel','Delete'],['削除して詰める','rdel','Shift+Delete'],'-',[selClips().some(function(x){return x.link;})?'リンク解除':(many?'リンク':'リンク（2つ以上選んでください）'),'lnk','Ctrl+L','',!many&&!selClips().some(function(x){return x.link;})]]);return;}
  var g=row&&gapAt(row.id,t);S.cxGap=g?{tr:row.id,a:g[0],b:g[1]}:null;S.cxAt=t;
  openCx(e.clientX,e.clientY,[['すき間を詰める','gapClose','','',!g||locked({tr:row.id})],['ここに貼り付け','pasteHere','','',!S.clipboard],'-',['映像トラックを追加','addV'],['音声トラックを追加','addA']]);});
document.addEventListener('input',function(e){var k=e.target.dataset&&e.target.dataset.in;if(!k)return;
  if(k==='mq'){S.mq=e.target.value;draw();}else if(k==='eq'){S.eq=e.target.value;draw();}
  else if(k==='memo'){var m=M(S.src);if(m){m.memo=e.target.value;saveP();}}else if(k==='xfile'){S.x.file=e.target.value;}
  else if(k==='zoom'){var v=+e.target.value;zoomTo(2*Math.pow(200,v/100));}
  else if(k==='cp'){setProp(e.target.dataset.cid,e.target.dataset.k,parseFloat(e.target.value));}
  else if(k==='ttext'){var ti=selTitle();if(ti){ti.label=e.target.value;saveP();redrawProg();}}});
document.addEventListener('focusin',function(e){var k=e.target.dataset&&e.target.dataset.in;if(k==='ttext'||k==='cp'&&Date.now()-(S.rgMark||0)>500)mark();});
document.addEventListener('change',function(e){var k=e.target.dataset&&e.target.dataset.in;if(!k)return;
  if(k==='mtype'){S.mtype=e.target.value;draw();}else if(k==='msort'){S.msort=e.target.value;draw();}else if(k==='countin')S.countin=e.target.checked;
  else if(k==='tfont'){var tf=selTitle();if(tf){mark();tf.font=e.target.value;if(fontById(tf.font).weight)delete tf.weight;changed();}}
  else if(k==='trk'){var tc=selClipXin();if(tc){mark();tc.xin.k=e.target.value;changed();}}
  else if(k==='tfontname'){var tn=selTitle(),fn=e.target.value.replace(/["\\]/g,'').trim();if(tn&&fn){mark();tn.font=SYS_PREFIX+fn;changed();}}
  else if(k==='tst'||k==='tsz'||k==='tstart'||k==='tdur'){var ti=selTitle();if(ti){mark();if(k==='tst')ti.st=e.target.value;else if(k==='tsz')ti.sz=e.target.value;else if(k==='tstart')ti.start=Math.max(0,+e.target.value||0);else ti.out=ti.in+Math.max(0.5,+e.target.value||0.5);var sk={};sk[ti.id]=1;carve(ti.tr,ti.start,cEnd(ti),sk);changed();}}
  else if(k==='ttext'||k==='cp'){drawTL();}
  else if(k==='pSnap'){PREF.snap=e.target.checked;S.snap=PREF.snap;savePref();}else if(k==='pFollow'){PREF.follow=e.target.checked;savePref();}
  else if(k==='silthr'||k==='silmin'){S.sil[k==='silthr'?'thr':'min']=e.target.value;draw();}
  else if(k==='rights'){var m=M(S.media);if(m){mark();m.r=e.target.value;saveP();draw();}}
  else if(k.charAt(0)==='x'&&k!=='xfile'){S.x[k.slice(1)]=e.target.value;draw();}});
document.getElementById('fileIn').addEventListener('change',function(e){importFiles(e.target.files);});
document.addEventListener('keydown',function(e){
  if(S.capture){e.preventDefault();e.stopPropagation();if(e.key==='Escape'){S.capture=null;renderPrefs();return;}var k=comboOf(e);if(!k)return;assignKey(S.capture,k);S.capture=null;renderPrefs();return;}
  if(e.key==='Escape'){closeMenu();if(!document.getElementById('dlg').hidden)ACT.dlgNo();else if(S.page==='edit'&&S.sel.length){S.sel=[];draw();}return;}
  var dd=e.target.closest&&e.target.closest('.dd');
  if(dd&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();var L=[].filter.call(dd.querySelectorAll('.it'),function(x){return !x.disabled;}),i=L.indexOf(e.target);(L[(i+(e.key==='ArrowDown'?1:-1)+L.length)%L.length]).focus();return;}
  if(e.altKey&&/^[1-7]$/.test(e.key)){e.preventDefault();go(D.pages[+e.key-1][0]);return;}
  var c=comboOf(e),a=c&&actionFor(c);
  /* 保存・読み込み・書き出し・環境設定は、入力欄の中でも効く */
  if(a&&KEY_GLOBAL[a]){runKey(a,e);return;}
  var tag=e.target.tagName,ty=e.target.type;if(tag==='TEXTAREA'||tag==='SELECT'||tag==='INPUT'&&ty!=='range'&&ty!=='checkbox'&&ty!=='radio')return;
  if(tag==='INPUT'&&/^Arrow/.test(e.key)&&ty==='range')return;
  if(!document.getElementById('dlg').hidden)return;
  if(a&&!(a==='play'&&e.target.getAttribute('role')==='button')){runKey(a,e);return;}
  if((e.key==='Enter'||e.key===' ')&&e.target.getAttribute('role')==='button'){e.preventDefault();e.target.click();}
});
}

/* ブラウザ版：フォントの一覧を開こうとしたときに、PC のフォントを自動で読みに行く。
   ブラウザは、使う人の操作（クリック・キー）の中でしか一覧を読ませてくれないため、ここで呼ぶ。
   初めてのときはブラウザが許可を求め、許可すると一覧に PC のフォントが加わる（次からは起動時に読む） */
function wantSysFonts(e){var t=e.target;if(HOST||!t||!t.dataset||t.dataset.in!=='tfont')return;
  if(!canQueryLocalFonts()||systemFontsState()!=='none')return;
  queryLocalFonts().then(function(){draw();});}
document.addEventListener('pointerdown',wantSysFonts,true);
document.addEventListener('keydown',wantSysFonts,true);

/* インスペクタのトランジションの種類：選んでいる映像のクリップ（つなぎ目の後ろ） */
function selClipXin(){var c=S.sel.map(C).filter(function(x){return x&&x.xin&&T(x.tr)&&T(x.tr).kind==='v';})[0];return c||null;}
