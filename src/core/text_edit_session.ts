import type { TextInputController } from './text_input_controller'

export interface TextEditRefreshOptions {
  resetBlink?: boolean
  syncSelectionFromComposer?: boolean
  syncSelectionIgnoreComposing?: boolean
  syncComposer?: boolean
  scrollToCursor?: boolean
  updateComposerPosition?: boolean
  invalidate?: boolean
}

export interface TextEditSessionApi {
  readonly controller: TextInputController
  focusComposer(): void
  refresh(opts?: TextEditRefreshOptions): void
  defer(task: () => void, opts?: TextEditRefreshOptions): void
}

export interface TextEditSessionDelegate {
  controller: TextInputController
  isActive: () => boolean
  syncSelectionFromComposer?: (opts?: { ignoreComposing?: boolean }) => void
  syncComposer?: () => void
  scrollToCursor?: () => void
  updateComposerPosition?: () => void
  invalidate: () => void
}

export interface TextEditSessionStartOptions {
  initialValue: string
  initialSelection?: {
    start: number
    end: number
    cursorPos?: number
    syncComposer?: boolean
  }
  focusComposer?: boolean
  syncComposerOnStart?: boolean
  refreshOnStart?: boolean | TextEditRefreshOptions
  onInput?: (value: string, session: TextEditSessionApi) => void
  onCompositionStart?: (session: TextEditSessionApi) => void
  onCompositionUpdate?: (text: string, session: TextEditSessionApi) => void
  onCompositionEnd?: (value: string, session: TextEditSessionApi) => void
  onKeyDown?: (event: KeyboardEvent, session: TextEditSessionApi) => void
  onPaste?: (event: ClipboardEvent, session: TextEditSessionApi) => void
}

export class TextEditSession {
  private readonly _delegate: TextEditSessionDelegate
  private readonly _api: TextEditSessionApi

  constructor(delegate: TextEditSessionDelegate) {
    this._delegate = delegate
    this._api = {
      controller: delegate.controller,
      focusComposer: () => this.focusComposer(),
      refresh: opts => this.refresh(opts),
      defer: (task, opts) => this.defer(task, opts),
    }
  }

  start(opts: TextEditSessionStartOptions): void {
    const controller = this._delegate.controller
    controller.beginSession({
      onInput: value => opts.onInput?.(value, this._api),
      onCompositionStart: () => opts.onCompositionStart?.(this._api),
      onCompositionUpdate: text => opts.onCompositionUpdate?.(text, this._api),
      onCompositionEnd: value => opts.onCompositionEnd?.(value, this._api),
      onKeyDown: event => opts.onKeyDown?.(event, this._api),
      onPaste: event => opts.onPaste?.(event, this._api),
    }, opts.initialValue, { focus: opts.focusComposer !== false })

    if (opts.initialSelection) {
      controller.setSelection(opts.initialSelection.start, opts.initialSelection.end, {
        cursorPos: opts.initialSelection.cursorPos,
        syncComposer: opts.initialSelection.syncComposer,
      })
    }
    if (opts.syncComposerOnStart) this._delegate.syncComposer?.()
    if (opts.focusComposer) controller.focusComposer()
    if (opts.refreshOnStart) {
      this.refresh(opts.refreshOnStart === true ? undefined : opts.refreshOnStart)
    }
  }

  end(): void {
    this._delegate.controller.endSession()
  }

  focusComposer(): void {
    this._delegate.controller.focusComposer()
  }

  refresh(opts: TextEditRefreshOptions = {}): void {
    const controller = this._delegate.controller
    if (opts.resetBlink) controller.resetBlink()
    if (opts.syncSelectionFromComposer) {
      this._delegate.syncSelectionFromComposer?.({
        ignoreComposing: opts.syncSelectionIgnoreComposing,
      })
    }
    if (opts.syncComposer) this._delegate.syncComposer?.()
    if (opts.scrollToCursor ?? true) this._delegate.scrollToCursor?.()
    if (opts.updateComposerPosition ?? true) this._delegate.updateComposerPosition?.()
    if (opts.invalidate ?? true) this._delegate.invalidate()
  }

  defer(task: () => void, opts?: TextEditRefreshOptions): void {
    requestAnimationFrame(() => {
      if (!this._delegate.isActive()) return
      task()
      if (!this._delegate.isActive()) return
      this.refresh(opts)
    })
  }
}
