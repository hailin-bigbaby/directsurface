import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { DrawList } from '../rendering/draw_list'
import { paintSingleLineText } from '../rendering/text_painter'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset, Rect } from '../core/render_object'
import { RenderObject, constrainSize } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import {
  deriveChipStyle,
  resolveBgColor,
  resolveTextColor,
  type ChipStyleTokens,
} from '../theme/component_styles'
import type { ResolvedTheme } from '../theme/theme'
import { paintIconGlyph } from './icon'
import { FocusableControl, paintFocusRing } from './focusable_control'

export interface ChipLayoutMetrics {
  width: number
  height: number
  removeRect: Rect | null
}

export interface MeasureChipOptions {
  removable?: boolean
  height?: number
}

export interface PaintChipOptions {
  label: string
  rect: Rect
  removable?: boolean
  selected?: boolean
  disabled?: boolean
  hovered?: boolean
  pressed?: boolean
  removeHovered?: boolean
  removePressed?: boolean
  centerLabel?: boolean
  focused?: boolean
}

export function measureChipLayout(
  theme: ResolvedTheme,
  label: string,
  options: MeasureChipOptions = {},
): ChipLayoutMetrics {
  const style = deriveChipStyle(theme)
  const height = options.height ?? style.height
  const labelWidth = Math.ceil(TextMeasurer.measureWidth(label, style.fontSize, style.fontFamily))
  const removableWidth = options.removable ? style.closeGap + style.closeIconSize : 0
  const width = labelWidth + style.paddingX * 2 + removableWidth
  const removeRect = options.removable
    ? {
        x: width - style.paddingX - style.closeIconSize,
        y: (height - style.closeIconSize) / 2,
        width: style.closeIconSize,
        height: style.closeIconSize,
      }
    : null
  return { width, height, removeRect }
}

export function paintChip(
  context: PaintContext,
  options: PaintChipOptions,
): { removeRect: Rect | null } {
  const style = deriveChipStyle(context.theme)
  const dl = new DrawList(context)
  const pressed = options.removePressed || options.pressed
  const hovered = options.hovered || options.removeHovered
  const state = {
    disabled: options.disabled,
    selected: options.selected,
    pressed,
    hovered,
    focused: options.focused,
  }
  const bgSet = options.selected ? style.selectedBg : style.defaultBg
  const bg = resolveBgColor(bgSet, state)
  const bgTop = {
    r: Math.round(bg.r + (255 - bg.r) * (pressed ? 0.04 : options.selected ? 0.1 : 0.12)),
    g: Math.round(bg.g + (255 - bg.g) * (pressed ? 0.04 : options.selected ? 0.1 : 0.12)),
    b: Math.round(bg.b + (255 - bg.b) * (pressed ? 0.04 : options.selected ? 0.1 : 0.12)),
    a: bg.a,
  }
  const border = resolveBgColor(style.borderColor, state)
  const textColor = resolveTextColor(style.textColor, state)

  dl.fillRectGradient(
    options.rect.x,
    options.rect.y,
    options.rect.width,
    options.rect.height,
    bgTop,
    bg,
    Math.min(style.radius, options.rect.height / 2),
  )
  dl.strokeRect(
    options.rect.x,
    options.rect.y,
    options.rect.width,
    options.rect.height,
    border,
    options.removePressed ? 1.5 : style.borderWidth,
    Math.min(style.radius, options.rect.height / 2),
  )

  const textX = options.centerLabel
    ? options.rect.x + options.rect.width / 2
    : options.rect.x + style.paddingX
  const removeRect = options.removable
    ? {
        x: options.rect.x + Math.max(style.paddingX, options.rect.width - style.paddingX - style.closeIconSize),
        y: options.rect.y + (options.rect.height - style.closeIconSize) / 2,
        width: style.closeIconSize,
        height: style.closeIconSize,
      }
    : null
  const removeReservedWidth = removeRect
    ? Math.max(0, options.rect.x + options.rect.width - (removeRect.x - style.closeGap))
    : 0
  const labelMaxWidth = options.centerLabel
    ? Math.max(0, options.rect.width - style.paddingX * 2 - removeReservedWidth)
    : Math.max(0, (removeRect ? removeRect.x - style.closeGap : options.rect.x + options.rect.width - style.paddingX) - textX)
  paintSingleLineText(dl, {
    text: options.label,
    x: textX,
    y: options.rect.y + options.rect.height / 2,
    maxWidth: labelMaxWidth,
    color: textColor,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    align: options.centerLabel ? 'center' : 'left',
  })

  if (options.removable) {
    paintIconGlyph(context, {
      name: 'close',
      x: removeRect!.x,
      y: removeRect!.y,
      size: removeRect!.width,
      color: options.removeHovered || options.removePressed ? border : textColor,
    })
  }

  if (options.focused && !options.disabled) {
    paintFocusRing(
      dl,
      style.focusedBorder,
      options.rect.x,
      options.rect.y,
      options.rect.width,
      options.rect.height,
      Math.min(style.radius, options.rect.height / 2),
    )
  }

  return { removeRect }
}

export class RenderChip extends FocusableControl implements InteractiveRenderObject {
  static override debugTypeName = 'RenderChip'
  label: string
  selected: boolean
  removable: boolean
  onClick?: () => void
  onRemove?: () => void

  private _hovered = false
  private _pressed = false
  private _hoveredRemove = false
  private _pressedRemove = false

  constructor(options: {
    label: string
    selected?: boolean
    removable?: boolean
    disabled?: boolean
    onClick?: () => void
    onRemove?: () => void
  }) {
    super({ disabled: options.disabled ?? false })
    this.label = options.label
    this.selected = options.selected ?? false
    this.removable = options.removable ?? false
    this.onClick = options.onClick
    this.onRemove = options.onRemove
  }

  get disabled(): boolean {
    return this.isDisabled
  }

  set disabled(disabled: boolean) {
    if (!this.setDisabledState(disabled)) this.markNeedsPaint()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const metrics = measureChipLayout(context.theme, this.label, { removable: this.removable })
    this.size = constrainSize(constraints, {
      width: metrics.width,
      height: metrics.height,
    })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    paintChip(context, {
      label: this.label,
      rect: { x: offset.x, y: offset.y, width: this.size.width, height: this.size.height },
      removable: this.removable,
      selected: this.selected,
      disabled: this.disabled,
      hovered: this._hovered,
      pressed: this._pressed,
      removeHovered: this._hoveredRemove,
      removePressed: this._pressedRemove,
      focused: this.isFocused,
    })
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this.disabled || !this.hitTest(event.position)) return
    this.requestFocus()
    this._pressed = true
    this._pressedRemove = this._hitRemove(event.position)
    this.markNeedsPaint()
  }

  onPointerMove(event: PointerEvent): void {
    if (this.disabled) return
    const hovered = this.hitTest(event.position)
    const hoveredRemove = hovered && this._hitRemove(event.position)
    if (
      hovered === this._hovered &&
      hoveredRemove === this._hoveredRemove
    ) return
    this._hovered = hovered
    this._hoveredRemove = hoveredRemove
    this.markNeedsPaint()
  }

  onPointerUp(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (!this._pressed) return
    const activate = this.hitTest(event.position)
    const remove = this._pressedRemove && this._hitRemove(event.position)
    this._pressed = false
    this._pressedRemove = false
    this.markNeedsPaint()
    if (!activate || this.disabled) return
    if (remove && this.removable) {
      this.onRemove?.()
      return
    }
    this.onClick?.()
  }

  onPointerCancel(_event: PointerEvent): void {
    if (!this._pressed && !this._hovered && !this._hoveredRemove && !this._pressedRemove) return
    this._pressed = false
    this._pressedRemove = false
    this._hovered = false
    this._hoveredRemove = false
    this.markNeedsPaint()
  }

  onPointerLeave(_event: PointerEvent): void {
    if (!this._hovered && !this._hoveredRemove) return
    this._hovered = false
    this._hoveredRemove = false
    this.markNeedsPaint()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.disabled) return false
    if ((event.key === 'Backspace' || event.key === 'Delete') && this.removable) {
      event.preventDefault()
      this.onRemove?.()
      return true
    }
    if (event.key !== 'Enter' && event.key !== ' ') return false
    event.preventDefault()
    this.onClick?.()
    return true
  }

  protected override onDisabledStateChanged(_disabled: boolean): void {
    this._pressed = false
    this._pressedRemove = false
    this._hovered = false
    this._hoveredRemove = false
  }

  private _hitRemove(position: Offset): boolean {
    if (!this.removable) return false
    const style = deriveChipStyle(this.currentTheme)
    const global = this.globalOffset
    const removeRect = {
      x: global.x + Math.max(style.paddingX, this.size.width - style.paddingX - style.closeIconSize),
      y: global.y + (this.size.height - style.closeIconSize) / 2,
      width: style.closeIconSize,
      height: style.closeIconSize,
    }
    return position.x >= removeRect.x &&
      position.x <= removeRect.x + removeRect.width &&
      position.y >= removeRect.y &&
      position.y <= removeRect.y + removeRect.height
  }
}
