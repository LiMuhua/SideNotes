import { describe, expect, it } from 'vitest';
import { buildIco } from './iconFile';

describe('buildIco', () => {
  it('写出文件头、目录与按顺序排列的 PNG 数据', () => {
    const small = new Uint8Array([1, 2, 3]);
    const large = new Uint8Array([4, 5, 6, 7, 8]);
    const ico = buildIco([
      { size: 16, png: small },
      { size: 256, png: large },
    ]);
    const view = new DataView(ico.buffer);
    expect(ico.length).toBe(6 + 2 * 16 + 3 + 5);
    expect([view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true)]).toEqual([0, 1, 2]);

    // 第一项：16 × 16，32 位，数据紧跟在目录之后。
    expect([ico[6], ico[7], ico[8], ico[9]]).toEqual([16, 16, 0, 0]);
    expect([view.getUint16(10, true), view.getUint16(12, true)]).toEqual([1, 32]);
    expect([view.getUint32(14, true), view.getUint32(18, true)]).toEqual([3, 38]);
    expect(Array.from(ico.slice(38, 41))).toEqual([1, 2, 3]);

    // 第二项：256 记为 0，数据接在第一项之后。
    expect([ico[22], ico[23]]).toEqual([0, 0]);
    expect([view.getUint32(30, true), view.getUint32(34, true)]).toEqual([5, 41]);
    expect(Array.from(ico.slice(41))).toEqual([4, 5, 6, 7, 8]);
  });

  it('拒绝空列表与超出 1–256 的尺寸', () => {
    expect(() => buildIco([])).toThrow();
    expect(() => buildIco([{ size: 512, png: new Uint8Array([1]) }])).toThrow();
    expect(() => buildIco([{ size: 0, png: new Uint8Array([1]) }])).toThrow();
  });
});
