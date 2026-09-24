import { FocusManager } from '../core/focus_manager'
import { runCleanupSteps, type DisposeFn } from '../core/disposable'
import {
  GET_POPUP_ANCHOR_RECT,
  type PopupAnchorTarget,
} from '../core/popup_anchor'
import type {
  BoxConstraints,
  LayoutContext,
  Offset,
  RenderObject,
} from '../core/render_object'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { PendingPointerGesture } from '../gestures/pending_pointer_gesture'
import {
  pointerKey,
  resolvePointerIdentity,
  type PointerIdentity,
  type PointerType,
} from '../gestures/pointer_identity'
import type { InteractiveRenderObject, PointerEvent } from '../gestures/recognizers'
import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import type { PaintContext } from '../rendering/paint_context'
import {
  deriveTextInputStyle,
  type TextInputStyleTokens,
} from '../theme/component_styles'
import type { ResolvedTheme } from '../theme/theme'
import { measureChipLayout, paintChip } from './chip'
import { DropdownPopup, type DropdownOption } from './dropdown'
import type { FormFieldRect, FormFieldStatus } from './form_field_shell'
import { RenderTextBox } from './text_field'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorValueChangeListener,
} from './value_editor'

export interface TokenEditOption extends DropdownOption {}

export interface TokenEditToken {
  value: string
  label: string
}

export interface RenderTokenEditOptions extends RenderBoxOptions {
  options?: TokenEditOption[]
  values?: string[]
  placeholder?: string
  allowCustomTokens?: boolean
  tokenSeparators?: readonly string[]
  onChange?: (values: string[], tokens: TokenEditToken[]) => void
  disabled?: boolean
  readonly?: boolean
  status?: FormFieldStatus
  helperText?: string
  maxVisibleItems?: number
}

interface TokenChipLayout {
  value: string | null
  label: string
  x: number
  width: number
  removeX: number | null
  removeWidth: number
}

const DEFAULT_TOKEN_SEPARATORS = [',', ';', '，', '；'] as const
const TOKEN_GAP = 4
const MINIMUM_QUERY_WIDTH = 48

function isImeCompositionKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

class TokenTextBox extends RenderTextBox implements InteractiveRenderObject {
  private _hoveredTokenValue: string | null = null
  private _hoveredRemoveValue: string | null = null
  private _activeRemoveValue: string | null = null
  private _pressedRemoveValue: string | null = null
  private _removePointer?: PointerIdentity
  private readonly _removeGesture = new PendingPointerGesture()

  constructor(private readonly _tokenEdit: RenderTokenEdit, options: {
    placeholder: string
    disabled: boolean
    readonly: boolean
    status: FormFieldStatus
    helperText: string
  }) {
    super({
      value: '',
      placeholder: options.placeholder,
      disabled: options.disabled,
      readonly: options.readonly,
      status: options.status,
      helperText: options.helperText,
      onChange: value => this._tokenEdit.handleQueryChange(value),
      onSubmit: value => this._tokenEdit.commitQuery(value),
      onBlur: () => this._tokenEdit.handleInputBlur(),
      onKeyDown: event => this._tokenEdit.handleInputKeyDown(event),
    })
  }

  override focusIn(): void {
    super.focusIn()
    this._tokenEdit.handleInputFocus()
  }

  protected override shouldBlurOnSubmit(): boolean {
    return false
  }

  protected override leadingContentWidth(style: TextInputStyleTokens, fieldHeight: number): number {
    return this._tokenEdit.resolveChipLayout(this.currentTheme, fieldHeight, style).width
  }

  protected override paintLeadingContent(context: PaintContext, rect: FormFieldRect | null): void {
    if (!rect) return
    const layout = this._tokenEdit.resolveChipLayout(
      context.theme,
      rect.h + this._tokenEdit.fieldVerticalPadding(context.theme) * 2,
    )
    const y = rect.y + (rect.h - layout.height) / 2
    for (const chip of layout.chips) {
      const overflow = chip.value === null
      paintChip(context, {
        label: chip.label,
        rect: {
          x: rect.x + chip.x,
          y,
          width: chip.width,
          height: layout.height,
        },
        removable: !overflow && !this.disabled && !this.readonly,
        selected: !overflow,
        disabled: this.disabled,
        hovered: chip.value !== null && this._hoveredTokenValue === chip.value,
        removeHovered: chip.value !== null && this._hoveredRemoveValue === chip.value,
        removePressed: chip.value !== null && this._pressedRemoveValue === chip.value,
        centerLabel: overflow,
      })
    }
  }

  override onPointerDown(event: PointerEvent): void {
    if (this._removePointer && !this._ownsRemovePointer(event)) {
      event.preventActivation?.()
      return
    }
    if (!isPrimaryPointerButton(event)) return
    const hit = this._tokenEdit.locateChip(event.position)
    if (!this.disabled && !this.readonly && hit.removeValue) {
      event.preventActivation?.()
      this._removeGesture.resolveTerminal(
        'rejected',
        () => this._clearChipPointerVisualState(),
      )
      FocusManager.instance.setFocus(this)
      this._hoveredTokenValue = hit.tokenValue
      this._hoveredRemoveValue = hit.removeValue
      this._activeRemoveValue = hit.removeValue
      this._pressedRemoveValue = hit.removeValue
      this._removePointer = resolvePointerIdentity(event)
      this._removeGesture.begin(event, this, { captureOnAccept: false })
      this.markNeedsPaint()
      return
    }
    if (this.isFocused) this._tokenEdit.handleInputFocus()
    super.onPointerDown(event)
  }

  override onPointerMove(event: PointerEvent): void {
    if (this._removePointer && !this._ownsRemovePointer(event)) return
    const hit = this._tokenEdit.locateChip(event.position)
    const hoveredTokenValue = hit.tokenValue
    const hoveredRemoveValue = hit.removeValue
    const pressedRemoveValue = this._activeRemoveValue === hit.removeValue
      ? this._activeRemoveValue
      : null
    if (
      hoveredTokenValue !== this._hoveredTokenValue ||
      hoveredRemoveValue !== this._hoveredRemoveValue ||
      pressedRemoveValue !== this._pressedRemoveValue
    ) {
      this._hoveredTokenValue = hoveredTokenValue
      this._hoveredRemoveValue = hoveredRemoveValue
      this._pressedRemoveValue = pressedRemoveValue
      this.markNeedsPaint()
    }
    if (this._removePointer) return
    super.onPointerMove(event)
  }

  override onPointerUp(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this._removePointer) {
      if (!this._ownsRemovePointer(event)) return
      const activeValue = this._activeRemoveValue
      const removeValue = this._tokenEdit.locateChip(event.position).removeValue
      const shouldRemove = !!activeValue &&
        !this.disabled &&
        !this.readonly &&
        activeValue === removeValue
      this._removeGesture.resolveTerminal(
        shouldRemove ? 'accepted' : 'rejected',
        () => this._clearChipPointerVisualState(),
        () => {
          if (shouldRemove && activeValue) this._tokenEdit.removeToken(activeValue)
        },
        () => this.markNeedsPaint(),
      )
      return
    }
    super.onPointerUp(event)
  }

  override onPointerCancel(event: PointerEvent): void {
    if (this._removePointer) {
      if (!this._ownsRemovePointer(event)) return
      this._removeGesture.resolveTerminal(
        'rejected',
        () => this._clearChipPointerVisualState(),
        () => this.markNeedsPaint(),
      )
      return
    }
    super.onPointerCancel(event)
  }

  override onPointerLeave(event: PointerEvent): void {
    if (this._removePointer && !this._ownsRemovePointer(event)) return
    if (this._removePointer) {
      this._removeGesture.resolveTerminal(
        'rejected',
        () => this._clearChipPointerVisualState(),
      )
    }
    this._hoveredTokenValue = null
    this._hoveredRemoveValue = null
    this._pressedRemoveValue = null
    super.onPointerLeave(event)
  }

  override acceptGesture(pointerId: number, pointerType: PointerType = 'mouse'): void {
    if (this._ownsRemovePointer({ pointerId, pointerType })) {
      this._removeGesture.accept(pointerId, pointerType)
      return
    }
    super.acceptGesture(pointerId, pointerType)
  }

  override rejectGesture(pointerId: number, pointerType: PointerType = 'mouse'): void {
    if (this._ownsRemovePointer({ pointerId, pointerType })) {
      this._removeGesture.reject(pointerId, pointerType)
      this._clearChipPointerVisualState()
      this.markNeedsPaint()
      return
    }
    super.rejectGesture(pointerId, pointerType)
  }

  clearChipPointerState(): void {
    this._removeGesture.resolveTerminal(
      'rejected',
      () => this._clearChipPointerVisualState(),
      () => this.markNeedsPaint(),
    )
  }

  tokenInlineLayout() {
    return this._inlineLayout()
  }

  get resolvedTheme(): ResolvedTheme {
    return this.currentTheme
  }

  override dispose(): void {
    this._removeGesture.resolveTerminal(
      'rejected',
      () => this._clearChipPointerVisualState(),
      () => super.dispose(),
    )
  }

  private _ownsRemovePointer(
    event: Pick<PointerEvent, 'pointerId' | 'pointerType'>,
  ): boolean {
    return !!this._removePointer &&
      pointerKey(this._removePointer) === pointerKey(event)
  }

  private _clearChipPointerVisualState(): void {
    this._hoveredTokenValue = null
    this._hoveredRemoveValue = null
    this._activeRemoveValue = null
    this._pressedRemoveValue = null
    this._removePointer = undefined
  }
}

export type TokenEditValueChangeReason =
  | 'add'
  | 'remove'
  | 'options-reconcile'
  | 'mode-reconcile'

export class RenderTokenEdit extends RenderBox implements
  PopupAnchorTarget,
  ValueEditor<
    string[],
    TokenEditValueChangeReason,
    readonly TokenEditToken[]
  > {
  static override debugTypeName = 'RenderTokenEdit'

  private _options: TokenEditOption[]
  private _values: string[]
  private _placeholder: string
  private _allowCustomTokens: boolean
  private _tokenSeparators: readonly string[]
  private _onChange?: (values: string[], tokens: TokenEditToken[]) => void
  private _maxVisibleItems: number
  private _syncingPopup = false
  private _suppressPopupSync = false
  private _suppressEditorBlur = false
  private readonly _popup = new DropdownPopup()
  private readonly _input: TokenTextBox
  private readonly _valueEditorEvents = new ValueEditorEventEmitter<
    string[],
    TokenEditValueChangeReason,
    readonly TokenEditToken[]
  >()

  constructor(options: RenderTokenEditOptions = {}) {
    super(options)
    this._options = [...(options.options ?? [])]
    this._allowCustomTokens = options.allowCustomTokens ?? false
    this._values = this._normalizeValues(options.values ?? [])
    this._placeholder = options.placeholder ?? '请输入或选择'
    this._tokenSeparators = options.tokenSeparators?.length
      ? [...new Set(options.tokenSeparators)]
      : DEFAULT_TOKEN_SEPARATORS
    this._onChange = options.onChange
    this._maxVisibleItems = Math.max(1, Math.floor(options.maxVisibleItems ?? 8))
    this._input = new TokenTextBox(this, {
      placeholder: this._values.length > 0 ? '' : this._placeholder,
      disabled: options.disabled ?? false,
      readonly: options.readonly ?? false,
      status: options.status ?? 'default',
      helperText: options.helperText ?? '',
    })
    this._input.parent = this
  }

  get options(): TokenEditOption[] {
    return [...this._options]
  }

  set options(options: TokenEditOption[]) {
    const previousValue = this.values
    this._options = [...options]
    this._values = this._normalizeValues(this._values)
    this._refreshInputGeometry()
    this._syncPopup()
    if (!sameValues(previousValue, this._values)) {
      this._emitReconciledValueChange('options-reconcile', previousValue)
    }
  }

  get values(): string[] {
    return [...this._values]
  }

  set values(values: string[]) {
    const normalized = this._normalizeValues(values)
    if (sameValues(this._values, normalized)) return
    this._values = normalized
    this._refreshInputGeometry()
    this._syncPopup()
  }

  getValue(): string[] {
    return this.values
  }

  setValue(values: string[]): void {
    const normalized = this._normalizeValues(values)
    if (sameValues(this._values, normalized)) return
    this.cancelEdit()
    this.values = normalized
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<
      string[],
      TokenEditValueChangeReason,
      readonly TokenEditToken[]
    >,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: () => void): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
  }

  get tokens(): TokenEditToken[] {
    return this._values.map(value => this._resolveToken(value))
  }

  get query(): string {
    return this._input.value
  }

  set query(query: string) {
    if (this._input.value === query) return
    this._input.value = query
    this._syncPopup()
  }

  get allowCustomTokens(): boolean { return this._allowCustomTokens }
  set allowCustomTokens(allowCustomTokens: boolean) {
    if (this._allowCustomTokens === allowCustomTokens) return
    const previousValue = this.values
    this._allowCustomTokens = allowCustomTokens
    this.values = this._values
    if (!sameValues(previousValue, this._values)) {
      this._emitReconciledValueChange('mode-reconcile', previousValue)
    }
  }

  get disabled(): boolean { return this._input.disabled }
  set disabled(disabled: boolean) {
    if (this.disabled === disabled) return
    if (!disabled) {
      this._input.disabled = false
      return
    }
    this._endLogicalFocusSession(() => {
      this._input.disabled = true
    })
  }

  get readonly(): boolean { return this._input.readonly }
  set readonly(readonly: boolean) {
    if (this.readonly === readonly) return
    if (!readonly) {
      this._input.readonly = false
      return
    }
    this._endLogicalFocusSession(() => {
      this._input.readonly = true
    })
  }

  get status(): FormFieldStatus { return this._input.status }
  set status(status: FormFieldStatus) { this._input.status = status }

  get helperText(): string { return this._input.helperText }
  set helperText(helperText: string) { this._input.helperText = helperText }

  get placeholder(): string { return this._placeholder }
  set placeholder(placeholder: string) {
    if (this._placeholder === placeholder) return
    this._placeholder = placeholder
    this._syncPlaceholder()
  }

  get onChange(): ((values: string[], tokens: TokenEditToken[]) => void) | undefined {
    return this._onChange
  }

  set onChange(onChange: ((values: string[], tokens: TokenEditToken[]) => void) | undefined) {
    this._onChange = onChange
  }

  get isFocused(): boolean {
    return this._input.isFocused || this._popup.visible
  }

  focus(): void {
    this.requestFocus()
  }

  requestFocus(): void {
    if (this.disabled || typeof window === 'undefined') return
    FocusManager.instance.setFocus(this._input)
  }

  blur(): void {
    this._withPopupSyncSuppressed(() => {
      this._clearQuery()
      if (typeof window === 'undefined') {
        this._input.focusOut()
        return
      }
      FocusManager.instance.clearFocusOf(this._input)
    })
  }

  [GET_POPUP_ANCHOR_RECT](): { x: number; y: number; width: number; height: number } {
    const global = this.globalOffset
    return {
      x: global.x,
      y: global.y,
      width: this.size.width,
      height: this.size.height - (this.helperText ? this._helperHeight() : 0),
    }
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    visitor(this._input)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    this._input.layout(constraints, true, context)
    this._input.offset = { x: 0, y: 0 }
    this.size = { ...this._input.size }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    this._input.paint(context, offset)
  }

  handleQueryChange(_value: string): void {
    this._syncPopup()
  }

  handleInputFocus(): void {
    if (this._suppressPopupSync) return
    this._syncPopup()
  }

  handleInputBlur(): void {
    if (this._suppressEditorBlur) return
    if (this._popup.visible) return
    this._valueEditorEvents.emitBlur()
    queueMicrotask(() => {
      if (!this._input.isFocused) this._popup.close()
    })
  }

  handleInputKeyDown(event: KeyboardEvent): boolean {
    if (this.disabled || this.readonly) return false
    if (isImeCompositionKey(event)) return false
    if ((event.key === 'Backspace' || event.key === 'Delete') && this.query.length === 0) {
      const last = this._values.at(-1)
      if (!last) return false
      event.preventDefault()
      this.removeToken(last)
      return true
    }
    if (this._tokenSeparators.includes(event.key)) {
      event.preventDefault()
      this.commitQuery(this.query)
      return true
    }
    return false
  }

  commitQuery(query: string): void {
    if (this.disabled || this.readonly) return
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return
    const exactOption = this._options.find(option =>
      !option.disabled &&
      (option.value === normalizedQuery || option.label === normalizedQuery),
    )
    if (exactOption) {
      this._addToken(exactOption.value)
      return
    }
    if (this.allowCustomTokens) this._addToken(normalizedQuery)
  }

  commitEdit(): boolean {
    const query = this.query.trim()
    if (!query) return true
    this.commitQuery(query)
    return this.query.trim().length === 0
  }

  cancelEdit(): void {
    this._withPopupSyncSuppressed(() => this._clearQuery())
  }

  removeToken(value: string): void {
    if (this.disabled || this.readonly || !this._values.includes(value)) return
    const previousValue = this.values
    this._values = this._values.filter(current => current !== value)
    runCleanupSteps([
      () => this._emitChange('remove', previousValue),
      () => this._refreshInputGeometry(),
      () => this._syncPopup(),
    ])
  }

  resolveChipLayout(
    theme: ResolvedTheme,
    fieldHeight: number,
    style: TextInputStyleTokens = deriveTextInputStyle(theme),
  ): { chips: TokenChipLayout[]; width: number; height: number } {
    const chipHeight = Math.max(18, Math.min(fieldHeight - 6, style.lineHeight))
    const available = Math.max(
      0,
      this._input.size.width - style.padding * 2 - MINIMUM_QUERY_WIDTH - TOKEN_GAP,
    )
    if (available <= 0 || this._values.length === 0) {
      return { chips: [], width: 0, height: chipHeight }
    }

    const tokens = this.tokens
    const chips: TokenChipLayout[] = []
    let cursor = 0
    let hiddenCount = 0
    const overflowWidth = (count: number) =>
      measureChipLayout(theme, `+${count}`, { height: chipHeight }).width

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!
      const metrics = measureChipLayout(theme, token.label, {
        removable: !this.disabled && !this.readonly,
        height: chipHeight,
      })
      const remaining = tokens.length - index - 1
      const reserve = remaining > 0 ? overflowWidth(remaining) + TOKEN_GAP : 0
      if (cursor + metrics.width + reserve > available) {
        hiddenCount = tokens.length - index
        break
      }
      chips.push({
        value: token.value,
        label: token.label,
        x: cursor,
        width: metrics.width,
        removeX: metrics.removeRect ? cursor + metrics.removeRect.x : null,
        removeWidth: metrics.removeRect?.width ?? 0,
      })
      cursor += metrics.width + TOKEN_GAP
    }

    if (hiddenCount > 0) {
      let label = `+${hiddenCount}`
      let width = overflowWidth(hiddenCount)
      while (chips.length > 0 && cursor + width > available) {
        const removed = chips.pop()!
        cursor = removed.x
        hiddenCount += 1
        label = `+${hiddenCount}`
        width = overflowWidth(hiddenCount)
      }
      chips.push({
        value: null,
        label,
        x: cursor,
        width: Math.min(width, available - cursor),
        removeX: null,
        removeWidth: 0,
      })
      cursor += Math.min(width, available - cursor)
    } else if (chips.length > 0) {
      cursor -= TOKEN_GAP
    }

    return { chips, width: Math.max(0, cursor), height: chipHeight }
  }

  locateChip(position: Offset): { tokenValue: string | null; removeValue: string | null } {
    const inline = this._input.tokenInlineLayout()
    const rect = inline.leadingRect
    if (!rect) return { tokenValue: null, removeValue: null }
    const style = this._input.resolvedTheme
    const layout = this.resolveChipLayout(
      style,
      rect.h + this.fieldVerticalPadding(style) * 2,
    )
    const y = rect.y + (rect.h - layout.height) / 2
    for (const chip of layout.chips) {
      const left = rect.x + chip.x
      const inChip = position.x >= left &&
        position.x <= left + chip.width &&
        position.y >= y &&
        position.y <= y + layout.height
      if (!inChip) continue
      const inRemove = chip.value !== null &&
        chip.removeX !== null &&
        position.x >= rect.x + chip.removeX &&
        position.x <= rect.x + chip.removeX + chip.removeWidth
      return {
        tokenValue: chip.value,
        removeValue: inRemove ? chip.value : null,
      }
    }
    return { tokenValue: null, removeValue: null }
  }

  fieldVerticalPadding(theme: ResolvedTheme): number {
    return deriveTextInputStyle(theme).padding
  }

  debugState(): {
    query: string
    values: string[]
    tokens: TokenEditToken[]
    visibleTokenValues: Array<string | null>
    popupVisible: boolean
    suggestions: TokenEditOption[]
  } {
    const layout = this.resolveChipLayout(
      this._input.resolvedTheme,
      this.size.height || deriveTextInputStyle(this._input.resolvedTheme).height,
    )
    return {
      query: this.query,
      values: this.values,
      tokens: this.tokens,
      visibleTokenValues: layout.chips.map(chip => chip.value),
      popupVisible: this._popup.visible,
      suggestions: this._filteredSuggestions(),
    }
  }

  override dispose(): void {
    this._valueEditorEvents.dispose()
    this._popup.dispose()
    super.dispose()
  }

  private _addToken(value: string): void {
    if (this._values.includes(value)) {
      this._clearQuery()
      return
    }
    const previousValue = this.values
    this._values = [...this._values, value]
    this._clearQuery()
    runCleanupSteps([
      () => this._emitChange('add', previousValue),
      () => this._refreshInputGeometry(),
    ])
  }

  private _clearQuery(): void {
    this._input.value = ''
    this._popup.close()
    this._syncPlaceholder()
  }

  private _filteredSuggestions(): TokenEditOption[] {
    const selected = new Set(this._values)
    const query = this.query.trim().toLocaleLowerCase()
    return this._options.filter(option => {
      if (option.disabled || selected.has(option.value)) return false
      if (!query) return true
      return option.label.toLocaleLowerCase().includes(query) ||
        option.value.toLocaleLowerCase().includes(query)
    })
  }

  private _syncPopup(): void {
    if (this._suppressPopupSync) {
      this._popup.close()
      return
    }
    if (this._syncingPopup) return
    if (!this._input.isFocused || this.disabled || this.readonly) {
      this._popup.close()
      return
    }
    const suggestions = this._filteredSuggestions()
    if (suggestions.length === 0) {
      this._popup.close()
      return
    }
    if (this._popup.visible) {
      this._popup.updateOptions(suggestions, suggestions[0]!.value)
      this._input.markNeedsPaint()
      return
    }
    this._syncingPopup = true
    try {
      this._popup.open({
        options: suggestions,
        selectedValue: suggestions[0]!.value,
        anchor: this,
        searchable: false,
        maxVisibleItems: this._maxVisibleItems,
        keepOpenOnAnchorPointerDown: true,
        onSelect: value => {
          this._addToken(value)
        },
        onClose: () => this._input.markNeedsPaint(),
      })
      this._input.markNeedsPaint()
    } finally {
      this._syncingPopup = false
    }
  }

  private _withPopupSyncSuppressed(callback: () => void): void {
    const wasSuppressed = this._suppressPopupSync
    this._suppressPopupSync = true
    try {
      callback()
    } finally {
      this._suppressPopupSync = wasSuppressed
    }
  }

  private _endLogicalFocusSession(updateState: () => void): void {
    const wasFocused = this.isFocused
    const wasSuppressingBlur = this._suppressEditorBlur
    this._suppressEditorBlur = true
    try {
      runCleanupSteps([
        updateState,
        () => this._withPopupSyncSuppressed(() => this._clearQuery()),
        () => this._popup.close(),
        () => {
          if (typeof window === 'undefined') this._input.focusOut()
          else FocusManager.instance.clearFocusOf(this._input)
        },
        () => this._input.clearChipPointerState(),
        () => {
          if (wasFocused) this._valueEditorEvents.emitBlur()
        },
      ])
    } finally {
      this._suppressEditorBlur = wasSuppressingBlur
    }
  }

  private _normalizeValues(values: readonly string[]): string[] {
    const known = new Set(this._options.map(option => option.value))
    const normalized: string[] = []
    const seen = new Set<string>()
    for (const candidate of values) {
      const value = String(candidate).trim()
      if (!value || seen.has(value)) continue
      if (!this._allowCustomTokens && !known.has(value)) continue
      seen.add(value)
      normalized.push(value)
    }
    return normalized
  }

  private _resolveToken(value: string): TokenEditToken {
    const option = this._options.find(candidate => candidate.value === value)
    return {
      value,
      label: option?.label ?? value,
    }
  }

  private _emitChange(
    reason: TokenEditValueChangeReason,
    previousValue: string[],
  ): void {
    const values = this.values
    const tokens = this.tokens
    runCleanupSteps([
      () => this._onChange?.(values, tokens),
      () => this._valueEditorEvents.emitValueChange({
        value: values,
        previousValue,
        reason,
        detail: tokens,
      }),
    ])
  }

  private _emitReconciledValueChange(
    reason: Extract<
      TokenEditValueChangeReason,
      'options-reconcile' | 'mode-reconcile'
    >,
    previousValue: string[],
  ): void {
    this._valueEditorEvents.emitValueChange({
      value: this.values,
      previousValue,
      reason,
      detail: this.tokens,
      userInitiated: false,
    })
  }

  private _refreshInputGeometry(): void {
    this._syncPlaceholder()
    this._input.clearChipPointerState()
    this._input.markNeedsLayout()
    this._input.markNeedsPaint()
  }

  private _syncPlaceholder(): void {
    this._input.placeholder = this._values.length > 0 ? '' : this._placeholder
  }

  private _helperHeight(): number {
    const input = deriveTextInputStyle(this._input.resolvedTheme)
    return input.helperGap + input.helperLineHeight
  }
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index])
}
