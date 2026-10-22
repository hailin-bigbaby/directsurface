import { afterEach, describe, expect, it, vi } from 'vitest'
import { PipelineOwner, type BoxConstraints } from '../core/render_object'
import { PaintContext } from '../rendering/paint_context'
import { DrawList } from '../rendering/draw_list'
import { KeyboardBindingController } from '../core/keyboard_binding_controller'
import { TextMeasurer } from '../core/text_measurer'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../theme/default_theme'
import { deriveTableRowStyle, resolveBgColor, resolveTextColor } from '../theme/component_styles'
import { colorToCSS } from '../theme/theme'
import { RenderTable, type TableColumn } from './table'

interface RowData {
  id: number
  name: string
}

const columns: TableColumn<RowData>[] = [
  { key: 'id', title: 'ID', width: 50, sortable: true },
  { key: 'name', title: 'Name', sortable: false },
]

const rows: RowData[] = [
  { id: 3, name: 'Gamma' },
  { id: 1, name: 'Alpha' },
  { id: 5, name: 'Epsilon' },
  { id: 2, name: 'Beta' },
  { id: 4, name: 'Delta' },
]

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 160,
  minHeight: 0,
  maxHeight: 100,
}

function layout<T extends Record<string, any>>(
  table: RenderTable<T>,
  width = 120,
  height = 100,
  theme = ImGuiDarkTheme,
): void {
  table.layout({ minWidth: 0, maxWidth: width, minHeight: 0, maxHeight: height }, false, { theme })
}

function paintTable(
  table: RenderTable<RowData>,
  theme = ImGuiDarkTheme,
): { fillStyles: string[]; strokeStyles: string[]; textStyles: string[]; textCalls: string[] } {
  const fillStyles: string[] = []
  const strokeStyles: string[] = []
  const textStyles: string[] = []
  const textCalls: string[] = []
  let fillStyle: unknown = ''
  let strokeStyle: unknown = ''
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(() => {
      if (typeof fillStyle === 'string' && fillStyle) fillStyles.push(fillStyle)
    }),
    stroke: vi.fn(() => {
      if (typeof strokeStyle === 'string' && strokeStyle) strokeStyles.push(strokeStyle)
    }),
    fillRect: vi.fn(() => {
      if (typeof fillStyle === 'string' && fillStyle) fillStyles.push(fillStyle)
    }),
    strokeRect: vi.fn(() => {
      if (typeof strokeStyle === 'string' && strokeStyle) strokeStyles.push(strokeStyle)
    }),
    fillText: vi.fn((value) => {
      if (typeof fillStyle === 'string' && fillStyle) textStyles.push(fillStyle)
      textCalls.push(String(value))
    }),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    set fillStyle(value: unknown) { fillStyle = value },
    get fillStyle() { return fillStyle as string },
    set strokeStyle(value: unknown) { strokeStyle = value },
    get strokeStyle() { return strokeStyle as string },
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  table.paint(new PaintContext(ctx, theme), { x: 0, y: 0 })
  return { fillStyles, strokeStyles, textStyles, textCalls }
}

afterEach(() => {
  KeyboardBindingController.disposeInstance()
  vi.restoreAllMocks()
})

describe('RenderTable border ownership', () => {
  it.each(['normal', 'hover', 'selected', 'scrolled'] as const)('keeps one final perimeter above %s row backgrounds', state => {
    const table = new RenderTable<RowData>({ columns, rows, rowHeight: 20, headerHeight: 20 })
    layout(table, 160, 100)
    if (state === 'hover') table.onPointerMove({ pointerId: 0, type: 'move', position: { x: 15, y: 30 } })
    if (state === 'selected') table.setSelectedRows([0, 1])
    if (state === 'scrolled') table.onWheel({ pointerId: 0, type: 'wheel', position: { x: 15, y: 30 }, deltaX: 0, deltaY: 1 })
    const frame = vi.spyOn(DrawList.prototype, 'strokeRect')
    const fills = vi.spyOn(DrawList.prototype, 'fillRect')
    const lines = vi.spyOn(DrawList.prototype, 'line')
    paintTable(table)
    expect(frame.mock.calls.filter(([x, y]) => x === 0 && y === 0)).toHaveLength(1)
    expect(frame.mock.calls.every(args => args[5] === 1)).toBe(true)
    expect(frame).toHaveBeenCalledWith(0, 0, 160, 100, deriveTableRowStyle(ImGuiDarkTheme).windowBorder, 1, ImGuiDarkTheme.frameRounding)
    expect(frame.mock.invocationCallOrder.at(-1)).toBeGreaterThan(Math.max(...fills.mock.invocationCallOrder, ...lines.mock.invocationCallOrder))
    table.dispose()
  })

  it('draws each shared row boundary once after all body backgrounds', () => {
    const table = new RenderTable<RowData>({ columns, rows, rowHeight: 20, headerHeight: 20 })
    layout(table, 160, 160)
    const lines = vi.spyOn(DrawList.prototype, 'line')
    const fills = vi.spyOn(DrawList.prototype, 'fillRect')
    paintTable(table)
    const horizontal = lines.mock.calls.map((args, i) => ({ args, order: lines.mock.invocationCallOrder[i]! }))
      .filter(({ args: [x1, y1, x2, y2] }) => x1 === 0 && x2 > x1 && y1 === y2)
    expect(horizontal.map(({ args }) => args[1]).sort((a, b) => a - b)).toEqual([20, 40, 60, 80, 100, 120])
    const stripeOrders = fills.mock.calls.flatMap((args, i) => args[4] === deriveTableRowStyle(ImGuiDarkTheme).stripeBg ? [fills.mock.invocationCallOrder[i]!] : [])
    expect(stripeOrders.length).toBe(2)
    expect(Math.min(...horizontal.map(line => line.order))).toBeGreaterThan(Math.max(...stripeOrders))
    table.dispose()
  })

  it('does not invent a cell border at the viewport edge when columns are partially scrolled', () => {
    const table = new RenderTable<RowData>({ columns: [{ key: 'id', title: 'ID', width: 80 }, { key: 'name', title: 'Name', width: 200 }], rows, rowHeight: 20, headerHeight: 20 })
    layout(table, 160, 100)
    table.onWheel({ pointerId: 0, type: 'wheel', position: { x: 15, y: 30 }, deltaX: 1, deltaY: 1 })
    expect(table.debugState().scrollX).toBe(60)
    expect(table.debugState().scrollY).toBeGreaterThan(0)
    const lines = vi.spyOn(DrawList.prototype, 'line')
    paintTable(table)
    const vertical = lines.mock.calls.filter(([x1, y1, x2, y2]) => x1 === x2 && y2 > y1)
    expect(vertical.map(args => args[0])).toEqual([20, 20])
    table.dispose()
  })

  it.each([20, 20.2])('keeps the header boundary single when scrolling by complete rows with header height %s', headerHeight => {
    const table = new RenderTable<RowData>({ columns, rows: [...rows, ...rows], rowHeight: 20, headerHeight })
    layout(table, 160, 100)
    table.onWheel({ pointerId: 0, type: 'wheel', position: { x: 15, y: 30 }, deltaX: 0, deltaY: 1 })
    expect(table.debugState().scrollY).toBe(60)
    const lines = vi.spyOn(DrawList.prototype, 'line')
    paintTable(table)
    expect(lines.mock.calls.filter(([x1, y1, x2, y2]) => x1 === 0 && x2 > 0 && Math.abs(y1 - headerHeight) < 1e-9 && y1 === y2)).toHaveLength(1)
    table.dispose()
  })

  it('keeps the keyboard row focus above the grid and inside the frame', () => {
    const table = new RenderTable<RowData>({ columns, rows, rowHeight: 20, headerHeight: 20 })
    layout(table, 160, 100)
    table.setSelectedRows([1])
    const frames = vi.spyOn(DrawList.prototype, 'strokeRect')
    const lines = vi.spyOn(DrawList.prototype, 'line')
    paintTable(table)
    const focusIndex = frames.mock.calls.findIndex(([x, y]) => x === 1 && y === 41)
    expect(focusIndex).toBeGreaterThanOrEqual(0)
    const bodyGridOrders = lines.mock.calls.flatMap((args, i) => args[1] > 20 || args[3] > 20 ? [lines.mock.invocationCallOrder[i]!] : [])
    expect(frames.mock.invocationCallOrder[focusIndex]).toBeGreaterThan(Math.max(...bodyGridOrders))
    table.dispose()
  })

  it('keeps the column resize guide above header separators', () => {
    const table = new RenderTable<RowData>({ columns, rows, rowHeight: 20, headerHeight: 20 })
    layout(table, 160, 100)
    table.onPointerDown({ pointerId: 0, type: 'down', position: { x: 50, y: 10 } })
    const lines = vi.spyOn(DrawList.prototype, 'line')
    paintTable(table)
    const header = lines.mock.calls.filter(([x1, y1, x2, y2]) => x1 === 50 && x2 === 50 && y1 === 0 && y2 === 20)
    expect(header.map(args => args[5])).toEqual([0.5, 2])
    table.dispose()
  })
})

describe('RenderTable interactions', () => {
  it('does not let measure layout clamp the real scroll state', () => {
    const table = new RenderTable<RowData>({
      columns,
      rows: Array.from({ length: 30 }, (_, index) => ({ id: index, name: `Row ${index}` })),
      rowHeight: 20,
      headerHeight: 20,
    })

    layout(table, 160, 80)
    table.onWheel({ pointerId: 0, position: { x: 20, y: 50 }, type: 'wheel', deltaX: 0, deltaY: 1 })
    const before = table.debugState().scrollY

    table.measure({ minWidth: 0, maxWidth: 160, minHeight: 0, maxHeight: 900 }, { theme: ImGuiDarkTheme })

    expect(before).toBeGreaterThan(0)
    expect(table.debugState().scrollY).toBe(before)
  })

  it('ellipsizes overflowing body cell text and exposes the full text as tooltip', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(String(text)).length * 8)
    const table = new RenderTable<RowData>({
      columns: [{ key: 'name', title: 'Name', width: 56 }],
      rows: [{ id: 1, name: 'Alphabet' }],
      rowHeight: 20,
      headerHeight: 20,
    })

    layout(table, 100, 60)
    const painted = paintTable(table)

    expect(painted.textCalls).toContain('Al...')
    expect(painted.textCalls).not.toContain('Alphabet')

    table.onPointerMove({ pointerId: 0, position: { x: 10, y: 30 }, type: 'move' })
    expect(table.tooltip).toBe('Alphabet')

    table.onPointerLeave({ pointerId: 0, position: { x: 120, y: 30 }, type: 'move' })
    expect(table.tooltip).toBeUndefined()
  })

  it('ellipsizes overflowing header text', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(String(text)).length * 8)
    const table = new RenderTable<RowData>({
      columns: [{ key: 'name', title: 'Alphabet', width: 56 }],
      rows: [],
      rowHeight: 20,
      headerHeight: 20,
    })

    layout(table, 100, 40)
    const painted = paintTable(table)

    expect(painted.textCalls).toContain('Al...')
    expect(painted.textCalls).not.toContain('Alphabet')
  })

  it('keeps clipped body text when table overflow is configured as clip', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(String(text)).length * 8)
    const table = new RenderTable<RowData>({
      columns: [{ key: 'name', title: 'Name', width: 56 }],
      rows: [{ id: 1, name: 'Alphabet' }],
      rowHeight: 20,
      headerHeight: 20,
      cellTextOverflow: 'clip',
    })

    layout(table, 100, 60)
    const painted = paintTable(table)

    expect(painted.textCalls).toContain('Alphabet')
    expect(painted.textCalls).not.toContain('Al...')
  })

  it('applies height constraints on the table itself', () => {
    const table = new RenderTable<RowData>({
      columns,
      rows,
      height: 180,
      minHeight: 120,
      maxHeight: 260,
    })

    table.layout({ minWidth: 0, maxWidth: 160, minHeight: 0, maxHeight: Infinity }, false, { theme: ImGuiDarkTheme })

    expect(table.height).toBe(180)
    expect(table.size.height).toBe(180)

    table.height = undefined
    table.maxHeight = undefined
    table.minHeight = 360
    table.layout({ minWidth: 0, maxWidth: 160, minHeight: 0, maxHeight: Infinity }, false, { theme: ImGuiDarkTheme })
    expect(table.size.height).toBe(360)

    table.minHeight = undefined
    table.maxHeight = 160
    table.layout({ minWidth: 0, maxWidth: 160, minHeight: 0, maxHeight: Infinity }, false, { theme: ImGuiDarkTheme })
    expect(table.size.height).toBe(160)

    table.layout({ minWidth: 0, maxWidth: 160, minHeight: 0, maxHeight: 140 }, false, { theme: ImGuiDarkTheme })
    expect(table.size.height).toBe(140)
  })

  it('selects rows and calls onRowClick with row and index', () => {
    const onRowClick = vi.fn()
    const table = new RenderTable<RowData>({
      columns,
      rows,
      rowHeight: 20,
      headerHeight: 20,
      onRowClick,
    })
    layout(table)

    table.onPointerDown({ pointerId: 0, position: { x: 10, y: 45 }, type: 'down' })

    expect(onRowClick).toHaveBeenCalledWith(rows[1], 1)
    expect(table.selectedRows.has(1)).toBe(true)
  })

  it('does not treat scrollbar gutters as table rows', () => {
    const onRowClick = vi.fn()
    const table = new RenderTable<RowData>({
      columns,
      rows: rows.slice(0, 2),
      rowHeight: 20,
      headerHeight: 20,
      onRowClick,
    })
    layout(table, 120, 100)

    table.onPointerDown({ pointerId: 0, position: { x: 10, y: 95 }, type: 'down' })
    table.onPointerDown({ pointerId: 0, position: { x: 118, y: 45 }, type: 'down' })

    expect(onRowClick).not.toHaveBeenCalled()
    expect(table.selectedRows.size).toBe(0)
  })

  it('captures scrollbar drags and stops parent scroll gestures', () => {
    const table = new RenderTable<RowData>({
      columns,
      rows: Array.from({ length: 40 }, (_, index) => ({
        id: index,
        name: `Row ${index}`,
      })),
      rowHeight: 20,
      headerHeight: 20,
    })
    layout(table, 140, 80)
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const stopPropagation = vi.fn()
    const scrollbarX = table.size.width - 7
    const scrollbarY = table.debugState().headerHeight + 10

    table.onPointerDown({
      pointerId: 1,
      position: { x: scrollbarX, y: scrollbarY },
      type: 'down',
      setPointerCapture,
      releasePointerCapture,
      stopPropagation,
    })
    table.onPointerMove({
      pointerId: 1,
      position: { x: scrollbarX, y: scrollbarY + 30 },
      type: 'move',
      stopPropagation,
    })
    table.onPointerUp({
      pointerId: 1,
      position: { x: scrollbarX, y: scrollbarY + 30 },
      type: 'up',
      releasePointerCapture,
      stopPropagation,
    })

    expect(setPointerCapture).toHaveBeenCalledTimes(1)
    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
    expect(stopPropagation).toHaveBeenCalled()
    expect(table.debugState().scrollY).toBeGreaterThan(0)
  })

  it('extends row selection with Shift+Click', () => {
    const table = new RenderTable<RowData>({
      columns,
      rows,
      rowHeight: 20,
      headerHeight: 20,
    })
    layout(table)

    table.onPointerDown({ pointerId: 0, position: { x: 10, y: 45 }, type: 'down' })
    table.onPointerDown({ pointerId: 0, position: { x: 10, y: 85 }, type: 'down', shiftKey: true })

    expect([...table.selectedRows].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('supports Ctrl+A and Shift+Arrow range selection from keyboard', () => {
    const table = new RenderTable<RowData>({
      columns,
      rows,
      rowHeight: 20,
      headerHeight: 20,
    })
    layout(table)

    table.onPointerDown({ pointerId: 0, position: { x: 10, y: 25 }, type: 'down' })
    table.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }))

    expect([...table.selectedRows].sort((a, b) => a - b)).toEqual([0, 1])

    table.onKeyDown(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }))

    expect([...table.selectedRows].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
  })

  it('uses the sorted row order for visible row clicks', () => {
    const onRowClick = vi.fn()
    const table = new RenderTable<RowData>({
      columns,
      rows,
      rowHeight: 20,
      headerHeight: 20,
      onRowClick,
    })
    layout(table)

    table.onPointerDown({ pointerId: 0, position: { x: 10, y: 10 }, type: 'down' })
    table.onPointerDown({ pointerId: 0, position: { x: 10, y: 25 }, type: 'down' })

    expect(onRowClick).toHaveBeenCalledWith({ id: 1, name: 'Alpha' }, 0)
  })

  it('cycles sortable header order and ignores non-sortable headers', () => {
    const onSortChange = vi.fn()
    const table = new RenderTable<RowData>({
      columns,
      rows,
      rowHeight: 20,
      headerHeight: 20,
      onSortChange,
    })
    layout(table)

    table.onPointerDown({ pointerId: 0, position: { x: 10, y: 10 }, type: 'down' })
    table.onPointerDown({ pointerId: 0, position: { x: 10, y: 10 }, type: 'down' })
    table.onPointerDown({ pointerId: 0, position: { x: 10, y: 10 }, type: 'down' })
    table.onPointerDown({ pointerId: 0, position: { x: 80, y: 10 }, type: 'down' })

    expect(onSortChange).toHaveBeenNthCalledWith(1, { key: 'id', order: 'asc' })
    expect(onSortChange).toHaveBeenNthCalledWith(2, { key: 'id', order: 'desc' })
    expect(onSortChange).toHaveBeenNthCalledWith(3, { key: 'id', order: null })
    expect(onSortChange).toHaveBeenCalledTimes(3)
  })

  it('does not sort when clicking the scrollbar header gutter', () => {
    const onSortChange = vi.fn()
    const table = new RenderTable<RowData>({
      columns,
      rows,
      rowHeight: 20,
      headerHeight: 20,
      onSortChange,
    })
    layout(table)

    table.onPointerDown({ pointerId: 0, position: { x: 118, y: 10 }, type: 'down' })

    expect(onSortChange).not.toHaveBeenCalled()
  })

  it('clamps wheel scrolling', () => {
    const table = new RenderTable<RowData>({
      columns,
      rows,
      rowHeight: 20,
      headerHeight: 20,
    })
    layout(table)

    for (let i = 0; i < 10; i++) {
      table.onWheel({ pointerId: 0, position: { x: 10, y: 50 }, type: 'wheel', deltaX: 0, deltaY: 1 })
    }

    expect(table.debugState().scrollY).toBe(34)

    for (let i = 0; i < 10; i++) {
      table.onWheel({ pointerId: 0, position: { x: 10, y: 50 }, type: 'wheel', deltaX: 0, deltaY: -1 })
    }

    expect(table.debugState().scrollY).toBe(0)
  })

  it('does not consume wheel when the table does not overflow', () => {
    const table = new RenderTable<RowData>({
      columns,
      rows: rows.slice(0, 1),
      rowHeight: 20,
      headerHeight: 20,
    })
    layout(table)

    const consumed = table.onWheel({
      pointerId: 0,
      position: { x: 10, y: 50 },
      type: 'wheel',
      deltaX: 0,
      deltaY: 1,
    })

    expect(consumed).toBe(false)
    expect(table.debugState().scrollY).toBe(0)
  })

  it('contains wheel events at scroll boundaries when the table overflows', () => {
    const table = new RenderTable<RowData>({
      columns,
      rows,
      rowHeight: 20,
      headerHeight: 20,
    })
    layout(table)

    const topConsumed = table.onWheel({
      pointerId: 0,
      position: { x: 10, y: 50 },
      type: 'wheel',
      deltaX: 0,
      deltaY: -1,
    })
    expect(topConsumed).toBe(true)
    expect(table.debugState().scrollY).toBe(0)

    for (let i = 0; i < 10; i++) {
      table.onWheel({ pointerId: 0, position: { x: 10, y: 50 }, type: 'wheel', deltaX: 0, deltaY: 1 })
    }
    const bottom = table.debugState().scrollY
    const bottomConsumed = table.onWheel({
      pointerId: 0,
      position: { x: 10, y: 50 },
      type: 'wheel',
      deltaX: 0,
      deltaY: 1,
    })

    expect(bottomConsumed).toBe(true)
    expect(table.debugState().scrollY).toBe(bottom)
  })

  it('uses the shared scroll controller for scrollbar drag clamping', () => {
    const table = new RenderTable<RowData>({
      columns,
      rows,
      rowHeight: 20,
      headerHeight: 20,
    })
    layout(table)

    table.onPointerDown({ pointerId: 0, position: { x: 115, y: 30 }, type: 'down' })
    table.onPointerMove({ pointerId: 0, position: { x: 115, y: 500 }, type: 'move' })

    expect(table.debugState().scrollY).toBe(34)

    table.onPointerUp({ pointerId: 0, position: { x: 115, y: 500 }, type: 'up' })
  })

  it('supports horizontal wheel scrolling when columns overflow', () => {
    type WideRow = RowData & { extra: string }
    const table = new RenderTable<WideRow>({
      columns: [
        { key: 'id', title: 'ID', width: 80, sortable: true },
        { key: 'name', title: 'Name', width: 120 },
        { key: 'extra', title: 'Extra', width: 120 },
      ],
      rows: rows.map(row => ({ ...row, extra: `Extra ${row.id}` })),
      rowHeight: 20,
      headerHeight: 20,
    })
    layout(table, 150, 100)
    const maxScrollX = Math.max(0, 320 - (150 - ImGuiDarkTheme.scrollbarSize))

    for (let i = 0; i < 10; i++) {
      table.onWheel({ pointerId: 0, position: { x: 20, y: 50 }, type: 'wheel', deltaX: 1, deltaY: 0 })
    }

    expect(table.debugState().scrollX).toBe(maxScrollX)
    table.dispose()
  })

  it('resizes columns by dragging the header separator', () => {
    const table = new RenderTable<RowData>({
      columns,
      rows,
      rowHeight: 20,
      headerHeight: 20,
    })
    layout(table, 160, 100)
    const before = table.debugState().colWidths

    table.onPointerDown({ pointerId: 0, position: { x: 50, y: 10 }, type: 'down' })
    table.onPointerMove({ pointerId: 0, position: { x: 80, y: 10 }, type: 'move' })
    table.onPointerUp({ pointerId: 0, position: { x: 80, y: 10 }, type: 'up' })

    const after = table.debugState().colWidths
    expect(after[0]).toBeGreaterThan(before[0]!)
    expect(after[0]).toBe(80)

    table.dispose()
  })

  it('resizes the last column from its right header edge', () => {
    const table = new RenderTable<RowData>({
      columns: [
        { key: 'id', title: 'ID', width: 50 },
        { key: 'name', title: 'Name', width: 70 },
      ],
      rows,
      rowHeight: 20,
      headerHeight: 20,
    })
    layout(table, 180, 100)

    table.onPointerDown({ pointerId: 0, position: { x: 120, y: 10 }, type: 'down' })
    table.onPointerMove({ pointerId: 0, position: { x: 145, y: 10 }, type: 'move' })

    expect(table.debugState().colWidths[1]).toBe(70)

    table.onPointerUp({ pointerId: 0, position: { x: 145, y: 10 }, type: 'up' })

    expect(table.needsPaint).toBe(true)

    layout(table, 180, 100)

    expect(table.debugState().colWidths[1]).toBe(95)

    table.dispose()
  })

  it('paints an active resize indicator while dragging a header separator', () => {
    const table = new RenderTable<RowData>({
      columns,
      rows,
      rowHeight: 20,
      headerHeight: 20,
    })
    const style = deriveTableRowStyle(ImGuiLightTheme)
    layout(table, 160, 100, ImGuiLightTheme)

    table.onPointerDown({ pointerId: 0, position: { x: 50, y: 10 }, type: 'down' })
    const painted = paintTable(table, ImGuiLightTheme)

    expect(painted.strokeStyles).toContain(colorToCSS(style.focusedBorder))

    table.dispose()
  })

  it('does not click rows when empty', () => {
    const onRowClick = vi.fn()
    const table = new RenderTable<RowData>({
      columns,
      rows: [],
      rowHeight: 20,
      headerHeight: 20,
      onRowClick,
    })
    layout(table)

    table.onPointerDown({ pointerId: 0, position: { x: 10, y: 45 }, type: 'down' })

    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('unbinds keyboard routing on dispose', () => {
    const onRowClick = vi.fn()
    const table = new RenderTable<RowData>({
      columns,
      rows,
      rowHeight: 20,
      headerHeight: 20,
      onRowClick,
    })
    layout(table)

    table.onPointerDown({ pointerId: 0, position: { x: 10, y: 45 }, type: 'down' })
    table.dispose()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))

    expect(onRowClick).toHaveBeenCalledTimes(1)
  })

  it('clears hover on pointer leave without using cancel semantics', () => {
    const table = new RenderTable<RowData>({
      columns,
      rows,
      rowHeight: 20,
      headerHeight: 20,
    })
    layout(table)

    table.onPointerMove({ pointerId: 0, position: { x: 10, y: 45 }, type: 'move' })
    expect(table.debugState().hoveredRow).toBe(1)

    table.onPointerLeave({ pointerId: 0, position: { x: 200, y: 45 }, type: 'move' })

    expect(table.debugState().hoveredRow).toBe(-1)
    table.dispose()
  })
})

describe('RenderTable theme contexts', () => {
  it('re-derives layout metrics from the pipeline theme context', () => {
    const owner = new PipelineOwner({}, ImGuiDarkTheme)
    const table = new RenderTable<RowData>({ columns, rows })

    table.attach(owner)
    table.layout(constraints)

    const nextTheme = {
      ...ImGuiLightTheme,
      fontSize: ImGuiLightTheme.fontSize + 2,
      dataRowHeight: ImGuiLightTheme.dataRowHeight + 4,
      dataHeaderHeight: ImGuiLightTheme.dataHeaderHeight + 4,
    }
    owner.setTheme(nextTheme)
    table.markNeedsLayout()
    owner.flushLayout()

    expect(table.debugState().rowHeight).toBe(nextTheme.dataRowHeight)
    expect(table.debugState().headerHeight).toBe(nextTheme.dataHeaderHeight)

    table.dispose()
  })

  it('recomputes theme-derived row and header heights when relaid out with a new theme context', () => {
    const table = new RenderTable<RowData>({ columns, rows })
    layout(table, 120, 100, ImGuiDarkTheme)
    const before = table.debugState()

    layout(table, 120, 100, {
      ...ImGuiLightTheme,
      fontSize: ImGuiLightTheme.fontSize + 2,
      dataRowHeight: ImGuiLightTheme.dataRowHeight + 4,
      dataHeaderHeight: ImGuiLightTheme.dataHeaderHeight + 4,
    })
    const after = table.debugState()

    expect(after.rowHeight).toBeGreaterThan(before.rowHeight)
    expect(after.headerHeight).toBeGreaterThan(before.headerHeight)
    table.dispose()
  })

  it('preserves explicit row and header heights across relayout with a new theme context', () => {
    const table = new RenderTable<RowData>({
      columns,
      rows,
      rowHeight: 20,
      headerHeight: 24,
    })

    layout(table, 120, 100, ImGuiDarkTheme)
    layout(table, 120, 100, { ...ImGuiLightTheme, fontSize: ImGuiLightTheme.fontSize + 3 })

    expect(table.rowHeight).toBe(20)
    expect(table.headerHeight).toBe(24)
    table.dispose()
  })

  it('uses token-derived header, row, and focus colors while painting', () => {
    const table = new RenderTable<RowData>({
      columns,
      rows,
      rowHeight: 20,
      headerHeight: 20,
    })
    const style = deriveTableRowStyle(ImGuiLightTheme)
    layout(table, 120, 100, ImGuiLightTheme)
    table.sortState = { key: 'id', order: 'asc' }
    table.selectedRows.add(1)
    ;(table as any)._hoveredRow = 0
    ;(table as any)._focusedRow = 0

    const painted = paintTable(table, ImGuiLightTheme)

    expect(painted.fillStyles).toContain(colorToCSS(resolveBgColor(style.headerBgState, 'selected')))
    expect(painted.fillStyles).toContain(colorToCSS(resolveTextColor(style.headerArrowText, 'selected')))
    expect(painted.fillStyles).toContain(colorToCSS(resolveBgColor(style.rowBgState, 'hovered')))
    expect(painted.fillStyles).toContain(colorToCSS(resolveBgColor(style.rowBgState, 'selected')))
    expect(painted.strokeStyles).toContain(colorToCSS(resolveBgColor(style.rowBorderState, 'focused')))
    expect(painted.strokeStyles).toContain(colorToCSS(style.cellSeparatorColor))
    expect(painted.strokeStyles).toContain(colorToCSS(style.rowSeparatorColor))

    table.dispose()
  })

  it('passes the active theme and resolved row state to custom cell colors', () => {
    const renderColor = vi.fn((_value, _row, context) => context.theme.textPrimary)
    const table = new RenderTable<RowData>({
      columns: [
        { key: 'id', title: 'ID', width: 50 },
        { key: 'name', title: 'Name', renderColor },
      ],
      rows,
      rowHeight: 20,
      headerHeight: 20,
    })
    const style = deriveTableRowStyle(ImGuiLightTheme)
    layout(table, 120, 100, ImGuiLightTheme)
    table.selectedRows.add(0)
    ;(table as any)._hoveredRow = 0
    ;(table as any)._focusedRow = 0

    paintTable(table, ImGuiLightTheme)

    expect(renderColor).toHaveBeenCalledWith(rows[0]!.name, rows[0], expect.objectContaining({
      theme: ImGuiLightTheme,
      backgroundColor: resolveBgColor(style.rowBgState, {
        selected: true,
        hovered: true,
        focused: true,
      }),
      rowIndex: 0,
      columnIndex: 1,
      selected: true,
      hovered: true,
      focused: true,
    }))
    table.dispose()
  })
  it('reuses sorted rows and detects in-place values, ordering, length and source changes', () => {
    const data = [{ id: 3, name: 'c' }, { id: 1, name: 'a' }, { id: 1, name: 'b' }]
    const table = new RenderTable<RowData>({ columns, rows: data })
    table.sortState = { key: 'id', order: 'asc' }
    const internal = table as unknown as { _visibleRows(): RowData[]; _compareValues(a: unknown, b: unknown): number }
    const comparisons = vi.spyOn(internal, '_compareValues')
    expect(internal._visibleRows().map(row => row.name)).toEqual(['a', 'b', 'c'])
    comparisons.mockClear()
    expect(internal._visibleRows().map(row => row.name)).toEqual(['a', 'b', 'c'])
    expect(comparisons).not.toHaveBeenCalled()
    data[0]!.id = 0
    expect(internal._visibleRows().map(row => row.name)).toEqual(['c', 'a', 'b'])
    data.reverse()
    expect(internal._visibleRows().map(row => row.name)).toEqual(['c', 'b', 'a'])
    data.push({ id: -1, name: 'd' })
    expect(internal._visibleRows()[0]!.name).toBe('d')
    table.sortState = { key: 'id', order: 'desc' }
    expect(internal._visibleRows().map(row => row.name)).toEqual(['b', 'a', 'c', 'd'])
    table.rows = [{ id: 4, name: 'replacement' }]
    expect(internal._visibleRows().map(row => row.name)).toEqual(['replacement'])
    table.sortState = { key: '', order: null }
    expect(internal._visibleRows()).toBe(table.rows)
    table.dispose()
  })

})
