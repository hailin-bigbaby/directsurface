import { afterEach, describe, expect, it, vi } from 'vitest'
import { InputComposer } from './input_composer'

function inputElement(): HTMLTextAreaElement {
  const ta = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement | null
  if (!ta) throw new Error('InputComposer textarea was not created')
  return ta
}

afterEach(() => {
  InputComposer.instance.dispose()
  vi.restoreAllMocks()
})

describe('InputComposer', () => {
  it('does not let an old session token end a newer session', () => {
    const firstInput = vi.fn()
    const secondInput = vi.fn()
    const composer = InputComposer.instance

    const first = composer.begin({ onInput: firstInput }, 'first')
    composer.begin({ onInput: secondInput }, 'second')
    composer.end(first)

    const ta = inputElement()
    ta.value = 'next'
    ta.dispatchEvent(new Event('input'))

    expect(firstInput).not.toHaveBeenCalled()
    expect(secondInput).toHaveBeenCalledWith('next')
    expect(composer.hasSession).toBe(true)
  })

  it('ends the current session when no token is provided', () => {
    const onInput = vi.fn()
    const composer = InputComposer.instance

    composer.begin({ onInput }, 'value')
    composer.end()

    const ta = inputElement()
    ta.value = 'ignored'
    ta.dispatchEvent(new Event('input'))

    expect(onInput).not.toHaveBeenCalled()
    expect(composer.hasSession).toBe(false)
  })

  it('forwards clipboard events to the active session', () => {
    const onCopy = vi.fn()
    const onCut = vi.fn()
    const onPaste = vi.fn()
    const composer = InputComposer.instance

    composer.begin({ onCopy, onCut, onPaste })
    const ta = inputElement()
    const copy = new Event('copy') as ClipboardEvent
    const cut = new Event('cut') as ClipboardEvent
    const paste = new Event('paste') as ClipboardEvent

    ta.dispatchEvent(copy)
    ta.dispatchEvent(cut)
    ta.dispatchEvent(paste)

    expect(onCopy).toHaveBeenCalledWith(copy)
    expect(onCut).toHaveBeenCalledWith(cut)
    expect(onPaste).toHaveBeenCalledWith(paste)
  })

  it('replaces a previously huge native textarea before starting a small session', () => {
    const composer = InputComposer.instance

    composer.setValue('x'.repeat(1_000_001))
    const old = inputElement()
    old.style.left = '120px'
    old.style.top = '80px'
    composer.begin({ onInput: vi.fn() }, 'small')
    const next = inputElement()

    expect(next).not.toBe(old)
    expect(next.value).toBe('small')
    expect(next.style.left).toBe('120px')
    expect(next.style.top).toBe('80px')
  })

  it('does not preserve textarea focus when starting a small session with focus disabled', () => {
    const composer = InputComposer.instance

    composer.setValue('x'.repeat(1_000_001))
    const old = inputElement()
    old.focus()
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus')

    composer.begin({ onInput: vi.fn() }, 'small', { focus: false })
    const next = inputElement()

    expect(next).not.toBe(old)
    expect(next.value).toBe('small')
    expect(focus).not.toHaveBeenCalled()
  })

  it('suppresses the browser context menu and forwards it to the active session', () => {
    const onContextMenu = vi.fn()
    const composer = InputComposer.instance

    composer.begin({ onContextMenu })
    const ta = inputElement()
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 60,
    })

    ta.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(onContextMenu).toHaveBeenCalledWith(event)
  })

  it('keeps composition lifecycle idempotent for repeated browser events', () => {
    const onCompositionStart = vi.fn()
    const onCompositionUpdate = vi.fn()
    const onCompositionEnd = vi.fn()
    const composer = InputComposer.instance

    composer.begin({ onCompositionStart, onCompositionUpdate, onCompositionEnd })
    const ta = inputElement()

    ta.dispatchEvent(new CompositionEvent('compositionstart'))
    ta.dispatchEvent(new CompositionEvent('compositionstart'))
    ta.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'zhong' }))
    ta.value = '中'
    ta.dispatchEvent(new CompositionEvent('compositionend', { data: '中' }))
    ta.dispatchEvent(new CompositionEvent('compositionend', { data: '中' }))

    expect(onCompositionStart).toHaveBeenCalledTimes(1)
    expect(onCompositionUpdate).toHaveBeenCalledWith('zhong')
    expect(onCompositionEnd).toHaveBeenCalledTimes(1)
    expect(onCompositionEnd).toHaveBeenCalledWith('中', '中')
    expect(composer.composing).toBe(false)
  })
})

it('forwards native beforeinput and noncancelable input metadata without applying editor policy', () => {
  const composer = InputComposer.instance, before = vi.fn((e: InputEvent) => e.preventDefault()), input = vi.fn()
  const legacy = vi.fn()
  const token = composer.begin({ onBeforeInput: before, onNativeInput: input, onInput: legacy })
  const ta = inputElement(), intent = new InputEvent('beforeinput', { inputType: 'deleteContentBackward', cancelable: true })
  expect(ta.dispatchEvent(intent)).toBe(false)
  expect(before).toHaveBeenCalledWith(intent)
  const event = new InputEvent('input', { inputType: 'insertReplacementText', data: '甲', cancelable: false })
  ta.value = '甲'; ta.dispatchEvent(event)
  expect(input).toHaveBeenCalledWith('甲', event)
  expect(legacy).not.toHaveBeenCalled()
  composer.end(token)
  ta.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: '乙' }))
  expect(before).toHaveBeenCalledOnce()
})

it('retires an isolated session carrier so late native events cannot reach its successor', () => {
  const composer = InputComposer.instance, ended = vi.fn(), second = vi.fn(), composition = vi.fn()
  const token = composer.begin({ onSessionEnd: ended }, '', { isolateNativeEvents: true })
  const old = inputElement()
  old.dispatchEvent(new CompositionEvent('compositionstart'))
  composer.begin({ onInput: second, onCompositionEnd: composition })
  const current = inputElement()
  expect(current).not.toBe(old); expect(old.isConnected).toBe(false); expect(ended).toHaveBeenCalledOnce()
  old.value = '旧'; old.dispatchEvent(new CompositionEvent('compositionupdate', { data: '旧' }))
  old.dispatchEvent(new CompositionEvent('compositionend', { data: '旧' })); old.dispatchEvent(new Event('input'))
  expect(second).not.toHaveBeenCalled(); expect(composition).not.toHaveBeenCalled()
  composer.end(token)
  current.value = '新'; current.dispatchEvent(new Event('input'))
  expect(second).toHaveBeenCalledWith('新')
})

// Preserve the public input bridge guarantee while enabling isolated native sessions.
it.each([false, true])('sets readonly before focus when replacing an input carrier (isolated=%s)', isolated => {
  const composer = InputComposer.instance
  const first = composer.begin({}, 'x'.repeat(1_000_001), { isolateNativeEvents: isolated })
  const previous = inputElement()
  composer.end(first)
  const focusStates: boolean[] = []
  vi.spyOn(HTMLTextAreaElement.prototype, 'focus').mockImplementation(function (this: HTMLTextAreaElement) {
    focusStates.push(this.readOnly)
  })
  composer.begin({}, 'readonly value', { readOnly: true })
  expect(inputElement()).not.toBe(previous)
  expect(inputElement().readOnly).toBe(true)
  expect(focusStates.length).toBeGreaterThan(0)
  expect(focusStates.every(Boolean)).toBe(true)
})
