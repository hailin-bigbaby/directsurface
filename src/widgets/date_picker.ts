// DatePicker: 日期(时间)选择组件
// 架构：
//   RenderDatePicker — 分段输入框，点击日期段打开日历 popup，点击时间段直接键盘输入
//   DatePickerPopup  — 日历弹出层（年/月/日视图），可按需显示时间选择

import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import { paintSingleLineText } from '../rendering/text_painter'
import type { ResolvedTheme } from '../theme/theme'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton, type PointerEvent as PopupPointerEvent, type WheelPointerEvent } from '../gestures/hit_test'
import { PopupManager, clampXToPopupViewport, type Popup, type PopupContext } from '../core/popup_manager'
import { PopupRenderNode } from '../core/popup_render_surface'
import { PopupSurfaceShell } from '../core/popup_shell'
import {
  GET_POPUP_ANCHOR_RECT,
  type PopupAnchor,
  type PopupAnchorTarget,
  resolvePopupAnchorTarget,
  resolvePopupAnchorRect,
} from '../core/popup_anchor'
import { FocusManager, type Focusable } from '../core/focus_manager'
import { runCleanupSteps, type DisposeFn } from '../core/disposable'
import {
  deriveDatePickerStyle,
  derivePopupStyle,
  deriveTextInputStyle,
  resolveBgColor,
  type DatePickerStyleTokens,
  type PopupStyleTokens,
  type TextInputStyleTokens,
} from '../theme/component_styles'
import { drawPopupPanel } from '../rendering/popup_painter'
import {
  layoutFormFieldInlineContent,
  measureFormFieldHeight,
  pointInFormFieldRect,
  type FormFieldStatus,
} from './form_field_shell'
import { resolveFormFieldPlaceholderColor, resolveFormFieldTextColor } from './form_field_shell'
import { paintTriggerFieldShell } from './trigger_field_shell'
import {
  calendarDaysInMonth as daysInMonth,
  formatISOCalendarDate as toISO,
  parseISODatePrefix as parseISO,
  shiftCalendarDays as shiftDays,
  shiftCalendarMonths as shiftMonths,
  todayCalendarDate as today,
  type CalendarDate,
} from './calendar_date'
import {
  extractTimeValue,
  formatTimeValue,
  normalizeTimeParts,
  type TimeParts,
  type TimePrecision,
} from './time_value'
import {
  DateCalendarPanel,
  type DateCalendarViewMode,
} from './date_calendar_panel'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorBlurListener,
  type ValueEditorValueChangeListener,
} from './value_editor'

// ISO 日期字符串 'YYYY-MM-DD' 或 'YYYY-MM-DDTHH:mm:ss'
export type ISODate = string

export interface CalendarTime extends TimeParts {}
export type CalendarTimePrecision = TimePrecision

function currentTime(): CalendarTime {
  const d = new Date()
  return { hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() }
}

function normalizeTime(time: CalendarTime | null | undefined): CalendarTime {
  return normalizeTimeParts(time ?? currentTime())
}


type ViewMode = DateCalendarViewMode
type PopupDateSegment = 'year' | 'month' | 'day'
type PopupTimeSegment = 'hour' | 'minute' | 'second'
type PopupSegment = PopupDateSegment | PopupTimeSegment

function isPopupTimeSegment(segment: PopupSegment | null): segment is PopupTimeSegment {
  return segment === 'hour' || segment === 'minute' || segment === 'second'
}

// ---- DatePickerPopup（日历，可选时间）----

export class DatePickerPopup extends PopupSurfaceShell implements Popup {
  private _anchor?: PopupAnchor
  private readonly _calendar = new DateCalendarPanel(
    () => this.requestPopupPaint(),
  )
  private _hoveredFooter: 'today' | 'clear' | 'ok' | 'cancel' | null = null
  private _showTime = false
  private _timePrecision: CalendarTimePrecision = 'second'
  private _selectedTime: CalendarTime = currentTime()
  private _activeSegment: PopupSegment | null = null
  private _segmentInputBuffer = ''
  private _segmentInputFresh = true
  private _hoveredSegment: PopupSegment | null = null
  private _onSelect?: (date: CalendarDate, time?: CalendarTime) => boolean | void
  private _onClear?: () => boolean | void
  private _onTab?: (direction: 1 | -1) => void
  private _onClose?: () => void
  private _clearable = false

  private get _viewYear(): number { return this._calendar.viewYear }
  private set _viewYear(value: number) { this._calendar.viewYear = value }
  private get _viewMonth(): number { return this._calendar.viewMonth }
  private set _viewMonth(value: number) { this._calendar.viewMonth = value }
  private get _viewMode(): ViewMode { return this._calendar.viewMode }
  private set _viewMode(value: ViewMode) { this._calendar.viewMode = value }
  private get _yearRangeStart(): number { return this._calendar.yearRangeStart }
  private set _yearRangeStart(value: number) { this._calendar.yearRangeStart = value }
  private get _selected(): CalendarDate | null { return this._calendar.selected }
  private set _selected(value: CalendarDate | null) { this._calendar.selected = value }
  private get _hovered(): CalendarDate | null { return this._calendar.hoveredDate }
  private set _hovered(value: CalendarDate | null) { this._calendar.hoveredDate = value }
  private get _hoveredBtn(): 'prev' | 'next' | 'title' | null {
    return this._calendar.hoveredButton
  }
  private set _hoveredBtn(value: 'prev' | 'next' | 'title' | null) {
    this._calendar.hoveredButton = value
  }
  private get _hoveredMonth(): number { return this._calendar.hoveredMonth }
  private set _hoveredMonth(value: number) { this._calendar.hoveredMonth = value }
  private get _hoveredYear(): number { return this._calendar.hoveredYear }
  private set _hoveredYear(value: number) { this._calendar.hoveredYear = value }
  constructor() {
    super()
    this.setPopupSurfaceRoot(new PopupRenderNode({
      paint: (_node, context, offset) => this._paintSurface(context, offset),
      onPointerDown: (_node, event) => this._handleSurfacePointerDown(event),
      onPointerMove: (_node, event) => this._handleSurfacePointerMove(event),
      onPointerLeave: (_node, event) => this._handleSurfaceHoverExit(event),
      onPointerUp: (_node, event) => this._handleSurfacePointerUp(event),
      onPointerCancel: (_node, event) => this._handleSurfaceSequenceCancel(event),
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

  debugState(): {
    panelX: number
    panelY: number
    panelW: number
    panelH: number
    anchorRect: { x: number; y: number; w: number; h: number }
    viewMode: ViewMode
    viewYear: number
    viewMonth: number
    yearRangeStart: number
    selected: CalendarDate | null
    showTime: boolean
    timePrecision: CalendarTimePrecision
    selectedTime: CalendarTime
    activeSegment: PopupSegment | null
    activeTimeSegment: PopupTimeSegment | null
  }
  debugState(popupContext: PopupContext = PopupManager.instance.context): {
    panelX: number
    panelY: number
    panelW: number
    panelH: number
    anchorRect: { x: number; y: number; w: number; h: number }
    viewMode: ViewMode
    viewYear: number
    viewMonth: number
    yearRangeStart: number
    selected: CalendarDate | null
    showTime: boolean
    timePrecision: CalendarTimePrecision
    selectedTime: CalendarTime
    activeSegment: PopupSegment | null
    activeTimeSegment: PopupTimeSegment | null
  } {
    const layout = this._layout(popupContext)
    return {
      panelX: layout.panelX,
      panelY: layout.panelY,
      panelW: layout.panelW,
      panelH: layout.panelH,
      anchorRect: { ...layout.anchorRect },
      viewMode: this._viewMode,
      viewYear: this._viewYear,
      viewMonth: this._viewMonth,
      yearRangeStart: this._yearRangeStart,
      selected: this._selected ? { ...this._selected } : null,
      showTime: this._showTime,
      timePrecision: this._timePrecision,
      selectedTime: { ...this._selectedTime },
      activeSegment: this._activeSegment,
      activeTimeSegment: isPopupTimeSegment(this._activeSegment) ? this._activeSegment : null,
    }
  }

  // 同步日历视图到指定年月（键盘输入年/月时调用）
  syncView(year: number, month: number): void {
    if (!this.visible) return
    const nextYear = year > 0 ? year : this._viewYear
    const nextMonth = month >= 1 && month <= 12 ? month : this._viewMonth
    this._calendar.syncView(nextYear, nextMonth)
  }

  syncSelected(selected: CalendarDate | null, selectedTime?: CalendarTime | null, opts?: {
    showTime?: boolean
    timePrecision?: CalendarTimePrecision
  }): void {
    this._calendar.syncSelected(selected, { alignView: selected !== null })
    if (opts?.showTime !== undefined) {
      this._showTime = opts.showTime
    }
    if (opts?.timePrecision !== undefined) {
      this._timePrecision = opts.timePrecision
    }
    if (this._showTime === false) {
      this._activeSegment = null
      this._hoveredSegment = null
    }
    if (selectedTime) {
      this._selectedTime = normalizeTime(selectedTime)
      if (this._timePrecision === 'minute') this._selectedTime.second = 0
    }
    if (!this.visible) return
    this.requestPopupPaint()
  }

  open(opts: {
    anchor: PopupAnchor
    selected: CalendarDate | null
    selectedTime?: CalendarTime | null
    showTime?: boolean
    timePrecision?: CalendarTimePrecision
    onSelect: (date: CalendarDate, time?: CalendarTime) => boolean | void
    clearable?: boolean
    onClear?: () => boolean | void
    onTab?: (direction: 1 | -1) => void
    onClose: () => void
  }): void {
    if (this.popupOpen) this.close()
    const previousFocus = FocusManager.instance.current
    this._anchor = opts.anchor
    this._onSelect = opts.onSelect
    this._clearable = opts.clearable ?? false
    this._onClear = opts.onClear
    this._onTab = opts.onTab
    this._onClose = opts.onClose
    this._showTime = opts.showTime ?? false
    this._timePrecision = opts.timePrecision ?? 'second'

    const sel = opts.selected
    const t = today()
    this._calendar.reset(sel, t)
    this._hoveredFooter = null
    this._selectedTime = normalizeTime(opts.selectedTime)
    if (this._timePrecision === 'minute') this._selectedTime.second = 0
    this._activeSegment = null
    this._segmentInputBuffer = ''
    this._segmentInputFresh = true
    this._hoveredSegment = null

    this.resetPopupSurface()
    this.openPopup({ owner: resolvePopupAnchorTarget(opts.anchor) })
    if (previousFocus) FocusManager.instance.setFocus(previousFocus)
  }

  private _anchorRect(): { x: number; y: number; w: number; h: number } {
    const anchorRect = resolvePopupAnchorRect(this._anchor)
    return { x: anchorRect.x, y: anchorRect.y, w: anchorRect.w, h: anchorRect.h }
  }

  private _hitAnchor(point: Offset): boolean {
    const rect = this._anchorRect()
    return point.x >= rect.x && point.x <= rect.x + rect.w &&
      point.y >= rect.y && point.y <= rect.y + rect.h
  }

  onOutsidePointerDown(event: PopupPointerEvent): boolean {
    if (!this._hitAnchor(event.position)) return false
    this.close()
    return true
  }

  onWheel(_event: WheelPointerEvent): boolean {
    return true
  }

  private _handleSurfacePointerDown(event: PopupPointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    const point = event.position
    if (this._hitAnchor(point)) {
      this.close()
      return
    }
    const layout = this._layout(popupContext)
    const footer = this._footerBtnAt(point, layout)
    if (footer === 'today') { this._selectDate(today()); return }
    if (footer === 'clear') { this._clearAndClose(); return }
    if (footer === 'ok') { this._confirmAndClose(); return }
    if (footer === 'cancel') { this.close(); return }
    const segment = this._segmentAt(point, layout)
    if (segment) {
      this._activateSegment(segment)
      return
    }

    this._calendar.handlePointerDown(
      point,
      this._calendarRect(layout),
      layout.style,
    )
  }

  private _handleSurfacePointerMove(event: PopupPointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    const point = event.position
    const layout = this._layout(popupContext)
    let repaint = false

    const footer = this._footerBtnAt(point, layout)
    if (footer !== this._hoveredFooter) { this._hoveredFooter = footer; repaint = true }

    if (this._calendar.handlePointerMove(
      point,
      this._calendarRect(layout),
      layout.style,
    )) repaint = true

    const segment = this._segmentAt(point, layout)
    if (segment !== this._hoveredSegment) { this._hoveredSegment = segment; repaint = true }

    if (repaint) PopupManager.instance.requestPaint()
  }

  private _handleSurfacePointerUp(_event: PopupPointerEvent): void {}

  private _handleSurfaceHoverExit(_event: PopupPointerEvent): void {
    this._clearSurfaceHover()
  }

  private _handleSurfaceSequenceCancel(_event: PopupPointerEvent): void {
    this._clearSurfaceHover()
  }

  private _clearSurfaceHover(): void {
    let repaint = false
    if (this._calendar.clearHover()) repaint = true
    if (this._hoveredFooter !== null) {
      this._hoveredFooter = null
      repaint = true
    }
    if (this._hoveredSegment !== null) {
      this._hoveredSegment = null
      repaint = true
    }
    if (repaint) PopupManager.instance.requestPaint()
  }

  // ---- 内部逻辑 ----

  private _selectDate(d: CalendarDate): void {
    this._calendar.syncSelected(d)
  }

  private _confirmAndClose(tabDirection?: 1 | -1): boolean {
    this._commitActiveSegment()
    let accepted: boolean | void = true
    runCleanupSteps([
      () => {
        if (!this._selected) return
        if (this._showTime) accepted = this._onSelect?.(this._selected, { ...this._selectedTime })
        else accepted = this._onSelect?.(this._selected)
      },
      () => {
        if (accepted === false) PopupManager.instance.requestPaint()
        else {
          const onTab = this._onTab
          this.close()
          if (tabDirection && onTab) onTab(tabDirection)
        }
      },
    ])
    return (accepted as boolean | void) !== false
  }

  private _clearAndClose(): boolean {
    if (!this._clearable || this._onClear?.() === false) {
      this.requestPopupPaint()
      return false
    }
    this.close()
    return true
  }

  private _activateTimeSegment(segment: PopupTimeSegment): void {
    this._activateSegment(segment)
  }

  private _activateSegment(segment: PopupSegment): void {
    if (!this._showTime) return
    if (segment === 'second' && this._timePrecision !== 'second') return
    this._activeSegment = segment
    this._segmentInputBuffer = ''
    this._segmentInputFresh = true
    PopupManager.instance.requestPaint()
  }

  private _commitActiveSegment(): void {
    if (!this._activeSegment || this._segmentInputFresh || this._segmentInputBuffer === '') return
    this._setSegmentValue(this._activeSegment, Number(this._segmentInputBuffer))
    this._segmentInputBuffer = ''
    this._segmentInputFresh = true
  }

  private _setSegmentValue(segment: PopupSegment, value: number): void {
    if (!Number.isFinite(value)) return
    if (segment === 'year') {
      this._setSelectedDatePart('year', value)
      return
    }
    if (segment === 'month') {
      this._setSelectedDatePart('month', value)
      return
    }
    if (segment === 'day') {
      this._setSelectedDatePart('day', value)
      return
    }
    if (segment === 'hour') this._selectedTime.hour = Math.max(0, Math.min(23, value))
    if (segment === 'minute') this._selectedTime.minute = Math.max(0, Math.min(59, value))
    if (segment === 'second') this._selectedTime.second = Math.max(0, Math.min(59, value))
  }

  private _setSelectedDatePart(segment: PopupDateSegment, value: number): void {
    const base = this._selected ?? this._selectionBase()
    const year = segment === 'year' ? Math.max(1, Math.min(9999, Math.trunc(value))) : base.year
    const month = segment === 'month' ? Math.max(1, Math.min(12, Math.trunc(value))) : base.month
    const maxDay = daysInMonth(year, month)
    const day = segment === 'day' ? Math.max(1, Math.min(maxDay, Math.trunc(value))) : Math.min(base.day, maxDay)
    this._selectDate({ year, month, day })
  }

  private _stepSegment(segment: PopupSegment, delta: 1 | -1): void {
    this._commitActiveSegment()
    if (segment === 'year') { this._setSelectedDatePart('year', this._selectionBase().year + delta); return }
    if (segment === 'month') { this._selectDate(shiftMonths(this._selectionBase(), delta)); return }
    if (segment === 'day') { this._selectDate(shiftDays(this._selectionBase(), delta)); return }
    if (segment === 'hour') this._selectedTime.hour = (this._selectedTime.hour + delta + 24) % 24
    if (segment === 'minute') this._selectedTime.minute = (this._selectedTime.minute + delta + 60) % 60
    if (segment === 'second') this._selectedTime.second = (this._selectedTime.second + delta + 60) % 60
    PopupManager.instance.requestPaint()
  }

  private _advanceSegment(segment: PopupSegment): void {
    const order = this._visibleSegments()
    const next = order[order.indexOf(segment) + 1]
    this._activeSegment = next ?? null
    this._segmentInputBuffer = ''
    this._segmentInputFresh = true
    PopupManager.instance.requestPaint()
  }

  private _visibleSegments(): PopupSegment[] {
    return this._timePrecision === 'second'
      ? ['year', 'month', 'day', 'hour', 'minute', 'second']
      : ['year', 'month', 'day', 'hour', 'minute']
  }

  private _segmentInputLength(segment: PopupSegment): number {
    return segment === 'year' ? 4 : 2
  }

  private _segmentFirstDigitMax(segment: PopupSegment): number | null {
    if (segment === 'year') return null
    if (segment === 'month') return 1
    if (segment === 'day') return 3
    if (segment === 'hour') return 2
    return 5
  }

  private _selectionBase(): CalendarDate {
    if (this._selected) return this._selected
    const td = today()
    if (td.year === this._viewYear && td.month === this._viewMonth) return td
    return { year: this._viewYear, month: this._viewMonth, day: 1 }
  }

  // ---- 命中检测 ----

  private _layout(popupContext: PopupContext): {
    anchorRect: { x: number; y: number; w: number; h: number }
    style: DatePickerStyleTokens
    popupStyle: PopupStyleTokens
    cs: number
    headerH: number
    timeH: number
    footerH: number
    panelX: number
    panelY: number
    panelW: number
    panelH: number
  } {
    const style = deriveDatePickerStyle(popupContext.theme)
    const popupStyle = derivePopupStyle(popupContext.theme)
    const cs = style.cellSize
    const headerH = style.headerHeight
    const timeH = this._showTime ? cs + style.padding : 0
    const footerH = style.footerHeight
    const calendarW = cs * 7 + style.padding * 2
    const segmentW = this._showTime ? this._segmentRowWidth(style) + style.padding * 2 : 0
    const panelW = Math.max(calendarW, segmentW)
    const panelH = headerH + cs + cs * 6 + style.padding + timeH + footerH
    const anchorRect = resolvePopupAnchorRect(this._anchor)

    let panelX = anchorRect.x
    let panelY = anchorRect.y + anchorRect.h + 4
    panelX = clampXToPopupViewport(panelX, panelW, popupContext, 4)
    if (panelY + panelH > (popupContext.viewport.y ?? 0) + popupContext.viewport.height - 4) panelY = anchorRect.y - panelH - 4
    panelY = Math.max((popupContext.viewport.y ?? 0) + 4, panelY)

    return { anchorRect, style, popupStyle, cs, headerH, timeH, footerH, panelX, panelY, panelW, panelH }
  }

  private _calendarRect(layout: ReturnType<DatePickerPopup['_layout']>) {
    return {
      x: layout.panelX,
      y: layout.panelY,
      width: layout.panelW,
    }
  }

  private _footerBtnAt(p: Offset, layout: ReturnType<DatePickerPopup['_layout']>): 'today' | 'clear' | 'ok' | 'cancel' | null {
    const footerY = layout.panelY + layout.panelH - layout.footerH
    if (p.y < footerY || p.y > footerY + layout.footerH) return null
    const count = this._clearable ? 4 : 3
    const btnW = (layout.panelW - layout.style.padding * 2) / count
    const col = Math.floor((p.x - layout.panelX - layout.style.padding) / btnW)
    if (col === 0) return 'today'
    if (this._clearable && col === 1) return 'clear'
    if (col === count - 2) return 'ok'
    if (col === count - 1) return 'cancel'
    return null
  }

  private _timeRowY(layout: ReturnType<DatePickerPopup['_layout']>): number {
    return layout.panelY + layout.headerH + layout.cs + layout.cs * 6 + layout.style.padding
  }

  private _segmentRowWidth(style: DatePickerStyleTokens): number {
    const fs = style.fontSize
    const font = style.fontFamily
    const digitW = Math.max(fs * 0.56, TextMeasurer.measureWidth('0', fs, font))
    const fieldPadding = Math.max(3, Math.floor(style.padding / 2))
    const yearW = Math.ceil(digitW * 4 + fieldPadding * 2)
    const fieldW = Math.ceil(digitW * 2 + fieldPadding * 2)
    const dateSeparatorW = Math.max(4, TextMeasurer.measureWidth('-', fs, font))
    const timeSeparatorW = Math.max(4, TextMeasurer.measureWidth(':', fs, font))
    const groupGap = Math.max(8, style.padding)
    return this._timePrecision === 'second'
      ? yearW + fieldW * 5 + dateSeparatorW * 2 + timeSeparatorW * 2 + groupGap
      : yearW + fieldW * 4 + dateSeparatorW * 2 + timeSeparatorW + groupGap
  }

  private _segmentRects(layout: ReturnType<DatePickerPopup['_layout']>): Record<PopupSegment, { x: number; y: number; w: number; h: number }> {
    const s = layout.style
    const fs = s.fontSize
    const font = s.fontFamily
    const digitW = Math.max(fs * 0.56, TextMeasurer.measureWidth('0', fs, font))
    const fieldPadding = Math.max(3, Math.floor(s.padding / 2))
    const yearW = Math.ceil(digitW * 4 + fieldPadding * 2)
    const fieldW = Math.ceil(digitW * 2 + fieldPadding * 2)
    const dateSeparatorW = Math.max(4, TextMeasurer.measureWidth('-', fs, font))
    const timeSeparatorW = Math.max(4, TextMeasurer.measureWidth(':', fs, font))
    const groupGap = Math.max(8, s.padding)
    const totalW = this._segmentRowWidth(s)
    const y = this._timeRowY(layout) + s.padding / 2
    let x = layout.panelX + (layout.panelW - totalW) / 2
    const year = { x, y, w: yearW, h: layout.cs }
    x += yearW + dateSeparatorW
    const month = { x, y, w: fieldW, h: layout.cs }
    x += fieldW + dateSeparatorW
    const day = { x, y, w: fieldW, h: layout.cs }
    x += fieldW + groupGap
    const hour = { x, y, w: fieldW, h: layout.cs }
    x += fieldW + timeSeparatorW
    const minute = { x, y, w: fieldW, h: layout.cs }
    x += fieldW + timeSeparatorW
    const second = { x, y, w: fieldW, h: layout.cs }
    return { year, month, day, hour, minute, second }
  }

  private _segmentAt(p: Offset, layout: ReturnType<DatePickerPopup['_layout']>): PopupSegment | null {
    if (!this._showTime) return null
    const rects = this._segmentRects(layout)
    for (const segment of this._visibleSegments()) {
      const rect = rects[segment]
      if (p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) return segment
    }
    return null
  }

  // ---- 键盘 ----

  onEscape(e: KeyboardEvent): boolean {
    if (!this.visible) return false
    e.preventDefault()
    this.close()
    return true
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (!this.visible) return false
    if (e.key === 'Tab' && this._onTab) {
      e.preventDefault()
      e.stopPropagation()
      this._confirmAndClose(e.shiftKey ? -1 : 1)
      return true
    }
    if (this._activeSegment) {
      const segment = this._activeSegment
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault()
        if (this._segmentInputFresh) { this._segmentInputBuffer = ''; this._segmentInputFresh = false }
        this._segmentInputBuffer += e.key
        const targetLength = this._segmentInputLength(segment)
        const firstDigitMax = this._segmentFirstDigitMax(segment)
        const complete = this._segmentInputBuffer.length >= targetLength
          || (this._segmentInputBuffer.length === 1 && firstDigitMax !== null && Number(this._segmentInputBuffer) > firstDigitMax)
        if (complete) {
          this._setSegmentValue(segment, Number(this._segmentInputBuffer))
          this._segmentInputBuffer = ''
          this._segmentInputFresh = true
          if (segment === 'year' || segment === 'month') {
            this._advanceSegment(segment)
          } else {
            PopupManager.instance.requestPaint()
          }
        } else {
          PopupManager.instance.requestPaint()
        }
        return true
      }
      if (e.key === 'Backspace') {
        e.preventDefault()
        if (this._segmentInputFresh) { this._segmentInputBuffer = ''; this._segmentInputFresh = false }
        this._segmentInputBuffer = this._segmentInputBuffer.slice(0, -1)
        PopupManager.instance.requestPaint()
        return true
      }
      if (e.key === 'ArrowUp') { e.preventDefault(); this._stepSegment(segment, 1); return true }
      if (e.key === 'ArrowDown') { e.preventDefault(); this._stepSegment(segment, -1); return true }
      if (e.key === 'Tab') {
        e.preventDefault()
        this._commitActiveSegment()
        this._advanceSegment(segment)
        return true
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        this._commitActiveSegment()
        this._confirmAndClose()
        return true
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        this._activeSegment = null
        this._segmentInputBuffer = ''
        this._segmentInputFresh = true
        PopupManager.instance.requestPaint()
        return true
      }
      return false
    }
    if (e.key === 'Tab') {
      this.close()
      return false
    }
    const result = this._calendar.handleKeyDown(e)
    if (result.activatedDate) this._confirmAndClose()
    return result.handled
  }

  // ---- 绘制 ----

  protected override onPopupClose(): void {
    super.onPopupClose()
    this._onClose?.()
  }

  private _paintSurface(context: PaintContext, offset: Offset): void {
    const layout = this._layout(PopupManager.instance.context)
    const dl = new DrawList(context)
    const s = layout.style
    const cs = layout.cs
    const px = offset.x
    const py = offset.y
    const pw = layout.panelW
    const ph = layout.panelH

    // 面板背景
    drawPopupPanel(dl, px, py, pw, ph, layout.popupStyle)
    this._calendar.paint(
      context,
      dl,
      { x: px, y: py, width: pw },
      s,
      layout.popupStyle,
    )

    if (this._showTime) {
      this._paintTimeRow(dl, layout, offset)
    }

    // ---- 底部按钮 ----
    const footerY = py + ph - layout.footerH
    dl.line(px + s.padding, footerY, px + pw - s.padding, footerY, s.separator, 1)
    const footerBtns: Array<{ key: 'today' | 'clear' | 'ok' | 'cancel'; label: string }> = [
      { key: 'today', label: '今天' },
      ...(this._clearable ? [{ key: 'clear' as const, label: '清空' }] : []),
      { key: 'ok', label: '确定' },
      { key: 'cancel', label: '取消' },
    ]
    const btnW = (pw - s.padding * 2) / footerBtns.length
    const btnMidY = footerY + layout.footerH / 2
    for (let i = 0; i < footerBtns.length; i++) {
      const b = footerBtns[i]!
      const bx = px + s.padding + i * btnW
      const isHov = this._hoveredFooter === b.key
      if (isHov) {
        dl.fillRect(
          bx + 2,
          footerY + s.padding / 2,
          btnW - 4,
          layout.footerH - s.padding,
          resolveBgColor(s.footerButtonBg, 'hovered'),
          layout.popupStyle.borderRadius,
        )
      }
      const color = b.key === 'ok' ? s.accentText : b.key === 'cancel' ? s.textDisabled : s.text
      dl.fillText(b.label, bx + btnW / 2, btnMidY, color, s.fontSize, s.fontFamily, 'center', 'middle')
      if (i < footerBtns.length - 1) dl.line(bx + btnW, footerY + 4, bx + btnW, footerY + layout.footerH - 4, s.separator, 1)
    }
  }

  private _paintTimeRow(dl: DrawList, layout: ReturnType<DatePickerPopup['_layout']>, offset: Offset): void {
    const s = layout.style
    const y = this._timeRowY(layout) - layout.panelY + offset.y
    const panelX = offset.x
    dl.line(panelX + s.padding, y, panelX + layout.panelW - s.padding, y, s.separator, 1)
    const rects = this._segmentRects(layout)
    const selected = this._selected ?? this._selectionBase()
    const values: Record<PopupSegment, number> = {
      year: selected.year,
      month: selected.month,
      day: selected.day,
      hour: this._selectedTime.hour,
      minute: this._selectedTime.minute,
      second: this._selectedTime.second,
    }
    const lengths: Record<PopupSegment, number> = {
      year: 4,
      month: 2,
      day: 2,
      hour: 2,
      minute: 2,
      second: 2,
    }
    for (const segment of this._visibleSegments()) {
      const source = rects[segment]
      const rect = {
        x: source.x - layout.panelX + offset.x,
        y: source.y - layout.panelY + offset.y,
        w: source.w,
        h: source.h,
      }
      const isSelected = this._activeSegment === segment
      const state = {
        selected: isSelected,
        hovered: this._hoveredSegment === segment,
      }
      const segmentBackground = resolveBgColor(s.cellBg, state)
      if (segmentBackground.a > 0) {
        dl.fillRect(rect.x, rect.y, rect.w, rect.h, segmentBackground, layout.popupStyle.borderRadius)
      }
      let text = String(values[segment]).padStart(lengths[segment], '0')
      if (isSelected && !this._segmentInputFresh) {
        text = this._segmentInputBuffer.padStart(lengths[segment], '_')
      }
      dl.fillText(
        text,
        rect.x + rect.w / 2,
        rect.y + rect.h / 2,
        isSelected ? s.contrastText : s.text,
        s.fontSize,
        s.fontFamily,
        'center',
        'middle',
      )
    }
    const year = rects.year
    const month = rects.month
    const day = rects.day
    const hour = rects.hour
    const minute = rects.minute
    const sepY = y + s.padding / 2 + layout.cs / 2
    dl.fillText('-', (year.x + year.w + month.x) / 2 - layout.panelX + offset.x, sepY, s.textDisabled, s.fontSize, s.fontFamily, 'center', 'middle')
    dl.fillText('-', (month.x + month.w + day.x) / 2 - layout.panelX + offset.x, sepY, s.textDisabled, s.fontSize, s.fontFamily, 'center', 'middle')
    dl.fillText(':', (hour.x + hour.w + minute.x) / 2 - layout.panelX + offset.x, sepY, s.textDisabled, s.fontSize, s.fontFamily, 'center', 'middle')
    if (this._timePrecision === 'second') {
      const second = rects.second
      dl.fillText(':', (minute.x + minute.w + second.x) / 2 - layout.panelX + offset.x, sepY, s.textDisabled, s.fontSize, s.fontFamily, 'center', 'middle')
    }
  }

  dispose(): void {
    this.close()
    this.disposePopupSurface()
  }
}

// ---- RenderDatePicker（分段输入框）----
// 显示格式：日历图标 + YYYY-MM-DD，或日历图标 + YYYY-MM-DD HH:mm:ss
// 点击日期段 → 打开日历 popup
// 点击时间段（showTime=true）→ 直接键盘输入，输完自动跳下一段

type DateSegment = 'year' | 'month' | 'day'
type TimeSegment = 'hour' | 'minute' | 'second'
type ActiveSegment = DateSegment | TimeSegment | null

export type DatePickerValueChangeReason = 'selection' | 'segment' | 'step' | 'clear'

export interface DatePickerValueChangeDetail {
  readonly direction: 1 | -1
}

export class RenderDatePicker extends RenderBox implements
  InteractiveRenderObject,
  Focusable,
  ValueEditor<ISODate, DatePickerValueChangeReason, DatePickerValueChangeDetail> {
  static override debugTypeName = 'RenderDatePicker'
  private _value: ISODate = ''
  get value(): ISODate { return this._value }
  set value(v: ISODate) {
    if (v === this._value) return
    this._value = v
    this._parseValue()
    if (this._popup.visible) {
      this._popup.syncSelected(this._hasDate ? {
        year: this._year,
        month: this._month,
        day: this._day,
      } : null)
    }
    this.markNeedsPaint()
  }

  getValue(): ISODate {
    return this.value
  }

  setValue(value: ISODate): void {
    if (value === this._value) return
    this.cancelEdit()
    this.value = value
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<
      ISODate,
      DatePickerValueChangeReason,
      DatePickerValueChangeDetail
    >,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: ValueEditorBlurListener): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
  }

  placeholder: string
  onChange?: (value: ISODate) => void
  private _disabled: boolean
  private _readonly: boolean
  private _status: FormFieldStatus
  private _helperText: string
  private _prefixText: string
  private _suffixText: string
  private _clearable: boolean
  private _focusRegistered = false
  private readonly _valueEditorEvents = new ValueEditorEventEmitter<
    ISODate,
    DatePickerValueChangeReason,
    DatePickerValueChangeDetail
  >()

  private _hovered = false
  private _focused = false
  private _popup: DatePickerPopup
  private _showTime: boolean
  private _timePrecision: CalendarTimePrecision

  // 当前激活的输入段
  private _activeSegment: ActiveSegment = null
  // 输入缓冲
  private _inputBuffer = ''
  private _inputFresh = true
  // 解析后的各段值（用于分段显示和编辑）
  private _year = 0
  private _month = 0
  private _day = 0
  private _hour = 0
  private _minute = 0
  private _second = 0
  private _hasDate = false  // 是否已有有效日期

  constructor(opts: {
    value?: ISODate
    placeholder?: string
    showTime?: boolean
    timePrecision?: CalendarTimePrecision
    onChange?: (value: ISODate) => void
    disabled?: boolean
    readonly?: boolean
    status?: FormFieldStatus
    helperText?: string
    prefixText?: string
    suffixText?: string
    clearable?: boolean
  }) {
    super()
    this._value = opts.value ?? ''
    this.placeholder = opts.placeholder ?? (opts.showTime ? '选择日期时间' : '选择日期')
    this.onChange = opts.onChange
    this._popup = new DatePickerPopup()
    this._showTime = opts.showTime ?? false
    this._timePrecision = opts.timePrecision ?? 'second'
    this._disabled = opts.disabled ?? false
    this._readonly = opts.readonly ?? false
    this._status = opts.status ?? 'default'
    this._helperText = opts.helperText ?? ''
    this._prefixText = opts.prefixText ?? ''
    this._suffixText = opts.suffixText ?? ''
    this._clearable = opts.clearable ?? false
    this._parseValue()
    this._syncFocusRegistration()
  }

  get disabled(): boolean { return this._disabled }
  set disabled(disabled: boolean) {
    if (this._disabled === disabled) return
    this._disabled = disabled
    if (disabled) {
      runCleanupSteps([
        () => { this._hovered = false },
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
    if (this._readonly === readonly) return
    this._readonly = readonly
    if (readonly) {
      runCleanupSteps([
        () => { this._hovered = false },
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

  get clearable(): boolean { return this._clearable }
  set clearable(clearable: boolean) {
    if (this._clearable === clearable) return
    this._clearable = clearable
    this.markNeedsPaint()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  [GET_POPUP_ANCHOR_RECT](): { x: number; y: number; width: number; height: number } {
    const g = this.globalOffset
    return { x: g.x, y: g.y, width: this.size.width, height: this._inputStyle().height }
  }

  // ---- Focusable ----
  get isFocused(): boolean {
    return this._focused ||
      this._activeSegment !== null ||
      this._popup.visible
  }
  focusIn(): void {
    if (this.disabled || this.readonly) return
    if (this._focused) return
    this._focused = true
    this.markNeedsPaint()
  }
  focusOut(): void {
    const wasFocused = this._focused || this._activeSegment !== null
    if (!wasFocused) return
    const movingIntoOwnedPopup = this._popup.visible
    this._focused = false
    this._deactivate()
    this.markNeedsPaint()
    if (!movingIntoOwnedPopup) this._valueEditorEvents.emitBlur()
  }

  private _endLogicalFocusSession(): void {
    const wasFocused = this.isFocused
    runCleanupSteps([
      () => this._popup.close(),
      () => {
        this._focused = false
        this._deactivate()
      },
      () => { if (wasFocused) this._valueEditorEvents.emitBlur() },
    ])
  }

  requestFocus(): void {
    if (this.disabled || this.readonly || typeof window === 'undefined') return
    FocusManager.instance.setFocus(this)
  }

  blur(): void {
    this._popup.close()
    this.cancelEdit()
    if (typeof window === 'undefined') {
      this.focusOut()
      return
    }
    FocusManager.instance.clearFocusOf(this)
  }

  commitEdit(): boolean {
    const segment = this._activeSegment
    if (!segment || this._inputFresh || this._inputBuffer === '') return true
    const value = parseInt(this._inputBuffer, 10)
    if (isNaN(value)) return false
    runCleanupSteps([
      () => this._commitSegment(segment, value),
      () => this._clearPendingSegmentInput(),
    ])
    return true
  }

  cancelEdit(): void {
    this._clearPendingSegmentInput()
  }
  onKeyDown(event: KeyboardEvent): boolean {
    if (this.disabled) return false
    if (this.readonly) {
      if (event.key === 'Escape' && this._popup.visible) {
        event.preventDefault()
        this._popup.close()
        this.markNeedsPaint()
        return true
      }
      return false
    }
    const seg = this._activeSegment
    if (!seg) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault()
        this._openPopup()
        return true
      }
      if (event.key === 'Escape' && this._popup.visible) {
        event.preventDefault()
        this._popup.close()
        this.markNeedsPaint()
        return true
      }
      return false
    }

    if (event.key >= '0' && event.key <= '9') {
      event.preventDefault()
      if (this._inputFresh) { this._inputBuffer = ''; this._inputFresh = false }
      this._inputBuffer += event.key

      const maxLen = seg === 'year' ? 4 : 2
      const val = parseInt(this._inputBuffer, 10)

      const maxFirstDigit: Partial<Record<DateSegment | TimeSegment, number>> = {
        month: 1, day: 3, hour: 2, minute: 5, second: 5,
      }
      const mfd = maxFirstDigit[seg]
      const shouldCommit = this._inputBuffer.length >= maxLen ||
        (mfd !== undefined && this._inputBuffer.length === 1 && +this._inputBuffer[0]! > mfd)

      if (shouldCommit) {
        runCleanupSteps([
          () => this._commitSegment(seg, val),
          () => this._advanceSegment(seg),
        ])
      } else {
        this.markNeedsPaint()
      }
      return true
    }

    if (event.key === 'Backspace') {
      event.preventDefault()
      if (this._inputFresh) { this._inputBuffer = ''; this._inputFresh = false }
      this._inputBuffer = this._inputBuffer.slice(0, -1)
      this.markNeedsPaint()
      return true
    }

    if (event.key === 'ArrowUp')   { event.preventDefault(); this._stepSeg(seg, 1);  return true }
    if (event.key === 'ArrowDown') { event.preventDefault(); this._stepSeg(seg, -1); return true }

    if (event.key === 'Tab') {
      event.preventDefault()
      runCleanupSteps([
        () => this._commitSegment(seg, parseInt(this._inputBuffer || '0', 10)),
        () => this._advanceSegment(seg),
      ])
      return true
    }

    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault()
      runCleanupSteps([
        () => this._commitSegment(seg, parseInt(this._inputBuffer || '0', 10)),
        () => this._deactivate(),
      ])
      return true
    }
    return false
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const inputStyle = this._inputTokens(context.theme)
    this.size = {
      width: constraints.maxWidth === Infinity ? (this._showTime ? this._dateTimeWidthHint() : 140) : constraints.maxWidth,
      height: measureFormFieldHeight(inputStyle, inputStyle.height, this.helperText),
    }
  }

  override getMinLayoutWidthHint(): number | undefined {
    return this._showTime ? this._dateTimeWidthHint() : 140
  }

  private _parseValue(): void {
    const date = parseISO(this._value)
    if (date) {
      this._year = date.year; this._month = date.month; this._day = date.day
      this._hasDate = true
    } else {
      this._year = 0; this._month = 0; this._day = 0
      this._hasDate = false
    }
    const time = extractTimeValue(this._value)
    this._hour = time?.hour ?? 0
    this._minute = time?.minute ?? 0
    this._second = time?.second ?? 0
    if (this._timePrecision === 'minute') this._second = 0
  }

  private _buildValue(): string {
    if (!this._hasDate) return ''
    const dateStr = toISO({ year: this._year, month: this._month, day: this._day })
    if (!this._showTime) return dateStr
    return `${dateStr}T${formatTimeValue({
      hour: this._hour,
      minute: this._minute,
      second: this._second,
    }, this._timePrecision)}`
  }

  private _displayValue(): string {
    if (!this._hasDate) return ''
    const dateStr = toISO({ year: this._year, month: this._month, day: this._day })
    if (!this._showTime) return dateStr
    return `${dateStr} ${formatTimeValue({
      hour: this._hour,
      minute: this._minute,
      second: this._second,
    }, this._timePrecision)}`
  }

  private _dateTimeWidthHint(): number {
    return this._timePrecision === 'minute' ? 190 : 220
  }

  private _segmentMetrics(style: TextInputStyleTokens = this._inputStyle()) {
    const fs = style.fontSize
    const font = style.fontFamily
    const digitW = Math.max(fs * 0.56, TextMeasurer.measureWidth('0', fs, font))
    const dateSepW = Math.max(4, TextMeasurer.measureWidth('-', fs, font))
    const timeSepW = Math.max(4, TextMeasurer.measureWidth(':', fs, font))
    const dateSepPad = 0
    const timeSepPad = 0
    const timeGapW = TextMeasurer.measureWidth(' ', fs, font)
    return { digitW, dateSepW, timeSepW, dateSepPad, timeSepPad, timeGapW }
  }

  // 各段在输入框内的 x 范围（相对于 widget 左边）
  private _segmentRects(style: TextInputStyleTokens = this._inputStyle()): Record<DateSegment | TimeSegment, { x: number; w: number }> {
    const startX = this._triggerLocalLayout(style).valueRect.x
    const { digitW, dateSepW, timeSepW, dateSepPad, timeSepPad, timeGapW } = this._segmentMetrics(style)

    const yearW  = digitW * 4
    const monthW = digitW * 2
    const dayW   = digitW * 2
    const hourW  = digitW * 2
    const minW   = digitW * 2
    const secW   = digitW * 2
    const dateSepSlot = dateSepW + dateSepPad * 2
    const timeSepSlot = timeSepW + timeSepPad * 2

    let x = startX
    const year  = { x, w: yearW };  x += yearW + dateSepSlot
    const month = { x, w: monthW }; x += monthW + dateSepSlot
    const day   = { x, w: dayW };   x += dayW

    if (this._showTime) x += timeGapW

    const hour   = { x, w: hourW };  x += hourW + timeSepSlot
    const minute = { x, w: minW };   x += minW + timeSepSlot
    const second = { x, w: secW }

    return { year, month, day, hour, minute, second }
  }

  private _segmentAt(localX: number): ActiveSegment {
    const rects = this._segmentRects()
    for (const [seg, rect] of Object.entries(rects) as Array<[ActiveSegment, { x: number; w: number }]>) {
      if (!this._showTime && (seg === 'hour' || seg === 'minute' || seg === 'second')) continue
      if (this._timePrecision === 'minute' && seg === 'second') continue
      if (localX >= rect.x && localX <= rect.x + rect.w) return seg
    }
    return null
  }

  private _activateSegment(seg: ActiveSegment): void {
    if (this._activeSegment === seg && !this._inputFresh) return
    this._activeSegment = seg
    this._inputBuffer = ''
    this._inputFresh = true

    if (seg && this._popup.visible) {
      // 所有段都走键盘输入，关闭 popup。
      this._popup.close()
    }
    this.markNeedsPaint()
  }

  private _openPopup(): void {
    if (this.disabled || this.readonly) return
    if (this._popup.visible) {
      this._popup.close()
      this.markNeedsPaint()
      return
    }
    this._deactivate()
    this._popup.open({
      anchor: this as PopupAnchorTarget,
      selected: this._hasDate ? { year: this._year, month: this._month, day: this._day } : null,
      selectedTime: { hour: this._hour, minute: this._minute, second: this._second },
      showTime: this._showTime,
      timePrecision: this._timePrecision,
      onSelect: (d, time) => {
        const previousValue = this._value
        this._year = d.year; this._month = d.month; this._day = d.day
        this._hasDate = true
        if (this._showTime) {
          this._hour = time?.hour ?? this._hour
          this._minute = time?.minute ?? this._minute
          this._second = time?.second ?? this._second
          if (this._timePrecision === 'minute') this._second = 0
        }
        this._value = this._buildValue()
        this._publishValueChange(previousValue, 'selection')
        this.markNeedsPaint()
      },
      onClose: () => {
        this._activeSegment = null
        this.markNeedsPaint()
      },
    })
    this.markNeedsPaint()
  }


  private _commitSegment(seg: DateSegment | TimeSegment, val: number): void {
    if (isNaN(val)) return
    const previousValue = this._value
    if (seg === 'year')   this._year   = Math.max(1, Math.min(9999, val))
    if (seg === 'month')  this._month  = Math.max(1, Math.min(12, val))
    if (seg === 'day')    this._day    = Math.max(1, Math.min(daysInMonth(this._year || new Date().getFullYear(), this._month || 1), val))
    if (seg === 'hour')   this._hour   = Math.max(0, Math.min(23, val))
    if (seg === 'minute') this._minute = Math.max(0, Math.min(59, val))
    if (seg === 'second') this._second = Math.max(0, Math.min(59, val))
    if (this._year > 0 && this._month > 0 && this._day > 0) this._hasDate = true
    // 年/月变化时同步日历视图
    if ((seg === 'year' || seg === 'month') && this._popup.visible) {
      this._popup.syncView(this._year, this._month)
    }
    if (!this._hasDate) return
    this._value = this._buildValue()
    this._publishValueChange(previousValue, 'segment')
  }

  private _stepSeg(seg: DateSegment | TimeSegment, dir: 1 | -1): void {
    const previousValue = this._value
    const y = this._year  || new Date().getFullYear()
    const mo = this._month || 1
    if (seg === 'year')   this._year   = Math.max(1, (this._year   || new Date().getFullYear()) + dir)
    if (seg === 'month')  this._month  = ((mo - 1 + dir + 12) % 12) + 1
    if (seg === 'day')    this._day    = ((this._day - 1 + dir + daysInMonth(y, mo)) % daysInMonth(y, mo)) + 1
    if (seg === 'hour')   this._hour   = (this._hour   + dir + 24) % 24
    if (seg === 'minute') this._minute = (this._minute + dir + 60) % 60
    if (seg === 'second') this._second = (this._second + dir + 60) % 60
    this._inputBuffer = ''
    this._inputFresh = true
    if (this._year > 0 && this._month > 0 && this._day > 0) this._hasDate = true
    // 年/月变化时同步日历视图
    if ((seg === 'year' || seg === 'month') && this._popup.visible) {
      this._popup.syncView(this._year, this._month)
    }
    if (!this._hasDate) { this.markNeedsPaint(); return }
    this._value = this._buildValue()
    runCleanupSteps([
      () => this._publishValueChange(previousValue, 'step', { direction: dir }),
      () => this.markNeedsPaint(),
    ])
  }

  private _advanceSegment(seg: DateSegment | TimeSegment): void {
    const order: Array<DateSegment | TimeSegment> = this._showTime
      ? this._timePrecision === 'minute'
        ? ['year', 'month', 'day', 'hour', 'minute']
        : ['year', 'month', 'day', 'hour', 'minute', 'second']
      : ['year', 'month', 'day']
    const idx = order.indexOf(seg)
    const next = order[idx + 1]
    if (next) {
      this._activeSegment = next
      this._inputBuffer = ''
      this._inputFresh = true
    } else {
      this._deactivate()
    }
    this.markNeedsPaint()
  }

  private _deactivate(): void {
    this._activeSegment = null
    this._inputBuffer = ''
    this._inputFresh = true
    this.markNeedsPaint()
  }

  private _clearPendingSegmentInput(): void {
    if (this._inputBuffer === '' && this._inputFresh) return
    this._inputBuffer = ''
    this._inputFresh = true
    this.markNeedsPaint()
  }

  private _publishValueChange(
    previousValue: ISODate,
    reason: DatePickerValueChangeReason,
    detail?: DatePickerValueChangeDetail,
  ): void {
    const steps: DisposeFn[] = [
      () => this.onChange?.(this._value),
    ]
    if (previousValue !== this._value) {
      steps.push(() => this._valueEditorEvents.emitValueChange({
        value: this._value,
        previousValue,
        reason,
        detail,
      }))
    }
    runCleanupSteps(steps)
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w } = this.size
    const s = this._inputTokens(context.theme)
    const readonlyVisual = this.readonly && !this.disabled
    const textColor = resolveFormFieldTextColor(s, this.disabled)
    const placeholderColor = resolveFormFieldPlaceholderColor(s, this.disabled)
    const shell = paintTriggerFieldShell(context, offset, w, {
      focused: readonlyVisual ? false : this._popup.visible || this._focused || this._activeSegment !== null,
      hovered: readonlyVisual ? false : this._hovered,
      disabled: this.disabled,
      status: this.status,
      helperText: this.helperText,
      leadingIcon: 'calendar',
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      showClearButton: this._showClearButton(),
      reserveTrailingWidth: s.fontSize,
      trailingIcon: this._popup.visible ? 'chevron-up' : 'chevron-down',
      trailingIconColor: this.disabled
        ? s.textDisabled
        : readonlyVisual ? placeholderColor : textColor,
    })
    const fieldHeight = shell.fieldHeight

    const isOpen = this._popup.visible
    const isActive = this._activeSegment !== null

    if (shell.valueRect.w > 0) {
      dl.pushClip(shell.valueRect.x, y + 2, shell.valueRect.w, fieldHeight - 4)

      if (!this._hasDate && !this._activeSegment) {
        // placeholder
        const rects = this._segmentRects(s)
        paintSingleLineText(dl, {
          text: this.placeholder,
          x: x + rects.year.x,
          y: y + fieldHeight / 2,
          maxWidth: Math.max(0, shell.valueRect.x + shell.valueRect.w - (x + rects.year.x)),
          color: placeholderColor,
          fontSize: s.fontSize,
          fontFamily: s.fontFamily,
        })
      } else if (!isActive) {
        const rects = this._segmentRects(s)
        paintSingleLineText(dl, {
          text: this._displayValue(),
          x: x + rects.year.x,
          y: y + fieldHeight / 2,
          maxWidth: Math.max(0, shell.valueRect.x + shell.valueRect.w - (x + rects.year.x)),
          color: textColor,
          fontSize: s.fontSize,
          fontFamily: s.fontFamily,
        })
      } else {
        // 分段绘制
        const rects = this._segmentRects(s)
        const segments: Array<{ key: DateSegment | TimeSegment; val: number; len: number }> = [
          { key: 'year',   val: this._year,   len: 4 },
          { key: 'month',  val: this._month,  len: 2 },
          { key: 'day',    val: this._day,    len: 2 },
          ...(this._showTime ? [
            { key: 'hour'   as TimeSegment, val: this._hour,   len: 2 },
            { key: 'minute' as TimeSegment, val: this._minute, len: 2 },
            ...(this._timePrecision === 'second' ? [{ key: 'second' as TimeSegment, val: this._second, len: 2 }] : []),
          ] : []),
        ]

        for (const seg of segments) {
          const rect = rects[seg.key]
          const isActiveSeg = this._activeSegment === seg.key

          // 激活段高亮背景
          if (isActiveSeg) {
            dl.fillRect(x + rect.x - 2, y + 2, rect.w + 4, fieldHeight - 4, s.focusedBorder, s.borderRadius)
          }

          // 显示值
          let displayStr: string
          if (isActiveSeg && !this._inputFresh) {
            displayStr = this._inputBuffer.padStart(seg.len, '_')
          } else {
            const isDateSeg = seg.key === 'year' || seg.key === 'month' || seg.key === 'day'
            displayStr = (this._hasDate || !isDateSeg)
              ? String(seg.val).padStart(seg.len, '0')
              : ''.padStart(seg.len, '-')
          }

          const color = isActiveSeg ? s.contrastText : (this._hasDate ? textColor : placeholderColor)
          dl.fillText(displayStr, x + rect.x, y + fieldHeight / 2, color, s.fontSize, s.fontFamily, 'left', 'middle')
        }

        // 分隔符
        const fs = s.fontSize
        const { dateSepPad, timeSepPad, timeGapW } = this._segmentMetrics(s)
        const sepColor = placeholderColor
        const r = rects
        dl.fillText('-', x + r.year.x + r.year.w + dateSepPad,   y + fieldHeight / 2, sepColor, fs, s.fontFamily, 'left', 'middle')
        dl.fillText('-', x + r.month.x + r.month.w + dateSepPad, y + fieldHeight / 2, sepColor, fs, s.fontFamily, 'left', 'middle')
        if (this._showTime) {
          dl.fillText(' ', x + r.day.x + r.day.w + Math.max(0, Math.floor((timeGapW - TextMeasurer.measureWidth(' ', fs, s.fontFamily)) / 2)), y + fieldHeight / 2, sepColor, fs, s.fontFamily, 'left', 'middle')
          dl.fillText(':', x + r.hour.x + r.hour.w + timeSepPad,   y + fieldHeight / 2, sepColor, fs, s.fontFamily, 'left', 'middle')
          if (this._timePrecision === 'second') {
            dl.fillText(':', x + r.minute.x + r.minute.w + timeSepPad, y + fieldHeight / 2, sepColor, fs, s.fontFamily, 'left', 'middle')
          }
        }
      }

      dl.popClip()
    }

  }

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this.disabled || this.readonly || !this._hitField(e.position)) return
    const layout = this._triggerLayout()
    if (pointInFormFieldRect(layout.clearRect, e.position)) {
      this._clearValue()
      return
    }
    FocusManager.instance.setFocus(this)
    if (pointInFormFieldRect(layout.trailingRect, e.position)) {
      this._openPopup()
      this.markNeedsPaint()
      return
    }
    const localX = e.position.x - this.globalOffset.x
    const seg = this._segmentAt(localX)

    if (seg) {
      // 点击任意段 → 键盘输入模式
      if (this._activeSegment !== seg) {
        this._activateSegment(seg)
      }
    } else {
      // 点击图标或箭头区域 → 切换日历 popup
      this._openPopup()
    }
    this.markNeedsPaint()
  }

  onPointerMove(e: PointerEvent): void {
    const wasHovered = this._hovered
    this._hovered = !this.disabled && !this.readonly && this._hitField(e.position)
    if (this._hovered !== wasHovered) this.markNeedsPaint()
  }

  onPointerUp(_e: PointerEvent): void {}

  onPointerCancel(_e: PointerEvent): void {
    this._hovered = false
    this.markNeedsPaint()
  }

  onPointerLeave(_e: PointerEvent): void {
    if (!this._hovered) return
    this._hovered = false
    this.markNeedsPaint()
  }

  dispose(): void {
    if (this._focusRegistered && typeof window !== 'undefined') {
      FocusManager.instance.unregister(this)
      this._focusRegistered = false
    }
    this._popup.dispose()
    this._valueEditorEvents.dispose()
    this._hovered = false
    super.dispose()
  }

  private _inputTokens(theme: ResolvedTheme): TextInputStyleTokens {
    return deriveTextInputStyle(theme)
  }

  private _inputStyle(): TextInputStyleTokens {
    return this._inputTokens(this.currentTheme)
  }

  private _showClearButton(): boolean {
    return this.clearable && !this.disabled && !this.readonly && this.value.length > 0
  }

  private _clearValue(): void {
    if (!this._showClearButton()) return
    const previousValue = this._value
    this._popup.close()
    this._value = ''
    this._parseValue()
    this._deactivate()
    this._publishValueChange(previousValue, 'clear')
    this.markNeedsPaint()
  }

  private _triggerLayout() {
    const style = this._inputStyle()
    return layoutFormFieldInlineContent(style, this.globalOffset, this.size.width, style.height, {
      leadingIcon: 'calendar',
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      showClearButton: this._showClearButton(),
      reserveTrailingWidth: style.fontSize,
    })
  }

  private _triggerLocalLayout(style: TextInputStyleTokens = this._inputStyle()) {
    return layoutFormFieldInlineContent(style, { x: 0, y: 0 }, this.size.width, style.height, {
      leadingIcon: 'calendar',
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      showClearButton: this._showClearButton(),
      reserveTrailingWidth: style.fontSize,
    })
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
      position.x <= g.x + this.size.width &&
      position.y >= g.y &&
      position.y <= g.y + fieldHeight
  }
}
