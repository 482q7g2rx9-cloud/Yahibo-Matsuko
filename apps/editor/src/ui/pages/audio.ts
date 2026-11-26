// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { D } from '../data';
import { S } from '../state';
import { A, TRI, btn, h, ic, ph, sel, tc, wave } from '../util';
import { REC } from '../source';
import { R } from './media';


/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
R.audio=function(){
  var ln=D.lines[S.line],tk=D.takes[S.tsel];
  return '<div class="pn l" style="width:330px">'+ph('台本','<span class="chip c-in" style="padding:4px 10px">自動スクロール ON</span>')+'<div class="scroll">'+
    D.lines.map(function(l,i){return '<div class="li'+(S.line===i?' selr':'')+'" role="button" tabindex="0"'+A('line',i)+' style="display:grid;grid-template-columns:44px 1fr 24px;gap:0;padding:14px 10px 12px;border-bottom:1px solid var(--dv)"><span class="t2">'+l.t+'</span><span><span style="display:block;font-size:15px;'+(l.st==='done'?'color:var(--mu)':'')+'">'+h(l.tx)+'</span><span class="t2" style="display:block;margin-top:6px">映像：'+h(l.v)+'</span></span><span>'+(l.st==='done'?'<span class="t-ok">済</span>':i===S.line?'<span style="display:block;width:11px;height:11px;border-radius:50%;background:#f06060;margin-top:4px" aria-label="録音対象"></span>':'')+'</span></div>';}).join('')+'</div>'+
    '<div style="padding:12px 16px;border-top:1px solid var(--dv)"><div style="font-weight:500;margin-bottom:8px">共有制作メモ</div>'+D.memos.map(function(m){return '<div class="box" style="margin-top:4px"><span class="t-lb">'+h(m[0])+'</span>　'+h(m[1])+'</div>';}).join('')+'</div></div>'+
  '<div class="pc">'+
    '<div class="row" style="height:42px;flex:none;padding:0 16px;border-bottom:1px solid var(--dv);background:var(--bg1)"><span class="seg">'+btn('動画に合わせて録音','rmode','sync',S.rmode==='sync'?'on':'')+btn('自由に録音','rmode','free',S.rmode==='free'?'on':'')+'</span><span class="grow"></span><span class="mu">録音先：ナレーション / 台本行 SR-000'+(S.line+1)+'</span></div>'+
    '<div class="row" style="height:200px;flex:none;gap:12px;padding:14px;align-items:flex-start;background:var(--bg0)">'+
      '<div style="width:290px;height:172px;flex:none;background:#000;position:relative;display:flex;align-items:center;justify-content:center">'+(S.rmode==='sync'?'<div class="frame" style="width:260px;height:146px;background:#333;border:0">'+h(ln.v)+'（プロキシ）</div><span style="position:absolute;left:6px;bottom:2px;color:#9a9a9a">映像再生に同期</span>':'<span style="color:#9a9a9a">自由録音（映像なし）</span>')+'</div>'+
      '<div class="grow" style="display:flex;flex-direction:column;gap:6px"><div class="fg" style="grid-template-columns:64px 1fr;min-height:30px"><span>入力</span>'+sel('入力',['マイク入力 1（USBマイク）','内蔵マイク'],'マイク入力 1（USBマイク）')+'</div>'+
        '<div class="row" style="gap:10px"><span class="t2" style="width:54px">レベル L</span><span class="lvl"><i style="width:60%"></i></span></div><div class="row" style="gap:10px"><span class="t2" style="width:54px">レベル R</span><span class="lvl"><i style="width:56%"></i></span></div>'+
        '<div data-rec style="font-size:24px;color:var(--ac)">'+tc(S.rec)+'</div>'+
        '<div class="row" style="gap:8px"><button class="b" aria-label="録音" title="録音"'+A('rec')+' style="width:48px;height:34px;color:var(--er)'+(REC?';background:var(--erb);border-color:var(--er)':'')+'">'+ic('rec',14)+'</button><button class="b" aria-label="停止" title="停止"'+A('stop')+' style="width:40px;height:34px">'+ic('stop',14)+'</button><button class="b" aria-label="再生" title="再生"'+A('todo')+' style="width:40px;height:34px">'+ic('play',14)+'</button><button class="b" aria-label="先頭へ" title="先頭へ"'+A('recTop')+' style="width:40px;height:34px">'+ic('toStart',14)+'</button>'+
        '<label class="row" style="gap:6px;margin-left:6px"><input type="checkbox" data-in="countin"'+(S.countin?' checked':'')+' style="margin:0">カウントイン</label></div></div></div>'+
    ph(h(tk[0])+' の波形','<span class="x">'+tc(tk[2])+'</span>')+
    '<div style="height:116px;flex:none;padding:8px 10px;background:var(--bg1);border-bottom:1px solid var(--dv)"><div style="height:100%;background:#2f78b7;border:1px solid #8cc4ee">'+wave(180,S.tsel+11)+'</div></div>'+
    ph('テイク一覧')+'<div class="tk h"><span>テイク</span><span>波形</span><span>長さ</span><span>試聴</span><span>比較</span><span>採用</span></div>'+
    D.takes.map(function(t,i){return '<div class="tk r li'+(S.tsel===i?' selr':'')+'"'+A('tsel',i)+' style="'+(S.tsel===i?'box-shadow:none':'')+'"><b style="font-weight:500">'+t[0]+'</b><span class="mw">'+wave(60,i+21,'currentColor')+'</span><span>'+t[1]+'</span><span><button class="b s" style="width:40px;padding:0" aria-label="'+t[0]+'を試聴">'+ic('play',12)+'</button></span><span><input type="checkbox" aria-label="'+t[0]+'を比較"></span><span><input type="radio" name="take" aria-label="'+t[0]+'を採用"'+(S.take===i?' checked':'')+A('take',i)+'></span></div>';}).join('')+
    '<div class="row" style="gap:8px;padding:12px 16px;border-top:1px solid var(--dv)">'+btn('メディアに保存','todo')+btn('タイムラインに配置','todo')+'<span class="grow"></span><span class="t-ok">'+D.takes[S.take][0]+' はメディア登録済み</span></div></div>'+
  '<div class="pn r" style="width:300px">'+ph('ミキサー')+'<div class="mx">'+D.mixer.map(function(c){var m=S.mute[c[0]],s=S.solo[c[0]];return '<div class="ch"><span class="t2">'+c[0]+'</span><div class="fd"><span class="rail"><i style="top:'+c[1]+'%"></i></span><span class="met"><i style="height:'+(m?0:c[2])+'%"></i></span></div><span class="nv" style="justify-self:center">'+c[3]+'</span><span class="ms"><button aria-pressed="'+!!m+'" aria-label="'+c[0]+' ミュート"'+A('mute',c[0])+'>M</button><button aria-pressed="'+!!s+'" aria-label="'+c[0]+' ソロ"'+A('solo',c[0])+'>S</button></span></div>';}).join('')+'</div>'+
    ph('インサート（ナレーション）')+'<div style="padding:12px 16px;display:flex;flex-direction:column;gap:4px">'+D.inserts.map(function(x,i){return '<div class="row" style="gap:8px;height:30px;padding:0 10px;border-radius:4px;background:var(--bg2)"><input type="checkbox"'+(x[1]?' checked':'')+' aria-label="'+h(x[0])+'を有効" style="margin:0"><span>'+(i+1)+'</span><span class="grow">'+h(x[0])+'</span>'+(x[2]?btn('開く','todo','','s'):'')+'</div>';}).join('')+'<button class="b dash" style="width:100%;justify-content:flex-start"'+A('todo')+'>＋ VST3 を追加</button></div>'+
    ph('基本ノイズ処理')+'<div style="padding:12px 16px">'+D.noise.map(function(n){return '<div style="display:grid;grid-template-columns:70px 1fr 34px 50px;gap:6px;align-items:center;height:30px"><button class="b s" style="padding:0 6px">'+n[0]+'</button><div class="slr" style="--p:'+n[1]+'%"><i style="left:'+n[1]+'%"></i></div><span class="stp"><button aria-label="減らす '+n[0]+'">'+TRI.l+'</button><button aria-label="増やす '+n[0]+'">'+TRI.r+'</button></span><span class="nv">'+n[2]+'</span></div>';}).join('')+'</div></div>';
};
}
