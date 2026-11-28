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

/** PC に入っているフォント。family は canvas の font に入れる名前、name は画面に出す名前 */
export interface SysFont {
  family: string;
  name: string;
}

export interface Host {
  desktop: true;
  envInfo(): Promise<EnvInfo>;
  /** PC に入っているフォント（テロップで使う） */
  systemFonts(): Promise<SysFont[]>;
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
  /** 変更履歴（プロジェクトフォルダーの history.sqlite） */
  history: {
    add(at: number, kind: string, summary: string, project: unknown): Promise<number>;
    list(): Promise<{ id: number; at: number; kind: string; summary: string }[]>;
    get(id: number): Promise<unknown>;
    del(ids: number[]): Promise<void>;
  };
  /** macOS のメニューバー（ほかの OS では何もしない） */
  menu: {
    set(menus: unknown): Promise<boolean>;
    onAction(fn: (id: string) => void): Promise<UnlistenFn>;
  };
  /** 書き出し（FFmpeg） */
  export: {
    pick(name: string, ext: string): Promise<string | null>;
    start(req: Record<string, unknown>): Promise<void>;
    cancel(id: string): Promise<void>;
    onJob(fn: (e: { id: string; state: 'progress' | 'done' | 'error'; p: number; data: Record<string, unknown> | null }) => void): Promise<UnlistenFn>;
  };
  /** 台本連携：連携ファイル（○○.link.json）を選ぶ・読む・更新を見張る */
  script: {
    pick(): Promise<string | null>;
    read(path: string): Promise<string>;
    watch(path: string | null): Promise<void>;
    onChanged(fn: (path: string) => void): Promise<UnlistenFn>;
  };
  /** 色補正（M6）：LUT（.cube）を選ぶ・読む */
  color: {
    pickLut(): Promise<string | null>;
    readLut(path: string): Promise<string>;
  };
  /** 録音（M6）：マイクの音を WAV でプロジェクトフォルダーの「録音」に書く */
  rec: {
    devices(): Promise<{ name: string; default: boolean }[]>;
    /** 始める。書くファイルの場所を返す */
    start(device: string | null, name: string): Promise<string>;
    stop(): Promise<{ path: string; seconds: number }>;
    cancel(): Promise<void>;
    /** 音の大きさ（0〜1 のピーク）と、始めてからの秒 */
    onLevel(fn: (e: { l: number; r: number; t: number }) => void): Promise<UnlistenFn>;
  };
  /** トラッキング（M6）：素材の中の四角を追う。結果は onJob（data.pts：[素材の秒, 中心の横, 縦（割合）]、data.lost） */
  track: {
    start(req: { id: string; path: string; at: number; box: number[]; until: number; back: boolean; fps: number; ar: number }): Promise<void>;
    cancel(id: string): Promise<void>;
    onJob(fn: (e: { id: string; state: 'progress' | 'done' | 'error'; p: number; data: Record<string, unknown> | null }) => void): Promise<UnlistenFn>;
  };
  /** 自動更新（M5）。enabled は、更新の署名の公開鍵を埋め込んだビルドか */
  update: {
    info(): Promise<{ enabled: boolean; current: string }>;
    check(): Promise<{ version: string; notes?: string | null; date?: string | null } | null>;
    install(): Promise<void>;
    onProgress(fn: (e: { p: number; done?: boolean }) => void): Promise<UnlistenFn>;
  };
  /** ログ（M5） */
  log: {
    write(level: 'info' | 'warn' | 'error', message: string): Promise<void>;
    open(): Promise<void>;
    save(): Promise<string | null>;
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
  systemFonts: () => invoke<SysFont[]>('system_fonts'),
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
  history: {
    add: (at, kind, summary, project) => invoke('history_add', { at, kind, summary, project }),
    list: () => invoke('history_list'),
    get: (id) => invoke('history_get', { id }),
    del: (ids) => invoke('history_delete', { ids }),
  },
  menu: {
    set: (menus) => invoke('menu_set', { menus }),
    onAction: (fn) => listen<string>('menu-action', (e) => fn(e.payload)),
  },
  export: {
    pick: (name, ext) => invoke('export_pick', { name, ext }),
    start: (req) => invoke('export_start', { req }),
    cancel: (id) => invoke('export_cancel', { id }),
    onJob: (fn) => listen('export-job', (e) => fn(e.payload as Parameters<typeof fn>[0])),
  },
  script: {
    pick: () => invoke('script_pick'),
    read: (path) => invoke('script_read', { path }),
    watch: (path) => invoke('script_watch', { path }),
    onChanged: (fn) => listen<{ path: string }>('script-changed', (e) => fn(e.payload.path)),
  },
  color: {
    pickLut: () => invoke('lut_pick'),
    readLut: (path) => invoke('lut_read', { path }),
  },
  rec: {
    devices: () => invoke('rec_devices'),
    start: (device, name) => invoke('rec_start', { device, name }),
    stop: () => invoke('rec_stop'),
    cancel: () => invoke('rec_cancel'),
    onLevel: (fn) => listen<{ l: number; r: number; t: number }>('rec-level', (e) => fn(e.payload)),
  },
  track: {
    start: (req) => invoke('track_start', { req }),
    cancel: (id) => invoke('track_cancel', { id }),
    onJob: (fn) => listen('track-job', (e) => fn(e.payload as Parameters<typeof fn>[0])),
  },
  update: {
    info: () => invoke('update_info'),
    check: () => invoke('update_check'),
    install: () => invoke('update_install'),
    onProgress: (fn) => listen<{ p: number; done?: boolean }>('update-progress', (e) => fn(e.payload)),
  },
  log: {
    write: (level, message) => invoke('log_write', { level, message }),
    open: () => invoke('log_open'),
    save: () => invoke('log_save'),
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
