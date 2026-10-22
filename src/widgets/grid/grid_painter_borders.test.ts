// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RenderDataGrid, type DataGridOptions } from '../grid_view'
import { DrawList } from '../../rendering/draw_list'
import { PaintContext } from '../../rendering/paint_context'
import { ImGuiDarkTheme } from '../../theme/default_theme'
import { deriveGridCellStyle } from '../../theme/component_styles'
import { FocusManager } from '../../core/focus_manager'
import { InputComposer } from '../../core/input_composer'
import { PopupManager } from '../../core/popup_manager'

type Row = { id: number; text: string }
const grids: RenderDataGrid<Row>[] = []
function make(options: Partial<DataGridOptions<Row>> = {}) {
  const grid = new RenderDataGrid<Row>({
    columns: [{ key: 'id', title: 'ID', type: 'number', width: 80 }, { key: 'text', title: 'Text', type: 'text', width: 240 }],
    rows: Array.from({ length: 10 }, (_, id) => ({ id, text: 'same' })), rowHeight: 24, headerHeight: 24,
    editable: true, ...options,
  })
  grids.push(grid)
  grid.layout({ minWidth: 0, maxWidth: 280, minHeight: 0, maxHeight: 200 }, false, { theme: ImGuiDarkTheme })
  return grid
}
function paint(grid: RenderDataGrid<Row>) {
  const ctx = { beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    arc: vi.fn(), roundRect: vi.fn(), rect: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    fillRect: vi.fn(), strokeRect: vi.fn(), save: vi.fn(), restore: vi.fn(), clip: vi.fn(),
    fillText: vi.fn(), measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D
  grid.paint(new PaintContext(ctx, ImGuiDarkTheme), { x: 0, y: 0 })
}
afterEach(() => {
  grids.splice(0).forEach(grid => grid.dispose())
  PopupManager.disposeInstance()
  FocusManager.disposeInstance()
  InputComposer.disposeInstance()
  vi.restoreAllMocks()
})

describe('DataGrid border painting order', () => {
  it.each(['normal', 'hover', 'selected', 'editing', 'disabled', 'loading'] as const)('owns a single final frame in %s state', state => {
    const grid = make()
    if (state === 'hover') grid.onPointerMove({ pointerId: 1, type: 'move', position: { x: 30, y: 60 } })
    if (state === 'selected') grid.setSelectedRows([0, 1])
    if (state === 'editing') expect(grid.beginEdit(1, 'text')).toBe(true)
    if (state === 'disabled') grid.disabled = true
    if (state === 'loading') grid.dataState = 'loading'
    const strokes = vi.spyOn(DrawList.prototype, 'strokeRect')
    const fills = vi.spyOn(DrawList.prototype, 'fillRect')
    const segments = vi.spyOn(DrawList.prototype, 'strokeSegments')
    paint(grid)
    const frames = strokes.mock.calls.flatMap((args, i) => args[0] === 0 && args[1] === 0 && args[2] === 280 && args[3] === 200 ? [i] : [])
    expect(frames).toHaveLength(1)
    expect(strokes.mock.calls.every(args => args[5] !== 0.5)).toBe(true)
    expect(strokes.mock.invocationCallOrder[frames[0]!]).toBeGreaterThan(Math.max(...fills.mock.invocationCallOrder, ...segments.mock.invocationCallOrder))
  })

  it('paints validation borders after the grid even during editing', () => {
    const grid = make({ validateCell: ({ key }) => key === 'text' ? 'Invalid' : true })
    expect(grid.beginEdit(1, 'text')).toBe(true)
    expect(grid.commitEdit()).toBe(false)
    const strokes = vi.spyOn(DrawList.prototype, 'strokeRect')
    const segments = vi.spyOn(DrawList.prototype, 'strokeSegments')
    paint(grid)
    const tokens = deriveGridCellStyle(ImGuiDarkTheme)
    const errors = strokes.mock.calls.flatMap((args, i) => args[4] === tokens.cellErrorBorder ? [strokes.mock.invocationCallOrder[i]!] : [])
    expect(errors.length).toBeGreaterThan(0)
    expect(Math.min(...errors)).toBeGreaterThan(Math.max(...segments.mock.invocationCallOrder))
    expect(grid.editing.state).not.toBeNull()
  })

  it('preserves the shared header/filter/footer separators without cell rectangles', () => {
    const grid = make({ filterRowVisible: true, footerHeight: 24 })
    const lines = vi.spyOn(DrawList.prototype, 'line')
    const strokes = vi.spyOn(DrawList.prototype, 'strokeRect')
    paint(grid)
    const horizontal = lines.mock.calls.filter(([x1, y1, x2, y2]) => x1 === 0 && x2 === grid.viewport.viewWidth && y1 === y2)
    expect(horizontal.map(args => args[1])).toEqual([24, 24 + grid.viewport.filterRowHeight, grid.viewport.headerSectionHeight + grid.viewport.viewHeight])
    expect(strokes.mock.calls.filter(args => args[5] === 0.5)).toEqual([])
  })
})


it('keeps summary column separators even when a column has no aggregate', () => {
  const grid = make({ columns: [
    { key: 'id', title: 'ID', type: 'number', width: 80 },
    { key: 'text', title: 'Text', type: 'text', width: 100 },
  ], summary: [{ key: 'id', aggregate: 'sum' }], footerHeight: 24 })
  const segments = vi.spyOn(DrawList.prototype, 'strokeSegments')
  paint(grid)
  const top = grid.viewport.headerSectionHeight + grid.viewport.viewHeight
  const footer = segments.mock.calls.flatMap(([edges]) => edges)
    .filter(edge => edge.y1 === top && edge.y2 === top + 24)
  expect(footer.map(edge => edge.x1)).toEqual([80, 180])
})
