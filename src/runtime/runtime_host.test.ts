import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { KeyboardBindingController } from '../core/keyboard_binding_controller'
import { OverlayInvalidator } from '../core/overlay_invalidator'
import { PopupManager } from '../core/popup_manager'
import { GET_POPUP_ANCHOR_RECT } from '../core/popup_anchor'
import { looseConstraints, RenderObject, type BoxConstraints, type Offset } from '../core/render_object'
import { AppContextRegistry, createAppContextKey } from '../core/app_context'
import type { PointerEvent } from '../gestures/hit_test'
import type { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../theme/default_theme'
import { DatePickerPopup } from '../widgets/date_picker'
import { RenderTextBox } from '../widgets/text_field'
import { RenderTextArea } from '../widgets/text_area'
import { RenderPlainTextEditor } from '../widgets/plain_text_editor'
import { TooltipService } from '../widgets/tooltip'
import { RenderWindow } from '../widgets/window'
import { rgba, type ResolvedTheme } from '../theme/theme'
import { RuntimeHost } from './runtime_host'

type MutableResolvedTheme = {
  -readonly [Key in keyof ResolvedTheme]: ResolvedTheme[Key]
}

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

class InteractiveTestRoot extends TestRoot {
  pointerDownCalls = 0

  onPointerDown(_event: PointerEvent): void {
    this.pointerDownCalls += 1
  }
}

describe('RuntimeHost', () => {
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

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
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

  afterEach(() => {
    KeyboardBindingController.disposeInstance()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

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

  it('owns canvas sizing, compositor, dispatcher, and resize scheduling', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    let viewport = { width: 100, height: 50 }
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const onResize = vi.fn()
    const requestFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const host = new RuntimeHost({
      canvas,
      dpr: 2,
      onFrame: vi.fn(),
      onResize,
      getViewportSize: () => viewport,
    })

    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(100)
    expect(canvas.style.width).toBe('100px')
    expect(canvas.style.height).toBe('50px')
    expect(onResize).not.toHaveBeenCalled()

    viewport = { width: 120, height: 60 }
    window.dispatchEvent(new Event('resize'))

    expect(canvas.width).toBe(240)
    expect(canvas.height).toBe(120)
    expect(onResize).toHaveBeenCalledWith({ width: 120, height: 60, dpr: 2 })
    expect(requestFrame).toHaveBeenCalledTimes(1)

    host.dispose()
  })

  it('fits an oversized centered window inside the current viewport', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      getViewportSize: () => ({ width: 320, height: 240 }),
    })
    const window = new RenderWindow({
      title: 'Responsive dialog',
      width: 640,
      height: 420,
      minWidth: 320,
      minHeight: 280,
    })

    host.centerWindowInViewport(window)

    expect(window.windowX).toBe(0)
    expect(window.windowY).toBe(0)
    expect(window.windowWidth).toBe(320)
    expect(window.windowHeight).toBe(240)
    expect(window.offset).toEqual({ x: 0, y: 0 })

    host.dispose()
  })

  it('flushes frame commits before layout during direct rendering', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      getViewportSize: () => ({ width: 120, height: 80 }),
    })
    const root = new TestRoot()
    const order: string[] = []
    const performLayout = vi.spyOn(root, 'performLayout').mockImplementation(() => {
      order.push('layout')
    })
    host.addRoot(root)
    host.renderFrame()
    order.length = 0
    performLayout.mockClear()

    host.pipelineOwner.scheduleFrameCommit(root, () => {
      order.push('commit')
      root.markNeedsLayout()
    })
    host.renderFrame()

    expect(order).toEqual(['commit', 'layout'])
    expect(performLayout).toHaveBeenCalledTimes(1)
    host.dispose()
  })

  it('absorbs layout invalidations from frame commits into the current frame', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const callbacks: FrameRequestCallback[] = []
    let nextHandle = 1
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return nextHandle++
    })
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      getViewportSize: () => ({ width: 120, height: 80 }),
    })
    const root = new TestRoot()
    const performLayout = vi.spyOn(root, 'performLayout')

    host.addRoot(root)
    callbacks.shift()?.(0)
    performLayout.mockClear()

    host.pipelineOwner.scheduleFrameCommit(root, () => {
      root.markNeedsLayout()
    })
    expect(requestFrame).toHaveBeenCalledTimes(2)

    callbacks.shift()?.(16)

    expect(performLayout).toHaveBeenCalledTimes(1)
    expect(requestFrame).toHaveBeenCalledTimes(2)
    host.dispose()
  })

  it('captures the current canvas as an image data url after pending rendering', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    ;(canvas as any).toDataURL = vi.fn(() => 'data:image/png;base64,AAA')
    const host = new RuntimeHost({
      canvas,
      dpr: 2,
      getViewportSize: () => ({ width: 120, height: 80 }),
    })
    const root = new TestRoot()

    host.addRoot(root)
    const dataUrl = host.captureImageDataUrl()

    expect(dataUrl).toBe('data:image/png;base64,AAA')
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png', undefined)
    expect(host.frameScheduler.layoutNeeded).toBe(false)

    host.dispose()
  })

  it('captures a logical canvas region through a temporary canvas', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      dpr: 2,
      getViewportSize: () => ({ width: 120, height: 80 }),
    })
    const originalCreateElement = document.createElement.bind(document)
    const tempContext = createCanvasContext()
    const tempCanvas = originalCreateElement('canvas')
    ;(tempCanvas as any).getContext = vi.fn(() => tempContext)
    ;(tempCanvas as any).toDataURL = vi.fn(() => 'data:image/png;base64,REGION')
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === 'canvas') return tempCanvas
      return originalCreateElement(tagName)
    })

    const dataUrl = host.captureImageDataUrl({
      rect: { x: 10, y: 5, width: 20, height: 15 },
      scale: 1,
    })

    expect(dataUrl).toBe('data:image/png;base64,REGION')
    expect(createElement).toHaveBeenCalledWith('canvas')
    expect(tempCanvas.width).toBe(20)
    expect(tempCanvas.height).toBe(15)
    expect(tempContext.drawImage).toHaveBeenCalledWith(
      canvas,
      20,
      10,
      40,
      30,
      0,
      0,
      20,
      15,
    )

    host.dispose()
  })

  it('disposes global keyboard bindings with the runtime host', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const handler = vi.fn()
    KeyboardBindingController.instance.addBinding(handler)

    const host = new RuntimeHost({ canvas })
    host.dispose()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))

    expect(handler).not.toHaveBeenCalled()
  })

  it('can trace paint request sources with stack and dirty state', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const host = new RuntimeHost({
      canvas,
      debugPaintRequests: true,
      getViewportSize: () => ({ width: 240, height: 120 }),
    })
    const root = new TestRoot()

    host.addRoot(root)

    expect(host.getPaintRequestHistory()).toContainEqual(expect.objectContaining({
      kind: 'layout',
      source: 'pipeline',
      reason: 'pipeline:layout',
      detail: expect.objectContaining({
        type: 'layout',
        target: 'TestRoot',
      }),
      stack: expect.any(Array),
    }))
    expect(debug).toHaveBeenCalledWith('[DirectSurface.paintRequest]', expect.objectContaining({
      kind: 'layout',
      reason: 'pipeline:layout',
      detail: expect.objectContaining({
        type: 'layout',
        target: 'TestRoot',
      }),
      dirtyLayers: expect.any(Array),
      pipeline: expect.objectContaining({
        layoutCount: 1,
      }),
      stack: expect.any(Array),
    }))

    host.renderFrame()
    debug.mockClear()
    host.clearPaintRequestHistory()
    root.markNeedsTransientPaint({ x: 1, y: 2, width: 3, height: 4 })

    expect(host.getPaintRequestHistory(1)).toEqual([
      expect.objectContaining({
        kind: 'frame',
        source: 'pipeline',
        reason: 'pipeline:transient-paint',
        pipeline: expect.objectContaining({
          transientPaintCount: 1,
        }),
      }),
    ])
    expect(debug).toHaveBeenCalledWith('[DirectSurface.paintRequest]', expect.objectContaining({
      kind: 'frame',
      reason: 'pipeline:transient-paint',
      detail: expect.objectContaining({
        type: 'transient-paint',
        target: 'TestRoot',
      }),
      pipeline: expect.objectContaining({
        transientPaintCount: 1,
      }),
    }))

    host.clearPaintRequestHistory()
    expect(host.getPaintRequestHistory()).toEqual([])

    host.dispose()
  })

  it('stores paint request details as sanitized snapshots', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({ canvas })
    const detail: { target: string, nested: { value: number }, node?: TestRoot } = {
      target: 'RenderTextBox',
      nested: { value: 1 },
      node: new TestRoot(),
    }

    host.scheduleFrame('manual', detail)
    detail.target = 'changed'
    detail.nested.value = 2

    const first = host.getPaintRequestHistory(1)[0]!
    expect(first.detail).toEqual({
      target: 'RenderTextBox',
      nested: { value: 1 },
      node: '[TestRoot]',
    })

    ;(first.detail as any).target = 'mutated copy'
    expect(host.getPaintRequestHistory(1)[0]!.detail).toEqual({
      target: 'RenderTextBox',
      nested: { value: 1 },
      node: '[TestRoot]',
    })

    host.dispose()
    expect(host.getPaintRequestHistory()).toEqual([])
  })

  it('creates a detached diagnostics snapshot for offline analysis', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const appContext = new AppContextRegistry(undefined, {
      patientId: 'P001',
      complex: { nested: { value: 3 } },
    })
    const host = new RuntimeHost({
      canvas,
      appContext,
      debugPaintRequests: true,
      enablePerformanceOverlay: true,
      getViewportSize: () => ({ width: 240, height: 120 }),
    })
    const root = new TestRoot()
    const child = new TestRoot()
    root.addChild(child)
    for (let i = 0; i < 85; i++) {
      root.addChild(new TestRoot())
    }

    host.addRoot(root)
    host.scheduleFrame('manual', { target: 'RenderSnapshotTarget', ref: root })

    const snapshot = host.createDiagnosticsSnapshot()

    expect(snapshot).toMatchObject({
      version: 1,
      environment: {
        viewport: { width: 240, height: 120, dpr: 1 },
        canvas: {
          width: 240,
          height: 120,
          styleWidth: '240px',
          styleHeight: '120px',
        },
      },
      runtime: {
        rootCount: 1,
        performanceOverlayVisible: true,
        paintRequestDebugEnabled: true,
      },
    })
    expect(snapshot.paintRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reason: 'manual',
        detail: {
          target: 'RenderSnapshotTarget',
          ref: '[TestRoot]',
        },
      }),
    ]))
    expect(snapshot.hotspots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: 'RenderSnapshotTarget',
        count: 1,
      }),
    ]))
    expect(snapshot.roots[0]?.info.typeName).toBe('TestRoot')
    expect(snapshot.roots[0]?.children[0]?.info.typeName).toBe('TestRoot')
    expect(snapshot.roots[0]?.children).toHaveLength(80)
    expect(snapshot.roots[0]?.truncated).toBe(6)
    expect(snapshot.appContext).toEqual(expect.arrayContaining([
      { key: 'patientId', source: 'root', value: 'P001' },
      { key: 'complex', source: 'root', value: { nested: { value: 3 } } },
    ]))

    ;(snapshot.paintRequests.at(-1)!.detail as any).target = 'mutated'
    expect((host.createDiagnosticsSnapshot().paintRequests.at(-1)!.detail as any).target).toBe('RenderSnapshotTarget')

    host.dispose()
  })

  it('exports hostile context values safely and copies fresh inspector geometry into each snapshot', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const getter = vi.fn(() => { throw new Error('getter must not execute') })
    const object = Object.defineProperty({ valid: 42 }, 'property', { enumerable: true, get: getter })
    const context = new AppContextRegistry(undefined, { invalidDate: new Date(NaN), object })
    const host = new RuntimeHost({ canvas, appContext: context, getViewportSize: () => ({ width: 300, height: 200 }) })
    const root = new TestRoot()
    root.size = { width: 100, height: 100 }
    host.addRoot(root)
    host.layoutInspector.inspectAt({ x: 10, y: 10 })
    const first = host.createDiagnosticsSnapshot()
    expect(first.appContext).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'invalidDate', value: '[Invalid Date]' }),
      expect.objectContaining({ key: 'object', value: { valid: 42, property: '[Getter]' } }),
    ]))
    expect(getter).not.toHaveBeenCalled()
    root.size = { width: 220, height: 170 }
    root.offset = { x: 12, y: 13 }
    const second = host.createDiagnosticsSnapshot()
    expect(second.layoutInspector.renderTree!.info.size).toEqual(second.layoutInspector.selected!.size)
    expect(second.layoutInspector.renderTree!.info.size.width).toBe(220)
    expect(first.layoutInspector.renderTree!.info.size.width).toBe(100)
    expect(() => JSON.stringify(second)).not.toThrow()
    host.dispose()
  })

  it('disposes its app context with the runtime host', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const key = createAppContextKey<{ dispose(): void }>('runtime-resource')
    const dispose = vi.fn()
    const context = new AppContextRegistry()
    context.setDisposable(key, { dispose })

    const host = new RuntimeHost({ canvas, appContext: context })
    host.dispose()

    expect(context.disposed).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('suppresses native context menus anywhere inside the canvas bounds', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 210,
      bottom: 120,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    })
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })
    const onContextMenu = vi.fn()
    host.dispatcher.setOnContextMenu(onContextMenu)

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 60,
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(onContextMenu).toHaveBeenCalledWith({ x: 30, y: 40 })

    host.dispose()
  })

  it('notifies size dependents immediately and on resize until removed', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    let viewport = { width: 100, height: 50 }
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const host = new RuntimeHost({
      canvas,
      dpr: 2,
      onFrame: vi.fn(),
      getViewportSize: () => viewport,
    })
    const target = { updateCanvas: vi.fn() }
    const listener = vi.fn()

    const removeTarget = host.addSizeDependent(target)
    host.addSizeDependent(listener)

    expect(target.updateCanvas).toHaveBeenNthCalledWith(1, 100, 50, { width: 100, height: 50, dpr: 2 })
    expect(listener).toHaveBeenNthCalledWith(1, { width: 100, height: 50, dpr: 2 })

    viewport = { width: 120, height: 60 }
    window.dispatchEvent(new Event('resize'))

    expect(target.updateCanvas).toHaveBeenNthCalledWith(2, 120, 60, { width: 120, height: 60, dpr: 2 })
    expect(listener).toHaveBeenNthCalledWith(2, { width: 120, height: 60, dpr: 2 })

    removeTarget()
    viewport = { width: 140, height: 70 }
    host.resize()

    expect(target.updateCanvas).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenNthCalledWith(3, { width: 140, height: 70, dpr: 2 })

    host.dispose()
  })

  it('registers size targets through addManagedTarget', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    let viewport = { width: 100, height: 50 }
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())

    const host = new RuntimeHost({
      canvas,
      dpr: 2,
      onFrame: vi.fn(),
      getViewportSize: () => viewport,
    })

    const target = {
      updateCanvas: vi.fn(),
    }

    const remove = host.addManagedTarget(target)

    expect(target.updateCanvas).toHaveBeenNthCalledWith(1, 100, 50, { width: 100, height: 50, dpr: 2 })

    viewport = { width: 120, height: 60 }
    host.resize()

    expect(target.updateCanvas).toHaveBeenNthCalledWith(2, 120, 60, { width: 120, height: 60, dpr: 2 })

    remove()
    viewport = { width: 140, height: 70 }
    host.resize()

    expect(target.updateCanvas).toHaveBeenCalledTimes(2)

    host.dispose()
  })

  it('disposes root trees when the runtime shuts down', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())

    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })
    const root = new TestRoot()
    const child = new TestRoot()
    root.addChild(child)
    host.addRoot(root)

    host.dispose()

    expect(root.disposeCalls).toBe(1)
    expect(child.disposeCalls).toBe(1)
    expect(root.parent).toBeUndefined()
    expect(child.parent).toBeUndefined()
  })

  it('allows managed targets to opt out of immediate size notification', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())

    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })

    const target = {
      updateCanvas: vi.fn(),
    }

    host.addManagedTarget(target, { notifyImmediately: false })

    expect(target.updateCanvas).not.toHaveBeenCalled()

    host.resize()

    expect(target.updateCanvas).toHaveBeenNthCalledWith(1, 100, 50, { width: 100, height: 50, dpr: 1 })

    host.dispose()
  })

  it('keeps plain size targets on size-only sync', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())

    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })

    const target = {
      updateCanvas: vi.fn(),
    }

    host.addManagedTarget(target)

    expect(target.updateCanvas).toHaveBeenNthCalledWith(1, 100, 50, { width: 100, height: 50, dpr: 1 })

    host.dispose()
  })

  it('removes window listeners and disposes child services', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })

    expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function), undefined)
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function), undefined)

    host.dispose()
    window.dispatchEvent(new Event('beforeunload'))

    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function), undefined)
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function), undefined)
  })

  it('proxies render root management through the runtime', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })
    const first = new TestRoot()
    const second = new TestRoot()

    host.addRoot(first)
    host.addRoot(second)

    expect(host.getRoots()).toEqual([first, second])
    expect(first.owner).toBe(host.pipelineOwner)
    expect(second.owner).toBe(host.pipelineOwner)

    host.bringToFront(first)

    expect(host.getRoots()).toEqual([second, first])

    host.removeRoot(first)

    expect(host.getRoots()).toEqual([second])
    expect(first.owner).toBeUndefined()

    host.dispose()
  })

  it('attaches descendants and schedules frames from pipeline invalidation', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    let frameCallback: FrameRequestCallback | undefined
    let nextFrameId = 1
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallback = callback
      return nextFrameId++
    })
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })
    const root = new TestRoot()
    const child = new TestRoot()
    root.addChild(child)

    host.addRoot(root)
    expect(requestFrame).toHaveBeenCalledTimes(1)
    frameCallback?.(0)
    host.consumeLayoutNeeded()
    root.layout(looseConstraints(100, 50))
    root.paint({ ctx: {} as CanvasRenderingContext2D } as PaintContext, { x: 0, y: 0 })

    root.markNeedsPaint()

    expect(child.owner).toBe(host.pipelineOwner)
    expect(requestFrame).toHaveBeenCalledTimes(2)

    host.dispose()

    expect(root.owner).toBeUndefined()
    expect(child.owner).toBeUndefined()
  })

  it('flushes pointer down paint synchronously when no layout is pending', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    let frameCallback: FrameRequestCallback | undefined
    let nextFrameId = 1
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallback = callback
      return nextFrameId++
    })
    const cancelFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)

    class ClickWindow extends RenderWindow {
      pointerDownCalls = 0

      override onPointerDown(event: PointerEvent): void {
        this.pointerDownCalls++
        super.onPointerDown(event)
        this.markNeedsPaint()
      }
    }

    const host = new RuntimeHost({
      canvas,
      getViewportSize: () => ({ width: 320, height: 240 }),
    })
    const mainWindow = new ClickWindow({ title: 'Main', width: 220, height: 160 })
    host.runMainWindow(mainWindow)
    frameCallback?.(0)
    frameCallback?.(16)
    host.scheduleFrame()

    const renderFrame = vi.spyOn(host, 'renderFrame')
    canvas.dispatchEvent(new MouseEvent('mousedown', {
      button: 0,
      buttons: 1,
      clientX: 20,
      clientY: 20,
    }))

    expect(mainWindow.pointerDownCalls).toBe(1)
    expect(renderFrame).toHaveBeenCalledTimes(1)
    expect(cancelFrame).toHaveBeenCalledTimes(1)
    expect(cancelFrame.mock.calls[0]?.[0]).toBeGreaterThan(0)
    expect(host.frameScheduler.frameScheduled).toBe(false)

    host.dispose()
  })

  it('routes popup paint invalidation through the frame scheduler', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const requestFrame = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })
    const fallback = vi.fn()

    PopupManager.instance.requestPaint(fallback)

    expect(requestFrame).toHaveBeenCalledTimes(1)
    expect(fallback).not.toHaveBeenCalled()

    host.dispose()
    PopupManager.instance.requestPaint(fallback)

    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('automatically paints popup stack entries on overlay and tooltip layers', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })
    const paintOrder: string[] = []
    const lowerOverlay = {
      hitTest: () => true,
      close: vi.fn(),
      paint: vi.fn(() => paintOrder.push('lower')),
    }
    const upperOverlay = {
      hitTest: () => true,
      close: vi.fn(),
      paint: vi.fn(() => paintOrder.push('upper')),
    }
    const tooltipOverlay = {
      hitTest: () => false,
      close: vi.fn(),
      overlayLayer: 'tooltip',
      paint: vi.fn(() => paintOrder.push('tooltip')),
    }

    PopupManager.instance.open(lowerOverlay)
    PopupManager.instance.open(upperOverlay)
    PopupManager.instance.open(tooltipOverlay, { interactive: false })

    host.paintLayers()

    expect(paintOrder).toEqual(['lower', 'upper', 'tooltip'])
    expect(lowerOverlay.paint).toHaveBeenCalledTimes(1)
    expect(upperOverlay.paint).toHaveBeenCalledTimes(1)
    expect(tooltipOverlay.paint).toHaveBeenCalledTimes(1)

    host.dispose()
  })

  it('registers layout inspector debug overlay above the default layers', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })

    expect(host.layerManager.getRegisteredLayers()).toContain('debug-overlay')
    expect(host.compositor.getLayerOrder()).not.toContain('performance-overlay')
    expect(host.compositor.getLayerOrder().at(-1)).toBe('debug-overlay')

    host.dispose()
  })

  it('registers the performance overlay lazily when enabled', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })

    expect(host.compositor.getLayerOrder()).not.toContain('performance-overlay')
    host.setPerformanceOverlayVisible(true)

    expect(host.compositor.getLayerOrder()).toContain('performance-overlay')
    expect(host.compositor.getLayerOrder().at(-2)).toBe('debug-overlay')
    expect(host.compositor.getLayerOrder().at(-1)).toBe('performance-overlay')

    host.dispose()
  })

  it('records frame timings and paints the performance overlay when enabled', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 240, height: 120 }),
      enablePerformanceOverlay: true,
    })
    const root = new TestRoot()
    root.size = { width: 240, height: 120 }
    host.addRoot(root)
    const paint = vi.spyOn(host.performanceMonitor, 'paint')

    host.renderFrame()

    const state = host.performanceMonitor.debugState()
    expect(state.visible).toBe(true)
    expect(state.sampleCount).toBe(1)
    expect(state.latest?.rootCount).toBe(1)
    expect(state.latest?.layerCount).toBe(host.compositor.getLayerOrder().length)
    expect(paint).toHaveBeenCalledTimes(1)

    host.dispose()
  })

  it('confines performance updates to the overlay old/new painted bounds', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    const screen = createCanvasContext()
    ;(canvas as any).getContext = vi.fn(() => screen)
    const host = new RuntimeHost({ canvas, onFrame: vi.fn(), dpr: 1,
      getViewportSize: () => ({ width: 800, height: 600 }), enablePerformanceOverlay: true })
    host.performanceMonitor.position = 'top-left'
    host.renderFrame()
    const fullDirty = vi.spyOn(host.compositor, 'markDirty')
    vi.mocked(screen.clearRect).mockClear()
    host.renderFrame()
    expect(fullDirty).not.toHaveBeenCalledWith('performance-overlay')
    expect(screen.clearRect).toHaveBeenLastCalledWith(10, 10, 334, 158)

    const header = host.performanceMonitor.debugState().headerRect
    host.performanceMonitor.onPointerDown({ type: 'down', pointerId: 1, button: 0,
      position: { x: header.x + 10, y: header.y + 14 } })
    host.performanceMonitor.onPointerMove({ type: 'move', pointerId: 1,
      position: { x: header.x + 50, y: header.y + 39 } })
    host.performanceMonitor.onPointerUp({ type: 'up', pointerId: 1, position: { x: 0, y: 0 } })
    host.renderFrame()
    expect(screen.clearRect).toHaveBeenLastCalledWith(10, 10, 374, 183)

    host.performanceMonitor.minimized = true
    host.renderFrame()
    expect(screen.clearRect).toHaveBeenLastCalledWith(50, 35, 334, 158)
    host.renderFrame()
    expect(screen.clearRect).toHaveBeenLastCalledWith(50, 35, 184, 38)

    const paint = vi.spyOn(host.performanceMonitor, 'paint')
    host.setPerformanceOverlayVisible(false)
    host.renderFrame()
    expect(screen.clearRect).toHaveBeenLastCalledWith(50, 35, 184, 38)
    expect(paint).not.toHaveBeenCalled()
    expect(host.isLayerDirty('performance-overlay')).toBe(false)
    vi.mocked(screen.clearRect).mockClear()
    host.renderFrame()
    expect(screen.clearRect).not.toHaveBeenCalled()

    host.setPerformanceOverlayVisible(true)
    host.renderFrame()
    expect(screen.clearRect).toHaveBeenLastCalledWith(50, 35, 184, 38)
    expect(paint).toHaveBeenCalledTimes(1)
    expect(fullDirty).not.toHaveBeenCalledWith('performance-overlay')
    host.dispose()
  })

  it('cleans the last painted position when moved and hidden before the next frame', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    const screen = createCanvasContext()
    ;(canvas as any).getContext = vi.fn(() => screen)
    const host = new RuntimeHost({ canvas, onFrame: vi.fn(), dpr: 1,
      getViewportSize: () => ({ width: 800, height: 600 }), enablePerformanceOverlay: true })
    host.performanceMonitor.position = 'top-left'
    host.renderFrame()
    host.performanceMonitor.position = 'top-right'
    host.setPerformanceOverlayVisible(false)
    host.renderFrame()
    expect(screen.clearRect).toHaveBeenLastCalledWith(10, 10, 780, 158)
    vi.mocked(screen.clearRect).mockClear()
    host.renderFrame()
    expect(screen.clearRect).not.toHaveBeenCalled()
    host.dispose()
  })

  it('collects frame timings without registering or painting the performance overlay', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 240, height: 120 }),
      enablePerformanceMonitoring: true,
    })
    const root = new TestRoot()
    root.size = { width: 240, height: 120 }
    host.addRoot(root)
    const paint = vi.spyOn(host.performanceMonitor, 'paint')

    host.renderFrame()

    expect(host.performanceMonitor.enabled).toBe(true)
    expect(host.performanceMonitor.visible).toBe(false)
    expect(host.performanceMonitor.debugState().sampleCount).toBe(1)
    expect(host.compositor.getLayerOrder()).not.toContain('performance-overlay')
    expect(paint).not.toHaveBeenCalled()

    host.dispose()
  })

  it('keeps performance monitoring enabled when the overlay is explicitly visible', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 240, height: 120 }),
      enablePerformanceMonitoring: false,
      enablePerformanceOverlay: true,
    })

    host.renderFrame()

    expect(host.performanceMonitor.visible).toBe(true)
    expect(host.performanceMonitor.enabled).toBe(true)
    expect(host.performanceMonitor.debugState().sampleCount).toBe(1)

    host.dispose()
  })

  it('does not collect frame samples while the performance overlay is disabled', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 240, height: 120 }),
    })

    host.renderFrame()

    expect(host.performanceMonitor.debugState().sampleCount).toBe(0)
    expect(host.performanceMonitor.enabled).toBe(false)
    expect(host.compositor.getLayerOrder()).not.toContain('performance-overlay')

    host.dispose()
  })

  it('keeps frame sequence monotonic after the performance sample window rolls over', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 240, height: 120 }),
      enablePerformanceOverlay: true,
    })

    for (let i = 0; i < 125; i++) host.renderFrame()

    const state = host.performanceMonitor.debugState()
    expect(state.sampleCount).toBe(120)
    expect(state.latest?.seq).toBe(125)

    host.dispose()
  })

  it('can toggle the performance overlay at runtime', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })

    expect(host.performanceMonitor.visible).toBe(false)
    expect(host.togglePerformanceOverlay()).toBe(true)
    expect(host.performanceMonitor.enabled).toBe(true)
    expect(host.performanceMonitor.visible).toBe(true)
    expect(host.compositor.getLayerOrder()).toContain('performance-overlay')
    expect(host.isLayerDirty('performance-overlay')).toBe(true)

    host.dispose()
  })

  it('minimizes and restores the performance overlay from its control button', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 320,
      bottom: 180,
      width: 320,
      height: 180,
      toJSON: () => ({}),
    } as DOMRect)
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 320, height: 180 }),
      enablePerformanceOverlay: true,
    })

    const minimizeButton = host.performanceMonitor.debugState().toggleButtonRect
    canvas.dispatchEvent(new MouseEvent('mousedown', {
      clientX: minimizeButton.x + minimizeButton.width / 2,
      clientY: minimizeButton.y + minimizeButton.height / 2,
      bubbles: true,
    }))

    expect(host.performanceMonitor.debugState().minimized).toBe(true)

    const restoreButton = host.performanceMonitor.debugState().toggleButtonRect
    canvas.dispatchEvent(new MouseEvent('mousedown', {
      clientX: restoreButton.x + restoreButton.width / 2,
      clientY: restoreButton.y + restoreButton.height / 2,
      bubbles: true,
    }))

    expect(host.performanceMonitor.debugState().minimized).toBe(false)

    host.dispose()
  })

  it('drags the performance overlay from the interactive header area', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 420,
      bottom: 260,
      width: 420,
      height: 260,
      toJSON: () => ({}),
    } as DOMRect)
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 420, height: 260 }),
      enablePerformanceOverlay: true,
    })
    host.performanceMonitor.position = 'top-left'
    const before = host.performanceMonitor.debugState().bounds
    const header = host.performanceMonitor.debugState().headerRect

    canvas.dispatchEvent(new MouseEvent('mousedown', {
      clientX: header.x + 16,
      clientY: header.y + 14,
      bubbles: true,
    }))
    canvas.dispatchEvent(new MouseEvent('mousemove', {
      clientX: header.x + 56,
      clientY: header.y + 34,
      bubbles: true,
    }))
    canvas.dispatchEvent(new MouseEvent('mouseup', {
      clientX: header.x + 56,
      clientY: header.y + 34,
      bubbles: true,
    }))

    const after = host.performanceMonitor.debugState().bounds
    expect(after.x).toBe(before.x + 40)
    expect(after.y).toBe(before.y + 20)

    host.dispose()
  })

  it('keeps the performance overlay chart body click-through', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 420,
      bottom: 260,
      width: 420,
      height: 260,
      toJSON: () => ({}),
    } as DOMRect)
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 420, height: 260 }),
      enablePerformanceOverlay: true,
    })
    const root = new InteractiveTestRoot()
    root.size = { width: 420, height: 260 }
    host.addRoot(root)
    const bounds = host.performanceMonitor.debugState().bounds

    canvas.dispatchEvent(new MouseEvent('mousedown', {
      clientX: bounds.x + 24,
      clientY: bounds.y + 82,
      bubbles: true,
    }))

    expect(root.pointerDownCalls).toBe(1)

    host.dispose()
  })

  it('does not let performance overlay controls select layout inspector targets', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 420,
      bottom: 260,
      width: 420,
      height: 260,
      toJSON: () => ({}),
    } as DOMRect)
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 420, height: 260 }),
      enablePerformanceOverlay: true,
    })
    const root = new TestRoot()
    root.size = { width: 420, height: 260 }
    host.addRoot(root)
    host.layoutInspector.toggleOverlay(true)
    const header = host.performanceMonitor.debugState().headerRect

    canvas.dispatchEvent(new MouseEvent('mousedown', {
      clientX: header.x + 16,
      clientY: header.y + 14,
      bubbles: true,
    }))

    expect(host.layoutInspector.debugState().selected).toBeUndefined()

    host.dispose()
  })

  it('preserves current focus when performance overlay controls are clicked', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 420,
      bottom: 260,
      width: 420,
      height: 260,
      toJSON: () => ({}),
    } as DOMRect)
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 420, height: 260 }),
      enablePerformanceOverlay: true,
    })
    const mainWindow = new RenderWindow({ title: 'Main' })
    const field = new RenderTextBox({ value: 'hello' })
    mainWindow.addChild(field)
    host.addRoot(mainWindow)
    FocusManager.instance.setFocus(field)
    const button = host.performanceMonitor.debugState().toggleButtonRect

    canvas.dispatchEvent(new MouseEvent('mousedown', {
      clientX: button.x + button.width / 2,
      clientY: button.y + button.height / 2,
      bubbles: true,
    }))

    expect(FocusManager.instance.current).toBe(field)

    host.dispose()
  })

  it('routes layout inspector selections through the debug overlay layer', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 120, height: 80 }),
    })
    const root = new TestRoot()
    root.size = { width: 120, height: 80 }
    host.addRoot(root)
    host.paintLayers()
    vi.clearAllMocks()
    const paint = vi.spyOn(host.layoutInspector, 'paint')

    host.layoutInspector.inspectAt({ x: 20, y: 20 })
    expect(host.isLayerDirty('debug-overlay')).toBe(true)

    host.paintLayers()

    expect(host.layoutInspector.debugState().selected?.typeName).toBe('TestRoot')
    expect(paint).toHaveBeenCalledTimes(1)

    host.dispose()
  })

  it('clears the debug overlay layer when layout inspection is deactivated', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 120, height: 80 }),
    })
    const root = new TestRoot()
    root.size = { width: 120, height: 80 }
    host.addRoot(root)
    host.paintLayers()
    const clearLayer = vi.spyOn(host.compositor, 'clearLayer')

    host.layoutInspector.inspectAt({ x: 20, y: 20 })
    host.paintLayers()
    clearLayer.mockClear()

    host.layoutInspector.deactivate()
    expect(host.isLayerDirty('debug-overlay')).toBe(true)

    host.paintLayers()

    expect(clearLayer).toHaveBeenCalledWith('debug-overlay', undefined)
    expect(host.layoutInspector.debugState()).toMatchObject({
      enabled: false,
      overlayVisible: false,
      selectedPathLength: 0,
      hoverPathLength: 0,
    })

    host.dispose()
  })

  it('updates layout inspector hover state from pointer movement', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 120,
      bottom: 80,
      width: 120,
      height: 80,
      toJSON: () => ({}),
    } as DOMRect)
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 120, height: 80 }),
    })
    const root = new TestRoot()
    root.size = { width: 120, height: 80 }
    host.addRoot(root)
    host.layoutInspector.toggleOverlay(true)

    canvas.dispatchEvent(new MouseEvent('mousemove', {
      clientX: 20,
      clientY: 20,
      bubbles: true,
    }))

    expect(host.layoutInspector.debugState().hover?.typeName).toBe('TestRoot')

    host.dispose()
  })

  it('replays unchanged transient content when another transient object damages the layer', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({ canvas, onFrame: vi.fn(), getViewportSize: () => ({ width: 120, height: 80 }) })
    const first = new TestRoot()
    const second = new TestRoot()
    first.size = second.size = { width: 20, height: 20 }
    const firstPaint = vi.spyOn(first, 'paintTransient')
    const secondPaint = vi.spyOn(second, 'paintTransient')
    host.addRoot(first)
    host.addRoot(second)
    host.paintLayers()
    first.markNeedsTransientPaint()
    second.markNeedsTransientPaint()
    host.paintLayers()
    firstPaint.mockClear()
    secondPaint.mockClear()
    first.markNeedsTransientPaint()
    host.paintLayers()
    expect(firstPaint).toHaveBeenCalledTimes(1)
    expect(secondPaint).toHaveBeenCalledTimes(1)
    expect(host.pipelineOwner.hasTransientPaint()).toBe(false)
    const parent = new TestRoot()
    const child = new TestRoot()
    child.size = { width: 20, height: 20 }
    parent.addChild(child)
    host.addRoot(parent)
    child.markNeedsTransientPaint()
    host.paintLayers()
    const childPaint = vi.spyOn(child, 'paintTransient')
    parent.visible = false
    first.markNeedsTransientPaint()
    host.paintLayers()
    expect(childPaint).not.toHaveBeenCalled()
    host.dispose()
  })

  it('routes text box caret blink through the transient layer without dirtying main content', () => {
    vi.useFakeTimers()
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 240, height: 80 }),
    })
    const field = new RenderTextBox({ value: 'hello' })
    host.addRoot(field)
    host.renderFrame()
    FocusManager.instance.setFocus(field)
    host.renderFrame()

    expect(host.hasDirtyPaintForRoot(field)).toBe(false)
    expect(host.isLayerDirty('transient')).toBe(false)

    vi.advanceTimersByTime(530)

    expect(host.hasDirtyPaintForRoot(field)).toBe(false)
    expect(host.pipelineOwner.hasTransientPaint()).toBe(true)
    expect(host.pipelineOwner.getTransientPaintRect()).toMatchObject({
      height: expect.any(Number),
      width: expect.any(Number),
    })

    host.dispose()
    vi.useRealTimers()
  })

  it('routes multiline editor caret blink through the transient layer without dirtying main content', () => {
    vi.useFakeTimers()
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 360, height: 160 }),
    })
    const textArea = new RenderTextArea({ value: 'hello\nworld' })
    host.addRoot(textArea)
    host.renderFrame()
    FocusManager.instance.setFocus(textArea)
    host.renderFrame()

    expect(host.hasDirtyPaintForRoot(textArea)).toBe(false)
    vi.advanceTimersByTime(530)
    expect(host.hasDirtyPaintForRoot(textArea)).toBe(false)
    expect(host.pipelineOwner.hasTransientPaint()).toBe(true)

    host.renderFrame()
    const editor = new RenderPlainTextEditor({ value: 'hello\nworld' })
    host.addRoot(editor)
    host.renderFrame()
    FocusManager.instance.setFocus(editor)
    host.renderFrame()

    expect(host.hasDirtyPaintForRoot(editor)).toBe(false)
    vi.advanceTimersByTime(530)
    expect(host.hasDirtyPaintForRoot(editor)).toBe(false)
    expect(host.pipelineOwner.hasTransientPaint()).toBe(true)

    host.dispose()
    vi.useRealTimers()
  })

  it('selects the current layout inspector target on pointer down when overlay is visible', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 120,
      bottom: 80,
      width: 120,
      height: 80,
      toJSON: () => ({}),
    } as DOMRect)
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 120, height: 80 }),
    })
    const root = new TestRoot()
    root.size = { width: 120, height: 80 }
    host.addRoot(root)
    host.layoutInspector.toggleOverlay(true)

    canvas.dispatchEvent(new MouseEvent('mousemove', {
      clientX: 20,
      clientY: 20,
      bubbles: true,
    }))
    canvas.dispatchEvent(new MouseEvent('mousedown', {
      clientX: 20,
      clientY: 20,
      bubbles: true,
    }))

    expect(host.layoutInspector.debugState().selected?.typeName).toBe('TestRoot')

    host.dispose()
  })

  it('paints surface-backed popups with popup context instead of a fake offset', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 240, height: 180 }),
    })
    const popup = new DatePickerPopup()

    popup.open({
      anchor: {
        [GET_POPUP_ANCHOR_RECT]: () => ({ x: 12, y: 16, width: 120, height: 24 }),
      },
      selected: { year: 2026, month: 4, day: 14 },
      onSelect: vi.fn(),
      onClose: vi.fn(),
    })

    expect(() => host.paintLayers()).not.toThrow()

    popup.dispose()
    host.dispose()
  })

  it('repaints only the dirty root layer on paint-only invalidation', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 120, height: 80 }),
    })
    const root = new TestRoot()
    root.size = { width: 120, height: 80 }
    host.addRoot(root)

    const backgroundPaint = vi.fn()
    const mainPaint = vi.fn(({ context }: { context: PaintContext }) => {
      host.paintRoots(context, candidate => candidate === root)
    })

    host.registerLayer({ layer: 'background', paint: backgroundPaint })
    host.registerLayer({
      layer: 'main',
      paint: mainPaint,
      shouldPaint: () => host.isLayerDirty('main') || host.hasDirtyPaintForRoots([root]),
      dirtyRect: () => host.getDirtyPaintRectForRoots([root]),
    })

    host.paintLayers()
    host.clearPaintRequests()
    vi.clearAllMocks()

    root.markNeedsPaint()
    host.paintLayers()

    expect(backgroundPaint).not.toHaveBeenCalled()
    expect(mainPaint).toHaveBeenCalledTimes(1)

    host.dispose()
  })

  it('routes themes through the root layout context', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })
    const root = new TestRoot()

    host.addRoot(root)
    host.initTheme(ImGuiDarkTheme)
    host.flushLayout()

    expect(root.lastLayoutTheme).toBe(ImGuiDarkTheme)

    host.setTheme(ImGuiLightTheme)
    host.flushLayout()

    expect(root.lastLayoutTheme).toBe(ImGuiLightTheme)

    host.removeRoot(root)
    host.setTheme(ImGuiDarkTheme)

    expect(root.lastLayoutTheme).toBe(ImGuiLightTheme)

    host.dispose()
  })

  it('repaints an ancestor after offscreen child damage was skipped and consumed', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas, onFrame: vi.fn(),
      getViewportSize: () => ({ width: 120, height: 80 }),
    })
    try {
      const root = new TestRoot()
      const child = new TestRoot()
      root.size = { width: 120, height: 80 }
      child.offset = { x: 0, y: -100 }
      child.size = { width: 10, height: 10 }
      root.addChild(child)
      host.addRoot(root)
      host.registerLayer({
        layer: 'main',
        paint: ({ context }) => {
          root.paint(context, root.globalOffset)
          child.paint(context, child.globalOffset)
        },
        shouldPaint: () => host.isLayerDirty('main') || host.hasDirtyPaintForRoot(root),
        dirtyRect: () => host.getDirtyPaintRectForRoots([root]),
      })
      host.renderFrame()
      const painted = root.paintCalls
      child.markNeedsPaint()
      host.renderFrame()
      expect(root.paintCalls).toBe(painted)
      expect(root.needsPaint).toBe(true)
      expect(host.pipelineOwner.debugPaintState().paintCount).toBe(0)

      root.markNeedsPaint()
      expect(host.hasDirtyPaintForRoot(root)).toBe(true)
      host.renderFrame()
      expect(root.paintCalls).toBe(painted + 1)
      expect(root.needsPaint).toBe(false)
    } finally {
      host.dispose()
    }
  })

  it('mounts the main window tree into the default main layer and auto-removes owned windows on close', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      getViewportSize: () => ({ width: 320, height: 240 }),
    })

    const mainWindow = new RenderWindow({ title: 'Main', width: 220, height: 160 })
    const floatWindow = new RenderWindow({ title: 'Float', width: 180, height: 120 })
    mainWindow.addOwnedWindow(floatWindow)

    host.initTheme(ImGuiDarkTheme)
    host.runMainWindow(mainWindow)

    expect(host.getRoots()).toEqual([mainWindow, floatWindow])
    expect(host.layerManager.getRegisteredLayers()).toContain('main')

    floatWindow.onCloseHandler?.()

    expect(host.getRoots()).toEqual([mainWindow])
    expect(mainWindow.getOwnedWindows()).toEqual([])

    host.dispose()
  })

  it('unmounts owned windows when they are disposed directly', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      getViewportSize: () => ({ width: 320, height: 240 }),
    })

    const mainWindow = new RenderWindow({ title: 'Main', width: 220, height: 160 })
    const floatWindow = new RenderWindow({ title: 'Float', width: 180, height: 120 })
    mainWindow.addOwnedWindow(floatWindow)

    host.initTheme(ImGuiDarkTheme)
    host.runMainWindow(mainWindow)

    floatWindow.dispose()

    expect(host.getRoots()).toEqual([mainWindow])
    expect(mainWindow.getOwnedWindows()).toEqual([])

    host.dispose()
  })

  it('syncs main-window themes during renderFrame and delegates main-window close policy', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())

    class AppWindow extends RenderWindow {
      private _theme = ImGuiLightTheme

      override resolveWindowTheme(): ResolvedTheme {
        return this._theme
      }

      switchTheme(theme: ResolvedTheme): void {
        this._theme = theme
        this.markNeedsLayout()
      }
    }

    const onMainWindowClose = vi.fn()
    const mainWindow = new AppWindow({ title: 'Main', width: 220, height: 160 })
    const host = new RuntimeHost({
      canvas,
      getViewportSize: () => ({ width: 320, height: 240 }),
    })

    host.initTheme(mainWindow.resolveWindowTheme())
    host.runMainWindow(mainWindow, { onMainWindowClose })

    expect(host.theme).toBe(ImGuiLightTheme)

    mainWindow.switchTheme(ImGuiDarkTheme)
    host.renderFrame()

    expect(host.theme).toBe(ImGuiDarkTheme)

    mainWindow.onCloseHandler?.()

    expect(onMainWindowClose).toHaveBeenCalledTimes(1)

    host.dispose()
  })

  it('unmounts the main window and delegates close policy when it is disposed directly', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())

    const onMainWindowClose = vi.fn()
    const mainWindow = new RenderWindow({ title: 'Main', width: 220, height: 160 })
    const host = new RuntimeHost({
      canvas,
      getViewportSize: () => ({ width: 320, height: 240 }),
    })

    host.initTheme(ImGuiDarkTheme)
    host.runMainWindow(mainWindow, { onMainWindowClose })

    mainWindow.dispose()

    expect(onMainWindowClose).toHaveBeenCalledTimes(1)
    expect(host.getRoots()).toEqual([])

    host.dispose()
  })

  it('paints runtime roots with filtering', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })
    const first = new TestRoot()
    const second = new TestRoot()
    host.addRoot(first)
    host.addRoot(second)

    host.paintRoots({ ctx: {} as CanvasRenderingContext2D } as PaintContext, root => root !== second)

    expect(first.paintCalls).toBe(1)
    expect(second.paintCalls).toBe(0)

    host.dispose()
  })

  it('disposes existing singleton managers with the runtime', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })
    const focusDispose = vi.spyOn(FocusManager.instance, 'dispose')
    const inputDispose = vi.spyOn(InputComposer.instance, 'dispose')
    const popupDispose = vi.spyOn(PopupManager.instance, 'dispose')
    const overlayDispose = vi.spyOn(OverlayInvalidator.instance, 'dispose')

    host.dispose()

    expect(focusDispose).toHaveBeenCalledTimes(1)
    expect(inputDispose).toHaveBeenCalledTimes(1)
    expect(popupDispose).toHaveBeenCalledTimes(1)
    expect(overlayDispose).toHaveBeenCalledTimes(1)
  })

  it('installs a default tooltip manager for hover tooltips', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })

    const tooltip = TooltipService.currentOrNull
    expect(tooltip).not.toBeNull()

    tooltip!.show('提示', { x: 8, y: 8 }, 0)
    expect(PopupManager.instance.stack.some(popup => (popup as any).overlayLayer === 'tooltip')).toBe(true)

    host.dispose()
    expect(TooltipService.currentOrNull).toBeNull()
  })

  it('auto-wires window focus coordination on addRoot', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })

    const win1 = new RenderWindow({ title: 'Win1' })
    const win2 = new RenderWindow({ title: 'Win2' })
    host.addRoot(win1)
    host.addRoot(win2)

    expect(win1.isFocused).toBe(false)
    expect(win2.isFocused).toBe(false)

    FocusManager.instance.setFocus(win1)

    expect(win1.isFocused).toBe(true)
    expect(win2.isFocused).toBe(false)
    expect(host.getRoots()[host.getRoots().length - 1]).toBe(win1)

    FocusManager.instance.setFocus(win2)

    expect(win1.isFocused).toBe(false)
    expect(win2.isFocused).toBe(true)
    expect(host.getRoots()[host.getRoots().length - 1]).toBe(win2)

    host.dispose()
  })

  it('brings the dragged title-bar window to the front through focus coordination', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 320, height: 240 }),
    })

    const back = new RenderWindow({ title: 'Back', x: 20, y: 20, width: 180, height: 140 })
    const front = new RenderWindow({ title: 'Front', x: 60, y: 40, width: 180, height: 140 })
    host.addRoot(back)
    host.addRoot(front)

    expect(host.getRoots()[host.getRoots().length - 1]).toBe(front)

    back.onPointerDown({
      pointerId: 1,
      position: { x: back.windowX + 20, y: back.windowY + 12 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    back.onPointerMove({
      pointerId: 1,
      position: { x: back.windowX + 40, y: back.windowY + 24 },
      type: 'move',
    })

    expect(back.isFocused).toBe(true)
    expect(host.getRoots()[host.getRoots().length - 1]).toBe(back)

    host.dispose()
  })

  it('repaints color-only theme changes and relayouts metric changes, including in-place updates', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })
    const root = new TestRoot()
    const markNeedsLayout = vi.spyOn(root, 'markNeedsLayout')
    const markNeedsPaint = vi.spyOn(root, 'markNeedsPaint')
    const theme = { ...ImGuiLightTheme } as MutableResolvedTheme

    host.addRoot(root)
    host.initTheme(theme)
    host.renderFrame()
    markNeedsLayout.mockClear()
    markNeedsPaint.mockClear()

    theme.textPrimary = rgba(20, 30, 40)
    host.setTheme(theme)

    expect(markNeedsPaint).toHaveBeenCalled()
    expect(markNeedsLayout).not.toHaveBeenCalled()
    expect(host.frameScheduler.layoutNeeded).toBe(false)

    theme.fontSize += 1
    host.setTheme(theme)

    expect(markNeedsLayout).toHaveBeenCalled()
    expect(host.frameScheduler.layoutNeeded).toBe(true)

    host.dispose()
  })

  it('does not reschedule layout when a window returns equal theme objects', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())

    class EqualThemeWindow extends RenderWindow {
      override resolveWindowTheme(): ResolvedTheme {
        return { ...ImGuiLightTheme }
      }
    }

    const host = new RuntimeHost({
      canvas,
      getViewportSize: () => ({ width: 320, height: 240 }),
    })
    const mainWindow = new EqualThemeWindow({ title: 'Main', width: 220, height: 160 })

    host.initTheme(ImGuiLightTheme)
    host.runMainWindow(mainWindow)
    host.renderFrame()

    expect(host.theme).toBe(ImGuiLightTheme)
    expect(host.frameScheduler.layoutNeeded).toBe(false)

    host.dispose()
  })

  it('does not schedule a follow-up frame while restoring the main-window theme', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }))
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())

    class LightThemeWindow extends RenderWindow {
      override resolveWindowTheme(): ResolvedTheme {
        return ImGuiLightTheme
      }
    }

    const host = new RuntimeHost({
      canvas,
      getViewportSize: () => ({ width: 320, height: 240 }),
    })
    const mainWindow = new LightThemeWindow({ title: 'Main', width: 220, height: 160 })
    host.initTheme(ImGuiDarkTheme)
    host.runMainWindow(mainWindow, { themeSource: 'runtime' })

    callbacks.shift()!(0)
    expect(callbacks).toHaveLength(0)

    host.useMainWindowTheme()
    expect(callbacks).toHaveLength(1)

    callbacks.shift()!(16)

    expect(host.theme).toBe(ImGuiLightTheme)
    expect(callbacks).toHaveLength(0)
    expect(host.frameScheduler.frameScheduled).toBe(false)
    expect(host.frameScheduler.layoutNeeded).toBe(false)

    host.dispose()
  })

  it('composites the previous and current visual bounds after moving a floating window', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    const screen = createCanvasContext()
    ;(canvas as any).getContext = vi.fn(() => screen)
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 480, height: 320 }),
    })
    const mainWindow = new RenderWindow({
      title: 'Main',
      chrome: 'none',
      draggable: false,
      borderStyle: 'fixed',
      showCloseButton: false,
      showMaximizeButton: false,
    })
    const floatWindow = new RenderWindow({
      title: 'Float',
      x: 20,
      y: 20,
      width: 200,
      height: 120,
    })
    host.runMainWindow(mainWindow)
    mainWindow.addOwnedWindow(floatWindow)
    host.renderFrame()

    floatWindow.onPointerDown({
      pointerId: 1,
      position: { x: 40, y: 30 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    host.renderFrame()
    vi.clearAllMocks()

    const previousBounds = { ...floatWindow.paintBounds }
    floatWindow.onPointerMove({
      pointerId: 1,
      position: { x: 80, y: 70 },
      type: 'move',
    })
    const currentBounds = floatWindow.paintBounds
    const expectedDamage = {
      x: Math.min(previousBounds.x, currentBounds.x),
      y: Math.min(previousBounds.y, currentBounds.y),
      width: Math.max(previousBounds.x + previousBounds.width, currentBounds.x + currentBounds.width) -
        Math.min(previousBounds.x, currentBounds.x),
      height: Math.max(previousBounds.y + previousBounds.height, currentBounds.y + currentBounds.height) -
        Math.min(previousBounds.y, currentBounds.y),
    }

    expect(host.getDirtyPaintRectForRoots([floatWindow])).toEqual(expectedDamage)

    host.renderFrame()

    // Damage includes the shadow's old and new bounds, clipped to the backing store.
    const visibleDamage = host.compositor.getPaintRect(expectedDamage)
    expect(screen.clearRect).toHaveBeenCalledWith(visibleDamage.x, visibleDamage.y, visibleDamage.width, visibleDamage.height)
    expect(screen.rect).toHaveBeenCalledWith(visibleDamage.x, visibleDamage.y, visibleDamage.width, visibleDamage.height)

    floatWindow.onPointerUp({ pointerId: 1, position: { x: 80, y: 70 }, type: 'up' })
    host.dispose()
  })

  it('keeps owned windows above their owner when bringing an owner branch to the front', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 320, height: 240 }),
    })

    const mainWindow = new RenderWindow({ title: 'Main', width: 220, height: 160 })
    const floatWindow = new RenderWindow({ title: 'Float', width: 180, height: 120 })
    const otherWindow = new RenderWindow({ title: 'Other', width: 180, height: 120 })
    mainWindow.addOwnedWindow(floatWindow)

    host.initTheme(ImGuiDarkTheme)
    host.runMainWindow(mainWindow)
    host.addRoot(otherWindow)

    expect(host.getRoots()).toEqual([mainWindow, floatWindow, otherWindow])

    host.bringToFront(mainWindow)

    expect(host.getRoots()).toEqual([otherWindow, mainWindow, floatWindow])

    host.dispose()
  })

  it('keeps an owned window branch contiguous and promotes the activated owned window above its siblings', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 320, height: 240 }),
    })

    const mainWindow = new RenderWindow({ title: 'Main', width: 220, height: 160 })
    const firstFloat = new RenderWindow({ title: 'First Float', width: 180, height: 120 })
    const secondFloat = new RenderWindow({ title: 'Second Float', width: 180, height: 120 })
    const otherWindow = new RenderWindow({ title: 'Other', width: 180, height: 120 })
    mainWindow.addOwnedWindow(firstFloat)
    mainWindow.addOwnedWindow(secondFloat)

    host.initTheme(ImGuiDarkTheme)
    host.runMainWindow(mainWindow)
    host.addRoot(otherWindow)

    expect(host.getRoots()).toEqual([mainWindow, firstFloat, secondFloat, otherWindow])
    expect(mainWindow.getOwnedWindows()).toEqual([firstFloat, secondFloat])

    FocusManager.instance.setFocus(firstFloat)

    expect(mainWindow.getOwnedWindows()).toEqual([secondFloat, firstFloat])
    expect(host.getRoots()).toEqual([otherWindow, mainWindow, secondFloat, firstFloat])
    expect(FocusManager.instance.current).toBe(firstFloat)

    host.dispose()
  })

  it('transfers focus to topmost remaining window when focused window is removed', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })

    const mainWindow = new RenderWindow({ title: 'Main' })
    const floatWindow = new RenderWindow({ title: 'Float' })
    host.addRoot(mainWindow)
    host.addRoot(floatWindow)

    FocusManager.instance.setFocus(floatWindow)
    expect(floatWindow.isFocused).toBe(true)

    host.removeRoot(floatWindow)

    expect(host.getRoots()).toEqual([mainWindow])
    expect(floatWindow.isFocused).toBe(false)
    expect(mainWindow.isFocused).toBe(true)

    host.dispose()
  })

  it('closes popups anchored to a root before removing that root', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 320, height: 240 }),
    })
    const root = new RenderWindow({ title: 'Tools' })
    const close = vi.fn()
    const popup = {
      hitTest: vi.fn(() => false),
      close,
    }
    host.addRoot(root)
    PopupManager.instance.open(popup, { anchorRoot: root })

    host.removeRoot(root)

    expect(close).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.hasOpen).toBe(false)

    root.dispose()
    host.dispose()
  })

  it('uses the clipped floating window bounds as an explicit popup root viewport', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 320, height: 240 }),
    })
    const mainWindow = new RenderWindow({ title: 'Main', chrome: 'none' })
    const floatingWindow = new RenderWindow({
      title: 'Floating',
      x: 250,
      y: 180,
      width: 200,
      height: 120,
    })
    mainWindow.addOwnedWindow(floatingWindow)
    host.initTheme(ImGuiDarkTheme)
    host.runMainWindow(mainWindow)
    const popup = {
      hitTest: vi.fn(() => false),
      close: vi.fn(),
    }
    PopupManager.instance.open(popup, { anchorRoot: floatingWindow })

    expect(PopupManager.instance.contextFor(popup).viewport).toEqual({
      x: 250,
      y: 180,
      width: 70,
      height: 60,
      dpr: 1,
    })

    host.dispose()
  })

  it('restores focus after an anchored popup returns focus to the root being removed', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 320, height: 240 }),
    })
    const mainWindow = new RenderWindow({ title: 'Main' })
    const toolWindow = new RenderWindow({ title: 'Tools' })
    const field = new RenderTextBox({ value: 'focused before popup' })
    toolWindow.addChild(field)
    host.addRoot(mainWindow)
    host.addRoot(toolWindow)
    FocusManager.instance.setFocus(field)
    PopupManager.instance.open({
      hitTest: vi.fn(() => false),
      close: vi.fn(),
    }, { anchorRoot: toolWindow })

    expect(FocusManager.instance.current).toBeNull()
    host.removeRoot(toolWindow)

    expect(FocusManager.instance.current).toBe(mainWindow)
    toolWindow.dispose()
    host.dispose()
  })

  it('finishes removing a root when an anchored popup close callback throws', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 320, height: 240 }),
    })
    const mainWindow = new RenderWindow({ title: 'Main' })
    const toolWindow = new RenderWindow({ title: 'Tools' })
    host.addRoot(mainWindow)
    host.addRoot(toolWindow)
    PopupManager.instance.open({
      hitTest: vi.fn(() => false),
      close: () => { throw new Error('close failed') },
    }, { anchorRoot: toolWindow })

    expect(() => host.removeRoot(toolWindow)).not.toThrow()

    expect(host.getRoots()).toEqual([mainWindow])
    expect(PopupManager.instance.hasOpen).toBe(false)
    expect(FocusManager.instance.scopeStack).toHaveLength(1)
    expect(errorLog).toHaveBeenCalledWith(
      'PopupManager popup close callback failed.',
      expect.any(Error),
    )
    toolWindow.dispose()
    host.dispose()
  })

  it('restores focus when a removed window owns the focused child control', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })

    const mainWindow = new RenderWindow({ title: 'Main' })
    const floatWindow = new RenderWindow({ title: 'Float' })
    const field = new RenderTextBox({ value: 'hello' })
    floatWindow.addChild(field)
    host.addRoot(mainWindow)
    host.addRoot(floatWindow)

    FocusManager.instance.setFocus(field)

    expect(FocusManager.instance.current).toBe(field)
    expect(floatWindow.isFocused).toBe(false)

    host.removeRoot(floatWindow)

    expect(FocusManager.instance.current).toBe(mainWindow)
    expect(mainWindow.isFocused).toBe(true)

    host.dispose()
  })

  it('clears focus when removing the last window that owns the focused child control', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })

    const windowRoot = new RenderWindow({ title: 'Main' })
    const field = new RenderTextBox({ value: 'hello' })
    windowRoot.addChild(field)
    host.addRoot(windowRoot)

    FocusManager.instance.setFocus(field)

    expect(FocusManager.instance.current).toBe(field)

    host.removeRoot(windowRoot)

    expect(FocusManager.instance.current).toBe(null)

    host.dispose()
  })

  it('clears focus gain callback on removeRoot and clears isFocused', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })

    const win = new RenderWindow({ title: 'Win' })
    host.addRoot(win)

    FocusManager.instance.setFocus(win)
    expect(win.isFocused).toBe(true)

    host.removeRoot(win)

    expect(win.isFocused).toBe(false)

    const otherWin = new RenderWindow({ title: 'Other' })
    host.addRoot(otherWin)

    win.focusIn()
    expect(otherWin.isFocused).toBe(false)

    host.removeRoot(otherWin)
    host.dispose()
  })

  it('registers window with FocusManager on addRoot and unregisters on removeRoot', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })

    const win = new RenderWindow({ title: 'Win' })
    const fm = FocusManager.instance

    host.addRoot(win)
    expect(fm.scopeStack[0]!.focusables).toContain(win)

    host.removeRoot(win)
    expect(fm.scopeStack[0]!.focusables).not.toContain(win)

    host.dispose()
  })

  it('auto-injects window cursor and maximize helpers, then clears them on removeRoot', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      dpr: 2,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 320, height: 240 }),
    })

    const win = new RenderWindow({
      title: 'Win',
      x: 20,
      y: 20,
      width: 200,
      height: 150,
    })

    host.addRoot(win)

    win.onPointerMove({
      pointerId: 1,
      position: { x: win.windowX + win.windowWidth - 1, y: win.windowY + 40 },
      type: 'move',
    })

    expect(canvas.style.cursor).toBe('e-resize')

    const buttonSize = win.TITLE_HEIGHT * 0.6
    const buttonMargin = (win.TITLE_HEIGHT - buttonSize) / 2
    const closeButtonX = win.windowX + win.windowWidth - buttonSize - buttonMargin
    const maxButtonX = closeButtonX - buttonSize - buttonMargin
    const buttonY = win.windowY + buttonMargin

    win.onPointerDown({
      pointerId: 2,
      position: { x: maxButtonX + buttonSize / 2, y: buttonY + buttonSize / 2 },
      type: 'down',
    })

    expect(win.windowX).toBe(0)
    expect(win.windowY).toBe(0)
    expect(win.windowWidth).toBe(320)
    expect(win.windowHeight).toBe(240)

    host.removeRoot(win)

    expect(canvas.style.cursor).toBe('default')

    win.onPointerMove({
      pointerId: 3,
      position: { x: win.windowX + win.windowWidth - 1, y: win.windowY + 40 },
      type: 'move',
    })

    expect(canvas.style.cursor).toBe('default')

    host.dispose()
  })

  it('keeps host-managed main-window auto-resize synced through addRoot and host resize', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    let viewport = { width: 320, height: 240 }
    const host = new RuntimeHost({
      canvas,
      dpr: 2,
      onFrame: vi.fn(),
      getViewportSize: () => viewport,
    })

    const win = new RenderWindow({
      title: 'Win',
      autoResizeInset: 20,
    })

    host.addRoot(win)

    host.flushLayout()

    expect(win.windowX).toBe(20)
    expect(win.windowY).toBe(20)
    expect(win.windowWidth).toBe(280)
    expect(win.windowHeight).toBe(200)

    viewport = { width: 400, height: 300 }
    host.resize()
    host.flushLayout()

    expect(win.windowX).toBe(20)
    expect(win.windowY).toBe(20)
    expect(win.windowWidth).toBe(360)
    expect(win.windowHeight).toBe(260)

    host.dispose()
  })

  it('clears focus gain callbacks on dispose for all registered window roots', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })

    const win1 = new RenderWindow({ title: 'Win1' })
    const win2 = new RenderWindow({ title: 'Win2' })
    host.addRoot(win1)
    host.addRoot(win2)

    expect(win1.isFocused).toBe(false)
    expect(win2.isFocused).toBe(false)

    host.dispose()

    const anotherWin = new RenderWindow({ title: 'Other' })
    win1.focusIn()
    win2.focusIn()

    expect(win1.isFocused).toBe(true)
    expect(win2.isFocused).toBe(true)
    expect(anotherWin.isFocused).toBe(false)
  })

it('re-added window does not carry stale focused state', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = vi.fn(() => createCanvasContext())
    const host = new RuntimeHost({
      canvas,
      onFrame: vi.fn(),
      getViewportSize: () => ({ width: 100, height: 50 }),
    })

    const mainWin = new RenderWindow({ title: 'Main' })
    const floatWin = new RenderWindow({ title: 'Float' })
    host.addRoot(mainWin)
    host.addRoot(floatWin)

    FocusManager.instance.setFocus(floatWin)
    expect(floatWin.isFocused).toBe(true)

    host.removeRoot(floatWin)

    expect(floatWin.isFocused).toBe(false)
    expect(FocusManager.instance.current).toBe(mainWin)

    host.addRoot(floatWin)

    expect(floatWin.isFocused).toBe(false)
    expect(FocusManager.instance.current).toBe(mainWin)

FocusManager.disposeInstance()
    host.dispose()
  })
})
