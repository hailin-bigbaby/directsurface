import { TextMeasurer } from '../core/text_measurer'
import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { RenderBox, resolveChildLayout, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { deriveSectionStyle } from '../theme/component_styles'

export interface RenderSectionOptions extends RenderBoxOptions {
  title: string
  description?: string
  child?: RenderBox
  actions?: RenderBox
}

export class RenderSection extends RenderBox {
  static override debugTypeName = 'RenderSection'
  title: string
  description: string
  child?: RenderBox
  actions?: RenderBox

  private _headerHeight = 0
  private _headerTextWidth = 0
  private _descriptionWidth = 0
  private _headerTextClipWidth = 0

  constructor(options: RenderSectionOptions) {
    super(options)
    this.title = options.title
    this.description = options.description ?? ''
    this.child = options.child
    this.actions = options.actions
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
    const style = deriveSectionStyle(context.theme)
    const maxWidth = constraints.maxWidth === Infinity ? 400 : constraints.maxWidth
    this._headerTextWidth = TextMeasurer.measureWidth(
      this.title,
      style.titleFontSize,
      context.theme.fontFamily,
      style.titleFontWeight,
    )
    this._descriptionWidth = this.description
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
    const textNaturalWidth = Math.max(this._headerTextWidth, this._descriptionWidth)
    const actionTextLaneMin = Math.min(textNaturalWidth, Math.max(48, Math.min(160, maxWidth * 0.4)))
    const stackActions = actionsWidth > 0 && maxWidth - actionsWidth - headerGap < actionTextLaneMin

    this._headerHeight = stackActions
      ? headerTextHeight + style.headerGap + actionsHeight
      : Math.max(headerTextHeight, actionsHeight)
    const childParticipates = this.child?.participatesInLayout ?? false
    const contentY = this._headerHeight + (childParticipates ? style.contentGap : 0)
    let childHeight = 0
    let childWidth = 0
    if (childParticipates && this.child) {
      const availableHeight = Math.max(0, constraints.maxHeight - contentY)
      const childLayout = resolveChildLayout(this.child, {
        minWidth: maxWidth,
        maxWidth,
        minHeight: Number.isFinite(availableHeight) ? availableHeight : 0,
        maxHeight: availableHeight,
      }, 'start', 'start')
      this.child.layout(childLayout.constraints, true, context)
      childHeight = this.child.outerSize.height
      childWidth = this.child.outerSize.width
    }

    const naturalWidth = Math.max(this._headerTextWidth, this._descriptionWidth, childWidth, actionsWidth)
    const width = constraints.maxWidth === Infinity ? naturalWidth : maxWidth
    const height = this._headerHeight + (childParticipates ? style.contentGap + childHeight : 0)
    this.size = constrainSize(constraints, { width, height })

    if (childParticipates && this.child) {
      this.child.positionInSlot(
        { x: 0, y: contentY, width: this.size.width, height: childHeight },
        this.child.resolveHorizontalAlignment('start'),
        this.child.resolveVerticalAlignment('start'),
      )
    }
    if (actionsParticipates && this.actions) {
      const actionSlot = stackActions
        ? { x: 0, y: headerTextHeight + style.headerGap, width: actionsWidth, height: actionsHeight }
        : { x: Math.max(0, this.size.width - actionsWidth), y: 0, width: actionsWidth, height: this._headerHeight }
      this.actions.positionInSlot(
        actionSlot,
        this.actions.resolveHorizontalAlignment('start'),
        this.actions.resolveVerticalAlignment(stackActions ? 'start' : 'center'),
      )
    }
    this._headerTextClipWidth = stackActions || actionsWidth === 0
      ? this.size.width
      : Math.max(0, (this.actions?.offset.x ?? this.size.width) - headerGap)
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveSectionStyle(context.theme)
    const dl = new DrawList(context)
    const textClipWidth = Math.max(0, Math.min(this.size.width, this._headerTextClipWidth))
    dl.pushClip(offset.x, offset.y, textClipWidth, this._headerHeight)
    const titleY = offset.y + style.titleLineHeight / 2
    dl.fillText(
      this.title,
      offset.x,
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
        offset.x,
        offset.y + style.titleLineHeight + style.headerGap + style.descriptionLineHeight / 2,
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
}
