// 8分の番組を再生して、途切れ（映像が間に合わない・描く間隔が空く）を数える（ブラウザ版）。
//   使い方: node tests/playback.mjs <HTML ファイル> <素材フォルダー> [再生する秒数（既定 480）]
// 素材フォルダーには src1〜4.mp4（720p・2分半。プロキシと同じくらいの重さ）と bgm.m4a（8分）を置く。
// 番組：V1 に 5 秒ずつのカット 96 個（音声は A1 にリンク）、A2 に BGM、V2 に 30 秒ごとのテロップ、V3 に調整レイヤー。
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const [html, mediaDir, secArg] = process.argv.slice(2);
const seconds = +(secArg || 480);
const dir = mkdtempSync(join(tmpdir(), 'matsuko-play-'));
const file = join(dir, 'index.html');
writeFileSync(file, '<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body>' + readFileSync(html, 'utf8'));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto('file://' + file);
await p.waitForTimeout(500);
await p.keyboard.press('Alt+1');
await p.setInputFiles('#fileIn', ['src1.mp4', 'src2.mp4', 'src3.mp4', 'src4.mp4', 'bgm.m4a'].map((f) => join(mediaDir, f)));
await p.waitForFunction(() => window.__matsuko.P().media.filter((m) => m.file && !m.loading && m.d > 0).length === 5, null, { timeout: 120000 });

// 番組を組み立てる
await p.evaluate(() => {
  const G = window.__matsuko, P = G.P();
  const vids = P.media.filter((m) => m.file && m.k === '映像'), bgm = P.media.find((m) => m.file && m.k === '音声');
  const clips = [];
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 96; i++) {
    const m = vids[i % vids.length], a = Math.round(rnd() * 140 * 10) / 10, L = 'L' + i;
    clips.push({ id: 'v' + i, tr: 'V1', type: 'media', m: m.id, start: i * 5, in: a, out: a + 5, link: L });
    clips.push({ id: 'a' + i, tr: 'A1', type: 'media', m: m.id, start: i * 5, in: a, out: a + 5, link: L, vol: -12 });
  }
  clips.push({ id: 'bgm', tr: 'A2', type: 'media', m: bgm.id, start: 0, in: 0, out: 480, vol: -18 });
  for (let t = 0; t < 480; t += 30) clips.push({ id: 't' + t, tr: 'V2', type: 'title', start: t + 2, in: 0, out: 4, st: t % 60 ? 'sub' : 'q', sz: '中', label: 'テロップ ' + t });
  clips.push({ id: 'adj', tr: 'V3', type: 'adj', start: 0, in: 0, out: 480, label: '調整レイヤー（色補正）' });
  G.setP({ v: 2, sample: 0, media: P.media.filter((m) => m.file), tracks: P.tracks, clips });
  G.changed();
});
await p.keyboard.press('Alt+4');
await p.waitForTimeout(1500);
await p.keyboard.press('Home');
await p.waitForTimeout(800);
await p.keyboard.press('Space');
const t0 = Date.now();
const samples = [];
while (Date.now() - t0 < seconds * 1000) {
  await p.waitForTimeout(Math.min(30000, seconds * 1000 - (Date.now() - t0) + 50));
  const s = await p.evaluate(() => ({ ...window.__matsuko.E.stats, playing: window.__matsuko.E.playing }));
  samples.push(s);
  console.log(`${Math.round((Date.now() - t0) / 1000)}秒: 描画 ${s.frames}回（${(s.frames / ((Date.now() - t0) / 1000)).toFixed(1)} fps）・映像が間に合わない ${s.blank}・止まった映像 ${s.stale}・遅れ ${s.late}・50ms 超の間隔 ${s.slow}・最大の間隔 ${Math.round(s.maxGap)}ms`);
  if (!s.playing) break;
}
const s = samples[samples.length - 1];
await p.screenshot({ path: join(dir, 'playback.png') });
await browser.close();
const result = { seconds: Math.round((Date.now() - t0) / 1000), fps: +(s.frames / ((Date.now() - t0) / 1000)).toFixed(1), blankPct: +((s.blank / Math.max(1, s.vframes)) * 100).toFixed(2), stalePct: +((s.stale / Math.max(1, s.vframes)) * 100).toFixed(2), latePct: +((s.late / Math.max(1, s.vframes)) * 100).toFixed(2), slow: s.slow, maxGap: Math.round(s.maxGap), errors };
console.log('結果', JSON.stringify(result), '画面', join(dir, 'playback.png'));
console.log('記録（最初の40件）', s.at.join(' '));
