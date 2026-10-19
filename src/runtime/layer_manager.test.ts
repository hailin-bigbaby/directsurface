import { describe, expect, it, vi } from 'vitest'
import { LayerManager } from './layer_manager'
import type { Compositor, LayerName } from '../rendering/compositor'
import { PaintContext } from '../rendering/paint_context'

class TestCompositor {
  clearLayer = vi.fn()
  markDirty = vi.fn()
  markDirtyRect = vi.fn()
  getPaintRect = vi.fn(rect => ({ ...rect }))
  registerLayer = vi.fn()
  unregisterLayer = vi.fn()
  private readonly _order: LayerName[] = ['background', 'main', 'overlay']
  private readonly _contexts = new Map<LayerName, PaintContext>()

  getLayerOrder(): LayerName[] {
    return [...this._order]
  }

  getContext(layer: LayerName): PaintContext {
    if (!this._contexts.has(layer)) {
      this._contexts.set(layer, new PaintContext({ save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn() } as unknown as CanvasRenderingContext2D))
    }
    return this._contexts.get(layer)!
  }
}

describe('Layer paint invalidation', () => {
  it.each(['full', 'partial'] as const)('retains %s damage requested during painting for the next pass', mode => {
    const compositor = new TestCompositor()
    const manager = new LayerManager(compositor as unknown as Compositor)
    const damage = { x: 40, y: 20, width: 12, height: 8 }
    let invalidate = false
    const paint = vi.fn(() => {
      if (!invalidate) return
      invalidate = false
      if (mode === 'full') manager.markDirty('main')
      else manager.markDirtyRect('main', damage)
    })
    manager.registerLayer({ layer: 'main', shouldPaint: () => manager.isLayerDirty('main'), paint })
    manager.paintAll()
    invalidate = true
    manager.markDirty('main')
    manager.paintAll()
    expect(manager.isLayerDirty('main')).toBe(true)
    vi.clearAllMocks()
    manager.paintAll()
    expect(paint).toHaveBeenCalledTimes(1)
    expect(compositor.clearLayer).toHaveBeenCalledWith('main', mode === 'full' ? undefined : damage)
    expect(manager.isLayerDirty('main')).toBe(false)
  })

  it('retains both consumed and newly requested damage after a painter throws', () => {
    const compositor = new TestCompositor()
    const manager = new LayerManager(compositor as unknown as Compositor)
    let fail = false
    manager.registerLayer({ layer: 'main', paint: () => {
      if (!fail) return
      manager.markDirtyRect('main', { x: 40, y: 30, width: 10, height: 10 })
      throw new Error('paint failed')
    } })
    manager.paintAll()
    manager.markDirtyRect('main', { x: 10, y: 10, width: 10, height: 10 })
    fail = true
    expect(() => manager.paintAll()).toThrow('paint failed')
    fail = false
    manager.paintAll()
    expect(compositor.clearLayer).toHaveBeenLastCalledWith('main', { x: 10, y: 10, width: 40, height: 30 })
    expect(manager.hasDirtyLayers).toBe(false)
  })


  it('clears removed layers and does not schedule unregistered layers', () => {
    const compositor = new TestCompositor()
    const manager = new LayerManager(compositor as unknown as Compositor)
    manager.registerLayer({ layer: 'main', paint: vi.fn() })
    manager.paintAll()
    manager.markDirty('main')
    manager.unregisterLayer('main')
    expect(manager.isLayerDirty('main')).toBe(false)
    manager.markDirty('unregistered')
    expect(manager.hasDirtyLayers).toBe(false)
  })
})


describe("Partial repaint damage and state", () => {
  it('unions all painter damage and replays persistent content regardless of registration order', () => {
    const compositor = new TestCompositor()
    const manager = new LayerManager(compositor as unknown as Compositor)
    const calls: string[] = []
    manager.registerPainter({ layer: 'main', paint: () => calls.push('background') })
    manager.registerPainter({ layer: 'main', shouldPaint: () => true,
      dirtyRect: () => ({ x: 10, y: 10, width: 10, height: 10 }), paint: () => calls.push('a') })
    manager.registerPainter({ layer: 'main', shouldPaint: () => true,
      dirtyRect: () => ({ x: 40, y: 20, width: 10, height: 10 }), paint: () => calls.push('b') })
    manager.paintAll()
    calls.length = 0
    vi.clearAllMocks()
    manager.paintAll()
    expect(calls).toEqual(['background', 'a', 'b'])
    expect(compositor.clearLayer).toHaveBeenCalledWith('main', { x: 10, y: 10, width: 40, height: 20 })
    const ctx = compositor.getContext('main').ctx
    expect(ctx.rect).toHaveBeenCalledTimes(3)
    expect(ctx.rect).toHaveBeenLastCalledWith(10, 10, 40, 20)
    expect(ctx.clip).toHaveBeenCalledTimes(3)
    expect(ctx.save).toHaveBeenCalledTimes(3)
    expect(ctx.restore).toHaveBeenCalledTimes(3)
  })

  it('uses aligned damage for clearing, clipping and screen invalidation', () => {
    const compositor = new TestCompositor()
    const manager = new LayerManager(compositor as unknown as Compositor)
    const aligned = { x: 0, y: 0, width: 11, height: 11 }
    compositor.getPaintRect.mockReturnValue(aligned)
    manager.registerLayer({ layer: 'main', paint: vi.fn() })
    manager.paintAll()
    vi.clearAllMocks()
    manager.markDirtyRect('main', { x: 0.2, y: 0.2, width: 10, height: 10 })
    manager.paintAll()
    expect(compositor.clearLayer).toHaveBeenCalledWith('main', aligned)
    expect(compositor.getContext('main').ctx.rect).toHaveBeenCalledWith(0, 0, 11, 11)
    expect(compositor.markDirtyRect).toHaveBeenCalledWith('main', aligned)
  })

  it('restores the canvas state when a painter throws', () => {
    const compositor = new TestCompositor()
    const manager = new LayerManager(compositor as unknown as Compositor)
    manager.registerLayer({ layer: 'main', paint: () => { throw new Error('paint failed') } })
    expect(() => manager.paintAll()).toThrow('paint failed')
    expect(compositor.getContext('main').ctx.restore).toHaveBeenCalledTimes(1)
    expect(manager.isLayerDirty('main')).toBe(true)
  })

  it('preserves explicit partial damage when shouldPaint observes the dirty layer', () => {
    const compositor = new TestCompositor()
    const manager = new LayerManager(compositor as unknown as Compositor)
    manager.registerLayer({ layer: 'main', shouldPaint: () => manager.isLayerDirty('main'), paint: vi.fn() })
    manager.paintAll()
    vi.clearAllMocks()
    const damage = { x: 2, y: 3, width: 8, height: 9 }
    manager.markDirtyRect('main', damage)
    manager.paintAll()
    expect(compositor.clearLayer).toHaveBeenCalledWith('main', damage)
    expect(compositor.markDirty).not.toHaveBeenCalled()
    expect(compositor.markDirtyRect).toHaveBeenCalledWith('main', damage)
  })

  it('does not leave pending work after offscreen damage or layer removal', () => {
    const compositor = new TestCompositor()
    const manager = new LayerManager(compositor as unknown as Compositor)
    const paint = vi.fn()
    manager.registerLayer({ layer: 'main', paint })
    manager.paintAll()
    paint.mockClear()
    compositor.getPaintRect.mockReturnValue({ x: 0, y: 0, width: 0, height: 0 })
    manager.markDirtyRect('main', { x: -100, y: -100, width: 10, height: 10 })
    manager.paintAll()
    expect(paint).not.toHaveBeenCalled()
    expect(manager.hasDirtyLayers).toBe(false)
    manager.markDirty('main')
    manager.unregisterLayer('main')
    expect(manager.isLayerDirty('main')).toBe(false)
    manager.markDirty('unregistered')
    expect(manager.hasDirtyLayers).toBe(false)
  })

})
