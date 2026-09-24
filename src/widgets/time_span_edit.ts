import { FocusManager, type Focusable } from '../core/focus_manager'
import { runCleanupSteps, type DisposeFn } from '../core/disposable'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import type { InteractiveRenderObject, PointerEvent } from '../gestures/recognizers'
import type { GestureArenaMember } from '../gestures/gesture_arena'
import { PendingPointerGesture } from '../gestures/pending_pointer_gesture'
import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { paintSingleLineText } from '../rendering/text_painter'
import {
  deriveTextInputStyle,
  type TextInputStyleTokens,
} from '../theme/component_styles'
import {
  layoutFormFieldInlineContent,
  measureFormFieldHeight,
  paintFormFieldInlineDecorations,
  paintFormFieldShell,
  pointInFormFieldRect,
  resolveFormFieldPlaceholderColor,
  resolveFormFieldTextColor,
  type FormFieldStatus,
} from './form_field_shell'
import {
  composeTimeSpanValue,
  decomposeTimeSpanValue,
  normalizeTimeSpanValue,
  stepTimeSpanValue,
  type TimeSpanParts,
  type TimeSpanPrecision,
  type TimeSpanSegment,
} from './time_span_value'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorBlurListener,
  type ValueEditorValueChangeListener,
} from './value_editor'

export interface TimeSpanEditOptions extends RenderBoxOptions {
  value?: number | null
  precision?: TimeSpanPrecision
  allowNegative?: boolean
  placeholder?: string
  daysStep?: number
  hoursStep?: number
  minutesStep?: number
  secondsStep?: number
  onChange?: (value: number | null) => void
  disabled?: boolean
  readonly?: boolean
  status?: FormFieldStatus
  helperText?: string
  prefixText?: string
  suffixText?: string
  clearable?: boolean
}

export type TimeSpanEditValueChangeReason =
  | 'segment'
  | 'step'
  | 'sign'
  | 'clear'
  | 'precision-reconcile'
  | 'allow-negative-reconcile'

export type TimeSpanEditValueChangeDetail =
  | {
    readonly segment: TimeSpanSegment
    readonly direction?: 1 | -1
  }
  | {
    readonly negative: boolean
  }
  | {
    readonly precision: TimeSpanPrecision
  }
  | {
    readonly allowNegative: boolean
  }

export class RenderTimeSpanEdit extends RenderBox implements
  InteractiveRenderObject,
  Focusable,
  GestureArenaMember,
  ValueEditor<
    number | null,
    TimeSpanEditValueChangeReason,
    TimeSpanEditValueChangeDetail
  > {
  static override debugTypeName = 'RenderTimeSpanEdit'

  private _value: number | null
  private _precision: TimeSpanPrecision
  private _allowNegative: boolean
  private _disabled: boolean
  private _readonly: boolean
  private _status: FormFieldStatus
  private _helperText: string
  private _prefixText: string
  private _suffixText: string
  private _clearable: boolean
  private _focused = false
  private _hovered = false
  private _focusRegistered = false
  private readonly _valueEditorEvents = new ValueEditorEventEmitter<
    number | null,
    TimeSpanEditValueChangeReason,
    TimeSpanEditValueChangeDetail
  >()
  private readonly _pendingGesture = new PendingPointerGesture()
  private _pressedPointerAction: 'clear' | 'sign' | null = null
  private _activeSegment: TimeSpanSegment | null = null
  private _inputBuffer = ''
  private _inputFresh = true
  private _parts: TimeSpanParts = emptyTimeSpanParts()

  placeholder: string
  daysStep: number
  hoursStep: number
  minutesStep: number
  secondsStep: number
  onChange?: (value: number | null) => void

  constructor(options: TimeSpanEditOptions = {}) {
    super(options)
    this._precision = options.precision ?? 'second'
    this._allowNegative = options.allowNegative ?? false
    this._value = normalizeTimeSpanValue(options.value, this._valueOptions())
    this.placeholder = options.placeholder ?? (
      this._precision === 'minute' ? '天 时:分' : '天 时:分:秒'
    )
    this.daysStep = positiveInteger(options.daysStep)
    this.hoursStep = positiveInteger(options.hoursStep)
    this.minutesStep = positiveInteger(options.minutesStep)
    this.secondsStep = positiveInteger(options.secondsStep)
    this.onChange = options.onChange
    this._disabled = options.disabled ?? false
    this._readonly = options.readonly ?? false
    this._status = options.status ?? 'default'
    this._helperText = options.helperText ?? ''
    this._prefixText = options.prefixText ?? ''
    this._suffixText = options.suffixText ?? ''
    this._clearable = options.clearable ?? false
    this._syncParts()
    this._syncFocusRegistration()
  }

  get value(): number | null { return this._value }
  set value(value: number | null) {
    const normalized = normalizeTimeSpanValue(value, this._valueOptions())
    if (normalized === this._value) return
    this._value = normalized
    this._syncParts()
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  getValue(): number | null {
    return this.value
  }

  setValue(value: number | null): void {
    const normalized = normalizeTimeSpanValue(value, this._valueOptions())
    if (normalized === this._value) return
    this.cancelEdit()
    this.value = normalized
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<
      number | null,
      TimeSpanEditValueChangeReason,
      TimeSpanEditValueChangeDetail
    >,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: ValueEditorBlurListener): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
  }

  get precision(): TimeSpanPrecision { return this._precision }
  set precision(precision: TimeSpanPrecision) {
    if (precision === this._precision) return
    const previousValue = this._value
    this._precision = precision
    if (precision === 'minute' && this._activeSegment === 'seconds') {
      this._deactivate(false)
    }
    this._value = normalizeTimeSpanValue(this._value, this._valueOptions())
    this._syncParts()
    this.markNeedsLayout()
    this.markNeedsPaint()
    if (this._value !== previousValue) {
      this._emitReconciledValueChange(
        previousValue,
        'precision-reconcile',
        { precision },
      )
    }
  }

  get allowNegative(): boolean { return this._allowNegative }
  set allowNegative(allowNegative: boolean) {
    if (allowNegative === this._allowNegative) return
    const previousValue = this._value
    if (!allowNegative && this._pressedPointerAction === 'sign') {
      this._cancelPointerAction()
    }
    this._allowNegative = allowNegative
    this._value = normalizeTimeSpanValue(this._value, this._valueOptions())
    this._syncParts()
    this.markNeedsLayout()
    this.markNeedsPaint()
    if (this._value !== previousValue) {
      this._emitReconciledValueChange(
        previousValue,
        'allow-negative-reconcile',
        { allowNegative },
      )
    }
  }

  get disabled(): boolean { return this._disabled }
  set disabled(disabled: boolean) {
    if (disabled === this._disabled) return
    this._disabled = disabled
    if (disabled) {
      runCleanupSteps([
        () => {
          this._hovered = false
          this._cancelPointerAction()
        },
        () => this.focusOut(),
        () => this._syncFocusRegistration(),
        () => this.markNeedsPaint(),
      ])
      return
    }
    this._syncFocusRegistration()
    this.markNeedsPaint()
  }

  get readonly(): boolean { return this._readonly }
  set readonly(readonly: boolean) {
    if (readonly === this._readonly) return
    this._readonly = readonly
    if (readonly) {
      runCleanupSteps([
        () => {
          this._hovered = false
          this._cancelPointerAction()
        },
        () => this.focusOut(),
        () => this._syncFocusRegistration(),
        () => this.markNeedsPaint(),
      ])
      return
    }
    this._syncFocusRegistration()
    this.markNeedsPaint()
  }

  get status(): FormFieldStatus { return this._status }
  set status(status: FormFieldStatus) {
    if (status === this._status) return
    this._status = status
    this.markNeedsPaint()
  }

  get helperText(): string { return this._helperText }
  set helperText(helperText: string) {
    if (helperText === this._helperText) return
    this._helperText = helperText
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get prefixText(): string { return this._prefixText }
  set prefixText(prefixText: string) {
    if (prefixText === this._prefixText) return
    this._prefixText = prefixText
    this.markNeedsPaint()
  }

  get suffixText(): string { return this._suffixText }
  set suffixText(suffixText: string) {
    if (suffixText === this._suffixText) return
    this._suffixText = suffixText
    this.markNeedsPaint()
  }

  get clearable(): boolean { return this._clearable }
  set clearable(clearable: boolean) {
    if (clearable === this._clearable) return
    this._clearable = clearable
    if (!clearable && this._pressedPointerAction === 'clear') {
      this._cancelPointerAction()
    }
    this.markNeedsPaint()
  }

  get isFocused(): boolean { return this._focused }

  focusIn(): void {
    if (this.disabled || this.readonly || this._focused) return
    this._focused = true
    this.markNeedsPaint()
  }

  focusOut(): void {
    const changed = this._focused || this._activeSegment !== null
    if (!changed) return
    runCleanupSteps([
      () => { this.commitEdit() },
      () => {
        this._focused = false
        this._deactivate(false)
      },
      () => this.markNeedsPaint(),
      () => this._valueEditorEvents.emitBlur(),
    ])
  }

  requestFocus(): void {
    if (this.disabled || this.readonly || typeof window === 'undefined') return
    FocusManager.instance.setFocus(this)
  }

  blur(): void {
    if (typeof window === 'undefined') {
      this.focusOut()
      return
    }
    FocusManager.instance.clearFocusOf(this)
  }

  commitEdit(): boolean {
    if (!this._activeSegment || this._inputFresh || this._inputBuffer === '') {
      return true
    }
    const value = Number(this._inputBuffer)
    if (!Number.isFinite(value)) return false
    runCleanupSteps([
      () => this._commitSegment(this._activeSegment!, value),
      () => this._clearPendingSegmentInput(),
    ])
    return true
  }

  cancelEdit(): void {
    this._clearPendingSegmentInput()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.disabled || this.readonly) return false
    if (this.allowNegative && (event.key === '-' || event.key === '+')) {
      event.preventDefault()
      this._setNegative(event.key === '-')
      return true
    }

    let segment = this._activeSegment
    if (!segment) {
      if (event.key >= '0' && event.key <= '9') {
        this._activateSegment('days')
        segment = 'days'
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        this._activateSegment('days')
        return true
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        this._activateSegment('days')
        this._stepSegment('days', event.key === 'ArrowUp' ? 1 : -1)
        return true
      } else {
        return false
      }
    }

    if (event.key >= '0' && event.key <= '9') {
      event.preventDefault()
      if (this._inputFresh) {
        this._inputBuffer = ''
        this._inputFresh = false
      }
      this._inputBuffer += event.key
      if (segment !== 'days') {
        const firstDigitLimit = segment === 'hours' ? 2 : 5
        const complete = this._inputBuffer.length >= 2 ||
          (this._inputBuffer.length === 1 && Number(this._inputBuffer) > firstDigitLimit)
        if (complete) {
          runCleanupSteps([
            () => this._commitSegment(segment, Number(this._inputBuffer)),
            () => this._advanceSegment(segment),
          ])
          return true
        }
      }
      this.markNeedsLayout()
      this.markNeedsPaint()
      return true
    }

    if (event.key === 'Backspace') {
      event.preventDefault()
      if (this._inputFresh) {
        this._inputBuffer = ''
        this._inputFresh = false
      }
      this._inputBuffer = this._inputBuffer.slice(0, -1)
      this.markNeedsLayout()
      this.markNeedsPaint()
      return true
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      runCleanupSteps([
        () => this._commitActiveInput(),
        () => this._stepSegment(segment, event.key === 'ArrowUp' ? 1 : -1),
      ])
      return true
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      runCleanupSteps([
        () => this._commitActiveInput(),
        () => this._moveSegment(segment, event.key === 'ArrowRight' ? 1 : -1),
      ])
      return true
    }

    if (event.key === 'Tab') {
      let moved = false
      runCleanupSteps([
        () => this._commitActiveInput(),
        () => {
          moved = this._moveSegment(segment, event.shiftKey ? -1 : 1)
          if (moved) event.preventDefault()
          else this._deactivate()
        },
      ])
      return moved
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      runCleanupSteps([
        () => this._commitActiveInput(),
        () => this._deactivate(),
      ])
      return true
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      this._deactivate()
      return true
    }
    return false
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveTextInputStyle(context.theme)
    this.size = {
      width: constraints.maxWidth === Infinity ? this._widthHint() : constraints.maxWidth,
      height: measureFormFieldHeight(style, style.height, this.helperText),
    }
  }

  override getMinLayoutWidthHint(): number | undefined {
    return this._widthHint()
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const style = deriveTextInputStyle(context.theme)
    const fieldHeight = style.height
    const readonlyVisual = this.readonly && !this.disabled
    paintFormFieldShell(context, offset, this.size.width, fieldHeight, {
      focused: readonlyVisual ? false : this._focused,
      hovered: readonlyVisual ? false : this._hovered,
      disabled: this.disabled,
      status: this.status,
      helperText: this.helperText,
    })
    const layout = this._fieldLayout(offset, style)
    paintFormFieldInlineDecorations(context, layout, {
      leadingIcon: 'clock',
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      showClearButton: this._showClearButton(),
      disabled: this.disabled,
    })
    const textColor = resolveFormFieldTextColor(style, this.disabled)
    const placeholderColor = resolveFormFieldPlaceholderColor(style, this.disabled)
    const rects = this._segmentRects(style)

    dl.pushClip(layout.valueRect.x, offset.y + 2, layout.valueRect.w, fieldHeight - 4)
    if (this.value === null && this._activeSegment === null) {
      paintSingleLineText(dl, {
        text: this.placeholder,
        x: offset.x + rects.days.x,
        y: offset.y + fieldHeight / 2,
        maxWidth: layout.valueRect.x + layout.valueRect.w - (offset.x + rects.days.x),
        color: placeholderColor,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
      })
    } else {
      if (this.allowNegative) {
        dl.fillText(
          this._parts.negative ? '-' : '',
          offset.x + rects.sign.x,
          offset.y + fieldHeight / 2,
          textColor,
          style.fontSize,
          style.fontFamily,
          'left',
          'middle',
        )
      }
      for (const segment of this._segments()) {
        const rect = rects[segment]
        const active = segment === this._activeSegment
        if (active) {
          dl.fillRect(
            offset.x + rect.x - 2,
            offset.y + 2,
            rect.w + 4,
            fieldHeight - 4,
            style.focusedBorder,
            style.borderRadius,
          )
        }
        const display = this._segmentDisplayText(segment, active)
        dl.fillText(
          display,
          offset.x + rect.x,
          offset.y + fieldHeight / 2,
          active ? style.contrastText : this.value === null ? placeholderColor : textColor,
          style.fontSize,
          style.fontFamily,
          'left',
          'middle',
        )
      }
      dl.fillText(
        'd',
        offset.x + rects.days.x + rects.days.w,
        offset.y + fieldHeight / 2,
        placeholderColor,
        style.fontSize,
        style.fontFamily,
        'left',
        'middle',
      )
      dl.fillText(
        ':',
        offset.x + rects.hours.x + rects.hours.w,
        offset.y + fieldHeight / 2,
        placeholderColor,
        style.fontSize,
        style.fontFamily,
        'left',
        'middle',
      )
      if (this.precision === 'second') {
        dl.fillText(
          ':',
          offset.x + rects.minutes.x + rects.minutes.w,
          offset.y + fieldHeight / 2,
          placeholderColor,
          style.fontSize,
          style.fontFamily,
          'left',
          'middle',
        )
      }
    }
    dl.popClip()
  }

  onPointerDown(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    if (!isPrimaryPointerButton(event)) return
    if (this.disabled || this.readonly || !this._hitField(event.position)) return
    const action = this._pointerActionAt(event.position)
    if (action === 'clear') {
      event.preventActivation?.()
      this._beginPointerAction(event, action)
      return
    }
    FocusManager.instance.setFocus(this)
    if (action === 'sign') {
      event.preventActivation?.()
      this._beginPointerAction(event, action)
      return
    }
    const localX = event.position.x - this.globalOffset.x
    const segment = this._segmentAt(localX)
    if (segment) this._activateSegment(segment)
  }

  onPointerMove(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    const hovered = !this.disabled && !this.readonly && this._hitField(event.position)
    if (hovered === this._hovered) return
    this._hovered = hovered
    this.markNeedsPaint()
  }

  onPointerUp(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    const action = this._pressedPointerAction
    if (!action) return
    const shouldActivate =
      !this.disabled &&
      !this.readonly &&
      this._pointerActionAt(event.position) === action
    this._pendingGesture.resolveTerminal(
      shouldActivate ? 'accepted' : 'rejected',
      () => { this._pressedPointerAction = null },
      () => this.markNeedsPaint(),
      () => {
        if (!shouldActivate) return
        if (action === 'clear') this._clearValue()
        else this._setNegative(!this._parts.negative)
      },
    )
  }

  onPointerCancel(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    const wasHovered = this._hovered
    this._hovered = false
    this._cancelPointerAction()
    if (wasHovered) this.markNeedsPaint()
  }

  onPointerLeave(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    const wasHovered = this._hovered
    this._hovered = false
    this._cancelPointerAction()
    if (wasHovered) this.markNeedsPaint()
  }

  acceptGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    this._pendingGesture.accept(pointerId, pointerType)
  }

  rejectGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.reject(pointerId, pointerType)) return
    const hadPressedAction = this._pressedPointerAction !== null
    this._pressedPointerAction = null
    if (hadPressedAction) this.markNeedsPaint()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  dispose(): void {
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => { this._pressedPointerAction = null },
      () => {
        if (this._focusRegistered && typeof window !== 'undefined') {
          FocusManager.instance.unregister(this)
          this._focusRegistered = false
        }
      },
      () => this._valueEditorEvents.dispose(),
      () => super.dispose(),
    )
  }

  debugState(): {
    value: number | null
    precision: TimeSpanPrecision
    allowNegative: boolean
    activeSegment: TimeSpanSegment | null
    parts: TimeSpanParts | null
  } {
    return {
      value: this.value,
      precision: this.precision,
      allowNegative: this.allowNegative,
      activeSegment: this._activeSegment,
      parts: this.value === null ? null : { ...this._parts },
    }
  }

  private _valueOptions(): {
    precision: TimeSpanPrecision
    allowNegative: boolean
  } {
    return {
      precision: this.precision,
      allowNegative: this.allowNegative,
    }
  }

  private _pointerActionAt(position: Offset): 'clear' | 'sign' | null {
    if (!this._hitField(position)) return null
    const style = this._inputStyle()
    const layout = this._fieldLayout(this.globalOffset, style)
    if (pointInFormFieldRect(layout.clearRect, position)) return 'clear'
    if (!this.allowNegative) return null
    const localX = position.x - this.globalOffset.x
    const sign = this._segmentRects(style).sign
    return localX >= sign.x && localX <= sign.x + sign.w ? 'sign' : null
  }

  private _beginPointerAction(
    event: PointerEvent,
    action: 'clear' | 'sign',
  ): void {
    this._cancelPointerAction()
    this._pressedPointerAction = action
    this._pendingGesture.begin(event, this, { captureOnAccept: false })
    this.markNeedsPaint()
  }

  private _cancelPointerAction(): void {
    const hadPressedAction = this._pressedPointerAction !== null
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => { this._pressedPointerAction = null },
      () => { if (hadPressedAction) this.markNeedsPaint() },
    )
  }

  private _syncParts(preserveNegativeZero = false): void {
    const parts = this.value === null
      ? emptyTimeSpanParts()
      : decomposeTimeSpanValue(this.value, this._valueOptions())
    if (
      preserveNegativeZero &&
      this.allowNegative &&
      this.value === 0
    ) {
      parts.negative = true
    }
    this._parts = parts
  }

  private _commitActiveInput(): void {
    this.commitEdit()
  }

  private _commitSegment(segment: TimeSpanSegment, value: number): void {
    if (!Number.isFinite(value)) return
    if (this.value === null) {
      const negative = this._parts.negative
      this._parts = emptyTimeSpanParts()
      this._parts.negative = negative
    }
    if (segment === 'days') this._parts.days = Math.max(0, Math.trunc(value))
    else if (segment === 'hours') this._parts.hours = clampInteger(value, 0, 23)
    else if (segment === 'minutes') this._parts.minutes = clampInteger(value, 0, 59)
    else this._parts.seconds = clampInteger(value, 0, 59)
    this._emitParts('segment', { segment })
  }

  private _stepSegment(segment: TimeSpanSegment, direction: 1 | -1): void {
    const amount = segment === 'days'
      ? this.daysStep
      : segment === 'hours'
        ? this.hoursStep
        : segment === 'minutes' ? this.minutesStep : this.secondsStep
    const previous = this._value
    const negativeIntent = this._parts.negative
    this._value = stepTimeSpanValue(
      this.value,
      segment,
      direction,
      amount,
      this._valueOptions(),
    )
    this._syncParts(negativeIntent)
    this._inputBuffer = ''
    this._inputFresh = true
    runCleanupSteps([
      () => this._publishValueChange(previous, 'step', { segment, direction }),
      () => this.markNeedsLayout(),
      () => this.markNeedsPaint(),
    ])
  }

  private _emitParts(
    reason: TimeSpanEditValueChangeReason,
    detail?: TimeSpanEditValueChangeDetail,
  ): void {
    const negativeIntent = this._parts.negative
    const next = composeTimeSpanValue(this._parts, this._valueOptions())
    const previousValue = this._value
    this._value = next
    this._syncParts(negativeIntent)
    runCleanupSteps([
      () => this._publishValueChange(previousValue, reason, detail),
      () => this.markNeedsLayout(),
      () => this.markNeedsPaint(),
    ])
  }

  private _setNegative(negative: boolean): void {
    if (!this.allowNegative) return
    this._parts.negative = negative
    if (this.value !== null) this._emitParts('sign', { negative })
    else this.markNeedsPaint()
  }

  private _activateSegment(segment: TimeSpanSegment): void {
    if (segment === 'seconds' && this.precision !== 'second') return
    this._activeSegment = segment
    this._inputBuffer = ''
    this._inputFresh = true
    this.markNeedsPaint()
  }

  private _advanceSegment(segment: TimeSpanSegment): void {
    if (!this._moveSegment(segment, 1)) this._deactivate()
  }

  private _moveSegment(segment: TimeSpanSegment, direction: 1 | -1): boolean {
    const segments = this._segments()
    const next = segments[segments.indexOf(segment) + direction]
    if (!next) return false
    this._activateSegment(next)
    return true
  }

  private _deactivate(markNeedsPaint = true): void {
    this._activeSegment = null
    this._inputBuffer = ''
    this._inputFresh = true
    if (markNeedsPaint) this.markNeedsPaint()
  }

  private _clearPendingSegmentInput(): void {
    if (this._inputBuffer === '' && this._inputFresh) return
    this._inputBuffer = ''
    this._inputFresh = true
    this.markNeedsPaint()
  }

  private _segments(): TimeSpanSegment[] {
    return this.precision === 'second'
      ? ['days', 'hours', 'minutes', 'seconds']
      : ['days', 'hours', 'minutes']
  }

  private _segmentDisplayText(segment: TimeSpanSegment, active: boolean): string {
    if (active && !this._inputFresh) {
      return segment === 'days'
        ? this._inputBuffer || '_'
        : this._inputBuffer.padStart(2, '_')
    }
    if (this.value === null) return segment === 'days' ? '---' : '--'
    return segment === 'days'
      ? String(this._parts.days)
      : String(this._parts[segment]).padStart(2, '0')
  }

  private _segmentRects(style: TextInputStyleTokens): Record<
    TimeSpanSegment | 'sign',
    { x: number; w: number }
  > {
    const layout = this._fieldLayout({ x: 0, y: 0 }, style)
    const digitWidth = Math.max(
      style.fontSize * 0.56,
      TextMeasurer.measureWidth('0', style.fontSize, style.fontFamily),
    )
    const separatorWidth = Math.max(
      4,
      TextMeasurer.measureWidth(':', style.fontSize, style.fontFamily),
    )
    const daySuffixWidth = TextMeasurer.measureWidth('d ', style.fontSize, style.fontFamily)
    const signWidth = this.allowNegative
      ? Math.max(digitWidth, TextMeasurer.measureWidth('-', style.fontSize, style.fontFamily))
      : 0
    const inputDaysLength = this._activeSegment === 'days' && !this._inputFresh
      ? this._inputBuffer.length
      : 0
    const dayDigits = Math.max(3, String(this._parts.days).length, inputDaysLength)
    const daysWidth = dayDigits * digitWidth
    const partWidth = digitWidth * 2
    let x = layout.valueRect.x
    const sign = { x, w: signWidth }
    x += signWidth
    const days = { x, w: daysWidth }
    x += daysWidth + daySuffixWidth
    const hours = { x, w: partWidth }
    x += partWidth + separatorWidth
    const minutes = { x, w: partWidth }
    x += partWidth + separatorWidth
    const seconds = { x, w: partWidth }
    return { sign, days, hours, minutes, seconds }
  }

  private _segmentAt(localX: number): TimeSpanSegment | null {
    const rects = this._segmentRects(this._inputStyle())
    for (const segment of this._segments()) {
      const rect = rects[segment]
      if (localX >= rect.x && localX <= rect.x + rect.w) return segment
    }
    return null
  }

  private _fieldLayout(offset: Offset, style: TextInputStyleTokens) {
    return layoutFormFieldInlineContent(style, offset, this.size.width, style.height, {
      leadingIcon: 'clock',
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      showClearButton: this._showClearButton(),
    })
  }

  private _showClearButton(): boolean {
    return this.clearable && !this.disabled && !this.readonly && this.value !== null
  }

  private _clearValue(): void {
    if (!this._showClearButton()) return
    const previousValue = this._value
    this._value = null
    this._syncParts()
    this._deactivate()
    runCleanupSteps([
      () => this._publishValueChange(previousValue, 'clear'),
      () => this.markNeedsLayout(),
    ])
  }

  private _publishValueChange(
    previousValue: number | null,
    reason: TimeSpanEditValueChangeReason,
    detail?: TimeSpanEditValueChangeDetail,
  ): void {
    const value = this._value
    if (value === previousValue) return
    runCleanupSteps([
      () => this.onChange?.(value),
      () => this._valueEditorEvents.emitValueChange({
        value,
        previousValue,
        reason,
        detail,
      }),
    ])
  }

  private _emitReconciledValueChange(
    previousValue: number | null,
    reason: Extract<
      TimeSpanEditValueChangeReason,
      'precision-reconcile' | 'allow-negative-reconcile'
    >,
    detail: TimeSpanEditValueChangeDetail,
  ): void {
    this._valueEditorEvents.emitValueChange({
      value: this._value,
      previousValue,
      reason,
      detail,
      userInitiated: false,
    })
  }

  private _widthHint(): number {
    const base = this.precision === 'second' ? 210 : 180
    return this.allowNegative ? base + 10 : base
  }

  private _inputStyle(): TextInputStyleTokens {
    return deriveTextInputStyle(this.currentTheme)
  }

  private _hitField(position: Offset): boolean {
    const offset = this.globalOffset
    const fieldHeight = this._inputStyle().height
    return position.x >= offset.x &&
      position.x <= offset.x + this.size.width &&
      position.y >= offset.y &&
      position.y <= offset.y + fieldHeight
  }

  private _syncFocusRegistration(): void {
    if (typeof window === 'undefined') return
    if (this.disabled || this.readonly) {
      if (this._focusRegistered) {
        FocusManager.instance.unregister(this)
        this._focusRegistered = false
      }
      return
    }
    if (!this._focusRegistered) {
      FocusManager.instance.register(this)
      this._focusRegistered = true
    }
  }
}

function emptyTimeSpanParts(): TimeSpanParts {
  return {
    negative: false,
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  }
}

function positiveInteger(value: number | undefined): number {
  if (!Number.isFinite(value) || value! <= 0) return 1
  return Math.max(1, Math.trunc(value!))
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.trunc(value)))
}
