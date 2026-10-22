import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeyboardBindingController } from './keyboard_binding_controller'
import { FocusManager, FocusScope, FocusScopeType } from './focus_manager'

describe('KeyboardBindingController', () => {
  afterEach(() => {
    KeyboardBindingController.disposeInstance()
    FocusManager.disposeInstance()
    vi.restoreAllMocks()
  })

  it('routes key events by priority and stops after a consumed binding', () => {
    const calls: string[] = []

    KeyboardBindingController.instance.addBinding(() => {
      calls.push('low')
    }, 0)
    KeyboardBindingController.instance.addBinding(() => {
      calls.push('high')
      return true
    }, 10)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(calls).toEqual(['high'])
  })

  it('uses newest binding first for equal priorities and supports removal', () => {
    const calls: string[] = []
    const first = vi.fn(() => { calls.push('first') })
    const second = vi.fn(() => { calls.push('second') })

    KeyboardBindingController.instance.addBinding(first, 1)
    const removeSecond = KeyboardBindingController.instance.addBinding(second, 1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect(calls).toEqual(['second', 'first'])

    calls.length = 0
    removeSecond()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect(calls).toEqual(['first'])
  })

  it('removes the global listener on dispose', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    KeyboardBindingController.instance.dispose()

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true })
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true })
  })

  it('consumes registered shortcuts before a focused input mutates its value', () => {
    const input = document.createElement('textarea')
    document.body.appendChild(input)
    const inputKeyDown = vi.fn()
    input.addEventListener('keydown', inputKeyDown)
    KeyboardBindingController.instance.addBinding(event => {
      if (!event.metaKey || event.key !== 'Enter') return false
      event.preventDefault()
      return true
    })
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })

    input.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(inputKeyDown).not.toHaveBeenCalled()
    input.remove()
  })

  it('skips source-less global bindings while a modal focus scope is active', () => {
    const handler = vi.fn()
    KeyboardBindingController.instance.addBinding(handler)
    FocusManager.instance.pushScope(new FocusScope(FocusScopeType.Modal))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))

    expect(handler).not.toHaveBeenCalled()
  })
})


it('does not deliver a consumed shortcut to a later window capture listener', () => {
  const later = vi.fn()
  KeyboardBindingController.instance.addBinding(event => {
    event.preventDefault()
    return true
  })
  window.addEventListener('keydown', later, { capture: true })
  try {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, cancelable: true }))
    expect(later).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('keydown', later, { capture: true })
    KeyboardBindingController.disposeInstance()
  }
})
