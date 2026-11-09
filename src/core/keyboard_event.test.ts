// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager, FocusScope, FocusScopeType } from './focus_manager'
import { RenderWindow } from '../widgets/window'
import { RenderTextBox } from '../widgets/text_field'
import { RenderStackPanel } from '../layout/render_flex'
import { DispatchPhase } from '../gestures/hit_test'
import { dispatchKeyboardEvent } from './keyboard_event'

const windows: RenderWindow[] = []
function setup() {
  const win = new RenderWindow({ title: 'keyboard', width: 400, height: 200 })
  windows.push(win)
  const panel = new RenderStackPanel()
  const text = new RenderTextBox({ value: '' })
  panel.addChild(text)
  win.addChild(panel)
  const manager = FocusManager.instance
  manager.register(text)
  manager.setFocus(text)
  return { win, panel, text, manager }
}
function key(type = 'keydown', value = 'F2', options: KeyboardEventInit = {}) {
  return new KeyboardEvent(type, { key: value, bubbles: true, cancelable: true, ...options })
}
afterEach(() => {
  for (const win of windows.splice(0)) win.dispose()
  FocusManager.disposeInstance()
})

describe('component keyboard routing', () => {
  it('captures, targets and bubbles before existing default handlers', () => {
    const { win, panel, text, manager } = setup()
    const order: string[] = []
    for (const [label, node] of [['window', win], ['panel', panel], ['text', text]] as const) {
      for (const capture of [true, false]) {
        node.addKeyboardEventListener('keydown', event => {
          expect(event.target).toBe(text)
          expect(event.currentTarget).toBe(node)
          expect(event.phase).toBe(node === text ? DispatchPhase.Target : capture ? DispatchPhase.Capture : DispatchPhase.Bubble)
          order.push(label + (capture ? ':capture' : ':bubble'))
        }, { capture })
      }
    }
    text.onKeyDown = () => { order.push('default'); return true }
    expect(manager.handleKeyDownEvent(key())).toBe(true)
    expect(order).toEqual(['window:capture', 'panel:capture', 'text:capture', 'text:bubble', 'panel:bubble', 'window:bubble', 'default'])
  })

  it('supports separate capture/bubble registrations, removal and idempotent disposers', () => {
    const { win, text } = setup()
    const listener = vi.fn()
    const off = win.addKeyboardEventListener('keydown', listener, { capture: true })
    win.addKeyboardEventListener('keydown', listener, { capture: true })
    win.addKeyboardEventListener('keydown', listener)
    dispatchKeyboardEvent(text, key())
    expect(listener).toHaveBeenCalledTimes(2)
    off(); off()
    dispatchKeyboardEvent(text, key())
    expect(listener).toHaveBeenCalledTimes(3)
    win.removeKeyboardEventListener('keydown', listener)
    dispatchKeyboardEvent(text, key())
    expect(listener).toHaveBeenCalledTimes(3)
    win.addKeyboardEventListener('keydown', listener, { capture: true })
    off()
    dispatchKeyboardEvent(text, key())
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('snapshots listeners, skips removed callbacks and removes once before reentrant dispatch', () => {
    const { win, text } = setup()
    const later = vi.fn()
    const removed = vi.fn()
    win.addKeyboardEventListener('keydown', () => {
      win.addKeyboardEventListener('keydown', later)
      text.removeKeyboardEventListener('keydown', removed)
    }, { capture: true })
    text.addKeyboardEventListener('keydown', removed)
    const once = vi.fn(() => dispatchKeyboardEvent(text, key('keyup')))
    text.addKeyboardEventListener('keyup', once, { once: true })
    dispatchKeyboardEvent(text, key())
    expect(later).not.toHaveBeenCalled()
    expect(removed).not.toHaveBeenCalled()
    dispatchKeyboardEvent(text, key())
    expect(later).toHaveBeenCalledTimes(1)
    dispatchKeyboardEvent(text, key('keyup'))
    expect(once).toHaveBeenCalledTimes(1)
  })

  it('stops propagation without suppressing same-node listeners or default editing', () => {
    const { win, panel, text, manager } = setup()
    const order: string[] = []
    win.addKeyboardEventListener('keydown', event => { order.push('stop'); event.stopPropagation() }, { capture: true })
    win.addKeyboardEventListener('keydown', () => order.push('same-node'), { capture: true })
    panel.addKeyboardEventListener('keydown', () => order.push('panel'))
    text.onKeyDown = () => { order.push('default'); return false }
    manager.handleKeyDownEvent(key())
    expect(order).toEqual(['stop', 'same-node', 'default'])
  })

  it('supports stopImmediatePropagation and preventDefault', () => {
    const { win, text, manager } = setup()
    const skipped = vi.fn()
    win.addKeyboardEventListener('keydown', event => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }, { capture: true })
    win.addKeyboardEventListener('keydown', skipped, { capture: true })
    text.onKeyDown = skipped
    const event = key()
    expect(manager.handleKeyDownEvent(event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(skipped).not.toHaveBeenCalled()
  })

  it('isolates nested windows, including legacy fallback', () => {
    const outer = setup()
    const inner = setup()
    outer.win.addChild(inner.win)
    const leaked = vi.fn(() => false)
    outer.win.addKeyboardEventListener('keydown', leaked, { capture: true })
    outer.win.setUnhandledKeyDownHandler(leaked)
    const own = vi.fn()
    inner.win.addKeyboardEventListener('keydown', own)
    inner.manager.handleKeyDownEvent(key())
    expect(own).toHaveBeenCalledTimes(1)
    expect(leaked).not.toHaveBeenCalled()
  })

  it('respects a modal scope root inside a window', () => {
    const { win, panel, text, manager } = setup()
    const outer = vi.fn()
    win.addKeyboardEventListener('keydown', outer, { capture: true })
    const scope = new FocusScope(FocusScopeType.Modal)
    scope.setFocusRoots([panel])
    scope.add(text)
    manager.pushScope(scope)
    manager.setFocus(text)
    const inner = vi.fn()
    panel.addKeyboardEventListener('keydown', inner)
    manager.handleKeyDownEvent(key())
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
    manager.popScope()
  })

  it('routes native keyup once and does not invoke keydown defaults', () => {
    const { win, text, manager } = setup()
    const up = vi.fn()
    const down = vi.fn()
    text.onKeyDown = down
    win.addKeyboardEventListener('keyup', up)
    const event = key('keyup')
    window.dispatchEvent(event)
    manager.handleKeyUpEvent(event)
    expect(up).toHaveBeenCalledTimes(1)
    expect(down).not.toHaveBeenCalled()
  })

  it('does not route twice when the text input bridge forwards the same event', () => {
    const { text, manager } = setup()
    const listener = vi.fn()
    text.addKeyboardEventListener('keydown', listener)
    const event = key()
    manager.handleKeyDownEvent(event)
    manager.handleKeyDownEvent(event)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('cleans up on dispose and aborts defaults when capture closes a window', () => {
    const { win, text, manager } = setup()
    const skipped = vi.fn()
    const legacy = vi.fn(() => true)
    text.onKeyDown = legacy
    win.addKeyboardEventListener('keydown', () => win.dispose(), { capture: true })
    text.addKeyboardEventListener('keydown', skipped)
    expect(manager.handleKeyDownEvent(key())).toBe(true)
    expect(skipped).not.toHaveBeenCalled()
    expect(legacy).not.toHaveBeenCalled()
    text.addKeyboardEventListener('keydown', skipped)
    dispatchKeyboardEvent(text, key())
    expect(skipped).not.toHaveBeenCalled()
  })

  it('does not redirect the current key to a newly focused window', () => {
    const first = setup()
    const second = setup()
    first.manager.setFocus(first.text)
    const nextDefault = vi.fn(() => true)
    second.text.onKeyDown = nextDefault
    first.win.addKeyboardEventListener('keydown', () => first.manager.setFocus(second.text), { capture: true })
    first.manager.handleKeyDownEvent(key())
    expect(nextDefault).not.toHaveBeenCalled()
    expect(first.manager.current).toBe(second.text)
  })

  it('exposes IME metadata without running legacy key handling during composition', () => {
    const { text, manager } = setup()
    const legacy = vi.fn()
    const listener = vi.fn(event => expect(event.isComposing).toBe(true))
    text.onKeyDown = legacy
    text.addKeyboardEventListener('keydown', listener)
    manager.handleKeyDownEvent(key('keydown', 'Process', { isComposing: true }))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(legacy).not.toHaveBeenCalled()
  })
  it.each(['keydown', 'keyup'])('blocks native continuation and caches cancellation when a %s observer throws', type => {
    const { win, text, manager } = setup()
    const error = new Error('keyboard observer failed')
    const legacy = vi.fn()
    text.onKeyDown = legacy
    win.addKeyboardEventListener(type as 'keydown' | 'keyup', event => {
      event.preventDefault()
      throw error
    }, { capture: true, once: true })
    const event = key(type, 'Enter')
    const stop = vi.spyOn(event, 'stopImmediatePropagation')
    const dispatch = () => type === 'keydown' ? manager.handleKeyDownEvent(event) : manager.handleKeyUpEvent(event)
    expect(dispatch).toThrow(error)
    expect(event.defaultPrevented).toBe(true)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(legacy).not.toHaveBeenCalled()
    // InputComposer may forward the exact same event; it must see consumed=true.
    expect(dispatch()).toBe(true)
    expect(legacy).not.toHaveBeenCalled()
  })

})
