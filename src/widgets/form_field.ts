import { TextMeasurer } from '../core/text_measurer'
import { constrainSize, type BoxConstraints, type LayoutContext, type Offset, RenderObject } from '../core/render_object'
import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { fitSingleLineText } from '../rendering/text_painter'
import { deriveLabeledFieldStyle } from '../theme/component_styles'
import type { FormFieldStatus } from './form_field_shell'
import { RenderValidationBadge } from './validation_badge'

export type FormFieldValidationDisplay = 'compact' | 'inline' | 'status-only' | 'none'
export type FormFieldMetaTone = 'default' | 'success' | 'warning' | 'danger'
export type FormFieldLabelOverflow = 'expand' | 'clip' | 'ellipsis'
export type FormFieldLabelPlacement = 'inline' | 'top'

export interface RenderFormFieldOptions {
  label: string
  child?: RenderBox
  unit?: string
  metaText?: string
  metaTone?: FormFieldMetaTone
  labelWidth?: number
  labelGap?: number
  labelOverflow?: FormFieldLabelOverflow
  labelPlacement?: FormFieldLabelPlacement
  required?: boolean
  status?: FormFieldStatus
  message?: string
  validationDisplay?: FormFieldValidationDisplay
}

export class RenderFormField extends RenderBox {
  static override debugTypeName = 'RenderFormField'
  label: string
  child?: RenderBox
  private _unit = ''
  private _metaText = ''
  private _metaTone: FormFieldMetaTone = 'default'
  private _validationBadge?: RenderValidationBadge
  private _validationBadgeHost?: RenderBox
  private _labelWidth?: number
  private _parentLabelWidthOverride?: number
  private _parentLabelOverflowOverride?: FormFieldLabelOverflow
  private _parentLabelPlacementOverride?: FormFieldLabelPlacement
  private _parentValidationDisplayOverride?: FormFieldValidationDisplay
  private _labelGap?: number
  private _labelOverflow: FormFieldLabelOverflow = 'expand'
  private _labelPlacement: FormFieldLabelPlacement = 'inline'
  private _required = false
  private _status: FormFieldStatus = 'default'
  private _message = ''
  private _validationDisplay: FormFieldValidationDisplay = 'compact'
  private _resolvedLabelWidth = 0
  private _resolvedLabelPlacement: FormFieldLabelPlacement = 'inline'
  private _paintLabelText = ''
  private _paintLabelWidth = 0
  private _labelOverflowed = false
  private _labelRowHeight = 0
  private _editorRowTop = 0
  private _rowHeight = 0
  private _childOuterRight = 0

  constructor(options: RenderFormFieldOptions) {
    super()
    this.label = options.label
    this.child = options.child
    this._unit = options.unit ?? ''
    this._metaText = options.metaText ?? ''
    this._metaTone = options.metaTone ?? 'default'
    this._labelWidth = options.labelWidth
    this._labelGap = options.labelGap
    this._labelOverflow = options.labelOverflow ?? 'expand'
    this._labelPlacement = options.labelPlacement ?? 'inline'
    this._required = options.required ?? false
    this._status = options.status ?? 'default'
    this._message = options.message ?? ''
    this._validationDisplay = options.validationDisplay ?? 'compact'
    if (this.child) this.child.parent = this
    this._syncValidationBadge()
    this._syncChildValidationState()
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  get labelWidth(): number | undefined { return this._labelWidth }
  set labelWidth(value: number | undefined) {
    if (this._labelWidth === value) return
    this._labelWidth = value
    this.markNeedsLayout()
  }

  get parentLabelWidthOverride(): number | undefined { return this._parentLabelWidthOverride }
  setParentLabelWidthOverride(value: number | undefined, options: { markNeedsLayout?: boolean } = {}): void {
    if (this._parentLabelWidthOverride === value) return
    this._parentLabelWidthOverride = value
    if (options.markNeedsLayout ?? true) this.markNeedsLayout()
  }

  get parentLabelOverflowOverride(): FormFieldLabelOverflow | undefined { return this._parentLabelOverflowOverride }
  setParentLabelOverflowOverride(value: FormFieldLabelOverflow | undefined, options: { markNeedsLayout?: boolean } = {}): void {
    if (this._parentLabelOverflowOverride === value) return
    this._parentLabelOverflowOverride = value
    if (options.markNeedsLayout ?? true) this.markNeedsLayout()
  }

  get parentLabelPlacementOverride(): FormFieldLabelPlacement | undefined { return this._parentLabelPlacementOverride }
  setParentLabelPlacementOverride(value: FormFieldLabelPlacement | undefined, options: { markNeedsLayout?: boolean } = {}): void {
    if (this._parentLabelPlacementOverride === value) return
    this._parentLabelPlacementOverride = value
    if (options.markNeedsLayout ?? true) this.markNeedsLayout()
  }

  get parentValidationDisplayOverride(): FormFieldValidationDisplay | undefined { return this._parentValidationDisplayOverride }
  setParentValidationDisplayOverride(value: FormFieldValidationDisplay | undefined, options: { markNeedsLayout?: boolean } = {}): void {
    if (this._parentValidationDisplayOverride === value) return
    this._parentValidationDisplayOverride = value
    this._syncValidationBadge()
    this._syncChildValidationState()
    if (options.markNeedsLayout ?? true) this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get labelGap(): number | undefined { return this._labelGap }
  set labelGap(value: number | undefined) {
    if (this._labelGap === value) return
    this._labelGap = value
    this.markNeedsLayout()
  }

  get labelOverflow(): FormFieldLabelOverflow { return this._labelOverflow }
  set labelOverflow(value: FormFieldLabelOverflow) {
    if (this._labelOverflow === value) return
    this._labelOverflow = value
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get labelPlacement(): FormFieldLabelPlacement { return this._labelPlacement }
  set labelPlacement(value: FormFieldLabelPlacement) {
    if (this._labelPlacement === value) return
    this._labelPlacement = value
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get resolvedLabelPlacement(): FormFieldLabelPlacement { return this._resolvedLabelPlacement }
  get labelOverflowed(): boolean { return this._labelOverflowed }

  get required(): boolean { return this._required }
  set required(value: boolean) {
    if (this._required === value) return
    this._required = value
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get status(): FormFieldStatus { return this._status }
  set status(value: FormFieldStatus) {
    if (this._status === value) return
    this._status = value
    this._syncValidationBadge()
    this._syncChildValidationState()
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get message(): string { return this._message }
  set message(value: string) {
    if (this._message === value) return
    this._message = value
    this._syncValidationBadge()
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get validationDisplay(): FormFieldValidationDisplay { return this._validationDisplay }
  set validationDisplay(value: FormFieldValidationDisplay) {
    if (this._validationDisplay === value) return
    this._validationDisplay = value
    this._syncValidationBadge()
    this._syncChildValidationState()
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get validationBadge(): RenderValidationBadge | undefined { return this._validationBadge }
  get metaText(): string { return this._metaText }
  set metaText(value: string) {
    if (this._metaText === value) return
    this._metaText = value
    this.markNeedsLayout()
    this.markNeedsPaint()
  }
  get metaTone(): FormFieldMetaTone { return this._metaTone }
  set metaTone(value: FormFieldMetaTone) {
    if (this._metaTone === value) return
    this._metaTone = value
    this.markNeedsPaint()
  }
  get unit(): string { return this._unit }
  set unit(value: string) {
    if (this._unit === value) return
    this._unit = value
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  setChild(child?: RenderBox): void {
    if (this.child === child) return
    if (this.child) {
      this.child.parent = undefined
      if (this.child.owner) this.child.detach()
    }
    this.child = child
    if (child) {
      child.parent = this
      if (this.owner && child.owner !== this.owner) child.attach(this.owner)
    }
    this._syncValidationBadge()
    this._syncChildValidationState()
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this.child) visitor(this.child)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this.child) visitor(this.child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    this._syncValidationBadge()
    const style = deriveLabeledFieldStyle(context.theme)
    const labelWidth = this._parentLabelWidthOverride ?? this._labelWidth ?? style.labelWidth
    const gap = this._labelGap ?? style.labelGap
    const naturalLabelWidth = TextMeasurer.measureWidth(this.label, style.labelFontSize, context.theme.fontFamily)
    const requiredWidth = this._required
      ? TextMeasurer.measureWidth(' *', style.labelFontSize, context.theme.fontFamily)
      : 0
    const labelOverflow = this._parentLabelOverflowOverride ?? this._labelOverflow
    const labelPlacement = this._parentLabelPlacementOverride ?? this._labelPlacement
    const inlineLabelWidth = labelOverflow === 'expand'
      ? Math.max(labelWidth, naturalLabelWidth + requiredWidth)
      : labelWidth
    const unitWidth = this._unit
      ? TextMeasurer.measureWidth(this._unit, style.unitFontSize, context.theme.fontFamily)
      : 0
    const unitTotalWidth = this._unit ? style.unitGap + unitWidth : 0
    const metaWidth = this._metaText
      ? TextMeasurer.measureWidth(this._metaText, style.metaFontSize, context.theme.fontFamily)
      : 0
    const metaTotalWidth = this._metaText ? style.metaGap + metaWidth : 0

    const editorRowTop = labelPlacement === 'top' ? style.labelLineHeight + gap : 0
    const validationDisplay = this._resolvedValidationDisplay()
    const showInlineMessage = validationDisplay === 'inline' && !!this._message
    const messageHeight = showInlineMessage ? style.messageGap + style.messageLineHeight : 0
    const childMaxHeight = constraints.maxHeight === Infinity
      ? Infinity
      : Math.max(0, constraints.maxHeight - editorRowTop - messageHeight)
    const resolvedLabelWidth = labelPlacement === 'top'
      ? constraints.maxWidth === Infinity
        ? Math.max(constraints.minWidth, naturalLabelWidth + requiredWidth)
        : constraints.maxWidth
      : inlineLabelWidth
    let childWidth = 0
    let childHeight = 0
    if (this.child) {
      const maxWidth = constraints.maxWidth === Infinity
        ? Infinity
        : Math.max(0, constraints.maxWidth -
          (labelPlacement === 'inline' ? resolvedLabelWidth + gap : 0) -
          unitTotalWidth - metaTotalWidth)
      this.child.layout({
        minWidth: 0,
        maxWidth,
        minHeight: 0,
        maxHeight: childMaxHeight,
      }, true, context)
      childWidth = this.child.outerSize.width
      childHeight = this.child.outerSize.height
    }

    const rowHeight = Math.max(
      labelPlacement === 'inline' ? style.labelLineHeight : 0,
      childHeight,
      this._unit ? style.unitLineHeight : 0,
      this._metaText ? style.metaLineHeight : 0,
    )
    const labelTextWidth = Math.max(0, resolvedLabelWidth - requiredWidth)
    const fittedLabel = labelOverflow === 'ellipsis'
      ? fitSingleLineText(
          this.label,
          labelTextWidth,
          style.labelFontSize,
          context.theme.fontFamily,
        ).text
      : this.label
    this._resolvedLabelWidth = resolvedLabelWidth
    this._resolvedLabelPlacement = labelPlacement
    this._paintLabelText = fittedLabel
    this._paintLabelWidth = TextMeasurer.measureWidth(
      fittedLabel,
      style.labelFontSize,
      context.theme.fontFamily,
    )
    this._labelOverflowed = naturalLabelWidth > labelTextWidth
    this._labelRowHeight = labelPlacement === 'top' ? style.labelLineHeight : rowHeight
    this._editorRowTop = editorRowTop
    this._rowHeight = rowHeight
    this._childOuterRight = (labelPlacement === 'inline' ? resolvedLabelWidth + gap : 0) + childWidth
    if (!this._labelOverflowed || labelOverflow !== 'ellipsis') this.tooltip = undefined
    if (this.child) {
      this.child.positionInSlot({
        x: labelPlacement === 'inline' ? resolvedLabelWidth + gap : 0,
        y: editorRowTop,
        width: childWidth,
        height: rowHeight,
      }, this.child.resolveHorizontalAlignment('start'), this.child.resolveVerticalAlignment('center'))
    }
    this._layoutValidationBadge(context)

    this.size = constrainSize(constraints, {
      width: Math.max(
        resolvedLabelWidth,
        (labelPlacement === 'inline' ? resolvedLabelWidth + (this.child ? gap : 0) : 0) +
          childWidth + unitTotalWidth + metaTotalWidth,
      ),
      height: editorRowTop + rowHeight + messageHeight,
    })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveLabeledFieldStyle(context.theme)
    const dl = new DrawList(context)
    const labelWidth = this._resolvedLabelWidth || this.size.width
    const rowHeight = this._rowHeight || style.labelLineHeight
    const labelRowHeight = this._labelRowHeight || style.labelLineHeight
    const requiredWidth = this._required
      ? TextMeasurer.measureWidth('*', style.labelFontSize, context.theme.fontFamily)
      : 0
    const labelTextWidth = Math.max(0, labelWidth - requiredWidth)
    if (labelTextWidth > 0) {
      dl.pushClip(offset.x, offset.y, labelTextWidth, rowHeight)
      dl.fillText(
        this._paintLabelText,
        offset.x + (this._resolvedLabelPlacement === 'top' ? 0 : labelTextWidth),
        offset.y + labelRowHeight / 2,
        style.labelColor,
        style.labelFontSize,
        context.theme.fontFamily,
        this._resolvedLabelPlacement === 'top' ? 'left' : 'right',
        'middle',
      )
      dl.popClip()
    }
    if (this._required) {
      dl.fillText(
        '*',
        offset.x + (this._resolvedLabelPlacement === 'top'
          ? Math.min(this._paintLabelWidth, labelTextWidth)
          : labelTextWidth),
        offset.y + labelRowHeight / 2,
        style.labelRequiredColor,
        style.labelFontSize,
        context.theme.fontFamily,
        'left',
        'middle',
      )
    }
    if (this._unit && this.child) {
      dl.fillText(
        this._unit,
        offset.x + this._childOuterRight + style.unitGap,
        offset.y + this._editorRowTop + rowHeight / 2,
        style.unitColor,
        style.unitFontSize,
        context.theme.fontFamily,
        'left',
        'middle',
      )
    }
    if (this._metaText && this.child) {
      const unitWidth = this._unit
        ? TextMeasurer.measureWidth(this._unit, style.unitFontSize, context.theme.fontFamily)
        : 0
      const unitOffset = this._unit ? style.unitGap + unitWidth : 0
      dl.fillText(
        this._metaText,
        offset.x + this._childOuterRight + unitOffset + style.metaGap,
        offset.y + this._editorRowTop + rowHeight / 2,
        style.metaColors[this._metaTone],
        style.metaFontSize,
        context.theme.fontFamily,
        'left',
        'middle',
      )
    }
    if (this._resolvedValidationDisplay() === 'inline' && this._message) {
      dl.fillText(
        this._message,
        offset.x + (this.child?.offset.x ?? 0),
        offset.y + this._editorRowTop + rowHeight + style.messageGap + style.messageLineHeight / 2,
        style.statusColors[this._status],
        style.messageFontSize,
        context.theme.fontFamily,
        'left',
        'middle',
      )
    }
    super.performPaint(context, offset)
  }

  private _syncChildValidationState(): void {
    const target = this.child as { status?: FormFieldStatus } | undefined
    if (!target || !('status' in target)) return
    target.status = this._resolvedValidationDisplay() === 'none' ? 'default' : this._status
  }

  private _showsCompactIndicator(): boolean {
    return this.visible &&
      this._resolvedValidationDisplay() === 'compact' &&
      !!this.child &&
      !!this._message &&
      (this._status === 'error' || this._status === 'warning')
  }

  private _syncValidationBadge(): void {
    const nextVisible = this._showsCompactIndicator()
    if (!nextVisible) {
      this._detachValidationBadge()
      return
    }
    const status = this._status as Extract<FormFieldStatus, 'error' | 'warning'>
    if (!this._validationBadge) {
      this._validationBadge = new RenderValidationBadge({
        status,
        message: this._message,
      })
      this._validationBadge.setOffsetResolver(() => this._resolveValidationBadgeOffset())
    }
    this._validationBadge.status = status
    this._validationBadge.message = this._message

    const nextHost = this._resolveValidationBadgeHost()
    if (this._validationBadgeHost !== nextHost) {
      this._validationBadgeHost?.removeAdorner(this._validationBadge)
      this._validationBadgeHost = nextHost
      this._validationBadgeHost.addAdorner(this._validationBadge)
      this._updateValidationBadgeOffset()
    }
  }

  override dispose(): void {
    this.releaseExternalAdorners()
    super.dispose()
  }

  /** @internal Used by owning layout containers before structural release. */
  releaseExternalAdorners(): void {
    this._detachValidationBadge()
  }

  protected override onVisibilityChanged(visible: boolean): void {
    if (!visible) this.releaseExternalAdorners()
  }

  private _resolveValidationBadgeHost(): RenderBox {
    let current = this.parent
    while (current) {
      if (current instanceof RenderBox && current.canHostAdorners()) return current
      current = current.parent
    }
    return this
  }

  private _layoutValidationBadge(context: LayoutContext): void {
    if (!this._validationBadge) return
    this._validationBadge.layout({
      minWidth: 0,
      maxWidth: deriveLabeledFieldStyle(context.theme).indicatorSize,
      minHeight: 0,
      maxHeight: deriveLabeledFieldStyle(context.theme).indicatorSize,
    }, true, context)
    this._updateValidationBadgeOffset()
  }

  private _resolveValidationBadgeOffset(): Offset | null {
    if (!this._validationBadge || !this._validationBadgeHost || !this.child) return null
    const style = deriveLabeledFieldStyle(this.currentTheme)
    const anchorOffset = this.offsetToAncestor(this._validationBadgeHost)
    if (!anchorOffset) return null
    return {
      x: anchorOffset.x + this.child.offset.x + this.child.size.width - Math.round(style.indicatorSize * 0.35),
      y: anchorOffset.y + this.child.offset.y - Math.round(style.indicatorSize * 0.3),
    }
  }

  private _updateValidationBadgeOffset(): void {
    this._validationBadge?.syncToHostPosition()
  }

  private _detachValidationBadge(): void {
    if (!this._validationBadge) return
    const badge = this._validationBadge
    this._validationBadgeHost?.removeAdorner(badge)
    this._validationBadgeHost = undefined
    this._validationBadge = undefined
  }

  onPointerMove(event: import('../gestures/hit_test').PointerEvent): void {
    const labelOverflow = this._parentLabelOverflowOverride ?? this._labelOverflow
    const globalOffset = this.globalOffset
    const localPosition = event.localPosition ?? {
      x: event.position.x - globalOffset.x,
      y: event.position.y - globalOffset.y,
    }
    const overLabel = localPosition.x >= 0 &&
      localPosition.x <= this._resolvedLabelWidth &&
      localPosition.y >= 0 &&
      localPosition.y <= this._labelRowHeight
    this.tooltip = labelOverflow === 'ellipsis' && this._labelOverflowed && overLabel
      ? this.label
      : undefined
  }

  onPointerLeave(): void {
    this.tooltip = undefined
  }

  private _resolvedValidationDisplay(): FormFieldValidationDisplay {
    return this._parentValidationDisplayOverride ?? this._validationDisplay
  }
}
