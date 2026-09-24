import type { Offset } from '../../core/render_object'
import { DrawList } from '../../rendering/draw_list'
import type { PaintContext } from '../../rendering/paint_context'
import { colorToCSS } from '../../theme/theme'
import { withAlpha } from './chart_palette'
import { createLinearScale } from './chart_scale'
import type {
  ChartAnnotation,
  ChartAnnotationAxis,
  ChartAnnotationLayout,
  ChartAnnotationLineStyle,
  ChartDomain,
  ChartPlotRect,
  ChartX,
} from './chart_types'

export interface ChartAnnotationLayoutOptions {
  annotations: readonly ChartAnnotation[]
  plot: ChartPlotRect
  xDomain: ChartDomain
  yDomain: ChartDomain
  includeEvents?: boolean
  resolveAxis(axis: ChartAnnotationAxis): 'x' | 'y' | null
  resolveXValue(value: ChartX | number): number | null
  resolveYValue(value: ChartX | number): number | null
}

export function cloneChartAnnotations(annotations: readonly ChartAnnotation[] = []): ChartAnnotation[] {
  return annotations.map(annotation => {
    if (annotation.type === 'line') {
      return {
        ...annotation,
        value: cloneAnnotationValue(annotation.value),
        color: annotation.color ? { ...annotation.color } : undefined,
      }
    }
    if (annotation.type === 'range') {
      return {
        ...annotation,
        min: cloneAnnotationValue(annotation.min),
        max: cloneAnnotationValue(annotation.max),
        color: annotation.color ? { ...annotation.color } : undefined,
      }
    }
    return {
      ...annotation,
      x: cloneAnnotationValue(annotation.x) as ChartX,
      color: annotation.color ? { ...annotation.color } : undefined,
    }
  })
}

export function collectChartAnnotationValues(
  annotations: readonly ChartAnnotation[],
  axes: readonly ChartAnnotationAxis[],
): number[] {
  const result: number[] = []
  const axisSet = new Set(axes)
  for (const annotation of annotations) {
    if (annotation.type === 'event') continue
    if (!axisSet.has(annotation.axis)) continue
    if (annotation.type === 'line') {
      pushFinite(result, annotation.value)
    } else {
      pushFinite(result, annotation.min)
      pushFinite(result, annotation.max)
    }
  }
  return result
}

export function layoutChartAnnotations(options: ChartAnnotationLayoutOptions): ChartAnnotationLayout[] {
  const xScale = createLinearScale(options.xDomain.min, options.xDomain.max, options.plot.x, options.plot.x + options.plot.width)
  const yScale = createLinearScale(options.yDomain.min, options.yDomain.max, options.plot.y + options.plot.height, options.plot.y)
  const result: ChartAnnotationLayout[] = []

  options.annotations.forEach((annotation, annotationIndex) => {
    if (annotation.type === 'event') {
      if (options.includeEvents === false) return
      const value = options.resolveXValue(annotation.x)
      if (!isFiniteInDomain(value, options.xDomain)) return
      const x = xScale.map(value)
      result.push({
        annotationIndex,
        type: 'event',
        axis: 'x',
        id: annotation.id,
        label: annotation.label,
        x,
        y: options.plot.y,
        width: 0,
        height: options.plot.height,
        value,
      })
      return
    }

    const axis = options.resolveAxis(annotation.axis)
    if (!axis) return
    if (annotation.type === 'line') {
      const value = axis === 'x'
        ? options.resolveXValue(annotation.value)
        : options.resolveYValue(annotation.value)
      const domain = axis === 'x' ? options.xDomain : options.yDomain
      if (!isFiniteInDomain(value, domain)) return
      const pixel = axis === 'x' ? xScale.map(value) : yScale.map(value)
      result.push(lineLayout(annotationIndex, annotation, axis, pixel, value, options.plot))
      return
    }

    const min = axis === 'x'
      ? options.resolveXValue(annotation.min)
      : options.resolveYValue(annotation.min)
    const max = axis === 'x'
      ? options.resolveXValue(annotation.max)
      : options.resolveYValue(annotation.max)
    const domain = axis === 'x' ? options.xDomain : options.yDomain
    if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) return
    const lower = Math.min(min, max)
    const upper = Math.max(min, max)
    if (upper < domain.min || lower > domain.max) return
    const clampedMin = Math.max(domain.min, lower)
    const clampedMax = Math.min(domain.max, upper)
    const start = axis === 'x' ? xScale.map(clampedMin) : yScale.map(clampedMin)
    const end = axis === 'x' ? xScale.map(clampedMax) : yScale.map(clampedMax)
    result.push(rangeLayout(annotationIndex, annotation, axis, start, end, clampedMin, clampedMax, options.plot))
  })

  return result
}

export function paintChartAnnotationRanges(
  dl: DrawList,
  context: PaintContext,
  layouts: readonly ChartAnnotationLayout[],
  annotations: readonly ChartAnnotation[],
  offset: Offset,
): void {
  for (const layout of layouts) {
    if (layout.type !== 'range') continue
    const annotation = annotations[layout.annotationIndex]
    if (!annotation || annotation.type !== 'range') continue
    const color = annotation.color ?? context.theme.accentPrimary
    const alpha = annotation.opacity ?? 0.1
    dl.fillRect(offset.x + layout.x, offset.y + layout.y, layout.width, layout.height, withAlpha(color, alpha), 0)
  }
}

export function paintChartAnnotationForeground(
  dl: DrawList,
  context: PaintContext,
  layouts: readonly ChartAnnotationLayout[],
  annotations: readonly ChartAnnotation[],
  plot: ChartPlotRect,
  offset: Offset,
): void {
  const absolutePlot = {
    x: offset.x + plot.x,
    y: offset.y + plot.y,
    width: plot.width,
    height: plot.height,
  }
  for (const layout of layouts) {
    const annotation = annotations[layout.annotationIndex]
    if (!annotation) continue
    const color = annotation.color ?? context.theme.accentPrimary
    if (layout.type === 'range') {
      paintAnnotationLabel(dl, context, layout, annotation, absolutePlot, offset, color)
      continue
    }

    const lineWidth = Math.max(1, annotation.lineWidth ?? (layout.type === 'event' ? 1.5 : 1))
    const lineStyle = annotation.lineStyle ?? 'dashed'
    if (layout.axis === 'x') {
      const x = offset.x + layout.x
      paintAnnotationLine(dl, context, x, offset.y + layout.y, x, offset.y + layout.y + layout.height, color, lineWidth, lineStyle)
      if (layout.type === 'event') {
        dl.fillRect(x - 3, absolutePlot.y + 2, 6, 6, color, 2)
      }
    } else {
      const y = offset.y + layout.y
      paintAnnotationLine(dl, context, offset.x + layout.x, y, offset.x + layout.x + layout.width, y, color, lineWidth, lineStyle)
    }
    paintAnnotationLabel(dl, context, layout, annotation, absolutePlot, offset, color)
  }
}

function lineLayout(
  annotationIndex: number,
  annotation: ChartAnnotation,
  axis: 'x' | 'y',
  pixel: number,
  value: number,
  plot: ChartPlotRect,
): ChartAnnotationLayout {
  return {
    annotationIndex,
    type: 'line',
    axis,
    id: annotation.id,
    label: annotation.label,
    x: axis === 'x' ? pixel : plot.x,
    y: axis === 'x' ? plot.y : pixel,
    width: axis === 'x' ? 0 : plot.width,
    height: axis === 'x' ? plot.height : 0,
    value,
  }
}

function rangeLayout(
  annotationIndex: number,
  annotation: ChartAnnotation,
  axis: 'x' | 'y',
  start: number,
  end: number,
  min: number,
  max: number,
  plot: ChartPlotRect,
): ChartAnnotationLayout {
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  return {
    annotationIndex,
    type: 'range',
    axis,
    id: annotation.id,
    label: annotation.label,
    x: axis === 'x' ? from : plot.x,
    y: axis === 'x' ? plot.y : from,
    width: axis === 'x' ? to - from : plot.width,
    height: axis === 'x' ? plot.height : to - from,
    min,
    max,
  }
}

function paintAnnotationLine(
  dl: DrawList,
  context: PaintContext,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: NonNullable<ChartAnnotation['color']>,
  lineWidth: number,
  lineStyle: ChartAnnotationLineStyle,
): void {
  if (lineStyle === 'solid') {
    dl.line(x1, y1, x2, y2, color, lineWidth)
    return
  }
  const ctx = context.ctx
  ctx.save()
  ctx.strokeStyle = colorToCSS(color)
  ctx.lineWidth = lineWidth
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash([5, 4])
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash([])
  ctx.restore()
}

function paintAnnotationLabel(
  dl: DrawList,
  context: PaintContext,
  layout: ChartAnnotationLayout,
  annotation: ChartAnnotation,
  plot: ChartPlotRect,
  offset: Offset,
  color: NonNullable<ChartAnnotation['color']>,
): void {
  if (!annotation.label) return
  const fontSize = Math.max(10, context.theme.fontSize - 3)
  const fontFamily = context.theme.fontFamily
  const paddingX = 5
  const textWidth = dl.measureText(annotation.label, fontSize, fontFamily).width
  const width = Math.min(plot.width - 8, Math.max(24, textWidth + paddingX * 2))
  const height = fontSize + 6
  const position = annotation.labelPosition ?? defaultLabelPosition(layout)
  const rect = annotationLabelRect(layout, plot, offset, width, height, position)
  dl.fillRect(rect.x, rect.y, rect.width, rect.height, withAlpha(context.theme.surfacePopup, 0.9), 3)
  dl.strokeRect(rect.x, rect.y, rect.width, rect.height, withAlpha(color, 0.42), 1, 3)
  dl.fillText(annotation.label, rect.x + paddingX, rect.y + rect.height / 2, context.theme.textPrimary, fontSize, fontFamily, 'left', 'middle')
}

function annotationLabelRect(
  layout: ChartAnnotationLayout,
  plot: ChartPlotRect,
  offset: Offset,
  width: number,
  height: number,
  position: 'start' | 'center' | 'end',
): { x: number; y: number; width: number; height: number } {
  const x = offset.x + layout.x
  const y = offset.y + layout.y
  if (layout.axis === 'x') {
    const labelY = position === 'end'
      ? plot.y + plot.height - height - 4
      : position === 'center'
        ? plot.y + plot.height / 2 - height / 2
        : plot.y + 4
    return {
      x: clamp(x + 6, plot.x + 4, plot.x + plot.width - width - 4),
      y: clamp(labelY, plot.y + 4, plot.y + plot.height - height - 4),
      width,
      height,
    }
  }

  const labelX = position === 'start'
    ? plot.x + 4
    : position === 'center'
      ? plot.x + plot.width / 2 - width / 2
      : plot.x + plot.width - width - 4
  const labelY = layout.type === 'range'
    ? y + layout.height / 2 - height / 2
    : y - height - 3
  return {
    x: clamp(labelX, plot.x + 4, plot.x + plot.width - width - 4),
    y: clamp(labelY, plot.y + 4, plot.y + plot.height - height - 4),
    width,
    height,
  }
}

function defaultLabelPosition(layout: ChartAnnotationLayout): 'start' | 'center' | 'end' {
  if (layout.type === 'range') return 'center'
  if (layout.type === 'event') return 'start'
  return layout.axis === 'x' ? 'start' : 'end'
}

function isFiniteInDomain(value: number | null, domain: ChartDomain): value is number {
  return value !== null && Number.isFinite(value) && value >= domain.min && value <= domain.max
}

function pushFinite(result: number[], value: ChartX | number): void {
  if (typeof value === 'number' && Number.isFinite(value)) result.push(value)
}

function cloneAnnotationValue(value: ChartX | number): ChartX | number {
  return value instanceof Date ? new Date(value.getTime()) : value
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.max(min, Math.min(max, value))
}
