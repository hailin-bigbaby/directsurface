// NumberInput: 数字输入框
// 支持右侧上下步进按钮、min/max/step 约束、键盘输入、鼠标滚轮调节
// 编辑时支持光标定位、文字选中、鼠标拖选

import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import {
  paintSingleLineEditableText,
  resolveSingleLineTextOriginX,
} from '../rendering/single_line_text_renderer'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import type { PointerEvent, WheelPointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import type { GestureArenaMember } from '../gestures/gesture_arena'
import { PendingPointerGesture } from '../gestures/pending_pointer_gesture'
import { FocusManager, type Focusable } from '../core/focus_manager'
import { runCleanupSteps, type DisposeFn } from '../core/disposable'
import {
  resolveSingleLineEditableTextLayout,
  SingleLineTextInput,
} from '../core/single_line_text_input'
import { TextEditSession } from '../core/text_edit_session'
import { TextInputController } from '../core/text_input_controller'
import {
  deriveNumberStepperStyle,
  deriveTextInputStyle,
  type TextInputStyleTokens,
} from '../theme/component_styles'
import {
  layoutFormFieldInlineContent,
  measureFormFieldHeight,
  paintFormFieldInlineDecorations,
  paintFormFieldShell,
  resolveFormFieldBorderColor,
  resolveFormFieldState,
  resolveFormFieldTextColor,
  type FormFieldStatus,
} from './form_field_shell'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorBlurListener,
  type ValueEditorValueChangeListener,
} from './value_editor'
import {
  paintNumberStepper,
  resolveNumberStepperDirection,
  resolveNumberStepperWidth,
  type NumberStepperDirection,
} from './number_stepper'

const DRAG_SLOP = 4

export type NumberInputValueChangeReason = 'commit' | 'step'

export interface NumberInputValueChangeDetail {
  readonly direction: 1 | -1
}

export class RenderNumberInput extends RenderBox implements
  InteractiveRenderObject,
  Focusable,
  GestureArenaMember,
  ValueEditor<number, NumberInputValueChangeReason, NumberInputValueChangeDetail> {
  static override debugTypeName = 'RenderNumberInput'
  readonly preventsPointerActivationOnAccept = true
  private _value: number
  min: number
  max: number
  step: number
  decimals: number
  label: string
  onChange?: (value: number) => void
  private _disabled: boolean
  private _readonly: boolean
  private _status: FormFieldStatus
  private _helperText: string
  private _prefixText: string
  private _suffixText: string
  private _fieldWidth = 160

  private _focused = false
  private _hovered = false
  private _focusRegistered = false
  private _hoveredBtn: NumberStepperDirection | null = null
  private _pressedBtn: NumberStepperDirection | null = null
  private _editText = ''
  private _editing = false
  private _textInput = new TextInputController({ onInvalidate: () => this.markNeedsPaint() })
  private readonly _valueEditorEvents = new ValueEditorEventEmitter<
    number,
    NumberInputValueChangeReason,
    NumberInputValueChangeDetail
  >()
  private _singleLineInput = new SingleLineTextInput({
    controller: this._textInput,
    getDisplayText: () => this._editText,
    measureText: text => this._measureText(text),
    getViewportWidth: () => this._textAreaRect().w,
    getTextOrigin: () => ({
      x: this._textOriginX(this._editText),
      y: this.globalOffset.y + this._inputStyle().padding,
    }),
  })
  private _editSession = new TextEditSession({
    controller: this._textInput,
    isActive: () => this._editing,
    syncSelectionFromComposer: opts => this._textInput.syncSelectionFromComposer(opts),
    scrollToCursor: () => this._singleLineInput.scrollToCursor(),
    updateComposerPosition: () => this._singleLineInput.updateComposerPosition(),
    invalidate: () => this.markNeedsPaint(),
  })
  private _dragging = false
  private readonly _pendingGesture = new PendingPointerGesture()
  private _dragStartPosition?: Offset
  private _lastDragPosition?: Offset

  constructor(opts: {
    value?: number
    min?: number
    max?: number
    step?: number
    decimals?: number
    label?: string
    onChange?: (value: number) => void
    disabled?: boolean
    readonly?: boolean
    status?: FormFieldStatus
    helperText?: string
    prefixText?: string
    suffixText?: string
  }) {
    super()
    this.min = opts.min ?? -Infinity
    this.max = opts.max ?? Infinity
    this.step = opts.step ?? 1
    this.decimals = opts.decimals ?? 0
    this._value = this._normalizeValue(opts.value ?? 0)
    this.label = opts.label ?? ''
    this.onChange = opts.onChange
    this._disabled = opts.disabled ?? false
    this._readonly = opts.readonly ?? false
    this._status = opts.status ?? 'default'
    this._helperText = opts.helperText ?? ''
    this._prefixText = opts.prefixText ?? ''
    this._suffixText = opts.suffixText ?? ''
    this._syncFocusRegistration()
  }

  get value(): number { return this._value }
  set value(value: number) {
    const nextValue = this._normalizeValue(value)
    if (this._value === nextValue) return
    this._value = nextValue
    if (!this._editing) this._editText = this._formattedValue()
    this.markNeedsPaint()
  }

  getValue(): number {
    return this.value
  }

  setValue(value: number): void {
    const nextValue = this._normalizeValue(value)
    if (Object.is(this._value, nextValue)) return
    this.cancelEdit()
    this.value = nextValue
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<
      number,
      NumberInputValueChangeReason,
      NumberInputValueChangeDetail
    >,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: ValueEditorBlurListener): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
  }

  get disabled(): boolean { return this._disabled }
  set disabled(disabled: boolean) {
    if (this._disabled === disabled) return
    const wasFocused = this._focused
    this._disabled = disabled
    if (disabled) {
      let committed = true
      runCleanupSteps([
        () => {
          this._hovered = false
          this._hoveredBtn = null
          this._pressedBtn = null
        },
        () => { committed = this.commitEdit() },
        () => {
          if (!committed) this.cancelEdit()
          else if (this._focused) this._endEdit()
        },
        () => { if (wasFocused) this._valueEditorEvents.emitBlur() },
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
    if (this._readonly === readonly) return
    const wasFocused = this._focused
    this._readonly = readonly
    if (readonly) {
      runCleanupSteps([
        () => {
          this._hovered = false
          this._hoveredBtn = null
          this._pressedBtn = null
        },
        () => this.cancelEdit(),
        () => { if (wasFocused) this._valueEditorEvents.emitBlur() },
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
    if (this._status === status) return
    this._status = status
    this.markNeedsPaint()
  }

  get helperText(): string { return this._helperText }
  set helperText(helperText: string) {
    if (this._helperText === helperText) return
    this._helperText = helperText
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get prefixText(): string { return this._prefixText }
  set prefixText(prefixText: string) {
    if (this._prefixText === prefixText) return
    this._prefixText = prefixText
    this.markNeedsPaint()
  }

  get suffixText(): string { return this._suffixText }
  set suffixText(suffixText: string) {
    if (this._suffixText === suffixText) return
    this._suffixText = suffixText
    this.markNeedsPaint()
  }

  get btnWidth(): number {
    return deriveNumberStepperStyle(this.currentTheme).width
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  get isFocused(): boolean { return this._focused }
  focusIn(): void { this._startEdit() }
  focusOut(): void {
    if (!this._focused) return
    let committed = true
    runCleanupSteps([
      () => { committed = this.commitEdit() },
      () => {
        if (!committed) this._suspendEdit()
        else if (this._focused) this._endEdit()
      },
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

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const inputStyle = deriveTextInputStyle(context.theme)
    const labelWidth = this.label
      ? TextMeasurer.measureWidth(this.label, inputStyle.fontSize, inputStyle.fontFamily) + inputStyle.itemSpacing
      : 0
    const width = constraints.maxWidth === Infinity ? 160 + labelWidth : constraints.maxWidth
    const minimumFieldWidth = this.btnWidth + inputStyle.padding * 2 + 1
    this._fieldWidth = Math.min(width, Math.max(minimumFieldWidth, width - labelWidth))
    this.size = {
      width,
      height: measureFormFieldHeight(inputStyle, inputStyle.height, this.helperText),
    }
    if (this._editing && this._focused) {
      this._singleLineInput.scrollToCursor()
      this._singleLineInput.updateComposerPosition()
    }
  }

  private _clamp(v: number): number {
    return Math.max(this.min, Math.min(this.max, v))
  }

  private _round(v: number): number {
    const factor = Math.pow(10, this.decimals)
    return Math.round(v * factor) / factor
  }

  private _normalizeValue(value: number): number {
    return this._clamp(this._round(value))
  }

  private _displayText(): string {
    if (this._editing) return this._editText
    return this._formattedValue()
  }

  private _formattedValue(): string {
    return this._round(this.value).toFixed(this.decimals)
  }

  // 文字区域的起始 x（全局坐标）和宽度
  private _textAreaRect(): { x: number; w: number } {
    const g = this.globalOffset
    const bw = this._stepperWidth()
    const inputStyle = this._inputStyle()
    const layout = layoutFormFieldInlineContent(inputStyle, g, this._fieldWidth - bw, inputStyle.height, {
      prefixText: this.prefixText,
      suffixText: this.suffixText,
    })
    return { x: layout.valueRect.x, w: layout.valueRect.w }
  }

  private _measureText(text: string): number {
    const inputStyle = this._inputStyle()
    return TextMeasurer.measureWidth(text, inputStyle.fontSize, inputStyle.fontFamily)
  }

  private _textOriginX(text: string): number {
    const rect = this._textAreaRect()
    return resolveSingleLineTextOriginX({
      contentX: rect.x,
      contentWidth: rect.w,
      textWidth: resolveSingleLineEditableTextLayout({
        controller: this._textInput,
        displayText: text,
        measureText: value => this._measureText(value),
      }).totalWidth,
      align: 'right',
    })
  }

  private _stepperWidth(): number {
    return resolveNumberStepperWidth(this._fieldWidth, this.btnWidth)
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const { x, y } = offset
    const w = this._fieldWidth
    const s = deriveTextInputStyle(context.theme)
    const stepper = deriveNumberStepperStyle(context.theme)
    const bw = resolveNumberStepperWidth(w, stepper.width)
    const fieldHeight = s.height
    const textColor = resolveFormFieldTextColor(s, this.disabled)
    paintFormFieldShell(context, offset, w, fieldHeight, {
      focused: this._focused,
      hovered: this._hovered,
      disabled: this.disabled,
      status: this.status,
      helperText: this.helperText,
    })

    // 数值文字区域
    const middleLayout = layoutFormFieldInlineContent(s, { x, y }, w - bw, fieldHeight, {
      prefixText: this.prefixText,
      suffixText: this.suffixText,
    })
    paintFormFieldInlineDecorations(context, middleLayout, {
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      disabled: this.disabled,
    })
    const taX = middleLayout.valueRect.x
    const taW = middleLayout.valueRect.w
    dl.pushClip(taX, y, taW, fieldHeight)

    const displayText = this._displayText()

    if (this._editing && this._focused) {
      const textX = resolveSingleLineTextOriginX({
        contentX: taX,
        contentWidth: taW,
        textWidth: resolveSingleLineEditableTextLayout({
          controller: this._textInput,
          displayText,
          measureText: value => this._measureText(value),
        }).totalWidth,
        align: 'right',
      }) - this._textInput.scrollX
      paintSingleLineEditableText({
        dl,
        controller: this._textInput,
        displayText,
        measureText: text => this._measureText(text),
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
        textX,
        textY: y + fieldHeight / 2,
        lineTop: y + 4,
        lineBottom: y + fieldHeight - 4,
        textColor,
        selectionBg: s.selectionBg,
        caretColor: s.caretColor,
        compositionTextColor: s.compositionText,
        compositionUnderlineColor: s.focusedBorder,
      })
    } else {
      dl.fillText(displayText, taX + taW, y + fieldHeight / 2,
        textColor, s.fontSize, s.fontFamily, 'right', 'middle')
    }

    dl.popClip()

    paintNumberStepper(dl, {
      rect: { x: x + w - bw, y, w: bw, h: fieldHeight },
      tokens: stepper,
      hovered: this._hoveredBtn,
      pressed: this._pressedBtn,
      disabled: this.disabled,
    })

    const borderState = resolveFormFieldState({
      focused: this._focused,
      hovered: this._hovered,
      disabled: this.disabled,
    })
    dl.strokeRect(
      x,
      y,
      w,
      fieldHeight,
      resolveFormFieldBorderColor(s, borderState, this.status),
      borderState === 'focused' ? 1.5 : Math.max(1, s.borderWidth),
      s.borderRadius,
    )

    if (this.label) {
      const labelX = x + w + s.itemSpacing
      const labelWidth = Math.max(0, this.size.width - (labelX - x))
      if (labelWidth > 0) {
        dl.pushClip(labelX, y, labelWidth, fieldHeight)
        dl.fillText(this.label, labelX, y + fieldHeight / 2,
          this.disabled ? s.textDisabled : s.placeholderText, s.fontSize, s.fontFamily, 'left', 'middle')
        dl.popClip()
      }
    }
  }

  private _inputStyle(): TextInputStyleTokens {
    return deriveTextInputStyle(this.currentTheme)
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

  private _hitField(position: Offset): boolean {
    const g = this.globalOffset
    const fieldHeight = this._inputStyle().height
    return position.x >= g.x &&
      position.x <= g.x + this._fieldWidth &&
      position.y >= g.y &&
      position.y <= g.y + fieldHeight
  }

  // ---- 按钮区域判断 ----

  private _btnAt(p: Offset): NumberStepperDirection | null {
    const g = this.globalOffset
    return resolveNumberStepperDirection(p, {
      x: g.x,
      y: g.y,
      w: this._fieldWidth,
      h: this._inputStyle().height,
    }, this._stepperWidth())
  }

  private _inValueArea(p: Offset): boolean {
    const g = this.globalOffset
    const bw = this._stepperWidth()
    return p.x >= g.x && p.x < g.x + this._fieldWidth - bw &&
           p.y >= g.y && p.y <= g.y + this._inputStyle().height
  }

  // ---- 焦点 / 编辑 ----

  private _startEdit(): void {
    if (this.disabled || this.readonly) return
    if (this._focused && this._textInput.hasSession) return
    if (!this._editing) {
      this._editing = true
      this._editText = this._round(this.value).toFixed(this.decimals)
    }
    this._focused = true
    this._textInput.setScrollX(0)
    this._editSession.start({
      initialValue: this._editText,
      initialSelection: {
        start: this._editText.length,
        end: this._editText.length,
        cursorPos: this._editText.length,
      },
      refreshOnStart: true,
      onInput: (value, session) => {
        this._editText = value
        session.refresh({ syncSelectionFromComposer: true })
      },
      onCompositionUpdate: (_text, session) => {
        session.refresh({ resetBlink: true })
      },
      onCompositionEnd: (value, session) => {
        this._editText = value
        session.refresh({ syncSelectionFromComposer: true })
      },
      onKeyDown: (e, session) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          this.commitEdit()
          FocusManager.instance.dispatchUnhandledEnterFrom(this, e)
        }
        else if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit() }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this._step(1) }
        else if (e.key === 'ArrowDown') { e.preventDefault(); this._step(-1) }
        else {
          session.defer(() => {}, { syncSelectionFromComposer: true })
        }
      },
    })
  }

  commitEdit(): boolean {
    if (!this._editing) return true
    const parsed = parseFloat(this._editText)
    if (!isNaN(parsed)) {
      const previousValue = this.value
      this.value = this._clamp(this._round(parsed))
      runCleanupSteps([
        () => this._publishValueChange(previousValue, 'commit'),
        () => this._endEdit(),
      ])
      return true
    }
    return false
  }

  cancelEdit(): void {
    this._endEdit()
  }

  private _endEdit(): void {
    if (!this._editing && !this._focused) return
    this._editing = false
    this._focused = false
    this._dragging = false
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => {
        this._dragStartPosition = undefined
        this._lastDragPosition = undefined
      },
      () => this._textInput.setScrollX(0),
      () => this._editSession.end(),
      () => this.markNeedsPaint(),
    )
  }

  private _suspendEdit(): void {
    if (!this._focused) return
    this._focused = false
    this._dragging = false
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => {
        this._dragStartPosition = undefined
        this._lastDragPosition = undefined
      },
      () => this._textInput.setScrollX(0),
      () => this._editSession.end(),
      () => this.markNeedsPaint(),
    )
  }

  private _step(dir: 1 | -1): void {
    if (this.disabled || this.readonly) return
    const previousValue = this.value
    this.value = this._clamp(this._round(this.value + dir * this.step))
    if (this._editing) {
      const nextText = this._formattedValue()
      this._editText = nextText
      if (this._focused && this._textInput.hasSession) {
        if (this._textInput.composerValue !== nextText) {
          this._textInput.setComposerValue(nextText)
        }
        this._textInput.setSelection(nextText.length, nextText.length, {
          cursorPos: nextText.length,
          syncComposer: true,
        })
        this._editSession.refresh({
          resetBlink: true,
          syncSelectionFromComposer: false,
        })
      }
    }
    this._publishValueChange(previousValue, 'step', { direction: dir })
    this.markNeedsPaint()
  }

  private _publishValueChange(
    previousValue: number,
    reason: NumberInputValueChangeReason,
    detail?: NumberInputValueChangeDetail,
  ): void {
    const steps: DisposeFn[] = [
      () => this.onChange?.(this.value),
    ]
    if (!Object.is(previousValue, this.value)) {
      steps.push(() => this._valueEditorEvents.emitValueChange({
        value: this.value,
        previousValue,
        reason,
        detail,
      }))
    }
    runCleanupSteps(steps)
  }

  // ---- 指针事件 ----

  onPointerDown(e: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    if (!isPrimaryPointerButton(e)) return
    if (this.disabled || this.readonly) return
    if (!this._hitField(e.position)) {
      if (this._editing) this.commitEdit()
      return
    }
    const btn = this._btnAt(e.position)
    if (btn) {
      this._pressedBtn = btn
      this._step(btn === 'up' ? 1 : -1)
      return
    }
    if (this._inValueArea(e.position)) {
      FocusManager.instance.setFocus(this)
      this._editSession.focusComposer()

      if (this._editing) {
        // 已在编辑模式：点击定位光标
        const charIdx = this._singleLineInput.hitCharIndexFromGlobal(e.position.x)
        this._textInput.setSelection(charIdx, charIdx, { cursorPos: charIdx, syncComposer: false })
        if (e.joinGestureArena) {
          this._resetPendingGesture()
          this._dragStartPosition = e.position
          this._lastDragPosition = e.position
          this._pendingGesture.begin(e, this)
          this._dragging = false
        } else {
          this._dragging = true
        }
        this._textInput.setSelection(charIdx, charIdx, { cursorPos: charIdx, syncComposer: true })
        this._editSession.refresh({ resetBlink: true })
      }
    }
  }

  onDoubleClick(position: Offset): void {
    if (this.disabled || this.readonly || !this._inValueArea(position)) return

    FocusManager.instance.setFocus(this)
    this._editSession.focusComposer()
    this._dragging = false
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => {
        this._dragStartPosition = undefined
        this._lastDragPosition = undefined
      },
    )
    const range = this._singleLineInput.selectWordFromGlobal(position.x, {
      syncComposer: true,
    })
    if (!range) return
    this._editSession.refresh({
      scrollToCursor: false,
      updateComposerPosition: true,
      resetBlink: true,
    })
    this.markNeedsPaint()
  }

  onPointerMove(e: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    if (this.disabled || this.readonly) return
    const wasHovered = this._hovered
    this._hovered = this._hitField(e.position)
    const btn = this._hovered ? this._btnAt(e.position) : null
    if (btn !== this._hoveredBtn || wasHovered !== this._hovered) {
      this._hoveredBtn = btn
      this.markNeedsPaint()
    }

    if (this._pendingGesture.isPending && !this._dragging) {
      this._lastDragPosition = e.position
      this._resolveSelectionIntent(e.position)
    }

    // 拖选
    if (this._dragging && this._editing) {
      this._singleLineInput.setSelectionFromGlobal(e.position.x, {
        extend: true,
        syncComposer: true,
      })
      this._editSession.refresh()
    }
  }

  onPointerUp(e: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    if (!isPrimaryPointerButton(e)) return
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => { this._pressedBtn = null },
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
      () => {
        this._pressedBtn = null
        this._hoveredBtn = null
        this._hovered = false
      },
      () => {
        this._dragging = false
        this._dragStartPosition = undefined
        this._lastDragPosition = undefined
      },
      () => this.markNeedsPaint(),
    )
  }

  onPointerLeave(_e: PointerEvent): void {
    const hadHover = this._hovered || this._hoveredBtn !== null
    this._hovered = false
    this._hoveredBtn = null
    if (hadHover) this.markNeedsPaint()
  }

  acceptGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.accept(pointerId, pointerType)) return
    this._dragging = true
    if (this._lastDragPosition) this._updateDragSelection(this._lastDragPosition)
  }

  rejectGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.reject(pointerId, pointerType)) return
    this._dragging = false
    this._dragStartPosition = undefined
    this._lastDragPosition = undefined
  }

  private _resolveSelectionIntent(position: Offset): void {
    if (!this._pendingGesture.isPending || !this._dragStartPosition) return
    const dx = position.x - this._dragStartPosition.x
    const dy = position.y - this._dragStartPosition.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_SLOP) return
    this._pendingGesture.resolve(Math.abs(dx) >= Math.abs(dy) ? 'accepted' : 'rejected')
  }

  private _updateDragSelection(position: Offset): void {
    this._singleLineInput.setSelectionFromGlobal(position.x, {
      extend: true,
      syncComposer: true,
    })
    this._editSession.refresh()
  }

  private _resetPendingGesture(): void {
    this._pendingGesture.resetPending()
    this._dragStartPosition = undefined
    this._lastDragPosition = undefined
  }

  onWheel(e: WheelPointerEvent): void {
    if (this.disabled || this.readonly || !this._hitField(e.position) || e.deltaY === 0) return
    this._step(e.deltaY < 0 ? 1 : -1)
  }

  dispose(): void {
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => this._endEdit(),
      () => this._textInput.dispose(),
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
}
