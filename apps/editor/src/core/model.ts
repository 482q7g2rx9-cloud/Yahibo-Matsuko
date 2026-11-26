// プロジェクトの型（保存形式 v2）。Rust 側の crates/matsuko-core/src/model.rs と同じ形。
// タイムラインの仕様は docs/timeline-spec.md。

/** 素材の種類 */
export type MediaKind = '映像' | '音声' | 'テイク' | '画像' | '台本';
/** 権利の状態：許可済み・要確認・フリー素材・自社収録 */
export type Rights = 'ok' | 'wn' | 'free' | 'own' | '';

/** 無音などの不要部分（素材の中の秒） */
export interface Mark {
  a: number;
  b: number;
  k: string;
  /** 削除にしたら true */
  done?: boolean;
}

/** 素材 */
export interface Media {
  id: string;
  /** 表示名 */
  n: string;
  k: MediaKind;
  /** 長さ（秒）。画像は 0 */
  d: number;
  /** 記号（V-01 など） */
  c: string;
  r: Rights;
  /** ファイル名 */
  f: string;
  /** ソースモニターのイン点・アウト点（秒） */
  inP?: number;
  outP?: number;
  marks?: Mark[];
  /** 読み込んだファイルなら 1（見本は 0 か無し） */
  file?: 0 | 1;
  /** 見本の素材なら 1 */
  sample?: 0 | 1;
  /** 映像の素材に音声がないとき 1 */
  noAudio?: 0 | 1;
  /** 表示用の色（サムネイルがないとき） */
  col?: [string, string];
  thumb?: string;
  /** 音声の波形（0〜1、1秒に10個） */
  peaks?: number[];
  /** 画面で再生に使う URL（保存しない） */
  url?: string | null;
  /** 読み込み中なら 1（保存しない） */
  loading?: 0 | 1;
  /** プロキシの状態：-1 不要、0〜1 作成中、1 済み、-2 失敗 */
  px?: number;
  /** デスクトップ版：素材ファイルのフルパスと、プロジェクトからの相対パス */
  path?: string;
  rel?: string;
  proxyPath?: string;
  missing?: 0 | 1;
  /** プロキシが必要（np）、そのまま再生できる（pl） */
  np?: 0 | 1;
  pl?: 0 | 1;
  /** そのほか、画面で表示する項目（解像度・権利者など） */
  [extra: string]: unknown;
}

export type TrackKind = 'v' | 'a';

/** トラック。画面の上から V3, V2, V1, A1, A2, A3 の順 */
export interface Track {
  id: string;
  kind: TrackKind;
  /** 画面上の高さ（px） */
  h: number;
  name?: string;
  hide?: boolean;
  lock?: boolean;
  mute?: boolean;
  solo?: boolean;
}

export type ClipType = 'media' | 'title' | 'adj';

/** クリップ */
export interface Clip {
  id: string;
  /** 置いているトラックの id */
  tr: string;
  type: ClipType;
  /** タイムライン上の開始（秒） */
  start: number;
  /** 素材の中の開始・終了（秒）。テロップなどは 0 からの長さ */
  in: number;
  out: number;
  /** 素材の id（type が media のとき） */
  m?: string;
  /** 同じ素材から作った映像と音声を結ぶ番号 */
  link?: string | null;
  /** 位置 X・Y（%）、拡大率（%）、回転（°）、不透明度（%）、音量（dB） */
  x?: number;
  y?: number;
  scale?: number;
  rot?: number;
  op?: number;
  vol?: number;
  /** テロップ：文字、種類（name / q / sub / credit）、大きさ（小 / 中 / 大） */
  label?: string;
  st?: string;
  sz?: string;
}

/** プロジェクト設定（プロジェクト → プロジェクト設定…）。足りない項目は初期値（1920×1080・29.97 fps・標準・720p・48 kHz） */
export interface ProjectSettings {
  /** シーケンスの解像度（例：1920×1080） */
  res?: string;
  /** フレームレート（例：29.97） */
  fps?: string;
  /** プレビューの画質：high・std・light */
  pq?: 'high' | 'std' | 'light';
  /** プロキシの高さ（540・720・1080） */
  proxy?: number;
  /** 音声のサンプリング周波数（48000・44100） */
  ar?: number;
}

/** プロジェクト */
export interface Project {
  v: 2;
  /** 見本プロジェクトなら 1 */
  sample: 0 | 1;
  media: Media[];
  tracks: Track[];
  clips: Clip[];
  /** 書き出し範囲のイン点・アウト点（秒） */
  pin?: number | null;
  pout?: number | null;
  settings?: ProjectSettings;
}

/** 新しい id を作る関数（接頭辞を受け取る）。テストでは決まった順の id を返すものに差し替える */
export type IdMaker = (prefix: string) => string;

export const uid: IdMaker = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
