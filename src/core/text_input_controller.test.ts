import { afterEach, describe, expect, it, vi } from 'vitest'
import { InputComposer } from './input_composer'
import { TextInputController } from './text_input_controller'
import { FakeTextInputPort } from './testing/fake_text_input_port'

function inputElement(): HTMLTextAreaElement {
  const ta = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement | null
  if (!ta) throw new Error('InputComposer textarea was not created')
  return ta
}

afterEach(() => {
  InputComposer.instance.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TextInputController', () => {

  for (const cancelable of [true, false]) {
    it(`preserves the Web paste event, DataTransfer and cancellation, cancelable=${cancelable}`, () => {
      const controller = new TextInputController()
      const file = new File(['image'], 'image.png', { type: 'image/png' })
      const clipboardData = {
        types: ['text/plain', 'text/html', 'Files'],
        items: [{ kind: 'file', getAsFile: () => file }],
        files: [file],
        getData: (format: string) => format === 'text/html' ? '<b>hello</b>' : 'hello',
      }
      let delivered: ClipboardEvent | undefined
      let currentTarget: EventTarget | null = null
      const states: boolean[] = []
      controller.beginSession({ onPaste: event => {
        delivered = event
        currentTarget = event.currentTarget
        states.push(event.defaultPrevented)
        event.preventDefault()
        states.push(event.defaultPrevented)
      } }, '')
      try {
        const input = inputElement()
        // jsdom has no ClipboardEvent constructor; dispatch a real DOM Event with clipboard data.
        const event = new Event('paste', { bubbles: true, cancelable })
        Object.defineProperty(event, 'clipboardData', { value: clipboardData })
        input.dispatchEvent(event)
        expect(delivered).toBe(event)
        expect(delivered?.target).toBe(input)
        expect(currentTarget).toBe(input)
        expect(delivered?.clipboardData).toBe(clipboardData)
        expect(delivered?.clipboardData?.getData('text/html')).toBe('<b>hello</b>')
        expect(delivered?.clipboardData?.types).toEqual(clipboardData.types)
        expect(delivered?.clipboardData?.files[0]).toBe(file)
        expect(delivered?.clipboardData?.items[0]?.getAsFile()).toBe(file)
        expect(states).toEqual([false, cancelable])
        expect(event.defaultPrevented).toBe(cancelable)
      } finally { controller.dispose() }
    })
  }

  for (const immediate of [false, true]) {
    it(`preserves prior paste cancellation and propagation, immediate=${immediate}`, () => {
      const controller = new TextInputController()
      const laterListener = vi.fn()
      const parentListener = vi.fn()
      let observedCancellation: boolean | undefined
      controller.beginSession({ onPaste: event => {
        observedCancellation = event.defaultPrevented
        if (immediate) event.stopImmediatePropagation()
        else event.stopPropagation()
      } }, '')
      const input = inputElement()
      input.addEventListener('paste', laterListener)
      document.addEventListener('paste', parentListener)
      try {
        const event = new Event('paste', { bubbles: true, cancelable: true })
        event.preventDefault()
        input.dispatchEvent(event)
        expect(observedCancellation).toBe(true)
        expect(laterListener).toHaveBeenCalledTimes(immediate ? 0 : 1)
        expect(parentListener).not.toHaveBeenCalled()
      } finally {
        input.removeEventListener('paste', laterListener)
        document.removeEventListener('paste', parentListener)
        controller.dispose()
      }
    })
  }

  it('retains portable paste text and cancellation when no DOM event is supplied', () => {
    const port = new FakeTextInputPort()
    const controller = new TextInputController({ port })
    const preventDefault = vi.fn()
    let plain: string | undefined
    let html: string | undefined
    controller.beginSession({ onPaste: event => {
      plain = event.clipboardData?.getData('text/plain')
      html = event.clipboardData?.getData('text/html')
      event.preventDefault()
    } }, '')
    try {
      const handle = port.activeSessionHandles[0]!
      expect(port.dispatch({
        type: 'paste', sessionId: handle.sessionId, revision: controller.sessionRevision,
        text: 'portable', selection: { start: 0, end: 0 }, preventDefault,
      })).toBe(true)
      expect(plain).toBe('portable')
      expect(html).toBe('')
      expect(preventDefault).toHaveBeenCalledTimes(1)
    } finally { controller.dispose() }
  })

  for (const cancelable of [true, false]) {
    it(`preserves the Web keyboard event and cancellation state, cancelable=${cancelable}`, () => {
      const controller = new TextInputController()
      const states: boolean[] = []
      let delivered: KeyboardEvent | undefined
      controller.beginSession({ onKeyDown: event => {
        delivered = event
        states.push(event.defaultPrevented)
        event.preventDefault()
        states.push(event.defaultPrevented)
      } }, '')
      try {
        const input = inputElement()
        const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable, bubbles: true })
        input.dispatchEvent(event)
        expect(delivered).toBe(event)
        expect(delivered?.target).toBe(input)
        expect(states).toEqual([false, cancelable])
        expect(event.defaultPrevented).toBe(cancelable)
      } finally { controller.dispose() }
    })
  }

  it('preserves a Web cancellation made before dispatch and ordinary stopPropagation', () => {
    const controller = new TextInputController()
    const laterListener = vi.fn()
    let observedCancellation: boolean | undefined
    controller.beginSession({ onKeyDown: event => {
      observedCancellation = event.defaultPrevented
      event.stopPropagation()
    } }, '')
    const input = inputElement()
    input.addEventListener('keydown', laterListener)
    try {
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true, bubbles: true })
      event.preventDefault()
      input.dispatchEvent(event)
      expect(observedCancellation).toBe(true)
      expect(laterListener).toHaveBeenCalledTimes(1)
    } finally {
      input.removeEventListener('keydown', laterListener)
      controller.dispose()
    }
  })

  it('exposes Native cancellation state while forwarding the existing port callback', () => {
    const port = new FakeTextInputPort()
    const controller = new TextInputController({ port })
    const preventDefault = vi.fn()
    const states: boolean[] = []
    controller.beginSession({ onKeyDown: event => {
      states.push(event.defaultPrevented)
      event.preventDefault()
      states.push(event.defaultPrevented)
    } }, '')
    try {
      const handle = port.activeSessionHandles[0]!
      expect(port.dispatch({
        type: 'key-down', sessionId: handle.sessionId, revision: controller.sessionRevision,
        key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, location: 0,
        repeat: false, composing: false, selection: { start: 0, end: 0 },
        modifiers: { alt: false, control: false, meta: false, shift: false },
        preventDefault, stopImmediatePropagation: vi.fn(),
      })).toBe(true)
      expect(states).toEqual([false, true])
      expect(preventDefault).toHaveBeenCalledTimes(1)
    } finally { controller.dispose() }
  })

  it('tracks selection and composer session lifecycle', () => {
    const controller = new TextInputController()
    const onInput = vi.fn()

    controller.beginSession({
      onInput: value => onInput(value),
    }, 'hello')

    controller.setSelection(1, 4, { cursorPos: 4, syncComposer: true })
    expect(controller.cursorPos).toBe(4)
    expect(controller.selStart).toBe(1)
    expect(controller.selEnd).toBe(4)

    const ta = inputElement()
    ta.value = 'world'
    ta.setSelectionRange(2, 5)
    ta.dispatchEvent(new Event('input'))
    controller.syncSelectionFromComposer()

    expect(onInput).toHaveBeenCalledWith('world')
    expect(controller.cursorPos).toBe(2)
    expect(controller.selStart).toBe(2)
    expect(controller.selEnd).toBe(5)

    controller.endSession()
    expect(controller.hasSession).toBe(false)
  })

  it('tracks composition state and cursor blinking', () => {
    vi.useFakeTimers()
    const onInvalidate = vi.fn()
    const controller = new TextInputController({ onInvalidate })

    controller.beginSession({}, 'a')
    const ta = inputElement()
    ta.dispatchEvent(new CompositionEvent('compositionstart'))
    ta.dispatchEvent(new CompositionEvent('compositionupdate', { data: '中' }))

    expect(controller.composing).toBe(true)
    expect(controller.compositionText).toBe('中')
    expect(controller.cursorVisible).toBe(true)

    vi.advanceTimersByTime(530)

    expect(controller.cursorVisible).toBe(false)
    expect(onInvalidate).toHaveBeenCalledTimes(1)

    ta.value = '中文'
    ta.dispatchEvent(new CompositionEvent('compositionend', { data: '中文' }))

    expect(controller.composing).toBe(false)
    expect(controller.compositionText).toBe('')

    controller.dispose()
  })

  it('does not let an ended older session close a newer composer session', () => {
    const controller = new TextInputController()
    controller.beginSession({}, 'first')
    InputComposer.instance.begin({ onInput: vi.fn() }, 'second')

    controller.endSession()

    expect(InputComposer.instance.hasSession).toBe(true)
    expect(InputComposer.instance.value).toBe('second')
  })

  it('does not let disposing an already-ended controller close a newer composer session', () => {
    const controller = new TextInputController()
    controller.beginSession({}, 'first')
    controller.endSession()
    InputComposer.instance.begin({ onInput: vi.fn() }, 'second')

    controller.dispose()

    expect(InputComposer.instance.hasSession).toBe(true)
    expect(InputComposer.instance.value).toBe('second')
  })
})
