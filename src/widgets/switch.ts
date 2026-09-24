// Switch: 开关组件
// AnimationController 驱动滑块位移和背景色过渡

import { DrawList } from '../rendering/draw_list'
import { paintSingleLineText } from '../rendering/text_painter'
import { AnimationController } from '../animation/animation_controller'
import { Curves } from '../animation/curves'
import { TextMeasurer } from '../core/text_measurer'
import { lerpColor } from '../theme/theme'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import { runCleanupSteps, type DisposeFn } from '../core/disposable'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import type { GestureArenaMember } from '../gestures/gesture_arena'
import { PendingPointerGesture } from '../gestures/pending_pointer_gesture'
import {
  deriveSwitchStyle,
  interpolateBgColor,
  resolveBgColor,
  resolveTextColor,
} from '../theme/component_styles'
import { FocusableControl, paintFocusRing, type ControlInteractionSnapshot } from './focusable_control'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorValueChangeListener,
} from './value_editor'

export type SwitchValueChangeReason = 'toggle'

export class RenderSwitch extends FocusableControl implements
  InteractiveRenderObject,
  GestureArenaMember,
  ValueEditor<boolean, SwitchValueChangeReason, undefined> {
  static override debugTypeName = 'RenderSwitch'
  private _checked: boolean
  private _disabled: boolean
  label: string
  onChange?: (checked: boolean) => void

  private _toggleAnim: AnimationController
  private _hoverAnim: AnimationController
  private readonly _pendingGesture = new PendingPointerGesture()
  private readonly _valueEditorEvents = new ValueEditorEventEmitter<
    boolean,
    SwitchValueChangeReason,
    undefined
  >()

  private get _trackW(): number { return deriveSwitchStyle(this.currentTheme).trackWidth }
  private get _trackH(): number { return deriveSwitchStyle(this.currentTheme).trackHeight }
  private get _thumbR(): number { return deriveSwitchStyle(this.currentTheme).trackHeight * 0.42 }

  constructor(opts: {
    checked?: boolean
    label?: string
    disabled?: boolean
    onChange?: (checked: boolean) => void
  }) {
    super({ disabled: opts.disabled ?? false })
    this._checked = opts.checked ?? false
    this.label = opts.label ?? ''
    this._disabled = opts.disabled ?? false
    this.onChange = opts.onChange

    this._toggleAnim = new AnimationController({
      initialValue: this.checked ? 1 : 0,
      duration: 180,
      curve: Curves.easeInOut,
    })
    this._hoverAnim = new AnimationController({ duration: 120, curve: Curves.easeOut })

    this._toggleAnim.addListener(() => this.markNeedsPaint())
    this._hoverAnim.addListener(() => this.markNeedsPaint())
  }

  get disabled(): boolean { return this._disabled }
  set disabled(value: boolean) {
    if (this._disabled === value) return
    this._disabled = value
    this.setDisabledState(value)
  }

  getValue(): boolean {
    return this.checked
  }

  setValue(value: boolean): void {
    this.checked = value
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<boolean, SwitchValueChangeReason, undefined>,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: () => void): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const s = deriveSwitchStyle(context.theme)
    const labelW = this.label
      ? TextMeasurer.measureWidth(this.label, s.fontSize, s.fontFamily) + s.itemSpacing
      : 0
    this.size = {
      width: Math.min(constraints.maxWidth, this._trackW + labelW),
      height: s.height,
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const s = deriveSwitchStyle(context.theme)
    const dl = new DrawList(context)
    const { x, y } = offset
    const { height: h, width: w } = this.size
    const tv = this._toggleAnim.value
    const hv = this._hoverAnim.value
    const state = this._interaction.state

    const trackW = this._trackW
    const trackH = this._trackH
    const thumbR = this._thumbR
    const trackX = x
    const trackY = y + (h - trackH) / 2

    const offColor = this.isDisabled
      ? resolveBgColor(s.offTrackBg, 'disabled')
      : interpolateBgColor(s.offTrackBg, 'normal', 'hovered', hv)
    const onColor = this.isDisabled
      ? resolveBgColor(s.onTrackBg, 'disabled')
      : interpolateBgColor(s.onTrackBg, 'normal', 'hovered', hv)
    const trackColor = this.isDisabled ? offColor : lerpColor(offColor, onColor, tv)

    dl.fillRect(trackX, trackY, trackW, trackH, trackColor, trackH / 2)
    dl.strokeRect(
      trackX,
      trackY,
      trackW,
      trackH,
      this.isDisabled
        ? resolveBgColor(s.trackBorder, 'disabled')
        : interpolateBgColor(s.trackBorder, 'normal', 'hovered', hv),
      1,
      trackH / 2,
    )
    if (this.isFocused && !this.isDisabled) {
      paintFocusRing(dl, context.theme.focusBorder, x, y, w, h, trackH / 2)
    }
    const thumbTravel = trackW - thumbR * 2 - 4
    const thumbX = trackX + thumbR + 2 + thumbTravel * tv
    const thumbY = trackY + trackH / 2

    const ctx = context.ctx
    ctx.save()
    const thumbShadow = s.thumbShadowColor
    ctx.shadowColor = `rgba(${thumbShadow.r},${thumbShadow.g},${thumbShadow.b},${thumbShadow.a})`
    ctx.shadowBlur = 4
    ctx.shadowOffsetY = 1
    ctx.beginPath()
    ctx.arc(thumbX, thumbY, thumbR, 0, Math.PI * 2)
    const thumbColor = resolveBgColor(s.thumbBg, state)
    ctx.fillStyle = `rgba(${thumbColor.r},${thumbColor.g},${thumbColor.b},${thumbColor.a})`
    ctx.fill()
    ctx.restore()

    if (this.label) {
      const labelX = trackX + trackW + s.itemSpacing
      paintSingleLineText(dl, {
        text: this.label,
        x: labelX,
        y: y + h / 2,
        maxWidth: Math.max(0, x + w - labelX),
        color: resolveTextColor(s.labelText, state),
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
      })
    }
  }

  private _toggle(): void {
    if (this.isDisabled) return
    const previousValue = this.checked
    this.checked = !this.checked
    runCleanupSteps([
      () => this.onChange?.(this.checked),
      () => this._valueEditorEvents.emitValueChange({
        value: this.checked,
        previousValue,
        reason: 'toggle',
      }),
    ])
  }

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this.isDisabled || !this.hitTest(e.position)) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    this._resetPendingGesture()
    this.requestFocus()
    if (!this._interaction.press()) return
    this._pendingGesture.begin(e, this, { captureOnAccept: false })
    this.markNeedsPaint()
  }

  get checked(): boolean { return this._checked }
  set checked(value: boolean) {
    if (this._checked === value) return
    this._checked = value
    if (this._checked) this._toggleAnim.forward()
    else this._toggleAnim.reverse()
    this.markNeedsPaint()
  }

  onPointerUp(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this.isDisabled) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    const shouldToggle = this._interaction.isPressed && this.hitTest(e.position)
    const released = this._interaction.release()
    this._pendingGesture.resolveTerminal(
      shouldToggle ? 'accepted' : 'rejected',
      () => { if (released) this.markNeedsPaint() },
      () => { if (shouldToggle) this._toggle() },
    )
  }

  onPointerMove(e: PointerEvent): void {
    if (this.isDisabled) return
    const isHovered = this.hitTest(e.position)
    const hoverChanged = isHovered
      ? this._interaction.enterHover()
      : this._interaction.leaveHover()
    if (hoverChanged) {
      if (isHovered) this._hoverAnim.forward()
      else this._hoverAnim.reverse()
      this.markNeedsPaint()
    }
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isDisabled) return false
    if (event.key !== 'Enter' && event.key !== ' ') return false
    event.preventDefault()
    this._toggle()
    return true
  }

  onPointerCancel(e: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    this._interaction.release()
    this._interaction.leaveHover()
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => this._hoverAnim.reverse(),
      () => this.markNeedsPaint(),
    )
  }

  onPointerLeave(_e: PointerEvent): void {
    if (!this._interaction.leaveHover()) return
    this._hoverAnim.reverse()
    this.markNeedsPaint()
  }

  protected override onDisabledStateChanged(disabled: boolean, previous: ControlInteractionSnapshot): void {
    if (!disabled) return
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => { if (previous.hovered) this._hoverAnim.reverse() },
    )
  }

  protected override onFocusChanged(focused: boolean): void {
    if (!focused) this._valueEditorEvents.emitBlur()
  }

  acceptGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    this._pendingGesture.accept(pointerId, pointerType)
  }

  rejectGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.reject(pointerId, pointerType)) return
    this._interaction.release()
    this.markNeedsPaint()
  }

  private _resetPendingGesture(): void {
    this._pendingGesture.resetPending()
  }

  dispose(): void {
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => this._valueEditorEvents.dispose(),
      () => this._toggleAnim.dispose(),
      () => this._hoverAnim.dispose(),
      () => super.dispose(),
      () => { this.onChange = undefined },
    )
  }
}
