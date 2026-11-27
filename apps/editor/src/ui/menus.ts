// @ts-nocheck
import { historyReset } from './history';
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { D } from './data';
import { P, setP } from './project';
import { S, persist } from './state';
import { btn, h } from './util';
import { IDB, saveP, setHIST, setREDO } from './store';
import { HOST, RECENT, fileItems, openProject, setJOBS } from './desktop';
import { E, dropEl } from './engine';
import { SRC, stopAll } from './source';
import { draw, go } from './render';
import { KEYMAP, keyOf } from './keys';
import { ACT } from './actions';
import { SCALE } from './fit';

/* ---------- メニュー ---------- */
export var MENUS;
export function viewItems(){var o=[{h:'ページ'}];D.pages.forEach(function(p,i){o.push([p[1],'go:'+p[0],'Alt+'+(i+1),S.page===p[0]]);});
  o.push('-',{h:'テーマ'});[['ライト','light'],['ダーク','dark'],['システムに合わせる','system']].forEach(function(t){o.push([t[0],'th:'+t[1],'',S.theme===t[1]]);});
  o.push('-',{h:'アクセントカラー'});[['青','blue'],['緑','green'],['オレンジ','orange'],['紫','purple']].forEach(function(t){o.push([t[0],'ac:'+t[1],'',S.accent===t[1]]);});return o;}
export function items(its){return its.map(function(x){if(x==='-')return '<div class="sep"></div>';if(x.h)return '<div class="dh">'+x.h+'</div>';
  return '<button class="it" role="menuitem"'+(x[4]?' disabled':'')+' data-m="'+(x[1]||'todo')+'"><span class="ck">'+(x[3]?'✓':'')+'</span><span class="lb">'+x[0]+'</span><span class="sc">'+h(menuKey(x[1])||x[2]||'')+'</span></button>';}).join('');}
export function menuKey(a){if(!a)return '';if(a==='go:export')a='toExport';return KEYMAP[a]?keyOf(a):'';}
export var mbOpen;
export function buildMb(){document.getElementById('mb').innerHTML=MENUS.map(function(m,i){return '<button data-menu="'+i+'" aria-haspopup="true" aria-expanded="false">'+m.n+'</button>';}).join('');}
export function closeMenu(){document.getElementById('dd').hidden=true;document.getElementById('cx').hidden=true;mbOpen=null;[].forEach.call(document.querySelectorAll('[data-menu]'),function(b){b.setAttribute('aria-expanded','false');});}
export function openMenu(b){closeMenu();var m=MENUS[+b.dataset.menu],d=document.getElementById('dd'),r=b.getBoundingClientRect();d.innerHTML=items(m.i==='view'?viewItems():m.i==='file'?fileItems():m.i);d.style.left=(r.left/SCALE)+'px';d.style.top=(r.bottom/SCALE)+'px';d.style.position='fixed';d.hidden=false;mbOpen=b.dataset.menu;b.setAttribute('aria-expanded','true');var f=d.querySelector('.it');if(f)f.focus();}
export function openCx(x,y,list){var c=document.getElementById('cx');c.innerHTML=items(list||[['キーフレームを追加'],['キーフレームを削除'],'-'].concat(['リニア','ベジェ','停止'].map(function(k){return [k,'kfm:'+k,'',S.kfMode===k];})).concat(['-',['イーズイン'],['イーズアウト'],'-',['コピー'],['貼り付け','','','',1]]));
  c.hidden=false;var w=c.offsetWidth,hh=c.offsetHeight;c.style.left=Math.min(x/SCALE,innerWidth/SCALE-w-4)+'px';c.style.top=Math.min(y/SCALE,innerHeight/SCALE-hh-4)+'px';var f=c.querySelector('.it');if(f)f.focus();}
export function menuAct(a){closeMenu();if(a.indexOf('th:')===0){S.theme=a.slice(3);applyDesign();}else if(a.indexOf('ac:')===0){S.accent=a.slice(3);applyDesign();}
  else if(a.indexOf('go:')===0)go(a.slice(3));else if(a.indexOf('kfm:')===0){S.kfMode=a.slice(4);draw();}else if(a.indexOf('orec:')===0){var r=RECENT.filter(function(x){return !HOST.project.current||x.dir!==HOST.project.current.dir;})[+a.slice(5)];if(r)openProject(function(){return HOST.project.openRecent(r.dir);});}else if(a.indexOf('@')>0&&ACT[a.split('@')[0]])ACT[a.split('@')[0]](a.slice(a.indexOf('@')+1));else if(ACT[a])ACT[a]();else toast('この機能は、まだ使えません');}
export var mq;
export function applyDesign(){var r=S.theme==='system'?(mq.matches?'light':'dark'):S.theme;document.documentElement.dataset.theme=r;document.documentElement.dataset.accent=S.accent;persist();}
export function toast(m){var t=document.getElementById('toast');t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(function(){t.hidden=true;},2600);}
/* 確認ダイアログ（confirm() は使えないため画面内に出す） */
export function ask(title,msg,ok,fn){var d=document.getElementById('dlg');d.innerHTML='<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlgT"><h2 id="dlgT">'+h(title)+'</h2><p>'+h(msg)+'</p><div class="row" style="gap:8px;justify-content:flex-end">'+btn('キャンセル','dlgNo','','sec')+btn(ok,'dlgOk','','pri')+'</div></div>';d.hidden=false;ask.fn=fn;d.querySelector('[data-a="dlgOk"]').focus();}
export function resetProject(np){historyReset();stopAll();Object.keys(E.els).forEach(dropEl);E.imgs={};
  if(HOST){HOST.media.cancel(P.media.map(function(m){return m.id;}));setJOBS({});}else{P.media.forEach(function(m){if(m.url)URL.revokeObjectURL(m.url);});IDB.clear('files');IDB.clear('history');}setP(np);setHIST([]);setREDO([]);S.media=np.media[0]?np.media[0].id:null;S.src=np.sample?'v03':null;S.sel=np.sample?['c3','c3a']:[];S.t.edit=0;S.t.cut=0;S.bin='all';S.pps=null;S.tlx=S.tly=0;SRC.id=null;SRC.el=null;saveP();draw();}
export function infoDlg(title,html){var d=document.getElementById('dlg');d.innerHTML='<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlgT" style="width:560px"><h2 id="dlgT">'+h(title)+'</h2><div style="max-height:60vh;overflow:auto">'+html+'</div><div class="row" style="justify-content:flex-end;margin-top:14px">'+btn('閉じる','dlgNo','','pri')+'</div></div>';d.hidden=false;d.querySelector('[data-a="dlgNo"]').focus();}

/* ---------- macOS：メニューを Mac のメニューバーに出す（画面の中のメニューバーは隠す） ----------
   中身はここで組み立てて Rust（src-tauri/src/menu.rs）に送り、選ばれると "menu-action" で戻ってくる。
   ショートカットは ⌘ を使うものだけ Mac のメニューに登録する（S などの1文字は、文字の入力を邪魔しないよう登録しない）。
   コピー・切り取り・貼り付けは Mac の標準の項目にする：文字の入力欄ではその文字に、ほかではクリップに働く */
export var NATIVE, nativeLast;
var NATIVE_ITEMS={copy:'copy',cut2:'cut',paste:'paste'};
function unesc(t){return String(t).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');}
/* 画面のショートカット（Ctrl+Shift+Z など）を、Mac のメニューの書き方（CmdOrCtrl+Shift+Z）にする。⌘ を使わないものは null */
export function nativeAccel(a,txt){var k=a==='go:export'?'toExport':a,L=(k&&KEYMAP[k])||[],c=L.filter(function(x){return /(^|\+)Ctrl(\+|$)/.test(x);})[0]||txt||'';
  if(k==='redo'&&L.indexOf('Ctrl+Shift+Z')>=0)c='Ctrl+Shift+Z'; /* Mac では ⇧⌘Z がふつう */
  if(!/(^|\+)Ctrl(\+|$)/.test(c))return null;
  var parts=c.split('+'),key=parts.pop();key={',':'Comma','.':'Period','/':'Slash'}[key]||key;if(!/^([A-Z0-9]|Comma|Period|Slash)$/.test(key))return null;
  return parts.map(function(m){return m==='Ctrl'?'CmdOrCtrl':m;}).concat([key]).join('+');}
export function nativeSpec(){var used={};return MENUS.map(function(m){var its=m.i==='view'?viewItems():m.i==='file'?fileItems():m.i,out=[];
    its.forEach(function(x){if(x==='-'){if(out.length&&out[out.length-1].kind!=='sep')out.push({kind:'sep'});return;}if(x.h){out.push({kind:'head',label:unesc(x.h)});return;}
      var id=x[1]||'todo';if(id==='prefs'||id==='about')return; /* Mac ではアプリの名前のメニューにある */
      if(NATIVE_ITEMS[id]){out.push({kind:'native',id:NATIVE_ITEMS[id],label:unesc(x[0])});return;}
      var o={kind:m.i==='view'&&x[3]!==undefined?'check':'item',id:id,label:unesc(x[0]),enabled:!x[4],checked:!!x[3]},ac=nativeAccel(x[1],x[2]);if(ac&&!used[ac]){used[ac]=1;o.accel=ac;}out.push(o);}); /* 同じショートカットは最初の項目だけに付ける */
    while(out.length&&out[out.length-1].kind==='sep')out.pop();return {label:m.n,items:out};});}
/* 中身が変わったときだけ送り直す（draw のたびに呼ぶ） */
export function syncNativeMenu(){if(!NATIVE)return;var sp=nativeSpec(),j=JSON.stringify(sp);if(j===nativeLast)return;nativeLast=j;Promise.resolve(HOST.menu.set(sp)).catch(function(){nativeLast='';});}
function editing(){var a=document.activeElement;return !!a&&(a.isContentEditable||a.tagName==='TEXTAREA'||a.tagName==='INPUT'&&!/^(range|checkbox|radio|button|submit)$/.test(a.type));}
/* Mac のメニューで選ばれたとき。文字の入力中の「元に戻す・やり直し・すべて選択」は、その文字に働かせる */
export function onNativeMenu(id){if(editing()&&(id==='undo'||id==='redo'||id==='selAll')){document.execCommand(id==='selAll'?'selectAll':id);return;}menuAct(id);}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
MENUS=[{n:'ファイル',i:'file'},
  {n:'編集',i:[['元に戻す','undo','Ctrl+Z'],['やり直し','redo','Ctrl+Y'],'-',['切り取り','cut2','Ctrl+X'],['コピー','copy','Ctrl+C'],['貼り付け','paste','Ctrl+V'],['複製','dup','Ctrl+D'],'-',['再生ヘッドで分割','split','S'],['削除','delSel','Delete'],['削除して詰める','rdel','Shift+Delete'],'-',['すべて選択','selAll','Ctrl+A'],['リンク／リンク解除','lnk','Ctrl+L'],'-',['映像トラックを追加','addV'],['音声トラックを追加','addA']]},
  {n:'表示',i:'view'},
  {n:'プロジェクト',i:[['プロジェクト設定…','psOpen'],['メンバーと権限…'],['変更履歴・復元…','hist'],'-',['台本アプリと紐づけ…','go:script']]},
  {n:'ヘルプ',i:[['使い方','help'],['キーボードショートカット…','keys'],['バージョン情報','about']]}];
mbOpen=null;
nativeLast='';
NATIVE=!!(HOST&&HOST.menu&&/Mac/.test(navigator.platform||navigator.userAgent||''));
if(NATIVE){document.body.classList.add('native-menu');HOST.menu.onAction(onNativeMenu);
  /* Mac の標準のコピー・切り取り・貼り付けを、文字の入力中でなければクリップの操作にする */
  ['copy','cut','paste'].forEach(function(t){document.addEventListener(t,function(e){if(editing())return;e.preventDefault();menuAct(t==='cut'?'cut2':t);});});}
mq=matchMedia('(prefers-color-scheme: light)');
if(mq.addEventListener)mq.addEventListener('change',applyDesign);
}
