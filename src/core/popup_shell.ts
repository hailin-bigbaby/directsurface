import type { PaintContext } from '../rendering/paint_context'
import { isPrimaryPointerButton, type PointerEvent, type WheelPointerEvent } from '../gestures/hit_test'
import type { Popup, PopupContext, PopupOpenOptions } from './popup_manager'
import { PopupManager } from './popup_manager'
import type { Offset, RenderObject } from './render_object'
import {
  PopupRenderSurface,
  type PopupRenderSurfaceSync,
} from './popup_render_surface'

export interface PopupPanelLayout {
  panelX: number
  panelY: number
  panelW: number
  panelH: number
}

export interface PopupRectLike {
  x: number
  y: number
  w: number
  h: number
}

export interface PopupResizablePanelLayout extends PopupPanelLayout {
  resizeGripRect: PopupRectLike
}

function pointInPopupRect(point: Offset, rect: PopupRectLike): boolean {
  return point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
}

export abstract class PopupShell implements Popup {
  private _visible = false
  private _ownedCursor: string | null = null

  get visible(): boolean {
    return this._visible
  }

  protected get popupOpen(): boolean {
    return this._visible
  }

  ownsCursor(): boolean {
    return this._ownedCursor !== null
  }

  syncCursor(popupContext: PopupContext = this.popupContext): boolean {
    const cursor = this._ownedCursor
    if (cursor === null) return false
    popupContext.setCursor?.(cursor)
    return true
  }

  protected get popupContext(): PopupContext {
    return PopupManager.instance.context
  }

  protected setPopupCursor(cursor: string, popupContext: PopupContext = this.popupContext): void {
    if (this._ownedCursor === cursor) return
    this._ownedCursor = cursor
    popupContext.setCursor?.(cursor)
  }

  protected resetPopupCursor(popupContext: PopupContext = this.popupContext): void {
    if (this._ownedCursor === null) return
    this._ownedCursor = null
    popupContext.setCursor?.('default')
  }

  protected openPopup(options: PopupOpenOptions = {}): void {
    if (this._visible) this.close()
    this._visible = true
    this.onPopupOpen()
    PopupManager.instance.open(this, options)
    this.requestPopupPaint()
  }

  dismiss(): void {
    if (!this._visible) return
    PopupManager.instance.dismiss(this)
    this.finishPopupClose()
  }

  close(): void {
    if (!this._visible) return
    PopupManager.instance.dismiss(this)
    this.finishPopupClose()
  }

  protected requestPopupPaint(fallback?: () => void): void {
    PopupManager.instance.requestPaint(fallback)
  }

  protected onPopupOpen(): void {}

  protected onPopupClose(): void {}

  onEscape(_event: KeyboardEvent): boolean {
    if (!this.visible) return false
    this.close()
    return true
  }

  protected finishPopupClose(): void {
    if (!this._visible) return
    this._visible = false
    try {
      this.onPopupClose()
    } finally {
      this.resetPopupCursor()
      PopupManager.instance.syncCurrentCursor()
      this.requestPopupPaint()
    }
  }

  abstract hitTest(point: Offset, popupContext: PopupContext): boolean
}

export abstract class PopupSurfaceShell extends PopupShell {
  private readonly _surface: PopupRenderSurface

  protected constructor(root?: RenderObject | null, sync?: PopupRenderSurfaceSync) {
    super()
    this._surface = new PopupRenderSurface(
      root,
      sync,
      cursor => {
        if (cursor === 'default') {
          this.resetPopupCursor()
          return
        }
        this.setPopupCursor(cursor)
      },
    )
  }

  protected resetPopupSurface(): void {
    this._surface.reset()
  }

  protected get popupSurfaceHasActivePointerInteraction(): boolean {
    return this._surface.hasActivePointerInteraction
  }

  protected setPopupSurfaceRoot(root: RenderObject | null): void {
    this._surface.setRoot(root)
  }

  protected setPopupSurfaceSync(sync?: PopupRenderSurfaceSync): void {
    this._surface.setSync(sync)
  }

  override hitTest(point: Offset, popupContext: PopupContext): boolean {
    return this.visible && this._surface.hitTest(point, popupContext)
  }

  focusRoots(_popupContext: PopupContext = this.popupContext): readonly RenderObject[] {
    if (!this.visible || !this._surface.root) return []
    return [this._surface.root]
  }

  onPointerDown(event: PointerEvent, popupContext: PopupContext = this.popupContext): void {
    if (!isPrimaryPointerButton(event)) return
    if (!this.visible) return
    if (this._surface.handlePointerDown(event, popupContext)) this.requestPopupPaint()
  }

  onPointerMove(event: PointerEvent, popupContext: PopupContext = this.popupContext): void {
    if (!this.visible) return
    if (this._surface.handlePointerMove(event, popupContext)) this.requestPopupPaint()
  }

  onPointerUp(event: PointerEvent, popupContext: PopupContext = this.popupContext): void {
    if (!isPrimaryPointerButton(event)) return
    if (!this.visible) return
    if (this._surface.handlePointerUp(event, popupContext)) this.requestPopupPaint()
  }

  onPointerCancel(event: PointerEvent, popupContext: PopupContext = this.popupContext): void {
    if (!this.visible) return
    if (this._surface.handlePointerCancel(event, popupContext)) this.requestPopupPaint()
  }

  onWheel(event: WheelPointerEvent, popupContext: PopupContext = this.popupContext): boolean {
    if (!this.visible) return false
    return this._surface.handleWheel(event, popupContext)
  }

  paint(context: PaintContext, popupContextOrOffset?: PopupContext | Offset): void {
    if (!this.visible) return
    const popupContext = this._resolvePaintContext(popupContextOrOffset)
    this._surface.paint(context, popupContext)
  }

  protected override onPopupClose(): void {
    this._surface.reset()
  }

  protected disposePopupSurface(): void {
    this._surface.dispose()
  }

  private _resolvePaintContext(popupContextOrOffset?: PopupContext | Offset): PopupContext {
    if (
      popupContextOrOffset &&
      'theme' in popupContextOrOffset &&
      'viewport' in popupContextOrOffset
    ) {
      return popupContextOrOffset
    }
    return this.popupContext
  }
}

export abstract class PopupPanelShell extends PopupShell {
  protected abstract getPanelLayout(popupContext: PopupContext): PopupPanelLayout

  override hitTest(point: Offset, popupContext: PopupContext): boolean {
    if (!this.visible) return false
    const layout = this.getPanelLayout(popupContext)
    return pointInPopupRect(point, {
      x: layout.panelX,
      y: layout.panelY,
      w: layout.panelW,
      h: layout.panelH,
    })
  }
}

export abstract class ResizablePopupPanelShell extends PopupPanelShell {
  private _panelWidthOverride: number | null = null
  private _panelHeightOverride: number | null = null
  private _resizing = false
  private _resizeGripHovered = false
  private _resizeStartX = 0
  private _resizeStartY = 0
  private _resizeStartW = 0
  private _resizeStartH = 0

  protected get panelWidthOverride(): number | null {
    return this._panelWidthOverride
  }

  protected get panelHeightOverride(): number | null {
    return this._panelHeightOverride
  }

  protected get panelResizing(): boolean {
    return this._resizing
  }

  protected get panelResizeGripHovered(): boolean {
    return this._resizeGripHovered
  }

  protected setPanelSizeOverride(width: number | null, height: number | null): void {
    this._panelWidthOverride = width
    this._panelHeightOverride = height
  }

  protected createResizeGripRect(
    panelX: number,
    panelY: number,
    panelW: number,
    panelH: number,
    size = 16,
  ): PopupRectLike {
    return {
      x: panelX + panelW - size - 4,
      y: panelY + panelH - size - 4,
      w: size,
      h: size,
    }
  }

  protected override getPanelLayout(popupContext: PopupContext): PopupPanelLayout {
    return this.getResizablePanelLayout(popupContext)
  }

  protected abstract getResizablePanelLayout(popupContext: PopupContext): PopupResizablePanelLayout

  protected abstract getMinPanelWidth(layout: PopupResizablePanelLayout): number

  protected abstract getMinPanelHeight(layout: PopupResizablePanelLayout): number

  protected onPanelResizeStart(
    _event: PointerEvent,
    _popupContext: PopupContext,
    _layout: PopupResizablePanelLayout,
  ): void {}

  protected onPanelResizeGripHoverChanged(
    _hovered: boolean,
    _event: PointerEvent,
    _popupContext: PopupContext,
    _layout: PopupResizablePanelLayout,
  ): void {}

  protected onPanelPointerDown(
    _event: PointerEvent,
    _popupContext: PopupContext,
    _layout: PopupResizablePanelLayout,
  ): void {}

  protected onPanelPointerMove(
    _event: PointerEvent,
    _popupContext: PopupContext,
    _layout: PopupResizablePanelLayout,
  ): void {}

  protected onPanelPointerUp(
    _event: PointerEvent,
    _popupContext: PopupContext,
    _layout: PopupResizablePanelLayout,
  ): void {}

  protected onPanelPointerCancel(
    _event: PointerEvent,
    _popupContext: PopupContext,
    _layout: PopupResizablePanelLayout,
  ): void {}

  protected onPanelWheel(
    _event: WheelPointerEvent,
    _popupContext: PopupContext,
    _layout: PopupResizablePanelLayout,
  ): void {}

  onPointerDown(event: PointerEvent, popupContext: PopupContext = this.popupContext): void {
    if (!isPrimaryPointerButton(event)) return
    if (!this.visible) return
    const layout = this.getResizablePanelLayout(popupContext)
    if (!this.hitTest(event.position, popupContext)) {
      this.close()
      return
    }
    if (pointInPopupRect(event.position, layout.resizeGripRect)) {
      this._resizing = true
      this._resizeGripHovered = true
      this._resizeStartX = event.position.x
      this._resizeStartY = event.position.y
      this._resizeStartW = layout.panelW
      this._resizeStartH = layout.panelH
      this.setPopupCursor('se-resize', popupContext)
      this.requestPopupPaint()
      this.onPanelResizeStart(event, popupContext, layout)
      return
    }
    this.onPanelPointerDown(event, popupContext, layout)
  }

  onPointerMove(event: PointerEvent, popupContext: PopupContext = this.popupContext): void {
    if (!this.visible) return
    if (this._resizing) {
      const layout = this.getResizablePanelLayout(popupContext)
      const nextWidth = Math.max(
        this.getMinPanelWidth(layout),
        this._resizeStartW + (event.position.x - this._resizeStartX),
      )
      const nextHeight = Math.max(
        this.getMinPanelHeight(layout),
        this._resizeStartH + (event.position.y - this._resizeStartY),
      )
      this.setPanelSizeOverride(nextWidth, nextHeight)
      this.setPopupCursor('se-resize', popupContext)
      this.requestPopupPaint()
      return
    }

    const layout = this.getResizablePanelLayout(popupContext)
    const hoveringGrip = pointInPopupRect(event.position, layout.resizeGripRect)
    if (hoveringGrip) {
      if (!this._resizeGripHovered) {
        this._resizeGripHovered = true
        this.onPanelResizeGripHoverChanged(true, event, popupContext, layout)
        this.requestPopupPaint()
      }
      this.setPopupCursor('se-resize', popupContext)
      return
    }

    if (this._resizeGripHovered) {
      this._resizeGripHovered = false
      this.onPanelResizeGripHoverChanged(false, event, popupContext, layout)
      this.resetPopupCursor(popupContext)
      this.requestPopupPaint()
    }

    this.onPanelPointerMove(event, popupContext, layout)
  }

  onPointerUp(event: PointerEvent, popupContext: PopupContext = this.popupContext): void {
    if (!isPrimaryPointerButton(event)) return
    if (!this.visible) return
    if (this._resizing) {
      this._resizing = false
      const layout = this.getResizablePanelLayout(popupContext)
      this._resizeGripHovered = pointInPopupRect(event.position, layout.resizeGripRect)
      if (this._resizeGripHovered) {
        this.setPopupCursor('se-resize', popupContext)
      } else {
        this.resetPopupCursor(popupContext)
      }
      this.requestPopupPaint()
      return
    }
    this.onPanelPointerUp(event, popupContext, this.getResizablePanelLayout(popupContext))
  }

  onPointerCancel(event: PointerEvent, popupContext: PopupContext = this.popupContext): void {
    if (!this.visible) return
    const layout = this.getResizablePanelLayout(popupContext)
    const wasResizing = this._resizing
    const wasHoveringGrip = this._resizeGripHovered
    this._resizing = false
    this._resizeGripHovered = false
    if (wasHoveringGrip) {
      this.onPanelResizeGripHoverChanged(false, event, popupContext, layout)
      this.requestPopupPaint()
    }
    this.resetPopupCursor(popupContext)
    if (wasResizing) return
    this.onPanelPointerCancel(event, popupContext, layout)
  }

  onWheel(event: WheelPointerEvent, popupContext: PopupContext = this.popupContext): boolean {
    if (!this.visible) return false
    this.onPanelWheel(event, popupContext, this.getResizablePanelLayout(popupContext))
    return true
  }

  protected override onPopupClose(): void {
    this._resizing = false
    this._resizeGripHovered = false
  }
}
