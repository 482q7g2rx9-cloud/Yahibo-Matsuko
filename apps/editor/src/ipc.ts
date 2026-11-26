// Rust（src-tauri）への命令。型は src-tauri/src/commands.rs と合わせる（M1 で tauri-specta による自動生成に切り替える）
import { invoke, isTauri } from '@tauri-apps/api/core';

export interface EnvInfo {
  appVersion: string;
  os: string;
  arch: string;
  /** `ffmpeg -version` の1行目。同梱されていなければ null */
  ffmpeg: string | null;
  ffprobe: string | null;
}

export const envInfo = (): Promise<EnvInfo> => invoke<EnvInfo>('env_info');
export { isTauri };
