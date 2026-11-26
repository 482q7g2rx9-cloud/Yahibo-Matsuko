// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { S } from './state';
import { A, btn, h } from './util';
import { closeMenu, toast } from './menus';
import { KB, KEYMAP, MOUSE, keyLabel, keyOf, saveKeys } from './keys';

/* ---------- 環境設定（ファイル → 環境設定） ---------- */
export var PREF;
export function savePref(){try{localStorage.setItem('matsuko.pref',JSON.stringify(PREF));}catch(e){}}
export function openPrefs(tab){closeMenu();S.ptab=tab||S.ptab||'general';S.capture=null;renderPrefs();}
export function prefRow(label,ctl,note){return '<div class="prow"><div><div>'+label+'</div>'+(note?'<div class="mu" style="margin-top:2px">'+note+'</div>':'')+'</div><div>'+ctl+'</div></div>';}
export function renderPrefs(){var d=document.getElementById('dlg'),t=S.ptab,body='';
  if(t==='general')body='<h3>一般</h3>'+
    prefRow('テーマ','<span class="seg">'+[['light','ライト'],['dark','ダーク'],['system','システムに合わせる']].map(function(x){return btn(x[1],'pTheme',x[0],'s'+(S.theme===x[0]?' on':''));}).join('')+'</span>')+
    prefRow('表示の大きさ','<span class="seg">'+[[0.8,'小さめ'],[0.9,'やや小さめ'],[1,'標準'],[1.25,'大きめ']].map(function(x){return btn(x[1],'pUi',x[0],'s'+(PREF.ui===x[0]?' on':''));}).join('')+'</span>','文字や部品の大きさです。ウインドウを大きくすると、広くなった分だけ作業スペース（プレビューやタイムライン）が広がります。ウインドウが小さいときは、全体を縮小して収めます。')+
    prefRow('アクセントカラー','<span class="row" style="gap:8px">'+[['blue','青','#378ef0'],['green','緑','#2d9d78'],['orange','オレンジ','#e68619'],['purple','紫','#9256d9']].map(function(x){return '<button class="sw'+(S.accent===x[0]?' on':'')+'" aria-label="'+x[1]+'" aria-pressed="'+(S.accent===x[0])+'" title="'+x[1]+'"'+A('pAcc',x[0])+' style="background:'+x[2]+'"></button>';}).join('')+'</span>');
  else if(t==='timeline')body='<h3>タイムライン</h3>'+
    prefRow('スナップ','<label class="row" style="gap:6px"><input type="checkbox" data-in="pSnap"'+(PREF.snap?' checked':'')+'>最初から入れておく</label>','クリップの端・再生ヘッド・イン点／アウト点に吸い付きます。編集中は '+(keyOf('snapT')||'—')+' キーで切り替えられます。')+
    prefRow('再生中の表示','<label class="row" style="gap:6px"><input type="checkbox" data-in="pFollow"'+(PREF.follow?' checked':'')+'>再生ヘッドを追いかける</label>','再生ヘッドが画面の外に出たら、タイムラインを自動で動かします。');
  else{var groups=[];KB.forEach(function(k){if(groups.indexOf(k[1])<0)groups.push(k[1]);});
    body='<h3>ショートカット</h3><div class="mu" style="margin-bottom:10px;line-height:1.6">「変更」を押してから、割り当てたいキーを押してください。Esc で取り消します。ほかの動作で使っているキーを選ぶと、そちらからは外れます。</div>'+
    groups.map(function(g){return '<div class="pgrp">'+g+'</div>'+KB.filter(function(k){return k[1]===g;}).map(function(k){var cap=S.capture===k[0],keys=KEYMAP[k[0]],custom=JSON.stringify(keys)!==JSON.stringify(k[3]);
      return '<div class="krow'+(cap?' cap':'')+'" data-krow="'+k[0]+'"><span>'+h(k[2])+'</span><span class="row" style="gap:4px;flex-wrap:wrap">'+(cap?'<span class="t-ac">キーを押してください…</span>':keys.length?keys.map(function(c){return '<kbd>'+h(keyLabel(c))+'</kbd>';}).join(''):'<span class="mu">なし</span>')+'</span>'+
        '<span class="row" style="gap:4px;justify-content:flex-end">'+(cap?btn('取り消し','kCancel','','s'):btn('変更','kSet',k[0],'s'))+(custom&&!cap?btn('戻す','kReset',k[0],'s'):'')+'</span></div>';}).join('');}).join('')+
    '<div class="pgrp">マウスなど（変えられません）</div>'+MOUSE.map(function(m){return '<div class="krow"><span>'+h(m[1])+'</span><span><kbd>'+h(m[0])+'</kbd></span><span></span></div>';}).join('')+
    '<div class="row" style="justify-content:flex-end;margin-top:12px">'+btn('すべて初期設定に戻す','kResetAll','','s')+'</div>';}
  d.innerHTML='<div class="dlg prefs" role="dialog" aria-modal="true" aria-labelledby="dlgT"><div class="ph2"><h2 id="dlgT">環境設定</h2>'+btn('閉じる','dlgNo','','s')+'</div><div class="pbody"><nav class="pnav" aria-label="設定の分類">'+
    [['general','一般'],['timeline','タイムライン'],['keys','ショートカット']].map(function(x){return '<button'+(t===x[0]?' aria-current="true"':'')+A('ptab',x[0])+'>'+x[1]+'</button>';}).join('')+'</nav><div class="pcont">'+body+'</div></div></div>';
  d.hidden=false;var sc=d.querySelector('.pcont');if(sc&&renderPrefs.st&&renderPrefs.tab===t)sc.scrollTop=renderPrefs.st;renderPrefs.tab=t;
  if(sc)sc.addEventListener('scroll',function(){renderPrefs.st=sc.scrollTop;});
  var fr=S.kFocus&&d.querySelector('[data-krow="'+S.kFocus+'"]');if(fr)fr.scrollIntoView({block:'nearest'});}
export function assignKey(id,c){KB.forEach(function(k){if(k[0]!==id){var i=KEYMAP[k[0]].indexOf(c);if(i>=0){KEYMAP[k[0]].splice(i,1);toast('「'+keyLabel(c)+'」を「'+k[2]+'」から外しました');}}});KEYMAP[id]=[c];saveKeys();}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
PREF={snap:true,follow:true,ui:1};
try{var pf=JSON.parse(localStorage.getItem('matsuko.pref')||'{}');if(typeof pf.snap==='boolean')PREF.snap=pf.snap;if(typeof pf.follow==='boolean')PREF.follow=pf.follow;if([0.8,0.9,1,1.25].indexOf(pf.ui)>=0)PREF.ui=pf.ui;}catch(e){}
S.snap=PREF.snap;
}
