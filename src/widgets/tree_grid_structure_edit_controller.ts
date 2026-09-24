import type { GridCellErrorState, GridColumnDef, GridResolvedCellEditPolicy } from './grid/grid_types'
import { normalizeGridColumnValue } from './grid/grid_column_editor'
import type { GridEditableStructure } from './grid/grid_structure_edit_controller'
import type { TreeGridVisibleNodeItem } from './tree_grid'

export interface TreeGridStructureEditControllerOptions<T extends Record<string, any>> {
  getColumns: () => GridColumnDef<T>[]
  getVisibleItems: () => TreeGridVisibleNodeItem<T>[]
  onCellChange?: (node: { key: string; row: T }, key: keyof T & string, value: any) => void
  onInvalidateVisibleItems: (key: string) => void
  onMarkNeedsPaint: () => void
}

export class TreeGridStructureEditController<T extends Record<string, any> = any> implements GridEditableStructure<T> {
  private readonly _getColumns: TreeGridStructureEditControllerOptions<T>['getColumns']
  private readonly _getVisibleItems: TreeGridStructureEditControllerOptions<T>['getVisibleItems']
  private readonly _onCellChange?: TreeGridStructureEditControllerOptions<T>['onCellChange']
  private readonly _onInvalidateVisibleItems: TreeGridStructureEditControllerOptions<T>['onInvalidateVisibleItems']
  private readonly _onMarkNeedsPaint: TreeGridStructureEditControllerOptions<T>['onMarkNeedsPaint']

  readonly validationRevision = 0

  constructor(options: TreeGridStructureEditControllerOptions<T>) {
    this._getColumns = options.getColumns
    this._getVisibleItems = options.getVisibleItems
    this._onCellChange = options.onCellChange
    this._onInvalidateVisibleItems = options.onInvalidateVisibleItems
    this._onMarkNeedsPaint = options.onMarkNeedsPaint
  }

  canEditColumn(column: GridColumnDef<T> | null | undefined): boolean {
    return !!column && column.editable !== false && (column.type !== 'custom' || !!column.editor)
  }

  cellEditPolicy(_rowIndex: number, colIndex: number): GridResolvedCellEditPolicy {
    return this.canEditColumn(this._getColumns()[colIndex])
      ? { state: 'editable', tabStop: true }
      : { state: 'readonly', tabStop: false }
  }

  canEditCell(rowIndex: number, colIndex: number): boolean {
    return this.cellEditPolicy(rowIndex, colIndex).state === 'editable'
  }

  isCellTabStop(rowIndex: number, colIndex: number): boolean {
    return this.cellEditPolicy(rowIndex, colIndex).tabStop
  }

  editableColumnIndex(startIndex: number, direction: 1 | -1): number {
    const columns = this._getColumns()
    for (let index = startIndex + direction; index >= 0 && index < columns.length; index += direction) {
      if (this.canEditColumn(columns[index])) return index
    }
    return -1
  }

  firstEditableColumnIndex(): number {
    const columns = this._getColumns()
    for (let index = 0; index < columns.length; index += 1) {
      if (this.canEditColumn(columns[index])) return index
    }
    return -1
  }

  lastEditableColumnIndex(): number {
    const columns = this._getColumns()
    for (let index = columns.length - 1; index >= 0; index -= 1) {
      if (this.canEditColumn(columns[index])) return index
    }
    return -1
  }

  commitVisibleCell(rowIndex: number, colIndex: number, value: any, originalValue?: any): boolean {
    const column = this._getColumns()[colIndex]
    if (!column || !this.canEditColumn(column)) return false
    const item = this._getVisibleItems()[rowIndex]
    if (!item) return false
    const effectiveOriginalValue = originalValue === undefined
      ? item.row[column.key]
      : originalValue
    return this.commitVisibleValue(
      rowIndex,
      column.key,
      this.normalizeValue(column, value, effectiveOriginalValue),
    )
  }

  commitVisibleValue(rowIndex: number, key: string, value: any): boolean {
    const item = this._getVisibleItems()[rowIndex]
    if (!item) return false
    if ((item.row as any)[key] === value) return false
    ;(item.row as any)[key] = value
    this._onCellChange?.(item.node, key as keyof T & string, value)
    this._onInvalidateVisibleItems(key)
    this._onMarkNeedsPaint()
    return true
  }

  normalizeValue(column: GridColumnDef<T>, value: any, originalValue?: any): any {
    return normalizeGridColumnValue(column, value, originalValue)
  }

  cellError(_rowIndex: number, _keyOrCol: string | number): GridCellErrorState | null {
    return null
  }

  cellErrorForSource(_sourceRowIndex: number, _key: string): GridCellErrorState | null {
    return null
  }

  cellErrors(): GridCellErrorState[] {
    return []
  }

  clearCellErrors(): boolean {
    return false
  }

  clearCellErrorForSource(_sourceRowIndex: number, _key: string): boolean {
    return false
  }
}
