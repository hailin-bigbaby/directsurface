import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager, FocusScope, FocusScopeType, type Focusable } from './focus_manager'
import { ClipboardController, type CopyableSelection } from './clipboard'
import type { BoxConstraints, LayoutContext, Offset, RenderObject } from './render_object'
import { RenderBox, RenderVisibility } from '../layout/render_box'

function focusable(onKeyDown?: (e: KeyboardEvent) => boolean | void): Focusable & { onKeyDown: ((e: KeyboardEvent) => boolean | void) | undefined } {
  let focused = false
  return {
    focusIn: vi.fn(() => { focused = true }),
    focusOut: vi.fn(() => { focused = false }),
    get isFocused() { return focused },
    onKeyDown,
  }
}

function keyEvent(key: string, opts?: Partial<KeyboardEventInit>): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, ...opts, bubbles: true, cancelable: true })
}

class FocusNode extends RenderBox implements Focusable {
  children: FocusNode[] = []
  private _focused = false

  addChild(child: FocusNode): void {
    child.parent = this
    this.children.push(child)
  }

  get isFocused(): boolean { return this._focused }
  focusIn(): void { this._focused = true }
  focusOut(): void { this._focused = false }
  performLayout(_constraints: BoxConstraints, _context: LayoutContext): void { this.size = { width: 0, height: 0 } }
  performPaint(_context: any, _offset: Offset): void {}
  visitChildren(visitor: (child: RenderObject) => void): void {
    for (const child of this.children) visitor(child)
  }
}

class EnterHostNode extends FocusNode {
  handleUnhandledEnterFromDescendant(target: Focusable, event: KeyboardEvent): boolean {
    return FocusManager.instance.moveFocusFrom(target, event.shiftKey ? -1 : 1, {
      withinRoot: this,
      wrap: false,
    })
  }
}

class KeyHostNode extends FocusNode {
  handled: string[] = []

  handleUnhandledKeyDownFromDescendant(_target: Focusable, event: KeyboardEvent): boolean {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Tab') {
      this.handled.push(event.shiftKey ? 'prev' : 'next')
      return true
    }
    return false
  }
}

class CountingFocusNode extends FocusNode {
  focusVisitorCalls = 0
  activeEdgeCalls = 0

  override visitFocusChildren(visitor: (child: RenderObject) => void): void {
    super.visitFocusChildren(child => {
      this.focusVisitorCalls++
      visitor(child)
    })
  }

  override isFocusChildActive(child: RenderObject): boolean {
    this.activeEdgeCalls++
    return super.isFocusChildActive(child)
  }

  resetCounts(): void {
    this.focusVisitorCalls = 0
    this.activeEdgeCalls = 0
  }
}

afterEach(() => {
  ClipboardController.instance.resetWriter()
  FocusManager.instance.dispose()
  vi.restoreAllMocks()
})

describe('FocusManager lifecycle', () => {
  it('removes the global key listener on dispose', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const manager = FocusManager.instance
    manager.dispose()

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true)
  })

  it('clears focus and registrations on dispose', () => {
    const widget = focusable()
    const manager = FocusManager.instance

    manager.register(widget)
    manager.setFocus(widget)
    manager.dispose()

    expect(widget.focusOut).toHaveBeenCalledTimes(1)
    expect(manager.current).toBe(null)
  })
})

describe('FocusManager focus', () => {
  it('registers and focuses a widget', () => {
    const w1 = focusable()
    const manager = FocusManager.instance
    manager.register(w1)
    manager.setFocus(w1)

    expect(w1.focusIn).toHaveBeenCalledTimes(1)
    expect(manager.current).toBe(w1)
  })

  it('switches focus between widgets', () => {
    const w1 = focusable()
    const w2 = focusable()
    const manager = FocusManager.instance
    manager.register(w1)
    manager.register(w2)

    manager.setFocus(w1)
    manager.setFocus(w2)

    expect(w1.focusOut).toHaveBeenCalledTimes(1)
    expect(w2.focusIn).toHaveBeenCalledTimes(1)
    expect(manager.current).toBe(w2)
  })

  it('finishes focusing the target before rethrowing a previous focusOut error', () => {
    const failure = new Error('blur listener failed')
    let previousFocused = false
    const previous: Focusable = {
      focusIn: vi.fn(() => { previousFocused = true }),
      focusOut: vi.fn(() => {
        previousFocused = false
        throw failure
      }),
      get isFocused() { return previousFocused },
    }
    const target = focusable()
    const scope = new FocusScope(FocusScopeType.Normal)
    scope.add(previous)
    scope.add(target)
    scope.setFocus(previous)

    expect(() => scope.setFocus(target)).toThrow(failure)

    expect(previous.isFocused).toBe(false)
    expect(target.focusIn).toHaveBeenCalledOnce()
    expect(target.isFocused).toBe(true)
    expect(scope.current).toBe(target)
  })

  it('keeps a focus selected reentrantly from the previous focusOut callback', () => {
    const scope = new FocusScope(FocusScopeType.Normal)
    const first = focusable()
    const outerTarget = focusable()
    const reentrantTarget = focusable()
    scope.add(first)
    scope.add(outerTarget)
    scope.add(reentrantTarget)
    scope.setFocus(first)
    vi.mocked(first.focusOut).mockImplementationOnce(() => {
      scope.setFocus(reentrantTarget)
    })

    scope.setFocus(outerTarget)

    expect(first.focusOut).toHaveBeenCalledOnce()
    expect(outerTarget.focusIn).not.toHaveBeenCalled()
    expect(reentrantTarget.focusIn).toHaveBeenCalledOnce()
    expect(scope.current).toBe(reentrantTarget)
  })

  it('still focuses the requested widget when focusOut changes unrelated registrations', () => {
    const scope = new FocusScope(FocusScopeType.Normal)
    const first = focusable()
    const target = focusable()
    const unrelated = focusable()
    scope.add(first)
    scope.add(target)
    scope.setFocus(first)
    vi.mocked(first.focusOut).mockImplementationOnce(() => {
      scope.add(unrelated)
      scope.remove(unrelated)
    })

    scope.setFocus(target)

    expect(target.focusIn).toHaveBeenCalledOnce()
    expect(scope.current).toBe(target)
  })

  it('does not focus a requested widget removed during the previous focusOut callback', () => {
    const scope = new FocusScope(FocusScopeType.Normal)
    const first = focusable()
    const removedTarget = focusable()
    scope.add(first)
    scope.add(removedTarget)
    scope.setFocus(first)
    vi.mocked(first.focusOut).mockImplementationOnce(() => {
      scope.remove(removedTarget)
    })

    scope.setFocus(removedTarget)

    expect(removedTarget.focusIn).not.toHaveBeenCalled()
    expect(scope.current).toBe(null)
  })

  it('detaches removed focus before setFocusables dispatches focusOut', () => {
    const scope = new FocusScope(FocusScopeType.Normal)
    const first = focusable()
    const replacement = focusable()
    scope.setFocusables([first, replacement])
    scope.setFocus(first)
    vi.mocked(first.focusOut).mockImplementationOnce(() => {
      scope.setFocus(replacement)
    })

    scope.setFocusables([replacement])

    expect(first.focusOut).toHaveBeenCalledOnce()
    expect(replacement.focusIn).toHaveBeenCalledOnce()
    expect(scope.current).toBe(replacement)
  })

  it('clears focus', () => {
    const w1 = focusable()
    const manager = FocusManager.instance
    manager.register(w1)
    manager.setFocus(w1)
    manager.clearFocus()

    expect(w1.focusOut).toHaveBeenCalledTimes(1)
    expect(manager.current).toBe(null)
  })

  it('unregisters a widget and removes it from all scopes', () => {
    const w1 = focusable()
    const manager = FocusManager.instance
    manager.register(w1)
    manager.setFocus(w1)
    manager.unregister(w1)

    expect(manager.current).toBe(null)
  })
})

describe('FocusScope', () => {
  it('leaves keydown untouched when the focused widget defers it to native input', () => {
    const onKeyDown = vi.fn(() => true)
    const shouldIgnoreKeyDown = vi.fn(() => true)
    const onScopeKeyDown = vi.fn(() => true)
    const widget = focusable(onKeyDown)
    widget.shouldIgnoreKeyDown = shouldIgnoreKeyDown
    const manager = FocusManager.instance
    manager.register(widget)
    manager.setFocus(widget)
    const popupScope = new FocusScope(FocusScopeType.Popup, onScopeKeyDown)
    popupScope.add(widget)
    manager.pushScope(popupScope)
    manager.setFocus(widget)
    const event = keyEvent('Enter')

    expect(manager.handleKeyDownEvent(event)).toBe(false)

    expect(shouldIgnoreKeyDown).toHaveBeenCalledWith(event)
    expect(onKeyDown).not.toHaveBeenCalled()
    expect(onScopeKeyDown).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('copies focused copyable selection with Ctrl+C after widget key handling declines', () => {
    const copied: string[] = []
    ClipboardController.instance.setWriter(text => { copied.push(text) })
    const widget = {
      ...focusable(() => false),
      getCopyText: () => 'debug value',
    } satisfies Focusable & CopyableSelection
    const manager = FocusManager.instance
    manager.register(widget)
    manager.setFocus(widget)

    const event = keyEvent('c', { ctrlKey: true })
    expect(manager.handleKeyDownEvent(event)).toBe(true)

    expect(copied).toEqual(['debug value'])
    expect(event.defaultPrevented).toBe(true)
  })

  it('lets focused widget key handling take priority over generic copy', () => {
    const copied: string[] = []
    ClipboardController.instance.setWriter(text => { copied.push(text) })
    const widget = {
      ...focusable(() => true),
      getCopyText: () => 'debug value',
    } satisfies Focusable & CopyableSelection
    const manager = FocusManager.instance
    manager.register(widget)
    manager.setFocus(widget)

    expect(manager.handleKeyDownEvent(keyEvent('c', { ctrlKey: true }))).toBe(true)

    expect(copied).toEqual([])
  })

  it('allows copyable widgets to copy an empty string', () => {
    const copied: string[] = []
    ClipboardController.instance.setWriter(text => { copied.push(text) })
    const widget = {
      ...focusable(() => false),
      getCopyText: () => '',
    } satisfies Focusable & CopyableSelection
    const manager = FocusManager.instance
    manager.register(widget)
    manager.setFocus(widget)

    expect(manager.handleKeyDownEvent(keyEvent('c', { ctrlKey: true }))).toBe(true)

    expect(copied).toEqual([''])
  })

  it('pushScope creates a new active scope', () => {
    const w1 = focusable()
    const manager = FocusManager.instance
    manager.register(w1)
    manager.setFocus(w1)

    const scope = new FocusScope(FocusScopeType.Modal)
    const prev = manager.pushScope(scope)

    expect(prev).toBe(w1)
    expect(manager.scopeStack.length).toBe(2)
    expect(manager.scopeStack[1]).toBe(scope)
  })

  it('popScope restores previous scope', () => {
    const w1 = focusable()
    const manager = FocusManager.instance
    manager.register(w1)
    manager.setFocus(w1)

    const scope = new FocusScope(FocusScopeType.Modal)
    const prev = manager.pushScope(scope)
    manager.popScope(prev)

    expect(manager.scopeStack.length).toBe(1)
    expect(manager.current).toBe(w1)
    expect(w1.focusIn).toHaveBeenCalledTimes(2)
  })

  it('removes the expected scope when focusOut pushes a replacement scope', () => {
    const manager = FocusManager.instance
    const original = new FocusScope(FocusScopeType.Popup)
    const replacement = new FocusScope(FocusScopeType.Popup)
    const widget = focusable()
    original.add(widget)
    manager.pushScope(original)
    original.setFocus(widget)
    vi.mocked(widget.focusOut).mockImplementationOnce(() => {
      manager.pushScope(replacement)
    })

    manager.popScope(null, original)

    expect(manager.scopeStack).toHaveLength(2)
    expect(manager.scopeStack[1]).toBe(replacement)
    expect(manager.scopeStack).not.toContain(original)
  })

  it('popup scope preserves the current focused widget in the underlying scope', () => {
    const w1 = focusable()
    const manager = FocusManager.instance
    manager.register(w1)
    manager.setFocus(w1)

    const scope = new FocusScope(FocusScopeType.Popup)
    const prev = manager.pushScope(scope)

    expect(prev).toBe(w1)
    expect(manager.current).toBe(w1)
    expect(w1.focusOut).not.toHaveBeenCalled()
  })

  it('keydown dispatches through scope stack', () => {
    const w1 = focusable((e) => e.key === 'ArrowDown')
    const manager = FocusManager.instance
    manager.register(w1)
    manager.setFocus(w1)

    const e = keyEvent('ArrowDown')
    manager['_keyHandler'](e)

    expect(e.defaultPrevented).toBe(true)
  })

  it('keydown falls through scope stack when not consumed', () => {
    const w1 = focusable((e) => false)
    const manager = FocusManager.instance
    manager.register(w1)
    manager.setFocus(w1)

    let scopeHandled = false
    const popupScope = new FocusScope(FocusScopeType.Popup, (e) => {
      if (e.key === 'Escape') { scopeHandled = true; return true }
      return false
    })
    manager.pushScope(popupScope)

    const e = keyEvent('Escape')
    manager['_keyHandler'](e)

    expect(scopeHandled).toBe(true)
  })

  it('popup scope onKeyDown takes priority over default scope', () => {
    const w1 = focusable()
    const manager = FocusManager.instance
    manager.register(w1)
    manager.setFocus(w1)

    let escapeHandled = false
    const popupScope = new FocusScope(FocusScopeType.Popup, (e) => {
      if (e.key === 'Escape') { escapeHandled = true; return true }
      return false
    })
    manager.pushScope(popupScope)

    const e = keyEvent('Escape')
    manager['_keyHandler'](e)

    expect(escapeHandled).toBe(true)
  })

  it('keydown focused widget in popup scope takes priority', () => {
    const w1 = focusable()
    const manager = FocusManager.instance
    manager.register(w1)
    manager.setFocus(w1)

    const w2 = focusable((e) => e.key === 'Escape')
    const popupScope = new FocusScope(FocusScopeType.Popup)
    popupScope.add(w2)
    popupScope.setFocus(w2)
    manager.pushScope(popupScope)

    const e = keyEvent('Escape')
    manager['_keyHandler'](e)

    expect(e.defaultPrevented).toBe(true)
    expect(e.cancelBubble).toBe(true)
  })

  it('Tab navigates within active scope', () => {
    const w1 = focusable()
    const w2 = focusable()
    const w3 = focusable()
    const manager = FocusManager.instance
    manager.register(w1)
    manager.register(w2)
    manager.register(w3)

    manager.setFocus(w1)
    const e = keyEvent('Tab')
    manager['_keyHandler'](e)

    expect(manager.current).toBe(w2)
    expect(e.defaultPrevented).toBe(true)
  })

  it('Shift+Tab navigates backwards within active scope', () => {
    const w1 = focusable()
    const w2 = focusable()
    const manager = FocusManager.instance
    manager.register(w1)
    manager.register(w2)

    manager.setFocus(w2)
    const e = keyEvent('Tab', { shiftKey: true })
    manager['_keyHandler'](e)

    expect(manager.current).toBe(w1)
  })

  it('Tab follows render tree order instead of registration order when roots are provided', () => {
    const manager = FocusManager.instance
    const root = new FocusNode()
    const first = new FocusNode()
    const second = new FocusNode()
    root.addChild(first)
    root.addChild(second)
    manager.setRootResolver(() => [root])

    manager.register(second)
    manager.register(first)
    manager.setFocus(first)

    const e = keyEvent('Tab')
    manager.handleKeyDownEvent(e)

    expect(manager.current).toBe(second)
  })

  it('Tab stays within the active root window when multiple roots are registered', () => {
    const manager = FocusManager.instance
    const rootA = new FocusNode()
    const rootB = new FocusNode()
    const first = new FocusNode()
    const second = new FocusNode()
    const other = new FocusNode()
    rootA.addChild(first)
    rootA.addChild(second)
    rootB.addChild(other)
    manager.setRootResolver(() => [rootA, rootB])

    manager.register(first)
    manager.register(second)
    manager.register(other)
    manager.setFocus(first)

    const e = keyEvent('Tab')
    manager.handleKeyDownEvent(e)

    expect(manager.current).toBe(second)
    expect(manager.activeRoot).toBe(rootA)
  })

  it('keeps the active root selected by a reentrant focusOut transition', () => {
    const manager = FocusManager.instance
    const rootA = new FocusNode()
    const rootB = new FocusNode()
    const first = new FocusNode()
    const outerTarget = new FocusNode()
    const reentrantTarget = new FocusNode()
    rootA.addChild(first)
    rootA.addChild(outerTarget)
    rootB.addChild(reentrantTarget)
    manager.setRootResolver(() => [rootA, rootB])
    manager.register(first)
    manager.register(outerTarget)
    manager.register(reentrantTarget)
    manager.setFocus(first)
    first.focusOut = () => {
      manager.setFocus(reentrantTarget)
    }

    manager.setFocus(outerTarget)

    expect(manager.current).toBe(reentrantTarget)
    expect(manager.activeRoot).toBe(rootB)
  })

  it('Tab starts in the active root when no widget is currently focused', () => {
    const manager = FocusManager.instance
    const rootA = new FocusNode()
    const rootB = new FocusNode()
    const first = new FocusNode()
    const other = new FocusNode()
    rootA.addChild(first)
    rootB.addChild(other)
    manager.setRootResolver(() => [rootA, rootB])

    manager.register(first)
    manager.register(other)
    manager.setActiveRoot(rootB)

    const e = keyEvent('Tab')
    manager.handleKeyDownEvent(e)

    expect(manager.current).toBe(other)
  })

  it('Tab excludes registered focusables outside resolved roots', () => {
    const manager = FocusManager.instance
    const root = new FocusNode()
    const visible = new FocusNode()
    const hiddenRoot = new FocusNode()
    const hidden = new FocusNode()
    root.addChild(visible)
    hiddenRoot.addChild(hidden)
    manager.setRootResolver(() => [root])

    manager.register(visible)
    manager.register(hidden)
    manager.setFocus(visible)

    const e = keyEvent('Tab')
    manager.handleKeyDownEvent(e)

    expect(manager.current).toBe(visible)
    expect(e.defaultPrevented).toBe(true)
  })

  it('rejects focus inside hidden ancestors and clears stale focus before keyboard dispatch', () => {
    const manager = FocusManager.instance
    const child = new FocusNode()
    const visibility = new RenderVisibility({ child })
    manager.setRootResolver(() => [visibility])
    manager.register(child)

    manager.setFocus(child)
    expect(manager.current).toBe(child)

    visibility.mode = 'hidden'
    manager.handleKeyDownEvent(keyEvent('ArrowDown'))
    expect(manager.current).toBe(null)

    manager.setFocus(child)
    expect(manager.current).toBe(null)
  })

  it('validates ordinary key focus without enumerating 5,000 unrelated siblings', () => {
    const manager = FocusManager.instance
    const root = new CountingFocusNode()
    const target = new CountingFocusNode()
    root.addChild(target)
    for (let index = 0; index < 5_000; index++) root.addChild(new FocusNode())
    manager.setRootResolver(() => [root])
    manager.register(target)
    manager.setFocus(target)
    root.resetCounts()
    target.resetCounts()

    manager.handleKeyDownEvent(keyEvent('a'))

    expect(manager.current).toBe(target)
    expect(root.focusVisitorCalls).toBe(0)
    expect(root.activeEdgeCalls).toBe(1)
  })

  it.each([1, 10, 50])('keeps active-edge checks linear for a path depth of %d', depth => {
    const manager = FocusManager.instance
    const root = new CountingFocusNode()
    let parent = root
    for (let index = 0; index < depth - 1; index++) {
      const next = new CountingFocusNode()
      parent.addChild(next)
      parent = next
    }
    const target = new CountingFocusNode()
    parent.addChild(target)
    manager.setRootResolver(() => [root])
    manager.register(target)
    manager.setFocus(target)
    const path: CountingFocusNode[] = []
    let current: RenderObject | undefined = target.parent
    while (current instanceof CountingFocusNode) {
      path.push(current)
      current.resetCounts()
      current = current.parent
    }

    manager.handleKeyDownEvent(keyEvent('a'))

    expect(path.reduce((total, node) => total + node.activeEdgeCalls, 0)).toBe(depth)
    expect(path.reduce((total, node) => total + node.focusVisitorCalls, 0)).toBe(0)
  })

  it('excludes descendants when an ordinary render ancestor is invisible', () => {
    const manager = FocusManager.instance
    const root = new FocusNode()
    const hiddenParent = new FocusNode()
    const hiddenChild = new FocusNode()
    const visibleChild = new FocusNode()
    root.addChild(hiddenParent)
    root.addChild(visibleChild)
    hiddenParent.addChild(hiddenChild)
    hiddenParent.visible = false
    manager.setRootResolver(() => [root])
    manager.register(hiddenChild)
    manager.register(visibleChild)

    manager.setFocus(hiddenChild)
    expect(manager.current).toBe(null)

    manager.handleKeyDownEvent(keyEvent('Tab'))
    expect(manager.current).toBe(visibleChild)
  })

  it('does not consume Tab when registered focusables are all outside resolved roots', () => {
    const manager = FocusManager.instance
    const root = new FocusNode()
    const hiddenRoot = new FocusNode()
    const hidden = new FocusNode()
    hiddenRoot.addChild(hidden)
    manager.setRootResolver(() => [root])

    manager.register(hidden)

    const e = keyEvent('Tab')
    expect(manager.handleKeyDownEvent(e)).toBe(false)
    expect(e.defaultPrevented).toBe(false)
    expect(manager.current).toBe(null)
  })

  it('Tab within modal scope only cycles modal focusables', () => {
    const w1 = focusable()
    const w2 = focusable()
    const w3 = focusable()
    const manager = FocusManager.instance
    manager.register(w1)
    manager.register(w2)

    const modalScope = new FocusScope(FocusScopeType.Modal)
    modalScope.add(w3)
    manager.pushScope(modalScope)
    modalScope.setFocus(w3)

    const e = keyEvent('Tab')
    manager['_keyHandler'](e)

    expect(modalScope.current).toBe(w3)
  })

  it('focuses a registered widget that is attached to the modal root after the scope is created', () => {
    const manager = FocusManager.instance
    const modalRoot = new FocusNode()
    const lateChild = new FocusNode()
    manager.register(lateChild)

    const modalScope = new FocusScope(FocusScopeType.Modal)
    manager.pushScope(modalScope)
    manager.refreshScopeFocusRoots(modalScope, [modalRoot])

    modalRoot.addChild(lateChild)
    manager.setFocus(lateChild)

    expect(manager.current).toBe(lateChild)
    expect(lateChild.isFocused).toBe(true)
  })

  it('dispatches unhandled Enter to the nearest host and moves focus within that subtree', () => {
    const manager = FocusManager.instance
    const root = new EnterHostNode()
    const first = new FocusNode()
    const second = new FocusNode()
    root.addChild(first)
    root.addChild(second)
    manager.setRootResolver(() => [root])
    manager.register(first)
    manager.register(second)
    manager.setFocus(first)

    const handled = manager.dispatchUnhandledEnterFrom(first, keyEvent('Enter'))

    expect(handled).toBe(true)
    expect(manager.current).toBe(second)
  })

  it('dispatches unhandled shortcut keys to the nearest host', () => {
    const manager = FocusManager.instance
    const root = new KeyHostNode()
    const child = new FocusNode()
    root.addChild(child)
    manager.setRootResolver(() => [root])
    manager.register(child)
    manager.setFocus(child)

    const event = keyEvent('Tab', { ctrlKey: true })
    manager.handleKeyDownEvent(event)

    expect(root.handled).toEqual(['next'])
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('FocusManager auxiliary roots', () => {
  it('adds an auxiliary root after the active application root and restores prior focus on removal', () => {
    const manager = FocusManager.instance
    const page = new FocusNode()
    const editor = new FocusNode()
    const toast = new FocusNode()
    const action = new FocusNode()
    page.addChild(editor)
    toast.addChild(action)
    manager.setRootResolver(() => [page])
    manager.setActiveRoot(page)
    manager.register(editor)
    manager.register(action)
    const registration = manager.registerAuxiliaryRoot(toast, { order: 10 })

    manager.setFocus(editor)
    manager.setFocus(action)

    expect(manager.current).toBe(action)
    expect(manager.canFocusAuxiliaryRoot(toast)).toBe(true)

    registration.dispose()

    expect(manager.current).toBe(editor)
    expect(manager.canFocusAuxiliaryRoot(toast)).toBe(false)
  })

  it('can remove an auxiliary root without restoring its prior focus', () => {
    const manager = FocusManager.instance
    const page = new FocusNode()
    const editor = new FocusNode()
    const card = new FocusNode()
    const action = new FocusNode()
    page.addChild(editor)
    card.addChild(action)
    manager.setRootResolver(() => [page])
    manager.setActiveRoot(page)
    manager.register(editor)
    manager.register(action)
    const registration = manager.registerAuxiliaryRoot(card, { order: 10 })

    manager.setFocus(editor)
    manager.setFocus(action)
    registration.dispose({ restoreFocus: false })

    expect(manager.current).toBe(null)
    expect(editor.isFocused).toBe(false)
    expect(action.isFocused).toBe(false)
    expect(manager.canFocusAuxiliaryRoot(card)).toBe(false)
  })

  it('does not reuse a stale page restore target after focus was explicitly cleared', () => {
    const manager = FocusManager.instance
    const page = new FocusNode()
    const editor = new FocusNode()
    const firstToast = new FocusNode()
    const firstAction = new FocusNode()
    const secondToast = new FocusNode()
    const secondAction = new FocusNode()
    page.addChild(editor)
    firstToast.addChild(firstAction)
    secondToast.addChild(secondAction)
    manager.setRootResolver(() => [page])
    manager.setActiveRoot(page)
    manager.register(editor)
    manager.register(firstAction)
    manager.register(secondAction)
    const firstRegistration = manager.registerAuxiliaryRoot(firstToast, { order: 10 })

    manager.setFocus(editor)
    manager.setFocus(firstAction)
    manager.clearFocus()
    firstRegistration.dispose()

    const secondRegistration = manager.registerAuxiliaryRoot(secondToast, { order: 20 })
    manager.setFocus(secondAction)
    secondRegistration.dispose()

    expect(manager.current).toBe(null)
    expect(editor.isFocused).toBe(false)
  })

  it.each([FocusScopeType.Popup, FocusScopeType.Modal])(
    'does not restore page focus while a %s scope is active',
    scopeType => {
      const manager = FocusManager.instance
      const page = new FocusNode()
      const editor = new FocusNode()
      const toast = new FocusNode()
      const action = new FocusNode()
      const overlay = new FocusNode()
      page.addChild(editor)
      toast.addChild(action)
      manager.setRootResolver(() => [page])
      manager.setActiveRoot(page)
      manager.register(editor)
      manager.register(action)
      manager.register(overlay)
      const registration = manager.registerAuxiliaryRoot(toast, { order: 10 })

      manager.setFocus(editor)
      manager.setFocus(action)
      const scope = new FocusScope(scopeType)
      const restore = manager.pushScope(scope)
      manager.refreshScopeFocusRoots(scope, [overlay])
      manager.setFocus(overlay)

      registration.dispose()

      expect(manager.current).toBe(overlay)
      expect(overlay.isFocused).toBe(true)
      expect(editor.isFocused).toBe(false)
      expect(action.isFocused).toBe(false)

      manager.popScope(restore, scope)

      expect(manager.current).toBe(editor)
      expect(editor.isFocused).toBe(true)
      expect(action.isFocused).toBe(false)
    },
  )
})

describe('FocusScope handleKeyDown', () => {
  it('focused widget onKeyDown consumes event', () => {
    const w = focusable((e) => e.key === 'Enter')
    const scope = new FocusScope(FocusScopeType.Normal)
    scope.add(w)
    scope.setFocus(w)

    const e = keyEvent('Enter')
    const consumed = scope.handleKeyDown(e)
    expect(consumed).toBe(true)
  })

  it('scope onKeyDown consumes event when widget does not', () => {
    const w = focusable()
    let called = false
    const scope = new FocusScope(FocusScopeType.Popup, (e) => {
      if (e.key === 'Escape') { called = true; return true }
      return false
    })
    scope.add(w)
    scope.setFocus(w)

    const e = keyEvent('Escape')
    const consumed = scope.handleKeyDown(e)
    expect(consumed).toBe(true)
    expect(called).toBe(true)
  })

  it('returns false when nothing consumes the event', () => {
    const w = focusable()
    const scope = new FocusScope(FocusScopeType.Normal)
    scope.add(w)
    scope.setFocus(w)

    const e = keyEvent('F1')
    const consumed = scope.handleKeyDown(e)
    expect(consumed).toBe(false)
  })
})

describe('FocusManager backward compat pushTrap/popTrap', () => {
  it('pushTrap with empty array restricts Tab navigation', () => {
    const w1 = focusable()
    const manager = FocusManager.instance
    manager.register(w1)
    manager.setFocus(w1)

    manager.pushTrap([])
    const e = keyEvent('Tab')
    manager['_keyHandler'](e)

    expect(manager.current).toBe(null)
  })

  it('popTrap restores focus', () => {
    const w1 = focusable()
    const manager = FocusManager.instance
    manager.register(w1)
    manager.setFocus(w1)

    const prev = manager.pushTrap([])
    manager.popTrap(prev)

    expect(manager.current).toBe(w1)
  })
})
