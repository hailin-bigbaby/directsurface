import type { Offset } from '../../core/render_object'
import { DrawList } from '../../rendering/draw_list'
import type { PaintContext } from '../../rendering/paint_context'
import { CartesianChartBase } from './cartesian_chart_base'
import { chartColor } from './chart_palette'
import { createLinearScale, niceTicks, normalizeLinearDomain } from './chart_scale'
import { chartAxisTickCount, resolveChartAxisDomain, truncateChartAxisLabel } from './chart_axis_options'
import { layoutChartTooltip } from './chart_tooltip'
import type { CartesianChartOptions, CartesianChartDebugState, ChartTooltipDebugState, ScatterChartSeries, ScatterPointLayout } from './chart_types'

export interface RenderScatterChartOptions extends CartesianChartOptions {
  series: ScatterChartSeries[]
  pointRadius?: number
  hitRadius?: number
  onPointClick?: (point: ScatterPointLayout) => void
}

export interface ScatterChartDebugState extends CartesianChartDebugState {
  points: ScatterPointLayout[]
  hover: ScatterPointLayout | null
}

export class RenderScatterChart extends CartesianChartBase<ScatterChartSeries, ScatterPointLayout> {
  static override debugTypeName = 'RenderScatterChart'
  pointRadius: number
  hitRadius: number
  onPointClick?: (point: ScatterPointLayout) => void
  private points: ScatterPointLayout[] = []

  constructor(options: RenderScatterChartOptions) {
    super(options, cloneSeries(options.series))
    this.pointRadius = options.pointRadius ?? 4
    this.hitRadius = options.hitRadius ?? 8
    this.onPointClick = options.onPointClick
  }

  setSeries(series: ScatterChartSeries[]): void { this.replaceSeries(cloneSeries(series)) }

  protected updateGeometry(): void {
    // Keep source indexes and duplicate x/y observations. No sorting or line decimation.
    const datums = this.getVisibleSeries().flatMap(seriesIndex => this.series[seriesIndex]!.data.flatMap((point, pointIndex) =>
      Number.isFinite(point.x) && Number.isFinite(point.y) ? [{ ...point, seriesIndex, pointIndex }] : []))
    this.xDomain = resolveChartAxisDomain(normalizeLinearDomain(datums.map(point => point.x), { paddingRatio: 0.04 }), this.xAxis)
    this.layoutFrame(datums.map(point => point.y), false)
    const xScale = createLinearScale(this.xDomain.min, this.xDomain.max, this.plot.x, this.plot.x + this.plot.width)
    const yScale = createLinearScale(this.yDomain.min, this.yDomain.max, this.plot.y + this.plot.height, this.plot.y)
    this.points = datums.filter(point => point.x >= this.xDomain.min && point.x <= this.xDomain.max && point.y >= this.yDomain.min && point.y <= this.yDomain.max)
      .map(point => ({ id: point.id, seriesIndex: point.seriesIndex, pointIndex: point.pointIndex,
        x: xScale.map(point.x), y: yScale.map(point.y), xValue: point.x, yValue: point.y, value: point.y,
        label: point.label ?? this.series[point.seriesIndex]!.name, seriesName: this.series[point.seriesIndex]!.name }))
    this.fitXLabels(niceTicks(this.xDomain.min, this.xDomain.max, chartAxisTickCount(this.xAxis, Math.max(2, Math.floor(this.plot.width / 80))))
      .map((value, index) => ({ x: xScale.map(value), label: truncateChartAxisLabel(this.formatValue('x', value, index), this.xAxis.maxLabelLength) })))
  }

  protected hasData(): boolean { return this.points.length > 0 }
  private radius(): number { return Number.isFinite(this.pointRadius) ? Math.max(1, Math.min(32, this.pointRadius)) : 4 }

  protected paintData(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    for (const point of this.points) {
      const color = chartColor(context.theme, point.seriesIndex, this.series[point.seriesIndex]?.color)
      dl.fillCircle(offset.x + point.x, offset.y + point.y, this.radius(), color)
    }
    if (this.hover) dl.strokeCircle(offset.x + this.hover.x, offset.y + this.hover.y, this.radius() + 2, context.theme.textPrimary, 1)
  }

  protected pick(local: Offset): ScatterPointLayout | null {
    if (!this.inPlot(local)) return null
    let distance = Math.max(this.radius(), Number.isFinite(this.hitRadius) ? Math.max(0, Math.min(64, this.hitRadius)) : 8)
    let nearest: ScatterPointLayout | null = null
    for (const point of this.points) {
      const next = Math.hypot(point.x - local.x, point.y - local.y)
      // Equal distances choose the later painted point, including identical coordinates.
      if (next <= distance) { nearest = point; distance = next }
    }
    return nearest
  }
  protected sameHit(a: ScatterPointLayout | null, b: ScatterPointLayout | null): boolean { return a?.seriesIndex === b?.seriesIndex && a?.pointIndex === b?.pointIndex }
  protected activate(local: Offset): void { const point = this.pick(local); if (point) this.onPointClick?.({ ...point }) }

  protected tooltipLayout(offset: Offset): ChartTooltipDebugState | null {
    const point = this.hover
    if (!point) return null
    return layoutChartTooltip({ theme: this.currentTheme, title: point.label,
      items: [{ label: 'X', value: this.formatValue('x', point.xValue) }, { label: 'Y', value: this.formatValue('y', point.yValue), color: chartColor(this.currentTheme, point.seriesIndex, this.series[point.seriesIndex]?.color) }],
      anchorX: offset.x + point.x, anchorY: offset.y + point.y, boundsX: offset.x, boundsY: offset.y, boundsWidth: this.size.width, boundsHeight: this.size.height })
  }

  debugState(): ScatterChartDebugState { return { ...this.debugCommon(), points: this.points.map(point => ({ ...point })), hover: this.hover ? { ...this.hover } : null } }
  override dispose(): void { this.onPointClick = undefined; super.dispose() }
}

function cloneSeries(series: readonly ScatterChartSeries[]): ScatterChartSeries[] {
  return series.map(entry => ({ ...entry, color: entry.color ? { ...entry.color } : undefined, data: entry.data.map(point => ({ ...point })) }))
}
