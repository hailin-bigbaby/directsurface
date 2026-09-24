import { TextMeasurer } from '../core/text_measurer'
import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { derivePageHeaderStyle } from '../theme/component_styles'
import { RenderBreadcrumb } from './breadcrumb'

function wrapHeaderText(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: string,
  fontWeight: number,
): string[] {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return [text]
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    let current = ''
    for (const char of paragraph) {
      const next = `${current}${char}`
      if (current && TextMeasurer.measureWidth(next, fontSize, fontFamily, fontWeight) > maxWidth) {
        lines.push(current)
        current = char === ' ' ? '' : char
      } else {
        current = next
      }
    }
    lines.push(current)
  }
  return lines
}

function appendEllipsis(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: string,
  fontWeight: number,
): string {
  const ellipsis = '…'
  const chars = Array.from(text)
  while (
    chars.length > 0 &&
    TextMeasurer.measureWidth(`${chars.join('')}${ellipsis}`, fontSize, fontFamily, fontWeight) > maxWidth
  ) {
    chars.pop()
  }
  return TextMeasurer.measureWidth(ellipsis, fontSize, fontFamily, fontWeight) <= maxWidth
    ? `${chars.join('')}${ellipsis}`
    : ''
}

function resolveDescriptionLines(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: string,
  fontWeight: number,
  maxLines: number,
): string[] {
  const lines = wrapHeaderText(text, maxWidth, fontSize, fontFamily, fontWeight)
  if (lines.length <= maxLines) return lines
  const visible = lines.slice(0, maxLines)
  visible[maxLines - 1] = appendEllipsis(
    visible[maxLines - 1] ?? '',
    maxWidth,
    fontSize,
    fontFamily,
    fontWeight,
  )
  return visible
}

function normalizeDescriptionMaxLines(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : 2
}

export class RenderPageHeader extends RenderBox {
  static override debugTypeName = 'RenderPageHeader'
  title: string
  description: string
  private _descriptionMaxLines: number
  breadcrumb?: RenderBreadcrumb
  actions?: RenderBox

  private _breadcrumbHeight = 0
  private _headerHeight = 0
  private _textClipWidth = 0
  private _descriptionLines: string[] = []

  constructor(options: {
    title: string
    description?: string
    descriptionMaxLines?: number
    breadcrumb?: RenderBreadcrumb
    actions?: RenderBox
  }) {
    super()
    this.title = options.title
    this.description = options.description ?? ''
    this._descriptionMaxLines = normalizeDescriptionMaxLines(options.descriptionMaxLines)
    this.breadcrumb = options.breadcrumb
    this.actions = options.actions
    if (this.breadcrumb) this.breadcrumb.parent = this
    if (this.actions) this.actions.parent = this
  }

  get descriptionMaxLines(): number { return this._descriptionMaxLines }
  set descriptionMaxLines(value: number) {
    const next = normalizeDescriptionMaxLines(value)
    if (this._descriptionMaxLines === next) return
    this._descriptionMaxLines = next
    this.markNeedsLayout()
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  setBreadcrumb(breadcrumb?: RenderBreadcrumb): void {
    if (this.breadcrumb === breadcrumb) return
    if (this.breadcrumb) {
      this.breadcrumb.parent = undefined
      if (this.breadcrumb.owner) this.breadcrumb.detach()
    }
    this.breadcrumb = breadcrumb
    if (breadcrumb) {
      breadcrumb.parent = this
      if (this.owner && breadcrumb.owner !== this.owner) breadcrumb.attach(this.owner)
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
      if (this.breadcrumb) visitor(this.breadcrumb)
      if (this.actions) visitor(this.actions)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this.breadcrumb) visitor(this.breadcrumb)
    if (this.actions) visitor(this.actions)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = derivePageHeaderStyle(context.theme)
    const maxWidth = constraints.maxWidth === Infinity ? 520 : constraints.maxWidth
    const innerMaxWidth = Math.max(0, maxWidth - style.padding * 2)

    let actionsWidth = 0
    let actionsHeight = 0
    if (this.actions) {
      this.actions.layout({ minWidth: 0, maxWidth: innerMaxWidth, minHeight: 0, maxHeight: constraints.maxHeight }, true, context)
      actionsWidth = this.actions.outerSize.width
      actionsHeight = this.actions.outerSize.height
    }

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
    const naturalTextWidth = Math.max(titleWidth, descriptionWidth)
    const textLaneMin = Math.min(naturalTextWidth, Math.max(64, Math.min(180, innerMaxWidth * 0.45)))
    const stackActions = actionsWidth > 0 && innerMaxWidth - actionsWidth - style.sectionGap < textLaneMin
    const textMaxWidth = stackActions || actionsWidth === 0
      ? innerMaxWidth
      : Math.max(0, innerMaxWidth - actionsWidth - style.sectionGap)
    this._descriptionLines = this.description
      ? resolveDescriptionLines(
          this.description,
          textMaxWidth,
          style.descriptionFontSize,
          context.theme.fontFamily,
          style.descriptionFontWeight,
          this._descriptionMaxLines,
        )
      : []
    if (this.breadcrumb) {
      this.breadcrumb.layout({ minWidth: 0, maxWidth: textMaxWidth, minHeight: 0, maxHeight: constraints.maxHeight }, true, context)
      this._breadcrumbHeight = this.breadcrumb.outerSize.height
    } else {
      this._breadcrumbHeight = 0
    }

    const leftWidth = Math.min(textMaxWidth, Math.max(titleWidth, descriptionWidth, this.breadcrumb?.outerSize.width ?? 0))
    let contentHeight = style.titleLineHeight
    if (this._descriptionLines.length > 0) {
      contentHeight += style.sectionGap + style.descriptionLineHeight * this._descriptionLines.length
    }
    if (this.breadcrumb) contentHeight += this._breadcrumbHeight + style.sectionGap
    this._headerHeight = stackActions
      ? contentHeight + style.sectionGap + actionsHeight
      : Math.max(contentHeight, actionsHeight)

    if (this.breadcrumb) {
      this.breadcrumb.positionInSlot(
        { x: style.padding, y: style.padding, width: textMaxWidth, height: this._breadcrumbHeight },
        this.breadcrumb.resolveHorizontalAlignment('start'),
        this.breadcrumb.resolveVerticalAlignment('start'),
      )
    }

    this.size = constrainSize(constraints, {
      width: (stackActions
        ? Math.max(leftWidth, actionsWidth)
        : Math.max(leftWidth + (actionsWidth > 0 ? style.sectionGap + actionsWidth : 0), leftWidth)) + style.padding * 2,
      height: this._headerHeight + style.padding * 2,
    })

    const actualInnerWidth = Math.max(0, this.size.width - style.padding * 2)
    if (this.actions) {
      const actionSlot = stackActions
        ? {
            x: style.padding + Math.max(0, actualInnerWidth - actionsWidth),
            y: style.padding + contentHeight + style.sectionGap,
            width: actionsWidth,
            height: actionsHeight,
          }
        : {
            x: style.padding + Math.max(0, actualInnerWidth - actionsWidth),
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
    this._textClipWidth = stackActions || actionsWidth === 0
      ? actualInnerWidth
      : Math.max(0, (this.actions ? this.actions.offset.x - style.padding : actualInnerWidth) - style.sectionGap)
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = derivePageHeaderStyle(context.theme)
    const dl = new DrawList(context)
    dl.fillRect(offset.x, offset.y, this.size.width, this.size.height, style.backgroundColor, style.borderRadius)
    if (style.borderWidth > 0) {
      dl.strokeRect(offset.x, offset.y, this.size.width, this.size.height, style.borderColor, style.borderWidth, style.borderRadius)
    }

    let cursorY = offset.y + style.padding
    if (this.breadcrumb) {
      cursorY += this._breadcrumbHeight + style.sectionGap
    }

    dl.pushClip(offset.x + style.padding, offset.y + style.padding, Math.max(0, this._textClipWidth), this._headerHeight)
    dl.fillText(
      this.title,
      offset.x + style.padding,
      cursorY + style.titleLineHeight / 2,
      style.titleColor,
      style.titleFontSize,
      context.theme.fontFamily,
      'left',
      'middle',
      style.titleFontWeight,
    )
    cursorY += style.titleLineHeight
    if (this._descriptionLines.length > 0) {
      cursorY += style.sectionGap
      for (const line of this._descriptionLines) {
        dl.fillText(
          line,
          offset.x + style.padding,
          cursorY + style.descriptionLineHeight / 2,
          style.descriptionColor,
          style.descriptionFontSize,
          context.theme.fontFamily,
          'left',
          'middle',
          style.descriptionFontWeight,
        )
        cursorY += style.descriptionLineHeight
      }
    }
    dl.popClip()

    super.performPaint(context, offset)
  }
}
