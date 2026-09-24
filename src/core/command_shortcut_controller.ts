import { CommandManager, type AppCommand } from './command'
import type { Disposable } from './disposable'
import { KeyboardBindingController } from './keyboard_binding_controller'
import type { RenderObject } from './render_object'

export type CommandShortcutSource = RenderObject | (() => RenderObject | undefined) | undefined

export interface CommandShortcutControllerOptions {
  commandManager: CommandManager
  source?: CommandShortcutSource
  priority?: number
}

export class CommandShortcutController implements Disposable {
  private readonly _disposeBinding: () => void

  constructor(private readonly _options: CommandShortcutControllerOptions) {
    this._disposeBinding = KeyboardBindingController.instance.addBinding(
      event => this._handleKeyDown(event),
      _options.priority ?? 0,
      { source: () => this._resolveSource() },
    )
  }

  dispose(): void {
    this._disposeBinding()
  }

  private _handleKeyDown(event: KeyboardEvent): boolean {
    if (event.defaultPrevented) return false
    const shortcut = shortcutFromKeyboardEvent(event)
    if (!shortcut) return false
    const source = this._resolveSource()
    const scope = this._options.commandManager.resolveScope(source)
    for (const command of scope.commands()) {
      if (!commandShortcuts(command).includes(shortcut)) continue
      const state = this._options.commandManager.evaluate(command.id, {
        source,
        trigger: 'keyboard',
        event,
      })
      if (!state.visible || !state.enabled) continue
      event.preventDefault()
      void this._options.commandManager.execute(command.id, {
        source,
        trigger: 'keyboard',
        event,
      })
      return true
    }
    return false
  }

  private _resolveSource(): RenderObject | undefined {
    return typeof this._options.source === 'function'
      ? this._options.source()
      : this._options.source
  }
}

export function commandShortcuts(command: AppCommand): string[] {
  if (!command.shortcut) return []
  const values = Array.isArray(command.shortcut) ? command.shortcut : [command.shortcut]
  return values
    .map(normalizeShortcut)
    .filter((value): value is string => value !== undefined)
}

export function normalizeShortcut(shortcut: string): string | undefined {
  const parts = shortcut
    .split('+')
    .map(part => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return undefined
  const modifiers = new Set<string>()
  let key = ''
  for (const part of parts) {
    const normalized = normalizeShortcutPart(part)
    if (!normalized) continue
    if (normalized === 'Ctrl' || normalized === 'Alt' || normalized === 'Shift' || normalized === 'Meta') {
      modifiers.add(normalized)
    } else {
      key = normalized
    }
  }
  if (!key) return undefined
  const prefix = ['Ctrl', 'Alt', 'Shift', 'Meta'].filter(modifier => modifiers.has(modifier))
  return [...prefix, key].join('+')
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): string | undefined {
  const key = normalizeShortcutPart(event.key)
  if (!key || key === 'Ctrl' || key === 'Alt' || key === 'Shift' || key === 'Meta') return undefined
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')
  parts.push(key)
  return parts.join('+')
}

function normalizeShortcutPart(part: string): string | undefined {
  const value = part.trim()
  if (!value) return undefined
  const lower = value.toLowerCase()
  switch (lower) {
    case 'control':
    case 'ctrl':
      return 'Ctrl'
    case 'option':
    case 'alt':
      return 'Alt'
    case 'shift':
      return 'Shift'
    case 'cmd':
    case 'command':
    case 'meta':
      return 'Meta'
    case 'esc':
      return 'Escape'
    case 'space':
      return ' '
    default:
      if (value.length === 1) return value.toUpperCase()
      return value[0]!.toUpperCase() + value.slice(1)
  }
}
