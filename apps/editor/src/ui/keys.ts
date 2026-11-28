// @ts-nocheck
import { frameSec } from './projectSettings';
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { S } from './state';
import { redo, undo } from './store';
import { openPicker } from './importWeb';
import { E, heads, progStop, setProg } from './engine';
import { nudge, primary } from './editOps';
import { draw, go } from './render';
import { openPrefs } from './prefs';
import { ACT, jump } from './actions';

/* ---------- キーボードショートカット（ファイル → 環境設定 で変えられる） ----------
   [動作の id, 分類, 名前, 初期のキー]。キーは「Ctrl+Shift+Z」のように書く（Ctrl は Mac の ⌘ も含む） */
export var KB;
/* 変えられないマウス操作（一覧に参考として出す） */
export var MOUSE;
export var IS_MAC;
export var KEYMAP;
export function loadKeys(){KEYMAP={};KB.forEach(function(k){KEYMAP[k[0]]=k[3].slice();});try{var o=JSON.parse(localStorage.getItem('matsuko.keys')||'{}');Object.keys(o).forEach(function(id){if(KEYMAP[id]&&Array.isArray(o[id]))KEYMAP[id]=o[id];});}catch(e){}}
export function saveKeys(){var o={};KB.forEach(function(k){if(JSON.stringify(KEYMAP[k[0]])!==JSON.stringify(k[3]))o[k[0]]=KEYMAP[k[0]];});try{localStorage.setItem('matsuko.keys',JSON.stringify(o));}catch(e){}}
/* 押されたキーを「Ctrl+Shift+Z」の形にする。記号のキーは Shift を付けない（キーボードの配列で変わるため） */
export function comboOf(e){var k=e.key;if(!k||['Control','Shift','Alt','Meta','Dead','Process','Unidentified'].indexOf(k)>=0)return null;if(k===' ')k='Space';else if(k.length===1)k=k.toUpperCase();
  var sym=k.length===1&&!/[A-Z0-9]/.test(k),p=[];if(e.ctrlKey||e.metaKey)p.push('Ctrl');if(e.altKey)p.push('Alt');if(e.shiftKey&&!sym)p.push('Shift');p.push(k);return p.join('+');}
export function keyLabel(c){if(!c)return '';return c.split('+').map(function(x){return {Ctrl:IS_MAC?'⌘':'Ctrl',Alt:IS_MAC?'⌥':'Alt',Shift:IS_MAC?'⇧':'Shift',ArrowLeft:'←',ArrowRight:'→',ArrowUp:'↑',ArrowDown:'↓',Space:'Space',Escape:'Esc'}[x]||x;}).join(IS_MAC?'':'+');}
export function keyOf(id){return KEYMAP[id]&&KEYMAP[id][0]?keyLabel(KEYMAP[id][0]):'';}
export function actionFor(c){for(var i=0;i<KB.length;i++)if(KEYMAP[KB[i][0]].indexOf(c)>=0)return KB[i][0];return null;}
/* 動作を実行する（ページによって意味が変わるものはここで振り分ける） */
export var KEY_GLOBAL;
export function runKey(a,e){var pg=S.page;
  if(KEY_GLOBAL[a]){e.preventDefault();KEY_GLOBAL[a]();return;}
  if(a==='undo'||a==='redo'){e.preventDefault();a==='undo'?undo():redo();return;}
  if(a==='play'){if(['edit','export','cut','fx'].indexOf(pg)>=0){e.preventDefault();ACT.play();}return;}
  if(pg==='cut'){var cm={pin:'setIn',pout:'setOut',fb:'sfb',ff:'sff'};if(cm[a]){e.preventDefault();ACT[cm[a]]();}
    else if((a==='delSel'||a==='rdel')&&primary()&&primary().tr==='V1'){e.preventDefault();ACT.rdel();}return;}
  if(pg!=='edit')return;e.preventDefault();
  var step={fb:-frameSec(),ff:frameSec(),sb:-1,sf:1};if(a in step){if(E.playing)progStop();setProg(S.t.edit+step[a]);heads(true);return;}
  if(a==='prev'||a==='next'){jump(a==='prev'?-1:1);return;}if(a==='top'||a==='end'){ACT[a]();heads(true);return;}
  var tool={tSel:'select',tSplit:'split',tHand:'hand'};if(tool[a]){S.tool=tool[a];draw();return;}
  if(a==='nl'||a==='nr'){nudge(a==='nl'?-frameSec():frameSec());return;}
  if(a==='addTitle'){ACT.addTitle('center');return;}if(ACT[a])ACT[a]();}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
KB=[['play','再生','再生／停止',['Space']],
  ['fb','再生','1 フレーム戻る',['ArrowLeft']],['ff','再生','1 フレーム進む',['ArrowRight']],['sb','再生','1 秒戻る',['Shift+ArrowLeft']],['sf','再生','1 秒進む',['Shift+ArrowRight']],
  ['prev','再生','前の編集点へ',['ArrowUp']],['next','再生','次の編集点へ',['ArrowDown']],['top','再生','先頭へ',['Home']],['end','再生','最後へ',['End']],
  ['pin','再生','イン点（編集：書き出し範囲／カット：ソース）',['I']],['pout','再生','アウト点',['O']],
  ['tSel','ツール','選択ツール',['V']],['tSplit','ツール','分割ツール',['C']],['tHand','ツール','ハンドツール',['H']],['addTitle','ツール','テロップを追加',['T']],['snapT','ツール','スナップのオン／オフ',['N']],
  ['split','編集','再生ヘッドで分割',['S']],['delSel','編集','削除（すき間を残す）',['Delete','Backspace']],['rdel','編集','削除して詰める',['Shift+Delete','Shift+Backspace']],
  ['nl','編集','選んだクリップを左へ 1 フレーム',['Alt+ArrowLeft']],['nr','編集','選んだクリップを右へ 1 フレーム',['Alt+ArrowRight']],
  ['cut2','編集','切り取り',['Ctrl+X']],['copy','編集','コピー',['Ctrl+C']],['paste','編集','再生ヘッドに貼り付け',['Ctrl+V']],['dup','編集','すぐ後ろに複製',['Ctrl+D']],
  ['selAll','編集','すべて選択',['Ctrl+A']],['lnk','編集','リンク／リンク解除',['Ctrl+L']],['undo','編集','元に戻す',['Ctrl+Z']],['redo','編集','やり直し',['Ctrl+Y','Ctrl+Shift+Z']],
  ['zin','表示','タイムラインを拡大',['+','=',';']],['zout','表示','タイムラインを縮小',['-']],['zfit','表示','タイムライン全体を表示',['\\','¥']],
  ['save','ファイル','保存',['Ctrl+S']],['imp','ファイル','素材を読み込む',['Ctrl+I']],['toExport','ファイル','書き出し',['Ctrl+M']],['prefs','ファイル','環境設定',['Ctrl+,']]];
MOUSE=[['クリック','選ぶ（リンクしたクリップも一緒に）'],['Shift／Ctrl＋クリック','選択に足す・外す'],['Alt＋クリック','リンク先を含めずに選ぶ'],['何もないところからドラッグ','囲んで選ぶ'],
  ['ドラッグ','移動（トラックの間も）。重なった部分は上書き'],['Ctrl を押しながら離す','挿入（後ろをずらす）'],['Alt を押しながら離す','複製して置く'],['端をドラッグ','長さの調整（Ctrl でリップル）'],
  ['Ctrl＋ホイール','タイムラインの拡大・縮小'],['Shift＋ホイール','タイムラインを横に動かす'],['Esc','選択を外す'],['Alt＋1〜7','ページを切り替える']];
IS_MAC=/Mac|iPhone|iPad/.test(navigator.platform||'');
KEYMAP={};
loadKeys();
KEY_GLOBAL={save:function(){ACT.save();},imp:function(){openPicker();},toExport:function(){go('export');},prefs:function(){openPrefs();}};
}
