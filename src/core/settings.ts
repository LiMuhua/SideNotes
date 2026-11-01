/**
 * 设置的默认值与校验。
 *
 * 所有设置只在此处定义一次：Rust 侧以 JSON 原样存取，读取后统一经过
 * `normalizeSettings` 补全，避免两侧重复维护默认值与边界。
 */

import type { CloudSettings, Settings } from './types';

/** 侧栏宽度范围。 */
export const WIDTH_RANGE = { min: 360, max: 720, step: 4 } as const;
/** 字号范围。 */
export const FONT_SIZE_RANGE = { min: 12, max: 18, step: 1 } as const;
/** 每批加载条数范围。 */
export const PAGE_SIZE_RANGE = { min: 5, max: 100 } as const;
/** 回收站保留天数范围。 */
export const TRASH_DAYS_RANGE = { min: 1, max: 365 } as const;
/** 移出后收起的常用延迟，作为下拉框的候选。 */
export const HIDE_DELAYS = [300, 600, 1000] as const;
/** 移出后收起允许输入的范围（毫秒）：太短时指针稍一移出就收起，太长则失去自动收起的意义。 */
export const HIDE_DELAY_RANGE = { min: 100, max: 10_000 } as const;
/** 侧栏出入动画时长范围（毫秒），0 表示关闭动画。 */
export const ANIM_DURATION_RANGE = { min: 0, max: 600, step: 20 } as const;

/** 把数值限制到范围内并取整。 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

/** 校验云端备份配置。 */
function normalizeCloud(value: unknown): CloudSettings {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    enabled: input.enabled === true,
    provider: ['synology', 'google', 'onedrive'].includes(input.provider as string)
      ? (input.provider as CloudSettings['provider'])
      : 'synology',
    endpoint: String(input.endpoint ?? '').slice(0, 1000),
    account: String(input.account ?? '').slice(0, 160),
    folder: String(input.folder ?? 'SideNotes').slice(0, 300),
    lastBackup: Number(input.lastBackup) || 0,
    lastError: String(input.lastError ?? '').slice(0, 500),
    notifications: input.notifications === true,
  };
}

/** 校验并补全设置。缺失项使用默认值，越界项就近校正。 */
export function normalizeSettings(value: unknown = {}): Settings {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    theme: ['light', 'dark', 'system'].includes(input.theme as string)
      ? (input.theme as Settings['theme'])
      : 'light',
    surface: ['standard', 'paper', 'glass', 'win11'].includes(input.surface as string)
      ? (input.surface as Settings['surface'])
      : 'standard',
    // 默认字体与宽度取原型的默认值；空字符串表示用户选择了「系统默认」。
    fontFamily: typeof input.fontFamily === 'string' ? input.fontFamily.slice(0, 120) : 'Segoe UI',
    fontSize: clampInt(input.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, 13),
    edge: input.edge === 'left' ? 'left' : 'right',
    width: clampInt(input.width, WIDTH_RANGE.min, WIDTH_RANGE.max, 416),
    hideDelay: clampInt(input.hideDelay, HIDE_DELAY_RANGE.min, HIDE_DELAY_RANGE.max, 600),
    animDuration: clampInt(input.animDuration, ANIM_DURATION_RANGE.min, ANIM_DURATION_RANGE.max, 260),
    protectEditing: input.protectEditing !== false,
    edgeTrigger: input.edgeTrigger !== false,
    lazyLoading: input.lazyLoading !== false,
    pageSize: clampInt(input.pageSize, PAGE_SIZE_RANGE.min, PAGE_SIZE_RANGE.max, 10),
    tidySnoozeUntil: Number(input.tidySnoozeUntil) || 0,
    tidyLimit: Number.isFinite(Number(input.tidyLimit)) ? clampInt(input.tidyLimit, 0, 100_000, 50) : 50,
    storageLocation: ['appdata', 'portable', 'custom'].includes(input.storageLocation as string)
      ? (input.storageLocation as Settings['storageLocation'])
      : 'appdata',
    customDirectory: String(input.customDirectory ?? '').slice(0, 500),
    trashDays: clampInt(input.trashDays, TRASH_DAYS_RANGE.min, TRASH_DAYS_RANGE.max, 30),
    cloud: normalizeCloud(input.cloud),
  };
}

/** 默认设置。 */
export const DEFAULT_SETTINGS: Settings = normalizeSettings({});

/** 按范围与步长校正手动输入的数值；空值或非数值返回 null。 */
export function boundedNumber(raw: string | number, min: number, max: number, step = 1): number | null {
  if (String(raw).trim() === '') return null;
  const number = Number(raw);
  if (!Number.isFinite(number)) return null;
  const snapped = min + Math.round((number - min) / step) * step;
  return Math.max(min, Math.min(max, Number(snapped.toFixed(6))));
}

/**
 * 解析「移出后收起」的输入：数字默认为毫秒，也可以带 ms、毫秒、s、秒，例如「800」「1.5 秒」。
 * 无法识别时返回 null；范围由调用方校正。
 */
export function parseDelay(raw: string): number | null {
  const match = String(raw ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(ms|毫秒|s|秒)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  return Math.round(unit === 's' || unit === '秒' ? amount * 1000 : amount);
}

/** 解析出实际生效的明暗模式。 */
export function resolveTheme(theme: Settings['theme']): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

/** 生成 CSS 字体族，空值回落到系统默认。 */
export function resolveFontFamily(fontFamily: string): string {
  const name = fontFamily.trim();
  if (!name || name === '系统默认') return '"Segoe UI", "Microsoft YaHei UI", sans-serif';
  // 去掉引号与反斜杠，避免注入额外的 CSS 声明。
  return `"${name.replace(/["\\\r\n]/g, '')}", "Microsoft YaHei UI", sans-serif`;
}
