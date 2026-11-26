// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { D } from './data';

/* ---------- プロジェクト ----------
   トラックは画面の上から V3, V2, V1, A1, A2, A3。映像は番号の大きいトラックが上に重なる。
   クリップは start（タイムライン上の開始）と in / out（素材の中の範囲）を持ち、1つのトラックの中では重ならない。
   仕様：docs/timeline-spec.md */
export function defTracks(sample){return [{id:'V3',kind:'v',h:sample?24:40},{id:'V2',kind:'v',h:sample?32:48,name:sample?'テロップ':''},{id:'V1',kind:'v',h:80,name:'映像'},
  {id:'A1',kind:'a',h:48},{id:'A2',kind:'a',h:40,name:sample?'BGM':''},{id:'A3',kind:'a',h:40,name:sample?'NA':''}];}
export function sampleProject(){var cl=[];
  [['c1','v01',0,0,24],['c2','v02',24,0,17],['c3','v03',41,41,95],['c4','v04',95,0,25]].forEach(function(x){
    cl.push({id:x[0],tr:'V1',type:'media',m:x[1],start:x[2],in:x[3],out:x[4],link:'L'+x[0]},{id:x[0]+'a',tr:'A1',type:'media',m:x[1],start:x[2],in:x[3],out:x[4],link:'L'+x[0]});});
  cl.push({id:'t1',tr:'V2',type:'title',start:24,in:0,out:10,st:'name',label:'創業五十年の八百屋'},{id:'t2',tr:'V2',type:'title',start:44,in:0,out:14,st:'q',label:'店を続けてきた理由は？'},
    {id:'adj',tr:'V3',type:'adj',start:0,in:0,out:120,label:'調整レイヤー（色補正）'},
    {id:'b1',tr:'A2',type:'media',m:'a01',start:0,in:0,out:120},{id:'n1',tr:'A3',type:'media',m:'n02',start:0,in:0,out:10},{id:'n2',tr:'A3',type:'media',m:'n02',start:24,in:0,out:10});
  return {v:2,sample:1,media:JSON.parse(JSON.stringify(D.media)),tracks:defTracks(1),clips:cl};}
export function emptyProject(){return {v:2,sample:0,media:[],tracks:defTracks(0),clips:[]};}
/* 前の形式（seq / titles / bgm / na）で保存したプロジェクトを、新しい形式に変える */
export function migrate(o){if(o.clips&&o.tracks)return o;var cl=[],s=0,med=o.media||[];
  (o.seq||[]).forEach(function(c){var m=med.filter(function(x){return x.id===c.m;})[0],L='L'+c.id,d=Math.max(0,c.out-c.in);
    cl.push({id:c.id,tr:'V1',type:'media',m:c.m,start:s,in:c.in,out:c.out,link:L});
    if(m&&m.k==='映像'&&!m.noAudio)cl.push({id:c.id+'a',tr:'A1',type:'media',m:c.m,start:s,in:c.in,out:c.out,link:L});s+=d;});
  (o.titles||[]).forEach(function(t){cl.push({id:t.id,tr:'V2',type:'title',start:t.t,in:0,out:t.d,st:t.st,sz:t.sz,label:t.label});});
  if(o.adj&&s)cl.push({id:'adj',tr:'V3',type:'adj',start:0,in:0,out:s,label:'調整レイヤー（色補正）'});
  (o.bgm||[]).forEach(function(b){var m=b.sample?'a01':b.m;if(m)cl.push({id:b.id,tr:'A2',type:'media',m:m,start:b.start,in:b.in,out:b.out});});
  (o.na||[]).forEach(function(n){cl.push({id:n.id,tr:'A3',type:'media',m:'n02',start:n.start,in:0,out:Math.min(10,n.dur)});});
  return {v:2,sample:o.sample,media:med,tracks:defTracks(o.sample),clips:cl,pin:o.pin,pout:o.pout};}
export var P;
export function M(id){for(var i=0;i<P.media.length;i++)if(P.media[i].id===id)return P.media[i];return null;}
export function T(id){for(var i=0;i<P.tracks.length;i++)if(P.tracks[i].id===id)return P.tracks[i];return null;}
export function C(id){for(var i=0;i<P.clips.length;i++)if(P.clips[i].id===id)return P.clips[i];return null;}
export var uid;
export function cLen(c){return Math.max(0,c.out-c.in);}
export function cEnd(c){return c.start+cLen(c);}
export function progDur(){return P.clips.reduce(function(a,c){return Math.max(a,cEnd(c));},0);}
export function onTrack(tid){return P.clips.filter(function(c){return c.tr===tid;}).sort(function(a,b){return a.start-b.start;});}
export function activeAt(t){return P.clips.filter(function(c){return c.start<=t+1e-9&&t<cEnd(c)-1e-9;});}
export function vTracks(){return P.tracks.filter(function(t){return t.kind==='v';});}
export function aTracks(){return P.tracks.filter(function(t){return t.kind==='a';});}
export function hasAudio(m){return !!m&&m.k==='映像'&&!m.noAudio;}
export function isUsed(m){return P.clips.some(function(c){return c.m===m.id;});}
/* 素材の中で使える範囲（テロップなどは制限なし） */
export function srcMin(c){return c.type==='media'?0:-1e9;}
export function srcMax(c){if(c.type!=='media')return 1e9;var m=M(c.m);return !m||m.k==='画像'?1e9:(m.d||c.out);}
export function v1Clips(){return onTrack('V1').filter(function(c){return c.type==='media';});}
export function v1End(){return onTrack('V1').reduce(function(a,c){return Math.max(a,cEnd(c));},0);}
export function hasFx(c){return !!(c.x||c.y||c.rot||(c.scale!=null&&c.scale!=100)||(c.op!=null&&c.op!=100));}
/* ほかのモジュールから置き換えるための関数 */
export function setP(v){P=v;}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
P=sampleProject();
uid=function(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);};
}
