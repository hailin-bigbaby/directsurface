import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset, type Size } from '../core/render_object'
import { RenderBox, RenderPanel, type RenderPanelOptions } from './render_box'
import type { PaintContext } from '../rendering/paint_context'
import { deriveLayoutStyle } from '../theme/component_styles'

export interface UniformGridOptions extends RenderPanelOptions {
  rows?: number
  columns?: number
  columnGap?: number
  rowGap?: number
}

export class RenderUniformGrid extends RenderPanel {
  static override debugTypeName = 'RenderUniformGrid'
  children: RenderBox[] = []
  private _rows?: number
  private _columns?: number
  private _columnGap?: number
  private _rowGap?: number

  constructor(options: UniformGridOptions = {}) {
    super(options)
    this._rows = options.rows
    this._columns = options.columns
    this._columnGap = options.columnGap
    this._rowGap = options.rowGap
  }

  get rows(): number | undefined { return this._rows }
  set rows(value: number | undefined) {
    if (this._rows === value) return
    this._rows = value
    this.markNeedsLayout()
  }

  get columns(): number | undefined { return this._columns }
  set columns(value: number | undefined) {
    if (this._columns === value) return
    this._columns = value
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
    const visibleChildren = this.children.filter(child => child.participatesInLayout)
    const childCount = visibleChildren.length
    const columns = this._resolveColumns(childCount)
    const rows = this._resolveRows(childCount, columns)
    const naturalCell = this._measureNaturalCell(visibleChildren, context)
    const gapWidth = Math.max(0, columns - 1) * columnGap
    const gapHeight = Math.max(0, rows - 1) * rowGap
    const widthIsBounded = contentConstraints.maxWidth !== Infinity
    const heightIsBounded = contentConstraints.maxHeight !== Infinity
    const availableWidth = widthIsBounded ? contentConstraints.maxWidth : contentConstraints.minWidth
    const availableHeight = heightIsBounded ? contentConstraints.maxHeight : contentConstraints.minHeight
    const cellWidth = widthIsBounded
      ? Math.max(0, (availableWidth - gapWidth) / columns)
      : Math.max(naturalCell.width, availableWidth > 0 ? (availableWidth - gapWidth) / columns : 0)
    const heightNaturalCell = !heightIsBounded && widthIsBounded
      ? this._measureNaturalCellForWidth(cellWidth, context)
      : naturalCell
    const cellHeight = heightIsBounded
      ? Math.max(0, (availableHeight - gapHeight) / rows)
      : Math.max(heightNaturalCell.height, availableHeight > 0 ? (availableHeight - gapHeight) / rows : 0)

    for (let index = 0; index < visibleChildren.length; index += 1) {
      const child = visibleChildren[index]!
      const row = Math.floor(index / columns)
      const column = index % columns
      const horizontalAlignment = child.resolveHorizontalAlignment('stretch')
      const verticalAlignment = child.resolveVerticalAlignment('stretch')
      child.layout({
        minWidth: horizontalAlignment === 'stretch' && child.width === undefined ? cellWidth : 0,
        maxWidth: cellWidth,
        minHeight: verticalAlignment === 'stretch' && child.height === undefined ? cellHeight : 0,
        maxHeight: cellHeight,
      }, true, context)
      child.positionInSlot({
        x: this.contentOffset.x + column * (cellWidth + columnGap),
        y: this.contentOffset.y + row * (cellHeight + rowGap),
        width: cellWidth,
        height: cellHeight,
      }, horizontalAlignment, verticalAlignment)
    }

    this.size = this.inflatePaddingSize(constraints, {
      width: columns * cellWidth + gapWidth,
      height: rows * cellHeight + gapHeight,
    })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    this.paintContentChildren(context, offset)
    this.paintAdornerChildren(context, offset)
  }

  private _resolveColumns(childCount: number): number {
    if (this._columns !== undefined) return Math.max(1, this._columns)
    if (this._rows !== undefined) return Math.max(1, Math.ceil(childCount / Math.max(1, this._rows)))
    return Math.max(1, Math.ceil(Math.sqrt(Math.max(1, childCount))))
  }

  private _resolveRows(childCount: number, columns: number): number {
    if (this._rows !== undefined) return Math.max(1, this._rows)
    return Math.max(1, Math.ceil(childCount / columns))
  }

  private _measureNaturalCell(children: readonly RenderBox[], context: LayoutContext): Size {
    let width = 0
    let height = 0
    for (const child of children) {
      const size = child.measureOuter({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity }, context)
      width = Math.max(width, size.width)
      height = Math.max(height, size.height)
    }
    return { width, height }
  }

  private _measureNaturalCellForWidth(cellWidth: number, context: LayoutContext): Size {
    let height = 0
    for (const child of this.children.filter(child => child.participatesInLayout)) {
      const size = child.measureOuter({
        minWidth: cellWidth,
        maxWidth: cellWidth,
        minHeight: 0,
        maxHeight: Infinity,
      }, context)
      height = Math.max(height, size.height)
    }
    return { width: cellWidth, height }
  }
}
