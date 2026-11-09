// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RenderBox } from '../layout/render_box'
import { RenderWindow } from '../widgets/window'
import { FocusManager } from '../core/focus_manager'
import { PopupManager } from '../core/popup_manager'
import { PopupRenderHost } from '../core/popup_render_host'
import type { RenderObject } from '../core/render_object'
import { HitTestResult, DispatchPhase, type HitTestTarget, type PointerEvent } from './hit_test'
import { PointerPathDispatcher } from './pointer_path_dispatcher'
import { PointerDispatchSessions } from './pointer_dispatch_session'
import { EventDispatcher } from './recognizers'
import { dispatchPointerListeners, pointerTargetPath } from './pointer_event_listeners'

class Node extends RenderBox {
  children: Node[] = []
  onPointerDown?: HitTestTarget['onPointerDown']
  onPointerMove?: HitTestTarget['onPointerMove']
  onPointerUp?: HitTestTarget['onPointerUp']
  onPointerCancel?: HitTestTarget['onPointerCancel']
  onPointerEnter?: HitTestTarget['onPointerEnter']
  onPointerLeave?: HitTestTarget['onPointerLeave']
  onWheel?: HitTestTarget['onWheel']
  onContextMenu?: HitTestTarget['onContextMenu']
  onDoubleClick?: HitTestTarget['onDoubleClick']
  onPointerActivate?: HitTestTarget['onPointerActivate']
  add(child: Node) { child.parent = this; this.children.push(child) }
  visitChildren(visitor: (child: RenderObject) => void): void { this.children.forEach(visitor) }
  performLayout(): void {}
  performPaint(): void {}
}
const cleanup: (() => void)[] = []
function setup() {
  const win = new RenderWindow({ title: 'test', x: 0, y: 0, width: 400, height: 300 })
  win.size = { width: 400, height: 300 }
  const parent = new Node()
  parent.size = { width: 200, height: 150 }
  parent.offset = { x: 20, y: 50 }
  const child = new Node()
  child.size = { width: 100, height: 40 }
  child.offset = { x: 10, y: 10 }
  parent.add(child)
  win.addChild(parent)
  const path = pointerTargetPath(child)
  const sessions = new PointerDispatchSessions()
  const dispatcher = new PointerPathDispatcher(sessions)
  cleanup.push(() => { win.dispose(); sessions.clear() })
  return { win, parent, child, path, sessions, dispatcher }
}
function event(type: PointerEvent['type'] = 'down'): PointerEvent {
  return { type, pointerId: 0, pointerType: 'mouse', button: 0, buttons: type === 'up' ? 0 : 1, position: { x: 35, y: 65 } }
}
function nativeSetup() {
  const state = setup()
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const native = new EventDispatcher(canvas)
  native.addRoot(state.win)
  cleanup.push(() => { native.dispose(); canvas.remove() })
  const mouse = (type: string, options: MouseEventInit = {}) => canvas.dispatchEvent(new MouseEvent(type, {
    clientX: 35, clientY: 65, button: 0, bubbles: true, cancelable: true, ...options,
  }))
  return { ...state, canvas, native, mouse }
}
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
  FocusManager.disposeInstance()
  PopupManager.disposeInstance()
})

describe('pointer listener registration and routing', () => {
  it('routes capture, target and bubble before legacy handlers with local coordinates', () => {
    const { win, parent, child, dispatcher, path } = setup()
    const order: string[] = []
    for (const [name, node] of [['window', win], ['parent', parent], ['child', child]] as const) {
      for (const capture of [true, false]) node.addPointerEventListener('pointerdown', e => {
        expect(e.target).toBe(child)
        expect(e.currentTarget).toBe(node)
        expect(e.phase).toBe(node === child ? DispatchPhase.Target : capture ? DispatchPhase.Capture : DispatchPhase.Bubble)
        if (node === child) expect(e.localPosition).toEqual({ x: 5, y: 5 })
        order.push(name + ':' + capture)
      }, { capture })
    }
    child.onPointerDown = () => order.push('default')
    dispatcher.dispatchToPath(path, event())
    expect(order).toEqual(['window:true', 'parent:true', 'child:true', 'child:false', 'parent:false', 'window:false', 'default'])
  })

  it('deduplicates listeners and supports removal by callback or an idempotent disposer', () => {
    const { child, path } = setup()
    const fn = vi.fn()
    const off = child.addPointerEventListener('pointerdown', fn, { capture: true })
    child.addPointerEventListener('pointerdown', fn, { capture: true })
    child.addPointerEventListener('pointerdown', fn)
    dispatchPointerListeners(path, 'pointerdown', event())
    expect(fn).toHaveBeenCalledTimes(2)
    off(); off()
    dispatchPointerListeners(path, 'pointerdown', event())
    expect(fn).toHaveBeenCalledTimes(3)
    child.removePointerEventListener('pointerdown', fn)
    child.addPointerEventListener('pointerdown', fn, { capture: true })
    off()
    dispatchPointerListeners(path, 'pointerdown', event())
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('snapshots registrations and removes once before reentrant callbacks', () => {
    const { win, child, path } = setup()
    const late = vi.fn()
    const removed = vi.fn()
    win.addPointerEventListener('pointerdown', () => {
      win.addPointerEventListener('pointerdown', late)
      child.removePointerEventListener('pointerdown', removed)
    }, { capture: true })
    child.addPointerEventListener('pointerdown', removed)
    dispatchPointerListeners(path, 'pointerdown', event())
    expect(late).not.toHaveBeenCalled()
    expect(removed).not.toHaveBeenCalled()
    dispatchPointerListeners(path, 'pointerdown', event())
    expect(late).toHaveBeenCalledTimes(1)
    const once = vi.fn(() => dispatchPointerListeners(path, 'wheel', event()))
    child.addPointerEventListener('wheel', once, { once: true })
    dispatchPointerListeners(path, 'wheel', event())
    expect(once).toHaveBeenCalledTimes(1)
  })

  it('stops listener propagation independently of control defaults', () => {
    const { win, child, path, dispatcher } = setup()
    const sameNode = vi.fn()
    const target = vi.fn()
    const legacy = vi.fn()
    win.addPointerEventListener('pointerdown', e => e.stopPropagation(), { capture: true })
    win.addPointerEventListener('pointerdown', sameNode, { capture: true })
    child.addPointerEventListener('pointerdown', target)
    child.onPointerDown = legacy
    dispatcher.dispatchToPath(path, event())
    expect(sameNode).toHaveBeenCalledTimes(1)
    expect(target).not.toHaveBeenCalled()
    expect(legacy).toHaveBeenCalledTimes(1)
  })

  it('can stop immediate propagation and cancel defaults', () => {
    const { win, child, path, dispatcher } = setup()
    const skipped = vi.fn()
    win.addPointerEventListener('pointerdown', e => { e.preventDefault(); e.stopImmediatePropagation() }, { capture: true })
    win.addPointerEventListener('pointerdown', skipped, { capture: true })
    child.onPointerDown = skipped
    dispatcher.dispatchToPath(path, event())
    expect(skipped).not.toHaveBeenCalled()
  })

  it('delivers cancel cleanup instead of a cancelled up, including listener errors', () => {
    const { child, path, dispatcher } = setup()
    const up = vi.fn()
    const cancel = vi.fn()
    child.onPointerUp = up
    child.onPointerCancel = cancel
    dispatcher.dispatchToPath(path, event())
    const off = child.addPointerEventListener('pointerup', e => e.preventDefault())
    dispatcher.dispatchToPath(path, event('up'))
    expect(up).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)
    off()
    child.addPointerEventListener('pointerup', () => { throw new Error('observer failure') })
    expect(() => dispatcher.dispatchToPath(path, event('up'))).toThrow('observer failure')
    expect(cancel).toHaveBeenCalledTimes(2)
  })

  it('captures to the registering node with a window-bounded path and current coordinates', () => {
    const { win, parent, child, path, dispatcher, sessions } = setup()
    const observed: unknown[] = []
    parent.addPointerEventListener('pointerdown', e => e.setPointerCapture(), { capture: true })
    parent.addPointerEventListener('pointermove', e => observed.push([e.target, e.localPosition, e.hasPointerCapture()]))
    const sibling = vi.fn()
    child.addPointerEventListener('pointermove', sibling)
    dispatcher.dispatchToPath(path, event())
    expect(sessions.getCapture(0)).toBe(parent)
    parent.offset = { x: 30, y: 50 }
    dispatcher.dispatchToCapturedTarget(parent, { ...event('move'), position: { x: 500, y: 80 } })
    expect(observed).toEqual([[parent, { x: 470, y: 30 }, true]])
    expect(sibling).not.toHaveBeenCalled()
    expect(sessions.getCapturePath(0)?.first?.target).toBe(win)
  })

  it('isolates nested RenderWindows for listeners and existing default handlers', () => {
    const outer = setup()
    const inner = setup()
    outer.win.addChild(inner.win)
    const leaked = vi.fn()
    outer.win.addPointerEventListener('pointerdown', leaked, { capture: true })
    outer.win.onPointerDown = leaked
    const path = new HitTestResult()
    path.add({ target: outer.win, localPosition: { x: 0, y: 0 } })
    for (const entry of inner.path.path) path.add(entry)
    const own = vi.fn()
    inner.win.addPointerEventListener('pointerdown', own)
    inner.dispatcher.dispatchToPath(path, event())
    expect(own).toHaveBeenCalledTimes(1)
    expect(leaked).not.toHaveBeenCalled()
  })

  it('clears disposed listeners and stops a route changed in capture', () => {
    const { win, child, path, dispatcher } = setup()
    const stale = vi.fn()
    win.addPointerEventListener('pointerdown', () => child.dispose(), { capture: true })
    child.addPointerEventListener('pointerdown', stale)
    child.onPointerDown = stale
    dispatcher.dispatchToPath(path, event())
    expect(stale).not.toHaveBeenCalled()
    child.addPointerEventListener('pointerdown', stale)
    dispatchPointerListeners(pointerTargetPath(child), 'pointerdown', event())
    expect(stale).not.toHaveBeenCalled()
  })

  it('routes native wheel and context menu before defaults with cancellation', () => {
    const { win, child, canvas, mouse } = nativeSetup()
    const wheel = vi.fn()
    const context = vi.fn()
    const order: string[] = []
    child.onWheel = wheel
    child.onContextMenu = context
    win.addPointerEventListener('wheel', e => { order.push('capture'); e.preventDefault() }, { capture: true })
    child.addPointerEventListener('wheel', e => { expect(e.deltaY).toBe(25); order.push('target') })
    win.addPointerEventListener('wheel', () => order.push('bubble'))
    canvas.dispatchEvent(new WheelEvent('wheel', { clientX: 35, clientY: 65, deltaY: 25, bubbles: true, cancelable: true }))
    expect(order).toEqual(['capture', 'target', 'bubble'])
    expect(wheel).not.toHaveBeenCalled()
    win.addPointerEventListener('contextmenu', e => { expect(e.button).toBe(2); e.preventDefault() }, { capture: true })
    mouse('contextmenu', { button: 2 })
    expect(context).not.toHaveBeenCalled()
  })

  it('observes semantic activation and double click exactly once, including listener-only targets', () => {
    const { win, child, mouse } = nativeSetup()
    const activation = vi.fn()
    const doubleClick = vi.fn()
    win.addPointerEventListener('pointeractivate', activation)
    win.addPointerEventListener('dblclick', doubleClick)
    mouse('mousedown', { detail: 1 }); mouse('mouseup', { detail: 1 })
    mouse('mousedown', { detail: 2 }); mouse('mouseup', { detail: 2 })
    mouse('dblclick', { detail: 2 })
    expect(activation).toHaveBeenCalledTimes(2)
    expect(activation.mock.calls[0]![0].target).toBe(child)
    expect(doubleClick).toHaveBeenCalledTimes(1)
    expect(doubleClick.mock.calls[0]![0].clickCount).toBe(2)
  })

  it('includes listener-only components in hover enter/leave routing', () => {
    const { child, mouse } = nativeSetup()
    const enter = vi.fn()
    const leave = vi.fn()
    child.addPointerEventListener('pointerenter', enter)
    child.addPointerEventListener('pointerleave', leave)
    mouse('mousemove')
    mouse('mousemove')
    mouse('mousemove', { clientX: 350, clientY: 250 })
    expect(enter).toHaveBeenCalledTimes(1)
    expect(leave).toHaveBeenCalledTimes(1)
    expect(enter.mock.calls[0]![0].target).toBe(child)
  })

  it('routes wheel listeners inside popup render hosts', () => {
    const { child } = setup()
    const host = new PopupRenderHost(null, () => {})
    cleanup.push(() => host.dispose())
    host.setRoot(child)
    const listener = vi.fn(e => e.preventDefault())
    child.addPointerEventListener('wheel', listener)
    const point = child.globalOffset
    expect(host.handleWheel({ pointerId: 0, type: 'wheel', position: { x: point.x + 1, y: point.y + 1 }, deltaX: 0, deltaY: 20 })).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })
  it('cancelling native up prevents semantic activation and leaves the next click usable', () => {
    const { win, mouse } = nativeSetup()
    const activate = vi.fn()
    win.addPointerEventListener('pointeractivate', activate)
    win.addPointerEventListener('pointerup', e => e.preventDefault(), { capture: true, once: true })
    mouse('mousedown'); mouse('mouseup')
    expect(activate).not.toHaveBeenCalled()
    mouse('mousedown'); mouse('mouseup')
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('aborts an outer dispatch when a listener starts another pointer frame', () => {
    const { win, child, native, mouse } = nativeSetup()
    const defaults = vi.fn()
    child.onPointerDown = defaults
    win.addPointerEventListener('pointerdown', () => {
      mouse('mousedown', { clientX: 350, clientY: 250 })
    }, { capture: true, once: true })
    mouse('mousedown')
    expect(defaults).not.toHaveBeenCalled()
    expect(native.getDebugSnapshot().activePath).not.toContain(child)
  })

  it('does not send legacy double click behind an interceptor opened by up', () => {
    const { child, native, mouse } = nativeSetup()
    const doubleClick = vi.fn()
    child.onDoubleClick = doubleClick
    mouse('mousedown', { detail: 1 }); mouse('mouseup', { detail: 1 })
    child.onPointerUp = () => native.addInterceptor({
      hitTest: () => true, onPointerDown: () => true, onPointerMove: () => true,
    })
    mouse('mousedown', { detail: 2 }); mouse('mouseup', { detail: 2 })
    expect(doubleClick).not.toHaveBeenCalled()
  })

  it('retains hover cleanup when a leave observer throws', () => {
    const { child, mouse } = nativeSetup()
    const leave = vi.fn()
    child.onPointerLeave = leave
    child.addPointerEventListener('pointerleave', () => { throw new Error('leave observer') })
    mouse('mousemove')
    // Use direct dispatch so the error is asserted rather than reported by jsdom's DOM boundary.
    const sessions = new PointerDispatchSessions()
    const dispatcher = new PointerPathDispatcher(sessions)
    expect(() => dispatcher.dispatchHover(child, event('move'), 'pointerleave')).toThrow('leave observer')
    expect(leave).toHaveBeenCalledTimes(1)
    child.dispose()
  })

  it.each(['pointermove', 'pointerup'] as const)('cancels state and activation when %s invalidates the active path', type => {
    const { win, child, native, mouse } = nativeSetup()
    const cancel = vi.fn()
    const up = vi.fn()
    const activate = vi.fn()
    child.onPointerDown = event => event.setPointerCapture?.()
    child.onPointerCancel = cancel
    child.onPointerUp = up
    child.onPointerActivate = activate
    win.addPointerEventListener(type, () => { child.visible = false }, { capture: true, once: true })
    mouse('mousedown')
    expect(native.hasPointerCapture(0)).toBe(true)
    mouse(type === 'pointermove' ? 'mousemove' : 'mouseup')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(up).not.toHaveBeenCalled()
    expect(activate).not.toHaveBeenCalled()
    expect(native.hasPointerCapture(0)).toBe(false)
    expect(native.getDebugSnapshot().sequenceEnded).toBe(true)
    if (type === 'pointermove') mouse('mouseup')
    expect(cancel).toHaveBeenCalledTimes(1)
    child.visible = true
    child.size = { width: 100, height: 40 }
    mouse('mousedown'); mouse('mouseup')
    expect(up).toHaveBeenCalledTimes(1)
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it.each(['hide', 'reparent'] as const)('completes leave cleanup when its observer invalidates the path by %s', action => {
    const { win, parent, child, mouse } = nativeSetup()
    let hovered = false
    child.onPointerEnter = () => { hovered = true }
    const leave = vi.fn(() => { hovered = false })
    child.onPointerLeave = leave
    child.addPointerEventListener('pointerleave', () => {
      if (action === 'hide') child.visible = false
      else {
        parent.children.splice(parent.children.indexOf(child), 1)
        win.addChild(child)
      }
    }, { once: true })
    mouse('mousemove')
    expect(hovered).toBe(true)
    mouse('mousemove', { clientX: 350, clientY: 250 })
    expect(leave).toHaveBeenCalledTimes(1)
    expect(hovered).toBe(false)
    child.visible = true
    child.size = { width: 100, height: 40 }
    expect(hovered).toBe(false)
  })

  it('does not clear a newer hover entered during a leave observer', () => {
    const { child, mouse } = nativeSetup()
    let hovered = false
    const enter = vi.fn(() => { hovered = true })
    const leave = vi.fn(() => { hovered = false })
    child.onPointerEnter = enter
    child.onPointerLeave = leave
    child.addPointerEventListener('pointerleave', () => { mouse('mousemove') }, { once: true })
    mouse('mousemove')
    mouse('mousemove', { clientX: 350, clientY: 250 })
    expect(enter).toHaveBeenCalledTimes(2)
    expect(leave).not.toHaveBeenCalled()
    expect(hovered).toBe(true)
  })

})
