// 画面本体（src/ui/）から、デスクトップ版だけの機能を呼ぶための窓口（window.MatsukoHost）。
// 型は src-tauri/src/*.rs と合わせる。画面本体はブラウザ版と同じファイルなので、
// この窓口があるときだけデスクトップ版の動き（プロジェクトフォルダー・FFmpeg）になる。
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';

export interface EnvInfo {
  appVersion: string;
  os: string;
  arch: string;
  /** `ffmpeg -version` の1行目。同梱されていなければ null */
  ffmpeg: string | null;
  ffprobe: string | null;
}

/** 開いたプロジェクト */
export interface Opened {
  dir: string;
  name: string;
  /** project.json の中身（画面の P） */
  project: Record<string, unknown>;
  /** 見つからなかった素材の id */
  missing: string[];
}

export interface MediaInfo {
  kind: '映像' | '音声' | '画像';
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec: string;
  sampleRate: number;
  channels: number;
  needsProxy: boolean;
  /** プロキシを作る前でも、そのまま再生できそうか */
  playable: boolean;
  res: string;
}

export interface Probed {
  path: string;
  file: string;
  size: number;
  info: MediaInfo | null;
  error: string | null;
}

export interface JobReq {
  id: string;
  path: string;
  kind: string;
  duration: number;
  thumb?: boolean;
  peaks?: boolean;
  proxy?: boolean;
}

export interface JobEvent {
  id: string;
  kind: 'thumb' | 'peaks' | 'proxy';
  state: 'progress' | 'done' | 'error';
  p: number;
  data: Record<string, unknown> | null;
}

export interface Host {
  desktop: true;
  envInfo(): Promise<EnvInfo>;
  project: {
    /** 開いているプロジェクト（なければ null） */
    current: Opened | null;
    defaultLocation(): Promise<string>;
    pickLocation(): Promise<string | null>;
    create(name: string, parent: string | null, project: unknown): Promise<Opened>;
    openDialog(): Promise<Opened | null>;
    openLast(): Promise<Opened | null>;
    recent(): Promise<{ dir: string; name: string }[]>;
    openRecent(dir: string): Promise<Opened>;
    save(project: unknown): Promise<void>;
  };
  media: {
    pick(multiple: boolean): Promise<string[]>;
    probe(paths: string[]): Promise<Probed[]>;
    process(items: JobReq[]): Promise<void>;
    cancel(ids: string[]): Promise<void>;
    onJob(fn: (e: JobEvent) => void): Promise<UnlistenFn>;
    /** ファイルのパスを画面（video / img）から読める URL にする */
    url(path: string): string;
  };
  /** 書き出したファイルを、ダイアログで選んだ場所に保存する。やめたら false */
  saveFile(name: string, ext: string, data: Blob): Promise<boolean>;
  /** OS からのドラッグ：入った・動いた・離れた・落とした */
  onFileDrag(fn: (e: { type: 'over' | 'leave' | 'drop'; paths?: string[]; x?: number; y?: number }) => void): Promise<void>;
}

/** Linux では内蔵サーバーの URL の頭（WebKitGTK は asset: の動画を再生できないため）。ほかの OS では null */
let mediaBase: string | null = null;

/** 画面本体を読み込む前に呼ぶ */
export async function initHost(): Promise<void> {
  mediaBase = await invoke<string | null>('media_base').catch(() => null);
}

function keep(o: Opened): Opened {
  host.project.current = o;
  return o;
}

const host: Host = {
  desktop: true,
  envInfo: () => invoke<EnvInfo>('env_info'),
  project: {
    current: null,
    defaultLocation: () => invoke('project_default_location'),
    pickLocation: () => invoke('project_pick_location'),
    create: (name, parent, project) => invoke<Opened>('project_create', { name, parent, project }).then(keep),
    openDialog: () => invoke<Opened | null>('project_open_dialog').then((o) => (o ? keep(o) : null)),
    openLast: () => invoke<Opened | null>('project_last').then((o) => (o ? keep(o) : null)),
    recent: () => invoke('project_recent'),
    openRecent: (dir) => invoke<Opened>('project_open_recent', { dir }).then(keep),
    save: (project) => invoke('project_save', { project }),
  },
  media: {
    pick: (multiple) => invoke('media_pick', { multiple }),
    probe: (paths) => invoke('media_probe', { paths }),
    process: (items) => invoke('media_process', { items }),
    cancel: (ids) => invoke('media_cancel', { ids }),
    onJob: (fn) => listen<JobEvent>('media-job', (e) => fn(e.payload)),
    url: (path) => (mediaBase ? mediaBase + encodeURIComponent(path) : convertFileSrc(path)),
  },
  async saveFile(name, ext, data) {
    const path = await invoke<string | null>('save_pick', { name, ext });
    if (!path) return false;
    await invoke('save_write', new Uint8Array(await data.arrayBuffer()));
    return true;
  },
  async onFileDrag(fn) {
    // 落としたファイルは Rust が受けて "files-dropped" で知らせる（使ってよいファイルとして覚えてから）
    await listen<{ paths: string[]; x: number; y: number }>('files-dropped', (e) => fn({ type: 'drop', ...e.payload }));
    await getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === 'enter' || p.type === 'over') fn({ type: 'over', x: p.position.x, y: p.position.y });
      else if (p.type === 'leave') fn({ type: 'leave' });
    });
  },
};

export { host, isTauri };
