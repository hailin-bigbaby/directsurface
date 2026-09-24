import { DrawList } from '../../rendering/draw_list'
import type { PaintContext } from '../../rendering/paint_context'
import type { ChartTooltipDebugState, ChartTooltipItem } from './chart_types'
import { withAlpha } from './chart_palette'

export interface ChartTooltipLayoutOptions {
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
const TEXT_WIDTH = 7

export function layoutChartTooltip(options: ChartTooltipLayoutOptions): ChartTooltipDebugState | null {
  if (options.items.length === 0) return null
  const availableHeight = Math.max(
    VERTICAL_PADDING * 2 + ROW_HEIGHT,
    options.boundsHeight - 8,
  )
  let title = options.title
  let titleHeight = title ? TITLE_HEIGHT : 0
  let maxRows = Math.floor((availableHeight - VERTICAL_PADDING * 2 - titleHeight) / ROW_HEIGHT)
  if (maxRows < 1 && title) {
    title = undefined
    titleHeight = 0
    maxRows = Math.floor((availableHeight - VERTICAL_PADDING * 2) / ROW_HEIGHT)
  }
  const itemLimit = Math.max(1, Math.min(options.maxItems ?? options.items.length, maxRows || 1))
  const items = fitItems(options.items, itemLimit)
  const contentWidth = Math.max(
    estimateTextWidth(title ?? ''),
    ...items.map(item => estimateTextWidth(item.label) + estimateTextWidth(item.value) + 34),
  )
  const maxWidth = Math.max(48, options.boundsWidth - 12)
  const width = Math.min(Math.max(options.minWidth ?? 96, contentWidth + HORIZONTAL_PADDING * 2), maxWidth)
  const height = VERTICAL_PADDING * 2 +
    titleHeight +
    items.length * ROW_HEIGHT
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

  const fontSize = Math.max(10, context.theme.fontSize - 2)
  let y = layout.y + VERTICAL_PADDING
  if (layout.title) {
    dl.fillText(
      fitText(layout.title, layout.width - HORIZONTAL_PADDING * 2),
      layout.x + HORIZONTAL_PADDING,
      y + TITLE_HEIGHT / 2,
      context.theme.textPrimary,
      fontSize,
      context.theme.fontFamily,
      'left',
      'middle',
      600,
    )
    y += TITLE_HEIGHT
  }

  for (const item of layout.items) {
    const centerY = y + ROW_HEIGHT / 2
    const colorX = layout.x + HORIZONTAL_PADDING
    let labelX = colorX
    if (item.color) {
      dl.fillRect(colorX, centerY - 4, 8, 8, item.color, 2)
      labelX += 14
    }
    const valueWidth = estimateTextWidth(item.value)
    const labelWidth = Math.max(0, layout.width - (labelX - layout.x) - valueWidth - HORIZONTAL_PADDING - 8)
    dl.fillText(
      fitText(item.label, labelWidth),
      labelX,
      centerY,
      context.theme.textSecondary,
      fontSize,
      context.theme.fontFamily,
      'left',
      'middle',
    )
    dl.fillText(
      fitText(item.value, Math.max(18, layout.width - HORIZONTAL_PADDING * 2)),
      layout.x + layout.width - HORIZONTAL_PADDING,
      centerY,
      context.theme.textPrimary,
      fontSize,
      context.theme.fontFamily,
      'right',
      'middle',
    )
    y += ROW_HEIGHT
  }
}

function estimateTextWidth(text: string): number {
  return text.length * TEXT_WIDTH
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

function fitText(text: string, maxWidth: number): string {
  if (estimateTextWidth(text) <= maxWidth) return text
  const maxChars = Math.max(1, Math.floor(maxWidth / TEXT_WIDTH))
  if (maxChars <= 3) return '.'.repeat(maxChars)
  return `${text.slice(0, maxChars - 3)}...`
}
