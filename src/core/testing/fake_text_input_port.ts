import {
  cloneTextInputSessionState,
  textInputContractVersion,
  type TextInputEndReason,
  type TextInputEvent,
  type TextInputEventSink,
  type TextInputPort,
  type TextInputRange,
  type TextInputSessionHandle,
  type TextInputSessionRequest,
  type TextInputSessionState,
  validateTextInputRange,
  validateTextInputSessionState,
} from '../text_input_port'

interface FakeTextInputSession {
  readonly handle: TextInputSessionHandle
  readonly request: TextInputSessionRequest
  readonly sink: TextInputEventSink
  state: TextInputSessionState
  focused: boolean
}

export interface FakeTextInputEndRecord {
  readonly sessionId: string
  readonly reason: TextInputEndReason
}

export class FakeTextInputPort implements TextInputPort {
  private nextSessionId = 1
  private readonly sessions = new Map<string, FakeTextInputSession>()
  private disposed = false
  readonly endedSessions: FakeTextInputEndRecord[] = []
  updateCount = 0
  focusCount = 0

  get activeSessionCount(): number { return this.sessions.size }
  get isDisposed(): boolean { return this.disposed }
  get activeSessionHandles(): readonly TextInputSessionHandle[] {
    return Object.freeze([...this.sessions.values()].map(session => session.handle))
  }

  beginSession(
    request: TextInputSessionRequest,
    sink: TextInputEventSink,
  ): TextInputSessionHandle {
    this.requireLive()
    if (request.contractVersion !== textInputContractVersion) {
      throw new Error(`Unsupported TextInput contract version: ${request.contractVersion}`)
    }
    if (request.windowId.length === 0) throw new Error('Text input windowId is required')
    validateTextInputSessionState(request.state)
    const handle = Object.freeze({ sessionId: `fake-${this.nextSessionId++}` })
    this.sessions.set(handle.sessionId, {
      handle,
      request: Object.freeze({
        ...request,
        state: cloneTextInputSessionState(request.state),
      }),
      sink,
      state: cloneTextInputSessionState(request.state),
      focused: request.focus,
    })
    if (request.focus) ++this.focusCount
    return handle
  }

  updateSession(handle: TextInputSessionHandle, state: TextInputSessionState): void {
    this.requireLive()
    validateTextInputSessionState(state)
    const session = this.requireSession(handle)
    if (state.revision <= session.state.revision) {
      throw new RangeError('Text input revision must increase on update')
    }
    session.state = cloneTextInputSessionState(state)
    ++this.updateCount
  }

  focusSession(handle: TextInputSessionHandle): void {
    this.requireLive()
    const session = this.requireSession(handle)
    session.focused = true
    ++this.focusCount
  }

  endSession(handle: TextInputSessionHandle, reason: TextInputEndReason): void {
    const session = this.sessions.get(handle.sessionId)
    if (!session || session.handle !== handle) return
    this.sessions.delete(handle.sessionId)
    this.endedSessions.push(Object.freeze({ sessionId: handle.sessionId, reason }))
  }

  getState(handle: TextInputSessionHandle): TextInputSessionState {
    return cloneTextInputSessionState(this.requireSession(handle).state)
  }

  getRequest(handle: TextInputSessionHandle): TextInputSessionRequest {
    return this.requireSession(handle).request
  }

  readSessionState(handle: TextInputSessionHandle): TextInputSessionState {
    return this.getState(handle)
  }

  isFocused(handle: TextInputSessionHandle): boolean {
    return this.requireSession(handle).focused
  }

  dispatch(event: TextInputEvent): boolean {
    const session = this.sessions.get(event.sessionId)
    if (!session) return false
    return session.sink.dispatch(event)
  }

  emitTextCommit(
    handle: TextInputSessionHandle,
    text: string,
    selection: TextInputRange,
  ): boolean {
    const session = this.requireSession(handle)
    validateTextInputRange(selection, text.length, 'fake selection')
    const previous = session.state
    session.state = cloneTextInputSessionState({
      ...session.state,
      text,
      selection,
      composition: null,
    })
    const accepted = this.dispatch({
      type: 'text-commit',
      sessionId: handle.sessionId,
      revision: session.state.revision,
      text,
      selection,
    })
    if (!accepted) session.state = previous
    return accepted
  }

  emitCompositionStart(
    handle: TextInputSessionHandle,
    replacementRange: TextInputRange,
  ): boolean {
    const session = this.requireSession(handle)
    validateTextInputRange(replacementRange, session.state.text.length, 'fake composition')
    const previous = session.state
    session.state = cloneTextInputSessionState({
      ...session.state,
      composition: replacementRange,
    })
    const accepted = this.dispatch({
      type: 'composition-start',
      sessionId: handle.sessionId,
      revision: session.state.revision,
      selection: session.state.selection,
      replacementRange,
    })
    if (!accepted) session.state = previous
    return accepted
  }

  emitCompositionUpdate(
    handle: TextInputSessionHandle,
    text: string,
    replacementRange: TextInputRange,
  ): boolean {
    const session = this.requireSession(handle)
    validateTextInputRange(replacementRange, session.state.text.length, 'fake composition')
    const previous = session.state
    session.state = cloneTextInputSessionState({
      ...session.state,
      composition: replacementRange,
    })
    const accepted = this.dispatch({
      type: 'composition-update',
      sessionId: handle.sessionId,
      revision: session.state.revision,
      text,
      selection: session.state.selection,
      replacementRange,
    })
    if (!accepted) session.state = previous
    return accepted
  }

  emitCompositionCommit(
    handle: TextInputSessionHandle,
    text: string,
    committedText: string,
    selection: TextInputRange,
  ): boolean {
    const session = this.requireSession(handle)
    validateTextInputRange(selection, text.length, 'fake selection')
    const previous = session.state
    session.state = cloneTextInputSessionState({
      ...session.state,
      text,
      selection,
      composition: null,
    })
    const accepted = this.dispatch({
      type: 'composition-commit',
      sessionId: handle.sessionId,
      revision: session.state.revision,
      text,
      committedText,
      selection,
    })
    if (!accepted) session.state = previous
    return accepted
  }

  emitCompositionCancel(
    handle: TextInputSessionHandle,
    selection: TextInputRange,
  ): boolean {
    const session = this.requireSession(handle)
    validateTextInputRange(selection, session.state.text.length, 'fake selection')
    const previous = session.state
    session.state = cloneTextInputSessionState({
      ...session.state,
      selection,
      composition: null,
    })
    const accepted = this.dispatch({
      type: 'composition-cancel',
      sessionId: handle.sessionId,
      revision: session.state.revision,
      selection,
    })
    if (!accepted) session.state = previous
    return accepted
  }

  dispose(): void {
    if (this.disposed) return
    for (const session of [...this.sessions.values()]) {
      this.endSession(session.handle, 'application-disposed')
    }
    this.disposed = true
  }

  private requireSession(handle: TextInputSessionHandle): FakeTextInputSession {
    this.requireLive()
    const session = this.sessions.get(handle.sessionId)
    if (!session || session.handle !== handle) {
      throw new Error(`Unknown text input session: ${handle.sessionId}`)
    }
    return session
  }

  private requireLive(): void {
    if (this.disposed) throw new Error('FakeTextInputPort is disposed')
  }
}
