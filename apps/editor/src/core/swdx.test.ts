import { describe, expect, it } from 'vitest';
import { diffLink, validateLinkFile } from './link';
import { isSwdxProject, looksZip, swdxToLink, unzipSwdx, type SwdxProject } from './swdx';

/** テスト用の ZIP を作る（台本アプリの saveSwdx と同じ：mimetype は無圧縮、project.json は deflate） */
/** ブラウザと同じ CompressionStream / DecompressionStream（deflate-raw）で圧縮・展開する */
const pipe = async (d: Uint8Array, t: CompressionStream | DecompressionStream) =>
  new Uint8Array(await new Response(new Blob([d as BlobPart]).stream().pipeThrough(t)).arrayBuffer());
const deflateRaw = (d: Uint8Array) => pipe(d, new CompressionStream('deflate-raw'));
const inflate = (d: Uint8Array) => pipe(d, new DecompressionStream('deflate-raw'));

async function zip(files: [string, string, boolean][]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [],
    cent: Uint8Array[] = [];
  let off = 0;
  for (const [name, text, deflate] of files) {
    const raw = enc.encode(text),
      data = deflate ? await deflateRaw(raw) : raw,
      nm = enc.encode(name);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(8, deflate ? 8 : 0, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, raw.length, true);
    lh.setUint16(26, nm.length, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(10, deflate ? 8 : 0, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, raw.length, true);
    ch.setUint16(28, nm.length, true);
    ch.setUint32(42, off, true);
    parts.push(new Uint8Array(lh.buffer), nm, data);
    cent.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const cs = cent.reduce((a, x) => a + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cs, true);
  end.setUint32(16, off, true);
  const all = [...parts, ...cent, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, x) => a + x.length, 0));
  let p = 0;
  for (const x of all) {
    out.set(x, p);
    p += x.length;
  }
  return out;
}

const snap: SwdxProject = {
  app: 'Yahibo Scenario Writer',
  v: 1,
  plan: { pid: 'prj_1', title: '商店街', xseq: 4 },
  scenes: [
    { id: 'scn_a', t: 'オープニング', m: '0:30', n: '' },
    { id: 'scn_b', t: 'インタビュー', m: '2:00' },
  ],
  rows: [
    { id: 'row_1', sceneId: 'scn_a', rev: 2, tm: '0:00', mu: 'BGM', vi: '外観', bd: '商店街の朝', ty: 'ナレーション', deleted: false },
    { id: 'row_2', sceneId: 'scn_b', rev: 1, tm: '0:30', mu: '', vi: '店主', bd: '店主の話', ty: 'インタビュー', deleted: false },
    { id: 'row_3', sceneId: 'scn_b', rev: 3, bd: '消した行', deleted: true, deletedAt: 5, mergedInto: 'row_2' },
  ],
  cards: [
    { id: 'crd_1', sceneId: 'scn_a', cap: '外観', img: 'data:image/png;base64,AAAA' },
    { id: 'crd_2', sceneId: '', cap: '', img: '' },
  ],
  memos: [{ id: 'memo_1', t: 'メモ', w: '山本', ts: 1 }],
};

describe('.swdx', () => {
  it('ZIP から project.json を取り出す', async () => {
    const b = await zip([
      ['mimetype', 'application/vnd.yahibo.swdx', false],
      ['project.json', JSON.stringify(snap), true],
    ]);
    expect(looksZip(b)).toBe(true);
    const o = JSON.parse(await unzipSwdx(b, inflate));
    expect(isSwdxProject(o)).toBe(true);
    expect(o.plan.title).toBe('商店街');
  });
  it('台本アプリのファイルでなければ断る', async () => {
    const b = await zip([['mimetype', 'application/zip', false]]);
    await expect(unzipSwdx(b, inflate)).rejects.toThrow('.swdx ではありません');
    expect(() => looksZip(new TextEncoder().encode('{}'))).not.toThrow();
    expect(looksZip(new TextEncoder().encode('{}'))).toBe(false);
  });
  it('連携ファイルと同じ形にする（台本アプリの lexport と同じ）', () => {
    const { file, cards } = swdxToLink(snap);
    expect(validateLinkFile(file)).toEqual([]);
    expect(file.project).toEqual({ id: 'prj_1', title: '商店街' });
    expect(file.exportSeq).toBe(4);
    expect(file.scenes.map((s) => [s.id, s.order, s.title])).toEqual([
      ['scn_a', 1, 'オープニング'],
      ['scn_b', 2, 'インタビュー'],
    ]);
    expect(file.rows[0]).toMatchObject({ id: 'row_1', order: 1, rev: 2, time: '0:00', music: 'BGM', video: '外観', body: '商店街の朝', type: 'ナレーション' });
    expect(file.rows[2]).toMatchObject({ deleted: true, deletedAt: 5, mergedInto: 'row_2' });
    expect(cards).toEqual([
      { id: 'crd_1', sceneId: 'scn_a', caption: '外観', img: 'data:image/png;base64,AAAA' },
      { id: 'crd_2', sceneId: '', caption: '' },
    ]);
    // 初めての取り込み：行の追加として扱える
    const d = diffLink(null, file);
    expect(d.block).toBeUndefined();
    expect(d.changes.filter((c) => c.kind === 'add').length).toBe(2);
  });
  it('固有の番号がない古い保存内容は断る', () => {
    expect(() => swdxToLink({ ...snap, plan: { title: 'x' } })).toThrow('固有の番号');
    expect(() => swdxToLink({ ...snap, rows: [{ id: 'SR-0001', bd: 'x' }] })).toThrow('古い形式');
  });
});
