// Dropdown/Select: 下拉选择组件
// 架构：触发器（RenderComboBox）+ 独立弹出层（DropdownPopup）
// DropdownPopup 作为 interceptor 注册到 EventDispatcher，与 widget 树完全解耦

import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import {
  paintVBar,
  resolveScrollbarGeometry,
  type ScrollbarGeometry,
} from '../rendering/scrollbar'
import { paintSingleLineText } from '../rendering/text_painter'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import {
  deriveDropdownStyle,
  derivePopupStyle,
  deriveScrollbarStyle,
  deriveTextInputStyle,
  deriveTreeStyle,
  resolveBgColor,
  resolveTextColor,
} from '../theme/component_styles'
import type { TextInputStyleTokens } from '../theme/component_styles'
import { RenderObject } from '../core/render_object'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton, type PointerEvent as PopupPointerEvent, type WheelPointerEvent } from '../gestures/hit_test'
import { pointerKey, type PointerKey } from '../gestures/pointer_identity'
import { ScrollbarAxisController } from '../gestures/scrollbar_interaction_controller'
import { DisposableBag, runCleanupSteps, type DisposeFn } from '../core/disposable'
import { FocusManager, type Focusable } from '../core/focus_manager'
import { PopupManager, popupViewportRect, type PopupContext } from '../core/popup_manager'
import { PopupShell } from '../core/popup_shell'
import {
  GET_POPUP_ANCHOR_RECT,
  type PopupAnchor,
  type PopupAnchorTarget,
  resolvePopupAnchorTarget,
  resolvePopupAnchorRect,
} from '../core/popup_anchor'
import { drawPopupPanel } from '../rendering/popup_painter'
import { TextMeasurer } from '../core/text_measurer'
import { ellipsizeText } from '../core/text_overflow'
import { PopupTextInput } from './popup_text_input'
import { TooltipService } from './tooltip'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorValueChangeListener,
} from './value_editor'
import {
  layoutFormFieldInlineContent,
  measureFormFieldHeight,
  pointInFormFieldRect,
  type FormFieldStatus,
} from './form_field_shell'
import { paintTriggerFieldShell } from './trigger_field_shell'

export interface DropdownOption {
  value: string
  label: string
  group?: string
  disabled?: boolean
}

function isImeCompositionKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

export interface DropdownPopupSizingOptions {
  minPopupWidth?: number
  maxPopupWidth?: number
}

export interface DropdownPopupLayout {
  rect: { x: number; y: number; w: number; h: number }
  visibleRows: number
}

const DROPDOWN_POPUP_VIEWPORT_PADDING = 8
const DEFAULT_DROPDOWN_POPUP_MAX_WIDTH = 560

export function resolveDropdownPopupLayout(opts: {
  context: PopupContext
  anchorRect: { x: number; y: number; w: number; h: number }
  desiredWidth: number
  rowCount: number
  maxVisibleRows: number
  rowHeight: number
  extraHeight: number
  minPopupWidth?: number
  maxPopupWidth?: number
}): DropdownPopupLayout {
  const viewport = popupViewportRect(opts.context)
  const viewportW = Number.isFinite(viewport.width) ? viewport.width : 9999
  const viewportH = Number.isFinite(viewport.height) ? viewport.height : 9999
  const viewportX = Number.isFinite(viewport.x) ? viewport.x : 0
  const viewportY = Number.isFinite(viewport.y) ? viewport.y : 0
  const viewportMaxW = Math.max(48, viewportW - DROPDOWN_POPUP_VIEWPORT_PADDING * 2)
  const configuredMaxW = Math.max(48, opts.maxPopupWidth ?? DEFAULT_DROPDOWN_POPUP_MAX_WIDTH)
  const w = Math.min(
    Math.max(48, opts.anchorRect.w, opts.minPopupWidth ?? 0, opts.desiredWidth),
    viewportMaxW,
    configuredMaxW,
  )
  let x = opts.anchorRect.x
  if (x + w > viewportX + viewportW - DROPDOWN_POPUP_VIEWPORT_PADDING) {
    x = viewportX + viewportW - DROPDOWN_POPUP_VIEWPORT_PADDING - w
  }
  x = Math.max(viewportX + DROPDOWN_POPUP_VIEWPORT_PADDING, x)

  const maxRows = opts.rowCount > 0
    ? Math.max(1, Math.min(opts.rowCount, Math.max(1, Math.floor(opts.maxVisibleRows))))
    : 0
  const desiredH = maxRows * opts.rowHeight + opts.extraHeight
  const downY = opts.anchorRect.y + opts.anchorRect.h + 2
  const downSpace = Math.max(0, viewportY + viewportH - DROPDOWN_POPUP_VIEWPORT_PADDING - downY)
  const upSpace = Math.max(0, opts.anchorRect.y - (viewportY + DROPDOWN_POPUP_VIEWPORT_PADDING) - 2)
  const preferDown = desiredH <= downSpace || downSpace >= upSpace
  const availableH = preferDown ? downSpace : upSpace
  const availableRows = opts.rowHeight > 0
    ? Math.floor((availableH - opts.extraHeight) / opts.rowHeight)
    : maxRows
  const visibleRows = opts.rowCount > 0
    ? Math.max(1, Math.min(maxRows, availableRows > 0 ? availableRows : 1))
    : 0
  const h = visibleRows * opts.rowHeight + opts.extraHeight
  let y = preferDown ? downY : opts.anchorRect.y - 2 - h
  if (y + h > viewportY + viewportH - DROPDOWN_POPUP_VIEWPORT_PADDING) {
    y = viewportY + viewportH - DROPDOWN_POPUP_VIEWPORT_PADDING - h
  }
  y = Math.max(viewportY + DROPDOWN_POPUP_VIEWPORT_PADDING, y)

  return { rect: { x, y, w, h }, visibleRows }
}

// ---- DropdownPopup: 独立弹出层，不属于任何 widget 树 ----

export class DropdownPopup extends PopupShell {
  private _options: DropdownOption[] = []
  private _filteredOptions: DropdownOption[] = []
  private _anchor?: PopupAnchor
  private _hoveredValue = ''
  private _keyboardIndex = -1
  private _searchText = ''
  private _searchable = false
  private _maxVisibleItems = 8
  private _minPopupWidth?: number
  private _maxPopupWidth?: number
  private _selectedValue = ''
  private _clearable = false
  private _keepOpenOnAnchorPointerDown = false
  private _scrollOffset = 0
  private _scrollbarDragging = false
  private _scrollbarPointerKey?: PointerKey
  private readonly _scrollbarController = new ScrollbarAxisController('vertical')

  private _onSelect?: (value: string, option: DropdownOption) => boolean | void
  private _onClear?: () => boolean | void
  private _onTab?: (direction: 1 | -1) => void
  private _onClose?: () => void
  private _searchInput = new PopupTextInput(() => PopupManager.instance.requestPaint())
  private _disposables = new DisposableBag()

  constructor() {
    super()
  }

  debugState(): {
    filteredOptions: DropdownOption[]
    keyboardIndex: number
    scrollOffset: number
    searchText: string
    searchable: boolean
    clearable: boolean
  } {
    return {
      filteredOptions: [...this._filteredOptions],
      keyboardIndex: this._keyboardIndex,
      scrollOffset: this._scrollOffset,
      searchText: this._searchText,
      searchable: this._searchable,
      clearable: this._canClearSelectedOption(),
    }
  }

  open(opts: {
    options: DropdownOption[]
    selectedValue: string
    anchor: PopupAnchor
    searchable: boolean
    maxVisibleItems: number
    minPopupWidth?: number
    maxPopupWidth?: number
    clearable?: boolean
    keepOpenOnAnchorPointerDown?: boolean
    onSelect: (value: string, option: DropdownOption) => boolean | void
    onClear?: () => boolean | void
    onTab?: (direction: 1 | -1) => void
    onClose: () => void
  }): void {
    if (this.popupOpen) this.close()
    const previousFocus = FocusManager.instance.current
    this._searchInput.endSession()
    this._options = opts.options
    this._filteredOptions = [...opts.options]
    this._selectedValue = opts.selectedValue
    this._anchor = opts.anchor
    this._searchable = opts.searchable
    this._maxVisibleItems = opts.maxVisibleItems
    this._minPopupWidth = opts.minPopupWidth
    this._maxPopupWidth = opts.maxPopupWidth
    this._clearable = opts.clearable ?? false
    this._keepOpenOnAnchorPointerDown = opts.keepOpenOnAnchorPointerDown ?? false
    this._onSelect = opts.onSelect
    this._onClear = opts.onClear
    this._onTab = opts.onTab
    this._onClose = opts.onClose
    this._searchText = ''
    this._hoveredValue = ''
    this._keyboardIndex = this._filteredOptions.findIndex(o => o.value === opts.selectedValue)
    this._scrollOffset = 0
    this._scrollToKeyboard()
    this.openPopup({ owner: resolvePopupAnchorTarget(opts.anchor) })
    if (previousFocus) FocusManager.instance.setFocus(previousFocus)

    if (this._searchable) {
      this._searchInput.beginSession({
        value: '',
        placeholder: '搜索...',
        onInput: (value) => {
          this._searchText = value
          this._filterOptions()
          this.requestPopupPaint()
        },
        onCompositionUpdate: () => {
          this.requestPopupPaint()
        },
        onCompositionEnd: (value) => {
          this._searchText = value
          this._filterOptions()
          this.requestPopupPaint()
        },
        onKeyDown: e => {
          this._handleKeyDown(e)
        },
      })
    }

    this.requestPopupPaint()
  }

  updateOptions(options: DropdownOption[], selectedValue = this._selectedValue): void {
    this._options = options
    this._selectedValue = selectedValue
    this._filterOptions()
    const selectedIndex = this._filteredOptions.findIndex(option =>
      !option.disabled && option.value === selectedValue,
    )
    this._keyboardIndex = selectedIndex >= 0
      ? selectedIndex
      : this._firstEnabledIndex()
    this._hoveredValue = ''
    this._scrollOffset = 0
    this._scrollToKeyboard()
    this.requestPopupPaint()
  }

  private _handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    if (isImeCompositionKey(event) || this._searchInput.composing) return false
    if (event.key === 'Tab') {
      if (this._onTab) {
        event.preventDefault()
        event.stopPropagation()
        const onTab = this._onTab
        const direction = event.shiftKey ? -1 : 1
        this.close()
        onTab(direction)
        return true
      }
      this.close()
      return false
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
      return true
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this._moveKeyboard(1)
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      this._moveKeyboard(-1)
      return true
    }
    if (event.key === 'Home') {
      event.preventDefault()
      this._keyboardIndex = this._firstEnabledIndex()
      this._scrollToKeyboard()
      this.requestPopupPaint()
      return true
    }
    if (event.key === 'End') {
      event.preventDefault()
      this._keyboardIndex = this._lastEnabledIndex()
      this._scrollToKeyboard()
      this.requestPopupPaint()
      return true
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const opt = this._filteredOptions[this._activeIndex()]
      if (opt) this._select(opt)
      return true
    }
    if (!this._searchable && event.key.length === 1 && /\S/.test(event.key)) {
      event.preventDefault()
      this._jumpToPrefix(event.key)
      return true
    }
    return false
  }

  private _filterOptions(): void {
    const q = this._searchText.toLowerCase()
    this._filteredOptions = q
      ? this._options.filter(o => o.label.toLowerCase().includes(q))
      : [...this._options]
    this._keyboardIndex = -1
    this._scrollOffset = 0
  }

  private _firstEnabledIndex(): number {
    return this._filteredOptions.findIndex(option => !option.disabled)
  }

  private _lastEnabledIndex(): number {
    for (let i = this._filteredOptions.length - 1; i >= 0; i--) {
      if (!this._filteredOptions[i]!.disabled) return i
    }
    return -1
  }

  private _moveKeyboard(direction: 1 | -1): void {
    if (this._filteredOptions.length === 0) {
      this._keyboardIndex = -1
      return
    }
    let next = this._keyboardIndex
    for (let step = 0; step < this._filteredOptions.length; step++) {
      next = direction === 1 ? next + 1 : next - 1
      if (next < 0) next = this._filteredOptions.length - 1
      if (next >= this._filteredOptions.length) next = 0
      if (!this._filteredOptions[next]!.disabled) {
        this._keyboardIndex = next
        this._scrollToKeyboard()
        this.requestPopupPaint()
        return
      }
    }
  }

  private _jumpToPrefix(key: string): void {
    const ch = key.toLowerCase()
    const start = Math.max(0, this._keyboardIndex + 1)
    const total = this._filteredOptions.length
    for (let i = 0; i < total; i++) {
      const idx = (start + i) % total
      const option = this._filteredOptions[idx]
      if (option && !option.disabled && option.label.toLowerCase().startsWith(ch)) {
        this._keyboardIndex = idx
        this._scrollToKeyboard()
        this.requestPopupPaint()
        return
      }
    }
  }

  private _scrollToKeyboard(): void {
    if (this._keyboardIndex < 0) return
    const visibleRows = Math.max(1, this._popupLayout(PopupManager.instance.context).visibleRows)
    if (this._keyboardIndex < this._scrollOffset) {
      this._scrollOffset = this._keyboardIndex
    } else if (this._keyboardIndex >= this._scrollOffset + visibleRows) {
      this._scrollOffset = this._keyboardIndex - visibleRows + 1
    }
    this._scrollOffset = Math.max(0, Math.min(this._maxScrollOffset(), this._scrollOffset))
  }

  private _maxScrollOffset(): number {
    const visibleRows = this._popupLayout(PopupManager.instance.context).visibleRows
    return Math.max(0, this._filteredOptions.length - Math.max(1, visibleRows))
  }

  private _wheelStep(deltaY: number): number {
    if (deltaY === 0) return 0
    if (Math.abs(deltaY) < 8) return deltaY > 0 ? 1 : -1
    return deltaY > 0 ? 3 : -3
  }

  private _resetScrollbarDrag(point?: Offset): void {
    const pointer = this._scrollbarPointerKey
    this._scrollbarDragging = false
    this._scrollbarPointerKey = undefined
    const metrics = point ? this._scrollbarMetrics(PopupManager.instance.context) : null
    const changed = point && metrics
      ? this._scrollbarController.endPointer(point, metrics.geometry, pointer).stateChanged
      : this._scrollbarController.cancelPointer(pointer)
    if (changed) this.requestPopupPaint()
  }

  private _setScrollOffset(next: number): void {
    const clamped = Math.max(0, Math.min(this._maxScrollOffset(), next))
    if (clamped === this._scrollOffset) return
    this._scrollOffset = clamped
    this.requestPopupPaint()
  }

  private _hideOverflowTooltip(): void {
    TooltipService.currentOrNull?.hide()
  }

  private _optionTextMaxWidth(rect: { w: number }, hasScrollbar: boolean, context: PopupContext): number {
    const dropdownStyle = deriveDropdownStyle(context.theme)
    const scrollbarStyle = deriveScrollbarStyle(context.theme)
    const scrollbarReserve = hasScrollbar ? scrollbarStyle.gutterSize + 6 : 0
    return Math.max(0, rect.w - dropdownStyle.padding * 4 - scrollbarReserve)
  }

  private _syncOverflowTooltip(
    option: DropdownOption | undefined,
    point: Offset,
    rect: { w: number },
    hasScrollbar: boolean,
    context: PopupContext,
  ): void {
    if (!option?.label) {
      this._hideOverflowTooltip()
      return
    }
    const dropdownStyle = deriveDropdownStyle(context.theme)
    const maxTextW = this._optionTextMaxWidth(rect, hasScrollbar, context)
    const overflow = TextMeasurer.measureWidth(option.label, dropdownStyle.fontSize, dropdownStyle.fontFamily) > maxTextW
    if (overflow) {
      TooltipService.currentOrNull?.show(option.label, point, 250)
      TooltipService.currentOrNull?.updatePos(point)
    } else {
      this._hideOverflowTooltip()
    }
  }

  private _listMetrics(context: PopupContext): {
    rect: { x: number; y: number; w: number; h: number }
    itemHeight: number
    contentY: number
    listHeight: number
  } {
    const dropdownStyle = deriveDropdownStyle(context.theme)
    const popupStyle = derivePopupStyle(context.theme)
    const layout = this._popupLayout(context)
    const rect = layout.rect
    const itemHeight = dropdownStyle.itemHeight
    const searchHeight = this._searchable ? itemHeight + popupStyle.padding : 0
    const contentY = rect.y + popupStyle.padding + searchHeight
    const listHeight = layout.visibleRows * itemHeight
    return { rect, itemHeight, contentY, listHeight }
  }

  private _scrollbarMetrics(context: PopupContext): null | {
    x: number
    y: number
    w: number
    h: number
    thumbY: number
    thumbH: number
    geometry: ScrollbarGeometry
  } {
    const layout = this._popupLayout(context)
    if (this._filteredOptions.length <= layout.visibleRows) return null
    const scrollbarStyle = deriveScrollbarStyle(context.theme)
    const { rect, contentY, listHeight } = this._listMetrics(context)
    const x = rect.x + rect.w - scrollbarStyle.gutterSize - 2
    const geometry = resolveScrollbarGeometry({
      axis: 'vertical',
      trackRect: { x, y: contentY, width: scrollbarStyle.gutterSize, height: listHeight },
      viewportSize: layout.visibleRows,
      contentSize: this._filteredOptions.length,
      scrollOffset: this._scrollOffset,
      visualThickness: scrollbarStyle.thumbThickness,
      minThumbLength: scrollbarStyle.minThumbLength,
      endInset: scrollbarStyle.endInset,
    })
    return {
      x,
      y: contentY,
      w: scrollbarStyle.gutterSize,
      h: listHeight,
      thumbY: geometry.thumbRect.y,
      thumbH: geometry.thumbRect.height,
      geometry,
    }
  }

  private _canClearSelectedOption(): boolean {
    return this._clearable && this._selectedValue.length > 0
  }

  private _activeIndex(): number {
    if (this._hoveredValue) {
      const hoveredIndex = this._filteredOptions.findIndex(opt => opt.value === this._hoveredValue)
      if (hoveredIndex >= 0) return hoveredIndex
    }
    return this._keyboardIndex
  }

  private _select(opt: DropdownOption): void {
    if (opt.disabled) return
    if (this._canClearSelectedOption() && opt.value === this._selectedValue) {
      this._clearSelection()
      return
    }
    this._selectedValue = opt.value
    let accepted: boolean | void = true
    runCleanupSteps([
      () => { accepted = this._onSelect?.(opt.value, opt) },
      () => {
        if (accepted === false) PopupManager.instance.requestPaint()
        else this.close()
      },
    ])
  }

  private _clearSelection(): void {
    if (!this._canClearSelectedOption()) return
    this._selectedValue = ''
    let accepted: boolean | void = true
    runCleanupSteps([
      () => { accepted = this._onClear?.() },
      () => {
        if (accepted === false) PopupManager.instance.requestPaint()
        else this.close()
      },
    ])
  }

  private _popupLayout(context: PopupContext): DropdownPopupLayout {
    const dropdownStyle = deriveDropdownStyle(context.theme)
    const popupStyle = derivePopupStyle(context.theme)
    const anchorRect = resolvePopupAnchorRect(this._anchor)
    const itemH = dropdownStyle.itemHeight
    const searchH = this._searchable ? itemH + popupStyle.padding : 0
    const textW = this._filteredOptions.reduce((max, option) => {
      return Math.max(max, TextMeasurer.measureWidth(option.label, dropdownStyle.fontSize, dropdownStyle.fontFamily))
    }, 0)
    const scrollbarReserve = this._filteredOptions.length > this._maxVisibleItems
      ? deriveScrollbarStyle(context.theme).gutterSize + 6
      : 0
    return resolveDropdownPopupLayout({
      context,
      anchorRect,
      desiredWidth: textW + dropdownStyle.padding * 4 + scrollbarReserve,
      rowCount: this._filteredOptions.length,
      maxVisibleRows: this._maxVisibleItems,
      rowHeight: itemH,
      extraHeight: searchH + popupStyle.padding * 2,
      minPopupWidth: this._minPopupWidth,
      maxPopupWidth: this._maxPopupWidth,
    })
  }

  // 弹出层矩形（全局坐标）
  private _popupRect(context: PopupContext): { x: number; y: number; w: number; h: number } {
    return this._popupLayout(context).rect
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

  // ---- Interceptor 接口（供 EventDispatcher 使用）----

  hitTest(point: Offset, context: PopupContext): boolean {
    if (!this.visible) return false
    const r = this._popupRect(context)
    return point.x >= r.x && point.x <= r.x + r.w &&
           point.y >= r.y && point.y <= r.y + r.h
  }

  onPointerDown(event: PopupPointerEvent, context: PopupContext): void {
    if (!isPrimaryPointerButton(event)) return
    if (!this.visible) return
    if (
      this._scrollbarDragging &&
      this._scrollbarPointerKey !== pointerKey(event)
    ) {
      return
    }
    const point = event.position
    if (!this.hitTest(point, context)) { this.close(); return }

    const dropdownStyle = deriveDropdownStyle(context.theme)
    const popupStyle = derivePopupStyle(context.theme)
    const itemH = dropdownStyle.itemHeight
    const r = this._popupRect(context)
    const searchH = this._searchable ? itemH + popupStyle.padding : 0
    const searchX = r.x + popupStyle.padding
    const searchW = r.w - popupStyle.padding * 2
    const searchY = r.y + popupStyle.padding
    const listY = r.y + popupStyle.padding + searchH
    const scrollbar = this._scrollbarMetrics(context)

    if (this._searchable && this._searchInput.hitTest(point, { x: searchX, y: searchY, w: searchW, h: itemH })) {
      this._searchInput.handlePointerDown(point, { x: searchX, y: searchY, w: searchW, h: itemH }, event.clickCount)
      return
    }

    if (
      scrollbar &&
      point.x >= scrollbar.x &&
      point.x <= scrollbar.x + scrollbar.w &&
      point.y >= scrollbar.y &&
      point.y <= scrollbar.y + scrollbar.h
    ) {
      const result = this._scrollbarController.beginPointer(point, scrollbar.geometry, pointerKey(event))
      if (result.dragStarted) {
        this._scrollbarDragging = true
        this._scrollbarPointerKey = pointerKey(event)
      }
      if (result.scrollOffset !== undefined) this._setScrollOffset(Math.round(result.scrollOffset))
      this.requestPopupPaint()
      return
    }

    if (point.y >= listY) {
      const i = Math.floor((point.y - listY) / itemH) + this._scrollOffset
      const opt = this._filteredOptions[i]
      if (opt) this._select(opt)
    }
  }

  onPointerMove(event: PopupPointerEvent, context: PopupContext): void {
    if (!this.visible) return
    if (
      this._scrollbarDragging &&
      this._scrollbarPointerKey !== pointerKey(event)
    ) {
      return
    }
    this._searchInput.handlePointerMove(event.position)
    const point = event.position
    if (this._scrollbarDragging && pointerKey(event) === this._scrollbarPointerKey) {
      const metrics = this._scrollbarMetrics(context)
      if (!metrics) return
      const result = this._scrollbarController.updatePointer(point, metrics.geometry, pointerKey(event))
      this._setScrollOffset(Math.round(result.scrollOffset ?? this._scrollOffset))
      return
    }
    const scrollbar = this._scrollbarMetrics(context)
    const scrollbarChanged = scrollbar
      ? this._scrollbarController.updateHover(point, scrollbar.geometry)
      : this._scrollbarController.clearHover()
    if (scrollbarChanged) this.requestPopupPaint()
    const dropdownStyle = deriveDropdownStyle(context.theme)
    const popupStyle = derivePopupStyle(context.theme)
    const itemH = dropdownStyle.itemHeight
    const layout = this._popupLayout(context)
    const r = layout.rect
    const searchH = this._searchable ? itemH + popupStyle.padding : 0
    const listY = r.y + popupStyle.padding + searchH
    const listH = layout.visibleRows * itemH
    const inList =
      point.x >= r.x &&
      point.x <= r.x + r.w &&
      point.y >= listY &&
      point.y <= listY + listH

    if (!inList) {
      if (this._hoveredValue) {
        this._hoveredValue = ''
        this._hideOverflowTooltip()
        PopupManager.instance.requestPaint()
      }
      return
    }

    const i = Math.floor((point.y - listY) / itemH) + this._scrollOffset
    const opt = this._filteredOptions[i]
    const key = opt?.value ?? ''
    const hasScrollbar = this._filteredOptions.length > layout.visibleRows
    if (key !== this._hoveredValue) {
      this._hoveredValue = key
      this._syncOverflowTooltip(opt, point, r, hasScrollbar, context)
      PopupManager.instance.requestPaint()
    } else {
      this._syncOverflowTooltip(opt, point, r, hasScrollbar, context)
    }
  }

  onPointerUp(event: PopupPointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (
      this._scrollbarDragging &&
      this._scrollbarPointerKey !== pointerKey(event)
    ) {
      return
    }
    this._searchInput.handlePointerUp()
    this._resetScrollbarDrag(event.position)
  }

  onPointerCancel(event: PopupPointerEvent): void {
    if (
      this._scrollbarDragging &&
      this._scrollbarPointerKey !== pointerKey(event)
    ) {
      return
    }
    this._searchInput.handlePointerCancel()
    this._resetScrollbarDrag()
  }

  onWheel(event: WheelPointerEvent, context: PopupContext): boolean {
    if (!this.visible || !this.hitTest(event.position, context)) return false
    const maxScroll = this._maxScrollOffset()
    if (maxScroll <= 0 || event.deltaY === 0) return false
    this._setScrollOffset(this._scrollOffset + this._wheelStep(event.deltaY))
    return true
  }

  onKeyDown(event: KeyboardEvent): boolean {
    return this._handleKeyDown(event)
  }

  onOutsidePointerDown(event: PopupPointerEvent): boolean {
    if (!this._hitAnchor(event.position)) return false
    if (this._keepOpenOnAnchorPointerDown) return false
    this.close()
    return true
  }

  // ---- 绘制（由外部在 overlay 层调用）----

  paint(context: PaintContext): void {
    if (!this.visible) return
    const popupContext = PopupManager.instance.context
    const dropdown = deriveDropdownStyle(context.theme)
    const scrollbarStyle = deriveScrollbarStyle(context.theme)
    const popupStyle = derivePopupStyle(context.theme)
    const popupPanelStyle = { ...popupStyle, bgColor: deriveTreeStyle(context.theme).panelBg }
    const dl = new DrawList(context)
    const layout = this._popupLayout(popupContext)
    const r = layout.rect
    const itemH = dropdown.itemHeight

    drawPopupPanel(dl, r.x, r.y, r.w, r.h, popupPanelStyle)

    let contentY = r.y + popupStyle.padding

    // 搜索框
    if (this._searchable) {
      const searchX = r.x + popupStyle.padding
      const searchW = r.w - popupStyle.padding * 2
      this._searchInput.paint(context, {
        x: searchX,
        y: contentY,
        w: searchW,
        h: itemH,
      }, context.theme)

      contentY += itemH + popupStyle.padding
    }

    // 选项列表
    const visibleCount = Math.min(this._filteredOptions.length - this._scrollOffset, layout.visibleRows)
    const listH = visibleCount * itemH
    const hasScrollbar = this._filteredOptions.length > layout.visibleRows
    const optionTextMaxW = this._optionTextMaxWidth(r, hasScrollbar, popupContext)
    dl.pushClip(r.x, contentY, r.w, listH)
    for (let vi = 0; vi < visibleCount; vi++) {
      const i = vi + this._scrollOffset
      const opt = this._filteredOptions[i]
      if (!opt) break
      const optY = contentY + vi * itemH
      const isSelected = opt.value === this._selectedValue
      const isHovered = opt.value === this._hoveredValue
      const isKbSelected = i === this._activeIndex()
      const itemState = {
        disabled: !!opt.disabled,
        selected: isSelected,
        hovered: isHovered || isKbSelected,
      }

      const itemBg = resolveBgColor(dropdown.itemBg, itemState)
      if (itemBg.a > 0) {
        dl.fillRect(r.x, optY, r.w, itemH, itemBg, 0)
      }

      const textColor = resolveTextColor(dropdown.itemText, itemState)
      const displayLabel = ellipsizeText(
        opt.label,
        optionTextMaxW,
        text => TextMeasurer.measureWidth(text, dropdown.fontSize, dropdown.fontFamily),
      )
      dl.fillText(displayLabel, r.x + dropdown.padding * 2, optY + itemH / 2, textColor, dropdown.fontSize, dropdown.fontFamily, 'left', 'middle')
      if (vi < visibleCount - 1) {
        dl.line(
          r.x + dropdown.padding * 2,
          optY + itemH - 0.5,
          r.x + r.w - dropdown.padding * 2,
          optY + itemH - 0.5,
          dropdown.separator,
          1,
        )
      }
    }
    dl.popClip()

    // 滚动条（超出 maxVisibleItems 时显示）
    if (hasScrollbar) {
      const sbH = layout.visibleRows * itemH
      paintVBar({
        dl,
        style: scrollbarStyle,
        trackX: r.x + r.w - scrollbarStyle.gutterSize - 2,
        trackY: contentY,
        trackW: scrollbarStyle.gutterSize,
        trackH: sbH,
        viewSize: layout.visibleRows,
        contentSize: this._filteredOptions.length,
        scrollOffset: this._scrollOffset,
        state: this._scrollbarController.state,
      })
    }
  }

  dispose(): void {
    this.close()
    this._searchInput.dispose()
    this._disposables.dispose()
    this._onSelect = undefined
    this._onClear = undefined
    this._onTab = undefined
    this._onClose = undefined
  }

  protected override onPopupClose(): void {
    this._resetScrollbarDrag()
    this._searchInput.endSession()
    this._hideOverflowTooltip()
    this._onClose?.()
  }
}

// ---- RenderComboBox: 纯触发器，只负责自身矩形的布局/绘制/交互 ----

export type ComboBoxValueChangeReason = 'selection' | 'clear'

export class RenderComboBox extends RenderBox implements
  InteractiveRenderObject,
  Focusable,
  ValueEditor<string, ComboBoxValueChangeReason, DropdownOption | null> {
  static override debugTypeName = 'RenderComboBox'
  private _options: DropdownOption[]
  private _value: string
  placeholder: string
  onChange?: (value: string, option: DropdownOption | null) => void
  searchable: boolean
  maxVisibleItems: number
  private _disabled: boolean
  private _readonly: boolean
  private _status: FormFieldStatus
  private _helperText: string
  private _prefixText: string
  private _suffixText: string
  private _clearable: boolean
  private _fieldHeightOverride?: number
  private _focusRegistered = false

  private _focused = false
  private _hovered = false
  private _popup: DropdownPopup
  private readonly _valueEditorEvents = new ValueEditorEventEmitter<
    string,
    ComboBoxValueChangeReason,
    DropdownOption | null
  >()

  constructor(opts: RenderBoxOptions & {
    options: DropdownOption[]
    value?: string
    placeholder?: string
    onChange?: (value: string, option: DropdownOption | null) => void
    searchable?: boolean
    maxVisibleItems?: number
    disabled?: boolean
    readonly?: boolean
    status?: FormFieldStatus
    helperText?: string
    prefixText?: string
    suffixText?: string
    clearable?: boolean
    fieldHeight?: number
  }) {
    super(opts)
    this._options = opts.options
    this._value = opts.value ?? ''
    this.placeholder = opts.placeholder ?? '请选择...'
    this.onChange = opts.onChange
    this.searchable = opts.searchable ?? false
    this.maxVisibleItems = opts.maxVisibleItems ?? 8
    this._disabled = opts.disabled ?? false
    this._readonly = opts.readonly ?? false
    this._status = opts.status ?? 'default'
    this._helperText = opts.helperText ?? ''
    this._prefixText = opts.prefixText ?? ''
    this._suffixText = opts.suffixText ?? ''
    this._clearable = opts.clearable ?? false
    this._fieldHeightOverride = opts.fieldHeight
    this._popup = new DropdownPopup()
    this._syncFocusRegistration()
  }

  get options(): DropdownOption[] { return this._options }
  set options(options: DropdownOption[]) {
    if (this._options === options) return
    this._options = options
    if (this._popup.visible) this._popup.close()
    this.markNeedsPaint()
  }

  get value(): string { return this._value }
  set value(value: string) {
    if (this._value === value) return
    this._value = value
    this.markNeedsPaint()
  }

  getValue(): string {
    return this.value
  }

  setValue(value: string): void {
    if (this.value === value) return
    this._popup.close()
    this.value = value
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<
      string,
      ComboBoxValueChangeReason,
      DropdownOption | null
    >,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: () => void): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
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

  get fieldHeight(): number | undefined { return this._fieldHeightOverride }
  set fieldHeight(fieldHeight: number | undefined) {
    if (this._fieldHeightOverride === fieldHeight) return
    this._fieldHeightOverride = fieldHeight
    this.markNeedsLayout()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  get isFocused(): boolean {
    return this._focused || this._popup.visible
  }

  focusIn(): void {
    if (this.disabled || this.readonly) return
    if (this._focused) return
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
    this._popup.close()
    if (typeof window === 'undefined') {
      this.focusOut()
      return
    }
    FocusManager.instance.clearFocusOf(this)
  }

  [GET_POPUP_ANCHOR_RECT](): { x: number; y: number; width: number; height: number } {
    const g = this.globalOffset
    return { x: g.x, y: g.y, width: this.size.width, height: this._fieldHeight(this._inputStyle()) }
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const inputStyle = deriveTextInputStyle(context.theme)
    const fieldHeight = this._fieldHeight(inputStyle)
    this.size = {
      width: constraints.maxWidth === Infinity ? 200 : constraints.maxWidth,
      height: measureFormFieldHeight(inputStyle, fieldHeight, this.helperText),
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w } = this.size
    const input = deriveTextInputStyle(context.theme)
    const dropdown = deriveDropdownStyle(context.theme)
    const readonlyVisual = this.readonly && !this.disabled
    const shell = paintTriggerFieldShell(context, offset, w, {
      focused: readonlyVisual ? false : this._popup.visible || this._focused,
      hovered: readonlyVisual ? false : this._hovered,
      disabled: this.disabled,
      status: this.status,
      helperText: this.helperText,
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      showClearButton: this._showClearButton(),
      reserveTrailingWidth: dropdown.fontSize,
      fieldHeight: this._fieldHeight(input),
    })
    const fieldHeight = shell.fieldHeight

    const selectedOpt = this.options.find(o => o.value === this.value)
    const displayText = selectedOpt ? selectedOpt.label : this.placeholder
    const textColor = this.disabled
      ? input.textDisabled
      : selectedOpt ? resolveTextColor(dropdown.itemText, 'normal') : input.placeholderText
    const fullTooltipText = selectedOpt?.label ?? ''
    if (!selectedOpt || !fullTooltipText) {
      this.tooltip = undefined
    } else {
      const measuredWidth = TextMeasurer.measureWidth(fullTooltipText, dropdown.fontSize, dropdown.fontFamily)
      this.tooltip = measuredWidth > shell.valueRect.w ? fullTooltipText : undefined
    }
    dl.pushClip(shell.valueRect.x, y, shell.valueRect.w, fieldHeight)
    paintSingleLineText(dl, {
      text: displayText,
      x: shell.valueRect.x,
      y: y + fieldHeight / 2,
      maxWidth: shell.valueRect.w,
      color: textColor,
      fontSize: dropdown.fontSize,
      fontFamily: dropdown.fontFamily,
    })
    dl.popClip()

    // 下拉箭头
    const arrowX = (shell.trailingRect?.x ?? (x + w - input.padding - dropdown.fontSize)) + dropdown.fontSize / 2
    const arrowY = y + fieldHeight / 2
    const arrowColor = this.disabled
      ? input.textDisabled
      : readonlyVisual
        ? input.placeholderText
      : resolveTextColor(dropdown.arrowText, this._popup.visible || this._focused ? 'selected' : 'normal')
    const ctx = context.ctx
    ctx.save()
    ctx.fillStyle = `rgba(${arrowColor.r},${arrowColor.g},${arrowColor.b},${arrowColor.a})`
    ctx.beginPath()
    const ar = dropdown.fontSize * 0.3
    if (this._popup.visible) {
      ctx.moveTo(arrowX, arrowY - ar)
      ctx.lineTo(arrowX - ar, arrowY + ar)
      ctx.lineTo(arrowX + ar, arrowY + ar)
    } else {
      ctx.moveTo(arrowX, arrowY + ar)
      ctx.lineTo(arrowX - ar, arrowY - ar)
      ctx.lineTo(arrowX + ar, arrowY - ar)
    }
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  private _openPopup(): void {
    if (this.disabled || this.readonly) return
    if (this._popup.visible) return
    this._popup.open({
      options: this.options,
      selectedValue: this.value,
      anchor: this as PopupAnchorTarget,
      searchable: this.searchable,
      maxVisibleItems: this.maxVisibleItems,
      onSelect: (value, option) => {
        this.value = value
        this._emitValueChange(value, option, 'selection')
      },
      onClose: () => { this.markNeedsPaint() },
    })
    this.markNeedsPaint()
  }

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this.disabled || this.readonly || !this._hitField(e.position)) return
    const layout = this._triggerLayout()
    if (pointInFormFieldRect(layout.clearRect, e.position)) {
      this._clearValue()
      return
    }
    if (this._popup.visible) {
      this._popup.close()
    } else {
      FocusManager.instance.setFocus(this)
      this._openPopup()
    }
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
    if (event.key === 'Escape' && this._popup.visible) {
      event.preventDefault()
      this._popup.close()
      this.markNeedsPaint()
      return true
    }
    if (this._popup.visible) return false
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault()
      this._openPopup()
      return true
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && this._showClearButton()) {
      event.preventDefault()
      this._clearValue()
      return true
    }
    return false
  }

  private _showClearButton(): boolean {
    return this.clearable && !this.disabled && !this.readonly && this.value.length > 0
  }

  private _triggerLayout() {
    const style = this._inputStyle()
    return layoutFormFieldInlineContent(style, this.globalOffset, this.size.width, this._fieldHeight(style), {
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      showClearButton: this._showClearButton(),
      reserveTrailingWidth: deriveDropdownStyle(this.currentTheme).fontSize,
    })
  }

  private _clearValue(): void {
    if (!this._showClearButton()) return
    this._popup.close()
    FocusManager.instance.setFocus(this)
    this.value = ''
    this._emitValueChange('', null, 'clear')
    this.markNeedsPaint()
  }

  private _emitValueChange(
    value: string,
    option: DropdownOption | null,
    reason: ComboBoxValueChangeReason,
  ): void {
    runCleanupSteps([
      () => this.onChange?.(value, option),
      () => this._valueEditorEvents.emitValueChange({
        value,
        reason,
        detail: option,
      }),
    ])
  }

  onPointerMove(e: PointerEvent): void {
    const wasHovered = this._hovered
    this._hovered = !this.disabled && !this.readonly && this._hitField(e.position)
    if (wasHovered !== this._hovered) this.markNeedsPaint()
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
    const fieldHeight = this._fieldHeight(this._inputStyle())
    return position.x >= g.x &&
      position.x <= g.x + this.size.width &&
      position.y >= g.y &&
      position.y <= g.y + fieldHeight
  }

  dispose(): void {
    this._valueEditorEvents.dispose()
    this._popup.dispose()
    if (this._focusRegistered && typeof window !== 'undefined') {
      FocusManager.instance.unregister(this)
      this._focusRegistered = false
    }
    this._focused = false
    this._hovered = false
    super.dispose()
  }

  private _inputStyle(): TextInputStyleTokens {
    return deriveTextInputStyle(this.currentTheme)
  }

  private _fieldHeight(style: TextInputStyleTokens): number {
    return this._fieldHeightOverride ?? style.height
  }
}
