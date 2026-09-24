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
  parseTimeValue,
  timeValueToSeconds,
  type TimeParts,
  type TimePrecision,
} from './time_value'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorBlurListener,
  type ValueEditorValueChangeListener,
} from './value_editor'

export interface TimeRangeValue {
  start: string | null
  end: string | null
}

export interface TimeRangeEditOptions extends RenderBoxOptions {
  value?: TimeRangeValue
  precision?: TimePrecision
  placeholder?: string
  separator?: string
  hourStep?: number
  minuteStep?: number
  secondStep?: number
  allowOvernight?: boolean
  onChange?: (value: TimeRangeValue) => void
  disabled?: boolean
  readonly?: boolean
  status?: FormFieldStatus
  helperText?: string
  prefixText?: string
  suffixText?: string
  clearable?: boolean
}

export type TimeRangeEditValueChangeReason =
  | 'selection'
  | 'clear'
  | 'precision-reconcile'

export type TimeRangeEditValueChangeDetail =
  | { readonly complete: boolean; readonly overnight: boolean }
  | { readonly precision: TimePrecision }

type TimeRangeFooterButton = 'now' | 'ok' | 'cancel'

export class TimeRangePickerPopup extends PopupSurfaceShell implements Popup {
  private _anchor?: PopupAnchor
  private readonly _panels: readonly [TimeSelectionPanel, TimeSelectionPanel]
  private _precision: TimePrecision = 'second'
  private _allowOvernight = false
  private _activePanel: 0 | 1 = 0
  private _hoveredFooter: TimeRangeFooterButton | null = null
  private _validationError: 'incomplete' | 'order' | null = null
  private _onSelect?: (value: TimeRangeValue) => boolean | void
  private _onClose?: () => void

  constructor() {
    super()
    const invalidate = () => {
      this._validationError = null
      this.requestPopupPaint()
    }
    this._panels = [
      new TimeSelectionPanel({ invalidate }),
      new TimeSelectionPanel({ invalidate }),
    ]
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
    value: TimeRangeValue
    precision: TimePrecision
    hourStep: number
    minuteStep: number
    secondStep: number
    allowOvernight: boolean
    onSelect: (value: TimeRangeValue) => boolean | void
    onClose: () => void
  }): void {
    if (this.popupOpen) this.close()
    const normalized = normalizeTimeRangeValue(options.value, options.precision)
    const now = currentTime()
    const startFallback = parseTimeValue(normalized.start) ?? now
    const later = defaultEndTime(startFallback, options.allowOvernight)
    this._anchor = options.anchor
    this._precision = options.precision
    this._allowOvernight = options.allowOvernight
    for (const panel of this._panels) {
      panel.configure({
        precision: options.precision,
        hourStep: options.hourStep,
        minuteStep: options.minuteStep,
        secondStep: options.secondStep,
      })
    }
    this._panels[0].reset(normalized.start ?? '', now, true)
    this._panels[1].reset(normalized.end ?? '', later, true)
    this._activePanel = 0
    this._hoveredFooter = null
    this._validationError = null
    this._onSelect = options.onSelect
    this._onClose = options.onClose
    this.resetPopupSurface()
    this.openPopup({ owner: resolvePopupAnchorTarget(options.anchor) })
  }

  syncValue(value: TimeRangeValue): void {
    const normalized = normalizeTimeRangeValue(value, this._precision)
    const now = currentTime()
    const startFallback = parseTimeValue(normalized.start) ?? now
    this._panels[0].reset(normalized.start ?? '', now, true)
    this._panels[1].reset(
      normalized.end ?? '',
      defaultEndTime(startFallback, this._allowOvernight),
      true,
    )
    this._validationError = null
    if (this.visible) this.requestPopupPaint()
  }

  syncConfiguration(options: {
    precision?: TimePrecision
    hourStep?: number
    minuteStep?: number
    secondStep?: number
    allowOvernight?: boolean
  }): void {
    if (options.precision !== undefined) this._precision = options.precision
    if (options.allowOvernight !== undefined) this._allowOvernight = options.allowOvernight
    const panelOptions = {
      precision: options.precision,
      hourStep: options.hourStep,
      minuteStep: options.minuteStep,
      secondStep: options.secondStep,
    }
    for (const panel of this._panels) panel.configure(panelOptions)
    this._validationError = null
    if (this.visible) this.requestPopupPaint()
  }

  commitSelection(): boolean {
    if (!this.visible) return true
    for (const panel of this._panels) panel.commitPending()
    const value = this._draftValue()
    const validationError = this._validationIssue(value)
    if (validationError) {
      this._validationError = validationError
      this.requestPopupPaint()
      return false
    }
    this._validationError = null
    const outcome: { accepted: boolean | void } = { accepted: undefined }
    runCleanupSteps([
      () => { outcome.accepted = this._onSelect?.(value) },
      () => {
        if (outcome.accepted === false) this.requestPopupPaint()
        else this.close()
      },
    ])
    return outcome.accepted !== false
  }

  debugState(): {
    panelX: number
    panelY: number
    panelW: number
    panelH: number
    activePanel: 0 | 1
    value: TimeRangeValue
    allowOvernight: boolean
    validationError: boolean
    panels: [
      ReturnType<TimeSelectionPanel['debugState']>,
      ReturnType<TimeSelectionPanel['debugState']>,
    ]
  } {
    const layout = this._layout(PopupManager.instance.context)
    return {
      panelX: layout.panelX,
      panelY: layout.panelY,
      panelW: layout.panelW,
      panelH: layout.panelH,
      activePanel: this._activePanel,
      value: this._draftValue(),
      allowOvernight: this._allowOvernight,
      validationError: this._validationError !== null,
      panels: [this._panels[0].debugState(), this._panels[1].debugState()],
    }
  }

  onOutsidePointerDown(event: PopupPointerEvent): boolean {
    const anchor = resolvePopupAnchorRect(this._anchor)
    if (
      event.position.x < anchor.x || event.position.x > anchor.x + anchor.w ||
      event.position.y < anchor.y || event.position.y > anchor.y + anchor.h
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
    const handled = this._panels[this._activePanel].handleKeyDown(event)
    if (event.key !== 'Tab' || handled) return handled
    const next = event.shiftKey ? this._activePanel - 1 : this._activePanel + 1
    if (next === 0 || next === 1) {
      event.preventDefault()
      this._activePanel = next
      this._panels[next].reset(this._panels[next].value, this._panels[next].parts ?? currentTime())
      this.requestPopupPaint()
      return true
    }
    this.close()
    return false
  }

  protected override onPopupClose(): void {
    super.onPopupClose()
    this._onClose?.()
  }

  dispose(): void {
    this.close()
    this.disposePopupSurface()
  }

  private _draftValue(): TimeRangeValue {
    return {
      start: this._panels[0].value || null,
      end: this._panels[1].value || null,
    }
  }

  private _validationIssue(value: TimeRangeValue): 'incomplete' | 'order' | null {
    if (!value.start || !value.end) return 'incomplete'
    if (this._allowOvernight) return null
    return timeValueToSeconds(value.end)! >= timeValueToSeconds(value.start)! ? null : 'order'
  }

  private _isOvernight(value: TimeRangeValue): boolean {
    if (!value.start || !value.end) return false
    return timeValueToSeconds(value.end)! < timeValueToSeconds(value.start)!
  }

  private _handleSurfacePointerDown(
    event: PopupPointerEvent,
    popupContext: PopupContext = PopupManager.instance.context,
  ): void {
    const layout = this._layout(popupContext)
    const footer = this._footerButtonAt(event.position, layout)
    if (footer === 'now') {
      const now = formatTimeValue(currentTime(), this._precision)
      this._panels[this._activePanel].reset(now, currentTime())
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
    const panel = this._panelAt(event.position, layout)
    if (panel === null) return
    this._activePanel = panel
    this._panels[panel].handlePointerDown(
      event.position,
      this._panelRect(panel, layout),
      layout.style,
    )
    this.requestPopupPaint()
  }

  private _handleSurfacePointerMove(
    event: PopupPointerEvent,
    popupContext: PopupContext = PopupManager.instance.context,
  ): void {
    const layout = this._layout(popupContext)
    const footer = this._footerButtonAt(event.position, layout)
    let changed = footer !== this._hoveredFooter
    this._hoveredFooter = footer
    for (const panel of [0, 1] as const) {
      if (this._panels[panel].handlePointerMove(
        event.position,
        this._panelRect(panel, layout),
        layout.style,
      )) changed = true
    }
    if (changed) this.requestPopupPaint()
  }

  private _handleSurfaceWheel(
    event: WheelPointerEvent,
    popupContext: PopupContext = PopupManager.instance.context,
  ): boolean {
    const layout = this._layout(popupContext)
    const panel = this._panelAt(event.position, layout)
    if (panel === null) return false
    this._activePanel = panel
    return this._panels[panel].handleWheel(
      event,
      this._panelRect(panel, layout),
      layout.style,
    )
  }

  private _clearHover(): void {
    let changed = this._hoveredFooter !== null
    this._hoveredFooter = null
    for (const panel of this._panels) {
      if (panel.clearHover()) changed = true
    }
    if (changed) this.requestPopupPaint()
  }

  private _layout(popupContext: PopupContext): {
    style: DatePickerStyleTokens
    popupStyle: PopupStyleTokens
    panelX: number
    panelY: number
    panelW: number
    panelH: number
    itemWidth: number
    contentHeight: number
    statusHeight: number
    footerHeight: number
    gap: number
  } {
    const style = deriveDatePickerStyle(popupContext.theme)
    const popupStyle = derivePopupStyle(popupContext.theme)
    const itemWidth = TimeSelectionPanel.minimumWidth(style, this._precision)
    const contentHeight = TimeSelectionPanel.height(style)
    const statusHeight = style.cellSize
    const footerHeight = style.footerHeight
    const gap = Math.max(8, style.padding)
    const panelW = itemWidth * 2 + gap
    const panelH = contentHeight + statusHeight + footerHeight
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
      itemWidth,
      contentHeight,
      statusHeight,
      footerHeight,
      gap,
    }
  }

  private _panelRect(panel: 0 | 1, layout: ReturnType<TimeRangePickerPopup['_layout']>) {
    return {
      x: layout.panelX + panel * (layout.itemWidth + layout.gap),
      y: layout.panelY,
      width: layout.itemWidth,
    }
  }

  private _panelAt(
    point: Offset,
    layout: ReturnType<TimeRangePickerPopup['_layout']>,
  ): 0 | 1 | null {
    for (const panel of [0, 1] as const) {
      const rect = this._panelRect(panel, layout)
      if (
        point.x >= rect.x && point.x <= rect.x + rect.width &&
        point.y >= rect.y && point.y <= rect.y + layout.contentHeight
      ) return panel
    }
    return null
  }

  private _footerButtonAt(
    point: Offset,
    layout: ReturnType<TimeRangePickerPopup['_layout']>,
  ): TimeRangeFooterButton | null {
    const top = layout.panelY + layout.contentHeight + layout.statusHeight
    const left = layout.panelX + layout.style.padding
    const width = layout.panelW - layout.style.padding * 2
    if (
      point.x < left || point.x > left + width ||
      point.y < top || point.y > top + layout.footerHeight
    ) return null
    const index = Math.min(2, Math.floor((point.x - left) / (width / 3)))
    return index === 0 ? 'now' : index === 1 ? 'ok' : 'cancel'
  }

  private _paintSurface(context: PaintContext, offset: Offset): void {
    const layout = this._layout(PopupManager.instance.context)
    const dl = new DrawList(context)
    const x = offset.x
    const y = offset.y
    drawPopupPanel(dl, x, y, layout.panelW, layout.panelH, layout.popupStyle)
    for (const panel of [0, 1] as const) {
      this._panels[panel].paint(
        context,
        dl,
        {
          x: x + panel * (layout.itemWidth + layout.gap),
          y,
          width: layout.itemWidth,
        },
        layout.style,
        layout.popupStyle,
        { active: panel === this._activePanel, title: panel === 0 ? '开始' : '结束' },
      )
    }
    const separatorX = x + layout.itemWidth + layout.gap / 2
    dl.line(
      separatorX,
      y + layout.style.padding,
      separatorX,
      y + layout.contentHeight - layout.style.padding,
      layout.style.separator,
      1,
    )

    const value = this._draftValue()
    const overnight = this._isOvernight(value)
    const statusY = y + layout.contentHeight
    dl.line(
      x + layout.style.padding,
      statusY,
      x + layout.panelW - layout.style.padding,
      statusY,
      layout.style.separator,
      1,
    )
    const statusText = this._validationError === 'incomplete'
      ? '请完整选择开始和结束时间'
      : this._validationError === 'order'
        ? '结束时间早于开始时间；如需跨日，请启用 allowOvernight'
      : overnight && this._allowOvernight
        ? `${value.start} ~ 次日 ${value.end}`
        : `${value.start} ~ ${value.end}`
    dl.fillText(
      statusText,
      x + layout.panelW / 2,
      statusY + layout.statusHeight / 2,
      this._validationError !== null
        ? layout.popupStyle.danger
        : overnight ? layout.style.accentText : layout.style.text,
      layout.style.weekLabelFontSize,
      layout.style.fontFamily,
      'center',
      'middle',
    )

    const footerY = statusY + layout.statusHeight
    dl.line(
      x + layout.style.padding,
      footerY,
      x + layout.panelW - layout.style.padding,
      footerY,
      layout.style.separator,
      1,
    )
    const buttonWidth = (layout.panelW - layout.style.padding * 2) / 3
    const buttons: Array<{ key: TimeRangeFooterButton; label: string }> = [
      { key: 'now', label: '当前栏设为现在' },
      { key: 'ok', label: '确定' },
      { key: 'cancel', label: '取消' },
    ]
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
}

export function normalizeTimeRangeValue(
  value: TimeRangeValue | null | undefined,
  precision: TimePrecision = 'second',
): TimeRangeValue {
  return {
    start: normalizeTimeValue(value?.start ?? '', precision),
    end: normalizeTimeValue(value?.end ?? '', precision),
  }
}

export class RenderTimeRangeEdit extends RenderBox implements
  InteractiveRenderObject,
  Focusable,
  GestureArenaMember,
  ValueEditor<
    TimeRangeValue,
    TimeRangeEditValueChangeReason,
    TimeRangeEditValueChangeDetail
  > {
  static override debugTypeName = 'RenderTimeRangeEdit'

  private _value: TimeRangeValue
  private _precision: TimePrecision
  private _allowOvernight: boolean
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
    TimeRangeValue,
    TimeRangeEditValueChangeReason,
    TimeRangeEditValueChangeDetail
  >()
  private readonly _pendingGesture = new PendingPointerGesture()
  private _pressedPointerAction: 'clear' | null = null
  private readonly _popup = new TimeRangePickerPopup()

  placeholder: string
  separator: string
  onChange?: (value: TimeRangeValue) => void

  constructor(options: TimeRangeEditOptions = {}) {
    super(options)
    this._precision = options.precision ?? 'second'
    this._value = normalizeTimeRangeValue(options.value, this._precision)
    this._allowOvernight = options.allowOvernight ?? false
    this.placeholder = options.placeholder ?? '选择时间范围'
    this.separator = options.separator ?? ' ~ '
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

  get value(): TimeRangeValue { return { ...this._value } }
  set value(value: TimeRangeValue) {
    const normalized = normalizeTimeRangeValue(value, this.precision)
    if (sameTimeRangeValue(normalized, this._value)) return
    this._value = normalized
    if (this._popup.visible) this._popup.syncValue(normalized)
    this.markNeedsPaint()
  }

  getValue(): TimeRangeValue { return this.value }
  setValue(value: TimeRangeValue): void {
    const normalized = normalizeTimeRangeValue(value, this.precision)
    if (sameTimeRangeValue(normalized, this._value)) return
    this.cancelEdit()
    this.value = normalized
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<
      TimeRangeValue,
      TimeRangeEditValueChangeReason,
      TimeRangeEditValueChangeDetail
    >,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: ValueEditorBlurListener): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
  }

  get precision(): TimePrecision { return this._precision }
  set precision(value: TimePrecision) {
    if (value === this._precision) return
    const previousValue = this.value
    this._precision = value
    this._value = normalizeTimeRangeValue(previousValue, value)
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
    if (!sameTimeRangeValue(previousValue, this._value)) {
      this._valueEditorEvents.emitValueChange({
        value: this.value,
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

  get allowOvernight(): boolean { return this._allowOvernight }
  set allowOvernight(value: boolean) {
    if (value === this._allowOvernight) return
    this._allowOvernight = value
    if (this._popup.visible) this._popup.syncConfiguration({ allowOvernight: value })
    this.markNeedsPaint()
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
    const text = this._displayText()
    if (shell.valueRect.w > 0) {
      paintSingleLineText(dl, {
        text: text || this.placeholder,
        x: shell.valueRect.x,
        y: offset.y + shell.fieldHeight / 2,
        maxWidth: shell.valueRect.w,
        color: text
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
    value: TimeRangeValue
    precision: TimePrecision
    allowOvernight: boolean
    popupVisible: boolean
    popup: ReturnType<TimeRangePickerPopup['debugState']> | null
  } {
    return {
      value: this.value,
      precision: this.precision,
      allowOvernight: this.allowOvernight,
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
      allowOvernight: this.allowOvernight,
      onSelect: value => {
        this._setValue(value, 'selection')
        return true
      },
      onClose: () => this.markNeedsPaint(),
    })
    this.markNeedsPaint()
  }

  private _setValue(value: TimeRangeValue, reason: TimeRangeEditValueChangeReason): void {
    const normalized = normalizeTimeRangeValue(value, this.precision)
    const previousValue = this.value
    if (sameTimeRangeValue(normalized, previousValue)) return
    this._value = normalized
    const start = timeValueToSeconds(normalized.start)
    const end = timeValueToSeconds(normalized.end)
    const detail = {
      complete: normalized.start !== null && normalized.end !== null,
      overnight: start !== null && end !== null && end < start,
    }
    runCleanupSteps([
      () => this.onChange?.(this.value),
      () => this._valueEditorEvents.emitValueChange({
        value: this.value,
        previousValue,
        reason,
        detail,
      }),
      () => this.markNeedsPaint(),
    ])
  }

  private _clearValue(): void {
    if (!this._showClearButton()) return
    this._popup.close()
    this._setValue({ start: null, end: null }, 'clear')
  }

  private _displayText(): string {
    if (!this._value.start && !this._value.end) return ''
    const start = this._value.start ?? '--'
    const end = this._value.end ?? '--'
    const overnight = this.allowOvernight &&
      timeValueToSeconds(this._value.start) !== null &&
      timeValueToSeconds(this._value.end)! < timeValueToSeconds(this._value.start)!
    return overnight
      ? `${start}${this.separator}次日 ${end}`
      : `${start}${this.separator}${end}`
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
    return this.clearable && !this.disabled && !this.readonly &&
      (this._value.start !== null || this._value.end !== null)
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

  private _widthHint(): number { return this.precision === 'second' ? 278 : 226 }
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

function defaultEndTime(start: TimeParts, allowOvernight: boolean): TimeParts {
  if (start.hour < 23) return { ...start, hour: start.hour + 1 }
  return allowOvernight ? { ...start, hour: 0 } : { ...start }
}

function sameTimeRangeValue(left: TimeRangeValue, right: TimeRangeValue): boolean {
  return left.start === right.start && left.end === right.end
}

function positiveInteger(value: number | undefined): number {
  if (!Number.isFinite(value) || value! <= 0) return 1
  return Math.max(1, Math.trunc(value!))
}
