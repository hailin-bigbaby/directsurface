import { FocusManager, type Focusable } from '../core/focus_manager'
import { popupViewportRect } from '../core/popup_manager'
import { RenderObject, type BoxConstraints, type LayoutContext, type Offset, type Rect } from '../core/render_object'
import {
  AppContextRegistry,
  type AppContextInitialValues,
} from '../core/app_context'
import { ellipsizeText } from '../core/text_overflow'
import { RenderBox, RenderClip, resolveChildLayout } from '../layout/render_box'
import { RenderAppContextScope } from '../layout/render_app_context_scope'
import { DrawList } from '../rendering/draw_list'
import type { InteractiveRenderObject, PointerEvent } from '../gestures/recognizers'
import type { PaintContext } from '../rendering/paint_context'
import type { Color } from '../theme/theme'
import {
  deriveDockWorkbenchStyle,
  resolveBgColor,
  resolveTextColor,
  type DockWorkbenchStyleTokens,
} from '../theme/component_styles'
import type { IconName } from './icon'
import { paintIconGlyph } from './icon'
import { MenuPopup, type ContextMenuEntry } from './menu_popup'
import { RenderSplitter, type SplitDirection } from './splitter'
import { RenderTabs, type TabItem } from './tabs'
import {
  type TabbedDocumentContext,
  type TabbedDocumentContextAware,
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

export type DockItemKind = 'document' | 'tool'
export type DockRegion = 'left' | 'center' | 'right' | 'bottom'
export type DockGroupKind = 'document' | 'tool'
export type DockWorkbenchDropZone = 'center' | 'left' | 'right' | 'top' | 'bottom'
export type DockWorkbenchDropScope = 'group' | 'document-area' | 'workbench'
export type DockWorkbenchCommandSource = 'api' | 'drag' | 'menu' | 'keyboard' | 'hover' | 'button'
export type DockWorkbenchAdjacentDirection = 'previous' | 'next'
export type DockWorkbenchCloseRejectReason = 'not-closable' | 'closing' | 'before-close'

type DockWorkbenchContextMenuAction =
  | 'auto-hide'
  | 'auto-hide-group'
  | 'pin'
  | 'pin-group'
  | 'float'
  | 'float-group'
  | 'new-vertical-group'
  | 'new-horizontal-group'
  | 'move-previous-group'
  | 'move-next-group'
  | 'move-left'
  | 'move-right'
  | 'move-bottom'
  | 'close'
  | 'close-others'
  | 'close-right'
  | 'close-group'

export interface DockWorkbenchTabGroupNode {
  type: 'tabs'
  id: string
  kind: DockGroupKind
  items: RenderWindow[]
  activeItem: RenderWindow | null
}

export interface DockWorkbenchSplitNode {
  type: 'split'
  id: string
  direction: SplitDirection
  ratio: number
  first: DockRegionNode
  second: DockRegionNode
}

export type DockRegionNode = DockWorkbenchTabGroupNode | DockWorkbenchSplitNode

export interface DockWorkbenchDropTarget {
  region: DockRegion
  group: DockWorkbenchTabGroupNode
  zone: DockWorkbenchDropZone
  rect: Rect
  scope?: DockWorkbenchDropScope
  previewRect?: Rect
}

export interface DockWorkbenchFloatingGroup {
  id: string
  group: DockWorkbenchTabGroupNode
  root: DockRegionNode
  window: RenderWindow
}

export interface DockRegionState {
  left: DockRegionNode | null
  center: DockRegionNode
  right: DockRegionNode | null
  bottom: DockRegionNode | null
}

export interface DockRegionLayoutState {
  leftWidth: number
  rightWidth: number
  bottomHeight: number
}

export interface DockWorkbenchState {
  regions: DockRegionState
  regionLayout: DockRegionLayoutState
  activeItemId: string | null
}

export type DockWorkbenchEventType =
  | 'item-opened'
  | 'item-updated'
  | 'item-activated'
  | 'item-deactivated'
  | 'item-closed'
  | 'item-close-rejected'
  | 'item-docked'
  | 'item-floated'
  | 'group-floated'
  | 'group-docked'
  | 'item-auto-hidden'
  | 'group-auto-hidden'
  | 'auto-hide-shown'
  | 'auto-hide-hidden'
  | 'region-layout-changed'

export interface DockWorkbenchEvent {
  type: DockWorkbenchEventType
  source?: DockWorkbenchCommandSource
  itemId?: string
  itemIds?: readonly string[]
  groupId?: string
  region?: DockRegion
  previousRegion?: DockRegion
  placement?: DockItemPlacement
  regionLayout?: DockRegionLayoutState
  closeRejectReason?: DockWorkbenchCloseRejectReason
}

export type DockWorkbenchBeforeEventType =
  | 'before-item-dock'
  | 'before-item-float'
  | 'before-group-float'
  | 'before-group-dock'
  | 'before-item-auto-hide'
  | 'before-group-auto-hide'
  | 'before-region-layout-change'

export interface DockWorkbenchBeforeEvent {
  type: DockWorkbenchBeforeEventType
  source?: DockWorkbenchCommandSource
  itemId?: string
  itemIds?: readonly string[]
  groupId?: string
  region?: DockRegion
  previousRegion?: DockRegion
  placement?: DockItemPlacement
  regionLayout?: DockRegionLayoutState
}

export interface DockDockedPlacement {
  mode: 'docked'
  region: DockRegion
  groupId: string
}

export interface DockFloatingPlacement {
  mode: 'floating'
}

export interface DockAutoHidePlacement {
  mode: 'autoHide'
  region: Exclude<DockRegion, 'center'>
}

export type DockItemPlacement = DockDockedPlacement | DockFloatingPlacement | DockAutoHidePlacement

export interface DockWorkbenchAutoHideItem {
  itemId: string
  region: Exclude<DockRegion, 'center'>
  window: RenderWindow
  groupId?: string
}

export interface DockWorkbenchAutoHideGroup {
  id: string
  itemIds: readonly string[]
  region: Exclude<DockRegion, 'center'>
}

export interface DockDocumentDefinition {
  itemId: string
  title: string
  content: RenderBox
  closable?: boolean
  dirty?: boolean
  tooltip?: string
  icon?: IconName
  beforeClose?: () => boolean | Promise<boolean>
  context?: AppContextRegistry
  contextValues?: Exclude<AppContextInitialValues, AppContextRegistry>
  disposeContextOnClose?: boolean
}

export interface DockToolDefinition {
  itemId: string
  title: string
  content: RenderBox
  region: Exclude<DockRegion, 'center'>
  closable?: boolean
  dirty?: boolean
  tooltip?: string
  icon?: IconName
  beforeClose?: () => boolean | Promise<boolean>
  context?: AppContextRegistry
  contextValues?: Exclude<AppContextInitialValues, AppContextRegistry>
  disposeContextOnClose?: boolean
  floatable?: boolean
  autoHideAllowed?: boolean
  mixedDockingAllowed?: boolean
}

export interface DockItemRecord {
  itemId: string
  kind: DockItemKind
  preferredRegion: DockRegion
  placement: DockItemPlacement
  lastDockedPlacement?: DockDockedPlacement
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
  floatable: boolean
  autoHideAllowed: boolean
  mixedDockingAllowed: boolean
  lastFocused?: Focusable
}

interface DockItemRuntime {
  contentHost: RenderBox
  appContext: AppContextRegistry
  context: TabbedDocumentContext
}

interface DockWorkbenchFloatingGroupRuntime extends DockWorkbenchFloatingGroup {
  view: RenderWorkbenchRegionTree
}

type DockWorkbenchListener = () => void
type DockWorkbenchEventListener = (event: DockWorkbenchEvent) => void
type DockWorkbenchBeforeEventListener = (event: DockWorkbenchBeforeEvent) => boolean | void
type DockWorkbenchDropResolver = (position: Offset) => DockWorkbenchDropTarget | null
type DockWorkbenchGuideHit = Required<Pick<DockWorkbenchDropTarget, 'scope' | 'region' | 'group' | 'zone' | 'rect' | 'previewRect'>> & {
  guideRect: Rect
}
type DockWorkbenchAutoHideRailSizes = Record<Exclude<DockRegion, 'center'>, number>

interface DockWorkbenchAutoHideSideTabMetrics {
  height: number
  label: string
  labelCenterY: number
  padding: number
}

const defaultRegionLayout: DockRegionLayoutState = {
  leftWidth: 240,
  rightWidth: 280,
  bottomHeight: 180,
}

const dockWorkbenchNewGroupRatio = 0.32
const dockWorkbenchAutoHideHoverDelayMs = 260
const dockWorkbenchManagerInternal = Symbol('dock-workbench-manager-internal')
const dockWorkbenchAutoHideDismissDelayMs = 420
const minCenterWidth = 220
const minCenterHeight = 160

class DockReentrantMutationError extends Error {
  constructor(operation: string) {
    super(`Dock mutation ${operation} is not allowed during a before-event callback`)
    this.name = 'DockReentrantMutationError'
  }
}
const minToolRegionWidth = 120
const minToolRegionHeight = 96
const workbenchSplitterSize = 5

let nextDockWorkbenchNodeId = 1

function dockWorkbenchGuideArm(style: DockWorkbenchStyleTokens): number {
  return style.groupGuide.buttonSize + style.guideGap
}

function paintDockWorkbenchPinButton(context: PaintContext, rect: Rect, hovered: boolean, pressed: boolean): void {
  const style = deriveDockWorkbenchStyle(context.theme)
  const dl = new DrawList(context)
  if (hovered || pressed) {
    const bg = pressed ? style.pinButtonPressedBg : style.pinButtonHoverBg
    const border = pressed ? style.pinButtonPressedBorder : style.pinButtonHoverBorder
    dl.fillRect(rect.x, rect.y, rect.width, rect.height, bg, style.pinButtonRadius)
    dl.strokeRect(rect.x, rect.y, rect.width, rect.height, border, 1, style.pinButtonRadius)
  }
  const iconSize = Math.max(10, rect.width - 10)
  paintIconGlyph(context, {
    name: 'pin',
    x: rect.x + (rect.width - iconSize) / 2,
    y: rect.y + (rect.height - iconSize) / 2,
    size: iconSize,
    color: hovered || pressed ? style.pinIconActive : style.pinIcon,
  })
}

function nextNodeId(prefix: string): string {
  const id = `${prefix}-${nextDockWorkbenchNodeId}`
  nextDockWorkbenchNodeId += 1
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

export class DockWorkbenchManager {
  private readonly _regions: DockRegionState = {
    left: null,
    center: this._createTabGroup('document'),
    right: null,
    bottom: null,
  }
  private readonly _regionLayout: DockRegionLayoutState = { ...defaultRegionLayout }
  private readonly _records = new Map<RenderWindow, DockItemRecord>()
  private readonly _itemsById = new Map<string, DockItemRecord>()
  private readonly _itemOrder: DockItemRecord[] = []
  private readonly _floatingWindows = new Set<RenderWindow>()
  private readonly _floatingGroups = new Map<string, DockWorkbenchFloatingGroupRuntime>()
  private readonly _autoHideItems = new Map<string, DockWorkbenchAutoHideItem>()
  private readonly _autoHideGroups = new Map<string, DockWorkbenchAutoHideGroup>()
  private readonly _listeners = new Set<DockWorkbenchListener>()
  private readonly _internalListeners = new Set<DockWorkbenchListener>()
  private readonly _eventListeners = new Set<DockWorkbenchEventListener>()
  private readonly _beforeEventListeners = new Set<DockWorkbenchBeforeEventListener>()
  private readonly _extraDropResolvers = new Set<DockWorkbenchDropResolver>()
  private readonly _closingItemIds = new Set<string>()
  private readonly _reportedInvalidDropScopes = new Set<string>()
  private _commandSource: DockWorkbenchCommandSource = 'api'
  private _dropResolver?: DockWorkbenchDropResolver
  private _unhandledKeyDownHandler?: (target: Focusable, event: KeyboardEvent) => boolean
  private _windowHost?: RenderWindow
  private _dragWindow: RenderWindow | null = null
  private _dragSourceGroup: DockWorkbenchTabGroupNode | null = null
  private _dragFloatingGroup: DockWorkbenchFloatingGroupRuntime | null = null
  private _dropTarget: DockWorkbenchDropTarget | null = null
  private _dragPosition: Offset | null = null
  private _dragStartFloatingRect: Rect | null = null
  private _activeGroup = this._regions.center as DockWorkbenchTabGroupNode
  private _activeFloatingWindow: RenderWindow | null = null
  private _activeFloatingGroup: DockWorkbenchFloatingGroupRuntime | null = null
  private _activeAutoHideItemId: string | null = null
  private _generation = 0
  private _mutationRevision = 0
  private _beforePhaseDepth = 0
  private _beforeReentryAttempted = false
  private readonly _notificationQueue: Array<{ generation: number; run(): void }> = []
  private _notifying = false
  private _disposeState: 'active' | 'disposing' | 'disposed' = 'active'

  private get _disposed(): boolean {
    return this._disposeState !== 'active'
  }

  get regions(): DockRegionState {
    return dockReadonlyView(this._regions)
  }

  get regionLayout(): DockRegionLayoutState {
    return dockReadonlyView(this._regionLayout)
  }

  get state(): DockWorkbenchState {
    return dockReadonlyView({
      regions: this._regions,
      regionLayout: this._regionLayout,
      activeItemId: this._activeRecord()?.itemId ?? null,
    })
  }

  get items(): readonly DockItemRecord[] {
    return dockReadonlyView(this._itemOrder)
  }

  get documents(): readonly DockItemRecord[] {
    return dockReadonlyView(this._itemOrder.filter(item => item.kind === 'document'))
  }

  get tools(): readonly DockItemRecord[] {
    return dockReadonlyView(this._itemOrder.filter(item => item.kind === 'tool'))
  }

  get activeItemId(): string | null {
    return this._activeRecord()?.itemId ?? null
  }

  get activeItem(): DockItemRecord | undefined {
    const record = this._activeRecord()
    return record ? dockReadonlyView(record) : undefined
  }

  private _activeRecord(): DockItemRecord | undefined {
    if (this._activeAutoHideItemId) {
      const autoHideRecord = this._recordForItem(this._activeAutoHideItemId)
      if (autoHideRecord) return autoHideRecord
    }
    if (this._activeFloatingGroup && this._floatingGroups.get(this._activeFloatingGroup.id) === this._activeFloatingGroup) {
      const activeWindow = this._activeFloatingGroup.group.activeItem
      if (activeWindow) return this._records.get(activeWindow)
    }
    if (this._activeFloatingWindow && this._floatingWindows.has(this._activeFloatingWindow)) {
      const floatingRecord = this._records.get(this._activeFloatingWindow)
      if (floatingRecord) return floatingRecord
    }
    const activeWindow = this._activeGroup.activeItem
    return activeWindow ? this._records.get(activeWindow) : undefined
  }

  get floatingWindows(): readonly RenderWindow[] {
    return [...this._floatingWindows, ...[...this._floatingGroups.values()].map(group => group.window)]
  }

  get floatingGroups(): readonly DockWorkbenchFloatingGroup[] {
    return dockReadonlyView([...this._floatingGroups.values()].map(group => ({
      id: group.id,
      group: group.group,
      root: group.root,
      window: group.window,
    })))
  }

  get autoHideItems(): readonly DockWorkbenchAutoHideItem[] {
    return dockReadonlyView([...this._autoHideItems.values()])
  }

  get autoHideGroups(): readonly DockWorkbenchAutoHideGroup[] {
    return dockReadonlyView([...this._autoHideGroups.values()])
  }

  get activeAutoHideItemId(): string | null {
    return this._activeAutoHideItemId
  }

  get activeAutoHideItem(): DockItemRecord | undefined {
    const record = this._activeAutoHideItemId ? this._recordForItem(this._activeAutoHideItemId) : undefined
    return record ? dockReadonlyView(record) : undefined
  }

  get activeAutoHideGroup(): DockWorkbenchAutoHideGroup | undefined {
    if (!this._activeAutoHideItemId) return undefined
    const item = this._autoHideItems.get(this._activeAutoHideItemId)
    const group = item?.groupId ? this._autoHideGroups.get(item.groupId) : undefined
    return group ? dockReadonlyView(group) : undefined
  }

  getAutoHideGroup(groupId: string): DockWorkbenchAutoHideGroup | undefined {
    const group = this._autoHideGroups.get(groupId)
    return group ? dockReadonlyView(group) : undefined
  }

  get dropTarget(): DockWorkbenchDropTarget | null {
    return this._dropTarget ? dockReadonlyView(this._dropTarget) : null
  }

  get dragPosition(): Offset | null {
    return this._dragPosition ? { ...this._dragPosition } : null
  }

  get isDragging(): boolean {
    return this._dragWindow !== null || this._dragFloatingGroup !== null
  }

  get isDraggingFloatingWindow(): boolean {
    return this._dragWindow !== null && this._dragStartFloatingRect !== null
  }

  get draggingItem(): DockItemRecord | undefined {
    const record = this._dragWindow ? this._records.get(this._dragWindow) : undefined
    return record ? dockReadonlyView(record) : undefined
  }

  get draggingGroup(): DockWorkbenchTabGroupNode | null {
    return this._dragFloatingGroup ? dockReadonlyView(this._dragFloatingGroup.group) : null
  }

  [dockWorkbenchManagerInternal](): {
    regions: DockRegionState
    items: readonly DockItemRecord[]
    activeItem?: DockItemRecord
    draggingItem?: DockItemRecord
    draggingGroup: DockWorkbenchTabGroupNode | null
    dropTarget: DockWorkbenchDropTarget | null
    subscribe(listener: DockWorkbenchListener): () => void
  } {
    return {
      regions: this._regions,
      items: this._itemOrder,
      activeItem: this._activeRecord(),
      draggingItem: this._dragWindow ? this._records.get(this._dragWindow) : undefined,
      draggingGroup: this._dragFloatingGroup?.group ?? null,
      dropTarget: this._dropTarget,
      subscribe: listener => {
        this._internalListeners.add(listener)
        return () => this._internalListeners.delete(listener)
      },
    }
  }

  subscribe(listener: DockWorkbenchListener): () => void {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  subscribeEvent(listener: DockWorkbenchEventListener): () => void {
    this._eventListeners.add(listener)
    return () => this._eventListeners.delete(listener)
  }

  subscribeBeforeEvent(listener: DockWorkbenchBeforeEventListener): () => void {
    this._beforeEventListeners.add(listener)
    return () => this._beforeEventListeners.delete(listener)
  }

  setDropResolver(resolver?: DockWorkbenchDropResolver): void {
    this._dropResolver = resolver
  }

  setUnhandledKeyDownHandler(handler?: (target: Focusable, event: KeyboardEvent) => boolean): void {
    this._unhandledKeyDownHandler = handler
  }

  addDropResolver(resolver: DockWorkbenchDropResolver): () => void {
    this._extraDropResolvers.add(resolver)
    return () => {
      this._extraDropResolvers.delete(resolver)
    }
  }

  setWindowHost(host?: RenderWindow): void {
    this._assertMutationAllowed('setWindowHost')
    if (this._windowHost === host) return
    if (this._windowHost) {
      for (const window of this._floatingWindows) {
        if (window.ownerWindow === this._windowHost) {
          this._mutateOwnedWindows(this._windowHost, () => this._windowHost?.removeOwnedWindow(window))
        }
      }
      for (const group of this._floatingGroups.values()) {
        if (group.window.ownerWindow === this._windowHost) {
          this._mutateOwnedWindows(this._windowHost, () => this._windowHost?.removeOwnedWindow(group.window))
        }
      }
    }
    this._windowHost = host
    if (host) {
      for (const window of this._floatingWindows) this._mutateOwnedWindows(host, () => host.addOwnedWindow(window))
      for (const group of this._floatingGroups.values()) {
        this._mutateOwnedWindows(host, () => host.addOwnedWindow(group.window))
      }
    }
    this._mutationRevision += 1
    this._drainNotifications()
  }

  hasItem(itemId: string): boolean {
    return this._itemsById.has(itemId)
  }

  getItem(itemId: string): DockItemRecord | undefined {
    const record = this._recordForItem(itemId)
    return record ? dockReadonlyView(record) : undefined
  }

  getDocument(itemId: string): DockItemRecord | undefined {
    const item = this._recordForItem(itemId)
    return item?.kind === 'document' ? dockReadonlyView(item) : undefined
  }

  getTool(itemId: string): DockItemRecord | undefined {
    const item = this._recordForItem(itemId)
    return item?.kind === 'tool' ? dockReadonlyView(item) : undefined
  }

  private _recordForItem(itemId: string): DockItemRecord | undefined {
    return this._itemsById.get(itemId)
  }

  openDocument(definition: DockDocumentDefinition): void {
    this._openItem({
      ...definition,
      kind: 'document',
      preferredRegion: 'center',
      floatable: true,
      autoHideAllowed: false,
      mixedDockingAllowed: false,
    })
  }

  openTool(definition: DockToolDefinition): void {
    this._openItem({
      ...definition,
      kind: 'tool',
      preferredRegion: definition.region,
      floatable: definition.floatable ?? true,
      autoHideAllowed: definition.autoHideAllowed ?? true,
      mixedDockingAllowed: definition.mixedDockingAllowed ?? false,
    })
  }

  activateItem(itemId: string): boolean {
    const record = this._recordForItem(itemId)
    return record ? this.activateWindow(record.window) : false
  }

  selectDockedItemTab(itemId: string): boolean {
    if (this._rejectBeforeMutation()) return false
    const record = this._recordForItem(itemId)
    if (!record || record.placement.mode !== 'docked') return false
    const location = this._findGroupContaining(record.window)
    if (!location) return false
    if (location.group.activeItem === record.window) return true
    location.group.activeItem = record.window
    this._emit()
    return true
  }

  activateWindow(window: RenderWindow): boolean {
    if (this._rejectBeforeMutation()) return false
    const autoHideRecord = this._records.get(window)
    if (autoHideRecord && this._autoHideItems.has(autoHideRecord.itemId)) {
      return this.showAutoHideItem(autoHideRecord.itemId)
    }
    const floatingGroup = this._findFloatingGroupContaining(window)
    if (floatingGroup) {
      const record = this._records.get(window)
      if (!record) return false
      const containingGroup = this._findGroupContainingInNode(floatingGroup.root, window)
      if (!containingGroup) return false
      if (this._activeFloatingGroup === floatingGroup && floatingGroup.group === containingGroup && containingGroup.activeItem === window) {
        this._windowHost?.bringOwnedWindowToFront(floatingGroup.window)
        this._scheduleWindowFocus(floatingGroup.window)
        this._drainNotifications()
        return false
      }
      const previous = this._activeRecord()
      this._activeAutoHideItemId = null
      this._activeFloatingWindow = null
      this._activeFloatingGroup = floatingGroup
      this._activeGroup = containingGroup
      floatingGroup.group = containingGroup
      containingGroup.activeItem = window
      this._syncFloatingGroupPresentation(floatingGroup)
      this._windowHost?.bringOwnedWindowToFront(floatingGroup.window)
      this._scheduleWindowFocus(floatingGroup.window)
      if (previous && previous !== record) this._notifyItemDeactivated(previous)
      if (record !== previous) this._notifyItemActivated(record)
      this._emit()
      return true
    }
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
      this._activeAutoHideItemId = null
      this._activeFloatingWindow = window
      this._activeFloatingGroup = null
      this._windowHost?.bringOwnedWindowToFront(window)
      this._scheduleWindowFocus(window)
      if (previous && previous !== record) this._notifyItemDeactivated(previous)
      if (record !== previous) this._notifyItemActivated(record)
      this._emit()
      return true
    }
    const location = this._findGroupContaining(window)
    if (!location) return false
    const previous = this._activeRecord()
    if (
      location.group.activeItem === window &&
      this._activeGroup === location.group &&
      !this._activeFloatingWindow &&
      !this._activeFloatingGroup &&
      !this._activeAutoHideItemId
    ) return false
    this._activeAutoHideItemId = null
    this._activeFloatingWindow = null
    this._activeFloatingGroup = null
    this._activeGroup = location.group
    location.group.activeItem = window
    const next = this._records.get(window)
    if (previous && previous !== next) this._notifyItemDeactivated(previous)
    if (next && next !== previous) this._notifyItemActivated(next)
    this._emit()
    return true
  }

  async closeItem(itemId: string, source: DockWorkbenchCommandSource = this._commandSource): Promise<boolean> {
    const record = this._recordForItem(itemId)
    return record ? this.closeWindow(record.window, source) : false
  }

  closeActiveItem(source: DockWorkbenchCommandSource = this._commandSource): Promise<boolean> {
    const active = this._activeRecord()
    return active ? this.closeItem(active.itemId, source) : Promise.resolve(false)
  }

  async closeItems(
    itemIds: readonly string[],
    source: DockWorkbenchCommandSource = this._commandSource,
  ): Promise<boolean> {
    for (const itemId of itemIds) {
      if (!this.hasItem(itemId)) continue
      const closed = await this.closeItem(itemId, source)
      if (!closed) return false
    }
    return true
  }

  closeGroup(
    group: DockWorkbenchTabGroupNode,
    source: DockWorkbenchCommandSource = this._commandSource,
  ): Promise<boolean> {
    group = unwrapDockReadonlyView(group)
    const itemIds = group.items
      .map(window => this._records.get(window))
      .filter((record): record is DockItemRecord => record !== undefined && record.closable)
      .map(record => record.itemId)
    if (itemIds.length === 0) return Promise.resolve(false)
    return this.closeItems(itemIds, source)
  }

  updateItem(itemId: string, patch: TabbedDocumentPatch): boolean {
    if (this._rejectBeforeMutation()) return false
    const record = this._recordForItem(itemId)
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
    const floatingGroup = this._findFloatingGroupContaining(record.window)
    if (floatingGroup) this._syncFloatingGroupPresentation(floatingGroup)
    this._emitEvent({
      type: 'item-updated',
      itemId: record.itemId,
      region: record.placement.mode === 'docked' || record.placement.mode === 'autoHide' ? record.placement.region : undefined,
      placement: record.placement,
    })
    this._emit()
    return true
  }

  moveItemInGroup(group: DockWorkbenchTabGroupNode, window: RenderWindow, targetIndex: number): boolean {
    if (this._rejectBeforeMutation()) return false
    group = unwrapDockReadonlyView(group)
    const currentIndex = group.items.indexOf(window)
    if (currentIndex < 0) return false
    const [record] = group.items.splice(currentIndex, 1)
    const clampedIndex = Math.max(0, Math.min(group.items.length, targetIndex))
    group.items.splice(clampedIndex, 0, record!)
    if (currentIndex !== clampedIndex) {
      const floating = this._findFloatingRuntimeForGroup(group)
      if (floating) this._syncFloatingGroupPresentation(floating)
      this._emit()
    }
    return currentIndex !== clampedIndex
  }

  dockItemToGroup(itemId: string, targetGroup: DockWorkbenchTabGroupNode, zone: DockWorkbenchDropZone = 'center'): boolean {
    if (this._rejectBeforeMutation()) return false
    targetGroup = unwrapDockReadonlyView(targetGroup)
    const record = this._recordForItem(itemId)
    if (!record || record.window.disposed) return false
    const floatingSource = this._findFloatingGroupContaining(record.window)
    const sourceGroup = this._findGroupContaining(record.window)?.group ??
      (floatingSource ? this._findGroupContainingInNode(floatingSource.root, record.window) : null)
    if (zone !== 'center' && sourceGroup === targetGroup && targetGroup.items.length === 1) return false
    const target = this._findRegionForGroup(targetGroup)
    if (!target) {
      const floatingTarget = this._findFloatingRuntimeForGroup(targetGroup)
      return floatingTarget ? this._dockItemToFloatingGroup(record, floatingTarget, targetGroup, zone) : false
    }
    if (!this._canDockRecordToRegion(record, target.region)) return false
    const previous = this._activeRecord()
    const previousRegion = record.placement.mode === 'docked' || record.placement.mode === 'autoHide' ? record.placement.region : undefined
    if (!this._canRunBeforeEvent({
      type: 'before-item-dock',
      itemId: record.itemId,
      region: target.region,
      previousRegion,
      placement: { mode: 'docked', region: target.region, groupId: targetGroup.id },
    })) return false
    this._removeAutoHideItem(record.itemId)
    this._removeWindowFromFloating(record.window, record.window)
    if (zone === 'center') {
      this._removeWindowFromRegions(record.window, targetGroup)
      this._addWindowToGroup(targetGroup, record.window)
      record.placement = { mode: 'docked', region: target.region, groupId: targetGroup.id }
      record.lastDockedPlacement = record.placement
    } else {
      const source = this._findGroupContaining(record.window)
      const siblingItems = targetGroup.items.filter(candidate => candidate !== record.window)
      this._removeWindowFromRegions(record.window, targetGroup)
      const siblingGroup = source?.group === targetGroup
        ? this._createTabGroup(targetGroup.kind, siblingItems)
        : targetGroup
      if (source?.group === targetGroup) this._setDockedGroupPlacement(siblingGroup, target.region)
      const newGroup = this._createTabGroup(record.kind === 'document' ? 'document' : 'tool', [record.window])
      const direction: SplitDirection = zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical'
      const split: DockWorkbenchSplitNode = {
        type: 'split',
        id: nextNodeId('workbench-split'),
        direction,
        ratio: this._splitRatioForZone(zone),
        first: zone === 'left' || zone === 'top' ? newGroup : siblingGroup,
        second: zone === 'left' || zone === 'top' ? siblingGroup : newGroup,
      }
      if (source?.group === targetGroup && siblingGroup.items.length === 0) {
        this._regions[target.region] = newGroup
      } else {
        this._replaceRegionNode(target.region, targetGroup, split)
      }
      this._activeGroup = newGroup
      record.placement = { mode: 'docked', region: target.region, groupId: newGroup.id }
      record.lastDockedPlacement = record.placement
    }
    record.window.setPresentation('tabbed')
    this._activeGroup.activeItem = record.window
    this._syncWindowOwnership(record.window)
    const next = this._activeRecord()
    if (previous && previous !== next) this._notifyItemDeactivated(previous)
    if (next && next !== previous) this._notifyItemActivated(next)
    this._emitEvent({
      type: 'item-docked',
      itemId: record.itemId,
      region: record.placement.mode === 'docked' ? record.placement.region : undefined,
      previousRegion,
      placement: record.placement,
    })
    this._emit()
    return true
  }

  private _dockItemToFloatingGroup(
    record: DockItemRecord,
    runtime: DockWorkbenchFloatingGroupRuntime,
    targetGroup: DockWorkbenchTabGroupNode,
    zone: DockWorkbenchDropZone,
  ): boolean {
    const sourceGroup = this._findGroupContainingInNode(runtime.root, record.window)
    if (!sourceGroup) return false
    if (!this._canRunBeforeEvent({
      type: 'before-item-dock',
      itemId: record.itemId,
      placement: { mode: 'floating' },
    })) return false
    const previous = this._activeRecord()
    if (zone === 'center') {
      this._removeWindowFromNode(runtime.root, record.window)
      runtime.root = this._pruneEmptyGroups(runtime.root, targetGroup) ?? targetGroup
      this._addWindowToGroup(targetGroup, record.window)
      runtime.group = targetGroup
    } else {
      this._removeWindowFromNode(runtime.root, record.window)
      runtime.root = this._pruneEmptyGroups(runtime.root, targetGroup) ?? targetGroup
      const newGroup = this._createTabGroup(record.kind === 'document' ? 'document' : 'tool', [record.window])
      const direction: SplitDirection = zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical'
      const replacement: DockRegionNode = targetGroup.items.length === 0
        ? newGroup
        : {
            type: 'split',
            id: nextNodeId('floating-split'),
            direction,
            ratio: this._splitRatioForZone(zone),
            first: zone === 'left' || zone === 'top' ? newGroup : targetGroup,
            second: zone === 'left' || zone === 'top' ? targetGroup : newGroup,
          }
      runtime.root = this._replaceNode(runtime.root, targetGroup, replacement)
      runtime.group = newGroup
      this._activeGroup = newGroup
    }
    record.placement = { mode: 'floating' }
    record.window.setPresentation('tabbed')
    runtime.group.activeItem = record.window
    this._activeFloatingWindow = null
    this._activeFloatingGroup = runtime
    this._activeGroup = runtime.group
    this._syncFloatingGroupPresentation(runtime)
    this._syncWindowOwnership(record.window)
    const next = this._activeRecord()
    if (previous && previous !== next) this._notifyItemDeactivated(previous)
    if (next && next !== previous) this._notifyItemActivated(next)
    this._emitEvent({
      type: 'item-docked',
      itemId: record.itemId,
      placement: record.placement,
    })
    this._emit()
    return true
  }

  canMoveItemToAdjacentGroup(itemId: string, direction: DockWorkbenchAdjacentDirection): boolean {
    return this._adjacentGroupForItem(itemId, direction) !== null
  }

  moveItemToAdjacentGroup(itemId: string, direction: DockWorkbenchAdjacentDirection): boolean {
    if (this._rejectBeforeMutation()) return false
    const record = this._recordForItem(itemId)
    if (!record || record.window.disposed) return false
    const adjacent = this._adjacentGroupForItem(itemId, direction)
    if (!adjacent) return false
    if (!this._canDockRecordToRegion(record, adjacent.region)) return false
    const previous = this._activeRecord()
    const previousRegion = record.placement.mode === 'docked' || record.placement.mode === 'autoHide' ? record.placement.region : undefined
    if (!this._canRunBeforeEvent({
      type: 'before-item-dock',
      itemId: record.itemId,
      region: adjacent.region,
      previousRegion,
      placement: { mode: 'docked', region: adjacent.region, groupId: adjacent.group.id },
    })) return false
    this._removeAutoHideItem(record.itemId)
    this._removeWindowFromFloating(record.window, record.window)
    this._removeWindowFromRegions(record.window, adjacent.group)
    this._addWindowToGroup(adjacent.group, record.window)
    record.placement = { mode: 'docked', region: adjacent.region, groupId: adjacent.group.id }
    record.lastDockedPlacement = record.placement
    record.window.setPresentation('tabbed')
    this._activeGroup = adjacent.group
    adjacent.group.activeItem = record.window
    this._syncWindowOwnership(record.window)
    const next = this._activeRecord()
    if (previous && previous !== next) this._notifyItemDeactivated(previous)
    if (next && next !== previous) this._notifyItemActivated(next)
    this._emitEvent({
      type: 'item-docked',
      itemId: record.itemId,
      region: adjacent.region,
      previousRegion,
      placement: record.placement,
    })
    this._emit()
    return true
  }

  dockItem(itemId: string, region?: DockRegion): boolean {
    if (this._rejectBeforeMutation()) return false
    const record = this._recordForItem(itemId)
    if (!record || record.window.disposed) return false
    const targetRegion = region ?? record.lastDockedPlacement?.region ?? record.preferredRegion
    if (!this._canDockRecordToRegion(record, targetRegion)) return false
    if (record.placement.mode === 'docked' && record.placement.region === targetRegion) {
      this.activateWindow(record.window)
      return true
    }
    const previous = this._activeRecord()
    const previousRegion = record.placement.mode === 'docked' || record.placement.mode === 'autoHide' ? record.placement.region : undefined
    const preferredGroup = this._preferredDockGroup(record, targetRegion)
    const existingGroup = preferredGroup ?? (this._regions[targetRegion] ? this._firstGroup(this._regions[targetRegion]) : null)
    if (!this._canRunBeforeEvent({
      type: 'before-item-dock',
      itemId: record.itemId,
      region: targetRegion,
      previousRegion,
      placement: existingGroup ? { mode: 'docked', region: targetRegion, groupId: existingGroup.id } : undefined,
    })) return false
    this._removeAutoHideItem(record.itemId)
    this._removeWindowFromFloating(record.window, record.window)
    this._removeWindowFromRegions(record.window)
    const group = preferredGroup ?? this._ensureRegionGroup(targetRegion, record.kind === 'document' ? 'document' : 'tool')
    this._addWindowToGroup(group, record.window)
    record.placement = { mode: 'docked', region: targetRegion, groupId: group.id }
    record.lastDockedPlacement = record.placement
    record.window.setPresentation('tabbed')
    this._syncWindowOwnership(record.window)
    const next = this._activeRecord()
    if (previous && previous !== next) this._notifyItemDeactivated(previous)
    if (next && next !== previous) this._notifyItemActivated(next)
    this._emitEvent({
      type: 'item-docked',
      itemId: record.itemId,
      region: targetRegion,
      previousRegion,
      placement: record.placement,
    })
    this._emit()
    return true
  }

  autoHideItem(itemId: string): boolean {
    if (this._rejectBeforeMutation()) return false
    const record = this._recordForItem(itemId)
    if (!record || record.window.disposed || record.kind !== 'tool' || !record.autoHideAllowed) return false
    const targetRegion = this._autoHideRegionForRecord(record)
    if (!targetRegion) return false
    const previous = this._activeRecord()
    const previousRegion = record.placement.mode === 'docked' || record.placement.mode === 'autoHide' ? record.placement.region : undefined
    if (!this._canRunBeforeEvent({
      type: 'before-item-auto-hide',
      itemId: record.itemId,
      region: targetRegion,
      previousRegion,
      placement: { mode: 'autoHide', region: targetRegion },
    })) return false
    this._removeWindowFromFloating(record.window)
    this._removeWindowFromRegions(record.window)
    record.placement = { mode: 'autoHide', region: targetRegion }
    record.window.setPresentation('tabbed')
    this._detachWindowFromDockParent(record.window)
    this._autoHideItems.set(record.itemId, {
      itemId: record.itemId,
      region: targetRegion,
      window: record.window,
    })
    this._activeAutoHideItemId = null
    this._activeFloatingWindow = null
    this._activeFloatingGroup = null
    this._syncWindowOwnership(record.window)
    const next = this._activeRecord()
    if (previous && previous !== next) this._notifyItemDeactivated(previous)
    if (next && next !== previous) this._notifyItemActivated(next)
    this._emitEvent({
      type: 'item-auto-hidden',
      itemId: record.itemId,
      region: targetRegion,
      previousRegion,
      placement: record.placement,
    })
    this._emit()
    return true
  }

  autoHideGroup(group: DockWorkbenchTabGroupNode): boolean {
    if (this._rejectBeforeMutation()) return false
    group = unwrapDockReadonlyView(group)
    const target = this._findRegionForGroup(group)
    if (!target || target.region === 'center' || group.kind !== 'tool' || group.items.length === 0) return false
    const records = group.items
      .map(window => this._records.get(window))
      .filter((record): record is DockItemRecord => record !== undefined)
    if (records.length !== group.items.length) return false
    if (records.some(record => record.window.disposed || record.kind !== 'tool' || !record.autoHideAllowed)) return false
    const targetRegion = target.region
    const previous = this._activeRecord()
    const itemIds = records.map(record => record.itemId)
    if (!this._canRunBeforeEvent({
      type: 'before-group-auto-hide',
      groupId: group.id,
      itemIds,
      region: targetRegion,
      previousRegion: targetRegion,
    })) return false
    const previousRegions = new Map<string, DockRegion | undefined>()
    for (const record of records) {
      const previousRegion = record.placement.mode === 'docked' || record.placement.mode === 'autoHide' ? record.placement.region : undefined
      previousRegions.set(record.itemId, previousRegion)
      if (!this._canRunBeforeEvent({
        type: 'before-item-auto-hide',
        itemId: record.itemId,
        region: targetRegion,
        previousRegion,
        placement: { mode: 'autoHide', region: targetRegion },
      })) return false
    }
    this._removeGroupFromRegions(group)
    this._autoHideGroups.set(group.id, {
      id: group.id,
      itemIds: records.map(record => record.itemId),
      region: targetRegion,
    })
    for (const record of records) {
      this._removeWindowFromFloating(record.window)
      record.placement = { mode: 'autoHide', region: targetRegion }
      record.window.setPresentation('tabbed')
      this._detachWindowFromDockParent(record.window)
      this._autoHideItems.set(record.itemId, {
        itemId: record.itemId,
        region: targetRegion,
        window: record.window,
        groupId: group.id,
      })
      this._syncWindowOwnership(record.window)
      this._emitEvent({
        type: 'item-auto-hidden',
        itemId: record.itemId,
        region: targetRegion,
        previousRegion: previousRegions.get(record.itemId),
        placement: record.placement,
      })
    }
    this._emitEvent({
      type: 'group-auto-hidden',
      groupId: group.id,
      itemIds,
      region: targetRegion,
      previousRegion: targetRegion,
    })
    this._activeAutoHideItemId = null
    this._activeFloatingWindow = null
    this._activeFloatingGroup = null
    const next = this._activeRecord()
    if (previous && previous !== next) this._notifyItemDeactivated(previous)
    if (next && next !== previous) this._notifyItemActivated(next)
    this._emit()
    return true
  }

  showAutoHideItem(itemId: string): boolean {
    if (this._rejectBeforeMutation()) return false
    const record = this._recordForItem(itemId)
    if (!record || !this._autoHideItems.has(itemId)) return false
    if (this._activeAutoHideItemId === itemId) return false
    const previous = this._activeRecord()
    this._activeAutoHideItemId = itemId
    this._activeFloatingWindow = null
    this._activeFloatingGroup = null
    const next = this._activeRecord()
    if (previous && previous !== next) this._notifyItemDeactivated(previous)
    if (next && next !== previous) this._notifyItemActivated(next)
    this._emitEvent({
      type: 'auto-hide-shown',
      itemId: record.itemId,
      region: record.placement.mode === 'autoHide' ? record.placement.region : undefined,
      placement: record.placement,
    })
    this._emit()
    return true
  }

  hideAutoHideItem(itemId?: string): boolean {
    if (this._rejectBeforeMutation()) return false
    if (!this._activeAutoHideItemId) return false
    if (itemId && this._activeAutoHideItemId !== itemId) return false
    const hiddenItemId = this._activeAutoHideItemId
    const hiddenRecord = this._recordForItem(hiddenItemId)
    const previous = this._activeRecord()
    this._activeAutoHideItemId = null
    const next = this._activeRecord()
    if (previous && previous !== next) this._notifyItemDeactivated(previous)
    if (next && next !== previous) this._notifyItemActivated(next)
    this._emitEvent({
      type: 'auto-hide-hidden',
      itemId: hiddenItemId,
      region: hiddenRecord?.placement.mode === 'autoHide' ? hiddenRecord.placement.region : undefined,
      placement: hiddenRecord?.placement,
    })
    this._emit()
    return true
  }

  dockAutoHideItem(itemId: string, region?: Exclude<DockRegion, 'center'>): boolean {
    const autoHide = this._autoHideItems.get(itemId)
    const record = this._recordForItem(itemId)
    if (!autoHide || !record || record.window.disposed) return false
    if (autoHide.groupId) return this.dockAutoHideGroup(autoHide.groupId, region)
    const targetRegion = region ?? autoHide.region
    return this.dockItem(itemId, targetRegion)
  }

  dockAutoHideGroup(groupId: string, region?: Exclude<DockRegion, 'center'>): boolean {
    if (this._rejectBeforeMutation()) return false
    const autoHideGroup = this._autoHideGroups.get(groupId)
    if (!autoHideGroup) return false
    const targetRegion = region ?? autoHideGroup.region
    const records = autoHideGroup.itemIds
      .map(itemId => this._recordForItem(itemId))
      .filter((record): record is DockItemRecord => record !== undefined)
    if (records.length !== autoHideGroup.itemIds.length || records.some(record => record.window.disposed)) return false
    if (!records.every(record => this._canDockRecordToRegion(record, targetRegion))) return false
    const itemIds = records.map(record => record.itemId)
    if (!this._canRunBeforeEvent({
      type: 'before-group-dock',
      groupId,
      itemIds,
      region: targetRegion,
    })) return false
    for (const record of records) {
      if (!this._canRunBeforeEvent({
        type: 'before-item-dock',
        itemId: record.itemId,
        region: targetRegion,
        previousRegion: record.placement.mode === 'autoHide' ? record.placement.region : undefined,
      })) return false
    }
    const previous = this._activeRecord()
    this._autoHideGroups.delete(groupId)
    if (this._activeAutoHideItemId && autoHideGroup.itemIds.includes(this._activeAutoHideItemId)) this._activeAutoHideItemId = null
    const group = this._createTabGroup('tool')
    this._regions[targetRegion] = this._appendGroupToRegion(this._regions[targetRegion], group, targetRegion)
    for (const record of records) {
      this._removeAutoHideItem(record.itemId)
      this._addWindowToGroup(group, record.window)
      record.placement = { mode: 'docked', region: targetRegion, groupId: group.id }
      record.lastDockedPlacement = record.placement
      record.window.setPresentation('tabbed')
      this._syncWindowOwnership(record.window)
    }
    this._activeFloatingWindow = null
    this._activeFloatingGroup = null
    const next = this._activeRecord()
    if (previous && previous !== next) this._notifyItemDeactivated(previous)
    if (next && next !== previous) this._notifyItemActivated(next)
    this._emitEvent({
      type: 'group-docked',
      groupId: group.id,
      itemIds,
      region: targetRegion,
    })
    this._emit()
    return true
  }

  beginDrag(window: RenderWindow, position: Offset): void {
    this._assertMutationAllowed('beginDrag')
    if (!this._records.has(window)) return
    assertFiniteOffset(position, 'Dock drag position')
    this._reportedInvalidDropScopes.clear()
    this._dragFloatingGroup = null
    this._dragWindow = window
    this._dragSourceGroup = this._findGroupContaining(window)?.group ?? null
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

  beginFloatingGroupDrag(window: RenderWindow, position: Offset): void {
    this._assertMutationAllowed('beginFloatingGroupDrag')
    const group = this._findFloatingGroupByHost(window)
    if (!group) return
    assertFiniteOffset(position, 'Dock floating-group drag position')
    this._reportedInvalidDropScopes.clear()
    this._dragWindow = null
    this._dragSourceGroup = null
    this._dragFloatingGroup = null
    this._dragFloatingGroup = group
    this._dragPosition = { ...position }
    this._dragStartFloatingRect = {
      x: window.windowX,
      y: window.windowY,
      width: window.windowWidth,
      height: window.windowHeight,
    }
    this.updateDrag(position)
  }

  cancelDrag(window?: RenderWindow): void {
    this._assertMutationAllowed('cancelDrag')
    if (!this._dragWindow && !this._dragFloatingGroup) return
    if (window && this._dragWindow !== window) return
    const dragWindow = this._dragWindow
    const dragFloatingGroup = this._dragFloatingGroup
    this._dragWindow = null
    this._dragSourceGroup = null
    this._dragFloatingGroup = null
    this._dropTarget = null
    this._dragPosition = null
    if (dragWindow) this._restoreDragStartFloatingRect(dragWindow)
    if (dragFloatingGroup) this._restoreDragStartFloatingRect(dragFloatingGroup.window)
    this._dragStartFloatingRect = null
    this._reportedInvalidDropScopes.clear()
    this._emit()
  }

  cancelActiveDrag(): boolean {
    if (this._rejectBeforeMutation()) return false
    if (!this._dragWindow && !this._dragFloatingGroup) return false
    this.cancelDrag()
    return true
  }

  isDraggingWindow(window: RenderWindow): boolean {
    return this._dragWindow === window
  }

  updateDrag(position: Offset): void {
    this._assertMutationAllowed('updateDrag')
    assertFiniteOffset(position, 'Dock drag position')
    if (!this._dragWindow && !this._dragFloatingGroup) return
    this._dragPosition = { ...position }
    const target = this._resolveDropTarget(position)
    const record = this._dragWindow ? this._records.get(this._dragWindow) : undefined
    if (record) {
      this._dropTarget = target && this._canDockRecordToDropTarget(record, target) ? target : null
      this._emit()
      return
    }
    const group = this._dragFloatingGroup?.group
    this._dropTarget = group && target && this._canDockGroupToDropTarget(group, target) ? target : null
    this._emit()
  }

  endDrag(position: Offset): void {
    this._assertMutationAllowed('endDrag')
    assertFiniteOffset(position, 'Dock drag position')
    this.runWithCommandSource('drag', () => this._endDrag(position))
  }

  private _resolveDropTarget(position: Offset): DockWorkbenchDropTarget | null {
    const primary = this._resolveDropCandidate(this._dropResolver, position, 'dock-workbench-primary-drop-resolver')
    if (primary) return primary
    let index = 0
    for (const resolver of [...this._extraDropResolvers]) {
      const target = this._resolveDropCandidate(resolver, position, `dock-workbench-extra-drop-resolver-${index}`)
      if (target) return target
      index += 1
    }
    return null
  }

  private _resolveDropCandidate(
    resolver: DockWorkbenchDropResolver | undefined,
    position: Offset,
    scope: string,
  ): DockWorkbenchDropTarget | null {
    if (!resolver) return null
    let target: DockWorkbenchDropTarget | null
    try {
      target = resolver(position)
    } catch (error) {
      this._reportInvalidDrop(scope, error)
      return null
    }
    if (!target) return null
    if (!isFiniteRect(target.rect) || !isFiniteRect(target.previewRect)) {
      this._reportInvalidDrop(scope, new RangeError('Dock drop target geometry must be finite'))
      return null
    }
    return this._mutableDropTarget(target)
  }

  private _reportInvalidDrop(scope: string, error: unknown): void {
    if (this._reportedInvalidDropScopes.has(scope)) return
    this._reportedInvalidDropScopes.add(scope)
    reportFrameworkInternalError(scope, error)
  }

  private _mutableDropTarget(target: DockWorkbenchDropTarget): DockWorkbenchDropTarget {
    return { ...target, group: unwrapDockReadonlyView(target.group) }
  }

  private _endDrag(position: Offset): void {
    if (!this._dragWindow && !this._dragFloatingGroup) return
    if (this._dragFloatingGroup) {
      const group = this._dragFloatingGroup
      const target = this._resolveDropTarget(position) ?? this._dropTarget
      this._dragFloatingGroup = null
      this._dropTarget = null
      this._dragPosition = null
      this._dragStartFloatingRect = null
      this._reportedInvalidDropScopes.clear()
      if (target && this._canDockGroupToDropTarget(group.group, target)) {
        if (!this.dockFloatingGroup(group.id, target)) this._emit()
        return
      }
      this._emit()
      return
    }
    const window = this._dragWindow
    if (!window) return
    const record = this._records.get(window)
    const target = this._resolveDropTarget(position) ?? this._dropTarget
    const sourceGroup = this._dragSourceGroup
    this._dragWindow = null
    this._dragSourceGroup = null
    this._dragFloatingGroup = null
    this._dropTarget = null
    this._dragPosition = null
    this._dragStartFloatingRect = null
    this._reportedInvalidDropScopes.clear()
    if (!record) {
      this._emit()
      return
    }
    if (target?.zone === 'center' && sourceGroup === target.group) {
      this._emit()
      return
    }
    if (target && this._canDockRecordToDropTarget(record, target)) {
      let committed = false
      if ((target.scope ?? 'group') === 'workbench') {
        committed = this.dockItem(record.itemId, target.region)
      } else {
        committed = this.dockItemToGroup(record.itemId, target.group, target.zone)
      }
      if (!committed) this._emit()
      return
    }
    if (!this._floatingWindows.has(window)) {
      const committed = this.floatItem(record.itemId, {
        x: position.x - window.windowWidth / 2,
        y: position.y - 12,
      })
      if (!committed) this._emit()
      return
    }
    this._emit()
  }

  floatItem(itemId: string, rect?: Partial<Rect>): boolean {
    if (this._rejectBeforeMutation()) return false
    const record = this._recordForItem(itemId)
    if (!record || record.window.disposed || !record.floatable) return false
    assertFiniteRectPatch(rect, 'Floating item bounds')
    const previous = this._activeRecord()
    const previousRegion = record.placement.mode === 'docked' || record.placement.mode === 'autoHide' ? record.placement.region : undefined
    if (!this._canRunBeforeEvent({
      type: 'before-item-float',
      itemId: record.itemId,
      previousRegion,
      placement: { mode: 'floating' },
    })) return false
    this._removeAutoHideItem(record.itemId)
    this._removeWindowFromFloating(record.window, record.window)
    this._removeWindowFromRegions(record.window)
    this._floatingWindows.add(record.window)
    this._detachWindowFromDockParent(record.window)
    record.placement = { mode: 'floating' }
    record.window.setPresentation('floating')
    if (rect?.x !== undefined) record.window.windowX = rect.x
    if (rect?.y !== undefined) record.window.windowY = rect.y
    if (rect?.width !== undefined) record.window.windowWidth = Math.max(record.window.minWidth, rect.width)
    if (rect?.height !== undefined) record.window.windowHeight = Math.max(record.window.minHeight, rect.height)
    record.window.offset = { x: record.window.windowX, y: record.window.windowY }
    if (this._windowHost) {
      this._mutateOwnedWindows(this._windowHost, () => this._windowHost?.addOwnedWindow(record.window))
    }
    this._activeAutoHideItemId = null
    this._activeFloatingGroup = null
    this._activeFloatingWindow = record.window
    this._windowHost?.bringOwnedWindowToFront(record.window)
    const next = this._activeRecord()
    if (previous && previous !== next) this._notifyItemDeactivated(previous)
    if (next && next !== previous) this._notifyItemActivated(next)
    this._syncWindowOwnership(record.window)
    this._emitEvent({
      type: 'item-floated',
      itemId: record.itemId,
      previousRegion,
      placement: record.placement,
    })
    this._emit()
    return true
  }

  floatGroup(group: DockWorkbenchTabGroupNode, rect?: Partial<Rect>): boolean {
    if (this._rejectBeforeMutation()) return false
    group = unwrapDockReadonlyView(group)
    if (this._floatingGroups.has(group.id)) return false
    assertFiniteRectPatch(rect, 'Floating group bounds')
    const target = this._findRegionForGroup(group)
    if (!target || group.items.length === 0) return false
    const records = group.items
      .map(window => this._records.get(window))
      .filter((record): record is DockItemRecord => record !== undefined)
    if (records.length !== group.items.length || records.some(record => !record.floatable)) return false
    if (!this._canRunBeforeEvent({
      type: 'before-group-float',
      groupId: group.id,
      itemIds: records.map(record => record.itemId),
      previousRegion: target.region,
    })) return false
    const previous = this._activeRecord()
    this._removeGroupFromRegions(group)
    for (const record of records) this._detachWindowFromDockParent(record.window)
    const host = new RenderWindow({
      title: this._floatingGroupTitle(group),
      width: rect?.width ?? 460,
      height: rect?.height ?? 300,
      contentPadding: 0,
      contentSpacing: 0,
      showCloseButton: records.some(record => record.closable),
    })
    const view = new RenderWorkbenchRegionTree(this, group)
    host.setChildren([view])
    host.setPresentation('floating')
    host.windowX = rect?.x ?? 96
    host.windowY = rect?.y ?? 80
    host.windowWidth = Math.max(host.minWidth, rect?.width ?? host.windowWidth)
    host.windowHeight = Math.max(host.minHeight, rect?.height ?? host.windowHeight)
    host.offset = { x: host.windowX, y: host.windowY }
    host.setDockDragHandlers({
      onDragStart: (window, position) => this.beginFloatingGroupDrag(window, position),
      onDragMove: (_window, position) => this.updateDrag(position),
      onDragEnd: (_window, position) => this.endDrag(position),
      onDragCancel: () => this.cancelActiveDrag(),
    })
    host.setUnhandledKeyDownHandler((target, event) =>
      this._unhandledKeyDownHandler?.(target, event) === true)
    const runtime: DockWorkbenchFloatingGroupRuntime = {
      id: group.id,
      group,
      root: group,
      window: host,
      view,
    }
    host.setDockCloseHandler((_window, closeSource) => {
      void this.closeItems(this._itemsInNode(runtime.root)
        .map(window => this._records.get(window))
        .filter((record): record is DockItemRecord => record !== undefined && record.closable)
        .map(record => record.itemId), closeSource === 'button' ? 'button' : 'api')
    })
    this._floatingGroups.set(group.id, runtime)
    for (const record of records) {
      record.placement = { mode: 'floating' }
      record.window.setPresentation('tabbed')
      this._syncWindowOwnership(record.window)
    }
    this._activeFloatingWindow = null
    this._activeFloatingGroup = runtime
    this._activeGroup = group
    if (this._windowHost) this._mutateOwnedWindows(this._windowHost, () => this._windowHost?.addOwnedWindow(host))
    this._windowHost?.bringOwnedWindowToFront(host)
    const next = this._activeRecord()
    if (previous && previous !== next) this._notifyItemDeactivated(previous)
    if (next && next !== previous) this._notifyItemActivated(next)
    this._emitEvent({
      type: 'group-floated',
      groupId: runtime.id,
      itemIds: records.map(record => record.itemId),
      previousRegion: target.region,
    })
    this._emit()
    return true
  }

  dockFloatingGroup(groupId: string, target?: DockRegion | DockWorkbenchDropTarget): boolean {
    if (this._rejectBeforeMutation()) return false
    if (typeof target === 'object') {
      target = { ...target, group: unwrapDockReadonlyView(target.group) }
    }
    const runtime = this._floatingGroups.get(groupId)
    if (!runtime) return false
    const targetRegion = typeof target === 'string'
      ? target
      : target?.region ?? this._preferredRegionForNode(runtime.root)
    if (!targetRegion || !this._canDockNodeToRegion(runtime.root, targetRegion)) return false
    const dropTarget = typeof target === 'string' ? undefined : target
    if (dropTarget && !this._canDockFloatingGroupToTarget(runtime.root, dropTarget)) return false
    const itemIds = this._itemsInNode(runtime.root)
      .map(window => this._records.get(window)?.itemId)
      .filter((itemId): itemId is string => itemId !== undefined)
    if (!this._canRunBeforeEvent({
      type: 'before-group-dock',
      groupId: runtime.id,
      itemIds,
      region: targetRegion,
    })) return false
    const previous = this._activeRecord()
    this._floatingGroups.delete(runtime.id)
    if (this._activeFloatingGroup === runtime) this._activeFloatingGroup = null
    if (runtime.window.ownerWindow === this._windowHost && this._windowHost) {
      this._mutateOwnedWindows(this._windowHost, () => this._windowHost?.removeOwnedWindow(runtime.window))
    }
    runtime.window.setDockCloseHandler(undefined)
    runtime.window.setDockDragHandlers(undefined)
    runtime.window.dispose()
    if (dropTarget && dropTarget.scope !== 'workbench') {
      this._dockFloatingGroupToDropTarget(runtime, dropTarget)
    } else {
      this._dockFloatingGroupToRegion(runtime, targetRegion)
    }
    this._activeFloatingWindow = null
    this._activeGroup = runtime.group
    for (const group of this._groupsInNode(runtime.root)) {
      for (const window of group.items) {
        const record = this._records.get(window)
        if (!record) continue
        record.placement = { mode: 'docked', region: targetRegion, groupId: group.id }
        record.lastDockedPlacement = record.placement
        window.setPresentation('tabbed')
        this._syncWindowOwnership(window)
      }
    }
    runtime.group = this._firstGroup(runtime.root) ?? runtime.group
    const active = runtime.group.activeItem ?? runtime.group.items[runtime.group.items.length - 1] ?? null
    runtime.group.activeItem = active
    const next = this._activeRecord()
    if (previous && previous !== next) this._notifyItemDeactivated(previous)
    if (next && next !== previous) this._notifyItemActivated(next)
    this._emitEvent({
      type: 'group-docked',
      groupId: runtime.group.id,
      itemIds,
      region: targetRegion,
    })
    this._emit()
    return true
  }

  setRegionLayout(patch: Partial<DockRegionLayoutState>): void {
    this._assertMutationAllowed('setRegionLayout')
    const nextLayout = { ...this._regionLayout }
    let changed = false
    for (const key of Object.keys(patch) as Array<keyof DockRegionLayoutState>) {
      const requested = patch[key]
      if (requested !== undefined && !Number.isFinite(requested)) {
        throw new RangeError(`Dock region ${key} must be finite`)
      }
      const next = Math.max(0, patch[key] ?? nextLayout[key])
      if (nextLayout[key] === next) continue
      nextLayout[key] = next
      changed = true
    }
    if (changed) {
      if (!this._canRunBeforeEvent({
        type: 'before-region-layout-change',
        regionLayout: { ...nextLayout },
      })) return
      Object.assign(this._regionLayout, nextLayout)
      this._emitEvent({
        type: 'region-layout-changed',
        regionLayout: { ...this._regionLayout },
      })
      this._emit()
    }
  }

  async closeWindow(
    window: RenderWindow,
    source: DockWorkbenchCommandSource = this._commandSource,
  ): Promise<boolean> {
    if (this._rejectBeforeMutation()) return false
    const record = this._records.get(window)
    if (!record) return false
    if (!record.closable) {
      this._emitCloseRejected(record, 'not-closable', source)
      return false
    }
    if (this._closingItemIds.has(record.itemId)) {
      this._emitCloseRejected(record, 'closing', source)
      return false
    }
    const generation = this._generation
    this._closingItemIds.add(record.itemId)
    try {
      const allowed = await this._runBeforeClose(record)
      if (this._disposed || this._generation !== generation || this._records.get(window) !== record) return false
      if (!allowed) {
        this._emitCloseRejected(record, 'before-close', source)
        return false
      }
      const previous = this._activeRecord()
      this._removeWindowReference(window)
      this._detachContext(record)
      const next = this._activeRecord()
      if (previous && previous !== next) this._notifyItemDeactivated(previous, source)
      if (next && next !== previous) this._notifyItemActivated(next, source)
      try {
        window.dispose()
      } catch (error) {
        reportFrameworkInternalError('dock-workbench-window-close', error)
      }
      this._emitEvent({
        type: 'item-closed',
        itemId: record.itemId,
        previousRegion: record.placement.mode === 'docked' || record.placement.mode === 'autoHide' ? record.placement.region : undefined,
      }, source)
      this._emit()
      return true
    } finally {
      this._closingItemIds.delete(record.itemId)
    }
  }

  private _emitCloseRejected(
    record: DockItemRecord,
    reason: DockWorkbenchCloseRejectReason,
    source: DockWorkbenchCommandSource,
  ): void {
    this._emitEvent({
      type: 'item-close-rejected',
      itemId: record.itemId,
      previousRegion: record.placement.mode === 'docked' || record.placement.mode === 'autoHide'
        ? record.placement.region
        : undefined,
      placement: record.placement,
      closeRejectReason: reason,
    }, source)
    this._drainNotifications()
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
      if (active) run('dock-workbench-deactivate-on-dispose', () => {
        this._rememberItemFocus(active)
        const lifecycle = active.content as RenderBox & Partial<TabbedDocumentLifecycle>
        lifecycle.onDocumentDeactivated?.()
      })
      for (const record of [...this._itemOrder]) {
        run('dock-workbench-remove-record', () => this._removeWindowReference(record.window))
        run('dock-workbench-detach-context', () => this._detachContext(record))
        run('dock-workbench-dispose-window', () => record.window.dispose())
      }
      for (const group of [...this._floatingGroups.values()]) {
        run('dock-workbench-dispose-floating-group', () => this._removeFloatingGroup(group))
      }
    } finally {
      this._records.clear()
      this._itemsById.clear()
      this._itemOrder.length = 0
      this._floatingWindows.clear()
      this._autoHideItems.clear()
      this._autoHideGroups.clear()
      this._floatingGroups.clear()
      this._listeners.clear()
      this._eventListeners.clear()
      this._beforeEventListeners.clear()
      this._extraDropResolvers.clear()
      this._closingItemIds.clear()
      this._windowHost = undefined
      this._dropResolver = undefined
      this._unhandledKeyDownHandler = undefined
      this._dragWindow = null
      this._dragSourceGroup = null
      this._dragFloatingGroup = null
      this._dropTarget = null
      this._dragPosition = null
      this._dragStartFloatingRect = null
      this._reportedInvalidDropScopes.clear()
      this._activeFloatingWindow = null
      this._activeFloatingGroup = null
      this._activeAutoHideItemId = null
      this._regions.left = null
      this._regions.center = this._createTabGroup('document')
      this._regions.right = null
      this._regions.bottom = null
      this._activeGroup = this._regions.center as DockWorkbenchTabGroupNode
      for (const listener of [...this._internalListeners]) {
        try {
          listener()
        } catch (error) {
          reportFrameworkInternalError('dock-workbench-terminal-renderer', error)
        }
      }
      this._internalListeners.clear()
      this._notificationQueue.length = 0
      this._disposeState = 'disposed'
    }
  }

  private _openItem(definition: (DockDocumentDefinition | DockToolDefinition) & {
    kind: DockItemKind
    preferredRegion: DockRegion
    floatable: boolean
    autoHideAllowed: boolean
    mixedDockingAllowed: boolean
  }): void {
    this._assertMutationAllowed('openItem')
    if (this._disposed) throw new Error('DockWorkbenchManager is disposed')
    const existing = this._recordForItem(definition.itemId)
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
      if (changed) {
        this._emitEvent({
          type: 'item-updated',
          itemId: existing.itemId,
          region: existing.placement.mode === 'docked' || existing.placement.mode === 'autoHide'
            ? existing.placement.region
            : undefined,
          placement: existing.placement,
        })
      }
      if (this.activateItem(existing.itemId)) return
      if (changed) this._emit()
      return
    }

    const runtime = this._createItemRuntime(definition)
    const window = new RenderWindow({
      title: definition.title,
      width: 420,
      height: 300,
      contentPadding: 0,
      contentSpacing: 0,
      showCloseButton: definition.closable ?? true,
    })
    window.setChildren([runtime.contentHost])
    const group = this._ensureRegionGroup(definition.preferredRegion, definition.kind === 'document' ? 'document' : 'tool')
    const previous = this._activeRecord()
    const placement: DockDockedPlacement = {
      mode: 'docked',
      region: definition.preferredRegion,
      groupId: group.id,
    }
    const record: DockItemRecord = {
      itemId: definition.itemId,
      kind: definition.kind,
      preferredRegion: definition.preferredRegion,
      placement,
      lastDockedPlacement: placement,
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
      floatable: definition.floatable,
      autoHideAllowed: definition.autoHideAllowed,
      mixedDockingAllowed: definition.mixedDockingAllowed,
    }
    this._registerRecord(record)
    try {
      this._attachContext(record)
    } catch (error) {
      this._removeWindowReference(window)
      window.dispose()
      throw error
    }
    this._addWindowToGroup(group, window)
    window.setPresentation('tabbed')
    const next = this._activeRecord()
    if (previous && previous !== next) this._notifyItemDeactivated(previous)
    if (next && next !== previous) this._notifyItemActivated(next)
    this._emitEvent({
      type: 'item-opened',
      itemId: record.itemId,
      region: placement.region,
      placement: record.placement,
    })
    this._emit()
  }

  private _registerRecord(record: DockItemRecord): void {
    this._records.set(record.window, record)
    this._itemsById.set(record.itemId, record)
    this._itemOrder.push(record)
    record.window.setDockCloseHandler((window, closeSource) => {
      void this.closeWindow(window, closeSource === 'button' ? 'button' : 'api')
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
      if (previous && previous !== next) this._notifyItemDeactivated(previous)
      if (next && next !== previous) this._notifyItemActivated(next)
      this._emit()
    })
  }

  private _createTabGroup(kind: DockGroupKind, items: RenderWindow[] = []): DockWorkbenchTabGroupNode {
    return {
      type: 'tabs',
      id: nextNodeId(`${kind}-tabs`),
      kind,
      items: [...items],
      activeItem: items[items.length - 1] ?? null,
    }
  }

  private _ensureRegionGroup(region: DockRegion, kind: DockGroupKind): DockWorkbenchTabGroupNode {
    const current = this._regions[region]
    const first = current ? this._firstGroup(current) : null
    if (first) return first
    const group = this._createTabGroup(kind)
    this._regions[region] = group
    return group
  }

  private _preferredDockGroup(record: DockItemRecord, region: DockRegion): DockWorkbenchTabGroupNode | null {
    const placement = record.lastDockedPlacement
    if (!placement || placement.region !== region) return null
    const root = this._regions[region]
    if (!root) return null
    const group = this._findGroupById(root, placement.groupId)
    if (!group || group.kind !== (record.kind === 'document' ? 'document' : 'tool')) return null
    return group
  }

  private _findGroupById(node: DockRegionNode, groupId: string): DockWorkbenchTabGroupNode | null {
    if (node.type === 'tabs') return node.id === groupId ? node : null
    return this._findGroupById(node.first, groupId) ?? this._findGroupById(node.second, groupId)
  }

  private _addWindowToGroup(group: DockWorkbenchTabGroupNode, window: RenderWindow): void {
    if (!group.items.includes(window)) group.items.push(window)
    group.activeItem = window
    this._activeGroup = group
  }

  private _setDockedGroupPlacement(group: DockWorkbenchTabGroupNode, region: DockRegion): void {
    for (const window of group.items) {
      const record = this._records.get(window)
      if (!record) continue
      const placement: DockDockedPlacement = { mode: 'docked', region, groupId: group.id }
      record.placement = placement
      record.lastDockedPlacement = placement
    }
  }

  private _autoHideRegionForRecord(record: DockItemRecord): Exclude<DockRegion, 'center'> | null {
    const region = record.placement.mode === 'docked'
      ? record.placement.region
      : record.lastDockedPlacement?.region ?? record.preferredRegion
    return region === 'left' || region === 'right' || region === 'bottom' ? region : null
  }

  private _removeAutoHideItem(itemId: string): boolean {
    const item = this._autoHideItems.get(itemId)
    const removed = this._autoHideItems.delete(itemId)
    if (item?.groupId) {
      const group = this._autoHideGroups.get(item.groupId)
      if (group) {
        const nextItemIds = group.itemIds.filter(candidate => candidate !== itemId)
        if (nextItemIds.length === 0) {
          this._autoHideGroups.delete(group.id)
        } else {
          this._autoHideGroups.set(group.id, { ...group, itemIds: nextItemIds })
        }
      }
    }
    if (this._activeAutoHideItemId === itemId) this._activeAutoHideItemId = null
    return removed
  }

  private _removeWindowFromFloating(window: RenderWindow, preserveFocusFor?: RenderWindow): void {
    const removedSingle = this._floatingWindows.delete(window)
    if (removedSingle) {
      if (this._activeFloatingWindow === window) this._activeFloatingWindow = null
      if (window.ownerWindow === this._windowHost && this._windowHost) {
        this._mutateOwnedWindows(this._windowHost, () => this._windowHost?.removeOwnedWindow(window))
      }
    }
    this._removeWindowFromFloatingGroup(window, preserveFocusFor)
  }

  private _removeWindowReference(window: RenderWindow): void {
    const record = this._records.get(window)
    this._removeWindowFromFloating(window)
    this._removeWindowFromRegions(window)
    if (record) {
      this._removeAutoHideItem(record.itemId)
      this._records.delete(window)
      this._itemsById.delete(record.itemId)
      const index = this._itemOrder.indexOf(record)
      if (index >= 0) this._itemOrder.splice(index, 1)
    }
    if (this._activeFloatingWindow === window) this._activeFloatingWindow = null
    window.setDockCloseHandler(undefined)
    window.setDockActivateHandler(undefined)
    window.setDockDragHandlers(undefined)
  }

  private _removeWindowFromFloatingGroup(window: RenderWindow, preserveFocusFor?: RenderWindow): void {
    const floatingGroup = this._findFloatingGroupContaining(window)
    if (!floatingGroup) return
    const group = this._findGroupContainingInNode(floatingGroup.root, window)
    if (!group) return
    const index = group.items.indexOf(window)
    if (index >= 0) group.items.splice(index, 1)
    if (group.activeItem === window) {
      group.activeItem = group.items[index - 1] ?? group.items[index] ?? null
    }
    const nextRoot = this._pruneEmptyGroups(floatingGroup.root)
    if (!nextRoot) {
      this._removeFloatingGroup(floatingGroup)
      return
    }
    floatingGroup.root = nextRoot
    if (!this._nodeContainsGroup(floatingGroup.root, floatingGroup.group)) {
      floatingGroup.group = this._firstGroup(floatingGroup.root) ?? floatingGroup.group
    }
    this._syncFloatingGroupPresentation(floatingGroup, preserveFocusFor)
    if (this._activeFloatingGroup === floatingGroup && !floatingGroup.group.activeItem) {
      this._activeFloatingGroup = null
    }
  }

  private _removeFloatingGroup(group: DockWorkbenchFloatingGroupRuntime): void {
    this._floatingGroups.delete(group.id)
    if (this._activeFloatingGroup === group) this._activeFloatingGroup = null
    if (group.window.ownerWindow === this._windowHost && this._windowHost) {
      this._mutateOwnedWindows(this._windowHost, () => this._windowHost?.removeOwnedWindow(group.window))
    }
    group.window.setDockCloseHandler(undefined)
    group.window.dispose()
  }

  private _removeWindowFromRegions(window: RenderWindow, preserveEmptyGroup?: DockWorkbenchTabGroupNode): void {
    let preferredRegion: DockRegion | null = null
    for (const region of ['left', 'center', 'right', 'bottom'] as const) {
      const root = this._regions[region]
      if (!root) continue
      if (!preferredRegion && this._findGroupContainingInNode(root, window)) preferredRegion = region
      this._removeWindowFromNode(root, window)
      const nextRoot = this._pruneEmptyGroups(root, preserveEmptyGroup)
      if (region === 'center') {
        this._regions.center = nextRoot ?? this._createTabGroup('document')
      } else {
        this._regions[region] = nextRoot
      }
    }
    this._resolveActiveGroupAfterRegionMutation(preferredRegion)
  }

  private _removeGroupFromRegions(group: DockWorkbenchTabGroupNode): void {
    let preferredRegion: DockRegion | null = null
    for (const region of ['left', 'center', 'right', 'bottom'] as const) {
      const root = this._regions[region]
      if (!root) continue
      if (!preferredRegion && this._nodeContainsGroup(root, group)) preferredRegion = region
      const nextRoot = this._removeGroupFromNode(root, group)
      if (nextRoot === root) continue
      if (region === 'center') {
        this._regions.center = nextRoot ?? this._createTabGroup('document')
      } else {
        this._regions[region] = nextRoot
      }
    }
    this._resolveActiveGroupAfterRegionMutation(preferredRegion)
  }

  private _resolveActiveGroupAfterRegionMutation(preferredRegion: DockRegion | null): void {
    if (this._containsGroup(this._activeGroup) || this._containsFloatingGroup(this._activeGroup)) return
    const preferredRoot = preferredRegion ? this._regions[preferredRegion] : null
    const preferredGroup = preferredRoot ? this._firstGroup(preferredRoot) : null
    this._activeGroup = preferredGroup ?? this._firstGroup(this._regions.center) ?? this._regions.center as DockWorkbenchTabGroupNode
  }

  private _removeGroupFromNode(node: DockRegionNode, group: DockWorkbenchTabGroupNode): DockRegionNode | null {
    if (node === group) return null
    if (node.type === 'tabs') return node
    const first = this._removeGroupFromNode(node.first, group)
    const second = this._removeGroupFromNode(node.second, group)
    if (first && second) {
      node.first = first
      node.second = second
      return node
    }
    return first ?? second
  }

  private _removeWindowFromNode(node: DockRegionNode, window: RenderWindow): void {
    if (node.type === 'tabs') {
      const index = node.items.indexOf(window)
      if (index < 0) return
      node.items.splice(index, 1)
      if (node.activeItem === window) {
        node.activeItem = node.items[index - 1] ?? node.items[index] ?? null
      }
      return
    }
    this._removeWindowFromNode(node.first, window)
    this._removeWindowFromNode(node.second, window)
  }

  private _pruneEmptyGroups(node: DockRegionNode, preserveEmptyGroup?: DockWorkbenchTabGroupNode): DockRegionNode | null {
    if (node.type === 'tabs') return node.items.length > 0 || node === preserveEmptyGroup ? node : null
    const first = this._pruneEmptyGroups(node.first, preserveEmptyGroup)
    const second = this._pruneEmptyGroups(node.second, preserveEmptyGroup)
    if (first && second) {
      node.first = first
      node.second = second
      return node
    }
    return first ?? second
  }

  private _findGroupContaining(window: RenderWindow): { region: DockRegion; group: DockWorkbenchTabGroupNode } | null {
    for (const region of ['left', 'center', 'right', 'bottom'] as const) {
      const root = this._regions[region]
      if (!root) continue
      const group = this._findGroupContainingInNode(root, window)
      if (group) return { region, group }
    }
    return null
  }

  private _findRegionForGroup(group: DockWorkbenchTabGroupNode): { region: DockRegion; group: DockWorkbenchTabGroupNode } | null {
    for (const region of ['left', 'center', 'right', 'bottom'] as const) {
      const root = this._regions[region]
      if (root && this._nodeContainsGroup(root, group)) return { region, group }
    }
    return null
  }

  private _adjacentGroupForItem(
    itemId: string,
    direction: DockWorkbenchAdjacentDirection,
  ): { region: DockRegion; group: DockWorkbenchTabGroupNode } | null {
    const record = this._recordForItem(itemId)
    if (!record) return null
    const source = this._findGroupContaining(record.window)
    if (!source) return null
    const root = this._regions[source.region]
    if (!root) return null
    const groups = this._groupsInNode(root)
    const index = groups.indexOf(source.group)
    if (index < 0) return null
    const nextIndex = direction === 'previous' ? index - 1 : index + 1
    const group = groups[nextIndex]
    return group ? { region: source.region, group } : null
  }

  private _findFloatingGroupContaining(window: RenderWindow): DockWorkbenchFloatingGroupRuntime | null {
    for (const group of this._floatingGroups.values()) {
      if (this._findGroupContainingInNode(group.root, window)) return group
    }
    return null
  }

  private _findFloatingRuntimeForGroup(group: DockWorkbenchTabGroupNode): DockWorkbenchFloatingGroupRuntime | null {
    for (const runtime of this._floatingGroups.values()) {
      if (this._nodeContainsGroup(runtime.root, group)) return runtime
    }
    return null
  }

  private _findFloatingGroupByHost(window: RenderWindow): DockWorkbenchFloatingGroupRuntime | null {
    for (const group of this._floatingGroups.values()) {
      if (group.window === window) return group
    }
    return null
  }

  private _findGroupContainingInNode(node: DockRegionNode, window: RenderWindow): DockWorkbenchTabGroupNode | null {
    if (node.type === 'tabs') return node.items.includes(window) ? node : null
    return this._findGroupContainingInNode(node.first, window) ?? this._findGroupContainingInNode(node.second, window)
  }

  private _groupsInNode(node: DockRegionNode): DockWorkbenchTabGroupNode[] {
    if (node.type === 'tabs') return [node]
    return [...this._groupsInNode(node.first), ...this._groupsInNode(node.second)]
  }

  private _itemsInNode(node: DockRegionNode): RenderWindow[] {
    if (node.type === 'tabs') return [...node.items]
    return [...this._itemsInNode(node.first), ...this._itemsInNode(node.second)]
  }

  private _containsGroup(group: DockWorkbenchTabGroupNode): boolean {
    for (const region of ['left', 'center', 'right', 'bottom'] as const) {
      const root = this._regions[region]
      if (root && this._nodeContainsGroup(root, group)) return true
    }
    return false
  }

  private _containsFloatingGroup(group: DockWorkbenchTabGroupNode): boolean {
    for (const runtime of this._floatingGroups.values()) {
      if (this._nodeContainsGroup(runtime.root, group)) return true
    }
    return false
  }

  private _nodeContainsGroup(node: DockRegionNode, group: DockWorkbenchTabGroupNode): boolean {
    if (node.type === 'tabs') return node === group
    return this._nodeContainsGroup(node.first, group) || this._nodeContainsGroup(node.second, group)
  }

  private _replaceNode(node: DockRegionNode, target: DockRegionNode, replacement: DockRegionNode): DockRegionNode {
    if (node === target) return replacement
    if (node.type === 'tabs') return node
    if (node.first === target) {
      node.first = replacement
      return node
    }
    if (node.second === target) {
      node.second = replacement
      return node
    }
    node.first = this._replaceNode(node.first, target, replacement)
    node.second = this._replaceNode(node.second, target, replacement)
    return node
  }

  private _replaceRegionNode(region: DockRegion, target: DockRegionNode, replacement: DockRegionNode): boolean {
    if (this._regions[region] === target) {
      this._regions[region] = replacement
      return true
    }
    const visit = (node: DockRegionNode): boolean => {
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
    const root = this._regions[region]
    return root ? visit(root) : false
  }

  private _dockFloatingGroupToRegion(runtime: DockWorkbenchFloatingGroupRuntime, targetRegion: DockRegion): void {
    const existing = this._regions[targetRegion]
    if (!existing) {
      this._regions[targetRegion] = runtime.root
      return
    }
    const first = this._firstGroup(existing)
    if (runtime.root.type === 'tabs' && first && first.kind === runtime.root.kind) {
      this._mergeFloatingGroupIntoTarget(runtime, first)
      return
    }
    const split: DockWorkbenchSplitNode = {
      type: 'split',
      id: nextNodeId('workbench-split'),
      direction: targetRegion === 'bottom' ? 'vertical' : 'horizontal',
      ratio: targetRegion === 'right' || targetRegion === 'bottom' ? 1 - dockWorkbenchNewGroupRatio : dockWorkbenchNewGroupRatio,
      first: targetRegion === 'right' || targetRegion === 'bottom' ? existing : runtime.root,
      second: targetRegion === 'right' || targetRegion === 'bottom' ? runtime.root : existing,
    }
    this._regions[targetRegion] = split
  }

  private _appendGroupToRegion(
    existing: DockRegionNode | null,
    group: DockWorkbenchTabGroupNode,
    region: Exclude<DockRegion, 'center'>,
  ): DockRegionNode {
    if (!existing) return group
    return {
      type: 'split',
      id: nextNodeId('workbench-split'),
      direction: region === 'bottom' ? 'vertical' : 'horizontal',
      ratio: region === 'right' || region === 'bottom' ? 1 - dockWorkbenchNewGroupRatio : dockWorkbenchNewGroupRatio,
      first: region === 'right' || region === 'bottom' ? existing : group,
      second: region === 'right' || region === 'bottom' ? group : existing,
    }
  }

  private _dockFloatingGroupToDropTarget(runtime: DockWorkbenchFloatingGroupRuntime, target: DockWorkbenchDropTarget): void {
    if (target.zone === 'center') {
      if (runtime.root.type === 'tabs') {
        this._mergeFloatingGroupIntoTarget(runtime, target.group)
      } else {
        for (const group of this._groupsInNode(runtime.root)) {
          for (const window of group.items) {
            if (!target.group.items.includes(window)) target.group.items.push(window)
          }
        }
        target.group.activeItem = runtime.group.activeItem ?? target.group.activeItem
        runtime.root = target.group
        runtime.group = target.group
      }
      return
    }
    const sibling = target.scope === 'document-area'
      ? this._regions[target.region]
      : target.group
    if (!sibling) {
      this._regions[target.region] = runtime.root
      return
    }
    const direction: SplitDirection = target.zone === 'left' || target.zone === 'right' ? 'horizontal' : 'vertical'
    const split: DockWorkbenchSplitNode = {
      type: 'split',
      id: nextNodeId('workbench-split'),
      direction,
      ratio: this._splitRatioForZone(target.zone),
      first: target.zone === 'left' || target.zone === 'top' ? runtime.root : sibling,
      second: target.zone === 'left' || target.zone === 'top' ? sibling : runtime.root,
    }
    if (target.scope === 'document-area') {
      this._regions[target.region] = split
      return
    }
    this._replaceRegionNode(target.region, target.group, split)
  }

  private _mergeFloatingGroupIntoTarget(runtime: DockWorkbenchFloatingGroupRuntime, targetGroup: DockWorkbenchTabGroupNode): void {
    for (const window of runtime.group.items) {
      if (!targetGroup.items.includes(window)) targetGroup.items.push(window)
    }
    targetGroup.activeItem = runtime.group.activeItem ?? runtime.group.items[runtime.group.items.length - 1] ?? targetGroup.activeItem
    runtime.group = targetGroup
    runtime.root = targetGroup
  }

  private _canDockFloatingGroupToTarget(rootNode: DockRegionNode, target: DockWorkbenchDropTarget): boolean {
    if (!this._canDockNodeToRegion(rootNode, target.region)) return false
    const root = this._regions[target.region]
    if (target.scope !== 'workbench' && (!root || !this._nodeContainsGroup(root, target.group))) return false
    if (target.zone === 'center' && this._groupsInNode(rootNode).some(group => group.kind !== target.group.kind)) return false
    return true
  }

  private _canDockRecordToRegion(record: DockItemRecord, region: DockRegion): boolean {
    if (record.kind === 'document' && region !== 'center' && !record.mixedDockingAllowed) return false
    if (record.kind === 'tool' && region === 'center' && !record.mixedDockingAllowed) return false
    return true
  }

  private _canDockRecordToDropTarget(record: DockItemRecord, target: DockWorkbenchDropTarget): boolean {
    if (target.zone !== 'center' && target.group.items.length === 1 && target.group.items[0] === record.window) {
      return false
    }
    const floatingRuntime = this._findFloatingRuntimeForGroup(target.group)
    if (floatingRuntime) {
      return this._groupsInNode(floatingRuntime.root).every(group => group.kind === record.kind)
    }
    return this._canDockRecordToRegion(record, target.region)
  }

  private _canDockGroupToRegion(group: DockWorkbenchTabGroupNode, region: DockRegion): boolean {
    const records = group.items
      .map(window => this._records.get(window))
      .filter((record): record is DockItemRecord => record !== undefined)
    if (records.length !== group.items.length) return false
    return records.every(record => this._canDockRecordToRegion(record, region))
  }

  private _canDockGroupToDropTarget(group: DockWorkbenchTabGroupNode, target: DockWorkbenchDropTarget): boolean {
    const floatingRuntime = this._findFloatingRuntimeForGroup(target.group)
    if (floatingRuntime) {
      return this._groupsInNode(floatingRuntime.root).every(candidate => candidate.kind === group.kind)
    }
    return this._canDockGroupToRegion(group, target.region)
  }

  private _canDockNodeToRegion(node: DockRegionNode, region: DockRegion): boolean {
    return this._groupsInNode(node).every(group => this._canDockGroupToRegion(group, region))
  }

  private _preferredRegionForGroup(group: DockWorkbenchTabGroupNode): DockRegion | null {
    const active = group.activeItem ? this._records.get(group.activeItem) : undefined
    if (active?.lastDockedPlacement) return active.lastDockedPlacement.region
    const first = group.items[0] ? this._records.get(group.items[0]) : undefined
    return first?.lastDockedPlacement?.region ?? first?.preferredRegion ?? null
  }

  private _preferredRegionForNode(node: DockRegionNode): DockRegion | null {
    const active = this._activeGroup && this._nodeContainsGroup(node, this._activeGroup)
      ? this._preferredRegionForGroup(this._activeGroup)
      : null
    if (active) return active
    const first = this._firstGroup(node)
    return first ? this._preferredRegionForGroup(first) : null
  }

  private _splitRatioForZone(zone: DockWorkbenchDropZone): number {
    if (zone === 'right' || zone === 'bottom') return 1 - dockWorkbenchNewGroupRatio
    return dockWorkbenchNewGroupRatio
  }

  private _floatingGroupTitle(group: DockWorkbenchTabGroupNode): string {
    const active = group.activeItem ? this._records.get(group.activeItem) : undefined
    const first = group.items[0] ? this._records.get(group.items[0]) : undefined
    const title = active?.title ?? first?.title ?? 'Floating Group'
    return group.items.length > 1 ? `${title} +${group.items.length - 1}` : title
  }

  private _floatingRootTitle(root: DockRegionNode, activeGroup: DockWorkbenchTabGroupNode): string {
    const active = activeGroup.activeItem ? this._records.get(activeGroup.activeItem) : undefined
    const firstWindow = this._itemsInNode(root)[0]
    const first = firstWindow ? this._records.get(firstWindow) : undefined
    const title = active?.title ?? first?.title ?? 'Floating Group'
    const extraCount = Math.max(0, this._itemsInNode(root).length - 1)
    return extraCount > 0 ? `${title} +${extraCount}` : title
  }

  private _syncFloatingGroupPresentation(
    group: DockWorkbenchFloatingGroupRuntime,
    preserveFocusFor?: RenderWindow,
  ): void {
    group.view.syncRoot(group.root, preserveFocusFor)
    group.window.title = this._floatingRootTitle(group.root, group.group)
    group.window.setShowCloseButton(this._itemsInNode(group.root).some(window =>
      this._records.get(window)?.closable === true))
  }

  private _restoreDragStartFloatingRect(window: RenderWindow): void {
    if (!this._dragStartFloatingRect) return
    window.setWindowBounds(this._dragStartFloatingRect)
  }

  private _firstGroup(node: DockRegionNode): DockWorkbenchTabGroupNode | null {
    if (node.type === 'tabs') return node
    return this._firstGroup(node.first) ?? this._firstGroup(node.second)
  }

  private _detachWindowFromDockParent(window: RenderWindow): void {
    if (
      window.parent instanceof RenderClip &&
      window.parent.parent instanceof RenderWorkbenchTabGroup &&
      window.parent.child === window
    ) {
      window.parent.setChild(undefined)
      return
    }
    if (window.parent instanceof RenderWorkbenchTabGroup) {
      window.parent = undefined
      if (window.owner) window.detach()
    }
  }

  private _syncWindowOwnership(window: RenderWindow): void {
    const floatingGroup = this._findFloatingGroupContaining(window)
    if (floatingGroup) {
      if (window.ownerWindow === this._windowHost && this._windowHost) {
        this._mutateOwnedWindows(this._windowHost, () => this._windowHost?.removeOwnedWindow(window))
      }
      if (this._windowHost && floatingGroup.window.ownerWindow !== this._windowHost) {
        this._mutateOwnedWindows(this._windowHost, () => this._windowHost?.addOwnedWindow(floatingGroup.window))
      }
      return
    }
    if (this._floatingWindows.has(window)) {
      if (this._windowHost && window.ownerWindow !== this._windowHost) {
        this._mutateOwnedWindows(this._windowHost, () => this._windowHost?.addOwnedWindow(window))
      }
      return
    }
    if (window.ownerWindow === this._windowHost && this._windowHost) {
      this._mutateOwnedWindows(this._windowHost, () => this._windowHost?.removeOwnedWindow(window))
    }
  }

  private _mutateOwnedWindows(host: RenderWindow, action: () => void): void {
    const notify = host[renderWindowOwnedMutationInternal](action)
    this._enqueueNotification(notify)
  }

  private _createItemRuntime(definition: {
    itemId: string
    content: RenderBox
    context?: AppContextRegistry
    contextValues?: Exclude<AppContextInitialValues, AppContextRegistry>
    disposeContextOnClose?: boolean
  }): DockItemRuntime {
    const appContext = createAppContextFromOptions(definition)
    const context = this._createDocumentContext(definition.itemId, appContext)
    const contentHost = new RenderAppContextScope({
      context: appContext,
      child: definition.content,
      disposeContextOnDispose: definition.disposeContextOnClose ?? definition.context === undefined,
    })
    return { contentHost, appContext, context }
  }

  private _createDocumentContext(itemId: string, appContext: AppContextRegistry): TabbedDocumentContext {
    const manager = this
    return {
      get tabId() {
        return itemId
      },
      get isActive() {
        return manager.activeItemId === itemId
      },
      get appContext() {
        return appContext
      },
      activateSelf: () => manager.activateItem(itemId),
      requestClose: () => manager.closeItem(itemId),
      update: patch => manager.updateItem(itemId, patch),
      setTitle: title => manager.updateItem(itemId, { title }),
      setDirty: dirty => manager.updateItem(itemId, { dirty }),
      setTooltip: tooltip => manager.updateItem(itemId, { tooltip }),
      setIcon: icon => manager.updateItem(itemId, { icon }),
    }
  }

  private _attachContext(record: DockItemRecord): void {
    this._documentContextAware(record.content)?.attachDocumentContext?.(record.context)
  }

  private _detachContext(record: DockItemRecord): void {
    try {
      this._documentContextAware(record.content)?.detachDocumentContext?.()
    } catch {
      // Detach hooks are user code; manager cleanup must continue.
    }
  }

  private _documentContextAware(content: RenderBox): (RenderBox & TabbedDocumentContextAware) | undefined {
    const candidate = content as RenderBox & Partial<TabbedDocumentContextAware>
    return candidate.attachDocumentContext || candidate.detachDocumentContext
      ? candidate as RenderBox & TabbedDocumentContextAware
      : undefined
  }

  private async _runBeforeClose(record: DockItemRecord): Promise<boolean> {
    try {
      if (record.beforeClose) return await record.beforeClose()
      const lifecycle = record.content as RenderBox & Partial<TabbedDocumentLifecycle>
      if (lifecycle.beforeDocumentClose) return await lifecycle.beforeDocumentClose()
      return true
    } catch {
      return false
    }
  }

  private _notifyItemActivated(
    record: DockItemRecord,
    source: DockWorkbenchCommandSource = this._commandSource,
  ): void {
    const event: DockWorkbenchEvent = {
      type: 'item-activated',
      itemId: record.itemId,
      region: record.placement.mode === 'docked' || record.placement.mode === 'autoHide' ? record.placement.region : undefined,
      placement: { ...record.placement },
      source,
    }
    this._enqueueNotification(() => {
      const lifecycle = record.content as RenderBox & Partial<TabbedDocumentLifecycle>
      try {
        lifecycle.onDocumentActivated?.()
      } catch (error) {
        reportFrameworkInternalError('dock-workbench-lifecycle-activate', error)
      }
      if (this._disposed) return
      try {
        this._restoreItemFocus(record)
      } catch (error) {
        reportFrameworkInternalError('dock-workbench-focus-restore', error)
      }
      if (!this._disposed) this._deliverEvent(event)
    })
  }

  private _notifyItemDeactivated(
    record: DockItemRecord,
    source: DockWorkbenchCommandSource = this._commandSource,
  ): void {
    const event: DockWorkbenchEvent = {
      type: 'item-deactivated',
      itemId: record.itemId,
      region: record.placement.mode === 'docked' || record.placement.mode === 'autoHide' ? record.placement.region : undefined,
      placement: { ...record.placement },
      source,
    }
    this._enqueueNotification(() => {
      try {
        this._rememberItemFocus(record)
      } catch (error) {
        reportFrameworkInternalError('dock-workbench-focus-remember', error)
      }
      const lifecycle = record.content as RenderBox & Partial<TabbedDocumentLifecycle>
      try {
        lifecycle.onDocumentDeactivated?.()
      } catch (error) {
        reportFrameworkInternalError('dock-workbench-lifecycle-deactivate', error)
      }
      if (!this._disposed) this._deliverEvent(event)
    })
  }

  private _rememberItemFocus(record: DockItemRecord): void {
    const current = FocusManager.instance.current
    if (!current) return
    if (FocusManager.instance.focusablesWithinRoots([record.window]).includes(current)) {
      record.lastFocused = current
      FocusManager.instance.clearFocusOf(current)
    }
  }

  private _restoreItemFocus(record: DockItemRecord): void {
    const focusable = record.lastFocused
    if (!focusable) return
    if (!FocusManager.instance.focusablesWithinRoots([record.window]).includes(focusable)) {
      record.lastFocused = undefined
      return
    }
    FocusManager.instance.setFocus(focusable)
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
        reportFrameworkInternalError('dock-workbench-window-focus', error)
      }
    })
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
          reportFrameworkInternalError('dock-workbench-internal-state-listener', error)
        }
      }
      for (const listener of external) {
        try {
          listener()
        } catch (error) {
          reportFrameworkInternalError('dock-workbench-state-listener', error)
        }
      }
    })
    this._drainNotifications()
  }

  private _emitEvent(
    event: DockWorkbenchEvent,
    source: DockWorkbenchCommandSource = this._commandSource,
  ): void {
    const sourcedEvent = { ...event, source } as DockWorkbenchEvent
    this._enqueueNotification(() => this._deliverEvent(sourcedEvent))
  }

  private _deliverEvent(event: DockWorkbenchEvent): void {
    for (const listener of [...this._eventListeners]) {
      try {
        listener(event)
      } catch (error) {
        reportFrameworkInternalError('dock-workbench-event-listener', error)
      }
    }
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
          reportFrameworkInternalError('dock-workbench-notification', error)
        }
      }
    } finally {
      this._notifying = false
    }
  }

  private _canRunBeforeEvent(event: DockWorkbenchBeforeEvent): boolean {
    const sourcedEvent = { source: this._commandSource, ...event }
    const generation = this._generation
    const revision = this._mutationRevision
    const rootPhase = this._beforePhaseDepth === 0
    if (rootPhase) this._beforeReentryAttempted = false
    this._beforePhaseDepth += 1
    let allowed = true
    try {
      for (const listener of [...this._beforeEventListeners]) {
        try {
          if (listener(sourcedEvent) === false) allowed = false
        } catch {
          allowed = false
        }
      }
    } finally {
      this._beforePhaseDepth -= 1
    }
    const reentered = this._beforeReentryAttempted
    if (rootPhase) this._beforeReentryAttempted = false
    return allowed &&
      !reentered &&
      !this._disposed &&
      this._generation === generation &&
      this._mutationRevision === revision
  }

  private _rejectBeforeMutation(): boolean {
    if (this._beforePhaseDepth === 0) return false
    this._beforeReentryAttempted = true
    return true
  }

  private _assertMutationAllowed(operation: string): void {
    if (!this._rejectBeforeMutation()) return
    throw new DockReentrantMutationError(operation)
  }

  runWithCommandSource<T>(source: DockWorkbenchCommandSource, action: () => T): T {
    const previous = this._commandSource
    this._commandSource = source
    try {
      return action()
    } finally {
      this._commandSource = previous
    }
  }

  async runWithCommandSourceAsync<T>(source: DockWorkbenchCommandSource, action: () => Promise<T>): Promise<T> {
    const previous = this._commandSource
    this._commandSource = source
    let promise!: Promise<T>
    try {
      promise = action()
    } finally {
      this._commandSource = previous
    }
    return await promise
  }
}

class RenderWorkbenchTabGroup extends RenderBox implements InteractiveRenderObject {
  static override debugTypeName = 'RenderWorkbenchTabGroup'
  readonly tabs: RenderTabs
  headerActionWidth = 0
  private readonly _bodyClip = new RenderClip()
  private _activeWindow?: RenderWindow
  private _tabContextMenu: MenuPopup | null = null
  private _tabContextMenuItemId = ''
  private _pinButtonRect: Rect | null = null
  private _pinPressed = false
  private _pinHovered = false

  constructor(
    private readonly _manager: DockWorkbenchManager,
    private _group: DockWorkbenchTabGroupNode,
  ) {
    super()
    this.tabs = new RenderTabs({
      tabs: [],
      activeKey: '',
      onTabChange: key => this._manager.runWithCommandSource('button', () => this._manager.activateItem(key)),
      onTabClose: key => {
        void this._manager.runWithCommandSourceAsync('button', () => this._manager.closeItem(key))
      },
      onTabReorder: (key, targetIndex) => {
        const record = this._manager.getItem(key)
        return record
          ? this._manager.runWithCommandSource('drag', () =>
              this._manager.moveItemInGroup(this._group, record.window, targetIndex))
          : false
      },
      onTabDragStart: (key, position) => this._updateTabDockDrag(key, position),
      onTabDragMove: (key, position) => this._updateTabDockDrag(key, position),
      onTabDragEnd: (key, position) => this._endTabDockDrag(key, position),
      onTabDragCancel: key => this._cancelTabDockDrag(key),
      onTabContextMenu: (key, position) => this._showTabContextMenu(key, position),
    })
    this.tabs.parent = this
    this._bodyClip.parent = this
    this.syncGroup(_group)
  }

  get group(): DockWorkbenchTabGroupNode {
    return dockReadonlyView(this._group)
  }

  syncGroup(group: DockWorkbenchTabGroupNode, preserveFocusFor?: RenderWindow): void {
    this._group = group
    const record = group.activeItem ? this._manager.items.find(candidate => candidate.window === group.activeItem) : undefined
    const nextActiveWindow = group.activeItem ?? undefined
    if (this._activeWindow !== nextActiveWindow) {
      if (this._activeWindow && this._activeWindow !== preserveFocusFor) {
        this._clearFocusIfWithin(this._activeWindow)
      }
      if (preserveFocusFor && this._activeWindow === preserveFocusFor && this._bodyClip.child === this._activeWindow) {
        this._bodyClip.child = undefined
        this._activeWindow.parent = undefined
        this._bodyClip.markNeedsLayout()
      }
      if (this._activeWindow?.parent === this) {
        this._activeWindow.parent = undefined
        if (this._activeWindow.owner) this._activeWindow.detach()
      }
      this._activeWindow = nextActiveWindow
      if (nextActiveWindow) {
        nextActiveWindow.setPresentation('tabbed')
      }
      this._bodyClip.setChild(nextActiveWindow)
    }
    this.tabs.tabs = group.items.map(window => {
      const item = this._manager.items.find(candidate => candidate.window === window)
      return {
        key: item?.itemId ?? window.title,
        label: item?.title ?? window.title,
        closable: item?.closable ?? true,
        dirty: item?.dirty ?? false,
        tooltip: item?.tooltip,
        icon: item?.icon,
      } satisfies TabItem
    })
    this.tabs.activeKey = record?.itemId ?? ''
    this.tabs.overflowMode = this._group.kind === 'tool' ? 'icon-strip' : 'menu'
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      visitor(this.tabs)
      visitor(this._bodyClip)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    visitor(this.tabs)
    visitor(this._bodyClip)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveDockWorkbenchStyle(context.theme)
    const width = constraints.maxWidth === Infinity ? 400 : constraints.maxWidth
    const height = constraints.maxHeight === Infinity ? 260 : constraints.maxHeight
    const pinButtonWidth = Math.max(this.headerActionWidth, this._canPinToAutoHide() ? style.headerActionWidth : 0)
    this.tabs.layout({ minWidth: 0, maxWidth: Math.max(0, width - pinButtonWidth), minHeight: 0, maxHeight: height }, true, context)
    this.tabs.offset = { x: 0, y: 0 }
    const bodyHeight = Math.max(0, height - this.tabs.size.height)
    const bodyLayout = resolveChildLayout(
      this._bodyClip,
      { minWidth: width, maxWidth: width, minHeight: bodyHeight, maxHeight: bodyHeight },
      'stretch',
      'stretch',
    )
    this._bodyClip.layout(bodyLayout.constraints, true, context)
    this._bodyClip.positionInSlot({
      x: 0,
      y: this.tabs.size.height,
      width,
      height: bodyHeight,
    }, bodyLayout.horizontalAlignment, bodyLayout.verticalAlignment)
    this.size = { width, height }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveDockWorkbenchStyle(context.theme)
    const dl = new DrawList(context)
    const bodyY = offset.y + this.tabs.size.height
    const bodyHeight = Math.max(0, this.size.height - this.tabs.size.height)
    const active = this._isActivePane()
    const headerBg = active ? context.theme.surfaceWindowTitleActive : context.theme.surfaceWindowTitle
    const border = active ? context.theme.focusBorder : context.theme.borderSubtle
    const borderWidth = 1
    dl.fillRect(offset.x, offset.y, this.size.width, this.tabs.size.height, headerBg, 0)
    const actionWidth = Math.max(this.headerActionWidth, this._canPinToAutoHide() ? style.headerActionWidth : 0)
    if (actionWidth > 0) {
      dl.fillRect(
        offset.x + Math.max(0, this.size.width - actionWidth),
        offset.y,
        actionWidth,
        this.tabs.size.height,
        context.theme.surfaceWindowTitle,
        0,
      )
    }
    dl.fillRect(offset.x, bodyY, this.size.width, bodyHeight, context.theme.surfaceContent, 0)
    dl.line(offset.x, bodyY + 0.5, offset.x + this.size.width, bodyY + 0.5, border, borderWidth)
    this.paintContentChildren(context, offset)
    this._paintPinButton(context, offset)
    new DrawList(context).strokeRect(offset.x, offset.y, this.size.width, this.size.height, border, borderWidth, 0)
  }

  onPointerDown(event: PointerEvent): void {
    if (!this._pinButtonHitTest(event.position)) return
    this._pinPressed = true
    this.markNeedsPaint()
  }

  onPointerMove(event: PointerEvent): void {
    const hovered = this._pinButtonHitTest(event.position)
    if (hovered === this._pinHovered) return
    this._pinHovered = hovered
    this.markNeedsPaint()
  }

  onPointerUp(event: PointerEvent): void {
    const pressed = this._pinPressed
    this._pinPressed = false
    if (!pressed) return
    this.markNeedsPaint()
    if (this._pinButtonHitTest(event.position)) this._pinToAutoHide()
  }

  onPointerCancel(_event: PointerEvent): void {
    if (!this._pinPressed && !this._pinHovered) return
    this._pinPressed = false
    this._pinHovered = false
    this.markNeedsPaint()
  }

  onPointerLeave(_event: PointerEvent): void {
    if (!this._pinHovered) return
    this._pinHovered = false
    this.markNeedsPaint()
  }

  disposeDetached(): void {
    this._dismissTabContextMenu()
    this._pinButtonRect = null
    this._pinPressed = false
    this._pinHovered = false
    if (this._activeWindow) {
      this._bodyClip.setChild(undefined)
      this._activeWindow = undefined
    }
    this.tabs.parent = undefined
    if (this.tabs.owner) this.tabs.detach()
    this._bodyClip.parent = undefined
    if (this._bodyClip.owner) this._bodyClip.detach()
  }

  override dispose(): void {
    this.disposeDetached()
    super.dispose()
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

  private _isActivePane(): boolean {
    const activeItem = this._manager.activeItem
    return activeItem ? this._group.items.includes(activeItem.window) : false
  }

  private _canPinToAutoHide(): boolean {
    if (this._group.kind !== 'tool' || this._group.items.length === 0) return false
    const records = this._group.items
      .map(window => this._manager.items.find(candidate => candidate.window === window))
      .filter((candidate): candidate is DockItemRecord => candidate !== undefined)
    if (records.length !== this._group.items.length) return false
    return records.every(record =>
      record.kind === 'tool' &&
      record.autoHideAllowed &&
      record.placement.mode === 'docked' &&
      record.placement.region !== 'center',
    )
  }

  private _pinToAutoHide(): void {
    if (!this._canPinToAutoHide()) return
    this._manager.runWithCommandSource('button', () => {
      if (this._group.items.length > 1) {
        this._manager.autoHideGroup(this._group)
        return
      }
      const record = this._group.items[0] ? this._manager.items.find(candidate => candidate.window === this._group.items[0]) : undefined
      if (record) this._manager.autoHideItem(record.itemId)
    })
  }

  private _paintPinButton(context: PaintContext, offset: Offset): void {
    if (!this._canPinToAutoHide()) {
      this._pinButtonRect = null
      this._pinPressed = false
      this._pinHovered = false
      return
    }
    const style = deriveDockWorkbenchStyle(context.theme)
    const size = style.pinButtonSize
    const rect = {
      x: offset.x + this.size.width - size - 5,
      y: offset.y + Math.max(2, Math.round((this.tabs.size.height - size) / 2)),
      width: size,
      height: size,
    }
    this._pinButtonRect = rect
    paintDockWorkbenchPinButton(context, rect, this._pinHovered || this._pinPressed, this._pinPressed)
  }

  private _pinButtonHitTest(position: Offset): boolean {
    const rect = this._pinButtonRect
    return !!rect &&
      position.x >= rect.x &&
      position.x < rect.x + rect.width &&
      position.y >= rect.y &&
      position.y < rect.y + rect.height
  }

  private _updateTabDockDrag(itemId: string, position: Offset): void {
    const record = this._manager.getItem(itemId)
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

  private _endTabDockDrag(itemId: string, position: Offset): void {
    const record = this._manager.getItem(itemId)
    if (!record) return
    if (!this._manager.isDraggingWindow(record.window)) return
    this._manager.endDrag(position)
  }

  private _cancelTabDockDrag(itemId: string): void {
    const record = this._manager.getItem(itemId)
    if (!record) return
    this._manager.cancelDrag(record.window)
  }

  private _showTabContextMenu(itemId: string, position: Offset): boolean {
    if (!this._manager.hasItem(itemId)) return false
    this._dismissTabContextMenu()
    const menu = new MenuPopup({
      items: this._tabContextMenuItems(itemId),
      onSelect: key => {
        this._dismissTabContextMenu()
        void this._handleTabContextMenuAction(itemId, key as DockWorkbenchContextMenuAction, position)
      },
      position: () => ({ ...position }),
      bounds: popupContext => popupViewportRect(popupContext),
      onClose: () => {
        if (this._tabContextMenu === menu) {
          this._tabContextMenu = null
          this._tabContextMenuItemId = ''
        }
      },
    })
    this._tabContextMenu = menu
    this._tabContextMenuItemId = itemId
    menu.open()
    return true
  }

  private _tabContextMenuItems(itemId: string): ContextMenuEntry[] {
    const record = this._manager.getItem(itemId)
    const groupRecords = this._group.items
      .map(window => this._manager.items.find(candidate => candidate.window === window))
      .filter((candidate): candidate is DockItemRecord => candidate !== undefined)
    const index = groupRecords.findIndex(candidate => candidate.itemId === itemId)
    const hasClosableOther = groupRecords.some(candidate => candidate.itemId !== itemId && candidate.closable)
    const hasClosableRight = index >= 0 && groupRecords.slice(index + 1).some(candidate => candidate.closable)
    const hasClosableInGroup = groupRecords.some(candidate => candidate.closable)
    const isAutoHideOverlayGroup = groupRecords.length > 0 && groupRecords.every(candidate => candidate.placement.mode === 'autoHide')
    const isDockedGroup = groupRecords.length > 0 && groupRecords.every(candidate => candidate.placement.mode === 'docked')
    const dockedRegions = new Set(groupRecords
      .map(candidate => candidate.placement.mode === 'docked' ? candidate.placement.region : null)
      .filter((region): region is DockRegion => region !== null))
    const dockedToolRegion = isDockedGroup &&
      this._group.kind === 'tool' &&
      dockedRegions.size === 1 &&
      !dockedRegions.has('center')
    const canCreateGroup = !!record && this._group.items.length > 1 && !isAutoHideOverlayGroup
    const canMoveToolRegion = record?.kind === 'tool' && record.placement.mode !== 'autoHide'
    const canMovePreviousGroup = record ? this._manager.canMoveItemToAdjacentGroup(record.itemId, 'previous') : false
    const canMoveNextGroup = record ? this._manager.canMoveItemToAdjacentGroup(record.itemId, 'next') : false
    const canAutoHideItem = record?.kind === 'tool' &&
      record.autoHideAllowed === true &&
      record.placement.mode === 'docked' &&
      record.placement.region !== 'center'
    const canFloatItem = record?.floatable === true && record.placement.mode !== 'autoHide'
    const canAutoHideGroup = dockedToolRegion &&
      groupRecords.length > 1 &&
      groupRecords.every(candidate => candidate.kind === 'tool' && candidate.autoHideAllowed && candidate.placement.mode !== 'autoHide')
    const autoHideGroupId = record ? this._manager.autoHideItems.find(item => item.itemId === record.itemId)?.groupId : undefined
    return [
      {
        key: 'auto-hide',
        label: '自动隐藏',
        disabled: !canAutoHideItem,
      },
      {
        key: 'auto-hide-group',
        label: '自动隐藏标签组',
        disabled: !canAutoHideGroup,
      },
      {
        key: 'pin',
        label: '固定停靠',
        disabled: record?.placement.mode !== 'autoHide',
      },
      {
        key: 'pin-group',
        label: '固定标签组',
        disabled: !autoHideGroupId,
      },
      { separator: true },
      {
        key: 'float',
        label: '浮动窗口',
        disabled: !canFloatItem,
      },
      {
        key: 'float-group',
        label: '浮动标签组',
        disabled: !canCreateGroup || !isDockedGroup || groupRecords.some(candidate => !candidate.floatable),
      },
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
      {
        key: 'move-previous-group',
        label: '移动到上一个标签组',
        disabled: !canMovePreviousGroup,
      },
      {
        key: 'move-next-group',
        label: '移动到下一个标签组',
        disabled: !canMoveNextGroup,
      },
      { separator: true },
      {
        key: 'move-left',
        label: '移动到左侧工具区',
        disabled: !canMoveToolRegion || record?.placement.mode === 'docked' && record.placement.region === 'left',
      },
      {
        key: 'move-right',
        label: '移动到右侧工具区',
        disabled: !canMoveToolRegion || record?.placement.mode === 'docked' && record.placement.region === 'right',
      },
      {
        key: 'move-bottom',
        label: '移动到底部工具区',
        disabled: !canMoveToolRegion || record?.placement.mode === 'docked' && record.placement.region === 'bottom',
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
        key: 'close-group',
        label: '关闭当前标签组',
        disabled: !hasClosableInGroup,
      },
    ]
  }

  private async _handleTabContextMenuAction(
    itemId: string,
    action: DockWorkbenchContextMenuAction,
    position: Offset,
  ): Promise<void> {
    return this._manager.runWithCommandSourceAsync('menu', () => this._handleTabContextMenuActionCore(itemId, action, position))
  }

  private async _handleTabContextMenuActionCore(
    itemId: string,
    action: DockWorkbenchContextMenuAction,
    position: Offset,
  ): Promise<void> {
    const record = this._manager.getItem(itemId)
    if (!record) return
    const groupRecords = this._group.items
      .map(window => this._manager.items.find(candidate => candidate.window === window))
      .filter((candidate): candidate is DockItemRecord => candidate !== undefined)
    const index = groupRecords.findIndex(candidate => candidate.itemId === itemId)
    switch (action) {
      case 'auto-hide':
        this._manager.autoHideItem(record.itemId)
        return
      case 'auto-hide-group':
        this._manager.autoHideGroup(this._group)
        return
      case 'pin':
        this._manager.dockAutoHideItem(record.itemId)
        return
      case 'pin-group': {
        const groupId = this._manager.autoHideItems.find(item => item.itemId === record.itemId)?.groupId
        if (groupId) this._manager.dockAutoHideGroup(groupId)
        return
      }
      case 'float':
        this._manager.floatItem(record.itemId, {
          x: position.x,
          y: position.y,
          width: Math.max(record.window.windowWidth, 320),
          height: Math.max(record.window.windowHeight, 220),
        })
        return
      case 'float-group':
        this._manager.floatGroup(this._group, {
          x: position.x,
          y: position.y,
          width: Math.max(record.window.windowWidth, 420),
          height: Math.max(record.window.windowHeight, 260),
        })
        return
      case 'new-vertical-group':
        this._manager.dockItemToGroup(record.itemId, this._group, 'right')
        return
      case 'new-horizontal-group':
        this._manager.dockItemToGroup(record.itemId, this._group, 'bottom')
        return
      case 'move-previous-group':
        this._manager.moveItemToAdjacentGroup(record.itemId, 'previous')
        return
      case 'move-next-group':
        this._manager.moveItemToAdjacentGroup(record.itemId, 'next')
        return
      case 'move-left':
        this._manager.dockItem(record.itemId, 'left')
        return
      case 'move-right':
        this._manager.dockItem(record.itemId, 'right')
        return
      case 'move-bottom':
        this._manager.dockItem(record.itemId, 'bottom')
        return
      case 'close':
        await this._manager.closeItem(itemId)
        return
      case 'close-others':
        await this._manager.closeItems(groupRecords
          .filter(candidate => candidate.itemId !== itemId && candidate.closable)
          .map(candidate => candidate.itemId))
        return
      case 'close-right':
        if (index < 0) return
        await this._manager.closeItems(groupRecords
          .slice(index + 1)
          .filter(candidate => candidate.closable)
          .map(candidate => candidate.itemId))
        return
      case 'close-group':
        await this._manager.closeGroup(this._group)
        return
    }
  }

  private _dismissTabContextMenu(): void {
    const menu = this._tabContextMenu
    this._tabContextMenu = null
    this._tabContextMenuItemId = ''
    menu?.dismiss()
  }
}

class RenderWorkbenchRegionTree extends RenderBox {
  static override debugTypeName = 'RenderWorkbenchRegionTree'
  private _root: DockRegionNode
  private _rootRender: RenderObject | null = null
  private readonly _groupViews = new Map<string, RenderWorkbenchTabGroup>()
  private readonly _splitViews = new Map<string, RenderSplitter>()
  private readonly _unsubscribeDropResolver: () => void

  constructor(
    private readonly _manager: DockWorkbenchManager,
    root: DockRegionNode,
  ) {
    super()
    this._root = root
    this._unsubscribeDropResolver = this._manager.addDropResolver(position => this._hitTestGuide(position))
    this.syncRoot(root)
  }

  syncRoot(root: DockRegionNode, preserveFocusFor?: RenderWindow): void {
    this._root = root
    const usedGroups = new Set<string>()
    const usedSplits = new Set<string>()
    this._rootRender = this._buildRegion(root, usedGroups, usedSplits, preserveFocusFor)
    this._rootRender.parent = this
    for (const [id, view] of [...this._groupViews]) {
      if (usedGroups.has(id)) continue
      view.parent = undefined
      if (view.owner) view.detach()
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

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this._rootRender) visitor(this._rootRender)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this._rootRender) visitor(this._rootRender)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? 460 : constraints.maxWidth
    const height = constraints.maxHeight === Infinity ? 300 : constraints.maxHeight
    this.size = { width, height }
    if (!this._rootRender) return
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

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    dl.fillRect(offset.x, offset.y, this.size.width, this.size.height, context.theme.surfaceCanvas, 0)
    this.paintContentChildren(context, offset)
    if (this._manager.isDragging) {
      const target = this._manager.dropTarget
      if (target && this._nodeContainsGroup(this._root, target.group)) this._paintDropPreview(dl, target)
      const dragPosition = this._manager.dragPosition
      if (dragPosition) this._paintDockGuides(dl, dragPosition, target)
    }
  }

  override dispose(): void {
    this._unsubscribeDropResolver()
    for (const view of this._groupViews.values()) view.dispose()
    this._groupViews.clear()
    for (const splitter of this._splitViews.values()) splitter.disposeKeepingChildren()
    this._splitViews.clear()
    this._rootRender = null
    super.dispose()
  }

  private _buildRegion(
    node: DockRegionNode,
    usedGroups: Set<string>,
    usedSplits: Set<string>,
    preserveFocusFor?: RenderWindow,
  ): RenderObject {
    if (node.type === 'tabs') {
      usedGroups.add(node.id)
      let view = this._groupViews.get(node.id)
      if (!view) {
        view = new RenderWorkbenchTabGroup(this._manager, node)
        this._groupViews.set(node.id, view)
      }
      view.syncGroup(node, preserveFocusFor)
      return view
    }
    usedSplits.add(node.id)
    const first = this._buildRegion(node.first, usedGroups, usedSplits, preserveFocusFor)
    const second = this._buildRegion(node.second, usedGroups, usedSplits, preserveFocusFor)
    let splitter = this._splitViews.get(node.id)
    if (!splitter) {
      splitter = new RenderSplitter({
        first,
        second,
        direction: node.direction,
        ratio: node.ratio,
        onChange: ratio => {
          node.ratio = ratio
        },
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

  private _hitTestGuide(position: Offset): DockWorkbenchDropTarget | null {
    const activeGroup = this._groupViewAt(position)
    if (!activeGroup || activeGroup.tabs.hitTest(position)) return null
    for (const hit of this._groupGuideHits(activeGroup)) {
      if (this._rectContains(hit.guideRect, position)) return hit
    }
    return null
  }

  private _paintDockGuides(dl: DrawList, dragPosition: Offset, target: DockWorkbenchDropTarget | null): void {
    const activeGroup = this._groupViewAt(dragPosition)
    if (!activeGroup || activeGroup.tabs.hitTest(dragPosition)) return
    const hits = this._groupGuideHits(activeGroup)
    const active = hits.some(hit => this._isActiveGuide(hit, target))
    this._paintDockGuideClusterBackdrop(dl, hits, active)
    for (const hit of hits) this._paintDockGuideButton(dl, hit, this._isActiveGuide(hit, target))
  }

  private _paintDropPreview(dl: DrawList, target: DockWorkbenchDropTarget): void {
    const style = deriveDockWorkbenchStyle(this.currentTheme)
    const overlay = target.previewRect ?? this._previewRect(target.rect, target.zone)
    dl.fillRect(overlay.x, overlay.y, overlay.width, overlay.height, style.dropPreviewBg, style.guideRadius)
    dl.strokeRect(overlay.x, overlay.y, overlay.width, overlay.height, style.dropPreviewBorder, 2, style.guideRadius)
  }

  private _groupViewAt(position: Offset): RenderWorkbenchTabGroup | null {
    for (const view of this._groupViews.values()) {
      if (view.hitTest(position)) return view
    }
    return null
  }

  private _groupGuideHits(view: RenderWorkbenchTabGroup): DockWorkbenchGuideHit[] {
    const style = deriveDockWorkbenchStyle(this.currentTheme)
    const arm = dockWorkbenchGuideArm(style)
    const rect = this._viewRect(view)
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    const size = this._guideButtonSizeForScope()
    const region = this._floatingRegionForGroup(view.group)
    return [
      this._guideHit(region, view.group, 'center', rect, this._guideRect(cx, cy, size)),
      this._guideHit(region, view.group, 'left', rect, this._guideRect(cx - arm, cy, size)),
      this._guideHit(region, view.group, 'right', rect, this._guideRect(cx + arm, cy, size)),
      this._guideHit(region, view.group, 'top', rect, this._guideRect(cx, cy - arm, size)),
      this._guideHit(region, view.group, 'bottom', rect, this._guideRect(cx, cy + arm, size)),
    ]
  }

  private _guideHit(
    region: DockRegion,
    group: DockWorkbenchTabGroupNode,
    zone: DockWorkbenchDropZone,
    rect: Rect,
    guideRect: Rect,
  ): DockWorkbenchGuideHit {
    return {
      scope: 'group',
      region,
      group,
      zone,
      rect,
      guideRect,
      previewRect: this._previewRect(rect, zone),
    }
  }

  private _floatingRegionForGroup(group: DockWorkbenchTabGroupNode): DockRegion {
    if (group.kind === 'document') return 'center'
    const window = group.activeItem ?? group.items[0]
    const record = window ? this._manager.items.find(candidate => candidate.window === window) : undefined
    return record?.lastDockedPlacement?.region ?? record?.preferredRegion ?? 'left'
  }

  private _guideButtonSizeForScope(): number {
    return deriveDockWorkbenchStyle(this.currentTheme).floatingGuideButtonSize
  }

  private _guideRect(cx: number, cy: number, size: number): Rect {
    return { x: cx - size / 2, y: cy - size / 2, width: size, height: size }
  }

  private _previewRect(rect: Rect, zone: DockWorkbenchDropZone): Rect {
    if (zone === 'center') return rect
    if (zone === 'left') return { x: rect.x, y: rect.y, width: rect.width * 0.38, height: rect.height }
    if (zone === 'right') return { x: rect.x + rect.width * 0.62, y: rect.y, width: rect.width * 0.38, height: rect.height }
    if (zone === 'top') return { x: rect.x, y: rect.y, width: rect.width, height: rect.height * 0.38 }
    return { x: rect.x, y: rect.y + rect.height * 0.62, width: rect.width, height: rect.height * 0.38 }
  }

  private _paintDockGuideClusterBackdrop(dl: DrawList, hits: DockWorkbenchGuideHit[], active: boolean): void {
    const style = deriveDockWorkbenchStyle(this.currentTheme)
    const rect = this._guideClusterRect(hits, style.floatingGuideClusterPadding)
    dl.fillRect(rect.x, rect.y, rect.width, rect.height, active ? style.groupGuide.clusterActiveBg : style.groupGuide.clusterBg, style.guideRadius)
    dl.strokeRect(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      active ? style.groupGuide.clusterActiveBorder : style.groupGuide.clusterBorder,
      active ? 2 : 1,
      style.guideRadius,
    )
  }

  private _paintDockGuideButton(dl: DrawList, hit: DockWorkbenchGuideHit, active: boolean): void {
    const style = deriveDockWorkbenchStyle(this.currentTheme)
    const rect = hit.guideRect
    const bg = active ? style.guideButtonActiveBg : style.guideButtonBg
    const border = active ? style.guideButtonActiveBorder : style.guideButtonBorder
    dl.fillRect(rect.x, rect.y, rect.width, rect.height, bg, style.guideRadius)
    dl.strokeRect(rect.x, rect.y, rect.width, rect.height, border, active ? 2 : 1, style.guideRadius)
  }

  private _guideClusterRect(hits: DockWorkbenchGuideHit[], padding: number): Rect {
    const left = Math.min(...hits.map(hit => hit.guideRect.x)) - padding
    const top = Math.min(...hits.map(hit => hit.guideRect.y)) - padding
    const right = Math.max(...hits.map(hit => hit.guideRect.x + hit.guideRect.width)) + padding
    const bottom = Math.max(...hits.map(hit => hit.guideRect.y + hit.guideRect.height)) + padding
    return { x: left, y: top, width: right - left, height: bottom - top }
  }

  private _isActiveGuide(hit: DockWorkbenchGuideHit, target: DockWorkbenchDropTarget | null): boolean {
    return !!target && target.group === hit.group && target.zone === hit.zone && (target.scope ?? 'group') === hit.scope
  }

  private _viewRect(view: RenderWorkbenchTabGroup): Rect {
    const origin = view.globalOffset
    return { x: origin.x, y: origin.y, width: view.size.width, height: view.size.height }
  }

  private _rectContains(rect: Rect, position: Offset): boolean {
    return position.x >= rect.x && position.x <= rect.x + rect.width && position.y >= rect.y && position.y <= rect.y + rect.height
  }

  private _nodeContainsGroup(node: DockRegionNode, group: DockWorkbenchTabGroupNode): boolean {
    group = unwrapDockReadonlyView(group)
    if (node.type === 'tabs') return node === group
    return this._nodeContainsGroup(node.first, group) || this._nodeContainsGroup(node.second, group)
  }
}

export class RenderDockWorkbench extends RenderBox implements InteractiveRenderObject {
  static override debugTypeName = 'RenderDockWorkbench'
  readonly manager: DockWorkbenchManager
  private _rootRender: RenderObject | null = null
  private readonly _groupViews = new Map<string, RenderWorkbenchTabGroup>()
  private readonly _splitViews = new Map<string, RenderSplitter>()
  private readonly _autoHideTabRects = new Map<string, Rect>()
  private _autoHidePinButtonRect: Rect | null = null
  private _autoHideOverlayGroup: DockWorkbenchTabGroupNode | null = null
  private _autoHideOverlayView: RenderWorkbenchTabGroup | null = null
  private _autoHidePressedItemId: string | null = null
  private _autoHidePinPressed = false
  private _autoHidePinHovered = false
  private _autoHideHoveredItemId: string | null = null
  private _autoHidePendingItemId: string | null = null
  private _autoHideHoverTimer: ReturnType<typeof setTimeout> | null = null
  private _autoHideDismissTimer: ReturnType<typeof setTimeout> | null = null
  private _unsubscribe?: () => void
  private readonly _disposeManagerOnDispose: boolean
  private readonly _windowKeyHandler = (target: Focusable, event: KeyboardEvent): boolean =>
    this.handleUnhandledKeyDownFromDescendant(target, event)

  constructor(options: {
    manager: DockWorkbenchManager
    disposeManagerOnDispose?: boolean
  }) {
    super()
    this.manager = options.manager
    this._disposeManagerOnDispose = options.disposeManagerOnDispose ?? false
    this.manager.setDropResolver(position => this._resolveDropTarget(position))
    this.manager.setUnhandledKeyDownHandler(this._windowKeyHandler)
    this._unsubscribe = this.manager[dockWorkbenchManagerInternal]().subscribe(() => this._syncRenderTree())
    this._syncRenderTree()
  }

  handleUnhandledKeyDownFromDescendant(_target: Focusable, event: KeyboardEvent): boolean {
    if (event.key === 'Escape' && this.manager.isDragging) {
      event.preventDefault()
      return this.manager.cancelActiveDrag()
    }
    if (event.key === 'Escape' && this.manager.activeAutoHideItemId) {
      event.preventDefault()
      return this.manager.runWithCommandSource('keyboard', () => this.manager.hideAutoHideItem())
    }
    if (this._handleKeyboardToolDockCommand(event)) return true
    const usesPrimaryModifier = (event.ctrlKey || event.metaKey) && !event.altKey
    if (!usesPrimaryModifier) return false
    if (this.manager.activeAutoHideItemId && event.shiftKey && (event.key === 'p' || event.key === 'P')) {
      event.preventDefault()
      this.manager.runWithCommandSource('keyboard', () => this._pinActiveAutoHideOverlay())
      return true
    }
    if (this.manager.activeAutoHideGroup && (event.key === 'PageDown' || event.key === 'PageUp')) {
      event.preventDefault()
      return this.manager.runWithCommandSource('keyboard', () => this._activateAdjacentAutoHideItem(event.key === 'PageDown' ? 1 : -1))
    }
    if ((event.key === 'w' || event.key === 'W') && this.manager.activeItem?.closable !== false) {
      event.preventDefault()
      void this.manager.runWithCommandSourceAsync('keyboard', () => this.manager.closeActiveItem())
      return true
    }
    return false
  }

  private _handleKeyboardToolDockCommand(event: KeyboardEvent): boolean {
    if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.shiftKey) return false
    const targetRegion = this._keyboardDockRegion(event.key)
    if (!targetRegion) return false
    const active = this.manager.activeItem
    if (!active || active.kind !== 'tool') return false
    if (active.placement.mode === 'docked' && active.placement.region === targetRegion) return false
    event.preventDefault()
    return this.manager.runWithCommandSource('keyboard', () => this.manager.dockItem(active.itemId, targetRegion))
  }

  private _keyboardDockRegion(key: string): Exclude<DockRegion, 'center'> | null {
    if (key === 'ArrowLeft') return 'left'
    if (key === 'ArrowRight') return 'right'
    if (key === 'ArrowDown') return 'bottom'
    return null
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this._rootRender) visitor(this._rootRender)
      if (this._autoHideOverlayView) visitor(this._autoHideOverlayView)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this._rootRender) visitor(this._rootRender)
    if (this._autoHideOverlayView) visitor(this._autoHideOverlayView)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveDockWorkbenchStyle(context.theme)
    const width = constraints.maxWidth === Infinity ? 840 : constraints.maxWidth
    const height = constraints.maxHeight === Infinity ? 520 : constraints.maxHeight
    this.size = { width, height }
    const rails = this._autoHideRailSizes()
    this._syncWorkbenchSplitterRatios()
    if (this._rootRender) {
      const rootWidth = Math.max(0, width - rails.left - rails.right)
      const rootHeight = Math.max(0, height - rails.bottom)
      if (this._rootRender instanceof RenderBox) {
        const rootLayout = resolveChildLayout(
          this._rootRender,
          { minWidth: rootWidth, maxWidth: rootWidth, minHeight: rootHeight, maxHeight: rootHeight },
          'stretch',
          'stretch',
        )
        this._rootRender.layout(rootLayout.constraints, true, context)
        this._rootRender.positionInSlot(
          { x: rails.left, y: 0, width: rootWidth, height: rootHeight },
          rootLayout.horizontalAlignment,
          rootLayout.verticalAlignment,
        )
      } else {
        this._rootRender.layout(
          { minWidth: 0, maxWidth: rootWidth, minHeight: 0, maxHeight: rootHeight },
          true,
          context,
        )
        this._rootRender.offset = { x: rails.left, y: 0 }
      }
    }
    if (this._autoHideOverlayView) {
      this._autoHideOverlayView.headerActionWidth = style.headerActionWidth
      const rect = this._autoHideOverlayRect()
      const overlayLayout = resolveChildLayout(
        this._autoHideOverlayView,
        { minWidth: rect.width, maxWidth: rect.width, minHeight: rect.height, maxHeight: rect.height },
        'stretch',
        'stretch',
      )
      this._autoHideOverlayView.layout(overlayLayout.constraints, true, context)
      this._autoHideOverlayView.positionInSlot(rect, overlayLayout.horizontalAlignment, overlayLayout.verticalAlignment)
    }
  }

  private _syncWorkbenchSplitterRatios(): void {
    const bottom = this._splitViews.get('workbench-bottom-split')
    if (bottom) bottom.ratio = this._mainBottomRatio()
    const right = this._splitViews.get('workbench-right-split')
    if (right) right.ratio = this._centerRightRatio()
    const left = this._splitViews.get('workbench-left-split')
    if (left) left.ratio = this._leftMainRatio()
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    dl.fillRect(offset.x, offset.y, this.size.width, this.size.height, context.theme.surfaceCanvas, 0)
    this.paintContentChildren(context, offset)
    const overlayDl = new DrawList(context)
    this._paintAutoHideTabs(context, overlayDl, offset)
    this._paintAutoHideOverlayPin(context, offset)
    if (this.manager.isDragging) {
      const dragDl = new DrawList(context)
      const target = this.manager[dockWorkbenchManagerInternal]().dropTarget
      this._paintDragScrim(dragDl, target)
      if (target) this._paintDropPreview(dragDl, target)
      const dragPosition = this.manager.dragPosition
      if (dragPosition) this._paintDockGuides(dragDl, dragPosition, target)
    }
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
    this._clearAutoHideHoverTimer()
    this._autoHideHoveredItemId = null
    this._clearAutoHideDismissTimer()
    this._disposeAutoHideOverlay()
    this._rootRender = null
    if (this._disposeManagerOnDispose) this.manager.dispose()
    super.dispose()
  }

  private _syncRenderTree(): void {
    const usedGroups = new Set<string>()
    const usedSplits = new Set<string>()
    const render = this._buildWorkbenchRenderTree(usedGroups, usedSplits)
    this._rootRender = render
    if (this._rootRender) this._rootRender.parent = this
    this._syncAutoHideOverlay()

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
    if (this.owner && this._rootRender && this._rootRender.owner !== this.owner) this._rootRender.attach(this.owner)
    if (this.owner && this._autoHideOverlayView && this._autoHideOverlayView.owner !== this.owner) {
      this._autoHideOverlayView.attach(this.owner)
    }
    this.markNeedsLayout()
  }

  onPointerDown(event: PointerEvent): void {
    this._handleAutoHidePointerDown(event)
  }

  onPointerMove(event: PointerEvent): void {
    this._handleAutoHidePointerMove(event)
  }

  onPointerUp(event: PointerEvent): void {
    this._handleAutoHidePointerUp(event)
  }

  onPointerCancel(event: PointerEvent): void {
    this._handleAutoHidePointerCancel(event)
  }

  onPointerDownCapture(event: PointerEvent): void {
    this._handleAutoHidePointerDown(event)
  }

  onPointerMoveCapture(event: PointerEvent): void {
    this._handleAutoHidePointerMove(event)
  }

  onPointerUpCapture(event: PointerEvent): void {
    this._handleAutoHidePointerUp(event)
  }

  onPointerCancelCapture(event: PointerEvent): void {
    this._handleAutoHidePointerCancel(event)
  }

  onPointerLeave(event: PointerEvent): void {
    this._handleAutoHidePointerLeave(event)
  }

  private _handleAutoHidePointerDown(event: PointerEvent): void {
    this._autoHidePinPressed = this._autoHidePinButtonHitTest(event.position)
    if (this._autoHidePinPressed) {
      this._clearAutoHideHoverTimer()
      this._clearAutoHideDismissTimer()
      this.markNeedsPaint()
      event.stopPropagation?.()
      return
    }
    this._autoHidePressedItemId = this._autoHideItemAt(event.position)
    if (this._autoHidePressedItemId) {
      this._clearAutoHideHoverTimer()
      this._clearAutoHideDismissTimer()
      this.markNeedsPaint()
      event.stopPropagation?.()
      return
    }
    if (this.manager.activeAutoHideItemId && !this._autoHideOverlayHitTest(event.position)) {
      this._clearAutoHideHoverTimer()
      this._clearAutoHideDismissTimer()
      event.stopPropagation?.()
    }
  }

  private _handleAutoHidePointerMove(event: PointerEvent): void {
    const pinHovered = this._autoHidePinButtonHitTest(event.position)
    if (pinHovered !== this._autoHidePinHovered) {
      this._autoHidePinHovered = pinHovered
      this.markNeedsPaint()
    }
    if (pinHovered) {
      this._setAutoHideHoveredItem(null)
      this._clearAutoHideHoverTimer()
      this._clearAutoHideDismissTimer()
      event.stopPropagation?.()
      return
    }
    const itemId = this._autoHideItemAt(event.position)
    if (itemId) {
      this._setAutoHideHoveredItem(itemId)
      this._clearAutoHideDismissTimer()
      if (this.manager.activeAutoHideItemId === itemId) {
        this._clearAutoHideHoverTimer()
        event.stopPropagation?.()
        return
      }
      this._scheduleAutoHideHover(itemId)
      event.stopPropagation?.()
      return
    }
    if (this._autoHideOverlayHitTest(event.position)) {
      this._setAutoHideHoveredItem(null)
      this._clearAutoHideHoverTimer()
      this._clearAutoHideDismissTimer()
      return
    }
    this._setAutoHideHoveredItem(null)
    this._clearAutoHideHoverTimer()
    if (this.manager.activeAutoHideItemId) {
      this._scheduleAutoHideDismiss()
      event.stopPropagation?.()
    }
  }

  private _handleAutoHidePointerUp(event: PointerEvent): void {
    if (this._autoHidePinPressed) {
      const pinHit = this._autoHidePinButtonHitTest(event.position)
      this._autoHidePinPressed = false
      this.markNeedsPaint()
      if (pinHit) this.manager.runWithCommandSource('button', () => this._pinActiveAutoHideOverlay())
      this._autoHidePressedItemId = null
      event.stopPropagation?.()
      return
    }
    const itemId = this._autoHideItemAt(event.position)
    if (itemId && itemId === this._autoHidePressedItemId) {
      this._clearAutoHideHoverTimer()
      this._clearAutoHideDismissTimer()
      this.manager.runWithCommandSource('button', () => this.manager.showAutoHideItem(itemId))
      event.stopPropagation?.()
    } else if (!itemId && this.manager.activeAutoHideItemId && !this._autoHideOverlayHitTest(event.position)) {
      this._clearAutoHideHoverTimer()
      this._clearAutoHideDismissTimer()
      this.manager.runWithCommandSource('button', () => this.manager.hideAutoHideItem())
      event.stopPropagation?.()
    }
    if (this._autoHidePressedItemId !== null) {
      this._autoHidePressedItemId = null
      this.markNeedsPaint()
    }
  }

  private _handleAutoHidePointerCancel(event: PointerEvent): void {
    const consumesCancel = this._autoHidePinPressed ||
      this._autoHidePinHovered ||
      this._autoHidePressedItemId !== null ||
      (this.manager.activeAutoHideItemId !== null && !this._autoHideOverlayHitTest(event.position))
    this._clearAutoHideHoverTimer()
    this._clearAutoHideDismissTimer()
    this._autoHidePinPressed = false
    this._autoHidePinHovered = false
    this._autoHidePressedItemId = null
    this._setAutoHideHoveredItem(null)
    if (consumesCancel) this.markNeedsPaint()
    if (consumesCancel) event.stopPropagation?.()
  }

  private _handleAutoHidePointerLeave(_event: PointerEvent): void {
    if (this._autoHidePinHovered) {
      this._autoHidePinHovered = false
      this.markNeedsPaint()
    }
    this._setAutoHideHoveredItem(null)
    this._clearAutoHideHoverTimer()
    if (this.manager.activeAutoHideItemId) this._scheduleAutoHideDismiss()
  }

  private _scheduleAutoHideHover(itemId: string): void {
    if (this._autoHidePendingItemId === itemId && this._autoHideHoverTimer) return
    this._clearAutoHideHoverTimer()
    this._autoHidePendingItemId = itemId
    this._autoHideHoverTimer = setTimeout(() => {
      const pendingItemId = this._autoHidePendingItemId
      this._autoHidePendingItemId = null
      this._autoHideHoverTimer = null
      if (pendingItemId) this.manager.runWithCommandSource('hover', () => this.manager.showAutoHideItem(pendingItemId))
    }, dockWorkbenchAutoHideHoverDelayMs)
  }

  private _scheduleAutoHideDismiss(): void {
    if (this._autoHideDismissTimer) return
    this._autoHideDismissTimer = setTimeout(() => {
      this._autoHideDismissTimer = null
      this.manager.runWithCommandSource('hover', () => this.manager.hideAutoHideItem())
    }, dockWorkbenchAutoHideDismissDelayMs)
  }

  private _clearAutoHideHoverTimer(): void {
    if (this._autoHideHoverTimer) clearTimeout(this._autoHideHoverTimer)
    this._autoHideHoverTimer = null
    this._autoHidePendingItemId = null
  }

  private _setAutoHideHoveredItem(itemId: string | null): void {
    if (this._autoHideHoveredItemId === itemId) return
    this._autoHideHoveredItemId = itemId
    this.markNeedsPaint()
  }

  private _clearAutoHideDismissTimer(): void {
    if (this._autoHideDismissTimer) clearTimeout(this._autoHideDismissTimer)
    this._autoHideDismissTimer = null
  }

  private _syncAutoHideOverlay(): void {
    const record = this.manager.activeAutoHideItem
    if (!record) {
      this._disposeAutoHideOverlay()
      return
    }
    const activeGroup = this.manager.activeAutoHideGroup
    const groupRecords = activeGroup
      ? activeGroup.itemIds
          .map(itemId => this.manager.getItem(itemId))
          .filter((item): item is DockItemRecord => item !== undefined)
      : [record]
    if (groupRecords.length === 0) {
      this._disposeAutoHideOverlay()
      return
    }
    const id = activeGroup ? `auto-hide-group-${activeGroup.id}` : `auto-hide-${record.itemId}`
    const windows = groupRecords.map(item => item.window)
    if (!this._autoHideOverlayGroup || this._autoHideOverlayGroup.id !== id || !this._autoHideOverlayView) {
      this._disposeAutoHideOverlay()
      this._autoHideOverlayGroup = {
        type: 'tabs',
        id,
        kind: 'tool',
        items: windows,
        activeItem: record.window,
      }
      this._autoHideOverlayView = new RenderWorkbenchTabGroup(this.manager, this._autoHideOverlayGroup)
      this._autoHideOverlayView.headerActionWidth = deriveDockWorkbenchStyle(this.currentTheme).headerActionWidth
      this._autoHideOverlayView.parent = this
    } else {
      this._autoHideOverlayGroup.items = windows
      this._autoHideOverlayGroup.activeItem = record.window
      this._autoHideOverlayView.headerActionWidth = deriveDockWorkbenchStyle(this.currentTheme).headerActionWidth
      this._autoHideOverlayView.syncGroup(this._autoHideOverlayGroup)
    }
  }

  private _disposeAutoHideOverlay(): void {
    if (this._autoHideOverlayView) {
      this._autoHideOverlayView.dispose()
      this._autoHideOverlayView = null
    }
    this._autoHideOverlayGroup = null
    this._autoHidePinButtonRect = null
    this._autoHidePinPressed = false
    this._autoHidePinHovered = false
  }

  private _autoHideOverlayRect(): Rect {
    const active = this.manager.activeAutoHideItem
    const region = active?.placement.mode === 'autoHide' ? active.placement.region : 'left'
    const rails = this._autoHideRailSizes()
    const leftRail = rails.left
    const rightRail = rails.right
    const bottomRail = rails.bottom
    if (region === 'bottom') {
      const style = deriveDockWorkbenchStyle(this.currentTheme)
      const height = Math.min(this.size.height - bottomRail, Math.max(style.overlayMinHeight, this.manager.regionLayout.bottomHeight))
      return {
        x: leftRail,
        y: Math.max(0, this.size.height - bottomRail - height),
        width: Math.max(0, this.size.width - leftRail - rightRail),
        height,
      }
    }
    const maxOverlayWidth = Math.max(0, this.size.width - leftRail - rightRail)
    const style = deriveDockWorkbenchStyle(this.currentTheme)
    const width = Math.min(maxOverlayWidth, Math.max(style.overlayMinWidth, region === 'left'
      ? this.manager.regionLayout.leftWidth
      : this.manager.regionLayout.rightWidth))
    return {
      x: region === 'left' ? leftRail : Math.max(leftRail, this.size.width - rightRail - width),
      y: 0,
      width,
      height: Math.max(0, this.size.height - bottomRail),
    }
  }

  private _autoHideRailSizes(): DockWorkbenchAutoHideRailSizes {
    const style = deriveDockWorkbenchStyle(this.currentTheme)
    const sizes: DockWorkbenchAutoHideRailSizes = { left: 0, right: 0, bottom: 0 }
    for (const item of this.manager.autoHideItems) {
      sizes[item.region] = style.autoHideRailSize
    }
    return sizes
  }

  private _autoHideRailRect(region: Exclude<DockRegion, 'center'>, offset: Offset): Rect | null {
    const rails = this._autoHideRailSizes()
    if (rails[region] <= 0) return null
    if (region === 'left') {
      return {
        x: offset.x,
        y: offset.y,
        width: rails.left,
        height: Math.max(0, this.size.height - rails.bottom),
      }
    }
    if (region === 'right') {
      return {
        x: offset.x + this.size.width - rails.right,
        y: offset.y,
        width: rails.right,
        height: Math.max(0, this.size.height - rails.bottom),
      }
    }
    return {
      x: offset.x,
      y: offset.y + this.size.height - rails.bottom,
      width: this.size.width,
      height: rails.bottom,
    }
  }

  private _autoHideOverlayHitTest(position: Offset): boolean {
    if (!this._autoHideOverlayView) return false
    return this._autoHidePinButtonHitTest(position) || this._autoHideOverlayView.hitTest(position)
  }

  private _paintAutoHideOverlayPin(context: PaintContext, offset: Offset): void {
    const active = this.manager.activeAutoHideItem
    if (!active || !this._autoHideOverlayView) {
      this._autoHidePinButtonRect = null
      return
    }
    const overlay = this._autoHideOverlayRect()
    const style = deriveDockWorkbenchStyle(context.theme)
    const size = style.pinButtonSize
    const tabHeight = this._autoHideOverlayView.tabs.size.height || 28
    const rect = {
      x: offset.x + overlay.x + overlay.width - size - 5,
      y: offset.y + overlay.y + Math.max(2, Math.round((tabHeight - size) / 2)),
      width: size,
      height: size,
    }
    this._autoHidePinButtonRect = rect
    paintDockWorkbenchPinButton(context, rect, this._autoHidePinHovered || this._autoHidePinPressed, this._autoHidePinPressed)
  }

  private _autoHidePinButtonHitTest(position: Offset): boolean {
    return !!this._autoHidePinButtonRect && this._rectContains(this._autoHidePinButtonRect, position)
  }

  private _pinActiveAutoHideOverlay(): void {
    const active = this.manager.activeAutoHideItem
    if (!active) return
    this._clearAutoHideHoverTimer()
    this._clearAutoHideDismissTimer()
    const group = this.manager.activeAutoHideGroup
    if (group) {
      this.manager.dockAutoHideGroup(group.id)
      return
    }
    this.manager.dockAutoHideItem(active.itemId)
  }

  private _activateAdjacentAutoHideItem(direction: 1 | -1): boolean {
    const activeItemId = this.manager.activeAutoHideItemId
    const group = this.manager.activeAutoHideGroup
    if (!activeItemId || !group || group.itemIds.length <= 1) return false
    const currentIndex = group.itemIds.indexOf(activeItemId)
    if (currentIndex < 0) return false
    const nextIndex = (currentIndex + direction + group.itemIds.length) % group.itemIds.length
    return this.manager.showAutoHideItem(group.itemIds[nextIndex]!)
  }

  private _autoHideItemAt(position: Offset): string | null {
    for (const [itemId, rect] of this._autoHideTabRects) {
      if (this._rectContains(rect, position)) return itemId
    }
    return null
  }

  private _paintAutoHideTabs(context: PaintContext, dl: DrawList, offset: Offset): void {
    this._autoHideTabRects.clear()
    const byRegion = {
      left: [] as DockWorkbenchAutoHideItem[],
      right: [] as DockWorkbenchAutoHideItem[],
      bottom: [] as DockWorkbenchAutoHideItem[],
    }
    for (const item of this.manager.autoHideItems) byRegion[item.region].push(item)
    this._paintAutoHideRail(context, dl, offset, 'left')
    this._paintAutoHideRail(context, dl, offset, 'right')
    this._paintAutoHideRail(context, dl, offset, 'bottom')
    this._paintVerticalAutoHideTabs(context, dl, offset, 'left', byRegion.left)
    this._paintVerticalAutoHideTabs(context, dl, offset, 'right', byRegion.right)
    this._paintBottomAutoHideTabs(context, dl, offset, byRegion.bottom)
  }

  private _paintAutoHideRail(
    context: PaintContext,
    dl: DrawList,
    offset: Offset,
    region: Exclude<DockRegion, 'center'>,
  ): void {
    const rect = this._autoHideRailRect(region, offset)
    if (!rect) return
    const style = deriveDockWorkbenchStyle(context.theme)
    const bg = style.autoHideRailBg
    const inner = style.autoHideRailInner
    const border = style.autoHideRailBorder
    dl.fillRect(rect.x, rect.y, rect.width, rect.height, bg, 0)
    if (region === 'left') {
      dl.line(rect.x + 1.5, rect.y, rect.x + 1.5, rect.y + rect.height, inner, 1)
      dl.line(rect.x + rect.width - 0.5, rect.y, rect.x + rect.width - 0.5, rect.y + rect.height, border, 1)
    } else if (region === 'right') {
      dl.line(rect.x + rect.width - 1.5, rect.y, rect.x + rect.width - 1.5, rect.y + rect.height, inner, 1)
      dl.line(rect.x + 0.5, rect.y, rect.x + 0.5, rect.y + rect.height, border, 1)
    } else {
      dl.line(rect.x, rect.y + rect.height - 1.5, rect.x + rect.width, rect.y + rect.height - 1.5, inner, 1)
      dl.line(rect.x, rect.y + 0.5, rect.x + rect.width, rect.y + 0.5, border, 1)
    }
  }

  private _paintVerticalAutoHideTabs(
    context: PaintContext,
    dl: DrawList,
    offset: Offset,
    region: 'left' | 'right',
    items: readonly DockWorkbenchAutoHideItem[],
  ): void {
    if (items.length === 0) return
    const rail = this._autoHideRailRect(region, offset)
    if (!rail) return
    const tabWidth = rail.width
    const tabGap = Math.max(2, Math.round(context.theme.itemSpacing / 2))
    const x = rail.x
    let y = rail.y + tabGap
    for (const item of items) {
      const record = this.manager.getItem(item.itemId)
      if (!record) continue
      const metrics = this._autoHideSideTabMetrics(context, record.title, !!record.icon)
      const rect = { x, y, width: tabWidth, height: metrics.height }
      this._autoHideTabRects.set(item.itemId, rect)
      const active = this.manager.activeAutoHideItemId === item.itemId
      this._paintAutoHideTab(context, dl, rect, record, active, region, metrics)
      y += metrics.height + tabGap
    }
  }

  private _paintBottomAutoHideTabs(context: PaintContext, dl: DrawList, offset: Offset, items: readonly DockWorkbenchAutoHideItem[]): void {
    if (items.length === 0) return
    const rail = this._autoHideRailRect('bottom', offset)
    if (!rail) return
    const style = deriveDockWorkbenchStyle(context.theme)
    const tabHeight = rail.height
    const y = rail.y
    const tabGap = Math.max(2, Math.round(context.theme.itemSpacing / 2))
    let x = rail.x + tabGap + 1
    for (const item of items) {
      const record = this.manager.getItem(item.itemId)
      if (!record) continue
      const label = this._shortLabel(record.title, style.autoHideSideTabTextMaxLength)
      const width = Math.min(
        style.autoHideSideTabMaxSize,
        Math.max(
          style.autoHideSideTabBaseSize,
          label.length * style.autoHideSideTabTextUnit + style.autoHideSideTabExtra,
        ),
      )
      const rect = { x, y, width, height: tabHeight }
      this._autoHideTabRects.set(item.itemId, rect)
      const active = this.manager.activeAutoHideItemId === item.itemId
      this._paintAutoHideTab(context, dl, rect, record, active, 'bottom')
      x += width + tabGap
    }
  }

  private _paintAutoHideTab(
    context: PaintContext,
    dl: DrawList,
    rect: Rect,
    record: DockItemRecord,
    active: boolean,
    region: Exclude<DockRegion, 'center'>,
    sideMetrics?: DockWorkbenchAutoHideSideTabMetrics,
  ): void {
    const style = deriveDockWorkbenchStyle(context.theme)
    const state = {
      selected: active,
      hovered: this._autoHideHoveredItemId === record.itemId,
      pressed: this._autoHidePressedItemId === record.itemId,
    }
    const bg = resolveBgColor(style.autoHideTabBg, state)
    const border = resolveBgColor(style.autoHideTabBorder, state)
    const text = resolveTextColor(style.autoHideTabText, state)
    dl.fillRect(rect.x, rect.y, rect.width, rect.height, bg, 0)
    if (region === 'left' || region === 'right') {
      dl.strokeRect(rect.x, rect.y, rect.width, rect.height, border, 1, 0)
      const metrics = sideMetrics ?? this._autoHideSideTabMetrics(context, record.title, !!record.icon)
      if (record.icon) {
        paintIconGlyph(context, {
          name: record.icon,
          x: rect.x + Math.round((rect.width - style.autoHideSideIconSize) / 2),
          y: rect.y + metrics.padding,
          size: style.autoHideSideIconSize,
          color: text,
        })
      }
      this._paintVerticalAutoHideLabel(context, metrics.label, rect, metrics.labelCenterY, text, region)
      return
    }
    dl.strokeRect(rect.x, rect.y, rect.width, rect.height, border, 1, 0)
    const iconX = rect.x + style.autoHideBottomTextInset
    if (record.icon) {
      paintIconGlyph(context, {
        name: record.icon,
        x: iconX,
        y: rect.y + Math.round((rect.height - style.autoHideBottomIconSize) / 2),
        size: style.autoHideBottomIconSize,
        color: text,
      })
    }
    const labelX = record.icon ? iconX + style.autoHideBottomIconSize + style.autoHideBottomIconGap : rect.x + style.autoHideBottomTextInset
    dl.fillText(
      this._shortLabel(record.title, style.autoHideSideTabTextMaxLength),
      labelX,
      rect.y + rect.height / 2,
      text,
      style.autoHideTabFontSize,
      style.autoHideTabFontFamily,
      'left',
      'middle',
      style.autoHideTabFontWeight,
    )
  }

  private _autoHideSideTabMetrics(
    context: PaintContext,
    title: string,
    hasIcon: boolean,
  ): DockWorkbenchAutoHideSideTabMetrics {
    const style = deriveDockWorkbenchStyle(context.theme)
    const requestedLabel = this._shortLabel(title, style.autoHideSideTabTextMaxLength)
    const draw = new DrawList(context)
    const measure = (value: string): number => draw.measureText(
      value,
      style.autoHideTabFontSize,
      style.autoHideTabFontFamily,
      style.autoHideTabFontWeight,
    ).width
    const padding = Math.max(5, Math.round(context.theme.itemSpacing / 2))
    const iconGap = hasIcon ? Math.max(4, Math.round(context.theme.itemSpacing * 0.75)) : 0
    const iconExtent = hasIcon ? style.autoHideSideIconSize + iconGap : 0
    const desiredHeight = padding * 2 + iconExtent + measure(requestedLabel)
    const height = Math.min(
      style.autoHideSideTabMaxSize,
      Math.max(style.autoHideSideTabBaseSize, Math.ceil(desiredHeight)),
    )
    const labelWidth = Math.max(0, height - padding * 2 - iconExtent)
    return {
      height,
      label: ellipsizeText(requestedLabel, labelWidth, measure),
      labelCenterY: padding + iconExtent + labelWidth / 2,
      padding,
    }
  }

  private _paintVerticalAutoHideLabel(
    context: PaintContext,
    label: string,
    rect: Rect,
    labelCenterY: number,
    color: Color,
    region: 'left' | 'right',
  ): void {
    const style = deriveDockWorkbenchStyle(context.theme)
    const ctx = context.ctx
    ctx.save()
    const centerX = rect.x + rect.width / 2
    const centerY = rect.y + labelCenterY
    ctx.translate(centerX, centerY)
    ctx.rotate(region === 'left' ? -Math.PI / 2 : Math.PI / 2)
    new DrawList(context).fillText(
      label,
      0,
      0,
      color,
      style.autoHideTabFontSize,
      style.autoHideTabFontFamily,
      'center',
      'middle',
      style.autoHideTabFontWeight,
    )
    ctx.restore()
  }

  private _shortLabel(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value
    return `${value.slice(0, Math.max(1, maxLength - 3))}...`
  }

  private _buildWorkbenchRenderTree(usedGroups: Set<string>, usedSplits: Set<string>): RenderObject {
    const { left, center, right, bottom } = this.manager[dockWorkbenchManagerInternal]().regions
    const mainRow = this._buildMainRow(left, center, right, usedGroups, usedSplits)
    if (!bottom) return mainRow
    const bottomView = this._buildRegion(bottom, usedGroups, usedSplits)
    const id = 'workbench-bottom-split'
    usedSplits.add(id)
    return this._syncSplitter(id, mainRow, bottomView, 'vertical', this._mainBottomRatio(), ratio => {
      this.manager.runWithCommandSource('drag', () => {
        this.manager.setRegionLayout({
          bottomHeight: this._clampBottomHeight(Math.round(this._splitterContentSize(this._mainBottomSplitHeight()) * (1 - ratio))),
        })
      })
    })
  }

  private _buildMainRow(
    left: DockRegionNode | null,
    center: DockRegionNode,
    right: DockRegionNode | null,
    usedGroups: Set<string>,
    usedSplits: Set<string>,
  ): RenderObject {
    let row = this._buildRegion(center, usedGroups, usedSplits)
    if (right) {
      const rightView = this._buildRegion(right, usedGroups, usedSplits)
      const id = 'workbench-right-split'
      usedSplits.add(id)
      row = this._syncSplitter(id, row, rightView, 'horizontal', this._centerRightRatio(), ratio => {
        this.manager.runWithCommandSource('drag', () => {
          this.manager.setRegionLayout({
            rightWidth: this._clampRightWidth(Math.round(this._splitterContentSize(this._rightSplitWidth()) * (1 - ratio))),
          })
        })
      })
    }
    if (left) {
      const leftView = this._buildRegion(left, usedGroups, usedSplits)
      const id = 'workbench-left-split'
      usedSplits.add(id)
      row = this._syncSplitter(id, leftView, row, 'horizontal', this._leftMainRatio(), ratio => {
        this.manager.runWithCommandSource('drag', () => {
          this.manager.setRegionLayout({
            leftWidth: this._clampLeftWidth(Math.round(this._splitterContentSize(this._leftSplitWidth()) * ratio)),
          })
        })
      })
    }
    return row
  }

  private _buildRegion(node: DockRegionNode, usedGroups: Set<string>, usedSplits: Set<string>): RenderObject {
    if (node.type === 'tabs') {
      usedGroups.add(node.id)
      let view = this._groupViews.get(node.id)
      if (!view) {
        view = new RenderWorkbenchTabGroup(this.manager, node)
        this._groupViews.set(node.id, view)
      }
      view.headerActionWidth = 0
      view.syncGroup(node)
      return view
    }
    usedSplits.add(node.id)
    const first = this._buildRegion(node.first, usedGroups, usedSplits)
    const second = this._buildRegion(node.second, usedGroups, usedSplits)
    return this._syncSplitter(node.id, first, second, node.direction, node.ratio, ratio => {
      node.ratio = ratio
    })
  }

  private _syncSplitter(
    id: string,
    first: RenderObject,
    second: RenderObject,
    direction: SplitDirection,
    ratio: number,
    onChange: (ratio: number) => void,
  ): RenderSplitter {
    let splitter = this._splitViews.get(id)
    if (!splitter) {
      splitter = new RenderSplitter({
        first,
        second,
        direction,
        ratio,
        splitterSize: workbenchSplitterSize,
        onChange,
      })
      this._splitViews.set(id, splitter)
    } else {
      splitter.first = first
      splitter.second = second
      splitter.direction = direction
      splitter.ratio = ratio
      first.parent = splitter
      second.parent = splitter
    }
    return splitter
  }

  private _leftMainRatio(): number {
    return this._clampRatio(this._clampLeftWidth(this.manager.regionLayout.leftWidth) / this._splitterContentSize(this._leftSplitWidth()))
  }

  private _centerRightRatio(): number {
    return this._clampRatio(1 - this._clampRightWidth(this.manager.regionLayout.rightWidth) / this._splitterContentSize(this._rightSplitWidth()))
  }

  private _mainBottomRatio(): number {
    return this._clampRatio(1 - this._clampBottomHeight(this.manager.regionLayout.bottomHeight) / this._splitterContentSize(this._mainBottomSplitHeight()))
  }

  private _clampRatio(value: number): number {
    return Math.max(0.12, Math.min(0.88, Number.isFinite(value) ? value : 0.5))
  }

  private _leftSplitWidth(): number {
    return Math.max(minToolRegionWidth + minCenterWidth, this._workbenchContentWidth())
  }

  private _splitterContentSize(total: number): number {
    return Math.max(1, total - workbenchSplitterSize)
  }

  private _rightSplitWidth(): number {
    const totalWidth = this._workbenchContentWidth()
    const leftWidth = this.manager.regions.left ? this._clampLeftWidth(this.manager.regionLayout.leftWidth) : 0
    const leftSplitter = this.manager.regions.left ? workbenchSplitterSize : 0
    return Math.max(minToolRegionWidth + minCenterWidth, totalWidth - leftWidth - leftSplitter)
  }

  private _mainBottomSplitHeight(): number {
    return Math.max(minToolRegionHeight + minCenterHeight, this._workbenchContentHeight())
  }

  private _clampLeftWidth(width: number): number {
    const totalWidth = this._workbenchContentWidth()
    const rightWidth = this.manager.regions.right ? minToolRegionWidth : 0
    const splitterReserve = workbenchSplitterSize + (this.manager.regions.right ? workbenchSplitterSize : 0)
    return this._clampToolWidth(width, totalWidth - rightWidth - minCenterWidth - splitterReserve)
  }

  private _clampRightWidth(width: number): number {
    const totalWidth = this._workbenchContentWidth()
    const leftWidth = this.manager.regions.left ? this._clampToolWidth(this.manager.regionLayout.leftWidth, totalWidth) : 0
    const splitterReserve = workbenchSplitterSize + (this.manager.regions.left ? workbenchSplitterSize : 0)
    return this._clampToolWidth(width, totalWidth - leftWidth - minCenterWidth - splitterReserve)
  }

  private _clampBottomHeight(height: number): number {
    const available = Math.max(minToolRegionHeight, this._workbenchContentHeight() - minCenterHeight - workbenchSplitterSize)
    return Math.max(minToolRegionHeight, Math.min(available, height))
  }

  private _workbenchContentWidth(): number {
    const rails = this._autoHideRailSizes()
    return Math.max(0, (this.size.width || 840) - rails.left - rails.right)
  }

  private _workbenchContentHeight(): number {
    const rails = this._autoHideRailSizes()
    return Math.max(0, (this.size.height || 520) - rails.bottom)
  }

  private _clampToolWidth(width: number, available: number): number {
    return Math.max(minToolRegionWidth, Math.min(Math.max(minToolRegionWidth, available), width))
  }

  private _resolveDropTarget(position: Offset): DockWorkbenchDropTarget | null {
    return this._hitTestGuide(position)
  }

  private _paintDropPreview(dl: DrawList, target: DockWorkbenchDropTarget): void {
    const style = deriveDockWorkbenchStyle(this.currentTheme)
    const overlay = target.previewRect ?? this._previewRect(target.rect, target.zone)
    dl.fillRect(overlay.x, overlay.y, overlay.width, overlay.height, style.dropPreviewBg, style.guideRadius)
    dl.strokeRect(overlay.x, overlay.y, overlay.width, overlay.height, style.dropPreviewBorder, 2, style.guideRadius)
    dl.strokeRect(
      overlay.x + 3,
      overlay.y + 3,
      Math.max(0, overlay.width - 6),
      Math.max(0, overlay.height - 6),
      style.dropPreviewInnerBorder,
      1,
      Math.max(0, style.guideRadius - 1),
    )
  }

  private _paintDragScrim(dl: DrawList, target: DockWorkbenchDropTarget | null): void {
    const style = deriveDockWorkbenchStyle(this.currentTheme)
    const rect = this._workbenchRect()
    const color = target ? style.dragScrimBg : style.dragScrimRejectedBg
    dl.fillRect(rect.x, rect.y, rect.width, rect.height, color, 0)
  }

  private _paintDockGuides(dl: DrawList, dragPosition: Offset, target: DockWorkbenchDropTarget | null): void {
    if (this._isAutoHideSurfaceAt(dragPosition)) return
    const activeGroup = this._groupViewAt(dragPosition)
    if (activeGroup?.tabs.hitTest(dragPosition)) return
    if (activeGroup) {
      this._paintDockGuideCluster(dl, this._groupGuideHits(activeGroup), target)
    }
    this._paintDockGuideCluster(dl, this._documentAreaGuideHits(), target)
    this._paintDockGuideCluster(dl, this._workbenchGuideHits(), target)
  }

  private _paintDockGuideCluster(dl: DrawList, hits: DockWorkbenchGuideHit[], target: DockWorkbenchDropTarget | null): void {
    const allowed = hits.filter(hit => this._isGuideAllowed(hit))
    if (allowed.length === 0) return
    this._paintDockGuideClusterBackdrop(dl, allowed, allowed.some(hit => this._isActiveGuide(hit, target)))
    for (const hit of allowed) {
      this._paintDockGuideButton(dl, hit, this._isActiveGuide(hit, target))
    }
  }

  private _paintDockGuideClusterBackdrop(dl: DrawList, hits: DockWorkbenchGuideHit[], active: boolean): void {
    const style = deriveDockWorkbenchStyle(this.currentTheme)
    const scope = hits[0]?.scope ?? 'group'
    const scopeStyle = scope === 'workbench'
      ? style.workbenchGuide
      : scope === 'document-area'
        ? style.documentAreaGuide
        : style.groupGuide
    const padding = scopeStyle.clusterPadding
    const rect = this._guideClusterRect(hits, padding)
    dl.fillRect(rect.x, rect.y, rect.width, rect.height, active ? scopeStyle.clusterActiveBg : scopeStyle.clusterBg, style.guideRadius)
    dl.strokeRect(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      active ? scopeStyle.clusterActiveBorder : scopeStyle.clusterBorder,
      active ? 2 : 1,
      style.guideRadius,
    )
  }

  private _paintDockGuideButton(dl: DrawList, hit: DockWorkbenchGuideHit, active: boolean): void {
    const style = deriveDockWorkbenchStyle(this.currentTheme)
    const rect = hit.guideRect
    const bg = active ? style.guideButtonActiveBg : style.guideButtonBg
    const border = active ? style.guideButtonActiveBorder : style.guideButtonBorder
    const icon = active ? style.guideIconActive : style.guideIcon
    const fill = active ? style.guideIconActiveFill : style.guideIconFill
    dl.fillRect(rect.x + 1, rect.y + 2, rect.width, rect.height, active ? style.guideShadowActiveBg : style.guideShadowBg, style.guideRadius)
    dl.fillRect(rect.x, rect.y - 1, rect.width, rect.height, bg, style.guideRadius)
    dl.strokeRect(rect.x, rect.y - 1, rect.width, rect.height, border, active ? 2 : 1, style.guideRadius)
    this._paintDockGuideIcon(dl, hit.zone, {
      x: rect.x + 8,
      y: rect.y + 7,
      width: rect.width - 16,
      height: rect.height - 15,
    }, icon, fill)
  }

  private _paintDockGuideIcon(
    dl: DrawList,
    zone: DockWorkbenchDropZone,
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

  private _isActiveGuide(hit: DockWorkbenchGuideHit, target: DockWorkbenchDropTarget | null): boolean {
    return !!target &&
      target.region === hit.region &&
      target.group === hit.group &&
      target.zone === hit.zone &&
      (target.scope ?? 'group') === hit.scope
  }

  private _hitTestGuide(position: Offset): DockWorkbenchGuideHit | null {
    if (this._isAutoHideSurfaceAt(position)) return null
    const activeGroup = this._groupViewAt(position)
    if (activeGroup && !activeGroup.tabs.hitTest(position)) {
      for (const hit of this._groupGuideHits(activeGroup)) {
        if (this._isGuideAllowed(hit) && this._rectContains(hit.guideRect, position)) return hit
      }
    }
    for (const hit of this._documentAreaGuideHits()) {
      if (this._isGuideAllowed(hit) && this._rectContains(hit.guideRect, position)) return hit
    }
    for (const hit of this._workbenchGuideHits()) {
      if (this._isGuideAllowed(hit) && this._rectContains(hit.guideRect, position)) return hit
    }
    return null
  }

  private _groupViewAt(position: Offset): RenderWorkbenchTabGroup | null {
    for (const view of this._groupViews.values()) {
      if (view.hitTest(position)) return view
    }
    return null
  }

  private _groupGuideHits(view: RenderWorkbenchTabGroup): DockWorkbenchGuideHit[] {
    const style = deriveDockWorkbenchStyle(this.currentTheme)
    const arm = dockWorkbenchGuideArm(style)
    const region = this._regionForGroup(view.group)
    if (!region) return []
    const rect = this._viewRect(view)
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    const size = this._guideButtonSizeForScope('group')
    return [
      this._guideHit('group', region, view.group, 'center', rect, this._guideRect(cx, cy, size)),
      this._guideHit('group', region, view.group, 'left', rect, this._guideRect(cx - arm, cy, size)),
      this._guideHit('group', region, view.group, 'right', rect, this._guideRect(cx + arm, cy, size)),
      this._guideHit('group', region, view.group, 'top', rect, this._guideRect(cx, cy - arm, size)),
      this._guideHit('group', region, view.group, 'bottom', rect, this._guideRect(cx, cy + arm, size)),
    ]
  }

  private _documentAreaGuideHits(): DockWorkbenchGuideHit[] {
    const style = deriveDockWorkbenchStyle(this.currentTheme)
    const arm = dockWorkbenchGuideArm(style)
    const group = this._firstRegionGroup(this.manager[dockWorkbenchManagerInternal]().regions.center)
    if (!group) return []
    const rect = this._regionRenderedRect('center')
    if (!rect) return []
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    const size = this._guideButtonSizeForScope('document-area')
    return [
      this._guideHit('document-area', 'center', group, 'center', rect, this._guideRect(cx, cy, size)),
      this._guideHit('document-area', 'center', group, 'left', rect, this._guideRect(cx - arm, cy, size)),
      this._guideHit('document-area', 'center', group, 'right', rect, this._guideRect(cx + arm, cy, size)),
      this._guideHit('document-area', 'center', group, 'top', rect, this._guideRect(cx, cy - arm, size)),
      this._guideHit('document-area', 'center', group, 'bottom', rect, this._guideRect(cx, cy + arm, size)),
    ]
  }

  private _workbenchGuideHits(): DockWorkbenchGuideHit[] {
    const style = deriveDockWorkbenchStyle(this.currentTheme)
    const group = this._firstRenderedGroup()
    if (!group) return []
    const rect = this._workbenchRect()
    const leftX = rect.x + Math.min(style.guideEdgeInset, Math.max(style.groupGuide.buttonSize, rect.width / 4))
    const rightX = rect.x + rect.width - Math.min(style.guideEdgeInset, Math.max(style.groupGuide.buttonSize, rect.width / 4))
    const bottomY = rect.y + rect.height - Math.min(style.guideEdgeInset, Math.max(style.groupGuide.buttonSize, rect.height / 4))
    const cy = rect.y + rect.height / 2
    const cx = rect.x + rect.width / 2
    const size = this._guideButtonSizeForScope('workbench')
    return [
      this._guideHit('workbench', 'left', group, 'left', rect, this._guideRect(leftX, cy, size), this._workbenchPreviewRect(rect, 'left')),
      this._guideHit('workbench', 'right', group, 'right', rect, this._guideRect(rightX, cy, size), this._workbenchPreviewRect(rect, 'right')),
      this._guideHit('workbench', 'bottom', group, 'bottom', rect, this._guideRect(cx, bottomY, size), this._workbenchPreviewRect(rect, 'bottom')),
    ]
  }

  private _guideHit(
    scope: DockWorkbenchDropScope,
    region: DockRegion,
    group: DockWorkbenchTabGroupNode,
    zone: DockWorkbenchDropZone,
    rect: Rect,
    guideRect: Rect,
    previewRect = this._previewRect(rect, zone),
  ): DockWorkbenchGuideHit {
    return { scope, region, group, zone, rect, guideRect, previewRect }
  }

  private _guideRect(centerX: number, centerY: number, size?: number): Rect {
    const guideSize = size ?? deriveDockWorkbenchStyle(this.currentTheme).groupGuide.buttonSize
    return {
      x: centerX - guideSize / 2,
      y: centerY - guideSize / 2,
      width: guideSize,
      height: guideSize,
    }
  }

  private _guideButtonSizeForScope(scope: DockWorkbenchDropScope): number {
    const style = deriveDockWorkbenchStyle(this.currentTheme)
    if (scope === 'workbench') return style.workbenchGuide.buttonSize
    if (scope === 'document-area') return style.documentAreaGuide.buttonSize
    return style.groupGuide.buttonSize
  }

  private _guideClusterRect(hits: DockWorkbenchGuideHit[], padding: number): Rect {
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const hit of hits) {
      left = Math.min(left, hit.guideRect.x)
      top = Math.min(top, hit.guideRect.y)
      right = Math.max(right, hit.guideRect.x + hit.guideRect.width)
      bottom = Math.max(bottom, hit.guideRect.y + hit.guideRect.height)
    }
    return {
      x: left - padding,
      y: top - padding,
      width: right - left + padding * 2,
      height: bottom - top + padding * 2,
    }
  }

  private _previewRect(rect: Rect, zone: DockWorkbenchDropZone): Rect {
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

  private _workbenchPreviewRect(rect: Rect, region: Exclude<DockRegion, 'center'>): Rect {
    if (region === 'left') {
      const width = Math.min(Math.max(minToolRegionWidth, this.manager.regionLayout.leftWidth), Math.max(minToolRegionWidth, rect.width * 0.42))
      return { x: rect.x, y: rect.y, width, height: rect.height }
    }
    if (region === 'right') {
      const width = Math.min(Math.max(minToolRegionWidth, this.manager.regionLayout.rightWidth), Math.max(minToolRegionWidth, rect.width * 0.42))
      return { x: rect.x + rect.width - width, y: rect.y, width, height: rect.height }
    }
    const height = Math.min(Math.max(minToolRegionHeight, this.manager.regionLayout.bottomHeight), Math.max(minToolRegionHeight, rect.height * 0.42))
    return { x: rect.x, y: rect.y + rect.height - height, width: rect.width, height }
  }

  private _isAutoHideSurfaceAt(position: Offset): boolean {
    return this._autoHideItemAt(position) !== null || this._autoHideOverlayHitTest(position)
  }

  private _isGuideAllowed(hit: DockWorkbenchGuideHit): boolean {
    const draggingGroup = this.manager.draggingGroup
    if (draggingGroup) return this._canGroupDockToRegion(draggingGroup, hit.region)
    const draggingItem = this.manager.draggingItem
    if (!draggingItem) return false
    if (draggingItem.kind === 'document' && hit.region !== 'center' && !draggingItem.mixedDockingAllowed) return false
    if (draggingItem.kind === 'tool' && hit.region === 'center' && !draggingItem.mixedDockingAllowed) return false
    return true
  }

  private _canGroupDockToRegion(group: DockWorkbenchTabGroupNode, region: DockRegion): boolean {
    return group.items.every(window => {
      const item = this.manager.items.find(candidate => candidate.window === window)
      if (!item) return false
      if (item.kind === 'document' && region !== 'center' && !item.mixedDockingAllowed) return false
      if (item.kind === 'tool' && region === 'center' && !item.mixedDockingAllowed) return false
      return true
    })
  }

  private _regionForGroup(group: DockWorkbenchTabGroupNode): DockRegion | null {
    group = unwrapDockReadonlyView(group)
    for (const region of ['left', 'center', 'right', 'bottom'] as const) {
      const root = this.manager[dockWorkbenchManagerInternal]().regions[region]
      if (root && this._nodeContainsGroup(root, group)) return region
    }
    return null
  }

  private _nodeContainsGroup(node: DockRegionNode, group: DockWorkbenchTabGroupNode): boolean {
    if (node.type === 'tabs') return node === group
    return this._nodeContainsGroup(node.first, group) || this._nodeContainsGroup(node.second, group)
  }

  private _workbenchRect(): Rect {
    const origin = this.globalOffset
    return { x: origin.x, y: origin.y, width: this.size.width, height: this.size.height }
  }

  private _viewRect(view: RenderWorkbenchTabGroup): Rect {
    const origin = view.globalOffset
    return { x: origin.x, y: origin.y, width: view.size.width, height: view.size.height }
  }

  private _regionRenderedRect(region: DockRegion): Rect | null {
    let rect: Rect | null = null
    for (const view of this._groupViews.values()) {
      if (this._regionForGroup(view.group) !== region) continue
      const viewRect = this._viewRect(view)
      if (!rect) {
        rect = { ...viewRect }
        continue
      }
      const left = Math.min(rect.x, viewRect.x)
      const top = Math.min(rect.y, viewRect.y)
      const right = Math.max(rect.x + rect.width, viewRect.x + viewRect.width)
      const bottom = Math.max(rect.y + rect.height, viewRect.y + viewRect.height)
      rect = { x: left, y: top, width: right - left, height: bottom - top }
    }
    return rect
  }

  private _firstRenderedGroup(): DockWorkbenchTabGroupNode | null {
    const first = this._groupViews.values().next()
    return first.done ? null : first.value.group
  }

  private _firstRegionGroup(node: DockRegionNode | null): DockWorkbenchTabGroupNode | null {
    if (!node) return null
    return node.type === 'tabs' ? node : this._firstRegionGroup(node.first)
  }

  private _rectContains(rect: Rect, position: Offset): boolean {
    return position.x >= rect.x &&
      position.x <= rect.x + rect.width &&
      position.y >= rect.y &&
      position.y <= rect.y + rect.height
  }
}
