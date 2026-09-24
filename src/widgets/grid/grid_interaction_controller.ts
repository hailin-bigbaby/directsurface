import { SelectionController } from '../../core/selection_controller'
import { ClipboardController } from '../../core/clipboard'
import type {
  GridCellCoord,
  GridCellRange,
  GridColumnDef,
  GridDataItem,
  GridGroupItem,
  GridInternalRowEvent,
  GridInternalSelectionState,
  GridRowId,
  GridSelectionMode,
  GridSelectionOptions,
} from './grid_types'
import type { GridDataModel } from './grid_data_model'
import type { GridStructureEditController } from './grid_structure_edit_controller'
import { defaultGridCellDisplayText } from './grid_display_resolver'

export interface GridInteractionControllerOptions<T extends Record<string, any>> {
  dataModel: GridDataModel<T>
  structureEditing: GridStructureEditController<T>
  editable: () => boolean
  getColumns: () => GridColumnDef<T>[]
  getPageStep: () => number
  onMarkNeedsPaint: () => void
  onScrollToItem: (itemIndex: number) => void
  onRevealCell: (rowIndex: number, colIndex: number) => void
  onBeginEdit: (row: number, col: number) => void
  onToggleGroup: (pathKey: string) => boolean
  onRowClick?: (row: T, event: GridInternalRowEvent) => void
  onRowActivate?: (row: T, event: GridInternalRowEvent) => void
}

export class GridInteractionController<T extends Record<string, any> = any> {
  private readonly _dataModel: GridDataModel<T>
  private readonly _structureEditing: GridStructureEditController<T>
  private readonly _editable: GridInteractionControllerOptions<T>['editable']
  private readonly _getColumns: GridInteractionControllerOptions<T>['getColumns']
  private readonly _getPageStep: GridInteractionControllerOptions<T>['getPageStep']
  private readonly _onMarkNeedsPaint: GridInteractionControllerOptions<T>['onMarkNeedsPaint']
  private readonly _onScrollToItem: GridInteractionControllerOptions<T>['onScrollToItem']
  private readonly _onRevealCell: GridInteractionControllerOptions<T>['onRevealCell']
  private readonly _onBeginEdit: GridInteractionControllerOptions<T>['onBeginEdit']
  private readonly _onToggleGroup: GridInteractionControllerOptions<T>['onToggleGroup']

  private readonly _rowSelection = new SelectionController()
  private readonly _selectedSourceRows = new Set<number>()
  private readonly _selectedRowRefs = new Set<T>()
  private readonly _selectedRowIds = new Set<GridRowId>()
  private _focused = false
  private _selectionMode: GridSelectionMode = 'row'
  private _currentCell: GridCellCoord | null = null
  private _rangeAnchor: GridCellCoord | null = null
  private _selectedRanges: GridCellRange[] = []
  private _pointerRangeSelecting = false
  private _focusedRowRef: T | null = null
  private _focusedRowId: GridRowId | null = null
  private _focusedGroupPathKey: string | null = null

  focusedItemIndex = -1
  focusedColIndex = -1
  hoveredItemIndex = -1

  onRowClick?: (row: T, event: GridInternalRowEvent) => void
  onRowActivate?: (row: T, event: GridInternalRowEvent) => void

  constructor(options: GridInteractionControllerOptions<T>) {
    this._dataModel = options.dataModel
    this._structureEditing = options.structureEditing
    this._editable = options.editable
    this._getColumns = options.getColumns
    this._getPageStep = options.getPageStep
    this._onMarkNeedsPaint = options.onMarkNeedsPaint
    this._onScrollToItem = options.onScrollToItem
    this._onRevealCell = options.onRevealCell
    this._onBeginEdit = options.onBeginEdit
    this._onToggleGroup = options.onToggleGroup
    this.onRowClick = options.onRowClick
    this.onRowActivate = options.onRowActivate
  }

  get selectedRows(): Set<number> {
    return this._rowSelection.selectedItems
  }

  get selectedSourceRows(): Set<number> {
    return this._selectedSourceRows
  }

  get selectedRowIds(): Set<GridRowId> {
    return this._selectedRowIds
  }

  get selectedRowRefs(): Set<T> {
    return this._selectedRowRefs
  }

  get rowSelection(): SelectionController {
    return this._rowSelection
  }

  get selectionMode(): GridSelectionMode { return this._selectionMode }
  set selectionMode(mode: GridSelectionMode) {
    const next = mode === 'cell' || mode === 'range' ? mode : 'row'
    if (next === this._selectionMode) return
    this._selectionMode = next
    this.clearCellSelection()
    if (next !== 'row') this.clearSelectionState()
    this._onMarkNeedsPaint()
  }

  get currentCell(): GridCellCoord | null {
    return this._currentCell ? { ...this._currentCell } : null
  }

  get selectedRanges(): GridCellRange[] {
    return this._selectedRanges.map(range => ({ ...range }))
  }

  get isPointerRangeSelecting(): boolean {
    return this._pointerRangeSelecting
  }

  get focusedRow(): number {
    return this._dataModel.visibleRowIndexForItem(this.focusedItemIndex)
  }

  get hoveredRow(): number {
    return this._dataModel.visibleRowIndexForItem(this.hoveredItemIndex)
  }

  get isFocused(): boolean {
    return this._focused
  }

  syncVisibleState(
    itemCount: number,
    visibleRowCount: number,
    options: {
      resetScrollY?: boolean
      clearSelection?: boolean
      clearCellSelection?: boolean
      clearFocus?: boolean
    } = {},
  ): void {
    if (options.clearSelection) {
      this.clearSelectionState()
      this.clearCellSelection()
    } else {
      this._refreshVisibleSelectionFromSources(visibleRowCount)
      if (options.clearCellSelection) this.clearCellSelection()
    }

    if (options.clearFocus) {
      this.focusedItemIndex = -1
      this.focusedColIndex = -1
      this.hoveredItemIndex = -1
      this._focusedRowRef = null
      this._focusedRowId = null
      this._focusedGroupPathKey = null
    } else {
      this._restoreFocusedRowById()
      this.hoveredItemIndex = -1
    }

    if (itemCount === 0) {
      this.focusedItemIndex = -1
      this.focusedColIndex = -1
      this.hoveredItemIndex = -1
      this._focusedRowRef = null
      this._focusedRowId = null
      this._focusedGroupPathKey = null
      this.clearCellSelection()
    } else {
      if (this.focusedItemIndex >= itemCount) this.focusedItemIndex = itemCount - 1
      this.focusedColIndex = this._normalizeFocusedColumn()
      if (this.hoveredItemIndex >= itemCount) this.hoveredItemIndex = -1
      if (!options.clearCellSelection && !options.clearSelection) {
        this._clampCellSelection(visibleRowCount)
      }
    }

    if (options.resetScrollY) this._onScrollToItem(0)
  }

  clampSelectionToVisibleRows(itemCount: number, visibleRowCount: number): void {
    this._refreshVisibleSelectionFromSources(visibleRowCount)
    if (itemCount === 0) {
      this.focusedItemIndex = -1
      this.focusedColIndex = -1
      this.hoveredItemIndex = -1
      this._focusedRowRef = null
      this._focusedRowId = null
      this._focusedGroupPathKey = null
      this.clearCellSelection()
      return
    }
    this._restoreFocusedRowById()
    if (this.focusedItemIndex >= itemCount) this.focusedItemIndex = itemCount - 1
    this.focusedColIndex = this._normalizeFocusedColumn()
    this._clampCellSelection(visibleRowCount)
  }

  focusIn(): void {
    if (this._focused) return
    this._focused = true
    this._onMarkNeedsPaint()
  }

  focusOut(): void {
    if (!this._focused) return
    this._focused = false
    this._rowSelection.clearRange(null)
    this._onMarkNeedsPaint()
  }

  focusRow(rowIndex: number, options: { select?: boolean; scroll?: boolean } = {}): void {
    this.focusCell(rowIndex, undefined, options)
  }

  focusCell(
    rowIndex: number,
    colIndex?: number,
    options: { select?: boolean; scroll?: boolean } = {},
  ): void {
    const itemIndex = this._dataModel.visibleItemIndexForVisibleRow(rowIndex)
    if (rowIndex < 0 || itemIndex < 0) {
      const changed = this.focusedItemIndex !== -1 || (options.select && this.selectedRows.size > 0)
      this.focusedItemIndex = -1
      this.focusedColIndex = -1
      this._focusedRowRef = null
      this._focusedRowId = null
      this._focusedGroupPathKey = null
      if (options.select) {
        this._rowSelection.clearSelected()
        this._selectedSourceRows.clear()
        this._selectedRowRefs.clear()
        this._selectedRowIds.clear()
      }
      else this._rowSelection.setFocus(null)
      this.clearCellSelection()
      if (changed) this._onMarkNeedsPaint()
      return
    }

    const previousFocusedItem = this.focusedItemIndex
    const previousFocusedCol = this.focusedColIndex
    const previousSelection = options.select ? [...this.selectedRows] : []
    this.focusedItemIndex = itemIndex
    this.focusedColIndex = this._normalizeFocusedColumn(colIndex)
    this._syncFocusedRowIdFromCurrentItem()
    if (options.select) {
      if (this._selectionMode === 'row') {
        this._rowSelection.selectOnly(rowIndex)
        this._syncSelectedIdentitiesFromVisible()
      } else {
        this._selectCell(rowIndex, this.focusedColIndex, false)
      }
    } else {
      this._rowSelection.setFocus(rowIndex)
    }
    if (options.scroll ?? true) {
      if (colIndex === undefined) this._onScrollToItem(itemIndex)
      else this._onRevealCell(rowIndex, this.focusedColIndex)
    }
    const selectionChanged = options.select && (
      previousSelection.length !== 1 || previousSelection[0] !== rowIndex
    )
    if (previousFocusedItem !== itemIndex || previousFocusedCol !== this.focusedColIndex || selectionChanged) {
      this._onMarkNeedsPaint()
    }
  }

  setSelectedRows(rows: Iterable<number>): void {
    const visibleRows = this._dataModel.visibleRows()
    const nextRows = new Set<number>()
    for (const row of rows) {
      if (row >= 0 && row < visibleRows.length) nextRows.add(row)
    }
    const changed =
      nextRows.size !== this.selectedRows.size ||
      [...nextRows].some(row => !this.selectedRows.has(row))
    const modeChanged = this._selectionMode !== 'row'
    if (!changed && !modeChanged && this._selectedRanges.length === 0 && !this._currentCell) return
    this._selectionMode = 'row'
    this.clearCellSelection()
    this._rowSelection.replaceSelected(nextRows)
    this._syncSelectedIdentitiesFromVisible()
    const nextFocusedRow = [...nextRows][0] ?? -1
    this.focusedItemIndex = nextFocusedRow >= 0
      ? this._dataModel.visibleItemIndexForVisibleRow(nextFocusedRow)
      : -1
    this.focusedColIndex = this._normalizeFocusedColumn()
    this._syncFocusedRowIdFromCurrentItem()
    this._onMarkNeedsPaint()
  }

  setSelectedRowIds(rowIds: Iterable<GridRowId>): void {
    const nextIds = new Set<GridRowId>()
    for (const rowId of rowIds) {
      if (typeof rowId === 'string' || typeof rowId === 'number') nextIds.add(rowId)
    }
    const changed =
      nextIds.size !== this._selectedRowIds.size ||
      [...nextIds].some(rowId => !this._selectedRowIds.has(rowId))
    const modeChanged = this._selectionMode !== 'row'
    if (!changed && !modeChanged && this._selectedRanges.length === 0 && !this._currentCell) return
    this._selectionMode = 'row'
    this.clearCellSelection()
    this._selectedRowIds.clear()
    this._selectedRowRefs.clear()
    for (const rowId of nextIds) this._selectedRowIds.add(rowId)
    if (this._selectedRowIds.size === 0) {
      this._rowSelection.replaceSelected(new Set())
      this._selectedSourceRows.clear()
      this._selectedRowRefs.clear()
    } else {
      this._refreshVisibleSelectionFromSources(this._dataModel.visibleRowCount())
    }
    const nextFocusedRow = [...this.selectedRows].sort((a, b) => a - b)[0] ?? -1
    this.focusedItemIndex = nextFocusedRow >= 0
      ? this._dataModel.visibleItemIndexForVisibleRow(nextFocusedRow)
      : -1
    this.focusedColIndex = this._normalizeFocusedColumn()
    this._syncFocusedRowIdFromCurrentItem()
    this._onMarkNeedsPaint()
  }

  getSelectionState(): GridInternalSelectionState {
    return {
      mode: this._selectionMode,
      selectedRows: [...this.selectedRows].sort((a, b) => a - b),
      selectedSourceRows: [...this._selectedSourceRows].sort((a, b) => a - b),
      selectedRowIds: this.sortedRowIds(),
      currentCell: this.currentCell,
      selectedRanges: this._selectedRanges.map(range => this.normalizeRange(range)),
      focusedRow: this.focusedRow,
      focusedCol: this.focusedColIndex,
    }
  }

  clearSelection(): void {
    const hadSelection =
      this.selectedRows.size > 0 ||
      this._selectedSourceRows.size > 0 ||
      this._selectedRowRefs.size > 0 ||
      this._selectedRowIds.size > 0 ||
      this._selectedRanges.length > 0 ||
      this._currentCell !== null ||
      this._rangeAnchor !== null ||
      this._pointerRangeSelecting
    this.clearSelectionState()
    this.clearCellSelection()
    if (hadSelection) this._onMarkNeedsPaint()
  }

  selectCell(rowIndex: number, colIndex: number, options: GridSelectionOptions = {}): boolean {
    if (!Number.isFinite(rowIndex) || !Number.isFinite(colIndex)) return false
    const row = Math.floor(rowIndex)
    const col = Math.floor(colIndex)
    const itemIndex = this._dataModel.visibleItemIndexForVisibleRow(row)
    const colCount = this._getColumns().length
    if (itemIndex < 0 || col < 0 || col >= colCount) return false
    const item = this._dataModel.visibleItemAt(itemIndex)
    if (!item || item.kind !== 'data') return false
    this._selectionMode = 'cell'
    this.clearSelectionState()
    this.focusedItemIndex = itemIndex
    this.focusedColIndex = col
    this._syncFocusedRowIdFromCurrentItem()
    this._selectCell(row, col, false)
    if (options.scroll ?? true) this._onRevealCell(row, col)
    this._onMarkNeedsPaint()
    return true
  }

  selectRange(range: GridCellRange, options: GridSelectionOptions = {}): boolean {
    const rowCount = this._dataModel.visibleRowCount()
    const colCount = this._getColumns().length
    if (rowCount <= 0 || colCount <= 0) {
      this.clearSelection()
      return false
    }
    const clampIndex = (value: number, max: number) => {
      if (!Number.isFinite(value)) return 0
      return Math.max(0, Math.min(max, Math.floor(value)))
    }
    const clamped: GridCellRange = {
      startRow: clampIndex(range.startRow, rowCount - 1),
      startCol: clampIndex(range.startCol, colCount - 1),
      endRow: clampIndex(range.endRow, rowCount - 1),
      endCol: clampIndex(range.endCol, colCount - 1),
    }
    const focusItemIndex = this._dataModel.visibleItemIndexForVisibleRow(clamped.endRow)
    if (focusItemIndex < 0) return false
    this._selectionMode = 'range'
    this.clearSelectionState()
    this._rangeAnchor = { row: clamped.startRow, col: clamped.startCol }
    this._currentCell = { row: clamped.endRow, col: clamped.endCol }
    this._selectedRanges = [clamped]
    this._pointerRangeSelecting = false
    this.focusedItemIndex = focusItemIndex
    this.focusedColIndex = clamped.endCol
    this._syncFocusedRowIdFromCurrentItem()
    if (options.scroll ?? true) this._onRevealCell(clamped.endRow, clamped.endCol)
    this._onMarkNeedsPaint()
    return true
  }

  clearSelectionState(): void {
    this._rowSelection.clearSelected()
    this._rowSelection.clearRange(null)
    this._selectedSourceRows.clear()
    this._selectedRowRefs.clear()
    this._selectedRowIds.clear()
  }

  clearCellSelection(): void {
    this._currentCell = null
    this._rangeAnchor = null
    this._selectedRanges = []
    this._pointerRangeSelecting = false
  }

  resetRowState(): void {
    this.clearSelectionState()
    this.clearCellSelection()
    this.focusedItemIndex = -1
    this.focusedColIndex = -1
    this.hoveredItemIndex = -1
    this._focusedRowRef = null
    this._focusedRowId = null
    this._focusedGroupPathKey = null
    this._onMarkNeedsPaint()
  }

  handleItemPointerDown(
    itemIndex: number,
    options: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; colIndex?: number } = {},
  ): void {
    const item = this._dataModel.visibleItemAt(itemIndex)
    if (!item) return
    this.focusedItemIndex = itemIndex
    this.focusedColIndex = item.kind === 'data'
      ? this._normalizeFocusedColumn(options.colIndex)
      : -1
    this._syncFocusedRowIdFromCurrentItem()
    this._onScrollToItem(itemIndex)

    if (item.kind === 'group') {
      this._onMarkNeedsPaint()
      return
    }

    const rowIndex = item.dataRowIndex
    const colIndex = this._normalizeFocusedColumn(options.colIndex)
    if (this._selectionMode !== 'row') {
      const rowEvent: GridInternalRowEvent = {
        input: 'pointer',
        colIndex,
        shiftKey: options.shiftKey,
        ctrlKey: options.ctrlKey,
        metaKey: options.metaKey,
      }
      this._selectCell(rowIndex, colIndex, options.shiftKey === true && this._selectionMode === 'range')
      this.onRowClick?.(item.row, rowEvent)
      this._onMarkNeedsPaint()
      return
    }

    if (options.shiftKey && this._rowSelection.anchor !== null) {
      this._rowSelection.extendDiscreteRange(rowIndex)
    } else if (options.ctrlKey || options.metaKey) {
      this._rowSelection.toggle(rowIndex)
    } else {
      this._rowSelection.selectOnly(rowIndex)
    }
    this._rowSelection.setFocus(rowIndex)
    this._syncSelectedIdentitiesFromVisible()
    const rowEvent: GridInternalRowEvent = {
      input: 'pointer',
      colIndex,
      shiftKey: options.shiftKey,
      ctrlKey: options.ctrlKey,
      metaKey: options.metaKey,
    }
    this.onRowClick?.(item.row, rowEvent)
    this._onMarkNeedsPaint()
  }

  activateItem(itemIndex: number, colIndex: number): boolean {
    const item = this._dataModel.visibleItemAt(itemIndex)
    if (!item || item.kind !== 'data') return false
    this.onRowActivate?.(item.row, {
      input: 'pointer',
      colIndex: this._normalizeFocusedColumn(colIndex),
    })
    return true
  }

  beginPointerRangeSelection(itemIndex: number, colIndex?: number): boolean {
    if (this._selectionMode !== 'range') return false
    const item = this._dataModel.visibleItemAt(itemIndex)
    if (!item || item.kind !== 'data') return false
    const normalizedCol = this._normalizeFocusedColumn(colIndex)
    if (normalizedCol < 0) return false
    this._pointerRangeSelecting = true
    return true
  }

  updatePointerRangeSelection(itemIndex: number, colIndex?: number): boolean {
    if (!this._pointerRangeSelecting || this._selectionMode !== 'range') return false
    const item = this._dataModel.visibleItemAt(itemIndex)
    if (!item || item.kind !== 'data') return false
    const normalizedCol = this._normalizeFocusedColumn(colIndex)
    if (normalizedCol < 0) return false
    const previousRange = this._selectedRanges[0]
    this.focusedItemIndex = itemIndex
    this.focusedColIndex = normalizedCol
    this._syncFocusedRowIdFromCurrentItem()
    this._selectCell(item.dataRowIndex, normalizedCol, true)
    const nextRange = this._selectedRanges[0]
    if (
      !previousRange ||
      !nextRange ||
      previousRange.startRow !== nextRange.startRow ||
      previousRange.startCol !== nextRange.startCol ||
      previousRange.endRow !== nextRange.endRow ||
      previousRange.endCol !== nextRange.endCol
    ) {
      this._onMarkNeedsPaint()
    }
    return true
  }

  endPointerRangeSelection(): void {
    this._pointerRangeSelecting = false
  }

  toggleFocusedGroup(): boolean {
    const item = this.focusedItem()
    if (!item || item.kind !== 'group') return false
    const changed = this._onToggleGroup(item.pathKey)
    if (changed) this._onMarkNeedsPaint()
    return changed
  }

  setHoveredItem(itemIndex: number): void {
    if (itemIndex === this.hoveredItemIndex) return
    this.hoveredItemIndex = itemIndex
    this._onMarkNeedsPaint()
  }

  restoreProjectionState(
    focusedItemIndex: number,
    hoveredItemIndex: number,
    preferredColIndex = this.focusedColIndex,
  ): void {
    const focusedItem = this._dataModel.visibleItemAt(focusedItemIndex)
    this.focusedItemIndex = focusedItem ? focusedItemIndex : -1
    this.focusedColIndex = focusedItem?.kind === 'data'
      ? this._normalizeFocusedColumn(preferredColIndex)
      : -1
    this.hoveredItemIndex = this._dataModel.visibleItemAt(hoveredItemIndex)
      ? hoveredItemIndex
      : -1
    this._syncFocusedRowIdFromCurrentItem()
  }

  clearPointerState(): void {
    this.hoveredItemIndex = -1
    this._onMarkNeedsPaint()
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    const visibleRows = this._dataModel.visibleRows()
    const visibleItems = this._dataModel.visibleItems()
    if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
      event.preventDefault()
      if (this._selectionMode !== 'row') {
        this._selectAllCells(visibleRows.length)
        this._onMarkNeedsPaint()
        return true
      }
      this._rowSelection.selectAllDiscrete(visibleRows.length, {
        focus: this.focusedRow >= 0 ? this.focusedRow : null,
      })
      this._syncSelectedIdentitiesFromVisible()
      if (this.focusedItemIndex < 0 && visibleItems.length > 0) {
        this.focusedItemIndex = visibleItems.length - 1
        this.focusedColIndex = this._normalizeFocusedColumn()
        this._syncFocusedRowIdFromCurrentItem()
      }
      this._onMarkNeedsPaint()
      return true
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
      event.preventDefault()
      const text = this.getCopyText()
      if (text != null) void ClipboardController.instance.writeText(text)
      return true
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
      if (!this._editable()) return false
      event.preventDefault()
      this.pasteFromClipboard()
      return true
    }
    if (event.key === 'Delete') {
      if (!this._editable()) return false
      event.preventDefault()
      this.deleteSelectedRows()
      return true
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      if (visibleItems.length === 0) return true
      const direction = event.key === 'ArrowUp' ? -1 : 1
      const nextItemIndex = this.focusedItemIndex < 0
        ? direction > 0 ? 0 : visibleItems.length - 1
        : Math.max(0, Math.min(visibleItems.length - 1, this.focusedItemIndex + direction))
      this._moveFocusToItemIndex(nextItemIndex, {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      })
      return true
    }
    if (event.key === 'ArrowRight') {
      const item = this.focusedItem()
      if (!item) return false
      if (item.kind === 'group') {
        event.preventDefault()
        if (!item.expanded) {
          this._onToggleGroup(item.pathKey)
        } else if (this.focusedItemIndex + 1 < visibleItems.length) {
          this.focusedItemIndex++
          this.focusedColIndex = this._normalizeFocusedColumn()
          this._syncFocusedRowIdFromCurrentItem()
          const focused = this.focusedItem()
          if (focused?.kind === 'data') {
            this._onRevealCell(focused.dataRowIndex, this.focusedColIndex)
          } else {
            this._onScrollToItem(this.focusedItemIndex)
          }
        }
        this._onMarkNeedsPaint()
        return true
      }
      const nextCol = this._moveFocusedCol(1)
      if (nextCol >= 0) {
        event.preventDefault()
        this.focusedColIndex = nextCol
        const focused = this.focusedItem()
        if (focused?.kind === 'data' && this._selectionMode !== 'row') {
          this._selectCell(focused.dataRowIndex, nextCol, event.shiftKey && this._selectionMode === 'range')
        }
        if (focused?.kind === 'data') this._onRevealCell(focused.dataRowIndex, nextCol)
        this._onMarkNeedsPaint()
        return true
      }
      return false
    }
    if (event.key === 'ArrowLeft') {
      const item = this.focusedItem()
      if (!item) return false
      event.preventDefault()
      if (item.kind === 'group') {
        if (item.expanded) {
          this._onToggleGroup(item.pathKey)
        } else if (item.parentPathKey) {
          const parentIndex = this._dataModel.visibleItemIndexForPathKey(item.parentPathKey)
          if (parentIndex >= 0) {
            this.focusedItemIndex = parentIndex
            this.focusedColIndex = -1
            this._syncFocusedRowIdFromCurrentItem()
            this._onScrollToItem(parentIndex)
          }
        }
        this._onMarkNeedsPaint()
        return true
      }
      const nextCol = this._moveFocusedCol(-1)
      if (nextCol >= 0) {
        this.focusedColIndex = nextCol
        const focused = this.focusedItem()
        if (focused?.kind === 'data' && this._selectionMode !== 'row') {
          this._selectCell(focused.dataRowIndex, nextCol, event.shiftKey && this._selectionMode === 'range')
        }
        if (focused?.kind === 'data') this._onRevealCell(focused.dataRowIndex, nextCol)
        this._onMarkNeedsPaint()
        return true
      }
      if (item.parentPathKey) {
        const parentIndex = this._dataModel.visibleItemIndexForPathKey(item.parentPathKey)
        if (parentIndex >= 0) {
          this.focusedItemIndex = parentIndex
          this.focusedColIndex = -1
          this._syncFocusedRowIdFromCurrentItem()
          this._onScrollToItem(parentIndex)
          this._onMarkNeedsPaint()
          return true
        }
      }
      return false
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      if (visibleItems.length === 0) return true
      const targetCol = event.key === 'Home' ? 0 : this._getColumns().length - 1
      if ((event.ctrlKey || event.metaKey) || this._selectionMode === 'row') {
        this._moveFocusToItemIndex(
          event.key === 'Home' ? 0 : visibleItems.length - 1,
          {
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
          },
          targetCol,
        )
        return true
      }
      this._moveFocusedCellToColumn(targetCol, event.shiftKey)
      return true
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      if (visibleItems.length === 0) return true
      const direction = event.key === 'PageUp' ? -1 : 1
      const pageStep = Math.max(1, Math.floor(this._getPageStep()))
      const base = this.focusedItemIndex < 0
        ? direction > 0 ? 0 : visibleItems.length - 1
        : this.focusedItemIndex
      const nextItemIndex = Math.max(0, Math.min(visibleItems.length - 1, base + direction * pageStep))
      this._moveFocusToItemIndex(nextItemIndex, {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      })
      return true
    }
    if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'F2' || event.key === 'Enter') {
      if (this.focusedItemIndex < 0) return false
      const item = this.focusedItem()
      if (!item) return false
      const isSpace = event.key === ' ' || event.key === 'Spacebar'
      if (item.kind === 'group') {
        if (isSpace) return false
        event.preventDefault()
        this._onToggleGroup(item.pathKey)
        this._onMarkNeedsPaint()
        return true
      }
      if (!this._editable()) {
        if (isSpace) return false
        event.preventDefault()
        this.onRowActivate?.(item.row, {
          input: 'keyboard',
          colIndex: this.focusedColIndex,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
        })
        return true
      }
      const targetCol = this._resolveEditTargetColumn(item.dataRowIndex)
      if (targetCol >= 0) {
        const targetColumn = this._getColumns()[targetCol]
        if (isSpace && targetColumn?.type !== 'checkbox') return false
        event.preventDefault()
        this.focusedColIndex = targetCol
        this._onBeginEdit(item.dataRowIndex, targetCol)
        this._onMarkNeedsPaint()
      }
      return true
    }
    if (event.key === 'Tab') {
      const item = this.focusedItem()
      if (!item || item.kind !== 'data') return false
      const moved = event.shiftKey
        ? this._moveToPrevTabStop(item.dataRowIndex, this.focusedColIndex)
        : this._moveToNextTabStop(item.dataRowIndex, this.focusedColIndex)
      if (!moved) return false
      event.preventDefault()
      this._onMarkNeedsPaint()
      return true
    }
    return false
  }

  copySelectedRows(): string | null {
    const visibleRows = this._dataModel.visibleRows()
    const selectedIndices = this.selectedRows.size > 0
      ? [...this.selectedRows]
      : this.focusedRow >= 0 ? [this.focusedRow] : []
    if (selectedIndices.length === 0) return null
    const sortedIndices = selectedIndices.sort((a, b) => a - b)
    const columns = this._getColumns()
    const headers = columns.map(column => column.title).join('\t')
    const rowsText = sortedIndices.map(rowIndex => {
      const row = visibleRows[rowIndex]
      if (!row) return ''
      return columns.map(column => {
        const value = row[column.key]
        if (column.type === 'checkbox') return value ? 'true' : 'false'
        return String(value ?? '')
      }).join('\t')
    }).join('\n')
    return `${headers}\n${rowsText}`
  }

  copySelection(): string | null {
    if (this._selectionMode === 'row') {
      return this.copySelectedRows()
    }
    const visibleRows = this._dataModel.visibleRows()
    const columns = this._getColumns()
    const range = this.normalizedActiveRange() ?? (this._currentCell ? {
      startRow: this._currentCell.row,
      endRow: this._currentCell.row,
      startCol: this._currentCell.col,
      endCol: this._currentCell.col,
    } : null)
    if (!range) return null
    const lines: string[] = []
    for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex++) {
      const row = visibleRows[rowIndex]
      if (!row) continue
      const cells: string[] = []
      for (let colIndex = range.startCol; colIndex <= range.endCol; colIndex++) {
        const column = columns[colIndex]
        if (!column) continue
        cells.push(defaultGridCellDisplayText(column, row, rowIndex, this._dataModel.lookupValues))
      }
      lines.push(cells.join('\t'))
    }
    if (lines.length === 0) return null
    return lines.join('\n')
  }

  getCopyText(): string | null {
    return this.copySelection()
  }

  pasteFromClipboard(): void {
    if (!this._editable()) return
    if (this._selectionMode !== 'row') return
    navigator.clipboard.readText().then(text => {
      if (!text) return
      const lines = text.split('\n')
      if (lines.length < 2) return
      const headerKeys = lines[0]!.split('\t')
      const dataLines = lines.slice(1)
      const columns = this._getColumns()
      const keyToColumn = new Map(columns.map((column, columnIndex) => [column.title, { column, columnIndex }]))
      const visibleRows = this._dataModel.visibleRows()
      const selectedIndices = [...this.selectedRows].sort((a, b) => a - b)
      if (selectedIndices.length === 0) return

      let changed = false
      const validationRevision = this._structureEditing.validationRevision
      for (let rowOffset = 0; rowOffset < Math.min(selectedIndices.length, dataLines.length); rowOffset++) {
        const visibleIndex = selectedIndices[rowOffset]!
        const row = visibleRows[visibleIndex]
        if (!row) continue
        const values = dataLines[rowOffset]!.split('\t')
        for (let columnOffset = 0; columnOffset < Math.min(headerKeys.length, values.length); columnOffset++) {
          const target = keyToColumn.get(headerKeys[columnOffset]!)
          if (!target || !this._structureEditing.canEditCell(visibleIndex, target.columnIndex)) continue
          const { column } = target
          const rawValue = values[columnOffset]!
          const nextValue = column.type === 'checkbox' ? rawValue === 'true' : rawValue
          if (!this._structureEditing.commitVisibleCell(
            visibleIndex,
            target.columnIndex,
            nextValue,
            row[column.key],
          )) continue
          changed = true
        }
      }
      if (!changed && validationRevision === this._structureEditing.validationRevision) return
      if (changed) this.syncVisibleState(this._dataModel.visibleItemCount(), this._dataModel.visibleRowCount())
      this._onMarkNeedsPaint()
    }).catch(() => {})
  }

  deleteSelectedRows(): void {
    if (!this._editable()) return
    if (this._selectionMode !== 'row') return
    if (this.selectedRows.size === 0) return
    const rawIndices = [...this.selectedRows]
      .sort((a, b) => b - a)
      .map(index => this._dataModel.visibleRowIndex(index))
      .filter(index => index >= 0)
    if (!this._dataModel.removeRows(rawIndices)) return
    this.selectedRows.clear()
    this._selectedSourceRows.clear()
    this._selectedRowRefs.clear()
    this._selectedRowIds.clear()
    this._rowSelection.clearRange(null)
    this.focusedItemIndex = -1
    this.focusedColIndex = -1
    this._focusedRowRef = null
    this._focusedRowId = null
    this._focusedGroupPathKey = null
    this._onMarkNeedsPaint()
  }

  replaceSelectedSourceRows(sourceRows: Iterable<number>): void {
    this._selectedSourceRows.clear()
    this._selectedRowRefs.clear()
    for (const sourceRow of sourceRows) {
      if (sourceRow >= 0) this._selectedSourceRows.add(sourceRow)
    }
    this._refreshVisibleSelectionFromSources(this._dataModel.visibleRowCount())
  }

  normalizedActiveRange(): GridCellRange | null {
    const active = this._selectedRanges[0]
    if (!active) return null
    return this.normalizeRange(active)
  }

  private focusedItem(): GridGroupItem<T> | GridDataItem<T> | null {
    return this._dataModel.visibleItemAt(this.focusedItemIndex)
  }

  private _moveFocusToItemIndex(
    itemIndex: number,
    modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
    preferredColIndex?: number,
  ): boolean {
    const visibleItems = this._dataModel.visibleItems()
    if (itemIndex < 0 || itemIndex >= visibleItems.length) return false
    this.focusedItemIndex = itemIndex

    const item = visibleItems[itemIndex]!
    if (item.kind === 'data') {
      this.focusedColIndex = this._normalizeFocusedColumn(preferredColIndex)
      this._onRevealCell(item.dataRowIndex, this.focusedColIndex)
      this._focusedRowRef = item.row
      this._focusedRowId = item.rowId
      this._focusedGroupPathKey = null
      if (this._selectionMode === 'row') {
        this._syncSelectionForFocusedDataItem(item, modifiers)
      } else {
        this._selectCell(
          item.dataRowIndex,
          this.focusedColIndex,
          modifiers.shiftKey === true && this._selectionMode === 'range',
        )
      }
      if (!modifiers.shiftKey && !modifiers.ctrlKey && !modifiers.metaKey) {
        this.onRowClick?.(item.row, {
          input: 'keyboard',
          colIndex: this.focusedColIndex,
          shiftKey: modifiers.shiftKey,
          ctrlKey: modifiers.ctrlKey,
          metaKey: modifiers.metaKey,
        })
      }
    } else {
      this.focusedColIndex = -1
      this._onScrollToItem(itemIndex)
      this._focusedRowRef = null
      this._focusedRowId = null
      this._focusedGroupPathKey = item.pathKey
    }
    this._onMarkNeedsPaint()
    return true
  }

  private _moveFocusedCellToColumn(colIndex: number, extendRange: boolean): boolean {
    const item = this.focusedItem()
    const columns = this._getColumns()
    if (!item || item.kind !== 'data' || columns.length === 0) return false
    const nextCol = Math.max(0, Math.min(columns.length - 1, colIndex))
    this.focusedColIndex = nextCol
    if (this._selectionMode !== 'row') {
      this._selectCell(item.dataRowIndex, nextCol, extendRange && this._selectionMode === 'range')
    }
    this._onRevealCell(item.dataRowIndex, nextCol)
    this._onMarkNeedsPaint()
    return true
  }

  private _selectCell(row: number, col: number, extend: boolean): void {
    if (row < 0 || col < 0) return
    const colCount = this._getColumns().length
    const rowCount = this._dataModel.visibleRowCount()
    if (row >= rowCount || col >= colCount) return
    const cell = { row, col }
    this._currentCell = cell
    if (!extend || !this._rangeAnchor) this._rangeAnchor = cell
    const anchor = this._rangeAnchor
    this._selectedRanges = [{
      startRow: anchor.row,
      startCol: anchor.col,
      endRow: row,
      endCol: col,
    }]
  }

  private _selectAllCells(rowCount: number): void {
    const colCount = this._getColumns().length
    if (rowCount <= 0 || colCount <= 0) {
      this.clearCellSelection()
      return
    }
    this._currentCell = { row: 0, col: 0 }
    this._rangeAnchor = { row: 0, col: 0 }
    this._selectedRanges = [{
      startRow: 0,
      startCol: 0,
      endRow: rowCount - 1,
      endCol: colCount - 1,
    }]
  }

  private _clampCellSelection(rowCount: number): void {
    const colCount = this._getColumns().length
    if (rowCount <= 0 || colCount <= 0) {
      this.clearCellSelection()
      return
    }
    if (this._currentCell) {
      this._currentCell = {
        row: Math.max(0, Math.min(rowCount - 1, this._currentCell.row)),
        col: Math.max(0, Math.min(colCount - 1, this._currentCell.col)),
      }
    }
    this._selectedRanges = this._selectedRanges.map(range => ({
      startRow: Math.max(0, Math.min(rowCount - 1, range.startRow)),
      startCol: Math.max(0, Math.min(colCount - 1, range.startCol)),
      endRow: Math.max(0, Math.min(rowCount - 1, range.endRow)),
      endCol: Math.max(0, Math.min(colCount - 1, range.endCol)),
    }))
  }

  private normalizeRange(range: GridCellRange): GridCellRange {
    return {
      startRow: Math.min(range.startRow, range.endRow),
      startCol: Math.min(range.startCol, range.endCol),
      endRow: Math.max(range.startRow, range.endRow),
      endCol: Math.max(range.startCol, range.endCol),
    }
  }

  private _normalizeFocusedColumn(preferredColIndex?: number): number {
    const item = this.focusedItem()
    if (!item || item.kind !== 'data') return -1
    const columns = this._getColumns()
    const candidate = preferredColIndex ?? this.focusedColIndex
    if (candidate !== undefined && candidate >= 0 && candidate < columns.length) return candidate
    const firstEditable = this._firstStructurallyEditableColumnIndex()
    return firstEditable >= 0 ? firstEditable : (columns.length > 0 ? 0 : -1)
  }

  private _firstStructurallyEditableColumnIndex(): number {
    const columns = this._getColumns()
    for (let index = 0; index < columns.length; index++) {
      if (this._structureEditing.canEditColumn(columns[index])) return index
    }
    return -1
  }

  private _firstEditableColumnIndex(rowIndex: number): number {
    const columns = this._getColumns()
    for (let index = 0; index < columns.length; index++) {
      if (this._structureEditing.canEditCell(rowIndex, index)) return index
    }
    return -1
  }

  private _resolveEditTargetColumn(rowIndex: number): number {
    const columns = this._getColumns()
    if (this.focusedColIndex >= 0 && this.focusedColIndex < columns.length) {
      return this._structureEditing.canEditCell(rowIndex, this.focusedColIndex)
        ? this.focusedColIndex
        : -1
    }
    return this._firstEditableColumnIndex(rowIndex)
  }

  private _moveFocusedCol(delta: -1 | 1): number {
    const columns = this._getColumns()
    if (columns.length === 0) return -1
    const current = this.focusedColIndex >= 0 ? this.focusedColIndex : this._normalizeFocusedColumn()
    const next = current + delta
    if (next < 0 || next >= columns.length) return -1
    return next
  }

  private _moveToNextTabStop(rowIndex: number, colIndex: number): boolean {
    const columns = this._getColumns()
    for (let index = Math.max(0, colIndex + 1); index < columns.length; index++) {
      if (!this._structureEditing.isCellTabStop(rowIndex, index)) continue
      this.focusCell(rowIndex, index, { select: true, scroll: true })
      return true
    }
    const visibleRows = this._dataModel.visibleRows()
    for (let nextRow = rowIndex + 1; nextRow < visibleRows.length; nextRow++) {
      for (let index = 0; index < columns.length; index++) {
        if (!this._structureEditing.isCellTabStop(nextRow, index)) continue
        this.focusCell(nextRow, index, { select: true, scroll: true })
        return true
      }
    }
    return false
  }

  private _moveToPrevTabStop(rowIndex: number, colIndex: number): boolean {
    const columns = this._getColumns()
    const start = colIndex >= 0 ? colIndex - 1 : columns.length - 1
    for (let index = start; index >= 0; index--) {
      if (!this._structureEditing.isCellTabStop(rowIndex, index)) continue
      this.focusCell(rowIndex, index, { select: true, scroll: true })
      return true
    }
    for (let previousRow = rowIndex - 1; previousRow >= 0; previousRow--) {
      for (let index = columns.length - 1; index >= 0; index--) {
        if (!this._structureEditing.isCellTabStop(previousRow, index)) continue
        this.focusCell(previousRow, index, { select: true, scroll: true })
        return true
      }
    }
    return false
  }

  private _syncSelectionForFocusedDataItem(
    item: GridDataItem<T>,
    modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
  ): void {
    const rowIndex = item.dataRowIndex
    if (modifiers.shiftKey) {
      if (this._rowSelection.anchor === null && this.focusedRow >= 0) {
        this._rowSelection.selectOnly(this.focusedRow)
      }
      this._rowSelection.extendDiscreteRange(rowIndex)
      this._syncSelectedIdentitiesFromVisible()
      return
    }
    if (modifiers.ctrlKey || modifiers.metaKey) {
      this._rowSelection.setFocus(rowIndex)
      return
    }
    this._rowSelection.selectOnly(rowIndex)
    this._rowSelection.setFocus(rowIndex)
    this._syncSelectedIdentitiesFromVisible()
  }

  private _syncSelectedIdentitiesFromVisible(): void {
    this._selectedSourceRows.clear()
    this._selectedRowRefs.clear()
    this._selectedRowIds.clear()
    const visibleRows = this._dataModel.visibleRows()
    const visibleRowIndices = this._dataModel.visibleRowIndices()
    const visibleRowIds = this._dataModel.visibleRowIds()
    for (const rowIndex of this.selectedRows) {
      const row = visibleRows[rowIndex]
      if (row) this._selectedRowRefs.add(row)
      const sourceIndex = visibleRowIndices[rowIndex]
      if (sourceIndex !== undefined) this._selectedSourceRows.add(sourceIndex)
      const rowId = visibleRowIds[rowIndex]
      if (rowId !== undefined && rowId !== null) this._selectedRowIds.add(rowId)
    }
  }

  private _refreshVisibleSelectionFromSources(visibleRowCount: number): void {
    const hadRowIds = this._selectedRowIds.size > 0
    this._pruneMissingSelectedRowIds()
    if (hadRowIds && this._selectedRowIds.size === 0 && this._dataModel.hasRowKey()) {
      this._rowSelection.replaceSelected(new Set())
      this._rowSelection.clampDiscrete(visibleRowCount)
      return
    }
    this._syncSelectedSourcesFromRowIds()
    if (
      this._selectedSourceRows.size === 0 &&
      this._selectedRowRefs.size === 0 &&
      this._selectedRowIds.size === 0
    ) {
      this._rowSelection.clampDiscrete(visibleRowCount)
      return
    }

    const visibleRows = this._dataModel.visibleRows()
    const visibleRowIndices = this._dataModel.visibleRowIndices()
    const visibleRowIds = this._dataModel.visibleRowIds()
    const nextRows = new Set<number>()
    if (this._dataModel.hasRowKey() && this._selectedRowIds.size > 0) {
      visibleRowIds.forEach((rowId, visibleRowIndex) => {
        if (rowId !== null && this._selectedRowIds.has(rowId)) nextRows.add(visibleRowIndex)
      })
    } else if (this._selectedRowRefs.size > 0) {
      visibleRows.forEach((row, visibleRowIndex) => {
        if (this._selectedRowRefs.has(row)) nextRows.add(visibleRowIndex)
      })
    } else {
      visibleRowIndices.forEach((sourceIndex, visibleRowIndex) => {
        if (this._selectedSourceRows.has(sourceIndex)) nextRows.add(visibleRowIndex)
      })
    }

    const currentRows = this.selectedRows
    const changed =
      nextRows.size !== currentRows.size ||
      [...nextRows].some(row => !currentRows.has(row)) ||
      [...currentRows].some(row => !nextRows.has(row))

    if (!changed) {
      this._rowSelection.clampDiscrete(visibleRowCount)
      return
    }

    this._rowSelection.replaceSelected(nextRows)
  }

  private _pruneMissingSelectedRowIds(): void {
    if (!this._dataModel.hasRowKey() || this._selectedRowIds.size === 0) return
    for (const rowId of [...this._selectedRowIds]) {
      if (this._dataModel.sourceRowIndexForRowId(rowId) < 0) this._selectedRowIds.delete(rowId)
    }
    if (this._selectedRowIds.size === 0) this._selectedSourceRows.clear()
  }

  private _syncSelectedSourcesFromRowIds(): void {
    if (!this._dataModel.hasRowKey() || this._selectedRowIds.size === 0) return
    this._selectedSourceRows.clear()
    for (const rowId of this._selectedRowIds) {
      const sourceIndex = this._dataModel.sourceRowIndexForRowId(rowId)
      if (sourceIndex >= 0) this._selectedSourceRows.add(sourceIndex)
    }
  }

  private _syncFocusedRowIdFromCurrentItem(): void {
    const item = this.focusedItem()
    this._focusedRowRef = item?.kind === 'data' ? item.row : null
    this._focusedRowId = item?.kind === 'data' ? item.rowId : null
    this._focusedGroupPathKey = item?.kind === 'group' ? item.pathKey : null
  }

  private _restoreFocusedRowById(): void {
    if (this._focusedGroupPathKey) {
      const itemIndex = this._dataModel.visibleItemIndexForPathKey(this._focusedGroupPathKey)
      if (itemIndex >= 0) {
        this.focusedItemIndex = itemIndex
        this.focusedColIndex = -1
        return
      }
      this.focusedItemIndex = -1
      this.focusedColIndex = -1
      this._focusedGroupPathKey = null
      return
    }
    if (this._focusedRowRef) {
      const rowIndex = this._dataModel.visibleRows().indexOf(this._focusedRowRef)
      if (rowIndex >= 0) {
        this.focusedItemIndex = this._dataModel.visibleItemIndexForVisibleRow(rowIndex)
        return
      }
      if (!this._dataModel.hasRowKey()) {
        this.focusedItemIndex = -1
        this.focusedColIndex = -1
        this._focusedRowRef = null
        this._focusedGroupPathKey = null
        return
      }
    }
    if (!this._dataModel.hasRowKey() || this._focusedRowId === null) return
    const rowIndex = this._dataModel.visibleRowIndexForRowId(this._focusedRowId)
    if (rowIndex >= 0) {
      this.focusedItemIndex = this._dataModel.visibleItemIndexForVisibleRow(rowIndex)
      const row = this._dataModel.visibleRows()[rowIndex]
      this._focusedRowRef = row ?? null
      return
    }
    this.focusedItemIndex = -1
    this.focusedColIndex = -1
    this._focusedRowRef = null
    this._focusedGroupPathKey = null
  }

  private sortedRowIds(): GridRowId[] {
    return [...this._selectedRowIds].sort((left, right) => {
      if (typeof left === 'number' && typeof right === 'number') return left - right
      return String(left).localeCompare(String(right), undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    })
  }
}
