/**
 * 时间都按北京时间算：上游跑在国内服务器上，用的是本地时间；Worker 是 UTC。
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
/** 北京时间 = UTC + 8 */
const BEIJING = 8 * HOUR
/** 1970-01-01 是周四 */
const EPOCH_WEEKDAY = 4

export interface WeekBoundary {
  /** 0 = 周日 … 6 = 周六 */
  day: number
  hour: number
  minute: number
}

/** 自然周：周一 0 点 */
export const CALENDAR_WEEK: WeekBoundary = { day: 1, hour: 0, minute: 0 }

function boundaryOffset(b: WeekBoundary): number {
  return ((b.day - EPOCH_WEEKDAY + 7) % 7) * DAY + b.hour * HOUR + b.minute * MINUTE
}

/** 第几周：每跨过一次北京时间的 `b`（星期几几点几分）加 1 */
export function weekIndex(ms: number, b: WeekBoundary): number {
  return Math.floor((ms + BEIJING - boundaryOffset(b)) / WEEK)
}

/** 第 `week` 周开始的时刻（UTC 毫秒） */
export function weekStart(week: number, b: WeekBoundary): number {
  return week * WEEK + boundaryOffset(b) - BEIJING
}

/** 北京时间 `2026/9/28 00:00` */
export function formatBeijing(ms: number): string {
  const d = new Date(ms + BEIJING)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** 北京时间的 ISO 周：`{ year, week }`，上游的「第几周」 */
export function isoWeek(ms: number): { year: number; week: number } {
  const d = new Date(ms + BEIJING)
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7))
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1)
  return { year: day.getUTCFullYear(), week: Math.ceil(((day.getTime() - yearStart) / DAY + 1) / 7) }
}

/** 上游的「X小时Y分钟」 */
export function hoursMinutes(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 3600)}小时${Math.floor((s % 3600) / 60)}分钟`
}

/** 上游打工的「X时Y分Z秒」，高位为 0 时省掉 */
export function hms(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}时${m}分${sec}秒`
  if (m > 0) return `${m}分${sec}秒`
  return `${sec}秒`
}

/** 上游排位赛的「X分Y秒」 */
export function minutesSeconds(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}分${s % 60}秒`
}
