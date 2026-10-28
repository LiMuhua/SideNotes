import { describe, expect, it } from 'vitest';
import { CHANGELOG } from './changelog';

/** 把 x.y.z 转成可比较的数组。 */
function parts(version: string): number[] {
  return version.split('.').map(Number);
}

describe('更新日志', () => {
  it('首条与当前版本号一致，提升版本时不会漏写', () => {
    expect(CHANGELOG[0].version).toBe(__APP_VERSION__);
  });

  it('版本号格式正确、互不重复且从新到旧排列', () => {
    CHANGELOG.forEach((entry) => {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(entry.summary.trim()).not.toBe('');
    });
    for (let index = 1; index < CHANGELOG.length; index += 1) {
      const [a, b] = [parts(CHANGELOG[index - 1].version), parts(CHANGELOG[index].version)];
      const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      expect(newer).toBeGreaterThan(0);
    }
  });
});
