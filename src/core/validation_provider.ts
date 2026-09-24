import {
  runCleanupSteps,
  type Disposable,
  type DisposeFn,
} from './disposable'
import {
  ErrorProvider,
  type ValidationIssue,
  type ValidationIssueInput,
} from './error_provider'

export type ValidationTrigger = 'change' | 'blur' | 'submit'

export type ValidationRuleOutcome<FieldKey = PropertyKey> =
  | string
  | ValidationIssueInput<FieldKey>
  | readonly (string | ValidationIssueInput<FieldKey>)[]
  | null
  | undefined

export interface FieldValidationContext<
  TModel extends object,
  TField extends keyof TModel,
> {
  readonly model: Readonly<TModel>
  readonly field: TField
  readonly value: TModel[TField]
  readonly trigger: ValidationTrigger
  readonly signal: AbortSignal
}

export interface FormValidationContext<TModel extends object> {
  readonly model: Readonly<TModel>
  readonly trigger: ValidationTrigger
  readonly signal: AbortSignal
}

export type FieldValidationRule<
  TModel extends object,
  TField extends keyof TModel,
> = (
  value: TModel[TField],
  context: FieldValidationContext<TModel, TField>,
) => ValidationRuleOutcome<keyof TModel> | Promise<ValidationRuleOutcome<keyof TModel>>

export type FormValidationRule<TModel extends object> = (
  model: Readonly<TModel>,
  context: FormValidationContext<TModel>,
) => ValidationRuleOutcome<keyof TModel> | Promise<ValidationRuleOutcome<keyof TModel>>

export interface FieldValidationRegistrationOptions<
  TModel extends object,
  TField extends keyof TModel,
> {
  readonly rules: readonly FieldValidationRule<TModel, TField>[]
  readonly triggers?: readonly ValidationTrigger[]
  readonly source?: string
}

export interface FormValidationRegistrationOptions<TModel extends object> {
  readonly triggers?: readonly ValidationTrigger[]
  readonly dependsOn?: readonly (keyof TModel)[]
  readonly source?: string
}

export interface ValidationProviderOptions<TModel extends object> {
  readonly getModel: () => Readonly<TModel>
  readonly errorProvider?: ErrorProvider<keyof TModel>
}

export interface ValidationRunResult<FieldKey = PropertyKey> {
  readonly valid: boolean
  readonly superseded: boolean
  readonly issues: readonly ValidationIssue<FieldKey>[]
}

type ErasedFieldRule<TModel extends object> = (
  value: TModel[keyof TModel],
  context: FieldValidationContext<TModel, keyof TModel>,
) => ValidationRuleOutcome<keyof TModel> | Promise<ValidationRuleOutcome<keyof TModel>>

interface FieldRegistration<TModel extends object> {
  readonly id: number
  readonly field: keyof TModel
  readonly source: string
  readonly triggers: ReadonlySet<ValidationTrigger>
  readonly rules: readonly ErasedFieldRule<TModel>[]
  readonly disposeFieldOrder: DisposeFn
}

interface FormRegistration<TModel extends object> {
  readonly id: number
  readonly ruleId: string
  readonly source: string
  readonly triggers: ReadonlySet<ValidationTrigger>
  readonly dependsOn: readonly (keyof TModel)[]
  readonly rule: FormValidationRule<TModel>
}

interface ActiveRun {
  readonly generation: number
  readonly controller: AbortController
}

interface PendingNotificationEnvelope {
  readonly listeners: readonly (() => void)[]
  readonly onError?: () => void
  failed: boolean
  error?: unknown
}

interface InternalRunResult {
  readonly superseded: boolean
}

const DEFAULT_TRIGGERS: readonly ValidationTrigger[] = ['change', 'blur', 'submit']

let nextValidationProviderId = 1

export class ValidationProvider<TModel extends object> implements Disposable {
  readonly errors: ErrorProvider<keyof TModel>

  private readonly _getModel: () => Readonly<TModel>
  private readonly _ownsErrorProvider: boolean
  private readonly _sourceNamespace: string
  private readonly _fieldRegistrations = new Map<
    keyof TModel,
    Set<FieldRegistration<TModel>>
  >()
  private readonly _formRegistrations = new Map<number, FormRegistration<TModel>>()
  private readonly _formRuleIds = new Set<string>()
  private readonly _ownedSources = new Set<string>()
  private readonly _fieldRuns = new Map<keyof TModel, ActiveRun>()
  private readonly _fieldGenerations = new Map<keyof TModel, number>()
  private readonly _formRuns = new Map<number, ActiveRun>()
  private readonly _formGenerations = new Map<number, number>()
  private readonly _pendingListeners = new Set<() => void>()
  private _pendingNotificationQueue: PendingNotificationEnvelope[] = []
  private _isNotifyingPending = false
  private _nextRegistrationId = 1
  private _disposed = false

  constructor(options: ValidationProviderOptions<TModel>) {
    this._getModel = options.getModel
    this.errors = options.errorProvider ?? new ErrorProvider<keyof TModel>()
    this._ownsErrorProvider = options.errorProvider === undefined
    this._sourceNamespace = `validation:${nextValidationProviderId++}`
  }

  get disposed(): boolean {
    return this._disposed
  }

  get isPending(): boolean {
    return this.pendingCount > 0
  }

  get pendingCount(): number {
    return this._fieldRuns.size + this._formRuns.size
  }

  isFieldPending(field: keyof TModel): boolean {
    if (this._fieldRuns.has(field)) return true
    for (const registrationId of this._formRuns.keys()) {
      const registration = this._formRegistrations.get(registrationId)
      if (registration?.dependsOn.some(candidate => Object.is(candidate, field))) return true
    }
    return false
  }

  registerField<TField extends keyof TModel>(
    field: TField,
    options: FieldValidationRegistrationOptions<TModel, TField>,
  ): DisposeFn {
    this._assertActive()
    if (options.rules.length === 0) {
      throw new Error('A field validation registration requires at least one rule.')
    }

    const id = this._nextRegistrationId++
    const source = options.source ?? `${this._sourceNamespace}:field:${String(field)}:${id}`
    this._claimSource(source)
    let disposeFieldOrder: DisposeFn
    try {
      disposeFieldOrder = this.errors.registerField(field)
    } catch (error) {
      this._ownedSources.delete(source)
      throw error
    }
    const registration: FieldRegistration<TModel> = {
      id,
      field,
      source,
      triggers: normalizeTriggers(options.triggers),
      rules: options.rules as unknown as readonly ErasedFieldRule<TModel>[],
      disposeFieldOrder,
    }
    let registrations = this._fieldRegistrations.get(field)
    if (!registrations) {
      registrations = new Set()
      this._fieldRegistrations.set(field, registrations)
    }
    registrations.add(registration)

    let active = true
    return () => {
      if (!active) return
      active = false
      if (this._disposed) return
      const current = this._fieldRegistrations.get(field)
      current?.delete(registration)
      if (current?.size === 0) {
        this._fieldRegistrations.delete(field)
        this._fieldGenerations.delete(field)
      }
      this._ownedSources.delete(source)
      runCleanupSteps([
        () => this._cancelFieldRun(field),
        () => this._clearOwnedSource(source),
        registration.disposeFieldOrder,
      ])
    }
  }

  registerFormRule(
    ruleId: string,
    rule: FormValidationRule<TModel>,
    options: FormValidationRegistrationOptions<TModel> = {},
  ): DisposeFn {
    this._assertActive()
    if (!ruleId.trim()) throw new Error('Form validation rule id must not be empty.')
    if (this._formRuleIds.has(ruleId)) {
      throw new Error(`Form validation rule "${ruleId}" is already registered.`)
    }

    const id = this._nextRegistrationId++
    const source = options.source ?? `${this._sourceNamespace}:form:${ruleId}`
    this._claimSource(source)
    const registration: FormRegistration<TModel> = {
      id,
      ruleId,
      source,
      triggers: normalizeTriggers(options.triggers),
      dependsOn: [...(options.dependsOn ?? [])],
      rule,
    }
    this._formRegistrations.set(id, registration)
    this._formRuleIds.add(ruleId)

    let active = true
    return () => {
      if (!active) return
      active = false
      if (this._disposed) return
      this._formRegistrations.delete(id)
      this._formGenerations.delete(id)
      this._formRuleIds.delete(ruleId)
      this._ownedSources.delete(source)
      runCleanupSteps([
        () => this._cancelFormRun(id),
        () => this._clearOwnedSource(source),
      ])
    }
  }

  async validateField(
    field: keyof TModel,
    trigger: ValidationTrigger = 'submit',
  ): Promise<ValidationRunResult<keyof TModel>> {
    this._assertActive()
    const controller = new AbortController()
    const runs: Promise<InternalRunResult>[] = []
    const fieldRegistrations = [...(this._fieldRegistrations.get(field) ?? [])]
      .filter(registration => registration.triggers.has(trigger))
    if (fieldRegistrations.length > 0) {
      runs.push(this._runField(
        field,
        fieldRegistrations,
        trigger,
        controller.signal,
      ))
    }

    for (const registration of this._formRegistrations.values()) {
      if (
        registration.triggers.has(trigger) &&
        registration.dependsOn.some(candidate => Object.is(candidate, field))
      ) {
        runs.push(this._runFormRegistration(
          registration,
          trigger,
          controller.signal,
        ))
      }
    }

    const results = await settleValidationRuns(runs, controller)
    return this._createResult(results.some(result => result.superseded))
  }

  async validateAll(
    trigger: ValidationTrigger = 'submit',
  ): Promise<ValidationRunResult<keyof TModel>> {
    this._assertActive()
    const controller = new AbortController()
    const runs: Promise<InternalRunResult>[] = []
    for (const [field, registrations] of this._fieldRegistrations) {
      const matching = [...registrations].filter(registration => registration.triggers.has(trigger))
      if (matching.length > 0) {
        runs.push(this._runField(
          field,
          matching,
          trigger,
          controller.signal,
        ))
      }
    }
    for (const registration of this._formRegistrations.values()) {
      if (registration.triggers.has(trigger)) {
        runs.push(this._runFormRegistration(
          registration,
          trigger,
          controller.signal,
        ))
      }
    }

    const results = await settleValidationRuns(runs, controller)
    return this._createResult(results.some(result => result.superseded))
  }

  clearField(field: keyof TModel): void {
    this._assertActive()
    let failed = false
    let firstError: unknown
    const clear = (operation: () => void): void => {
      try {
        operation()
      } catch (error) {
        if (failed) return
        failed = true
        firstError = error
      }
    }

    clear(() => this.cancelPending(field))
    for (const registration of this._fieldRegistrations.get(field) ?? []) {
      clear(() => this._clearOwnedSource(registration.source))
    }
    for (const registration of this._formRegistrations.values()) {
      if (
        registration.dependsOn.some(candidate => Object.is(candidate, field))
      ) {
        clear(() => this._clearOwnedSource(registration.source))
      }
    }

    if (failed) throw firstError
  }

  ownsSource(source: string): boolean {
    return this._ownedSources.has(source)
  }

  cancelPending(field?: keyof TModel): void {
    this._assertActive()
    if (arguments.length === 0) {
      this._cancelAllRuns()
      return
    }

    const targetField = field as keyof TModel
    const fieldRun = this._fieldRuns.get(targetField)
    const formRuns = [...this._formRuns.entries()].filter(([registrationId]) => {
      const registration = this._formRegistrations.get(registrationId)
      return registration?.dependsOn.some(candidate => Object.is(candidate, field))
    })
    if (!fieldRun && formRuns.length === 0) return
    runCleanupSteps([
      ...(
        fieldRun
          ? [() => this._cancelFieldRun(targetField, false, fieldRun)]
          : []
      ),
      ...formRuns.map(([registrationId, activeRun]) => (
        () => this._cancelFormRun(registrationId, false, activeRun)
      )),
      () => {
        if (!this._disposed) this._notifyPending()
      },
    ])
  }

  subscribePending(listener: () => void): DisposeFn {
    this._assertActive()
    this._pendingListeners.add(listener)
    return () => this._pendingListeners.delete(listener)
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    const activeRuns = [
      ...this._fieldRuns.values(),
      ...this._formRuns.values(),
    ]
    const ownedSources = [...this._ownedSources]
    const fieldOrderDisposers = [...this._fieldRegistrations.values()]
      .flatMap(registrations => (
        [...registrations].map(registration => registration.disposeFieldOrder)
      ))

    this._pendingListeners.clear()
    this._pendingNotificationQueue = []
    this._fieldRuns.clear()
    this._formRuns.clear()
    this._fieldRegistrations.clear()
    this._formRegistrations.clear()
    this._formRuleIds.clear()
    this._ownedSources.clear()
    this._fieldGenerations.clear()
    this._formGenerations.clear()

    runCleanupSteps([
      ...activeRuns.map(run => () => run.controller.abort()),
      ...ownedSources.map(source => () => this._clearOwnedSource(source)),
      ...fieldOrderDisposers,
      ...(
        this._ownsErrorProvider
          ? [() => this.errors.dispose()]
          : []
      ),
    ])
  }

  private async _runField(
    field: keyof TModel,
    registrations: readonly FieldRegistration<TModel>[],
    trigger: ValidationTrigger,
    parentSignal?: AbortSignal,
  ): Promise<InternalRunResult> {
    const activeRun = this._beginFieldRun(field)
    const unlinkParent = linkAbortSignal(parentSignal, activeRun.controller)
    let failed = false
    try {
      const model = this._getModel()
      const value = model[field]
      const results = await Promise.all(registrations.map(async registration => {
        const outcomes = await Promise.all(registration.rules.map(rule => (
          invokeWithAbort(
            () => rule(value, {
              model,
              field,
              value,
              trigger,
              signal: activeRun.controller.signal,
            }),
            activeRun.controller.signal,
          )
        )))
        return {
          registration,
          issues: outcomes.flatMap(outcome => normalizeOutcome(outcome, field)),
        }
      }))

      if (!this._isCurrentFieldRun(field, activeRun)) return { superseded: true }
      for (const result of results) {
        if (!this._isCurrentFieldRun(field, activeRun)) {
          return { superseded: true }
        }
        this.errors.setIssues(result.registration.source, result.issues)
      }
      if (!this._isCurrentFieldRun(field, activeRun)) return { superseded: true }
      return { superseded: false }
    } catch (error) {
      if (activeRun.controller.signal.aborted) return { superseded: true }
      failed = true
      try {
        activeRun.controller.abort()
      } catch {
        // Preserve the rule or issue-projection failure.
      }
      throw error
    } finally {
      unlinkParent()
      try {
        this._finishFieldRun(field, activeRun)
      } catch (error) {
        if (!failed) throw error
      }
    }
  }

  private async _runFormRegistration(
    registration: FormRegistration<TModel>,
    trigger: ValidationTrigger,
    parentSignal?: AbortSignal,
  ): Promise<InternalRunResult> {
    const activeRun = this._beginFormRun(registration.id)
    const unlinkParent = linkAbortSignal(parentSignal, activeRun.controller)
    let failed = false
    try {
      const model = this._getModel()
      const outcome = await invokeWithAbort(
        () => registration.rule(model, {
          model,
          trigger,
          signal: activeRun.controller.signal,
        }),
        activeRun.controller.signal,
      )
      if (!this._isCurrentFormRun(registration.id, activeRun)) return { superseded: true }
      this.errors.setIssues(registration.source, normalizeOutcome(outcome))
      if (!this._isCurrentFormRun(registration.id, activeRun)) {
        return { superseded: true }
      }
      return { superseded: false }
    } catch (error) {
      if (activeRun.controller.signal.aborted) return { superseded: true }
      failed = true
      try {
        activeRun.controller.abort()
      } catch {
        // Preserve the rule or issue-projection failure.
      }
      throw error
    } finally {
      unlinkParent()
      try {
        this._finishFormRun(registration.id, activeRun)
      } catch (error) {
        if (!failed) throw error
      }
    }
  }

  private _beginFieldRun(field: keyof TModel): ActiveRun {
    return this._beginRun(
      this._fieldRuns,
      this._fieldGenerations,
      field,
    )
  }

  private _beginFormRun(registrationId: number): ActiveRun {
    return this._beginRun(
      this._formRuns,
      this._formGenerations,
      registrationId,
    )
  }

  private _beginRun<TKey>(
    runs: Map<TKey, ActiveRun>,
    generations: Map<TKey, number>,
    key: TKey,
  ): ActiveRun {
    const previous = runs.get(key)
    const generation = (generations.get(key) ?? 0) + 1
    generations.set(key, generation)
    const activeRun = { generation, controller: new AbortController() }
    runs.set(key, activeRun)
    const rollbackRun = (): void => {
      const removed = runs.get(key) === activeRun
      if (removed) runs.delete(key)
      runCleanupSteps([
        () => activeRun.controller.abort(),
        ...(
          removed && !this._disposed
            ? [() => this._notifyPending()]
            : []
        ),
      ])
    }
    try {
      previous?.controller.abort()
      if (!this._disposed && runs.get(key) === activeRun) {
        this._notifyPending(rollbackRun)
      }
    } catch (error) {
      try {
        rollbackRun()
      } catch {
        // Preserve the notification failure that prevented the run from starting.
      }
      throw error
    }
    return activeRun
  }

  private _finishFieldRun(field: keyof TModel, activeRun: ActiveRun): void {
    if (!this._isCurrentFieldRun(field, activeRun)) return
    this._fieldRuns.delete(field)
    this._notifyPending()
  }

  private _finishFormRun(registrationId: number, activeRun: ActiveRun): void {
    if (!this._isCurrentFormRun(registrationId, activeRun)) return
    this._formRuns.delete(registrationId)
    this._notifyPending()
  }

  private _isCurrentFieldRun(field: keyof TModel, activeRun: ActiveRun): boolean {
    return !this._disposed && this._fieldRuns.get(field) === activeRun
  }

  private _isCurrentFormRun(registrationId: number, activeRun: ActiveRun): boolean {
    return !this._disposed && this._formRuns.get(registrationId) === activeRun
  }

  private _cancelFieldRun(
    field: keyof TModel,
    notify = true,
    expectedRun?: ActiveRun,
  ): boolean {
    const activeRun = this._fieldRuns.get(field)
    if (!activeRun || (expectedRun && activeRun !== expectedRun)) return false
    this._fieldRuns.delete(field)
    runCleanupSteps([
      () => activeRun.controller.abort(),
      ...(
        notify && !this._disposed
          ? [() => this._notifyPending()]
          : []
      ),
    ])
    return true
  }

  private _cancelFormRun(
    registrationId: number,
    notify = true,
    expectedRun?: ActiveRun,
  ): boolean {
    const activeRun = this._formRuns.get(registrationId)
    if (!activeRun || (expectedRun && activeRun !== expectedRun)) return false
    this._formRuns.delete(registrationId)
    runCleanupSteps([
      () => activeRun.controller.abort(),
      ...(
        notify && !this._disposed
          ? [() => this._notifyPending()]
          : []
      ),
    ])
    return true
  }

  private _cancelAllRuns(): void {
    if (this.pendingCount === 0) return
    const activeRuns = [
      ...this._fieldRuns.values(),
      ...this._formRuns.values(),
    ]
    this._fieldRuns.clear()
    this._formRuns.clear()
    runCleanupSteps([
      ...activeRuns.map(activeRun => () => activeRun.controller.abort()),
      ...(
        this._disposed
          ? []
          : [() => this._notifyPending()]
      ),
    ])
  }

  private _claimSource(source: string): void {
    if (!source.trim()) throw new Error('Validation source must not be empty.')
    if (this._ownedSources.has(source)) {
      throw new Error(`Validation source "${source}" is already registered.`)
    }
    if (this.errors.getIssues({ source }).length > 0) {
      throw new Error(
        `Validation source "${source}" is already used by external issues.`,
      )
    }
    this._ownedSources.add(source)
  }

  private _clearOwnedSource(source: string): void {
    if (this.errors.disposed) return
    this.errors.clearSource(source)
  }

  private _createResult(superseded: boolean): ValidationRunResult<keyof TModel> {
    const effectiveSuperseded = superseded || this._disposed
    return {
      valid: !effectiveSuperseded && !this.errors.hasErrors,
      superseded: effectiveSuperseded,
      issues: this.errors.issues,
    }
  }

  private _notifyPending(onError?: () => void): void {
    const reentrant = this._isNotifyingPending
    const envelope: PendingNotificationEnvelope = {
      listeners: [...this._pendingListeners],
      // Reentrant notifications cannot report failure to their owner before
      // that synchronous owner returns. Preserve the committed nested run
      // instead of rolling it back later and leaving upper layers half-bound.
      onError: reentrant ? undefined : onError,
      failed: false,
    }
    this._pendingNotificationQueue.push(envelope)
    if (reentrant) return

    this._isNotifyingPending = true
    try {
      while (this._pendingNotificationQueue.length > 0) {
        const current = this._pendingNotificationQueue.shift()
        if (!current) continue
        try {
          runCleanupSteps(current.listeners.map(listener => () => listener()))
        } catch (error) {
          current.failed = true
          current.error = error
          try {
            current.onError?.()
          } catch {
            // Preserve the listener failure owned by this notification.
          }
        }
      }
    } finally {
      this._isNotifyingPending = false
    }
    if (envelope.failed) throw envelope.error
  }

  private _assertActive(): void {
    if (this._disposed) throw new Error('Validation provider has been disposed.')
  }
}

function normalizeTriggers(
  triggers?: readonly ValidationTrigger[],
): ReadonlySet<ValidationTrigger> {
  return new Set(triggers ?? DEFAULT_TRIGGERS)
}

function normalizeOutcome<FieldKey>(
  outcome: ValidationRuleOutcome<FieldKey>,
  defaultField?: FieldKey,
): readonly ValidationIssueInput<FieldKey>[] {
  if (outcome === null || outcome === undefined) return []
  const values = typeof outcome === 'string' || !Array.isArray(outcome)
    ? [outcome]
    : outcome
  return values.map(value => {
    if (typeof value === 'string') {
      return {
        field: defaultField,
        message: value,
        severity: 'error',
      }
    }
    if (!value || typeof value !== 'object') {
      throw new TypeError('Validation rules must return a string, issue, issue array, or nothing.')
    }
    if (typeof value.message !== 'string') {
      throw new TypeError('Validation issue message must be a string.')
    }
    return {
      field: value.field ?? defaultField,
      code: value.code,
      message: value.message,
      severity: value.severity ?? 'error',
    }
  })
}

const VALIDATION_ABORTED = Symbol('validation-aborted')

async function settleValidationRuns(
  runs: readonly Promise<InternalRunResult>[],
  controller: AbortController,
): Promise<InternalRunResult[]> {
  try {
    return await Promise.all(runs)
  } catch (error) {
    controller.abort()
    await Promise.allSettled(runs)
    throw error
  }
}

function linkAbortSignal(
  parentSignal: AbortSignal | undefined,
  controller: AbortController,
): DisposeFn {
  if (!parentSignal) return () => {}
  const abort = (): void => controller.abort()
  if (parentSignal.aborted) {
    abort()
    return () => {}
  }
  parentSignal.addEventListener('abort', abort, { once: true })
  return () => parentSignal.removeEventListener('abort', abort)
}

function invokeWithAbort<T>(
  operation: () => T | Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(VALIDATION_ABORTED)
  try {
    return awaitWithAbort(operation(), signal)
  } catch (error) {
    return Promise.reject(error)
  }
}

function awaitWithAbort<T>(value: T | Promise<T>, signal: AbortSignal): Promise<T> {
  const source = Promise.resolve(value)
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (complete: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      complete()
    }
    const abort = (): void => {
      finish(() => reject(VALIDATION_ABORTED))
    }
    source.then(
      result => {
        finish(() => resolve(result))
      },
      error => {
        finish(() => reject(error))
      },
    )
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}
