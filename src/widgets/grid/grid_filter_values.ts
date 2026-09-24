import type { GridColumnDef } from './grid_types'
import { gridFilterComparableValue } from './grid_filter_condition'

const objectIds = new WeakMap<object, number>()
const symbolIds = new Map<symbol, number>()
let nextIdentity = 1

export function gridFilterValueKey(value: unknown, blank = value == null || value === ''): string {
  if (blank) return 'blank:'
  if (typeof value === 'string') return `string:${value}`
  if (typeof value === 'number') return `number:${String(value)}`
  if (typeof value === 'boolean') return `boolean:${value}`
  if (typeof value === 'bigint') return `bigint:${value}`
  if (typeof value === 'undefined') return 'undefined:'
  if (typeof value === 'symbol') return `symbol:${identityForSymbol(value)}`
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
    const serialized = canonicalValue(value, new Set<object>())
    if (serialized !== null) return `object:${serialized}`
    return `object:${identityForObject(value as object)}`
  }
  return `${typeof value}:${String(value)}`
}

export function sameGridFilterValue(
  left: unknown,
  right: unknown,
  column: GridColumnDef,
): boolean {
  const leftBlank = left == null || left === ''
  const rightBlank = right == null || right === ''
  if (leftBlank || rightBlank) return leftBlank && rightBlank
  if (column.type === 'number' || column.type === 'date' || column.type === 'time') {
    const leftComparable = gridFilterComparableValue(column, left)
    const rightComparable = gridFilterComparableValue(column, right)
    if (leftComparable !== null && rightComparable !== null) {
      return leftComparable === rightComparable
    }
  }
  return Object.is(left, right) || gridFilterValueKey(left, false) === gridFilterValueKey(right, false)
}

export function gridFilterValueKeyForColumn(
  value: unknown,
  column: GridColumnDef,
  blank = value == null || value === '',
): string {
  if (blank) return 'blank:'
  if (column.type === 'number' || column.type === 'date' || column.type === 'time') {
    const comparable = gridFilterComparableValue(column, value)
    if (comparable !== null) {
      const prefix = column.type === 'number'
        ? 'number'
        : column.type === 'date' ? 'date' : 'time'
      return `${prefix}:${String(comparable)}`
    }
  }
  return gridFilterValueKey(value, false)
}

function canonicalValue(value: unknown, ancestors: Set<object>): string | null {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return `number:${String(value)}`
  if (typeof value === 'boolean') return `boolean:${value}`
  if (typeof value === 'bigint') return `bigint:${value}`
  if (typeof value === 'undefined') return 'undefined'
  if (typeof value === 'symbol' || typeof value === 'function') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'date:invalid' : `date:${value.getTime()}`
  if (typeof value !== 'object') return `${typeof value}:${String(value)}`
  if (ancestors.has(value)) return null
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const parts: string[] = []
      for (const item of value) {
        const serialized = canonicalValue(item, ancestors)
        if (serialized === null) return null
        parts.push(serialized)
      }
      return `[${parts.join(',')}]`
    }
    const parts: string[] = []
    for (const key of Object.keys(value).sort()) {
      const serialized = canonicalValue((value as Record<string, unknown>)[key], ancestors)
      if (serialized === null) return null
      parts.push(`${JSON.stringify(key)}:${serialized}`)
    }
    return `{${parts.join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

function identityForObject(value: object): number {
  const existing = objectIds.get(value)
  if (existing !== undefined) return existing
  const identity = nextIdentity++
  objectIds.set(value, identity)
  return identity
}

function identityForSymbol(value: symbol): number {
  const existing = symbolIds.get(value)
  if (existing !== undefined) return existing
  const identity = nextIdentity++
  symbolIds.set(value, identity)
  return identity
}
