import { AnimationController } from '../animation/animation_controller'
import { Curves } from '../animation/curves'
import type { GestureArenaMember } from '../gestures/gesture_arena'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { PendingPointerGesture } from '../gestures/pending_pointer_gesture'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { RenderObject } from '../core/render_object'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import {
  deriveButtonStyle,
  type ButtonVariant,
  interpolateBgColor,
  resolveBgColor,
  resolveTextColor,
} from '../theme/component_styles'
import { lerpColor } from '../theme/theme'
import { FocusableControl, paintFocusRing, type ControlInteractionSnapshot } from './focusable_control'
import { type IconName, paintIconGlyph } from './icon'
import { TooltipService } from './tooltip'

export type IconButtonVariant = Extract<ButtonVariant, 'default' | 'text'>

export class RenderIconButton extends FocusableControl implements InteractiveRenderObject, GestureArenaMember {
  static override debugTypeName = 'RenderIconButton'
  icon: IconName
  onClick?: () => void
  tooltip: string

  private _disabled: boolean
  private _variant: IconButtonVariant
  private _buttonSize?: number
  private _iconSize?: number
  private _hoverAnim: AnimationController
  private _pressAnim: AnimationController
  private readonly _pendingGesture = new PendingPointerGesture()

  constructor(options: {
    icon: IconName
    onClick?: () => void
    tooltip?: string
    disabled?: boolean
    size?: number
    iconSize?: number
    variant?: IconButtonVariant
  }) {
    super({ disabled: options.disabled ?? false })
    this.icon = options.icon
    this.onClick = options.onClick
    this.tooltip = options.tooltip ?? ''
    this._disabled = options.disabled ?? false
    this._variant = options.variant ?? 'default'
    this._buttonSize = options.size
    this._iconSize = options.iconSize
    this._hoverAnim = new AnimationController({ duration: 120, curve: Curves.easeOut })
    this._pressAnim = new AnimationController({ duration: 80, curve: Curves.easeOut })
    this._hoverAnim.addListener(() => this.markNeedsPaint())
    this._pressAnim.addListener(() => this.markNeedsPaint())
  }

  get disabled(): boolean {
    return this._disabled
  }

  set disabled(value: boolean) {
    if (this._disabled === value) return
    this._disabled = value
    if (!this.setDisabledState(value)) this.markNeedsPaint()
  }

  get variant(): IconButtonVariant {
    return this._variant
  }

  set variant(value: IconButtonVariant) {
    if (this._variant === value) return
    this._variant = value
    this.markNeedsPaint()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveButtonStyle(context.theme, this._variant)
    const edge = this._buttonSize ?? Math.max(style.fontSize + style.paddingV * 2, style.fontSize + style.paddingH * 2)
    const width = Math.max(constraints.minWidth, Math.min(constraints.maxWidth, edge))
    const height = Math.max(constraints.minHeight, Math.min(constraints.maxHeight, edge))
    this.size = { width, height }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveButtonStyle(context.theme, this._variant)
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width, height } = this.size

    const hoverBg = this._interaction.isHovered
      ? resolveBgColor(style, 'hovered')
      : this._hoverAnim.value > 0
        ? interpolateBgColor(style, 'normal', 'hovered', this._hoverAnim.value)
        : resolveBgColor(style, 'normal')
    const bg = this._interaction.isDisabled
      ? resolveBgColor(style, 'disabled')
      : this._interaction.isPressed
        ? resolveBgColor(style, 'pressed')
        : hoverBg
    const bgTop = lerpColor(bg, { r: 255, g: 255, b: 255, a: 1 }, 0.06)
    dl.fillRectGradient(x, y, width, height, bgTop, bg, style.borderRadius)
    if (style.borderWidth > 0) {
      dl.strokeRect(x, y, width, height, style.borderColor, style.borderWidth, style.borderRadius)
    }
    if (this.isFocused && !this.isDisabled) {
      paintFocusRing(dl, style.focusedBorder, x, y, width, height, style.borderRadius)
    }

    const iconSize = this._iconSize ?? Math.max(12, style.fontSize * 0.95)
    const iconX = x + (width - iconSize) / 2
    const iconY = y + (height - iconSize) / 2
    const iconColor = this._variant === 'text'
      ? this._interaction.isDisabled
        ? context.theme.textDisabled
        : this._interaction.isHovered || this._interaction.isPressed || this.isFocused
          ? context.theme.textPrimary
          : context.theme.textSecondary
      : resolveTextColor(style, this._interaction.isDisabled ? 'disabled' : 'normal')
    paintIconGlyph(context, {
      name: this.icon,
      x: iconX,
      y: iconY,
      size: iconSize,
      color: iconColor,
    })
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this._interaction.isDisabled || !this.hitTest(event.position)) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    this._resetPendingGesture()
    if (!this._interaction.press()) return
    this.requestFocus()
    this._pendingGesture.begin(event, this, { captureOnAccept: false })
    this._pressAnim.forward()
    this.markNeedsPaint()
  }

  onPointerUp(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this._interaction.isDisabled) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    const shouldClick = this._interaction.isPressed && this.hitTest(event.position)
    const wasPressed = this._interaction.release()
    this._pendingGesture.resolveTerminal(
      shouldClick ? 'accepted' : 'rejected',
      () => { if (wasPressed) this._pressAnim.reverse() },
      () => this.markNeedsPaint(),
      () => { if (shouldClick) this.onClick?.() },
    )
  }

  onPointerMove(event: PointerEvent): void {
    if (this._interaction.isDisabled) return
    const isHovered = this.hitTest(event.position)
    const hoverChanged = isHovered
      ? this._interaction.enterHover()
      : this._interaction.leaveHover()
    if (hoverChanged) {
      if (isHovered) {
        this._hoverAnim.forward()
        if (this.tooltip) TooltipService.currentOrNull?.show(this.tooltip, event.position)
      } else {
        this._hoverAnim.reverse()
        if (this.tooltip) TooltipService.currentOrNull?.hide()
      }
      this.markNeedsPaint()
    } else if (this._interaction.isHovered && this.tooltip) {
      TooltipService.currentOrNull?.updatePos(event.position)
    }
  }

  onPointerCancel(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    this._resetInteraction()
  }

  onPointerLeave(_event: PointerEvent): void {
    if (!this._interaction.leaveHover()) return
    this._hoverAnim.reverse()
    if (this.tooltip) TooltipService.currentOrNull?.hide()
    this.markNeedsPaint()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isDisabled) return false
    if (event.key !== 'Enter' && event.key !== ' ') return false
    event.preventDefault()
    this.onClick?.()
    return true
  }

  acceptGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    this._pendingGesture.accept(pointerId, pointerType)
  }

  rejectGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.reject(pointerId, pointerType)) return
    if (this._interaction.release()) this._pressAnim.reverse()
    this.markNeedsPaint()
  }

  private _resetInteraction(): void {
    const wasHovered = this._interaction.isHovered
    const wasPressed = this._interaction.isPressed
    this._interaction.release()
    this._interaction.leaveHover()
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => { if (wasPressed) this._pressAnim.reverse() },
      () => { if (wasHovered) this._hoverAnim.reverse() },
      () => {
        if (wasHovered && this.tooltip) TooltipService.currentOrNull?.hide()
      },
      () => this.markNeedsPaint(),
    )
  }

  private _resetPendingGesture(): void {
    this._pendingGesture.resetPending()
  }

  protected override onDisabledStateChanged(disabled: boolean, previous: ControlInteractionSnapshot): void {
    if (!disabled) return
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => { if (previous.pressed) this._pressAnim.reverse() },
      () => { if (previous.hovered) this._hoverAnim.reverse() },
      () => {
        if (previous.hovered && this.tooltip) TooltipService.currentOrNull?.hide()
      },
    )
  }

  override dispose(): void {
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => {
        if (this._interaction.isHovered && this.tooltip) TooltipService.currentOrNull?.hide()
      },
      () => this._hoverAnim.dispose(),
      () => this._pressAnim.dispose(),
      () => super.dispose(),
      () => { this.onClick = undefined },
    )
  }
}
