import {
  runCleanupSteps,
  type Disposable,
  type DisposeFn,
} from './disposable'
import {
  EditSession,
  type EditSessionChange,
  type EditSessionOptions,
  type EditSessionTransaction,
} from './edit_session'
import {
  ErrorProvider,
  type ValidationIssue,
  type ValidationIssueInput,
} from './error_provider'
import {
  ValidationProvider,
  type FieldValidationRule,
  type FormValidationRegistrationOptions,
  type FormValidationRule,
  type ValidationRunResult,
  type ValidationTrigger,
} from './validation_provider'

export interface FormSessionOptions<TModel extends object> {
  readonly edit?: EditSessionOptions<TModel>
}

export interface FormSessionFieldOptions<
  TModel extends object,
  TField extends keyof TModel,
> {
  readonly rules?: readonly FieldValidationRule<TModel, TField>[]
  readonly triggers?: readonly ValidationTrigger[]
  readonly source?: string
  readonly focus?: () => boolean
}

export interface FormValidationParticipant {
  readonly triggers?: readonly ValidationTrigger[]
  validate(
    trigger: ValidationTrigger,
    signal: AbortSignal,
  ): boolean | Promise<boolean>
  focusFirstError?(): boolean
  clear?(): void
}

export interface FormEditParticipant<FieldKey = PropertyKey> {
  readonly isDirty?: boolean
  readonly isTouched?: boolean
  flushPendingEdit(
    trigger: ValidationTrigger,
    targetField?: FieldKey,
  ): void
  cancelPendingEdit?(field?: FieldKey): void
  resetEdits?(): void
  acceptEdits?(): void
  subscribeState?(listener: () => void): DisposeFn
}

export interface FormEditParticipantRegistrationOptions<FieldKey = PropertyKey> {
  /**
   * Fields whose targeted validation should flush this participant.
   *
   * Omit the scope for legacy or form-wide participants. Unscoped
   * participants continue to run for every targeted validation.
   */
  readonly fields?: readonly FieldKey[]
}

export type FormSubmitStatus =
  | 'submitted'
  | 'invalid'
  | 'busy'
  | 'cancelled'

export type FormSubmitResult<TResult> =
  | { readonly status: 'submitted'; readonly value: TResult }
  | { readonly status: 'invalid' }
  | { readonly status: 'busy' }
  | { readonly status: 'cancelled' }

export type FormSessionListener = () => void

interface FieldRegistration<TModel extends object> {
  readonly id: number
  readonly field: keyof TModel
  readonly focus?: () => boolean
  readonly disposeOrder: DisposeFn
  readonly disposeValidation?: DisposeFn
}

interface ParticipantRegistration {
  readonly id: number
  readonly participant: FormValidationParticipant
  readonly triggers: ReadonlySet<ValidationTrigger>
}

interface EditParticipantRegistration<FieldKey> {
  readonly id: number
  readonly participant: FormEditParticipant<FieldKey>
  readonly fields: ReadonlySet<FieldKey> | null
  disposeState?: DisposeFn
}

interface AwaitResult<T> {
  readonly cancelled: boolean
  readonly value?: T
}

interface FormNotificationEnvelope {
  readonly listeners: readonly FormSessionListener[]
  failed: boolean
  error?: unknown
}

const SUBMIT_ONLY = new Set<ValidationTrigger>(['submit'])

export class FormSession<TModel extends object> implements Disposable {
  readonly edit: EditSession<TModel>
  readonly errors: ErrorProvider<keyof TModel>
  readonly validation: ValidationProvider<TModel>

  private readonly _listeners = new Set<FormSessionListener>()
  private readonly _childDisposers: DisposeFn[] = []
  private readonly _fields = new Map<number, FieldRegistration<TModel>>()
  private readonly _participants = new Map<number, ParticipantRegistration>()
  private readonly _editParticipants = new Map<
    number,
    EditParticipantRegistration<keyof TModel>
  >()
  private _notificationQueue: FormNotificationEnvelope[] = []
  private _isNotifying = false
  private _nextRegistrationId = 1
  private _validationController: AbortController | null = null
  private _submitController: AbortController | null = null
  private _isSubmitting = false
  private _isFlushingEditParticipants = false
  private _disposed = false

  constructor(
    initialValue: Readonly<TModel>,
    options: FormSessionOptions<TModel> = {},
  ) {
    this.edit = new EditSession(initialValue, options.edit)
    this.errors = new ErrorProvider<keyof TModel>()
    this.validation = new ValidationProvider({
      getModel: () => this.edit.snapshot(),
      errorProvider: this.errors,
    })

    this._childDisposers.push(
      this.edit.subscribe(change => this._handleEditChange(change)),
      this.errors.subscribe(() => this._notify()),
      this.validation.subscribePending(() => this._notify()),
    )
  }

  get disposed(): boolean {
    return this._disposed
  }

  get isDirty(): boolean {
    if (this.edit.isDirty) return true
    for (const registration of this._editParticipants.values()) {
      if (registration.participant.isDirty === true) return true
    }
    return false
  }

  get isTouched(): boolean {
    if (this.edit.isTouched) return true
    for (const registration of this._editParticipants.values()) {
      if (registration.participant.isTouched === true) return true
    }
    return false
  }

  get isValidating(): boolean {
    return this._validationController !== null || this.validation.isPending
  }

  get isSubmitting(): boolean {
    return this._isSubmitting
  }

  getValue<K extends keyof TModel>(field: K): TModel[K] {
    return this.edit.getValue(field)
  }

  setValue<K extends keyof TModel>(field: K, value: TModel[K]): void {
    this._assertActive()
    this.edit.setValue(field, value)
  }

  setValues(values: Readonly<Partial<TModel>>): void {
    this._assertActive()
    this.edit.setValues(values)
  }

  batchUpdate<TResult>(update: () => TResult): TResult {
    this._assertActive()
    return this.edit.batchUpdate(update)
  }

  beginTransaction(): EditSessionTransaction<TModel> {
    this._assertActive()
    if (this.isValidating || this.isSubmitting) {
      throw new Error(
        'Form session cannot begin an edit transaction during validation or submission.',
      )
    }
    return this.edit.beginTransaction()
  }

  isFieldDirty<K extends keyof TModel>(field: K): boolean {
    return this.edit.isFieldDirty(field)
  }

  isFieldTouched<K extends keyof TModel>(field: K): boolean {
    return this.edit.isFieldTouched(field)
  }

  markTouched<K extends keyof TModel>(field: K, touched = true): void {
    this._assertActive()
    this.edit.markTouched(field, touched)
  }

  snapshot(): TModel {
    return this.edit.snapshot()
  }

  registerField<K extends keyof TModel>(
    field: K,
    options: FormSessionFieldOptions<TModel, K> = {},
  ): DisposeFn {
    this._assertActive()
    const id = this._nextRegistrationId++
    let disposeOrder: DisposeFn = () => {}
    let disposeValidation: DisposeFn | undefined
    try {
      if (options.rules && options.rules.length > 0) {
        disposeValidation = this.validation.registerField(field, {
          rules: options.rules,
          triggers: options.triggers,
          source: options.source,
        })
      } else {
        disposeOrder = this.errors.registerField(field)
      }
    } catch (error) {
      disposeOrder()
      throw error
    }

    this._fields.set(id, {
      id,
      field,
      focus: options.focus,
      disposeOrder,
      disposeValidation,
    })
    if (disposeValidation) {
      try {
        this._cancelAllValidation()
      } catch (error) {
        this._fields.delete(id)
        rethrowAfterCleanup(error, [
          disposeValidation,
          disposeOrder,
        ])
      }
    }

    return makeIdempotentDisposer(() => {
      const registration = this._fields.get(id)
      if (!registration) return
      this._fields.delete(id)
      runCleanupSteps([
        ...(
          registration.disposeValidation
            ? [registration.disposeValidation]
            : []
        ),
        registration.disposeOrder,
        ...(
          registration.disposeValidation
            ? [() => this._cancelAllValidation()]
            : []
        ),
      ])
    })
  }

  registerFormRule(
    ruleId: string,
    rule: FormValidationRule<TModel>,
    options: FormValidationRegistrationOptions<TModel> = {},
  ): DisposeFn {
    this._assertActive()
    const disposeRule = this.validation.registerFormRule(ruleId, rule, options)
    try {
      this._cancelAllValidation()
    } catch (error) {
      rethrowAfterCleanup(error, [disposeRule])
    }
    return makeIdempotentDisposer(() => {
      runCleanupSteps([
        disposeRule,
        () => this._cancelAllValidation(),
      ])
    })
  }

  registerValidationParticipant(
    participant: FormValidationParticipant,
  ): DisposeFn {
    this._assertActive()
    const id = this._nextRegistrationId++
    this._participants.set(id, {
      id,
      participant,
      triggers: new Set(participant.triggers ?? SUBMIT_ONLY),
    })
    try {
      this._cancelAllValidation()
    } catch (error) {
      this._participants.delete(id)
      throw error
    }
    return makeIdempotentDisposer(() => {
      if (!this._participants.delete(id)) return
      runCleanupSteps([
        () => this._cancelAllValidation(),
      ])
    })
  }

  registerEditParticipant(
    participant: FormEditParticipant<keyof TModel>,
    options: FormEditParticipantRegistrationOptions<keyof TModel> = {},
  ): DisposeFn {
    this._assertActive()
    const id = this._nextRegistrationId++
    const registration: EditParticipantRegistration<keyof TModel> = {
      id,
      participant,
      fields: options.fields ? new Set(options.fields) : null,
    }
    this._editParticipants.set(id, registration)
    try {
      if (participant.subscribeState) {
        registration.disposeState = participant.subscribeState(() => {
          if (this._editParticipants.get(id) !== registration) return
          this._handleEditParticipantStateChange()
        })
      }
      this._cancelAllValidation()
    } catch (error) {
      this._editParticipants.delete(id)
      try {
        registration.disposeState?.()
      } catch {
        // Preserve the registration failure.
      }
      throw error
    }
    return makeIdempotentDisposer(() => {
      const current = this._editParticipants.get(id)
      if (current !== registration) return
      this._editParticipants.delete(id)
      runCleanupSteps([
        ...(
          registration.disposeState
            ? [registration.disposeState]
            : []
        ),
        () => this._cancelAllValidation(),
        () => this._notify(),
      ])
    })
  }

  setExternalIssues(
    source: string,
    issues: readonly ValidationIssueInput<keyof TModel>[],
  ): void {
    this._assertActive()
    this._assertExternalSource(source)
    this.errors.setIssues(source, issues)
  }

  clearExternalIssues(source: string, field?: keyof TModel): void {
    this._assertActive()
    this._assertExternalSource(source)
    if (arguments.length > 1) {
      this.errors.clearField(field as keyof TModel, source)
      return
    }
    this.errors.clearSource(source)
  }

  validateField(
    field: keyof TModel,
    trigger: ValidationTrigger = 'submit',
  ): Promise<ValidationRunResult<keyof TModel>> {
    this._assertActive()
    if (this._isFlushingEditParticipants) {
      return Promise.resolve(this._cancelledValidationResult())
    }
    this._assertNoActiveTransaction('validate a field')
    this._cancelAllValidation()
    this._flushPendingEdits(trigger, field)
    if (this._disposed) {
      return Promise.resolve(this._cancelledValidationResult())
    }
    this._assertNoActiveTransaction('validate a field')
    return this.validation.validateField(field, trigger)
  }

  touchAndValidate(
    field: keyof TModel,
  ): Promise<ValidationRunResult<keyof TModel>> {
    this._assertActive()
    if (this._isFlushingEditParticipants) {
      return Promise.resolve(this._cancelledValidationResult())
    }
    this.edit.markTouched(field)
    return this.validateField(field, 'blur')
  }

  async validate(
    trigger: ValidationTrigger = 'submit',
    signal?: AbortSignal,
  ): Promise<ValidationRunResult<keyof TModel>> {
    this._assertActive()
    if (this._isFlushingEditParticipants) {
      return this._cancelledValidationResult()
    }
    this._assertNoActiveTransaction('validate')
    if (signal?.aborted) return this._cancelledValidationResult()

    this._cancelAllValidation()
    this._flushPendingEdits(trigger)
    if (this._disposed || signal?.aborted) {
      return this._cancelledValidationResult()
    }
    this._assertNoActiveTransaction('validate')

    const controller = new AbortController()
    this._validationController = controller
    const forwardAbort = (): void => controller.abort()
    const cancelOwnedValidation = (): void => {
      if (
        this._validationController === controller
        && !this.validation.disposed
      ) {
        this.validation.cancelPending()
      }
    }
    signal?.addEventListener('abort', forwardAbort, { once: true })
    controller.signal.addEventListener('abort', cancelOwnedValidation, { once: true })

    let failed = false
    try {
      this._notify()
      if (controller.signal.aborted) return this._cancelledValidationResult()

      const participants = [...this._participants.values()]
        .filter(registration => registration.triggers.has(trigger))
      const validationPromise = this.validation.validateAll(trigger)
      const participantPromises = participants.map(registration => (
        invokeWithAbort(
          () => registration.participant.validate(
            trigger,
            controller.signal,
          ),
          controller.signal,
        )
      ))

      const [validationResult, participantResults] = await Promise.all([
        validationPromise,
        Promise.all(participantPromises),
      ])
      const participantCancelled = participantResults.some(result => result.cancelled)
      const participantsValid = participantResults.every(result => (
        result.cancelled || result.value === true
      ))
      const superseded = validationResult.superseded
        || participantCancelled
        || controller.signal.aborted
      return {
        valid: !superseded && validationResult.valid && participantsValid,
        superseded,
        issues: this.errors.issues,
      }
    } catch (error) {
      failed = true
      try {
        controller.abort()
      } catch {
        // Preserve the validation failure.
      }
      throw error
    } finally {
      signal?.removeEventListener('abort', forwardAbort)
      controller.signal.removeEventListener('abort', cancelOwnedValidation)
      if (this._validationController === controller) {
        this._validationController = null
        if (!this._disposed) {
          try {
            this._notify()
          } catch (error) {
            if (!failed) throw error
          }
        }
      }
    }
  }

  focusFirstError(): boolean {
    this._assertActive()
    const issues = this.errors.getIssues({ severity: 'error' })
    for (const issue of issues) {
      if (issue.field === undefined) continue
      for (const registration of this._fields.values()) {
        if (
          Object.is(registration.field, issue.field)
          && registration.focus?.() === true
        ) {
          return true
        }
      }
    }

    for (const registration of this._participants.values()) {
      if (registration.participant.focusFirstError?.() === true) return true
    }
    return false
  }

  resetField(field: keyof TModel): void {
    this._assertActive()
    this._assertNoActiveTransaction('reset a field')
    runCleanupSteps([
      () => this._submitController?.abort(),
      () => this._cancelAllValidation(),
      () => this._cancelPendingEdits(field),
      () => this.validation.clearField(field),
      () => this.edit.resetField(field),
    ])
  }

  reset(): void {
    this._assertActive()
    this._assertNoActiveTransaction('reset')
    const participants = [...this._participants.values()]
    const editParticipants = [...this._editParticipants.values()]
    runCleanupSteps([
      () => this.cancelSubmit(),
      () => this._cancelAllValidation(),
      () => this._cancelPendingEdits(),
      ...editParticipants.map(registration => () => {
        if (this._editParticipants.get(registration.id) !== registration) {
          return
        }
        this._invokeEditParticipantLifecycle(registration, 'resetEdits')
      }),
      () => this.errors.clear(),
      ...participants.map(registration => () => {
        if (this._participants.get(registration.id) !== registration) return
        registration.participant.clear?.()
      }),
      () => this.edit.reset(),
    ])
  }

  acceptChanges(value?: Readonly<TModel>): void {
    this._assertActive()
    this._assertNoActiveTransaction('accept changes')
    const participants = [...this._participants.values()]
    const editParticipants = [...this._editParticipants.values()]
    runCleanupSteps([
      () => this.cancelSubmit(),
      () => this._cancelAllValidation(),
      () => this._cancelPendingEdits(),
      ...editParticipants.map(registration => () => {
        if (this._editParticipants.get(registration.id) !== registration) {
          return
        }
        this._invokeEditParticipantLifecycle(registration, 'acceptEdits')
      }),
      () => this.errors.clear(),
      ...participants.map(registration => () => {
        if (this._participants.get(registration.id) !== registration) return
        registration.participant.clear?.()
      }),
      () => this.edit.acceptChanges(value),
    ])
  }

  async runSubmit<TResult>(
    submit: (
      draft: Readonly<TModel>,
      signal: AbortSignal,
    ) => TResult | Promise<TResult>,
  ): Promise<FormSubmitResult<TResult>> {
    this._assertActive()
    if (this._isFlushingEditParticipants) {
      return { status: 'busy' }
    }
    this._assertNoActiveTransaction('submit')
    if (this._submitController) return { status: 'busy' }

    const controller = new AbortController()
    this._submitController = controller
    this._isSubmitting = true

    let failed = false
    try {
      this._markRegisteredFieldsTouched()
      this._notify()

      const validationResult = await this.validate('submit', controller.signal)
      if (controller.signal.aborted || validationResult.superseded) {
        return { status: 'cancelled' }
      }
      if (!validationResult.valid) {
        this.focusFirstError()
        return { status: 'invalid' }
      }

      if (controller.signal.aborted) return { status: 'cancelled' }
      const draft = this.edit.snapshot()
      const outcome = submit(draft, controller.signal)
      const submitResult = await awaitWithAbort(
        Promise.resolve(outcome),
        controller.signal,
      )
      if (submitResult.cancelled) return { status: 'cancelled' }
      return {
        status: 'submitted',
        value: submitResult.value as TResult,
      }
    } catch (error) {
      failed = true
      try {
        runCleanupSteps([
          () => controller.abort(),
          () => this._cancelAllValidation(),
        ])
      } catch {
        // Preserve the submit failure.
      }
      throw error
    } finally {
      if (this._submitController === controller) {
        this._submitController = null
        this._isSubmitting = false
        if (!this._disposed) {
          try {
            this._notify()
          } catch (error) {
            if (!failed) throw error
          }
        }
      }
    }
  }

  cancelSubmit(): boolean {
    this._assertActive()
    const controller = this._submitController
    if (!controller) return false
    controller.abort()
    this._cancelAllValidation()
    return true
  }

  subscribe(listener: FormSessionListener): DisposeFn {
    this._assertActive()
    this._listeners.add(listener)
    return makeIdempotentDisposer(() => this._listeners.delete(listener))
  }

  subscribeEdit(
    listener: (change: EditSessionChange<TModel>) => void,
  ): DisposeFn {
    this._assertActive()
    return this.edit.subscribe(listener)
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    const submitController = this._submitController
    const validationController = this._validationController
    const childDisposers = this._childDisposers.splice(0)
    const fields = [...this._fields.values()]
    const editParticipants = [...this._editParticipants.values()]

    this._submitController = null
    this._validationController = null
    this._isSubmitting = false
    this._listeners.clear()
    this._notificationQueue = []
    this._fields.clear()
    this._participants.clear()
    this._editParticipants.clear()

    runCleanupSteps([
      ...(
        submitController
          ? [() => submitController.abort()]
          : []
      ),
      ...(
        validationController
          ? [() => validationController.abort()]
          : []
      ),
      ...childDisposers,
      ...editParticipants.flatMap(registration => (
        registration.disposeState ? [registration.disposeState] : []
      )),
      ...fields.flatMap(registration => [
        ...(
          registration.disposeValidation
            ? [registration.disposeValidation]
            : []
        ),
        registration.disposeOrder,
      ]),
      () => this.validation.dispose(),
      () => this.errors.dispose(),
      () => this.edit.dispose(),
    ])
  }

  private _handleEditChange(change: EditSessionChange<TModel>): void {
    // Values committed by the synchronous pre-validation flush belong to the
    // validation snapshot and must not cancel the submission that requested it.
    if (change.valueChanged && !this._isFlushingEditParticipants) {
      this._submitController?.abort()
      this._cancelAllValidation()
    }
    this._notify()
  }

  private _handleEditParticipantStateChange(): void {
    if (!this._isFlushingEditParticipants) {
      this._submitController?.abort()
      this._cancelAllValidation()
    }
    this._notify()
  }

  private _flushPendingEdits(
    trigger: ValidationTrigger,
    targetField?: keyof TModel,
  ): void {
    if (this._isFlushingEditParticipants) return
    const hasTargetField = arguments.length > 1
    this._isFlushingEditParticipants = true
    try {
      const registrations = [...this._editParticipants.values()]
      for (const registration of registrations) {
        if (this._editParticipants.get(registration.id) !== registration) {
          continue
        }
        if (
          hasTargetField
          && registration.fields !== null
          && !registration.fields.has(targetField as keyof TModel)
        ) {
          continue
        }
        const result: unknown = hasTargetField
          ? registration.participant.flushPendingEdit(
            trigger,
            targetField as keyof TModel,
          )
          : registration.participant.flushPendingEdit(trigger)
        if (isPromiseLike(result)) {
          void Promise.resolve(result).catch(() => {})
          throw new TypeError(
            'Form edit participant flushPendingEdit() must complete synchronously.',
          )
        }
        if (this._disposed) return
      }
    } finally {
      this._isFlushingEditParticipants = false
    }
  }

  private _cancelPendingEdits(field?: keyof TModel): void {
    const hasField = arguments.length > 0
    const registrations = [...this._editParticipants.values()]
    runCleanupSteps(registrations.map(registration => () => {
      if (this._editParticipants.get(registration.id) !== registration) {
        return
      }
      const cancelPendingEdit = registration.participant.cancelPendingEdit
      if (!cancelPendingEdit) return
      const result: unknown = hasField
        ? cancelPendingEdit.call(registration.participant, field)
        : cancelPendingEdit.call(registration.participant)
      if (!isPromiseLike(result)) return
      void Promise.resolve(result).catch(() => {})
      throw new TypeError(
        'Form edit participant cancelPendingEdit() must complete synchronously.',
      )
    }))
  }

  private _invokeEditParticipantLifecycle(
    registration: EditParticipantRegistration<keyof TModel>,
    method: 'resetEdits' | 'acceptEdits',
  ): void {
    const operation = registration.participant[method]
    if (!operation) return
    const result: unknown = operation.call(registration.participant)
    if (!isPromiseLike(result)) return
    void Promise.resolve(result).catch(() => {})
    throw new TypeError(
      `Form edit participant ${method}() must complete synchronously.`,
    )
  }

  private _abortActiveValidation(): boolean {
    const controller = this._validationController
    if (!controller) return false
    this._validationController = null
    runCleanupSteps([
      () => controller.abort(),
      () => {
        if (!this._disposed) this._notify()
      },
    ])
    return true
  }

  private _cancelAllValidation(): void {
    runCleanupSteps([
      () => this._abortActiveValidation(),
      () => {
        if (!this.validation.disposed && this.validation.isPending) {
          this.validation.cancelPending()
        }
      },
    ])
  }

  private _markRegisteredFieldsTouched(): void {
    const fields = new Set<keyof TModel>()
    for (const registration of this._fields.values()) {
      fields.add(registration.field)
    }
    this.edit.batchUpdate(() => {
      for (const field of fields) this.edit.markTouched(field)
    })
  }

  private _cancelledValidationResult(): ValidationRunResult<keyof TModel> {
    return {
      valid: false,
      superseded: true,
      issues: this.errors.issues,
    }
  }

  private _assertExternalSource(source: string): void {
    if (this.validation.ownsSource(source)) {
      throw new Error(
        `Validation source "${source}" cannot be used for external issues.`,
      )
    }
  }

  private _assertNoActiveTransaction(operation: string): void {
    if (this.edit.hasActiveTransaction) {
      throw new Error(
        `Form session cannot ${operation} while an edit transaction is active.`,
      )
    }
  }

  private _notify(): void {
    if (this._disposed) return
    const envelope: FormNotificationEnvelope = {
      listeners: [...this._listeners],
      failed: false,
    }
    this._notificationQueue.push(envelope)
    if (this._isNotifying) return

    this._isNotifying = true
    try {
      while (this._notificationQueue.length > 0) {
        const current = this._notificationQueue.shift()
        if (!current) continue
        try {
          runCleanupSteps(current.listeners.map(listener => () => listener()))
        } catch (error) {
          current.failed = true
          current.error = error
        }
      }
    } finally {
      this._isNotifying = false
    }
    if (envelope.failed) throw envelope.error
  }

  private _assertActive(): void {
    if (this._disposed) throw new Error('Form session has been disposed.')
  }
}

function awaitWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<AwaitResult<T>> {
  if (!signal) return promise.then(value => ({ cancelled: false, value }))

  return new Promise<AwaitResult<T>>((resolve, reject) => {
    let settled = false
    const finish = (result: AwaitResult<T>): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const onAbort = (): void => finish({ cancelled: true })
    promise.then(
      value => finish({ cancelled: false, value }),
      error => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
    if (signal.aborted) finish({ cancelled: true })
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}

function invokeWithAbort<T>(
  operation: () => T | Promise<T>,
  signal: AbortSignal,
): Promise<AwaitResult<T>> {
  if (signal.aborted) return Promise.resolve({ cancelled: true })
  try {
    return awaitWithAbort(Promise.resolve(operation()), signal)
  } catch (error) {
    return Promise.reject(error)
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (
    (typeof value !== 'object' || value === null)
    && typeof value !== 'function'
  ) {
    return false
  }
  return typeof (value as { readonly then?: unknown }).then === 'function'
}

function makeIdempotentDisposer(dispose: () => void): DisposeFn {
  let active = true
  return () => {
    if (!active) return
    active = false
    dispose()
  }
}

function rethrowAfterCleanup(
  error: unknown,
  cleanupSteps: Iterable<DisposeFn>,
): never {
  try {
    runCleanupSteps(cleanupSteps)
  } catch {
    // Preserve the registration failure after completing best-effort rollback.
  }
  throw error
}
