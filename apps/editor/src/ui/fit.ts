// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { draw } from './render';
import { applyDesign, buildMb } from './menus';
import { PREF } from './prefs';

/* 画面が小さいときは全体を縮小して表示する（横スクロールを出さない） */
/* 画面の大きさに合わせて、UI 全体を同じ比率で拡大・縮小する。
   基準は 1180×720（このときに部品の大きさのつり合いがいちばんよい）。全画面でも同じ見た目のまま大きくなる。
   メニュー・ダイアログ・通知も一緒に拡大されるよう #app の中に入れる。マウス位置は SCALE で割って画面内の座標にする */
export var SCALE, BASE_W, BASE_H;
export function fit(){var a=document.getElementById('app'),w=innerWidth,hh=innerHeight,s=Math.min(w/BASE_W,hh/BASE_H)*(typeof PREF!=='undefined'?PREF.ui:1);
  ['dd','cx','toast','dlg','drop'].forEach(function(id){var el=document.getElementById(id);if(el&&el.parentNode!==a)a.appendChild(el);});
  SCALE=s;a.classList.add('fit');document.body.classList.add('fit');a.style.width=(w/s)+'px';a.style.height=(hh/s)+'px';
  /* 拡大は CSS の zoom で行う（文字や部品をその大きさで描き直すので、ぼやけない）。
     zoom で位置の値が transform と同じ（画面の座標）になるブラウザでだけ使い、そうでなければ transform に戻す */
  if(ZOOM==null){a.style.transform='none';a.style.width=(w/1.25)+'px';a.style.zoom='1.25';ZOOM=Math.abs(a.getBoundingClientRect().width-w)<2;
    a.style.width=(w/s)+'px';document.documentElement.dataset.scale=ZOOM?'zoom':'transform';}
  if(ZOOM){a.style.transform='none';a.style.zoom=String(s);}else{a.style.zoom='';a.style.transform='scale('+s+')';}}
/* zoom を使えるか（最初の fit で調べる） */
export var ZOOM;

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
SCALE=1;
ZOOM=null;
BASE_W=1180;
BASE_H=720;
addEventListener('resize',fit);
applyDesign();
buildMb();
fit();
draw();
}
