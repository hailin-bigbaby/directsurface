import {
  chartXValue,
  cloneChartX,
  normalizeChartDomain,
  normalizeChartNumber,
} from './chart_scale'
import type { ChartAxisType, ChartDomain, ChartSeries } from './chart_types'

export interface ChartDecimationDatum {
  order: number
  xValue: number
  yValue: number
}

export interface ChartSeriesDatum extends ChartDecimationDatum {
  seriesIndex: number
  pointIndex: number
  occurrenceIndex: number
  breakBefore: boolean
}

export function cloneChartSeries(series: readonly ChartSeries[]): ChartSeries[] {
  return series.map(entry => ({
    ...entry,
    data: entry.data.map(point => ({
      x: cloneChartX(point.x),
      y: point.y !== null && Number.isFinite(point.y) ? normalizeChartNumber(point.y) : null,
    })),
  }))
}

export function resolveChartAxisType(series: readonly ChartSeries[], axisType: ChartAxisType): ChartAxisType {
  if (axisType !== 'auto') return axisType
  let hasDate = false
  let hasString = false
  let allStringsAreDates = true
  for (const entry of series) {
    for (const point of entry.data) {
      if (point.x instanceof Date) hasDate = true
      if (typeof point.x === 'string') {
        hasString = true
        if (!isDateString(point.x)) allStringsAreDates = false
      }
    }
  }
  if (hasDate || (hasString && allStringsAreDates)) return 'time'
  if (hasString) return 'category'
  return 'linear'
}

export function resolveFullChartXDomain(series: readonly ChartSeries[], axisType: ChartAxisType = 'auto'): ChartDomain {
  const resolvedAxisType = resolveChartAxisType(series, axisType)
  const values = series.flatMap(entry => entry.data.map((point, index) => chartXValue(point.x, index, resolvedAxisType)))
  return normalizeChartDomain(values.length > 0 ? values : [0, 1])
}

export function createChartSeriesDatums(series: ChartSeries, seriesIndex: number, axisType: ChartAxisType = 'auto'): ChartSeriesDatum[] {
  const ordered = series.data.map((point, pointIndex) => ({
      seriesIndex,
      pointIndex,
      xValue: chartXValue(point.x, pointIndex, axisType),
      yValue: point.y,
    })).filter(datum => Number.isFinite(datum.xValue))
  if (axisType !== 'category') {
    ordered.sort((a, b) => a.xValue - b.xValue || a.pointIndex - b.pointIndex)
  }
  const result: ChartSeriesDatum[] = []
  const occurrencesByX = new Map<number, number>()
  let breakBefore = false
  for (const datum of ordered) {
    const occurrenceIndex = occurrencesByX.get(datum.xValue) ?? 0
    occurrencesByX.set(datum.xValue, occurrenceIndex + 1)
    if (datum.yValue === null || !Number.isFinite(datum.yValue)) {
      breakBefore = true
      continue
    }
    result.push({
      seriesIndex,
      pointIndex: datum.pointIndex,
      occurrenceIndex,
      order: result.length,
      xValue: datum.xValue,
      yValue: datum.yValue,
      breakBefore,
    })
    breakBefore = false
  }
  return result
}

export function decimateBreakAwareDatums<T extends ChartDecimationDatum & { breakBefore: boolean }>(
  datums: readonly T[],
  domain: ChartDomain,
  bucketCount: number,
  options: { includeEdgeNeighbors?: boolean } = {},
): T[] {
  let runIndex = 0
  const runs = new Map<T, number>()
  const indexes = new Map<T, number>()
  const buckets = new Map<number, { min: T; max: T }>()
  const safeBucketCount = Math.max(1, Math.floor(bucketCount))
  const span = Math.max(Number.EPSILON, domain.max - domain.min)
  let before: T | undefined
  let after: T | undefined
  for (let index = 0; index < datums.length; index += 1) {
    const datum = datums[index]!
    if (datum.breakBefore) runIndex += 1
    runs.set(datum, runIndex)
    indexes.set(datum, index)
    if (datum.xValue < domain.min) {
      before = datum
      continue
    }
    if (datum.xValue > domain.max) {
      after ??= datum
      continue
    }
    const bucketIndex = Math.max(0, Math.min(safeBucketCount - 1,
      Math.floor(((datum.xValue - domain.min) / span) * safeBucketCount)))
    const bucket = buckets.get(bucketIndex)
    if (bucket) {
      if (datum.yValue < bucket.min.yValue) bucket.min = datum
      if (datum.yValue >= bucket.max.yValue) bucket.max = datum
    } else {
      buckets.set(bucketIndex, { min: datum, max: datum })
    }
  }

  const selected: T[] = []
  if (options.includeEdgeNeighbors && before) selected.push(before)
  const addNeighbor = (datum: T): void => {
    const index = indexes.get(datum)
    if (index === undefined) return
    const previous = datums[index - 1]
    const next = datums[index + 1]
    const sameRun = (candidate: T | undefined): candidate is T =>
      candidate !== undefined && runs.get(candidate) === runs.get(datum)
    if (sameRun(previous) && sameRun(next)) {
      selected.push(datum.xValue - previous.xValue <= next.xValue - datum.xValue ? previous : next)
    } else if (sameRun(previous)) {
      selected.push(previous)
    } else if (sameRun(next)) {
      selected.push(next)
    }
  }
  for (const bucket of buckets.values()) {
    selected.push(bucket.min, bucket.max)
    if (bucket.min === bucket.max || runs.get(bucket.min) !== runs.get(bucket.max)) {
      addNeighbor(bucket.min)
      if (bucket.max !== bucket.min) addNeighbor(bucket.max)
    }
  }
  if (options.includeEdgeNeighbors && after) selected.push(after)
  const sampled = uniqueDatums(selected).sort((a, b) => a.order - b.order)
  return sampled.map((datum, index) => ({
    ...datum,
    breakBefore: index === 0
      ? datum.breakBefore
      : datum.breakBefore || runs.get(datum) !== runs.get(sampled[index - 1]!),
  }))
}

function isDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:[Tt ].*)?$/.test(value) && Number.isFinite(Date.parse(value))
}

export function decimateMinMaxDatums<T extends ChartDecimationDatum>(
  datums: readonly T[],
  domain: ChartDomain,
  bucketCount: number,
  options: { includeEdgeNeighbors?: boolean } = {},
): T[] {
  const inside = datums.filter(datum => datum.xValue >= domain.min && datum.xValue <= domain.max)
  const span = Math.max(1, domain.max - domain.min)
  const buckets = new Map<number, { min?: T; max?: T }>()
  const safeBucketCount = Math.max(1, bucketCount)
  for (const datum of inside) {
    const bucketIndex = Math.max(0, Math.min(safeBucketCount - 1, Math.floor(((datum.xValue - domain.min) / span) * safeBucketCount)))
    const bucket = buckets.get(bucketIndex) ?? {}
    if (!bucket.min || datum.yValue < bucket.min.yValue) bucket.min = datum
    if (!bucket.max || datum.yValue > bucket.max.yValue) bucket.max = datum
    buckets.set(bucketIndex, bucket)
  }

  const selected: T[] = []
  if (options.includeEdgeNeighbors) {
    const before = datums.filter(datum => datum.xValue < domain.min).at(-1)
    const after = datums.find(datum => datum.xValue > domain.max)
    if (before) selected.push(before)
    for (const bucket of buckets.values()) addBucketDatums(selected, bucket)
    if (after) selected.push(after)
  } else {
    for (const bucket of buckets.values()) addBucketDatums(selected, bucket)
  }
  return uniqueDatums(selected).sort((a, b) => a.order - b.order)
}

function addBucketDatums<T extends ChartDecimationDatum>(selected: T[], bucket: { min?: T; max?: T }): void {
  if (bucket.min) selected.push(bucket.min)
  if (bucket.max && bucket.max !== bucket.min) selected.push(bucket.max)
}

function uniqueDatums<T>(datums: readonly T[]): T[] {
  const seen = new Set<T>()
  const result: T[] = []
  for (const datum of datums) {
    if (seen.has(datum)) continue
    seen.add(datum)
    result.push(datum)
  }
  return result
}
