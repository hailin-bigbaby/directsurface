import type { Focusable } from '../../core/focus_manager'
import type { PopupAnchorTarget } from '../../core/popup_anchor'
import type { Offset } from '../../core/render_object'
import { TextMeasurer } from '../../core/text_measurer'
import { deriveGridCellStyle } from '../../theme/component_styles'
import type { ResolvedTheme } from '../../theme/theme'
import { GridCellPopupEditors } from './grid_cell_popup_editors'
import { GridEditingController } from './grid_editing_controller'
import { GridEditingGeometryController } from './grid_editing_geometry_controller'
import { GridFilterPopupController } from './grid_filter_popup_controller'
import { GridInteractionController } from './grid_interaction_controller'
import { GridPointerController } from './grid_pointer_controller'
import { GridStateController } from './grid_state_controller'
import { GridStructureEditController } from './grid_structure_edit_controller'
import type { GridDataModel } from './grid_data_model'
import type {
  GridCellStyleArgs,
  GridCellStyleOverride,
  GridCellValidationArgs,
  GridCellValidationResult,
  GridColumnDef,
  GridInternalRowEvent,
  GridEmbeddedPopupGrid,
  GridEditorValidationMessages,
  GridGroupDef,
  GridGroupItem,
  GridPopupAnchorData,
  GridRowStyleArgs,
  GridRowStyleOverride,
  GridRowValidationArgs,
  GridRowValidationResult,
  GridResolvedCellEditPolicy,
} from './grid_types'
import type { GridViewport } from './grid_viewport'

export type GridControllerOwner<T extends Record<string, any>> =
  PopupAnchorTarget<GridPopupAnchorData> &
  Focusable & {
    globalOffset: Offset
    hitTest(position: Offset): boolean
    markNeedsPaint(): void
    markNeedsLayout(): void
  }

export interface GridControllerBundleOptions<T extends Record<string, any>> {
  owner: GridControllerOwner<T>
  dataModel: GridDataModel<T>
  viewport: GridViewport<T>
  editable: () => boolean
  sortable: () => boolean
  reorderableColumns: () => boolean
  resizableColumns: () => boolean
  autoFitColumns: () => boolean
  rangeSelectionAutoScroll: () => boolean
  groupBy: () => GridGroupDef<T>[]
  getColumns: () => GridColumnDef<T>[]
  getAllColumns?: () => GridColumnDef<T>[]
  getCurrentTheme: () => ResolvedTheme
  getSelectedRows: () => Set<number>
  getResolveRowStyle: () => ((args: GridRowStyleArgs<T>) => GridRowStyleOverride | null | undefined) | undefined
  getResolveCellStyle: () => ((args: GridCellStyleArgs<T>) => GridCellStyleOverride | null | undefined) | undefined
  getValidateCell?: () => ((args: GridCellValidationArgs<T>) => GridCellValidationResult) | undefined
  getValidateRow?: () => ((args: GridRowValidationArgs<T>) => GridRowValidationResult<T>) | undefined
  getEditorValidationMessages?: () => Readonly<GridEditorValidationMessages>
  getCellEditPolicy?: (rowIndex: number, colIndex: number) => GridResolvedCellEditPolicy
  setCursor: (cursor: string) => void
  onRowClick?: (row: T, event: GridInternalRowEvent) => void
  onRowActivate?: (row: T, event: GridInternalRowEvent) => void
  onInteractionStateChange?: () => void
  onMoveColumn?: (fromIndex: number, toIndex: number) => void
  onResizeColumn?: (colIndex: number, width: number) => void
  onAutoFitColumn?: (colIndex: number) => void
  isInGroupToggleHitBox: (item: GridGroupItem<T>, position: Offset) => boolean
  createEmbeddedGrid: () => GridEmbeddedPopupGrid
}

export interface GridControllerBundle<T extends Record<string, any>> {
  structureEditing: GridStructureEditController<T>
  cellPopupEditors: GridCellPopupEditors<T>
  filterPopupController: GridFilterPopupController<T>
  editing: GridEditingController<T>
  interaction: GridInteractionController<T>
  editingGeometry: GridEditingGeometryController<T>
  stateController: GridStateController<T>
  pointer: GridPointerController<T>
}

export function createGridControllerBundle<T extends Record<string, any>>(
  options: GridControllerBundleOptions<T>,
): GridControllerBundle<T> {
  const structureEditing = new GridStructureEditController<T>({
    dataModel: options.dataModel,
    getColumns: options.getColumns,
    getAllColumns: options.getAllColumns,
    getValidateCell: options.getValidateCell,
    getValidateRow: options.getValidateRow,
    getEditorValidationMessages: options.getEditorValidationMessages,
    getCellEditPolicy: options.getCellEditPolicy,
  })

  let editing!: GridEditingController<T>
  let interaction!: GridInteractionController<T>
  let editingGeometry!: GridEditingGeometryController<T>
  let stateController!: GridStateController<T>

  const markNeedsPaint = () => options.owner.markNeedsPaint()
  const syncEditingViewportState = () => editingGeometry.syncEditingViewportState()
  const scrollToItem = (itemIndex: number) => {
    options.viewport.scrollToRow(options.dataModel.visibleItemCount(), itemIndex)
    syncEditingViewportState()
  }
  const revealCell = (rowIndex: number, colIndex: number) => {
    const itemIndex = options.dataModel.visibleItemIndexForVisibleRow(rowIndex)
    if (itemIndex < 0) return
    options.viewport.scrollToRow(options.dataModel.visibleItemCount(), itemIndex)
    options.viewport.scrollToColumn(options.getColumns(), colIndex)
    syncEditingViewportState()
  }

  const cellPopupEditors = new GridCellPopupEditors<T>({
    owner: options.owner,
    structureEditing,
    getVisibleRows: () => options.dataModel.visibleRows(),
    onEndEdit: () => editing.endEdit(),
    createEmbeddedGrid: options.createEmbeddedGrid,
  })

  const filterPopupController = new GridFilterPopupController<T>({
    owner: options.owner,
    dataModel: options.dataModel,
    viewport: options.viewport,
    getGlobalOffset: () => options.owner.globalOffset,
    getColumns: options.getColumns,
    onMarkNeedsPaint: markNeedsPaint,
  })

  editing = new GridEditingController<T>({
    owner: options.owner,
    focusableOwner: options.owner,
    structureEditing,
    cellPopupEditors,
    editable: options.editable,
    getColumns: options.getColumns,
    getVisibleRows: () => options.dataModel.visibleRows(),
    getVisibleRowId: row => options.dataModel.visibleRowId(row),
    getVisibleRowIndexForRowId: rowId => options.dataModel.visibleRowIndexForRowId(rowId),
    getEditTextMetrics: (row, col) => editingGeometry.editTextMetrics(row, col),
    measureText: (text, fontSize, fontFamily) => TextMeasurer.measureWidth(text, fontSize, fontFamily),
    getCellGlobalRect: (row, col) => editingGeometry.cellGlobalRect(row, col),
    getCellEditRect: (row, col) => editingGeometry.cellVisibleGlobalRect(row, col),
    onMarkNeedsPaint: markNeedsPaint,
    onRevealCell: revealCell,
    onRevealCaret: (_row, col, columnOffsetX, insets) =>
      options.viewport.scrollToColumnPoint(options.getColumns(), col, columnOffsetX, insets),
    onFocusedCellChange: (row, col) => {
      interaction.focusCell(row, col, { select: false, scroll: false })
    },
  })

  interaction = new GridInteractionController<T>({
    dataModel: options.dataModel,
    structureEditing,
    editable: options.editable,
    getColumns: options.getColumns,
    getPageStep: () => Math.max(1, Math.floor(options.viewport.viewHeight / Math.max(1, options.viewport.rowHeight)) - 1),
    onMarkNeedsPaint: markNeedsPaint,
    onScrollToItem: scrollToItem,
    onRevealCell: revealCell,
    onBeginEdit: (row, col) => editing.startEdit(row, col),
    onToggleGroup: pathKey => stateController.toggleGroup(pathKey),
    onRowClick: options.onRowClick,
    onRowActivate: options.onRowActivate,
  })

  editingGeometry = new GridEditingGeometryController<T>({
    dataModel: options.dataModel,
    viewport: options.viewport,
    editing,
    interaction,
    getColumns: options.getColumns,
    getGlobalOffset: () => options.owner.globalOffset,
    getCurrentTheme: options.getCurrentTheme,
    getSelectedRows: options.getSelectedRows,
    getResolveRowStyle: options.getResolveRowStyle,
    getResolveCellStyle: options.getResolveCellStyle,
  })

  stateController = new GridStateController<T>({
    dataModel: options.dataModel,
    viewport: options.viewport,
    editing,
    interaction,
    structureEditing,
    sortable: options.sortable,
    getColumns: options.getColumns,
    getCurrentTheme: options.getCurrentTheme,
    getGlobalOffset: () => options.owner.globalOffset,
    onSyncEditingViewportState: syncEditingViewportState,
    onInteractionStateChange: options.onInteractionStateChange,
    onMarkNeedsPaint: markNeedsPaint,
    onMarkNeedsLayout: () => options.owner.markNeedsLayout(),
  })
  options.dataModel.onVisibleRowsInvalidated = reason => stateController.handleVisibleRowsInvalidated(reason)

  const pointer = new GridPointerController<T>({
    focusableOwner: options.owner,
    dataModel: options.dataModel,
    viewport: options.viewport,
    editing,
    interaction,
    filterPopupController,
    hitTest: position => options.owner.hitTest(position),
    getGlobalOffset: () => options.owner.globalOffset,
    getColumns: options.getColumns,
    canResizeColumns: options.resizableColumns,
    canAutoFitColumns: options.autoFitColumns,
    canRangeSelectionAutoScroll: options.rangeSelectionAutoScroll,
    canReorderColumns: options.reorderableColumns,
    canSortColumns: options.sortable,
    getHeaderActionStyle: () => {
      const style = deriveGridCellStyle(options.getCurrentTheme())
      return { paddingH: style.paddingH, fontSize: style.fontSize, metrics: style.headerAction }
    },
    isInGroupToggleHitBox: options.isInGroupToggleHitBox,
    onMoveColumn: (fromIndex, toIndex) => {
      if (options.onMoveColumn) options.onMoveColumn(fromIndex, toIndex)
      else stateController.moveColumn(fromIndex, toIndex)
    },
    onResizeColumn: (colIndex, width) => options.onResizeColumn?.(colIndex, width),
    onAutoFitColumn: colIndex => options.onAutoFitColumn?.(colIndex),
    onToggleSortAt: (globalX, additive) => stateController.toggleSortAt(globalX, additive),
    onToggleGroup: pathKey => stateController.toggleGroup(pathKey),
    onSyncEditingViewportState: syncEditingViewportState,
    onInteractionStateChange: options.onInteractionStateChange,
    onSetCursor: options.setCursor,
    onMarkNeedsPaint: markNeedsPaint,
  })

  return {
    structureEditing,
    cellPopupEditors,
    filterPopupController,
    editing,
    interaction,
    editingGeometry,
    stateController,
    pointer,
  }
}
