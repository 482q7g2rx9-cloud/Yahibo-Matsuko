// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { D } from './data';

/* ---------- 画面の状態 ---------- */
export var S;
export var TOTAL;
export function persist(){try{localStorage.setItem('matsuko.ui',JSON.stringify({page:S.page}));localStorage.setItem('mtheme',S.theme);localStorage.setItem('maccent',S.accent);}catch(e){}}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
S={page:'edit',theme:'system',accent:'blue',
  bin:'all',mq:'',mtype:'',msort:'name',mview:'list',media:'v03',
  ctab:'board',cflt:'all',scene:'s3',src:'v03',
  etab:'assets',sel:['c3','c3a'],pps:null,snap:true,clipboard:null,tlx:0,tly:0,tool:'select',open:{clip:1,motion:1,audio:1,video:1,comp:1,track:1,color:1},
  fx:'オブジェクトトラッキング',fxClosed:{},ba:'after',kfMode:'リニア',
  rmode:'sync',line:1,take:1,tsel:1,mute:{},solo:{},countin:true,
  preset:0,x:null,queue:[],xplay:null,sil:{thr:'-35 dB',min:'0.5 秒'},
  linked:false,savedAt:null,
  t:{cut:50,edit:50,fx:41},rec:24.27};
TOTAL={cut:130,fx:120};
try{
  var sv=JSON.parse(localStorage.getItem('matsuko.ui')||'{}');
  ['page'].forEach(function(k){if(sv[k])S[k]=sv[k];});
  S.theme=localStorage.getItem('mtheme')||S.theme;S.accent=localStorage.getItem('maccent')||S.accent;
}catch(e){}
if(!D.pages.some(function(p){return p[0]===S.page;}))S.page='edit';
if(['light','dark','system'].indexOf(S.theme)<0)S.theme='system';
if(['blue','green','orange','purple'].indexOf(S.accent)<0)S.accent='blue';
}
