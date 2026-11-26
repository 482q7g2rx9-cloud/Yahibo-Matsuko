// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { C, P, T, aTracks, activeAt, cEnd, cLen, hasAudio, onTrack, progDur, uid, v1End, vTracks } from './project';
import { S } from './state';
import { tc } from './util';
import { HIST, changed, mark } from './store';
import { TST, dropEl } from './engine';
import { drawTL } from './pages/edit';
import { go } from './render';
import { toast } from './menus';

/* ================================================================
   タイムラインの編集操作（docs/timeline-spec.md）
   ================================================================ */
export var EPS;
export function rm(c){var i=P.clips.indexOf(c);if(i>=0)P.clips.splice(i,1);dropEl(c.id);}
export function clone(c,o){var n=JSON.parse(JSON.stringify(c));for(var k in o)n[k]=o[k];return n;}
export function linked(c){return c&&c.link?P.clips.filter(function(x){return x.link===c.link&&x!==c;}):[];}
export function locked(c){var t=T(c.tr);return !t||!!t.lock;}
/* 選択：リンク先も一緒に（alone=true なら単独） */
export function selIds(id,alone){var c=C(id);if(!c)return [];return [id].concat(alone?[]:linked(c).map(function(x){return x.id;}));}
export function selClips(){return S.sel.map(C).filter(function(c){return c&&!locked(c);});}
export function primary(){var L=S.sel.map(C).filter(Boolean);var v=L.filter(function(c){return T(c.tr)&&T(c.tr).kind==='v';});return v[v.length-1]||L[L.length-1]||null;}
/* トラック tid の [a,b) にあるクリップを上書きで削る（skip のクリップは除く） */
export function carve(tid,a,b,skip){P.clips.slice().forEach(function(c){if(c.tr!==tid||skip&&skip[c.id])return;var s=c.start,e=cEnd(c);if(e<=a+EPS||s>=b-EPS)return;
  if(s>=a-EPS&&e<=b+EPS)rm(c);
  else if(s<a&&e>b){var c2=clone(c,{id:uid('c'),start:b,in:c.in+(b-s),link:null});c.out=c.in+(a-s);P.clips.push(c2);}
  else if(s<a)c.out=c.in+(a-s);
  else{c.in+=b-s;c.start=b;}});}
export function splitClip(c,t){if(t<=c.start+0.04||t>=cEnd(c)-0.04)return null;var c2=clone(c,{id:uid('c'),start:t,in:c.in+(t-c.start)});c.out=c.in+(t-c.start);P.clips.push(c2);return c2;}
/* 時刻 t で分割。リンクした組は、分けたあとも組のまま */
export function splitList(L,t){var re={},made=[];L.forEach(function(c){var c2=splitClip(c,t);if(!c2)return;if(c.link){re[c.link]=re[c.link]||uid('L');c2.link=re[c.link];}made.push(c2);});return made;}
export function splitAt(t,ids){var L=ids&&ids.length?ids.map(C).filter(Boolean):activeAt(t);L=L.filter(function(c){return !locked(c)&&t>c.start+0.04&&t<cEnd(c)-0.04;});
  if(!L.length)return toast('再生ヘッドの位置に、分割できるクリップがありません');mark();var made=splitList(L,t);S.sel=made.map(function(c){return c.id;});changed();toast('分割しました');}
/* [a,b) を詰める。自分のトラックは必ず、ほかのトラックはその範囲が空いていれば詰める */
export function closeRange(tid,a,b){var d=b-a;if(d<=EPS)return;P.tracks.forEach(function(tr){if(tr.lock)return;
  if(tr.id!==tid&&P.clips.some(function(c){return c.tr===tr.id&&c.start<b-EPS&&cEnd(c)>a+EPS;}))return;
  P.clips.forEach(function(c){if(c.tr===tr.id&&c.start>=b-EPS)c.start-=d;});});}
/* 時刻 t に長さ len の場所を空ける（ロックしていない全トラック。t をまたぐクリップは分割する） */
export function openRange(t,len,skip){var spans=P.clips.filter(function(c){return !(skip&&skip[c.id])&&!locked(c)&&c.start<t-EPS&&cEnd(c)>t+EPS;});splitList(spans,t);
  P.clips.forEach(function(c){if(skip&&skip[c.id]||locked(c))return;if(c.start>=t-EPS)c.start+=len;});}
export function delClips(ids,ripple){var L=ids.map(C).filter(function(c){return c&&!locked(c);});if(!L.length)return toast('削除するクリップを選んでください');mark();
  L.sort(function(a,b){return b.start-a.start;}).forEach(function(c){var a=c.start,b=cEnd(c),tid=c.tr;rm(c);if(ripple)closeRange(tid,a,b);});
  S.sel=[];changed();toast(ripple?'削除して、後ろを詰めました':'削除しました（すき間は Shift＋Delete で詰められます）');}
/* トラック tid の時刻 t にあるすき間 [a,b) */
export function gapAt(tid,t){var L=onTrack(tid),a=0;for(var i=0;i<L.length;i++){var s=L[i].start,e=cEnd(L[i]);if(t>=s-EPS&&t<e)return null;if(e<=t+EPS)a=Math.max(a,e);else if(s>t)return s-a>EPS?[a,s]:null;}return null;}
/* 素材をトラックに置く（ins=true なら挿入、false なら上書き）。映像の素材は音声もリンクして置く */
export function newClip(m,tid,start,a,b,link){return {id:uid('c'),tr:tid,type:'media',m:m.id,start:start,in:a,out:b,link:link||null};}
export function freeAudio(a,b){var L=aTracks().filter(function(t){return !t.lock;});return (L.filter(function(t){return !P.clips.some(function(c){return c.tr===t.id&&c.start<b-EPS&&cEnd(c)>a+EPS;});})[0]||L[0]||{}).id;}
export function placeMedia(m,tid,start,a,b,ins){var tr=T(tid),len=b-a,made=[];if(!tr||tr.lock){toast('ロックしたトラックには置けません');return made;}if(len<0.05)return made;start=Math.max(0,start);
  var isV=m.k==='映像'||m.k==='画像',vt=null,at=null,L=null;
  if(!isV)at=tr.kind==='a'?tid:freeAudio(start,start+len);
  else if(tr.kind==='a'){if(!hasAudio(m)){toast('この素材には音声がありません');return made;}at=tid;}
  else{vt=tid;if(hasAudio(m)){at=freeAudio(start,start+len);L=uid('L');}}
  if(ins)openRange(start,len);else{if(vt)carve(vt,start,start+len);if(at)carve(at,start,start+len);}
  if(vt)made.push(newClip(m,vt,start,a,b,at?L:null));if(at)made.push(newClip(m,at,start,a,b,vt?L:null));
  made.forEach(function(c){P.clips.push(c);});S.sel=made.map(function(c){return c.id;});return made;}
/* V1 に挿入：選んだ V1 のクリップの後ろ、なければ V1 の最後 */
export function insPoint(){var p=primary();return p&&p.tr==='V1'?cEnd(p):v1End();}
export function insertSegs(m,segs,t0){var t=t0,all=[];segs.forEach(function(g){all=all.concat(placeMedia(m,'V1',t,g[0],g[1],true));t+=g[1]-g[0];});S.sel=all.map(function(c){return c.id;});return all;}
export function addToTimeline(m){if(!m.url&&!m.sample)return;if(m.loading)return toast('読み込みが終わるまでお待ちください');
  if(m.k==='音声'||m.k==='テイク'){var t=S.t.edit,len=m.d||5;if(!m.url)return toast('見本の音声は置けません');mark();var at=freeAudio(t,t+len);if(!at)return toast('音声トラックがありません');placeMedia(m,at,t,0,len,false);changed();toast('「'+m.n+'」を '+at+' の再生ヘッドの位置に置きました');return;}
  if(m.k!=='映像'&&m.k!=='画像')return toast('この種類の素材はタイムラインに置けません');
  if(T('V1')&&T('V1').lock)return toast('V1 がロックされています');
  var a=m.k==='画像'?0:(m.inP!=null?m.inP:0),b=m.k==='画像'?5:(m.outP!=null?m.outP:m.d),t0=insPoint();mark();insertSegs(m,[[a,b]],t0);changed();toast('「'+m.n+'」を V1 の '+tc(t0)+' に挿入しました');}
/* V1 の並べ替え（カットページの仮編集）：id のクリップを、to の前（after なら後ろ）へ移す */
export function reorderV1(id,toId,after){var c=C(id),tg=C(toId);if(!c||!tg||c===tg)return;var grp=[c].concat(linked(c)),len=cLen(c),a=c.start;mark();
  grp.forEach(function(g){P.clips.splice(P.clips.indexOf(g),1);});closeRange('V1',a,a+len);
  var t=after?cEnd(tg):tg.start;openRange(t,len);grp.forEach(function(g){g.start=t;P.clips.push(g);});changed();}
/* テロップ：再生ヘッドの位置の、空いている映像トラック（V1 より上）に置く。なければトラックを足す */
export function addTitle(st,t,tid){t=Math.max(0,t||0);var d=st==='credit'?8:4,free=function(tr){return !tr.lock&&!P.clips.some(function(c){return c.tr===tr.id&&c.start<t+d-EPS&&cEnd(c)>t+EPS;});};
  mark();var tr=tid&&T(tid)&&T(tid).kind==='v'&&free(T(tid))?T(tid):vTracks().filter(function(x){return x.id!=='V1';}).reverse().filter(free)[0];if(!tr)tr=addTrack('v');
  var c={id:uid('t'),tr:tr.id,type:'title',start:t,in:0,out:d,st:st,sz:'中',label:{name:'名前・肩書き',q:'質問を入力',sub:'字幕を入力',credit:'出演\n協力\n制作'}[st]};
  P.clips.push(c);S.sel=[c.id];S.open.clip=1;if(S.page!=='edit')go('edit');changed();toast(TST[st]+'を '+tr.id+' に追加しました。右のインスペクタで文字を入力してください');
  var ta=document.getElementById('ttext');if(ta){ta.focus();ta.select();}}
/* トラックの追加・削除 */
export function addTrack(kind){var n=P.tracks.filter(function(t){return t.kind===kind;}).reduce(function(a,t){return Math.max(a,+t.id.slice(1)||0);},0)+1,t={id:(kind==='v'?'V':'A')+n,kind:kind,h:kind==='v'?48:44};
  if(kind==='v')P.tracks.unshift(t);else P.tracks.push(t);return t;}
export function delTrack(id){var t=T(id);if(!t)return;if(P.clips.some(function(c){return c.tr===id;}))return toast('クリップが残っているトラックは削除できません');
  if(P.tracks.filter(function(x){return x.kind===t.kind;}).length<=1)return toast('最後の'+(t.kind==='v'?'映像':'音声')+'トラックは削除できません');mark();P.tracks.splice(P.tracks.indexOf(t),1);changed();}
/* コピー・貼り付け・複製 */
export function copySel(){var L=selClips();if(!L.length)return toast('コピーするクリップを選んでください');var base=Math.min.apply(null,L.map(function(c){return c.start;}));S.clipboard={base:base,clips:JSON.parse(JSON.stringify(L))};return L;}
export function pasteAt(t,src){src=src||S.clipboard;if(!src)return toast('貼り付けるものがありません');var re={},made=[];mark();
  src.clips.forEach(function(o){var tr=T(o.tr);if(!tr||tr.lock)return;var c=clone(o,{id:uid('c'),start:t+(o.start-src.base)});if(o.link){re[o.link]=re[o.link]||uid('L');c.link=re[o.link];}carve(c.tr,c.start,cEnd(c));P.clips.push(c);made.push(c);});
  if(!made.length){HIST.pop();return toast('貼り付けられるトラックがありません');}S.sel=made.map(function(c){return c.id;});changed();}
/* リンク：選んだクリップをまとめる／ほどく */
export function toggleLink(){var L=selClips();if(!L.length)return toast('クリップを選んでください');mark();
  if(L.some(function(c){return c.link;})){L.forEach(function(c){c.link=null;});changed();return toast('リンクを解除しました');}
  if(L.length<2){HIST.pop();return toast('リンクするクリップを2つ以上選んでください');}var k=uid('L');L.forEach(function(c){c.link=k;});changed();toast('リンクしました');}
/* 選んだクリップを dt 秒動かす（上書き） */
export function nudge(dt){var L=selClips();if(!L.length)return;if(L.some(function(c){return c.start+dt<-EPS;}))return;mark();var skip={};L.forEach(function(c){skip[c.id]=1;c.start+=dt;});L.forEach(function(c){carve(c.tr,c.start,cEnd(c),skip);});changed();}
/* 拡大率（1秒あたりの画素数） */
export function zoomVal(){return Math.round(Math.log((S.pps||10)/2)/Math.log(200)*100);}
export function fitZoom(){var b=document.querySelector('[data-body]'),w=b?b.clientWidth:700;S.pps=Math.max(2,Math.min(400,(w-24)/Math.max(10,progDur())));S.tlx=0;}
export function zoomTo(p,at){var b=document.querySelector('[data-body]'),old=S.pps||10;p=Math.max(2,Math.min(400,p));if(at==null)at=S.t.edit;var px=b?at*old-b.scrollLeft:0;S.pps=p;S.tlx=Math.max(0,at*p-px);drawTL();}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
EPS=1e-6;
}
