export type TimePrecision = 'minute' | 'second'
export type TimeSegment = 'hour' | 'minute' | 'second'

export interface TimeParts {
  hour: number
  minute: number
  second: number
}

const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/
const DATE_TIME_PATTERN = /(?:T| )(\d{2}):(\d{2})(?::(\d{2}))?/

export function parseTimeValue(value: unknown): TimeParts | null {
  if (typeof value !== 'string') return null
  const match = TIME_PATTERN.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? 0)
  if (hour > 23 || minute > 59 || second > 59) return null
  return { hour, minute, second }
}

export function extractTimeValue(value: unknown): TimeParts | null {
  if (typeof value !== 'string') return null
  const match = DATE_TIME_PATTERN.exec(value)
  if (!match) return null
  return parseTimeValue(`${match[1]}:${match[2]}:${match[3] ?? '00'}`)
}

export function formatTimeValue(
  value: TimeParts,
  precision: TimePrecision = 'second',
): string {
  const normalized = normalizeTimeParts(value)
  const hour = String(normalized.hour).padStart(2, '0')
  const minute = String(normalized.minute).padStart(2, '0')
  if (precision === 'minute') return `${hour}:${minute}`
  return `${hour}:${minute}:${String(normalized.second).padStart(2, '0')}`
}

export function normalizeTimeValue(
  value: unknown,
  precision: TimePrecision = 'second',
): string | null {
  const parsed = parseTimeValue(value)
  return parsed ? formatTimeValue(parsed, precision) : null
}

export function normalizeTimeParts(value: TimeParts): TimeParts {
  return {
    hour: clampInteger(value.hour, 0, 23),
    minute: clampInteger(value.minute, 0, 59),
    second: clampInteger(value.second, 0, 59),
  }
}

export function timeValueToSeconds(value: unknown): number | null {
  const parsed = parseTimeValue(value)
  if (!parsed) return null
  return parsed.hour * 3600 + parsed.minute * 60 + parsed.second
}

export function stepTimePart(
  value: TimeParts,
  segment: TimeSegment,
  direction: 1 | -1,
  amount = 1,
): TimeParts {
  const normalized = normalizeTimeParts(value)
  const step = Number.isFinite(amount) && amount > 0
    ? Math.max(1, Math.trunc(amount))
    : 1
  if (segment === 'hour') {
    return {
      ...normalized,
      hour: wrap(normalized.hour + direction * step, 24),
    }
  }
  if (segment === 'minute') {
    return {
      ...normalized,
      minute: wrap(normalized.minute + direction * step, 60),
    }
  }
  return {
    ...normalized,
    second: wrap(normalized.second + direction * step, 60),
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size
}
