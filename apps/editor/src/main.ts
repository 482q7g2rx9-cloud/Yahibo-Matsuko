// デスクトップ版の入り口。画面本体（src/legacy/app.js）はブラウザ版から生成する。
import './legacy/fonts.css';
import './legacy/styles.css';
import { envInfo, isTauri } from './ipc';

declare global {
  interface Window {
    /** 画面本体から、デスクトップ版だけの機能を呼ぶための窓口 */
    MatsukoHost?: { envInfo: typeof envInfo };
  }
}

if (isTauri()) window.MatsukoHost = { envInfo };

// 画面本体は即時実行の関数なので、窓口を用意してから読み込む
void import('./legacy/app.js');
