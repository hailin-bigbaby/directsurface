// 基础 Widget: 所有可渲染组件的基类
// 采用直接渲染模式：Widget 持有 RenderBox，通过 DrawList 绘制

import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import type { Color } from '../theme/theme'
import { RenderObject } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import { deriveTextStyle } from '../theme/component_styles'

function wrapTextLines(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: string,
  fontWeight?: string | number,
): string[] {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return text.split('\n')
  const lines: string[] = []
  const paragraphs = text.split('\n')
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    let current = ''
    for (const char of paragraph) {
      const next = current + char
      const nextWidth = TextMeasurer.measureWidth(next, fontSize, fontFamily, fontWeight)
      if (current && nextWidth > maxWidth) {
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

// ---- RenderText ----

export type RenderTextRole = 'default' | 'title' | 'secondary' | 'accent' | 'onAccent' | 'disabled'
export type RenderTextSize = 'default' | 'small' | 'large' | number
export type RenderTextWeight = 'normal' | 'medium' | 'semibold' | 'bold' | number
export type RenderTextOverflow = 'visible' | 'ellipsis'
export type RenderTextFit = 'none' | 'shrink'

export interface RenderTextOptions {
  role?: RenderTextRole
  size?: RenderTextSize
  weight?: RenderTextWeight
  color?: Color
  overflow?: RenderTextOverflow
  fit?: RenderTextFit
  minSize?: number
}

function isColor(value: Color | RenderTextOptions | undefined): value is Color {
  return !!value && 'r' in value && 'g' in value && 'b' in value && 'a' in value
}

type TextStyle = ReturnType<typeof deriveTextStyle>

function roleTextMetrics(
  style: TextStyle,
  role?: RenderTextRole,
): { fontSize: number; lineHeight: number; fontWeight: number } {
  if (role === 'title') {
    return {
      fontSize: style.titleFontSize,
      lineHeight: style.titleLineHeight,
      fontWeight: style.titleFontWeight,
    }
  }
  if (role === 'secondary') {
    return {
      fontSize: style.secondaryFontSize,
      lineHeight: style.secondaryLineHeight,
      fontWeight: style.secondaryFontWeight,
    }
  }
  return {
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    fontWeight: style.fontWeight,
  }
}

function resolveTextFontSize(style: TextStyle, role?: RenderTextRole, size?: RenderTextSize): number {
  if (typeof size === 'number') return size
  const roleSize = roleTextMetrics(style, role).fontSize
  if (size === 'small') return Math.max(11, roleSize - 1)
  if (size === 'large') return roleSize + 2
  return roleSize
}

function resolveTextLineHeight(style: TextStyle, role: RenderTextRole | undefined, fontSize: number): number {
  const metrics = roleTextMetrics(style, role)
  return metrics.lineHeight * fontSize / metrics.fontSize
}

function resolveTextFontWeight(
  style: TextStyle,
  role: RenderTextRole | undefined,
  weight: RenderTextWeight | undefined,
): string | number {
  return resolveTextWeight(weight) ?? roleTextMetrics(style, role).fontWeight
}

function resolveTextColor(
  style: ReturnType<typeof deriveTextStyle>,
  theme: LayoutContext['theme'],
  role: RenderTextRole | undefined,
  color: Color | undefined,
): Color {
  if (color) return color
  switch (role) {
    case 'title':
      return theme.textPrimary
    case 'accent':
      return theme.textAccent
    case 'secondary':
      return theme.textSecondary
    case 'onAccent':
      return theme.textOnAccent
    case 'disabled':
      return theme.textDisabled
    default:
      return style.text
  }
}

function resolveTextWeight(weight?: RenderTextWeight): string | number | undefined {
  if (weight === 'medium') return 500
  if (weight === 'semibold') return 600
  return weight
}

function resolveFittedText(
  text: string,
  maxWidth: number,
  fontSize: number,
  minSize: number | undefined,
  fontFamily: string,
  fontWeight: string | number,
  fit: RenderTextFit,
  overflow: RenderTextOverflow,
): { text: string; fontSize: number; width: number } {
  if (maxWidth === Infinity) {
    return {
      text,
      fontSize,
      width: TextMeasurer.measureWidth(text, fontSize, fontFamily, fontWeight),
    }
  }

  const width = Math.max(0, maxWidth)
  let paintText = text
  let paintSize = fontSize
  if (fit === 'shrink') {
    const minimumSize = Math.max(1, Math.min(minSize ?? Math.max(8, fontSize - 8), fontSize))
    for (let size = fontSize; size >= minimumSize; size -= 1) {
      paintSize = size
      if (TextMeasurer.measureWidth(text, size, fontFamily, fontWeight) <= width) {
        return { text, fontSize: size, width: Math.min(width, TextMeasurer.measureWidth(text, size, fontFamily, fontWeight)) }
      }
    }
  }

  if (overflow === 'ellipsis' && TextMeasurer.measureWidth(paintText, paintSize, fontFamily, fontWeight) > width) {
    paintText = ellipsizeText(paintText, width, paintSize, fontFamily, fontWeight)
  }

  return {
    text: paintText,
    fontSize: paintSize,
    width: Math.min(width, TextMeasurer.measureWidth(paintText, paintSize, fontFamily, fontWeight)),
  }
}

function ellipsizeText(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: string,
  fontWeight?: string | number,
): string {
  const ellipsis = '...'
  if (TextMeasurer.measureWidth(ellipsis, fontSize, fontFamily, fontWeight) > maxWidth) return ''
  const chars = Array.from(text)
  while (
    chars.length > 0 &&
    TextMeasurer.measureWidth(`${chars.join('')}${ellipsis}`, fontSize, fontFamily, fontWeight) > maxWidth
  ) {
    chars.pop()
  }
  return `${chars.join('')}${ellipsis}`
}

export class RenderText extends RenderBox {
  static override debugTypeName = 'RenderText'
  private _text: string
  private _paintText: string
  private _paintFontSize = 0
  color?: Color
  role?: RenderTextRole
  sizeOption?: RenderTextSize
  weight?: RenderTextWeight
  overflow: RenderTextOverflow
  fit: RenderTextFit
  minSize?: number

  constructor(text: string, color?: Color)
  constructor(text: string, options?: RenderTextOptions)
  constructor(text: string, colorOrOptions?: Color | RenderTextOptions) {
    super()
    this._text = text
    this._paintText = text
    this.overflow = 'visible'
    this.fit = 'none'
    if (isColor(colorOrOptions)) {
      this.color = colorOrOptions
    } else {
      this.color = colorOrOptions?.color
      this.role = colorOrOptions?.role
      this.sizeOption = colorOrOptions?.size
      this.weight = colorOrOptions?.weight
      this.overflow = colorOrOptions?.overflow ?? 'visible'
      this.fit = colorOrOptions?.fit ?? 'none'
      this.minSize = colorOrOptions?.minSize
    }
  }

  get text(): string {
    return this._text
  }

  set text(value: string) {
    if (this._text === value) return
    this._text = value
    this.markNeedsLayout()
  }

  get paintText(): string {
    return this._paintText
  }

  get paintFontSize(): number {
    return this._paintFontSize
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveTextStyle(context.theme)
    const fontSize = resolveTextFontSize(style, this.role, this.sizeOption)
    const fontWeight = resolveTextFontWeight(style, this.role, this.weight)
    const fit = resolveFittedText(
      this._text,
      constraints.maxWidth,
      fontSize,
      this.minSize,
      style.fontFamily,
      fontWeight,
      this.fit,
      this.overflow,
    )
    this._paintText = fit.text
    this._paintFontSize = fit.fontSize
    this.size = {
      width: fit.width,
      height: resolveTextLineHeight(style, this.role, fit.fontSize),
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveTextStyle(context.theme)
    const fontSize = this._paintFontSize || resolveTextFontSize(style, this.role, this.sizeOption)
    const dl = new DrawList(context)
    dl.fillText(
      this._paintText,
      offset.x,
      offset.y + this.size.height / 2,
      resolveTextColor(style, context.theme, this.role, this.color),
      fontSize,
      style.fontFamily,
      'left',
      'middle',
      resolveTextFontWeight(style, this.role, this.weight),
    )
  }
}

export class RenderParagraph extends RenderBox {
  static override debugTypeName = 'RenderParagraph'
  private _text: string
  color?: Color
  private _lines: string[] = []

  constructor(text: string, color?: Color) {
    super()
    this._text = text
    this.color = color
  }

  get text(): string {
    return this._text
  }

  set text(value: string) {
    if (this._text === value) return
    this._text = value
    this.markNeedsLayout()
  }

  protected setTextDuringLayout(value: string): void {
    this._text = value
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveTextStyle(context.theme)
    const maxWidth = constraints.maxWidth
    this._lines = wrapTextLines(this._text, maxWidth, style.fontSize, style.fontFamily, style.fontWeight)
    const widths = this._lines.map(line =>
      TextMeasurer.measureWidth(line, style.fontSize, style.fontFamily, style.fontWeight))
    const width = widths.length > 0 ? Math.min(maxWidth, Math.max(...widths, 0)) : 0
    const height = Math.max(1, this._lines.length) * style.lineHeight
    this.size = {
      width,
      height,
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveTextStyle(context.theme)
    const dl = new DrawList(context)
    for (let i = 0; i < this._lines.length; i++) {
      dl.fillText(
        this._lines[i] ?? '',
        offset.x,
        offset.y + style.lineHeight * i + style.lineHeight / 2,
        this.color ?? style.text,
        style.fontSize,
        style.fontFamily,
        'left',
        'middle',
        style.fontWeight,
      )
    }
  }
}
