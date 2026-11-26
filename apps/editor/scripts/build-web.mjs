// dist-web/web.html の JavaScript と CSS を中に入れて、1つの HTML（リポジトリ直下の src/matsuko-editor.html）にする。
// このファイルは生成物。画面を変えるときは apps/editor/src/ui/ を直す
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist-web');
let html = readFileSync(join(dist, 'web.html'), 'utf8');
const read = (p) => readFileSync(join(dist, p.replace(/^\//, '')), 'utf8');
let css = '', js = '';
html = html.replace(/<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"[^>]*>\n?/g, (_, p) => { css += read(p); return ''; });
html = html.replace(/<script type="module"[^>]*src="(\/assets\/[^"]+\.js)"[^>]*><\/script>\n?/g, (_, p) => { js += read(p); return ''; });
if (!css || !js) throw new Error('dist-web/web.html から CSS か JavaScript を見つけられませんでした');
// Artifact と同じ形（<title> から始まる断片）にする
const head = html.slice(html.indexOf('<title>'), html.indexOf('</head>')).trim();
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).trim();
const safeJs = js.replaceAll('</script', '<\\/script');
const out = `${head}\n<!-- 生成物：apps/editor の npm run build:web で作る。直接編集しない（元は apps/editor/src/ui/） -->\n<style>\n${css}\n</style>\n${body}\n<script type="module">\n${safeJs}</script>\n`;
writeFileSync(join(root, '..', '..', 'src', 'matsuko-editor.html'), out);
console.log(`build-web: src/matsuko-editor.html（${Math.round(out.length / 1024)} KB）`);
