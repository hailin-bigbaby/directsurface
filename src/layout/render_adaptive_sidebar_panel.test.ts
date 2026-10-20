// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager, type Focusable } from '../core/focus_manager'
import { PopupManager, type Popup } from '../core/popup_manager'
import type { BoxConstraints, LayoutContext, RenderObject } from '../core/render_object'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../theme/default_theme'
import { createTheme } from '../theme/theme'
import { RenderBox } from './render_box'
import { RenderGridPanel, gridFr } from './render_grid_panel'
import { RenderAdaptiveSidebarPanel } from './render_adaptive_sidebar_panel'

class FixedBox extends RenderBox {
  constructor(
    private readonly desiredWidth: number,
    private readonly desiredHeight: number,
  ) {
    super()
  }

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    this.size = {
      width: Math.max(constraints.minWidth, Math.min(constraints.maxWidth, this.desiredWidth)),
      height: Math.max(constraints.minHeight, Math.min(constraints.maxHeight, this.desiredHeight)),
    }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}
}

class FocusableFixedBox extends FixedBox implements Focusable {
  private _focused = false

  get isFocused(): boolean { return this._focused }
  focusIn(): void { this._focused = true }
  focusOut(): void { this._focused = false }
}

class ContainerBox extends FixedBox {
  readonly children: RenderBox[] = []

  addChild(child: RenderBox): void {
    child.parent = this
    this.children.push(child)
  }

  override visitChildren(visitor: (child: RenderObject) => void): void {
    for (const child of this.children) visitor(child)
  }
}

afterEach(() => {
  PopupManager.instance.dispose()
  FocusManager.disposeInstance()
})

describe('RenderAdaptiveSidebarPanel', () => {
  it('automatically replaces the expanded sidebar when the available width crosses the breakpoint', () => {
    const sidebar = new FixedBox(240, 300)
    const compactSidebar = new FixedBox(56, 300)
    const content = new FixedBox(800, 300)
    const panel = new RenderAdaptiveSidebarPanel({
      sidebar,
      collapsedSidebar: compactSidebar,
      content,
      breakpoint: 720,
      sidebarWidth: 240,
      collapsedSidebarWidth: 56,
      gap: 12,
    })

    panel.layout({ minWidth: 0, maxWidth: 1024, minHeight: 0, maxHeight: 600 })
    expect(panel.debugState()).toEqual({
      mode: 'auto',
      resolvedMode: 'expanded',
      side: 'left',
      availableWidth: 1024,
      sidebarWidth: 240,
      contentWidth: 772,
    })
    expect(sidebar.offset).toEqual({ x: 0, y: 0 })
    expect(content.offset).toEqual({ x: 252, y: 0 })
    expect(sidebar.size.height).toBe(600)
    expect(content.size.height).toBe(600)

    panel.layout({ minWidth: 0, maxWidth: 480, minHeight: 0, maxHeight: 600 })
    expect(panel.debugState()).toMatchObject({
      resolvedMode: 'collapsed',
      sidebarWidth: 56,
      contentWidth: 412,
    })
    expect(compactSidebar.offset).toEqual({ x: 0, y: 0 })
    expect(content.offset).toEqual({ x: 68, y: 0 })
  })

  it('lets content fill the full width when collapsed mode has no compact sidebar', () => {
    const sidebar = new FixedBox(240, 300)
    const content = new FixedBox(800, 300)
    const panel = new RenderAdaptiveSidebarPanel({ sidebar, content, breakpoint: 720, gap: 12 })

    panel.layout({ minWidth: 0, maxWidth: 320, minHeight: 0, maxHeight: 480 })

    expect(panel.debugState()).toMatchObject({
      resolvedMode: 'collapsed',
      sidebarWidth: 0,
      contentWidth: 320,
    })
    expect(content.offset).toEqual({ x: 0, y: 0 })
    const paintedChildren: RenderObject[] = []
    panel.visitContentChildren(child => paintedChildren.push(child))
    expect(paintedChildren).toEqual([content])
  })

  it('supports right-side placement and explicit mode overrides', () => {
    const sidebar = new FixedBox(220, 300)
    const compactSidebar = new FixedBox(48, 300)
    const content = new FixedBox(800, 300)
    const panel = new RenderAdaptiveSidebarPanel({
      sidebar,
      collapsedSidebar: compactSidebar,
      content,
      mode: 'expanded',
      side: 'right',
      breakpoint: 1200,
      sidebarWidth: 220,
      collapsedSidebarWidth: 48,
      gap: 10,
    })

    panel.layout({ minWidth: 0, maxWidth: 700, minHeight: 0, maxHeight: 400 })
    expect(panel.resolvedMode).toBe('expanded')
    expect(content.offset.x).toBe(0)
    expect(sidebar.offset.x).toBe(480)

    panel.mode = 'collapsed'
    panel.layout({ minWidth: 0, maxWidth: 700, minHeight: 0, maxHeight: 400 })
    expect(panel.resolvedMode).toBe('collapsed')
    expect(content.size.width).toBe(642)
    expect(compactSidebar.offset.x).toBe(652)
  })

  it('removes the inactive sidebar from focus traversal and closes its owned popups', () => {
    const sidebar = new FocusableFixedBox(240, 300)
    const compactSidebar = new FocusableFixedBox(56, 300)
    const content = new FocusableFixedBox(800, 300)
    const panel = new RenderAdaptiveSidebarPanel({
      sidebar,
      collapsedSidebar: compactSidebar,
      content,
      breakpoint: 720,
    })
    const popupClose = vi.fn()
    const popup: Popup = {
      hitTest: () => false,
      close: popupClose,
    }
    const manager = FocusManager.instance
    manager.setRootResolver(() => [panel])
    manager.register(sidebar)
    manager.register(compactSidebar)
    manager.register(content)

    panel.layout({ minWidth: 0, maxWidth: 1024, minHeight: 0, maxHeight: 600 })
    manager.setFocus(sidebar)
    PopupManager.instance.open(popup, { owner: sidebar })

    panel.layout({ minWidth: 0, maxWidth: 480, minHeight: 0, maxHeight: 600 })

    expect(manager.current).toBe(null)
    expect(popupClose).toHaveBeenCalledOnce()
    manager.setFocus(sidebar)
    expect(manager.current).toBe(null)
    manager.setFocus(compactSidebar)
    expect(manager.current).toBe(compactSidebar)
  })

  it('cleans the provisional expanded subtree when the first layout resolves collapsed', () => {
    const sidebar = new FocusableFixedBox(240, 300)
    const compactSidebar = new FocusableFixedBox(56, 300)
    const content = new FixedBox(800, 300)
    const panel = new RenderAdaptiveSidebarPanel({
      sidebar,
      collapsedSidebar: compactSidebar,
      content,
      breakpoint: 720,
    })
    const close = vi.fn()
    const popup: Popup = { hitTest: () => false, close }
    const manager = FocusManager.instance
    manager.setRootResolver(() => [panel])
    manager.register(sidebar)
    manager.setFocus(sidebar)
    PopupManager.instance.open(popup, { owner: sidebar })

    panel.layout({ minWidth: 0, maxWidth: 480, minHeight: 0, maxHeight: 600 })

    expect(panel.resolvedMode).toBe('collapsed')
    expect(manager.current).toBe(null)
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes independent popup roots from a snapshotted inactive render subtree', () => {
    const sidebar = new ContainerBox(240, 300)
    const descendant = new FixedBox(40, 40)
    sidebar.addChild(descendant)
    const compactSidebar = new FixedBox(56, 300)
    const content = new FixedBox(800, 300)
    const panel = new RenderAdaptiveSidebarPanel({
      sidebar,
      collapsedSidebar: compactSidebar,
      content,
      breakpoint: 720,
    })
    const childClose = vi.fn()
    const childPopup: Popup = { hitTest: () => false, close: childClose }
    const rootClose = vi.fn(() => {
      descendant.parent = undefined
      sidebar.children.length = 0
    })
    const rootPopup: Popup = { hitTest: () => false, close: rootClose }

    panel.layout({ minWidth: 0, maxWidth: 1024, minHeight: 0, maxHeight: 600 })
    PopupManager.instance.open(rootPopup, { owner: sidebar })
    PopupManager.instance.open(childPopup, { owner: descendant })

    panel.layout({ minWidth: 0, maxWidth: 480, minHeight: 0, maxHeight: 600 })

    expect(rootClose).toHaveBeenCalledOnce()
    expect(childClose).toHaveBeenCalledOnce()
    expect(PopupManager.instance.stack).toEqual([])
  })

  it('normalizes invalid numeric options consistently in construction and setters', () => {
    const panel = new RenderAdaptiveSidebarPanel({
      sidebar: new FixedBox(240, 300),
      collapsedSidebar: new FixedBox(56, 300),
      content: new FixedBox(800, 300),
      breakpoint: Number.NaN,
      sidebarWidth: Number.POSITIVE_INFINITY,
      collapsedSidebarWidth: -10,
      gap: Number.NaN,
    })

    expect(panel.breakpoint).toBe(720)
    expect(panel.sidebarWidth).toBe(240)
    expect(panel.collapsedSidebarWidth).toBe(0)
    expect(panel.gap).toBeUndefined()

    panel.breakpoint = Number.NaN
    panel.sidebarWidth = Number.NaN
    panel.collapsedSidebarWidth = Number.POSITIVE_INFINITY
    panel.gap = -5

    expect(panel.breakpoint).toBe(720)
    expect(panel.sidebarWidth).toBe(240)
    expect(panel.collapsedSidebarWidth).toBe(56)
    expect(panel.gap).toBe(0)
  })

  it('derives its natural width from the expanded sidebar and content under loose constraints', () => {
    const sidebar = new FixedBox(240, 180)
    const content = new FixedBox(360, 220)
    const panel = new RenderAdaptiveSidebarPanel({ sidebar, content, gap: 12 })

    panel.layout({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity })

    expect(panel.size).toEqual({ width: 612, height: 220 })
    expect(panel.debugState()).toMatchObject({
      resolvedMode: 'expanded',
      sidebarWidth: 240,
      contentWidth: 360,
    })
  })

  it('keeps the responsive geometry stable across supported widths and light, dark and custom themes', () => {
    const widths = [320, 480, 768, 1024, 1440]
    const themes = [ImGuiDarkTheme, ImGuiLightTheme]

    for (const theme of themes) {
      const sidebar = new FixedBox(240, 300)
      const compactSidebar = new FixedBox(56, 300)
      const content = new FixedBox(1200, 300)
      const panel = new RenderAdaptiveSidebarPanel({
        sidebar,
        collapsedSidebar: compactSidebar,
        content,
        breakpoint: 720,
        sidebarWidth: 240,
        collapsedSidebarWidth: 56,
        gap: 12,
      })

      for (const width of widths) {
        panel.layout({ minWidth: 0, maxWidth: width, minHeight: 0, maxHeight: 640 }, false, { theme })
        const state = panel.debugState()
        expect(state.resolvedMode).toBe(width < 720 ? 'collapsed' : 'expanded')
        expect(state.sidebarWidth + (state.sidebarWidth > 0 ? 12 : 0) + state.contentWidth).toBe(width)
        expect(content.offset.x + content.size.width).toBeLessThanOrEqual(width)
      }
    }
  })

  it('rejects duplicate children and children already owned by another parent', () => {
    const child = new FixedBox(100, 100)
    expect(() => new RenderAdaptiveSidebarPanel({ sidebar: child, content: child })).toThrow(/distinct children/)

    const owner = new RenderAdaptiveSidebarPanel({
      sidebar: new FixedBox(100, 100),
      content: new FixedBox(100, 100),
    })
    expect(() => new RenderAdaptiveSidebarPanel({
      sidebar: owner.sidebar,
      content: new FixedBox(100, 100),
    })).toThrow(/already has a parent/)
  })
})

describe('AdaptiveSidebar measurement isolation', () => {
  it('preserves active children, focus and an owned passive popup across speculative breakpoints', () => {
    const sidebar = new FocusableFixedBox(240, 80), compact = new FocusableFixedBox(56, 80)
    const panel = new RenderAdaptiveSidebarPanel({ sidebar, collapsedSidebar: compact, content: new FixedBox(400, 80) })
    const focus = FocusManager.instance
    focus.setRootResolver(() => [panel]); focus.register(sidebar); focus.register(compact)
    panel.layout({ minWidth: 0, maxWidth: 1000, minHeight: 0, maxHeight: 300 })
    focus.setFocus(sidebar)
    const close = vi.fn()
    const popup: Popup = { hitTest: () => false, close }
    PopupManager.instance.open(popup, { owner: sidebar, interactionMode: 'passive' })
    expect(focus.current).toBe(sidebar)
    const before = panel.debugState(), sidebarSize = { ...sidebar.size }
    panel.measure({ minWidth: 0, maxWidth: 400, minHeight: 0, maxHeight: Infinity })
    expect(panel.debugState()).toEqual(before)
    expect(sidebar.size).toEqual(sidebarSize)
    expect(focus.current).toBe(sidebar)
    expect(close).not.toHaveBeenCalled()
    expect(PopupManager.instance.stack).toContain(popup)
    panel.layout({ minWidth: 0, maxWidth: 400, minHeight: 0, maxHeight: 300 })
    expect(close).toHaveBeenCalledOnce()
    expect(focus.current).toBe(null)
    panel.dispose()
  })

  it('preserves compact-sidebar focus through a parent Grid relayout without resizing', () => {
    const sidebar = new FocusableFixedBox(240, 80), compact = new FocusableFixedBox(56, 80)
    const panel = new RenderAdaptiveSidebarPanel({ sidebar, collapsedSidebar: compact, content: new FixedBox(400, 80) })
    const grid = new RenderGridPanel({ columns: [gridFr()], rows: [gridFr()] })
    grid.addChild(panel)
    const focus = FocusManager.instance
    focus.setRootResolver(() => [grid]); focus.register(compact)
    const constraints = { minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 300 }
    grid.layout(constraints); focus.setFocus(compact); grid.layout(constraints)
    expect(focus.current).toBe(compact)
    grid.dispose()
  })
})
