import { RenderBox, resolveChildLayout } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { RenderObject, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import {
  AppContextRegistry,
  type AppContextInitialValues,
} from '../core/app_context'
import { RenderAppContextScope } from '../layout/render_app_context_scope'
import type { IconName } from './icon'
import { RenderTabs, type TabItem } from './tabs'
import { MenuPopup, type ContextMenuEntry } from './menu_popup'
import type { Focusable } from '../core/focus_manager'
import { FocusManager } from '../core/focus_manager'
import { popupViewportRect } from '../core/popup_manager'

type TabbedWorkspaceContextMenuAction =
  | 'close'
  | 'close-others'
  | 'close-right'
  | 'close-all'

export interface TabbedDocumentDefinition {
  tabId: string
  title: string
  content: RenderBox
  context?: AppContextRegistry
  contextValues?: Exclude<AppContextInitialValues, AppContextRegistry>
  disposeContextOnClose?: boolean
  closable?: boolean
  dirty?: boolean
  tooltip?: string
  icon?: IconName
  beforeClose?: () => boolean | Promise<boolean>
}

export interface TabbedDocumentContext {
  readonly tabId: string
  readonly isActive: boolean
  readonly appContext: AppContextRegistry
  activateSelf(): boolean
  requestClose(): Promise<boolean>
  update(patch: TabbedDocumentPatch): boolean
  setTitle(title: string): boolean
  setDirty(dirty: boolean): boolean
  setTooltip(tooltip?: string): boolean
  setIcon(icon?: IconName): boolean
}

export interface TabbedDocumentContextAware {
  attachDocumentContext?(context: TabbedDocumentContext): void
  detachDocumentContext?(): void
}

export interface TabbedDocumentLifecycle {
  beforeDocumentClose?(): boolean | Promise<boolean>
  onDocumentActivated?(): void
  onDocumentDeactivated?(): void
}

export interface TabbedDocumentRecord {
  tabId: string
  title: string
  content: RenderBox
  contentHost: RenderBox
  appContext: AppContextRegistry
  closable: boolean
  dirty: boolean
  tooltip?: string
  icon?: IconName
  beforeClose?: () => boolean | Promise<boolean>
  context: TabbedDocumentContext
}

interface TabbedDocumentRuntime {
  contentHost: RenderBox
  appContext: AppContextRegistry
  context: TabbedDocumentContext
}

export type TabbedDocumentPatch = Partial<Pick<
  TabbedDocumentDefinition,
  'title' | 'closable' | 'dirty' | 'tooltip' | 'icon'
>>

type TabbedDocumentListener = () => void

export class TabbedDocumentManager {
  private _documents: TabbedDocumentRecord[] = []
  private _activeTabId: string | null = null
  private _listeners = new Set<TabbedDocumentListener>()
  private _closingTabIds = new Set<string>()

  get documents(): readonly TabbedDocumentRecord[] {
    return this._documents
  }

  get activeTabId(): string | null {
    return this._activeTabId
  }

  get activeDocument(): TabbedDocumentRecord | undefined {
    return this._documents.find(document => document.tabId === this._activeTabId)
  }

  hasDocument(tabId: string): boolean {
    return this._documents.some(document => document.tabId === tabId)
  }

  getDocument(tabId: string): TabbedDocumentRecord | undefined {
    return this._documents.find(document => document.tabId === tabId)
  }

  subscribe(listener: TabbedDocumentListener): () => void {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  openDocument(definition: TabbedDocumentDefinition): void {
    const existing = this._documents.find(document => document.tabId === definition.tabId)
    if (existing) {
      const changed =
        existing.title !== definition.title ||
        existing.closable !== (definition.closable ?? true) ||
        existing.dirty !== (definition.dirty ?? false) ||
        existing.tooltip !== definition.tooltip ||
        existing.icon !== definition.icon
      existing.title = definition.title
      existing.closable = definition.closable ?? true
      existing.dirty = definition.dirty ?? false
      existing.tooltip = definition.tooltip
      existing.icon = definition.icon
      const activeChanged = this._setActiveTabId(existing.tabId)
      if (activeChanged) {
        this._emit()
        return
      }
      if (changed) this._emit()
      return
    }

    const runtime = this._createDocumentRuntime(definition)
    const record: TabbedDocumentRecord = {
      tabId: definition.tabId,
      title: definition.title,
      content: definition.content,
      contentHost: runtime.contentHost,
      appContext: runtime.appContext,
      closable: definition.closable ?? true,
      dirty: definition.dirty ?? false,
      tooltip: definition.tooltip,
      icon: definition.icon,
      beforeClose: definition.beforeClose,
      context: runtime.context,
    }
    this._documents.push(record)
    this._attachContext(record)
    this._setActiveTabId(record.tabId)
    this._emit()
  }

  activateDocument(tabId: string): boolean {
    if (!this._documents.some(document => document.tabId === tabId)) return false
    if (!this._setActiveTabId(tabId)) return false
    this._emit()
    return true
  }

  async closeDocument(tabId: string): Promise<boolean> {
    if (!this.hasDocument(tabId)) return false
    if (this._closingTabIds.has(tabId)) return false
    const record = this.getDocument(tabId)!
    this._closingTabIds.add(tabId)
    try {
      const allowed = await this._runBeforeClose(record)
      if (!allowed) return false

      const index = this._documents.findIndex(document => document.tabId === tabId)
      if (index < 0) return false
      const latestRecord = this._documents[index]!
      const wasActive = this._activeTabId === tabId
      if (wasActive) {
        this._activeTabId = null
        this._notifyDocumentDeactivated(latestRecord)
      }
      this._documents.splice(index, 1)
      this._detachContext(latestRecord)
      const nextActive = this._resolveFallbackActiveTab(index)
      if (wasActive && nextActive) this._setActiveTabId(nextActive)
      latestRecord.contentHost.dispose()
      this._emit()
      return true
    } finally {
      this._closingTabIds.delete(tabId)
    }
  }

  closeActiveDocument(): Promise<boolean> {
    if (!this._activeTabId) return Promise.resolve(false)
    return this.closeDocument(this._activeTabId)
  }

  activateRelativeDocument(dir: 1 | -1): boolean {
    if (this._documents.length === 0) return false
    if (this._documents.length === 1) return true
    const currentIndex = Math.max(0, this._documents.findIndex(document => document.tabId === this._activeTabId))
    let nextIndex = currentIndex + dir
    if (nextIndex < 0) nextIndex = this._documents.length - 1
    if (nextIndex >= this._documents.length) nextIndex = 0
    const next = this._documents[nextIndex]
    return next ? this.activateDocument(next.tabId) : false
  }

  moveDocument(tabId: string, targetIndex: number): boolean {
    const currentIndex = this._documents.findIndex(document => document.tabId === tabId)
    if (currentIndex < 0) return false
    const [record] = this._documents.splice(currentIndex, 1)
    const clampedIndex = Math.max(0, Math.min(this._documents.length, targetIndex))
    this._documents.splice(clampedIndex, 0, record!)
    if (currentIndex !== clampedIndex) this._emit()
    return currentIndex !== clampedIndex
  }

  setDocuments(definitions: TabbedDocumentDefinition[]): void {
    const nextTabIds = new Set<string>()
    for (const definition of definitions) {
      if (nextTabIds.has(definition.tabId)) {
        throw new Error(`Duplicate tabbed document tabId "${definition.tabId}".`)
      }
      nextTabIds.add(definition.tabId)
    }
    const previousActive = this.activeDocument
    this._activeTabId = null
    if (previousActive) this._notifyDocumentDeactivated(previousActive)
    for (const document of this._documents) {
      this._detachContext(document)
      document.contentHost.dispose()
    }
    this._documents = definitions.map(definition => {
      const runtime = this._createDocumentRuntime(definition)
      return {
        tabId: definition.tabId,
        title: definition.title,
        content: definition.content,
        contentHost: runtime.contentHost,
        appContext: runtime.appContext,
        closable: definition.closable ?? true,
        dirty: definition.dirty ?? false,
        tooltip: definition.tooltip,
        icon: definition.icon,
        beforeClose: definition.beforeClose,
        context: runtime.context,
      }
    })
    for (const document of this._documents) this._attachContext(document)
    const nextActive = this._documents[0]?.tabId ?? null
    if (nextActive) this._setActiveTabId(nextActive)
    this._emit()
  }

  updateDocument(tabId: string, patch: TabbedDocumentPatch): boolean {
    const document = this._documents.find(record => record.tabId === tabId)
    if (!document) return false
    const nextTitle = Object.prototype.hasOwnProperty.call(patch, 'title') ? patch.title ?? document.title : document.title
    const nextClosable = Object.prototype.hasOwnProperty.call(patch, 'closable') ? patch.closable ?? document.closable : document.closable
    const nextDirty = Object.prototype.hasOwnProperty.call(patch, 'dirty') ? patch.dirty ?? document.dirty : document.dirty
    const nextTooltip = Object.prototype.hasOwnProperty.call(patch, 'tooltip') ? patch.tooltip : document.tooltip
    const nextIcon = Object.prototype.hasOwnProperty.call(patch, 'icon') ? patch.icon : document.icon
    const changed =
      nextTitle !== document.title ||
      nextClosable !== document.closable ||
      nextDirty !== document.dirty ||
      nextTooltip !== document.tooltip ||
      nextIcon !== document.icon
    if (!changed) return false
    document.title = nextTitle
    document.closable = nextClosable
    document.dirty = nextDirty
    document.tooltip = nextTooltip
    document.icon = nextIcon
    this._emit()
    return true
  }

  dispose(): void {
    const active = this.activeDocument
    this._activeTabId = null
    if (active) this._notifyDocumentDeactivated(active)
    for (const document of this._documents) {
      this._detachContext(document)
      document.contentHost.dispose()
    }
    this._documents = []
    this._closingTabIds.clear()
    this._listeners.clear()
  }

  private async _runBeforeClose(record: TabbedDocumentRecord): Promise<boolean> {
    const explicit = record.beforeClose
    if (explicit) {
      try {
        return await explicit()
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

  private _resolveFallbackActiveTab(removedIndex: number): string | null {
    const left = this._documents[removedIndex - 1]
    const right = this._documents[removedIndex]
    return left?.tabId ?? right?.tabId ?? null
  }

  private _emit(): void {
    for (const listener of [...this._listeners]) listener()
  }

  private _setActiveTabId(nextTabId: string | null): boolean {
    if (this._activeTabId === nextTabId) return false
    const previous = this.activeDocument
    const next = nextTabId ? this.getDocument(nextTabId) : undefined
    this._activeTabId = nextTabId
    if (previous && previous !== next) this._notifyDocumentDeactivated(previous)
    if (next && next !== previous) this._notifyDocumentActivated(next)
    return true
  }

  private _notifyDocumentActivated(record: TabbedDocumentRecord): void {
    this._documentLifecycle(record.content)?.onDocumentActivated?.()
  }

  private _notifyDocumentDeactivated(record: TabbedDocumentRecord): void {
    this._documentLifecycle(record.content)?.onDocumentDeactivated?.()
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

  private _createDocumentRuntime(definition: TabbedDocumentDefinition): TabbedDocumentRuntime {
    const scope = new RenderAppContextScope({
      context: definition.context,
      values: definition.contextValues,
      child: definition.content,
      disposeContextOnDispose: definition.disposeContextOnClose ?? definition.context === undefined,
    })
    return {
      contentHost: scope,
      appContext: scope.appContext,
      context: this._createContext(definition.tabId, scope.appContext),
    }
  }

  private _createContext(tabId: string, appContext: AppContextRegistry): TabbedDocumentContext {
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

  private _attachContext(record: TabbedDocumentRecord): void {
    this._documentContextAware(record.content)?.attachDocumentContext?.(record.context)
  }

  private _detachContext(record: TabbedDocumentRecord): void {
    this._documentContextAware(record.content)?.detachDocumentContext?.()
  }
}

export class RenderTabbedWorkspace extends RenderBox {
  static override debugTypeName = 'RenderTabbedWorkspace'
  readonly manager: TabbedDocumentManager
  readonly tabs: RenderTabs

  private _activeContent?: RenderBox
  private _unsubscribe?: () => void
  private _tabContextMenu: MenuPopup | null = null
  private _tabContextMenuTabId = ''
  private readonly _disposeManagerOnDispose: boolean
  private _emptyTitle = '暂无打开的模块'
  private _emptyDescription = '使用上方按钮打开文档或工作区。'

  constructor(options: {
    manager: TabbedDocumentManager
    emptyTitle?: string
    emptyDescription?: string
    disposeManagerOnDispose?: boolean
  }) {
    super()
    this.manager = options.manager
    this._disposeManagerOnDispose = options.disposeManagerOnDispose ?? false
    if (options.emptyTitle) this._emptyTitle = options.emptyTitle
    if (options.emptyDescription) this._emptyDescription = options.emptyDescription
    this.tabs = new RenderTabs({
      tabs: [],
      activeKey: '',
      onTabChange: key => {
        this.manager.activateDocument(key)
      },
      onTabClose: key => {
        void this.manager.closeDocument(key)
      },
      onTabReorder: (key, targetIndex) => {
        this.manager.moveDocument(key, targetIndex)
      },
      onTabContextMenu: (key, position) => this._showTabContextMenu(key, position),
    })
    this.tabs.parent = this
    this._unsubscribe = this.manager.subscribe(() => this._syncFromManager())
    this._syncFromManager()
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
      visitor(this.tabs)
      if (this._activeContent) visitor(this._activeContent)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    visitor(this.tabs)
    if (this._activeContent) visitor(this._activeContent)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? 720 : constraints.maxWidth
    const tabsLayout = resolveChildLayout(
      this.tabs,
      { minWidth: width, maxWidth: width, minHeight: 0, maxHeight: constraints.maxHeight },
      'stretch',
      'start',
    )
    this.tabs.layout(tabsLayout.constraints, true, context)
    const tabsHeight = this.tabs.outerSize.height
    this.tabs.positionInSlot(
      { x: 0, y: 0, width, height: tabsHeight },
      tabsLayout.horizontalAlignment,
      tabsLayout.verticalAlignment,
    )

    const bodyHeight = constraints.maxHeight === Infinity
      ? Math.max(260, this._activeContent?.outerSize.height ?? 260)
      : Math.max(0, constraints.maxHeight - tabsHeight)

    if (this._activeContent) {
      const contentLayout = resolveChildLayout(
        this._activeContent,
        { minWidth: width, maxWidth: width, minHeight: bodyHeight, maxHeight: bodyHeight },
        'stretch',
        'stretch',
      )
      this._activeContent.layout(contentLayout.constraints, true, context)
      this._activeContent.positionInSlot(
        { x: 0, y: tabsHeight, width, height: bodyHeight },
        contentLayout.horizontalAlignment,
        contentLayout.verticalAlignment,
      )
    }

    this.size = {
      width,
      height: tabsHeight + bodyHeight,
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const bodyY = offset.y + this.tabs.outerSize.height
    const bodyHeight = Math.max(0, this.size.height - this.tabs.outerSize.height)

    dl.fillRect(
      offset.x,
      bodyY,
      this.size.width,
      bodyHeight,
      context.theme.surfaceContent,
      0,
    )
    dl.line(
      offset.x,
      bodyY + 0.5,
      offset.x + this.size.width,
      bodyY + 0.5,
      context.theme.borderSubtle,
      1,
    )

    this.paintContentChildren(context, offset)
    this.paintAdornerChildren(context, offset)

    if (this._activeContent) return

    const titleFontSize = context.theme.fontSize + 1
    const bodyCenterY = bodyY + bodyHeight / 2
    const descriptionFontSize = Math.max(11, context.theme.fontSize - 1)
    const titleWidth = TextMeasurer.measureWidth(this._emptyTitle, titleFontSize, context.theme.fontFamily)
    const descriptionWidth = TextMeasurer.measureWidth(this._emptyDescription, descriptionFontSize, context.theme.fontFamily)
    dl.fillText(
      this._emptyTitle,
      offset.x + (this.size.width - titleWidth) / 2,
      bodyCenterY - 10,
      context.theme.textSecondary,
      titleFontSize,
      context.theme.fontFamily,
      'left',
      'middle',
    )
    dl.fillText(
      this._emptyDescription,
      offset.x + (this.size.width - descriptionWidth) / 2,
      bodyCenterY + 14,
      context.theme.textDisabled,
      descriptionFontSize,
      context.theme.fontFamily,
      'left',
      'middle',
    )
  }

  dispose(): void {
    this._dismissTabContextMenu()
    this._unsubscribe?.()
    this._unsubscribe = undefined
    if (!this._disposeManagerOnDispose && this._activeContent) {
      this._activeContent.parent = undefined
      if (this._activeContent.owner) this._activeContent.detach()
      this._activeContent = undefined
    }
    if (this._disposeManagerOnDispose) {
      this.manager.dispose()
      this._activeContent = undefined
    }
    super.dispose()
    if (this._activeContent) {
      this._activeContent.parent = undefined
      if (this._activeContent.owner) this._activeContent.detach()
      this._activeContent = undefined
    }
  }

  private _syncFromManager(): void {
    const nextActiveContent = this.manager.activeDocument?.contentHost
    if (this._activeContent !== nextActiveContent) {
      if (this._activeContent) this._clearFocusIfWithin(this._activeContent)
      if (this._activeContent) {
        this._activeContent.parent = undefined
        if (this._activeContent.owner) this._activeContent.detach()
      }
      this._activeContent = nextActiveContent
      if (nextActiveContent) {
        nextActiveContent.parent = this
        if (this.owner && nextActiveContent.owner !== this.owner) nextActiveContent.attach(this.owner)
      }
    }

    const tabItems: TabItem[] = this.manager.documents.map(document => ({
      key: document.tabId,
      label: document.title,
      closable: document.closable,
      dirty: document.dirty,
      tooltip: document.tooltip,
      icon: document.icon,
    }))
    this.tabs.tabs = tabItems
    this.tabs.activeKey = this.manager.activeTabId ?? ''
    if (this._tabContextMenuTabId && !this.manager.hasDocument(this._tabContextMenuTabId)) {
      this._dismissTabContextMenu()
    }
    this.markNeedsLayout()
  }

  private _showTabContextMenu(tabId: string, position: Offset): boolean {
    if (!this.manager.hasDocument(tabId)) return false
    this._dismissTabContextMenu()
    const rootPopup = new MenuPopup({
      items: this._tabContextMenuItems(tabId),
      onSelect: key => {
        this._dismissTabContextMenu()
        void this._handleTabContextMenuAction(tabId, key as TabbedWorkspaceContextMenuAction)
      },
      position: () => ({ ...position }),
      bounds: popupContext => popupViewportRect(popupContext),
      onClose: () => {
        if (this._tabContextMenu === rootPopup) {
          this._tabContextMenu = null
          this._tabContextMenuTabId = ''
        }
      },
    })
    this._tabContextMenu = rootPopup
    this._tabContextMenuTabId = tabId
    rootPopup.open()
    return true
  }

  private _tabContextMenuItems(tabId: string): ContextMenuEntry[] {
    const documents = this.manager.documents
    const document = this.manager.getDocument(tabId)
    const index = documents.findIndex(candidate => candidate.tabId === tabId)
    const hasClosableOther = documents.some(candidate => candidate.tabId !== tabId && candidate.closable)
    const hasClosableRight = index >= 0 && documents.slice(index + 1).some(candidate => candidate.closable)
    const hasClosableDocument = documents.some(candidate => candidate.closable)

    return [
      {
        key: 'close',
        label: '关闭',
        shortcut: 'Ctrl+W',
        disabled: document?.closable !== true,
      },
      { separator: true },
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

  private async _handleTabContextMenuAction(tabId: string, action: TabbedWorkspaceContextMenuAction): Promise<void> {
    if (!this.manager.hasDocument(tabId)) return
    const documents = [...this.manager.documents]
    const index = documents.findIndex(document => document.tabId === tabId)
    switch (action) {
      case 'close':
        await this.manager.closeDocument(tabId)
        return
      case 'close-others':
        await this._closeDocumentsInOrder(documents
          .filter(document => document.tabId !== tabId && document.closable)
          .map(document => document.tabId))
        return
      case 'close-right':
        if (index < 0) return
        await this._closeDocumentsInOrder(documents
          .slice(index + 1)
          .filter(document => document.closable)
          .map(document => document.tabId))
        return
      case 'close-all':
        await this._closeDocumentsInOrder(documents
          .filter(document => document.closable)
          .map(document => document.tabId))
        return
    }
  }

  private async _closeDocumentsInOrder(tabIds: string[]): Promise<void> {
    for (const tabId of tabIds) {
      if (!this.manager.hasDocument(tabId)) continue
      const closed = await this.manager.closeDocument(tabId)
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
