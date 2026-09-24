import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../../core/render_object'
import type { InteractiveRenderObject, PointerEvent } from '../../gestures/recognizers'
import { isPrimaryPointerButton } from '../../gestures/hit_test'
import { RenderBox, type RenderBoxOptions } from '../../layout/render_box'
import { DrawList } from '../../rendering/draw_list'
import type { PaintContext } from '../../rendering/paint_context'
import { colorToCSS } from '../../theme/theme'
import { chartColor, withAlpha } from './chart_palette'
import { formatChartNumber, normalizeChartNumber } from './chart_scale'
import { isChartReady, paintChartState, resolveChartState } from './chart_state'
import { layoutChartTooltip, paintChartTooltip } from './chart_tooltip'
import {
  firstChangedVisibleIndex,
  hiddenIndexes,
  hitLegendItem,
  isVisibleIndex,
  normalizeVisibleIndexes,
  sameVisibleIndexes,
  toggleVisibleIndex,
  visibleIndexesOverride,
  type ChartLegendItemLayout,
} from './chart_visibility'
import type {
  ChartDataState,
  ChartLegendMode,
  ChartPlotRect,
  ChartSegmentVisibilityChangeEvent,
  ChartSeriesVisibilityChangeReason,
  ChartStateDebugState,
  ChartTooltipDebugState,
  DonutChartSegment,
  DonutSegmentLayout,
} from './chart_types'

export interface DonutChartDebugState {
  total: number
  hoverIndex: number
  segments: DonutSegmentLayout[]
  tooltip: ChartTooltipDebugState | null
  visibleSegments: number[]
  hiddenSegments: number[]
  center: { x: number; y: number }
  radius: number
  state: ChartStateDebugState
}

interface DonutLegendLayout {
  right: boolean
  rightWidth: number
  bottomHeight: number
  chartWidth: number
  chartHeight: number
  columns: number
  itemWidth: number
}

export interface RenderDonutChartOptions extends RenderBoxOptions {
  segments: DonutChartSegment[]
  showLegend?: boolean
  legendMode?: ChartLegendMode
  visibleSegments?: number[]
  dataState?: ChartDataState
  emptyMessage?: string
  loadingMessage?: string
  errorMessage?: string
  showTooltip?: boolean
  innerRatio?: number
  onSegmentVisibilityChange?: (event: ChartSegmentVisibilityChangeEvent) => void
  onSegmentClick?: (segment: DonutSegmentLayout) => void
}

export class RenderDonutChart extends RenderBox implements InteractiveRenderObject {
  static override debugTypeName = 'RenderDonutChart'
  segments: DonutChartSegment[]
  showLegend: boolean
  legendMode: ChartLegendMode
  dataState?: ChartDataState
  emptyMessage?: string
  loadingMessage?: string
  errorMessage?: string
  showTooltip: boolean
  innerRatio: number
  onSegmentVisibilityChange?: (event: ChartSegmentVisibilityChangeEvent) => void
  onSegmentClick?: (segment: DonutSegmentLayout) => void

  private _layouts: DonutSegmentLayout[] = []
  private _legendItems: ChartLegendItemLayout[] = []
  private _visibleSegments?: number[]
  private _hoverLegendIndex = -1
  private _hoverIndex = -1
  private _total = 0
  private _center = { x: 0, y: 0 }
  private _radius = 0
  private _chartRect: ChartPlotRect = { x: 0, y: 0, width: 0, height: 0 }

  constructor(options: RenderDonutChartOptions) {
    super({ ...options, height: options.height ?? 220 })
    this.segments = cloneSegments(options.segments)
    this.showLegend = options.showLegend ?? true
    this.legendMode = options.legendMode ?? 'static'
    this._visibleSegments = visibleIndexesOverride(options.segments.length, options.visibleSegments)
    this.dataState = options.dataState
    this.emptyMessage = options.emptyMessage
    this.loadingMessage = options.loadingMessage
    this.errorMessage = options.errorMessage
    this.showTooltip = options.showTooltip ?? true
    this.innerRatio = options.innerRatio ?? 0.58
    this.onSegmentVisibilityChange = options.onSegmentVisibilityChange
    this.onSegmentClick = options.onSegmentClick
  }

  setSegments(segments: DonutChartSegment[]): void {
    this.segments = cloneSegments(segments)
    if (this._visibleSegments !== undefined) {
      this._visibleSegments = normalizeVisibleIndexes(this.segments.length, this._visibleSegments)
    }
    this.markNeedsLayout()
  }

  setVisibleSegments(segmentIndexes?: number[], reason: ChartSeriesVisibilityChangeReason = 'api'): void {
    const previous = this.getVisibleSegments()
    this._visibleSegments = visibleIndexesOverride(this.segments.length, segmentIndexes)
    const next = this.getVisibleSegments()
    if (sameVisibleIndexes(previous, next)) return
    this._clearHoverState()
    this._notifySegmentVisibilityChange(previous, next, reason)
    this.markNeedsLayout()
  }

  getVisibleSegments(): number[] {
    return normalizeVisibleIndexes(this.segments.length, this._visibleSegments)
  }

  isSegmentVisible(segmentIndex: number): boolean {
    return isVisibleIndex(this.segments.length, this.getVisibleSegments(), segmentIndex)
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? 280 : constraints.maxWidth
    this.size = constrainSize(constraints, { width, height: this.height ?? 220 })
    const legend = this._legendLayout()
    this._chartRect = {
      x: 0,
      y: 0,
      width: legend.chartWidth,
      height: legend.chartHeight,
    }
    this._radius = Math.max(18, Math.min(legend.chartWidth, legend.chartHeight) * 0.34)
    this._center = {
      x: legend.chartWidth / 2,
      y: legend.chartHeight / 2,
    }
    this._computeSegments(context)
    this._legendItems = this._layoutLegendItems()
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const state = this._chartState()
    if (!isChartReady(state)) {
      paintChartState(dl, context, {
        x: offset.x + this._chartRect.x,
        y: offset.y + this._chartRect.y,
        width: this._chartRect.width,
        height: this._chartRect.height,
      }, state)
      if (this.showLegend) this._paintLegend(dl, context, offset)
      return
    }
    this._paintSegments(context, offset)
    this._paintCenter(dl, context, offset)
    if (this.showLegend) this._paintLegend(dl, context, offset)
    if (this.showTooltip && this._hoverIndex >= 0) this._paintTooltip(dl, context, offset)
  }

  onPointerMove(event: PointerEvent): void {
    const legendHover = this._hitLegendItem(event.position)
    if (legendHover >= 0) {
      let changed = this._setHoverLegendIndex(legendHover)
      if (this._hoverIndex >= 0) {
        this._hoverIndex = -1
        changed = true
      }
      if (changed) this.markNeedsPaint()
      return
    }
    const legendChanged = this._setHoverLegendIndex(-1)
    if (!isChartReady(this._chartState())) {
      if (this._hoverIndex >= 0) {
        this._hoverIndex = -1
        this.markNeedsPaint()
      } else if (legendChanged) {
        this.markNeedsPaint()
      }
      return
    }
    const next = this._hitSegment(event.position)
    if (next === this._hoverIndex) {
      if (legendChanged) this.markNeedsPaint()
      return
    }
    this._hoverIndex = next
    this.markNeedsPaint()
  }

  onPointerLeave(_event: PointerEvent): void {
    if (this._hoverIndex < 0 && this._hoverLegendIndex < 0) return
    this._clearHoverState()
    this.markNeedsPaint()
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    const legendIndex = this._hitLegendItem(event.position)
    if (legendIndex >= 0) {
      this._toggleSegmentVisibility(legendIndex)
      return
    }
    if (!isChartReady(this._chartState())) return
    const segment = this._layouts.find(item => item.index === this._hoverIndex)
    if (segment) this.onSegmentClick?.({ ...segment })
  }

  debugState(): DonutChartDebugState {
    return {
      total: this._total,
      hoverIndex: this._hoverIndex,
      segments: this._layouts.map(segment => ({ ...segment })),
      tooltip: this._tooltipDebugState({ x: 0, y: 0 }),
      visibleSegments: this.getVisibleSegments(),
      hiddenSegments: hiddenIndexes(this.segments.length, this.getVisibleSegments()),
      center: { ...this._center },
      radius: this._radius,
      state: this._chartState(),
    }
  }

  dispose(): void {
    this.onSegmentVisibilityChange = undefined
    this.onSegmentClick = undefined
    super.dispose()
  }

  private _computeSegments(context: LayoutContext): void {
    const visibleSegments = this.getVisibleSegments()
    const positive = this.segments.map((segment, index) => (
      visibleSegments.includes(index) ? segment.value : 0
    ))
    this._total = positive.reduce((sum, value) => sum + value, 0)
    this._layouts = []
    if (this._total <= 0) return
    let angle = -Math.PI / 2
    this.segments.forEach((segment, index) => {
      const value = positive[index] ?? 0
      if (value <= 0) return
      const ratio = value / this._total
      const nextAngle = angle + Math.PI * 2 * ratio
      this._layouts.push({
        index,
        label: segment.label,
        value: segment.value,
        ratio,
        startAngle: angle,
        endAngle: nextAngle,
        color: chartColor(context.theme, index, segment.color),
      })
      angle = nextAngle
    })
    if (!this._layouts.some(segment => segment.index === this._hoverIndex)) this._hoverIndex = -1
  }

  private _paintSegments(context: PaintContext, offset: Offset): void {
    const ctx = context.ctx
    const cx = offset.x + this._center.x
    const cy = offset.y + this._center.y
    const innerRatio = this._innerRatio()
    const lineWidth = Math.max(8, this._radius * (1 - innerRatio))
    ctx.save()
    ctx.lineWidth = lineWidth
    ctx.lineCap = 'butt'
    for (const segment of this._layouts) {
      const hovered = segment.index === this._hoverIndex
      ctx.beginPath()
      ctx.strokeStyle = colorToCSS(hovered ? withAlpha(segment.color, 1) : segment.color)
      ctx.arc(cx, cy, this._radius, segment.startAngle + 0.012, segment.endAngle - 0.012)
      ctx.stroke()
    }
    ctx.restore()
  }

  private _paintCenter(dl: DrawList, context: PaintContext, offset: Offset): void {
    const cx = offset.x + this._center.x
    const cy = offset.y + this._center.y
    dl.fillCircle(cx, cy, this._radius * this._innerRatio(), context.theme.surfacePanel)
    dl.fillText(formatChartNumber(this._total), cx, cy - 5, context.theme.textPrimary, context.theme.fontSize + 4, context.theme.fontFamily, 'center', 'middle', 600)
    dl.fillText('总计', cx, cy + 15, context.theme.textSecondary, Math.max(10, context.theme.fontSize - 2), context.theme.fontFamily, 'center', 'middle')
  }

  private _paintLegend(dl: DrawList, context: PaintContext, offset: Offset): void {
    const fontSize = Math.max(10, context.theme.fontSize - 2)
    const visibleSegments = this.getVisibleSegments()
    for (const item of this._legendItems) {
      const segment = this.segments[item.index]!
      const layout = this._layouts.find(entry => entry.index === item.index)
      const visible = visibleSegments.includes(item.index)
      const color = chartColor(context.theme, item.index, segment.color)
      const centerY = offset.y + item.y + item.height / 2
      if (this.legendMode === 'toggle' && item.index === this._hoverLegendIndex) {
        dl.fillRect(offset.x + item.x, offset.y + item.y, item.width - 4, item.height, context.theme.stateHoverOverlay, 4)
      }
      dl.fillRect(offset.x + item.x, centerY - 4, 8, 8, visible ? color : withAlpha(color, 0.28))
      dl.fillText(
        segment.label,
        offset.x + item.x + 12,
        centerY,
        visible ? context.theme.textSecondary : context.theme.textDisabled,
        fontSize,
        context.theme.fontFamily,
        'left',
        'middle',
      )
      if (item.width >= 72) {
        const value = layout ? `${Math.round(layout.ratio * 100)}%` : '隐藏'
        dl.fillText(
          value,
          offset.x + item.x + item.width - 8,
          centerY,
          visible ? context.theme.textPrimary : context.theme.textDisabled,
          fontSize,
          context.theme.fontFamily,
          'right',
          'middle',
        )
      }
    }
  }

  private _paintTooltip(dl: DrawList, context: PaintContext, offset: Offset): void {
    const segment = this._layouts.find(item => item.index === this._hoverIndex)
    if (!segment) return
    const layout = this._segmentTooltipLayout(offset, segment)
    if (layout) paintChartTooltip(dl, context, layout)
  }

  private _tooltipDebugState(offset: Offset): ChartTooltipDebugState | null {
    if (!this.showTooltip) return null
    const segment = this._layouts.find(item => item.index === this._hoverIndex)
    return segment ? this._segmentTooltipLayout(offset, segment) : null
  }

  private _segmentTooltipLayout(offset: Offset, segment: DonutSegmentLayout): ChartTooltipDebugState | null {
    const mid = (segment.startAngle + segment.endAngle) / 2
    const anchorX = offset.x + this._center.x + Math.cos(mid) * this._radius
    const anchorY = offset.y + this._center.y + Math.sin(mid) * this._radius
    return layoutChartTooltip({
      title: segment.label,
      items: [{
        label: 'Value',
        value: `${formatChartNumber(segment.value)} · ${Math.round(segment.ratio * 100)}%`,
        color: segment.color,
      }],
      anchorX,
      anchorY,
      boundsX: offset.x,
      boundsY: offset.y,
      boundsWidth: this.size.width,
      boundsHeight: this.size.height,
      minWidth: 118,
    })
  }

  private _chartState(): ChartStateDebugState {
    return resolveChartState(this, this._layouts.length > 0)
  }

  private _hitSegment(position: Offset): number {
    if (!this.hitTest(position)) return -1
    const local = {
      x: position.x - this.globalOffset.x - this._center.x,
      y: position.y - this.globalOffset.y - this._center.y,
    }
    const distance = Math.hypot(local.x, local.y)
    const innerRatio = this._innerRatio()
    const inner = this._radius * innerRatio
    if (distance < inner || distance > this._radius + Math.max(8, this._radius * (1 - innerRatio)) / 2) return -1
    let angle = Math.atan2(local.y, local.x)
    if (angle < -Math.PI / 2) angle += Math.PI * 2
    return this._layouts.find(segment => angle >= segment.startAngle && angle <= segment.endAngle)?.index ?? -1
  }

  private _innerRatio(): number {
    return Math.max(0.15, Math.min(0.85, this.innerRatio))
  }

  private _legendLayout(): DonutLegendLayout {
    if (!this.showLegend) {
      return {
        right: false,
        rightWidth: 0,
        bottomHeight: 0,
        chartWidth: this.size.width,
        chartHeight: this.size.height,
        columns: 1,
        itemWidth: 0,
      }
    }

    if (this.size.width >= 260) {
      const rightWidth = 112
      return {
        right: true,
        rightWidth,
        bottomHeight: 0,
        chartWidth: Math.max(40, this.size.width - rightWidth),
        chartHeight: this.size.height,
        columns: 1,
        itemWidth: rightWidth,
      }
    }

    const count = this._visibleSegmentCount()
    if (count === 0) {
      return {
        right: false,
        rightWidth: 0,
        bottomHeight: 0,
        chartWidth: this.size.width,
        chartHeight: this.size.height,
        columns: 1,
        itemWidth: 0,
      }
    }
    const availableWidth = Math.max(40, this.size.width - 16)
    const columns = Math.max(1, Math.floor(availableWidth / 92))
    const rows = Math.ceil(count / columns)
    const bottomHeight = Math.min(rows * 20 + 10, Math.max(0, this.size.height - 60))
    return {
      right: false,
      rightWidth: 0,
      bottomHeight,
      chartWidth: this.size.width,
      chartHeight: Math.max(40, this.size.height - bottomHeight),
      columns,
      itemWidth: availableWidth / columns,
    }
  }

  private _visibleSegmentCount(): number {
    return this.segments.filter(segment => segment.value > 0).length
  }

  private _layoutLegendItems(): ChartLegendItemLayout[] {
    if (!this.showLegend) return []
    const legend = this._legendLayout()
    const indexes = this._legendSegmentIndexes()
    if (legend.right) {
      const x = this.size.width - legend.rightWidth + 6
      let y = Math.max(14, this._center.y - indexes.length * 11)
      return indexes.map(index => {
        const item = {
          index,
          x,
          y: y - 10,
          width: legend.rightWidth - 12,
          height: 20,
        }
        y += 22
        return item
      })
    }

    const startX = 8
    const startY = legend.chartHeight + 8
    return indexes.map((index, itemIndex) => {
      const column = itemIndex % legend.columns
      const row = Math.floor(itemIndex / legend.columns)
      return {
        index,
        x: startX + column * legend.itemWidth,
        y: startY + row * 20 - 10,
        width: legend.itemWidth,
        height: 20,
      }
    })
  }

  private _legendSegmentIndexes(): number[] {
    return this.segments.flatMap((segment, index) => segment.value > 0 ? [index] : [])
  }

  private _hitLegendItem(position: Offset): number {
    if (this.legendMode !== 'toggle' || !this.showLegend) return -1
    return hitLegendItem(this._legendItems, position, this.globalOffset)
  }

  private _setHoverLegendIndex(index: number): boolean {
    if (this._hoverLegendIndex === index) return false
    this._hoverLegendIndex = index
    return true
  }

  private _toggleSegmentVisibility(segmentIndex: number): void {
    const previous = this.getVisibleSegments()
    const next = toggleVisibleIndex(this.segments.length, previous, segmentIndex)
    this._visibleSegments = visibleIndexesOverride(this.segments.length, next)
    this._clearHoverState()
    this._notifySegmentVisibilityChange(previous, next, 'legendToggle')
    this.markNeedsLayout()
  }

  private _notifySegmentVisibilityChange(
    previous: readonly number[],
    next: readonly number[],
    reason: ChartSeriesVisibilityChangeReason,
  ): void {
    const segmentIndex = firstChangedVisibleIndex(this.segments.length, previous, next)
    if (segmentIndex < 0) return
    this.onSegmentVisibilityChange?.({
      segmentIndex,
      label: this.segments[segmentIndex]?.label ?? '',
      visible: next.includes(segmentIndex),
      visibleSegments: [...next],
      hiddenSegments: hiddenIndexes(this.segments.length, next),
      reason,
    })
  }

  private _clearHoverState(): void {
    this._hoverLegendIndex = -1
    this._hoverIndex = -1
  }
}

function cloneSegments(segments: readonly DonutChartSegment[]): DonutChartSegment[] {
  return segments.map(segment => ({
    ...segment,
    value: Math.max(0, normalizeChartNumber(segment.value)),
  }))
}
