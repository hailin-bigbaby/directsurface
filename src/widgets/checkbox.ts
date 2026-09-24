// Checkbox: ImGui 风格复选框

import { DrawList } from '../rendering/draw_list'
import { paintSingleLineText } from '../rendering/text_painter'
import { AnimationController } from '../animation/animation_controller'
import { Curves } from '../animation/curves'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import { runCleanupSteps, type DisposeFn } from '../core/disposable'
import { TextMeasurer } from '../core/text_measurer'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import type { GestureArenaMember } from '../gestures/gesture_arena'
import { PendingPointerGesture } from '../gestures/pending_pointer_gesture'
import {
  blendColor,
  deriveCheckboxStyle,
  interpolateBgColor,
  resolveBgColor,
  resolveTextColor,
} from '../theme/component_styles'
import { DefaultThemeMotion, resolveThemeMotion } from '../theme/theme'
import { FocusableControl, paintFocusRing, type ControlInteractionSnapshot } from './focusable_control'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorValueChangeListener,
} from './value_editor'

export type CheckboxValueChangeReason = 'toggle'

export class RenderCheckbox extends FocusableControl implements
  InteractiveRenderObject,
  GestureArenaMember,
  ValueEditor<boolean, CheckboxValueChangeReason, undefined> {
  static override debugTypeName = 'RenderCheckbox'
  private _checked: boolean
  private _indeterminate: boolean
  private _disabled: boolean
  label: string
  onChange?: (value: boolean) => void
  private readonly _valueEditorEvents = new ValueEditorEventEmitter<
    boolean,
    CheckboxValueChangeReason,
    undefined
  >()

  private _checkAnim: AnimationController
  private _hoverAnim: AnimationController
  private readonly _pendingGesture = new PendingPointerGesture()

  constructor(opts: {
    checked: boolean
    indeterminate?: boolean
    disabled?: boolean
    label: string
    onChange?: (value: boolean) => void
  }) {
    super({ disabled: opts.disabled ?? false })
    this._checked = opts.checked
    this._indeterminate = opts.indeterminate ?? false
    this._disabled = opts.disabled ?? false
    this.label = opts.label
    this.onChange = opts.onChange

    this._checkAnim = new AnimationController({
      initialValue: (opts.checked || opts.indeterminate) ? 1 : 0,
      duration: DefaultThemeMotion.normalDuration,
      curve: Curves.easeOut,
    })
    this._hoverAnim = new AnimationController({ duration: DefaultThemeMotion.fastDuration, curve: Curves.easeOut })
    this._checkAnim.addListener(() => this.markNeedsPaint())
    this._hoverAnim.addListener(() => this.markNeedsPaint())
  }

  get checked(): boolean { return this._checked }
  set checked(value: boolean) {
    if (this._checked === value) return
    this._checked = value
    this._syncCheckAnimation()
    this.markNeedsPaint()
  }

  getValue(): boolean {
    return this.checked
  }

  setValue(value: boolean): void {
    this.checked = value
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<
      boolean,
      CheckboxValueChangeReason,
      undefined
    >,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: () => void): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
  }

  get indeterminate(): boolean { return this._indeterminate }
  set indeterminate(value: boolean) {
    if (this._indeterminate === value) return
    this._indeterminate = value
    this._syncCheckAnimation()
    this.markNeedsPaint()
  }

  get disabled(): boolean { return this._disabled }
  set disabled(value: boolean) {
    if (this._disabled === value) return
    this._disabled = value
    this.setDisabledState(value)
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const s = deriveCheckboxStyle(context.theme)
    const boxSize = s.boxSize
    const textW = TextMeasurer.measureWidth(this.label, s.fontSize, s.fontFamily)
    const totalW = boxSize + s.itemSpacing + textW
    this.size = {
      width: Math.min(constraints.maxWidth, totalW),
      height: Math.max(constraints.minHeight, boxSize),
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const motion = resolveThemeMotion(context.theme)
    this._checkAnim.duration = motion.normalDuration
    this._hoverAnim.duration = motion.fastDuration
    const s = deriveCheckboxStyle(context.theme)
    const dl = new DrawList(context)
    const { x, y } = offset
    const boxSize = s.boxSize
    const state = this._interaction.state

    const uncheckedBg = this.isDisabled
      ? resolveBgColor(s.boxBg, 'disabled')
      : interpolateBgColor(s.boxBg, 'normal', 'hovered', this._hoverAnim.value)
    const checkedBg = this.isDisabled
      ? resolveBgColor(s.checkedBoxBg, 'disabled')
      : interpolateBgColor(s.checkedBoxBg, 'normal', 'hovered', this._hoverAnim.value)
    const bg = blendColor(uncheckedBg, checkedBg, this._checkAnim.value)
    dl.fillRect(x, y, boxSize, boxSize, bg, s.borderRadius)
    dl.strokeRect(
      x,
      y,
      boxSize,
      boxSize,
      this.isDisabled
        ? resolveBgColor(s.boxBorder, 'disabled')
        : interpolateBgColor(s.boxBorder, 'normal', 'hovered', this._hoverAnim.value),
      1,
      s.borderRadius,
    )
    if (this.isFocused && !this.isDisabled) {
      paintFocusRing(dl, context.theme.focusBorder, x, y, boxSize, boxSize, s.borderRadius)
    }
    if (this._checkAnim.value > 0) {
      const markColor = {
        ...resolveTextColor(s.checkMark, state),
        a: this._checkAnim.value,
      }
      if (this.indeterminate) {
        const pad = boxSize * 0.25
        const midY = y + boxSize / 2
        dl.line(x + pad, midY, x + boxSize - pad, midY, markColor, 2)
      } else {
        dl.drawCheckmark(x, y, boxSize, markColor, 2)
      }
    }

    const labelX = x + boxSize + s.itemSpacing
    paintSingleLineText(dl, {
      text: this.label,
      x: labelX,
      y: y + boxSize / 2,
      maxWidth: Math.max(0, x + this.size.width - labelX),
      color: resolveTextColor(s.labelText, state),
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
    })
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

  private _toggle(): void {
    const previousValue = this.checked
    if (this.indeterminate) {
      this.indeterminate = false
      this.checked = true
      this._checkAnim.forward()
    } else {
      this.checked = !this.checked
      if (this.checked) this._checkAnim.forward()
      else this._checkAnim.reverse()
    }
    runCleanupSteps([
      () => this.onChange?.(this.checked),
      () => this._valueEditorEvents.emitValueChange({
        value: this.checked,
        previousValue,
        reason: 'toggle',
      }),
    ])
  }

  private _syncCheckAnimation(): void {
    if (this.checked || this.indeterminate) this._checkAnim.forward()
    else this._checkAnim.reverse()
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

  dispose(): void {
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => this._valueEditorEvents.dispose(),
      () => this._checkAnim.dispose(),
      () => this._hoverAnim.dispose(),
      () => super.dispose(),
      () => { this.onChange = undefined },
    )
  }
}
