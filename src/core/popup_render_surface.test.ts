import { describe, expect, it, vi } from 'vitest'
import { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { PopupRenderNode, PopupRenderSurface } from './popup_render_surface'
import { OverlayInvalidator } from './overlay_invalidator'

function popupContext() {
  return {
    theme: ImGuiDarkTheme,
    viewport: { width: 320, height: 240, dpr: 1 },
  }
}

function createPaintContext(): PaintContext {
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
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  return new PaintContext(ctx, ImGuiDarkTheme)
}

describe('Popup paint request tracking', () => {
  it('retains a popup repaint requested from inside its paint callback', () => {
    const invalidate = vi.fn()
    OverlayInvalidator.instance.setPaintInvalidator(invalidate)
    let requestNext = false
    const root = new PopupRenderNode({ paint: node => {
      if (!requestNext) return
      requestNext = false
      node.markNeedsPaint()
    } })
    const surface = new PopupRenderSurface(root, node => {
      node.layout({ minWidth: 40, maxWidth: 40, minHeight: 24, maxHeight: 24 })
    })
    try {
      const context = createPaintContext()
      surface.paint(context, popupContext())
      root.markNeedsPaint()
      invalidate.mockClear()
      requestNext = true
      surface.paint(context, popupContext())
      expect(root.owner!.hasDirtyPaintInSubtree(root)).toBe(true)
      expect(invalidate).toHaveBeenCalled()
      surface.paint(context, popupContext())
      expect(root.owner!.hasDirtyPaintInSubtree(root)).toBe(false)
    } finally {
      surface.dispose()
      OverlayInvalidator.disposeInstance()
    }
  })


  it('retains transient popup requests until the following paint', () => {
    const invalidate = vi.fn()
    OverlayInvalidator.instance.setPaintInvalidator(invalidate)
    const root = new PopupRenderNode({ paint: () => {} })
    const surface = new PopupRenderSurface(root, node => {
      node.layout({ minWidth: 40, maxWidth: 40, minHeight: 24, maxHeight: 24 })
    })
    try {
      const context = createPaintContext()
      surface.paint(context, popupContext())
      root.markNeedsTransientPaint()
      invalidate.mockClear()
      const paint = vi.spyOn(root, 'performTransientPaint').mockImplementationOnce(() => root.markNeedsTransientPaint())
      surface.paint(context, popupContext())
      expect(root.owner!.hasTransientPaint()).toBe(true)
      expect(invalidate).toHaveBeenCalled()
      surface.paint(context, popupContext())
      expect(paint).toHaveBeenCalledTimes(2)
      expect(root.owner!.hasTransientPaint()).toBe(false)
    } finally {
      surface.dispose()
      OverlayInvalidator.disposeInstance()
      vi.restoreAllMocks()
    }
  })
})


it('replays unchanged popup transient children when another child requests paint', () => {
  const first = new PopupRenderNode({ paint: () => {} })
  const second = new PopupRenderNode({ paint: () => {} })
  const root = new PopupRenderNode({ paint: () => {}, visitChildren: (_node, visit) => {
    visit(first); visit(second)
  } })
  first.parent = root; second.parent = root
  const surface = new PopupRenderSurface(root, node => {
    node.layout({ minWidth: 40, maxWidth: 40, minHeight: 24, maxHeight: 24 })
  })
  const firstPaint = vi.spyOn(first, 'performTransientPaint')
  const secondPaint = vi.spyOn(second, 'performTransientPaint')
  try {
    const context = createPaintContext()
    surface.paint(context, popupContext())
    first.markNeedsTransientPaint(); second.markNeedsTransientPaint()
    surface.paint(context, popupContext())
    firstPaint.mockClear(); secondPaint.mockClear()
    first.markNeedsTransientPaint()
    surface.paint(context, popupContext())
    expect(firstPaint).toHaveBeenCalledTimes(1)
    expect(secondPaint).toHaveBeenCalledTimes(1)
    expect(root.owner!.hasTransientPaint()).toBe(false)
  } finally { surface.dispose(); vi.restoreAllMocks(); OverlayInvalidator.disposeInstance() }
})
