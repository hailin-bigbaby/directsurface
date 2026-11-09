// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMMAND_SCOPE_PROVIDER,
  CommandManager,
  CommandScope,
  type CommandScopeProvider,
} from './command'
import { CommandShortcutController, normalizeShortcut, shortcutFromKeyboardEvent } from './command_shortcut_controller'
import { FocusManager, FocusScope, FocusScopeType } from './focus_manager'
import { KeyboardBindingController } from './keyboard_binding_controller'
import { RenderObject, type BoxConstraints, type LayoutContext, type Offset } from './render_object'
import type { PaintContext } from '../rendering/paint_context'

class TestBox extends RenderObject {
  performLayout(_constraints: BoxConstraints, _context: LayoutContext): void {
    this.size = { width: 10, height: 10 }
  }

  performPaint(_context: PaintContext, _offset: Offset): void {}

  visitChildren(_visitor: (child: RenderObject) => void): void {}
}

class CommandScopeBox extends TestBox implements CommandScopeProvider {
  constructor(readonly scope: CommandScope) {
    super()
  }

  [COMMAND_SCOPE_PROVIDER](): CommandScope {
    return this.scope
  }
}

afterEach(() => {
  KeyboardBindingController.disposeInstance()
  FocusManager.disposeInstance()
  vi.restoreAllMocks()
})

describe('CommandShortcutController', () => {
  it('normalizes shortcut strings and keyboard events', () => {
    expect(normalizeShortcut('shift + ctrl + s')).toBe('Ctrl+Shift+S')
    expect(normalizeShortcut('cmd+enter')).toBe('Meta+Enter')
    expect(shortcutFromKeyboardEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))).toBe('Ctrl+S')
  })

  it('executes the matching scoped command through KeyboardBindingController', async () => {
    const manager = new CommandManager()
    const scope = new CommandScope(manager.rootScope)
    const source = new TestBox()
    source.parent = new CommandScopeBox(scope)
    const execute = vi.fn()
    scope.register({
      id: 'save',
      title: '保存',
      shortcut: 'Ctrl+S',
      execute,
    })
    const controller = new CommandShortcutController({ commandManager: manager, source })
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })

    window.dispatchEvent(event)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(event.defaultPrevented).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)

    controller.dispose()
    manager.dispose()
  })

  it('does not consume disabled command shortcuts', () => {
    const manager = new CommandManager()
    const execute = vi.fn()
    manager.register({
      id: 'save',
      title: '保存',
      shortcut: 'Ctrl+S',
      canExecute: () => false,
      execute,
    })
    const controller = new CommandShortcutController({ commandManager: manager })
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(execute).not.toHaveBeenCalled()

    controller.dispose()
    manager.dispose()
  })

  it('skips disabled shortcut matches and executes the next enabled command', async () => {
    const manager = new CommandManager()
    const disabledExecute = vi.fn()
    const enabledExecute = vi.fn()
    manager.register({
      id: 'global-save',
      title: '全局保存',
      shortcut: 'Ctrl+S',
      canExecute: () => false,
      execute: disabledExecute,
    })
    manager.register({
      id: 'page-save',
      title: '页面保存',
      shortcut: 'Ctrl+S',
      execute: enabledExecute,
    })
    const controller = new CommandShortcutController({ commandManager: manager })
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })

    window.dispatchEvent(event)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(event.defaultPrevented).toBe(true)
    expect(disabledExecute).not.toHaveBeenCalled()
    expect(enabledExecute).toHaveBeenCalledTimes(1)

    controller.dispose()
    manager.dispose()
  })

  it('blocks global command shortcuts while a modal focus scope is active', async () => {
    const manager = new CommandManager()
    const execute = vi.fn()
    manager.register({
      id: 'save',
      title: '保存',
      shortcut: 'Ctrl+S',
      execute,
    })
    const controller = new CommandShortcutController({ commandManager: manager })
    FocusManager.instance.pushScope(new FocusScope(FocusScopeType.Modal))

    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })
    window.dispatchEvent(event)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(execute).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)

    controller.dispose()
    manager.dispose()
  })

  it('allows command shortcuts whose source is inside the active modal root', async () => {
    const manager = new CommandManager()
    const scope = new CommandScope(manager.rootScope)
    const modalRoot = new CommandScopeBox(scope)
    const source = new TestBox()
    source.parent = modalRoot
    const execute = vi.fn()
    scope.register({
      id: 'save',
      title: '保存',
      shortcut: 'Ctrl+S',
      execute,
    })
    const modalScope = new FocusScope(FocusScopeType.Modal)
    FocusManager.instance.pushScope(modalScope)
    FocusManager.instance.refreshScopeFocusRoots(modalScope, [modalRoot])
    const controller = new CommandShortcutController({ commandManager: manager, source })

    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })
    window.dispatchEvent(event)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(event.defaultPrevented).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)

    controller.dispose()
    manager.dispose()
  })
})
