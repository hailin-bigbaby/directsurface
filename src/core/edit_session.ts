import type { Disposable } from './disposable'

export type EditSessionFieldEquality<T extends object> = (
  field: keyof T,
  left: T[keyof T],
  right: T[keyof T],
) => boolean

export interface EditSessionOptions<T extends object> {
  clone?: (value: Readonly<T>) => T
  equals?: EditSessionFieldEquality<T>
}

export interface EditSessionChange<T extends object> {
  readonly fields: ReadonlySet<keyof T>
  readonly valueChanged: boolean
  readonly dirtyChanged: boolean
  readonly touchedChanged: boolean
}

export type EditSessionListener<T extends object> = (
  change: EditSessionChange<T>,
) => void

export type EditSessionFieldListener<
  T extends object,
  K extends keyof T,
> = (
  value: T[K],
  change: EditSessionChange<T>,
) => void

export interface EditSessionTransaction<T extends object> {
  readonly active: boolean
  getValue<K extends keyof T>(field: K): T[K]
  setValue<K extends keyof T>(field: K, value: T[K]): void
  setValues(values: Readonly<Partial<T>>): void
  markTouched<K extends keyof T>(field: K, touched?: boolean): void
  commit(): void
  rollback(): void
}

interface EditSessionBatchSnapshot<T extends object> {
  draft: T
  dirtyFields: Set<keyof T>
  touchedFields: Set<keyof T>
}

type AnyFieldListener<T extends object> = (
  value: T[keyof T],
  change: EditSessionChange<T>,
) => void

interface EditSessionNotification<T extends object> {
  readonly change: EditSessionChange<T>
  readonly listeners: readonly EditSessionListener<T>[]
  readonly fields: readonly {
    value: T[keyof T]
    listeners: readonly AnyFieldListener<T>[]
  }[]
}

export class EditSession<T extends object> implements Disposable {
  private readonly _clone: (value: Readonly<T>) => T
  private readonly _equals: EditSessionFieldEquality<T>
  private _baseline: T
  private _draft: T
  private _dirtyFields = new Set<keyof T>()
  private _touchedFields = new Set<keyof T>()
  private _listeners = new Set<EditSessionListener<T>>()
  private _fieldListeners = new Map<keyof T, Set<AnyFieldListener<T>>>()
  private _batchDepth = 0
  private _batchSnapshot: EditSessionBatchSnapshot<T> | null = null
  private _activeTransaction: EditSessionTransaction<T> | null = null
  private _notificationQueue: EditSessionNotification<T>[] = []
  private _isNotifying = false
  private _disposed = false

  constructor(initialValue: Readonly<T>, options: EditSessionOptions<T> = {}) {
    this._clone = options.clone ?? shallowClone
    this._equals = options.equals ?? defaultFieldEquality
    this._baseline = this._clone(initialValue)
    this._draft = this._clone(initialValue)
  }

  get isDirty(): boolean {
    return this._dirtyFields.size > 0
  }

  get isTouched(): boolean {
    return this._touchedFields.size > 0
  }

  get disposed(): boolean {
    return this._disposed
  }

  get hasActiveTransaction(): boolean {
    return this._activeTransaction !== null
  }

  getValue<K extends keyof T>(field: K): T[K] {
    return this._draft[field]
  }

  setValue<K extends keyof T>(field: K, value: T[K]): void {
    this.batchUpdate(() => {
      this._setValue(field, value)
    })
  }

  setValues(values: Readonly<Partial<T>>): void {
    this.batchUpdate(() => {
      for (const field of enumerableOwnKeys(values)) {
        this._setValue(field, values[field] as T[typeof field])
      }
    })
  }

  batchUpdate<Result>(update: () => Result): Result {
    this._assertUsable()
    this._assertNoActiveTransaction()
    if (isAsyncFunction(update)) {
      throw new TypeError('EditSession.batchUpdate() callback must be synchronous.')
    }
    this._beginBatch()
    let result!: Result
    let failed = false
    let firstError: unknown
    try {
      result = update()
      if (isPromiseLike(result)) {
        consumePromiseRejection(result)
        throw new TypeError('EditSession.batchUpdate() callback must be synchronous.')
      }
    } catch (error) {
      failed = true
      firstError = error
    }

    if (!this._disposed) {
      try {
        this._endBatch()
      } catch (error) {
        if (!failed) {
          failed = true
          firstError = error
        }
      }
    }

    if (failed) throw firstError
    return result
  }

  isFieldDirty<K extends keyof T>(field: K): boolean {
    return this._dirtyFields.has(field)
  }

  isFieldTouched<K extends keyof T>(field: K): boolean {
    return this._touchedFields.has(field)
  }

  markTouched<K extends keyof T>(field: K, touched = true): void {
    this.batchUpdate(() => {
      if (touched) this._touchedFields.add(field)
      else this._touchedFields.delete(field)
    })
  }

  resetField<K extends keyof T>(field: K): void {
    this.batchUpdate(() => {
      const baseline = this._clone(this._baseline)
      this._setValue(field, baseline[field])
      this._dirtyFields.delete(field)
      this._touchedFields.delete(field)
    })
  }

  reset(): void {
    this.batchUpdate(() => {
      this._draft = this._clone(this._baseline)
      this._dirtyFields.clear()
      this._touchedFields.clear()
    })
  }

  acceptChanges(value?: Readonly<T>): void {
    this.batchUpdate(() => {
      const accepted = value ?? this._draft
      this._baseline = this._clone(accepted)
      this._draft = this._clone(accepted)
      this._dirtyFields.clear()
      this._touchedFields.clear()
    })
  }

  snapshot(): T {
    return this._clone(this._draft)
  }

  subscribe(listener: EditSessionListener<T>): () => void {
    this._assertUsable()
    this._listeners.add(listener)
    return makeIdempotentUnsubscribe(() => this._listeners.delete(listener))
  }

  subscribeField<K extends keyof T>(
    field: K,
    listener: EditSessionFieldListener<T, K>,
  ): () => void {
    this._assertUsable()
    let listeners = this._fieldListeners.get(field)
    if (!listeners) {
      listeners = new Set()
      this._fieldListeners.set(field, listeners)
    }
    const wrapped = listener as unknown as AnyFieldListener<T>
    listeners.add(wrapped)
    return makeIdempotentUnsubscribe(() => {
      const current = this._fieldListeners.get(field)
      if (!current) return
      current.delete(wrapped)
      if (current.size === 0) this._fieldListeners.delete(field)
    })
  }

  beginTransaction(): EditSessionTransaction<T> {
    this._assertUsable()
    if (this._activeTransaction) {
      throw new Error('EditSession does not support nested transactions.')
    }
    if (this._batchDepth > 0) {
      throw new Error('EditSession cannot begin a transaction during batchUpdate().')
    }

    let stagedDraft = this._clone(this._draft)
    let stagedDirtyFields = new Set(this._dirtyFields)
    let stagedTouchedFields = new Set(this._touchedFields)
    let active = true
    const assertActive = (): void => {
      if (!active || this._disposed) {
        throw new Error('EditSession transaction is no longer active.')
      }
    }
    const setStagedValue = (
      field: keyof T,
      value: T[keyof T],
    ): void => {
      if (this._valuesEqual(field, stagedDraft[field], value)) return
      stagedDraft = { ...stagedDraft, [field]: value }
      if (this._valuesEqual(field, value, this._baseline[field])) {
        stagedDirtyFields.delete(field)
      } else {
        stagedDirtyFields.add(field)
      }
    }
    const thisSession = this
    const transaction: EditSessionTransaction<T> = {
      get active() {
        return active && !thisSession._disposed
      },
      getValue: field => {
        assertActive()
        return stagedDraft[field]
      },
      setValue: (field, value) => {
        assertActive()
        setStagedValue(field, value)
      },
      setValues: values => {
        assertActive()
        for (const field of enumerableOwnKeys(values)) {
          setStagedValue(field, values[field] as T[typeof field])
        }
      },
      markTouched: (field, touched) => {
        assertActive()
        if (touched ?? true) stagedTouchedFields.add(field)
        else stagedTouchedFields.delete(field)
      },
      commit: () => {
        assertActive()
        const committedDraft = this._clone(stagedDraft)
        const committedDirtyFields = new Set(stagedDirtyFields)
        const committedTouchedFields = new Set(stagedTouchedFields)
        active = false
        this._activeTransaction = null
        this.batchUpdate(() => {
          this._draft = committedDraft
          this._dirtyFields = committedDirtyFields
          this._touchedFields = committedTouchedFields
        })
      },
      rollback: () => {
        assertActive()
        active = false
        this._activeTransaction = null
      },
    }
    this._activeTransaction = transaction
    return transaction
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._listeners.clear()
    this._fieldListeners.clear()
    this._activeTransaction = null
    this._batchSnapshot = null
    this._batchDepth = 0
    this._notificationQueue = []
  }

  private _setValue<K extends keyof T>(field: K, value: T[K]): void {
    if (this._valuesEqual(field, this._draft[field], value)) return
    this._draft = { ...this._draft, [field]: value }
    if (this._valuesEqual(field, value, this._baseline[field])) {
      this._dirtyFields.delete(field)
    } else {
      this._dirtyFields.add(field)
    }
  }

  private _beginBatch(): void {
    if (this._batchDepth === 0) {
      this._batchSnapshot = {
        draft: shallowClone(this._draft),
        dirtyFields: new Set(this._dirtyFields),
        touchedFields: new Set(this._touchedFields),
      }
    }
    this._batchDepth++
  }

  private _endBatch(): void {
    if (this._batchDepth <= 0) {
      throw new Error('EditSession batch state is unbalanced.')
    }
    this._batchDepth--
    if (this._batchDepth > 0) return

    const snapshot = this._batchSnapshot
    this._batchSnapshot = null
    if (!snapshot) return

    const change = this._createChange(snapshot)
    if (change) this._notify(change)
  }

  private _createChange(
    snapshot: EditSessionBatchSnapshot<T>,
  ): EditSessionChange<T> | null {
    const candidates = new Set<keyof T>([
      ...enumerableOwnKeys(snapshot.draft),
      ...enumerableOwnKeys(this._draft),
      ...snapshot.dirtyFields,
      ...this._dirtyFields,
      ...snapshot.touchedFields,
      ...this._touchedFields,
    ])
    const fields = new Set<keyof T>()
    let valueChanged = false
    let dirtyChanged = false
    let touchedChanged = false

    for (const field of candidates) {
      const fieldValueChanged = !this._valuesEqual(
        field,
        snapshot.draft[field],
        this._draft[field],
      )
      const fieldDirtyChanged = snapshot.dirtyFields.has(field)
        !== this._dirtyFields.has(field)
      const fieldTouchedChanged = snapshot.touchedFields.has(field)
        !== this._touchedFields.has(field)

      if (fieldValueChanged) valueChanged = true
      if (fieldDirtyChanged) dirtyChanged = true
      if (fieldTouchedChanged) touchedChanged = true
      if (fieldValueChanged || fieldDirtyChanged || fieldTouchedChanged) {
        fields.add(field)
      }
    }

    if (fields.size === 0) return null
    return { fields, valueChanged, dirtyChanged, touchedChanged }
  }

  private _notify(change: EditSessionChange<T>): void {
    this._notificationQueue.push({
      change,
      listeners: [...this._listeners],
      fields: [...change.fields].map(field => ({
        value: this._draft[field],
        listeners: [...(this._fieldListeners.get(field) ?? [])],
      })),
    })
    if (this._isNotifying) return

    this._isNotifying = true
    let failed = false
    let firstError: unknown
    const notify = (listener: () => void): void => {
      try {
        listener()
      } catch (error) {
        if (failed) return
        failed = true
        firstError = error
      }
    }

    try {
      while (this._notificationQueue.length > 0 && !this._disposed) {
        const notification = this._notificationQueue.shift()
        if (!notification) continue

        for (const listener of notification.listeners) {
          notify(() => listener(notification.change))
        }

        if (this._disposed) continue
        for (const fieldNotification of notification.fields) {
          for (const listener of fieldNotification.listeners) {
            notify(() => listener(
              fieldNotification.value,
              notification.change,
            ))
          }
          if (this._disposed) break
        }
      }
    } finally {
      this._isNotifying = false
      if (this._disposed) this._notificationQueue = []
    }

    if (failed) throw firstError
  }

  private _valuesEqual<K extends keyof T>(
    field: K,
    left: T[K],
    right: T[K],
  ): boolean {
    return this._equals(
      field,
      left as T[keyof T],
      right as T[keyof T],
    )
  }

  private _assertUsable(): void {
    if (this._disposed) throw new Error('EditSession has been disposed.')
  }

  private _assertNoActiveTransaction(): void {
    if (this._activeTransaction) {
      throw new Error(
        'EditSession mutations must use the active transaction until it commits or rolls back.',
      )
    }
  }
}

function shallowClone<T extends object>(value: Readonly<T>): T {
  return { ...value }
}

function defaultFieldEquality<T extends object>(
  _field: keyof T,
  left: T[keyof T],
  right: T[keyof T],
): boolean {
  return Object.is(left, right)
}

function enumerableOwnKeys<T extends object>(value: T): (keyof T)[] {
  return Reflect.ownKeys(value)
    .filter(key => Object.prototype.propertyIsEnumerable.call(value, key)) as (keyof T)[]
}

function makeIdempotentUnsubscribe(unsubscribe: () => void): () => void {
  let active = true
  return () => {
    if (!active) return
    active = false
    unsubscribe()
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (
    (typeof value !== 'object' || value === null)
    && typeof value !== 'function'
  ) {
    return false
  }
  return typeof (value as { then?: unknown }).then === 'function'
}

function isAsyncFunction(value: Function): boolean {
  return value.constructor?.name === 'AsyncFunction'
}

function consumePromiseRejection(value: PromiseLike<unknown>): void {
  Promise.resolve(value).catch(() => {})
}
