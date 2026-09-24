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
  formatISOCalendarDate,
  parseISOCalendarDate,
  sameCalendarDate,
  shiftCalendarDays,
  todayCalendarDate,
  type CalendarDate,
} from './calendar_date'
import { DateCalendarPanel } from './date_calendar_panel'
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
  parseTimeValue,
  type TimeParts,
  type TimePrecision,
} from './time_value'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorBlurListener,
  type ValueEditorValueChangeListener,
} from './value_editor'

export interface DateTimeRangeValue {
  start: string | null
  end: string | null
}

export interface DateTimeRangeEditOptions extends RenderBoxOptions {
  value?: DateTimeRangeValue
  timePrecision?: TimePrecision
  placeholder?: string
  separator?: string
  hourStep?: number
  minuteStep?: number
  secondStep?: number
  onChange?: (value: DateTimeRangeValue) => void
  disabled?: boolean
  readonly?: boolean
  status?: FormFieldStatus
  helperText?: string
  prefixText?: string
  suffixText?: string
  clearable?: boolean
}

export type DateTimeRangeEditValueChangeReason =
  | 'selection'
  | 'clear'
  | 'precision-reconcile'

export type DateTimeRangeEditValueChangeDetail =
  | { readonly complete: boolean }
  | { readonly precision: TimePrecision }

type DateTimePanelMode = 'date' | 'time'
type DateTimeRangeFooterButton = 'now' | 'ok' | 'cancel'

interface ParsedDateTime {
  date: CalendarDate
  time: TimeParts
}

export class DateTimeRangePickerPopup extends PopupSurfaceShell implements Popup {
  private _anchor?: PopupAnchor
  private readonly _datePanels: readonly [DateCalendarPanel, DateCalendarPanel]
  private readonly _timePanels: readonly [TimeSelectionPanel, TimeSelectionPanel]
  private _modes: [DateTimePanelMode, DateTimePanelMode] = ['date', 'date']
  private _activePanel: 0 | 1 = 0
  private _timePrecision: TimePrecision = 'second'
  private _hoveredFooter: DateTimeRangeFooterButton | null = null
  private _hoveredTab: { panel: 0 | 1; mode: DateTimePanelMode } | null = null
  private _onSelect?: (value: DateTimeRangeValue) => boolean | void
  private _onClose?: () => void

  constructor() {
    super()
    const invalidate = () => this.requestPopupPaint()
    this._datePanels = [new DateCalendarPanel(invalidate), new DateCalendarPanel(invalidate)]
    this._timePanels = [
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
    value: DateTimeRangeValue
    timePrecision: TimePrecision
    hourStep: number
    minuteStep: number
    secondStep: number
    onSelect: (value: DateTimeRangeValue) => boolean | void
    onClose: () => void
  }): void {
    if (this.popupOpen) this.close()
    const normalized = normalizeDateTimeRangeValue(options.value, options.timePrecision)
    const parsedStart = parseDateTimeValue(normalized.start)
    const parsedEnd = parseDateTimeValue(normalized.end)
    const now = currentDateTime()
    const start = parsedStart ?? now
    const end = parsedEnd ?? addHours(start, 1)
    this._anchor = options.anchor
    this._timePrecision = options.timePrecision
    for (const panel of this._timePanels) {
      panel.configure({
        precision: options.timePrecision,
        hourStep: options.hourStep,
        minuteStep: options.minuteStep,
        secondStep: options.secondStep,
      })
    }
    this._datePanels[0].reset(parsedStart?.date ?? null, start.date)
    this._datePanels[1].reset(parsedEnd?.date ?? null, end.date)
    this._timePanels[0].reset(
      parsedStart ? formatTimeValue(parsedStart.time, options.timePrecision) : '',
      start.time,
      true,
    )
    this._timePanels[1].reset(
      parsedEnd ? formatTimeValue(parsedEnd.time, options.timePrecision) : '',
      end.time,
      true,
    )
    this._modes = ['date', 'date']
    this._activePanel = 0
    this._hoveredFooter = null
    this._hoveredTab = null
    this._onSelect = options.onSelect
    this._onClose = options.onClose
    this.resetPopupSurface()
    this.openPopup({ owner: resolvePopupAnchorTarget(options.anchor) })
  }

  syncValue(value: DateTimeRangeValue): void {
    const normalized = normalizeDateTimeRangeValue(value, this._timePrecision)
    const start = parseDateTimeValue(normalized.start)
    const end = parseDateTimeValue(normalized.end)
    const now = currentDateTime()
    const startFallback = start ?? now
    const endFallback = end ?? addHours(startFallback, 1)
    this._datePanels[0].reset(start?.date ?? null, startFallback.date)
    this._datePanels[1].reset(end?.date ?? null, endFallback.date)
    this._timePanels[0].reset(
      start ? formatTimeValue(start.time, this._timePrecision) : '',
      startFallback.time,
      true,
    )
    this._timePanels[1].reset(
      end ? formatTimeValue(end.time, this._timePrecision) : '',
      endFallback.time,
      true,
    )
    if (this.visible) this.requestPopupPaint()
  }

  syncConfiguration(options: {
    timePrecision?: TimePrecision
    hourStep?: number
    minuteStep?: number
    secondStep?: number
  }): void {
    if (options.timePrecision !== undefined) this._timePrecision = options.timePrecision
    for (const panel of this._timePanels) {
      panel.configure({
        precision: options.timePrecision,
        hourStep: options.hourStep,
        minuteStep: options.minuteStep,
        secondStep: options.secondStep,
      })
    }
    if (this.visible) this.requestPopupPaint()
  }

  commitSelection(): boolean {
    if (!this.visible) return true
    for (const panel of this._timePanels) panel.commitPending()
    const value = this._draftValue()
    if (!value.start || !value.end) {
      this.requestPopupPaint()
      return false
    }
    const normalized = normalizeDateTimeRangeValue(value, this._timePrecision)
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
    modes: [DateTimePanelMode, DateTimePanelMode]
    value: DateTimeRangeValue
  } {
    const layout = this._layout(PopupManager.instance.context)
    return {
      panelX: layout.panelX,
      panelY: layout.panelY,
      panelW: layout.panelW,
      panelH: layout.panelH,
      activePanel: this._activePanel,
      modes: [...this._modes],
      value: this._draftValue(),
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
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (
        this._modes[this._activePanel] === 'time' &&
        this._timePanels[this._activePanel].handleKeyDown(event)
      ) return true
      const next = event.shiftKey ? this._activePanel - 1 : this._activePanel + 1
      if (next === 0 || next === 1) {
        event.preventDefault()
        this._activePanel = next
        this.requestPopupPaint()
        return true
      }
      this.close()
      return false
    }
    if (this._modes[this._activePanel] === 'date') {
      return this._datePanels[this._activePanel].handleKeyDown(event).handled
    }
    return this._timePanels[this._activePanel].handleKeyDown(event)
  }

  protected override onPopupClose(): void {
    super.onPopupClose()
    this._onClose?.()
  }

  dispose(): void {
    this.close()
    this.disposePopupSurface()
  }

  private _draftValue(): DateTimeRangeValue {
    return {
      start: composeDateTimeValue(
        this._datePanels[0].selected,
        this._timePanels[0].parts,
        this._timePrecision,
      ),
      end: composeDateTimeValue(
        this._datePanels[1].selected,
        this._timePanels[1].parts,
        this._timePrecision,
      ),
    }
  }

  private _handleSurfacePointerDown(
    event: PopupPointerEvent,
    popupContext: PopupContext = PopupManager.instance.context,
  ): void {
    const layout = this._layout(popupContext)
    const footer = this._footerButtonAt(event.position, layout)
    if (footer === 'now') {
      const now = currentDateTime()
      this._datePanels[this._activePanel].syncSelected(now.date)
      this._timePanels[this._activePanel].reset(
        formatTimeValue(now.time, this._timePrecision),
        now.time,
      )
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
    const tab = this._tabAt(event.position, layout)
    if (tab) {
      this._activePanel = tab.panel
      this._modes[tab.panel] = tab.mode
      this.requestPopupPaint()
      return
    }
    const panel = this._panelAt(event.position, layout)
    if (panel === null) return
    this._activePanel = panel
    if (this._modes[panel] === 'date') {
      this._datePanels[panel].handlePointerDown(
        event.position,
        this._contentRect(panel, layout),
        layout.style,
      )
    } else {
      this._timePanels[panel].handlePointerDown(
        event.position,
        this._contentRect(panel, layout),
        layout.style,
      )
    }
    this.requestPopupPaint()
  }

  private _handleSurfacePointerMove(
    event: PopupPointerEvent,
    popupContext: PopupContext = PopupManager.instance.context,
  ): void {
    const layout = this._layout(popupContext)
    const footer = this._footerButtonAt(event.position, layout)
    const tab = this._tabAt(event.position, layout)
    let changed = footer !== this._hoveredFooter || !sameTab(tab, this._hoveredTab)
    this._hoveredFooter = footer
    this._hoveredTab = tab
    for (const panel of [0, 1] as const) {
      const panelChanged = this._modes[panel] === 'date'
        ? this._datePanels[panel].handlePointerMove(
            event.position,
            this._contentRect(panel, layout),
            layout.style,
          )
        : this._timePanels[panel].handlePointerMove(
            event.position,
            this._contentRect(panel, layout),
            layout.style,
          )
      if (panelChanged) changed = true
    }
    if (changed) this.requestPopupPaint()
  }

  private _handleSurfaceWheel(
    event: WheelPointerEvent,
    popupContext: PopupContext = PopupManager.instance.context,
  ): boolean {
    const layout = this._layout(popupContext)
    const panel = this._panelAt(event.position, layout)
    if (panel === null || this._modes[panel] !== 'time') return true
    this._activePanel = panel
    return this._timePanels[panel].handleWheel(
      event,
      this._contentRect(panel, layout),
      layout.style,
    )
  }

  private _clearHover(): void {
    let changed = this._hoveredFooter !== null || this._hoveredTab !== null
    this._hoveredFooter = null
    this._hoveredTab = null
    for (const panel of this._datePanels) if (panel.clearHover()) changed = true
    for (const panel of this._timePanels) if (panel.clearHover()) changed = true
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
    tabsHeight: number
    contentHeight: number
    statusHeight: number
    footerHeight: number
    gap: number
  } {
    const style = deriveDatePickerStyle(popupContext.theme)
    const popupStyle = derivePopupStyle(popupContext.theme)
    const itemWidth = Math.max(
      DateCalendarPanel.minimumWidth(style),
      TimeSelectionPanel.minimumWidth(style, this._timePrecision),
    )
    const tabsHeight = style.cellSize
    const contentHeight = Math.max(
      DateCalendarPanel.height(style),
      TimeSelectionPanel.height(style),
    )
    const statusHeight = style.cellSize
    const footerHeight = style.footerHeight
    const gap = Math.max(8, style.padding)
    const panelW = itemWidth * 2 + gap
    const panelH = tabsHeight + contentHeight + statusHeight + footerHeight
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
      tabsHeight,
      contentHeight,
      statusHeight,
      footerHeight,
      gap,
    }
  }

  private _contentRect(
    panel: 0 | 1,
    layout: ReturnType<DateTimeRangePickerPopup['_layout']>,
  ) {
    return {
      x: layout.panelX + panel * (layout.itemWidth + layout.gap),
      y: layout.panelY + layout.tabsHeight,
      width: layout.itemWidth,
    }
  }

  private _panelAt(
    point: Offset,
    layout: ReturnType<DateTimeRangePickerPopup['_layout']>,
  ): 0 | 1 | null {
    for (const panel of [0, 1] as const) {
      const rect = this._contentRect(panel, layout)
      if (
        point.x >= rect.x && point.x <= rect.x + rect.width &&
        point.y >= rect.y && point.y <= rect.y + layout.contentHeight
      ) return panel
    }
    return null
  }

  private _tabAt(
    point: Offset,
    layout: ReturnType<DateTimeRangePickerPopup['_layout']>,
  ): { panel: 0 | 1; mode: DateTimePanelMode } | null {
    if (point.y < layout.panelY || point.y > layout.panelY + layout.tabsHeight) return null
    for (const panel of [0, 1] as const) {
      const x = layout.panelX + panel * (layout.itemWidth + layout.gap)
      if (point.x < x || point.x > x + layout.itemWidth) continue
      return {
        panel,
        mode: point.x < x + layout.itemWidth / 2 ? 'date' : 'time',
      }
    }
    return null
  }

  private _footerButtonAt(
    point: Offset,
    layout: ReturnType<DateTimeRangePickerPopup['_layout']>,
  ): DateTimeRangeFooterButton | null {
    const top = layout.panelY + layout.tabsHeight + layout.contentHeight + layout.statusHeight
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
      const panelX = x + panel * (layout.itemWidth + layout.gap)
      const tabWidth = layout.itemWidth / 2
      for (const [index, mode] of (['date', 'time'] as const).entries()) {
        const tabX = panelX + index * tabWidth
        const selected = this._modes[panel] === mode
        const hovered = sameTab(this._hoveredTab, { panel, mode })
        if (selected || hovered) {
          dl.fillRect(
            tabX + 2,
            y + 2,
            tabWidth - 4,
            layout.tabsHeight - 4,
            resolveBgColor(layout.style.navBg, 'hovered'),
            layout.popupStyle.borderRadius,
          )
        }
        dl.fillText(
          mode === 'date' ? `${panel === 0 ? '开始' : '结束'}日期` : `${panel === 0 ? '开始' : '结束'}时间`,
          tabX + tabWidth / 2,
          y + layout.tabsHeight / 2,
          selected ? layout.style.accentText : layout.style.text,
          layout.style.weekLabelFontSize,
          layout.style.fontFamily,
          'center',
          'middle',
        )
      }
      const contentRect = {
        x: panelX,
        y: y + layout.tabsHeight,
        width: layout.itemWidth,
      }
      if (this._modes[panel] === 'date') {
        this._datePanels[panel].paint(
          context,
          dl,
          contentRect,
          layout.style,
          layout.popupStyle,
          { active: panel === this._activePanel },
        )
      } else {
        this._timePanels[panel].paint(
          context,
          dl,
          contentRect,
          layout.style,
          layout.popupStyle,
          { active: panel === this._activePanel },
        )
      }
    }

    const separatorX = x + layout.itemWidth + layout.gap / 2
    dl.line(
      separatorX,
      y + layout.style.padding,
      separatorX,
      y + layout.tabsHeight + layout.contentHeight - layout.style.padding,
      layout.style.separator,
      1,
    )
    const value = this._draftValue()
    const statusY = y + layout.tabsHeight + layout.contentHeight
    dl.line(
      x + layout.style.padding,
      statusY,
      x + layout.panelW - layout.style.padding,
      statusY,
      layout.style.separator,
      1,
    )
    dl.fillText(
      value.start && value.end
        ? `${value.start}  ~  ${value.end}`
        : '请完整选择开始和结束日期时间',
      x + layout.panelW / 2,
      statusY + layout.statusHeight / 2,
      value.start && value.end ? layout.style.text : layout.style.accentText,
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
    const buttons: Array<{ key: DateTimeRangeFooterButton; label: string }> = [
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

export class RenderDateTimeRangeEdit extends RenderBox implements
  InteractiveRenderObject,
  Focusable,
  GestureArenaMember,
  ValueEditor<
    DateTimeRangeValue,
    DateTimeRangeEditValueChangeReason,
    DateTimeRangeEditValueChangeDetail
  > {
  static override debugTypeName = 'RenderDateTimeRangeEdit'

  private _value: DateTimeRangeValue
  private _timePrecision: TimePrecision
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
    DateTimeRangeValue,
    DateTimeRangeEditValueChangeReason,
    DateTimeRangeEditValueChangeDetail
  >()
  private readonly _pendingGesture = new PendingPointerGesture()
  private _pressedPointerAction: 'clear' | null = null
  private readonly _popup = new DateTimeRangePickerPopup()

  placeholder: string
  separator: string
  onChange?: (value: DateTimeRangeValue) => void

  constructor(options: DateTimeRangeEditOptions = {}) {
    super(options)
    this._timePrecision = options.timePrecision ?? 'second'
    this._value = normalizeDateTimeRangeValue(options.value, this._timePrecision)
    this.placeholder = options.placeholder ?? '选择日期时间范围'
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

  get value(): DateTimeRangeValue { return { ...this._value } }
  set value(value: DateTimeRangeValue) {
    const normalized = normalizeDateTimeRangeValue(value, this.timePrecision)
    if (sameDateTimeRangeValue(normalized, this._value)) return
    this._value = normalized
    if (this._popup.visible) this._popup.syncValue(normalized)
    this.markNeedsPaint()
  }

  getValue(): DateTimeRangeValue { return this.value }
  setValue(value: DateTimeRangeValue): void {
    const normalized = normalizeDateTimeRangeValue(value, this.timePrecision)
    if (sameDateTimeRangeValue(normalized, this._value)) return
    this.cancelEdit()
    this.value = normalized
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<
      DateTimeRangeValue,
      DateTimeRangeEditValueChangeReason,
      DateTimeRangeEditValueChangeDetail
    >,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: ValueEditorBlurListener): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
  }

  get timePrecision(): TimePrecision { return this._timePrecision }
  set timePrecision(value: TimePrecision) {
    if (value === this._timePrecision) return
    const previousValue = this.value
    this._timePrecision = value
    this._value = normalizeDateTimeRangeValue(previousValue, value)
    if (this._popup.visible) {
      this._popup.syncConfiguration({
        timePrecision: value,
        hourStep: this.hourStep,
        minuteStep: this.minuteStep,
        secondStep: this.secondStep,
      })
      this._popup.syncValue(this._value)
    }
    this.markNeedsLayout()
    this.markNeedsPaint()
    if (!sameDateTimeRangeValue(previousValue, this._value)) {
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
      width: constraints.maxWidth === Infinity ? 390 : constraints.maxWidth,
      height: measureFormFieldHeight(style, style.height, this.helperText),
    }
  }

  override getMinLayoutWidthHint(): number | undefined { return 390 }

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
    value: DateTimeRangeValue
    timePrecision: TimePrecision
    popupVisible: boolean
    popup: ReturnType<DateTimeRangePickerPopup['debugState']> | null
  } {
    return {
      value: this.value,
      timePrecision: this.timePrecision,
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
      timePrecision: this.timePrecision,
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

  private _setValue(
    value: DateTimeRangeValue,
    reason: DateTimeRangeEditValueChangeReason,
  ): void {
    const normalized = normalizeDateTimeRangeValue(value, this.timePrecision)
    const previousValue = this.value
    if (sameDateTimeRangeValue(normalized, previousValue)) return
    this._value = normalized
    runCleanupSteps([
      () => this.onChange?.(this.value),
      () => this._valueEditorEvents.emitValueChange({
        value: this.value,
        previousValue,
        reason,
        detail: { complete: normalized.start !== null && normalized.end !== null },
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
    if (!this._value.start) return ''
    return this._value.end
      ? `${this._value.start}${this.separator}${this._value.end}`
      : `${this._value.start}${this.separator}`
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
        leadingIcon: 'calendar',
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

export function normalizeDateTimeRangeValue(
  value: DateTimeRangeValue | null | undefined,
  precision: TimePrecision = 'second',
): DateTimeRangeValue {
  let start = normalizeDateTimeValue(value?.start, precision)
  let end = normalizeDateTimeValue(value?.end, precision)
  if (!start) end = null
  if (start && end && start > end) {
    const previousStart = start
    start = end
    end = previousStart
  }
  return { start, end }
}

export function normalizeDateTimeValue(
  value: unknown,
  precision: TimePrecision = 'second',
): string | null {
  const parsed = parseDateTimeValue(value)
  return parsed
    ? composeDateTimeValue(parsed.date, parsed.time, precision)
    : null
}

function parseDateTimeValue(value: unknown): ParsedDateTime | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)$/.exec(value.trim())
  if (!match) return null
  const date = parseISOCalendarDate(match[1]!)
  const time = parseTimeValue(match[2]!)
  if (!date || !time) return null
  return { date, time }
}

function composeDateTimeValue(
  date: CalendarDate | null,
  time: TimeParts | null,
  precision: TimePrecision,
): string | null {
  if (!date || !time) return null
  return `${formatISOCalendarDate(date)}T${formatTimeValue(time, precision)}`
}

function currentDateTime(): ParsedDateTime {
  const now = new Date()
  return {
    date: todayCalendarDate(),
    time: { hour: now.getHours(), minute: now.getMinutes(), second: now.getSeconds() },
  }
}

function addHours(value: ParsedDateTime, hours: number): ParsedDateTime {
  const nextHour = value.time.hour + hours
  const dayDelta = Math.floor(nextHour / 24)
  const date = shiftCalendarDays(value.date, dayDelta)
  const overflowed = dayDelta !== 0 &&
    !sameCalendarDate(shiftCalendarDays(date, -dayDelta), value.date)
  if (overflowed) {
    return {
      date,
      time: dayDelta > 0
        ? { hour: 23, minute: 59, second: 59 }
        : { hour: 0, minute: 0, second: 0 },
    }
  }
  return {
    date,
    time: { ...value.time, hour: ((nextHour % 24) + 24) % 24 },
  }
}

function sameDateTimeRangeValue(
  left: DateTimeRangeValue,
  right: DateTimeRangeValue,
): boolean {
  return left.start === right.start && left.end === right.end
}

function sameTab(
  left: { panel: 0 | 1; mode: DateTimePanelMode } | null,
  right: { panel: 0 | 1; mode: DateTimePanelMode } | null,
): boolean {
  return left === right || !!left && !!right && left.panel === right.panel && left.mode === right.mode
}

function positiveInteger(value: number | undefined): number {
  if (!Number.isFinite(value) || value! <= 0) return 1
  return Math.max(1, Math.trunc(value!))
}
