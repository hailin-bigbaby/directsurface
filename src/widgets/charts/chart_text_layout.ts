import { TextMeasurer } from '../../core/text_measurer'
import { fitSingleLineText } from '../../rendering/text_painter'
import type { ResolvedTheme } from '../../theme/theme'
import type { ChartPlotRect } from './chart_types'
import type { ChartLegendItemLayout } from './chart_visibility'

export function chartFontSize(theme: ResolvedTheme): number {
  return Math.max(10, theme.fontSize - 2)
}

export function measureChartText(text: string, theme: ResolvedTheme, weight?: number): number {
  return TextMeasurer.measureWidth(text, chartFontSize(theme), theme.fontFamily, weight)
}

export function fitChartText(text: string, width: number, theme: ResolvedTheme, weight?: number): string {
  return fitSingleLineText(text, Math.max(0, width), chartFontSize(theme), theme.fontFamily, weight).text
}

// Both Cartesian charts share the same measured margins and bounded legend rows.
export function layoutCartesianChart(
  width: number,
  height: number,
  theme: ResolvedTheme,
  labels: readonly string[],
  legendNames: readonly string[],
  minimumLeft = 46,
): { plot: ChartPlotRect; legend: ChartLegendItemLayout[] } {
  const fontSize = chartFontSize(theme)
  const left = Math.min(Math.max(0, width * 0.4), labels.reduce((max, label) => Math.max(max, measureChartText(label, theme) + 12), minimumLeft))
  const right = Math.min(14, width * 0.1)
  const bottom = Math.min(height * 0.3, Math.max(30, fontSize * 1.4 + 8))
  const legend: ChartLegendItemLayout[] = []
  const rowHeight = Math.max(20, fontSize * 1.4 + 4)
  const availableWidth = Math.max(0, width - left - right)
  const maxRows = Math.floor(Math.max(0, height * 0.4 - 8) / rowHeight)
  let x = left
  let row = 0
  if (availableWidth >= 24) {
    for (let index = 0; index < legendNames.length; index += 1) {
      const itemWidth = Math.min(availableWidth, Math.max(62, measureChartText(legendNames[index]!, theme) + 24))
      if (x > left && x + itemWidth > width - right) { row += 1; x = left }
      if (row >= maxRows) break
      legend.push({ index, x, y: 2 + row * rowHeight, width: itemWidth, height: rowHeight })
      x += itemWidth
    }
  }
  const legendBottom = legend.length > 0 ? legend[legend.length - 1]!.y + rowHeight + 6 : 0
  const top = Math.min(Math.max(0, height - bottom), Math.max(legendBottom, 14, fontSize * 0.7 + 2))
  return {
    plot: { x: left, y: top, width: availableWidth, height: Math.max(0, height - top - bottom) },
    legend,
  }
}

export function fitHorizontalChartLabels<T extends { label: string; x: number }>(
  labels: readonly T[], width: number, theme: ResolvedTheme,
): T[] {
  return labels.map((item, index) => {
    const left = Math.max(4, index > 0 ? (labels[index - 1]!.x + item.x) / 2 : 4)
    const right = Math.min(width - 4, index + 1 < labels.length ? (item.x + labels[index + 1]!.x) / 2 : width - 4)
    const label = fitChartText(item.label, right - left - 4, theme)
    const half = measureChartText(label, theme) / 2
    return { ...item, label, x: Math.max(left + half, Math.min(right - half, item.x)) }
  })
}
