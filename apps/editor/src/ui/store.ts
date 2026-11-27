// @ts-nocheck
import { historyTick } from './history';
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { C, M, P } from './project';
import { S } from './state';
import { hm } from './util';
import { HOST, saveNow } from './desktop';
import { clampProg } from './engine';
import { draw } from './render';
import { toast } from './menus';

/* ================================================================
   ブラウザ内保存（IndexedDB）：素材ファイルとプロジェクト
   ================================================================ */
export var IDB;
export var saveTimer;
export function saveP(){historyTick();clearTimeout(saveTimer);if(HOST){if(HOST.project.current)saveTimer=setTimeout(saveNow,300);return;}saveTimer=setTimeout(function(){
  var o=JSON.parse(JSON.stringify(P,function(k,v){return k==='url'||k==='loading'?undefined:v;}));
  IDB.put('kv','project',o).then(function(ok){if(ok){S.savedAt=hm();var e=document.querySelector('[data-saved]');if(e)e.textContent='● 自動保存済み '+S.savedAt;}});},400);}

/* 元に戻す／やり直し（タイムラインと素材の評価・権利） */
export var HIST, REDO;
export function snap(){return JSON.stringify({tracks:P.tracks,clips:P.clips,pin:P.pin,pout:P.pout,bins:P.bins||[],media:P.media.map(function(m){return [m.id,m.inP,m.outP,m.rate,m.r,m.marks,m.bin];})});}
export function mark(){HIST.push(snap());if(HIST.length>100)HIST.shift();REDO=[];}
export function restore(s){var o=JSON.parse(s);P.tracks=o.tracks;P.clips=o.clips;P.pin=o.pin;P.pout=o.pout;P.bins=o.bins||[];o.media.forEach(function(a){var m=M(a[0]);if(m){m.inP=a[1];m.outP=a[2];m.rate=a[3];m.r=a[4];m.marks=a[5];if(a[6])m.bin=a[6];else delete m.bin;}});S.sel=S.sel.filter(function(id){return !!C(id);});}
export function undo(){if(!HIST.length)return toast('元に戻せる操作はありません');REDO.push(snap());restore(HIST.pop());changed();toast('元に戻しました');}
export function redo(){if(!REDO.length)return toast('やり直せる操作はありません');HIST.push(snap());restore(REDO.pop());changed();toast('やり直しました');}
export function changed(){clampProg();saveP();draw();}
/* ほかのモジュールから置き換えるための関数 */
export function setHIST(v){HIST=v;}
export function setREDO(v){REDO=v;}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
IDB={db:null,
  open:function(){return new Promise(function(res){try{var r=indexedDB.open('matsuko-editor',2);r.onupgradeneeded=function(){var db=r.result,has=function(n){return db.objectStoreNames.contains(n);};if(!has('files'))db.createObjectStore('files');if(!has('kv'))db.createObjectStore('kv');if(!has('history'))db.createObjectStore('history',{keyPath:'id',autoIncrement:true});};r.onsuccess=function(){IDB.db=r.result;res(true);};r.onerror=function(){res(false);};}catch(e){res(false);}});},
  op:function(store,mode,fn){return new Promise(function(res){if(!IDB.db)return res(null);try{var tx=IDB.db.transaction(store,mode),st=tx.objectStore(store),rq=fn(st);tx.oncomplete=function(){res(rq&&rq.result!==undefined?rq.result:true);};tx.onerror=tx.onabort=function(){res(null);};}catch(e){res(null);}});},
  get:function(s,k){return IDB.op(s,'readonly',function(st){return st.get(k);});},
  put:function(s,k,v){return IDB.op(s,'readwrite',function(st){return st.put(v,k);});},
  del:function(s,k){return IDB.op(s,'readwrite',function(st){return st.delete(k);});},
  clear:function(s){return IDB.op(s,'readwrite',function(st){return st.clear();});}};
saveTimer=null;
HIST=[];
REDO=[];
}
