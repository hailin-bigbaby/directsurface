// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { PopupManager } from '../core/popup_manager'
import { PaintContext } from '../rendering/paint_context'
import { DrawList } from '../rendering/draw_list'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { RenderTreeGrid } from './tree_grid'

afterEach(() => {
  PopupManager.disposeInstance()
  InputComposer.disposeInstance()
  FocusManager.disposeInstance()
  vi.restoreAllMocks()
})

function paintTreeGrid<T extends Record<string, any>>(grid: RenderTreeGrid<T>): string[] {
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
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn((value) => {
      textCalls.push(String(value))
    }),
    measureText: vi.fn(text => ({ width: Array.from(String(text)).length * 8 }) as TextMetrics),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    set fillStyle(value: unknown) { fillStyle = value },
    get fillStyle() { return fillStyle as string },
    set strokeStyle(value: unknown) { strokeStyle = value },
    get strokeStyle() { return strokeStyle as string },
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  grid.paint(new PaintContext(ctx, ImGuiDarkTheme), { x: 0, y: 0 })
  return textCalls
}

describe('TreeGrid border ownership', () => {
  it('does not paint a custom outline for a column clipped to less than its insets', () => {
    const color = { r: 240, g: 0, b: 0, a: 1 }
    const grid = new RenderTreeGrid({
      columns: [
        { key: 'name', title: 'Name', type: 'text', width: 70, pinned: 'left' },
        { key: 'code', title: 'Code', type: 'text', width: 100 },
        { key: 'more', title: 'More', type: 'text', width: 200 },
        { key: 'tail', title: 'Tail', type: 'text', width: 60, pinned: 'right' },
      ],
      roots: [{ key: 'a', row: { name: 'A', code: 'B', more: 'C', tail: 'D' } }],
      treeColumnKey: 'name', resolveCellStyle: ({ column }) => column.key === 'code' ? { borderColor: color } : {},
    })
    grid.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 160 })
    const viewport = (grid as any)._viewport
    viewport.setScrollX(grid.columns, 98.5)
    expect(viewport.visibleCellRect(grid.columns, 0, 1).w).toBe(1.5)
    const borders = vi.spyOn(DrawList.prototype, 'strokeRect')
    paintTreeGrid(grid)
    expect(borders.mock.calls.filter(call => call[4] === color)).toHaveLength(0)
    grid.dispose()
  })
  it('keeps custom cell fills below shared edges and state borders', () => {
    const color = { r: 200, g: 20, b: 20, a: 1 }
    const grid = new RenderTreeGrid({
      columns: [{ key: 'name', title: 'Name', type: 'text', width: 100 }, { key: 'code', title: 'Code', type: 'text', width: 220 }],
      roots: [0, 1, 2].map(i => ({ key: String(i), row: { name: 'Name', code: String(i) } })),
      treeColumnKey: 'name', rowHeight: 24, headerHeight: 24, editable: true,
      resolveCellStyle: () => ({ backgroundColor: ImGuiDarkTheme.surfaceControl, borderColor: color }),
    })
    grid.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 160 })
    expect(grid.beginEdit(1, 'code')).toBe(true)
    const fills = vi.spyOn(DrawList.prototype, 'fillRect')
    const borders = vi.spyOn(DrawList.prototype, 'strokeRect')
    const gridLines = vi.spyOn(DrawList.prototype, 'strokeSegments')
    paintTreeGrid(grid)
    expect(borders.mock.calls.filter(call => call[5] === 0.5)).toHaveLength(0)
    const stateOrders = borders.mock.calls.flatMap((call, i) => call[4] === color ? [borders.mock.invocationCallOrder[i]!] : [])
    expect(stateOrders.length).toBeGreaterThan(0)
    expect(Math.min(...stateOrders)).toBeGreaterThan(Math.max(...gridLines.mock.invocationCallOrder))
    expect(borders.mock.invocationCallOrder.at(-1)).toBeGreaterThan(Math.max(...fills.mock.invocationCallOrder))
    grid.dispose()
  })

  it('draws each frozen boundary once while both sides stay pinned', () => {
    const grid = new RenderTreeGrid({
      columns: [{ key: 'name', title: 'Name', type: 'text', width: 70, pinned: 'left' },
        { key: 'code', title: 'Code', type: 'text', width: 240 },
        { key: 'tail', title: 'Tail', type: 'text', width: 60, pinned: 'right' }],
      roots: [{ key: 'a', row: { name: 'A', code: 'B', tail: 'C' } }], treeColumnKey: 'name',
    })
    grid.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 160 })
    const lines = vi.spyOn(DrawList.prototype, 'line')
    const segments = vi.spyOn(DrawList.prototype, 'strokeSegments')
    paintTreeGrid(grid)
    const dividers = lines.mock.calls.filter(([x1, y1, x2, y2, , width]) => x1 === x2 && y1 === 0 && y2 > 100 && width === 1)
    expect(dividers).toHaveLength(2)
    for (const divider of dividers) expect(segments.mock.calls.flatMap(([s]) => s).some(edge => edge.x1 === divider[0] && edge.x2 === divider[0])).toBe(false)
    grid.dispose()
  })
})
