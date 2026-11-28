// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { D } from '../data';
import { M, P, cEnd, isUsed } from '../project';
import { S } from '../state';
import { A, btn, h, hms, ic, kv, mb, mmss, ph, stl, waveOf } from '../util';
import { IMP } from '../importWeb';
import { HOST, jobText, jobsFoot } from '../desktop';
import { bins as userBins, inBin } from '../bins';

/* ================================================================
   各ページ
   ================================================================ */
export var R;

/* ---- メディア ---- */
export function mediaList(){var q=S.mq.trim(),L=P.media.filter(function(m){
    if(!inBin(m,S.bin))return false;if(S.mtype&&m.k!==S.mtype)return false;
    return !q||m.n.indexOf(q)>=0||m.c.indexOf(q)>=0;});
  if(S.msort==='len')L=L.slice().sort(function(a,b){return b.d-a.d;});else if(S.msort==='code')L=L.slice().sort(function(a,b){return a.c<b.c?-1:1;});
  return L;}
export function binCount(id){return P.media.filter(function(m){return inBin(m,id);}).length;}
export function mthumb(m,w,hh){var sz=w==='fill'?'width:100%;aspect-ratio:16/9':'width:'+w+'px;height:'+hh+'px';
  if(m.loading)return '<div class="th" style="'+sz+';background:var(--bg3);display:flex;align-items:center;justify-content:center;color:var(--mu);font-size:10px">読み込み中</div>';
  if(m.thumb)return '<div class="th" style="'+sz+';background:#000 url('+m.thumb+') center / cover"></div>';
  if(m.k==='音声'||m.k==='テイク')return '<div class="th" style="'+sz+';background:#2f78b7;border-color:#8cc4ee">'+waveOf(m,0,m.d||1,22)+'</div>';
  if(m.k==='台本')return '<div class="th" style="'+sz+';background:var(--chip);border-color:#555;display:flex;align-items:center;justify-content:center;color:var(--tx2)">台本</div>';
  return '<div class="th" style="'+sz+';background:'+(m.col?m.col[0]:'#555')+'"></div>';}
export function rightsChip(m){var r=D.rights[m.r];return r?stl(r[0],r[1]):'<span class="mu">—</span>';}
export function useText(m){return m.k==='台本'?'<span class="mu">—</span>':isUsed(m)?'<span class="t-ok">使用中</span>':'<span class="mu">未使用</span>';}
export function tlText(m){var o=[];P.clips.slice().sort(function(a,b){return a.start-b.start;}).forEach(function(c){if(c.m===m.id)o.push(c.tr+'　'+mmss(c.start)+'–'+mmss(cEnd(c)));});return o.length?o.slice(0,4).join(' / ')+(o.length>4?' ほか':''):'—';}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
R={};
R.media=function(){
  /* 全素材・種別、自分のビン（＋で作る。ダブルクリックか右クリックで名前を変える・消す）、スマートビン。素材はビンへドラッグして入れる */
  var ub=userBins(),bins=D.bins.map(binRow).join('')+
    '<div class="row" style="padding:12px 8px 6px 16px"><span class="mu grow">ビン</span><button class="ib" aria-label="ビンを作る" title="ビンを作る"'+A('binAdd')+'>'+ic('plus',14)+'</button></div>'+
    ub.map(function(b){var id='b:'+b.id;if(S.binEdit===b.id)return '<div class="bin selr"><input class="inp grow" data-in="binname" data-bid="'+b.id+'" value="'+h(b.name)+'" aria-label="ビンの名前" style="height:24px"></div>';
      return '<div class="bin li'+(S.bin===id?' selr':'')+'" role="button" tabindex="0" data-binid="'+b.id+'"'+A('bin',id)+'><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+h(b.name)+'</span><span class="mu">'+binCount(id)+'</span></div>';}).join('')+
    '<div style="padding:12px 16px 6px" class="mu">スマートビン</div>'+D.smart.map(binRow).join('');
  function binRow(b){return '<div class="bin li'+(S.bin===b[0]?' selr':'')+'" role="button" tabindex="0"'+(b[0]==='all'?' data-binid=""':'')+A('bin',b[0])+'><span class="grow">'+h(b[1])+'</span><span class="mu">'+binCount(b[0])+'</span></div>';}
  var L=mediaList(),m=M(S.media)||L[0]||P.media[0],body,tag=function(x){return x.sample?' <span class="chip c-mu" style="margin-left:6px">見本</span>':'';};
  if(!P.media.length)body='<div class="scroll" style="display:flex;align-items:center;justify-content:center"><div style="text-align:center;line-height:2"><div style="font-size:15px;font-weight:500">素材がまだありません</div><div style="margin-top:10px">'+btn('＋ 読み込み','imp','','pri')+'</div></div></div>';
  else if(S.mview==='list')body='<div class="mt h"><span></span><span>名前</span><span>種別</span><span>長さ</span><span>記号</span><span>権利</span><span>台本行</span><span>状態</span></div><div class="scroll">'+
    L.map(function(x){return '<div class="mt r li'+(m&&x.id===m.id?' selr':'')+'" role="button" tabindex="0"'+A('mrow',x.id)+' title="ダブルクリックでタイムラインに追加">'+mthumb(x,64,36)+'<span style="font-size:13px">'+h(x.n)+tag(x)+'</span><span class="t2">'+h(x.k)+'</span><span>'+(x.d?mmss(x.d):'—')+'</span><span>'+h(x.c)+'</span><span>'+rightsChip(x)+'</span><span class="mu">'+h(x.sr)+'</span><span>'+(HOST&&x.file?'<span data-pxt="'+x.id+'" data-short>'+(jobText(x,1)||useText(x))+'</span>':useText(x))+'</span></div>';}).join('')+
    (L.length?'':'<div class="mu" style="padding:24px">該当する素材はありません</div>')+'</div>';
  else body='<div class="scroll"><div class="thg">'+L.map(function(x){return '<div class="tc li'+(m&&x.id===m.id?' selr':'')+'" role="button" tabindex="0"'+A('mrow',x.id)+'>'+mthumb(x,'fill')+'<div style="margin-top:6px;font-size:13px">'+h(x.n)+tag(x)+'</div><div class="row" style="gap:8px;margin-top:4px"><span class="mu">'+h(x.k)+'　'+(x.d?mmss(x.d):'—')+'</span><span class="grow"></span>'+rightsChip(x)+'</div></div>';}).join('')+'</div></div>';
  var jf=HOST&&!IMP.total?jobsFoot():'',foot=jf?jf:IMP.total?'<span>読み込み中：'+h(IMP.cur)+'</span><div class="prog" style="width:200px"><i style="width:'+Math.round(IMP.done/IMP.total*100)+'%"></i></div><span class="t-ac">'+IMP.done+' / '+IMP.total+'</span><span class="grow"></span>'
    :'<span class="grow"></span><span class="mu">読み込んだ素材 '+P.media.filter(function(x){return x.file;}).length+'件</span>';
  var right='';
  if(m){var px=HOST&&m.file?(m.np?(m.px===1?'<span class="t-ok">作成済み（720p）</span>':m.px===-2?'<span class="t-wn">作れませんでした（元のファイルで編集）</span>':'<span data-pxt="'+m.id+'">'+(jobText(m)||'<span class="mu">待機中</span>')+'</span>'):'<span class="mu">不要（元のファイルで編集）</span>'):m.file?'<span class="mu">元のファイルで編集</span>':m.px===1?'<span class="t-ok">生成済み（1280×720）</span>':m.px>0?'<span class="t-ac">生成中 '+Math.round(m.px*100)+'%</span>':'<span class="mu">—</span>',r=D.rights[m.r];
    var prev=m.thumb?'<img src="'+m.thumb+'" alt="" style="width:240px;height:135px;object-fit:contain;display:block">':m.k==='映像'?'<div class="th" style="width:240px;height:135px;background:'+m.col[0]+'"></div>':mthumb(m,240,135);
    var miss=m.missing?'<div class="box" style="margin:10px 12px;border-color:var(--wn)"><div class="t-wn" style="margin-bottom:6px">ファイルが見つかりません</div><div class="mu" style="margin-bottom:10px;word-break:break-all">'+h(m.path||m.f)+'</div>'+btn('リンクし直す…','relink',m.id,'pri')+'</div>':'';
    var canAdd=(m.url||m.sample||(HOST&&m.file&&!m.missing))&&(m.k==='映像'||m.k==='画像'||(m.k==='音声'&&m.url));
    right=ph('素材の詳細','<span class="x">'+h(m.n)+'</span>')+'<div class="scroll">'+
    '<div class="mon" style="height:150px">'+prev+'</div>'+miss+
    (canAdd?'<div class="row" style="gap:8px;padding:10px 12px;border-bottom:1px solid var(--dv)">'+btn(ic('plus',14)+'タイムラインに追加','addtl',m.id,'on','','flex:1')+(m.file?btn('削除','mdel',m.id):'')+'</div>':m.file?'<div class="row" style="padding:10px 12px;border-bottom:1px solid var(--dv)">'+btn('削除','mdel',m.id)+'</div>':'')+
    '<div style="padding:6px 0;border-bottom:1px solid var(--dv)">'+kv('ファイル',h(m.f))+(HOST&&m.path?kv('場所','<span title="'+h(m.path)+'" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">'+h(m.path)+'</span>'):'')+kv(m.k==='映像'||m.k==='画像'?'解像度':'形式',h(m.res||'—'))+kv('長さ',m.d?hms(m.d):'—')+kv('ビン','<select class="inp" aria-label="ビン" data-in="mbin" data-mid="'+m.id+'" style="height:26px;width:100%"><option value="">なし</option>'+userBins().map(function(b){return '<option value="'+b.id+'"'+(m.bin===b.id?' selected':'')+'>'+h(b.name)+'</option>';}).join('')+'</select>')+(m.size?kv('サイズ',mb(m.size)):'')+(m.px!==-1||m.file?kv('プロキシ',px):'')+'</div>'+
    ph('権利情報',r?'<span style="font-weight:400">'+stl(r[0],r[1])+'</span>':'')+
    '<div style="padding:6px 0;border-bottom:1px solid var(--dv)">'+kv('状態','<select class="inp" aria-label="権利の状態" data-in="rights" style="height:26px;width:100%">'+[['ok','許可済み'],['wn','要確認'],['free','フリー素材'],['own','自社収録']].map(function(o){return '<option value="'+o[0]+'"'+(m.r===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select>')+
      kv('権利者',h(m.ho))+kv('出典',h(m.src))+kv('許諾',h(m.pm))+kv('期限',h(m.ex))+'</div>'+
    ph('関連')+'<div style="padding:6px 0">'+kv('台本行',h(m.line))+kv('タイムライン',h(tlText(m)))+'</div></div>';}
  return '<div class="pn l" style="width:240px">'+ph('ビン')+'<div class="scroll">'+bins+'</div></div>'+
  '<div class="pc" data-drop><div class="row" style="height:50px;flex:none;gap:10px;padding:0 12px;border-bottom:1px solid var(--dv)">'+
    '<input class="inp" type="search" placeholder="素材を検索" aria-label="素材を検索" value="'+h(S.mq)+'" data-in="mq" style="width:150px">'+
    '<select class="inp" aria-label="種別で絞り込み" data-in="mtype">'+[['','すべての種別'],['映像','映像'],['音声','音声'],['テイク','テイク'],['画像','画像'],['台本','台本']].map(function(o){return '<option value="'+o[0]+'"'+(S.mtype===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select>'+
    '<select class="inp" aria-label="並び順" data-in="msort">'+[['name','名前順'],['len','長い順'],['code','記号順']].map(function(o){return '<option value="'+o[0]+'"'+(S.msort===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select>'+
    '<span class="grow"></span><span class="seg">'+btn('リスト','mview','list',S.mview==='list'?'on':'')+btn('サムネイル','mview','thumb',S.mview==='thumb'?'on':'')+'</span>'+btn('＋ 読み込み','imp')+'</div>'+
    body+'<div class="row" style="height:44px;flex:none;gap:12px;padding:0 16px;border-top:1px solid var(--dv);background:var(--bg2)">'+foot+'</div></div>'+
  '<div class="pn r" style="width:320px">'+(right||ph('素材の詳細'))+'</div>';
};
}
