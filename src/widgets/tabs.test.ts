import { afterEach, describe, expect, it, vi } from 'vitest'
import { PipelineOwner, type BoxConstraints } from '../core/render_object'
import { PopupManager } from '../core/popup_manager'
import { TextMeasurer } from '../core/text_measurer'
import { PaintContext } from '../rendering/paint_context'
import { deriveTabsStyle } from '../theme/component_styles'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../theme/default_theme'
import { colorToCSS } from '../theme/theme'
import { MenuPopup } from './menu_popup'
import { RenderTabs } from './tabs'

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 200,
  minHeight: 0,
  maxHeight: 40,
}

function createPaintContext(): PaintContext {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  return new PaintContext(ctx)
}

function createTabs(): RenderTabs {
  return new RenderTabs({
    tabs: [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ],
    activeKey: 'a',
  })
}

function createRecordingPaintContext(): {
  context: PaintContext
  fillStyles: string[]
  roundRects: unknown[][]
} {
  let fillStyle = ''
  const fillStyles: string[] = []
  const roundRects: unknown[][] = []
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(() => fillStyles.push(fillStyle)),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn((...args: unknown[]) => roundRects.push(args)),
    fill: vi.fn(() => fillStyles.push(fillStyle)),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    set fillStyle(value: string) { fillStyle = value },
    get fillStyle() { return fillStyle },
    set strokeStyle(_value: string) {},
    get strokeStyle() { return '' },
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  return {
    context: new PaintContext(ctx, ImGuiDarkTheme),
    fillStyles,
    roundRects,
  }
}

function createGeometryRecordingPaintContext(): {
  context: PaintContext
  fillRects: unknown[][]
} {
  const fillRects: unknown[][] = []
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn((...args: unknown[]) => fillRects.push(args)),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    set fillStyle(_value: string) {},
    get fillStyle() { return '' },
    set strokeStyle(_value: string) {},
    get strokeStyle() { return '' },
    lineWidth: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D
  return {
    context: new PaintContext(ctx, ImGuiDarkTheme),
    fillRects,
  }
}

afterEach(() => {
  PopupManager.instance.dispose()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('RenderTabs runtime invalidation', () => {
  it.each([1, 2, 3])('keeps its border flush with the background at DPR %s', dpr => {
    const tabs = new RenderTabs({ tabs: [], activeKey: '' })
    tabs.size = { width: 100, height: 32 }
    const context = createPaintContext()
    context.ctx.getTransform = () => ({ a: dpr, d: dpr, e: 0, f: 0 }) as DOMMatrix

    tabs.performPaint(context, { x: 8, y: 8 })

    const [x, y, width, height] = vi.mocked(context.ctx.strokeRect).mock.calls.at(-1)!
    expect({ left: x - 0.5, top: y - 0.5, right: x + width + 0.5, bottom: y + height + 0.5 })
      .toEqual({ left: 8, top: 8, right: 108, bottom: 40 })
    tabs.dispose()
  })

  it('exposes the resolved global tab rectangle for Canvas interaction tests', () => {
    const tabs = createTabs()
    tabs.layout(constraints)

    expect(tabs.tabRect('a')).toMatchObject({ x: 0, y: 0, height: tabs.size.height })
    expect(tabs.tabRect('b')!.x).toBeGreaterThan(tabs.tabRect('a')!.x)
    expect(tabs.tabRect('missing')).toBeUndefined()
    tabs.dispose()
  })

  it('schedules paint through PipelineOwner when activeKey changes after attach', () => {
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedPaint })
    const tabs = createTabs()
    tabs.attach(owner)
    tabs.layout(constraints)
    tabs.paint(createPaintContext(), { x: 0, y: 0 })

    tabs.activeKey = 'b'

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(tabs.needsPaint).toBe(true)
    tabs.dispose()
  })

  it('schedules hover paints through PipelineOwner without an onRepaint callback', () => {
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedPaint })
    const tabs = createTabs()
    tabs.attach(owner)
    tabs.layout(constraints)
    tabs.paint(createPaintContext(), { x: 0, y: 0 })

    tabs.onPointerMove({ pointerId: 1, position: { x: 10, y: 10 }, type: 'move' })

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(tabs.needsPaint).toBe(true)
    tabs.dispose()
  })

  it('schedules underline animation paints through PipelineOwner on animation ticks', () => {
    let nextFrameId = 1
    const frames = new Map<number, FrameRequestCallback>()
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextFrameId++
      frames.set(frameId, callback)
      return frameId
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((frameId: number) => {
      frames.delete(frameId)
    }))

    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedPaint })
    const tabs = createTabs()
    tabs.attach(owner)
    tabs.layout(constraints)
    tabs.paint(createPaintContext(), { x: 0, y: 0 })

    tabs.onPointerDown({ pointerId: 1, position: { x: 40, y: 10 }, type: 'down' })

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    tabs.paint(createPaintContext(), { x: 0, y: 0 })
    owner.clearPaintRequests()
    onNeedPaint.mockClear()

    const firstFrame = frames.entries().next().value as [number, FrameRequestCallback] | undefined
    expect(firstFrame).toBeDefined()
    frames.delete(firstFrame![0])
    firstFrame![1](16)

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    tabs.dispose()
  })

  it('marks dirty when not attached', () => {
    const tabs = createTabs()

    tabs.activeKey = 'b'

    expect(tabs.needsPaint).toBe(true)
    tabs.dispose()
  })

  it('updates underline geometry when active tab changes externally', () => {
    const tabs = createTabs()
    const style = deriveTabsStyle(ImGuiDarkTheme)

    tabs.layout(constraints)
    expect((tabs as any)._tabRects(style)[0].x).toBe(style.stripStartInset)
    expect((tabs as any)._underlineTo).toBe(style.stripStartInset)
    expect((tabs as any)._underlineToW).toBeGreaterThan(0)

    tabs.activeKey = 'b'

    expect((tabs as any)._underlineTo).toBeGreaterThan(0)
    expect((tabs as any)._underlineToW).toBeGreaterThan(0)
  })

  it('does not reset underline animation or request paint when layout geometry is unchanged', () => {
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedPaint })
    const tabs = createTabs()

    tabs.attach(owner)
    tabs.layout(constraints)
    tabs.paint(createPaintContext(), { x: 0, y: 0 })
    owner.clearPaintRequests()
    onNeedPaint.mockClear()

    tabs.markNeedsLayout()
    owner.flushLayout()

    expect(onNeedPaint).not.toHaveBeenCalled()
    tabs.dispose()
  })

  it('paints active tabs as part of the workspace surface', () => {
    const tabs = new RenderTabs({
      tabs: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
      activeKey: 'b',
    })
    tabs.layout(constraints, false, { theme: ImGuiDarkTheme })
    const style = deriveTabsStyle(ImGuiDarkTheme)
    tabs.onPointerMove({ pointerId: 1, position: { x: style.stripStartInset + 1, y: 10 }, type: 'move' })
    const painted = createRecordingPaintContext()

    tabs.paint(painted.context, { x: 0, y: 0 })

    const stripStyle = colorToCSS(style.barBg)
    const hoverStyle = colorToCSS(style.tabBg.hoveredBg!)
    const activeStyle = colorToCSS(style.activeTabBg)
    const stripIndex = painted.fillStyles.indexOf(stripStyle)
    const hoverIndex = painted.fillStyles.indexOf(hoverStyle)
    const activeIndex = painted.fillStyles.indexOf(activeStyle)

    expect(stripIndex).toBeGreaterThanOrEqual(0)
    expect(hoverIndex).toBeGreaterThan(stripIndex)
    expect(activeIndex).toBeGreaterThan(hoverIndex)
    expect(style.tabRadius).toBe(0)
    expect(style.indicatorHeight).toBe(2)
    expect(style.activeTabBg).toEqual(ImGuiDarkTheme.surfaceContent)
  })

  it('only exposes close hit targets for active or hovered tabs', () => {
    const onTabClose = vi.fn()
    const tabs = new RenderTabs({
      tabs: [
        { key: 'a', label: 'Alpha', closable: true },
        { key: 'b', label: 'Beta', closable: true },
      ],
      activeKey: 'a',
      onTabClose,
    })
    tabs.layout({ minWidth: 0, maxWidth: 240, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const style = deriveTabsStyle(ImGuiDarkTheme)
    const layout = (tabs as any)._visibleTabLayout(style) as {
      rects: Array<{ x: number; w: number }>
    }
    const inactiveRect = layout.rects[1]!
    const closeX = inactiveRect.x + inactiveRect.w - style.closeButtonSize + 1

    expect((tabs as any)._closeAtX(closeX)).toBe('')

    tabs.onPointerMove({ pointerId: 1, position: { x: closeX, y: 10 }, type: 'move' })

    expect((tabs as any)._hoveredClose).toBe('b')
    expect((tabs as any)._closeAtX(closeX)).toBe('b')
  })

  it('does not close inactive tabs from the close slot before hover exposes it', () => {
    const onTabClose = vi.fn()
    const tabs = new RenderTabs({
      tabs: [
        { key: 'a', label: 'Alpha', closable: true },
        { key: 'b', label: 'Beta', closable: true },
      ],
      activeKey: 'a',
      onTabClose,
    })
    tabs.layout({ minWidth: 0, maxWidth: 240, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const style = deriveTabsStyle(ImGuiDarkTheme)
    const layout = (tabs as any)._visibleTabLayout(style) as {
      rects: Array<{ x: number; w: number }>
    }
    const inactiveRect = layout.rects[1]!
    const closeX = inactiveRect.x + inactiveRect.w - style.closeButtonSize + 1

    tabs.onPointerDown({ pointerId: 1, position: { x: closeX, y: 10 }, type: 'down' })
    expect(onTabClose).not.toHaveBeenCalled()

    tabs.onPointerUp({ pointerId: 1, position: { x: closeX, y: 10 }, type: 'up' })
    tabs.onPointerMove({ pointerId: 1, position: { x: closeX, y: 10 }, type: 'move' })
    tabs.onPointerDown({ pointerId: 2, position: { x: closeX, y: 10 }, type: 'down' })

    expect(onTabClose).toHaveBeenCalledWith('b')
  })

  it('moves overflowing tabs into a menu while keeping the active tab visible', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 12)
    const onTabChange = vi.fn()
    const tabs = new RenderTabs({
      tabs: [
        { key: 'a', label: 'Alpha Page' },
        { key: 'b', label: 'Beta Page' },
        { key: 'c', label: 'Gamma Page' },
        { key: 'd', label: 'Delta Page' },
        { key: 'e', label: 'Epsilon Page' },
      ],
      activeKey: 'e',
      onTabChange,
    })
    tabs.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const style = deriveTabsStyle(ImGuiDarkTheme)
    const layout = (tabs as any)._visibleTabLayout(style) as {
      rects: Array<unknown | undefined>
      overflowRect: { x: number; w: number } | null
      overflowTabs: Array<{ key: string }>
    }

    expect(layout.overflowRect).not.toBeNull()
    expect(layout.rects[4]).toBeDefined()
    expect(layout.overflowTabs.map(tab => tab.key)).toContain('a')

    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 800, height: 600, dpr: 1 },
    }))
    tabs.onPointerDown({
      pointerId: 1,
      position: { x: layout.overflowRect!.x + layout.overflowRect!.w / 2, y: 10 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    expect(popup).toBeInstanceOf(MenuPopup)
    const popupState = popup.debugState(PopupManager.instance.context)
    PopupManager.instance.handlePointerDown({
      pointerId: 1,
      position: { x: popupState.pos.x + 8, y: popupState.pos.y + popupState.itemHeight / 2 },
      type: 'down',
    })

    expect(onTabChange).toHaveBeenCalledWith(layout.overflowTabs[0]!.key)
  })

  it('uses a compact icon strip instead of an overflow menu when requested', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 12)
    const onTabChange = vi.fn()
    const onTabClose = vi.fn()
    const tabs = new RenderTabs({
      tabs: [
        { key: 'solution', label: 'Solution Explorer', icon: 'folder', closable: true },
        { key: 'toolbox', label: 'Toolbox', icon: 'toolbox', closable: true },
        { key: 'properties', label: 'Properties', icon: 'settings', closable: true },
        { key: 'output', label: 'Output', icon: 'document', closable: true },
      ],
      activeKey: 'solution',
      overflowMode: 'icon-strip',
      onTabChange,
      onTabClose,
    })
    tabs.layout({ minWidth: 0, maxWidth: 96, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const layout = (tabs as any)._visibleTabLayout(deriveTabsStyle(ImGuiDarkTheme)) as {
      rects: Array<{ x: number; w: number; compact?: boolean } | undefined>
      overflowRect: { x: number; w: number } | null
      overflowTabs: Array<{ key: string }>
    }

    expect(layout.overflowRect).toBeNull()
    expect(layout.overflowTabs).toEqual([])
    expect(layout.rects).toHaveLength(4)
    expect(layout.rects.every(rect => rect?.compact === true)).toBe(true)

    const target = layout.rects[2]!
    const position = { x: target.x + target.w / 2, y: 10 }
    tabs.onPointerMove({ pointerId: 1, position, type: 'move' })
    tabs.onPointerDown({
      pointerId: 1,
      position,
      type: 'down',
    })
    tabs.onPointerUp({ pointerId: 1, position, type: 'up' })

    expect(onTabChange).toHaveBeenCalledWith('properties')
    expect(onTabClose).not.toHaveBeenCalled()
    expect(PopupManager.instance.current).toBeNull()
  })

  it('keeps the active icon-strip tab readable when space allows', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 10)
    const tabs = new RenderTabs({
      tabs: [
        { key: 'solution', label: 'Solution', icon: 'folder' },
        { key: 'toolbox', label: 'Toolbox', icon: 'toolbox' },
        { key: 'properties', label: 'Properties', icon: 'settings' },
      ],
      activeKey: 'solution',
      overflowMode: 'icon-strip',
    })
    const style = deriveTabsStyle(ImGuiDarkTheme)
    tabs.layout({ minWidth: 0, maxWidth: 150, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })

    let layout = (tabs as any)._visibleTabLayout(style) as {
      rects: Array<{ compact?: boolean } | undefined>
    }
    expect(layout.rects[0]?.compact).toBeUndefined()
    expect(layout.rects[1]?.compact).toBe(true)
    expect(layout.rects[2]?.compact).toBe(true)

    tabs.activeKey = 'toolbox'
    layout = (tabs as any)._visibleTabLayout(style) as {
      rects: Array<{ compact?: boolean } | undefined>
    }
    expect(layout.rects[0]?.compact).toBe(true)
    expect(layout.rects[1]?.compact).toBeUndefined()
    expect(layout.rects[2]?.compact).toBe(true)
  })

  it('dismisses the overflow menu when disabled', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 12)
    const tabs = new RenderTabs({
      tabs: [
        { key: 'a', label: 'Alpha Page' },
        { key: 'b', label: 'Beta Page' },
        { key: 'c', label: 'Gamma Page' },
        { key: 'd', label: 'Delta Page' },
        { key: 'e', label: 'Epsilon Page' },
      ],
      activeKey: 'e',
    })
    tabs.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const layout = (tabs as any)._visibleTabLayout(deriveTabsStyle(ImGuiDarkTheme)) as {
      overflowRect: { x: number; w: number } | null
    }
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 800, height: 600, dpr: 1 },
    }))

    tabs.onPointerDown({
      pointerId: 1,
      position: { x: layout.overflowRect!.x + layout.overflowRect!.w / 2, y: 10 },
      type: 'down',
    })
    expect(PopupManager.instance.current).toBeInstanceOf(MenuPopup)

    tabs.disabled = true

    expect(PopupManager.instance.current).toBeNull()
    expect((tabs as any)._overflowPopup).toBeNull()
    tabs.dispose()
  })

  it('clears focus and pointer state and ignores input when disabled dynamically', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const onTabChange = vi.fn()
    const tabs = new RenderTabs({
      tabs: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
      activeKey: 'a',
      onTabChange,
    })
    tabs.layout(constraints)

    tabs.focusIn()
    tabs.onPointerMove({ pointerId: 1, position: { x: 40, y: 10 }, type: 'move' })
    tabs.onPointerDown({
      pointerId: 1,
      position: { x: 10, y: 10 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })

    expect(tabs.isFocused).toBe(true)
    expect((tabs as any)._hoveredTab).toBe('b')
    expect((tabs as any)._pressedTab).toBe('a')

    tabs.disabled = true

    expect(tabs.isFocused).toBe(false)
    expect((tabs as any)._hoveredTab).toBe('')
    expect((tabs as any)._hoveredClose).toBe('')
    expect((tabs as any)._hoveredOverflow).toBe(false)
    expect((tabs as any)._pressedTab).toBe('')

    tabs.onPointerMove({ pointerId: 1, position: { x: 40, y: 10 }, type: 'move' })
    tabs.onPointerUp({ pointerId: 1, position: { x: 40, y: 10 }, type: 'up' })

    const right = { key: 'ArrowRight', preventDefault: vi.fn() } as unknown as KeyboardEvent

    expect(tabs.onKeyDown(right)).toBe(false)
    expect((tabs as any)._hoveredTab).toBe('')
    expect(tabs.activeKey).toBe('a')
    expect(onTabChange).not.toHaveBeenCalled()

    tabs.dispose()
  })

  it('does not close a clipped tab when its close button is not visible', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 14)
    const onTabClose = vi.fn()
    const tabs = new RenderTabs({
      tabs: [
        { key: 'a', label: 'Alpha Page', closable: true },
        { key: 'b', label: 'Beta Page', closable: true },
      ],
      activeKey: 'b',
      onTabClose,
    })
    tabs.layout({ minWidth: 0, maxWidth: 45, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const style = deriveTabsStyle(ImGuiDarkTheme)
    const layout = (tabs as any)._visibleTabLayout(style) as {
      rects: Array<{ x: number; w: number } | undefined>
    }
    const activeRect = layout.rects[1]!

    expect(activeRect.w).toBeLessThan(style.closeButtonSize)

    tabs.onPointerDown({
      pointerId: 1,
      position: { x: activeRect.x + Math.max(0, activeRect.w - 1), y: 10 },
      type: 'down',
    })

    expect(onTabClose).not.toHaveBeenCalled()
  })

  it('recomputes layout from the owner theme after a theme change', () => {
    const onNeedLayout = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout }, ImGuiDarkTheme)
    const tabs = createTabs()
    tabs.attach(owner)
    tabs.layout(constraints)
    const beforeHeight = tabs.size.height
    onNeedLayout.mockClear()

    owner.setTheme({
      ...ImGuiLightTheme,
      fontSize: ImGuiLightTheme.fontSize + 2,
      panelHeaderHeight: ImGuiLightTheme.panelHeaderHeight + 4,
    })
    tabs.markNeedsLayout()

    expect(onNeedLayout).toHaveBeenCalledTimes(1)
    expect(tabs.needsLayout).toBe(true)
    owner.flushLayout()
    expect(tabs.size.height).toBeGreaterThan(beforeHeight)
    tabs.dispose()
  })

  it('switches active tabs from keyboard arrows', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const tabs = createTabs()
    const right = { key: 'ArrowRight', preventDefault: vi.fn() } as unknown as KeyboardEvent
    tabs.focusIn()

    expect(tabs.onKeyDown(right)).toBe(true)
    expect(tabs.activeKey).toBe('b')
  })

  it('activates tabs on pointer down and does not roll back on cancel', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const onTabChange = vi.fn()
    const tabs = new RenderTabs({
      tabs: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
      activeKey: 'a',
      onTabChange,
    })
    tabs.layout(constraints)

    tabs.onPointerDown({
      pointerId: 1,
      position: { x: 40, y: 10 },
      type: 'down',
      setPointerCapture: vi.fn(),
    })

    expect(tabs.activeKey).toBe('b')
    expect(onTabChange).toHaveBeenCalledWith('b')

    tabs.onPointerCancel({
      pointerId: 1,
      position: { x: 40, y: 10 },
      type: 'cancel',
      releasePointerCapture: vi.fn(),
    })

    expect(tabs.activeKey).toBe('b')
    expect(onTabChange).toHaveBeenCalledTimes(1)
    tabs.dispose()
  })

  it('routes context menu requests for tab headers and declines empty strip space', () => {
    const onTabContextMenu = vi.fn()
    const tabs = new RenderTabs({
      tabs: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
      activeKey: 'a',
      onTabContextMenu,
    })
    tabs.layout(constraints)

    expect(tabs.onContextMenu({ x: 40, y: 10 })).toBe(true)
    expect(onTabContextMenu).toHaveBeenCalledWith('b', { x: 40, y: 10 })

    onTabContextMenu.mockClear()
    expect(tabs.onContextMenu({ x: 190, y: 10 })).toBe(false)
    expect(onTabContextMenu).not.toHaveBeenCalled()
    tabs.dispose()
  })

  it('lets tab context menu callbacks decline handling', () => {
    const tabs = new RenderTabs({
      tabs: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
      activeKey: 'a',
      onTabContextMenu: () => false,
    })
    tabs.layout(constraints)

    expect(tabs.onContextMenu({ x: 40, y: 10 })).toBe(false)
    tabs.dispose()
  })

  it('does not consume tab context menu requests without a handler', () => {
    const tabs = createTabs()
    tabs.layout(constraints)

    expect(tabs.onContextMenu({ x: 40, y: 10 })).toBe(false)
    expect((tabs as any)._hoveredTab).toBe('')
    tabs.dispose()
  })

  it('fires tab reorder callbacks when dragging a tab to a new index', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const onTabReorder = vi.fn()
    const tabs = new RenderTabs({
      tabs: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
        { key: 'c', label: 'C' },
      ],
      activeKey: 'a',
      onTabReorder,
    })

    tabs.layout(constraints)
    tabs.onPointerDown({
      pointerId: 1,
      position: { x: 40, y: 10 },
      type: 'down',
      setPointerCapture: vi.fn(),
    })
    tabs.onPointerMove({
      pointerId: 1,
      position: { x: 5, y: 10 },
      type: 'move',
    })
    tabs.onPointerUp({
      pointerId: 1,
      position: { x: 5, y: 10 },
      type: 'up',
      releasePointerCapture: vi.fn(),
    })

    expect(onTabReorder).toHaveBeenCalledWith('b', 0)
  })

  it('does not let mouse zero finish a touch zero tab drag', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const onTabReorder = vi.fn()
    const releasePointerCapture = vi.fn()
    const tabs = new RenderTabs({
      tabs: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
        { key: 'c', label: 'C' },
      ],
      activeKey: 'a',
      onTabReorder,
    })
    tabs.layout(constraints)

    tabs.onPointerDown({
      pointerId: 0,
      pointerType: 'touch',
      position: { x: 40, y: 10 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture,
    })
    tabs.onPointerMove({
      pointerId: 0,
      pointerType: 'mouse',
      position: { x: 5, y: 10 },
      type: 'move',
    })
    tabs.onPointerUp({
      pointerId: 0,
      pointerType: 'mouse',
      position: { x: 5, y: 10 },
      type: 'up',
    })

    expect(onTabReorder).not.toHaveBeenCalled()
    expect((tabs as any)._dragPointerKey).toBe('touch:0')

    tabs.onPointerMove({
      pointerId: 0,
      pointerType: 'touch',
      position: { x: 5, y: 10 },
      type: 'move',
    })
    tabs.onPointerUp({
      pointerId: 0,
      pointerType: 'touch',
      position: { x: 5, y: 10 },
      type: 'up',
    })

    expect(onTabReorder).toHaveBeenCalledWith('b', 0)
    expect(releasePointerCapture).toHaveBeenCalledOnce()
    tabs.dispose()
  })

  it('paints an insertion marker while dragging a tab within the header strip', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const tabs = new RenderTabs({
      tabs: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
        { key: 'c', label: 'C' },
      ],
      activeKey: 'a',
    })
    tabs.layout(constraints)
    tabs.onPointerDown({
      pointerId: 1,
      position: { x: 40, y: 10 },
      type: 'down',
      setPointerCapture: vi.fn(),
    })
    tabs.onPointerMove({ pointerId: 1, position: { x: 5, y: 10 }, type: 'move' })
    const painted = createGeometryRecordingPaintContext()

    tabs.paint(painted.context, { x: 0, y: 0 })

    expect(painted.fillRects.some(args => args[2] === 2)).toBe(true)
    tabs.dispose()
  })

  it('releases captured pointer and cancels drag when disabled during a tab drag', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const releasePointerCapture = vi.fn()
    const onTabDragCancel = vi.fn()
    const tabs = new RenderTabs({
      tabs: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
      activeKey: 'a',
      onTabDragCancel,
    })
    tabs.layout(constraints)

    tabs.onPointerDown({
      pointerId: 1,
      position: { x: 40, y: 10 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture,
    })
    tabs.onPointerMove({ pointerId: 1, position: { x: 5, y: 10 }, type: 'move' })
    tabs.disabled = true

    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
    expect(onTabDragCancel).toHaveBeenCalledWith('b', { x: 5, y: 10 })
    expect((tabs as any)._dragPointerKey).toBeUndefined()
    expect((tabs as any)._pressedTab).toBe('')
    tabs.dispose()
  })

  it('releases captured pointer when disposed during a tab drag', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const releasePointerCapture = vi.fn()
    const tabs = createTabs()
    tabs.layout(constraints)

    tabs.onPointerDown({
      pointerId: 1,
      position: { x: 40, y: 10 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture,
    })
    tabs.dispose()

    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
  })

  it('does not emit an obsolete drag position after drag start re-enters move', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const positions: number[] = []
    let nested = false
    let tabs!: RenderTabs
    tabs = new RenderTabs({
      tabs: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
      activeKey: 'a',
      onTabDragStart: () => {
        if (nested) return
        nested = true
        tabs.onPointerMove({
          pointerId: 1,
          position: { x: 10, y: 10 },
          type: 'move',
        })
      },
      onTabDragMove: (_key, position) => positions.push(position.x),
    })
    tabs.layout(constraints)
    tabs.onPointerDown({
      pointerId: 1,
      position: { x: 40, y: 10 },
      type: 'down',
      setPointerCapture: vi.fn(),
    })

    tabs.onPointerMove({
      pointerId: 1,
      position: { x: 5, y: 10 },
      type: 'move',
    })

    expect(positions).toEqual([10])
    tabs.dispose()
  })
})
