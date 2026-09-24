import {
  resolveGridColumnEditor,
  resolveGridColumnEditorKind,
} from './grid_column_editor'
import type { GridColumnDef, GridFilterOperator } from './grid_types'
import { normalizeTimeValue, timeValueToSeconds } from '../time_value'

export type GridFilterConditionError =
  | 'invalid-number'
  | 'invalid-date'
  | 'invalid-time'
  | 'incomplete-range'
  | 'reversed-range'

export interface GridFilterConditionParseResult {
  active: boolean
  valid: boolean
  value?: unknown
  valueTo?: unknown
  error?: GridFilterConditionError
}

const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:(?:T| )(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/

export function parseGridFilterConditionInput(
  column: GridColumnDef,
  operator: GridFilterOperator,
  input: string,
): GridFilterConditionParseResult {
  if (operator === 'empty' || operator === 'notEmpty') {
    return { active: true, valid: true }
  }

  const text = input.trim()
  if (!text) return { active: false, valid: true }

  if (operator !== 'between') {
    const parsed = parseConditionValue(column, text)
    return parsed.valid
      ? { active: true, valid: true, value: parsed.value }
      : { active: true, valid: false, error: parsed.error }
  }

  const bounds = splitRangeInput(text)
  if (!bounds || !bounds[0] || !bounds[1]) {
    return { active: true, valid: false, error: 'incomplete-range' }
  }
  const left = parseConditionValue(column, bounds[0])
  if (!left.valid) return { active: true, valid: false, error: left.error }
  const right = parseConditionValue(column, bounds[1])
  if (!right.valid) return { active: true, valid: false, error: right.error }

  if (column.type === 'number' || column.type === 'date' || column.type === 'time') {
    const leftComparable = gridFilterComparableValue(column, left.value)
    const rightComparable = gridFilterComparableValue(column, right.value)
    if (leftComparable === null || rightComparable === null) {
      return {
        active: true,
        valid: false,
        error: column.type === 'number'
          ? 'invalid-number'
          : column.type === 'date' ? 'invalid-date' : 'invalid-time',
      }
    }
    if (leftComparable > rightComparable) {
      return { active: true, valid: false, error: 'reversed-range' }
    }
  }

  return {
    active: true,
    valid: true,
    value: left.value,
    valueTo: right.value,
  }
}

export function gridFilterComparableValue(
  column: GridColumnDef,
  value: unknown,
): number | null {
  if (column.type === 'number') return strictNumberValue(value)
  if (column.type === 'date') return strictDateValue(column, value)
  if (column.type === 'time') {
    const editor = resolveGridColumnEditor(column)
    const precision = editor?.kind === 'time' ? editor.precision ?? 'second' : 'second'
    const normalized = normalizeTimeValue(value, precision)
    return normalized === null ? null : timeValueToSeconds(normalized)
  }
  return null
}

export function gridColumnUsesRawFilterEquality(column: GridColumnDef): boolean {
  if (column.type === 'checkbox') return true
  const editorKind = resolveGridColumnEditorKind(column)
  return editorKind === 'select' ||
    editorKind === 'lookup' ||
    editorKind === 'drop-tree' ||
    editorKind === 'drop-tree-grid'
}

function parseConditionValue(
  column: GridColumnDef,
  text: string,
): { valid: true; value: unknown } | { valid: false; error: GridFilterConditionError } {
  if (column.type === 'number') {
    const value = strictNumberValue(text)
    return value === null
      ? { valid: false, error: 'invalid-number' }
      : { valid: true, value }
  }
  if (column.type === 'date') {
    return strictDateValue(column, text) === null
      ? { valid: false, error: 'invalid-date' }
      : { valid: true, value: text }
  }
  if (column.type === 'time') {
    return gridFilterComparableValue(column, text) === null
      ? { valid: false, error: 'invalid-time' }
      : { valid: true, value: text }
  }
  return { valid: true, value: text }
}

function strictNumberValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!NUMBER_PATTERN.test(text)) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

function strictDateValue(column: GridColumnDef, value: unknown): number | null {
  const includeTime = column.type === 'date' && column.showTime === true
  if (value instanceof Date) {
    const timestamp = value.getTime()
    if (!Number.isFinite(timestamp)) return null
    return includeTime
      ? timestamp
      : calendarDateKey(value.getFullYear(), value.getMonth() + 1, value.getDate())
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    if (includeTime) return value
    const date = new Date(value)
    return Number.isFinite(date.getTime())
      ? calendarDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate())
      : null
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  const match = DATE_PATTERN.exec(text)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = match[4] === undefined ? 0 : Number(match[4])
  const minute = match[5] === undefined ? 0 : Number(match[5])
  const second = match[6] === undefined ? 0 : Number(match[6])
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null
  }

  if (match[4] === undefined) {
    if (!includeTime) return calendarDateKey(year, month, day)

    // ECMAScript parses YYYY-MM-DD as UTC. A time-aware Date column presents a
    // date-only input as local midnight, matching a locally constructed Date.
    const localMidnight = Date.parse(`${text}T00:00:00`)
    return Number.isFinite(localMidnight) ? localMidnight : null
  }

  const timestamp = Date.parse(text)
  if (!Number.isFinite(timestamp)) return null
  if (includeTime) return timestamp

  // A string carrying a time or offset represents an instant. Normalize that
  // instant through the local calendar so Date values and their JSON/ISO form
  // retain the same date-only filter semantics.
  const date = new Date(timestamp)
  return calendarDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leap ? 29 : 28
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

function calendarDateKey(year: number, month: number, day: number): number {
  return year * 10_000 + month * 100 + day
}

function splitRangeInput(text: string): [string, string] | null {
  const rangeSeparator = text.indexOf('..')
  if (rangeSeparator >= 0) {
    if (text.indexOf('..', rangeSeparator + 2) >= 0) return null
    return [
      text.slice(0, rangeSeparator).trim(),
      text.slice(rangeSeparator + 2).trim(),
    ]
  }
  const commaSeparator = text.indexOf(',')
  if (commaSeparator < 0 || text.indexOf(',', commaSeparator + 1) >= 0) return null
  return [
    text.slice(0, commaSeparator).trim(),
    text.slice(commaSeparator + 1).trim(),
  ]
}
