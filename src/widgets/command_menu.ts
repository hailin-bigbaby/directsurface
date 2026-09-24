import type { RenderObject } from '../core/render_object'
import type { AppCommand, CommandManager, CommandState } from '../core/command'
import { commandShortcuts } from '../core/command_shortcut_controller'
import type { ContextMenuEntry, ContextMenuItem } from './context_menu'
import type { MenuBarItem } from './menu_bar'

export interface CommandMenuCommandItem {
  kind: 'command'
  commandId: string
  key?: string
  label?: string
  icon?: string
  shortcut?: string
  danger?: boolean
  disabled?: boolean
}

export interface CommandMenuSubmenuItem {
  kind: 'submenu'
  key: string
  label: string
  items: CommandMenuItem[]
  icon?: string
  disabled?: boolean
  visible?: boolean
}

export interface CommandMenuSeparatorItem {
  kind: 'separator'
}

export type CommandMenuItem =
  | CommandMenuCommandItem
  | CommandMenuSubmenuItem
  | CommandMenuSeparatorItem

export interface CommandMenuBarItem {
  key: string
  label: string
  items: CommandMenuItem[]
  disabled?: boolean
  visible?: boolean
}

export interface CommandMenuAdapterResult {
  entries: ContextMenuEntry[]
  onSelect(key: string): void
}

export interface CommandMenuBarAdapterResult {
  items: MenuBarItem[]
  onSelect(menuKey: string, itemKey: string): void
}

interface CommandSelection {
  commandId: string
  disabled: boolean
}

type CommandSelectionMap = Map<string, CommandSelection>

export function createCommandContextMenu(
  commandManager: CommandManager,
  source: RenderObject | undefined,
  items: CommandMenuItem[],
): CommandMenuAdapterResult {
  const selectionMap: CommandSelectionMap = new Map()
  const entries = resolveCommandMenuEntries(commandManager, source, items, selectionMap)
  return {
    entries,
    onSelect: key => executeCommandMenuSelection(commandManager, source, selectionMap, key),
  }
}

export function createCommandMenuBarItems(
  commandManager: CommandManager,
  source: RenderObject | undefined,
  menus: CommandMenuBarItem[],
): CommandMenuBarAdapterResult {
  const selectionMap: CommandSelectionMap = new Map()
  const items = menus.flatMap<MenuBarItem>(menu => {
    if (menu.visible === false) return []
    const entries = resolveCommandMenuEntries(commandManager, source, menu.items, selectionMap)
    return [{
      key: menu.key,
      label: menu.label,
      items: entries,
      disabled: menu.disabled || entries.length === 0,
    }]
  })
  return {
    items,
    onSelect: (_menuKey, itemKey) => executeCommandMenuSelection(commandManager, source, selectionMap, itemKey),
  }
}

export function resolveCommandMenuEntries(
  commandManager: CommandManager,
  source: RenderObject | undefined,
  items: CommandMenuItem[],
  selectionMap: CommandSelectionMap = new Map(),
  path: string[] = [],
): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const nextPath = [...path, String(i)]
    if (item.kind === 'separator') {
      appendSeparator(entries)
      continue
    }
    if (item.kind === 'submenu') {
      if (item.visible === false) continue
      const children = resolveCommandMenuEntries(commandManager, source, item.items, selectionMap, nextPath)
      if (children.length === 0) continue
      entries.push({
        key: item.key,
        label: item.label,
        icon: item.icon,
        disabled: item.disabled,
        items: children,
      })
      continue
    }
    const state = commandManager.evaluate(item.commandId, { source, trigger: 'menu' })
    const command = state.command
    if (!state.visible || !command) continue
    const key = item.key ?? `command:${nextPath.join('.')}:${item.commandId}`
    const disabled = !!item.disabled || !state.enabled
    selectionMap.set(key, { commandId: item.commandId, disabled })
    entries.push(resolveCommandMenuEntry(item, state, command, key))
  }
  trimTrailingSeparator(entries)
  return entries
}

export function executeCommandMenuSelection(
  commandManager: CommandManager,
  source: RenderObject | undefined,
  selectionMap: ReadonlyMap<string, CommandSelection>,
  key: string,
): void {
  const selection = selectionMap.get(key)
  if (!selection || selection.disabled) return
  void commandManager.execute(selection.commandId, { source, trigger: 'menu' })
}

function resolveCommandMenuEntry(
  item: CommandMenuCommandItem,
  state: CommandState,
  command: AppCommand,
  key: string,
): ContextMenuItem {
  return {
    key,
    label: item.label ?? state.title,
    icon: item.icon ?? state.icon,
    shortcut: item.shortcut ?? commandShortcuts(command).join(', '),
    disabled: item.disabled || !state.enabled,
    danger: item.danger,
  }
}

function appendSeparator(entries: ContextMenuEntry[]): void {
  if (entries.length === 0) return
  const previous = entries[entries.length - 1]
  if (previous && 'separator' in previous && previous.separator === true) return
  entries.push({ separator: true })
}

function trimTrailingSeparator(entries: ContextMenuEntry[]): void {
  while (entries.length > 0) {
    const last = entries[entries.length - 1]
    if (!last || !('separator' in last) || last.separator !== true) return
    entries.pop()
  }
}
