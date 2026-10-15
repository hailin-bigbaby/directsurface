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

describe('Runtime animation integration', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
  it('samples animations before paint and shares one pending frame across subscribers', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const frames = new Map<number, FrameRequestCallback>()
    let nextId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextId, callback)
      return nextId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({ canvas, getViewportSize: () => ({ width: 120, height: 80 }) })
    const values: number[] = []
    class AnimatedRoot extends TestRoot {
      value = -1
      stop = this.registerAnimation(elapsed => { this.value = elapsed; this.markNeedsPaint() })
      override performPaint(): void { values.push(this.value) }
    }
    const advance = (timestamp: number) => {
      expect(frames.size).toBe(1)
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback(timestamp)
    }
    try {
      const root = new AnimatedRoot()
      root.size = { width: 120, height: 80 }
      host.addRoot(root)
      const second = host.animationClock.subscribe(() => {})
      host.registerLayer({ layer: 'main',
        shouldPaint: () => host.isLayerDirty('main') || host.hasDirtyPaintForRoot(root),
        paint: ({ context }) => root.paint(context, root.globalOffset),
      })
      advance(0)
      advance(1000 / 120)
      advance(2000 / 120)
      expect(values).toEqual([0, 1000 / 120, 2000 / 120])
      root.stop()
      second()
      advance(25)
      expect(frames.size).toBe(0)
      expect(host.animationClock.subscriberCount).toBe(0)
    } finally { host.dispose() }
    host.scheduleFrame('late-cleanup')
    host.scheduleLayout('late-cleanup')
    expect(frames.size).toBe(0)
  })
  it('pauses the runtime clock while the document is hidden and wakes on visibility change', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    let hidden = false
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({ canvas, getViewportSize: () => ({ width: 120, height: 80 }) })
    try {
      const tick = vi.fn()
      host.animationClock.subscribe(tick)
      host.renderFrame(0)
      host.renderFrame(20)
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
      host.frameScheduler.cancelFrame()
      host.renderFrame(500)
      expect(host.animationClock.hasActiveAnimations).toBe(false)
      expect(host.frameScheduler.frameScheduled).toBe(false)
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
      expect(host.frameScheduler.frameScheduled).toBe(true)
      host.renderFrame(1000)
      expect(tick.mock.calls.map(call => call[0])).toEqual([0, 20, 20])
    } finally { host.dispose() }
  })
  it('reports a failed animation after painting other updates and keeps healthy animations running', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({ canvas, getViewportSize: () => ({ width: 120, height: 80 }) })
    try {
      const root = new TestRoot()
      root.size = { width: 120, height: 80 }
      host.addRoot(root)
      host.registerLayer({ layer: 'main', paint: ({ context }) => root.paint(context, root.globalOffset) })
      host.animationClock.subscribe(() => { throw new Error('animation failed') })
      host.animationClock.subscribe(() => root.markNeedsPaint())
      host.frameScheduler.cancelFrame()
      expect(() => host.renderFrame(0)).toThrow('animation failed')
      expect(root.paintCalls).toBe(1)
      expect(host.animationClock.subscriberCount).toBe(1)
      expect(host.frameScheduler.frameScheduled).toBe(true)
    } finally { host.dispose() }
  })
  it('keeps healthy subscriptions scheduled when an activity predicate fails after painting', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({ canvas, getViewportSize: () => ({ width: 120, height: 80 }) })
    try {
      let painted = false
      const healthy = vi.fn()
      host.registerLayer({ layer: 'main', paint: () => { painted = true } })
      host.animationClock.subscribe(() => {}, () => {
        if (painted) throw new Error('activity failed')
        return true
      })
      host.animationClock.subscribe(healthy)
      host.frameScheduler.cancelFrame()
      expect(() => host.renderFrame(0)).toThrow('activity failed')
      expect(host.animationClock.subscriberCount).toBe(1)
      expect(host.frameScheduler.frameScheduled).toBe(true)
      host.renderFrame(16)
      expect(healthy.mock.calls.map(call => call[0])).toEqual([0, 16])
    } finally { host.dispose() }
  })
})
