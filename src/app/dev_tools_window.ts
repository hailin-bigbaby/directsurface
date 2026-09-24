import { RenderGridPanel, gridAuto, gridFr } from '../layout/render_grid_panel'
import type { RenderBox } from '../layout/render_box'
import { RenderTabs } from '../widgets/tabs'
import { RenderWindow } from '../widgets/window'
import {
  RenderLayoutInspectorView,
  type LayoutInspectorPanelDebugState,
  type LayoutInspectorRuntimeDebugState,
  type RenderLayoutInspectorPanelOptions,
} from './layout_inspector_panel'
import { RenderObjectInspector } from '../widgets/object_inspector'
import {
  RenderRuntimeDiagnosticsView,
  type RenderRuntimeDiagnosticsPanelOptions,
  type RuntimeDiagnosticsPanelDebugState,
  type RuntimeDiagnosticsState,
} from './runtime_diagnostics_panel'
import type { LayoutInspectorDebugState } from '../runtime/layout_inspector_service'
import type { IconName } from '../widgets/icon'

export type DevToolsBuiltinTabKey = 'layout-inspector' | 'runtime'
export type DevToolsTabKey = DevToolsBuiltinTabKey | (string & {})

export interface RenderDevToolsExtraTab {
  key: string
  label: string
  icon?: IconName
  content: RenderBox
}

export interface RenderDevToolsWindowOptions {
  activeTab?: DevToolsTabKey
  layoutInspector?: RenderLayoutInspectorPanelOptions
  runtimeDiagnostics: RenderRuntimeDiagnosticsPanelOptions
  extraTabs?: RenderDevToolsExtraTab[]
}

export interface DevToolsWindowDebugState {
  activeTab: DevToolsTabKey
  tabs: string[]
  layoutInspector: LayoutInspectorPanelDebugState
  runtimeDiagnostics: RuntimeDiagnosticsPanelDebugState
}

export class RenderDevToolsWindow extends RenderWindow {
  static override debugTypeName = 'RenderDevToolsWindow'
  private readonly _content = new RenderGridPanel({
    columns: [gridFr()],
    rows: [gridAuto(), gridFr()],
    rowGap: 0,
  })
  private readonly _tabs: RenderTabs
  private readonly _layoutInspectorView: RenderLayoutInspectorView
  private readonly _runtimeDiagnosticsView: RenderRuntimeDiagnosticsView
  private _extraTabs: RenderDevToolsExtraTab[]
  private _activeTab: DevToolsTabKey

  constructor(options: RenderDevToolsWindowOptions) {
    super({
      title: 'DevTools',
      x: 64,
      y: 64,
      width: 920,
      height: 620,
      minWidth: 620,
      minHeight: 420,
      contentPadding: 0,
      contentSpacing: 0,
    })
    this._extraTabs = normalizeExtraTabs(options.extraTabs)
    this._activeTab = this._hasTab(options.activeTab ?? 'layout-inspector')
      ? options.activeTab ?? 'layout-inspector'
      : 'layout-inspector'
    this._tabs = new RenderTabs({
      tabs: this._tabItems(),
      activeKey: this._activeTab,
      onTabChange: key => this.activateTab(key as DevToolsTabKey),
    })
    this._layoutInspectorView = new RenderLayoutInspectorView(options.layoutInspector)
    this._layoutInspectorView.setWindowHost(this)
    this._runtimeDiagnosticsView = new RenderRuntimeDiagnosticsView(options.runtimeDiagnostics)
    this.setChildren([this._content])
    this._syncContent()
  }

  get activeTab(): DevToolsTabKey {
    return this._activeTab
  }

  activateTab(tabKey: DevToolsTabKey): void {
    if (!this._hasTab(tabKey) || this._activeTab === tabKey) return
    this._activeTab = tabKey
    this._tabs.activeKey = tabKey
    this._syncContent()
  }

  setExtraTabs(tabs: RenderDevToolsExtraTab[]): void {
    const nextTabs = normalizeExtraTabs(tabs)
    const nextContent = new Set(nextTabs.map(tab => tab.content))
    const removedContent = this._extraTabs
      .map(tab => tab.content)
      .filter(content => !nextContent.has(content))
    this._extraTabs = nextTabs
    if (!this._hasTab(this._activeTab)) this._activeTab = 'layout-inspector'
    this._tabs.tabs = this._tabItems()
    this._tabs.activeKey = this._activeTab
    this._tabs.markNeedsLayout()
    this._tabs.markNeedsPaint()
    this._syncContent()
    for (const content of removedContent) {
      disposeDevToolsContent(content, 'removed custom tab')
    }
  }

  setLayoutInspectorState(state: LayoutInspectorDebugState): void {
    this._layoutInspectorView.setInspectorState(state)
  }

  setInspectorState(state: LayoutInspectorDebugState): void {
    this.setLayoutInspectorState(state)
  }

  setLayoutRuntimeDebugState(state: LayoutInspectorRuntimeDebugState | null): void {
    this._layoutInspectorView.setRuntimeDebugState(state)
  }

  setRuntimeDebugState(state: LayoutInspectorRuntimeDebugState | null): void {
    this.setLayoutRuntimeDebugState(state)
  }

  setRuntimeDiagnosticsState(state: RuntimeDiagnosticsState): void {
    this._runtimeDiagnosticsView.setDiagnosticsState(state)
  }

  debugState(): LayoutInspectorPanelDebugState {
    return this.debugLayoutInspectorState()
  }

  debugLayoutInspectorState(): LayoutInspectorPanelDebugState {
    return this._layoutInspectorView.debugState()
  }

  debugRuntimeDiagnosticsState(): RuntimeDiagnosticsPanelDebugState {
    return this._runtimeDiagnosticsView.debugState()
  }

  debugObjectInspector(): RenderObjectInspector {
    return this._layoutInspectorView.debugObjectInspector()
  }

  debugAppContextInspector(): RenderObjectInspector {
    return this._layoutInspectorView.debugAppContextInspector()
  }

  debugTreeView(): ReturnType<RenderLayoutInspectorView['debugTreeView']> {
    return this._layoutInspectorView.debugTreeView()
  }

  debugLayoutInspectorView(): RenderLayoutInspectorView {
    return this._layoutInspectorView
  }

  debugRuntimeDiagnosticsView(): RenderRuntimeDiagnosticsView {
    return this._runtimeDiagnosticsView
  }

  debugDevToolsState(): DevToolsWindowDebugState {
    return {
      activeTab: this._activeTab,
      tabs: this._tabItems().map(tab => tab.key),
      layoutInspector: this.debugLayoutInspectorState(),
      runtimeDiagnostics: this.debugRuntimeDiagnosticsState(),
    }
  }

  override dispose(): void {
    if (this.disposed) return
    const contents = [...new Set(this._tabContents())]
    this._content.clearChildren()
    disposeDevToolsContent(this._tabs, 'tab strip')
    for (const content of contents) disposeDevToolsContent(content, 'tab content')
    super.dispose()
  }

  private _syncContent(): void {
    this._content.clearChildren()
    this._content.addChild(this._tabs, { row: 0, column: 0 })
    this._content.addChild(this._contentForTab(this._activeTab), { row: 1, column: 0 })
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  private _contentForTab(tabKey: DevToolsTabKey): RenderBox {
    if (tabKey === 'runtime') return this._runtimeDiagnosticsView
    const extraTab = this._extraTabs.find(tab => tab.key === tabKey)
    if (extraTab) return extraTab.content
    return this._layoutInspectorView
  }

  private _tabContents(): RenderBox[] {
    return [
      this._layoutInspectorView,
      this._runtimeDiagnosticsView,
      ...this._extraTabs.map(tab => tab.content),
    ]
  }

  private _hasTab(tabKey: DevToolsTabKey): boolean {
    return tabKey === 'layout-inspector' ||
      tabKey === 'runtime' ||
      this._extraTabs.some(tab => tab.key === tabKey)
  }

  private _tabItems() {
    return [
      ...builtinDevToolsTabs(),
      ...this._extraTabs.map(tab => ({
        key: tab.key,
        label: tab.label,
        icon: tab.icon,
      })),
    ]
  }
}

function builtinDevToolsTabs() {
  return [
    { key: 'layout-inspector', label: 'Layout', icon: 'search' as const },
    { key: 'runtime', label: 'Runtime', icon: 'server' as const },
  ]
}

function normalizeExtraTabs(tabs: RenderDevToolsExtraTab[] = []): RenderDevToolsExtraTab[] {
  const usedKeys = new Set<string>(['layout-inspector', 'runtime'])
  const usedContent = new Set<RenderBox>()
  const normalized: RenderDevToolsExtraTab[] = []
  for (const tab of tabs) {
    const key = tab.key.trim()
    if (!key) throw new Error('RenderDevToolsWindow extra tab key cannot be empty.')
    if (usedKeys.has(key)) {
      throw new Error(`RenderDevToolsWindow extra tab key "${key}" is already used.`)
    }
    if (usedContent.has(tab.content)) {
      throw new Error(`RenderDevToolsWindow extra tab "${key}" reused another tab's content.`)
    }
    usedKeys.add(key)
    usedContent.add(tab.content)
    normalized.push({ ...tab, key })
  }
  return normalized
}

function disposeDevToolsContent(content: RenderBox, role: string): void {
  try {
    content.dispose()
  } catch (error) {
    console.error(`RenderDevToolsWindow failed to dispose ${role}.`, error)
  }
}
