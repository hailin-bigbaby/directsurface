import { constrainSize, type BoxConstraints, type LayoutContext, type Offset, type Size } from '../core/render_object'
import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { deriveTextStyle } from '../theme/component_styles'
import { colorToCSS, type Color } from '../theme/theme'
import { paintIconGlyph, type IconName } from './icon'

export type ImagePreviewFit = 'cover' | 'contain' | 'fill' | 'none'
export type ImagePreviewShape = 'rectangle' | 'rounded' | 'circle'
export type ImagePreviewSource = string | CanvasImageSource | null | undefined
export type ImagePreviewLoadState = 'empty' | 'loading' | 'loaded' | 'error'

interface ImageMetrics {
  width: number
  height: number
}

export interface ImagePreviewDebugState {
  sourceType: 'none' | 'url' | 'canvas'
  loadState: ImagePreviewLoadState
  fit: ImagePreviewFit
  shape: ImagePreviewShape
  displayRect: { x: number; y: number; width: number; height: number }
  imageSize: Size | null
}

export interface RenderImagePreviewOptions extends RenderBoxOptions {
  source?: ImagePreviewSource
  src?: string
  size?: number
  fit?: ImagePreviewFit
  shape?: ImagePreviewShape
  cornerRadius?: number
  backgroundColor?: Color
  borderColor?: Color
  borderWidth?: number
  placeholderText?: string
  placeholderIcon?: IconName
  crossOrigin?: string
}

const defaultExtent = 40

export class RenderImagePreview extends RenderBox {
  static override debugTypeName = 'RenderImagePreview'
  fit: ImagePreviewFit
  shape: ImagePreviewShape
  cornerRadius?: number
  backgroundColor?: Color
  borderColor?: Color
  borderWidth: number
  placeholderText?: string
  placeholderIcon?: IconName
  crossOrigin?: string

  private _source: ImagePreviewSource
  private _image: CanvasImageSource | null = null
  private _loadingImage: HTMLImageElement | null = null
  private _loadState: ImagePreviewLoadState = 'empty'
  private _loadToken = 0
  private _displayRect = { x: 0, y: 0, width: 0, height: 0 }
  private _imageSize: Size | null = null

  constructor(options: RenderImagePreviewOptions = {}) {
    super({
      ...options,
      width: options.width ?? options.size,
      height: options.height ?? options.size,
    })
    this._source = options.source ?? options.src ?? null
    this.fit = options.fit ?? 'cover'
    this.shape = options.shape ?? 'rounded'
    this.cornerRadius = options.cornerRadius
    this.backgroundColor = options.backgroundColor
    this.borderColor = options.borderColor
    this.borderWidth = options.borderWidth ?? 0
    this.placeholderText = options.placeholderText
    this.placeholderIcon = options.placeholderIcon
    this.crossOrigin = options.crossOrigin
    this._syncSource()
  }

  get source(): ImagePreviewSource {
    return this._source
  }

  set source(value: ImagePreviewSource) {
    this.setSource(value)
  }

  get loadState(): ImagePreviewLoadState {
    return this._loadState
  }

  setSource(source: ImagePreviewSource): void {
    if (this._source === source) return
    this._source = source
    this._syncSource()
    this.markNeedsLayout()
  }

  visitChildren(): void {}

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    const natural = this._naturalSize()
    const width = this.width ?? (this.height && natural ? this.height * natural.width / natural.height : defaultExtent)
    const height = this.height ?? (this.width && natural ? this.width * natural.height / natural.width : defaultExtent)
    this.size = constrainSize(constraints, { width, height })
    this._imageSize = natural ? { ...natural } : null
    this._displayRect = this._resolveDisplayRect(natural)
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const bg = this.backgroundColor ?? context.theme.surfaceDataHeader
    const border = this.borderColor ?? context.theme.borderSubtle
    const radius = this._resolvedRadius()
    if (this.shape === 'circle') {
      dl.fillCircle(offset.x + this.size.width / 2, offset.y + this.size.height / 2, radius, bg)
    } else {
      dl.fillRect(offset.x, offset.y, this.size.width, this.size.height, bg, radius)
    }

    const image = this._loadState === 'loaded' ? this._image : null
    if (image) {
      this._paintClipped(context, offset, radius, () => {
        context.ctx.drawImage(
          image,
          offset.x + this._displayRect.x,
          offset.y + this._displayRect.y,
          this._displayRect.width,
          this._displayRect.height,
        )
      })
    } else {
      this._paintPlaceholder(context, offset)
    }

    if (this.borderWidth > 0) {
      if (this.shape === 'circle') {
        dl.strokeCircle(offset.x + this.size.width / 2, offset.y + this.size.height / 2, radius, border, this.borderWidth)
      } else {
        dl.strokeRect(offset.x, offset.y, this.size.width, this.size.height, border, this.borderWidth, radius)
      }
    }
  }

  debugState(): ImagePreviewDebugState {
    return {
      sourceType: typeof this._source === 'string' ? 'url' : this._source ? 'canvas' : 'none',
      loadState: this._loadState,
      fit: this.fit,
      shape: this.shape,
      displayRect: { ...this._displayRect },
      imageSize: this._imageSize ? { ...this._imageSize } : null,
    }
  }

  override dispose(): void {
    this._loadToken += 1
    this._clearLoadingImage()
    super.dispose()
  }

  private _syncSource(): void {
    this._loadToken += 1
    const token = this._loadToken
    this._clearLoadingImage()
    this._image = null
    this._imageSize = null
    if (!this._source) {
      this._loadState = 'empty'
      this.markNeedsPaint()
      return
    }
    if (typeof this._source !== 'string') {
      this._image = this._source
      this._loadState = 'loaded'
      this.markNeedsPaint()
      return
    }
    if (typeof Image === 'undefined') {
      this._loadState = 'error'
      this.markNeedsPaint()
      return
    }

    const image = new Image()
    this._loadingImage = image
    if (this.crossOrigin) image.crossOrigin = this.crossOrigin
    this._loadState = 'loading'
    image.onload = () => {
      if (this._loadToken !== token) return
      this._clearLoadingImage()
      this._image = image
      this._loadState = 'loaded'
      this.markNeedsLayout()
    }
    image.onerror = () => {
      if (this._loadToken !== token) return
      this._clearLoadingImage()
      this._image = null
      this._loadState = 'error'
      this.markNeedsPaint()
    }
    image.src = this._source
  }

  private _clearLoadingImage(): void {
    if (!this._loadingImage) return
    this._loadingImage.onload = null
    this._loadingImage.onerror = null
    this._loadingImage = null
  }

  private _naturalSize(): ImageMetrics | null {
    if (!this._image) return null
    const source = this._image as {
      naturalWidth?: number
      naturalHeight?: number
      videoWidth?: number
      videoHeight?: number
      width?: number
      height?: number
    }
    const width = source.naturalWidth ?? source.videoWidth ?? source.width ?? 0
    const height = source.naturalHeight ?? source.videoHeight ?? source.height ?? 0
    if (width <= 0 || height <= 0) return null
    return { width, height }
  }

  private _resolveDisplayRect(natural: ImageMetrics | null): { x: number; y: number; width: number; height: number } {
    const boxW = this.size.width
    const boxH = this.size.height
    if (!natural || boxW <= 0 || boxH <= 0) return { x: 0, y: 0, width: boxW, height: boxH }
    if (this.fit === 'fill') return { x: 0, y: 0, width: boxW, height: boxH }
    if (this.fit === 'none') {
      return {
        x: (boxW - natural.width) / 2,
        y: (boxH - natural.height) / 2,
        width: natural.width,
        height: natural.height,
      }
    }
    const scale = this.fit === 'cover'
      ? Math.max(boxW / natural.width, boxH / natural.height)
      : Math.min(boxW / natural.width, boxH / natural.height)
    const width = natural.width * scale
    const height = natural.height * scale
    return {
      x: (boxW - width) / 2,
      y: (boxH - height) / 2,
      width,
      height,
    }
  }

  private _paintClipped(context: PaintContext, offset: Offset, radius: number, paint: () => void): void {
    const ctx = context.ctx
    ctx.save()
    ctx.beginPath()
    if (this.shape === 'circle') {
      const r = Math.min(this.size.width, this.size.height) / 2
      ctx.arc(offset.x + this.size.width / 2, offset.y + this.size.height / 2, r, 0, Math.PI * 2)
    } else if (radius > 0) {
      ctx.roundRect(offset.x, offset.y, this.size.width, this.size.height, radius)
    } else {
      ctx.rect(offset.x, offset.y, this.size.width, this.size.height)
    }
    ctx.clip()
    paint()
    ctx.restore()
  }

  private _paintPlaceholder(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const textStyle = deriveTextStyle(context.theme)
    const centerX = offset.x + this.size.width / 2
    const centerY = offset.y + this.size.height / 2
    if (this.placeholderText) {
      dl.fillText(
        this.placeholderText.slice(0, 2).toUpperCase(),
        centerX,
        centerY,
        context.theme.textSecondary,
        Math.max(12, Math.min(this.size.width, this.size.height) * 0.36),
        textStyle.fontFamily,
        'center',
        'middle',
        600,
      )
      return
    }
    if (this.placeholderIcon) {
      const iconSize = Math.max(12, Math.min(this.size.width, this.size.height) * 0.52)
      paintIconGlyph(context, {
        name: this.placeholderIcon,
        x: centerX - iconSize / 2,
        y: centerY - iconSize / 2,
        size: iconSize,
        color: context.theme.textSecondary,
      })
      return
    }
    const ctx = context.ctx
    const size = Math.max(8, Math.min(this.size.width, this.size.height) * 0.34)
    ctx.save()
    ctx.strokeStyle = colorToCSS(context.theme.textSecondary)
    ctx.lineWidth = Math.max(1, size * 0.08)
    ctx.beginPath()
    ctx.arc(centerX, centerY - size * 0.2, size * 0.22, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(centerX, centerY + size * 0.38, size * 0.38, Math.PI, 0)
    ctx.stroke()
    ctx.restore()
  }

  private _resolvedRadius(): number {
    if (this.shape === 'circle') return Math.min(this.size.width, this.size.height) / 2
    if (this.shape === 'rectangle') return 0
    return this.cornerRadius ?? Math.min(8, Math.min(this.size.width, this.size.height) / 5)
  }
}
