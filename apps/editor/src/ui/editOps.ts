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
import * as K from '../core/timeline';

/* ================================================================
   タイムラインの編集操作（docs/timeline-spec.md）
   ================================================================ */
export var EPS;
/* 編集の処理は src/core/timeline.ts（型つき・テストあり）。ここは選択・元に戻す・通知など画面の側 */
export function rm(c){var i=P.clips.indexOf(c);if(i>=0)P.clips.splice(i,1);dropEl(c.id);}
export function ctx(){return {p:P,id:uid,removed:function(c){dropEl(c.id);}};}
export function linked(c){return K.linked(P,c);}
export function locked(c){return K.locked(P,c);}
/* 選択：リンク先も一緒に（alone=true なら単独） */
export function selIds(id,alone){var c=C(id);if(!c)return [];return [id].concat(alone?[]:linked(c).map(function(x){return x.id;}));}
export function selClips(){return S.sel.map(C).filter(function(c){return c&&!locked(c);});}
export function primary(){var L=S.sel.map(C).filter(Boolean);var v=L.filter(function(c){return T(c.tr)&&T(c.tr).kind==='v';});return v[v.length-1]||L[L.length-1]||null;}
/* トラック tid の [a,b) にあるクリップを上書きで削る（skip のクリップは除く） */
export function carve(tid,a,b,skip){K.carve(ctx(),tid,a,b,skip);}
export function splitClip(c,t){return K.splitClip(ctx(),c,t);}
/* 時刻 t で分割。リンクした組は、分けたあとも組のまま */
export function splitList(L,t){return K.splitList(ctx(),L,t);}
export function splitAt(t,ids){var L=K.splittable(P,t,ids&&ids.length?ids.map(C).filter(Boolean):activeAt(t));
  if(!L.length)return toast('再生ヘッドの位置に、分割できるクリップがありません');mark();var made=splitList(L,t);S.sel=made.map(function(c){return c.id;});changed();toast('分割しました');}
/* [a,b) を詰める。自分のトラックは必ず、ほかのトラックはその範囲が空いていれば詰める */
export function closeRange(tid,a,b){K.closeRange(P,tid,a,b);}
/* 時刻 t に長さ len の場所を空ける（ロックしていない全トラック。t をまたぐクリップは分割する） */
export function openRange(t,len,skip){K.openRange(ctx(),t,len,skip);}
export function delClips(ids,ripple){var L=ids.map(C).filter(function(c){return c&&!locked(c);});if(!L.length)return toast('削除するクリップを選んでください');mark();
  K.deleteClips(ctx(),L,ripple);
  S.sel=[];changed();toast(ripple?'削除して、後ろを詰めました':'削除しました（すき間は Shift＋Delete で詰められます）');}
/* トラック tid の時刻 t にあるすき間 [a,b) */
export function gapAt(tid,t){return K.gapAt(P,tid,t);}
/* 素材をトラックに置く（ins=true なら挿入、false なら上書き）。映像の素材は音声もリンクして置く */
export function freeAudio(a,b){return K.freeAudio(P,a,b);}
export function placeMedia(m,tid,start,a,b,ins){var r=K.placeMedia(ctx(),m,tid,start,a,b,ins);if(r.error){toast(r.error);return r.made;}if(r.made.length||!(b-a<0.05))S.sel=r.made.map(function(c){return c.id;});return r.made;}
/* V1 に挿入：選んだ V1 のクリップの後ろ、なければ V1 の最後 */
export function insPoint(){var p=primary();return p&&p.tr==='V1'?cEnd(p):v1End();}
export function insertSegs(m,segs,t0){var all=[],t=t0;segs.forEach(function(g){all=all.concat(placeMedia(m,'V1',t,g[0],g[1],true));t+=g[1]-g[0];});S.sel=all.map(function(c){return c.id;});return all;}
export function addToTimeline(m){if(!m.url&&!m.sample)return;if(m.loading)return toast('読み込みが終わるまでお待ちください');
  if(m.k==='音声'||m.k==='テイク'){var t=S.t.edit,len=m.d||5;if(!m.url)return toast('見本の音声は置けません');mark();var at=freeAudio(t,t+len);if(!at)return toast('音声トラックがありません');placeMedia(m,at,t,0,len,false);changed();toast('「'+m.n+'」を '+at+' の再生ヘッドの位置に置きました');return;}
  if(m.k!=='映像'&&m.k!=='画像')return toast('この種類の素材はタイムラインに置けません');
  if(T('V1')&&T('V1').lock)return toast('V1 がロックされています');
  var a=m.k==='画像'?0:(m.inP!=null?m.inP:0),b=m.k==='画像'?5:(m.outP!=null?m.outP:m.d),t0=insPoint();mark();insertSegs(m,[[a,b]],t0);changed();toast('「'+m.n+'」を V1 の '+tc(t0)+' に挿入しました');}
/* V1 の並べ替え（カットページの仮編集）：id のクリップを、to の前（after なら後ろ）へ移す */
export function reorderV1(id,toId,after){var c=C(id),tg=C(toId);if(!c||!tg||c===tg)return;var grp=[c].concat(linked(c)),len=cLen(c),a=c.start;mark();
  K.reorderV1(ctx(),c,tg,after);changed();}
/* テロップ：再生ヘッドの位置の、空いている映像トラック（V1 より上）に置く。なければトラックを足す */
export function addTitle(st,t,tid){mark();var c=K.addTitle(ctx(),st,t,tid),tr=T(c.tr);
  S.sel=[c.id];S.open.clip=1;if(S.page!=='edit')go('edit');changed();toast(TST[st]+'を '+tr.id+' に追加しました。右のインスペクタで文字を入力してください');
  var ta=document.getElementById('ttext');if(ta){ta.focus();ta.select();}}
/* トラックの追加・削除 */
export function addTrack(kind){return K.addTrack(P,kind);}
export function delTrack(id){var t=T(id);if(!t)return;var why=K.cannotDeleteTrack(P,t);if(why)return toast(why);mark();P.tracks.splice(P.tracks.indexOf(t),1);changed();}
/* コピー・貼り付け・複製 */
export function copySel(){var L=selClips();if(!L.length)return toast('コピーするクリップを選んでください');S.clipboard=K.copyClips(L);return L;}
export function pasteAt(t,src){src=src||S.clipboard;if(!src)return toast('貼り付けるものがありません');mark();var made=K.pasteClips(ctx(),t,src);
  if(!made.length){HIST.pop();return toast('貼り付けられるトラックがありません');}S.sel=made.map(function(c){return c.id;});changed();}
/* リンク：選んだクリップをまとめる／ほどく */
export function toggleLink(){var L=selClips();if(!L.length)return toast('クリップを選んでください');mark();
  if(L.some(function(c){return c.link;})){L.forEach(function(c){c.link=null;});changed();return toast('リンクを解除しました');}
  if(L.length<2){HIST.pop();return toast('リンクするクリップを2つ以上選んでください');}var k=uid('L');L.forEach(function(c){c.link=k;});changed();toast('リンクしました');}
/* 選んだクリップを dt 秒動かす（上書き） */
export function nudge(dt){var L=selClips();if(!L.length)return;if(L.some(function(c){return c.start+dt<-K.EPS;}))return;mark();K.nudge(ctx(),L,dt);changed();}
/* 拡大率（1秒あたりの画素数） */
export function zoomVal(){return Math.round(Math.log((S.pps||10)/2)/Math.log(200)*100);}
export function fitZoom(){var b=document.querySelector('[data-body]'),w=b?b.clientWidth:700;S.pps=Math.max(2,Math.min(400,(w-24)/Math.max(10,progDur())));S.tlx=0;}
export function zoomTo(p,at){var b=document.querySelector('[data-body]'),old=S.pps||10;p=Math.max(2,Math.min(400,p));if(at==null)at=S.t.edit;var px=b?at*old-b.scrollLeft:0;S.pps=p;S.tlx=Math.max(0,at*p-px);drawTL();}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
EPS=1e-6;
}
