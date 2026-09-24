import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { RenderBox, resolveChildLayout } from '../layout/render_box'
import type { PaintContext } from '../rendering/paint_context'
import { deriveLayoutStyle } from '../theme/component_styles'
import {
  RenderFormField,
  type FormFieldLabelPlacement,
} from './form_field'

export interface FormPanelChildData {
  columnSpan?: number | 'full'
  labelPlacement?: FormFieldLabelPlacement | 'inherit'
}

export type FormPanelColumnCount = number | 'auto'
export type FormPanelLabelPlacement = FormFieldLabelPlacement | 'adaptive'

export interface RenderFormPanelOptions {
  columns?: FormPanelColumnCount
  maxColumns?: number
  minColumnWidth?: number
  labelWidth?: number
  labelPlacement?: FormPanelLabelPlacement
  labelPlacementBreakpoint?: number
  columnGap?: number
  rowGap?: number
}

export interface FormPanelDebugFieldPlacement {
  childIndex: number
  label: string
  row: number
  column: number
  columnSpan: number
  labelPlacement: FormFieldLabelPlacement
}

export interface FormPanelDebugState {
  effectiveColumnCount: number
  placements: readonly FormPanelDebugFieldPlacement[]
}

interface FormPanelPlacement {
  row: number
  column: number
  columnSpan: number
}

const DEFAULT_MIN_COLUMN_WIDTH = 220
const DEFAULT_LABEL_PLACEMENT_BREAKPOINT = 280

function normalizeMinColumnWidth(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MIN_COLUMN_WIDTH
  return Math.max(1, value)
}

function normalizeBreakpoint(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LABEL_PLACEMENT_BREAKPOINT
  return Math.max(0, value)
}

function normalizeGap(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.max(0, value)
}

export class RenderFormPanel extends RenderBox {
  static override debugTypeName = 'RenderFormPanel'
  private readonly _children: RenderFormField[] = []
  private readonly _childData = new Map<RenderFormField, Readonly<FormPanelChildData>>()
  private _columns: FormPanelColumnCount
  private _maxColumns: number
  private _minColumnWidth: number
  private _labelWidth?: number
  private _labelPlacement: FormPanelLabelPlacement
  private _labelPlacementBreakpoint: number
  private _columnGap?: number
  private _rowGap?: number
  private _effectiveColumnCount = 1
  private _debugPlacements: FormPanelDebugFieldPlacement[] = []

  constructor(options: RenderFormPanelOptions = {}) {
    super()
    this._columns = this._normalizeColumnCount(options.columns ?? 'auto')
    this._maxColumns = this._normalizePositiveInteger(
      options.maxColumns,
      typeof this._columns === 'number' ? this._columns : 4,
    )
    this._minColumnWidth = normalizeMinColumnWidth(options.minColumnWidth)
    this._labelWidth = options.labelWidth
    this._labelPlacement = options.labelPlacement ?? 'inline'
    this._labelPlacementBreakpoint = normalizeBreakpoint(options.labelPlacementBreakpoint)
    this._columnGap = normalizeGap(options.columnGap)
    this._rowGap = normalizeGap(options.rowGap)
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  get children(): readonly RenderFormField[] { return this._children }
  get childData(): ReadonlyMap<RenderFormField, Readonly<FormPanelChildData>> { return this._childData }

  get columnGap(): number | undefined { return this._columnGap }
  set columnGap(value: number | undefined) {
    const next = normalizeGap(value)
    if (this._columnGap === next) return
    this._columnGap = next
    this.markNeedsLayout()
  }

  get rowGap(): number | undefined { return this._rowGap }
  set rowGap(value: number | undefined) {
    const next = normalizeGap(value)
    if (this._rowGap === next) return
    this._rowGap = next
    this.markNeedsLayout()
  }

  get columns(): FormPanelColumnCount { return this._columns }
  set columns(value: FormPanelColumnCount) {
    const next = this._normalizeColumnCount(value)
    if (this._columns === next) return
    this._columns = next
    this.markNeedsLayout()
  }

  get maxColumns(): number { return this._maxColumns }
  set maxColumns(value: number) {
    const next = this._normalizePositiveInteger(value, 1)
    if (this._maxColumns === next) return
    this._maxColumns = next
    this.markNeedsLayout()
  }

  get minColumnWidth(): number { return this._minColumnWidth }
  set minColumnWidth(value: number) {
    const next = normalizeMinColumnWidth(value)
    if (this._minColumnWidth === next) return
    this._minColumnWidth = next
    this.markNeedsLayout()
  }

  get labelWidth(): number | undefined { return this._labelWidth }
  set labelWidth(value: number | undefined) {
    if (this._labelWidth === value) return
    this._labelWidth = value
    this.markNeedsLayout()
  }

  get labelPlacement(): FormPanelLabelPlacement { return this._labelPlacement }
  set labelPlacement(value: FormPanelLabelPlacement) {
    if (this._labelPlacement === value) return
    this._labelPlacement = value
    this.markNeedsLayout()
  }

  get labelPlacementBreakpoint(): number { return this._labelPlacementBreakpoint }
  set labelPlacementBreakpoint(value: number) {
    const next = normalizeBreakpoint(value)
    if (this._labelPlacementBreakpoint === next) return
    this._labelPlacementBreakpoint = next
    this.markNeedsLayout()
  }

  addField(field: RenderFormField, data: FormPanelChildData = {}): void {
    this.insertField(this._children.length, field, data)
  }

  insertField(index: number, field: RenderFormField, data: FormPanelChildData = {}): void {
    this._assertInsertionIndex(index)
    this._assertCanAdopt(field)
    this._adopt(field)
    this._children.splice(index, 0, field)
    this._childData.set(field, this._normalizeChildData(data))
    this.markNeedsLayout()
  }

  removeField(field: RenderFormField): boolean {
    const index = this._children.indexOf(field)
    if (index < 0) return false
    this._children.splice(index, 1)
    this._childData.delete(field)
    this._release(field)
    this.markNeedsLayout()
    return true
  }

  moveField(field: RenderFormField, targetIndex: number): boolean {
    const currentIndex = this._children.indexOf(field)
    if (currentIndex < 0) return false
    this._assertExistingIndex(targetIndex)
    if (currentIndex === targetIndex) return true
    this._children.splice(currentIndex, 1)
    this._children.splice(targetIndex, 0, field)
    this.markNeedsLayout()
    return true
  }

  replaceField(
    current: RenderFormField,
    next: RenderFormField,
    data: FormPanelChildData = this._childData.get(current) ?? {},
  ): boolean {
    const index = this._children.indexOf(current)
    if (index < 0) return false
    if (current === next) return this.setFieldData(current, data)
    this._assertCanAdopt(next)
    this._adopt(next)
    this._children[index] = next
    this._childData.delete(current)
    this._childData.set(next, this._normalizeChildData(data))
    this._release(current)
    this.markNeedsLayout()
    return true
  }

  setFieldData(field: RenderFormField, data: FormPanelChildData): boolean {
    if (!this._childData.has(field)) return false
    this._childData.set(field, this._normalizeChildData(data))
    this.markNeedsLayout()
    return true
  }

  getFieldData(field: RenderFormField): Readonly<FormPanelChildData> | undefined {
    return this._childData.get(field)
  }

  clearFields(): void {
    if (this._children.length === 0) return
    const children = [...this._children]
    this._children.length = 0
    this._childData.clear()
    for (const child of children) this._release(child)
    this.markNeedsLayout()
  }

  debugState(): FormPanelDebugState {
    return {
      effectiveColumnCount: this._effectiveColumnCount,
      placements: this._debugPlacements.map(placement => ({ ...placement })),
    }
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      for (const child of this._children) visitor(child)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    for (const child of this._children) visitor(child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const layoutStyle = deriveLayoutStyle(context.theme)
    const columnGap = this._columnGap ?? layoutStyle.itemSpacing * 2
    const rowGap = this._rowGap ?? layoutStyle.itemSpacing
    const visibleChildren = this._children.filter(child => child.participatesInLayout)
    const columnCount = this._resolveColumnCount(constraints, columnGap)
    const placements = this._resolvePlacements(columnCount, visibleChildren)
    this._effectiveColumnCount = columnCount
    const availableWidth = constraints.maxWidth !== Infinity
      ? constraints.maxWidth
      : Math.max(constraints.minWidth, columnCount * this._minColumnWidth + Math.max(0, columnCount - 1) * columnGap)
    const columnWidth = Math.max(0, (availableWidth - Math.max(0, columnCount - 1) * columnGap) / columnCount)
    const rowHeights: number[] = []

    for (let index = 0; index < visibleChildren.length; index += 1) {
      const child = visibleChildren[index]!
      const placement = placements[index]!
      child.setParentLabelWidthOverride(this._labelWidth, { markNeedsLayout: false })
      child.setParentLabelOverflowOverride('ellipsis', { markNeedsLayout: false })
      const childWidth = placement.columnSpan * columnWidth + Math.max(0, placement.columnSpan - 1) * columnGap
      child.setParentLabelPlacementOverride(
        this._resolveFieldLabelPlacement(child, childWidth),
        { markNeedsLayout: false },
      )
      const childLayout = resolveChildLayout(
        child,
        { minWidth: childWidth, maxWidth: childWidth, minHeight: 0, maxHeight: Infinity },
        'stretch',
        'center',
      )
      child.layout(childLayout.constraints, true, context)
      rowHeights[placement.row] = Math.max(rowHeights[placement.row] ?? 0, child.outerSize.height)
    }

    this._debugPlacements = placements.map((placement, index) => ({
      childIndex: this._children.indexOf(visibleChildren[index]!),
      label: visibleChildren[index]!.label,
      labelPlacement: visibleChildren[index]!.resolvedLabelPlacement,
      ...placement,
    }))

    for (let index = 0; index < visibleChildren.length; index += 1) {
      const child = visibleChildren[index]!
      const placement = placements[index]!
      const rowHeight = rowHeights[placement.row] ?? child.outerSize.height
      const childWidth = placement.columnSpan * columnWidth + Math.max(0, placement.columnSpan - 1) * columnGap
      const childLayout = resolveChildLayout(
        child,
        { minWidth: childWidth, maxWidth: childWidth, minHeight: rowHeight, maxHeight: rowHeight },
        'stretch',
        'center',
      )
      child.layout(childLayout.constraints, true, context)
      child.positionInSlot({
        x: placement.column * (columnWidth + columnGap),
        y: this._rowOffset(rowHeights, placement.row, rowGap),
        width: childWidth,
        height: rowHeight,
      }, childLayout.horizontalAlignment, childLayout.verticalAlignment)
    }

    this.size = constrainSize(constraints, {
      width: availableWidth,
      height: rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rowHeights.length - 1) * rowGap,
    })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    this.paintContentChildren(context, offset)
    this.paintAdornerChildren(context, offset)
  }

  private _resolveColumnCount(constraints: BoxConstraints, columnGap: number): number {
    const maxColumns = typeof this._columns === 'number' ? this._columns : this._maxColumns
    if (this._columns !== 'auto' || constraints.maxWidth === Infinity) return maxColumns
    const count = Math.floor((constraints.maxWidth + columnGap) / (this._minColumnWidth + columnGap))
    return Math.max(1, Math.min(maxColumns, count))
  }

  private _resolvePlacements(columnCount: number, children: readonly RenderFormField[]): FormPanelPlacement[] {
    const placements: FormPanelPlacement[] = []
    let row = 0
    let column = 0
    for (const child of children) {
      const data = this._childData.get(child) ?? {}
      const requestedColumnSpan = data.columnSpan === 'full' ? columnCount : data.columnSpan ?? 1
      const columnSpan = Math.max(1, Math.min(requestedColumnSpan, columnCount))
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

  private _rowOffset(rowHeights: number[], row: number, rowGap: number): number {
    let offset = 0
    for (let index = 0; index < row; index += 1) {
      offset += (rowHeights[index] ?? 0) + rowGap
    }
    return offset
  }

  private _assertCanAdopt(field: RenderFormField): void {
    if (this._children.includes(field) || field.parent === this) {
      throw new Error('RenderFormPanel cannot contain the same field more than once')
    }
    if (field.parent !== undefined) {
      throw new Error('RenderFormPanel cannot adopt a field that already has a parent')
    }
    if (field.owner !== undefined) {
      throw new Error('RenderFormPanel cannot adopt a field that is already attached to a render tree')
    }
  }

  private _adopt(field: RenderFormField): void {
    field.parent = this
    try {
      if (this.owner && !field.owner) field.attach(this.owner)
    } catch (error) {
      field.parent = undefined
      throw error
    }
  }

  private _release(field: RenderFormField): void {
    field.setParentLabelWidthOverride(undefined, { markNeedsLayout: false })
    field.setParentLabelOverflowOverride(undefined, { markNeedsLayout: false })
    field.setParentLabelPlacementOverride(undefined, { markNeedsLayout: false })
    field.releaseExternalAdorners()
    if (field.owner) field.detach()
    field.parent = undefined
  }

  private _assertInsertionIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index > this._children.length) {
      throw new RangeError(`FormPanel insertion index ${index} is outside 0..${this._children.length}`)
    }
  }

  private _assertExistingIndex(index: number): void {
    const maxIndex = this._children.length - 1
    if (!Number.isInteger(index) || index < 0 || index > maxIndex) {
      throw new RangeError(`FormPanel target index ${index} is outside 0..${maxIndex}`)
    }
  }

  private _normalizeColumnCount(value: FormPanelColumnCount): FormPanelColumnCount {
    return value === 'auto' ? value : this._normalizePositiveInteger(value, 1)
  }

  private _normalizePositiveInteger(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isFinite(value)) return fallback
    return Math.max(1, Math.floor(value))
  }

  private _normalizeChildData(data: FormPanelChildData): Readonly<FormPanelChildData> {
    const columnSpan = data.columnSpan === undefined
      ? undefined
      : data.columnSpan === 'full'
        ? 'full'
        : this._normalizePositiveInteger(data.columnSpan, 1)
    const labelPlacement = data.labelPlacement ?? 'inherit'
    return Object.freeze({
      ...(columnSpan === undefined ? {} : { columnSpan }),
      ...(labelPlacement === 'inherit' ? {} : { labelPlacement }),
    })
  }

  private _resolveFieldLabelPlacement(
    field: RenderFormField,
    fieldWidth: number,
  ): FormFieldLabelPlacement {
    const childPlacement = this._childData.get(field)?.labelPlacement
    if (childPlacement && childPlacement !== 'inherit') return childPlacement
    if (this._labelPlacement !== 'adaptive') return this._labelPlacement
    return fieldWidth < this._labelPlacementBreakpoint ? 'top' : 'inline'
  }
}
