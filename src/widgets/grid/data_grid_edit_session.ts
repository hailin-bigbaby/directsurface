import {
  runCleanupSteps,
  type Disposable,
  type DisposeFn,
} from '../../core/disposable'
import type { RenderDataGrid } from '../grid_view'
import type {
  GridCellDataChangeEvent,
  GridDataChangeEvent,
  GridRowId,
  GridRowKey,
  GridRowsAddedDataChangeEvent,
  GridRowsRemovedDataChangeEvent,
  GridRowsReplacedDataChangeEvent,
} from './grid_types'

export type DataGridRowEditState =
  | 'unchanged'
  | 'added'
  | 'modified'
  | 'deleted'

export interface DataGridEditSessionOptions<
  T extends Record<string, any>,
> {
  rowKey?: GridRowKey<T>
  preserveChangesOnRowsReplace?: boolean
  equals?: (
    key: keyof T & string,
    left: any,
    right: any,
    row: T,
  ) => boolean
  cloneValue?: (value: any, key: keyof T & string, row: T) => any
}

export interface DataGridCellChange<T extends Record<string, any>> {
  key: keyof T & string
  previousValue: any
  value: any
}

export interface DataGridAddedRowChange<T extends Record<string, any>> {
  row: T
  sourceRowIndex: number
}

export interface DataGridModifiedRowChange<T extends Record<string, any>> {
  row: T
  sourceRowIndex: number
  cells: readonly DataGridCellChange<T>[]
}

export interface DataGridDeletedRowChange<T extends Record<string, any>> {
  row: T
  originalSourceRowIndex: number
  cells: readonly DataGridCellChange<T>[]
}

export interface DataGridChangeSet<T extends Record<string, any>> {
  added: readonly DataGridAddedRowChange<T>[]
  modified: readonly DataGridModifiedRowChange<T>[]
  deleted: readonly DataGridDeletedRowChange<T>[]
}

export type DataGridEditSessionListener = () => void

interface RowEditRecord<T extends Record<string, any>> {
  row: T
  state: Exclude<DataGridRowEditState, 'unchanged'>
  originalValues: Map<keyof T & string, any>
  originalSourceRowIndex: number
  addedBeforeBaselineIndex: number
  addedSequence: number
  baselineIdentity: GridRowId | null
}

const defaultEquals = (left: any, right: any): boolean => Object.is(left, right)

/**
 * Tracks edits made through one RenderDataGrid without creating per-cell
 * objects. Row object identity is the default record identity; rowKey is only
 * used when explicitly reconciling edits across a rows replacement.
 */
export class DataGridEditSession<
  T extends Record<string, any>,
> implements Disposable {
  private readonly _grid: RenderDataGrid<T>
  private readonly _rowKey?: GridRowKey<T>
  private readonly _preserveChangesOnRowsReplace: boolean
  private readonly _equals: NonNullable<DataGridEditSessionOptions<T>['equals']>
  private readonly _cloneValue: NonNullable<DataGridEditSessionOptions<T>['cloneValue']>
  private readonly _listeners = new Set<DataGridEditSessionListener>()
  private readonly _disposeGridSubscription: DisposeFn
  private _baselineRows: T[]
  private _records = new Map<T, RowEditRecord<T>>()
  private _nextAddedSequence = 1
  private _touched = false
  private _disposed = false

  constructor(
    grid: RenderDataGrid<T>,
    options: DataGridEditSessionOptions<T> = {},
  ) {
    this._grid = grid
    this._rowKey = options.rowKey ?? grid.dataModel.rowKey
    this._preserveChangesOnRowsReplace =
      options.preserveChangesOnRowsReplace ?? false
    if (this._preserveChangesOnRowsReplace && !this._rowKey) {
      throw new Error(
        'DataGridEditSession requires rowKey when preserveChangesOnRowsReplace is enabled.',
      )
    }
    this._equals = options.equals ?? ((_, left, right) => defaultEquals(left, right))
    this._cloneValue = options.cloneValue ?? (value => value)
    this._baselineRows = [...grid.rows]
    this._disposeGridSubscription = grid.subscribeDataChange(event => {
      this._handleDataChange(event)
    })
  }

  get disposed(): boolean {
    return this._disposed
  }

  get isDirty(): boolean {
    return this._records.size > 0
  }

  get isTouched(): boolean {
    return this._touched
  }

  get changeCount(): number {
    return this._records.size
  }

  subscribe(listener: DataGridEditSessionListener): DisposeFn {
    this._assertActive()
    this._listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this._listeners.delete(listener)
    }
  }

  getRowState(row: T | number): DataGridRowEditState {
    this._assertActive()
    const resolved = typeof row === 'number' ? this._grid.rows[row] : row
    if (!resolved) return 'unchanged'
    return this._records.get(resolved)?.state ?? 'unchanged'
  }

  getChanges(): DataGridChangeSet<T> {
    this._assertActive()
    const added: DataGridAddedRowChange<T>[] = []
    const modified: DataGridModifiedRowChange<T>[] = []
    const deleted: DataGridDeletedRowChange<T>[] = []

    for (const record of this._records.values()) {
      if (record.state === 'added') {
        added.push({
          row: record.row,
          sourceRowIndex: this._grid.rows.indexOf(record.row),
        })
        continue
      }
      const cells = this._cellChanges(record)
      if (record.state === 'modified') {
        modified.push({
          row: record.row,
          sourceRowIndex: this._grid.rows.indexOf(record.row),
          cells,
        })
        continue
      }
      deleted.push({
        row: record.row,
        originalSourceRowIndex: record.originalSourceRowIndex,
        cells,
      })
    }

    added.sort((left, right) => left.sourceRowIndex - right.sourceRowIndex)
    modified.sort((left, right) => left.sourceRowIndex - right.sourceRowIndex)
    deleted.sort((left, right) =>
      left.originalSourceRowIndex - right.originalSourceRowIndex)
    return { added, modified, deleted }
  }

  resetRow(row: T): boolean {
    this._assertActive()
    const record = this._records.get(row)
    if (!record) return false
    const steps: DisposeFn[] = [
      () => this._grid.cancelEdit(),
    ]
    if (record.state === 'added') {
      steps.push(() => {
        const sourceRowIndex = this._grid.rows.indexOf(record.row)
        if (sourceRowIndex >= 0) {
          this._grid.dataModel.removeRows(
            [sourceRowIndex],
            { origin: 'session' },
          )
        }
      })
    } else if (record.state === 'modified') {
      steps.push(() => this._restoreRecordValues(record))
    } else {
      steps.push(
        () => {
          const insertIndex = this._restoreInsertIndex(record)
          this._grid.dataModel.addRows(
            [record.row],
            insertIndex,
            { origin: 'session' },
          )
        },
        () => this._restoreRecordValues(record),
      )
    }
    steps.push(
      () => {
        this._records.delete(record.row)
      },
      () => this._notify(),
    )
    runCleanupSteps(steps)
    return true
  }

  reset(): void {
    this._assertActive()
    const hadState = this.isDirty || this._touched
    const added = [...this._records.values()]
      .filter(record => record.state === 'added')
    const deleted = [...this._records.values()]
      .filter(record => record.state === 'deleted')
      .sort((left, right) =>
        left.originalSourceRowIndex - right.originalSourceRowIndex)
    const modified = [...this._records.values()]
      .filter(record => record.state === 'modified')

    const steps: DisposeFn[] = [
      () => this._grid.cancelEdit(),
      () => {
        const indices = added
          .map(record => this._grid.rows.indexOf(record.row))
          .filter(index => index >= 0)
        if (indices.length > 0) {
          this._grid.dataModel.removeRows(indices, { origin: 'session' })
        }
      },
      ...deleted.flatMap(record => [
        () => {
          const insertIndex = Math.max(
            0,
            Math.min(
              this._grid.rows.length,
              record.originalSourceRowIndex,
            ),
          )
          this._grid.dataModel.addRows(
            [record.row],
            insertIndex,
            { origin: 'session' },
          )
        },
        () => this._restoreRecordValues(record),
      ]),
      ...modified.map(record => () => this._restoreRecordValues(record)),
      () => {
        this._records.clear()
        this._touched = false
      },
      ...(
        hadState
          ? [() => this._notify()]
          : []
      ),
    ]
    runCleanupSteps(steps)
  }

  acceptChanges(): boolean {
    this._assertActive()
    if (!this._grid.commitEdit()) return false
    const hadState = this.isDirty || this._touched
    this._baselineRows = [...this._grid.rows]
    this._records.clear()
    this._touched = false
    if (hadState) this._notify()
    return true
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._disposeGridSubscription()
    this._listeners.clear()
    this._records.clear()
    this._baselineRows = []
  }

  private _handleDataChange(event: GridDataChangeEvent<T>): void {
    if (this._disposed || event.origin === 'session') return
    if (event.kind === 'cell') {
      this._handleCellChange(event)
      return
    }
    if (event.kind === 'rows-added') {
      this._handleRowsAdded(event)
      return
    }
    if (event.kind === 'rows-removed') {
      this._handleRowsRemoved(event)
      return
    }
    this._handleRowsReplaced(event)
  }

  private _handleCellChange(event: GridCellDataChangeEvent<T>): void {
    let record = this._records.get(event.row)
    if (!record) {
      record = this._createRecord(event.row, 'modified', event.sourceRowIndex)
      record.baselineIdentity = this._baselineIdentityForCellChange(event)
      this._records.set(event.row, record)
    }
    if (record.state === 'deleted') return
    if (record.state !== 'added' && !record.originalValues.has(event.key)) {
      record.originalValues.set(
        event.key,
        this._cloneValue(event.previousValue, event.key, event.row),
      )
    }
    if (record.state === 'modified') {
      const originalValue = record.originalValues.get(event.key)
      if (this._equals(event.key, event.value, originalValue, event.row)) {
        record.originalValues.delete(event.key)
      }
      if (record.originalValues.size === 0) {
        this._records.delete(event.row)
      }
    }
    this._touched = true
    this._notify()
  }

  private _handleRowsAdded(event: GridRowsAddedDataChangeEvent<T>): void {
    for (const entry of event.entries) {
      const current = this._records.get(entry.row)
      if (current?.state === 'deleted') {
        if (current.originalValues.size === 0) {
          this._records.delete(entry.row)
        } else {
          current.state = 'modified'
        }
        continue
      }
      if (current) continue
      const record = this._createRecord(entry.row, 'added', -1)
      record.addedBeforeBaselineIndex =
        this._baselineInsertionAnchor(entry.sourceRowIndex)
      record.addedSequence = this._nextAddedSequence++
      this._records.set(entry.row, record)
    }
    this._touched = true
    this._notify()
  }

  private _handleRowsRemoved(event: GridRowsRemovedDataChangeEvent<T>): void {
    for (const entry of event.entries) {
      const current = this._records.get(entry.row)
      if (current?.state === 'added') {
        this._records.delete(entry.row)
        continue
      }
      if (current) {
        current.state = 'deleted'
        continue
      }
      this._records.set(
        entry.row,
        this._createRecord(entry.row, 'deleted', entry.sourceRowIndex),
      )
    }
    this._touched = true
    this._notify()
  }

  private _handleRowsReplaced(event: GridRowsReplacedDataChangeEvent<T>): void {
    if (
      this._preserveChangesOnRowsReplace
      && this._rowKey
      && this._records.size > 0
    ) {
      this._reconcileRowsReplacement(event)
      return
    }
    const hadState = this.isDirty || this._touched
    this._baselineRows = [...event.rows]
    this._records.clear()
    this._touched = false
    if (hadState) this._notify()
  }

  private _reconcileRowsReplacement(
    event: GridRowsReplacedDataChangeEvent<T>,
  ): void {
    const rowKey = this._rowKey
    if (!rowKey) return
    const replacementRows = [...event.rows]
    const replacementById = new Map<GridRowId, T>()
    for (const row of replacementRows) {
      const identity = this._identityForRow(row, rowKey)
      if (identity === null || replacementById.has(identity)) {
        this._baselineRows = replacementRows
        this._records.clear()
        this._touched = false
        this._notify()
        return
      }
      replacementById.set(identity, row)
    }

    const previousRecords = [...this._records.values()]
    const nextRecords = new Map<T, RowEditRecord<T>>()
    this._baselineRows = replacementRows

    for (const record of previousRecords) {
      const identity = record.state === 'added'
        ? this._identityForRow(record.row, rowKey)
        : record.baselineIdentity
      const replacement = identity === null
        ? undefined
        : replacementById.get(identity)

      if (record.state === 'added') {
        if (replacement) continue
        this._grid.dataModel.addRows(
          [record.row],
          undefined,
          { origin: 'session' },
        )
        record.addedBeforeBaselineIndex = replacementRows.length
        nextRecords.set(record.row, record)
        continue
      }

      if (record.state === 'deleted') {
        if (!replacement) continue
        const sourceRowIndex = this._grid.rows.indexOf(replacement)
        if (sourceRowIndex >= 0) {
          this._grid.dataModel.removeRows(
            [sourceRowIndex],
            { origin: 'session' },
          )
        }
        record.row = replacement
        record.originalValues.clear()
        record.originalSourceRowIndex = replacementRows.indexOf(replacement)
        nextRecords.set(replacement, record)
        continue
      }

      if (!replacement) {
        this._grid.dataModel.addRows(
          [record.row],
          undefined,
          { origin: 'session' },
        )
        record.state = 'added'
        record.originalValues.clear()
        record.originalSourceRowIndex = -1
        record.addedBeforeBaselineIndex = replacementRows.length
        nextRecords.set(record.row, record)
        continue
      }

      const localValues = [...record.originalValues.keys()].map(key => ({
        key,
        value: record.row[key],
      }))
      const rebasedOriginalValues = new Map<keyof T & string, any>()
      for (const local of localValues) {
        const baselineValue = replacement[local.key]
        if (this._equals(local.key, local.value, baselineValue, replacement)) {
          continue
        }
        rebasedOriginalValues.set(
          local.key,
          this._cloneValue(baselineValue, local.key, replacement),
        )
        const sourceRowIndex = this._grid.rows.indexOf(replacement)
        if (sourceRowIndex >= 0) {
          this._grid.dataModel.setSourceCellValue(
            sourceRowIndex,
            local.key,
            local.value,
            { invalidate: 'cell', origin: 'session' },
          )
        }
      }
      if (rebasedOriginalValues.size === 0) continue
      record.row = replacement
      record.originalValues = rebasedOriginalValues
      record.originalSourceRowIndex = replacementRows.indexOf(replacement)
      nextRecords.set(replacement, record)
    }

    this._records = nextRecords
    if (this._records.size === 0) this._touched = false
    this._notify()
  }

  private _createRecord(
    row: T,
    state: Exclude<DataGridRowEditState, 'unchanged'>,
    sourceRowIndex: number,
  ): RowEditRecord<T> {
    return {
      row,
      state,
      originalValues: new Map(),
      originalSourceRowIndex: this._baselineRows.indexOf(row) >= 0
        ? this._baselineRows.indexOf(row)
        : sourceRowIndex,
      addedBeforeBaselineIndex: this._baselineRows.length,
      addedSequence: 0,
      baselineIdentity: this._rowKey
        ? this._identityForRow(row, this._rowKey)
        : null,
    }
  }

  private _cellChanges(
    record: RowEditRecord<T>,
  ): readonly DataGridCellChange<T>[] {
    return [...record.originalValues].map(([key, previousValue]) => ({
      key,
      previousValue,
      value: record.row[key],
    }))
  }

  private _restoreRecordValues(record: RowEditRecord<T>): void {
    for (const [key, value] of record.originalValues) {
      const sourceRowIndex = this._grid.rows.indexOf(record.row)
      if (sourceRowIndex < 0) continue
      this._grid.dataModel.setSourceCellValue(
        sourceRowIndex,
        key,
        value,
        { invalidate: 'cell', origin: 'session' },
      )
    }
  }

  private _baselineInsertionAnchor(sourceRowIndex: number): number {
    for (
      let index = Math.max(0, sourceRowIndex + 1);
      index < this._grid.rows.length;
      index++
    ) {
      const baselineIndex = this._baselineRows.indexOf(this._grid.rows[index]!)
      if (baselineIndex >= 0) return baselineIndex
    }
    return this._baselineRows.length
  }

  private _restoreInsertIndex(record: RowEditRecord<T>): number {
    const targetRank: readonly [number, number, number] = [
      record.originalSourceRowIndex,
      1,
      0,
    ]
    for (let index = 0; index < this._grid.rows.length; index++) {
      const current = this._grid.rows[index]!
      const currentRecord = this._records.get(current)
      const currentRank: readonly [number, number, number] =
        currentRecord?.state === 'added'
          ? [
              currentRecord.addedBeforeBaselineIndex,
              0,
              currentRecord.addedSequence,
            ]
          : [
              Math.max(0, this._baselineRows.indexOf(current)),
              1,
              0,
            ]
      if (compareRank(currentRank, targetRank) > 0) return index
    }
    return this._grid.rows.length
  }

  private _identityForRow(
    row: T,
    rowKey: GridRowKey<T>,
  ): GridRowId | null {
    const raw = typeof rowKey === 'function'
      ? rowKey(row)
      : row[rowKey]
    return typeof raw === 'string' || typeof raw === 'number'
      ? raw
      : null
  }

  private _baselineIdentityForCellChange(
    event: GridCellDataChangeEvent<T>,
  ): GridRowId | null {
    const rowKey = this._rowKey
    if (!rowKey) return null
    if (rowKey === this._grid.dataModel.rowKey) {
      return event.previousRowId
    }
    if (typeof rowKey === 'string' && event.key === rowKey) {
      const raw = event.previousValue
      return typeof raw === 'string' || typeof raw === 'number'
        ? raw
        : null
    }
    return this._identityForRow(event.row, rowKey)
  }

  private _notify(): void {
    if (this._disposed) return
    runCleanupSteps(
      [...this._listeners].map(listener => () => listener()),
    )
  }

  private _assertActive(): void {
    if (this._disposed) {
      throw new Error('DataGridEditSession has been disposed.')
    }
  }
}

function compareRank(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < left.length; index++) {
    const delta = left[index]! - right[index]!
    if (delta !== 0) return delta
  }
  return 0
}
