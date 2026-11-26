// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { S } from './state';
import { E } from './engine';
import { SIM, SRC } from './source';

/* ---------- 小道具 ---------- */
export function h(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
export function A(act,v){return ' data-a="'+act+'"'+(v!==undefined?' data-v="'+h(v)+'"':'');}
export function hms(s){s=Math.round(s);return Math.floor(s/3600)+':'+('0'+Math.floor(s/60)%60).slice(-2)+':'+('0'+s%60).slice(-2);}
export function mmss(s){s=Math.round(s||0);return Math.floor(s/60)+':'+(s%60<10?'0':'')+s%60;}
export function tc(t){t=Math.max(0,t||0);function p(n){return (n<10?'0':'')+n;}return p(Math.floor(t/3600))+':'+p(Math.floor(t/60)%60)+':'+p(Math.floor(t)%60)+':'+p(Math.floor((t%1)*30+1e-6));}
export function hm(d){d=d||new Date();return (d.getHours()<10?'0':'')+d.getHours()+':'+(d.getMinutes()<10?'0':'')+d.getMinutes();}
export function mb(n){return n>=1e9?(n/1e9).toFixed(1)+' GB':n>=1e6?Math.round(n/1e6)+' MB':Math.max(1,Math.round(n/1e3))+' KB';}
export function rng(seed){var x=seed||1;return function(){x=(x*16807)%2147483647;return (x-1)/2147483646;};}
export function hashN(s){var x=7;for(var i=0;i<s.length;i++)x=(x*31+s.charCodeAt(i))%100000;return x+1;}

/* アイコン */
export var I;
export function ic(n,sz){sz=sz||16;return '<svg width="'+sz+'" height="'+sz+'" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'+I[n]+'</svg>';}
export var TRI;
export function diamond(on){return on?'<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><polygon points="6,1 11,6 6,11 1,6" fill="var(--ac)" stroke="var(--lb)" stroke-width="1.4"/></svg>'
  :'<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><polygon points="6,1 11,6 6,11 1,6" fill="none" stroke="#8a8a8a" stroke-width="1.2"/></svg>';}

/* 波形（SVG）：見本は乱数、読み込んだ素材は実際の音量 */
export function wave(n,seed,fill){var r=rng(seed),a=[];for(var i=0;i<n;i++){var v=r();a.push(.1+(v>.85?.7:v*.55)+r()*.15);}return waveSvg(a,fill);}
export function waveSvg(a,fill){var b='';for(var i=0;i<a.length;i++){var hh=Math.max(2,Math.min(96,a[i]*100));b+='<rect x="'+(i+.3).toFixed(1)+'" y="'+(50-hh/2).toFixed(1)+'" width=".4" height="'+hh.toFixed(1)+'"/>';}
  return '<svg class="wv" viewBox="0 0 '+Math.max(1,a.length)+' 100" preserveAspectRatio="none" aria-hidden="true" fill="'+(fill||'#a9d6f5')+'">'+b+'</svg>';}
export function waveOf(m,a,b,n,fill){if(m&&m.peaks&&m.d){var pk=m.peaks,N=pk.length,i0=Math.floor(a/m.d*N),i1=Math.max(i0+1,Math.ceil(b/m.d*N)),seg=pk.slice(i0,i1),out=[],step=Math.max(1,seg.length/n);
    for(var x=0;x<seg.length;x+=step){var mx=0;for(var y=Math.floor(x);y<Math.min(seg.length,Math.floor(x+step));y++)mx=Math.max(mx,seg[y]);out.push(mx);}return waveSvg(out,fill);}
  if(m&&m.file&&!m.peaks)return '';return wave(n,(m?hashN(m.id):3)+Math.round(a),fill);}
export function film(m){var c=(m&&m.col)||['#555','#444'];return 'background:repeating-linear-gradient(90deg,'+c[0]+' 0 46px,'+c[1]+' 46px 92px)';}
export function filmStyle(m){if(m&&m.thumb)return 'background:url('+m.thumb+') left center / auto 100% repeat-x,'+((m.col||['#555'])[0]);return film(m);}

/* 共通部品 */
export function ph(t,x){return '<div class="ph"><span class="t">'+t+'</span>'+(x||'')+'</div>';}
export function btn(label,act,v,cls,aria,style){return '<button class="b'+(cls?' '+cls:'')+'"'+(act?A(act,v):'')+(aria?' aria-label="'+h(aria)+'"':'')+(style?' style="'+style+'"':'')+'>'+label+'</button>';}
export function ibtn(icon,label,act,cls){return '<button class="ib'+(cls?' '+cls:'')+'" aria-label="'+label+'" title="'+label+'"'+(act?A(act):'')+'>'+ic(icon)+'</button>';}
export function chip(t,c){return '<span class="chip '+c+'">'+h(t)+'</span>';}
export function stl(t,c){return '<span class="stl '+c.replace('c-','s-')+'">'+h(t)+'</span>';}
export function tabs(items,cur,act,label){return '<div class="tabs" role="tablist" aria-label="'+label+'">'+items.map(function(t){return '<button role="tab" aria-selected="'+(t[0]===cur)+'"'+A(act,t[0])+'>'+h(t[1])+'</button>';}).join('')+'</div>';}
export function kv(k,v,cls){return '<div class="kv"><span>'+k+'</span><span'+(cls?' class="'+cls+'"':'')+'>'+v+'</span></div>';}
export function sel(label,opts,cur,style,key){if(opts.indexOf(cur)<0)opts=[cur].concat(opts);return '<select class="inp" aria-label="'+h(label)+'"'+(key?' data-in="'+key+'"':'')+(style?' style="'+style+'"':'')+'>'+opts.map(function(o){return '<option'+(o===cur?' selected':'')+'>'+h(o)+'</option>';}).join('')+'</select>';}
export function prop(p){return '<div class="pr"><button class="kf" aria-label="'+h(p[0])+'のキーフレーム" aria-pressed="'+!!p[3]+'">'+diamond(p[3])+'</button><span class="t2">'+h(p[0])+'</span>'+
  '<div class="slr" style="--p:'+p[1]+'%"><i style="left:'+p[1]+'%"></i></div><span class="stp"><button aria-label="減らす '+h(p[0])+'">'+TRI.l+'</button><button aria-label="増やす '+h(p[0])+'">'+TRI.r+'</button></span><span class="v">'+h(p[2])+'</span></div>';}
export function fsec(key,title,on,body,fx){var o=!!S.open[key]&&!!body;return '<div class="fs"><div class="h"><button class="tg" aria-expanded="'+o+'"'+A('sec',key)+'>'+(o?TRI.d:TRI.rr)+(fx?'<span class="fxb">fx</span>':'')+h(title)+'</button>'+
  (on!==null?'<input type="checkbox"'+(on?' checked':'')+' aria-label="'+h(title)+'を有効">':'')+'</div>'+(o?'<div class="bd">'+body+'</div>':'')+'</div>';}
export function transport(key,btns,end){return '<div class="tp"><span class="tc" data-time="'+key+'">'+tc(S.t[key])+'</span><span class="mid">'+btns+'</span><span class="end">'+(end||'')+'</span></div>';}
export function playBtn(on){return '<button class="ib play'+(on?' on':'')+'" aria-label="'+(on?'一時停止':'再生')+'" title="再生／一時停止（スペース）"'+A('play')+'>'+ic(on?'pause':'play')+'</button>';}
export function playing(){return S.page==='cut'?SRC.playing:S.page==='fx'?!!SIM:E.playing;}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
I={
  play:'<path d="M8 5v14l11-7z"/>',pause:'<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',stop:'<rect x="6" y="6" width="12" height="12"/>',rec:'<circle cx="12" cy="12" r="7"/>',
  prevCut:'<path d="M5 5h2v14H5zM19 5v14L9 12z"/>',nextCut:'<path d="M17 5h2v14h-2zM5 5v14l10-7z"/>',
  back:'<path d="M15 6v12l-8-6z"/>',fwd:'<path d="M9 6v12l8-6z"/>',toStart:'<path d="M6 5h2v14H6zM20 5v14L9 12z"/>',
  inPt:'<path d="M8 4h7v2h-5v12h5v2H8z"/>',outPt:'<path d="M16 4H9v2h5v12H9v2h7z"/>',
  loop:'<path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"/>',
  full:'<path d="M5 5h5v2H7v3H5zm9 0h5v5h-2V7h-3zM5 14h2v3h3v2H5zm12 0h2v5h-5v-2h3z"/>',
  select:'<path d="M6 3l12 9-5 1 3 6-2.5 1-3-6-4 3z"/>',split:'<path d="M11 3h2v18h-2zM4 7l5 5-5 5zM20 7l-5 5 5 5z"/>',
  trash:'<path d="M8 4h8l1 2h4v2H3V6h4zM5 9h14l-1 12H6z"/>',
  hand:'<path d="M9 11V5.5a1.5 1.5 0 013 0V10h1V4.5a1.5 1.5 0 013 0V10h1V6.5a1.5 1.5 0 013 0V15c0 4-3 7-7 7-3 0-5-1.5-6-4l-2-4a1.5 1.5 0 012.5-1.5L9 14z"/>',
  text:'<path d="M5 5h14v3h-5.5v11h-3V8H5z"/>',plus:'<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>'};
TRI={l:'<svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor" aria-hidden="true"><polygon points="7,0 7,10 1,5"/></svg>',
         r:'<svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor" aria-hidden="true"><polygon points="1,0 1,10 7,5"/></svg>',
         d:'<svg width="10" height="10" viewBox="0 0 8 10" fill="currentColor" aria-hidden="true"><polygon points="0,1 8,1 4,9"/></svg>',
         rr:'<svg width="10" height="10" viewBox="0 0 8 10" fill="currentColor" aria-hidden="true"><polygon points="1,0 7,5 1,10"/></svg>'};
}
