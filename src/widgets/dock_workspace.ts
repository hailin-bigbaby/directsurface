import { FocusManager, type Focusable } from '../core/focus_manager'
import { popupViewportRect } from '../core/popup_manager'
import { RenderObject, type BoxConstraints, type LayoutContext, type Offset, type Rect } from '../core/render_object'
import {
  AppContextRegistry,
  type AppContextInitialValues,
} from '../core/app_context'
import { RenderBox, resolveChildLayout } from '../layout/render_box'
import { RenderAppContextScope } from '../layout/render_app_context_scope'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import {
  deriveDockWorkbenchStyle,
  type DockWorkbenchStyleTokens,
} from '../theme/component_styles'
import type { IconName } from './icon'
import { MenuPopup, type ContextMenuEntry } from './menu_popup'
import { RenderSplitter, type SplitDirection } from './splitter'
import { RenderTabs, type TabItem } from './tabs'
import {
  type TabbedDocumentContext,
  type TabbedDocumentContextAware,
  type TabbedDocumentDefinition,
  type TabbedDocumentLifecycle,
  type TabbedDocumentPatch,
} from './tabbed_workspace'
import { RenderWindow, renderWindowOwnedMutationInternal } from './window'
import { dockReadonlyView, unwrapDockReadonlyView } from './dock_readonly_view'
import {
  assertFiniteOffset,
  assertFiniteRectPatch,
  isFiniteRect,
} from '../core/finite_geometry'
import { reportFrameworkInternalError } from '../core/internal_error_reporter'

const dockWorkspaceManagerInternal = Symbol('dock-workspace-manager-internal')

export type DockDropZone = 'center' | 'left' | 'right' | 'top' | 'bottom'
export type DockDropScope = 'pane' | 'workspace'

type DockWorkspaceContextMenuAction =
  | 'float'
  | 'new-vertical-group'
  | 'new-horizontal-group'
  | 'close'
  | 'close-others'
  | 'close-right'
  | 'close-all'

export interface DockTabGroupNode {
  type: 'tabs'
  id: string
  windows: RenderWindow[]
  activeWindow: RenderWindow | null
}

export interface DockSplitNode {
  type: 'split'
  id: string
  direction: SplitDirection
  ratio: number
  first: DockLayoutNode
  second: DockLayoutNode
}

export type DockLayoutNode = DockTabGroupNode | DockSplitNode

export interface DockDropTarget {
  group: DockTabGroupNode
  zone: DockDropZone
  rect: Rect
  scope?: DockDropScope
  previewRect?: Rect
}

export interface DockWindowRecord {
  tabId: string
  title: string
  content: RenderBox
  contentHost: RenderBox
  appContext: AppContextRegistry
  window: RenderWindow
  closable: boolean
  dirty: boolean
  tooltip?: string
  icon?: IconName
  beforeClose?: () => boolean | Promise<boolean>
  context: TabbedDocumentContext
}

interface DockDocumentRuntime {
  contentHost: RenderBox
  appContext: AppContextRegistry
  context: TabbedDocumentContext
}

export interface DockOpenWindowOptions {
  tabId?: string
  title?: string
  closable?: boolean
  dirty?: boolean
  tooltip?: string
  icon?: IconName
  beforeClose?: () => boolean | Promise<boolean>
  targetGroup?: DockTabGroupNode
  context?: AppContextRegistry
  contextValues?: Exclude<AppContextInitialValues, AppContextRegistry>
  disposeContextOnClose?: boolean
}

type DockWindowListener = () => void
type DockDropResolver = (position: Offset) => DockDropTarget | null
type DockGuideHit = Required<Pick<DockDropTarget, 'scope' | 'group' | 'zone' | 'rect' | 'previewRect'>> & {
  guideRect: Rect
}

const dockGuideButtonSize = 32
const dockGuideGap = 8
const dockGuideArm = dockGuideButtonSize + dockGuideGap
const dockGuideEdgeInset = 48
const dockNewPaneRatio = 0.32

let nextDockNodeId = 1
let nextDockWindowId = 1

function nextNodeId(prefix: string): string {
  const id = `${prefix}-${nextDockNodeId}`
  nextDockNodeId += 1
  return id
}

function createAppContextFromOptions(options: {
  context?: AppContextRegistry
  contextValues?: Exclude<AppContextInitialValues, AppContextRegistry>
}): AppContextRegistry {
  const context = options.context ?? new AppContextRegistry(undefined, options.contextValues)
  if (options.context && options.contextValues) {
    const values = new AppContextRegistry(undefined, options.contextValues)
    for (const key of values.keys()) context.set(key as never, values.get(key as never))
    values.dispose()
  }
  return context
}

export class DockWindowManager {
  private _root: DockLayoutNode = this._createTabGroup()
  private _activeGroup: DockTabGroupNode = this._root as DockTabGroupNode
  private readonly _records = new Map<RenderWindow, DockWindowRecord>()
  private readonly _recordOrder: DockWindowRecord[] = []
  private readonly _floatingWindows = new Set<RenderWindow>()
  private readonly _listeners = new Set<DockWindowListener>()
  private readonly _internalListeners = new Set<DockWindowListener>()
  private readonly _closingTabIds = new Set<string>()
  private _reportedInvalidDrop = false
  private _dropResolver?: DockDropResolver
  private _unhandledKeyDownHandler?: (target: Focusable, event: KeyboardEvent) => boolean
  private _windowHost?: RenderWindow
  private _dragWindow: RenderWindow | null = null
  private _dragSourceGroup: DockTabGroupNode | null = null
  private _dropTarget: DockDropTarget | null = null
  private _dragPosition: Offset | null = null
  private _dragStartFloatingRect: Rect | null = null
  private _activeFloatingWindow: RenderWindow | null = null
  private _generation = 0
  private _mutationRevision = 0
  private readonly _notificationQueue: Array<{ generation: number; run(): void }> = []
  private _notifying = false
  private _disposeState: 'active' | 'disposing' | 'disposed' = 'active'

  private get _disposed(): boolean {
    return this._disposeState !== 'active'
  }

  get root(): DockLayoutNode {
    return dockReadonlyView(this._root)
  }

  get documents(): readonly DockWindowRecord[] {
    return dockReadonlyView(this._recordOrder)
  }

  get activeTabId(): string | null {
    return this._activeRecord()?.tabId ?? null
  }

  get activeDocument(): DockWindowRecord | undefined {
    const record = this._activeRecord()
    return record ? dockReadonlyView(record) : undefined
  }

  private _activeRecord(): DockWindowRecord | undefined {
    if (this._activeFloatingWindow && this._floatingWindows.has(this._activeFloatingWindow)) {
      const floatingRecord = this._records.get(this._activeFloatingWindow)
      if (floatingRecord) return floatingRecord
    }
    const activeWindow = this._activeGroup.activeWindow
    return activeWindow ? this._records.get(activeWindow) : undefined
  }

  get floatingWindows(): readonly RenderWindow[] {
    return [...this._floatingWindows]
  }

  get hasDockedDocuments(): boolean {
    return this._findFirstNonEmptyGroup(this._root) !== null
  }

  get dropTarget(): DockDropTarget | null {
    return this._dropTarget ? dockReadonlyView(this._dropTarget) : null
  }

  get dragPosition(): Offset | null {
    return this._dragPosition ? { ...this._dragPosition } : null
  }

  get isDragging(): boolean {
    return this._dragWindow !== null
  }

  get isDraggingFloatingWindow(): boolean {
    return this._dragWindow !== null && this._dragStartFloatingRect !== null
  }

  [dockWorkspaceManagerInternal](): {
    root: DockLayoutNode
    documents: readonly DockWindowRecord[]
    activeDocument?: DockWindowRecord
    dropTarget: DockDropTarget | null
    subscribe(listener: DockWindowListener): () => void
  } {
    return {
      root: this._root,
      documents: this._recordOrder,
      activeDocument: this._activeRecord(),
      dropTarget: this._dropTarget,
      subscribe: listener => {
        this._internalListeners.add(listener)
        return () => this._internalListeners.delete(listener)
      },
    }
  }

  subscribe(listener: DockWindowListener): () => void {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  setWindowHost(host?: RenderWindow): void {
    if (this._windowHost === host) return
    if (this._windowHost) {
      for (const window of this._floatingWindows) {
        if (window.ownerWindow === this._windowHost) {
          this._mutateOwnedWindows(this._windowHost, () => this._windowHost?.removeOwnedWindow(window))
        }
      }
    }
    this._windowHost = host
    if (host) {
      for (const window of this._floatingWindows) this._mutateOwnedWindows(host, () => host.addOwnedWindow(window))
    }
    this._mutationRevision += 1
    this._drainNotifications()
  }

  setDropResolver(resolver?: DockDropResolver): void {
    this._dropResolver = resolver
  }

  setUnhandledKeyDownHandler(handler?: (target: Focusable, event: KeyboardEvent) => boolean): void {
    this._unhandledKeyDownHandler = handler
  }

  hasDocument(tabId: string): boolean {
    return this._recordOrder.some(record => record.tabId === tabId)
  }

  getDocument(tabId: string): DockWindowRecord | undefined {
    const record = this._recordForTab(tabId)
    return record ? dockReadonlyView(record) : undefined
  }

  private _recordForTab(tabId: string): DockWindowRecord | undefined {
    return this._recordOrder.find(record => record.tabId === tabId)
  }

  openDocument(definition: TabbedDocumentDefinition): void {
    if (this._disposed) throw new Error('DockWindowManager is disposed')
    const existing = this._recordForTab(definition.tabId)
    if (existing) {
      const changed =
        existing.title !== definition.title ||
        existing.closable !== (definition.closable ?? true) ||
        existing.dirty !== (definition.dirty ?? false) ||
        existing.tooltip !== definition.tooltip ||
        existing.icon !== definition.icon
      existing.title = definition.title
      existing.window.title = definition.title
      existing.closable = definition.closable ?? true
      existing.window.setShowCloseButton(existing.closable)
      existing.dirty = definition.dirty ?? false
      existing.tooltip = definition.tooltip
      existing.icon = definition.icon
      if (this.activateDocument(existing.tabId)) return
      if (changed) this._emit()
      return
    }

    const runtime = this._createDocumentRuntime(definition)
    const window = new RenderWindow({
      title: definition.title,
      width: 420,
      height: 300,
      contentPadding: 0,
      contentSpacing: 0,
      showCloseButton: definition.closable ?? true,
    })
    window.setChildren([runtime.contentHost])
    const record: DockWindowRecord = {
      tabId: definition.tabId,
      title: definition.title,
      content: definition.content,
      contentHost: runtime.contentHost,
      appContext: runtime.appContext,
      window,
      closable: definition.closable ?? true,
      dirty: definition.dirty ?? false,
      tooltip: definition.tooltip,
      icon: definition.icon,
      beforeClose: definition.beforeClose,
      context: runtime.context,
    }
    this._registerRecord(record)
    try {
      this._attachContext(record)
    } catch (error) {
      this._removeWindowReference(window)
      try {
        window.dispose()
      } catch (error) {
        reportFrameworkInternalError('dock-workspace-open-rollback', error)
      }
      throw error
    }
    this.dockWindow(window, this._activeGroup, 'center')
  }

  /**
   * Opens an existing RenderWindow as the dock document object.
   *
   * Document lifecycle/context hooks are resolved from the RenderWindow itself.
   * Child render objects are not treated as document content here; use
   * openDocument() when the business content should own document lifecycle.
   */
  openWindow(window: RenderWindow, options: DockOpenWindowOptions = {}): void {
    if (this._disposed) throw new Error('DockWindowManager is disposed')
    const existing = this._records.get(window)
    if (existing) {
      this.dockWindow(window, options.targetGroup ?? this._activeGroup, 'center')
      return
    }
    const tabId = options.tabId ?? `dock-window-${nextDockWindowId++}`
    const appContext = this._createDetachedAppContext(options)
    window.setAppContext(appContext, {
      disposeOnDispose: options.disposeContextOnClose ?? options.context === undefined,
    })
    window.setShowCloseButton(options.closable ?? true)
    const record: DockWindowRecord = {
      tabId,
      title: options.title ?? window.title,
      content: window,
      contentHost: window,
      appContext,
      window,
      closable: options.closable ?? true,
      dirty: options.dirty ?? false,
      tooltip: options.tooltip,
      icon: options.icon,
      beforeClose: options.beforeClose,
      context: this._createDocumentContext(tabId, appContext),
    }
    this._registerRecord(record)
    this.dockWindow(window, options.targetGroup ?? this._activeGroup, 'center')
  }

  activateDocument(tabId: string): boolean {
    const record = this._recordForTab(tabId)
    return record ? this.activateWindow(record.window) : false
  }

  activateWindow(window: RenderWindow): boolean {
    if (this._floatingWindows.has(window)) {
      const record = this._records.get(window)
      if (!record) return false
      if (this._activeFloatingWindow === window) {
        this._windowHost?.bringOwnedWindowToFront(window)
        this._scheduleWindowFocus(window)
        this._drainNotifications()
        return false
      }
      const previous = this._activeRecord()
      this._activeFloatingWindow = window
      this._windowHost?.bringOwnedWindowToFront(window)
      this._scheduleWindowFocus(window)
      if (previous && previous !== record) this._notifyDocumentDeactivated(previous)
      if (record !== previous) this._notifyDocumentActivated(record)
      this._emit()
      return true
    }
    const group = this._findGroupContaining(window)
    if (!group) return false
    const previous = this._activeRecord()
    if (group.activeWindow === window && this._activeGroup === group && !this._activeFloatingWindow) return false
    this._activeFloatingWindow = null
    this._activeGroup = group
    group.activeWindow = window
    const next = this._records.get(window)
    if (previous && previous !== next) this._notifyDocumentDeactivated(previous)
    if (next && next !== previous) this._notifyDocumentActivated(next)
    this._emit()
    return true
  }

  async closeDocument(tabId: string): Promise<boolean> {
    const record = this._recordForTab(tabId)
    return record ? this.closeWindow(record.window) : false
  }

  closeActiveDocument(): Promise<boolean> {
    const active = this._activeRecord()
    return active ? this.closeDocument(active.tabId) : Promise.resolve(false)
  }

  activateRelativeDocument(dir: 1 | -1): boolean {
    if (this._recordOrder.length === 0) return false
    if (this._recordOrder.length === 1) {
      const only = this._recordOrder[0]
      return only ? this.activateWindow(only.window) : false
    }
    const active = this._activeRecord()
    const currentIndex = active ? this._recordOrder.findIndex(record => record === active) : -1
    for (let step = 1; step <= this._recordOrder.length; step += 1) {
      let nextIndex = currentIndex + dir * step
      while (nextIndex < 0) nextIndex += this._recordOrder.length
      nextIndex %= this._recordOrder.length
      const next = this._recordOrder[nextIndex]
      if (next && this.activateWindow(next.window)) return true
    }
    return false
  }

  async closeWindow(window: RenderWindow): Promise<boolean> {
    const record = this._records.get(window)
    if (!record) return false
    if (!record.closable) return false
    if (this._closingTabIds.has(record.tabId)) return false
    const generation = this._generation
    this._closingTabIds.add(record.tabId)
    try {
      const allowed = await this._runBeforeClose(record)
      if (this._disposed || this._generation !== generation || this._records.get(window) !== record) return false
      if (!allowed) return false
      const previous = this._activeRecord()
      this._removeWindowReference(window)
      this._detachContext(record)
      const next = this._activeRecord()
      if (previous && previous !== next) this._notifyDocumentDeactivated(previous)
      if (next && next !== previous) this._notifyDocumentActivated(next)
      try {
        window.dispose()
      } catch (error) {
        reportFrameworkInternalError('dock-workspace-window-close', error)
      }
      this._emit()
      return true
    } finally {
      this._closingTabIds.delete(record.tabId)
    }
  }

  moveDocument(tabId: string, targetIndex: number): boolean {
    const record = this._recordForTab(tabId)
    if (!record) return false
    const group = this._findGroupContaining(record.window)
    if (!group) return false
    return this.moveWindowInGroup(group, record.window, targetIndex)
  }

  moveWindowInGroup(group: DockTabGroupNode, window: RenderWindow, targetIndex: number): boolean {
    group = unwrapDockReadonlyView(group)
    const currentIndex = group.windows.indexOf(window)
    if (currentIndex < 0) return false
    const [record] = group.windows.splice(currentIndex, 1)
    const clampedIndex = Math.max(0, Math.min(group.windows.length, targetIndex))
    group.windows.splice(clampedIndex, 0, record!)
    if (currentIndex !== clampedIndex) this._emit()
    return currentIndex !== clampedIndex
  }

  updateDocument(tabId: string, patch: TabbedDocumentPatch): boolean {
    const record = this._recordForTab(tabId)
    if (!record) return false
    const nextTitle = Object.prototype.hasOwnProperty.call(patch, 'title') ? patch.title ?? record.title : record.title
    const nextClosable = Object.prototype.hasOwnProperty.call(patch, 'closable') ? patch.closable ?? record.closable : record.closable
    const nextDirty = Object.prototype.hasOwnProperty.call(patch, 'dirty') ? patch.dirty ?? record.dirty : record.dirty
    const nextTooltip = Object.prototype.hasOwnProperty.call(patch, 'tooltip') ? patch.tooltip : record.tooltip
    const nextIcon = Object.prototype.hasOwnProperty.call(patch, 'icon') ? patch.icon : record.icon
    const changed =
      nextTitle !== record.title ||
      nextClosable !== record.closable ||
      nextDirty !== record.dirty ||
      nextTooltip !== record.tooltip ||
      nextIcon !== record.icon
    if (!changed) return false
    record.title = nextTitle
    record.window.title = nextTitle
    record.closable = nextClosable
    record.window.setShowCloseButton(nextClosable)
    record.dirty = nextDirty
    record.tooltip = nextTooltip
    record.icon = nextIcon
    this._emit()
    return true
  }

  dockWindow(window: RenderWindow, targetGroup: DockTabGroupNode = this._activeGroup, zone: DockDropZone = 'center'): boolean {
    targetGroup = unwrapDockReadonlyView(targetGroup)
    const record = this._records.get(window)
    if (!record || window.disposed) return false
    if (!this._containsGroup(targetGroup)) return false
    const sourceGroup = this._findGroupContaining(window)
    if (zone !== 'center' && sourceGroup === targetGroup && targetGroup.windows.length === 1) return false
    const previous = this._activeRecord()
    this._removeWindowFromFloating(window)
    if (zone === 'center') {
      this._removeWindowFromGroups(window, targetGroup)
      this._addWindowToGroup(targetGroup, window)
    } else {
      const siblingWindows = targetGroup.windows.filter(candidate => candidate !== window)
      this._removeWindowFromGroups(window, targetGroup)
      const siblingGroup = sourceGroup === targetGroup
        ? this._createTabGroup(siblingWindows)
        : targetGroup
      const newGroup = this._createTabGroup([window])
      const direction: SplitDirection = zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical'
      const split: DockSplitNode = {
        type: 'split',
        id: nextNodeId('split'),
        direction,
        ratio: this._splitRatioForZone(zone),
        first: zone === 'left' || zone === 'top' ? newGroup : siblingGroup,
        second: zone === 'left' || zone === 'top' ? siblingGroup : newGroup,
      }
      if (sourceGroup === targetGroup && siblingGroup.windows.length === 0) {
        this._root = newGroup
      } else {
        this._replaceNode(targetGroup, split)
      }
      this._activeGroup = newGroup
    }
    window.setPresentation('tabbed')
    this._activeGroup.activeWindow = window
    this._syncWindowOwnership(window)
    const next = this._records.get(window)
    if (previous && previous !== next) this._notifyDocumentDeactivated(previous)
    if (next && next !== previous) this._notifyDocumentActivated(next)
    this._emit()
    return true
  }

  dockWindowToWorkspace(window: RenderWindow, zone: Exclude<DockDropZone, 'center'>): boolean {
    const record = this._records.get(window)
    if (!record || window.disposed) return false
    const previous = this._activeRecord()
    this._removeWindowFromFloating(window)
    this._removeWindowFromGroups(window)
    const newGroup = this._createTabGroup([window])
    if (this._root.type === 'tabs' && this._root.windows.length === 0) {
      this._root = newGroup
    } else {
      const existingRoot = this._root
      const direction: SplitDirection = zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical'
      this._root = {
        type: 'split',
        id: nextNodeId('split'),
        direction,
        ratio: this._splitRatioForZone(zone),
        first: zone === 'left' || zone === 'top' ? newGroup : existingRoot,
        second: zone === 'left' || zone === 'top' ? existingRoot : newGroup,
      }
    }
    this._activeGroup = newGroup
    window.setPresentation('tabbed')
    newGroup.activeWindow = window
    this._syncWindowOwnership(window)
    const next = this._records.get(window)
    if (previous && previous !== next) this._notifyDocumentDeactivated(previous)
    if (next && next !== previous) this._notifyDocumentActivated(next)
    this._emit()
    return true
  }

  floatWindow(window: RenderWindow, rect?: Partial<Rect>): boolean {
    const record = this._records.get(window)
    if (!record || window.disposed) return false
    assertFiniteRectPatch(rect, 'Floating window bounds')
    const previous = this._activeRecord()
    this._removeWindowFromGroups(window)
    this._floatingWindows.add(window)
    this._detachWindowFromDockParent(window)
    window.setPresentation('floating')
    if (rect?.x !== undefined) window.windowX = rect.x
    if (rect?.y !== undefined) window.windowY = rect.y
    if (rect?.width !== undefined) window.windowWidth = Math.max(window.minWidth, rect.width)
    if (rect?.height !== undefined) window.windowHeight = Math.max(window.minHeight, rect.height)
    window.offset = { x: window.windowX, y: window.windowY }
    if (this._windowHost) this._mutateOwnedWindows(this._windowHost, () => this._windowHost?.addOwnedWindow(window))
    this._activeFloatingWindow = window
    this._windowHost?.bringOwnedWindowToFront(window)
    const next = this._activeRecord()
    if (previous && previous !== next) this._notifyDocumentDeactivated(previous)
    if (next && next !== previous) this._notifyDocumentActivated(next)
    this._syncWindowOwnership(window)
    this._emit()
    return true
  }

  beginDrag(window: RenderWindow, position: Offset): void {
    if (!this._records.has(window)) return
    assertFiniteOffset(position, 'Dock workspace drag position')
    this._reportedInvalidDrop = false
    this._dragWindow = window
    this._dragSourceGroup = this._findGroupContaining(window)
    this._dragPosition = { ...position }
    this._dragStartFloatingRect = this._floatingWindows.has(window)
      ? {
          x: window.windowX,
          y: window.windowY,
          width: window.windowWidth,
          height: window.windowHeight,
        }
      : null
    this.updateDrag(position)
  }

  cancelDrag(window?: RenderWindow): void {
    if (!this._dragWindow) return
    if (window && this._dragWindow !== window) return
    const dragWindow = this._dragWindow
    this._dragWindow = null
    this._dragSourceGroup = null
    this._dropTarget = null
    this._dragPosition = null
    this._restoreDragStartFloatingRect(dragWindow)
    this._dragStartFloatingRect = null
    this._reportedInvalidDrop = false
    this._emit()
  }

  isDraggingWindow(window: RenderWindow): boolean {
    return this._dragWindow === window
  }

  updateDrag(position: Offset): void {
    assertFiniteOffset(position, 'Dock workspace drag position')
    if (!this._dragWindow) return
    this._dragPosition = { ...position }
    this._dropTarget = this._resolveDropTarget(position)
    this._emit()
  }

  endDrag(position: Offset): void {
    assertFiniteOffset(position, 'Dock workspace drag position')
    if (!this._dragWindow) return
    const window = this._dragWindow
    const target = this._resolveDropTarget(position) ?? this._dropTarget
    const sourceGroup = this._dragSourceGroup
    this._dragWindow = null
    this._dragSourceGroup = null
    this._dropTarget = null
    this._dragPosition = null
    this._dragStartFloatingRect = null
    this._reportedInvalidDrop = false
    if (target?.zone === 'center' && sourceGroup === target.group) {
      this._emit()
      return
    }
    if (target) {
      if (target.scope === 'workspace' && target.zone !== 'center') {
        this.dockWindowToWorkspace(window, target.zone)
        return
      }
      this.dockWindow(window, target.group, target.zone)
      return
    }
    if (!this._floatingWindows.has(window)) {
      this.floatWindow(window, {
        x: position.x - window.windowWidth / 2,
        y: position.y - 12,
      })
      return
    }
    this._emit()
  }

  private _mutableDropTarget(target: DockDropTarget): DockDropTarget {
    return { ...target, group: unwrapDockReadonlyView(target.group) }
  }

  private _resolveDropTarget(position: Offset): DockDropTarget | null {
    if (!this._dropResolver) return null
    let target: DockDropTarget | null
    try {
      target = this._dropResolver(position)
    } catch (error) {
      this._reportInvalidDrop(error)
      return null
    }
    if (!target) return null
    if (!isFiniteRect(target.rect) || !isFiniteRect(target.previewRect)) {
      this._reportInvalidDrop(new RangeError('Dock workspace drop target geometry must be finite'))
      return null
    }
    return this._mutableDropTarget(target)
  }

  private _reportInvalidDrop(error: unknown): void {
    if (this._reportedInvalidDrop) return
    this._reportedInvalidDrop = true
    reportFrameworkInternalError('dock-workspace-drop-resolver', error)
  }

  dispose(): void {
    if (this._disposeState !== 'active') return
    this._disposeState = 'disposing'
    this._generation += 1
    this._notificationQueue.length = 0
    const run = (scope: string, action: () => void): void => {
      try {
        action()
      } catch (error) {
        reportFrameworkInternalError(scope, error)
      }
    }
    try {
      const active = this._activeRecord()
      if (active) run('dock-workspace-deactivate-on-dispose', () =>
        this._documentLifecycle(active.content)?.onDocumentDeactivated?.())
      for (const record of [...this._recordOrder]) {
        run('dock-workspace-remove-record', () => this._removeWindowReference(record.window))
        run('dock-workspace-detach-context', () => this._detachContext(record))
        run('dock-workspace-dispose-window', () => record.window.dispose())
      }
    } finally {
      this._records.clear()
      this._recordOrder.length = 0
      this._floatingWindows.clear()
      this._listeners.clear()
      this._closingTabIds.clear()
      this._windowHost = undefined
      this._unhandledKeyDownHandler = undefined
      this._dragWindow = null
      this._dragSourceGroup = null
      this._dropTarget = null
      this._dragPosition = null
      this._dragStartFloatingRect = null
      this._reportedInvalidDrop = false
      this._root = this._createTabGroup()
      this._activeGroup = this._root as DockTabGroupNode
      for (const listener of [...this._internalListeners]) {
        try {
          listener()
        } catch (error) {
          reportFrameworkInternalError('dock-workspace-terminal-renderer', error)
        }
      }
      this._internalListeners.clear()
      this._notificationQueue.length = 0
      this._disposeState = 'disposed'
    }
  }

  private _registerRecord(record: DockWindowRecord): void {
    this._records.set(record.window, record)
    this._recordOrder.push(record)
    record.window.setDockCloseHandler(window => {
      void this.closeWindow(window)
    })
    record.window.setDockActivateHandler(window => {
      this.activateWindow(window)
    })
    record.window.setDockDragHandlers({
      onDragStart: (window, position) => this.beginDrag(window, position),
      onDragMove: (_window, position) => this.updateDrag(position),
      onDragEnd: (_window, position) => this.endDrag(position),
      onDragCancel: window => this.cancelDrag(window),
    })
    record.window.setUnhandledKeyDownHandler((target, event) =>
      this._unhandledKeyDownHandler?.(target, event) === true)
    record.window.manage(() => {
      if (this._records.get(record.window) !== record) return
      const previous = this._activeRecord()
      this._removeWindowReference(record.window)
      this._detachContext(record)
      const next = this._activeRecord()
      if (previous && previous !== next) this._notifyDocumentDeactivated(previous)
      if (next && next !== previous) this._notifyDocumentActivated(next)
      this._emit()
    })
  }

  private _createTabGroup(windows: RenderWindow[] = []): DockTabGroupNode {
    return {
      type: 'tabs',
      id: nextNodeId('tabs'),
      windows: [...windows],
      activeWindow: windows[windows.length - 1] ?? null,
    }
  }

  private _addWindowToGroup(group: DockTabGroupNode, window: RenderWindow): void {
    if (!group.windows.includes(window)) group.windows.push(window)
    group.activeWindow = window
    this._activeGroup = group
  }

  private _removeWindowFromFloating(window: RenderWindow): void {
    if (!this._floatingWindows.delete(window)) return
    if (this._activeFloatingWindow === window) this._activeFloatingWindow = null
    if (window.ownerWindow === this._windowHost && this._windowHost) {
      this._mutateOwnedWindows(this._windowHost, () => this._windowHost?.removeOwnedWindow(window))
    }
  }

  private _detachWindowFromDockParent(window: RenderWindow): void {
    if (window.parent instanceof RenderDockTabGroup) {
      window.parent = undefined
      if (window.owner) window.detach()
    }
  }

  private _removeWindowReference(window: RenderWindow): void {
    const record = this._records.get(window)
    this._removeWindowFromFloating(window)
    this._removeWindowFromGroups(window)
    if (record) {
      this._records.delete(window)
      const index = this._recordOrder.indexOf(record)
      if (index >= 0) this._recordOrder.splice(index, 1)
    }
    if (this._activeFloatingWindow === window) this._activeFloatingWindow = null
    window.setDockCloseHandler(undefined)
    window.setDockActivateHandler(undefined)
    window.setDockDragHandlers(undefined)
  }

  private _removeWindowFromGroups(window: RenderWindow, preserveEmptyGroup?: DockTabGroupNode): void {
    const visit = (node: DockLayoutNode): void => {
      if (node.type === 'tabs') {
        const index = node.windows.indexOf(window)
        if (index < 0) return
        node.windows.splice(index, 1)
        if (node.activeWindow === window) {
          node.activeWindow = node.windows[index - 1] ?? node.windows[index] ?? null
        }
        return
      }
      visit(node.first)
      visit(node.second)
    }
    visit(this._root)
    this._pruneEmptyGroups(preserveEmptyGroup)
  }

  private _findGroupContaining(window: RenderWindow): DockTabGroupNode | null {
    let found: DockTabGroupNode | null = null
    const visit = (node: DockLayoutNode): void => {
      if (found) return
      if (node.type === 'tabs') {
        if (node.windows.includes(window)) found = node
        return
      }
      visit(node.first)
      visit(node.second)
    }
    visit(this._root)
    return found
  }

  private _containsGroup(group: DockTabGroupNode): boolean {
    let found = false
    const visit = (node: DockLayoutNode): void => {
      if (found) return
      if (node.type === 'tabs') {
        found = node === group
        return
      }
      visit(node.first)
      visit(node.second)
    }
    visit(this._root)
    return found
  }

  private _replaceNode(target: DockLayoutNode, replacement: DockLayoutNode): boolean {
    if (this._root === target) {
      this._root = replacement
      return true
    }
    const visit = (node: DockLayoutNode): boolean => {
      if (node.type === 'tabs') return false
      if (node.first === target) {
        node.first = replacement
        return true
      }
      if (node.second === target) {
        node.second = replacement
        return true
      }
      return visit(node.first) || visit(node.second)
    }
    return visit(this._root)
  }

  private _pruneEmptyGroups(preserveEmptyGroup?: DockTabGroupNode): void {
    const prune = (node: DockLayoutNode): DockLayoutNode | null => {
      if (node.type === 'tabs') {
        if (node === preserveEmptyGroup) return node
        return node.windows.length === 0 ? null : node
      }
      const first = prune(node.first)
      const second = prune(node.second)
      if (first && second) {
        node.first = first
        node.second = second
        return node
      }
      return first ?? second
    }
    const pruned = prune(this._root)
    if (pruned) {
      this._root = pruned
    } else {
      this._root = preserveEmptyGroup ?? this._createTabGroup()
    }
    if (this._root.type === 'tabs') this._activeGroup = this._root
    if (!this._activeGroup.windows.includes(this._activeGroup.activeWindow as RenderWindow)) {
      this._activeGroup = this._findFirstGroup(this._root) ?? this._createTabGroup()
    }
  }

  private _findFirstGroup(node: DockLayoutNode): DockTabGroupNode | null {
    if (node.type === 'tabs') return node
    return this._findFirstGroup(node.first) ?? this._findFirstGroup(node.second)
  }

  private _findFirstNonEmptyGroup(node: DockLayoutNode): DockTabGroupNode | null {
    if (node.type === 'tabs') return node.windows.length > 0 ? node : null
    return this._findFirstNonEmptyGroup(node.first) ?? this._findFirstNonEmptyGroup(node.second)
  }

  private _syncWindowOwnership(window: RenderWindow): void {
    if (this._floatingWindows.has(window)) return
    if (window.ownerWindow === this._windowHost && this._windowHost) {
      this._mutateOwnedWindows(this._windowHost, () => this._windowHost?.removeOwnedWindow(window))
    }
  }

  private _mutateOwnedWindows(host: RenderWindow, action: () => void): void {
    const notify = host[renderWindowOwnedMutationInternal](action)
    this._enqueueNotification(notify)
  }

  private _splitRatioForZone(zone: DockDropZone): number {
    return zone === 'left' || zone === 'top' ? dockNewPaneRatio : 1 - dockNewPaneRatio
  }

  private _restoreDragStartFloatingRect(window: RenderWindow): void {
    if (!this._dragStartFloatingRect) return
    if (!this._floatingWindows.has(window)) return
    this._applyFloatingRect(window, this._dragStartFloatingRect)
  }

  private _applyFloatingRect(window: RenderWindow, rect: Rect): void {
    window.setWindowBounds(rect)
  }

  private async _runBeforeClose(record: DockWindowRecord): Promise<boolean> {
    if (record.beforeClose) {
      try {
        return await record.beforeClose()
      } catch {
        return false
      }
    }
    const lifecycle = this._documentLifecycle(record.content)
    if (!lifecycle?.beforeDocumentClose) return true
    try {
      return await lifecycle.beforeDocumentClose()
    } catch {
      return false
    }
  }

  private _documentLifecycle(content: RenderBox): TabbedDocumentLifecycle | undefined {
    const candidate = content as RenderBox & Partial<TabbedDocumentLifecycle>
    return typeof candidate.beforeDocumentClose === 'function' ||
      typeof candidate.onDocumentActivated === 'function' ||
      typeof candidate.onDocumentDeactivated === 'function'
      ? candidate
      : undefined
  }

  private _documentContextAware(content: RenderBox): TabbedDocumentContextAware | undefined {
    const candidate = content as RenderBox & Partial<TabbedDocumentContextAware>
    return typeof candidate.attachDocumentContext === 'function' ||
      typeof candidate.detachDocumentContext === 'function'
      ? candidate
      : undefined
  }

  private _focusWindowPreservingDescendant(window: RenderWindow): void {
    const current = FocusManager.instance.current
    if (current instanceof RenderObject) {
      for (let node: RenderObject | undefined = current; node; node = node.parent) {
        if (node === window) return
      }
    }
    FocusManager.instance.setFocus(window)
  }

  private _scheduleWindowFocus(window: RenderWindow): void {
    this._enqueueNotification(() => {
      try {
        this._focusWindowPreservingDescendant(window)
      } catch (error) {
        reportFrameworkInternalError('dock-workspace-window-focus', error)
      }
    })
  }

  private _notifyDocumentActivated(record: DockWindowRecord): void {
    this._enqueueNotification(() => {
      try {
        this._documentLifecycle(record.content)?.onDocumentActivated?.()
      } catch (error) {
        reportFrameworkInternalError('dock-workspace-lifecycle-activate', error)
      }
    })
  }

  private _notifyDocumentDeactivated(record: DockWindowRecord): void {
    this._enqueueNotification(() => {
      try {
        this._documentLifecycle(record.content)?.onDocumentDeactivated?.()
      } catch (error) {
        reportFrameworkInternalError('dock-workspace-lifecycle-deactivate', error)
      }
    })
  }

  private _createDocumentRuntime(definition: TabbedDocumentDefinition): DockDocumentRuntime {
    const scope = new RenderAppContextScope({
      context: definition.context,
      values: definition.contextValues,
      child: definition.content,
      disposeContextOnDispose: definition.disposeContextOnClose ?? definition.context === undefined,
    })
    return {
      contentHost: scope,
      appContext: scope.appContext,
      context: this._createDocumentContext(definition.tabId, scope.appContext),
    }
  }

  private _createDetachedAppContext(options: DockOpenWindowOptions): AppContextRegistry {
    return createAppContextFromOptions(options)
  }

  private _createDocumentContext(tabId: string, appContext: AppContextRegistry): TabbedDocumentContext {
    const manager = this
    return {
      get tabId() {
        return tabId
      },
      get isActive() {
        return manager.activeTabId === tabId
      },
      get appContext() {
        return appContext
      },
      activateSelf: () => manager.activateDocument(tabId),
      requestClose: () => manager.closeDocument(tabId),
      update: patch => manager.updateDocument(tabId, patch),
      setTitle: title => manager.updateDocument(tabId, { title }),
      setDirty: dirty => manager.updateDocument(tabId, { dirty }),
      setTooltip: tooltip => manager.updateDocument(tabId, { tooltip }),
      setIcon: icon => manager.updateDocument(tabId, { icon }),
    }
  }

  private _attachContext(record: DockWindowRecord): void {
    this._documentContextAware(record.content)?.attachDocumentContext?.(record.context)
  }

  private _detachContext(record: DockWindowRecord): void {
    try {
      this._documentContextAware(record.content)?.detachDocumentContext?.()
    } catch {
      // Detach hooks are user code; manager cleanup must continue.
    }
  }

  private _emit(): void {
    this._mutationRevision += 1
    const internal = [...this._internalListeners]
    const external = [...this._listeners]
    this._enqueueNotification(() => {
      for (const listener of internal) {
        try {
          listener()
        } catch (error) {
          reportFrameworkInternalError('dock-workspace-internal-state-listener', error)
        }
      }
      for (const listener of external) {
        try {
          listener()
        } catch (error) {
          reportFrameworkInternalError('dock-workspace-state-listener', error)
        }
      }
    })
    this._drainNotifications()
  }

  private _enqueueNotification(run: () => void): void {
    if (this._disposed) return
    this._notificationQueue.push({ generation: this._generation, run })
  }

  private _drainNotifications(): void {
    if (this._notifying || this._disposed) return
    this._notifying = true
    try {
      while (this._notificationQueue.length > 0) {
        if (this._disposed) {
          this._notificationQueue.length = 0
          break
        }
        const notification = this._notificationQueue.shift()!
        if (notification.generation !== this._generation) continue
        try {
          notification.run()
        } catch (error) {
          reportFrameworkInternalError('dock-workspace-notification', error)
        }
      }
    } finally {
      this._notifying = false
    }
  }
}

class RenderDockTabGroup extends RenderBox {
  static override debugTypeName = 'RenderDockTabGroup'
  readonly tabs: RenderTabs
  private _activeWindow?: RenderWindow
  private _tabContextMenu: MenuPopup | null = null
  private _tabContextMenuTabId = ''

  constructor(
    private readonly _manager: DockWindowManager,
    private _group: DockTabGroupNode,
  ) {
    super()
    this.tabs = new RenderTabs({
      tabs: [],
      activeKey: '',
      onTabChange: key => this._manager.activateDocument(key),
      onTabClose: key => { void this._manager.closeDocument(key) },
      onTabReorder: (key, targetIndex) => this._manager.moveDocument(key, targetIndex),
      onTabContextMenu: (key, position) => this._showTabContextMenu(key, position),
      onTabDragStart: (key, position) => this._updateTabDockDrag(key, position),
      onTabDragMove: (key, position) => this._updateTabDockDrag(key, position),
      onTabDragEnd: (key, position) => this._endTabDockDrag(key, position),
      onTabDragCancel: key => this._cancelTabDockDrag(key),
    })
    this.tabs.parent = this
    this.syncGroup(_group)
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  get group(): DockTabGroupNode {
    return dockReadonlyView(this._group)
  }

  syncGroup(group: DockTabGroupNode): void {
    this._group = group
    const record = group.activeWindow ? this._manager.documents.find(candidate => candidate.window === group.activeWindow) : undefined
    const nextActiveWindow = group.activeWindow ?? undefined
    if (this._activeWindow !== nextActiveWindow) {
      if (this._activeWindow) this._clearFocusIfWithin(this._activeWindow)
      if (this._activeWindow) {
        if (this._activeWindow.parent === this) {
          this._activeWindow.parent = undefined
          if (this._activeWindow.owner) this._activeWindow.detach()
        }
      }
      this._activeWindow = nextActiveWindow
      if (nextActiveWindow) {
        nextActiveWindow.parent = this
        nextActiveWindow.setPresentation('tabbed')
        if (this.owner && nextActiveWindow.owner !== this.owner) nextActiveWindow.attach(this.owner)
      }
    }
    this.tabs.tabs = group.windows.map(window => {
      const windowRecord = this._manager.documents.find(candidate => candidate.window === window)
      return {
        key: windowRecord?.tabId ?? window.title,
        label: windowRecord?.title ?? window.title,
        closable: windowRecord?.closable ?? true,
        dirty: windowRecord?.dirty ?? false,
        tooltip: windowRecord?.tooltip,
        icon: windowRecord?.icon,
      } satisfies TabItem
    })
    this.tabs.activeKey = record?.tabId ?? ''
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      visitor(this.tabs)
      if (this._activeWindow) visitor(this._activeWindow)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    visitor(this.tabs)
    if (this._activeWindow) visitor(this._activeWindow)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? 400 : constraints.maxWidth
    const height = constraints.maxHeight === Infinity ? 260 : constraints.maxHeight
    this.tabs.layout({ minWidth: 0, maxWidth: width, minHeight: 0, maxHeight: height }, true, context)
    this.tabs.offset = { x: 0, y: 0 }
    const bodyHeight = Math.max(0, height - this.tabs.size.height)
    if (this._activeWindow) {
      const windowLayout = resolveChildLayout(
        this._activeWindow,
        { minWidth: width, maxWidth: width, minHeight: bodyHeight, maxHeight: bodyHeight },
        'stretch',
        'stretch',
      )
      this._activeWindow.layout(windowLayout.constraints, true, context)
      this._activeWindow.positionInSlot({
        x: 0,
        y: this.tabs.size.height,
        width,
        height: bodyHeight,
      }, windowLayout.horizontalAlignment, windowLayout.verticalAlignment)
    }
    this.size = { width, height }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const bodyY = offset.y + this.tabs.size.height
    const bodyHeight = Math.max(0, this.size.height - this.tabs.size.height)
    dl.fillRect(offset.x, bodyY, this.size.width, bodyHeight, context.theme.surfaceContent, 0)
    dl.line(offset.x, bodyY + 0.5, offset.x + this.size.width, bodyY + 0.5, context.theme.borderSubtle, 1)
    this.paintContentChildren(context, offset)
    this.paintAdornerChildren(context, offset)
  }

  disposeDetached(): void {
    this._dismissTabContextMenu()
    if (this._activeWindow) {
      if (this._activeWindow.parent === this) {
        this._activeWindow.parent = undefined
        if (this._activeWindow.owner) this._activeWindow.detach()
      }
      this._activeWindow = undefined
    }
    this.tabs.parent = undefined
    if (this.tabs.owner) this.tabs.detach()
  }

  override dispose(): void {
    this.disposeDetached()
    super.dispose()
  }

  private _updateTabDockDrag(tabId: string, position: Offset): void {
    const record = this._manager.getDocument(tabId)
    if (!record) return
    if (this.tabs.hitTest(position)) {
      this._manager.cancelDrag(record.window)
      return
    }
    if (!this._manager.isDraggingWindow(record.window)) {
      this._manager.beginDrag(record.window, position)
      return
    }
    this._manager.updateDrag(position)
  }

  private _endTabDockDrag(tabId: string, position: Offset): void {
    const record = this._manager.getDocument(tabId)
    if (!record) return
    if (!this._manager.isDraggingWindow(record.window)) return
    this._manager.endDrag(position)
  }

  private _cancelTabDockDrag(tabId: string): void {
    const record = this._manager.getDocument(tabId)
    if (!record) return
    this._manager.cancelDrag(record.window)
  }

  private _showTabContextMenu(tabId: string, position: Offset): boolean {
    if (!this._manager.hasDocument(tabId)) return false
    this._dismissTabContextMenu()
    const menu = new MenuPopup({
      items: this._tabContextMenuItems(tabId),
      onSelect: key => {
        this._dismissTabContextMenu()
        void this._handleTabContextMenuAction(tabId, key as DockWorkspaceContextMenuAction, position)
      },
      position: () => ({ ...position }),
      bounds: popupContext => popupViewportRect(popupContext),
      onClose: () => {
        if (this._tabContextMenu === menu) {
          this._tabContextMenu = null
          this._tabContextMenuTabId = ''
        }
      },
    })
    this._tabContextMenu = menu
    this._tabContextMenuTabId = tabId
    menu.open()
    return true
  }

  private _tabContextMenuItems(tabId: string): ContextMenuEntry[] {
    const record = this._manager.getDocument(tabId)
    const groupRecords = this._group.windows
      .map(window => this._manager.documents.find(candidate => candidate.window === window))
      .filter((candidate): candidate is DockWindowRecord => candidate !== undefined)
    const index = groupRecords.findIndex(candidate => candidate.tabId === tabId)
    const hasClosableOther = this._manager.documents.some(candidate => candidate.tabId !== tabId && candidate.closable)
    const hasClosableRight = index >= 0 && groupRecords.slice(index + 1).some(candidate => candidate.closable)
    const hasClosableDocument = this._manager.documents.some(candidate => candidate.closable)
    const canCreateGroup = !!record && this._group.windows.length > 1
    return [
      { key: 'float', label: '浮动窗口' },
      { separator: true },
      {
        key: 'new-vertical-group',
        label: '新建垂直标签组',
        disabled: !canCreateGroup,
      },
      {
        key: 'new-horizontal-group',
        label: '新建水平标签组',
        disabled: !canCreateGroup,
      },
      { separator: true },
      {
        key: 'close',
        label: '关闭',
        shortcut: 'Ctrl+W',
        disabled: record?.closable !== true,
      },
      {
        key: 'close-others',
        label: '关闭其他标签页',
        disabled: !hasClosableOther,
      },
      {
        key: 'close-right',
        label: '关闭右侧标签页',
        disabled: !hasClosableRight,
      },
      {
        key: 'close-all',
        label: '关闭所有标签页',
        disabled: !hasClosableDocument,
      },
    ]
  }

  private async _handleTabContextMenuAction(
    tabId: string,
    action: DockWorkspaceContextMenuAction,
    position: Offset,
  ): Promise<void> {
    const record = this._manager.getDocument(tabId)
    if (!record) return
    const groupRecords = this._group.windows
      .map(window => this._manager.documents.find(candidate => candidate.window === window))
      .filter((candidate): candidate is DockWindowRecord => candidate !== undefined)
    const index = groupRecords.findIndex(candidate => candidate.tabId === tabId)
    switch (action) {
      case 'float':
        this._manager.floatWindow(record.window, {
          x: position.x,
          y: position.y,
          width: Math.max(record.window.windowWidth, 320),
          height: Math.max(record.window.windowHeight, 220),
        })
        return
      case 'new-vertical-group':
        this._manager.dockWindow(record.window, this._group, 'right')
        return
      case 'new-horizontal-group':
        this._manager.dockWindow(record.window, this._group, 'bottom')
        return
      case 'close':
        await this._manager.closeDocument(tabId)
        return
      case 'close-others':
        await this._closeDocumentsInOrder(this._manager.documents
          .filter(candidate => candidate.tabId !== tabId && candidate.closable)
          .map(candidate => candidate.tabId))
        return
      case 'close-right':
        if (index < 0) return
        await this._closeDocumentsInOrder(groupRecords
          .slice(index + 1)
          .filter(candidate => candidate.closable)
          .map(candidate => candidate.tabId))
        return
      case 'close-all':
        await this._closeDocumentsInOrder(this._manager.documents
          .filter(candidate => candidate.closable)
          .map(candidate => candidate.tabId))
        return
    }
  }

  private async _closeDocumentsInOrder(tabIds: string[]): Promise<void> {
    for (const tabId of tabIds) {
      if (!this._manager.hasDocument(tabId)) continue
      const closed = await this._manager.closeDocument(tabId)
      if (!closed) return
    }
  }

  private _dismissTabContextMenu(): void {
    const menu = this._tabContextMenu
    this._tabContextMenu = null
    this._tabContextMenuTabId = ''
    menu?.dismiss()
  }

  private _clearFocusIfWithin(root: RenderObject): void {
    const current = FocusManager.instance.current
    if (!(current instanceof RenderObject)) return
    let node: RenderObject | undefined = current
    while (node) {
      if (node === root) {
        FocusManager.instance.clearFocus()
        return
      }
      node = node.parent
    }
  }
}

export class RenderDockWorkspace extends RenderBox {
  static override debugTypeName = 'RenderDockWorkspace'
  readonly manager: DockWindowManager
  private _rootRender: RenderObject | null = null
  private readonly _groupViews = new Map<string, RenderDockTabGroup>()
  private readonly _splitViews = new Map<string, RenderSplitter>()
  private _unsubscribe?: () => void
  private readonly _disposeManagerOnDispose: boolean
  private readonly _windowKeyHandler = (target: Focusable, event: KeyboardEvent): boolean =>
    this.handleUnhandledKeyDownFromDescendant(target, event)

  constructor(options: {
    manager: DockWindowManager
    disposeManagerOnDispose?: boolean
  }) {
    super()
    this.manager = options.manager
    this._disposeManagerOnDispose = options.disposeManagerOnDispose ?? false
    this._unsubscribe = this.manager[dockWorkspaceManagerInternal]().subscribe(() => this._syncRenderTree())
    this.manager.setDropResolver(position => this.hitTestDrop(position))
    this.manager.setUnhandledKeyDownHandler(this._windowKeyHandler)
    this._syncRenderTree()
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  handleUnhandledKeyDownFromDescendant(_target: Focusable, event: KeyboardEvent): boolean {
    const usesPrimaryModifier = (event.ctrlKey || event.metaKey) && !event.altKey
    if (!usesPrimaryModifier) return false
    if (event.key === 'Tab') {
      event.preventDefault()
      return this.manager.activateRelativeDocument(event.shiftKey ? -1 : 1)
    }
    if ((event.key === 'w' || event.key === 'W') && this.manager.activeDocument?.closable !== false) {
      event.preventDefault()
      void this.manager.closeActiveDocument()
      return true
    }
    return false
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this._rootRender) visitor(this._rootRender)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this._rootRender) visitor(this._rootRender)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? 720 : constraints.maxWidth
    const height = constraints.maxHeight === Infinity ? 420 : constraints.maxHeight
    this.size = { width, height }
    if (this._rootRender) {
      if (this._rootRender instanceof RenderBox) {
        const rootLayout = resolveChildLayout(
          this._rootRender,
          { minWidth: width, maxWidth: width, minHeight: height, maxHeight: height },
          'stretch',
          'stretch',
        )
        this._rootRender.layout(rootLayout.constraints, true, context)
        this._rootRender.positionInSlot(
          { x: 0, y: 0, width, height },
          rootLayout.horizontalAlignment,
          rootLayout.verticalAlignment,
        )
      } else {
        this._rootRender.layout({ minWidth: 0, maxWidth: width, minHeight: 0, maxHeight: height }, true, context)
        this._rootRender.offset = { x: 0, y: 0 }
      }
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    dl.fillRect(offset.x, offset.y, this.size.width, this.size.height, context.theme.surfaceCanvas, 0)
    this.paintContentChildren(context, offset)
    this.paintAdornerChildren(context, offset)
    if (!this.manager.hasDockedDocuments) this._paintEmptyState(dl, context, offset)
    if (!this.manager.isDragging) return
    const style = deriveDockWorkbenchStyle(context.theme)
    const target = this.manager[dockWorkspaceManagerInternal]().dropTarget
    if (target) this._paintDropPreview(dl, target, style)
    const dragPosition = this.manager.dragPosition
    if (!dragPosition || !this.hitTest(dragPosition)) return
    this._paintDockGuides(dl, dragPosition, target, style)
  }

  hitTestDrop(position: Offset): DockDropTarget | null {
    if (!this.hitTest(position)) return null
    const allowImplicitCenterDrop = !this.manager.isDraggingFloatingWindow
    for (const view of this._groupViews.values()) {
      if (!view.hitTest(position)) continue
      const rect = {
        x: view.globalOffset.x,
        y: view.globalOffset.y,
        width: view.size.width,
        height: view.size.height,
      }
      if (allowImplicitCenterDrop && view.tabs.hitTest(position)) {
        return {
          group: view.group,
          zone: 'center',
          rect,
          scope: 'pane',
          previewRect: this._previewRect(rect, 'center'),
        }
      }
      break
    }
    const emptyGroup = this._emptyRootGroup()
    if (allowImplicitCenterDrop && emptyGroup) {
      const rect = this._workspaceRect()
      return {
        group: emptyGroup,
        zone: 'center',
        rect,
        scope: 'pane',
        previewRect: this._previewRect(rect, 'center'),
      }
    }
    const guideHit = this._hitTestGuide(position)
    return guideHit
      ? {
          group: guideHit.group,
          zone: guideHit.zone,
          rect: guideHit.rect,
          scope: guideHit.scope,
          previewRect: guideHit.previewRect,
        }
      : null
  }

  override dispose(): void {
    this._unsubscribe?.()
    this._unsubscribe = undefined
    this.manager.setDropResolver(undefined)
    this.manager.setUnhandledKeyDownHandler(undefined)
    for (const view of this._groupViews.values()) view.dispose()
    this._groupViews.clear()
    for (const splitter of this._splitViews.values()) splitter.disposeKeepingChildren()
    this._splitViews.clear()
    this._rootRender = null
    if (this._disposeManagerOnDispose) this.manager.dispose()
    super.dispose()
  }

  private _syncRenderTree(): void {
    const usedGroups = new Set<string>()
    const usedSplits = new Set<string>()
    const build = (node: DockLayoutNode): RenderObject => {
      if (node.type === 'tabs') {
        usedGroups.add(node.id)
        let view = this._groupViews.get(node.id)
        if (!view) {
          view = new RenderDockTabGroup(this.manager, node)
          this._groupViews.set(node.id, view)
        }
        view.syncGroup(node)
        return view
      }
      usedSplits.add(node.id)
      const first = build(node.first)
      const second = build(node.second)
      let splitter = this._splitViews.get(node.id)
      if (!splitter) {
        splitter = new RenderSplitter({
          first,
          second,
          direction: node.direction,
          ratio: node.ratio,
          onChange: ratio => { node.ratio = ratio },
        })
        this._splitViews.set(node.id, splitter)
      } else {
        splitter.first = first
        splitter.second = second
        splitter.direction = node.direction
        splitter.ratio = node.ratio
        first.parent = splitter
        second.parent = splitter
      }
      return splitter
    }

    this._rootRender = build(this.manager[dockWorkspaceManagerInternal]().root)
    this._rootRender.parent = this

    for (const [id, view] of [...this._groupViews]) {
      if (usedGroups.has(id)) continue
      view.dispose()
      this._groupViews.delete(id)
    }
    for (const [id, splitter] of [...this._splitViews]) {
      if (usedSplits.has(id)) continue
      splitter.disposeKeepingChildren()
      this._splitViews.delete(id)
    }
    if (this.owner && this._rootRender.owner !== this.owner) this._rootRender.attach(this.owner)
    this.markNeedsLayout()
  }

  private _overlayRect(target: DockDropTarget): Rect {
    if (target.previewRect) return target.previewRect
    const { rect, zone } = target
    return this._previewRect(rect, zone)
  }

  private _previewRect(rect: Rect, zone: DockDropZone): Rect {
    if (zone === 'center') {
      return {
        x: rect.x + rect.width * 0.25,
        y: rect.y + rect.height * 0.25,
        width: rect.width * 0.5,
        height: rect.height * 0.5,
      }
    }
    if (zone === 'left') return { x: rect.x, y: rect.y, width: rect.width * 0.5, height: rect.height }
    if (zone === 'right') return { x: rect.x + rect.width * 0.5, y: rect.y, width: rect.width * 0.5, height: rect.height }
    if (zone === 'top') return { x: rect.x, y: rect.y, width: rect.width, height: rect.height * 0.5 }
    return { x: rect.x, y: rect.y + rect.height * 0.5, width: rect.width, height: rect.height * 0.5 }
  }

  private _paintDropPreview(
    dl: DrawList,
    target: DockDropTarget,
    style: DockWorkbenchStyleTokens,
  ): void {
    const overlay = this._overlayRect(target)
    dl.fillRect(overlay.x, overlay.y, overlay.width, overlay.height, style.dropPreviewBg, 3)
    dl.strokeRect(overlay.x, overlay.y, overlay.width, overlay.height, style.dropPreviewBorder, 1, 3)
  }

  private _paintEmptyState(dl: DrawList, context: PaintContext, offset: Offset): void {
    const tabsHeight = this._emptyRootGroupView()?.tabs.size.height ?? 0
    const bodyY = offset.y + tabsHeight
    const bodyHeight = Math.max(0, this.size.height - tabsHeight)
    if (bodyHeight <= 0) return
    const cx = offset.x + this.size.width / 2
    const cy = bodyY + bodyHeight / 2
    const titleSize = Math.max(13, context.theme.fontSize)
    const descriptionSize = Math.max(11, context.theme.fontSize - 1)
    dl.fillText('暂无 Dock 文档', cx, cy - 10, context.theme.textSecondary, titleSize, context.theme.fontFamily, 'center', 'middle')
    dl.fillText(
      '打开页面或将浮窗拖回工作区',
      cx,
      cy + 14,
      { ...context.theme.textSecondary, a: context.theme.textSecondary.a * 0.72 },
      descriptionSize,
      context.theme.fontFamily,
      'center',
      'middle',
    )
  }

  private _paintDockGuides(
    dl: DrawList,
    dragPosition: Offset,
    target: DockDropTarget | null,
    style: DockWorkbenchStyleTokens,
  ): void {
    const activePane = this._paneViewAt(dragPosition)
    if (activePane?.tabs.hitTest(dragPosition)) return
    if (activePane) {
      for (const hit of this._paneGuideHits(activePane)) {
        this._paintDockGuideButton(dl, hit, this._isActiveGuide(hit, target), style)
      }
    }
    for (const hit of this._workspaceGuideHits()) {
      this._paintDockGuideButton(dl, hit, this._isActiveGuide(hit, target), style)
    }
  }

  private _paintDockGuideButton(
    dl: DrawList,
    hit: DockGuideHit,
    active: boolean,
    style: DockWorkbenchStyleTokens,
  ): void {
    const rect = hit.guideRect
    const bg = active ? style.guideButtonActiveBg : style.guideButtonBg
    const border = active ? style.guideButtonActiveBorder : style.guideButtonBorder
    const icon = active ? style.guideIconActive : style.guideIcon
    const fill = active ? style.guideIconActiveFill : style.guideIconFill
    const shadow = active ? style.guideShadowActiveBg : style.guideShadowBg
    dl.fillRect(rect.x, rect.y, rect.width, rect.height, shadow, 5)
    dl.fillRect(rect.x, rect.y - 1, rect.width, rect.height, bg, 5)
    dl.strokeRect(rect.x, rect.y - 1, rect.width, rect.height, border, active ? 2 : 1, 5)
    this._paintDockGuideIcon(dl, hit.zone, {
      x: rect.x + 8,
      y: rect.y + 7,
      width: rect.width - 16,
      height: rect.height - 15,
    }, icon, fill)
  }

  private _paintDockGuideIcon(
    dl: DrawList,
    zone: DockDropZone,
    rect: Rect,
    lineColor: { r: number; g: number; b: number; a: number },
    fillColor: { r: number; g: number; b: number; a: number },
  ): void {
    if (zone === 'center') {
      dl.strokeRect(rect.x + 2, rect.y + 3, rect.width - 4, rect.height - 6, lineColor, 1, 2)
      dl.fillRect(rect.x + 5, rect.y + 6, rect.width - 10, 4, fillColor, 1)
      dl.line(rect.x + 5, rect.y + 13, rect.x + rect.width - 5, rect.y + 13, lineColor, 1)
      return
    }
    dl.strokeRect(rect.x, rect.y, rect.width, rect.height, lineColor, 1, 2)
    if (zone === 'left') {
      dl.fillRect(rect.x + 2, rect.y + 2, rect.width * 0.45, rect.height - 4, fillColor, 1)
      return
    }
    if (zone === 'right') {
      dl.fillRect(rect.x + rect.width * 0.55 - 2, rect.y + 2, rect.width * 0.45, rect.height - 4, fillColor, 1)
      return
    }
    if (zone === 'top') {
      dl.fillRect(rect.x + 2, rect.y + 2, rect.width - 4, rect.height * 0.45, fillColor, 1)
      return
    }
    dl.fillRect(rect.x + 2, rect.y + rect.height * 0.55 - 2, rect.width - 4, rect.height * 0.45, fillColor, 1)
  }

  private _isActiveGuide(hit: DockGuideHit, target: DockDropTarget | null): boolean {
    return !!target &&
      target.group === hit.group &&
      target.zone === hit.zone &&
      (target.scope ?? 'pane') === hit.scope
  }

  private _hitTestGuide(position: Offset): DockGuideHit | null {
    const activePane = this._paneViewAt(position)
    if (activePane && !activePane.tabs.hitTest(position)) {
      for (const hit of this._paneGuideHits(activePane)) {
        if (this._rectContains(hit.guideRect, position)) return hit
      }
    }
    for (const hit of this._workspaceGuideHits()) {
      if (this._rectContains(hit.guideRect, position)) return hit
    }
    return null
  }

  private _paneViewAt(position: Offset): RenderDockTabGroup | null {
    for (const view of this._groupViews.values()) {
      if (view.hitTest(position)) return view
    }
    return null
  }

  private _paneGuideHits(view: RenderDockTabGroup): DockGuideHit[] {
    const rect = this._viewRect(view)
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    return [
      this._guideHit('pane', view.group, 'center', rect, this._guideRect(cx, cy)),
      this._guideHit('pane', view.group, 'left', rect, this._guideRect(cx - dockGuideArm, cy)),
      this._guideHit('pane', view.group, 'right', rect, this._guideRect(cx + dockGuideArm, cy)),
      this._guideHit('pane', view.group, 'top', rect, this._guideRect(cx, cy - dockGuideArm)),
      this._guideHit('pane', view.group, 'bottom', rect, this._guideRect(cx, cy + dockGuideArm)),
    ]
  }

  private _workspaceGuideHits(): DockGuideHit[] {
    const group = this._firstGroup()
    if (!group) return []
    const rect = this._workspaceRect()
    const leftX = rect.x + Math.min(dockGuideEdgeInset, Math.max(dockGuideButtonSize, rect.width / 4))
    const rightX = rect.x + rect.width - Math.min(dockGuideEdgeInset, Math.max(dockGuideButtonSize, rect.width / 4))
    const topY = rect.y + Math.min(dockGuideEdgeInset, Math.max(dockGuideButtonSize, rect.height / 4))
    const bottomY = rect.y + rect.height - Math.min(dockGuideEdgeInset, Math.max(dockGuideButtonSize, rect.height / 4))
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    return [
      this._guideHit('workspace', group, 'left', rect, this._guideRect(leftX, cy)),
      this._guideHit('workspace', group, 'right', rect, this._guideRect(rightX, cy)),
      this._guideHit('workspace', group, 'top', rect, this._guideRect(cx, topY)),
      this._guideHit('workspace', group, 'bottom', rect, this._guideRect(cx, bottomY)),
    ]
  }

  private _guideHit(
    scope: DockDropScope,
    group: DockTabGroupNode,
    zone: DockDropZone,
    rect: Rect,
    guideRect: Rect,
  ): DockGuideHit {
    return {
      scope,
      group,
      zone,
      rect,
      guideRect,
      previewRect: this._previewRect(rect, zone),
    }
  }

  private _guideRect(centerX: number, centerY: number): Rect {
    return {
      x: centerX - dockGuideButtonSize / 2,
      y: centerY - dockGuideButtonSize / 2,
      width: dockGuideButtonSize,
      height: dockGuideButtonSize,
    }
  }

  private _workspaceRect(): Rect {
    const origin = this.globalOffset
    return { x: origin.x, y: origin.y, width: this.size.width, height: this.size.height }
  }

  private _viewRect(view: RenderDockTabGroup): Rect {
    const origin = view.globalOffset
    return { x: origin.x, y: origin.y, width: view.size.width, height: view.size.height }
  }

  private _firstGroup(): DockTabGroupNode | null {
    const first = this._groupViews.values().next()
    return first.done ? null : first.value.group
  }

  private _emptyRootGroup(): DockTabGroupNode | null {
    const root = this.manager[dockWorkspaceManagerInternal]().root
    return root.type === 'tabs' && root.windows.length === 0 ? root : null
  }

  private _emptyRootGroupView(): RenderDockTabGroup | null {
    const group = this._emptyRootGroup()
    return group ? this._groupViews.get(group.id) ?? null : null
  }

  private _rectContains(rect: Rect, position: Offset): boolean {
    return position.x >= rect.x &&
      position.x <= rect.x + rect.width &&
      position.y >= rect.y &&
      position.y <= rect.y + rect.height
  }
}
