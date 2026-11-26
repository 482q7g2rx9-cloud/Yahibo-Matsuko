// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { M } from './project';
import { S, TOTAL } from './state';
import { ic, tc } from './util';
import { HOST } from './desktop';
import { E, progStop } from './engine';
import { draw } from './render';

/* ---------- ソースモニター（カットページ） ---------- */
export var SRC;
export var SIM;
export function srcEl(m){if(SRC.id!==m.id){if(SRC.el){SRC.el.pause();SRC.el.removeAttribute('src');SRC.el.load();}SRC.el=null;SRC.id=m.id;SRC.playing=false;}
  if(!SRC.el&&m.url&&m.k==='映像'){var v=document.createElement('video');if(HOST)v.crossOrigin='anonymous';v.preload='auto';v.playsInline=true;v.src=m.url;v.style.cssText='width:100%;height:100%;object-fit:contain;display:block;background:#000';
    v.addEventListener('loadedmetadata',function(){try{v.currentTime=Math.min(S.t.cut,v.duration||0);}catch(x){}});
    v.addEventListener('pause',function(){SRC.playing=false;syncPlayBtn();});SRC.el=v;}
  return SRC.el;}
export function srcPlay(){var m=M(S.src);if(!m)return;var el=m.url?srcEl(m):null;
  if(el){if(!el.paused){el.pause();return;}if(S.t.cut>=TOTAL.cut-0.05)S.t.cut=0;el.currentTime=S.t.cut;var pr=el.play();if(pr&&pr.catch)pr.catch(function(){});SRC.playing=true;syncPlayBtn();
    (function loop(){if(el.paused){SRC.playing=false;syncPlayBtn();return;}setT('cut',el.currentTime);SRC.raf=requestAnimationFrame(loop);})();return;}
  if(SIM){clearInterval(SIM);SIM=null;SRC.playing=false;syncPlayBtn();return;}
  SRC.playing=true;syncPlayBtn();SIM=setInterval(function(){var t=S.t.cut+0.1;if(t>=TOTAL.cut){clearInterval(SIM);SIM=null;SRC.playing=false;syncPlayBtn();return;}setT('cut',t);},100);}
export function srcSeek(t){setT('cut',t);var m=M(S.src);if(m&&m.url&&SRC.el&&SRC.id===m.id){try{SRC.el.currentTime=S.t.cut;}catch(x){}}}

/* 見本ページ（エフェクト）の簡易再生 */
export var FXP;
export function fxPlay(){if(FXP){clearInterval(FXP);FXP=null;syncPlayBtn();return;}FXP=setInterval(function(){var t=S.t.fx+0.1;if(t>=TOTAL.fx)t=0;setT('fx',t);},100);syncPlayBtn();}
export function setT(k,t){var tot=TOTAL[k];S.t[k]=Math.max(0,Math.min(tot,t));var pct=S.t[k]/tot*100;
  [].forEach.call(document.querySelectorAll('[data-head="'+k+'"]'),function(e){e.style.left=pct+'%';});
  [].forEach.call(document.querySelectorAll('[data-time="'+k+'"]'),function(e){if(!e.classList.contains('tch')||e.textContent)e.textContent=tc(S.t[k]);});}
export function stopAll(){if(E.playing)progStop();if(SRC.el&&!SRC.el.paused)SRC.el.pause();if(SIM){clearInterval(SIM);SIM=null;}SRC.playing=false;if(FXP){clearInterval(FXP);FXP=null;}if(REC){clearInterval(REC);REC=null;}syncPlayBtn();}
export function syncPlayBtn(){var on=S.page==='cut'?SRC.playing:S.page==='fx'?!!FXP:E.playing;[].forEach.call(document.querySelectorAll('.ib.play'),function(b){b.classList.toggle('on',on);b.innerHTML=ic(on?'pause':'play');b.setAttribute('aria-label',on?'一時停止':'再生');});}
export var REC;
export function rec(){if(REC){clearInterval(REC);REC=null;draw();return;}REC=setInterval(function(){S.rec+=0.1;var e=document.querySelector('[data-rec]');if(e)e.textContent=tc(S.rec);},100);draw();}
/* ほかのモジュールから置き換えるための関数 */
export function setREC(v){REC=v;}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
SRC={el:null,id:null,playing:false,raf:0};
SIM=null;
FXP=null;
REC=null;
}
