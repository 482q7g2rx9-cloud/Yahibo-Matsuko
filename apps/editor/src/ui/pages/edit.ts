// @ts-nocheck
import { SYS_PREFIX, TITLE_FONTS, TITLE_PRESETS, canQueryLocalFonts, fontById, isSystemFont, presetById, presetThumb, systemFonts, systemFontsState } from '../titleStyles';
import { HOST } from '../desktop';
import { canvasAttrs, pqLabel } from '../projectSettings';
import { pw, splitter } from '../panels';
import * as KS from '../../core/silence';
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { D } from '../data';
import { C, M, P, T, cEnd, cLen, hasFx, progDur } from '../project';
import { S } from '../state';
import { A, TRI, btn, diamond, filmStyle, fsec, h, ibtn, ic, kv, mmss, ph, playBtn, sel, tabs, tc, waveOf } from '../util';
import { mark, saveP } from '../store';
import { E, TST, audible, redrawProg, sync } from '../engine';
import { fitZoom, primary, zoomVal } from '../editOps';
import { num } from '../exporter';
import { R } from './media';
import { draw } from '../render';
import { keyOf } from '../keys';

/* ---- 編集：タイムライン ---- */
export var ROWS;
export var EYE, LOCK;
export function tbtn(act,id,on,label,inner,cls){return '<button class="tb2'+(cls?' '+cls:'')+'" aria-pressed="'+!!on+'" aria-label="'+id+' '+label+'" title="'+label+'"'+A(act,id)+'>'+inner+'</button>';}
export function tickStep(pps){var st=[1/30,2/30,5/30,10/30,.5,1,2,5,10,15,30,60,120,300,600];for(var i=0;i<st.length;i++)if(st[i]*pps>=96)return st[i];return 600;}
export function clipHtml(c,r,pps){var m=c.m?M(c.m):null,on=S.sel.indexOf(c.id)>=0,tr=T(c.tr),x=c.start*pps,w=Math.max(2,cLen(c)*pps),
    st='left:'+x.toFixed(1)+'px;width:'+w.toFixed(1)+'px;top:'+r.y+'px;height:'+r.h+'px;',cls=(on?' on':'')+(tr.lock?' lkd':''),
    fx=(c.type==='title'||r.kind==='v'&&c.type==='media'&&(hasFx(c)||m&&m.sample))?'<span class="fxb" style="width:16px;height:12px;line-height:12px">fx</span>':'',
    nm=h(c.type==='title'?String(c.label||'').split('\n')[0]:c.type==='adj'?c.label:m?m.n:'（素材なし）'),
    tip=' title="'+nm+'　'+tc(c.start)+'〜'+tc(cEnd(c))+(c.link?'（リンク）':'')+'"',tm='<span class="trim l"></span><span class="trim r"></span>';
  if(r.kind==='v'){
    if(c.type==='title')return '<div class="ci title'+cls+'" data-c="'+c.id+'"'+tip+' style="'+st+'line-height:'+(r.h-2)+'px">'+fx+nm+tm+'</div>';
    if(c.type==='adj')return '<div class="ci adj'+cls+'" data-c="'+c.id+'"'+tip+' style="'+st+'line-height:'+(r.h-2)+'px">'+nm+tm+'</div>';
    return '<div class="ci video'+cls+'" data-c="'+c.id+'"'+tip+' style="'+st+'"><div class="chd">'+fx+nm+(c.link?'<span class="lnk" aria-hidden="true">⛓</span>':'')+'</div>'+(r.h>=40?'<div class="fm" style="'+filmStyle(m)+'"></div>':'')+tm+'</div>';}
  var k=m&&m.k==='音声'?'bgm':m&&m.k==='テイク'?'na':'wave',fill={wave:'#a9d6f5',bgm:'rgba(3,42,32,.45)',na:'rgba(20,7,46,.5)'}[k];
  return '<div class="ci '+k+' snd'+cls+'" data-c="'+c.id+'"'+tip+' style="'+st+'">'+(m&&m.k!=='画像'?waveOf(m,c.in,c.out,Math.max(4,Math.min(400,Math.round(w/3))),fill):'')+'<span class="cl">'+nm+(c.vol?'　'+(c.vol>0?'+':'')+c.vol+' dB':'')+'</span>'+tm+'</div>';}
export function tlInner(){var pps=S.pps||10,dur=progDur(),b=document.querySelector('[data-body]'),bw=b?b.clientWidth:900,W=Math.ceil(Math.max(dur*pps+400,bw+200)),y=0,hd='',ln='',cl='';ROWS=[];
  P.tracks.forEach(function(tr){ROWS.push({id:tr.id,kind:tr.kind,y:y,h:tr.h});var off=tr.kind==='v'?tr.hide:!audible(tr);
    hd+='<div class="hrow'+(tr.lock?' lk':'')+(off?' off':'')+'" data-trh="'+tr.id+'" style="top:'+y+'px;height:'+tr.h+'px"><b>'+tr.id+'</b><span class="mu nm">'+h(tr.name||'')+'</span>'+
      (tr.kind==='v'?tbtn('thide',tr.id,tr.hide,tr.hide?'表示する':'隠す',EYE,'eye'):tbtn('tmute',tr.id,tr.mute,'ミュート','M','m')+tbtn('tsolo',tr.id,tr.solo,'ソロ','S','s'))+tbtn('tlock',tr.id,tr.lock,tr.lock?'ロックを解除':'ロック',LOCK,'l')+'</div>';
    ln+='<div class="lane'+(tr.lock?' lk':'')+(off?' off':'')+'" data-lane="'+tr.id+'" style="top:'+y+'px;height:'+tr.h+'px;width:'+W+'px"></div>';y+=tr.h+4;});
  var H=y;P.clips.forEach(function(c){var r=ROWS.filter(function(x){return x.id===c.tr;})[0];if(r)cl+=clipHtml(c,r,pps);});
  var step=tickStep(pps),lab='';for(var t=0;t*pps<W;t+=step)lab+='<div class="rl" style="left:'+(t*pps).toFixed(1)+'px">'+tc(t)+'</div>';
  var rng=P.pin!=null||P.pout!=null?'<div class="rng" style="left:'+((P.pin||0)*pps)+'px;width:'+(((P.pout!=null?P.pout:dur)-(P.pin||0))*pps)+'px" title="書き出し範囲"></div>':'',ph0=S.t.edit*pps;
  return '<div class="corner" data-time="edit">'+tc(S.t.edit)+'</div>'+
    '<div class="rul" data-rul><div class="rin" style="width:'+W+'px;background-image:repeating-linear-gradient(90deg,var(--bd2) 0 1px,transparent 1px '+(step*pps/5).toFixed(2)+'px)">'+lab+'<div class="rd" style="width:'+(dur*pps)+'px;right:auto"></div>'+rng+'<div class="phk" data-head="edit" style="left:'+ph0+'px;top:16px"></div></div></div>'+
    '<div class="heads" data-heads><div class="hin" style="height:'+H+'px">'+hd+'</div></div>'+
    '<div class="body" data-body><div class="tlc" style="width:'+W+'px;height:'+Math.max(H,10)+'px">'+ln+cl+
      (P.clips.length?'':'<div class="mu" style="position:absolute;left:12px;top:'+((ROWS.filter(function(r){return r.id==='V1';})[0]||{y:0}).y+30)+'px;pointer-events:none">左の素材を、ここへドラッグするか「＋」で追加してください</div>')+
      '<div class="phl" data-head="edit" style="left:'+ph0+'px"></div><div class="snapl" data-snapl hidden></div><div class="marq" data-marq hidden></div><div class="ghost" data-ghost hidden></div></div></div>';}
export function syncTLScroll(){var b=document.querySelector('[data-body]');if(!b)return;var r=document.querySelector('[data-rul] .rin'),hd=document.querySelector('[data-heads] .hin');if(r)r.style.transform='translateX('+(-b.scrollLeft)+'px)';if(hd)hd.style.transform='translateY('+(-b.scrollTop)+'px)';}
export function tlAfter(){var b=document.querySelector('[data-body]');if(!b)return;if(S.pps==null){fitZoom();drawTL();return;}b.scrollLeft=S.tlx||0;b.scrollTop=S.tly||0;syncTLScroll();}
export function drawTL(){var w=document.querySelector('[data-tlwrap]');if(!w)return;w.innerHTML=tlInner();tlAfter();var z=document.querySelector('[data-in="zoom"]');if(z)z.value=zoomVal();}
/* インスペクタ */
/* インスペクタの数値の行（エフェクト欄と同じ形）：◇ キーフレーム／スライダー／◀▶／数値（左右ドラッグで増減、クリックで入力） */
export var PROPS;
/* テロップの文字サイズ（1080p の画面での px）。まだ決めていなければ、前の「小・中・大」から */
export var TITLE_PX={'小':45,'中':59,'大':81};
export function propVal(c,key){if(key==='fsz'&&c.fsz==null)return TITLE_PX[c.sz||'中']||59;return c[key]==null?PROPS[key].def:c[key];}
export function propPct(key,v){var p=PROPS[key];return Math.max(0,Math.min(100,(v-p.min)/(p.max-p.min)*100));}
export function propTxt(key,v){return (+v).toFixed(PROPS[key].dec);}
export function numRow(label,c,key){var p=PROPS[key],v=propVal(c,key),id=c.id;
  return '<div class="pr"><button class="kf" aria-label="'+label+'のキーフレーム" title="キーフレーム（エフェクトページの本実装で使えるようになります）"'+A('kfTodo')+'>'+diamond(false)+'</button><span class="t2">'+label+'</span>'+
    '<input type="range" class="rg" min="'+p.min+'" max="'+p.max+'" step="'+p.step+'" value="'+v+'" style="--p:'+propPct(key,v)+'%" data-in="cp" data-k="'+key+'" data-cid="'+id+'" aria-label="'+label+'">'+
    '<span class="stp"><button aria-label="'+label+'を減らす"'+A('cstep',id+'|'+key+'|-1')+'>'+TRI.l+'</button><button aria-label="'+label+'を増やす"'+A('cstep',id+'|'+key+'|1')+'>'+TRI.r+'</button></span>'+
    '<span class="v hot" tabindex="0" role="spinbutton" aria-label="'+label+'" aria-valuenow="'+v+'" aria-valuemin="'+p.min+'" aria-valuemax="'+p.max+'" data-hot data-k="'+key+'" data-cid="'+id+'" title="左右にドラッグで増減、クリックで入力">'+propTxt(key,v)+'<small>'+p.unit+'</small></span></div>';}
export function motionForm(c){return numRow('位置 X',c,'x')+numRow('位置 Y',c,'y')+numRow('拡大率',c,'scale')+numRow('回転',c,'rot')+numRow('不透明度',c,'op')+
  '<div class="row" style="justify-content:flex-end;padding-top:8px">'+btn('元に戻す','mreset',c.id,'s')+'</div>';}
/* 値を変えて、同じ値を表示している部品（スライダー・数値）をそろえる */
export function setProp(cid,key,v){var c=C(cid),p=PROPS[key];if(!c||!p||isNaN(v))return;v=Math.round(Math.max(p.min,Math.min(p.max,v))/p.step)*p.step;v=+v.toFixed(3);c[key]=v;
  [].forEach.call(document.querySelectorAll('[data-k="'+key+'"][data-cid="'+cid+'"]'),function(x){if(x.tagName==='INPUT'&&x.type==='range'){x.value=v;x.style.setProperty('--p',propPct(key,v)+'%');}else if(x.hasAttribute('data-hot')){x.firstChild.nodeValue=propTxt(key,v);x.setAttribute('aria-valuenow',v);}});
  redrawProg();saveP();if(key==='vol')sync(S.t.edit,E.playing);}
/* 数値をクリックしたときの入力欄 */
export function hotEdit(el){var cid=el.dataset.cid,key=el.dataset.k,c=C(cid);if(!c)return;var inp=document.createElement('input');inp.className='inp hotin';inp.type='number';inp.step=PROPS[key].step;inp.value=propVal(c,key);inp.setAttribute('aria-label',el.getAttribute('aria-label'));
  el.replaceWith(inp);inp.focus();inp.select();var done=false;
  function fin(ok){if(done)return;done=true;if(ok&&inp.value!==''&&+inp.value!==propVal(c,key)){mark();setProp(cid,key,parseFloat(inp.value));}draw();}
  inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();fin(true);}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();fin(false);}});
  inp.addEventListener('blur',function(){fin(true);});}
export function titleForm(c){return '<div style="display:flex;flex-direction:column;gap:6px;padding:4px 0">'+
  '<label for="ttext" class="t2">文字（改行できます）</label><textarea class="inp" id="ttext" data-in="ttext" rows="3" style="width:100%;height:auto;padding:6px 8px;resize:vertical">'+h(c.label)+'</textarea>'+
  fontRow(c)+
  '<div class="fg"><span>太さ</span>'+(fontById(c.font).weight?'<span class="mu">このフォントは太さが決まっています</span>':'<span class="seg">'+[[400,'細め'],[700,'標準'],[900,'極太']].map(function(x){return btn(x[1],'tSet','weight|'+x[0],'s'+((c.weight||700)===x[0]?' on':''));}).join('')+'</span>')+'</div>'+
  '<div class="fg"><span>揃え</span><span class="seg">'+[['left','左'],['center','中央'],['right','右']].map(function(x){var cur=c.align||(c.st==='credit'||c.st==='sub'?'center':'left');return btn(x[1],'tSet','align|'+x[0],'s'+(cur===x[0]?' on':''));}).join('')+'</span></div>'+
  numRow('行間',c,'lh')+numRow('文字の間隔',c,'ls')+
  '<div class="fg"><span>スタイル</span><span class="row" style="gap:8px;min-width:0">'+(c.look?'<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+h((presetById(c.lookId)||{name:'カスタム'}).name)+'</span>'+btn('外す','tLookOff','','s'):'<span class="mu">なし（テロップタブで選べます）</span>')+'</span></div>'+
  '<div class="fg"><span>開始（秒）</span><input class="inp" type="number" step="0.1" min="0" data-in="tstart" value="'+c.start.toFixed(1)+'" aria-label="開始（秒）"></div>'+
  '<div class="fg"><span>長さ（秒）</span><input class="inp" type="number" step="0.1" min="0.5" data-in="tdur" value="'+cLen(c).toFixed(1)+'" aria-label="長さ（秒）"></div>'+
  '<div class="row" style="gap:8px">'+btn('再生ヘッドへ移動','tToHead','','s')+btn('削除','delSel','','s')+'</div></div>';}
/* フォントの選択。アプリのフォント（同梱）と PC のフォント（titleStyles.ts の systemFonts）を分けて出す */
function fontRow(c){var cur=c.font||'gothic',sys=systemFonts(),st=systemFontsState(),desk=!!HOST;
  var opt=function(id,name){return '<option value="'+h(id)+'"'+(cur===id?' selected':'')+'>'+h(name)+'</option>';};
  var o='<optgroup label="アプリのフォント">'+TITLE_FONTS.map(function(f){return opt(f.id,f.name);}).join('')+'</optgroup>';
  var missing=isSystemFont(cur)&&!sys.some(function(f){return SYS_PREFIX+f.family===cur;});
  if(sys.length||missing)o+='<optgroup label="PC のフォント'+(sys.length?'（'+sys.length+'）':'')+'">'+(missing?opt(cur,fontById(cur).name+(st==='ok'?'（この PC にありません）':'')):'')+sys.map(function(f){return opt(SYS_PREFIX+f.family,f.name);}).join('')+'</optgroup>';
  var r='<div class="fg"><span>フォント</span><select class="inp" data-in="tfont" aria-label="フォント">'+o+'</select></div>';
  if(desk){if(st!=='ok')r+='<div class="mu" style="font-size:11px">PC のフォントを読み込んでいます…</div>';}
  else{if(canQueryLocalFonts()&&st!=='ok')r+='<div class="row" style="gap:8px;justify-content:flex-end">'+btn(st==='loading'?'読み込み中…':'PC のフォントを読み込む','tSysFonts','','s')+'</div>'+(st==='error'?'<div class="mu" style="font-size:11px">PC のフォントを読めませんでした。下の欄に名前を入れても使えます。</div>':'');
    if(!canQueryLocalFonts()||st==='error')r+='<div class="fg"><span>名前で指定</span><input class="inp" data-in="tfontname" placeholder="例：メイリオ" aria-label="PC のフォントの名前" value="'+(isSystemFont(cur)?h(cur.slice(SYS_PREFIX.length)):'')+'"></div>';}
  return r;}
/* テロップのスタイルの一覧（titleStyles.ts）。テロップを選んでいればそのスタイルを変え、選んでいなければ新しく追加する */
export function styleGallery(){var t=selTitle(),cur=t&&t.lookId;
  return '<div class="mu" style="line-height:1.6;margin-bottom:10px">'+(t?'選んでいるテロップのスタイルを変えます。':'押すと、そのスタイルのテロップを再生ヘッドの位置に追加します（T キーでも追加できます）。')+'画面の上・字幕・クレジットなどの種類は、インスペクタで変えられます。</div>'+
    '<div class="tsg" role="list">'+TITLE_PRESETS.map(function(p){return '<button class="tsl'+(cur===p.id?' on':'')+'" role="listitem" title="'+h(p.name)+'" aria-label="'+h(p.name)+'"'+(cur===p.id?' aria-pressed="true"':'')+A('tLook',p.id)+'><span class="tsb"><img src="'+presetThumb(p)+'" alt=""></span><span class="tsn">'+h(p.name)+'</span></button>';}).join('')+'</div>';}
/* テロップの位置・文字サイズ・拡大率など（動画のクリップと同じ形） */
export function titleMotion(c){return numRow('位置 X',c,'x')+numRow('位置 Y',c,'y')+numRow('文字サイズ',c,'fsz')+numRow('拡大率',c,'scale')+numRow('回転',c,'rot')+numRow('不透明度',c,'op')+
  '<div class="row" style="justify-content:flex-end;padding-top:8px">'+btn('元に戻す','mreset',c.id,'s')+'</div>';}
export function selTitle(){var c=primary();return c&&c.type==='title'?c:null;}
export function inspector(){var L=S.sel.map(C).filter(Boolean),c=primary();
  if(!c)return {name:'',html:fsec('clip','クリップ',null,'<div class="mu" style="padding:6px 0;line-height:1.7">タイムラインのクリップを選ぶと、ここに情報が出ます。<br>Shift／Ctrl＋クリック、または何もないところからドラッグすると、複数選べます。</div>')};
  var pair=L.length===2&&L[0].link&&L[0].link===L[1].link;
  if(L.length>1&&!pair){var tot=L.reduce(function(a,x){return a+cLen(x);},0);
    return {name:L.length+' 個を選択',html:fsec('clip','選んだクリップ',null,kv('数',L.length+' 個')+kv('合計の長さ',mmss(tot))+'<div class="row" style="gap:6px;flex-wrap:wrap;padding:8px 12px 2px">'+btn('削除','delSel','','s')+btn('リップル削除','rdel','','s')+btn(L.some(function(x){return x.link;})?'リンク解除':'リンク','lnk','','s')+btn('コピー','copy','','s')+'</div>')};}
  if(c.type==='title')return {name:'テロップ',html:fsec('motion','モーション・不透明度',null,titleMotion(c),1)+fsec('clip','テロップ',null,titleForm(c))};
  var m=c.m?M(c.m):null,a=pair?L.filter(function(x){return T(x.tr).kind==='a';})[0]:T(c.tr).kind==='a'?c:null,v=T(c.tr).kind==='v'?c:null;
  var info=kv('素材',h(m?m.n:c.label||'—'))+kv('トラック',c.tr+(a&&v?' / '+a.tr:''))+kv('開始',tc(c.start))+(c.type==='media'?kv('イン',tc(c.in))+kv('アウト',tc(c.out)):'')+kv('長さ',mmss(cLen(c)))+
    '<div class="row" style="gap:6px;flex-wrap:wrap;padding:8px 12px 2px">'+btn('再生ヘッドで分割','split','','s')+btn('削除','delSel','','s')+btn('リップル削除','rdel','','s')+(c.link||pair?btn('リンク解除','lnk','','s'):'')+'</div>';
  var h2=fsec('clip','クリップ',null,info);
  if(v&&v.type==='media')h2+=fsec('motion','モーション・不透明度',null,motionForm(v),1);
  if(a)h2+=fsec('audio','音量',null,numRow('音量',a,'vol'));
  if(m)h2+='<div style="padding:10px 16px;border-bottom:1px solid var(--dv);line-height:1.6"><div style="font-weight:500">リンク中の台本行</div><div class="mu">'+h(m.line&&m.line!=='—'?m.line:'—')+'</div></div>';
  return {name:m?m.n:c.label||'',html:h2};}
export function ms1(s){var m=Math.floor(s/60),x=s-m*60;return m+':'+(x<10?'0':'')+x.toFixed(1);}
/* 無音の検出：音量のピークがしきい値より小さい部分が、最短の長さ以上続いたところ */
export function detectSilence(m){if(!m.peaks||!m.d)return null;return KS.detectSilence(m.peaks,m.d,{thresholdDb:num(S.sil.thr),minLength:num(S.sil.min)});}
/* イン〜アウトから、削除にした無音を除いた部分 */
export function keepSegs(m,a,b){return KS.keepSegments(m.marks,a,b);}
export function silPanel(m){if(m.k==='画像')return '';var L=m.marks||[];
  return '<div class="blk"><div class="cap">不要部分（無音）</div><div class="row" style="gap:6px;margin-bottom:8px"><span class="mu">音量</span>'+sel('無音とみなす音量',['-45 dB','-40 dB','-35 dB','-30 dB','-25 dB'],S.sil.thr,'height:26px;width:84px','silthr')+'<span class="mu">長さ</span>'+sel('最短の長さ',['0.3 秒','0.5 秒','1 秒','2 秒'],S.sil.min,'height:26px;width:76px','silmin')+btn('検出','detect','','s')+'</div>'+
    (L.length?'<div style="max-height:220px;overflow:auto">'+L.map(function(k,i){return '<div style="display:grid;grid-template-columns:1fr 44px 56px;gap:8px;align-items:center;height:36px;border-bottom:1px solid var(--dv)"><span>'+ms1(k.a)+'–'+ms1(k.b)+'</span>'+(k.done?'<span class="t-ok">削除</span>':'<span class="t-wn">残す</span>')+btn(k.done?'戻す':'削除','smk',i,'s')+'</div>';}).join('')+'</div>'+
      '<div class="mu" style="margin-top:8px;line-height:1.6">削除 '+L.filter(function(k){return k.done;}).length+'件（'+ms1(L.filter(function(k){return k.done;}).reduce(function(s,k){return s+k.b-k.a;},0))+'）。削除にした部分は、仮編集へ追加するときに除かれます。</div>'
     :'<div class="mu" style="line-height:1.6">'+(m.peaks?'「検出」を押すと、音のない部分を探します。':m.sample?'見本の素材では検出できません。':'この素材は音声の波形がないため検出できません。')+'</div>')+'</div>';}
export function xRange(){var d=progDur();if(S.x&&S.x.range==='イン点〜アウト点'&&(P.pin!=null||P.pout!=null)){var a=P.pin||0,b=P.pout!=null?P.pout:d;return [Math.min(a,d),Math.min(b,d)];}return [0,d];}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
ROWS=[];
EYE='<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 110-8 4 4 0 010 8z"/></svg>';
LOCK='<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 10V7a5 5 0 0110 0v3h1v11H6V10zm2 0h6V7a3 3 0 00-6 0z"/></svg>';
PROPS={fsz:{min:12,max:300,step:1,unit:'px',def:59,dec:0},lh:{min:80,max:300,step:5,unit:'%',def:135,dec:0},ls:{min:-20,max:100,step:1,unit:'px',def:0,dec:0},x:{min:-100,max:100,step:1,unit:'%',def:0,dec:1},y:{min:-100,max:100,step:1,unit:'%',def:0,dec:1},scale:{min:10,max:400,step:1,unit:'%',def:100,dec:1},
  rot:{min:-180,max:180,step:1,unit:'°',def:0,dec:1},op:{min:0,max:100,step:1,unit:'%',def:100,dec:1},vol:{min:-30,max:12,step:0.5,unit:'dB',def:0,dec:1}};
R.edit=function(){
  var left;
  if(S.etab==='assets'){var L=P.media.filter(function(m){return m.k==='映像'||m.k==='音声'||m.k==='画像'||m.k==='テイク';});
    left='<div class="row" style="padding:12px 16px;gap:6px"><input class="inp grow" type="search" placeholder="素材を検索" aria-label="素材を検索" data-in="eq" value="'+h(S.eq||'')+'" style="height:28px">'+btn('＋ 読込','imp')+'</div><div class="mu" style="padding:0 16px 8px">タイムラインへドラッグして置けます（Ctrl で挿入）</div><div class="scroll"><div class="asg">'+
    L.filter(function(m){return !S.eq||m.n.indexOf(S.eq)>=0;}).map(function(m){var r=D.rights[m.r]||['—',''],can=(m.url&&!m.loading)||(m.sample&&m.k!=='音声'&&m.k!=='テイク');
      return '<div style="position:relative"'+(can?' data-am="'+m.id+'"':'')+'><div class="tb" style="cursor:'+(can?'grab':'default')+';background:'+(m.thumb?'#000 url('+m.thumb+') center / cover':m.k==='音声'?'#2f6b45':m.k==='テイク'?'#5a4a8a':(m.col||['#555'])[0])+'"><span>'+m.k+'</span><span>'+(m.k==='画像'?'':mmss(m.d))+'</span></div>'+
      (can?'<button class="b s" aria-label="「'+h(m.n)+'」をタイムラインに追加" title="タイムラインに追加"'+A('addtl',m.id)+' style="position:absolute;right:4px;top:4px;width:24px;height:24px;padding:0;border-radius:50%">'+ic('plus',14)+'</button>':'')+
      '<div style="margin-top:4px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(m.k==='音声'?h(m.c)+' ':'')+h(m.n)+'</div><div class="'+(m.r==='wn'?'t-wn':'t-ok')+'">'+r[0]+'</div></div>';}).join('')+'</div>'+(L.length?'':'<div class="mu" style="padding:0 16px">「＋ 読込」で動画・音声・画像を読み込めます。</div>')+'</div>';}
  else if(S.etab==='text')left='<div class="scroll" style="padding:14px">'+styleGallery()+'</div>';
  else left='<div class="scroll" style="padding:14px;display:flex;flex-direction:column;gap:8px">'+D.templates[S.etab].map(function(t){return '<div class="card"><b>'+h(t[0])+'</b><span>'+h(t[1])+'</span></div>';}).join('')+'</div>';
  var tools=[['select','選択',keyOf('tSel')],['split','分割',keyOf('tSplit')],['trash','削除',''],['hand','ハンド',keyOf('tHand')],['text','文字','']],ins=inspector(),rngOn=P.pin!=null||P.pout!=null;
  return '<div class="pn l" style="width:'+pw('editL')+'px">'+splitter('editL','l')+''+ph('素材')+tabs([['assets','アセット'],['templates','テンプレート'],['text','テロップ'],['audio','音声']],S.etab,'etab','素材の種類')+left+'</div>'+
  '<div class="pc" style="background:var(--bg0)">'+
    '<div style="height:calc(280px + var(--xh,0px)*.5);flex:none;display:flex;flex-direction:column;background:#000">'+ph('プレビュー','<span class="x">全長 '+mmss(progDur())+'</span>')+'<div class="mon" style="flex:1;min-height:0"><canvas data-prog '+canvasAttrs()+' style="height:calc(203px + var(--xh,0px)*.5);width:auto;aspect-ratio:var(--ar,16/9);max-width:100%;object-fit:contain;display:block"></canvas></div>'+
      '<div class="tp" style="height:34px;border-bottom:0;padding:0 12px"><span class="tc" data-time="edit">'+tc(S.t.edit)+'</span><span class="mid">'+ibtn('inPt','イン点を設定（I キー）','pin')+ibtn('outPt','アウト点を設定（O キー）','pout')+'<span class="vsep"></span>'+ibtn('prevCut','前の編集点へ（↑）','prev')+ibtn('back','1フレーム戻る（←）','fb')+playBtn(E.playing)+ibtn('fwd','1フレーム進む（→）','ff')+ibtn('nextCut','次の編集点へ（↓）','next')+'<span class="vsep"></span>'+ibtn('split','再生ヘッドで分割（S キー）','split')+'</span><span class="end row" style="justify-content:flex-end;gap:6px"><button class="b s" style="height:24px;padding:0 8px;border:0;background:none;color:var(--mu)" title="プレビューの画質（プロジェクト設定で変えられます）"'+A('psOpen')+'>'+pqLabel()+'</button>'+ibtn('full','全画面','todo')+'</span></div></div>'+
    '<div style="flex:1;min-height:0;display:flex"><div style="width:44px;flex:none;display:flex;flex-direction:column;align-items:center;gap:2px;padding-top:6px;background:var(--bg1);border-right:1px solid var(--ln)">'+
      tools.map(function(t){var on=S.tool===t[0];return '<button aria-label="'+t[1]+'" title="'+t[1]+(t[2]?'（'+t[2]+' キー）':'')+'" aria-pressed="'+on+'"'+A('tool',t[0])+' style="width:38px;height:44px;padding:0;border:0;border-radius:4px;background:'+(on?'var(--bg4)':'transparent')+';color:'+(on?'var(--ac)':'var(--tx2)')+';display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">'+ic(t[0],16)+'<span style="font-size:10px;color:var(--tx2)">'+t[1]+'</span></button>';}).join('')+'</div>'+
      '<div style="flex:1;min-width:0;display:flex;flex-direction:column"><div class="row tlbar">'+
        '<button class="b s'+(S.snap?' on':'')+'" aria-pressed="'+S.snap+'"'+A('snapT')+' title="スナップ（N キー）">スナップ</button>'+
        btn('＋ トラック','addTrk','','s','トラックを追加')+
        (rngOn?'<span class="t-ac" style="margin-left:6px">書き出し範囲 '+tc(P.pin||0)+' – '+tc(P.pout!=null?P.pout:progDur())+'</span>'+btn('範囲を消去','pclear','','s'):'')+
        '</div><div class="tl tl2" data-tlwrap>'+tlInner()+'</div>'+
      '<div class="tlfoot"><button aria-label="縮小" title="縮小（'+keyOf('zout')+'）"'+A('zout')+'>−</button><input type="range" min="0" max="100" value="'+zoomVal()+'" data-in="zoom" aria-label="タイムラインの拡大率"><button aria-label="拡大" title="拡大（'+keyOf('zin')+'）"'+A('zin')+'>＋</button></div></div></div></div>'+
  '<div class="pn r" style="width:'+pw('editR')+'px">'+splitter('editR','r')+''+ph('インスペクタ','<span class="x">'+h(ins.name)+'</span>')+'<div class="scroll">'+ins.html+
    (P.sample?'<div style="padding:10px 16px 12px"><div style="font-weight:500;margin-bottom:6px">コメント</div><div class="box"><span class="t-lb">山本（講師）</span><br>質問テロップを入れて意図を伝えましょう。</div></div>':'')+'</div></div>';
};
}
