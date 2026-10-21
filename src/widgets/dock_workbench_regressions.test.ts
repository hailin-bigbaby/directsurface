// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DockWorkbenchManager, RenderDockWorkbench, type DockWorkbenchTabGroupNode, type DockRegionNode } from './dock_workbench'
import { RenderText } from './basic'
import { RenderWindow } from './window'
import { RenderTextBox } from './text_field'
import { RenderSplitter } from './splitter'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { PipelineOwner, type Rect, type RenderObject } from '../core/render_object'
import { HitTestResult } from '../gestures/hit_test'
import { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme } from '../theme/default_theme'

const bounds = (width = 900, height = 540) => ({ minWidth: 0, maxWidth: width, minHeight: 0, maxHeight: height })
const tool = (id: string, region: 'left' | 'right' | 'bottom' = 'left') => ({ itemId: id, title: id, region, content: new RenderText(id) })
const groups = (node: DockRegionNode | null): DockWorkbenchTabGroupNode[] => !node ? [] : node.type === 'tabs' ? [node] : [...groups(node.first), ...groups(node.second)]
afterEach(() => { vi.useRealTimers(); FocusManager.disposeInstance(); InputComposer.disposeInstance(); vi.restoreAllMocks() })
function createPaintContext(): {
  context: PaintContext
  clip: ReturnType<typeof vi.fn>
  ctx: CanvasRenderingContext2D
  lineWidthWrites: number[]
  strokeLineWidths: number[]
} {
  const clip = vi.fn()
  let currentLineWidth = 1
  const lineWidthWrites: number[] = []
  const strokeLineWidths: number[] = []
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    clip,
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(() => { strokeLineWidths.push(ctx.lineWidth) }),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 8 }) as TextMetrics),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setLineDash: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    strokeStyle: '',
    fillStyle: '',
    font: '',
    lineCap: 'round' as CanvasLineCap,
    lineJoin: 'round' as CanvasLineJoin,
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
  } as unknown as CanvasRenderingContext2D
  Object.defineProperty(ctx, 'lineWidth', {
    get: () => currentLineWidth,
    set: value => {
      currentLineWidth = value
      lineWidthWrites.push(value)
    },
  })
  return { context: new PaintContext(ctx, ImGuiDarkTheme), clip, ctx, lineWidthWrites, strokeLineWidths }
}


describe('DockWorkbench transfer contracts', () => {
  it('keeps repeated item auto-hide idempotent inside a hidden group', () => {
    const manager = new DockWorkbenchManager()
    try {
      manager.openTool(tool('a')); manager.openTool(tool('b'))
      const group = manager.regions.left as DockWorkbenchTabGroupNode
      manager.autoHideGroup(group); manager.showAutoHideItem('a')
      const events = vi.fn(), changed = vi.fn()
      manager.subscribeEvent(events); manager.subscribe(changed)
      expect(manager.autoHideItem('a')).toBe(true)
      expect(manager.activeAutoHideItemId).toBe('a')
      expect(manager.getAutoHideGroup(group.id)?.itemIds).toEqual(['a', 'b'])
      expect(manager.autoHideItems.every(item => item.groupId === group.id)).toBe(true)
      expect(events).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled()
      manager.floatItem('a')
      expect(manager.getAutoHideGroup(group.id)?.itemIds).toEqual(['b'])
      manager.dockAutoHideGroup(group.id)
      expect(manager.getItem('a')!.placement.mode).toBe('floating')
      expect(groups(manager.regions.left).flatMap(group => group.items)).not.toContain(manager.getItem('a')!.window)
      expect(manager.getItem('b')!.placement.mode).toBe('docked')
    } finally { manager.dispose() }
  })

  it('rejects a stale hidden-group member before mutating any placement', () => {
    const manager = new DockWorkbenchManager()
    try {
      manager.openTool(tool('a')); manager.openTool(tool('b'))
      const group = manager.regions.left as DockWorkbenchTabGroupNode
      manager.autoHideGroup(group); manager.floatItem('a')
      // Simulate an inconsistent legacy group snapshot, which must fail atomically.
      ;(manager as any)._autoHideGroups.get(group.id).itemIds.push('a')
      const events = vi.fn(); manager.subscribeEvent(events)
      expect(manager.dockAutoHideGroup(group.id)).toBe(false)
      expect(manager.getItem('a')!.placement.mode).toBe('floating')
      expect(manager.getItem('b')!.placement.mode).toBe('autoHide')
      expect(events).not.toHaveBeenCalled()
    } finally { manager.dispose() }
  })

  it('pins the selected hidden-group tab without activating the last member', () => {
    const manager = new DockWorkbenchManager()
    const a = new RenderText('A'), b = new RenderText('B')
    try {
      manager.openTool({ ...tool('a'), content: a }); manager.openTool({ ...tool('b'), content: b })
      const group = manager.regions.left as DockWorkbenchTabGroupNode
      manager.autoHideGroup(group); manager.showAutoHideItem('a')
      const events: string[] = []; manager.subscribeEvent(event => events.push(event.type))
      expect(manager.dockAutoHideGroup(group.id)).toBe(true)
      expect(manager.activeItemId).toBe('a')
      expect((manager.regions.left as DockWorkbenchTabGroupNode).activeItem).toBe(manager.getItem('a')!.window)
      expect(events).not.toContain('item-deactivated')
      expect(events).not.toContain('item-activated')
    } finally { manager.dispose() }
  })

  it.each(['left', 'right', 'bottom'] as const)('preserves parent, focus and composition when pinning the expanded %s tool', region => {
    const manager = new DockWorkbenchManager(), field = new RenderTextBox({ value: 'input' })
    manager.openDocument({ itemId: 'doc', title: 'Doc', content: new RenderText('Doc') })
    manager.openTool({ ...tool('field', region), content: field })
    const view = new RenderDockWorkbench({ manager, disposeManagerOnDispose: true })
    const owner = new PipelineOwner()
    view.attach(owner); view.offset = { x: 70, y: 40 }
    FocusManager.instance.setRootResolver(() => [view])
    try {
      view.layout(bounds())
      manager.autoHideItem('field'); manager.showAutoHideItem('field'); view.layout(bounds())
      FocusManager.instance.register(field); FocusManager.instance.setFocus(field)
      const textarea = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement
      textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      expect(InputComposer.instance.composing).toBe(true)
      manager.dockAutoHideItem('field'); view.layout(bounds())
      const window = manager.getItem('field')!.window
      const groupView = [...(view as any)._groupViews.values()].find((g: any) => g.group.items.includes(window)) as any
      expect(window.parent).toBe(groupView._bodyClip)
      expect(window.owner).toBe(owner)
      expect(FocusManager.instance.current).toBe(field)
      expect(InputComposer.instance.composing).toBe(true)
      const hit = new HitTestResult()
      view.hitTestPath({ x: field.globalOffset.x + 4, y: field.globalOffset.y + 4 }, hit)
      expect(hit.contains(field)).toBe(true)
      textarea.value = 'input中'; textarea.setSelectionRange(6, 6)
      textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '中', bubbles: true }))
      expect(field.value).toBe('input中')
      // Repeat after the old overlay has been disposed, then verify one final disposal.
      const dispose = vi.spyOn(field, 'dispose')
      manager.autoHideItem('field'); manager.showAutoHideItem('field'); view.layout(bounds())
      manager.dockAutoHideItem('field'); view.layout(bounds())
      expect(dispose).not.toHaveBeenCalled()
      view.dispose()
      expect(dispose).toHaveBeenCalledOnce()
    } finally { if (manager.hasItem('field')) view.dispose() }
  })
})

describe('DockWorkbench committed geometry', () => {
  it('does not change splitter ratios, rendered geometry or invalidations during measurement', () => {
    const manager = new DockWorkbenchManager()
    manager.openDocument({ itemId: 'doc', title: 'Doc', content: new RenderText('Doc') })
    for (const region of ['left', 'right', 'bottom'] as const) manager.openTool(tool(region, region))
    const view = new RenderDockWorkbench({ manager, disposeManagerOnDispose: true })
    const requested = vi.fn(); view.attach(new PipelineOwner({ onNeedLayout: requested }))
    try {
      view.layout(bounds(1000, 600))
      const splitters: RenderSplitter[] = []
      const visit = (node: RenderObject) => { if (node instanceof RenderSplitter) splitters.push(node); node.visitChildren(visit) }
      visit(view)
      const before = splitters.map(split => ({ ratio: split.ratio, size: { ...split.size }, offset: { ...split.offset } }))
      requested.mockClear(); view.measure(bounds(400, 300))
      expect(splitters.map(split => ({ ratio: split.ratio, size: split.size, offset: split.offset }))).toEqual(before)
      expect(requested).not.toHaveBeenCalled()
    } finally { view.dispose() }
  })

  it.each(['left', 'right', 'bottom'] as const)('retains configured %s pixels in wide and tall workbenches', region => {
    const manager = new DockWorkbenchManager()
    manager.openDocument({ itemId: 'doc', title: 'Doc', content: new RenderText('Doc') })
    manager.openTool(tool('tool', region)); manager.setRegionLayout({ leftWidth: 240, rightWidth: 240, bottomHeight: 180 })
    const view = new RenderDockWorkbench({ manager, disposeManagerOnDispose: true })
    try {
      for (const width of [900, 1800, 3000]) {
        view.layout(bounds(width, 2000))
        const pane = [...(view as any)._groupViews.values()].find((g: any) => g.group.kind === 'tool') as any
        expect(region === 'bottom' ? pane.size.height : pane.size.width).toBe(region === 'bottom' ? 180 : 240)
      }
    } finally { view.dispose() }
  })
})

describe('DockWorkbench auto-hide rail overflow', () => {
  it.each([
    { pointerId: 2, pointerType: 'touch' as const },
    { pointerId: 1, pointerType: 'mouse' as const },
  ])('keeps paging owned by its initial pointer when another source interacts: %o', other => {
    const manager = new DockWorkbenchManager()
    for (let i = 0; i < 10; i++) { manager.openTool(tool('tool-' + i)); manager.autoHideItem('tool-' + i) }
    const view = new RenderDockWorkbench({ manager, disposeManagerOnDispose: true })
    try {
      view.layout(bounds(400, 240)); view.paint(createPaintContext().context, { x: 0, y: 0 })
      const rect = (view as any)._autoHideRailLayouts.get('left').after as Rect
      const position = { x: rect.x + 4, y: rect.y + 4 }
      const owner = { pointerId: 1, pointerType: 'touch' as const, position }
      const release = vi.fn(), otherCapture = vi.fn()
      view.onPointerDown({ ...owner, type: 'down', setPointerCapture: vi.fn(), releasePointerCapture: release })
      view.onPointerDown({ ...other, position, type: 'down', setPointerCapture: otherCapture })
      view.onPointerMove({ ...other, position, type: 'move' })
      view.onPointerCancel({ ...other, position, type: 'cancel' })
      view.onPointerUp({ ...other, position, type: 'up' })
      expect(otherCapture).not.toHaveBeenCalled()
      expect(release).not.toHaveBeenCalled()
      expect((view as any)._autoHideScroll.left.offset).toBe(0)
      view.onPointerUp({ ...owner, type: 'up' })
      expect(release).toHaveBeenCalledOnce()
      expect((view as any)._autoHideScroll.left.offset).toBeGreaterThan(0)
    } finally { view.dispose() }
  })

  it('cancels pending hover on scroll and releases paging capture on cancel and dispose', () => {
    vi.useFakeTimers()
    const manager = new DockWorkbenchManager()
    for (let i = 0; i < 10; i++) { manager.openTool(tool('tool-' + i)); manager.autoHideItem('tool-' + i) }
    const view = new RenderDockWorkbench({ manager, disposeManagerOnDispose: true })
    const paint = () => view.paint(createPaintContext().context, { x: 0, y: 0 })
    view.layout(bounds(400, 240)); paint()
    const rect = (view as any)._autoHideTabRects.get('tool-0') as Rect
    const position = { x: rect.x + 4, y: rect.y + 4 }
    view.onPointerMove({ pointerId: 1, type: 'move', position })
    view.onWheel({ pointerId: 1, type: 'wheel', position, deltaX: 0, deltaY: 40 })
    vi.advanceTimersByTime(1000)
    expect(manager.activeAutoHideItemId).toBeNull()
    paint()
    const button = (view as any)._autoHideRailLayouts.get('left').after as Rect
    const buttonPosition = { x: button.x + 4, y: button.y + 4 }
    const capture = vi.fn(), release = vi.fn()
    const down = { pointerId: 1, type: 'down' as const, position: buttonPosition, setPointerCapture: capture, releasePointerCapture: release }
    view.onPointerDown(down)
    expect(capture).toHaveBeenCalledOnce()
    view.onPointerCancel({ pointerId: 1, type: 'cancel', position: buttonPosition })
    expect(release).toHaveBeenCalledOnce()
    view.onPointerDown(down)
    view.dispose()
    expect(release).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1000)
    expect(manager.items).toHaveLength(0)
  })

  it.each([0, 1, 20, 40])('keeps tiny rail hit targets inside a %spx workbench', extent => {
    const manager = new DockWorkbenchManager()
    for (const region of ['left', 'right', 'bottom'] as const) { manager.openTool(tool(region, region)); manager.autoHideItem(region) }
    const view = new RenderDockWorkbench({ manager, disposeManagerOnDispose: true })
    try {
      view.layout(bounds(extent, extent)); view.paint(createPaintContext().context, { x: 0, y: 0 })
      for (const rect of (view as any)._autoHideTabRects.values() as Iterable<Rect>) {
        expect(rect.width).toBeGreaterThan(0); expect(rect.height).toBeGreaterThan(0)
        expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0)
        expect(rect.x + rect.width).toBeLessThanOrEqual(extent)
        expect(rect.y + rect.height).toBeLessThanOrEqual(extent)
      }
    } finally { view.dispose() }
  })

  it.each(['left', 'right', 'bottom'] as const)('scrolls and pages the %s rail without exposing off-viewport hit targets', async region => {
    vi.useFakeTimers()
    const manager = new DockWorkbenchManager()
    for (let i = 0; i < 10; i++) { manager.openTool(tool('tool-' + i, region)); manager.autoHideItem('tool-' + i) }
    const view = new RenderDockWorkbench({ manager, disposeManagerOnDispose: true })
    const paint = () => view.paint(createPaintContext().context, { x: 0, y: 0 })
    const click = (rect: Rect) => {
      const position = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      view.onPointerDown({ pointerId: 1, type: 'down', position })
      view.onPointerUp({ pointerId: 1, type: 'up', position })
      paint()
    }
    try {
      view.layout(bounds(400, 240)); paint()
      const firstRects = new Map<string, Rect>((view as any)._autoHideTabRects)
      expect(firstRects.has('tool-0')).toBe(true)
      expect(firstRects.has('tool-9')).toBe(false)
      const layout = (view as any)._autoHideRailLayouts.get(region)
      const position = { x: layout.rail.x + 4, y: layout.rail.y + 4 }
      const wheel = { pointerId: 1, type: 'wheel' as const, position, deltaX: region === 'bottom' ? 10000 : 0, deltaY: region === 'bottom' ? 0 : 10000 }
      expect(view.onWheel(wheel)).toBe(true); paint()
      expect((view as any)._autoHideTabRects.has('tool-9')).toBe(true)
      for (const rect of (view as any)._autoHideTabRects.values() as Iterable<Rect>) {
        expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0)
        expect(rect.x + rect.width).toBeLessThanOrEqual(400)
        expect(rect.y + rect.height).toBeLessThanOrEqual(240)
      }
      view.onWheel({ ...wheel, deltaX: -wheel.deltaX, deltaY: -wheel.deltaY }); paint()
      for (let i = 0; i < 20 && !(view as any)._autoHideTabRects.has('tool-9'); i++) click((view as any)._autoHideRailLayouts.get(region).after)
      expect((view as any)._autoHideTabRects.has('tool-9')).toBe(true)
      click((view as any)._autoHideTabRects.get('tool-9'))
      expect(manager.activeAutoHideItemId).toBe('tool-9')
      manager.hideAutoHideItem(); paint()
      manager.showAutoHideItem('tool-0'); view.layout(bounds(400, 240)); paint()
      expect((view as any)._autoHideTabRects.has('tool-0')).toBe(true)
      manager.hideAutoHideItem()
      for (let i = 1; i < 10; i++) await manager.closeItem('tool-' + i)
      view.layout(bounds(400, 240)); paint()
      expect((view as any)._autoHideScroll[region].offset).toBe(0)
      expect((view as any)._autoHideRailLayouts.get(region).after).toBeUndefined()
      expect(view.onWheel(wheel)).toBe(false)
    } finally { view.dispose() }
  })
})
