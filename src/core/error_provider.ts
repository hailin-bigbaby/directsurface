import {
  runCleanupSteps,
  type Disposable,
  type DisposeFn,
} from './disposable'

export type ValidationIssueSeverity = 'error' | 'warning' | 'info'

export interface ValidationIssue<FieldKey = PropertyKey> {
  readonly field?: FieldKey
  readonly source: string
  readonly code?: string
  readonly message: string
  readonly severity: ValidationIssueSeverity
}

export interface ValidationIssueInput<FieldKey = PropertyKey> {
  readonly field?: FieldKey
  readonly code?: string
  readonly message: string
  readonly severity?: ValidationIssueSeverity
}

export interface ValidationIssueFilter<FieldKey = PropertyKey> {
  readonly field?: FieldKey
  readonly source?: string
  readonly severity?: ValidationIssueSeverity | readonly ValidationIssueSeverity[]
  readonly scope?: 'field' | 'form'
}

interface RegisteredField {
  readonly order: number
  count: number
}

interface OrderedIssue<FieldKey> {
  readonly issue: ValidationIssue<FieldKey>
  readonly issueOrder: number
  readonly sourceOrder: number
}

interface ErrorNotificationEnvelope {
  readonly listeners: readonly (() => void)[]
  readonly onError?: () => void
  failed: boolean
  error?: unknown
}

export class ErrorProvider<FieldKey = PropertyKey> implements Disposable {
  private readonly _issuesBySource = new Map<string, readonly ValidationIssue<FieldKey>[]>()
  private readonly _sourceOrder = new Map<string, number>()
  private readonly _registeredFields = new Map<FieldKey, RegisteredField>()
  private readonly _observedFieldOrder = new Map<FieldKey, number>()
  private readonly _listeners = new Set<() => void>()
  private _notificationQueue: ErrorNotificationEnvelope[] = []
  private _isNotifying = false
  private _nextSourceOrder = 0
  private _nextFieldOrder = 0
  private _version = 0
  private _disposed = false

  get disposed(): boolean {
    return this._disposed
  }

  get version(): number {
    return this._version
  }

  get issues(): readonly ValidationIssue<FieldKey>[] {
    return this._orderedIssues()
  }

  get hasErrors(): boolean {
    for (const issues of this._issuesBySource.values()) {
      if (issues.some(issue => issue.severity === 'error')) return true
    }
    return false
  }

  get hasIssues(): boolean {
    return this._issuesBySource.size > 0
  }

  setIssues(source: string, issues: readonly ValidationIssueInput<FieldKey>[]): void {
    this._assertActive()
    this._assertSource(source)

    const normalized = issues.map(issue => this._normalizeIssue(source, issue))
    const current = this._issuesBySource.get(source)
    if (current && issuesEqual(current, normalized)) return
    if (!current && normalized.length === 0) return

    if (!this._sourceOrder.has(source)) {
      this._sourceOrder.set(source, this._nextSourceOrder++)
    }
    for (const issue of normalized) this._observeField(issue.field)

    if (normalized.length === 0) {
      this._issuesBySource.delete(source)
      this._sourceOrder.delete(source)
    } else {
      this._issuesBySource.set(source, normalized)
    }
    this._notify()
  }

  clearSource(source: string): void {
    this._assertActive()
    this._assertSource(source)
    if (!this._issuesBySource.delete(source)) return
    this._sourceOrder.delete(source)
    this._notify()
  }

  clearField(field: FieldKey, source?: string): void {
    this._assertActive()
    if (source !== undefined) {
      this._clearMatching(source, issue => Object.is(issue.field, field))
      return
    }

    let changed = false
    for (const [currentSource, issues] of this._issuesBySource) {
      const next = issues.filter(issue => !Object.is(issue.field, field))
      if (next.length === issues.length) continue
      changed = true
      if (next.length === 0) {
        this._issuesBySource.delete(currentSource)
        this._sourceOrder.delete(currentSource)
      } else {
        this._issuesBySource.set(currentSource, next)
      }
    }
    if (changed) this._notify()
  }

  clearForm(source?: string): void {
    this._assertActive()
    if (source !== undefined) {
      this._clearMatching(source, issue => issue.field === undefined)
      return
    }

    let changed = false
    for (const [currentSource, issues] of this._issuesBySource) {
      const next = issues.filter(issue => issue.field !== undefined)
      if (next.length === issues.length) continue
      changed = true
      if (next.length === 0) {
        this._issuesBySource.delete(currentSource)
        this._sourceOrder.delete(currentSource)
      } else {
        this._issuesBySource.set(currentSource, next)
      }
    }
    if (changed) this._notify()
  }

  clear(): void {
    this._assertActive()
    if (this._issuesBySource.size === 0) return
    this._issuesBySource.clear()
    this._sourceOrder.clear()
    this._notify()
  }

  getIssues(filter: ValidationIssueFilter<FieldKey> = {}): readonly ValidationIssue<FieldKey>[] {
    const hasFieldFilter = Object.prototype.hasOwnProperty.call(filter, 'field')
    const severities = normalizeSeverities(filter.severity)
    return this._orderedIssues().filter(issue => {
      if (filter.source !== undefined && issue.source !== filter.source) return false
      if (filter.scope === 'field' && issue.field === undefined) return false
      if (filter.scope === 'form' && issue.field !== undefined) return false
      if (hasFieldFilter && !Object.is(issue.field, filter.field)) return false
      if (severities && !severities.has(issue.severity)) return false
      return true
    })
  }

  getFieldIssues(field: FieldKey): readonly ValidationIssue<FieldKey>[] {
    return this.getIssues({ field })
  }

  getFormIssues(): readonly ValidationIssue<FieldKey>[] {
    return this.getIssues({ scope: 'form' })
  }

  firstIssue(filter: ValidationIssueFilter<FieldKey> = {}): ValidationIssue<FieldKey> | undefined {
    return this.getIssues(filter)[0]
  }

  firstError(field?: FieldKey): ValidationIssue<FieldKey> | undefined {
    if (arguments.length > 0) return this.firstIssue({ field, severity: 'error' })
    return this.firstIssue({ severity: 'error' })
  }

  registerField(field: FieldKey): DisposeFn {
    this._assertActive()
    const existing = this._registeredFields.get(field)
    if (existing) {
      existing.count++
      return makeIdempotentDisposer(() => {
        if (this._disposed) return
        const current = this._registeredFields.get(field)
        if (current !== existing) return
        current.count--
        if (current.count > 0) return
        this._registeredFields.delete(field)
        if (this.hasIssues) this._notify()
      })
    }

    const registration: RegisteredField = {
      order: this._nextFieldOrder++,
      count: 1,
    }
    this._registeredFields.set(field, registration)
    const fieldWasObserved = this._observedFieldOrder.has(field)
    this._observeField(field)
    const rollbackRegistration = (): void => {
      const current = this._registeredFields.get(field)
      if (current === registration) {
        current.count--
        if (current.count === 0) {
          this._registeredFields.delete(field)
          if (!fieldWasObserved) this._observedFieldOrder.delete(field)
        }
      }
    }
    if (this.hasIssues) this._notify(rollbackRegistration)

    return makeIdempotentDisposer(() => {
      if (this._disposed) return
      const current = this._registeredFields.get(field)
      if (current !== registration) return
      current.count--
      if (current.count > 0) return
      this._registeredFields.delete(field)
      if (this.hasIssues) this._notify()
    })
  }

  subscribe(listener: () => void): DisposeFn {
    this._assertActive()
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._issuesBySource.clear()
    this._sourceOrder.clear()
    this._registeredFields.clear()
    this._observedFieldOrder.clear()
    this._listeners.clear()
    this._notificationQueue = []
  }

  private _orderedIssues(): readonly ValidationIssue<FieldKey>[] {
    const entries: OrderedIssue<FieldKey>[] = []
    for (const [source, issues] of this._issuesBySource) {
      const sourceOrder = this._sourceOrder.get(source) ?? Number.MAX_SAFE_INTEGER
      for (let issueOrder = 0; issueOrder < issues.length; issueOrder++) {
        const issue = issues[issueOrder]
        if (!issue) continue
        entries.push({ issue, issueOrder, sourceOrder })
      }
    }

    entries.sort((left, right) => {
      const fieldOrder = this._fieldRank(left.issue.field) - this._fieldRank(right.issue.field)
      if (fieldOrder !== 0) return fieldOrder
      const sourceOrder = left.sourceOrder - right.sourceOrder
      if (sourceOrder !== 0) return sourceOrder
      return left.issueOrder - right.issueOrder
    })
    return entries.map(entry => entry.issue)
  }

  private _fieldRank(field: FieldKey | undefined): number {
    if (field === undefined) return Number.MAX_SAFE_INTEGER
    const registered = this._registeredFields.get(field)
    if (registered) return registered.order
    const observed = this._observedFieldOrder.get(field) ?? Number.MAX_SAFE_INTEGER
    return this._nextFieldOrder + observed
  }

  private _clearMatching(
    source: string,
    predicate: (issue: ValidationIssue<FieldKey>) => boolean,
  ): void {
    this._assertSource(source)
    const issues = this._issuesBySource.get(source)
    if (!issues) return
    const next = issues.filter(issue => !predicate(issue))
    if (next.length === issues.length) return
    if (next.length === 0) {
      this._issuesBySource.delete(source)
      this._sourceOrder.delete(source)
    } else {
      this._issuesBySource.set(source, next)
    }
    this._notify()
  }

  private _normalizeIssue(
    source: string,
    issue: ValidationIssueInput<FieldKey>,
  ): ValidationIssue<FieldKey> {
    if (typeof issue.message !== 'string') {
      throw new TypeError('Validation issue message must be a string.')
    }
    return {
      field: issue.field,
      source,
      code: issue.code,
      message: issue.message,
      severity: issue.severity ?? 'error',
    }
  }

  private _observeField(field: FieldKey | undefined): void {
    if (field === undefined || this._observedFieldOrder.has(field)) return
    this._observedFieldOrder.set(field, this._observedFieldOrder.size)
  }

  private _notify(onError?: () => void): void {
    this._version++
    const reentrant = this._isNotifying
    const envelope: ErrorNotificationEnvelope = {
      listeners: [...this._listeners],
      // A reentrant caller resumes before its envelope can be dispatched.
      // Keep that mutation committed rather than applying a delayed rollback
      // after an upper layer has already observed a successful return.
      onError: reentrant ? undefined : onError,
      failed: false,
    }
    this._notificationQueue.push(envelope)
    if (reentrant) return

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
          try {
            current.onError?.()
          } catch {
            // Preserve the listener failure owned by this notification.
          }
        }
      }
    } finally {
      this._isNotifying = false
    }
    if (envelope.failed) throw envelope.error
  }

  private _assertSource(source: string): void {
    if (!source.trim()) throw new Error('Validation issue source must not be empty.')
  }

  private _assertActive(): void {
    if (this._disposed) throw new Error('Error provider has been disposed.')
  }
}

function normalizeSeverities(
  severity?: ValidationIssueSeverity | readonly ValidationIssueSeverity[],
): ReadonlySet<ValidationIssueSeverity> | undefined {
  if (severity === undefined) return undefined
  return new Set(Array.isArray(severity) ? severity : [severity])
}

function issuesEqual<FieldKey>(
  left: readonly ValidationIssue<FieldKey>[],
  right: readonly ValidationIssue<FieldKey>[],
): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) {
    const leftIssue = left[index]
    const rightIssue = right[index]
    if (
      !leftIssue ||
      !rightIssue ||
      !Object.is(leftIssue.field, rightIssue.field) ||
      leftIssue.source !== rightIssue.source ||
      leftIssue.code !== rightIssue.code ||
      leftIssue.message !== rightIssue.message ||
      leftIssue.severity !== rightIssue.severity
    ) {
      return false
    }
  }
  return true
}

function makeIdempotentDisposer(dispose: () => void): DisposeFn {
  let active = true
  return () => {
    if (!active) return
    active = false
    dispose()
  }
}
