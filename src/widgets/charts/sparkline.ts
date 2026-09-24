import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../../core/render_object'
import type { InteractiveRenderObject, PointerEvent } from '../../gestures/recognizers'
import { isPrimaryPointerButton } from '../../gestures/hit_test'
import { RenderBox, type RenderBoxOptions } from '../../layout/render_box'
import { DrawList } from '../../rendering/draw_list'
import type { PaintContext } from '../../rendering/paint_context'
import type { Color } from '../../theme/theme'
import { resolveThemeChart, rgba } from '../../theme/theme'
import { chartColor, withAlpha } from './chart_palette'
import { createLinearScale, formatChartNumber, normalizeChartNumber, normalizeLinearDomain } from './chart_scale'
import { isChartReady, paintChartState, resolveChartState } from './chart_state'
import { layoutChartTooltip, paintChartTooltip } from './chart_tooltip'
import type { ChartDataState, ChartStateDebugState, ChartTooltipDebugState, SparklineVariant } from './chart_types'

const TOOLTIP_TOP_SPACE = 72

export interface SparklineDebugState {
  values: number[]
  variant: SparklineVariant
  hoverIndex: number
  crosshair: { x: number; y: number } | null
  tooltip: ChartTooltipDebugState | null
  state: ChartStateDebugState
  points: Array<{ x: number; y: number; value: number }>
}

export interface RenderSparklineOptions extends RenderBoxOptions {
  values: number[]
  variant?: SparklineVariant
  color?: Color
  showLastValue?: boolean
  showTooltip?: boolean
  showCrosshair?: boolean
  dataState?: ChartDataState
  emptyMessage?: string
  loadingMessage?: string
  errorMessage?: string
  onPointClick?: (index: number, value: number) => void
}

export class RenderSparkline extends RenderBox implements InteractiveRenderObject {
  static override debugTypeName = 'RenderSparkline'
  values: number[]
  variant: SparklineVariant
  color?: Color
  showLastValue: boolean
  showTooltip: boolean
  showCrosshair: boolean
  dataState?: ChartDataState
  emptyMessage?: string
  loadingMessage?: string
  errorMessage?: string
  onPointClick?: (index: number, value: number) => void

  private _points: Array<{ x: number; y: number; value: number }> = []
  private _hoverIndex = -1
  private _zeroY = 0

  constructor(options: RenderSparklineOptions) {
    super({ ...options, height: options.height ?? 48 })
    this.values = normalizeValues(options.values)
    this.variant = options.variant ?? 'line'
    this.color = options.color
    this.showLastValue = options.showLastValue ?? false
    this.showTooltip = options.showTooltip ?? true
    this.showCrosshair = options.showCrosshair ?? this.showTooltip
    this.dataState = options.dataState
    this.emptyMessage = options.emptyMessage
    this.loadingMessage = options.loadingMessage
    this.errorMessage = options.errorMessage
    this.onPointClick = options.onPointClick
  }

  setValues(values: number[]): void {
    this.values = normalizeValues(values)
    this.markNeedsLayout()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? 160 : constraints.maxWidth
    this.size = constrainSize(constraints, {
      width,
      height: this.height ?? 48,
    })
    this._computePoints()
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const color = this.color ?? chartColor(context.theme, 0)
    const muted = context.theme.borderData
    const { x, y } = offset
    const w = this.size.width
    const h = this.size.height
    if (w <= 0 || h <= 0) return

    dl.line(x, y + h - 1, x + w, y + h - 1, muted, 1)
    const state = this._chartState()
    if (!isChartReady(state)) {
      paintChartState(dl, context, { x, y, width: w, height: h }, state)
      return
    }

    if (this.variant === 'bar') {
      this._paintBars(dl, offset, color, resolveThemeChart(context.theme).negative)
    } else {
      this._paintLine(context, offset, color, this.variant === 'area')
    }

    if (this._hoverIndex >= 0) {
      const point = this._points[this._hoverIndex]
      if (point) {
        if (this.showCrosshair) {
          dl.line(x + point.x, y + 1, x + point.x, y + h - 1, withAlpha(context.theme.textSecondary, 0.34), 1)
        }
        if (this.showTooltip || this.showCrosshair) {
          dl.fillCircle(x + point.x, y + point.y, 3.5, color)
        }
        if (this.showTooltip) this._paintTooltip(dl, context, offset, point, this._hoverIndex)
      }
    } else if (this.showLastValue) {
      const value = this.values[this.values.length - 1]
      if (value !== undefined) {
        dl.fillText(formatChartNumber(value), x + w, y + h / 2, context.theme.textSecondary, Math.max(10, context.theme.fontSize - 2), context.theme.fontFamily, 'right', 'middle')
      }
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (!isChartReady(this._chartState())) {
      if (this._hoverIndex >= 0) {
        this._hoverIndex = -1
        this.markNeedsPaint()
      }
      return
    }
    const next = this._nearestPointIndex(event.position)
    if (next === this._hoverIndex) return
    this._hoverIndex = next
    this.markNeedsPaint()
  }

  onPointerLeave(_event: PointerEvent): void {
    if (this._hoverIndex < 0) return
    this._hoverIndex = -1
    this.markNeedsPaint()
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (!isChartReady(this._chartState())) return
    if (this._hoverIndex < 0) return
    const value = this.values[this._hoverIndex]
    if (value !== undefined) this.onPointClick?.(this._hoverIndex, value)
  }

  debugState(): SparklineDebugState {
    return {
      values: [...this.values],
      variant: this.variant,
      hoverIndex: this._hoverIndex,
      crosshair: this._crosshairDebugState(),
      tooltip: this._tooltipDebugState({ x: 0, y: 0 }),
      state: this._chartState(),
      points: this._points.map(point => ({ ...point })),
    }
  }

  dispose(): void {
    this.onPointClick = undefined
    super.dispose()
  }

  private _computePoints(): void {
    const values = this.values.filter(Number.isFinite)
    if (values.length === 0) {
      this._points = []
      return
    }
    const domain = normalizeLinearDomain(values, { includeZero: this.variant === 'bar', paddingRatio: 0.08 })
    const yScale = createLinearScale(domain.min, domain.max, this.size.height - 4, 4)
    this._zeroY = yScale.map(0)
    const count = this.values.length
    this._points = this.values.map((value, index) => ({
      x: count <= 1 ? this.size.width / 2 : (index / (count - 1)) * this.size.width,
      y: yScale.map(Number.isFinite(value) ? value : 0),
      value,
    }))
  }

  private _chartState(): ChartStateDebugState {
    return resolveChartState(this, this.values.length > 0)
  }

  private _paintLine(context: PaintContext, offset: Offset, color: Color, fillArea: boolean): void {
    if (this._points.length === 0) return
    const ctx = context.ctx
    const { x, y } = offset
    ctx.save()
    ctx.beginPath()
    this._points.forEach((point, index) => {
      const px = x + point.x
      const py = y + point.y
      if (index === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    if (fillArea) {
      const last = this._points[this._points.length - 1]!
      const first = this._points[0]!
      ctx.lineTo(x + last.x, y + this.size.height)
      ctx.lineTo(x + first.x, y + this.size.height)
      ctx.closePath()
      const grad = ctx.createLinearGradient(x, y, x, y + this.size.height)
      grad.addColorStop(0, `rgba(${color.r},${color.g},${color.b},0.32)`)
      grad.addColorStop(1, `rgba(${color.r},${color.g},${color.b},0.04)`)
      ctx.fillStyle = grad
      ctx.fill()
      ctx.beginPath()
      this._points.forEach((point, index) => {
        const px = x + point.x
        const py = y + point.y
        if (index === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
    }
    ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${color.a})`
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.restore()
  }

  private _paintBars(dl: DrawList, offset: Offset, color: Color, negativeColor: Color): void {
    if (this._points.length === 0) return
    const barGap = 2
    const barWidth = Math.max(2, (this.size.width - barGap * (this.values.length - 1)) / this.values.length)
    for (let index = 0; index < this.values.length; index += 1) {
      const value = this.values[index] ?? 0
      const point = this._points[index]
      if (!point) continue
      const barX = offset.x + index * (barWidth + barGap)
      const barY = offset.y + Math.min(point.y, this._zeroY)
      const barH = Math.max(2, Math.abs(this._zeroY - point.y))
      dl.fillRect(barX, barY, barWidth, barH, value >= 0 ? color : negativeColor, Math.min(3, barWidth / 2))
    }
  }

  private _paintTooltip(
    dl: DrawList,
    context: PaintContext,
    offset: Offset,
    point: { x: number; y: number; value: number },
    index: number,
  ): void {
    const layout = this._pointTooltipLayout(offset, point, index)
    if (layout) paintChartTooltip(dl, context, layout)
  }

  private _nearestPointIndex(position: Offset): number {
    if (!this.hitTest(position)) return -1
    const localX = position.x - this.globalOffset.x
    let bestIndex = -1
    let bestDistance = Infinity
    for (let index = 0; index < this._points.length; index += 1) {
      const point = this._points[index]!
      const distance = Math.abs(point.x - localX)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    }
    return bestIndex
  }

  private _tooltipDebugState(offset: Offset): ChartTooltipDebugState | null {
    if (!this.showTooltip || this._hoverIndex < 0) return null
    const point = this._points[this._hoverIndex]
    return point ? this._pointTooltipLayout(offset, point, this._hoverIndex) : null
  }

  private _pointTooltipLayout(
    offset: Offset,
    point: { x: number; y: number; value: number },
    index: number,
  ): ChartTooltipDebugState | null {
    return layoutChartTooltip({
      title: `#${index + 1}`,
      items: [{
        label: 'Value',
        value: formatChartNumber(point.value),
        color: this.color ?? chartColor(this.currentTheme, 0),
      }],
      anchorX: offset.x + point.x,
      anchorY: offset.y,
      boundsX: offset.x,
      boundsY: offset.y - TOOLTIP_TOP_SPACE,
      boundsWidth: this.size.width,
      boundsHeight: this.size.height + TOOLTIP_TOP_SPACE,
      minWidth: 76,
      maxItems: 1,
    })
  }

  private _crosshairDebugState(): SparklineDebugState['crosshair'] {
    if (!this.showCrosshair || this._hoverIndex < 0) return null
    const point = this._points[this._hoverIndex]
    return point ? { x: point.x, y: point.y } : null
  }
}

function normalizeValues(values: readonly number[]): number[] {
  return values.map(value => normalizeChartNumber(value))
}
