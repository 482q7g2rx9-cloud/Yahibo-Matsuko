// 台本アプリ（Scenario Writer）のプロジェクトファイル .swdx の読み込み（M6）。
//
// .swdx は ZIP で、mimetype（application/vnd.yahibo.swdx、無圧縮）と project.json（台本アプリの保存内容）が入る。
// project.json を、連携ファイル（○○.link.json、schema 1）と同じ形に直して、今までの取り込み（link.ts）に渡す。
// 直し方は台本アプリの lexport() と同じ。ただし書き出し番号は増やさず、最後に連携用に書き出したときの番号（plan.xseq）を使う。
// 絵コンテの画像（cards[].img）は、連携ファイルにはない。取り込むときに縮めて Project.script.cards に持つ。
import type { LinkFile } from './link';

export const SWDX_MIME = 'application/vnd.yahibo.swdx';

/** 台本アプリの保存内容（snap()）のうち、使うところ */
export interface SwdxProject {
  app?: string;
  v?: number;
  plan?: { pid?: string; title?: string; xseq?: number; xat?: number };
  scenes?: { id?: string; t?: string; m?: string; n?: string }[];
  rows?: {
    id?: string;
    sceneId?: string;
    rev?: number;
    tm?: string;
    mu?: string;
    vi?: string;
    bd?: string;
    ty?: string;
    deleted?: boolean;
    [k: string]: unknown;
  }[];
  cards?: { id?: string; sceneId?: string; cap?: string; name?: string; img?: string }[];
  memos?: { id?: string; t?: string; w?: string; uid?: string; ts?: number; tgt?: string }[];
}

/** 絵コンテの 1 枚。img は data: の画像（あれば） */
export interface SwdxCard {
  id: string;
  sceneId: string;
  caption: string;
  img?: string;
}

/** 台本アプリの保存内容か */
export function isSwdxProject(o: unknown): o is SwdxProject {
  const x = o as SwdxProject;
  return !!x && typeof x === 'object' && x.app === 'Yahibo Scenario Writer' && Array.isArray(x.rows) && Array.isArray(x.scenes);
}

const ROW_EXTRA = ['deletedAt', 'modifiedAt', 'splitFrom', 'mergedInto', 'copiedFrom', 'legacyNo'] as const;

/** 台本アプリの保存内容を、連携ファイルの形にする。行やシーンに固有の id がない古い保存内容は、理由を投げる */
export function swdxToLink(s: SwdxProject): { file: LinkFile; cards: SwdxCard[] } {
  const plan = s.plan || {};
  if (!plan.pid)
    throw new Error('この .swdx には台本の固有の番号がありません。台本アプリで一度「連携用に書き出し」をしてから、保存し直してください');
  const scenes = s.scenes || [],
    rows = s.rows || [];
  if (scenes.some((x) => !x.id) || rows.some((r) => !r.id || /^SR-/.test(r.id)))
    throw new Error('この .swdx は古い形式です（行に固有の番号がありません）。台本アプリで一度「連携用に書き出し」をしてから、保存し直してください');
  const file: LinkFile = {
    app: 'Scenario Writer',
    schema: 1,
    project: { id: plan.pid, title: plan.title || '' },
    exportSeq: plan.xseq || 0,
    scenes: scenes.map((x, i) => ({ id: x.id as string, order: i + 1, title: x.t, time: x.m, note: x.n })),
    rows: rows.map((r, i) => {
      const q: LinkFile['rows'][number] = {
        id: r.id as string,
        sceneId: r.sceneId,
        order: i + 1,
        rev: r.rev || 1,
        time: r.tm,
        music: r.mu,
        video: r.vi,
        body: r.bd,
        type: r.ty,
        deleted: !!r.deleted,
      };
      for (const k of ROW_EXTRA) if (r[k] !== undefined) (q as unknown as Record<string, unknown>)[k] = r[k];
      return q;
    }),
    cards: (s.cards || []).map((c) => ({ id: c.id, sceneId: c.sceneId || '', caption: c.cap || '', hasImage: !!c.img })),
    memos: (s.memos || []).map((m) => ({ id: m.id, text: m.t, author: m.w, authorUid: m.uid || '', createdAt: m.ts, target: m.tgt || 'all' })),
  };
  const cards: SwdxCard[] = (s.cards || [])
    .filter((c) => c.id)
    .map((c) => {
      const o: SwdxCard = { id: c.id as string, sceneId: c.sceneId || '', caption: c.cap || c.name || '' };
      if (c.img && c.img.indexOf('data:image/') === 0) o.img = c.img;
      return o;
    });
  return { file, cards };
}

/* ---------- ZIP（.swdx）を読む ---------- */

/** ZIP の中のファイル。data は圧縮されたまま（method 0 は無圧縮、8 は deflate） */
export interface ZipEntry {
  name: string;
  method: number;
  data: Uint8Array;
}

/** ZIP の中身の一覧（セントラルディレクトリから）。ZIP でなければ投げる */
export function readZip(b: Uint8Array): ZipEntry[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('ZIP ではありません');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP が壊れています');
    const method = dv.getUint16(p + 10, true),
      size = dv.getUint32(p + 20, true),
      nl = dv.getUint16(p + 28, true),
      el = dv.getUint16(p + 30, true),
      cl = dv.getUint16(p + 32, true),
      lo = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
    if (dv.getUint32(lo, true) !== 0x04034b50) throw new Error('ZIP が壊れています');
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    out.push({ name, method, data: b.subarray(start, start + size) });
    p += 46 + nl + el + cl;
  }
  return out;
}

/** .swdx の project.json の文字を取り出す。inflate は deflate（ヘッダーなし）を戻す関数 */
export async function unzipSwdx(b: Uint8Array, inflate: (d: Uint8Array) => Promise<Uint8Array>): Promise<string> {
  const list = readZip(b);
  const get = async (name: string) => {
    const e = list.find((x) => x.name === name);
    if (!e) return null;
    if (e.method === 0) return e.data;
    if (e.method === 8) return inflate(e.data);
    throw new Error('この圧縮の形式には対応していません');
  };
  const dec = new TextDecoder();
  const m = await get('mimetype');
  if (!m || dec.decode(m).trim() !== SWDX_MIME) throw new Error('台本アプリの .swdx ではありません');
  const p = await get('project.json');
  if (!p) throw new Error('.swdx の中に project.json がありません');
  return dec.decode(p);
}

/** ZIP（.swdx）の先頭か */
export function looksZip(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
}
