import { describe, expect, it } from 'vitest';
import manifest from '../../src-tauri/icons/builtin/manifest.json';
import { BUILTIN_ICONS, DEFAULT_APP_ICON, appIconFolder, normalizeAppIcon } from './appIcons';

describe('内置应用图标', () => {
  it('不列出门缝平视的两个图标，其余按清单顺序，默认图标在最前', () => {
    expect(BUILTIN_ICONS.map((icon) => icon.id)).toEqual(['door-smile-indigo', 'door-smile-warm', 'stack-smile', 'fan-swish']);
    expect(BUILTIN_ICONS[0].id).toBe(DEFAULT_APP_ICON);
    // 清单与资源仍是六个，与原型、Playground 共用。
    expect(manifest.icons).toHaveLength(6);
  });

  it('选过不再列出的图标时按默认图标处理', () => {
    expect(normalizeAppIcon('door-plain-indigo')).toBe(DEFAULT_APP_ICON);
    expect(normalizeAppIcon('door-plain-warm')).toBe(DEFAULT_APP_ICON);
    expect(appIconFolder('door-plain-warm', false)).toBe('211-door-smile-indigo');
    expect(normalizeAppIcon('stack-smile')).toBe('stack-smile');
  });
});
