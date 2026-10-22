// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RenderDataGrid, type DataGridOptions } from '../grid_view'
import { ImGuiLightTheme } from '../../theme/default_theme'
import { TextMeasurer } from '../../core/text_measurer'
import { FocusManager } from '../../core/focus_manager'
import { InputComposer } from '../../core/input_composer'
import { PopupManager } from '../../core/popup_manager'
import { gridBodyBorderSegments, gridColumnBorderEdges } from './grid_border_geometry'

type Row = { id: number; a: string; b: string; c: string }
const grids: RenderDataGrid<Row>[] = []
function make(options: Partial<DataGridOptions<Row>> = {}, height = 180) {
  const grid = new RenderDataGrid<Row>({
    columns: [
      { key: 'a', title: 'A', type: 'text', width: 80, pinned: 'left', mergeRows: true },
      { key: 'b', title: 'B', type: 'text', width: 100 },
      { key: 'c', title: 'C', type: 'text', width: 200 },
      { key: 'id', title: 'ID', type: 'number', width: 80, pinned: 'right' },
    ],
    rows: Array.from({ length: 8 }, (_, id) => ({ id, a: id < 3 ? 'merge' : String(id), b: 'b', c: 'c' })),
    rowHeight: 20, headerHeight: 20, ...options,
  })
  grids.push(grid)
  grid.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: height }, false, { theme: ImGuiLightTheme })
  return grid
}
function borders(grid: RenderDataGrid<Row>, x = 0, y = 0) {
  return gridBodyBorderSegments({ viewport: grid.viewport, columns: grid.visibleColumns,
    items: grid.dataModel.visibleItems(), merges: grid.rowMerges, x,
    bodyY: y + grid.viewport.headerSectionHeight, footer: grid.footerHeight > 0 })
}
afterEach(() => {
  grids.splice(0).forEach(grid => grid.dispose())
  PopupManager.disposeInstance()
  FocusManager.disposeInstance()
  InputComposer.disposeInstance()
  vi.restoreAllMocks()
})

describe('DataGrid border geometry', () => {
  it('does not duplicate frozen boundaries with fractional widths and origin', () => {
    const grid = make({ columns: [
      { key: 'a', title: 'A', type: 'text', width: 40.1, pinned: 'left' },
      { key: 'b', title: 'B', type: 'text', width: 40.2, pinned: 'left' },
      { key: 'c', title: 'C', type: 'text', width: 300 },
      { key: 'id', title: 'ID', type: 'number', width: 80, pinned: 'right' },
    ] })
    const x = 0.2
    const boundary = x + grid.viewport.fixedRegionWidth(grid.visibleColumns)
    const edges = gridColumnBorderEdges(grid.viewport, grid.visibleColumns, x)
    expect(edges.some(edge => Math.abs(edge - boundary) < 1e-9)).toBe(false)
  })
  it('uses true column edges and leaves frozen region separators to their painter', () => {
    const grid = make()
    grid.viewport.setScrollX(grid.visibleColumns, 60)
    const right = 17 + grid.viewport.viewWidth
    const edges = gridColumnBorderEdges(grid.viewport, grid.visibleColumns, 17)
    expect(edges).toEqual([137, right])
    expect(edges).not.toContain(17)
    expect(edges).not.toContain(97)
    expect(edges).not.toContain(right - 80)
  })

  it('removes interior row boundaries only inside a merged column', () => {
    const grid = make()
    const horizontal = borders(grid).horizontal
    expect(horizontal.filter(edge => edge.y1 === 40)).toEqual([{ x1: 80, y1: 40, x2: grid.viewport.viewWidth, y2: 40 }])
    expect(horizontal.find(edge => edge.y1 === 80)?.x1).toBe(0)
  })

  it('joins adjacent merge holes, including a partly clipped scrolling column', () => {
    const grid = make({ columns: [
      { key: 'a', title: 'A', type: 'text', width: 80, pinned: 'left', mergeRows: true },
      { key: 'b', title: 'B', type: 'text', width: 100, mergeRows: true },
      { key: 'c', title: 'C', type: 'text', width: 300 },
    ] })
    grid.viewport.setScrollX(grid.visibleColumns, 60)
    expect(borders(grid).horizontal.filter(edge => edge.y1 === 40)).toEqual([
      { x1: 120, y1: 40, x2: grid.viewport.viewWidth, y2: 40 },
    ])
  })

  it('retains holes for a merge whose anchor is outside the virtual window', () => {
    const grid = make({ rows: Array.from({ length: 100 }, (_, id) => ({ id, a: 'same', b: 'b', c: 'c' })) })
    grid.viewport.setScrollY(100, 500)
    expect(grid.viewport.visibleVirtualRange(100).startIndex).toBeGreaterThan(0)
    expect(borders(grid).horizontal.every(edge => edge.x1 === 80)).toBe(true)
    expect(borders(grid).horizontal.length).toBeGreaterThan(0)
  })

  it('ends row lines before a merged right-pinned column while the center scrolls', () => {
    const grid = make({ columns: [
      { key: 'a', title: 'A', type: 'text', width: 80, pinned: 'left' },
      { key: 'b', title: 'B', type: 'text', width: 300 },
      { key: 'c', title: 'C', type: 'text', width: 80, pinned: 'right', mergeRows: true },
    ] })
    grid.viewport.setScrollX(grid.visibleColumns, 90)
    const edges = borders(grid).horizontal
    expect(edges.length).toBeGreaterThan(0)
    expect(edges.every(edge => edge.x1 === 0 && edge.x2 === grid.viewport.viewWidth - 80)).toBe(true)
  })

  it('uses measured row offsets for variable heights and clipping', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation((text, size) => text.length * size / 2)
    const grid = make({ autoRowHeight: true, rows: [
      { id: 0, a: 'a', b: 'short', c: 'c' },
      { id: 1, a: 'a', b: 'long '.repeat(20), c: 'c' },
      { id: 2, a: 'z', b: 'end', c: 'c' },
    ] }, 400)
    expect(grid.viewport.rowHeightAt(1)).toBeGreaterThan(grid.viewport.rowHeightAt(0))
    const firstBottom = 20 + grid.viewport.rowOffset(1)
    const secondBottom = 20 + grid.viewport.rowOffset(2)
    expect(borders(grid).horizontal.find(edge => edge.y1 === firstBottom)?.x1).toBe(80)
    expect(borders(grid).horizontal.find(edge => edge.y1 === secondBottom)?.x1).toBe(0)
  })

  it('does not draw a body boundary over an aligned header or footer boundary', () => {
    const grid = make({ footerHeight: 20 }, 100)
    grid.viewport.setScrollY(8, 40)
    const horizontal = borders(grid).horizontal
    expect(horizontal.every(edge => edge.y1 > 20 && edge.y1 < 20 + grid.viewport.viewHeight)).toBe(true)
  })

  it('does not repeat the header separator after scrolling fractional rows', () => {
    const grid = make({ rowHeight: 20.1, headerHeight: 20.2 })
    grid.viewport.setScrollY(8, 40.2)
    const horizontal = borders(grid).horizontal
    expect(horizontal.some(edge => Math.abs(edge.y1 - 20.2) < 1e-9)).toBe(false)
  })

  it('breaks column lines across group headings', () => {
    const grid = make({ groupBy: [{ key: 'b' }] }, 300)
    const items = grid.dataModel.visibleItems()
    expect(items[0]?.kind).toBe('group')
    const vertical = borders(grid).vertical
    expect(vertical.length).toBeGreaterThan(0)
    expect(vertical.every(edge => edge.y1 >= 40)).toBe(true)
    expect(borders(grid).horizontal.find(edge => edge.y1 === 40)?.x1).toBe(0)
  })

  it('returns no body geometry for an empty projection', () => {
    expect(borders(make({ rows: [] }))).toEqual({ vertical: [], horizontal: [] })
  })
})
