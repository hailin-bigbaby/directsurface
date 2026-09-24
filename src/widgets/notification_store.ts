export type NotificationType = 'info' | 'success' | 'warning' | 'error'

export type NotificationCloseReason =
  | 'timeout'
  | 'dismiss'
  | 'action'
  | 'programmatic'
  | 'overflow'
  | 'replaced'
  | 'dispose'

export interface NotificationAction {
  label: string
  onInvoke: () => void | Promise<void>
  closeOnInvoke?: boolean
}

export interface NotificationOptions {
  type: NotificationType
  title: string
  message?: string
  key?: string
  duration?: number
  dismissible?: boolean
  action?: NotificationAction
  onClose?: (reason: NotificationCloseReason) => void
  onActionError?: (error: unknown) => void
}

export interface NotificationPatch {
  type?: NotificationType
  title?: string
  message?: string | null
  duration?: number
  dismissible?: boolean
  restartDuration?: boolean
}

export interface NotificationHandle {
  readonly id: number
  readonly closed: boolean
  update(patch: NotificationPatch): boolean
  close(): boolean
}

export type NotificationLifecycleState = 'opening' | 'visible' | 'closing' | 'removed'

export type NotificationMotionKind = 'legacy-slide' | 'fade'

export interface NotificationStoreEntry {
  readonly id: number
  readonly generation: number
  readonly motionKind: NotificationMotionKind
  type: NotificationType
  title: string
  message: string
  readonly key?: string
  duration: number
  dismissible: boolean
  readonly action?: NotificationAction
  readonly onClose?: (reason: NotificationCloseReason) => void
  readonly onActionError?: (error: unknown) => void
  state: NotificationLifecycleState
  closeReason?: NotificationCloseReason
  actionPending: boolean
  remaining: number
  timerStartedAt: number
  readonly exitDuration: number
  timer?: ReturnType<typeof globalThis.setTimeout>
  removalTimer?: ReturnType<typeof globalThis.setTimeout>
  readonly pauses: Set<string>
  closeDispatched: boolean
}

const DEFAULT_DURATIONS: Record<NotificationType, number> = {
  success: 5000,
  info: 6000,
  warning: 8000,
  error: 0,
}

let nextNotificationId = 1
let nextGeneration = 1

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function assertNotificationType(type: NotificationType): void {
  if (type !== 'info' && type !== 'success' && type !== 'warning' && type !== 'error') {
    throw new Error('Notification type must be info, success, warning, or error.')
  }
}

function assertFiniteDuration(duration: number | undefined): void {
  if (duration !== undefined && !Number.isFinite(duration)) {
    throw new Error('Notification duration must be a finite number.')
  }
}

function assertNonBlank(value: string, name: string): void {
  if (!value.trim()) throw new Error(`Notification ${name} must not be blank.`)
}

export class NotificationStore {
  private readonly _entries: NotificationStoreEntry[] = []
  private readonly _byId = new Map<number, NotificationStoreEntry>()
  private readonly _byKey = new Map<string, NotificationStoreEntry>()
  private readonly _callbacks: Array<() => void> = []
  private readonly _onChange: () => void
  private readonly _exitDuration: () => number
  private readonly _maxEntries = 3
  private _transactionDepth = 0
  private _changed = false
  private _dispatching = false
  private _disposed = false
  private readonly _visibilityHandler = (): void => this._syncDocumentVisibility()

  constructor(options: { onChange: () => void; exitDuration: () => number }) {
    this._onChange = options.onChange
    this._exitDuration = options.exitDuration
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._visibilityHandler)
    }
  }

  get entries(): readonly NotificationStoreEntry[] {
    return this._entries
  }

  get newestFirst(): readonly NotificationStoreEntry[] {
    return [...this._entries].reverse()
  }

  get hasItems(): boolean {
    return this._entries.length > 0
  }

  get disposed(): boolean {
    return this._disposed
  }

  showLegacy(type: NotificationType, title: string, message: string, duration: number): number {
    this._assertActive()
    const entry = this._create({ type, title, message, duration, dismissible: false }, 'legacy-slide')
    return entry.id
  }

  notify(options: NotificationOptions): NotificationHandle {
    this._assertActive()
    this._validateOptions(options)
    let entry!: NotificationStoreEntry
    this._transaction(() => {
      if (options.key) {
        const existing = this._byKey.get(options.key)
        if (existing) this._finish(existing, existing.closeReason ?? 'replaced')
      }
      entry = this._create(options, 'fade')
    })
    return this._handle(entry)
  }

  update(target: number | string, patch: NotificationPatch): boolean {
    this._assertActive()
    this._validatePatch(patch)
    const entry = this._resolve(target)
    if (!entry || entry.state === 'closing' || entry.state === 'removed') return false
    this._transaction(() => {
      if (patch.type !== undefined) entry.type = patch.type
      if (patch.title !== undefined) entry.title = patch.title
      if (patch.message !== undefined) entry.message = patch.message ?? ''
      if (patch.duration !== undefined) entry.duration = patch.duration
      if (patch.dismissible !== undefined) entry.dismissible = patch.dismissible
      if (patch.restartDuration) {
        entry.remaining = entry.duration
        this._restartTimer(entry)
      }
      this._markChanged()
    })
    return true
  }

  close(target: number | string, reason: NotificationCloseReason = 'programmatic'): boolean {
    const entry = this._resolve(target)
    if (!entry || entry.state === 'closing' || entry.state === 'removed') return false
    this._transaction(() => this._beginClose(entry, reason))
    return true
  }

  closeAll(reason: NotificationCloseReason = 'programmatic'): void {
    this._transaction(() => {
      for (const entry of [...this._entries]) {
        this._finish(entry, entry.closeReason ?? reason)
      }
    })
  }

  markVisible(id: number): void {
    const entry = this._byId.get(id)
    if (!entry || entry.state !== 'opening') return
    entry.state = 'visible'
    this._markChangedOutsideTransaction()
  }

  reconcileCapacity(capacity: number): void {
    const next = Math.max(0, Math.floor(capacity))
    this._transaction(() => {
      while (this._entries.length > next) {
        this._finish(this._entries[0]!, this._entries[0]!.closeReason ?? 'overflow')
      }
    })
  }

  setPaused(id: number, source: string, paused: boolean): void {
    const entry = this._byId.get(id)
    if (!entry || entry.state === 'closing' || entry.state === 'removed') return
    if (paused) {
      if (entry.pauses.has(source)) return
      entry.pauses.add(source)
      this._captureRemaining(entry)
      this._clearTimer(entry)
      return
    }
    if (!entry.pauses.delete(source)) return
    this._startTimer(entry)
  }

  invokeAction(id: number): boolean {
    const entry = this._byId.get(id)
    if (!entry?.action || entry.actionPending || entry.state === 'closing' || entry.state === 'removed') return false
    entry.actionPending = true
    this._markChangedOutsideTransaction()
    let result: void | Promise<void>
    try {
      result = entry.action.onInvoke()
    } catch (error) {
      this._finishActionFailure(entry, error)
      return true
    }
    if (result && typeof (result as Promise<void>).then === 'function') {
      Promise.resolve(result).then(
        () => this._finishActionSuccess(entry),
        error => this._finishActionFailure(entry, error),
      )
    } else {
      this._finishActionSuccess(entry)
    }
    return true
  }

  dispose(): void {
    if (this._disposed) return
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._visibilityHandler)
    }
    this._transaction(() => {
      for (const entry of [...this._entries]) {
        this._finish(entry, entry.closeReason ?? 'dispose')
      }
      this._disposed = true
    })
  }

  private _create(options: NotificationOptions, motionKind: NotificationMotionKind): NotificationStoreEntry {
    const duration = options.duration ?? (options.action ? 0 : DEFAULT_DURATIONS[options.type])
    const entry: NotificationStoreEntry = {
      id: nextNotificationId++,
      generation: nextGeneration++,
      motionKind,
      type: options.type,
      title: options.title,
      message: options.message ?? '',
      key: options.key,
      duration,
      dismissible: options.dismissible ?? true,
      action: options.action,
      onClose: options.onClose,
      onActionError: options.onActionError,
      state: 'opening',
      actionPending: false,
      remaining: duration,
      timerStartedAt: 0,
      exitDuration: Math.max(0, this._exitDuration()),
      pauses: new Set<string>(),
      closeDispatched: false,
    }
    if (typeof document !== 'undefined' && document.hidden) entry.pauses.add('document')
    this._transaction(() => {
      while (this._entries.length >= this._maxEntries && this._entries.length > 0) {
        const oldest = this._entries[0]!
        this._finish(oldest, oldest.closeReason ?? 'overflow')
      }
      this._entries.push(entry)
      this._byId.set(entry.id, entry)
      if (entry.key) this._byKey.set(entry.key, entry)
      this._markChanged()
      this._startTimer(entry)
    })
    return entry
  }

  private _handle(entry: NotificationStoreEntry): NotificationHandle {
    return {
      id: entry.id,
      get closed() { return entry.state === 'removed' },
      update: patch => this._updateGeneration(entry, patch),
      close: () => this._closeGeneration(entry),
    }
  }

  private _updateGeneration(entry: NotificationStoreEntry, patch: NotificationPatch): boolean {
    if (this._byId.get(entry.id) !== entry) return false
    return this.update(entry.id, patch)
  }

  private _closeGeneration(entry: NotificationStoreEntry): boolean {
    if (this._byId.get(entry.id) !== entry) return false
    return this.close(entry.id)
  }

  private _beginClose(entry: NotificationStoreEntry, reason: NotificationCloseReason): void {
    if (entry.state === 'closing' || entry.state === 'removed') return
    entry.state = 'closing'
    entry.closeReason = reason
    this._clearTimer(entry)
    entry.removalTimer = globalThis.setTimeout(() => {
      entry.removalTimer = undefined
      this._transaction(() => this._finish(entry, entry.closeReason ?? reason))
    }, entry.exitDuration + 20)
    this._markChanged()
  }

  private _finish(entry: NotificationStoreEntry, reason: NotificationCloseReason): void {
    if (entry.state === 'removed') return
    this._clearTimer(entry)
    if (entry.removalTimer !== undefined) {
      globalThis.clearTimeout(entry.removalTimer)
      entry.removalTimer = undefined
    }
    const index = this._entries.indexOf(entry)
    if (index >= 0) this._entries.splice(index, 1)
    this._byId.delete(entry.id)
    if (entry.key && this._byKey.get(entry.key) === entry) this._byKey.delete(entry.key)
    entry.closeReason ??= reason
    entry.state = 'removed'
    entry.actionPending = false
    this._markChanged()
    if (entry.onClose && !entry.closeDispatched) {
      entry.closeDispatched = true
      this._callbacks.push(() => entry.onClose!(entry.closeReason!))
    }
  }

  private _finishActionSuccess(entry: NotificationStoreEntry): void {
    if (this._byId.get(entry.id) !== entry || entry.state === 'closing' || entry.state === 'removed') return
    entry.actionPending = false
    if (entry.action?.closeOnInvoke !== false) this.close(entry.id, 'action')
    else this._markChangedOutsideTransaction()
  }

  private _finishActionFailure(entry: NotificationStoreEntry, error: unknown): void {
    if (this._byId.get(entry.id) === entry && entry.state !== 'closing' && entry.state !== 'removed') {
      entry.actionPending = false
      this._markChangedOutsideTransaction()
    }
    this._callbacks.push(() => {
      if (entry.onActionError) entry.onActionError(error)
      else console.error('Notification action failed.', error)
    })
    this._flushCallbacks()
  }

  private _resolve(target: number | string): NotificationStoreEntry | undefined {
    return typeof target === 'number' ? this._byId.get(target) : this._byKey.get(target)
  }

  private _startTimer(entry: NotificationStoreEntry): void {
    if (entry.timer !== undefined || entry.remaining <= 0 || entry.pauses.size > 0) return
    if (entry.state === 'closing' || entry.state === 'removed') return
    entry.timerStartedAt = now()
    entry.timer = globalThis.setTimeout(() => {
      entry.timer = undefined
      entry.remaining = 0
      this.close(entry.id, 'timeout')
    }, entry.remaining)
  }

  private _captureRemaining(entry: NotificationStoreEntry): void {
    if (entry.timer === undefined) return
    entry.remaining = Math.max(0, entry.remaining - (now() - entry.timerStartedAt))
  }

  private _clearTimer(entry: NotificationStoreEntry): void {
    if (entry.timer === undefined) return
    globalThis.clearTimeout(entry.timer)
    entry.timer = undefined
  }

  private _restartTimer(entry: NotificationStoreEntry): void {
    this._clearTimer(entry)
    this._startTimer(entry)
  }

  private _syncDocumentVisibility(): void {
    const hidden = typeof document !== 'undefined' && document.hidden
    for (const entry of [...this._entries]) this.setPaused(entry.id, 'document', hidden)
  }

  private _validateOptions(options: NotificationOptions): void {
    assertNotificationType(options.type)
    assertNonBlank(options.title, 'title')
    assertFiniteDuration(options.duration)
    if (options.key !== undefined) assertNonBlank(options.key, 'key')
    if (options.action) assertNonBlank(options.action.label, 'action label')
  }

  private _validatePatch(patch: NotificationPatch): void {
    if (patch.type !== undefined) assertNotificationType(patch.type)
    if (patch.title !== undefined) assertNonBlank(patch.title, 'title')
    assertFiniteDuration(patch.duration)
  }

  private _assertActive(): void {
    if (this._disposed) throw new Error('NotificationManager is unavailable after dispose().')
  }

  private _transaction(action: () => void): void {
    this._transactionDepth += 1
    try {
      action()
    } finally {
      this._transactionDepth -= 1
      if (this._transactionDepth === 0) {
        if (this._changed) {
          this._changed = false
          this._onChange()
        }
        this._flushCallbacks()
      }
    }
  }

  private _markChanged(): void {
    this._changed = true
  }

  private _markChangedOutsideTransaction(): void {
    this._transaction(() => this._markChanged())
  }

  private _flushCallbacks(): void {
    if (this._transactionDepth > 0 || this._dispatching) return
    this._dispatching = true
    try {
      while (this._callbacks.length > 0) {
        const callback = this._callbacks.shift()!
        try {
          callback()
        } catch (error) {
          console.error('Notification callback failed.', error)
        }
      }
    } finally {
      this._dispatching = false
    }
  }
}
