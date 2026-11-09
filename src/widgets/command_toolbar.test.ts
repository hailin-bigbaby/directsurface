import { describe, expect, it, vi } from 'vitest'
import { AppContextRegistry } from '../core/app_context'
import { CommandManager, commandManagerContextKey } from '../core/command'
import { PipelineOwner } from '../core/render_object'
import { ImGuiLightTheme } from '../theme/default_theme'
import { RenderCommandToolbar } from './command_toolbar'

const constraints = {
  minWidth: 0,
  maxWidth: 320,
  minHeight: 0,
  maxHeight: 40,
}

describe('RenderCommandToolbar', () => {
  it('resolves command state into toolbar items', () => {
    const manager = new CommandManager({
      permissionService: {
        has: permission => permission === 'record.save',
      },
    })
    manager.register({
      id: 'record.save',
      title: '保存',
      icon: 'document',
      permission: 'record.save',
      execute: vi.fn(),
    })
    manager.register({
      id: 'record.audit',
      title: '审核',
      permission: 'record.audit',
      execute: vi.fn(),
    })
    const toolbar = new RenderCommandToolbar({
      commandManager: manager,
      groups: [{
        id: 'record',
        slot: 'leading',
        items: [
          { kind: 'command', commandId: 'record.save', showLabel: false },
          { kind: 'command', commandId: 'record.audit' },
        ],
      }],
    })

    toolbar.layout(constraints, false, { theme: ImGuiLightTheme, pass: 'layout' })

    expect(toolbar.itemRect('record.save')).not.toBeNull()
    expect(toolbar.itemRect('record.audit')).not.toBeNull()
    const save = toolbar.groups[0]!.items[0] as { label: string; icon?: string; showLabel?: boolean }
    const audit = toolbar.groups[0]!.items[1] as { disabled?: boolean; tooltip?: string }
    expect(save.label).toBe('保存')
    expect(save.icon).toBe('document')
    expect(save.showLabel).toBe(false)
    expect(audit.disabled).toBe(true)
    expect(audit.tooltip).toBe('权限不足')

    manager.dispose()
  })

  it('executes commands and refreshes state after invalidation', async () => {
    const manager = new CommandManager()
    const appContext = new AppContextRegistry(undefined, [[commandManagerContextKey, manager]])
    const owner = new PipelineOwner({ appContext }, ImGuiLightTheme)
    const execute = vi.fn()
    let dirty = true
    manager.register({
      id: 'record.save',
      title: '保存',
      canExecute: () => dirty,
      execute: () => {
        dirty = false
        execute()
        manager.invalidate()
      },
    })
    const toolbar = new RenderCommandToolbar({
      groups: [{
        id: 'record',
        slot: 'leading',
        items: [{ kind: 'command', commandId: 'record.save' }],
      }],
    })
    toolbar.attach(owner)
    toolbar.layout(constraints, false, { theme: ImGuiLightTheme, pass: 'layout' })
    const rect = toolbar.itemRect('record.save')!

    toolbar.onPointerDown({ pointerId: 1, position: { x: rect.x + 4, y: rect.y + 4 }, type: 'down' })
    toolbar.onPointerUp({ pointerId: 1, position: { x: rect.x + 4, y: rect.y + 4 }, type: 'up' })
    await new Promise(resolve => setTimeout(resolve, 0))
    toolbar.layout(constraints, false, { theme: ImGuiLightTheme, pass: 'layout' })

    expect(execute).toHaveBeenCalledTimes(1)
    expect((toolbar.groups[0]!.items[0] as { disabled?: boolean }).disabled).toBe(true)

    toolbar.dispose()
    manager.dispose()
    appContext.dispose()
  })
})

it('repaints execution state without relayout and still relayouts changed labels', async () => {
  const manager = new CommandManager()
  let finish!: () => void
  const command = { id: 'save', title: 'Save', execute: () => new Promise<void>(resolve => { finish = resolve }) }
  manager.register(command)
  const toolbar = new RenderCommandToolbar({ commandManager: manager, groups: [{ id: 'actions', slot: 'leading', items: [{ kind: 'command', commandId: 'save' }] }] })
  toolbar.attach(new PipelineOwner({}, ImGuiLightTheme))
  toolbar.layout(constraints, false, { theme: ImGuiLightTheme, pass: 'layout' })
  const rect = toolbar.itemRect('save')!
  const layout = vi.spyOn(toolbar, 'markNeedsLayout')
  const pending = manager.execute('save')
  expect((toolbar.groups[0]!.items[0] as any).disabled).toBe(true)
  expect(toolbar.itemRect('save')).toEqual(rect)
  expect((toolbar as any)._keyboardItemId).toBe('')
  expect(layout).not.toHaveBeenCalled()
  await Promise.resolve()
  finish(); await pending
  expect((toolbar.groups[0]!.items[0] as any).disabled).toBe(false)
  expect(layout).not.toHaveBeenCalled()
  expect((toolbar as any)._keyboardItemId).toBe('save')
  command.title = 'Save all documents'; manager.invalidate()
  expect(layout).toHaveBeenCalled()
  toolbar.dispose(); manager.dispose()
})
