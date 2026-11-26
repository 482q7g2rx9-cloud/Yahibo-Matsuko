// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { D } from '../data';
import { M, P, progDur, uid } from '../project';
import { S } from '../state';
import { A, btn, h, ibtn, mb, mmss, ph, playBtn, sel, tc } from '../util';
import { E, audible } from '../engine';
import { AM, VM, X, num, presetX, supported, xBits, xFmt } from '../exporter';
import { R } from './media';
import { xRange } from './edit';
import { toast } from '../menus';

/* ---- 出力 ---- */
export function checks(){var o=[],d=progDur(),used={};P.clips.forEach(function(c){if(c.m)used[c.m]=1;});
  if(!P.clips.length)o.push(['er','タイムライン','クリップがありません。編集ページかカットページで追加してください']);
  else o.push([Math.abs(d-480)<=15?'ok':'wn','尺',mmss(d)+'（目標 8:00）'+(Math.abs(d-480)<=15?'':d<480?'　目標より '+mmss(480-d)+' 短い':'　目標より '+mmss(d-480)+' 長い')]);
  if(S.x&&S.x.range==='イン点〜アウト点'){var rr=xRange();o.push(P.pin!=null||P.pout!=null?['ok','範囲',tc(rr[0])+' 〜 '+tc(rr[1])+'（'+mmss(rr[1]-rr[0])+'）']:['wn','範囲','イン点・アウト点がありません。編集ページで I・O キーを押して決めてください']);}
  var wn=Object.keys(used).map(M).filter(function(m){return m&&m.r==='wn';});
  o.push(wn.length?['wn','権利情報','要確認の素材 '+wn.length+'件（'+wn.map(function(m){return m.n;}).join('、')+'）','確認する','chk']:['ok','権利情報','要確認の素材はありません']);
  var smp=P.clips.filter(function(c){var m=c.m&&M(c.m);return m&&!m.url;}).length;
  o.push(smp?['wn','見本の素材','見本のクリップ '+smp+'件は、映像は色の画面、音声は無音で書き出されます']:['ok','素材ファイル','すべて読み込んだファイルを使います']);
  var hid=P.tracks.filter(function(t){return t.kind==='v'?t.hide&&P.clips.some(function(c){return c.tr===t.id;}):!audible(t)&&P.clips.some(function(c){return c.tr===t.id;});});
  if(hid.length)o.push(['wn','トラック',hid.map(function(t){return t.id;}).join('・')+' は非表示・ミュートのため書き出されません']);
  var f=xFmt();o.push(f?['ok','書き出し形式',f[0]+'　このブラウザで書き出せます']:['er','書き出し形式','このブラウザは書き出しに対応していません（Chrome・Edge・Safari の新しい版で開いてください）']);
  return o;}
export function newJob(){var f=xFmt(),rg=xRange();if(S.x.range==='イン点〜アウト点'&&P.pin==null&&P.pout==null){toast('編集ページで I・O キーを押して範囲を決めてください');return null;}if(rg[1]-rg[0]<0.5&&P.clips.length){toast('書き出す範囲が短すぎます');return null;}if(!f){toast('このブラウザでは書き出せません');return null;}if(!P.clips.length){toast('タイムラインにクリップがありません');return null;}
  var x=S.x,b=xBits(),j={id:uid('j'),n:(x.file||'書き出し').replace(/[\\/:*?"<>|]/g,'_')+'.'+f[2],st:'wait',p:0,set:{from:rg[0],to:rg[1],audio:x.audio,res:x.res,fps:num(x.fps)||30,v:b.v,a:b.a,mime:f[1]}};S.queue.push(j);return j;}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
R.export=function(){
  if(!S.x)S.x=presetX(S.preset);var x=S.x,f=xFmt(),bits=xBits(),dur=progDur(),rg=xRange(),est=(bits.v+bits.a)*(rg[1]-rg[0])/8,ck=checks(),nw=ck.filter(function(c){return c[0]!=='ok';}).length,
    ext=f?f[2]:'mp4',fmts=supported(x.audio?AM:VM).map(function(z){return z[0];});
  var pl=S.queue.filter(function(q){return q.id===S.xplay;})[0];
  var mon=pl?'<video src="'+pl.url+'" controls autoplay style="width:400px;height:225px;background:#000"></video><button class="b s" style="position:absolute;right:8px;top:8px"'+A('xback')+'>プレビューに戻る</button>'
    :'<canvas data-prog width="960" height="540" style="width:400px;height:225px;display:block"></canvas>';
  return '<div class="pn l" style="width:280px">'+ph('書き出しプリセット（用途別）')+'<div class="scroll">'+D.presets.map(function(p,i){return '<div class="li'+(S.preset===i?' selr':'')+'" role="button" tabindex="0"'+A('preset',i)+' style="padding:16px 16px 14px;border-bottom:1px solid var(--dv)"><div style="font-size:13px">'+h(p.n)+'</div><div class="t2" style="margin-top:8px">'+h(p.d)+'</div></div>';}).join('')+
    '<div style="padding:14px">'+btn('＋ プリセットを追加','todo','','','','width:100%')+'</div></div></div>'+
  '<div class="pc">'+ph('プレビュー　シーケンス全体','<span class="x">'+(x.audio?'音声のみ':h(x.res)+'　'+h(x.fps))+'　'+mmss(dur)+'</span>')+
    '<div class="mon" style="height:246px">'+mon+'<div style="position:absolute;left:0;right:0;bottom:0;height:7px;background:var(--bg0)"><i data-bar="edit" style="display:block;height:7px;width:'+(dur?S.t.edit/dur*100:0)+'%;background:var(--ac)"></i></div></div>'+
    '<div class="tp" style="border-top:0"><span class="tc" style="width:220px"><span data-time="edit">'+tc(S.t.edit)+'</span> / '+tc(dur)+'</span><span class="mid">'+ibtn('toStart','先頭へ','top')+playBtn(E.playing)+ibtn('nextCut','末尾へ','end')+'</span><span class="end" style="width:220px"></span></div>'+
    ph('書き出し前のチェック',nw?'<span style="font-weight:400" class="t-wn">要確認 '+nw+'件</span>':'<span class="t-ok" style="font-weight:400">問題なし</span>')+
    ck.map(function(c){return '<div style="display:grid;grid-template-columns:48px 120px 1fr 90px;gap:18px;align-items:center;min-height:41px;padding:0 16px;border-bottom:1px solid var(--dv)"><span class="chip '+(c[0]==='ok'?'c-ok':c[0]==='wn'?'c-wn':'c-er')+'" style="text-align:center">'+(c[0]==='ok'?'OK':c[0]==='wn'?'警告':'エラー')+'</span><span>'+h(c[1])+'</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+h(c[2])+'">'+h(c[2])+'</span><span style="text-align:right">'+(c[3]?btn(c[3],c[4],'','s'):'')+'</span></div>';}).join('')+
    ph('書き出しキュー',X&&X.run?'<span class="x">書き出し中はこのタブを表示したままにしてください</span>':'')+'<div class="scroll">'+(S.queue.length?S.queue.map(function(q){var st,btns;
      if(q.st==='done'){st='<span class="t-ok">完了　'+q.at+'　'+mb(q.size)+'</span>';btns=btn('再生','xview',q.id,'s')+btn('保存','xsave',q.id,'s on');}
      else if(q.st==='wait'){st='<span class="mu">待機中</span>';btns=btn('取り消し','xdel',q.id,'s');}
      else if(q.st==='err'){st='<span class="t-er">'+h(q.msg||'失敗しました')+'</span>';btns=btn('削除','xdel',q.id,'s');}
      else{st='<span class="row" style="gap:8px"><span class="prog" style="width:200px"><i data-q="'+q.id+'" style="width:'+q.p+'%"></i></span><span class="t-ac" style="white-space:nowrap" data-qt="'+q.id+'">'+Math.round(q.p)+'%'+(q.st==='pause'?'（一時停止中）':'')+'</span></span>';btns=btn(q.st==='pause'?'再開':'一時停止','xpause',q.id,'s')+btn('中止','xcancel',q.id,'s');}
      return '<div class="row" style="height:43px;gap:12px;padding:0 16px;border-bottom:1px solid var(--dv)"><span style="width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+h(q.n)+'">'+h(q.n)+'</span><span class="grow">'+st+'</span><span class="row" style="gap:6px">'+btns+'</span></div>';}).join('')
      :'<div class="mu" style="padding:14px">「書き出し」を押すと、ここに進み具合が出ます。書き出しには動画の長さと同じだけ時間がかかります。</div>')+'</div></div>'+
  '<div class="pn r" style="width:350px">'+ph('書き出し設定','<span class="x">'+h(D.presets[S.preset].n)+'</span>')+'<div class="scroll" style="padding:4px 14px">'+
    [['ファイル名','<span class="row" style="gap:6px"><input class="inp grow" aria-label="ファイル名" data-in="xfile" value="'+h(x.file)+'"><span class="mu">.'+ext+'</span></span>'],
     ['範囲',sel('範囲',D.opts.range,x.range||'シーケンス全体','width:100%','xrange')],['形式',fmts.length?sel('形式',fmts,x.fmt,'width:100%','xfmt'):'<span class="t-er">対応形式なし</span>']]
     .concat(x.audio?[['音声',sel('音声',D.opts.au,x.au,'width:100%','xau')]]:[['解像度',sel('解像度',D.opts.res,x.res,'width:100%','xres')],['フレームレート',sel('フレームレート',D.opts.fps,x.fps,'width:100%','xfps')],['ビットレート',sel('ビットレート',D.opts.br,x.br,'width:100%','xbr')],['音声',sel('音声',D.opts.au,x.au,'width:100%','xau')]])
     .map(function(r){return '<div style="display:grid;grid-template-columns:100px 1fr;align-items:center;height:40px"><span class="t2">'+r[0]+'</span>'+r[1]+'</div>';}).join('')+
    '<div class="box" style="margin-top:12px;padding:14px;border:1px solid var(--dv);line-height:1.9">推定サイズ　約 '+mb(est||0)+'<br>書き出しにかかる時間　約 '+mmss(rg[1]-rg[0])+'（実際の長さと同じ）<br><span class="mu">画面の比率が違う素材は、黒い帯を付けて収めます。</span></div></div>'+
    '<div class="row" style="gap:8px;padding:12px 16px;border-top:1px solid var(--dv)">'+btn('キューに追加','qadd','','sec','','flex:1;height:36px')+btn('書き出し','xrun','','pri','','flex:1;height:36px')+'</div></div>';
};
}
