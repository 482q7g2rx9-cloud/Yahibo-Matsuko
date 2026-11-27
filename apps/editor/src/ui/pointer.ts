// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { C, P, T, cEnd, cLen, fades, gainFrac, gainFromFrac, srcMax, srcMin, uid } from './project';
import { S, TOTAL } from './state';
import { HIST, changed, mark } from './store';
import { E, progStop, redrawProg, setProg, sync, trPairs } from './engine';
import { srcSeek } from './source';
import { EPS, addTitle, carve, delClips, linked, locked, openRange, selClips, selIds, splitAt } from './editOps';
import { PROPS, ROWS, drawTL, hotEdit, propVal, setProp } from './pages/edit';
import { draw } from './render';
import { toast } from './menus';
import { SCALE } from './fit';

/* ---------- タイムラインのマウス操作 ----------
   移動・トラック間の移動・トリミング・囲んで選択・再生位置・ハンド。
   ドラッグ中は、始めた時点のクリップ（base）から毎回計算し直す */
export var DRAG;
export function bodyPos(e){var b=document.querySelector('[data-body]'),r=b.getBoundingClientRect();return {x:(e.clientX-r.left)/SCALE+b.scrollLeft,y:(e.clientY-r.top)/SCALE+b.scrollTop,b:b};}
export function rowAt(y){for(var i=0;i<ROWS.length;i++)if(y<ROWS[i].y+ROWS[i].h+2)return ROWS[i];return ROWS[ROWS.length-1];}
export function snapPts(skip){var p=[0,S.t.edit];if(P.pin!=null)p.push(P.pin);if(P.pout!=null)p.push(P.pout);P.clips.forEach(function(c){if(skip[c.id])return;p.push(c.start,cEnd(c));});return p;}
export function snapBy(times,pts){if(!S.snap)return null;var thr=8/(S.pps||10),best=null;times.forEach(function(t){pts.forEach(function(p){var d=p-t;if(Math.abs(d)<=thr&&(!best||Math.abs(d)<Math.abs(best.d)))best={d:d,p:p};});});return best;}
export function showSnap(p){var l=document.querySelector('[data-snapl]');if(!l)return;if(p==null){l.hidden=true;return;}l.hidden=false;l.style.left=(p*(S.pps||10))+'px';}
export function prevEnd(c){return P.clips.reduce(function(a,x){return x!==c&&x.tr===c.tr&&cEnd(x)<=c.start+EPS?Math.max(a,cEnd(x)):a;},0);}
/* ゲインライン・フェードをドラッグしている間の表示（音量は「いまの値（変えた量）」） */
export function gainTip(e,d){var el=document.getElementById('gtip');if(!e){if(el)el.remove();return;}var c=C(d.cid);if(!c)return;
  if(!el){el=document.createElement('div');el.id='gtip';el.className='gtip';document.getElementById('app').appendChild(el);}
  var t;if(d.k==='trlen'){t='長さ '+((c.xin&&c.xin.d)||0).toFixed(2)+' 秒';}
  else if(d.k==='gain'){var v=c.vol||0,dv=v-d.v0;t=v.toFixed(1)+' dB　('+(dv>=0?'+':'')+dv.toFixed(1)+' dB)';}
  else{var f=fades(c);t=(d.side==='in'?'フェードイン ':'フェードアウト ')+f[d.side==='in'?0:1].toFixed(2)+' 秒';}
  el.textContent=t;var a=document.getElementById('app').getBoundingClientRect();el.style.left=((e.clientX-a.left)/SCALE+14)+'px';el.style.top=((e.clientY-a.top)/SCALE+14)+'px';}
export function nextStart(c){return P.clips.reduce(function(a,x){return x!==c&&x.tr===c.tr&&x.start>=cEnd(c)-EPS?Math.min(a,x.start):a;},1e9);}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
DRAG=null;
document.addEventListener('pointerdown',function(e){if(e.button!==0)return;
  if(e.target.matches&&e.target.matches('input.rg')){mark();S.rgMark=Date.now();return;}
  var hot=e.target.closest('[data-hot]');if(hot){e.preventDefault();mark();DRAG={k:'hot',el:hot,x0:e.clientX,v0:propVal(C(hot.dataset.cid)||{},hot.dataset.k),moved:false};return;}
  var sc=e.target.closest('[data-scrub="cut"]');if(sc){var r=sc.getBoundingClientRect();srcSeek((e.clientX-r.left)/r.width*TOTAL.cut);DRAG={k:'scut',el:sc};e.preventDefault();return;}
  var ru=e.target.closest('[data-rul]'),bd=e.target.closest('[data-body]');if(!ru&&!bd)return;
  var ae=document.activeElement;if(ae&&/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))ae.blur();
  var pps=S.pps||10;
  if(ru){var rr=ru.getBoundingClientRect(),b0=document.querySelector('[data-body]');if(E.playing)progStop();setProg(((e.clientX-rr.left)/SCALE+(b0?b0.scrollLeft:0))/pps);DRAG={k:'seek'};e.preventDefault();return;}
  if(e.target.closest('.tb2'))return;
  var p=bodyPos(e),t=p.x/pps,row=rowAt(p.y);e.preventDefault();
  if(S.tool==='hand'){DRAG={k:'pan',x0:e.clientX,y0:e.clientY,sl:p.b.scrollLeft,st:p.b.scrollTop};return;}
  if(S.tool==='text'){addTitle('center',t,row&&row.kind==='v'?row.id:null);return;}
  /* トランジションの帯：端をドラッグで長さ、それ以外を押すとつなぎ目の後ろのクリップを選ぶ */
  var tx=S.tool==='select'&&e.target.closest('[data-trx]'),tb=tx&&C(tx.dataset.trx);
  if(tb&&tb.xin){var te=e.target.closest('[data-tre]');S.sel=[tb.id];
    if(te){mark();DRAG={k:'trlen',cid:tb.id,x0:p.x,v0:trPairs().filter(function(q){return q.b===tb;}).map(function(q){return q.d;})[0]||tb.xin.d||1,moved:false};gainTip(e,DRAG);}
    draw();return;}
  /* ゲインライン（音量）・フェードのハンドル */
  var gl=S.tool==='select'&&e.target.closest('[data-gain],[data-fade]'),gc=gl&&C(gl.dataset.cid);
  if(gc&&!locked(gc)){mark();if(S.sel.indexOf(gc.id)<0)S.sel=[gc.id];var fd=gl.dataset.fade;
    DRAG={k:fd?'fade':'gain',side:fd,cid:gc.id,x0:p.x,y0:p.y,v0:fd?fades(gc)[fd==='in'?0:1]:(gc.vol||0),moved:false};draw();gainTip(e,DRAG);return;}
  var ce=e.target.closest('[data-c]'),c=ce&&C(ce.dataset.c);
  if(c&&locked(c))c=null;
  if(!c){DRAG={k:'marq',x0:p.x,y0:p.y,add:e.shiftKey||e.ctrlKey||e.metaKey,base:S.sel.slice(),moved:false};return;}
  var ids=selIds(c.id,e.altKey);
  if(S.tool==='split'){var tt=t;if(S.snap){var sb=snapBy([tt],[S.t.edit]);if(sb)tt+=sb.d;}splitAt(tt,ids);return;}
  if(S.tool==='trash'){delClips(ids,false);return;}
  var tr=e.target.closest('.trim'),tog=!tr&&(e.shiftKey||e.ctrlKey||e.metaKey),was=S.sel.indexOf(c.id)>=0;
  if(tog){if(was)S.sel=S.sel.filter(function(id){return ids.indexOf(id)<0;});else S.sel=S.sel.concat(ids.filter(function(id){return S.sel.indexOf(id)<0;}));draw();return;}
  if(!was)S.sel=ids;
  mark();
  if(tr){var grp=[c].concat(e.altKey?[]:linked(c)).filter(function(x){return !locked(x);});DRAG={k:'trim',side:tr.classList.contains('l')?'l':'r',ripple:e.ctrlKey||e.metaKey,ids:grp.map(function(x){return x.id;}),x0:p.x,base:JSON.stringify(P.clips),moved:false};}
  else DRAG={k:'move',cid:c.id,ids:selClips().map(function(x){return x.id;}),x0:p.x,y0:p.y,row0:c.tr,base:JSON.stringify(P.clips),moved:false,clickIds:ids};
  draw();});
document.addEventListener('pointermove',function(e){if(!DRAG)return;var d=DRAG;
  if(d.k==='hot'){var dx=e.clientX-d.x0;if(!d.moved&&Math.abs(dx)<3)return;d.moved=true;var pp=PROPS[d.el.dataset.k];setProp(d.el.dataset.cid,d.el.dataset.k,d.v0+Math.round(dx/2)*pp.step*(e.shiftKey?10:1));return;}
  if(d.k==='scut'){var r=d.el.getBoundingClientRect();srcSeek((e.clientX-r.left)/r.width*TOTAL.cut);return;}
  if(d.k==='seek'){var ru=document.querySelector('[data-rul]'),b=document.querySelector('[data-body]');if(ru)setProg(((e.clientX-ru.getBoundingClientRect().left)/SCALE+(b?b.scrollLeft:0))/(S.pps||10));return;}
  if(d.k==='pan'){var b2=document.querySelector('[data-body]');if(b2){b2.scrollLeft=d.sl-(e.clientX-d.x0);b2.scrollTop=d.st-(e.clientY-d.y0);}return;}
  if(d.k==='trlen'){var tp=bodyPos(e),tb=C(d.cid);if(!tb||!tb.xin)return;if(!d.moved&&Math.abs(tp.x-d.x0)<2)return;d.moved=true;
    var a=P.clips.filter(function(c){return c!==tb&&c.tr===tb.tr&&c.type==='media'&&Math.abs(cEnd(c)-tb.start)<1e-3;})[0],mx=a?Math.min(cLen(a),cLen(tb)):cLen(tb);
    /* つなぎ目を中心に左右へ同じだけ伸び縮みする */
    tb.xin.d=Math.round(Math.max(0.1,Math.min(mx,2*Math.abs(tp.x/(S.pps||10)-tb.start)))*100)/100;
    drawTL();gainTip(e,d);if(E.playing)sync(S.t.edit,true);else{sync(S.t.edit,false);redrawProg();}return;}
  if(d.k==='gain'||d.k==='fade'){var gp=bodyPos(e),gc=C(d.cid);if(!gc)return;if(!d.moved&&Math.abs(gp.x-d.x0)+Math.abs(gp.y-d.y0)<2)return;d.moved=true;
    if(d.k==='gain'){var rw=ROWS.filter(function(z){return z.id===gc.tr;})[0],hh=Math.max(10,(rw?rw.h:40)-2),fine=e.shiftKey?.1:1;
      gc.vol=Math.round(gainFromFrac(gainFrac(d.v0)+(gp.y-d.y0)*fine/hh)*10)/10;if(Math.abs(gc.vol)<.05)gc.vol=0;}
    else{var dt=(gp.x-d.x0)/(S.pps||10),ff=fades(gc),L=cLen(gc);
      if(d.side==='in')gc.fin=Math.round(Math.max(0,Math.min(L-ff[1],d.v0+dt))*100)/100;else gc.fout=Math.round(Math.max(0,Math.min(L-ff[0],d.v0-dt))*100)/100;}
    drawTL();gainTip(e,d);if(E.playing)sync(S.t.edit,true);return;}
  var p=bodyPos(e),pps=S.pps||10;
  if(d.k==='marq'){if(!d.moved&&Math.abs(p.x-d.x0)+Math.abs(p.y-d.y0)<4)return;d.moved=true;var x1=Math.min(d.x0,p.x),x2=Math.max(d.x0,p.x),y1=Math.min(d.y0,p.y),y2=Math.max(d.y0,p.y),q=document.querySelector('[data-marq]');
    if(q){q.hidden=false;q.style.cssText='left:'+x1+'px;top:'+y1+'px;width:'+(x2-x1)+'px;height:'+(y2-y1)+'px';}
    var hit=P.clips.filter(function(c){var r=ROWS.filter(function(z){return z.id===c.tr;})[0];return r&&!locked(c)&&c.start*pps<x2&&cEnd(c)*pps>x1&&r.y<y2&&r.y+r.h>y1;}).map(function(c){return c.id;});
    S.sel=d.add?d.base.concat(hit.filter(function(id){return d.base.indexOf(id)<0;})):hit;[].forEach.call(document.querySelectorAll('[data-c]'),function(el){el.classList.toggle('on',S.sel.indexOf(el.dataset.c)>=0);});return;}
  if(!d.moved&&Math.abs(p.x-d.x0)<4&&(d.k!=='move'||Math.abs(p.y-d.y0)<4))return;d.moved=true;
  P.clips=JSON.parse(d.base);var dt=(p.x-d.x0)/pps,skip={};d.ids.forEach(function(id){skip[id]=1;});var L=d.ids.map(C).filter(Boolean),sp=null;
  if(d.k==='move'){var pk=T(d.row0).kind,kr=P.tracks.filter(function(t){return t.kind===pk;}),r=rowAt(p.y),i0=kr.indexOf(T(d.row0)),i1=r.kind===pk?kr.indexOf(T(r.id)):(pk==='v'?kr.length-1:0),dj=i1-i0;
    L.forEach(function(c){if(T(c.tr).kind!==pk)return;var k=kr.indexOf(T(c.tr));if(k+dj<0)dj=-k;if(k+dj>kr.length-1)dj=kr.length-1-k;});
    if(L.some(function(c){return T(c.tr).kind===pk&&kr[kr.indexOf(T(c.tr))+dj].lock;}))dj=0;
    var mn=Math.min.apply(null,L.map(function(c){return c.start;}));if(mn+dt<0)dt=-mn;
    var sb=snapBy([].concat.apply([],L.map(function(c){return [c.start+dt,cEnd(c)+dt];})),snapPts(skip));if(sb&&mn+dt+sb.d>=0){dt+=sb.d;sp=sb.p;}
    L.forEach(function(c){c.start+=dt;if(T(c.tr).kind===pk)c.tr=kr[kr.indexOf(T(c.tr))+dj].id;});d.dt=dt;d.dj=dj;}
  else{var c0=L[0],lo=-1e9,hi=1e9;
    L.forEach(function(c){if(d.side==='l'){if(d.ripple){lo=Math.max(lo,srcMin(c)-c.in);hi=Math.min(hi,cLen(c)-0.1);}else{lo=Math.max(lo,-c.start,srcMin(c)-c.in,prevEnd(c)-c.start);hi=Math.min(hi,cLen(c)-0.1);}}
      else{lo=Math.max(lo,0.1-cLen(c));hi=Math.min(hi,srcMax(c)-c.out,d.ripple?1e9:nextStart(c)-cEnd(c));}});
    if(!(d.side==='l'&&d.ripple)){var edge=d.side==='l'?c0.start:cEnd(c0),sb2=snapBy([edge+dt],snapPts(skip));if(sb2&&dt+sb2.d>=lo&&dt+sb2.d<=hi){dt+=sb2.d;sp=sb2.p;}}
    dt=Math.max(lo,Math.min(hi,dt));
    L.forEach(function(c){var oe=cEnd(c);if(d.side==='l'){c.in+=dt;if(d.ripple)P.clips.forEach(function(x){if(x.tr===c.tr&&!skip[x.id]&&x.start>=oe-EPS)x.start-=dt;});else c.start+=dt;}
      else{c.out+=dt;if(d.ripple)P.clips.forEach(function(x){if(x.tr===c.tr&&!skip[x.id]&&x.start>=oe-EPS)x.start+=dt;});}});}
  drawTL();showSnap(sp);[].forEach.call(document.querySelectorAll('[data-c]'),function(el){if(skip[el.dataset.c])el.classList.add('mv');});});
document.addEventListener('pointerup',function(e){var d=DRAG;DRAG=null;if(!d)return;showSnap(null);
  if(d.k==='hot'){if(!d.moved){HIST.pop();hotEdit(d.el);}else drawTL();return;}
  if(d.k==='trlen'){gainTip(null);if(!d.moved){HIST.pop();return;}changed();return;}
  if(d.k==='gain'||d.k==='fade'){gainTip(null);if(!d.moved){HIST.pop();return;}var gc=C(d.cid);if(gc){if(!gc.vol)delete gc.vol;if(!gc.fin)delete gc.fin;if(!gc.fout)delete gc.fout;}changed();sync(S.t.edit,E.playing);return;}
  if(d.k==='marq'){var q=document.querySelector('[data-marq]');if(q)q.hidden=true;if(!d.moved)S.sel=d.add?S.sel:[];draw();return;}
  if(d.k!=='move'&&d.k!=='trim')return;
  if(!d.moved){HIST.pop();if(d.k==='move'&&!(e.shiftKey||e.ctrlKey||e.metaKey))S.sel=d.clickIds;draw();return;}
  if(d.k==='move'){var skip={},L=d.ids.map(C).filter(Boolean);L.forEach(function(c){skip[c.id]=1;});
    if(e.altKey){var moved=JSON.parse(JSON.stringify(L)),base=JSON.parse(d.base),re={};P.clips=base;moved.forEach(function(o){o.id=uid('c');if(o.link){re[o.link]=re[o.link]||uid('L');o.link=re[o.link];}carve(o.tr,o.start,cEnd(o));P.clips.push(o);});S.sel=moved.map(function(c){return c.id;});changed();return toast('複製しました');}
    if(e.ctrlKey||e.metaKey){var mn=Math.min.apply(null,L.map(function(c){return c.start;})),mx=Math.max.apply(null,L.map(cEnd));L.forEach(function(c){P.clips.splice(P.clips.indexOf(c),1);});openRange(mn,mx-mn);L.forEach(function(c){P.clips.push(c);});changed();return toast('挿入しました（後ろをずらしました）');}
    L.forEach(function(c){carve(c.tr,c.start,cEnd(c),skip);});changed();return;}
  changed();});
}
