import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RenderObject, type BoxConstraints, type Offset } from '../core/render_object'
import type { PaintContext } from '../rendering/paint_context'
import type { ResolvedTheme } from '../theme/theme'
import { RuntimeHost } from './runtime_host'

class TestOffscreenCanvas {
  width: number
  height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  getContext(): CanvasRenderingContext2D {
    return createCanvasContext()
  }
}

function createCanvasContext(): CanvasRenderingContext2D {
  return {
    beginPath: vi.fn(),
    closePath: vi.fn(),
    clearRect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    roundRect: vi.fn(),
    save: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    arc: vi.fn(),
    set fillStyle(_value: unknown) {},
    get fillStyle() { return '' },
    set strokeStyle(_value: unknown) {},
    get strokeStyle() { return '' },
    lineWidth: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  } as unknown as CanvasRenderingContext2D
}

class TestRoot extends RenderObject {
  children: TestRoot[] = []
  paintCalls = 0
  lastLayoutTheme?: ResolvedTheme
  lastPaintTheme?: ResolvedTheme
  disposeCalls = 0

  performLayout(_constraints: BoxConstraints, context: { theme: ResolvedTheme }): void {
    this.lastLayoutTheme = context.theme
  }
  performPaint(context: PaintContext, _offset: Offset): void {
    this.paintCalls++
    this.lastPaintTheme = context.theme
  }
  visitChildren(visitor: (child: RenderObject) => void): void {
    for (const child of this.children) visitor(child)
  }

  addChild(child: TestRoot): void {
    child.parent = this
    this.children.push(child)
  }

  override dispose(): void {
    this.disposeCalls++
    super.dispose()
  }
}

describe('Runtime paint invalidation', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
  it.each(['main', 'transient'] as const)('preserves and schedules %s requests raised during painting', layer => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({ canvas, getViewportSize: () => ({ width: 120, height: 80 }) })
    try {
      const root = new TestRoot()
      root.size = { width: 120, height: 80 }
      host.addRoot(root)
      host.registerLayer({ layer: 'main',
        shouldPaint: () => host.isLayerDirty('main') || host.hasDirtyPaintForRoot(root),
        dirtyRect: () => host.getDirtyPaintRectForRoots([root]),
        paint: ({ context }) => root.paint(context, root.globalOffset),
      })
      host.renderFrame()
      const damage = { x: 50, y: 30, width: 8, height: 10 }
      const request = () => layer === 'main' ? root.markNeedsPaint(damage) : root.markNeedsTransientPaint(damage)
      const paint = vi.spyOn(root, layer === 'main' ? 'performPaint' : 'performTransientPaint')
        .mockImplementationOnce(request)
      request()
      host.frameScheduler.cancelFrame()
      host.renderFrame()
      expect(paint).toHaveBeenCalledTimes(1)
      expect(layer === 'main' ? host.hasDirtyPaintForRoot(root) : host.pipelineOwner.hasTransientPaint()).toBe(true)
      expect(host.frameScheduler.frameScheduled).toBe(true)
      expect(layer === 'main' ? host.getDirtyPaintRectForRoots([root]) : host.pipelineOwner.getTransientPaintRect()).toEqual(damage)
      host.frameScheduler.cancelFrame()
      host.renderFrame()
      expect(paint).toHaveBeenCalledTimes(2)
      expect(layer === 'main' ? host.hasDirtyPaintForRoot(root) : host.pipelineOwner.hasTransientPaint()).toBe(false)
      expect(host.frameScheduler.frameScheduled).toBe(false)
    } finally { host.dispose() }
  })

  it('schedules damage to an earlier layer raised by a later painter', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({ canvas, getViewportSize: () => ({ width: 120, height: 80 }) })
    try {
      const paint = vi.fn()
      let invalidate = false
      host.registerLayer({ layer: 'main', paint })
      host.registerLayerPainter({ layer: 'overlay', paint: () => {
        if (!invalidate) return
        invalidate = false
        host.markLayerDirtyRect('main', { x: 10, y: 10, width: 20, height: 20 })
      } })
      host.renderFrame()
      host.frameScheduler.cancelFrame()
      invalidate = true
      host.markLayerDirty('overlay')
      host.renderFrame()
      expect(host.isLayerDirty('main')).toBe(true)
      expect(host.frameScheduler.frameScheduled).toBe(true)
      host.frameScheduler.cancelFrame()
      host.renderFrame()
      expect(paint).toHaveBeenCalledTimes(2)
      expect(host.isLayerDirty('main')).toBe(false)
      expect(host.frameScheduler.frameScheduled).toBe(false)
    } finally { host.dispose() }
  })

  it.each(['main', 'transient'] as const)('reschedules %s after a failed paint on the next invalidation without a retry loop', layer => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({ canvas, getViewportSize: () => ({ width: 120, height: 80 }) })
    try {
      const root = new TestRoot()
      root.size = { width: 120, height: 80 }
      host.addRoot(root)
      host.registerLayer({ layer: 'main',
        shouldPaint: () => host.isLayerDirty('main') || host.hasDirtyPaintForRoot(root),
        dirtyRect: () => host.getDirtyPaintRectForRoots([root]),
        paint: ({ context }) => root.paint(context, root.globalOffset),
      })
      host.renderFrame()
      vi.spyOn(root, layer === 'main' ? 'performPaint' : 'performTransientPaint')
        .mockImplementationOnce(() => { throw new Error('paint failed') })
      const request = () => layer === 'main' ? root.markNeedsPaint() : root.markNeedsTransientPaint()
      request()
      host.frameScheduler.cancelFrame()
      expect(() => host.renderFrame()).toThrow('paint failed')
      expect(host.frameScheduler.frameScheduled).toBe(false)
      expect(layer === 'main' ? host.hasDirtyPaintForRoot(root) : host.pipelineOwner.hasTransientPaint()).toBe(true)
      request()
      expect(host.frameScheduler.frameScheduled).toBe(true)
      host.frameScheduler.cancelFrame()
      host.renderFrame()
      expect(layer === 'main' ? host.hasDirtyPaintForRoot(root) : host.pipelineOwner.hasTransientPaint()).toBe(false)
      expect(host.frameScheduler.frameScheduled).toBe(false)
    } finally { host.dispose() }
  })

})
