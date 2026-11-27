// @ts-nocheck
import { loadFont } from './titleStyles';
import { ps } from './projectSettings';
import { numberIn } from '../core/silence';
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { D } from './data';
import { P, cEnd, progDur } from './project';
import { S } from './state';
import { hm, mmss } from './util';
import { HOST, forDisk } from './desktop';
import { E, audioInit, drawFrame, drawTitle, drawTitleClip, heads, setNoPh, sync, titleInfo } from './engine';
import { stopAll } from './source';
import { draw } from './render';
import { toast } from './menus';

/* ================================================================
   書き出し（canvas と Web Audio をそのまま録画する。実時間かかる）
   ================================================================ */
export var VM;
export var AM;
export function supported(list){if(HOST)return list;if(!window.MediaRecorder||!MediaRecorder.isTypeSupported)return [];var seen={},o=[];list.forEach(function(x){try{if(!seen[x[0]]&&MediaRecorder.isTypeSupported(x[1])){seen[x[0]]=1;o.push(x);}}catch(e){}});return o;}
export function presetX(i){var p=D.presets[i],fm=supported(p.audio?AM:VM);return {file:p.file,res:p.res,fps:p.fps,br:p.br,au:p.au,audio:!!p.audio,fmt:fm.length?fm[0][0]:'—'};}
export function xFmt(){var L=supported(S.x.audio?AM:VM);for(var i=0;i<L.length;i++)if(L[i][0]===S.x.fmt)return L[i];return L[0]||null;}
export var num=numberIn;
export function xBits(){return {v:S.x.audio?0:num(S.x.br)*1e6,a:num(S.x.au)*1e3};}
export var X; /* 実行中の書き出し */
export function xNext(){if(X&&X.run)return;var j=S.queue.filter(function(q){return q.st==='wait';})[0];if(j)xStart(j);}
export function xStart(j){if(HOST)return deskStart(j);if(!P.clips.length){j.st='err';j.msg='タイムラインが空です';draw();return;}
  audioInit();if(!E.ctx){j.st='err';j.msg='このブラウザでは音声を扱えません';draw();return;}
  if(E.ctx.state==='suspended')E.ctx.resume();stopAll();
  var set=j.set,cv=null,cx=null,tracks=[],dest=E.ctx.createMediaStreamDestination();E.master.connect(dest);
  if(!set.audio){var wh=set.res.split('×');cv=document.createElement('canvas');cv.width=+wh[0];cv.height=+wh[1];cx=cv.getContext('2d');drawFrame(cx,cv.width,cv.height,set.from||0);
    tracks=tracks.concat(cv.captureStream(set.fps).getVideoTracks());}
  tracks=tracks.concat(dest.stream.getAudioTracks());
  var rec;try{rec=new MediaRecorder(new MediaStream(tracks),{mimeType:set.mime,videoBitsPerSecond:set.v||undefined,audioBitsPerSecond:set.a});}catch(e){E.master.disconnect(dest);j.st='err';j.msg='この形式では書き出せません';draw();return;}
  var chunks=[];rec.ondataavailable=function(ev){if(ev.data&&ev.data.size)chunks.push(ev.data);};
  rec.onstop=function(){E.master.disconnect(dest);E.mon.gain.value=1;if(X.cancel){j.st='err';j.msg='中止しました';}else{j.blob=new Blob(chunks,{type:set.mime.split(';')[0]});j.url=URL.createObjectURL(j.blob);j.st='done';j.at=hm();j.size=j.blob.size;toast('「'+j.n+'」の書き出しが終わりました');}
    X=null;sync(S.t.edit,false);draw();xNext();};
  E.mon.gain.value=0;j.st='run';j.p=0;X={j:j,run:true,rec:rec,cv:cv,cx:cx,t:set.from||0,from:set.from||0,dur:set.to!=null?set.to:progDur(),paused:false};S.xplay=null;
  sync(X.t,false);draw();
  setTimeout(function(){if(!X||X.j!==j)return;rec.start(1000);X.last=performance.now();X.iv=setInterval(xTick,1000/set.fps);},400);}
export function xTick(){var x=X;if(!x)return;var now=performance.now();if(x.paused){x.last=now;return;}x.t+=(now-x.last)/1000;x.last=now;
  if(x.t>=x.dur){clearInterval(x.iv);x.t=x.dur;sync(x.dur,false);if(x.cx)drawFrame(x.cx,x.cv.width,x.cv.height,x.dur-0.001);x.run=false;setTimeout(function(){x.rec.stop();},150);return;}
  sync(x.t,true);if(x.cx)drawFrame(x.cx,x.cv.width,x.cv.height,x.t);x.j.p=(x.t-x.from)/Math.max(0.01,x.dur-x.from)*100;
  S.t.edit=x.t;[].forEach.call(document.querySelectorAll('canvas[data-prog]'),function(c){if(x.cv)c.getContext('2d').drawImage(x.cv,0,0,c.width,c.height);else drawFrame(c.getContext('2d'),c.width,c.height,x.t);});heads();
  var f=document.querySelector('[data-q="'+x.j.id+'"]'),tx=document.querySelector('[data-qt="'+x.j.id+'"]');if(f)f.style.width=x.j.p+'%';if(tx)tx.textContent=Math.round(x.j.p)+'%　残り約'+mmss(x.dur-x.t);}
export function xPause(){if(!X)return;X.paused=!X.paused;if(X.paused){X.rec.pause();sync(X.t,false);X.j.st='pause';}else{X.rec.resume();X.j.st='run';}draw();}
export function xCancel(){if(!X)return;if(X.desk){HOST.export.cancel(X.j.id);return;}X.cancel=true;clearInterval(X.iv);X.run=false;sync(X.t,false);try{X.rec.stop();}catch(e){}}
/* ---------- デスクトップ版：FFmpeg で書き出す（Rust の matsuko-core が組み立てる） ----------
   保存先は、キューに入れるときに選ぶ。一時停止はできない（中止して、やり直す） */
export function deskEnqueue(j,run){var ext=j.n.match(/\.([a-z0-9]+)$/i)[1];
  HOST.export.pick(j.n,ext).then(function(path){if(!path)return;j.out=path;j.n=path.split(/[\\/]/).pop();S.queue.push(j);draw();
    if(!run)return toast('キューに追加しました');if(X&&X.run)toast('いまの書き出しが終わったら始めます');else xStart(j);}).catch(function(e){toast(String(e));});}
/* テロップを、プレビューと同じ描き方で PNG にする。クレジット（流れる文字）は文字の部分だけ */
export function titleImages(from,to,W,H){var out=[];setNoPh(true);try{P.clips.forEach(function(c){if(c.type!=='title'||!String(c.label||'').trim()||cEnd(c)<=from||c.start>=to)return;
    var ti=titleInfo(c),cv=document.createElement('canvas'),scroll=c.st==='credit';cv.width=W;
    if(scroll){var sz={'小':.042,'中':.055,'大':.075}[c.sz||'中']||.055,lh=(c.fsz?Math.max(4,Math.round(H*c.fsz/1080)):Math.round(H*sz))*((c.lh||135)/100),bh=lh*String(c.label||'').split('\n').length;
      cv.height=Math.max(2,Math.ceil(bh));drawTitle(cv.getContext('2d'),W,H,ti,ti.t+ti.d*H/(H+bh));}
    else{cv.height=H;drawTitleClip(cv.getContext('2d'),W,H,c,c.start);} /* 位置・拡大率・回転・不透明度も画像に入れる */
    out.push({clip:c.id,png:cv.toDataURL('image/png'),scroll:scroll});});}finally{setNoPh(false);}return out;}
export function deskStart(j){var set=j.set,wh=set.res.split('×'),W=+wh[0]||1920,H=+wh[1]||1080,to=set.to!=null?set.to:progDur();
  var req={id:j.id,out:j.out,project:forDisk(),titles:[],width:W,height:H,fps:String(set.fps),from:set.from||0,to:to,audioOnly:!!set.audio,videoBitrate:Math.round(set.v||8e6),audioBitrate:Math.round(set.a||192e3),audioRate:ps().ar};
  j.st='run';j.p=0;j.t0=Date.now();X={j:j,run:true,desk:true};draw();
  /* テロップのフォントを読み込んでから画像にする（読み込む前だと、ほかのフォントで描かれてしまう） */
  Promise.all(P.clips.filter(function(c){return c.type==='title';}).map(function(c){return loadFont(c.font,c.weight);})).then(function(){req.titles=set.audio?[]:titleImages(set.from||0,to,W,H);return HOST.export.start(req);}).catch(function(e){j.st='err';j.msg=String(e);X=null;draw();xNext();});}
/* 進み具合・結果（"export-job"） */
export function deskEvent(e){var j=S.queue.filter(function(q){return q.id===e.id;})[0];if(!j)return;var d=e.data||{};
  if(e.state==='progress'){j.p=e.p*100;var f=document.querySelector('[data-q="'+j.id+'"]'),tx=document.querySelector('[data-qt="'+j.id+'"]'),el=(Date.now()-j.t0)/1000;
    if(f)f.style.width=j.p+'%';if(tx)tx.textContent=Math.round(j.p)+'%'+(e.p>0.03?'　残り約'+mmss(el*(1-e.p)/e.p):'');return;}
  if(e.state==='done'){j.st='done';j.p=100;j.at=hm();j.size=d.size;j.out=d.out;j.url=HOST.media.url(d.out);j.secs=d.elapsed;toast('「'+j.n+'」の書き出しが終わりました（'+mmss(d.elapsed)+'）');}
  else{j.st='err';j.msg=d.message||'失敗しました';}
  if(X&&X.j===j)X=null;draw();xNext();}
export var DL;
export function saveJob(j){if(!j||!j.blob)return;
  if(HOST){var ext=(j.n.match(/\.([a-z0-9]+)$/i)||[0,'mp4'])[1];HOST.saveFile(j.n,ext,j.blob).then(function(ok){if(ok)toast('保存しました');}).catch(function(e){toast('保存できませんでした：'+e);});return;}
  if(DL){DL.save({filename:j.n,data:j.blob}).then(function(r){if(r&&r.status==='saved')toast('保存しました');}).catch(function(e){var c=e&&e.code;if(c==='declined')return;toast(c==='rejected_extension'?'この形式は保存できません':c==='rate_limited'?'少し待ってからもう一度押してください':'このページでは保存できませんでした');});return;}
  var a=document.createElement('a');a.href=j.url;a.download=j.n;document.body.appendChild(a);a.click();a.remove();}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
VM=[['MP4（H.264）','video/mp4;codecs=avc1.640028,mp4a.40.2','mp4'],['MP4（H.264）','video/mp4;codecs=avc1.42E01E,mp4a.40.2','mp4'],['MP4（H.264）','video/mp4;codecs=avc1,mp4a.40.2','mp4'],['MP4','video/mp4','mp4'],['WebM（VP9）','video/webm;codecs=vp9,opus','webm'],['WebM（VP8）','video/webm;codecs=vp8,opus','webm'],['WebM','video/webm','webm']];
AM=[['MP4（AAC 音声）','audio/mp4','mp4'],['WebM（Opus 音声）','audio/webm;codecs=opus','webm'],['WebM（音声）','audio/webm','webm']];
X=null;
DL=null;
if(HOST){VM=[['MP4（H.264・AAC）','ffmpeg','mp4']];AM=[['M4A（AAC 音声）','ffmpeg','m4a']];HOST.export.onJob(deskEvent);}
try{if(window.claude&&typeof window.claude.use==='function')window.claude.use('downloads').then(function(d){DL=d;}).catch(function(){});}catch(e){}
}
