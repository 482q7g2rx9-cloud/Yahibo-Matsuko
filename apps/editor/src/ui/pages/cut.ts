// @ts-nocheck
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { D } from '../data';
import { C, M, P, T, cLen, v1Clips } from '../project';
import { S, TOTAL } from '../state';
import { A, btn, chip, filmStyle, h, ibtn, mmss, ph, playBtn, tabs, tc, transport, waveOf } from '../util';
import { SRC } from '../source';
import { primary } from '../editOps';
import { R, mthumb } from './media';
import { silPanel } from './edit';
import { cutRow, excerpt, linksOfRow, nums, rowsOfScene, sceneMedia, scenesSorted } from '../scriptLink';

/* ---- カット ---- */
export function roughStrip(){var L=v1Clips(),sum=L.reduce(function(a,c){return a+cLen(c);},0)||1;
  if(!L.length)return '<div class="mu" style="padding:22px 0">まだカットがありません</div>';
  return '<div style="display:flex;gap:2px" data-rough>'+L.map(function(c,i){var x=M(c.m)||{n:'（削除された素材）'},on=S.sel.indexOf(c.id)>=0;
    return '<div class="li" role="button" tabindex="0" data-rc="'+c.id+'"'+A('rsel',c.id)+' title="'+h(x.n)+'　'+tc(c.start)+'から" style="width:'+(cLen(c)/sum*100).toFixed(2)+'%;min-width:24px;height:78px;position:relative;background:'+(on?'#bfe9f8':'#8fd3ee')+';border:1px solid rgba(0,0,0,.35);border-radius:3px;'+(on?'box-shadow:0 0 0 2px var(--wt);':'')+'overflow:hidden"><div style="height:20px;padding:0 6px;line-height:20px;color:#06222f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><b style="margin-right:6px;font-weight:500">'+(i+1)+'</b>'+h(x.n)+'　'+mmss(cLen(c))+'</div><div style="position:absolute;left:0;right:0;top:20px;bottom:0;'+filmStyle(x)+'"></div></div>';}).join('')+'</div>';}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
R.cut=function(){
  var left,vids=P.media.filter(function(m){return m.k==='映像'||m.k==='画像';});
  if(S.ctab==='board'&&P.script)left=boardFromScript();
  else if(S.ctab==='board')left='<div class="scroll" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px"><div>台本がまだありません</div>'+btn('台本の連携ファイルを読み込む…','scrPick','','pri')+'</div>';
  else{var cnt=function(k){return vids.filter(function(m){return k==='all'||(m.rate||'未確認')===k;}).length;};
    left=tabs([['all','すべて '+cnt('all')],['未確認','未確認 '+cnt('未確認')],['採用','採用 '+cnt('採用')],['不採用','不採用 '+cnt('不採用')]],S.cflt,'cflt','評価で絞り込み')+'<div class="scroll">'+
    vids.filter(function(m){return S.cflt==='all'||(m.rate||'未確認')===S.cflt;}).map(function(m){var rt=m.rate||'未確認',c={'採用':'c-ok','保留':'c-wn','不採用':'c-er'}[rt]||'c-mu';return '<div class="li'+(S.src===m.id?' selr':'')+'" role="button" tabindex="0"'+A('csrc',m.id)+' style="display:grid;grid-template-columns:64px 1fr;gap:12px;align-items:center;height:60px;padding:0 16px;border-bottom:1px solid var(--dv)">'+mthumb(m,64,36)+
      '<div style="display:flex;flex-direction:column;gap:6px"><span style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+h(m.n)+'</span><span class="row" style="gap:8px"><span class="mu">'+(m.k==='画像'?'画像':mmss(m.d))+'</span>'+chip(rt,c)+'</span></div></div>';}).join('')+
    (vids.length?'':'<div class="mu" style="padding:20px 14px">映像の素材がありません</div>')+'</div>';}
  var m=M(S.src)||vids[0],main='';
  if(!m)main=ph('ソース')+'<div class="mon" style="height:calc(240px + var(--xh,0px)*.5);color:#9a9a9a">素材を選んでください</div>';
  else{var C2=D.clip,isMain=m.id==='v03'&&m.sample,img=m.k==='画像',tot=img?5:(m.d||60);TOTAL.cut=tot;S.t.cut=Math.min(S.t.cut,tot);
    var inP=m.inP!=null?m.inP:0,outP=m.outP!=null?Math.min(m.outP,tot):tot;if(img){inP=0;outP=5;}
    var step=tot>600?120:tot>240?60:tot>60?30:tot>20?5:1,labels='';for(var i=0;i*step<=tot;i++)labels+='<div style="position:absolute;left:'+(i*step/tot*100)+'%;top:0;height:22px;border-left:1px solid var(--mu);padding-left:4px;color:var(--tx2);white-space:nowrap">'+mmss(i*step)+'</div>';
    var marks='<div style="position:absolute;left:'+(inP/tot*100)+'%;width:'+((outP-inP)/tot*100)+'%;top:44px;height:56px;border-left:2px solid var(--ac);border-right:2px solid var(--ac);background:rgba(255,255,255,.14);pointer-events:none"></div>'+
      '<div style="position:absolute;left:'+(inP/tot*100)+'%;top:28px;width:16px;height:16px;border-radius:3px 3px 0 0;background:var(--ac);color:#fff;font-size:10px;font-weight:500;display:flex;align-items:center;justify-content:center;pointer-events:none">I</div><div style="position:absolute;left:calc('+(outP/tot*100)+'% - 16px);top:28px;width:16px;height:16px;border-radius:3px 3px 0 0;background:var(--ac);color:#fff;font-size:10px;font-weight:500;display:flex;align-items:center;justify-content:center;pointer-events:none">O</div>';
    if(isMain)marks+=C2.marks.map(function(k){return '<div style="position:absolute;left:'+k.l+'%;width:'+k.w+'%;top:44px;height:56px;background:repeating-linear-gradient(135deg,rgba(230,60,60,.75) 0 3px,transparent 3px 7px);opacity:'+(k.done?1:.75)+';pointer-events:none"></div><div style="position:absolute;left:'+k.l+'%;top:22px;padding:1px 6px;border-radius:3px;background:var(--erb);color:var(--er);font-weight:500;white-space:nowrap">'+h(k.k)+'</div>';}).join('');
    else if(m.marks)marks+=m.marks.map(function(k){var l=k.a/tot*100,w=(k.b-k.a)/tot*100;return '<div style="position:absolute;left:'+l+'%;width:'+w+'%;top:44px;height:56px;background:repeating-linear-gradient(135deg,rgba(230,60,60,.8) 0 3px,transparent 3px 7px);opacity:'+(k.done?1:.5)+';pointer-events:none"></div>'+(w>=4?'<div style="position:absolute;left:'+l+'%;top:22px;padding:1px 6px;border-radius:3px;background:var(--erb);color:var(--er);font-weight:500;white-space:nowrap;pointer-events:none">無音</div>':'');}).join('');
    var mon=m.url&&m.k==='映像'?'<div data-srcbox style="height:calc(214px + var(--xh,0px)*.5);width:auto;aspect-ratio:16/9;max-width:100%;object-fit:contain;background:#000"></div>':m.thumb?'<img src="'+m.thumb+'" alt="" style="height:calc(214px + var(--xh,0px)*.5);width:auto;aspect-ratio:16/9;max-width:100%;object-fit:contain">':'<div class="frame" style="height:calc(214px + var(--xh,0px)*.5);width:auto;aspect-ratio:16/9;max-width:100%;background:'+(m.col?m.col[0]:'#333')+'">'+(m.sample?'<span style="color:rgba(255,255,255,.7)">'+h(m.n)+'（見本）</span>':'')+'</div>';
    var p=primary(),onV1=p&&p.tr==='V1',vi=onV1?v1Clips().indexOf(p):-1;
    main=ph('ソース　'+h(m.n),'<span class="x">IN '+tc(inP)+'　OUT '+tc(outP)+'　長さ '+mmss(outP-inP)+'</span>'+assignBtn(m))+
    '<div class="mon" style="height:calc(240px + var(--xh,0px)*.5)">'+mon+'</div>'+
    transport('cut',ibtn('back','1フレーム戻る','sfb')+playBtn(SRC.playing)+ibtn('fwd','1フレーム進む','sff'),'全長 '+mmss(tot))+
    '<div style="height:116px;flex:none;padding:12px 16px 0;background:var(--bg0);border-bottom:1px solid var(--dv)"><div style="position:relative;height:100%;cursor:pointer" data-scrub="cut"><div style="position:relative;height:22px">'+labels+'</div>'+
      '<div style="position:absolute;left:0;right:0;top:44px;height:56px;background:#2f78b7;border:1px solid #8cc4ee;overflow:hidden">'+(img?'':waveOf(m,0,tot,150))+'</div>'+marks+
      '<div data-head="cut" style="position:absolute;left:'+(S.t.cut/tot*100)+'%;top:28px;height:72px;width:1px;background:var(--tx);pointer-events:none"></div></div></div>'+
    '<div class="row" style="height:48px;flex:none;gap:8px;padding:0 16px;border-bottom:1px solid var(--dv)">'+btn('イン点','setIn','','','イン点（I キー）')+btn('アウト点','setOut','','','アウト点（O キー）')+'<span class="vsep"></span>'+btn('不要部分を削除','delAll')+btn('無音を検出','detect')+'<span class="grow"></span>'+btn('仮編集へ追加（挿入）','cutIns','','on')+btn('上書き','cutOvr')+'</div>'+
    ph('仮編集（ラフカット）＝ V1','<span class="x">合計 '+mmss(v1Clips().reduce(function(a,c){return a+cLen(c);},0))+'　'+v1Clips().length+'カット</span>'+(onV1?btn('選択したカットを削除','rdel','','s'):''))+
    '<div style="flex:1;min-height:0;padding:14px;background:var(--bg0);overflow:auto">'+roughStrip()+
    '</div>';}
  var right='';
  if(m){var isM=m.id==='v03'&&m.sample,rate=m.rate||'未確認',stars=isM?4:(rate==='採用'?3:rate==='保留'?2:0),C3=D.clip;
    right='<div class="blk"><div class="cap">評価</div><div class="seg" style="margin-bottom:10px">'+['採用','保留','不採用'].map(function(k){var on=rate===k,c={'採用':'ok','保留':'wn','不採用':'er'}[k];return '<button class="b" style="flex:1;height:32px'+(on?';background:var(--'+c+'b);color:var(--'+c+');border-color:var(--'+c+')':'')+'" aria-pressed="'+on+'"'+A('rate',k)+'>'+k+'</button>';}).join('')+'</div>'+
      '<div style="color:var(--wn);font-size:16px;letter-spacing:4px" aria-label="評価 星'+stars+'">'+'★★★★★'.slice(0,stars)+'<span style="color:var(--bd)">'+'★★★★★'.slice(stars)+'</span></div></div>'+
    '<div class="blk"><div class="cap">タグ</div><div class="row" style="gap:6px;flex-wrap:wrap">'+(isM?C3.tags.map(function(t){return '<span class="chip c-in" style="padding:5px 10px">'+h(t)+'</span>';}).join(''):'')+btn('＋ 追加','todo','','s dash')+'</div></div>'+
    (isM?'<div class="blk"><div class="cap">不要部分</div>'+C3.marks.map(function(k,i){return '<div style="display:grid;grid-template-columns:1fr 60px 64px;gap:8px;align-items:center;height:40px;border-bottom:1px solid var(--dv)"><span>'+k.a+'　<span class="mu">'+k.k+'</span></span>'+(k.done?'<span class="t-ok">削除済み</span>':'<span class="t-wn">未処理</span>')+btn(k.done?'復元':'削除','mark',i)+'</div>';}).join('')+'</div>'+
      (P.script?sceneRowsBlk():'<div class="blk"><div class="cap">台本行</div><div style="line-height:1.7"><span class="t-lb">'+C3.line[0]+'</span><br>'+C3.line[1]+'</div></div>'):silPanel(m)+(P.script?sceneRowsBlk():'<div class="blk"><div class="cap">台本行</div><div class="t-lb">'+h(m.line)+'</div></div>'))+
    '<div style="padding:12px 16px 14px"><div class="cap">メモ</div><textarea class="inp" aria-label="メモ" data-in="memo" style="width:100%;height:64px;padding:8px 10px;resize:vertical">'+h(m.memo!=null?m.memo:(isM?C3.memo:''))+'</textarea></div>';}
  return '<div class="pn l" style="width:290px">'+tabs([['media','素材の選別'],['board','絵コンテ']],S.ctab,'ctab','左パネル')+'<div style="display:flex;flex-direction:column;flex:1;min-height:0">'+left+'</div></div>'+
  '<div class="pc">'+main+'</div>'+
  '<div class="pn r" style="width:320px">'+ph('選択クリップの情報')+'<div class="scroll">'+right+'</div></div>';
};
}

/* 絵コンテ（台本連携）：取り込んだ台本のシーン。割り当てた素材のサムネイルと、行の数・カットのある行の数 */
function boardFromScript(){var s=P.script,sm=sceneMedia();
  return '<div class="row" style="height:56px;flex:none;gap:8px;padding:0 16px;border-bottom:1px solid var(--dv)"><div class="grow" style="line-height:1.5;min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+h(s.title||'台本')+'</div><div class="mu">書き出し #'+s.exportSeq+'　取り込み '+h(new Date(s.importedAt).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}))+'</div></div>'+
    (S.scrNotice?'<span class="chip c-wn">更新あり</span>':'')+btn('取り込む','scrImport','','s'+(S.scrNotice?' pri':''))+'</div><div class="scroll">'+
    scenesSorted().map(function(sc,i){var m=sm[sc.id]&&M(sm[sc.id]),rs=rowsOfScene(sc.id),done=rs.filter(function(r){return linksOfRow(r.id).length;}).length;
      return '<div class="li'+(S.scene===sc.id?' selr':'')+'" role="button" tabindex="0"'+A('scene',sc.id)+' style="display:grid;grid-template-columns:96px 1fr;gap:12px;align-items:center;min-height:82px;padding:8px 16px;border-bottom:1px solid var(--dv)">'+
        (m?mthumb(m,96,54):'<div style="width:96px;height:54px;border:1px solid var(--dv);border-radius:4px;background:var(--bg0)"></div>')+
        '<div style="display:flex;flex-direction:column;gap:5px;min-width:0"><span style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b style="font-weight:500;color:var(--lb)">S'+(i+1)+'</b>　'+h(sc.title||'')+'</span><span class="mu" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+h(sc.time||'')+(sc.note?'　'+h(sc.note):'')+'</span>'+
        '<span class="row" style="gap:6px;flex-wrap:wrap">'+(m?chip('素材 '+(m.c||m.n),'c-ok'):chip('素材 未割り当て','c-wn'))+(rs.length?chip('カット '+done+' / '+rs.length+' 行',done===rs.length?'c-ok':'c-mu'):'')+'</span></div></div>';}).join('')+'</div>';}
/* ソースの見出し：選んでいるシーンに、この素材を割り当てる */
function assignBtn(m){if(!P.script||!S.scene)return '';var sc=P.script.scenes.filter(function(x){return x.id===S.scene;})[0];if(!sc)return '';var cur=sceneMedia()[sc.id];
  return cur===m.id?btn('割り当てを外す','sceneUnassign','','s'):btn((sc.title||'シーン')+' に割り当て','sceneAssign','','s');}
/* 右：選んでいるシーンの台本行。カットを作る行（仮編集へ追加したクリップを紐づける行）を選ぶ */
function sceneRowsBlk(){var sc=S.scene&&P.script.scenes.filter(function(x){return x.id===S.scene;})[0];
  if(!sc)return '<div class="blk"><div class="cap">台本行</div><div class="mu">なし</div></div>';
  var rs=rowsOfScene(sc.id),cur=cutRow(),nn=nums();
  return '<div class="blk"><div class="cap">台本行（'+h(sc.title||'')+'）</div>'+(rs.length?rs.map(function(r){var n=linksOfRow(r.id).filter(function(l){var c=C(l.clipId),t=c&&T(c.tr);return t&&t.kind==='v';}).length,on=r.id===cur;
    return '<button class="crw'+(on?' on':'')+'" aria-pressed="'+on+'"'+A('cutRow',r.id)+'><span class="t-lb" style="flex:none">'+h(nn[r.id]||'')+'</span><span class="grow" style="min-width:0;text-align:left">'+h(excerpt(r.body||r.video,40))+'</span>'+(n?'<span class="chip c-ok" style="flex:none">カット '+n+'</span>':'')+'</button>';}).join(''):'<div class="mu">なし</div>')+'</div>';}
