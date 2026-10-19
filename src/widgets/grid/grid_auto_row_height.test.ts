// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RenderDataGrid, type DataGridOptions } from '../grid_view'
import { TextMeasurer } from '../../core/text_measurer'
import { FocusManager } from '../../core/focus_manager'
import { InputComposer } from '../../core/input_composer'
import { PopupManager } from '../../core/popup_manager'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../../theme/default_theme'
import { PaintContext } from '../../rendering/paint_context'
import { GridViewport } from './grid_viewport'

type Row = { id: number; text: string; other?: string; group?: string }
const grids: RenderDataGrid<Row>[] = []
function grid(options: Partial<DataGridOptions<Row>> = {}) {
  const result = new RenderDataGrid<Row>({
    columns: [{ key: 'text', title: 'Text', type: 'text', width: 100, autoRowHeight: true }],
    rows: [{ id: 1, text: 'short' }, { id: 2, text: 'long '.repeat(16) }, { id: 3, text: 'tail' }],
    rowKey: 'id', rowHeight: 24, headerHeight: 24, ...options,
  })
  grids.push(result)
  return result
}
function layout(grid: RenderDataGrid<Row>, width = 240, height = 180, theme = ImGuiDarkTheme) {
  grid.layout({ minWidth: 0, maxWidth: width, minHeight: 0, maxHeight: height }, false, { theme })
}
function paint(grid: RenderDataGrid<Row>) {
  const text = vi.fn()
  const ctx = { beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    arc: vi.fn(), roundRect: vi.fn(), rect: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    fillRect: vi.fn(), strokeRect: vi.fn(), save: vi.fn(), restore: vi.fn(), clip: vi.fn(),
    fillText: text, measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D
  grid.paint(new PaintContext(ctx, ImGuiDarkTheme), { x: 0, y: 0 })
  return text
}

beforeEach(() => {
  vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation((text, size) => Array.from(text).length * size / 2)
})
afterEach(() => {
  for (const grid of grids.splice(0)) grid.dispose()
  PopupManager.instance.dispose()
  FocusManager.instance.dispose()
  InputComposer.instance.dispose()
  vi.restoreAllMocks()
})

describe('DataGrid automatic row height', () => {
  it('keeps the default fixed-height contract', () => {
    const g = grid({ columns: [{ key: 'text', title: 'Text', type: 'text' }] })
    layout(g)
    expect(g.viewport.rowHeightAt(1)).toBe(24)
    expect(g.viewport.totalContentHeight(3)).toBe(72)
    expect(g.viewport.rowOffset(2)).toBe(48)
  })

  it('uses measured heights for painting, hit testing, editor rectangles and virtual ranges', () => {
    const g = grid()
    layout(g)
    const h0 = g.viewport.rowHeightAt(0)
    const h1 = g.viewport.rowHeightAt(1)
    expect(h1).toBeGreaterThan(h0 * 2)
    expect(g.viewport.rowOffset(2)).toBe(h0 + h1)
    const rect = g.editingGeometry.cellGlobalRect(1, 0)
    expect(rect).toMatchObject({ y: 24 + h0, h: h1 })
    expect(g.viewport.rowAtY(rect.y + 20, { x: 0, y: 0 }, 3)).toBe(1)
    expect(g.viewport.rowAtY(rect.y, { x: 0, y: 0 }, 3)).toBe(1)
    const calls = paint(g).mock.calls
    expect(calls.filter(call => String(call[0]).includes('long')).length).toBeGreaterThan(1)
    g.viewport.setScrollY(3, h0 + 10)
    expect(g.viewport.visibleVirtualRange(3).visibleStartIndex).toBe(1)
    expect(g.viewport.rowAtY(24, { x: 0, y: 0 }, 3)).toBe(1)
  })

  it('measures all participating columns, including horizontally offscreen and pinned columns', () => {
    const g = grid({ autoRowHeight: true, columns: [
      { key: 'id', title: 'ID', type: 'number', width: 60, pinned: 'left' },
      { key: 'other', title: 'Other', type: 'text', width: 300 },
      { key: 'text', title: 'Text', type: 'text', width: 100, pinned: 'right' },
    ] })
    layout(g, 220)
    const heights = [0, 1, 2].map(i => g.viewport.rowHeightAt(i))
    g.viewport.setScrollX(g.visibleColumns, 200)
    g.markNeedsPaint()
    layout(g, 220)
    expect([0, 1, 2].map(i => g.viewport.rowHeightAt(i))).toEqual(heights)
    expect(heights[1]).toBeGreaterThan(60)
  })

  it('supports opting a column out and toggling the grid mode at runtime', () => {
    const g = grid({ autoRowHeight: true, columns: [
      { key: 'text', title: 'Text', type: 'text', width: 80, autoRowHeight: false },
      { key: 'id', title: 'ID', type: 'number', width: 60 },
    ] })
    layout(g)
    expect(g.viewport.rowHeightAt(0)).toBe(g.viewport.rowHeightAt(1))
    g.autoRowHeight = false
    layout(g)
    expect(g.viewport.rowHeightAt(1)).toBe(24)
    expect(g.viewport.totalContentHeight(3)).toBe(72)
  })

  it('does not schedule layout when every column opts out of global automatic height', () => {
    const g = grid({ autoRowHeight: true, columns: [
      { key: 'text', title: 'Text', type: 'text', width: 100, autoRowHeight: false },
    ] })
    layout(g)
    g.markNeedsPaint()
    expect(g.needsLayout).toBe(false)
    expect(g.viewport.rowHeightAt(1)).toBe(24)
  })

  it('preserves the top row when switching between fixed and automatic height', () => {
    const g = grid({ rows: Array.from({ length: 30 }, (_, id) => ({ id, text: id % 2 ? 'long '.repeat(10) : 'short' })),
      columns: [{ key: 'text', title: 'Text', type: 'text', width: 100 }],
    })
    layout(g)
    g.viewport.setScrollY(30, 24 * 10 + 3)
    g.autoRowHeight = true
    layout(g)
    expect(g.viewport.scrollY).toBe(g.viewport.rowOffset(10) + 3)
    g.autoRowHeight = false
    layout(g)
    expect(g.viewport.scrollY).toBe(24 * 10 + 3)
  })

  it('redistributes a spanning-cell deficit around rows already at their height limit', () => {
    const text = 'merged '.repeat(18)
    const g = grid({ maxRowHeight: 120, rows: [
      { id: 1, text, other: 'short' }, { id: 2, text, other: 'other '.repeat(30) },
    ], columns: [
      { key: 'text', title: 'Text', type: 'text', width: 100, autoRowHeight: true, mergeRows: true },
      { key: 'other', title: 'Other', type: 'text', width: 100, autoRowHeight: true },
    ] })
    layout(g, 240, 600)
    expect(g.viewport.rowHeightAt(0)).toBeGreaterThan(80)
    expect(g.viewport.rowHeightAt(0)).toBeLessThanOrEqual(120)
    expect(g.viewport.rowHeightAt(1)).toBe(120)
    expect(g.viewport.totalContentHeight(2)).toBeGreaterThan(200)
  })

  it('supports wrapping without automatic height and caps automatic heights', () => {
    const g = grid({ maxRowHeight: 60 })
    layout(g)
    expect(g.viewport.rowHeightAt(1)).toBe(60)
    expect(paint(g).mock.calls.some(call => String(call[0]).includes('...'))).toBe(true)
    g.maxRowHeight = 10
    layout(g)
    expect(g.viewport.rowHeightAt(1)).toBe(24)
    const fixed = grid({ columns: [{ key: 'text', title: 'Text', type: 'text', width: 100, wrapText: true }], rowHeight: 65 })
    layout(fixed)
    expect(fixed.viewport.rowHeightAt(1)).toBe(65)
    expect(paint(fixed).mock.calls.filter(call => String(call[0]).includes('long')).length).toBeGreaterThan(1)
  })

  it('measures formatted text, explicit newlines and custom font sizes', () => {
    const g = grid({ rows: [{ id: 1, text: 'x' }],
      getCellDisplayText: () => '第一行\n第二行\n第三行',
      resolveCellStyle: () => ({ fontSize: 20 }),
    })
    layout(g)
    expect(g.viewport.rowHeightAt(0)).toBe(92)
    expect(paint(g).mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(['第一行', '第二行', '第三行']))
    g.getCellDisplayText = () => 'one'
    layout(g)
    expect(g.viewport.rowHeightAt(0)).toBe(36)
  })

  it('remeasures after resize, external refresh, font style and theme changes', () => {
    const g = grid()
    layout(g)
    const old = g.viewport.rowHeightAt(1)
    g.columns = [{ ...g.columns[0]!, width: 240 }]
    layout(g)
    expect(g.viewport.rowHeightAt(1)).toBeLessThan(old)
    g.rows[1]!.text = 'tiny'
    g.refreshRow(g.rows[1]!)
    layout(g)
    expect(g.viewport.rowHeightAt(1)).toBe(g.viewport.rowHeightAt(0))
    g.resolveRowStyle = () => ({ fontSize: 40 })
    layout(g)
    expect(g.viewport.rowHeightAt(1)).toBeGreaterThan(40)
    layout(g, 240, 180, ImGuiLightTheme)
    expect(g.viewport.rowHeightAt(1)).toBeGreaterThan(40)
  })

  it('does not remeasure unchanged presentations on scroll-only frames', () => {
    const render = vi.fn((value: any) => String(value))
    const g = grid({ columns: [{ key: 'text', title: 'Text', type: 'custom', width: 100, autoRowHeight: true, render }] })
    layout(g)
    render.mockClear()
    g.viewport.setScrollY(3, 40)
    g.markNeedsPaint()
    expect(g.needsLayout).toBe(false)
    layout(g)
    expect(render).not.toHaveBeenCalled()
    expect(g.needsLayout).toBe(false)
  })

  it('keeps the same top row and intra-row offset when an earlier row grows', () => {
    const rows = Array.from({ length: 30 }, (_, id) => ({ id, text: 'short' }))
    const g = grid({ rows })
    layout(g)
    const oldOffset = g.viewport.rowOffset(10) + 3
    g.viewport.setScrollY(rows.length, oldOffset)
    g.setCellValue(rows[0]!, 'text', 'long '.repeat(20))
    layout(g)
    expect(g.viewport.scrollY).toBe(g.viewport.rowOffset(10) + 3)
  })

  it('resets to the top on sorting and filtering and does not reuse heights by row index', () => {
    const g = grid({ columns: [
      { key: 'text', title: 'Text', type: 'text', width: 100, autoRowHeight: true },
      { key: 'id', title: 'ID', type: 'number', width: 60, sortable: true, filterable: true },
    ], rows: Array.from({ length: 20 }, (_, id) => ({ id, text: id === 19 ? 'long '.repeat(20) : 'short' })) })
    layout(g)
    const tall = g.viewport.rowHeightAt(19)
    g.viewport.setScrollY(20, 100)
    g.sort = [{ key: 'id', order: 'desc' }]
    layout(g)
    expect(g.viewport.scrollY).toBe(0)
    expect(g.viewport.rowHeightAt(0)).toBe(tall)
    g.setFilters([{ key: 'id', operator: 'equals', value: 0 }])
    layout(g)
    expect(g.viewport.scrollY).toBe(0)
    expect(g.viewport.totalContentHeight(1)).toBeLessThan(tall)
  })

  it('keeps group rows at the base height across collapse and expansion', () => {
    const g = grid({ rows: [{ id: 1, text: 'long '.repeat(10), group: 'A' }, { id: 2, text: 'short', group: 'B' }], groupBy: [{ key: 'group' }] })
    layout(g)
    const items = g.dataModel.visibleItems()
    expect(items[0]!.kind).toBe('group')
    expect(g.viewport.rowHeightAt(0)).toBe(24)
    expect(g.viewport.rowHeightAt(1)).toBeGreaterThan(24)
    if (items[0]!.kind === 'group') g.stateController.toggleGroup(items[0]!.pathKey)
    layout(g)
    expect(g.dataModel.visibleItems().length).toBe(3)
    expect(g.viewport.rowHeightAt(0)).toBe(24)
  })

  it('allocates a merged cell across rows and preserves hit semantics', () => {
    const text = 'merged '.repeat(20)
    const g = grid({ rows: [{ id: 1, text }, { id: 2, text }], columns: [
      { key: 'text', title: 'Text', type: 'text', width: 100, autoRowHeight: true, mergeRows: true },
      { key: 'id', title: 'ID', type: 'number', width: 70 },
    ], editable: true })
    layout(g, 240, 600)
    const h = g.viewport.rowHeightAt(0)
    expect(h).toBeGreaterThan(24)
    expect(Math.abs(h - g.viewport.rowHeightAt(1))).toBeLessThanOrEqual(1)
    expect(g.viewport.rowAtY(24 + h + 1, { x: 0, y: 0 }, 2)).toBe(1)
    expect(g.beginEdit(g.rows[0]!, 'text')).toBe(false)
    expect(paint(g).mock.calls.filter(call => String(call[0]).includes('merged')).length).toBeGreaterThan(1)
    g.setCellValue(g.rows[1]!, 'text', 'separate')
    layout(g, 240, 600)
    expect(g.rowMerges.runs('text')).toHaveLength(0)
    expect(g.viewport.rowHeightAt(0)).toBeGreaterThan(h)
    expect(g.viewport.rowHeightAt(1)).toBeLessThan(h)
  })

  it('keeps an editing row stable across input and resize, and remeasures after commit/cancel', () => {
    const g = grid({ editable: true })
    layout(g, 240, 600)
    const old = g.viewport.rowHeightAt(1)
    expect(g.beginEdit(g.rows[1]!, 'text')).toBe(true)
    g.editing.state!.text = 'tiny'
    g.markNeedsPaint()
    layout(g, 240, 600)
    expect(g.viewport.rowHeightAt(1)).toBe(old)
    expect(g.editingGeometry.cellGlobalRect(1, 0).h).toBe(old)
    expect(g.commitEdit()).toBe(true)
    layout(g, 240, 600)
    expect(g.viewport.rowHeightAt(1)).toBeLessThan(old)
    expect(g.beginEdit(g.rows[1]!, 'text')).toBe(true)
    g.editing.state!.text = 'long '.repeat(30)
    g.cancelEdit()
    layout(g, 240, 600)
    expect(g.viewport.rowHeightAt(1)).toBeLessThan(old)
  })

  it('invalidates text height caches when font measurements change', () => {
    const g = grid()
    layout(g)
    const old = g.viewport.rowHeightAt(1)
    vi.mocked(TextMeasurer.measureWidth).mockImplementation((text, size) => text.length * size)
    TextMeasurer.clearCache()
    g.markNeedsPaint()
    layout(g)
    expect(g.viewport.rowHeightAt(1)).toBeGreaterThan(old)
  })

  it('shows overflow tips only when wrapped content is actually clipped', () => {
    const g = grid()
    layout(g, 240, 600)
    const point = { x: 30, y: 24 + g.viewport.rowHeightAt(0) + 5 }
    g.onPointerMove({ pointerId: 0, position: point, type: 'move' })
    expect(g.tooltip).toBeUndefined()
    g.maxRowHeight = 40
    layout(g, 240, 600)
    g.onPointerMove({ pointerId: 0, position: point, type: 'move' })
    expect(g.tooltip).toBe(g.rows[1]!.text)
  })

  it('recalculates merge allocation when edit policy splits a run', () => {
    const text = 'merged '.repeat(20)
    const g = grid({ rows: [{ id: 1, text }, { id: 2, text }], editable: true,
      columns: [{ key: 'text', title: 'Text', type: 'text', width: 100, mergeRows: true, autoRowHeight: true }],
    })
    layout(g, 240, 600)
    const old = g.viewport.rowHeightAt(0)
    g.resolveCellEditPolicy = ({ row }) => ({ state: row.id === 1 ? 'readonly' : 'editable' })
    layout(g, 240, 600)
    expect(g.rowMerges.runs('text')).toHaveLength(0)
    expect(g.viewport.rowHeightAt(0)).toBeGreaterThan(old)
  })

  it('keeps cumulative geometry consistent even for duplicate row identifiers', () => {
    const g = grid({ rows: [{ id: 1, text: 'short' }, { id: 1, text: 'long '.repeat(20) }] })
    layout(g)
    expect(g.viewport.rowOffset(1)).toBe(g.viewport.rowHeightAt(0))
    expect(g.viewport.rowOffset(2)).toBe(g.viewport.rowHeightAt(0) + g.viewport.rowHeightAt(1))
    expect(g.viewport.rowHeightAt(1)).toBeGreaterThan(g.viewport.rowHeightAt(0))
  })

  it('keeps a frozen editor out of merged-height redistribution', () => {
    const text = 'merged '.repeat(20)
    const g = grid({ rows: [{ id: 1, text, other: 'edit' }, { id: 2, text, other: 'second' }], editable: true,
      columns: [
        { key: 'text', title: 'Text', type: 'text', widthMode: 'stretch', mergeRows: true, autoRowHeight: true },
        { key: 'other', title: 'Other', type: 'text', width: 100, autoRowHeight: true },
      ],
    })
    layout(g, 340, 600)
    const old = g.viewport.rowHeightAt(0)
    expect(g.beginEdit(g.rows[0]!, 'other')).toBe(true)
    layout(g, 240, 600)
    expect(g.editing.state).not.toBeNull()
    expect(g.viewport.rowHeightAt(0)).toBe(old)
    expect(g.viewport.totalContentHeight(2)).toBeGreaterThan(old * 2)
  })

  it('bounds scrolling paint work for a large automatic-height projection', () => {
    const render = vi.fn((value: any) => String(value))
    const g = grid({ rows: Array.from({ length: 5000 }, (_, id) => ({ id, text: id % 2 ? 'long '.repeat(10) : 'short' })),
      columns: [{ key: 'text', title: 'Text', type: 'custom', width: 100, autoRowHeight: true, render }],
    })
    layout(g)
    render.mockClear()
    for (let frame = 1; frame <= 5; frame++) {
      g.viewport.setScrollY(5000, frame * 1000)
      g.markNeedsPaint()
      layout(g)
      const range = g.viewport.visibleVirtualRange(5000)
      expect(range.endIndex - range.startIndex).toBeLessThan(12)
      paint(g)
    }
    expect(render.mock.calls.length).toBeLessThan(60)
  })

  it('does not cancel a number-stepper press on an unchanged automatic layout', () => {
    const g = grid({ editable: true, columns: [
      { key: 'text', title: 'Text', type: 'text', width: 100, autoRowHeight: true },
      { key: 'id', title: 'ID', type: 'number', width: 80 },
    ] })
    layout(g, 240, 600)
    expect(g.beginEdit(g.rows[1]!, 'id')).toBe(true)
    layout(g, 240, 600)
    expect(g.editing.beginNumberStepperPress('up', { pointerId: 1, pointerType: 'mouse' })).toBe(true)
    layout(g, 240, 600)
    expect(g.editing.state!.numberStepperPressed).toBe('up')
  })

  it('keeps single-line editing visible and IME aligned in a row taller than the viewport', () => {
    const g = grid({ editable: true, rows: [{ id: 1, text: 'long '.repeat(200) }] })
    layout(g)
    expect(g.viewport.rowHeightAt(0)).toBeGreaterThan(g.viewport.viewHeight)
    expect(g.beginEdit(g.rows[0]!, 'text')).toBe(true)
    layout(g)
    const rect = g.editingGeometry.cellEditorGlobalRect(0, 0)
    expect(rect.y).toBe(24)
    expect(rect.h).toBe(g.viewport.viewHeight)
    const inputCall = paint(g).mock.calls.find(call => call[0] === g.rows[0]!.text)
    expect(inputCall?.[2]).toBe(24 + rect.h / 2)
    g.viewport.setScrollY(1, 120)
    g.viewport.scrollToRow(1, 0)
    expect(g.viewport.scrollY).toBe(120)
    g.viewport.scrollToRow(1, 0)
    expect(g.viewport.scrollY).toBe(120)
    g.editingGeometry.syncEditingViewportState()
    const input = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement
    expect(parseFloat(input.style.top)).toBeGreaterThan(24)
    expect(parseFloat(input.style.top)).toBeLessThan(24 + rect.h)
  })

  it('preserves editing height when validation rejects a commit', () => {
    const g = grid({ editable: true, validateCell: () => 'invalid' })
    layout(g, 240, 600)
    const old = g.viewport.rowHeightAt(1)
    expect(g.beginEdit(g.rows[1]!, 'text')).toBe(true)
    g.editing.state!.text = 'tiny'
    expect(g.commitEdit()).toBe(false)
    layout(g, 240, 600)
    expect(g.viewport.rowHeightAt(1)).toBe(old)
    expect(g.editing.state).not.toBeNull()
  })
})

describe('GridViewport variable row geometry', () => {
  it('uses exact boundaries, content extent, scrolling and page navigation', () => {
    const v = new GridViewport({ rowHeight: 20, headerHeight: 20, reserveScrollbars: false })
    v.performLayout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 120 }, ImGuiDarkTheme, [])
    v.setRowSizes(['a', 'b', 'c', 'd', 'e'], [20, 120, 30, 40, 80])
    expect(v.totalContentHeight(5)).toBe(290)
    expect(v.rowIndexAtOffset(20, 5)).toBe(1)
    expect(v.rowIndexAtOffset(290, 5)).toBe(-1)
    expect(v.pageStep(0, 1, 5)).toBe(1)
    v.scrollToRow(5, 4)
    expect(v.scrollY).toBe(190)
    v.setRowSizes(['x', 'a', 'b', 'c', 'd', 'e'], [50, 20, 120, 30, 40, 80])
    expect(v.scrollY).toBe(240)
    expect(v.visibleVirtualRange(6).visibleStartIndex).toBe(4)
    v.setScrollY(6, 70 + 90)
    v.setRowSizes(['x', 'a', 'b', 'c', 'd', 'e'], [50, 20, 30, 30, 40, 80])
    expect(v.scrollY).toBe(99)
    v.setRowSizes([], [])
    expect(v.scrollY).toBe(0)
    expect(v.visibleVirtualRange(0).startIndex).toBe(-1)
  })
})

describe('DataGrid auto-height review regressions', () => {
  it.each([false, true])('append-and-reveal is correct with autoHeight=%s', automatic => {
    const g = grid({ columns: [{ key: 'text', title: 'Text', type: 'text', width: 100, autoRowHeight: automatic }], rows: [{ id: 1, text: 'short' }] })
    layout(g)
    const appended = Array.from({ length: 100 }, (_, i) => ({ id: i + 2, text: 'short' }))
    g.addRows(appended)
    g.selectCell(appended[99]!, 'text', { scroll: true })
    layout(g)
    const rect = g.editingGeometry.cellGlobalRect(100, 0)
    expect(rect.y).toBeLessThan(24 + g.viewport.viewHeight)
  })
  it('automatic reveal succeeds when layout is explicitly completed first', () => {
    const g = grid({ rows: [{ id: 1, text: 'short' }] })
    layout(g)
    const appended = Array.from({ length: 100 }, (_, i) => ({ id: i + 2, text: 'short' }))
    g.addRows(appended)
    layout(g)
    g.selectCell(appended[99]!, 'text', { scroll: true })
    expect(g.editingGeometry.cellGlobalRect(100, 0).y).toBeLessThan(24 + g.viewport.viewHeight)
  })
  it.each([undefined, 'id' as const])('preserves the edited row height on insertion with rowKey=%s', rowKey => {
    const rows = [{ id: 1, text: 'short' }, { id: 2, text: 'long '.repeat(16) }, { id: 3, text: 'short' }]
    const g = grid({ rows, rowKey, editable: true })
    layout(g, 240, 600)
    const old = g.viewport.rowHeightAt(1)
    const edited = rows[1]!
    expect(g.beginEdit(edited, 'text')).toBe(true)
    layout(g, 240, 600)
    g.insertRowsBefore(rows[0]!, [{ id: 100, text: 'inserted' }])
    layout(g, 240, 600)
    const editingIndex = g.editing.state!.row
    expect(g.editing.state!.rowRef).toBe(edited)
    expect(g.viewport.rowHeightAt(editingIndex)).toBe(old)
  })
  it.each([false, true])('hover stays local with displayCallback=%s', callback => {
    const render = vi.fn(value => String(value))
    const g = grid({ rows: Array.from({ length: 5000 }, (_, id) => ({ id, text: 'short' })),
      columns: [{ key: 'text', title: 'Text', type: 'custom', width: 100, autoRowHeight: true, render }],
      getCellDisplayText: callback ? args => String(args.value) : undefined,
    })
    layout(g)
    render.mockClear()
    g.onPointerMove({ pointerId: 0, position: { x: 30, y: 30 }, type: 'move' })
    layout(g)
    expect(render.mock.calls.length).toBeLessThan(10)
  })
  it('keeps short merged text visible even when its anchor is outside the viewport', () => {
    const g = grid({ rows: Array.from({ length: 50 }, (_, id) => ({ id, text: 'sticky' })),
      columns: [{ key: 'text', title: 'Text', type: 'text', width: 100, autoRowHeight: true, mergeRows: true }],
    })
    layout(g)
    g.viewport.setScrollY(50, 100000)
    expect(paint(g).mock.calls.map(call => call[0])).toContain('sticky')
  })
  it.each([false, true])('can read the last line of a tall cell with merged=%s', merged => {
    const text = Array.from({ length: 40 }, (_, i) => `line-${i}`).join('\n')
    const g = grid({ rows: [{ id: 1, text }, { id: 2, text }], columns: [
      { key: 'text', title: 'Text', type: 'text', width: 100, autoRowHeight: true, mergeRows: merged },
    ] })
    layout(g)
    g.viewport.setScrollY(2, 100000)
    const visible = paint(g).mock.calls.filter(call => Number(call[2]) >= 24 && Number(call[2]) < 24 + g.viewport.viewHeight).map(call => call[0])
    expect(visible).toContain('line-39')
  })
  it('honors a reveal after a preceding row grows before layout', () => {
    const rows = Array.from({ length: 30 }, (_, id) => ({ id, text: 'short' }))
    const g = grid({ rows })
    layout(g)
    g.setCellValue(rows[10]!, 'text', 'long '.repeat(200))
    g.selectCell(rows[11]!, 'text', { scroll: true })
    layout(g)
    const rect = g.editingGeometry.cellGlobalRect(11, 0)
    expect(rect.y).toBeGreaterThanOrEqual(24)
    expect(rect.y + rect.h).toBeLessThanOrEqual(24 + g.viewport.viewHeight)
  })

  it('tracks the latest reveal by identity through another insertion and skips a removed target', () => {
    const g = grid({ rows: [{ id: 1, text: 'short' }] })
    layout(g)
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i + 2, text: 'short' }))
    g.addRows(rows)
    g.selectCell(rows[99]!, 'text', { scroll: true })
    g.selectCell(rows[50]!, 'text', { scroll: true })
    g.insertRowsBefore(rows[0]!, [{ id: 200, text: 'long '.repeat(50) }])
    layout(g)
    const index = g.dataModel.visibleRows().indexOf(rows[50]!)
    const rect = g.editingGeometry.cellGlobalRect(index, 0)
    expect(rect.y).toBeGreaterThanOrEqual(24)
    expect(rect.y + rect.h).toBeLessThanOrEqual(24 + g.viewport.viewHeight)
    g.setCellValue(rows[10]!, 'text', 'long '.repeat(100))
    g.selectCell(rows[99]!, 'text', { scroll: true })
    g.removeRows([rows[99]!])
    expect(() => layout(g)).not.toThrow()
    expect(g.viewport.scrollY).toBeLessThanOrEqual(g.viewport.totalContentHeight(g.dataModel.visibleItemCount()))
  })

  it('preserves the top row by object identity without rowKey when inserting or removing earlier rows', () => {
    const rows = Array.from({ length: 40 }, (_, id) => ({ id, text: 'short' }))
    const g = grid({ rows, rowKey: undefined })
    layout(g)
    const anchor = rows[10]!
    g.viewport.setScrollY(40, g.viewport.rowOffset(10) + 3)
    const inserted = { id: 100, text: 'long '.repeat(20) }
    g.insertRowsBefore(rows[0]!, [inserted])
    layout(g)
    let index = g.dataModel.visibleRows().indexOf(anchor)
    expect(g.viewport.scrollY).toBe(g.viewport.rowOffset(index) + 3)
    g.removeRows([inserted])
    layout(g)
    index = g.dataModel.visibleRows().indexOf(anchor)
    expect(g.viewport.scrollY).toBe(g.viewport.rowOffset(index) + 3)
  })

  it('grows and shrinks only the changed hover/focus/selection rows', () => {
    const render = vi.fn(value => String(value))
    const style = vi.fn(({ hovered, selected, focused }) => ({ fontSize: hovered || selected || focused ? 32 : 14 }))
    const g = grid({ rows: Array.from({ length: 1000 }, (_, id) => ({ id, text: 'long '.repeat(10) })),
      columns: [{ key: 'text', title: 'Text', type: 'custom', width: 100, autoRowHeight: true, render }],
      resolveCellStyle: style,
    })
    layout(g, 240, 600)
    const baseline = g.viewport.rowHeightAt(0)
    const fullUpdates = vi.spyOn(g.viewport, 'setRowSizes')
    render.mockClear()
    g.interaction.setHoveredItem(0)
    layout(g, 240, 600)
    expect(g.viewport.rowHeightAt(0)).toBeGreaterThan(baseline)
    g.interaction.setHoveredItem(1)
    layout(g, 240, 600)
    expect(g.viewport.rowHeightAt(0)).toBe(baseline)
    expect(g.viewport.rowHeightAt(1)).toBeGreaterThan(baseline)
    g.setSelectedRows([g.rows[5]!])
    layout(g, 240, 600)
    expect(g.viewport.rowHeightAt(5)).toBeGreaterThan(baseline)
    g.setSelectedRows([])
    layout(g, 240, 600)
    expect(g.viewport.rowHeightAt(5)).toBe(baseline)
    FocusManager.instance.setFocus(g)
    g.interaction.focusCell(8, 0, { select: false, scroll: false })
    layout(g, 240, 600)
    expect(g.viewport.rowHeightAt(8)).toBeGreaterThan(baseline)
    g.interaction.focusCell(9, 0, { select: false, scroll: false })
    layout(g, 240, 600)
    expect(g.viewport.rowHeightAt(8)).toBe(baseline)
    expect(g.viewport.rowHeightAt(9)).toBeGreaterThan(baseline)
    expect(render.mock.calls.length).toBeLessThan(20)
    expect(fullUpdates).not.toHaveBeenCalled()
  })

  it('redistributes overlapping merged spans after selection grows and shrinks their anchor text', () => {
    const g = grid({ rows: [
      { id: 1, text: 'a', other: 'x' }, { id: 2, text: 'a', other: 'b' }, { id: 3, text: 'z', other: 'b' },
      ...Array.from({ length: 100 }, (_, i) => ({ id: i + 4, text: 'other', other: 'other' })),
    ], columns: [
      { key: 'text', title: 'Text', type: 'text', width: 100, mergeRows: true, autoRowHeight: true },
      { key: 'other', title: 'Other', type: 'text', width: 100, mergeRows: true, autoRowHeight: true },
    ], getCellDisplayText: ({ value, selected }) => selected ? String(value).repeat(100) : String(value) })
    layout(g, 240, 600)
    const baseline = [0, 1, 2].map(i => g.viewport.rowHeightAt(i))
    g.setSelectedRows([g.rows[0]!, g.rows[1]!, g.rows[2]!])
    layout(g, 240, 600)
    expect(g.viewport.rowOffset(3)).toBeGreaterThan(baseline.reduce((a, b) => a + b))
    const incremental = [0, 1, 2].map(i => g.viewport.rowHeightAt(i))
    g.refreshData()
    layout(g, 240, 600)
    expect([0, 1, 2].map(i => g.viewport.rowHeightAt(i))).toEqual(incremental)
    g.setSelectedRows([])
    layout(g, 240, 600)
    expect([0, 1, 2].map(i => g.viewport.rowHeightAt(i))).toEqual(baseline)
  })

  it('reveals and positions an editor opened immediately after appending a row', () => {
    const g = grid({ editable: true, rowKey: undefined, rows: [{ id: 1, text: 'short' }] })
    layout(g)
    const appended = Array.from({ length: 30 }, (_, i) => ({ id: i + 2, text: 'short' }))
    g.addRows(appended)
    const target = appended[29]!
    expect(g.beginEdit(target, 'text')).toBe(true)
    layout(g)
    expect(g.editing.state?.rowRef).toBe(target)
    const rect = g.editingGeometry.cellEditorGlobalRect(30, 0)
    expect(rect.y).toBeGreaterThanOrEqual(24)
    expect(rect.y + rect.h).toBeLessThanOrEqual(24 + g.viewport.viewHeight)
  })

  it('matches full measurement after incremental state updates across intersecting capped merge runs', () => {
    const rows = Array.from({ length: 12 }, (_, id) => ({ id, text: `a${Math.floor(id / 3)}`, other: `b${Math.floor((id + 1) / 3)}` }))
    const g = grid({ rows, maxRowHeight: 90,
      columns: [
        { key: 'text', title: 'Text', type: 'text', width: 100, mergeRows: true, autoRowHeight: true },
        { key: 'other', title: 'Other', type: 'text', width: 100, mergeRows: true, autoRowHeight: true },
        { key: 'id', title: 'ID', type: 'number', width: 60, autoRowHeight: true },
      ],
      getCellDisplayText: ({ value, hovered, selected, focused }) => String(value).repeat(hovered ? 40 : selected ? 60 : focused ? 30 : 1),
    })
    layout(g, 320, 600)
    FocusManager.instance.setFocus(g)
    for (let step = 0; step < 16; step++) {
      g.interaction.setHoveredItem(step % 13 - 1)
      g.interaction.focusCell(step % rows.length, step % 3, { select: false, scroll: false })
      g.setSelectedRows(rows.filter(row => (row.id + step) % 5 < step % 4))
      layout(g, 320, 600)
      const incremental = rows.map((_, index) => g.viewport.rowHeightAt(index))
      const total = g.viewport.totalContentHeight(rows.length)
      // A new style resolver invalidates measurement without resetting interaction state.
      g.resolveRowStyle = () => undefined
      layout(g, 320, 600)
      expect(rows.map((_, index) => g.viewport.rowHeightAt(index))).toEqual(incremental)
      expect(g.viewport.totalContentHeight(rows.length)).toBe(total)
    }
  })

})

describe('DataGrid scroll intent and merged overflow regressions', () => {
  it.each(['sort', 'filter'] as const)('later %s supersedes an earlier pending reveal', action => {
    const g = grid({ rows: [{ id: 1, text: 'short' }], columns: [
      { key: 'text', title: 'Text', type: 'text', width: 100, autoRowHeight: true },
      { key: 'id', title: 'ID', type: 'number', width: 70, sortable: true },
    ] })
    layout(g)
    const added = Array.from({ length: 100 }, (_, i) => ({ id: i + 2, text: 'short' }))
    g.addRows(added)
    g.selectCell(added[99]!, 'text', { scroll: true })
    if (action === 'sort') g.sort = [{ key: 'id', order: 'asc' }]
    else g.quickFilter = 'short'
    layout(g)
    expect(g.viewport.scrollY).toBe(0)
  })
  it.each(['sort', 'filter'] as const)('later reveal wins after an earlier %s', action => {
    const g = grid({ rows: [{ id: 1, text: 'short' }], columns: [
      { key: 'text', title: 'Text', type: 'text', width: 100, autoRowHeight: true },
      { key: 'id', title: 'ID', type: 'number', width: 70, sortable: true },
    ] })
    layout(g)
    const added = Array.from({ length: 100 }, (_, i) => ({ id: i + 2, text: 'short' }))
    g.addRows(added)
    if (action === 'sort') g.sort = [{ key: 'id', order: 'asc' }]
    else g.quickFilter = 'short'
    g.selectCell(added[99]!, 'text', { scroll: true })
    layout(g)
    const rect = g.editingGeometry.cellGlobalRect(100, 0)
    expect(rect.y).toBeGreaterThanOrEqual(24)
    expect(rect.y + rect.h).toBeLessThanOrEqual(24 + g.viewport.viewHeight)
  })
  it('discards a reveal whose target a later filter removed', () => {
    const g = grid({ rows: [{ id: 1, text: 'keep' }] })
    layout(g)
    const added = Array.from({ length: 100 }, (_, i) => ({ id: i + 2, text: 'hide' }))
    g.addRows(added)
    g.selectCell(added[99]!, 'text', { scroll: true })
    g.quickFilter = 'keep'
    layout(g)
    expect(g.viewport.scrollY).toBe(0)
    expect(g.dataModel.visibleItemCount()).toBe(1)
  })
  it.each([false, true])('a sticky merge tooltip agrees with visible clipping=%s', clipped => {
    const text = 'line-0\nline-1\nline-2'
    const g = grid({ rows: [...Array.from({ length: 5 }, (_, id) => ({ id, text })),
      ...Array.from({ length: 20 }, (_, id) => ({ id: id + 5, text: `tail-${id}` }))],
      columns: [{ key: 'text', title: 'Text', type: 'text', width: 100, autoRowHeight: true, mergeRows: true }],
    })
    layout(g)
    if (clipped) g.viewport.setScrollY(25, g.viewport.rowOffset(5) - 28)
    const texts = paint(g).mock.calls.filter(call => Number(call[2]) >= 24 && Number(call[2]) < (clipped ? 52 : 144)).map(call => call[0])
    g.onPointerMove({ pointerId: 0, position: { x: 30, y: 30 }, type: 'move' })
    if (clipped) {
      expect(texts.some(text => String(text).includes('...'))).toBe(true)
      expect(String(g.tooltip ?? '')).toContain('line-2')
    } else {
      expect(texts).toContain('line-2')
      expect(g.tooltip).toBeUndefined()
    }
  })
  it('can still read the tail of a full-height long merged text block', () => {
    const text = Array.from({ length: 40 }, (_, i) => `line-${i}`).join('\n')
    const g = grid({ rows: [{ id: 1, text }, { id: 2, text }], columns: [
      { key: 'text', title: 'Text', type: 'text', width: 100, autoRowHeight: true, mergeRows: true },
    ] })
    layout(g)
    g.viewport.setScrollY(2, 100000)
    const visible = paint(g).mock.calls.filter(call => Number(call[2]) >= 24 && Number(call[2]) < 24 + g.viewport.viewHeight)
    expect(visible.map(call => call[0])).toContain('line-39')
  })
  it('matches a fresh full layout through mixed incremental and editing transitions', () => {
    const rows = Array.from({ length: 18 }, (_, id) => ({ id, text: `a${Math.floor(id / 3)}`, other: `b${Math.floor((id + 1) / 4)}` }))
    const g = grid({ rows, editable: true, maxRowHeight: 100,
      columns: [
        { key: 'text', title: 'Text', type: 'text', width: 100, autoRowHeight: true, mergeRows: true },
        { key: 'other', title: 'Other', type: 'text', width: 100, autoRowHeight: true, mergeRows: true },
        { key: 'id', title: 'ID', type: 'number', width: 70, autoRowHeight: true },
      ],
      getCellDisplayText: ({ value, selected, hovered, focused }) => String(value).repeat(selected ? 60 : hovered ? 30 : focused ? 40 : 1),
    })
    layout(g, 320, 600)
    FocusManager.instance.setFocus(g)
    for (let step = 0; step < 36; step++) {
      if (step % 6 === 0) g.beginEdit(rows[step % rows.length]!, 'id')
      if (step % 6 === 3) g.cancelEdit()
      g.interaction.setHoveredItem((step * 5) % rows.length)
      g.setSelectedRows(rows.filter(row => (row.id * 3 + step) % 7 < step % 5))
      layout(g, 320, 600)
      const incremental = rows.map((_, i) => g.viewport.rowHeightAt(i))
      g.resolveRowStyle = () => undefined
      layout(g, 320, 600)
      expect(rows.map((_, i) => g.viewport.rowHeightAt(i))).toEqual(incremental)
      expect(g.viewport.rowOffset(rows.length)).toBe(incremental.reduce((a, b) => a + b, 0))
    }
  })
  it.each([false, true])('respects a later user wheel input with pendingReveal=%s', pending => {
    const rows = Array.from({ length: 100 }, (_, id) => ({ id, text: 'short' }))
    const g = grid({ rows })
    layout(g)
    g.selectCell(rows[99]!, 'text', { scroll: true })
    layout(g)
    g.setCellValue(rows[0]!, 'text', 'long '.repeat(100))
    if (pending) g.selectCell(rows[99]!, 'text', { scroll: true })
    expect(g.onWheel({ pointerId: 0, position: { x: 20, y: 60 }, type: 'wheel', deltaX: 0, deltaY: -1 })).toBe(true)
    const expectedTopRow = g.viewport.rowIndexAtOffset(g.viewport.scrollY, 100)
    layout(g)
    const topRow = g.viewport.rowIndexAtOffset(g.viewport.scrollY, 100)
    expect(topRow).toBe(expectedTopRow)
  })

  it('provides a full tooltip for clipped sticky merge text without an ellipsis', () => {
    const text = 'line-0\nline-1\nline-2'
    const g = grid({ cellTextOverflow: 'clip', rows: [
      ...Array.from({ length: 5 }, (_, id) => ({ id, text })),
      ...Array.from({ length: 20 }, (_, id) => ({ id: id + 5, text: `tail-${id}` })),
    ], columns: [{ key: 'text', title: 'Text', type: 'text', width: 100, autoRowHeight: true, mergeRows: true }] })
    layout(g)
    g.viewport.setScrollY(25, g.viewport.rowOffset(5) - 28)
    const texts = paint(g).mock.calls.filter(call => Number(call[2]) >= 24 && Number(call[2]) < 52).map(call => call[0])
    expect(texts).toEqual(['line-0'])
    g.onPointerMove({ pointerId: 0, position: { x: 30, y: 30 }, type: 'move' })
    expect(g.tooltip).toBe(text)
  })

  it.each([false, true])('keeps a pending reveal for a wheel event outside the grid or without movement (outside=%s)', outside => {
    const g = grid({ rows: [{ id: 1, text: 'short' }] })
    layout(g)
    const added = Array.from({ length: 100 }, (_, i) => ({ id: i + 2, text: 'short' }))
    g.addRows(added)
    g.selectCell(added[99]!, 'text', { scroll: true })
    g.onWheel({ pointerId: 0, type: 'wheel', position: outside ? { x: -20, y: -20 } : { x: 30, y: 30 },
      deltaX: 0, deltaY: outside ? -1 : 0 })
    layout(g)
    const rect = g.editingGeometry.cellGlobalRect(100, 0)
    expect(rect.y).toBeGreaterThanOrEqual(24)
    expect(rect.y + rect.h).toBeLessThanOrEqual(24 + g.viewport.viewHeight)
  })

  it.each(['track', 'thumb'] as const)('a later scrollbar %s interaction cancels a pending reveal', kind => {
    const rows = Array.from({ length: 100 }, (_, id) => ({ id, text: 'short' }))
    const g = grid({ rows })
    layout(g)
    g.setCellValue(rows[0]!, 'text', 'long '.repeat(100))
    g.selectCell(rows[99]!, 'text', { scroll: true })
    const geometry = g.viewport.vScrollbarGeometry({ x: 0, y: 0 }, rows.length)
    const rect = kind === 'track' ? geometry.trackRect : geometry.thumbRect
    const point = { x: rect.x + rect.width / 2, y: kind === 'track' ? rect.y + 1 : rect.y + rect.height / 2 }
    g.onPointerDown({ pointerId: 1, type: 'down', button: 0, position: point })
    if (kind === 'thumb') g.onPointerMove({ pointerId: 1, type: 'move', position: { x: point.x, y: point.y - 40 } })
    const expectedTopRow = g.viewport.rowIndexAtOffset(g.viewport.scrollY, rows.length)
    expect(expectedTopRow).toBeLessThan(94)
    layout(g)
    expect(g.viewport.rowIndexAtOffset(g.viewport.scrollY, rows.length)).toBe(expectedTopRow)
    g.onPointerUp({ pointerId: 1, type: 'up', button: 0, position: point })
  })

})
