// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { S } from '../state';
import { btn } from '../util';
import { R } from './media';


/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
R.script=function(){
  return '<div class="pc" style="align-items:center;justify-content:center;background:var(--bg1);text-align:center">'+
    '<div style="font-size:16px;font-weight:500">台本ページは、台本アプリとの紐づけ後に表示されます</div>'+
    '<div style="margin-top:18px">'+(S.linked?'<span class="t-ok">紐づけました</span>':btn('台本アプリと紐づける','link','','pri'))+'</div></div>';
};
}
