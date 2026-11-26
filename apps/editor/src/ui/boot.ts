// @ts-nocheck
import { historyReset, historyTick } from './history';
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { C, M, P, migrate, setP } from './project';
import { S } from './state';
import { IDB } from './store';
import { HOST, loadOpened, refreshRecent } from './desktop';
import { E, clampProg } from './engine';
import { changed } from './store';
import { draw } from './render';
import { toast } from './menus';


/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
/* テスト用：再生エンジンと、プロジェクトを差し替える関数（tests/playback.mjs が使う） */
window.__matsuko={E:E,P:function(){return P;},setP:setP,changed:changed};
if(HOST){refreshRecent();HOST.project.openLast().then(function(o){if(o)loadOpened(o);}).catch(function(e){toast('前回のプロジェクトを開けませんでした：'+e);});}
else IDB.open().then(function(ok){if(!ok)return;return IDB.get('kv','project').then(function(o){if(!o||!o.media)return;
  return Promise.all(o.media.map(function(m){if(!m.file)return null;return IDB.get('files',m.id).then(function(b){if(b)m.url=URL.createObjectURL(b);});})).then(function(){
    o.media=o.media.filter(function(m){return !m.file||m.url;});setP(migrate(o));var ids={};P.media.forEach(function(m){ids[m.id]=1;});P.clips=P.clips.filter(function(c){return !c.m||ids[c.m];});
    if(!M(S.media))S.media=P.media[0]?P.media[0].id:null;if(!M(S.src))S.src=(P.media.filter(function(m){return m.k==='映像';})[0]||{}).id||null;
    S.sel=S.sel.filter(function(id){return !!C(id);});S.pps=null;clampProg();S.savedAt=null;draw();historyReset();historyTick('open');});});});
}
