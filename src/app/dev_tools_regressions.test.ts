// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RenderDevToolsWindow } from './dev_tools_window'
import { RenderLayoutInspectorView } from './layout_inspector_panel'
import { LayoutInspectorService, type LayoutInspectorDebugState } from '../runtime/layout_inspector_service'
import { RenderObject, PipelineOwner, type RenderDebugInfo } from '../core/render_object'
import { AppContextRegistry } from '../core/app_context'
import { EventDispatcher } from '../gestures/recognizers'
import { FocusManager } from '../core/focus_manager'
import { RenderRuntimeDiagnosticsView } from './runtime_diagnostics_panel'
import { RenderTabs } from '../widgets/tabs'
import { RenderButton } from '../widgets/button'

class Node extends RenderObject {
  children: Node[] = []
  constructor() { super(); this.size = { width: 100, height: 100 } }
  visitChildren(visitor: (child: RenderObject) => void) { this.children.forEach(visitor) }
  performLayout() {}
  performPaint() {}
}
const info = (id: number): RenderDebugInfo => ({ debugId: id, typeName: `Node${id}`, visible: true,
  offset: { x: 0, y: 0 }, globalOffset: { x: 0, y: 0 }, size: { width: 100, height: 100 }, needsLayout: false, needsPaint: false })
const root = info(1), branch = info(2), leaf = info(3)
const tree = { info: root, children: [{ info: branch, children: [{ info: leaf, children: [] }] }] }
const state = (path: RenderDebugInfo[]): LayoutInspectorDebugState => ({ enabled: true, overlayVisible: false, hoverPathLength: 0, selectedPathLength: path.length,
  selectedPathIndex: path.length - 1, hoverPathInfo: [], selectedPathInfo: path, selected: path.at(-1), renderTree: tree })
const constraints = (width: number) => ({ minWidth: 0, maxWidth: width, minHeight: 0, maxHeight: 600 })
afterEach(() => { FocusManager.disposeInstance(); vi.restoreAllMocks() })

function deepState(depth = 30): LayoutInspectorDebugState {
  const path = Array.from({ length: depth + 1 }, (_, index) => info(index + 1))
  let renderTree = { info: path[depth]!, children: [] } as NonNullable<LayoutInspectorDebugState['renderTree']>
  for (let index = depth - 1; index >= 0; index--) renderTree = { info: path[index]!, children: [renderTree] }
  return { ...state(path), renderTree }
}

describe('DevTools data consistency', () => {
  it('opens newly selected ancestors without replacing the cached topology', () => {
    const view = new RenderLayoutInspectorView()
    view.setInspectorState(state([root]))
    view.setInspectorState(state([root, branch, leaf]))
    view.debugTreeView().layout(constraints(300))
    expect(view.debugTreeView().selectedKey).toBe('render-3')
    expect(view.debugTreeView().nodeRect('render-3')).toBeDefined()
    view.dispose()
  })

  it('reveals deep nodes only after first layout and after hidden Layout pages become visible', () => {
    const view = new RenderLayoutInspectorView()
    view.setInspectorState(deepState())
    expect(view.debugTreeView().debugState().scrollX).toBe(0)
    view.layout(constraints(360))
    expect(view.debugTreeView().debugState().scrollX).toBeGreaterThan(0)
    expect(view.debugTreeView().nodeRect('render-31')).toBeDefined()
    view.dispose()

    const window = new RenderDevToolsWindow({ activeTab: 'runtime', runtimeDiagnostics: { state: { paintRequestDebugEnabled: false, paintRequests: [] } } })
    window.windowWidth = 360; window.windowHeight = 600
    window.setLayoutInspectorState(deepState())
    window.layout(constraints(360))
    window.activateTab('layout-inspector')
    window.layout(constraints(360))
    expect(window.debugTreeView().debugState().scrollX).toBeGreaterThan(0)
    expect(window.debugTreeView().nodeRect('render-31')).toBeDefined()
    // A previously laid-out hidden page must not consume a reveal using its old width.
    window.windowWidth = 920; window.layout(constraints(920))
    window.activateTab('runtime'); window.layout(constraints(920))
    window.windowWidth = 360
    window.setLayoutInspectorState(deepState(35))
    window.activateTab('layout-inspector'); window.layout(constraints(360))
    const revealedX = window.debugTreeView().debugState().scrollX
    window.debugTreeView().revealSelectedKey()
    expect(window.debugTreeView().debugState().scrollX).toBe(revealedX)
    expect(window.debugTreeView().nodeRect('render-36')).toBeDefined()
    window.dispose()
  })

  it('requeues reveal after a structure change even if the selected key is unchanged', () => {
    const view = new RenderLayoutInspectorView()
    const before = deepState(1)
    before.selected = info(31)
    before.selectedPathInfo[1] = before.selected
    before.renderTree!.children[0]!.info = before.selected
    view.setInspectorState(before)
    view.layout(constraints(360))
    expect(view.debugTreeView().selectedKey).toBe('render-31')
    expect(view.debugTreeView().debugState().scrollX).toBe(0)
    view.setInspectorState(deepState())
    expect(view.debugTreeView().needsLayout).toBe(true)
    view.layout(constraints(360))
    expect(view.debugTreeView().selectedKey).toBe('render-31')
    expect(view.debugTreeView().debugState().scrollX).toBeGreaterThan(0)
    view.dispose()
  })

  it('preserves valid manual expansion on structural changes and prunes removed keys', () => {
    const view = new RenderLayoutInspectorView(); view.setInspectorState(state([root]))
    view.debugTreeView().expandedKeys = ['render-1', 'render-2', 'removed']
    const updated = { ...state([root]), renderTree: { ...tree, children: [...tree.children, { info: info(4), children: [] }] } }
    view.setInspectorState(updated)
    expect(view.debugTreeView().expandedKeys).toEqual(['render-1', 'render-2'])
    view.debugTreeView().expandedKeys = []
    view.setInspectorState({ ...updated, hoverPathLength: 1 })
    expect(view.debugTreeView().expandedKeys).toEqual([])
    view.dispose()
  })

  it('refreshes both object and context inspectors when a registry update has the same preview', () => {
    const value = { prefix: 'x'.repeat(500), version: 1 }
    const context = new AppContextRegistry(undefined, { value })
    const node = new Node(); node.attach(new PipelineOwner({ appContext: context }))
    const dispatcher = new EventDispatcher(document.createElement('canvas')); dispatcher.addRoot(node)
    const service = new LayoutInspectorService(dispatcher, () => {}); service.inspectAt({ x: 5, y: 5 })
    const view = new RenderLayoutInspectorView(); const before = service.debugState(); view.setInspectorState(before)
    context.set('value', { prefix: 'x'.repeat(500), version: 2 })
    const after = service.debugState(); view.setInspectorState(after)
    expect(after.selectedAppContext![0]!.value).toBe(before.selectedAppContext![0]!.value)
    expect((view.debugAppContextInspector().value as any).byKey.value.value.version).toBe(2)
    expect((view.debugObjectInspector().value as any).appContext[0].rawValue.version).toBe(2)
    const update = vi.spyOn(view.debugAppContextInspector(), 'setValue')
    const layoutRequest = vi.spyOn(view, 'markNeedsLayout')
    view.setInspectorState(service.debugState())
    expect(update).not.toHaveBeenCalled()
    expect(layoutRequest).not.toHaveBeenCalled()
    const reused = context.get('value') as typeof value
    reused.version = 3; context.set('value', reused)
    view.setInspectorState(service.debugState())
    expect(update).toHaveBeenCalledOnce()
    view.dispose(); dispatcher.dispose(); node.dispose()
  })

  it('detects raw identity changes when a manually supplied state has no revision', () => {
    const view = new RenderLayoutInspectorView()
    view.setInspectorState({ ...state([root]), selectedAppContext: [{ key: 'x', source: 'root', value: 'same preview', rawValue: { version: 1 } }] })
    view.setInspectorState({ ...state([root]), selectedAppContext: [{ key: 'x', source: 'root', value: 'same preview', rawValue: { version: 2 } }] })
    expect((view.debugAppContextInspector().value as any).byKey.x.value.version).toBe(2)
    view.dispose()
  })

  it('keeps structure identity but reads fresh size, offset and visibility without traversing children', () => {
    const node = new Node(); const dispatcher = new EventDispatcher(document.createElement('canvas')); dispatcher.addRoot(node)
    const service = new LayoutInspectorService(dispatcher, () => {}); service.inspectAt({ x: 5, y: 5 })
    const first = service.debugState().renderTree!
    const visit = vi.spyOn(node, 'visitChildren')
    node.size = { width: 220, height: 170 }; node.offset = { x: 15, y: 20 }
    visit.mockClear()
    const next = service.debugState()
    expect(next.renderTree).toBe(first)
    expect(next.renderTree!.info.size).toEqual(next.selected!.size)
    expect(next.renderTree!.info.globalOffset).toEqual({ x: 15, y: 20 })
    expect(visit).not.toHaveBeenCalled()
    dispatcher.dispose(); node.dispose()
  })
})

describe('DevTools adaptive panes', () => {
  it('keeps primary actions accessible at the minimum 360 by 420 window size', () => {
    const window = new RenderDevToolsWindow({ activeTab: 'runtime', runtimeDiagnostics: { state: { paintRequestDebugEnabled: false, paintRequests: [] } } })
    window.windowX = window.windowY = 0
    window.windowWidth = 360; window.windowHeight = 420
    window.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 420 })
    const buttons: RenderButton[] = []
    const visit = (node: RenderObject) => {
      if (!node.visible) return
      if (node instanceof RenderButton) buttons.push(node)
      node.visitChildren(visit)
    }
    visit(window)
    for (const button of buttons) {
      expect(button.globalOffset.x + button.size.width).toBeLessThanOrEqual(360)
      expect(button.globalOffset.y + button.size.height).toBeLessThanOrEqual(420)
    }
    expect(window.debugRuntimeDiagnosticsView().debugRequestList().size.height).toBeGreaterThan(40)
    window.dispose()
  })

  it.each([360, 520, 920])('uses a readable initial Layout split at width %s', width => {
    const view = new RenderLayoutInspectorView()
    view.layout(constraints(width))
    const layout = view.debugDockManager().root
    expect(layout.type).toBe('split')
    if (layout.type !== 'split') throw new Error('missing split')
    expect(layout.direction).toBe(width < 760 ? 'vertical' : 'horizontal')
    const originalRoot = view.debugDockManager().root
    view.layout(constraints(width < 760 ? 920 : 360))
    expect(view.debugDockManager().root).toBe(originalRoot)
    expect(layout.direction).toBe(width < 760 ? 'horizontal' : 'vertical')
    view.debugDockManager().setSplitLayout(layout, { ratio: 0.6 })
    const manualDirection = layout.direction
    view.layout(constraints(width))
    expect(layout.direction).toBe(manualDirection)
    expect(layout.ratio).toBe(0.6)
    view.dispose()
  })

  it.each([false, true])('stops automatic layout after a cross-group move (restore before layout: %s)', restore => {
    const view = new RenderLayoutInspectorView(); view.layout(constraints(520))
    const manager = view.debugDockManager()
    const root = manager.root
    if (root.type !== 'split' || root.first.type !== 'tabs' || root.second.type !== 'tabs') throw new Error('expected split')
    const record = manager.getDocument('app-context')!
    const originalIndex = root.first.windows.indexOf(record.window)
    expect(manager.dockWindow(record.window, root.second, 'center')).toBe(true)
    expect(manager.root).toBe(root)
    if (restore) {
      manager.dockWindow(record.window, root.first, 'center')
      manager.moveDocument('app-context', originalIndex)
    }
    view.layout(constraints(920))
    expect(root.direction).toBe('vertical')
    manager.dockWindow(record.window, root.first, 'center')
    view.layout(constraints(520)); view.layout(constraints(920))
    expect(root.direction).toBe('vertical')
    view.dispose()
  })

  it('stops automatic layout for a tab reorder but preserves it for activation and caption changes', () => {
    const view = new RenderLayoutInspectorView(); view.layout(constraints(520))
    const manager = view.debugDockManager()
    const root = manager.root
    if (root.type !== 'split') throw new Error('expected split')
    manager.activateDocument('app-context')
    manager.updateDocument('app-context', { title: 'Application Context' })
    view.layout(constraints(920))
    expect(root.direction).toBe('horizontal')
    expect(manager.moveDocument('app-context', 0)).toBe(true)
    view.layout(constraints(520))
    expect(root.direction).toBe('horizontal')
    view.dispose()
  })

  it.each([360, 520, 920])('keeps Runtime controls within the viewport and preserves detail selection at width %s', width => {
    const view = new RenderRuntimeDiagnosticsView({ state: { paintRequestDebugEnabled: false, paintRequests: [] } })
    view.layout(constraints(width))
    const nodes: RenderObject[] = []
    const visit = (node: RenderObject) => { nodes.push(node); node.visitChildren(visit) }
    visit(view)
    for (const node of nodes.filter(node => node instanceof RenderButton)) {
      expect(node.globalOffset.x).toBeGreaterThanOrEqual(0)
      expect(node.globalOffset.x + node.size.width).toBeLessThanOrEqual(width + 0.01)
    }
    expect(view.debugState().compact).toBe(width < 760)
    if (width < 760) {
      const tabs = nodes.find(node => node instanceof RenderTabs) as RenderTabs
      tabs.onTabChange?.('detail')
      view.layout(constraints(width))
      expect(view.debugRequestList().visible).toBe(false)
      expect(view.debugDetailInspector().parent!.visible).toBe(true)
      expect(view.debugDetailInspector().parent!.size.height).toBeGreaterThan(100)
      view.measure(constraints(920))
      expect(view.debugState().compact).toBe(true)
    }
    view.dispose()
  })
})
