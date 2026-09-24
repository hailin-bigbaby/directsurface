import { PopupManager, popupViewportRect, type PopupViewport } from '../../core/popup_manager'
import type { Offset } from '../../core/render_object'
import { MenuPopup, type ContextMenuEntry } from '../menu_popup'
import type {
  GridColumnDef,
  GridColumnMenuDebugState,
  GridColumnState,
  GridFilterRule,
  GridSortDescriptor,
} from './grid_types'
import type { GridViewport } from './grid_viewport'

export interface GridColumnMenuControllerOptions<T extends Record<string, any>> {
  owner: object
  viewport: GridViewport<T>
  getGlobalOffset: () => Offset
  getColumns: () => Array<GridColumnDef<T>>
  getAllColumns: () => Array<GridColumnDef<T>>
  getColumnState: () => GridColumnState[]
  getSort: () => GridSortDescriptor[]
  getFilters: () => GridFilterRule[]
  getFilterValue: (key: string) => string
  canAutoFitColumns: () => boolean
  setColumnState: (state: GridColumnState[]) => void
  setSort: (sort: GridSortDescriptor[]) => void
  clearColumnFilter: (key: string) => void
  openFilterPopup: (colIndex: number) => void
  autoFitColumn: (colIndex: number) => void
  autoFitAllColumns: () => void
  resetColumnWidths: () => void
  resetColumnState: () => void
  onMarkNeedsPaint: () => void
}

export class GridColumnMenuController<T extends Record<string, any> = any> {
  private readonly _owner: GridColumnMenuControllerOptions<T>['owner']
  private readonly _viewport: GridViewport<T>
  private readonly _getGlobalOffset: GridColumnMenuControllerOptions<T>['getGlobalOffset']
  private readonly _getColumns: GridColumnMenuControllerOptions<T>['getColumns']
  private readonly _getAllColumns: GridColumnMenuControllerOptions<T>['getAllColumns']
  private readonly _getColumnState: GridColumnMenuControllerOptions<T>['getColumnState']
  private readonly _getSort: GridColumnMenuControllerOptions<T>['getSort']
  private readonly _getFilters: GridColumnMenuControllerOptions<T>['getFilters']
  private readonly _getFilterValue: GridColumnMenuControllerOptions<T>['getFilterValue']
  private readonly _canAutoFitColumns: GridColumnMenuControllerOptions<T>['canAutoFitColumns']
  private readonly _setColumnState: GridColumnMenuControllerOptions<T>['setColumnState']
  private readonly _setSort: GridColumnMenuControllerOptions<T>['setSort']
  private readonly _clearColumnFilter: GridColumnMenuControllerOptions<T>['clearColumnFilter']
  private readonly _openFilterPopup: GridColumnMenuControllerOptions<T>['openFilterPopup']
  private readonly _autoFitColumn: GridColumnMenuControllerOptions<T>['autoFitColumn']
  private readonly _autoFitAllColumns: GridColumnMenuControllerOptions<T>['autoFitAllColumns']
  private readonly _resetColumnWidths: GridColumnMenuControllerOptions<T>['resetColumnWidths']
  private readonly _resetColumnState: GridColumnMenuControllerOptions<T>['resetColumnState']
  private readonly _onMarkNeedsPaint: GridColumnMenuControllerOptions<T>['onMarkNeedsPaint']

  private _columnMenuCol = -1
  private _columnMenuKey = ''
  private _columnMenu: MenuPopup | null = null

  constructor(options: GridColumnMenuControllerOptions<T>) {
    this._owner = options.owner
    this._viewport = options.viewport
    this._getGlobalOffset = options.getGlobalOffset
    this._getColumns = options.getColumns
    this._getAllColumns = options.getAllColumns
    this._getColumnState = options.getColumnState
    this._getSort = options.getSort
    this._getFilters = options.getFilters
    this._getFilterValue = options.getFilterValue
    this._canAutoFitColumns = options.canAutoFitColumns
    this._setColumnState = options.setColumnState
    this._setSort = options.setSort
    this._clearColumnFilter = options.clearColumnFilter
    this._openFilterPopup = options.openFilterPopup
    this._autoFitColumn = options.autoFitColumn
    this._autoFitAllColumns = options.autoFitAllColumns
    this._resetColumnWidths = options.resetColumnWidths
    this._resetColumnState = options.resetColumnState
    this._onMarkNeedsPaint = options.onMarkNeedsPaint
  }

  get columnMenuColumn(): number { return this._columnMenuCol }

  debugState(): GridColumnMenuDebugState {
    return {
      visible: this._columnMenuCol >= 0,
      column: this._columnMenuCol,
      columnKey: this._columnMenuKey,
    }
  }

  openColumnMenu(colIndex: number, position?: Offset): boolean {
    const column = this._getColumns()[colIndex]
    if (!column) return false
    this.closeColumnMenu()
    this._columnMenuCol = colIndex
    this._columnMenuKey = column.key
    this._columnMenu = new MenuPopup({
      owner: this._owner,
      items: this._buildMenuItems(column),
      onSelect: key => this._handleMenuSelection(key),
      position: popupContext => position ? { ...position } : this._defaultMenuPosition(colIndex, popupContext.viewport),
      bounds: popupContext => popupViewportRect(popupContext),
      onClose: () => {
        this._handleColumnMenuClosed()
      },
    })
    this._columnMenu.open()
    this._onMarkNeedsPaint()
    return true
  }

  closeColumnMenu(): void {
    if (this._columnMenuCol < 0 && !this._columnMenu) return
    const popup = this._columnMenu
    if (!popup) {
      this._handleColumnMenuClosed()
      return
    }
    popup.dismiss()
  }

  dispose(): void {
    this._columnMenu?.dismiss()
    this._columnMenu = null
    this._columnMenuCol = -1
    this._columnMenuKey = ''
  }

  private _buildMenuItems(column: GridColumnDef<T>): ContextMenuEntry[] {
    const state = this._getColumnState()
    const columnState = state.find(entry => entry.key === column.key)
    const visibleCount = state.filter(entry => !entry.hidden).length
    const pinned = columnState?.pinned ?? (column.fixed ? 'left' : false)
    const sort = this._getSort()
    const currentSort = sort.find(entry => entry.key === column.key)
    const hasColumnFilter = this._hasColumnFilter(column.key)
    const hasHiddenColumns = state.some(entry => entry.hidden)

    const autoFitItems: ContextMenuEntry[] = this._canAutoFitColumns()
      ? [
          {
            key: 'best-fit-column',
            label: 'Best Fit This Column',
          },
          {
            key: 'best-fit-all-columns',
            label: 'Best Fit All Columns',
          },
          {
            key: 'reset-column-widths',
            label: 'Reset Column Widths',
          },
          { separator: true },
        ]
      : []

    return [
      {
        key: 'sort-asc',
        label: 'Sort Ascending',
        icon: currentSort?.order === 'asc' ? 'check' : undefined,
        disabled: !column.sortable,
      },
      {
        key: 'sort-desc',
        label: 'Sort Descending',
        icon: currentSort?.order === 'desc' ? 'check' : undefined,
        disabled: !column.sortable,
      },
      {
        key: 'clear-sort',
        label: 'Clear Column Sort',
        disabled: !currentSort,
      },
      { separator: true },
      {
        key: 'filter-column',
        label: 'Filter...',
        disabled: !column.filterable,
      },
      {
        key: 'clear-column-filter',
        label: 'Clear Column Filter',
        disabled: !hasColumnFilter,
      },
      { separator: true },
      ...autoFitItems,
      {
        key: 'pin-left',
        label: 'Pin Left',
        icon: pinned === 'left' ? 'check' : undefined,
        disabled: pinned === 'left',
      },
      {
        key: 'pin-right',
        label: 'Pin Right',
        icon: pinned === 'right' ? 'check' : undefined,
        disabled: pinned === 'right',
      },
      {
        key: 'unpin',
        label: 'Unpin',
        disabled: !pinned,
      },
      {
        key: 'hide-column',
        label: 'Hide Column',
        disabled: visibleCount <= 1,
      },
      {
        key: 'column-chooser',
        label: 'Columns',
        items: state.map(entry => ({
          key: `toggle-column:${entry.key}`,
          label: this._columnTitle(entry.key),
          icon: entry.hidden ? undefined : 'check',
          disabled: !entry.hidden && visibleCount <= 1,
        })),
      },
      { separator: true },
      {
        key: 'show-all-columns',
        label: 'Show All Columns',
        disabled: !hasHiddenColumns,
      },
      {
        key: 'reset-columns',
        label: 'Reset Column Layout',
      },
    ]
  }

  private _handleMenuSelection(key: string): void {
    const columnKey = this._columnMenuKey
    const columnIndex = this._columnMenuCol
    this.closeColumnMenu()
    if (!columnKey) return

    if (key === 'sort-asc' || key === 'sort-desc') {
      this._setSort([{ key: columnKey, order: key === 'sort-asc' ? 'asc' : 'desc' }])
      return
    }
    if (key === 'clear-sort') {
      this._setSort(this._getSort().filter(sort => sort.key !== columnKey))
      return
    }
    if (key === 'filter-column') {
      this._openFilterPopup(columnIndex)
      return
    }
    if (key === 'clear-column-filter') {
      this._clearColumnFilter(columnKey)
      return
    }
    if (key === 'best-fit-column') {
      if (this._canAutoFitColumns()) this._autoFitColumn(columnIndex)
      return
    }
    if (key === 'best-fit-all-columns') {
      if (this._canAutoFitColumns()) this._autoFitAllColumns()
      return
    }
    if (key === 'reset-column-widths') {
      if (this._canAutoFitColumns()) this._resetColumnWidths()
      return
    }
    if (key === 'pin-left' || key === 'pin-right' || key === 'unpin') {
      this._updateColumnState(columnKey, {
        pinned: key === 'pin-left' ? 'left' : key === 'pin-right' ? 'right' : false,
      })
      return
    }
    if (key === 'hide-column') {
      this._updateColumnState(columnKey, { hidden: true })
      return
    }
    if (key.startsWith('toggle-column:')) {
      const keyToToggle = key.slice('toggle-column:'.length)
      const current = this._getColumnState().find(entry => entry.key === keyToToggle)
      if (current) this._updateColumnState(keyToToggle, { hidden: !current.hidden })
      return
    }
    if (key === 'show-all-columns') {
      this._setColumnState(this._getColumnState().map(entry => ({ ...entry, hidden: false })))
      return
    }
    if (key === 'reset-columns') {
      this._resetColumnState()
    }
  }

  private _updateColumnState(key: string, patch: Partial<GridColumnState>): void {
    this._setColumnState(this._getColumnState().map(entry =>
      entry.key === key ? { ...entry, ...patch } : entry
    ))
  }

  private _hasColumnFilter(key: string): boolean {
    return !!this._getFilterValue(key) || this._getFilters().some(filter => filter.key === key)
  }

  private _columnTitle(key: string): string {
    return this._getAllColumns().find(column => column.key === key)?.title ??
      this._getColumnState().find(entry => entry.key === key)?.key ??
      key
  }

  private _defaultMenuPosition(colIndex: number, viewport: PopupViewport): Offset {
    const columns = this._getColumns()
    const globalOffset = this._getGlobalOffset()
    const columnX = this._viewport.cellX(columns, globalOffset.x, colIndex)
    const columnW = this._viewport.colWidths[colIndex] ?? 0
    const viewportRect = popupViewportRect(viewport)
    const x = Math.min(columnX + Math.max(8, columnW - 20), viewportRect.x + viewportRect.width - 8)
    const y = globalOffset.y + this._viewport.headerSectionHeight + 2
    return { x, y }
  }

  private _handleColumnMenuClosed(): void {
    this._columnMenu = null
    this._columnMenuCol = -1
    this._columnMenuKey = ''
    this._onMarkNeedsPaint()
    PopupManager.instance.requestPaint()
  }
}
