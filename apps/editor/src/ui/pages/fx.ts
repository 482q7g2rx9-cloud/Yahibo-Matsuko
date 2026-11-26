// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { D } from '../data';
import { M } from '../project';
import { S } from '../state';
import { A, TRI, btn, diamond, film, fsec, h, ibtn, ic, ph, playBtn, prop, sel, tc, transport } from '../util';
import { FXP } from '../source';
import { R } from './media';

/* ---- エフェクト（見本） ---- */
export function timeline(tl,key,opt){opt=opt||{};var y=36,tops={},hd='<div class="hd tch" data-time="'+key+'">'+(opt.noTc?'':tc(S.t[key]))+'</div>',ar='';
  tl.tracks.forEach(function(t){tops[t.id]=y;hd+='<div class="hd" style="top:'+y+'px;height:'+t.h+'px"><b>'+h(t.id)+'</b><span class="mu">'+h(t.s)+'</span></div>';if(t.lane)ar+='<div class="lane" style="top:'+y+'px;height:'+t.h+'px"></div>';y+=t.h+4;});
  var step=tl.total/5,ru='<div class="ru"></div>';for(var i=0;i<5;i++)ru+='<div class="rl" style="left:'+(i*20)+'%">'+tc(i*step)+'</div>';ru+='<div class="rd"></div>';
  tl.items.forEach(function(it){var top=tops[it.tr],tr=tl.tracks.filter(function(t){return t.id===it.tr;})[0],st='left:'+it.l+'%;top:'+top+'px;height:'+tr.h+'px;'+(it.w!=null?'width:'+it.w+'%;':''),m=it.m&&(M(it.m)||D.media.filter(function(x){return x.id===it.m;})[0]),fx=it.fx?'<span class="fxb" style="width:16px;height:12px;line-height:12px">fx</span>':'';
    if(it.k==='video')ar+='<div class="ci video" style="'+st+'" title="'+h(m.n)+'"><div class="chd">'+fx+h(m.n)+'</div><div class="fm" style="'+film(m)+'"></div></div>';
    else if(it.k==='tr')ar+='<div class="ci tr" style="'+st+'" title="'+h(it.t)+'"></div>';
    else ar+='<div class="ci '+it.k+'" style="'+st+'line-height:'+(tr.h-2)+'px" title="'+h(it.t)+'">'+h(it.t)+'</div>';});
  if(opt.kf){var kt=tops['拡大率'];ar+='<svg style="position:absolute;left:0;top:'+kt+'px;width:100%;height:44px;pointer-events:none" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="var(--ac)" stroke-width="1.5" vector-effect="non-scaling-stroke" points="'+tl.kf.map(function(p){return p[0]+','+p[1];}).join(' ')+'"/></svg>';
    tl.kf.forEach(function(p,i){ar+='<div class="kd" style="left:'+p[0]+'%;top:'+(kt+p[1]-6)+'px">'+diamond(i===1)+'</div>';});
    ar+='<div style="position:absolute;left:'+tl.kfLabel[0]+'%;top:'+(kt+2)+'px;margin-left:8px;color:var(--lb)">'+tl.kfLabel[1]+'</div>';}
  var p=S.t[key]/tl.total*100;ar+='<div class="phl" data-head="'+key+'" style="left:'+p+'%"></div><div class="phk" data-head="'+key+'" style="left:'+p+'%"></div>';
  return '<div class="tl"'+(opt.kf?' data-kfarea':'')+'>'+hd+'<div class="ar">'+ru+ar+'</div></div>';}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
R.fx=function(){
  var lib=D.fxlib.map(function(g){var c=!!S.fxClosed[g[0]];return '<button'+A('fxg',g[0])+' aria-expanded="'+!c+'" style="width:100%;height:30px;display:flex;align-items:center;gap:10px;padding:0 16px;border:0;border-top:1px solid var(--dv);border-bottom:1px solid var(--dv);background:var(--bg2);color:var(--tx2)">'+(c?TRI.rr:TRI.d)+'<span>'+h(g[0])+'</span></button>'+
    (c?'':g[1].map(function(e){return '<div class="li'+(S.fx===e[0]?' selr':'')+'" role="button" tabindex="0"'+A('fxi',e[0])+' style="display:flex;align-items:center;gap:10px;height:34px;padding:0 16px"><span style="width:24px;height:24px;border-radius:3px;background:'+e[1]+';border:1px solid var(--bd2)"></span><span>'+h(e[0])+'</span></div>';}).join(''));}).join('');
  var kfBtns='<button class="b s" aria-label="前のキーフレーム">'+TRI.l+'</button><button class="b s" aria-label="キーフレームを追加／削除">'+diamond(0)+'追加／削除</button><button class="b s" aria-label="次のキーフレーム">'+TRI.r+'</button><span class="vsep"></span>'+
    ['リニア','ベジェ','停止'].map(function(k){return btn(k,'kfm',k,'s'+(S.kfMode===k?' on':''));}).join('')+'<span class="vsep"></span><button class="b s" aria-label="イーズイン">イン</button><button class="b s" aria-label="イーズアウト">アウト</button>';
  var after=S.ba==='after';
  return '<div class="pn l" style="width:260px">'+ph('エフェクト')+'<div style="padding:10px 12px"><input class="inp" type="search" placeholder="エフェクトを検索" aria-label="エフェクトを検索" style="width:100%"></div><div class="scroll">'+lib+'</div></div>'+
  '<div class="pc">'+ph('プレビュー','<span class="x">クロスディゾルブ 50%</span><span class="seg">'+btn('適用前','ba','before','s'+(after?'':' on'))+btn('適用後','ba','after','s'+(after?' on':''))+'</span>')+
    '<div class="mon" style="height:290px"><div class="frame" style="width:440px;height:248px;color:#c8c8d8;'+(after?'background:linear-gradient(90deg,#5a4a78,#2a4e7a)':'background:#5a4a78')+'">'+(after?'八百屋 外観 → 店主 インタビュー':'八百屋 外観')+
      (after?'<div style="position:absolute;left:250px;top:50px;width:84px;height:120px;border:2px solid #ffb454"></div><div style="position:absolute;left:250px;top:30px;height:20px;padding:0 8px;background:#ffb454;color:#2a1a00;line-height:20px">追跡中　被写体1</div>'+
      [[150,132],[170,128],[190,125],[210,122],[230,120]].map(function(p){return '<span style="position:absolute;left:'+p[0]+'px;top:'+p[1]+'px;width:5px;height:5px;background:#ffb454"></span>';}).join('')+
      [[248,48],[330,48],[248,168],[330,168]].map(function(p){return '<span style="position:absolute;left:'+p[0]+'px;top:'+p[1]+'px;width:7px;height:7px;background:#fff;border:1px solid #ffb454"></span>';}).join(''):'')+'</div></div>'+
    transport('fx',ibtn('toStart','前のカットへ','todo')+playBtn(!!FXP)+ibtn('nextCut','次のカットへ','todo'),'<span class="mu">見本の画面です</span>')+
    '<div class="row" style="height:40px;flex:none;gap:6px;padding:0 12px;border-bottom:1px solid var(--dv)"><span style="font-weight:500;margin-right:4px;white-space:nowrap">キーフレーム</span>'+kfBtns+'<span class="grow"></span>'+sel('対象プロパティ',['拡大率','位置','回転','透明度'],'拡大率','height:26px')+'</div>'+
    timeline(D.fxtl,'fx',{kf:1,noTc:1})+'</div>'+
  '<div class="pn r" style="width:320px">'+ph('エフェクトコントロール','<span class="x">店主 インタビュー</span>')+'<div class="scroll">'+
    fsec('track','トラッキング',true,'<div class="fg"><span>追跡対象</span>'+sel('追跡対象',['被写体1（店主）','被写体2'],'被写体1（店主）')+'</div>'+
      '<div class="row" style="gap:6px;height:42px">'+btn(TRI.l+'後方','todo','','','後方')+btn(ic('stop',12)+'停止','todo','','','停止')+btn(TRI.r+'前方','todo','','on','前方')+'</div>'+
      '<div class="fg"><span>状態</span><span class="row" style="gap:8px"><span class="prog" style="flex:1"><i style="width:100%;background:var(--ok)"></i></span><span class="t-ok">解析済み</span></span></div>'+
      '<div class="fg"><span>追従先</span>'+sel('追従先',['テロップを追従（質問テロップ）','なし'],'テロップを追従（質問テロップ）')+'</div>'+prop(['滑らかさ',40,'40']),1)+
    fsec('color','色補正',true,[['明るさ',55,'8.0'],['コントラスト',58,'12.0'],['彩度',60,'110',1]].map(prop).join(''),1)+
    fsec('blur','ぼかし',false,'',1)+fsec('tin','開始トランジション',true,'',1)+fsec('motion','モーション',true,'',1)+'</div></div>';
};
}
