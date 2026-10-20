import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../../core/render_object'
import { RenderBox } from '../../layout/render_box'
import type { InteractiveRenderObject, PointerEvent } from '../../gestures/recognizers'
import { isPrimaryPointerButton } from '../../gestures/hit_test'
import { DrawList } from '../../rendering/draw_list'
import type { PaintContext } from '../../rendering/paint_context'
import type { Color } from '../../theme/theme'
import { createLinearScale, formatChartNumber, niceTicks, normalizeLinearDomain } from './chart_scale'
import { chartAxisLabelsVisible, chartAxisTickCount, cloneChartAxisOptions, formatChartAxisLabel, resolveChartAxisDomain } from './chart_axis_options'
import { paintCartesianFrame } from './chart_axis'
import { layoutCartesianChart, fitHorizontalChartLabels } from './chart_text_layout'
import { paintChartLegend } from './chart_legend'
import { isChartReady, resolveChartState, paintChartState } from './chart_state'
import { paintChartTooltip } from './chart_tooltip'
import { firstChangedVisibleIndex, hiddenIndexes, hitLegendItem, normalizeVisibleIndexes, remapVisibleIndexes, sameVisibleIndexes, toggleVisibleIndex, visibleIndexesOverride, type ChartLegendItemLayout } from './chart_visibility'
import type { CartesianChartOptions, CartesianChartDebugState, ChartAxisOptions, ChartDomain, ChartPlotRect, ChartSeriesVisibilityChangeEvent, ChartSeriesVisibilityChangeReason, ChartTooltipDebugState } from './chart_types'

interface NamedSeries { id?: string; name: string; color?: Color }

/** Internal lifecycle shared by the categorical combination and numeric scatter charts. */
export abstract class CartesianChartBase<S extends NamedSeries, H> extends RenderBox implements InteractiveRenderObject {
  series: S[]
  xAxis: ChartAxisOptions
  yAxis: ChartAxisOptions
  showGrid: boolean
  showLegend: boolean
  legendMode: 'static' | 'toggle'
  showTooltip: boolean
  dataState?: CartesianChartOptions['dataState']
  emptyMessage?: string
  loadingMessage?: string
  errorMessage?: string
  onSeriesVisibilityChange?: (event: ChartSeriesVisibilityChangeEvent) => void

  protected plot: ChartPlotRect = { x: 0, y: 0, width: 0, height: 0 }
  protected xDomain: ChartDomain = { min: 0, max: 1 }
  protected yDomain: ChartDomain = { min: 0, max: 1 }
  protected xLabels: Array<{ x: number; label: string }> = []
  protected yTicks: Array<{ value: number; label: string }> = []
  protected hover: H | null = null
  protected legendItems: ChartLegendItemLayout[] = []
  private visibleSeries?: number[]
  private hoverLegend = -1

  protected constructor(options: CartesianChartOptions, series: S[]) {
    super({ ...options, height: options.height ?? 220 })
    this.series = series
    this.xAxis = cloneChartAxisOptions(options.xAxis)
    this.yAxis = cloneChartAxisOptions(options.yAxis)
    this.showGrid = options.showGrid ?? true
    this.showLegend = options.showLegend ?? true
    this.legendMode = options.legendMode ?? 'static'
    this.showTooltip = options.showTooltip ?? true
    this.dataState = options.dataState
    this.emptyMessage = options.emptyMessage
    this.loadingMessage = options.loadingMessage
    this.errorMessage = options.errorMessage
    this.visibleSeries = visibleIndexesOverride(series.length, options.visibleSeries)
    this.onSeriesVisibilityChange = options.onSeriesVisibilityChange
  }

  protected replaceSeries(series: S[]): void {
    this.visibleSeries = remapVisibleIndexes(this.series, series, this.getVisibleSeries(), entry => entry.id ? `id:${entry.id}` : `name:${entry.name}`)
    this.series = series
    this.hover = null
    this.hoverLegend = -1
    this.markNeedsLayout()
  }

  getVisibleSeries(): number[] { return normalizeVisibleIndexes(this.series.length, this.visibleSeries) }
  isSeriesVisible(index: number): boolean { return this.getVisibleSeries().includes(index) }

  setVisibleSeries(indexes?: number[], reason: ChartSeriesVisibilityChangeReason = 'api'): void {
    const previous = this.getVisibleSeries()
    this.visibleSeries = visibleIndexesOverride(this.series.length, indexes)
    const next = this.getVisibleSeries()
    if (sameVisibleIndexes(previous, next)) return
    this.hover = null
    this.markNeedsLayout()
    const index = firstChangedVisibleIndex(this.series.length, previous, next)
    this.onSeriesVisibilityChange?.({ seriesIndex: index, seriesName: this.series[index]?.name ?? '',
      visible: next.includes(index), visibleSeries: next, hiddenSeries: hiddenIndexes(this.series.length, next), reason })
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    this.size = constrainSize(constraints, { width: constraints.maxWidth === Infinity ? 360 : constraints.maxWidth, height: this.height ?? 220 })
    if (context.pass === 'measure') return
    this.hover = null
    this.updateGeometry()
  }

  protected layoutFrame(yValues: number[], includeZero: boolean): void {
    this.yDomain = resolveChartAxisDomain(normalizeLinearDomain(yValues, { includeZero, paddingRatio: 0.04 }), this.yAxis)
    this.yTicks = niceTicks(this.yDomain.min, this.yDomain.max, chartAxisTickCount(this.yAxis, 4))
      .map((value, index) => ({ value, label: this.formatValue('y', value, index) }))
    const frame = layoutCartesianChart(this.size.width, this.size.height, this.currentTheme,
      chartAxisLabelsVisible(this.yAxis) ? this.yTicks.map(tick => tick.label) : [],
      this.showLegend ? this.series.map(entry => entry.name) : [])
    this.plot = frame.plot
    this.legendItems = frame.legend
  }

  protected fitXLabels(labels: Array<{ x: number; label: string }>): void {
    this.xLabels = fitHorizontalChartLabels(labels, this.size.width, this.currentTheme)
  }

  protected formatValue(axis: 'x' | 'y', value: number, index?: number): string {
    return formatChartAxisLabel(axis === 'x' ? this.xAxis : this.yAxis, value, {
      axis, axisType: 'linear', value, label: formatChartNumber(value), index,
      domain: axis === 'x' ? this.xDomain : this.yDomain,
    })
  }

  protected state() { return resolveChartState(this, this.hasData()) }
  protected canInteract(): boolean { return this.size.width >= 36 && this.size.height >= 40 && isChartReady(this.state()) }
  protected local(position: Offset): Offset { return { x: position.x - this.globalOffset.x, y: position.y - this.globalOffset.y } }
  protected inPlot(point: Offset): boolean {
    return this.plot.width > 0 && this.plot.height > 0 && point.x >= this.plot.x && point.x <= this.plot.x + this.plot.width && point.y >= this.plot.y && point.y <= this.plot.y + this.plot.height
  }

  performPaint(context: PaintContext, offset: Offset): void {
    if (this.size.width < 36 || this.size.height < 40) return
    const dl = new DrawList(context)
    const plot = { ...this.plot, x: offset.x + this.plot.x, y: offset.y + this.plot.y }
    const yScale = createLinearScale(this.yDomain.min, this.yDomain.max, plot.y + plot.height, plot.y)
    paintCartesianFrame({ dl, theme: context.theme, plot, labelLeft: offset.x + 4,
      yTicks: this.yTicks.map(tick => tick.value), yToPixel: value => yScale.map(value),
      yTickLabel: (_value, index) => this.yTicks[index]?.label ?? '',
      xLabels: this.xLabels.map(label => ({ ...label, x: label.x + offset.x })), showGrid: this.showGrid,
      showXLabels: chartAxisLabelsVisible(this.xAxis), showYLabels: chartAxisLabelsVisible(this.yAxis) })
    if (this.showLegend) paintChartLegend(dl, context, offset, this.legendItems, this.series, this.getVisibleSeries(), this.legendMode === 'toggle' ? this.hoverLegend : -1)
    const state = this.state()
    if (!isChartReady(state)) { paintChartState(dl, context, plot, state); return }
    context.ctx.save()
    try {
      context.ctx.beginPath()
      context.ctx.rect(plot.x, plot.y, plot.width, plot.height)
      context.ctx.clip()
      this.paintData(context, offset)
    } finally { context.ctx.restore() }
    if (this.showTooltip && this.hover !== null) {
      const tooltip = this.tooltipLayout(offset)
      if (tooltip) paintChartTooltip(dl, context, tooltip)
    }
  }

  onPointerMove(event: PointerEvent): void {
    const legend = this.size.width >= 36 && this.size.height >= 40 && this.showLegend && this.legendMode === 'toggle'
      ? hitLegendItem(this.legendItems, event.position, this.globalOffset) : -1
    const next = legend < 0 && this.canInteract() ? this.pick(this.local(event.position)) : null
    if (legend === this.hoverLegend && this.sameHit(next, this.hover)) return
    this.hoverLegend = legend
    this.hover = next
    this.markNeedsPaint()
  }

  onPointerLeave(_event: PointerEvent): void {
    if (this.hover === null && this.hoverLegend < 0) return
    this.hover = null
    this.hoverLegend = -1
    this.markNeedsPaint()
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event) || this.size.width < 36 || this.size.height < 40 || !this.hitTest(event.position)) return
    const index = this.showLegend && this.legendMode === 'toggle' ? hitLegendItem(this.legendItems, event.position, this.globalOffset) : -1
    if (index >= 0) { this.setVisibleSeries(toggleVisibleIndex(this.series.length, this.getVisibleSeries(), index), 'legendToggle'); return }
    if (this.canInteract()) this.activate(this.local(event.position))
  }

  protected debugCommon(): CartesianChartDebugState {
    return { plot: { ...this.plot }, xDomain: { ...this.xDomain }, yDomain: { ...this.yDomain },
      xLabels: this.xLabels.map(label => ({ ...label })), yTicks: this.yTicks.map(tick => ({ ...tick })),
      legend: this.legendItems.map(item => ({ ...item })), visibleSeries: this.getVisibleSeries(),
      hiddenSeries: hiddenIndexes(this.series.length, this.getVisibleSeries()), state: this.state(),
      tooltip: this.showTooltip && this.canInteract() && this.hover !== null ? this.tooltipLayout({ x: 0, y: 0 }) : null }
  }

  override dispose(): void {
    this.hover = null
    this.onSeriesVisibilityChange = undefined
    super.dispose()
  }

  protected abstract updateGeometry(): void
  protected abstract hasData(): boolean
  protected abstract paintData(context: PaintContext, offset: Offset): void
  protected abstract pick(local: Offset): H | null
  protected abstract sameHit(a: H | null, b: H | null): boolean
  protected abstract activate(local: Offset): void
  protected abstract tooltipLayout(offset: Offset): ChartTooltipDebugState | null
}
