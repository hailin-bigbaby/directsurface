import type { Offset } from '../core/render_object'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import {
  resolveBgColor,
  resolveContrastText,
  type DatePickerStyleTokens,
  type PopupStyleTokens,
} from '../theme/component_styles'
import {
  calendarDateInRange,
  calendarDaysInMonth,
  firstCalendarDayOfWeek,
  sameCalendarDate,
  shiftCalendarDays,
  shiftCalendarMonths,
  todayCalendarDate,
  type CalendarDate,
} from './calendar_date'
import { paintIconGlyph, type IconName } from './icon'

export type DateCalendarViewMode = 'day' | 'month' | 'year'

export interface DateCalendarPanelRect {
  x: number
  y: number
  width: number
}

export interface DateCalendarPanelPaintOptions {
  active?: boolean
  rangeStart?: CalendarDate | null
  rangeEnd?: CalendarDate | null
}

export interface DateCalendarPanelKeyResult {
  handled: boolean
  activatedDate?: CalendarDate
}

export interface DateCalendarPanelDebugState {
  viewMode: DateCalendarViewMode
  viewYear: number
  viewMonth: number
  yearRangeStart: number
  selected: CalendarDate | null
  focusedDate: CalendarDate
}

type CalendarHeaderButton = 'prev' | 'next' | 'title'

const MIN_YEAR = 1
const MAX_YEAR = 9_999
const MAX_YEAR_RANGE_START = MAX_YEAR - 11
const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']
const MONTH_NAMES = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
]

export class DateCalendarPanel {
  private _viewYear = MIN_YEAR
  private _viewMonth = 1
  private _viewMode: DateCalendarViewMode = 'day'
  private _yearRangeStart = MIN_YEAR
  private _selected: CalendarDate | null = null
  private _focusedDate: CalendarDate = { year: MIN_YEAR, month: 1, day: 1 }
  private _hoveredDate: CalendarDate | null = null
  private _hoveredButton: CalendarHeaderButton | null = null
  private _hoveredMonth = -1
  private _hoveredYear = -1
  private readonly _invalidate: () => void

  constructor(invalidate: () => void = () => {}) {
    this._invalidate = invalidate
  }

  get viewYear(): number { return this._viewYear }
  set viewYear(value: number) {
    this._viewYear = clampYear(value)
  }

  get viewMonth(): number { return this._viewMonth }
  set viewMonth(value: number) {
    this._viewMonth = Math.max(1, Math.min(12, Math.trunc(value)))
  }

  get viewMode(): DateCalendarViewMode { return this._viewMode }
  set viewMode(value: DateCalendarViewMode) {
    this._viewMode = value
  }

  get yearRangeStart(): number { return this._yearRangeStart }
  set yearRangeStart(value: number) {
    this._yearRangeStart = clampYearRangeStart(value)
  }

  get selected(): CalendarDate | null { return this._selected }
  set selected(value: CalendarDate | null) {
    this._selected = value ? { ...value } : null
  }

  get focusedDate(): CalendarDate { return this._focusedDate }
  set focusedDate(value: CalendarDate) {
    this._focusedDate = clampDate(value)
  }

  get hoveredDate(): CalendarDate | null { return this._hoveredDate }
  set hoveredDate(value: CalendarDate | null) {
    this._hoveredDate = value ? { ...value } : null
  }

  get hoveredButton(): CalendarHeaderButton | null { return this._hoveredButton }
  set hoveredButton(value: CalendarHeaderButton | null) {
    this._hoveredButton = value
  }

  get hoveredMonth(): number { return this._hoveredMonth }
  set hoveredMonth(value: number) {
    this._hoveredMonth = value
  }

  get hoveredYear(): number { return this._hoveredYear }
  set hoveredYear(value: number) {
    this._hoveredYear = value
  }

  reset(selected: CalendarDate | null, fallback: CalendarDate = todayCalendarDate()): void {
    const base = selected ?? fallback
    this._selected = selected ? { ...selected } : null
    this._focusedDate = { ...base }
    this._viewYear = base.year
    this._viewMonth = base.month
    this._viewMode = 'day'
    this._yearRangeStart = yearRangeStartFor(base.year)
    this._hoveredDate = null
    this._hoveredButton = null
    this._hoveredMonth = base.month - 1
    this._hoveredYear = base.year
  }

  syncSelected(
    selected: CalendarDate | null,
    options: { alignView?: boolean; fallback?: CalendarDate } = {},
  ): void {
    this._selected = selected ? { ...selected } : null
    const base = selected ?? options.fallback
    if (base) {
      this._focusedDate = { ...base }
      if (options.alignView !== false) {
        this._viewYear = base.year
        this._viewMonth = base.month
        this._viewMode = 'day'
        this._yearRangeStart = yearRangeStartFor(base.year)
      }
    }
    this._invalidate()
  }

  syncView(year: number, month: number): void {
    this._viewYear = clampYear(year)
    this._viewMonth = Math.max(1, Math.min(12, Math.trunc(month)))
    this._viewMode = 'day'
    this._focusedDate = {
      year: this._viewYear,
      month: this._viewMonth,
      day: Math.min(
        this._focusedDate.day,
        calendarDaysInMonth(this._viewYear, this._viewMonth),
      ),
    }
    this._invalidate()
  }

  debugState(): DateCalendarPanelDebugState {
    return {
      viewMode: this._viewMode,
      viewYear: this._viewYear,
      viewMonth: this._viewMonth,
      yearRangeStart: this._yearRangeStart,
      selected: this._selected ? { ...this._selected } : null,
      focusedDate: { ...this._focusedDate },
    }
  }

  handlePointerDown(
    point: Offset,
    rect: DateCalendarPanelRect,
    style: DatePickerStyleTokens,
  ): CalendarDate | null {
    if (this._inHeaderButton(point, rect, style, 'prev')) {
      this._navigateHeader(-1)
      return null
    }
    if (this._inHeaderButton(point, rect, style, 'next')) {
      this._navigateHeader(1)
      return null
    }
    if (this._inHeaderButton(point, rect, style, 'title')) {
      if (this._viewMode === 'day') {
        this._viewMode = 'month'
        this._hoveredMonth = this._viewMonth - 1
      } else if (this._viewMode === 'month') {
        this._viewMode = 'year'
        this._yearRangeStart = yearRangeStartFor(this._viewYear)
        this._hoveredYear = this._viewYear
      } else {
        this._viewMode = 'day'
      }
      this._invalidate()
      return null
    }

    if (this._viewMode === 'day') {
      const date = this._dateAt(point, rect, style)
      if (!date) return null
      this._selectDate(date)
      return { ...date }
    }
    if (this._viewMode === 'month') {
      const month = this._monthAt(point, rect, style)
      if (month < 0) return null
      this._viewMonth = month + 1
      this._hoveredMonth = month
      this._focusedDate = {
        year: this._viewYear,
        month: this._viewMonth,
        day: Math.min(
          this._focusedDate.day,
          calendarDaysInMonth(this._viewYear, this._viewMonth),
        ),
      }
      this._viewMode = 'day'
      this._invalidate()
      return null
    }

    const year = this._yearAt(point, rect, style)
    if (year < MIN_YEAR || year > MAX_YEAR) return null
    this._viewYear = year
    this._hoveredYear = year
    this._focusedDate = {
      year,
      month: this._viewMonth,
      day: Math.min(
        this._focusedDate.day,
        calendarDaysInMonth(year, this._viewMonth),
      ),
    }
    this._viewMode = 'month'
    this._hoveredMonth = this._viewMonth - 1
    this._invalidate()
    return null
  }

  handlePointerMove(
    point: Offset,
    rect: DateCalendarPanelRect,
    style: DatePickerStyleTokens,
  ): boolean {
    let changed = false
    let button: CalendarHeaderButton | null = null
    if (this._inHeaderButton(point, rect, style, 'prev')) button = 'prev'
    else if (this._inHeaderButton(point, rect, style, 'next')) button = 'next'
    else if (this._inHeaderButton(point, rect, style, 'title')) button = 'title'
    if (button !== this._hoveredButton) {
      this._hoveredButton = button
      changed = true
    }

    if (this._viewMode === 'day') {
      const date = this._dateAt(point, rect, style)
      if (!sameOptionalDate(date, this._hoveredDate)) {
        this._hoveredDate = date
        changed = true
      }
    } else if (this._viewMode === 'month') {
      const month = this._monthAt(point, rect, style)
      if (month !== this._hoveredMonth) {
        this._hoveredMonth = month
        changed = true
      }
    } else {
      const year = this._yearAt(point, rect, style)
      if (year !== this._hoveredYear) {
        this._hoveredYear = year
        changed = true
      }
    }

    if (changed) this._invalidate()
    return changed
  }

  clearHover(): boolean {
    const changed = this._hoveredDate !== null ||
      this._hoveredButton !== null
    this._hoveredDate = null
    this._hoveredButton = null
    if (changed) this._invalidate()
    return changed
  }

  handleKeyDown(event: KeyboardEvent): DateCalendarPanelKeyResult {
    const key = event.key
    if (
      key === 'ArrowLeft' ||
      key === 'ArrowRight' ||
      key === 'ArrowUp' ||
      key === 'ArrowDown'
    ) {
      event.preventDefault()
      const delta = key === 'ArrowLeft'
        ? -1
        : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -4 : 4
      if (this._viewMode === 'day') {
        const dayDelta = key === 'ArrowUp' ? -7 : key === 'ArrowDown' ? 7 : delta
        this._moveFocusedDay(dayDelta)
      } else if (this._viewMode === 'month') {
        this._moveFocusedMonth(delta)
      } else {
        this._moveFocusedYear(delta)
      }
      return { handled: true }
    }
    if (key === 'PageUp' || key === 'PageDown') {
      event.preventDefault()
      const delta = key === 'PageUp' ? -1 : 1
      if (this._viewMode === 'day') this._moveFocusedMonth(delta)
      else if (this._viewMode === 'month') this._moveFocusedYear(delta)
      else this._moveFocusedYear(delta * 12)
      return { handled: true }
    }
    if (key !== 'Enter') return { handled: false }

    event.preventDefault()
    if (this._viewMode === 'day') {
      this._selectDate(this._focusedDate)
      return { handled: true, activatedDate: { ...this._focusedDate } }
    }
    if (this._viewMode === 'month') {
      const month = this._hoveredMonth >= 0
        ? this._hoveredMonth + 1
        : this._viewMonth
      this._viewMonth = Math.max(1, Math.min(12, month))
      this._focusedDate = {
        year: this._viewYear,
        month: this._viewMonth,
        day: Math.min(
          this._focusedDate.day,
          calendarDaysInMonth(this._viewYear, this._viewMonth),
        ),
      }
      this._viewMode = 'day'
      this._invalidate()
      return { handled: true }
    }

    const year = this._hoveredYear >= MIN_YEAR
      ? this._hoveredYear
      : this._viewYear
    this._viewYear = clampYear(year)
    this._yearRangeStart = yearRangeStartFor(this._viewYear)
    this._focusedDate = {
      year: this._viewYear,
      month: this._viewMonth,
      day: Math.min(
        this._focusedDate.day,
        calendarDaysInMonth(this._viewYear, this._viewMonth),
      ),
    }
    this._viewMode = 'month'
    this._hoveredMonth = this._viewMonth - 1
    this._invalidate()
    return { handled: true }
  }

  paint(
    context: PaintContext,
    drawList: DrawList,
    rect: DateCalendarPanelRect,
    style: DatePickerStyleTokens,
    popupStyle: PopupStyleTokens,
    options: DateCalendarPanelPaintOptions = {},
  ): void {
    const cellSize = style.cellSize
    const headerY = rect.y + style.padding
    const headerMidY = headerY + cellSize / 2
    const gridX = rect.x + style.padding

    this._paintHeaderButton(
      context,
      drawList,
      rect.x + style.padding,
      headerY,
      'prev',
      'chevron-left',
      style,
      popupStyle,
    )
    this._paintHeaderButton(
      context,
      drawList,
      rect.x + rect.width - style.padding - cellSize,
      headerY,
      'next',
      'chevron-right',
      style,
      popupStyle,
    )

    const titleX = rect.x + style.padding + cellSize
    const titleWidth = rect.width - style.padding * 2 - cellSize * 2
    if (this._hoveredButton === 'title') {
      drawList.fillRect(
        titleX,
        headerY,
        titleWidth,
        cellSize,
        resolveBgColor(style.navBg, 'hovered'),
        popupStyle.borderRadius,
      )
    }
    const title = this._viewMode === 'day'
      ? `${this._viewYear}年 ${MONTH_NAMES[this._viewMonth - 1]}`
      : this._viewMode === 'month'
        ? `${this._viewYear}年`
        : `${this._yearRangeStart}–${Math.min(MAX_YEAR, this._yearRangeStart + 11)}`
    const titleColor = options.active === false ? style.text : style.accentText
    const hasTitleMenu = this._viewMode !== 'year'
    if (hasTitleMenu) {
      const iconSize = Math.min(style.fontSize, cellSize * 0.5)
      const gap = 4
      const titleWidth = drawList.measureText(title, style.fontSize, style.fontFamily).width
      const startX = rect.x + (rect.width - titleWidth - gap - iconSize) / 2
      drawList.fillText(title, startX, headerMidY, titleColor, style.fontSize, style.fontFamily, 'left', 'middle')
      paintIconGlyph(context, {
        name: 'chevron-down',
        x: startX + titleWidth + gap,
        y: headerMidY - iconSize / 2,
        size: iconSize,
        color: titleColor,
      })
    } else {
      drawList.fillText(title, rect.x + rect.width / 2, headerMidY, titleColor, style.fontSize, style.fontFamily, 'center', 'middle')
    }
    drawList.line(
      rect.x + style.padding,
      headerY + cellSize,
      rect.x + rect.width - style.padding,
      headerY + cellSize,
      style.separator,
      1,
    )

    const bodyY = rect.y + style.headerHeight
    if (this._viewMode === 'day') {
      this._paintDayView(
        context,
        drawList,
        gridX,
        bodyY,
        style,
        popupStyle,
        options,
      )
    } else if (this._viewMode === 'month') {
      this._paintMonthView(context, drawList, rect, bodyY, style, popupStyle)
    } else {
      this._paintYearView(context, drawList, rect, bodyY, style, popupStyle)
    }
  }

  static minimumWidth(style: DatePickerStyleTokens): number {
    return style.cellSize * 7 + style.padding * 2
  }

  static height(style: DatePickerStyleTokens): number {
    return style.headerHeight + style.cellSize * 7 + style.padding
  }

  private _navigateHeader(delta: -1 | 1): void {
    if (this._viewMode === 'day') {
      const next = shiftCalendarMonths({
        year: this._viewYear,
        month: this._viewMonth,
        day: this._focusedDate.day,
      }, delta)
      this._viewYear = next.year
      this._viewMonth = next.month
      this._focusedDate = next
    } else if (this._viewMode === 'month') {
      this._viewYear = clampYear(this._viewYear + delta)
      this._hoveredYear = this._viewYear
      this._focusedDate = clampDate({
        year: this._viewYear,
        month: this._focusedDate.month,
        day: this._focusedDate.day,
      })
    } else {
      this._yearRangeStart = clampYearRangeStart(
        this._yearRangeStart + delta * 12,
      )
      this._hoveredYear = Math.max(
        this._yearRangeStart,
        Math.min(this._yearRangeStart + 11, this._hoveredYear),
      )
    }
    this._invalidate()
  }

  private _moveFocusedDay(delta: number): void {
    this._focusedDate = shiftCalendarDays(this._focusedDate, delta)
    this._viewYear = this._focusedDate.year
    this._viewMonth = this._focusedDate.month
    this._invalidate()
  }

  private _moveFocusedMonth(delta: number): void {
    const base = this._viewMode === 'month'
      ? {
          year: this._viewYear,
          month: this._hoveredMonth >= 0 ? this._hoveredMonth + 1 : this._viewMonth,
          day: this._focusedDate.day,
        }
      : this._focusedDate
    const next = shiftCalendarMonths(base, delta)
    this._viewYear = next.year
    this._viewMonth = next.month
    this._focusedDate = next
    this._hoveredMonth = next.month - 1
    this._invalidate()
  }

  private _moveFocusedYear(delta: number): void {
    const baseYear = this._hoveredYear >= MIN_YEAR
      ? this._hoveredYear
      : this._viewYear
    const nextYear = clampYear(baseYear + delta)
    this._viewYear = nextYear
    this._hoveredYear = nextYear
    this._yearRangeStart = yearRangeStartFor(nextYear)
    this._focusedDate = clampDate({
      year: nextYear,
      month: this._focusedDate.month,
      day: this._focusedDate.day,
    })
    this._invalidate()
  }

  private _selectDate(date: CalendarDate): void {
    this._selected = { ...date }
    this._focusedDate = { ...date }
    this._viewYear = date.year
    this._viewMonth = date.month
    this._invalidate()
  }

  private _inHeaderButton(
    point: Offset,
    rect: DateCalendarPanelRect,
    style: DatePickerStyleTokens,
    button: CalendarHeaderButton,
  ): boolean {
    const cellSize = style.cellSize
    const y = rect.y + style.padding
    const x = button === 'prev'
      ? rect.x + style.padding
      : button === 'next'
        ? rect.x + rect.width - style.padding - cellSize
        : rect.x + style.padding + cellSize
    const width = button === 'title'
      ? rect.width - style.padding * 2 - cellSize * 2
      : cellSize
    return point.x >= x && point.x <= x + width &&
      point.y >= y && point.y <= y + cellSize
  }

  private _monthAt(
    point: Offset,
    rect: DateCalendarPanelRect,
    style: DatePickerStyleTokens,
  ): number {
    const gridX = rect.x + style.padding
    const gridY = rect.y + style.headerHeight
    const cellWidth = (rect.width - style.padding * 2) / 4
    const cellHeight = style.cellSize * 1.5
    const col = Math.floor((point.x - gridX) / cellWidth)
    const row = Math.floor((point.y - gridY) / cellHeight)
    if (col < 0 || col > 3 || row < 0 || row > 2) return -1
    return row * 4 + col
  }

  private _yearAt(
    point: Offset,
    rect: DateCalendarPanelRect,
    style: DatePickerStyleTokens,
  ): number {
    const index = this._monthAt(point, rect, style)
    if (index < 0) return -1
    const year = this._yearRangeStart + index
    return year <= MAX_YEAR ? year : -1
  }

  private _dateAt(
    point: Offset,
    rect: DateCalendarPanelRect,
    style: DatePickerStyleTokens,
  ): CalendarDate | null {
    const gridX = rect.x + style.padding
    const gridY = rect.y + style.headerHeight + style.cellSize
    const col = Math.floor((point.x - gridX) / style.cellSize)
    const row = Math.floor((point.y - gridY) / style.cellSize)
    if (col < 0 || col > 6 || row < 0 || row > 5) return null
    return dateForCell(this._viewYear, this._viewMonth, row, col)
  }

  private _paintHeaderButton(
    context: PaintContext,
    drawList: DrawList,
    x: number,
    y: number,
    button: CalendarHeaderButton,
    icon: IconName,
    style: DatePickerStyleTokens,
    popupStyle: PopupStyleTokens,
  ): void {
    if (this._hoveredButton === button) {
      drawList.fillRect(
        x,
        y,
        style.cellSize,
        style.cellSize,
        resolveBgColor(style.navBg, 'hovered'),
        popupStyle.borderRadius,
      )
    }
    const iconSize = Math.min(style.navFontSize, style.cellSize - 8)
    paintIconGlyph(context, {
      name: icon,
      x: x + (style.cellSize - iconSize) / 2,
      y: y + (style.cellSize - iconSize) / 2,
      size: iconSize,
      color: style.text,
    })
  }

  private _paintDayView(
    context: PaintContext,
    drawList: DrawList,
    gridX: number,
    bodyY: number,
    style: DatePickerStyleTokens,
    popupStyle: PopupStyleTokens,
    options: DateCalendarPanelPaintOptions,
  ): void {
    const cellSize = style.cellSize
    for (let col = 0; col < 7; col++) {
      drawList.fillText(
        WEEK_LABELS[col]!,
        gridX + col * cellSize + cellSize / 2,
        bodyY + cellSize / 2,
        col === 0 || col === 6 ? style.weekendText : style.textDisabled,
        style.weekLabelFontSize,
        style.fontFamily,
        'center',
        'middle',
      )
    }

    const gridY = bodyY + cellSize
    const today = todayCalendarDate()
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 7; col++) {
        const date = dateForCell(this._viewYear, this._viewMonth, row, col)
        if (!date) continue
        const cellX = gridX + col * cellSize
        const cellY = gridY + row * cellSize
        const currentMonth = date.year === this._viewYear &&
          date.month === this._viewMonth
        const selected = this._selected !== null &&
          sameCalendarDate(date, this._selected)
        const hovered = this._hoveredDate !== null &&
          sameCalendarDate(date, this._hoveredDate)
        const focused = options.active !== false &&
          sameCalendarDate(date, this._focusedDate)
        const inRange = calendarDateInRange(
          date,
          options.rangeStart ?? null,
          options.rangeEnd ?? null,
        )
        if (inRange && !selected) {
          drawList.fillRect(
            cellX,
            cellY + Math.max(2, style.padding / 2),
            cellSize,
            cellSize - Math.max(4, style.padding),
            resolveBgColor(style.navBg, 'hovered'),
          )
        }
        const background = resolveBgColor(style.cellBg, {
          selected,
          hovered: !selected && currentMonth && (hovered || focused),
        })
        if (background.a > 0) {
          drawList.fillRect(
            cellX + 1,
            cellY + 1,
            cellSize - 2,
            cellSize - 2,
            background,
            popupStyle.borderRadius,
          )
        }
        const isToday = sameCalendarDate(date, today)
        if (isToday && !selected) {
          drawList.fillCircle(
            cellX + cellSize / 2,
            cellY + cellSize - 4,
            2,
            style.accentText,
          )
        }
        const color = selected
          ? resolveContrastText(
              context.theme,
              background,
              style.contrastText,
              context.theme.surfacePopup,
            )
          : !currentMonth ? style.textDisabled
          : isToday ? style.accentText : style.text
        drawList.fillText(
          String(date.day),
          cellX + cellSize / 2,
          cellY + cellSize / 2,
          color,
          style.fontSize,
          style.fontFamily,
          'center',
          'middle',
        )
      }
    }
  }

  private _paintMonthView(
    context: PaintContext,
    drawList: DrawList,
    rect: DateCalendarPanelRect,
    bodyY: number,
    style: DatePickerStyleTokens,
    popupStyle: PopupStyleTokens,
  ): void {
    const cellWidth = (rect.width - style.padding * 2) / 4
    const cellHeight = style.cellSize * 1.5
    const gridX = rect.x + style.padding
    for (let index = 0; index < 12; index++) {
      const col = index % 4
      const row = Math.floor(index / 4)
      const x = gridX + col * cellWidth
      const y = bodyY + row * cellHeight
      const selected = this._selected?.month === index + 1 &&
        this._selected?.year === this._viewYear
      const hovered = this._hoveredMonth === index
      const background = resolveBgColor(style.cellBg, { selected, hovered })
      if (background.a > 0) {
        drawList.fillRect(
          x + 2,
          y + 2,
          cellWidth - 4,
          cellHeight - 4,
          background,
          popupStyle.borderRadius,
        )
      }
      drawList.fillText(
        MONTH_NAMES[index]!,
        x + cellWidth / 2,
        y + cellHeight / 2,
        selected
          ? resolveContrastText(
              context.theme,
              background,
              style.contrastText,
              context.theme.surfacePopup,
            )
          : style.text,
        style.fontSize,
        style.fontFamily,
        'center',
        'middle',
      )
    }
  }

  private _paintYearView(
    context: PaintContext,
    drawList: DrawList,
    rect: DateCalendarPanelRect,
    bodyY: number,
    style: DatePickerStyleTokens,
    popupStyle: PopupStyleTokens,
  ): void {
    const cellWidth = (rect.width - style.padding * 2) / 4
    const cellHeight = style.cellSize * 1.5
    const gridX = rect.x + style.padding
    const today = todayCalendarDate()
    for (let index = 0; index < 12; index++) {
      const year = this._yearRangeStart + index
      if (year > MAX_YEAR) continue
      const col = index % 4
      const row = Math.floor(index / 4)
      const x = gridX + col * cellWidth
      const y = bodyY + row * cellHeight
      const selected = this._selected?.year === year
      const hovered = this._hoveredYear === year
      const background = resolveBgColor(style.cellBg, { selected, hovered })
      if (background.a > 0) {
        drawList.fillRect(
          x + 2,
          y + 2,
          cellWidth - 4,
          cellHeight - 4,
          background,
          popupStyle.borderRadius,
        )
      }
      drawList.fillText(
        String(year),
        x + cellWidth / 2,
        y + cellHeight / 2,
        selected
          ? resolveContrastText(
              context.theme,
              background,
              style.contrastText,
              context.theme.surfacePopup,
            )
          : year === today.year ? style.accentText : style.text,
        style.fontSize,
        style.fontFamily,
        'center',
        'middle',
      )
    }
  }
}

function dateForCell(
  viewYear: number,
  viewMonth: number,
  row: number,
  col: number,
): CalendarDate | null {
  const firstDay = firstCalendarDayOfWeek(viewYear, viewMonth)
  const day = row * 7 + col - firstDay + 1
  if (day < 1) {
    const previousMonth = viewMonth === 1 ? 12 : viewMonth - 1
    const previousYear = viewMonth === 1 ? viewYear - 1 : viewYear
    if (previousYear < MIN_YEAR) return null
    return {
      year: previousYear,
      month: previousMonth,
      day: calendarDaysInMonth(previousYear, previousMonth) + day,
    }
  }
  const days = calendarDaysInMonth(viewYear, viewMonth)
  if (day > days) {
    const nextYear = viewMonth === 12 ? viewYear + 1 : viewYear
    if (nextYear > MAX_YEAR) return null
    return {
      year: nextYear,
      month: viewMonth === 12 ? 1 : viewMonth + 1,
      day: day - days,
    }
  }
  return { year: viewYear, month: viewMonth, day }
}

function clampYear(value: number): number {
  return Math.max(MIN_YEAR, Math.min(MAX_YEAR, Math.trunc(value)))
}

function clampYearRangeStart(value: number): number {
  return Math.max(
    MIN_YEAR,
    Math.min(MAX_YEAR_RANGE_START, Math.trunc(value)),
  )
}

function yearRangeStartFor(year: number): number {
  return clampYearRangeStart(Math.floor(clampYear(year) / 12) * 12)
}

function clampDate(date: CalendarDate): CalendarDate {
  const year = clampYear(date.year)
  const month = Math.max(1, Math.min(12, Math.trunc(date.month)))
  return {
    year,
    month,
    day: Math.max(
      1,
      Math.min(
        calendarDaysInMonth(year, month),
        Math.trunc(date.day),
      ),
    ),
  }
}

function sameOptionalDate(
  left: CalendarDate | null,
  right: CalendarDate | null,
): boolean {
  if (!left || !right) return left === right
  return sameCalendarDate(left, right)
}
