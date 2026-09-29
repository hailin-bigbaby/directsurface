import type { GridDataModel } from './grid_data_model'
import { sameGridFilterValue } from './grid_filter_values'
import type { GridColumnDef, GridResolvedCellEditPolicy, GridVisibleItem } from './grid_types'

export interface GridRowMergeRun {
  columnKey: string
  startItemIndex: number
  endItemIndex: number
  anchorDataRowIndex: number
  endDataRowIndex: number
}

/** Cached runs over the complete display projection. Painting only queries intervals. */
export class GridRowMergeModel<T extends Record<string, any>> {
  private _items: GridVisibleItem<T>[] | null = null
  private _columns: GridColumnDef<T>[] | null = null
  private _revision = 0
  private _builtRevision = -1
  private _validationRevision = -1
  private _runs = new Map<string, GridRowMergeRun[]>()
  private readonly _unsubscribe: () => void

  constructor(
    private readonly _dataModel: GridDataModel<T>,
    private readonly _getColumns: () => GridColumnDef<T>[],
    private readonly _basePolicy: (row: number, col: number) => GridResolvedCellEditPolicy,
    private readonly _cellError: (row: number, key: string) => boolean,
    private readonly _getValidationRevision: () => number,
  ) {
    this._unsubscribe = _dataModel.subscribeDataChange(() => this.invalidate())
  }

  dispose(): void { this._unsubscribe() }
  invalidate(): void { this._revision++ }

  runs(columnKey: string): readonly GridRowMergeRun[] {
    this.ensure()
    return this._runs.get(columnKey) ?? []
  }

  runAt(itemIndex: number, columnKey: string): GridRowMergeRun | null {
    const runs = this.runs(columnKey)
    let low = 0
    let high = runs.length - 1
    while (low <= high) {
      const mid = (low + high) >>> 1
      const run = runs[mid]!
      if (itemIndex < run.startItemIndex) high = mid - 1
      else if (itemIndex > run.endItemIndex) low = mid + 1
      else return run
    }
    return null
  }

  intersecting(first: number, last: number, columnKey: string): GridRowMergeRun[] {
    const runs = this.runs(columnKey)
    let low = 0
    let high = runs.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (runs[mid]!.endItemIndex < first) low = mid + 1
      else high = mid
    }
    const result: GridRowMergeRun[] = []
    for (let i = low; i < runs.length && runs[i]!.startItemIndex <= last; i++) result.push(runs[i]!)
    return result
  }

  private ensure(): void {
    const items = this._dataModel.visibleItems()
    const columns = this._getColumns()
    const validationRevision = this._getValidationRevision()
    if (items === this._items && columns.length === this._columns?.length &&
      columns.every((column, index) => column === this._columns?.[index]) &&
      this._builtRevision === this._revision && validationRevision === this._validationRevision) return
    this._items = items
    this._columns = columns
    this._validationRevision = validationRevision
    this._builtRevision = this._revision
    this._runs = new Map()
    for (let colIndex = 0; colIndex < columns.length; colIndex++) {
      const column = columns[colIndex]!
      if (!column.mergeRows) continue
      const runs: GridRowMergeRun[] = []
      let start = -1
      const flush = (end: number) => {
        if (start < 0 || end <= start) return
        const anchor = items[start]!
        const tail = items[end]!
        if (anchor.kind !== 'data' || tail.kind !== 'data') return
        runs.push({ columnKey: column.key, startItemIndex: start, endItemIndex: end,
          anchorDataRowIndex: anchor.dataRowIndex, endDataRowIndex: tail.dataRowIndex })
      }
      for (let i = 0; i < items.length; i++) {
        const current = items[i]!
        const previous = items[i - 1]
        const join = current.kind === 'data' && previous?.kind === 'data' &&
          current.pathKey === previous.pathKey &&
          !this._cellError(current.dataRowIndex, column.key) &&
          !this._cellError(previous.dataRowIndex, column.key) &&
          samePolicy(this._basePolicy(previous.dataRowIndex, colIndex), this._basePolicy(current.dataRowIndex, colIndex)) &&
          this.compare(column, previous.row, current.row)
        if (!join) {
          flush(i - 1)
          start = current.kind === 'data' ? i : -1
        }
      }
      flush(items.length - 1)
      this._runs.set(column.key, runs)
    }
  }

  private compare(column: GridColumnDef<T>, previousRow: T, currentRow: T): boolean {
    const previousValue = previousRow[column.key]
    const currentValue = currentRow[column.key]
    if (typeof column.mergeRows === 'function') {
      try { return column.mergeRows({ column, previousRow, currentRow, previousValue, currentValue }) }
      catch { return false }
    }
    if (previousValue == null || previousValue === '' || currentValue == null || currentValue === '') return false
    return sameGridFilterValue(previousValue, currentValue, column)
  }
}

function samePolicy(left: GridResolvedCellEditPolicy, right: GridResolvedCellEditPolicy): boolean {
  return left.state === right.state && left.tabStop === right.tabStop &&
    (left.reason?.trim() || '') === (right.reason?.trim() || '')
}
