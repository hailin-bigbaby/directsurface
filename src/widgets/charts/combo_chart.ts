import type { Offset } from '../../core/render_object'
import { DrawList } from '../../rendering/draw_list'
import type { PaintContext } from '../../rendering/paint_context'
import { colorToCSS } from '../../theme/theme'
import { CartesianChartBase } from './cartesian_chart_base'
import { chartColor, withAlpha } from './chart_palette'
import { createLinearScale } from './chart_scale'
import { chartAxisTickCount, formatChartAxisLabel, truncateChartAxisLabel } from './chart_axis_options'
import { layoutChartTooltip } from './chart_tooltip'
import type { CartesianChartOptions, CartesianChartDebugState, ChartBarLayout, ChartTooltipDebugState, ChartTooltipMode, ComboChartItem, ComboChartSeries } from './chart_types'

export interface RenderComboChartOptions extends CartesianChartOptions {
  categories: string[]
  series: ComboChartSeries[]
  tooltipMode?: ChartTooltipMode
  maxBarThickness?: number
  onItemClick?: (item: ComboChartItem) => void
}

export interface ComboChartDebugState extends CartesianChartDebugState {
  bars: ChartBarLayout[]
  points: ComboChartItem[]
  hoverCategoryIndex: number
}

interface ComboHover { categoryIndex: number; seriesIndex: number | null }

export class RenderComboChart extends CartesianChartBase<ComboChartSeries, ComboHover> {
  static override debugTypeName = 'RenderComboChart'
  categories: string[]
  tooltipMode: ChartTooltipMode
  maxBarThickness?: number
  onItemClick?: (item: ComboChartItem) => void
  private bars: ChartBarLayout[] = []
  private points: ComboChartItem[] = []
  private items: ComboChartItem[] = []

  constructor(options: RenderComboChartOptions) {
    super(options, cloneSeries(options.series))
    this.categories = [...options.categories]
    this.tooltipMode = options.tooltipMode ?? 'axis'
    this.maxBarThickness = options.maxBarThickness
    this.onItemClick = options.onItemClick
  }

  setData(categories: string[], series: ComboChartSeries[]): void {
    this.categories = [...categories]
    this.replaceSeries(cloneSeries(series))
  }

  protected updateGeometry(): void {
    const visible = this.getVisibleSeries()
    const barSeries = visible.filter(index => this.series[index]!.type === 'bar')
    const values = visible.flatMap(index => this.series[index]!.data.slice(0, this.categories.length).filter((value): value is number => value !== null && Number.isFinite(value)))
    this.xDomain = { min: -0.5, max: Math.max(0.5, this.categories.length - 0.5) }
    this.layoutFrame(values, barSeries.length > 0)
    const xScale = createLinearScale(this.xDomain.min, this.xDomain.max, this.plot.x, this.plot.x + this.plot.width)
    const yScale = createLinearScale(this.yDomain.min, this.yDomain.max, this.plot.y + this.plot.height, this.plot.y)
    const laneWidth = this.plot.width / Math.max(1, this.categories.length)
    const slotWidth = laneWidth * 0.72 / Math.max(1, barSeries.length)
    const requested = this.maxBarThickness
    const thickness = Math.min(slotWidth * 0.9, Number.isFinite(requested) && requested! > 0 ? requested! : Infinity)
    const clampY = (value: number) => Math.max(this.yDomain.min, Math.min(this.yDomain.max, value))
    const zeroY = yScale.map(clampY(0))
    this.bars = []
    this.points = []
    this.items = []
    for (const seriesIndex of visible) {
      const series = this.series[seriesIndex]!
      let gap = true
      for (let categoryIndex = 0; categoryIndex < this.categories.length; categoryIndex += 1) {
        const value = series.data[categoryIndex]
        if (value === null || value === undefined || !Number.isFinite(value)) { gap = true; continue }
        const x = xScale.map(categoryIndex)
        const y = yScale.map(value)
        const item: ComboChartItem = { kind: series.type, categoryIndex, seriesIndex, pointIndex: categoryIndex,
          x, y, value, label: this.categoryLabel(categoryIndex), seriesName: series.name, breakBefore: gap }
        gap = false
        this.items.push(item)
        if (series.type === 'line') this.points.push(item)
        else {
          const barY = yScale.map(clampY(value))
          const index = barSeries.indexOf(seriesIndex)
          this.bars.push({ seriesIndex, categoryIndex, category: this.categories[categoryIndex]!, seriesName: series.name, value,
            x: x - laneWidth * 0.36 + slotWidth * (index + 0.5) - thickness / 2,
            y: Math.min(zeroY, barY), width: thickness, height: Math.abs(zeroY - barY) })
        }
      }
    }
    const count = Math.min(this.categories.length, chartAxisTickCount(this.xAxis, Math.max(1, Math.floor(this.plot.width / 70))))
    const indexes = count <= 1 ? (count ? [0] : []) : Array.from({ length: count }, (_, i) => Math.round(i * (this.categories.length - 1) / (count - 1)))
    this.fitXLabels(indexes.map(index => ({ x: xScale.map(index), label: truncateChartAxisLabel(this.categoryLabel(index), this.xAxis.maxLabelLength) })))
  }

  private categoryLabel(index: number): string {
    return formatChartAxisLabel(this.xAxis, index, { axis: 'x', axisType: 'category', value: index,
      label: this.categories[index] ?? '', index, domain: { min: 0, max: Math.max(0, this.categories.length - 1) } })
  }

  protected hasData(): boolean { return this.items.length > 0 }

  protected paintData(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    for (const bar of this.bars) {
      if (bar.width <= 0 || bar.height <= 0) continue
      const color = chartColor(context.theme, bar.seriesIndex, this.series[bar.seriesIndex]?.color)
      dl.fillRect(offset.x + bar.x, offset.y + bar.y, bar.width, bar.height,
        withAlpha(color, this.highlighted(bar.seriesIndex, bar.categoryIndex) ? 1 : 0.82), 2)
    }
    const ctx = context.ctx
    for (const seriesIndex of this.getVisibleSeries()) {
      if (this.series[seriesIndex]!.type !== 'line') continue
      const points = this.points.filter(point => point.seriesIndex === seriesIndex)
      const color = chartColor(context.theme, seriesIndex, this.series[seriesIndex]?.color)
      ctx.beginPath()
      for (const point of points) {
        if (point.breakBefore) ctx.moveTo(offset.x + point.x, offset.y + point.y)
        else ctx.lineTo(offset.x + point.x, offset.y + point.y)
      }
      ctx.strokeStyle = colorToCSS(color)
      ctx.lineWidth = 2
      ctx.stroke()
      for (const point of points) dl.fillCircle(offset.x + point.x, offset.y + point.y,
        this.highlighted(seriesIndex, point.categoryIndex) ? 5 : 3, color)
    }
  }

  private highlighted(seriesIndex: number, categoryIndex: number): boolean {
    return this.hover?.categoryIndex === categoryIndex && (this.tooltipMode === 'axis' || this.hover.seriesIndex === seriesIndex)
  }

  private hitItem(local: Offset): ComboChartItem | null {
    if (!this.inPlot(local)) return null
    // Lines paint above bars; select the nearest visible marker before testing bars.
    let point: ComboChartItem | null = null
    let distance = 8
    for (const candidate of this.points) {
      if (!this.inPlot(candidate)) continue
      const next = Math.hypot(candidate.x - local.x, candidate.y - local.y)
      if (next <= distance) { distance = next; point = candidate }
    }
    if (point) return point
    const bar = this.bars.find(bar => bar.width > 0 && bar.height > 0 && local.x >= bar.x && local.x <= bar.x + bar.width && local.y >= bar.y && local.y <= bar.y + bar.height)
    return bar ? this.items.find(item => item.seriesIndex === bar.seriesIndex && item.categoryIndex === bar.categoryIndex) ?? null : null
  }

  protected pick(local: Offset): ComboHover | null {
    if (!this.inPlot(local) || !this.categories.length) return null
    const item = this.hitItem(local)
    if (this.tooltipMode === 'item') return item ? { categoryIndex: item.categoryIndex, seriesIndex: item.seriesIndex } : null
    const categoryIndex = Math.min(this.categories.length - 1, Math.floor((local.x - this.plot.x) / this.plot.width * this.categories.length))
    return this.items.some(item => item.categoryIndex === categoryIndex) ? { categoryIndex, seriesIndex: item?.seriesIndex ?? null } : null
  }
  protected sameHit(a: ComboHover | null, b: ComboHover | null): boolean { return a?.categoryIndex === b?.categoryIndex && a?.seriesIndex === b?.seriesIndex }
  protected activate(local: Offset): void { const item = this.hitItem(local); if (item) this.onItemClick?.({ ...item }) }

  protected tooltipLayout(offset: Offset): ChartTooltipDebugState | null {
    if (!this.hover) return null
    const items = this.items.filter(item => item.categoryIndex === this.hover!.categoryIndex && (this.tooltipMode === 'axis' || item.seriesIndex === this.hover!.seriesIndex))
    if (!items.length) return null
    return layoutChartTooltip({ theme: this.currentTheme, title: this.categoryLabel(this.hover.categoryIndex),
      items: items.map(item => ({ label: item.seriesName, value: this.formatValue('y', item.value), color: chartColor(this.currentTheme, item.seriesIndex, this.series[item.seriesIndex]?.color) })),
      anchorX: offset.x + items[0]!.x, anchorY: offset.y + Math.max(this.plot.y, Math.min(this.plot.y + this.plot.height, items[0]!.y)),
      boundsX: offset.x, boundsY: offset.y, boundsWidth: this.size.width, boundsHeight: this.size.height })
  }

  debugState(): ComboChartDebugState {
    return { ...this.debugCommon(), bars: this.bars.map(bar => ({ ...bar })), points: this.points.map(point => ({ ...point })), hoverCategoryIndex: this.hover?.categoryIndex ?? -1 }
  }
  override dispose(): void { this.onItemClick = undefined; super.dispose() }
}

function cloneSeries(series: readonly ComboChartSeries[]): ComboChartSeries[] {
  return series.map(entry => ({ ...entry, color: entry.color ? { ...entry.color } : undefined,
    data: entry.data.map(value => value !== null && Number.isFinite(value) ? value : null) }))
}
