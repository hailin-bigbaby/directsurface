export interface CalendarDate {
  year: number
  month: number
  day: number
}

export function todayCalendarDate(): CalendarDate {
  const date = new Date()
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  }
}

export function parseISODatePrefix(value: string): CalendarDate | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
}

export function parseISOCalendarDate(value: unknown): CalendarDate | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
  if (
    date.year < 1 ||
    date.month < 1 ||
    date.month > 12 ||
    date.day < 1 ||
    date.day > calendarDaysInMonth(date.year, date.month)
  ) {
    return null
  }
  return date
}

export function formatISOCalendarDate(date: CalendarDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

export function calendarDaysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leap ? 29 : 28
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

export function shiftCalendarDays(date: CalendarDate, delta: number): CalendarDate {
  const shifted = utcCalendarDate(date.year, date.month, date.day + delta)
  return clampSupportedCalendarDate({
    year: shifted.year,
    month: shifted.month,
    day: shifted.day,
  })
}

export function shiftCalendarMonths(date: CalendarDate, delta: number): CalendarDate {
  const minMonthIndex = 12
  const maxMonthIndex = 9_999 * 12 + 11
  const monthIndex = Math.max(
    minMonthIndex,
    Math.min(maxMonthIndex, date.year * 12 + date.month - 1 + delta),
  )
  const year = Math.floor(monthIndex / 12)
  const month = ((monthIndex % 12) + 12) % 12 + 1
  return {
    year,
    month,
    day: Math.min(date.day, calendarDaysInMonth(year, month)),
  }
}

export function firstCalendarDayOfWeek(year: number, month: number): number {
  return utcCalendarDate(year, month, 1).weekday
}

export function compareCalendarDates(left: CalendarDate, right: CalendarDate): number {
  return calendarDateKey(left) - calendarDateKey(right)
}

export function sameCalendarDate(left: CalendarDate, right: CalendarDate): boolean {
  return compareCalendarDates(left, right) === 0
}

export function calendarDateInRange(
  date: CalendarDate,
  start: CalendarDate | null,
  end: CalendarDate | null,
): boolean {
  if (!start || !end) return false
  return compareCalendarDates(date, start) >= 0 &&
    compareCalendarDates(date, end) <= 0
}

function calendarDateKey(date: CalendarDate): number {
  return date.year * 10_000 + date.month * 100 + date.day
}

function utcCalendarDate(
  year: number,
  month: number,
  day: number,
): CalendarDate & { weekday: number } {
  const value = new Date(0)
  value.setUTCHours(0, 0, 0, 0)
  value.setUTCFullYear(year, month - 1, day)
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
    weekday: value.getUTCDay(),
  }
}

function clampSupportedCalendarDate(
  date: CalendarDate,
): CalendarDate {
  if (date.year < 1) return { year: 1, month: 1, day: 1 }
  if (date.year > 9_999) return { year: 9_999, month: 12, day: 31 }
  return date
}
