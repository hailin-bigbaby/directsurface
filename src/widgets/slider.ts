// Slider: ImGui 风格滑块

import { DrawList } from '../rendering/draw_list'
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
  deriveSliderStyle,
  resolveBgColor,
  resolveTextColor,
} from '../theme/component_styles'
import { FocusableControl, paintFocusRing, type ControlInteractionSnapshot } from './focusable_control'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorValueChangeListener,
} from './value_editor'

const DRAG_SLOP = 4

export type SliderValueChangeReason = 'input'

export class RenderSlider extends FocusableControl implements
  InteractiveRenderObject,
  GestureArenaMember,
  ValueEditor<number, SliderValueChangeReason, undefined> {
  static override debugTypeName = 'RenderSlider'
  readonly preventsPointerActivationOnAccept = true
  private _value: number
  private _disabled: boolean
  min: number
  max: number
  step?: number
  label: string
  onChange?: (value: number) => void
  showValue: boolean

  private _dragging = false
  private readonly _pendingGesture = new PendingPointerGesture()
  private _dragStartPosition?: Offset
  private _lastDragPosition?: Offset
  private readonly _valueEditorEvents = new ValueEditorEventEmitter<
    number,
    SliderValueChangeReason,
    undefined
  >()

  constructor(opts: {
    value: number
    min?: number
    max?: number
    step?: number
    disabled?: boolean
    label?: string
    onChange?: (value: number) => void
    showValue?: boolean
  }) {
    super({ disabled: opts.disabled ?? false })
    this._value = opts.value
    this._disabled = opts.disabled ?? false
    this.min = opts.min ?? 0
    this.max = opts.max ?? 1
    this.step = opts.step
    this.label = opts.label ?? ''
    this.onChange = opts.onChange
    this.showValue = opts.showValue ?? true
    this._value = this._clampValue(this._value)
  }

  get value(): number { return this._value }
  set value(value: number) {
    const clamped = this._clampValue(value)
    if (this._value === clamped) return
    this._value = clamped
    this.markNeedsPaint()
  }

  get disabled(): boolean { return this._disabled }
  set disabled(value: boolean) {
    if (this._disabled === value) return
    this._disabled = value
    this.setDisabledState(value)
  }

  getValue(): number {
    return this.value
  }

  setValue(value: number): void {
    this.value = value
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<number, SliderValueChangeReason, undefined>,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: () => void): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const s = deriveSliderStyle(context.theme)
    this.size = {
      width: constraints.maxWidth === Infinity ? 200 : constraints.maxWidth,
      height: s.height,
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const s = deriveSliderStyle(context.theme)
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w, height: h } = this.size
    const state = this._interaction.state

    const trackH = s.trackHeight
    const trackY = y + h / 2 - trackH / 2
    const grabR = h / 2 - 2

    let trackX = x
    let trackW = w
    if (this.label) {
      const labelW = TextMeasurer.measureWidth(this.label, s.fontSize, s.fontFamily) + s.itemSpacing
      dl.fillText(
        this.label,
        x,
        y + h / 2,
        resolveTextColor(s.labelText, state),
        s.fontSize,
        s.fontFamily,
        'left',
        'middle',
      )
      trackX = x + labelW
      trackW = w - labelW
    }

    if (this.showValue) {
      const valStr = this._formatValue()
      const valW = TextMeasurer.measureWidth(valStr, s.fontSize, s.fontFamily) + s.itemSpacing
      trackW -= valW
      dl.fillText(
        valStr,
        trackX + trackW + s.itemSpacing,
        y + h / 2,
        resolveTextColor(s.valueText, state),
        s.fontSize,
        s.fontFamily,
        'left',
        'middle',
      )
    }

    dl.fillRect(trackX, trackY, trackW, trackH, resolveBgColor(s.trackBg, state), trackH / 2)

    const range = this.max - this.min
    const norm = range === 0 ? 0 : (this.value - this.min) / range
    const filledW = norm * trackW
    if (filledW > 0) {
      dl.fillRect(trackX, trackY, filledW, trackH, resolveBgColor(s.fillBg, state), trackH / 2)
    }

    const grabX = trackX + norm * trackW
    dl.fillCircle(grabX, y + h / 2, grabR, resolveBgColor(s.grabBg, state))
    dl.strokeCircle(grabX, y + h / 2, grabR, resolveBgColor(s.grabBorder, state), 1)
    if (this.isFocused && !this.isDisabled) {
      paintFocusRing(dl, context.theme.focusBorder, x, y, w, h, h / 2)
    }
  }

  private _formatValue(): string {
    const range = this.max - this.min
    const step = this.step ?? this._keyboardStep()
    const decimals = this._decimalPlaces(step)
    if (range <= 100 && decimals > 0) return this.value.toFixed(decimals)
    if (range <= 100 && Math.abs(this.value % 1) > 0.000001) return this.value.toFixed(1)
    return Math.round(this.value).toString()
  }

  private _trackBounds(): { x: number; w: number } {
    let trackX = this.globalOffset.x
    let trackW = this.size.width
    const s = deriveSliderStyle(this.currentTheme)

    if (this.label) {
      const labelW = TextMeasurer.measureWidth(this.label, s.fontSize, s.fontFamily) + s.itemSpacing
      trackX += labelW
      trackW -= labelW
    }
    if (this.showValue) {
      const valW = TextMeasurer.measureWidth(this._formatValue(), s.fontSize, s.fontFamily) + s.itemSpacing
      trackW -= valW
    }
    return { x: trackX, w: Math.max(1, trackW) }
  }

  private _posToValue(px: number): number {
    const { x, w } = this._trackBounds()
    const norm = Math.max(0, Math.min(1, (px - x) / w))
    return this.min + norm * (this.max - this.min)
  }

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this.isDisabled || !this.hitTest(e.position)) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    this.requestFocus()
    if (e.joinGestureArena) {
      this._resetPendingGesture()
      this._dragStartPosition = e.position
      this._lastDragPosition = e.position
      this._pendingGesture.begin(e, this)
      return
    }
    this._pendingGesture.captureImmediately(e)
    this._dragging = true
    this._interaction.press()
    this._setValue(this._posToValue(e.position.x), true)
    this.markNeedsPaint()
  }

  onPointerMove(e: PointerEvent): void {
    if (this.isDisabled) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    const isHovered = this.hitTest(e.position)
    const hoverChanged = isHovered
      ? this._interaction.enterHover()
      : this._interaction.leaveHover()
    if (hoverChanged) this.markNeedsPaint()

    if (this._pendingGesture.isPending && !this._dragging) {
      this._lastDragPosition = e.position
      const start = this._dragStartPosition
      if (!start) return
      const dx = e.position.x - start.x
      const dy = e.position.y - start.y
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= DRAG_SLOP) {
        this._pendingGesture.resolve(Math.abs(dx) >= Math.abs(dy) ? 'accepted' : 'rejected')
      }
    }

    if (this._dragging) {
      this._setValue(this._posToValue(e.position.x), true)
      this.markNeedsPaint()
    }
  }

  onPointerUp(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    const shouldAccept = this._pendingGesture.isPending && !this._dragging
    this._pendingGesture.resolveTerminal(
      shouldAccept ? 'accepted' : 'rejected',
      () => { this._interaction.release() },
      () => {
        this._dragging = false
        this._dragStartPosition = undefined
        this._lastDragPosition = undefined
      },
      () => this.markNeedsPaint(),
    )
  }

  onPointerCancel(e: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => { this._interaction.release() },
      () => { this._interaction.leaveHover() },
      () => {
        this._dragging = false
        this._dragStartPosition = undefined
        this._lastDragPosition = undefined
      },
      () => this.markNeedsPaint(),
    )
  }

  onPointerLeave(_e: PointerEvent): void {
    if (!this._interaction.leaveHover()) return
    this.markNeedsPaint()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isDisabled) return false
    let nextValue: number | null = null
    const step = this._keyboardStep()
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        nextValue = this.value - step
        break
      case 'ArrowRight':
      case 'ArrowUp':
        nextValue = this.value + step
        break
      case 'PageDown':
        nextValue = this.value - step * 10
        break
      case 'PageUp':
        nextValue = this.value + step * 10
        break
      case 'Home':
        nextValue = this.min
        break
      case 'End':
        nextValue = this.max
        break
      default:
        return false
    }
    event.preventDefault()
    this._setValue(nextValue, true)
    return true
  }

  acceptGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.accept(pointerId, pointerType)) return
    this._dragging = true
    this._interaction.press()
    const pos = this._lastDragPosition ?? this._dragStartPosition
    if (pos) this._setValue(this._posToValue(pos.x), true)
    this.markNeedsPaint()
  }

  rejectGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.reject(pointerId, pointerType)) return
    this._dragging = false
    this._interaction.release()
    this._dragStartPosition = undefined
    this._lastDragPosition = undefined
    this.markNeedsPaint()
  }

  private _setValue(value: number, emit: boolean): void {
    const clamped = this._clampValue(value)
    if (this._value === clamped) return
    const previousValue = this._value
    this._value = clamped
    if (emit) {
      runCleanupSteps([
        () => this.onChange?.(this._value),
        () => this._valueEditorEvents.emitValueChange({
          value: this._value,
          previousValue,
          reason: 'input',
        }),
      ])
    }
    this.markNeedsPaint()
  }

  private _clampValue(value: number): number {
    return Math.max(this.min, Math.min(this.max, value))
  }

  private _keyboardStep(): number {
    if (typeof this.step === 'number' && this.step > 0) return this.step
    const range = Math.abs(this.max - this.min)
    if (range <= 1) return 0.01
    if (range <= 10) return 0.1
    return Math.max(1, range / 100)
  }

  private _decimalPlaces(value: number): number {
    const asString = value.toString()
    const dotIndex = asString.indexOf('.')
    return dotIndex >= 0 ? asString.length - dotIndex - 1 : 0
  }

  private _resetPendingGesture(): void {
    this._pendingGesture.resetPending()
    this._dragStartPosition = undefined
    this._lastDragPosition = undefined
  }

  private _cancelPendingGesture(): void {
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => {
        this._dragStartPosition = undefined
        this._lastDragPosition = undefined
      },
    )
  }

  protected override onDisabledStateChanged(disabled: boolean, previous: ControlInteractionSnapshot): void {
    if (!disabled) return
    this._dragging = false
    if (previous.pressed) this._interaction.release()
    if (previous.hovered) this._interaction.leaveHover()
    this._cancelPendingGesture()
  }

  protected override onFocusChanged(focused: boolean): void {
    if (!focused) this._valueEditorEvents.emitBlur()
  }

  dispose(): void {
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => this._valueEditorEvents.dispose(),
      () => super.dispose(),
      () => { this.onChange = undefined },
    )
  }
}
