import { TextMeasurer } from '../core/text_measurer'
import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { RenderBox, resolveChildLayout, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { deriveCardStyle, type CardStyleTokens, type CardVariant } from '../theme/component_styles'

export type RenderCardStyleOverrides = Partial<Pick<
  CardStyleTokens,
  | 'backgroundColor'
  | 'borderColor'
  | 'borderWidth'
  | 'borderRadius'
  | 'padding'
  | 'shadowColor'
  | 'shadowBlur'
  | 'shadowOffsetX'
  | 'shadowOffsetY'
  | 'highlightColor'
  | 'highlightWidth'
>>

export interface RenderCardOptions extends RenderBoxOptions {
  title: string
  description?: string
  child?: RenderBox
  actions?: RenderBox
  variant?: CardVariant
  style?: RenderCardStyleOverrides
}

export class RenderCard extends RenderBox {
  static override debugTypeName = 'RenderCard'
  title: string
  description: string
  child?: RenderBox
  actions?: RenderBox
  variant: CardVariant
  styleOverrides: RenderCardStyleOverrides

  private _headerHeight = 0
  private _headerTextClipWidth = 0

  constructor(options: RenderCardOptions) {
    super(options)
    this.title = options.title
    this.description = options.description ?? ''
    this.child = options.child
    this.actions = options.actions
    this.variant = options.variant ?? 'default'
    this.styleOverrides = options.style ?? {}
    if (this.child) this.child.parent = this
    if (this.actions) this.actions.parent = this
  }

  protected override get supportsAdorners(): boolean {
    return true
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
    this.markNeedsLayout()
  }

  setActions(actions?: RenderBox): void {
    if (this.actions === actions) return
    if (this.actions) {
      this.actions.parent = undefined
      if (this.actions.owner) this.actions.detach()
    }
    this.actions = actions
    if (actions) {
      actions.parent = this
      if (this.owner && actions.owner !== this.owner) actions.attach(this.owner)
    }
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this.actions) visitor(this.actions)
      if (this.child) visitor(this.child)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this.actions) visitor(this.actions)
    if (this.child) visitor(this.child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = this._resolveStyle(context)
    const maxWidth = Math.max(0, (constraints.maxWidth === Infinity ? 400 : constraints.maxWidth) - style.padding * 2)
    const titleWidth = TextMeasurer.measureWidth(
      this.title,
      style.titleFontSize,
      context.theme.fontFamily,
      style.titleFontWeight,
    )
    const descriptionWidth = this.description
      ? TextMeasurer.measureWidth(
          this.description,
          style.descriptionFontSize,
          context.theme.fontFamily,
          style.descriptionFontWeight,
        )
      : 0

    let headerTextHeight = style.titleLineHeight
    if (this.description) {
      headerTextHeight += style.headerGap + style.descriptionLineHeight
    }

    let actionsWidth = 0
    let actionsHeight = 0
    const actionsParticipates = this.actions?.participatesInLayout ?? false
    if (actionsParticipates && this.actions) {
      this.actions.layout({ minWidth: 0, maxWidth, minHeight: 0, maxHeight: constraints.maxHeight }, true, context)
      actionsWidth = this.actions.outerSize.width
      actionsHeight = this.actions.outerSize.height
    }

    const headerGap = style.contentGap
    const textNaturalWidth = Math.max(titleWidth, descriptionWidth)
    const actionTextLaneMin = Math.min(textNaturalWidth, Math.max(48, Math.min(160, maxWidth * 0.4)))
    const stackActions = actionsWidth > 0 && maxWidth - actionsWidth - headerGap < actionTextLaneMin

    this._headerHeight = stackActions
      ? headerTextHeight + style.headerGap + actionsHeight
      : Math.max(headerTextHeight, actionsHeight)
    const childParticipates = this.child?.participatesInLayout ?? false
    const contentY = style.padding + this._headerHeight + (childParticipates ? style.contentGap : 0)
    let childWidth = 0
    let childHeight = 0
    if (childParticipates && this.child) {
      const availableHeight = Math.max(0, constraints.maxHeight - contentY - style.padding)
      const childLayout = resolveChildLayout(this.child, {
        minWidth: maxWidth,
        maxWidth,
        minHeight: Number.isFinite(availableHeight) ? availableHeight : 0,
        maxHeight: availableHeight,
      }, 'start', 'start')
      this.child.layout(childLayout.constraints, true, context)
      childWidth = this.child.outerSize.width
      childHeight = this.child.outerSize.height
    }

    const width = Math.max(titleWidth, descriptionWidth, childWidth, actionsWidth) + style.padding * 2
    const height = style.padding * 2 + this._headerHeight + (childParticipates ? style.contentGap + childHeight : 0)
    this.size = constrainSize(constraints, { width, height })

    const actualMaxWidth = Math.max(0, this.size.width - style.padding * 2)
    if (childParticipates && this.child) {
      this.child.positionInSlot({
        x: style.padding,
        y: contentY,
        width: actualMaxWidth,
        height: childHeight,
      }, this.child.resolveHorizontalAlignment('start'), 'start')
    }
    if (actionsParticipates && this.actions) {
      const actionSlot = stackActions
        ? {
            x: style.padding,
            y: style.padding + headerTextHeight + style.headerGap,
            width: actionsWidth,
            height: actionsHeight,
          }
        : {
            x: style.padding + Math.max(0, actualMaxWidth - actionsWidth),
            y: style.padding,
            width: actionsWidth,
            height: this._headerHeight,
          }
      this.actions.positionInSlot(
        actionSlot,
        this.actions.resolveHorizontalAlignment('start'),
        this.actions.resolveVerticalAlignment(stackActions ? 'start' : 'center'),
      )
    }
    this._headerTextClipWidth = stackActions || actionsWidth === 0
      ? actualMaxWidth
      : Math.max(0, (this.actions ? this.actions.offset.x - style.padding : actualMaxWidth) - headerGap)
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = this._resolveStyle(context)
    const dl = new DrawList(context)
    if (style.shadowBlur > 0 && style.shadowColor.a > 0) {
      dl.outerShadow(
        offset.x,
        offset.y,
        this.size.width,
        this.size.height,
        style.shadowBlur,
        style.shadowColor,
        style.borderRadius,
        style.shadowOffsetX,
        style.shadowOffsetY,
      )
    }
    dl.fillRect(offset.x, offset.y, this.size.width, this.size.height, style.backgroundColor, style.borderRadius)
    if (style.highlightWidth > 0 && style.highlightColor.a > 0) {
      dl.strokeRect(
        offset.x,
        offset.y,
        this.size.width,
        this.size.height,
        style.highlightColor,
        style.highlightWidth,
        style.borderRadius,
      )
    }
    if (style.borderWidth > 0) {
      dl.strokeRect(offset.x, offset.y, this.size.width, this.size.height, style.borderColor, style.borderWidth, style.borderRadius)
    }
    const textClipWidth = Math.max(0, Math.min(this.size.width - style.padding * 2, this._headerTextClipWidth))
    dl.pushClip(offset.x + style.padding, offset.y + style.padding, textClipWidth, this._headerHeight)
    const titleY = offset.y + style.padding + style.titleLineHeight / 2
    dl.fillText(
      this.title,
      offset.x + style.padding,
      titleY,
      style.titleColor,
      style.titleFontSize,
      context.theme.fontFamily,
      'left',
      'middle',
      style.titleFontWeight,
    )
    if (this.description) {
      dl.fillText(
        this.description,
        offset.x + style.padding,
        offset.y + style.padding + style.titleLineHeight + style.headerGap + style.descriptionLineHeight / 2,
        style.descriptionColor,
        style.descriptionFontSize,
        context.theme.fontFamily,
        'left',
        'middle',
        style.descriptionFontWeight,
      )
    }
    dl.popClip()
    super.performPaint(context, offset)
  }

  private _resolveStyle(context: LayoutContext | PaintContext): CardStyleTokens {
    return {
      ...deriveCardStyle(context.theme, this.variant),
      ...this.styleOverrides,
    }
  }
}
