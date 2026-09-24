import type { Offset } from '../../core/render_object'
import {
  deriveGridCellStyle,
  deriveScrollbarStyle,
  type ResolvedGridCellStyleTokens,
  type ScrollbarStyleTokens,
} from '../../theme/component_styles'
import type { ResolvedTheme } from '../../theme/theme'
import type { GridEditingController } from './grid_editing_controller'
import type { GridInteractionController } from './grid_interaction_controller'
import type { GridPainter } from './grid_painter'
import type {
  GridCellErrorState,
  GridCellRange,
  GridColumnState,
  GridDataState,
  GridDebugState,
  GridFilterRule,
  GridPopupDebugState,
  GridPopupAnchorData,
  GridSelectionMode,
  GridSortDescriptor,
  GridSortState,
  GridSummaryCellDebugState,
  GridVisibleItem,
} from './grid_types'
import type { GridViewport } from './grid_viewport'

export interface GridViewShellControllerOptions<T extends Record<string, any>> {
  viewport: GridViewport<T>
  interaction: GridInteractionController<T>
  editing: GridEditingController<T>
  painter: GridPainter<T>
  getCurrentTheme: () => ResolvedTheme
  getGlobalOffset: () => Offset
  getSortState: () => GridSortState
  getSortDescriptors?: () => GridSortDescriptor[]
  getFilters?: () => GridFilterRule[]
  getQuickFilter?: () => string
  getDataState?: () => GridDataState
  getStateMessage?: () => string
  getSelectionMode?: () => GridSelectionMode
  getRangeSelectionAutoScroll?: () => boolean
  getDisabled?: () => boolean
  getReadonly?: () => boolean
  getCurrentCell?: () => { row: number; col: number } | null
  getSelectedRanges?: () => GridCellRange[]
  getSummaryCells?: () => GridSummaryCellDebugState[]
  getFooterHeight?: () => number
  getFilterRowVisible?: () => boolean
  getFilterRowHeight?: () => number
  getColumnState?: () => GridColumnState[]
  getCellErrors?: () => GridCellErrorState[]
  getPopupDebugState: () => GridPopupDebugState
  getCellGlobalRect: (row: number, col: number) => { x: number; y: number; w: number; h: number }
}

export class GridViewShellController<T extends Record<string, any> = any> {
  private readonly _viewport: GridViewport<T>
  private readonly _interaction: GridInteractionController<T>
  private readonly _editing: GridEditingController<T>
  private readonly _painter: GridPainter<T>
  private readonly _getCurrentTheme: GridViewShellControllerOptions<T>['getCurrentTheme']
  private readonly _getGlobalOffset: GridViewShellControllerOptions<T>['getGlobalOffset']
  private readonly _getSortState: GridViewShellControllerOptions<T>['getSortState']
  private readonly _getSortDescriptors: NonNullable<GridViewShellControllerOptions<T>['getSortDescriptors']>
  private readonly _getFilters: NonNullable<GridViewShellControllerOptions<T>['getFilters']>
  private readonly _getQuickFilter: NonNullable<GridViewShellControllerOptions<T>['getQuickFilter']>
  private readonly _getDataState: NonNullable<GridViewShellControllerOptions<T>['getDataState']>
  private readonly _getStateMessage: NonNullable<GridViewShellControllerOptions<T>['getStateMessage']>
  private readonly _getSelectionMode: NonNullable<GridViewShellControllerOptions<T>['getSelectionMode']>
  private readonly _getRangeSelectionAutoScroll: NonNullable<GridViewShellControllerOptions<T>['getRangeSelectionAutoScroll']>
  private readonly _getDisabled: NonNullable<GridViewShellControllerOptions<T>['getDisabled']>
  private readonly _getReadonly: NonNullable<GridViewShellControllerOptions<T>['getReadonly']>
  private readonly _getCurrentCell: NonNullable<GridViewShellControllerOptions<T>['getCurrentCell']>
  private readonly _getSelectedRanges: NonNullable<GridViewShellControllerOptions<T>['getSelectedRanges']>
  private readonly _getSummaryCells: NonNullable<GridViewShellControllerOptions<T>['getSummaryCells']>
  private readonly _getFooterHeight: NonNullable<GridViewShellControllerOptions<T>['getFooterHeight']>
  private readonly _getFilterRowVisible: NonNullable<GridViewShellControllerOptions<T>['getFilterRowVisible']>
  private readonly _getFilterRowHeight: NonNullable<GridViewShellControllerOptions<T>['getFilterRowHeight']>
  private readonly _getColumnState: NonNullable<GridViewShellControllerOptions<T>['getColumnState']>
  private readonly _getCellErrors: NonNullable<GridViewShellControllerOptions<T>['getCellErrors']>
  private readonly _getPopupDebugState: GridViewShellControllerOptions<T>['getPopupDebugState']
  private readonly _getCellGlobalRect: GridViewShellControllerOptions<T>['getCellGlobalRect']

  constructor(options: GridViewShellControllerOptions<T>) {
    this._viewport = options.viewport
    this._interaction = options.interaction
    this._editing = options.editing
    this._painter = options.painter
    this._getCurrentTheme = options.getCurrentTheme
    this._getGlobalOffset = options.getGlobalOffset
    this._getSortState = options.getSortState
    this._getSortDescriptors = options.getSortDescriptors ?? (() => [])
    this._getFilters = options.getFilters ?? (() => [])
    this._getQuickFilter = options.getQuickFilter ?? (() => '')
    this._getDataState = options.getDataState ?? (() => 'ready')
    this._getStateMessage = options.getStateMessage ?? (() => '')
    this._getSelectionMode = options.getSelectionMode ?? (() => 'row')
    this._getRangeSelectionAutoScroll = options.getRangeSelectionAutoScroll ?? (() => true)
    this._getDisabled = options.getDisabled ?? (() => false)
    this._getReadonly = options.getReadonly ?? (() => false)
    this._getCurrentCell = options.getCurrentCell ?? (() => null)
    this._getSelectedRanges = options.getSelectedRanges ?? (() => [])
    this._getSummaryCells = options.getSummaryCells ?? (() => [])
    this._getFooterHeight = options.getFooterHeight ?? (() => 0)
    this._getFilterRowVisible = options.getFilterRowVisible ?? (() => false)
    this._getFilterRowHeight = options.getFilterRowHeight ?? (() => 0)
    this._getColumnState = options.getColumnState ?? (() => [])
    this._getCellErrors = options.getCellErrors ?? (() => [])
    this._getPopupDebugState = options.getPopupDebugState
    this._getCellGlobalRect = options.getCellGlobalRect
  }

  popupAnchorRect(anchor?: GridPopupAnchorData): { x: number; y: number; width: number; height: number } {
    if (!anchor) return { x: 0, y: 0, width: 0, height: 0 }
    const rect = this._getCellGlobalRect(anchor.row, anchor.col)
    return { x: rect.x, y: rect.y, width: rect.w, height: rect.h }
  }

  isInGroupToggleHitBox(
    item: Extract<GridVisibleItem<T>, { kind: 'group' }>,
    position: Offset,
  ): boolean {
    const metrics = this._painter.groupRowMetrics(
      this._getGlobalOffset().x,
      item.depth,
      this.gridTokens(),
    )
    return Math.abs(position.x - metrics.arrowCenterX) <= 10
  }

  debugState(): GridDebugState {
    return {
      scrollX: this._viewport.scrollX,
      scrollY: this._viewport.scrollY,
      focusedRow: this._interaction.focusedRow,
      focusedCol: this._interaction.focusedColIndex,
      hoveredRow: this._interaction.hoveredRow,
      focusedItemIndex: this._interaction.focusedItemIndex,
      hoveredItemIndex: this._interaction.hoveredItemIndex,
      sortState: this._getSortState(),
      sort: this._getSortDescriptors(),
      filters: this._getFilters(),
      quickFilter: this._getQuickFilter(),
      dataState: this._getDataState(),
      stateMessage: this._getStateMessage(),
      selectionMode: this._getSelectionMode(),
      rangeSelectionAutoScroll: this._getRangeSelectionAutoScroll(),
      disabled: this._getDisabled(),
      readonly: this._getReadonly(),
      currentCell: this._getCurrentCell(),
      selectedRanges: this._getSelectedRanges(),
      summary: this._getSummaryCells().map(cell => ({ ...cell })),
      footerHeight: this._getFooterHeight(),
      filterRowVisible: this._getFilterRowVisible(),
      filterRowHeight: this._getFilterRowHeight(),
      columns: this._getColumnState(),
      rowHeight: this._viewport.rowHeight,
      headerHeight: this._viewport.headerHeight,
      cellErrors: this._getCellErrors(),
      edit: this._editing.state
        ? {
            row: this._editing.state.row,
            col: this._editing.state.col,
            text: this._editing.state.text,
          }
        : null,
    }
  }

  debugPopupState(): GridPopupDebugState {
    return this._getPopupDebugState()
  }

  gridTokens(theme: ResolvedTheme = this._getCurrentTheme()): ResolvedGridCellStyleTokens {
    return deriveGridCellStyle(theme)
  }

  scrollbarTokens(theme: ResolvedTheme = this._getCurrentTheme()): ScrollbarStyleTokens {
    return deriveScrollbarStyle(theme)
  }
}
