// 台本連携（M4）：台本アプリ（Scenario Writer）が書き出す ○○.link.json の取り込み。
// 仕様：「台本連携データ仕様（案A：ファイル連携）」。行の同一性は id だけで決め、順番（order）・所属シーン（sceneId）は属性。
// 編集ソフトは、前回取り込んだ内容（控え＝Project.script）と今回のファイルを行 id で照合し、差分を一覧にしてから反映する。
// 台本の文章は閲覧のみ（台本側へは書き戻さない）。クリップと行の紐づけは Project.links に持つ。

/** 連携ファイルのシーン */
export interface LinkScene {
  id: string;
  order: number;
  title?: string;
  time?: string;
  note?: string;
}

/** 連携ファイルの台本行 */
export interface LinkRow {
  id: string;
  sceneId?: string;
  order: number;
  /** 版番号（内容を編集するたびに 1 ずつ増える） */
  rev: number;
  time?: string;
  music?: string;
  video?: string;
  body?: string;
  type?: string;
  deleted?: boolean;
  deletedAt?: number | string;
  modifiedAt?: number | string;
  splitFrom?: string;
  mergedInto?: string;
  copiedFrom?: string;
  legacyNo?: string;
}

/** 連携ファイル（schema 1） */
export interface LinkFile {
  app?: string;
  schema: number;
  project: { id: string; title?: string };
  exportSeq: number;
  exportedAt?: string;
  scenes: LinkScene[];
  rows: LinkRow[];
  cards?: unknown[];
  memos?: unknown[];
}

/** 控え：最後に取り込んだ内容 */
export interface ScriptState {
  projectId: string;
  title: string;
  exportSeq: number;
  exportedAt?: string;
  importedAt: string;
  scenes: LinkScene[];
  rows: LinkRow[];
}

/** 紐づけ：クリップと台本行。rev は紐づけた（確認した）ときの行の版番号、seen はそのときの行の内容 */
export interface ScriptLink {
  id: string;
  clipId: string;
  rowId: string;
  rev: number;
  seen?: RowText;
}
export type RowText = Pick<LinkRow, 'time' | 'music' | 'video' | 'body' | 'type'>;
export const ROW_TEXT_KEYS = ['time', 'music', 'video', 'body', 'type'] as const;
export function rowText(r: LinkRow | undefined): RowText {
  const o: RowText = {};
  if (r) for (const k of ROW_TEXT_KEYS) o[k] = r[k] ?? '';
  return o;
}

/** 紐づけの状態：ok（一致）・stale（台本が更新された。確認待ち）・orphan（台本で削除された。孤立） */
export type LinkState = 'ok' | 'stale' | 'orphan';
export function linkState(l: ScriptLink, s: ScriptState | null | undefined): LinkState {
  const r = s && s.rows.find((x) => x.id === l.rowId);
  if (!r || r.deleted) return 'orphan';
  return (r.rev || 0) > (l.rev || 0) ? 'stale' : 'ok';
}

/** 差分の種類。auto は既定で自動反映、そうでなければ 1 件ずつ確認 */
export type ChangeKind = 'add' | 'split' | 'copy' | 'order' | 'move' | 'undelete' | 'change' | 'delete' | 'merge';
export const CHANGE_AUTO: Record<ChangeKind, boolean> = {
  add: true,
  split: true,
  copy: true,
  order: true,
  move: true,
  undelete: true,
  change: false,
  delete: false,
  merge: false,
};
export const CHANGE_LABEL: Record<ChangeKind, string> = {
  add: '追加',
  split: '分割',
  copy: '複製',
  order: '順番の変更',
  move: '移動',
  undelete: '削除の取り消し',
  change: '変更',
  delete: '削除',
  merge: '結合',
};

export interface Change {
  /** 選んだかどうかを覚えるための鍵（種類:行 id） */
  key: string;
  kind: ChangeKind;
  rowId: string;
  before?: LinkRow;
  after: LinkRow;
  /** 結合先・分割元・複製元の行 id */
  other?: string;
}

/** 取り込みを止める理由 */
export type Block = 'invalid' | 'project' | 'older' | 'missing';

export interface Diff {
  /** same：前回と同じ（更新なし） */
  same: boolean;
  block?: Block;
  /** 止めた理由・注意の文 */
  messages: string[];
  /** 控えにあるのに、ファイルにない行（墓標もない） */
  missing: string[];
  changes: Change[];
  /** シーンの追加・変更の数（自動で反映） */
  sceneChanges: number;
}

/** 形が正しいか（足りないものの説明。正しければ空） */
export function validateLinkFile(o: unknown): string[] {
  const e: string[] = [];
  const f = o as Partial<LinkFile> | null;
  if (!f || typeof f !== 'object') return ['連携ファイルではありません'];
  if (f.schema !== 1) e.push('対応していない形式です（schema ' + String(f.schema) + '）');
  if (!f.project || typeof f.project.id !== 'string' || !f.project.id) e.push('プロジェクトの id がありません');
  if (typeof f.exportSeq !== 'number') e.push('書き出し番号（exportSeq）がありません');
  if (!Array.isArray(f.rows)) e.push('台本行（rows）がありません');
  else if (f.rows.some((r) => !r || typeof r.id !== 'string' || !r.id)) e.push('id のない台本行があります');
  if (!Array.isArray(f.scenes)) e.push('シーン（scenes）がありません');
  return e;
}

const sameRows = (a: LinkRow[], b: LinkRow[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/** 控え（前回）と今回のファイルの差分 */
export function diffLink(prev: ScriptState | null | undefined, next: LinkFile): Diff {
  const d: Diff = { same: false, messages: [], missing: [], changes: [], sceneChanges: 0 };
  const bad = validateLinkFile(next);
  if (bad.length) {
    d.block = 'invalid';
    d.messages = bad;
    return d;
  }
  if (prev) {
    if (prev.projectId !== next.project.id) {
      d.block = 'project';
      d.messages.push('別のプロジェクトの台本です（' + (next.project.title || next.project.id) + '）。取り込めません');
      return d;
    }
    if (next.exportSeq === prev.exportSeq && sameRows(prev.rows, next.rows) && JSON.stringify(prev.scenes) === JSON.stringify(next.scenes)) {
      d.same = true;
      d.messages.push('更新はありません');
      return d;
    }
    if (next.exportSeq < prev.exportSeq) {
      d.block = 'older';
      d.messages.push('前回より古い書き出しです（前回 #' + prev.exportSeq + '、今回 #' + next.exportSeq + '）');
    }
    const ids = new Set(next.rows.map((r) => r.id));
    d.missing = prev.rows.filter((r) => !ids.has(r.id)).map((r) => r.id);
    if (d.missing.length) {
      d.block = 'missing';
      d.messages.push('前回あった行が ' + d.missing.length + ' 件、ファイルにありません。ファイルが壊れているおそれがあるため、取り込みを止めました');
    }
    const ps = new Map(prev.scenes.map((s) => [s.id, s]));
    for (const s of next.scenes) {
      const o = ps.get(s.id);
      if (!o || o.title !== s.title || o.order !== s.order || o.time !== s.time) d.sceneChanges++;
    }
  } else {
    d.sceneChanges = next.scenes.length;
  }
  const pr = new Map((prev ? prev.rows : []).map((r) => [r.id, r]));
  const add = (kind: ChangeKind, after: LinkRow, before?: LinkRow, other?: string) =>
    d.changes.push({ key: kind + ':' + after.id, kind, rowId: after.id, before, after, other });
  for (const r of next.rows) {
    const o = pr.get(r.id);
    if (!o) {
      if (r.deleted) continue; // 見たことのない行の墓標は、何もしない
      if (r.splitFrom) add('split', r, undefined, r.splitFrom);
      else if (r.copiedFrom) add('copy', r, undefined, r.copiedFrom);
      else add('add', r);
      continue;
    }
    if (o.deleted && !r.deleted) add('undelete', r, o);
    else if (!o.deleted && r.deleted) {
      if (r.mergedInto) add('merge', r, o, r.mergedInto);
      else add('delete', r, o);
    }
    if (r.deleted) continue;
    if ((r.rev || 0) > (o.rev || 0) && ROW_TEXT_KEYS.some((k) => (r[k] ?? '') !== (o[k] ?? ''))) add('change', r, o);
    if ((r.sceneId || '') !== (o.sceneId || '')) add('move', r, o);
    else if (r.order !== o.order) add('order', r, o);
  }
  return d;
}

/** 選び方：変更ごとに反映するか（ない鍵は、auto なら反映、そうでなければ反映する＝既定で選ぶ）、結合の付け替え */
export interface ApplyChoice {
  accept?: Record<string, boolean>;
  /** 結合された行の紐づけを、結合先へ付け替えるか（既定は付け替える） */
  relink?: Record<string, boolean>;
}

export interface ApplyResult {
  script: ScriptState;
  links: ScriptLink[];
}

/**
 * 差分を反映した控えと紐づけを作る。選ばなかった変更は、前回の値のまま残す（次の取り込みでまた出る）
 */
export function applyLink(prev: ScriptState | null | undefined, next: LinkFile, diff: Diff, links: ScriptLink[], choice: ApplyChoice = {}, now = new Date().toISOString()): ApplyResult {
  const ok = (c: Change) => (choice.accept && c.key in choice.accept ? !!choice.accept[c.key] : true);
  const pr = new Map((prev ? prev.rows : []).map((r) => [r.id, r]));
  const byRow = new Map<string, Change[]>();
  for (const c of diff.changes) byRow.set(c.rowId, (byRow.get(c.rowId) || []).concat(c));
  const rows: LinkRow[] = [];
  for (const r of next.rows) {
    const o = pr.get(r.id), cs = byRow.get(r.id) || [];
    if (!o) {
      if (r.deleted) continue;
      const c = cs[0];
      if (c && !ok(c)) continue; // 追加しない（次の取り込みでまた出る）
      rows.push({ ...r });
      continue;
    }
    const x: LinkRow = { ...r };
    for (const c of cs) {
      if (ok(c)) continue;
      if (c.kind === 'change') {
        for (const k of ROW_TEXT_KEYS) x[k] = o[k];
        x.rev = o.rev;
      } else if (c.kind === 'delete' || c.kind === 'merge') {
        Object.assign(x, o, { order: r.order, sceneId: r.sceneId });
        x.deleted = false;
        delete x.deletedAt;
        delete x.mergedInto;
      } else if (c.kind === 'undelete') {
        x.deleted = true;
      } else if (c.kind === 'move') {
        x.sceneId = o.sceneId;
        x.order = o.order;
      } else if (c.kind === 'order') {
        x.order = o.order;
      }
    }
    rows.push(x);
  }
  // ファイルにない行（確認して取り込んだとき）は、前回のまま残す
  const ids = new Set(next.rows.map((r) => r.id));
  for (const o of prev ? prev.rows : []) if (!ids.has(o.id)) rows.push({ ...o });
  // 結合：結合された行の紐づけを、結合先へ付け替える（選んだとき）
  const nl = links.map((l) => ({ ...l }));
  for (const c of diff.changes) {
    if (c.kind !== 'merge' || !ok(c) || !c.other) continue;
    if (choice.relink && c.rowId in choice.relink && !choice.relink[c.rowId]) continue;
    const to = rows.find((r) => r.id === c.other && !r.deleted);
    if (!to) continue;
    for (const l of nl) {
      if (l.rowId !== c.rowId) continue;
      l.rowId = to.id;
      l.rev = to.rev;
      l.seen = rowText(to);
    }
  }
  // 同じクリップと行の組が重なったら 1 つにする
  const seen = new Set<string>();
  const links2 = nl.filter((l) => {
    const k = l.clipId + '|' + l.rowId;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    script: {
      projectId: next.project.id,
      title: next.project.title || '',
      exportSeq: Math.max(next.exportSeq, prev ? prev.exportSeq : 0),
      exportedAt: next.exportedAt,
      importedAt: now,
      scenes: next.scenes.map((s) => ({ ...s })),
      rows,
    },
    links: links2,
  };
}

/** 画面に出す行番号（R-001）：削除されていない行を順番に並べたときの番号 */
export function rowNumbers(s: ScriptState | null | undefined): Record<string, string> {
  const o: Record<string, string> = {};
  if (!s) return o;
  s.rows
    .filter((r) => !r.deleted)
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((r, i) => (o[r.id] = 'R-' + String(i + 1).padStart(3, '0')));
  return o;
}
