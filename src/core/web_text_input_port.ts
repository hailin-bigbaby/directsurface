import {
  InputComposer,
  type InputSessionToken,
} from './input_composer'
import {
  cloneTextInputSessionState,
  type TextInputEndReason,
  type TextInputEventSink,
  type TextInputPort,
  type TextInputSessionHandle,
  type TextInputSessionRequest,
  type TextInputSessionState,
  validateTextInputSessionState,
} from './text_input_port'

interface WebTextInputSession {
  readonly handle: TextInputSessionHandle
  readonly sink: TextInputEventSink
  readonly token: InputSessionToken
  state: TextInputSessionState
}

export class WebTextInputPort implements TextInputPort {
  private static _instance?: WebTextInputPort

  static get instance(): WebTextInputPort {
    return WebTextInputPort._instance ??= new WebTextInputPort()
  }

  private nextSessionId = 1
  private readonly sessions = new Map<string, WebTextInputSession>()
  private activeSessionId?: string

  beginSession(
    request: TextInputSessionRequest,
    sink: TextInputEventSink,
  ): TextInputSessionHandle {
    validateTextInputSessionState(request.state)
    const handle = Object.freeze({ sessionId: `web-${this.nextSessionId++}` })
    const token = InputComposer.instance.begin({
      onInput: value => this.dispatchText(handle, sink, value),
      onCompositionStart: () => this.dispatchCompositionStart(handle, sink),
      onCompositionUpdate: text => this.dispatchCompositionUpdate(handle, sink, text),
      onCompositionEnd: (value, committedText) => {
        this.dispatchCompositionCommit(handle, sink, value, committedText ?? '')
      },
      onKeyDown: event => {
        const session = this.sessions.get(handle.sessionId)
        if (!session || this.activeSessionId !== handle.sessionId) return
        session.state = cloneTextInputSessionState({
          ...session.state,
          selection: this.composerSelection(),
        })
        sink.dispatch({
          type: 'key-down',
          originalEvent: event,
          sessionId: handle.sessionId,
          revision: session.state.revision,
          key: event.key,
          code: event.code,
          keyCode: event.keyCode,
          location: event.location,
          repeat: event.repeat,
          composing: event.isComposing,
          selection: session.state.selection,
          modifiers: {
            alt: event.altKey,
            control: event.ctrlKey,
            meta: event.metaKey,
            shift: event.shiftKey,
          },
          preventDefault: () => event.preventDefault(),
          stopImmediatePropagation: () => event.stopImmediatePropagation(),
        })
      },
      onPaste: event => {
        const session = this.sessions.get(handle.sessionId)
        if (!session || this.activeSessionId !== handle.sessionId) return
        session.state = cloneTextInputSessionState({
          ...session.state,
          selection: this.composerSelection(),
        })
        sink.dispatch({
          type: 'paste',
          originalEvent: event,
          sessionId: handle.sessionId,
          revision: session.state.revision,
          text: event.clipboardData?.getData('text/plain')
            ?? event.clipboardData?.getData('text')
            ?? '',
          selection: session.state.selection,
          preventDefault: () => event.preventDefault(),
        })
      },
    }, request.state.text, { focus: request.focus, readOnly: request.state.readOnly })
    const session: WebTextInputSession = {
      handle,
      sink,
      token,
      state: cloneTextInputSessionState(request.state),
    }
    this.sessions.set(handle.sessionId, session)
    this.activeSessionId = handle.sessionId
    this.applyState(session, undefined)
    return handle
  }

  updateSession(handle: TextInputSessionHandle, state: TextInputSessionState): void {
    validateTextInputSessionState(state)
    const session = this.requireSession(handle)
    if (state.revision <= session.state.revision) {
      throw new RangeError('Text input revision must increase on update')
    }
    const previous = session.state
    session.state = cloneTextInputSessionState(state)
    this.applyState(session, previous)
  }

  focusSession(handle: TextInputSessionHandle): void {
    this.requireSession(handle)
    if (this.activeSessionId === handle.sessionId) InputComposer.instance.focus()
  }

  endSession(handle: TextInputSessionHandle, _reason: TextInputEndReason): void {
    const session = this.sessions.get(handle.sessionId)
    if (!session) return
    this.sessions.delete(handle.sessionId)
    InputComposer.instance.end(session.token)
    if (this.activeSessionId === handle.sessionId) this.activeSessionId = undefined
  }

  updateIdleCaretPosition(screenX: number, screenY: number): void {
    InputComposer.instance.updatePosition(screenX, screenY)
  }

  readSessionState(handle: TextInputSessionHandle): TextInputSessionState {
    const session = this.requireSession(handle)
    if (this.activeSessionId !== handle.sessionId) {
      return cloneTextInputSessionState(session.state)
    }
    return cloneTextInputSessionState({
      ...session.state,
      text: InputComposer.instance.value,
      selection: this.composerSelection(),
    })
  }

  private applyState(
    session: WebTextInputSession,
    previous: TextInputSessionState | undefined,
  ): void {
    if (this.activeSessionId !== session.handle.sessionId) return
    const state = session.state
    if (!previous || state.text !== previous.text) InputComposer.instance.setValue(state.text)
    if (
      !previous || state.selection.start !== previous.selection.start ||
      state.selection.end !== previous.selection.end || state.text !== previous.text
    ) {
      InputComposer.instance.setSelection(state.selection.start, state.selection.end)
    }
    if (!previous || state.readOnly !== previous.readOnly) {
      InputComposer.instance.setReadOnly(state.readOnly)
    }
    InputComposer.instance.updatePosition(state.caretRect.x, state.caretRect.y)
  }

  private dispatchText(
    handle: TextInputSessionHandle,
    sink: TextInputEventSink,
    text: string,
  ): void {
    const session = this.sessions.get(handle.sessionId)
    if (!session || this.activeSessionId !== handle.sessionId) return
    const selection = this.composerSelection()
    session.state = cloneTextInputSessionState({
      ...session.state,
      text,
      selection,
      composition: null,
    })
    sink.dispatch({
      type: 'text-commit',
      sessionId: handle.sessionId,
      revision: session.state.revision,
      text,
      selection,
    })
  }

  private dispatchCompositionStart(
    handle: TextInputSessionHandle,
    sink: TextInputEventSink,
  ): void {
    const session = this.sessions.get(handle.sessionId)
    if (!session || this.activeSessionId !== handle.sessionId) return
    const selection = this.composerSelection()
    session.state = cloneTextInputSessionState({
      ...session.state,
      selection,
      composition: selection,
    })
    sink.dispatch({
      type: 'composition-start',
      sessionId: handle.sessionId,
      revision: session.state.revision,
      selection,
      replacementRange: selection,
    })
  }

  private dispatchCompositionUpdate(
    handle: TextInputSessionHandle,
    sink: TextInputEventSink,
    text: string,
  ): void {
    const session = this.sessions.get(handle.sessionId)
    if (!session || this.activeSessionId !== handle.sessionId) return
    const selection = session.state.selection
    sink.dispatch({
      type: 'composition-update',
      sessionId: handle.sessionId,
      revision: session.state.revision,
      text,
      selection,
      replacementRange: session.state.composition ?? selection,
    })
  }

  private dispatchCompositionCommit(
    handle: TextInputSessionHandle,
    sink: TextInputEventSink,
    text: string,
    committedText: string,
  ): void {
    const session = this.sessions.get(handle.sessionId)
    if (!session || this.activeSessionId !== handle.sessionId) return
    const selection = this.composerSelection()
    session.state = cloneTextInputSessionState({
      ...session.state,
      text,
      selection,
      composition: null,
    })
    sink.dispatch({
      type: 'composition-commit',
      sessionId: handle.sessionId,
      revision: session.state.revision,
      text,
      committedText,
      selection,
    })
  }

  private composerSelection(): { start: number; end: number } {
    return {
      start: InputComposer.instance.selectionStart,
      end: InputComposer.instance.selectionEnd,
    }
  }

  private requireSession(handle: TextInputSessionHandle): WebTextInputSession {
    const session = this.sessions.get(handle.sessionId)
    if (!session || session.handle !== handle) {
      throw new Error(`Unknown text input session: ${handle.sessionId}`)
    }
    return session
  }
}
