import { FocusManager, type Focusable } from '../core/focus_manager'
import type { CopyableSelection } from '../core/clipboard'
import { GET_POPUP_ANCHOR_RECT } from '../core/popup_anchor'
import { TextMeasurer } from '../core/text_measurer'
import { ellipsizeText } from '../core/text_overflow'
import { constrainSize, type BoxConstraints, type LayoutContext, type Offset, type RenderObject } from '../core/render_object'
import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import type { InteractiveRenderObject, PointerEvent, WheelPointerEvent } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { pointerKey, type PointerKey } from '../gestures/pointer_identity'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { paintHBar, paintVBar } from '../rendering/scrollbar'
import { paintSingleLineEditableText } from '../rendering/single_line_text_renderer'
import { paintSingleLineText } from '../rendering/text_painter'
import {
  deriveCheckboxStyle,
  deriveGridCellStyle,
  deriveScrollbarStyle,
  deriveTreeStyle,
  resolveBgColor,
  resolveTextColor,
  type CheckboxStyleTokens,
  type GridCellStyleTokens,
  type ScrollbarStyleTokens,
  type TreeStyleTokens,
} from '../theme/component_styles'
import type { Color, ResolvedTheme } from '../theme/theme'
import { GridViewport } from './grid/grid_viewport'
import { defaultGridCellDisplayText } from './grid/grid_display_resolver'
import { gridFilterComparableValue } from './grid/grid_filter_condition'
import { GridLookupValueResolver } from './grid/lookup_value_index'
import { GridCellPopupEditors } from './grid/grid_cell_popup_editors'
import { GridEditingController } from './grid/grid_editing_controller'
import { isGridPopupEditor, resolveGridColumnEditorKind } from './grid/grid_column_editor'
import type {
  GridCellStyleOverride,
  GridCellTextOverflow,
  GridColumnDef,
  GridEmbeddedPopupGrid,
  GridPopupAnchorData,
  GridSortState,
  GridSortOrder,
  GridRowStyleOverride,
} from './grid/grid_types'
import { RenderDataGrid } from './grid_view'
import { TreeGridStructureEditController } from './tree_grid_structure_edit_controller'
import { isIconName, paintIconGlyph } from './icon'

export interface TreeGridNode<T extends Record<string, any> = any> {
  key: string
  row: T
  children?: TreeGridNode<T>[]
  icon?: string // 内置 IconName、emoji 或单字符图标
  selectable?: boolean
  checkable?: boolean
}

export type TreeGridSelectionMode = 'single' | 'check'

export interface TreeGridCheckChange<T extends Record<string, any> = any> {
  checkedKeys: string[]
  halfCheckedKeys: string[]
  checkedNodes: TreeGridNode<T>[]
  halfCheckedNodes: TreeGridNode<T>[]
  toggledNode: TreeGridNode<T>
}

export type TreeGridNodeInput<T extends Record<string, any> = any> =
  | TreeGridNode<T>
  | T
  | string
  | number
  | null

export interface TreeGridCell<T extends Record<string, any> = any> {
  node: TreeGridNode<T>
  row: T
  key: keyof T & string
  column: GridColumnDef<T>
}

export interface TreeGridSelectionState<T extends Record<string, any> = any> {
  selectedKey: string
  selectedNode: TreeGridNode<T> | null
  selectedRow: T | null
  focusedNode: TreeGridNode<T> | null
  focusedRow: T | null
  focusedKey: (keyof T & string) | null
  focusedColumn: GridColumnDef<T> | null
  focusedCell: TreeGridCell<T> | null
  checkedKeys: string[]
  halfCheckedKeys: string[]
  checkedNodes: TreeGridNode<T>[]
  halfCheckedNodes: TreeGridNode<T>[]
}

export interface TreeGridRowStyleArgs<T extends Record<string, any> = any> {
  node: TreeGridNode<T>
  row: T
  theme: ResolvedTheme
  backgroundColor: Color
  rowIndex: number
  sourceRowIndex: number
  itemIndex: number
  selected: boolean
  hovered: boolean
  focused: boolean
  editing: boolean
}

export interface TreeGridCellStyleArgs<T extends Record<string, any> = any> extends TreeGridRowStyleArgs<T> {
  value: any
  column: GridColumnDef<T>
  colIndex: number
}

export interface TreeGridCellDisplayTextArgs<T extends Record<string, any> = any> extends TreeGridCellStyleArgs<T> {
  defaultDisplayText: string
}

interface FilteredTreeGridNode<T extends Record<string, any> = any> {
  node: TreeGridNode<T>
  children: FilteredTreeGridNode<T>[]
}

export interface TreeGridVisibleNodeItem<T extends Record<string, any> = any> {
  kind: 'data'
  depth: number
  pathKey: string
  parentPathKey: string | null
  row: T
  sourceIndex: number
  dataRowIndex: number
  node: TreeGridNode<T>
  hasChildren: boolean
  expanded: boolean
}

export interface TreeGridOptions<T extends Record<string, any>> extends RenderBoxOptions {
  columns: GridColumnDef<T>[]
  roots: TreeGridNode<T>[]
  treeColumnKey: keyof T & string
  selectionMode?: TreeGridSelectionMode
  checkedKeys?: readonly string[]
  defaultCheckedKeys?: readonly string[]
  defaultExpandedKeys?: readonly string[]
  defaultExpandAll?: boolean
  rowHeight?: number
  headerHeight?: number
  reserveScrollbars?: boolean
  sortable?: boolean
  resizableColumns?: boolean
  editable?: boolean
  cellTextOverflow?: GridCellTextOverflow
  getCellDisplayText?: (args: TreeGridCellDisplayTextArgs<T>) => string | null | undefined
  copyable?: boolean
  copyText?: (node: TreeGridNode<T>, column: GridColumnDef<T> | null) => string | null | undefined
  resolveRowStyle?: (args: TreeGridRowStyleArgs<T>) => GridRowStyleOverride | null | undefined
  resolveCellStyle?: (args: TreeGridCellStyleArgs<T>) => GridCellStyleOverride | null | undefined
  onCellChange?: (node: TreeGridNode<T>, key: keyof T & string, value: any) => void
  onSelect?: (node: TreeGridNode<T>) => void
  onActivate?: (node: TreeGridNode<T>) => void
  onExpand?: (node: TreeGridNode<T>, expanded: boolean) => void
  onCheck?: (payload: TreeGridCheckChange<T>) => void
}

interface TreeGridRowPresentation<T extends Record<string, any> = any> {
  args: TreeGridRowStyleArgs<T>
  override: GridRowStyleOverride | null
  backgroundColor: { r: number; g: number; b: number; a: number } | null
  textColor: { r: number; g: number; b: number; a: number }
  borderColor: { r: number; g: number; b: number; a: number } | null
  fontSize: number
  fontFamily: string
}

interface TreeGridCellPresentation<T extends Record<string, any> = any> {
  args: TreeGridCellStyleArgs<T>
  displayText: string
  backgroundColor: { r: number; g: number; b: number; a: number } | null
  textColor: { r: number; g: number; b: number; a: number }
  borderColor: { r: number; g: number; b: number; a: number } | null
  fontSize: number
  fontFamily: string
  align: 'left' | 'center' | 'right'
}

interface TreeCellLayout {
  arrowCenterX: number
  arrowHitRect: { x: number; y: number; w: number; h: number } | null
  checkboxRect: { x: number; y: number; w: number; h: number } | null
  iconX: number
  textX: number
}

function pointInRect(point: Offset, rect: { x: number; y: number; w: number; h: number }): boolean {
  return point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
}

type TreeGridPointerOwnerMode = 'drag' | 'number-stepper'

export class RenderTreeGrid<T extends Record<string, any> = any>
  extends RenderBox implements InteractiveRenderObject, Focusable, CopyableSelection {
  static override debugTypeName = 'RenderTreeGrid'
  editable: boolean
  onCellChange?: (node: TreeGridNode<T>, key: keyof T & string, value: any) => void
  onSelect?: (node: TreeGridNode<T>) => void
  onActivate?: (node: TreeGridNode<T>) => void
  onExpand?: (node: TreeGridNode<T>, expanded: boolean) => void
  onCheck?: (payload: TreeGridCheckChange<T>) => void

  private _columns: GridColumnDef<T>[]
  private readonly _lookupValues: GridLookupValueResolver<T>
  private _roots: TreeGridNode<T>[]
  private _treeColumnKey: keyof T & string
  private _selectionMode: TreeGridSelectionMode
  private _viewport: GridViewport<T>
  private _sortable: boolean
  private _resizableColumns: boolean
  private _sortState: GridSortState = { key: '', order: null }
  private readonly _filterValues = new Map<string, string>()
  private _selectedKey = ''
  private _checkedLeafKeys = new Set<string>()
  private _fullyCheckedKeys = new Set<string>()
  private _halfCheckedKeys = new Set<string>()
  private _expanded = new Set<string>()
  private _visibleItems: TreeGridVisibleNodeItem<T>[] = []
  private _visibleIndexByKey = new Map<string, number>()
  private _sourceIndexByKey = new Map<string, number>()
  private _hoveredItemIndex = -1
  private _focusedItemIndex = -1
  private _focusedColIndex = -1
  private _focused = false
  private _suppressNextFocusReveal = false
  private _revealKeyOnNextLayout: string | null = null
  private _dragPointerKey?: PointerKey
  private _pointerOwnerMode?: TreeGridPointerOwnerMode
  private _releasePointerCapture?: () => void
  private _cellTextOverflow: GridCellTextOverflow
  private _getCellDisplayText?: TreeGridOptions<T>['getCellDisplayText']
  private _copyable: boolean
  private _copyText?: TreeGridOptions<T>['copyText']
  private _resolveRowStyle?: TreeGridOptions<T>['resolveRowStyle']
  private _resolveCellStyle?: TreeGridOptions<T>['resolveCellStyle']
  readonly structureEditing: TreeGridStructureEditController<T>
  readonly editing: GridEditingController<T>
  private readonly _cellPopupEditors: GridCellPopupEditors<T>

  constructor(options: TreeGridOptions<T>) {
    super(options)
    this._columns = options.columns
    this._lookupValues = new GridLookupValueResolver(options.columns)
    this._roots = options.roots
    this._treeColumnKey = this._resolveTreeColumnKey(options.treeColumnKey)
    this._selectionMode = options.selectionMode ?? 'single'
    this._viewport = new GridViewport<T>({
      rowHeight: options.rowHeight,
      headerHeight: options.headerHeight,
      reserveScrollbars: options.reserveScrollbars,
    })
    this._sortable = options.sortable ?? true
    this._resizableColumns = options.resizableColumns ?? true
    this.editable = options.editable ?? false
    this._cellTextOverflow = options.cellTextOverflow ?? 'ellipsis'
    this._getCellDisplayText = options.getCellDisplayText
    this._copyable = options.copyable ?? true
    this._copyText = options.copyText
    this._resolveRowStyle = options.resolveRowStyle
    this._resolveCellStyle = options.resolveCellStyle
    this.onCellChange = options.onCellChange
    this.onSelect = options.onSelect
    this.onActivate = options.onActivate
    this.onExpand = options.onExpand
    this.onCheck = options.onCheck

    if (options.defaultExpandAll) this._collectExpandableKeys(this._roots, this._expanded)
    for (const key of options.defaultExpandedKeys ?? []) this._expanded.add(key)
    for (const key of options.checkedKeys ?? options.defaultCheckedKeys ?? []) this._checkedLeafKeys.add(key)

    this._reindexSourceNodes()
    this._recomputeCheckState()
    this._syncVisibleItems()
    this.structureEditing = new TreeGridStructureEditController<T>({
      getColumns: () => this._columns,
      getVisibleItems: () => this._visibleItems,
      onCellChange: (node, key, value) => this.onCellChange?.(node as TreeGridNode<T>, key, value),
      onInvalidateVisibleItems: () => this._syncVisibleItems(),
      onMarkNeedsPaint: () => this.markNeedsPaint(),
    })
    this._cellPopupEditors = new GridCellPopupEditors<T>({
      owner: this as any,
      structureEditing: this.structureEditing,
      getVisibleRows: () => this._visibleItems.map(item => item.row),
      onEndEdit: () => this.editing.endEdit(),
      createEmbeddedGrid: () => new RenderDataGrid<Record<string, any>>({
        columns: [],
        rows: [],
        editable: false,
        resizableColumns: false,
        sortable: false,
        reserveScrollbars: false,
      }) as GridEmbeddedPopupGrid,
    })
    this.editing = new GridEditingController<T>({
      owner: this,
      focusableOwner: this,
      structureEditing: this.structureEditing,
      cellPopupEditors: this._cellPopupEditors,
      editable: () => this.editable,
      getColumns: () => this._columns,
      getVisibleRows: () => this._visibleItems.map(item => item.row),
      getVisibleRowId: () => null,
      getVisibleRowIndexForRowId: () => -1,
      getEditTextMetrics: (row, col) => this._editTextMetrics(row, col),
      measureText: (text, fontSize, fontFamily) => TextMeasurer.measureWidth(text, fontSize, fontFamily),
      getCellGlobalRect: (row, col) => this._cellGlobalRect(row, col),
      onMarkNeedsPaint: () => this.markNeedsPaint(),
      onRevealCell: (row, col) => {
        this._viewport.scrollToRow(this._visibleItems.length, row)
        this._viewport.scrollToColumn(this._columns, col)
      },
      onFocusedCellChange: (row, col) => {
        this._focusedItemIndex = row
        this._focusedColIndex = col
      },
    })
    FocusManager.instance.register(this)
  }

  override visitChildren(_visitor: (child: RenderObject) => void): void {}

  [GET_POPUP_ANCHOR_RECT](anchor?: GridPopupAnchorData): { x: number; y: number; width: number; height: number } {
    const row = anchor?.row ?? this._focusedItemIndex
    const col = anchor?.col ?? Math.max(0, this._focusedColIndex)
    const rect = this._cellGlobalRect(row, col)
    return {
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
    }
  }

  focusIn(): void {
    this._focused = true
    if (this._visibleItems.length > 0) {
      if (this._suppressNextFocusReveal && this._focusedItemIndex >= 0) {
        this._focusedItemIndex = Math.min(this._focusedItemIndex, this._visibleItems.length - 1)
      } else if (this._selectionMode === 'check') {
        const checkAnchor = this._findCheckAnchorIndex()
        if (checkAnchor >= 0) this._focusedItemIndex = checkAnchor
        else {
          const selectedIndex = this._selectedKey ? this._visibleIndexByKey.get(this._selectedKey) ?? -1 : -1
          this._focusedItemIndex = selectedIndex >= 0 ? selectedIndex : 0
        }
      } else {
        const selectedIndex = this._selectedKey ? this._visibleIndexByKey.get(this._selectedKey) ?? -1 : -1
        if (selectedIndex >= 0) this._focusedItemIndex = selectedIndex
        else if (this._focusedItemIndex < 0) this._focusedItemIndex = 0
      }
    }
    if (this._focusedColIndex < 0) this._focusedColIndex = this._defaultFocusedColumnIndex()
    else this._focusedColIndex = this._normalizeFocusedColumn(this._focusedColIndex)
    if (!this._suppressNextFocusReveal) this._scrollToFocused()
    this.markNeedsPaint()
  }

  focusOut(): void {
    this._focused = false
    this.markNeedsPaint()
  }

  get isFocused(): boolean { return this._focused }

  getCopyText(): string | null {
    if (!this._copyable) return null
    const item = this._selectedVisibleItem() ?? this._visibleItems[this._focusedItemIndex] ?? null
    if (!item) return null
    const column = this._focusedColIndex >= 0 ? this._columns[this._focusedColIndex] ?? null : null
    const customText = this._copyText?.(item.node, column)
    if (customText !== undefined) return customText ?? null
    if (column) return this._displayTextForColumn(item.node, column) ?? null
    const text = this._columns.map(entry => this._displayTextForColumn(item.node, entry)).join('\t')
    return text
  }

  get cellTextOverflow(): GridCellTextOverflow { return this._cellTextOverflow }
  set cellTextOverflow(value: GridCellTextOverflow) {
    const next = value === 'clip' ? 'clip' : 'ellipsis'
    if (next === this._cellTextOverflow) return
    this._cellTextOverflow = next
    this.markNeedsPaint()
  }

  get columns(): GridColumnDef<T>[] { return this._columns }
  set columns(columns: GridColumnDef<T>[]) {
    if (this._columns === columns) return
    this._columns = columns
    this._lookupValues.syncColumns(columns)
    this._treeColumnKey = this._resolveTreeColumnKey(this._treeColumnKey)
    const normalizedSortState = this._normalizeSortState(this._sortState)
    const sortStateChanged = normalizedSortState.key !== this._sortState.key ||
      normalizedSortState.order !== this._sortState.order
    this._sortState = normalizedSortState
    this._viewport.resetColumnWidths()
    if (sortStateChanged) this._syncVisibleItems()
    if (this.editing.state && this.editing.state.col >= columns.length) this.editing.endEdit()
    if (this._focusedColIndex >= columns.length) this._focusedColIndex = this.structureEditing.lastEditableColumnIndex()
    else this._focusedColIndex = this._normalizeFocusedColumn(this._focusedColIndex)
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  refreshLookup(columnKey?: string): boolean {
    if (!this._lookupValues.refresh(this._columns, columnKey)) return false
    this._syncVisibleItems()
    this.markNeedsPaint()
    return true
  }

  get roots(): TreeGridNode<T>[] { return this._roots }
  set roots(roots: TreeGridNode<T>[]) {
    if (roots === this._roots) return
    this._roots = roots
    this._pruneExpandedState()
    this._reindexSourceNodes()
    this._recomputeCheckState()
    this._syncVisibleItems()
    this.markNeedsPaint()
  }

  get treeColumnKey(): keyof T & string { return this._treeColumnKey }
  set treeColumnKey(key: keyof T & string) {
    const nextKey = this._resolveTreeColumnKey(key)
    if (nextKey === this._treeColumnKey) return
    this._treeColumnKey = nextKey
    this.markNeedsPaint()
  }

  get selectionMode(): TreeGridSelectionMode { return this._selectionMode }
  set selectionMode(mode: TreeGridSelectionMode) {
    if (mode === this._selectionMode) return
    this._selectionMode = mode
    this.editing.endEdit()
    this.markNeedsPaint()
  }

  get sortState(): GridSortState { return { ...this._sortState } }
  set sortState(sortState: GridSortState) {
    const normalized = this._normalizeSortState(sortState)
    if (normalized.key === this._sortState.key && normalized.order === this._sortState.order) return
    this._sortState = normalized
    this._syncVisibleItems()
    this.markNeedsPaint()
  }

  get filterValues(): ReadonlyMap<string, string> { return this._filterValues }

  setFilterValue(key: string, value: string): boolean {
    const current = this._filterValues.get(key) ?? ''
    if (current === value) return false
    if (value) this._filterValues.set(key, value)
    else this._filterValues.delete(key)
    this._syncVisibleItems()
    this.markNeedsPaint()
    return true
  }

  clearAllFilters(): boolean {
    if (this._filterValues.size === 0) return false
    this._filterValues.clear()
    this._syncVisibleItems()
    this.markNeedsPaint()
    return true
  }

  get expandedKeys(): string[] { return [...this._expanded] }
  set expandedKeys(keys: readonly string[]) {
    const next = new Set(keys.filter(key => this._sourceIndexByKey.has(key)))
    const changed = next.size !== this._expanded.size || [...next].some(key => !this._expanded.has(key))
    if (!changed) return
    this._expanded = next
    this._syncVisibleItems()
    this.markNeedsPaint()
  }

  get selectedKey(): string { return this._selectedKey }
  set selectedKey(key: string) {
    const nextKey = key && this._isSelectableKey(key) ? key : ''
    if (nextKey === this._selectedKey) return
    this._selectedKey = nextKey
    if (nextKey) {
      this._expandAncestors(nextKey)
      this._revealKeyOnNextLayout = nextKey
      this._syncVisibleItems()
    }
    this.markNeedsPaint()
  }

  get checkedKeys(): string[] { return [...this._checkedLeafKeys] }
  set checkedKeys(keys: readonly string[]) {
    const next = new Set(keys)
    const changed = next.size !== this._checkedLeafKeys.size || [...next].some(key => !this._checkedLeafKeys.has(key))
    if (!changed) return
    this._checkedLeafKeys = next
    this._recomputeCheckState()
    this.markNeedsPaint()
  }

  get halfCheckedKeys(): string[] { return [...this._halfCheckedKeys] }

  getVisibleNodes(): readonly TreeGridNode<T>[] {
    return this._visibleItems.map(item => item.node)
  }

  getVisibleRows(): readonly T[] {
    return this._visibleItems.map(item => item.row)
  }

  getSelectionState(): TreeGridSelectionState<T> {
    const selectedNode = this.getSelectedNode()
    const focusedNode = this.getFocusedNode()
    const focusedColumn = this.getFocusedColumn()
    return {
      selectedKey: this._selectedKey,
      selectedNode,
      selectedRow: selectedNode?.row ?? null,
      focusedNode,
      focusedRow: focusedNode?.row ?? null,
      focusedKey: focusedColumn ? focusedColumn.key as keyof T & string : null,
      focusedColumn,
      focusedCell: this.getFocusedCell(),
      checkedKeys: this.checkedKeys,
      halfCheckedKeys: this.halfCheckedKeys,
      checkedNodes: this._resolveNodes([...this._checkedLeafKeys]),
      halfCheckedNodes: this._resolveNodes([...this._halfCheckedKeys]),
    }
  }

  getSelectedNode(): TreeGridNode<T> | null {
    return this._selectedKey ? this._findNodeByKey(this._roots, this._selectedKey) : null
  }

  getSelectedRow(): T | null {
    return this.getSelectedNode()?.row ?? null
  }

  getFocusedNode(): TreeGridNode<T> | null {
    return this._visibleItems[this._focusedItemIndex]?.node ?? null
  }

  getFocusedRow(): T | null {
    return this.getFocusedNode()?.row ?? null
  }

  getFocusedColumn(): GridColumnDef<T> | null {
    return this._columns[this._focusedColIndex] ?? null
  }

  getFocusedKey(): (keyof T & string) | null {
    const column = this.getFocusedColumn()
    return column ? column.key as keyof T & string : null
  }

  getFocusedCell(): TreeGridCell<T> | null {
    const node = this.getFocusedNode()
    const column = this.getFocusedColumn()
    if (!node || !column) return null
    return {
      node,
      row: node.row,
      key: column.key as keyof T & string,
      column,
    }
  }

  beginEdit(row: TreeGridNodeInput<T>, column: (keyof T & string) | number): boolean {
    const rowIndex = this._resolveVisibleItemIndex(row)
    const colIndex = this._resolveColumnIndex(column)
    if (rowIndex < 0 || colIndex < 0) return false
    return this.editing.beginEdit(rowIndex, colIndex)
  }

  get editingCell(): (TreeGridCell<T> & { text: string }) | null {
    const cell = this.editing.editingCell
    if (!cell) return null
    const item = this._visibleItems[cell.row]
    const column = this._columns[cell.col]
    if (!item || !column) return null
    return {
      node: item.node,
      row: item.row,
      key: column.key as keyof T & string,
      column,
      text: cell.text,
    }
  }

  commitEdit(): void {
    this.editing.commitEdit()
  }

  cancelEdit(): void {
    this.editing.cancelEdit()
  }

  focusRow(row: TreeGridNodeInput<T>, options: { select?: boolean; scroll?: boolean } = {}): boolean {
    return this.focusCell(row, -1, { ...options, select: options.select ?? true })
  }

  focusCell(
    row: TreeGridNodeInput<T>,
    column: (keyof T & string) | number,
    options: { select?: boolean; scroll?: boolean } = {},
  ): boolean {
    const select = options.select ?? false
    const rowIndex = this._resolveVisibleItemIndex(row)
    const colIndex = this._resolveColumnIndex(column)
    if (rowIndex < 0 || rowIndex >= this._visibleItems.length) {
      const changed = this._focusedItemIndex !== -1 || this._focusedColIndex !== -1
      this._focusedItemIndex = -1
      this._focusedColIndex = -1
      const previousSelectedKey = this._selectedKey
      if (select && this._selectionMode === 'single') this._selectedKey = ''
      if (changed || previousSelectedKey !== this._selectedKey) this.markNeedsPaint()
      return row === null
    }
    if (colIndex < 0 && !(typeof column === 'number' && Math.floor(column) === -1)) return false

    const item = this._visibleItems[rowIndex]
    if (!item) return false
    const previousRow = this._focusedItemIndex
    const previousCol = this._focusedColIndex
    const previousSelectedKey = this._selectedKey
    this._focusedItemIndex = rowIndex
    this._focusedColIndex = this._normalizeFocusedColumn(colIndex)
    if (select && this._selectionMode === 'single' && item.node.selectable !== false) {
      this._selectedKey = item.node.key
    }
    if (options.scroll ?? true) this._scrollToFocused()
    if (
      previousRow !== this._focusedItemIndex ||
      previousCol !== this._focusedColIndex ||
      previousSelectedKey !== this._selectedKey
    ) {
      this.markNeedsPaint()
    }
    return true
  }

  selectNode(node: TreeGridNode<T> | string | null): boolean {
    if (node === null) {
      const changed = this._selectedKey !== ''
      this._selectedKey = ''
      if (changed) this.markNeedsPaint()
      return changed
    }
    const key = typeof node === 'string' ? node : node.key
    const nextKey = key && this._isSelectableKey(key) ? key : ''
    if (!nextKey) return false
    if (nextKey === this._selectedKey) return true
    this.selectedKey = nextKey
    return true
  }

  setCellValue(row: TreeGridNodeInput<T>, key: keyof T & string, value: any): boolean {
    const rowIndex = this._resolveVisibleItemIndex(row)
    const colIndex = this._resolveColumnIndex(key)
    if (rowIndex >= 0) {
      const changed = colIndex >= 0
        ? this.structureEditing.commitVisibleCell(rowIndex, colIndex, value)
        : this.structureEditing.commitVisibleValue(rowIndex, key, value)
      if (changed) this._syncEditingViewportState()
      return changed
    }

    const node = this._resolveNode(row)
    if (!node) return false
    return this._setNodeCellValue(node, key, value)
  }

  refreshNode(row: TreeGridNodeInput<T>): boolean {
    const node = this._resolveNode(row)
    if (!node) return false
    this._syncVisibleItems()
    this._syncEditingViewportState()
    this.markNeedsPaint()
    return true
  }

  refreshData(): void {
    this._pruneExpandedState()
    this._reindexSourceNodes()
    this._recomputeCheckState()
    this._syncVisibleItems()
    this._syncEditingViewportState()
    this.markNeedsPaint()
  }

  debugState(): {
    visibleKeys: string[]
    scrollX: number
    scrollY: number
    focusedItemIndex: number
    focusedCol: number
    focused: boolean
    selectedKey: string
    checkedKeys: string[]
    halfCheckedKeys: string[]
    edit: { row: number; col: number } | null
  } {
    return {
      visibleKeys: this._visibleItems.map(item => item.node.key),
      scrollX: this._viewport.scrollX,
      scrollY: this._viewport.scrollY,
      focusedItemIndex: this._focusedItemIndex,
      focusedCol: this._focusedColIndex,
      focused: this._focused,
      selectedKey: this._selectedKey,
      checkedKeys: [...this._checkedLeafKeys],
      halfCheckedKeys: [...this._halfCheckedKeys],
      edit: this.editing.state ? { row: this.editing.state.row, col: this.editing.state.col } : null,
    }
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    if (context.pass === 'measure') {
      this.size = constrainSize(constraints, {
        width: constraints.maxWidth === Infinity ? 600 : constraints.maxWidth,
        height: constraints.maxHeight === Infinity ? 400 : constraints.maxHeight,
      })
      return
    }
    this.size = this._viewport.performLayout(constraints, context.theme, this._columns)
    this._viewport.clampScrollOffsets(this._columns, this._visibleItems.length)
    this._syncEditingViewportState()
    if (this._revealKeyOnNextLayout) {
      this.revealNode(this._revealKeyOnNextLayout)
      this._revealKeyOnNextLayout = null
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const tokens = deriveGridCellStyle(context.theme)
    const scrollbarTokens = deriveScrollbarStyle(context.theme)
    const width = this._viewport.size.width
    const height = this._viewport.size.height
    const scrollbarWidth = this._viewport.scrollbarWidth()
    const viewWidth = this._viewport.viewWidth
    const bodyY = offset.y + this._viewport.headerHeight
    const bodyHeight = this._viewport.viewHeight

    dl.fillRect(offset.x, offset.y, width, height, tokens.windowBg, tokens.frameRounding)
    dl.strokeRect(offset.x, offset.y, width, height, tokens.windowBorder, 1, tokens.frameRounding)

    this._paintHeader(dl, offset.x, offset.y, viewWidth, tokens)
    dl.pushClip(offset.x, bodyY, viewWidth, bodyHeight)
    this._paintRows(context, dl, offset.x, bodyY, viewWidth, context.theme, tokens)
    dl.popClip()
    this._paintScrollbars(dl, offset.x, offset.y, bodyY, bodyHeight, scrollbarWidth, scrollbarTokens)
  }

  private _captureDrag(event: PointerEvent): boolean {
    return this._claimPointerOwner(event, 'drag')
  }

  private _captureNumberStepper(event: PointerEvent): boolean {
    if (this._claimPointerOwner(event, 'number-stepper')) return true
    event.preventActivation?.()
    return false
  }

  private _claimPointerOwner(
    event: PointerEvent,
    mode: TreeGridPointerOwnerMode,
  ): boolean {
    const key = pointerKey(event)
    if (this._dragPointerKey !== undefined) {
      return this._dragPointerKey === key &&
        this._pointerOwnerMode === mode
    }
    event.stopPropagation?.()
    event.setPointerCapture?.()
    this._dragPointerKey = key
    this._pointerOwnerMode = mode
    this._releasePointerCapture = event.releasePointerCapture
    return true
  }

  private _releasePointerOwner(
    event?: PointerEvent,
    expectedMode?: TreeGridPointerOwnerMode,
  ): boolean {
    if (
      event &&
      this._dragPointerKey !== undefined &&
      this._dragPointerKey !== pointerKey(event)
    ) {
      return false
    }
    if (
      expectedMode !== undefined &&
      this._dragPointerKey !== undefined &&
      this._pointerOwnerMode !== expectedMode
    ) {
      return false
    }
    const hadOwner = this._dragPointerKey !== undefined
    const releasePointerCapture = this._releasePointerCapture
    this._dragPointerKey = undefined
    this._pointerOwnerMode = undefined
    this._releasePointerCapture = undefined
    if (hadOwner) {
      let firstError: unknown
      let hasError = false
      try {
        event?.stopPropagation?.()
      } catch (error) {
        firstError = error
        hasError = true
      }
      try {
        releasePointerCapture?.()
      } catch (error) {
        if (!hasError) {
          firstError = error
          hasError = true
        }
      }
      if (hasError) throw firstError
    }
    return hadOwner
  }

  private _resizedColumnWidth(colIndex: number, pointerX: number): number | null {
    const column = this._columns[colIndex]
    if (!column) return null
    const width = this._viewport.resizeStartW + pointerX - this._viewport.resizeStartX
    return Math.max(column.minWidth ?? 40, width)
  }

  private _persistResizedColumnWidth(colIndex: number, width: number): void {
    const column = this._columns[colIndex]
    if (!column || !Number.isFinite(width)) return
    if (column.width === width && (column.widthMode ?? 'interactive') === 'interactive') return
    this._columns = this._columns.map((entry, index) => index === colIndex
      ? {
          ...entry,
          width,
          widthMode: 'interactive' as const,
        }
      : entry)
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (
      (
        this._dragPointerKey !== undefined &&
        this._dragPointerKey !== pointerKey(event)
      ) ||
      this._pointerOwnerMode === 'number-stepper'
    ) {
      event.preventActivation?.()
      return
    }
    if (!this.hitTest(event.position)) {
      this.editing.commitEdit()
      FocusManager.instance.clearFocus()
      return
    }

    const globalOffset = this.globalOffset
    const resizeCol = this._viewport.resizeColAt(event.position, globalOffset, this._columns, this._resizableColumns)
    if (resizeCol >= 0) {
      if (!this._captureDrag(event)) return
      this._viewport.resizingCol = resizeCol
      this._viewport.resizeStartX = event.position.x
      this._viewport.resizeStartW = this._viewport.colWidths[resizeCol] ?? 0
      this._viewport.resizeCurrentX = event.position.x
      return
    }

    const key = pointerKey(event)
    const verticalResult = this._viewport.vScrollbarController.beginPointer(
      event.position,
      this._viewport.vScrollbarGeometry(globalOffset, this._visibleItems.length),
      key,
    )
    if (verticalResult.handled) {
      event.stopPropagation?.()
      event.preventActivation?.()
      if (verticalResult.capturePointer && !this._captureDrag(event)) {
        this._viewport.vScrollbarController.cancelPointer(key)
        return
      }
      if (verticalResult.scrollOffset !== undefined) {
        this._viewport.setScrollY(this._visibleItems.length, verticalResult.scrollOffset)
      }
      this.markNeedsPaint()
      return
    }

    const horizontalResult = this._viewport.hScrollbarController.beginPointer(
      event.position,
      this._viewport.hScrollbarGeometry(globalOffset, this._columns),
      key,
    )
    if (horizontalResult.handled) {
      event.stopPropagation?.()
      event.preventActivation?.()
      if (horizontalResult.capturePointer && !this._captureDrag(event)) {
        this._viewport.hScrollbarController.cancelPointer(key)
        return
      }
      if (horizontalResult.scrollOffset !== undefined) {
        this._viewport.setScrollX(this._columns, horizontalResult.scrollOffset)
      }
      this.markNeedsPaint()
      return
    }

    if (this._viewport.inHeader(event.position, globalOffset)) {
      this._toggleSortAt(event.position.x)
      return
    }

    const rowIndex = this._viewport.rowAtY(event.position.y, globalOffset, this._visibleItems.length)
    if (rowIndex < 0) return
    const item = this._visibleItems[rowIndex]
    if (!item) return
    const colIndex = this._viewport.colAtX(event.position.x, globalOffset, this._columns)
    if (colIndex < 0) {
      this.editing.commitEdit()
      this.focusRow(rowIndex, { select: false, scroll: true })
      if (FocusManager.instance.current !== this) this._suppressNextFocusReveal = true
      FocusManager.instance.setFocus(this)
      this._suppressNextFocusReveal = false
      this.markNeedsPaint()
      return
    }
    const editingState = this.editing.state
    if (
      editingState &&
      editingState.row === rowIndex &&
      editingState.col === colIndex
    ) {
      const numberStepper = this.editing.numberStepperDirectionAt(event.position)
      if (numberStepper) {
        if (!this._captureNumberStepper(event)) return
        let handled = false
        let firstError: unknown
        let hasError = false
        try {
          handled = this.editing.handlePointerDownInEditingCell(
            event.position.x,
            event.position.y,
            event,
          )
        } catch (error) {
          firstError = error
          hasError = true
        }
        if (!handled) {
          try {
            this._releasePointerOwner(event, 'number-stepper')
          } catch (error) {
            if (!hasError) {
              firstError = error
              hasError = true
            }
          }
        }
        if (hasError) throw firstError
        if (handled) return
      } else if (
        this.editing.handlePointerDownInEditingCell(
          event.position.x,
          event.position.y,
          event,
        )
      ) {
        this._captureDrag(event)
        return
      }
    }
    this.editing.commitEdit()
    this.focusCell(rowIndex, colIndex, { select: false, scroll: true })
    if (FocusManager.instance.current !== this) this._suppressNextFocusReveal = true
    FocusManager.instance.setFocus(this)
    this._suppressNextFocusReveal = false
    const column = this._columns[colIndex]
    if (!column) return
    if (column.key === this._treeColumnKey) {
      const cellRect = this._viewport.cellGlobalRect(this._columns, globalOffset, rowIndex, colIndex)
      const layout = this._treeCellLayout(item, cellRect.x, cellRect.y, contextTheme(this.currentTheme), tokensFromTheme(this.currentTheme))
      if (layout.arrowHitRect && pointInRect(event.position, layout.arrowHitRect)) {
        this._toggleExpanded(item.node)
        return
      }
      if (this._selectionMode === 'check' && layout.checkboxRect && pointInRect(event.position, layout.checkboxRect)) {
        this._toggleCheckedNode(item.node)
        return
      }
    }

    if (this._selectionMode === 'check') {
      this.markNeedsPaint()
      return
    }

    if (item.node.selectable === false) {
      this.markNeedsPaint()
      return
    }

    this.selectedKey = item.node.key
    this._focusedItemIndex = this._visibleIndexByKey.get(item.node.key) ?? rowIndex
    this.onSelect?.(item.node)
    this.markNeedsPaint()
  }

  onPointerMove(event: PointerEvent): void {
    if (
      this._dragPointerKey !== undefined &&
      this._dragPointerKey !== pointerKey(event)
    ) {
      return
    }
    this.tooltip = undefined
    const globalOffset = this.globalOffset
    if (this.editing.handlePointerMove(event.position.x, event.position.y, event)) {
      return
    }
    if (this._viewport.resizingCol >= 0) {
      event.stopPropagation?.()
      this._viewport.resizeCurrentX = event.position.x
      this.markNeedsPaint()
      return
    }
    if (this._viewport.vScrollbar.dragging) {
      const result = this._viewport.vScrollbarController.updatePointer(
        event.position,
        this._viewport.vScrollbarGeometry(globalOffset, this._visibleItems.length),
        pointerKey(event),
      )
      if (!result.handled) return
      event.stopPropagation?.()
      this._viewport.setScrollY(this._visibleItems.length, result.scrollOffset ?? this._viewport.scrollY)
      this.markNeedsPaint()
      return
    }
    if (this._viewport.hScrollbar.dragging) {
      const result = this._viewport.hScrollbarController.updatePointer(
        event.position,
        this._viewport.hScrollbarGeometry(globalOffset, this._columns),
        pointerKey(event),
      )
      if (!result.handled) return
      event.stopPropagation?.()
      this._viewport.setScrollX(this._columns, result.scrollOffset ?? this._viewport.scrollX)
      this.markNeedsPaint()
      return
    }

    const verticalHoverChanged = this._viewport.vScrollbarController.updateHover(
      event.position,
      this._viewport.vScrollbarGeometry(globalOffset, this._visibleItems.length),
    )
    const horizontalHoverChanged = this._viewport.hScrollbarController.updateHover(
      event.position,
      this._viewport.hScrollbarGeometry(globalOffset, this._columns),
    )
    if (verticalHoverChanged || horizontalHoverChanged) this.markNeedsPaint()
    const hoveredRow = this.hitTest(event.position)
      ? this._viewport.rowAtY(event.position.y, globalOffset, this._visibleItems.length)
      : -1
    if (hoveredRow !== this._hoveredItemIndex) {
      this._hoveredItemIndex = hoveredRow
      this.markNeedsPaint()
    }
    this._syncOverflowTooltip(event.position)
  }

  onPointerUp(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (
      this._dragPointerKey !== undefined &&
      this._dragPointerKey !== pointerKey(event)
    ) {
      return
    }
    const pointerOwnerMode = this._pointerOwnerMode
    const resizedCol = this._viewport.resizingCol
    let resizedWidth: number | null = null
    let firstError: unknown
    let hasError = false
    const attempt = (callback: () => void): void => {
      try {
        callback()
      } catch (error) {
        if (!hasError) {
          firstError = error
          hasError = true
        }
      }
    }

    attempt(() => {
      resizedWidth = resizedCol >= 0
        ? this._resizedColumnWidth(resizedCol, event.position.x)
        : null
    })

    // End the pointer sequence before persisting or notifying layout. Neither
    // a consumer callback nor a render-pipeline failure may strand a resize.
    this._viewport.resizingCol = -1
    this._viewport.resizeCurrentX = 0
    const key = pointerKey(event)
    this._viewport.vScrollbarController.endPointer(
      event.position,
      this._viewport.vScrollbarGeometry(this.globalOffset, this._visibleItems.length),
      key,
    )
    this._viewport.hScrollbarController.endPointer(
      event.position,
      this._viewport.hScrollbarGeometry(this.globalOffset, this._columns),
      key,
    )
    attempt(() => this._releasePointerOwner(event))
    if (pointerOwnerMode === 'number-stepper') {
      attempt(() => {
        this.editing.finishNumberStepperPress(
          event.position.x,
          event.position.y,
          true,
          event,
        )
      })
    }
    attempt(() => this.editing.stopDrag())

    if (resizedCol >= 0 && resizedWidth !== null) {
      const width = resizedWidth
      attempt(() => this._persistResizedColumnWidth(resizedCol, width))
      attempt(() => this.markNeedsLayout())
    }
    if (hasError) throw firstError
  }

  onPointerCancel(event: PointerEvent): void {
    if (
      this._dragPointerKey !== undefined &&
      this._dragPointerKey !== pointerKey(event)
    ) {
      return
    }
    const pointerOwnerMode = this._pointerOwnerMode
    let firstError: unknown
    let hasError = false
    const attempt = (callback: () => void): void => {
      try {
        callback()
      } catch (error) {
        if (!hasError) {
          firstError = error
          hasError = true
        }
      }
    }

    this._viewport.resizingCol = -1
    this._viewport.resizeCurrentX = 0
    const key = pointerKey(event)
    this._viewport.vScrollbarController.cancelPointer(key)
    this._viewport.hScrollbarController.cancelPointer(key)
    this._hoveredItemIndex = -1
    this.tooltip = undefined
    attempt(() => this._releasePointerOwner(event))
    if (pointerOwnerMode === 'number-stepper') {
      attempt(() => this.editing.cancelNumberStepperPress(true, event))
    }
    attempt(() => this.editing.stopDrag())
    if (hasError) throw firstError
  }

  onPointerLeave(event: PointerEvent): void {
    if (
      this._dragPointerKey !== undefined &&
      this._dragPointerKey !== pointerKey(event)
    ) {
      return
    }
    const verticalHoverChanged = this._viewport.vScrollbarController.clearHover()
    const horizontalHoverChanged = this._viewport.hScrollbarController.clearHover()
    const hadHover = this._hoveredItemIndex >= 0 || verticalHoverChanged || horizontalHoverChanged
    this._hoveredItemIndex = -1
    this.tooltip = undefined
    if (hadHover) this.markNeedsPaint()
  }

  onDoubleClick(position: Offset): void {
    if (!this.hitTest(position)) return
    const globalOffset = this.globalOffset
    const rowIndex = this._viewport.rowAtY(position.y, globalOffset, this._visibleItems.length)
    const item = this._visibleItems[rowIndex]
    if (!item) return
    const colIndex = this._viewport.colAtX(position.x, globalOffset, this._columns)
    const column = this._columns[colIndex]
    if (column?.key === this._treeColumnKey) {
      const cellRect = this._viewport.cellGlobalRect(this._columns, globalOffset, rowIndex, colIndex)
      const layout = this._treeCellLayout(item, cellRect.x, cellRect.y, contextTheme(this.currentTheme), tokensFromTheme(this.currentTheme))
      if (layout.arrowHitRect && pointInRect(position, layout.arrowHitRect)) return
    }
    if (item.node.selectable === false && item.hasChildren) {
      this._toggleExpanded(item.node)
      return
    }
    this.focusCell(rowIndex, colIndex, { select: false, scroll: true })
    if (this.editable) {
      const targetCol = colIndex >= 0 && this.structureEditing.canEditColumn(this._columns[colIndex])
        ? colIndex
        : this.structureEditing.firstEditableColumnIndex()
      if (targetCol >= 0) {
        this._focusedColIndex = targetCol
        this.editing.startEdit(rowIndex, targetCol)
        return
      }
    }
    this.onActivate?.(item.node)
    this.markNeedsPaint()
  }

  onWheel(event: WheelPointerEvent): boolean {
    if (!this.hitTest(event.position)) return false
    this.tooltip = undefined
    const canScrollX = this._viewport.canScrollX(this._columns)
    const canScrollY = this._viewport.canScrollY(this._visibleItems.length)
    const beforeX = this._viewport.scrollX
    const beforeY = this._viewport.scrollY
    if (event.deltaX !== 0) {
      this._viewport.setScrollX(this._columns, this._viewport.scrollX + (event.deltaX > 0 ? 60 : -60))
    }
    if (event.deltaY !== 0) {
      this._viewport.setScrollY(this._visibleItems.length, this._viewport.scrollY + (event.deltaY > 0 ? 60 : -60))
    }
    if (beforeX === this._viewport.scrollX && beforeY === this._viewport.scrollY) {
      return (event.deltaX !== 0 && canScrollX) || (event.deltaY !== 0 && canScrollY)
    }
    this.markNeedsPaint()
    return true
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (!this._focused) return false
    if (this.editing.state) return false
    const count = this._visibleItems.length
    if (count === 0) return false

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      if (this._focusedItemIndex < 0) this._focusedItemIndex = delta > 0 ? 0 : count - 1
      else this._focusedItemIndex = Math.max(0, Math.min(count - 1, this._focusedItemIndex + delta))
      this._focusedColIndex = this._normalizeFocusedColumn(this._focusedColIndex)
      if (this._selectionMode === 'single') {
        const focusedItem = this._visibleItems[this._focusedItemIndex]
        if (focusedItem && focusedItem.node.selectable !== false) this._selectedKey = focusedItem.node.key
      }
      this._scrollToFocused()
      this.markNeedsPaint()
      return true
    }

    const item = this._visibleItems[this._focusedItemIndex]
    if (!item) return true

    if (event.key === 'ArrowRight') {
      const nextCol = this._moveFocusedCol(1)
      if (nextCol >= 0 && this._focusedColIndex !== this._treeColumnIndex()) {
        event.preventDefault()
        this._focusedColIndex = nextCol
        this.markNeedsPaint()
        return true
      }
      event.preventDefault()
      if (item.hasChildren && !this._expanded.has(item.node.key)) {
        this._toggleExpanded(item.node)
      } else if (item.hasChildren) {
        const childIndex = this._visibleItems.findIndex((candidate, index) =>
          index > this._focusedItemIndex &&
          candidate.depth === item.depth + 1 &&
          candidate.parentPathKey === item.pathKey,
        )
        if (childIndex >= 0) {
          this._focusedItemIndex = childIndex
          this._scrollToFocused()
          this.markNeedsPaint()
        }
      }
      return true
    }

    if (event.key === 'ArrowLeft') {
      const nextCol = this._moveFocusedCol(-1)
      if (nextCol >= 0 && this._focusedColIndex !== this._treeColumnIndex()) {
        event.preventDefault()
        this._focusedColIndex = nextCol
        this.markNeedsPaint()
        return true
      }
      event.preventDefault()
      if (item.hasChildren && this._expanded.has(item.node.key)) {
        this._toggleExpanded(item.node)
      } else if (item.depth > 0 && item.parentPathKey) {
        const parentIndex = this._visibleIndexByKey.get(item.parentPathKey)
        if (parentIndex !== undefined) {
          this._focusedItemIndex = parentIndex
          this._scrollToFocused()
          this.markNeedsPaint()
        }
      }
      return true
    }

    if (event.key === ' ') {
      const checkboxToggled = this._toggleFocusedCheckboxCell()
      if (checkboxToggled) {
        event.preventDefault()
        return true
      }
      event.preventDefault()
      if (this._selectionMode === 'check') {
        if (item.node.checkable !== false) this._toggleCheckedNode(item.node)
        else if (item.hasChildren) this._toggleExpanded(item.node)
        return true
      }
      if (item.node.selectable === false) {
        if (item.hasChildren) this._toggleExpanded(item.node)
        return true
      }
      this.selectedKey = item.node.key
      this.onSelect?.(item.node)
      this.markNeedsPaint()
      return true
    }

    if (event.key === 'Enter') {
      const checkboxToggled = this._toggleFocusedCheckboxCell()
      if (checkboxToggled) {
        event.preventDefault()
        return true
      }
      event.preventDefault()
      if (this.editable) {
        const targetCol = this._focusedColIndex >= 0 && this.structureEditing.canEditColumn(this._columns[this._focusedColIndex])
          ? this._focusedColIndex
          : this.structureEditing.firstEditableColumnIndex()
        if (targetCol >= 0) {
          this._focusedColIndex = targetCol
          this.editing.startEdit(this._focusedItemIndex, targetCol)
          return true
        }
      }
      if (item.node.selectable === false && item.hasChildren) {
        this._toggleExpanded(item.node)
        return true
      }
      this.onActivate?.(item.node)
      this.markNeedsPaint()
      return true
    }

    if (event.key === 'F2' && this.editable) {
      event.preventDefault()
      const targetCol = this._focusedColIndex >= 0 && this.structureEditing.canEditColumn(this._columns[this._focusedColIndex])
        ? this._focusedColIndex
        : this.structureEditing.firstEditableColumnIndex()
      if (targetCol >= 0) {
        this._focusedColIndex = targetCol
        this.editing.startEdit(this._focusedItemIndex, targetCol)
        return true
      }
    }

    if (event.key === 'Tab') {
      const moved = event.shiftKey
        ? this._moveToPrevEditableCell(this._focusedItemIndex, this._focusedColIndex)
        : this._moveToNextEditableCell(this._focusedItemIndex, this._focusedColIndex)
      if (!moved) return false
      event.preventDefault()
      this.markNeedsPaint()
      return true
    }

    return false
  }

  expandAll(): void {
    const expanded = new Set<string>()
    this._collectExpandableKeys(this._roots, expanded)
    this._expanded = expanded
    this._syncVisibleItems()
    this.markNeedsPaint()
  }

  collapseAll(): void {
    if (this._expanded.size === 0) return
    this._expanded.clear()
    this._syncVisibleItems()
    this.markNeedsPaint()
  }

  revealNode(key: string): void {
    if (!key) return
    this._expandAncestors(key)
    this._syncVisibleItems()
    const index = this._visibleIndexByKey.get(key)
    if (index === undefined) return
    this._viewport.scrollToRow(this._visibleItems.length, index)
    this.markNeedsPaint()
  }

  override dispose(): void {
    this._releasePointerOwner()
    this.editing.dispose()
    this._cellPopupEditors.dispose()
    this._lookupValues.clear()
    FocusManager.instance.unregister(this)
    super.dispose()
  }

  private _paintHeader(
    dl: DrawList,
    x: number,
    y: number,
    viewWidth: number,
    tokens: GridCellStyleTokens,
  ): void {
    dl.fillRect(x, y, viewWidth, this._viewport.headerHeight, resolveBgColor(tokens.headerBgState, 'normal'), 0)

    for (let colIndex = 0; colIndex < this._columns.length; colIndex++) {
      const column = this._columns[colIndex]!
      const columnWidth = this._viewport.colWidths[colIndex] ?? 0
      const columnX = this._viewport.cellX(this._columns, x, colIndex)
      const visibleCell = this._viewport.visibleCellRect(this._columns, x, colIndex)
      const sortable = column.sortable ?? this._sortable
      const showActive = this._sortState.key === column.key && !!this._sortState.order
      if (visibleCell.w <= 0) continue
      const clipX = visibleCell.x
      const clipW = visibleCell.w
      dl.strokeRect(clipX, y, clipW, this._viewport.headerHeight, tokens.separator, 0.5, 0)
      dl.pushClip(clipX, y, clipW, this._viewport.headerHeight)
      if (showActive) dl.fillRect(clipX, y, clipW, this._viewport.headerHeight, resolveBgColor(tokens.headerBgState, 'selected'), 0)

      const textRightInset = sortable ? 18 : tokens.paddingH
      const textClipW = Math.max(0, columnWidth - tokens.paddingH - textRightInset)
      if (textClipW > 0) {
        dl.pushClip(columnX + tokens.paddingH, y, textClipW, this._viewport.headerHeight)
        paintSingleLineText(dl, {
          text: column.title,
          x: columnX + tokens.paddingH,
          y: y + this._viewport.headerHeight / 2,
          maxWidth: textClipW,
          color: resolveTextColor(tokens.headerTextState, showActive ? 'selected' : 'normal'),
          fontSize: tokens.fontSize,
          fontFamily: tokens.fontFamily,
        })
        dl.popClip()
      }

      if (sortable) {
        const arrowX = columnX + columnWidth - tokens.paddingH - 6
        const arrowY = y + this._viewport.headerHeight / 2
        const color = resolveTextColor(tokens.headerArrowText, showActive ? 'selected' : 'normal')
        if (this._sortState.key === column.key) {
          if (this._sortState.order === 'asc') this._drawSortArrow(dl, arrowX, arrowY, 'up', color)
          else if (this._sortState.order === 'desc') this._drawSortArrow(dl, arrowX, arrowY, 'down', color)
        } else {
          this._drawSortArrow(dl, arrowX, arrowY - 3, 'up', color)
          this._drawSortArrow(dl, arrowX, arrowY + 3, 'down', color)
        }
      }
      dl.popClip()
      if (this._viewport.resizingCol === colIndex) {
        const guideX = this._viewport.resizeCurrentX || columnX + columnWidth
        const separatorX = Math.max(x, Math.min(x + viewWidth, guideX))
        dl.line(separatorX, y, separatorX, y + this._viewport.headerHeight, tokens.resizeActiveColor, 2)
      }
    }

    const fixedWidth = this._viewport.fixedRegionWidth(this._columns)
    if (fixedWidth > 0 && fixedWidth < viewWidth) {
      dl.line(x + fixedWidth, y, x + fixedWidth, y + this._viewport.headerHeight, tokens.separator, 1)
    }
    dl.line(x, y + this._viewport.headerHeight, x + viewWidth, y + this._viewport.headerHeight, tokens.separator, 1)
  }

  private _paintRows(
    context: PaintContext,
    dl: DrawList,
    x: number,
    bodyY: number,
    viewWidth: number,
    theme: ResolvedTheme,
    tokens: GridCellStyleTokens,
  ): void {
    const virtualRange = this._viewport.visibleVirtualRange(this._visibleItems.length)
    if (virtualRange.startIndex < 0) return
    const treeTokens = deriveTreeStyle(theme)
    const checkboxTokens = deriveCheckboxStyle(theme)

    for (let itemIndex = virtualRange.startIndex; itemIndex <= virtualRange.endIndex; itemIndex++) {
      const item = this._visibleItems[itemIndex]!
      const rowY = bodyY + itemIndex * this._viewport.rowHeight - this._viewport.scrollY
      const isSelected = this._selectionMode === 'single' && item.node.key === this._selectedKey
      const isHovered = this._hoveredItemIndex === itemIndex
      const isFocused = this._focused && this._focusedItemIndex === itemIndex
      const isEditingRow = this.editing.state?.row === item.dataRowIndex
      const rowPresentation = this._resolveRowPresentation(itemIndex, item, isSelected, isHovered, isFocused, isEditingRow, tokens)
      if (rowPresentation.backgroundColor) dl.fillRect(x, rowY, viewWidth, this._viewport.rowHeight, rowPresentation.backgroundColor, 0)
      if (rowPresentation.borderColor) dl.strokeRect(x + 1, rowY + 1, viewWidth - 2, this._viewport.rowHeight - 2, rowPresentation.borderColor, 1, 0)

      for (let colIndex = 0; colIndex < this._columns.length; colIndex++) {
        const column = this._columns[colIndex]!
        const columnWidth = this._viewport.colWidths[colIndex] ?? 0
        const columnX = this._viewport.cellX(this._columns, x, colIndex)
        const visibleCell = this._viewport.visibleCellRect(this._columns, x, colIndex)
        if (visibleCell.w <= 0) continue

        const clipX = visibleCell.x
        const clipW = visibleCell.w
        dl.strokeRect(clipX, rowY, clipW, this._viewport.rowHeight, tokens.separator, 0.5, 0)
        const isEditingCell = this.editing.state?.row === item.dataRowIndex && this.editing.state?.col === colIndex
        const isFocusedCell = isFocused && this._focusedColIndex === colIndex
        const cellPresentation = this._resolveCellPresentation(itemIndex, item, colIndex, rowPresentation, isEditingCell, tokens)
        if (cellPresentation.backgroundColor) dl.fillRect(clipX, rowY, clipW, this._viewport.rowHeight, cellPresentation.backgroundColor, 0)
        if (cellPresentation.borderColor) dl.strokeRect(clipX + 1, rowY + 1, clipW - 2, this._viewport.rowHeight - 2, cellPresentation.borderColor, 1, 0)

        dl.pushClip(clipX, rowY, clipW, this._viewport.rowHeight)
        if (isEditingCell) {
          this._paintEditingCell(context, dl, item, rowY, colIndex, columnX, columnWidth, cellPresentation, tokens)
        } else if (column.key === this._treeColumnKey) {
          const layout = this._treeCellLayout(item, columnX, rowY, theme, tokens)
          if (item.hasChildren) {
            this._drawExpandArrow(dl, layout.arrowCenterX, rowY + this._viewport.rowHeight / 2, item.expanded, treeTokens)
          }
          if (layout.checkboxRect && this._selectionMode === 'check') {
            const fullyChecked = this._fullyCheckedKeys.has(item.node.key)
            const halfChecked = !fullyChecked && this._halfCheckedKeys.has(item.node.key)
            const checkboxState = isHovered ? 'hovered' : 'normal'
            const bg = fullyChecked || halfChecked
              ? resolveBgColor(checkboxTokens.checkedBoxBg, checkboxState)
              : resolveBgColor(checkboxTokens.boxBg, checkboxState)
            dl.fillRect(
              layout.checkboxRect.x,
              layout.checkboxRect.y,
              layout.checkboxRect.w,
              layout.checkboxRect.h,
              bg,
              checkboxTokens.borderRadius,
            )
            dl.strokeRect(
              layout.checkboxRect.x,
              layout.checkboxRect.y,
              layout.checkboxRect.w,
              layout.checkboxRect.h,
              resolveBgColor(checkboxTokens.boxBorder, checkboxState),
              1,
              checkboxTokens.borderRadius,
            )
            if (fullyChecked) {
              dl.drawCheckmark(
                layout.checkboxRect.x,
                layout.checkboxRect.y,
                layout.checkboxRect.w,
                resolveTextColor(checkboxTokens.checkMark, checkboxState),
                2,
              )
            } else if (halfChecked) {
              const pad = layout.checkboxRect.w * 0.25
              const midY = layout.checkboxRect.y + layout.checkboxRect.h / 2
              dl.line(
                layout.checkboxRect.x + pad,
                midY,
                layout.checkboxRect.x + layout.checkboxRect.w - pad,
                midY,
                resolveTextColor(checkboxTokens.checkMark, checkboxState),
                2,
              )
            }
          }
          if (item.node.icon) {
            this._paintNodeIcon(
              context,
              dl,
              item.node.icon,
              layout.iconX,
              rowY + this._viewport.rowHeight / 2,
              cellPresentation.textColor,
              cellPresentation.fontSize,
              cellPresentation.fontFamily,
            )
          }
          const textWidth = Math.max(0, columnWidth - (layout.textX - columnX) - tokens.paddingH)
          const paintText = this._resolvePaintText(
            cellPresentation.displayText,
            column.cellTextOverflow ?? this._cellTextOverflow,
            textWidth,
            cellPresentation.fontSize,
            cellPresentation.fontFamily,
          )
          dl.pushClip(layout.textX, rowY, textWidth, this._viewport.rowHeight)
          dl.fillText(
            paintText,
            layout.textX,
            rowY + this._viewport.rowHeight / 2,
            cellPresentation.textColor,
            cellPresentation.fontSize,
            cellPresentation.fontFamily,
            'left',
            'middle',
          )
          dl.popClip()
        } else {
          const align = cellPresentation.align
          let textX = columnX + tokens.paddingH
          if (align === 'center') textX = columnX + columnWidth / 2
          else if (align === 'right') textX = columnX + columnWidth - tokens.paddingH
          const clipInnerX = columnX + tokens.paddingH
          const clipInnerW = Math.max(0, columnWidth - tokens.paddingH * 2)
          const paintText = this._resolvePaintText(
            cellPresentation.displayText,
            column.cellTextOverflow ?? this._cellTextOverflow,
            clipInnerW,
            cellPresentation.fontSize,
            cellPresentation.fontFamily,
          )
          dl.pushClip(clipInnerX, rowY, clipInnerW, this._viewport.rowHeight)
          dl.fillText(
            paintText,
            textX,
            rowY + this._viewport.rowHeight / 2,
            cellPresentation.textColor,
            cellPresentation.fontSize,
            cellPresentation.fontFamily,
            align,
            'middle',
          )
          dl.popClip()
        }
        dl.popClip()
        if (isFocusedCell && !isEditingCell) {
          const borderX = clipX + 1
          const borderW = Math.max(0, clipW - 2)
          if (borderW > 0) {
            dl.strokeRect(
              borderX,
              rowY + 1,
              borderW,
              this._viewport.rowHeight - 2,
              tokens.focusedRowBorder,
              1.5,
              0,
            )
          }
        }
      }
    }
  }

  private _paintScrollbars(
    dl: DrawList,
    x: number,
    y: number,
    bodyY: number,
    bodyHeight: number,
    scrollbarWidth: number,
    scrollbarTokens: ScrollbarStyleTokens,
  ): void {
    paintVBar({
      dl,
      style: scrollbarTokens,
      trackX: x + this._viewport.viewWidth,
      trackY: bodyY,
      trackW: scrollbarWidth,
      trackH: bodyHeight,
      viewSize: this._viewport.viewHeight,
      contentSize: this._viewport.totalContentHeight(this._visibleItems.length),
      scrollOffset: this._viewport.scrollY,
      state: this._viewport.vScrollbar,
    })
    const scrollableViewWidth = this._viewport.scrollableViewWidth(this._columns)
    if (scrollableViewWidth > 0) {
      paintHBar({
        dl,
        style: scrollbarTokens,
        trackX: x + this._viewport.fixedRegionWidth(this._columns),
        trackY: y + this._viewport.headerHeight + this._viewport.viewHeight,
        trackW: scrollableViewWidth,
        trackH: scrollbarWidth,
        viewSize: scrollableViewWidth,
        contentSize: this._viewport.scrollableContentWidth(this._columns),
        scrollOffset: this._viewport.scrollX,
        state: this._viewport.hScrollbar,
      })
    }
  }

  private _resolveRowPresentation(
    itemIndex: number,
    item: TreeGridVisibleNodeItem<T>,
    selected: boolean,
    hovered: boolean,
    focused: boolean,
    editing: boolean,
    tokens: GridCellStyleTokens,
  ): TreeGridRowPresentation<T> {
    let backgroundColor: TreeGridRowPresentation<T>['backgroundColor'] = null
    if (selected || hovered) {
      backgroundColor = resolveBgColor(tokens.rowBgState, {
        selected,
        hovered,
        focused,
      })
    }
    else if (item.dataRowIndex % 2 === 1) backgroundColor = tokens.stripeBg
    const baseArgs: TreeGridRowStyleArgs<T> = {
      node: item.node,
      row: item.row,
      theme: this.currentTheme,
      backgroundColor: backgroundColor ?? tokens.windowBg,
      rowIndex: item.dataRowIndex,
      sourceRowIndex: item.sourceIndex,
      itemIndex,
      selected,
      hovered,
      focused,
      editing,
    }
    const override = this._resolveRowStyle?.(baseArgs) ?? null
    const resolvedBackgroundColor = override?.backgroundColor ?? backgroundColor
    const args: TreeGridRowStyleArgs<T> = {
      ...baseArgs,
      backgroundColor: resolvedBackgroundColor ?? tokens.windowBg,
    }
    return {
      args,
      override,
      backgroundColor: resolvedBackgroundColor,
      textColor: override?.textColor ?? resolveTextColor(tokens.cellTextState, {
        selected,
        hovered,
        focused,
      }),
      borderColor: override?.borderColor ?? null,
      fontSize: override?.fontSize ?? tokens.fontSize,
      fontFamily: override?.fontFamily ?? tokens.fontFamily,
    }
  }

  private _resolveCellPresentation(
    itemIndex: number,
    item: TreeGridVisibleNodeItem<T>,
    colIndex: number,
    rowPresentation: TreeGridRowPresentation<T>,
    editing: boolean,
    tokens: GridCellStyleTokens,
  ): TreeGridCellPresentation<T> {
    const column = this._columns[colIndex]!
    const value = (item.row as any)[column.key]
    const defaultDisplayText = defaultGridCellDisplayText(
      column,
      item.row,
      item.dataRowIndex,
      this._lookupValues,
    )
    const baseCellBackground = editing
      ? resolveBgColor(tokens.editBgState, 'focused')
      : rowPresentation.backgroundColor ?? tokens.windowBg
    const baseArgs: TreeGridCellStyleArgs<T> = {
      ...rowPresentation.args,
      backgroundColor: baseCellBackground,
      value,
      column,
      colIndex,
      editing,
    }
    const displayText = this._getCellDisplayText?.({
      ...baseArgs,
      defaultDisplayText,
    }) ?? defaultDisplayText
    const override = this._resolveCellStyle?.(baseArgs) ?? null
    const backgroundColor = override?.backgroundColor ?? (editing ? resolveBgColor(tokens.editBgState, 'focused') : null)
    const args: TreeGridCellStyleArgs<T> = {
      ...baseArgs,
      backgroundColor: backgroundColor ?? rowPresentation.backgroundColor ?? tokens.windowBg,
    }
    return {
      args,
      displayText,
      backgroundColor,
      textColor: override?.textColor ??
        (column.type === 'custom' && column.renderColor && rowPresentation.override?.textColor === undefined
          ? column.renderColor(value, item.row, {
            theme: this.currentTheme,
            backgroundColor: args.backgroundColor,
            columnKey: column.key,
            columnIndex: colIndex,
            selected: args.selected,
            hovered: args.hovered,
            focused: args.focused,
            editing: args.editing,
          })
          : rowPresentation.textColor),
      borderColor: override?.borderColor ?? (editing ? resolveBgColor(tokens.editBorderState, 'focused') : null),
      fontSize: override?.fontSize ?? rowPresentation.fontSize,
      fontFamily: override?.fontFamily ?? rowPresentation.fontFamily,
      align: override?.align ?? column.align ?? 'left',
    }
  }

  private _treeCellLayout(
    item: TreeGridVisibleNodeItem<T>,
    columnX: number,
    rowY: number,
    theme: ResolvedTheme,
    tokens: GridCellStyleTokens,
  ): TreeCellLayout {
    const treeTokens = deriveTreeStyle(theme)
    const checkboxTokens = deriveCheckboxStyle(theme)
    const indentWidth = treeTokens.fontSize + 4
    const baseX = columnX + tokens.paddingH + item.depth * indentWidth
    const arrowCenterX = baseX + 6
    const arrowHitRect = item.hasChildren
      ? { x: baseX, y: rowY, w: indentWidth, h: this._viewport.rowHeight }
      : null
    let cursorX = baseX + (item.hasChildren ? indentWidth : indentWidth * 0.5)
    let checkboxRect: TreeCellLayout['checkboxRect'] = null
    if (this._selectionMode === 'check' && item.node.checkable !== false) {
      const checkboxSize = Math.min(checkboxTokens.boxSize, this._viewport.rowHeight - 6)
      checkboxRect = {
        x: cursorX,
        y: rowY + (this._viewport.rowHeight - checkboxSize) / 2,
        w: checkboxSize,
        h: checkboxSize,
      }
      cursorX += checkboxSize + Math.max(4, Math.round(treeTokens.paddingH * 0.75))
    }
    const iconX = cursorX
    const textX = item.node.icon ? iconX + treeTokens.fontSize + 4 : cursorX
    return {
      arrowCenterX,
      arrowHitRect,
      checkboxRect,
      iconX,
      textX,
    }
  }

  private _resolvePaintText(
    text: string,
    overflow: GridCellTextOverflow,
    maxWidth: number,
    fontSize: number,
    fontFamily: string,
  ): string {
    if (overflow !== 'ellipsis') return text
    return ellipsizeText(text, maxWidth, value => TextMeasurer.measureWidth(value, fontSize, fontFamily))
  }

  private _syncOverflowTooltip(position: Offset): void {
    this.tooltip = undefined
    const itemIndex = this._viewport.rowAtY(position.y, this.globalOffset, this._visibleItems.length)
    if (itemIndex < 0) return
    const item = this._visibleItems[itemIndex]
    if (!item) return
    const colIndex = this._viewport.colAtX(position.x, this.globalOffset, this._columns)
    const column = this._columns[colIndex]
    if (!column || column.type === 'checkbox') return

    const tokens = deriveGridCellStyle(this.currentTheme)
    const rowPresentation = this._resolveRowPresentation(
      itemIndex,
      item,
      this._selectionMode === 'single' && item.node.key === this._selectedKey,
      this._hoveredItemIndex === itemIndex,
      this._focused && this._focusedItemIndex === itemIndex,
      this.editing.state?.row === itemIndex,
      tokens,
    )
    const cellPresentation = this._resolveCellPresentation(
      itemIndex,
      item,
      colIndex,
      rowPresentation,
      this.editing.state?.row === itemIndex && this.editing.state?.col === colIndex,
      tokens,
    )
    const text = cellPresentation.displayText
    if (!text) return

    const columnX = this._viewport.cellX(this._columns, this.globalOffset.x, colIndex)
    const columnWidth = this._viewport.colWidths[colIndex] ?? column.width ?? 0
    const availableWidth = column.key === this._treeColumnKey
      ? Math.max(0, columnWidth - (this._treeCellLayout(item, columnX, 0, this.currentTheme, tokens).textX - columnX) - tokens.paddingH)
      : Math.max(0, columnWidth - tokens.paddingH * 2)
    if (TextMeasurer.measureWidth(text, cellPresentation.fontSize, cellPresentation.fontFamily) > availableWidth) {
      this.tooltip = text
    }
  }

  private _paintEditingCell(
    context: PaintContext,
    dl: DrawList,
    item: TreeGridVisibleNodeItem<T>,
    rowY: number,
    colIndex: number,
    columnX: number,
    columnWidth: number,
    presentation: TreeGridCellPresentation<T>,
    tokens: GridCellStyleTokens,
  ): void {
    const edit = this.editing.state
    if (!edit) return
    const column = this._columns[colIndex]
    if (!column) return
    const editorKind = resolveGridColumnEditorKind(column)
    if (editorKind === 'checkbox') return
    if (editorKind === 'text' || editorKind === 'number' || editorKind === 'time') {
      const textX = columnX + tokens.paddingH - this.editing.input.scrollX
      paintSingleLineEditableText({
        dl,
        controller: this.editing.input,
        displayText: edit.text,
        measureText: text => TextMeasurer.measureWidth(text, presentation.fontSize, presentation.fontFamily),
        fontSize: presentation.fontSize,
        fontFamily: presentation.fontFamily,
        textX,
        textY: rowY + this._viewport.rowHeight / 2,
        lineTop: rowY + 4,
        lineBottom: rowY + this._viewport.rowHeight - 4,
        textColor: presentation.textColor,
        selectionBg: tokens.selectionBg,
        caretColor: presentation.textColor,
        compositionTextColor: { ...presentation.textColor, a: 0.6 },
        compositionUnderlineColor: presentation.textColor,
      })
      return
    }

    if (column.key === this._treeColumnKey) {
      const layout = this._treeCellLayout(item, columnX, rowY, contextTheme(this.currentTheme), tokensFromTheme(this.currentTheme))
      if (item.node.icon) {
        this._paintNodeIcon(
          context,
          dl,
          item.node.icon,
          layout.iconX,
          rowY + this._viewport.rowHeight / 2,
          presentation.textColor,
          presentation.fontSize,
          presentation.fontFamily,
        )
      }
      const textWidth = Math.max(0, columnWidth - (layout.textX - columnX) - tokens.paddingH - 12)
      const paintText = this._resolvePaintText(
        presentation.displayText,
        column.cellTextOverflow ?? this._cellTextOverflow,
        textWidth,
        presentation.fontSize,
        presentation.fontFamily,
      )
      dl.pushClip(layout.textX, rowY, textWidth, this._viewport.rowHeight)
      dl.fillText(
        paintText,
        layout.textX,
        rowY + this._viewport.rowHeight / 2,
        presentation.textColor,
        presentation.fontSize,
        presentation.fontFamily,
        'left',
        'middle',
      )
      dl.popClip()
    } else {
      const align = presentation.align
      let textX = columnX + tokens.paddingH
      if (align === 'center') textX = columnX + columnWidth / 2
      else if (align === 'right') textX = columnX + columnWidth - tokens.paddingH
      const textWidth = Math.max(0, columnWidth - tokens.paddingH * 2 - 12)
      const paintText = this._resolvePaintText(
        presentation.displayText,
        column.cellTextOverflow ?? this._cellTextOverflow,
        textWidth,
        presentation.fontSize,
        presentation.fontFamily,
      )
      dl.pushClip(columnX + tokens.paddingH, rowY, textWidth, this._viewport.rowHeight)
      dl.fillText(
        paintText,
        textX,
        rowY + this._viewport.rowHeight / 2,
        presentation.textColor,
        presentation.fontSize,
        presentation.fontFamily,
        align,
        'middle',
      )
      dl.popClip()
    }

    const iconSize = tokens.fontSize * 0.8
    const arrowX = columnX + columnWidth - tokens.paddingH - tokens.fontSize / 2
    paintIconGlyph(context, {
      name: 'chevron-down',
      x: arrowX - iconSize / 2,
      y: rowY + (this._viewport.rowHeight - iconSize) / 2,
      size: iconSize,
      color: resolveTextColor(tokens.dropdownArrowText, 'normal'),
    })
  }

  private _paintNodeIcon(
    context: PaintContext,
    dl: DrawList,
    icon: string,
    x: number,
    centerY: number,
    color: Color,
    size: number,
    fontFamily: string,
  ): void {
    if (isIconName(icon)) {
      paintIconGlyph(context, {
        name: icon,
        x,
        y: centerY - size / 2,
        size,
        color,
      })
      return
    }
    dl.fillText(icon, x, centerY, color, size, fontFamily, 'left', 'middle')
  }

  private _drawSortArrow(
    dl: DrawList,
    x: number,
    y: number,
    direction: 'up' | 'down',
    color: { r: number; g: number; b: number; a: number },
  ): void {
    const ctx = (dl as any).ctx as CanvasRenderingContext2D
    ctx.save()
    ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a})`
    ctx.beginPath()
    if (direction === 'up') {
      ctx.moveTo(x, y - 3)
      ctx.lineTo(x - 4, y + 2)
      ctx.lineTo(x + 4, y + 2)
    } else {
      ctx.moveTo(x, y + 3)
      ctx.lineTo(x - 4, y - 2)
      ctx.lineTo(x + 4, y - 2)
    }
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  private _drawExpandArrow(
    dl: DrawList,
    x: number,
    y: number,
    expanded: boolean,
    style: TreeStyleTokens,
  ): void {
    const size = style.fontSize * 0.5
    const color = resolveTextColor(style.arrowText, 'normal')
    const ctx = (dl as any).ctx as CanvasRenderingContext2D
    ctx.save()
    ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a})`
    ctx.beginPath()
    if (expanded) {
      ctx.moveTo(x - size, y - size * 0.5)
      ctx.lineTo(x + size, y - size * 0.5)
      ctx.lineTo(x, y + size * 0.5)
    } else {
      ctx.moveTo(x - size * 0.5, y - size)
      ctx.lineTo(x + size * 0.5, y)
      ctx.lineTo(x - size * 0.5, y + size)
    }
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  private _toggleSortAt(globalX: number): void {
    const colIndex = this._viewport.colAtX(globalX, this.globalOffset, this._columns)
    if (colIndex < 0) return
    const column = this._columns[colIndex]
    if (!column) return
    if (!(column?.sortable ?? this._sortable)) return
    const key = column.key
    const current = this._sortState.key === key ? this._sortState.order : null
    const nextOrder: GridSortOrder = current === 'asc' ? 'desc' : current === 'desc' ? null : 'asc'
    this.sortState = { key: nextOrder ? key : '', order: nextOrder }
  }

  private _toggleExpanded(node: TreeGridNode<T>): void {
    if (this._expanded.has(node.key)) this._expanded.delete(node.key)
    else this._expanded.add(node.key)
    this._syncVisibleItems()
    const nextIndex = this._visibleIndexByKey.get(node.key)
    if (nextIndex !== undefined) this._focusedItemIndex = nextIndex
    this.onExpand?.(node, this._expanded.has(node.key))
    this.markNeedsPaint()
  }

  private _toggleCheckedNode(node: TreeGridNode<T>): void {
    const targetKeys = this._checkTargetKeys(node)
    if (targetKeys.length === 0) return
    const shouldCheck = targetKeys.some(key => !this._checkedLeafKeys.has(key))
    for (const key of targetKeys) {
      if (shouldCheck) this._checkedLeafKeys.add(key)
      else this._checkedLeafKeys.delete(key)
    }
    this._recomputeCheckState()
    this.onCheck?.({
      checkedKeys: [...this._checkedLeafKeys],
      halfCheckedKeys: [...this._halfCheckedKeys],
      checkedNodes: this._resolveNodes([...this._checkedLeafKeys]),
      halfCheckedNodes: this._resolveNodes([...this._halfCheckedKeys]),
      toggledNode: node,
    })
    this.markNeedsPaint()
  }

  private _checkTargetKeys(node: TreeGridNode<T>): string[] {
    const childTargets = (node.children ?? []).flatMap(child => this._checkTargetKeys(child))
    if (childTargets.length > 0) return childTargets
    return node.checkable !== false ? [node.key] : []
  }

  private _resolveNodes(keys: readonly string[]): TreeGridNode<T>[] {
    return keys
      .map(key => this._findNodeByKey(this._roots, key))
      .filter((node): node is TreeGridNode<T> => node !== null)
  }

  private _findNodeByKey(nodes: readonly TreeGridNode<T>[], key: string): TreeGridNode<T> | null {
    for (const node of nodes) {
      if (node.key === key) return node
      const child = node.children ? this._findNodeByKey(node.children, key) : null
      if (child) return child
    }
    return null
  }

  private _findNodeByRow(nodes: readonly TreeGridNode<T>[], row: T): TreeGridNode<T> | null {
    for (const node of nodes) {
      if (node.row === row) return node
      const child = node.children ? this._findNodeByRow(node.children, row) : null
      if (child) return child
    }
    return null
  }

  private _findNodeByIdentity(nodes: readonly TreeGridNode<T>[], target: object): TreeGridNode<T> | null {
    for (const node of nodes) {
      if (node === target) return node
      const child = node.children ? this._findNodeByIdentity(node.children, target) : null
      if (child) return child
    }
    return null
  }

  private _findParentKey(targetKey: string): string | null {
    const visit = (nodes: readonly TreeGridNode<T>[], parentKey: string | null): string | null => {
      for (const node of nodes) {
        if (node.key === targetKey) return parentKey
        const found = node.children ? visit(node.children, node.key) : null
        if (found !== null) return found
      }
      return null
    }
    return visit(this._roots, null)
  }

  private _expandAncestors(key: string): void {
    let cursor = this._findParentKey(key)
    while (cursor) {
      this._expanded.add(cursor)
      cursor = this._findParentKey(cursor)
    }
  }

  private _collectExpandableKeys(nodes: readonly TreeGridNode<T>[], target: Set<string>): void {
    for (const node of nodes) {
      if (node.children?.length) {
        target.add(node.key)
        this._collectExpandableKeys(node.children, target)
      }
    }
  }

  private _pruneExpandedState(): void {
    const validKeys = new Set<string>()
    this._collectAllKeys(this._roots, validKeys)
    this._expanded = new Set([...this._expanded].filter(key => validKeys.has(key)))
    if (this._selectedKey && !validKeys.has(this._selectedKey)) this._selectedKey = ''
  }

  private _collectAllKeys(nodes: readonly TreeGridNode<T>[], target: Set<string>): void {
    for (const node of nodes) {
      target.add(node.key)
      if (node.children?.length) this._collectAllKeys(node.children, target)
    }
  }

  private _reindexSourceNodes(): void {
    this._sourceIndexByKey.clear()
    let index = 0
    const visit = (nodes: readonly TreeGridNode<T>[]): void => {
      for (const node of nodes) {
        this._sourceIndexByKey.set(node.key, index++)
        if (node.children?.length) visit(node.children)
      }
    }
    visit(this._roots)
  }

  private _syncVisibleItems(): void {
    const filteredRoots = this._filteredRoots(this._roots)
    const nextVisible: TreeGridVisibleNodeItem<T>[] = []
    this._visibleIndexByKey.clear()
    const filterActive = this._hasActiveFilter()
    const flatten = (
      nodes: readonly FilteredTreeGridNode<T>[],
      depth: number,
      parentPathKey: string | null,
    ): void => {
      for (const filtered of nodes) {
        const sourceIndex = this._sourceIndexByKey.get(filtered.node.key) ?? nextVisible.length
        const item: TreeGridVisibleNodeItem<T> = {
          kind: 'data',
          depth,
          pathKey: filtered.node.key,
          parentPathKey,
          row: filtered.node.row,
          sourceIndex,
          dataRowIndex: nextVisible.length,
          node: filtered.node,
          hasChildren: filtered.children.length > 0,
          expanded: filterActive || this._expanded.has(filtered.node.key),
        }
        this._visibleIndexByKey.set(filtered.node.key, item.dataRowIndex)
        nextVisible.push(item)
        if (filtered.children.length > 0 && item.expanded) flatten(filtered.children, depth + 1, filtered.node.key)
      }
    }
    flatten(filteredRoots, 0, null)
    this._visibleItems = nextVisible
    if (this._hoveredItemIndex >= nextVisible.length) this._hoveredItemIndex = -1
    if (this._focusedItemIndex >= nextVisible.length) this._focusedItemIndex = nextVisible.length - 1
    this.editing?.handleVisibleRowsChanged(nextVisible.length)
    this._viewport.clampScrollOffsets(this._columns, nextVisible.length)
    this.markNeedsLayout()
  }

  private _filteredRoots(nodes: readonly TreeGridNode<T>[]): FilteredTreeGridNode<T>[] {
    const filterActive = this._hasActiveFilter()
    const sortedNodes = this._sortNodes(nodes)
    const result: FilteredTreeGridNode<T>[] = []
    for (const node of sortedNodes) {
      const filteredChildren = node.children?.length ? this._filteredRoots(node.children) : []
      const selfMatch = !filterActive || this._matchesAllFilters(node)
      if (!filterActive || selfMatch || filteredChildren.length > 0) {
        result.push({ node, children: filteredChildren })
      }
    }
    return result
  }

  private _matchesAllFilters(node: TreeGridNode<T>): boolean {
    for (const [key, value] of this._filterValues) {
      const query = value.trim().toLowerCase()
      if (!query) continue
      const column = this._columns.find(entry => entry.key === key)
      if (!column) continue
      const displayText = this._displayTextForColumn(node, column)
      if (!displayText.toLowerCase().includes(query)) return false
    }
    return true
  }

  private _hasActiveFilter(): boolean {
    for (const value of this._filterValues.values()) {
      if (value.trim()) return true
    }
    return false
  }

  private _sortNodes(nodes: readonly TreeGridNode<T>[]): TreeGridNode<T>[] {
    if (!this._sortState.key || !this._sortState.order) return [...nodes]
    const column = this._columns.find(entry => entry.key === this._sortState.key)
    if (!column) return [...nodes]
    const sorted = [...nodes]
    sorted.sort((left, right) => {
      const compared = this._compareValues(
        column,
        (left.row as any)[column.key],
        (right.row as any)[column.key],
      )
      if (compared !== 0) return this._sortState.order === 'desc' ? -compared : compared
      const leftIndex = this._sourceIndexByKey.get(left.key) ?? 0
      const rightIndex = this._sourceIndexByKey.get(right.key) ?? 0
      return leftIndex - rightIndex
    })
    return sorted
  }

  private _compareValues(
    column: GridColumnDef<T>,
    left: unknown,
    right: unknown,
  ): number {
    if (left == null && right == null) return 0
    if (left == null) return -1
    if (right == null) return 1
    if (column.type === 'time') {
      const leftComparable = gridFilterComparableValue(column, left)
      const rightComparable = gridFilterComparableValue(column, right)
      if (leftComparable !== null && rightComparable !== null) {
        return leftComparable - rightComparable
      }
    }
    if (typeof left === 'number' && typeof right === 'number') return left - right
    if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
    return String(left).localeCompare(String(right), 'zh-CN', { numeric: true, sensitivity: 'base' })
  }

  private _normalizeSortState(sortState: GridSortState): GridSortState {
    if (!sortState.key || !sortState.order) return { key: '', order: null }
    if (!this._columns.some(column => column.key === sortState.key && (column.sortable ?? this._sortable))) {
      return { key: '', order: null }
    }
    return { key: sortState.key, order: sortState.order }
  }

  private _resolveTreeColumnKey(candidate: keyof T & string): keyof T & string {
    if (this._columns.some(column => column.key === candidate)) return candidate
    return (this._columns[0]?.key ?? candidate) as keyof T & string
  }

  private _displayTextForColumn(node: TreeGridNode<T>, column: GridColumnDef<T>): string {
    const sourceIndex = this._sourceIndexByKey.get(node.key) ?? 0
    const defaultDisplayText = defaultGridCellDisplayText(
      column,
      node.row,
      sourceIndex,
      this._lookupValues,
    )
    const tokens = deriveGridCellStyle(this.currentTheme)
    return this._getCellDisplayText?.({
      node,
      row: node.row,
      theme: this.currentTheme,
      backgroundColor: tokens.windowBg,
      rowIndex: sourceIndex,
      sourceRowIndex: sourceIndex,
      itemIndex: -1,
      selected: false,
      hovered: false,
      focused: false,
      editing: false,
      value: (node.row as any)[column.key],
      column,
      colIndex: this._columns.findIndex(entry => entry.key === column.key),
      defaultDisplayText,
    }) ?? defaultDisplayText
  }

  private _isSelectableKey(key: string): boolean {
    const node = this._findNodeByKey(this._roots, key)
    return !!node && node.selectable !== false
  }

  private _selectedVisibleItem(): TreeGridVisibleNodeItem<T> | null {
    if (!this._selectedKey) return null
    const index = this._visibleIndexByKey.get(this._selectedKey)
    return index === undefined ? null : this._visibleItems[index] ?? null
  }

  private _resolveColumnIndex(column: (keyof T & string) | number): number {
    if (typeof column === 'number') {
      if (!Number.isFinite(column)) return -1
      const index = Math.floor(column)
      return index >= 0 && index < this._columns.length ? index : -1
    }
    return this._columns.findIndex(entry => entry.key === column)
  }

  private _resolveVisibleItemIndex(row: TreeGridNodeInput<T>): number {
    if (row === null) return -1
    if (typeof row === 'number') {
      if (!Number.isFinite(row)) return -1
      const index = Math.floor(row)
      return index >= 0 && index < this._visibleItems.length ? index : -1
    }
    if (typeof row === 'string') return this._visibleIndexByKey.get(row) ?? -1
    const nodeIndex = this._visibleItems.findIndex(item => item.node === row)
    if (nodeIndex >= 0) return nodeIndex
    const rowIndex = this._visibleItems.findIndex(item => item.row === row)
    if (rowIndex >= 0) return rowIndex
    const nodeKey = this._nodeKeyOf(row)
    return nodeKey ? this._visibleIndexByKey.get(nodeKey) ?? -1 : -1
  }

  private _resolveNode(row: TreeGridNodeInput<T>): TreeGridNode<T> | null {
    if (row === null) return null
    if (typeof row === 'number') return this._visibleItems[this._resolveVisibleItemIndex(row)]?.node ?? null
    if (typeof row === 'string') return this._findNodeByKey(this._roots, row)
    const node = this._findNodeByIdentity(this._roots, row)
    if (node) return node
    const rowNode = this._findNodeByRow(this._roots, row as T)
    if (rowNode) return rowNode
    const nodeKey = this._nodeKeyOf(row)
    return nodeKey ? this._findNodeByKey(this._roots, nodeKey) : null
  }

  private _nodeKeyOf(value: unknown): string | null {
    if (value &&
      typeof value === 'object' &&
      typeof (value as TreeGridNode<T>).key === 'string' &&
      typeof (value as TreeGridNode<T>).row === 'object' &&
      (value as TreeGridNode<T>).row !== null
    ) {
      return (value as TreeGridNode<T>).key
    }
    return null
  }

  private _setNodeCellValue(node: TreeGridNode<T>, key: keyof T & string, value: any): boolean {
    const column = this._columns.find(entry => entry.key === key)
    if (column && !this.structureEditing.canEditColumn(column)) return false
    if (!column && !(key in node.row)) return false
    const originalValue = (node.row as any)[key]
    const nextValue = column ? this.structureEditing.normalizeValue(column, value, originalValue) : value
    if (Object.is(originalValue, nextValue)) return false
    ;(node.row as any)[key] = nextValue
    this.onCellChange?.(node, key, nextValue)
    this._syncVisibleItems()
    this._syncEditingViewportState()
    this.markNeedsPaint()
    return true
  }

  private _scrollToFocused(): void {
    if (this._focusedItemIndex < 0) return
    this._viewport.scrollToRow(this._visibleItems.length, this._focusedItemIndex)
  }

  private _defaultFocusedColumnIndex(): number {
    const firstEditable = this.structureEditing.firstEditableColumnIndex()
    if (firstEditable >= 0) return firstEditable
    return this._columns.length > 0 ? 0 : -1
  }

  private _normalizeFocusedColumn(colIndex?: number): number {
    if (colIndex !== undefined && colIndex >= 0 && colIndex < this._columns.length) return colIndex
    if (this._focusedColIndex >= 0 && this._focusedColIndex < this._columns.length) return this._focusedColIndex
    return this._defaultFocusedColumnIndex()
  }

  private _treeColumnIndex(): number {
    return this._columns.findIndex(column => column.key === this._treeColumnKey)
  }

  private _moveFocusedCol(direction: 1 | -1): number {
    if (this._focusedColIndex < 0) return -1
    const next = this._focusedColIndex + direction
    return next >= 0 && next < this._columns.length ? next : -1
  }

  private _toggleFocusedCheckboxCell(): boolean {
    if (this._focusedItemIndex < 0 || this._focusedColIndex < 0) return false
    const column = this._columns[this._focusedColIndex]
    if (!column || resolveGridColumnEditorKind(column) !== 'checkbox') return false
    this.editing.startEdit(this._focusedItemIndex, this._focusedColIndex)
    return true
  }

  private _moveToNextEditableCell(rowIndex: number, colIndex: number): boolean {
    const columns = this._columns
    for (let row = rowIndex; row < this._visibleItems.length; row += 1) {
      const startCol = row === rowIndex ? colIndex + 1 : 0
      for (let index = startCol; index < columns.length; index += 1) {
        if (!this.structureEditing.canEditColumn(columns[index])) continue
        this.focusCell(row, index, { select: this._selectionMode === 'single', scroll: true })
        return true
      }
    }
    return false
  }

  private _moveToPrevEditableCell(rowIndex: number, colIndex: number): boolean {
    const columns = this._columns
    for (let row = rowIndex; row >= 0; row -= 1) {
      const startCol = row === rowIndex ? colIndex - 1 : columns.length - 1
      for (let index = startCol; index >= 0; index -= 1) {
        if (!this.structureEditing.canEditColumn(columns[index])) continue
        this.focusCell(row, index, { select: this._selectionMode === 'single', scroll: true })
        return true
      }
    }
    return false
  }

  private _findCheckAnchorIndex(): number {
    const checkedLeafIndex = this._visibleItems.findIndex(item => this._checkedLeafKeys.has(item.node.key))
    if (checkedLeafIndex >= 0) return checkedLeafIndex
    return this._visibleItems.findIndex(item =>
      this._halfCheckedKeys.has(item.node.key) || this._fullyCheckedKeys.has(item.node.key),
    )
  }

  private _recomputeCheckState(): void {
    const nextValidCheckedLeafKeys = new Set<string>()
    const nextFullyCheckedKeys = new Set<string>()
    const nextHalfCheckedKeys = new Set<string>()
    const visit = (node: TreeGridNode<T>): { targetCount: number; checkedTargetCount: number } => {
      const childStats = (node.children ?? []).map(child => visit(child))
      const childTargetCount = childStats.reduce((sum, child) => sum + child.targetCount, 0)
      const childCheckedTargetCount = childStats.reduce((sum, child) => sum + child.checkedTargetCount, 0)
      const isTarget = node.checkable !== false && childTargetCount === 0
      const selfChecked = isTarget && this._checkedLeafKeys.has(node.key)
      if (isTarget && selfChecked) nextValidCheckedLeafKeys.add(node.key)
      const targetCount = childTargetCount + (isTarget ? 1 : 0)
      const checkedTargetCount = childCheckedTargetCount + (selfChecked ? 1 : 0)
      if (targetCount > 0) {
        if (checkedTargetCount === targetCount) nextFullyCheckedKeys.add(node.key)
        else if (checkedTargetCount > 0) nextHalfCheckedKeys.add(node.key)
      }
      return { targetCount, checkedTargetCount }
    }
    for (const root of this._roots) visit(root)
    this._checkedLeafKeys = nextValidCheckedLeafKeys
    this._fullyCheckedKeys = nextFullyCheckedKeys
    this._halfCheckedKeys = nextHalfCheckedKeys
  }

  private _editTextMetrics(rowIndex: number, colIndex: number): {
    paddingH: number
    fontSize: number
    fontFamily: string
    numberStepperWidth: number
  } {
    const tokens = deriveGridCellStyle(this.currentTheme)
    const item = this._visibleItems[rowIndex]
    const column = this._columns[colIndex]
    if (!item || !column) {
      return {
        paddingH: tokens.paddingH,
        fontSize: tokens.fontSize,
        fontFamily: tokens.fontFamily,
        numberStepperWidth: 0,
      }
    }
    const editing = this.editing.state?.row === item.dataRowIndex && this.editing.state?.col === colIndex
    const rowPresentation = this._resolveRowPresentation(
      rowIndex,
      item,
      this._selectionMode === 'single' && item.node.key === this._selectedKey,
      this._hoveredItemIndex === rowIndex,
      this._focused && this._focusedItemIndex === rowIndex,
      !!editing,
      tokens,
    )
    const cellPresentation = this._resolveCellPresentation(rowIndex, item, colIndex, rowPresentation, !!editing, tokens)
    return {
      paddingH: tokens.paddingH,
      fontSize: cellPresentation.fontSize,
      fontFamily: cellPresentation.fontFamily,
      numberStepperWidth: 0,
    }
  }

  private _cellGlobalRect(rowIndex: number, colIndex: number): { x: number; y: number; w: number; h: number } {
    return this._viewport.cellGlobalRect(this._columns, this.globalOffset, rowIndex, colIndex)
  }

  private _syncEditingViewportState(): void {
    const edit = this.editing.state
    if (!edit) return
    if (this._isPopupEditColumn(edit.col) && !this._isEditCellVisible(edit.row, edit.col)) {
      this.editing.endEdit()
      return
    }
    this.editing.refreshOverlayPosition()
  }

  private _isPopupEditColumn(colIndex: number): boolean {
    const column = this._columns[colIndex]
    return !!column && isGridPopupEditor(column)
  }

  private _isEditCellVisible(rowIndex: number, colIndex: number): boolean {
    if (rowIndex < 0 || rowIndex >= this._visibleItems.length) return false
    if (colIndex < 0 || colIndex >= this._columns.length) return false
    const rect = this._cellGlobalRect(rowIndex, colIndex)
    if (rect.w <= 0 || rect.h <= 0) return false
    const bodyX = this.globalOffset.x
    const bodyY = this.globalOffset.y + this._viewport.headerHeight
    const bodyRight = bodyX + this._viewport.viewWidth
    const bodyBottom = bodyY + this._viewport.viewHeight
    return rect.x < bodyRight &&
      rect.x + rect.w > bodyX &&
      rect.y < bodyBottom &&
      rect.y + rect.h > bodyY
  }
}

function contextTheme(theme: ResolvedTheme): ResolvedTheme {
  return theme
}

function tokensFromTheme(theme: ResolvedTheme): GridCellStyleTokens {
  return deriveGridCellStyle(theme)
}
