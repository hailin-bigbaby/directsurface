import { DisposableBag } from './disposable'
import { FocusManager } from './focus_manager'
import type { RenderObject } from './render_object'

export type KeyboardBindingHandler = (event: KeyboardEvent) => boolean | void

export interface KeyboardBindingOptions {
  source?: () => RenderObject | undefined
}

interface KeyboardBinding {
  handler: KeyboardBindingHandler
  options?: KeyboardBindingOptions
  priority: number
  order: number
}

export class KeyboardBindingController {
  private static _instance: KeyboardBindingController | null = null

  static get instance(): KeyboardBindingController {
    if (!KeyboardBindingController._instance) {
      KeyboardBindingController._instance = new KeyboardBindingController()
    }
    return KeyboardBindingController._instance
  }

  static disposeInstance(): void {
    KeyboardBindingController._instance?.dispose()
  }

  private readonly _disposables = new DisposableBag()
  private readonly _bindings: KeyboardBinding[] = []
  private _nextOrder = 0

  private constructor() {
    this._disposables.listen(window, 'keydown', event => this._handleKeyDown(event), { capture: true })
  }

  addBinding(handler: KeyboardBindingHandler, priority = 0, options?: KeyboardBindingOptions): () => void {
    const binding: KeyboardBinding = {
      handler,
      options,
      priority,
      order: this._nextOrder++,
    }
    this._bindings.push(binding)
    return () => this.removeBinding(handler)
  }

  removeBinding(handler: KeyboardBindingHandler): void {
    for (let i = this._bindings.length - 1; i >= 0; i--) {
      if (this._bindings[i]?.handler === handler) this._bindings.splice(i, 1)
    }
  }

  dispose(): void {
    this._bindings.length = 0
    this._disposables.dispose()
    KeyboardBindingController._instance = null
  }

  private _handleKeyDown(event: KeyboardEvent): void {
    const bindings = [...this._bindings].sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority
      return b.order - a.order
    })

    for (const binding of bindings) {
      if (!FocusManager.instance.allowsKeyboardBindingSource(binding.options?.source?.())) continue
      const consumed = binding.handler(event)
      if (consumed || event.defaultPrevented) {
        event.stopPropagation()
        return
      }
    }
  }
}
