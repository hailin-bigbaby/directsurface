import { DrawList } from '../../rendering/draw_list'
import type { Color, ResolvedTheme } from '../../theme/theme'
import type { ChartPlotRect } from './chart_types'
import { formatChartNumber } from './chart_scale'

export interface CartesianFrameOptions {
  dl: DrawList
  theme: ResolvedTheme
  plot: ChartPlotRect
  yTicks: readonly number[]
  yToPixel(value: number): number
  yTickLabel?: (value: number, index: number) => string
  xLabels?: readonly { label: string; x: number }[]
  showGrid?: boolean
  showXLabels?: boolean
  showYLabels?: boolean
  axisColor?: Color
  gridColor?: Color
  textColor?: Color
}

export function paintCartesianFrame(options: CartesianFrameOptions): void {
  const {
    dl,
    theme,
    plot,
    yTicks,
    yToPixel,
    yTickLabel,
    xLabels = [],
    showGrid = true,
    showXLabels = true,
    showYLabels = true,
  } = options
  const axisColor = options.axisColor ?? theme.borderSubtle
  const gridColor = options.gridColor ?? theme.borderData
  const textColor = options.textColor ?? theme.textSecondary
  const fontSize = Math.max(10, theme.fontSize - 2)
  const fontFamily = theme.fontFamily

  dl.line(plot.x, plot.y, plot.x, plot.y + plot.height, axisColor, 1)
  dl.line(plot.x, plot.y + plot.height, plot.x + plot.width, plot.y + plot.height, axisColor, 1)

  for (let index = 0; index < yTicks.length; index += 1) {
    const tick = yTicks[index]!
    const y = yToPixel(tick)
    if (showGrid) dl.line(plot.x, y, plot.x + plot.width, y, gridColor, 1)
    if (showYLabels) {
      dl.fillText(yTickLabel ? yTickLabel(tick, index) : formatChartNumber(tick), plot.x - 8, y, textColor, fontSize, fontFamily, 'right', 'middle')
    }
  }

  if (showXLabels && xLabels.length > 0) {
    for (const item of xLabels) {
      dl.fillText(item.label, item.x, plot.y + plot.height + 16, textColor, fontSize, fontFamily, 'center', 'middle')
    }
  }
}
