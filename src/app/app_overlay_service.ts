import {
  APP_CONTEXT_PROVIDER,
  AppContextRegistry,
  isAppContextProvider,
  type AppContextInitialValues,
  type AppContextLookupKey,
} from '../core/app_context'
import { FocusManager, FocusScope, FocusScopeType, type Focusable } from '../core/focus_manager'
import { PopupManager } from '../core/popup_manager'
import { RenderObject, type Offset } from '../core/render_object'
import type { RenderBox } from '../layout/render_box'
import { ContextMenuManager, type ContextMenuEntry } from '../widgets/context_menu'
import { RenderModal, type ModalButton } from '../widgets/modal'
import {
  NotificationManager,
  type NotificationHandle,
  type NotificationOptions,
  type NotificationPatch,
  type NotificationType,
} from '../widgets/notification'
import { RenderPromptModal } from '../widgets/prompt_modal'
import { TooltipManager, TooltipService } from '../widgets/tooltip'
import { RenderWindow } from '../widgets/window'
import { RenderLoadingModal } from '../widgets/loading_modal'
import type { LayoutInspectorDebugState, LayoutInspectorService } from '../runtime/layout_inspector_service'
import type { RuntimeCaptureImageOptions, RuntimeDiagnosticsSnapshot, RuntimeDockWindowOptions, RuntimePaintRequestRecord } from '../runtime/runtime_host'
import type { RenderWindowHostDockSide } from '../widgets/window'
import { RenderDevToolsWindow, type DevToolsTabKey, type RenderDevToolsExtraTab } from './dev_tools_window'
import type { LayoutInspectorPanelDebugState } from './layout_inspector_panel'
import type { RuntimeDiagnosticsPanelDebugState, RuntimeDiagnosticsState } from './runtime_diagnostics_panel'
import { RenderRuntimeDiagnosticsSnapshotViewer } from './runtime_diagnostics_snapshot_viewer'
import type { IconName } from '../widgets/icon'

export interface AppPerformanceOverlayController {
  readonly performanceOverlayVisible: boolean
  setPerformanceOverlayVisible(visible: boolean): void
  togglePerformanceOverlay(): boolean
}

export interface AppRuntimeDebugController extends AppPerformanceOverlayController {
  readonly paintRequestDebugEnabled: boolean
  setPaintRequestDebugEnabled(enabled: boolean): void
  getPaintRequestHistory(limit?: number): RuntimePaintRequestRecord[]
  clearPaintRequestHistory(): void
  createDiagnosticsSnapshot?(): RuntimeDiagnosticsSnapshot
  captureImageDataUrl?(options?: RuntimeCaptureImageOptions): string
  captureImageBlob?(options?: RuntimeCaptureImageOptions): Promise<Blob>
}

export interface AppDockWindowController {
  dockWindow(window: RenderWindow, options?: RuntimeDockWindowOptions): RenderWindow
  undockWindow(window: RenderWindow, options?: { dispose?: boolean }): void
  isDockedWindow?(window: RenderWindow): boolean
  updateDockWindow?(window: RenderWindow, options?: RuntimeDockWindowOptions): void
  resizeDockWindow?(window: RenderWindow, position: Offset): void
}

export interface AppModalWindowHost {
  setModalWindows(windows: readonly RenderWindow[]): void
  centerWindowInViewport(window: RenderWindow): void
}

export interface AppCanvasImageDownloadOptions extends RuntimeCaptureImageOptions {
  filename?: string
}

export interface AppModalOptions {
  source?: RenderObject
  context?: AppContextRegistry
  contextValues?: Exclude<AppContextInitialValues, AppContextRegistry>
  disposeContextOnClose?: boolean
  title: string
  content: string
  buttons?: ModalButton[]
  modalWidth?: number
  modalHeight?: number
  onClose?: (buttonKey: string | null) => void
}

export interface AppAlertDialogOptions {
  source?: RenderObject
  context?: AppContextRegistry
  contextValues?: Exclude<AppContextInitialValues, AppContextRegistry>
  disposeContextOnClose?: boolean
  content: string
  title?: string
  okText?: string
  danger?: boolean
  modalWidth?: number
  modalHeight?: number
}

export interface AppConfirmDialogOptions {
  source?: RenderObject
  context?: AppContextRegistry
  contextValues?: Exclude<AppContextInitialValues, AppContextRegistry>
  disposeContextOnClose?: boolean
  content: string
  title?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  modalWidth?: number
  modalHeight?: number
}

export interface AppPromptDialogOptions {
  source?: RenderObject
  context?: AppContextRegistry
  contextValues?: Exclude<AppContextInitialValues, AppContextRegistry>
  disposeContextOnClose?: boolean
  content: string
  title?: string
  placeholder?: string
  initialValue?: string
  confirmText?: string
  cancelText?: string
  modalWidth?: number
  modalHeight?: number
}

export interface AppLoadingOptions {
  text?: string
  progress?: number
}

export interface AppOverlayContextOptions {
  source?: RenderObject
  context?: AppContextRegistry
  contextValues?: Exclude<AppContextInitialValues, AppContextRegistry>
  disposeContextOnClose?: boolean
}

export interface AppDockWindowOptions extends AppOverlayContextOptions, RuntimeDockWindowOptions {}
export interface AppModalWindowOptions extends AppOverlayContextOptions {}

export interface AppDevToolsOptions {
  activeTab?: DevToolsTabKey
}

export type AppDevToolsVisibilityListener = (visible: boolean) => void

export interface AppDevToolsTab {
  key: string
  label: string
  icon?: IconName
  createContent: () => RenderBox
}

export interface AppLoadingHandle {
  readonly closed: boolean
  setText(text?: string): void
  setProgress(progress?: number): void
  close(): void
}

export type AppLoadingTask<T> = (handle: AppLoadingHandle) => T | Promise<T>

export interface AppOverlayServiceConsumer {
  bindAppOverlayService(uiServices: AppOverlayService): void
  unbindAppOverlayService?(uiServices: AppOverlayService): void
}

type AppActiveDialog = RenderModal | RenderPromptModal

interface AppLoadingEntry {
  id: number
  text?: string
  progress?: number
  closed: boolean
}

interface ResolvedOverlayContext {
  context?: AppContextRegistry
  disposeOnDispose: boolean
}

interface WindowBoundsSnapshot {
  x: number
  y: number
  width: number
  height: number
}

interface ModalWindowRecord {
  window: RenderWindow
  resolve: (value: boolean) => void
  cleanup?: () => void
  previousShowCloseButton: boolean
  previousShowMaximizeButton: boolean
  settled: boolean
}

type LayoutInspectorPanelCompat = Omit<RenderDevToolsWindow, 'debugState'> & {
  debugState(): LayoutInspectorPanelDebugState
}

type RuntimeDiagnosticsPanelCompat = Omit<RenderDevToolsWindow, 'debugState'> & {
  debugState(): RuntimeDiagnosticsPanelDebugState
}

type DevToolsPanelCompat<TDebugState> = Omit<RenderDevToolsWindow, 'debugState'> & {
  debugState(): TDebugState
}

function downloadDiagnosticsSnapshot(snapshot: RuntimeDiagnosticsSnapshot): void {
  if (typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof URL.revokeObjectURL !== 'function' ||
    typeof Blob === 'undefined') {
    return
  }
  const content = JSON.stringify(snapshot, null, 2)
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `ds-ui-diagnostics-${snapshot.createdAt.replace(/[:.]/g, '-')}.json`
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof URL.revokeObjectURL !== 'function') {
    return
  }
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function createDevToolsPanelCompat<TDebugState>(
  window: RenderDevToolsWindow,
  debugState: () => TDebugState,
): DevToolsPanelCompat<TDebugState> {
  return new Proxy(window, {
    get(target, property) {
      if (property === 'debugState') return debugState
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target)
    },
  }) as unknown as DevToolsPanelCompat<TDebugState>
}

export class AppOverlayService {
  readonly notificationManager: NotificationManager
  readonly tooltipManager: TooltipManager
  readonly contextMenuManager: ContextMenuManager
  private _activeModal: AppActiveDialog | null = null
  private _windowHost: RenderWindow | null = null
  private _dockWindowHost: AppDockWindowController | null = null
  private _modalWindowHost: AppModalWindowHost | null = null
  private readonly _floatingWindows = new Set<RenderWindow>()
  private readonly _floatingWindowCleanup = new Map<RenderWindow, () => void>()
  private readonly _dockWindows = new Set<RenderWindow>()
  private readonly _dockWindowCleanup = new Map<RenderWindow, () => void>()
  private readonly _dockWindowOptions = new Map<RenderWindow, RuntimeDockWindowOptions>()
  private readonly _preDockWindowBounds = new Map<RenderWindow, WindowBoundsSnapshot>()
  private readonly _modalWindowRecords: ModalWindowRecord[] = []
  private _modalFocusScope: FocusScope | null = null
  private _modalFocusRestore: Focusable | null = null
  private readonly _loadingEntries: AppLoadingEntry[] = []
  private _loadingModal: RenderLoadingModal | null = null
  private _layoutInspector: LayoutInspectorService | null = null
  private _devToolsWindow: RenderDevToolsWindow | null = null
  private _layoutInspectorPanelCompat: LayoutInspectorPanelCompat | null = null
  private _runtimeDiagnosticsPanelCompat: RuntimeDiagnosticsPanelCompat | null = null
  private _devToolsTabs: AppDevToolsTab[] = []
  private readonly _devToolsVisibilityListeners = new Set<AppDevToolsVisibilityListener>()
  private _layoutInspectorUnsubscribe?: () => void
  private _runtimeDiagnosticsSnapshotViewer: RenderRuntimeDiagnosticsSnapshotViewer | null = null
  private _performanceOverlay: AppPerformanceOverlayController | null = null
  private _runtimeDebug: AppRuntimeDebugController | null = null
  private _nextLoadingId = 1
  private _disposed = false

  constructor() {
    this.notificationManager = new NotificationManager()
    this.tooltipManager = new TooltipManager()
    TooltipService.installCurrent(this.tooltipManager)
    this.contextMenuManager = new ContextMenuManager()
  }

  get activeModal(): AppActiveDialog | null {
    return this._activeModal
  }

  get activeModalWindow(): RenderWindow | null {
    return this._modalWindowRecords[this._modalWindowRecords.length - 1]?.window ?? null
  }

  get modalWindows(): readonly RenderWindow[] {
    return this._modalWindowRecords.map(record => record.window)
  }

  get disposed(): boolean {
    return this._disposed
  }

  get floatingWindows(): readonly RenderWindow[] {
    return [...this._floatingWindows]
  }

  get dockWindows(): readonly RenderWindow[] {
    return [...this._dockWindows]
  }

  get layoutInspectorDebugState(): LayoutInspectorDebugState | null {
    return this._layoutInspector?.debugState() ?? null
  }

  get layoutInspectorPanel(): LayoutInspectorPanelCompat | null {
    return this._layoutInspectorPanelCompat
  }

  get devToolsWindow(): RenderDevToolsWindow | null {
    return this._devToolsWindow
  }

  get devToolsVisible(): boolean {
    return !!this._devToolsWindow && !this._devToolsWindow.disposed
  }

  get runtimeDiagnosticsPanel(): RuntimeDiagnosticsPanelCompat | null {
    return this._devToolsWindow?.activeTab === 'runtime'
      ? this._runtimeDiagnosticsPanelCompat
      : null
  }

  get runtimeDiagnosticsSnapshotViewer(): RenderRuntimeDiagnosticsSnapshotViewer | null {
    return this._runtimeDiagnosticsSnapshotViewer
  }

  get performanceOverlayVisible(): boolean {
    return this._performanceOverlay?.performanceOverlayVisible ?? false
  }

  get paintRequestDebugEnabled(): boolean {
    return this._runtimeDebug?.paintRequestDebugEnabled ?? false
  }

  get paintRequestHistory(): RuntimePaintRequestRecord[] {
    return this._runtimeDebug?.getPaintRequestHistory() ?? []
  }

  bindWindowHost(window: RenderWindow): void {
    this._assertActive()
    if (this._windowHost === window) return
    if (this._windowHost) {
      throw new Error('AppOverlayService is already bound to a different window host.')
    }
    this._windowHost = window
    for (const floatingWindow of this._floatingWindows) {
      window.addOwnedWindow(floatingWindow)
    }
  }

  unbindWindowHost(window?: RenderWindow): void {
    if (!this._windowHost) return
    if (window && this._windowHost !== window) {
      throw new Error('AppOverlayService cannot unbind a different window host.')
    }
    const windowHost = this._windowHost
    this._windowHost = null
    for (const floatingWindow of this._floatingWindows) {
      if (floatingWindow.ownerWindow === windowHost) {
        windowHost.removeOwnedWindow(floatingWindow)
      }
    }
  }

  bindDockWindowHost(host: AppDockWindowController): void {
    this._assertActive()
    if (this._dockWindowHost === host) return
    if (this._dockWindowHost) {
      throw new Error('AppOverlayService is already bound to a different dock window host.')
    }
    this._dockWindowHost = host
    for (const dockWindow of this._dockWindows) {
      this._dockWindowOnHost(dockWindow, this._dockWindowOptions.get(dockWindow))
    }
  }

  unbindDockWindowHost(host?: AppDockWindowController): void {
    if (!this._dockWindowHost) return
    if (host && this._dockWindowHost !== host) {
      throw new Error('AppOverlayService cannot unbind a different dock window host.')
    }
    const dockHost = this._dockWindowHost
    this._dockWindowHost = null
    for (const dockWindow of this._dockWindows) {
      dockHost.undockWindow(dockWindow)
    }
  }

  bindModalWindowHost(host: AppModalWindowHost): void {
    this._assertActive()
    if (this._modalWindowHost === host) return
    if (this._modalWindowHost) {
      throw new Error('AppOverlayService is already bound to a different modal window host.')
    }
    this._modalWindowHost = host
    this._syncModalWindowHost()
  }

  unbindModalWindowHost(host?: AppModalWindowHost): void {
    if (!this._modalWindowHost) return
    if (host && this._modalWindowHost !== host) {
      throw new Error('AppOverlayService cannot unbind a different modal window host.')
    }
    this._modalWindowHost.setModalWindows([])
    this._modalWindowHost = null
  }

  bindLayoutInspector(inspector: LayoutInspectorService): void {
    this._assertActive()
    if (this._layoutInspector === inspector) return
    if (this._layoutInspector) {
      throw new Error('AppOverlayService is already bound to a different layout inspector.')
    }
    this._layoutInspector = inspector
    this._layoutInspectorUnsubscribe = inspector.subscribe(state => {
      this._syncLayoutInspectorPanel(state)
    })
  }

  unbindLayoutInspector(inspector?: LayoutInspectorService): void {
    if (!this._layoutInspector) return
    if (inspector && this._layoutInspector !== inspector) {
      throw new Error('AppOverlayService cannot unbind a different layout inspector.')
    }
    if (this._devToolsWindow) {
      this._layoutInspector.setIgnoredRoot(this._devToolsWindow, false)
    }
    if (this._runtimeDiagnosticsSnapshotViewer) {
      this._layoutInspector.setIgnoredRoot(this._runtimeDiagnosticsSnapshotViewer, false)
    }
    this._layoutInspectorUnsubscribe?.()
    this._layoutInspectorUnsubscribe = undefined
    this._closeLayoutInspectorPanel()
    this._layoutInspector = null
  }

  bindPerformanceOverlay(controller: AppPerformanceOverlayController): void {
    this._assertActive()
    if (this._performanceOverlay === controller) return
    if (this._performanceOverlay) {
      throw new Error('AppOverlayService is already bound to a different performance overlay.')
    }
    this._performanceOverlay = controller
  }

  unbindPerformanceOverlay(controller?: AppPerformanceOverlayController): void {
    if (!this._performanceOverlay) return
    if (controller && this._performanceOverlay !== controller) {
      throw new Error('AppOverlayService cannot unbind a different performance overlay.')
    }
    this._performanceOverlay = null
  }

  bindRuntimeDebug(controller: AppRuntimeDebugController): void {
    this._assertActive()
    if (this._runtimeDebug === controller) return
    if (this._runtimeDebug) {
      throw new Error('AppOverlayService is already bound to a different runtime debug controller.')
    }
    this._runtimeDebug = controller
  }

  unbindRuntimeDebug(controller?: AppRuntimeDebugController): void {
    if (!this._runtimeDebug) return
    if (controller && this._runtimeDebug !== controller) {
      throw new Error('AppOverlayService cannot unbind a different runtime debug controller.')
    }
    this._closeRuntimeDiagnosticsPanel()
    this._runtimeDebug = null
  }

  showNotification(type: NotificationType, title: string, message = '', duration?: number): number {
    this._assertActive()
    return this.notificationManager.show(type, title, message, duration)
  }

  notify(options: NotificationOptions): NotificationHandle {
    this._assertActive()
    return this.notificationManager.notify(options)
  }

  updateNotification(idOrKey: number | string, patch: NotificationPatch): boolean {
    this._assertActive()
    return this.notificationManager.update(idOrKey, patch)
  }

  closeNotification(): void
  closeNotification(idOrKey: number | string): boolean
  closeNotification(idOrKey?: number | string): void | boolean {
    this._assertActive()
    if (idOrKey === undefined) {
      this.notificationManager.close()
      return
    }
    return this.notificationManager.close(idOrKey)
  }

  showContextMenu(items: ContextMenuEntry[], position: Offset, onSelect?: (key: string) => void): void {
    this._assertActive()
    this.contextMenuManager.show(items, position, onSelect)
  }

  hideContextMenu(): void {
    this._assertActive()
    this.contextMenuManager.hide()
  }

  inspectLayoutAt(position: Offset): LayoutInspectorDebugState {
    this._assertActive()
    const inspector = this._requireLayoutInspector()
    inspector.inspectAt(position)
    const state = inspector.debugState()
    this.showLayoutInspectorPanel(state)
    return state
  }

  toggleLayoutInspectorOverlay(position?: Offset): LayoutInspectorDebugState {
    this._assertActive()
    const inspector = this._requireLayoutInspector()
    const visible = inspector.toggleOverlay()
    if (visible && position) inspector.inspectAt(position)
    const state = inspector.debugState()
    if (visible) {
      this.showLayoutInspectorPanel(state)
    } else {
      this._closeLayoutInspectorPanel()
    }
    return state
  }

  clearLayoutInspectorSelection(): LayoutInspectorDebugState {
    this._assertActive()
    const inspector = this._requireLayoutInspector()
    inspector.clearSelection()
    const state = inspector.debugState()
    this._syncLayoutInspectorPanel(state)
    return state
  }

  setPerformanceOverlayVisible(visible: boolean): boolean {
    this._assertActive()
    const controller = this._requirePerformanceOverlay()
    controller.setPerformanceOverlayVisible(visible)
    return controller.performanceOverlayVisible
  }

  togglePerformanceOverlay(): boolean {
    this._assertActive()
    return this._requirePerformanceOverlay().togglePerformanceOverlay()
  }

  setPaintRequestDebugEnabled(enabled: boolean): boolean {
    this._assertActive()
    const controller = this._requireRuntimeDebug()
    controller.setPaintRequestDebugEnabled(enabled)
    this._syncLayoutInspectorPanel(this._layoutInspector?.debugState())
    this._syncRuntimeDiagnosticsPanel()
    return controller.paintRequestDebugEnabled
  }

  togglePaintRequestDebug(): boolean {
    this._assertActive()
    return this.setPaintRequestDebugEnabled(!this._requireRuntimeDebug().paintRequestDebugEnabled)
  }

  getPaintRequestHistory(limit?: number): RuntimePaintRequestRecord[] {
    this._assertActive()
    return this._requireRuntimeDebug().getPaintRequestHistory(limit)
  }

  clearPaintRequestHistory(): void {
    this._assertActive()
    this._requireRuntimeDebug().clearPaintRequestHistory()
    this._syncLayoutInspectorPanel(this._layoutInspector?.debugState())
    this._syncRuntimeDiagnosticsPanel()
  }

  captureCanvasImageDataUrl(options?: RuntimeCaptureImageOptions): string {
    this._assertActive()
    const controller = this._requireRuntimeDebug()
    if (!controller.captureImageDataUrl) {
      throw new Error('AppOverlayService runtime debug controller does not support canvas image capture.')
    }
    return controller.captureImageDataUrl(options)
  }

  captureCanvasImageBlob(options?: RuntimeCaptureImageOptions): Promise<Blob> {
    this._assertActive()
    const controller = this._requireRuntimeDebug()
    if (!controller.captureImageBlob) {
      throw new Error('AppOverlayService runtime debug controller does not support canvas image capture.')
    }
    return controller.captureImageBlob(options)
  }

  async downloadCanvasImage(options: AppCanvasImageDownloadOptions = {}): Promise<Blob> {
    this._assertActive()
    const { filename, ...captureOptions } = options
    const blob = await this.captureCanvasImageBlob(captureOptions)
    downloadBlob(blob, filename ?? `ds-ui-screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
    return blob
  }

  setDevToolsTabs(tabs: AppDevToolsTab[]): void {
    this._assertActive()
    const nextDefinitions = normalizeDevToolsTabDefinitions(tabs)
    if (this._devToolsWindow && !this._devToolsWindow.disposed) {
      const nextTabs = this._createDevToolsExtraTabs(nextDefinitions)
      try {
        this._devToolsWindow.setExtraTabs(nextTabs)
      } catch (error) {
        disposeDevToolsTabContents(nextTabs)
        throw error
      }
    }
    this._devToolsTabs = nextDefinitions
  }

  registerDevToolsTab(tab: AppDevToolsTab): () => void {
    this._assertActive()
    this.setDevToolsTabs([...this._devToolsTabs, tab])
    const registered = this._devToolsTabs[this._devToolsTabs.length - 1]!
    return () => {
      if (this._disposed) return
      this.setDevToolsTabs(this._devToolsTabs.filter(current => current !== registered))
    }
  }

  subscribeDevToolsVisibility(listener: AppDevToolsVisibilityListener): () => void {
    this._assertActive()
    this._devToolsVisibilityListeners.add(listener)
    this._notifyDevToolsVisibilityListener(listener, this.devToolsVisible)
    return () => this._devToolsVisibilityListeners.delete(listener)
  }

  showDevTools(options: AppDevToolsOptions = {}): RenderDevToolsWindow {
    this._assertActive()
    const activeTab = options.activeTab ?? 'layout-inspector'
    const wasVisible = this.devToolsVisible
    if (!this._devToolsWindow || this._devToolsWindow.disposed) {
      const window = new RenderDevToolsWindow({
        activeTab,
        layoutInspector: {
          onSelectTreeNode: debugId => {
            this.selectLayoutInspectorTreeNode(debugId)
          },
          onToggleOverlay: () => this.toggleLayoutInspectorOverlay(),
        },
        runtimeDiagnostics: {
          state: this._runtimeDebug ? this._runtimeDiagnosticsState() : {
            paintRequestDebugEnabled: false,
            paintRequests: [],
          },
          onRefresh: () => this._runtimeDiagnosticsState(),
          onTogglePaintRequestDebug: () => {
            const controller = this._requireRuntimeDebug()
            controller.setPaintRequestDebugEnabled(!controller.paintRequestDebugEnabled)
            this._syncLayoutInspectorPanel(this._layoutInspector?.debugState())
            return this._runtimeDiagnosticsState()
          },
          onClearPaintRequestHistory: () => {
            this._requireRuntimeDebug().clearPaintRequestHistory()
            this._syncLayoutInspectorPanel(this._layoutInspector?.debugState())
            return this._runtimeDiagnosticsState()
          },
          onExportDiagnosticsSnapshot: this._runtimeDebug?.createDiagnosticsSnapshot
            ? () => this._exportRuntimeDiagnosticsSnapshot()
            : undefined,
        },
        extraTabs: this._createDevToolsExtraTabs(),
      })
      this._layoutInspectorPanelCompat = window as LayoutInspectorPanelCompat
      this._runtimeDiagnosticsPanelCompat = createDevToolsPanelCompat(
        window,
        () => window.debugRuntimeDiagnosticsState(),
      )
      this._layoutInspector?.setIgnoredRoot(window, true)
      window.manage(() => {
        this._layoutInspector?.setIgnoredRoot(window, false)
        if (this._devToolsWindow === window) {
          this._devToolsWindow = null
          this._layoutInspectorPanelCompat = null
          this._runtimeDiagnosticsPanelCompat = null
          this._layoutInspector?.deactivate()
          this._notifyDevToolsVisibility(false)
        }
      })
      window.setOnClose(() => {
        window.dispose()
      })
      this._devToolsWindow = window
      this._showDeveloperDockWindow(window, { side: 'right', size: 520, minSize: 360 })
    }
    this._devToolsWindow.activateTab(activeTab)
    this._syncLayoutInspectorPanel(this._layoutInspector?.debugState())
    if (this._runtimeDebug) this._syncRuntimeDiagnosticsPanel()
    if (!wasVisible) this._notifyDevToolsVisibility(true)
    return this._devToolsWindow
  }

  toggleDevTools(options: AppDevToolsOptions = {}): boolean {
    this._assertActive()
    if (this._devToolsWindow && !this._devToolsWindow.disposed) {
      this._devToolsWindow.close()
      return false
    }
    this.showDevTools(options)
    return true
  }

  activateDevToolsTab(tabKey: DevToolsTabKey): RenderDevToolsWindow {
    return this.showDevTools({ activeTab: tabKey })
  }

  showRuntimeDiagnosticsPanel(): RuntimeDiagnosticsPanelCompat {
    this._assertActive()
    this._requireRuntimeDebug()
    this.showDevTools({ activeTab: 'runtime' })
    return this._runtimeDiagnosticsPanelCompat!
  }

  toggleRuntimeDiagnosticsPanel(): boolean {
    this._assertActive()
    if (this._devToolsWindow && !this._devToolsWindow.disposed && this._devToolsWindow.activeTab === 'runtime') {
      this._devToolsWindow.close()
      return false
    }
    this.showRuntimeDiagnosticsPanel()
    return true
  }

  showRuntimeDiagnosticsSnapshotViewer(snapshot: unknown): RenderRuntimeDiagnosticsSnapshotViewer {
    this._assertActive()
    if (!this._runtimeDiagnosticsSnapshotViewer || this._runtimeDiagnosticsSnapshotViewer.disposed) {
      const panel = new RenderRuntimeDiagnosticsSnapshotViewer(snapshot)
      this._layoutInspector?.setIgnoredRoot(panel, true)
      panel.manage(() => {
        this._layoutInspector?.setIgnoredRoot(panel, false)
        if (this._runtimeDiagnosticsSnapshotViewer === panel) {
          this._runtimeDiagnosticsSnapshotViewer = null
        }
      })
      panel.setOnClose(() => {
        panel.dispose()
      })
      this._runtimeDiagnosticsSnapshotViewer = panel
      this.showWindow(panel)
      return panel
    }
    this._runtimeDiagnosticsSnapshotViewer.setSnapshot(snapshot)
    return this._runtimeDiagnosticsSnapshotViewer
  }

  selectLayoutInspectorPathIndex(index: number): LayoutInspectorDebugState {
    this._assertActive()
    const inspector = this._requireLayoutInspector()
    inspector.selectSelectedPathIndex(index)
    const state = inspector.debugState()
    this._syncLayoutInspectorPanel(state)
    return state
  }

  selectLayoutInspectorTreeNode(debugId: number): LayoutInspectorDebugState {
    this._assertActive()
    const inspector = this._requireLayoutInspector()
    inspector.selectTreeNode(debugId)
    const state = inspector.debugState()
    this._syncLayoutInspectorPanel(state)
    return state
  }

  showLayoutInspectorPanel(state: LayoutInspectorDebugState = this._requireLayoutInspector().debugState()): LayoutInspectorPanelCompat {
    this._assertActive()
    const window = this.showDevTools({ activeTab: 'layout-inspector' })
    window.setLayoutInspectorState(state)
    window.setLayoutRuntimeDebugState(this._runtimeDebugState())
    return this._layoutInspectorPanelCompat!
  }

  showLoading(options: string | AppLoadingOptions = {}): AppLoadingHandle {
    this._assertActive()
    const entry: AppLoadingEntry = {
      id: this._nextLoadingId++,
      text: typeof options === 'string' ? options : options.text,
      progress: typeof options === 'string' ? undefined : options.progress,
      closed: false,
    }
    this._loadingEntries.push(entry)
    this._ensureLoadingModal()
    this._syncLoadingModalText()
    this._loadingModal?.show()

    return {
      get closed() {
        return entry.closed
      },
      setText: (text?: string) => {
        if (entry.closed) return
        entry.text = text
        this._syncLoadingModalText()
      },
      setProgress: (progress?: number) => {
        if (entry.closed) return
        entry.progress = progress
        this._syncLoadingModalState()
      },
      close: () => {
        this._closeLoadingEntry(entry)
      },
    }
  }

  async withLoading<T>(
    options: string | AppLoadingOptions,
    task: AppLoadingTask<T>,
  ): Promise<T> {
    const handle = this.showLoading(options)
    try {
      return await task(handle)
    } finally {
      handle.close()
    }
  }

  showTooltip(text: string, position: Offset, delay?: number): void {
    this._assertActive()
    this.tooltipManager.show(text, position, delay)
  }

  updateTooltip(position: Offset): void {
    this._assertActive()
    this.tooltipManager.updatePos(position)
  }

  hideTooltip(): void {
    this._assertActive()
    this.tooltipManager.hide()
  }

  showModal(options: AppModalOptions): RenderModal {
    this._assertActive()
    this.closeModal()
    const onClose = options.onClose
    const overlayContext = this._resolveOverlayContext(options)
    let modal!: RenderModal
    modal = new RenderModal({
      title: options.title,
      content: options.content,
      buttons: options.buttons,
      modalWidth: options.modalWidth,
      modalHeight: options.modalHeight,
      appContext: overlayContext.context,
      disposeAppContextOnDispose: overlayContext.disposeOnDispose,
      onClose: buttonKey => {
        if (this._activeModal === modal) {
          this._activeModal = null
        }
        onClose?.(buttonKey)
        modal.dispose()
      },
    })
    this._activeModal = modal
    modal.show()
    return modal
  }

  alert(options: AppAlertDialogOptions): Promise<void> {
    this._assertActive()
    return new Promise(resolve => {
      this.showModal({
        source: options.source,
        context: options.context,
        contextValues: options.contextValues,
        disposeContextOnClose: options.disposeContextOnClose,
        title: options.title ?? '提示',
        content: options.content,
        modalWidth: options.modalWidth,
        modalHeight: options.modalHeight,
        buttons: [
          {
            label: options.okText ?? '确定',
            key: 'ok',
            primary: !options.danger,
            danger: options.danger ?? false,
          },
        ],
        onClose: () => resolve(),
      })
    })
  }

  confirm(options: AppConfirmDialogOptions): Promise<boolean> {
    this._assertActive()
    return new Promise(resolve => {
      this.showModal({
        source: options.source,
        context: options.context,
        contextValues: options.contextValues,
        disposeContextOnClose: options.disposeContextOnClose,
        title: options.title ?? '确认操作',
        content: options.content,
        modalWidth: options.modalWidth,
        modalHeight: options.modalHeight,
        buttons: [
          { label: options.cancelText ?? '取消', key: 'cancel' },
          {
            label: options.confirmText ?? '确认',
            key: 'ok',
            primary: !options.danger,
            danger: options.danger ?? false,
          },
        ],
        onClose: buttonKey => resolve(buttonKey === 'ok'),
      })
    })
  }

  prompt(options: AppPromptDialogOptions): Promise<string | null> {
    this._assertActive()
    return new Promise(resolve => {
      this.closeModal()
      const onClose = (buttonKey: string | null, value: string) => {
        resolve(buttonKey === 'ok' ? value : null)
      }
      const overlayContext = this._resolveOverlayContext(options)
      let modal!: RenderPromptModal
      modal = new RenderPromptModal({
        title: options.title ?? '请输入',
        content: options.content,
        value: options.initialValue ?? '',
        placeholder: options.placeholder ?? '',
        modalWidth: options.modalWidth,
        modalHeight: options.modalHeight,
        appContext: overlayContext.context,
        disposeAppContextOnDispose: overlayContext.disposeOnDispose,
        buttons: [
          { label: options.cancelText ?? '取消', key: 'cancel' },
          { label: options.confirmText ?? '确认', key: 'ok', primary: true },
        ],
        onClose: (buttonKey, value) => {
          if (this._activeModal === modal) {
            this._activeModal = null
          }
          onClose(buttonKey, value)
          modal.dispose()
        },
      })
      this._activeModal = modal
      modal.show()
    })
  }

  closeModal(buttonKey: string | null = null): void {
    this._assertActive()
    this._activeModal?.hide(buttonKey)
  }

  showModalWindow(window: RenderWindow, options: AppModalWindowOptions = {}): Promise<boolean> {
    this._assertActive()
    if (window.disposed) {
      throw new Error('AppOverlayService cannot show a disposed modal window.')
    }
    if (this._modalWindowRecords.some(record => record.window === window)) {
      throw new Error('AppOverlayService cannot show the same modal window more than once.')
    }
    PopupManager.instance.closeTransient()
    this.hideContextMenu()
    this.hideTooltip()

    const previousOnClose = window.onCloseHandler
    let pendingResult: boolean | undefined
    let record!: ModalWindowRecord
    const settle = (result: boolean): void => {
      if (record.settled) return
      record.settled = true
      record.cleanup?.()
      const index = this._modalWindowRecords.indexOf(record)
      if (index >= 0) this._modalWindowRecords.splice(index, 1)
      if (window.onCloseHandler === modalOnClose) {
        window.setOnClose(previousOnClose)
      }
      if (!window.disposed) {
        window.setShowCloseButton(record.previousShowCloseButton)
        window.setShowMaximizeButton(record.previousShowMaximizeButton)
      }
      window.setDialogResultHandler(undefined)
      this._syncModalWindowState()
      record.resolve(result)
    }
    const modalOnClose = (): void => {
      try {
        previousOnClose?.()
      } finally {
        settle(pendingResult ?? false)
        pendingResult = undefined
        if (!window.disposed) {
          window.ownerWindow?.removeOwnedWindow(window)
          window.dispose()
        }
      }
    }

    return new Promise(resolve => {
      record = {
        window,
        resolve,
        previousShowCloseButton: window.showCloseButton,
        previousShowMaximizeButton: window.showMaximizeButton,
        settled: false,
      }
      window.setOnClose(modalOnClose)
      window.setDialogResultHandler(result => {
        pendingResult = result
        window.close()
      })
      try {
        window.setShowCloseButton(true)
        window.setShowMaximizeButton(false)
        this.showWindow(window, options)
        this._modalWindowHost?.centerWindowInViewport(window)
        record.cleanup = window.manage(() => settle(false))
        this._modalWindowRecords.push(record)
        this._syncModalWindowState()
      } catch (error) {
        window.setDialogResultHandler(undefined)
        if (window.onCloseHandler === modalOnClose) window.setOnClose(previousOnClose)
        if (!window.disposed) {
          window.setShowCloseButton(record.previousShowCloseButton)
          window.setShowMaximizeButton(record.previousShowMaximizeButton)
        }
        throw error
      }
    })
  }

  closeModalWindow(result = false): void {
    this._assertActive()
    this.activeModalWindow?.closeWithResult(result)
  }

  showWindow(window: RenderWindow, options: AppOverlayContextOptions = {}): RenderWindow {
    this._assertActive()
    if (window.disposed) {
      throw new Error('AppOverlayService cannot show a disposed RenderWindow.')
    }
    const wasDocked = this._dockWindows.has(window)
    if (wasDocked) {
      this._dockWindowHost?.undockWindow(window)
      this._dockWindowCleanup.get(window)?.()
      this._dockWindowCleanup.delete(window)
      this._dockWindows.delete(window)
      this._dockWindowOptions.delete(window)
    }
    window.setPresentation('floating')
    window.setHostDockHandlers(undefined)
    if (wasDocked) this._restorePreDockWindowBounds(window)
    const overlayContext = this._resolveOverlayContext(options)
    if (overlayContext.context) {
      window.setAppContext(overlayContext.context, {
        disposeOnDispose: overlayContext.disposeOnDispose,
      })
    }
    const windowHost = this._requireWindowHost()
    if (!this._floatingWindows.has(window)) {
      this._floatingWindows.add(window)
      this._floatingWindowCleanup.set(window, window.manage(() => {
        this._floatingWindows.delete(window)
        this._floatingWindowCleanup.delete(window)
      }))
    }
    windowHost.addOwnedWindow(window)
    if (this._modalWindowRecords.length > 0) this._syncModalWindowState()
    return window
  }

  showDockWindow(window: RenderWindow, options: AppDockWindowOptions = {}): RenderWindow {
    this._assertActive()
    if (window.disposed) {
      throw new Error('AppOverlayService cannot dock a disposed RenderWindow.')
    }
    this._requireDockWindowHost()
    if (this._floatingWindows.has(window)) {
      this._floatingWindowCleanup.get(window)?.()
      this._floatingWindowCleanup.delete(window)
      this._floatingWindows.delete(window)
      window.ownerWindow?.removeOwnedWindow(window)
    }
    const overlayContext = this._resolveOverlayContext(options)
    if (overlayContext.context) {
      window.setAppContext(overlayContext.context, {
        disposeOnDispose: overlayContext.disposeOnDispose,
      })
    }
    if (!this._dockWindows.has(window)) {
      this._dockWindows.add(window)
      this._dockWindowCleanup.set(window, window.manage(() => {
        this._dockWindows.delete(window)
        this._dockWindowCleanup.delete(window)
        this._dockWindowOptions.delete(window)
        this._preDockWindowBounds.delete(window)
      }))
    }
    if (!this._preDockWindowBounds.has(window)) {
      this._preDockWindowBounds.set(window, {
        x: window.windowX,
        y: window.windowY,
        width: window.windowWidth,
        height: window.windowHeight,
      })
    }
    this._dockWindowOptions.set(window, options)
    this._dockWindowOnHost(window, options)
    return window
  }

  closeWindow(window: RenderWindow): void {
    this._assertActive()
    if (!this._floatingWindows.has(window)) return
    window.close()
  }

  closeDockWindow(window: RenderWindow): void {
    this._assertActive()
    if (!this._dockWindows.has(window)) return
    window.close()
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._closeAllLoading()
    for (const floatingWindow of [...this._floatingWindows]) {
      floatingWindow.close()
    }
    for (const dockWindow of [...this._dockWindows]) {
      dockWindow.close()
    }
    this._floatingWindows.clear()
    this._floatingWindowCleanup.clear()
    this._dockWindows.clear()
    this._dockWindowCleanup.clear()
    this._dockWindowOptions.clear()
    this._preDockWindowBounds.clear()
    this._windowHost = null
    this._dockWindowHost = null
    this._layoutInspectorUnsubscribe?.()
    this._layoutInspectorUnsubscribe = undefined
    if (this._devToolsWindow) {
      this._layoutInspector?.setIgnoredRoot(this._devToolsWindow, false)
    }
    if (this._runtimeDiagnosticsSnapshotViewer) {
      this._layoutInspector?.setIgnoredRoot(this._runtimeDiagnosticsSnapshotViewer, false)
    }
    this._layoutInspector = null
    this._devToolsWindow = null
    this._layoutInspectorPanelCompat = null
    this._runtimeDiagnosticsPanelCompat = null
    this._runtimeDiagnosticsSnapshotViewer = null
    this._runtimeDebug = null
    this._performanceOverlay = null
    for (const record of [...this._modalWindowRecords]) {
      record.window.closeWithResult(false)
    }
    this._modalWindowRecords.length = 0
    this._syncModalWindowState()
    this._modalWindowHost = null
    this._activeModal?.dispose()
    this._activeModal = null
    this.contextMenuManager.dispose()
    this.notificationManager.dispose()
    this.tooltipManager.dispose()
    TooltipService.clearCurrent(this.tooltipManager)
  }

  private _ensureLoadingModal(): void {
    if (this._loadingModal) return
    this._loadingModal = new RenderLoadingModal()
  }

  private _closeLoadingEntry(entry: AppLoadingEntry): void {
    if (entry.closed) return
    entry.closed = true
    const index = this._loadingEntries.indexOf(entry)
    if (index >= 0) this._loadingEntries.splice(index, 1)
    if (this._loadingEntries.length > 0) {
      this._syncLoadingModalState()
      this._loadingModal?.show()
      return
    }
    this._loadingModal?.dispose()
    this._loadingModal = null
  }

  private _closeAllLoading(): void {
    for (const entry of this._loadingEntries) entry.closed = true
    this._loadingEntries.length = 0
    this._loadingModal?.dispose()
    this._loadingModal = null
  }

  private _syncLoadingModalText(): void {
    this._syncLoadingModalState()
  }

  private _syncLoadingModalState(): void {
    const entry = this._latestLoadingEntry()
    this._loadingModal?.setText(entry?.text)
    this._loadingModal?.setProgress(entry?.progress)
  }

  private _latestLoadingEntry(): AppLoadingEntry | undefined {
    for (let i = this._loadingEntries.length - 1; i >= 0; i--) {
      const entry = this._loadingEntries[i]!
      if (!entry.closed) return entry
    }
    return undefined
  }

  private _syncModalWindowHost(): void {
    this._modalWindowHost?.setModalWindows(this._modalWindowRecords.map(record => record.window))
  }

  private _syncModalWindowState(): void {
    this._syncModalWindowHost()
    const topModal = this.activeModalWindow
    if (!topModal) {
      const restore = this._modalFocusRestore
      this._modalFocusRestore = null
      if (this._modalFocusScope) {
        this._modalFocusScope = null
        FocusManager.instance.popScope(restore)
      } else if (restore) {
        FocusManager.instance.setFocus(restore)
      }
      return
    }

    if (!this._modalFocusScope) {
      this._modalFocusScope = new FocusScope(FocusScopeType.Modal)
      this._modalFocusRestore = FocusManager.instance.pushScope(this._modalFocusScope)
    }
    FocusManager.instance.refreshScopeFocusRoots(this._modalFocusScope, [topModal])
    FocusManager.instance.setFocus(topModal)
  }

  private _resolveOverlayContext(options: AppOverlayContextOptions): ResolvedOverlayContext {
    if (options.context) {
      this._applyContextValues(options.context, options.contextValues)
      return {
        context: options.context,
        disposeOnDispose: options.disposeContextOnClose ?? false,
      }
    }
    const inherited = options.source ? this._createSourceContextSnapshot(options.source) : undefined
    if (inherited) {
      this._applyContextValues(inherited, options.contextValues)
      return {
        context: inherited,
        disposeOnDispose: true,
      }
    }
    if (options.contextValues) {
      return {
        context: new AppContextRegistry(undefined, options.contextValues),
        disposeOnDispose: true,
      }
    }
    return { disposeOnDispose: false }
  }

  private _createSourceContextSnapshot(source: RenderObject): AppContextRegistry | undefined {
    const snapshot = new AppContextRegistry()
    const seen = new Set<AppContextLookupKey>()
    let hasEntries = false
    let current: RenderObject | undefined = source
    while (current) {
      if (isAppContextProvider(current)) {
        const context = current[APP_CONTEXT_PROVIDER]()
        hasEntries = this._copyContextOwnValues(snapshot, context, seen) || hasEntries
      }
      current = current.parent
    }
    const rootContext = source.owner?.appContext
    if (rootContext) {
      let currentContext: AppContextRegistry | undefined = rootContext
      while (currentContext) {
        hasEntries = this._copyContextOwnValues(snapshot, currentContext, seen) || hasEntries
        currentContext = currentContext.parent
      }
    }
    if (hasEntries) return snapshot
    snapshot.dispose()
    return undefined
  }

  private _copyContextOwnValues(
    target: AppContextRegistry,
    source: AppContextRegistry,
    seen: Set<AppContextLookupKey>,
  ): boolean {
    let copied = false
    for (const key of source.keys()) {
      if (seen.has(key)) continue
      seen.add(key)
      target.set(key as never, source.getOwn(key as never))
      copied = true
    }
    return copied
  }

  private _applyContextValues(
    context: AppContextRegistry,
    values?: Exclude<AppContextInitialValues, AppContextRegistry>,
  ): void {
    if (!values) return
    const nextValues = new AppContextRegistry(undefined, values)
    for (const key of nextValues.keys()) context.set(key as never, nextValues.get(key as never))
    nextValues.dispose()
  }

  private _assertActive(): void {
    if (this._disposed) {
      throw new Error('AppOverlayService is unavailable after dispose().')
    }
  }

  private _requireWindowHost(): RenderWindow {
    if (!this._windowHost) {
      throw new Error('AppOverlayService window host is unavailable before Application.run() binds the main window.')
    }
    return this._windowHost
  }

  private _requireDockWindowHost(): AppDockWindowController {
    if (!this._dockWindowHost) {
      throw new Error('AppOverlayService dock window host is unavailable before Application.run() binds RuntimeHost.')
    }
    return this._dockWindowHost
  }

  private _requireLayoutInspector(): LayoutInspectorService {
    if (!this._layoutInspector) {
      throw new Error('AppOverlayService layout inspector is unavailable before Application.run() binds RuntimeHost.')
    }
    return this._layoutInspector
  }

  private _requirePerformanceOverlay(): AppPerformanceOverlayController {
    if (!this._performanceOverlay) {
      throw new Error('AppOverlayService performance overlay is unavailable before Application.run() binds RuntimeHost.')
    }
    return this._performanceOverlay
  }

  private _requireRuntimeDebug(): AppRuntimeDebugController {
    if (!this._runtimeDebug) {
      throw new Error('AppOverlayService runtime debug controller is unavailable before Application.run() binds RuntimeHost.')
    }
    return this._runtimeDebug
  }

  private _syncLayoutInspectorPanel(state: LayoutInspectorDebugState | undefined): void {
    if (!this._devToolsWindow || this._devToolsWindow.disposed) return
    if (!state) return
    this._devToolsWindow.setLayoutInspectorState(state)
    this._devToolsWindow.setLayoutRuntimeDebugState(this._runtimeDebugState())
  }

  private _syncRuntimeDiagnosticsPanel(): void {
    if (!this._devToolsWindow || this._devToolsWindow.disposed || !this._runtimeDebug) return
    this._devToolsWindow.setRuntimeDiagnosticsState(this._runtimeDiagnosticsState())
  }

  private _runtimeDiagnosticsState(): RuntimeDiagnosticsState {
    const runtimeDebug = this._requireRuntimeDebug()
    return {
      paintRequestDebugEnabled: runtimeDebug.paintRequestDebugEnabled,
      paintRequests: runtimeDebug.getPaintRequestHistory(),
    }
  }

  private _runtimeDebugState(): { paintRequestDebugEnabled: boolean, paintRequests: RuntimePaintRequestRecord[] } | null {
    if (!this._runtimeDebug) return null
    return {
      paintRequestDebugEnabled: this._runtimeDebug.paintRequestDebugEnabled,
      paintRequests: this._runtimeDebug.getPaintRequestHistory(12),
    }
  }

  private _createDevToolsExtraTabs(
    definitions: readonly AppDevToolsTab[] = this._devToolsTabs,
  ): RenderDevToolsExtraTab[] {
    const created: RenderDevToolsExtraTab[] = []
    const contents = new Set<RenderBox>()
    try {
      for (const tab of definitions) {
        const content = tab.createContent()
        if (contents.has(content)) {
          throw new Error(`AppOverlayService DevTools tab "${tab.key}" reused another tab's content.`)
        }
        contents.add(content)
        created.push({
          key: tab.key,
          label: tab.label,
          icon: tab.icon,
          content,
        })
      }
      return created
    } catch (error) {
      disposeDevToolsTabContents(created)
      throw error
    }
  }

  private _exportRuntimeDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot {
    const snapshot = this._createRuntimeDiagnosticsSnapshot()
    downloadDiagnosticsSnapshot(snapshot)
    return snapshot
  }

  private _createRuntimeDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot {
    const controller = this._requireRuntimeDebug()
    if (!controller.createDiagnosticsSnapshot) {
      throw new Error('AppOverlayService runtime debug controller does not support diagnostics snapshots.')
    }
    return controller.createDiagnosticsSnapshot()
  }

  private _showDeveloperDockWindow(window: RenderWindow, options: RuntimeDockWindowOptions): RenderWindow {
    if (this._dockWindowHost) return this.showDockWindow(window, options)
    return this.showWindow(window)
  }

  private _dockWindowOnHost(window: RenderWindow, options?: RuntimeDockWindowOptions): void {
    const dockHost = this._requireDockWindowHost()
    dockHost.dockWindow(window, options)
    window.setHostDockHandlers({
      onSideChange: (_window, side) => this._handleDockWindowSideChange(_window, side),
      onResizeMove: (_window, position) => {
        this._dockWindowHost?.resizeDockWindow?.(_window, position)
      },
    })
  }

  private _handleDockWindowSideChange(window: RenderWindow, side: RenderWindowHostDockSide): void {
    if (side === 'float') {
      this.showWindow(window)
      return
    }
    const previous = this._dockWindowOptions.get(window) ?? {}
    const next = { ...previous, side }
    this._dockWindowOptions.set(window, next)
    window.setHostDockSide(side)
    this._dockWindowHost?.updateDockWindow?.(window, next)
  }

  private _notifyDevToolsVisibility(visible: boolean): void {
    for (const listener of [...this._devToolsVisibilityListeners]) {
      this._notifyDevToolsVisibilityListener(listener, visible)
    }
  }

  private _notifyDevToolsVisibilityListener(
    listener: AppDevToolsVisibilityListener,
    visible: boolean,
  ): void {
    try {
      listener(visible)
    } catch (error) {
      console.error('AppOverlayService DevTools visibility listener failed.', error)
    }
  }

  private _restorePreDockWindowBounds(window: RenderWindow): void {
    const bounds = this._preDockWindowBounds.get(window)
    this._preDockWindowBounds.delete(window)
    if (!bounds) return
    window.windowX = bounds.x
    window.windowY = bounds.y
    window.windowWidth = bounds.width
    window.windowHeight = bounds.height
    window.offset = { x: bounds.x, y: bounds.y }
    window.markNeedsLayout()
  }

  private _closeLayoutInspectorPanel(): void {
    const window = this._devToolsWindow
    if (!window) return
    this._layoutInspector?.setIgnoredRoot(window, false)
    this._devToolsWindow = null
    this._layoutInspectorPanelCompat = null
    this._runtimeDiagnosticsPanelCompat = null
    this._notifyDevToolsVisibility(false)
    if (!window.disposed) window.close()
  }

  private _closeRuntimeDiagnosticsPanel(): void {
    const window = this._devToolsWindow
    if (!window) return
    this._layoutInspector?.setIgnoredRoot(window, false)
    this._devToolsWindow = null
    this._layoutInspectorPanelCompat = null
    this._runtimeDiagnosticsPanelCompat = null
    this._notifyDevToolsVisibility(false)
    if (!window.disposed) window.close()
  }
}

function normalizeDevToolsTabDefinitions(tabs: readonly AppDevToolsTab[]): AppDevToolsTab[] {
  const usedKeys = new Set<string>(['layout-inspector', 'runtime'])
  return tabs.map(tab => {
    const key = tab.key.trim()
    if (!key) throw new Error('AppOverlayService DevTools tab key cannot be empty.')
    if (usedKeys.has(key)) {
      throw new Error(`AppOverlayService DevTools tab key "${key}" is already used.`)
    }
    usedKeys.add(key)
    return key === tab.key ? tab : { ...tab, key }
  })
}

function disposeDevToolsTabContents(tabs: readonly RenderDevToolsExtraTab[]): void {
  for (const tab of tabs) {
    try {
      tab.content.dispose()
    } catch (error) {
      console.error(`AppOverlayService failed to dispose staged DevTools tab "${tab.key}".`, error)
    }
  }
}
