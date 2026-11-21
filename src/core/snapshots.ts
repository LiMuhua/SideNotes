/**
 * 数据快照的显示文字。
 *
 * 快照由后端创建与恢复（见 bridge.createSnapshot 等），这里只负责设置页列表中的原因与时间写法。
 */

import type { SnapshotReason } from './types';

/** 创建原因的显示文字。 */
export const SNAPSHOT_REASON_LABELS: Record<SnapshotReason, string> = {
  auto: '每天自动',
  manual: '手动',
  import: '导入前',
  delete: '永久删除前',
  migrate: '迁移前',
  restore: '恢复前',
};

/** 原因的显示文字；不认识的原因（将来的版本写入的）原样显示。 */
export function snapshotReason(reason: string): string {
  return SNAPSHOT_REASON_LABELS[reason as SnapshotReason] ?? reason;
}

/**
 * 快照时间：今天写「今天 10:05」，昨天写「昨天 10:05」，今年其它日子省略年份，如「11月3日 10:05」。
 * 云端同步的下一次自动备份也用这个写法，明天的写「明天 03:00」。
 */
export function snapshotTime(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const startOfDay = (value: Date): number => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `今天 ${time}`;
  if (days === 1) return `昨天 ${time}`;
  if (days === -1) return `明天 ${time}`;
  const day = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === new Date(now).getFullYear() ? `${day} ${time}` : `${date.getFullYear()}年${day} ${time}`;
}
