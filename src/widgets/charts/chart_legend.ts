import type { Offset } from '../../core/render_object'
import type { DrawList } from '../../rendering/draw_list'
import type { PaintContext } from '../../rendering/paint_context'
import type { Color } from '../../theme/theme'
import { chartColor, withAlpha } from './chart_palette'
import { fitChartText, chartFontSize } from './chart_text_layout'
import type { ChartLegendItemLayout } from './chart_visibility'

export function paintChartLegend(
  dl: DrawList, context: PaintContext, offset: Offset,
  items: readonly ChartLegendItemLayout[], series: readonly { name: string; color?: Color }[],
  visible: readonly number[], hoverIndex: number,
): void {
  for (const item of items) {
    const entry = series[item.index]
    if (!entry) continue
    const shown = visible.includes(item.index)
    const color = chartColor(context.theme, item.index, entry.color)
    if (item.index === hoverIndex) {
      dl.fillRect(offset.x + item.x, offset.y + item.y, item.width - 4, item.height, context.theme.stateHoverOverlay, 4)
    }
    dl.fillRect(offset.x + item.x, offset.y + item.y + item.height / 2 - 4, 8, 8, shown ? color : withAlpha(color, 0.28))
    dl.fillText(fitChartText(entry.name, item.width - 24, context.theme), offset.x + item.x + 12,
      offset.y + item.y + item.height / 2, shown ? context.theme.textSecondary : context.theme.textDisabled,
      chartFontSize(context.theme), context.theme.fontFamily, 'left', 'middle')
  }
}
