import { describe, expect, it, vi } from 'vitest'
import { LayerManager } from './layer_manager'
import type { Compositor, LayerName } from '../rendering/compositor'
import { PaintContext } from '../rendering/paint_context'

class TestCompositor {
  clearLayer = vi.fn()
  markDirty = vi.fn()
  markDirtyRect = vi.fn()
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
