import type { PaintContext } from '../../../rendering/paint_context'
import { isPrimaryPointerButton, type PointerEvent, type WheelPointerEvent } from '../../../gestures/hit_test'
import type { Popup, PopupContext } from '../../../core/popup_manager'
import { PopupPanelShell, type PopupPanelLayout } from '../../../core/popup_shell'
import { PopupTextInput } from '../../popup_text_input'
import { DrawList } from '../../../rendering/draw_list'
import { drawPopupPanel } from '../../../rendering/popup_painter'
import {
  deriveButtonStyle,
  deriveCheckboxStyle,
  deriveDropdownStyle,
  deriveGridFilterPopupStyle,
  derivePopupStyle,
  deriveScrollbarStyle,
  deriveTextInputStyle,
  resolveBgColor,
  resolveTextColor,
  type GridFilterPopupStyleTokens,
} from '../../../theme/component_styles'
import {
  paintVBar,
  resolveScrollbarGeometry,
  type ScrollbarGeometry,
} from '../../../rendering/scrollbar'
import { ScrollbarAxisController } from '../../../gestures/scrollbar_interaction_controller'
import { pointerKey } from '../../../gestures/pointer_identity'
import type {
  GridColumnDef,
  GridFilterOperator,
  GridFilterRule,
  GridFilterValue,
} from '../grid_types'
import { sameGridFilterValue } from '../grid_filter_values'
import {
  gridColumnUsesRawFilterEquality,
  parseGridFilterConditionInput,
  type GridFilterConditionError,
} from '../grid_filter_condition'
import { resolveDropdownPopupLayout } from '../../dropdown'

export type GridFilterPopupMode = 'values' | 'condition'
type HoverTarget =
  | 'values-tab'
  | 'condition-tab'
  | 'select-all'
  | 'clear'
  | 'operator'
  | 'cancel'
  | 'apply'
  | null
type KeyboardTarget = 'clear' | 'values-tab' | 'condition-tab' | 'input' | 'list' | 'operator' | 'cancel' | 'apply'
type PressTarget = Exclude<HoverTarget, null>

export interface GridFilterPopupOptions {
  owner: object
  column: GridColumnDef
  getLayout: (popupContext: PopupContext) => { x: number; y: number; w: number; h: number }
  initialRule: GridFilterRule | null
  initialValue: string
  initialMode?: GridFilterPopupMode
  values: readonly GridFilterValue[]
  valuesTruncated: boolean
  onApply: (rule: GridFilterRule | null) => void
  onClose: () => void
  onInvalidate: () => void
  onRequestPaint: () => void
}

export interface GridFilterPopupResolvedLayout {
  title: RectLike
  clearAction: RectLike
  valuesTab: RectLike
  conditionTab: RectLike
  valuesInput: RectLike
  conditionOperator: RectLike
  conditionInput: RectLike
  summary: RectLike
  valuesList: RectLike
  scrollbar: RectLike
  footer: RectLike
  cancelButton: RectLike
  applyButton: RectLike
}

export function resolveGridFilterPopupPreferredHeight(
  style: GridFilterPopupStyleTokens,
  mode: GridFilterPopupMode,
  candidateCount: number,
): number {
  if (mode === 'condition') return style.conditionHeight
  const visibleRows = Math.max(1, Math.min(style.maxVisibleValueRows, candidateCount + 1))
  const valuesListY = style.padding + style.titleHeight + style.sectionGap + style.tabHeight +
    style.sectionGap + style.inputHeight + style.sectionGap + style.summaryHeight + style.sectionGap
  return valuesListY + visibleRows * style.rowHeight + style.sectionGap + style.footerHeight
}

export function resolveGridFilterPopupMinimumHeight(
  style: GridFilterPopupStyleTokens,
  mode: GridFilterPopupMode,
): number {
  return mode === 'condition'
    ? style.conditionHeight
    : resolveGridFilterPopupPreferredHeight(style, 'values', 0)
}

export function resolveGridFilterPopupLayout(
  bounds: RectLike,
  style: GridFilterPopupStyleTokens,
  scrollbarWidth: number,
): GridFilterPopupResolvedLayout {
  const horizontalPadding = Math.min(style.padding, Math.max(0, bounds.w / 2))
  const contentX = bounds.x + horizontalPadding
  const contentWidth = Math.max(0, bounds.w - horizontalPadding * 2)
  const title = { x: contentX, y: bounds.y + style.padding, w: contentWidth, h: style.titleHeight }
  const clearActionWidth = Math.min(style.clearActionWidth, contentWidth)
  const clearAction = {
    x: contentX + contentWidth - clearActionWidth,
    y: title.y + (title.h - style.clearActionHeight) / 2,
    w: clearActionWidth,
    h: style.clearActionHeight,
  }
  const tabsY = title.y + title.h + style.sectionGap
  const tabGap = Math.min(style.tabGap, contentWidth)
  const tabWidth = Math.max(0, (contentWidth - tabGap) / 2)
  const valuesTab = { x: contentX, y: tabsY, w: tabWidth, h: style.tabHeight }
  const conditionTab = {
    x: valuesTab.x + valuesTab.w + tabGap,
    y: tabsY,
    w: tabWidth,
    h: style.tabHeight,
  }
  const firstEditorY = tabsY + style.tabHeight + style.sectionGap
  const valuesInput = { x: contentX, y: firstEditorY, w: contentWidth, h: style.inputHeight }
  const conditionOperator = { ...valuesInput }
  const conditionInput = {
    x: contentX,
    y: conditionOperator.y + conditionOperator.h + style.sectionGap,
    w: contentWidth,
    h: style.inputHeight,
  }
  const summary = {
    x: contentX,
    y: valuesInput.y + valuesInput.h + style.sectionGap,
    w: contentWidth,
    h: style.summaryHeight,
  }
  const footerHeight = Math.min(style.footerHeight, Math.max(0, bounds.h))
  const footer = {
    x: bounds.x,
    y: bounds.y + bounds.h - footerHeight,
    w: bounds.w,
    h: footerHeight,
  }
  const listY = summary.y + summary.h + style.sectionGap
  const resolvedScrollbarWidth = Math.min(Math.max(0, scrollbarWidth), contentWidth)
  const scrollbarX = contentX + contentWidth - resolvedScrollbarWidth
  const valuesList = {
    x: contentX,
    y: listY,
    w: Math.max(0, scrollbarX - style.scrollbarGap - contentX),
    h: Math.max(0, footer.y - style.sectionGap - listY),
  }
  const scrollbar = {
    x: scrollbarX,
    y: listY,
    w: resolvedScrollbarWidth,
    h: valuesList.h,
  }
  const buttonHeight = Math.min(style.buttonHeight, footer.h)
  const buttonY = footer.y + (footer.h - buttonHeight) / 2
  const buttonGap = Math.min(style.sectionGap, contentWidth)
  const buttonAreaWidth = Math.max(0, contentWidth - buttonGap)
  const buttonWidth = Math.min(style.buttonWidth, buttonAreaWidth / 2)
  const applyButton = {
    x: bounds.x + bounds.w - horizontalPadding - buttonWidth,
    y: buttonY,
    w: buttonWidth,
    h: buttonHeight,
  }
  const cancelButton = {
    x: applyButton.x - buttonGap - buttonWidth,
    y: buttonY,
    w: buttonWidth,
    h: buttonHeight,
  }
  const bodyBottom = Math.max(bounds.y, footer.y)
  const clipBodyRect = (rect: RectLike): RectLike => {
    const y = Math.min(bodyBottom, Math.max(bounds.y, rect.y))
    return {
      ...rect,
      y,
      h: Math.max(0, Math.min(bodyBottom, rect.y + rect.h) - y),
    }
  }
  return {
    title: clipBodyRect(title),
    clearAction: clipBodyRect(clearAction),
    valuesTab: clipBodyRect(valuesTab),
    conditionTab: clipBodyRect(conditionTab),
    valuesInput: clipBodyRect(valuesInput),
    conditionOperator: clipBodyRect(conditionOperator),
    conditionInput: clipBodyRect(conditionInput),
    summary: clipBodyRect(summary),
    valuesList: clipBodyRect(valuesList),
    scrollbar: clipBodyRect(scrollbar),
    footer,
    cancelButton,
    applyButton,
  }
}

export class GridFilterPopup extends PopupPanelShell implements Popup {
  private readonly _owner: object
  private readonly _column: GridColumnDef
  private readonly _getLayout: GridFilterPopupOptions['getLayout']
  private readonly _values: GridFilterValue[]
  private readonly _valuesTruncated: boolean
  private readonly _onApply: GridFilterPopupOptions['onApply']
  private readonly _onClose: GridFilterPopupOptions['onClose']
  private readonly _onRequestPaint: GridFilterPopupOptions['onRequestPaint']
  private readonly _operators: GridFilterOperator[]
  private readonly _selectedKeys = new Set<string>()
  private readonly _initialValueRule: GridFilterRule | null
  private readonly _unlistedRuleValues: unknown[] = []
  private readonly _scrollbarController = new ScrollbarAxisController('vertical')
  private readonly _scrollbar = this._scrollbarController.state
  private readonly _normalizedValueTexts: string[]
  private readonly _canClear: boolean
  private readonly _operatorMenu: GridFilterOperatorPopup
  private _mode: GridFilterPopupMode
  private _operator: GridFilterOperator
  private _conditionText: string
  private _searchText = ''
  private _filteredNeedle: string | null = null
  private _filteredValueCache: GridFilterValue[] = []
  private _filteredValueCacheShowsCounts = false
  private _scrollY = 0
  private _focusedValueIndex = -1
  private _hoveredValueIndex = -1
  private _hoverTarget: HoverTarget = null
  private _pressedTarget: PressTarget | null = null
  private _pressedValueIndex: number | null = null
  private _activePointerId: number | null = null
  private _inputPointerActive = false
  private _operatorMenuDismissedByTrigger = false
  private _keyboardTarget: KeyboardTarget = 'input'
  private _selectionChanged = false
  readonly input: PopupTextInput

  constructor(options: GridFilterPopupOptions) {
    super()
    this._owner = options.owner
    this._column = options.column
    this._getLayout = options.getLayout
    this._values = options.values.map(value => ({ ...value }))
    this._normalizedValueTexts = this._values.map(value => value.text.toLocaleLowerCase())
    this._valuesTruncated = options.valuesTruncated
    this._onApply = options.onApply
    this._onClose = options.onClose
    this._onRequestPaint = options.onRequestPaint
    this._operators = operatorsForColumn(options.column)
    const initialRuleUsesRawEquality =
      options.initialRule?.operator === 'equals' &&
      gridColumnUsesRawFilterEquality(options.column)
    const initialRuleUsesValueMode =
      initialRuleUsesRawEquality ||
      options.initialRule?.operator === 'in' ||
      options.initialRule?.operator === 'notIn'
    this._initialValueRule = initialRuleUsesValueMode && options.initialRule
      ? {
        ...options.initialRule,
        values: options.initialRule.values ? [...options.initialRule.values] : undefined,
      }
      : null
    this._operator = this.normalizeOperator(options.initialRule?.operator ?? defaultOperatorForColumn(options.column))
    this._conditionText = options.initialRule
      ? this.ruleToInputText(options.initialRule)
      : options.initialValue
    this._canClear = !!options.initialRule || options.initialValue.trim().length > 0
    this._mode = initialRuleUsesValueMode
      ? 'values'
      : options.initialMode ?? (options.initialRule
        ? 'condition'
        : options.initialValue
          ? 'condition'
          : 'values')
    this.initializeSelectedValues(this._initialValueRule ?? options.initialRule)
    this.input = new PopupTextInput(() => options.onInvalidate())
    this.input.setValue(this._mode === 'values' ? this._searchText : this._conditionText)
    this._operatorMenu = new GridFilterOperatorPopup({
      owner: this._owner,
      parent: this,
      getAnchor: popupContext => this.operatorRect(this._getLayout(popupContext), popupContext),
      getOperators: () => this._operators,
      getSelectedOperator: () => this._operator,
      onSelect: operator => this.selectOperator(operator),
      onTab: direction => this.moveKeyboardFocus(direction),
      onTriggerPointerDown: () => {
        this._operatorMenuDismissedByTrigger = true
      },
      onRequestPaint: this._onRequestPaint,
    })
  }

  get operator(): GridFilterOperator { return this._operator }
  get valueText(): string { return this._conditionText }
  get mode(): GridFilterPopupMode { return this._mode }

  open(): void {
    if (this.popupOpen) this.close()
    this.openPopup({ owner: this._owner })
    this.focusPrimaryEditor()
  }

  debugState(): {
    mode: GridFilterPopupMode
    operator: GridFilterOperator
    valueText: string
    searchText: string
    selectedCount: number
    candidateCount: number
    filteredCount: number
    valuesTruncated: boolean
    inputSessionActive: boolean
    operatorNeedsValue: boolean
    operatorMenuVisible: boolean
    conditionValid: boolean
    conditionError?: GridFilterConditionError
    keyboardTarget: KeyboardTarget
    scrollY: number
  } {
    const condition = this.conditionParseResult()
    return {
      mode: this._mode,
      operator: this._operator,
      valueText: this._conditionText,
      searchText: this._searchText,
      selectedCount: this._selectedKeys.size,
      candidateCount: this._values.length,
      filteredCount: this.filteredValues().length,
      valuesTruncated: this._valuesTruncated,
      inputSessionActive: this.input.input.hasSession,
      operatorNeedsValue: this.operatorNeedsValue(),
      operatorMenuVisible: this._operatorMenu.visible,
      conditionValid: condition.valid,
      conditionError: condition.error,
      keyboardTarget: this._keyboardTarget,
      scrollY: this._scrollY,
    }
  }

  protected override getPanelLayout(popupContext: PopupContext): PopupPanelLayout {
    const layout = this._getLayout(popupContext)
    return {
      panelX: layout.x,
      panelY: layout.y,
      panelW: layout.w,
      panelH: layout.h,
    }
  }

  onPointerDown(event: PointerEvent, popupContext: PopupContext): void {
    if (!isPrimaryPointerButton(event)) return
    if (this._activePointerId !== null && this._activePointerId !== event.pointerId) return
    const layout = this._getLayout(popupContext)
    this.clearPressedState()
    const operatorMenuDismissedByTrigger = this._operatorMenuDismissedByTrigger
    this._operatorMenuDismissedByTrigger = false
    if (this._canClear && this.pointInRect(event.position, this.clearRect(layout, popupContext))) {
      this.beginControlPress('clear', event)
      return
    }
    if (this.pointInRect(event.position, this.valuesTabRect(layout, popupContext))) {
      this.beginControlPress('values-tab', event)
      return
    }
    if (this.pointInRect(event.position, this.conditionTabRect(layout, popupContext))) {
      this.beginControlPress('condition-tab', event)
      return
    }
    if (this.pointInRect(event.position, this.cancelRect(layout, popupContext))) {
      this.beginControlPress('cancel', event)
      return
    }
    if (this.canApply() && this.pointInRect(event.position, this.applyRect(layout, popupContext))) {
      this.beginControlPress('apply', event)
      return
    }

    if (this._mode === 'values') {
      if (this.input.hitTest(event.position, this.inputRect(layout, popupContext))) {
        this._keyboardTarget = 'input'
        this.beginInputPress(event)
        this.input.handlePointerDown(
          event.position,
          this.inputRect(layout, popupContext),
          event.clickCount,
        )
        return
      }
      if (this.pointInRect(event.position, this.scrollbarRect(layout, popupContext))) {
        this._keyboardTarget = 'list'
        this._scrollY = this.effectiveScrollY(popupContext)
        const geometry = this.scrollbarGeometry(layout, popupContext)
        const result = this._scrollbarController.beginPointer(event.position, geometry, pointerKey(event))
        if (result.scrollOffset !== undefined) this._scrollY = result.scrollOffset
        if (result.dragStarted) {
          this._activePointerId = event.pointerId
          event.setPointerCapture?.()
        }
        this._onRequestPaint()
        return
      }
      const itemIndex = this.valueIndexAt(event.position, layout, popupContext)
      if (itemIndex === -2) {
        this._keyboardTarget = 'list'
        this._focusedValueIndex = -2
        this.beginValuePress(itemIndex, event)
      } else if (itemIndex >= 0) {
        this._keyboardTarget = 'list'
        this._focusedValueIndex = itemIndex
        this.beginValuePress(itemIndex, event)
      }
      return
    }

    if (this.pointInRect(event.position, this.operatorRect(layout, popupContext))) {
      this._keyboardTarget = 'operator'
      this.input.endSession()
      if (operatorMenuDismissedByTrigger) {
        this._onRequestPaint()
        return
      }
      this.beginControlPress('operator', event)
      return
    }
    if (this.operatorNeedsValue() && this.input.hitTest(event.position, this.inputRect(layout, popupContext))) {
      this._keyboardTarget = 'input'
      this.beginInputPress(event)
      this.input.handlePointerDown(
        event.position,
        this.inputRect(layout, popupContext),
        event.clickCount,
      )
    }
  }

  onPointerMove(event: PointerEvent, popupContext: PopupContext): void {
    if (this._activePointerId !== null && this._activePointerId !== event.pointerId) return
    const layout = this._getLayout(popupContext)
    if (this._inputPointerActive) {
      this.input.handlePointerMove(event.position)
      return
    }
    if (this._scrollbar.dragging) {
      const result = this._scrollbarController.updatePointer(
        event.position,
        this.scrollbarGeometry(layout, popupContext),
        pointerKey(event),
      )
      this._scrollY = result.scrollOffset ?? this._scrollY
      this._onRequestPaint()
      return
    }
    const scrollbarHoverChanged = this._scrollbarController.updateHover(
      event.position,
      this.scrollbarGeometry(layout, popupContext),
    )
    const nextValueIndex = this._mode === 'values'
      ? this.valueIndexAt(event.position, layout, popupContext)
      : -1
    const nextHoverTarget = this.resolveHoverTarget(event.position, layout, popupContext, nextValueIndex)
    const pressCanceled =
      (this._pressedTarget !== null && nextHoverTarget !== this._pressedTarget) ||
      (this._pressedValueIndex !== null && nextValueIndex !== this._pressedValueIndex)
    if (pressCanceled) {
      this.clearPressedState()
      this._activePointerId = null
      event.releasePointerCapture?.()
    }
    if (
      nextValueIndex !== this._hoveredValueIndex ||
      nextHoverTarget !== this._hoverTarget ||
      scrollbarHoverChanged
    ) {
      this._hoveredValueIndex = nextValueIndex
      this._hoverTarget = nextHoverTarget
      this._onRequestPaint()
    } else if (pressCanceled) {
      this._onRequestPaint()
    }
  }

  onPointerUp(event: PointerEvent, popupContext: PopupContext): void {
    if (!isPrimaryPointerButton(event)) return
    if (this._activePointerId !== null && this._activePointerId !== event.pointerId) return
    if (this._inputPointerActive) {
      this.input.handlePointerUp()
      this._inputPointerActive = false
      this._activePointerId = null
      event.releasePointerCapture?.()
      this._onRequestPaint()
      return
    }
    if (this._scrollbar.dragging) {
      this._scrollbarController.endPointer(
        event.position,
        this.scrollbarGeometry(this._getLayout(popupContext), popupContext),
        pointerKey(event),
      )
      this._activePointerId = null
      event.releasePointerCapture?.()
      this._onRequestPaint()
      return
    }
    const layout = this._getLayout(popupContext)
    const pressedTarget = this._pressedTarget
    const pressedValueIndex = this._pressedValueIndex
    this.clearPressedState()
    this._activePointerId = null
    event.releasePointerCapture?.()
    if (pressedTarget) {
      const hoveredTarget = this.resolveHoverTarget(
        event.position,
        layout,
        popupContext,
        this._mode === 'values' ? this.valueIndexAt(event.position, layout, popupContext) : -1,
      )
      if (hoveredTarget === pressedTarget) this.activatePointerTarget(pressedTarget)
    } else if (
      pressedValueIndex !== null &&
      this.valueIndexAt(event.position, layout, popupContext) === pressedValueIndex
    ) {
      if (pressedValueIndex === -2) this.toggleAllFilteredValues()
      else this.toggleValue(pressedValueIndex)
    }
    this._onRequestPaint()
  }

  onPointerCancel(event: PointerEvent, _popupContext: PopupContext): void {
    if (this._activePointerId !== null && this._activePointerId !== event.pointerId) return
    if (this._inputPointerActive) {
      this.input.handlePointerCancel()
      this._inputPointerActive = false
    }
    if (this._scrollbar.dragging) event.releasePointerCapture?.()
    this._scrollbarController.cancelPointer(pointerKey(event))
    this.clearPressedState()
    this._activePointerId = null
    event.releasePointerCapture?.()
    this._onRequestPaint()
  }

  onWheel(event: WheelPointerEvent, popupContext: PopupContext): boolean {
    if (this._mode !== 'values') return false
    const layout = this._getLayout(popupContext)
    if (!this.pointInRect(event.position, this.listRect(layout, popupContext))) return false
    if (event.deltaY === 0) return false
    if (this.clampScrollY(Number.POSITIVE_INFINITY, popupContext) <= 0) return false
    const style = deriveGridFilterPopupStyle(popupContext.theme)
    const before = this._scrollY
    this._scrollY = this.clampScrollY(this._scrollY + (event.deltaY > 0 ? style.rowHeight * 3 : -style.rowHeight * 3), popupContext)
    if (this._scrollY !== before) this._onRequestPaint()
    return true
  }

  onOutsidePointerDown(): boolean {
    this.close()
    return true
  }

  override onEscape(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    if (this.isComposingKeyEvent(event)) {
      event.preventDefault()
      return true
    }
    this.close()
    return true
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    if (this.isComposingKeyEvent(event)) {
      if (event.key === 'Enter' || event.key === 'Escape') event.preventDefault()
      return event.key === 'Enter' || event.key === 'Escape'
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      this.moveKeyboardFocus(event.shiftKey ? -1 : 1)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
      return true
    }
    if (
      (this._keyboardTarget === 'values-tab' || this._keyboardTarget === 'condition-tab') &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      event.preventDefault()
      this.setKeyboardTarget(event.key === 'ArrowLeft' ? 'values-tab' : 'condition-tab')
      return true
    }
    if (
      this._keyboardTarget === 'operator' &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    ) {
      event.preventDefault()
      this.openOperatorMenu(event.key === 'ArrowUp' ? 'last' : 'selected')
      return true
    }
    if (this._mode === 'values' && this._keyboardTarget === 'list') {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        this.moveFocusedValue(event.key === 'ArrowDown' ? 1 : -1)
        return true
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        const values = this.filteredValues()
        this._focusedValueIndex = event.key === 'Home' ? -2 : Math.max(-2, values.length - 1)
        this.ensureFocusedValueVisible(this.popupContext)
        this._onRequestPaint()
        return true
      }
      if (event.key === 'PageDown' || event.key === 'PageUp') {
        event.preventDefault()
        this.moveFocusedValuePage(event.key === 'PageDown' ? 1 : -1)
        return true
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (this._focusedValueIndex === -2) this.toggleAllFilteredValues()
        else if (this._focusedValueIndex >= 0) this.toggleValue(this._focusedValueIndex)
        return true
      }
    }
    if (
      (event.key === 'Enter' || event.key === ' ') &&
      this._keyboardTarget !== 'input'
    ) {
      event.preventDefault()
      this.activateKeyboardTarget()
      return true
    }
    if (event.key === 'Enter' && this._keyboardTarget === 'input') {
      event.preventDefault()
      this.applyAndClose()
      return true
    }
    return false
  }

  paint(context: PaintContext): void {
    if (!this.visible) return
    const popupContext = this.popupContext
    const layout = this._getLayout(popupContext)
    const popup = derivePopupStyle(context.theme)
    const filterStyle = deriveGridFilterPopupStyle(context.theme)
    const inputStyle = deriveTextInputStyle(context.theme)
    const resolvedLayout = this.resolveLayout(layout, popupContext)
    const dl = new DrawList(context)
    drawPopupPanel(dl, layout.x, layout.y, layout.w, layout.h, popup)

    dl.pushClip(
      layout.x,
      layout.y,
      Math.max(0, layout.w),
      Math.max(0, resolvedLayout.footer.y - layout.y),
    )
    dl.pushClip(
      resolvedLayout.title.x,
      resolvedLayout.title.y,
      Math.max(0, resolvedLayout.clearAction.x - filterStyle.sectionGap - resolvedLayout.title.x),
      resolvedLayout.title.h,
    )
    dl.fillText(
      this._column.title,
      resolvedLayout.title.x,
      resolvedLayout.title.y + resolvedLayout.title.h / 2,
      popup.text,
      popup.fontSize,
      popup.fontFamily,
      'left',
      'middle',
    )
    dl.popClip()
    this.paintTextAction(
      dl,
      resolvedLayout.clearAction,
      '清除筛选',
      this._hoverTarget === 'clear',
      this._pressedTarget === 'clear',
      this._keyboardTarget === 'clear',
      !this._canClear,
      filterStyle,
      inputStyle,
    )
    this.paintTab(
      dl,
      resolvedLayout.valuesTab,
      '值筛选',
      this._mode === 'values',
      this._hoverTarget === 'values-tab',
      this._pressedTarget === 'values-tab',
      this._keyboardTarget === 'values-tab',
      filterStyle,
    )
    this.paintTab(
      dl,
      resolvedLayout.conditionTab,
      '条件筛选',
      this._mode === 'condition',
      this._hoverTarget === 'condition-tab',
      this._pressedTarget === 'condition-tab',
      this._keyboardTarget === 'condition-tab',
      filterStyle,
    )

    if (this._mode === 'values') {
      this.paintValuesMode(context, dl, layout, popupContext)
    } else {
      this.paintConditionMode(context, dl, layout, popupContext)
    }
    dl.popClip()

    const footer = resolvedLayout.footer
    dl.fillRect(footer.x, footer.y, footer.w, footer.h, filterStyle.footerBg)
    dl.line(footer.x, footer.y, footer.x + footer.w, footer.y, filterStyle.footerBorder, filterStyle.borderWidth)
    this.paintButton(
      dl,
      resolvedLayout.cancelButton,
      '取消',
      this._hoverTarget === 'cancel',
      this._pressedTarget === 'cancel',
      this._keyboardTarget === 'cancel',
      false,
      false,
      context,
    )
    this.paintButton(
      dl,
      resolvedLayout.applyButton,
      '确定',
      this._hoverTarget === 'apply',
      this._pressedTarget === 'apply',
      this._keyboardTarget === 'apply',
      !this.canApply(),
      true,
      context,
    )
  }

  protected override onPopupClose(): void {
    this.input.endSession()
    this._scrollbarController.reset()
    this.clearPressedState()
    this._activePointerId = null
    this._inputPointerActive = false
    this._operatorMenuDismissedByTrigger = false
    this._onClose()
  }

  dispose(): void {
    this.close()
    this._operatorMenu.close()
    this.input.dispose()
  }

  private initializeSelectedValues(rule: GridFilterRule | null): void {
    if (
      rule?.operator === 'equals' &&
      gridColumnUsesRawFilterEquality(this._column)
    ) {
      for (const value of this._values) {
        if (sameGridFilterValue(value.value, rule.value, this._column)) {
          this._selectedKeys.add(value.key)
        }
      }
      this.collectUnlistedRuleValues([rule.value])
      return
    }
    if (rule?.operator === 'in') {
      for (const value of this._values) {
        if ((rule.values ?? []).some(candidate => sameGridFilterValue(value.value, candidate, this._column))) {
          this._selectedKeys.add(value.key)
        }
      }
      this.collectUnlistedRuleValues(rule.values)
      return
    }
    if (rule?.operator === 'notIn') {
      for (const value of this._values) {
        if (!(rule.values ?? []).some(candidate => sameGridFilterValue(value.value, candidate, this._column))) {
          this._selectedKeys.add(value.key)
        }
      }
      this.collectUnlistedRuleValues(rule.values)
      return
    }
    for (const value of this._values) this._selectedKeys.add(value.key)
  }

  private switchMode(mode: GridFilterPopupMode, options: { focusInput?: boolean } = {}): void {
    if (mode === this._mode) {
      if (options.focusInput !== false) this.focusPrimaryEditor()
      return
    }
    this.saveInputValue()
    this._operatorMenu.close()
    this._mode = mode
    this.input.endSession()
    this.input.setValue(mode === 'values' ? this._searchText : this._conditionText)
    if (options.focusInput !== false) this.focusPrimaryEditor()
    this._onRequestPaint()
  }

  private applyAndClose(): void {
    this.saveInputValue()
    if (!this.canApply()) {
      this._onRequestPaint()
      return
    }
    this._onApply(this.draftRule())
    this.close()
  }

  private draftRule(): GridFilterRule | null {
    if (this._mode === 'values') {
      if (!this._selectionChanged && this._initialValueRule) {
        return this._initialValueRule.values
          ? { ...this._initialValueRule, values: [...this._initialValueRule.values] }
          : { ...this._initialValueRule }
      }
      if (this._initialValueRule?.operator === 'notIn' || (this._valuesTruncated && !this._initialValueRule)) {
        const values = [
          ...this._values.filter(value => !this._selectedKeys.has(value.key)).map(value => value.value),
          ...this._unlistedRuleValues,
        ]
        return values.length === 0 ? null : { key: this._column.key, operator: 'notIn', values }
      }
      if (this._selectedKeys.size === this._values.length && this._unlistedRuleValues.length === 0) return null
      return {
        key: this._column.key,
        operator: 'in',
        values: [
          ...this._values.filter(value => this._selectedKeys.has(value.key)).map(value => value.value),
          ...this._unlistedRuleValues,
        ],
      }
    }
    if (!this.operatorNeedsValue()) return { key: this._column.key, operator: this._operator }
    const parsed = this.conditionParseResult()
    if (!parsed.active) return null
    if (!parsed.valid) return null
    return {
      key: this._column.key,
      operator: this._operator,
      value: parsed.value,
      valueTo: parsed.valueTo,
    }
  }

  private conditionParseResult(): ReturnType<typeof parseGridFilterConditionInput> {
    return parseGridFilterConditionInput(this._column, this._operator, this._conditionText)
  }

  private canApply(): boolean {
    return this._mode === 'values' || this.conditionParseResult().valid
  }

  private saveInputValue(): void {
    if (this._mode === 'values') {
      this._searchText = this.input.value
    } else {
      this._conditionText = this.input.value
    }
  }

  private syncInputSession(options: { focus?: boolean } = {}): void {
    if (!this.visible) return
    if (this._mode === 'condition' && !this.operatorNeedsValue()) {
      this.input.endSession()
      return
    }
    const value = this._mode === 'values' ? this._searchText : this._conditionText
    this.input.beginSession({
      value,
      placeholder: this._mode === 'values' ? '搜索值...' : placeholderForOperator(this._operator),
      onInput: nextValue => this.updateInputValue(nextValue),
      onCompositionUpdate: () => this._onRequestPaint(),
      onCompositionEnd: nextValue => this.updateInputValue(nextValue),
      onKeyDown: event => { this.onKeyDown(event) },
    })
    this.input.setSelection(0, value.length, {
      cursorPos: value.length,
      syncComposer: true,
    })
    if (options.focus) this.input.focus()
  }

  private selectOperator(operator: GridFilterOperator): void {
    if (!this._operators.includes(operator)) return
    this._operator = operator
    this.input.endSession()
    this.input.setValue(this.operatorNeedsValue() ? this._conditionText : '')
    if (this.operatorNeedsValue()) this.focusPrimaryEditor()
    else this._keyboardTarget = 'operator'
    this._onRequestPaint()
  }

  private openOperatorMenu(initial: GridFilterOperatorPopupInitial = 'selected'): void {
    if (this._mode !== 'condition') return
    this.saveInputValue()
    this.input.endSession()
    this._keyboardTarget = 'operator'
    this._operatorMenu.open(initial)
    this._onRequestPaint()
  }

  private keyboardTargets(): KeyboardTarget[] {
    const targets: KeyboardTarget[] = []
    if (this._canClear) targets.push('clear')
    targets.push('values-tab', 'condition-tab')
    if (this._mode === 'values') targets.push('input', 'list')
    else {
      targets.push('operator')
      if (this.operatorNeedsValue()) targets.push('input')
    }
    targets.push('cancel')
    if (this.canApply()) targets.push('apply')
    return targets
  }

  private moveKeyboardFocus(direction: number): void {
    const targets = this.keyboardTargets()
    const currentIndex = targets.indexOf(this._keyboardTarget)
    const nextIndex = (Math.max(0, currentIndex) + direction + targets.length) % targets.length
    this.setKeyboardTarget(targets[nextIndex]!)
  }

  private setKeyboardTarget(target: KeyboardTarget): void {
    if (target === this._keyboardTarget) return
    this.saveInputValue()
    this._keyboardTarget = target
    if (target === 'input') {
      this.input.setValue(this._mode === 'values' ? this._searchText : this._conditionText)
      this.syncInputSession({ focus: true })
    } else {
      this.input.endSession()
    }
    if (target === 'list' && this._focusedValueIndex < 0 && this.filteredValues().length > 0) {
      this._focusedValueIndex = -2
      this.ensureFocusedValueVisible(this.popupContext)
    }
    this._onRequestPaint()
  }

  private activateKeyboardTarget(): void {
    if (this._keyboardTarget === 'clear') {
      if (!this._canClear) return
      this._onApply(null)
      this.close()
      return
    }
    if (this._keyboardTarget === 'values-tab' || this._keyboardTarget === 'condition-tab') {
      const mode = this._keyboardTarget === 'values-tab' ? 'values' : 'condition'
      this.switchMode(mode, { focusInput: false })
      this.setKeyboardTarget(this._keyboardTarget)
      return
    }
    if (this._keyboardTarget === 'operator') {
      this.openOperatorMenu()
      return
    }
    if (this._keyboardTarget === 'cancel') {
      this.close()
      return
    }
    if (this._keyboardTarget === 'apply' && this.canApply()) this.applyAndClose()
  }

  private focusPrimaryEditor(): void {
    if (this._mode === 'condition' && !this.operatorNeedsValue()) {
      this._keyboardTarget = 'operator'
      this.input.endSession()
      return
    }
    this._keyboardTarget = 'input'
    this.syncInputSession({ focus: true })
  }

  private beginInputPress(event: PointerEvent): void {
    this._inputPointerActive = true
    this._activePointerId = event.pointerId
    event.setPointerCapture?.()
  }

  private beginControlPress(target: PressTarget, event: PointerEvent): void {
    this._inputPointerActive = false
    this._pressedTarget = target
    this._pressedValueIndex = null
    this._activePointerId = event.pointerId
    event.setPointerCapture?.()
    this._onRequestPaint()
  }

  private beginValuePress(valueIndex: number, event: PointerEvent): void {
    this._inputPointerActive = false
    this._pressedTarget = null
    this._pressedValueIndex = valueIndex
    this._activePointerId = event.pointerId
    event.setPointerCapture?.()
    this._onRequestPaint()
  }

  private clearPressedState(): void {
    this._pressedTarget = null
    this._pressedValueIndex = null
  }

  private updateInputValue(nextValue: string): void {
    if (this._mode === 'values') {
      this._searchText = nextValue
      this._filteredNeedle = null
      this._filteredValueCache = []
      this._filteredValueCacheShowsCounts = false
      this._scrollY = 0
      this._focusedValueIndex = -1
    } else {
      this._conditionText = nextValue
    }
    this._onRequestPaint()
  }

  private activatePointerTarget(target: PressTarget): void {
    if (target === 'clear') {
      if (!this._canClear) return
      this._onApply(null)
      this.close()
      return
    }
    if (target === 'values-tab') {
      this.switchMode('values')
      return
    }
    if (target === 'condition-tab') {
      this.switchMode('condition')
      return
    }
    if (target === 'operator') {
      this.openOperatorMenu()
      return
    }
    if (target === 'cancel') {
      this.close()
      return
    }
    if (target === 'apply') {
      if (this.canApply()) this.applyAndClose()
    }
  }

  private moveFocusedValue(direction: 1 | -1): void {
    const values = this.filteredValues()
    if (values.length === 0) return
    if (direction > 0) {
      if (this._focusedValueIndex < -1) this._focusedValueIndex = 0
      else this._focusedValueIndex = Math.min(values.length - 1, this._focusedValueIndex + 1)
    } else {
      if (this._focusedValueIndex <= 0) this._focusedValueIndex = -2
      else this._focusedValueIndex -= 1
    }
    this.ensureFocusedValueVisible(this.popupContext)
    this._onRequestPaint()
  }

  private moveFocusedValuePage(direction: 1 | -1): void {
    const values = this.filteredValues()
    if (values.length === 0) return
    const layout = this._getLayout(this.popupContext)
    const list = this.listRect(layout, this.popupContext)
    const rowHeight = deriveGridFilterPopupStyle(this.popupContext.theme).rowHeight
    const page = Math.max(1, Math.floor(list.h / rowHeight) - 1)
    const current = this._focusedValueIndex < -1 ? -1 : this._focusedValueIndex
    const next = current + direction * page
    const clamped = Math.max(-1, Math.min(values.length - 1, next))
    this._focusedValueIndex = clamped < 0 ? -2 : clamped
    this.ensureFocusedValueVisible(this.popupContext)
    this._onRequestPaint()
  }

  private isComposingKeyEvent(event: KeyboardEvent): boolean {
    return event.isComposing || event.keyCode === 229 || this.input.composing
  }

  private toggleValue(filteredIndex: number): void {
    const value = this.filteredValues()[filteredIndex]
    if (!value) return
    if (this._selectedKeys.has(value.key)) this._selectedKeys.delete(value.key)
    else this._selectedKeys.add(value.key)
    this._selectionChanged = true
    this._onRequestPaint()
  }

  private toggleAllFilteredValues(): void {
    const values = this.filteredValues()
    const allSelected = values.length > 0 && values.every(value => this._selectedKeys.has(value.key))
    for (const value of values) {
      if (allSelected) this._selectedKeys.delete(value.key)
      else this._selectedKeys.add(value.key)
    }
    if (values.length > 0) this._selectionChanged = true
    this._onRequestPaint()
  }

  private collectUnlistedRuleValues(values: unknown[] | undefined): void {
    for (const candidate of values ?? []) {
      if (!this._values.some(value => sameGridFilterValue(value.value, candidate, this._column))) {
        this._unlistedRuleValues.push(candidate)
      }
    }
  }

  private filteredValues(): GridFilterValue[] {
    const needle = this._searchText.trim().toLocaleLowerCase()
    if (needle === this._filteredNeedle) return this._filteredValueCache
    this._filteredNeedle = needle
    this._filteredValueCache = needle
      ? this._values.filter((_value, index) => this._normalizedValueTexts[index]?.includes(needle))
      : this._values
    const firstCount = this._filteredValueCache[0]?.count
    this._filteredValueCacheShowsCounts =
      this._filteredValueCache.length > 1 &&
      this._filteredValueCache.some(value => value.count !== firstCount)
    return this._filteredValueCache
  }

  private paintValuesMode(
    context: PaintContext,
    dl: DrawList,
    layout: { x: number; y: number; w: number; h: number },
    popupContext: PopupContext,
  ): void {
    const popup = derivePopupStyle(context.theme)
    const filterStyle = deriveGridFilterPopupStyle(context.theme)
    const values = this.filteredValues()
    const showCounts = this._filteredValueCacheShowsCounts
    const resolvedLayout = this.resolveLayout(layout, popupContext)
    const scrollY = this.effectiveScrollY(popupContext)
    this.input.paint(context, resolvedLayout.valuesInput, context.theme)
    const summary = this._valuesTruncated
      ? `仅显示前 ${this._values.length} 个唯一值；搜索限于已加载项`
      : `${values.length} 个值`
    dl.fillText(
      summary,
      resolvedLayout.summary.x,
      resolvedLayout.summary.y + resolvedLayout.summary.h / 2,
      popup.textDisabled,
      filterStyle.secondaryFontSize,
      popup.fontFamily,
      'left',
      'middle',
    )

    const list = resolvedLayout.valuesList
    const contentHeight = this.listContentHeight(popupContext)
    dl.pushClip(list.x, list.y, list.w, list.h)
    if (values.length === 0) {
      dl.fillText(
        '没有匹配值',
        list.x + list.w / 2,
        list.y + list.h / 2,
        popup.textDisabled,
        filterStyle.secondaryFontSize,
        popup.fontFamily,
        'center',
        'middle',
      )
    }
    const firstRow = Math.max(0, Math.floor(scrollY / filterStyle.rowHeight) - 1)
    const lastRow = Math.min(values.length, Math.ceil((scrollY + list.h) / filterStyle.rowHeight))
    const selectAllY = list.y - scrollY
    if (values.length > 0 && selectAllY + filterStyle.rowHeight >= list.y) {
      this.paintValueRow(context, dl, list.x, selectAllY, list.w, '全选', this.selectAllState(values), -2)
    }
    for (let index = firstRow; index < lastRow; index++) {
      const value = values[index]
      if (!value) continue
      const rowY = list.y + filterStyle.rowHeight * (index + 1) - scrollY
      this.paintValueRow(
        context,
        dl,
        list.x,
        rowY,
        list.w,
        value.text,
        this._selectedKeys.has(value.key) ? 'checked' : 'unchecked',
        index,
        showCounts ? value.count : undefined,
      )
    }
    dl.popClip()

    const scrollbarRect = resolvedLayout.scrollbar
    paintVBar({
      dl,
      style: deriveScrollbarStyle(context.theme),
      trackX: scrollbarRect.x,
      trackY: scrollbarRect.y,
      trackW: scrollbarRect.w,
      trackH: scrollbarRect.h,
      viewSize: list.h,
      contentSize: contentHeight,
      scrollOffset: scrollY,
      state: this._scrollbar,
    })
  }

  private paintConditionMode(
    context: PaintContext,
    dl: DrawList,
    layout: { x: number; y: number; w: number; h: number },
    popupContext: PopupContext,
  ): void {
    const popup = derivePopupStyle(context.theme)
    const input = deriveTextInputStyle(context.theme)
    const dropdown = deriveDropdownStyle(context.theme)
    const filterStyle = deriveGridFilterPopupStyle(context.theme)
    const resolvedLayout = this.resolveLayout(layout, popupContext)
    const opRect = resolvedLayout.conditionOperator
    const operatorFocused = this._keyboardTarget === 'operator' || this._operatorMenu.visible
    const operatorHovered = this._hoverTarget === 'operator'
    const operatorPressed = this._pressedTarget === 'operator'
    const operatorState = { focused: operatorFocused, hovered: operatorHovered, pressed: operatorPressed }
    dl.fillRect(
      opRect.x,
      opRect.y,
      opRect.w,
      opRect.h,
      resolveBgColor(input.inputBg, operatorState),
      input.borderRadius,
    )
    dl.strokeRect(
      opRect.x,
      opRect.y,
      opRect.w,
      opRect.h,
      resolveBgColor(input.inputBorder, operatorState),
      input.borderWidth,
      input.borderRadius,
    )
    const arrowX = opRect.x + opRect.w - filterStyle.controlTextPadding
    const arrowY = opRect.y + opRect.h / 2
    const arrowRadius = Math.max(2, dropdown.fontSize * 0.24)
    const operatorTextX = opRect.x + filterStyle.controlTextPadding
    const operatorTextRight = arrowX - arrowRadius - filterStyle.controlTextPadding
    dl.pushClip(
      operatorTextX,
      opRect.y,
      Math.max(0, operatorTextRight - operatorTextX),
      opRect.h,
    )
    dl.fillText(
      operatorLabel(this._operator),
      operatorTextX,
      opRect.y + opRect.h / 2,
      resolveTextColor(dropdown.itemText, 'normal'),
      dropdown.fontSize,
      dropdown.fontFamily,
      'left',
      'middle',
    )
    dl.popClip()
    const arrowColor = resolveTextColor(dropdown.arrowText, operatorFocused ? 'selected' : 'normal')
    dl.fillPolygon(
      this._operatorMenu.visible
        ? [
          { x: arrowX, y: arrowY - arrowRadius },
          { x: arrowX - arrowRadius, y: arrowY + arrowRadius },
          { x: arrowX + arrowRadius, y: arrowY + arrowRadius },
        ]
        : [
          { x: arrowX, y: arrowY + arrowRadius },
          { x: arrowX - arrowRadius, y: arrowY - arrowRadius },
          { x: arrowX + arrowRadius, y: arrowY - arrowRadius },
        ],
      arrowColor,
    )
    if (this.operatorNeedsValue()) {
      this.input.paint(context, resolvedLayout.conditionInput, context.theme)
      const parsed = this.conditionParseResult()
      if (!parsed.valid) {
        dl.strokeRect(
          resolvedLayout.conditionInput.x,
          resolvedLayout.conditionInput.y,
          resolvedLayout.conditionInput.w,
          resolvedLayout.conditionInput.h,
          context.theme.accentDanger,
          Math.max(1, input.borderWidth),
          input.borderRadius,
        )
      }
    } else {
      dl.fillText(
        '该条件不需要输入值',
        resolvedLayout.conditionInput.x,
        resolvedLayout.conditionInput.y + resolvedLayout.conditionInput.h / 2,
        popup.textDisabled,
        popup.fontSize,
        popup.fontFamily,
        'left',
        'middle',
      )
    }
  }

  private paintValueRow(
    context: PaintContext,
    dl: DrawList,
    x: number,
    y: number,
    width: number,
    text: string,
    state: 'checked' | 'unchecked' | 'indeterminate',
    valueIndex: number,
    count?: number,
  ): void {
    const popup = derivePopupStyle(context.theme)
    const filterStyle = deriveGridFilterPopupStyle(context.theme)
    const checkbox = deriveCheckboxStyle(context.theme)
    const hovered = valueIndex === -2
      ? this._hoverTarget === 'select-all'
      : valueIndex === this._hoveredValueIndex
    const focused = this._keyboardTarget === 'list' && valueIndex === this._focusedValueIndex
    const pressed = valueIndex === this._pressedValueIndex
    if (hovered || focused || pressed) {
      dl.fillRect(
        x,
        y,
        width,
        filterStyle.rowHeight,
        resolveBgColor(checkbox.boxBg, { hovered, focused, pressed }),
        filterStyle.rowRadius,
      )
    }
    const boxX = x + filterStyle.padding
    const boxY = y + (filterStyle.rowHeight - filterStyle.checkboxSize) / 2
    const checked = state !== 'unchecked'
    dl.fillRect(
      boxX,
      boxY,
      filterStyle.checkboxSize,
      filterStyle.checkboxSize,
      resolveBgColor(checked ? checkbox.checkedBoxBg : checkbox.boxBg, { hovered, focused, pressed }),
      checkbox.borderRadius,
    )
    dl.strokeRect(
      boxX,
      boxY,
      filterStyle.checkboxSize,
      filterStyle.checkboxSize,
      resolveBgColor(checkbox.boxBorder, { hovered, focused, pressed }),
      filterStyle.borderWidth,
      checkbox.borderRadius,
    )
    if (state === 'indeterminate') {
      const pad = filterStyle.checkboxSize * 0.25
      const midY = boxY + filterStyle.checkboxSize / 2
      dl.line(
        boxX + pad,
        midY,
        boxX + filterStyle.checkboxSize - pad,
        midY,
        resolveTextColor(checkbox.checkMark, 'selected'),
        filterStyle.checkmarkStrokeWidth,
      )
    } else if (state === 'checked') {
      dl.drawCheckmark(
        boxX,
        boxY,
        filterStyle.checkboxSize,
        resolveTextColor(checkbox.checkMark, 'selected'),
        filterStyle.checkmarkStrokeWidth,
      )
    }
    const textX = boxX + filterStyle.checkboxSize + checkbox.itemSpacing
    const countWidth = count === undefined ? 0 : filterStyle.countWidth
    dl.pushClip(textX, y, Math.max(0, width - (textX - x) - countWidth - filterStyle.padding), filterStyle.rowHeight)
    dl.fillText(text, textX, y + filterStyle.rowHeight / 2, popup.text, popup.fontSize, popup.fontFamily, 'left', 'middle')
    dl.popClip()
    if (count !== undefined) {
      dl.fillText(String(count), x + width - filterStyle.padding, y + filterStyle.rowHeight / 2, popup.textDisabled, filterStyle.secondaryFontSize, popup.fontFamily, 'right', 'middle')
    }
  }

  private paintTab(
    dl: DrawList,
    rect: RectLike,
    label: string,
    selected: boolean,
    hovered: boolean,
    pressed: boolean,
    focused: boolean,
    style: GridFilterPopupStyleTokens,
  ): void {
    if (rect.w <= 0 || rect.h <= 0) return
    const state = { selected, hovered, pressed, focused }
    dl.fillRect(rect.x, rect.y, rect.w, rect.h, resolveBgColor(style.tabBg, state), style.rowRadius)
    if (selected) {
      dl.fillRect(
        rect.x + style.controlTextPadding,
        rect.y + rect.h - style.tabIndicatorHeight,
        Math.max(0, rect.w - style.controlTextPadding * 2),
        style.tabIndicatorHeight,
        style.tabIndicator,
        style.tabIndicatorHeight / 2,
      )
    }
    if (focused) {
      dl.strokeRect(rect.x, rect.y, rect.w, rect.h, style.tabFocusBorder, style.borderWidth, style.rowRadius)
    }
    dl.fillText(
      label,
      rect.x + rect.w / 2,
      rect.y + rect.h / 2,
      resolveTextColor(style.tabText, state),
      style.fontSize,
      style.fontFamily,
      'center',
      'middle',
    )
  }

  private paintButton(
    dl: DrawList,
    rect: RectLike,
    label: string,
    hovered: boolean,
    pressed: boolean,
    focused: boolean,
    disabled: boolean,
    primary: boolean,
    context: PaintContext,
  ): void {
    if (rect.w <= 0 || rect.h <= 0) return
    const button = deriveButtonStyle(context.theme, primary ? 'primary' : 'default')
    const bg = disabled
      ? button.disabledBg
      : pressed
        ? button.pressedBg
        : hovered
          ? button.hoveredBg
          : button.normalBg
    const border = focused && !disabled ? button.focusedBorder : button.borderColor
    dl.fillRect(rect.x, rect.y, rect.w, rect.h, bg, button.borderRadius)
    dl.strokeRect(rect.x, rect.y, rect.w, rect.h, border, button.borderWidth, button.borderRadius)
    dl.fillText(
      label,
      rect.x + rect.w / 2,
      rect.y + rect.h / 2,
      disabled ? button.disabledText : button.text,
      button.fontSize,
      button.fontFamily,
      'center',
      'middle',
    )
  }

  private paintTextAction(
    dl: DrawList,
    rect: RectLike,
    label: string,
    hovered: boolean,
    pressed: boolean,
    focused: boolean,
    disabled: boolean,
    style: GridFilterPopupStyleTokens,
    input: ReturnType<typeof deriveTextInputStyle>,
  ): void {
    if (rect.w <= 0 || rect.h <= 0) return
    const state = { focused, hovered, pressed, disabled }
    if (!disabled && (hovered || pressed || focused)) {
      dl.fillRect(rect.x, rect.y, rect.w, rect.h, resolveBgColor(input.inputBg, state), input.borderRadius)
    }
    if (!disabled && focused) {
      dl.strokeRect(rect.x, rect.y, rect.w, rect.h, resolveBgColor(input.inputBorder, state), input.borderWidth, input.borderRadius)
    }
    dl.fillText(
      label,
      rect.x + rect.w / 2,
      rect.y + rect.h / 2,
      disabled ? input.textDisabled : resolveTextColor(style.actionText, state),
      style.secondaryFontSize,
      style.fontFamily,
      'center',
      'middle',
    )
  }

  private selectAllState(values: GridFilterValue[]): 'checked' | 'unchecked' | 'indeterminate' {
    if (values.length === 0) return 'unchecked'
    const count = values.reduce((total, value) => total + (this._selectedKeys.has(value.key) ? 1 : 0), 0)
    if (count === 0) return 'unchecked'
    if (count === values.length) return 'checked'
    return 'indeterminate'
  }

  private ensureFocusedValueVisible(popupContext: PopupContext): void {
    const layout = this._getLayout(popupContext)
    const list = this.listRect(layout, popupContext)
    const style = deriveGridFilterPopupStyle(popupContext.theme)
    const top = this._focusedValueIndex === -2
      ? 0
      : style.rowHeight * (this._focusedValueIndex + 1)
    const bottom = top + style.rowHeight
    if (top < this._scrollY) this._scrollY = top
    else if (bottom > this._scrollY + list.h) this._scrollY = bottom - list.h
    this._scrollY = this.clampScrollY(this._scrollY, popupContext)
  }

  private resolveHoverTarget(
    point: { x: number; y: number },
    layout: RectLike,
    popupContext: PopupContext,
    valueIndex: number,
  ): HoverTarget {
    if (this._canClear && this.pointInRect(point, this.clearRect(layout, popupContext))) return 'clear'
    if (this.pointInRect(point, this.valuesTabRect(layout, popupContext))) return 'values-tab'
    if (this.pointInRect(point, this.conditionTabRect(layout, popupContext))) return 'condition-tab'
    if (this.pointInRect(point, this.cancelRect(layout, popupContext))) return 'cancel'
    if (this.canApply() && this.pointInRect(point, this.applyRect(layout, popupContext))) return 'apply'
    if (
      this._mode === 'condition' &&
      this.pointInRect(point, this.operatorRect(layout, popupContext))
    ) {
      return 'operator'
    }
    if (this._mode === 'values' && valueIndex === -2) return 'select-all'
    return null
  }

  private valueIndexAt(point: { x: number; y: number }, layout: RectLike, popupContext: PopupContext): number {
    const list = this.listRect(layout, popupContext)
    if (!this.pointInRect(point, list)) return -1
    if (this.filteredValues().length === 0) return -1
    const style = deriveGridFilterPopupStyle(popupContext.theme)
    const contentRow = Math.floor((point.y - list.y + this.effectiveScrollY(popupContext)) / style.rowHeight)
    if (contentRow === 0) return -2
    const index = contentRow - 1
    return index >= 0 && index < this.filteredValues().length ? index : -1
  }

  private listContentHeight(popupContext: PopupContext): number {
    return (this.filteredValues().length + 1) * deriveGridFilterPopupStyle(popupContext.theme).rowHeight
  }

  private clampScrollY(value: number, popupContext: PopupContext): number {
    const layout = this._getLayout(popupContext)
    const list = this.listRect(layout, popupContext)
    return Math.max(0, Math.min(Math.max(0, this.listContentHeight(popupContext) - list.h), value))
  }

  private effectiveScrollY(popupContext: PopupContext): number {
    return this.clampScrollY(this._scrollY, popupContext)
  }

  private normalizeOperator(operator: GridFilterOperator): GridFilterOperator {
    return this._operators.includes(operator) ? operator : this._operators[0]!
  }

  private ruleToInputText(rule: GridFilterRule): string {
    if (rule.operator === 'between') {
      const left = rule.value == null ? '' : String(rule.value)
      const right = rule.valueTo == null ? '' : String(rule.valueTo)
      return `${left}..${right}`
    }
    return rule.value == null ? '' : String(rule.value)
  }

  private operatorNeedsValue(): boolean {
    return this._operator !== 'empty' && this._operator !== 'notEmpty'
  }

  private resolveLayout(layout: RectLike, popupContext: PopupContext): GridFilterPopupResolvedLayout {
    return resolveGridFilterPopupLayout(
      layout,
      deriveGridFilterPopupStyle(popupContext.theme),
      deriveScrollbarStyle(popupContext.theme).gutterSize,
    )
  }

  private valuesTabRect(layout: RectLike, popupContext: PopupContext): RectLike {
    return this.resolveLayout(layout, popupContext).valuesTab
  }

  private conditionTabRect(layout: RectLike, popupContext: PopupContext): RectLike {
    return this.resolveLayout(layout, popupContext).conditionTab
  }

  private inputRect(layout: RectLike, popupContext: PopupContext): RectLike {
    const resolved = this.resolveLayout(layout, popupContext)
    return this._mode === 'values' ? resolved.valuesInput : resolved.conditionInput
  }

  private operatorRect(layout: RectLike, popupContext: PopupContext): RectLike {
    return this.resolveLayout(layout, popupContext).conditionOperator
  }

  private listRect(layout: RectLike, popupContext: PopupContext): RectLike {
    return this.resolveLayout(layout, popupContext).valuesList
  }

  private scrollbarGeometry(layout: RectLike, popupContext: PopupContext): ScrollbarGeometry {
    const track = this.scrollbarRect(layout, popupContext)
    const list = this.listRect(layout, popupContext)
    const style = deriveScrollbarStyle(popupContext.theme)
    const visualThickness = this._scrollbar.dragging
      ? style.thumbPressedThickness
      : this._scrollbar.hovered
        ? style.thumbHoveredThickness
        : style.thumbThickness
    return resolveScrollbarGeometry({
      axis: 'vertical',
      trackRect: { x: track.x, y: track.y, width: track.w, height: track.h },
      viewportSize: list.h,
      contentSize: this.listContentHeight(popupContext),
      scrollOffset: this.effectiveScrollY(popupContext),
      visualThickness,
      minThumbLength: style.minThumbLength,
      endInset: style.endInset,
    })
  }

  private scrollbarRect(layout: RectLike, popupContext: PopupContext): RectLike {
    return this.resolveLayout(layout, popupContext).scrollbar
  }

  private footerRect(layout: RectLike, popupContext: PopupContext): RectLike {
    return this.resolveLayout(layout, popupContext).footer
  }

  private clearRect(layout: RectLike, popupContext: PopupContext): RectLike {
    return this.resolveLayout(layout, popupContext).clearAction
  }

  private cancelRect(layout: RectLike, popupContext: PopupContext): RectLike {
    return this.resolveLayout(layout, popupContext).cancelButton
  }

  private applyRect(layout: RectLike, popupContext: PopupContext): RectLike {
    return this.resolveLayout(layout, popupContext).applyButton
  }

  private pointInRect(point: { x: number; y: number }, rect: RectLike): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.w &&
      point.y >= rect.y && point.y <= rect.y + rect.h
  }

}

type GridFilterOperatorPopupInitial = 'selected' | 'last'

interface GridFilterOperatorPopupOptions {
  owner: object
  parent: Popup
  getAnchor: (popupContext: PopupContext) => RectLike
  getOperators: () => readonly GridFilterOperator[]
  getSelectedOperator: () => GridFilterOperator
  onSelect: (operator: GridFilterOperator) => void
  onTab: (direction: 1 | -1) => void
  onTriggerPointerDown: () => void
  onRequestPaint: () => void
}

class GridFilterOperatorPopup extends PopupPanelShell implements Popup {
  private readonly _scrollbarController = new ScrollbarAxisController('vertical')
  private _keyboardIndex = -1
  private _hoveredIndex = -1
  private _pressedIndex = -1
  private _scrollOffset = 0
  private _activePointerId: number | null = null

  constructor(private readonly _options: GridFilterOperatorPopupOptions) {
    super()
  }

  open(initial: GridFilterOperatorPopupInitial): void {
    const operators = this._options.getOperators()
    const selectedIndex = operators.indexOf(this._options.getSelectedOperator())
    this._keyboardIndex = initial === 'last'
      ? Math.max(0, operators.length - 1)
      : Math.max(0, selectedIndex)
    this._hoveredIndex = -1
    this._pressedIndex = -1
    this._scrollOffset = 0
    this._activePointerId = null
    this._scrollbarController.reset()
    this.ensureKeyboardVisible(this.popupContext)
    this.openPopup({
      owner: this._options.owner,
      parent: this._options.parent,
    })
  }

  protected override getPanelLayout(popupContext: PopupContext): PopupPanelLayout {
    const layout = this.resolveLayout(popupContext)
    return {
      panelX: layout.rect.x,
      panelY: layout.rect.y,
      panelW: layout.rect.w,
      panelH: layout.rect.h,
    }
  }

  onPointerDown(event: PointerEvent, popupContext: PopupContext): void {
    if (!isPrimaryPointerButton(event)) return
    if (this._activePointerId !== null && this._activePointerId !== event.pointerId) return
    const scrollbar = this.scrollbarGeometry(popupContext)
    if (scrollbar.maxScroll > 0 && this.pointInGeometryRect(event.position, scrollbar.hitRect)) {
      const result = this._scrollbarController.beginPointer(event.position, scrollbar, pointerKey(event))
      if (result.dragStarted) {
        this._activePointerId = event.pointerId
        event.setPointerCapture?.()
      }
      if (result.scrollOffset !== undefined) {
        this._scrollOffset = Math.round(
          result.scrollOffset / deriveDropdownStyle(popupContext.theme).itemHeight,
        )
      }
      this._options.onRequestPaint()
      return
    }
    const index = this.indexAt(event.position, popupContext)
    if (index < 0) return
    this._keyboardIndex = index
    this._pressedIndex = index
    this._activePointerId = event.pointerId
    event.setPointerCapture?.()
    this._options.onRequestPaint()
  }

  onPointerMove(event: PointerEvent, popupContext: PopupContext): void {
    if (this._activePointerId !== null && this._activePointerId !== event.pointerId) return
    const scrollbar = this.scrollbarGeometry(popupContext)
    if (this._scrollbarController.state.dragging) {
      const result = this._scrollbarController.updatePointer(event.position, scrollbar, pointerKey(event))
      const itemHeight = deriveDropdownStyle(popupContext.theme).itemHeight
      this._scrollOffset = Math.round((result.scrollOffset ?? this._scrollOffset * itemHeight) / itemHeight)
      this._options.onRequestPaint()
      return
    }
    const scrollbarHoverChanged = this._scrollbarController.updateHover(event.position, scrollbar)
    const next = this.indexAt(event.position, popupContext)
    const pressCanceled = this._pressedIndex >= 0 && next !== this._pressedIndex
    if (pressCanceled) {
      this._pressedIndex = -1
      this._activePointerId = null
      event.releasePointerCapture?.()
    }
    if (next === this._hoveredIndex) {
      if (pressCanceled || scrollbarHoverChanged) this._options.onRequestPaint()
      return
    }
    this._hoveredIndex = next
    this._options.onRequestPaint()
  }

  onPointerUp(event: PointerEvent, popupContext: PopupContext): void {
    if (!isPrimaryPointerButton(event)) return
    if (this._activePointerId !== null && this._activePointerId !== event.pointerId) return
    if (this._scrollbarController.state.dragging) {
      this._scrollbarController.endPointer(event.position, this.scrollbarGeometry(popupContext), pointerKey(event))
      this._activePointerId = null
      event.releasePointerCapture?.()
      this._options.onRequestPaint()
      return
    }
    const pressed = this._pressedIndex
    this._pressedIndex = -1
    this._activePointerId = null
    event.releasePointerCapture?.()
    if (pressed >= 0 && this.indexAt(event.position, popupContext) === pressed) {
      this.selectIndex(pressed)
      return
    }
    this._options.onRequestPaint()
  }

  onPointerCancel(event: PointerEvent): void {
    if (this._activePointerId !== null && this._activePointerId !== event.pointerId) return
    this._scrollbarController.cancelPointer(pointerKey(event))
    this._pressedIndex = -1
    this._activePointerId = null
    event.releasePointerCapture?.()
    this._options.onRequestPaint()
  }

  onWheel(event: WheelPointerEvent, popupContext: PopupContext): boolean {
    if (event.deltaY === 0 || this.maxScrollOffset(popupContext) <= 0) return false
    const before = this._scrollOffset
    const step = Math.abs(event.deltaY) < 8 ? 1 : 3
    this._scrollOffset = Math.max(
      0,
      Math.min(this.maxScrollOffset(popupContext), before + (event.deltaY > 0 ? step : -step)),
    )
    if (before !== this._scrollOffset) this._options.onRequestPaint()
    return true
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    if (event.key === 'Tab') {
      event.preventDefault()
      const direction = event.shiftKey ? -1 : 1
      this.close()
      this._options.onTab(direction)
      return true
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      this.moveKeyboard(event.key === 'ArrowDown' ? 1 : -1)
      return true
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      this._keyboardIndex = event.key === 'Home'
        ? 0
        : Math.max(0, this._options.getOperators().length - 1)
      this.ensureKeyboardVisible(this.popupContext)
      this._options.onRequestPaint()
      return true
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      this.selectIndex(this._keyboardIndex)
      return true
    }
    return false
  }

  onOutsidePointerDown(event: PointerEvent, popupContext: PopupContext): boolean {
    if (this.pointInRect(event.position, this._options.getAnchor(popupContext))) {
      this._options.onTriggerPointerDown()
    }
    this.close()
    return true
  }

  paint(context: PaintContext): void {
    if (!this.visible) return
    const popupContext = this.popupContext
    const layout = this.resolveLayout(popupContext)
    const popup = derivePopupStyle(context.theme)
    const dropdown = deriveDropdownStyle(context.theme)
    const filterStyle = deriveGridFilterPopupStyle(context.theme)
    const scrollbar = deriveScrollbarStyle(context.theme)
    const operators = this._options.getOperators()
    const selected = this._options.getSelectedOperator()
    const dl = new DrawList(context)
    drawPopupPanel(dl, layout.rect.x, layout.rect.y, layout.rect.w, layout.rect.h, popup)
    const list = this.listRect(popupContext)
    const hasScrollbar = operators.length > layout.visibleRows
    const rowWidth = Math.max(
      0,
      list.w - (hasScrollbar ? scrollbar.gutterSize + dropdown.padding : 0),
    )
    dl.pushClip(list.x, list.y, list.w, list.h)
    for (let visibleIndex = 0; visibleIndex < layout.visibleRows; visibleIndex++) {
      const index = this._scrollOffset + visibleIndex
      const operator = operators[index]
      if (!operator) break
      const row = {
        x: list.x,
        y: list.y + visibleIndex * dropdown.itemHeight,
        w: rowWidth,
        h: dropdown.itemHeight,
      }
      const isSelected = operator === selected
      const hovered = index === this._hoveredIndex
      const focused = index === this._keyboardIndex
      const pressed = index === this._pressedIndex
      const state = { selected: isSelected, hovered, focused, pressed }
      const checkmarkSize = row.h * 0.6
      const checkmarkX = row.x + row.w - row.h * 0.65
      const textX = row.x + dropdown.padding
      const textRight = checkmarkX - dropdown.padding
      dl.fillRect(
        row.x,
        row.y,
        row.w,
        row.h,
        resolveBgColor(dropdown.itemBg, state),
        popup.borderRadius,
      )
      dl.pushClip(textX, row.y, Math.max(0, textRight - textX), row.h)
      dl.fillText(
        operatorLabel(operator),
        textX,
        row.y + row.h / 2,
        resolveTextColor(dropdown.itemText, state),
        dropdown.fontSize,
        dropdown.fontFamily,
        'left',
        'middle',
      )
      dl.popClip()
      if (isSelected) {
        dl.drawCheckmark(
          checkmarkX,
          row.y + row.h * 0.2,
          checkmarkSize,
          resolveTextColor(dropdown.itemText, state),
          filterStyle.checkmarkStrokeWidth,
        )
      }
    }
    dl.popClip()
    if (hasScrollbar) {
      paintVBar({
        dl,
        style: scrollbar,
        trackX: list.x + list.w - scrollbar.gutterSize,
        trackY: list.y,
        trackW: scrollbar.gutterSize,
        trackH: list.h,
        viewSize: list.h,
        contentSize: operators.length * dropdown.itemHeight,
        scrollOffset: this._scrollOffset * dropdown.itemHeight,
        state: this._scrollbarController.state,
      })
    }
  }

  protected override onPopupClose(): void {
    this._scrollbarController.reset()
    this._pressedIndex = -1
    this._hoveredIndex = -1
    this._activePointerId = null
    this._options.onRequestPaint()
  }

  private resolveLayout(popupContext: PopupContext) {
    const anchor = this._options.getAnchor(popupContext)
    const dropdown = deriveDropdownStyle(popupContext.theme)
    const popup = derivePopupStyle(popupContext.theme)
    return resolveDropdownPopupLayout({
      context: popupContext,
      anchorRect: anchor,
      desiredWidth: anchor.w,
      rowCount: this._options.getOperators().length,
      maxVisibleRows: 8,
      rowHeight: dropdown.itemHeight,
      extraHeight: popup.padding * 2,
      minPopupWidth: anchor.w,
      maxPopupWidth: Math.max(48, anchor.w),
    })
  }

  private listRect(popupContext: PopupContext): RectLike {
    const layout = this.resolveLayout(popupContext)
    const popup = derivePopupStyle(popupContext.theme)
    const dropdown = deriveDropdownStyle(popupContext.theme)
    return {
      x: layout.rect.x + popup.padding,
      y: layout.rect.y + popup.padding,
      w: Math.max(0, layout.rect.w - popup.padding * 2),
      h: layout.visibleRows * dropdown.itemHeight,
    }
  }

  private scrollbarGeometry(popupContext: PopupContext): ScrollbarGeometry {
    const list = this.listRect(popupContext)
    const dropdown = deriveDropdownStyle(popupContext.theme)
    const style = deriveScrollbarStyle(popupContext.theme)
    const state = this._scrollbarController.state
    const visualThickness = state.dragging
      ? style.thumbPressedThickness
      : state.hovered
        ? style.thumbHoveredThickness
        : style.thumbThickness
    return resolveScrollbarGeometry({
      axis: 'vertical',
      trackRect: {
        x: list.x + list.w - style.gutterSize,
        y: list.y,
        width: style.gutterSize,
        height: list.h,
      },
      viewportSize: list.h,
      contentSize: this._options.getOperators().length * dropdown.itemHeight,
      scrollOffset: this._scrollOffset * dropdown.itemHeight,
      visualThickness,
      minThumbLength: style.minThumbLength,
      endInset: style.endInset,
    })
  }

  private indexAt(point: { x: number; y: number }, popupContext: PopupContext): number {
    const list = this.listRect(popupContext)
    const layout = this.resolveLayout(popupContext)
    const hasScrollbar = this._options.getOperators().length > layout.visibleRows
    const dropdown = deriveDropdownStyle(popupContext.theme)
    const scrollbar = deriveScrollbarStyle(popupContext.theme)
    const selectableWidth = Math.max(
      0,
      list.w - (hasScrollbar ? scrollbar.gutterSize + dropdown.padding : 0),
    )
    if (
      point.x < list.x ||
      point.x > list.x + selectableWidth ||
      point.y < list.y ||
      point.y > list.y + list.h
    ) {
      return -1
    }
    const itemHeight = dropdown.itemHeight
    const index = this._scrollOffset + Math.floor((point.y - list.y) / itemHeight)
    return index < this._options.getOperators().length ? index : -1
  }

  private selectIndex(index: number): void {
    const operator = this._options.getOperators()[index]
    if (!operator) return
    this._options.onSelect(operator)
    this.close()
  }

  private moveKeyboard(direction: 1 | -1): void {
    const count = this._options.getOperators().length
    if (count === 0) return
    this._keyboardIndex = (Math.max(0, this._keyboardIndex) + direction + count) % count
    this.ensureKeyboardVisible(this.popupContext)
    this._options.onRequestPaint()
  }

  private ensureKeyboardVisible(popupContext: PopupContext): void {
    if (this._keyboardIndex < 0) return
    const visibleRows = Math.max(1, this.resolveLayout(popupContext).visibleRows)
    if (this._keyboardIndex < this._scrollOffset) {
      this._scrollOffset = this._keyboardIndex
    } else if (this._keyboardIndex >= this._scrollOffset + visibleRows) {
      this._scrollOffset = this._keyboardIndex - visibleRows + 1
    }
    this._scrollOffset = Math.max(0, Math.min(this.maxScrollOffset(popupContext), this._scrollOffset))
  }

  private maxScrollOffset(popupContext: PopupContext): number {
    return Math.max(
      0,
      this._options.getOperators().length - Math.max(1, this.resolveLayout(popupContext).visibleRows),
    )
  }

  private pointInRect(point: { x: number; y: number }, rect: RectLike): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.w &&
      point.y >= rect.y && point.y <= rect.y + rect.h
  }

  private pointInGeometryRect(
    point: { x: number; y: number },
    rect: { x: number; y: number; width: number; height: number },
  ): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.width &&
      point.y >= rect.y && point.y <= rect.y + rect.height
  }
}

export interface RectLike {
  x: number
  y: number
  w: number
  h: number
}

function operatorsForColumn(column: GridColumnDef): GridFilterOperator[] {
  if (column.type === 'number' || column.type === 'date' || column.type === 'time') {
    return ['equals', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'notEmpty']
  }
  if (gridColumnUsesRawFilterEquality(column)) {
    return ['empty', 'notEmpty']
  }
  return ['contains', 'equals', 'startsWith', 'endsWith', 'empty', 'notEmpty']
}

function defaultOperatorForColumn(column: GridColumnDef): GridFilterOperator {
  if (gridColumnUsesRawFilterEquality(column)) return 'empty'
  if (column.type === 'number' || column.type === 'date' || column.type === 'time') {
    return 'equals'
  }
  return 'contains'
}

function operatorLabel(operator: GridFilterOperator): string {
  if (operator === 'contains') return '包含'
  if (operator === 'equals') return '等于'
  if (operator === 'startsWith') return '开头是'
  if (operator === 'endsWith') return '结尾是'
  if (operator === 'gt') return '大于'
  if (operator === 'gte') return '大于等于'
  if (operator === 'lt') return '小于'
  if (operator === 'lte') return '小于等于'
  if (operator === 'between') return '介于'
  if (operator === 'empty') return '为空'
  return '不为空'
}

function placeholderForOperator(operator: GridFilterOperator): string {
  return operator === 'between' ? '起始值..结束值' : '输入筛选值...'
}
