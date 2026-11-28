import { describe, expect, it } from 'vitest';
import { ADJ_DEFAULT, applyColor, buildLut, colorKey, colorOf, hasColor, parseCube, sampleCube, toCube } from './color';

const near = (a: number[], b: number[], eps = 1e-4) => a.every((v, i) => Math.abs(v - b[i]) < eps);

describe('色補正', () => {
  it('値がなければ色は変わらない', () => {
    expect(hasColor({})).toBe(false);
    expect(near(applyColor({}, [0.2, 0.5, 0.9]), [0.2, 0.5, 0.9])).toBe(true);
  });
  it('彩度 -100 は白黒（Rec.709 の明るさ）', () => {
    const [r, g, b] = applyColor({ ccSat: -100 }, [1, 0, 0]);
    expect(r).toBeCloseTo(0.2126, 4);
    expect(g).toBeCloseTo(0.2126, 4);
    expect(b).toBeCloseTo(0.2126, 4);
  });
  it('明るさ +100 は 2 倍、コントラストは中間の灰色を動かさない', () => {
    expect(applyColor({ ccExp: 100 }, [0.25, 0.25, 0.25])[0]).toBeCloseTo(0.5, 5);
    expect(applyColor({ ccCon: 80 }, [0.5, 0.5, 0.5])[0]).toBeCloseTo(0.5, 5);
    expect(applyColor({ ccCon: 100 }, [0.75, 0.75, 0.75])[0]).toBeCloseTo(1, 5);
  });
  it('色温度 + は赤みが増え青みが減る', () => {
    const [r, , b] = applyColor({ ccTemp: 50 }, [0.5, 0.5, 0.5]);
    expect(r).toBeGreaterThan(0.5);
    expect(b).toBeLessThan(0.5);
  });
  it('調整レイヤーは値がなければ前と同じ補正', () => {
    expect(colorOf({ type: 'adj' } as never)).toEqual(ADJ_DEFAULT);
    expect(colorOf({ type: 'adj', ccSat: 0 } as never)).toBeNull();
    expect(colorOf({ type: 'media' } as never)).toBeNull();
  });
  it('鍵は値と LUT で変わる', () => {
    expect(colorKey({ ccSat: 10 })).not.toBe(colorKey({ ccSat: 11 }));
    expect(colorKey({ ccLut: { name: 'a.cube' } })).not.toBe(colorKey({ ccLut: { name: 'a.cube' }, ccLutAmt: 50 }));
  });
});

describe('LUT', () => {
  it('作った LUT を .cube にして読み直すと、同じ補正になる', () => {
    const p = { ccSat: 30, ccTemp: -20, ccGam: 15 };
    const lut = buildLut(p, null, 33);
    const cube = parseCube(toCube(lut, 33));
    expect(cube.size).toBe(33);
    const want = applyColor(p, [0.3, 0.6, 0.1]);
    const got = sampleCube(cube, 0.3, 0.6, 0.1);
    expect(near(got, want, 0.01)).toBe(true);
  });
  it('格子の点では LUT の値そのもの', () => {
    const lut = buildLut({ ccExp: 40 }, null, 5);
    const cube = { size: 5, data: lut };
    expect(near(sampleCube(cube, 0.5, 0.25, 1), applyColor({ ccExp: 40 }, [0.5, 0.25, 1]))).toBe(true);
  });
  it('読み込んだ LUT の適用量で、元の色との間になる', () => {
    // すべてを反転する LUT
    const inv = new Float32Array(2 * 2 * 2 * 3);
    let i = 0;
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) inv.set([1 - r, 1 - g, 1 - b], (i++) * 3);
    const cube = { size: 2, data: inv };
    expect(near(applyColor({ ccLut: { name: 'x' } }, [0.2, 0.2, 0.2], cube), [0.8, 0.8, 0.8])).toBe(true);
    expect(near(applyColor({ ccLut: { name: 'x' }, ccLutAmt: 50 }, [0.2, 0.2, 0.2], cube), [0.5, 0.5, 0.5])).toBe(true);
  });
  it('.cube の DOMAIN と、だめなファイル', () => {
    const t = 'TITLE "t"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n' + '0 0 0\n2 0 0\n0 2 0\n2 2 0\n0 0 2\n2 0 2\n0 2 2\n2 2 2\n';
    const c = parseCube(t);
    expect(c.title).toBe('t');
    expect(c.data[3]).toBeCloseTo(1);
    expect(() => parseCube('LUT_1D_SIZE 4\n')).toThrow();
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n')).toThrow();
  });
});
