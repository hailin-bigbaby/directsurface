import type { Offset } from '../core/render_object'
import type { WheelPointerEvent } from '../gestures/hit_test'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import {
  resolveBgColor,
  resolveContrastText,
  type DatePickerStyleTokens,
  type PopupStyleTokens,
} from '../theme/component_styles'
import {
  TimeSegmentController,
  type TimeSegmentChange,
} from './time_segment_controller'
import {
  formatTimeValue,
  type TimeParts,
  type TimePrecision,
  type TimeSegment,
} from './time_value'

export interface TimeSelectionPanelRect {
  x: number
  y: number
  width: number
}

export interface TimeSelectionPanelOptions {
  value?: string
  precision?: TimePrecision
  hourStep?: number
  minuteStep?: number
  secondStep?: number
  onChange?: (change: TimeSegmentChange) => void
  invalidate?: () => void
}

export interface TimeSelectionPanelDebugState {
  value: string
  parts: TimeParts | null
  activeSegment: TimeSegment | null
  hoveredSegment: TimeSegment | null
  hoveredRow: number
}

const VISIBLE_ROWS = 7

export class TimeSelectionPanel {
  private readonly _controller: TimeSegmentController
  private _hoveredSegment: TimeSegment | null = null
  private _hoveredRow = -1
  private _hourStep: number
  private _minuteStep: number
  private _secondStep: number
  private readonly _invalidate: () => void

  constructor(options: TimeSelectionPanelOptions = {}) {
    this._invalidate = options.invalidate ?? (() => {})
    this._hourStep = positiveInteger(options.hourStep)
    this._minuteStep = positiveInteger(options.minuteStep)
    this._secondStep = positiveInteger(options.secondStep)
    this._controller = new TimeSegmentController({
      value: options.value,
      precision: options.precision,
      hourStep: options.hourStep,
      minuteStep: options.minuteStep,
      secondStep: options.secondStep,
      onChange: options.onChange,
      invalidate: this._invalidate,
    })
  }

  get value(): string { return this._controller.value }
  get parts(): TimeParts | null { return this._controller.parts }
  get precision(): TimePrecision { return this._controller.precision }
  set precision(value: TimePrecision) { this._controller.precision = value }
  get activeSegment(): TimeSegment | null { return this._controller.activeSegment }
  get segments(): readonly TimeSegment[] { return this._controller.segments }

  configure(options: {
    precision?: TimePrecision
    hourStep?: number
    minuteStep?: number
    secondStep?: number
  }): void {
    if (options.precision !== undefined) this._controller.precision = options.precision
    if (options.hourStep !== undefined) this._hourStep = positiveInteger(options.hourStep)
    if (options.minuteStep !== undefined) this._minuteStep = positiveInteger(options.minuteStep)
    if (options.secondStep !== undefined) this._secondStep = positiveInteger(options.secondStep)
    this._controller.setSteps(options)
  }

  reset(
    value: string,
    fallback: TimeParts = { hour: 0, minute: 0, second: 0 },
    materializeFallback = false,
  ): void {
    this._controller.reset(value, fallback)
    if (materializeFallback && this._controller.parts === null) {
      this._controller.setValue(formatTimeValue(fallback, this.precision))
    }
    this._controller.activate('hour')
    this._hoveredSegment = null
    this._hoveredRow = -1
  }

  commitPending(): void {
    this._controller.commitPending()
  }

  debugState(): TimeSelectionPanelDebugState {
    return {
      value: this.value,
      parts: this.parts,
      activeSegment: this.activeSegment,
      hoveredSegment: this._hoveredSegment,
      hoveredRow: this._hoveredRow,
    }
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    return this._controller.handleKeyDown(event)
  }

  handlePointerDown(
    point: Offset,
    rect: TimeSelectionPanelRect,
    style: DatePickerStyleTokens,
  ): boolean {
    const hit = this._optionAt(point, rect, style)
    if (!hit) return false
    this._controller.activate(hit.segment)
    this._controller.select(hit.segment, hit.value)
    return true
  }

  handlePointerMove(
    point: Offset,
    rect: TimeSelectionPanelRect,
    style: DatePickerStyleTokens,
  ): boolean {
    const hit = this._optionAt(point, rect, style)
    const segment = hit?.segment ?? null
    const row = hit?.row ?? -1
    if (segment === this._hoveredSegment && row === this._hoveredRow) return false
    this._hoveredSegment = segment
    this._hoveredRow = row
    this._invalidate()
    return true
  }

  handleWheel(
    event: WheelPointerEvent,
    rect: TimeSelectionPanelRect,
    style: DatePickerStyleTokens,
  ): boolean {
    if (event.deltaY === 0) return false
    const segment = this._segmentAt(event.position, rect, style)
    if (!segment) return false
    this._controller.activate(segment)
    this._controller.step(segment, event.deltaY > 0 ? 1 : -1)
    return true
  }

  clearHover(): boolean {
    if (this._hoveredSegment === null && this._hoveredRow < 0) return false
    this._hoveredSegment = null
    this._hoveredRow = -1
    this._invalidate()
    return true
  }

  paint(
    context: PaintContext,
    drawList: DrawList,
    rect: TimeSelectionPanelRect,
    style: DatePickerStyleTokens,
    popupStyle: PopupStyleTokens,
    options: { active?: boolean; title?: string } = {},
  ): void {
    const segments = this.segments
    const columnWidth = (rect.width - style.padding * 2) / segments.length
    const headerY = rect.y + style.padding
    const bodyY = headerY + style.headerHeight
    const parts = this._controller.displayParts
    const hasValue = this._controller.parts !== null
    const selectionBackground = resolveBgColor(style.cellBg, {
      selected: true,
      hovered: false,
    })

    if (hasValue && selectionBackground.a > 0) {
      const selectionY = bodyY + Math.floor(VISIBLE_ROWS / 2) * style.cellSize
      drawList.fillRect(
        rect.x + style.padding + 2,
        selectionY + 1,
        rect.width - style.padding * 2 - 4,
        style.cellSize - 2,
        selectionBackground,
        popupStyle.borderRadius,
      )
    }

    const labels: Record<TimeSegment, string> = {
      hour: '时',
      minute: '分',
      second: '秒',
    }
    for (let column = 0; column < segments.length; column++) {
      const segment = segments[column]!
      const columnX = rect.x + style.padding + column * columnWidth
      const active = segment === this.activeSegment
      drawList.fillText(
        options.title && column === 0
          ? `${options.title}·${labels[segment]}`
          : labels[segment],
        columnX + columnWidth / 2,
        headerY + style.headerHeight / 2,
        active ? style.accentText : style.weekendText,
        style.weekLabelFontSize,
        style.fontFamily,
        'center',
        'middle',
      )
      if (active) {
        drawList.line(
          columnX + style.padding,
          headerY + style.headerHeight - 2,
          columnX + columnWidth - style.padding,
          headerY + style.headerHeight - 2,
          style.accentText,
          2,
        )
      }

      const choices = this._visibleChoices(segment, parts[segment])
      for (let row = 0; row < VISIBLE_ROWS; row++) {
        const value = choices[row]
        if (value === null) continue
        const cellX = columnX + 2
        const cellY = bodyY + row * style.cellSize
        const selected = hasValue && value === parts[segment]
        const hovered = segment === this._hoveredSegment && row === this._hoveredRow
        const background = selected
          ? selectionBackground
          : resolveBgColor(style.cellBg, { selected: false, hovered })
        if (!selected && background.a > 0) {
          drawList.fillRect(
            cellX,
            cellY + 1,
            columnWidth - 4,
            style.cellSize - 2,
            background,
            popupStyle.borderRadius,
          )
        }
        drawList.fillText(
          String(value).padStart(2, '0'),
          columnX + columnWidth / 2,
          cellY + style.cellSize / 2,
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

      if (column > 0) {
        drawList.line(
          columnX,
          headerY + style.padding,
          columnX,
          rect.y + TimeSelectionPanel.height(style) - style.padding,
          style.separator,
          1,
        )
      }
    }
  }

  static minimumWidth(style: DatePickerStyleTokens, precision: TimePrecision): number {
    return (precision === 'second' ? 3 : 2) * style.cellSize * 2 + style.padding * 2
  }

  static height(style: DatePickerStyleTokens): number {
    return style.padding * 2 + style.headerHeight + style.cellSize * VISIBLE_ROWS
  }

  private _optionAt(
    point: Offset,
    rect: TimeSelectionPanelRect,
    style: DatePickerStyleTokens,
  ): { segment: TimeSegment; value: number; row: number } | null {
    const segment = this._segmentAt(point, rect, style)
    if (!segment) return null
    const bodyY = rect.y + style.padding + style.headerHeight
    const row = Math.floor((point.y - bodyY) / style.cellSize)
    if (row < 0 || row >= VISIBLE_ROWS) return null
    const current = this._controller.displayParts[segment]
    const value = this._visibleChoices(segment, current)[row]
    return value == null ? null : { segment, value, row }
  }

  private _segmentAt(
    point: Offset,
    rect: TimeSelectionPanelRect,
    style: DatePickerStyleTokens,
  ): TimeSegment | null {
    if (
      point.x < rect.x + style.padding ||
      point.x > rect.x + rect.width - style.padding ||
      point.y < rect.y ||
      point.y > rect.y + TimeSelectionPanel.height(style)
    ) return null
    const width = rect.width - style.padding * 2
    const index = Math.min(
      this.segments.length - 1,
      Math.floor((point.x - rect.x - style.padding) / (width / this.segments.length)),
    )
    return this.segments[index] ?? null
  }

  private _visibleChoices(segment: TimeSegment, selected: number): Array<number | null> {
    const max = segment === 'hour' ? 24 : 60
    const step = this._stepFor(segment)
    const normalizedStep = step % max
    const cycleLength = normalizedStep === 0 ? 1 : max / greatestCommonDivisor(max, normalizedStep)
    const count = Math.min(VISIBLE_ROWS, cycleLength)
    const selectedIndex = Math.floor(count / 2)
    const values = Array.from(
      { length: count },
      (_, index) => wrap(selected + (index - selectedIndex) * step, max),
    )
    const before = Math.floor((VISIBLE_ROWS - count) / 2)
    return [
      ...Array.from({ length: before }, () => null),
      ...values,
      ...Array.from({ length: VISIBLE_ROWS - before - count }, () => null),
    ]
  }

  private _stepFor(segment: TimeSegment): number {
    if (segment === 'hour') return this._hourStep
    if (segment === 'minute') return this._minuteStep
    return this._secondStep
  }
}

function positiveInteger(value: number | undefined): number {
  if (!Number.isFinite(value) || value! <= 0) return 1
  return Math.max(1, Math.trunc(value!))
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b !== 0) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size
}
