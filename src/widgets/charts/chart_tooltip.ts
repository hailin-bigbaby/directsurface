import type { ResolvedTheme } from '../../theme/theme'
import { chartFontSize, fitChartText, measureChartText } from './chart_text_layout'
import { DrawList } from '../../rendering/draw_list'
import type { PaintContext } from '../../rendering/paint_context'
import type { ChartTooltipDebugState, ChartTooltipItem } from './chart_types'
import { withAlpha } from './chart_palette'

export interface ChartTooltipLayoutOptions {
  theme: ResolvedTheme
  title?: string
  items: readonly ChartTooltipItem[]
  anchorX: number
  anchorY: number
  boundsX: number
  boundsY: number
  boundsWidth: number
  boundsHeight: number
  minWidth?: number
  maxItems?: number
}

const HORIZONTAL_PADDING = 8
const ROW_HEIGHT = 20
const TITLE_HEIGHT = 22
const VERTICAL_PADDING = 6
function rowHeight(theme: ResolvedTheme): number { return Math.max(ROW_HEIGHT, chartFontSize(theme) * 1.4 + 4) }
function titleHeight(theme: ResolvedTheme): number { return Math.max(TITLE_HEIGHT, chartFontSize(theme) * 1.4 + 4) }

export function layoutChartTooltip(options: ChartTooltipLayoutOptions): ChartTooltipDebugState | null {
  if (options.items.length === 0) return null
  const row = rowHeight(options.theme)
  const availableHeight = Math.max(0, options.boundsHeight - 8)
  if (availableHeight < VERTICAL_PADDING * 2 + row || options.boundsWidth < 36) return null
  let title = options.title
  let headingHeight = title ? titleHeight(options.theme) : 0
  let maxRows = Math.floor((availableHeight - VERTICAL_PADDING * 2 - headingHeight) / row)
  if (maxRows < 1 && title) {
    title = undefined
    headingHeight = 0
    maxRows = Math.floor((availableHeight - VERTICAL_PADDING * 2) / row)
  }
  const itemLimit = Math.max(1, Math.min(options.maxItems ?? options.items.length, maxRows || 1))
  const items = fitItems(options.items, itemLimit)
  const contentWidth = Math.max(
    measureChartText(title ?? '', options.theme, 600),
    ...items.map(item => measureChartText(item.label, options.theme) + measureChartText(item.value, options.theme) + 34),
  )
  const maxWidth = Math.max(0, options.boundsWidth - 12)
  const width = Math.min(Math.max(options.minWidth ?? 96, contentWidth + HORIZONTAL_PADDING * 2), maxWidth)
  const height = VERTICAL_PADDING * 2 +
    headingHeight +
    items.length * row
  const minX = options.boundsX + 6
  const maxX = Math.max(minX, options.boundsX + options.boundsWidth - width - 6)
  const x = Math.min(maxX, Math.max(minX, options.anchorX - width / 2))
  const aboveY = options.anchorY - height - 8
  const belowY = options.anchorY + 12
  const maxY = Math.max(options.boundsY + 4, options.boundsY + options.boundsHeight - height - 4)
  const y = aboveY >= options.boundsY + 4
    ? aboveY
    : Math.min(maxY, Math.max(options.boundsY + 4, belowY))

  return {
    title,
    items,
    x,
    y,
    width,
    height,
  }
}

export function paintChartTooltip(dl: DrawList, context: PaintContext, layout: ChartTooltipDebugState): void {
  dl.fillRect(layout.x, layout.y, layout.width, layout.height, withAlpha(context.theme.surfacePopup, 0.96), 5)
  dl.strokeRect(layout.x, layout.y, layout.width, layout.height, context.theme.borderSubtle, 1, 5)

  const fontSize = chartFontSize(context.theme)
  const row = rowHeight(context.theme)
  const headingHeight = titleHeight(context.theme)
  let y = layout.y + VERTICAL_PADDING
  if (layout.title) {
    dl.fillText(
      fitChartText(layout.title, layout.width - HORIZONTAL_PADDING * 2, context.theme, 600),
      layout.x + HORIZONTAL_PADDING,
      y + headingHeight / 2,
      context.theme.textPrimary,
      fontSize,
      context.theme.fontFamily,
      'left',
      'middle',
      600,
    )
    y += headingHeight
  }

  for (const item of layout.items) {
    const centerY = y + row / 2
    const colorX = layout.x + HORIZONTAL_PADDING
    let labelX = colorX
    if (item.color) {
      dl.fillRect(colorX, centerY - 4, 8, 8, item.color, 2)
      labelX += 14
    }
    const value = fitChartText(item.value, Math.max(0, layout.width - (labelX - layout.x) - HORIZONTAL_PADDING), context.theme)
    const valueWidth = measureChartText(value, context.theme)
    const labelWidth = Math.max(0, layout.width - (labelX - layout.x) - valueWidth - HORIZONTAL_PADDING - 8)
    dl.fillText(
      fitChartText(item.label, labelWidth, context.theme),
      labelX,
      centerY,
      context.theme.textSecondary,
      fontSize,
      context.theme.fontFamily,
      'left',
      'middle',
    )
    dl.fillText(
      value,
      layout.x + layout.width - HORIZONTAL_PADDING,
      centerY,
      context.theme.textPrimary,
      fontSize,
      context.theme.fontFamily,
      'right',
      'middle',
    )
    y += row
  }
}

function fitItems(items: readonly ChartTooltipItem[], maxItems: number): ChartTooltipItem[] {
  if (items.length <= maxItems) return items.map(item => ({ ...item }))
  if (maxItems <= 1) return [{ label: `+${items.length}`, value: '' }]
  const visibleCount = maxItems - 1
  return [
    ...items.slice(0, visibleCount).map(item => ({ ...item })),
    { label: `+${items.length - visibleCount}`, value: '' },
  ]
}
