// 変更履歴：プロジェクトの写し（スナップショット）を残し、あとから戻せるようにする。
// 保存する場所は、デスクトップ版はプロジェクトフォルダーの history.sqlite、ブラウザ版はブラウザ内（IndexedDB）。
import type { Media, Project } from './model';
import { cEnd } from './timeline';

/** 自動で写しを残す間隔（ミリ秒） */
export const SNAPSHOT_INTERVAL = 2 * 60 * 1000;
/** 残しておく写しの数 */
export const SNAPSHOT_KEEP = 100;

/** 写しを残したきっかけ */
export type SnapshotKind = 'auto' | 'open' | 'restore';
export const KIND_LABEL: Record<SnapshotKind, string> = { auto: '自動', open: '開いたとき', restore: '復元する前' };

/** 一覧に出す情報（写しの中身は含まない） */
export interface SnapshotInfo {
  id: number;
  /** 残した時刻（1970年からのミリ秒） */
  at: number;
  kind: SnapshotKind;
  /** 「クリップ 12・長さ 8:03・素材 9」のような要約 */
  summary: string;
}

/** 写しに残す素材の項目（戻すときに使うものだけ。波形・サムネイルなどの重いものは残さない） */
const SNAP_MEDIA_KEYS = ['id', 'n', 'k', 'd', 'c', 'r', 'f', 'inP', 'outP', 'marks', 'rate', 'sample', 'file'] as const;

/** 保存用の写し：タイムラインと、素材の軽い情報だけ */
export function slimForSnapshot(p: Project): Project {
  const media = p.media.map((m) => {
    const o: Record<string, unknown> = {};
    for (const k of SNAP_MEDIA_KEYS) if (m[k] !== undefined) o[k] = m[k];
    return o as unknown as Media;
  });
  return JSON.parse(JSON.stringify({ v: 2, sample: p.sample, media, tracks: p.tracks, clips: p.clips, pin: p.pin, pout: p.pout })) as Project;
}

const mmss = (s: number): string => {
  s = Math.round(s || 0);
  return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
};

/** 一覧に出す要約 */
export function summarize(p: Project): string {
  const len = p.clips.reduce((a, c) => Math.max(a, cEnd(c)), 0);
  return `クリップ ${p.clips.length}・長さ ${mmss(len)}・素材 ${p.media.filter((m) => !m.sample).length}`;
}

/** 前の写しから、自動で写しを残す時間がたったか */
export function dueForSnapshot(lastAt: number | null, now: number, interval = SNAPSHOT_INTERVAL): boolean {
  return lastAt == null || now - lastAt >= interval;
}

/** 前の写しと中身が同じか（同じなら残さない） */
export function sameContent(a: Project | null, b: Project): boolean {
  if (!a) return false;
  return JSON.stringify(a.clips) === JSON.stringify(b.clips) && JSON.stringify(a.tracks) === JSON.stringify(b.tracks) &&
    JSON.stringify(a.media.map((m) => [m.id, m.inP, m.outP, m.r, m.marks])) === JSON.stringify(b.media.map((m) => [m.id, m.inP, m.outP, m.r, m.marks])) &&
    a.pin === b.pin && a.pout === b.pout;
}

/** 多すぎるときに消す写しの id（古いものから） */
export function toPrune(list: SnapshotInfo[], keep = SNAPSHOT_KEEP): number[] {
  return list.slice().sort((a, b) => b.at - a.at || b.id - a.id).slice(keep).map((s) => s.id);
}

/** 写しから戻した結果 */
export interface Restored {
  project: Project;
  /** いまはない素材を使っていたため、戻せなかったクリップの数 */
  dropped: number;
}

/**
 * 写し snap の内容（トラック・クリップ・書き出し範囲・素材のイン点やアウト点・権利・不要部分）を、いまのプロジェクト cur に戻す。
 * 素材そのもの（ファイル・URL・サムネイルなど）は、いまのものを使う。いまはない素材のクリップは戻さない。
 */
export function restoreFrom(cur: Project, snap: Project): Restored {
  const now = new Map(cur.media.map((m) => [m.id, m]));
  const media: Media[] = cur.media.map((m) => {
    const old = snap.media.find((x) => x.id === m.id);
    if (!old) return m;
    return { ...m, inP: old.inP, outP: old.outP, r: old.r, marks: old.marks, rate: old.rate };
  });
  const clips = snap.clips.filter((c) => c.type !== 'media' || (c.m != null && now.has(c.m)));
  return {
    project: { ...cur, media, tracks: JSON.parse(JSON.stringify(snap.tracks)), clips: JSON.parse(JSON.stringify(clips)), pin: snap.pin, pout: snap.pout },
    dropped: snap.clips.length - clips.length,
  };
}

/** 一覧に出す時刻（例：「11/26 14:05」。今日なら「今日 14:05」） */
export function formatTime(at: number, today = Date.now()): string {
  const d = new Date(at), t = new Date(today);
  const hm = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  const same = d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  return same ? '今日 ' + hm : d.getMonth() + 1 + '/' + d.getDate() + ' ' + hm;
}
