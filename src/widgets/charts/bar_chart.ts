import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../../core/render_object'
import type { InteractiveRenderObject, PointerEvent } from '../../gestures/recognizers'
import { isPrimaryPointerButton } from '../../gestures/hit_test'
import { RenderBox, type RenderBoxOptions } from '../../layout/render_box'
import { DrawList } from '../../rendering/draw_list'
import type { PaintContext } from '../../rendering/paint_context'
import { chartColor, withAlpha } from './chart_palette'
import { paintCartesianFrame } from './chart_axis'
import { createLinearScale, formatChartNumber, niceTicks, normalizeChartNumber, normalizeLinearDomain } from './chart_scale'
import {
  chartAxisLabelsVisible,
  chartAxisTickCount,
  cloneChartAxisOptions,
  formatChartAxisLabel,
  resolveChartAxisDomain,
  truncateChartAxisLabel,
} from './chart_axis_options'
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
  BarChartOrientation,
  ChartAnnotation,
  ChartAnnotationLayout,
  ChartAnnotationAxis,
  ChartAxisOptions,
  ChartAxisRole,
  BarChartSeries,
  ChartBarLayout,
  ChartDataState,
  ChartDomain,
  ChartLegendMode,
  ChartPlotRect,
  ChartSeriesVisibilityChangeEvent,
  ChartSeriesVisibilityChangeReason,
  ChartStackMode,
  ChartStateDebugState,
  ChartTooltipDebugState,
  ChartTooltipItem,
  ChartTooltipMode,
} from './chart_types'

export interface BarChartDebugState {
  plot: ChartPlotRect
  hover: ChartBarLayout | null
  hoverCategoryIndex: number
  tooltip: ChartTooltipDebugState | null
  visibleSeries: number[]
  hiddenSeries: number[]
  annotations: ChartAnnotationLayout[]
  bars: ChartBarLayout[]
  orientation: BarChartOrientation
  stackMode: ChartStackMode
  valueDomain: ChartDomain
  valueTicks: Array<{ value: number; label: string }>
  categoryLabels: BarChartCategoryLabelLayout[]
  state: ChartStateDebugState
}

export interface BarChartCategoryLabelLayout {
  index: number
  label: string
  x: number
  y: number
}

interface StackTotals {
  positive: number
  negative: number
  total: number
}

export interface RenderBarChartOptions extends RenderBoxOptions {
  categories: string[]
  series: BarChartSeries[]
  annotations?: ChartAnnotation[]
  valueAxis?: ChartAxisOptions
  categoryAxis?: ChartAxisOptions
  orientation?: BarChartOrientation
  stackMode?: ChartStackMode
  showGrid?: boolean
  showLegend?: boolean
  legendMode?: ChartLegendMode
  visibleSeries?: number[]
  dataState?: ChartDataState
  emptyMessage?: string
  loadingMessage?: string
  errorMessage?: string
  showTooltip?: boolean
  tooltipMode?: ChartTooltipMode
  maxBarThickness?: number
  onSeriesVisibilityChange?: (event: ChartSeriesVisibilityChangeEvent) => void
  onBarClick?: (bar: ChartBarLayout) => void
}

export class RenderBarChart extends RenderBox implements InteractiveRenderObject {
  static override debugTypeName = 'RenderBarChart'
  categories: string[]
  series: BarChartSeries[]
  annotations: ChartAnnotation[]
  valueAxis: ChartAxisOptions
  categoryAxis: ChartAxisOptions
  orientation: BarChartOrientation
  stackMode: ChartStackMode
  showGrid: boolean
  showLegend: boolean
  legendMode: ChartLegendMode
  dataState?: ChartDataState
  emptyMessage?: string
  loadingMessage?: string
  errorMessage?: string
  showTooltip: boolean
  tooltipMode: ChartTooltipMode
  maxBarThickness?: number
  onSeriesVisibilityChange?: (event: ChartSeriesVisibilityChangeEvent) => void
  onBarClick?: (bar: ChartBarLayout) => void

  private _plot: ChartPlotRect = { x: 0, y: 0, width: 0, height: 0 }
  private _annotationLayouts: ChartAnnotationLayout[] = []
  private _legendItems: ChartLegendItemLayout[] = []
  private _visibleSeries?: number[]
  private _hoverLegendIndex = -1
  private _bars: ChartBarLayout[] = []
  private _valueTicks: Array<{ value: number; label: string }> = []
  private _categoryLabels: BarChartCategoryLabelLayout[] = []
  private _hover: ChartBarLayout | null = null
  private _hoverCategoryIndex = -1
  private _valueDomain = { min: 0, max: 1 }

  constructor(options: RenderBarChartOptions) {
    super({ ...options, height: options.height ?? 220 })
    this.categories = [...options.categories]
    this.series = cloneBarSeries(options.series)
    this.annotations = cloneChartAnnotations(options.annotations)
    this.valueAxis = cloneChartAxisOptions(options.valueAxis)
    this.categoryAxis = cloneChartAxisOptions(options.categoryAxis)
    this.orientation = options.orientation ?? 'vertical'
    this.stackMode = options.stackMode ?? 'none'
    this.showGrid = options.showGrid ?? true
    this.showLegend = options.showLegend ?? true
    this.legendMode = options.legendMode ?? 'static'
    this._visibleSeries = visibleIndexesOverride(options.series.length, options.visibleSeries)
    this.dataState = options.dataState
    this.emptyMessage = options.emptyMessage
    this.loadingMessage = options.loadingMessage
    this.errorMessage = options.errorMessage
    this.showTooltip = options.showTooltip ?? true
    this.tooltipMode = options.tooltipMode ?? 'axis'
    this.maxBarThickness = options.maxBarThickness
    this.onSeriesVisibilityChange = options.onSeriesVisibilityChange
    this.onBarClick = options.onBarClick
  }

  setData(categories: string[], series: BarChartSeries[]): void {
    this.categories = [...categories]
    this.series = cloneBarSeries(series)
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

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? 360 : constraints.maxWidth
    this.size = constrainSize(constraints, { width, height: this.height ?? 220 })
    const top = this.showLegend ? 28 : 14
    this._plot = {
      x: this.orientation === 'vertical' ? 46 : 68,
      y: top,
      width: Math.max(20, this.size.width - (this.orientation === 'vertical' ? 60 : 84)),
      height: Math.max(20, this.size.height - top - 30),
    }
    this._computeLayout()
    this._legendItems = this._layoutLegendItems()
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    if (this.orientation === 'vertical') this._paintVerticalFrame(dl, context, offset)
    else this._paintHorizontalFrame(dl, context, offset)
    if (this.showLegend) this._paintLegend(dl, context, offset)
    const state = this._chartState()
    if (!isChartReady(state)) {
      paintChartState(dl, context, this._offsetPlot(offset), state)
      return
    }
    paintChartAnnotationRanges(dl, context, this._annotationLayouts, this.annotations, offset)
    const barRadius = this._isStacked() ? 0 : 3
    for (const bar of this._bars) {
      const color = chartColor(context.theme, bar.seriesIndex, this.series[bar.seriesIndex]?.color)
      const highlighted = this._isBarHighlighted(bar)
      dl.fillRect(offset.x + bar.x, offset.y + bar.y, bar.width, bar.height, highlighted ? withAlpha(color, 1) : withAlpha(color, 0.82), barRadius)
    }
    paintChartAnnotationForeground(dl, context, this._annotationLayouts, this.annotations, this._plot, offset)
    if (this.showTooltip) this._paintTooltip(dl, context, offset)
  }

  onPointerMove(event: PointerEvent): void {
    const legendHover = this._hitLegendItem(event.position)
    if (legendHover >= 0) {
      let changed = this._setHoverLegendIndex(legendHover)
      if (this._hover || this._hoverCategoryIndex >= 0) {
        this._clearDataHoverState()
        changed = true
      }
      if (changed) this.markNeedsPaint()
      return
    }
    const legendChanged = this._setHoverLegendIndex(-1)
    if (!isChartReady(this._chartState())) {
      if (this._hover || this._hoverCategoryIndex >= 0) {
        this._clearDataHoverState()
        this.markNeedsPaint()
      } else if (legendChanged) {
        this.markNeedsPaint()
      }
      return
    }

    const nextBar = this._hitBar(event.position)
    const nextCategory = this.tooltipMode === 'axis'
      ? this._hitCategoryIndex(event.position)
      : nextBar?.categoryIndex ?? -1
    if (sameBar(nextBar, this._hover) && nextCategory === this._hoverCategoryIndex) {
      if (legendChanged) this.markNeedsPaint()
      return
    }
    this._hover = nextBar
    this._hoverCategoryIndex = nextCategory
    this.markNeedsPaint()
  }

  onPointerLeave(_event: PointerEvent): void {
    if (!this._hover && this._hoverCategoryIndex < 0 && this._hoverLegendIndex < 0) return
    this._clearHoverState()
    this.markNeedsPaint()
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    const legendIndex = this._hitLegendItem(event.position)
    if (legendIndex >= 0) {
      this._toggleSeriesVisibility(legendIndex)
      return
    }
    if (!isChartReady(this._chartState())) return
    if (this._hover) this.onBarClick?.({ ...this._hover })
  }

  debugState(): BarChartDebugState {
    return {
      plot: { ...this._plot },
      hover: this._hover ? { ...this._hover } : null,
      hoverCategoryIndex: this._hoverCategoryIndex,
      tooltip: this._tooltipDebugState({ x: 0, y: 0 }),
      visibleSeries: this.getVisibleSeries(),
      hiddenSeries: hiddenIndexes(this.series.length, this.getVisibleSeries()),
      annotations: this._annotationLayouts.map(annotation => ({ ...annotation })),
      bars: this._bars.map(bar => ({ ...bar })),
      orientation: this.orientation,
      stackMode: this.stackMode,
      valueDomain: { ...this._valueDomain },
      valueTicks: this._valueTicks.map(tick => ({ ...tick })),
      categoryLabels: this._categoryLabels.map(label => ({ ...label })),
      state: this._chartState(),
    }
  }

  dispose(): void {
    this.onSeriesVisibilityChange = undefined
    this.onBarClick = undefined
    super.dispose()
  }

  private _computeLayout(): void {
    const visibleSeries = this.getVisibleSeries()
    const annotationValues = collectChartAnnotationValues(this.annotations, this._valueAnnotationAxes())
    const values = this._stackValuesForDomain(visibleSeries)
    this._valueDomain = normalizeLinearDomain([...values, ...annotationValues], {
      includeZero: true,
      paddingRatio: this.stackMode === 'percent' ? 0 : 0.04,
    })
    this._valueDomain = resolveChartAxisDomain(this._valueDomain, this.valueAxis)
    this._bars = this.orientation === 'vertical'
      ? this._computeVerticalBars()
      : this._computeHorizontalBars()
    this._annotationLayouts = this._layoutAnnotations()
    this._valueTicks = this._computeValueTicks()
    this._categoryLabels = this._computeCategoryLabels()
    if (this._hover) {
      this._hover = this._bars.find(bar => sameBar(bar, this._hover)) ?? null
    }
    if (this._hoverCategoryIndex >= this.categories.length) this._hoverCategoryIndex = -1
  }

  private _computeVerticalBars(): ChartBarLayout[] {
    const result: ChartBarLayout[] = []
    const count = Math.max(1, this.categories.length)
    const groupWidth = this._plot.width / count
    const visibleSeries = this.getVisibleSeries()
    const gap = Math.min(8, groupWidth * 0.18)
    const stacked = this._isStacked()
    const seriesCount = Math.max(1, visibleSeries.length)
    const barGap = stacked ? 0 : 3
    const rawBarWidth = stacked
      ? Math.max(2, groupWidth - gap * 2)
      : Math.max(2, (groupWidth - gap * 2 - barGap * (seriesCount - 1)) / seriesCount)
    const barWidth = this._resolveBarThickness(rawBarWidth)
    const totalBarWidth = stacked ? barWidth : barWidth * seriesCount + barGap * (seriesCount - 1)
    const groupStartX = this._plot.x + Math.max(0, (groupWidth - totalBarWidth) / 2)
    const yScale = createLinearScale(this._valueDomain.min, this._valueDomain.max, this._plot.y + this._plot.height, this._plot.y)
    const zeroY = yScale.map(clampToDomain(0, this._valueDomain))
    this.categories.forEach((category, categoryIndex) => {
      const totals = this._categoryTotals(categoryIndex, visibleSeries)
      let positiveBase = 0
      let negativeBase = 0
      visibleSeries.forEach((seriesIndex, visibleIndex) => {
        const series = this.series[seriesIndex]!
        const value = series.data[categoryIndex] ?? 0
        const delta = this._stackDelta(value, totals)
        const base = stacked
          ? value >= 0 ? positiveBase : negativeBase
          : 0
        const stackValue = stacked ? base + delta : value
        if (stacked) {
          if (value >= 0) positiveBase = stackValue
          else negativeBase = stackValue
        }
        const baseY = stacked ? yScale.map(clampToDomain(base, this._valueDomain)) : zeroY
        const valueY = yScale.map(clampToDomain(stackValue, this._valueDomain))
        const x = groupStartX + categoryIndex * groupWidth + (stacked ? 0 : visibleIndex * (barWidth + barGap))
        const height = Math.abs(baseY - valueY)
        result.push({
          seriesIndex,
          categoryIndex,
          x,
          y: Math.min(valueY, baseY),
          width: barWidth,
          height: stacked && value === 0 ? 0 : Math.max(2, height),
          value,
          stackBase: stacked ? base : undefined,
          stackValue: stacked ? stackValue : undefined,
          stackTotal: stacked ? totals.total : undefined,
          stackRatio: this.stackMode === 'percent' ? this._stackRatio(value, totals) : undefined,
          category,
          seriesName: series.name,
        })
      })
    })
    return result
  }

  private _computeHorizontalBars(): ChartBarLayout[] {
    const result: ChartBarLayout[] = []
    const count = Math.max(1, this.categories.length)
    const groupHeight = this._plot.height / count
    const visibleSeries = this.getVisibleSeries()
    const gap = Math.min(8, groupHeight * 0.18)
    const stacked = this._isStacked()
    const seriesCount = Math.max(1, visibleSeries.length)
    const barGap = stacked ? 0 : 3
    const rawBarHeight = stacked
      ? Math.max(2, groupHeight - gap * 2)
      : Math.max(2, (groupHeight - gap * 2 - barGap * (seriesCount - 1)) / seriesCount)
    const barHeight = this._resolveBarThickness(rawBarHeight)
    const totalBarHeight = stacked ? barHeight : barHeight * seriesCount + barGap * (seriesCount - 1)
    const groupStartY = this._plot.y + Math.max(0, (groupHeight - totalBarHeight) / 2)
    const xScale = createLinearScale(this._valueDomain.min, this._valueDomain.max, this._plot.x, this._plot.x + this._plot.width)
    const zeroX = xScale.map(clampToDomain(0, this._valueDomain))
    this.categories.forEach((category, categoryIndex) => {
      const totals = this._categoryTotals(categoryIndex, visibleSeries)
      let positiveBase = 0
      let negativeBase = 0
      visibleSeries.forEach((seriesIndex, visibleIndex) => {
        const series = this.series[seriesIndex]!
        const value = series.data[categoryIndex] ?? 0
        const delta = this._stackDelta(value, totals)
        const base = stacked
          ? value >= 0 ? positiveBase : negativeBase
          : 0
        const stackValue = stacked ? base + delta : value
        if (stacked) {
          if (value >= 0) positiveBase = stackValue
          else negativeBase = stackValue
        }
        const baseX = stacked ? xScale.map(clampToDomain(base, this._valueDomain)) : zeroX
        const valueX = xScale.map(clampToDomain(stackValue, this._valueDomain))
        const y = groupStartY + categoryIndex * groupHeight + (stacked ? 0 : visibleIndex * (barHeight + barGap))
        const width = Math.abs(valueX - baseX)
        result.push({
          seriesIndex,
          categoryIndex,
          x: Math.min(valueX, baseX),
          y,
          width: stacked && value === 0 ? 0 : Math.max(2, width),
          height: barHeight,
          value,
          stackBase: stacked ? base : undefined,
          stackValue: stacked ? stackValue : undefined,
          stackTotal: stacked ? totals.total : undefined,
          stackRatio: this.stackMode === 'percent' ? this._stackRatio(value, totals) : undefined,
          category,
          seriesName: series.name,
        })
      })
    })
    return result
  }

  private _resolveBarThickness(raw: number): number {
    if (this.maxBarThickness === undefined) return raw
    return Math.max(2, Math.min(raw, Math.max(2, this.maxBarThickness)))
  }

  private _paintVerticalFrame(dl: DrawList, context: PaintContext, offset: Offset): void {
    const plot = this._offsetPlot(offset)
    paintCartesianFrame({
      dl,
      theme: context.theme,
      plot,
      yTicks: this._valueTicks.map(tick => tick.value),
      yToPixel: value => plot.y + this._plot.height - ((value - this._valueDomain.min) / (this._valueDomain.max - this._valueDomain.min)) * this._plot.height,
      yTickLabel: (_value, index) => this._valueTicks[index]?.label ?? '',
      xLabels: this._categoryLabels.map(label => ({ label: label.label, x: offset.x + label.x })),
      showGrid: this.showGrid,
      showXLabels: chartAxisLabelsVisible(this.categoryAxis),
      showYLabels: chartAxisLabelsVisible(this.valueAxis),
    })
  }

  private _paintHorizontalFrame(dl: DrawList, context: PaintContext, offset: Offset): void {
    const plot = this._offsetPlot(offset)
    const xScale = createLinearScale(this._valueDomain.min, this._valueDomain.max, plot.x, plot.x + plot.width)
    const showValueLabels = chartAxisLabelsVisible(this.valueAxis)
    const showCategoryLabels = chartAxisLabelsVisible(this.categoryAxis)
    for (const tick of this._valueTicks) {
      const x = xScale.map(tick.value)
      if (this.showGrid) dl.line(x, plot.y, x, plot.y + plot.height, context.theme.borderData, 1)
      if (showValueLabels) {
        dl.fillText(tick.label, x, plot.y + plot.height + 16, context.theme.textSecondary, Math.max(10, context.theme.fontSize - 2), context.theme.fontFamily, 'center', 'middle')
      }
    }
    dl.line(plot.x, plot.y, plot.x, plot.y + plot.height, context.theme.borderSubtle, 1)
    dl.line(plot.x, plot.y + plot.height, plot.x + plot.width, plot.y + plot.height, context.theme.borderSubtle, 1)
    if (showCategoryLabels) {
      for (const label of this._categoryLabels) {
        dl.fillText(label.label, offset.x + label.x, offset.y + label.y, context.theme.textSecondary, Math.max(10, context.theme.fontSize - 2), context.theme.fontFamily, 'right', 'middle')
      }
    }
  }

  private _paintLegend(dl: DrawList, context: PaintContext, offset: Offset): void {
    const fontSize = Math.max(10, context.theme.fontSize - 2)
    const visibleSeries = this.getVisibleSeries()
    for (const item of this._legendItems) {
      const entry = this.series[item.index]!
      const visible = visibleSeries.includes(item.index)
      const color = chartColor(context.theme, item.index, entry.color)
      if (this.legendMode === 'toggle' && item.index === this._hoverLegendIndex) {
        dl.fillRect(offset.x + item.x, offset.y + item.y, item.width - 4, item.height, context.theme.stateHoverOverlay, 4)
      }
      dl.fillRect(offset.x + item.x, offset.y + item.y + item.height / 2 - 4, 8, 8, visible ? color : withAlpha(color, 0.28))
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

  private _paintTooltip(dl: DrawList, context: PaintContext, offset: Offset): void {
    const layout = this._tooltipDebugState(offset)
    if (layout) paintChartTooltip(dl, context, layout)
  }

  private _tooltipDebugState(offset: Offset): ChartTooltipDebugState | null {
    if (!this.showTooltip) return null
    if (this.tooltipMode === 'axis' && this._hoverCategoryIndex >= 0) {
      const bars = this._barsForCategory(this._hoverCategoryIndex)
      const anchor = this._categoryTooltipAnchor(bars)
      return layoutChartTooltip({
        title: this.categories[this._hoverCategoryIndex] ?? '',
        items: this._categoryTooltipItems(this._hoverCategoryIndex),
        anchorX: offset.x + anchor.x,
        anchorY: offset.y + anchor.y,
        boundsX: offset.x,
        boundsY: offset.y,
        boundsWidth: this.size.width,
        boundsHeight: this.size.height,
        minWidth: 122,
      })
    }

    if (!this._hover) return null
    return layoutChartTooltip({
      title: this._hover.category,
      items: this._barTooltipItems(this._hover),
      anchorX: offset.x + this._hover.x + this._hover.width / 2,
      anchorY: offset.y + this._hover.y,
      boundsX: offset.x,
      boundsY: offset.y,
      boundsWidth: this.size.width,
      boundsHeight: this.size.height,
      minWidth: 108,
    })
  }

  private _categoryTooltipItems(categoryIndex: number): ChartTooltipItem[] {
    const items: ChartTooltipItem[] = this._barsForCategory(categoryIndex).map(bar => ({
      label: bar.seriesName,
      value: this._formatStackedTooltipValue(bar),
      color: chartColor(this.currentTheme, bar.seriesIndex, this.series[bar.seriesIndex]?.color),
    }))
    if (this._isStacked()) items.push(this._stackTotalTooltipItem(categoryIndex))
    return items
  }

  private _barTooltipItems(bar: ChartBarLayout): ChartTooltipItem[] {
    const items: ChartTooltipItem[] = [{
      label: bar.seriesName,
      value: this._formatStackedTooltipValue(bar),
      color: chartColor(this.currentTheme, bar.seriesIndex, this.series[bar.seriesIndex]?.color),
    }]
    if (this._isStacked()) items.push(this._stackTotalTooltipItem(bar.categoryIndex))
    return items
  }

  private _formatStackedTooltipValue(bar: ChartBarLayout): string {
    const value = this._formatDataValueLabel(bar.value)
    if (this.stackMode !== 'percent') return value
    return `${value} · ${formatChartNumber(bar.stackRatio ?? 0)}%`
  }

  private _stackTotalTooltipItem(categoryIndex: number): ChartTooltipItem {
    const total = this._categoryTotals(categoryIndex).total
    return {
      label: '总计',
      value: this._formatDataValueLabel(total),
    }
  }

  private _categoryTooltipAnchor(bars: ChartBarLayout[]): Offset {
    if (bars.length === 0) {
      return {
        x: this._plot.x + this._plot.width / 2,
        y: this._plot.y + this._plot.height / 2,
      }
    }
    if (this.orientation === 'vertical') {
      const minY = Math.min(...bars.map(bar => bar.y))
      const first = bars[0]!
      const last = bars[bars.length - 1]!
      return {
        x: (first.x + last.x + last.width) / 2,
        y: minY,
      }
    }
    const maxX = Math.max(...bars.map(bar => bar.x + bar.width))
    const first = bars[0]!
    const last = bars[bars.length - 1]!
    return {
      x: maxX,
      y: (first.y + last.y + last.height) / 2,
    }
  }

  private _isBarHighlighted(bar: ChartBarLayout): boolean {
    if (this.tooltipMode === 'axis' && this._hoverCategoryIndex >= 0) {
      return bar.categoryIndex === this._hoverCategoryIndex
    }
    return sameBar(bar, this._hover)
  }

  private _offsetPlot(offset: Offset): ChartPlotRect {
    return {
      x: offset.x + this._plot.x,
      y: offset.y + this._plot.y,
      width: this._plot.width,
      height: this._plot.height,
    }
  }

  private _hitBar(position: Offset): ChartBarLayout | null {
    if (!this.hitTest(position)) return null
    const local = {
      x: position.x - this.globalOffset.x,
      y: position.y - this.globalOffset.y,
    }
    return this._bars.find(bar => (
      local.x >= bar.x &&
      local.x <= bar.x + bar.width &&
      local.y >= bar.y &&
      local.y <= bar.y + bar.height
    )) ?? null
  }

  private _hitCategoryIndex(position: Offset): number {
    if (!this.hitTest(position) || this.categories.length === 0) return -1
    const local = {
      x: position.x - this.globalOffset.x,
      y: position.y - this.globalOffset.y,
    }
    if (local.x < this._plot.x || local.x > this._plot.x + this._plot.width ||
      local.y < this._plot.y || local.y > this._plot.y + this._plot.height) {
      return -1
    }
    if (this.orientation === 'vertical') {
      const groupWidth = this._plot.width / Math.max(1, this.categories.length)
      return Math.max(0, Math.min(this.categories.length - 1, Math.floor((local.x - this._plot.x) / groupWidth)))
    }
    const groupHeight = this._plot.height / Math.max(1, this.categories.length)
    return Math.max(0, Math.min(this.categories.length - 1, Math.floor((local.y - this._plot.y) / groupHeight)))
  }

  private _barsForCategory(categoryIndex: number): ChartBarLayout[] {
    return this._bars
      .filter(bar => bar.categoryIndex === categoryIndex)
      .sort((a, b) => a.seriesIndex - b.seriesIndex)
  }

  private _chartState(): ChartStateDebugState {
    return resolveChartState(this, this._bars.length > 0)
  }

  private _isStacked(): boolean {
    return this.stackMode !== 'none'
  }

  private _stackValuesForDomain(visibleSeries: readonly number[]): number[] {
    if (!this._isStacked()) {
      return this.series
        .filter((_series, index) => visibleSeries.includes(index))
        .flatMap(series => series.data)
        .filter(Number.isFinite)
    }

    const values = [0]
    this.categories.forEach((_category, categoryIndex) => {
      if (this.stackMode === 'percent') {
        const totals = this._categoryTotals(categoryIndex, visibleSeries)
        if (totals.positive > 0) values.push(100)
        if (totals.negative > 0) values.push(-100)
        return
      }
      let positive = 0
      let negative = 0
      for (const seriesIndex of visibleSeries) {
        const value = this.series[seriesIndex]?.data[categoryIndex] ?? 0
        if (value >= 0) positive += value
        else negative += value
      }
      values.push(positive, negative)
    })
    return values
  }

  private _categoryTotals(categoryIndex: number, visibleSeries: readonly number[] = this.getVisibleSeries()): StackTotals {
    let positive = 0
    let negative = 0
    let total = 0
    for (const seriesIndex of visibleSeries) {
      const value = this.series[seriesIndex]?.data[categoryIndex] ?? 0
      total += value
      if (value >= 0) positive += value
      else negative += Math.abs(value)
    }
    return { positive, negative, total }
  }

  private _stackDelta(value: number, totals: StackTotals): number {
    if (this.stackMode !== 'percent') return value
    if (value >= 0) return totals.positive > 0 ? value / totals.positive * 100 : 0
    return totals.negative > 0 ? value / totals.negative * 100 : 0
  }

  private _stackRatio(value: number, totals: StackTotals): number {
    if (value >= 0) return totals.positive > 0 ? value / totals.positive * 100 : 0
    return totals.negative > 0 ? Math.abs(value) / totals.negative * 100 : 0
  }

  private _computeValueTicks(): Array<{ value: number; label: string }> {
    return niceTicks(this._valueDomain.min, this._valueDomain.max, chartAxisTickCount(this.valueAxis, 4))
      .map((tick, index) => ({
        value: tick,
        label: this._formatValueAxisLabel(tick, formatChartNumber(tick), index),
      }))
  }

  private _computeCategoryLabels(): BarChartCategoryLabelLayout[] {
    if (this.categories.length === 0) return []
    const categoryCount = Math.max(1, this.categories.length)
    const axisLength = this.orientation === 'vertical' ? this._plot.width : this._plot.height
    const step = axisLength / categoryCount
    const fallbackCount = Math.max(1, Math.floor(axisLength / (this.orientation === 'vertical' ? 48 : 24)))
    const maxCount = Math.min(this.categories.length, chartAxisTickCount(this.categoryAxis, fallbackCount))
    const indexes = categoryLabelIndexes(this.categories.length, maxCount)
    const maxLabelLength = this.categoryAxis.maxLabelLength ?? Math.max(3, Math.floor((this.orientation === 'vertical' ? step : this._plot.x - 12) / 7))
    return indexes.map(index => {
      const label = this.categories[index]!
      const formatted = truncateChartAxisLabel(this._formatCategoryAxisLabel(index, label), maxLabelLength)
      if (this.orientation === 'vertical') {
        return {
          index,
          label: formatted,
          x: this._plot.x + index * step + step / 2,
          y: this._plot.y + this._plot.height + 16,
        }
      }
      return {
        index,
        label: formatted,
        x: this._plot.x - 8,
        y: this._plot.y + index * step + step / 2,
      }
    })
  }

  private _formatValueAxisLabel(value: number, label: string, index?: number): string {
    const displayLabel = this.stackMode === 'percent' && !this.valueAxis.unit && !this.valueAxis.labelFormatter
      ? `${label}%`
      : label
    return this._formatAxisLabel(this.valueAxis, 'value', value, displayLabel, this._valueDomain, index)
  }

  private _formatDataValueLabel(value: number): string {
    if (this.stackMode === 'percent') return formatChartNumber(value)
    return this._formatAxisLabel(this.valueAxis, 'value', value, formatChartNumber(value), this._valueDomain)
  }

  private _formatCategoryAxisLabel(index: number, label: string): string {
    return this._formatAxisLabel(
      this.categoryAxis,
      'category',
      index,
      label,
      { min: 0, max: Math.max(0, this.categories.length - 1) },
      index,
    )
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
      axisType: axis === 'category' ? 'category' : 'linear',
      value,
      label,
      index,
      domain,
    })
  }

  private _layoutAnnotations(): ChartAnnotationLayout[] {
    const valueAxis = this._valueAnnotationAxis()
    return layoutChartAnnotations({
      annotations: this.annotations,
      plot: this._plot,
      xDomain: valueAxis === 'x' ? this._valueDomain : { min: 0, max: 1 },
      yDomain: valueAxis === 'y' ? this._valueDomain : { min: 0, max: 1 },
      includeEvents: false,
      resolveAxis: axis => this._resolveAnnotationAxis(axis),
      resolveXValue: value => this._resolveAnnotationValue(value),
      resolveYValue: value => this._resolveAnnotationValue(value),
    })
  }

  private _resolveAnnotationAxis(axis: ChartAnnotationAxis): 'x' | 'y' | null {
    if (axis === 'value') return this._valueAnnotationAxis()
    if (this.orientation === 'vertical') return axis === 'y' ? 'y' : null
    return axis === 'x' ? 'x' : null
  }

  private _valueAnnotationAxis(): 'x' | 'y' {
    return this.orientation === 'horizontal' ? 'x' : 'y'
  }

  private _valueAnnotationAxes(): ChartAnnotationAxis[] {
    return this.orientation === 'horizontal' ? ['x', 'value'] : ['y', 'value']
  }

  private _resolveAnnotationValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
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
    this._hoverCategoryIndex = -1
  }
}

function sameBar(a: ChartBarLayout | null, b: ChartBarLayout | null): boolean {
  return a?.seriesIndex === b?.seriesIndex && a?.categoryIndex === b?.categoryIndex
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
  return result.slice(0, maxCount)
}

function cloneBarSeries(series: readonly BarChartSeries[]): BarChartSeries[] {
  return series.map(entry => ({
    ...entry,
    data: entry.data.map(value => normalizeChartNumber(value)),
  }))
}

function clampToDomain(value: number, domain: ChartDomain): number {
  return Math.max(domain.min, Math.min(domain.max, value))
}
