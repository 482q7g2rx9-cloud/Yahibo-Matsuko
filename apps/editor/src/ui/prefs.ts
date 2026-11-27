// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { S } from './state';
import { A, btn, h } from './util';
import { closeMenu, toast } from './menus';
import { KB, KEYMAP, MOUSE, keyLabel, saveKeys } from './keys';

/* ---------- 環境設定（ファイル → 環境設定） ---------- */
export var PREF;
export function savePref(){try{localStorage.setItem('matsuko.pref',JSON.stringify(PREF));}catch(e){}}
export function openPrefs(tab){closeMenu();S.ptab=tab||S.ptab||'general';S.capture=null;renderPrefs();}
export function prefRow(label,ctl){return '<div class="prow"><div><div>'+label+'</div></div><div>'+ctl+'</div></div>';}
export function renderPrefs(){var d=document.getElementById('dlg'),t=S.ptab,body='';
  if(t==='general')body='<h3>一般</h3>'+
    prefRow('テーマ','<span class="seg">'+[['light','ライト'],['dark','ダーク'],['system','システムに合わせる']].map(function(x){return btn(x[1],'pTheme',x[0],'s'+(S.theme===x[0]?' on':''));}).join('')+'</span>')+
    prefRow('表示サイズ','<span class="seg">'+[[0.9,'大'],[0.75,'デフォルト'],[0.65,'小']].map(function(x){return btn(x[1],'pUi',x[0],'s'+(PREF.ui===x[0]?' on':''));}).join('')+'</span>')+
    prefRow('アクセントカラー','<span class="row" style="gap:8px">'+[['blue','青','#378ef0'],['green','緑','#2d9d78'],['orange','オレンジ','#e68619'],['purple','紫','#9256d9']].map(function(x){return '<button class="sw'+(S.accent===x[0]?' on':'')+'" aria-label="'+x[1]+'" aria-pressed="'+(S.accent===x[0])+'" title="'+x[1]+'"'+A('pAcc',x[0])+' style="background:'+x[2]+'"></button>';}).join('')+'</span>')+
    (window.MatsukoHost&&window.MatsukoHost.desktop?prefRow('更新','<span class="row" style="gap:10px"><label class="row" style="gap:6px"><input type="checkbox" data-in="pAutoUpd"'+(PREF.autoUpdate?' checked':'')+'>起動したときに確認する</label>'+btn('今すぐ確認','updCheck','','s')+'</span>'):'');
  else if(t==='timeline')body='<h3>タイムライン</h3>'+
    prefRow('スナップ','<label class="row" style="gap:6px"><input type="checkbox" data-in="pSnap"'+(PREF.snap?' checked':'')+'>最初から入れておく</label>')+
    prefRow('再生中の表示','<label class="row" style="gap:6px"><input type="checkbox" data-in="pFollow"'+(PREF.follow?' checked':'')+'>再生ヘッドを追いかける</label>');
  else{var groups=[];KB.forEach(function(k){if(groups.indexOf(k[1])<0)groups.push(k[1]);});
    body='<h3>ショートカット</h3>'+
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
PREF={snap:true,follow:true,ui:0.75,uiv:2,autoUpdate:true};
try{var pf=JSON.parse(localStorage.getItem('matsuko.pref')||'{}');if(typeof pf.snap==='boolean')PREF.snap=pf.snap;if(typeof pf.follow==='boolean')PREF.follow=pf.follow;if(typeof pf.autoUpdate==='boolean')PREF.autoUpdate=pf.autoUpdate;if(pf.uiv===2){if([0.65,0.75,0.9].indexOf(pf.ui)>=0)PREF.ui=pf.ui;else if(pf.ui===1)PREF.ui=0.9; /* 前の「大」（100%） */}
  /* 前の倍率（大 125%・デフォルト 100%・小 85% など）は、同じ名前の新しい倍率にする */
  else if(typeof pf.ui==='number')PREF.ui=pf.ui>=1.2?0.9:pf.ui>=0.95?0.75:0.65;}catch(e){}
S.snap=PREF.snap;
}
