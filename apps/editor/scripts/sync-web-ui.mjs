// ブラウザ版（src/matsuko-editor.html）から、デスクトップ版の画面を作る。
// M2 で TypeScript のモジュールに移植するまでは、ブラウザ版を唯一の元にする。
// 出力（src/legacy/）は生成物なので Git には入れない。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, '..', '..', 'src', 'matsuko-editor.html');
const out = join(root, 'src', 'legacy');
mkdirSync(out, { recursive: true });

const html = readFileSync(src, 'utf8');
const pick = (open, close) => {
  const i = html.indexOf(open), j = html.indexOf(close, i);
  if (i < 0 || j < 0) throw new Error(`${src} に ${open} が見つかりません`);
  return html.slice(i + open.length, j);
};
const css = pick('<style>', '</style>');
const js = pick('<script>', '</script>');
writeFileSync(join(out, 'styles.css'), `/* 生成物：src/matsuko-editor.html から作成。直接編集しない */\n${css}`);
writeFileSync(join(out, "app.js"), `// 生成物：src/matsuko-editor.html から作成。直接編集しない\n${js}\nexport {};\n`);

// 同梱フォント：Fontsource の可変フォントを、画面が指定している名前「Noto Sans JP」で使えるようにする
const require = createRequire(import.meta.url);
const fontCss = require.resolve('@fontsource-variable/noto-sans-jp/wght.css');
const rel = relative(out, dirname(fontCss)).split('\\').join('/');
const fonts = readFileSync(fontCss, 'utf8')
  .replaceAll("'Noto Sans JP Variable'", "'Noto Sans JP'")
  .replaceAll('url(./files/', `url(${rel}/files/`);
writeFileSync(join(out, 'fonts.css'), `/* 生成物 */\n${fonts}`);
console.log('sync-ui: src/legacy を作成しました');
