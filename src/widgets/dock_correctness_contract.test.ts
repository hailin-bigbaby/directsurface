// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { PipelineOwner } from '../core/render_object'
import { HitTestResult } from '../gestures/hit_test'
import { RenderText } from './basic'
import {
  DockWorkbenchManager,
  RenderDockWorkbench,
  type DockItemRecord,
  type DockRegion,
  type DockRegionNode,
  type DockWorkbenchTabGroupNode,
} from './dock_workbench'
import {
  DockWindowManager,
  RenderDockWorkspace,
  type DockLayoutNode,
  type DockTabGroupNode,
} from './dock_workspace'
import { RenderWindow } from './window'
import { RenderTextBox } from './text_field'
import { RenderSplitter } from './splitter'

afterEach(() => {
  FocusManager.disposeInstance()
  InputComposer.disposeInstance()
})

describe('Dock correctness audit contracts', () => {
  it('validates baseline Workbench and Workspace ownership invariants', () => {
    const workbench = new DockWorkbenchManager()
    workbench.openDocument({ itemId: 'query', title: 'Query', content: new RenderText('query') })
    workbench.openTool({ itemId: 'tree', title: 'Tree', region: 'left', content: new RenderText('tree') })
    expect(() => assertWorkbenchInvariants(workbench)).not.toThrow()

    const workspace = new DockWindowManager()
    workspace.openDocument({ tabId: 'query', title: 'Query', content: new RenderText('query') })
    workspace.openDocument({ tabId: 'result', title: 'Result', content: new RenderText('result') })
    expect(() => assertWorkspaceInvariants(workspace)).not.toThrow()

    workbench.dispose()
    workspace.dispose()
  })

  it('DOCK-AUDIT-001 parents and interacts with floating group render roots', () => {
    const owner = new PipelineOwner()
    const manager = new DockWorkbenchManager()
    manager.openDocument({ itemId: 'a', title: 'A', content: new RenderText('A') })
    manager.openDocument({ itemId: 'b', title: 'B', content: new RenderText('B') })
    const workbench = new RenderDockWorkbench({ manager })
    workbench.attach(owner)
    workbench.layout({ minWidth: 0, maxWidth: 800, minHeight: 0, maxHeight: 600 })
    expect(manager.floatGroup(manager.regions.center as DockWorkbenchTabGroupNode)).toBe(true)
    const runtime = [...(manager as any)._floatingGroups.values()][0]
    runtime.window.attach(owner)
    runtime.window.layout({ minWidth: 0, maxWidth: 800, minHeight: 0, maxHeight: 600 })
    const groupView = [...runtime.view._groupViews.values()][0]
    const rect = groupView.tabs.tabRect('a')!
    const result = new HitTestResult()

    expect(runtime.view._rootRender.parent).toBe(runtime.view)
    expect(runtime.window.hitTestPath({ x: rect.x + 4, y: rect.y + 4 }, result)).toBe(true)
    expect(result.contains(groupView.tabs)).toBe(true)

    workbench.dispose()
    manager.dispose()
  })

  it('DOCK-AUDIT-002 preserves focused floating input descendants', () => {
    const owner = new PipelineOwner()
    const manager = new DockWorkbenchManager()
    const field = new RenderTextBox({ value: 'input' })
    manager.openDocument({ itemId: 'a', title: 'A', content: field })
    const workbench = new RenderDockWorkbench({ manager })
    workbench.attach(owner)
    workbench.layout({ minWidth: 0, maxWidth: 800, minHeight: 0, maxHeight: 600 })
    expect(manager.floatItem('a', { x: 40, y: 50, width: 420, height: 260 })).toBe(true)
    const window = manager.getDocument('a')!.window
    window.attach(owner)
    window.layout({ minWidth: 0, maxWidth: 800, minHeight: 0, maxHeight: 600 })
    FocusManager.instance.register(field)
    FocusManager.instance.setFocus(field)

    manager.activateWindow(window)

    expect(FocusManager.instance.current).toBe(field)
    expect(InputComposer.instance.hasSession).toBe(true)

    workbench.dispose()
    manager.dispose()
  })
  it('DOCK-AUDIT-003 keeps same-region dock idempotent', () => {
    const manager = new DockWorkbenchManager()
    manager.openTool({ itemId: 'a', title: 'A', region: 'right', content: new RenderText('A') })

    expect(manager.dockItem('a', 'right')).toBe(true)

    expect(manager.regions.right?.type).toBe('tabs')
    expect(workbenchGroups(manager.regions.right).flatMap(group => group.items))
      .toEqual([manager.getTool('a')!.window])
    expect(() => assertWorkbenchInvariants(manager)).not.toThrow()
    manager.dispose()
  })

  it('DOCK-AUDIT-004 preserves sibling panes during same-leaf edge dock', () => {
    const workbench = new DockWorkbenchManager()
    workbench.openTool({ itemId: 'a', title: 'A', region: 'left', content: new RenderText('A') })
    workbench.openTool({ itemId: 'b', title: 'B', region: 'left', content: new RenderText('B') })
    expect(workbench.dockItemToGroup('a', workbench.regions.left as DockWorkbenchTabGroupNode, 'left')).toBe(true)
    const workbenchTarget = workbenchGroups(workbench.regions.left)
      .find(group => group.items.includes(workbench.getTool('b')!.window))!
    expect(workbench.dockItemToGroup('b', workbenchTarget, 'left')).toBe(false)
    expect(workbenchGroups(workbench.regions.left).flatMap(group => group.items))
      .toEqual(expect.arrayContaining([workbench.getTool('a')!.window, workbench.getTool('b')!.window]))
    expect(() => assertWorkbenchInvariants(workbench)).not.toThrow()

    const workspace = new DockWindowManager()
    workspace.openDocument({ tabId: 'a', title: 'A', content: new RenderText('A') })
    workspace.openDocument({ tabId: 'b', title: 'B', content: new RenderText('B') })
    expect(workspace.dockWindow(workspace.getDocument('a')!.window, workspace.root as DockTabGroupNode, 'left')).toBe(true)
    const workspaceTarget = workspaceGroups(workspace.root)
      .find(group => group.windows.includes(workspace.getDocument('b')!.window))!
    expect(workspace.dockWindow(workspace.getDocument('b')!.window, workspaceTarget, 'left')).toBe(false)
    expect(workspaceGroups(workspace.root).flatMap(group => group.windows))
      .toEqual(expect.arrayContaining([workspace.getDocument('a')!.window, workspace.getDocument('b')!.window]))
    expect(() => assertWorkspaceInvariants(workspace)).not.toThrow()

    workbench.dispose()
    workspace.dispose()
  })

  it('DOCK-AUDIT-005 extracts one item from a floating group exactly once', () => {
    const manager = new DockWorkbenchManager()
    manager.openTool({ itemId: 'a', title: 'A', region: 'left', content: new RenderText('A') })
    manager.openTool({ itemId: 'b', title: 'B', region: 'left', content: new RenderText('B') })
    expect(manager.floatGroup(manager.regions.left as DockWorkbenchTabGroupNode)).toBe(true)

    expect(manager.floatItem('b', { x: 20, y: 30, width: 320, height: 220 })).toBe(true)

    expect(manager.floatingGroups[0]!.group.items).toEqual([manager.getTool('a')!.window])
    expect(manager.floatingWindows.filter(window => window === manager.getTool('b')!.window)).toHaveLength(1)
    expect(manager.activeItemId).toBe('b')
    expect(() => assertWorkbenchInvariants(manager)).not.toThrow()
    manager.dispose()
  })
  it('DOCK-AUDIT-006 routes workspace shortcuts from floating roots', async () => {
    const owner = new PipelineOwner()
    const manager = new DockWorkbenchManager()
    const field = new RenderTextBox({ value: 'input' })
    manager.openDocument({ itemId: 'a', title: 'A', content: field })
    const workbench = new RenderDockWorkbench({ manager })
    workbench.attach(owner)
    workbench.layout({ minWidth: 0, maxWidth: 800, minHeight: 0, maxHeight: 600 })
    manager.floatItem('a', { x: 40, y: 50, width: 420, height: 260 })
    const window = manager.getDocument('a')!.window
    window.attach(owner)
    window.layout({ minWidth: 0, maxWidth: 800, minHeight: 0, maxHeight: 600 })
    FocusManager.instance.register(field)
    FocusManager.instance.setFocus(field)
    const closeEvent = keyEvent('w', { ctrlKey: true })

    expect(FocusManager.instance.handleKeyDownEvent(closeEvent)).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(manager.hasItem('a')).toBe(false)

    workbench.dispose()
    manager.dispose()

    const workspaceManager = new DockWindowManager()
    const first = new RenderTextBox({ value: 'first' })
    const second = new RenderTextBox({ value: 'second' })
    workspaceManager.openDocument({ tabId: 'first', title: 'First', content: first })
    workspaceManager.openDocument({ tabId: 'second', title: 'Second', content: second })
    const workspace = new RenderDockWorkspace({ manager: workspaceManager })
    workspace.attach(owner)
    workspace.layout({ minWidth: 0, maxWidth: 800, minHeight: 0, maxHeight: 600 })
    workspaceManager.floatWindow(workspaceManager.getDocument('second')!.window, {
      x: 80, y: 70, width: 360, height: 240,
    })
    const secondWindow = workspaceManager.getDocument('second')!.window
    secondWindow.attach(owner)
    secondWindow.layout({ minWidth: 0, maxWidth: 800, minHeight: 0, maxHeight: 600 })
    FocusManager.instance.register(second)
    FocusManager.instance.setFocus(second)

    expect(FocusManager.instance.handleKeyDownEvent(keyEvent('Tab', { ctrlKey: true }))).toBe(true)
    expect(workspaceManager.activeTabId).toBe('first')

    workspace.dispose()
    workspaceManager.dispose()
  })
  it('DOCK-AUDIT-007 isolates pending close from dispose generations', async () => {
    const gate = deferred<boolean>()
    const content = new RenderText('A') as RenderText & {
      attachDocumentContext(): void
      detachDocumentContext(): void
    }
    let detachCalls = 0
    content.attachDocumentContext = () => {}
    content.detachDocumentContext = () => { detachCalls += 1 }
    const manager = new DockWorkbenchManager()
    manager.openDocument({ itemId: 'a', title: 'A', content, beforeClose: () => gate.promise })

    const close = manager.closeItem('a')
    manager.dispose()
    gate.resolve(true)

    await expect(close).resolves.toBe(false)
    expect(detachCalls).toBe(1)

    const workspaceGate = deferred<boolean>()
    const workspaceContent = new RenderText('A') as RenderText & {
      attachDocumentContext(): void
      detachDocumentContext(): void
    }
    let workspaceDetachCalls = 0
    workspaceContent.attachDocumentContext = () => {}
    workspaceContent.detachDocumentContext = () => { workspaceDetachCalls += 1 }
    const workspace = new DockWindowManager()
    workspace.openDocument({
      tabId: 'a', title: 'A', content: workspaceContent, beforeClose: () => workspaceGate.promise,
    })
    const workspaceClose = workspace.closeDocument('a')
    workspace.dispose()
    workspaceGate.resolve(true)

    await expect(workspaceClose).resolves.toBe(false)
    expect(workspaceDetachCalls).toBe(1)
  })

  it('DOCK-AUDIT-008 contains lifecycle hook failures atomically', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const attachFailure = new RenderText('attach') as RenderText & { attachDocumentContext(): void }
    attachFailure.attachDocumentContext = () => { throw new Error('attach failed') }
    const attachDispose = vi.spyOn(attachFailure, 'dispose')
    const manager = new DockWorkbenchManager()

    expect(() => manager.openDocument({ itemId: 'attach', title: 'Attach', content: attachFailure }))
      .toThrow('attach failed')
    expect(manager.hasItem('attach')).toBe(false)
    expect(attachDispose).toHaveBeenCalledTimes(1)

    const detachFailure = new RenderText('detach') as RenderText & {
      attachDocumentContext(): void
      detachDocumentContext(): void
      onDocumentActivated(): void
      onDocumentDeactivated(): void
    }
    detachFailure.attachDocumentContext = () => {}
    detachFailure.detachDocumentContext = () => { throw new Error('detach failed') }
    detachFailure.onDocumentActivated = () => { throw new Error('activate failed') }
    detachFailure.onDocumentDeactivated = () => { throw new Error('deactivate failed') }
    manager.openDocument({ itemId: 'detach', title: 'Detach', content: detachFailure })
    const windowDispose = vi.spyOn(manager.getDocument('detach')!.window, 'dispose')

    await expect(manager.closeItem('detach')).resolves.toBe(true)
    expect(manager.hasItem('detach')).toBe(false)
    expect(windowDispose).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledTimes(2)
    expect(() => manager.dispose()).not.toThrow()
  })

  it('DOCK-AUDIT-009 renders final state when an after-event listener throws', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const manager = new DockWorkbenchManager()
    manager.openTool({ itemId: 'a', title: 'A', region: 'left', content: new RenderText('A') })
    let renderNotifications = 0
    manager.subscribeEvent(() => { throw new Error('observer failed') })
    manager.subscribe(() => { renderNotifications += 1 })

    expect(() => manager.floatItem('a')).not.toThrow()
    expect(renderNotifications).toBe(1)
    expect(manager.getTool('a')!.placement).toEqual({ mode: 'floating' })
    expect(report).toHaveBeenCalledTimes(1)
    expect(() => manager.dispose()).not.toThrow()
  })
  it('DOCK-AUDIT-010 publishes one atomic floating-group state', () => {
    const manager = new DockWorkbenchManager()
    manager.openTool({ itemId: 'a', title: 'A', region: 'left', content: new RenderText('A') })
    manager.openTool({ itemId: 'b', title: 'B', region: 'left', content: new RenderText('B') })
    const observations: Array<{ left: boolean; floatingGroups: number; modes: string[] }> = []
    manager.subscribe(() => observations.push({
      left: manager.regions.left !== null,
      floatingGroups: manager.floatingGroups.length,
      modes: manager.tools.map(item => item.placement.mode),
    }))

    expect(manager.floatGroup(manager.regions.left as DockWorkbenchTabGroupNode)).toBe(true)

    expect(observations).toEqual([{
      left: false,
      floatingGroups: 1,
      modes: ['floating', 'floating'],
    }])
    expect(() => assertWorkbenchInvariants(manager)).not.toThrow()
    manager.dispose()
  })
  it('DOCK-AUDIT-011 isolates asynchronous command sources', async () => {
    const gate = deferred<boolean>()
    const manager = new DockWorkbenchManager()
    const events: Array<{ type: string; itemId?: string; source?: string }> = []
    manager.openDocument({ itemId: 'a', title: 'A', content: new RenderText('A'), beforeClose: () => gate.promise })
    manager.subscribeEvent(event => events.push(event))

    const closing = manager.runWithCommandSourceAsync('menu', () => manager.closeItem('a'))
    manager.openDocument({ itemId: 'b', title: 'B', content: new RenderText('B') })
    gate.resolve(true)
    await closing

    expect(events.find(event => event.type === 'item-opened' && event.itemId === 'b')?.source).toBe('api')
    expect(events.find(event => event.type === 'item-closed' && event.itemId === 'a')?.source).toBe('menu')
    manager.dispose()
  })
  it('DOCK-AUDIT-012 synchronizes floating renderer tab reorder', () => {
    const manager = new DockWorkbenchManager()
    manager.openTool({ itemId: 'a', title: 'A', region: 'left', content: new RenderText('A') })
    manager.openTool({ itemId: 'b', title: 'B', region: 'left', content: new RenderText('B') })
    manager.floatGroup(manager.regions.left as DockWorkbenchTabGroupNode)
    const runtime = [...(manager as any)._floatingGroups.values()][0]
    const view = [...runtime.view._groupViews.values()][0]

    expect(manager.moveItemInGroup(runtime.group, manager.getTool('b')!.window, 0)).toBe(true)

    expect(runtime.group.items.map((window: RenderWindow) => manager.items.find(item => item.window === window)!.itemId))
      .toEqual(['b', 'a'])
    expect(view.tabs.tabs.map((tab: { key: string }) => tab.key)).toEqual(['b', 'a'])
    manager.dispose()
  })
  it('DOCK-AUDIT-013 guards auto-hide group pin operations', () => {
    const manager = new DockWorkbenchManager()
    manager.openTool({ itemId: 'a', title: 'A', region: 'left', content: new RenderText('A') })
    manager.openTool({ itemId: 'b', title: 'B', region: 'left', content: new RenderText('B') })
    expect(manager.autoHideGroup(manager.regions.left as DockWorkbenchTabGroupNode)).toBe(true)
    const groupId = manager.autoHideGroups[0]!.id
    manager.subscribeBeforeEvent(event =>
      event.type === 'before-item-dock' || event.type === 'before-group-dock' ? false : undefined)

    expect(manager.dockAutoHideGroup(groupId, 'right')).toBe(false)
    expect(manager.autoHideGroups).toHaveLength(1)
    expect(manager.autoHideItems).toHaveLength(2)
    expect(() => assertWorkbenchInvariants(manager)).not.toThrow()
    manager.dispose()
  })

  it('DOCK-AUDIT-014 clears floating-group drag state on dispose', () => {
    const manager = new DockWorkbenchManager()
    manager.openTool({ itemId: 'a', title: 'A', region: 'left', content: new RenderText('A') })
    manager.floatGroup(manager.regions.left as DockWorkbenchTabGroupNode)
    const floating = manager.floatingGroups[0]!
    manager.beginFloatingGroupDrag(floating.window, { x: 60, y: 60 })

    manager.dispose()

    expect(manager.isDragging).toBe(false)
    expect(manager.draggingGroup).toBeNull()
  })

  it('DOCK-AUDIT-015 continues render subscribers after a state listener throws', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const manager = new DockWorkbenchManager()
    manager.openTool({ itemId: 'a', title: 'A', region: 'left', content: new RenderText('A') })
    let laterCalls = 0
    manager.subscribe(() => { throw new Error('observer failed') })
    manager.subscribe(() => { laterCalls += 1 })

    expect(() => manager.floatItem('a')).not.toThrow()
    expect(laterCalls).toBe(1)
    manager.dispose()

    const workspace = new DockWindowManager()
    workspace.openDocument({ tabId: 'a', title: 'A', content: new RenderText('A') })
    let workspaceLaterCalls = 0
    workspace.subscribe(() => { throw new Error('observer failed') })
    workspace.subscribe(() => { workspaceLaterCalls += 1 })
    expect(() => workspace.floatWindow(workspace.getDocument('a')!.window)).not.toThrow()
    expect(workspaceLaterCalls).toBe(1)
    expect(report).toHaveBeenCalledTimes(2)
    workspace.dispose()
  })
  it('DOCK-AUDIT-016 emits item-updated for duplicate open metadata changes', () => {
    const manager = new DockWorkbenchManager()
    manager.openDocument({ itemId: 'a', title: 'A', content: new RenderText('A') })
    const events: Array<{ type: string; itemId?: string }> = []
    manager.subscribeEvent(event => events.push(event))

    manager.openDocument({ itemId: 'a', title: 'A2', content: new RenderText('replacement'), dirty: true })

    expect(manager.getDocument('a')).toMatchObject({ title: 'A2', dirty: true })
    expect(events.filter(event => event.type === 'item-updated' && event.itemId === 'a')).toHaveLength(1)
    manager.dispose()
  })

  it('DOCK-AUDIT-017 synchronizes floating-group close chrome', () => {
    const manager = new DockWorkbenchManager()
    manager.openTool({
      itemId: 'a', title: 'A', region: 'left', content: new RenderText('A'), closable: false,
    })
    manager.openTool({
      itemId: 'b', title: 'B', region: 'left', content: new RenderText('B'), closable: false,
    })
    manager.floatGroup(manager.regions.left as DockWorkbenchTabGroupNode)
    const host = manager.floatingGroups[0]!.window

    expect(host.showCloseButton).toBe(false)
    expect(manager.updateItem('a', { closable: true })).toBe(true)
    expect(host.showCloseButton).toBe(true)
    expect(manager.updateItem('a', { closable: false })).toBe(true)
    expect(host.showCloseButton).toBe(false)
    manager.dispose()
  })
  it('DOCK-AUDIT-018 keeps official claims aligned with real interaction tests', () => {
    const workbenchDoc = readFileSync(resolve('docs/components/navigation/dock-workbench.md'), 'utf8')
    const workspaceDoc = readFileSync(resolve('docs/components/navigation/dock-workspace.md'), 'utf8')

    expect(workbenchDoc).toContain('### Floating 交互合同')
    expect(workbenchDoc).not.toContain('现有成熟的单一 dock tree')
    expect(workbenchDoc).toContain('InputComposer / IME')
    expect(workbenchDoc).toContain('内置 UI 操作不得')
    expect(workspaceDoc).toContain('floating document 则由其 `RenderWindow` 转发')
    expect(workspaceDoc).toContain('docked / floating 状态共享同一合同')
  })
  it('DOCK-AUDIT-019 exposes readonly state and rejects non-finite geometry', () => {
    const workbench = new DockWorkbenchManager()
    workbench.openTool({ itemId: 'a', title: 'A', region: 'left', content: new RenderText('A') })
    const state = workbench.state as any
    const left = workbench.regions.left as any
    const item = workbench.getTool('a') as any

    expect(() => { state.regions.left = null }).toThrow(TypeError)
    expect(() => { state.regionLayout.leftWidth = 12 }).toThrow(TypeError)
    expect(() => { left.items.push(item.window) }).toThrow(TypeError)
    expect(() => { item.placement.region = 'right' }).toThrow(TypeError)
    expect(() => workbench.setRegionLayout({ leftWidth: Number.NaN })).toThrow(RangeError)
    expect(() => workbench.floatItem('a', { x: Number.POSITIVE_INFINITY })).toThrow(RangeError)
    expect(() => assertWorkbenchInvariants(workbench)).not.toThrow()

    const workspace = new DockWindowManager()
    workspace.openDocument({ tabId: 'a', title: 'A', content: new RenderText('A') })
    const root = workspace.root as any
    const record = workspace.getDocument('a') as any
    expect(() => { root.windows.length = 0 }).toThrow(TypeError)
    expect(() => { record.title = 'mutated' }).toThrow(TypeError)
    expect(() => workspace.floatWindow(record.window, { width: Number.NaN })).toThrow(RangeError)
    expect(() => record.window.setWindowBounds({ y: Number.NEGATIVE_INFINITY })).toThrow(RangeError)
    expect(() => assertWorkspaceInvariants(workspace)).not.toThrow()

    workbench.dispose()
    workspace.dispose()
  })
  it('DOCK-AUDIT-020 attributes built-in Tab and Window operations', async () => {
    const manager = new DockWorkbenchManager()
    manager.openDocument({ itemId: 'a', title: 'A', content: new RenderText('A') })
    manager.openDocument({ itemId: 'b', title: 'B', content: new RenderText('B') })
    const workbench = new RenderDockWorkbench({ manager })
    const events: Array<{ type: string; itemId?: string; source?: string }> = []
    manager.subscribeEvent(event => events.push(event))
    const view = [...(workbench as any)._groupViews.values()][0]

    view.tabs.onTabChange('a')
    view.tabs.onTabClose('b')
    await Promise.resolve()
    await Promise.resolve()

    expect(events.find(event => event.type === 'item-activated' && event.itemId === 'a')?.source).toBe('button')
    expect(events.find(event => event.type === 'item-closed' && event.itemId === 'b')?.source).toBe('button')

    manager.openDocument({ itemId: 'c', title: 'C', content: new RenderText('C') })
    manager.floatItem('c')
    manager.getDocument('c')!.window.close()
    await Promise.resolve()
    await Promise.resolve()
    expect(events.find(event => event.type === 'item-closed' && event.itemId === 'c')?.source).toBe('api')

    manager.openDocument({ itemId: 'd', title: 'D', content: new RenderText('D') })
    manager.floatItem('d')
    manager.getDocument('d')!.window.close('button')
    await Promise.resolve()
    await Promise.resolve()
    expect(events.find(event => event.type === 'item-closed' && event.itemId === 'd')?.source).toBe('button')

    workbench.dispose()
    manager.dispose()
  })
  it('DOCK-AUDIT-021 disposes floating-group renderers exactly once', () => {
    const manager = new DockWorkbenchManager()
    manager.openTool({ itemId: 'a', title: 'A', region: 'left', content: new RenderText('A') })
    manager.floatGroup(manager.regions.left as DockWorkbenchTabGroupNode)
    const runtime = [...(manager as any)._floatingGroups.values()][0]
    const dispose = vi.spyOn(runtime.view, 'dispose')

    expect(manager.dockFloatingGroup(runtime.id, 'left')).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(1)
    manager.dispose()
  })

  it('DOCK-AUDIT-022 disposes pruned splitters and releases capture', () => {
    const owner = new PipelineOwner()
    const manager = new DockWorkbenchManager()
    manager.openDocument({ itemId: 'a', title: 'A', content: new RenderText('A') })
    manager.openDocument({ itemId: 'b', title: 'B', content: new RenderText('B') })
    const workbench = new RenderDockWorkbench({ manager })
    workbench.attach(owner)
    workbench.layout({ minWidth: 0, maxWidth: 800, minHeight: 0, maxHeight: 600 })
    manager.dockItemToGroup('b', manager.regions.center as DockWorkbenchTabGroupNode, 'right')
    workbench.layout({ minWidth: 0, maxWidth: 800, minHeight: 0, maxHeight: 600 })
    const splitter = [...(workbench as any)._splitViews.values()][0] as RenderSplitter
    const dispose = vi.spyOn(splitter, 'dispose')
    const groups = workbenchGroups(manager.regions.center)

    manager.dockItemToGroup('b', groups[0]!, 'center')

    expect(dispose).toHaveBeenCalledTimes(1)
    workbench.dispose()
    manager.dispose()
  })

  it('DOCK-AUDIT-023 rejects integrity-level mutations without poisoning manager state', async () => {
    const attacks: Array<(value: object) => unknown> = [
      value => Object.preventExtensions(value),
      value => Reflect.preventExtensions(value),
      value => Object.freeze(value),
      value => Object.seal(value),
    ]
    for (const attack of attacks) {
      const manager = new DockWorkbenchManager()
      manager.openDocument({ itemId: 'a', title: 'A', content: new RenderText('A') })
      expect(() => attack(manager.items as object)).toThrow(TypeError)
      expect(() => manager.openDocument({ itemId: 'b', title: 'B', content: new RenderText('B') })).not.toThrow()
      expect(manager.items.map(item => item.itemId)).toEqual(['a', 'b'])
      expect(manager.floatItem('b')).toBe(true)
      expect(manager.dockItem('b', 'center')).toBe(true)
      await expect(manager.closeItem('b')).resolves.toBe(true)
      expect(() => assertWorkbenchInvariants(manager)).not.toThrow()
      manager.dispose()
    }

    const workspace = new DockWindowManager()
    workspace.openDocument({ tabId: 'a', title: 'A', content: new RenderText('A') })
    expect(() => Object.preventExtensions(workspace.root)).toThrow(TypeError)
    expect(() => workspace.openDocument({ tabId: 'b', title: 'B', content: new RenderText('B') })).not.toThrow()
    expect(() => assertWorkspaceInvariants(workspace)).not.toThrow()
    workspace.dispose()
  })

  it('DOCK-AUDIT-024 completes close and manager disposal after resource failures', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const manager = new DockWorkbenchManager()
    const bad = new RenderText('bad')
    const later = new RenderText('later')
    vi.spyOn(bad, 'dispose').mockImplementation(() => { throw new Error('bad dispose') })
    const laterDispose = vi.spyOn(later, 'dispose')
    manager.openDocument({ itemId: 'bad', title: 'Bad', content: bad })
    manager.openDocument({ itemId: 'later', title: 'Later', content: later })
    const windows = manager.items.map(item => item.window)

    expect(() => manager.dispose()).not.toThrow()
    expect(manager.items).toHaveLength(0)
    expect(manager.floatingWindows).toHaveLength(0)
    expect(laterDispose).toHaveBeenCalledTimes(1)
    expect(windows.every(window => window.disposed)).toBe(true)
    expect(() => manager.dispose()).not.toThrow()

    const closing = new DockWorkbenchManager()
    const closeBad = new RenderText('close bad')
    vi.spyOn(closeBad, 'dispose').mockImplementation(() => { throw new Error('close dispose') })
    const events: string[] = []
    closing.subscribeEvent(event => events.push(event.type))
    closing.openDocument({ itemId: 'close', title: 'Close', content: closeBad })
    await expect(closing.closeItem('close')).resolves.toBe(true)
    expect(closing.hasItem('close')).toBe(false)
    expect(events).toContain('item-closed')
    closing.dispose()

    const workspace = new DockWindowManager()
    const workspaceBad = new RenderText('workspace bad')
    const workspaceLater = new RenderText('workspace later')
    vi.spyOn(workspaceBad, 'dispose').mockImplementation(() => { throw new Error('workspace dispose') })
    const workspaceLaterDispose = vi.spyOn(workspaceLater, 'dispose')
    workspace.openDocument({ tabId: 'bad', title: 'Bad', content: workspaceBad })
    workspace.openDocument({ tabId: 'later', title: 'Later', content: workspaceLater })
    expect(() => workspace.dispose()).not.toThrow()
    expect(workspace.documents).toHaveLength(0)
    expect(workspaceLaterDispose).toHaveBeenCalledTimes(1)
    expect(report.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('DOCK-AUDIT-025 rejects before reentry and drains after-events without recursion', async () => {
    const disposed = new DockWorkbenchManager()
    disposed.openDocument({ itemId: 'a', title: 'A', content: new RenderText('A') })
    disposed.subscribeBeforeEvent(event => {
      if (event.type === 'before-item-float') disposed.dispose()
    })
    expect(disposed.floatItem('a')).toBe(false)
    expect(disposed.items).toHaveLength(0)
    expect(disposed.floatingWindows).toHaveLength(0)

    const guarded = new DockWorkbenchManager()
    guarded.openDocument({ itemId: 'a', title: 'A', content: new RenderText('A') })
    guarded.openDocument({ itemId: 'b', title: 'B', content: new RenderText('B') })
    let nestedFloat = true
    let nestedOpenThrew = false
    let nestedClose: Promise<boolean> | undefined
    guarded.subscribeBeforeEvent(event => {
      if (event.type !== 'before-item-float' || event.itemId !== 'a') return
      nestedFloat = guarded.floatItem('b')
      try {
        guarded.openDocument({ itemId: 'nested', title: 'Nested', content: new RenderText('Nested') })
      } catch {
        nestedOpenThrew = true
      }
      nestedClose = guarded.closeItem('b')
    })
    expect(guarded.floatItem('a')).toBe(false)
    expect(nestedFloat).toBe(false)
    expect(nestedOpenThrew).toBe(true)
    await expect(nestedClose).resolves.toBe(false)
    expect(guarded.hasItem('nested')).toBe(false)
    expect(() => assertWorkbenchInvariants(guarded)).not.toThrow()
    guarded.dispose()

    const queued = new DockWorkbenchManager()
    queued.openDocument({ itemId: 'a', title: 'A', content: new RenderText('A') })
    const eventOrder: string[] = []
    let eventDepth = 0
    let maxEventDepth = 0
    queued.subscribeEvent(event => {
      eventDepth += 1
      maxEventDepth = Math.max(maxEventDepth, eventDepth)
      eventOrder.push(event.type)
      if (event.type === 'item-floated') queued.dockItem('a', 'center')
      eventDepth -= 1
    })
    expect(queued.floatItem('a')).toBe(true)
    expect(maxEventDepth).toBe(1)
    expect(eventOrder.indexOf('item-floated')).toBeLessThan(eventOrder.indexOf('item-docked'))
    expect(queued.getItem('a')?.placement.mode).toBe('docked')
    expect(() => assertWorkbenchInvariants(queued)).not.toThrow()
    queued.dispose()
  })

  it('DOCK-AUDIT-025 defers owned-window reentry until the floating commit is observable', () => {
    const host = new RenderWindow({ title: 'Host' })
    const manager = new DockWorkbenchManager()
    manager.setWindowHost(host)
    manager.openDocument({ itemId: 'a', title: 'A', content: new RenderText('A') })
    const eventOrder: string[] = []
    manager.subscribeEvent(event => eventOrder.push(event.type))
    let reentered = false
    host.onOwnedWindowsChanged(change => {
      if (reentered || !change.added.includes(manager.getItem('a')!.window)) return
      reentered = true
      manager.dockItem('a', 'center')
    })

    expect(manager.floatItem('a')).toBe(true)
    expect(reentered).toBe(true)
    expect(eventOrder.indexOf('item-floated')).toBeLessThan(eventOrder.indexOf('item-docked'))
    expect(manager.getItem('a')?.placement.mode).toBe('docked')
    expect(() => assertWorkbenchInvariants(manager)).not.toThrow()
    manager.dispose()
    host.dispose()
  })

  it('DOCK-AUDIT-025 stops the active batch after lifecycle disposal and syncs the renderer terminal state', () => {
    const manager = new DockWorkbenchManager()
    const first = new RenderText('first') as RenderText & { onDocumentDeactivated?(): void }
    manager.openDocument({ itemId: 'a', title: 'A', content: first })
    manager.openDocument({ itemId: 'b', title: 'B', content: new RenderText('second') })
    manager.activateItem('a')
    const workbench = new RenderDockWorkbench({ manager })
    const sync = vi.spyOn(workbench as any, '_syncRenderTree')
    let publicStateCalls = 0
    const events: string[] = []
    manager.subscribe(() => { publicStateCalls += 1 })
    manager.subscribeEvent(event => events.push(event.type))
    first.onDocumentDeactivated = () => manager.dispose()

    expect(manager.activateItem('b')).toBe(true)
    expect(manager.items).toHaveLength(0)
    expect(publicStateCalls).toBe(0)
    expect(events).toEqual([])
    expect(sync).toHaveBeenCalledTimes(1)
    workbench.dispose()
  })

  it('DOCK-AUDIT-026 preserves focused composition while extracting the active floating tab', () => {
    const owner = new PipelineOwner()
    const manager = new DockWorkbenchManager()
    const first = new RenderTextBox({ value: 'first' })
    const second = new RenderTextBox({ value: 'second' })
    manager.openDocument({ itemId: 'a', title: 'A', content: first })
    manager.openDocument({ itemId: 'b', title: 'B', content: second })
    const workbench = new RenderDockWorkbench({ manager })
    workbench.attach(owner)
    workbench.layout({ minWidth: 0, maxWidth: 800, minHeight: 0, maxHeight: 600 })
    expect(manager.floatGroup(manager.regions.center as DockWorkbenchTabGroupNode)).toBe(true)
    const runtime = [...(manager as any)._floatingGroups.values()][0]
    runtime.window.attach(owner)
    runtime.window.layout({ minWidth: 0, maxWidth: 800, minHeight: 0, maxHeight: 600 })
    FocusManager.instance.register(second)
    FocusManager.instance.setFocus(second)
    const input = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    input.dispatchEvent(new CompositionEvent('compositionupdate', { data: '中', bubbles: true }))

    manager.beginDrag(manager.getDocument('b')!.window, { x: 700, y: 500 })
    manager.cancelDrag(manager.getDocument('b')!.window)
    expect(FocusManager.instance.current).toBe(second)
    expect(InputComposer.instance.composing).toBe(true)
    expect(manager.floatItem('b', { x: 300, y: 180 })).toBe(true)
    expect(FocusManager.instance.current).toBe(second)
    expect(InputComposer.instance.hasSession).toBe(true)
    expect(InputComposer.instance.composing).toBe(true)
    input.value = 'second中'
    input.setSelectionRange(input.value.length, input.value.length)
    input.dispatchEvent(new CompositionEvent('compositionend', { data: '中', bubbles: true }))
    expect(second.value).toBe('second中')

    workbench.dispose()
    manager.dispose()
  })

  it('DOCK-AUDIT-027 rejects direct geometry and contains invalid drop resolvers', () => {
    const first = new RenderText('first')
    const second = new RenderText('second')
    expect(() => new RenderSplitter({ first, second, ratio: Number.NaN })).toThrow(RangeError)
    expect(() => new RenderWindow({ title: 'bad', x: Number.POSITIVE_INFINITY })).toThrow(RangeError)

    const manager = new DockWorkbenchManager()
    manager.openDocument({ itemId: 'a', title: 'A', content: new RenderText('A') })
    const record = manager.getDocument('a')!
    expect(() => manager.beginDrag(record.window, { x: Number.NaN, y: 0 })).toThrow(RangeError)
    expect(manager.dragPosition).toBeNull()

    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const target = manager.regions.center as DockWorkbenchTabGroupNode
    manager.setDropResolver(() => ({
      region: 'center',
      group: target,
      zone: 'center',
      rect: { x: Number.NaN, y: 0, width: 100, height: 100 },
    }))
    manager.beginDrag(record.window, { x: 10, y: 10 })
    manager.updateDrag({ x: 20, y: 20 })
    expect(manager.dropTarget).toBeNull()
    expect(report).toHaveBeenCalledTimes(1)
    manager.cancelDrag(record.window)

    const workspace = new DockWindowManager()
    workspace.openDocument({ tabId: 'a', title: 'A', content: new RenderText('A') })
    const workspaceRecord = workspace.getDocument('a')!
    expect(() => workspace.beginDrag(workspaceRecord.window, { x: 0, y: Number.NEGATIVE_INFINITY })).toThrow(RangeError)
    expect(workspace.dragPosition).toBeNull()
    manager.dispose()
    workspace.dispose()
  })
  it('preserves all invariants through 10,000 deterministic legal transitions', () => {
    runWorkbenchTransitions(6_000, 0x5eed1234)
    runWorkspaceTransitions(4_000, 0xd0c51234)
  })
})

function assertWorkbenchInvariants(manager: DockWorkbenchManager): void {
  const regionGroups = workbenchRegionGroups(manager)
  const floatingGroups = manager.floatingGroups.flatMap(runtime =>
    workbenchGroups(runtime.root).map(group => ({ group, runtimeId: runtime.id })))
  const registeredWindows = new Set(manager.items.map(item => item.window))

  expect(registeredWindows.size).toBe(manager.items.length)
  for (const { group } of regionGroups) assertWorkbenchGroup(group, registeredWindows)
  for (const { group } of floatingGroups) assertWorkbenchGroup(group, registeredWindows)

  for (const group of manager.autoHideGroups) {
    expect(new Set(group.itemIds).size).toBe(group.itemIds.length)
    for (const itemId of group.itemIds) {
      expect(manager.hasItem(itemId)).toBe(true)
      expect(manager.autoHideItems.find(item => item.itemId === itemId)).toMatchObject({ groupId: group.id, region: group.region })
    }
  }
  for (const item of manager.autoHideItems) {
    if (item.groupId) expect(manager.getAutoHideGroup(item.groupId)?.itemIds).toContain(item.itemId)
  }

  for (const item of manager.items) {
    const docked = regionGroups.filter(candidate => candidate.group.items.includes(item.window))
    const groupedFloating = floatingGroups.filter(candidate => candidate.group.items.includes(item.window))
    const singleFloating = manager.floatingWindows.filter(window => window === item.window)
    const autoHidden = manager.autoHideItems.filter(candidate => candidate.itemId === item.itemId)
    expect(
      docked.length + groupedFloating.length + singleFloating.length + autoHidden.length,
      `${item.itemId} must have exactly one layout owner`,
    ).toBe(1)
    assertWorkbenchPlacement(item, docked, groupedFloating.length, singleFloating.length, autoHidden)
  }
}

function assertWorkbenchPlacement(
  item: DockItemRecord,
  docked: Array<{ region: DockRegion; group: DockWorkbenchTabGroupNode }>,
  groupedFloatingCount: number,
  singleFloatingCount: number,
  autoHidden: Array<{ region: Exclude<DockRegion, 'center'> }>,
): void {
  if (item.placement.mode === 'docked') {
    expect(docked).toHaveLength(1)
    expect(docked[0]).toMatchObject({ region: item.placement.region })
    expect(docked[0]!.group.id).toBe(item.placement.groupId)
    return
  }
  if (item.placement.mode === 'autoHide') {
    expect(autoHidden).toHaveLength(1)
    expect(autoHidden[0]!.region).toBe(item.placement.region)
    return
  }
  expect(groupedFloatingCount + singleFloatingCount).toBe(1)
}

function assertWorkbenchGroup(
  group: DockWorkbenchTabGroupNode,
  registeredWindows: ReadonlySet<RenderWindow>,
): void {
  expect(new Set(group.items).size).toBe(group.items.length)
  for (const window of group.items) expect(registeredWindows.has(window)).toBe(true)
  if (group.activeItem) expect(group.items.includes(group.activeItem)).toBe(true)
}

function workbenchRegionGroups(manager: DockWorkbenchManager): Array<{
  region: DockRegion
  group: DockWorkbenchTabGroupNode
}> {
  return (['left', 'center', 'right', 'bottom'] as const).flatMap(region =>
    workbenchGroups(manager.regions[region]).map(group => ({ region, group })))
}

function workbenchGroups(node: DockRegionNode | null): DockWorkbenchTabGroupNode[] {
  if (!node) return []
  if (node.type === 'tabs') return [node]
  return [...workbenchGroups(node.first), ...workbenchGroups(node.second)]
}

function assertWorkspaceInvariants(manager: DockWindowManager): void {
  const groups = workspaceGroups(manager.root)
  const registeredWindows = new Set(manager.documents.map(record => record.window))
  expect(registeredWindows.size).toBe(manager.documents.length)
  for (const group of groups) assertWorkspaceGroup(group, registeredWindows)

  for (const record of manager.documents) {
    const dockedCount = groups.filter(group => group.windows.includes(record.window)).length
    const floatingCount = manager.floatingWindows.filter(window => window === record.window).length
    expect(dockedCount + floatingCount, `${record.tabId} must have exactly one layout owner`).toBe(1)
  }
}

function assertWorkspaceGroup(
  group: DockTabGroupNode,
  registeredWindows: ReadonlySet<RenderWindow>,
): void {
  expect(new Set(group.windows).size).toBe(group.windows.length)
  for (const window of group.windows) expect(registeredWindows.has(window)).toBe(true)
  if (group.activeWindow) expect(group.windows.includes(group.activeWindow)).toBe(true)
}

function workspaceGroups(node: DockLayoutNode): DockTabGroupNode[] {
  if (node.type === 'tabs') return [node]
  return [...workspaceGroups(node.first), ...workspaceGroups(node.second)]
}

function runWorkbenchTransitions(steps: number, seed: number): void {
  const manager = new DockWorkbenchManager()
  const random = deterministicRandom(seed)
  for (let index = 0; index < 3; index += 1) {
    manager.openDocument({ itemId: `d${index}`, title: `D${index}`, content: new RenderText(`D${index}`) })
  }
  for (let index = 0; index < 6; index += 1) {
    const region = (['left', 'right', 'bottom'] as const)[index % 3]!
    manager.openTool({ itemId: `t${index}`, title: `T${index}`, region, content: new RenderText(`T${index}`) })
  }

  try {
    for (let step = 0; step < steps; step += 1) {
      const item = pick(manager.items, random)!
      const action = Math.floor(random() * 12)
      if (action === 0) {
        manager.dockItem(item.itemId, pick(['left', 'center', 'right', 'bottom'] as const, random))
      } else if (action === 1) {
        manager.floatItem(item.itemId, {
          x: Math.floor(random() * 400),
          y: Math.floor(random() * 240),
          width: 260 + Math.floor(random() * 300),
          height: 180 + Math.floor(random() * 260),
        })
      } else if (action === 2) {
        manager.autoHideItem(item.itemId)
      } else if (action === 3) {
        manager.dockAutoHideItem(item.itemId)
      } else if (action === 4) {
        const candidate = pick(workbenchRegionGroups(manager).map(entry => entry.group)
          .filter(group => group.items.length > 0), random)
        if (candidate) manager.floatGroup(candidate)
      } else if (action === 5) {
        const floating = pick(manager.floatingGroups, random)
        if (floating) manager.dockFloatingGroup(floating.id, pick(['left', 'center', 'right', 'bottom'] as const, random))
      } else if (action === 6) {
        const targets = [
          ...workbenchRegionGroups(manager).map(entry => entry.group),
          ...manager.floatingGroups.flatMap(runtime => workbenchGroups(runtime.root)),
        ]
        const target = pick(targets, random)
        if (target) {
          manager.dockItemToGroup(
            item.itemId,
            target,
            pick(['center', 'left', 'right', 'top', 'bottom'] as const, random),
          )
        }
      } else if (action === 7) {
        const owner = [
          ...workbenchRegionGroups(manager).map(entry => entry.group),
          ...manager.floatingGroups.flatMap(runtime => workbenchGroups(runtime.root)),
        ].find(group => group.items.includes(item.window))
        if (owner) manager.moveItemInGroup(owner, item.window, Math.floor(random() * (owner.items.length + 1)))
      } else if (action === 8) {
        const hidden = pick(manager.autoHideItems, random)
        if (hidden) manager.showAutoHideItem(hidden.itemId)
        else manager.hideAutoHideItem()
      } else if (action === 9) {
        manager.setRegionLayout({
          leftWidth: 120 + Math.floor(random() * 360),
          rightWidth: 120 + Math.floor(random() * 360),
          bottomHeight: 100 + Math.floor(random() * 280),
        })
      } else if (action === 10) {
        const candidate = pick(workbenchRegionGroups(manager)
          .filter(entry => entry.region !== 'center' && entry.group.kind === 'tool')
          .map(entry => entry.group), random)
        if (candidate) manager.autoHideGroup(candidate)
      } else {
        const group = pick(manager.autoHideGroups, random)
        if (group) manager.dockAutoHideGroup(group.id, pick(['left', 'right', 'bottom'] as const, random))
      }
      assertWorkbenchInvariants(manager)
    }
  } finally {
    manager.dispose()
  }
}

function runWorkspaceTransitions(steps: number, seed: number): void {
  const manager = new DockWindowManager()
  const random = deterministicRandom(seed)
  for (let index = 0; index < 6; index += 1) {
    manager.openDocument({ tabId: `d${index}`, title: `D${index}`, content: new RenderText(`D${index}`) })
  }

  try {
    for (let step = 0; step < steps; step += 1) {
      const record = pick(manager.documents, random)!
      const action = Math.floor(random() * 6)
      if (action === 0) {
        const target = pick(workspaceGroups(manager.root), random)!
        manager.dockWindow(
          record.window,
          target,
          pick(['center', 'left', 'right', 'top', 'bottom'] as const, random),
        )
      } else if (action === 1) {
        manager.dockWindowToWorkspace(
          record.window,
          pick(['left', 'right', 'top', 'bottom'] as const, random)!,
        )
      } else if (action === 2) {
        manager.floatWindow(record.window, {
          x: Math.floor(random() * 420),
          y: Math.floor(random() * 260),
          width: 260 + Math.floor(random() * 280),
          height: 180 + Math.floor(random() * 240),
        })
      } else if (action === 3) {
        manager.moveDocument(record.tabId, Math.floor(random() * manager.documents.length))
      } else if (action === 4) {
        manager.activateDocument(record.tabId)
      } else {
        manager.activateRelativeDocument(random() < 0.5 ? -1 : 1)
      }
      assertWorkspaceInvariants(manager)
    }
  } finally {
    manager.dispose()
  }
}

function deterministicRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

function pick<T>(values: readonly T[], random: () => number): T | undefined {
  if (values.length === 0) return undefined
  return values[Math.floor(random() * values.length)]
}

function keyEvent(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, cancelable: true, ...init })
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}
