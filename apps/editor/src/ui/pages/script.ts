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
    '<div class="mu" style="margin-top:14px">紐づけると、台本の表示、台本行とタイムラインの連携、絵コンテの読み込みが使えます。</div>'+
    '<div style="margin-top:18px">'+(S.linked?'<span class="t-ok">紐づけました（台本の表示は、これから作ります）</span>':btn('台本アプリと紐づける','link','','pri'))+'</div></div>';
};
}
