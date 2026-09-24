import {
  runCleanupSteps,
  type Disposable,
  type DisposeFn,
} from '../core/disposable'
import {
  type FormSession,
  type FormSessionFieldOptions,
} from '../core/form_session'
import type { ValidationTrigger } from '../core/validation_provider'
import type { FormFieldStatus } from './form_field_shell'
import {
  supportsValueEditorCancel,
  supportsValueEditorCommit,
  supportsValueEditorHelperText,
  supportsValueEditorStatus,
  type ValueEditor,
  type ValueEditorValueChange,
} from './value_editor'

export interface FormFieldIssuePresenter {
  status: FormFieldStatus
  message: string
}

export interface FormFieldBindingOptions<
  TModel extends object,
  TField extends keyof TModel,
  TReason extends string = string,
  TDetail = unknown,
> extends FormSessionFieldOptions<TModel, TField> {
  readonly presenter?: FormFieldIssuePresenter
  readonly validateOn?: readonly Extract<ValidationTrigger, 'change' | 'blur'>[]
  readonly mapChangeToValues?: (
    change: ValueEditorValueChange<TModel[TField], TReason, TDetail>,
    model: Readonly<TModel>,
  ) => Readonly<Partial<TModel>>
  readonly valueEquals?: (
    left: TModel[TField],
    right: TModel[TField],
  ) => boolean
  readonly writeBackNormalizedValue?: boolean
  readonly pendingCommitMessage?: string
  readonly onValidationError?: (error: unknown) => void
}

const DEFAULT_VALIDATE_ON = new Set<ValidationTrigger>(['change', 'blur'])
const DEFAULT_PENDING_COMMIT_MESSAGE = '当前输入尚未完成，请完成或取消后重试'
let nextBindingSourceId = 1

export function bindFormField<
  TModel extends object,
  TField extends keyof TModel,
  TReason extends string = string,
  TDetail = unknown,
>(
  form: FormSession<TModel>,
  field: TField,
  editor: ValueEditor<TModel[TField], TReason, TDetail>,
  options: FormFieldBindingOptions<
    TModel,
    TField,
    TReason,
    TDetail
  > = {},
): DisposeFn {
  const binding = new BoundFormField(form, field, editor, options)
  return () => binding.dispose()
}

export class FormBindingBag<TModel extends object> implements Disposable {
  private readonly _form: FormSession<TModel>
  private readonly _bindings = new Set<DisposeFn>()
  private _disposed = false

  constructor(form: FormSession<TModel>) {
    this._form = form
  }

  get disposed(): boolean {
    return this._disposed
  }

  bindField<
    TField extends keyof TModel,
    TReason extends string = string,
    TDetail = unknown,
  >(
    field: TField,
    editor: ValueEditor<TModel[TField], TReason, TDetail>,
    options: FormFieldBindingOptions<
      TModel,
      TField,
      TReason,
      TDetail
    > = {},
  ): DisposeFn {
    if (this._disposed) {
      throw new Error('Form binding bag has been disposed.')
    }
    const disposeBinding = bindFormField(this._form, field, editor, options)
    let active = true
    const dispose = (): void => {
      if (!active) return
      active = false
      this._bindings.delete(dispose)
      disposeBinding()
    }
    this._bindings.add(dispose)
    return dispose
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    const bindings = [...this._bindings].reverse()
    this._bindings.clear()
    runCleanupSteps(bindings)
  }
}

interface ValidationPresentationTarget {
  getStatus(): FormFieldStatus
  setStatus(status: FormFieldStatus): void
  getMessage(): string
  setMessage(message: string): void
}

class BoundFormField<
  TModel extends object,
  TField extends keyof TModel,
  TReason extends string,
  TDetail,
> implements Disposable {
  private readonly _disposers: DisposeFn[] = []
  private readonly _validateOn: ReadonlySet<ValidationTrigger>
  private readonly _valueEquals: (
    left: TModel[TField],
    right: TModel[TField],
  ) => boolean
  private readonly _pendingIssueSource = `form-binding:pending:${nextBindingSourceId++}`
  private readonly _presentation: ValidationPresentationTarget | null
  private readonly _baselineStatus: FormFieldStatus | null
  private readonly _baselineMessage: string | null
  private _lastPresentedStatus: FormFieldStatus | null = null
  private _lastPresentedMessage: string | null = null
  private _disposed = false
  private _syncingEditor = false

  constructor(
    private readonly _form: FormSession<TModel>,
    private readonly _field: TField,
    private readonly _editor: ValueEditor<TModel[TField], TReason, TDetail>,
    private readonly _options: FormFieldBindingOptions<
      TModel,
      TField,
      TReason,
      TDetail
    >,
  ) {
    this._validateOn = resolveValidateOn(this._options)
    this._valueEquals = this._options.valueEquals ?? defaultValueEquality
    this._presentation = resolvePresentationTarget(
      this._editor,
      this._options.presenter,
    )
    this._baselineStatus = this._presentation?.getStatus() ?? null
    this._baselineMessage = this._presentation?.getMessage() ?? null

    try {
      this._syncEditorFromSession(this._form.getValue(this._field))
      this._disposers.push(this._form.registerField(this._field, {
        rules: this._options.rules,
        triggers: this._options.triggers,
        source: this._options.source,
        focus: this._options.focus ?? (() => {
          this._editor.requestFocus()
          return this._editor.isFocused
        }),
      }))
      this._disposers.push(this._form.registerEditParticipant({
        flushPendingEdit: (_trigger, targetField) => {
          if (
            targetField !== undefined
            && !Object.is(targetField, this._field)
          ) {
            return
          }
          this._flushPendingEdit()
        },
        cancelPendingEdit: field => {
          if (field !== undefined && !Object.is(field, this._field)) return
          this._cancelPendingEdit()
        },
      }, {
        fields: [this._field],
      }))
      this._disposers.push(this._form.edit.subscribeField(
        this._field,
        value => this._syncEditorFromSession(value),
      ))
      this._disposers.push(
        this._form.errors.subscribe(() => this._syncPresentation()),
      )
      this._disposers.push(this._editor.subscribeValueChange(change => {
        this._handleEditorChange(change)
      }))
      this._disposers.push(
        this._editor.subscribeBlur(() => this._handleEditorBlur()),
      )
      this._syncPresentation()
    } catch (error) {
      this._disposed = true
      try {
        runCleanupSteps([...this._disposers].reverse())
      } catch {
        // Preserve the binding failure after best-effort cleanup.
      }
      throw error
    }
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    const disposers = this._disposers.splice(0).reverse()
    runCleanupSteps([
      ...disposers,
      () => this._clearPendingIssue(),
      () => this._restorePresentation(),
    ])
  }

  private _handleEditorChange(
    change: ValueEditorValueChange<TModel[TField], TReason, TDetail>,
  ): void {
    if (this._disposed || this._form.disposed || this._syncingEditor) return
    const patch = this._options.mapChangeToValues
      ? this._options.mapChangeToValues(change, this._form.snapshot())
      : { [this._field]: change.value } as unknown as Partial<TModel>

    this._form.batchUpdate(() => {
      this._form.setValues(patch)
      if (change.userInitiated !== false) {
        this._form.markTouched(this._field)
      }
    })
    this._clearPendingIssue()
    if (this._validateOn.has('change')) this._requestValidation('change')
  }

  private _handleEditorBlur(): void {
    if (this._disposed || this._form.disposed) return
    this._form.markTouched(this._field)
    if (this._validateOn.has('blur')) this._requestValidation('blur')
  }

  private _syncEditorFromSession(value: TModel[TField]): void {
    if (this._disposed || this._syncingEditor) return
    this._syncingEditor = true
    try {
      const previousEditorValue = this._editor.getValue()
      this._editor.setValue(value)
      const normalized = this._editor.getValue()
      if (!this._valueEquals(previousEditorValue, normalized)) {
        this._clearPendingIssue()
      }
      if (this._options.writeBackNormalizedValue === false) return
      if (this._valueEquals(value, normalized) || this._form.disposed) return
      this._form.setValue(this._field, normalized)
    } finally {
      this._syncingEditor = false
    }
  }

  private _flushPendingEdit(): void {
    if (this._disposed || this._form.disposed) return
    if (!supportsValueEditorCommit(this._editor)) {
      this._clearPendingIssue()
      return
    }
    const committed = this._editor.commitEdit()
    if (committed !== false) {
      this._clearPendingIssue()
      return
    }
    this._form.setExternalIssues(this._pendingIssueSource, [{
      field: this._field,
      code: 'pending-editor-value',
      message: this._options.pendingCommitMessage
        ?? DEFAULT_PENDING_COMMIT_MESSAGE,
      severity: 'error',
    }])
  }

  private _cancelPendingEdit(): void {
    if (this._disposed || this._form.disposed) return
    runCleanupSteps([
      () => {
        if (supportsValueEditorCancel(this._editor)) {
          this._editor.cancelEdit()
        }
      },
      () => this._clearPendingIssue(),
    ])
  }

  private _requestValidation(trigger: Extract<ValidationTrigger, 'change' | 'blur'>): void {
    void this._form.validateField(this._field, trigger).catch(error => {
      if (this._disposed || this._form.disposed) return
      if (this._options.onValidationError) {
        this._options.onValidationError(error)
        return
      }
      queueMicrotask(() => { throw error })
    })
  }

  private _syncPresentation(): void {
    if (this._disposed || !this._presentation || this._form.disposed) return
    const issue = this._form.errors.firstIssue({
      field: this._field,
      severity: 'error',
    }) ?? this._form.errors.firstIssue({
      field: this._field,
      severity: 'warning',
    })
    if (!issue) {
      this._restorePresentation()
      return
    }

    const status = issue.severity === 'error' ? 'error' : 'warning'
    this._presentation.setStatus(status)
    this._presentation.setMessage(issue.message)
    this._lastPresentedStatus = status
    this._lastPresentedMessage = issue.message
  }

  private _restorePresentation(): void {
    if (
      !this._presentation
      || this._baselineStatus === null
      || this._baselineMessage === null
    ) {
      return
    }
    if (
      this._lastPresentedStatus !== null
      && this._presentation.getStatus() === this._lastPresentedStatus
    ) {
      this._presentation.setStatus(this._baselineStatus)
    }
    if (
      this._lastPresentedMessage !== null
      && this._presentation.getMessage() === this._lastPresentedMessage
    ) {
      this._presentation.setMessage(this._baselineMessage)
    }
    this._lastPresentedStatus = null
    this._lastPresentedMessage = null
  }

  private _clearPendingIssue(): void {
    if (this._form.disposed) return
    this._form.clearExternalIssues(this._pendingIssueSource)
  }
}

function resolveValidateOn<
  TModel extends object,
  TField extends keyof TModel,
  TReason extends string,
  TDetail,
>(
  options: FormFieldBindingOptions<TModel, TField, TReason, TDetail>,
): ReadonlySet<ValidationTrigger> {
  if (options.validateOn) return new Set(options.validateOn)
  if (options.triggers) {
    return new Set(options.triggers.filter(
      trigger => trigger === 'change' || trigger === 'blur',
    ))
  }
  return DEFAULT_VALIDATE_ON
}

function resolvePresentationTarget<
  TValue,
  TReason extends string,
  TDetail,
>(
  editor: ValueEditor<TValue, TReason, TDetail>,
  presenter?: FormFieldIssuePresenter,
): ValidationPresentationTarget | null {
  if (presenter) {
    return {
      getStatus: () => presenter.status,
      setStatus: status => { presenter.status = status },
      getMessage: () => presenter.message,
      setMessage: message => { presenter.message = message },
    }
  }
  if (
    !supportsValueEditorStatus(editor)
    || !supportsValueEditorHelperText(editor)
  ) {
    return null
  }
  return {
    getStatus: () => editor.status,
    setStatus: status => { editor.status = status },
    getMessage: () => editor.helperText,
    setMessage: message => { editor.helperText = message },
  }
}

function defaultValueEquality<TValue>(left: TValue, right: TValue): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    return left.every((value, index) => Object.is(value, right[index]))
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false
  const leftKeys = Reflect.ownKeys(left)
  const rightKeys = Reflect.ownKeys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every(key => (
    Object.prototype.hasOwnProperty.call(right, key)
    && Object.is(left[key], right[key])
  ))
}

function isPlainRecord(
  value: unknown,
): value is Record<PropertyKey, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
