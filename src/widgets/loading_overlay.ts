import { DisposableBag, type DisposeFn } from '../core/disposable'
import type { Offset, Size } from '../core/render_object'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { deriveLoadingStyle } from '../theme/component_styles'
import { colorToCSS } from '../theme/theme'

export class LoadingOverlayController {
  private _loading = false
  private _text?: string
  private _spinAngle = 0
  private _spinDisposer?: DisposeFn
  private readonly _disposables = new DisposableBag()

  constructor(
    private readonly _requestPaint: () => void,
    options: {
      loading?: boolean
      text?: string
    } = {},
  ) {
    this._text = options.text
    if (options.loading) this.setLoading(true)
  }

  get loading(): boolean {
    return this._loading
  }

  get text(): string | undefined {
    return this._text
  }

  setLoading(loading: boolean, text?: string): boolean {
    const textChanged = text !== undefined && this._text !== text
    if (textChanged) this._text = text
    if (this._loading === loading) {
      if (textChanged && this._loading) this._requestPaint()
      return textChanged
    }

    this._loading = loading
    if (loading) {
      this._startSpin()
    } else {
      this._stopSpin()
    }
    this._requestPaint()
    return true
  }

  setText(text?: string): boolean {
    if (this._text === text) return false
    this._text = text
    if (this._loading) this._requestPaint()
    return true
  }

  paint(context: PaintContext, offset: Offset, size: Size): void {
    if (!this._loading || size.width <= 0 || size.height <= 0) return

    const style = deriveLoadingStyle(context.theme)
    const dl = new DrawList(context)
    const x = offset.x
    const y = offset.y
    const w = size.width
    const h = size.height
    dl.pushClip(x, y, w, h)
    dl.fillRect(x, y, w, h, style.maskBg, 0)

    this.paintIndicator(context, offset, size)
    dl.popClip()
  }

  paintIndicator(context: PaintContext, offset: Offset, size: Size): void {
    if (size.width <= 0 || size.height <= 0) return
    const style = deriveLoadingStyle(context.theme)
    const spinnerSize = Math.min(style.spinnerSize, Math.max(0, size.width), Math.max(0, size.height))
    if (spinnerSize <= 0) return

    const hasText = !!this._text
    const textHeight = hasText ? style.fontSize : 0
    const groupHeight = spinnerSize + (hasText ? style.textGap + textHeight : 0)
    const spinnerTop = offset.y + (size.height - groupHeight) / 2
    const cx = offset.x + size.width / 2
    const cy = spinnerTop + spinnerSize / 2
    const radius = Math.max(0, (spinnerSize - style.spinnerLineWidth) / 2)
    const ctx = context.ctx

    ctx.save()
    ctx.lineWidth = style.spinnerLineWidth
    ctx.lineCap = 'round'
    ctx.strokeStyle = colorToCSS(style.spinnerTrackColor)
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = colorToCSS(style.spinnerColor)
    ctx.beginPath()
    ctx.arc(cx, cy, radius, this._spinAngle, this._spinAngle + Math.PI * 1.35)
    ctx.stroke()
    ctx.restore()

    if (hasText) {
      const dl = new DrawList(context)
      dl.fillText(
        this._text!,
        cx,
        cy + spinnerSize / 2 + style.textGap + style.fontSize / 2,
        style.text,
        style.fontSize,
        style.fontFamily,
        'center',
        'middle',
      )
    }
  }

  dispose(): void {
    this._stopSpin()
    this._disposables.dispose()
  }

  private _startSpin(): void {
    if (this._spinDisposer) return
    this._spinDisposer = this._disposables.setInterval(() => {
      this._spinAngle = (this._spinAngle + 0.12) % (Math.PI * 2)
      this._requestPaint()
    }, 16)
  }

  private _stopSpin(): void {
    if (!this._spinDisposer) return
    this._spinDisposer()
    this._spinDisposer = undefined
  }
}
