import type { ChartAxisType, ChartDomain, ChartPoint, ChartX } from './chart_types'

export interface LinearScale {
  domainMin: number
  domainMax: number
  rangeMin: number
  rangeMax: number
  map(value: number): number
}

export interface LinearDomainOptions {
  includeZero?: boolean
  paddingRatio?: number
}

export interface TimeTick {
  value: number
  label: string
}

export function chartXValue(value: ChartX, index: number, axisType: ChartAxisType = 'auto'): number {
  if (typeof value === 'number') return value
  if (value instanceof Date) {
    return value.getTime()
  }
  if (axisType === 'time') return Date.parse(value)
  return index
}

export function cloneChartX(value: ChartX): ChartX {
  return value instanceof Date ? new Date(value.getTime()) : value
}

export function normalizeChartNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

export function formatChartX(value: ChartX): string {
  if (value instanceof Date) return formatChartTime(value.getTime())
  return String(value)
}

export function normalizeChartDomain(values: readonly number[], fallback: ChartDomain = { min: 0, max: 1 }): ChartDomain {
  const finiteValues = values.filter(Number.isFinite)
  if (finiteValues.length === 0) return { ...fallback }
  return normalizeLinearDomain(finiteValues)
}

export function sanitizeChartDomain(domain: ChartDomain, fallback: ChartDomain): ChartDomain {
  const min = Math.min(domain.min, domain.max)
  const max = Math.max(domain.min, domain.max)
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ...fallback }
  if (min === max) return normalizeLinearDomain([min])
  return { min, max }
}

export function clampChartDomain(
  domain: ChartDomain,
  fullDomain: ChartDomain,
  options: { minSpan?: number; maxSpan?: number } = {},
): ChartDomain {
  const full = sanitizeChartDomain(fullDomain, { min: 0, max: 1 })
  const fullSpan = full.max - full.min
  const precision = Math.max(Number.MIN_VALUE, Math.max(Math.abs(full.min), Math.abs(full.max)) * Number.EPSILON)
  const requestedMin = Number.isFinite(options.minSpan) && options.minSpan! > 0 ? options.minSpan! : fullSpan / 10000
  const minSpan = Math.min(fullSpan, Math.max(precision, requestedMin))
  const maxSpan = Math.min(fullSpan, Math.max(minSpan, Number.isFinite(options.maxSpan) && options.maxSpan! > 0 ? options.maxSpan! : fullSpan))
  let next = sanitizeChartDomain(domain, full)
  let span = next.max - next.min
  const center = next.min + (next.max - next.min) / 2
  if (span < minSpan) {
    span = minSpan
    next = { min: center - span / 2, max: center + span / 2 }
  } else if (span > maxSpan) {
    span = maxSpan
    next = { min: center - span / 2, max: center + span / 2 }
  }
  if (next.min < full.min) {
    next = { min: full.min, max: full.min + span }
  }
  if (next.max > full.max) {
    next = { min: full.max - span, max: full.max }
  }
  return {
    min: Math.max(full.min, next.min),
    max: Math.min(full.max, next.max),
  }
}

export function normalizeLinearDomain(
  values: readonly number[],
  options: LinearDomainOptions = {},
): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
  }
  if (min === Infinity) {
    min = 0
    max = 1
  }
  if (options.includeZero) {
    min = Math.min(0, min)
    max = Math.max(0, max)
  }
  if (min === max) {
    const delta = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1
    min -= delta
    max += delta
  }
  const padding = (max - min) * (options.paddingRatio ?? 0)
  return { min: min - padding, max: max + padding }
}

export function createLinearScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): LinearScale {
  const domainSpan = domainMax - domainMin
  const rangeSpan = rangeMax - rangeMin
  return {
    domainMin,
    domainMax,
    rangeMin,
    rangeMax,
    map(value: number): number {
      if (domainSpan === 0) return rangeMin + rangeSpan / 2
      return rangeMin + ((value - domainMin) / domainSpan) * rangeSpan
    },
  }
}

export function collectYValues(series: readonly { data: readonly ChartPoint[] }[]): number[] {
  return series.flatMap(entry => entry.data.flatMap(point =>
    point.y !== null && Number.isFinite(point.y) ? [point.y] : [],
  ))
}

// Bound work independently of caller tickCount and never advance by repeated floating-point addition.
const MAX_TICKS = 1000

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(count) || count <= 0 || min > max) return []
  if (min === max) return [min]
  const limit = Math.min(MAX_TICKS - 2, Math.max(1, Math.floor(count)))
  const precision = Math.max(Number.MIN_VALUE, Math.max(Math.abs(min), Math.abs(max)) * Number.EPSILON)
  const span = max - min
  // A rounded nice step can require more ticks than the work budget; increase it
  // rather than truncating the right-hand portion of the domain.
  let step = Math.max(precision, niceNumber(span / limit, true))
  if (span / step > MAX_TICKS - 2) step = Math.max(precision, niceNumber(span / (MAX_TICKS - 2), false))
  if (!Number.isFinite(step) || step <= 0) return [min, max]
  // Start one step below when division rounds up at an exact decimal boundary.
  const first = Math.floor(min / step) * step
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  const ticks: number[] = []
  for (let index = 0; index < MAX_TICKS; index += 1) {
    const value = first + index * step
    if (!Number.isFinite(value)) break
    const tick = decimals <= 100 ? Number(value.toFixed(decimals)) : Number(value.toPrecision(15))
    if (tick > max) break
    if (tick >= min && (ticks.length === 0 || tick > ticks[ticks.length - 1]!)) ticks.push(tick)
    if (index > 0 && value <= first + (index - 1) * step) break
  }
  return ticks.length > 0 ? ticks : [min, max]
}

/** Relative comparison keeps sub-unit viewports distinct while tolerating arithmetic noise. */
export function sameChartDomain(a: ChartDomain, b: ChartDomain): boolean {
  const tolerance = Math.max(Number.MIN_VALUE,
    Math.abs(a.max - a.min) * 1e-12, Math.abs(b.max - b.min) * 1e-12)
  return Math.abs(a.min - b.min) <= tolerance && Math.abs(a.max - b.max) <= tolerance
}

export function formatChartNumber(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1000000) return `${trimNumber(value / 1000000)}M`
  if (abs >= 1000) return `${trimNumber(value / 1000)}k`
  if (abs >= 100 || Number.isInteger(value)) return String(Math.round(value))
  return abs > 0 && abs < 0.1 ? String(Number(value.toPrecision(6))) : trimNumber(value)
}

export function niceTimeTicks(min: number, max: number, count = 4): TimeTick[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(count) || count <= 0 || min > max) return []
  const domain = sanitizeChartDomain({ min, max }, { min: 0, max: 1 })
  const span = Math.max(1, domain.max - domain.min)
  const limit = Math.min(MAX_TICKS - 2, Math.max(1, Math.floor(count)))
  const targetStep = span / limit
  const step = TIME_STEPS.find(candidate => candidate >= targetStep) ?? Math.ceil(targetStep / YEAR_MS) * YEAR_MS
  const start = Math.ceil(domain.min / step) * step
  const labelSpan = Math.min(span, step < 1000 ? 999 : step < MINUTE_MS ? MINUTE_MS : span)
  const ticks: TimeTick[] = []
  for (let index = 0; index < MAX_TICKS; index += 1) {
    const value = start + index * step
    if (!Number.isFinite(value) || value > domain.max) break
    if (value < domain.min) continue
    ticks.push({ value, label: formatChartTime(value, labelSpan) })
  }
  if (ticks.length > 0) return ticks
  return [
    { value: domain.min, label: formatChartTime(domain.min, span) },
    { value: domain.max, label: formatChartTime(domain.max, span) },
  ]
}

export function formatChartTime(value: number, span = 0): string {
  const date = new Date(value)
  const year = String(date.getFullYear())
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const hour = pad2(date.getHours())
  const minute = pad2(date.getMinutes())
  const second = pad2(date.getSeconds())
  if (span > 0 && span < 1000) return `${hour}:${minute}:${second}.${String(date.getMilliseconds()).padStart(3, '0')}`
  if (span > 0 && span <= MINUTE_MS) return `${hour}:${minute}:${second}`
  if (span > 0 && span <= DAY_MS) return `${hour}:${minute}`
  if (span > 0 && span <= YEAR_MS) return `${month}-${day}`
  if (span > YEAR_MS) return `${year}-${month}`
  return `${month}-${day}`
}

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const YEAR_MS = 365 * DAY_MS
const TIME_STEPS = [
  1, 5, 10, 50, 100, 250, 500,
  1000, 2000, 5000, 10000, 15000, 30000,
  MINUTE_MS,
  5 * MINUTE_MS,
  15 * MINUTE_MS,
  30 * MINUTE_MS,
  HOUR_MS,
  3 * HOUR_MS,
  6 * HOUR_MS,
  12 * HOUR_MS,
  DAY_MS,
  2 * DAY_MS,
  7 * DAY_MS,
  30 * DAY_MS,
  90 * DAY_MS,
  YEAR_MS,
]

function niceNumber(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range))
  const fraction = range / Math.pow(10, exponent)
  let niceFraction: number
  if (round) {
    if (fraction < 1.5) niceFraction = 1
    else if (fraction < 3) niceFraction = 2
    else if (fraction < 7) niceFraction = 5
    else niceFraction = 10
  } else if (fraction <= 1) niceFraction = 1
  else if (fraction <= 2) niceFraction = 2
  else if (fraction <= 5) niceFraction = 5
  else niceFraction = 10
  return niceFraction * Math.pow(10, exponent)
}

function trimNumber(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}
