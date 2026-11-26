// デスクトップ版の入り口。画面本体（src/legacy/app.js）はブラウザ版から生成する。
import './legacy/fonts.css';
import './legacy/styles.css';
import { host, initHost, isTauri, type Host } from './host';

declare global {
  interface Window {
    /** 画面本体から、デスクトップ版だけの機能を呼ぶための窓口 */
    MatsukoHost?: Host;
  }
}

// 画面本体は即時実行の関数なので、窓口を用意してから読み込む
async function start(): Promise<void> {
  if (isTauri()) {
    await initHost();
    window.MatsukoHost = host;
  }
  await import('./legacy/app.js');
}
void start();
