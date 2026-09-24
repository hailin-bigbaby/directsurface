import { resolveGridColumnEditor } from './grid_column_editor'
import type { GridColumnDef } from './grid_types'

export class LookupValueIndex<T extends Record<string, any> = Record<string, any>> {
  private _rows: readonly T[] | null = null
  private _rowsLength = -1
  private _valueKey = ''
  private _rowsByValue = new Map<string, T>()

  constructor(private readonly _normalizeRowValue: (value: unknown) => string = value => String(value)) {}

  sync(rows: readonly T[], valueKey: string, force = false): void {
    if (
      !force &&
      this._rows === rows &&
      this._rowsLength === rows.length &&
      this._valueKey === valueKey
    ) {
      return
    }

    this._rows = rows
    this._rowsLength = rows.length
    this._valueKey = valueKey
    this._rowsByValue.clear()
    for (const row of rows) {
      const key = this._normalizeRowValue(row[valueKey])
      if (!this._rowsByValue.has(key)) this._rowsByValue.set(key, row)
    }
  }

  get(value: unknown): T | undefined {
    return this._rowsByValue.get(String(value ?? ''))
  }

  clear(): void {
    this._rows = null
    this._rowsLength = -1
    this._valueKey = ''
    this._rowsByValue.clear()
  }
}

export class GridLookupValueResolver<T extends Record<string, any> = Record<string, any>> {
  private readonly _indexes = new Map<string, LookupValueIndex<Record<string, any>>>()

  constructor(columns: readonly GridColumnDef<T>[] = []) {
    this.syncColumns(columns)
  }

  syncColumns(columns: readonly GridColumnDef<T>[]): void {
    const activeKeys = new Set<string>()
    for (const column of columns) {
      const editor = resolveGridColumnEditor(column)
      if (editor?.kind !== 'lookup') continue
      activeKeys.add(column.key)
      const index = this._indexes.get(column.key) ?? new LookupValueIndex<Record<string, any>>()
      index.sync(editor.rows, editor.valueKey)
      this._indexes.set(column.key, index)
    }
    for (const key of this._indexes.keys()) {
      if (!activeKeys.has(key)) this._indexes.delete(key)
    }
  }

  resolve(column: GridColumnDef<T>, value: unknown): Record<string, any> | undefined {
    const editor = resolveGridColumnEditor(column)
    if (editor?.kind !== 'lookup') return undefined
    const index = this._indexes.get(column.key) ?? new LookupValueIndex<Record<string, any>>()
    index.sync(editor.rows, editor.valueKey)
    this._indexes.set(column.key, index)
    return index.get(value)
  }

  refresh(columns: readonly GridColumnDef<T>[], columnKey?: string): boolean {
    let refreshed = false
    for (const column of columns) {
      if (columnKey !== undefined && column.key !== columnKey) continue
      const editor = resolveGridColumnEditor(column)
      if (editor?.kind !== 'lookup') continue
      const index = this._indexes.get(column.key) ?? new LookupValueIndex<Record<string, any>>()
      index.sync(editor.rows, editor.valueKey, true)
      this._indexes.set(column.key, index)
      refreshed = true
    }
    return refreshed
  }

  clear(): void {
    for (const index of this._indexes.values()) index.clear()
    this._indexes.clear()
  }
}
