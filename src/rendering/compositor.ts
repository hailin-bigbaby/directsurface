// Compositor: 多层 Canvas 合成 + 脏矩形局部重绘

import { PaintContext } from './paint_context'

export type LayerName = string

export const DEFAULT_LAYER_ORDER: LayerName[] = ['background', 'main', 'transient', 'overlay', 'tooltip']

export interface DirtyRect {
  x: number
  y: number
  width: number
  height: number
}

type LayerCanvas = OffscreenCanvas | HTMLCanvasElement

function unionRect(a: DirtyRect, b: DirtyRect): DirtyRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}

export class Compositor {
  private layers = new Map<LayerName, LayerCanvas>()
  private layerOrder: LayerName[] = []
  // 每层的脏矩形（null 表示全层脏）
  private dirtyRects = new Map<LayerName, DirtyRect | null>()
  private width: number
  private height: number
  private dpr: number
  private physicalWidth: number
  private physicalHeight: number
  readonly screenCanvas: HTMLCanvasElement
  private screenCtx: CanvasRenderingContext2D

  constructor(canvas: HTMLCanvasElement, dpr = 1) {
    this.screenCanvas = canvas
    this.screenCtx = canvas.getContext('2d')!
    this.dpr = dpr
    this.width = canvas.width / dpr
    this.height = canvas.height / dpr
    this.physicalWidth = canvas.width
    this.physicalHeight = canvas.height

    for (const name of DEFAULT_LAYER_ORDER) this.registerLayer(name)
  }

  resize(width: number, height: number, dpr = this.dpr): void {
    this.width = width
    this.height = height
    this.dpr = dpr
    this.physicalWidth = Math.max(1, Math.round(width * dpr))
    this.physicalHeight = Math.max(1, Math.round(height * dpr))
    this.screenCanvas.width = this.physicalWidth
    this.screenCanvas.height = this.physicalHeight
    for (const name of this.layerOrder) {
      const off = this._createLayerCanvas()
      this.layers.set(name, off)
      this.dirtyRects.set(name, null)
    }
  }

  registerLayer(name: LayerName, index?: number): void {
    if (this.layers.has(name)) return
    const off = this._createLayerCanvas()
    this.layers.set(name, off)
    if (index === undefined || index < 0 || index >= this.layerOrder.length) {
      this.layerOrder.push(name)
    } else {
      this.layerOrder.splice(index, 0, name)
    }
    this.dirtyRects.set(name, null)
  }

  unregisterLayer(name: LayerName): void {
    this.layers.delete(name)
    this.dirtyRects.delete(name)
    this.layerOrder = this.layerOrder.filter(layer => layer !== name)
  }

  getLayerOrder(): LayerName[] {
    return [...this.layerOrder]
  }

  getContext(layer: LayerName): PaintContext {
    if (!this.layers.has(layer)) this.registerLayer(layer)
    const off = this.layers.get(layer)!
    return new PaintContext(this._getLayerContext(off))
  }

  // 标记整层脏
  markDirty(layer: LayerName): void {
    this.dirtyRects.set(layer, null)
  }

  // 标记局部脏矩形
  markDirtyRect(layer: LayerName, rect: DirtyRect): void {
    const existing = this.dirtyRects.get(layer)
    if (existing === null) return  // 已经是全层脏，不需要合并
    if (existing === undefined) {
      this.dirtyRects.set(layer, rect)
    } else {
      this.dirtyRects.set(layer, unionRect(existing, rect))
    }
  }

  // 清除指定层（全层或脏矩形区域）
  clearLayer(layer: LayerName, rect?: DirtyRect): void {
    if (!this.layers.has(layer)) this.registerLayer(layer)
    const off = this.layers.get(layer)!
    const ctx = this._getLayerContext(off)
    if (rect) {
      ctx.clearRect(rect.x, rect.y, rect.width, rect.height)
    } else {
      ctx.clearRect(0, 0, this.width, this.height)
    }
  }

  isDirty(layer: LayerName): boolean {
    return this.dirtyRects.get(layer) !== undefined
  }

  // 合成到屏幕 Canvas（只重绘脏区域）
  composite(): void {
    const sc = this.screenCtx
    let hasDirty = false
    let fullDirty = false
    let unionDirty: DirtyRect | undefined
    for (const name of this.layerOrder) {
      const dr = this.dirtyRects.get(name)
      if (dr === undefined) continue
      hasDirty = true
      if (dr === null) {
        fullDirty = true
        break
      }
      unionDirty = unionDirty ? unionRect(unionDirty, dr) : dr
    }

    if (!hasDirty) return

    if (fullDirty) {
      // 全屏重绘
      sc.clearRect(0, 0, this.physicalWidth, this.physicalHeight)
      for (const name of this.layerOrder) {
        sc.drawImage(this.layers.get(name)!, 0, 0)
      }
    } else if (unionDirty) {
      // 局部重绘
      const { x, y, width, height } = this._toPhysicalRect(unionDirty)
      sc.clearRect(x, y, width, height)
      sc.save()
      sc.beginPath()
      sc.rect(x, y, width, height)
      sc.clip()
      for (const name of this.layerOrder) {
        sc.drawImage(this.layers.get(name)!, 0, 0)
      }
      sc.restore()
    }

    // 清空脏标记
    for (const name of this.layerOrder) {
      this.dirtyRects.delete(name)
    }
  }

  private _createLayerCanvas(): LayerCanvas {
    if (typeof OffscreenCanvas !== 'undefined') {
      return new OffscreenCanvas(this.physicalWidth, this.physicalHeight)
    }
    const canvas = this.screenCanvas.ownerDocument.createElement('canvas')
    canvas.width = this.physicalWidth
    canvas.height = this.physicalHeight
    return canvas
  }

  private _getLayerContext(canvas: LayerCanvas): CanvasRenderingContext2D {
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
    if (typeof ctx.setTransform === 'function') {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    }
    return ctx
  }

  private _toPhysicalRect(rect: DirtyRect): DirtyRect {
    const x = Math.floor(rect.x * this.dpr)
    const y = Math.floor(rect.y * this.dpr)
    const right = Math.ceil((rect.x + rect.width) * this.dpr)
    const bottom = Math.ceil((rect.y + rect.height) * this.dpr)
    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
    }
  }
}
