import { DisposableBag, type DisposeFn } from './disposable'
import { InputComposer, type InputSession, type InputSessionToken } from './input_composer'
import { SelectionController } from './selection_controller'

const TEXT_INPUT_COMPOSER_Y_OFFSET = 5

export interface TextInputSessionHandlers {
  onInput?: (value: string, controller: TextInputController) => void
  onCompositionStart?: (controller: TextInputController) => void
  onCompositionUpdate?: (text: string, controller: TextInputController) => void
  onCompositionEnd?: (value: string, controller: TextInputController) => void
  onKeyDown?: (e: KeyboardEvent, controller: TextInputController) => void
  onPaste?: (e: ClipboardEvent, controller: TextInputController) => void
}

export interface TextInputSessionOptions {
  focus?: boolean
}

export type TextInputInvalidateReason = 'caret-blink'

export class TextInputController {
  private _cursorPos = 0
  private _selection = new SelectionController({ anchor: 0, focus: 0 })
  private _scrollX = 0
  private _cursorVisible = true
  private _composing = false
  private _compositionText = ''
  private _cursorTimerDisposer?: DisposeFn
  private _sessionToken?: InputSessionToken
  private _disposables = new DisposableBag()
  private readonly _onInvalidate: (reason: TextInputInvalidateReason) => void

  constructor(opts?: { onInvalidate?: (reason: TextInputInvalidateReason) => void }) {
    this._onInvalidate = opts?.onInvalidate ?? (() => {})
  }

  get cursorPos(): number { return this._cursorPos }
  get selStart(): number { return this._selection.start }
  get selEnd(): number { return this._selection.end }
  get selAnchor(): number | null { return this._selection.anchor }
  get selFocus(): number | null { return this._selection.focus }
  get scrollX(): number { return this._scrollX }
  get cursorVisible(): boolean { return this._cursorVisible }
  get composing(): boolean { return this._composing }
  get compositionText(): string { return this._compositionText }
  get hasSession(): boolean { return this._sessionToken !== undefined }
  get composerValue(): string { return InputComposer.instance.value }

  beginSession(handlers: TextInputSessionHandlers, initialValue = '', options?: TextInputSessionOptions): void {
    this.endSession()
    this.resetBlink()
    this._startCursorTimer()
    const session: InputSession = {
      onInput: value => handlers.onInput?.(value, this),
      onCompositionStart: () => {
        this._composing = true
        handlers.onCompositionStart?.(this)
      },
      onCompositionUpdate: text => {
        this._composing = true
        this._compositionText = text
        handlers.onCompositionUpdate?.(text, this)
      },
      onCompositionEnd: value => {
        this._composing = false
        this._compositionText = ''
        handlers.onCompositionEnd?.(value, this)
      },
      onKeyDown: e => handlers.onKeyDown?.(e, this),
      onPaste: e => handlers.onPaste?.(e, this),
    }
    this._sessionToken = InputComposer.instance.begin(session, initialValue, options)
  }

  endSession(): void {
    this._stopCursorTimer()
    if (this._sessionToken !== undefined) {
      InputComposer.instance.end(this._sessionToken)
    }
    this._sessionToken = undefined
    this.clearComposition()
    this.resetBlink()
  }

  dispose(): void {
    this.endSession()
    this._disposables.dispose()
  }

  resetBlink(): void {
    this._cursorVisible = true
  }

  setScrollX(scrollX: number): void {
    this._scrollX = Math.max(0, scrollX)
  }

  setSelection(start: number, end: number, opts?: { cursorPos?: number; syncComposer?: boolean }): void {
    this._cursorPos = opts?.cursorPos ?? end
    this._selection.setNormalizedRange(start, end)
    if (opts?.syncComposer) {
      InputComposer.instance.setSelection(Math.min(start, end), Math.max(start, end))
    }
  }

  extendSelection(focus: number, opts?: { cursorPos?: number; syncComposer?: boolean }): void {
    this._cursorPos = opts?.cursorPos ?? focus
    this._selection.extendRange(focus)
    if (opts?.syncComposer) {
      InputComposer.instance.setSelection(this._selection.start, this._selection.end)
    }
  }

  syncSelectionFromComposer(opts?: { ignoreComposing?: boolean }): void {
    if (opts?.ignoreComposing && InputComposer.instance.composing) return
    this._cursorPos = InputComposer.instance.selectionStart
    this._selection.setNormalizedRange(InputComposer.instance.selectionStart, InputComposer.instance.selectionEnd)
  }

  clampSelection(maxLength: number): void {
    const nextCursor = Math.min(this._cursorPos, maxLength)
    this._selection.clampRange(0, maxLength)
    const nextStart = this._selection.start
    const nextEnd = this._selection.end
    this.setSelection(nextStart, nextEnd, { cursorPos: nextCursor, syncComposer: false })
  }

  setComposerValue(value: string): void {
    InputComposer.instance.setValue(value)
  }

  setComposerReadOnly(readOnly: boolean): void {
    InputComposer.instance.setReadOnly(readOnly)
  }

  setComposerLineMode(lineText: string, col: number): void {
    InputComposer.instance.setLineMode(lineText, col)
  }

  focusComposer(): void {
    InputComposer.instance.focus()
  }

  updateComposerPosition(screenX: number, screenY: number): void {
    InputComposer.instance.updatePosition(screenX, screenY + TEXT_INPUT_COMPOSER_Y_OFFSET)
  }

  clearComposition(): void {
    this._composing = false
    this._compositionText = ''
  }

  private _startCursorTimer(): void {
    this._cursorTimerDisposer = this._disposables.setInterval(() => {
      this._cursorVisible = !this._cursorVisible
      this._onInvalidate('caret-blink')
    }, 530)
  }

  private _stopCursorTimer(): void {
    if (!this._cursorTimerDisposer) return
    this._cursorTimerDisposer()
    this._cursorTimerDisposer = undefined
  }
}
