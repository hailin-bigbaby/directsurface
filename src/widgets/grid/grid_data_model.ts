import { runCleanupSteps } from '../../core/disposable'
import type {
  GridDataChangeEvent,
  GridDataChangeListener,
  GridDataChangeOrigin,
  GridCellDisplayTextArgs,
  GridColumnDef,
  GridDataItem,
  GridFilterRule,
  GridDistinctFilterValues,
  GridFilterValue,
  GridGroupDef,
  GridGroupItem,
  GridRowId,
  GridRowKey,
  GridSortDescriptor,
  GridSortState,
  GridSummaryCellDebugState,
  GridSummaryDef,
  GridVisibleItem,
} from './grid_types'
import { defaultGridCellDisplayText } from './grid_display_resolver'
import {
  gridFilterValueKey,
  gridFilterValueKeyForColumn,
  sameGridFilterValue,
} from './grid_filter_values'
import {
  gridColumnUsesRawFilterEquality,
  gridFilterComparableValue,
} from './grid_filter_condition'
import { GridLookupValueResolver } from './lookup_value_index'

export interface GridDataModelOptions<T extends Record<string, any>> {
  columns: GridColumnDef<T>[]
  rows: T[]
  rowKey?: GridRowKey<T>
  groupBy?: GridGroupDef<T>[]
  defaultGroupExpanded?: boolean
  sortable?: boolean
  sort?: GridSortDescriptor[]
  filters?: GridFilterRule[]
  quickFilter?: string
  summary?: GridSummaryDef<T>[]
  getCellDisplayText?: (args: GridCellDisplayTextArgs<T>) => string | null | undefined
  onCellChange?: (row: T, key: keyof T & string, value: any) => void
}

export type GridDataModelInvalidationReason =
  | 'columns'
  | 'rows'
  | 'sort'
  | 'filter'
  | 'group'
  | 'cell'
  | 'addRows'
  | 'removeRows'
  | 'summary'

interface IndexedRow<T extends Record<string, any>> {
  row: T
  index: number
  rowId: GridRowId | null
}

interface GroupTreeNode<T extends Record<string, any>> {
  depth: number
  pathKey: string
  parentPathKey: string | null
  groupKey: keyof T & string
  groupValue: unknown
  childCount: number
  rows: Array<IndexedRow<T>>
  children: Array<GroupTreeNode<T>>
}

interface PreparedGridColumnFilter<T extends Record<string, any>> {
  key: string
  column: GridColumnDef<T>
  needle: string
}

interface PreparedGridFilterRule<T extends Record<string, any>> {
  column: GridColumnDef<T>
  rule: GridFilterRule
  textFilter: string
}

interface GridFilterMatchContext<T extends Record<string, any>> {
  columnFilters: Array<PreparedGridColumnFilter<T>>
  rules: Array<PreparedGridFilterRule<T>>
  quickFilter: string
  quickFilterColumns: Array<GridColumnDef<T>>
}

interface GridDistinctFilterValuesCacheEntry {
  columnKey: string
  limit: number
  result: GridDistinctFilterValues
}

type MutableGridFilterValue = {
  -readonly [Key in keyof GridFilterValue]: GridFilterValue[Key]
}

const MAX_DISTINCT_FILTER_VALUES_CACHE_ENTRIES = 2

export class GridDataModel<T extends Record<string, any> = any> {
  readonly lookupValues: GridLookupValueResolver<T>
  private _columns: GridColumnDef<T>[]
  private _rows: T[]
  private _rowKey?: GridRowKey<T>
  private _groupBy: GridGroupDef<T>[]
  private _defaultGroupExpanded: boolean
  private _flatRowsCache: Array<IndexedRow<T>> | null = null
  private _groupTreeCache: Array<GroupTreeNode<T>> | null = null
  private _visibleRowsCache: T[] | null = null
  private _visibleRowIndicesCache: number[] | null = null
  private _visibleRowIdsCache: Array<GridRowId | null> | null = null
  private _visibleItemsCache: Array<GridVisibleItem<T>> | null = null
  private _visibleRowItemIndicesCache: number[] | null = null
  private _visibleItemRowIndicesCache: number[] | null = null
  private _visibleItemPathIndexCache: Map<string, number> | null = null
  private _allGroupPathKeysCache: string[] | null = null
  private _rowIdSourceIndexCache: Map<GridRowId, number> | null = null
  private _summaryAggregateCache: number[] | null = null
  private _summaryRowsCache: T[] | null = null
  private _distinctFilterValuesCache: GridDistinctFilterValuesCacheEntry[] = []
  private _filterValues = new Map<string, string>()
  private _filters: GridFilterRule[] = []
  private _quickFilter = ''
  private _summary: GridSummaryDef<T>[] = []
  private _getCellDisplayText?: (args: GridCellDisplayTextArgs<T>) => string | null | undefined
  private _groupExpansionOverrides = new Map<string, boolean>()
  private _sortState: GridSortState = { key: '', order: null }
  private _sort: GridSortDescriptor[] = []
  private readonly _dataChangeListeners = new Set<GridDataChangeListener<T>>()
  private _disposed = false

  sortable: boolean
  onCellChange?: (row: T, key: keyof T & string, value: any) => void
  onVisibleRowsInvalidated?: (reason: GridDataModelInvalidationReason) => void

  constructor(options: GridDataModelOptions<T>) {
    this._columns = options.columns
    this.lookupValues = new GridLookupValueResolver(options.columns)
    this._rows = options.rows
    this._rowKey = options.rowKey
    this._groupBy = [...(options.groupBy ?? [])]
    this._defaultGroupExpanded = options.defaultGroupExpanded ?? true
    this.sortable = options.sortable ?? false
    this._sort = this.normalizeSortDescriptors(options.sort ?? [])
    this._sortState = this._sort[0]
      ? { ...this._sort[0] }
      : { key: '', order: null }
    this._filters = this.normalizeFilters(options.filters ?? [])
    this._quickFilter = options.quickFilter ?? ''
    this._summary = this.normalizeSummary(options.summary ?? [])
    this._getCellDisplayText = options.getCellDisplayText
    this.onCellChange = options.onCellChange
  }

  get columns(): GridColumnDef<T>[] { return this._columns }
  set columns(columns: GridColumnDef<T>[]) {
    if (this._columns === columns) return
    this._columns = columns
    this.lookupValues.syncColumns(columns)
    const columnKeys = new Set(columns.map(column => column.key))
    for (const key of this._filterValues.keys()) {
      if (!columnKeys.has(key)) this._filterValues.delete(key)
    }
    this._groupBy = this._groupBy.filter(group => this.visibleColumns().some(column => column.key === group.key))
    this._sort = this.normalizeSortDescriptors(this._sort)
    this._sortState = this._sort[0] ? { ...this._sort[0] } : { key: '', order: null }
    this._filters = this.normalizeFilters(this._filters)
    this._summary = this.normalizeSummary(this._summary)
    this.invalidateVisibleRows('columns')
  }

  get rows(): T[] { return this._rows }
  set rows(rows: T[]) {
    const previousRows = this._rows
    this._rows = rows
    this.invalidateVisibleRows('rows')
    this.emitDataChange({
      kind: 'rows-replaced',
      origin: 'external',
      previousRows,
      rows,
    })
  }

  get rowKey(): GridRowKey<T> | undefined { return this._rowKey }

  hasRowKey(): boolean {
    return this._rowKey !== undefined
  }

  get groupBy(): GridGroupDef<T>[] {
    return this._groupBy.map(group => ({ ...group }))
  }
  set groupBy(groupBy: GridGroupDef<T>[]) {
    const normalized = this.normalizeGroupBy(groupBy)
    if (this.sameGroupBy(normalized, this._groupBy)) return
    this._groupBy = normalized
    this._sort = this.normalizeSortDescriptors(this._sort)
    this._sortState = this._sort[0] ? { ...this._sort[0] } : { key: '', order: null }
    this.invalidateVisibleRows('group')
  }

  get defaultGroupExpanded(): boolean { return this._defaultGroupExpanded }
  set defaultGroupExpanded(value: boolean) {
    if (value === this._defaultGroupExpanded) return
    this._defaultGroupExpanded = value
    this.invalidateVisibleProjection('group')
  }

  get sortState(): GridSortState { return { ...this._sortState } }
  set sortState(sortState: GridSortState) {
    const normalized = this.normalizeSortState(sortState)
    if (
      normalized.key === this._sortState.key &&
      normalized.order === this._sortState.order
    ) {
      return
    }
    this._sortState = normalized
    this._sort = normalized.order ? [{ key: normalized.key, order: normalized.order }] : []
    this.invalidateVisibleRows('sort')
  }

  get sortDescriptors(): GridSortDescriptor[] {
    return this._sort.map(sort => ({ ...sort }))
  }
  set sortDescriptors(sort: GridSortDescriptor[]) {
    const normalized = this.normalizeSortDescriptors(sort)
    if (this.sameSortDescriptors(normalized, this._sort)) return
    this._sort = normalized
    this._sortState = normalized[0] ? { ...normalized[0] } : { key: '', order: null }
    this.invalidateVisibleRows('sort')
  }

  get filterValues(): ReadonlyMap<string, string> {
    return this._filterValues
  }

  get filters(): GridFilterRule[] {
    return this._filters.map(filter => ({
      ...filter,
      values: filter.values ? [...filter.values] : undefined,
    }))
  }
  set filters(filters: GridFilterRule[]) {
    const normalized = this.normalizeFilters(filters)
    if (this.sameFilters(normalized, this._filters)) return
    this._filters = normalized
    this.invalidateVisibleRows('filter')
  }

  get quickFilter(): string { return this._quickFilter }
  set quickFilter(value: string) {
    const next = value ?? ''
    if (next === this._quickFilter) return
    this._quickFilter = next
    this.invalidateVisibleRows('filter')
  }

  get getCellDisplayText():
    | ((args: GridCellDisplayTextArgs<T>) => string | null | undefined)
    | undefined {
    return this._getCellDisplayText
  }
  set getCellDisplayText(value:
    | ((args: GridCellDisplayTextArgs<T>) => string | null | undefined)
    | undefined) {
    if (this._getCellDisplayText === value) return
    this._getCellDisplayText = value
    if (this._quickFilter) this.invalidateVisibleRows('filter')
  }

  get summary(): GridSummaryDef<T>[] {
    return this._summary.map(def => ({ ...def }))
  }
  set summary(summary: GridSummaryDef<T>[]) {
    const normalized = this.normalizeSummary(summary)
    if (this.sameSummary(normalized, this._summary)) return
    this._summary = normalized
    this.invalidateSummaryCache()
    this.invalidateVisibleProjection('summary')
  }

  visibleRows(): T[] {
    this.ensureVisibleCaches()
    return this._visibleRowsCache ?? []
  }

  visibleRowIndices(): number[] {
    this.ensureVisibleCaches()
    return this._visibleRowIndicesCache ?? []
  }

  visibleRowIds(): Array<GridRowId | null> {
    this.ensureVisibleCaches()
    return this._visibleRowIdsCache ?? []
  }

  visibleItems(): Array<GridVisibleItem<T>> {
    this.ensureVisibleCaches()
    return this._visibleItemsCache ?? []
  }

  visibleItemAt(itemIndex: number): GridVisibleItem<T> | null {
    return this.visibleItems()[itemIndex] ?? null
  }

  visibleRowIndex(visibleIndex: number): number {
    return this.visibleRowIndices()[visibleIndex] ?? -1
  }

  visibleRowId(visibleIndex: number): GridRowId | null {
    return this.visibleRowIds()[visibleIndex] ?? null
  }

  visibleRowIndexForRowId(rowId: GridRowId): number {
    return this.visibleRowIds().findIndex(id => id === rowId)
  }

  sourceRowIndexForRowId(rowId: GridRowId): number {
    return this.rowIdSourceIndex().get(rowId) ?? -1
  }

  rowIdForSourceIndex(sourceIndex: number): GridRowId | null {
    const row = this._rows[sourceIndex]
    return row ? this.rowIdForRow(row) : null
  }

  rowIdForRow(row: T | null | undefined): GridRowId | null {
    if (!row || !this._rowKey) return null
    const raw = typeof this._rowKey === 'function'
      ? this._rowKey(row)
      : (row as any)[this._rowKey]
    return typeof raw === 'string' || typeof raw === 'number' ? raw : null
  }

  visibleItemCount(): number {
    return this.visibleItems().length
  }

  visibleRowCount(): number {
    return this.visibleRows().length
  }

  filteredRows(): T[] {
    return this.ensureFlatRows().map(entry => entry.row)
  }

  refreshLookup(columnKey?: string): boolean {
    const refreshed = this.lookupValues.refresh(this._columns, columnKey)
    if (refreshed) this.invalidateVisibleRows('cell')
    return refreshed
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._distinctFilterValuesCache = []
    this._dataChangeListeners.clear()
    this.lookupValues.clear()
  }

  subscribeDataChange(listener: GridDataChangeListener<T>): () => void {
    if (this._disposed) {
      throw new Error('Grid data model has been disposed.')
    }
    this._dataChangeListeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this._dataChangeListeners.delete(listener)
    }
  }

  distinctFilterValues(key: string, limit = 10_000): GridDistinctFilterValues {
    const safeLimit = Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 10_000))
    const cached = this.getCachedDistinctFilterValues(key, safeLimit)
    if (cached) return cached

    const columnsByKey = new Map(this._columns.map(column => [column.key, column]))
    const column = columnsByKey.get(key)
    if (!column || column.hidden) return { values: [], truncated: false }
    const filterContext = this.prepareFilterMatchContext(key, columnsByKey)
    const values = new Map<string, MutableGridFilterValue>()
    let truncated = false

    for (let sourceIndex = 0; sourceIndex < this._rows.length; sourceIndex++) {
      const row = this._rows[sourceIndex]!
      if (!this.rowMatchesPreparedFilters(row, sourceIndex, filterContext)) continue
      const rawValue = (row as any)[key]
      const blank = rawValue == null || rawValue === ''
      const value = blank ? null : rawValue
      const valueKey = gridFilterValueKeyForColumn(value, column, blank)
      const existing = values.get(valueKey)
      if (existing) {
        existing.count += 1
        continue
      }
      if (values.size >= safeLimit) {
        truncated = true
        continue
      }
      const defaultDisplayText = defaultGridCellDisplayText(column, row, sourceIndex, this.lookupValues)
      values.set(valueKey, {
        key: valueKey,
        value,
        text: blank
          ? '(空白)'
          : column.filterValueFormatter?.(value, row, defaultDisplayText) ?? defaultDisplayText,
        blank,
        count: 1,
      })
    }

    const result: GridDistinctFilterValues = {
      values: [...values.values()].sort((left, right) => this.compareDistinctFilterValues(column, left, right)),
      truncated,
    }
    const protectedResult = this.protectDistinctFilterValues(result)
    this.cacheDistinctFilterValues(key, safeLimit, protectedResult)
    return protectedResult
  }

  summaryCells(rows?: T[]): GridSummaryCellDebugState[] {
    const sourceRows = rows ?? (this._summaryRowsCache ??= this.filteredRows())
    const aggregates = rows === undefined
      ? (this._summaryAggregateCache ??= this._summary.map(def => this.aggregateRows(sourceRows, def)))
      : this._summary.map(def => this.aggregateRows(sourceRows, def))
    return this._summary.map((def, index) => {
      const value = aggregates[index] ?? 0
      return {
        key: def.key,
        aggregate: def.aggregate,
        value,
        text: def.formatter?.(value, sourceRows, def) ?? this.defaultSummaryText(value, def),
      }
    })
  }

  visibleItemIndexForVisibleRow(rowIndex: number): number {
    this.ensureVisibleCaches()
    return this._visibleRowItemIndicesCache?.[rowIndex] ?? -1
  }

  visibleRowIndexForItem(itemIndex: number): number {
    this.ensureVisibleCaches()
    return this._visibleItemRowIndicesCache?.[itemIndex] ?? -1
  }

  visibleItemIndexForPathKey(pathKey: string): number {
    this.ensureVisibleCaches()
    return this._visibleItemPathIndexCache?.get(pathKey) ?? -1
  }

  isGroupedColumn(key: string): boolean {
    return this._groupBy.some(group => group.key === key)
  }

  visibleGroupPathKeys(): string[] {
    this.ensureVisibleCaches()
    return [...(this._allGroupPathKeysCache ?? [])]
  }

  expandAllGroups(): boolean {
    const allPathKeys = this.visibleGroupPathKeys()
    let changed = false
    for (const pathKey of allPathKeys) {
      if (!this.setGroupExpanded(pathKey, true, false)) continue
      changed = true
    }
    if (!changed) return false
    this.invalidateVisibleProjection('group')
    return true
  }

  collapseAllGroups(): boolean {
    const allPathKeys = this.visibleGroupPathKeys()
    let changed = false
    for (const pathKey of allPathKeys) {
      if (!this.setGroupExpanded(pathKey, false, false)) continue
      changed = true
    }
    if (!changed) return false
    this.invalidateVisibleProjection('group')
    return true
  }

  toggleGroupExpanded(pathKey: string): boolean {
    return this.setGroupExpanded(pathKey, !this.isGroupExpanded(pathKey))
  }

  setGroupExpanded(pathKey: string, expanded: boolean, invalidate = true): boolean {
    const current = this.isGroupExpanded(pathKey)
    if (current === expanded) return false
    if (expanded === this._defaultGroupExpanded) {
      this._groupExpansionOverrides.delete(pathKey)
    } else {
      this._groupExpansionOverrides.set(pathKey, expanded)
    }
    if (invalidate) this.invalidateVisibleProjection('group')
    return true
  }

  isGroupExpanded(pathKey: string): boolean {
    return this._groupExpansionOverrides.get(pathKey) ?? this._defaultGroupExpanded
  }

  getFilterValue(key: string): string {
    return this._filterValues.get(key) ?? ''
  }

  setFilterValue(key: string, value: string): boolean {
    const current = this._filterValues.get(key) ?? ''
    if (current === value) return false
    if (value) {
      this._filterValues.set(key, value)
    } else {
      this._filterValues.delete(key)
    }
    this.invalidateVisibleRows('filter')
    return true
  }

  clearAllFilters(): boolean {
    if (this._filterValues.size === 0 && this._filters.length === 0 && !this._quickFilter) return false
    this._filterValues.clear()
    this._filters = []
    this._quickFilter = ''
    this.invalidateVisibleRows('filter')
    return true
  }

  visibleColumns(): GridColumnDef<T>[] {
    return this._columns.filter(column => !column.hidden)
  }

  setCellValue(
    rowIndex: number,
    key: string,
    value: any,
    options: {
      invalidate?: GridDataModelInvalidationReason | false
      origin?: GridDataChangeOrigin
    } = {},
  ): boolean {
    const row = this.visibleRows()[rowIndex]
    if (!row) return false
    if (!(key in row) && !this._columns.some(column => column.key === key)) return false
    const previousValue = (row as any)[key]
    if (Object.is(previousValue, value)) return false
    const sourceRowIndex = this.visibleRowIndex(rowIndex)
    const previousRowId = this.rowIdForRow(row)
    ;(row as any)[key] = value
    const nextRowId = this.rowIdForRow(row)
    this.invalidateDistinctFilterValuesCache()
    this.invalidateSummaryCache()
    const invalidateReason = options.invalidate || (previousRowId !== nextRowId ? 'cell' : false)
    if (invalidateReason) this.invalidateVisibleRows(invalidateReason)
    this.emitDataChange({
      kind: 'cell',
      origin: options.origin ?? 'editor',
      row,
      sourceRowIndex,
      rowId: nextRowId,
      previousRowId,
      key: key as keyof T & string,
      previousValue,
      value,
    })
    return true
  }

  setSourceCellValue(
    sourceRowIndex: number,
    key: string,
    value: any,
    options: {
      invalidate?: GridDataModelInvalidationReason | false
      origin?: GridDataChangeOrigin
    } = {},
  ): boolean {
    const row = this._rows[sourceRowIndex]
    if (!row) return false
    if (!(key in row) && !this._columns.some(column => column.key === key)) return false
    const previousValue = (row as any)[key]
    if (Object.is(previousValue, value)) return false
    const previousRowId = this.rowIdForRow(row)
    ;(row as any)[key] = value
    const nextRowId = this.rowIdForRow(row)
    this.invalidateDistinctFilterValuesCache()
    this.invalidateSummaryCache()
    const invalidateReason = options.invalidate || (previousRowId !== nextRowId ? 'cell' : false)
    if (invalidateReason) this.invalidateVisibleRows(invalidateReason)
    this.emitDataChange({
      kind: 'cell',
      origin: options.origin ?? 'editor',
      row,
      sourceRowIndex,
      rowId: nextRowId,
      previousRowId,
      key: key as keyof T & string,
      previousValue,
      value,
    })
    return true
  }

  addRows(
    rows: T[],
    atIndex?: number,
    options: { origin?: GridDataChangeOrigin } = {},
  ): boolean {
    if (rows.length === 0) return false
    const insertIndex = Math.max(0, Math.min(this._rows.length, atIndex ?? this._rows.length))
    this._rows.splice(insertIndex, 0, ...rows)
    this.invalidateVisibleRows('addRows')
    this.emitDataChange({
      kind: 'rows-added',
      origin: options.origin ?? 'editor',
      entries: rows.map((row, index) => ({
        row,
        sourceRowIndex: insertIndex + index,
        rowId: this.rowIdForRow(row),
      })),
    })
    return true
  }

  removeRows(
    indices: Iterable<number>,
    options: { origin?: GridDataChangeOrigin } = {},
  ): boolean {
    const sourceIndices = [...new Set(indices)]
      .filter(index => index >= 0 && index < this._rows.length)
      .sort((left, right) => left - right)
    if (sourceIndices.length === 0) return false
    const entries = sourceIndices.map(sourceRowIndex => {
      const row = this._rows[sourceRowIndex]!
      return {
        row,
        sourceRowIndex,
        rowId: this.rowIdForRow(row),
      }
    })
    for (let index = sourceIndices.length - 1; index >= 0; index--) {
      this._rows.splice(sourceIndices[index]!, 1)
    }
    this.invalidateVisibleRows('removeRows')
    this.emitDataChange({
      kind: 'rows-removed',
      origin: options.origin ?? 'editor',
      entries,
    })
    return true
  }

  private emitDataChange(event: GridDataChangeEvent<T>): void {
    if (this._disposed) return
    const steps = event.kind === 'cell' && this.onCellChange
      ? [
          () => this.onCellChange?.(event.row, event.key, event.value),
          ...[...this._dataChangeListeners].map(listener => () => listener(event)),
        ]
      : [...this._dataChangeListeners].map(listener => () => listener(event))
    runCleanupSteps(steps)
  }

  invalidateVisibleRows(reason: GridDataModelInvalidationReason = 'rows'): void {
    if (this.invalidatesDistinctFilterValues(reason)) {
      this.invalidateDistinctFilterValuesCache()
    }
    this._flatRowsCache = null
    this._groupTreeCache = null
    this._allGroupPathKeysCache = null
    this._rowIdSourceIndexCache = null
    this.invalidateSummaryCache()
    this.invalidateVisibleProjection(reason)
  }

  private getCachedDistinctFilterValues(
    columnKey: string,
    limit: number,
  ): GridDistinctFilterValues | null {
    const index = this._distinctFilterValuesCache.findIndex(entry =>
      entry.columnKey === columnKey && entry.limit === limit)
    if (index < 0) return null
    const [entry] = this._distinctFilterValuesCache.splice(index, 1)
    this._distinctFilterValuesCache.push(entry!)
    return entry!.result
  }

  private cacheDistinctFilterValues(
    columnKey: string,
    limit: number,
    result: GridDistinctFilterValues,
  ): void {
    const existingIndex = this._distinctFilterValuesCache.findIndex(entry =>
      entry.columnKey === columnKey && entry.limit === limit)
    if (existingIndex >= 0) this._distinctFilterValuesCache.splice(existingIndex, 1)
    this._distinctFilterValuesCache.push({ columnKey, limit, result })
    while (this._distinctFilterValuesCache.length > MAX_DISTINCT_FILTER_VALUES_CACHE_ENTRIES) {
      this._distinctFilterValuesCache.shift()
    }
  }

  private invalidateDistinctFilterValuesCache(): void {
    this._distinctFilterValuesCache = []
  }

  private protectDistinctFilterValues(result: GridDistinctFilterValues): GridDistinctFilterValues {
    for (const value of result.values) Object.freeze(value)
    Object.freeze(result.values)
    Object.freeze(result)
    return result
  }

  private invalidatesDistinctFilterValues(reason: GridDataModelInvalidationReason): boolean {
    return reason === 'columns' ||
      reason === 'rows' ||
      reason === 'filter' ||
      reason === 'cell' ||
      reason === 'addRows' ||
      reason === 'removeRows'
  }

  private invalidateVisibleProjection(reason: GridDataModelInvalidationReason): void {
    this._visibleRowsCache = null
    this._visibleRowIndicesCache = null
    this._visibleRowIdsCache = null
    this._visibleItemsCache = null
    this._visibleRowItemIndicesCache = null
    this._visibleItemRowIndicesCache = null
    this._visibleItemPathIndexCache = null
    this.onVisibleRowsInvalidated?.(reason)
  }

  normalizeGroupBy(groupBy: GridGroupDef<T>[]): GridGroupDef<T>[] {
    const seen = new Set<string>()
    const normalized: GridGroupDef<T>[] = []
    const visibleColumns = this.visibleColumns()
    for (const group of groupBy) {
      if (!group?.key) continue
      if (seen.has(group.key)) continue
      if (!visibleColumns.some(column => column.key === group.key)) continue
      seen.add(group.key)
      normalized.push({
        key: group.key,
        order: group.order === 'desc' ? 'desc' : 'asc',
      })
    }
    return normalized
  }

  normalizeSortState(sortState: GridSortState): GridSortState {
    if (!this.sortable || !sortState.key || !sortState.order) {
      return { key: '', order: null }
    }
    if (this.isGroupedColumn(sortState.key)) return { key: '', order: null }
    const column = this.visibleColumns().find(col => col.key === sortState.key)
    if (!column?.sortable) return { key: '', order: null }
    return { key: sortState.key, order: sortState.order }
  }

  normalizeSortDescriptors(sort: GridSortDescriptor[]): GridSortDescriptor[] {
    if (!this.sortable) return []
    const seen = new Set<string>()
    const normalized: GridSortDescriptor[] = []
    const columns = this.visibleColumns()
    for (const descriptor of sort) {
      if (!descriptor?.key || seen.has(descriptor.key)) continue
      const column = columns.find(entry => entry.key === descriptor.key)
      if (!column?.sortable) continue
      if (this.isGroupedColumn(descriptor.key)) continue
      const order = descriptor.order === 'desc' ? 'desc' : descriptor.order === 'asc' ? 'asc' : null
      if (!order) continue
      seen.add(descriptor.key)
      normalized.push({ key: descriptor.key, order })
    }
    return normalized
  }

  normalizeFilters(filters: GridFilterRule[]): GridFilterRule[] {
    const columns = this._columns
    return filters
      .filter(filter => filter?.key && columns.some(column => column.key === filter.key))
      .map(filter => ({
        key: filter.key,
        operator: this.normalizeFilterOperator(filter.operator),
        value: filter.value,
        valueTo: filter.valueTo,
        values: filter.values ? [...filter.values] : undefined,
      }))
  }

  normalizeSummary(summary: GridSummaryDef<T>[]): GridSummaryDef<T>[] {
    const seen = new Set<string>()
    const columns = this.visibleColumns()
    const normalized: GridSummaryDef<T>[] = []
    for (const def of summary) {
      if (!def?.key) continue
      const column = columns.find(entry => entry.key === def.key)
      if (!column) continue
      const identity = `${def.key}:${def.aggregate}`
      if (seen.has(identity)) continue
      seen.add(identity)
      normalized.push({
        ...def,
        aggregate: this.normalizeAggregate(def.aggregate),
      })
    }
    return normalized
  }

  compareValues(a: unknown, b: unknown): number {
    if (a == null && b == null) return 0
    if (a == null) return -1
    if (b == null) return 1
    if (typeof a === 'number' && typeof b === 'number') {
      if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return 0
      if (Number.isNaN(a)) return -1
      if (Number.isNaN(b)) return 1
      return a < b ? -1 : 1
    }
    if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
    return String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  }

  groupPathKeyForRow(row: T): string | null {
    if (this._groupBy.length === 0) return null
    const parts = this._groupBy.map(group => ({
      key: group.key,
      value: (row as any)[group.key],
    }))
    return this.serializeGroupPath(parts)
  }

  private ensureVisibleCaches(): void {
    if (
      this._visibleRowsCache &&
      this._visibleRowIndicesCache &&
      this._visibleRowIdsCache &&
      this._visibleItemsCache &&
      this._visibleRowItemIndicesCache &&
      this._visibleItemRowIndicesCache &&
      this._visibleItemPathIndexCache &&
      this._allGroupPathKeysCache
    ) {
      return
    }

    const visibleRows: T[] = []
    const visibleRowIndices: number[] = []
    const visibleRowIds: Array<GridRowId | null> = []
    const visibleItems: Array<GridVisibleItem<T>> = []
    const visibleRowItemIndices: number[] = []
    const visibleItemRowIndices: number[] = []
    const visibleItemPathIndex = new Map<string, number>()
    const allGroupPathKeys = this._allGroupPathKeysCache ?? []

    if (this._groupBy.length === 0) {
      const flatRows = this.ensureFlatRows()
      for (const entry of flatRows) {
        const itemIndex = visibleItems.length
        const dataRowIndex = visibleRows.length
        visibleRows.push(entry.row)
        visibleRowIndices.push(entry.index)
        visibleRowIds.push(entry.rowId)
        visibleRowItemIndices.push(itemIndex)
        visibleItems.push({
          kind: 'data',
          depth: 0,
          pathKey: '',
          parentPathKey: null,
          row: entry.row,
          sourceIndex: entry.index,
          rowId: entry.rowId,
          dataRowIndex,
        })
        visibleItemRowIndices.push(dataRowIndex)
      }
      this._visibleRowsCache = visibleRows
      this._visibleRowIndicesCache = visibleRowIndices
      this._visibleRowIdsCache = visibleRowIds
      this._visibleItemsCache = visibleItems
      this._visibleRowItemIndicesCache = visibleRowItemIndices
      this._visibleItemRowIndicesCache = visibleItemRowIndices
      this._visibleItemPathIndexCache = visibleItemPathIndex
      this._allGroupPathKeysCache = allGroupPathKeys
      return
    }

    const groupTree = this.ensureGroupTree()
    if (!this._allGroupPathKeysCache) this.appendAllGroupPathKeys(groupTree, allGroupPathKeys)
    this.appendVisibleGroupNodes(
      groupTree,
      visibleRows,
      visibleRowIndices,
      visibleRowIds,
      visibleItems,
      visibleRowItemIndices,
      visibleItemRowIndices,
      visibleItemPathIndex,
    )

    this._visibleRowsCache = visibleRows
    this._visibleRowIndicesCache = visibleRowIndices
    this._visibleRowIdsCache = visibleRowIds
    this._visibleItemsCache = visibleItems
    this._visibleRowItemIndicesCache = visibleRowItemIndices
    this._visibleItemRowIndicesCache = visibleItemRowIndices
    this._visibleItemPathIndexCache = visibleItemPathIndex
    this._allGroupPathKeysCache = allGroupPathKeys
  }

  private ensureFlatRows(): Array<IndexedRow<T>> {
    if (this._flatRowsCache) return this._flatRowsCache
    const filteredRows = this.filterRows(this._rows.map((row, index) => ({
      row,
      index,
      rowId: this.rowIdForRow(row),
    })))
    this._flatRowsCache = this.sortRows(filteredRows)
    return this._flatRowsCache
  }

  private ensureGroupTree(): Array<GroupTreeNode<T>> {
    if (this._groupTreeCache) return this._groupTreeCache
    if (this._groupBy.length === 0) {
      this._groupTreeCache = []
      return this._groupTreeCache
    }
    this._groupTreeCache = this.buildGroupTree(this.ensureFlatRows(), 0, [], null)
    return this._groupTreeCache
  }

  private filterRows(rows: Array<IndexedRow<T>>): Array<IndexedRow<T>> {
    if (this._filterValues.size === 0 && this._filters.length === 0 && !this._quickFilter) return rows
    const filterContext = this.prepareFilterMatchContext()
    return rows.filter(({ row, index }) => this.rowMatchesPreparedFilters(row, index, filterContext))
  }

  private compareDistinctFilterValues(
    column: GridColumnDef<T>,
    left: GridFilterValue,
    right: GridFilterValue,
  ): number {
    if (left.blank !== right.blank) return left.blank ? 1 : -1
    if (column.type === 'number' || column.type === 'date' || column.type === 'time') {
      const leftComparable = gridFilterComparableValue(column, left.value)
      const rightComparable = gridFilterComparableValue(column, right.value)
      if (leftComparable !== null && rightComparable !== null) {
        const compared = leftComparable - rightComparable
        if (compared !== 0) return compared
      } else if (leftComparable !== rightComparable) {
        return leftComparable === null ? 1 : -1
      }
    } else if (column.type === 'checkbox') {
      const compared = this.compareValues(left.value, right.value)
      if (compared !== 0) return compared
    }
    return left.text.localeCompare(right.text, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  }

  private quickFilterCellText(
    column: GridColumnDef<T>,
    row: T,
    sourceRowIndex: number,
  ): string {
    return this.cellDisplayText(column, row, sourceRowIndex)
  }

  private cellDisplayText(column: GridColumnDef<T>, row: T, sourceRowIndex: number): string {
    const defaultDisplayText = defaultGridCellDisplayText(column, row, sourceRowIndex, this.lookupValues)
    return this._getCellDisplayText?.({
      row,
      rowId: this.rowIdForRow(row),
      selected: false,
      hovered: false,
      focused: false,
      editing: false,
      value: (row as any)[column.key],
      column,
      defaultDisplayText,
    }) ?? defaultDisplayText
  }

  private prepareFilterMatchContext(
    ignoredKey?: string,
    columnsByKey = new Map(this._columns.map(column => [column.key, column])),
  ): GridFilterMatchContext<T> {
    const columnFilters: Array<PreparedGridColumnFilter<T>> = []
    for (const [key, filter] of this._filterValues) {
      const column = columnsByKey.get(key)
      if (!filter || key === ignoredKey || !column) continue
      columnFilters.push({ key, column, needle: filter.toLowerCase() })
    }
    const rules: Array<PreparedGridFilterRule<T>> = []
    for (const filter of this._filters) {
      if (filter.key === ignoredKey) continue
      const column = columnsByKey.get(filter.key)
      if (!column) continue
      rules.push({
        column,
        rule: filter,
        textFilter: String(filter.value ?? '').toLowerCase(),
      })
    }
    return {
      columnFilters,
      rules,
      quickFilter: this._quickFilter.toLowerCase(),
      quickFilterColumns: this._quickFilter
        ? this._columns.filter(column => !column.hidden)
        : [],
    }
  }

  private rowMatchesPreparedFilters(
    row: T,
    sourceRowIndex: number,
    context: GridFilterMatchContext<T>,
  ): boolean {
    for (const filter of context.columnFilters) {
      const value = filter.column.type === 'time'
        ? defaultGridCellDisplayText(
            filter.column,
            row,
            sourceRowIndex,
            this.lookupValues,
          ).toLowerCase()
        : String((row as any)[filter.key] ?? '').toLowerCase()
      if (!value.includes(filter.needle)) return false
    }
    for (const prepared of context.rules) {
      if (!this.matchesFilter(
        (row as any)[prepared.rule.key],
        prepared.rule,
        prepared.column,
        row,
        prepared.textFilter,
      )) {
        return false
      }
    }
    if (
      context.quickFilter &&
      !context.quickFilterColumns.some(column =>
        this.quickFilterCellText(column, row, sourceRowIndex)
          .toLowerCase()
          .includes(context.quickFilter)
      )) return false
    return true
  }

  private sortRows(rows: Array<IndexedRow<T>>): Array<IndexedRow<T>> {
    const leafSort = this._sort.filter(sort => !this.isGroupedColumn(sort.key))
    if (rows.length <= 1) return rows
    const columnsByKey = new Map(this.visibleColumns().map(column => [column.key, column]))
    return [...rows].sort((left, right) => {
      for (const group of this._groupBy) {
        const compared = this.compareGroupValues(
          columnsByKey.get(group.key),
          left.row[group.key],
          right.row[group.key],
        )
        if (compared !== 0) return group.order === 'desc' ? -compared : compared
      }
      for (const sort of leafSort) {
        const compared = this.compareColumnValues(
          columnsByKey.get(sort.key),
          left.row[sort.key],
          right.row[sort.key],
        )
        if (compared !== 0) {
          return sort.order === 'desc' ? -compared : compared
        }
      }
      return left.index - right.index
    })
  }

  private matchesFilter(
    value: unknown,
    filter: GridFilterRule,
    column: GridColumnDef<T>,
    row: T,
    textFilter: string,
  ): boolean {
    if (filter.operator === 'empty') return value == null || String(value) === ''
    if (filter.operator === 'notEmpty') return value != null && String(value) !== ''
    if (filter.operator === 'in' || filter.operator === 'notIn') {
      const candidates = filter.values ?? []
      const matched = candidates.some(candidate => sameGridFilterValue(value, candidate, column))
      return filter.operator === 'in' ? matched : !matched
    }

    if (
      filter.operator === 'contains' ||
      filter.operator === 'startsWith' ||
      filter.operator === 'endsWith'
    ) {
      const textValue = defaultGridCellDisplayText(column, row, 0, this.lookupValues).toLowerCase()
      if (filter.operator === 'contains') return textValue.includes(textFilter)
      if (filter.operator === 'startsWith') return textValue.startsWith(textFilter)
      return textValue.endsWith(textFilter)
    }
    if (filter.operator === 'equals') {
      if (column.type === 'number' || column.type === 'date' || column.type === 'time') {
        return this.compareFilterComparableValues(column, value, filter.value) === 0
      }
      if (gridColumnUsesRawFilterEquality(column)) {
        return sameGridFilterValue(value, filter.value, column)
      }
      return defaultGridCellDisplayText(column, row, 0, this.lookupValues).toLowerCase() === textFilter
    }

    const compared = column.type === 'number' || column.type === 'date' || column.type === 'time'
      ? this.compareFilterComparableValues(column, value, filter.value)
      : this.compareValues(value, filter.value)
    if (compared === null) return false
    if (filter.operator === 'gt') return compared > 0
    if (filter.operator === 'gte') return compared >= 0
    if (filter.operator === 'lt') return compared < 0
    if (filter.operator === 'lte') return compared <= 0
    if (filter.operator === 'between') {
      const upperCompared = column.type === 'number' || column.type === 'date' || column.type === 'time'
        ? this.compareFilterComparableValues(column, value, filter.valueTo)
        : this.compareValues(value, filter.valueTo)
      return upperCompared !== null && compared >= 0 && upperCompared <= 0
    }
    return true
  }

  private compareFilterComparableValues(
    column: GridColumnDef<T>,
    left: unknown,
    right: unknown,
  ): number | null {
    const leftComparable = gridFilterComparableValue(column, left)
    const rightComparable = gridFilterComparableValue(column, right)
    if (leftComparable === null || rightComparable === null) return null
    return leftComparable - rightComparable
  }

  private aggregateRows(rows: T[], def: GridSummaryDef<T>): number {
    if (def.aggregate === 'count') return rows.length
    const values = rows
      .map(row => Number((row as any)[def.key]))
      .filter(value => Number.isFinite(value))
    if (values.length === 0) return 0
    if (def.aggregate === 'sum') return values.reduce((sum, value) => sum + value, 0)
    if (def.aggregate === 'avg') return values.reduce((sum, value) => sum + value, 0) / values.length
    if (def.aggregate === 'min') return Math.min(...values)
    if (def.aggregate === 'max') return Math.max(...values)
    return 0
  }

  private defaultSummaryText(value: number, def: GridSummaryDef<T>): string {
    const label = def.label ?? this.summaryAggregateLabel(def.aggregate)
    const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2)
    return `${label}: ${formatted}`
  }

  private groupSummaryText(rows: T[]): string {
    const cells = this.summaryCells(rows)
    if (cells.length === 0) return ''
    return cells.map(cell => cell.text).join('  ')
  }

  private summaryAggregateLabel(aggregate: GridSummaryDef<T>['aggregate']): string {
    if (aggregate === 'sum') return 'Sum'
    if (aggregate === 'avg') return 'Avg'
    if (aggregate === 'min') return 'Min'
    if (aggregate === 'max') return 'Max'
    return 'Count'
  }

  private normalizeFilterOperator(operator: GridFilterRule['operator']): GridFilterRule['operator'] {
    if (
      operator === 'equals' ||
      operator === 'in' ||
      operator === 'notIn' ||
      operator === 'startsWith' ||
      operator === 'endsWith' ||
      operator === 'gt' ||
      operator === 'gte' ||
      operator === 'lt' ||
      operator === 'lte' ||
      operator === 'between' ||
      operator === 'empty' ||
      operator === 'notEmpty'
    ) {
      return operator
    }
    return 'contains'
  }

  private normalizeAggregate(aggregate: GridSummaryDef<T>['aggregate']): GridSummaryDef<T>['aggregate'] {
    if (aggregate === 'avg' || aggregate === 'min' || aggregate === 'max' || aggregate === 'count') return aggregate
    return 'sum'
  }

  private buildGroupTree(
    rows: Array<IndexedRow<T>>,
    depth: number,
    parentParts: Array<{ key: string; value: unknown }>,
    parentPathKey: string | null,
  ): Array<GroupTreeNode<T>> {
    const group = this._groupBy[depth]!
    const column = this._columns.find(entry => entry.key === group.key)
    const nodes: Array<GroupTreeNode<T>> = []
    let startIndex = 0
    while (startIndex < rows.length) {
      const groupValue = rows[startIndex]!.row[group.key]
      let endIndex = startIndex + 1
      while (
        endIndex < rows.length &&
        this.sameGroupValue(column, rows[endIndex]!.row[group.key], groupValue)
      ) {
        endIndex++
      }

      const groupRows = rows.slice(startIndex, endIndex)
      const pathParts = [...parentParts, { key: group.key, value: groupValue }]
      const pathKey = this.serializeGroupPath(pathParts)
      const children = depth + 1 < this._groupBy.length
        ? this.buildGroupTree(groupRows, depth + 1, pathParts, pathKey)
        : []
      nodes.push({
        depth,
        pathKey,
        parentPathKey,
        childCount: groupRows.length,
        groupKey: group.key,
        groupValue,
        rows: groupRows,
        children,
      })

      startIndex = endIndex
    }
    return nodes
  }

  private appendVisibleGroupNodes(
    nodes: Array<GroupTreeNode<T>>,
    visibleRows: T[],
    visibleRowIndices: number[],
    visibleRowIds: Array<GridRowId | null>,
    visibleItems: Array<GridVisibleItem<T>>,
    visibleRowItemIndices: number[],
    visibleItemRowIndices: number[],
    visibleItemPathIndex: Map<string, number>,
  ): void {
    for (const node of nodes) {
      const groupItemIndex = visibleItems.length
      const expanded = this.isGroupExpanded(node.pathKey)
      const groupItem: GridGroupItem<T> = {
        kind: 'group',
        depth: node.depth,
        pathKey: node.pathKey,
        parentPathKey: node.parentPathKey,
        expanded,
        childCount: node.childCount,
        groupKey: node.groupKey,
        groupValue: node.groupValue,
        summary: this.summaryCells(node.rows.map(entry => entry.row)),
        summaryText: this.groupSummaryText(node.rows.map(entry => entry.row)),
      }
      visibleItems.push(groupItem)
      visibleItemPathIndex.set(node.pathKey, groupItemIndex)
      visibleItemRowIndices.push(-1)

      if (!expanded) continue

      if (node.children.length > 0) {
        this.appendVisibleGroupNodes(
          node.children,
          visibleRows,
          visibleRowIndices,
          visibleRowIds,
          visibleItems,
          visibleRowItemIndices,
          visibleItemRowIndices,
          visibleItemPathIndex,
        )
        continue
      }

      for (const entry of node.rows) {
        const itemIndex = visibleItems.length
        const dataRowIndex = visibleRows.length
        visibleRows.push(entry.row)
        visibleRowIndices.push(entry.index)
        visibleRowIds.push(entry.rowId)
        visibleRowItemIndices.push(itemIndex)
        visibleItems.push({
          kind: 'data',
          depth: node.depth + 1,
          pathKey: node.pathKey,
          parentPathKey: node.pathKey,
          row: entry.row,
          sourceIndex: entry.index,
          rowId: entry.rowId,
          dataRowIndex,
        })
        visibleItemRowIndices.push(dataRowIndex)
      }
    }
  }

  private appendAllGroupPathKeys(nodes: Array<GroupTreeNode<T>>, pathKeys: string[]): void {
    for (const node of nodes) {
      pathKeys.push(node.pathKey)
      if (node.children.length > 0) this.appendAllGroupPathKeys(node.children, pathKeys)
    }
  }

  private compareGroupValues(
    column: GridColumnDef<T> | undefined,
    left: unknown,
    right: unknown,
  ): number {
    const compared = this.compareColumnValues(column, left, right)
    if (compared !== 0) return compared
    const leftKey = column
      ? gridFilterValueKeyForColumn(left, column)
      : gridFilterValueKey(left, false)
    const rightKey = column
      ? gridFilterValueKeyForColumn(right, column)
      : gridFilterValueKey(right, false)
    if (leftKey === rightKey) return 0
    return leftKey < rightKey ? -1 : 1
  }

  private compareColumnValues(
    column: GridColumnDef<T> | undefined,
    left: unknown,
    right: unknown,
  ): number {
    if (column?.type === 'number' || column?.type === 'date' || column?.type === 'time') {
      const compared = this.compareFilterComparableValues(column, left, right)
      if (compared !== null) return compared
    }
    return this.compareValues(left, right)
  }

  private sameGroupValue(
    column: GridColumnDef<T> | undefined,
    left: unknown,
    right: unknown,
  ): boolean {
    return column
      ? sameGridFilterValue(left, right, column)
      : gridFilterValueKey(left, false) === gridFilterValueKey(right, false)
  }

  private serializeGroupPath(parts: Array<{ key: string; value: unknown }>): string {
    return JSON.stringify(parts.map(part => {
      const column = this._columns.find(entry => entry.key === part.key)
      const valueKey = column
        ? gridFilterValueKeyForColumn(part.value, column)
        : gridFilterValueKey(part.value, false)
      return [part.key, valueKey]
    }))
  }

  private rowIdSourceIndex(): Map<GridRowId, number> {
    if (this._rowIdSourceIndexCache) return this._rowIdSourceIndexCache
    const index = new Map<GridRowId, number>()
    for (let sourceIndex = 0; sourceIndex < this._rows.length; sourceIndex++) {
      const rowId = this.rowIdForRow(this._rows[sourceIndex])
      if (rowId !== null && !index.has(rowId)) index.set(rowId, sourceIndex)
    }
    this._rowIdSourceIndexCache = index
    return index
  }

  private sameGroupBy(left: GridGroupDef<T>[], right: GridGroupDef<T>[]): boolean {
    if (left.length !== right.length) return false
    return left.every((group, index) =>
      group.key === right[index]?.key &&
      (group.order ?? 'asc') === (right[index]?.order ?? 'asc')
    )
  }

  private sameSortDescriptors(left: GridSortDescriptor[], right: GridSortDescriptor[]): boolean {
    if (left.length !== right.length) return false
    return left.every((sort, index) =>
      sort.key === right[index]?.key &&
      sort.order === right[index]?.order
    )
  }

  private sameFilters(left: GridFilterRule[], right: GridFilterRule[]): boolean {
    if (left.length !== right.length) return false
    return left.every((filter, index) => {
      const other = right[index]
      return filter.key === other?.key &&
        filter.operator === other.operator &&
        Object.is(filter.value, other.value) &&
        Object.is(filter.valueTo, other.valueTo) &&
        this.sameFilterValues(filter.values, other.values)
    })
  }

  private sameFilterValues(left?: unknown[], right?: unknown[]): boolean {
    if (!left || !right) return left === right
    return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  }

  private sameSummary(left: GridSummaryDef<T>[], right: GridSummaryDef<T>[]): boolean {
    if (left.length !== right.length) return false
    return left.every((summary, index) => {
      const other = right[index]
      return summary.key === other?.key &&
        summary.aggregate === other.aggregate &&
        summary.label === other.label &&
        summary.formatter === other.formatter
    })
  }

  private invalidateSummaryCache(): void {
    this._summaryAggregateCache = null
    this._summaryRowsCache = null
  }
}
