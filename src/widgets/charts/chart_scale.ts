import type { ChartDomain, ChartPoint, ChartX } from './chart_types'

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

export function chartXValue(value: ChartX, index: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : index
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? time : index
  }
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
  const fullSpan = Math.max(Number.EPSILON, full.max - full.min)
  const minSpan = Math.min(fullSpan, Math.max(Number.EPSILON, options.minSpan ?? fullSpan / 10000, 1))
  const maxSpan = Math.min(fullSpan, Math.max(minSpan, options.maxSpan ?? fullSpan))
  let next = sanitizeChartDomain(domain, full)
  let span = next.max - next.min
  const center = (next.min + next.max) / 2
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
  const finiteValues = values.filter(Number.isFinite)
  let min = finiteValues.length > 0 ? Math.min(...finiteValues) : 0
  let max = finiteValues.length > 0 ? Math.max(...finiteValues) : 1
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
  return series.flatMap(entry => entry.data.map(point => point.y).filter(Number.isFinite))
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count <= 0) return []
  if (min === max) return [min]
  const step = niceNumber((max - min) / Math.max(1, count), true)
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks: number[] = []
  const epsilon = step * 1e-6
  for (let value = niceMin; value <= niceMax + step * 0.5; value += step) {
    const tick = roundTick(value)
    if (tick >= min - epsilon && tick <= max + epsilon) ticks.push(tick)
  }
  return ticks.length > 0 ? ticks : [roundTick(min), roundTick(max)]
}

export function formatChartNumber(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1000000) return `${trimNumber(value / 1000000)}M`
  if (abs >= 1000) return `${trimNumber(value / 1000)}k`
  if (abs >= 100 || Number.isInteger(value)) return String(Math.round(value))
  return trimNumber(value)
}

export function niceTimeTicks(min: number, max: number, count = 4): TimeTick[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count <= 0) return []
  const domain = sanitizeChartDomain({ min, max }, { min: 0, max: 1 })
  const span = Math.max(1, domain.max - domain.min)
  const targetStep = span / Math.max(1, count)
  const step = TIME_STEPS.find(candidate => candidate >= targetStep) ?? TIME_STEPS[TIME_STEPS.length - 1]!
  const start = Math.ceil(domain.min / step) * step
  const ticks: TimeTick[] = []
  for (let value = start; value <= domain.max + step * 0.1; value += step) {
    if (value < domain.min - step * 0.1) continue
    ticks.push({ value, label: formatChartTime(value, span) })
    if (ticks.length > count + 2) break
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

function roundTick(value: number): number {
  return Math.abs(value) < 1e-9 ? 0 : Math.round(value * 1000000) / 1000000
}

function trimNumber(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}
