import {
  APP_CONTEXT_PROVIDER,
  AppContextRegistry,
  type AppContextInitialValues,
} from '../core/app_context'
import { constrainSize, type BoxConstraints, type LayoutContext, type Offset, type RenderObject } from '../core/render_object'
import type { PaintContext } from '../rendering/paint_context'
import { RenderBox, resolveChildLayout } from './render_box'

export interface RenderAppContextScopeOptions {
  context?: AppContextRegistry
  values?: Exclude<AppContextInitialValues, AppContextRegistry>
  child?: RenderBox
  disposeContextOnDispose?: boolean
}

export class RenderAppContextScope extends RenderBox {
  static override debugTypeName = 'RenderAppContextScope'
  readonly appContext: AppContextRegistry
  child?: RenderBox

  private readonly _disposeContextOnDispose: boolean

  constructor(options: RenderAppContextScopeOptions = {}) {
    super()
    this.appContext = options.context ?? new AppContextRegistry(undefined, options.values)
    if (options.context && options.values) {
      const values = new AppContextRegistry(undefined, options.values)
      for (const key of values.keys()) this.appContext.set(key as never, values.get(key as never))
      values.dispose()
    }
    this.child = options.child
    this._disposeContextOnDispose = options.disposeContextOnDispose ?? options.context === undefined
    if (this.child) this.child.parent = this
  }

  [APP_CONTEXT_PROVIDER](): AppContextRegistry {
    return this.appContext
  }

  setChild(child?: RenderBox): void {
    if (this.child === child) return
    const previous = this.child
    this.child = child
    if (previous) previous.parent = undefined
    if (child) {
      child.parent = this
      if (this.owner && child.owner !== this.owner) child.attach(this.owner)
    }
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    if (this.child) visitor(this.child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    if (!this.child) {
      this.size = constrainSize(constraints, { width: 0, height: 0 })
      return
    }
    const layout = resolveChildLayout(this.child, constraints, 'stretch', 'stretch')
    this.child.layout(layout.constraints, true, context)
    this.size = constrainSize(constraints, this.child.outerSize)
    this.child.positionInSlot(
      { x: 0, y: 0, width: this.size.width, height: this.size.height },
      layout.horizontalAlignment,
      layout.verticalAlignment,
    )
  }

  performPaint(context: PaintContext, offset: Offset): void {
    if (!this.child) return
    this.child.paint(context, {
      x: offset.x + this.child.offset.x,
      y: offset.y + this.child.offset.y,
    })
  }

  override dispose(): void {
    try {
      super.dispose()
    } finally {
      if (this._disposeContextOnDispose) this.appContext.dispose()
    }
  }
}
