import { FocusManager, type Focusable } from '../core/focus_manager'
import { runCleanupSteps, type DisposeFn } from '../core/disposable'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import type { InteractiveRenderObject, PointerEvent } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import type { GestureArenaMember } from '../gestures/gesture_arena'
import { PendingPointerGesture } from '../gestures/pending_pointer_gesture'
import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import type { PaintContext } from '../rendering/paint_context'
import { DrawList } from '../rendering/draw_list'
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
  formatTimeValue,
  normalizeTimeValue,
  parseTimeValue,
  stepTimePart,
  type TimeParts,
  type TimePrecision,
  type TimeSegment,
} from './time_value'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorBlurListener,
  type ValueEditorValueChangeListener,
} from './value_editor'

export interface TimeEditOptions extends RenderBoxOptions {
  value?: string
  precision?: TimePrecision
  placeholder?: string
  hourStep?: number
  minuteStep?: number
  secondStep?: number
  onChange?: (value: string) => void
  disabled?: boolean
  readonly?: boolean
  status?: FormFieldStatus
  helperText?: string
  prefixText?: string
  suffixText?: string
  clearable?: boolean
}

export type TimeEditValueChangeReason =
  | 'segment'
  | 'step'
  | 'clear'
  | 'precision-reconcile'

export type TimeEditValueChangeDetail =
  | {
    readonly direction: 1 | -1
    readonly segment: TimeSegment
  }
  | {
    readonly precision: TimePrecision
  }

export class RenderTimeEdit extends RenderBox implements
  InteractiveRenderObject,
  Focusable,
  GestureArenaMember,
  ValueEditor<string, TimeEditValueChangeReason, TimeEditValueChangeDetail> {
  static override debugTypeName = 'RenderTimeEdit'

  private _value: string
  private _precision: TimePrecision
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
    string,
    TimeEditValueChangeReason,
    TimeEditValueChangeDetail
  >()
  private readonly _pendingGesture = new PendingPointerGesture()
  private _pressedPointerAction: 'clear' | null = null
  private _activeSegment: TimeSegment | null = null
  private _inputBuffer = ''
  private _inputFresh = true
  private _parts: TimeParts = { hour: 0, minute: 0, second: 0 }
  private _hasTime = false
  private _placeholder: string
  private _usesDefaultPlaceholder: boolean

  hourStep: number
  minuteStep: number
  secondStep: number
  onChange?: (value: string) => void

  constructor(options: TimeEditOptions = {}) {
    super(options)
    this._precision = options.precision ?? 'second'
    this._value = normalizeTimeValue(options.value ?? '', this._precision) ?? ''
    this._usesDefaultPlaceholder = options.placeholder === undefined
    this._placeholder = options.placeholder ?? defaultTimeEditPlaceholder(this._precision)
    this.hourStep = positiveInteger(options.hourStep)
    this.minuteStep = positiveInteger(options.minuteStep)
    this.secondStep = positiveInteger(options.secondStep)
    this.onChange = options.onChange
    this._disabled = options.disabled ?? false
    this._readonly = options.readonly ?? false
    this._status = options.status ?? 'default'
    this._helperText = options.helperText ?? ''
    this._prefixText = options.prefixText ?? ''
    this._suffixText = options.suffixText ?? ''
    this._clearable = options.clearable ?? false
    this._parseValue()
    this._syncFocusRegistration()
  }

  get value(): string { return this._value }
  set value(value: string) {
    const normalized = normalizeTimeValue(value, this.precision) ?? ''
    if (normalized === this._value) return
    this._value = normalized
    this._parseValue()
    this.markNeedsPaint()
  }

  getValue(): string {
    return this.value
  }

  setValue(value: string): void {
    const normalized = normalizeTimeValue(value, this.precision) ?? ''
    if (normalized === this._value) return
    this.cancelEdit()
    this.value = normalized
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<
      string,
      TimeEditValueChangeReason,
      TimeEditValueChangeDetail
    >,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: ValueEditorBlurListener): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
  }

  get placeholder(): string { return this._placeholder }
  set placeholder(value: string) {
    this._usesDefaultPlaceholder = false
    if (value === this._placeholder) return
    this._placeholder = value
    this.markNeedsPaint()
  }

  get precision(): TimePrecision { return this._precision }
  set precision(precision: TimePrecision) {
    if (precision === this._precision) return
    const previousValue = this._value
    this._precision = precision
    if (this._usesDefaultPlaceholder) {
      this._placeholder = defaultTimeEditPlaceholder(precision)
    }
    if (precision === 'minute') {
      this._parts.second = 0
      if (this._activeSegment === 'second') this._deactivate()
    }
    if (this._hasTime) this._value = formatTimeValue(this._parts, precision)
    this.markNeedsLayout()
    this.markNeedsPaint()
    if (this._value !== previousValue) {
      this._valueEditorEvents.emitValueChange({
        value: this._value,
        previousValue,
        reason: 'precision-reconcile',
        detail: { precision },
        userInitiated: false,
      })
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

  get isFocused(): boolean {
    return this._focused
  }

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
    if (!this._activeSegment || this._inputFresh || this._inputBuffer === '') return true
    runCleanupSteps([
      () => this._commitActiveInput(),
      () => this._clearPendingSegmentInput(),
    ])
    return true
  }

  cancelEdit(): void {
    this._clearPendingSegmentInput()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.disabled || this.readonly) return false
    let segment = this._activeSegment
    if (!segment) {
      if (event.key >= '0' && event.key <= '9') {
        this._activateSegment('hour')
        segment = 'hour'
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        this._activateSegment('hour')
        return true
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        this._activateSegment('hour')
        this._stepSegment('hour', event.key === 'ArrowUp' ? 1 : -1)
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
      const firstDigitLimit = segment === 'hour' ? 2 : 5
      const shouldCommit = this._inputBuffer.length >= 2 ||
        (this._inputBuffer.length === 1 && Number(this._inputBuffer) > firstDigitLimit)
      if (shouldCommit) {
        runCleanupSteps([
          () => this._commitSegment(segment, Number(this._inputBuffer)),
          () => this._advanceSegment(segment),
        ])
      } else {
        this.markNeedsPaint()
      }
      return true
    }

    if (event.key === 'Backspace') {
      event.preventDefault()
      if (this._inputFresh) {
        this._inputBuffer = ''
        this._inputFresh = false
      }
      this._inputBuffer = this._inputBuffer.slice(0, -1)
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
    if (!this._hasTime && this._activeSegment === null) {
      paintSingleLineText(dl, {
        text: this.placeholder,
        x: offset.x + rects.hour.x,
        y: offset.y + fieldHeight / 2,
        maxWidth: layout.valueRect.x + layout.valueRect.w - (offset.x + rects.hour.x),
        color: placeholderColor,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
      })
    } else {
      const segments = this._segments()
      for (const segment of segments) {
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
        const display = active && !this._inputFresh
          ? this._inputBuffer.padStart(2, '_')
          : this._hasTime
            ? String(this._parts[segment]).padStart(2, '0')
            : '--'
        dl.fillText(
          display,
          offset.x + rect.x,
          offset.y + fieldHeight / 2,
          active ? style.contrastText : this._hasTime ? textColor : placeholderColor,
          style.fontSize,
          style.fontFamily,
          'left',
          'middle',
        )
      }
      dl.fillText(
        ':',
        offset.x + rects.hour.x + rects.hour.w,
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
          offset.x + rects.minute.x + rects.minute.w,
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
    if (this._pointerActionAt(event.position) === 'clear') {
      event.preventActivation?.()
      this._beginPointerAction(event, 'clear')
      return
    }
    FocusManager.instance.setFocus(this)
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
      () => { if (shouldActivate) this._clearValue() },
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
    value: string
    precision: TimePrecision
    activeSegment: TimeSegment | null
    parts: TimeParts | null
  } {
    return {
      value: this.value,
      precision: this.precision,
      activeSegment: this._activeSegment,
      parts: this._hasTime ? { ...this._parts } : null,
    }
  }

  private _parseValue(): void {
    const parsed = parseTimeValue(this._value)
    if (!parsed) {
      this._parts = { hour: 0, minute: 0, second: 0 }
      this._hasTime = false
      return
    }
    this._parts = parsed
    if (this.precision === 'minute') this._parts.second = 0
    this._hasTime = true
  }

  private _pointerActionAt(position: Offset): 'clear' | null {
    if (!this._hitField(position)) return null
    const layout = this._fieldLayout(this.globalOffset, this._inputStyle())
    return pointInFormFieldRect(layout.clearRect, position) ? 'clear' : null
  }

  private _beginPointerAction(event: PointerEvent, action: 'clear'): void {
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

  private _commitActiveInput(): void {
    if (!this._activeSegment || this._inputFresh || this._inputBuffer === '') return
    this._commitSegment(this._activeSegment, Number(this._inputBuffer))
  }

  private _commitSegment(segment: TimeSegment, value: number): void {
    if (!Number.isFinite(value)) return
    if (!this._hasTime) {
      this._parts = { hour: 0, minute: 0, second: 0 }
      this._hasTime = true
    }
    const max = segment === 'hour' ? 23 : 59
    this._parts[segment] = Math.max(0, Math.min(max, Math.trunc(value)))
    this._emitValue('segment')
  }

  private _stepSegment(segment: TimeSegment, direction: 1 | -1): void {
    if (!this._hasTime) {
      this._parts = { hour: 0, minute: 0, second: 0 }
      this._hasTime = true
    }
    const amount = segment === 'hour'
      ? this.hourStep
      : segment === 'minute' ? this.minuteStep : this.secondStep
    this._parts = stepTimePart(this._parts, segment, direction, amount)
    this._inputBuffer = ''
    this._inputFresh = true
    this._emitValue('step', { direction, segment })
  }

  private _emitValue(
    reason: TimeEditValueChangeReason,
    detail?: TimeEditValueChangeDetail,
  ): void {
    if (this.precision === 'minute') this._parts.second = 0
    const next = formatTimeValue(this._parts, this.precision)
    const previousValue = this._value
    const changed = next !== previousValue
    this._value = next
    if (changed) {
      runCleanupSteps([
        () => this.onChange?.(next),
        () => this._valueEditorEvents.emitValueChange({
          value: next,
          previousValue,
          reason,
          detail,
        }),
        () => this.markNeedsPaint(),
      ])
      return
    }
    this.markNeedsPaint()
  }

  private _activateSegment(segment: TimeSegment): void {
    if (segment === 'second' && this.precision !== 'second') return
    this._activeSegment = segment
    this._inputBuffer = ''
    this._inputFresh = true
    this.markNeedsPaint()
  }

  private _advanceSegment(segment: TimeSegment): void {
    if (!this._moveSegment(segment, 1)) this._deactivate()
  }

  private _moveSegment(segment: TimeSegment, direction: 1 | -1): boolean {
    const segments = this._segments()
    const index = segments.indexOf(segment)
    const next = segments[index + direction]
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

  private _segments(): TimeSegment[] {
    return this.precision === 'second'
      ? ['hour', 'minute', 'second']
      : ['hour', 'minute']
  }

  private _segmentMetrics(style: TextInputStyleTokens): {
    digitWidth: number
    separatorWidth: number
  } {
    return {
      digitWidth: Math.max(style.fontSize * 0.56, TextMeasurer.measureWidth('0', style.fontSize, style.fontFamily)),
      separatorWidth: Math.max(4, TextMeasurer.measureWidth(':', style.fontSize, style.fontFamily)),
    }
  }

  private _segmentRects(style: TextInputStyleTokens): Record<TimeSegment, { x: number; w: number }> {
    const layout = this._fieldLayout({ x: 0, y: 0 }, style)
    const metrics = this._segmentMetrics(style)
    const width = metrics.digitWidth * 2
    const hour = { x: layout.valueRect.x, w: width }
    const minute = { x: hour.x + width + metrics.separatorWidth, w: width }
    const second = { x: minute.x + width + metrics.separatorWidth, w: width }
    return { hour, minute, second }
  }

  private _segmentAt(localX: number): TimeSegment | null {
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
    return this.clearable && !this.disabled && !this.readonly && this.value.length > 0
  }

  private _clearValue(): void {
    if (!this._showClearButton()) return
    const previousValue = this._value
    this._value = ''
    this._parseValue()
    this._deactivate()
    runCleanupSteps([
      () => this.onChange?.(''),
      () => this._valueEditorEvents.emitValueChange({
        value: '',
        previousValue,
        reason: 'clear',
      }),
    ])
  }

  private _widthHint(): number {
    return this.precision === 'second' ? 142 : 116
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

function defaultTimeEditPlaceholder(precision: TimePrecision): string {
  return precision === 'minute' ? 'HH:mm' : 'HH:mm:ss'
}

function positiveInteger(value: number | undefined): number {
  if (!Number.isFinite(value) || value! <= 0) return 1
  return Math.max(1, Math.trunc(value!))
}
