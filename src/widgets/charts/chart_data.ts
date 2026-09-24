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
}

export function cloneChartSeries(series: readonly ChartSeries[]): ChartSeries[] {
  return series.map(entry => ({
    ...entry,
    data: entry.data
      .filter(point => Number.isFinite(point.y))
      .map(point => ({
        x: cloneChartX(point.x),
        y: normalizeChartNumber(point.y),
      })),
  }))
}

export function resolveChartAxisType(series: readonly ChartSeries[], axisType: ChartAxisType): ChartAxisType {
  if (axisType !== 'auto') return axisType
  for (const entry of series) {
    for (const point of entry.data) {
      if (point.x instanceof Date) return 'time'
    }
  }
  for (const entry of series) {
    for (const point of entry.data) {
      if (typeof point.x === 'string') return 'category'
    }
  }
  return 'linear'
}

export function resolveFullChartXDomain(series: readonly ChartSeries[]): ChartDomain {
  const values = series.flatMap(entry => entry.data.map((point, index) => chartXValue(point.x, index)))
  return normalizeChartDomain(values.length > 0 ? values : [0, 1])
}

export function createChartSeriesDatums(series: ChartSeries, seriesIndex: number): ChartSeriesDatum[] {
  return series.data
    .map((point, pointIndex) => ({
      seriesIndex,
      pointIndex,
      order: pointIndex,
      xValue: chartXValue(point.x, pointIndex),
      yValue: point.y,
    }))
    .filter(datum => Number.isFinite(datum.xValue) && Number.isFinite(datum.yValue))
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
