import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import type { ScrollViewport, ScrollViewportClient } from '../core/scroll_viewport_client'
import { RenderBox, RenderPanel, type BoxAlignment, type RenderPanelOptions } from './render_box'
import type { PaintContext } from '../rendering/paint_context'
import { deriveLayoutStyle } from '../theme/component_styles'

export type MasonryHorizontalAlignment = BoxAlignment

interface MasonryPlacement {
  child: RenderBox
  x: number
  y: number
}

export interface MasonryPanelOptions extends RenderPanelOptions {
  columnCount?: number
  columnGap?: number
  rowGap?: number
  itemHorizontalAlignment?: MasonryHorizontalAlignment
}

export class RenderMasonryPanel extends RenderPanel implements ScrollViewportClient {
  static override debugTypeName = 'RenderMasonryPanel'
  children: RenderBox[] = []
  private _columnCount: number
  private _columnGap?: number
  private _rowGap?: number
  private _itemHorizontalAlignment: MasonryHorizontalAlignment
  private _scrollViewport?: ScrollViewport
  private _lastPaintedChildCount = 0

  constructor(options: MasonryPanelOptions = {}) {
    super(options)
    this._columnCount = normalizeColumnCount(options.columnCount)
    this._columnGap = options.columnGap
    this._rowGap = options.rowGap
    this._itemHorizontalAlignment = options.itemHorizontalAlignment ?? 'stretch'
  }

  get columnCount(): number { return this._columnCount }
  set columnCount(value: number) {
    const next = normalizeColumnCount(value)
    if (this._columnCount === next) return
    this._columnCount = next
    this.markNeedsLayout()
  }

  get columnGap(): number { return this._columnGap ?? 0 }
  set columnGap(value: number) {
    if (this._columnGap === value) return
    this._columnGap = value
    this.markNeedsLayout()
  }

  get rowGap(): number { return this._rowGap ?? 0 }
  set rowGap(value: number) {
    if (this._rowGap === value) return
    this._rowGap = value
    this.markNeedsLayout()
  }

  get itemHorizontalAlignment(): MasonryHorizontalAlignment { return this._itemHorizontalAlignment }
  set itemHorizontalAlignment(value: MasonryHorizontalAlignment) {
    if (this._itemHorizontalAlignment === value) return
    this._itemHorizontalAlignment = value
    this.markNeedsLayout()
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  addChild(child: RenderBox): void {
    child.parent = this
    this.children.push(child)
    this.markNeedsLayout()
  }

  clearChildren(): void {
    for (const child of this.children) {
      child.parent = undefined
      if (child.owner) child.detach()
    }
    this.children = []
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      for (const child of this.children) visitor(child)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    for (const child of this.children) visitor(child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const contentConstraints = this.deflatePaddingConstraints(constraints)
    const layoutStyle = deriveLayoutStyle(context.theme)
    const columnGap = this._columnGap ?? layoutStyle.itemSpacing
    const rowGap = this._rowGap ?? layoutStyle.itemSpacing
    const columnCount = this._columnCount
    const width = this._resolveWidth(contentConstraints, columnCount, columnGap, context)
    const columnWidth = columnCount > 0
      ? Math.max(0, (width - Math.max(0, columnCount - 1) * columnGap) / columnCount)
      : 0
    const columnHeights = new Array(columnCount).fill(0) as number[]
    const placements: MasonryPlacement[] = []

    for (const child of this.children.filter(child => child.participatesInLayout)) {
      const columnIndex = this._shortestColumnIndex(columnHeights)
      const columnX = columnIndex * (columnWidth + columnGap)
      const horizontalAlignment = child.resolveHorizontalAlignment(this._itemHorizontalAlignment)
      const childConstraints = this._childConstraints(child, columnWidth, horizontalAlignment)
      child.layout(childConstraints, true, context)
      const x = columnX
      const y = columnHeights[columnIndex]! > 0 ? columnHeights[columnIndex]! + rowGap : 0
      placements.push({ child, x, y })
      columnHeights[columnIndex] = y + child.outerSize.height
    }

    for (const placement of placements) {
      placement.child.positionInSlot({
        x: this.contentOffset.x + placement.x,
        y: this.contentOffset.y + placement.y,
        width: columnWidth,
        height: placement.child.outerSize.height,
      }, placement.child.resolveHorizontalAlignment(this._itemHorizontalAlignment), 'start')
    }

    const naturalHeight = columnHeights.reduce((max, height) => Math.max(max, height), 0)
    this.size = this.inflatePaddingSize(constraints, { width, height: naturalHeight })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const visibleRect = this._visibleContentRect()
    let painted = 0
    for (const child of this.children) {
      if (!child.visible) continue
      if (visibleRect && !rectsIntersect(
        child.offset.x,
        child.offset.y,
        child.size.width,
        child.size.height,
        visibleRect.x,
        visibleRect.y,
        visibleRect.width,
        visibleRect.height,
      )) continue
      child.prepareForRenderOrHitTest()
      child.paint(context, {
        x: offset.x + child.offset.x,
        y: offset.y + child.offset.y,
      })
      painted += 1
    }
    this._lastPaintedChildCount = painted
    this.paintAdornerChildren(context, offset)
  }

  setScrollViewport(viewport: ScrollViewport): void {
    const previous = this._scrollViewport
    this._scrollViewport = { ...viewport }
    if (
      previous?.viewWidth === viewport.viewWidth &&
      previous?.viewHeight === viewport.viewHeight &&
      previous?.scrollX === viewport.scrollX &&
      previous?.scrollY === viewport.scrollY
    ) return
    this.markNeedsPaint()
  }

  debugState(): {
    columnCount: number
    childCount: number
    lastPaintedChildCount: number
    scrollViewport?: ScrollViewport
  } {
    return {
      columnCount: this._columnCount,
      childCount: this.children.filter(child => child.participatesInLayout).length,
      lastPaintedChildCount: this._lastPaintedChildCount,
      scrollViewport: this._scrollViewport ? { ...this._scrollViewport } : undefined,
    }
  }

  private _resolveWidth(
    constraints: BoxConstraints,
    columnCount: number,
    columnGap: number,
    context: LayoutContext,
  ): number {
    if (constraints.maxWidth !== Infinity) return constraints.maxWidth
    const naturalColumnWidth = this.children.filter(child => child.participatesInLayout).reduce((max, child) => {
      const size = child.measureOuter({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity }, context)
      return Math.max(max, size.width)
    }, 0)
    const naturalWidth = columnCount * naturalColumnWidth + Math.max(0, columnCount - 1) * columnGap
    return Math.max(constraints.minWidth, naturalWidth)
  }

  private _childConstraints(
    child: RenderBox,
    columnWidth: number,
    horizontalAlignment: MasonryHorizontalAlignment,
  ): BoxConstraints {
    if (horizontalAlignment === 'stretch' && child.width === undefined) {
      return { minWidth: columnWidth, maxWidth: columnWidth, minHeight: 0, maxHeight: Infinity }
    }
    return { minWidth: 0, maxWidth: columnWidth, minHeight: 0, maxHeight: Infinity }
  }

  private _shortestColumnIndex(columnHeights: number[]): number {
    let columnIndex = 0
    for (let index = 1; index < columnHeights.length; index += 1) {
      if (columnHeights[index]! < columnHeights[columnIndex]!) columnIndex = index
    }
    return columnIndex
  }

  private _visibleContentRect(): { x: number; y: number; width: number; height: number } | null {
    if (!this._scrollViewport) return null
    return {
      x: this._scrollViewport.scrollX,
      y: this._scrollViewport.scrollY,
      width: this._scrollViewport.viewWidth,
      height: this._scrollViewport.viewHeight,
    }
  }
}

function normalizeColumnCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1
  return Math.max(1, Math.floor(value))
}

function rectsIntersect(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw &&
    ax + aw > bx &&
    ay < by + bh &&
    ay + ah > by
}
