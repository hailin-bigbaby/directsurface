// Tooltip: 全局悬浮提示管理器
// 任何组件 hover 时调用 TooltipManager.show()，绘制到 tooltip 层
// 支持延迟显示、自动避边、淡入动画

import { DrawList } from '../rendering/draw_list'
import { AnimationController } from '../animation/animation_controller'
import { Curves } from '../animation/curves'
import type { PaintContext } from '../rendering/paint_context'
import type { Offset, Rect, RenderObject } from '../core/render_object'
import { DisposableBag, type DisposeFn } from '../core/disposable'
import { OverlayInvalidator } from '../core/overlay_invalidator'
import {
  PopupManager,
  clampRectToPopupViewport,
  popupViewportRect,
  type PopupAnchorMode,
  type PopupContext,
} from '../core/popup_manager'
import { PopupShell } from '../core/popup_shell'
import type { RenderBox, TooltipContent } from '../layout/render_box'
import {
  DefaultThemeMotion,
  resolveThemeElevation,
  resolveThemeMotion,
  themeValueSignature,
} from '../theme/theme'
import {
  resolvePopupAnchorRect,
  resolvePopupAnchorTarget,
  type PopupAnchor,
  type PopupAnchorPlacement,
} from '../core/popup_anchor'
import {
  resolveAnchoredPopupRect,
  type AnchoredPopupOverflowPreference,
  type AnchoredPopupPlacement,
} from '../core/anchored_popup_layout'

export type { TooltipContent } from '../layout/render_box'

export interface TooltipPresenter {
  show(content: TooltipContent, pos: Offset, delay?: number): void
  hide(): void
  updatePos(pos: Offset): void
}

export interface AnchoredTooltipOptions {
  anchor: PopupAnchor
  boundary?: PopupAnchor
  placement?: AnchoredPopupPlacement
  fallbackPlacements?: readonly AnchoredPopupPlacement[]
  overflowPreference?: AnchoredPopupOverflowPreference
  delay?: number
  gap?: number
  inset?: number
  maxWidth?: number
  maxHeight?: number
  owner?: object
  anchorRoot?: RenderObject
  anchorMode?: PopupAnchorMode
  onDismiss?: () => void
}

export type AnchoredTooltipContent = () => RenderBox

export interface TooltipManagerDebugState {
  disposed: boolean
  mode: 'none' | 'pointer' | 'anchored'
  popupOpen: boolean
  pending: boolean
  visible: boolean
  rect: Rect | null
  placement: AnchoredPopupPlacement | null
  contentKind: 'text' | 'rich' | null
}

type TooltipManagerPresentationState =
  | 'closed'
  | 'pointer-pending'
  | 'pointer-visible'
  | 'anchored-pending'
  | 'anchored-visible'
  | 'disposed'

interface NormalizedAnchoredTooltipOptions {
  anchor: PopupAnchor
  boundary?: PopupAnchor
  preferredPlacement: AnchoredPopupPlacement
  fallbackPlacements?: readonly AnchoredPopupPlacement[]
  overflowPreference: AnchoredPopupOverflowPreference
  delay: number
  gap: number
  inset: number
  maxWidth?: number
  maxHeight?: number
  owner?: object
  anchorRoot?: RenderObject
  anchorMode: PopupAnchorMode
  onDismiss?: () => void
}

interface AnchoredTooltipLayoutValidationKey {
  presentationOperationSeq: number
  state: 'anchored-visible'
  anchorRoot?: RenderObject
  themeSignature: string
  viewport: Rect & { dpr: number }
  anchorRect: Rect
  boundaryRect: Rect
  placement: AnchoredPopupPlacement
  fallbackPlacements?: readonly AnchoredPopupPlacement[]
  overflowPreference: AnchoredPopupOverflowPreference
  gap: number
  inset: number
  maxWidth?: number
  maxHeight?: number
}

interface AnchoredTooltipLayoutSnapshot {
  key: AnchoredTooltipLayoutValidationKey
  rect: Rect | null
  placement: AnchoredPopupPlacement | null
}

export class TooltipService {
  private static _services: TooltipPresenter[] = []

  static installCurrent(service: TooltipPresenter): TooltipPresenter {
    TooltipService.clearCurrent(service)
    TooltipService._services.push(service)
    return service
  }

  static clearCurrent(service?: TooltipPresenter): void {
    if (!service) {
      TooltipService._services = []
      return
    }
    TooltipService._services = TooltipService._services.filter(candidate => candidate !== service)
  }

  static get currentOrNull(): TooltipPresenter | null {
    return TooltipService._services[TooltipService._services.length - 1] ?? null
  }
}

export class TooltipManager extends PopupShell {
  readonly overlayLayer = 'tooltip'

  private _content: TooltipContent | null = null
  private _richContent: RenderBox | null = null
  private _targetPos: Offset = { x: 0, y: 0 }
  private _state: TooltipManagerPresentationState = 'closed'
  private _anchoredOptions: NormalizedAnchoredTooltipOptions | null = null
  private _anchoredLayout: AnchoredTooltipLayoutSnapshot | null = null
  private _delayDisposer?: DisposeFn
  private _fadeAnim: AnimationController
  private _disposables = new DisposableBag()
  private _disposed = false
  private _presentationOperationSeq = 0

  constructor() {
    super()
    this._fadeAnim = new AnimationController({ duration: DefaultThemeMotion.fastDuration, curve: Curves.easeOut })
    this._fadeAnim.addListener(() => OverlayInvalidator.instance.requestPaint())
    this._disposables.addDisposable(this._fadeAnim)
  }

  // 鼠标移到目标上时调用（传入鼠标全局坐标）
  show(content: TooltipContent, pos: Offset, delay = 600): void {
    if (this._disposed) return
    if (this._state === 'pointer-visible' && this._content === content && this.visible) return
    const token = ++this._presentationOperationSeq
    const wasPointerVisible = this._state === 'pointer-visible' && this.visible
    if (this._isAnchoredState()) {
      this.dismiss()
      if (this._disposed || token !== this._presentationOperationSeq) return
    }
    this._cancelDelay()
    if (this._content !== content) this._disposeRichContent()
    this._content = content
    this._anchoredOptions = null
    this._anchoredLayout = null
    this._targetPos = pos
    this._fadeAnim.duration = resolveThemeMotion(PopupManager.instance.context.theme).fastDuration
    const opened = !this.popupOpen
    if (opened) this.openPopup({ anchorMode: 'dynamic', interactive: false })
    if (wasPointerVisible) {
      this._state = 'pointer-visible'
      if (!opened) OverlayInvalidator.instance.requestPaint()
      return
    }
    this._state = 'pointer-pending'
    this._scheduleDelay(delay, 'pointer-pending', 'pointer-visible', token)
    if (!opened) OverlayInvalidator.instance.requestPaint()
  }

  showAnchored(content: AnchoredTooltipContent, options: AnchoredTooltipOptions): void {
    if (this._disposed) return
    const normalized = normalizeAnchoredTooltipOptions(options)
    const token = ++this._presentationOperationSeq
    const currentOptions = this._anchoredOptions
    const sameEntry = this._isAnchoredState() &&
      currentOptions !== null &&
      currentOptions.owner === normalized.owner &&
      currentOptions.anchorMode === normalized.anchorMode &&
      currentOptions.anchorRoot === normalized.anchorRoot

    if (this._state !== 'closed' && !sameEntry) {
      this.dismiss()
      if (this._disposed || token !== this._presentationOperationSeq) return
    }

    const wasPending = sameEntry && this._state === 'anchored-pending'
    const wasVisible = sameEntry && this._state === 'anchored-visible'
    this._cancelDelay()
    if (this._content !== content) this._disposeRichContent()
    this._content = content
    this._anchoredOptions = normalized
    this._anchoredLayout = null

    if (!sameEntry || !this.popupOpen) {
      this._state = 'anchored-pending'
      this.openPopup({
        interactionMode: 'passive',
        anchorMode: normalized.anchorMode,
        anchorRoot: normalized.anchorRoot,
        owner: normalized.owner,
      })
      this._fadeAnim.duration = resolveThemeMotion(PopupManager.instance.contextFor(this).theme).fastDuration
      this._scheduleDelay(normalized.delay, 'anchored-pending', 'anchored-visible', token)
      return
    }

    if (wasVisible) {
      this._state = 'anchored-visible'
      OverlayInvalidator.instance.requestPaint()
      return
    }

    if (wasPending) {
      this._state = 'anchored-pending'
      this._scheduleDelay(normalized.delay, 'anchored-pending', 'anchored-visible', token)
    }
  }

  // 鼠标离开时调用
  hide(): void {
    if (this._disposed || this._state === 'closed') return
    this._presentationOperationSeq += 1
    const hadPendingDelay = this._delayDisposer !== undefined
    this._cancelDelay()
    const wasVisible = this.visible
    this.dismiss()
    if (!wasVisible) {
      if (hadPendingDelay) OverlayInvalidator.instance.requestPaint()
      return
    }
  }

  // 更新鼠标位置（hover 中持续调用）
  updatePos(pos: Offset): void {
    if (this._disposed) return
    this._targetPos = pos
  }

  invalidateAnchoredLayout(): void {
    if (this._disposed || !this._isAnchoredState()) return
    this._anchoredLayout = null
    OverlayInvalidator.instance.requestPaint()
  }

  debugState(): TooltipManagerDebugState {
    let rect: Rect | null = null
    let placement: AnchoredPopupPlacement | null = null
    if (this._state === 'anchored-visible' && this._anchoredLayout) {
      const currentKey = this._anchoredValidationKey()
      if (currentKey && equalAnchoredValidationKeys(currentKey, this._anchoredLayout.key)) {
        rect = this._anchoredLayout.rect ? { ...this._anchoredLayout.rect } : null
        placement = this._anchoredLayout.placement
      }
    }
    return {
      disposed: this._disposed,
      mode: this._isPointerState() ? 'pointer' : this._isAnchoredState() ? 'anchored' : 'none',
      popupOpen: this.popupOpen,
      pending: this._state === 'pointer-pending' || this._state === 'anchored-pending',
      visible: this.visible,
      rect,
      placement,
      contentKind: typeof this._content === 'string'
        ? 'text'
        : typeof this._content === 'function'
          ? 'rich'
          : null,
    }
  }

  override get visible(): boolean {
    return this._state === 'pointer-visible' ||
      this._state === 'anchored-visible' ||
      this._fadeAnim.value > 0
  }

  hitTest(_point: Offset, _popupContext?: PopupContext): boolean {
    return false
  }

  close(): void {
    this.hide()
  }

  private _scheduleDelay(
    delay: number,
    pendingState: 'pointer-pending' | 'anchored-pending',
    visibleState: 'pointer-visible' | 'anchored-visible',
    operationSeq: number,
  ): void {
    this._delayDisposer = this._disposables.setTimeout(() => {
      this._delayDisposer = undefined
      if (
        this._disposed ||
        this._presentationOperationSeq !== operationSeq ||
        this._state !== pendingState
      ) return
      this._state = visibleState
      this._fadeAnim.resetValue(0)
      this._fadeAnim.forward()
    }, delay)
  }

  private _cancelDelay(): void {
    if (this._delayDisposer !== undefined) {
      this._delayDisposer()
      this._delayDisposer = undefined
    }
  }

  paint(context: PaintContext, _offset: Offset): void {
    if (!this.visible || !this._content) return
    const alpha = this._fadeAnim.value
    if (alpha <= 0) return
    if (this._state === 'anchored-visible') {
      this._paintAnchoredRichTooltip(context, alpha)
      return
    }
    if (typeof this._content === 'string') {
      this._paintTextTooltip(context, alpha)
    } else {
      this._paintRichTooltip(context, alpha)
    }
  }

  private _paintTextTooltip(context: PaintContext, alpha: number): void {
    if (typeof this._content !== 'string') return

    const popupContext = PopupManager.instance.context
    const dl = new DrawList(context)
    const t = popupContext.theme
    const elevation = resolveThemeElevation(t)
    const padding = t.framePadding
    const fontSize = t.fontSize * 0.9

    const lines = this._content.split(/\r\n?|\n/)
    const lineGap = lines.length > 1 ? Math.max(2, fontSize * 0.35) : 0
    const textBlockH = fontSize * lines.length + lineGap * (lines.length - 1)

    // 测量文字宽度
    const ctx = context.ctx
    ctx.save()
    ctx.font = `${fontSize}px ${t.fontFamily}`
    const textW = Math.max(...lines.map(line => ctx.measureText(line).width), 0)
    ctx.restore()

    const boxW = textW + padding * 2
    const boxH = textBlockH + padding * 2

    // 计算位置（鼠标右下方，避免超出边界）
    const offset = 14
    let bx = this._targetPos.x + offset
    let by = this._targetPos.y + offset

    if (bx + boxW > (popupContext.viewport.x ?? 0) + popupContext.viewport.width - 4) bx = this._targetPos.x - boxW - 4
    if (by + boxH > (popupContext.viewport.y ?? 0) + popupContext.viewport.height - 4) by = this._targetPos.y - boxH - 4
    const textRect = clampRectToPopupViewport({ x: bx, y: by, width: boxW, height: boxH }, popupContext, 4)
    bx = textRect.x
    by = textRect.y

    dl.outerShadow(
      bx,
      by,
      boxW,
      boxH,
      elevation.popupShadowBlur,
      { ...elevation.popupShadowColor, a: elevation.popupShadowColor.a * alpha },
      t.frameRounding,
      elevation.popupShadowOffsetX,
      elevation.popupShadowOffsetY,
    )

    // 背景
    const bg = { ...t.surfacePopup, a: t.surfacePopup.a * alpha }
    dl.fillRect(bx, by, boxW, boxH, bg, t.frameRounding)
    dl.strokeRect(bx, by, boxW, boxH, { ...t.borderPanel, a: t.borderPanel.a * alpha }, 1, t.frameRounding)

    // 文字
    const firstLineY = by + padding + fontSize / 2
    for (let index = 0; index < lines.length; index += 1) {
      dl.fillText(
        lines[index] ?? '',
        bx + padding,
        firstLineY + index * (fontSize + lineGap),
        { ...t.textPrimary, a: alpha },
        fontSize,
        t.fontFamily,
        'left',
        'middle',
      )
    }
  }

  private _paintRichTooltip(context: PaintContext, alpha: number): void {
    if (typeof this._content !== 'function') return
    const popupContext = PopupManager.instance.context
    const dl = new DrawList(context)
    const t = popupContext.theme
    const elevation = resolveThemeElevation(t)
    const padding = t.framePadding * 1.5
    const viewportPadding = 4
    const maxBoxW = Math.max(120, Math.min(360, popupContext.viewport.width - viewportPadding * 2))
    const maxBoxH = Math.max(40, popupContext.viewport.height - viewportPadding * 2)
    const content = this._ensureRichContent()
    const maxContentW = Math.max(80, maxBoxW - padding * 2)
    const maxContentH = Math.max(20, maxBoxH - padding * 2)

    content.layout({
      minWidth: 0,
      maxWidth: maxContentW,
      minHeight: 0,
      maxHeight: maxContentH,
    }, false, { theme: t })

    const boxW = Math.min(maxBoxW, content.size.width + padding * 2)
    const boxH = Math.min(maxBoxH, content.size.height + padding * 2)
    const offset = 14
    let bx = this._targetPos.x + offset
    let by = this._targetPos.y + offset

    if (bx + boxW > (popupContext.viewport.x ?? 0) + popupContext.viewport.width - viewportPadding) bx = this._targetPos.x - boxW - viewportPadding
    if (by + boxH > (popupContext.viewport.y ?? 0) + popupContext.viewport.height - viewportPadding) by = this._targetPos.y - boxH - viewportPadding
    const richRect = clampRectToPopupViewport({ x: bx, y: by, width: boxW, height: boxH }, popupContext, viewportPadding)
    bx = richRect.x
    by = richRect.y

    dl.outerShadow(
      bx,
      by,
      boxW,
      boxH,
      elevation.popupShadowBlur,
      { ...elevation.popupShadowColor, a: elevation.popupShadowColor.a * alpha },
      t.frameRounding,
      elevation.popupShadowOffsetX,
      elevation.popupShadowOffsetY,
    )
    dl.fillRect(bx, by, boxW, boxH, { ...t.surfacePopup, a: t.surfacePopup.a * alpha }, t.frameRounding)
    dl.strokeRect(bx, by, boxW, boxH, { ...t.borderPanel, a: t.borderPanel.a * alpha }, 1, t.frameRounding)
    context.ctx.save()
    const previousAlpha = typeof context.ctx.globalAlpha === 'number' ? context.ctx.globalAlpha : 1
    context.ctx.globalAlpha = previousAlpha * alpha
    try {
      content.paint(context, { x: bx + padding, y: by + padding })
    } finally {
      context.ctx.globalAlpha = previousAlpha
      context.ctx.restore()
    }
  }

  private _paintAnchoredRichTooltip(context: PaintContext, alpha: number): void {
    if (typeof this._content !== 'function' || !this._anchoredOptions) return
    const popupContext = PopupManager.instance.contextFor(this)
    const key = this._anchoredValidationKey(popupContext)
    if (!key) {
      this._anchoredLayout = null
      return
    }

    const rawBoundary = intersectRects(key.viewport, key.boundaryRect)
    if (
      key.anchorRect.width <= 0 ||
      key.anchorRect.height <= 0 ||
      rawBoundary.width <= 0 ||
      rawBoundary.height <= 0 ||
      !rectsStrictlyIntersect(key.anchorRect, rawBoundary)
    ) {
      this._anchoredLayout = { key, rect: null, placement: null }
      return
    }

    const t = popupContext.theme
    const elevation = resolveThemeElevation(t)
    const shadowExtent = Math.max(
      elevation.popupShadowBlur * 2 + Math.abs(elevation.popupShadowOffsetX),
      elevation.popupShadowBlur * 2 + Math.abs(elevation.popupShadowOffsetY),
      1,
    )
    const boundaryInset = this._anchoredOptions.inset + shadowExtent
    const panelBoundary = insetRect(rawBoundary, boundaryInset)
    const maxBoxW = Math.min(
      panelBoundary.width,
      this._anchoredOptions.maxWidth ?? panelBoundary.width,
    )
    const maxBoxH = Math.min(
      panelBoundary.height,
      this._anchoredOptions.maxHeight ?? panelBoundary.height,
    )
    const padding = Math.max(0, t.framePadding * 1.5)
    const maxContentW = maxBoxW - padding * 2
    const maxContentH = maxBoxH - padding * 2
    if (
      panelBoundary.width <= 0 ||
      panelBoundary.height <= 0 ||
      maxBoxW <= 0 ||
      maxBoxH <= 0 ||
      maxContentW <= 0 ||
      maxContentH <= 0
    ) {
      this._anchoredLayout = { key, rect: null, placement: null }
      return
    }

    const content = this._ensureRichContent()
    content.layout({
      minWidth: 0,
      maxWidth: maxContentW,
      minHeight: 0,
      maxHeight: maxContentH,
    }, false, { theme: t })
    if (
      !Number.isFinite(content.size.width) ||
      !Number.isFinite(content.size.height) ||
      content.size.width <= 0 ||
      content.size.height <= 0
    ) {
      this._anchoredLayout = { key, rect: null, placement: null }
      return
    }

    const boxW = Math.min(maxBoxW, content.size.width + padding * 2)
    const boxH = Math.min(maxBoxH, content.size.height + padding * 2)
    const resolved = resolveAnchoredPopupRect({
      anchorRect: key.anchorRect,
      popupSize: { width: boxW, height: boxH },
      viewportRect: panelBoundary,
      preferredPlacement: this._anchoredOptions.preferredPlacement,
      fallbackPlacements: this._anchoredOptions.fallbackPlacements,
      overflowPreference: this._anchoredOptions.overflowPreference,
      gap: this._anchoredOptions.gap,
      inset: 0,
    })
    if (!resolved) {
      this._anchoredLayout = { key, rect: null, placement: null }
      return
    }

    const rect = resolved.rect
    this._anchoredLayout = {
      key,
      rect: { ...rect },
      placement: resolved.placement,
    }
    const dl = new DrawList(context)
    dl.outerShadow(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      elevation.popupShadowBlur,
      { ...elevation.popupShadowColor, a: elevation.popupShadowColor.a * alpha },
      t.frameRounding,
      elevation.popupShadowOffsetX,
      elevation.popupShadowOffsetY,
    )
    dl.fillRect(rect.x, rect.y, rect.width, rect.height, { ...t.surfacePopup, a: t.surfacePopup.a * alpha }, t.frameRounding)
    dl.strokeRect(rect.x, rect.y, rect.width, rect.height, { ...t.borderPanel, a: t.borderPanel.a * alpha }, 1, t.frameRounding)
    context.ctx.save()
    const previousAlpha = typeof context.ctx.globalAlpha === 'number' ? context.ctx.globalAlpha : 1
    context.ctx.globalAlpha = previousAlpha * alpha
    try {
      content.paint(context, { x: rect.x + padding, y: rect.y + padding })
    } finally {
      context.ctx.globalAlpha = previousAlpha
      context.ctx.restore()
    }
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._presentationOperationSeq += 1
    let firstError: unknown
    try {
      if (this.popupOpen) this.dismiss()
      else this._resetPresentation()
    } catch (error) {
      firstError = error
    } finally {
      try {
        this._disposables.dispose()
      } catch (error) {
        firstError ??= error
      }
      this._state = 'disposed'
    }
    if (firstError !== undefined) throw firstError
  }

  protected override onPopupClose(): void {
    this._resetPresentation()
  }

  private _resetPresentation(): void {
    const onDismiss = this._isAnchoredState()
      ? this._anchoredOptions?.onDismiss
      : undefined
    this._cancelDelay()
    this._state = this._disposed ? 'disposed' : 'closed'
    this._anchoredOptions = null
    this._anchoredLayout = null
    this._targetPos = { x: 0, y: 0 }
    this._fadeAnim.stop()
    this._fadeAnim.resetValue(0)
    let firstError: unknown
    try {
      this._disposeRichContent()
    } catch (error) {
      firstError = error
    }
    this._content = null
    if (onDismiss) {
      try {
        onDismiss()
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError !== undefined) throw firstError
  }

  private _ensureRichContent(): RenderBox {
    if (typeof this._content !== 'function') throw new Error('Tooltip content is not a render factory.')
    if (!this._richContent) this._richContent = this._content()
    return this._richContent
  }

  private _disposeRichContent(): void {
    if (!this._richContent) return
    this._richContent.dispose()
    this._richContent = null
  }

  private _anchoredValidationKey(
    popupContext: PopupContext = PopupManager.instance.contextFor(this),
  ): AnchoredTooltipLayoutValidationKey | null {
    const options = this._anchoredOptions
    if (!options || this._state !== 'anchored-visible') return null
    const viewport = normalizeRect(popupViewportRect(popupContext))
    const anchor = resolvePopupAnchorRect(options.anchor)
    const boundary = options.boundary
      ? resolvePopupAnchorRect(options.boundary)
      : { x: viewport.x, y: viewport.y, w: viewport.width, h: viewport.height }
    return {
      presentationOperationSeq: this._presentationOperationSeq,
      state: 'anchored-visible',
      anchorRoot: options.anchorRoot,
      themeSignature: themeValueSignature(popupContext.theme),
      viewport: {
        x: viewport.x,
        y: viewport.y,
        width: viewport.width,
        height: viewport.height,
        dpr: Number.isFinite(popupContext.viewport.dpr) ? popupContext.viewport.dpr : 1,
      },
      anchorRect: normalizeRect({ x: anchor.x, y: anchor.y, width: anchor.w, height: anchor.h }),
      boundaryRect: normalizeRect({ x: boundary.x, y: boundary.y, width: boundary.w, height: boundary.h }),
      placement: options.preferredPlacement,
      fallbackPlacements: options.fallbackPlacements,
      overflowPreference: options.overflowPreference,
      gap: options.gap,
      inset: options.inset,
      maxWidth: options.maxWidth,
      maxHeight: options.maxHeight,
    }
  }

  private _isPointerState(): boolean {
    return this._state === 'pointer-pending' || this._state === 'pointer-visible'
  }

  private _isAnchoredState(): boolean {
    return this._state === 'anchored-pending' || this._state === 'anchored-visible'
  }
}

function normalizeAnchoredTooltipOptions(options: AnchoredTooltipOptions): NormalizedAnchoredTooltipOptions {
  const anchor = snapshotPopupAnchor(options.anchor)
  return {
    anchor,
    boundary: options.boundary ? snapshotPopupAnchor(options.boundary) : undefined,
    preferredPlacement: options.placement ?? 'bottom-start',
    fallbackPlacements: options.fallbackPlacements ? [...options.fallbackPlacements] : undefined,
    overflowPreference: options.overflowPreference ?? 'largest-space',
    delay: normalizeDelay(options.delay),
    gap: normalizeNonNegative(options.gap, 6),
    inset: normalizeNonNegative(options.inset, 4),
    maxWidth: normalizeMaximum(options.maxWidth),
    maxHeight: normalizeMaximum(options.maxHeight),
    owner: options.owner ?? resolvePopupAnchorTarget(anchor),
    anchorRoot: options.anchorRoot,
    anchorMode: options.anchorMode ?? 'stable',
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

function normalizeDelay(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function normalizeNonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(0, value)
}

function normalizeMaximum(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : value
}

function normalizeRect(rect: Rect): Rect {
  return {
    x: Number.isFinite(rect.x) ? rect.x : 0,
    y: Number.isFinite(rect.y) ? rect.y : 0,
    width: Number.isFinite(rect.width) ? Math.max(0, rect.width) : 0,
    height: Number.isFinite(rect.height) ? Math.max(0, rect.height) : 0,
  }
}

function intersectRects(first: Rect, second: Rect): Rect {
  const x = Math.max(first.x, second.x)
  const y = Math.max(first.y, second.y)
  const right = Math.min(first.x + first.width, second.x + second.width)
  const bottom = Math.min(first.y + first.height, second.y + second.height)
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  }
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

function equalAnchoredValidationKeys(
  first: AnchoredTooltipLayoutValidationKey,
  second: AnchoredTooltipLayoutValidationKey,
): boolean {
  return first.presentationOperationSeq === second.presentationOperationSeq &&
    first.state === second.state &&
    first.anchorRoot === second.anchorRoot &&
    first.themeSignature === second.themeSignature &&
    first.viewport.x === second.viewport.x &&
    first.viewport.y === second.viewport.y &&
    first.viewport.width === second.viewport.width &&
    first.viewport.height === second.viewport.height &&
    first.viewport.dpr === second.viewport.dpr &&
    equalRects(first.anchorRect, second.anchorRect) &&
    equalRects(first.boundaryRect, second.boundaryRect) &&
    first.placement === second.placement &&
    equalPlacements(first.fallbackPlacements, second.fallbackPlacements) &&
    first.overflowPreference === second.overflowPreference &&
    first.gap === second.gap &&
    first.inset === second.inset &&
    first.maxWidth === second.maxWidth &&
    first.maxHeight === second.maxHeight
}

function equalPlacements(
  first: readonly AnchoredPopupPlacement[] | undefined,
  second: readonly AnchoredPopupPlacement[] | undefined,
): boolean {
  if (first === second) return true
  if (!first || !second || first.length !== second.length) return false
  return first.every((placement, index) => placement === second[index])
}

function equalRects(first: Rect, second: Rect): boolean {
  return first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
}

// ---- TooltipTarget: 包装任意 RenderBox，添加 tooltip 支持 ----
// 用法：在 onPointerMove 中调用 tooltipTarget.handleMove(pos)，在 onPointerLeave 或真实序列取消时调用 handleLeave()

export class TooltipTarget {
  private _content: TooltipContent

  constructor(content: TooltipContent) {
    this._content = content
  }

  handleMove(pos: Offset): void {
    const service = TooltipService.currentOrNull
    if (!service) return
    service.show(this._content, pos)
    service.updatePos(pos)
  }

  handleLeave(): void {
    TooltipService.currentOrNull?.hide()
  }

  set text(v: TooltipContent) { this._content = v }
}
