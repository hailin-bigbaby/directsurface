import { TextMeasurer } from '../core/text_measurer'
import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { deriveEmptyStyle } from '../theme/component_styles'
import { paintIconGlyph, type IconName } from './icon'

export class RenderEmpty extends RenderBox {
  static override debugTypeName = 'RenderEmpty'
  title: string
  description: string
  icon: IconName
  action?: RenderBox

  constructor(options?: {
    title?: string
    description?: string
    icon?: IconName
    action?: RenderBox
  }) {
    super()
    this.title = options?.title ?? '暂无内容'
    this.description = options?.description ?? ''
    this.icon = options?.icon ?? 'search'
    this.action = options?.action
    if (this.action) this.action.parent = this
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  setAction(action?: RenderBox): void {
    if (this.action === action) return
    if (this.action) {
      this.action.parent = undefined
      if (this.action.owner) this.action.detach()
    }
    this.action = action
    if (action) {
      action.parent = this
      if (this.owner && action.owner !== this.owner) action.attach(this.owner)
    }
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this.action) visitor(this.action)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this.action) visitor(this.action)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveEmptyStyle(context.theme)
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

    let contentWidth = Math.max(style.iconSize, titleWidth, descriptionWidth)
    let contentHeight = style.iconSize + style.itemGap + style.titleLineHeight
    if (this.description) {
      contentHeight += style.itemGap + style.descriptionLineHeight
    }

    if (this.action) {
      const actionMaxWidth = Math.max(0, (constraints.maxWidth === Infinity ? 320 : constraints.maxWidth) - style.padding * 2)
      this.action.layout({
        minWidth: 0,
        maxWidth: actionMaxWidth,
        minHeight: 0,
        maxHeight: constraints.maxHeight,
      }, true, context)
      contentWidth = Math.max(contentWidth, this.action.outerSize.width)
      contentHeight += style.itemGap + this.action.outerSize.height
    }

    const width = style.padding * 2 + contentWidth
    const height = style.padding * 2 + contentHeight
    this.size = constrainSize(constraints, { width, height })

    if (this.action) {
      this.action.positionInSlot({
        x: 0,
        y: this.size.height - style.padding - this.action.outerSize.height,
        width: this.size.width,
        height: this.action.outerSize.height,
      }, 'center', 'start')
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveEmptyStyle(context.theme)
    const dl = new DrawList(context)
    dl.fillRect(offset.x, offset.y, this.size.width, this.size.height, style.backgroundColor, style.borderRadius)
    if (style.borderWidth > 0) {
      dl.strokeRect(offset.x, offset.y, this.size.width, this.size.height, style.borderColor, style.borderWidth, style.borderRadius)
    }

    const centerX = offset.x + this.size.width / 2
    let cursorY = offset.y + style.padding
    paintIconGlyph(context, {
      name: this.icon,
      x: centerX - style.iconSize / 2,
      y: cursorY,
      size: style.iconSize,
      color: style.iconColor,
    })
    cursorY += style.iconSize + style.itemGap

    dl.fillText(
      this.title,
      centerX,
      cursorY + style.titleLineHeight / 2,
      style.titleColor,
      style.titleFontSize,
      context.theme.fontFamily,
      'center',
      'middle',
      style.titleFontWeight,
    )
    cursorY += style.titleLineHeight

    if (this.description) {
      cursorY += style.itemGap
      dl.fillText(
        this.description,
        centerX,
        cursorY + style.descriptionLineHeight / 2,
        style.descriptionColor,
        style.descriptionFontSize,
        context.theme.fontFamily,
        'center',
        'middle',
        style.descriptionFontWeight,
      )
    }

    super.performPaint(context, offset)
  }
}
