export type DisposeFn = () => void

export interface Disposable {
  dispose(): void
}

export function runCleanupSteps(steps: Iterable<DisposeFn>): void {
  let failed = false
  let firstError: unknown

  for (const step of steps) {
    try {
      step()
    } catch (error) {
      if (failed) continue
      failed = true
      firstError = error
    }
  }

  if (failed) throw firstError
}

export class DisposableBag implements Disposable {
  private _disposers: DisposeFn[] = []
  private _disposed = false

  get disposed(): boolean {
    return this._disposed
  }

  add(dispose: DisposeFn): DisposeFn {
    if (this._disposed) {
      dispose()
      return () => {}
    }

    let active = true
    const wrapped = (): void => {
      if (!active) return
      active = false
      dispose()
    }
    this._disposers.push(wrapped)
    return wrapped
  }

  addDisposable(disposable: Disposable): DisposeFn {
    return this.add(() => disposable.dispose())
  }

  listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): DisposeFn
  listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): DisposeFn
  listen(
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): DisposeFn {
    target.addEventListener(type, listener, options)
    return this.add(() => target.removeEventListener(type, listener, options))
  }

  setTimeout(callback: () => void, delay?: number): DisposeFn {
    const timer = setTimeout(callback, delay)
    return this.add(() => clearTimeout(timer))
  }

  setInterval(callback: () => void, delay?: number): DisposeFn {
    const timer = setInterval(callback, delay)
    return this.add(() => clearInterval(timer))
  }

  requestAnimationFrame(callback: FrameRequestCallback): DisposeFn {
    const frame = requestAnimationFrame(callback)
    return this.add(() => cancelAnimationFrame(frame))
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    const disposers = this._disposers
    this._disposers = []
    runCleanupSteps(disposers.reverse())
  }
}
