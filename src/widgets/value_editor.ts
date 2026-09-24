import {
  runCleanupSteps,
  type Disposable,
  type DisposeFn,
} from '../core/disposable'
import type { FormFieldStatus } from './form_field_shell'

/**
 * Describes a formal value change produced by the editor.
 *
 * Most changes come from user interaction. An editor may also publish a
 * reconciliation change when runtime configuration makes its current formal
 * value invalid. Model-to-editor `setValue()` writes remain silent.
 *
 * `previousValue` is optional because an adapter may observe an existing
 * component callback only after that component has updated its own value.
 */
export interface ValueEditorValueChange<
  TValue,
  TReason extends string = string,
  TDetail = unknown,
> {
  readonly value: TValue
  readonly previousValue?: TValue
  readonly reason: TReason
  readonly detail: TDetail | undefined
  /**
   * `false` identifies configuration reconciliation rather than direct user
   * interaction. Omitted values are treated as user initiated.
   */
  readonly userInitiated?: boolean
}

export interface ValueEditorValueChangeInput<
  TValue,
  TReason extends string = string,
  TDetail = unknown,
> {
  readonly value: TValue
  readonly previousValue?: TValue
  readonly reason: TReason
  readonly detail?: TDetail
  readonly userInitiated?: boolean
}

export type ValueEditorValueChangeListener<
  TValue,
  TReason extends string = string,
  TDetail = unknown,
> = (
  change: ValueEditorValueChange<TValue, TReason, TDetail>,
) => void

export type ValueEditorBlurListener = () => void

/**
 * The minimum structural contract shared by value editors.
 *
 * `setValue()` is a silent model-to-editor operation. It may repaint the
 * editor, but it must not publish a user value-change event.
 */
export interface ValueEditor<
  TValue,
  TReason extends string = string,
  TDetail = unknown,
> {
  getValue(): TValue
  setValue(value: TValue): void
  subscribeValueChange(
    listener: ValueEditorValueChangeListener<TValue, TReason, TDetail>,
  ): DisposeFn
  subscribeBlur(listener: ValueEditorBlurListener): DisposeFn
  requestFocus(): void
  blur(): void
  disabled: boolean
  readonly isFocused: boolean
}

export interface ValueEditorReadonlyCapability {
  readonly: boolean
}

export interface ValueEditorStatusCapability {
  status: FormFieldStatus
}

export interface ValueEditorHelperTextCapability {
  helperText: string
}

export type ValueEditorCommitResult = boolean | void

/**
 * Flushes editor-local pending input. `false` means that the input could not
 * be committed; `true` or `void` means that no pending input remains.
 */
export interface ValueEditorCommitCapability {
  commitEdit(): ValueEditorCommitResult
}

/**
 * Cancels only editor-local pending input. The contract deliberately does not
 * prescribe a form or business-object editing session.
 */
export interface ValueEditorCancelCapability {
  cancelEdit(): void
}

/**
 * Invokes the editor's user-facing clear operation. An implementation should
 * publish a user value-change event when clearing changes the value.
 */
export interface ValueEditorClearCapability {
  clear(): void
}

export type AdaptedValueEditor<
  TValue,
  TReason extends string = string,
  TDetail = unknown,
> = ValueEditor<TValue, TReason, TDetail> & Partial<
  ValueEditorReadonlyCapability &
  ValueEditorStatusCapability &
  ValueEditorHelperTextCapability &
  ValueEditorCommitCapability &
  ValueEditorCancelCapability &
  ValueEditorClearCapability
>

export function supportsValueEditorReadonly<
  TValue,
  TReason extends string,
  TDetail,
>(
  editor: ValueEditor<TValue, TReason, TDetail>,
): editor is ValueEditor<TValue, TReason, TDetail> & ValueEditorReadonlyCapability {
  return 'readonly' in editor
}

export function supportsValueEditorStatus<
  TValue,
  TReason extends string,
  TDetail,
>(
  editor: ValueEditor<TValue, TReason, TDetail>,
): editor is ValueEditor<TValue, TReason, TDetail> & ValueEditorStatusCapability {
  return 'status' in editor
}

export function supportsValueEditorHelperText<
  TValue,
  TReason extends string,
  TDetail,
>(
  editor: ValueEditor<TValue, TReason, TDetail>,
): editor is ValueEditor<TValue, TReason, TDetail> & ValueEditorHelperTextCapability {
  return 'helperText' in editor
}

export function supportsValueEditorCommit<
  TValue,
  TReason extends string,
  TDetail,
>(
  editor: ValueEditor<TValue, TReason, TDetail>,
): editor is ValueEditor<TValue, TReason, TDetail> & ValueEditorCommitCapability {
  return typeof (editor as Partial<ValueEditorCommitCapability>).commitEdit === 'function'
}

export function supportsValueEditorCancel<
  TValue,
  TReason extends string,
  TDetail,
>(
  editor: ValueEditor<TValue, TReason, TDetail>,
): editor is ValueEditor<TValue, TReason, TDetail> & ValueEditorCancelCapability {
  return typeof (editor as Partial<ValueEditorCancelCapability>).cancelEdit === 'function'
}

export function supportsValueEditorClear<
  TValue,
  TReason extends string,
  TDetail,
>(
  editor: ValueEditor<TValue, TReason, TDetail>,
): editor is ValueEditor<TValue, TReason, TDetail> & ValueEditorClearCapability {
  return typeof (editor as Partial<ValueEditorClearCapability>).clear === 'function'
}

/**
 * Reusable listener storage for editors that implement the structural
 * contract directly.
 */
export class ValueEditorEventEmitter<
  TValue,
  TReason extends string = string,
  TDetail = unknown,
> implements Disposable {
  private readonly _valueListeners = new Set<
    ValueEditorValueChangeListener<TValue, TReason, TDetail>
  >()
  private readonly _blurListeners = new Set<ValueEditorBlurListener>()
  private _disposed = false

  get disposed(): boolean {
    return this._disposed
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<TValue, TReason, TDetail>,
  ): DisposeFn {
    this._assertActive()
    this._valueListeners.add(listener)
    return makeIdempotentUnsubscribe(() => this._valueListeners.delete(listener))
  }

  subscribeBlur(listener: ValueEditorBlurListener): DisposeFn {
    this._assertActive()
    this._blurListeners.add(listener)
    return makeIdempotentUnsubscribe(() => this._blurListeners.delete(listener))
  }

  emitValueChange(
    change: ValueEditorValueChangeInput<TValue, TReason, TDetail>,
  ): void {
    if (this._disposed) return
    const event: ValueEditorValueChange<TValue, TReason, TDetail> = {
      value: change.value,
      previousValue: change.previousValue,
      reason: change.reason,
      detail: change.detail,
      ...(
        change.userInitiated === undefined
          ? {}
          : { userInitiated: change.userInitiated }
      ),
    }
    runCleanupSteps(
      [...this._valueListeners].map(listener => () => listener(event)),
    )
  }

  emitBlur(): void {
    if (this._disposed) return
    runCleanupSteps(
      [...this._blurListeners].map(listener => () => listener()),
    )
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._valueListeners.clear()
    this._blurListeners.clear()
  }

  private _assertActive(): void {
    if (this._disposed) {
      throw new Error('Value editor event emitter has been disposed.')
    }
  }
}

export interface ValueEditorMutableProperty<TValue> {
  get(): TValue
  set(value: TValue): void
}

export interface ValueEditorAdapterOptions<
  TValue,
  TReason extends string = string,
  TDetail = unknown,
> {
  readonly value: ValueEditorMutableProperty<TValue>
  readonly disabled: ValueEditorMutableProperty<boolean>
  readonly getIsFocused: () => boolean
  readonly requestFocus: () => void
  readonly blur: () => void
  readonly readonly?: ValueEditorMutableProperty<boolean>
  readonly status?: ValueEditorMutableProperty<FormFieldStatus>
  readonly helperText?: ValueEditorMutableProperty<string>
  readonly commitEdit?: () => ValueEditorCommitResult
  readonly cancelEdit?: () => void
  readonly clear?: () => void
}

export interface ValueEditorAdapterHandle<
  TValue,
  TReason extends string = string,
  TDetail = unknown,
> extends Disposable {
  readonly editor: AdaptedValueEditor<TValue, TReason, TDetail>
  readonly disposed: boolean
  emitValueChange(
    change: ValueEditorValueChangeInput<TValue, TReason, TDetail>,
  ): void
  emitBlur(): void
}

/**
 * Adapts existing controls without requiring a shared editor base class.
 *
 * The handle does not own the target control. Its owner should dispose the
 * handle when the target control is disposed.
 */
export function createValueEditorAdapter<
  TValue,
  TReason extends string = string,
  TDetail = unknown,
>(
  options: ValueEditorAdapterOptions<TValue, TReason, TDetail>,
): ValueEditorAdapterHandle<TValue, TReason, TDetail> {
  const events = new ValueEditorEventEmitter<TValue, TReason, TDetail>()
  let disposed = false

  const assertActive = (): void => {
    if (disposed) throw new Error('Value editor adapter has been disposed.')
  }

  const editorRecord: Record<string, unknown> = {
    getValue: (): TValue => {
      assertActive()
      return options.value.get()
    },
    setValue: (value: TValue): void => {
      assertActive()
      options.value.set(value)
    },
    subscribeValueChange: (
      listener: ValueEditorValueChangeListener<TValue, TReason, TDetail>,
    ): DisposeFn => {
      assertActive()
      return events.subscribeValueChange(listener)
    },
    subscribeBlur: (listener: ValueEditorBlurListener): DisposeFn => {
      assertActive()
      return events.subscribeBlur(listener)
    },
    requestFocus: (): void => {
      assertActive()
      options.requestFocus()
    },
    blur: (): void => {
      assertActive()
      options.blur()
    },
  }

  defineMutableProperty(editorRecord, 'disabled', options.disabled, assertActive)
  defineReadonlyProperty(editorRecord, 'isFocused', options.getIsFocused, assertActive)

  if (options.readonly) {
    defineMutableProperty(editorRecord, 'readonly', options.readonly, assertActive)
  }
  if (options.status) {
    defineMutableProperty(editorRecord, 'status', options.status, assertActive)
  }
  if (options.helperText) {
    defineMutableProperty(editorRecord, 'helperText', options.helperText, assertActive)
  }
  if (options.commitEdit) {
    editorRecord.commitEdit = (): ValueEditorCommitResult => {
      assertActive()
      return options.commitEdit!()
    }
  }
  if (options.cancelEdit) {
    editorRecord.cancelEdit = (): void => {
      assertActive()
      options.cancelEdit!()
    }
  }
  if (options.clear) {
    editorRecord.clear = (): void => {
      assertActive()
      options.clear!()
    }
  }

  const editor = editorRecord as unknown as AdaptedValueEditor<
    TValue,
    TReason,
    TDetail
  >

  return {
    editor,
    get disposed(): boolean {
      return disposed
    },
    emitValueChange: change => events.emitValueChange(change),
    emitBlur: () => events.emitBlur(),
    dispose: (): void => {
      if (disposed) return
      disposed = true
      events.dispose()
    },
  }
}

function defineMutableProperty<TValue>(
  target: Record<string, unknown>,
  key: string,
  property: ValueEditorMutableProperty<TValue>,
  assertActive: () => void,
): void {
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: false,
    get: (): TValue => {
      assertActive()
      return property.get()
    },
    set: (value: TValue): void => {
      assertActive()
      property.set(value)
    },
  })
}

function defineReadonlyProperty<TValue>(
  target: Record<string, unknown>,
  key: string,
  getValue: () => TValue,
  assertActive: () => void,
): void {
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: false,
    get: (): TValue => {
      assertActive()
      return getValue()
    },
  })
}

function makeIdempotentUnsubscribe(unsubscribe: () => void): DisposeFn {
  let active = true
  return (): void => {
    if (!active) return
    active = false
    unsubscribe()
  }
}
