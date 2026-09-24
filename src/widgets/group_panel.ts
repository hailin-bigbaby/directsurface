import { TextMeasurer } from '../core/text_measurer'
import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { RenderBox, resolveChildLayout, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { deriveGroupPanelStyle } from '../theme/component_styles'

export interface RenderGroupBoxOptions extends RenderBoxOptions {
  title: string
  headerInfo?: string
  child?: RenderBox
  headerLeading?: RenderBox
  headerActions?: RenderBox
}

export class RenderGroupBox extends RenderBox {
  static override debugTypeName = 'RenderGroupBox'
  title: string
  headerInfo: string
  child?: RenderBox
  headerLeading?: RenderBox
  headerActions?: RenderBox

  private _headerLeadingWidth = 0
  private _headerLeadingHeight = 0
  private _titleWidth = 0
  private _headerInfoWidth = 0
  private _headerHeight = 0
  private _titleOffset: Offset = { x: 0, y: 0 }
  private _titleClipWidth = 0
  private _headerInfoOffset: Offset = { x: 0, y: 0 }
  private _headerInfoClipWidth = 0

  constructor(options: RenderGroupBoxOptions) {
    super(options)
    this.title = options.title
    this.headerInfo = options.headerInfo ?? ''
    this.child = options.child
    this.headerLeading = options.headerLeading
    this.headerActions = options.headerActions
    if (this.child) this.child.parent = this
    if (this.headerLeading) this.headerLeading.parent = this
    if (this.headerActions) this.headerActions.parent = this
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

  setHeaderActions(headerActions?: RenderBox): void {
    if (this.headerActions === headerActions) return
    if (this.headerActions) {
      this.headerActions.parent = undefined
      if (this.headerActions.owner) this.headerActions.detach()
    }
    this.headerActions = headerActions
    if (headerActions) {
      headerActions.parent = this
      if (this.owner && headerActions.owner !== this.owner) headerActions.attach(this.owner)
    }
    this.markNeedsLayout()
  }

  setHeaderLeading(headerLeading?: RenderBox): void {
    if (this.headerLeading === headerLeading) return
    if (this.headerLeading) {
      this.headerLeading.parent = undefined
      if (this.headerLeading.owner) this.headerLeading.detach()
    }
    this.headerLeading = headerLeading
    if (headerLeading) {
      headerLeading.parent = this
      if (this.owner && headerLeading.owner !== this.owner) headerLeading.attach(this.owner)
    }
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this.headerLeading) visitor(this.headerLeading)
      if (this.headerActions) visitor(this.headerActions)
      if (this.child) visitor(this.child)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this.headerLeading) visitor(this.headerLeading)
    if (this.headerActions) visitor(this.headerActions)
    if (this.child) visitor(this.child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveGroupPanelStyle(context.theme)
    const maxWidth = constraints.maxWidth === Infinity ? 400 : constraints.maxWidth
    const innerWidth = Math.max(0, maxWidth - style.contentPadding * 2)
    const headerInnerWidth = Math.max(0, maxWidth - style.headerPaddingX * 2)
    const headerGap = Math.max(6, context.theme.itemSpacing)

    this._titleWidth = TextMeasurer.measureWidth(
      this.title,
      style.titleFontSize,
      context.theme.fontFamily,
      style.titleFontWeight,
    )
    this._headerInfoWidth = this.headerInfo
      ? TextMeasurer.measureWidth(
          this.headerInfo,
          style.infoFontSize,
          context.theme.fontFamily,
          style.infoFontWeight,
        )
      : 0

    this._headerLeadingWidth = 0
    this._headerLeadingHeight = 0
    if (this.headerLeading) {
      this.headerLeading.layout({
        minWidth: 0,
        maxWidth: headerInnerWidth,
        minHeight: 0,
        maxHeight: style.headerHeight,
      }, true, context)
      this._headerLeadingWidth = this.headerLeading.outerSize.width
      this._headerLeadingHeight = this.headerLeading.outerSize.height
    }

    let actionsWidth = 0
    let actionsHeight = 0
    if (this.headerActions) {
      this.headerActions.layout({
        minWidth: 0,
        maxWidth: headerInnerWidth,
        minHeight: 0,
        maxHeight: style.headerHeight,
      }, true, context)
      actionsWidth = this.headerActions.outerSize.width
      actionsHeight = this.headerActions.outerSize.height
    }

    const leftHeaderWidth = this._headerLeadingWidth +
      (this._headerLeadingWidth > 0 && this._titleWidth > 0 ? headerGap : 0) +
      this._titleWidth
    const rightHeaderWidth = (this._headerInfoWidth > 0 ? this._headerInfoWidth : 0) +
      (this._headerInfoWidth > 0 && actionsWidth > 0 ? headerGap : 0) +
      actionsWidth
    const titleLaneMin = Math.min(leftHeaderWidth, Math.max(48, Math.min(160, headerInnerWidth * 0.4)))
    const stackRightHeader = rightHeaderWidth > 0 && headerInnerWidth - rightHeaderWidth - headerGap < titleLaneMin
    const rightRowHeight = Math.max(
      this._headerInfoWidth > 0 ? style.infoFontSize * 1.35 : 0,
      actionsHeight,
    )
    this._headerHeight = stackRightHeader
      ? style.headerHeight + headerGap + rightRowHeight
      : style.headerHeight
    const leftHeaderLaneWidth = stackRightHeader || rightHeaderWidth === 0
      ? headerInnerWidth
      : Math.max(0, headerInnerWidth - rightHeaderWidth - headerGap)
    this._titleOffset = {
      x: style.headerPaddingX + this._headerLeadingWidth + (this._headerLeadingWidth > 0 && this._titleWidth > 0 ? headerGap : 0),
      y: Math.min(style.headerHeight, this._headerHeight) / 2,
    }
    this._titleClipWidth = Math.max(0, leftHeaderLaneWidth - this._titleOffset.x + style.headerPaddingX)

    let childWidth = 0
    let childHeight = 0
    const childParticipates = this.child?.participatesInLayout ?? false
    if (childParticipates && this.child) {
      const availableHeight = Math.max(0, constraints.maxHeight - this._headerHeight - style.contentPadding * 2)
      const childLayout = resolveChildLayout(this.child, {
        minWidth: innerWidth,
        maxWidth: innerWidth,
        minHeight: Number.isFinite(availableHeight) ? availableHeight : 0,
        maxHeight: availableHeight,
      }, 'start', 'start')
      this.child.layout(childLayout.constraints, true, context)
      childWidth = this.child.outerSize.width
      childHeight = this.child.outerSize.height
    }

    const headerWidth = leftHeaderWidth + (rightHeaderWidth > 0 ? headerGap + rightHeaderWidth : 0) + style.headerPaddingX * 2
    const contentWidth = childWidth + (childParticipates ? style.contentPadding * 2 : 0)
    const width = Math.max(headerWidth, contentWidth)
    const height = this._headerHeight + (childParticipates ? childHeight + style.contentPadding * 2 : 0)
    this.size = constrainSize(constraints, { width, height })

    if (childParticipates && this.child) {
      this.child.positionInSlot({
        x: style.contentPadding,
        y: this._headerHeight + style.contentPadding,
        width: Math.max(0, this.size.width - style.contentPadding * 2),
        height: childHeight,
      }, this.child.resolveHorizontalAlignment('start'), this.child.resolveVerticalAlignment('start'))
    }
    if (this.headerLeading) {
      this.headerLeading.positionInSlot({
        x: style.headerPaddingX,
        y: 0,
        width: this._headerLeadingWidth,
        height: style.headerHeight,
      }, this.headerLeading.resolveHorizontalAlignment('start'), this.headerLeading.resolveVerticalAlignment('center'))
    }
    if (this.headerActions) {
      const actionSlot = stackRightHeader
        ? {
            x: Math.max(style.headerPaddingX, this.size.width - style.headerPaddingX - actionsWidth),
            y: style.headerHeight + headerGap,
            width: actionsWidth,
            height: rightRowHeight,
          }
        : {
            x: Math.max(style.headerPaddingX, this.size.width - style.headerPaddingX - actionsWidth),
            y: 0,
            width: actionsWidth,
            height: style.headerHeight,
          }
      this.headerActions.positionInSlot(
        actionSlot,
        this.headerActions.resolveHorizontalAlignment('start'),
        this.headerActions.resolveVerticalAlignment('center'),
      )
    }
    const infoY = stackRightHeader
      ? style.headerHeight + headerGap + rightRowHeight / 2
      : style.headerHeight / 2
    const infoX = stackRightHeader
      ? style.headerPaddingX
      : this.size.width - style.headerPaddingX - actionsWidth -
        (actionsWidth > 0 ? headerGap : 0) - this._headerInfoWidth
    const actionX = this.headerActions
      ? Math.max(style.headerPaddingX, this.size.width - style.headerPaddingX - actionsWidth)
      : this.size.width - style.headerPaddingX
    this._headerInfoOffset = { x: Math.max(style.headerPaddingX, infoX), y: infoY }
    this._headerInfoClipWidth = this.headerInfo
      ? Math.max(0, (actionsWidth > 0 ? actionX - headerGap : this.size.width - style.headerPaddingX) - this._headerInfoOffset.x)
      : 0
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveGroupPanelStyle(context.theme)
    const dl = new DrawList(context)
    dl.fillRect(offset.x, offset.y, this.size.width, this.size.height, style.backgroundColor, style.borderRadius)
    dl.pushRoundedClip(offset.x, offset.y, this.size.width, this.size.height, style.borderRadius)
    dl.fillRectGradient(
      offset.x,
      offset.y,
      this.size.width,
      Math.min(this._headerHeight, this.size.height),
      style.headerBgTop,
      style.headerBgBottom,
      0,
    )
    dl.popClip()
    dl.line(
      offset.x,
      offset.y + this._headerHeight,
      offset.x + this.size.width,
      offset.y + this._headerHeight,
      style.headerBorderColor,
      style.borderWidth,
    )
    if (style.borderWidth > 0) {
      dl.strokeRect(offset.x, offset.y, this.size.width, this.size.height, style.borderColor, style.borderWidth, style.borderRadius)
    }

    const textY = offset.y + Math.min(style.headerHeight, this.size.height) / 2
    if (this.title) {
      dl.pushClip(offset.x + this._titleOffset.x, offset.y, Math.max(0, this._titleClipWidth), Math.min(style.headerHeight, this.size.height))
      dl.fillText(
        this.title,
        offset.x + this._titleOffset.x,
        textY,
        style.titleColor,
        style.titleFontSize,
        context.theme.fontFamily,
        'left',
        'middle',
        style.titleFontWeight,
      )
      dl.popClip()
    }
    if (this.headerInfo) {
      dl.pushClip(
        offset.x + this._headerInfoOffset.x,
        offset.y + this._headerInfoOffset.y - style.headerHeight / 2,
        this._headerInfoClipWidth,
        style.headerHeight,
      )
      dl.fillText(
        this.headerInfo,
        offset.x + this._headerInfoOffset.x,
        offset.y + this._headerInfoOffset.y,
        style.infoColor,
        style.infoFontSize,
        context.theme.fontFamily,
        'left',
        'middle',
        style.infoFontWeight,
      )
      dl.popClip()
    }
    super.performPaint(context, offset)
  }

  debugState(): {
    titleWidth: number
    headerLeadingOffset?: Offset
    headerInfoWidth: number
    headerHeight: number
    headerActionsOffset?: Offset
    childOffset?: Offset
  } {
    return {
      titleWidth: this._titleWidth,
      headerLeadingOffset: this.headerLeading?.offset,
      headerInfoWidth: this._headerInfoWidth,
      headerHeight: this._headerHeight,
      headerActionsOffset: this.headerActions?.offset,
      childOffset: this.child?.offset,
    }
  }
}
