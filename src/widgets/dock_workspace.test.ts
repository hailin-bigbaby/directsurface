import { RenderText } from './basic'
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppContextRegistry, createAppContextKey } from '../core/app_context'
import { FocusManager } from '../core/focus_manager'
import { HitTestResult } from '../gestures/hit_test'
import { PipelineOwner, type BoxConstraints, type LayoutContext, type Offset, type RenderObject } from '../core/render_object'
import { RenderBox } from '../layout/render_box'
import { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { deriveDockWorkbenchStyle } from '../theme/component_styles'
import { DockWindowManager, RenderDockWorkspace, type DockDropZone, type DockTabGroupNode } from './dock_workspace'
import { RenderTabs } from './tabs'
import { RenderWindow } from './window'

class TestDocumentBox extends RenderBox {
  disposed = false

  constructor(
    private readonly desiredWidth = 240,
    private readonly desiredHeight = 180,
  ) {
    super()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    this.size = {
      width: constraints.maxWidth === Infinity ? this.desiredWidth : constraints.maxWidth,
      height: constraints.maxHeight === Infinity ? this.desiredHeight : constraints.maxHeight,
    }
  }

  performPaint(_context: PaintContext, _offset: Offset): void {}

  override dispose(): void {
    this.disposed = true
    super.dispose()
  }
}

class LifecycleDocumentBox extends TestDocumentBox {
  activationCount = 0
  deactivationCount = 0

  onDocumentActivated(): void {
    this.activationCount += 1
  }

  onDocumentDeactivated(): void {
    this.deactivationCount += 1
  }
}

type DockTabGroupView = {
  group: DockTabGroupNode
  tabs: RenderTabs
}

function guidePoint(workspace: RenderDockWorkspace, view: DockTabGroupView, zone: DockDropZone): Offset {
  const hits = (workspace as any)._paneGuideHits(view) as Array<{ zone: DockDropZone; guideRect: { x: number; y: number; width: number; height: number } }>
  const hit = hits.find(candidate => candidate.zone === zone)
  if (!hit) throw new Error(`Missing pane guide ${zone}`)
  return {
    x: hit.guideRect.x + hit.guideRect.width / 2,
    y: hit.guideRect.y + hit.guideRect.height / 2,
  }
}

function workspaceGuidePoint(workspace: RenderDockWorkspace, zone: Exclude<DockDropZone, 'center'>): Offset {
  const hits = (workspace as any)._workspaceGuideHits() as Array<{ zone: DockDropZone; guideRect: { x: number; y: number; width: number; height: number } }>
  const hit = hits.find(candidate => candidate.zone === zone)
  if (!hit) throw new Error(`Missing workspace guide ${zone}`)
  return {
    x: hit.guideRect.x + hit.guideRect.width / 2,
    y: hit.guideRect.y + hit.guideRect.height / 2,
  }
}

function createPaintContext(): { context: PaintContext; fillText: ReturnType<typeof vi.fn> } {
  const fillText = vi.fn()
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText,
    measureText: vi.fn((text: string) => ({ width: text.length * 8 }) as TextMetrics),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    translate: vi.fn(),
    setLineDash: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    strokeStyle: '',
    fillStyle: '',
    font: '',
    lineWidth: 1,
    lineCap: 'round' as CanvasLineCap,
    lineJoin: 'round' as CanvasLineJoin,
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, ImGuiDarkTheme), fillText }
}

afterEach(() => {
  FocusManager.instance.dispose()
  vi.restoreAllMocks()
})

describe('DockWindowManager', () => {
  it('updates split ratios through readonly views and rejects stale or invalid targets', () => {
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new RenderText('A') })
    manager.openDocument({ tabId: 'b', title: 'B', content: new RenderText('B') })
    const root = manager.root
    if (root.type !== 'tabs') throw new Error('expected tabs')
    manager.dockWindow(manager.getDocument('b')!.window, root, 'right')
    const split = manager.root
    if (split.type !== 'split') throw new Error('expected split')
    const changed = vi.fn()
    const unsubscribe = manager.subscribe(changed)
    changed.mockClear()
    expect(manager.setSplitLayout(split, { ratio: 0.42 })).toBe(true)
    expect(split.ratio).toBe(0.42)
    expect(changed).toHaveBeenCalledOnce()
    changed.mockClear()
    expect(manager.setSplitLayout(split, { ratio: 0.42 })).toBe(true)
    expect(changed).not.toHaveBeenCalled()
    expect(manager.setSplitLayout(split, { ratio: NaN })).toBe(false)
    expect(manager.setSplitLayout(split, { ratio: 2 })).toBe(false)
    expect(manager.setSplitLayout({ ...split }, { ratio: 0.5 })).toBe(false)
    expect(manager.setSplitLayout(split, { direction: 'vertical' })).toBe(true)
    expect(split.direction).toBe('vertical')
    expect(changed).toHaveBeenCalledOnce()
    unsubscribe(); manager.dispose()
    expect(manager.setSplitLayout(split, { ratio: 0.5 })).toBe(false)
  })

  it('moves a window between tabbed and floating without disposing content', () => {
    const manager = new DockWindowManager()
    const content = new TestDocumentBox()
    manager.openDocument({ tabId: 'orders', title: 'Orders', content })
    const record = manager.getDocument('orders')!

    expect(record.window.presentation).toBe('tabbed')
    expect(record.window.chrome).toBe('standard')
    expect(manager.floatingWindows).toEqual([])

    expect(manager.floatWindow(record.window, { x: 80, y: 60, width: 360, height: 240 })).toBe(true)

    expect(record.window.presentation).toBe('floating')
    expect(manager.floatingWindows).toEqual([record.window])
    expect(content.disposed).toBe(false)

    expect(manager.dockWindow(record.window, manager.root as any, 'center')).toBe(true)

    expect(record.window.presentation).toBe('tabbed')
    expect(manager.floatingWindows).toEqual([])
    expect(content.disposed).toBe(false)
  })

  it('keeps floating window close chrome aligned with document closability', () => {
    const manager = new DockWindowManager()
    const content = new TestDocumentBox()
    manager.openDocument({
      tabId: 'inspector',
      title: 'Inspector',
      content,
      closable: false,
    })
    const record = manager.getDocument('inspector')!

    expect(record.closable).toBe(false)
    expect(record.window.showCloseButton).toBe(false)

    manager.floatWindow(record.window, { x: 80, y: 60, width: 360, height: 240 })

    expect(record.window.presentation).toBe('floating')
    expect(record.window.showCloseButton).toBe(false)

    manager.updateDocument('inspector', { closable: true })

    expect(record.closable).toBe(true)
    expect(record.window.showCloseButton).toBe(true)
  })

  it('keeps document app context stable while floating and disposes owned context on close', async () => {
    const manager = new DockWindowManager()
    const key = createAppContextKey<string>('encounter-id')
    const content = new TestDocumentBox()

    manager.openDocument({
      tabId: 'orders',
      title: 'Orders',
      content,
      contextValues: [[key, 'enc-1']],
    })

    const record = manager.getDocument('orders')!
    expect(record.content).toBe(content)
    expect(record.contentHost).not.toBe(content)
    expect(content.getAppContext(key)).toBe('enc-1')

    manager.floatWindow(record.window, { x: 40, y: 50, width: 360, height: 240 })
    expect(content.getAppContext(key)).toBe('enc-1')

    manager.dockWindow(record.window)
    expect(content.getAppContext(key)).toBe('enc-1')

    await expect(manager.closeDocument('orders')).resolves.toBe(true)

    expect(content.disposed).toBe(true)
    expect(record.appContext.disposed).toBe(true)
  })

  it('provides external app context to directly opened windows without owning it', async () => {
    const manager = new DockWindowManager()
    const key = createAppContextKey<string>('workspace')
    const external = new AppContextRegistry(undefined, [[key, 'external']])
    const window = new RenderWindow({ title: 'Custom' })
    const child = new TestDocumentBox()
    window.setChildren([child])

    manager.openWindow(window, {
      tabId: 'custom',
      title: 'Custom',
      context: external,
    })

    expect(manager.getDocument('custom')?.context.appContext).toBe(external)
    expect(child.getAppContext(key)).toBe('external')

    await expect(manager.closeDocument('custom')).resolves.toBe(true)

    expect(child.disposed).toBe(true)
    expect(external.disposed).toBe(false)
    external.dispose()
  })

  it('disposes external app context for directly opened windows when explicitly requested', async () => {
    const manager = new DockWindowManager()
    const key = createAppContextKey<string>('workspace')
    const external = new AppContextRegistry(undefined, [[key, 'owned-external']])
    const window = new RenderWindow({ title: 'Custom' })
    const child = new TestDocumentBox()
    window.setChildren([child])

    manager.openWindow(window, {
      tabId: 'custom',
      title: 'Custom',
      context: external,
      disposeContextOnClose: true,
    })

    expect(manager.getDocument('custom')?.context.appContext).toBe(external)
    expect(child.getAppContext(key)).toBe('owned-external')

    await expect(manager.closeDocument('custom')).resolves.toBe(true)

    expect(child.disposed).toBe(true)
    expect(external.disposed).toBe(true)
  })

  it('keeps a menu-floated window attached after the workspace syncs the old dock group', async () => {
    const owner = new PipelineOwner()
    const host = new RenderWindow({ title: 'Host' })
    host.attach(owner)
    const manager = new DockWindowManager()
    manager.setWindowHost(host)
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 300 })
    host.onOwnedWindowsChanged(({ added }) => {
      for (const window of added) window.attach(owner)
    })
    const view = [...(workspace as any)._groupViews.values()][0] as DockTabGroupView
    const record = manager.getDocument('a')!

    await (view as any)._handleTabContextMenuAction('a', 'float', { x: 80, y: 40 })

    expect(record.window.ownerWindow).toBe(host)
    expect(record.window.owner).toBe(owner)
    expect(record.window.parent).toBeUndefined()
    expect(record.window.presentation).toBe('floating')
  })

  it('keeps a menu-floated window floating when its title is dragged over the old tab header', async () => {
    const owner = new PipelineOwner()
    const host = new RenderWindow({ title: 'Host' })
    host.attach(owner)
    const manager = new DockWindowManager()
    manager.setWindowHost(host)
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 300 })
    host.onOwnedWindowsChanged(({ added }) => {
      for (const window of added) window.attach(owner)
    })
    const view = [...(workspace as any)._groupViews.values()][0] as DockTabGroupView
    const record = manager.getDocument('a')!

    await (view as any)._handleTabContextMenuAction('a', 'float', { x: 20, y: 8 })
    record.window.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 300 })
    record.window.onPointerDown({
      pointerId: 1,
      position: { x: 40, y: 18 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    record.window.onPointerMove({ pointerId: 1, position: { x: 70, y: 20 }, type: 'move' })
    record.window.onPointerUp({ pointerId: 1, position: { x: 70, y: 20 }, type: 'up' })

    expect(record.window.presentation).toBe('floating')
    expect(manager.floatingWindows).toEqual([record.window])
    expect(manager.root.type).toBe('tabs')
    if (manager.root.type === 'tabs') {
      expect(manager.root.windows.map(window => window.title)).toEqual(['B'])
    }
  })

  it('activates and brings forward an existing floating document', () => {
    const host = new RenderWindow({ title: 'Host' })
    const manager = new DockWindowManager()
    manager.setWindowHost(host)
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    const first = manager.getDocument('a')!
    const second = manager.getDocument('b')!

    expect(manager.floatWindow(first.window, { x: 40, y: 40, width: 320, height: 220 })).toBe(true)
    expect(manager.floatWindow(second.window, { x: 80, y: 80, width: 320, height: 220 })).toBe(true)
    expect(host.getOwnedWindows()).toEqual([first.window, second.window])

    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })

    expect(manager.activeTabId).toBe('a')
    expect(host.getOwnedWindows()).toEqual([second.window, first.window])
  })

  it('creates split nodes when docking to an edge', () => {
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    const rootGroup = manager.root
    const first = manager.getDocument('a')!

    expect(manager.dockWindow(first.window, rootGroup as any, 'left')).toBe(true)

    expect(manager.root.type).toBe('split')
    if (manager.root.type !== 'split') return
    expect(manager.root.direction).toBe('horizontal')
    expect(manager.root.ratio).toBeCloseTo(0.32)
    expect(manager.root.first.type).toBe('tabs')
    expect(manager.root.second.type).toBe('tabs')
    if (manager.root.first.type === 'tabs' && manager.root.second.type === 'tabs') {
      expect(manager.root.first.windows).toEqual([first.window])
      expect(manager.root.second.windows.map(window => window.title)).toEqual(['B'])
    }
  })

  it('closes tabs through close guards and disposes on confirmed close only', async () => {
    const manager = new DockWindowManager()
    const guarded = new TestDocumentBox()
    let allowClose = false
    manager.openDocument({
      tabId: 'guarded',
      title: 'Guarded',
      content: guarded,
      beforeClose: () => allowClose,
    })

    await expect(manager.closeDocument('guarded')).resolves.toBe(false)
    expect(manager.hasDocument('guarded')).toBe(true)
    expect(guarded.disposed).toBe(false)

    allowClose = true
    await expect(manager.closeDocument('guarded')).resolves.toBe(true)
    expect(manager.hasDocument('guarded')).toBe(false)
    expect(guarded.disposed).toBe(true)
  })

  it('keeps tab reorder when drag ends over the same group center', () => {
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'c', title: 'C', content: new TestDocumentBox() })
    const group = manager.root
    if (group.type !== 'tabs') throw new Error('Expected root tab group')
    const first = manager.getDocument('a')!
    manager.setDropResolver(() => ({
      group,
      zone: 'center',
      rect: { x: 0, y: 0, width: 500, height: 300 },
    }))

    manager.beginDrag(first.window, { x: 20, y: 12 })
    manager.moveDocument('a', 2)
    manager.endDrag({ x: 250, y: 150 })

    expect(group.windows.map(window => window.title)).toEqual(['B', 'C', 'A'])
    expect(manager.floatingWindows).toEqual([])
  })

  it('does not start dock drag while the tab pointer stays in the header strip', () => {
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'c', title: 'C', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })
    const view = [...(workspace as any)._groupViews.values()][0] as { tabs: RenderTabs }

    view.tabs.onTabDragStart?.('a', { x: 20, y: 10 })
    view.tabs.onTabDragMove?.('a', { x: 220, y: 10 })
    manager.moveDocument('a', 2)
    view.tabs.onTabDragEnd?.('a', { x: 220, y: 10 })

    expect(manager.root.type).toBe('tabs')
    if (manager.root.type === 'tabs') {
      expect(manager.root.windows.map(window => window.title)).toEqual(['B', 'C', 'A'])
    }
    expect(manager.dropTarget).toBeNull()
    expect(manager.floatingWindows).toEqual([])
  })

  it('starts dock drag only after the tab pointer leaves the header strip', () => {
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })
    const view = [...(workspace as any)._groupViews.values()][0] as DockTabGroupView
    const record = manager.getDocument('a')!

    view.tabs.onTabDragStart?.('a', { x: 20, y: 10 })
    expect(manager.dropTarget).toBeNull()

    view.tabs.onTabDragMove?.('a', { x: 40, y: 80 })
    expect(manager.isDraggingWindow(record.window)).toBe(true)
    expect(manager.dropTarget).toBeNull()

    const leftGuide = guidePoint(workspace, view, 'left')
    view.tabs.onTabDragMove?.('a', leftGuide)
    expect(manager.dropTarget?.zone).toBe('left')
    view.tabs.onTabDragEnd?.('a', leftGuide)

    expect(manager.root.type).toBe('split')
    if (manager.root.type === 'split') {
      expect(manager.root.direction).toBe('horizontal')
    }
  })

  it('cancels dock drag when the pointer returns to the tab header strip', () => {
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'c', title: 'C', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })
    const view = [...(workspace as any)._groupViews.values()][0] as DockTabGroupView

    view.tabs.onTabDragStart?.('a', { x: 20, y: 10 })
    view.tabs.onTabDragMove?.('a', { x: 40, y: 80 })
    view.tabs.onTabDragMove?.('a', guidePoint(workspace, view, 'left'))
    expect(manager.dropTarget).not.toBeNull()

    view.tabs.onTabDragMove?.('a', { x: 220, y: 10 })
    manager.moveDocument('a', 2)
    view.tabs.onTabDragEnd?.('a', { x: 220, y: 10 })

    expect(manager.root.type).toBe('tabs')
    if (manager.root.type === 'tabs') {
      expect(manager.root.windows.map(window => window.title)).toEqual(['B', 'C', 'A'])
    }
    expect(manager.dropTarget).toBeNull()
    expect(manager.floatingWindows).toEqual([])
  })

  it('clears dock drag state when tab dragging is cancelled', () => {
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })
    const view = [...(workspace as any)._groupViews.values()][0] as DockTabGroupView
    const record = manager.getDocument('a')!

    view.tabs.onTabDragStart?.('a', { x: 20, y: 10 })
    view.tabs.onTabDragMove?.('a', { x: 40, y: 80 })
    view.tabs.onTabDragMove?.('a', guidePoint(workspace, view, 'left'))
    expect(manager.isDraggingWindow(record.window)).toBe(true)
    expect(manager.dropTarget).not.toBeNull()

    view.tabs.onTabDragCancel?.('a', { x: 40, y: 80 })

    expect(manager.isDraggingWindow(record.window)).toBe(false)
    expect(manager.dropTarget).toBeNull()
  })

  it('clears dock drag state when floating window dragging is cancelled', () => {
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    const record = manager.getDocument('a')!
    const group = manager.root
    if (group.type !== 'tabs') throw new Error('Expected root tab group')
    manager.setDropResolver(() => ({
      group,
      zone: 'center',
      rect: { x: 0, y: 0, width: 500, height: 300 },
    }))

    expect(manager.floatWindow(record.window, { x: 40, y: 40, width: 320, height: 220 })).toBe(true)
    record.window.attach(owner)
    record.window.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 300 })
    record.window.onPointerDown({
      pointerId: 1,
      position: { x: 64, y: 52 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    record.window.onPointerMove({ pointerId: 1, position: { x: 90, y: 80 }, type: 'move' })

    expect(manager.isDraggingWindow(record.window)).toBe(true)
    expect(manager.dropTarget).not.toBeNull()

    owner.flushPaint(createPaintContext().context)
    const draggedBounds = { ...record.window.paintBounds }

    record.window.onPointerCancel({ pointerId: 1, position: { x: 90, y: 80 }, type: 'cancel' })

    const restoredBounds = record.window.paintBounds
    const expectedDamage = {
      x: Math.min(draggedBounds.x, restoredBounds.x),
      y: Math.min(draggedBounds.y, restoredBounds.y),
      width: Math.max(draggedBounds.x + draggedBounds.width, restoredBounds.x + restoredBounds.width) -
        Math.min(draggedBounds.x, restoredBounds.x),
      height: Math.max(draggedBounds.y + draggedBounds.height, restoredBounds.y + restoredBounds.height) -
        Math.min(draggedBounds.y, restoredBounds.y),
    }

    expect(manager.isDraggingWindow(record.window)).toBe(false)
    expect(manager.dropTarget).toBeNull()
    expect(record.window.windowX).toBe(40)
    expect(record.window.windowY).toBe(40)
    expect(owner.getDirtyPaintRectInSubtree(record.window)).toEqual(expectedDamage)
    record.window.detach()
  })

  it('keeps a floating window at its moved position when dropped outside guides', () => {
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    const record = manager.getDocument('a')!
    manager.setDropResolver(() => null)

    expect(manager.floatWindow(record.window, { x: 40, y: 40, width: 320, height: 220 })).toBe(true)
    record.window.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 300 })
    record.window.onPointerDown({
      pointerId: 1,
      position: { x: 64, y: 52 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    record.window.onPointerMove({ pointerId: 1, position: { x: 140, y: 120 }, type: 'move' })

    expect(record.window.windowX).not.toBe(40)
    expect(record.window.windowY).not.toBe(40)

    record.window.onPointerUp({ pointerId: 1, position: { x: 140, y: 120 }, type: 'up' })

    expect(manager.floatingWindows).toEqual([record.window])
    expect(record.window.windowX).not.toBe(40)
    expect(record.window.windowY).not.toBe(40)
  })

  it('keeps a floated document active and activates the fallback tab after closing the active tab', async () => {
    const manager = new DockWindowManager()
    const first = new LifecycleDocumentBox()
    const second = new LifecycleDocumentBox()
    manager.openDocument({ tabId: 'a', title: 'A', content: first })
    manager.openDocument({ tabId: 'b', title: 'B', content: second })
    first.activationCount = 0
    first.deactivationCount = 0
    second.activationCount = 0
    second.deactivationCount = 0

    expect(manager.floatWindow(manager.getDocument('b')!.window)).toBe(true)

    expect(manager.activeTabId).toBe('b')
    expect(first.activationCount).toBe(0)
    expect(second.deactivationCount).toBe(0)

    manager.dockWindow(manager.getDocument('b')!.window, manager.root as any, 'center')
    first.activationCount = 0
    first.deactivationCount = 0
    second.activationCount = 0
    second.deactivationCount = 0

    await expect(manager.closeDocument('b')).resolves.toBe(true)

    expect(first.activationCount).toBe(1)
    expect(second.deactivationCount).toBe(1)
  })

  it('activates a docked split window when its content is clicked', () => {
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'left', title: 'Left', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'right', title: 'Right', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })
    const root = manager.root
    if (root.type !== 'tabs') throw new Error('Expected root tab group')
    const left = manager.getDocument('left')!
    const right = manager.getDocument('right')!

    manager.dockWindow(left.window, root, 'left')
    workspace.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })
    manager.activateWindow(right.window)

    const path = new HitTestResult()
    const position = {
      x: left.window.globalOffset.x + 12,
      y: left.window.globalOffset.y + 12,
    }
    expect(workspace.hitTestPath(position, path)).toBe(true)

    left.window.onPointerDown({
      pointerId: 1,
      position,
      type: 'down',
      path,
    })

    expect(manager.activeTabId).toBe('left')
  })

  it('activates a floating window when its content is clicked', () => {
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    const first = manager.getDocument('a')!
    const second = manager.getDocument('b')!

    expect(manager.floatWindow(first.window, { x: 40, y: 40, width: 320, height: 220 })).toBe(true)
    manager.activateWindow(second.window)
    first.window.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })

    first.window.onPointerDown({
      pointerId: 1,
      position: { x: 80, y: 110 },
      type: 'down',
    })

    expect(manager.activeTabId).toBe('a')
  })

  it('rejects docking into a stale tab group without removing the window from the live layout', () => {
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    const first = manager.getDocument('a')!
    const staleGroup = {
      type: 'tabs',
      id: 'stale',
      windows: [],
      activeWindow: null,
    } as any

    expect(manager.dockWindow(first.window, staleGroup, 'left')).toBe(false)

    expect(manager.root.type).toBe('tabs')
    if (manager.root.type === 'tabs') {
      expect(manager.root.windows.map(window => window.title)).toEqual(['A', 'B'])
    }
  })

  it('does not close unclosable documents through the manager', async () => {
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'pinned', title: 'Pinned', content: new TestDocumentBox(), closable: false })

    await expect(manager.closeDocument('pinned')).resolves.toBe(false)

    expect(manager.hasDocument('pinned')).toBe(true)
  })

  it('returns to an empty root tab group after closing the last docked document', async () => {
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })

    await expect(manager.closeDocument('a')).resolves.toBe(true)

    expect(manager.hasDockedDocuments).toBe(false)
    expect(manager.root.type).toBe('tabs')
    if (manager.root.type === 'tabs') {
      expect(manager.root.windows).toEqual([])
      expect(manager.root.activeWindow).toBeNull()
    }
  })
})

describe('RenderDockWorkspace', () => {
  it('reports center and edge drop zones for the rendered tab group', () => {
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 300 })
    const view = [...(workspace as any)._groupViews.values()][0] as DockTabGroupView

    expect(workspace.hitTestDrop({ x: 250, y: 20 })?.zone).toBe('center')
    expect(workspace.hitTestDrop({ x: 120, y: view.tabs.size.height + 8 })).toBeNull()
    expect(workspace.hitTestDrop(guidePoint(workspace, view, 'center'))?.zone).toBe('center')
    expect(workspace.hitTestDrop(guidePoint(workspace, view, 'left'))?.zone).toBe('left')
    expect(workspace.hitTestDrop(guidePoint(workspace, view, 'right'))?.zone).toBe('right')
    expect(workspace.hitTestDrop(guidePoint(workspace, view, 'top'))?.zone).toBe('top')
    expect(workspace.hitTestDrop(guidePoint(workspace, view, 'bottom'))?.zone).toBe('bottom')
  })

  it('uses the empty workspace body as a center dock target', async () => {
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 300 })

    await manager.closeDocument('a')
    workspace.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 300 })

    const target = workspace.hitTestDrop({ x: 260, y: 180 })
    expect(target?.zone).toBe('center')
    expect(target?.group.windows).toEqual([])
  })

  it('docks a floating window back into an empty workspace from the center guide', () => {
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    const record = manager.getDocument('a')!
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 300 })

    expect(manager.floatWindow(record.window, { x: 40, y: 40, width: 320, height: 220 })).toBe(true)
    workspace.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 300 })
    expect(manager.hasDockedDocuments).toBe(false)
    const view = [...(workspace as any)._groupViews.values()][0] as DockTabGroupView
    const centerGuide = guidePoint(workspace, view, 'center')

    manager.beginDrag(record.window, centerGuide)
    manager.endDrag(centerGuide)

    expect(manager.floatingWindows).toEqual([])
    expect(manager.hasDockedDocuments).toBe(true)
    expect(manager.root.type).toBe('tabs')
    if (manager.root.type === 'tabs') {
      expect(manager.root.windows).toEqual([record.window])
    }
    expect(record.window.presentation).toBe('tabbed')
  })

  it('paints an empty state when no documents are docked', async () => {
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 300 })

    await manager.closeDocument('a')
    workspace.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 300 })
    const painted = createPaintContext()

    workspace.performPaint(painted.context, { x: 0, y: 0 })

    expect(painted.fillText.mock.calls.some(call => call[0] === '暂无 Dock 文档')).toBe(true)
    expect(painted.fillText.mock.calls.some(call => call[0] === '打开页面或将浮窗拖回工作区')).toBe(true)
  })

  it('uses DockWorkbench theme tokens for legacy drop previews and guide buttons', () => {
    const workspace = new RenderDockWorkspace({ manager: new DockWindowManager() })
    const style = deriveDockWorkbenchStyle(ImGuiDarkTheme)
    const dl = {
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      line: vi.fn(),
    }
    const target = {
      group: workspace.manager.root,
      zone: 'center',
      scope: 'pane',
      rect: { x: 0, y: 0, width: 200, height: 100 },
      previewRect: { x: 20, y: 10, width: 80, height: 40 },
    }

    ;(workspace as any)._paintDropPreview(dl, target, style)
    expect(dl.fillRect).toHaveBeenCalledWith(20, 10, 80, 40, style.dropPreviewBg, 3)
    expect(dl.strokeRect).toHaveBeenCalledWith(20, 10, 80, 40, style.dropPreviewBorder, 1, 3)

    dl.fillRect.mockClear()
    dl.strokeRect.mockClear()
    ;(workspace as any)._paintDockGuideButton(dl, {
      zone: 'center',
      scope: 'pane',
      group: workspace.manager.root,
      rect: target.rect,
      previewRect: target.previewRect,
      guideRect: { x: 40, y: 30, width: 36, height: 36 },
    }, true, style)

    expect(dl.fillRect).toHaveBeenNthCalledWith(1, 40, 30, 36, 36, style.guideShadowActiveBg, 5)
    expect(dl.fillRect).toHaveBeenNthCalledWith(2, 40, 29, 36, 36, style.guideButtonActiveBg, 5)
    expect(dl.strokeRect).toHaveBeenCalledWith(40, 29, 36, 36, style.guideButtonActiveBorder, 2, 5)
  })

  it('uses workspace guides to split the whole root layout', () => {
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'c', title: 'C', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })
    const root = manager.root
    if (root.type !== 'tabs') throw new Error('Expected root tab group')
    manager.dockWindow(manager.getDocument('a')!.window, root, 'left')
    workspace.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })

    const views = [...(workspace as any)._groupViews.values()] as DockTabGroupView[]
    const groupWithC = views.find(view => view.group.windows.some(window => window.title === 'C'))
    if (!groupWithC) throw new Error('Expected group with C')
    const header = groupWithC.tabs.globalOffset
    const rightGuide = workspaceGuidePoint(workspace, 'right')

    groupWithC.tabs.onTabDragStart?.('c', { x: header.x + 12, y: header.y + 10 })
    groupWithC.tabs.onTabDragMove?.('c', { x: header.x + 12, y: header.y + groupWithC.tabs.size.height + 20 })
    groupWithC.tabs.onTabDragMove?.('c', rightGuide)

    expect(manager.dropTarget?.scope).toBe('workspace')
    expect(manager.dropTarget?.zone).toBe('right')

    groupWithC.tabs.onTabDragEnd?.('c', rightGuide)

    expect(manager.root.type).toBe('split')
    if (manager.root.type === 'split') {
      expect(manager.root.direction).toBe('horizontal')
      expect(manager.root.ratio).toBeCloseTo(0.68)
      expect(manager.root.second.type).toBe('tabs')
      if (manager.root.second.type === 'tabs') {
        expect(manager.root.second.windows.map(window => window.title)).toEqual(['C'])
      }
    }
  })

  it('handles close and split actions from the dock tab context menu', async () => {
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'pinned', title: 'Pinned', content: new TestDocumentBox(), closable: false })
    manager.openDocument({ tabId: 'c', title: 'C', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })
    const view = [...(workspace as any)._groupViews.values()][0] as DockTabGroupView

    await (view as any)._handleTabContextMenuAction('b', 'close-right', { x: 0, y: 0 })

    expect(manager.documents.map(document => document.tabId)).toEqual(['a', 'b', 'pinned'])

    await (view as any)._handleTabContextMenuAction('b', 'close-others', { x: 0, y: 0 })

    expect(manager.documents.map(document => document.tabId)).toEqual(['b', 'pinned'])

    await (view as any)._handleTabContextMenuAction('b', 'close-all', { x: 0, y: 0 })

    expect(manager.documents.map(document => document.tabId)).toEqual(['pinned'])
  })

  it('creates vertical and horizontal tab groups from the dock tab context menu', async () => {
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    const verticalWorkspace = new RenderDockWorkspace({ manager })
    verticalWorkspace.attach(owner)
    verticalWorkspace.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })
    const verticalView = [...(verticalWorkspace as any)._groupViews.values()][0] as DockTabGroupView

    await (verticalView as any)._handleTabContextMenuAction('b', 'new-vertical-group', { x: 0, y: 0 })

    expect(manager.root.type).toBe('split')
    if (manager.root.type === 'split') {
      expect(manager.root.direction).toBe('horizontal')
      expect(manager.root.second.type).toBe('tabs')
      if (manager.root.second.type === 'tabs') {
        expect(manager.root.second.windows.map(window => window.title)).toEqual(['B'])
      }
    }

    const horizontalManager = new DockWindowManager()
    horizontalManager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    horizontalManager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    const horizontalWorkspace = new RenderDockWorkspace({ manager: horizontalManager })
    horizontalWorkspace.attach(owner)
    horizontalWorkspace.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })
    const horizontalView = [...(horizontalWorkspace as any)._groupViews.values()][0] as DockTabGroupView

    await (horizontalView as any)._handleTabContextMenuAction('b', 'new-horizontal-group', { x: 0, y: 0 })

    expect(horizontalManager.root.type).toBe('split')
    if (horizontalManager.root.type === 'split') {
      expect(horizontalManager.root.direction).toBe('vertical')
      expect(horizontalManager.root.second.type).toBe('tabs')
      if (horizontalManager.root.second.type === 'tabs') {
        expect(horizontalManager.root.second.windows.map(window => window.title)).toEqual(['B'])
      }
    }
  })

  it('handles Ctrl+Tab switching and Ctrl+W close shortcuts from descendants', async () => {
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'c', title: 'C', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    const switchEvent = {
      key: 'Tab',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: true,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent

    expect(workspace.handleUnhandledKeyDownFromDescendant({} as any, switchEvent)).toBe(true)
    expect(switchEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(manager.activeTabId).toBe('b')

    const closeEvent = {
      key: 'w',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent

    expect(workspace.handleUnhandledKeyDownFromDescendant({} as any, closeEvent)).toBe(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(manager.hasDocument('b')).toBe(false)
  })

  it('switches to floating documents with Ctrl+Tab instead of stalling', () => {
    const host = new RenderWindow({ title: 'Host' })
    const manager = new DockWindowManager()
    manager.setWindowHost(host)
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    const first = manager.getDocument('a')!
    const second = manager.getDocument('b')!
    const workspace = new RenderDockWorkspace({ manager })
    manager.floatWindow(second.window, { x: 80, y: 60, width: 320, height: 220 })
    manager.activateWindow(first.window)
    const switchEvent = {
      key: 'Tab',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent

    expect(workspace.handleUnhandledKeyDownFromDescendant({} as any, switchEvent)).toBe(true)

    expect(switchEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(manager.activeTabId).toBe('b')
    expect(host.getOwnedWindows()).toEqual([second.window])
  })

  it('disposes tab strip resources when a dock group is pruned', async () => {
    const disposeTabs = vi.spyOn(RenderTabs.prototype, 'dispose')
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'a', title: 'A', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'b', title: 'B', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 300 })
    const root = manager.root
    if (root.type !== 'tabs') throw new Error('Expected root tab group')
    manager.dockWindow(manager.getDocument('a')!.window, root, 'left')
    workspace.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 300 })

    await manager.closeDocument('a')

    expect(disposeTabs).toHaveBeenCalled()
  })

  it('keeps the moved left split window parented after pruning the original tab group view', () => {
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'controls', title: 'Controls', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'forms', title: 'Forms', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })
    const originalGroup = manager.root
    if (originalGroup.type !== 'tabs') throw new Error('Expected root tab group')
    const forms = manager.getDocument('forms')!

    manager.dockWindow(forms.window, originalGroup, 'left')
    workspace.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })

    expect(forms.window.parent).toBeDefined()
    const result = new HitTestResult()
    expect(workspace.hitTestPath({ x: 40, y: 60 }, result)).toBe(true)
    expect(result.contains(forms.window)).toBe(true)
  })

  it('merges a split tab into another group when dropped on its tab header', () => {
    const owner = new PipelineOwner()
    const manager = new DockWindowManager()
    manager.openDocument({ tabId: 'controls', title: 'Controls', content: new TestDocumentBox() })
    manager.openDocument({ tabId: 'forms', title: 'Forms', content: new TestDocumentBox() })
    const workspace = new RenderDockWorkspace({ manager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })
    const originalGroup = manager.root
    if (originalGroup.type !== 'tabs') throw new Error('Expected root tab group')

    manager.dockWindow(manager.getDocument('forms')!.window, originalGroup, 'left')
    workspace.layout({ minWidth: 0, maxWidth: 600, minHeight: 0, maxHeight: 360 })

    const views = [...(workspace as any)._groupViews.values()] as DockTabGroupView[]
    const formsView = views.find(view => view.group.windows.some(window => window.title === 'Forms'))
    const controlsView = views.find(view => view.group.windows.some(window => window.title === 'Controls'))
    if (!formsView || !controlsView) throw new Error('Expected both split groups')
    const formsHeader = formsView.tabs.globalOffset
    const controlsHeader = controlsView.tabs.globalOffset

    formsView.tabs.onTabDragStart?.('forms', { x: formsHeader.x + 12, y: formsHeader.y + 10 })
    formsView.tabs.onTabDragMove?.('forms', {
      x: formsHeader.x + 12,
      y: formsHeader.y + formsView.tabs.size.height + 20,
    })
    formsView.tabs.onTabDragMove?.('forms', { x: controlsHeader.x + 12, y: controlsHeader.y + 10 })

    expect(manager.dropTarget?.zone).toBe('center')

    formsView.tabs.onTabDragEnd?.('forms', { x: controlsHeader.x + 12, y: controlsHeader.y + 10 })

    expect(manager.root.type).toBe('tabs')
    if (manager.root.type === 'tabs') {
      expect(manager.root.windows.map(window => window.title)).toEqual(['Controls', 'Forms'])
    }
    expect(manager.floatingWindows).toEqual([])
  })
})

describe('RenderWindow docked presentation', () => {
  it('lays out content without chrome and uses parent-relative hit testing', () => {
    const win = new RenderWindow({
      title: 'Docked',
      x: 80,
      y: 60,
      width: 300,
      height: 200,
    })
    const content = new TestDocumentBox()
    win.setChildren([content])
    win.setPresentation('tabbed')
    win.offset = { x: 10, y: 20 }

    win.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 240 })

    expect(win.size).toEqual({ width: 500, height: 240 })
    expect(content.offset).toEqual({ x: 0, y: 0 })
    expect(content.size).toEqual({ width: 500, height: 240 })
    expect(win.hitTest({ x: 12, y: 22 })).toBe(true)
    expect(win.hitTest({ x: 82, y: 62 })).toBe(true)
    expect(win.hitTest({ x: 4, y: 22 })).toBe(false)
  })
})
