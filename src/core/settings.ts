/**
 * 设置的默认值与校验。
 *
 * 所有设置只在此处定义一次：Rust 侧以 JSON 原样存取，读取后统一经过
 * `normalizeSettings` 补全，避免两侧重复维护默认值与边界。
 */

import type { CloudSettings, Settings } from './types';

/** 侧栏宽度范围（按 13px 字号计，见 sidebarWindowWidth）。 */
export const WIDTH_RANGE = { min: 360, max: 720, step: 4 } as const;
/** 字号范围。 */
export const FONT_SIZE_RANGE = { min: 12, max: 20, step: 1 } as const;
/**
 * 界面的设计字号：原型按正文 13px 设计各处的字号与间距。
 * 字号设置是全局的界面缩放，整页缩放到「字号 ÷ 13」倍后，正文正好显示为所选字号。
 */
export const BASE_FONT_SIZE = 13;
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
/** 卡片正文最大高度范围（按 13px 字号计的网页像素）。 */
export const CARD_HEIGHT_RANGE = { min: 120, max: 600, step: 10 } as const;
/** 卡片正文的默认最大高度：原型为 186，按用户要求略微加大。 */
export const DEFAULT_CARD_HEIGHT = 220;
/** 提示条位置的可选值，第一项为默认。 */
export const TOAST_POSITIONS = ['top-center', 'top-right', 'bottom-center'] as const;

/**
 * 设置的结构版本。
 * 2：默认字体由 Segoe UI 13px 改为随应用打包的 Maple Mono NF CN 16px。
 */
export const SETTINGS_VERSION = 2;
/** 默认字体，随应用一起打包（见 styles/fonts.css）。 */
export const DEFAULT_FONT_FAMILY = 'Maple Mono NF CN';
/** 默认字号。 */
export const DEFAULT_FONT_SIZE = 16;

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
  // 空字符串表示用户选择了「系统默认」。
  let fontFamily = typeof input.fontFamily === 'string' ? input.fontFamily.slice(0, 120) : DEFAULT_FONT_FAMILY;
  let fontSize = clampInt(input.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, DEFAULT_FONT_SIZE);
  // 版本 1 的默认字体是 Segoe UI 13px：仍是这组值时视为没有改过，换成新的默认字体与字号。
  if ((Number(input.settingsVersion) || 1) < 2 && fontFamily === 'Segoe UI' && fontSize === 13) {
    fontFamily = DEFAULT_FONT_FAMILY;
    fontSize = DEFAULT_FONT_SIZE;
  }
  return {
    settingsVersion: SETTINGS_VERSION,
    theme: ['light', 'dark', 'system'].includes(input.theme as string)
      ? (input.theme as Settings['theme'])
      : 'light',
    surface: ['standard', 'paper', 'glass', 'win11'].includes(input.surface as string)
      ? (input.surface as Settings['surface'])
      : 'standard',
    fontFamily,
    fontSize,
    edge: input.edge === 'left' ? 'left' : 'right',
    width: clampInt(input.width, WIDTH_RANGE.min, WIDTH_RANGE.max, 416),
    hideDelay: clampInt(input.hideDelay, HIDE_DELAY_RANGE.min, HIDE_DELAY_RANGE.max, 600),
    animDuration: clampInt(input.animDuration, ANIM_DURATION_RANGE.min, ANIM_DURATION_RANGE.max, 260),
    protectEditing: input.protectEditing !== false,
    edgeTrigger: input.edgeTrigger !== false,
    cardMaxHeight: clampInt(input.cardMaxHeight, CARD_HEIGHT_RANGE.min, CARD_HEIGHT_RANGE.max, DEFAULT_CARD_HEIGHT),
    toastPosition: TOAST_POSITIONS.includes(input.toastPosition as Settings['toastPosition'])
      ? (input.toastPosition as Settings['toastPosition'])
      : TOAST_POSITIONS[0],
    guideSeen: input.guideSeen === true,
    lazyLoading: input.lazyLoading !== false,
    pageSize: clampInt(input.pageSize, PAGE_SIZE_RANGE.min, PAGE_SIZE_RANGE.max, 10),
    tidySnoozeUntil: Number(input.tidySnoozeUntil) || 0,
    tidyLimit: Number.isFinite(Number(input.tidyLimit)) ? clampInt(input.tidyLimit, 0, 100_000, 50) : 50,
    storageLocation: ['appdata', 'portable', 'custom'].includes(input.storageLocation as string)
      ? (input.storageLocation as Settings['storageLocation'])
      : 'appdata',
    customDirectory: String(input.customDirectory ?? '').slice(0, 500),
    snapshotDirectory: String(input.snapshotDirectory ?? '').trim().slice(0, 500),
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

/** 字号对应的界面缩放倍数。 */
export function uiZoom(fontSize: number): number {
  return fontSize / BASE_FONT_SIZE;
}

/**
 * 侧栏窗口的逻辑宽度。设置中的宽度按 13px 字号计，字号调大时随界面缩放等比加宽，
 * 侧栏内容的排布与原来一致，不会因为文字变大而变挤。
 */
export function sidebarWindowWidth(width: number, fontSize: number): number {
  return Math.round(width * uiZoom(fontSize));
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
