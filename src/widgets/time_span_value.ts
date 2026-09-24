export type TimeSpanPrecision = 'minute' | 'second'
export type TimeSpanSegment = 'days' | 'hours' | 'minutes' | 'seconds'

export interface TimeSpanParts {
  negative: boolean
  days: number
  hours: number
  minutes: number
  seconds: number
}

export interface TimeSpanValueOptions {
  precision?: TimeSpanPrecision
  allowNegative?: boolean
}

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export function normalizeTimeSpanValue(
  value: number | null | undefined,
  options: TimeSpanValueOptions = {},
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const precision = options.precision ?? 'second'
  const allowNegative = options.allowNegative ?? false
  const quantum = precision === 'minute' ? MINUTE_MS : SECOND_MS
  if (!allowNegative && value < 0) return 0
  const negative = value < 0
  const absolute = Math.abs(Math.trunc(value))
  const maxRepresentable = Math.floor(Number.MAX_SAFE_INTEGER / quantum) * quantum
  const normalized = Math.min(maxRepresentable, Math.floor(absolute / quantum) * quantum)
  return negative && normalized > 0 ? -normalized : normalized
}

export function decomposeTimeSpanValue(
  value: number,
  options: TimeSpanValueOptions = {},
): TimeSpanParts {
  const normalized = normalizeTimeSpanValue(value, {
    ...options,
    allowNegative: true,
  }) ?? 0
  let remainder = Math.abs(normalized)
  const days = Math.floor(remainder / DAY_MS)
  remainder -= days * DAY_MS
  const hours = Math.floor(remainder / HOUR_MS)
  remainder -= hours * HOUR_MS
  const minutes = Math.floor(remainder / MINUTE_MS)
  remainder -= minutes * MINUTE_MS
  const seconds = Math.floor(remainder / SECOND_MS)
  return {
    negative: normalized < 0,
    days,
    hours,
    minutes,
    seconds: options.precision === 'minute' ? 0 : seconds,
  }
}

export function composeTimeSpanValue(
  parts: TimeSpanParts,
  options: TimeSpanValueOptions = {},
): number {
  const precision = options.precision ?? 'second'
  const allowNegative = options.allowNegative ?? false
  const days = Math.min(
    Math.floor(Number.MAX_SAFE_INTEGER / DAY_MS),
    nonNegativeInteger(parts.days),
  )
  const hours = clampInteger(parts.hours, 0, 23)
  const minutes = clampInteger(parts.minutes, 0, 59)
  const seconds = precision === 'minute'
    ? 0
    : clampInteger(parts.seconds, 0, 59)
  const absolute =
    days * DAY_MS +
    hours * HOUR_MS +
    minutes * MINUTE_MS +
    seconds * SECOND_MS
  const signed = allowNegative && parts.negative && absolute > 0
    ? -absolute
    : absolute
  return normalizeTimeSpanValue(signed, { precision, allowNegative }) ?? 0
}

export function stepTimeSpanValue(
  value: number | null,
  segment: TimeSpanSegment,
  direction: 1 | -1,
  amount = 1,
  options: TimeSpanValueOptions = {},
): number {
  const precision = options.precision ?? 'second'
  if (segment === 'seconds' && precision !== 'second') {
    return normalizeTimeSpanValue(value ?? 0, options) ?? 0
  }
  const step = positiveInteger(amount)
  const unit = segment === 'days'
    ? DAY_MS
    : segment === 'hours'
      ? HOUR_MS
      : segment === 'minutes' ? MINUTE_MS : SECOND_MS
  const normalized = normalizeTimeSpanValue(value ?? 0, options) ?? 0
  const next = normalized + direction * step * unit
  return normalizeTimeSpanValue(next, options) ?? 0
}

export function formatTimeSpanValue(
  value: number,
  options: TimeSpanValueOptions = {},
): string {
  const precision = options.precision ?? 'second'
  const parts = decomposeTimeSpanValue(value, { precision, allowNegative: true })
  const sign = parts.negative ? '-' : ''
  const core = `${parts.days}d ${twoDigits(parts.hours)}:${twoDigits(parts.minutes)}`
  return precision === 'minute'
    ? `${sign}${core}`
    : `${sign}${core}:${twoDigits(parts.seconds)}`
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function positiveInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  return Math.max(1, Math.trunc(value))
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}
