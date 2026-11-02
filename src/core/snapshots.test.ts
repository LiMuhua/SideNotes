import { describe, expect, it } from 'vitest';
import { snapshotReason, snapshotTime } from './snapshots';

describe('快照的显示文字', () => {
  it('原因写成中文，不认识的原样显示', () => {
    expect(snapshotReason('auto')).toBe('每天自动');
    expect(snapshotReason('delete')).toBe('永久删除前');
    expect(snapshotReason('future')).toBe('future');
  });

  it('今天、昨天写相对日期，今年其它日子省略年份', () => {
    const now = new Date(2026, 10, 3, 9, 30).getTime();
    expect(snapshotTime(new Date(2026, 10, 3, 8, 5).getTime(), now)).toBe('今天 08:05');
    expect(snapshotTime(new Date(2026, 10, 2, 23, 59).getTime(), now)).toBe('昨天 23:59');
    expect(snapshotTime(new Date(2026, 9, 28, 14, 0).getTime(), now)).toBe('10月28日 14:00');
    expect(snapshotTime(new Date(2025, 11, 31, 7, 3).getTime(), now)).toBe('2025年12月31日 07:03');
  });
});
