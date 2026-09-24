// Button: ImGui 风格按钮，支持 hover/active 状态动画

import { DrawList } from '../rendering/draw_list'
import { paintSingleLineText } from '../rendering/text_painter'
import { AnimationController } from '../animation/animation_controller'
import { Curves } from '../animation/curves'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import { DisposableBag, type DisposeFn } from '../core/disposable'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import type { GestureArenaMember } from '../gestures/gesture_arena'
import { PendingPointerGesture } from '../gestures/pending_pointer_gesture'
import {
  deriveButtonStyle,
  type ButtonVariant,
  interpolateBgColor,
  resolveBgColor,
  resolveTextColor,
} from '../theme/component_styles'
import { DefaultThemeMotion, lerpColor, resolveThemeMotion } from '../theme/theme'
import { TooltipService } from './tooltip'
import { FocusableControl, paintFocusRing, type ControlInteractionSnapshot } from './focusable_control'

export class RenderButton extends FocusableControl implements InteractiveRenderObject, GestureArenaMember {
  static override debugTypeName = 'RenderButton'
  label: string
  onClick?: () => void
  loading: boolean
  tooltip: string

  private _variant: ButtonVariant
  private _disabled: boolean
  private _hoverAnim: AnimationController
  private _pressAnim: AnimationController
  private _spinAngle = 0
  private _spinDisposer?: DisposeFn
  private _disposables = new DisposableBag()
  private readonly _pendingGesture = new PendingPointerGesture()

  constructor(opts: {
    label: string
    onClick?: () => void
    disabled?: boolean
    loading?: boolean
    variant?: ButtonVariant
    tooltip?: string
  }) {
    super({ disabled: (opts.disabled ?? false) || (opts.loading ?? false) })
    this.label = opts.label
    this.onClick = opts.onClick
    this._variant = opts.variant ?? 'default'
    this._disabled = opts.disabled ?? false
    this.loading = opts.loading ?? false
    this.tooltip = opts.tooltip ?? ''

    this._hoverAnim = new AnimationController({ duration: DefaultThemeMotion.fastDuration, curve: Curves.easeOut })
    this._pressAnim = new AnimationController({ duration: DefaultThemeMotion.fastDuration, curve: Curves.easeOut })

    this._hoverAnim.addListener(() => this.markNeedsPaint())
    this._pressAnim.addListener(() => this.markNeedsPaint())
    this._disposables.addDisposable(this._hoverAnim)
    this._disposables.addDisposable(this._pressAnim)

    if (this.loading) this._startSpin()
  }

  private _startSpin(): void {
    if (this._spinDisposer) return
    this._spinDisposer = this._disposables.setInterval(() => {
      this._spinAngle = (this._spinAngle + 0.15) % (Math.PI * 2)
      this.markNeedsPaint()
    }, 16)
  }

  private _stopSpin(): void {
    if (this._spinDisposer) {
      this._spinDisposer()
      this._spinDisposer = undefined
    }
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

  private _applyInteractivityDisabled(disabled: boolean): boolean {
    return this.setDisabledState(disabled)
  }

  get disabled(): boolean {
    return this._disabled
  }

  set disabled(v: boolean) {
    if (this._disabled === v) return
    this._disabled = v
    if (!this._applyInteractivityDisabled(this.disabled || this.loading)) {
      this.markNeedsPaint()
    }
  }

  setDisabled(v: boolean): void {
    this.disabled = v
  }

  get variant(): ButtonVariant {
    return this._variant
  }

  set variant(value: ButtonVariant) {
    if (this._variant === value) return
    this._variant = value
    this.markNeedsPaint()
  }

  setLoading(v: boolean): void {
    if (this.loading === v) return
    this.loading = v
    if (v) {
      this._startSpin()
    } else {
      this._stopSpin()
    }
    this.markNeedsLayout()
    if (!this._applyInteractivityDisabled(this.disabled || this.loading)) {
      this.markNeedsPaint()
    }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const s = deriveButtonStyle(context.theme, this._variant)
    const textW = TextMeasurer.measureWidth(this.label, s.fontSize, s.fontFamily)
    const contentW = this.loading
      ? this._loadingContentWidth(s, textW)
      : textW
    this.size = {
      width: Math.max(constraints.minWidth, Math.min(constraints.maxWidth, contentW + s.paddingH * 2)),
      height: Math.max(constraints.minHeight, s.fontSize + s.paddingV * 2),
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const motion = resolveThemeMotion(context.theme)
    this._hoverAnim.duration = motion.fastDuration
    this._pressAnim.duration = motion.fastDuration
    const s = deriveButtonStyle(context.theme, this._variant)
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w, height: h } = this.size

    const hoverBg = this._interaction.isHovered
      ? resolveBgColor(s, 'hovered')
      : this._hoverAnim.value > 0
        ? interpolateBgColor(s, 'normal', 'hovered', this._hoverAnim.value)
        : resolveBgColor(s, 'normal')
    const bg = this._interaction.isDisabled
      ? resolveBgColor(s, 'disabled')
      : this._interaction.isPressed
        ? resolveBgColor(s, 'pressed')
        : hoverBg

    // 渐变高光（顶部稍亮）
    const bgTop = bg.a <= 0 ? bg : lerpColor(bg, { r: 255, g: 255, b: 255, a: 1 }, 0.06)
    dl.fillRectGradient(x, y, w, h, bgTop, bg, s.borderRadius)

    // 边框
    if (s.borderWidth > 0) {
      dl.strokeRect(x, y, w, h, s.borderColor, s.borderWidth, s.borderRadius)
    }
    if (this.isFocused && !this.isDisabled) {
      paintFocusRing(dl, s.focusedBorder, x, y, w, h, s.borderRadius)
    }

    const textColor = resolveTextColor(s, this._interaction.isDisabled ? 'disabled' : 'normal')

    if (this.loading) {
      const spinnerSize = this._spinnerSize(s)
      const spinnerGap = this._spinnerGap(s)
      const textW = TextMeasurer.measureWidth(this.label, s.fontSize, s.fontFamily)
      const contentW = this._loadingContentWidth(s, textW)
      const availableContentW = Math.max(0, w - s.paddingH * 2)
      const contentX = x + s.paddingH + Math.max(0, (availableContentW - contentW) / 2)
      const cy = y + h / 2
      const cx = contentX + spinnerSize / 2
      const r = spinnerSize / 2
      const ctx2d = (dl as any).ctx as CanvasRenderingContext2D
      ctx2d.save()
      ctx2d.strokeStyle = `rgba(${s.focusedBorder.r},${s.focusedBorder.g},${s.focusedBorder.b},0.8)`
      ctx2d.lineWidth = 2
      ctx2d.lineCap = 'round'
      ctx2d.beginPath()
      ctx2d.arc(cx, cy, r, this._spinAngle, this._spinAngle + Math.PI * 1.2)
      ctx2d.stroke()
      ctx2d.restore()

      if (this.label) {
        paintSingleLineText(dl, {
          text: this.label,
          x: contentX + spinnerSize + spinnerGap,
          y: cy,
          maxWidth: Math.max(0, x + w - s.paddingH - (contentX + spinnerSize + spinnerGap)),
          color: textColor,
          fontSize: s.fontSize,
          fontFamily: s.fontFamily,
        })
      }
    } else {
      // 文字居中
      const textX = x + w / 2
      const textY = y + h / 2
      const paintedText = paintSingleLineText(dl, {
        text: this.label,
        x: textX,
        y: textY,
        maxWidth: Math.max(0, w - s.paddingH * 2),
        color: textColor,
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
        align: 'center',
      })
      if (this._variant === 'link' && this.label) {
        const underlineY = Math.min(y + h - 3, textY + s.fontSize / 2 + 1)
        dl.line(textX - paintedText.width / 2, underlineY, textX + paintedText.width / 2, underlineY, textColor, 1)
      }
    }
  }

  private _spinnerSize(style: ReturnType<typeof deriveButtonStyle>): number {
    return style.fontSize * 0.8
  }

  private _spinnerGap(style: ReturnType<typeof deriveButtonStyle>): number {
    return Math.max(6, style.paddingH * 0.75)
  }

  private _loadingContentWidth(style: ReturnType<typeof deriveButtonStyle>, textW: number): number {
    const spinnerSize = this._spinnerSize(style)
    if (!this.label) return spinnerSize
    return spinnerSize + this._spinnerGap(style) + textW
  }

  // ---- 交互 ----

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this._interaction.isDisabled || !this.hitTest(e.position)) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    this._resetPendingGesture()
    if (!this._interaction.press()) return
    this.requestFocus()
    this._pendingGesture.begin(e, this, { captureOnAccept: false })
    this._pressAnim.forward()
    this.markNeedsPaint()
  }

  onPointerUp(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this._interaction.isDisabled) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    const shouldClick = this._interaction.isPressed && this.hitTest(e.position)
    const wasPressed = this._interaction.release()
    this._pendingGesture.resolveTerminal(
      shouldClick ? 'accepted' : 'rejected',
      () => { if (wasPressed) this._pressAnim.reverse() },
      () => this.markNeedsPaint(),
      () => { if (shouldClick) this.onClick?.() },
    )
  }

  onPointerMove(e: PointerEvent): void {
    if (this._interaction.isDisabled) return
    const isHovered = this.hitTest(e.position)
    const hoverChanged = isHovered
      ? this._interaction.enterHover()
      : this._interaction.leaveHover()
    if (hoverChanged) {
      if (isHovered) {
        this._hoverAnim.forward()
        if (this.tooltip) TooltipService.currentOrNull?.show(this.tooltip, e.position)
      } else {
        this._hoverAnim.reverse()
        if (this.tooltip) TooltipService.currentOrNull?.hide()
      }
      this.markNeedsPaint()
    } else if (this._interaction.isHovered && this.tooltip) {
      TooltipService.currentOrNull?.updatePos(e.position)
    }
  }

  onPointerCancel(e: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    this._resetInteraction()
  }

  onPointerLeave(_e: PointerEvent): void {
    if (!this._interaction.leaveHover()) return
    this._hoverAnim.reverse()
    if (this.tooltip) TooltipService.currentOrNull?.hide()
    this.markNeedsPaint()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isDisabled || this.loading) return false
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

  dispose(): void {
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => {
        if (this._interaction.isHovered && this.tooltip) TooltipService.currentOrNull?.hide()
      },
      () => this._stopSpin(),
      () => this._disposables.dispose(),
      () => super.dispose(),
      () => { this.onClick = undefined },
    )
  }
}
