// デスクトップ版の入り口。画面本体（src/ui/）はブラウザ版と共通
import '@fontsource-variable/noto-sans-jp/wght.css';
// テロップで選べるフォント（src/ui/titleStyles.ts の TITLE_FONTS）。学校の PC がネットにつながっていなくても使えるよう同梱する
import '@fontsource/noto-serif-jp/700.css';
import '@fontsource/m-plus-rounded-1c/800.css';
import '@fontsource/dela-gothic-one/400.css';
import '@fontsource/mochiy-pop-one/400.css';
import '@fontsource/yusei-magic/400.css';
import '@fontsource/dotgothic16/400.css';
import './ui/styles.css';
import { host, initHost, isTauri, type Host } from './host';

declare global {
  interface Window {
    /** 画面本体から、デスクトップ版だけの機能を呼ぶための窓口 */
    MatsukoHost?: Host;
  }
}

// 画面本体は読み込んだときに窓口を確かめるので、窓口を用意してから読み込む
async function start(): Promise<void> {
  if (isTauri()) {
    await initHost();
    window.MatsukoHost = host;
  }
  await import('./ui/main');
}
void start();
