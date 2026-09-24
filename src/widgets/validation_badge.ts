import { constrainSize, type BoxConstraints, type LayoutContext, type Offset, RenderObject } from '../core/render_object'
import type { InteractiveRenderObject } from '../gestures/recognizers'
import type { PointerEvent } from '../gestures/hit_test'
import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { deriveLabeledFieldStyle, resolveContrastText } from '../theme/component_styles'
import type { FormFieldStatus } from './form_field_shell'

export class RenderValidationBadge extends RenderBox implements InteractiveRenderObject {
  static override debugTypeName = 'RenderValidationBadge'
  private _status: Extract<FormFieldStatus, 'error' | 'warning'>
  private _hovered = false
  private _offsetResolver?: () => Offset | null

  constructor(options: {
    status: Extract<FormFieldStatus, 'error' | 'warning'>
    message: string
  }) {
    super()
    this._status = options.status
    this.tooltip = options.message
    this.tooltipDelay = 0
  }

  get status(): Extract<FormFieldStatus, 'error' | 'warning'> { return this._status }
  set status(value: Extract<FormFieldStatus, 'error' | 'warning'>) {
    if (this._status === value) return
    this._status = value
    this.markNeedsPaint()
  }

  get message(): string { return typeof this.tooltip === 'string' ? this.tooltip : '' }
  set message(value: string) {
    if (this.message === value) return
    this.tooltip = value
  }

  setOffsetResolver(resolver?: () => Offset | null): void {
    this._offsetResolver = resolver
    this.syncToHostPosition()
  }

  syncToHostPosition(): void {
    const nextOffset = this._offsetResolver?.()
    if (!nextOffset) return
    this.offset = nextOffset
  }

  override prepareForRenderOrHitTest(): void {
    this.syncToHostPosition()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveLabeledFieldStyle(context.theme)
    this.size = constrainSize(constraints, {
      width: style.indicatorSize,
      height: style.indicatorSize,
    })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveLabeledFieldStyle(context.theme)
    const tone = this._status === 'error' ? style.statusColors.error : style.statusColors.warning
    const indicatorBg = this._hovered ? tone : { ...tone, a: Math.max(0.82, tone.a) }
    const dl = new DrawList(context)
    dl.fillRect(
      offset.x,
      offset.y,
      this.size.width,
      this.size.height,
      indicatorBg,
      style.indicatorRadius,
    )
    dl.fillText(
      '!',
      offset.x + this.size.width / 2,
      offset.y + this.size.height / 2,
      resolveContrastText(context.theme, indicatorBg),
      Math.max(10, style.indicatorSize - 1),
      context.theme.fontFamily,
      'center',
      'middle',
    )
  }

  onPointerEnter(_event: PointerEvent): void {
    if (this._hovered) return
    this._hovered = true
    this.markNeedsPaint()
  }

  onPointerLeave(_event: PointerEvent): void {
    if (!this._hovered) return
    this._hovered = false
    this.markNeedsPaint()
  }
}
