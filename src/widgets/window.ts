// Window: ImGui 风格可拖拽浮动窗口
// 支持标题栏拖拽移动、边缘/角落拖拽 resize、鼠标 cursor 提示

import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import { FocusManager } from '../core/focus_manager'
import { DisposableBag } from '../core/disposable'
import { AnimationController } from '../animation/animation_controller'
import { Curves } from '../animation/curves'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset, Rect } from '../core/render_object'
import {
  APP_CONTEXT_PROVIDER,
  AppContextRegistry,
} from '../core/app_context'
import { ImGuiDarkTheme } from '../theme/default_theme'
import type { ResolvedTheme } from '../theme/theme'
import { RenderObject } from '../core/render_object'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import type { Focusable } from '../core/focus_manager'
import {
  deriveWindowChromeStyle,
  type WindowChromeStyleTokens,
  resolveBgColor,
  resolveTextColor,
} from '../theme/component_styles'
import {
  assertFiniteNumber,
  assertFiniteOptionalNumber,
  assertFiniteRectPatch,
} from '../core/finite_geometry'
import { reportFrameworkInternalError } from '../core/internal_error_reporter'

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | ''
type HostDockResizeEdge = 'n' | 'e' | 'w' | ''

const EDGE_SIZE = 6  // 边缘检测宽度（像素）
const MIN_WIDTH = 200
const MIN_HEIGHT = 120

const CURSOR_MAP: Record<ResizeEdge, string> = {
  n: 'n-resize', s: 's-resize', e: 'e-resize', w: 'w-resize',
  ne: 'ne-resize', nw: 'nw-resize', se: 'se-resize', sw: 'sw-resize',
  '': 'default',
}

export interface RenderWindowOwnedWindowsChange {
  added: RenderWindow[]
  removed: RenderWindow[]
}

export type RenderWindowOwnedWindowsListener = (change: RenderWindowOwnedWindowsChange) => void
export const renderWindowOwnedMutationInternal = Symbol('render-window-owned-mutation-internal')
export type RenderWindowPresentation = 'floating' | 'tabbed' | 'docked' | 'host-docked'
export type RenderWindowChrome = 'standard' | 'none'
export type RenderWindowHostDockSide = 'left' | 'right' | 'bottom' | 'float'
export type RenderWindowHeightSizing = 'fixed' | 'content'
export type RenderWindowBorderStyle = 'sizable' | 'fixed'
export type RenderWindowCloseSource = 'api' | 'button'

export interface RenderWindowDragHandlers {
  onDragStart?(window: RenderWindow, position: Offset): void
  onDragMove?(window: RenderWindow, position: Offset): void
  onDragEnd?(window: RenderWindow, position: Offset): void
  onDragCancel?(window: RenderWindow, position: Offset): void
}

export interface RenderWindowHostDockHandlers {
  onSideChange?(window: RenderWindow, side: RenderWindowHostDockSide): void
  onResizeStart?(window: RenderWindow, position: Offset): void
  onResizeMove?(window: RenderWindow, position: Offset): void
  onResizeEnd?(window: RenderWindow, position: Offset): void
  onResizeCancel?(window: RenderWindow, position: Offset): void
}

export interface RenderWindowOptions extends RenderBoxOptions {
  title: string
  x?: number
  y?: number
  heightSizing?: RenderWindowHeightSizing
  contentPadding?: number
  contentSpacing?: number
  autoResizeInset?: number
  chrome?: RenderWindowChrome
  draggable?: boolean
  borderStyle?: RenderWindowBorderStyle
  showCloseButton?: boolean
  showMaximizeButton?: boolean
  onClose?: () => void
}

function resolveRenderWindowBoxOptions(opts: RenderWindowOptions): RenderBoxOptions {
  assertFiniteOptionalNumber(opts.x, 'Window x')
  assertFiniteOptionalNumber(opts.y, 'Window y')
  assertFiniteOptionalNumber(opts.width, 'Window width')
  assertFiniteOptionalNumber(opts.height, 'Window height')
  assertFiniteOptionalNumber(opts.minWidth, 'Window minWidth')
  assertFiniteOptionalNumber(opts.maxWidth, 'Window maxWidth')
  assertFiniteOptionalNumber(opts.minHeight, 'Window minHeight')
  assertFiniteOptionalNumber(opts.maxHeight, 'Window maxHeight')
  assertFiniteOptionalNumber(opts.autoResizeInset, 'Window autoResizeInset')
  return {
    ...opts,
    width: Math.max(opts.minWidth ?? MIN_WIDTH, Math.min(opts.maxWidth ?? Infinity, opts.width ?? 320)),
    height: Math.max(opts.minHeight ?? MIN_HEIGHT, Math.min(opts.maxHeight ?? Infinity, opts.height ?? 240)),
    minWidth: opts.minWidth ?? MIN_WIDTH,
    maxWidth: opts.maxWidth,
    minHeight: opts.minHeight ?? MIN_HEIGHT,
    maxHeight: opts.maxHeight,
  }
}

export class RenderWindow extends RenderBox implements InteractiveRenderObject, Focusable {
  static override debugTypeName = 'RenderWindow'
  private static readonly _emptyAppContext = new AppContextRegistry()

  title: string
  children: RenderBox[] = []

  private _windowX = 50
  private _windowY = 50

  private _dragging = false
  private _resizing: ResizeEdge = ''
  private _hostDockResizing: HostDockResizeEdge = ''
  private _dragOffsetX = 0
  private _dragOffsetY = 0
  private _resizeStartX = 0
  private _resizeStartY = 0
  private _resizeStartW = 0
  private _resizeStartH = 0
  private _resizeStartWinX = 0
  private _resizeStartWinY = 0
  private _focused = false
  private _maximized = false
  private _savedX = 0
  private _savedY = 0
  private _savedW = 0
  private _savedH = 0
  private _titleHeight = deriveWindowChromeStyle(ImGuiDarkTheme).titleHeight
  private _contentPaddingOverride?: number
  private _contentSpacingOverride?: number
  private _autoResizeInset?: number
  private _heightSizing: RenderWindowHeightSizing
  private _viewportWidth = 0
  private _viewportHeight = 0
  private _releasePointerCapture?: () => void
  private _onClose?: () => void
  private readonly _managed = new DisposableBag()
  private readonly _ownedWindows: RenderWindow[] = []
  private readonly _ownedWindowListeners = new Set<RenderWindowOwnedWindowsListener>()
  private readonly _ownedWindowNotificationCollectors: RenderWindowOwnedWindowsChange[][] = []
  private _ownerWindow?: RenderWindow
  private _disposeState: 'active' | 'disposing' | 'disposed' = 'active'
  private _presentation: RenderWindowPresentation = 'floating'
  private readonly _chrome: RenderWindowChrome
  private readonly _draggable: boolean
  private _borderStyle: RenderWindowBorderStyle
  private _showCloseButton: boolean
  private _showMaximizeButton: boolean
  private _dialogResultHandler?: (result: boolean) => void
  private readonly _attentionFlash: AnimationController
  private _dockCloseHandler?: (window: RenderWindow, source: RenderWindowCloseSource) => void
  private _dockActivateHandler?: (window: RenderWindow) => void
  private _dockDragHandlers?: RenderWindowDragHandlers
  private _hostDockHandlers?: RenderWindowHostDockHandlers
  private _unhandledKeyDownHandler?: (target: Focusable, event: KeyboardEvent) => boolean
  private _hostDockSide: Exclude<RenderWindowHostDockSide, 'float'> = 'right'
  private _appContext?: AppContextRegistry
  private _disposeAppContextOnDispose = false

  get isFocused(): boolean { return this._focused }
  override get width(): number { return super.width ?? 320 }
  override set width(value: number) {
    assertFiniteNumber(value, 'Window width')
    super.width = this._clampWindowWidth(value)
  }
  override get height(): number { return super.height ?? 240 }
  override set height(value: number) {
    assertFiniteNumber(value, 'Window height')
    super.height = this._clampWindowHeight(value)
  }
  override get minWidth(): number { return super.minWidth ?? MIN_WIDTH }
  override set minWidth(value: number) {
    assertFiniteNumber(value, 'Window minWidth')
    super.minWidth = value
    super.width = this._clampWindowWidth(this.width)
  }
  override get maxWidth(): number | undefined { return super.maxWidth }
  override set maxWidth(value: number | undefined) {
    assertFiniteOptionalNumber(value, 'Window maxWidth')
    super.maxWidth = value
    super.width = this._clampWindowWidth(this.width)
  }
  override get minHeight(): number { return super.minHeight ?? MIN_HEIGHT }
  override set minHeight(value: number) {
    assertFiniteNumber(value, 'Window minHeight')
    super.minHeight = value
    super.height = this._clampWindowHeight(this.height)
  }
  override get maxHeight(): number | undefined { return super.maxHeight }
  override set maxHeight(value: number | undefined) {
    assertFiniteOptionalNumber(value, 'Window maxHeight')
    super.maxHeight = value
    super.height = this._clampWindowHeight(this.height)
  }
  get windowWidth(): number { return this.width }
  set windowWidth(value: number) { this.width = value }
  get windowHeight(): number { return this.height }
  set windowHeight(value: number) { this.height = value }
  get windowX(): number { return this._windowX }
  set windowX(value: number) { this._windowX = assertFiniteNumber(value, 'Window x') }
  get windowY(): number { return this._windowY }
  set windowY(value: number) { this._windowY = assertFiniteNumber(value, 'Window y') }
  get disposed(): boolean { return this._disposeState !== 'active' }
  get ownerWindow(): RenderWindow | undefined { return this._ownerWindow }
  get presentation(): RenderWindowPresentation { return this._presentation }
  get chrome(): RenderWindowChrome { return this._chrome }
  get draggable(): boolean { return this._draggable }
  get borderStyle(): RenderWindowBorderStyle { return this._borderStyle }
  get showCloseButton(): boolean { return this._showCloseButton }
  get showMaximizeButton(): boolean { return this._showMaximizeButton }
  get attentionFlashValue(): number { return this._attentionFlash.value }

  constructor(opts: RenderWindowOptions) {
    super(resolveRenderWindowBoxOptions(opts))
    this.title = opts.title
    this.windowX = opts.x ?? 50
    this.windowY = opts.y ?? 50
    this._heightSizing = opts.heightSizing ?? 'fixed'
    this._contentPaddingOverride = opts.contentPadding
    this._contentSpacingOverride = opts.contentSpacing
    this._autoResizeInset = opts.autoResizeInset
    this._chrome = opts.chrome ?? 'standard'
    const chromeDefaultsEnabled = this._chrome === 'standard'
    this._draggable = opts.draggable ?? chromeDefaultsEnabled
    this._borderStyle = opts.borderStyle ?? (chromeDefaultsEnabled ? 'sizable' : 'fixed')
    this._showCloseButton = opts.showCloseButton ?? chromeDefaultsEnabled
    this._showMaximizeButton = opts.showMaximizeButton ?? chromeDefaultsEnabled
    this._attentionFlash = new AnimationController({
      duration: 180,
      curve: Curves.easeOut,
      onTick: () => this.markNeedsPaint(),
    })
    if (this._autoResizeInset !== undefined) {
      this.windowX = this._autoResizeInset
      this.windowY = this._autoResizeInset
    }
    this._onClose = opts.onClose
    this.offset = { x: this.windowX, y: this.windowY }
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  protected override get appliesOwnBoxConstraints(): boolean {
    return false
  }

  override get paintBounds(): Rect {
    const bounds = super.paintBounds
    if (this._presentation !== 'floating' || !this._hasStandardChrome()) return bounds
    const style = deriveWindowChromeStyle(this.currentTheme)
    if (style.shadowBlur <= 0 || style.shadowColor.a <= 0) return bounds
    const spread = Math.ceil(style.shadowBlur * 2)
    const left = spread + Math.max(0, -style.shadowOffsetX)
    const top = spread + Math.max(0, -style.shadowOffsetY)
    const right = spread + Math.max(0, style.shadowOffsetX)
    const bottom = spread + Math.max(0, style.shadowOffsetY)
    return {
      x: bounds.x - left,
      y: bounds.y - top,
      width: bounds.width + left + right,
      height: bounds.height + top + bottom,
    }
  }

  get TITLE_HEIGHT(): number { return this._titleHeight }
  get onCloseHandler(): (() => void) | undefined { return this._onClose }
  get contentPadding(): number | undefined { return this._contentPaddingOverride }
  get contentSpacing(): number | undefined { return this._contentSpacingOverride }
  get heightSizing(): RenderWindowHeightSizing { return this._heightSizing }

  resolveWindowTheme(): ResolvedTheme | undefined {
    return undefined
  }

  setOnClose(handler?: () => void): void {
    this._onClose = handler
  }

  setShowCloseButton(show: boolean): void {
    if (this._showCloseButton === show) return
    this._showCloseButton = show
    this.markNeedsPaint()
  }

  setShowMaximizeButton(show: boolean): void {
    if (this._showMaximizeButton === show) return
    this._showMaximizeButton = show
    this.markNeedsPaint()
  }

  setBorderStyle(style: RenderWindowBorderStyle): void {
    if (this._borderStyle === style) return
    this._borderStyle = style
    if (style === 'fixed' && this._resizing) {
      this._resizing = ''
      this._releaseCapture()
      this._setCursor('')
    }
    this.markNeedsPaint()
  }

  setDialogResultHandler(handler?: (result: boolean) => void): void {
    this._dialogResultHandler = handler
  }

  closeWithResult(result: boolean): void {
    if (this.disposed) return
    if (this._dialogResultHandler) {
      this._dialogResultHandler(result)
      return
    }
    this.close()
  }

  requestAttentionFlash(): void {
    if (this.disposed) return
    this._attentionFlash.resetValue(1)
    this._attentionFlash.reverse()
    this.markNeedsPaint()
  }

  [APP_CONTEXT_PROVIDER](): AppContextRegistry {
    return this._appContext ?? RenderWindow._emptyAppContext
  }

  setAppContext(context?: AppContextRegistry, options: { disposeOnDispose?: boolean } = {}): void {
    const disposeOnDispose = options.disposeOnDispose ?? false
    if (this._appContext === context && this._disposeAppContextOnDispose === disposeOnDispose) return
    const previousContext = this._appContext
    const disposePrevious = this._disposeAppContextOnDispose
    this._appContext = context
    this._disposeAppContextOnDispose = disposeOnDispose
    if (previousContext && previousContext !== context && disposePrevious) previousContext.dispose()
  }

  setPresentation(presentation: RenderWindowPresentation): void {
    if (this._presentation === presentation) return
    this._presentation = presentation
    if (presentation !== 'floating') {
      this._dragging = false
      this._resizing = ''
      this._releaseCapture()
      this._setCursor('')
    }
    this.markNeedsLayout()
  }

  setDockCloseHandler(handler?: (window: RenderWindow, source: RenderWindowCloseSource) => void): void {
    this._dockCloseHandler = handler
  }

  setDockActivateHandler(handler?: (window: RenderWindow) => void): void {
    this._dockActivateHandler = handler
  }

  setDockDragHandlers(handlers?: RenderWindowDragHandlers): void {
    this._dockDragHandlers = handlers
  }

  setHostDockHandlers(handlers?: RenderWindowHostDockHandlers): void {
    this._hostDockHandlers = handlers
  }

  setUnhandledKeyDownHandler(handler?: (target: Focusable, event: KeyboardEvent) => boolean): void {
    this._unhandledKeyDownHandler = handler
  }

  handleUnhandledKeyDownFromDescendant(target: Focusable, event: KeyboardEvent): boolean {
    return this._unhandledKeyDownHandler?.(target, event) === true
  }

  onKeyDown(event: KeyboardEvent): boolean {
    return this._unhandledKeyDownHandler?.(this, event) === true
  }

  setHostDockSide(side: Exclude<RenderWindowHostDockSide, 'float'> = 'right'): void {
    if (this._hostDockSide === side) return
    this._hostDockSide = side
    this.markNeedsPaint()
  }

  setContentPadding(padding?: number): void {
    if (this._contentPaddingOverride === padding) return
    this._contentPaddingOverride = padding
    this.markNeedsLayout()
  }

  setContentSpacing(spacing?: number): void {
    if (this._contentSpacingOverride === spacing) return
    this._contentSpacingOverride = spacing
    this.markNeedsLayout()
  }

  setWindowBounds(bounds: Partial<Rect>): void {
    assertFiniteRectPatch(bounds, 'Window')
    const nextX = bounds.x ?? this.windowX
    const nextY = bounds.y ?? this.windowY
    const nextWidth = this._clampWindowWidth(bounds.width ?? this.windowWidth)
    const nextHeight = this._clampWindowHeight(bounds.height ?? this.windowHeight)
    const positionChanged = nextX !== this.windowX || nextY !== this.windowY
    const sizeChanged = nextWidth !== this.windowWidth || nextHeight !== this.windowHeight
    if (!positionChanged && !sizeChanged) return

    const previousPaintBounds = this.paintBounds
    this.windowX = nextX
    this.windowY = nextY
    this.windowWidth = nextWidth
    this.windowHeight = nextHeight
    this.offset = { x: nextX, y: nextY }

    if (sizeChanged) this.markNeedsLayout()
    else this.markNeedsPaintForGeometryChange(previousPaintBounds)
  }

  setHostManagedBounds(bounds: Rect): void {
    assertFiniteRectPatch(bounds, 'Window host bounds')
    const nextWidth = Math.max(0, bounds.width)
    const nextHeight = Math.max(0, bounds.height)
    const positionChanged = bounds.x !== this.windowX || bounds.y !== this.windowY
    const sizeChanged = nextWidth !== this.windowWidth || nextHeight !== this.windowHeight
    if (!positionChanged && !sizeChanged &&
      this.offset.x === bounds.x && this.offset.y === bounds.y) return

    const previousPaintBounds = this.paintBounds
    this.windowX = bounds.x
    this.windowY = bounds.y
    // A host viewport is the actual allocated geometry. Floating min/max bounds
    // must not leave windowWidth/windowHeight disagreeing with layout and hit testing.
    super.width = nextWidth
    super.height = nextHeight
    this.offset = { x: bounds.x, y: bounds.y }

    if (sizeChanged) this.markNeedsLayout()
    else this.markNeedsPaintForGeometryChange(previousPaintBounds)
  }

  setHeightSizing(sizing: RenderWindowHeightSizing): void {
    if (this._heightSizing === sizing) return
    this._heightSizing = sizing
    this.markNeedsLayout()
  }

  close(source: RenderWindowCloseSource = 'api'): void {
    if (this.disposed) return
    if (this._dockCloseHandler) {
      this._dockCloseHandler(this, source)
      return
    }
    if (this._onClose) {
      this._onClose()
      return
    }
    this.dispose()
  }

  manage(dispose: () => void): () => void {
    let active = true
    const remove = this._managed.add(() => {
      if (!active) return
      active = false
      dispose()
    })
    return () => {
      active = false
      remove()
    }
  }

  manageDisposable(disposable: { dispose(): void }): () => void {
    let active = true
    const remove = this._managed.addDisposable({
      dispose() {
        if (!active) return
        active = false
        disposable.dispose()
      },
    })
    return () => {
      active = false
      remove()
    }
  }

  getOwnedWindows(): readonly RenderWindow[] {
    return this._ownedWindows
  }

  bringOwnedWindowToFront(window: RenderWindow): void {
    const index = this._ownedWindows.indexOf(window)
    if (index < 0 || index === this._ownedWindows.length - 1) return
    this._ownedWindows.splice(index, 1)
    this._ownedWindows.push(window)
  }

  addOwnedWindow(window: RenderWindow): void {
    if (window === this) {
      throw new Error('RenderWindow cannot own itself.')
    }
    if (this._ownedWindows.includes(window)) return
    this._assertCanOwn(window)
    window._ownerWindow?.removeOwnedWindow(window)
    window._ownerWindow = this
    this._ownedWindows.push(window)
    this._emitOwnedWindowsChanged({ added: [window], removed: [] })
  }

  removeOwnedWindow(window: RenderWindow): void {
    const index = this._ownedWindows.indexOf(window)
    if (index < 0) return
    this._ownedWindows.splice(index, 1)
    if (window._ownerWindow === this) {
      window._ownerWindow = undefined
    }
    this._emitOwnedWindowsChanged({ added: [], removed: [window] })
  }

  setOwnedWindows(windows: readonly RenderWindow[]): void {
    const nextWindows: RenderWindow[] = []
    const seen = new Set<RenderWindow>()
    for (const window of windows) {
      if (window === this) {
        throw new Error('RenderWindow cannot own itself.')
      }
      if (seen.has(window)) continue
      seen.add(window)
      nextWindows.push(window)
    }

    if (
      nextWindows.length === this._ownedWindows.length &&
      nextWindows.every((window, index) => this._ownedWindows[index] === window)
    ) {
      return
    }

    for (const window of nextWindows) {
      this._assertCanOwn(window)
    }

    for (const window of [...this._ownedWindows]) {
      this.removeOwnedWindow(window)
    }

    for (const window of nextWindows) {
      this.addOwnedWindow(window)
    }
  }

  onOwnedWindowsChanged(listener: RenderWindowOwnedWindowsListener): () => void {
    this._ownedWindowListeners.add(listener)
    return () => {
      this._ownedWindowListeners.delete(listener)
    }
  }

  [renderWindowOwnedMutationInternal](action: () => void): () => void {
    const changes: RenderWindowOwnedWindowsChange[] = []
    this._ownedWindowNotificationCollectors.push(changes)
    try {
      action()
    } finally {
      this._ownedWindowNotificationCollectors.pop()
    }
    return () => {
      for (const change of changes) this._deliverOwnedWindowsChanged(change)
    }
  }

  addChild(child: RenderBox): void {
    child.parent = this
    if (this.owner && child.owner !== this.owner) child.attach(this.owner)
    this.children.push(child)
    this.markNeedsLayout()
  }

  setChildren(children: RenderBox[]): void {
    if (
      children.length === this.children.length &&
      children.every((child, index) => this.children[index] === child)
    ) {
      return
    }

    const nextChildren = new Set(children)
    for (const child of this.children) {
      if (!nextChildren.has(child)) {
        child.parent = undefined
        child.detach()
      }
    }

    for (const child of children) {
      child.parent = this
      if (this.owner && child.owner !== this.owner) child.attach(this.owner)
    }

    this.children = [...children]
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      for (const c of this.children) visitor(c)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    for (const c of this.children) visitor(c)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveWindowChromeStyle(context.theme)
    this._titleHeight = style.titleHeight
    this._viewportWidth = Number.isFinite(constraints.maxWidth) ? constraints.maxWidth : this.windowWidth
    this._viewportHeight = Number.isFinite(constraints.maxHeight) ? constraints.maxHeight : this.windowHeight
    if (this._presentation !== 'floating') {
      const width = constraints.maxWidth === Infinity ? this.windowWidth : constraints.maxWidth
      const height = constraints.maxHeight === Infinity ? this.windowHeight : constraints.maxHeight
      this.size = { width, height }

      const hasHostChrome = this._hasHostDockChrome()
      const contentPadding = this._contentPaddingOverride ?? (hasHostChrome ? style.contentPadding : 0)
      const contentSpacing = this._contentSpacingOverride ?? style.itemSpacing
      const contentW = Math.max(0, width - contentPadding * 2)
      const contentY = (hasHostChrome ? this.TITLE_HEIGHT : 0) + contentPadding
      const contentH = Math.max(0, height - contentY - contentPadding)
      this._layoutContentChildren(contentPadding, contentY, contentW, contentH, contentSpacing, context)
      return
    }
    if (this._autoResizeInset !== undefined) {
      this._syncViewportSize(this._viewportWidth, this._viewportHeight)
    }
    this.offset = { x: this.windowX, y: this.windowY }

    const contentPadding = this._contentPaddingOverride ?? (this._hasStandardChrome() ? style.contentPadding : 0)
    const contentSpacing = this._contentSpacingOverride ?? style.itemSpacing
    const contentX = contentPadding
    const contentY = (this._hasStandardChrome() ? this.TITLE_HEIGHT : 0) + contentPadding
    const contentW = this.windowWidth - contentPadding * 2
    let height = this.windowHeight
    if (this._heightSizing === 'content') {
      const maxWindowHeight = this._maxFloatingWindowHeight()
      const maxMeasureContentH = Math.max(0, maxWindowHeight - contentY - contentPadding)
      const measuredContentH = this._layoutContentChildren(contentX, contentY, contentW, maxMeasureContentH, contentSpacing, context)
      height = Math.max(this.minHeight, Math.min(maxWindowHeight, contentY + measuredContentH + contentPadding))
      this.setHeightDuringLayout(height)
    }
    this.size = { width: this.windowWidth, height }

    const contentH = Math.max(0, height - contentY - contentPadding)
    this._layoutContentChildren(contentX, contentY, contentW, contentH, contentSpacing, context)
  }

  private _layoutContentChildren(
    contentX: number,
    contentY: number,
    contentW: number,
    contentH: number,
    contentSpacing: number,
    context: LayoutContext,
  ): number {
    let curY = 0
    const visibleChildren = this.children.filter(child => child.participatesInLayout)
    for (let i = 0; i < visibleChildren.length; i++) {
      const child = visibleChildren[i]!
      const remaining = Math.max(0, contentH - curY)
      const horizontalAlignment = child.resolveHorizontalAlignment('start')
      const childConstraints: BoxConstraints = {
        minWidth: horizontalAlignment === 'stretch' && child.width === undefined ? contentW : 0,
        maxWidth: contentW,
        minHeight: 0,
        maxHeight: remaining,
      }
      child.layout(childConstraints, true, context)
      child.positionInSlot({
        x: contentX,
        y: contentY + curY,
        width: contentW,
        height: child.outerSize.height,
      }, horizontalAlignment, child.resolveVerticalAlignment('start'))
      curY += child.outerSize.height
      if (i < visibleChildren.length - 1) curY += contentSpacing
    }
    return curY
  }

  private _maxFloatingWindowHeight(): number {
    const viewportMax = Number.isFinite(this._viewportHeight) ? this._viewportHeight : Infinity
    const configuredMax = this.maxHeight ?? Infinity
    return Math.max(this.minHeight, Math.min(viewportMax, configuredMax))
  }

  performPaint(context: PaintContext, offset: Offset): void {
    if (this._presentation !== 'floating') {
      if (this._hasHostDockChrome()) {
        this._paintHostDockedWindow(context, offset)
        return
      }
      this.paintContentChildren(context, offset)
      this.paintAdornerChildren(context, offset)
      return
    }
    const style = deriveWindowChromeStyle(context.theme)
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w, height: h } = this.size

    if (!this._hasStandardChrome()) {
      this.paintWindowSurface(context, {
        x,
        y,
        width: w,
        height: h,
      }, { ...style, borderRadius: 0, borderWidth: 0 })
      dl.pushClip(x, y, w, h)
      this.paintContentChildren(context, offset)
      this.paintAdornerChildren(context, offset)
      dl.popClip()
      return
    }

    dl.dropShadow(
      x,
      y,
      w,
      h,
      style.shadowBlur,
      style.shadowColor,
      style.borderRadius,
      style.shadowOffsetX,
      style.shadowOffsetY,
    )
    this.paintWindowSurface(context, {
      x,
      y,
      width: w,
      height: h,
    }, style)

    const titleBg = resolveBgColor(style.titleBg, this._focused ? 'focused' : 'normal')
    const ctx = context.ctx
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, y, w, this.TITLE_HEIGHT, [style.borderRadius, style.borderRadius, 0, 0])
    ctx.fillStyle = `rgba(${titleBg.r},${titleBg.g},${titleBg.b},${titleBg.a})`
    ctx.fill()
    ctx.restore()

    const titleText = resolveTextColor(style.titleText, this._focused ? 'focused' : 'normal')
    dl.fillText(this.title, x + w / 2, y + this.TITLE_HEIGHT / 2,
      titleText, style.fontSize, style.fontFamily, 'center', 'middle')
    dl.line(x, y + this.TITLE_HEIGHT, x + w, y + this.TITLE_HEIGHT, style.separator, 1)

    const closeRect = this._closeButtonRect(x, y, w)
    const maxRect = this._maxButtonRect(x, y, w)
    const controlColor = resolveTextColor(style.controlText, this._focused ? 'focused' : 'normal')
    if (closeRect) {
      const cx = closeRect.x + closeRect.width / 2
      const cy = closeRect.y + closeRect.height / 2
      const cr = closeRect.width * 0.35
      dl.line(cx - cr, cy - cr, cx + cr, cy + cr, controlColor, 1.5)
      dl.line(cx + cr, cy - cr, cx - cr, cy + cr, controlColor, 1.5)
    }
    if (maxRect) {
      if (this._maximized) {
        dl.strokeRect(maxRect.x + 3, maxRect.y, maxRect.width - 3, maxRect.height - 3, controlColor, 1, 1)
        dl.strokeRect(maxRect.x, maxRect.y + 3, maxRect.width - 3, maxRect.height - 3, controlColor, 1, 1)
      } else {
        dl.strokeRect(maxRect.x, maxRect.y, maxRect.width, maxRect.height, controlColor, 1, 1)
      }
    }

    if (style.borderWidth > 0) {
      dl.strokeRect(x, y, w, h, style.borderColor, style.borderWidth, style.borderRadius)
    }

    dl.pushClip(x + 1, y + this.TITLE_HEIGHT + 1, w - 2, h - this.TITLE_HEIGHT - 2)
    this.paintContentChildren(context, offset)
    this.paintAdornerChildren(context, offset)
    dl.popClip()

    // resize 角落指示（右下角三角点）需要画在内容之上，
    // 否则底部状态栏/内容容器会把它盖掉。
    if (this._canResize()) this._paintResizeGrip(dl, x, y, w, h)
    this._paintAttentionFlash(dl, x, y, w, h, style)
  }

  private _paintAttentionFlash(dl: DrawList, x: number, y: number, w: number, h: number, style: WindowChromeStyleTokens): void {
    const alpha = this._attentionFlash.value
    if (alpha <= 0) return
    const flash = { ...style.attentionFill, a: style.attentionFill.a * alpha }
    const titleFlash = { ...style.attentionTitleFill, a: style.attentionTitleFill.a * alpha }
    const border = { ...style.attentionBorder, a: style.attentionBorder.a * alpha }
    dl.fillRect(x, y, w, h, flash, style.borderRadius)
    if (this._hasStandardChrome()) {
      dl.fillRect(x, y, w, this.TITLE_HEIGHT, titleFlash, style.borderRadius)
    }
    dl.strokeRect(x, y, w, h, border, 2, style.borderRadius)
  }

  private _paintResizeGrip(dl: DrawList, x: number, y: number, w: number, h: number): void {
    const gripColor = resolveTextColor(deriveWindowChromeStyle(this.currentTheme).gripText, this._resizing ? 'pressed' : this._focused ? 'hovered' : 'normal')
    const s = 3
    const gap = 4
    const bx = x + w - EDGE_SIZE - 2
    const by = y + h - EDGE_SIZE - 2
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3 - i; j++) {
        dl.fillCircle(bx - i * gap, by - j * gap, s / 2, gripColor)
      }
    }
  }

  private _paintHostDockedWindow(context: PaintContext, offset: Offset): void {
    const style = deriveWindowChromeStyle(context.theme)
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w, height: h } = this.size

    this.paintWindowSurface(context, {
      x,
      y,
      width: w,
      height: h,
    }, { ...style, borderRadius: 0, shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 })

    const titleBg = resolveBgColor(style.titleBg, this._focused ? 'focused' : 'normal')
    dl.fillRect(x, y, w, this.TITLE_HEIGHT, titleBg, 0)
    const titleText = resolveTextColor(style.titleText, this._focused ? 'focused' : 'normal')
    const controlColor = resolveTextColor(style.controlText, this._focused ? 'focused' : 'normal')
    dl.fillText(this.title, x + 12, y + this.TITLE_HEIGHT / 2,
      titleText, style.fontSize, style.fontFamily, 'left', 'middle')
    dl.line(x, y + this.TITLE_HEIGHT, x + w, y + this.TITLE_HEIGHT, style.separator, 1)

    const controls = this._hostDockControlRects(x, y, w)
    this._paintHostDockControl(dl, controls.left, 'left', controlColor)
    this._paintHostDockControl(dl, controls.right, 'right', controlColor)
    this._paintHostDockControl(dl, controls.bottom, 'bottom', controlColor)
    this._paintHostDockControl(dl, controls.float, 'float', controlColor)
    if (controls.close) {
      const cx = controls.close.x + controls.close.width / 2
      const cy = controls.close.y + controls.close.height / 2
      const cr = controls.close.width * 0.35
      dl.line(cx - cr, cy - cr, cx + cr, cy + cr, controlColor, 1.5)
      dl.line(cx + cr, cy - cr, cx - cr, cy + cr, controlColor, 1.5)
    }

    if (style.borderWidth > 0) {
      dl.strokeRect(x, y, w, h, style.borderColor, style.borderWidth, 0)
    }

    const resizeEdge = this._hostDockResizeEdgeRect(x, y, w, h)
    if (resizeEdge) {
      dl.fillRect(resizeEdge.x, resizeEdge.y, resizeEdge.width, resizeEdge.height, { ...style.separator, a: Math.max(style.separator.a, 0.35) }, 0)
    }

    dl.pushClip(x + 1, y + this.TITLE_HEIGHT + 1, w - 2, h - this.TITLE_HEIGHT - 2)
    this.paintContentChildren(context, offset)
    this.paintAdornerChildren(context, offset)
    dl.popClip()
  }

  private _paintHostDockControl(
    dl: DrawList,
    rect: Rect | undefined,
    side: RenderWindowHostDockSide,
    color: { r: number, g: number, b: number, a: number },
  ): void {
    if (!rect) return
    const ix = rect.x + 3
    const iy = rect.y + 3
    const iw = Math.max(0, rect.width - 6)
    const ih = Math.max(0, rect.height - 6)
    dl.strokeRect(ix, iy, iw, ih, color, 1, 1)
    if (side === 'left') dl.fillRect(ix, iy, 4, ih, color, 0)
    else if (side === 'right') dl.fillRect(ix + iw - 4, iy, 4, ih, color, 0)
    else if (side === 'bottom') dl.fillRect(ix, iy + ih - 4, iw, 4, color, 0)
    else if (side === 'float') {
      dl.strokeRect(ix + 3, iy, iw - 3, ih - 3, color, 1, 1)
      dl.strokeRect(ix, iy + 3, iw - 3, ih - 3, color, 1, 1)
    }
  }

// ---- 边缘检测 ----

  private _edgeAt(p: Offset): ResizeEdge {
    const { windowX: wx, windowY: wy, windowWidth: ww, windowHeight: wh } = this
    const e = EDGE_SIZE
    const inX = p.x >= wx && p.x <= wx + ww
    const inY = p.y >= wy && p.y <= wy + wh
    if (!inX || !inY) return ''

    const onLeft   = p.x <= wx + e
    const onRight  = p.x >= wx + ww - e
    const onTop    = p.y <= wy + e
    const onBottom = p.y >= wy + wh - e

    if (onTop    && onLeft)  return 'nw'
    if (onTop    && onRight) return 'ne'
    if (onBottom && onLeft)  return 'sw'
    if (onBottom && onRight) return 'se'
    if (onTop)    return 'n'
    if (onBottom) return 's'
    if (onLeft)   return 'w'
    if (onRight)  return 'e'
    return ''
  }

  private _setCursor(edge: ResizeEdge): void {
    this.owner?.setCursor(CURSOR_MAP[edge] ?? 'default')
  }

  private _hasStandardChrome(): boolean {
    return this._presentation === 'floating' && this._chrome === 'standard'
  }

  private _hasHostDockChrome(): boolean {
    return this._presentation === 'host-docked' && this._chrome === 'standard'
  }

  private _canDrag(): boolean {
    return this._hasStandardChrome() && this._draggable
  }

  private _canResize(): boolean {
    return this._hasStandardChrome() && this._borderStyle === 'sizable'
  }

  private _inTitleBar(point: Offset): boolean {
    if (!this._hasStandardChrome()) return false
    return point.x >= this.windowX &&
           point.x <= this.windowX + this.windowWidth &&
           point.y >= this.windowY &&
           point.y <= this.windowY + this.TITLE_HEIGHT
  }

  private _closeButtonRect(x = this.windowX, y = this.windowY, width = this.windowWidth): Rect | undefined {
    if (!this._hasStandardChrome() || !this._showCloseButton) return undefined
    const btnSize = this.TITLE_HEIGHT * 0.6
    const btnMargin = (this.TITLE_HEIGHT - btnSize) / 2
    return {
      x: x + width - btnSize - btnMargin,
      y: y + btnMargin,
      width: btnSize,
      height: btnSize,
    }
  }

  private _hostDockControlRects(
    x = this.globalOffset.x,
    y = this.globalOffset.y,
    width = this.size.width,
  ): Record<RenderWindowHostDockSide | 'close', Rect | undefined> {
    if (!this._hasHostDockChrome()) {
      return { left: undefined, right: undefined, bottom: undefined, float: undefined, close: undefined }
    }
    const btnSize = this.TITLE_HEIGHT * 0.58
    const btnMargin = (this.TITLE_HEIGHT - btnSize) / 2
    const make = (slot: number): Rect => ({
      x: x + width - btnMargin - btnSize * slot - btnMargin * (slot - 1),
      y: y + btnMargin,
      width: btnSize,
      height: btnSize,
    })
    return {
      close: this._showCloseButton ? make(1) : undefined,
      float: make(this._showCloseButton ? 2 : 1),
      bottom: make(this._showCloseButton ? 3 : 2),
      right: make(this._showCloseButton ? 4 : 3),
      left: make(this._showCloseButton ? 5 : 4),
    }
  }

  private _hostDockResizeEdgeRect(
    x = this.globalOffset.x,
    y = this.globalOffset.y,
    width = this.size.width,
    height = this.size.height,
  ): Rect | undefined {
    if (!this._hasHostDockChrome()) return undefined
    if (this._hostDockSide === 'right') return { x, y, width: EDGE_SIZE, height }
    if (this._hostDockSide === 'left') return { x: x + width - EDGE_SIZE, y, width: EDGE_SIZE, height }
    return { x, y, width, height: EDGE_SIZE }
  }

  private _hostDockResizeEdgeAt(point: Offset): HostDockResizeEdge {
    if (!this._hasHostDockChrome()) return ''
    const rect = this._hostDockResizeEdgeRect()
    if (!this._pointInRect(point, rect)) return ''
    if (this._hostDockSide === 'right') return 'w'
    if (this._hostDockSide === 'left') return 'e'
    return 'n'
  }

  private _maxButtonRect(x = this.windowX, y = this.windowY, width = this.windowWidth): Rect | undefined {
    if (!this._hasStandardChrome() || !this._showMaximizeButton) return undefined
    const btnSize = this.TITLE_HEIGHT * 0.6
    const btnMargin = (this.TITLE_HEIGHT - btnSize) / 2
    const closeRect = this._closeButtonRect(x, y, width)
    const btnX = closeRect
      ? closeRect.x - btnSize - btnMargin
      : x + width - btnSize - btnMargin
    return {
      x: btnX,
      y: y + btnMargin,
      width: btnSize,
      height: btnSize,
    }
  }

  private _pointInRect(point: Offset, rect?: Rect): boolean {
    return !!rect &&
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
  }

  private _toggleMaximize(): void {
    let viewportWidth = this._viewportWidth
    let viewportHeight = this._viewportHeight
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      const constraints = this.owner?.getLastLayoutConstraints(this)
      if (constraints) {
        if (Number.isFinite(constraints.maxWidth)) viewportWidth = constraints.maxWidth
        if (Number.isFinite(constraints.maxHeight)) viewportHeight = constraints.maxHeight
      }
    }
    if (viewportWidth <= 0 || viewportHeight <= 0) return
    if (this._autoResizeInset === 0 && !this._maximized) return
    if (this._maximized) {
      this.windowX = this._savedX
      this.windowY = this._savedY
      this.windowWidth = this._savedW
      this.windowHeight = this._savedH
      this._maximized = false
    } else {
      this._savedX = this.windowX
      this._savedY = this.windowY
      this._savedW = this.windowWidth
      this._savedH = this.windowHeight
      this.windowX = 0
      this.windowY = 0
      this.windowWidth = viewportWidth
      this.windowHeight = viewportHeight
      this._maximized = true
    }
    this.markNeedsLayout()
  }

  focusIn(): void {
    this._focused = true
    this.markNeedsPaint()
    this._dockActivateHandler?.(this)
    this.owner?.activateWindow(this)
  }

  focusOut(): void {
    this._focused = false
    this.markNeedsPaint()
  }

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (!this.hitTest(e.position)) return
    this._dockActivateHandler?.(this)
    if (this._hasHostDockChrome()) {
      if (this._pointInRect(e.position, this._hostDockControlRects().close)) {
        FocusManager.instance.setFocus(this)
        this.close('button')
        return
      }
      const controls = this._hostDockControlRects()
      for (const side of ['left', 'right', 'bottom', 'float'] as const) {
        if (this._pointInRect(e.position, controls[side])) {
          FocusManager.instance.setFocus(this)
          this._hostDockHandlers?.onSideChange?.(this, side)
          return
        }
      }
      const edge = this._hostDockResizeEdgeAt(e.position)
      if (edge) {
        FocusManager.instance.setFocus(this)
        e.setPointerCapture?.()
        this._releasePointerCapture = e.releasePointerCapture
        this._hostDockResizing = edge
        this._hostDockHandlers?.onResizeStart?.(this, e.position)
        return
      }
      if (e.path && e.path.deepest?.target !== this) {
        this._activateFromDescendant()
        return
      }
      FocusManager.instance.setFocus(this)
      return
    }
    if (this._presentation !== 'floating') {
      if (e.path && e.path.deepest?.target !== this) {
        this._activateFromDescendant()
        return
      }
      FocusManager.instance.setFocus(this)
      return
    }
    // 关闭按钮优先
    if (this._pointInRect(e.position, this._closeButtonRect())) {
      FocusManager.instance.setFocus(this)
      this.close('button')
      return
    }

    // 最大化按钮
    if (this._pointInRect(e.position, this._maxButtonRect())) {
      FocusManager.instance.setFocus(this)
      this._toggleMaximize()
      return
    }

    // 最大化状态下禁止 resize；非最大化时边缘 resize 优先于内容命中。
    const edge = this._maximized || !this._canResize() ? '' : this._edgeAt(e.position)
    if (edge) {
      FocusManager.instance.setFocus(this)
      this._detachAutoResize()
      e.setPointerCapture?.()
      this._releasePointerCapture = e.releasePointerCapture
      this._resizing = edge
      this._resizeStartX = e.position.x
      this._resizeStartY = e.position.y
      this._resizeStartW = this.windowWidth
      this._resizeStartH = this.windowHeight
      this._resizeStartWinX = this.windowX
      this._resizeStartWinY = this.windowY
      return
    }

    if (e.path && e.path.deepest?.target !== this) {
      this._activateFromDescendant()
      return
    }

    FocusManager.instance.setFocus(this)

    // 最大化状态下禁止拖拽
    if (this._maximized) return

    if (this._canDrag() && this._inTitleBar(e.position)) {
      e.setPointerCapture?.()
      this._releasePointerCapture = e.releasePointerCapture
      this._dragging = true
      this._dragOffsetX = e.position.x - this.windowX
      this._dragOffsetY = e.position.y - this.windowY
      this._dockDragHandlers?.onDragStart?.(this, e.position)
    }
  }

  onPointerMove(e: PointerEvent): void {
    if (this._hostDockResizing) {
      this._hostDockHandlers?.onResizeMove?.(this, e.position)
      return
    }
    if (this._resizing) {
      const dx = e.position.x - this._resizeStartX
      const dy = e.position.y - this._resizeStartY
      const edge = this._resizing

      let newX = this._resizeStartWinX
      let newY = this._resizeStartWinY
      let newW = this._resizeStartW
      let newH = this._resizeStartH

      if (edge.includes('e')) newW = this._clampWindowWidth(this._resizeStartW + dx)
      if (edge.includes('s')) newH = this._clampWindowHeight(this._resizeStartH + dy)
      if (edge.includes('w')) {
        const w = this._clampWindowWidth(this._resizeStartW - dx)
        newX = this._resizeStartWinX + (this._resizeStartW - w)
        newW = w
      }
      if (edge.includes('n')) {
        const h = this._clampWindowHeight(this._resizeStartH - dy)
        newY = this._resizeStartWinY + (this._resizeStartH - h)
        newH = h
      }

      this.windowX = newX
      this.windowY = newY
      this.windowWidth = newW
      this.windowHeight = newH
      this.offset = { x: newX, y: newY }
      this.markNeedsLayout()
      return
    }

    if (this._dragging) {
      this.setWindowBounds({
        x: e.position.x - this._dragOffsetX,
        y: e.position.y - this._dragOffsetY,
      })
      this._dockDragHandlers?.onDragMove?.(this, e.position)
      return
    }

    // hover 时更新 cursor
    if (!this._maximized && this._canResize()) {
      const edge = this._edgeAt(e.position)
      this._setCursor(edge || (this._inTitleBar(e.position) ? '' : ''))
    } else if (this._hasHostDockChrome()) {
      this._setCursor(this._hostDockResizeEdgeAt(e.position) ? this._hostDockResizingCursor() : '')
    }
  }

  onPointerUp(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    const wasDragging = this._dragging
    const wasHostDockResizing = this._hostDockResizing !== ''
    this._dragging = false
    this._resizing = ''
    this._hostDockResizing = ''
    this._releaseCapture()
    this._setCursor('')
    if (wasDragging) this._dockDragHandlers?.onDragEnd?.(this, e.position)
    if (wasHostDockResizing) this._hostDockHandlers?.onResizeEnd?.(this, e.position)
  }

  onPointerCancel(e: PointerEvent): void {
    const wasDragging = this._dragging
    const wasHostDockResizing = this._hostDockResizing !== ''
    this._dragging = false
    this._resizing = ''
    this._hostDockResizing = ''
    this._releaseCapture()
    this._setCursor('')
    if (wasDragging) this._dockDragHandlers?.onDragCancel?.(this, e.position)
    if (wasHostDockResizing) this._hostDockHandlers?.onResizeCancel?.(this, e.position)
  }

  private _hostDockResizingCursor(): ResizeEdge {
    if (this._hostDockSide === 'bottom') return 'n'
    return this._hostDockSide === 'right' ? 'w' : 'e'
  }

  private _releaseCapture(): void {
    this._releasePointerCapture?.()
    this._releasePointerCapture = undefined
  }

  private _detachAutoResize(): void {
    if (this._autoResizeInset === undefined) return
    this._autoResizeInset = undefined
  }

  private _activateFromDescendant(): void {
    if (!this._focused) {
      this._focused = true
      this.markNeedsPaint()
    }
    this._dockActivateHandler?.(this)
    this.owner?.activateWindow(this)
  }

  private _syncViewportSize(width: number, height: number): void {
    const inset = this._autoResizeInset
    if (inset === undefined) return

    const nextX = this._maximized ? 0 : this.windowX
    const nextY = this._maximized ? 0 : this.windowY
    const nextWidth = this._clampWindowWidth(this._maximized ? width : width - inset * 2)
    const nextHeight = this._clampWindowHeight(this._maximized ? height : height - inset * 2)

    if (
      nextX === this.windowX &&
      nextY === this.windowY &&
      nextWidth === this.windowWidth &&
      nextHeight === this.windowHeight
    ) {
      return
    }

    this.windowX = nextX
    this.windowY = nextY
    this.setWidthDuringLayout(nextWidth)
    this.setHeightDuringLayout(nextHeight)
    this.offset = { x: nextX, y: nextY }
  }

  hitTest(point: Offset): boolean {
    if (this._presentation !== 'floating') return super.hitTest(point)
    return point.x >= this.windowX &&
           point.x <= this.windowX + this.windowWidth &&
           point.y >= this.windowY &&
           point.y <= this.windowY + this.windowHeight
  }

  protected paintWindowSurface(
    context: PaintContext,
    rect: Rect,
    style: WindowChromeStyleTokens,
  ): void {
    const dl = new DrawList(context)
    dl.fillRect(rect.x, rect.y, rect.width, rect.height, style.windowBg, style.borderRadius)
  }

  dispose(): void {
    if (this._disposeState !== 'active') return
    this._disposeState = 'disposing'
    const run = (scope: string, action: () => void): void => {
      try {
        action()
      } catch (error) {
        reportFrameworkInternalError(scope, error)
      }
    }
    try {
      run('window-owner-detach', () => this._ownerWindow?.removeOwnedWindow(this))
      run('window-pointer-release', () => this._releaseCapture())
      run('window-cursor-reset', () => this._setCursor(''))
      for (const window of [...this._ownedWindows]) {
        run('window-owned-detach', () => this.removeOwnedWindow(window))
        run('window-owned-dispose', () => window.dispose())
      }
      run('window-managed-dispose', () => this._managed.dispose())
      run('window-attention-dispose', () => this._attentionFlash.dispose())
      run('window-render-tree-dispose', () => super.dispose())
      if (this._disposeAppContextOnDispose) {
        run('window-app-context-dispose', () => this._appContext?.dispose())
      }
    } finally {
      for (const window of this._ownedWindows) {
        if (window._ownerWindow === this) window._ownerWindow = undefined
      }
      this._ownedWindows.length = 0
      this._appContext = undefined
      this._disposeAppContextOnDispose = false
      this.children = []
      this._ownerWindow = undefined
      this._dragging = false
      this._resizing = ''
      this._focused = false
      this._autoResizeInset = undefined
      this._onClose = undefined
      this._dialogResultHandler = undefined
      this._dockCloseHandler = undefined
      this._dockActivateHandler = undefined
      this._dockDragHandlers = undefined
      this._hostDockHandlers = undefined
      this._unhandledKeyDownHandler = undefined
      this._hostDockResizing = ''
      this._ownedWindowListeners.clear()
      this._ownedWindowNotificationCollectors.length = 0
      this._disposeState = 'disposed'
    }
  }

  private _assertCanOwn(window: RenderWindow): void {
    for (let current: RenderWindow | undefined = this; current; current = current._ownerWindow) {
      if (current === window) {
        throw new Error('RenderWindow ownership cannot contain cycles.')
      }
    }
  }

  private _emitOwnedWindowsChanged(change: RenderWindowOwnedWindowsChange): void {
    if (change.added.length === 0 && change.removed.length === 0) return
    const collector = this._ownedWindowNotificationCollectors.at(-1)
    if (collector) {
      collector.push({ added: [...change.added], removed: [...change.removed] })
      return
    }
    this._deliverOwnedWindowsChanged(change)
  }

  private _deliverOwnedWindowsChanged(change: RenderWindowOwnedWindowsChange): void {
    for (const listener of [...this._ownedWindowListeners]) {
      try {
        listener(change)
      } catch (error) {
        reportFrameworkInternalError('window-owned-listener', error)
      }
    }
  }

  private _clampWindowWidth(value: number): number {
    return Math.max(this.minWidth, Math.min(this.maxWidth ?? Infinity, value))
  }

  private _clampWindowHeight(value: number): number {
    return Math.max(this.minHeight, Math.min(this.maxHeight ?? Infinity, value))
  }
}
