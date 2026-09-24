import {
  GET_POPUP_ANCHOR_RECT,
  resolvePopupAnchorRect,
  resolvePopupAnchorTarget,
  type PopupAnchor,
  type PopupAnchorTarget,
} from '../core/popup_anchor'
import { runCleanupSteps, type DisposeFn } from '../core/disposable'
import { FocusManager, type Focusable } from '../core/focus_manager'
import {
  PopupManager,
  clampXToPopupViewport,
  type Popup,
  type PopupContext,
} from '../core/popup_manager'
import { PopupRenderNode } from '../core/popup_render_surface'
import { PopupSurfaceShell } from '../core/popup_shell'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import type { InteractiveRenderObject, PointerEvent } from '../gestures/recognizers'
import type { GestureArenaMember } from '../gestures/gesture_arena'
import { PendingPointerGesture } from '../gestures/pending_pointer_gesture'
import {
  isPrimaryPointerButton,
  type PointerEvent as PopupPointerEvent,
  type WheelPointerEvent,
} from '../gestures/hit_test'
import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { drawPopupPanel } from '../rendering/popup_painter'
import { paintSingleLineText } from '../rendering/text_painter'
import {
  deriveDatePickerStyle,
  derivePopupStyle,
  deriveTextInputStyle,
  resolveBgColor,
  type DatePickerStyleTokens,
  type PopupStyleTokens,
} from '../theme/component_styles'
import {
  layoutFormFieldInlineContent,
  measureFormFieldHeight,
  pointInFormFieldRect,
  resolveFormFieldPlaceholderColor,
  resolveFormFieldTextColor,
  type FormFieldStatus,
} from './form_field_shell'
import { paintTriggerFieldShell } from './trigger_field_shell'
import { TimeSelectionPanel } from './time_selection_panel'
import {
  formatTimeValue,
  normalizeTimeValue,
  type TimeParts,
  type TimePrecision,
} from './time_value'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorBlurListener,
  type ValueEditorValueChangeListener,
} from './value_editor'

export interface TimePickerOptions extends RenderBoxOptions {
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

export type TimePickerValueChangeReason =
  | 'selection'
  | 'clear'
  | 'precision-reconcile'

export type TimePickerValueChangeDetail =
  | { readonly precision: TimePrecision }
  | undefined

type TimePickerFooterButton = 'now' | 'clear' | 'ok' | 'cancel'

export type TimePickerPopupSubmitResult = boolean | string | void

const TIME_PICKER_POPUP_MIN_WIDTH = 220

export class TimePickerPopup extends PopupSurfaceShell implements Popup {
  private _anchor?: PopupAnchor
  private readonly _panel: TimeSelectionPanel
  private _precision: TimePrecision = 'second'
  private _clearable = false
  private _validationMessage = ''
  private _hoveredFooter: TimePickerFooterButton | null = null
  private _validate?: (value: string) => string
  private _onSelect?: (value: string) => TimePickerPopupSubmitResult
  private _onClose?: () => void

  constructor() {
    super()
    this._panel = new TimeSelectionPanel({
      invalidate: () => this.requestPopupPaint(),
    })
    this.setPopupSurfaceRoot(new PopupRenderNode({
      paint: (_node, context, offset) => this._paintSurface(context, offset),
      onPointerDown: (_node, event) => this._handleSurfacePointerDown(event),
      onPointerMove: (_node, event) => this._handleSurfacePointerMove(event),
      onPointerLeave: () => this._clearHover(),
      onPointerCancel: () => this._clearHover(),
      onWheel: (_node, event) => this._handleSurfaceWheel(event),
    }))
    this.setPopupSurfaceSync((root, popupContext) => {
      const layout = this._layout(popupContext)
      root.offset = { x: layout.panelX, y: layout.panelY }
      root.layout({
        minWidth: layout.panelW,
        maxWidth: layout.panelW,
        minHeight: layout.panelH,
        maxHeight: layout.panelH,
      }, false, { theme: popupContext.theme })
    })
  }

  open(options: {
    anchor: PopupAnchor
    value: string
    precision: TimePrecision
    hourStep: number
    minuteStep: number
    secondStep: number
    clearable?: boolean
    validate?: (value: string) => string
    onSelect: (value: string) => TimePickerPopupSubmitResult
    onClose: () => void
  }): void {
    if (this.popupOpen) this.close()
    this._anchor = options.anchor
    this._precision = options.precision
    this._clearable = options.clearable ?? false
    this._validationMessage = ''
    this._panel.configure({
      precision: options.precision,
      hourStep: options.hourStep,
      minuteStep: options.minuteStep,
      secondStep: options.secondStep,
    })
    this._panel.reset(options.value, currentTime(), true)
    this._hoveredFooter = null
    this._validate = options.validate
    this._onSelect = options.onSelect
    this._onClose = options.onClose
    this.resetPopupSurface()
    this.openPopup({ owner: resolvePopupAnchorTarget(options.anchor) })
  }

  syncValue(value: string): void {
    this._panel.reset(value, currentTime(), true)
    this._validationMessage = ''
    if (this.visible) this.requestPopupPaint()
  }

  syncConfiguration(options: {
    precision?: TimePrecision
    hourStep?: number
    minuteStep?: number
    secondStep?: number
  }): void {
    if (options.precision !== undefined) this._precision = options.precision
    this._panel.configure(options)
    if (this.visible) this.requestPopupPaint()
  }

  commitSelection(): boolean {
    if (!this.visible) return true
    this._panel.commitPending()
    const value = this._panel.value || formatTimeValue(currentTime(), this._precision)
    return this._submit(value)
  }

  clearSelection(): boolean {
    if (!this.visible || !this._clearable) return false
    return this._submit('')
  }

  private _submit(value: string): boolean {
    const validationMessage = this._validate?.(value) ?? ''
    if (validationMessage) {
      this._validationMessage = validationMessage
      this.requestPopupPaint()
      return false
    }
    const outcome: { result: TimePickerPopupSubmitResult } = { result: undefined }
    runCleanupSteps([
      () => { outcome.result = this._onSelect?.(value) },
      () => {
        if (typeof outcome.result === 'string') {
          this._validationMessage = outcome.result
          this.requestPopupPaint()
        } else if (outcome.result === false) {
          this.requestPopupPaint()
        } else {
          this._validationMessage = ''
          this.close()
        }
      },
    ])
    return outcome.result !== false && typeof outcome.result !== 'string'
  }

  debugState(): {
    panelX: number
    panelY: number
    panelW: number
    panelH: number
    value: string
    clearable: boolean
    validationMessage: string
    panel: ReturnType<TimeSelectionPanel['debugState']>
  } {
    const layout = this._layout(PopupManager.instance.context)
    return {
      panelX: layout.panelX,
      panelY: layout.panelY,
      panelW: layout.panelW,
      panelH: layout.panelH,
      value: this._panel.value,
      clearable: this._clearable,
      validationMessage: this._validationMessage,
      panel: this._panel.debugState(),
    }
  }

  onOutsidePointerDown(event: PopupPointerEvent): boolean {
    const anchor = resolvePopupAnchorRect(this._anchor)
    if (
      event.position.x < anchor.x ||
      event.position.x > anchor.x + anchor.w ||
      event.position.y < anchor.y ||
      event.position.y > anchor.y + anchor.h
    ) return false
    this.close()
    return true
  }

  onEscape(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    event.preventDefault()
    this.close()
    return true
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      this.commitSelection()
      return true
    }
    const handled = this._panel.handleKeyDown(event)
    if (handled) this._validationMessage = ''
    if (event.key === 'Tab' && !handled) this.close()
    return handled
  }

  protected override onPopupClose(): void {
    super.onPopupClose()
    this._onClose?.()
  }

  dispose(): void {
    this.close()
    this.disposePopupSurface()
  }

  private _handleSurfacePointerDown(
    event: PopupPointerEvent,
    popupContext: PopupContext = PopupManager.instance.context,
  ): void {
    const layout = this._layout(popupContext)
    const footer = this._footerButtonAt(event.position, layout)
    if (footer === 'now') {
      this._validationMessage = ''
      this._panel.reset(formatTimeValue(currentTime(), this._precision), currentTime())
      return
    }
    if (footer === 'clear') {
      this.clearSelection()
      return
    }
    if (footer === 'ok') {
      this.commitSelection()
      return
    }
    if (footer === 'cancel') {
      this.close()
      return
    }
    this._validationMessage = ''
    this._panel.handlePointerDown(event.position, this._panelRect(layout), layout.style)
  }

  private _handleSurfacePointerMove(
    event: PopupPointerEvent,
    popupContext: PopupContext = PopupManager.instance.context,
  ): void {
    const layout = this._layout(popupContext)
    const footer = this._footerButtonAt(event.position, layout)
    const changed = footer !== this._hoveredFooter
    this._hoveredFooter = footer
    const panelChanged = this._panel.handlePointerMove(
      event.position,
      this._panelRect(layout),
      layout.style,
    )
    if (changed || panelChanged) this.requestPopupPaint()
  }

  private _handleSurfaceWheel(
    event: WheelPointerEvent,
    popupContext: PopupContext = PopupManager.instance.context,
  ): boolean {
    const layout = this._layout(popupContext)
    const handled = this._panel.handleWheel(event, this._panelRect(layout), layout.style)
    if (handled) this._validationMessage = ''
    return handled
  }

  private _clearHover(): void {
    const changed = this._hoveredFooter !== null || this._panel.clearHover()
    this._hoveredFooter = null
    if (changed) this.requestPopupPaint()
  }

  private _layout(popupContext: PopupContext): {
    style: DatePickerStyleTokens
    popupStyle: PopupStyleTokens
    panelX: number
    panelY: number
    panelW: number
    panelH: number
    previewHeight: number
    contentHeight: number
    footerHeight: number
  } {
    const style = deriveDatePickerStyle(popupContext.theme)
    const popupStyle = derivePopupStyle(popupContext.theme)
    const panelW = Math.max(
      TimeSelectionPanel.minimumWidth(style, this._precision),
      TIME_PICKER_POPUP_MIN_WIDTH,
    )
    const previewHeight = style.headerHeight
    const contentHeight = previewHeight + TimeSelectionPanel.height(style)
    const footerHeight = style.footerHeight
    const panelH = contentHeight + footerHeight
    const anchor = resolvePopupAnchorRect(this._anchor)
    const panelX = clampXToPopupViewport(anchor.x, panelW, popupContext, 4)
    let panelY = anchor.y + anchor.h + 4
    const viewportBottom = (popupContext.viewport.y ?? 0) + popupContext.viewport.height
    if (panelY + panelH > viewportBottom - 4) panelY = anchor.y - panelH - 4
    panelY = Math.max((popupContext.viewport.y ?? 0) + 4, panelY)
    return {
      style,
      popupStyle,
      panelX,
      panelY,
      panelW,
      panelH,
      previewHeight,
      contentHeight,
      footerHeight,
    }
  }

  private _panelRect(layout: ReturnType<TimePickerPopup['_layout']>) {
    return {
      x: layout.panelX,
      y: layout.panelY + layout.previewHeight,
      width: layout.panelW,
    }
  }

  private _footerButtonAt(
    point: Offset,
    layout: ReturnType<TimePickerPopup['_layout']>,
  ): TimePickerFooterButton | null {
    const top = layout.panelY + layout.contentHeight
    const left = layout.panelX + layout.style.padding
    const width = layout.panelW - layout.style.padding * 2
    if (
      point.x < left || point.x > left + width ||
      point.y < top || point.y > top + layout.footerHeight
    ) return null
    const buttons = this._footerButtons()
    const index = Math.min(buttons.length - 1, Math.floor((point.x - left) / (width / buttons.length)))
    return buttons[index]!.key
  }

  private _paintSurface(context: PaintContext, offset: Offset): void {
    const layout = this._layout(PopupManager.instance.context)
    const dl = new DrawList(context)
    const x = offset.x
    const y = offset.y
    drawPopupPanel(dl, x, y, layout.panelW, layout.panelH, layout.popupStyle)
    const inputStyle = deriveTextInputStyle(PopupManager.instance.context.theme)
    const hasValidationMessage = this._validationMessage.length > 0
    paintSingleLineText(dl, {
      text: this._validationMessage || '待确认',
      x: x + layout.style.padding,
      y: y + layout.previewHeight / 2,
      maxWidth: hasValidationMessage
        ? layout.panelW - layout.style.padding * 2
        : layout.panelW * 0.58 - layout.style.padding,
      color: hasValidationMessage ? inputStyle.errorText : layout.style.weekendText,
      fontSize: layout.style.weekLabelFontSize,
      fontFamily: layout.style.fontFamily,
    })
    if (!hasValidationMessage) {
      paintSingleLineText(dl, {
        text: this._panel.value,
        x: x + layout.panelW - layout.style.padding,
        y: y + layout.previewHeight / 2,
        maxWidth: layout.panelW * 0.38,
        color: layout.style.accentText,
        fontSize: layout.style.fontSize,
        fontFamily: layout.style.fontFamily,
        align: 'right',
      })
    }
    dl.line(
      x + layout.style.padding,
      y + layout.previewHeight,
      x + layout.panelW - layout.style.padding,
      y + layout.previewHeight,
      layout.style.separator,
      1,
    )
    this._panel.paint(
      context,
      dl,
      { x, y: y + layout.previewHeight, width: layout.panelW },
      layout.style,
      layout.popupStyle,
    )

    const footerY = y + layout.contentHeight
    dl.line(
      x + layout.style.padding,
      footerY,
      x + layout.panelW - layout.style.padding,
      footerY,
      layout.style.separator,
      1,
    )
    const buttons = this._footerButtons()
    const buttonWidth = (layout.panelW - layout.style.padding * 2) / buttons.length
    for (let index = 0; index < buttons.length; index++) {
      const button = buttons[index]!
      const buttonX = x + layout.style.padding + index * buttonWidth
      if (this._hoveredFooter === button.key) {
        dl.fillRect(
          buttonX + 2,
          footerY + layout.style.padding / 2,
          buttonWidth - 4,
          layout.footerHeight - layout.style.padding,
          resolveBgColor(layout.style.footerButtonBg, 'hovered'),
          layout.popupStyle.borderRadius,
        )
      }
      dl.fillText(
        button.label,
        buttonX + buttonWidth / 2,
        footerY + layout.footerHeight / 2,
        button.key === 'ok'
          ? layout.style.accentText
          : button.key === 'cancel' ? layout.style.textDisabled : layout.style.text,
        layout.style.fontSize,
        layout.style.fontFamily,
        'center',
        'middle',
      )
    }
  }

  private _footerButtons(): Array<{ key: TimePickerFooterButton; label: string }> {
    return [
      { key: 'now', label: '现在' },
      ...(this._clearable ? [{ key: 'clear' as const, label: '清空' }] : []),
      { key: 'ok', label: '确定' },
      { key: 'cancel', label: '取消' },
    ]
  }
}

export class RenderTimePicker extends RenderBox implements
  InteractiveRenderObject,
  Focusable,
  GestureArenaMember,
  ValueEditor<string, TimePickerValueChangeReason, TimePickerValueChangeDetail> {
  static override debugTypeName = 'RenderTimePicker'

  private _value: string
  private _precision: TimePrecision
  private _hourStep: number
  private _minuteStep: number
  private _secondStep: number
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
    TimePickerValueChangeReason,
    TimePickerValueChangeDetail
  >()
  private readonly _pendingGesture = new PendingPointerGesture()
  private _pressedPointerAction: 'clear' | null = null
  private readonly _popup = new TimePickerPopup()
  private _placeholder: string
  private _usesDefaultPlaceholder: boolean

  onChange?: (value: string) => void

  constructor(options: TimePickerOptions = {}) {
    super(options)
    this._precision = options.precision ?? 'second'
    this._value = normalizeTimeValue(options.value ?? '', this._precision) ?? ''
    this._usesDefaultPlaceholder = options.placeholder === undefined
    this._placeholder = options.placeholder ?? defaultTimePickerPlaceholder(this._precision)
    this._hourStep = positiveInteger(options.hourStep)
    this._minuteStep = positiveInteger(options.minuteStep)
    this._secondStep = positiveInteger(options.secondStep)
    this.onChange = options.onChange
    this._disabled = options.disabled ?? false
    this._readonly = options.readonly ?? false
    this._status = options.status ?? 'default'
    this._helperText = options.helperText ?? ''
    this._prefixText = options.prefixText ?? ''
    this._suffixText = options.suffixText ?? ''
    this._clearable = options.clearable ?? false
    this._syncFocusRegistration()
  }

  get value(): string { return this._value }
  set value(value: string) {
    const normalized = normalizeTimeValue(value, this.precision) ?? ''
    if (normalized === this._value) return
    this._value = normalized
    if (this._popup.visible) this._popup.syncValue(normalized)
    this.markNeedsPaint()
  }

  getValue(): string { return this.value }
  setValue(value: string): void {
    const normalized = normalizeTimeValue(value, this.precision) ?? ''
    if (normalized === this._value) return
    this.cancelEdit()
    this.value = normalized
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<
      string,
      TimePickerValueChangeReason,
      TimePickerValueChangeDetail
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
  set precision(value: TimePrecision) {
    if (value === this._precision) return
    const previousValue = this._value
    this._precision = value
    if (this._usesDefaultPlaceholder) {
      this._placeholder = defaultTimePickerPlaceholder(value)
    }
    this._value = normalizeTimeValue(previousValue, value) ?? ''
    if (this._popup.visible) {
      this._popup.syncConfiguration({
        precision: value,
        hourStep: this.hourStep,
        minuteStep: this.minuteStep,
        secondStep: this.secondStep,
      })
      this._popup.syncValue(this._value)
    }
    this.markNeedsLayout()
    this.markNeedsPaint()
    if (this._value !== previousValue) {
      this._valueEditorEvents.emitValueChange({
        value: this._value,
        previousValue,
        reason: 'precision-reconcile',
        detail: { precision: value },
        userInitiated: false,
      })
    }
  }

  get hourStep(): number { return this._hourStep }
  set hourStep(value: number) {
    const normalized = positiveInteger(value)
    if (normalized === this._hourStep) return
    this._hourStep = normalized
    if (this._popup.visible) this._popup.syncConfiguration({ hourStep: normalized })
  }

  get minuteStep(): number { return this._minuteStep }
  set minuteStep(value: number) {
    const normalized = positiveInteger(value)
    if (normalized === this._minuteStep) return
    this._minuteStep = normalized
    if (this._popup.visible) this._popup.syncConfiguration({ minuteStep: normalized })
  }

  get secondStep(): number { return this._secondStep }
  set secondStep(value: number) {
    const normalized = positiveInteger(value)
    if (normalized === this._secondStep) return
    this._secondStep = normalized
    if (this._popup.visible) this._popup.syncConfiguration({ secondStep: normalized })
  }

  get disabled(): boolean { return this._disabled }
  set disabled(value: boolean) {
    if (value === this._disabled) return
    this._disabled = value
    if (value) this._disableOrReadonly()
    else {
      this._syncFocusRegistration()
      this.markNeedsPaint()
    }
  }

  get readonly(): boolean { return this._readonly }
  set readonly(value: boolean) {
    if (value === this._readonly) return
    this._readonly = value
    if (value) this._disableOrReadonly()
    else {
      this._syncFocusRegistration()
      this.markNeedsPaint()
    }
  }

  get status(): FormFieldStatus { return this._status }
  set status(value: FormFieldStatus) {
    if (value === this._status) return
    this._status = value
    this.markNeedsPaint()
  }

  get helperText(): string { return this._helperText }
  set helperText(value: string) {
    if (value === this._helperText) return
    this._helperText = value
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get prefixText(): string { return this._prefixText }
  set prefixText(value: string) {
    if (value === this._prefixText) return
    this._prefixText = value
    this.markNeedsPaint()
  }

  get suffixText(): string { return this._suffixText }
  set suffixText(value: string) {
    if (value === this._suffixText) return
    this._suffixText = value
    this.markNeedsPaint()
  }

  get clearable(): boolean { return this._clearable }
  set clearable(value: boolean) {
    if (value === this._clearable) return
    this._clearable = value
    if (!value && this._pressedPointerAction === 'clear') this._cancelPointerAction()
    this.markNeedsPaint()
  }

  get isFocused(): boolean { return this._focused || this._popup.visible }

  focusIn(): void {
    if (this.disabled || this.readonly || this._focused) return
    this._focused = true
    this.markNeedsPaint()
  }

  focusOut(): void {
    if (!this._focused) return
    const movingIntoOwnedPopup = this._popup.visible
    this._focused = false
    this.markNeedsPaint()
    if (!movingIntoOwnedPopup) this._valueEditorEvents.emitBlur()
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
    this.cancelEdit()
    FocusManager.instance.clearFocusOf(this)
  }

  commitEdit(): boolean { return this._popup.commitSelection() }
  cancelEdit(): void { this._popup.close() }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.disabled || this.readonly) return false
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault()
      this._togglePopup()
      return true
    }
    if (event.key === 'Escape' && this._popup.visible) {
      event.preventDefault()
      this._popup.close()
      return true
    }
    return false
  }

  [GET_POPUP_ANCHOR_RECT](): { x: number; y: number; width: number; height: number } {
    const offset = this.globalOffset
    return { x: offset.x, y: offset.y, width: this.size.width, height: this._inputStyle().height }
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveTextInputStyle(context.theme)
    this.size = {
      width: constraints.maxWidth === Infinity ? this._widthHint() : constraints.maxWidth,
      height: measureFormFieldHeight(style, style.height, this.helperText),
    }
  }

  override getMinLayoutWidthHint(): number | undefined { return this._widthHint() }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const style = deriveTextInputStyle(context.theme)
    const readonlyVisual = this.readonly && !this.disabled
    const shell = paintTriggerFieldShell(context, offset, this.size.width, {
      focused: readonlyVisual ? false : this.isFocused,
      hovered: readonlyVisual ? false : this._hovered,
      disabled: this.disabled,
      status: this.status,
      helperText: this.helperText,
      leadingIcon: 'clock',
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      showClearButton: this._showClearButton(),
      reserveTrailingWidth: style.fontSize,
      trailingIcon: this._popup.visible ? 'chevron-up' : 'chevron-down',
      trailingIconColor: this.disabled || readonlyVisual ? style.textDisabled : style.text,
    })
    if (shell.valueRect.w > 0) {
      paintSingleLineText(dl, {
        text: this.value || this.placeholder,
        x: shell.valueRect.x,
        y: offset.y + shell.fieldHeight / 2,
        maxWidth: shell.valueRect.w,
        color: this.value
          ? resolveFormFieldTextColor(style, this.disabled)
          : resolveFormFieldPlaceholderColor(style, this.disabled),
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
      })
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    if (!isPrimaryPointerButton(event)) return
    if (this.disabled || this.readonly || !this._hitField(event.position)) return
    if (this._pointerActionAt(event.position) === 'clear') {
      event.preventActivation?.()
      this._beginPointerAction(event)
      return
    }
    FocusManager.instance.setFocus(this)
    this._togglePopup()
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
    if (this._pressedPointerAction !== 'clear') return
    const shouldActivate = !this.disabled && !this.readonly && this._pointerActionAt(event.position) === 'clear'
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
    this._pressedPointerAction = null
    this.markNeedsPaint()
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
      () => this._popup.dispose(),
      () => this._valueEditorEvents.dispose(),
      () => super.dispose(),
    )
  }

  debugState(): {
    value: string
    precision: TimePrecision
    popupVisible: boolean
    popup: ReturnType<TimePickerPopup['debugState']> | null
  } {
    return {
      value: this.value,
      precision: this.precision,
      popupVisible: this._popup.visible,
      popup: this._popup.visible ? this._popup.debugState() : null,
    }
  }

  private _togglePopup(): void {
    if (this._popup.visible) {
      this._popup.close()
      this.markNeedsPaint()
      return
    }
    this._popup.open({
      anchor: this as PopupAnchorTarget,
      value: this._value,
      precision: this.precision,
      hourStep: this.hourStep,
      minuteStep: this.minuteStep,
      secondStep: this.secondStep,
      onSelect: value => {
        this._setValue(value, 'selection')
        return true
      },
      onClose: () => this.markNeedsPaint(),
    })
    this.markNeedsPaint()
  }

  private _setValue(value: string, reason: TimePickerValueChangeReason): void {
    const normalized = normalizeTimeValue(value, this.precision) ?? ''
    const previousValue = this._value
    if (normalized === previousValue) return
    this._value = normalized
    runCleanupSteps([
      () => this.onChange?.(normalized),
      () => this._valueEditorEvents.emitValueChange({
        value: normalized,
        previousValue,
        reason,
      }),
      () => this.markNeedsPaint(),
    ])
  }

  private _clearValue(): void {
    if (!this._showClearButton()) return
    this._popup.close()
    this._setValue('', 'clear')
  }

  private _pointerActionAt(position: Offset): 'clear' | null {
    if (!this._hitField(position)) return null
    const style = this._inputStyle()
    const layout = layoutFormFieldInlineContent(
      style,
      this.globalOffset,
      this.size.width,
      style.height,
      {
        leadingIcon: 'clock',
        prefixText: this.prefixText,
        suffixText: this.suffixText,
        showClearButton: this._showClearButton(),
        reserveTrailingWidth: style.fontSize,
      },
    )
    return pointInFormFieldRect(layout.clearRect, position) ? 'clear' : null
  }

  private _beginPointerAction(event: PointerEvent): void {
    this._cancelPointerAction()
    this._pressedPointerAction = 'clear'
    this._pendingGesture.begin(event, this, { captureOnAccept: false })
    this.markNeedsPaint()
  }

  private _cancelPointerAction(): void {
    const hadAction = this._pressedPointerAction !== null
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => { this._pressedPointerAction = null },
      () => { if (hadAction) this.markNeedsPaint() },
    )
  }

  private _showClearButton(): boolean {
    return this.clearable && !this.disabled && !this.readonly && this.value.length > 0
  }

  private _disableOrReadonly(): void {
    runCleanupSteps([
      () => {
        this._hovered = false
        this._cancelPointerAction()
      },
      () => {
        const wasFocused = this.isFocused
        this._popup.close()
        this._focused = false
        if (wasFocused) this._valueEditorEvents.emitBlur()
      },
      () => this._syncFocusRegistration(),
      () => this.markNeedsPaint(),
    ])
  }

  private _widthHint(): number { return this.precision === 'second' ? 172 : 146 }
  private _inputStyle() { return deriveTextInputStyle(this.currentTheme) }

  private _hitField(position: Offset): boolean {
    const offset = this.globalOffset
    const fieldHeight = this._inputStyle().height
    return position.x >= offset.x && position.x <= offset.x + this.size.width &&
      position.y >= offset.y && position.y <= offset.y + fieldHeight
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

function currentTime(): TimeParts {
  const now = new Date()
  return { hour: now.getHours(), minute: now.getMinutes(), second: now.getSeconds() }
}

function defaultTimePickerPlaceholder(precision: TimePrecision): string {
  return precision === 'minute' ? '选择时间 HH:mm' : '选择时间 HH:mm:ss'
}

function positiveInteger(value: number | undefined): number {
  if (!Number.isFinite(value) || value! <= 0) return 1
  return Math.max(1, Math.trunc(value!))
}
