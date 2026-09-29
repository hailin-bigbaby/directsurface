import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImGuiLightTheme } from '../theme/default_theme'
import { TextMeasurer } from '../core/text_measurer'
import { RenderDataGrid } from './grid_view'
import type { GridColumnDef } from './grid/grid_types'

interface Row {
  id: number
  name: string
  qty: number
}

const columns: GridColumnDef<Row>[] = [
  { key: 'name', title: 'Name', type: 'text', width: 80, mergeRows: true },
  { key: 'qty', title: 'Quantity', type: 'number', width: 90 },
]

function layout(grid: RenderDataGrid<Row>): void {
  grid.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 120 }, false, { theme: ImGuiLightTheme })
}

afterEach(() => vi.restoreAllMocks())

describe('RenderDataGrid vertical merge', () => {
  it('maps covered cells to the anchor and blocks direct editing without changing source rows', () => {
    const rows = [
      { id: 1, name: 'A', qty: 1 },
      { id: 2, name: 'A', qty: 2 },
      { id: 3, name: 'B', qty: 3 },
    ]
    const grid = new RenderDataGrid<Row>({ columns, rows, editable: true, selectionMode: 'cell' })
    layout(grid)

    expect(grid.rowMerges.runs('name')).toMatchObject([{ startItemIndex: 0, endItemIndex: 1 }])
    expect(grid.selectCell(1, 0, { scroll: false })).toBe(true)
    expect(grid.debugState().currentCell).toEqual({ row: 0, col: 0 })
    expect(grid.beginEdit(rows[1]!, 'name')).toBe(false)
    expect(rows.map(row => row.name)).toEqual(['A', 'A', 'B'])

    grid.dispose()
  })

  it('renormalizes and notifies when a data edit grows a merge', () => {
    const rows = [
      { id: 1, name: 'A', qty: 1 },
      { id: 2, name: 'B', qty: 2 },
      { id: 3, name: 'A', qty: 3 },
    ]
    const onCurrentCellChange = vi.fn()
    const grid = new RenderDataGrid<Row>({ columns, rows, editable: true, selectionMode: 'cell', onCurrentCellChange })
    layout(grid)
    grid.selectCell(1, 0, { scroll: false })
    onCurrentCellChange.mockClear()

    expect(grid.setCellValue(rows[1]!, 'name', 'A')).toBe(true)
    expect(grid.rowMerges.runs('name')).toMatchObject([{ startItemIndex: 0, endItemIndex: 2 }])
    expect(grid.debugState().currentCell).toEqual({ row: 0, col: 0 })
    expect(onCurrentCellChange).toHaveBeenCalledWith(expect.objectContaining({ row: rows[0], key: 'name' }))

    grid.dispose()
  })

  it('shows both the anchor text and edit reason when merged text overflows', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(String(text)).length * 8)
    const rows = [{ id: 1, name: 'Alphabet', qty: 1 }, { id: 2, name: 'Alphabet', qty: 2 }]
    const grid = new RenderDataGrid<Row>({
      columns: [{ key: 'name', title: 'Name', type: 'text', width: 56, mergeRows: true }],
      rows, editable: true, rowHeight: 20, headerHeight: 20,
    })
    layout(grid)

    grid.onPointerMove({ pointerId: 0, position: { x: 10, y: 50 }, type: 'move' })
    expect(grid.tooltip).toBe('Alphabet\n合并区域不可直接编辑')

    grid.dispose()
  })
})
