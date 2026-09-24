// RenderBox: Box Constraint 协议基类
// 父传约束 → 子返尺寸，单向数据流

import {
  RenderObject,
  type BoxConstraints,
  type LayoutContext,
  type Offset,
  type Rect,
  type Size,
  constrainSize,
} from '../core/render_object'
import { HitTestResult } from '../gestures/hit_test'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'

export type TooltipContent = string | (() => RenderBox)

export interface EdgeInsets {
  left: number
  right: number
  top: number
  bottom: number
}

export interface EdgeInsetsInputObject {
  left?: number
  right?: number
  top?: number
  bottom?: number
  horizontal?: number
  vertical?: number
}

export type EdgeInsetsInput = number | EdgeInsetsInputObject

export type BoxAlignment = 'start' | 'center' | 'end' | 'stretch'

export interface RenderBoxOptions {
  width?: number
  height?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  margin?: EdgeInsetsInput
  horizontalAlignment?: BoxAlignment
  verticalAlignment?: BoxAlignment
}

export interface RenderPanelOptions extends RenderBoxOptions {
  padding?: EdgeInsetsInput
}

export function normalizeEdgeInsets(insets?: EdgeInsetsInput): EdgeInsets {
  if (typeof insets === 'number') {
    return { left: insets, right: insets, top: insets, bottom: insets }
  }
  const horizontal = insets?.horizontal ?? 0
  const vertical = insets?.vertical ?? 0
  return {
    left: insets?.left ?? horizontal,
    right: insets?.right ?? horizontal,
    top: insets?.top ?? vertical,
    bottom: insets?.bottom ?? vertical,
  }
}
function insetsEqual(left: EdgeInsets, right: EdgeInsets): boolean {
  return left.left === right.left && left.right === right.right &&
    left.top === right.top && left.bottom === right.bottom
}

function normalizeOptionalExtent(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.max(0, value)
}

export abstract class RenderBox extends RenderObject {
  static override debugTypeName = 'RenderBox'
  // 声明式 tooltip：设置后 EventDispatcher 自动处理 show/hide
  tooltip?: TooltipContent
  tooltipDelay?: number
  private _adorners: RenderBox[] = []
  private _layoutWidth?: number
  private _layoutHeight?: number
  private _layoutMinWidth?: number
  private _layoutMaxWidth?: number
  private _layoutMinHeight?: number
  private _layoutMaxHeight?: number
  private _layoutMargin: EdgeInsets = normalizeEdgeInsets()
  private _layoutHorizontalAlignment?: BoxAlignment
  private _layoutVerticalAlignment?: BoxAlignment

  constructor(options: RenderBoxOptions = {}) {
    super()
    this._layoutWidth = normalizeOptionalExtent(options.width)
    this._layoutHeight = normalizeOptionalExtent(options.height)
    this._layoutMinWidth = normalizeOptionalExtent(options.minWidth)
    this._layoutMaxWidth = normalizeOptionalExtent(options.maxWidth)
    this._layoutMinHeight = normalizeOptionalExtent(options.minHeight)
    this._layoutMaxHeight = normalizeOptionalExtent(options.maxHeight)
    this._layoutMargin = normalizeEdgeInsets(options.margin)
    this._layoutHorizontalAlignment = options.horizontalAlignment
    this._layoutVerticalAlignment = options.verticalAlignment
  }

  get width(): number | undefined { return this._layoutWidth }
  set width(value: number | undefined) { this._setExtent('_layoutWidth', value) }

  get height(): number | undefined { return this._layoutHeight }
  set height(value: number | undefined) { this._setExtent('_layoutHeight', value) }

  get minWidth(): number | undefined { return this._layoutMinWidth }
  set minWidth(value: number | undefined) { this._setExtent('_layoutMinWidth', value) }

  get maxWidth(): number | undefined { return this._layoutMaxWidth }
  set maxWidth(value: number | undefined) { this._setExtent('_layoutMaxWidth', value) }

  get minHeight(): number | undefined { return this._layoutMinHeight }
  set minHeight(value: number | undefined) { this._setExtent('_layoutMinHeight', value) }

  get maxHeight(): number | undefined { return this._layoutMaxHeight }
  set maxHeight(value: number | undefined) { this._setExtent('_layoutMaxHeight', value) }

  get margin(): EdgeInsets { return this._layoutMargin }
  set margin(value: EdgeInsetsInput) {
    const next = normalizeEdgeInsets(value)
    if (insetsEqual(this._layoutMargin, next)) return
    this._layoutMargin = next
    this.markNeedsLayout()
  }

  get horizontalAlignment(): BoxAlignment | undefined { return this._layoutHorizontalAlignment }
  set horizontalAlignment(value: BoxAlignment | undefined) {
    if (this._layoutHorizontalAlignment === value) return
    this._layoutHorizontalAlignment = value
    this.markNeedsLayout()
  }

  get verticalAlignment(): BoxAlignment | undefined { return this._layoutVerticalAlignment }
  set verticalAlignment(value: BoxAlignment | undefined) {
    if (this._layoutVerticalAlignment === value) return
    this._layoutVerticalAlignment = value
    this.markNeedsLayout()
  }

  get outerSize(): Size {
    if (!this.contributesOuterLayoutSpace) return { width: 0, height: 0 }
    return {
      width: this.size.width + this._layoutMargin.left + this._layoutMargin.right,
      height: this.size.height + this._layoutMargin.top + this._layoutMargin.bottom,
    }
  }

  get participatesInLayout(): boolean {
    return this.contributesOuterLayoutSpace
  }

  override layout(constraints: BoxConstraints, parentUsesSize = false, context?: LayoutContext): void {
    const resolved = this._resolveBoxConstraints(constraints)
    super.layout(resolved, parentUsesSize, context)
    if (this.visible) this.size = this._constrainOwnSize(resolved, this.size)
  }

  override measure(constraints: BoxConstraints, context?: LayoutContext): Size {
    const resolved = this._resolveBoxConstraints(constraints)
    const measured = super.measure(resolved, context)
    return this.visible ? this._constrainOwnSize(resolved, measured) : measured
  }

  measureOuter(constraints: BoxConstraints, context?: LayoutContext): Size {
    const size = this.measure(constraints, context)
    if (!this.contributesOuterLayoutSpace) return { width: 0, height: 0 }
    return {
      width: size.width + this._layoutMargin.left + this._layoutMargin.right,
      height: size.height + this._layoutMargin.top + this._layoutMargin.bottom,
    }
  }

  resolveHorizontalAlignment(fallback: BoxAlignment): BoxAlignment {
    return this._layoutHorizontalAlignment ?? fallback
  }

  resolveVerticalAlignment(fallback: BoxAlignment): BoxAlignment {
    return this._layoutVerticalAlignment ?? fallback
  }

  protected get contributesOuterLayoutSpace(): boolean {
    return this.visible
  }

  protected get appliesOwnBoxConstraints(): boolean {
    return true
  }

  protected setWidthDuringLayout(value: number | undefined): void {
    this._layoutWidth = normalizeOptionalExtent(value)
  }

  protected setHeightDuringLayout(value: number | undefined): void {
    this._layoutHeight = normalizeOptionalExtent(value)
  }

  positionInSlot(
    slot: Rect,
    horizontalAlignment: BoxAlignment,
    verticalAlignment: BoxAlignment,
  ): void {
    const availableWidth = Math.max(0, slot.width - this._layoutMargin.left - this._layoutMargin.right)
    const availableHeight = Math.max(0, slot.height - this._layoutMargin.top - this._layoutMargin.bottom)
    this.offset = {
      x: slot.x + this._layoutMargin.left + this._alignmentOffset(availableWidth, this.size.width, horizontalAlignment),
      y: slot.y + this._layoutMargin.top + this._alignmentOffset(availableHeight, this.size.height, verticalAlignment),
    }
  }

  private _setExtent(
    key: '_layoutWidth' | '_layoutHeight' | '_layoutMinWidth' | '_layoutMaxWidth' | '_layoutMinHeight' | '_layoutMaxHeight',
    value: number | undefined,
  ): void {
    const next = normalizeOptionalExtent(value)
    if (this[key] === next) return
    this[key] = next
    this.markNeedsLayout()
  }

  private _resolveBoxConstraints(constraints: BoxConstraints): BoxConstraints {
    const horizontalMargin = this._layoutMargin.left + this._layoutMargin.right
    const verticalMargin = this._layoutMargin.top + this._layoutMargin.bottom
    const available: BoxConstraints = {
      minWidth: Math.max(0, constraints.minWidth - horizontalMargin),
      maxWidth: constraints.maxWidth === Infinity ? Infinity : Math.max(0, constraints.maxWidth - horizontalMargin),
      minHeight: Math.max(0, constraints.minHeight - verticalMargin),
      maxHeight: constraints.maxHeight === Infinity ? Infinity : Math.max(0, constraints.maxHeight - verticalMargin),
    }
    if (!this.appliesOwnBoxConstraints) return available
    const width = this._resolveAxisConstraints(
      available.minWidth,
      available.maxWidth,
      this._layoutWidth,
      this._layoutMinWidth,
      this._layoutMaxWidth,
    )
    const height = this._resolveAxisConstraints(
      available.minHeight,
      available.maxHeight,
      this._layoutHeight,
      this._layoutMinHeight,
      this._layoutMaxHeight,
    )
    return { minWidth: width.min, maxWidth: width.max, minHeight: height.min, maxHeight: height.max }
  }

  private _constrainOwnSize(constraints: BoxConstraints, size: Size): Size {
    if (!this.appliesOwnBoxConstraints) return size
    const width = Math.max(constraints.minWidth, size.width)
    const height = Math.max(constraints.minHeight, size.height)
    return {
      width: this._layoutWidth !== undefined || this._layoutMinWidth !== undefined || this._layoutMaxWidth !== undefined
        ? Math.min(constraints.maxWidth, width)
        : width,
      height: this._layoutHeight !== undefined || this._layoutMinHeight !== undefined || this._layoutMaxHeight !== undefined
        ? Math.min(constraints.maxHeight, height)
        : height,
    }
  }

  private _resolveAxisConstraints(
    parentMin: number,
    parentMax: number,
    desired: number | undefined,
    ownMin: number | undefined,
    ownMax: number | undefined,
  ): { min: number; max: number } {
    let max = Math.max(parentMin, Math.min(parentMax, ownMax ?? Infinity))
    let min = Math.min(max, Math.max(parentMin, ownMin ?? 0))
    if (desired !== undefined && parentMin !== parentMax) {
      const resolved = Math.max(min, Math.min(max, desired))
      min = resolved
      max = resolved
    }
    return { min, max }
  }

  private _alignmentOffset(available: number, actual: number, alignment: BoxAlignment): number {
    if (alignment === 'center') return Math.max(0, (available - actual) / 2)
    if (alignment === 'end') return Math.max(0, available - actual)
    return 0
  }

  getMinLayoutWidthHint(): number | undefined {
    return undefined
  }

  // 子类实现布局，设置 this.size
  abstract performLayout(constraints: BoxConstraints, context: LayoutContext): void

  // 默认绘制：遍历子节点
  performPaint(context: PaintContext, offset: Offset): void {
    this.paintContentChildren(context, offset)
    this.paintAdornerChildren(context, offset)
  }

  protected get supportsAdorners(): boolean {
    return false
  }

  canHostAdorners(): boolean {
    return this.supportsAdorners
  }

  addAdorner(adorner: RenderBox): void {
    if (!this.supportsAdorners) {
      throw new Error(`${this.constructor.name} does not support adorners.`)
    }
    if (this._adorners.includes(adorner)) return
    if (adorner.parent && adorner.parent instanceof RenderBox) {
      ;(adorner.parent as RenderBox).removeAdorner(adorner)
    }
    this._adorners.push(adorner)
    adorner.parent = this
    if (this.owner && adorner.owner !== this.owner) adorner.attach(this.owner)
    this.markNeedsPaint()
  }

  removeAdorner(adorner: RenderBox): void {
    const index = this._adorners.indexOf(adorner)
    if (index < 0) return
    this._adorners.splice(index, 1)
    adorner.parent = undefined
    if (adorner.owner) adorner.detach()
    this.markNeedsPaint()
  }

  clearAdorners(): void {
    for (const adorner of [...this._adorners]) this.removeAdorner(adorner)
  }

  visitAdornerChildren(visitor: (child: RenderObject) => void): void {
    for (const adorner of this._adorners) visitor(adorner)
  }

  protected visitManagedChildren(visitor: (child: RenderObject) => void, visitContent: () => void): void {
    visitContent()
    this.visitAdornerChildren(visitor)
  }

  protected paintContentChildren(context: PaintContext, offset: Offset): void {
    this.visitContentChildren(child => {
      const box = child as RenderBox
      box.prepareForRenderOrHitTest()
      box.paint(context, {
        x: offset.x + box.offset.x,
        y: offset.y + box.offset.y,
      })
    })
  }

  protected paintAdornerChildren(context: PaintContext, offset: Offset): void {
    this.visitAdornerChildren(child => {
      const box = child as RenderBox
      box.prepareForRenderOrHitTest()
      box.paint(context, {
        x: offset.x + box.offset.x,
        y: offset.y + box.offset.y,
      })
    })
  }

  override prepareForRenderOrHitTest(): void {
    this.visitAdornerChildren(child => child.prepareForRenderOrHitTest())
  }
}

export abstract class RenderPanel extends RenderBox {
  private _padding: EdgeInsets

  constructor(options: RenderPanelOptions = {}) {
    super(options)
    this._padding = normalizeEdgeInsets(options.padding)
  }

  get padding(): EdgeInsets { return this._padding }
  set padding(value: EdgeInsetsInput) {
    const next = normalizeEdgeInsets(value)
    if (insetsEqual(this._padding, next)) return
    this._padding = next
    this.markNeedsLayout()
  }

  protected get contentOffset(): Offset {
    return { x: this._padding.left, y: this._padding.top }
  }

  protected deflatePaddingConstraints(constraints: BoxConstraints): BoxConstraints {
    const horizontal = this._padding.left + this._padding.right
    const vertical = this._padding.top + this._padding.bottom
    return {
      minWidth: Math.max(0, constraints.minWidth - horizontal),
      maxWidth: constraints.maxWidth === Infinity ? Infinity : Math.max(0, constraints.maxWidth - horizontal),
      minHeight: Math.max(0, constraints.minHeight - vertical),
      maxHeight: constraints.maxHeight === Infinity ? Infinity : Math.max(0, constraints.maxHeight - vertical),
    }
  }

  protected inflatePaddingSize(constraints: BoxConstraints, contentSize: Size): Size {
    return constrainSize(constraints, {
      width: contentSize.width + this._padding.left + this._padding.right,
      height: contentSize.height + this._padding.top + this._padding.bottom,
    })
  }

  protected get contentSize(): Size {
    return {
      width: Math.max(0, this.size.width - this._padding.left - this._padding.right),
      height: Math.max(0, this.size.height - this._padding.top - this._padding.bottom),
    }
  }
}

export interface ResolvedChildLayout {
  constraints: BoxConstraints
  horizontalAlignment: BoxAlignment
  verticalAlignment: BoxAlignment
}

export function resolveChildLayout(
  child: RenderBox,
  constraints: BoxConstraints,
  fallbackHorizontalAlignment: BoxAlignment,
  fallbackVerticalAlignment: BoxAlignment,
): ResolvedChildLayout {
  const horizontalAlignment = child.resolveHorizontalAlignment(fallbackHorizontalAlignment)
  const verticalAlignment = child.resolveVerticalAlignment(fallbackVerticalAlignment)
  return {
    constraints: {
      minWidth: horizontalAlignment === 'stretch' && child.width === undefined ? constraints.minWidth : 0,
      maxWidth: constraints.maxWidth,
      minHeight: verticalAlignment === 'stretch' && child.height === undefined ? constraints.minHeight : 0,
      maxHeight: constraints.maxHeight,
    },
    horizontalAlignment,
    verticalAlignment,
  }
}

export type VisibilityMode = 'visible' | 'hidden' | 'collapsed'

export class RenderVisibility extends RenderBox {
  static override debugTypeName = 'RenderVisibility'
  child?: RenderBox
  private _mode: VisibilityMode

  constructor(options: {
    mode?: VisibilityMode
    child?: RenderBox
  } = {}) {
    super()
    this._mode = options.mode ?? 'visible'
    this.child = options.child
    if (options.child) options.child.parent = this
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  get mode(): VisibilityMode { return this._mode }
  set mode(value: VisibilityMode) {
    if (this._mode === value) return
    this._mode = value
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  protected override get contributesOuterLayoutSpace(): boolean {
    return super.contributesOuterLayoutSpace && this._mode !== 'collapsed'
  }

  setChild(child?: RenderBox): void {
    if (this.child === child) return
    if (this.child) {
      this.child.parent = undefined
      if (this.child.owner) this.child.detach()
    }
    this.child = child
    if (child) {
      child.parent = this
      if (this.owner && child.owner !== this.owner) child.attach(this.owner)
    }
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this.child) visitor(this.child)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this.child) visitor(this.child)
  }

  override visitFocusChildren(visitor: (child: RenderObject) => void): void {
    if (this._mode === 'visible' && this.child) visitor(this.child)
    this.visitAdornerChildren(visitor)
  }

  override isFocusChildActive(child: RenderObject): boolean {
    if (child === this.child) return this._mode === 'visible' && child.visible
    return super.isFocusChildActive(child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    if (!this.child || !this.child.visible || this._mode === 'collapsed') {
      this.size = { width: 0, height: 0 }
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
    if (this._mode === 'visible') super.performPaint(context, offset)
    else this.paintAdornerChildren(context, offset)
  }

  override hitTest(_point: Offset): boolean {
    if (this._mode !== 'visible') return false
    return super.hitTest(_point)
  }

  override hitTestPath(point: Offset, result: HitTestResult): boolean {
    if (this._mode !== 'visible') return false
    return super.hitTestPath(point, result)
  }

  override hitTestChildren(_point: Offset, _result: RenderObject[]): boolean {
    if (this._mode !== 'visible') return false
    return super.hitTestChildren(_point, _result)
  }
}

export class RenderClip extends RenderBox {
  static override debugTypeName = 'RenderClip'
  child?: RenderBox
  cornerRadius: number

  constructor(childOrOptions?: RenderBox | {
    child?: RenderBox
    cornerRadius?: number
  }) {
    super()
    if (childOrOptions instanceof RenderBox) {
      this.child = childOrOptions
      this.cornerRadius = 0
    } else {
      this.child = childOrOptions?.child
      this.cornerRadius = childOrOptions?.cornerRadius ?? 0
    }
    if (this.child) this.child.parent = this
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  setChild(child?: RenderBox): void {
    if (this.child === child) return
    if (this.child) {
      this.child.parent = undefined
      if (this.child.owner) this.child.detach()
    }
    this.child = child
    if (child) {
      child.parent = this
      if (this.owner && child.owner !== this.owner) child.attach(this.owner)
    }
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this.child) visitor(this.child)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this.child) visitor(this.child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    if (!this.child?.participatesInLayout) {
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
    const dl = new DrawList(context)
    if (this.cornerRadius > 0) {
      const ctx = context.ctx
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(offset.x, offset.y, this.size.width, this.size.height, this.cornerRadius)
      ctx.clip()
    } else {
      dl.pushClip(offset.x, offset.y, this.size.width, this.size.height)
    }
    this.paintContentChildren(context, offset)
    if (this.cornerRadius > 0) context.ctx.restore()
    else dl.popClip()
    this.paintAdornerChildren(context, offset)
  }

  override hitTestPath(point: Offset, result: HitTestResult): boolean {
    if (this.hitTest(point)) return super.hitTestPath(point, result)

    const adornerChildren: RenderObject[] = []
    this.visitAdornerChildren(child => adornerChildren.push(child))
    for (let index = adornerChildren.length - 1; index >= 0; index -= 1) {
      const child = adornerChildren[index]!
      child.prepareForRenderOrHitTest()
      if (child.hitTestPath(point, result)) return true
    }
    return false
  }
}
