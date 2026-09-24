// DrawList: low-level Canvas 2D drawing primitives with ImGui-style helpers.

import { colorToCSS, type Color } from '../theme/theme'
import type { PaintContext } from './paint_context'

export interface DrawListStats {
  fillRect: number
  strokeRect: number
  fillText: number
  measureText: number
  line: number
  path: number
  save: number
  restore: number
  fillStyleChanges: number
  strokeStyleChanges: number
  fontChanges: number
}

const emptyStats = (): DrawListStats => ({
  fillRect: 0,
  strokeRect: 0,
  fillText: 0,
  measureText: 0,
  line: 0,
  path: 0,
  save: 0,
  restore: 0,
  fillStyleChanges: 0,
  strokeStyleChanges: 0,
  fontChanges: 0,
})

export class DrawList {
  private ctx: CanvasRenderingContext2D
  private _fillStyle: string | CanvasGradient | CanvasPattern | null = null
  private _strokeStyle: string | CanvasGradient | CanvasPattern | null = null
  private _font = ''
  private _lineWidth = NaN
  private _textAlign: CanvasTextAlign | null = null
  private _textBaseline: CanvasTextBaseline | null = null
  private static _colorCache = new Map<string, string>()
  private static _fontCache = new Map<string, string>()
  private static _profileEnabled = false
  private static _stats: DrawListStats = emptyStats()

  constructor(context: PaintContext) {
    this.ctx = context.ctx
  }

  static setProfiling(enabled: boolean): void {
    DrawList._profileEnabled = enabled
    if (enabled) DrawList.resetStats()
  }

  static resetStats(): void {
    DrawList._stats = emptyStats()
  }

  static getStats(): DrawListStats {
    return { ...DrawList._stats }
  }

  fillRect(x: number, y: number, w: number, h: number, color: Color, rounding = 0): void {
    const c = this.ctx
    this._count('fillRect')
    this._setFillStyle(this._colorToCSS(color))
    const rect = this._snapRect(x, y, w, h)
    if (rounding > 0) {
      this._save()
      c.beginPath()
      c.roundRect(rect.x, rect.y, rect.w, rect.h, rounding)
      c.fill()
      this._restore()
      this._invalidateState()
      return
    }
    c.fillRect(rect.x, rect.y, rect.w, rect.h)
  }

  drawImage(image: CanvasImageSource, x: number, y: number, w: number, h: number, rounding = 0): void {
    const c = this.ctx
    const rect = this._snapRect(x, y, w, h)
    if (rounding > 0) {
      this._save()
      try {
        c.beginPath()
        c.roundRect(rect.x, rect.y, rect.w, rect.h, rounding)
        c.clip()
        c.drawImage(image, rect.x, rect.y, rect.w, rect.h)
      } finally {
        this._restore()
        this._invalidateState()
      }
      return
    }
    c.drawImage(image, rect.x, rect.y, rect.w, rect.h)
  }

  strokeRect(x: number, y: number, w: number, h: number, color: Color, lineWidth = 1, rounding = 0): void {
    const c = this.ctx
    this._count('strokeRect')
    this._setStrokeStyle(this._colorToCSS(color))
    this._setLineWidth(lineWidth)
    const rect = this._snapStrokeRect(x, y, w, h, lineWidth)
    if (rounding > 0) {
      this._save()
      c.beginPath()
      c.roundRect(rect.x, rect.y, rect.w, rect.h, Math.max(0, rounding - lineWidth / 2))
      c.stroke()
      this._restore()
      this._invalidateState()
      return
    }
    c.strokeRect(rect.x, rect.y, rect.w, rect.h)
  }

  strokeRectDashed(
    x: number,
    y: number,
    w: number,
    h: number,
    color: Color,
    lineWidth = 1,
    rounding = 0,
    dash: readonly number[] = [4, 3],
  ): void {
    const c = this.ctx
    this._count('strokeRect')
    this._save()
    c.strokeStyle = this._colorToCSS(color)
    c.lineWidth = lineWidth
    if (typeof c.setLineDash === 'function') c.setLineDash([...dash])
    const rect = this._snapStrokeRect(x, y, w, h, lineWidth)
    if (rounding > 0) {
      c.beginPath()
      c.roundRect(rect.x, rect.y, rect.w, rect.h, Math.max(0, rounding - lineWidth / 2))
      c.stroke()
    } else {
      c.strokeRect(rect.x, rect.y, rect.w, rect.h)
    }
    if (typeof c.setLineDash === 'function') c.setLineDash([])
    this._restore()
    this._invalidateState()
  }

  fillRectGradient(
    x: number,
    y: number,
    w: number,
    h: number,
    colorTop: Color,
    colorBottom: Color,
    rounding = 0,
  ): void {
    const c = this.ctx
    this._count('fillRect')
    this._save()
    const rect = this._snapRect(x, y, w, h)
    const grad = c.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h)
    grad.addColorStop(0, this._colorToCSS(colorTop))
    grad.addColorStop(1, this._colorToCSS(colorBottom))
    c.fillStyle = grad
    if (rounding > 0) {
      c.beginPath()
      c.roundRect(rect.x, rect.y, rect.w, rect.h, rounding)
      c.fill()
    } else {
      c.fillRect(rect.x, rect.y, rect.w, rect.h)
    }
    this._restore()
    this._invalidateState()
  }

  shadow(x: number, y: number, w: number, h: number, blur: number, color: Color, rounding = 0): void {
    this.outerShadow(x, y, w, h, blur, color, rounding, 0, 2)
  }

  dropShadow(
    x: number,
    y: number,
    w: number,
    h: number,
    blur: number,
    color: Color,
    rounding = 0,
    offsetX = 0,
    offsetY = 0,
  ): void {
    const c = this.ctx
    this._count('path')
    this._save()
    const rect = this._snapRect(x, y, w, h)
    c.shadowColor = this._colorToCSS(color)
    c.shadowBlur = blur
    c.shadowOffsetX = offsetX
    c.shadowOffsetY = offsetY
    c.fillStyle = 'rgba(0,0,0,1)'
    if (rounding > 0) {
      c.beginPath()
      c.roundRect(rect.x, rect.y, rect.w, rect.h, rounding)
      c.fill()
    } else {
      c.fillRect(rect.x, rect.y, rect.w, rect.h)
    }
    this._restore()
    this._invalidateState()
  }

  fillTopRoundedRect(x: number, y: number, w: number, h: number, color: Color, rounding = 0): void {
    const c = this.ctx
    this._count('fillRect')
    this._save()
    const rect = this._snapRect(x, y, w, h)
    c.fillStyle = this._colorToCSS(color)
    if (rounding > 0) {
      c.beginPath()
      c.roundRect(rect.x, rect.y, rect.w, rect.h, [rounding, rounding, 0, 0])
      c.fill()
    } else {
      c.fillRect(rect.x, rect.y, rect.w, rect.h)
    }
    this._restore()
    this._invalidateState()
  }

  shadowBehind(
    x: number,
    y: number,
    w: number,
    h: number,
    blur: number,
    color: Color,
    rounding = 0,
    offsetX = 0,
    offsetY = 0,
  ): void {
    const c = this.ctx
    this._count('path')
    this._save()
    const rect = this._snapRect(x, y, w, h)
    c.globalCompositeOperation = 'destination-over'
    c.shadowColor = this._colorToCSS(color)
    c.shadowBlur = blur
    c.shadowOffsetX = offsetX
    c.shadowOffsetY = offsetY
    c.fillStyle = 'rgba(0,0,0,1)'
    if (rounding > 0) {
      c.beginPath()
      c.roundRect(rect.x, rect.y, rect.w, rect.h, rounding)
      c.fill()
    } else {
      c.fillRect(rect.x, rect.y, rect.w, rect.h)
    }
    this._restore()
    this._invalidateState()
  }

  outerShadow(
    x: number,
    y: number,
    w: number,
    h: number,
    blur: number,
    color: Color,
    rounding = 0,
    offsetX = 0,
    offsetY = 0,
  ): void {
    const c = this.ctx
    this._count('path')
    this._save()
    const rect = this._snapRect(x, y, w, h)
    const extent = Math.max(blur * 2 + Math.abs(offsetX), blur * 2 + Math.abs(offsetY), 1)
    c.beginPath()
    c.rect(rect.x - extent, rect.y - extent, rect.w + extent * 2, rect.h + extent * 2)
    if (rounding > 0) {
      c.roundRect(rect.x, rect.y, rect.w, rect.h, rounding)
    } else {
      c.rect(rect.x, rect.y, rect.w, rect.h)
    }
    c.clip('evenodd')
    c.shadowColor = this._colorToCSS(color)
    c.shadowBlur = blur
    c.shadowOffsetX = offsetX
    c.shadowOffsetY = offsetY
    c.fillStyle = 'rgba(0,0,0,1)'
    if (rounding > 0) {
      c.beginPath()
      c.roundRect(rect.x, rect.y, rect.w, rect.h, rounding)
      c.fill()
    } else {
      c.fillRect(rect.x, rect.y, rect.w, rect.h)
    }
    this._restore()
    this._invalidateState()
  }

  fillText(
    text: string,
    x: number,
    y: number,
    color: Color,
    fontSize: number,
    fontFamily: string,
    align: CanvasTextAlign = 'left',
    baseline: CanvasTextBaseline = 'middle',
    fontWeight?: string | number,
    fontStyle?: 'normal' | 'italic',
  ): void {
    const c = this.ctx
    this._count('fillText')
    this._setFillStyle(this._colorToCSS(color))
    this._setFont(this._fontString(fontSize, fontFamily, fontWeight, fontStyle))
    this._setTextAlign(align)
    this._setTextBaseline(baseline)
    c.fillText(text, this._snapCoord(x), this._snapCoord(y))
  }

  measureText(text: string, fontSize: number, fontFamily: string, fontWeight?: string | number, fontStyle?: 'normal' | 'italic'): TextMetrics {
    this._count('measureText')
    this._setFont(this._fontString(fontSize, fontFamily, fontWeight, fontStyle))
    return this.ctx.measureText(text)
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Color, lineWidth = 1): void {
    const c = this.ctx
    this._count('line')
    this._setStrokeStyle(this._colorToCSS(color))
    this._setLineWidth(lineWidth)
    const line = this._snapLine(x1, y1, x2, y2, lineWidth)
    c.beginPath()
    c.moveTo(line.x1, line.y1)
    c.lineTo(line.x2, line.y2)
    c.stroke()
  }

  lineDashed(x1: number, y1: number, x2: number, y2: number, color: Color, lineWidth = 1, dash: readonly number[] = [4, 3]): void {
    const c = this.ctx
    this._count('line')
    this._save()
    c.strokeStyle = this._colorToCSS(color)
    c.lineWidth = lineWidth
    if (typeof c.setLineDash === 'function') c.setLineDash([...dash])
    const line = this._snapLine(x1, y1, x2, y2, lineWidth)
    c.beginPath()
    c.moveTo(line.x1, line.y1)
    c.lineTo(line.x2, line.y2)
    c.stroke()
    if (typeof c.setLineDash === 'function') c.setLineDash([])
    this._restore()
    this._invalidateState()
  }

  fillPolygon(points: ReadonlyArray<{ x: number; y: number }>, color: Color): void {
    if (points.length < 3) return
    const c = this.ctx
    this._count('path')
    this._setFillStyle(this._colorToCSS(color))
    c.beginPath()
    c.moveTo(this._snapCoord(points[0]!.x), this._snapCoord(points[0]!.y))
    for (let i = 1; i < points.length; i++) {
      c.lineTo(this._snapCoord(points[i]!.x), this._snapCoord(points[i]!.y))
    }
    c.closePath()
    c.fill()
  }

  strokePolygon(points: ReadonlyArray<{ x: number; y: number }>, color: Color, lineWidth = 1): void {
    if (points.length < 2) return
    const c = this.ctx
    this._count('path')
    this._setStrokeStyle(this._colorToCSS(color))
    this._setLineWidth(lineWidth)
    c.beginPath()
    c.moveTo(this._snapCoord(points[0]!.x), this._snapCoord(points[0]!.y))
    for (let i = 1; i < points.length; i++) {
      c.lineTo(this._snapCoord(points[i]!.x), this._snapCoord(points[i]!.y))
    }
    c.closePath()
    c.stroke()
  }

  fillCircle(cx: number, cy: number, r: number, color: Color): void {
    const c = this.ctx
    this._count('path')
    this._setFillStyle(this._colorToCSS(color))
    c.beginPath()
    c.arc(this._snapCoord(cx), this._snapCoord(cy), r, 0, Math.PI * 2)
    c.fill()
  }

  strokeCircle(cx: number, cy: number, r: number, color: Color, lineWidth = 1): void {
    const c = this.ctx
    this._count('path')
    this._setStrokeStyle(this._colorToCSS(color))
    this._setLineWidth(lineWidth)
    c.beginPath()
    c.arc(this._snapCoord(cx), this._snapCoord(cy), r, 0, Math.PI * 2)
    c.stroke()
  }

  drawCheckmark(x: number, y: number, size: number, color: Color, lineWidth = 2): void {
    const c = this.ctx
    this._count('path')
    this._save()
    c.strokeStyle = this._colorToCSS(color)
    c.lineWidth = lineWidth
    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.beginPath()
    c.moveTo(x + size * 0.15, y + size * 0.5)
    c.lineTo(x + size * 0.4, y + size * 0.75)
    c.lineTo(x + size * 0.85, y + size * 0.25)
    c.stroke()
    this._restore()
    this._invalidateState()
  }

  pushClip(x: number, y: number, w: number, h: number): void {
    const rect = this._snapRect(x, y, w, h)
    this._save()
    this.ctx.beginPath()
    this.ctx.rect(rect.x, rect.y, rect.w, rect.h)
    this.ctx.clip()
  }

  pushRoundedClip(x: number, y: number, w: number, h: number, rounding = 0): void {
    const rect = this._snapRect(x, y, w, h)
    this._save()
    this.ctx.beginPath()
    if (rounding > 0) {
      this.ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rounding)
    } else {
      this.ctx.rect(rect.x, rect.y, rect.w, rect.h)
    }
    this.ctx.clip()
  }

  popClip(): void {
    this._restore()
    this._invalidateState()
  }

  private _setFillStyle(style: string | CanvasGradient | CanvasPattern): void {
    if (this._fillStyle === style) return
    this.ctx.fillStyle = style
    this._fillStyle = style
    this._count('fillStyleChanges')
  }

  private _setStrokeStyle(style: string | CanvasGradient | CanvasPattern): void {
    if (this._strokeStyle === style) return
    this.ctx.strokeStyle = style
    this._strokeStyle = style
    this._count('strokeStyleChanges')
  }

  private _setFont(font: string): void {
    if (this._font === font) return
    this.ctx.font = font
    this._font = font
    this._count('fontChanges')
  }

  private _setLineWidth(lineWidth: number): void {
    if (this._lineWidth === lineWidth) return
    this.ctx.lineWidth = lineWidth
    this._lineWidth = lineWidth
  }

  private _setTextAlign(align: CanvasTextAlign): void {
    if (this._textAlign === align) return
    this.ctx.textAlign = align
    this._textAlign = align
  }

  private _setTextBaseline(baseline: CanvasTextBaseline): void {
    if (this._textBaseline === baseline) return
    this.ctx.textBaseline = baseline
    this._textBaseline = baseline
  }

  private _save(): void {
    this.ctx.save()
    this._count('save')
  }

  private _restore(): void {
    this.ctx.restore()
    this._count('restore')
  }

  private _invalidateState(): void {
    this._fillStyle = null
    this._strokeStyle = null
    this._font = ''
    this._lineWidth = NaN
    this._textAlign = null
    this._textBaseline = null
  }

  private _colorToCSS(color: Color): string {
    const key = `${color.r},${color.g},${color.b},${color.a}`
    let css = DrawList._colorCache.get(key)
    if (!css) {
      css = colorToCSS(color)
      DrawList._colorCache.set(key, css)
    }
    return css
  }

  private _fontString(fontSize: number, fontFamily: string, fontWeight?: string | number, fontStyle?: 'normal' | 'italic'): string {
    const key = `${fontStyle ?? ''}|${fontWeight ?? ''}|${fontSize}|${fontFamily}`
    let font = DrawList._fontCache.get(key)
    if (!font) {
      font = [fontStyle === 'italic' ? 'italic' : '', fontWeight ?? '', `${fontSize}px`, fontFamily].filter(Boolean).join(' ')
      DrawList._fontCache.set(key, font)
    }
    return font
  }

  private _snapRect(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
    const left = this._snapCoord(x)
    const top = this._snapCoord(y)
    const right = this._snapCoord(x + w)
    const bottom = this._snapCoord(y + h)
    return {
      x: left,
      y: top,
      w: Math.max(0, right - left),
      h: Math.max(0, bottom - top),
    }
  }

  private _snapStrokeRect(
    x: number,
    y: number,
    w: number,
    h: number,
    lineWidth: number,
  ): { x: number; y: number; w: number; h: number } {
    const offset = this._strokeOffset(lineWidth)
    const left = this._snapCoord(x) + offset
    const top = this._snapCoord(y) + offset
    const right = this._snapCoord(x + w) - offset
    const bottom = this._snapCoord(y + h) - offset
    return {
      x: left,
      y: top,
      w: Math.max(0, right - left),
      h: Math.max(0, bottom - top),
    }
  }

  private _snapLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    lineWidth: number,
  ): { x1: number; y1: number; x2: number; y2: number } {
    if (x1 === x2) {
      const x = this._snapCoord(x1) + this._strokeOffset(lineWidth)
      return { x1: x, y1: this._snapCoord(y1), x2: x, y2: this._snapCoord(y2) }
    }
    if (y1 === y2) {
      const y = this._snapCoord(y1) + this._strokeOffset(lineWidth)
      return { x1: this._snapCoord(x1), y1: y, x2: this._snapCoord(x2), y2: y }
    }
    return {
      x1: this._snapCoord(x1),
      y1: this._snapCoord(y1),
      x2: this._snapCoord(x2),
      y2: this._snapCoord(y2),
    }
  }

  private _strokeOffset(lineWidth: number): number {
    const step = this._pixelStep()
    const physicalLineWidth = lineWidth / step
    const rounded = Math.round(physicalLineWidth)
    if (Math.abs(physicalLineWidth - rounded) < 0.001 && rounded % 2 === 1) return step / 2
    return 0
  }

  private _snapCoord(value: number): number {
    const step = this._pixelStep()
    return this._roundToStep(value, step)
  }

  private _roundToStep(value: number, step: number): number {
    return Math.round(value / step) * step
  }

  private _pixelStep(): number {
    const transform = typeof this.ctx.getTransform === 'function' ? this.ctx.getTransform() : null
    const scale = transform ? Math.max(Math.abs(transform.a || 0), Math.abs(transform.d || 0), 1) : 1
    return 1 / scale
  }

  private _count(key: keyof DrawListStats): void {
    if (!DrawList._profileEnabled) return
    DrawList._stats[key]++
  }
}
