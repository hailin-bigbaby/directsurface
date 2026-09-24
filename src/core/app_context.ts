import type { Disposable, DisposeFn } from './disposable'

export class AppContextKey<T> {
  readonly id: symbol

  constructor(readonly description: string) {
    this.id = Symbol(description)
  }
}

export type AppContextLookupKey<T = unknown> = AppContextKey<T> | string

export interface AppContextSetOptions {
  dispose?: boolean | DisposeFn
}

interface AppContextEntry {
  value: unknown
  dispose?: DisposeFn
}

export type AppContextInitialValues =
  | AppContextRegistry
  | Record<string, unknown>
  | Iterable<readonly [AppContextLookupKey, unknown]>

export const APP_CONTEXT_PROVIDER: unique symbol = Symbol('ds-ui.app-context-provider')

export interface AppContextProvider {
  [APP_CONTEXT_PROVIDER](): AppContextRegistry
}

export function createAppContextKey<T>(description: string): AppContextKey<T> {
  return new AppContextKey<T>(description)
}

export function createAppContext(initial?: AppContextInitialValues): AppContextRegistry {
  if (initial instanceof AppContextRegistry) return initial
  return new AppContextRegistry(undefined, initial)
}

export function isAppContextProvider(value: unknown): value is AppContextProvider {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as Partial<AppContextProvider>)[APP_CONTEXT_PROVIDER] === 'function',
  )
}

export class AppContextRegistry implements Disposable {
  private readonly _entries = new Map<AppContextLookupKey, AppContextEntry>()
  private _disposed = false
  private _revision = 0

  constructor(
    private readonly _parent?: AppContextRegistry,
    initial?: Exclude<AppContextInitialValues, AppContextRegistry>,
  ) {
    if (initial) this._setInitialValues(initial)
  }

  get disposed(): boolean {
    return this._disposed
  }

  get parent(): AppContextRegistry | undefined {
    return this._parent
  }

  get revision(): number {
    return this._revision
  }

  set<T>(key: AppContextKey<T>, value: T, options?: AppContextSetOptions): this
  set(key: string, value: unknown, options?: AppContextSetOptions): this
  set(key: AppContextLookupKey, value: unknown, options: AppContextSetOptions = {}): this {
    this._assertActive()
    this._disposeEntry(key)
    this._entries.set(key, {
      value,
      dispose: resolveDisposer(value, options),
    })
    this._revision += 1
    return this
  }

  setDisposable<T extends Disposable>(key: AppContextKey<T>, value: T): this {
    return this.set(key, value, { dispose: true })
  }

  get<T>(key: AppContextKey<T>): T | undefined
  get(key: string): unknown
  get(key: AppContextLookupKey): unknown {
    const own = this._entries.get(key)
    if (own) return own.value
    return this._parent?.get(key as never)
  }

  getOwn<T>(key: AppContextKey<T>): T | undefined
  getOwn(key: string): unknown
  getOwn(key: AppContextLookupKey): unknown {
    return this._entries.get(key)?.value
  }

  require<T>(key: AppContextKey<T>): T
  require(key: string): unknown
  require(key: AppContextLookupKey): unknown {
    if (this.has(key)) return this.get(key as never)
    const label = typeof key === 'string' ? key : key.description
    throw new Error(`App context value "${label}" was not found.`)
  }

  has(key: AppContextLookupKey): boolean {
    return this._entries.has(key) || Boolean(this._parent?.has(key))
  }

  hasOwn(key: AppContextLookupKey): boolean {
    return this._entries.has(key)
  }

  keys(): IterableIterator<AppContextLookupKey> {
    return this._entries.keys()
  }

  delete(key: AppContextLookupKey): boolean {
    this._assertActive()
    if (!this._entries.has(key)) return false
    this._disposeEntry(key)
    this._revision += 1
    return true
  }

  clear(): void {
    const keys = [...this._entries.keys()]
    if (keys.length === 0) return
    for (const key of keys.reverse()) {
      this._disposeEntry(key)
    }
    this._revision += 1
  }

  derive(initial?: Exclude<AppContextInitialValues, AppContextRegistry>): AppContextRegistry {
    this._assertActive()
    return new AppContextRegistry(this, initial)
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this.clear()
  }

  private _setInitialValues(initial: Exclude<AppContextInitialValues, AppContextRegistry>): void {
    if (Symbol.iterator in Object(initial)) {
      for (const [key, value] of initial as Iterable<readonly [AppContextLookupKey, unknown]>) {
        this.set(key as never, value)
      }
      return
    }
    for (const [key, value] of Object.entries(initial)) {
      this.set(key, value)
    }
  }

  private _disposeEntry(key: AppContextLookupKey): void {
    const entry = this._entries.get(key)
    if (!entry) return
    this._entries.delete(key)
    entry.dispose?.()
  }

  private _assertActive(): void {
    if (this._disposed) throw new Error('App context has been disposed.')
  }
}

function resolveDisposer(value: unknown, options: AppContextSetOptions): DisposeFn | undefined {
  if (typeof options.dispose === 'function') return options.dispose
  if (options.dispose !== true) return undefined
  if (!value || typeof value !== 'object' || typeof (value as Partial<Disposable>).dispose !== 'function') {
    return undefined
  }
  return () => (value as Disposable).dispose()
}
