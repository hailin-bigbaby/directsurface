import { describe, expect, it } from 'vitest'
import { CodeEditorCompletionSession } from './code_editor_completion_session'
import type { CodeEditorCompletionItem } from './code_editor'

const cursorRange = {
  start: { line: 0, column: 1 },
  end: { line: 0, column: 1 },
}

describe('CodeEditorCompletionSession', () => {
  it('aborts the previous request and checks document and context versions', () => {
    const session = new CodeEditorCompletionSession()
    const first = session.beginRequest({
      documentVersion: 1,
      languageContextVersion: 2,
      activation: 'auto',
      triggerKind: 'invoked',
    })
    const second = session.beginRequest({
      documentVersion: 2,
      languageContextVersion: 3,
      activation: 'manual',
      triggerKind: 'invoked',
    })

    expect(first.signal.aborted).toBe(true)
    expect(session.isCurrent(first, 1, 2)).toBe(false)
    expect(session.isCurrent(second, 2, 3)).toBe(true)
  })

  it('normalizes shared ranges and locally filters a complete list', () => {
    const session = new CodeEditorCompletionSession()
    const request = begin(session)

    expect(session.applyResult(request, {
      items: [
        { label: 'SELECT', sortText: '1' },
        { label: 'SESSION', sortText: '2' },
        { label: 'INSERT', sortText: '3' },
      ],
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } },
      validFor: /^[a-z]*$/igy,
    }, {
      fallbackRange: cursorRange,
      currentPrefix: 's',
      defaultValidFor: /^\w*$/,
    })).toBe(true)

    expect(session.items.map(item => item.label)).toEqual(['SELECT', 'SESSION', 'INSERT'])
    expect(session.items[0]?.range).toEqual({
      start: { line: 0, column: 0 },
      end: { line: 0, column: 1 },
    })
    expect(session.validFor?.global).toBe(false)
    expect(session.validFor?.sticky).toBe(false)
    expect(session.updatePrefix('sel', { line: 0, column: 3 })).toBe('filtered')
    expect(session.items.map(item => item.label)).toEqual(['SELECT'])
    expect(session.items[0]?.range).toEqual({
      start: { line: 0, column: 0 },
      end: { line: 0, column: 3 },
    })
    expect(session.range).toEqual({
      start: { line: 0, column: 0 },
      end: { line: 0, column: 3 },
    })
  })

  it('requests again for incomplete lists and prefix deletion', () => {
    const incomplete = new CodeEditorCompletionSession()
    const incompleteRequest = begin(incomplete)
    incomplete.applyResult(incompleteRequest, {
      items: [{ label: 'SELECT' }],
      isIncomplete: true,
    }, openOptions('s'))

    expect(incomplete.updatePrefix('se')).toBe('requery')

    const complete = new CodeEditorCompletionSession()
    const completeRequest = begin(complete)
    complete.applyResult(completeRequest, [{ label: 'SELECT' }], openOptions('se'))
    expect(complete.updatePrefix('s')).toBe('requery')
  })

  it('closes when the prefix no longer matches validFor', () => {
    const session = new CodeEditorCompletionSession()
    const request = begin(session)
    session.applyResult(request, {
      items: [{ label: 'SELECT' }],
      validFor: /^[a-z]*$/i,
    }, openOptions('s'))

    expect(session.updatePrefix('s;')).toBe('closed')
    expect(session.state).toBe('closed')
    expect(session.items).toEqual([])
  })

  it('enforces the emergency item limit and marks the session incomplete', () => {
    const session = new CodeEditorCompletionSession(8, 10)
    const request = begin(session)
    const items = Array.from({ length: 15 }, (_, index) => ({ label: `item-${index}` }))

    session.applyResult(request, items, openOptions(''))

    expect(session.debugState()).toMatchObject({ itemCount: 10, isIncomplete: true })
  })

  it('keeps keyboard and mouse selection inside the visible window', () => {
    const session = new CodeEditorCompletionSession(4)
    const request = begin(session)
    session.applyResult(request, itemList(12), openOptions(''))

    expect(session.moveSelectionPage(2)).toBe(true)
    expect(session.debugState()).toMatchObject({ selectedIndex: 8, visibleStart: 5 })
    expect(session.visibleItems().map(item => item.label)).toEqual(['item-5', 'item-6', 'item-7', 'item-8'])
    expect(session.itemIndexAtVisibleRow(3)).toBe(8)

    expect(session.moveSelectionBoundary('end')).toBe(true)
    expect(session.debugState()).toMatchObject({ selectedIndex: 11, visibleStart: 8 })
    expect(session.scrollVisibleRows(-2)).toBe(true)
    expect(session.debugState().visibleStart).toBe(6)
  })

  it('opens context-boundary results without preselection and selects from arrow direction', () => {
    const down = new CodeEditorCompletionSession(4)
    const downRequest = down.beginRequest({
      documentVersion: 1,
      languageContextVersion: 1,
      activation: 'auto',
      triggerKind: 'invoked',
      invocationReason: 'context-boundary',
      selectionPolicy: 'defer-selection',
    })
    down.applyResult(downRequest, itemList(3), openOptions(''))

    expect(down.debugState()).toMatchObject({
      selectedIndex: -1,
      invocationReason: 'context-boundary',
      selectionPolicy: 'defer-selection',
    })
    expect(down.currentItem).toBeUndefined()
    expect(down.moveSelection(1)).toBe(true)
    expect(down.currentItem?.label).toBe('item-0')

    const up = new CodeEditorCompletionSession(4)
    const upRequest = up.beginRequest({
      documentVersion: 1,
      languageContextVersion: 1,
      activation: 'auto',
      triggerKind: 'invoked',
      invocationReason: 'context-boundary',
      selectionPolicy: 'defer-selection',
    })
    up.applyResult(upRequest, itemList(3), openOptions(''))
    expect(up.moveSelection(-1)).toBe(true)
    expect(up.currentItem?.label).toBe('item-2')
  })

  it('preselects the first local match after typing into a deferred session', () => {
    const session = new CodeEditorCompletionSession()
    const request = session.beginRequest({
      documentVersion: 1,
      languageContextVersion: 1,
      activation: 'auto',
      triggerKind: 'invoked',
      invocationReason: 'context-boundary',
      selectionPolicy: 'defer-selection',
    })
    session.applyResult(request, [{ label: 'users' }, { label: 'orders' }], {
      ...openOptions(''),
      defaultValidFor: /^[a-z]*$/i,
    })

    expect(session.updatePrefix('u', { line: 0, column: 2 })).toBe('filtered')
    expect(session.currentItem?.label).toBe('users')
    expect(session.debugState()).toMatchObject({ selectedIndex: 0, currentPrefix: 'u' })
  })
})

function begin(session: CodeEditorCompletionSession) {
  return session.beginRequest({
    documentVersion: 1,
    languageContextVersion: 1,
    activation: 'auto',
    triggerKind: 'invoked',
  })
}

function openOptions(prefix: string) {
  return {
    fallbackRange: cursorRange,
    currentPrefix: prefix,
    defaultValidFor: /^\w*$/,
  }
}

function itemList(count: number): CodeEditorCompletionItem[] {
  return Array.from({ length: count }, (_, index) => ({ label: `item-${index}` }))
}
