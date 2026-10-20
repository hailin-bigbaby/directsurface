import { RenderGridPanel, gridAuto, gridFr } from '../layout/render_grid_panel'
import type { BoxConstraints, LayoutContext } from '../core/render_object'
import { RenderStackPanel } from '../layout/render_flex'
import { RenderParagraph, RenderText } from '../widgets/basic'
import { RenderButton } from '../widgets/button'
import {
  DockWindowManager,
  RenderDockWorkspace,
  type DockSplitNode,
  type DockLayoutNode,
} from '../widgets/dock_workspace'
import { RenderObjectInspector } from '../widgets/object_inspector'
import { RenderScrollViewer } from '../widgets/scroll_view'
import { RenderTreeView, type TreeNode } from '../widgets/tree'
import { RenderWindow } from '../widgets/window'
import type { LayoutInspectorDebugState, LayoutInspectorTreeNode } from '../runtime/layout_inspector_service'
import type { RuntimePaintRequestRecord } from '../runtime/runtime_host'

const INSPECTOR_CONTEXT_TREE_HEIGHT = 180
const INSPECTOR_OBJECT_TREE_HEIGHT = 220

export interface LayoutInspectorPanelDebugState {
  selectedTypeName: string
  selectedPathLength: number
  selectedPathIndex: number
  detailsText: string
  hitPathText: string
  appContextText: string
  appContextInspectorRoots: string[]
  objectInspectorRoots: string[]
  paintRequestText: string
  paintRequestCount: number
  treeNodeLabels: string[]
  overlayVisible: boolean
}

export interface LayoutInspectorRuntimeDebugState {
  paintRequestDebugEnabled: boolean
  paintRequests: RuntimePaintRequestRecord[]
}

export interface RenderLayoutInspectorPanelOptions {
  onSelectTreeNode?: (debugId: number) => void
  onToggleOverlay?: () => LayoutInspectorDebugState | void
}

export class RenderLayoutInspectorView extends RenderStackPanel {
  static override debugTypeName = 'RenderLayoutInspectorView'
  private readonly _dockManager = new DockWindowManager()
  private readonly _dockWorkspace = new RenderDockWorkspace({
    manager: this._dockManager,
    disposeManagerOnDispose: true,
  })
  private readonly _summary = new RenderText('No selection', { role: 'secondary', weight: 'semibold', overflow: 'ellipsis' })
  private readonly _details = new RenderParagraph('')
  private readonly _pathText = new RenderParagraph('')
  private readonly _contextText = new RenderParagraph('')
  private readonly _requestText = new RenderParagraph('')
  private readonly _appContextInspector = new RenderObjectInspector({
    value: createAppContextInspectorValue(emptyInspectorState()),
    label: 'layoutInspector.appContext',
    treeHeight: INSPECTOR_CONTEXT_TREE_HEIGHT,
    includePrototype: false,
  })
  private readonly _objectInspector = new RenderObjectInspector({
    value: createSelectedInspectorValue(emptyInspectorState()),
    label: 'layoutInspector.selected',
    treeHeight: INSPECTOR_OBJECT_TREE_HEIGHT,
    includePrototype: false,
  })
  private readonly _objectInspectorBox = new RenderScrollViewer({
    direction: 'vertical',
    child: this._objectInspector,
  })
  private readonly _pathTextBox = new RenderScrollViewer({
    direction: 'vertical',
    child: this._pathText,
  })
  private readonly _treeView: RenderTreeView<InspectorTreeData>
  private readonly _detailsBox = new RenderScrollViewer({
    direction: 'vertical',
    child: this._details,
  })
  private readonly _contextInspectorBox = new RenderScrollViewer({
    direction: 'vertical',
    child: this._appContextInspector,
  })
  private readonly _requestTextBox = new RenderScrollViewer({
    direction: 'vertical',
    child: this._requestText,
  })
  private readonly _toolbar = new RenderGridPanel({ columns: [gridAuto(), gridFr()], rows: [gridAuto()], columnGap: 8 })
  private readonly _inspectButton: RenderButton
  private readonly _onSelectTreeNode?: (debugId: number) => void
  private readonly _onToggleOverlay?: () => LayoutInspectorDebugState | void
  private _state: LayoutInspectorDebugState | null = null
  private _runtimeDebugState: LayoutInspectorRuntimeDebugState | null = null
  private _runtimeDebugSignature = ''
  private _appContextEntries: NonNullable<LayoutInspectorDebugState['selectedAppContext']> = []
  private _appContextRevision?: string
  private _appContextInspectorSignature = ''
  private _objectInspectorSignature = ''
  private _renderTreeRef?: LayoutInspectorTreeNode
  private _treeSignature = ''
  private _selectedTreeKey = ''
  private _initialDockLayoutApplied = false
  private _automaticSplit?: { node: DockSplitNode; ratio: number; direction: 'vertical' | 'horizontal'; structure: string }
  private readonly _unsubscribeDockChanges: () => void

  constructor(options: RenderLayoutInspectorPanelOptions = {}) {
    super({
      orientation: 'vertical',
      spacing: 8,
      padding: 8,
      crossAxisAlignment: 'stretch',
    })
    this._onSelectTreeNode = options.onSelectTreeNode
    this._onToggleOverlay = options.onToggleOverlay
    this._inspectButton = new RenderButton({
      label: 'Inspect',
      onClick: () => {
        const state = this._onToggleOverlay?.()
        if (state) this.setInspectorState(state)
      },
    })
    this._treeView = new RenderTreeView<InspectorTreeData>({
      roots: [],
      onSelect: node => this._onSelectTreeNode?.(node.data!.debugId),
    })
    this._initializeDockWorkspace()
    this._unsubscribeDockChanges = this._dockManager.subscribe(() => {
      if (this._automaticSplit && !this._matchesAutomaticSplit()) this._automaticSplit = undefined
    })
    this._toolbar.addChild(this._inspectButton, { row: 0, column: 0 })
    this._toolbar.addChild(this._summary, { row: 0, column: 1 })
    this._summary.verticalAlignment = 'center'
    this.addChild(this._toolbar)
    this.addChild(this._dockWorkspace, 1)
    this.setInspectorState(emptyInspectorState())
  }

  setWindowHost(host?: RenderWindow): void {
    this._dockManager.setWindowHost(host)
  }

  setInspectorState(state: LayoutInspectorDebugState): void {
    this._state = state
    const selected = state.selected
    this._summary.text = selected
      ? `${selected.typeName} #${selected.debugId}`
      : 'No selection'
    const inspectLabel = state.overlayVisible ? 'Stop Inspect' : 'Inspect'
    if (this._inspectButton.label !== inspectLabel) {
      this._inspectButton.label = inspectLabel
      this._inspectButton.markNeedsLayout()
      this._inspectButton.markNeedsPaint()
    }
    this._details.text = formatInspectorSummary(state)
    this._pathText.text = formatHitPath(state)
    this._contextText.text = formatAppContext(state)
    const appContextInspectorSignature = formatAppContextInspectorSignature(state)
    const contextEntries = state.selectedAppContext ?? []
    const contextChanged = appContextInspectorSignature !== this._appContextInspectorSignature ||
      state.selectedAppContextRevision !== this._appContextRevision ||
      contextEntries.length !== this._appContextEntries.length ||
      contextEntries.some((entry, index) => !Object.is(entry.rawValue, this._appContextEntries[index]?.rawValue))
    if (contextChanged) {
      this._appContextEntries = contextEntries.map(entry => ({ ...entry }))
      this._appContextRevision = state.selectedAppContextRevision
      this._appContextInspectorSignature = appContextInspectorSignature
      this._appContextInspector.setValue(createAppContextInspectorValue(state), 'layoutInspector.appContext')
    }
    const objectInspectorSignature = formatObjectInspectorSignature(state)
    if (contextChanged || objectInspectorSignature !== this._objectInspectorSignature) {
      this._objectInspectorSignature = objectInspectorSignature
      this._objectInspector.setValue(createSelectedInspectorValue(state), 'layoutInspector.selected')
    }
    this._syncTreeView(state)
  }

  setRuntimeDebugState(state: LayoutInspectorRuntimeDebugState | null): void {
    const runtimeDebugSignature = formatRuntimeDebugSignature(state)
    if (runtimeDebugSignature === this._runtimeDebugSignature) return
    this._runtimeDebugSignature = runtimeDebugSignature
    this._runtimeDebugState = state
    this._requestText.text = formatPaintRequests(state)
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  debugState(): LayoutInspectorPanelDebugState {
    return {
      selectedTypeName: this._state?.selected?.typeName ?? '',
      selectedPathLength: this._state?.selectedPathLength ?? 0,
      selectedPathIndex: this._state?.selectedPathIndex ?? -1,
      detailsText: this._details.text,
      hitPathText: this._pathText.text,
      appContextText: this._contextText.text,
      appContextInspectorRoots: this._appContextInspector.debugState().roots.map(root => root.path),
      objectInspectorRoots: this._objectInspector.debugState().roots.map(root => root.path),
      paintRequestText: this._requestText.text,
      paintRequestCount: this._runtimeDebugState?.paintRequests.length ?? 0,
      treeNodeLabels: flattenTreeLabels(this._treeView.roots),
      overlayVisible: this._state?.overlayVisible ?? false,
    }
  }

  debugTreeView(): RenderTreeView<InspectorTreeData> {
    return this._treeView
  }

  debugAppContextInspector(): RenderObjectInspector {
    return this._appContextInspector
  }

  debugObjectInspector(): RenderObjectInspector {
    return this._objectInspector
  }

  debugDockManager(): DockWindowManager {
    return this._dockManager
  }

  debugDockWorkspace(): RenderDockWorkspace {
    return this._dockWorkspace
  }

  private _initializeDockWorkspace(): void {
    this._dockManager.openDocument({
      tabId: 'render-tree',
      title: 'Render Tree',
      content: this._treeView,
      closable: false,
    })
    this._dockManager.openDocument({
      tabId: 'object-inspector',
      title: 'Object Inspector',
      content: this._objectInspectorBox,
      closable: false,
    })
    this._dockManager.openDocument({
      tabId: 'selection-summary',
      title: 'Selection Summary',
      content: this._detailsBox,
      closable: false,
    })
    this._dockManager.openDocument({
      tabId: 'hit-path',
      title: 'Hit Path',
      content: this._pathTextBox,
      closable: false,
    })
    this._dockManager.openDocument({
      tabId: 'app-context',
      title: 'App Context',
      content: this._contextInspectorBox,
      closable: false,
    })
    this._dockManager.openDocument({
      tabId: 'recent-requests',
      title: 'Recent Requests',
      content: this._requestTextBox,
      closable: false,
    })

    this._dockManager.activateDocument('render-tree')
  }

  override performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    // Adapt the default split to the dock width until the user changes it.
    if (context.pass !== 'measure' && !this._initialDockLayoutApplied) {
      this._initialDockLayoutApplied = true
      const root = this._dockManager.root
      const objectRecord = this._dockManager.getDocument('object-inspector')
      if (root.type === 'tabs' && objectRecord) {
        this._dockManager.dockWindow(objectRecord.window, root, constraints.maxWidth < 760 ? 'bottom' : 'right')
        const split = this._dockManager.root
        if (split.type === 'split') this._automaticSplit = { node: split, ratio: split.ratio, direction: split.direction, structure: this._dockStructureSignature() }
        this._dockManager.activateDocument('render-tree')
      }
    }
    if (context.pass !== 'measure' && this._automaticSplit) {
      const previous = this._automaticSplit
      if (!this._matchesAutomaticSplit()) {
        this._automaticSplit = undefined
      } else {
        const compact = constraints.maxWidth < 760
        const direction = compact ? 'vertical' : 'horizontal'
        const ratio = compact ? 0.45 : 0.42
        // Record the programmatic layout before notifications; later user changes must win.
        this._automaticSplit = { ...previous, direction, ratio }
        this._dockManager.setSplitLayout(previous.node, { direction, ratio })
      }
    }
    super.performLayout(constraints, context)
  }

  private _dockStructureSignature(): string {
    const ids = new Map(this._dockManager.documents.map(record => [record.window, record.tabId]))
    const describe = (node: DockLayoutNode): unknown => node.type === 'tabs'
      ? [node.id, node.windows.map(window => ids.get(window))]
      : [node.id, describe(node.first), describe(node.second)]
    // Active tabs and captions do not change the user's pane arrangement.
    return JSON.stringify(describe(this._dockManager.root))
  }

  private _matchesAutomaticSplit(): boolean {
    const previous = this._automaticSplit
    const split = this._dockManager.root
    return !!previous && split.type === 'split' && split === previous.node &&
      split.ratio === previous.ratio && split.direction === previous.direction &&
      this._dockStructureSignature() === previous.structure
  }

  override dispose(): void {
    this._unsubscribeDockChanges()
    this._automaticSplit = undefined
    super.dispose()
  }

  private _syncTreeView(state: LayoutInspectorDebugState): void {
    const nextKey = state.selected ? treeKey(state.selected.debugId) : ''
    const selectionChanged = nextKey !== this._selectedTreeKey
    let structureChanged = false
    if (state.renderTree !== this._renderTreeRef) {
      this._renderTreeRef = state.renderTree
      const signature = formatTreeSignature(state.renderTree)
      structureChanged = signature !== this._treeSignature
      this._treeSignature = signature
      if (structureChanged) {
        const expanded = this._treeView.expandedKeys
        const roots = state.renderTree ? [toTreeNode(state.renderTree)] : []
        const keys = new Set<string>()
        const visit = (nodes: TreeNode<InspectorTreeData>[]) => nodes.forEach(node => { keys.add(node.key); visit(node.children ?? []) })
        visit(roots)
        this._treeView.roots = roots
        this._treeView.expandedKeys = expanded.filter(key => keys.has(key))
      }
    }
    if (selectionChanged || structureChanged) {
      this._treeView.expandedKeys = [...new Set([...this._treeView.expandedKeys, ...collectSelectedPathKeys(state)])]
    }
    this._selectedTreeKey = nextKey
    this._treeView.selectedKey = nextKey
    if (selectionChanged || structureChanged) this._treeView.revealSelectedKey({ deferUntilLayout: true })
  }

}

export class RenderLayoutInspectorPanel extends RenderWindow {
  static override debugTypeName = 'RenderLayoutInspectorPanel'
  private readonly _view: RenderLayoutInspectorView

  constructor(options: RenderLayoutInspectorPanelOptions = {}) {
    super({
      title: 'Layout Inspector',
      x: 64,
      y: 64,
      width: 820,
      height: 560,
      contentPadding: 12,
      contentSpacing: 0,
    })
    this._view = new RenderLayoutInspectorView(options)
    this._view.setWindowHost(this)
    this.setChildren([this._view])
  }

  setInspectorState(state: LayoutInspectorDebugState): void {
    this._view.setInspectorState(state)
  }

  setRuntimeDebugState(state: LayoutInspectorRuntimeDebugState | null): void {
    this._view.setRuntimeDebugState(state)
  }

  debugState(): LayoutInspectorPanelDebugState {
    return this._view.debugState()
  }

  debugTreeView(): RenderTreeView<InspectorTreeData> {
    return this._view.debugTreeView()
  }

  debugAppContextInspector(): RenderObjectInspector {
    return this._view.debugAppContextInspector()
  }

  debugObjectInspector(): RenderObjectInspector {
    return this._view.debugObjectInspector()
  }

  debugDockManager(): DockWindowManager {
    return this._view.debugDockManager()
  }

  debugDockWorkspace(): RenderDockWorkspace {
    return this._view.debugDockWorkspace()
  }

  debugView(): RenderLayoutInspectorView {
    return this._view
  }
}

interface InspectorTreeData {
  debugId: number
}

function formatRuntimeDebugSignature(state: LayoutInspectorRuntimeDebugState | null): string {
  if (!state) return 'runtime-debug:null'
  const requestSignature = state.paintRequests
    .map(request => [
      request.seq,
      request.kind,
      request.source,
      request.reason,
      detailTarget(request.detail) ?? '',
    ].join(':'))
    .join('|')
  return `${state.paintRequestDebugEnabled ? 1 : 0}:${state.paintRequests.length}:${requestSignature}`
}

function formatAppContextInspectorSignature(state: LayoutInspectorDebugState): string {
  return appContextEntries(state)
    .map(entry => `${entry.key}:${entry.source}:${entry.value}`)
    .join('|')
}

function formatObjectInspectorSignature(state: LayoutInspectorDebugState): string {
  const selected = state.selected
  return [
    selected?.debugId ?? -1,
    selected?.debugName ?? '',
    selected?.typeName ?? '',
    selected ? formatPoint(selected.offset) : '',
    selected ? formatPoint(selected.globalOffset) : '',
    selected ? formatSize(selected.size) : '',
    selected?.needsLayout ? 'layout-dirty' : 'layout-clean',
    selected?.needsPaint ? 'paint-dirty' : 'paint-clean',
    selected?.constraints ? formatConstraints(selected.constraints) : '',
    selected?.state === undefined ? '' : formatDebugState(selected.state),
    state.selectedPathIndex,
    state.enabled,
    state.overlayVisible,
    state.hoverPathLength,
    ...state.selectedPathInfo.map(info => `${info.debugId}:${info.typeName}:${formatPoint(info.globalOffset)}:${formatSize(info.size)}`),
    formatAppContextInspectorSignature(state),
  ].join('|')
}

function formatTreeSignature(tree: LayoutInspectorTreeNode | undefined): string {
  if (!tree) return ''
  return `${tree.info.debugId}:${tree.info.typeName}(${tree.children.map(formatTreeSignature).join(',')})`
}

function toTreeNode(node: LayoutInspectorTreeNode): TreeNode<InspectorTreeData> {
  return {
    key: treeKey(node.info.debugId),
    label: `${node.info.typeName} #${node.info.debugId}`,
    data: { debugId: node.info.debugId },
    children: node.children.map(toTreeNode),
  }
}

function treeKey(debugId: number): string {
  return `render-${debugId}`
}

function collectSelectedPathKeys(state: LayoutInspectorDebugState): string[] {
  return state.selectedPathInfo.map(info => treeKey(info.debugId))
}

function flattenTreeLabels(nodes: readonly TreeNode<InspectorTreeData>[]): string[] {
  const labels: string[] = []
  const visit = (node: TreeNode<InspectorTreeData>): void => {
    labels.push(node.label)
    for (const child of node.children ?? []) visit(child)
  }
  for (const node of nodes) visit(node)
  return labels
}

function emptyInspectorState(): LayoutInspectorDebugState {
  return {
    enabled: false,
    overlayVisible: false,
    hoverPathLength: 0,
    selectedPathLength: 0,
    selectedPathIndex: -1,
    hoverPathInfo: [],
    selectedPathInfo: [],
    selectedAppContext: [],
  }
}

function createSelectedInspectorValue(state: LayoutInspectorDebugState): Record<string, unknown> {
  const selected = state.selected
  return {
    selected: selected ? {
      debugId: selected.debugId,
      debugName: selected.debugName ?? '',
      typeName: selected.typeName,
      offset: selected.offset,
      globalOffset: selected.globalOffset,
      size: selected.size,
      constraints: selected.constraints ?? null,
      dirty: {
        layout: selected.needsLayout,
        paint: selected.needsPaint,
      },
      debugState: selected.state ?? null,
    } : null,
    renderObject: state.selectedRenderObject ?? null,
    hitPath: state.selectedPathInfo.map((info, index) => ({
      index,
      selected: index === state.selectedPathIndex,
      debugId: info.debugId,
      typeName: info.typeName,
      size: info.size,
      globalOffset: info.globalOffset,
    })),
    appContext: appContextEntries(state),
    overlay: {
      enabled: state.enabled,
      visible: state.overlayVisible,
      selectedPathIndex: state.selectedPathIndex,
      selectedPathLength: state.selectedPathLength,
      hoverPathLength: state.hoverPathLength,
    },
  }
}

function createAppContextInspectorValue(state: LayoutInspectorDebugState): Record<string, unknown> {
  const entries = appContextEntries(state)
  const byKey: Record<string, unknown> = {}
  for (const entry of entries) {
    byKey[entry.key] = {
      source: entry.source,
      value: entry.rawValue,
      preview: entry.value,
    }
  }
  return {
    entries: entries.map(entry => ({
      key: entry.key,
      source: entry.source,
      value: entry.rawValue,
      preview: entry.value,
    })),
    byKey,
  }
}

function formatInspectorSummary(state: LayoutInspectorDebugState): string {
  if (!state.selected) return 'Selected: <none>'
  const selected = state.selected
  const lines = [
    `global: ${formatPoint(selected.globalOffset)}  size: ${formatSize(selected.size)}`,
    `dirty: layout=${selected.needsLayout ? 'yes' : 'no'}, paint=${selected.needsPaint ? 'yes' : 'no'}`,
  ]
  if (selected.constraints) {
    lines.push(`constraints: ${formatConstraints(selected.constraints)}`)
  }
  if (selected.state !== undefined) {
    lines.push(`state: ${formatDebugState(selected.state)}`)
  }
  return lines.join('\n')
}

function formatHitPath(state: LayoutInspectorDebugState): string {
  if (state.selectedPathInfo.length === 0) return '<empty>'
  return state.selectedPathInfo
    .map((info, index) => {
      const marker = index === state.selectedPathIndex ? '*' : ''
      return `${index + 1}.${marker}${info.typeName} #${info.debugId}`
    })
    .join(' -> ')
}

function formatAppContext(state: LayoutInspectorDebugState): string {
  const entries = appContextEntries(state)
  if (entries.length === 0) return '<empty>'
  return entries
    .map(entry => `${entry.key}: ${entry.value}  (${entry.source})`)
    .join('\n')
}

function formatPaintRequests(state: LayoutInspectorRuntimeDebugState | null): string {
  if (!state) return ''
  const header = `Paint Request 日志: ${state.paintRequestDebugEnabled ? '开' : '关'}`
  if (state.paintRequests.length === 0) return `${header}\n<empty>`
  const lines = state.paintRequests
    .slice(-8)
    .reverse()
    .map(request => {
      const target = detailTarget(request.detail) ??
        request.pipeline.layoutTargets[0] ??
        request.pipeline.paintTargets[0] ??
        request.pipeline.transientPaintTargets[0]
      return `#${request.seq} ${request.kind} ${request.reason}${target ? ` -> ${target}` : ''}`
    })
  return [header, ...lines].join('\n')
}

function detailTarget(detail: unknown): string | undefined {
  if (!detail || typeof detail !== 'object') return undefined
  const target = (detail as { target?: unknown }).target
  return typeof target === 'string' ? target : undefined
}

function appContextEntries(state: LayoutInspectorDebugState): NonNullable<LayoutInspectorDebugState['selectedAppContext']> {
  return state.selectedAppContext ?? []
}

function formatPoint(point: { x: number, y: number }): string {
  return `${round(point.x)}, ${round(point.y)}`
}

function formatSize(size: { width: number, height: number }): string {
  return `${round(size.width)} x ${round(size.height)}`
}

function formatConstraints(constraints: BoxConstraints): string {
  return `w ${round(constraints.minWidth)}..${formatExtent(constraints.maxWidth)}, h ${round(constraints.minHeight)}..${formatExtent(constraints.maxHeight)}`
}

function formatExtent(value: number): string {
  return value === Infinity ? 'inf' : String(round(value))
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function formatDebugState(state: unknown): string {
  try {
    const json = JSON.stringify(state, (_key, value) => {
      if (typeof value === 'bigint') return `${value}n`
      return value
    }, 2)
    return limitText(json ?? String(state))
  } catch (error) {
    return limitText(error instanceof Error ? `<unserializable: ${error.message}>` : String(state))
  }
}

function limitText(text: string, maxLength = 800): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text
}
