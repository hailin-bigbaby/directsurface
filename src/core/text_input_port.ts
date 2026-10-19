export const textInputContractVersion = 1 as const

export type TextInputPurpose = 'text' | 'password' | 'search'
export type TextInputEndReason =
  | 'blur'
  | 'replaced'
  | 'readonly'
  | 'disposed'
  | 'application-disposed'

export interface TextInputRange {
  readonly start: number
  readonly end: number
}

export interface TextInputCaretRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly coordinateSpace: 'screen-dip'
}

export interface TextInputSessionState {
  readonly revision: number
  readonly text: string
  readonly surroundingTextBase: number
  readonly selection: TextInputRange
  readonly composition: TextInputRange | null
  readonly caretRect: TextInputCaretRect
  readonly readOnly: boolean
}

export interface TextInputSessionRequest {
  readonly contractVersion: typeof textInputContractVersion
  readonly windowId: string
  readonly inputPurpose: TextInputPurpose
  readonly multiline: boolean
  readonly secure: boolean
  readonly focus: boolean
  readonly state: TextInputSessionState
}

export interface TextInputSessionHandle {
  readonly sessionId: string
}

export interface TextInputModifiers {
  readonly alt: boolean
  readonly control: boolean
  readonly meta: boolean
  readonly shift: boolean
}

interface TextInputEventBase {
  readonly sessionId: string
  readonly revision: number
}

export type TextInputEvent =
  | (TextInputEventBase & {
      readonly type: 'text-commit'
      readonly text: string
      readonly selection: TextInputRange
    })
  | (TextInputEventBase & {
      readonly type: 'composition-start'
      readonly selection: TextInputRange
      readonly replacementRange: TextInputRange
    })
  | (TextInputEventBase & {
      readonly type: 'composition-update'
      readonly text: string
      readonly selection: TextInputRange
      readonly replacementRange: TextInputRange
    })
  | (TextInputEventBase & {
      readonly type: 'composition-commit'
      readonly text: string
      readonly committedText: string
      readonly selection: TextInputRange
    })
  | (TextInputEventBase & {
      readonly type: 'composition-cancel'
      readonly selection: TextInputRange
    })
  | (TextInputEventBase & {
      readonly type: 'key-down'
      /** Web-only event identity; Native ports keep the existing portable fields. */
      readonly originalEvent?: KeyboardEvent
      readonly key: string
      readonly code: string
      readonly keyCode: number
      readonly location: number
      readonly repeat: boolean
      readonly composing: boolean
      readonly selection: TextInputRange
      readonly modifiers: TextInputModifiers
      readonly preventDefault: () => void
      readonly stopImmediatePropagation: () => void
    })
  | (TextInputEventBase & {
      readonly type: 'paste'
      /** Preserve the browser ClipboardEvent without rebuilding its DataTransfer. */
      readonly originalEvent?: ClipboardEvent
      readonly text: string
      readonly selection: TextInputRange
      readonly preventDefault: () => void
    })

export interface TextInputEventSink {
  dispatch(event: TextInputEvent): boolean
}

export interface TextInputPort {
  beginSession(
    request: TextInputSessionRequest,
    sink: TextInputEventSink,
  ): TextInputSessionHandle
  updateSession(handle: TextInputSessionHandle, state: TextInputSessionState): void
  focusSession(handle: TextInputSessionHandle): void
  endSession(handle: TextInputSessionHandle, reason: TextInputEndReason): void
}

export function createTextInputSessionState(
  text: string,
  revision = 1,
): TextInputSessionState {
  return Object.freeze({
    revision,
    text,
    surroundingTextBase: 0,
    selection: Object.freeze({ start: text.length, end: text.length }),
    composition: null,
    caretRect: Object.freeze({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      coordinateSpace: 'screen-dip' as const,
    }),
    readOnly: false,
  })
}

export function cloneTextInputSessionState(
  state: TextInputSessionState,
): TextInputSessionState {
  return Object.freeze({
    ...state,
    selection: Object.freeze({ ...state.selection }),
    composition: state.composition ? Object.freeze({ ...state.composition }) : null,
    caretRect: Object.freeze({ ...state.caretRect }),
  })
}

export function validateTextInputSessionState(state: TextInputSessionState): void {
  if (!Number.isSafeInteger(state.revision) || state.revision <= 0) {
    throw new RangeError('Text input revision must be a positive safe integer')
  }
  if (!Number.isSafeInteger(state.surroundingTextBase) || state.surroundingTextBase < 0) {
    throw new RangeError('Text input surroundingTextBase must be a non-negative safe integer')
  }
  validateTextInputRange(state.selection, state.text.length, 'selection')
  if (state.composition) validateTextInputRange(state.composition, state.text.length, 'composition')
  const rect = state.caretRect
  if (
    !Number.isFinite(rect.x) || !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) || rect.width < 0 ||
    !Number.isFinite(rect.height) || rect.height < 0 ||
    rect.coordinateSpace !== 'screen-dip'
  ) {
    throw new RangeError('Text input caret rect must be finite screen DIP geometry')
  }
}

export function validateTextInputRange(
  range: TextInputRange,
  textLength: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) ||
    range.start < 0 || range.end < range.start || range.end > textLength
  ) {
    throw new RangeError(`Text input ${label} is outside the UTF-16 text range`)
  }
}
