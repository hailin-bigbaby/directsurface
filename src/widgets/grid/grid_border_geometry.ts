import type { DrawLineSegment } from '../../rendering/draw_list'
import type { GridColumnDef, GridVisibleItem } from './grid_types'
import type { GridViewport } from './grid_viewport'
import type { GridRowMergeModel } from './grid_row_merge_model'

// Arithmetic paths may differ by a few ulps for fractional widths and offsets.
// This tolerance only identifies coincident logical edges, before pixel snapping.
const borderEpsilon = 1e-7

/** Real column edges only; frozen separators own the boundaries between regions. */
export function gridColumnBorderEdges<T extends Record<string, any>>(
  viewport: GridViewport<T>, columns: GridColumnDef<T>[], x: number,
): number[] {
  const frozen = viewport.scrollableContentWidth(columns) > 0 && viewport.scrollableViewWidth(columns) > 0
  const left = viewport.fixedRegionWidth(columns)
  const right = viewport.rightFixedRegionWidth(columns)
  const edges = new Set<number>()
  columns.forEach((_column, index) => {
    const edge = viewport.cellX(columns, x, index) + viewport.colWidths[index]!
    const visible = viewport.visibleCellRect(columns, x, index)
    if (visible.w <= 0 || edge <= x + borderEpsilon || edge > visible.x + visible.w + borderEpsilon || edge > x + viewport.viewWidth + borderEpsilon) return
    if (frozen && ((left > 0 && Math.abs(edge - (x + left)) < borderEpsilon) ||
      (right > 0 && Math.abs(edge - (x + viewport.viewWidth - right)) < borderEpsilon))) return
    edges.add(Math.min(edge, visible.x + visible.w, x + viewport.viewWidth))
  })
  return [...edges].sort((a, b) => a - b)
}

/** Visible row geometry, including holes inside vertical merge runs. */
export function gridBodyBorderSegments<T extends Record<string, any>>(options: {
  viewport: GridViewport<T>
  columns: GridColumnDef<T>[]
  items: ReadonlyArray<Pick<GridVisibleItem<T>, 'kind'>>
  merges?: GridRowMergeModel<T>
  x: number
  bodyY: number
  footer: boolean
}): { vertical: DrawLineSegment[]; horizontal: DrawLineSegment[] } {
  const { viewport, columns, items, merges, x, bodyY } = options
  const vertical: DrawLineSegment[] = []
  const horizontal: DrawLineSegment[] = []
  const range = viewport.visibleVirtualRange(items.length)
  if (range.startIndex < 0) return { vertical, horizontal }
  const bottom = bodyY + viewport.viewHeight
  const right = x + viewport.viewWidth
  const edges = gridColumnBorderEdges(viewport, columns, x)
  let dataTop: number | undefined
  let dataBottom = bodyY
  const flush = () => {
    if (dataTop !== undefined && dataBottom > dataTop) {
      for (const edge of edges) vertical.push({ x1: edge, y1: dataTop, x2: edge, y2: dataBottom })
    }
    dataTop = undefined
  }
  for (let index = range.startIndex; index <= range.endIndex; index++) {
    const item = items[index]!
    const rowTop = bodyY + (viewport.rowOffset(index) - viewport.scrollY)
    const relativeBottom = viewport.rowOffset(index + 1) - viewport.scrollY
    const rowBottom = bodyY + Math.min(viewport.viewHeight, relativeBottom)
    if (item.kind === 'group') flush()
    else {
      dataTop ??= Math.max(bodyY, rowTop)
      dataBottom = Math.min(bottom, rowBottom)
    }
    // Header/footer boundaries are drawn by their section, not by a scrolled row.
    if (relativeBottom <= borderEpsilon || relativeBottom > viewport.viewHeight + borderEpsilon ||
      (options.footer && Math.abs(relativeBottom - viewport.viewHeight) < borderEpsilon)) continue
    const holes: Array<{ start: number; end: number }> = []
    if (item.kind === 'data' && merges) columns.forEach((column, colIndex) => {
      if (!column.mergeRows) return
      const run = merges.runAt(index, column.key)
      if (!run || run.endItemIndex <= index) return
      const visible = viewport.visibleCellRect(columns, x, colIndex)
      if (visible.w > 0) holes.push({ start: visible.x, end: visible.x + visible.w })
    })
    let start = x
    for (const hole of holes.sort((a, b) => a.start - b.start)) {
      if (hole.start > start) horizontal.push({ x1: start, y1: rowBottom, x2: hole.start, y2: rowBottom })
      start = Math.max(start, hole.end)
    }
    if (start < right) horizontal.push({ x1: start, y1: rowBottom, x2: right, y2: rowBottom })
  }
  flush()
  return { vertical, horizontal }
}
