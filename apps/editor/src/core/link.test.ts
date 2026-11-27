import { describe, expect, it } from 'vitest';
import { applyLink, diffLink, linkState, rowNumbers, validateLinkFile, type LinkFile, type LinkRow, type ScriptLink } from './link';

const row = (id: string, order: number, o: Partial<LinkRow> = {}): LinkRow => ({ id, sceneId: 'scn_A', order, rev: 1, time: '0:00', music: '', video: 'v' + id, body: 'b' + id, type: 'ナレーション', deleted: false, ...o });
const file = (seq: number, rows: LinkRow[], o: Partial<LinkFile> = {}): LinkFile => ({
  app: 'Scenario Writer', schema: 1, project: { id: 'prj_1', title: '番組' }, exportSeq: seq, exportedAt: '2026-12-01T00:00:00Z',
  scenes: [{ id: 'scn_A', order: 1, title: 'A' }, { id: 'scn_B', order: 2, title: 'B' }], rows, ...o,
});
const first = () => applyLink(null, file(1, [row('r1', 1), row('r2', 2), row('r3', 3)]), diffLink(null, file(1, [row('r1', 1), row('r2', 2), row('r3', 3)])), []);

describe('link.json の取り込み', () => {
  it('形のおかしいファイルは止める', () => {
    expect(validateLinkFile({ schema: 2 })).not.toEqual([]);
    expect(diffLink(null, { schema: 1 } as LinkFile).block).toBe('invalid');
  });

  it('初めての取り込みは、すべて追加（自動）', () => {
    const d = diffLink(null, file(1, [row('r1', 1), row('r2', 2)]));
    expect(d.changes.map((c) => c.kind)).toEqual(['add', 'add']);
    expect(d.block).toBeUndefined();
  });

  it('追加・順番・移動・変更・削除・削除の取り消しを見分ける', () => {
    const { script } = first();
    script.rows[2].deleted = true;
    const d = diffLink(script, file(2, [row('r2', 1), row('r1', 2, { sceneId: 'scn_B' }), row('r3', 3), row('r4', 4), row('r5', 5, { rev: 1 })].map((r) => (r.id === 'r2' ? { ...r, rev: 2, body: '直した' } : r))));
    const k = Object.fromEntries(d.changes.map((c) => [c.key, c.kind]));
    expect(k['change:r2']).toBe('change');
    expect(k['order:r2']).toBe('order');
    expect(k['move:r1']).toBe('move');
    expect(k['undelete:r3']).toBe('undelete');
    expect(k['add:r4']).toBe('add');
  });

  it('同じ書き出しは「更新なし」、別のプロジェクトと、行が消えたファイルは止める、古い書き出しは注意', () => {
    const { script } = first();
    expect(diffLink(script, file(1, script.rows.map((r) => ({ ...r })))).same).toBe(true);
    expect(diffLink(script, file(2, script.rows, { project: { id: 'prj_X' } })).block).toBe('project');
    expect(diffLink(script, file(2, script.rows.slice(1))).block).toBe('missing');
    expect(diffLink({ ...script, exportSeq: 5 }, file(2, script.rows)).block).toBe('older');
  });

  it('選ばなかった変更・削除は前回のまま残し、次の取り込みでまた出る', () => {
    const { script } = first();
    const next = file(2, [row('r1', 1, { rev: 2, body: '新しい' }), row('r2', 2, { deleted: true }), row('r3', 3)]);
    const d = diffLink(script, next);
    const r = applyLink(script, next, d, [], { accept: { 'change:r1': false, 'delete:r2': false } });
    const r1 = r.script.rows.find((x) => x.id === 'r1')!, r2 = r.script.rows.find((x) => x.id === 'r2')!;
    expect([r1.body, r1.rev]).toEqual(['br1', 1]);
    expect(r2.deleted).toBe(false);
    expect(diffLink(r.script, next).changes.map((c) => c.key).sort()).toEqual(['change:r1', 'delete:r2']);
    const all = applyLink(script, next, d, []);
    expect(all.script.rows.find((x) => x.id === 'r1')!.body).toBe('新しい');
    expect(all.script.rows.find((x) => x.id === 'r2')!.deleted).toBe(true);
  });

  it('紐づけの状態：更新されたら確認待ち、削除されたら孤立、取り消せば戻る', () => {
    const { script } = first();
    const l: ScriptLink = { id: 'l1', clipId: 'c1', rowId: 'r1', rev: 1 };
    expect(linkState(l, script)).toBe('ok');
    const s2 = { ...script, rows: script.rows.map((r) => (r.id === 'r1' ? { ...r, rev: 2 } : r)) };
    expect(linkState(l, s2)).toBe('stale');
    const s3 = { ...script, rows: script.rows.map((r) => (r.id === 'r1' ? { ...r, deleted: true } : r)) };
    expect(linkState(l, s3)).toBe('orphan');
    expect(linkState({ ...l, rowId: 'nope' }, script)).toBe('orphan');
  });

  it('結合：結合された行の紐づけを、結合先へ付け替える（選べば孤立のまま）', () => {
    const { script } = first();
    const next = file(2, [row('r1', 1, { rev: 3 }), row('r2', 2, { deleted: true, mergedInto: 'r1' }), row('r3', 3)]);
    const d = diffLink(script, next);
    expect(d.changes.find((c) => c.rowId === 'r2')!.kind).toBe('merge');
    const links: ScriptLink[] = [{ id: 'l1', clipId: 'c9', rowId: 'r2', rev: 1 }];
    const a = applyLink(script, next, d, links);
    expect(a.links[0].rowId).toBe('r1');
    expect(linkState(a.links[0], a.script)).toBe('ok');
    const b = applyLink(script, next, d, links, { relink: { r2: false } });
    expect(linkState(b.links[0], b.script)).toBe('orphan');
  });

  it('分割・複製は新しい行として扱う。行番号は削除された行を飛ばす', () => {
    const { script } = first();
    const next = file(2, [row('r1', 1), row('r1b', 2, { splitFrom: 'r1' }), row('r2', 3, { deleted: true }), row('r3', 4), row('r3c', 5, { copiedFrom: 'r3' })]);
    const d = diffLink(script, next);
    expect(d.changes.filter((c) => c.kind === 'split' || c.kind === 'copy').map((c) => c.rowId)).toEqual(['r1b', 'r3c']);
    const a = applyLink(script, next, d, []);
    expect(rowNumbers(a.script)).toEqual({ r1: 'R-001', r1b: 'R-002', r3: 'R-003', r3c: 'R-004' });
  });
});
