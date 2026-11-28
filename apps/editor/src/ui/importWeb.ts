// @ts-nocheck
import { WaveformBuilder } from '../core/waveform';
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { P, uid } from './project';
import { S } from './state';
import { hm } from './util';
import { IDB, saveP } from './store';
import { HOST, importPaths } from './desktop';
import { draw, go } from './render';
import { toast } from './menus';

/* ================================================================
   素材の読み込み
   ================================================================ */
export var IMP;
export function kindOf(f){var t=f.type||'',n=f.name.toLowerCase();if(/^video\//.test(t)||/\.(mp4|mov|m4v|webm|mkv)$/.test(n))return '映像';if(/^audio\//.test(t)||/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(n))return '音声';if(/^image\//.test(t)||/\.(png|jpe?g|gif|webp)$/.test(n))return '画像';return null;}
export function nextCode(k){var pre={'映像':'V-','音声':'ア-','画像':'G-'}[k],n=P.media.filter(function(m){return m.k===k;}).length+1;return k==='音声'?['ア','イ','ウ','エ','オ'][(n-1)%5]+'-'+String.fromCharCode(66+Math.floor((n-1)/5)):pre+(n<10?'0':'')+n;}
export function importFiles(list){var files=[].slice.call(list||[]),bad=0,added=[];
  files.forEach(function(f){var k=kindOf(f);if(!k){bad++;return;}
    var m={id:uid('m'),n:f.name.replace(/\.[^.]+$/,''),k:k,d:k==='画像'?0:0,c:nextCode(k),r:'wn',sr:'—',f:f.name,size:f.size,res:'',px:-1,ho:'—',src:'読み込んだファイル',pm:'未入力',ex:'—',line:'—',rate:'未確認',file:1,url:URL.createObjectURL(f),col:['#3a4a5a','#2a3644'],loading:1,added:hm()};
    P.media.push(m);added.push(m);IMP.total++;IDB.put('files',m.id,f);probe(m,f);});
  if(bad)toast(bad+'件は対応していない形式のため読み込みませんでした');
  if(added.length){S.media=added[0].id;S.bin='all';toast(added.length+'件を読み込んでいます');saveP();draw();}}
export function probeDone(m,ok){m.loading=0;IMP.done++;if(IMP.done>=IMP.total){IMP.total=IMP.done=0;}if(!ok){P.media=P.media.filter(function(x){return x!==m;});IDB.del('files',m.id);toast('「'+m.f+'」はこのブラウザで再生できない形式のため、読み込めませんでした');}saveP();draw();}
export function grabColor(src,w,hh){try{var c=document.createElement('canvas');c.width=8;c.height=8;var x=c.getContext('2d');x.drawImage(src,0,0,8,8);var d=x.getImageData(0,0,8,8).data,r=0,g=0,b=0;for(var i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];}r=Math.round(r/64);g=Math.round(g/64);b=Math.round(b/64);
  function hx(v){return ('0'+Math.max(0,Math.min(255,v)).toString(16)).slice(-2);}return ['#'+hx(r)+hx(g)+hx(b),'#'+hx(r*.72|0)+hx(g*.72|0)+hx(b*.72|0)];}catch(e){return null;}}
export function thumbOf(src,w,hh){try{var c=document.createElement('canvas'),tw=160,th=90;c.width=tw;c.height=th;var x=c.getContext('2d');x.fillStyle='#000';x.fillRect(0,0,tw,th);var s=Math.min(tw/w,th/hh);x.drawImage(src,(tw-w*s)/2,(th-hh*s)/2,w*s,hh*s);return c.toDataURL('image/jpeg',.72);}catch(e){return null;}}
export function probe(m,f){
  if(m.k==='画像'){var im=new Image();im.onload=function(){m.res=im.naturalWidth+'×'+im.naturalHeight;m.thumb=thumbOf(im,im.naturalWidth,im.naturalHeight);m.col=grabColor(im)||m.col;probeDone(m,true);};im.onerror=function(){probeDone(m,false);};im.src=m.url;return;}
  var el=document.createElement(m.k==='映像'?'video':'audio');el.preload='auto';el.muted=true;el.src=m.url;IMP.cur=m.f;
  var to=setTimeout(function(){probeDone(m,false);},20000);
  el.onerror=function(){clearTimeout(to);probeDone(m,false);};
  el.onloadedmetadata=function(){m.d=isFinite(el.duration)?el.duration:0;
    if(m.k==='音声'||m.k==='テイク'){clearTimeout(to);m.res=m.k==='テイク'?'録音':'音声';peaksOf(m,f);probeDone(m,m.d>0);return;}
    m.res=el.videoWidth+'×'+el.videoHeight;if(!el.videoWidth){clearTimeout(to);probeDone(m,false);return;}
    el.currentTime=Math.min(1,m.d/3);};
  el.onseeked=function(){if(m.k!=='映像'||!m.loading)return;clearTimeout(to);m.thumb=thumbOf(el,el.videoWidth,el.videoHeight);m.col=grabColor(el)||m.col;m.inP=0;m.outP=m.d;peaksOf(m,f);probeDone(m,true);el.removeAttribute('src');el.load();};}
/* 音声の波形（音量のピーク）を求める。大きすぎるファイルは省略 */
export function peaksOf(m,f){if(f.size>400e6)return;var AC=window.OfflineAudioContext||window.webkitOfflineAudioContext;if(!AC)return;
  f.arrayBuffer().then(function(buf){var ac=new AC(1,22050,22050);return ac.decodeAudioData(buf);}).then(function(ab){
    var nc=Math.min(2,ab.numberOfChannels),chs=[];for(var c=0;c<nc;c++)chs.push(ab.getChannelData(c));
    /* 詳しい波形（左右別・ピークと実効値。core/waveform.ts） */
    var wb=new WaveformBuilder(ab.duration,ab.sampleRate,nc);wb.push(chs);m.wf=wb.finish();
    /* 無音の検出に使うピーク（10 個/秒、いちばん大きい音を 1 にそろえる） */
    var ch=chs[0],N=Math.min(12000,Math.max(50,Math.round(ab.duration*10))),step=Math.floor(ch.length/N),pk=[],mx=0;
    for(var i=0;i<N;i++){var v=0;for(var j=i*step;j<(i+1)*step;j+=4){for(var c=0;c<nc;c++){var a=Math.abs(chs[c][j]);if(a>v)v=a;}}pk.push(v);if(v>mx)mx=v;}
    m.peaks=pk.map(function(v){return Math.round(v/(mx||1)*1000)/1000;});saveP();draw();}).catch(function(){if(m.k==='映像'){m.noAudio=1;saveP();draw();}});}
export function openPicker(){if(HOST){HOST.media.pick(true).then(function(p){importPaths(p);if(p&&p.length&&S.page!=='media'&&S.page!=='edit'&&S.page!=='cut')go('media');}).catch(function(e){toast(String(e));});return;}var i=document.getElementById('fileIn');i.value='';i.click();}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
IMP={total:0,done:0,cur:''};
}
