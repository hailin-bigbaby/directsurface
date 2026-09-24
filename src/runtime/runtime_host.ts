import { DisposableBag } from '../core/disposable'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { KeyboardBindingController } from '../core/keyboard_binding_controller'
import { OverlayInvalidator } from '../core/overlay_invalidator'
import {
  PopupManager,
  type Popup,
  type PopupAnchorMode,
  type PopupContext,
} from '../core/popup_manager'
import { looseConstraints, PipelineOwner, RenderObject, type BoxConstraints, type Offset, type PipelineRequestInfo, type Rect, type RenderDebugInfo } from '../core/render_object'
import { EventDispatcher } from '../gestures/recognizers'
import type { PointerEvent } from '../gestures/hit_test'
import type { PointerRouteInterceptor } from '../gestures/pointer_route_arbiter'
import type { PaintContext } from '../rendering/paint_context'
import { Compositor, type DirtyRect } from '../rendering/compositor'
import type { ResolvedTheme } from '../theme/theme'
import { TooltipManager, TooltipService } from '../widgets/tooltip'
import { RenderWindow } from '../widgets/window'
import {
  type AppContextLookupKey,
  type AppContextRegistry,
} from '../core/app_context'
import { FrameScheduler } from './frame_scheduler'
import { LayerManager, type LayerPainterRegistration, type LayerPaintTimings, type LayerRegistration } from './layer_manager'
import { LayoutInspectorService } from './layout_inspector_service'
import { RuntimePerformanceMonitor } from './performance_monitor'

const PAINT_REQUEST_HISTORY_LIMIT = 80
const DEFAULT_DOCK_WINDOW_SIZE = 420
const MIN_CONTENT_VIEWPORT_WIDTH = 160
const MIN_CONTENT_VIEWPORT_HEIGHT = 120

export interface RuntimeSize {
  width: number
  height: number
  dpr: number
}

export type RuntimeDockSide = 'left' | 'right' | 'bottom'

export interface RuntimeDockWindowOptions {
  side?: RuntimeDockSide
  size?: number
  minSize?: number
  maxSize?: number
}

interface RuntimeDockWindowRecord {
  side: RuntimeDockSide
  size: number
  minSize?: number
  maxSize?: number
}

export interface RuntimeHostOptions {
  canvas: HTMLCanvasElement
  onResize?: (size: RuntimeSize) => void
  onFrame?: () => void
  dpr?: number
  getViewportSize?: () => { width: number, height: number }
  appContext?: AppContextRegistry
  enablePerformanceMonitoring?: boolean
  enablePerformanceOverlay?: boolean
  debugPaintRequests?: boolean
}

export type RuntimePaintRequestKind = 'frame' | 'layout'
export type RuntimePaintRequestSource = 'pipeline' | 'overlay' | 'runtime' | 'window' | 'debug'

export interface RuntimePaintRequestRecord {
  seq: number
  time: number
  kind: RuntimePaintRequestKind
  source: RuntimePaintRequestSource
  reason: string
  detail?: unknown
  alreadyScheduled: boolean
  layoutNeeded: boolean
  dirtyLayers: ReturnType<LayerManager['debugDirtyLayers']>
  pipeline: ReturnType<PipelineOwner['debugPaintState']>
  stack?: string[]
}

export interface RuntimeDiagnosticsSnapshot {
  version: 1
  createdAt: string
  environment: RuntimeDiagnosticsEnvironmentSnapshot
  runtime: RuntimeDiagnosticsRuntimeSnapshot
  layers: RuntimeDiagnosticsLayerSnapshot
  pipeline: ReturnType<PipelineOwner['debugPaintState']>
  paintRequests: RuntimePaintRequestRecord[]
  hotspots: RuntimeDiagnosticsHotspot[]
  performance: RuntimeDiagnosticsPerformanceSnapshot
  layoutInspector: RuntimeDiagnosticsLayoutInspectorSnapshot
  appContext: RuntimeDiagnosticsAppContextEntry[]
  roots: RuntimeDiagnosticsRenderTreeNode[]
  windows: RuntimeDiagnosticsWindowSnapshot[]
}

export interface RuntimeDiagnosticsEnvironmentSnapshot {
  userAgent: string
  viewport: RuntimeSize
  canvas: {
    width: number
    height: number
    styleWidth: string
    styleHeight: string
  }
  dpr: number
}

export interface RuntimeDiagnosticsRuntimeSnapshot {
  disposed: boolean
  rootCount: number
  mountedWindowCount: number
  performanceOverlayVisible: boolean
  paintRequestDebugEnabled: boolean
  frameScheduled: boolean
  layoutNeeded: boolean
}

export interface RuntimeDiagnosticsLayerSnapshot {
  registered: string[]
  dirty: ReturnType<LayerManager['debugDirtyLayers']>
}

export interface RuntimeDiagnosticsHotspot {
  key: string
  target: string
  kind: RuntimePaintRequestKind
  source: RuntimePaintRequestSource
  reason: string
  count: number
  firstSeq: number
  lastSeq: number
  layoutTargets: string[]
  paintTargets: string[]
  transientPaintTargets: string[]
}

export interface RuntimeDiagnosticsPerformanceSnapshot {
  state: ReturnType<RuntimePerformanceMonitor['debugState']>
  samples: ReturnType<RuntimePerformanceMonitor['debugSamples']>
}

export interface RuntimeDiagnosticsLayoutInspectorSnapshot {
  enabled: boolean
  overlayVisible: boolean
  hoverPathLength: number
  selectedPathLength: number
  selectedPathIndex: number
  hoverPathInfo: RenderDebugInfo[]
  selectedPathInfo: RenderDebugInfo[]
  selected?: RenderDebugInfo
  hover?: RenderDebugInfo
  selectedAppContext?: RuntimeDiagnosticsAppContextEntry[]
  renderTree?: RuntimeDiagnosticsRenderTreeNode
}

export interface RuntimeDiagnosticsAppContextEntry {
  key: string
  source: string
  value: unknown
}

export interface RuntimeDiagnosticsRenderTreeNode {
  info: RenderDebugInfo
  children: RuntimeDiagnosticsRenderTreeNode[]
  truncated?: number
}

export interface RuntimeDiagnosticsWindowSnapshot {
  debugId: number
  title: string
  typeName: string
  ownerDebugId?: number
  ownedWindowCount: number
  mounted: boolean
  root: boolean
  offset: Offset
  size: { width: number, height: number }
}

export interface RuntimeMainWindowOptions {
  onMainWindowClose?: () => void
  themeSource?: RuntimeThemeSource
}

export type RuntimeThemeSource = 'main-window' | 'runtime'

export interface RuntimeCaptureRect {
  x: number
  y: number
  width: number
  height: number
}

export interface RuntimeCaptureImageOptions {
  rect?: RuntimeCaptureRect
  type?: string
  quality?: number
  scale?: number
  renderPendingFrame?: boolean
}

export interface RuntimeSizeDependent {
  updateCanvas(width: number, height: number, size: RuntimeSize): void
}

export type RuntimeSizeListener = (size: RuntimeSize) => void
export type RuntimeSizeTarget = RuntimeSizeDependent | RuntimeSizeListener

export type RuntimeManagedTarget = RuntimeSizeTarget

export interface RuntimeManagedTargetOptions {
  size?: boolean
  notifyImmediately?: boolean
}

function supportsSizeSync(target: RuntimeManagedTarget): target is RuntimeSizeTarget {
  return typeof target === 'function' || typeof (target as Partial<RuntimeSizeDependent>).updateCanvas === 'function'
}

interface PaintablePopup extends Popup {
  overlayLayer?: string
  paint(context: PaintContext, offset?: Offset): void
}

function isPaintablePopup(popup: Popup): popup is PaintablePopup {
  return typeof (popup as Partial<PaintablePopup>).paint === 'function'
}

function getPopupLayer(popup: Popup): string {
  const layer = (popup as Partial<PaintablePopup>).overlayLayer
  return typeof layer === 'string' && layer.length > 0 ? layer : 'overlay'
}

function normalizeCaptureScale(scale: number | undefined, dpr: number): number {
  if (scale === undefined) return Math.max(0.01, dpr)
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('RuntimeHost capture scale must be a positive finite number.')
  }
  return scale
}

function normalizeCaptureRect(
  rect: RuntimeCaptureRect | undefined,
  canvasWidth: number,
  canvasHeight: number,
): RuntimeCaptureRect {
  if (!rect) {
    return {
      x: 0,
      y: 0,
      width: canvasWidth,
      height: canvasHeight,
    }
  }
  if (!Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height)) {
    throw new Error('RuntimeHost capture rect must contain finite numbers.')
  }
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error('RuntimeHost capture rect width and height must be positive.')
  }
  const x = Math.max(0, Math.min(canvasWidth, rect.x))
  const y = Math.max(0, Math.min(canvasHeight, rect.y))
  const right = Math.max(x, Math.min(canvasWidth, rect.x + rect.width))
  const bottom = Math.max(y, Math.min(canvasHeight, rect.y + rect.height))
  if (right <= x || bottom <= y) {
    throw new Error('RuntimeHost capture rect is outside the canvas.')
  }
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) return new Blob([dataUrl], { type: 'text/plain' })
  const type = match[1] || 'application/octet-stream'
  const base64 = Boolean(match[2])
  const payload = match[3] || ''
  if (!base64) return new Blob([decodeURIComponent(payload)], { type })
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type })
}

export class RuntimeHost {
  readonly canvas: HTMLCanvasElement
  readonly dpr: number
  readonly compositor: Compositor
  readonly dispatcher: EventDispatcher
  readonly frameScheduler: FrameScheduler
  readonly pipelineOwner: PipelineOwner
  readonly layerManager: LayerManager
  readonly layoutInspector: LayoutInspectorService
  readonly performanceMonitor: RuntimePerformanceMonitor

  private readonly _disposables = new DisposableBag()
  private readonly _getViewportSize: () => { width: number, height: number }
  private readonly _onResize?: (size: RuntimeSize) => void
  private readonly _onFrame?: () => void
  private readonly _sizeDependents = new Set<RuntimeSizeTarget>()
  private readonly _windowRoots = new Set<RenderWindow>()
  private readonly _mountedWindows = new Set<RenderWindow>()
  private readonly _dockedWindows = new Map<RenderWindow, RuntimeDockWindowRecord>()
  private readonly _dockedWindowCleanup = new Map<RenderWindow, () => void>()
  private readonly _ownedWindowSubscriptions = new Map<RenderWindow, () => void>()
  private readonly _windowCloseBindings = new Map<RenderWindow, () => void>()
  private readonly _windowDisposeBindings = new Map<RenderWindow, () => void>()
  private readonly _tooltipManager: TooltipManager
  private readonly _modalWindowGate: PointerRouteInterceptor
  private _modalWindows: RenderWindow[] = []
  private _logicalCanvasWidth = 0
  private _logicalCanvasHeight = 0
  private _mainWindow?: RenderWindow
  private _themeSource: RuntimeThemeSource = 'main-window'
  private _mainLayerRemove?: () => void
  private _performanceLayerRemove?: () => void
  private _onMainWindowClose?: () => void
  private _disposed = false
  private _renderingFrame = false
  private _flushingFrameCommits = false
  private _suppressPipelineScheduling = false
  private _performanceFrameSeq = 0
  private _debugPaintRequests: boolean
  private _paintRequestSeq = 0
  private readonly _paintRequestHistory: RuntimePaintRequestRecord[] = []

  constructor(opts: RuntimeHostOptions) {
    this.canvas = opts.canvas
    this.dpr = opts.dpr ?? (window.devicePixelRatio || 1)
    this._getViewportSize = opts.getViewportSize ?? (() => ({ width: window.innerWidth, height: window.innerHeight }))
    this._onResize = opts.onResize
    this._onFrame = opts.onFrame
    this._debugPaintRequests = opts.debugPaintRequests ?? shouldDebugPaintRequests()

    this._resizeCanvasElement()
    this.compositor = new Compositor(this.canvas, this.dpr)
    this.layerManager = new LayerManager(this.compositor)
    this.dispatcher = new EventDispatcher(this.canvas, {
      onPointerDownDispatchComplete: event => this._handlePointerDownDispatchComplete(event),
    })
    this.layoutInspector = new LayoutInspectorService(this.dispatcher, () => {
      this.markLayerDirty('debug-overlay')
      this.scheduleFrame('layout-inspector')
    })
    this.performanceMonitor = new RuntimePerformanceMonitor({
      enabled: opts.enablePerformanceMonitoring === true || opts.enablePerformanceOverlay === true,
      visible: opts.enablePerformanceOverlay ?? false,
      onInvalidate: () => {
        this.markLayerDirty('performance-overlay')
        this.scheduleFrame('performance-overlay')
      },
    })
    this.performanceMonitor.setViewport(this._currentSize())
    this.dispatcher.addInterceptor(this.performanceMonitor)
    this._modalWindowGate = {
      preserveFocus: true,
      hitTest: position => this._shouldBlockForModalWindow(position),
      onPointerDown: () => this._notifyModalWindowBlockedInteraction(),
      onPointerMove: () => {
        this.canvas.style.cursor = 'default'
        return true
      },
      onPointerUp: () => true,
      onPointerCancel: () => true,
      onWheel: () => this._notifyModalWindowBlockedInteraction(),
    }
    this.dispatcher.addInterceptor(this._modalWindowGate)
    this._disposables.add(this.dispatcher.addDebugPointerMoveListener(position => {
      this.layoutInspector.hoverAt(position)
    }))
    this.frameScheduler = new FrameScheduler(() => {
      this.renderFrame()
      this._onFrame?.()
    })
    this.pipelineOwner = new PipelineOwner({
      appContext: opts.appContext,
      onNeedFrameCommit: info => {
        if (!this._suppressPipelineScheduling) this.scheduleFrame(`pipeline:${info.type}`, info)
      },
      onNeedPaint: info => {
        if (this._suppressPipelineScheduling) return
        if (this._flushingFrameCommits) {
          this._recordCurrentFrameRequest('frame', `pipeline:${info.type}`, info)
          return
        }
        this.scheduleFrame(`pipeline:${info.type}`, info)
      },
      onNeedLayout: info => {
        if (this._suppressPipelineScheduling) return
        if (this._flushingFrameCommits) {
          this._recordCurrentFrameRequest('layout', `pipeline:${info.type}`, info)
          this.frameScheduler.markLayoutNeeded()
          return
        }
        this.scheduleLayout(`pipeline:${info.type}`, info)
      },
      setCursor: cursor => { this.canvas.style.cursor = cursor || 'default' },
      activateWindow: target => {
        if (!(target instanceof RenderWindow)) return
        const topModal = this.activeModalWindow
        if (topModal && target !== topModal) {
          this._notifyModalWindowBlockedInteraction()
          return
        }
        for (const other of this.dispatcher.getRoots()) {
          if (other !== target && other instanceof RenderWindow) {
            other.focusOut()
          }
        }
        this.bringToFront(target)
        this.scheduleFrame('activate-window')
      },
    })
    PopupManager.instance.setPaintInvalidator(() => {
      this.markLayerDirty('overlay')
      this.markLayerDirty('tooltip')
      this.scheduleFrame('popup-manager')
    })
    PopupManager.instance.setContextProvider((anchorRoot, anchorMode) =>
      this._createPopupContext(anchorRoot, anchorMode))
    PopupManager.instance.setAnchorRootProvider(() => this._preferredPopupAnchorRoot())
    this._tooltipManager = new TooltipManager()
    TooltipService.installCurrent(this._tooltipManager)
    this._disposables.add(() => {
      TooltipService.clearCurrent(this._tooltipManager)
      this._tooltipManager.dispose()
    })
    this._disposables.add(this.registerLayerPainter({
      layer: 'transient',
      paint: ({ context }) => this.pipelineOwner.flushTransientPaint(context),
      shouldPaint: () =>
        this.isLayerDirty('transient') ||
        this.pipelineOwner.hasTransientPaint(),
      dirtyRect: () => this.pipelineOwner.getTransientPaintRect(),
    }))
    this._disposables.add(this.registerLayerPainter({
      layer: 'overlay',
      paint: ({ context }) => this._paintPopupLayer(context, 'overlay'),
    }))
    this._disposables.add(this.registerLayerPainter({
      layer: 'tooltip',
      paint: ({ context }) => this._paintPopupLayer(context, 'tooltip'),
    }))
    this._disposables.add(this.registerLayerPainter({
      layer: 'debug-overlay',
      paint: ({ context }) => {
        context.setTheme?.(this.pipelineOwner.theme)
        this.layoutInspector.paint(context)
      },
      shouldPaint: () =>
        this.isLayerDirty('debug-overlay') ||
        this.layoutInspector.shouldPaint(),
    }))
    if (this.performanceMonitor.visible) this._ensurePerformanceOverlayLayer()

    this._disposables.addDisposable(this.frameScheduler)
    this._disposables.addDisposable(this.dispatcher)
    this._disposables.listen(window, 'resize', () => {
      this.resize()
      this.scheduleLayout('window-resize')
    })
    this._disposables.listen(window, 'contextmenu', event => this._handleWindowContextMenu(event), { capture: true })
    this._disposables.listen(window, 'beforeunload', () => this.dispose())
  }

  get canvasWidth(): number {
    return this._logicalCanvasWidth
  }

  get canvasHeight(): number {
    return this._logicalCanvasHeight
  }

  get viewportWidth(): number {
    return this._getViewportSize().width
  }

  get viewportHeight(): number {
    return this._getViewportSize().height
  }

  get theme(): ResolvedTheme {
    return this.pipelineOwner.theme
  }

  get performanceOverlayVisible(): boolean {
    return this.performanceMonitor.visible
  }

  get activeModalWindow(): RenderWindow | null {
    return this._modalWindows[this._modalWindows.length - 1] ?? null
  }

  get modalWindows(): readonly RenderWindow[] {
    return this._modalWindows
  }

  setModalWindows(windows: readonly RenderWindow[]): void {
    this._modalWindows = [...windows].filter(window => !window.disposed)
    this._moveModalWindowsToFront()
    const topModal = this.activeModalWindow
    if (topModal) {
      for (const root of this.dispatcher.getRoots()) {
        if (root instanceof RenderWindow && root !== topModal) root.focusOut()
      }
      FocusManager.instance.setFocus(topModal)
    }
    this.markAllLayersDirty()
    this.scheduleFrame('modal-window-stack')
  }

  centerWindowInViewport(window: RenderWindow): void {
    const viewport = this._canvasViewport()
    const width = Math.min(viewport.width, window.windowWidth)
    const height = Math.min(viewport.height, window.windowHeight)
    window.setHostManagedBounds({
      x: viewport.x + Math.max(0, (viewport.width - width) / 2),
      y: viewport.y + Math.max(0, (viewport.height - height) / 2),
      width,
      height,
    })
  }

  private _handleWindowContextMenu(event: MouseEvent): void {
    if (!this._isPointInsideCanvas(event.clientX, event.clientY)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.dispatcher.handleContextMenuEvent(event)
  }

  private _handlePointerDownDispatchComplete(event: PointerEvent): void {
    if (this._disposed || this._renderingFrame) return
    const performanceOverlayHandled = this.performanceMonitor.consumeHandledPointerDown(event)
    if (this.layoutInspector.overlayVisible && !performanceOverlayHandled) {
      this.layoutInspector.inspectAt(event.position)
    }
    if (!this.frameScheduler.frameScheduled || this.frameScheduler.layoutNeeded) return
    this.frameScheduler.cancelFrame()
    this.renderFrame()
  }

  private _isPointInsideCanvas(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect()
    return clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
  }

  private _recordPaintRequest(kind: RuntimePaintRequestKind, reason: string, detail?: unknown): RuntimePaintRequestRecord {
    const record: RuntimePaintRequestRecord = {
      seq: ++this._paintRequestSeq,
      time: now(),
      kind,
      source: classifyPaintRequestSource(reason),
      reason,
      detail: sanitizePaintRequestDetail(detail),
      alreadyScheduled: this.frameScheduler.frameScheduled,
      layoutNeeded: this.frameScheduler.layoutNeeded,
      dirtyLayers: this.layerManager.debugDirtyLayers(),
      pipeline: this.pipelineOwner.debugPaintState(),
      stack: this._debugPaintRequests ? paintRequestStack() : undefined,
    }
    this._paintRequestHistory.push(record)
    if (this._paintRequestHistory.length > PAINT_REQUEST_HISTORY_LIMIT) {
      this._paintRequestHistory.splice(0, this._paintRequestHistory.length - PAINT_REQUEST_HISTORY_LIMIT)
    }
    return record
  }

  private _logPaintRequest(record: RuntimePaintRequestRecord): void {
    if (!this._debugPaintRequests) return
    console.debug('[DirectSurface.paintRequest]', record)
  }

  get paintRequestDebugEnabled(): boolean {
    return this._debugPaintRequests
  }

  setPaintRequestDebugEnabled(enabled: boolean): void {
    this._debugPaintRequests = enabled
  }

  getPaintRequestHistory(limit = PAINT_REQUEST_HISTORY_LIMIT): RuntimePaintRequestRecord[] {
    const normalizedLimit = Math.max(0, Math.floor(limit))
    const records = normalizedLimit === 0
      ? []
      : this._paintRequestHistory.slice(-normalizedLimit)
    return records.map(clonePaintRequestRecord)
  }

  clearPaintRequestHistory(): void {
    this._paintRequestHistory.length = 0
  }

  captureImageDataUrl(options: RuntimeCaptureImageOptions = {}): string {
    const canvas = this._captureCanvas(options)
    return canvas.toDataURL(options.type ?? 'image/png', options.quality)
  }

  captureImageBlob(options: RuntimeCaptureImageOptions = {}): Promise<Blob> {
    const canvas = this._captureCanvas(options)
    const type = options.type ?? 'image/png'
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob(blob => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('RuntimeHost failed to capture canvas image blob.'))
          }
        }, type, options.quality)
        return
      }
      try {
        resolve(dataUrlToBlob(canvas.toDataURL(type, options.quality)))
      } catch (error) {
        reject(error)
      }
    })
  }

  createDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot {
    const paintRequests = this.getPaintRequestHistory()
    const inspectorState = this.layoutInspector.debugState()
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      environment: {
        userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
        viewport: this._currentSize(),
        canvas: {
          width: this.canvas.width,
          height: this.canvas.height,
          styleWidth: this.canvas.style.width,
          styleHeight: this.canvas.style.height,
        },
        dpr: this.dpr,
      },
      runtime: {
        disposed: this._disposed,
        rootCount: this.getRoots().length,
        mountedWindowCount: this._mountedWindows.size,
        performanceOverlayVisible: this.performanceOverlayVisible,
        paintRequestDebugEnabled: this.paintRequestDebugEnabled,
        frameScheduled: this.frameScheduler.frameScheduled,
        layoutNeeded: this.frameScheduler.layoutNeeded,
      },
      layers: {
        registered: this.layerManager.getRegisteredLayers(),
        dirty: this.layerManager.debugDirtyLayers(),
      },
      pipeline: clonePipelineDebugState(this.pipelineOwner.debugPaintState()),
      paintRequests,
      hotspots: aggregatePaintRequestHotspots(paintRequests),
      performance: {
        state: cloneRuntimePerformanceState(this.performanceMonitor.debugState()),
        samples: this.performanceMonitor.debugSamples(80),
      },
      layoutInspector: snapshotLayoutInspectorState(inspectorState),
      appContext: snapshotAppContext(this.pipelineOwner.appContext),
      roots: this.getRoots().map(root => snapshotRenderTree(root)),
      windows: [...this._mountedWindows].map(window => snapshotWindow(window, this._windowRoots.has(window), this._mountedWindows.has(window))),
    }
  }

  scheduleFrame(reason = 'manual', detail?: unknown): void {
    const record = this._recordPaintRequest('frame', reason, detail)
    this._logPaintRequest(record)
    this.frameScheduler.scheduleFrame()
  }

  scheduleLayout(reason = 'manual', detail?: unknown): void {
    const record = this._recordPaintRequest('layout', reason, detail)
    this._logPaintRequest(record)
    this.frameScheduler.scheduleLayout()
  }

  private _recordCurrentFrameRequest(
    kind: RuntimePaintRequestKind,
    reason: string,
    detail?: unknown,
  ): void {
    const record = this._recordPaintRequest(kind, reason, detail)
    this._logPaintRequest(record)
  }

  consumeLayoutNeeded(): boolean {
    return this.frameScheduler.consumeLayoutNeeded()
  }

  runMainWindow(mainWindow: RenderWindow, options: RuntimeMainWindowOptions = {}): void {
    if (this._mainWindow) {
      throw new Error('RuntimeHost already has a mounted main window.')
    }

    this._mainWindow = mainWindow
    this._themeSource = options.themeSource ?? 'main-window'
    this._onMainWindowClose = options.onMainWindowClose
    this._configureMainWindow(mainWindow)
    this._ensureMainLayer()
    this._mountWindow(mainWindow)
    this.scheduleLayout('run-main-window')
    this.scheduleFrame('run-main-window')
  }

  dockWindow(window: RenderWindow, options: RuntimeDockWindowOptions = {}): RenderWindow {
    if (this._disposed) {
      throw new Error('RuntimeHost cannot dock a window after dispose().')
    }
    if (window === this._mainWindow) {
      throw new Error('RuntimeHost cannot dock the main window.')
    }
    if (window.disposed) {
      throw new Error('RuntimeHost cannot dock a disposed window.')
    }
    const previous = this._dockedWindows.get(window)
    const record = this._normalizeDockRecord({
      side: options.side ?? previous?.side ?? 'right',
      size: options.size ?? previous?.size ?? DEFAULT_DOCK_WINDOW_SIZE,
      minSize: options.minSize ?? previous?.minSize,
      maxSize: options.maxSize ?? previous?.maxSize,
    })
    this._dockedWindows.set(window, record)
    window.setPresentation('host-docked')
    window.setHostDockSide(record.side)
    window.setHostDockHandlers({
      onSideChange: (target, side) => {
        if (side === 'float') {
          this._floatDockWindow(target)
          return
        }
        this.updateDockWindow(target, { side })
      },
      onResizeMove: (target, position) => {
        this.resizeDockWindow(target, position)
      },
    })
    if (!this._dockedWindowCleanup.has(window)) {
      this._dockedWindowCleanup.set(window, window.manage(() => {
        const wasDocked = this._dockedWindows.delete(window)
        this._dockedWindowCleanup.delete(window)
        if (this._disposed) return
        if (wasDocked) this._handleDockWindowRemoved('docked-window-dispose')
      }))
    }
    this._mountWindow(window)
    this._syncWindowConstraints()
    this.markAllLayersDirty()
    this.scheduleLayout('dock-window')
    return window
  }

  undockWindow(window: RenderWindow, options: { dispose?: boolean } = {}): void {
    if (!this._dockedWindows.has(window)) return
    this._dockedWindows.delete(window)
    this._dockedWindowCleanup.get(window)?.()
    this._dockedWindowCleanup.delete(window)
    this._unmountWindow(window, options.dispose ?? false)
    if (!(options.dispose ?? false) && !window.disposed) {
      window.setPresentation('floating')
      window.setHostDockHandlers(undefined)
      window.setWindowBounds({ width: window.windowWidth, height: window.windowHeight })
    }
    this.markAllLayersDirty()
    this.scheduleLayout('undock-window')
  }

  isDockedWindow(window: RenderWindow): boolean {
    return this._dockedWindows.has(window)
  }

  updateDockWindow(window: RenderWindow, options: RuntimeDockWindowOptions = {}): void {
    const previous = this._dockedWindows.get(window)
    if (!previous) return
    const record = this._normalizeDockRecord({
      side: options.side ?? previous.side,
      size: options.size ?? previous.size,
      minSize: options.minSize ?? previous.minSize,
      maxSize: options.maxSize ?? previous.maxSize,
    })
    this._dockedWindows.set(window, record)
    window.setHostDockSide(record.side)
    this._syncWindowConstraints()
    this.markAllLayersDirty()
    this.scheduleLayout('update-dock-window')
  }

  resizeDockWindow(window: RenderWindow, position: Offset): void {
    const record = this._dockedWindows.get(window)
    if (!record) return
    if (record.side === 'left') {
      record.size = position.x
    } else if (record.side === 'right') {
      record.size = this.canvasWidth - position.x
    } else {
      record.size = this.canvasHeight - position.y
    }
    this._dockedWindows.set(window, this._normalizeDockRecord(record))
    this._syncWindowConstraints()
    this.markAllLayersDirty()
    this.scheduleLayout('resize-dock-window')
  }

  initTheme(theme: ResolvedTheme): void {
    this._applyTheme(theme, 'init-theme')
  }

  setTheme(theme: ResolvedTheme): void {
    this._themeSource = 'runtime'
    this._applyTheme(theme, 'set-theme')
  }

  useMainWindowTheme(): void {
    if (this._themeSource === 'main-window') return
    this._themeSource = 'main-window'
    this.scheduleLayout('use-main-window-theme')
  }

  addSizeDependent(target: RuntimeSizeTarget, notifyImmediately = true): () => void {
    this._sizeDependents.add(target)
    if (notifyImmediately) this._notifySizeDependent(target, this._currentSize())
    return () => this.removeSizeDependent(target)
  }

  removeSizeDependent(target: RuntimeSizeTarget): void {
    this._sizeDependents.delete(target)
  }

  addManagedTarget(target: RuntimeManagedTarget, options: RuntimeManagedTargetOptions = {}): () => void {
    const syncSize = options.size ?? supportsSizeSync(target)

    const removeSize = syncSize && supportsSizeSync(target)
      ? this.addSizeDependent(target, options.notifyImmediately ?? true)
      : () => {}

    return () => { removeSize() }
  }

  addRoot(root: RenderObject): void {
    this.dispatcher.addRoot(root)
    root.attach(this.pipelineOwner)
    this.pipelineOwner.recordLayoutConstraints(root, this._defaultRootConstraints())
    this.pipelineOwner.requestLayout(root)

    if (root instanceof RenderWindow) {
      this._attachWindow(root)
    }

    this.markAllLayersDirty()
    this.scheduleLayout('add-root', root.constructor?.name)
  }

  removeRoot(root: RenderObject): void {
    let shouldRestoreFocus = root instanceof RenderWindow && (
      this._windowOwnsFocus(root) || FocusManager.instance.activeRoot === root
    )

    PopupManager.instance.closeAnchoredTo(root)
    if (root instanceof RenderWindow && this._windowOwnsFocus(root)) {
      shouldRestoreFocus = true
    }

    if (root instanceof RenderWindow) {
      this._detachWindow(root)
    }

    this.dispatcher.removeRoot(root)
    this.pipelineOwner.forget(root)
    root.detach()

    if (shouldRestoreFocus) {
      this._restoreWindowFocus()
    }

    this.markAllLayersDirty()
    this.scheduleFrame('remove-root', root.constructor?.name)
  }

  bringToFront(root: RenderObject): void {
    if (root instanceof RenderWindow) {
      const topModal = this.activeModalWindow
      if (topModal && root !== topModal) {
        this._notifyModalWindowBlockedInteraction()
        return
      }
      const branchRoot = this._windowBranchRoot(root)
      if (branchRoot === root && this._orderedMountedBranch(branchRoot).length <= 1) {
        this.dispatcher.bringToFront(root)
      } else {
        this._promoteWindowOwnershipPath(root)
        this._moveWindowBranchToFront(this._orderedMountedBranch(branchRoot))
      }
    } else {
      this.dispatcher.bringToFront(root)
    }
    this.markAllLayersDirty()
  }

  getRoots(): RenderObject[] {
    return this.dispatcher.getRoots()
  }

  paintRoots(
    context: PaintContext,
    shouldPaint: (root: RenderObject) => boolean = () => true,
    offsetFor: (root: RenderObject) => Offset = root => root.offset,
  ): void {
    context.setTheme?.(this.pipelineOwner.theme)
    for (const root of this.getRoots()) {
      if (shouldPaint(root)) root.paint(context, offsetFor(root))
    }
  }

  setRootConstraints(root: RenderObject, constraints: BoxConstraints): void {
    this.pipelineOwner.recordLayoutConstraints(root, constraints)
    root.markNeedsLayout()
  }

  flushLayout(): void {
    this.pipelineOwner.flushLayout()
  }

  flushPaint(context: PaintContext): void {
    this.pipelineOwner.flushPaint(context)
  }

  clearPaintRequests(): void {
    this.pipelineOwner.clearPaintRequests()
  }

  registerLayer(registration: LayerRegistration): () => void {
    return this.layerManager.registerLayer(registration)
  }

  registerLayerPainter(registration: LayerPainterRegistration): () => void {
    return this.layerManager.registerPainter(registration)
  }

  markLayerDirty(layer: string): void {
    this.layerManager.markDirty(layer)
  }

  markLayerDirtyRect(layer: string, rect: DirtyRect): void {
    this.layerManager.markDirtyRect(layer, rect)
  }

  markAllLayersDirty(): void {
    this.layerManager.markAllDirty()
  }

  isLayerDirty(layer: string): boolean {
    return this.layerManager.isLayerDirty(layer)
  }

  setPerformanceOverlayVisible(visible: boolean): void {
    if (this.performanceMonitor.visible === visible) return
    if (visible) {
      this.performanceMonitor.enabled = true
      this._ensurePerformanceOverlayLayer()
    }
    this.performanceMonitor.visible = visible
    this.markLayerDirty('performance-overlay')
    this.scheduleFrame('performance-overlay-visible')
  }

  setPerformanceMonitoringEnabled(enabled: boolean): void {
    this.performanceMonitor.enabled = enabled
  }

  togglePerformanceOverlay(): boolean {
    const visible = !this.performanceMonitor.visible
    this.setPerformanceOverlayVisible(visible)
    return visible
  }

  hasDirtyPaintForRoot(root: RenderObject): boolean {
    return this.pipelineOwner.hasDirtyPaintInSubtree(root)
  }

  hasDirtyPaintForRoots(roots: Iterable<RenderObject>): boolean {
    for (const root of roots) {
      if (this.hasDirtyPaintForRoot(root)) return true
    }
    return false
  }

  getDirtyPaintRectForRoots(roots: Iterable<RenderObject>): DirtyRect | undefined {
    let rect: DirtyRect | undefined
    for (const root of roots) {
      const next = this.pipelineOwner.getDirtyPaintRectInSubtree(root)
      if (!next) continue
      rect = rect ? unionRect(rect, next) : { ...next }
    }
    return rect
  }

  paintLayers(): LayerPaintTimings {
    return this.layerManager.paintAll()
  }

  renderFrame(): void {
    if (this._disposed) return
    if (this._renderingFrame) return
    this._renderingFrame = true
    const measurePerformance = this.performanceMonitor.enabled
    const seq = measurePerformance ? ++this._performanceFrameSeq : 0
    const frameStart = measurePerformance ? now() : 0
    let layoutNeeded = false
    let layoutMs = 0
    let paintMs = 0
    let contentPaintMs = 0
    let transientPaintMs = 0
    let compositeMs = 0

    try {
      this._flushingFrameCommits = true
      try {
        this.pipelineOwner.flushFrameCommits()
      } finally {
        this._flushingFrameCommits = false
      }
      layoutNeeded = this.frameScheduler.layoutNeeded
      if (this.consumeLayoutNeeded()) {
        const layoutStart = measurePerformance ? now() : 0
        this._syncMainWindowTheme()
        this._syncWindowConstraints()
        this.markAllLayersDirty()
        this.flushLayout()
        if (measurePerformance) layoutMs = now() - layoutStart
      }

      if (this.performanceMonitor.visible) this.markLayerDirty('performance-overlay')
      const paintStart = measurePerformance ? now() : 0
      const layerPaintTimings = this.paintLayers()
      if (measurePerformance) {
        paintMs = now() - paintStart
        contentPaintMs = layerPaintTimings.main ?? 0
        transientPaintMs = layerPaintTimings.transient ?? 0
      }
      this.clearPaintRequests()
      this.pipelineOwner.clearTransientPaintRequests()
      const compositeStart = measurePerformance ? now() : 0
      this.compositor.composite()
      if (measurePerformance) {
        compositeMs = now() - compositeStart
        this.performanceMonitor.recordFrame({
          seq,
          totalMs: now() - frameStart,
          layoutMs,
          paintMs,
          contentPaintMs,
          transientPaintMs,
          compositeMs,
          layoutNeeded,
          rootCount: this.getRoots().length,
          layerCount: this.compositor.getLayerOrder().length,
        })
      }
    } finally {
      this._renderingFrame = false
    }
  }

  resize(): RuntimeSize {
    const size = this._resizeCanvasElement()
    this.performanceMonitor.setViewport(size)
    this.compositor.resize(size.width, size.height, size.dpr)
    for (const root of this.getRoots()) {
      this.pipelineOwner.recordLayoutConstraints(root, this._defaultRootConstraints())
      root.markNeedsLayout()
    }
    this.markAllLayersDirty()
    this._notifySizeDependents(size)
    this._onResize?.(size)
    return size
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    if (this._mainWindow && this._mountedWindows.has(this._mainWindow)) {
      this._unmountWindow(this._mainWindow, true)
    }
    this._mainWindow = undefined
    this._onMainWindowClose = undefined
    this._mainLayerRemove?.()
    this._mainLayerRemove = undefined

    const roots = [...this.getRoots()]
    for (const root of roots) {
      if (root instanceof RenderWindow) {
        this._detachWindow(root)
      }
      this.dispatcher.removeRoot(root)
      this.pipelineOwner.forget(root)
      root.dispose()
    }
    this._disposables.dispose()
    FocusManager.disposeInstance()
    InputComposer.disposeInstance()
    KeyboardBindingController.disposeInstance()
    PopupManager.disposeInstance()
    OverlayInvalidator.disposeInstance()
    this.pipelineOwner.clearFrameCommits()
    this.pipelineOwner.appContext.dispose()
    this._sizeDependents.clear()
    this._paintRequestHistory.length = 0
  }

  private _currentSize(): RuntimeSize {
    return { width: this.canvasWidth, height: this.canvasHeight, dpr: this.dpr }
  }

  private _defaultRootConstraints(): BoxConstraints {
    const viewport = this._contentViewport()
    return looseConstraints(viewport.width, viewport.height)
  }

  private _captureCanvas(options: RuntimeCaptureImageOptions): HTMLCanvasElement {
    if (this._disposed) {
      throw new Error('RuntimeHost cannot capture a disposed runtime.')
    }
    if (options.renderPendingFrame ?? true) {
      this.renderFrame()
    }
    const rect = normalizeCaptureRect(options.rect, this.canvasWidth, this.canvasHeight)
    const targetScale = normalizeCaptureScale(options.scale, this.dpr)
    const capturesFullCanvas = !options.rect &&
      Math.abs(targetScale - this.dpr) < 0.0001
    if (capturesFullCanvas) return this.canvas

    const target = document.createElement('canvas')
    target.width = Math.max(1, Math.round(rect.width * targetScale))
    target.height = Math.max(1, Math.round(rect.height * targetScale))
    const context = target.getContext('2d')
    if (!context) {
      throw new Error('RuntimeHost cannot create a 2D canvas context for capture.')
    }
    const sourceX = Math.round(rect.x * this.dpr)
    const sourceY = Math.round(rect.y * this.dpr)
    const sourceWidth = Math.round(rect.width * this.dpr)
    const sourceHeight = Math.round(rect.height * this.dpr)
    context.drawImage(
      this.canvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      target.width,
      target.height,
    )
    return target
  }

  private _notifySizeDependents(size: RuntimeSize): void {
    for (const target of this._sizeDependents) this._notifySizeDependent(target, size)
  }

  private _notifySizeDependent(target: RuntimeSizeTarget, size: RuntimeSize): void {
    if (typeof target === 'function') {
      target(size)
      return
    }
    target.updateCanvas(size.width, size.height, size)
  }

  private _ensureMainLayer(): void {
    if (this._mainLayerRemove) return
    this._mainLayerRemove = this._disposables.add(this.registerLayer({
      layer: 'main',
      paint: ({ context }) => {
        this.paintRoots(context, root => root instanceof RenderWindow && this._windowRoots.has(root))
      },
      shouldPaint: () =>
        this.isLayerDirty('main') ||
        this.hasDirtyPaintForRoots(this._windowRoots),
      dirtyRect: () => this.getDirtyPaintRectForRoots(this._windowRoots),
    }))
  }

  private _ensurePerformanceOverlayLayer(): void {
    if (this._performanceLayerRemove) return
    this._performanceLayerRemove = this._disposables.add(this.registerLayerPainter({
      layer: 'performance-overlay',
      paint: ({ context }) => {
        context.setTheme?.(this.pipelineOwner.theme)
        this.performanceMonitor.paint(context, this._contentViewport())
      },
      shouldPaint: () =>
        this.performanceMonitor.visible &&
        this.isLayerDirty('performance-overlay'),
    }))
  }

  private _configureMainWindow(window: RenderWindow): void {
    const target = window as unknown as { _autoResizeInset?: number }
    if (target._autoResizeInset !== undefined) return
    target._autoResizeInset = 0
    window.windowX = 0
    window.windowY = 0
    window.offset = { x: 0, y: 0 }
  }

  private _mountWindow(window: RenderWindow): void {
    if (this._mountedWindows.has(window)) return

    this._mountedWindows.add(window)
    this._windowRoots.add(window)
    this.addRoot(window)

    const closeBinding = window === this._mainWindow
      ? this._bindMainWindowClose(window)
      : this._bindOwnedWindowClose(window)
    this._windowCloseBindings.set(window, closeBinding)
    this._windowDisposeBindings.set(window, window.manage(() => {
      if (this._disposed) return
      this._unmountWindow(window)
      if (window === this._mainWindow) {
        this._onMainWindowClose?.()
      }
    }))

    this._ownedWindowSubscriptions.set(window, window.onOwnedWindowsChanged(({ added, removed }) => {
      for (const ownedWindow of removed) {
        this._unmountWindow(ownedWindow)
      }
      for (const ownedWindow of added) {
        this._mountWindow(ownedWindow)
      }
    }))

    for (const ownedWindow of window.getOwnedWindows()) {
      this._mountWindow(ownedWindow)
    }
  }

  private _unmountWindow(window: RenderWindow, dispose = false): void {
    if (!this._mountedWindows.has(window)) return

    const wasDocked = this._dockedWindows.delete(window)
    this._dockedWindowCleanup.get(window)?.()
    this._dockedWindowCleanup.delete(window)

    this._ownedWindowSubscriptions.get(window)?.()
    this._ownedWindowSubscriptions.delete(window)

    this._windowCloseBindings.get(window)?.()
    this._windowCloseBindings.delete(window)

    this._windowDisposeBindings.get(window)?.()
    this._windowDisposeBindings.delete(window)

    for (const ownedWindow of [...window.getOwnedWindows()]) {
      this._unmountWindow(ownedWindow, dispose)
    }

    this._mountedWindows.delete(window)
    this._windowRoots.delete(window)

    if (this.getRoots().includes(window)) {
      this.removeRoot(window)
    }

    if (wasDocked && !this._disposed) {
      this._handleDockWindowRemoved('unmount-docked-window')
    }

    if (dispose) {
      window.ownerWindow?.removeOwnedWindow(window)
      window.dispose()
    }
  }

  private _bindMainWindowClose(window: RenderWindow): () => void {
    const previousOnClose = window.onCloseHandler
    const wrappedOnClose = (): void => {
      try {
        previousOnClose?.()
      } finally {
        this._onMainWindowClose?.()
      }
    }
    window.setOnClose(wrappedOnClose)
    return () => {
      if (window.onCloseHandler === wrappedOnClose) {
        window.setOnClose(previousOnClose)
      }
    }
  }

  private _bindOwnedWindowClose(window: RenderWindow): () => void {
    const previousOnClose = window.onCloseHandler
    const wrappedOnClose = (): void => {
      try {
        previousOnClose?.()
      } finally {
        window.ownerWindow?.removeOwnedWindow(window)
        window.dispose()
      }
    }
    window.setOnClose(wrappedOnClose)
    return () => {
      if (window.onCloseHandler === wrappedOnClose) {
        window.setOnClose(previousOnClose)
      }
    }
  }

  private _syncMainWindowTheme(): void {
    if (this._themeSource !== 'main-window') return
    const theme = this._mainWindow?.resolveWindowTheme()
    if (!theme) return
    this._applyTheme(theme, 'sync-main-window-theme', false)
  }

  private _applyTheme(theme: ResolvedTheme, reason: string, schedule = true): void {
    const updateKind = this.pipelineOwner.updateTheme(theme)
    if (updateKind === 'none') return
    const invalidateRoots = (): void => {
      for (const root of this.getRoots()) {
        if (updateKind === 'layout') root.markNeedsLayout()
        else root.markNeedsPaint()
      }
    }
    if (schedule) {
      invalidateRoots()
    } else {
      const previous = this._suppressPipelineScheduling
      this._suppressPipelineScheduling = true
      try {
        OverlayInvalidator.instance.suppressPaint(invalidateRoots)
      } finally {
        this._suppressPipelineScheduling = previous
      }
    }
    this.markAllLayersDirty()
    if (!schedule) return
    if (updateKind === 'layout') this.scheduleLayout(reason)
    else this.scheduleFrame(reason)
  }

  private _syncWindowConstraints(): void {
    for (const root of this.getRoots()) {
      if (!(root instanceof RenderWindow)) continue
      const viewport = this._viewportForWindow(root)
      this._syncRootWindowGeometry(root, viewport)
      const constraints = looseConstraints(viewport.width, viewport.height)
      const previous = this.pipelineOwner.getLastLayoutConstraints(root)
      if (previous && sameConstraints(previous, constraints)) continue
      this.pipelineOwner.recordLayoutConstraints(root, constraints)
      root.markNeedsLayout()
    }
  }

  private _attachWindow(root: RenderWindow): void {
    FocusManager.instance.register(root)
  }

  private _detachWindow(root: RenderWindow): void {
    this.canvas.style.cursor = 'default'
    root.focusOut()
    FocusManager.instance.unregister(root)
  }

  private _windowOwnsFocus(window: RenderWindow): boolean {
    const current = FocusManager.instance.current
    if (!current) return false
    if (current === window) return true
    if (!(current instanceof RenderObject)) return false

    for (let node: RenderObject | undefined = current; node; node = node.parent) {
      if (node === window) return true
    }
    return false
  }

  private _restoreWindowFocus(): void {
    const remaining = this.getRoots()
    for (let i = remaining.length - 1; i >= 0; i--) {
      const window = remaining[i]
      if (window instanceof RenderWindow) {
        FocusManager.instance.setFocus(window)
        return
      }
    }
    FocusManager.instance.clearFocus()
  }

  private _promoteWindowOwnershipPath(window: RenderWindow): void {
    for (let current: RenderWindow | undefined = window; current?.ownerWindow; current = current.ownerWindow) {
      current.ownerWindow.bringOwnedWindowToFront(current)
    }
  }

  private _moveWindowBranchToFront(branchWindows: readonly RenderWindow[]): void {
    if (branchWindows.length === 0) return
    const branchSet = new Set<RenderObject>(branchWindows)
    const roots = this.dispatcher.getRoots()
    const nextRoots = roots.filter(root => !branchSet.has(root))
    this.dispatcher.setRootOrder([...nextRoots, ...branchWindows])
  }

  private _windowBranchRoot(window: RenderWindow): RenderWindow {
    let root = window
    while (root.ownerWindow) root = root.ownerWindow
    return root
  }

  private _orderedMountedBranch(window: RenderWindow): RenderWindow[] {
    const ordered: RenderWindow[] = []
    const visit = (current: RenderWindow): void => {
      if (this._mountedWindows.has(current)) ordered.push(current)
      for (const ownedWindow of current.getOwnedWindows()) {
        visit(ownedWindow)
      }
    }
    visit(window)
    return ordered
  }

  private _paintPopupLayer(context: PaintContext, layer: string): void {
    context.setTheme?.(this.pipelineOwner.theme)
    for (const popup of PopupManager.instance.stack) {
      if (!isPaintablePopup(popup)) continue
      if (getPopupLayer(popup) !== layer) continue
      PopupManager.instance.withContextFor(popup, () => popup.paint(context))
    }
  }

  private _createPopupContext(
    explicitAnchorRoot?: RenderObject,
    anchorMode: PopupAnchorMode = 'stable',
  ): PopupContext {
    const pointerAnchorRoot = this.dispatcher.getPopupAnchorRoot()
    const focusAnchorRoot = FocusManager.instance.activeRoot
    const storedAnchorRoot = PopupManager.instance.activeAnchorRoot
    const anchorRoot = this._mountedPopupRoot(explicitAnchorRoot) ??
      (anchorMode === 'dynamic'
        ? this._mountedPopupRoot(pointerAnchorRoot) ??
          this._mountedPopupRoot(focusAnchorRoot) ??
          this._mainWindow
        : PopupManager.instance.hasOpen
        ? this._mountedPopupRoot(storedAnchorRoot) ?? this._preferredPopupAnchorRoot()
        : this._mountedPopupRoot(focusAnchorRoot) ?? this._mountedPopupRoot(pointerAnchorRoot) ?? this._mainWindow)
    const viewport = anchorRoot instanceof RenderWindow
      ? this._popupViewportForWindow(anchorRoot)
      : this._contentViewport()
    return {
      theme: this.pipelineOwner.theme,
      viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height, dpr: this.dpr },
      setCursor: cursor => {
        this.canvas.style.cursor = cursor || 'default'
      },
    }
  }

  private _preferredPopupAnchorRoot(): RenderObject | null {
    return this._mountedPopupRoot(FocusManager.instance.activeRoot) ??
      this._mountedPopupRoot(this.dispatcher.getPopupAnchorRoot()) ??
      this._mainWindow ??
      null
  }

  private _mountedPopupRoot(root: RenderObject | null | undefined): RenderObject | null {
    return root && this.dispatcher.getRoots().includes(root) ? root : null
  }

  private _contentViewport(): Rect {
    const left = this._dockExtent('left')
    const right = this._dockExtent('right')
    const bottom = this._dockExtent('bottom')
    return {
      x: left,
      y: 0,
      width: Math.max(0, this.canvasWidth - left - right),
      height: Math.max(0, this.canvasHeight - bottom),
    }
  }

  private _canvasViewport(): Rect {
    return {
      x: 0,
      y: 0,
      width: this.canvasWidth,
      height: this.canvasHeight,
    }
  }

  private _shouldBlockForModalWindow(position: Offset): boolean {
    const topModal = this.activeModalWindow
    if (!topModal) return false
    if (!this.getRoots().includes(topModal)) return false
    return !topModal.hitTest(position)
  }

  private _notifyModalWindowBlockedInteraction(): boolean {
    const topModal = this.activeModalWindow
    if (!topModal) return false
    this._moveModalWindowsToFront()
    FocusManager.instance.setFocus(topModal)
    topModal.requestAttentionFlash()
    this.markAllLayersDirty()
    this.scheduleFrame('modal-window-attention')
    return true
  }

  private _moveModalWindowsToFront(): void {
    if (this._modalWindows.length === 0) return
    const roots = this.dispatcher.getRoots()
    const modalSet = new Set<RenderWindow>(this._modalWindows)
    const mountedModalWindows = this._modalWindows.filter(window => roots.includes(window))
    if (mountedModalWindows.length === 0) return
    this.dispatcher.setRootOrder([
      ...roots.filter(root => !(root instanceof RenderWindow && modalSet.has(root))),
      ...mountedModalWindows,
    ])
  }

  private _dockExtent(side: RuntimeDockSide): number {
    let extent = 0
    for (const record of this._dockedWindows.values()) {
      if (record.side !== side) continue
      const viewportSize = side === 'bottom' ? this.canvasHeight : this.canvasWidth
      const reservedContent = side === 'bottom' ? MIN_CONTENT_VIEWPORT_HEIGHT : MIN_CONTENT_VIEWPORT_WIDTH
      const maxByViewport = Math.max(0, viewportSize - reservedContent)
      const requestedMax = record.maxSize ?? maxByViewport
      const maxSize = Math.max(0, Math.min(maxByViewport, requestedMax))
      const minSize = Math.max(0, Math.min(record.minSize ?? 0, maxSize))
      const size = Math.min(maxSize, Math.max(minSize, record.size))
      extent = Math.max(extent, size)
    }
    return extent
  }

  private _dockedWindowsOnSide(side: RuntimeDockSide): RenderWindow[] {
    return [...this._dockedWindows.entries()]
      .filter(([, record]) => record.side === side)
      .map(([window]) => window)
  }

  private _handleDockWindowRemoved(reason: string): void {
    this._syncWindowConstraints()
    this.markAllLayersDirty()
    this.scheduleLayout(reason)
  }

  private _floatDockWindow(window: RenderWindow): void {
    if (!this._dockedWindows.has(window)) return
    this._dockedWindows.delete(window)
    this._dockedWindowCleanup.get(window)?.()
    this._dockedWindowCleanup.delete(window)
    if (!window.disposed) {
      window.setPresentation('floating')
      window.setHostDockHandlers(undefined)
      window.setWindowBounds({ width: window.windowWidth, height: window.windowHeight })
    }
    this._syncWindowConstraints()
    this.markAllLayersDirty()
    this.scheduleLayout('float-dock-window')
  }

  private _viewportForWindow(window: RenderWindow): Rect {
    const dock = this._dockedWindows.get(window)
    if (!dock) return this._contentViewport()
    const content = this._contentViewport()
    const sideWindows = this._dockedWindowsOnSide(dock.side)
    const index = Math.max(0, sideWindows.indexOf(window))
    const count = Math.max(1, sideWindows.length)
    if (dock.side === 'left') {
      const segmentH = content.height / count
      return {
        x: 0,
        y: segmentH * index,
        width: content.x,
        height: index === count - 1 ? content.height - segmentH * index : segmentH,
      }
    }
    if (dock.side === 'right') {
      const segmentH = content.height / count
      return {
        x: content.x + content.width,
        y: segmentH * index,
        width: Math.max(0, this.canvasWidth - content.x - content.width),
        height: index === count - 1 ? content.height - segmentH * index : segmentH,
      }
    }
    const segmentW = content.width / count
    return {
      x: content.x + segmentW * index,
      y: content.height,
      width: index === count - 1 ? content.width - segmentW * index : segmentW,
      height: Math.max(0, this.canvasHeight - content.height),
    }
  }

  private _popupViewportForWindow(window: RenderWindow): Rect {
    if (window === this._mainWindow || this._dockedWindows.has(window)) {
      return this._viewportForWindow(window)
    }
    const content = this._contentViewport()
    const x = Math.max(content.x, window.windowX)
    const y = Math.max(content.y, window.windowY)
    const right = Math.min(content.x + content.width, window.windowX + window.windowWidth)
    const bottom = Math.min(content.y + content.height, window.windowY + window.windowHeight)
    return {
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y),
    }
  }

  private _normalizeDockRecord(record: RuntimeDockWindowRecord): RuntimeDockWindowRecord {
    const viewportSize = record.side === 'bottom' ? this.canvasHeight : this.canvasWidth
    const reservedContent = record.side === 'bottom' ? MIN_CONTENT_VIEWPORT_HEIGHT : MIN_CONTENT_VIEWPORT_WIDTH
    const maxByViewport = Math.max(0, viewportSize - reservedContent)
    const requestedMax = record.maxSize ?? maxByViewport
    const maxSize = Math.max(0, Math.min(maxByViewport, requestedMax))
    const minSize = Math.max(0, Math.min(record.minSize ?? 0, maxSize))
    return {
      ...record,
      size: Math.min(maxSize, Math.max(minSize, record.size)),
    }
  }

  private _syncRootWindowGeometry(window: RenderWindow, viewport: Rect): void {
    if (window !== this._mainWindow && !this._dockedWindows.has(window)) return
    const changed = window.windowX !== viewport.x ||
      window.windowY !== viewport.y ||
      window.windowWidth !== viewport.width ||
      window.windowHeight !== viewport.height ||
      window.offset.x !== viewport.x ||
      window.offset.y !== viewport.y
    if (!changed) return
    window.setHostManagedBounds(viewport)
  }

  private _resizeCanvasElement(): RuntimeSize {
    const { width, height } = this._getViewportSize()
    this._logicalCanvasWidth = width
    this._logicalCanvasHeight = height
    this.canvas.width = Math.max(1, Math.round(width * this.dpr))
    this.canvas.height = Math.max(1, Math.round(height * this.dpr))
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    return { width, height, dpr: this.dpr }
  }
}

function snapshotLayoutInspectorState(state: ReturnType<LayoutInspectorService['debugState']>): RuntimeDiagnosticsLayoutInspectorSnapshot {
  return {
    enabled: state.enabled,
    overlayVisible: state.overlayVisible,
    hoverPathLength: state.hoverPathLength,
    selectedPathLength: state.selectedPathLength,
    selectedPathIndex: state.selectedPathIndex,
    hoverPathInfo: state.hoverPathInfo.map(cloneRenderDebugInfo),
    selectedPathInfo: state.selectedPathInfo.map(cloneRenderDebugInfo),
    hover: state.hover ? cloneRenderDebugInfo(state.hover) : undefined,
    selected: state.selected ? cloneRenderDebugInfo(state.selected) : undefined,
    selectedAppContext: state.selectedAppContext?.map(entry => ({
      key: entry.key,
      source: entry.source,
      value: sanitizePaintRequestDetail(Object.prototype.hasOwnProperty.call(entry, 'rawValue') ? entry.rawValue : entry.value),
    })),
    renderTree: state.renderTree ? snapshotInspectorTree(state.renderTree) : undefined,
  }
}

const diagnosticsRenderTreeMaxDepth = 10
const diagnosticsRenderTreeMaxChildren = 80

function snapshotInspectorTree(
  node: NonNullable<ReturnType<LayoutInspectorService['debugState']>['renderTree']>,
  depth = 0,
): RuntimeDiagnosticsRenderTreeNode {
  const childCount = node.children.length
  const children = depth >= diagnosticsRenderTreeMaxDepth
    ? []
    : node.children
      .slice(0, diagnosticsRenderTreeMaxChildren)
      .map(child => snapshotInspectorTree(child, depth + 1))
  const snapshot: RuntimeDiagnosticsRenderTreeNode = {
    info: cloneRenderDebugInfo(node.info),
    children,
  }
  if (depth >= diagnosticsRenderTreeMaxDepth && childCount > 0) {
    snapshot.truncated = childCount
  } else if (childCount > diagnosticsRenderTreeMaxChildren) {
    snapshot.truncated = childCount - diagnosticsRenderTreeMaxChildren
  }
  return snapshot
}

function snapshotRenderTree(root: RenderObject, depth = 0): RuntimeDiagnosticsRenderTreeNode {
  const children: RenderObject[] = []
  let childCount = 0
  root.visitChildren(child => {
    childCount += 1
    if (children.length < diagnosticsRenderTreeMaxChildren) children.push(child)
  })
  const childSnapshots = depth >= diagnosticsRenderTreeMaxDepth
    ? []
    : children.map(child => snapshotRenderTree(child, depth + 1))
  const node: RuntimeDiagnosticsRenderTreeNode = {
    info: cloneRenderDebugInfo(root.debugInfo()),
    children: childSnapshots,
  }
  if (depth >= diagnosticsRenderTreeMaxDepth && childCount > 0) node.truncated = childCount
  else if (childCount > children.length) node.truncated = childCount - children.length
  return node
}

function snapshotWindow(window: RenderWindow, root: boolean, mounted: boolean): RuntimeDiagnosticsWindowSnapshot {
  const info = window.debugInfo()
  return {
    debugId: info.debugId,
    title: window.title,
    typeName: info.typeName,
    ownerDebugId: window.ownerWindow?.debugInfo().debugId,
    ownedWindowCount: window.getOwnedWindows().length,
    mounted,
    root,
    offset: { ...window.offset },
    size: { ...window.size },
  }
}

function snapshotAppContext(context: AppContextRegistry, source = 'root'): RuntimeDiagnosticsAppContextEntry[] {
  const entries: RuntimeDiagnosticsAppContextEntry[] = []
  for (const key of context.keys()) {
    entries.push({
      key: appContextKeyLabel(key),
      source,
      value: sanitizePaintRequestDetail(context.getOwn(key as never)),
    })
  }
  if (context.parent) entries.push(...snapshotAppContext(context.parent, 'parent'))
  return entries
}

function appContextKeyLabel(key: AppContextLookupKey): string {
  return typeof key === 'string' ? key : key.description
}

function aggregatePaintRequestHotspots(records: RuntimePaintRequestRecord[]): RuntimeDiagnosticsHotspot[] {
  const groups = new Map<string, RuntimeDiagnosticsHotspot>()
  for (const record of records) {
    const target = paintRequestTarget(record)
    const key = `${target}\n${record.kind}\n${record.source}\n${record.reason}`
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        target,
        kind: record.kind,
        source: record.source,
        reason: record.reason,
        count: 0,
        firstSeq: record.seq,
        lastSeq: record.seq,
        layoutTargets: [],
        paintTargets: [],
        transientPaintTargets: [],
      }
      groups.set(key, group)
    }
    group.count += 1
    group.firstSeq = Math.min(group.firstSeq, record.seq)
    group.lastSeq = Math.max(group.lastSeq, record.seq)
    group.layoutTargets = mergeUniqueStrings(group.layoutTargets, record.pipeline.layoutTargets)
    group.paintTargets = mergeUniqueStrings(group.paintTargets, record.pipeline.paintTargets)
    group.transientPaintTargets = mergeUniqueStrings(group.transientPaintTargets, record.pipeline.transientPaintTargets)
  }
  return [...groups.values()].sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count
    return right.lastSeq - left.lastSeq
  })
}

function paintRequestTarget(record: RuntimePaintRequestRecord): string {
  const detail = record.detail
  if (detail && typeof detail === 'object') {
    const target = (detail as { target?: unknown }).target
    if (typeof target === 'string') return target
  }
  return record.pipeline.layoutTargets[0] ??
    record.pipeline.paintTargets[0] ??
    record.pipeline.transientPaintTargets[0] ??
    '<unknown>'
}

function mergeUniqueStrings(left: string[], right: string[]): string[] {
  if (right.length === 0) return left
  const values = new Set(left)
  for (const value of right) values.add(value)
  return [...values].sort()
}

function cloneRuntimePerformanceState(state: ReturnType<RuntimePerformanceMonitor['debugState']>): ReturnType<RuntimePerformanceMonitor['debugState']> {
  return {
    ...state,
    latest: state.latest ? { ...state.latest } : undefined,
    bounds: { ...state.bounds },
    headerRect: { ...state.headerRect },
    toggleButtonRect: { ...state.toggleButtonRect },
  }
}

function clonePipelineDebugState(state: ReturnType<PipelineOwner['debugPaintState']>): ReturnType<PipelineOwner['debugPaintState']> {
  return {
    layoutCount: state.layoutCount,
    paintCount: state.paintCount,
    transientPaintCount: state.transientPaintCount,
    layoutTargets: [...state.layoutTargets],
    paintTargets: [...state.paintTargets],
    transientPaintTargets: [...state.transientPaintTargets],
  }
}

function cloneRenderDebugInfo(info: RenderDebugInfo): RenderDebugInfo {
  return {
    ...info,
    offset: { ...info.offset },
    globalOffset: { ...info.globalOffset },
    size: { ...info.size },
    constraints: info.constraints ? { ...info.constraints } : undefined,
    state: sanitizePaintRequestDetail(info.state),
  }
}

function sameConstraints(a: BoxConstraints, b: BoxConstraints): boolean {
  return a.minWidth === b.minWidth &&
    a.maxWidth === b.maxWidth &&
    a.minHeight === b.minHeight &&
    a.maxHeight === b.maxHeight
}

function unionRect(a: DirtyRect, b: DirtyRect): DirtyRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}

function shouldDebugPaintRequests(): boolean {
  const globalFlag = (globalThis as { __DS_UI_DEBUG_PAINT_REQUESTS__?: unknown }).__DS_UI_DEBUG_PAINT_REQUESTS__
  if (globalFlag === true || globalFlag === '1' || globalFlag === 'true') return true
  if (typeof window === 'undefined') return false
  try {
    const value = window.localStorage?.getItem('ds-ui:debug-paint-requests')
    return value === '1' || value === 'true'
  } catch {
    return false
  }
}

function classifyPaintRequestSource(reason: string): RuntimePaintRequestSource {
  if (reason.startsWith('pipeline:')) return 'pipeline'
  if (reason === 'layout-inspector' || reason.startsWith('debug')) return 'debug'
  if (reason === 'popup-manager' || reason === 'performance-overlay' || reason === 'performance-overlay-visible') return 'overlay'
  if (reason === 'run-main-window' || reason === 'add-root' || reason === 'remove-root' || reason === 'activate-window') return 'window'
  return 'runtime'
}

function clonePaintRequestRecord(record: RuntimePaintRequestRecord): RuntimePaintRequestRecord {
  return {
    ...record,
    detail: sanitizePaintRequestDetail(record.detail),
    dirtyLayers: record.dirtyLayers.map(layer => ({
      ...layer,
      rect: layer.rect ? { ...layer.rect } : undefined,
    })),
    pipeline: {
      layoutCount: record.pipeline.layoutCount,
      paintCount: record.pipeline.paintCount,
      transientPaintCount: record.pipeline.transientPaintCount,
      layoutTargets: [...record.pipeline.layoutTargets],
      paintTargets: [...record.pipeline.paintTargets],
      transientPaintTargets: [...record.pipeline.transientPaintTargets],
    },
    stack: record.stack ? [...record.stack] : undefined,
  }
}

function sanitizePaintRequestDetail(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value
  const valueType = typeof value
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return value
  if (valueType === 'bigint') return value.toString()
  if (valueType === 'function') return '[Function]'
  if (valueType !== 'object') return String(value)

  const objectValue = value as object
  if (seen.has(objectValue)) return '[Circular]'
  seen.add(objectValue)

  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    if (depth >= 3) return `[Array(${value.length})]`
    return value.slice(0, 24).map(item => sanitizePaintRequestDetail(item, depth + 1, seen))
  }
  if (value instanceof Map) return `[Map(${value.size})]`
  if (value instanceof Set) return `[Set(${value.size})]`

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return `[${value.constructor?.name || 'Object'}]`
  }

  if (depth >= 3) return '[Object]'
  const result: Record<string, unknown> = {}
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 24)
  for (const [key, entryValue] of entries) {
    result[key] = sanitizePaintRequestDetail(entryValue, depth + 1, seen)
  }
  const keyCount = Object.keys(value as Record<string, unknown>).length
  if (keyCount > entries.length) result.__truncated__ = keyCount - entries.length
  return result
}

function paintRequestStack(): string[] {
  const stack = new Error().stack
  if (!stack) return []
  return stack
    .split('\n')
    .slice(3, 11)
    .map(line => line.trim())
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}
