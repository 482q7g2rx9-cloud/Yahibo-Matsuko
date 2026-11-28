// @ts-nocheck
import { ps } from './projectSettings';
import { syncNativeMenu } from './menus';
import { historyReset, historyTick } from './history';
// 画面本体（ブラウザ版から機械的に分けたもの）。型は少しずつ付けていく（docs/tauri-plan.md の M2）
import { C, M, P, emptyProject, migrate, setP, uid } from './project';
import { S } from './state';
import { queryLocalFontsIfGranted, setSystemFonts } from './titleStyles';
import { btn, h, hm } from './util';
import { saveP, saveTimer, setHIST, setREDO } from './store';
import { IMP, nextCode } from './importWeb';
import { E, clampProg, dropEl, redrawProg } from './engine';
import { SRC, stopAll } from './source';
import { draw, go, head } from './render';
import { resetProject, toast } from './menus';
import { ACT } from './actions';

/* ================================================================
   デスクトップ版（Tauri）：window.MatsukoHost があるときだけ使う。
   プロジェクトはフォルダー（project.json と cache/）に自動保存し、素材は元のファイルのパスで参照する。
   素材の解析・サムネイル・波形・プロキシは FFmpeg が裏で作り、"media-job" で進み具合が届く
   ================================================================ */
export var HOST;
export var JOBS;/* 素材id → {thumb:p, peaks:p, proxy:p}（動いている作業の進み具合） */
export var RECENT;
export function projName(){return HOST&&HOST.project.current?HOST.project.current.name:null;}
/* project.json に書く形。詳しい波形（wf）は大きいので、プロジェクトの cache/wave に置く（開くたびに読み直す） */
export function forDisk(){return JSON.parse(JSON.stringify(P,function(k,v){return k==='url'||k==='loading'||k==='wf'?undefined:v;}));}
/* プロジェクトがまだなければ「無題のプロジェクト」を書類フォルダーに作る（素材を読み込んだときなど） */
export function ensureProject(){if(!HOST)return Promise.resolve();if(HOST.project.current)return Promise.resolve(HOST.project.current);
  if(P.sample)resetProject(emptyProject());
  return HOST.project.create('無題のプロジェクト',null,forDisk()).then(function(o){historyReset();historyTick('open');S.savedAt=hm();head();refreshRecent();toast('プロジェクト「'+o.name+'」を作りました（書類 › Matsuko Editor）');return o;});}
export function saveNow(){if(!HOST||!HOST.project.current)return Promise.resolve(false);clearTimeout(saveTimer);
  return HOST.project.save(forDisk()).then(function(){S.savedAt=hm();var e=document.querySelector('[data-saved]');if(e)e.textContent='● 自動保存済み '+S.savedAt;return true;}).catch(function(e){toast('保存できませんでした：'+e);return false;});}
export function refreshRecent(){if(HOST)HOST.project.recent().then(function(r){RECENT=r||[];syncNativeMenu();}).catch(function(){});}
/* 素材のファイルを画面で読める URL にする：プロキシ → 元のファイル（そのまま再生できるとき） */
export function mediaUrl(m){if(!HOST||!m.file)return null;if(m.proxyPath)return HOST.media.url(m.proxyPath);if(!m.missing&&m.path&&m.pl!==0)return HOST.media.url(m.path);return null;}
/* 開いたプロジェクトを画面に入れる */
export function loadOpened(o){stopAll();Object.keys(E.els).forEach(dropEl);E.imgs={};JOBS={};
  var np=migrate(o.project);np.media.forEach(function(m){if(!m.file)return;m.px=m.np?(m.proxyPath?1:0):-1;m.url=mediaUrl(m);});
  setP(np);setHIST([]);setREDO([]);S.media=P.media[0]?P.media[0].id:null;S.src=(P.media.filter(function(m){return m.k==='映像';})[0]||{}).id||null;S.sel=[];S.t.edit=0;S.t.cut=0;S.bin='all';S.pps=null;S.tlx=S.tly=0;SRC.id=null;SRC.el=null;
  clampProg();S.savedAt=null;refreshRecent();draw();historyReset();historyTick('open');
  if(o.missing&&o.missing.length)toast(o.missing.length+'件の素材ファイルが見つかりません。メディアで「リンクし直す」を押してください');
  P.media.forEach(function(m){queueJobs(m);});}
/* 足りないもの（サムネイル・波形・プロキシ）を作ってもらう */
export function queueJobs(m,force){if(!HOST||!m.file||m.missing||!m.path||!HOST.project.current)return;
  var r={id:m.id,path:m.path,kind:m.k==='テイク'?'音声':m.k,duration:m.d||0,thumb:(m.k==='映像'||m.k==='画像')&&(force||!m.thumb),peaks:m.k!=='画像'&&!m.noAudio&&(force||!m.peaks||!m.wf),proxy:!!m.np&&(force||!m.proxyPath),proxyHeight:ps().proxy};
  if(!r.thumb&&!r.peaks&&!r.proxy)return;JOBS[m.id]=JOBS[m.id]||{};['thumb','peaks','proxy'].forEach(function(k){if(r[k])JOBS[m.id][k]=0;});
  HOST.media.process([r]).catch(function(e){delete JOBS[m.id];toast(String(e));});}
/* ファイルのパスから読み込む（ダイアログ・ドロップ） */
export function importPaths(paths){if(!paths||!paths.length)return;var have={};P.media.forEach(function(m){if(m.path)have[m.path]=m;});
  var dup=paths.filter(function(p){return have[p];});paths=paths.filter(function(p){return !have[p];});
  if(!paths.length){S.media=have[dup[0]].id;draw();return toast('すでに読み込んである素材です');}
  IMP.total+=paths.length;IMP.cur=paths[0].split(/[\\/]/).pop();draw();
  ensureProject().then(function(){return HOST.media.probe(paths);}).then(function(list){var added=[],bad=[];
    list.forEach(function(x){IMP.done++;var i=x.info;if(!i){bad.push(x.file+(x.error?'（'+x.error+'）':''));return;}var k=i.kind;
      var m={id:uid('m'),n:x.file.replace(/\.[^.]+$/,''),k:k,d:k==='画像'?0:i.duration,c:nextCode(k),r:'wn',sr:'—',f:x.file,path:x.path,size:x.size,res:i.res,np:i.needsProxy?1:0,pl:i.playable?1:0,px:i.needsProxy?0:-1,
        ho:'—',src:'読み込んだファイル',pm:'未入力',ex:'—',line:'—',rate:'未確認',file:1,col:['#3a4a5a','#2a3644'],added:hm()};
      if(k==='映像'){m.inP=0;m.outP=m.d;if(!i.hasAudio)m.noAudio=1;}
      m.url=mediaUrl(m);P.media.push(m);added.push(m);});
    IMP.total=IMP.done=0;
    if(bad.length)toast(bad.length+'件は読み込めませんでした：'+bad.slice(0,2).join('、'));
    if(added.length){S.media=added[0].id;S.bin='all';if(!bad.length)toast(added.length+'件を読み込みました。サムネイルや波形は裏で作ります');saveP();draw();added.forEach(function(m){queueJobs(m);});}else draw();
  }).catch(function(e){IMP.total=IMP.done=0;toast('読み込めませんでした：'+e);draw();});}
/* 作業の進み具合：作業中は該当の表示だけ書き換え、終わったら画面を描き直す（ドラッグや入力の邪魔をしない） */
export function jobText(m,short){var j=JOBS[m.id]||{};if(m.missing)return '<span class="t-wn">'+(short?'見つかりません':'ファイルが見つかりません')+'</span>';
  if(j.proxy!=null)return '<span class="t-ac">'+(short?'作成中 ':'プロキシ作成中 ')+Math.round(j.proxy*100)+'%</span>';if(j.thumb!=null||j.peaks!=null)return '<span class="t-ac">解析中</span>';return '';}
export function jobsFoot(){var ids=Object.keys(JOBS).filter(function(id){return M(id)&&Object.keys(JOBS[id]).length;});if(!ids.length)return '';
  var px=ids.filter(function(id){return JOBS[id].proxy!=null;}),cur=px[0]?M(px[0]):null;
  return '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px">'+(cur?'プロキシ作成中：'+h(cur.n):'サムネイルと波形を作成中')+'</span>'+(cur?'<div class="prog" style="width:140px;flex:none"><i data-jobbar style="width:'+Math.round(JOBS[cur.id].proxy*100)+'%"></i></div><span class="t-ac" data-jobpct>'+Math.round(JOBS[cur.id].proxy*100)+'%</span>':'')+
    '<span class="mu" style="white-space:nowrap">あと '+ids.length+'件</span><span class="grow"></span>';}
export var lateDraw;
export function drawWhenIdle(){if(lateDraw)return;lateDraw=setTimeout(function again(){var a=document.activeElement,busy=PDOWN||(a&&(a.tagName==='TEXTAREA'||(a.tagName==='INPUT'&&a.type!=='range'&&a.type!=='checkbox'))||a&&a.isContentEditable);
  if(busy){lateDraw=setTimeout(again,400);return;}lateDraw=0;draw();},120);}
export var PDOWN;
export function onJob(e){var m=M(e.id),j=JOBS[e.id]=JOBS[e.id]||{};if(!m){delete JOBS[e.id];return;}
  if(e.state==='progress'){j[e.kind]=e.p;if(e.kind==='proxy'){m.px=e.p;[].forEach.call(document.querySelectorAll('[data-pxt="'+m.id+'"]'),function(x){x.innerHTML=jobText(m,x.hasAttribute('data-short'));});
    var b=document.querySelector('[data-jobbar]'),t=document.querySelector('[data-jobpct]');if(b&&JOBS[e.id].proxy!=null){b.style.width=Math.round(e.p*100)+'%';if(t)t.textContent=Math.round(e.p*100)+'%';}}return;}
  delete j[e.kind];if(!Object.keys(j).length)delete JOBS[e.id];var d=e.data||{};
  if(e.state==='error'){if(e.kind==='proxy'){m.px=-2;toast('「'+m.n+'」のプロキシを作れませんでした。元のファイルで編集します');}else if(e.kind==='peaks'&&m.k==='映像')m.noAudio=1;drawWhenIdle();return;}
  if(e.kind==='thumb'){m.thumb=d.thumb;if(d.col)m.col=d.col;}
  else if(e.kind==='peaks'){if(d.peaks){m.peaks=d.peaks;if(d.wf)m.wf=d.wf;}else if(m.k==='映像')m.noAudio=1;}
  else if(e.kind==='proxy'){m.proxyPath=d.proxyPath;m.px=1;m.url=mediaUrl(m);delete E.imgs[m.id];redrawProg();}
  saveP();drawWhenIdle();}
/* 見つからない素材を、選んだファイルに付け替える */
export function relink(m){HOST.media.pick(false).then(function(p){if(!p||!p.length)return;return HOST.media.probe(p).then(function(r){var x=r[0],i=x&&x.info;if(!i)return toast('このファイルは読み込めません'+(x&&x.error?'：'+x.error:''));
    if(i.kind!==m.k)return toast('種類が違うファイルです（'+m.k+'の素材に'+i.kind+'は付け替えられません）');
    var warn=m.d&&i.duration&&Math.abs(i.duration-m.d)>0.5;
    m.path=x.path;m.f=x.file;m.size=x.size;m.res=i.res;m.np=i.needsProxy?1:0;m.pl=i.playable?1:0;delete m.missing;delete m.proxyPath;m.px=m.np?0:-1;m.url=mediaUrl(m);
    Object.keys(E.els).forEach(function(id){var c=C(id);if(c&&c.m===m.id)dropEl(id);});delete E.imgs[m.id];
    saveP();draw();queueJobs(m,true);toast(warn?'リンクし直しました。長さが元の素材と違うため、タイムラインのクリップを確かめてください':'リンクし直しました');});}).catch(function(e){toast(String(e));});}
/* 新規プロジェクト：名前と場所を決める */
export function newProjectDlg(){var d=document.getElementById('dlg'),loc=null;
  function render(def){d.innerHTML='<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlgT" style="width:480px"><h2 id="dlgT">新規プロジェクト</h2>'+
    '<div class="fg" style="grid-template-columns:72px 1fr"><span class="t2">名前</span><input class="inp" id="npName" value="無題のプロジェクト" aria-label="プロジェクトの名前"></div>'+
    '<div class="fg" style="grid-template-columns:72px 1fr auto"><span class="t2">場所</span><span class="mu" id="npLoc" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+h(loc||def)+'">'+h(loc||def)+'</span>'+btn('変更…','npLoc','','s')+'</div>'+
    '<div class="row" style="gap:8px;justify-content:flex-end">'+btn('キャンセル','dlgNo','','sec')+btn('作成','npOk','','pri')+'</div></div>';d.hidden=false;var i=d.querySelector('#npName');i.focus();i.select();
    i.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();ACT.npOk();}});}
  HOST.project.defaultLocation().then(function(def){newProjectDlg.def=def;render(def);});
  newProjectDlg.pick=function(){var name=d.querySelector('#npName').value;HOST.project.pickLocation().then(function(p){if(p){loc=p;newProjectDlg.loc=p;render(newProjectDlg.def);d.querySelector('#npName').value=name;}});};
  newProjectDlg.loc=null;}
export function createProject(){var d=document.getElementById('dlg'),name=(d.querySelector('#npName').value||'').trim()||'無題のプロジェクト';
  saveNow().then(function(){var np=emptyProject();return HOST.project.create(name,newProjectDlg.loc,np);}).then(function(o){d.hidden=true;loadOpened(o);go('media');toast('プロジェクト「'+o.name+'」を作りました');}).catch(function(e){toast(String(e));});}
export function openProject(fn){saveNow().then(fn).then(function(o){if(o){loadOpened(o);toast('「'+o.name+'」を開きました');}}).catch(function(e){toast(String(e));});}
export function fileItems(){var o=[['新規プロジェクト…','new'],['開く…','open']];
  if(HOST){var r=RECENT.filter(function(x){return !HOST.project.current||x.dir!==HOST.project.current.dir;}).slice(0,5);if(r.length){o.push('-',{h:'最近使ったプロジェクト'});r.forEach(function(x,i){o.push([h(x.name),'orec:'+i]);});}}
  else o=[['新規プロジェクト…','new']];
  return o.concat(['-',['見本プロジェクトを開く…','sample'],'-',['素材を読み込む…','imp'],['保存','save'],'-',['書き出し…','go:export'],'-',['環境設定…','prefs']]);}
/* ほかのモジュールから置き換えるための関数 */
export function setJOBS(v){JOBS=v;}

/* 読み込んだときの準備。元のファイルの順番を守るため、main.ts が順に呼ぶ */
export function init(){
HOST=window.MatsukoHost&&window.MatsukoHost.desktop?window.MatsukoHost:null;
JOBS={};
RECENT=[];
lateDraw=0;
PDOWN=false;
document.addEventListener('pointerdown',function(){PDOWN=true;},true);
addEventListener('pointerup',function(){PDOWN=false;},true);
addEventListener('pointercancel',function(){PDOWN=false;},true);
if(HOST){HOST.media.onJob(onJob);
  if(HOST.systemFonts)HOST.systemFonts().then(function(v){setSystemFonts(v||[]);if(S.page==='edit')draw();}).catch(function(){});
  HOST.onFileDrag(function(e){var ov=document.getElementById('drop');if(e.type==='over')ov.hidden=false;else if(e.type==='leave')ov.hidden=true;
    else{ov.hidden=true;importPaths(e.paths||[]);if(S.page!=='media'&&S.page!=='edit'&&S.page!=='cut')go('media');}});
  addEventListener('pagehide',function(){saveNow();});}
else queryLocalFontsIfGranted().then(function(ok){if(ok&&S.page==='edit')draw();});
}
