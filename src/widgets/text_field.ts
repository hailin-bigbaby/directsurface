// TextBox: ImGui 风格文本输入框
// 支持光标定位、文字选中、鼠标拖选、键盘导航、IME

import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { paintSingleLineEditableText } from '../rendering/single_line_text_renderer'
import type { BoxConstraints, LayoutContext, Offset, Rect } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import { runCleanupSteps } from '../core/disposable'
import { TextMeasurer } from '../core/text_measurer'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import type { GestureArenaMember } from '../gestures/gesture_arena'
import { PendingPointerGesture } from '../gestures/pending_pointer_gesture'
import {
  pointerKey,
  resolvePointerIdentity,
  type PointerIdentity,
} from '../gestures/pointer_identity'
import { FocusManager, type Focusable } from '../core/focus_manager'
import {
  resolveSingleLineEditableTextLayout,
  SingleLineTextInput,
} from '../core/single_line_text_input'
import { TextEditSession } from '../core/text_edit_session'
import { TextInputController } from '../core/text_input_controller'
import {
  deriveButtonStyle,
  deriveTextInputStyle,
  resolveBgColor,
  resolveTextColor,
  type TextInputStyleTokens,
} from '../theme/component_styles'
import {
  layoutFormFieldInlineContent,
  measureFormFieldHeight,
  paintFormFieldInlineDecorations,
  paintFormFieldShell,
  pointInFormFieldRect,
  resolveFormFieldPlaceholderColor,
  resolveFormFieldTextColor,
  type FormFieldRect,
  type FormFieldStatus,
} from './form_field_shell'
import { paintIconGlyph, type IconName } from './icon'
import { TooltipService } from './tooltip'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorBlurListener,
  type ValueEditorValueChangeListener,
} from './value_editor'

const DRAG_SLOP = 4
const EDIT_HISTORY_LIMIT = 100

function isImeCompositionKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

export type TextBoxEditSource = 'input' | 'composition' | 'paste' | 'keyboard'
export type TextBoxValueChangeReason = TextBoxEditSource | 'undo' | 'redo' | 'clear'
export type TextBoxGuideVisibility = 'always' | 'focused'

export interface TextBoxEditContext {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
  readonly previousSelectionStart: number
  readonly previousSelectionEnd: number
  readonly source: TextBoxEditSource
}

export interface TextBoxEditResult {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
}

export interface TextBoxInputAdapter {
  transform(value: string, context: TextBoxEditContext): TextBoxEditResult
  handleKeyDown?(event: KeyboardEvent, context: TextBoxEditContext): TextBoxEditResult | undefined
}

export interface TextBoxAction {
  readonly key?: string
  readonly label?: string
  readonly icon?: IconName
  readonly tooltip?: string
  readonly disabled?: boolean
  readonly width?: number
  readonly onClick?: () => void
}

interface TextBoxEditSnapshot {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
}

interface AppliedTextBoxEdit extends TextBoxEditResult {
  readonly changed: boolean
  readonly previousValue: string
}

type TextBoxPointerIntent = 'none' | 'selection' | 'action' | 'clear'

export class RenderTextBox extends RenderBox implements
  InteractiveRenderObject,
  Focusable,
  GestureArenaMember,
  ValueEditor<string, TextBoxValueChangeReason, undefined> {
  static override debugTypeName = 'RenderTextBox'
  readonly preventsPointerActivationOnAccept = true
  private _value: string
  placeholder: string
  onChange?: (value: string) => void
  onSubmit?: (value: string) => void
  onBlur?: (value: string) => void
  onKeyDown?: (event: KeyboardEvent) => boolean | void
  password: boolean
  private _readonly: boolean
  private _disabled: boolean
  private _status: FormFieldStatus
  private _helperText: string
  private _prefixText: string
  private _suffixText: string
  private _clearable: boolean
  private _maxLength: number | null
  private _trailingIcon: IconName | null
  private _onTrailingIconClick?: () => void
  private _actions: readonly TextBoxAction[]
  private _inputAdapter?: TextBoxInputAdapter
  private _fieldHeightOverride?: number
  private _guideText: string
  private _guideVisibility: TextBoxGuideVisibility

  private _focused = false
  private _hovered = false
  private _hoveredActionIndex = -1
  private _pressedActionIndex = -1
  private _activeActionIndex = -1
  private _pressedClearButton = false
  private _pointerIntent: TextBoxPointerIntent = 'none'
  private _affordancePointer?: PointerIdentity
  private _focusRegistered = false
  private _textInput = new TextInputController({ onInvalidate: () => this._invalidateCaret() })
  private _singleLineInput = new SingleLineTextInput({
    controller: this._textInput,
    getDisplayText: () => this.password ? '•'.repeat(this.value.length) : this.value,
    measureText: text => this._measureText(text),
    getViewportWidth: () => this._inlineLayout().valueRect.w,
    getTextOrigin: () => {
      const textRect = this._inlineLayout()
      return {
        x: textRect.valueRect.x,
        y: textRect.valueRect.y,
      }
    },
  })
  private _editSession = new TextEditSession({
    controller: this._textInput,
    isActive: () => this._focused,
    syncSelectionFromComposer: opts => this._textInput.syncSelectionFromComposer(opts),
    scrollToCursor: () => this._singleLineInput.scrollToCursor(),
    updateComposerPosition: () => this._singleLineInput.updateComposerPosition(),
    invalidate: () => {
      this.markNeedsPaint()
      this._invalidateCaret()
    },
  })
  private _dragging = false     // 鼠标按下拖选中
  private readonly _pendingGesture = new PendingPointerGesture()
  private _dragStartPosition?: Offset
  private _lastDragPosition?: Offset
  private _lastCaretDirtyRect?: Rect
  private _applyingEditorValue = false
  private _undoHistory: TextBoxEditSnapshot[] = []
  private _redoHistory: TextBoxEditSnapshot[] = []
  private _compositionHistoryStart?: TextBoxEditSnapshot
  private readonly _valueEditorEvents =
    new ValueEditorEventEmitter<string, TextBoxValueChangeReason, undefined>()

  constructor(opts: RenderBoxOptions & {
    value?: string
    placeholder?: string
    onChange?: (value: string) => void
    onSubmit?: (value: string) => void
    onBlur?: (value: string) => void
    onKeyDown?: (event: KeyboardEvent) => boolean | void
    password?: boolean
    readonly?: boolean
    disabled?: boolean
    status?: FormFieldStatus
    helperText?: string
    prefixText?: string
    suffixText?: string
    clearable?: boolean
    maxLength?: number
    trailingIcon?: IconName
    onTrailingIconClick?: () => void
    actions?: readonly TextBoxAction[]
    inputAdapter?: TextBoxInputAdapter
    fieldHeight?: number
    guideText?: string
    guideVisibility?: TextBoxGuideVisibility
  }) {
    super(opts)
    this._maxLength = normalizeMaxLength(opts.maxLength)
    this._value = normalizeTextLength(opts.value ?? '', this._maxLength)
    this.placeholder = opts.placeholder ?? ''
    this.onChange = opts.onChange
    this.onSubmit = opts.onSubmit
    this.onBlur = opts.onBlur
    this.onKeyDown = opts.onKeyDown
    this.password = opts.password ?? false
    this._readonly = opts.readonly ?? false
    this._disabled = opts.disabled ?? false
    this._status = opts.status ?? 'default'
    this._helperText = opts.helperText ?? ''
    this._prefixText = opts.prefixText ?? ''
    this._suffixText = opts.suffixText ?? ''
    this._clearable = opts.clearable ?? false
    this._trailingIcon = opts.trailingIcon ?? null
    this._onTrailingIconClick = opts.onTrailingIconClick
    this._actions = opts.actions ? [...opts.actions] : []
    this._inputAdapter = opts.inputAdapter
    this._fieldHeightOverride = opts.fieldHeight
    this._guideText = opts.guideText ?? ''
    this._guideVisibility = opts.guideVisibility ?? 'always'
    this._syncFocusRegistration()
  }

  shouldIgnoreKeyDown(event: KeyboardEvent): boolean {
    return isImeCompositionKey(event) || this._textInput.composing
  }

  get value(): string { return this._value }
  set value(value: string) {
    value = normalizeTextLength(value, this._maxLength)
    if (!this._applyingEditorValue) this._clearEditHistory()
    if (this._value === value) return
    this._value = value
    if (this._focused) {
      this._textInput.clampSelection(this._value.length)
      if (this._textInput.hasSession && this._textInput.composerValue !== value) {
        this._textInput.setComposerValue(value)
      }
    }
    this.markNeedsPaint()
  }

  get disabled(): boolean { return this._disabled }
  set disabled(disabled: boolean) {
    if (this._disabled === disabled) return
    this._disabled = disabled
    runCleanupSteps([
      () => {
        if (!disabled) return
        this._hovered = false
        this._clearActionInteraction()
        if (this._focused) this._blur()
        else this._resetPointerInteraction()
      },
      () => this._syncFocusRegistration(),
      () => this.markNeedsPaint(),
    ])
  }

  get readonly(): boolean { return this._readonly }
  set readonly(readonly: boolean) {
    if (this._readonly === readonly) return
    this._readonly = readonly
    if (readonly && this._focused) {
      this._compositionHistoryStart = undefined
      this._clearActionInteraction()
      this._dragging = false
      this._pendingGesture.resolveTerminal(
        'rejected',
        () => {
          this._pointerIntent = 'none'
          this._affordancePointer = undefined
          this._dragStartPosition = undefined
          this._lastDragPosition = undefined
        },
        () => this._textInput.clearComposition(),
        () => {
          if (this._textInput.hasSession && this._textInput.composerValue !== this.value) {
            this._textInput.setComposerValue(this.value)
          }
        },
      )
    }
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

  get maxLength(): number | null { return this._maxLength }
  set maxLength(maxLength: number | null) {
    const next = normalizeMaxLength(maxLength ?? undefined)
    if (this._maxLength === next) return
    this._maxLength = next
    this.value = this._value
    this.markNeedsPaint()
  }

  get trailingIcon(): IconName | null { return this._trailingIcon }
  set trailingIcon(trailingIcon: IconName | null) {
    if (this._trailingIcon === trailingIcon) return
    this._resetPointerInteraction()
    this._clearActionInteraction()
    this._trailingIcon = trailingIcon
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get onTrailingIconClick(): (() => void) | undefined { return this._onTrailingIconClick }
  set onTrailingIconClick(onTrailingIconClick: (() => void) | undefined) {
    this._onTrailingIconClick = onTrailingIconClick
  }

  get actions(): readonly TextBoxAction[] { return this._actions }
  set actions(actions: readonly TextBoxAction[]) {
    if (this._actions === actions) return
    this._resetPointerInteraction()
    this._clearActionInteraction()
    this._actions = [...actions]
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get inputAdapter(): TextBoxInputAdapter | undefined { return this._inputAdapter }
  set inputAdapter(inputAdapter: TextBoxInputAdapter | undefined) {
    if (this._inputAdapter === inputAdapter) return
    this._inputAdapter = inputAdapter
    this._clearEditHistory()
  }

  get fieldHeight(): number | undefined { return this._fieldHeightOverride }
  set fieldHeight(fieldHeight: number | undefined) {
    if (this._fieldHeightOverride === fieldHeight) return
    this._fieldHeightOverride = fieldHeight
    this.markNeedsLayout()
  }

  get guideText(): string { return this._guideText }
  set guideText(guideText: string) {
    if (this._guideText === guideText) return
    this._guideText = guideText
    this.markNeedsPaint()
  }

  get guideVisibility(): TextBoxGuideVisibility { return this._guideVisibility }
  set guideVisibility(guideVisibility: TextBoxGuideVisibility) {
    if (this._guideVisibility === guideVisibility) return
    this._guideVisibility = guideVisibility
    this.markNeedsPaint()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  get isFocused(): boolean { return this._focused }
  focusIn(): void { this._focus() }
  focusOut(): void { this._blur() }

  getValue(): string { return this.value }
  setValue(value: string): void { this.value = value }
  subscribeValueChange(
    listener: ValueEditorValueChangeListener<string, TextBoxValueChangeReason, undefined>,
  ): () => void {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }
  subscribeBlur(listener: ValueEditorBlurListener): () => void {
    return this._valueEditorEvents.subscribeBlur(listener)
  }
  requestFocus(): void {
    if (typeof window === 'undefined') return
    FocusManager.instance.setFocus(this)
  }
  blur(): void {
    if (typeof window === 'undefined') return
    FocusManager.instance.clearFocusOf(this)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveTextInputStyle(context.theme)
    const fieldHeight = this._fieldHeight(style)
    this.size = {
      width: constraints.maxWidth === Infinity ? 200 : constraints.maxWidth,
      height: measureFormFieldHeight(style, fieldHeight, this.helperText),
    }
    if (this._focused) {
      this._singleLineInput.scrollToCursor()
      this._singleLineInput.updateComposerPosition()
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w, height: h } = this.size
    const s = deriveTextInputStyle(context.theme)
    const fieldHeight = this._fieldHeight(s)
    paintFormFieldShell(context, offset, w, fieldHeight, {
      focused: this._focused,
      hovered: this._hovered,
      disabled: this.disabled,
      status: this.status,
      helperText: this.helperText,
    })
    const layout = this._inlineLayout(offset)
    this._paintClearButtonState(context, layout.clearRect)
    paintFormFieldInlineDecorations(context, layout, {
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      showClearButton: this._showClearButton(),
      disabled: this.disabled,
    })
    this.paintLeadingContent(context, layout.leadingRect)
    this._paintActions(context, layout.trailingRect)

    dl.pushClip(layout.valueRect.x, y + 2, layout.valueRect.w, fieldHeight - 4)

    const displayValue = this.password ? '•'.repeat(this.value.length) : this.value
    const textX = layout.valueRect.x - this._textInput.scrollX
    const guideText = this._visibleGuideText()
    paintSingleLineEditableText({
      dl,
      controller: this._textInput,
      displayText: displayValue,
      measureText: text => this._measureText(text),
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      textX,
      textY: layout.valueRect.y + layout.valueRect.h / 2,
      lineTop: y + 4,
      lineBottom: y + fieldHeight - 4,
      textColor: resolveFormFieldTextColor(s, this.disabled),
      selectionBg: s.selectionBg,
      caretColor: s.caretColor,
      compositionTextColor: s.compositionText,
      compositionUnderlineColor: s.focusedBorder,
      placeholder: displayValue.length === 0 && guideText.length === 0 ? this.placeholder : undefined,
      placeholderColor: resolveFormFieldPlaceholderColor(s, this.disabled),
      showSelection: this._focused && !this.disabled,
      showCaret: false,
    })
    if (guideText.length > 0 && !this._textInput.composing) {
      dl.fillText(
        guideText,
        textX + this._measureText(displayValue),
        layout.valueRect.y + layout.valueRect.h / 2,
        resolveFormFieldPlaceholderColor(s, this.disabled),
        s.fontSize,
        s.fontFamily,
        'left',
        'middle',
      )
    }

    dl.popClip()
  }

  override performTransientPaint(context: PaintContext, offset: Offset): void {
    if (!this._focused || this.disabled || !this._textInput.cursorVisible) return
    const dl = new DrawList(context)
    const s = deriveTextInputStyle(context.theme)
    const fieldHeight = this._fieldHeight(s)
    const layout = this._inlineLayout(offset)
    const displayValue = this.password ? '•'.repeat(this.value.length) : this.value
    const textX = layout.valueRect.x - this._textInput.scrollX
    const caretX = textX + this._caretPrefixWidth(displayValue)
    dl.pushClip(layout.valueRect.x, offset.y + 2, layout.valueRect.w, fieldHeight - 4)
    dl.line(caretX, offset.y + 4, caretX, offset.y + fieldHeight - 4, s.caretColor, 1.5)
    dl.popClip()
  }

  private _measureText(text: string): number {
    const style = this._inputStyle()
    return TextMeasurer.measureWidth(text, style.fontSize, style.fontFamily)
  }

  private _visibleGuideText(): string {
    if (this.password || this._guideText.length === 0) return ''
    if (this._guideVisibility === 'focused' && !this._focused) return ''
    return this._guideText
  }

  private _caretPrefixWidth(displayValue: string): number {
    return resolveSingleLineEditableTextLayout({
      controller: this._textInput,
      displayText: displayValue,
      measureText: text => this._measureText(text),
    }).caretOffset
  }

  private _caretDirtyRect(): Rect {
    const style = this._inputStyle()
    const fieldHeight = this._fieldHeight(style)
    const layout = this._inlineLayout()
    const displayValue = this.password ? '•'.repeat(this.value.length) : this.value
    const caretX = layout.valueRect.x - this._textInput.scrollX + this._caretPrefixWidth(displayValue)
    return {
      x: Math.floor(caretX - 3),
      y: Math.floor(this.globalOffset.y + 2),
      width: 8,
      height: Math.ceil(fieldHeight),
    }
  }

  private _invalidateCaret(): void {
    if (!this._focused || this.disabled) return
    const next = this._caretDirtyRect()
    this.markNeedsTransientPaint(this._lastCaretDirtyRect ? unionRect(this._lastCaretDirtyRect, next) : next)
    this._lastCaretDirtyRect = next
  }

  protected _inlineLayout(offset: Offset = this.globalOffset) {
    const style = this._inputStyle()
    const fieldHeight = this._fieldHeight(style)
    return layoutFormFieldInlineContent(style, offset, this.size.width, fieldHeight, {
      reserveLeadingWidth: this.leadingContentWidth(style, fieldHeight),
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      showClearButton: this._showClearButton(),
      reserveTrailingWidth: this._actionsWidth(style, fieldHeight),
    })
  }

  protected leadingContentWidth(_style: TextInputStyleTokens, _fieldHeight: number): number {
    return 0
  }

  protected paintLeadingContent(_context: PaintContext, _rect: FormFieldRect | null): void {}

  private _showClearButton(): boolean {
    return this.clearable && !this.disabled && !this.readonly && this.value.length > 0
  }

  private _hasActions(): boolean {
    return this._actionCount() > 0
  }

  private _actionCount(): number {
    return this._actions.length + (this._trailingIcon ? 1 : 0)
  }

  private _actionAt(index: number): TextBoxAction | undefined {
    if (index >= 0 && index < this._actions.length) return this._actions[index]
    if (index === this._actions.length && this._trailingIcon) {
      return {
        key: '__legacy-trailing-icon__',
        icon: this._trailingIcon,
        onClick: this._onTrailingIconClick,
      }
    }
    return undefined
  }

  private _actionWidth(action: TextBoxAction, style: TextInputStyleTokens, fieldHeight: number): number {
    if (typeof action.width === 'number' && Number.isFinite(action.width)) {
      return Math.max(0, action.width)
    }
    const iconSize = action.icon ? Math.max(style.fontSize, fieldHeight - style.padding * 2) : 0
    const labelWidth = action.label
      ? TextMeasurer.measureWidth(action.label, style.fontSize, style.fontFamily)
      : 0
    const gap = action.icon && action.label ? Math.max(3, Math.round(style.itemSpacing * 0.6)) : 0
    if (!action.label) return Math.max(iconSize, style.fontSize)
    return Math.max(style.fontSize, iconSize + gap + labelWidth + Math.max(8, style.padding))
  }

  private _actionsWidth(style: TextInputStyleTokens, fieldHeight: number): number {
    let width = 0
    for (let index = 0; index < this._actionCount(); index += 1) {
      const action = this._actionAt(index)
      if (action) width += this._actionWidth(action, style, fieldHeight)
    }
    return width
  }

  private _actionRects(offset: Offset = this.globalOffset): FormFieldRect[] {
    const style = this._inputStyle()
    const fieldHeight = this._fieldHeight(style)
    const trailingRect = this._inlineLayout(offset).trailingRect
    if (!trailingRect) return []
    return this._actionRectsFromTrailingRect(trailingRect, style, fieldHeight)
  }

  private _actionRectsFromTrailingRect(
    trailingRect: FormFieldRect,
    style: TextInputStyleTokens,
    fieldHeight: number,
  ): FormFieldRect[] {
    const rects: FormFieldRect[] = []
    let x = trailingRect.x
    for (let index = 0; index < this._actionCount(); index += 1) {
      const action = this._actionAt(index)
      if (!action) continue
      const width = this._actionWidth(action, style, fieldHeight)
      rects.push({ x, y: trailingRect.y, w: width, h: trailingRect.h })
      x += width
    }
    return rects
  }

  private _actionIndexAt(position: Offset): number {
    const rects = this._actionRects()
    for (const [index, rect] of rects.entries()) {
      if (pointInFormFieldRect(rect, position)) return index
    }
    return -1
  }

  private _paintActions(context: PaintContext, trailingRect: FormFieldRect | null): void {
    if (!trailingRect || !this._hasActions()) return
    const dl = new DrawList(context)
    const inputStyle = deriveTextInputStyle(context.theme)
    const buttonStyle = deriveButtonStyle(context.theme, 'text')
    const rects = this._actionRectsFromTrailingRect(
      trailingRect,
      inputStyle,
      this._fieldHeight(inputStyle),
    )
    for (const [index, rect] of rects.entries()) {
      const action = this._actionAt(index)
      if (!action) continue
      if (this._isLegacyActionIndex(index)) {
        const color = this.disabled
          ? inputStyle.textDisabled
          : this._pressedActionIndex === index || this._hoveredActionIndex === index
            ? inputStyle.text
            : inputStyle.placeholderText
        if (action.icon) {
          paintIconGlyph(context, {
            name: action.icon,
            x: rect.x + Math.max(0, (rect.w - rect.h) / 2),
            y: rect.y,
            size: rect.h,
            color,
          })
        }
        continue
      }
      const disabled = this.disabled || action.disabled
      const state = disabled
        ? 'disabled'
        : this._pressedActionIndex === index
          ? 'pressed'
          : this._hoveredActionIndex === index
            ? 'hovered'
            : 'normal'
      const background = resolveBgColor(buttonStyle, state)
      if (background.a > 0) dl.fillRect(rect.x, rect.y, rect.w, rect.h, background, inputStyle.borderRadius)
      const color = resolveTextColor(buttonStyle, disabled ? 'disabled' : 'normal')
      const iconSize = action.icon ? Math.min(rect.h, inputStyle.fontSize + 2) : 0
      const labelWidth = action.label
        ? TextMeasurer.measureWidth(action.label, inputStyle.fontSize, inputStyle.fontFamily)
        : 0
      const gap = action.icon && action.label ? Math.max(3, Math.round(inputStyle.itemSpacing * 0.6)) : 0
      const contentWidth = iconSize + gap + labelWidth
      let contentX = rect.x + Math.max(0, (rect.w - contentWidth) / 2)
      if (action.icon) {
        paintIconGlyph(context, {
          name: action.icon,
          x: contentX,
          y: rect.y + (rect.h - iconSize) / 2,
          size: iconSize,
          color,
        })
        contentX += iconSize + gap
      }
      if (action.label) {
        dl.fillText(
          action.label,
          contentX,
          rect.y + rect.h / 2,
          color,
          inputStyle.fontSize,
          inputStyle.fontFamily,
          'left',
          'middle',
        )
      }
    }
  }

  private _paintClearButtonState(context: PaintContext, clearRect: FormFieldRect | null): void {
    if (!clearRect || !this._pressedClearButton) return
    const style = deriveTextInputStyle(context.theme)
    const buttonStyle = deriveButtonStyle(context.theme, 'text')
    const background = resolveBgColor(buttonStyle, 'pressed')
    if (background.a <= 0) return
    new DrawList(context).fillRect(
      clearRect.x,
      clearRect.y,
      clearRect.w,
      clearRect.h,
      background,
      style.borderRadius,
    )
  }

  private _isLegacyActionIndex(index: number): boolean {
    return !!this._trailingIcon && index === this._actions.length
  }

  private _inputStyle(): TextInputStyleTokens {
    return deriveTextInputStyle(this.currentTheme)
  }

  private _fieldHeight(style: TextInputStyleTokens): number {
    return this._fieldHeightOverride ?? style.height
  }

  private _syncFocusRegistration(): void {
    if (typeof window === 'undefined') return
    if (this.disabled) {
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

  private _applyEditorValue(
    value: string,
    selectionStart: number,
    selectionEnd: number,
    source: TextBoxEditSource,
    historyBefore: TextBoxEditSnapshot = this._editSnapshot(),
  ): AppliedTextBoxEdit {
    const context: TextBoxEditContext = {
      value: this.value,
      selectionStart,
      selectionEnd,
      previousSelectionStart: historyBefore.selectionStart,
      previousSelectionEnd: historyBefore.selectionEnd,
      source,
    }
    const adapted = this._inputAdapter?.transform(value, context) ?? {
      value,
      selectionStart,
      selectionEnd,
    }
    return this._setEditorResult(adapted, historyBefore)
  }

  private _setEditorResult(
    result: TextBoxEditResult,
    historyBefore?: TextBoxEditSnapshot,
    recordHistory = true,
  ): AppliedTextBoxEdit {
    const previousValue = this.value
    const value = normalizeTextLength(result.value, this.maxLength)
    const selectionStart = clampTextIndex(result.selectionStart, value.length)
    const selectionEnd = clampTextIndex(result.selectionEnd, value.length)
    this._applyingEditorValue = true
    try {
      this.value = value
    } finally {
      this._applyingEditorValue = false
    }
    if (this._focused) {
      if (this._textInput.composerValue !== value) this._textInput.setComposerValue(value)
      this._textInput.setSelection(selectionStart, selectionEnd, {
        cursorPos: selectionEnd,
        syncComposer: true,
      })
    }
    const changed = previousValue !== value
    if (changed && recordHistory && this._inputAdapter && historyBefore) {
      this._recordHistory(historyBefore)
    }
    return { value, selectionStart, selectionEnd, changed, previousValue }
  }

  private _handleAdapterKeyDown(event: KeyboardEvent): boolean {
    if (!this._inputAdapter?.handleKeyDown || this.readonly || this._textInput.composing) return false
    this._textInput.syncSelectionFromComposer({ ignoreComposing: true })
    const historyBefore = this._editSnapshot()
    const context: TextBoxEditContext = {
      value: this.value,
      selectionStart: this._textInput.selStart,
      selectionEnd: this._textInput.selEnd,
      previousSelectionStart: historyBefore.selectionStart,
      previousSelectionEnd: historyBefore.selectionEnd,
      source: 'keyboard',
    }
    const result = this._inputAdapter.handleKeyDown(event, context)
    if (!result) return false
    event.preventDefault()
    const applied = this._setEditorResult(result, historyBefore)
    this._publishUserValueChange(applied, 'keyboard')
    return true
  }

  private _handleHistoryKeyDown(event: KeyboardEvent): boolean {
    if (!this._inputAdapter || this.readonly || this._textInput.composing) return false
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return false
    const key = event.key.toLowerCase()
    const redo = (key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey)
    const undo = key === 'z' && !event.shiftKey
    if (!undo && !redo) return false

    event.preventDefault()
    this._textInput.syncSelectionFromComposer({ ignoreComposing: true })
    const source = redo ? this._redoHistory : this._undoHistory
    const target = source.pop()
    if (!target) return true

    const current = this._editSnapshot()
    this._pushHistorySnapshot(redo ? this._undoHistory : this._redoHistory, current)
    const applied = this._setEditorResult(target, undefined, false)
    this._publishUserValueChange(applied, redo ? 'redo' : 'undo')
    return true
  }

  private _editSnapshot(): TextBoxEditSnapshot {
    return {
      value: this.value,
      selectionStart: this._focused ? this._textInput.selStart : this.value.length,
      selectionEnd: this._focused ? this._textInput.selEnd : this.value.length,
    }
  }

  private _recordHistory(snapshot: TextBoxEditSnapshot): void {
    this._pushHistorySnapshot(this._undoHistory, snapshot)
    this._redoHistory = []
  }

  private _pushHistorySnapshot(
    history: TextBoxEditSnapshot[],
    snapshot: TextBoxEditSnapshot,
  ): void {
    const previous = history[history.length - 1]
    if (previous && sameEditSnapshot(previous, snapshot)) return
    history.push(snapshot)
    if (history.length > EDIT_HISTORY_LIMIT) history.splice(0, history.length - EDIT_HISTORY_LIMIT)
  }

  private _clearEditHistory(): void {
    this._undoHistory = []
    this._redoHistory = []
    this._compositionHistoryStart = undefined
  }

  // ---- 焦点管理 ----

  private _focus(): void {
    if (this.disabled) return
    if (this._focused) return
    this._focused = true
    this._textInput.setScrollX(0)
    this._editSession.start({
      initialValue: this.value,
      initialSelection: {
        start: this.value.length,
        end: this.value.length,
        cursorPos: this.value.length,
      },
      refreshOnStart: true,
      onInput: (value, session) => {
        if (this.readonly) {
          this._textInput.setComposerValue(this.value)
          this._textInput.setSelection(this._textInput.cursorPos, this._textInput.cursorPos, {
            cursorPos: this._textInput.cursorPos,
            syncComposer: true,
          })
          return
        }
        const historyBefore = this._editSnapshot()
        this._textInput.syncSelectionFromComposer()
        const applied = this._applyEditorValue(
          value,
          this._textInput.selStart,
          this._textInput.selEnd,
          'input',
          historyBefore,
        )
        this._publishUserValueChange(applied, 'input')
        session.refresh({ syncSelectionFromComposer: false })
      },
      onCompositionStart: () => {
        this._compositionHistoryStart = this._inputAdapter && !this.readonly
          ? this._editSnapshot()
          : undefined
      },
      onCompositionUpdate: (_text, session) => {
        if (this.readonly) return
        session.refresh({ resetBlink: true })
      },
      onCompositionEnd: (value, session) => {
        if (this.readonly) {
          this._textInput.clearComposition()
          this._textInput.setComposerValue(this.value)
          this._compositionHistoryStart = undefined
          return
        }
        this._textInput.syncSelectionFromComposer()
        const applied = this._applyEditorValue(
          value,
          this._textInput.selStart,
          this._textInput.selEnd,
          'composition',
          this._compositionHistoryStart ?? this._editSnapshot(),
        )
        this._compositionHistoryStart = undefined
        this._publishUserValueChange(applied, 'composition')
        session.refresh({ syncSelectionFromComposer: false })
      },
      onPaste: (event, session) => {
        if (this.readonly) return
        const text = this._clipboardText(event)
        if (text.length === 0) return
        event.preventDefault()
        this._textInput.syncSelectionFromComposer()
        const applied = this._replaceSelectionWithText(text, 'paste')
        this._publishUserValueChange(applied, 'paste')
        session.refresh({
          syncSelectionFromComposer: false,
          scrollToCursor: true,
          updateComposerPosition: true,
          resetBlink: true,
        })
      },
      onKeyDown: (e, session) => {
        if (isImeCompositionKey(e) || this._textInput.composing) {
          return
        }
        if (this._handleHistoryKeyDown(e)) {
          session.refresh({ syncSelectionFromComposer: false, resetBlink: true })
        } else if (this._handleAdapterKeyDown(e)) {
          session.refresh({ syncSelectionFromComposer: false, resetBlink: true })
        } else if (e.key === 'Enter') {
          e.preventDefault()
          if (!this.readonly) this.onSubmit?.(this.value)
          if (this.shouldBlurOnSubmit()) {
            FocusManager.instance.clearFocusOf(this)
          } else {
            session.refresh({
              syncSelectionFromComposer: true,
              scrollToCursor: true,
              updateComposerPosition: true,
              resetBlink: true,
            })
          }
          if (!this.onSubmit) FocusManager.instance.dispatchUnhandledEnterFrom(this, e)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          FocusManager.instance.clearFocusOf(this)
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
          session.defer(() => {}, {
            syncSelectionFromComposer: true,
            scrollToCursor: false,
            updateComposerPosition: false,
          })
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
          session.defer(() => {}, { syncSelectionFromComposer: true })
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
          this._textInput.syncSelectionFromComposer({ ignoreComposing: true })
          const historyBefore = this._editSnapshot()
          session.defer(() => {
            if (!this.readonly) {
              this._textInput.syncSelectionFromComposer()
              const applied = this._applyEditorValue(
                this._textInput.composerValue,
                this._textInput.selStart,
                this._textInput.selEnd,
                'keyboard',
                historyBefore,
              )
              this._publishUserValueChange(applied, 'keyboard')
            }
          }, { syncSelectionFromComposer: false })
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
          session.defer(() => {
            if (!this.readonly) {
              this._textInput.syncSelectionFromComposer()
              const applied = this._applyEditorValue(
                this._textInput.composerValue,
                this._textInput.selStart,
                this._textInput.selEnd,
                'keyboard',
              )
              this._publishUserValueChange(applied, 'undo')
            }
          }, { syncSelectionFromComposer: false })
        } else {
          session.defer(() => {}, { syncSelectionFromComposer: true })
        }
      },
    })
    this.markNeedsPaint()
    this._invalidateCaret()
  }

  protected shouldBlurOnSubmit(): boolean {
    return true
  }

  private _blur(): void {
    if (!this._focused) return
    this._focused = false
    this._compositionHistoryStart = undefined
    this._clearActionInteraction()
    this._dragging = false
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => {
        this._pointerIntent = 'none'
        this._affordancePointer = undefined
        this._dragStartPosition = undefined
        this._lastDragPosition = undefined
      },
      () => this._invalidateCaret(),
      () => this._textInput.clearComposition(),
      () => this._textInput.setScrollX(0),
      () => this._editSession.end(),
      () => this.onBlur?.(this.value),
      () => this._valueEditorEvents.emitBlur(),
      () => this.markNeedsPaint(),
    )
  }

  private _replaceSelectionWithText(
    text: string,
    source: TextBoxEditSource = 'keyboard',
  ): AppliedTextBoxEdit {
    const start = this._textInput.selStart
    const end = this._textInput.selEnd
    const normalizedText = text.replace(/\r\n?/g, '\n').replace(/\n/g, ' ')
    const prefix = this.value.slice(0, start)
    const suffix = this.value.slice(end)
    const nextValue = prefix + normalizedText + suffix
    const cursorPos = prefix.length + normalizedText.length
    return this._applyEditorValue(nextValue, cursorPos, cursorPos, source)
  }

  private _clipboardText(event: ClipboardEvent): string {
    return event.clipboardData?.getData('text/plain')
      ?? event.clipboardData?.getData('text')
      ?? ''
  }

  // ---- 指针事件 ----

  onPointerDown(e: PointerEvent): void {
    if (this._affordancePointer && !this._ownsAffordancePointer(e)) {
      e.preventActivation?.()
      return
    }
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) {
      e.preventActivation?.()
      return
    }
    if (!isPrimaryPointerButton(e)) return
    if (this.disabled || !this._hitField(e.position)) return
    const layout = this._inlineLayout()
    if (pointInFormFieldRect(layout.clearRect, e.position)) {
      e.preventActivation?.()
      FocusManager.instance.setFocus(this)
      this._editSession.focusComposer()
      this._beginAffordanceGesture(e, 'clear')
      return
    }
    const actionIndex = this._actionIndexAt(e.position)
    if (actionIndex >= 0) {
      const action = this._actionAt(actionIndex)
      if (!action) return
      e.preventActivation?.()
      this._hoveredActionIndex = actionIndex
      if (!action.disabled) {
        FocusManager.instance.setFocus(this)
        this._editSession.focusComposer()
        this._beginAffordanceGesture(e, 'action', actionIndex)
      }
      this.markNeedsPaint()
      return
    }
    FocusManager.instance.setFocus(this)
    this._editSession.focusComposer()

    const charIdx = this._singleLineInput.hitCharIndexFromGlobal(e.position.x)
    this._textInput.setSelection(charIdx, charIdx, { cursorPos: charIdx, syncComposer: false })
    this._pointerIntent = 'selection'
    if (e.joinGestureArena) {
      this._resetPendingGesture()
      this._dragStartPosition = e.position
      this._lastDragPosition = e.position
      this._pendingGesture.begin(e, this)
      this._dragging = false
    } else {
      this._dragging = true
    }
    this._textInput.setSelection(charIdx, charIdx, { cursorPos: charIdx, syncComposer: true })
    this._editSession.refresh({ resetBlink: true })
  }

  onDoubleClick(position: Offset): void {
    if (this.disabled || !this._hitField(position)) return
    const layout = this._inlineLayout()
    if (pointInFormFieldRect(layout.clearRect, position)) return
    if (this._actionIndexAt(position) >= 0) return

    FocusManager.instance.setFocus(this)
    this._editSession.focusComposer()
    this._resetPointerInteraction()
    const range = this._singleLineInput.selectWordFromGlobal(position.x, {
      syncComposer: true,
      text: this.value,
    })
    if (!range) return
    this._editSession.refresh({
      scrollToCursor: false,
      updateComposerPosition: true,
      resetBlink: true,
    })
    this.markNeedsPaint()
  }

  onPointerMove(e: PointerEvent): void {
    if (this._affordancePointer && !this._ownsAffordancePointer(e)) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    const wasHovered = this._hovered
    this._hovered = !this.disabled && this._hitField(e.position)
    const hoveredActionIndex = !this.disabled ? this._actionIndexAt(e.position) : -1
    const actionHoverChanged = hoveredActionIndex !== this._hoveredActionIndex
    if (actionHoverChanged) this._updateActionHover(hoveredActionIndex, e.position)
    else if (hoveredActionIndex >= 0 && this._actionAt(hoveredActionIndex)?.tooltip) {
      TooltipService.currentOrNull?.updatePos(e.position)
    }
    if (this._hovered !== wasHovered || actionHoverChanged) {
      this.markNeedsPaint()
    }

    if (this._pointerIntent === 'action') {
      const pressedIndex = this._actionIndexAt(e.position) === this._activeActionIndex
        ? this._activeActionIndex
        : -1
      if (pressedIndex !== this._pressedActionIndex) {
        this._pressedActionIndex = pressedIndex
        this.markNeedsPaint()
      }
      return
    }
    if (this._pointerIntent === 'clear') {
      const pressed = pointInFormFieldRect(this._inlineLayout().clearRect, e.position)
      if (pressed !== this._pressedClearButton) {
        this._pressedClearButton = pressed
        this.markNeedsPaint()
      }
      return
    }

    if (this._pendingGesture.isPending && !this._dragging) {
      this._lastDragPosition = e.position
      this._resolveSelectionIntent(e.position)
    }

    // 拖选
    if (this._dragging && this._focused) {
      this._singleLineInput.setSelectionFromGlobal(e.position.x, {
        extend: true,
        syncComposer: true,
      })
      this._editSession.refresh()
    }
  }

  onPointerUp(e: PointerEvent): void {
    if (this._affordancePointer && !this._ownsAffordancePointer(e)) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    if (!isPrimaryPointerButton(e)) return
    if (this._pointerIntent === 'action') {
      const pressedIndex = this._activeActionIndex
      const releasedIndex = this._actionIndexAt(e.position)
      const action = this._actionAt(pressedIndex)
      const shouldClick = pressedIndex === releasedIndex &&
        !!action &&
        !action.disabled &&
        !this.disabled
      this._pendingGesture.resolveTerminal(
        shouldClick ? 'accepted' : 'rejected',
        () => this._finishAffordanceGesture(releasedIndex, e.position),
        () => { if (shouldClick) action?.onClick?.() },
      )
      return
    }
    if (this._pointerIntent === 'clear') {
      const shouldClear = pointInFormFieldRect(this._inlineLayout().clearRect, e.position) &&
        this._showClearButton()
      this._pendingGesture.resolveTerminal(
        shouldClear ? 'accepted' : 'rejected',
        () => this._finishAffordanceGesture(-1, e.position),
        () => { if (shouldClear) this._clearValue() },
      )
      return
    }
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => {
        this._pointerIntent = 'none'
        this._dragging = false
        this._dragStartPosition = undefined
        this._lastDragPosition = undefined
      },
      () => this.markNeedsPaint(),
    )
  }

  onPointerCancel(e: PointerEvent): void {
    if (this._affordancePointer && !this._ownsAffordancePointer(e)) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => {
        this._hovered = false
        this._finishAffordanceGesture(-1, e.position)
      },
      () => {
        this._pointerIntent = 'none'
        this._dragging = false
        this._dragStartPosition = undefined
        this._lastDragPosition = undefined
      },
      () => this.markNeedsPaint(),
    )
  }

  onPointerLeave(e: PointerEvent): void {
    if (this._affordancePointer && !this._ownsAffordancePointer(e)) return
    if (this._pointerIntent === 'action' || this._pointerIntent === 'clear') {
      this._pendingGesture.resolveTerminal(
        'rejected',
        () => this._finishAffordanceGesture(-1, e.position),
      )
    }
    if (
      !this._hovered &&
      this._hoveredActionIndex < 0 &&
      this._pressedActionIndex < 0 &&
      !this._pressedClearButton
    ) return
    this._hovered = false
    this._clearActionInteraction()
    this.markNeedsPaint()
  }

  acceptGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.accept(pointerId, pointerType)) return
    if (this._pointerIntent === 'action' || this._pointerIntent === 'clear') return
    this._dragging = true
    if (this._lastDragPosition) this._updateDragSelection(this._lastDragPosition)
  }

  rejectGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    const intent = this._pointerIntent
    if (!this._pendingGesture.reject(pointerId, pointerType)) return
    if (intent === 'action' || intent === 'clear') {
      this._finishAffordanceGesture(-1)
      this.markNeedsPaint()
      return
    }
    this._pointerIntent = 'none'
    this._dragging = false
    this._dragStartPosition = undefined
    this._lastDragPosition = undefined
  }

  private _resolveSelectionIntent(position: Offset): void {
    if (!this._pendingGesture.isPending || !this._dragStartPosition) return
    const dx = position.x - this._dragStartPosition.x
    const dy = position.y - this._dragStartPosition.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_SLOP) return
    this._pendingGesture.resolve(Math.abs(dx) >= Math.abs(dy) ? 'accepted' : 'rejected')
  }

  private _updateDragSelection(position: Offset): void {
    this._singleLineInput.setSelectionFromGlobal(position.x, {
      extend: true,
      syncComposer: true,
    })
    this._editSession.refresh()
  }

  private _beginAffordanceGesture(
    event: PointerEvent,
    intent: 'action' | 'clear',
    actionIndex = -1,
  ): void {
    this._resetPendingGesture()
    this._pointerIntent = intent
    this._affordancePointer = resolvePointerIdentity(event)
    this._activeActionIndex = intent === 'action' ? actionIndex : -1
    this._pressedActionIndex = this._activeActionIndex
    this._pressedClearButton = intent === 'clear'
    this._pendingGesture.begin(event, this, { captureOnAccept: false })
    this.markNeedsPaint()
  }

  private _ownsAffordancePointer(
    event: Pick<PointerEvent, 'pointerId' | 'pointerType'>,
  ): boolean {
    return !!this._affordancePointer &&
      pointerKey(this._affordancePointer) === pointerKey(event)
  }

  private _finishAffordanceGesture(
    hoveredActionIndex: number,
    position?: Offset,
  ): void {
    this._pointerIntent = 'none'
    this._affordancePointer = undefined
    this._activeActionIndex = -1
    this._pressedActionIndex = -1
    this._pressedClearButton = false
    this._dragging = false
    this._dragStartPosition = undefined
    this._lastDragPosition = undefined
    if (position) this._updateActionHover(hoveredActionIndex, position)
    else this._clearActionInteraction()
    this.markNeedsPaint()
  }

  private _resetPendingGesture(): void {
    this._pendingGesture.resetPending()
    this._dragStartPosition = undefined
    this._lastDragPosition = undefined
  }

  private _resetPointerInteraction(): void {
    this._dragging = false
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => {
        this._pointerIntent = 'none'
        this._affordancePointer = undefined
        this._activeActionIndex = -1
        this._pressedActionIndex = -1
        this._pressedClearButton = false
        this._dragStartPosition = undefined
        this._lastDragPosition = undefined
      },
    )
  }

  private _updateActionHover(index: number, position: Offset): void {
    if (index === this._hoveredActionIndex) return
    const previous = this._actionAt(this._hoveredActionIndex)
    if (previous?.tooltip) TooltipService.currentOrNull?.hide()
    this._hoveredActionIndex = index
    const next = this._actionAt(index)
    if (next?.tooltip) TooltipService.currentOrNull?.show(next.tooltip, position)
  }

  private _clearActionInteraction(): void {
    const hovered = this._actionAt(this._hoveredActionIndex)
    if (hovered?.tooltip) TooltipService.currentOrNull?.hide()
    this._hoveredActionIndex = -1
    this._pressedActionIndex = -1
    this._activeActionIndex = -1
    this._pressedClearButton = false
    this._affordancePointer = undefined
    if (this._pointerIntent === 'action' || this._pointerIntent === 'clear') {
      this._pointerIntent = 'none'
    }
  }

  reset(newValue = ''): void {
    this._clearEditHistory()
    this.value = normalizeTextLength(newValue, this.maxLength)
    this._textInput.setScrollX(0)
    this._textInput.setSelection(this.value.length, this.value.length, {
      cursorPos: this.value.length,
      syncComposer: false,
    })
    if (this._focused) {
      this._textInput.setComposerValue(this.value)
    }
    this.markNeedsPaint()
  }

  private _clearValue(): void {
    if (!this._showClearButton()) return
    FocusManager.instance.setFocus(this)
    const applied = this._applyEditorValue('', 0, 0, 'keyboard')
    this._textInput.setScrollX(0)
    this._publishUserValueChange(applied, 'clear')
    this._editSession.refresh({ resetBlink: true, syncSelectionFromComposer: false })
    this.markNeedsPaint()
  }

  dispose(): void {
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => this._clearActionInteraction(),
      () => this._blur(),
      () => this._textInput.dispose(),
      () => this._clearEditHistory(),
      () => this._valueEditorEvents.dispose(),
      () => {
        if (this._focusRegistered && typeof window !== 'undefined') {
          FocusManager.instance.unregister(this)
          this._focusRegistered = false
        }
      },
      () => super.dispose(),
    )
  }

  private _publishUserValueChange(
    applied: AppliedTextBoxEdit,
    reason: TextBoxValueChangeReason,
  ): void {
    if (!applied.changed) return
    runCleanupSteps([
      () => this.onChange?.(applied.value),
      () => this._valueEditorEvents.emitValueChange({
        value: applied.value,
        previousValue: applied.previousValue,
        reason,
      }),
    ])
  }
}


function normalizeMaxLength(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

function normalizeTextLength(value: string, maxLength: number | null): string {
  if (maxLength === null) return value
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function clampTextIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return length
  return Math.max(0, Math.min(length, Math.floor(value)))
}

function sameEditSnapshot(a: TextBoxEditSnapshot, b: TextBoxEditSnapshot): boolean {
  return a.value === b.value &&
    a.selectionStart === b.selectionStart &&
    a.selectionEnd === b.selectionEnd
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}
