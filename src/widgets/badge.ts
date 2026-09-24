import { DrawList } from '../rendering/draw_list'
import { paintSingleLineText } from '../rendering/text_painter'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset, Rect } from '../core/render_object'
import { RenderObject, constrainSize } from '../core/render_object'
import { RenderBox } from '../layout/render_box'
import { TextMeasurer } from '../core/text_measurer'
import {
  deriveBadgeStyle,
  type BadgeStatus,
  type BadgeAppearance,
} from '../theme/component_styles'
import type { ResolvedTheme } from '../theme/theme'

export interface BadgeLayoutMetrics {
  width: number
  height: number
}

export interface MeasureBadgeOptions {
  status?: BadgeStatus
  appearance?: BadgeAppearance
  dot?: boolean
  max?: number
  compact?: boolean
}

export interface PaintBadgeOptions extends MeasureBadgeOptions {
  value?: string | number
  rect: Rect
}

function displayBadgeValue(value: string | number | undefined, max = 99): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value) && value > max) return `${max}+`
  return String(value)
}

export function measureBadgeLayout(
  theme: ResolvedTheme,
  value?: string | number,
  options: MeasureBadgeOptions = {},
): BadgeLayoutMetrics {
  const style = deriveBadgeStyle(theme)
  const minHeight = options.compact ? Math.max(14, style.minHeight - 4) : style.minHeight
  const minWidth = options.compact ? Math.max(14, style.minWidth - 4) : style.minWidth
  const paddingX = options.compact ? Math.max(4, style.paddingX - 2) : style.paddingX
  const dotSize = options.compact ? Math.max(6, style.dotSize - 2) : style.dotSize
  if (options.dot && (value === undefined || value === null || value === '')) {
    return { width: dotSize, height: dotSize }
  }
  const text = displayBadgeValue(value, options.max)
  const textWidth = Math.ceil(TextMeasurer.measureWidth(text, style.fontSize, style.fontFamily))
  return {
    width: Math.max(minWidth, textWidth + paddingX * 2),
    height: minHeight,
  }
}

export function paintBadge(context: PaintContext, options: PaintBadgeOptions): void {
  const style = deriveBadgeStyle(context.theme)
  const paddingX = options.compact ? Math.max(4, style.paddingX - 2) : style.paddingX
  const status = style.statuses[options.status ?? 'normal']
  const appearance = options.appearance ?? 'subtle'
  const bg = appearance === 'filled' ? status.filledBg : status.subtleBg
  const border = appearance === 'filled' ? status.filledBorder : status.subtleBorder
  const text = appearance === 'filled' ? status.filledText : status.subtleText
  const radius = Math.min(style.radius, options.rect.height / 2)
  const dl = new DrawList(context)

  dl.fillRect(
    options.rect.x,
    options.rect.y,
    options.rect.width,
    options.rect.height,
    bg,
    radius,
  )
  dl.strokeRect(
    options.rect.x,
    options.rect.y,
    options.rect.width,
    options.rect.height,
    border,
    style.borderWidth,
    radius,
  )

  if (options.dot && (options.value === undefined || options.value === null || options.value === '')) return

  const display = displayBadgeValue(options.value, options.max)
  if (!display) return
  paintSingleLineText(dl, {
    text: display,
    x: options.rect.x + options.rect.width / 2,
    y: options.rect.y + options.rect.height / 2,
    maxWidth: Math.max(0, options.rect.width - paddingX * 2),
    color: text,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    align: 'center',
  })
}

export class RenderBadge extends RenderBox {
  static override debugTypeName = 'RenderBadge'
  value?: string | number
  status: BadgeStatus
  appearance: BadgeAppearance
  dot: boolean
  max: number
  compact: boolean

  constructor(options: {
    value?: string | number
    status?: BadgeStatus
    appearance?: BadgeAppearance
    dot?: boolean
    max?: number
    compact?: boolean
  }) {
    super()
    this.value = options.value
    this.status = options.status ?? 'normal'
    this.appearance = options.appearance ?? 'subtle'
    this.dot = options.dot ?? false
    this.max = options.max ?? 99
    this.compact = options.compact ?? false
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const metrics = measureBadgeLayout(context.theme, this.value, {
      status: this.status,
      appearance: this.appearance,
      dot: this.dot,
      max: this.max,
      compact: this.compact,
    })
    this.size = constrainSize(constraints, {
      width: metrics.width,
      height: metrics.height,
    })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    paintBadge(context, {
      value: this.value,
      status: this.status,
      appearance: this.appearance,
      dot: this.dot,
      max: this.max,
      compact: this.compact,
      rect: { x: offset.x, y: offset.y, width: this.size.width, height: this.size.height },
    })
  }
}
