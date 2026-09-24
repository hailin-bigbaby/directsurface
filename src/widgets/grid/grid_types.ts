import type { RenderObject } from '../../core/render_object'
import type { BoxConstraints, Offset } from '../../core/render_object'
import type { RenderBoxOptions } from '../../layout/render_box'
import type { Color, ResolvedTheme } from '../../theme/theme'
import type { DropdownOption } from '../dropdown'
import type { TimePrecision } from '../time_value'
import type { GridColumnEditorDef } from './grid_column_editor'

export interface GridColumnBase<T extends Record<string, any> = any> {
  key: string
  title: string
  width?: number
  minWidth?: number
  fixed?: boolean
  pinned?: 'left' | 'right' | false
  hidden?: boolean
  widthMode?: GridColumnWidthMode
  align?: 'left' | 'center' | 'right'
  cellTextOverflow?: GridCellTextOverflow
  editable?: boolean
  sortable?: boolean
  filterable?: boolean
  filterValueFormatter?: (
    value: unknown,
    row: T,
    defaultDisplayText: string,
  ) => string | null | undefined
  editor?: GridColumnEditorDef<Record<string, any>, T>
}

export interface GridColumnText<T extends Record<string, any> = any> extends GridColumnBase<T> {
  type: 'text'
  placeholder?: string
}

export interface GridColumnNumber<T extends Record<string, any> = any> extends GridColumnBase<T> {
  type: 'number'
  min?: number
  max?: number
  step?: number
  decimals?: number
}

export interface GridColumnCheckbox<T extends Record<string, any> = any> extends GridColumnBase<T> {
  type: 'checkbox'
}

export interface GridColumnSelect<T extends Record<string, any> = any> extends GridColumnBase<T> {
  type: 'select'
  options: DropdownOption[]
  searchable?: boolean
}

export interface GridColumnSelectGrid<T extends Record<string, any> = any> extends GridColumnBase<T> {
  type: 'select-grid'
  columns: Array<{ key: string; title: string; width?: number }>
  rows: Array<Record<string, any>>
  valueKey: string
  labelKey: string
  searchable?: boolean
}

export interface GridColumnDate<T extends Record<string, any> = any> extends GridColumnBase<T> {
  type: 'date'
  showTime?: boolean
  timePrecision?: TimePrecision
}

export interface GridColumnTime<T extends Record<string, any> = any> extends GridColumnBase<T> {
  type: 'time'
  precision?: TimePrecision
}

export interface GridColumnCustom<T extends Record<string, any> = any> extends GridColumnBase<T> {
  type: 'custom'
  render: (value: any, row: T) => string
  renderColor?: (value: any, row: T, context: GridCellColorContext) => Color
}

export type GridColumnDef<T extends Record<string, any> = any> =
  | GridColumnText<T>
  | GridColumnNumber<T>
  | GridColumnCheckbox<T>
  | GridColumnSelect<T>
  | GridColumnSelectGrid<T>
  | GridColumnDate<T>
  | GridColumnTime<T>
  | GridColumnCustom<T>

export type GridSortOrder = 'asc' | 'desc' | null

export interface GridSortState {
  key: string
  order: GridSortOrder
}

export interface GridSortDescriptor {
  key: string
  order: Exclude<GridSortOrder, null>
}

export type GridFilterOperator =
  | 'in'
  | 'notIn'
  | 'contains'
  | 'equals'
  | 'startsWith'
  | 'endsWith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'empty'
  | 'notEmpty'

export interface GridFilterRule {
  key: string
  operator: GridFilterOperator
  value?: unknown
  valueTo?: unknown
  values?: unknown[]
}

export interface GridFilterValue {
  readonly key: string
  readonly value: unknown
  readonly text: string
  readonly blank: boolean
  readonly count: number
}

export interface GridDistinctFilterValues {
  readonly values: readonly GridFilterValue[]
  readonly truncated: boolean
}

export type GridDataState = 'ready' | 'loading' | 'empty' | 'error'
export type GridSelectionMode = 'row' | 'cell' | 'range'
export type GridSummaryAggregate = 'sum' | 'avg' | 'min' | 'max' | 'count'
export type GridColumnWidthMode = 'fixed' | 'interactive' | 'stretch' | 'autoContent'
export type GridCellTextOverflow = 'clip' | 'ellipsis'
export type GridRowId = string | number
export type GridRowKey<T extends Record<string, any> = any> =
  | (keyof T & string)
  | ((row: T) => GridRowId | null | undefined)

export type GridDataChangeOrigin =
  | 'editor'
  | 'api'
  | 'session'
  | 'external'

export interface GridCellDataChangeEvent<T extends Record<string, any> = any> {
  kind: 'cell'
  origin: GridDataChangeOrigin
  row: T
  sourceRowIndex: number
  rowId: GridRowId | null
  previousRowId: GridRowId | null
  key: keyof T & string
  previousValue: any
  value: any
}

export interface GridRowsDataChangeEntry<T extends Record<string, any> = any> {
  row: T
  sourceRowIndex: number
  rowId: GridRowId | null
}

export interface GridRowsAddedDataChangeEvent<T extends Record<string, any> = any> {
  kind: 'rows-added'
  origin: GridDataChangeOrigin
  entries: readonly GridRowsDataChangeEntry<T>[]
}

export interface GridRowsRemovedDataChangeEvent<T extends Record<string, any> = any> {
  kind: 'rows-removed'
  origin: GridDataChangeOrigin
  entries: readonly GridRowsDataChangeEntry<T>[]
}

export interface GridRowsReplacedDataChangeEvent<T extends Record<string, any> = any> {
  kind: 'rows-replaced'
  origin: GridDataChangeOrigin
  previousRows: readonly T[]
  rows: readonly T[]
}

export type GridDataChangeEvent<T extends Record<string, any> = any> =
  | GridCellDataChangeEvent<T>
  | GridRowsAddedDataChangeEvent<T>
  | GridRowsRemovedDataChangeEvent<T>
  | GridRowsReplacedDataChangeEvent<T>

export type GridDataChangeListener<T extends Record<string, any> = any> =
  (event: GridDataChangeEvent<T>) => void

export interface GridDataMutationOptions {
  origin?: GridDataChangeOrigin
}

export interface GridSummaryDef<T extends Record<string, any> = any> {
  key: keyof T & string
  aggregate: GridSummaryAggregate
  label?: string
  formatter?: (value: number, rows: T[], def: GridSummaryDef<T>) => string
}

export interface GridSummaryCellDebugState {
  key: string
  aggregate: GridSummaryAggregate
  value: number
  text: string
}

export interface GridCellCoord {
  row: number
  col: number
}

export interface GridCellRange {
  startRow: number
  startCol: number
  endRow: number
  endCol: number
}

export interface GridInternalSelectionState {
  mode: GridSelectionMode
  selectedRows: number[]
  selectedSourceRows: number[]
  selectedRowIds: GridRowId[]
  currentCell: GridCellCoord | null
  selectedRanges: GridCellRange[]
  focusedRow: number
  focusedCol: number
}

export type GridRowEventInput = 'pointer' | 'keyboard' | 'api'

export interface GridInternalRowEvent {
  input: GridRowEventInput
  colIndex?: number
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

export interface GridRowEvent<T extends Record<string, any> = any> {
  rowId: GridRowId | null
  key: (keyof T & string) | null
  column: GridColumnDef<T> | null
  input: GridRowEventInput
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

export interface GridSelectionCell<T extends Record<string, any> = any> {
  row: T
  key: keyof T & string
  column: GridColumnDef<T>
}

export interface GridSelectionRange<T extends Record<string, any> = any> {
  startRow: T
  startKey: keyof T & string
  startColumn: GridColumnDef<T>
  endRow: T
  endKey: keyof T & string
  endColumn: GridColumnDef<T>
}

export interface GridSelectionState<T extends Record<string, any> = any> {
  mode: GridSelectionMode
  selectedRows: T[]
  selectedRowIds: GridRowId[]
  currentCell: GridSelectionCell<T> | null
  selectedRanges: GridSelectionRange<T>[]
  focusedRow: T | null
  focusedKey: (keyof T & string) | null
  focusedColumn: GridColumnDef<T> | null
}

export interface GridSelectionChangeEvent<T extends Record<string, any> = any> {
  state: GridSelectionState<T>
  selectedRow: T | null
  currentCell: GridSelectionCell<T> | null
  focusedCell: GridSelectionCell<T> | null
}

export interface GridRangeSelectionInput<T extends Record<string, any> = any> {
  startRow: T
  startKey: keyof T & string
  endRow: T
  endKey: keyof T & string
}

export interface GridSelectionOptions {
  scroll?: boolean
}

export interface GridColumnState {
  key: string
  width?: number
  hidden?: boolean
  pinned?: 'left' | 'right' | false
  widthMode?: GridColumnWidthMode
}

export interface GridColumnFilterState {
  key: string
  value: string
}

export interface GridViewPreset {
  columns: GridColumnState[]
  sort: GridSortDescriptor[]
  filters: GridFilterRule[]
  columnFilters: GridColumnFilterState[]
  quickFilter: string
}

export interface GridGroupDef<T extends Record<string, any> = any> {
  key: keyof T & string
  order?: 'asc' | 'desc'
}

export interface GridGroupItem<T extends Record<string, any> = any> {
  kind: 'group'
  depth: number
  pathKey: string
  parentPathKey: string | null
  expanded: boolean
  childCount: number
  groupKey: keyof T & string
  groupValue: unknown
  summary?: GridSummaryCellDebugState[]
  summaryText?: string
}

export interface GridDataItem<T extends Record<string, any> = any> {
  kind: 'data'
  depth: number
  pathKey: string
  parentPathKey: string | null
  row: T
  sourceIndex: number
  rowId: GridRowId | null
  dataRowIndex: number
}

export type GridVisibleItem<T extends Record<string, any> = any> =
  | GridGroupItem<T>
  | GridDataItem<T>

export interface GridRowStyleOverride {
  backgroundColor?: Color
  textColor?: Color
  borderColor?: Color
  fontSize?: number
  fontFamily?: string
}

export interface GridCellStyleOverride extends GridRowStyleOverride {
  align?: 'left' | 'center' | 'right'
}

export type GridCellValidationResult =
  | boolean
  | string
  | { valid: boolean; message?: string }
  | null
  | undefined

export interface GridCellValidationArgs<T extends Record<string, any> = any> {
  row: T
  rowId?: GridRowId | null
  key: keyof T & string
  value: any
  originalValue: any
  column: GridColumnDef<T>
}

export interface GridRowValidationArgs<T extends Record<string, any> = any> {
  row: T
  rowId?: GridRowId | null
  sourceRowIndex: number
}

export type GridRowValidationResult<T extends Record<string, any> = any> =
  | Partial<Record<keyof T & string, string | null | undefined>>
  | null
  | undefined

export interface GridCellErrorState<T extends Record<string, any> = any> {
  row: T | null
  rowId?: GridRowId | null
  key: keyof T & string
  column: GridColumnDef<T> | null
  message: string
  value: any
  visible: boolean
}

export interface GridValidationResult<T extends Record<string, any> = any> {
  valid: boolean
  errors: GridCellErrorState<T>[]
}

export interface GridRowStyleArgs<T extends Record<string, any> = any> {
  row: T
  rowId?: GridRowId | null
  theme: ResolvedTheme
  backgroundColor: Color
  selected: boolean
  hovered: boolean
  focused: boolean
  editing: boolean
}

export interface GridCellStyleArgs<T extends Record<string, any> = any> extends GridRowStyleArgs<T> {
  value: any
  column: GridColumnDef<T>
  error?: GridCellErrorState<T> | null
}

export type GridCellDisplayTextArgs<T extends Record<string, any> = any> = Omit<
  GridCellStyleArgs<T>,
  'theme' | 'backgroundColor'
> & {
  theme?: ResolvedTheme
  backgroundColor?: Color
  defaultDisplayText: string
}

export interface GridCellColorContext {
  theme: ResolvedTheme
  backgroundColor: Color
  columnKey: string
  columnIndex: number
  selected: boolean
  hovered: boolean
  focused: boolean
  editing: boolean
}

export interface GridCellContext<
  T extends Record<string, any> = any,
  TColumnRow extends Record<string, any> = T,
> {
  row: T
  rowIndex: number
  column: GridColumnDef<TColumnRow>
  columnIndex: number
  value: unknown
}

export type GridCellEditState = 'inherit' | 'editable' | 'readonly' | 'disabled'

export interface GridCellEditPolicy {
  state?: GridCellEditState
  tabStop?: boolean
  reason?: string
}

/** @internal */
export interface GridResolvedCellEditPolicy {
  state: Exclude<GridCellEditState, 'inherit'>
  tabStop: boolean
  reason?: string
}

export interface GridGroupDisplayTextArgs<T extends Record<string, any> = any> {
  item: GridGroupItem<T>
  column: GridColumnDef<T> | undefined
  groupKey: keyof T & string
  groupValue: unknown
  groupValueText: string
  childCount: number
  depth: number
  expanded: boolean
  defaultDisplayText: string
}

export interface EditState {
  row: number
  col: number
  rowRef?: Record<string, any> | null
  originalValue: any
  text: string
  dragging: boolean
  numberStepperHovered?: 'up' | 'down' | null
  numberStepperPressed?: 'up' | 'down' | null
  rowId?: GridRowId | null
}

export interface GridEditorValidationMessages {
  invalidNumber: string
  invalidDate: string
  invalidTime: string
}

export interface DataGridOptions<T extends Record<string, any>> extends RenderBoxOptions {
  columns: GridColumnDef<T>[]
  rows: T[]
  rowKey?: GridRowKey<T>
  groupBy?: GridGroupDef<T>[]
  defaultGroupExpanded?: boolean
  sort?: GridSortDescriptor[]
  filters?: GridFilterRule[]
  quickFilter?: string
  summary?: GridSummaryDef<T>[]
  dataState?: GridDataState
  stateMessage?: string
  selectionMode?: GridSelectionMode
  rangeSelectionAutoScroll?: boolean
  footerHeight?: number
  filterRowVisible?: boolean
  filterRowHeight?: number
  rowHeight?: number
  headerHeight?: number
  cellTextOverflow?: GridCellTextOverflow
  validateCell?: (args: GridCellValidationArgs<T>) => GridCellValidationResult
  validateRow?: (args: GridRowValidationArgs<T>) => GridRowValidationResult<T>
  editorValidationMessages?: Partial<GridEditorValidationMessages>
  onCellChange?: (row: T, key: keyof T & string, value: any) => void
  onRowClick?: (row: T, event: GridRowEvent<T>) => void
  onRowActivate?: (row: T, event: GridRowEvent<T>) => void
  onSelectionChange?: (event: GridSelectionChangeEvent<T>) => void
  onCurrentCellChange?: (cell: GridSelectionCell<T> | null) => void
  onFocusedCellChange?: (cell: GridSelectionCell<T> | null) => void
  onScrollChange?: (scrollY: number) => void
  disabled?: boolean
  readonly?: boolean
  editable?: boolean
  resizableColumns?: boolean
  autoFitColumns?: boolean
  sortable?: boolean
  reorderableColumns?: boolean
  reserveScrollbars?: boolean
  getCellDisplayText?: (args: GridCellDisplayTextArgs<T>) => string | null | undefined
  getGroupDisplayText?: (args: GridGroupDisplayTextArgs<T>) => string | null | undefined
  resolveRowStyle?: (args: GridRowStyleArgs<T>) => GridRowStyleOverride | null | undefined
  resolveCellStyle?: (args: GridCellStyleArgs<T>) => GridCellStyleOverride | null | undefined
  resolveCellEditPolicy?: (context: GridCellContext<T>) => GridCellEditPolicy | null | undefined
}

export interface GridPopupAnchorData {
  row: number
  col: number
}

export interface GridDebugState {
  scrollX: number
  scrollY: number
  focusedRow: number
  focusedCol: number
  hoveredRow: number
  focusedItemIndex: number
  hoveredItemIndex: number
  edit: { row: number; col: number; text: string } | null
  sortState: GridSortState
  sort: GridSortDescriptor[]
  filters: GridFilterRule[]
  quickFilter: string
  dataState: GridDataState
  stateMessage: string
  selectionMode: GridSelectionMode
  rangeSelectionAutoScroll: boolean
  disabled: boolean
  readonly: boolean
  currentCell: GridCellCoord | null
  selectedRanges: GridCellRange[]
  summary: GridSummaryCellDebugState[]
  footerHeight: number
  filterRowVisible: boolean
  filterRowHeight: number
  columns: GridColumnState[]
  rowHeight: number
  headerHeight: number
  cellErrors: GridCellErrorState[]
}

export type GridDebugPopupKind =
  | 'none'
  | 'dropdown'
  | 'dropdown-grid'
  | 'date-picker'
  | 'drop-tree'
  | 'drop-tree-grid'
  | 'filter'
  | 'column-menu'

export interface GridPopupState<T> {
  visible: boolean
  state: T | null
}

export interface GridPopupRectDebugState {
  x: number
  y: number
  w: number
  h: number
}

export interface GridDropdownPopupDebugState {
  filteredOptions: DropdownOption[]
  keyboardIndex: number
  scrollOffset: number
}

export interface GridDropdownGridPopupDebugState {
  filteredRows: Array<Record<string, any>>
  keyboardIndex: number
  scrollOffset: number
  searchText: string
  searchable: boolean
  searchBehavior: 'internal' | 'external'
  gridScrollY: number
  gridFocusedRow: number
  gridSortState: GridSortState
  selectedValue: string
  panelX: number
  panelW: number
  panelH: number
  panelY: number
  anchorRect: GridPopupRectDebugState
  resizeGripRect: GridPopupRectDebugState
}

export interface GridDateSelectionDebugState {
  year: number
  month: number
  day: number
}

export interface GridDatePickerPopupDebugState {
  panelX: number
  panelY: number
  panelW: number
  panelH: number
  anchorRect: GridPopupRectDebugState
  viewMode: 'day' | 'month' | 'year'
  viewYear: number
  viewMonth: number
  yearRangeStart: number
  selected: GridDateSelectionDebugState | null
}

export interface GridDropTreePopupDebugState {
  searchText: string
  searchable: boolean
  selectedValue: string
  filteredCount: number
  expandedKeys: string[]
  panelX: number
  panelY: number
  panelW: number
  panelH: number
  anchorRect: GridPopupRectDebugState
  treeRect: GridPopupRectDebugState
}

export interface GridDropTreeGridPopupDebugState {
  searchText: string
  searchable: boolean
  selectedValue: string
  filteredCount: number
  expandedKeys: string[]
  panelX: number
  panelY: number
  panelW: number
  panelH: number
  anchorRect: GridPopupRectDebugState
  gridRect: GridPopupRectDebugState
  resizeGripRect: GridPopupRectDebugState
}

export interface GridCellPopupDebugState {
  activePopup: Exclude<GridDebugPopupKind, 'filter' | 'column-menu'>
  dropdown: GridPopupState<GridDropdownPopupDebugState>
  dropdownGrid: GridPopupState<GridDropdownGridPopupDebugState>
  datePicker: GridPopupState<GridDatePickerPopupDebugState>
  dropTree: GridPopupState<GridDropTreePopupDebugState>
  dropTreeGrid: GridPopupState<GridDropTreeGridPopupDebugState>
}

export interface GridFilterPopupDebugState {
  visible: boolean
  column: number
  columnKey?: string
  mode?: 'values' | 'condition'
  operator?: GridFilterOperator
  value?: unknown
  valueTo?: unknown
  values?: unknown[]
}

export interface GridColumnMenuDebugState {
  visible: boolean
  column: number
  columnKey: string
}

export interface GridPopupDebugState {
  activePopup: GridDebugPopupKind
  dropdown: GridPopupState<GridDropdownPopupDebugState>
  dropdownGrid: GridPopupState<GridDropdownGridPopupDebugState>
  datePicker: GridPopupState<GridDatePickerPopupDebugState>
  dropTree: GridPopupState<GridDropTreePopupDebugState>
  dropTreeGrid: GridPopupState<GridDropTreeGridPopupDebugState>
  filter: GridFilterPopupDebugState
  columnMenu: GridColumnMenuDebugState
}

export interface GridEmbeddedPopupDebugState {
  scrollY: number
  focusedRow: number
  sortState: GridSortState
}

export type GridEmbeddedPopupGrid = RenderObject & {
  columns: GridColumnDef<Record<string, any>>[]
  rows: Array<Record<string, any>>
  rowHeight: number
  headerHeight: number
  offset: Offset
  onRowClick?: (row: Record<string, any>, event: GridRowEvent<Record<string, any>>) => void
  onRowActivate?: (row: Record<string, any>, event: GridRowEvent<Record<string, any>>) => void
  onScrollChange?: (scrollY: number) => void
  layout(constraints: BoxConstraints, parentUsesSize?: boolean, context?: { theme: any }): void
  focusRow(row: Record<string, any> | null, opts?: { select?: boolean; scroll?: boolean }): boolean
  getVisibleRows(): readonly Record<string, any>[]
  debugState(): GridEmbeddedPopupDebugState
  dispose(): void
}
