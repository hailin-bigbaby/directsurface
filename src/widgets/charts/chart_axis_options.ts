import { normalizeLinearDomain } from './chart_scale'
import type {
  ChartAxisOptions,
  ChartAxisLabelFormatterContext,
  ChartDomain,
} from './chart_types'

export function cloneChartAxisOptions(options?: ChartAxisOptions): ChartAxisOptions {
  return options ? { ...options } : {}
}

export function chartAxisTickCount(options: ChartAxisOptions, fallback: number): number {
  const tickCount = options.tickCount
  if (!Number.isFinite(tickCount) || tickCount === undefined) return fallback
  return Math.max(1, Math.floor(tickCount))
}

export function chartAxisLabelsVisible(options: ChartAxisOptions): boolean {
  return options.showLabels !== false
}

export function resolveChartAxisDomain(domain: ChartDomain, options: ChartAxisOptions): ChartDomain {
  const hasMin = Number.isFinite(options.min)
  const hasMax = Number.isFinite(options.max)
  let min = hasMin ? options.min! : domain.min
  let max = hasMax ? options.max! : domain.max
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ...domain }
  if (min > max) {
    if (hasMin && !hasMax) {
      max = min
    } else if (!hasMin && hasMax) {
      min = max
    } else {
      const swap = min
      min = max
      max = swap
    }
  }
  if (min === max) {
    const expanded = normalizeLinearDomain([min])
    return {
      min: hasMin && !hasMax ? min : expanded.min,
      max: hasMax && !hasMin ? max : expanded.max,
    }
  }
  return { min, max }
}

export function formatChartAxisLabel(
  options: ChartAxisOptions,
  value: number,
  context: ChartAxisLabelFormatterContext,
): string {
  if (options.labelFormatter) return String(options.labelFormatter(value, context))
  return options.unit ? `${context.label}${options.unit}` : context.label
}

export function truncateChartAxisLabel(label: string, maxLength?: number): string {
  if (!Number.isFinite(maxLength) || maxLength === undefined || maxLength <= 0) return label
  const limit = Math.max(1, Math.floor(maxLength))
  if (label.length <= limit) return label
  if (limit === 1) return '…'
  return `${label.slice(0, limit - 1)}…`
}
