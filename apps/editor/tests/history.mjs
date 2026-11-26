// 変更履歴・復元の確かめ（ブラウザ版）。
//   使い方: node tests/history.mjs <HTML ファイル>
// 時計を進めながら編集し、一覧に写しが並ぶこと・復元できること・Ctrl+Z で戻せることを確かめる。
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const [html] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'matsuko-hist-'));
const file = join(dir, 'index.html');
writeFileSync(file, '<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body>' + readFileSync(html, 'utf8'));

let failed = 0;
const check = (label, ok, got) => { console.log((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : '  → ' + JSON.stringify(got))); if (!ok) failed++; };

const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1280, height: 828 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
// 時計を進められるようにする（window.__shift ミリ秒だけ先に進める）
await p.addInitScript(() => {
  const now = Date.now.bind(Date);
  window.__shift = 0;
  Date.now = () => now() + window.__shift;
});
await p.goto('file://' + file);
await p.waitForTimeout(500);
const clips = () => p.evaluate(() => [...document.querySelectorAll('.tl2 [data-c]')].map((e) => e.dataset.c).sort().join(','));
const del = async (id) => { const b = await (await p.$(`[data-c="${id}"]`)).boundingBox(); await p.mouse.click(b.x + 10, b.y + 20); await p.keyboard.press('Delete'); await p.waitForTimeout(600); };

await p.keyboard.press('Alt+4');
const start = await clips();
await del('c2');                       // 1回目の編集：写し 1（自動）
const afterFirst = await clips();
await p.evaluate(() => { window.__shift += 60_000; });
await del('c4');                       // 1分後：間隔が短いので残さない
await p.evaluate(() => { window.__shift += 120_000; });
await del('c1');                       // さらに2分後：写し 2（自動）
const now = await clips();

await p.click('#mb >> text=プロジェクト'); await p.click('#dd >> text=変更履歴・復元…');
await p.waitForTimeout(400);
const rows = await p.evaluate(() => [...document.querySelectorAll('.hlist .hsnap')].map((r) => r.innerText.replace(/\s+/g, ' ')));
check('写しは2件（間隔が短いものは残さない）', rows.length === 2, rows);
check('新しい順・自動', rows.every((r) => r.includes('自動')) && /今日/.test(rows[0]), rows);
await p.screenshot({ path: join(dir, 'history.png') });

// 古いほう（1回目の編集のあと）に戻す
await p.click('.hlist .hsnap:last-child [data-a="hRestore"]');
await p.waitForTimeout(200);
await p.click('[data-a="dlgOk"]');
await p.waitForTimeout(500);
check('復元するとタイムラインが写しの時点になる', (await clips()) === afterFirst, [await clips(), afterFirst]);
await p.keyboard.press('Control+z');
await p.waitForTimeout(300);
check('Ctrl+Z で復元の前に戻る', (await clips()) === now, [await clips(), now]);

await p.click('#mb >> text=プロジェクト'); await p.click('#dd >> text=変更履歴・復元…');
await p.waitForTimeout(400);
const rows2 = await p.evaluate(() => [...document.querySelectorAll('.hlist .hsnap')].map((r) => r.innerText.replace(/\s+/g, ' ')));
check('「復元する前」の写しが増える', rows2.length === 3 && rows2[0].includes('復元する前'), rows2);
await p.keyboard.press('Escape');

// 開き直すと「開いたとき」の写しが残る
await p.reload();
await p.waitForTimeout(800);
await p.click('#mb >> text=プロジェクト'); await p.click('#dd >> text=変更履歴・復元…');
await p.waitForTimeout(400);
const rows3 = await p.evaluate(() => [...document.querySelectorAll('.hlist .hsnap')].map((r) => r.innerText.replace(/\s+/g, ' ')));
check('開き直すと「開いたとき」が増える', rows3.length === 4 && rows3.some((r) => r.includes('開いたとき')), rows3);
check('編集前と違う状態から始めている', start !== afterFirst, start);
check('エラーなし', errors.length === 0, errors);
await browser.close();
console.log(failed ? `history: ${failed} 件 失敗（画面：${join(dir, 'history.png')}）` : `history: すべて成功（画面：${join(dir, 'history.png')}）`);
process.exit(failed ? 1 : 0);
