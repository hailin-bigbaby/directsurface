import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { PaintContext } from '../rendering/paint_context'
import { deriveListViewStyle, deriveScrollbarStyle } from '../theme/component_styles'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { RenderListView } from './list_view'

function createPaintContext(): {
  context: PaintContext
  fill: ReturnType<typeof vi.fn>
  stroke: ReturnType<typeof vi.fn>
  fillText: ReturnType<typeof vi.fn>
} {
  const fill = vi.fn()
  const stroke = vi.fn()
  const fillText = vi.fn()
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill,
    stroke,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText,
    measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
    strokeStyle: '',
    fillStyle: '',
    font: '',
    lineWidth: 1,
    lineCap: 'round' as CanvasLineCap,
    lineJoin: 'round' as CanvasLineJoin,
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, ImGuiDarkTheme), fill, stroke, fillText }
}

afterEach(() => {
  FocusManager.disposeInstance()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('RenderListView', () => {
  it('exposes selected item text for generic copy handling', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const items = [
      { key: 'inbox', label: '收件箱' },
      { key: 'today', label: '今日' },
    ]
    const list = new RenderListView({
      items,
      selectedItem: items[1],
      copyText: item => `${item.key}:${item.label}`,
    })

    expect(list.getCopyText()).toBe('today:今日')

    list.dispose()
  })

  it('applies height constraints on the list itself', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const list = new RenderListView({
      items: [
        { key: 'inbox', label: '收件箱' },
        { key: 'today', label: '今日' },
      ],
      height: 180,
      minHeight: 120,
      maxHeight: 260,
    })

    list.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: Infinity }, false, { theme: ImGuiDarkTheme })

    expect(list.height).toBe(180)
    expect(list.size.height).toBe(180)

    list.height = undefined
    list.maxHeight = undefined
    list.minHeight = 220
    list.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: Infinity }, false, { theme: ImGuiDarkTheme })
    expect(list.size.height).toBe(220)

    list.minHeight = undefined
    list.maxHeight = 160
    list.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: Infinity }, false, { theme: ImGuiDarkTheme })
    expect(list.size.height).toBe(160)

    list.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 140 }, false, { theme: ImGuiDarkTheme })
    expect(list.size.height).toBe(140)
  })

  it('lays out a fixed-size scrollable list', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const list = new RenderListView({
      items: [
        { key: 'inbox', label: '收件箱' },
        { key: 'today', label: '今日' },
      ],
    })

    list.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 180 }, false, { theme: ImGuiDarkTheme })

    expect(list.size.width).toBe(260)
    expect(list.size.height).toBe(180)
    expect(list.debugState().rowHeight).toBeGreaterThan(20)
  })

  it('selects and activates rows from keyboard focus', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const onSelect = vi.fn()
    const onActivate = vi.fn()
    const items = [
      { key: 'inbox', label: '收件箱' },
      { key: 'today', label: '今日' },
      { key: 'archive', label: '归档', disabled: true },
    ]
    const list = new RenderListView({
      items,
      onSelect,
      onActivate,
    })
    list.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 180 }, false, { theme: ImGuiDarkTheme })
    list.focusIn()

    expect(list.onKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() } as unknown as KeyboardEvent)).toBe(true)
    expect(list.onKeyDown({ key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent)).toBe(true)
    expect(list.selectedItem).toBe(items[1])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 'today' }), 1)
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ key: 'today' }), 1)
  })

  it('clears focus and blocks interactions when disabled dynamically', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const onSelect = vi.fn()
    const onActivate = vi.fn()
    const items = [
      { key: 'inbox', label: '收件箱' },
      { key: 'today', label: '今日' },
    ]
    const list = new RenderListView({
      items,
      selectedItem: items[0],
      onSelect,
      onActivate,
    })
    list.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 80 }, false, { theme: ImGuiDarkTheme })
    FocusManager.instance.setFocus(list)
    list.onPointerMove({ pointerId: 1, position: { x: 10, y: 10 }, type: 'move' })

    list.disabled = true

    expect(list.isFocused).toBe(false)
    expect(FocusManager.instance.current).toBeNull()
    expect(list.debugState().hoveredKey).toBe('')
    expect(list.debugState().focusedIndex).toBe(-1)
    expect(list.getCopyText()).toBeNull()
    expect(list.onKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() } as unknown as KeyboardEvent)).toBe(false)
    expect(list.onWheel({ pointerId: 1, position: { x: 10, y: 10 }, type: 'wheel', deltaX: 0, deltaY: 1 })).toBe(false)
    list.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })
    list.onPointerUp({ pointerId: 1, position: { x: 10, y: 10 }, type: 'up' })
    expect(onSelect).not.toHaveBeenCalled()
    expect(onActivate).not.toHaveBeenCalled()

    list.disabled = false
    FocusManager.instance.setFocus(list)
    expect(list.onKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() } as unknown as KeyboardEvent)).toBe(true)
    expect(list.debugState().focusedIndex).toBe(1)
  })

  it('accepts selectedItem instead of exposing key-based selection', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const items = [
      { key: 'inbox', label: '收件箱' },
      { key: 'today', label: '今日' },
      { key: 'archive', label: '归档', disabled: true },
    ]
    const list = new RenderListView({ items, selectedItem: items[1]! })

    expect(list.selectedItem).toBe(items[1])

    list.selectedItem = items[0]!
    expect(list.selectedItem).toBe(items[0])

    list.selectedItem = items[2]!
    expect(list.selectedItem).toBeNull()
  })

  it('paints panel chrome and row labels', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const list = new RenderListView({
      items: [
        { key: 'inbox', label: '收件箱', trailingText: '12', icon: 'bell' },
        { key: 'today', label: '今日' },
      ],
    })
    list.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 180 }, false, { theme: ImGuiDarkTheme })
    const painted = createPaintContext()

    list.paint(painted.context, { x: 0, y: 0 })

    expect(painted.fill).toHaveBeenCalled()
    expect(painted.stroke).toHaveBeenCalled()
    expect(painted.fillText).toHaveBeenCalledWith('收件箱', expect.any(Number), expect.any(Number))
    expect(painted.fillText).toHaveBeenCalledWith('12', expect.any(Number), expect.any(Number))
  })

  it('reserves gutter space for the vertical scrollbar instead of painting content underneath it', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const list = new RenderListView({
      items: Array.from({ length: 30 }, (_, index) => ({
        key: `row-${index}`,
        label: `Row ${index}`,
        trailingText: 'tail',
      })),
    })
    list.layout({ minWidth: 0, maxWidth: 160, minHeight: 0, maxHeight: 80 }, false, { theme: ImGuiDarkTheme })
    const painted = createPaintContext()

    list.paint(painted.context, { x: 0, y: 0 })

    const scrollbarWidth = deriveScrollbarStyle(ImGuiDarkTheme).gutterSize
    const paddingH = deriveListViewStyle(ImGuiDarkTheme).paddingH
    expect(painted.fillText).toHaveBeenCalledWith(
      'tail',
      160 - scrollbarWidth - paddingH,
      expect.any(Number),
    )
  })

  it('does not consume wheel when content fits inside the view', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const list = new RenderListView({
      items: [
        { key: 'inbox', label: '收件箱' },
        { key: 'today', label: '今日' },
      ],
    })
    list.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 180 }, false, { theme: ImGuiDarkTheme })

    const consumed = list.onWheel({
      pointerId: 0,
      position: { x: 10, y: 10 },
      type: 'wheel',
      deltaX: 0,
      deltaY: 1,
    })

    expect(consumed).toBe(false)
    expect(list.debugState().scrollY).toBe(0)
  })

  it('contains wheel events at scroll boundaries when the list overflows', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const list = new RenderListView({
      items: Array.from({ length: 30 }, (_, index) => ({
        key: `row-${index}`,
        label: `Row ${index}`,
      })),
    })
    list.layout({ minWidth: 0, maxWidth: 160, minHeight: 0, maxHeight: 80 }, false, { theme: ImGuiDarkTheme })

    const topConsumed = list.onWheel({
      pointerId: 0,
      position: { x: 10, y: 10 },
      type: 'wheel',
      deltaX: 0,
      deltaY: -1,
    })
    expect(topConsumed).toBe(true)
    expect(list.debugState().scrollY).toBe(0)

    for (let i = 0; i < 40; i++) {
      list.onWheel({ pointerId: 0, position: { x: 10, y: 10 }, type: 'wheel', deltaX: 0, deltaY: 1 })
    }
    const bottom = list.debugState().scrollY
    const bottomConsumed = list.onWheel({
      pointerId: 0,
      position: { x: 10, y: 10 },
      type: 'wheel',
      deltaX: 0,
      deltaY: 1,
    })

    expect(bottomConsumed).toBe(true)
    expect(list.debugState().scrollY).toBe(bottom)
  })

  it('does not consume horizontal wheel input in a vertical list', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const list = new RenderListView({
      items: Array.from({ length: 30 }, (_, index) => ({ key: `row-${index}`, label: `Row ${index}` })),
    })
    list.layout({ minWidth: 0, maxWidth: 160, minHeight: 0, maxHeight: 80 }, false, { theme: ImGuiDarkTheme })

    expect(list.onWheel({
      pointerId: 0,
      position: { x: 10, y: 10 },
      type: 'wheel',
      deltaX: 1,
      deltaY: 0,
    })).toBe(false)
    expect(list.debugState().scrollY).toBe(0)
  })

  it('does not let measure layout clamp the real scroll state', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const list = new RenderListView({
      items: Array.from({ length: 30 }, (_, index) => ({
        key: `row-${index}`,
        label: `Row ${index}`,
      })),
    })
    list.layout({ minWidth: 0, maxWidth: 160, minHeight: 0, maxHeight: 80 }, false, { theme: ImGuiDarkTheme })
    list.onWheel({ pointerId: 0, position: { x: 10, y: 10 }, type: 'wheel', deltaX: 0, deltaY: 1 })
    const before = list.debugState().scrollY

    list.measure({ minWidth: 0, maxWidth: 160, minHeight: 0, maxHeight: 1200 }, { theme: ImGuiDarkTheme })

    expect(before).toBeGreaterThan(0)
    expect(list.debugState().scrollY).toBe(before)
  })

  it('captures scrollbar drags and stops parent scroll gestures', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const list = new RenderListView({
      items: Array.from({ length: 30 }, (_, index) => ({
        key: `row-${index}`,
        label: `Row ${index}`,
      })),
    })
    list.layout({ minWidth: 0, maxWidth: 160, minHeight: 0, maxHeight: 80 }, false, { theme: ImGuiDarkTheme })
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const stopPropagation = vi.fn()
    const scrollbarX = list.size.width - 7

    list.onPointerDown({
      pointerId: 1,
      position: { x: scrollbarX, y: 10 },
      type: 'down',
      setPointerCapture,
      releasePointerCapture,
      stopPropagation,
    })
    list.onPointerMove({
      pointerId: 1,
      position: { x: scrollbarX, y: 45 },
      type: 'move',
      stopPropagation,
    })
    list.onPointerUp({
      pointerId: 1,
      position: { x: scrollbarX, y: 45 },
      type: 'up',
      releasePointerCapture,
      stopPropagation,
    })

    expect(setPointerCapture).toHaveBeenCalledTimes(1)
    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
    expect(stopPropagation).toHaveBeenCalled()
    expect(list.debugState().scrollY).toBeGreaterThan(0)
  })
})

it('pointer preview reports an item and exit without changing selection', () => {
  const hover = vi.fn(), select = vi.fn(), item = { key: 'a', label: '结构' }
  const list = new RenderListView({ items: [item], onHover: hover, onSelect: select })
  list.layout({ minWidth: 200, maxWidth: 200, minHeight: 100, maxHeight: 100 })
  list.onPointerMove({ position: { x: 20, y: 15 } } as any)
  expect(hover).toHaveBeenCalledWith(item); expect(list.selectedItem).toBeNull(); expect(select).not.toHaveBeenCalled()
  list.onPointerLeave({} as any); expect(hover).toHaveBeenLastCalledWith(null)
  list.disabled = true; hover.mockClear(); list.onPointerMove({ position: { x: 20, y: 15 } } as any); expect(hover).not.toHaveBeenCalled()
  list.dispose()
})
