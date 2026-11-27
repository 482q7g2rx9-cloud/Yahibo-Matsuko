// @ts-nocheck
import { drawLookText, loadFont, titleFont } from './titleStyles';
import { TRANSITION_DEFAULT_D, mixTransition, transitionById } from './transitions';
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { C, M, P, T, cEnd, cLen, fadeAt, progDur, vTracks } from './project';
import { S } from './state';
import { tc } from './util';
import { HOST } from './desktop';
import { syncPlayBtn } from './source';
import { X } from './exporter';
import { toast } from './menus';
import { PREF } from './prefs';

/* ================================================================
   再生エンジン：映像トラックを下から重ねて canvas に描き、音声トラックの音を Web Audio に通す。
   要素（video / audio）はクリップごとに作り、再生位置の近くのものだけを残す。
   ================================================================ */
export var E;
export function audioInit(){if(E.ctx)return;try{var AC=window.AudioContext||window.webkitAudioContext;E.ctx=new AC();E.master=E.ctx.createGain();E.mon=E.ctx.createGain();E.master.connect(E.mon);E.mon.connect(E.ctx.destination);
  Object.keys(E.els).forEach(function(id){route(E.els[id]);});}catch(e){E.ctx=null;}}
export function route(e){if(!E.ctx||e._routed||!e._audio)return;try{var s=E.ctx.createMediaElementSource(e),g=E.ctx.createGain();s.connect(g);g.connect(E.master);e._g=g;e._routed=1;}catch(x){}}
export function imgFor(m){var e=E.imgs[m.id];if(!e||e._src!==m.url){e=new Image();if(HOST)e.crossOrigin='anonymous';e.onload=redrawProg;e._src=m.url;e.src=m.url;E.imgs[m.id]=e;}return e;}
export function elFor(c,m,audio){var e=E.els[c.id];if(e&&e._src===m.url&&!!e._audio===audio)return e;if(e)dropEl(c.id);
  e=document.createElement(audio?'audio':'video');if(HOST)e.crossOrigin='anonymous';e.preload='auto';e.playsInline=true;e.src=m.url;e._src=m.url;e._audio=audio;
  if(!audio){e.muted=true;var ok=function(){if(!E.playing)E.idle.fresh=(E.idle.fresh||0)+1;if(!E.playing&&e.readyState>=2&&e.videoWidth&&E.els[c.id]===e)keepFrame(c.id,e,e.videoWidth,e.videoHeight);seekNext(e);idleRedraw();};e.addEventListener('seeked',ok);e.addEventListener('loadeddata',ok);}else route(e);
  e.addEventListener('error',function(){playErr(m,e);});
  E.els[c.id]=e;return e;}
/* 再生できなかった素材は、1回だけ知らせる（デスクトップ版の Linux で GStreamer のプラグインが足りないときなど） */
export var PLAYERR;
export function playErr(m,e){if(!m||!e.error||PLAYERR[m.id+'|'+m.url])return;PLAYERR[m.id+'|'+m.url]=1;var c=e.error.code;
  toast('「'+m.n+'」を再生できませんでした'+(c===4?'（この形式を再生する機能がありません'+(HOST&&/Linux/.test(navigator.userAgent)?'。gstreamer1.0-libav を入れてください':'')+'）':c===2?'（ファイルを読めませんでした）':'（'+(e.error.message||'コード '+c)+'）'));}
/* 止まっているときの位置合わせ（トラックバーを動かしているとき）。
   位置を変えるたびに読み込みをやり直すと、いつまでも絵が出ないので、前の位置合わせが終わるまで待ち、
   終わったら（seeked）、その間に来た最後の位置へ合わせる */
export function seekTo(e,lt){e._want=lt;if(e.seeking||e.readyState<1)return;if(Math.abs(e.currentTime-lt)>0.02){try{e.currentTime=lt;}catch(x){}}}
export function seekNext(e){if(E.playing||e._want==null||e.seeking)return;if(Math.abs(e.currentTime-e._want)>0.02){try{e.currentTime=e._want;}catch(x){}}}
export function dropEl(id){delete E.last[id];var e=E.els[id];if(!e)return;try{e.pause();e.removeAttribute('src');e.load&&e.load();}catch(x){}delete E.els[id];}
export function dbLin(db){return Math.pow(10,(db||0)/20);}
export function audible(tr){if(tr.mute)return false;var so=P.tracks.some(function(t){return t.kind==='a'&&t.solo;});return !so||!!tr.solo;}
/* 時刻 t に映る・鳴るクリップの素材を、その位置に合わせる。少し先のクリップは準備しておく */
/* トランジション：つなぎ目の後ろのクリップ b の xin（種類と長さ）と、その直前に同じトラックで終わるクリップ a の組。
   つなぎ目を中心に d 秒（2 つのクリップの短いほうの長さまで）。E.prevTr はテロップタブのトランジションにマウスを乗せたときの試し表示 */
export function trPairs(){var out=[],pv=E.prevTr;
  P.clips.forEach(function(b){if(b.type!=='media')return;var x=pv&&pv.bid===b.id?pv:b.xin;if(!x||!transitionById(x.k))return;var tr=T(b.tr);if(!tr||tr.kind!=='v')return;
    var a=P.clips.filter(function(c){return c!==b&&c.tr===b.tr&&c.type==='media'&&Math.abs(cEnd(c)-b.start)<1e-3;})[0];if(!a)return;
    var d=Math.max(0.05,Math.min(x.d||TRANSITION_DEFAULT_D,cLen(a),cLen(b)));out.push({a:a,b:b,k:x.k,d:d,w0:b.start-d/2,w1:b.start+d/2,tr:b.tr});});
  return out;}
export function pairAt(t,trid){var L=trPairs();for(var i=0;i<L.length;i++){var q=L[i];if((!trid||q.tr===trid)&&t>=q.w0-1e-9&&t<q.w1)return q;}return null;}
/* 素材の中の位置（素材の長さの中に収める） */
function srcClamp(m,lt){return Math.max(0,Math.min((m.d||1e9)-0.04,lt));}
export function sync(t,play){var want={},near=[];
  P.clips.forEach(function(c){if(c.type!=='media')return;var m=M(c.m),tr=T(c.tr);if(!m||!m.url||m.loading||m.k==='画像'||!tr)return;
    var s=c.start,e=cEnd(c),a=tr.kind==='a';if(a?!audible(tr):(m.k!=='映像'||tr.hide))return;
    if(t>=s-1e-6&&t<e)want[c.id]={c:c,m:m,a:a,lt:c.in+(t-s)};else if(s>t&&s-t<1.5)want[c.id]={c:c,m:m,a:a,lt:c.in,pre:1};
    /* 止まっているとき（トラックバーを動かしているとき）は、前後の映像のクリップも用意しておく（入ったときにすぐ絵が出るように） */
    else if(!play&&!a&&(s>t&&s-t<20||e<=t&&t-e<20))near.push({c:c,m:m,a:a,lt:s>t?c.in:Math.max(c.in,c.in+(e-s)-0.05),pre:1,d:s>t?s-t:t-e});});
  near.sort(function(x,y){return x.d-y.d;}).slice(0,4).forEach(function(w){want[w.c.id]=w;});
  /* トランジションの間は、前のクリップは終わりより後ろまで、後ろのクリップは頭より前から映す */
  trPairs().forEach(function(q){if(t<q.w0-1e-9||t>=q.w1)return;var tr=T(q.tr);if(!tr||tr.hide)return;
    [q.a,q.b].forEach(function(c){var m=M(c.m);if(!m||!m.url||m.loading||m.k!=='映像')return;var raw=c.in+(t-c.start),lt=srcClamp(m,raw);
      /* 素材の外（頭より前・終わりより後ろ）は、端の絵で止めておく */
      want[c.id]={c:c,m:m,a:false,lt:lt,pre:Math.abs(lt-raw)>1e-3?1:0};});});
  Object.keys(want).forEach(function(id){var w=want[id],e=elFor(w.c,w.m,w.a);
    /* 音量（dB）とフェード。再生中は少しなめらかに変える */
    if(w.a){var lin=dbLin(w.c.vol)*(w.pre?0:fadeAt(w.c,t-w.c.start));if(e._g){var gg=e._g.gain;if(play&&E.ctx){try{gg.setTargetAtTime(lin,E.ctx.currentTime,0.015);}catch(x){gg.value=lin;}}else{if(gg.cancelScheduledValues&&E.ctx)gg.cancelScheduledValues(E.ctx.currentTime);gg.value=lin;}e.volume=1;}else e.volume=Math.min(1,lin);}
    if(w.pre){if(!e.paused)e.pause();if(Math.abs(e.currentTime-w.lt)>0.05&&!e.seeking){try{e.currentTime=w.lt;}catch(x){}}return;}
    if(!play)seekTo(e,w.lt);else{e._want=null;if(Math.abs(e.currentTime-w.lt)>0.3){try{e.currentTime=w.lt;}catch(x){}}}
    if(play&&e.paused){var pr=e.play();if(pr&&pr.catch)pr.catch(function(){});}if(!play&&!e.paused)e.pause();});
  Object.keys(E.els).forEach(function(id){if(id in want)return;var e=E.els[id],c=C(id);if(!e.paused)e.pause();if(!c||Math.min(Math.abs(c.start-t),Math.abs(cEnd(c)-t))>30)dropEl(id);});}
/* E.idle：止まっているとき（トラックバーを動かしているときなど）に映像を描いた回数と、絵がなく「読み込み中」を出した回数（fb は代わりに前の絵・サムネイルを出した回数） */
/* 再生の様子（テストで途切れを数える）：frames 描いた回数、vframes 映像を描いた回数、blank 間に合わず描けなかった回数、
   stale 止まった映像を描いた回数、maxGap・slow 描く間隔の最大（ミリ秒）と 50 ミリ秒を超えた回数 */
/* 1フレームを描く：V1 から上へ重ねる。見本の素材は色の画面に名前を出す */
export function drawFrame(cx,W,H,t){cx.fillStyle='#000';cx.fillRect(0,0,W,H);
  vTracks().slice().reverse().forEach(function(tr){if(tr.hide)return;var q=pairAt(t,tr.id);if(q)drawPair(cx,W,H,q,t);
    P.clips.forEach(function(c){if(c.tr!==tr.id||t<c.start-1e-9||t>=cEnd(c))return;if(q&&(c===q.a||c===q.b))return;
    if(c.type==='title')drawTitleClip(cx,W,H,c,t);
    else if(c.type==='adj')adjust(cx,W,H);else drawClip(cx,W,H,c);});});}
/* トランジションの 1 フレーム：前と後ろのクリップを、それぞれ黒の上に描いてから切り替える（書き出しの xfade と同じ） */
var LAYER={};
function layer(k,W,H){var c=LAYER[k];if(!c){c=LAYER[k]=document.createElement('canvas');}if(c.width!==W||c.height!==H){c.width=W;c.height=H;}var x=c.getContext('2d');x.fillStyle='#000';x.fillRect(0,0,W,H);return c;}
export function drawPair(cx,W,H,q,t){var la=layer('a',W,H),lb=layer('b',W,H);drawClip(la.getContext('2d'),W,H,q.a);drawClip(lb.getContext('2d'),W,H,q.b);
  mixTransition(cx,q.k,la,lb,(t-q.w0)/q.d,W,H);}
export function adjust(cx,W,H){try{var tmp=adjust.c||(adjust.c=document.createElement('canvas'));tmp.width=W;tmp.height=H;tmp.getContext('2d').drawImage(cx.canvas,0,0);cx.filter='saturate(1.08) contrast(1.04)';cx.drawImage(tmp,0,0);cx.filter='none';}catch(e){}}
export function drawClip(cx,W,H,c){var m=M(c.m),src=null,w=0,hh=0;if(!m||m.k!=='映像'&&m.k!=='画像')return;
  if(m.url&&!m.loading){if(m.k==='画像'){src=imgFor(m);if(src.complete){w=src.naturalWidth;hh=src.naturalHeight;}}else{src=E.els[c.id]||elFor(c,m,false);if(src.readyState>=2){w=src.videoWidth;hh=src.videoHeight;}if(E.playing){var st=E.stats,lt=c.in+(S.t.edit-c.start);st.vframes++;if(!w){st.blank++;if(st.at.length<40)st.at.push('blank@'+S.t.edit.toFixed(2));}else if(src.paused||src.seeking)st.stale++;else if(Math.abs(src.currentTime-lt)>0.15){st.late++;if(st.at.length<40)st.at.push('late@'+S.t.edit.toFixed(2)+'('+(src.currentTime-lt).toFixed(2)+')');}}}}
  var sc=(c.scale==null?100:c.scale)/100;cx.save();cx.globalAlpha=Math.max(0,Math.min(1,(c.op==null?100:c.op)/100));
  cx.translate(W/2+(c.x||0)/100*W,H/2+(c.y||0)/100*H);cx.rotate((c.rot||0)*Math.PI/180);
  /* 映像の絵がまだ出ないとき（位置合わせ中・読み込み中）は、そのクリップで最後に描けた絵、なければサムネイルを出す */
  if(!w&&m.k==='映像'&&m.url&&!m.loading){var fb=E.last[c.id];if(!fb&&m.thumb){var ti=thumbFor(m);if(ti.complete&&ti.naturalWidth)fb=ti;}
    if(fb){E.idle.fb++;if(fb===E.thumbs[m.id])E.idle.thumb=(E.idle.thumb||0)+1;src=fb;w=fb.width||fb.naturalWidth;hh=fb.height||fb.naturalHeight;}}
  else if(w&&m.k==='映像'&&!E.playing)keepFrame(c.id,src,w,hh);
  if(!E.playing&&m.k==='映像'&&m.url)E.idle.frames++;
  if(w){var s=Math.min(W/w,H/hh)*sc;cx.drawImage(src,-w*s/2,-hh*s/2,w*s,hh*s);}
  else{if(m.url&&!E.playing)E.idle.ph++;var col=m.col||['#333','#222'],g=cx.createLinearGradient(-W/2,-H/2,W/2,H/2);g.addColorStop(0,col[0]);g.addColorStop(1,col[1]);cx.fillStyle=g;cx.fillRect(-W/2*sc,-H/2*sc,W*sc,H*sc);
    cx.fillStyle='rgba(255,255,255,.78)';cx.font='500 '+Math.round(H*.05*sc)+'px "Noto Sans JP","Noto Sans JP Variable",sans-serif';cx.textAlign='center';cx.textBaseline='middle';cx.fillText(m.n+(m.url?'（読み込み中）':'（見本）'),0,0);}
  cx.restore();}
/* 止まっているときに描けた映像の絵を、クリップごとに 1 枚覚えておく（長い辺 960 まで） */
export function keepFrame(id,v,w,hh){var k=Math.min(1,960/Math.max(w,hh)),cw=Math.max(1,Math.round(w*k)),ch=Math.max(1,Math.round(hh*k)),c=E.last[id];
  if(c&&c._t===v.currentTime&&c.width===cw)return;if(!c){c=document.createElement('canvas');E.last[id]=c;}
  if(c.width!==cw||c.height!==ch){c.width=cw;c.height=ch;}try{c.getContext('2d').drawImage(v,0,0,cw,ch);c._t=v.currentTime;}catch(x){delete E.last[id];}}
export function thumbFor(m){var e=E.thumbs[m.id];if(!e||e._src!==m.thumb){e=new Image();if(HOST)e.crossOrigin='anonymous';e.onload=idleRedraw;e._src=m.thumb;e.src=m.thumb;E.thumbs[m.id]=e;}return e;}
/* テロップ：name=店名（画面下・白文字縁取り） q=質問（画面上・黄色帯） sub=字幕（下中央・半透明帯） credit=クレジット（下から上へ流れる） */
export var TST;
/* テロップのクリップを描く：位置・拡大率・回転・不透明度は、動画のクリップと同じく画面の中心を基準にする */
export function titleInfo(c){return {label:c.label,st:c.st,sz:c.sz,fsz:c.fsz,look:c.look,font:c.font,weight:c.weight,lh:c.lh,ls:c.ls,align:c.align,t:c.start-c.in,d:Math.max(0.1,c.out)};}
export function drawTitleClip(cx,W,H,c,t){var sc=(c.scale==null?100:c.scale)/100,op=c.op==null?1:Math.max(0,Math.min(1,c.op/100));
  cx.save();cx.globalAlpha*=op;cx.translate(W/2+(c.x||0)/100*W,H/2+(c.y||0)/100*H);cx.rotate((c.rot||0)*Math.PI/180);cx.scale(sc,sc);cx.translate(-W/2,-H/2);
  drawTitle(cx,W,H,titleInfo(c),t);cx.restore();}
/* 文字の大きさ：fsz（1080p の画面での px）。なければ前の「小・中・大」 */
export function drawTitle(cx,W,H,ti,t){var sz={'小':.042,'中':.055,'大':.075}[ti.sz||'中']||.055,fs=ti.fsz?Math.max(4,Math.round(H*ti.fsz/1080)):Math.round(H*sz),lines=String(ti.label||'').split('\n'),lh=fs*((ti.lh||135)/100),pad=fs*.6;
  /* フォント・太さ・文字の間隔（titleStyles.ts）。まだ読み込んでいないフォントは、読み込めたら描き直す */
  loadFont(ti.font,ti.weight,redrawProg);cx.font=titleFont(ti.font,ti.weight,fs);cx.textBaseline='middle';cx.lineJoin='round';
  if('letterSpacing' in cx)cx.letterSpacing=((ti.ls||0)*H/1080)+'px';
  var al=ti.align||'',ax=function(def){return al==='center'?W/2:al==='right'?W*.94:al==='left'?W*.06:def;};
  var lk=ti.look; /* テロップのスタイル（titleStyles.ts）。あれば文字をそのスタイルで描く */
  var tw=Math.max.apply(null,lines.map(function(l){return cx.measureText(l).width;}).concat([0])),bh=lh*lines.length;
  function outl(l,x,y){if(lk)return drawLookText(cx,l,x,y,fs,lk);cx.lineWidth=fs*.18;cx.strokeStyle='rgba(0,0,0,.85)';cx.strokeText(l,x,y);cx.fillStyle='#fff';cx.fillText(l,x,y);}
  function plain(l,x,y){if(lk)drawLookText(cx,l,x,y,fs,lk);else cx.fillText(l,x,y);}
  if(ti.st==='q'){cx.textAlign='left';cx.fillStyle='rgba(255,210,60,.92)';cx.fillRect(W*.06,H*.07,tw+pad*2,bh+pad*.8);cx.fillStyle='#1a1400';lines.forEach(function(l,i){plain(l,W*.06+pad,H*.07+pad*.4+lh*(i+.5));});}
  else if(ti.st==='sub'){cx.textAlign='center';var y0=H*.92-bh;cx.fillStyle='rgba(0,0,0,.6)';cx.fillRect((W-tw)/2-pad,y0-pad*.4,tw+pad*2,bh+pad*.8);cx.fillStyle='#fff';lines.forEach(function(l,i){plain(l,W/2,y0+lh*(i+.5));});}
  else if(ti.st==='credit'){cx.textAlign=al||'center';var pr=Math.max(0,Math.min(1,(t-ti.t)/ti.d)),y=H-(H+bh)*pr;lines.forEach(function(l,i){outl(l,ax(W/2),y+lh*(i+.5));});}
  /* center：画面の真ん中（新しく置くテロップ） */
  else if(ti.st==='center'){cx.textAlign=al||'center';var yc=H/2-bh/2;lines.forEach(function(l,i){outl(l,ax(W/2),yc+lh*(i+.5));});}
  else{cx.textAlign=al||'left';var yb=H*.9-bh;lines.forEach(function(l,i){outl(l,ax(W*.06),yb+lh*(i+.5));});}}
/* 止まっているときだけ描き直す（再生中は毎フレーム描くので、素材の読み込みのたびに描くと重くなる） */
export function idleRedraw(){if(!E.playing)redrawProg();}
export function redrawProg(){if(X&&X.run&&!X.desk)return;[].forEach.call(document.querySelectorAll('canvas[data-prog]'),function(c){drawFrame(c.getContext('2d'),c.width,c.height,S.t.edit);});}
export function clampProg(){var d=progDur();S.t.edit=Math.max(0,Math.min(d,S.t.edit));if(P.pout!=null&&P.pout>d)P.pout=d;if(P.pin!=null&&P.pin>=(P.pout!=null?P.pout:d))P.pin=null;}
export function setProg(t){S.t.edit=Math.max(0,Math.min(progDur(),t));heads();if(!E.playing){sync(S.t.edit,false);redrawProg();}}
export function heads(follow){var t=S.t.edit,d=progDur()||1,pps=S.pps||10;
  [].forEach.call(document.querySelectorAll('[data-head="edit"]'),function(e){e.style.left=(t*pps)+'px';});
  [].forEach.call(document.querySelectorAll('[data-bar="edit"]'),function(e){e.style.width=(t/d*100)+'%';});
  [].forEach.call(document.querySelectorAll('[data-time="edit"]'),function(e){e.textContent=tc(t);});
  if(follow&&PREF.follow){var b=document.querySelector('[data-body]');if(b){var x=t*pps;if(x>b.scrollLeft+b.clientWidth-30||x<b.scrollLeft)b.scrollLeft=Math.max(0,x-60);}}}
export function progPlay(){if(X&&X.run&&!X.desk)return toast('書き出し中は再生できません');if(E.playing)return progStop();if(!P.clips.length)return toast('タイムラインにクリップがありません');
  audioInit();if(E.ctx&&E.ctx.state==='suspended')E.ctx.resume();if(S.t.edit>=progDur()-0.05)S.t.edit=0;
  E.playing=true;syncPlayBtn();
  /* 再生を始める位置の映像が描ける状態になってから、時計を進め始める（最長 1.5 秒待つ） */
  sync(S.t.edit,false);var w0=performance.now();
  (function ready(){if(!E.playing)return;var wait=activeVideos(S.t.edit).some(function(e){return e.readyState<2||e.seeking;});
    if(wait&&performance.now()-w0<1500){E.raf=requestAnimationFrame(ready);return;}start();})();
  function start(){E.base=S.t.edit;E.t0=performance.now();
  E.stats={frames:0,vframes:0,blank:0,stale:0,late:0,maxGap:0,slow:0,last:0,at:[]};
  (function loop(){if(!E.playing)return;var now=performance.now(),st=E.stats;if(st.last){var gap=now-st.last;st.maxGap=Math.max(st.maxGap,gap);if(gap>50){st.slow++;if(st.at.length<40)st.at.push('gap@'+S.t.edit.toFixed(2)+'('+Math.round(gap)+')');}}st.last=now;st.frames++;var t=E.base+(now-E.t0)/1000;if(t>=progDur()){S.t.edit=progDur();progStop();return;}S.t.edit=t;sync(t,true);heads(true);redrawProg();E.raf=requestAnimationFrame(loop);})();}}
/* 時刻 t に映っている映像のクリップの要素 */
export function activeVideos(t){return P.clips.filter(function(c){var m=c.type==='media'&&M(c.m),tr=T(c.tr);return m&&m.url&&m.k==='映像'&&tr&&tr.kind==='v'&&!tr.hide&&t>=c.start-1e-6&&t<cEnd(c);}).map(function(c){return E.els[c.id];}).filter(Boolean);}
export function progStop(){E.playing=false;cancelAnimationFrame(E.raf);sync(S.t.edit,false);heads();redrawProg();syncPlayBtn();}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
E={prevTr:null,ctx:null,master:null,mon:null,els:{},imgs:{},last:{},thumbs:{},idle:{frames:0,ph:0,fb:0},playing:false,raf:0,base:0,t0:0,stats:{frames:0,vframes:0,blank:0,stale:0,late:0,maxGap:0,slow:0,last:0,at:[]}};
PLAYERR={};
TST={center:'テロップ',name:'店名テロップ',q:'質問テロップ',sub:'字幕',credit:'クレジット'};
}
