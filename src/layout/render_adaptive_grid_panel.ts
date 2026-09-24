import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { RenderBox, RenderPanel, resolveChildLayout, type RenderPanelOptions } from './render_box'
import type { PaintContext } from '../rendering/paint_context'
import { deriveLayoutStyle } from '../theme/component_styles'

export interface AdaptiveGridPanelChildData {
  columnSpan?: number
}

interface AdaptiveGridPanelPlacement {
  row: number
  column: number
  columnSpan: number
}

export interface AdaptiveGridPanelOptions extends RenderPanelOptions {
  minColumnWidth: number
  maxColumns?: number
  minColumns?: number
  columnGap?: number
  rowGap?: number
}

export class RenderAdaptiveGridPanel extends RenderPanel {
  static override debugTypeName = 'RenderAdaptiveGridPanel'
  children: RenderBox[] = []
  childData = new Map<RenderBox, AdaptiveGridPanelChildData>()
  private _minColumnWidth: number
  private _maxColumns?: number
  private _minColumns: number
  private _columnGap?: number
  private _rowGap?: number

  constructor(options: AdaptiveGridPanelOptions) {
    super(options)
    this._minColumnWidth = Math.max(1, options.minColumnWidth)
    this._maxColumns = options.maxColumns
    this._minColumns = Math.max(1, options.minColumns ?? 1)
    this._columnGap = options.columnGap
    this._rowGap = options.rowGap
  }

  get minColumnWidth(): number { return this._minColumnWidth }
  set minColumnWidth(value: number) {
    const next = Math.max(1, value)
    if (this._minColumnWidth === next) return
    this._minColumnWidth = next
    this.markNeedsLayout()
  }

  get maxColumns(): number | undefined { return this._maxColumns }
  set maxColumns(value: number | undefined) {
    if (this._maxColumns === value) return
    this._maxColumns = value
    this.markNeedsLayout()
  }

  get minColumns(): number { return this._minColumns }
  set minColumns(value: number) {
    const next = Math.max(1, value)
    if (this._minColumns === next) return
    this._minColumns = next
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

  protected override get supportsAdorners(): boolean {
    return true
  }

  addChild(child: RenderBox, data: AdaptiveGridPanelChildData = {}): void {
    child.parent = this
    this.children.push(child)
    this.childData.set(child, data)
    this.markNeedsLayout()
  }

  clearChildren(): void {
    for (const child of this.children) {
      child.parent = undefined
      if (child.owner) child.detach()
    }
    this.children = []
    this.childData.clear()
    this.markNeedsLayout()
  }

  setChildData(child: RenderBox, data: AdaptiveGridPanelChildData): void {
    if (!this.children.includes(child)) return
    this.childData.set(child, data)
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
    const visibleChildren = this.children.filter(child => child.participatesInLayout)
    const columnCount = this._resolveColumnCount(contentConstraints, columnGap, visibleChildren.length)
    const width = this._resolveWidth(contentConstraints, columnCount, columnGap)
    const columnWidth = columnCount > 0
      ? Math.max(0, (width - Math.max(0, columnCount - 1) * columnGap) / columnCount)
      : 0
    const placements = this._resolvePlacements(columnCount, visibleChildren)
    const rowHeights: number[] = []

    for (let index = 0; index < visibleChildren.length; index += 1) {
      const child = visibleChildren[index]!
      const placement = placements[index]!
      const childWidth = this._spanExtent(columnWidth, placement.columnSpan, columnGap)
      const layout = resolveChildLayout(
        child,
        { minWidth: childWidth, maxWidth: childWidth, minHeight: 0, maxHeight: Infinity },
        'stretch',
        'start',
      )
      child.layout(layout.constraints, true, context)
      rowHeights[placement.row] = Math.max(rowHeights[placement.row] ?? 0, child.outerSize.height)
    }

    const rowOffsets: number[] = []
    let cursorY = 0
    for (let row = 0; row < rowHeights.length; row += 1) {
      rowOffsets[row] = cursorY
      cursorY += rowHeights[row] ?? 0
      if (row < rowHeights.length - 1) cursorY += rowGap
    }

    for (let index = 0; index < visibleChildren.length; index += 1) {
      const child = visibleChildren[index]!
      const placement = placements[index]!
      const childWidth = this._spanExtent(columnWidth, placement.columnSpan, columnGap)
      const rowHeight = rowHeights[placement.row] ?? 0
      const layout = resolveChildLayout(
        child,
        { minWidth: childWidth, maxWidth: childWidth, minHeight: rowHeight, maxHeight: rowHeight },
        'stretch',
        'start',
      )
      child.layout(layout.constraints, true, context)
      child.positionInSlot({
        x: this.contentOffset.x + placement.column * (columnWidth + columnGap),
        y: this.contentOffset.y + (rowOffsets[placement.row] ?? 0),
        width: childWidth,
        height: rowHeight,
      }, layout.horizontalAlignment, layout.verticalAlignment)
    }

    this.size = this.inflatePaddingSize(constraints, { width, height: cursorY })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    this.paintContentChildren(context, offset)
    this.paintAdornerChildren(context, offset)
  }

  private _resolveColumnCount(constraints: BoxConstraints, columnGap: number, childCount = this.children.length): number {
    const minColumns = Math.max(1, this._minColumns)
    const maxColumns = Math.max(minColumns, this._maxColumns ?? Math.max(minColumns, childCount, 1))
    if (constraints.maxWidth === Infinity) return maxColumns

    const fit = Math.floor((constraints.maxWidth + columnGap) / (this._minColumnWidth + columnGap))
    return Math.max(minColumns, Math.min(maxColumns, Math.max(1, fit)))
  }

  private _resolveWidth(constraints: BoxConstraints, columnCount: number, columnGap: number): number {
    if (constraints.maxWidth !== Infinity) return constraints.maxWidth
    const naturalWidth = columnCount * this._minColumnWidth + Math.max(0, columnCount - 1) * columnGap
    return Math.max(constraints.minWidth, naturalWidth)
  }

  private _resolvePlacements(columnCount: number, children: readonly RenderBox[]): AdaptiveGridPanelPlacement[] {
    const placements: AdaptiveGridPanelPlacement[] = []
    let row = 0
    let column = 0
    for (const child of children) {
      const data = this.childData.get(child) ?? {}
      const columnSpan = Math.max(1, Math.min(data.columnSpan ?? 1, columnCount))
      if (column + columnSpan > columnCount) {
        row += 1
        column = 0
      }
      placements.push({ row, column, columnSpan })
      column += columnSpan
      if (column >= columnCount) {
        row += 1
        column = 0
      }
    }
    return placements
  }

  private _spanExtent(columnWidth: number, columnSpan: number, columnGap: number): number {
    return columnWidth * columnSpan + Math.max(0, columnSpan - 1) * columnGap
  }
}
