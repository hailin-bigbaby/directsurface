import { layoutTextBlock } from '../../rendering/text_block_layout'
import type { GridColumnDef } from './grid_types'
import type { GridResolvedCellPresentation } from './grid_display_resolver'

export function gridColumnAutoHeight(column: GridColumnDef<any>, enabled: boolean): boolean {
  return column.type !== 'checkbox' && (column.autoRowHeight ?? enabled)
}

export function gridColumnWraps(column: GridColumnDef<any>, enabled: boolean): boolean {
  return column.wrapText === true || gridColumnAutoHeight(column, enabled)
}

/** The same line breaking and vertical padding are used for measuring and painting. */
export function layoutGridCellText(
  presentation: GridResolvedCellPresentation,
  width: number,
  height: number,
  paddingH: number,
  overflow: 'clip' | 'ellipsis',
  measureText: (text: string, fontSize: number, fontFamily: string) => number,
) {
  return layoutTextBlock({
    text: presentation.displayText,
    width: Math.max(0, width - paddingH * 2),
    height: Math.max(0, height - 8),
    fontSize: presentation.fontSize,
    lineHeightRatio: 1.4,
    wrap: true,
    overflow,
    align: presentation.align,
    verticalAlign: 'middle',
    measureText: (text, size) => measureText(text, size, presentation.fontFamily),
  })
}

/** Resolve the logical text box once for both painting and overflow tooltips.
 * Short wrapped labels follow the visible slice; long blocks scroll within the full span.
 */
export function layoutGridMergedCellText(
  presentation: GridResolvedCellPresentation,
  width: number,
  bounds: { top: number; bottom: number; viewportTop: number; viewportHeight: number },
  paddingH: number,
  overflow: 'clip' | 'ellipsis',
  measureText: (text: string, fontSize: number, fontFamily: string) => number,
) {
  const fullHeight = Math.max(0, bounds.bottom - bounds.top)
  const fullLayout = layoutGridCellText(presentation, width, fullHeight, paddingH, overflow, measureText)
  if (fullLayout.requiredHeight + 8 > bounds.viewportHeight) {
    return { y: bounds.top, height: fullHeight, layout: fullLayout }
  }
  const y = Math.max(bounds.top, bounds.viewportTop)
  const bottom = Math.min(bounds.bottom, bounds.viewportTop + bounds.viewportHeight)
  const height = Math.max(0, bottom - y)
  return {
    y,
    height,
    layout: height === fullHeight ? fullLayout : layoutGridCellText(presentation, width, height, paddingH, overflow, measureText),
  }
}
