import type { GridDataModel, GridDataModelInvalidationReason } from './grid_data_model'
import type {
  GridCellErrorState,
  GridResolvedCellEditPolicy,
  GridCellValidationArgs,
  GridCellValidationResult,
  GridColumnDef,
  GridDataChangeOrigin,
  GridEditorValidationMessages,
  GridRowId,
  GridRowValidationArgs,
  GridRowValidationResult,
  GridValidationResult,
} from './grid_types'
import { gridColumnValueValidationMessage, normalizeGridColumnValue } from './grid_column_editor'

export type GridCellEditImpact = 'none' | 'sort' | 'filter' | 'group' | 'structure'

export interface GridVisibleCellCommitOptions<T extends Record<string, any> = any> {
  column?: GridColumnDef<T>
  originalValue?: any
  normalized?: boolean
  rawValue?: any
  origin?: GridDataChangeOrigin
}

export interface GridEditableStructure<T extends Record<string, any> = any> {
  readonly validationRevision: number
  canEditColumn(column: GridColumnDef<T> | null | undefined): boolean
  cellEditPolicy(rowIndex: number, colIndex: number): GridResolvedCellEditPolicy
  canEditCell(rowIndex: number, colIndex: number): boolean
  isCellTabStop(rowIndex: number, colIndex: number): boolean
  editableColumnIndex(startIndex: number, direction: 1 | -1): number
  firstEditableColumnIndex(): number
  lastEditableColumnIndex(): number
  commitVisibleCell(
    rowIndex: number,
    colIndex: number,
    value: any,
    originalValue?: any,
    options?: { origin?: GridDataChangeOrigin },
  ): boolean
  commitVisibleValue(rowIndex: number, key: string, value: any, options?: GridVisibleCellCommitOptions<T>): boolean
  normalizeValue(column: GridColumnDef<T>, value: any, originalValue?: any): any
  cellError(rowIndex: number, keyOrCol: string | number): GridCellErrorState | null
  cellErrorForSource(sourceRowIndex: number, key: string): GridCellErrorState | null
  cellErrors(): GridCellErrorState[]
  clearCellErrorForSource(sourceRowIndex: number, key: string): boolean
  clearCellErrors(): boolean
}

export interface GridStructureEditControllerOptions<T extends Record<string, any>> {
  dataModel: GridDataModel<T>
  getColumns: () => GridColumnDef<T>[]
  getAllColumns?: () => GridColumnDef<T>[]
  getValidateCell?: () => ((args: GridCellValidationArgs<T>) => GridCellValidationResult) | undefined
  getValidateRow?: () => ((args: GridRowValidationArgs<T>) => GridRowValidationResult<T>) | undefined
  getEditorValidationMessages?: () => Readonly<GridEditorValidationMessages>
  getCellEditPolicy?: (rowIndex: number, colIndex: number) => GridResolvedCellEditPolicy
}

interface StoredGridCellError {
  sourceRowIndex: number
  rowId: GridRowId | null
  key: string
  message: string
  value: any
}

export class GridStructureEditController<T extends Record<string, any> = any> implements GridEditableStructure<T> {
  private readonly _dataModel: GridDataModel<T>
  private readonly _getColumns: GridStructureEditControllerOptions<T>['getColumns']
  private readonly _getAllColumns: NonNullable<GridStructureEditControllerOptions<T>['getAllColumns']>
  private readonly _getValidateCell: NonNullable<GridStructureEditControllerOptions<T>['getValidateCell']>
  private readonly _getValidateRow: NonNullable<GridStructureEditControllerOptions<T>['getValidateRow']>
  private readonly _getEditorValidationMessages?: GridStructureEditControllerOptions<T>['getEditorValidationMessages']
  private readonly _getCellEditPolicy?: GridStructureEditControllerOptions<T>['getCellEditPolicy']
  private readonly _cellErrors = new Map<string, StoredGridCellError>()
  private _validationRevision = 0

  constructor(options: GridStructureEditControllerOptions<T>) {
    this._dataModel = options.dataModel
    this._getColumns = options.getColumns
    this._getAllColumns = options.getAllColumns ?? options.getColumns
    this._getValidateCell = options.getValidateCell ?? (() => undefined)
    this._getValidateRow = options.getValidateRow ?? (() => undefined)
    this._getEditorValidationMessages = options.getEditorValidationMessages
    this._getCellEditPolicy = options.getCellEditPolicy
  }

  get validationRevision(): number {
    return this._validationRevision
  }

  canEditColumn(column: GridColumnDef<T> | null | undefined): boolean {
    return !!column && column.editable !== false && (column.type !== 'custom' || !!column.editor)
  }

  cellEditPolicy(rowIndex: number, colIndex: number): GridResolvedCellEditPolicy {
    const resolved = this._getCellEditPolicy?.(rowIndex, colIndex)
    if (resolved) return resolved
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
    for (let index = 0; index < columns.length; index++) {
      if (this.canEditColumn(columns[index])) return index
    }
    return -1
  }

  lastEditableColumnIndex(): number {
    const columns = this._getColumns()
    for (let index = columns.length - 1; index >= 0; index--) {
      if (this.canEditColumn(columns[index])) return index
    }
    return -1
  }

  classifyColumnImpact(key: string): GridCellEditImpact {
    if (this._dataModel.groupBy.some(group => group.key === key)) return 'group'
    if (this._dataModel.sortDescriptors.some(sort => sort.key === key)) return 'sort'
    if (this._dataModel.filterValues.has(key) || this._dataModel.filters.some(filter => filter.key === key)) return 'filter'
    if (this._dataModel.quickFilter) return 'filter'
    if (this._dataModel.groupBy.length > 0 && this._dataModel.summary.some(def => def.key === key)) return 'structure'
    return 'none'
  }

  commitVisibleCell(
    rowIndex: number,
    colIndex: number,
    value: any,
    originalValue?: any,
    options: { origin?: GridDataChangeOrigin } = {},
  ): boolean {
    const column = this._getColumns()[colIndex]
    if (!column || !this.canEditColumn(column)) return false
    const effectiveOriginalValue = originalValue === undefined
      ? (this._dataModel.visibleRows()[rowIndex] as any)?.[column.key]
      : originalValue
    const nextValue = this.normalizeValue(column, value, effectiveOriginalValue)
    return this.commitVisibleValue(rowIndex, column.key, nextValue, {
      column,
      originalValue: effectiveOriginalValue,
      normalized: true,
      rawValue: value,
      origin: options.origin,
    })
  }

  commitVisibleValue(rowIndex: number, key: string, value: any, options: GridVisibleCellCommitOptions<T> = {}): boolean {
    const column = options.column ?? this.columnForKey(key)
    const row = this._dataModel.visibleRows()[rowIndex]
    const originalValue = options.originalValue === undefined ? (row as any)?.[key] : options.originalValue
    const nextValue = column && !options.normalized
      ? this.normalizeValue(column, value, originalValue)
      : value
    const nextOptions: GridVisibleCellCommitOptions<T> = {
      ...options,
      column,
      originalValue,
      normalized: true,
    }
    if (!this.validateVisibleValue(rowIndex, key, nextValue, nextOptions)) return false
    const reason: GridDataModelInvalidationReason | false = this.classifyColumnImpact(key) === 'none'
      ? false
      : 'cell'
    return this._dataModel.setCellValue(rowIndex, key, nextValue, {
      invalidate: reason,
      origin: options.origin,
    })
  }

  commitSourceCell(
    sourceRowIndex: number,
    colIndex: number,
    value: any,
    originalValue?: any,
    options: { origin?: GridDataChangeOrigin } = {},
  ): boolean {
    const column = this._getColumns()[colIndex]
    if (!column || !this.canEditColumn(column)) return false
    const effectiveOriginalValue = originalValue === undefined
      ? (this._dataModel.rows[sourceRowIndex] as any)?.[column.key]
      : originalValue
    const nextValue = this.normalizeValue(column, value, effectiveOriginalValue)
    return this.commitSourceValue(sourceRowIndex, column.key, nextValue, {
      column,
      originalValue: effectiveOriginalValue,
      normalized: true,
      rawValue: value,
      origin: options.origin,
    })
  }

  commitSourceValue(
    sourceRowIndex: number,
    key: string,
    value: any,
    options: GridVisibleCellCommitOptions<T> = {},
  ): boolean {
    const column = options.column ?? this.columnForKey(key)
    const row = this._dataModel.rows[sourceRowIndex]
    const originalValue = options.originalValue === undefined ? (row as any)?.[key] : options.originalValue
    const nextValue = column && !options.normalized
      ? this.normalizeValue(column, value, originalValue)
      : value
    const nextOptions: GridVisibleCellCommitOptions<T> = {
      ...options,
      column,
      originalValue,
      normalized: true,
    }
    if (!this.validateSourceValue(sourceRowIndex, key, nextValue, nextOptions)) return false
    const reason: GridDataModelInvalidationReason | false = this.classifyColumnImpact(key) === 'none'
      ? false
      : 'cell'
    return this._dataModel.setSourceCellValue(sourceRowIndex, key, nextValue, {
      invalidate: reason,
      origin: options.origin,
    })
  }

  normalizeValue(column: GridColumnDef<T>, value: any, originalValue?: any): any {
    return normalizeGridColumnValue(column, value, originalValue)
  }

  cellError(rowIndex: number, keyOrCol: string | number): GridCellErrorState | null {
    const sourceRowIndex = this._dataModel.visibleRowIndex(rowIndex)
    if (sourceRowIndex < 0) return null
    const key = typeof keyOrCol === 'number'
      ? this._getColumns()[keyOrCol]?.key
      : keyOrCol
    if (!key) return null
    return this.cellErrorForSource(sourceRowIndex, key)
  }

  cellErrorForSource(sourceRowIndex: number, key: string): GridCellErrorState | null {
    const rowId = this._dataModel.rowIdForSourceIndex(sourceRowIndex)
    const stored = this._cellErrors.get(this.errorKey(sourceRowIndex, rowId, key))
    if (!stored) return null
    return this.toPublicError(stored)
  }

  cellErrors(): GridCellErrorState[] {
    return Array.from(this._cellErrors.values()).map(error => this.toPublicError(error))
  }

  clearCellErrors(): boolean {
    if (this._cellErrors.size === 0) return false
    this._cellErrors.clear()
    this._validationRevision++
    return true
  }

  clearCellErrorForSource(sourceRowIndex: number, key: string): boolean {
    return this.clearCellError(sourceRowIndex, this._dataModel.rowIdForSourceIndex(sourceRowIndex), key)
  }

  validateAll(options: { preserveCell?: { sourceRowIndex: number; key: string } } = {}): GridValidationResult<T> {
    const preserve = options.preserveCell
    const preserveKey = preserve
      ? this.errorKey(
          preserve.sourceRowIndex,
          this._dataModel.rowIdForSourceIndex(preserve.sourceRowIndex),
          preserve.key,
        )
      : null
    const preservedError = preserveKey ? this._cellErrors.get(preserveKey) : undefined
    this.clearCellErrors()
    if (preserveKey && preservedError) this._cellErrors.set(preserveKey, preservedError)

    const columns = this._getAllColumns()
    for (let sourceRowIndex = 0; sourceRowIndex < this._dataModel.rows.length; sourceRowIndex++) {
      const row = this._dataModel.rows[sourceRowIndex]
      if (!row) continue
      for (const column of columns) {
        if (preserve?.sourceRowIndex === sourceRowIndex && preserve.key === column.key) continue
        const value = row[column.key]
        this.validateSourceValue(sourceRowIndex, column.key, value, {
          column,
          originalValue: value,
          normalized: true,
          rawValue: value,
        })
      }
      this.validateSourceRow(sourceRowIndex)
    }

    const errors = this.cellErrors()
    return { valid: errors.length === 0, errors }
  }

  syncCellErrorsToRows(): boolean {
    if (!this._dataModel.hasRowKey()) return false
    let changed = false
    for (const [mapKey, error] of [...this._cellErrors]) {
      if (error.rowId !== null && this._dataModel.sourceRowIndexForRowId(error.rowId) >= 0) continue
      this._cellErrors.delete(mapKey)
      changed = true
    }
    if (changed) this._validationRevision++
    return changed
  }

  private validateVisibleValue(
    rowIndex: number,
    key: string,
    value: any,
    options: GridVisibleCellCommitOptions<T>,
  ): boolean {
    const column = options.column ?? this.columnForKey(key)
    if (!column) return true

    const row = this._dataModel.visibleRows()[rowIndex]
    const sourceRowIndex = this._dataModel.visibleRowIndex(rowIndex)
    const rowId = this._dataModel.visibleRowId(rowIndex)
    if (!row || sourceRowIndex < 0) return true

    const inputValue = Object.prototype.hasOwnProperty.call(options, 'rawValue') ? options.rawValue : value
    const builtInFailure = gridColumnValueValidationMessage(
      column,
      inputValue,
      this._getEditorValidationMessages?.(),
    )
    if (builtInFailure) {
      this.setCellError(sourceRowIndex, rowId, key, builtInFailure, inputValue)
      return false
    }

    const validateCell = this._getValidateCell()
    if (!validateCell) {
      this.clearCellError(sourceRowIndex, rowId, key)
      return true
    }
    const args: GridCellValidationArgs<T> = {
      row,
      rowId,
      key: key as keyof T & string,
      value,
      originalValue: options.originalValue === undefined ? (row as any)[key] : options.originalValue,
      column,
    }
    const failureMessage = this.validationFailureMessage(validateCell(args))
    if (failureMessage) {
      this.setCellError(sourceRowIndex, rowId, key, failureMessage, value)
      return false
    }
    this.clearCellError(sourceRowIndex, rowId, key)
    return true
  }

  private validateSourceValue(
    sourceRowIndex: number,
    key: string,
    value: any,
    options: GridVisibleCellCommitOptions<T>,
  ): boolean {
    const column = options.column ?? this.columnForKey(key)
    if (!column) return true

    const row = this._dataModel.rows[sourceRowIndex]
    const rowId = this._dataModel.rowIdForSourceIndex(sourceRowIndex)
    if (!row || sourceRowIndex < 0) return true

    const inputValue = Object.prototype.hasOwnProperty.call(options, 'rawValue') ? options.rawValue : value
    const builtInFailure = gridColumnValueValidationMessage(
      column,
      inputValue,
      this._getEditorValidationMessages?.(),
    )
    if (builtInFailure) {
      this.setCellError(sourceRowIndex, rowId, key, builtInFailure, inputValue)
      return false
    }

    const validateCell = this._getValidateCell()
    if (!validateCell) {
      this.clearCellError(sourceRowIndex, rowId, key)
      return true
    }
    const args: GridCellValidationArgs<T> = {
      row,
      rowId,
      key: key as keyof T & string,
      value,
      originalValue: options.originalValue === undefined ? (row as any)[key] : options.originalValue,
      column,
    }
    const failureMessage = this.validationFailureMessage(validateCell(args))
    if (failureMessage) {
      this.setCellError(sourceRowIndex, rowId, key, failureMessage, value)
      return false
    }
    this.clearCellError(sourceRowIndex, rowId, key)
    return true
  }

  private validateSourceRow(sourceRowIndex: number): boolean {
    const validateRow = this._getValidateRow()
    const row = this._dataModel.rows[sourceRowIndex]
    if (!validateRow || !row) return true
    const rowId = this._dataModel.rowIdForSourceIndex(sourceRowIndex)
    const result = validateRow({ row, rowId, sourceRowIndex })
    if (!result) return true

    let valid = true
    for (const [key, message] of Object.entries(result)) {
      const normalizedMessage = message?.trim()
      if (!normalizedMessage) continue
      valid = false
      const mapKey = this.errorKey(sourceRowIndex, rowId, key)
      if (this._cellErrors.has(mapKey)) continue
      this.setCellError(sourceRowIndex, rowId, key, normalizedMessage, row[key])
    }
    return valid
  }

  private validationFailureMessage(result: GridCellValidationResult): string | null {
    if (result === false) return 'Invalid value'
    if (typeof result === 'string') return result.trim() || 'Invalid value'
    if (result && typeof result === 'object' && result.valid === false) {
      return result.message?.trim() || 'Invalid value'
    }
    return null
  }

  private columnForKey(key: string): GridColumnDef<T> | undefined {
    return this._getColumns().find(entry => entry.key === key) ??
      this._getAllColumns().find(entry => entry.key === key)
  }

  private setCellError(sourceRowIndex: number, rowId: GridRowId | null, key: string, message: string, value: any): void {
    const mapKey = this.errorKey(sourceRowIndex, rowId, key)
    const current = this._cellErrors.get(mapKey)
    if (
      current &&
      current.message === message &&
      Object.is(current.value, value)
    ) {
      return
    }
    this._cellErrors.set(mapKey, { sourceRowIndex, rowId, key, message, value })
    this._validationRevision++
  }

  private clearCellError(sourceRowIndex: number, rowId: GridRowId | null, key: string): boolean {
    const deleted = this._cellErrors.delete(this.errorKey(sourceRowIndex, rowId, key))
    if (deleted) this._validationRevision++
    return deleted
  }

  private errorKey(sourceRowIndex: number, rowId: GridRowId | null, key: string): string {
    if (rowId !== null) return `id\u0000${typeof rowId}\u0000${String(rowId)}\u0000${key}`
    return `source\u0000${sourceRowIndex}\u0000${key}`
  }

  private toPublicError(error: StoredGridCellError): GridCellErrorState {
    const sourceRowIndex = error.rowId !== null
      ? this._dataModel.sourceRowIndexForRowId(error.rowId)
      : error.sourceRowIndex
    const visibleRowIndex = error.rowId !== null
      ? this._dataModel.visibleRowIndexForRowId(error.rowId)
      : this._dataModel.visibleRowIndices().findIndex(index => index === error.sourceRowIndex)
    const row = visibleRowIndex >= 0
      ? this._dataModel.visibleRows()[visibleRowIndex] ?? null
      : this._dataModel.rows[sourceRowIndex] ?? null
    const column = this.columnForKey(error.key) ?? null
    return {
      rowId: error.rowId,
      row,
      key: error.key as keyof T & string,
      column,
      message: error.message,
      value: error.value,
      visible: visibleRowIndex >= 0,
    }
  }
}
