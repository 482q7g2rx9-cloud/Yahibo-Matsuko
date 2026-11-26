// 画面の操作をひととおり行い、結果（タイムライン・各ページの文字・保存した内容）を記録する。
// 画面のコードを作り替えたとき、前と後で記録が同じになることを確かめる（回帰テスト）。
//   使い方: node tests/tour.mjs <HTML ファイル> <記録の出力先> [素材フォルダー]
// 素材フォルダー（既定は tests/media）には test1.mp4（映像・音声あり）、bgm.wav、talk.webm（話し声と無音）を置く。
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Playwright は、この環境に入っているもの（NODE_PATH）を使う
const { chromium } = createRequire(import.meta.url)('playwright');

const [html, out, mediaDir = resolve('tests/media')] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'matsuko-tour-'));
const page0 = join(dir, 'index.html');
writeFileSync(page0, '<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body>' + readFileSync(html, 'utf8'));

const log = [];
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 828 } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
// 乱数による違いをなくす
await p.addInitScript(() => {
  let seed = 1;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
});
await p.goto('file://' + page0);
await p.waitForTimeout(500);

const idn = (s) => s.replace(/[0-9a-z]{8,}/g, '#');
const tl = () => p.evaluate(() => [...document.querySelectorAll('.tl2 [data-c]')].map((e) => [e.dataset.c, e.className.replace(/\s+/g, ' '), e.style.left, e.style.top, e.style.width]));
const text = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.innerText.replace(/\s+/g, ' ')), sel);
const rec = async (label, v) => log.push(label + ' ' + idn(JSON.stringify(v)).replace(/\d\d:\d\d(?=["\s])/g, 'hh:mm'));
const step = async (label) => { await p.waitForTimeout(120); await rec(label + ' tl', await tl()); await rec(label + ' sel', await text('.tl2 .ci.on')); };
const key = async (k) => { await p.keyboard.press(k); await p.waitForTimeout(60); };
const box = async (sel) => (await p.$(sel)).boundingBox();

// 1. 各ページ（見本プロジェクト）
for (let i = 1; i <= 7; i++) {
  await key('Alt+' + i);
  await rec('page' + i, await text('#page .ph, #page .kv, #page .mt.r, #page .tabs'));
}
// 2. 編集：選択・分割・削除・元に戻す・コピー・貼り付け・移動・トリミング
await key('Alt+4');
await step('edit start');
const c2 = await box('[data-c="c2"]');
await p.mouse.click(c2.x + 20, c2.y + 30); await step('select c2');
await p.mouse.click(c2.x + c2.width / 2, c2.y + 30);
await p.click('[data-rul]', { position: { x: Math.round(c2.x + c2.width / 2 - (await box('[data-rul]')).x), y: 10 } });
await key('s'); await step('split');
await key('Delete'); await step('delete');
await key('Control+z'); await step('undo');
await key('Control+y'); await step('redo');
await key('Control+z');
const c1 = await box('[data-c="c1"]');
await p.mouse.click(c1.x + 20, c1.y + 30); await key('Control+c'); await key('End'); await key('Control+v'); await step('paste');
await key('Shift+Delete'); await step('ripple delete');
let c3 = await box('[data-c="c3"]');
await p.mouse.move(c3.x + 40, c3.y + 30); await p.mouse.down(); await p.mouse.move(c3.x + 120, c3.y + 30, { steps: 6 }); await p.mouse.up(); await step('move c3');
c3 = await box('[data-c="c3"]');
await p.mouse.move(c3.x + c3.width - 2, c3.y + 30); await p.mouse.down(); await p.mouse.move(c3.x + c3.width - 50, c3.y + 30, { steps: 5 }); await p.mouse.up(); await step('trim c3');
c3 = await box('[data-c="c3"]');
await p.mouse.move(c3.x + 40, c3.y + 30); await p.mouse.down(); await p.mouse.move(c3.x + 40, c3.y - 50, { steps: 6 }); await p.mouse.up(); await step('to V2');
await key('Control+a'); await step('select all');
await key('Escape');
// インスペクタ
const t1 = await p.$('[data-c="t1"]');
if (t1) { const b = await t1.boundingBox(); await p.mouse.click(b.x + 10, b.y + 8); await rec('title insp', await text('.pn.r .fs')); }
const c1b = await box('[data-c="c1"]');
await p.mouse.click(c1b.x + 20, c1b.y + 30);
await rec('clip insp', await text('.pn.r .fs'));
const up = await p.$('[data-a="cstep"][data-v$="|scale|1"]');
if (up) { await up.click(); await p.click('[data-a="cstep"][data-v$="|op|-1"]'); }
await rec('after steps', await text('.pn.r .pr'));
await step('after insp');
// 3. 素材の読み込み（ブラウザ版）
await key('Alt+1');
await p.setInputFiles('#fileIn', [join(mediaDir, 'test1.mp4'), join(mediaDir, 'bgm.wav'), join(mediaDir, 'talk.webm')]);
await p.waitForTimeout(3500);
await rec('media list', await text('.mt.r'));
// 4. カット：素材を選び、無音を検出して、すべて削除にしてから仮編集に追加する
await key('Alt+3');
const pick = await p.$('text=素材の選別');
if (pick) await pick.click();
await p.waitForTimeout(200);
await rec('cut sources', (await p.$$('[data-a="csrc"]')).length);
const talk = await p.$('[data-a="csrc"] >> text=talk');
if (talk) await talk.click();
await p.waitForTimeout(400);
const det = await p.$('[data-a="detect"]');
if (det) { await det.click(); await p.waitForTimeout(200); }
await rec('marks', await text('[data-a="smk"]'));
const markAll = await p.$('[data-a="delAll"]');
if (markAll) await markAll.click();
const ins = await p.$('[data-a="cutIns"]');
if (ins) { await ins.click(); await p.waitForTimeout(200); }
await rec('rough', await text('[data-rc]'));
await rec('cut page', await text('#page .ph'));
// 5. 出力ページ
await key('Alt+7');
await rec('export', await text('#page .kv, #page .card'));
// 6. 環境設定
await key('Control+,');
await rec('prefs', await text('.prefs .prow'));
await key('Escape');
// 7. 保存した内容（IndexedDB）
await p.waitForTimeout(800);
const saved = await p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('matsuko-editor', 1);
  r.onsuccess = () => {
    const g = r.result.transaction('kv').objectStore('kv').get('project');
    g.onsuccess = () => {
      const o = g.result;
      res(o && { media: o.media.map((m) => [m.n, m.k, Math.round(m.d), m.c, m.res]), clips: o.clips.map((c) => [c.tr, c.type, +c.start.toFixed(2), +c.in.toFixed(2), +c.out.toFixed(2)]) });
    };
  };
  r.onerror = () => res(null);
}));
await rec('saved', saved);
await rec('errors', errors);
await browser.close();
writeFileSync(out, log.join('\n') + '\n');
console.log(`tour: ${log.length} 件を記録（エラー ${errors.length} 件）→ ${out}`);
