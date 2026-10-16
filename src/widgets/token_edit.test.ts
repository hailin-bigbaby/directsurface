// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { FormSession } from '../core/form_session'
import { InputComposer } from '../core/input_composer'
import { PopupManager } from '../core/popup_manager'
import { GestureArenaManager, type GestureArenaMember } from '../gestures/gesture_arena'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { DropdownPopup } from './dropdown'
import { bindFormField } from './form_field_binding'
import { RenderTokenEdit } from './token_edit'

const constraints = {
  minWidth: 0,
  maxWidth: 240,
  minHeight: 0,
  maxHeight: 40,
}

function setPopupTestContext(): void {
  PopupManager.instance.setContextProvider(() => ({
    theme: ImGuiDarkTheme,
    viewport: { width: 400, height: 300, dpr: 1 },
  }))
}

function pasteIntoTokenEdit(text: string): HTMLTextAreaElement {
  const input = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: () => text },
  })
  input.dispatchEvent(event)
  return input
}

function pressEnter(input: HTMLTextAreaElement): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
}

function firstRemoveTarget(edit: RenderTokenEdit): {
  input: any
  point: { x: number; y: number }
} {
  const input = (edit as any)._input
  const leadingRect = input.tokenInlineLayout().leadingRect
  if (!leadingRect) throw new Error('Token leading content was not laid out')
  const layout = edit.resolveChipLayout(
    ImGuiDarkTheme,
    leadingRect.h + edit.fieldVerticalPadding(ImGuiDarkTheme) * 2,
  )
  const chip = layout.chips[0]
  if (!chip || chip.removeX === null) throw new Error('Token remove target was not laid out')
  return {
    input,
    point: {
      x: leadingRect.x + chip.removeX + chip.removeWidth / 2,
      y: leadingRect.y + leadingRect.h / 2,
    },
  }
}

afterEach(() => {
  PopupManager.disposeInstance()
  FocusManager.disposeInstance()
  InputComposer.disposeInstance()
  vi.restoreAllMocks()
})

describe('RenderTokenEdit', () => {
  it('keeps unlimited single-token paste submission as the default', () => {
    const edit = new RenderTokenEdit({ allowCustomTokens: true })
    edit.layout(constraints)
    edit.focus()
    const input = pasteIntoTokenEdit('甲，乙;丙')
    expect(edit.values).toEqual([])
    expect(edit.maxTokens).toBe(null)
    expect(edit.splitOnEnter).toBe(false)
    pressEnter(input)
    expect(edit.values).toEqual(['甲，乙;丙'])
    expect(edit.query).toBe('')
    edit.dispose()
  })

  it.each([
    [undefined, null], [null, null], [Infinity, null], [NaN, null], [-3, 0], [0, 0], [2.9, 2],
  ])('normalizes maxTokens %s to %s', (provided, expected) => {
    const edit = new RenderTokenEdit({ maxTokens: provided, allowCustomTokens: true })
    expect(edit.maxTokens).toBe(expected)
    edit.maxTokens = 1
    edit.maxTokens = provided ?? null
    expect(edit.maxTokens).toBe(expected)
    edit.dispose()
  })

  it('enforces limits for custom tokens, separators and popup selection, then permits removal', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const edit = new RenderTokenEdit({
      options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
      allowCustomTokens: true, maxTokens: 1, onChange,
    })
    edit.layout(constraints)
    edit.focus()
    const popup = (edit as any)._popup as DropdownPopup
    popup.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(edit.values).toEqual(['a'])
    expect(edit.debugState().suggestions).toEqual([])
    edit.query = 'custom'
    expect(edit.commitEdit()).toBe(false)
    edit.handleInputKeyDown(new KeyboardEvent('keydown', { key: ',', cancelable: true }))
    expect(edit.values).toEqual(['a'])
    expect(edit.query).toBe('custom')
    expect(onChange).toHaveBeenCalledOnce()

    edit.query = ''
    edit.handleInputKeyDown(new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }))
    expect(edit.values).toEqual([])
    expect(edit.debugState().popupVisible).toBe(true)
    popup.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(edit.values).toEqual(['a'])
    expect(onChange).toHaveBeenCalledTimes(3)
    edit.dispose()
  })

  it('preserves external values and drafts when changing limits, and refreshes suggestions', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const listener = vi.fn()
    const edit = new RenderTokenEdit({
      options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
      values: ['a', 'b'], maxTokens: 1, allowCustomTokens: true, onChange,
    })
    edit.subscribeValueChange(listener)
    expect(edit.values).toEqual(['a', 'b'])
    edit.values = ['external', 'other']
    expect(edit.values).toEqual(['external', 'other'])
    edit.setValue(['a'])
    edit.layout(constraints)
    edit.focus()
    edit.query = 'Beta'
    expect(edit.debugState().popupVisible).toBe(false)
    edit.maxTokens = 2
    expect(edit.query).toBe('Beta')
    expect(edit.debugState().popupVisible).toBe(true)
    edit.maxTokens = 0
    expect(edit.debugState().popupVisible).toBe(false)
    expect(edit.commitEdit()).toBe(false)
    expect(edit.values).toEqual(['a'])
    expect(onChange).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    edit.maxTokens = null
    expect(edit.commitEdit()).toBe(true)
    expect(edit.values).toEqual(['a', 'b'])
    edit.dispose()
  })

  it('splits pasted labels and values only on Enter, deduplicating in order with one notification', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const listener = vi.fn()
    const edit = new RenderTokenEdit({
      options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }],
      values: ['a'], allowCustomTokens: true, splitOnEnter: true, maxTokens: 3, onChange,
    })
    edit.subscribeValueChange(listener)
    edit.layout(constraints)
    edit.focus()
    const input = pasteIntoTokenEdit(' 甲，乙; b； 自定义 ,, ')
    expect(edit.values).toEqual(['a'])
    expect(onChange).not.toHaveBeenCalled()
    pressEnter(input)
    expect(edit.values).toEqual(['a', 'b', '自定义'])
    expect(edit.query).toBe('')
    expect(edit.isFocused).toBe(true)
    expect(onChange).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith({
      value: ['a', 'b', '自定义'], previousValue: ['a'], reason: 'add',
      detail: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }, { value: '自定义', label: '自定义' }],
    })
    edit.query = '甲,a,乙'
    expect(edit.commitEdit()).toBe(true)
    expect(onChange).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledOnce()
    edit.dispose()
  })

  it('rejects the whole batch on overflow and preserves input for retry', () => {
    const onChange = vi.fn()
    const edit = new RenderTokenEdit({ allowCustomTokens: true, splitOnEnter: true, maxTokens: 2, values: ['first'], onChange })
    edit.query = 'second,third'
    expect(edit.commitEdit()).toBe(false)
    expect(edit.values).toEqual(['first'])
    expect(edit.query).toBe('second,third')
    expect(onChange).not.toHaveBeenCalled()
    edit.maxTokens = 3
    expect(edit.commitEdit()).toBe(true)
    expect(edit.values).toEqual(['first', 'second', 'third'])
    expect(onChange).toHaveBeenCalledOnce()
    edit.dispose()
  })

  it.each(['unknown', 'Disabled'])('rejects the whole predefined batch containing %s', text => {
    const onChange = vi.fn()
    const edit = new RenderTokenEdit({
      options: [{ value: 'a', label: 'Alpha' }, { value: 'd', label: 'Disabled', disabled: true }],
      splitOnEnter: true, onChange,
    })
    edit.query = `Alpha,${text}`
    expect(edit.commitEdit()).toBe(false)
    expect(edit.values).toEqual([])
    expect(edit.query).toBe(`Alpha,${text}`)
    expect(onChange).not.toHaveBeenCalled()
    edit.dispose()
  })

  it('uses literal custom separators and keeps separator-key submission single', () => {
    const edit = new RenderTokenEdit({ allowCustomTokens: true, splitOnEnter: true, tokenSeparators: ['|', '||', '.', ''] })
    edit.query = 'a||b.c|a'
    expect(edit.commitEdit()).toBe(true)
    expect(edit.values).toEqual(['a', 'b', 'c'])
    edit.query = 'd|e'
    edit.handleInputKeyDown(new KeyboardEvent('keydown', { key: '.', cancelable: true }))
    expect(edit.values).toEqual(['a', 'b', 'c', 'd|e'])
    edit.query = '||...|'
    expect(edit.commitEdit()).toBe(true)
    expect(edit.values).toEqual(['a', 'b', 'c', 'd|e'])
    edit.dispose()
  })

  it('prevents a matching popup from swallowing batch Enter and supports runtime opt-out', () => {
    setPopupTestContext()
    const edit = new RenderTokenEdit({ options: [{ value: 'combined', label: 'Alpha,Beta' }], allowCustomTokens: true })
    edit.layout(constraints)
    edit.focus()
    edit.query = 'Alpha,Beta'
    expect(edit.debugState().popupVisible).toBe(true)
    edit.splitOnEnter = true
    expect(edit.debugState().popupVisible).toBe(false)
    pressEnter(document.getElementById('__ds_ui_input__') as HTMLTextAreaElement)
    expect(edit.values).toEqual(['Alpha', 'Beta'])
    edit.splitOnEnter = false
    edit.query = 'Gamma,Delta'
    pressEnter(document.getElementById('__ds_ui_input__') as HTMLTextAreaElement)
    expect(edit.values).toEqual(['Alpha', 'Beta', 'Gamma,Delta'])
    edit.dispose()
  })

  it('keeps batch Enter inert during IME composition and commits afterwards', () => {
    const edit = new RenderTokenEdit({ allowCustomTokens: true, splitOnEnter: true, maxTokens: 2 })
    edit.layout(constraints)
    edit.focus()
    const input = pasteIntoTokenEdit('甲,')
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
    expect(edit.values).toEqual([])
    input.value = '甲,乙'
    input.setSelectionRange(3, 3)
    input.dispatchEvent(new CompositionEvent('compositionend', { data: '乙', bubbles: true }))
    expect(edit.values).toEqual([])
    pressEnter(input)
    expect(edit.values).toEqual(['甲', '乙'])
    edit.dispose()
  })

  it.each(['readonly', 'disabled'] as const)('does not batch submit or remove when %s', state => {
    const onChange = vi.fn()
    const edit = new RenderTokenEdit({ allowCustomTokens: true, splitOnEnter: true, maxTokens: 3, values: ['a'], [state]: true, onChange })
    edit.query = 'b,c'
    expect(edit.commitEdit()).toBe(false)
    edit.removeToken('a')
    expect(edit.values).toEqual(['a'])
    expect(edit.query).toBe('b,c')
    expect(onChange).not.toHaveBeenCalled()
    edit.dispose()
  })

  it('finishes batch geometry and structured notification even if onChange throws', () => {
    const error = new Error('batch callback')
    const listener = vi.fn()
    const edit = new RenderTokenEdit({ allowCustomTokens: true, splitOnEnter: true, onChange: () => { throw error } })
    edit.subscribeValueChange(listener)
    edit.layout(constraints)
    edit.query = 'a,b'
    expect(() => edit.commitEdit()).toThrow(error)
    expect(edit.values).toEqual(['a', 'b'])
    expect(edit.query).toBe('')
    expect(listener).toHaveBeenCalledOnce()
    expect((edit as any)._input.needsLayout).toBe(true)
    edit.dispose()
  })

  it('flushes batches into a bound form and blocks submission while over capacity', async () => {
    const edit = new RenderTokenEdit({ allowCustomTokens: true, splitOnEnter: true, maxTokens: 1 })
    const form = new FormSession({ tags: [] as string[] })
    const disposeBinding = bindFormField(form, 'tags', edit, { validateOn: [] })
    const submit = vi.fn(() => 'saved')
    edit.query = 'a,b'
    await form.runSubmit(submit)
    expect(submit).not.toHaveBeenCalled()
    expect(form.getValue('tags')).toEqual([])
    expect(edit.query).toBe('a,b')
    edit.maxTokens = 2
    const result = await form.runSubmit(submit)
    expect(result.status).toBe('submitted')
    expect(submit).toHaveBeenCalledOnce()
    expect(form.getValue('tags')).toEqual(['a', 'b'])
    disposeBinding()
    form.dispose()
    edit.dispose()
  })

  it('normalizes predefined values, resolves labels, and removes duplicates', () => {
    const edit = new RenderTokenEdit({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      values: ['b', 'missing', 'a', 'b'],
    })

    expect(edit.values).toEqual(['b', 'a'])
    expect(edit.tokens).toEqual([
      { value: 'b', label: 'Beta' },
      { value: 'a', label: 'Alpha' },
    ])

    edit.dispose()
  })

  it('publishes structured reconciliation while keeping the legacy callback silent', () => {
    const onChange = vi.fn()
    const valueListener = vi.fn()
    const edit = new RenderTokenEdit({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      values: ['b'],
      onChange,
    })
    edit.subscribeValueChange(valueListener)

    edit.options = [{ value: 'a', label: 'Alpha' }]
    expect(edit.values).toEqual([])
    expect(valueListener).toHaveBeenLastCalledWith({
      value: [],
      previousValue: ['b'],
      reason: 'options-reconcile',
      detail: [],
      userInitiated: false,
    })

    edit.values = ['a']
    edit.allowCustomTokens = true
    edit.values = ['custom']
    edit.allowCustomTokens = false

    expect(edit.values).toEqual([])
    expect(valueListener).toHaveBeenCalledTimes(2)
    expect(valueListener).toHaveBeenLastCalledWith({
      value: [],
      previousValue: ['custom'],
      reason: 'mode-reconcile',
      detail: [],
      userInitiated: false,
    })
    expect(onChange).not.toHaveBeenCalled()

    edit.dispose()
  })

  it('reconciles option and mode changes into a bound form draft', () => {
    const onChange = vi.fn()
    const edit = new RenderTokenEdit({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      values: ['a', 'b'],
      onChange,
    })
    const form = new FormSession({ tags: ['a', 'b'] })
    const disposeBinding = bindFormField(form, 'tags', edit, {
      validateOn: [],
    })

    edit.options = [{ value: 'a', label: 'Alpha' }]

    expect(edit.values).toEqual(['a'])
    expect(form.getValue('tags')).toEqual(['a'])
    expect(form.isFieldTouched('tags')).toBe(false)

    edit.allowCustomTokens = true
    form.setValue('tags', ['a', 'custom'])
    expect(edit.values).toEqual(['a', 'custom'])

    edit.allowCustomTokens = false

    expect(edit.values).toEqual(['a'])
    expect(form.getValue('tags')).toEqual(['a'])
    expect(form.isFieldTouched('tags')).toBe(false)
    expect(onChange).not.toHaveBeenCalled()

    disposeBinding()
    edit.dispose()
    form.dispose()
  })

  it('creates custom tokens through Enter and configured separators without duplicates', () => {
    const onChange = vi.fn()
    const valueListener = vi.fn()
    const edit = new RenderTokenEdit({
      allowCustomTokens: true,
      onChange,
    })
    edit.subscribeValueChange(valueListener)
    edit.setValue(['controlled'])
    edit.setValue([])
    expect(valueListener).not.toHaveBeenCalled()

    edit.query = 'custom'
    edit.commitQuery(edit.query)
    edit.query = 'custom'
    edit.commitQuery(edit.query)
    edit.query = 'second'
    const separatorEvent = new KeyboardEvent('keydown', {
      key: ',',
      cancelable: true,
    })
    expect(edit.handleInputKeyDown(separatorEvent)).toBe(true)

    expect(edit.values).toEqual(['custom', 'second'])
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(valueListener).toHaveBeenCalledTimes(2)
    expect(valueListener).toHaveBeenLastCalledWith({
      value: ['custom', 'second'],
      previousValue: ['custom'],
      reason: 'add',
      detail: [
        { value: 'custom', label: 'custom' },
        { value: 'second', label: 'second' },
      ],
    })
    expect(separatorEvent.defaultPrevented).toBe(true)

    edit.dispose()
  })

  it('finishes token-add geometry when a value callback throws', () => {
    const failure = new Error('token add failed')
    const valueListener = vi.fn()
    const edit = new RenderTokenEdit({
      allowCustomTokens: true,
      placeholder: 'Add token',
      onChange: () => { throw failure },
    })
    edit.subscribeValueChange(valueListener)
    edit.layout(constraints, false, { theme: ImGuiDarkTheme })
    const input = (edit as any)._input

    edit.query = 'custom'
    expect(input.needsLayout).toBe(false)

    expect(() => edit.commitQuery(edit.query)).toThrow(failure)

    expect(edit.values).toEqual(['custom'])
    expect(edit.query).toBe('')
    expect(input.placeholder).toBe('')
    expect(input.needsLayout).toBe(true)
    expect(valueListener).toHaveBeenCalledWith({
      value: ['custom'],
      previousValue: [],
      reason: 'add',
      detail: [{ value: 'custom', label: 'custom' }],
    })

    edit.dispose()
  })

  it('flushes or cancels pending custom-token input explicitly', () => {
    const edit = new RenderTokenEdit({ allowCustomTokens: true })
    const valueListener = vi.fn()
    edit.subscribeValueChange(valueListener)

    edit.query = 'pending'
    expect(edit.commitEdit()).toBe(true)
    expect(edit.values).toEqual(['pending'])
    expect(edit.query).toBe('')
    expect(valueListener).toHaveBeenCalledTimes(1)

    edit.query = 'discarded'
    edit.cancelEdit()
    expect(edit.values).toEqual(['pending'])
    expect(edit.query).toBe('')

    edit.dispose()
  })

  it('reports an unrecognized pending token instead of silently dropping it', () => {
    const edit = new RenderTokenEdit({
      options: [{ value: 'known', label: 'Known' }],
      allowCustomTokens: false,
    })

    edit.query = 'missing'

    expect(edit.commitEdit()).toBe(false)
    expect(edit.query).toBe('missing')
    expect(edit.values).toEqual([])

    edit.cancelEdit()
    edit.dispose()
  })

  it('removes the last token with Backspace only when the query is empty', () => {
    const onChange = vi.fn()
    const edit = new RenderTokenEdit({
      allowCustomTokens: true,
      values: ['first', 'second'],
      onChange,
    })

    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      cancelable: true,
    })
    expect(edit.handleInputKeyDown(event)).toBe(true)
    expect(edit.values).toEqual(['first'])
    expect(event.defaultPrevented).toBe(true)
    expect(onChange).toHaveBeenLastCalledWith(
      ['first'],
      [{ value: 'first', label: 'first' }],
    )

    edit.query = 'x'
    expect(edit.handleInputKeyDown(new KeyboardEvent('keydown', { key: 'Backspace' }))).toBe(false)
    expect(edit.values).toEqual(['first'])

    edit.dispose()
  })

  it('finishes token-remove geometry and popup synchronization when a value callback throws', () => {
    setPopupTestContext()
    const failure = new Error('token remove failed')
    const valueListener = vi.fn()
    const edit = new RenderTokenEdit({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      values: ['a'],
      onChange: () => { throw failure },
    })
    edit.subscribeValueChange(valueListener)
    edit.layout(constraints, false, { theme: ImGuiDarkTheme })
    const input = (edit as any)._input
    const popup = (edit as any)._popup as DropdownPopup

    edit.requestFocus()
    expect(popup.debugState().filteredOptions.map(option => option.value)).toEqual(['b'])
    expect(input.needsLayout).toBe(false)

    expect(() => edit.removeToken('a')).toThrow(failure)

    expect(edit.values).toEqual([])
    expect(input.needsLayout).toBe(true)
    expect(popup.debugState().filteredOptions.map(option => option.value)).toEqual(['a', 'b'])
    expect(valueListener).toHaveBeenCalledWith({
      value: [],
      previousValue: ['a'],
      reason: 'remove',
      detail: [],
    })

    edit.dispose()
  })

  it('removes a chip only on release from the pointer that pressed it', () => {
    const onChange = vi.fn()
    const preventActivation = vi.fn()
    const edit = new RenderTokenEdit({
      allowCustomTokens: true,
      values: ['first', 'second'],
      onChange,
    })
    edit.layout(constraints, false, { theme: ImGuiDarkTheme })
    const { input, point } = firstRemoveTarget(edit)

    input.onPointerDown({ pointerId: 1, position: point, type: 'down' })
    input.onPointerDown({
      pointerId: 2,
      position: point,
      type: 'down',
      preventActivation,
    })
    input.onPointerUp({ pointerId: 2, position: point, type: 'up' })

    expect(edit.values).toEqual(['first', 'second'])

    input.onPointerUp({ pointerId: 1, position: point, type: 'up' })

    expect(preventActivation).toHaveBeenCalledOnce()
    expect(edit.values).toEqual(['second'])
    expect(onChange).toHaveBeenCalledOnce()

    edit.dispose()
  })

  it('does not remove a chip when a competing gesture wins', () => {
    const arena = new GestureArenaManager()
    const onChange = vi.fn()
    const competitor: GestureArenaMember = {
      acceptGesture: vi.fn(),
      rejectGesture: vi.fn(),
    }
    const edit = new RenderTokenEdit({
      allowCustomTokens: true,
      values: ['first'],
      onChange,
    })
    edit.layout(constraints, false, { theme: ImGuiDarkTheme })
    const { input, point } = firstRemoveTarget(edit)

    input.onPointerDown({
      pointerId: 1,
      position: point,
      type: 'down',
      joinGestureArena: (member: GestureArenaMember) => arena.add(1, member),
    })
    const competitorEntry = arena.add(1, competitor)
    arena.close(1)
    competitorEntry.resolve('accepted')
    input.onPointerUp({ pointerId: 1, position: point, type: 'up' })

    expect(edit.values).toEqual(['first'])
    expect(onChange).not.toHaveBeenCalled()
    expect(input._pressedRemoveValue).toBe(null)

    edit.dispose()
  })

  it('does not consume token shortcuts during IME composition', () => {
    const onChange = vi.fn()
    const edit = new RenderTokenEdit({
      allowCustomTokens: true,
      values: ['existing'],
      onChange,
    })
    const backspace = new KeyboardEvent('keydown', {
      key: 'Backspace',
      isComposing: true,
      cancelable: true,
    })
    const legacySeparator = new KeyboardEvent('keydown', {
      key: ',',
      cancelable: true,
    })
    Object.defineProperty(legacySeparator, 'keyCode', { value: 229 })

    expect(edit.handleInputKeyDown(backspace)).toBe(false)
    expect(edit.handleInputKeyDown(legacySeparator)).toBe(false)
    expect(edit.values).toEqual(['existing'])
    expect(backspace.defaultPrevented).toBe(false)
    expect(legacySeparator.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()

    edit.dispose()
  })

  it('filters predefined suggestions and reuses DropdownPopup for keyboard selection', () => {
    setPopupTestContext()
    const edit = new RenderTokenEdit({
      options: [
        { value: 'aspirin', label: 'Aspirin' },
        { value: 'amoxicillin', label: 'Amoxicillin' },
        { value: 'ibuprofen', label: 'Ibuprofen' },
      ],
    })
    edit.layout(constraints, false, { theme: ImGuiDarkTheme })
    edit.focus()
    const popup = (edit as any)._popup as DropdownPopup
    edit.query = 'amo'

    expect(edit.debugState().suggestions.map(option => option.value)).toEqual(['amoxicillin'])
    expect(edit.debugState().popupVisible).toBe(true)
    expect(popup).toBeInstanceOf(DropdownPopup)
    expect(edit.isFocused).toBe(true)

    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    popup.onKeyDown(enter)

    expect(edit.values).toEqual(['amoxicillin'])
    expect(edit.query).toBe('')
    expect(edit.debugState().popupVisible).toBe(false)

    edit.dispose()
  })

  it('keeps suggestion-popup interaction focused and cancels the query on explicit blur', () => {
    setPopupTestContext()
    const blurListener = vi.fn()
    const edit = new RenderTokenEdit({
      options: [
        { value: 'aspirin', label: 'Aspirin' },
        { value: 'amoxicillin', label: 'Amoxicillin' },
      ],
    })
    edit.subscribeBlur(blurListener)
    edit.layout(constraints, false, { theme: ImGuiDarkTheme })

    edit.requestFocus()
    edit.query = 'asp'

    expect(edit.debugState().popupVisible).toBe(true)
    expect(edit.isFocused).toBe(true)
    expect(blurListener).not.toHaveBeenCalled()

    edit.blur()
    edit.blur()

    expect(edit.query).toBe('')
    expect(edit.debugState().popupVisible).toBe(false)
    expect(edit.isFocused).toBe(false)
    expect(blurListener).toHaveBeenCalledOnce()

    edit.dispose()
  })

  it.each(['disabled', 'readonly'] as const)(
    'fully ends an open suggestion session when becoming %s',
    state => {
      setPopupTestContext()
      const error = new Error(`token ${state} blur failed`)
      const firstBlur = vi.fn(() => { throw error })
      const secondBlur = vi.fn()
      const edit = new RenderTokenEdit({
        options: [
          { value: 'aspirin', label: 'Aspirin' },
          { value: 'amoxicillin', label: 'Amoxicillin' },
        ],
      })
      edit.subscribeBlur(firstBlur)
      edit.subscribeBlur(secondBlur)
      edit.layout(constraints, false, { theme: ImGuiDarkTheme })

      edit.requestFocus()
      edit.query = 'asp'

      expect(edit.debugState().popupVisible).toBe(true)
      expect(edit.isFocused).toBe(true)
      expect(() => { edit[state] = true }).toThrow(error)
      expect(edit[state]).toBe(true)
      expect(edit.query).toBe('')
      expect(edit.debugState().popupVisible).toBe(false)
      expect(edit.isFocused).toBe(false)
      expect(firstBlur).toHaveBeenCalledOnce()
      expect(secondBlur).toHaveBeenCalledOnce()

      expect(() => { edit[state] = true }).not.toThrow()
      expect(firstBlur).toHaveBeenCalledOnce()
      expect(secondBlur).toHaveBeenCalledOnce()

      edit.dispose()
    },
  )

  it('keeps anchor pointer events available to the input while suggestions are open', () => {
    setPopupTestContext()
    const edit = new RenderTokenEdit({
      options: [{ value: 'a', label: 'Alpha' }],
    })
    edit.layout(constraints, false, { theme: ImGuiDarkTheme })
    edit.focus()

    const popup = (edit as any)._popup as DropdownPopup
    expect(popup.visible).toBe(true)
    expect(popup.onOutsidePointerDown({
      pointerId: 1,
      position: { x: 10, y: 10 },
      type: 'down',
    })).toBe(false)
    expect(popup.visible).toBe(true)

    edit.dispose()
  })

  it('preserves IME control keys through the focused TextBox and suggestion popup', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const edit = new RenderTokenEdit({
      options: [{ value: 'a', label: 'Alpha' }],
      allowCustomTokens: true,
      values: ['existing'],
      onChange,
    })
    edit.layout(constraints, false, { theme: ImGuiDarkTheme })
    edit.focus()
    const input = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
    const backspace = new KeyboardEvent('keydown', {
      key: 'Backspace',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })

    input.dispatchEvent(enter)
    input.dispatchEvent(backspace)

    expect(edit.values).toEqual(['existing'])
    expect(enter.defaultPrevented).toBe(false)
    expect(backspace.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()

    input.dispatchEvent(new CompositionEvent('compositionend', {
      data: '',
      bubbles: true,
    }))
    edit.dispose()
  })

  it('collapses overflowing tokens into a single +N chip', () => {
    const edit = new RenderTokenEdit({
      allowCustomTokens: true,
      values: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    })
    edit.layout({
      ...constraints,
      maxWidth: 150,
    }, false, { theme: ImGuiDarkTheme })

    const visible = edit.debugState().visibleTokenValues
    expect(visible.at(-1)).toBe(null)
    expect(visible.filter(value => value !== null).length).toBeLessThan(4)

    edit.dispose()
  })
})
