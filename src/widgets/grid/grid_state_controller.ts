import type { Offset } from '../../core/render_object'
import type { ResolvedTheme } from '../../theme/theme'
import type {
  GridDataModel,
  GridDataModelInvalidationReason,
} from './grid_data_model'
import type { GridEditingController } from './grid_editing_controller'
import type { GridInteractionController } from './grid_interaction_controller'
import type { GridStructureEditController } from './grid_structure_edit_controller'
import type {
  GridColumnDef,
  GridDataChangeOrigin,
  GridFilterRule,
  GridGroupDef,
  GridSortDescriptor,
  GridSortState,
  GridVisibleItem,
} from './grid_types'
import type { GridViewport } from './grid_viewport'

export interface GridStateControllerOptions<T extends Record<string, any>> {
  dataModel: GridDataModel<T>
  viewport: GridViewport<T>
  editing: GridEditingController<T>
  interaction: GridInteractionController<T>
  structureEditing: GridStructureEditController<T>
  sortable: () => boolean
  getColumns: () => GridColumnDef<T>[]
  getCurrentTheme: () => ResolvedTheme
  getGlobalOffset: () => Offset
  onSyncEditingViewportState: () => void
  onInteractionStateChange?: () => void
  onMarkNeedsPaint: () => void
  onMarkNeedsLayout: () => void
}

export class GridStateController<T extends Record<string, any> = any> {
  private readonly _dataModel: GridDataModel<T>
  private readonly _viewport: GridViewport<T>
  private readonly _editing: GridEditingController<T>
  private readonly _interaction: GridInteractionController<T>
  private readonly _structureEditing: GridStructureEditController<T>
  private readonly _sortable: GridStateControllerOptions<T>['sortable']
  private readonly _getColumns: GridStateControllerOptions<T>['getColumns']
  private readonly _getCurrentTheme: GridStateControllerOptions<T>['getCurrentTheme']
  private readonly _getGlobalOffset: GridStateControllerOptions<T>['getGlobalOffset']
  private readonly _onSyncEditingViewportState: GridStateControllerOptions<T>['onSyncEditingViewportState']
  private readonly _onInteractionStateChange: () => void
  private readonly _onMarkNeedsPaint: GridStateControllerOptions<T>['onMarkNeedsPaint']
  private readonly _onMarkNeedsLayout: GridStateControllerOptions<T>['onMarkNeedsLayout']

  constructor(options: GridStateControllerOptions<T>) {
    this._dataModel = options.dataModel
    this._viewport = options.viewport
    this._editing = options.editing
    this._interaction = options.interaction
    this._structureEditing = options.structureEditing
    this._sortable = options.sortable
    this._getColumns = options.getColumns
    this._getCurrentTheme = options.getCurrentTheme
    this._getGlobalOffset = options.getGlobalOffset
    this._onSyncEditingViewportState = options.onSyncEditingViewportState
    this._onInteractionStateChange = options.onInteractionStateChange ?? (() => {})
    this._onMarkNeedsPaint = options.onMarkNeedsPaint
    this._onMarkNeedsLayout = options.onMarkNeedsLayout
  }

  setGroupBy(groupBy: GridGroupDef<T>[]): boolean {
    const previous = this._dataModel.groupBy
    this._dataModel.groupBy = groupBy
    return !this._sameGroupBy(previous, this._dataModel.groupBy)
  }

  setSortState(sortState: GridSortState): boolean {
    const previous = this._dataModel.sortState
    this._dataModel.sortable = this._sortable()
    this._dataModel.sortState = sortState
    const next = this._dataModel.sortState
    if (previous.key === next.key && previous.order === next.order) return false
    return true
  }

  setSortDescriptors(sort: GridSortDescriptor[]): boolean {
    const previous = this._dataModel.sortDescriptors
    this._dataModel.sortable = this._sortable()
    this._dataModel.sortDescriptors = sort
    const next = this._dataModel.sortDescriptors
    if (this._sameSortDescriptors(previous, next)) return false
    return true
  }

  setFilterValue(key: string, value: string): boolean {
    return this._dataModel.setFilterValue(key, value)
  }

  setFilters(filters: GridFilterRule[]): boolean {
    const previous = this._dataModel.filters
    this._dataModel.filters = filters
    return !this._sameFilters(previous, this._dataModel.filters)
  }

  setQuickFilter(value: string): boolean {
    const previous = this._dataModel.quickFilter
    this._dataModel.quickFilter = value
    return previous !== this._dataModel.quickFilter
  }

  clearAllFilters(): boolean {
    return this._dataModel.clearAllFilters()
  }

  expandAllGroups(): boolean {
    return this._setAllGroupsExpanded(true)
  }

  collapseAllGroups(): boolean {
    return this._setAllGroupsExpanded(false)
  }

  moveColumn(fromIndex: number, toIndex: number): boolean {
    const columns = this._getColumns()
    const normalizedTarget = this._viewport.normalizeColumnMoveTarget(columns, fromIndex, toIndex)
    if (normalizedTarget < 0 || fromIndex === normalizedTarget) return false
    if (fromIndex < 0 || fromIndex >= columns.length) return false
    if (normalizedTarget < 0 || normalizedTarget >= columns.length) return false

    const nextColumns = [...columns]
    const widths = [...this._viewport.colWidths]
    const [column] = nextColumns.splice(fromIndex, 1)
    const [width] = widths.splice(fromIndex, 1)
    nextColumns.splice(normalizedTarget, 0, column!)
    widths.splice(normalizedTarget, 0, width!)
    this._dataModel.columns = nextColumns
    this._viewport.resetColumnWidths()
    this._viewport.initColumnWidths(nextColumns, this._getCurrentTheme())
    for (let index = 0; index < widths.length; index++) {
      this._viewport.colWidths[index] = widths[index]!
    }

    const edit = this._editing.state
    if (edit) {
      if (edit.col === fromIndex) edit.col = normalizedTarget
      else if (fromIndex < edit.col && normalizedTarget >= edit.col) edit.col++
      else if (fromIndex > edit.col && normalizedTarget <= edit.col) edit.col--
    }

    this._onMarkNeedsLayout()
    return true
  }

  setCellValue(
    rowIndex: number,
    key: string,
    value: any,
    origin: GridDataChangeOrigin = 'api',
  ): boolean {
    const validationRevision = this._structureEditing.validationRevision
    const changed = this._structureEditing.commitVisibleValue(
      rowIndex,
      key,
      value,
      { origin },
    )
    if (changed || validationRevision !== this._structureEditing.validationRevision) this._onMarkNeedsPaint()
    return changed
  }

  setSourceCellValue(
    sourceRowIndex: number,
    key: string,
    value: any,
    origin: GridDataChangeOrigin = 'api',
  ): boolean {
    const validationRevision = this._structureEditing.validationRevision
    const changed = this._structureEditing.commitSourceValue(
      sourceRowIndex,
      key,
      value,
      { origin },
    )
    if (changed || validationRevision !== this._structureEditing.validationRevision) this._onMarkNeedsPaint()
    return changed
  }

  addRows(
    rows: T[],
    atIndex?: number,
    origin: GridDataChangeOrigin = 'api',
  ): boolean {
    const changed = this._dataModel.addRows(rows, atIndex, { origin })
    if (changed) this._onMarkNeedsPaint()
    return changed
  }

  removeRows(
    indices: Iterable<number>,
    origin: GridDataChangeOrigin = 'api',
  ): boolean {
    const changed = this._dataModel.removeRows(indices, { origin })
    if (changed) this._onMarkNeedsPaint()
    return changed
  }

  handleVisibleRowsInvalidated(reason: GridDataModelInvalidationReason): void {
    if (this._shouldClearCellErrorsForProjection(reason)) this._structureEditing.clearCellErrors()
    else if (reason === 'rows' || reason === 'addRows' || reason === 'removeRows' || reason === 'cell') {
      this._structureEditing.syncCellErrorsToRows()
    }
    const columns = this._getColumns()
    const visibleItemCount = this._dataModel.visibleItemCount()
    const visibleRowCount = this._dataModel.visibleRowCount()
    this._editing.handleVisibleRowsChanged(visibleRowCount, reason !== 'columns')
    const edit = this._editing.state
    if (reason !== 'columns' && edit && !this._structureEditing.canEditCell(edit.row, edit.col)) {
      this._editing.endEdit({ restoreFocus: false })
    }
    this._interaction.syncVisibleState(visibleItemCount, visibleRowCount, {
      clearSelection: false,
      clearCellSelection: this._shouldClearCellSelectionForProjection(reason),
      clearFocus: false,
    })
    this._onInteractionStateChange()
    if (reason === 'filter' || reason === 'sort') {
      this._viewport.setScrollY(visibleItemCount, 0)
    } else {
      this._viewport.clampScrollOffsets(columns, visibleItemCount)
    }
    this._onSyncEditingViewportState()
    this._onMarkNeedsPaint()
  }

  private _shouldClearCellSelectionForProjection(reason: GridDataModelInvalidationReason): boolean {
    return reason === 'columns' ||
      reason === 'rows' ||
      reason === 'sort' ||
      reason === 'filter' ||
      reason === 'group' ||
      reason === 'addRows' ||
      reason === 'removeRows'
  }

  private _shouldClearCellErrorsForProjection(reason: GridDataModelInvalidationReason): boolean {
    if (reason === 'columns') return true
    if (reason === 'rows' || reason === 'addRows' || reason === 'removeRows') return !this._dataModel.hasRowKey()
    return false
  }

  toggleSortAt(globalX: number, additive = false): void {
    if (!this._sortable()) return
    const columns = this._getColumns()
    const colIndex = this._viewport.colAtX(globalX, this._getGlobalOffset(), columns)
    const column = colIndex >= 0 ? columns[colIndex] : undefined
    if (!column?.sortable) return

    const groupBy = this._dataModel.groupBy
    const groupIndex = groupBy.findIndex(group => group.key === column.key)
    if (groupIndex >= 0) {
      const next = [...groupBy]
      const current = next[groupIndex]!
      next[groupIndex] = { ...current, order: current.order === 'desc' ? 'asc' : 'desc' }
      this.setGroupBy(next)
      return
    }

    const currentSort = this._dataModel.sortState
    if (additive) {
      const sort = this._dataModel.sortDescriptors
      const index = sort.findIndex(entry => entry.key === column.key)
      const currentOrder = index >= 0 ? sort[index]!.order : null
      const nextOrder = currentOrder === 'asc' ? 'desc' : currentOrder === 'desc' ? null : 'asc'
      const next = [...sort]
      if (!nextOrder) {
        if (index >= 0) next.splice(index, 1)
      } else if (index >= 0) {
        next[index] = { key: column.key, order: nextOrder }
      } else {
        next.push({ key: column.key, order: nextOrder })
      }
      this.setSortDescriptors(next)
      return
    }
    if (currentSort.key !== column.key) this.setSortState({ key: column.key, order: 'asc' })
    else if (currentSort.order === 'asc') this.setSortState({ key: column.key, order: 'desc' })
    else if (currentSort.order === 'desc') this.setSortState({ key: column.key, order: null })
    else this.setSortState({ key: column.key, order: 'asc' })
  }

  toggleGroup(pathKey: string): boolean {
    const beforeItems = this._dataModel.visibleItems()
    const beforeFocusedItem = this._dataModel.visibleItemAt(this._interaction.focusedItemIndex)
    const beforeHoveredItem = this._dataModel.visibleItemAt(this._interaction.hoveredItemIndex)
    const beforeFocusedCol = this._interaction.focusedColIndex
    const groupIndex = this._dataModel.visibleItemIndexForPathKey(pathKey)
    const groupItem = this._dataModel.visibleItemAt(groupIndex)
    if (!groupItem || groupItem.kind !== 'group') return false

    const selectedSourceIndices = new Set(this._interaction.selectedSourceRows)
    const collapsing = groupItem.expanded
    const focusedDescendantHidden = collapsing && this._isDescendantFocused(beforeItems, groupIndex, groupItem.depth)

    const changed = this._dataModel.toggleGroupExpanded(pathKey)
    if (!changed) return false

    this._interaction.replaceSelectedSourceRows(selectedSourceIndices)

    const nextFocusedItemIndex = focusedDescendantHidden
      ? this._dataModel.visibleItemIndexForPathKey(pathKey)
      : this._projectionItemIndex(beforeFocusedItem, beforeItems, true)
    const nextHoveredItemIndex = this._projectionItemIndex(beforeHoveredItem, beforeItems, false)
    this._interaction.restoreProjectionState(
      nextFocusedItemIndex,
      nextHoveredItemIndex,
      beforeFocusedCol,
    )

    this._onInteractionStateChange()
    this._onSyncEditingViewportState()
    this._onMarkNeedsPaint()
    return true
  }

  private _setAllGroupsExpanded(expanded: boolean): boolean {
    const beforeItems = this._dataModel.visibleItems()
    const beforeFocusedItem = this._dataModel.visibleItemAt(this._interaction.focusedItemIndex)
    const beforeHoveredItem = this._dataModel.visibleItemAt(this._interaction.hoveredItemIndex)
    const beforeFocusedCol = this._interaction.focusedColIndex
    const changed = expanded
      ? this._dataModel.expandAllGroups()
      : this._dataModel.collapseAllGroups()
    if (!changed) return false

    this._interaction.restoreProjectionState(
      this._projectionItemIndex(beforeFocusedItem, beforeItems, true),
      this._projectionItemIndex(beforeHoveredItem, beforeItems, false),
      beforeFocusedCol,
    )
    this._onInteractionStateChange()
    return true
  }

  private _projectionItemIndex(
    item: GridVisibleItem<T> | null,
    beforeItems: Array<GridVisibleItem<T>>,
    fallbackToAncestor: boolean,
  ): number {
    if (!item) return -1
    if (item.kind === 'data') {
      const visibleRowIndex = this._dataModel.visibleRowIndex(item.sourceIndex)
      if (visibleRowIndex >= 0) return this._dataModel.visibleItemIndexForVisibleRow(visibleRowIndex)
    } else {
      const visibleItemIndex = this._dataModel.visibleItemIndexForPathKey(item.pathKey)
      if (visibleItemIndex >= 0) return visibleItemIndex
    }
    if (!fallbackToAncestor) return -1

    const parentByPathKey = new Map<string, string | null>()
    for (const beforeItem of beforeItems) {
      if (beforeItem.kind === 'group') parentByPathKey.set(beforeItem.pathKey, beforeItem.parentPathKey)
    }
    let parentPathKey = item.parentPathKey
    while (parentPathKey) {
      const visibleItemIndex = this._dataModel.visibleItemIndexForPathKey(parentPathKey)
      if (visibleItemIndex >= 0) return visibleItemIndex
      parentPathKey = parentByPathKey.get(parentPathKey) ?? null
    }
    return -1
  }

  private _sameGroupBy(
    a: ReadonlyArray<GridGroupDef<T>>,
    b: ReadonlyArray<GridGroupDef<T>>,
  ): boolean {
    if (a.length !== b.length) return false
    for (let index = 0; index < a.length; index++) {
      const left = a[index]
      const right = b[index]
      if (left?.key !== right?.key || left?.order !== right?.order) return false
    }
    return true
  }

  private _sameSortDescriptors(
    a: ReadonlyArray<GridSortDescriptor>,
    b: ReadonlyArray<GridSortDescriptor>,
  ): boolean {
    if (a.length !== b.length) return false
    for (let index = 0; index < a.length; index++) {
      if (a[index]?.key !== b[index]?.key || a[index]?.order !== b[index]?.order) return false
    }
    return true
  }

  private _sameFilters(
    a: ReadonlyArray<GridFilterRule>,
    b: ReadonlyArray<GridFilterRule>,
  ): boolean {
    if (a.length !== b.length) return false
    for (let index = 0; index < a.length; index++) {
      const left = a[index]
      const right = b[index]
      if (
        left?.key !== right?.key ||
        left?.operator !== right?.operator ||
        !Object.is(left?.value, right?.value) ||
        !Object.is(left?.valueTo, right?.valueTo) ||
        !this._sameFilterValues(left?.values, right?.values)
      ) {
        return false
      }
    }
    return true
  }

  private _sameFilterValues(left?: unknown[], right?: unknown[]): boolean {
    if (!left || !right) return left === right
    return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  }

  private _isDescendantFocused(
    items: Array<GridVisibleItem<T>>,
    groupIndex: number,
    depth: number,
  ): boolean {
    const focusedIndex = this._interaction.focusedItemIndex
    if (focusedIndex < 0) return false
    if (focusedIndex <= groupIndex) return false
    for (let index = groupIndex + 1; index < items.length; index++) {
      const item = items[index]!
      if (item.depth <= depth) break
      if (index === focusedIndex) return true
    }
    return false
  }
}
