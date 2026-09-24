import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import {
  paintVBar,
  resolveScrollbarGeometry,
  type ScrollbarGeometry,
} from '../rendering/scrollbar'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import {
  blendColor,
  deriveCheckboxStyle,
  deriveDropdownStyle,
  derivePopupStyle,
  deriveScrollbarStyle,
  deriveTextInputStyle,
  deriveTreeStyle,
  resolveBgColor,
  resolveTextColor,
} from '../theme/component_styles'
import { RenderObject } from '../core/render_object'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton, type PointerEvent as PopupPointerEvent, type WheelPointerEvent } from '../gestures/hit_test'
import type { GestureArenaMember } from '../gestures/gesture_arena'
import { PendingPointerGesture } from '../gestures/pending_pointer_gesture'
import { pointerKey, type PointerKey } from '../gestures/pointer_identity'
import { ScrollbarAxisController } from '../gestures/scrollbar_interaction_controller'
import { FocusManager, type Focusable } from '../core/focus_manager'
import { runCleanupSteps, type DisposeFn } from '../core/disposable'
import { PopupManager, type PopupContext } from '../core/popup_manager'
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
import { resolveDropdownPopupLayout, type DropdownOption, type DropdownPopupLayout } from './dropdown'
import { TooltipService } from './tooltip'
import {
  layoutFormFieldInlineContent,
  measureFormFieldHeight,
  pointInFormFieldRect,
  type FormFieldStatus,
} from './form_field_shell'
import { paintTriggerFieldShell } from './trigger_field_shell'
import { measureChipLayout, paintChip } from './chip'
import { paintIconGlyph } from './icon'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorValueChangeListener,
} from './value_editor'

function normalizeSelectedValues(
  options: readonly DropdownOption[],
  values: readonly string[],
): string[] {
  const wanted = new Set(values)
  return options.filter(option => wanted.has(option.value)).map(option => option.value)
}

function resolveSelectedOptions(
  options: readonly DropdownOption[],
  values: readonly string[],
): DropdownOption[] {
  const selected = new Set(values)
  return options.filter(option => selected.has(option.value))
}

function summaryText(
  options: readonly DropdownOption[],
  values: readonly string[],
  placeholder: string,
  availableWidth: number,
  measureText: (text: string) => number,
): { text: string; placeholder: boolean } {
  const selectedOptions = resolveSelectedOptions(options, values)
  if (selectedOptions.length === 0) {
    return {
      text: ellipsizeText(placeholder, availableWidth, measureText),
      placeholder: true,
    }
  }

  const fullText = selectedOptions.map(option => option.label).join(', ')
  if (measureText(fullText) <= availableWidth) {
    return { text: fullText, placeholder: false }
  }

  let visibleLabels = ''
  let bestText = ''
  for (let index = 0; index < selectedOptions.length; index += 1) {
    const option = selectedOptions[index]!
    const nextLabels = visibleLabels ? `${visibleLabels}, ${option.label}` : option.label
    const hiddenCount = selectedOptions.length - index - 1
    const candidate = hiddenCount > 0 ? `${nextLabels} +${hiddenCount}` : nextLabels
    if (measureText(candidate) > availableWidth) break
    visibleLabels = nextLabels
    bestText = candidate
  }

  if (bestText) return { text: bestText, placeholder: false }

  const fallback = selectedOptions.length === 1
    ? selectedOptions[0]!.label
    : `已选择 ${selectedOptions.length} 项`
  return {
    text: ellipsizeText(fallback, availableWidth, measureText),
    placeholder: false,
  }
}

interface TriggerChipLayout {
  value: string | null
  label: string
  x: number
  y: number
  w: number
  h: number
  removeRect: { x: number; y: number; w: number; h: number } | null
}

type MultiSelectPopupRow =
  | { kind: 'group'; label: string }
  | { kind: 'option'; option: DropdownOption }

type MultiSelectFooterAction = 'ok' | 'cancel' | 'clear'

export type MultiSelectDropdownDisplayMode = 'chips' | 'summary'

type MultiSelectPointerAction =
  | { kind: 'clear' }
  | { kind: 'remove'; value: string }

function isImeCompositionKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

export interface RenderMultiSelectDropdownOptions extends RenderBoxOptions {
  options: DropdownOption[]
  values?: string[]
  placeholder?: string
  onChange?: (values: string[], options: DropdownOption[]) => void
  searchable?: boolean
  maxVisibleItems?: number
  disabled?: boolean
  readonly?: boolean
  status?: FormFieldStatus
  helperText?: string
  prefixText?: string
  suffixText?: string
  clearable?: boolean
  displayMode?: MultiSelectDropdownDisplayMode
}

export class MultiSelectDropdownPopup extends PopupShell {
  private _options: DropdownOption[] = []
  private _filteredOptions: DropdownOption[] = []
  private _selectedValues = new Set<string>()
  private _anchor?: PopupAnchor
  private _hoveredValue = ''
  private _hoveredRowKind: 'none' | 'group' | 'option' = 'none'
  private _hoveredFooterAction: MultiSelectFooterAction | null = null
  private _keyboardIndex = -1
  private _keyboardActiveVisible = false
  private _searchText = ''
  private _searchable = false
  private _maxVisibleItems = 8
  private _minPopupWidth?: number
  private _maxPopupWidth?: number
  private _commitOnChange = true
  private _showFooter = false
  private _scrollOffset = 0
  private _scrollbarDragging = false
  private _scrollbarPointerKey?: PointerKey
  private readonly _scrollbarController = new ScrollbarAxisController('vertical')

  private _onChange?: (values: string[], options: DropdownOption[]) => void
  private _onConfirm?: (values: string[], options: DropdownOption[]) => void
  private _onClear?: () => void
  private _onClose?: () => void
  private _searchInput = new PopupTextInput(() => PopupManager.instance.requestPaint())

  debugState(): {
    filteredOptions: DropdownOption[]
    rows: MultiSelectPopupRow[]
    keyboardIndex: number
    scrollOffset: number
    selectedValues: string[]
    searchText: string
    searchable: boolean
    hoveredFooterAction: MultiSelectFooterAction | null
  } {
    return {
      filteredOptions: [...this._filteredOptions],
      rows: this._popupRows(),
      keyboardIndex: this._keyboardIndex,
      scrollOffset: this._scrollOffset,
      selectedValues: this.selectedValues,
      searchText: this._searchText,
      searchable: this._searchable,
      hoveredFooterAction: this._hoveredFooterAction,
    }
  }

  open(opts: {
    options: DropdownOption[]
    selectedValues: string[]
    anchor: PopupAnchor
    searchable: boolean
    maxVisibleItems: number
    minPopupWidth?: number
    maxPopupWidth?: number
    commitOnChange?: boolean
    showFooter?: boolean
    onChange: (values: string[], options: DropdownOption[]) => void
    onConfirm?: (values: string[], options: DropdownOption[]) => void
    onClear?: () => void
    onClose: () => void
  }): void {
    if (this.popupOpen) this.close()
    const previousFocus = FocusManager.instance.current
    this._searchInput.endSession()
    this._options = opts.options
    this._filteredOptions = [...opts.options]
    this._selectedValues = new Set(normalizeSelectedValues(opts.options, opts.selectedValues))
    this._anchor = opts.anchor
    this._searchable = opts.searchable
    this._maxVisibleItems = opts.maxVisibleItems
    this._minPopupWidth = opts.minPopupWidth
    this._maxPopupWidth = opts.maxPopupWidth
    this._commitOnChange = opts.commitOnChange ?? true
    this._showFooter = opts.showFooter ?? false
    this._onChange = opts.onChange
    this._onConfirm = opts.onConfirm
    this._onClear = opts.onClear
    this._onClose = opts.onClose
    this._searchText = ''
    this._hoveredValue = ''
    this._hoveredRowKind = 'none'
    this._hoveredFooterAction = null
    this._keyboardActiveVisible = false
    this._keyboardIndex = this._firstEnabledIndex()
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

  get selectedValues(): string[] {
    return resolveSelectedOptions(this._options, [...this._selectedValues]).map(option => option.value)
  }

  updateOptions(options: DropdownOption[], selectedValues: string[]): void {
    this._options = options
    this._selectedValues = new Set(normalizeSelectedValues(options, selectedValues))
    this._filterOptions()
    this._hoveredValue = ''
    this._hoveredRowKind = 'none'
    this._hoveredFooterAction = null
    this._keyboardActiveVisible = false
    this._scrollToKeyboard()
    this._hideOverflowTooltip()
    this.requestPopupPaint()
  }

  updateSelectedValues(selectedValues: string[]): void {
    this._selectedValues = new Set(normalizeSelectedValues(this._options, selectedValues))
    this.requestPopupPaint()
  }

  private _handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    if (isImeCompositionKey(event) || this._searchInput.composing) return false
    if (event.key === 'Tab') {
      this.close()
      return false
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
      return true
    }
    if (this._showFooter && event.key === 'Enter') {
      event.preventDefault()
      this._confirmSelection()
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
      this._keyboardActiveVisible = true
      this._scrollToKeyboard()
      this.requestPopupPaint()
      return true
    }
    if (event.key === 'End') {
      event.preventDefault()
      this._keyboardIndex = this._lastEnabledIndex()
      this._keyboardActiveVisible = true
      this._scrollToKeyboard()
      this.requestPopupPaint()
      return true
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = this._filteredOptions[this._activeIndex()]
      if (option) this._toggle(option)
      return true
    }
    if (!this._searchable && event.key.length === 1 && /\S/.test(event.key)) {
      event.preventDefault()
      const ch = event.key.toLowerCase()
      const start = Math.max(0, this._keyboardIndex + 1)
      const total = this._filteredOptions.length
      let found = -1
      for (let i = 0; i < total; i++) {
        const index = (start + i) % total
        const option = this._filteredOptions[index]
        if (option && !option.disabled && option.label.toLowerCase().startsWith(ch)) {
          found = index
          break
        }
      }
      if (found >= 0) {
        this._keyboardIndex = found
        this._keyboardActiveVisible = true
        this._scrollToKeyboard()
        this.requestPopupPaint()
      }
      return true
    }
    return false
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
        this._keyboardActiveVisible = true
        this._scrollToKeyboard()
        this.requestPopupPaint()
        return
      }
    }
  }

  private _filterOptions(): void {
    const query = this._searchText.toLowerCase()
    this._filteredOptions = query
      ? this._options.filter(option => option.label.toLowerCase().includes(query))
      : [...this._options]
    this._keyboardIndex = this._firstEnabledIndex()
    this._scrollOffset = 0
  }

  private _scrollToKeyboard(): void {
    if (this._keyboardIndex < 0) return
    const rowIndex = this._rowIndexForOptionIndex(this._keyboardIndex)
    if (rowIndex < 0) return
    const visibleRows = Math.max(1, this._popupLayout(PopupManager.instance.context).visibleRows)
    if (rowIndex < this._scrollOffset) {
      this._scrollOffset = rowIndex
    } else if (rowIndex >= this._scrollOffset + visibleRows) {
      this._scrollOffset = rowIndex - visibleRows + 1
    }
    this._scrollOffset = Math.max(0, Math.min(this._maxScrollOffset(), this._scrollOffset))
  }

  private _maxScrollOffset(): number {
    const visibleRows = this._popupLayout(PopupManager.instance.context).visibleRows
    return Math.max(0, this._popupRows().length - Math.max(1, visibleRows))
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

  private _optionTextMaxWidth(rect: { x: number; w: number }, optionTextX: number, hasScrollbar: boolean, context: PopupContext): number {
    const dropdownStyle = deriveDropdownStyle(context.theme)
    const scrollbarStyle = deriveScrollbarStyle(context.theme)
    const scrollbarReserve = hasScrollbar ? scrollbarStyle.gutterSize + 6 : 0
    return Math.max(0, rect.x + rect.w - dropdownStyle.padding * 2 - scrollbarReserve - optionTextX)
  }

  private _syncOverflowTooltip(
    row: MultiSelectPopupRow | null,
    point: Offset,
    rect: { x: number; w: number },
    optionTextX: number,
    hasScrollbar: boolean,
    context: PopupContext,
  ): void {
    if (row?.kind !== 'option' || !row.option.label) {
      this._hideOverflowTooltip()
      return
    }
    const dropdownStyle = deriveDropdownStyle(context.theme)
    const maxTextW = this._optionTextMaxWidth(rect, optionTextX, hasScrollbar, context)
    const overflow = TextMeasurer.measureWidth(row.option.label, dropdownStyle.fontSize, dropdownStyle.fontFamily) > maxTextW
    if (overflow) {
      TooltipService.currentOrNull?.show(row.option.label, point, 250)
      TooltipService.currentOrNull?.updatePos(point)
    } else {
      this._hideOverflowTooltip()
    }
  }

  private _activeIndex(): number {
    if (this._hoveredRowKind === 'group') return -1
    if (this._hoveredValue) {
      const hoveredIndex = this._filteredOptions.findIndex(option => option.value === this._hoveredValue)
      if (hoveredIndex >= 0) return hoveredIndex
    }
    return this._keyboardIndex
  }

  private _emitChange(): void {
    const selectedOptions = resolveSelectedOptions(this._options, this.selectedValues)
    this._onChange?.(selectedOptions.map(option => option.value), selectedOptions)
  }

  private _confirmSelection(): void {
    const selectedOptions = resolveSelectedOptions(this._options, this.selectedValues)
    const values = selectedOptions.map(option => option.value)
    runCleanupSteps([
      () => {
        if (this._onConfirm) this._onConfirm(values, selectedOptions)
        else this._onChange?.(values, selectedOptions)
      },
      () => this.close(),
    ])
  }

  private _clearSelection(): void {
    this._selectedValues.clear()
    runCleanupSteps([
      () => { if (this._commitOnChange) this._emitChange() },
      () => this._onClear?.(),
      () => this.close(),
    ])
  }

  private _toggle(option: DropdownOption): void {
    if (option.disabled) return
    if (this._selectedValues.has(option.value)) {
      this._selectedValues.delete(option.value)
    } else {
      this._selectedValues.add(option.value)
    }
    if (this._commitOnChange) this._emitChange()
    this.requestPopupPaint()
  }

  private _popupRows(): MultiSelectPopupRow[] {
    const rows: MultiSelectPopupRow[] = []
    let currentGroup = ''
    for (const option of this._filteredOptions) {
      const group = option.group?.trim() ?? ''
      if (group && group !== currentGroup) {
        currentGroup = group
        rows.push({ kind: 'group', label: group })
      } else if (!group) {
        currentGroup = ''
      }
      rows.push({ kind: 'option', option })
    }
    return rows
  }

  private _rowIndexForOptionIndex(optionIndex: number): number {
    if (optionIndex < 0) return -1
    let seenOptions = -1
    const rows = this._popupRows()
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!
      if (row.kind !== 'option') continue
      seenOptions += 1
      if (seenOptions === optionIndex) return i
    }
    return -1
  }

  private _rowAtIndex(rowIndex: number): MultiSelectPopupRow | null {
    const rows = this._popupRows()
    return rows[rowIndex] ?? null
  }

  private _popupLayout(context: PopupContext): DropdownPopupLayout {
    const dropdownStyle = deriveDropdownStyle(context.theme)
    const checkboxStyle = deriveCheckboxStyle(context.theme)
    const popupStyle = derivePopupStyle(context.theme)
    const anchorRect = resolvePopupAnchorRect(this._anchor)
    const itemHeight = dropdownStyle.itemHeight
    const rows = this._popupRows()
    const hasGroups = rows.some(row => row.kind === 'group')
    const groupIndent = hasGroups ? Math.max(12, Math.round(dropdownStyle.padding * 1.5)) : 0
    const checkboxSize = Math.min(checkboxStyle.boxSize, itemHeight - 8)
    const maxTextW = rows.reduce((max, row) => {
      const label = row.kind === 'group' ? row.label : row.option.label
      const fontSize = row.kind === 'group' ? Math.max(11, dropdownStyle.fontSize - 1) : dropdownStyle.fontSize
      return Math.max(max, TextMeasurer.measureWidth(label, fontSize, dropdownStyle.fontFamily))
    }, 0)
    const scrollbarReserve = rows.length > this._maxVisibleItems
      ? deriveScrollbarStyle(context.theme).gutterSize + 6
      : 0
    const optionChromeW = checkboxSize + checkboxStyle.itemSpacing + groupIndent
    const searchHeight = this._searchable ? itemHeight + popupStyle.padding : 0
    const footerHeight = this._showFooter ? itemHeight + popupStyle.padding : 0
    return resolveDropdownPopupLayout({
      context,
      anchorRect,
      desiredWidth: maxTextW + dropdownStyle.padding * 4 + optionChromeW + scrollbarReserve,
      rowCount: Math.max(1, rows.length),
      maxVisibleRows: this._maxVisibleItems,
      rowHeight: itemHeight,
      extraHeight: searchHeight + footerHeight + popupStyle.padding * 2,
      minPopupWidth: this._minPopupWidth,
      maxPopupWidth: this._maxPopupWidth,
    })
  }

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
    const listHeight = Math.max(itemHeight, layout.visibleRows * itemHeight)
    return { rect, itemHeight, contentY, listHeight }
  }

  private _footerActionAt(point: Offset, context: PopupContext): MultiSelectFooterAction | null {
    if (!this._showFooter) return null
    const { rect, itemHeight, contentY, listHeight } = this._listMetrics(context)
    const popupStyle = derivePopupStyle(context.theme)
    const y = contentY + listHeight + popupStyle.padding
    if (point.y < y || point.y > y + itemHeight || point.x < rect.x || point.x > rect.x + rect.w) return null
    const buttonWidth = rect.w / 3
    const index = Math.min(2, Math.max(0, Math.floor((point.x - rect.x) / buttonWidth)))
    return index === 0 ? 'ok' : index === 1 ? 'cancel' : 'clear'
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
    const rows = this._popupRows()
    const layout = this._popupLayout(context)
    if (rows.length <= layout.visibleRows) return null
    const scrollbarStyle = deriveScrollbarStyle(context.theme)
    const { rect, contentY, listHeight } = this._listMetrics(context)
    const x = rect.x + rect.w - scrollbarStyle.gutterSize - 2
    const geometry = resolveScrollbarGeometry({
      axis: 'vertical',
      trackRect: { x, y: contentY, width: scrollbarStyle.gutterSize, height: listHeight },
      viewportSize: layout.visibleRows,
      contentSize: rows.length,
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

  hitTest(point: Offset, context: PopupContext): boolean {
    if (!this.visible) return false
    const rect = this._popupRect(context)
    return point.x >= rect.x && point.x <= rect.x + rect.w &&
      point.y >= rect.y && point.y <= rect.y + rect.h
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
    if (!this.hitTest(point, context)) {
      this.close()
      return
    }

    const dropdownStyle = deriveDropdownStyle(context.theme)
    const popupStyle = derivePopupStyle(context.theme)
    const itemHeight = dropdownStyle.itemHeight
    const rect = this._popupRect(context)
    const searchX = rect.x + popupStyle.padding
    const searchY = rect.y + popupStyle.padding
    const searchW = rect.w - popupStyle.padding * 2
    const searchHeight = this._searchable ? itemHeight + popupStyle.padding : 0
    const listY = rect.y + popupStyle.padding + searchHeight
    const scrollbar = this._scrollbarMetrics(context)
    const footerAction = this._footerActionAt(point, context)

    if (footerAction) {
      if (footerAction === 'ok') this._confirmSelection()
      else if (footerAction === 'cancel') this.close()
      else this._clearSelection()
      return
    }

    if (this._searchable && this._searchInput.hitTest(point, { x: searchX, y: searchY, w: searchW, h: itemHeight })) {
      this._searchInput.handlePointerDown(point, { x: searchX, y: searchY, w: searchW, h: itemHeight }, event.clickCount)
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
      const rowIndex = Math.floor((point.y - listY) / itemHeight) + this._scrollOffset
      const row = this._rowAtIndex(rowIndex)
      if (row?.kind === 'option') this._toggle(row.option)
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
    const scrollbarMetrics = this._scrollbarMetrics(context)
    const scrollbarChanged = scrollbarMetrics
      ? this._scrollbarController.updateHover(point, scrollbarMetrics.geometry)
      : this._scrollbarController.clearHover()
    if (scrollbarChanged) this.requestPopupPaint()
    const dropdownStyle = deriveDropdownStyle(context.theme)
    const checkboxStyle = deriveCheckboxStyle(context.theme)
    const popupStyle = derivePopupStyle(context.theme)
    const itemHeight = dropdownStyle.itemHeight
    const layout = this._popupLayout(context)
    const rect = layout.rect
    const searchHeight = this._searchable ? itemHeight + popupStyle.padding : 0
    const listY = rect.y + popupStyle.padding + searchHeight
    const listHeight = layout.visibleRows * itemHeight
    const footerAction = this._footerActionAt(point, context)
    if (footerAction) {
      const changed = this._hoveredFooterAction !== footerAction || this._hoveredValue || this._hoveredRowKind !== 'none' || this._keyboardActiveVisible
      this._hoveredFooterAction = footerAction
      this._hoveredValue = ''
      this._hoveredRowKind = 'none'
      this._keyboardActiveVisible = false
      this._hideOverflowTooltip()
      if (changed) PopupManager.instance.requestPaint()
      return
    }

    const inList = point.x >= rect.x &&
      point.x <= rect.x + rect.w &&
      point.y >= listY &&
      point.y <= listY + listHeight

    if (!inList) {
      if (this._hoveredValue || this._hoveredRowKind !== 'none' || this._hoveredFooterAction || this._keyboardActiveVisible) {
        this._hoveredValue = ''
        this._hoveredRowKind = 'none'
        this._hoveredFooterAction = null
        this._keyboardActiveVisible = false
        this._hideOverflowTooltip()
        PopupManager.instance.requestPaint()
      }
      return
    }

    const rowIndex = Math.floor((point.y - listY) / itemHeight) + this._scrollOffset
    const row = this._rowAtIndex(rowIndex)
    const nextHoveredKind = row?.kind ?? 'none'
    const key = row?.kind === 'option' ? row.option.value : ''
    const rows = this._popupRows()
    const hasGroups = rows.some(candidate => candidate.kind === 'group')
    const optionStartX = rect.x + dropdownStyle.padding * 2 + (hasGroups ? Math.max(12, Math.round(dropdownStyle.padding * 1.5)) : 0)
    const checkboxSize = Math.min(checkboxStyle.boxSize, itemHeight - 8)
    const optionTextX = optionStartX + checkboxSize + checkboxStyle.itemSpacing
    const hasScrollbar = rows.length > layout.visibleRows
    if (key !== this._hoveredValue || nextHoveredKind !== this._hoveredRowKind) {
      this._hoveredValue = key
      this._hoveredRowKind = nextHoveredKind
      this._hoveredFooterAction = null
      this._keyboardActiveVisible = false
      this._syncOverflowTooltip(row, point, rect, optionTextX, hasScrollbar, context)
      PopupManager.instance.requestPaint()
    } else {
      this._syncOverflowTooltip(row, point, rect, optionTextX, hasScrollbar, context)
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
    this.close()
    return true
  }

  paint(context: PaintContext): void {
    if (!this.visible) return
    const popupContext = PopupManager.instance.context
    const dropdown = deriveDropdownStyle(context.theme)
    const checkbox = deriveCheckboxStyle(context.theme)
    const scrollbarStyle = deriveScrollbarStyle(context.theme)
    const popupStyle = derivePopupStyle(context.theme)
    const popupPanelStyle = { ...popupStyle, bgColor: deriveTreeStyle(context.theme).panelBg }
    const dl = new DrawList(context)
    const layout = this._popupLayout(popupContext)
    const rect = layout.rect
    const itemHeight = dropdown.itemHeight

    drawPopupPanel(dl, rect.x, rect.y, rect.w, rect.h, popupPanelStyle)

    let contentY = rect.y + popupStyle.padding
    if (this._searchable) {
      const searchX = rect.x + popupStyle.padding
      const searchW = rect.w - popupStyle.padding * 2
      this._searchInput.paint(context, {
        x: searchX,
        y: contentY,
        w: searchW,
        h: itemHeight,
      }, context.theme)
      contentY += itemHeight + popupStyle.padding
    }

    const rows = this._popupRows()
    const hasGroups = rows.some(row => row.kind === 'group')
    const visibleCount = Math.min(rows.length - this._scrollOffset, layout.visibleRows)
    const listHeight = Math.max(itemHeight, layout.visibleRows * itemHeight)
    const hasScrollbar = rows.length > layout.visibleRows
    dl.pushClip(rect.x, contentY, rect.w, listHeight)
    for (let visibleIndex = 0; visibleIndex < visibleCount; visibleIndex++) {
      const index = visibleIndex + this._scrollOffset
      const row = rows[index]
      if (!row) break
      const rowY = contentY + visibleIndex * itemHeight

      if (row.kind === 'group') {
        const input = deriveTextInputStyle(context.theme)
        dl.fillRect(rect.x, rowY, rect.w, itemHeight, { ...context.theme.surfacePanel, a: 0.45 }, 0)
        dl.line(
          rect.x + dropdown.padding * 2,
          rowY + itemHeight - 0.5,
          rect.x + rect.w - dropdown.padding * 2,
          rowY + itemHeight - 0.5,
          dropdown.separator,
          1,
        )
        dl.fillText(
          row.label,
          rect.x + dropdown.padding * 2,
          rowY + itemHeight / 2,
          input.placeholderText,
          Math.max(11, dropdown.fontSize - 1),
          dropdown.fontFamily,
          'left',
          'middle',
        )
        continue
      }

      const option = row.option
      const selected = this._selectedValues.has(option.value)
      const hovered = option.value === this._hoveredValue
      const keyboardActive = this._keyboardActiveVisible &&
        this._activeIndex() >= 0 &&
        this._filteredOptions[this._activeIndex()]?.value === option.value
      const itemState = (hovered || keyboardActive) ? 'hovered' : 'normal'
      const checkboxState = option.disabled ? 'disabled' : itemState
      const optionStartX = rect.x + dropdown.padding * 2 + (hasGroups ? Math.max(12, Math.round(dropdown.padding * 1.5)) : 0)
      const checkboxSize = Math.min(checkbox.boxSize, itemHeight - 8)
      const checkboxX = optionStartX
      const checkboxY = rowY + (itemHeight - checkboxSize) / 2
      const optionTextX = checkboxX + checkboxSize + checkbox.itemSpacing

      if (itemState !== 'normal') {
        dl.fillRect(rect.x, rowY, rect.w, itemHeight, resolveBgColor(dropdown.itemBg, itemState), 0)
      }

      const boxBg = selected
        ? resolveBgColor(checkbox.checkedBoxBg, checkboxState)
        : resolveBgColor(checkbox.boxBg, checkboxState)
      dl.fillRect(checkboxX, checkboxY, checkboxSize, checkboxSize, boxBg, checkbox.borderRadius)
      dl.strokeRect(
        checkboxX,
        checkboxY,
        checkboxSize,
        checkboxSize,
        resolveBgColor(checkbox.boxBorder, checkboxState),
        1,
        checkbox.borderRadius,
      )
      if (selected) {
        dl.drawCheckmark(
          checkboxX,
          checkboxY,
          checkboxSize,
          resolveTextColor(checkbox.checkMark, checkboxState),
          2,
        )
      }

      const textState = option.disabled ? 'disabled' : 'normal'
      const textColor = resolveTextColor(dropdown.itemText, textState)
      const optionTextMaxW = this._optionTextMaxWidth(rect, optionTextX, hasScrollbar, popupContext)
      const displayLabel = ellipsizeText(
        option.label,
        optionTextMaxW,
        text => TextMeasurer.measureWidth(text, dropdown.fontSize, dropdown.fontFamily),
      )
      dl.fillText(
        displayLabel,
        optionTextX,
        rowY + itemHeight / 2,
        textColor,
        dropdown.fontSize,
        dropdown.fontFamily,
        'left',
        'middle',
      )
      if (visibleIndex < visibleCount - 1) {
        dl.line(
          rect.x + dropdown.padding * 2,
          rowY + itemHeight - 0.5,
          rect.x + rect.w - dropdown.padding * 2,
          rowY + itemHeight - 0.5,
          dropdown.separator,
          1,
        )
      }
    }
    dl.popClip()

    if (hasScrollbar) {
      paintVBar({
        dl,
        style: scrollbarStyle,
        trackX: rect.x + rect.w - scrollbarStyle.gutterSize - 2,
        trackY: contentY,
        trackW: scrollbarStyle.gutterSize,
        trackH: listHeight,
        viewSize: layout.visibleRows,
        contentSize: rows.length,
        scrollOffset: this._scrollOffset,
        state: this._scrollbarController.state,
      })
    }

    if (this._showFooter) {
      const footerY = contentY + listHeight + popupStyle.padding
      const buttonWidth = rect.w / 3
      const labels: Array<{ action: MultiSelectFooterAction; text: string }> = [
        { action: 'ok', text: '确定' },
        { action: 'cancel', text: '取消' },
        { action: 'clear', text: '清除' },
      ]
      for (let i = 0; i < labels.length; i++) {
        const item = labels[i]!
        const buttonX = rect.x + i * buttonWidth
        const itemState = this._hoveredFooterAction === item.action ? 'hovered' : 'normal'
        dl.fillRect(buttonX, footerY, buttonWidth, itemHeight, resolveBgColor(dropdown.itemBg, itemState), 0)
        dl.strokeRect(buttonX, footerY, buttonWidth, itemHeight, dropdown.separator, 1, 0)
        dl.fillText(
          item.text,
          buttonX + buttonWidth / 2,
          footerY + itemHeight / 2,
          resolveTextColor(dropdown.itemText, itemState),
          dropdown.fontSize,
          dropdown.fontFamily,
          'center',
          'middle',
        )
      }
    }
  }

  dispose(): void {
    this.close()
    this._searchInput.dispose()
    this._onChange = undefined
    this._onConfirm = undefined
    this._onClear = undefined
    this._onClose = undefined
  }

  protected override onPopupClose(): void {
    this._resetScrollbarDrag()
    this._searchInput.endSession()
    this._hideOverflowTooltip()
    this._onClose?.()
  }
}

export type MultiSelectDropdownValueChangeReason =
  | 'selection'
  | 'clear'
  | 'remove'
  | 'options-reconcile'

export class RenderMultiSelectDropdown extends RenderBox implements
  InteractiveRenderObject,
  Focusable,
  GestureArenaMember,
  ValueEditor<
    string[],
    MultiSelectDropdownValueChangeReason,
    readonly DropdownOption[]
  > {
  static override debugTypeName = 'RenderMultiSelectDropdown'
  private _options: DropdownOption[]
  private _values: string[]
  placeholder: string
  onChange?: (values: string[], options: DropdownOption[]) => void
  searchable: boolean
  maxVisibleItems: number
  private _disabled: boolean
  private _readonly: boolean
  private _status: FormFieldStatus
  private _helperText: string
  private _prefixText: string
  private _suffixText: string
  private _clearable: boolean
  private _displayMode: MultiSelectDropdownDisplayMode
  private _focusRegistered = false

  private _focused = false
  private _hovered = false
  private _hoveredChipValue: string | null = null
  private _hoveredChipRemoveValue: string | null = null
  private _pressedChipRemoveValue: string | null = null
  private _pressedClear = false
  private readonly _pendingGesture = new PendingPointerGesture()
  private _popup: MultiSelectDropdownPopup
  private readonly _valueEditorEvents = new ValueEditorEventEmitter<
    string[],
    MultiSelectDropdownValueChangeReason,
    readonly DropdownOption[]
  >()

  constructor(opts: RenderMultiSelectDropdownOptions) {
    super(opts)
    this._options = opts.options
    this._values = normalizeSelectedValues(this.options, opts.values ?? [])
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
    this._displayMode = opts.displayMode ?? 'chips'
    this._popup = new MultiSelectDropdownPopup()
    this._syncFocusRegistration()
  }

  get options(): DropdownOption[] { return this._options }
  set options(options: DropdownOption[]) {
    const previousValue = this.values
    this._options = options
    this._values = normalizeSelectedValues(this._options, this._values)
    if (this._popup.visible) this._popup.updateOptions(this._options, this._values)
    this._clearPointerState()
    this.markNeedsPaint()
    if (!sameStringValues(previousValue, this._values)) {
      this._emitReconciledValueChange(previousValue)
    }
  }

  get values(): string[] {
    return [...this._values]
  }

  set values(values: string[]) {
    const normalized = normalizeSelectedValues(this.options, values)
    if (normalized.length === this._values.length && normalized.every((value, index) => value === this._values[index])) return
    this._values = normalized
    if (this._popup.visible) this._popup.updateSelectedValues(this._values)
    this.markNeedsPaint()
  }

  getValue(): string[] {
    return this.values
  }

  setValue(values: string[]): void {
    this.values = values
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<
      string[],
      MultiSelectDropdownValueChangeReason,
      readonly DropdownOption[]
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
        () => this._clearPointerState(),
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
        () => this._clearPointerState(),
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
    if (!clearable && this._pressedClear) this._cancelPointerAction()
    this.markNeedsPaint()
  }

  get displayMode(): MultiSelectDropdownDisplayMode { return this._displayMode }
  set displayMode(displayMode: MultiSelectDropdownDisplayMode) {
    if (this._displayMode === displayMode) return
    this._displayMode = displayMode
    this._clearPointerState()
    this.markNeedsPaint()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

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
    this._popup.close()
    if (typeof window === 'undefined') {
      this.focusOut()
      return
    }
    FocusManager.instance.clearFocusOf(this)
  }

  [GET_POPUP_ANCHOR_RECT](): { x: number; y: number; width: number; height: number } {
    const global = this.globalOffset
    return { x: global.x, y: global.y, width: this.size.width, height: this._inputStyle().height }
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const inputStyle = deriveTextInputStyle(context.theme)
    this.size = {
      width: constraints.maxWidth === Infinity ? 200 : constraints.maxWidth,
      height: measureFormFieldHeight(inputStyle, inputStyle.height, this.helperText),
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width } = this.size
    const input = deriveTextInputStyle(context.theme)
    const dropdown = deriveDropdownStyle(context.theme)
    const readonlyVisual = this.readonly && !this.disabled
    const shell = paintTriggerFieldShell(context, offset, width, {
      focused: readonlyVisual ? false : this._popup.visible || this._focused,
      hovered: readonlyVisual ? false : this._hovered,
      disabled: this.disabled,
      status: this.status,
      helperText: this.helperText,
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      showClearButton: this._showClearButton(),
      reserveTrailingWidth: dropdown.fontSize,
    })
    const fieldHeight = shell.fieldHeight
    if (readonlyVisual) {
      const readonlyTint = blendColor(
        resolveBgColor(input.inputBg, 'normal'),
        input.placeholderText,
        0.06,
      )
      dl.fillRect(offset.x + 1, offset.y + 1, Math.max(0, width - 2), Math.max(0, fieldHeight - 2), readonlyTint, Math.max(0, input.borderRadius - 1))
    }
    const chips = this._chipLayouts(shell.valueRect)
    const paintedChips = this._paintChips(context, chips, {
      x: shell.valueRect.x,
      y,
      w: shell.valueRect.w,
      h: fieldHeight,
    })
    if (!paintedChips) {
      const display = summaryText(
        this.options,
        this.values,
        this.placeholder,
        shell.valueRect.w,
        text => TextMeasurer.measureWidth(text, dropdown.fontSize, dropdown.fontFamily),
      )
      const textColor = this.disabled
        ? input.textDisabled
        : display.placeholder ? input.placeholderText : resolveTextColor(dropdown.itemText, 'normal')
      dl.pushClip(shell.valueRect.x, y, shell.valueRect.w, fieldHeight)
      dl.fillText(
        display.text,
        shell.valueRect.x,
        y + fieldHeight / 2,
        textColor,
        dropdown.fontSize,
        dropdown.fontFamily,
        'left',
        'middle',
      )
      dl.popClip()
    }

    const arrowX = (shell.trailingRect?.x ?? (x + width - input.padding - dropdown.fontSize)) + dropdown.fontSize / 2
    const arrowY = y + fieldHeight / 2
    const arrowColor = this.disabled
      ? input.textDisabled
      : readonlyVisual
        ? input.placeholderText
        : resolveTextColor(dropdown.arrowText, this._popup.visible || this._focused ? 'selected' : 'normal')
    if (readonlyVisual) {
      paintIconGlyph(context, {
        name: 'lock',
        x: arrowX - dropdown.fontSize / 2,
        y: arrowY - dropdown.fontSize / 2,
        size: dropdown.fontSize,
        color: arrowColor,
      })
    } else {
      const ctx = context.ctx
      ctx.save()
      ctx.fillStyle = `rgba(${arrowColor.r},${arrowColor.g},${arrowColor.b},${arrowColor.a})`
      ctx.beginPath()
      const arrowRadius = dropdown.fontSize * 0.3
      if (this._popup.visible) {
        ctx.moveTo(arrowX, arrowY - arrowRadius)
        ctx.lineTo(arrowX - arrowRadius, arrowY + arrowRadius)
        ctx.lineTo(arrowX + arrowRadius, arrowY + arrowRadius)
      } else {
        ctx.moveTo(arrowX, arrowY + arrowRadius)
        ctx.lineTo(arrowX - arrowRadius, arrowY - arrowRadius)
        ctx.lineTo(arrowX + arrowRadius, arrowY - arrowRadius)
      }
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }

  private _openPopup(): void {
    if (this.disabled || this.readonly || this._popup.visible) return
    this._popup.open({
      options: this.options,
      selectedValues: this.values,
      anchor: this as PopupAnchorTarget,
      searchable: this.searchable,
      maxVisibleItems: this.maxVisibleItems,
      onChange: (values, options) => {
        const previousValue = this.values
        this.values = values
        this._emitValueChange(
          this.values,
          options,
          'selection',
          previousValue,
        )
      },
      onClose: () => { this.markNeedsPaint() },
    })
    this.markNeedsPaint()
  }

  onPointerDown(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    if (!isPrimaryPointerButton(event)) return
    if (this.disabled || this.readonly || !this._hitField(event.position)) return
    const action = this._pointerActionAt(event.position)
    if (action) {
      event.preventActivation?.()
      this._beginPointerAction(event, action)
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
      this._clearValues()
      return true
    }
    return false
  }

  private _showClearButton(): boolean {
    return this.clearable && !this.disabled && !this.readonly && this._values.length > 0
  }

  private _triggerLayout() {
    const style = this._inputStyle()
    return layoutFormFieldInlineContent(style, this.globalOffset, this.size.width, style.height, {
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      showClearButton: this._showClearButton(),
      reserveTrailingWidth: deriveDropdownStyle(this.currentTheme).fontSize,
    })
  }

  private _clearValues(): void {
    if (!this._showClearButton()) return
    this._popup.close()
    FocusManager.instance.setFocus(this)
    const previousValue = this.values
    this.values = []
    this._emitValueChange([], [], 'clear', previousValue)
    this.markNeedsPaint()
  }

  private _removeValue(value: string): void {
    if (this.disabled || this.readonly) return
    if (!this._values.includes(value)) return
    FocusManager.instance.setFocus(this)
    const previousValue = this.values
    const nextValues = this._values.filter(item => item !== value)
    this.values = nextValues
    this._emitValueChange(
      nextValues,
      resolveSelectedOptions(this.options, nextValues),
      'remove',
      previousValue,
    )
    this.markNeedsPaint()
  }

  private _emitValueChange(
    values: string[],
    options: readonly DropdownOption[],
    reason: MultiSelectDropdownValueChangeReason,
    previousValue?: string[],
  ): void {
    const committedValues = [...values]
    const selectedOptions = [...options]
    runCleanupSteps([
      () => this.onChange?.(committedValues, selectedOptions),
      () => this._valueEditorEvents.emitValueChange({
        value: committedValues,
        previousValue,
        reason,
        detail: selectedOptions,
      }),
    ])
  }

  private _emitReconciledValueChange(previousValue: string[]): void {
    const values = this.values
    this._valueEditorEvents.emitValueChange({
      value: values,
      previousValue,
      reason: 'options-reconcile',
      detail: resolveSelectedOptions(this.options, values),
      userInitiated: false,
    })
  }

  onPointerMove(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    const hovered = !this.disabled && !this.readonly && this._hitField(event.position)
    const chipHit = hovered ? this._locateChipHit(event.position) : { chipValue: null, removeValue: null }
    if (
      hovered === this._hovered &&
      chipHit.chipValue === this._hoveredChipValue &&
      chipHit.removeValue === this._hoveredChipRemoveValue
    ) return
    this._hovered = hovered
    this._hoveredChipValue = chipHit.chipValue
    this._hoveredChipRemoveValue = chipHit.removeValue
    this.markNeedsPaint()
  }

  onPointerUp(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    const action = this._pressedPointerAction()
    if (!action) return
    const shouldActivate =
      !this.disabled &&
      !this.readonly &&
      sameMultiSelectPointerAction(action, this._pointerActionAt(event.position))
    this._pendingGesture.resolveTerminal(
      shouldActivate ? 'accepted' : 'rejected',
      () => this._resetPressedPointerAction(),
      () => this.markNeedsPaint(),
      () => {
        if (!shouldActivate) return
        if (action.kind === 'clear') this._clearValues()
        else this._removeValue(action.value)
      },
    )
  }

  onPointerCancel(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    this._clearPointerState()
    this.markNeedsPaint()
  }

  onPointerLeave(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    if (
      !this._hovered &&
      !this._hoveredChipValue &&
      !this._hoveredChipRemoveValue &&
      !this._pressedChipRemoveValue &&
      !this._pressedClear
    ) return
    this._clearPointerState()
    this.markNeedsPaint()
  }

  acceptGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    this._pendingGesture.accept(pointerId, pointerType)
  }

  rejectGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.reject(pointerId, pointerType)) return
    const hadPressedAction = this._pressedPointerAction() !== null
    this._resetPressedPointerAction()
    if (hadPressedAction) this.markNeedsPaint()
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
    const global = this.globalOffset
    const fieldHeight = this._inputStyle().height
    return position.x >= global.x &&
      position.x <= global.x + this.size.width &&
      position.y >= global.y &&
      position.y <= global.y + fieldHeight
  }

  dispose(): void {
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => this._valueEditorEvents.dispose(),
      () => this._resetPointerState(),
      () => this._popup.dispose(),
      () => {
        if (this._focusRegistered && typeof window !== 'undefined') {
          FocusManager.instance.unregister(this)
          this._focusRegistered = false
        }
      },
      () => { this._focused = false },
      () => super.dispose(),
    )
  }

  private _inputStyle(): ReturnType<typeof deriveTextInputStyle> {
    return deriveTextInputStyle(this.currentTheme)
  }

  private _chipLayouts(valueRect: { x: number; y: number; w: number; h: number }): TriggerChipLayout[] {
    if (this.displayMode !== 'chips') return []
    const selectedOptions = resolveSelectedOptions(this.options, this._values)
    if (selectedOptions.length === 0) return []

    const chipHeight = Math.max(20, valueRect.h)
    const chipY = valueRect.y + (valueRect.h - chipHeight) / 2
    const chipGap = 4
    const limit = valueRect.x + valueRect.w
    let cursor = valueRect.x
    const visible: TriggerChipLayout[] = []
    let hiddenCount = 0

    const overflowWidth = (count: number): number => {
      return measureChipLayout(this.currentTheme, `+${count}`, { height: chipHeight }).width
    }

    for (let index = 0; index < selectedOptions.length; index++) {
      const option = selectedOptions[index]!
      const metrics = measureChipLayout(this.currentTheme, option.label, {
        removable: true,
        height: chipHeight,
      })
      const chipWidth = metrics.width
      const remaining = selectedOptions.length - index - 1
      const reserve = remaining > 0 ? overflowWidth(remaining) + chipGap : 0
      if (cursor + chipWidth + reserve > limit) {
        hiddenCount = selectedOptions.length - index
        break
      }
      visible.push({
        value: option.value,
        label: option.label,
        x: cursor,
        y: chipY,
        w: chipWidth,
        h: chipHeight,
        removeRect: metrics.removeRect ? {
          x: cursor + metrics.removeRect.x,
          y: chipY + metrics.removeRect.y,
          w: metrics.removeRect.width,
          h: metrics.removeRect.height,
        } : null,
      })
      cursor += chipWidth + chipGap
    }

    if (hiddenCount > 0) {
      let overflowLabel = `+${hiddenCount}`
      let overflowChipWidth = overflowWidth(hiddenCount)
      while (visible.length > 0 && cursor + overflowChipWidth > limit) {
        const removed = visible.pop()!
        cursor = removed.x
        hiddenCount += 1
        overflowLabel = `+${hiddenCount}`
        overflowChipWidth = overflowWidth(hiddenCount)
      }
      visible.push({
        value: null,
        label: overflowLabel,
        x: cursor,
        y: chipY,
        w: Math.min(overflowChipWidth, Math.max(28, limit - cursor)),
        h: chipHeight,
        removeRect: null,
      })
    }

    return visible
  }

  private _paintChips(
    context: PaintContext,
    chips: readonly TriggerChipLayout[],
    clipRect: { x: number; y: number; w: number; h: number },
  ): boolean {
    if (chips.length === 0) return false
    const dl = new DrawList(context)

    dl.pushClip(clipRect.x, clipRect.y, clipRect.w, clipRect.h)
    for (const chip of chips) {
      const overflow = chip.value === null
      const chipHovered = !this.disabled && !this.readonly && this._hoveredChipValue === chip.value
      const removeHovered = !this.disabled && !this.readonly && chip.value !== null && this._hoveredChipRemoveValue === chip.value
      const removePressed = !this.disabled && !this.readonly && chip.value !== null && this._pressedChipRemoveValue === chip.value
      paintChip(context, {
        label: chip.label,
        rect: { x: chip.x, y: chip.y, width: chip.w, height: chip.h },
        removable: !this.readonly && !!chip.value && !!chip.removeRect,
        selected: !overflow,
        disabled: this.disabled,
        hovered: chipHovered,
        removeHovered,
        removePressed,
        centerLabel: overflow,
      })
    }
    dl.popClip()
    return true
  }

  private _locateChipHit(position: Offset): { chipValue: string | null; removeValue: string | null } {
    const layout = this._triggerLayout()
    for (const chip of this._chipLayouts(layout.valueRect)) {
      if (pointInFormFieldRect(chip.removeRect, position) && chip.value) {
        return { chipValue: chip.value, removeValue: chip.value }
      }
      if (pointInFormFieldRect(chip, position)) {
        return { chipValue: chip.value, removeValue: null }
      }
    }
    return { chipValue: null, removeValue: null }
  }

  private _pointerActionAt(position: Offset): MultiSelectPointerAction | null {
    if (!this._hitField(position)) return null
    if (pointInFormFieldRect(this._triggerLayout().clearRect, position)) {
      return this._showClearButton() ? { kind: 'clear' } : null
    }
    const removeValue = this._locateChipHit(position).removeValue
    return removeValue ? { kind: 'remove', value: removeValue } : null
  }

  private _beginPointerAction(event: PointerEvent, action: MultiSelectPointerAction): void {
    this._cancelPointerAction()
    this._pressedClear = action.kind === 'clear'
    this._pressedChipRemoveValue = action.kind === 'remove' ? action.value : null
    this._pendingGesture.begin(event, this, { captureOnAccept: false })
    this.markNeedsPaint()
  }

  private _pressedPointerAction(): MultiSelectPointerAction | null {
    if (this._pressedClear) return { kind: 'clear' }
    return this._pressedChipRemoveValue
      ? { kind: 'remove', value: this._pressedChipRemoveValue }
      : null
  }

  private _cancelPointerAction(): void {
    const hadPressedAction = this._pressedPointerAction() !== null
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => this._resetPressedPointerAction(),
      () => { if (hadPressedAction) this.markNeedsPaint() },
    )
  }

  private _resetPressedPointerAction(): void {
    this._pressedClear = false
    this._pressedChipRemoveValue = null
  }

  private _clearPointerState(): void {
    this._cancelPointerAction()
    this._resetPointerState()
  }

  private _resetPointerState(): void {
    this._hovered = false
    this._hoveredChipValue = null
    this._hoveredChipRemoveValue = null
    this._resetPressedPointerAction()
  }
}

function sameMultiSelectPointerAction(
  left: MultiSelectPointerAction,
  right: MultiSelectPointerAction | null,
): boolean {
  if (!right || left.kind !== right.kind) return false
  return left.kind === 'clear' ||
    (right.kind === 'remove' && left.value === right.value)
}

function sameStringValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index])
}
