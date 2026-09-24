import { HitTestResult, type HitTestTarget } from '../gestures/hit_test'
import { RenderBox, resolveChildLayout } from '../layout/render_box'
import type { BoxConstraints, LayoutContext, Offset, RenderObject } from '../core/render_object'
import type { PaintContext } from '../rendering/paint_context'
import { LoadingOverlayController } from './loading_overlay'

export interface RenderLoadingHostOptions {
  child: RenderBox
  loading?: boolean
  text?: string
  blockInput?: boolean
}

export class RenderLoadingHost extends RenderBox {
  static override debugTypeName = 'RenderLoadingHost'
  private _child: RenderBox
  private readonly _overlay = new LoadingOverlayController(
    () => this.markNeedsPaint(),
  )
  blockInput: boolean

  constructor(options: RenderLoadingHostOptions) {
    super()
    this._child = options.child
    this._child.parent = this
    this.blockInput = options.blockInput ?? true
    this._overlay.setText(options.text)
    if (options.loading) this._overlay.setLoading(true)
  }

  get child(): RenderBox {
    return this._child
  }

  get loading(): boolean {
    return this._overlay.loading
  }

  set loading(value: boolean) {
    this.setLoading(value)
  }

  get text(): string | undefined {
    return this._overlay.text
  }

  set text(value: string | undefined) {
    this.setLoadingText(value)
  }

  setChild(child: RenderBox): void {
    if (this._child === child) return
    const previous = this._child
    previous.parent = undefined
    if (previous.owner) previous.detach()
    this._child = child
    child.parent = this
    if (this.owner && child.owner !== this.owner) child.attach(this.owner)
    this.markNeedsLayout()
  }

  setLoading(loading: boolean, text?: string): void {
    this._overlay.setLoading(loading, text)
  }

  setLoadingText(text?: string): void {
    this._overlay.setText(text)
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    visitor(this._child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const layout = resolveChildLayout(this._child, constraints, 'stretch', 'stretch')
    this._child.layout(layout.constraints, true, context)
    this.size = { ...this._child.outerSize }
    this._child.positionInSlot(
      { x: 0, y: 0, width: this.size.width, height: this.size.height },
      layout.horizontalAlignment,
      layout.verticalAlignment,
    )
  }

  performPaint(context: PaintContext, offset: Offset): void {
    super.performPaint(context, offset)
    this._overlay.paint(context, offset, this.size)
  }

  override hitTestPath(point: Offset, result: HitTestResult): boolean {
    if (!this._overlay.loading || !this.blockInput) return super.hitTestPath(point, result)
    if (!this.hitTest(point)) return false
    const g = this.globalOffset
    result.add({
      target: this as unknown as HitTestTarget,
      localPosition: { x: point.x - g.x, y: point.y - g.y },
    })
    return true
  }

  override hitTestChildren(point: Offset, result: RenderObject[]): boolean {
    if (this._overlay.loading && this.blockInput && this.hitTest(point)) return false
    return super.hitTestChildren(point, result)
  }

  override dispose(): void {
    this._overlay.dispose()
    super.dispose()
  }
}
