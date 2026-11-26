// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { D } from './data';
import * as K from '../core/timeline';
import { uid as coreUid } from '../core/model';
import { defTracks, emptyProject, migrate } from '../core/project';
export { defTracks, emptyProject, migrate };

/* ---------- プロジェクト ----------
   トラックは画面の上から V3, V2, V1, A1, A2, A3。映像は番号の大きいトラックが上に重なる。
   クリップは start（タイムライン上の開始）と in / out（素材の中の範囲）を持ち、1つのトラックの中では重ならない。
   仕様：docs/timeline-spec.md */
export function sampleProject(){var cl=[];
  [['c1','v01',0,0,24],['c2','v02',24,0,17],['c3','v03',41,41,95],['c4','v04',95,0,25]].forEach(function(x){
    cl.push({id:x[0],tr:'V1',type:'media',m:x[1],start:x[2],in:x[3],out:x[4],link:'L'+x[0]},{id:x[0]+'a',tr:'A1',type:'media',m:x[1],start:x[2],in:x[3],out:x[4],link:'L'+x[0]});});
  cl.push({id:'t1',tr:'V2',type:'title',start:24,in:0,out:10,st:'name',label:'創業五十年の八百屋'},{id:'t2',tr:'V2',type:'title',start:44,in:0,out:14,st:'q',label:'店を続けてきた理由は？'},
    {id:'adj',tr:'V3',type:'adj',start:0,in:0,out:120,label:'調整レイヤー（色補正）'},
    {id:'b1',tr:'A2',type:'media',m:'a01',start:0,in:0,out:120},{id:'n1',tr:'A3',type:'media',m:'n02',start:0,in:0,out:10},{id:'n2',tr:'A3',type:'media',m:'n02',start:24,in:0,out:10});
  return {v:2,sample:1,media:JSON.parse(JSON.stringify(D.media)),tracks:defTracks(1),clips:cl};}
export var P;
export function M(id){return K.mediaOf(P,id);}
export function T(id){return K.trackOf(P,id);}
export function C(id){return K.clipOf(P,id);}
export var uid;
export var cLen=K.cLen;
export var cEnd=K.cEnd;
export function progDur(){return K.duration(P);}
export function onTrack(tid){return K.onTrack(P,tid);}
export function activeAt(t){return K.activeAt(P,t);}
export function vTracks(){return K.tracksOf(P,'v');}
export function aTracks(){return K.tracksOf(P,'a');}
export var hasAudio=K.hasAudio;
export function isUsed(m){return K.isUsed(P,m);}
/* 素材の中で使える範囲（テロップなどは制限なし） */
export var srcMin=K.srcMin;
export function srcMax(c){return K.srcMax(P,c);}
export function v1Clips(){return onTrack('V1').filter(function(c){return c.type==='media';});}
export function v1End(){return K.v1End(P);}
export var hasFx=K.hasFx;
/* ほかのモジュールから置き換えるための関数 */
export function setP(v){P=v;}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
P=sampleProject();
uid=coreUid;
}
