import { DrawList } from '../../rendering/draw_list'
import type { PaintContext } from '../../rendering/paint_context'
import { resolveThemeChart, type Color } from '../../theme/theme'
import { chartColor, withAlpha } from './chart_palette'
import { createLinearScale, normalizeLinearDomain } from './chart_scale'

export interface FramePerformanceTimelineSample {
  totalMs: number
  layoutMs: number
  paintMs: number
  compositeMs: number
}

export interface FramePerformanceTimelineRect {
  x: number
  y: number
  width: number
  height: number
}

export interface FramePerformanceTimelineChartOptions {
  frameBudgetMs?: number
  maxFrameMs?: number
  maxSamples?: number
  showLegend?: boolean
}

export interface FramePerformanceTimelineChartDebugState {
  sampleCount: number
  visibleSampleCount: number
  frameBudgetMs: number
  yMax: number
  slowFrameCount: number
}

interface SegmentSpec {
  key: 'layoutMs' | 'paintMs' | 'compositeMs' | 'otherMs'
  label: string
  color: Color
}

export function resolveFramePerformanceTimelineChartState(
  samples: readonly FramePerformanceTimelineSample[],
  options: FramePerformanceTimelineChartOptions = {},
): FramePerformanceTimelineChartDebugState {
  const frameBudgetMs = options.frameBudgetMs ?? 16.7
  const visibleSamples = visibleFrameSamples(samples, options.maxSamples)
  const maxTotal = visibleSamples.reduce((max, sample) => Math.max(max, safeMs(sample.totalMs)), 0)
  const domain = normalizeLinearDomain([0, frameBudgetMs, maxTotal, options.maxFrameMs ?? 0], { includeZero: true, paddingRatio: 0.04 })
  const yMax = Math.max(frameBudgetMs, options.maxFrameMs ?? 0, domain.max)
  return {
    sampleCount: samples.length,
    visibleSampleCount: visibleSamples.length,
    frameBudgetMs,
    yMax,
    slowFrameCount: visibleSamples.filter(sample => safeMs(sample.totalMs) >= frameBudgetMs).length,
  }
}

export function paintFramePerformanceTimelineChart(
  dl: DrawList,
  context: PaintContext,
  rect: FramePerformanceTimelineRect,
  samples: readonly FramePerformanceTimelineSample[],
  options: FramePerformanceTimelineChartOptions = {},
): FramePerformanceTimelineChartDebugState {
  const state = resolveFramePerformanceTimelineChartState(samples, options)
  const visibleSamples = visibleFrameSamples(samples, options.maxSamples)
  const { x, y, width, height } = rect
  const showLegend = options.showLegend ?? true
  const legendHeight = showLegend ? 15 : 0
  const plot = {
    x,
    y,
    width,
    height: Math.max(0, height - legendHeight),
  }

  dl.fillRect(x, y, width, height, context.theme.stateHoverOverlay, 4)
  if (plot.width <= 0 || plot.height <= 0) return state
  if (visibleSamples.length === 0) {
    dl.fillText('waiting', x + width / 2, y + height / 2, withAlpha(context.theme.textSecondary, 0.8), 10, context.theme.fontFamily, 'center', 'middle')
    return state
  }

  const yScale = createLinearScale(0, state.yMax, plot.y + plot.height - 2, plot.y + 2)
  const budgetY = yScale.map(state.frameBudgetMs)
  dl.line(plot.x, budgetY, plot.x + plot.width, budgetY, withAlpha(context.theme.accentWarning, 0.62), 1)
  dl.fillText(`${formatMs(state.frameBudgetMs)}`, plot.x + plot.width - 2, budgetY - 6, withAlpha(context.theme.accentWarning, 0.86), 9, context.theme.fontFamily, 'right', 'middle')

  const segments = segmentSpecs(context)
  const gap = visibleSamples.length > 72 ? 0 : 1
  const slotWidth = plot.width / visibleSamples.length
  const barWidth = Math.max(1, slotWidth - gap)
  visibleSamples.forEach((sample, index) => {
    const barX = plot.x + index * slotWidth
    let acc = 0
    const values = {
      layoutMs: safeMs(sample.layoutMs),
      paintMs: safeMs(sample.paintMs),
      compositeMs: safeMs(sample.compositeMs),
      otherMs: Math.max(0, safeMs(sample.totalMs) - safeMs(sample.layoutMs) - safeMs(sample.paintMs) - safeMs(sample.compositeMs)),
    }
    for (const segment of segments) {
      const value = values[segment.key]
      if (value <= 0) continue
      const top = yScale.map(acc + value)
      const bottom = yScale.map(acc)
      dl.fillRect(barX, top, barWidth, Math.max(1, bottom - top), segment.color)
      acc += value
    }
    if (safeMs(sample.totalMs) >= state.frameBudgetMs) {
      const totalY = yScale.map(safeMs(sample.totalMs))
      dl.fillRect(barX, totalY - 2, barWidth, 2, withAlpha(context.theme.accentDanger, 0.92))
    }
  })

  paintTotalLine(context, plot, visibleSamples, state.yMax, context.theme.textPrimary)
  if (showLegend) paintLegend(dl, context, x + 4, y + height - 8, segments)
  return state
}

function paintTotalLine(
  context: PaintContext,
  plot: FramePerformanceTimelineRect,
  samples: readonly FramePerformanceTimelineSample[],
  yMax: number,
  color: Color,
): void {
  if (samples.length < 2) return
  const ctx = context.ctx
  const yScale = createLinearScale(0, yMax, plot.y + plot.height - 2, plot.y + 2)
  const slotWidth = plot.width / samples.length
  ctx.save()
  ctx.beginPath()
  samples.forEach((sample, index) => {
    const px = plot.x + index * slotWidth + slotWidth / 2
    const py = yScale.map(safeMs(sample.totalMs))
    if (index === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},0.78)`
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()
  ctx.restore()
}

function paintLegend(dl: DrawList, context: PaintContext, x: number, y: number, segments: readonly SegmentSpec[]): void {
  let cursor = x
  for (const segment of segments) {
    dl.fillRect(cursor, y - 3, 6, 6, segment.color, 2)
    cursor += 9
    dl.fillText(segment.label, cursor, y, withAlpha(context.theme.textSecondary, 0.82), 9, context.theme.fontFamily, 'left', 'middle')
    cursor += Math.max(26, segment.label.length * 5.5)
  }
}

function segmentSpecs(context: PaintContext): SegmentSpec[] {
  return [
    { key: 'layoutMs', label: 'layout', color: withAlpha(chartColor(context.theme, 0), 0.9) },
    { key: 'paintMs', label: 'paint', color: withAlpha(chartColor(context.theme, 2), 0.9) },
    { key: 'compositeMs', label: 'comp', color: withAlpha(chartColor(context.theme, 1), 0.86) },
    { key: 'otherMs', label: 'other', color: resolveThemeChart(context.theme).timelineOther },
  ]
}

function visibleFrameSamples(
  samples: readonly FramePerformanceTimelineSample[],
  maxSamples = 80,
): readonly FramePerformanceTimelineSample[] {
  const limit = Math.max(10, Math.floor(maxSamples))
  return samples.length > limit ? samples.slice(samples.length - limit) : samples
}

function safeMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function formatMs(value: number): string {
  return `${Math.round(value * 10) / 10}ms`
}
