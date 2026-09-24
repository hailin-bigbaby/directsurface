import type { BoxConstraints, LayoutContext, Offset, RenderObject } from './render_object'
import { constrainSize, RenderObject as BaseRenderObject } from './render_object'
import type { PopupContext } from './popup_manager'
import { PopupRenderHost } from './popup_render_host'
import type { PaintContext } from '../rendering/paint_context'
import type { PointerEvent, WheelPointerEvent } from '../gestures/hit_test'
import { HitTestResult } from '../gestures/hit_test'
import type { InteractiveRenderObject } from '../gestures/recognizers'

export interface PopupRenderNodeOptions {
  layout?: (node: PopupRenderNode, constraints: BoxConstraints, context: LayoutContext) => void
  paint: (node: PopupRenderNode, context: PaintContext, offset: Offset) => void
  visitChildren?: (node: PopupRenderNode, visitor: (child: RenderObject) => void) => void
  onPointerEnter?: (node: PopupRenderNode, event: PointerEvent) => void
  onPointerLeave?: (node: PopupRenderNode, event: PointerEvent) => void
  onPointerDown?: (node: PopupRenderNode, event: PointerEvent) => void
  onPointerMove?: (node: PopupRenderNode, event: PointerEvent) => void
  onPointerUp?: (node: PopupRenderNode, event: PointerEvent) => void
  onPointerCancel?: (node: PopupRenderNode, event: PointerEvent) => void
  onWheel?: (node: PopupRenderNode, event: WheelPointerEvent) => boolean | void
}

export class PopupRenderNode extends BaseRenderObject implements InteractiveRenderObject {
  private readonly _options: PopupRenderNodeOptions

  constructor(options: PopupRenderNodeOptions) {
    super()
    this._options = options
  }

  override performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    if (this._options.layout) {
      this._options.layout(this, constraints, context)
      return
    }
    this.size = constrainSize(constraints, {
      width: constraints.maxWidth,
      height: constraints.maxHeight,
    })
  }

  override performPaint(context: PaintContext, offset: Offset): void {
    this._options.paint(this, context, offset)
  }

  override visitChildren(visitor: (child: RenderObject) => void): void {
    this._options.visitChildren?.(this, visitor)
  }

  onPointerDown(event: PointerEvent): void {
    this._options.onPointerDown?.(this, event)
  }

  onPointerEnter(event: PointerEvent): void {
    this._options.onPointerEnter?.(this, event)
  }

  onPointerLeave(event: PointerEvent): void {
    this._options.onPointerLeave?.(this, event)
  }

  onPointerMove(event: PointerEvent): void {
    this._options.onPointerMove?.(this, event)
  }

  onPointerUp(event: PointerEvent): void {
    this._options.onPointerUp?.(this, event)
  }

  onPointerCancel(event: PointerEvent): void {
    this._options.onPointerCancel?.(this, event)
  }

  onWheel(event: WheelPointerEvent): boolean | void {
    return this._options.onWheel ? this._options.onWheel(this, event) : false
  }
}

export type PopupRenderSurfaceSync = (root: RenderObject, popupContext: PopupContext) => void

export class PopupRenderSurface {
  private readonly _host: PopupRenderHost
  private _root: RenderObject | null
  private _sync?: PopupRenderSurfaceSync

  constructor(
    root?: RenderObject | null,
    sync?: PopupRenderSurfaceSync,
    setCursor?: (cursor: string) => void,
  ) {
    this._root = root ?? null
    this._sync = sync
    this._host = new PopupRenderHost(this._root, setCursor)
  }

  get root(): RenderObject | null {
    return this._root
  }

  get hasActivePointerInteraction(): boolean {
    return this._host.hasActivePointerInteraction
  }

  setRoot(root: RenderObject | null): void {
    if (this._root === root) return
    this._root = root
    this._host.setRoot(root)
  }

  setSync(sync?: PopupRenderSurfaceSync): void {
    this._sync = sync
  }

  hitTest(point: Offset, popupContext: PopupContext): boolean {
    this._syncRoot(popupContext)
    if (!this._root) return false
    return this._root.hitTestPath(point, new HitTestResult())
  }

  handlePointerDown(event: PointerEvent, popupContext: PopupContext): boolean {
    this._syncRoot(popupContext)
    return this._host.handlePointerDown(event)
  }

  handlePointerMove(event: PointerEvent, popupContext: PopupContext): boolean {
    this._syncRoot(popupContext)
    return this._host.handlePointerMove(event)
  }

  handlePointerUp(event: PointerEvent, popupContext: PopupContext): boolean {
    this._syncRoot(popupContext)
    return this._host.handlePointerUp(event)
  }

  handlePointerCancel(event: PointerEvent, popupContext: PopupContext): boolean {
    this._syncRoot(popupContext)
    return this._host.handlePointerCancel(event)
  }

  handlePointerLeave(event: PointerEvent, popupContext: PopupContext): boolean {
    this._syncRoot(popupContext)
    return this._host.handlePointerLeave(event)
  }

  handleWheel(event: WheelPointerEvent, popupContext: PopupContext): boolean {
    this._syncRoot(popupContext)
    return this._host.handleWheel(event)
  }

  paint(context: PaintContext, popupContext: PopupContext): void {
    this._syncRoot(popupContext)
    this._root?.paint(context, this._root.offset)
    this._host.flushAfterFullPaint(context)
  }

  reset(): void {
    this._host.reset()
  }

  dispose(): void {
    this._host.dispose()
    this._root = null
    this._sync = undefined
  }

  private _syncRoot(popupContext: PopupContext): void {
    if (!this._root) return
    this._host.setTheme(popupContext.theme)
    this._sync?.(this._root, popupContext)
  }
}
