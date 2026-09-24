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
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
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
  type TextInputStyleTokens,
} from '../theme/component_styles'
import {
  calendarDaysInMonth,
  compareCalendarDates,
  formatISOCalendarDate,
  parseISOCalendarDate,
  shiftCalendarDays,
  shiftCalendarMonths,
  todayCalendarDate,
  type CalendarDate,
} from './calendar_date'
import {
  layoutFormFieldInlineContent,
  measureFormFieldHeight,
  pointInFormFieldRect,
  resolveFormFieldPlaceholderColor,
  resolveFormFieldTextColor,
  type FormFieldStatus,
} from './form_field_shell'
import { paintTriggerFieldShell } from './trigger_field_shell'
import { DateCalendarPanel } from './date_calendar_panel'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorBlurListener,
  type ValueEditorValueChangeListener,
} from './value_editor'

export interface DateRangeValue {
  start: string | null
  end: string | null
}

export interface DateRangeEditOptions extends RenderBoxOptions {
  value?: DateRangeValue
  placeholder?: string
  separator?: string
  onChange?: (value: DateRangeValue) => void
  disabled?: boolean
  readonly?: boolean
  status?: FormFieldStatus
  helperText?: string
  prefixText?: string
  suffixText?: string
  clearable?: boolean
}

export type DateRangeEditValueChangeReason = 'selection' | 'clear'

export interface DateRangeEditValueChangeDetail {
  readonly complete: boolean
}

type DateRangeFooterButton = 'today' | 'ok' | 'cancel'

export class DateRangePickerPopup extends PopupSurfaceShell implements Popup {
  private _anchor?: PopupAnchor
  private readonly _panels = [
    new DateCalendarPanel(() => this.requestPopupPaint()),
    new DateCalendarPanel(() => this.requestPopupPaint()),
  ] as const
  private _activePanel: 0 | 1 = 0
  private _hoveredFooter: DateRangeFooterButton | null = null
  private _onSelect?: (value: DateRangeValue) => boolean | void
  private _onClose?: () => void

  private get _dates(): [CalendarDate | null, CalendarDate | null] {
    return [this._panels[0].selected, this._panels[1].selected]
  }

  private set _dates(value: [CalendarDate | null, CalendarDate | null]) {
    this._panels[0].selected = value[0]
    this._panels[1].selected = value[1]
  }

  private get _views(): [
    { year: number; month: number },
    { year: number; month: number },
  ] {
    return [
      { year: this._panels[0].viewYear, month: this._panels[0].viewMonth },
      { year: this._panels[1].viewYear, month: this._panels[1].viewMonth },
    ]
  }

  private get _keyboardDates(): [CalendarDate, CalendarDate] {
    return [this._panels[0].focusedDate, this._panels[1].focusedDate]
  }

  constructor() {
    super()
    this.setPopupSurfaceRoot(new PopupRenderNode({
      paint: (_node, context, offset) => this._paintSurface(context, offset),
      onPointerDown: (_node, event) => this._handleSurfacePointerDown(event),
      onPointerMove: (_node, event) => this._handleSurfacePointerMove(event),
      onPointerLeave: () => this._clearHover(),
      onPointerCancel: () => this._clearHover(),
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
    value: DateRangeValue
    onSelect: (value: DateRangeValue) => boolean | void
    onClose: () => void
  }): void {
    if (this.popupOpen) this.close()
    const normalized = normalizeDateRangeValue(options.value)
    const first = parseISOCalendarDate(normalized.start)
    const second = parseISOCalendarDate(normalized.end)
    const today = todayCalendarDate()
    const firstBase = first ?? today
    const secondBase = second ?? shiftCalendarMonths(firstBase, 1)
    this._anchor = options.anchor
    this._panels[0].reset(first, firstBase)
    this._panels[1].reset(second, secondBase)
    this._activePanel = 0
    this._hoveredFooter = null
    this._onSelect = options.onSelect
    this._onClose = options.onClose
    this.resetPopupSurface()
    this.openPopup({ owner: resolvePopupAnchorTarget(options.anchor) })
  }

  syncValue(value: DateRangeValue): void {
    const normalized = normalizeDateRangeValue(value)
    const first = parseISOCalendarDate(normalized.start)
    const second = parseISOCalendarDate(normalized.end)
    const today = todayCalendarDate()
    const firstBase = first ?? today
    const secondBase = second ?? shiftCalendarMonths(firstBase, 1)
    this._panels[0].reset(first, firstBase)
    this._panels[1].reset(second, secondBase)
    if (this.visible) this.requestPopupPaint()
  }

  commitSelection(): boolean {
    if (!this.visible) return true
    const first = this._dates[0]
    const second = this._dates[1]
    if (!first || !second) {
      this.requestPopupPaint()
      return false
    }
    const normalized = normalizeDateRangeValue({
      start: formatISOCalendarDate(first),
      end: formatISOCalendarDate(second),
    })
    const outcome: { accepted: boolean | void } = { accepted: undefined }
    runCleanupSteps([
      () => { outcome.accepted = this._onSelect?.(normalized) },
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
    dates: [CalendarDate | null, CalendarDate | null]
    views: [
      { year: number; month: number },
      { year: number; month: number },
    ]
    viewModes: [
      ReturnType<DateCalendarPanel['debugState']>['viewMode'],
      ReturnType<DateCalendarPanel['debugState']>['viewMode'],
    ]
    yearRangeStarts: [number, number]
    keyboardDates: [CalendarDate, CalendarDate]
  } {
    const layout = this._layout(PopupManager.instance.context)
    return {
      panelX: layout.panelX,
      panelY: layout.panelY,
      panelW: layout.panelW,
      panelH: layout.panelH,
      activePanel: this._activePanel,
      dates: [
        this._dates[0] ? { ...this._dates[0] } : null,
        this._dates[1] ? { ...this._dates[1] } : null,
      ],
      views: [
        { ...this._views[0] },
        { ...this._views[1] },
      ],
      viewModes: [
        this._panels[0].viewMode,
        this._panels[1].viewMode,
      ],
      yearRangeStarts: [
        this._panels[0].yearRangeStart,
        this._panels[1].yearRangeStart,
      ],
      keyboardDates: [
        { ...this._keyboardDates[0] },
        { ...this._keyboardDates[1] },
      ],
    }
  }

  onOutsidePointerDown(event: PopupPointerEvent): boolean {
    const anchor = resolvePopupAnchorRect(this._anchor)
    if (
      event.position.x < anchor.x ||
      event.position.x > anchor.x + anchor.w ||
      event.position.y < anchor.y ||
      event.position.y > anchor.y + anchor.h
    ) {
      return false
    }
    this.close()
    return true
  }

  onWheel(_event: WheelPointerEvent): boolean {
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
    if (
      event.key === 'Tab' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const targetPanel = event.shiftKey
        ? this._activePanel - 1
        : this._activePanel + 1
      if (targetPanel === 0 || targetPanel === 1) {
        event.preventDefault()
        this._activePanel = targetPanel
        this.requestPopupPaint()
        return true
      }
      this.close()
      return false
    }
    return this._panels[this._activePanel].handleKeyDown(event).handled
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
    if (footer === 'today') {
      const today = todayCalendarDate()
      this._panels[0].syncSelected(today)
      this._panels[1].syncSelected(today)
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
    const activePanelChanged = this._activePanel !== panel
    this._activePanel = panel
    this._panels[panel].handlePointerDown(
      event.position,
      this._panelRect(panel, layout),
      layout.style,
    )
    if (activePanelChanged) this.requestPopupPaint()
  }

  private _handleSurfacePointerMove(
    event: PopupPointerEvent,
    popupContext: PopupContext = PopupManager.instance.context,
  ): void {
    const layout = this._layout(popupContext)
    const footer = this._footerButtonAt(event.position, layout)
    let changed = footer !== this._hoveredFooter
    for (const panel of [0, 1] as const) {
      if (this._panels[panel].handlePointerMove(
        event.position,
        this._panelRect(panel, layout),
        layout.style,
      )) changed = true
    }
    if (!changed) return
    this._hoveredFooter = footer
    this.requestPopupPaint()
  }

  private _clearHover(): void {
    const firstChanged = this._panels[0].clearHover()
    const secondChanged = this._panels[1].clearHover()
    const changed = firstChanged || secondChanged || this._hoveredFooter !== null
    this._hoveredFooter = null
    if (changed) this.requestPopupPaint()
  }

  private _selectDate(panel: 0 | 1, date: CalendarDate): void {
    if (!isSupportedCalendarDate(date)) return
    this._panels[panel].syncSelected(date)
  }

  private _moveKeyboardDate(panel: 0 | 1, delta: number): void {
    const next = shiftCalendarDays(this._keyboardDates[panel], delta)
    this._panels[panel].focusedDate = next
    this._showDate(panel, next)
  }

  private _showDate(panel: 0 | 1, date: CalendarDate): void {
    if (!isSupportedCalendarDate(date)) return
    this._panels[panel].syncView(date.year, date.month)
  }

  private _moveViewMonth(panel: 0 | 1, delta: -1 | 1): void {
    const view = this._views[panel]
    const next = shiftCalendarMonths({
      year: view.year,
      month: view.month,
      day: 1,
    }, delta)
    this._panels[panel].focusedDate = {
      year: next.year,
      month: next.month,
      day: Math.min(
        this._keyboardDates[panel].day,
        calendarDaysInMonth(next.year, next.month),
      ),
    }
    this._panels[panel].syncView(next.year, next.month)
  }

  private _layout(popupContext: PopupContext): {
    style: DatePickerStyleTokens
    popupStyle: PopupStyleTokens
    panelX: number
    panelY: number
    panelW: number
    panelH: number
    calendarWidth: number
    calendarPanelWidth: number
    calendarHeight: number
    calendarGap: number
    cellSize: number
    headerHeight: number
    statusHeight: number
    footerHeight: number
  } {
    const style = deriveDatePickerStyle(popupContext.theme)
    const popupStyle = derivePopupStyle(popupContext.theme)
    const cellSize = style.cellSize
    const headerHeight = style.headerHeight
    const statusHeight = cellSize
    const footerHeight = style.footerHeight
    const calendarWidth = cellSize * 7
    const calendarPanelWidth = DateCalendarPanel.minimumWidth(style)
    const calendarHeight = DateCalendarPanel.height(style)
    const calendarGap = Math.max(8, style.padding)
    const panelW = calendarPanelWidth * 2 + calendarGap
    const panelH = calendarHeight + statusHeight + footerHeight
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
      calendarWidth,
      calendarPanelWidth,
      calendarHeight,
      calendarGap,
      cellSize,
      headerHeight,
      statusHeight,
      footerHeight,
    }
  }

  private _panelRect(
    panel: 0 | 1,
    layout: ReturnType<DateRangePickerPopup['_layout']>,
  ) {
    return {
      x: layout.panelX +
        panel * (layout.calendarPanelWidth + layout.calendarGap),
      y: layout.panelY,
      width: layout.calendarPanelWidth,
    }
  }

  private _panelAt(
    point: Offset,
    layout: ReturnType<DateRangePickerPopup['_layout']>,
  ): 0 | 1 | null {
    for (const panel of [0, 1] as const) {
      const rect = this._panelRect(panel, layout)
      if (
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + layout.calendarHeight
      ) return panel
    }
    return null
  }

  private _calendarX(
    panel: 0 | 1,
    layout: ReturnType<DateRangePickerPopup['_layout']>,
  ): number {
    return this._panelRect(panel, layout).x + layout.style.padding
  }

  private _footerButtonAt(
    point: Offset,
    layout: ReturnType<DateRangePickerPopup['_layout']>,
  ): DateRangeFooterButton | null {
    const top = layout.panelY + layout.panelH - layout.footerHeight
    const left = layout.panelX + layout.style.padding
    const width = layout.panelW - layout.style.padding * 2
    if (
      point.x < left ||
      point.x > left + width ||
      point.y < top ||
      point.y > top + layout.footerHeight
    ) {
      return null
    }
    const index = Math.min(2, Math.floor((point.x - left) / (width / 3)))
    return index === 0 ? 'today' : index === 1 ? 'ok' : 'cancel'
  }

  private _paintSurface(context: PaintContext, offset: Offset): void {
    const layout = this._layout(PopupManager.instance.context)
    const dl = new DrawList(context)
    const style = layout.style
    const x = offset.x
    const y = offset.y
    const width = layout.panelW
    drawPopupPanel(dl, x, y, width, layout.panelH, layout.popupStyle)

    const firstDate = this._dates[0]
    const secondDate = this._dates[1]
    const rangeStart = firstDate && secondDate
      ? compareCalendarDates(firstDate, secondDate) <= 0 ? firstDate : secondDate
      : null
    const rangeEnd = firstDate && secondDate
      ? compareCalendarDates(firstDate, secondDate) <= 0 ? secondDate : firstDate
      : null
    for (const panel of [0, 1] as const) {
      this._panels[panel].paint(
        context,
        dl,
        this._panelRect(panel, layout),
        style,
        layout.popupStyle,
        {
          active: panel === this._activePanel,
          rangeStart,
          rangeEnd,
        },
      )
    }

    const separatorX = x + layout.calendarPanelWidth + layout.calendarGap / 2
    dl.line(
      separatorX,
      y + style.padding,
      separatorX,
      y + layout.calendarHeight - style.padding,
      style.separator,
      1,
    )

    const statusY = y + layout.calendarHeight
    dl.line(
      x + style.padding,
      statusY,
      x + width - style.padding,
      statusY,
      style.separator,
      1,
    )
    const normalized = firstDate && secondDate
      ? normalizeDateRangeValue({
          start: formatISOCalendarDate(firstDate),
          end: formatISOCalendarDate(secondDate),
        })
      : null
    const statusText = normalized
      ? `保存为 ${normalized.start}  ~  ${normalized.end}`
      : firstDate || secondDate
        ? `已选择 ${formatISOCalendarDate(firstDate ?? secondDate!)}，请选择另一个日期`
        : '请选择两个日期'
    dl.fillText(
      statusText,
      x + width / 2,
      statusY + layout.statusHeight / 2,
      normalized ? style.text : style.accentText,
      style.weekLabelFontSize,
      style.fontFamily,
      'center',
      'middle',
    )

    const footerY = y + layout.panelH - layout.footerHeight
    dl.line(
      x + style.padding,
      footerY,
      x + width - style.padding,
      footerY,
      style.separator,
      1,
    )
    const buttonWidth = (width - style.padding * 2) / 3
    const buttons: Array<{ key: DateRangeFooterButton; label: string }> = [
      { key: 'today', label: '今天' },
      { key: 'ok', label: '确定' },
      { key: 'cancel', label: '取消' },
    ]
    for (let index = 0; index < buttons.length; index++) {
      const button = buttons[index]!
      const buttonX = x + style.padding + index * buttonWidth
      const enabled = button.key !== 'ok' || !!(this._dates[0] && this._dates[1])
      if (enabled && this._hoveredFooter === button.key) {
        dl.fillRect(
          buttonX + 2,
          footerY + style.padding / 2,
          buttonWidth - 4,
          layout.footerHeight - style.padding,
          resolveBgColor(style.footerButtonBg, 'hovered'),
          layout.popupStyle.borderRadius,
        )
      }
      dl.fillText(
        button.label,
        buttonX + buttonWidth / 2,
        footerY + layout.footerHeight / 2,
        button.key === 'ok'
          ? enabled ? style.accentText : style.textDisabled
          : button.key === 'cancel' ? style.textDisabled : style.text,
        style.fontSize,
        style.fontFamily,
        'center',
        'middle',
      )
    }
  }

}

export class RenderDateRangeEdit extends RenderBox implements
  InteractiveRenderObject,
  Focusable,
  GestureArenaMember,
  ValueEditor<
    DateRangeValue,
    DateRangeEditValueChangeReason,
    DateRangeEditValueChangeDetail
  > {
  static override debugTypeName = 'RenderDateRangeEdit'

  private _value: DateRangeValue
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
    DateRangeValue,
    DateRangeEditValueChangeReason,
    DateRangeEditValueChangeDetail
  >()
  private readonly _pendingGesture = new PendingPointerGesture()
  private _pressedPointerAction: 'clear' | null = null
  private readonly _popup = new DateRangePickerPopup()

  placeholder: string
  separator: string
  onChange?: (value: DateRangeValue) => void

  constructor(options: DateRangeEditOptions = {}) {
    super(options)
    this._value = normalizeDateRangeValue(options.value)
    this.placeholder = options.placeholder ?? '选择日期范围'
    this.separator = options.separator ?? ' ~ '
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

  get value(): DateRangeValue {
    return { ...this._value }
  }

  set value(value: DateRangeValue) {
    const normalized = normalizeDateRangeValue(value)
    if (sameDateRangeValue(normalized, this._value)) return
    this._value = normalized
    if (this._popup.visible) this._popup.syncValue(normalized)
    this.markNeedsPaint()
  }

  getValue(): DateRangeValue {
    return this.value
  }

  setValue(value: DateRangeValue): void {
    const normalized = normalizeDateRangeValue(value)
    if (sameDateRangeValue(normalized, this._value)) return
    this.cancelEdit()
    this.value = normalized
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<
      DateRangeValue,
      DateRangeEditValueChangeReason,
      DateRangeEditValueChangeDetail
    >,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: ValueEditorBlurListener): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
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
        () => this._endLogicalFocusSession(),
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
        () => this._endLogicalFocusSession(),
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
    return this._focused || this._popup.visible
  }

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

  private _endLogicalFocusSession(): void {
    const wasFocused = this.isFocused
    runCleanupSteps([
      () => this._popup.close(),
      () => {
        this._focused = false
        this.markNeedsPaint()
      },
      () => { if (wasFocused) this._valueEditorEvents.emitBlur() },
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
    this.cancelEdit()
    FocusManager.instance.clearFocusOf(this)
  }

  commitEdit(): boolean {
    return this._popup.commitSelection()
  }

  cancelEdit(): void {
    this._popup.close()
  }

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
    return {
      x: offset.x,
      y: offset.y,
      width: this.size.width,
      height: this._inputStyle().height,
    }
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveTextInputStyle(context.theme)
    this.size = {
      width: constraints.maxWidth === Infinity ? 260 : constraints.maxWidth,
      height: measureFormFieldHeight(style, style.height, this.helperText),
    }
  }

  override getMinLayoutWidthHint(): number | undefined {
    return 260
  }

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
      leadingIcon: 'calendar',
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
      this._beginPointerAction(event, 'clear')
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
      () => this._popup.dispose(),
      () => this._valueEditorEvents.dispose(),
      () => super.dispose(),
    )
  }

  debugState(): {
    value: DateRangeValue
    popupVisible: boolean
    popup: ReturnType<DateRangePickerPopup['debugState']> | null
  } {
    return {
      value: this.value,
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
      onSelect: value => {
        this._setValue(value, 'selection', {
          complete: value.start !== null && value.end !== null,
        })
        return true
      },
      onClose: () => this.markNeedsPaint(),
    })
    this.markNeedsPaint()
  }

  private _pointerActionAt(position: Offset): 'clear' | null {
    if (!this._hitField(position)) return null
    return pointInFormFieldRect(this._fieldLayout().clearRect, position)
      ? 'clear'
      : null
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

  private _setValue(
    value: DateRangeValue,
    reason?: DateRangeEditValueChangeReason,
    detail?: DateRangeEditValueChangeDetail,
  ): void {
    const normalized = normalizeDateRangeValue(value)
    const previousValue = { ...this._value }
    const changed = !sameDateRangeValue(normalized, previousValue)
    this._value = normalized
    if (changed && reason) {
      const nextValue = { ...normalized }
      runCleanupSteps([
        () => this.onChange?.({ ...nextValue }),
        () => this._valueEditorEvents.emitValueChange({
          value: { ...nextValue },
          previousValue,
          reason,
          detail,
        }),
      ])
    }
    this.markNeedsPaint()
  }

  private _clearValue(): void {
    if (!this._showClearButton()) return
    this._popup.close()
    this._setValue(
      { start: null, end: null },
      'clear',
      { complete: false },
    )
  }

  private _displayText(): string {
    if (!this._value.start) return ''
    return this._value.end
      ? `${this._value.start}${this.separator}${this._value.end}`
      : `${this._value.start}${this.separator}`
  }

  private _fieldLayout() {
    const style = this._inputStyle()
    return layoutFormFieldInlineContent(
      style,
      this.globalOffset,
      this.size.width,
      style.height,
      {
        leadingIcon: 'calendar',
        prefixText: this.prefixText,
        suffixText: this.suffixText,
        showClearButton: this._showClearButton(),
        reserveTrailingWidth: style.fontSize,
      },
    )
  }

  private _showClearButton(): boolean {
    return this.clearable &&
      !this.disabled &&
      !this.readonly &&
      (this._value.start !== null || this._value.end !== null)
  }

  private _inputStyle(): TextInputStyleTokens {
    return deriveTextInputStyle(this.currentTheme)
  }

  private _hitField(position: Offset): boolean {
    const offset = this.globalOffset
    return position.x >= offset.x &&
      position.x <= offset.x + this.size.width &&
      position.y >= offset.y &&
      position.y <= offset.y + this._inputStyle().height
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

export function normalizeDateRangeValue(
  value: DateRangeValue | null | undefined,
): DateRangeValue {
  let start = parseISOCalendarDate(value?.start ?? null)
  let end = parseISOCalendarDate(value?.end ?? null)
  if (!start) end = null
  if (start && end && compareCalendarDates(start, end) > 0) {
    const previousStart = start
    start = end
    end = previousStart
  }
  return {
    start: start ? formatISOCalendarDate(start) : null,
    end: end ? formatISOCalendarDate(end) : null,
  }
}

function sameDateRangeValue(left: DateRangeValue, right: DateRangeValue): boolean {
  return left.start === right.start && left.end === right.end
}

function isSupportedCalendarDate(date: CalendarDate): boolean {
  return date.year >= 1 &&
    date.year <= 9_999 &&
    date.month >= 1 &&
    date.month <= 12 &&
    date.day >= 1 &&
    date.day <= calendarDaysInMonth(date.year, date.month)
}
