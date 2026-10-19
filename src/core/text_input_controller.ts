import { DisposableBag, type DisposeFn } from './disposable'
import { resolveDefaultTextInputPort } from './text_input_port_binding'
import {
  cloneTextInputSessionState,
  createTextInputSessionState,
  textInputContractVersion,
  type TextInputEndReason,
  type TextInputEvent,
  type TextInputPort,
  type TextInputRange,
  type TextInputSessionHandle,
  type TextInputSessionState,
  validateTextInputRange,
} from './text_input_port'
import { SelectionController } from './selection_controller'

const TEXT_INPUT_COMPOSER_Y_OFFSET = 5

export interface TextInputSessionHandlers {
  onInput?: (value: string, controller: TextInputController) => void
  onCompositionStart?: (controller: TextInputController) => void
  onCompositionUpdate?: (text: string, controller: TextInputController) => void
  onCompositionEnd?: (value: string, controller: TextInputController, committedText?: string) => void
  onCompositionCancel?: (controller: TextInputController) => void
  onKeyDown?: (e: KeyboardEvent, controller: TextInputController) => void
  onPaste?: (e: ClipboardEvent, controller: TextInputController) => void
}

export interface TextInputSessionOptions {
  focus?: boolean
  windowId?: string
  inputPurpose?: 'text' | 'password' | 'search'
  multiline?: boolean
  secure?: boolean
  readOnly?: boolean
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
  private _sessionHandle?: TextInputSessionHandle
  private _sessionState = createTextInputSessionState('')
  private _disposables = new DisposableBag()
  private readonly _onInvalidate: (reason: TextInputInvalidateReason) => void
  private readonly _port: TextInputPort

  constructor(opts?: {
    onInvalidate?: (reason: TextInputInvalidateReason) => void
    port?: TextInputPort
  }) {
    this._onInvalidate = opts?.onInvalidate ?? (() => {})
    this._port = opts?.port ?? resolveDefaultTextInputPort()
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
  get hasSession(): boolean { return this._sessionHandle !== undefined }
  get composerValue(): string { return this._sessionState.text }
  get sessionId(): string | undefined { return this._sessionHandle?.sessionId }
  get sessionRevision(): number { return this._sessionState.revision }

  beginSession(
    handlers: TextInputSessionHandlers,
    initialValue = '',
    options?: TextInputSessionOptions,
  ): void {
    this.endSession('replaced')
    this.resetBlink()
    this._startCursorTimer()
    this._sessionState = createTextInputSessionState(initialValue)
    if (options?.readOnly) {
      this._sessionState = cloneTextInputSessionState({
        ...this._sessionState,
        readOnly: true,
      })
    }
    const handle = this._port.beginSession({
      contractVersion: textInputContractVersion,
      windowId: options?.windowId ?? 'window-1',
      inputPurpose: options?.inputPurpose ?? 'text',
      multiline: options?.multiline ?? false,
      secure: options?.secure ?? false,
      focus: options?.focus !== false,
      state: this._sessionState,
    }, {
      dispatch: event => this._dispatchPortEvent(event, handlers),
    })
    if (!handle || typeof handle.sessionId !== 'string' || handle.sessionId.length === 0) {
      this._stopCursorTimer()
      throw new Error('TextInputPort returned an invalid session handle')
    }
    this._sessionHandle = handle
  }

  endSession(reason: TextInputEndReason = 'blur'): void {
    this._stopCursorTimer()
    const handle = this._sessionHandle
    this._sessionHandle = undefined
    if (handle) this._port.endSession(handle, reason)
    this._composing = false
    this._compositionText = ''
    this._sessionState = cloneTextInputSessionState({
      ...this._sessionState,
      composition: null,
    })
    this.resetBlink()
  }

  dispose(): void {
    this.endSession('disposed')
    this._disposables.dispose()
  }

  resetBlink(): void {
    this._cursorVisible = true
  }

  setScrollX(scrollX: number): void {
    this._scrollX = Math.max(0, scrollX)
  }

  setSelection(
    start: number,
    end: number,
    opts?: { cursorPos?: number; syncComposer?: boolean },
  ): void {
    this._cursorPos = opts?.cursorPos ?? end
    this._selection.setNormalizedRange(start, end)
    if (opts?.syncComposer) {
      const textLength = this._sessionState.text.length
      this._updatePortState({
        selection: {
          start: Math.max(0, Math.min(textLength, Math.min(start, end))),
          end: Math.max(0, Math.min(textLength, Math.max(start, end))),
        },
      })
    }
  }

  extendSelection(
    focus: number,
    opts?: { cursorPos?: number; syncComposer?: boolean },
  ): void {
    this._cursorPos = opts?.cursorPos ?? focus
    this._selection.extendRange(focus)
    if (opts?.syncComposer) {
      const textLength = this._sessionState.text.length
      this._updatePortState({
        selection: {
          start: Math.max(0, Math.min(textLength, this._selection.start)),
          end: Math.max(0, Math.min(textLength, this._selection.end)),
        },
      })
    }
  }

  syncSelectionFromComposer(opts?: { ignoreComposing?: boolean }): void {
    if (opts?.ignoreComposing && this._composing) return
    if (this._sessionHandle && isReadableSessionPort(this._port)) {
      this._sessionState = this._port.readSessionState(this._sessionHandle)
    }
    this._cursorPos = this._sessionState.selection.start
    this._selection.setNormalizedRange(
      this._sessionState.selection.start,
      this._sessionState.selection.end,
    )
  }

  clampSelection(maxLength: number): void {
    const nextCursor = Math.min(this._cursorPos, maxLength)
    this._selection.clampRange(0, maxLength)
    const nextStart = this._selection.start
    const nextEnd = this._selection.end
    this.setSelection(nextStart, nextEnd, { cursorPos: nextCursor, syncComposer: false })
  }

  setComposerValue(value: string): void {
    this._updatePortState({
      text: value,
      selection: { start: value.length, end: value.length },
      composition: null,
    })
  }

  setComposerReadOnly(readOnly: boolean): void {
    this._updatePortState({
      readOnly,
      composition: readOnly ? null : this._sessionState.composition,
    })
    if (readOnly) this.clearComposition()
  }

  setComposerLineMode(lineText: string, col: number): void {
    const cursor = Math.max(0, Math.min(lineText.length, Math.floor(col)))
    this._updatePortState({
      text: lineText,
      surroundingTextBase: 0,
      selection: { start: cursor, end: cursor },
      composition: null,
    })
  }

  focusComposer(): void {
    if (this._sessionHandle) this._port.focusSession(this._sessionHandle)
  }

  updateComposerPosition(screenX: number, screenY: number): void {
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return
    this.updateComposerCaretRect({
      x: screenX,
      y: screenY + TEXT_INPUT_COMPOSER_Y_OFFSET,
      width: 1,
      height: 1,
      coordinateSpace: 'screen-dip',
    })
  }

  updateComposerCaretRect(caretRect: TextInputSessionState['caretRect']): void {
    if (!this._sessionHandle && isIdleCaretPort(this._port)) {
      this._port.updateIdleCaretPosition(caretRect.x, caretRect.y)
    }
    this._updatePortState({ caretRect })
  }

  clearComposition(): void {
    this._composing = false
    this._compositionText = ''
    if (this._sessionState.composition) this._updatePortState({ composition: null })
  }

  private _dispatchPortEvent(
    event: TextInputEvent,
    handlers: TextInputSessionHandlers,
  ): boolean {
    const handle = this._sessionHandle
    if (!handle || event.sessionId !== handle.sessionId) return false
    if (event.revision !== this._sessionState.revision) return false

    switch (event.type) {
      case 'text-commit':
        this._acceptTextState(event.text, event.selection, null)
        handlers.onInput?.(event.text, this)
        return true
      case 'composition-start':
        validateTextInputRange(event.selection, this._sessionState.text.length, 'event selection')
        validateTextInputRange(
          event.replacementRange,
          this._sessionState.text.length,
          'event composition',
        )
        this._sessionState = cloneTextInputSessionState({
          ...this._sessionState,
          composition: event.replacementRange,
        })
        this._composing = true
        this._compositionText = ''
        handlers.onCompositionStart?.(this)
        return true
      case 'composition-update':
        validateTextInputRange(event.selection, this._sessionState.text.length, 'event selection')
        validateTextInputRange(
          event.replacementRange,
          this._sessionState.text.length,
          'event composition',
        )
        this._sessionState = cloneTextInputSessionState({
          ...this._sessionState,
          composition: event.replacementRange,
        })
        this._composing = true
        this._compositionText = event.text
        handlers.onCompositionUpdate?.(event.text, this)
        return true
      case 'composition-commit':
        this._acceptTextState(event.text, event.selection, null)
        this._composing = false
        this._compositionText = ''
        handlers.onCompositionEnd?.(event.text, this, event.committedText)
        return true
      case 'composition-cancel':
        validateTextInputRange(event.selection, this._sessionState.text.length, 'event selection')
        this._acceptSelection(event.selection)
        this._sessionState = cloneTextInputSessionState({
          ...this._sessionState,
          composition: null,
        })
        this._composing = false
        this._compositionText = ''
        handlers.onCompositionCancel?.(this)
        return true
      case 'key-down':
        validateTextInputRange(event.selection, this._sessionState.text.length, 'event selection')
        this._acceptSelection(event.selection)
        this._sessionState = cloneTextInputSessionState({
          ...this._sessionState,
          selection: event.selection,
        })
        handlers.onKeyDown?.(this._legacyKeyboardEvent(event), this)
        return true
      case 'paste':
        validateTextInputRange(event.selection, this._sessionState.text.length, 'event selection')
        this._acceptSelection(event.selection)
        this._sessionState = cloneTextInputSessionState({
          ...this._sessionState,
          selection: event.selection,
        })
        handlers.onPaste?.(this._legacyClipboardEvent(event), this)
        return true
    }
  }

  private _acceptTextState(
    text: string,
    selection: TextInputRange,
    composition: TextInputRange | null,
  ): void {
    validateTextInputRange(selection, text.length, 'event selection')
    this._sessionState = cloneTextInputSessionState({
      ...this._sessionState,
      text,
      selection,
      composition,
    })
  }

  private _acceptSelection(selection: TextInputRange): void {
    this._cursorPos = selection.start
    this._selection.setNormalizedRange(selection.start, selection.end)
  }

  private _updatePortState(
    patch: Partial<Omit<TextInputSessionState, 'revision'>>,
  ): void {
    const handle = this._sessionHandle
    if (!handle) {
      this._sessionState = cloneTextInputSessionState({ ...this._sessionState, ...patch })
      return
    }
    const next = cloneTextInputSessionState({
      ...this._sessionState,
      ...patch,
      revision: this._sessionState.revision + 1,
    })
    this._port.updateSession(handle, next)
    this._sessionState = next
  }

  private _legacyKeyboardEvent(
    event: Extract<TextInputEvent, { type: 'key-down' }>,
  ): KeyboardEvent {
    if (event.originalEvent) return event.originalEvent
    let defaultPrevented = false
    return {
      get defaultPrevented() { return defaultPrevented },
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      which: event.keyCode,
      location: event.location,
      repeat: event.repeat,
      isComposing: event.composing,
      altKey: event.modifiers.alt,
      ctrlKey: event.modifiers.control,
      metaKey: event.modifiers.meta,
      shiftKey: event.modifiers.shift,
      preventDefault: () => {
        event.preventDefault()
        defaultPrevented = true
      },
      stopImmediatePropagation: event.stopImmediatePropagation,
      stopPropagation: event.stopImmediatePropagation,
      getModifierState: key => {
        const normalized = key.toLowerCase()
        if (normalized === 'alt') return event.modifiers.alt
        if (normalized === 'control') return event.modifiers.control
        if (normalized === 'meta') return event.modifiers.meta
        if (normalized === 'shift') return event.modifiers.shift
        return false
      },
    } as KeyboardEvent
  }

  private _legacyClipboardEvent(
    event: Extract<TextInputEvent, { type: 'paste' }>,
  ): ClipboardEvent {
    if (event.originalEvent) return event.originalEvent
    return {
      clipboardData: {
        getData: format => format === 'text/plain' || format === 'text' ? event.text : '',
      },
      preventDefault: event.preventDefault,
    } as ClipboardEvent
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

interface IdleCaretPort {
  updateIdleCaretPosition(screenX: number, screenY: number): void
}

interface ReadableSessionPort {
  readSessionState(handle: TextInputSessionHandle): TextInputSessionState
}

function isIdleCaretPort(port: TextInputPort): port is TextInputPort & IdleCaretPort {
  return typeof (port as Partial<IdleCaretPort>).updateIdleCaretPosition === 'function'
}

function isReadableSessionPort(port: TextInputPort): port is TextInputPort & ReadableSessionPort {
  return typeof (port as Partial<ReadableSessionPort>).readSessionState === 'function'
}
