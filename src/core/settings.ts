/**
 * 设置的默认值与校验。
 *
 * 所有设置只在此处定义一次：Rust 侧以 JSON 原样存取，读取后统一经过
 * `normalizeSettings` 补全，避免两侧重复维护默认值与边界。
 */

import { normalizeAppIcon } from './appIcons';
import { normalizeBindings } from './shortcuts';
import { normalizeSurface } from './surfaces';
import { tagKey } from './tags';
import type { CloudSettings, Settings } from './types';

/** 侧栏宽度范围（按 13px 字号计，见 sidebarWindowWidth）。 */
export const WIDTH_RANGE = { min: 360, max: 720, step: 4 } as const;
/** 侧栏的默认宽度（按 13px 字号计）。 */
export const DEFAULT_WIDTH = 400;
/** 字号范围：步长 0.5，字号是整页缩放（原型第二版，0.7.3 为 12–20、步长 1）。 */
export const FONT_SIZE_RANGE = { min: 8, max: 24, step: 0.5 } as const;
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

/** 记录窗口的标签页位置，第一项为默认（左侧竖排）。 */
export const WINDOW_TABS = ['side', 'top'] as const;
/** 固定为页签的标签最多几个。 */
export const PINNED_TAGS_LIMIT = 50;

/**
 * 设置的结构版本。
 * 2：默认字体由 Segoe UI 13px 改为随应用打包的 Maple Mono NF CN 16px。
 * 3：界面材质改为五套主题（standard 迁移为 terminal），字体默认跟随主题，字号 8–24、默认 12，
 *    新增应用图标、固定的页签、记录窗口的标签页位置与「编辑时滚到顶部」，去掉「编辑时保持展开」。
 */
export const SETTINGS_VERSION = 3;
/** 字体「跟随主题」：保存为空字符串，界面与正文用主题令牌中的字体。 */
export const FOLLOW_THEME_FONT = '';
/** 字体「系统默认」：Segoe UI 与微软雅黑 UI。 */
export const SYSTEM_FONT = '系统默认';
/** 默认字体：跟随主题。终端主题本身用随应用打包的 Maple Mono NF CN（见 styles/fonts.css）。 */
export const DEFAULT_FONT_FAMILY = FOLLOW_THEME_FONT;
/** 默认字号（界面按 13px 设计，12 即缩放到 12/13）。 */
export const DEFAULT_FONT_SIZE = 12;
/** 版本 3 之前的默认字体：迁移时改为跟随主题，用户选过的其它字体保留。 */
const LEGACY_DEFAULT_FONTS = ['Segoe UI', 'Maple Mono NF CN'];

/**
 * 迁移字体设置：空值表示跟随主题，「系统默认」与其它字体名原样保存。
 *
 * 版本 3 之前空值是用户选的「系统默认」，保留为「系统默认」；旧默认字体（Segoe UI、Maple Mono NF CN）
 * 改为跟随主题；其余字体是用户的显式选择，保留。版本 3 起原样保存，之后再显式选择 Segoe UI 不会被改回。
 */
export function normalizeFontFamily(value: unknown, version: unknown): string {
  const font = typeof value === 'string' ? value.trim().slice(0, 120) : FOLLOW_THEME_FONT;
  if (font === '跟随主题') return FOLLOW_THEME_FONT;
  if (!(Number(version) >= SETTINGS_VERSION)) {
    if (!font && typeof value === 'string') return SYSTEM_FONT;
    if (LEGACY_DEFAULT_FONTS.includes(font)) return FOLLOW_THEME_FONT;
  }
  return font;
}

/** 整理固定为页签的标签：去掉 #、空白、无效与重复的（不分大小写），保留顺序。 */
export function normalizePinnedTags(value: unknown): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const tag = String(raw ?? '').trim().replace(/^#/, '');
    const key = tagKey(tag);
    if (!/^[\p{L}\p{N}_-]{1,40}$/u.test(tag) || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= PINNED_TAGS_LIMIT) break;
  }
  return result;
}

/** 把数值限制到范围内并取整。 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

/** 自动备份的默认时间：每天 3 点（电脑关着的话，下次打开应用时补上）。与后端 cloud::DEFAULT_SCHEDULE 一致。 */
export const DEFAULT_CLOUD_SCHEDULE = '0 3 * * *';

/** 规范远程文件夹：以 / 开头，反斜杠当作斜杠，去掉多余与末尾的斜杠；空的用 /SideNotes。 */
export function normalizeRemoteFolder(value: unknown): string {
  const segments = String(value ?? '')
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.length ? `/${segments.join('/')}`.slice(0, 300) : '/SideNotes';
}

/** 校验云端同步配置。旧版的 lastBackup、lastError 改由后端记录，读到时丢掉。 */
function normalizeCloud(value: unknown): CloudSettings {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const schedule = String(input.schedule ?? '').trim();
  return {
    enabled: input.enabled === true,
    provider: ['synology', 'google', 'onedrive'].includes(input.provider as string)
      ? (input.provider as CloudSettings['provider'])
      : 'synology',
    endpoint: String(input.endpoint ?? '').slice(0, 1000),
    account: String(input.account ?? '').slice(0, 160),
    tlsName: String(input.tlsName ?? '').trim().slice(0, 253),
    folder: normalizeRemoteFolder(input.folder),
    schedule: (schedule || DEFAULT_CLOUD_SCHEDULE).slice(0, 120),
    notifications: input.notifications === true,
    email: String(input.email ?? '').trim().slice(0, 254),
    emailFrom: String(input.emailFrom ?? '').trim().slice(0, 254),
  };
}

/** 校验并补全设置。缺失项使用默认值，越界项就近校正。 */
export function normalizeSettings(value: unknown = {}): Settings {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const version = Number(input.settingsVersion) || 1;
  const fontFamily = normalizeFontFamily(input.fontFamily, version);
  // 字号按 0.5 取整；没有保存过时用默认值。版本 1 的默认是 Segoe UI 13px，仍是这组值时视为没有改过，换成默认字号。
  let fontSize = boundedNumber(
    input.fontSize === null || input.fontSize === undefined ? '' : (input.fontSize as number),
    FONT_SIZE_RANGE.min,
    FONT_SIZE_RANGE.max,
    FONT_SIZE_RANGE.step,
  ) ?? DEFAULT_FONT_SIZE;
  if (version < 2 && input.fontFamily === 'Segoe UI' && fontSize === 13) fontSize = DEFAULT_FONT_SIZE;
  return {
    settingsVersion: SETTINGS_VERSION,
    theme: ['light', 'dark', 'system'].includes(input.theme as string)
      ? (input.theme as Settings['theme'])
      : 'light',
    surface: normalizeSurface(input.surface),
    fontFamily,
    fontSize,
    appIcon: normalizeAppIcon(input.appIcon),
    edge: input.edge === 'left' ? 'left' : 'right',
    width: clampInt(input.width, WIDTH_RANGE.min, WIDTH_RANGE.max, DEFAULT_WIDTH),
    hideDelay: clampInt(input.hideDelay, HIDE_DELAY_RANGE.min, HIDE_DELAY_RANGE.max, 600),
    animDuration: clampInt(input.animDuration, ANIM_DURATION_RANGE.min, ANIM_DURATION_RANGE.max, 260),
    scrollOnEdit: input.scrollOnEdit !== false,
    edgeTrigger: input.edgeTrigger !== false,
    cardMaxHeight: clampInt(input.cardMaxHeight, CARD_HEIGHT_RANGE.min, CARD_HEIGHT_RANGE.max, DEFAULT_CARD_HEIGHT),
    toastPosition: TOAST_POSITIONS.includes(input.toastPosition as Settings['toastPosition'])
      ? (input.toastPosition as Settings['toastPosition'])
      : TOAST_POSITIONS[0],
    windowTabs: input.windowTabs === 'top' ? 'top' : WINDOW_TABS[0],
    pinnedTags: normalizePinnedTags(input.pinnedTags),
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
    shortcuts: normalizeBindings(input.shortcuts),
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

/**
 * 生成 CSS 字体族：跟随主题时返回 null，由主题令牌决定界面与正文的字体；
 * 「系统默认」是 Segoe UI 与微软雅黑 UI；其它字体名放在最前，本机没有时回落到微软雅黑 UI。
 */
export function resolveFontFamily(fontFamily: string): string | null {
  const name = fontFamily.trim();
  if (!name) return null;
  if (name === SYSTEM_FONT) return '"Segoe UI", "Microsoft YaHei UI", sans-serif';
  // 去掉引号与反斜杠，避免注入额外的 CSS 声明。
  return `"${name.replace(/["\\\r\n]/g, '')}", "Microsoft YaHei UI", sans-serif`;
}
