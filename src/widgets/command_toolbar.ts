import {
  commandManagerContextKey,
  type CommandManager,
  type CommandState,
} from '../core/command'
import type { DisposeFn } from '../core/disposable'
import type { BoxConstraints, LayoutContext, PipelineOwner } from '../core/render_object'
import type { IconName } from './icon'
import { RenderToolbar, type ToolbarGroup, type ToolbarItem, type ToolbarSlot } from './toolbar'

export interface CommandToolbarCommandItem {
  kind: 'command'
  commandId: string
  id?: string
  label?: string
  tooltip?: string
  showLabel?: boolean
}

export interface CommandToolbarSeparatorItem {
  kind: 'separator'
  id?: string
}

export type CommandToolbarItem = CommandToolbarCommandItem | CommandToolbarSeparatorItem

export interface CommandToolbarGroup {
  id: string
  slot: ToolbarSlot
  visible?: boolean
  items: CommandToolbarItem[]
}

export interface RenderCommandToolbarOptions {
  groups: CommandToolbarGroup[]
  commandManager?: CommandManager
}

export class RenderCommandToolbar extends RenderToolbar {
  static override debugTypeName = 'RenderCommandToolbar'
  private _commandGroups: CommandToolbarGroup[]
  private readonly _commandManager?: CommandManager
  private _commandSubscription?: DisposeFn
  private _subscribedManager?: CommandManager
  private _lastVersion = -1

  constructor(options: RenderCommandToolbarOptions) {
    super()
    this._commandGroups = [...options.groups]
    this._commandManager = options.commandManager
  }

  get commandGroups(): readonly CommandToolbarGroup[] {
    return this._commandGroups
  }

  setCommandGroups(groups: CommandToolbarGroup[]): void {
    this._commandGroups = [...groups]
    this._lastVersion = -1
    this.markNeedsLayout()
  }

  override attach(owner: PipelineOwner): void {
    super.attach(owner)
    this._syncCommandSubscription()
  }

  override detach(): void {
    this._commandSubscription?.()
    this._commandSubscription = undefined
    this._subscribedManager = undefined
    super.detach()
  }

  override performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    this._syncCommandSubscription()
    this._syncToolbarGroups()
    super.performLayout(constraints, context)
  }

  override dispose(): void {
    this._commandSubscription?.()
    this._commandSubscription = undefined
    this._subscribedManager = undefined
    super.dispose()
  }

  private _syncCommandSubscription(): void {
    const manager = this._resolveCommandManager()
    if (manager === this._subscribedManager) return
    this._commandSubscription?.()
    this._commandSubscription = undefined
    this._subscribedManager = manager
    if (!manager) return
    this._commandSubscription = manager.subscribe(() => {
      this._lastVersion = -1
      this.markNeedsLayout()
    })
  }

  private _syncToolbarGroups(): void {
    const manager = this._resolveCommandManager()
    if (!manager) {
      super.setGroups([])
      return
    }
    if (this._lastVersion === manager.version) return
    this._lastVersion = manager.version
    super.setGroups(this._resolveToolbarGroups(manager))
  }

  private _resolveToolbarGroups(manager: CommandManager): ToolbarGroup[] {
    return this._commandGroups.map(group => ({
      id: group.id,
      slot: group.slot,
      visible: group.visible,
      items: group.items.flatMap<ToolbarItem>(item => {
        if (item.kind === 'separator') {
          return [{ id: item.id ?? `${group.id}:separator`, kind: 'separator' as const }]
        }
        const state = manager.evaluate(item.commandId, { source: this })
        if (!state.visible) return []
        return [{
          id: item.id ?? item.commandId,
          kind: 'button' as const,
          label: item.label ?? state.title,
          icon: state.icon as IconName | undefined,
          disabled: !state.enabled,
          tooltip: this._resolveTooltip(item, state),
          showLabel: item.showLabel,
          onClick: () => {
            void manager.execute(item.commandId, { source: this, trigger: 'click' })
          },
        }]
      }),
    }))
  }

  private _resolveTooltip(item: CommandToolbarCommandItem, state: CommandState): string | undefined {
    return item.tooltip ?? state.reason ?? state.description
  }

  private _resolveCommandManager(): CommandManager | undefined {
    return this._commandManager ?? this.getAppContext(commandManagerContextKey)
  }
}
