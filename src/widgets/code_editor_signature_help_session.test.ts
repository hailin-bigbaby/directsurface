import { describe, expect, it } from 'vitest'
import type { CodeEditorSignatureHelp } from './code_editor'
import {
  CodeEditorSignatureHelpSession,
  normalizeSignatureHelp,
} from './code_editor_signature_help_session'

const position = { line: 0, column: 7 }

describe('CodeEditorSignatureHelpSession', () => {
  it('aborts old requests and isolates document, context, and cursor generations', () => {
    const session = new CodeEditorSignatureHelpSession()
    const first = begin(session, { documentVersion: 1, languageContextVersion: 2, cursorGeneration: 3 })
    const second = begin(session, { documentVersion: 2, languageContextVersion: 4, cursorGeneration: 6 })

    expect(first.signal.aborted).toBe(true)
    expect(session.isCurrent(first, 1, 2, 3)).toBe(false)
    expect(session.isCurrent(second, 2, 4, 6)).toBe(true)
    expect(session.isCurrent(second, 2, 4, 7)).toBe(false)
  })

  it('deep clones results and remaps active signatures in original coordinates', () => {
    const help: CodeEditorSignatureHelp = {
      signatures: [
        { label: '  ', parameters: [] },
        { label: 'fn(a)', documentation: 'docs', parameters: [{ label: 'a' }] },
        { label: 'fn(a, b)', parameters: [{ label: 'a' }, { label: 'b' }] },
      ],
      activeSignature: 1,
      activeParameter: 4,
      range: { start: { line: 2, column: 8 }, end: { line: 2, column: 2 } },
    }
    const session = new CodeEditorSignatureHelpSession()
    const request = begin(session)

    expect(session.applyResult(request, help, current())).toBe(true)
    help.signatures[1]!.parameters[0]!.label = 'mutated'
    const firstRead = session.help!
    firstRead.signatures[0]!.parameters[0]!.label = 'consumer mutation'

    expect(session.help).toEqual({
      signatures: [
        { label: 'fn(a)', documentation: 'docs', parameters: [{ label: 'a', documentation: undefined }] },
        {
          label: 'fn(a, b)',
          documentation: undefined,
          parameters: [
            { label: 'a', documentation: undefined },
            { label: 'b', documentation: undefined },
          ],
        },
      ],
      activeSignature: 0,
      activeParameter: 4,
      range: { start: { line: 2, column: 2 }, end: { line: 2, column: 8 } },
    })
  })

  it('selects the nearest retained overload and breaks ties toward the lower original index', () => {
    const normalized = normalizeSignatureHelp({
      signatures: [
        { label: 'left()', parameters: [] },
        { label: '', parameters: [] },
        { label: 'right()', parameters: [] },
      ],
      activeSignature: 1,
      activeParameter: -3,
    })

    expect(normalized).toMatchObject({ activeSignature: 0, activeParameter: 0 })
    expect(normalized?.signatures.map(signature => signature.label)).toEqual(['left()', 'right()'])
  })

  it('treats empty signatures as null and keeps fixed-signature parameter over-counts', () => {
    expect(normalizeSignatureHelp({
      signatures: [{ label: ' ', parameters: [] }],
      activeSignature: 0,
      activeParameter: 0,
    })).toBeNull()

    expect(normalizeSignatureHelp({
      signatures: [{ label: 'fn(a)', parameters: [{ label: 'a' }] }],
      activeSignature: 99,
      activeParameter: 5,
    })).toMatchObject({ activeSignature: 0, activeParameter: 5 })
  })

  it('suppresses pending and active sessions for completion and retriggers only once', () => {
    const session = new CodeEditorSignatureHelpSession()
    const request = begin(session)
    expect(session.suppressForCompletion()).toBe(true)
    expect(request.signal.aborted).toBe(true)
    expect(session.debugState()).toMatchObject({ state: 'suppressed', needsRetrigger: true })
    expect(session.consumeCompletionCloseRetrigger()).toBe(true)
    expect(session.consumeCompletionCloseRetrigger()).toBe(false)

    begin(session)
    session.suppressForCompletion()
    session.suppressNextCompletionCloseRetrigger()
    expect(session.consumeCompletionCloseRetrigger()).toBe(false)
    expect(session.debugState().needsRetrigger).toBe(true)
  })

  it('moves overload selection only for a visible multi-signature result', () => {
    const session = new CodeEditorSignatureHelpSession()
    const request = begin(session)
    session.applyResult(request, {
      signatures: [
        { label: 'fn(a)', parameters: [{ label: 'a' }] },
        { label: 'fn(a, b)', parameters: [{ label: 'a' }, { label: 'b' }] },
      ],
      activeSignature: 0,
      activeParameter: 0,
    }, current())

    expect(session.moveActiveSignature(-1)).toBe(true)
    expect(session.help?.activeSignature).toBe(1)
    expect(session.close()).toBe(true)
    expect(session.moveActiveSignature(1)).toBe(false)
  })
})

function begin(
  session: CodeEditorSignatureHelpSession,
  overrides: Partial<Parameters<CodeEditorSignatureHelpSession['beginRequest']>[0]> = {},
) {
  return session.beginRequest({
    documentVersion: 1,
    languageContextVersion: 2,
    cursorGeneration: 3,
    position,
    triggerKind: 'trigger-character',
    triggerCharacter: '(',
    isRetrigger: false,
    ...overrides,
  })
}

function current() {
  return { documentVersion: 1, languageContextVersion: 2, cursorGeneration: 3 }
}
