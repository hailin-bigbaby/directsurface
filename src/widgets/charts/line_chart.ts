import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../../core/render_object'
import type { GestureArenaMember } from '../../gestures/gesture_arena'
import { PendingPointerGesture } from '../../gestures/pending_pointer_gesture'
import type { InteractiveRenderObject, PointerEvent, WheelPointerEvent } from '../../gestures/recognizers'
import { isPrimaryPointerButton } from '../../gestures/hit_test'
import { RenderBox, type RenderBoxOptions } from '../../layout/render_box'
import { DrawList } from '../../rendering/draw_list'
import type { PaintContext } from '../../rendering/paint_context'
import type { Color } from '../../theme/theme'
import { chartColor, withAlpha } from './chart_palette'
import { paintCartesianFrame } from './chart_axis'
import {
  chartXValue,
  clampChartDomain,
  createLinearScale,
  formatChartNumber,
  formatChartTime,
  formatChartX,
  niceTicks,
  niceTimeTicks,
  normalizeLinearDomain,
} from './chart_scale'
import {
  chartAxisLabelsVisible,
  chartAxisTickCount,
  cloneChartAxisOptions,
  formatChartAxisLabel,
  resolveChartAxisDomain,
  truncateChartAxisLabel,
} from './chart_axis_options'
import {
  cloneChartSeries,
  decimateMinMaxDatums,
  resolveChartAxisType,
  resolveFullChartXDomain,
} from './chart_data'
import {
  cloneChartAnnotations,
  collectChartAnnotationValues,
  layoutChartAnnotations,
  paintChartAnnotationForeground,
  paintChartAnnotationRanges,
} from './chart_annotations'
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
  ChartAnnotation,
  ChartAnnotationLayout,
  ChartAxisOptions,
  ChartAxisRole,
  ChartAxisType,
  ChartDataState,
  ChartDecimationMode,
  ChartDomain,
  ChartLegendMode,
  ChartPointLayout,
  ChartPlotRect,
  ChartSeries,
  ChartSeriesVisibilityChangeEvent,
  ChartSeriesVisibilityChangeReason,
  ChartStackMode,
  ChartStateDebugState,
  ChartTooltipDebugState,
  ChartTooltipItem,
  ChartTooltipMode,
  ChartViewportChangeEvent,
  ChartViewportChangeReason,
  ChartWheelZoomModifier,
  ChartX,
} from './chart_types'

const DRAG_SLOP = 4

export interface LineChartDebugState {
  plot: ChartPlotRect
  hover: ChartPointLayout | null
  crosshair: { x: number; y: number; points: ChartPointLayout[] } | null
  tooltip: ChartTooltipDebugState | null
  visibleSeries: number[]
  hiddenSeries: number[]
  annotations: ChartAnnotationLayout[]
  points: ChartPointLayout[]
  seriesCount: number
  xDomain: ChartDomain
  xViewport: ChartDomain
  yDomain: ChartDomain
  xLabels: Array<{ label: string; x: number }>
  yTicks: Array<{ value: number; label: string }>
  axisType: ChartAxisType
  stackMode: ChartStackMode
  state: ChartStateDebugState
}

export interface RenderLineChartOptions extends RenderBoxOptions {
  series: ChartSeries[]
  xAxis?: ChartAxisOptions
  yAxis?: ChartAxisOptions
  area?: boolean
  showGrid?: boolean
  showLegend?: boolean
  legendMode?: ChartLegendMode
  visibleSeries?: number[]
  annotations?: ChartAnnotation[]
  stackMode?: ChartStackMode
  dataState?: ChartDataState
  emptyMessage?: string
  loadingMessage?: string
  errorMessage?: string
  showTooltip?: boolean
  tooltipMode?: ChartTooltipMode
  showCrosshair?: boolean
  xAxisType?: ChartAxisType
  xViewport?: ChartDomain
  enablePan?: boolean
  enableWheelZoom?: boolean
  wheelZoomModifier?: ChartWheelZoomModifier
  wheelZoomSpeed?: number
  minXSpan?: number
  maxXSpan?: number
  decimation?: ChartDecimationMode
  onViewportChange?: (event: ChartViewportChangeEvent) => void
  onSeriesVisibilityChange?: (event: ChartSeriesVisibilityChangeEvent) => void
  onPointClick?: (point: ChartPointLayout) => void
}

interface LineChartDatum {
  seriesIndex: number
  pointIndex: number
  order: number
  xValue: number
  yValue: number
  stackBase?: number
  stackValue?: number
  stackTotal?: number
  stackRatio?: number
  label: string
  seriesName: string
}

interface LineChartAxisHover {
  x: number
  label: string
  primary: ChartPointLayout
  points: ChartPointLayout[]
}

interface StackTotals {
  positive: number
  negative: number
  total: number
}

export class RenderLineChart extends RenderBox implements InteractiveRenderObject, GestureArenaMember {
  static override debugTypeName = 'RenderLineChart'
  readonly preventsPointerActivationOnAccept = true
  series: ChartSeries[]
  annotations: ChartAnnotation[]
  xAxis: ChartAxisOptions
  yAxis: ChartAxisOptions
  area: boolean
  showGrid: boolean
  showLegend: boolean
  legendMode: ChartLegendMode
  stackMode: ChartStackMode
  dataState?: ChartDataState
  emptyMessage?: string
  loadingMessage?: string
  errorMessage?: string
  showTooltip: boolean
  tooltipMode: ChartTooltipMode
  showCrosshair: boolean
  xAxisType: ChartAxisType
  xViewport?: ChartDomain
  enablePan: boolean
  enableWheelZoom: boolean
  wheelZoomModifier: ChartWheelZoomModifier
  wheelZoomSpeed: number
  minXSpan?: number
  maxXSpan?: number
  decimation: ChartDecimationMode
  onViewportChange?: (event: ChartViewportChangeEvent) => void
  onSeriesVisibilityChange?: (event: ChartSeriesVisibilityChangeEvent) => void
  onPointClick?: (point: ChartPointLayout) => void

  private _plot: ChartPlotRect = { x: 0, y: 0, width: 0, height: 0 }
  private _points: ChartPointLayout[] = []
  private _annotationLayouts: ChartAnnotationLayout[] = []
  private _legendItems: ChartLegendItemLayout[] = []
  private _visibleSeries?: number[]
  private _hoverLegendIndex = -1
  private _hover: ChartPointLayout | null = null
  private _axisHover: LineChartAxisHover | null = null
  private _fullXDomain: ChartDomain = { min: 0, max: 1 }
  private _activeXViewport: ChartDomain = { min: 0, max: 1 }
  private _yDomain: ChartDomain = { min: 0, max: 1 }
  private _xLabels: Array<{ label: string; x: number }> = []
  private _yTicks: Array<{ value: number; label: string }> = []
  private _resolvedAxisType: ChartAxisType = 'linear'
  private readonly _pendingGesture = new PendingPointerGesture()
  private _panning = false
  private _panStart?: Offset
  private _panLast?: Offset
  private _panStartViewport?: ChartDomain
  private _pressPoint?: ChartPointLayout

  constructor(options: RenderLineChartOptions) {
    super({ ...options, height: options.height ?? 220 })
    this.series = cloneChartSeries(options.series)
    this.annotations = cloneChartAnnotations(options.annotations)
    this.xAxis = cloneChartAxisOptions(options.xAxis)
    this.yAxis = cloneChartAxisOptions(options.yAxis)
    this.area = options.area ?? false
    this.showGrid = options.showGrid ?? true
    this.showLegend = options.showLegend ?? true
    this.legendMode = options.legendMode ?? 'static'
    this.stackMode = options.stackMode ?? 'none'
    this._visibleSeries = visibleIndexesOverride(options.series.length, options.visibleSeries)
    this.dataState = options.dataState
    this.emptyMessage = options.emptyMessage
    this.loadingMessage = options.loadingMessage
    this.errorMessage = options.errorMessage
    this.showTooltip = options.showTooltip ?? true
    this.tooltipMode = options.tooltipMode ?? 'axis'
    this.showCrosshair = options.showCrosshair ?? this.showTooltip
    this.xAxisType = options.xAxisType ?? 'auto'
    this.xViewport = options.xViewport ? { ...options.xViewport } : undefined
    this.enablePan = options.enablePan ?? false
    this.enableWheelZoom = options.enableWheelZoom ?? false
    this.wheelZoomModifier = options.wheelZoomModifier ?? 'ctrlOrMeta'
    this.wheelZoomSpeed = options.wheelZoomSpeed ?? 0.12
    this.minXSpan = options.minXSpan
    this.maxXSpan = options.maxXSpan
    this.decimation = options.decimation ?? 'minMax'
    this.onViewportChange = options.onViewportChange
    this.onSeriesVisibilityChange = options.onSeriesVisibilityChange
    this.onPointClick = options.onPointClick
  }

  setSeries(series: ChartSeries[]): void {
    this.series = cloneChartSeries(series)
    if (this._visibleSeries !== undefined) {
      this._visibleSeries = normalizeVisibleIndexes(this.series.length, this._visibleSeries)
    }
    this.markNeedsLayout()
  }

  setAnnotations(annotations: ChartAnnotation[]): void {
    this.annotations = cloneChartAnnotations(annotations)
    this.markNeedsLayout()
  }

  getAnnotations(): ChartAnnotation[] {
    return cloneChartAnnotations(this.annotations)
  }

  setVisibleSeries(seriesIndexes?: number[], reason: ChartSeriesVisibilityChangeReason = 'api'): void {
    const previous = this.getVisibleSeries()
    this._visibleSeries = visibleIndexesOverride(this.series.length, seriesIndexes)
    const next = this.getVisibleSeries()
    if (sameVisibleIndexes(previous, next)) return
    this._clearHoverState()
    this._notifySeriesVisibilityChange(previous, next, reason)
    this.markNeedsLayout()
  }

  getVisibleSeries(): number[] {
    return normalizeVisibleIndexes(this.series.length, this._visibleSeries)
  }

  isSeriesVisible(seriesIndex: number): boolean {
    return isVisibleIndex(this.series.length, this.getVisibleSeries(), seriesIndex)
  }

  setXViewport(viewport?: ChartDomain, reason: ChartViewportChangeReason = 'api'): void {
    this._fullXDomain = this._resolveFullXDomain()
    const next = viewport
      ? this._clampViewport(viewport)
      : { ...this._fullXDomain }
    const previous = { ...this._activeXViewport }
    this.xViewport = viewport ? { ...next } : undefined
    this._activeXViewport = next
    if (!sameDomain(previous, next)) this._notifyViewportChange(reason)
    this.markNeedsLayout()
  }

  resetXViewport(): void {
    this.setXViewport(undefined, 'reset')
  }

  getXViewport(): ChartDomain {
    return { ...this._activeXViewport }
  }

  getFullXDomain(): ChartDomain {
    this._fullXDomain = this._resolveFullXDomain()
    return { ...this._fullXDomain }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? 360 : constraints.maxWidth
    this.size = constrainSize(constraints, { width, height: this.height ?? 220 })
    const top = this.showLegend ? 28 : 14
    this._plot = {
      x: 46,
      y: top,
      width: Math.max(20, this.size.width - 60),
      height: Math.max(20, this.size.height - top - 30),
    }
    this._computeLayout()
    this._legendItems = this._layoutLegendItems()
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const plot = this._offsetPlot(offset)
    paintCartesianFrame({
      dl,
      theme: context.theme,
      plot,
      yTicks: this._yTicks.map(tick => tick.value),
      yToPixel: value => plot.y + this._plot.height - ((value - this._yDomain.min) / (this._yDomain.max - this._yDomain.min)) * this._plot.height,
      yTickLabel: (_value, index) => this._yTicks[index]?.label ?? '',
      xLabels: this._xLabels.map(label => ({ label: label.label, x: offset.x + label.x })),
      showGrid: this.showGrid,
      showXLabels: chartAxisLabelsVisible(this.xAxis),
      showYLabels: chartAxisLabelsVisible(this.yAxis),
    })
    if (this.showLegend) this._paintLegend(dl, context, offset)
    const state = this._chartState()
    if (!isChartReady(state)) {
      paintChartState(dl, context, plot, state)
      return
    }
    paintChartAnnotationRanges(dl, context, this._annotationLayouts, this.annotations, offset)
    this._paintSeries(context, offset)
    paintChartAnnotationForeground(dl, context, this._annotationLayouts, this.annotations, this._plot, offset)
    this._paintHoverState(dl, context, offset)
  }

  onPointerMove(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    if (this._pendingGesture.isPending && !this._panning) {
      this._panLast = event.position
      this._resolvePanIntent(event.position)
      return
    }
    if (this._panning) {
      this._panLast = event.position
      this._applyPan(event.position)
      return
    }

    const legendHover = this._hitLegendItem(event.position)
    if (legendHover >= 0) {
      let changed = this._setHoverLegendIndex(legendHover)
      if (this._hover || this._axisHover) {
        this._clearDataHoverState()
        changed = true
      }
      if (changed) this.markNeedsPaint()
      return
    }
    const legendChanged = this._setHoverLegendIndex(-1)
    if (!isChartReady(this._chartState())) {
      if (this._hover || this._axisHover) {
        this._clearDataHoverState()
        this.markNeedsPaint()
      } else if (legendChanged) {
        this.markNeedsPaint()
      }
      return
    }

    const next = this.tooltipMode === 'axis'
      ? this._nearestAxisHover(event.position)
      : null
    if (this.tooltipMode === 'axis') {
      if (sameAxisHover(next, this._axisHover)) {
        if (legendChanged) this.markNeedsPaint()
        return
      }
      this._axisHover = next
      this._hover = next?.primary ?? null
      this.markNeedsPaint()
      return
    }

    const item = this._nearestPoint(event.position)
    if (samePoint(item, this._hover)) {
      if (legendChanged) this.markNeedsPaint()
      return
    }
    this._axisHover = null
    this._hover = item
    this.markNeedsPaint()
  }

  onPointerLeave(_event: PointerEvent): void {
    if (this._panning || (!this._hover && !this._axisHover && this._hoverLegendIndex < 0)) return
    this._clearHoverState()
    this.markNeedsPaint()
  }

  onPointerDown(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    if (!isPrimaryPointerButton(event)) return
    const legendIndex = this._hitLegendItem(event.position)
    if (legendIndex >= 0) {
      this._toggleSeriesVisibility(legendIndex)
      return
    }
    const point = this._hoverPointForPosition(event.position)
    if (!isChartReady(this._chartState())) return
    if (this.enablePan && this._isInPlot(event.position) && event.joinGestureArena) {
      this._resetPanState()
      this._pressPoint = point ? { ...point } : undefined
      this._panStart = event.position
      this._panLast = event.position
      this._panStartViewport = this.getXViewport()
      this._pendingGesture.begin(event, this)
      return
    }
    if (point) this.onPointClick?.({ ...point })
  }

  onPointerUp(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    if (!isPrimaryPointerButton(event)) return
    const wasPanning = this._panning
    const clickPoint = this._pressPoint
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => this._clearPanState(),
      () => {
        if (!wasPanning && clickPoint) this.onPointClick?.({ ...clickPoint })
      },
    )
  }

  onPointerCancel(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => this._clearPanState(),
    )
  }

  onWheel(event: WheelPointerEvent): boolean {
    if (!isChartReady(this._chartState())) return false
    if (!this.enableWheelZoom || !this._isInPlot(event.position)) return false
    if (!this._matchesWheelModifier(event)) return false
    const wheelDelta = event.deltaY !== 0 ? event.deltaY : event.deltaX
    if (wheelDelta === 0) return false

    this._fullXDomain = this._resolveFullXDomain()
    const current = this.getXViewport()
    const span = current.max - current.min
    if (span <= 0) return false
    const local = this._toLocal(event.position)
    const anchorRatio = clamp01((local.x - this._plot.x) / Math.max(1, this._plot.width))
    const anchor = current.min + span * anchorRatio
    const factor = Math.exp((wheelDelta > 0 ? 1 : -1) * this.wheelZoomSpeed)
    const next = {
      min: anchor - (anchor - current.min) * factor,
      max: anchor + (current.max - anchor) * factor,
    }
    return this._setViewport(next, 'wheel')
  }

  acceptGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.accept(pointerId, pointerType)) return
    this._panning = true
    if (this._panLast) this._applyPan(this._panLast)
  }

  rejectGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.reject(pointerId, pointerType)) return
    this._resetPanState()
  }

  debugState(): LineChartDebugState {
    return {
      plot: { ...this._plot },
      hover: this._hover ? { ...this._hover } : null,
      crosshair: this._crosshairDebugState(),
      tooltip: this._tooltipDebugState({ x: 0, y: 0 }),
      visibleSeries: this.getVisibleSeries(),
      hiddenSeries: hiddenIndexes(this.series.length, this.getVisibleSeries()),
      annotations: this._annotationLayouts.map(annotation => ({ ...annotation })),
      points: this._points.map(point => ({ ...point })),
      seriesCount: this.series.length,
      xDomain: { ...this._fullXDomain },
      xViewport: { ...this._activeXViewport },
      yDomain: { ...this._yDomain },
      xLabels: this._xLabels.map(label => ({ ...label })),
      yTicks: this._yTicks.map(tick => ({ ...tick })),
      axisType: this._resolvedAxisType,
      stackMode: this.stackMode,
      state: this._chartState(),
    }
  }

  dispose(): void {
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => this._clearPanState(),
      () => { this.onViewportChange = undefined },
      () => { this.onSeriesVisibilityChange = undefined },
      () => { this.onPointClick = undefined },
      () => super.dispose(),
    )
  }

  private _computeLayout(): void {
    this._resolvedAxisType = this._resolveAxisType()
    this._fullXDomain = this._resolveFullXDomain()
    this._activeXViewport = this.xViewport
      ? this._clampViewport(this.xViewport)
      : { ...this._fullXDomain }
    if (this.xViewport) this.xViewport = { ...this._activeXViewport }

    const datumsBySeries = new Map<number, LineChartDatum[]>()
    const visibleSeries = this.getVisibleSeries()
    this.series.forEach((series, seriesIndex) => {
      if (!visibleSeries.includes(seriesIndex)) return
      const datums = this._createDatums(series, seriesIndex)
      datumsBySeries.set(seriesIndex, datums)
    })
    const layoutDatumsBySeries = this._isStacked()
      ? this._stackDatumsBySeries(datumsBySeries, visibleSeries)
      : datumsBySeries
    const visibleBySeries = new Map<number, LineChartDatum[]>()
    for (const [seriesIndex, datums] of layoutDatumsBySeries) {
      const visible = includeViewportNeighbors(datums, this._activeXViewport)
      visibleBySeries.set(seriesIndex, this._decimateDatums(visible))
    }

    const annotationYValues = collectChartAnnotationValues(this.annotations, ['y', 'value'])
    const yValues = this._valuesForYDomain(layoutDatumsBySeries)
    this._yDomain = normalizeLinearDomain(
      [...yValues, ...annotationYValues],
      { paddingRatio: this.stackMode === 'percent' ? 0 : 0.08 },
    )
    this._yDomain = resolveChartAxisDomain(this._yDomain, this.yAxis)
    const xScale = createLinearScale(this._activeXViewport.min, this._activeXViewport.max, this._plot.x, this._plot.x + this._plot.width)
    const yScale = createLinearScale(this._yDomain.min, this._yDomain.max, this._plot.y + this._plot.height, this._plot.y)
    const xSpan = this._activeXViewport.max - this._activeXViewport.min
    this._points = []
    for (const datums of visibleBySeries.values()) {
      for (const datum of datums) {
        this._points.push({
          seriesIndex: datum.seriesIndex,
          pointIndex: datum.pointIndex,
          x: xScale.map(datum.xValue),
          y: yScale.map(datum.stackValue ?? datum.yValue),
          value: datum.yValue,
          stackBase: datum.stackBase,
          stackValue: datum.stackValue,
          stackTotal: datum.stackTotal,
          stackRatio: datum.stackRatio,
          label: this._formatXAxisLabel(
            datum.xValue,
            this._resolvedAxisType === 'time' ? formatChartTime(datum.xValue, xSpan) : datum.label,
            datum.pointIndex,
          ),
          seriesName: datum.seriesName,
        })
      }
    }
    this._xLabels = this._computeXLabels()
    this._yTicks = this._computeYTicks()
    const previousHover = this._hover
    const previousAxisHover = this._axisHover
    this._hover = previousHover ? this._findRenderedPoint(previousHover) : null
    if (this._hover && !this._isPointInPlot(this._hover)) this._hover = null
    if (previousAxisHover) {
      const primary = this._findRenderedPoint(previousAxisHover.primary)
      this._axisHover = primary && this._isPointInPlot(primary)
        ? this._axisHoverFromPoint(primary)
        : null
      this._hover = this._axisHover?.primary ?? null
    }
    this._annotationLayouts = this._layoutAnnotations()
  }

  private _paintSeries(context: PaintContext, offset: Offset): void {
    const ctx = context.ctx
    const absolutePlot = this._offsetPlot(offset)
    const pointsBySeries = new Map<number, ChartPointLayout[]>()
    for (const point of this._points) {
      const points = pointsBySeries.get(point.seriesIndex) ?? []
      points.push(point)
      pointsBySeries.set(point.seriesIndex, points)
    }

    ctx.save()
    ctx.beginPath()
    ctx.rect(absolutePlot.x, absolutePlot.y, absolutePlot.width, absolutePlot.height)
    ctx.clip()
    for (const [seriesIndex, points] of pointsBySeries) {
      if (points.length === 0) continue
      const color = chartColor(context.theme, seriesIndex, this.series[seriesIndex]?.color)
      if (this.area) {
        if (this._isStacked()) this._paintStackedArea(ctx, offset, points, color)
        else this._paintArea(ctx, offset, points, color)
      }
      ctx.beginPath()
      points.forEach((point, index) => {
        const x = offset.x + point.x
        const y = offset.y + point.y
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${color.a})`
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke()
    }
    ctx.restore()
  }

  private _paintArea(ctx: CanvasRenderingContext2D, offset: Offset, points: ChartPointLayout[], color: Color): void {
    const first = points[0]
    const last = points[points.length - 1]
    if (!first || !last) return
    ctx.beginPath()
    points.forEach((point, index) => {
      const x = offset.x + point.x
      const y = offset.y + point.y
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.lineTo(offset.x + last.x, offset.y + this._plot.y + this._plot.height)
    ctx.lineTo(offset.x + first.x, offset.y + this._plot.y + this._plot.height)
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, offset.y + this._plot.y, 0, offset.y + this._plot.y + this._plot.height)
    grad.addColorStop(0, `rgba(${color.r},${color.g},${color.b},0.22)`)
    grad.addColorStop(1, `rgba(${color.r},${color.g},${color.b},0.02)`)
    ctx.fillStyle = grad
    ctx.fill()
  }

  private _paintStackedArea(ctx: CanvasRenderingContext2D, offset: Offset, points: ChartPointLayout[], color: Color): void {
    const first = points[0]
    if (!first) return
    ctx.beginPath()
    points.forEach((point, index) => {
      const x = offset.x + point.x
      const y = offset.y + point.y
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    for (let index = points.length - 1; index >= 0; index -= 1) {
      const point = points[index]!
      const x = offset.x + point.x
      const y = offset.y + this._valueToY(point.stackBase ?? 0)
      ctx.lineTo(x, y)
    }
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, offset.y + this._plot.y, 0, offset.y + this._plot.y + this._plot.height)
    grad.addColorStop(0, `rgba(${color.r},${color.g},${color.b},0.28)`)
    grad.addColorStop(1, `rgba(${color.r},${color.g},${color.b},0.06)`)
    ctx.fillStyle = grad
    ctx.fill()
  }

  private _paintLegend(dl: DrawList, context: PaintContext, offset: Offset): void {
    const fontSize = Math.max(10, context.theme.fontSize - 2)
    const visibleSeries = this.getVisibleSeries()
    for (const item of this._legendItems) {
      const entry = this.series[item.index]!
      const visible = visibleSeries.includes(item.index)
      const color = chartColor(context.theme, item.index, entry.color)
      const swatch = visible ? color : withAlpha(color, 0.28)
      if (this.legendMode === 'toggle' && item.index === this._hoverLegendIndex) {
        dl.fillRect(offset.x + item.x, offset.y + item.y, item.width - 4, item.height, context.theme.stateHoverOverlay, 4)
      }
      dl.fillRect(offset.x + item.x, offset.y + item.y + item.height / 2 - 4, 8, 8, swatch)
      dl.fillText(
        entry.name,
        offset.x + item.x + 12,
        offset.y + item.y + item.height / 2,
        visible ? context.theme.textSecondary : context.theme.textDisabled,
        fontSize,
        context.theme.fontFamily,
        'left',
        'middle',
      )
    }
  }

  private _paintHoverState(dl: DrawList, context: PaintContext, offset: Offset): void {
    if (this.tooltipMode === 'axis' && this._axisHover) {
      this._paintAxisHover(dl, context, offset, this._axisHover)
      return
    }
    if (this._hover) this._paintItemHover(dl, context, offset, this._hover)
  }

  private _paintAxisHover(dl: DrawList, context: PaintContext, offset: Offset, hover: LineChartAxisHover): void {
    const x = offset.x + hover.x
    if (this.showCrosshair) {
      dl.line(x, offset.y + this._plot.y, x, offset.y + this._plot.y + this._plot.height, withAlpha(context.theme.textSecondary, 0.38), 1)
      dl.line(offset.x + this._plot.x, offset.y + hover.primary.y, offset.x + this._plot.x + this._plot.width, offset.y + hover.primary.y, withAlpha(context.theme.textSecondary, 0.18), 1)
    }
    if (this.showTooltip || this.showCrosshair) {
      for (const point of hover.points) {
        const color = chartColor(context.theme, point.seriesIndex, this.series[point.seriesIndex]?.color)
        dl.fillCircle(offset.x + point.x, offset.y + point.y, point === hover.primary ? 4.5 : 3.5, color)
        dl.strokeCircle(offset.x + point.x, offset.y + point.y, point === hover.primary ? 6 : 5, context.theme.surfacePanel, 2)
      }
    }
    if (!this.showTooltip) return
    const layout = this._axisTooltipLayout(offset, hover)
    if (layout) paintChartTooltip(dl, context, layout)
  }

  private _paintItemHover(dl: DrawList, context: PaintContext, offset: Offset, hover: ChartPointLayout): void {
    const color = chartColor(context.theme, hover.seriesIndex, this.series[hover.seriesIndex]?.color)
    const x = offset.x + hover.x
    const y = offset.y + hover.y
    if (this.showCrosshair) {
      dl.line(x, offset.y + this._plot.y, x, offset.y + this._plot.y + this._plot.height, withAlpha(context.theme.textSecondary, 0.35), 1)
    }
    if (this.showTooltip || this.showCrosshair) {
      dl.fillCircle(x, y, 4, color)
      dl.strokeCircle(x, y, 5.5, context.theme.surfacePanel, 2)
    }
    if (!this.showTooltip) return
    const layout = this._itemTooltipLayout(offset, hover)
    if (layout) paintChartTooltip(dl, context, layout)
  }

  private _computeXLabels(): Array<{ label: string; x: number }> {
    const labelCount = chartAxisTickCount(this.xAxis, Math.max(2, Math.min(6, Math.floor(this._plot.width / 90) + 1)))
    const xScale = createLinearScale(this._activeXViewport.min, this._activeXViewport.max, this._plot.x, this._plot.x + this._plot.width)
    if (this._resolvedAxisType === 'time') {
      return niceTimeTicks(this._activeXViewport.min, this._activeXViewport.max, labelCount)
        .map((tick, index) => ({
          label: this._formatXAxisLabel(tick.value, tick.label, index),
          x: xScale.map(tick.value),
        }))
    }
    if (this._resolvedAxisType === 'linear') {
      return niceTicks(this._activeXViewport.min, this._activeXViewport.max, labelCount)
        .map((tick, index) => ({
          label: this._formatXAxisLabel(tick, formatChartNumber(tick), index),
          x: xScale.map(tick),
        }))
    }

    const seriesIndex = this.series.findIndex(series => series.data.length > 0)
    if (seriesIndex < 0) return []
    const items = this.series[seriesIndex]!.data
      .map((point, index) => ({
        label: formatChartX(point.x),
        xValue: chartXValue(point.x, index),
        index,
      }))
      .filter(item => item.xValue >= this._activeXViewport.min && item.xValue <= this._activeXViewport.max)
    if (items.length === 0) return []
    const indexes = categoryLabelIndexes(items.length, labelCount)
    const step = this._plot.width / Math.max(1, Math.min(items.length, labelCount))
    const maxLabelLength = this.xAxis.maxLabelLength ?? Math.max(3, Math.floor(step / 7) - 1)
    return indexes.map(index => ({
      label: truncateChartAxisLabel(
        this._formatXAxisLabel(items[index]!.xValue, items[index]!.label, items[index]!.index),
        maxLabelLength,
      ),
      x: xScale.map(items[index]!.xValue),
    }))
  }

  private _computeYTicks(): Array<{ value: number; label: string }> {
    return niceTicks(this._yDomain.min, this._yDomain.max, chartAxisTickCount(this.yAxis, 4))
      .map((tick, index) => ({
        value: tick,
        label: this._formatYAxisLabel(tick, formatChartNumber(tick), index),
      }))
  }

  private _offsetPlot(offset: Offset): ChartPlotRect {
    return {
      x: offset.x + this._plot.x,
      y: offset.y + this._plot.y,
      width: this._plot.width,
      height: this._plot.height,
    }
  }

  private _valueToY(value: number): number {
    const span = this._yDomain.max - this._yDomain.min
    if (span === 0) return this._plot.y + this._plot.height / 2
    return this._plot.y + this._plot.height - ((value - this._yDomain.min) / span) * this._plot.height
  }

  private _nearestPoint(position: Offset): ChartPointLayout | null {
    if (!this.hitTest(position)) return null
    const local = this._toLocal(position)
    let best: ChartPointLayout | null = null
    let bestDistance = Infinity
    for (const point of this._points) {
      if (!this._isPointInPlot(point)) continue
      const distance = Math.hypot(point.x - local.x, point.y - local.y)
      if (distance < bestDistance) {
        bestDistance = distance
        best = point
      }
    }
    return bestDistance <= 18 ? best : null
  }

  private _nearestAxisHover(position: Offset): LineChartAxisHover | null {
    if (!this._isInPlot(position)) return null
    const local = this._toLocal(position)
    let best: ChartPointLayout | null = null
    let bestDistance = Infinity
    for (const point of this._points) {
      if (!this._isPointInPlot(point)) continue
      const distance = Math.abs(point.x - local.x)
      if (distance < bestDistance) {
        bestDistance = distance
        best = point
      }
    }
    return best ? this._axisHoverFromPoint(best, local.y) : null
  }

  private _axisHoverFromPoint(point: ChartPointLayout, localY?: number): LineChartAxisHover | null {
    const points = this._points
      .filter(candidate => this._isPointInPlot(candidate) && Math.abs(candidate.x - point.x) <= 0.5)
      .sort((a, b) => a.seriesIndex - b.seriesIndex)
    if (points.length === 0) return null
    const primary = localY === undefined
      ? points.find(candidate => samePoint(candidate, point)) ?? points[0]!
      : points.reduce((best, candidate) => (
        Math.abs(candidate.y - localY) < Math.abs(best.y - localY) ? candidate : best
      ), points[0]!)
    return {
      x: point.x,
      label: primary.label,
      primary,
      points,
    }
  }

  private _hoverPointForPosition(position: Offset): ChartPointLayout | null {
    if (this.tooltipMode === 'axis') {
      return this._axisHover?.primary ?? this._nearestAxisHover(position)?.primary ?? null
    }
    return this._hover ?? this._nearestPoint(position)
  }

  private _axisTooltipItems(hover: LineChartAxisHover): ChartTooltipItem[] {
    const items: ChartTooltipItem[] = hover.points.map(point => ({
      label: point.seriesName,
      value: this._formatStackedTooltipValue(point),
      color: chartColor(this.currentTheme, point.seriesIndex, this.series[point.seriesIndex]?.color),
    }))
    if (this._isStacked()) items.push(this._stackTotalTooltipItem(hover.points))
    return items
  }

  private _axisTooltipLayout(offset: Offset, hover: LineChartAxisHover): ChartTooltipDebugState | null {
    return layoutChartTooltip({
      title: hover.label,
      items: this._axisTooltipItems(hover),
      anchorX: offset.x + hover.x,
      anchorY: offset.y + hover.primary.y,
      boundsX: offset.x,
      boundsY: offset.y,
      boundsWidth: this.size.width,
      boundsHeight: this.size.height,
      minWidth: 118,
    })
  }

  private _itemTooltipLayout(offset: Offset, hover: ChartPointLayout): ChartTooltipDebugState | null {
    return layoutChartTooltip({
      title: hover.label,
      items: this._pointTooltipItems(hover),
      anchorX: offset.x + hover.x,
      anchorY: offset.y + hover.y,
      boundsX: offset.x,
      boundsY: offset.y,
      boundsWidth: this.size.width,
      boundsHeight: this.size.height,
      minWidth: 96,
    })
  }

  private _pointTooltipItems(point: ChartPointLayout): ChartTooltipItem[] {
    const items: ChartTooltipItem[] = [{
      label: point.seriesName,
      value: this._formatStackedTooltipValue(point),
      color: chartColor(this.currentTheme, point.seriesIndex, this.series[point.seriesIndex]?.color),
    }]
    if (this._isStacked()) items.push(this._stackTotalTooltipItem([point]))
    return items
  }

  private _formatStackedTooltipValue(point: ChartPointLayout): string {
    const value = this._formatDataValueLabel(point.value)
    if (this.stackMode !== 'percent') return value
    return `${value} · ${formatChartNumber(point.stackRatio ?? 0)}%`
  }

  private _stackTotalTooltipItem(points: readonly ChartPointLayout[]): ChartTooltipItem {
    const total = points[0]?.stackTotal ?? 0
    return {
      label: '总计',
      value: this._formatDataValueLabel(total),
    }
  }

  private _tooltipDebugState(offset: Offset): ChartTooltipDebugState | null {
    if (!this.showTooltip) return null
    if (this.tooltipMode === 'axis' && this._axisHover) {
      return this._axisTooltipLayout(offset, this._axisHover)
    }
    return this._hover ? this._itemTooltipLayout(offset, this._hover) : null
  }

  private _layoutLegendItems(): ChartLegendItemLayout[] {
    if (!this.showLegend) return []
    let x = this._plot.x
    return this.series.map((entry, index) => {
      const width = Math.max(62, entry.name.length * 7 + 24)
      const item = {
        index,
        x,
        y: 2,
        width,
        height: 20,
      }
      x += width
      return item
    })
  }

  private _layoutAnnotations(): ChartAnnotationLayout[] {
    return layoutChartAnnotations({
      annotations: this.annotations,
      plot: this._plot,
      xDomain: this._activeXViewport,
      yDomain: this._yDomain,
      resolveAxis: axis => axis === 'x' ? 'x' : 'y',
      resolveXValue: value => this._resolveAnnotationXValue(value),
      resolveYValue: value => this._resolveAnnotationYValue(value),
    })
  }

  private _chartState(): ChartStateDebugState {
    return resolveChartState(this, this._points.length > 0)
  }

  private _isStacked(): boolean {
    return this.stackMode !== 'none'
  }

  private _stackDatumsBySeries(
    datumsBySeries: Map<number, LineChartDatum[]>,
    visibleSeries: readonly number[],
  ): Map<number, LineChartDatum[]> {
    const result = new Map<number, LineChartDatum[]>()
    const byX = new Map<number, Map<number, LineChartDatum>>()
    for (const seriesIndex of visibleSeries) {
      result.set(seriesIndex, [])
      for (const datum of datumsBySeries.get(seriesIndex) ?? []) {
        const group = byX.get(datum.xValue) ?? new Map<number, LineChartDatum>()
        group.set(seriesIndex, datum)
        byX.set(datum.xValue, group)
      }
    }

    const xValues = [...byX.keys()].sort((a, b) => a - b)
    for (const xValue of xValues) {
      const group = byX.get(xValue)
      if (!group) continue
      const totals = this._lineStackTotals(group, visibleSeries)
      let positiveBase = 0
      let negativeBase = 0
      for (const seriesIndex of visibleSeries) {
        const datum = group.get(seriesIndex)
        if (!datum) continue
        const delta = this._lineStackDelta(datum.yValue, totals)
        const base = datum.yValue >= 0 ? positiveBase : negativeBase
        const stackValue = base + delta
        if (datum.yValue >= 0) positiveBase = stackValue
        else negativeBase = stackValue
        result.get(seriesIndex)?.push({
          ...datum,
          stackBase: base,
          stackValue,
          stackTotal: totals.total,
          stackRatio: this.stackMode === 'percent' ? this._lineStackRatio(datum.yValue, totals) : undefined,
        })
      }
    }

    return result
  }

  private _valuesForYDomain(datumsBySeries: Map<number, LineChartDatum[]>): number[] {
    const visible: number[] = []
    const fallback: number[] = []
    const includeBase = this._isStacked()
    for (const datums of datumsBySeries.values()) {
      for (const datum of datums) {
        const base = datum.stackBase ?? 0
        const value = datum.stackValue ?? datum.yValue
        if (includeBase) fallback.push(base)
        fallback.push(value)
        if (datum.xValue >= this._activeXViewport.min && datum.xValue <= this._activeXViewport.max) {
          if (includeBase) visible.push(base)
          visible.push(value)
        }
      }
    }
    return visible.length > 0 ? visible : fallback
  }

  private _lineStackTotals(group: Map<number, LineChartDatum>, visibleSeries: readonly number[]): StackTotals {
    let positive = 0
    let negative = 0
    let total = 0
    for (const seriesIndex of visibleSeries) {
      const value = group.get(seriesIndex)?.yValue ?? 0
      total += value
      if (value >= 0) positive += value
      else negative += Math.abs(value)
    }
    return { positive, negative, total }
  }

  private _lineStackDelta(value: number, totals: StackTotals): number {
    if (this.stackMode !== 'percent') return value
    if (value >= 0) return totals.positive > 0 ? value / totals.positive * 100 : 0
    return totals.negative > 0 ? value / totals.negative * 100 : 0
  }

  private _lineStackRatio(value: number, totals: StackTotals): number {
    if (value >= 0) return totals.positive > 0 ? value / totals.positive * 100 : 0
    return totals.negative > 0 ? Math.abs(value) / totals.negative * 100 : 0
  }

  private _formatXAxisLabel(value: number, label: string, index?: number): string {
    return this._formatAxisLabel(this.xAxis, 'x', value, label, this._activeXViewport, index)
  }

  private _formatYAxisLabel(value: number, label: string, index?: number): string {
    const displayLabel = this.stackMode === 'percent' && !this.yAxis.unit && !this.yAxis.labelFormatter
      ? `${label}%`
      : label
    return this._formatAxisLabel(this.yAxis, 'y', value, displayLabel, this._yDomain, index)
  }

  private _formatDataValueLabel(value: number): string {
    if (this.stackMode === 'percent') return formatChartNumber(value)
    return this._formatAxisLabel(this.yAxis, 'y', value, formatChartNumber(value), this._yDomain)
  }

  private _formatAxisLabel(
    options: ChartAxisOptions,
    axis: ChartAxisRole,
    value: number,
    label: string,
    domain: ChartDomain,
    index?: number,
  ): string {
    return formatChartAxisLabel(options, value, {
      axis,
      axisType: axis === 'x' ? this._resolvedAxisType : 'linear',
      value,
      label,
      index,
      domain,
    })
  }

  private _resolveAnnotationXValue(value: ChartX | number): number | null {
    if (typeof value === 'string') {
      for (const series of this.series) {
        for (let index = 0; index < series.data.length; index += 1) {
          const point = series.data[index]!
          if (formatChartX(point.x) === value) return chartXValue(point.x, index)
        }
      }
      return null
    }
    if (value instanceof Date) {
      const time = value.getTime()
      return Number.isFinite(time) ? time : null
    }
    return Number.isFinite(value) ? value : null
  }

  private _resolveAnnotationYValue(value: ChartX | number): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
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

  private _toggleSeriesVisibility(seriesIndex: number): void {
    const previous = this.getVisibleSeries()
    const next = toggleVisibleIndex(this.series.length, previous, seriesIndex)
    this._visibleSeries = visibleIndexesOverride(this.series.length, next)
    this._clearHoverState()
    this._notifySeriesVisibilityChange(previous, next, 'legendToggle')
    this.markNeedsLayout()
  }

  private _notifySeriesVisibilityChange(
    previous: readonly number[],
    next: readonly number[],
    reason: ChartSeriesVisibilityChangeReason,
  ): void {
    const seriesIndex = firstChangedVisibleIndex(this.series.length, previous, next)
    if (seriesIndex < 0) return
    this.onSeriesVisibilityChange?.({
      seriesIndex,
      seriesName: this.series[seriesIndex]?.name ?? '',
      visible: next.includes(seriesIndex),
      visibleSeries: [...next],
      hiddenSeries: hiddenIndexes(this.series.length, next),
      reason,
    })
  }

  private _clearHoverState(): void {
    this._hoverLegendIndex = -1
    this._clearDataHoverState()
  }

  private _clearDataHoverState(): void {
    this._hover = null
    this._axisHover = null
  }

  private _findRenderedPoint(point: ChartPointLayout): ChartPointLayout | null {
    return this._points.find(candidate => samePoint(candidate, point)) ?? null
  }

  private _isPointInPlotX(point: ChartPointLayout): boolean {
    return point.x >= this._plot.x && point.x <= this._plot.x + this._plot.width
  }

  private _isPointInPlot(point: ChartPointLayout): boolean {
    return this._isPointInPlotX(point) &&
      point.y >= this._plot.y &&
      point.y <= this._plot.y + this._plot.height
  }

  private _crosshairDebugState(): LineChartDebugState['crosshair'] {
    if (!this.showCrosshair) return null
    if (this.tooltipMode === 'axis' && this._axisHover) {
      return {
        x: this._axisHover.x,
        y: this._axisHover.primary.y,
        points: this._axisHover.points.map(point => ({ ...point })),
      }
    }
    if (!this._hover) return null
    return {
      x: this._hover.x,
      y: this._hover.y,
      points: [{ ...this._hover }],
    }
  }

  private _createDatums(series: ChartSeries, seriesIndex: number): LineChartDatum[] {
    return series.data
      .map((point, pointIndex) => ({
        seriesIndex,
        pointIndex,
        order: pointIndex,
        xValue: chartXValue(point.x, pointIndex),
        yValue: point.y,
        label: formatChartX(point.x),
        seriesName: series.name,
      }))
      .filter(datum => Number.isFinite(datum.xValue) && Number.isFinite(datum.yValue))
  }

  private _decimateDatums(datums: LineChartDatum[]): LineChartDatum[] {
    if (this.decimation === 'none') return datums
    const inside = datums.filter(datum => datum.xValue >= this._activeXViewport.min && datum.xValue <= this._activeXViewport.max)
    const limit = Math.max(8, Math.floor(this._plot.width * 2))
    if (inside.length <= limit) return datums

    const bucketCount = Math.max(1, Math.floor(this._plot.width))
    return decimateMinMaxDatums(datums, this._activeXViewport, bucketCount, { includeEdgeNeighbors: true })
  }

  private _resolveAxisType(): ChartAxisType {
    return resolveChartAxisType(this.series, this.xAxisType)
  }

  private _resolveFullXDomain(): ChartDomain {
    return resolveFullChartXDomain(this.series)
  }

  private _setViewport(viewport: ChartDomain, reason: ChartViewportChangeReason): boolean {
    this._fullXDomain = this._resolveFullXDomain()
    const next = this._clampViewport(viewport)
    if (sameDomain(this._activeXViewport, next)) return false
    this.xViewport = { ...next }
    this._activeXViewport = next
    this._notifyViewportChange(reason)
    this.markNeedsLayout()
    return true
  }

  private _clampViewport(viewport: ChartDomain): ChartDomain {
    return clampChartDomain(viewport, this._fullXDomain, {
      minSpan: this.minXSpan,
      maxSpan: this.maxXSpan,
    })
  }

  private _notifyViewportChange(reason: ChartViewportChangeReason): void {
    this.onViewportChange?.({
      viewport: { ...this._activeXViewport },
      fullDomain: { ...this._fullXDomain },
      reason,
    })
  }

  private _resolvePanIntent(position: Offset): void {
    if (!this._panStart) return
    const dx = position.x - this._panStart.x
    const dy = position.y - this._panStart.y
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)
    if (Math.max(ax, ay) < DRAG_SLOP) return
    this._pendingGesture.resolve(ax >= ay ? 'accepted' : 'rejected')
  }

  private _applyPan(position: Offset): void {
    if (!this._panStart || !this._panStartViewport) return
    const span = this._panStartViewport.max - this._panStartViewport.min
    if (span <= 0 || this._plot.width <= 0) return
    const dx = position.x - this._panStart.x
    const delta = -(dx / this._plot.width) * span
    this._setViewport({
      min: this._panStartViewport.min + delta,
      max: this._panStartViewport.max + delta,
    }, 'pan')
  }

  private _resetPanState(): void {
    this._pendingGesture.releaseCapture()
    this._pendingGesture.resetPending()
    this._clearPanState()
  }

  private _clearPanState(): void {
    this._panning = false
    this._panStart = undefined
    this._panLast = undefined
    this._panStartViewport = undefined
    this._pressPoint = undefined
  }

  private _isInPlot(position: Offset): boolean {
    if (!this.hitTest(position)) return false
    const local = this._toLocal(position)
    return local.x >= this._plot.x &&
      local.x <= this._plot.x + this._plot.width &&
      local.y >= this._plot.y &&
      local.y <= this._plot.y + this._plot.height
  }

  private _toLocal(position: Offset): Offset {
    return {
      x: position.x - this.globalOffset.x,
      y: position.y - this.globalOffset.y,
    }
  }

  private _matchesWheelModifier(event: WheelPointerEvent): boolean {
    switch (this.wheelZoomModifier) {
      case 'none':
        return true
      case 'ctrl':
        return event.ctrlKey === true
      case 'meta':
        return event.metaKey === true
      case 'shift':
        return event.shiftKey === true
      case 'alt':
        return event.altKey === true
      case 'ctrlOrMeta':
        return event.ctrlKey === true || event.metaKey === true
    }
  }
}

function includeViewportNeighbors(datums: LineChartDatum[], viewport: ChartDomain): LineChartDatum[] {
  let first = -1
  let last = -1
  for (let index = 0; index < datums.length; index += 1) {
    const datum = datums[index]!
    if (datum.xValue < viewport.min || datum.xValue > viewport.max) continue
    if (first < 0) first = index
    last = index
  }
  if (first < 0 || last < 0) return []
  return datums.slice(Math.max(0, first - 1), Math.min(datums.length, last + 2))
}

function categoryLabelIndexes(length: number, maxCount: number): number[] {
  if (length <= 0 || maxCount <= 0) return []
  if (length <= maxCount) return Array.from({ length }, (_item, index) => index)
  if (maxCount === 1) return [0]
  const step = (length - 1) / (maxCount - 1)
  const result: number[] = []
  for (let index = 0; index < maxCount; index += 1) {
    const candidate = Math.round(index * step)
    if (!result.includes(candidate)) result.push(candidate)
  }
  if (result[result.length - 1] !== length - 1) result.push(length - 1)
  return result
}

function samePoint(a: ChartPointLayout | null, b: ChartPointLayout | null): boolean {
  return a?.seriesIndex === b?.seriesIndex && a?.pointIndex === b?.pointIndex
}

function sameAxisHover(a: LineChartAxisHover | null, b: LineChartAxisHover | null): boolean {
  if (!a || !b) return a === b
  return Math.abs(a.x - b.x) < 1e-6 && samePoint(a.primary, b.primary)
}

function sameDomain(a: ChartDomain, b: ChartDomain): boolean {
  return Math.abs(a.min - b.min) < 1e-6 && Math.abs(a.max - b.max) < 1e-6
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
