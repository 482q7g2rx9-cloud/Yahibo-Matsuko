// @ts-nocheck
import { applyProjectSettings } from './projectSettings';
import { syncNativeMenu } from './menus';
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { D } from './data';
import { M, P } from './project';
import { S, persist } from './state';
import { A, h } from './util';
import { HOST, projName } from './desktop';
import { E, redrawProg } from './engine';
import { srcEl, stopAll } from './source';
import { X } from './exporter';
import { R } from './pages/media';
import { tlAfter } from './pages/edit';
import { closeMenu } from './menus';

/* ================================================================
   全体の描画
   ================================================================ */
export var lastPage;
export function head(){var m=D.meta[S.page];
  document.getElementById('top').innerHTML='<span class="logo">Matsuko Editor</span>'+(m.bare?'':'<span class="mu">/</span><span style="font-weight:500">'+h(P.sample?D.title:projName()||'新規プロジェクト')+'</span>'+
    '<span class="grow"></span>'+(P.sample?'<span class="mu">'+m.role+'</span>':'')+'<span class="t-ok" data-saved>'+(S.savedAt?'● 自動保存済み '+S.savedAt:HOST?(projName()?'● 自動保存':P.sample?'見本（保存されません）':'● 素材を読み込むと自動保存'):'● このブラウザに自動保存')+'</span>'+
    (m.people&&P.sample?'<span class="av" aria-label="作業中のメンバー">'+D.people.map(function(p){return '<span style="background:'+p[1]+';color:'+p[2]+'">'+p[0]+'</span>';}).join('')+'</span>':''));}
export function nav(){document.getElementById('pages').innerHTML=D.pages.map(function(p){return '<button'+A('go',p[0])+(S.page===p[0]?' aria-current="page"':'')+'>'+p[1]+'</button>';}).join('');}
export function draw(){applyProjectSettings();if(S.page!=='fx'&&E)E.noFx=null;var pg=document.getElementById('page'),f=document.activeElement,fk=f&&f.dataset&&f.dataset.in,pos=f&&f.selectionStart;
  var sc=[].map.call(pg.querySelectorAll('.scroll'),function(e){return e.scrollTop;});
  pg.innerHTML=R[S.page]();head();nav();
  if(lastPage!==S.page){pg.classList.remove('enter');void pg.offsetWidth;pg.classList.add('enter');lastPage=S.page;}
  else [].forEach.call(pg.querySelectorAll('.scroll'),function(e,i){if(sc[i])e.scrollTop=sc[i];});
  if(fk){var n=pg.querySelector('[data-in="'+fk+'"]');if(n){n.focus();try{n.setSelectionRange(pos,pos);}catch(e){}}}
  var box=pg.querySelector('[data-srcbox]');if(box){var m=M(S.src);var el=m&&srcEl(m);if(el)box.appendChild(el);}
  if(S.page==='edit')tlAfter();
  if(X&&X.run&&X.cv)[].forEach.call(pg.querySelectorAll('canvas[data-prog]'),function(c){c.getContext('2d').drawImage(X.cv,0,0,c.width,c.height);});else redrawProg();
  document.title='Matsuko Editor — '+D.pages.filter(function(p){return p[0]===S.page;})[0][1];syncNativeMenu();}
export function go(p){if(!R[p])return;stopAll();closeMenu();S.page=p;persist();draw();}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
lastPage=null;
}
