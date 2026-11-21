//! 自动备份的时间：crontab 的五段写法（分 时 日 月 周），按本地时间算下一次。
//!
//! 每段可以写 `*`、数值、范围 `a-b`、步长 `*/n`、`a-b/n`、`a/n`（从 a 到最大值）与逗号分隔的列表；月份与星期也可以写
//! 英文缩写（JAN、MON……），星期的 0 与 7 都是星期日。另外认 `@hourly`、`@daily`（`@midnight`）、`@weekly`、`@monthly`、
//! `@yearly`（`@annually`）。日与星期都不是 `*` 时，两者满足一个即可（与 Vixie cron 相同）。

use chrono::{Datelike, Duration, Local, NaiveDate, NaiveDateTime, TimeZone, Timelike};

/// 解析好的时间表。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Schedule {
    minutes: u64,
    hours: u64,
    days: u64,
    months: u64,
    weekdays: u64,
    /// 日这一段写的不是 `*`。
    days_restricted: bool,
    /// 星期这一段写的不是 `*`。
    weekdays_restricted: bool,
}

/// 一段的取值范围与可以用的英文名。
struct Field {
    name: &'static str,
    min: u32,
    max: u32,
    names: &'static [&'static str],
}

const MINUTE: Field = Field { name: "分", min: 0, max: 59, names: &[] };
const HOUR: Field = Field { name: "时", min: 0, max: 23, names: &[] };
const DAY: Field = Field { name: "日", min: 1, max: 31, names: &[] };
const MONTH: Field = Field {
    name: "月",
    min: 1,
    max: 12,
    names: &["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"],
};
const WEEKDAY: Field = Field { name: "周", min: 0, max: 7, names: &["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] };

/// 往后找下一次的上限：四年里都碰不到的（例如 2 月 30 日）视为永远不会到。
const SEARCH_DAYS: i64 = 4 * 366;

fn value(field: &Field, text: &str) -> Result<u32, String> {
    let upper = text.to_ascii_uppercase();
    if let Some(index) = field.names.iter().position(|name| *name == upper) {
        // 月份的名字从 1 开始，星期从 0（SUN）开始。
        return Ok(index as u32 + field.min);
    }
    let number: u32 = text.parse().map_err(|_| format!("「{}」这一段的「{text}」不是数字", field.name))?;
    if number < field.min || number > field.max {
        return Err(format!("「{}」这一段只能是 {}–{}，「{text}」超出了范围", field.name, field.min, field.max));
    }
    Ok(number)
}

/// 解析一段，返回取值的位集与这一段是不是 `*`。
fn parse_field(field: &Field, text: &str) -> Result<(u64, bool), String> {
    let mut bits = 0u64;
    let star = text == "*";
    for part in text.split(',') {
        if part.is_empty() {
            return Err(format!("「{}」这一段有空的项", field.name));
        }
        let (range, step) = match part.split_once('/') {
            Some((range, step)) => {
                let step: u32 = step.parse().map_err(|_| format!("「{}」这一段的步长「{step}」不是数字", field.name))?;
                if step == 0 {
                    return Err(format!("「{}」这一段的步长不能是 0", field.name));
                }
                (range, step)
            }
            None => (part, 1),
        };
        let (start, end) = if range == "*" {
            (field.min, field.max)
        } else if let Some((start, end)) = range.split_once('-') {
            let (start, end) = (value(field, start)?, value(field, end)?);
            if start > end {
                return Err(format!("「{}」这一段的范围「{range}」前大后小", field.name));
            }
            (start, end)
        } else {
            let start = value(field, range)?;
            // `a/n` 表示从 a 开始、每 n 个一次，直到最大值。
            (start, if part.contains('/') { field.max } else { start })
        };
        let mut current = start;
        while current <= end {
            bits |= 1 << current;
            current += step;
        }
    }
    Ok((bits, star))
}

impl Schedule {
    /// 解析时间表；格式不对时返回给用户看的原因。
    pub fn parse(text: &str) -> Result<Self, String> {
        let text = text.trim();
        let expanded = match text.to_ascii_lowercase().as_str() {
            "@hourly" => "0 * * * *",
            "@daily" | "@midnight" => "0 0 * * *",
            "@weekly" => "0 0 * * 0",
            "@monthly" => "0 0 1 * *",
            "@yearly" | "@annually" => "0 0 1 1 *",
            _ if text.starts_with('@') => return Err(format!("不认识「{text}」")),
            _ => text,
        };
        let parts: Vec<&str> = expanded.split_whitespace().collect();
        if parts.len() != 5 {
            return Err("要写五段：分 时 日 月 周，例如 0 3 * * *".into());
        }
        let (minutes, _) = parse_field(&MINUTE, parts[0])?;
        let (hours, _) = parse_field(&HOUR, parts[1])?;
        let (days, days_star) = parse_field(&DAY, parts[2])?;
        let (months, _) = parse_field(&MONTH, parts[3])?;
        let (mut weekdays, weekdays_star) = parse_field(&WEEKDAY, parts[4])?;
        // 7 也是星期日。
        if weekdays & (1 << 7) != 0 {
            weekdays = (weekdays & !(1 << 7)) | 1;
        }
        let schedule = Schedule {
            minutes,
            hours,
            days,
            months,
            weekdays,
            days_restricted: !days_star,
            weekdays_restricted: !weekdays_star,
        };
        // 先确认四年内碰得到，例如 2 月 30 日永远不会到。
        let probe = NaiveDate::from_ymd_opt(2024, 1, 1).and_then(|date| date.and_hms_opt(0, 0, 0));
        if probe.and_then(|start| schedule.next_naive(start)).is_none() {
            return Err("按这个写法永远不会到，请检查日与月".into());
        }
        Ok(schedule)
    }

    fn day_matches(&self, date: NaiveDate) -> bool {
        let day = self.days & (1 << date.day()) != 0;
        let weekday = self.weekdays & (1 << date.weekday().num_days_from_sunday()) != 0;
        match (self.days_restricted, self.weekdays_restricted) {
            (true, true) => day || weekday,
            (true, false) => day,
            (false, true) => weekday,
            (false, false) => true,
        }
    }

    /// `after` 之后（不含）第一个满足时间表的整分钟，按本地的日历算。
    fn next_naive(&self, after: NaiveDateTime) -> Option<NaiveDateTime> {
        let start = after.with_second(0)?.with_nanosecond(0)? + Duration::minutes(1);
        let limit = start + Duration::days(SEARCH_DAYS);
        let mut current = start;
        while current < limit {
            if self.months & (1 << current.month()) == 0 {
                // 跳到下个月的第一天零点。
                let (year, month) = if current.month() == 12 { (current.year() + 1, 1) } else { (current.year(), current.month() + 1) };
                current = NaiveDate::from_ymd_opt(year, month, 1)?.and_hms_opt(0, 0, 0)?;
                continue;
            }
            if !self.day_matches(current.date()) {
                current = (current.date() + Duration::days(1)).and_hms_opt(0, 0, 0)?;
                continue;
            }
            if self.hours & (1 << current.hour()) == 0 {
                current = current.with_minute(0)? + Duration::hours(1);
                continue;
            }
            if self.minutes & (1 << current.minute()) == 0 {
                current += Duration::minutes(1);
                continue;
            }
            return Some(current);
        }
        None
    }

    /// 毫秒时间戳 `after` 之后（不含）的下一次，返回毫秒时间戳。夏令时跳过的时刻取跳过之后最早的有效时间。
    pub fn next_after(&self, after: i64) -> Option<i64> {
        let local = Local.timestamp_millis_opt(after).single()?.naive_local();
        let mut candidate = local;
        // 夏令时里不存在的本地时刻要再往后找。
        for _ in 0..4 {
            let next = self.next_naive(candidate)?;
            if let Some(time) = Local.from_local_datetime(&next).earliest() {
                return Some(time.timestamp_millis());
            }
            candidate = next;
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(text: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M").unwrap()
    }

    fn next(expression: &str, after: &str) -> String {
        Schedule::parse(expression).unwrap().next_naive(at(after)).unwrap().format("%Y-%m-%d %H:%M").to_string()
    }

    #[test]
    fn finds_the_next_minute_that_matches() {
        assert_eq!(next("0 * * * *", "2026-11-21 16:30"), "2026-11-21 17:00");
        assert_eq!(next("0 3 * * *", "2026-11-21 16:30"), "2026-11-22 03:00");
        assert_eq!(next("*/15 * * * *", "2026-11-21 16:30"), "2026-11-21 16:45");
        assert_eq!(next("30 9-17/4 * * *", "2026-11-21 13:31"), "2026-11-21 17:30");
        // 正好在整点：要的是之后的一次。
        assert_eq!(next("0 * * * *", "2026-11-21 17:00"), "2026-11-21 18:00");
        // 跨年、跨月。
        assert_eq!(next("0 0 1 1 *", "2026-11-21 16:30"), "2027-01-01 00:00");
        assert_eq!(next("0 12 31 * *", "2026-11-21 16:30"), "2026-12-31 12:00");
    }

    #[test]
    fn weekdays_names_and_sunday_as_seven() {
        // 2026-11-21 是星期六。
        assert_eq!(next("0 9 * * MON-FRI", "2026-11-21 08:00"), "2026-11-23 09:00");
        assert_eq!(next("0 9 * * 7", "2026-11-21 08:00"), "2026-11-22 09:00");
        assert_eq!(next("0 9 * * 0", "2026-11-21 08:00"), "2026-11-22 09:00");
        assert_eq!(next("0 0 * FEB *", "2026-11-21 08:00"), "2027-02-01 00:00");
        // 日与星期都写了：满足一个即可。2026-11-25 是星期三，比 12 月 1 日先到。
        assert_eq!(next("0 0 1 * WED", "2026-11-21 08:00"), "2026-11-25 00:00");
    }

    #[test]
    fn macros_and_steps_from_a_start() {
        assert_eq!(Schedule::parse("@daily").unwrap(), Schedule::parse("0 0 * * *").unwrap());
        assert_eq!(Schedule::parse("@hourly").unwrap(), Schedule::parse("0 * * * *").unwrap());
        assert_eq!(next("5/20 * * * *", "2026-11-21 16:30"), "2026-11-21 16:45");
        assert_eq!(next("0 0 29 2 *", "2026-11-21 16:30"), "2028-02-29 00:00");
    }

    #[test]
    fn rejects_malformed_expressions_with_a_reason() {
        for bad in ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "*/0 * * * *", "5-1 * * * *", "a * * * *", "@sometimes", "0 0 30 2 *"] {
            assert!(Schedule::parse(bad).is_err(), "{bad} 应当报错");
        }
        assert!(Schedule::parse("0 0 30 2 *").unwrap_err().contains("永远不会到"));
    }

    #[test]
    fn next_after_returns_a_later_timestamp() {
        let schedule = Schedule::parse("*/5 * * * *").unwrap();
        let now = Local::now().timestamp_millis();
        let next = schedule.next_after(now).unwrap();
        assert!(next > now && next - now <= 5 * 60_000);
        assert_eq!(Local.timestamp_millis_opt(next).single().unwrap().minute() % 5, 0);
    }
}
