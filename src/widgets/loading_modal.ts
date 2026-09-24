import { PopupManager, type Popup, type PopupContext } from '../core/popup_manager'
import type { Offset } from '../core/render_object'
import type { PointerEvent, WheelPointerEvent } from '../gestures/hit_test'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { TextMeasurer } from '../core/text_measurer'
import { deriveLoadingStyle, deriveModalStyle, deriveProgressBarStyle } from '../theme/component_styles'
import { lerpColor, rgba } from '../theme/theme'
import { LoadingOverlayController } from './loading_overlay'

export interface RenderLoadingModalOptions {
  text?: string
  progress?: number
}

export class RenderLoadingModal implements Popup {
  readonly overlayLayer = 'overlay' as const

  private readonly _overlay = new LoadingOverlayController(
    () => PopupManager.instance.requestPaint(),
  )
  private _visible = false
  private _progress: number | undefined

  constructor(options: RenderLoadingModalOptions = {}) {
    this._overlay.setText(options.text)
    this._progress = this._normalizeProgress(options.progress)
  }

  get visible(): boolean {
    return this._visible
  }

  get text(): string | undefined {
    return this._overlay.text
  }

  get progress(): number | undefined {
    return this._progress
  }

  show(): void {
    if (!this._visible) {
      this._visible = true
      this._overlay.setLoading(true)
      PopupManager.instance.open(this, { persistent: true })
    }
    PopupManager.instance.bringToFront(this)
    PopupManager.instance.requestPaint()
  }

  setText(text?: string): void {
    this._overlay.setText(text)
  }

  setProgress(progress?: number): void {
    const next = this._normalizeProgress(progress)
    if (this._progress === next) return
    this._progress = next
    PopupManager.instance.requestPaint()
  }

  close(): void {
    if (!this._visible) return
    this._visible = false
    this._overlay.setLoading(false)
    PopupManager.instance.dismiss(this)
    PopupManager.instance.requestPaint()
  }

  onPointerDown(_event: PointerEvent, _context: PopupContext): void {}

  onPointerMove(_event: PointerEvent, context: PopupContext): void {
    context.setCursor?.('default')
  }

  onPointerUp(_event: PointerEvent, _context: PopupContext): void {}

  onPointerCancel(_event: PointerEvent, _context: PopupContext): void {}

  onWheel(_event: WheelPointerEvent, _context: PopupContext): boolean {
    return true
  }

  onOutsidePointerDown(_event: PointerEvent, _context: PopupContext): boolean {
    return true
  }

  onEscape(event: KeyboardEvent): boolean {
    event.preventDefault()
    return true
  }

  onKeyDown(event: KeyboardEvent): boolean {
    event.preventDefault()
    return true
  }

  hitTest(point: Offset, context: PopupContext): boolean {
    if (!this._visible) return false
    const x = context.viewport.x ?? 0
    const y = context.viewport.y ?? 0
    return point.x >= x &&
      point.x <= x + context.viewport.width &&
      point.y >= y &&
      point.y <= y + context.viewport.height
  }

  paint(context: PaintContext, offset: Offset = { x: 0, y: 0 }): void {
    if (!this._visible) return
    const popupContext = PopupManager.instance.context
    const viewport = popupContext.viewport
    if (viewport.width <= 0 || viewport.height <= 0) return

    const dl = new DrawList(context)
    const modal = deriveModalStyle(context.theme)
    const loading = deriveLoadingStyle(context.theme)
    const x = offset.x + (viewport.x ?? 0)
    const y = offset.y + (viewport.y ?? 0)
    const width = viewport.width
    const height = viewport.height
    const panel = this._panelRect(context, popupContext)

    dl.fillRect(x, y, width, height, loading.maskBg, 0)
    dl.outerShadow(
      panel.x,
      panel.y,
      panel.width,
      panel.height,
      modal.shadowBlur,
      modal.shadowColor,
      modal.borderRadius,
      modal.shadowOffsetX,
      modal.shadowOffsetY,
    )
    dl.fillRect(panel.x, panel.y, panel.width, panel.height, modal.panelBg, modal.borderRadius)
    dl.strokeRect(panel.x, panel.y, panel.width, panel.height, modal.panelBorder, 1, modal.borderRadius)
    dl.pushClip(panel.x + modal.padding, panel.y + modal.padding, panel.width - modal.padding * 2, panel.indicatorHeight)
    this._overlay.paintIndicator(context, {
      x: panel.x + modal.padding,
      y: panel.y + modal.padding,
    }, {
      width: panel.width - modal.padding * 2,
      height: panel.indicatorHeight,
    })
    dl.popClip()
    if (this._progress !== undefined) {
      this._paintProgress(context, panel.x + modal.padding, panel.progressY, panel.width - modal.padding * 2, panel.progressHeight)
    }
  }

  dispose(): void {
    this.close()
    this._overlay.dispose()
  }

  private _panelRect(context: PaintContext, popupContext: PopupContext): {
    x: number
    y: number
    width: number
    height: number
    indicatorHeight: number
    progressY: number
    progressHeight: number
  } {
    const modal = deriveModalStyle(context.theme)
    const loading = deriveLoadingStyle(context.theme)
    const progress = deriveProgressBarStyle(context.theme)
    const text = this._overlay.text
    const textWidth = text ? TextMeasurer.measureWidth(text, loading.fontSize, loading.fontFamily) : 0
    const contentWidth = Math.max(loading.spinnerSize, textWidth)
    const contentHeight = loading.spinnerSize + (text ? loading.textGap + loading.fontSize : 0)
    const hasProgress = this._progress !== undefined
    const progressHeight = hasProgress ? Math.max(10, Math.min(16, progress.height)) : 0
    const progressGap = hasProgress ? modal.padding : 0
    const width = Math.max(hasProgress ? 240 : 168, Math.min(360, contentWidth + modal.padding * 4))
    const height = Math.max(88, contentHeight + progressGap + progressHeight + modal.padding * 2)
    const indicatorHeight = height - modal.padding * 2 - progressGap - progressHeight
    return {
      x: (popupContext.viewport.x ?? 0) + (popupContext.viewport.width - width) / 2,
      y: (popupContext.viewport.y ?? 0) + (popupContext.viewport.height - height) / 2,
      width,
      height,
      indicatorHeight,
      progressY: (popupContext.viewport.y ?? 0) + (popupContext.viewport.height - height) / 2 + modal.padding + indicatorHeight + progressGap,
      progressHeight,
    }
  }

  private _paintProgress(context: PaintContext, x: number, y: number, width: number, height: number): void {
    if (this._progress === undefined || width <= 0 || height <= 0) return
    const progress = deriveProgressBarStyle(context.theme)
    const dl = new DrawList(context)
    const radius = height / 2
    const fillWidth = Math.max(0, Math.min(width, width * this._progress))

    dl.fillRect(x, y, width, height, progress.trackBg, radius)
    dl.strokeRect(x, y, width, height, progress.trackBorder, 1, radius)
    if (fillWidth > 0) {
      const ctx = context.ctx
      dl.pushClip(x, y, width, height)
      ctx.save()
      const grad = ctx.createLinearGradient(x, y, x, y + height)
      const fill = progress.fillBg
      const top = lerpColor(fill, rgba(255, 255, 255), 0.18)
      grad.addColorStop(0, `rgba(${top.r},${top.g},${top.b},${top.a})`)
      grad.addColorStop(1, `rgba(${fill.r},${fill.g},${fill.b},${fill.a})`)
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.roundRect(x, y, fillWidth, height, radius)
      ctx.fill()
      ctx.restore()
      dl.popClip()
    }

    dl.pushClip(x + 2, y, width - 4, height)
    dl.fillText(
      `${Math.round(this._progress * 100)}%`,
      x + width / 2,
      y + height / 2,
      progress.text,
      progress.labelFontSize,
      progress.fontFamily,
      'center',
      'middle',
    )
    dl.popClip()
  }

  private _normalizeProgress(progress?: number): number | undefined {
    if (progress === undefined || Number.isNaN(progress)) return undefined
    return Math.max(0, Math.min(1, progress))
  }
}
