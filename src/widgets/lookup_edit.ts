import { FocusManager, type Focusable } from '../core/focus_manager'
import { runCleanupSteps, type DisposeFn } from '../core/disposable'
import { GET_POPUP_ANCHOR_RECT, type PopupAnchorTarget } from '../core/popup_anchor'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import { paintSingleLineText } from '../rendering/text_painter'
import type { PaintContext } from '../rendering/paint_context'
import {
  blendColor,
  deriveDropdownStyle,
  deriveTextInputStyle,
  resolveBgColor,
  resolveTextColor,
} from '../theme/component_styles'
import {
  layoutFormFieldInlineContent,
  measureFormFieldHeight,
  pointInFormFieldRect,
  type FormFieldStatus,
} from './form_field_shell'
import {
  paintTriggerFieldShell,
} from './trigger_field_shell'
import { DropdownGridPopup } from './grid/popup/dropdown_grid_popup'
import { LookupValueIndex } from './grid/lookup_value_index'
import { paintIconGlyph } from './icon'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorValueChangeListener,
} from './value_editor'

export interface LookupEditColumn {
  key: string
  title: string
  width?: number
}

export interface LookupEditQueryContext<T extends Record<string, any> = Record<string, any>> {
  query: string
  rows: readonly T[]
  columns: readonly LookupEditColumn[]
  valueKey: string
  labelKey: string
  metaKey?: string
  queryKeys: readonly string[]
  selectedValue: string
}

export interface LookupEditQueryResult<T extends Record<string, any> = Record<string, any>> {
  rows: T[]
}

export type LookupEditQueryProcessor<T extends Record<string, any> = Record<string, any>> =
  (context: LookupEditQueryContext<T>) => LookupEditQueryResult<T>

export interface LookupEditDebugState {
  popupVisible: boolean
  queryText: string
  showQueryInField: boolean
  displayText: string
  focused: boolean
  disabled: boolean
  readonly: boolean
  value: string
  selectedLabel: string
  filteredCount: number
}

export type LookupEditValueChangeReason = 'selection' | 'clear'

export class RenderLookupEdit<T extends Record<string, any> = Record<string, any>>
  extends RenderBox
  implements
    InteractiveRenderObject,
    Focusable,
    ValueEditor<string, LookupEditValueChangeReason, T | null> {
  private _columns: LookupEditColumn[]
  private _rows: T[]
  private readonly _valueIndex = new LookupValueIndex<T>(value => String(value ?? ''))
  valueKey: string
  labelKey: string
  private _value: string
  placeholder: string
  onChange?: (value: string, row: T | null) => void
  searchable: boolean
  maxVisibleItems: number
  private _readonly: boolean
  private _disabled: boolean
  private _status: FormFieldStatus
  private _helperText: string
  private _prefixText: string
  private _suffixText: string
  private _clearable: boolean
  metaKey?: string
  metaFormatter?: (row: T) => string
  queryKeys?: string[]
  queryProcessor?: LookupEditQueryProcessor<T>
  private _focusRegistered = false

  private _focused = false
  private _hovered = false
  private _popup: DropdownGridPopup
  private _queryText = ''
  private _showQueryInField = false
  private readonly _valueEditorEvents = new ValueEditorEventEmitter<
    string,
    LookupEditValueChangeReason,
    T | null
  >()

  constructor(opts: {
    columns: LookupEditColumn[]
    rows: T[]
    valueKey: string
    labelKey: string
    value?: string
    placeholder?: string
    onChange?: (value: string, row: T | null) => void
    searchable?: boolean
    maxVisibleItems?: number
    readonly?: boolean
    disabled?: boolean
    status?: FormFieldStatus
    helperText?: string
    prefixText?: string
    suffixText?: string
    clearable?: boolean
    metaKey?: string
    metaFormatter?: (row: T) => string
    queryKeys?: string[]
    queryProcessor?: LookupEditQueryProcessor<T>
  }) {
    super()
    this._columns = opts.columns
    this._rows = opts.rows
    this.valueKey = opts.valueKey
    this.labelKey = opts.labelKey
    this._value = opts.value ?? ''
    this.placeholder = opts.placeholder ?? '请选择...'
    this.onChange = opts.onChange
    this.searchable = opts.searchable ?? true
    this.maxVisibleItems = opts.maxVisibleItems ?? 8
    this._readonly = opts.readonly ?? false
    this._disabled = opts.disabled ?? false
    this._status = opts.status ?? 'default'
    this._helperText = opts.helperText ?? ''
    this._prefixText = opts.prefixText ?? ''
    this._suffixText = opts.suffixText ?? ''
    this._clearable = opts.clearable ?? false
    this.metaKey = opts.metaKey
    this.metaFormatter = opts.metaFormatter
    this.queryKeys = opts.queryKeys
    this.queryProcessor = opts.queryProcessor
    this._valueIndex.sync(this._rows, this.valueKey)
    this._popup = new DropdownGridPopup()
    this._syncFocusRegistration()
  }

  get columns(): LookupEditColumn[] { return this._columns }
  set columns(columns: LookupEditColumn[]) {
    if (columns === this._columns) return
    this._columns = columns
    if (this._popup.visible) {
      this._popup.setColumns(columns)
      this._popup.setRows(this._resolveQueryRows(this._queryText))
    }
    this.markNeedsPaint()
  }

  get rows(): T[] { return this._rows }
  set rows(rows: T[]) {
    if (rows === this._rows) return
    this._rows = rows
    this._valueIndex.sync(rows, this.valueKey)
    if (this._popup.visible) this._popup.setRows(this._resolveQueryRows(this._queryText))
    this.markNeedsPaint()
  }

  refreshLookup(): void {
    this._valueIndex.sync(this._rows, this.valueKey, true)
    if (this._popup.visible) this._popup.setRows(this._resolveQueryRows(this._queryText))
    this.markNeedsPaint()
  }

  get value(): string { return this._value }
  set value(value: string) {
    const nextValue = String(value ?? '')
    if (this._value === nextValue) return
    this._value = nextValue
    this.markNeedsPaint()
  }

  getValue(): string {
    return this.value
  }

  setValue(value: string): void {
    const nextValue = String(value ?? '')
    if (this.value === nextValue) return
    this._popup.close()
    this._resetQueryPresentation()
    this.value = nextValue
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<
      string,
      LookupEditValueChangeReason,
      T | null
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
        () => this._resetQueryPresentation(),
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

  get readonly(): boolean { return this._readonly }
  set readonly(readonly: boolean) {
    if (this._readonly === readonly) return
    this._readonly = readonly
    if (readonly) {
      runCleanupSteps([
        () => { this._hovered = false },
        () => this._endLogicalFocusSession(),
        () => this._resetQueryPresentation(),
        () => this._syncFocusRegistration(),
        () => this.markNeedsPaint(),
      ])
      return
    }
    this._syncFocusRegistration()
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
    this._resetQueryPresentation()
    if (typeof window === 'undefined') {
      this.focusOut()
      return
    }
    FocusManager.instance.clearFocusOf(this)
  }

  [GET_POPUP_ANCHOR_RECT](): { x: number; y: number; width: number; height: number } {
    const g = this.globalOffset
    return { x: g.x, y: g.y, width: this.size.width, height: this._inputStyle().height }
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const inputStyle = deriveTextInputStyle(context.theme)
    this.size = {
      width: constraints.maxWidth === Infinity ? 220 : constraints.maxWidth,
      height: measureFormFieldHeight(inputStyle, inputStyle.height, this.helperText),
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
    })
    const fieldHeight = shell.fieldHeight
    if (readonlyVisual) {
      const readonlyTint = blendColor(
        resolveBgColor(input.inputBg, 'normal'),
        input.placeholderText,
        0.06,
      )
      dl.fillRect(offset.x + 1, offset.y + 1, Math.max(0, w - 2), Math.max(0, fieldHeight - 2), readonlyTint, Math.max(0, input.borderRadius - 1))
    }
    const displayText = this._displayText()
    const displayMeta = this._displayMetaText()
    const hasCommittedLabel = this._selectedLabel().length > 0
    const showingPlaceholder = displayText.length === 0 && (!hasCommittedLabel || this._showQueryInField)
    const textColor = this.disabled
      ? input.textDisabled
      : showingPlaceholder
        ? input.placeholderText
        : resolveTextColor(dropdown.itemText, 'normal')
    const text = showingPlaceholder ? this.placeholder : displayText
    const metaFontSize = Math.max(11, dropdown.fontSize - 1)
    const metaTextColor = this.disabled ? input.textDisabled : input.placeholderText
    const metaWidth = displayMeta
      ? TextMeasurer.measureWidth(displayMeta, metaFontSize, dropdown.fontFamily)
      : 0
    const metaGap = displayMeta ? 8 : 0
    const metaX = shell.valueRect.x + Math.max(0, shell.valueRect.w - metaWidth)
    const textClipWidth = Math.max(0, shell.valueRect.w - metaWidth - metaGap)
    dl.pushClip(shell.valueRect.x, y, textClipWidth, fieldHeight)
    paintSingleLineText(dl, {
      text,
      x: shell.valueRect.x,
      y: y + fieldHeight / 2,
      maxWidth: textClipWidth,
      color: textColor,
      fontSize: dropdown.fontSize,
      fontFamily: dropdown.fontFamily,
    })
    dl.popClip()
    if (displayMeta) {
      dl.pushClip(metaX, y, Math.max(0, shell.valueRect.x + shell.valueRect.w - metaX), fieldHeight)
      dl.fillText(displayMeta, metaX, y + fieldHeight / 2, metaTextColor, metaFontSize, dropdown.fontFamily, 'left', 'middle')
      dl.popClip()
    }

    const arrowX = (shell.trailingRect?.x ?? (x + w - input.padding - dropdown.fontSize)) + dropdown.fontSize / 2
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
  }

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this.disabled || !this._hitField(e.position)) return
    const layout = this._triggerLayout()
    if (pointInFormFieldRect(layout.clearRect, e.position)) {
      this._clearValue()
      return
    }
    if (this.readonly) return
    FocusManager.instance.setFocus(this)
    if (this._popup.visible) {
      this._popup.close()
      this._resetQueryPresentation()
    } else {
      this._openPopup('', false)
    }
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.disabled) return false
    if (this.readonly) {
      if (event.key === 'Escape' && this._popup.visible) {
        event.preventDefault()
        this._popup.close()
        this._resetQueryPresentation()
        return true
      }
      return false
    }
    if (event.key === 'Escape' && this._popup.visible) {
      event.preventDefault()
      this._popup.close()
      this._resetQueryPresentation()
      return true
    }
    if (event.key === 'Tab' && this._popup.visible) {
      this._popup.close()
      this._resetQueryPresentation()
      return false
    }
    if (this._popup.visible) return false
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault()
      this._openPopup('', false)
      return true
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && this._showClearButton()) {
      event.preventDefault()
      this._clearValue()
      return true
    }
    if (this.searchable && isLookupTypingKey(event)) {
      event.preventDefault()
      this._openPopup(event.key, true)
      return true
    }
    return false
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

  dispose(): void {
    this._valueEditorEvents.dispose()
    this._resetQueryPresentation()
    this._popup.dispose()
    this._valueIndex.clear()
    if (this._focusRegistered && typeof window !== 'undefined') {
      FocusManager.instance.unregister(this)
      this._focusRegistered = false
    }
    this._focused = false
    this._hovered = false
    super.dispose()
  }

  debugState(): LookupEditDebugState {
    return {
      popupVisible: this._popup.visible,
      queryText: this._queryText,
      showQueryInField: this._showQueryInField,
      displayText: this._displayText(),
      focused: this._focused,
      disabled: this.disabled,
      readonly: this.readonly,
      value: this.value,
      selectedLabel: this._selectedLabel(),
      filteredCount: this._debugFilteredCount(),
    }
  }

  private _openPopup(initialQuery: string, showQueryInField: boolean): void {
    if (this.disabled || this.readonly || this._popup.visible) return
    this._queryText = initialQuery
    this._showQueryInField = showQueryInField
    this._popup.open({
      columns: this.columns,
      rows: this._resolveQueryRows(initialQuery),
      valueKey: this.valueKey,
      labelKey: this.labelKey,
      selectedValue: this.value,
      anchor: this as PopupAnchorTarget,
      searchable: this.searchable,
      searchBehavior: 'external',
      searchText: initialQuery,
      maxVisibleItems: this.maxVisibleItems,
      onSelect: (value, row) => {
        this.value = value
        this._queryText = ''
        this._showQueryInField = false
        runCleanupSteps([
          () => this._emitValueChange(value, row as T, 'selection'),
          () => this._popup.close(),
        ])
      },
      onSearchTextChange: value => {
        this._queryText = value
        this._showQueryInField = true
        this._popup.setRows(this._resolveQueryRows(value))
        this.markNeedsPaint()
      },
      onClose: () => {
        this._resetQueryPresentation()
        this.markNeedsPaint()
      },
    })
    this.markNeedsPaint()
  }

  private _resetQueryPresentation(): void {
    this._queryText = ''
    this._showQueryInField = false
  }

  private _debugFilteredCount(): number {
    return this._popup.visible ? this._popup.debugState().filteredRows.length : this.rows.length
  }

  private _showClearButton(): boolean {
    return this.clearable && !this.disabled && !this.readonly && this.value.length > 0
  }

  private _selectedRow(): T | null {
    this._valueIndex.sync(this.rows, this.valueKey)
    return this._valueIndex.get(this.value) ?? null
  }

  private _resolveQueryRows(query: string): T[] {
    const processor = this.queryProcessor ?? defaultLookupQueryProcessor<T>
    return processor({
      query,
      rows: this.rows,
      columns: this.columns,
      valueKey: this.valueKey,
      labelKey: this.labelKey,
      metaKey: this.metaKey,
      queryKeys: this._queryKeys(),
      selectedValue: this.value,
    }).rows
  }

  private _selectedLabel(): string {
    const row = this._selectedRow()
    return row ? String(row[this.labelKey] ?? '') : ''
  }

  private _displayText(): string {
    if (this._popup.visible && this._showQueryInField) return this._queryText
    return this._selectedLabel()
  }

  private _displayMetaText(): string {
    if (this._popup.visible && this._showQueryInField) return ''
    const row = this._selectedRow()
    if (!row) return ''
    if (this.metaFormatter) return String(this.metaFormatter(row) ?? '')
    if (this.metaKey) return String(row[this.metaKey] ?? '')
    return ''
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

  private _clearValue(): void {
    if (!this._showClearButton()) return
    this._popup.close()
    this._resetQueryPresentation()
    FocusManager.instance.setFocus(this)
    this.value = ''
    this._emitValueChange('', null, 'clear')
    this.markNeedsPaint()
  }

  private _emitValueChange(
    value: string,
    row: T | null,
    reason: LookupEditValueChangeReason,
  ): void {
    runCleanupSteps([
      () => this.onChange?.(value, row),
      () => this._valueEditorEvents.emitValueChange({
        value,
        reason,
        detail: row,
      }),
    ])
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

  private _inputStyle(): ReturnType<typeof deriveTextInputStyle> {
    return deriveTextInputStyle(this.currentTheme)
  }

  private _queryKeys(): string[] {
    if (this.queryKeys && this.queryKeys.length > 0) return [...this.queryKeys]
    return dedupeLookupKeys([
      this.valueKey,
      this.labelKey,
      this.metaKey,
      ...this.columns.map(column => column.key),
    ])
  }
}

function isLookupTypingKey(event: KeyboardEvent): boolean {
  return !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.key.length === 1 &&
    /\S/.test(event.key)
}

export function defaultLookupQueryProcessor<T extends Record<string, any> = Record<string, any>>(
  context: LookupEditQueryContext<T>,
): LookupEditQueryResult<T> {
  const query = normalizeLookupQueryValue(context.query)
  if (!query) return { rows: [...context.rows] }

  const matches = context.rows.flatMap((row, rowIndex) => {
    const score = bestLookupMatchScore(row, rowIndex, context, query)
    return score ? [{ row, score }] : []
  })

  matches.sort((a, b) =>
    a.score.matchType - b.score.matchType ||
    a.score.fieldPriority - b.score.fieldPriority ||
    a.score.matchIndex - b.score.matchIndex ||
    a.score.exactLengthDelta - b.score.exactLengthDelta ||
    a.score.rowIndex - b.score.rowIndex)

  return { rows: matches.map(match => match.row) }
}

function dedupeLookupKeys(keys: Array<string | undefined>): string[] {
  const result: string[] = []
  for (const key of keys) {
    if (!key || result.includes(key)) continue
    result.push(key)
  }
  return result
}

function normalizeLookupQueryValue(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function bestLookupMatchScore<T extends Record<string, any>>(
  row: T,
  rowIndex: number,
  context: LookupEditQueryContext<T>,
  query: string,
): {
  matchType: number
  fieldPriority: number
  matchIndex: number
  exactLengthDelta: number
  rowIndex: number
} | null {
  let best: {
    matchType: number
    fieldPriority: number
    matchIndex: number
    exactLengthDelta: number
    rowIndex: number
  } | null = null

  for (let fieldIndex = 0; fieldIndex < context.queryKeys.length; fieldIndex += 1) {
    const key = context.queryKeys[fieldIndex]!
    const text = normalizeLookupQueryValue(row[key])
    if (!text) continue
    let matchType = -1
    let matchIndex = -1
    if (text === query) {
      matchType = 0
      matchIndex = 0
    } else if (text.startsWith(query)) {
      matchType = 1
      matchIndex = 0
    } else {
      const containsIndex = text.indexOf(query)
      if (containsIndex >= 0) {
        matchType = 2
        matchIndex = containsIndex
      }
    }
    if (matchType < 0) continue
    const fieldPriority = key === context.valueKey
      ? 0
      : key === context.labelKey
        ? 1
        : key === context.metaKey
          ? 2
          : 3 + fieldIndex
    const candidate = {
      matchType,
      fieldPriority,
      matchIndex,
      exactLengthDelta: Math.max(0, text.length - query.length),
      rowIndex,
    }
    if (!best ||
      candidate.matchType < best.matchType ||
      (candidate.matchType === best.matchType && candidate.fieldPriority < best.fieldPriority) ||
      (candidate.matchType === best.matchType && candidate.fieldPriority === best.fieldPriority && candidate.matchIndex < best.matchIndex) ||
      (candidate.matchType === best.matchType && candidate.fieldPriority === best.fieldPriority && candidate.matchIndex === best.matchIndex && candidate.exactLengthDelta < best.exactLengthDelta)) {
      best = candidate
    }
  }

  return best
}
