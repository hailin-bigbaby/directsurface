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
      const context = this._compositor.getContext(layer)
      const painters: LayerPainterRegistration[] = []
      for (const painter of this._painters) {
        if (painter.layer !== layer) continue
        if (layerDirty !== undefined) {
          if (painter.shouldPaint && !painter.shouldPaint()) continue
          painters.push(painter)
          continue
        }
        if (!painter.shouldPaint || !painter.shouldPaint()) continue
        painters.push(painter)
        const painterDirty = painter.dirtyRect?.()
        if (painterDirty === undefined) {
          layerDirty = null
        } else if (layerDirty === undefined) {
          layerDirty = painterDirty
        } else if (layerDirty !== null) {
          layerDirty = unionRect(layerDirty, painterDirty)
        }
      }
      if (layerDirty === undefined) continue
      const startedAt = now()
      if (registration.clear) {
        this._compositor.clearLayer(layer, layerDirty ?? undefined)
      }
      for (const painter of painters) {
        painter.paint({ layer, context })
      }
      if (layerDirty === null) this._compositor.markDirty(layer)
      else this._compositor.markDirtyRect(layer, layerDirty)
      this._dirtyLayers.delete(layer)
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
