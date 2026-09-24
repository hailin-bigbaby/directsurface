import {
  resolveAnchoredPopupRect,
  type AnchoredPopupOverflowPreference,
  type AnchoredPopupPlacement,
} from '../core/anchored_popup_layout'
import {
  FocusManager,
  type AuxiliaryFocusRootRegistration,
} from '../core/focus_manager'
import { KeyboardBindingController } from '../core/keyboard_binding_controller'
import {
  resolvePopupAnchorRect,
  resolvePopupAnchorTarget,
  type PopupAnchor,
  type PopupAnchorPlacement,
} from '../core/popup_anchor'
import {
  PopupManager,
  popupViewportRect,
  type PopupAnchorMode,
  type PopupContext,
} from '../core/popup_manager'
import { PopupRenderNode } from '../core/popup_render_surface'
import { PopupSurfaceShell } from '../core/popup_shell'
import {
  RenderObject,
  type BoxConstraints,
  type LayoutContext,
  type Offset,
  type Rect,
} from '../core/render_object'
import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { drawPopupPanel } from '../rendering/popup_painter'
import { derivePopupStyle } from '../theme/component_styles'
import { themeValueSignature } from '../theme/theme'

export interface HoverCardPopupOptions {
  anchor: PopupAnchor
  boundary?: PopupAnchor
  content: RenderBox
  owner?: object
  anchorRoot?: RenderObject
  anchorMode?: PopupAnchorMode
  placement?: AnchoredPopupPlacement
  fallbackPlacements?: readonly AnchoredPopupPlacement[]
  overflowPreference?: AnchoredPopupOverflowPreference
  gap?: number
  inset?: number
  minWidth?: number
  maxWidth?: number
  maxHeight?: number
  closeDelayMs?: number
  onDismiss?: () => void
}

export interface HoverCardPopupDebugState {
  disposed: boolean
  open: boolean
  anchorInside: boolean
  pointerInside: boolean
  focusInside: boolean
  closePending: boolean
  rect: Rect | null
  placement: AnchoredPopupPlacement | null
}

export interface HoverCardDisposeOptions {
  restoreFocus?: boolean
}

type HoverCardPopupState = 'closed' | 'open' | 'close-pending' | 'disposed'

interface NormalizedHoverCardPopupOptions {
  anchor: PopupAnchor
  boundary?: PopupAnchor
  owner?: object
  anchorRoot?: RenderObject
  anchorMode: PopupAnchorMode
  placement: AnchoredPopupPlacement
  fallbackPlacements?: readonly AnchoredPopupPlacement[]
  overflowPreference: AnchoredPopupOverflowPreference
  gap: number
  inset: number
  minWidth: number
  maxWidth: number
  maxHeight: number
  closeDelayMs: number
  onDismiss?: () => void
}

interface HoverCardLayout {
  rect: Rect
  placement: AnchoredPopupPlacement
  padding: number
  key: string
  validationKey: string
}

export class HoverCardPopup extends PopupSurfaceShell {
  readonly overlayLayer = 'tooltip'

  private readonly _surfaceRoot: PopupRenderNode
  private _content: RenderBox | null = null
  private _options: NormalizedHoverCardPopupOptions | null = null
  private _layout: HoverCardLayout | null = null
  private _paintedLayout: HoverCardLayout | null = null
  private _focusRegistration?: AuxiliaryFocusRootRegistration
  private _disposeEscapeBinding?: () => void
  private _state: HoverCardPopupState = 'closed'
  private _anchorInside = false
  private _pointerInside = false
  private _closeTimer?: ReturnType<typeof setTimeout>
  private _operationSeq = 0
  private _closeRestoreFocus = true
  private _disposed = false

  constructor() {
    super()
    this._surfaceRoot = new PopupRenderNode({
      layout: (node, constraints, context) => this._layoutSurface(node, constraints, context),
      paint: (_node, context, offset) => this._paintSurface(context, offset),
      visitChildren: (_node, visitor) => {
        if (this._content) visitor(this._content)
      },
      onPointerEnter: () => this._handlePointerEnter(),
      onPointerLeave: () => this._handlePointerLeave(),
      onPointerUp: () => this._handlePointerSequenceEnd(),
      onPointerCancel: () => this._handlePointerSequenceEnd(),
    })
    this.setPopupSurfaceRoot(this._surfaceRoot)
    this.setPopupSurfaceSync((root, popupContext) => this._syncSurface(root, popupContext))
  }

  show(options: HoverCardPopupOptions): void {
    if (this._disposed) return
    const normalized = normalizeHoverCardPopupOptions(options)
    const operation = ++this._operationSeq
    const sameEntry = this.visible &&
      this._options !== null &&
      this._options.owner === normalized.owner &&
      this._options.anchorRoot === normalized.anchorRoot &&
      this._options.anchorMode === normalized.anchorMode

    if (this.visible && !sameEntry) {
      this.close()
      if (this._disposed || operation !== this._operationSeq) return
    }

    this._cancelCloseTimer(false)
    this._replaceContent(options.content)
    this._options = normalized
    this._layout = null
    this._paintedLayout = null
    this._anchorInside = false

    if (!sameEntry || !this.visible) {
      this._state = 'open'
      this.resetPopupSurface()
      this._installEscapeBinding()
      this.openPopup({
        interactionMode: 'nonmodal',
        closeOnTransient: true,
        owner: normalized.owner,
        anchorRoot: normalized.anchorRoot,
        anchorMode: normalized.anchorMode,
      })
      this._focusRegistration = FocusManager.instance.registerAuxiliaryRoot(this._surfaceRoot, {
        order: PopupManager.instance.stack.indexOf(this),
      })
    } else {
      this._state = 'open'
      this._installEscapeBinding()
      this._focusRegistration?.updateOrder(PopupManager.instance.stack.indexOf(this))
      this.requestPopupPaint()
    }
  }

  setContent(content: RenderBox): void {
    if (this._disposed || this._content === content) return
    this._replaceContent(content)
    this._layout = null
    this._paintedLayout = null
    this.requestPopupPaint()
  }

  notifyAnchorEnter(): void {
    if (!this.visible || this._disposed) return
    this._anchorInside = true
    this.cancelScheduledDismiss()
  }

  notifyAnchorLeave(): void {
    if (!this.visible || this._disposed) return
    this._anchorInside = false
    this.scheduleDismiss()
  }

  scheduleDismiss(): void {
    if (!this.visible || this._disposed) return
    this._cancelCloseTimer(false)
    this._state = 'close-pending'
    const operation = this._operationSeq
    const delay = this._options?.closeDelayMs ?? 150
    this._closeTimer = setTimeout(() => {
      this._closeTimer = undefined
      if (
        this._disposed ||
        operation !== this._operationSeq ||
        !this.visible ||
        this._anchorInside ||
        this._pointerInside ||
        this._focusInside() ||
        this.popupSurfaceHasActivePointerInteraction
      ) {
        if (this.visible && !this._disposed) this._state = 'open'
        return
      }
      this.close()
    }, delay)
  }

  cancelScheduledDismiss(): void {
    if (!this.visible || this._disposed) return
    this._cancelCloseTimer(false)
    this._state = 'open'
  }

  ownsRenderObject(target: unknown): boolean {
    if (!(target instanceof RenderObject)) return false
    let current: RenderObject | undefined = target
    while (current) {
      if (current === this._surfaceRoot) return true
      current = current.parent
    }
    return false
  }

  debugState(): HoverCardPopupDebugState {
    const focusInside = this._focusInside()
    const currentValidationKey = this.visible && this._options
      ? this._validationKey(PopupManager.instance.contextFor(this))
      : null
    const painted = this._paintedLayout &&
      this._layout?.key === this._paintedLayout.key &&
      currentValidationKey === this._paintedLayout.validationKey
      ? this._paintedLayout
      : null
    return {
      disposed: this._disposed,
      open: this.visible,
      anchorInside: this._anchorInside,
      pointerInside: this._pointerInside,
      focusInside,
      closePending: this._state === 'close-pending',
      rect: painted ? { ...painted.rect } : null,
      placement: painted?.placement ?? null,
    }
  }

  override hitTest(point: Offset, popupContext: PopupContext): boolean {
    const hit = super.hitTest(point, popupContext)
    return this._layout !== null && hit
  }

  override close(): void {
    if (!this.visible) return
    this._closeRestoreFocus = true
    super.close()
  }

  disposePopup(options: HoverCardDisposeOptions = {}): void {
    if (this._disposed) return
    this._disposed = true
    this._state = 'disposed'
    this._operationSeq += 1
    this._cancelCloseTimer(false)
    this._uninstallEscapeBinding()
    this._closeRestoreFocus = options.restoreFocus ?? false
    try {
      if (this.visible) super.close()
      else this._disposeClosedResources(this._closeRestoreFocus)
    } finally {
      this.disposePopupSurface()
    }
  }

  protected override onPopupClose(): void {
    this._uninstallEscapeBinding()
    const restoreFocus = this._closeRestoreFocus
    this._closeRestoreFocus = true
    this._operationSeq += 1
    this._cancelCloseTimer(false)
    this._state = this._disposed ? 'disposed' : 'closed'
    this._anchorInside = false
    this._pointerInside = false
    this._layout = null
    this._paintedLayout = null
    const onDismiss = this._options?.onDismiss
    this._options = null
    let firstError: unknown
    try {
      super.onPopupClose()
    } catch (error) {
      firstError = error
    }
    try {
      this._disposeClosedResources(restoreFocus)
    } catch (error) {
      firstError ??= error
    }
    if (onDismiss) {
      try {
        onDismiss()
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError !== undefined) throw firstError
  }

  private _handlePointerEnter(): void {
    if (!this.visible || this._disposed) return
    this._pointerInside = true
    this.cancelScheduledDismiss()
  }

  private _handlePointerLeave(): void {
    if (!this.visible || this._disposed) return
    this._pointerInside = false
    this.scheduleDismiss()
  }

  private _handlePointerSequenceEnd(): void {
    if (!this.visible || this._disposed) return
    if (!this._anchorInside && !this._pointerInside && !this._focusInside()) {
      this.scheduleDismiss()
    }
  }

  private _focusInside(): boolean {
    return this.ownsRenderObject(FocusManager.instance.current)
  }

  private _installEscapeBinding(): void {
    if (this._disposeEscapeBinding) return
    this._disposeEscapeBinding = KeyboardBindingController.instance.addBinding(
      event => this._handleEscapeBinding(event),
      1100,
      { source: () => this._keyboardBindingSource() },
    )
  }

  private _uninstallEscapeBinding(): void {
    const dispose = this._disposeEscapeBinding
    this._disposeEscapeBinding = undefined
    dispose?.()
  }

  private _keyboardBindingSource(): RenderObject | undefined {
    const options = this._options
    if (!options) return this._surfaceRoot
    if (options.anchorRoot) return options.anchorRoot
    if (options.owner instanceof RenderObject) return options.owner
    return this._surfaceRoot
  }

  private _handleEscapeBinding(event: KeyboardEvent): boolean {
    if (event.key !== 'Escape' || !this.visible || this._disposed) return false
    const manager = PopupManager.instance
    const stack = manager.stack
    const selfIndex = stack.lastIndexOf(this)
    if (selfIndex < 0) return false

    let topHoverCardIndex = -1
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index] instanceof HoverCardPopup) {
        topHoverCardIndex = index
        break
      }
    }
    if (selfIndex !== topHoverCardIndex) return false

    const current = manager.current
    if (current && stack.lastIndexOf(current) > selfIndex) return false

    event.preventDefault()
    event.stopImmediatePropagation()
    this.close()
    return true
  }

  private _cancelCloseTimer(invalidate: boolean): void {
    if (this._closeTimer !== undefined) {
      clearTimeout(this._closeTimer)
      this._closeTimer = undefined
    }
    if (invalidate) this._operationSeq += 1
  }

  private _replaceContent(content: RenderBox): void {
    if (this._content === content) return
    const previous = this._content
    if (previous) previous.parent = undefined
    this._content = content
    content.parent = this._surfaceRoot
    previous?.dispose()
  }

  private _disposeClosedResources(restoreFocus: boolean): void {
    const registration = this._focusRegistration
    this._focusRegistration = undefined
    registration?.dispose({ restoreFocus })
    const content = this._content
    this._content = null
    if (content) {
      content.parent = undefined
      content.dispose()
    }
  }

  private _syncSurface(root: RenderObject, popupContext: PopupContext): void {
    if (
      this._layout &&
      this._content &&
      this._layout.validationKey === this._validationKey(popupContext) &&
      !root.needsLayout &&
      !this._content.needsLayout
    ) return
    const layout = this._resolveLayout(popupContext)
    if (layout?.key !== this._layout?.key) this._paintedLayout = null
    this._layout = layout
    if (!layout) {
      root.offset = { x: -1, y: -1 }
      root.layout({ minWidth: 0, maxWidth: 0, minHeight: 0, maxHeight: 0 }, false, {
        theme: popupContext.theme,
      })
      return
    }
    root.offset = { x: layout.rect.x, y: layout.rect.y }
    root.layout({
      minWidth: layout.rect.width,
      maxWidth: layout.rect.width,
      minHeight: layout.rect.height,
      maxHeight: layout.rect.height,
    }, false, { theme: popupContext.theme })
  }

  private _layoutSurface(
    node: PopupRenderNode,
    constraints: BoxConstraints,
    context: LayoutContext,
  ): void {
    node.size = { width: constraints.maxWidth, height: constraints.maxHeight }
    const content = this._content
    const padding = this._layout?.padding ?? 0
    if (!content) return
    const width = Math.max(0, constraints.maxWidth - padding * 2)
    const height = Math.max(0, constraints.maxHeight - padding * 2)
    content.layout({
      minWidth: 0,
      maxWidth: width,
      minHeight: 0,
      maxHeight: height,
    }, true, context)
    content.offset = { x: padding, y: padding }
  }

  private _paintSurface(context: PaintContext, offset: Offset): void {
    const layout = this._layout
    if (!layout || !this._content) {
      this._paintedLayout = null
      return
    }
    const style = derivePopupStyle(context.theme)
    drawPopupPanel(
      new DrawList(context),
      offset.x,
      offset.y,
      this._surfaceRoot.size.width,
      this._surfaceRoot.size.height,
      style,
    )
    this._content.paint(context, {
      x: offset.x + this._content.offset.x,
      y: offset.y + this._content.offset.y,
    })
    this._paintedLayout = {
      ...layout,
      rect: { ...layout.rect },
    }
  }

  private _resolveLayout(popupContext: PopupContext): HoverCardLayout | null {
    const options = this._options
    const content = this._content
    if (!options || !content || !this.visible) return null
    const viewport = normalizeRect(popupViewportRect(popupContext))
    const anchor = normalizeRectFromAnchor(resolvePopupAnchorRect(options.anchor))
    const boundaryAnchor = options.boundary
      ? normalizeRectFromAnchor(resolvePopupAnchorRect(options.boundary))
      : viewport
    const rawBoundary = intersectRects(viewport, boundaryAnchor)
    if (
      anchor.width <= 0 ||
      anchor.height <= 0 ||
      rawBoundary.width <= 0 ||
      rawBoundary.height <= 0 ||
      !rectsStrictlyIntersect(anchor, rawBoundary)
    ) return null

    const style = derivePopupStyle(popupContext.theme)
    const shadowExtent = Math.max(
      style.shadowBlur * 2 + Math.abs(style.shadowOffsetX),
      style.shadowBlur * 2 + Math.abs(style.shadowOffsetY),
      1,
    )
    const panelBoundary = insetRect(rawBoundary, options.inset + shadowExtent)
    const maxPanelWidth = Math.min(panelBoundary.width, options.maxWidth)
    const maxPanelHeight = Math.min(panelBoundary.height, options.maxHeight)
    const padding = Math.max(0, style.padding)
    const measurePanel = (widthLimit: number, heightLimit: number): { width: number; height: number } | null => {
      const maxContentWidth = widthLimit - padding * 2
      const maxContentHeight = heightLimit - padding * 2
      if (maxContentWidth <= 0 || maxContentHeight <= 0) return null
      const measured = content.measureOuter({
        minWidth: 0,
        maxWidth: maxContentWidth,
        minHeight: 0,
        maxHeight: maxContentHeight,
      }, { theme: popupContext.theme })
      if (!Number.isFinite(measured.width) || !Number.isFinite(measured.height)) return null
      return {
        width: Math.min(
          widthLimit,
          Math.max(Math.min(options.minWidth, widthLimit), measured.width + padding * 2),
        ),
        height: Math.min(heightLimit, Math.max(1, measured.height + padding * 2)),
      }
    }
    let panel = measurePanel(maxPanelWidth, maxPanelHeight)
    if (!panel) return null
    let resolved = resolveAnchoredPopupRect({
      anchorRect: anchor,
      popupSize: panel,
      viewportRect: panelBoundary,
      preferredPlacement: options.placement,
      fallbackPlacements: options.fallbackPlacements,
      overflowPreference: options.overflowPreference,
      gap: options.gap,
      inset: 0,
    })
    if (!resolved) return null
    const primarySpace = availablePrimarySpace(resolved.placement, anchor, panelBoundary, options.gap)
    const widthLimit = resolved.placement.startsWith('left') || resolved.placement.startsWith('right')
      ? Math.min(maxPanelWidth, primarySpace)
      : maxPanelWidth
    const heightLimit = resolved.placement.startsWith('top') || resolved.placement.startsWith('bottom')
      ? Math.min(maxPanelHeight, primarySpace)
      : maxPanelHeight
    if (widthLimit < panel.width || heightLimit < panel.height) {
      panel = measurePanel(widthLimit, heightLimit)
      if (!panel) return null
      resolved = resolveAnchoredPopupRect({
        anchorRect: anchor,
        popupSize: panel,
        viewportRect: panelBoundary,
        preferredPlacement: resolved.placement,
        fallbackPlacements: [],
        overflowPreference: 'preferred',
        gap: options.gap,
        inset: 0,
      })
      if (!resolved) return null
    }
    const rect = normalizeRect(resolved.rect)
    const validationKey = this._validationKey(popupContext)
    return {
      rect,
      placement: resolved.placement,
      padding,
      validationKey,
      key: [
        validationKey,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        resolved.placement,
      ].join('|'),
    }
  }

  private _validationKey(popupContext: PopupContext): string {
    const options = this._options
    if (!options) return ''
    const viewport = normalizeRect(popupViewportRect(popupContext))
    const anchor = normalizeRectFromAnchor(resolvePopupAnchorRect(options.anchor))
    const boundary = options.boundary
      ? normalizeRectFromAnchor(resolvePopupAnchorRect(options.boundary))
      : viewport
    return [
      themeValueSignature(popupContext.theme),
      popupContext.viewport.dpr,
      viewport.x,
      viewport.y,
      viewport.width,
      viewport.height,
      anchor.x,
      anchor.y,
      anchor.width,
      anchor.height,
      boundary.x,
      boundary.y,
      boundary.width,
      boundary.height,
      options.placement,
      options.fallbackPlacements?.join(','),
      options.overflowPreference,
      options.gap,
      options.inset,
      options.minWidth,
      options.maxWidth,
      options.maxHeight,
    ].join('|')
  }
}

function availablePrimarySpace(
  placement: AnchoredPopupPlacement,
  anchor: Rect,
  boundary: Rect,
  gap: number,
): number {
  if (placement.startsWith('top')) return Math.max(0, anchor.y - gap - boundary.y)
  if (placement.startsWith('bottom')) {
    return Math.max(0, boundary.y + boundary.height - anchor.y - anchor.height - gap)
  }
  if (placement.startsWith('left')) return Math.max(0, anchor.x - gap - boundary.x)
  return Math.max(0, boundary.x + boundary.width - anchor.x - anchor.width - gap)
}

function normalizeHoverCardPopupOptions(options: HoverCardPopupOptions): NormalizedHoverCardPopupOptions {
  const anchor = snapshotPopupAnchor(options.anchor)
  return {
    anchor,
    boundary: options.boundary ? snapshotPopupAnchor(options.boundary) : undefined,
    owner: options.owner ?? resolvePopupAnchorTarget(anchor),
    anchorRoot: options.anchorRoot,
    anchorMode: options.anchorMode ?? 'stable',
    placement: options.placement ?? 'bottom-start',
    fallbackPlacements: options.fallbackPlacements ? [...options.fallbackPlacements] : undefined,
    overflowPreference: options.overflowPreference ?? 'largest-space',
    gap: normalizeNonNegative(options.gap, 6),
    inset: normalizeNonNegative(options.inset, 4),
    minWidth: normalizeNonNegative(options.minWidth, 220),
    maxWidth: normalizePositive(options.maxWidth, 560),
    maxHeight: normalizePositive(options.maxHeight, 360),
    closeDelayMs: normalizeNonNegative(options.closeDelayMs, 150),
    onDismiss: options.onDismiss,
  }
}

function snapshotPopupAnchor(anchor: PopupAnchor): PopupAnchor {
  if (typeof anchor === 'object' && anchor !== null && 'target' in anchor) {
    const placement = anchor as PopupAnchorPlacement
    return { target: placement.target, data: placement.data }
  }
  return anchor
}

function normalizeNonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(0, value)
}

function normalizePositive(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback
  return value
}

function normalizeRect(rect: Rect): Rect {
  return {
    x: Number.isFinite(rect.x) ? rect.x : 0,
    y: Number.isFinite(rect.y) ? rect.y : 0,
    width: Number.isFinite(rect.width) ? Math.max(0, rect.width) : 0,
    height: Number.isFinite(rect.height) ? Math.max(0, rect.height) : 0,
  }
}

function normalizeRectFromAnchor(rect: { x: number; y: number; w: number; h: number }): Rect {
  return normalizeRect({ x: rect.x, y: rect.y, width: rect.w, height: rect.h })
}

function intersectRects(first: Rect, second: Rect): Rect {
  const x = Math.max(first.x, second.x)
  const y = Math.max(first.y, second.y)
  const right = Math.min(first.x + first.width, second.x + second.width)
  const bottom = Math.min(first.y + first.height, second.y + second.height)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

function insetRect(rect: Rect, inset: number): Rect {
  return {
    x: rect.x + inset,
    y: rect.y + inset,
    width: Math.max(0, rect.width - inset * 2),
    height: Math.max(0, rect.height - inset * 2),
  }
}

function rectsStrictlyIntersect(first: Rect, second: Rect): boolean {
  return first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
}
