import { Compositor, type DirtyRect, type LayerName } from '../rendering/compositor'
import type { PaintContext } from '../rendering/paint_context'

export interface LayerPaintScope {
  layer: LayerName
  context: PaintContext
}

export type LayerPaintTimings = Record<LayerName, number>

export interface LayerRegistration {
  layer: LayerName
  clear?: boolean
  paint?: (scope: LayerPaintScope) => void
  shouldPaint?: () => boolean
  dirtyRect?: () => DirtyRect | undefined
}

export interface LayerPainterRegistration {
  layer: LayerName
  paint: (scope: LayerPaintScope) => void
  shouldPaint?: () => boolean
  dirtyRect?: () => DirtyRect | undefined
}

export interface LayerDirtyDebugInfo {
  layer: LayerName
  dirty: 'full' | 'rect'
  rect?: DirtyRect
}

export class LayerManager {
  private readonly _layers = new Map<LayerName, { clear: boolean }>()
  private readonly _painters: LayerPainterRegistration[] = []
  private readonly _dirtyLayers = new Map<LayerName, DirtyRect | null>()

  constructor(private readonly _compositor: Compositor) {}

  registerLayer(registration: LayerRegistration): () => void {
    this._compositor.registerLayer(registration.layer)
    this._layers.set(registration.layer, { clear: registration.clear ?? true })
    this.markDirty(registration.layer)
    if (registration.paint) {
      const unregisterPainter = this.registerPainter({
        layer: registration.layer,
        paint: registration.paint,
        shouldPaint: registration.shouldPaint,
        dirtyRect: registration.dirtyRect,
      })
      return () => {
        unregisterPainter()
        this.unregisterLayer(registration.layer)
      }
    }
    return () => this.unregisterLayer(registration.layer)
  }

  unregisterLayer(layer: LayerName): void {
    this._layers.delete(layer)
    this._dirtyLayers.delete(layer)
    for (let i = this._painters.length - 1; i >= 0; i--) {
      if (this._painters[i]!.layer === layer) this._painters.splice(i, 1)
    }
    this._compositor.unregisterLayer(layer)
  }

  registerPainter(registration: LayerPainterRegistration): () => void {
    this._compositor.registerLayer(registration.layer)
    if (!this._layers.has(registration.layer)) {
      this._layers.set(registration.layer, { clear: true })
    }
    this._painters.push(registration)
    this.markDirty(registration.layer)
    return () => {
      const idx = this._painters.indexOf(registration)
      if (idx >= 0) this._painters.splice(idx, 1)
    }
  }

  markDirty(layer: LayerName): void {
    this._dirtyLayers.set(layer, null)
  }

  markDirtyRect(layer: LayerName, rect: DirtyRect): void {
    const existing = this._dirtyLayers.get(layer)
    if (existing === null) return
    this._dirtyLayers.set(layer, existing ? unionRect(existing, rect) : { ...rect })
  }

  markAllDirty(): void {
    for (const layer of this._compositor.getLayerOrder()) this.markDirty(layer)
  }

  isLayerDirty(layer: LayerName): boolean {
    return this._dirtyLayers.has(layer)
  }

  get hasDirtyLayers(): boolean {
    return this._compositor.getLayerOrder().some(layer => this._dirtyLayers.has(layer))
  }

  debugDirtyLayers(): LayerDirtyDebugInfo[] {
    return [...this._dirtyLayers.entries()].map(([layer, rect]) => ({
      layer,
      dirty: rect === null ? 'full' : 'rect',
      rect: rect === null ? undefined : { ...rect },
    }))
  }

  paintAll(): LayerPaintTimings {
    const timings: LayerPaintTimings = {}
    for (const layer of this._compositor.getLayerOrder()) {
      if (!this._layers.has(layer)) {
        this._layers.set(layer, { clear: true })
      }
      const registration = this._layers.get(layer)!
      let layerDirty = this._dirtyLayers.get(layer)
      const explicitlyDirty = layerDirty !== undefined
      const painters: LayerPainterRegistration[] = []
      for (const painter of this._painters) {
        if (painter.layer !== layer) continue
        const requested = painter.shouldPaint?.()
        if (requested === false) continue
        painters.push(painter)
        if (requested !== true || layerDirty === null) continue
        const painterDirty = painter.dirtyRect?.()
        if (painterDirty) {
          layerDirty = layerDirty === undefined ? painterDirty : unionRect(layerDirty, painterDirty)
        } else if (!explicitlyDirty) {
          // An explicit damage rect already defines the requested redraw boundary.
          layerDirty = null
        }
      }
      if (layerDirty === undefined) continue
      const startedAt = now()
      const paintRect = layerDirty === null ? undefined : this._compositor.getPaintRect(layerDirty)
      // Consume before callbacks so invalidations raised while painting belong to the next pass.
      this._dirtyLayers.delete(layer)
      if (paintRect && (paintRect.width <= 0 || paintRect.height <= 0)) {
        continue
      }
      try {
        if (registration.clear) this._compositor.clearLayer(layer, paintRect)
        const context = this._compositor.getContext(layer)
        for (const painter of painters) {
          // Each painter gets the same damage clip and starts from the layer's base transform.
          // Restore even on exceptions so a painter cannot leak its clip or drawing state.
          context.ctx.save()
          try {
            if (paintRect) context.clipRect(paintRect.x, paintRect.y, paintRect.width, paintRect.height)
            painter.paint({ layer, context })
          } finally {
            context.ctx.restore()
          }
        }
      } catch (error) {
        if (layerDirty === null) this.markDirty(layer)
        else this.markDirtyRect(layer, layerDirty)
        throw error
      }
      if (paintRect) this._compositor.markDirtyRect(layer, paintRect)
      else this._compositor.markDirty(layer)
      timings[layer] = now() - startedAt
    }
    return timings
  }

  getRegisteredLayers(): LayerName[] {
    return [...this._layers.keys()]
  }
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function unionRect(a: DirtyRect, b: DirtyRect): DirtyRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}
