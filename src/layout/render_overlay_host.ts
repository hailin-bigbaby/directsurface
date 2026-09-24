import { RenderObject, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import {
  RenderBox,
  normalizeEdgeInsets,
  type EdgeInsets,
  type EdgeInsetsInput,
  type RenderBoxOptions,
} from './render_box'
import { HitTestResult, isPrimaryPointerButton, type HitTestTarget, type PointerEvent } from '../gestures/hit_test'
import type { InteractiveRenderObject } from '../gestures/recognizers'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { resolveThemeElevation, type Color } from '../theme/theme'

export interface OverlayPanelOptions {
  child: RenderBox
  closeOnScrimPointerDown?: boolean
  onRequestClose?: () => void
}

export interface RenderOverlayHostOptions extends RenderBoxOptions {
  base?: RenderBox
  overlay?: OverlayPanelOptions
  scrimColor?: Color
  overlayInset?: EdgeInsetsInput
}

export class RenderOverlayHost extends RenderBox implements InteractiveRenderObject {
  static override debugTypeName = 'RenderOverlayHost'
  base?: RenderBox
  overlay?: OverlayPanelOptions
  private _scrimColorOverride?: Color
  private _overlayInset: EdgeInsets

  constructor(options: RenderOverlayHostOptions = {}) {
    super(options)
    this.base = options.base
    this.overlay = options.overlay
    this._scrimColorOverride = options.scrimColor
    this._overlayInset = normalizeEdgeInsets(options.overlayInset ?? 32)
    if (this.base) this.base.parent = this
    if (this.overlay) this.overlay.child.parent = this
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  get overlayInset(): EdgeInsets { return this._overlayInset }
  set overlayInset(value: EdgeInsetsInput) {
    this._overlayInset = normalizeEdgeInsets(value)
    this.markNeedsLayout()
  }

  get scrimColor(): Color {
    return this._scrimColorOverride ?? resolveThemeElevation(this.currentTheme).modalScrim
  }

  set scrimColor(value: Color) {
    this._scrimColorOverride = value
    this.markNeedsPaint()
  }

  setBase(base?: RenderBox): void {
    if (this.base === base) return
    if (this.base) {
      this.base.parent = undefined
      if (this.base.owner) this.base.detach()
    }
    this.base = base
    if (base) {
      base.parent = this
      if (this.owner && base.owner !== this.owner) base.attach(this.owner)
    }
    this.markNeedsLayout()
  }

  setOverlay(overlay?: OverlayPanelOptions): void {
    if (this.overlay?.child === overlay?.child) {
      this.overlay = overlay
      this.markNeedsLayout()
      this.markNeedsPaint()
      return
    }
    if (this.overlay) {
      this.overlay.child.parent = undefined
      if (this.overlay.child.owner) this.overlay.child.detach()
    }
    this.overlay = overlay
    if (overlay) {
      overlay.child.parent = this
      if (this.owner && overlay.child.owner !== this.owner) overlay.child.attach(this.owner)
    }
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  clearOverlay(options: { dispose?: boolean } = {}): void {
    const overlay = this.overlay
    if (!overlay) return
    this.overlay = undefined
    overlay.child.parent = undefined
    if (overlay.child.owner) overlay.child.detach()
    if (options.dispose) overlay.child.dispose()
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this.base) visitor(this.base)
      if (this.overlay) visitor(this.overlay.child)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this.base) visitor(this.base)
    if (this.overlay) visitor(this.overlay.child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? Math.max(constraints.minWidth, 0) : constraints.maxWidth
    const height = constraints.maxHeight === Infinity ? Math.max(constraints.minHeight, 0) : constraints.maxHeight
    this.size = { width, height }

    this.base?.layout({
      minWidth: width,
      maxWidth: width,
      minHeight: height,
      maxHeight: height,
    }, true, context)
    this.base?.positionInSlot(
      { x: 0, y: 0, width, height },
      this.base.resolveHorizontalAlignment('stretch'),
      this.base.resolveVerticalAlignment('stretch'),
    )

    if (this.overlay) this._layoutOverlay(this.overlay, context)
  }

  performPaint(context: PaintContext, offset: Offset): void {
    if (this.base) {
      this.base.prepareForRenderOrHitTest()
      this.base.paint(context, { x: offset.x + this.base.offset.x, y: offset.y + this.base.offset.y })
    }
    if (!this.overlay) {
      this.paintAdornerChildren(context, offset)
      return
    }

    const dl = new DrawList(context)
    const scrimColor = this._scrimColorOverride ?? resolveThemeElevation(context.theme).modalScrim
    dl.fillRect(offset.x, offset.y, this.size.width, this.size.height, scrimColor, 0)
    const child = this.overlay.child
    child.prepareForRenderOrHitTest()
    child.paint(context, { x: offset.x + child.offset.x, y: offset.y + child.offset.y })
    this.paintAdornerChildren(context, offset)
  }

  override hitTestPath(point: Offset, result: HitTestResult): boolean {
    if (!this.overlay) return super.hitTestPath(point, result)
    if (!this.hitTest(point)) return false

    const overlayResult = new HitTestResult()
    this.overlay.child.prepareForRenderOrHitTest()
    const overlayHit = this.overlay.child.hitTestPath(point, overlayResult)
    const globalOffset = this.globalOffset
    result.add({
      target: this as unknown as HitTestTarget,
      localPosition: { x: point.x - globalOffset.x, y: point.y - globalOffset.y },
    })
    if (overlayHit) {
      for (const entry of overlayResult.path) result.add(entry)
    }
    return true
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event) || !this.overlay) return
    const overlay = this.overlay
    if (overlay.child.hitTest(event.position)) return
    if (overlay.closeOnScrimPointerDown === false) return
    overlay.onRequestClose?.()
  }

  private _layoutOverlay(overlay: OverlayPanelOptions, context: LayoutContext): void {
    const availableWidth = Math.max(0, this.size.width - this._overlayInset.left - this._overlayInset.right)
    const availableHeight = Math.max(0, this.size.height - this._overlayInset.top - this._overlayInset.bottom)
    const horizontalAlignment = overlay.child.resolveHorizontalAlignment('center')
    const verticalAlignment = overlay.child.resolveVerticalAlignment('center')

    overlay.child.layout({
      minWidth: horizontalAlignment === 'stretch' && overlay.child.width === undefined ? availableWidth : 0,
      maxWidth: availableWidth,
      minHeight: verticalAlignment === 'stretch' && overlay.child.height === undefined ? availableHeight : 0,
      maxHeight: availableHeight,
    }, true, context)

    overlay.child.positionInSlot({
      x: this._overlayInset.left,
      y: this._overlayInset.top,
      width: availableWidth,
      height: availableHeight,
    }, horizontalAlignment, verticalAlignment)
  }
}
