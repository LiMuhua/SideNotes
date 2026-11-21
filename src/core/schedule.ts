/**
 * 自动备份的时间：设置里存 crontab 的五段写法（分 时 日 月 周），界面上用「频率 + 时间」的常用组合来改，
 * 对不上常用组合的写法显示为「自定义」，直接改 crontab（第十一轮反馈）。
 * crontab 的完整校验与下一次的计算在后端（cloud::cron），这里只认几种固定的写法。
 */

/** 频率。 */
export type ScheduleKind = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

/** 界面上的时间表。 */
export interface ScheduleForm {
  kind: ScheduleKind;
  /** 0–59。 */
  minute: number;
  /** 0–23。 */
  hour: number;
  /** 星期：0 是星期日，与 crontab 相同。 */
  weekday: number;
  /** 每月的哪一天：1–28（更大的日子不是每个月都有）。 */
  day: number;
  /** 自定义时的 crontab。 */
  cron: string;
}

/** 频率下拉框的选项。 */
export const SCHEDULE_KINDS: ReadonlyArray<readonly [ScheduleKind, string]> = [
  ['hourly', '每小时'],
  ['daily', '每天'],
  ['weekly', '每周'],
  ['monthly', '每月'],
  ['custom', '自定义'],
];

/** 星期的选项，从星期一排起。 */
export const WEEKDAYS: ReadonlyArray<readonly [number, string]> = [
  [1, '星期一'],
  [2, '星期二'],
  [3, '星期三'],
  [4, '星期四'],
  [5, '星期五'],
  [6, '星期六'],
  [0, '星期日'],
];

/** 每月的哪一天：1–28 号。 */
export const MONTH_DAYS: ReadonlyArray<readonly [number, string]> = Array.from({ length: 28 }, (_, index) => [index + 1, `${index + 1} 号`] as const);

const MACROS: Readonly<Record<string, string>> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
};

/** 一段纯数字，且在范围之内。 */
function number(text: string, min: number, max: number): number | null {
  if (!/^\d{1,2}$/.test(text)) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

/** 读 crontab：是常用组合时拆成频率与时间，否则是自定义。 */
export function parseSchedule(cron: string): ScheduleForm {
  const text = cron.trim().replace(/\s+/g, ' ');
  const expanded = MACROS[text.toLowerCase()] ?? text;
  const form: ScheduleForm = { kind: 'custom', minute: 0, hour: 3, weekday: 1, day: 1, cron: text };
  const parts = expanded.split(' ');
  if (parts.length !== 5) return form;
  const [minuteText, hourText, dayText, monthText, weekdayText] = parts;
  const minute = number(minuteText, 0, 59);
  if (minute === null || monthText !== '*') return form;
  if (hourText === '*' && dayText === '*' && weekdayText === '*') return { ...form, kind: 'hourly', minute };
  const hour = number(hourText, 0, 23);
  if (hour === null) return form;
  if (dayText === '*' && weekdayText === '*') return { ...form, kind: 'daily', minute, hour };
  if (dayText === '*') {
    const weekday = number(weekdayText, 0, 7);
    return weekday === null ? form : { ...form, kind: 'weekly', minute, hour, weekday: weekday % 7 };
  }
  if (weekdayText === '*') {
    const day = number(dayText, 1, 28);
    return day === null ? form : { ...form, kind: 'monthly', minute, hour, day };
  }
  return form;
}

/** 按界面上的时间表写回 crontab。 */
export function buildSchedule(form: ScheduleForm): string {
  const { minute, hour } = form;
  switch (form.kind) {
    case 'hourly':
      return `${minute} * * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${form.weekday}`;
    case 'monthly':
      return `${minute} ${hour} ${form.day} * *`;
    default:
      return form.cron.trim();
  }
}

/** 时间写成 HH:MM。 */
export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 读 HH:MM（也认 H:MM 与全角冒号）；写法不对时返回 null。 */
export function parseTime(text: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2})[:：](\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}
