import { FocusManager, type Focusable } from '../core/focus_manager'
import type { CopyableSelection } from '../core/clipboard'
import { PopupManager } from '../core/popup_manager'
import { GET_POPUP_ANCHOR_RECT } from '../core/popup_anchor'
import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { RenderBox } from '../layout/render_box'
import type { PaintContext } from '../rendering/paint_context'
import { TextMeasurer } from '../core/text_measurer'
import type { InteractiveRenderObject, PointerEvent, WheelPointerEvent } from '../gestures/recognizers'
import { isPrimaryPointerButton, type HitTestResult } from '../gestures/hit_test'
import { GridDataModel } from './grid/grid_data_model'
import { GridViewport } from './grid/grid_viewport'
import { GridCellPopupEditors } from './grid/grid_cell_popup_editors'
import { GridEditingGeometryController } from './grid/grid_editing_geometry_controller'
import { GridEditingController } from './grid/grid_editing_controller'
import { GridColumnMenuController } from './grid/grid_column_menu_controller'
import { GridFilterPopupController } from './grid/grid_filter_popup_controller'
import { GridInteractionController } from './grid/grid_interaction_controller'
import { GridPointerController } from './grid/grid_pointer_controller'
import { GridStateController } from './grid/grid_state_controller'
import { GridStructureEditController } from './grid/grid_structure_edit_controller'
import { createGridControllerBundle } from './grid/grid_controller_bundle'
import { GridPainter } from './grid/grid_painter'
import { GridViewShellController } from './grid/grid_view_shell_controller'
import { resolveGridHeaderActionLayout } from './grid/grid_header_actions'
import {
  resolveGridColumnEditorKind,
  resolveGridEditorValidationMessages,
} from './grid/grid_column_editor'
import {
  resolveGridCellInteractionHit,
  type GridCellInteractionHit,
} from './grid/grid_interaction_hit'
import { GridInteractionTargetRegistry } from './grid/grid_interaction_target_registry'
import {
  defaultGridCellDisplayText,
  resolveGridCellPresentation,
  resolveGridRowPresentation,
} from './grid/grid_display_resolver'
import type {
  GridCellRange,
  GridCellColorContext,
  GridCellDisplayTextArgs,
  GridCellErrorState,
  GridCellContext,
  GridCellEditPolicy,
  GridResolvedCellEditPolicy,
  GridCellStyleArgs,
  GridCellStyleOverride,
  GridCellValidationArgs,
  GridCellValidationResult,
  GridColumnFilterState,
  GridColumnMenuDebugState,
  GridColumnState,
  GridColumnDef,
  GridCellTextOverflow,
  GridDataItem,
  GridDataChangeListener,
  GridDataChangeOrigin,
  GridDataMutationOptions,
  GridDataState,
  GridEditorValidationMessages,
  GridDebugState,
  GridFilterRule,
  GridPopupDebugState,
  GridGroupDef,
  GridGroupDisplayTextArgs,
  GridInternalRowEvent,
  GridPopupAnchorData,
  GridRangeSelectionInput,
  GridRowId,
  GridRowKey,
  GridRowEvent,
  GridSelectionOptions,
  GridSelectionState,
  GridRowStyleArgs,
  GridRowStyleOverride,
  GridRowValidationArgs,
  GridRowValidationResult,
  GridSelectionCell,
  GridSelectionChangeEvent,
  GridSelectionRange,
  GridSelectionMode,
  GridSortDescriptor,
  GridSortState,
  GridSummaryDef,
  GridViewPreset,
  GridValidationResult,
  DataGridOptions,
} from './grid/grid_types'

export type {
  EditState,
  GridCellPopupDebugState,
  GridCellDisplayTextArgs,
  GridCellErrorState,
  GridCellContext,
  GridCellEditPolicy,
  GridCellEditState,
  GridCellStyleArgs,
  GridCellStyleOverride,
  GridCellValidationArgs,
  GridCellValidationResult,
  GridColumnBase,
  GridColumnCheckbox,
  GridColumnFilterState,
  GridColumnMenuDebugState,
  GridColumnState,
  GridColumnCustom,
  GridColumnDate,
  GridColumnTime,
  GridColumnDef,
  GridCellCoord,
  GridCellRange,
  GridCellColorContext,
  GridDatePickerPopupDebugState,
  GridDateSelectionDebugState,
  GridDataState,
  GridCellDataChangeEvent,
  GridDataChangeEvent,
  GridDataChangeListener,
  GridDataChangeOrigin,
  GridDataMutationOptions,
  GridRowsAddedDataChangeEvent,
  GridRowsDataChangeEntry,
  GridRowsRemovedDataChangeEvent,
  GridRowsReplacedDataChangeEvent,
  GridDebugPopupKind,
  GridDebugState,
  GridDropdownGridPopupDebugState,
  GridDropdownPopupDebugState,
  GridPopupDebugState,
  GridFilterPopupDebugState,
  GridFilterOperator,
  GridFilterRule,
  GridFilterValue,
  GridDistinctFilterValues,
  GridPopupRectDebugState,
  GridPopupState,
  GridColumnNumber,
  GridColumnSelect,
  GridColumnSelectGrid,
  GridColumnText,
  GridColumnWidthMode,
  GridCellTextOverflow,
  GridDataItem,
  GridEmbeddedPopupDebugState,
  GridEmbeddedPopupGrid,
  GridGroupDef,
  GridGroupDisplayTextArgs,
  GridGroupItem,
  GridPopupAnchorData,
  GridRangeSelectionInput,
  GridRowId,
  GridRowKey,
  GridRowEvent,
  GridRowEventInput,
  GridRowStyleArgs,
  GridRowStyleOverride,
  GridRowValidationArgs,
  GridRowValidationResult,
  GridSelectionCell,
  GridSelectionChangeEvent,
  GridSelectionOptions,
  GridSelectionRange,
  GridSelectionMode,
  GridSelectionState,
  GridSortOrder,
  GridSortDescriptor,
  GridSortState,
  GridSummaryAggregate,
  GridSummaryCellDebugState,
  GridSummaryDef,
  GridViewPreset,
  GridValidationResult,
  GridEditorValidationMessages,
  DataGridOptions,
  GridVisibleItem,
} from './grid/grid_types'
export type {
  GridColumnEditorDef,
  GridColumnEditorKind,
  GridColumnEditorText,
  GridColumnEditorNumber,
  GridColumnEditorCheckbox,
  GridColumnEditorSelect,
  GridColumnEditorLookup,
  GridColumnEditorDate,
  GridColumnEditorTime,
  GridColumnEditorDropTree,
  GridColumnEditorDropTreeGrid,
  GridLookupQueryContext,
  GridLookupQueryResult,
  GridLookupQueryProcessor,
  GridDropTreeQueryContext,
  GridDropTreeQueryProcessor,
  GridDropTreeQueryTextBuilder,
  GridDropTreeExpandedKeysResolver,
  GridDropTreeGridQueryContext,
  GridDropTreeGridQueryProcessor,
  GridDropTreeGridQueryTextBuilder,
  GridDropTreeGridExpandedKeysResolver,
} from './grid/grid_column_editor'
export { DEFAULT_GRID_EDITOR_VALIDATION_MESSAGES } from './grid/grid_column_editor'
export {
  DataGridEditSession,
  type DataGridAddedRowChange,
  type DataGridCellChange,
  type DataGridChangeSet,
  type DataGridDeletedRowChange,
  type DataGridEditSessionListener,
  type DataGridEditSessionOptions,
  type DataGridModifiedRowChange,
  type DataGridRowEditState,
} from './grid/data_grid_edit_session'
export {
  bindDataGridToForm,
  type DataGridFormBindingOptions,
} from './grid/data_grid_form_binding'

export class RenderDataGrid<T extends Record<string, any> = any>
  extends RenderBox implements InteractiveRenderObject, Focusable, CopyableSelection {
  static override debugTypeName = 'RenderDataGrid'

  private static readonly AUTO_FIT_SAMPLE_LIMIT = 200
  private static readonly AUTO_FIT_MAX_WIDTH = 480

  /** @internal */
  readonly dataModel: GridDataModel<T>
  /** @internal */
  readonly viewport: GridViewport<T>
  /** @internal */
  readonly structureEditing: GridStructureEditController<T>
  /** @internal */
  readonly editing: GridEditingController<T>
  /** @internal */
  readonly interaction: GridInteractionController<T>
  /** @internal */
  readonly editingGeometry: GridEditingGeometryController<T>
  /** @internal */
  readonly stateController: GridStateController<T>
  /** @internal */
  readonly pointer: GridPointerController<T>
  /** @internal */
  readonly painter = new GridPainter<T>()
  private readonly _cellPopupEditors: GridCellPopupEditors<T>
  private readonly _filterPopupController: GridFilterPopupController<T>
  private readonly _columnMenuController: GridColumnMenuController<T>
  private readonly _shell: GridViewShellController<T>
  private readonly _interactionTargets: GridInteractionTargetRegistry<T>
  private _defaultColumnState: GridColumnState[]

  private _disabled: boolean
  private _readonly: boolean
  private _editable: boolean
  private _resizableColumns: boolean
  private _autoFitColumns: boolean
  private _rangeSelectionAutoScroll: boolean
  private _sortable: boolean
  private _focusRegistered = false

  onCellChange?: (row: T, key: keyof T & string, value: any) => void
  onRowClick?: (row: T, event: GridRowEvent<T>) => void
  onRowActivate?: (row: T, event: GridRowEvent<T>) => void
  onSelectionChange?: (event: GridSelectionChangeEvent<T>) => void
  onCurrentCellChange?: (cell: GridSelectionCell<T> | null) => void
  onFocusedCellChange?: (cell: GridSelectionCell<T> | null) => void
  onScrollChange?: (scrollY: number) => void

  private _getCellDisplayText?: (args: GridCellDisplayTextArgs<T>) => string | null | undefined
  private _getGroupDisplayText?: (args: GridGroupDisplayTextArgs<T>) => string | null | undefined
  private _resolveRowStyle?: (args: GridRowStyleArgs<T>) => GridRowStyleOverride | null | undefined
  private _resolveCellStyle?: (args: GridCellStyleArgs<T>) => GridCellStyleOverride | null | undefined
  private _resolveCellEditPolicy?: (context: GridCellContext<T>) => GridCellEditPolicy | null | undefined
  private _cellEditPolicyErrorLogged = false
  private _validateCell?: (args: GridCellValidationArgs<T>) => GridCellValidationResult
  private _validateRow?: (args: GridRowValidationArgs<T>) => GridRowValidationResult<T>
  private _editorValidationMessages: GridEditorValidationMessages
  private _reorderableColumns: boolean
  private _dataState: GridDataState
  private _stateMessage: string
  private _footerHeight: number
  private _autoFooterHeight: boolean
  private _filterRowVisible: boolean
  private _filterRowHeight: number
  private _cellTextOverflow: GridCellTextOverflow
  private _selectionSnapshot = ''
  private _currentCellSnapshot = ''
  private _focusedCellSnapshot = ''

  constructor(options: DataGridOptions<T>) {
    super(options)
    this._disabled = options.disabled ?? false
    this._readonly = options.readonly ?? false
    this._editable = options.editable ?? false
    this._resizableColumns = options.resizableColumns ?? true
    this._autoFitColumns = options.autoFitColumns ?? false
    this._rangeSelectionAutoScroll = options.rangeSelectionAutoScroll ?? true
    this._sortable = options.sortable ?? true
    this._cellTextOverflow = options.cellTextOverflow ?? 'ellipsis'
    this._reorderableColumns = options.reorderableColumns ?? true
    this._dataState = options.dataState ?? 'ready'
    this._stateMessage = options.stateMessage ?? ''
    this._autoFooterHeight = options.footerHeight === undefined
    this._footerHeight = options.footerHeight ?? (options.summary?.length ? 28 : 0)
    this._filterRowVisible = options.filterRowVisible ?? false
    this._filterRowHeight = Math.max(0, options.filterRowHeight ?? 28)
    this.onCellChange = options.onCellChange
    this.onRowClick = options.onRowClick
    this.onRowActivate = options.onRowActivate
    this.onSelectionChange = options.onSelectionChange
    this.onCurrentCellChange = options.onCurrentCellChange
    this.onFocusedCellChange = options.onFocusedCellChange
    this.onScrollChange = options.onScrollChange
    this._getCellDisplayText = options.getCellDisplayText
    this._getGroupDisplayText = options.getGroupDisplayText
    this._resolveRowStyle = options.resolveRowStyle
    this._resolveCellStyle = options.resolveCellStyle
    this._resolveCellEditPolicy = options.resolveCellEditPolicy
    this._validateCell = options.validateCell
    this._validateRow = options.validateRow
    this._editorValidationMessages = resolveGridEditorValidationMessages(options.editorValidationMessages)
    this._defaultColumnState = this.createDefaultColumnState(options.columns)

    this.dataModel = new GridDataModel<T>({
      columns: options.columns,
      rows: options.rows,
      rowKey: options.rowKey,
      groupBy: options.groupBy,
      defaultGroupExpanded: options.defaultGroupExpanded,
      sortable: this.sortable,
      sort: options.sort,
      filters: options.filters,
      quickFilter: options.quickFilter,
      summary: options.summary,
      getCellDisplayText: options.getCellDisplayText,
      onCellChange: (row, key, value) => this.onCellChange?.(row, key, value),
    })

    this.viewport = new GridViewport<T>({
      rowHeight: options.rowHeight,
      headerHeight: options.headerHeight,
      filterRowHeight: this._filterRowVisible ? this._filterRowHeight : 0,
      footerHeight: this._footerHeight,
      reserveScrollbars: options.reserveScrollbars,
      onScrollChange: scrollY => this.onScrollChange?.(scrollY),
    })

    let shell!: GridViewShellController<T>
    const controllers = createGridControllerBundle<T>({
      owner: this,
      dataModel: this.dataModel,
      viewport: this.viewport,
      editable: () => this.canUserEdit,
      sortable: () => this.sortable,
      reorderableColumns: () => this._reorderableColumns,
      resizableColumns: () => this.resizableColumns,
      autoFitColumns: () => this.autoFitColumns,
      rangeSelectionAutoScroll: () => this.rangeSelectionAutoScroll,
      groupBy: () => this.groupBy,
      getColumns: () => this.visibleColumns,
      getAllColumns: () => this.columns,
      getCurrentTheme: () => this.currentTheme,
      getSelectedRows: () => this.selectedRows,
      getResolveRowStyle: () => this.resolveRowStyle,
      getResolveCellStyle: () => this.resolveCellStyle,
      getValidateCell: () => this.validateCell,
      getValidateRow: () => this.validateRow,
      getEditorValidationMessages: () => this._editorValidationMessages,
      getCellEditPolicy: (rowIndex, colIndex) => this.resolveCellEditPolicyAt(rowIndex, colIndex),
      setCursor: cursor => this.owner?.setCursor(cursor),
      onRowClick: (row, event) => this.onRowClick?.(row, this.toPublicRowEvent(row, event)),
      onRowActivate: (row, event) => this.onRowActivate?.(row, this.toPublicRowEvent(row, event)),
      onInteractionStateChange: () => this.emitInteractionStateChanges(),
      onMoveColumn: (fromIndex, toIndex) => this.moveVisibleColumn(fromIndex, toIndex),
      onResizeColumn: (colIndex, width) => this.resizeVisibleColumn(colIndex, width),
      onAutoFitColumn: colIndex => this.autoFitColumn(colIndex),
      isInGroupToggleHitBox: (item, position) => shell.isInGroupToggleHitBox(item, position),
      createEmbeddedGrid: () => new RenderDataGrid<Record<string, any>>({
        columns: [],
        rows: [],
        editable: false,
        resizableColumns: false,
        sortable: false,
        reserveScrollbars: false,
      }),
    })
    this.structureEditing = controllers.structureEditing
    this._cellPopupEditors = controllers.cellPopupEditors
    this._filterPopupController = controllers.filterPopupController
    this._columnMenuController = new GridColumnMenuController<T>({
      owner: this,
      viewport: this.viewport,
      getGlobalOffset: () => this.globalOffset,
      getColumns: () => this.visibleColumns,
      getAllColumns: () => this.columns,
      getColumnState: () => this.getColumnState(),
      getSort: () => this.sort,
      getFilters: () => this.filters,
      getFilterValue: key => this.getFilterValue(key),
      canAutoFitColumns: () => this.autoFitColumns,
      setColumnState: state => this.setColumnState(state),
      setSort: sort => { this.sort = sort },
      clearColumnFilter: key => this.clearColumnFilter(key),
      openFilterPopup: colIndex => this._filterPopupController.openFilterPopup(colIndex),
      autoFitColumn: colIndex => this.autoFitColumn(colIndex),
      autoFitAllColumns: () => this.autoFitAllColumns(),
      resetColumnWidths: () => this.resetColumnWidths(),
      resetColumnState: () => this.resetColumnState(),
      onMarkNeedsPaint: () => this.markNeedsPaint(),
    })
    this.editing = controllers.editing
    this.interaction = controllers.interaction
    this.editingGeometry = controllers.editingGeometry
    this.stateController = controllers.stateController
    this.pointer = controllers.pointer
    this._interactionTargets = new GridInteractionTargetRegistry<T>({
      onCellBodyDoubleActivate: (_hit, event) => {
        this.pointer.onDoubleClick(event.position)
        this.emitInteractionStateChanges()
      },
      onNumberStepperEnter: (hit, event) => {
        if (this.blockConflictingNumberStepperPointer(event)) return
        if (!this.isCurrentNumberStepperHit(hit)) return
        this.editing.setNumberStepperHovered(
          this.numberStepperDirectionForHit(hit),
          event,
        )
        this.syncNumberStepperRowHover()
        this.emitInteractionStateChanges()
      },
      onNumberStepperLeave: (hit, event) => {
        if (this.blockConflictingNumberStepperPointer(event)) return
        if (!this.isCurrentNumberStepperHit(hit)) return
        this.editing.clearNumberStepperHover(event)
        this.emitInteractionStateChanges()
      },
      onNumberStepperDown: (hit, event) => {
        if (this.blockConflictingNumberStepperPointer(event)) return
        if (!this.isCurrentNumberStepperHit(hit)) return
        if (!this.pointer.beginNumberStepperPointer(event)) return
        let began = false
        let firstError: unknown
        let hasError = false
        try {
          began = this.editing.beginNumberStepperPress(
            this.numberStepperDirectionForHit(hit),
            event,
          )
          if (!began) event.preventActivation?.()
        } catch (error) {
          firstError = error
          hasError = true
        }
        if (!began) {
          try {
            this.pointer.endNumberStepperPointer(event)
          } catch (error) {
            if (!hasError) {
              firstError = error
              hasError = true
            }
          }
        }
        if (hasError) throw firstError
        this.emitInteractionStateChanges()
      },
      onNumberStepperMove: (hit, event) => {
        if (this.blockConflictingNumberStepperPointer(event)) return
        if (!this.isCurrentNumberStepperHit(hit)) return
        this.editing.updateNumberStepperPointer(
          event.position.x,
          event.position.y,
          event,
        )
        this.syncNumberStepperRowHover()
        this.syncOverflowTooltip(event.position)
        this.emitInteractionStateChanges()
      },
      onNumberStepperUp: (hit, event) => {
        if (!this.pointer.ownsNumberStepperPointer(event)) {
          if (this.blockConflictingNumberStepperPointer(event)) return
          event.preventActivation?.()
          return
        }
        let finished = false
        let firstError: unknown
        let hasError = false
        const rememberError = (error: unknown): void => {
          if (hasError) return
          firstError = error
          hasError = true
        }
        try {
          if (this.isCurrentNumberStepperHit(hit)) {
            finished = this.editing.finishNumberStepperPress(
              event.position.x,
              event.position.y,
              false,
              event,
            )
          } else {
            this.editing.cancelNumberStepperPress(true, event)
          }
        } catch (error) {
          rememberError(error)
        }
        try {
          this.pointer.endNumberStepperPointer(event)
        } catch (error) {
          rememberError(error)
        }
        if (!finished) event.preventActivation?.()
        try {
          this.emitInteractionStateChanges()
        } catch (error) {
          rememberError(error)
        }
        if (hasError) throw firstError
      },
      onNumberStepperCancel: (_hit, event) => {
        if (!this.pointer.ownsNumberStepperPointer(event)) {
          if (this.blockConflictingNumberStepperPointer(event)) return
          return
        }
        let firstError: unknown
        let hasError = false
        const rememberError = (error: unknown): void => {
          if (hasError) return
          firstError = error
          hasError = true
        }
        try {
          this.editing.cancelNumberStepperPress(true, event)
        } catch (error) {
          rememberError(error)
        }
        try {
          this.pointer.endNumberStepperPointer(event)
        } catch (error) {
          rememberError(error)
        }
        try {
          this.emitInteractionStateChanges()
        } catch (error) {
          rememberError(error)
        }
        if (hasError) throw firstError
      },
      onNumberStepperActivate: (hit, event) => {
        if (this.pointer.hasPointerOwner()) return
        if (!this.isCurrentNumberStepperHit(hit)) return
        this.editing.activateNumberStepper(
          this.numberStepperDirectionForHit(hit),
        )
        this.emitInteractionStateChanges()
      },
    })
    this.interaction.selectionMode = options.selectionMode ?? 'row'
    shell = new GridViewShellController<T>({
      viewport: this.viewport,
      interaction: this.interaction,
      editing: this.editing,
      painter: this.painter,
      getCurrentTheme: () => this.currentTheme,
      getGlobalOffset: () => this.globalOffset,
      getSortState: () => this.sortState,
      getSortDescriptors: () => this.sort,
      getFilters: () => this.filters,
      getQuickFilter: () => this.quickFilter,
      getDataState: () => this.effectiveDataState,
      getStateMessage: () => this.stateMessage,
      getSelectionMode: () => this.selectionMode,
      getRangeSelectionAutoScroll: () => this.rangeSelectionAutoScroll,
      getDisabled: () => this.disabled,
      getReadonly: () => this.readonly,
      getCurrentCell: () => this.interaction.currentCell,
      getSelectedRanges: () => this.interaction.selectedRanges,
      getSummaryCells: () => this.dataModel.summaryCells(),
      getFooterHeight: () => this.footerHeight,
      getFilterRowVisible: () => this.filterRowVisible,
      getFilterRowHeight: () => this.filterRowHeight,
      getColumnState: () => this.getColumnState(),
      getCellErrors: () => this.getCellErrors(),
      getPopupDebugState: () => {
        const popupState = this._cellPopupEditors.debugState()
        const filterState = this._filterPopupController.debugState()
        const columnMenuState = this._columnMenuController.debugState()
        return {
          activePopup: columnMenuState.visible ? 'column-menu' : filterState.visible ? 'filter' : popupState.activePopup,
          dropdown: popupState.dropdown,
          dropdownGrid: popupState.dropdownGrid,
          datePicker: popupState.datePicker,
          dropTree: popupState.dropTree,
          dropTreeGrid: popupState.dropTreeGrid,
          filter: filterState,
          columnMenu: columnMenuState,
        }
      },
      getCellGlobalRect: (row, col) => this.editingGeometry.cellGlobalRect(row, col),
    })
    this._shell = shell
    this.syncInteractionSnapshots()

    this.syncFocusRegistration()
  }

  get disabled(): boolean { return this._disabled }
  set disabled(value: boolean) {
    const next = value === true
    if (next === this._disabled) return
    this._disabled = next
    if (next) this.cancelUserInteraction()
    this.syncFocusRegistration()
    this.markNeedsPaint()
  }

  get readonly(): boolean { return this._readonly }
  set readonly(value: boolean) {
    const next = value === true
    if (next === this._readonly) return
    this._readonly = next
    if (next) this.editing.endEdit({ restoreFocus: false })
    this.markNeedsPaint()
  }

  get editable(): boolean { return this._editable }
  set editable(value: boolean) {
    const next = value === true
    if (next === this._editable) return
    this._editable = next
    if (!next) this.editing.endEdit({ restoreFocus: false })
    this.markNeedsPaint()
  }

  get resizableColumns(): boolean { return this._resizableColumns }
  set resizableColumns(value: boolean) {
    const next = value === true
    if (next === this._resizableColumns) return
    this._resizableColumns = next
    if (!next) this.pointer.cancelColumnResize()
    this.markNeedsPaint()
  }

  get autoFitColumns(): boolean { return this._autoFitColumns }
  set autoFitColumns(value: boolean) {
    const next = value === true
    if (next === this._autoFitColumns) return
    this._autoFitColumns = next
    this.markNeedsPaint()
  }

  get rangeSelectionAutoScroll(): boolean { return this._rangeSelectionAutoScroll }
  set rangeSelectionAutoScroll(value: boolean) {
    const next = value === true
    if (next === this._rangeSelectionAutoScroll) return
    this._rangeSelectionAutoScroll = next
    if (!next) this.pointer.stopRangeAutoScroll()
  }

  get sortable(): boolean { return this._sortable }
  set sortable(value: boolean) {
    const next = value === true
    if (next === this._sortable) return
    this._sortable = next
    this.dataModel.sortable = next
    if (!next && this.dataModel.sortDescriptors.length > 0) {
      this.dataModel.sortDescriptors = []
    } else {
      this.markNeedsPaint()
    }
  }

  private get canUserEdit(): boolean {
    return this._editable && !this._readonly && !this._disabled
  }

  private resolveCellEditPolicyAt(rowIndex: number, colIndex: number): GridResolvedCellEditPolicy {
    const column = this.visibleColumns[colIndex]
    const row = this.dataModel.visibleRows()[rowIndex]
    if (!column || !row) return { state: 'disabled', tabStop: false }

    if (this._disabled) return { state: 'disabled', tabStop: false }

    const columnEditable = column.editable !== false && (column.type !== 'custom' || !!column.editor)
    let state: GridResolvedCellEditPolicy['state'] = !this._editable || this._readonly || !columnEditable
      ? 'readonly'
      : 'editable'
    let tabStop = columnEditable
    let reason: string | undefined

    let policy: GridCellEditPolicy | null | undefined
    try {
      policy = this._resolveCellEditPolicy?.({
        row,
        rowIndex,
        column,
        columnIndex: colIndex,
        value: row[column.key],
      })
    } catch (error) {
      if (!this._cellEditPolicyErrorLogged) {
        this._cellEditPolicyErrorLogged = true
        console.error('RenderDataGrid resolveCellEditPolicy failed; falling back to readonly.', error)
      }
      return { state: 'readonly', tabStop: true }
    }
    if (policy?.state && policy.state !== 'inherit') state = policy.state
    reason = policy?.reason?.trim() || undefined

    if ((!this._editable || this._readonly || !columnEditable) && state === 'editable') {
      state = 'readonly'
    }
    if (policy?.tabStop !== undefined) tabStop = policy.tabStop
    else if (state === 'disabled') tabStop = false
    else if (policy?.state === 'readonly') tabStop = true
    return { state, tabStop, reason }
  }

  get columns(): GridColumnDef<T>[] { return this.dataModel.columns }
  set columns(columns: GridColumnDef<T>[]) {
    if (this.dataModel.columns === columns) return
    this.closeFilterPopupForExternalMutation()
    this.pointer.cancelColumnResize()
    this.editing.endEdit({ restoreFocus: false })
    this._defaultColumnState = this.createDefaultColumnState(columns)
    this.dataModel.columns = columns
    this._interactionTargets.retainColumns(columns.map(column => column.key))
    this.viewport.resetColumnWidths()
    this.markNeedsLayout()
  }

  get visibleColumns(): GridColumnDef<T>[] {
    const left = this.dataModel.visibleColumns().filter(column => column.fixed || column.pinned === 'left')
    const center = this.dataModel.visibleColumns().filter(column => !column.fixed && column.pinned !== 'left' && column.pinned !== 'right')
    const right = this.dataModel.visibleColumns().filter(column => column.pinned === 'right')
    return [...left, ...center, ...right]
  }

  get rows(): T[] { return this.dataModel.rows }
  set rows(rows: T[]) {
    const preserveRowState = this.dataModel.hasRowKey()
    this.editing.endEdit({ restoreFocus: false })
    this.closeFilterPopupForExternalMutation()
    this._columnMenuController.closeColumnMenu()
    PopupManager.instance.closeOwnedBy(this)
    this.dataModel.rows = rows
    if (!preserveRowState) {
      this.interaction.resetRowState()
      this.structureEditing.clearCellErrors()
      this.emitInteractionStateChanges()
    }
    if (this.hasAutoContentColumns()) this.markNeedsLayout()
    else this.markNeedsPaint()
  }

  get dataState(): GridDataState { return this._dataState }
  set dataState(value: GridDataState) {
    const next = value === 'loading' || value === 'empty' || value === 'error' ? value : 'ready'
    if (next === this._dataState) return
    this._dataState = next
    if (next !== 'ready') this.editing.endEdit()
    this.markNeedsPaint()
  }

  get stateMessage(): string { return this._stateMessage }
  set stateMessage(value: string) {
    const next = value ?? ''
    if (next === this._stateMessage) return
    this._stateMessage = next
    this.markNeedsPaint()
  }

  get selectionMode(): GridSelectionMode { return this.interaction.selectionMode }
  set selectionMode(value: GridSelectionMode) {
    this.interaction.selectionMode = value
    this.emitInteractionStateChanges()
  }

  get cellTextOverflow(): GridCellTextOverflow { return this._cellTextOverflow }
  set cellTextOverflow(value: GridCellTextOverflow) {
    const next = value === 'clip' ? 'clip' : 'ellipsis'
    if (next === this._cellTextOverflow) return
    this._cellTextOverflow = next
    this.markNeedsPaint()
  }

  get footerHeight(): number { return this._footerHeight }
  set footerHeight(value: number) {
    this._autoFooterHeight = false
    this.setFooterHeight(value)
  }

  get filterRowVisible(): boolean { return this._filterRowVisible }
  set filterRowVisible(value: boolean) {
    if (value === this._filterRowVisible) return
    this._filterRowVisible = value
    this.syncFilterRowHeight()
  }

  get filterRowHeight(): number { return this._filterRowHeight }
  set filterRowHeight(value: number) {
    const next = Math.max(0, value)
    if (next === this._filterRowHeight) return
    this._filterRowHeight = next
    this.syncFilterRowHeight()
  }

  private setFooterHeight(value: number): void {
    const next = Math.max(0, value)
    if (next === this._footerHeight) return
    this._footerHeight = next
    this.viewport.footerHeight = next
    this.markNeedsLayout()
  }

  private syncFilterRowHeight(): void {
    this.viewport.filterRowHeight = this._filterRowVisible ? this._filterRowHeight : 0
    this.viewport.clampScrollOffsets(this.visibleColumns, this.dataModel.visibleItemCount())
    this.editingGeometry.syncEditingViewportState()
    this.markNeedsLayout()
  }

  get effectiveDataState(): GridDataState {
    if (this._dataState !== 'ready') return this._dataState
    return this.dataModel.visibleItemCount() === 0 ? 'empty' : 'ready'
  }

  get groupBy(): GridGroupDef<T>[] { return this.dataModel.groupBy }
  set groupBy(groupBy: GridGroupDef<T>[]) {
    this.stateController.setGroupBy(groupBy)
  }

  get rowHeight(): number { return this.viewport.rowHeight }
  set rowHeight(value: number) {
    if (!this.viewport.setRowHeight(value)) return
    this.viewport.clampScrollOffsets(this.visibleColumns, this.dataModel.visibleItemCount())
    this.editingGeometry.syncEditingViewportState()
    this.markNeedsLayout()
  }

  get headerHeight(): number { return this.viewport.headerHeight }
  set headerHeight(value: number) {
    if (!this.viewport.setHeaderHeight(value)) return
    this.viewport.clampScrollOffsets(this.visibleColumns, this.dataModel.visibleItemCount())
    this.editingGeometry.syncEditingViewportState()
    this.markNeedsLayout()
  }

  /** @internal */
  get selectedRows(): Set<number> { return this.interaction.selectedRows }

  get sortState(): GridSortState { return this.dataModel.sortState }
  set sortState(sortState: GridSortState) {
    this.stateController.setSortState(sortState)
  }

  get sort(): GridSortDescriptor[] { return this.dataModel.sortDescriptors }
  set sort(sort: GridSortDescriptor[]) {
    this.stateController.setSortDescriptors(sort)
  }

  get filters(): GridFilterRule[] { return this.dataModel.filters }
  set filters(filters: GridFilterRule[]) {
    this.closeFilterPopupForExternalMutation()
    this.stateController.setFilters(filters)
  }

  get quickFilter(): string { return this.dataModel.quickFilter }
  set quickFilter(value: string) {
    this.closeFilterPopupForExternalMutation()
    this.stateController.setQuickFilter(value)
  }

  get summary(): GridSummaryDef<T>[] { return this.dataModel.summary }
  set summary(value: GridSummaryDef<T>[]) {
    this.dataModel.summary = value
    if (this._autoFooterHeight) {
      this.setFooterHeight(this.dataModel.summary.length > 0 ? 28 : 0)
    } else {
      this.markNeedsPaint()
    }
  }

  get editingCell(): { row: T; key: keyof T & string; column: GridColumnDef<T>; text: string } | null {
    const cell = this.editing.editingCell
    if (!cell) return null
    const row = this.dataModel.visibleRows()[cell.row]
    const column = this.visibleColumns[cell.col]
    if (!row || !column) return null
    return {
      row,
      key: column.key as keyof T & string,
      column,
      text: cell.text,
    }
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
    this.closeFilterPopupForExternalMutation()
    this._getCellDisplayText = value
    this.dataModel.getCellDisplayText = value
    this.markNeedsPaint()
  }

  get getGroupDisplayText():
    | ((args: GridGroupDisplayTextArgs<T>) => string | null | undefined)
    | undefined {
    return this._getGroupDisplayText
  }
  set getGroupDisplayText(value:
    | ((args: GridGroupDisplayTextArgs<T>) => string | null | undefined)
    | undefined) {
    if (this._getGroupDisplayText === value) return
    this._getGroupDisplayText = value
    this.markNeedsPaint()
  }

  get resolveRowStyle():
    | ((args: GridRowStyleArgs<T>) => GridRowStyleOverride | null | undefined)
    | undefined {
    return this._resolveRowStyle
  }
  set resolveRowStyle(value:
    | ((args: GridRowStyleArgs<T>) => GridRowStyleOverride | null | undefined)
    | undefined) {
    if (this._resolveRowStyle === value) return
    this._resolveRowStyle = value
    this.editing.refreshActiveTextPresentation()
    this.markNeedsPaint()
  }

  get resolveCellStyle():
    | ((args: GridCellStyleArgs<T>) => GridCellStyleOverride | null | undefined)
    | undefined {
    return this._resolveCellStyle
  }
  set resolveCellStyle(value:
    | ((args: GridCellStyleArgs<T>) => GridCellStyleOverride | null | undefined)
    | undefined) {
    if (this._resolveCellStyle === value) return
    this._resolveCellStyle = value
    this.editing.refreshActiveTextPresentation()
    this.markNeedsPaint()
  }

  get resolveCellEditPolicy():
    | ((context: GridCellContext<T>) => GridCellEditPolicy | null | undefined)
    | undefined {
    return this._resolveCellEditPolicy
  }
  set resolveCellEditPolicy(value:
    | ((context: GridCellContext<T>) => GridCellEditPolicy | null | undefined)
    | undefined) {
    if (this._resolveCellEditPolicy === value) return
    this._resolveCellEditPolicy = value
    this._cellEditPolicyErrorLogged = false
    this.reconcileActiveCellEditPolicy()
    this.markNeedsPaint()
  }

  get validateCell():
    | ((args: GridCellValidationArgs<T>) => GridCellValidationResult)
    | undefined {
    return this._validateCell
  }
  set validateCell(value:
    | ((args: GridCellValidationArgs<T>) => GridCellValidationResult)
    | undefined) {
    if (this._validateCell === value) return
    this._validateCell = value
    this.clearCellErrors()
  }

  get validateRow():
    | ((args: GridRowValidationArgs<T>) => GridRowValidationResult<T>)
    | undefined {
    return this._validateRow
  }

  set validateRow(value:
    | ((args: GridRowValidationArgs<T>) => GridRowValidationResult<T>)
    | undefined) {
    if (this._validateRow === value) return
    this._validateRow = value
    this.clearCellErrors()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  [GET_POPUP_ANCHOR_RECT](anchor?: GridPopupAnchorData): { x: number; y: number; width: number; height: number } {
    return this._shell.popupAnchorRect(anchor)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const columns = this.visibleColumns
    if (context.pass === 'measure') {
      this.size = constrainSize(constraints, {
        width: constraints.maxWidth === Infinity ? 600 : constraints.maxWidth,
        height: constraints.maxHeight === Infinity ? 400 : constraints.maxHeight,
      })
      return
    }
    this.size = this.viewport.performLayout(constraints, context.theme, columns, {
      preferredWidth: (_column, colIndex) => this.measureAutoFitColumnWidth(colIndex),
    })
    this.viewport.clampScrollOffsets(columns, this.dataModel.visibleItemCount())
    this.editingGeometry.syncEditingViewportState()
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const columns = this.visibleColumns
    this.painter.paint(context, offset, {
      theme: context.theme,
      columns,
      visibleItems: this.dataModel.visibleItems(),
      viewport: this.viewport,
      selectedRows: this.selectedRows,
      focused: !this.disabled && this.interaction.isFocused,
      focusedItemIndex: this.interaction.focusedItemIndex,
      focusedColIndex: this.interaction.focusedColIndex,
      hoveredItemIndex: this.disabled ? -1 : this.interaction.hoveredItemIndex,
      sortState: this.sortState,
      sortable: this.sortable,
      disabled: this.disabled,
      groupBy: this.groupBy,
      filterValues: this.dataModel.filterValues,
      filters: this.filters,
      filterPopupColumn: this._filterPopupController.filterPopupColumn,
      selectedRanges: this.interaction.selectedRanges,
      currentCell: this.interaction.currentCell,
      dataState: this.effectiveDataState,
      stateMessage: this._stateMessage,
      summaryCells: this.dataModel.summaryCells(),
      footerHeight: this._footerHeight,
      cellTextOverflow: this.cellTextOverflow,
      editableState: this.editing.state,
      editInput: this.editing.input,
      gridTokens: this._shell.gridTokens(context.theme),
      scrollbarTokens: this._shell.scrollbarTokens(context.theme),
      getCellDisplayText: this.getCellDisplayText,
      getGroupDisplayText: this.getGroupDisplayText,
      resolveRowStyle: this.resolveRowStyle,
      resolveCellStyle: this.resolveCellStyle,
      getCellEditPolicy: (rowIndex, colIndex) => this.resolveCellEditPolicyAt(rowIndex, colIndex),
      getCellError: (sourceRowIndex, key) => this.structureEditing.cellErrorForSource(sourceRowIndex, key),
      lookupValues: this.dataModel.lookupValues,
      measureText: (text, fontSize, fontFamily) => TextMeasurer.measureWidth(text, fontSize, fontFamily),
    })
  }

  beginEdit(row: T | number, key: (keyof T & string) | number): boolean {
    const rowIndex = this.resolveVisibleRowIndex(row)
    const colIndex = this.resolveVisibleColumnIndex(key)
    if (rowIndex < 0 || colIndex < 0) return false
    const changed = this.editing.beginEdit(rowIndex, colIndex)
    this.emitInteractionStateChanges()
    return changed
  }

  commitEdit(): boolean {
    return this.editing.commitEdit()
  }

  cancelEdit(): void {
    this.editing.cancelEdit()
  }

  getFilterValue(key: string): string {
    return this.dataModel.getFilterValue(key)
  }

  setFilterValue(key: string, value: string): void {
    this.closeFilterPopupForExternalMutation()
    this.stateController.setFilterValue(key, value)
  }

  getFilters(): GridFilterRule[] {
    return this.dataModel.filters
  }

  setFilters(filters: GridFilterRule[]): void {
    this.closeFilterPopupForExternalMutation()
    this.stateController.setFilters(filters)
  }

  getQuickFilter(): string {
    return this.dataModel.quickFilter
  }

  setQuickFilter(value: string): void {
    this.closeFilterPopupForExternalMutation()
    this.stateController.setQuickFilter(value)
  }

  clearAllFilters(): void {
    this.closeFilterPopupForExternalMutation()
    this.stateController.clearAllFilters()
  }

  clearColumnFilter(key: string): void {
    this.closeFilterPopupForExternalMutation()
    const nextFilters = this.filters.filter(filter => filter.key !== key)
    this.stateController.setFilterValue(key, '')
    this.stateController.setFilters(nextFilters)
  }

  getColumnFilters(): GridColumnFilterState[] {
    return Array.from(this.dataModel.filterValues.entries()).map(([key, value]) => ({ key, value }))
  }

  setColumnFilters(filters: GridColumnFilterState[]): void {
    this.closeFilterPopupForExternalMutation()
    const next = new Map(filters.map(filter => [filter.key, filter.value ?? '']))
    for (const key of Array.from(this.dataModel.filterValues.keys())) {
      if (!next.has(key)) this.stateController.setFilterValue(key, '')
    }
    for (const [key, value] of next) {
      this.stateController.setFilterValue(key, value)
    }
  }

  expandAllGroups(): void {
    this.stateController.expandAllGroups()
  }

  collapseAllGroups(): void {
    this.stateController.collapseAllGroups()
  }

  getVisibleRows(): readonly T[] {
    return this.dataModel.visibleRows()
  }

  focusRow(row: T | number | null, options: { select?: boolean; scroll?: boolean } = {}): boolean {
    const rowIndex = row === null ? -1 : this.resolveVisibleRowIndex(row)
    if (row !== null && rowIndex < 0) return false
    if (options.select ?? true) {
      this.interaction.setSelectedRows(rowIndex >= 0 ? [rowIndex] : [])
      this.interaction.focusRow(rowIndex, { select: false, scroll: options.scroll })
    } else {
      this.interaction.focusRow(rowIndex, { select: false, scroll: options.scroll })
    }
    this.editingGeometry.syncEditingViewportState()
    this.emitInteractionStateChanges()
    return true
  }

  setSelectedRows(rows: Iterable<T | number>): void {
    const indices: number[] = []
    for (const row of rows) {
      const index = this.resolveVisibleRowIndex(row)
      if (index >= 0) indices.push(index)
    }
    this.interaction.setSelectedRows(indices)
    this.emitInteractionStateChanges()
  }

  setSelectedRowIds(rowIds: Iterable<GridRowId>): void {
    this.interaction.setSelectedRowIds(rowIds)
    this.emitInteractionStateChanges()
  }

  getSelectionState(): GridSelectionState<T> {
    return this.toPublicSelectionState()
  }

  getSelectedRows(): readonly T[] {
    return this.getSelectionState().selectedRows
  }

  getSelectedRow(): T | null {
    return this.getSelectedRows()[0] ?? null
  }

  getSelectedRowIds(): GridRowId[] {
    return this.getSelectionState().selectedRowIds
  }

  getCurrentCell(): GridSelectionCell<T> | null {
    return this.getSelectionState().currentCell
  }

  getCurrentRow(): T | null {
    return this.getCurrentCell()?.row ?? null
  }

  getCurrentColumn(): GridColumnDef<T> | null {
    return this.getCurrentCell()?.column ?? null
  }

  getCurrentKey(): (keyof T & string) | null {
    return this.getCurrentCell()?.key ?? null
  }

  getFocusedCell(): GridSelectionCell<T> | null {
    return this.toPublicFocusedCell()
  }

  getFocusedRow(): T | null {
    return this.getSelectionState().focusedRow
  }

  getFocusedColumn(): GridColumnDef<T> | null {
    return this.getSelectionState().focusedColumn
  }

  getFocusedKey(): (keyof T & string) | null {
    return this.getSelectionState().focusedKey
  }

  clearSelection(): void {
    this.interaction.clearSelection()
    this.emitInteractionStateChanges()
  }

  selectCell(row: T | number, key: (keyof T & string) | number, options: GridSelectionOptions = {}): boolean {
    const rowIndex = this.resolveVisibleRowIndex(row)
    const colIndex = this.resolveVisibleColumnIndex(key)
    if (rowIndex < 0 || colIndex < 0) return false
    if (this.interaction.selectCell(rowIndex, colIndex, options)) {
      this.editingGeometry.syncEditingViewportState()
      this.emitInteractionStateChanges()
      return true
    }
    return false
  }

  selectRange(range: GridRangeSelectionInput<T> | GridCellRange, options: GridSelectionOptions = {}): boolean {
    const internalRange = this.toInternalRange(range)
    if (!internalRange) return false
    if (this.interaction.selectRange(internalRange, options)) {
      this.editingGeometry.syncEditingViewportState()
      this.emitInteractionStateChanges()
      return true
    }
    return false
  }

  /**
   * Adds rows to the source data. The optional index is a source-row index,
   * not a filtered/sorted visible-row index.
   */
  addRows(
    rows: T[],
    sourceIndex?: number,
    options: GridDataMutationOptions = {},
  ): boolean {
    this.closeFilterPopupForExternalMutation()
    return this.stateController.addRows(rows, sourceIndex, options.origin ?? 'api')
  }

  /**
   * Adds rows at a source-row index. Use insertRowsBefore/After when inserting
   * relative to a business row object.
   */
  addRowsAtSourceIndex(
    rows: T[],
    sourceIndex: number,
    options: GridDataMutationOptions = {},
  ): boolean {
    this.closeFilterPopupForExternalMutation()
    return this.stateController.addRows(rows, sourceIndex, options.origin ?? 'api')
  }

  insertRowsBefore(
    referenceRow: T,
    rows: T[],
    options: GridDataMutationOptions = {},
  ): boolean {
    const sourceIndex = this.sourceRowIndexForRow(referenceRow)
    if (sourceIndex < 0) return false
    this.closeFilterPopupForExternalMutation()
    return this.stateController.addRows(rows, sourceIndex, options.origin ?? 'api')
  }

  insertRowsAfter(
    referenceRow: T,
    rows: T[],
    options: GridDataMutationOptions = {},
  ): boolean {
    const sourceIndex = this.sourceRowIndexForRow(referenceRow)
    if (sourceIndex < 0) return false
    this.closeFilterPopupForExternalMutation()
    return this.stateController.addRows(rows, sourceIndex + 1, options.origin ?? 'api')
  }

  setCellValue(
    row: T | number,
    key: keyof T & string,
    value: any,
    options: GridDataMutationOptions = {},
  ): boolean {
    const origin: GridDataChangeOrigin = options.origin ?? 'api'
    let changed: boolean
    if (typeof row !== 'number') {
      const sourceRowIndex = this.sourceRowIndexForRow(row)
      if (sourceRowIndex < 0) return false
      this.closeFilterPopupForExternalMutation()
      changed = this.stateController.setSourceCellValue(sourceRowIndex, key, value, origin)
    } else {
      const rowIndex = this.resolveVisibleRowIndex(row)
      if (rowIndex < 0) return false
      this.closeFilterPopupForExternalMutation()
      changed = this.stateController.setCellValue(rowIndex, key, value, origin)
    }
    if (changed) this.reconcileActiveCellEditPolicy()
    return changed
  }

  getCellErrors(): GridCellErrorState<T>[] {
    return this.structureEditing.cellErrors()
  }

  validate(): GridValidationResult<T> {
    const edit = this.editing.state
    const preserveCell = edit
      ? {
          sourceRowIndex: this.dataModel.visibleRowIndex(edit.row),
          key: this.visibleColumns[edit.col]?.key ?? '',
        }
      : null
    const committed = this.editing.commitEdit()
    const result = this.structureEditing.validateAll({
      preserveCell: !committed && preserveCell && preserveCell.sourceRowIndex >= 0 && preserveCell.key
        ? preserveCell
        : undefined,
    })
    this.markNeedsPaint()
    return result
  }

  focusFirstError(): boolean {
    for (const error of this.getCellErrors()) {
      if (!error.row || !error.visible) continue
      if (this.selectCell(error.row, error.key, { scroll: true })) return true
    }
    return false
  }

  clearCellErrors(): void {
    if (this.structureEditing.clearCellErrors()) this.markNeedsPaint()
  }

  clearCellError(row: T | number, key: keyof T & string): boolean {
    const sourceRowIndex = typeof row === 'number' ? row : this.sourceRowIndexForRow(row)
    if (sourceRowIndex < 0) return false
    const changed = this.structureEditing.clearCellErrorForSource(sourceRowIndex, key)
    if (changed) this.markNeedsPaint()
    return changed
  }

  removeRows(
    rows: Iterable<T | number>,
    options: GridDataMutationOptions = {},
  ): boolean {
    const indices = [...rows]
      .map(row => typeof row === 'number' ? row : this.sourceRowIndexForRow(row))
      .filter(index => index >= 0)
    this.closeFilterPopupForExternalMutation()
    return this.stateController.removeRows(indices, options.origin ?? 'api')
  }

  subscribeDataChange(listener: GridDataChangeListener<T>): () => void {
    return this.dataModel.subscribeDataChange(listener)
  }

  refreshRow(row: T): boolean {
    if (this.sourceRowIndexForRow(row) < 0) return false
    this.closeFilterPopupForExternalMutation()
    this.dataModel.invalidateVisibleRows('cell')
    this.reconcileActiveCellEditPolicy()
    this.invalidateDataPresentation()
    return true
  }

  refreshData(): void {
    this.closeFilterPopupForExternalMutation()
    this.dataModel.invalidateVisibleRows('rows')
    this.reconcileActiveCellEditPolicy()
    this.invalidateDataPresentation()
  }

  refreshLookup(columnKey?: string): boolean {
    this.closeFilterPopupForExternalMutation()
    if (!this.dataModel.refreshLookup(columnKey)) return false
    this.invalidateDataPresentation()
    return true
  }

  private reconcileActiveCellEditPolicy(): void {
    const edit = this.editing.state
    if (!edit) return
    if (edit.col >= this.visibleColumns.length || !this.structureEditing.canEditCell(edit.row, edit.col)) {
      this.editing.endEdit({ restoreFocus: false })
    }
  }

  moveColumn(fromIndex: number, toIndex: number): boolean {
    return this.moveVisibleColumn(fromIndex, toIndex)
  }

  openColumnMenu(column: string | number, position?: Offset): boolean {
    if (this.disabled) return false
    const columns = this.visibleColumns
    const colIndex = typeof column === 'number'
      ? column
      : columns.findIndex(entry => entry.key === column)
    if (colIndex < 0 || colIndex >= columns.length) return false
    this._filterPopupController.closeFilterPopup()
    if (this.editing.commitEdit() === false) return false
    return this._columnMenuController.openColumnMenu(colIndex, position)
  }

  getViewPreset(): GridViewPreset {
    return {
      columns: this.getColumnState().map(column => ({ ...column })),
      sort: this.sort.map(sort => ({ ...sort })),
      filters: this.filters.map(filter => ({ ...filter })),
      columnFilters: this.getColumnFilters().map(filter => ({ ...filter })),
      quickFilter: this.quickFilter,
    }
  }

  applyViewPreset(preset: GridViewPreset): void {
    this.setColumnState(preset.columns.map(column => ({ ...column })))
    this.sort = preset.sort.map(sort => ({ ...sort }))
    this.filters = preset.filters.map(filter => ({ ...filter }))
    this.setColumnFilters(preset.columnFilters.map(filter => ({ ...filter })))
    this.quickFilter = preset.quickFilter
  }

  resetColumnState(): void {
    this.setColumnState(this._defaultColumnState.map(column => ({ ...column })))
  }

  autoFitColumn(column: string | number): boolean {
    const colIndex = this.resolveVisibleColumnIndex(column)
    if (colIndex < 0) return false
    const visibleColumn = this.visibleColumns[colIndex]
    if (!visibleColumn) return false
    const width = this.measureAutoFitColumnWidth(colIndex)
    this.applyColumnWidths(new Map([[visibleColumn.key, width]]))
    return true
  }

  autoFitAllColumns(): void {
    const widths = new Map<string, number>()
    const columns = this.visibleColumns
    for (let index = 0; index < columns.length; index++) {
      const column = columns[index]
      if (column) widths.set(column.key, this.measureAutoFitColumnWidth(index))
    }
    this.applyColumnWidths(widths)
  }

  resetColumnWidths(): void {
    const defaults = new Map(this._defaultColumnState.map(column => [column.key, column]))
    const next = this.getColumnState().map(column => {
      const fallback = defaults.get(column.key)
      return {
        ...column,
        width: fallback?.width,
        widthMode: fallback?.widthMode ?? 'interactive',
      }
    })
    this.setColumnState(next)
  }

  private createDefaultColumnState(columns: GridColumnDef<T>[]): GridColumnState[] {
    return columns.map(column => ({
      key: column.key,
      width: column.width,
      hidden: column.hidden === true,
      pinned: column.pinned ?? (column.fixed ? 'left' : false),
      widthMode: column.widthMode ?? 'interactive',
    }))
  }

  getColumnState(): GridColumnState[] {
    const visibleColumns = this.visibleColumns
    return this.columns.map(column => {
      const visibleIndex = visibleColumns.findIndex(entry => entry.key === column.key)
      return {
        key: column.key,
        width: visibleIndex >= 0 ? this.viewport.colWidths[visibleIndex] : column.width,
        hidden: column.hidden === true,
        pinned: column.pinned ?? (column.fixed ? 'left' : false),
        widthMode: column.widthMode ?? 'interactive',
      }
    })
  }

  setColumnState(state: GridColumnState[]): void {
    this.closeFilterPopupForExternalMutation()
    this.pointer.cancelColumnResize()
    this.editing.endEdit({ restoreFocus: false })
    const byKey = new Map(state.map(entry => [entry.key, entry]))
    const order = new Map(state.map((entry, index) => [entry.key, index]))
    this.dataModel.columns = this.columns.map(column => {
      const next = byKey.get(column.key)
      if (!next) return column
      const pinned = next.pinned ?? column.pinned ?? (column.fixed ? 'left' : false)
      const hasWidth = Object.prototype.hasOwnProperty.call(next, 'width')
      return {
        ...column,
        hidden: next.hidden ?? column.hidden,
        pinned,
        fixed: pinned === 'left' ? column.fixed : false,
        width: hasWidth ? next.width : column.width,
        widthMode: next.widthMode ?? column.widthMode,
      } as GridColumnDef<T>
    }).sort((left, right) => {
      const leftOrder = order.get(left.key)
      const rightOrder = order.get(right.key)
      if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder
      if (leftOrder !== undefined) return -1
      if (rightOrder !== undefined) return 1
      return 0
    })
    this.viewport.resetColumnWidths()
    this.markNeedsLayout()
  }

  private moveVisibleColumn(fromIndex: number, toIndex: number): boolean {
    let visible = this.visibleColumns
    let normalizedTarget = this.viewport.normalizeColumnMoveTarget(visible, fromIndex, toIndex)
    let from = visible[fromIndex]
    let to = visible[normalizedTarget]
    if (!from || !to || from.key === to.key) return false
    if (this.editing.state && this.editing.commitEdit() === false) return false
    this.closeFilterPopupForExternalMutation()
    visible = this.visibleColumns
    normalizedTarget = this.viewport.normalizeColumnMoveTarget(visible, fromIndex, toIndex)
    from = visible[fromIndex]
    to = visible[normalizedTarget]
    if (!from || !to || from.key === to.key) return false
    const nextVisibleKeys = visible.map(column => column.key)
    const [moved] = nextVisibleKeys.splice(fromIndex, 1)
    if (!moved) return false
    nextVisibleKeys.splice(normalizedTarget, 0, moved)
    const order = new Map(nextVisibleKeys.map((key, index) => [key, index]))
    const visibleSet = new Set(nextVisibleKeys)
    const nextColumns = [...this.columns].sort((left, right) => {
      const leftVisible = visibleSet.has(left.key)
      const rightVisible = visibleSet.has(right.key)
      if (leftVisible && rightVisible) return (order.get(left.key) ?? 0) - (order.get(right.key) ?? 0)
      if (leftVisible) return -1
      if (rightVisible) return 1
      return 0
    })
    this.dataModel.columns = nextColumns
    this.viewport.resetColumnWidths()
    this.markNeedsLayout()
    return true
  }

  private resolveVisibleColumnIndex(column: string | number): number {
    if (typeof column === 'number') return column >= 0 && column < this.visibleColumns.length ? column : -1
    return this.visibleColumns.findIndex(entry => entry.key === column)
  }

  private visibleColumnIndexForKey(key: keyof T & string): number {
    return this.visibleColumns.findIndex(column => column.key === key)
  }

  private resolveVisibleRowIndex(row: T | number): number {
    if (typeof row === 'number') {
      return Number.isFinite(row) ? Math.floor(row) : -1
    }
    return this.visibleRowIndexForRow(row)
  }

  private visibleRowIndexForRow(row: T): number {
    const visibleRows = this.dataModel.visibleRows()
    const directIndex = visibleRows.indexOf(row)
    if (directIndex >= 0) return directIndex
    const rowId = this.dataModel.rowIdForRow(row)
    return rowId !== null ? this.dataModel.visibleRowIndexForRowId(rowId) : -1
  }

  private sourceRowIndexForRow(row: T): number {
    const directIndex = this.dataModel.rows.indexOf(row)
    if (directIndex >= 0) return directIndex
    const rowId = this.dataModel.rowIdForRow(row)
    return rowId !== null ? this.dataModel.sourceRowIndexForRowId(rowId) : -1
  }

  private rowAtVisibleIndex(rowIndex: number): T | null {
    return this.dataModel.visibleRows()[rowIndex] ?? null
  }

  private columnAtVisibleIndex(colIndex: number): GridColumnDef<T> | null {
    return this.visibleColumns[colIndex] ?? null
  }

  private toPublicRowEvent(row: T, event: GridInternalRowEvent): GridRowEvent<T> {
    const column = event.colIndex === undefined ? null : this.columnAtVisibleIndex(event.colIndex)
    return {
      rowId: this.dataModel.rowIdForRow(row),
      key: column ? column.key as keyof T & string : null,
      column,
      input: event.input,
      shiftKey: event.shiftKey === true,
      ctrlKey: event.ctrlKey === true,
      metaKey: event.metaKey === true,
      altKey: event.altKey === true,
    }
  }

  private toPublicSelectionCell(cell: { row: number; col: number } | null): GridSelectionCell<T> | null {
    if (!cell) return null
    const row = this.rowAtVisibleIndex(cell.row)
    const column = this.columnAtVisibleIndex(cell.col)
    if (!row || !column) return null
    return {
      row,
      key: column.key as keyof T & string,
      column,
    }
  }

  private toPublicFocusedCell(): GridSelectionCell<T> | null {
    const state = this.interaction.getSelectionState()
    return this.toPublicSelectionCell({ row: state.focusedRow, col: state.focusedCol })
  }

  private toPublicSelectionRange(range: GridCellRange): GridSelectionRange<T> | null {
    const startRow = this.rowAtVisibleIndex(range.startRow)
    const endRow = this.rowAtVisibleIndex(range.endRow)
    const startColumn = this.columnAtVisibleIndex(range.startCol)
    const endColumn = this.columnAtVisibleIndex(range.endCol)
    if (!startRow || !endRow || !startColumn || !endColumn) return null
    return {
      startRow,
      startKey: startColumn.key as keyof T & string,
      startColumn,
      endRow,
      endKey: endColumn.key as keyof T & string,
      endColumn,
    }
  }

  private toPublicSelectionState(): GridSelectionState<T> {
    const state = this.interaction.getSelectionState()
    const selectedRows = state.selectedRows
      .map(rowIndex => this.rowAtVisibleIndex(rowIndex))
      .filter((row): row is T => !!row)
    const focusedRow = this.rowAtVisibleIndex(state.focusedRow)
    const focusedColumn = this.columnAtVisibleIndex(state.focusedCol)
    return {
      mode: state.mode,
      selectedRows,
      selectedRowIds: state.selectedRowIds,
      currentCell: this.toPublicSelectionCell(state.currentCell),
      selectedRanges: state.selectedRanges
        .map(range => this.toPublicSelectionRange(range))
        .filter((range): range is GridSelectionRange<T> => !!range),
      focusedRow,
      focusedKey: focusedColumn ? focusedColumn.key as keyof T & string : null,
      focusedColumn,
    }
  }

  private createInteractionSnapshot(): {
    selection: string
    currentCell: string
    focusedCell: string
  } {
    const state = this.interaction.getSelectionState()
    const currentCell = state.currentCell
      ? { row: state.currentCell.row, col: state.currentCell.col }
      : null
    const focusedCell = { row: state.focusedRow, col: state.focusedCol }
    return {
      selection: JSON.stringify({
        mode: state.mode,
        selectedRows: state.selectedRows,
        selectedSourceRows: state.selectedSourceRows,
        selectedRowIds: state.selectedRowIds,
        currentCell,
        selectedRanges: state.selectedRanges,
        focusedCell,
      }),
      currentCell: JSON.stringify(currentCell),
      focusedCell: JSON.stringify(focusedCell),
    }
  }

  private syncInteractionSnapshots(): void {
    const snapshot = this.createInteractionSnapshot()
    this._selectionSnapshot = snapshot.selection
    this._currentCellSnapshot = snapshot.currentCell
    this._focusedCellSnapshot = snapshot.focusedCell
  }

  private emitInteractionStateChanges(): void {
    const snapshot = this.createInteractionSnapshot()
    const selectionChanged = snapshot.selection !== this._selectionSnapshot
    const currentCellChanged = snapshot.currentCell !== this._currentCellSnapshot
    const focusedCellChanged = snapshot.focusedCell !== this._focusedCellSnapshot
    if (!selectionChanged && !currentCellChanged && !focusedCellChanged) return

    this._selectionSnapshot = snapshot.selection
    this._currentCellSnapshot = snapshot.currentCell
    this._focusedCellSnapshot = snapshot.focusedCell

    const state = this.getSelectionState()
    const focusedCell = this.toPublicFocusedCell()
    if (selectionChanged) {
      this.onSelectionChange?.({
        state,
        selectedRow: state.selectedRows[0] ?? null,
        currentCell: state.currentCell,
        focusedCell,
      })
    }
    if (currentCellChanged) this.onCurrentCellChange?.(state.currentCell)
    if (focusedCellChanged) this.onFocusedCellChange?.(focusedCell)
  }

  private toInternalRange(range: GridRangeSelectionInput<T> | GridCellRange): GridCellRange | null {
    if ('startCol' in range) {
      return {
        startRow: range.startRow,
        startCol: range.startCol,
        endRow: range.endRow,
        endCol: range.endCol,
      }
    }
    const startRow = this.visibleRowIndexForRow(range.startRow)
    const endRow = this.visibleRowIndexForRow(range.endRow)
    const startCol = this.visibleColumnIndexForKey(range.startKey)
    const endCol = this.visibleColumnIndexForKey(range.endKey)
    if (startRow < 0 || endRow < 0 || startCol < 0 || endCol < 0) return null
    return {
      startRow,
      startCol,
      endRow,
      endCol,
    }
  }

  private applyColumnWidths(widths: Map<string, number>): void {
    if (widths.size === 0) return
    const next = this.getColumnState().map(column => {
      const width = widths.get(column.key)
      return width === undefined
        ? column
        : {
            ...column,
            width,
            widthMode: 'interactive' as const,
          }
    })
    this.setColumnState(next)
  }

  private resizeVisibleColumn(colIndex: number, width: number): void {
    const column = this.visibleColumns[colIndex]
    if (!column) return
    this.applyColumnWidths(new Map([[column.key, width]]))
  }

  private hasAutoContentColumns(): boolean {
    return this.columns.some(column => column.widthMode === 'autoContent')
  }

  private invalidateDataPresentation(): void {
    if (this.hasAutoContentColumns()) this.markNeedsLayout()
    else this.markNeedsPaint()
  }

  private measureAutoFitColumnWidth(colIndex: number): number {
    const column = this.visibleColumns[colIndex]
    if (!column) return 40
    const tokens = this._shell.gridTokens(this.currentTheme)
    const fontSize = tokens.fontSize
    const fontFamily = tokens.fontFamily
    const minWidth = column.minWidth ?? (column.type === 'checkbox' ? 52 : 40)
    let maxTextWidth = TextMeasurer.measureWidth(column.title, fontSize, fontFamily)
    const groupIndex = this.groupBy.findIndex(group => group.key === column.key)
    const activeSort = this.sortState.key === column.key && !!this.sortState.order
    const actionLayout = resolveGridHeaderActionLayout({
      columnX: 0,
      columnWidth: 1000,
      headerY: 0,
      headerHeight: this.headerHeight,
      paddingH: tokens.paddingH,
      fontSize,
      metrics: tokens.headerAction,
      showSort: groupIndex >= 0 || (!!column.sortable && (this.sortable || activeSort)),
      showFilter: !!column.filterable,
      groupIndex,
    })
    let extra = tokens.paddingH + 1000 - actionLayout.titleRight
    if (column.type === 'select' || column.type === 'select-grid' || column.type === 'date') extra += 18

    const filterText = this.filterRowDisplayText(column)
    if (filterText) {
      maxTextWidth = Math.max(maxTextWidth, TextMeasurer.measureWidth(filterText, fontSize, fontFamily))
    }

    const summary = this.dataModel.summaryCells().find(cell => cell.key === column.key)
    if (summary) {
      maxTextWidth = Math.max(maxTextWidth, TextMeasurer.measureWidth(summary.text, fontSize, fontFamily))
    }

    const items = this.sampleAutoFitItems()
    for (const item of items) {
      const text = this.autoFitCellDisplayText(item, column, colIndex)
      maxTextWidth = Math.max(maxTextWidth, TextMeasurer.measureWidth(text, fontSize, fontFamily))
    }

    return Math.ceil(Math.max(minWidth, Math.min(RenderDataGrid.AUTO_FIT_MAX_WIDTH, maxTextWidth + extra)))
  }

  private sampleAutoFitItems(): Array<GridDataItem<T>> {
    const dataItems = this.dataModel.visibleItems().filter((item): item is GridDataItem<T> => item.kind === 'data')
    if (dataItems.length <= RenderDataGrid.AUTO_FIT_SAMPLE_LIMIT) return dataItems
    const samples: Array<GridDataItem<T>> = []
    const step = (dataItems.length - 1) / (RenderDataGrid.AUTO_FIT_SAMPLE_LIMIT - 1)
    for (let index = 0; index < RenderDataGrid.AUTO_FIT_SAMPLE_LIMIT; index++) {
      samples.push(dataItems[Math.round(index * step)]!)
    }
    return samples
  }

  private autoFitCellDisplayText(item: GridDataItem<T>, column: GridColumnDef<T>, colIndex: number): string {
    const defaultDisplayText = defaultGridCellDisplayText(
      column,
      item.row,
      item.dataRowIndex,
      this.dataModel.lookupValues,
    )
    const value = (item.row as any)[column.key]
    const tokens = this._shell.gridTokens(this.currentTheme)
    return this.getCellDisplayText?.({
      row: item.row,
      rowId: item.rowId,
      theme: this.currentTheme,
      backgroundColor: tokens.windowBg,
      selected: false,
      hovered: false,
      focused: false,
      editing: false,
      value,
      column,
      defaultDisplayText,
    }) ?? defaultDisplayText
  }

  private syncOverflowTooltip(position: Offset): void {
    this.tooltip = undefined
    if (this.effectiveDataState !== 'ready') return

    const columns = this.visibleColumns
    const itemIndex = this.viewport.rowAtY(position.y, this.globalOffset, this.dataModel.visibleItemCount())
    if (itemIndex < 0) return

    const item = this.dataModel.visibleItemAt(itemIndex)
    if (!item || item.kind !== 'data') return

    const colIndex = this.viewport.colAtX(position.x, this.globalOffset, columns)
    const column = columns[colIndex]
    if (!column) return

    const cellError = this.structureEditing.cellErrorForSource(item.sourceIndex, column.key)
    if (cellError) {
      this.tooltip = cellError.message
      return
    }

    const editPolicy = this.resolveCellEditPolicyAt(item.dataRowIndex, colIndex)
    if (editPolicy.state !== 'editable' && editPolicy.reason) {
      this.tooltip = editPolicy.reason
      return
    }
    if (column.type === 'checkbox') return

    const tokens = this._shell.gridTokens(this.currentTheme)
    const isSelected = this.selectedRows.has(item.dataRowIndex)
    const isHovered = itemIndex === this.interaction.hoveredItemIndex
    const isFocused = this.interaction.isFocused && itemIndex === this.interaction.focusedItemIndex
    const isEditingRow = this.editing.state?.row === item.dataRowIndex
    const rowPresentation = resolveGridRowPresentation({
      item,
      theme: this.currentTheme,
      tokens,
      state: {
        itemIndex,
        selected: isSelected,
        hovered: isHovered,
        focused: isFocused,
        editing: isEditingRow,
      },
      resolveRowStyle: this.resolveRowStyle,
    })
    const cellPresentation = resolveGridCellPresentation({
      item,
      theme: this.currentTheme,
      column,
      colIndex,
      tokens,
      rowPresentation,
      cellError: this.structureEditing.cellErrorForSource(item.sourceIndex, column.key) ?? null,
      state: {
        itemIndex,
        selected: isSelected,
        hovered: isHovered,
        focused: isFocused && this.interaction.focusedColIndex === colIndex,
        editing: isEditingRow && this.editing.state?.col === colIndex,
      },
      getCellDisplayText: this.getCellDisplayText,
      resolveCellStyle: this.resolveCellStyle,
      lookupValues: this.dataModel.lookupValues,
    })
    const text = cellPresentation.displayText
    if (!text) return

    const columnWidth = this.viewport.colWidths[colIndex] ?? column.width ?? 0
    const availableWidth = Math.max(0, columnWidth - tokens.paddingH * 2)
    if (TextMeasurer.measureWidth(text, cellPresentation.fontSize, cellPresentation.fontFamily) > availableWidth) {
      this.tooltip = text
    }
  }

  private filterRowDisplayText(column: GridColumnDef<T>): string {
    const legacyValue = this.dataModel.filterValues.get(column.key)
    if (legacyValue) return legacyValue
    const rule = this.filters.find(entry => entry.key === column.key)
    if (!rule) return this.filterRowVisible && column.filterable ? 'Filter...' : ''
    if (rule.operator === 'empty') return 'Empty'
    if (rule.operator === 'notEmpty') return 'Not empty'
    if (rule.operator === 'between') return `${String(rule.value ?? '')}..${String(rule.valueTo ?? '')}`
    if (rule.operator === 'in' || rule.operator === 'notIn') {
      const values = (rule.values ?? []).map(value => value == null || value === '' ? '(blank)' : String(value))
      return `${rule.operator === 'in' ? 'In' : 'Not in'}: ${values.join(', ')}`
    }
    const value = String(rule.value ?? '')
    if (rule.operator === 'contains' || rule.operator === 'equals') return value
    return `${rule.operator}: ${value}`
  }

  private isBodyPointer(position: Offset): boolean {
    const offset = this.globalOffset
    return position.y >= offset.y + this.viewport.headerSectionHeight &&
      position.y <= offset.y + this.size.height &&
      position.x >= offset.x &&
      position.x <= offset.x + this.size.width
  }

  private resolveCellInteractionHit(position: Offset): GridCellInteractionHit<T> | null {
    if (this.disabled || this.effectiveDataState !== 'ready') return null

    const itemIndex = this.viewport.rowAtY(
      position.y,
      this.globalOffset,
      this.dataModel.visibleItemCount(),
    )
    if (itemIndex < 0) return null

    const item = this.dataModel.visibleItemAt(itemIndex)
    if (!item || item.kind !== 'data') return null

    const columns = this.visibleColumns
    const colIndex = this.viewport.colAtX(position.x, this.globalOffset, columns)
    const column = columns[colIndex]
    if (!column) return null

    const edit = this.editing.state
    const numberStepperWidth =
      edit?.row === item.dataRowIndex &&
      edit.col === colIndex &&
      resolveGridColumnEditorKind(column) === 'number'
        ? this._shell.gridTokens(this.currentTheme).numberStepper.width
        : undefined

    return resolveGridCellInteractionHit(position, {
      rect: this.viewport.cellGlobalRect(
        columns,
        this.globalOffset,
        itemIndex,
        colIndex,
      ),
      row: item.row,
      rowId: item.rowId,
      interactionKey: numberStepperWidth === undefined
        ? undefined
        : this.editing.editSessionKey ?? undefined,
      sourceRowIndex: item.sourceIndex,
      visibleItemIndex: itemIndex,
      visibleRowIndex: item.dataRowIndex,
      columnIndex: colIndex,
      columnKey: column.key,
      numberStepperWidth,
    })
  }

  private numberStepperDirectionForHit(
    hit: GridCellInteractionHit<T>,
  ): 'up' | 'down' {
    return hit.role === 'number-stepper-increase' ? 'up' : 'down'
  }

  private blockConflictingNumberStepperPointer(event: PointerEvent): boolean {
    return !this.pointer.acceptsNumberStepperPointer(event)
  }

  private isCurrentNumberStepperHit(hit: GridCellInteractionHit<T>): boolean {
    const edit = this.editing.state
    const editSessionKey = this.editing.editSessionKey
    if (
      !edit ||
      !editSessionKey ||
      !Object.is(hit.interactionKey, editSessionKey)
    ) {
      return false
    }
    return this.visibleColumns[edit.col]?.key === hit.columnKey
  }

  private syncNumberStepperRowHover(): void {
    const edit = this.editing.state
    if (!edit) return
    const visibleItemIndex = this.dataModel.visibleItemIndexForVisibleRow(edit.row)
    if (visibleItemIndex >= 0) this.interaction.setHoveredItem(visibleItemIndex)
  }

  override hitTestPath(point: Offset, result: HitTestResult): boolean {
    if (!super.hitTestPath(point, result)) return false

    const hit = this.resolveCellInteractionHit(point)
    if (hit) {
      const globalOffset = this.globalOffset
      result.add(this._interactionTargets.createHitTestEntry(
        hit,
        {
          x: point.x - globalOffset.x,
          y: point.y - globalOffset.y,
        },
        this,
      ))
    }
    return true
  }

  focusIn(): void {
    if (this.disabled || !this.visible) return
    this.interaction.focusIn()
  }

  focusOut(): void {
    this.interaction.focusOut()
  }

  get isFocused(): boolean {
    return this.interaction.isFocused
  }

  getCopyText(): string | null {
    if (this.disabled) return null
    return this.interaction.getCopyText()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.disabled) return false
    if (PopupManager.instance.hasOpen) {
      const handled = PopupManager.instance.handleKeyDown(event)
      if (handled) this.emitInteractionStateChanges()
      return handled
    }
    if (event.altKey && event.key === 'ArrowDown' && this.interaction.focusedColIndex >= 0) {
      const column = this.visibleColumns[this.interaction.focusedColIndex]
      if (!column?.filterable) return false
      event.preventDefault()
      if (this.editing.state && this.editing.commitEdit() === false) {
        this.emitInteractionStateChanges()
        return true
      }
      this._filterPopupController.openFilterPopup(this.interaction.focusedColIndex)
      this.markNeedsPaint()
      this.emitInteractionStateChanges()
      return true
    }
    if (this.editing.state) {
      const handled = this.editing.handleKeyDown(event)
      if (handled) this.emitInteractionStateChanges()
      return handled
    }
    if (this.effectiveDataState !== 'ready') return false
    const handled = this.interaction.handleKeyDown(event)
    if (handled) this.emitInteractionStateChanges()
    return handled
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this.disabled) return
    if (this.effectiveDataState !== 'ready' && this.isBodyPointer(event.position)) return
    if (this.isFilterPopupPointerTarget(event.position)) {
      FocusManager.instance.setFocus(this)
    }
    this.pointer.onPointerDown(event)
    this.emitInteractionStateChanges()
  }

  onPointerMove(event: PointerEvent): void {
    if (this.disabled) return
    this.pointer.onPointerMove(event)
    this.syncOverflowTooltip(event.position)
    this.emitInteractionStateChanges()
  }

  onPointerUp(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this.disabled) return
    this.pointer.onPointerUp(event)
    this.emitInteractionStateChanges()
  }

  onPointerCancel(event: PointerEvent): void {
    this.pointer.onPointerCancel(event)
    this.tooltip = undefined
    this.emitInteractionStateChanges()
  }

  onPointerLeave(event: PointerEvent): void {
    this.pointer.onPointerLeave(event)
    this.tooltip = undefined
    this.emitInteractionStateChanges()
  }

  onContextMenu(position: Offset): boolean {
    if (this.disabled) return false
    const columns = this.visibleColumns
    const globalOffset = this.globalOffset
    if (!this.viewport.inHeader(position, globalOffset)) return false
    const colIndex = this.viewport.colAtX(position.x, globalOffset, columns)
    if (colIndex < 0) return false
    return this.openColumnMenu(colIndex, position)
  }

  onDoubleClick(position: Offset): void {
    if (this.disabled || this.effectiveDataState !== 'ready') return
    this.pointer.onDoubleClick(position)
    this.emitInteractionStateChanges()
  }

  onWheel(event: WheelPointerEvent): boolean {
    if (this.disabled || this.effectiveDataState !== 'ready') return false
    this.tooltip = undefined
    this.editing.cancelNumberStepperPress(true)
    return this.pointer.onWheel(event)
  }

  debugState(): GridDebugState {
    return this._shell.debugState()
  }

  debugPopupState(): GridPopupDebugState {
    return this._shell.debugPopupState()
  }

  detach(): void {
    this.editing.endEdit()
    super.detach()
  }

  private cancelUserInteraction(): void {
    this.editing.endEdit({ restoreFocus: false })
    this._filterPopupController.closeFilterPopup()
    this._columnMenuController.closeColumnMenu()
    PopupManager.instance.closeOwnedBy(this)
    this.pointer.cancelTransientInteraction()
    this.tooltip = undefined
    this.interaction.focusOut()
  }

  private closeFilterPopupForExternalMutation(): void {
    this._filterPopupController.closeFilterPopup()
  }

  private isFilterPopupPointerTarget(position: Offset): boolean {
    const columns = this.visibleColumns
    const globalOffset = this.globalOffset
    const filterRowCol = this.viewport.filterRowColAt(position, globalOffset, columns)
    if (filterRowCol >= 0) return !!columns[filterRowCol]?.filterable

    const style = this._shell.gridTokens(this.currentTheme)
    return this.viewport.filterIconAt(position, globalOffset, columns, {
      sortable: this.sortable,
      sortState: this.sortState,
      groupBy: this.groupBy,
      paddingH: style.paddingH,
      fontSize: style.fontSize,
      metrics: style.headerAction,
    }) >= 0
  }

  private syncFocusRegistration(): void {
    if (this.disabled) {
      if (!this._focusRegistered) return
      FocusManager.instance.clearFocusOf(this)
      FocusManager.instance.unregister(this)
      this._focusRegistered = false
      return
    }
    if (this._focusRegistered) return
    FocusManager.instance.register(this)
    this._focusRegistered = true
  }

  dispose(): void {
    if (this._focusRegistered) FocusManager.instance.unregister(this)
    this._focusRegistered = false
    this.editing.dispose()
    this._cellPopupEditors.dispose()
    this._filterPopupController.dispose()
    this._columnMenuController.dispose()
    this.pointer.dispose()
    this._interactionTargets.clear()
    this.viewport.vScrollbar.dragging = false
    this.viewport.vScrollbar.hovered = false
    this.viewport.hScrollbar.dragging = false
    this.viewport.hScrollbar.hovered = false
    this.dataModel.dispose()
    super.dispose()
  }
}
