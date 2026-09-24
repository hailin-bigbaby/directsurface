import type { BoxConstraints, LayoutContext, Offset, RenderObject } from '../core/render_object'
import { runCleanupSteps } from '../core/disposable'
import type { PaintContext } from '../rendering/paint_context'
import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import type { FormFieldStatus } from './form_field_shell'
import {
  MaskEngine,
  type MaskBlockDefinitions,
  type MaskOverwriteMode,
  type MaskTokenDefinitions,
  type MaskValue,
} from './mask_engine'
import {
  RenderTextBox,
  type TextBoxEditContext,
  type TextBoxEditResult,
  type TextBoxInputAdapter,
  type TextBoxValueChangeReason,
} from './text_field'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorBlurListener,
  type ValueEditorValueChangeListener,
} from './value_editor'

export type MaskPromptMode = 'never' | 'focused' | 'always'

export interface RenderMaskedTextEditOptions extends RenderBoxOptions {
  mask: string
  value?: string
  definitions?: MaskTokenDefinitions
  blocks?: MaskBlockDefinitions
  promptMode?: MaskPromptMode
  promptCharacter?: string
  overwriteMode?: MaskOverwriteMode
  placeholder?: string
  readonly?: boolean
  disabled?: boolean
  status?: FormFieldStatus
  helperText?: string
  prefixText?: string
  suffixText?: string
  clearable?: boolean
  fieldHeight?: number
  onChange?: (value: string, details: MaskValue) => void
  onSubmit?: (value: string, details: MaskValue) => void
  onBlur?: (value: string, details: MaskValue) => void
}

export class RenderMaskedTextEdit extends RenderBox implements
  ValueEditor<string, TextBoxValueChangeReason, MaskValue> {
  static override debugTypeName = 'RenderMaskedTextEdit'
  readonly engine: MaskEngine
  readonly textBox: RenderTextBox
  readonly promptMode: MaskPromptMode
  readonly promptCharacter: string
  readonly overwriteMode: MaskOverwriteMode

  private _value: string
  private _details: MaskValue
  private _onChange?: (value: string, details: MaskValue) => void
  private _onSubmit?: (value: string, details: MaskValue) => void
  private _onBlur?: (value: string, details: MaskValue) => void
  private readonly _valueEditorEvents =
    new ValueEditorEventEmitter<string, TextBoxValueChangeReason, MaskValue>()
  private readonly _unsubscribeTextBoxValueChange: () => void
  private readonly _unsubscribeTextBoxBlur: () => void

  constructor(options: RenderMaskedTextEditOptions) {
    super(options)
    this.promptMode = options.promptMode ?? 'never'
    this.promptCharacter = options.promptCharacter ?? '_'
    this.overwriteMode = options.overwriteMode ?? 'insert'
    assertPromptMode(this.promptMode)
    assertPromptCharacter(this.promptCharacter)
    assertOverwriteMode(this.overwriteMode)
    this.engine = new MaskEngine(options.mask, {
      definitions: options.definitions,
      blocks: options.blocks,
    })
    this._details = this.engine.formatRaw(options.value ?? '')
    this._value = this._details.raw
    this._onChange = options.onChange
    this._onSubmit = options.onSubmit
    this._onBlur = options.onBlur

    const inputAdapter = createMaskInputAdapter(this.engine, this.overwriteMode)
    this.textBox = new RenderTextBox({
      value: this._details.display,
      placeholder: options.placeholder,
      guideText: this._guideSuffix(this._details),
      guideVisibility: this.promptMode === 'focused' ? 'focused' : 'always',
      readonly: options.readonly,
      disabled: options.disabled,
      status: options.status,
      helperText: options.helperText,
      prefixText: options.prefixText,
      suffixText: options.suffixText,
      clearable: options.clearable,
      fieldHeight: options.fieldHeight,
      inputAdapter,
      onSubmit: display => this._acceptDisplay(display, this._onSubmit),
      onBlur: display => this._acceptDisplay(display, this._onBlur),
    })
    this.textBox.parent = this
    this._unsubscribeTextBoxValueChange = this.textBox.subscribeValueChange(change => {
      this._acceptUserDisplay(change.value, change.reason)
    })
    this._unsubscribeTextBoxBlur = this.textBox.subscribeBlur(() => {
      this._valueEditorEvents.emitBlur()
    })
  }

  get value(): string { return this._value }
  set value(value: string) {
    const details = this.engine.formatRaw(value)
    if (this._value === details.raw && this._details.display === details.display) {
      this.textBox.value = details.display
      this.textBox.guideText = this._guideSuffix(details)
      return
    }
    this._value = details.raw
    this._details = details
    this.textBox.value = details.display
    this.textBox.guideText = this._guideSuffix(details)
  }

  get displayValue(): string { return this._details.display }
  get complete(): boolean { return this._details.complete }

  get onChange(): ((value: string, details: MaskValue) => void) | undefined { return this._onChange }
  set onChange(callback: ((value: string, details: MaskValue) => void) | undefined) {
    this._onChange = callback
  }

  get onSubmit(): ((value: string, details: MaskValue) => void) | undefined { return this._onSubmit }
  set onSubmit(callback: ((value: string, details: MaskValue) => void) | undefined) {
    this._onSubmit = callback
  }

  get onBlur(): ((value: string, details: MaskValue) => void) | undefined { return this._onBlur }
  set onBlur(callback: ((value: string, details: MaskValue) => void) | undefined) {
    this._onBlur = callback
  }

  get placeholder(): string { return this.textBox.placeholder }
  set placeholder(value: string) { this.textBox.placeholder = value; this.textBox.markNeedsPaint() }

  get readonly(): boolean { return this.textBox.readonly }
  set readonly(value: boolean) { this.textBox.readonly = value }

  get disabled(): boolean { return this.textBox.disabled }
  set disabled(value: boolean) { this.textBox.disabled = value }

  get status(): FormFieldStatus { return this.textBox.status }
  set status(value: FormFieldStatus) { this.textBox.status = value }

  get helperText(): string { return this.textBox.helperText }
  set helperText(value: string) { this.textBox.helperText = value }

  get clearable(): boolean { return this.textBox.clearable }
  set clearable(value: boolean) { this.textBox.clearable = value }

  get isFocused(): boolean { return this.textBox.isFocused }
  focusIn(): void { this.textBox.focusIn() }
  focusOut(): void { this.textBox.focusOut() }

  getValue(): string { return this.value }
  setValue(value: string): void { this.value = value }
  subscribeValueChange(
    listener: ValueEditorValueChangeListener<string, TextBoxValueChangeReason, MaskValue>,
  ): () => void {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }
  subscribeBlur(listener: ValueEditorBlurListener): () => void {
    return this._valueEditorEvents.subscribeBlur(listener)
  }
  requestFocus(): void { this.textBox.requestFocus() }
  blur(): void { this.textBox.blur() }

  reset(value = ''): void {
    this.value = value
    this.textBox.reset(this._details.display)
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    visitor(this.textBox)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    this.textBox.layout(constraints, true, context)
    this.textBox.offset = { x: 0, y: 0 }
    this.size = { ...this.textBox.outerSize }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    this.textBox.paint(context, {
      x: offset.x + this.textBox.offset.x,
      y: offset.y + this.textBox.offset.y,
    })
  }

  override performTransientPaint(context: PaintContext, offset: Offset): void {
    this.textBox.paintTransient(context, {
      x: offset.x + this.textBox.offset.x,
      y: offset.y + this.textBox.offset.y,
    })
  }

  override dispose(): void {
    runCleanupSteps([
      () => super.dispose(),
      this._unsubscribeTextBoxValueChange,
      this._unsubscribeTextBoxBlur,
      () => this._valueEditorEvents.dispose(),
    ])
  }

  private _acceptDisplay(
    display: string,
    callback?: (value: string, details: MaskValue) => void,
  ): void {
    const details = this.engine.normalize(display)
    this._details = details
    this._value = details.raw
    if (this.textBox.value !== details.display) this.textBox.value = details.display
    this.textBox.guideText = this._guideSuffix(details)
    callback?.(this._value, this._details)
  }

  private _acceptUserDisplay(
    display: string,
    reason: TextBoxValueChangeReason,
  ): void {
    const previousValue = this._value
    const details = this.engine.normalize(display)
    const value = details.raw
    this._details = details
    this._value = value
    if (this.textBox.value !== details.display) this.textBox.value = details.display
    this.textBox.guideText = this._guideSuffix(details)
    runCleanupSteps([
      () => this._onChange?.(value, details),
      ...(
        value === previousValue
          ? []
          : [() => this._valueEditorEvents.emitValueChange({
              value,
              previousValue,
              reason,
              detail: details,
            })]
      ),
    ])
  }

  private _guideSuffix(details: MaskValue): string {
    if (this.promptMode === 'never') return ''
    const guide = this.engine.guide(details.raw, this.promptCharacter)
    return guide.slice(details.display.length)
  }
}

function createMaskInputAdapter(
  engine: MaskEngine,
  overwriteMode: MaskOverwriteMode,
): TextBoxInputAdapter {
  return {
    transform: (
      value: string,
      context: TextBoxEditContext,
    ): TextBoxEditResult => {
      const insertedText = inferInsertedText(value, context)
      const result = insertedText === undefined
        ? engine.normalizeDisplay(value, context.selectionStart, context.selectionEnd)
        : engine.replace(
            context.value,
            context.previousSelectionStart,
            context.previousSelectionEnd,
            insertedText,
            { mode: overwriteMode },
          )
      return {
        value: result.display,
        selectionStart: result.selectionStart,
        selectionEnd: result.selectionEnd,
      }
    },
    handleKeyDown: (
      event: KeyboardEvent,
      context: TextBoxEditContext,
    ): TextBoxEditResult | undefined => {
      if (event.key !== 'Backspace' && event.key !== 'Delete') return undefined
      const result = engine.delete(
        context.value,
        context.selectionStart,
        context.selectionEnd,
        event.key === 'Backspace' ? 'backward' : 'forward',
      )
      return {
        value: result.display,
        selectionStart: result.selectionStart,
        selectionEnd: result.selectionEnd,
      }
    },
  }
}

function inferInsertedText(value: string, context: TextBoxEditContext): string | undefined {
  const start = clampIndex(context.previousSelectionStart, context.value.length)
  const end = clampIndex(context.previousSelectionEnd, context.value.length)
  const selectionStart = Math.min(start, end)
  const selectionEnd = Math.max(start, end)
  const prefix = context.value.slice(0, selectionStart)
  const suffix = context.value.slice(selectionEnd)
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) return undefined
  const insertedEnd = value.length - suffix.length
  if (insertedEnd < prefix.length) return undefined
  return value.slice(prefix.length, insertedEnd)
}

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return length
  return Math.max(0, Math.min(length, Math.floor(value)))
}

function assertPromptMode(mode: MaskPromptMode): void {
  if (mode !== 'never' && mode !== 'focused' && mode !== 'always') {
    throw new Error(`RenderMaskedTextEdit received an invalid promptMode: ${String(mode)}.`)
  }
}

function assertOverwriteMode(mode: MaskOverwriteMode): void {
  if (mode !== 'insert' && mode !== 'replace') {
    throw new Error(`RenderMaskedTextEdit received an invalid overwriteMode: ${String(mode)}.`)
  }
}

function assertPromptCharacter(character: string): void {
  if (Array.from(character).length !== 1) {
    throw new Error('RenderMaskedTextEdit promptCharacter must contain exactly one character.')
  }
}
