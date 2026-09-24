// Store: 轻量级响应式状态管理
// 状态变化自动通知订阅者，驱动重绘

type Listener = () => void
type Selector<S, T> = (state: S) => T

export class Store<S extends object> {
  private _state: S
  private _listeners = new Set<Listener>()
  // 细粒度订阅：selector → Set<listener>
  private _selectorListeners = new Map<Selector<S, any>, Set<Listener>>()
  private _selectorCache = new Map<Selector<S, any>, any>()
  private _batchDepth = 0
  private _batchChanged = false
  private _isNotifying = false
  private _notificationQueued = false

  constructor(initialState: S) {
    this._state = { ...initialState }
  }

  get state(): Readonly<S> {
    return this._state
  }

  // 更新状态（部分更新）
  setState(updater: Partial<S> | ((prev: S) => Partial<S>)): void {
    const patch = typeof updater === 'function' ? updater(this._state) : updater
    const next = { ...this._state, ...patch }

    // 检查是否真的有变化
    let changed = false
    for (const key of Object.keys(patch) as (keyof S)[]) {
      if (!Object.is(this._state[key], next[key])) { changed = true; break }
    }
    if (!changed) return

    this._state = next
    if (this._batchDepth > 0) {
      this._batchChanged = true
      return
    }
    this._notifyAll()
  }

  batchUpdate<Result>(update: () => Result): Result {
    if (isAsyncFunction(update)) {
      throw new TypeError('Store.batchUpdate() callback must be synchronous.')
    }
    this._batchDepth++
    let result!: Result
    let failed = false
    let firstError: unknown
    try {
      result = update()
      if (isPromiseLike(result)) {
        consumePromiseRejection(result)
        throw new TypeError('Store.batchUpdate() callback must be synchronous.')
      }
    } catch (error) {
      failed = true
      firstError = error
    }

    this._batchDepth--
    if (this._batchDepth === 0 && this._batchChanged) {
      this._batchChanged = false
      try {
        this._notifyAll()
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

  // 订阅所有状态变化
  subscribe(listener: Listener): () => void {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  // 细粒度订阅：只在 selector 返回值变化时通知
  subscribeSelector<T>(selector: Selector<S, T>, listener: Listener): () => void {
    if (!this._selectorListeners.has(selector)) {
      const initialValue = selector(this._state)
      this._selectorListeners.set(selector, new Set())
      this._selectorCache.set(selector, initialValue)
    }
    this._selectorListeners.get(selector)!.add(listener)
    return () => {
      const listeners = this._selectorListeners.get(selector)
      if (!listeners) return
      listeners.delete(listener)
      if (listeners.size > 0) return
      this._selectorListeners.delete(selector)
      this._selectorCache.delete(selector)
    }
  }

  // 获取 selector 当前值
  select<T>(selector: Selector<S, T>): T {
    return selector(this._state)
  }

  private _notifyAll(): void {
    this._notificationQueued = true
    if (this._isNotifying) return

    this._isNotifying = true
    let failed = false
    let firstError: unknown
    const notify = (operation: () => void): void => {
      try {
        operation()
      } catch (error) {
        if (failed) return
        failed = true
        firstError = error
      }
    }

    try {
      while (this._notificationQueued) {
        this._notificationQueued = false
        const listeners = [...this._listeners]
        const selectorRegistrations = [...this._selectorListeners]
          .map(([selector, selectorListeners]) => ({
            selector,
            selectorListeners,
            listeners: [...selectorListeners],
            previous: this._selectorCache.get(selector),
          }))
    // 通知全量订阅者
        for (const listener of listeners) notify(listener)

    // 通知细粒度订阅者（只在值变化时）
        for (const registration of selectorRegistrations) {
          let next: unknown
          let selected = false
          try {
            next = registration.selector(this._state)
            selected = true
          } catch (error) {
            if (!failed) {
              failed = true
              firstError = error
            }
          }
          if (!selected || Object.is(registration.previous, next)) continue
          if (
            this._selectorListeners.get(registration.selector)
            === registration.selectorListeners
          ) {
            this._selectorCache.set(registration.selector, next)
          }
          for (const listener of registration.listeners) notify(listener)
        }
      }
    } finally {
      this._isNotifying = false
    }

    if (failed) throw firstError
  }
}

// ---- 便捷工厂函数 ----

export function createStore<S extends object>(initialState: S): Store<S> {
  return new Store(initialState)
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
