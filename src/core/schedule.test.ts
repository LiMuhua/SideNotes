import { describe, expect, it } from 'vitest';
import { buildSchedule, formatTime, parseSchedule, parseTime } from './schedule';

describe('自动备份的时间', () => {
  it('常用组合拆成频率与时间', () => {
    expect(parseSchedule('0 3 * * *')).toMatchObject({ kind: 'daily', hour: 3, minute: 0 });
    expect(parseSchedule('15 * * * *')).toMatchObject({ kind: 'hourly', minute: 15 });
    expect(parseSchedule('30 22 * * 5')).toMatchObject({ kind: 'weekly', hour: 22, minute: 30, weekday: 5 });
    expect(parseSchedule('0 9 * * 7')).toMatchObject({ kind: 'weekly', weekday: 0 });
    expect(parseSchedule('0 4 1 * *')).toMatchObject({ kind: 'monthly', day: 1, hour: 4 });
    expect(parseSchedule('  0   3 * *  * ')).toMatchObject({ kind: 'daily', hour: 3 });
    expect(parseSchedule('@daily')).toMatchObject({ kind: 'daily', hour: 0, minute: 0 });
  });

  it('对不上常用组合的写法是自定义，保留原文', () => {
    for (const cron of ['0 */6 * * *', '30 22 * * 1-5', '0 0 31 * *', '0 0 1 1 *', '0 0 1 * 1', 'bad', '']) {
      const form = parseSchedule(cron);
      expect(form.kind, cron).toBe('custom');
      expect(buildSchedule(form)).toBe(cron.trim());
    }
  });

  it('写回 crontab，读写往返不变', () => {
    for (const cron of ['0 3 * * *', '15 * * * *', '30 22 * * 5', '0 4 28 * *']) {
      expect(buildSchedule(parseSchedule(cron))).toBe(cron);
    }
    expect(buildSchedule({ kind: 'weekly', minute: 5, hour: 7, weekday: 0, day: 1, cron: '' })).toBe('5 7 * * 0');
  });

  it('时间写成 HH:MM，读的时候检查范围', () => {
    expect(formatTime(3, 5)).toBe('03:05');
    expect(parseTime('3:05')).toEqual({ hour: 3, minute: 5 });
    expect(parseTime('23：59')).toEqual({ hour: 23, minute: 59 });
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('3:5')).toBeNull();
    expect(parseTime('早上')).toBeNull();
  });
});
