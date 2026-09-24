import type { PopupAnchorTarget } from '../../core/popup_anchor'
import { DatePickerPopup } from '../date_picker'
import { parseISOCalendarDate, type CalendarDate } from '../calendar_date'
import { DropdownPopup } from '../dropdown'
import { DropTreePopup, defaultDropTreeEditQueryProcessor } from '../drop_tree_edit'
import { DropTreeGridPopup, defaultDropTreeGridEditQueryProcessor } from '../drop_tree_grid_edit'
import { defaultLookupQueryProcessor } from '../lookup_edit'
import {
  formatTimeValue,
  parseTimeValue,
  type TimeParts,
} from '../time_value'
import {
  resolveGridColumnEditor,
  type GridColumnEditorLookup,
  type GridColumnEditorDropTree,
  type GridColumnEditorDropTreeGrid,
} from './grid_column_editor'
import { DropdownGridPopup } from './popup/dropdown_grid_popup'
import type {
  GridCellPopupDebugState,
  GridColumnDate,
  GridColumnDef,
  GridColumnSelect,
  GridColumnSelectGrid,
  GridEmbeddedPopupGrid,
  GridPopupAnchorData,
} from './grid_types'
import type { GridEditableStructure } from './grid_structure_edit_controller'

export interface GridCellPopupEditorsOptions<T extends Record<string, any>> {
  owner: PopupAnchorTarget<GridPopupAnchorData> & object
  structureEditing: GridEditableStructure<T>
  getVisibleRows: () => T[]
  onEndEdit: () => void
  createEmbeddedGrid: () => GridEmbeddedPopupGrid
}

export class GridCellPopupEditors<T extends Record<string, any> = any> {
  private readonly _owner: GridCellPopupEditorsOptions<T>['owner']
  private readonly _structureEditing: GridEditableStructure<T>
  private readonly _getVisibleRows: GridCellPopupEditorsOptions<T>['getVisibleRows']
  private readonly _onEndEdit: GridCellPopupEditorsOptions<T>['onEndEdit']

  private readonly _dropdownPopup = new DropdownPopup()
  private readonly _dropdownGridPopup: DropdownGridPopup
  private readonly _datePickerPopup = new DatePickerPopup()
  private readonly _dropTreePopup = new DropTreePopup<any>()
  private readonly _dropTreeGridPopup = new DropTreeGridPopup<any>()
  private _nextSessionToken = 1
  private _activeSessionToken: number | null = null

  constructor(options: GridCellPopupEditorsOptions<T>) {
    this._owner = options.owner
    this._structureEditing = options.structureEditing
    this._getVisibleRows = options.getVisibleRows
    this._onEndEdit = options.onEndEdit
    this._dropdownGridPopup = new DropdownGridPopup({
      createEmbeddedGrid: options.createEmbeddedGrid,
    })
  }

  get dropdownPopup(): DropdownPopup { return this._dropdownPopup }
  get dropdownGridPopup(): DropdownGridPopup { return this._dropdownGridPopup }
  get datePickerPopup(): DatePickerPopup { return this._datePickerPopup }
  get dropTreePopup(): DropTreePopup<any> { return this._dropTreePopup }
  get dropTreeGridPopup(): DropTreeGridPopup<any> { return this._dropTreeGridPopup }

  debugState(): GridCellPopupDebugState {
    const dropdown = {
      visible: this._dropdownPopup.visible,
      state: this._dropdownPopup.visible ? this._dropdownPopup.debugState() : null,
    }
    const dropdownGrid = {
      visible: this._dropdownGridPopup.visible,
      state: this._dropdownGridPopup.visible ? this._dropdownGridPopup.debugState() : null,
    }
    const datePicker = {
      visible: this._datePickerPopup.visible,
      state: this._datePickerPopup.visible ? this._datePickerPopup.debugState() : null,
    }
    const dropTree = {
      visible: this._dropTreePopup.visible,
      state: this._dropTreePopup.visible ? this._dropTreePopup.debugState() : null,
    }
    const dropTreeGrid = {
      visible: this._dropTreeGridPopup.visible,
      state: this._dropTreeGridPopup.visible ? this._dropTreeGridPopup.debugState() : null,
    }

    let activePopup: GridCellPopupDebugState['activePopup'] = 'none'
    if (dropdown.visible) activePopup = 'dropdown'
    else if (dropdownGrid.visible) activePopup = 'dropdown-grid'
    else if (datePicker.visible) activePopup = 'date-picker'
    else if (dropTree.visible) activePopup = 'drop-tree'
    else if (dropTreeGrid.visible) activePopup = 'drop-tree-grid'

    return {
      activePopup,
      dropdown,
      dropdownGrid,
      datePicker,
      dropTree,
      dropTreeGrid,
    }
  }

  openSelectPopup(rowIndex: number, colIndex: number, column: GridColumnSelect): void {
    const row = this._getVisibleRows()[rowIndex]
    if (!row) return
    const token = this._beginPopupEditSession()
    this._dropdownPopup.open({
      options: column.options,
      selectedValue: String(row[column.key] ?? ''),
      anchor: { target: this._owner, data: { row: rowIndex, col: colIndex } },
      searchable: column.searchable ?? false,
      maxVisibleItems: 8,
      onSelect: value => {
        if (!this._isActiveSession(token)) return false
        if (!this._commitVisibleValue(row, colIndex, column.key, value)) return false
        this._finishPopupEditSession(token)
        return true
      },
      onClose: () => { this._finishPopupEditSession(token) },
    })
  }

  openSelectGridPopup(rowIndex: number, colIndex: number, column: GridColumnSelectGrid): void {
    const row = this._getVisibleRows()[rowIndex]
    if (!row) return
    const token = this._beginPopupEditSession()
    this._dropdownGridPopup.open({
      columns: column.columns,
      rows: column.rows,
      valueKey: column.valueKey,
      labelKey: column.labelKey,
      selectedValue: String(row[column.key] ?? ''),
      anchor: { target: this._owner, data: { row: rowIndex, col: colIndex } },
      searchable: column.searchable ?? false,
      maxVisibleItems: 8,
      onSelect: value => {
        if (!this._isActiveSession(token)) return false
        if (!this._commitVisibleValue(row, colIndex, column.key, value)) return false
        this._finishPopupEditSession(token)
        return true
      },
      onClose: () => { this._finishPopupEditSession(token) },
    })
  }

  openDatePopup(rowIndex: number, colIndex: number, column: GridColumnDate): void {
    const row = this._getVisibleRows()[rowIndex]
    if (!row) return
    const token = this._beginPopupEditSession()
    const popupValue = resolveGridDatePopupValue(row[column.key], column.showTime === true)
    this._datePickerPopup.open({
      anchor: { target: this._owner, data: { row: rowIndex, col: colIndex } },
      selected: popupValue.selected,
      selectedTime: popupValue.selectedTime,
      showTime: column.showTime,
      timePrecision: column.timePrecision,
      onSelect: (value, time) => {
        if (!this._isActiveSession(token)) return false
        const date = `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`
        const iso = column.showTime
          ? `${date}T${formatTimeValue(
              time ?? { hour: 0, minute: 0, second: 0 },
              column.timePrecision ?? 'second',
            )}`
          : date
        if (!this._commitVisibleValue(row, colIndex, column.key, iso)) return false
        this._finishPopupEditSession(token)
        return true
      },
      onClose: () => { this._finishPopupEditSession(token) },
    })
  }

  openColumnEditorPopup(rowIndex: number, colIndex: number, column: GridColumnDef<T>): void {
    const editor = resolveGridColumnEditor(column)
    if (!editor) return
    if (editor.kind === 'select') {
      this.openSelectPopup(rowIndex, colIndex, {
        ...column,
        type: 'select',
        options: editor.options,
        searchable: editor.searchable,
      } as GridColumnSelect)
      return
    }
    if (editor.kind === 'lookup') {
      this._openLookupPopup(rowIndex, colIndex, column, editor as GridColumnEditorLookup)
      return
    }
    if (editor.kind === 'date') {
      this.openDatePopup(rowIndex, colIndex, {
        ...column,
        type: 'date',
        showTime: editor.showTime,
        timePrecision: editor.timePrecision,
      } as GridColumnDate)
      return
    }
    if (editor.kind === 'drop-tree') {
      this._openDropTreePopup(rowIndex, colIndex, column, editor as GridColumnEditorDropTree)
      return
    }
    if (editor.kind === 'drop-tree-grid') {
      this._openDropTreeGridPopup(rowIndex, colIndex, column, editor as GridColumnEditorDropTreeGrid)
    }
  }

  dispose(): void {
    this._dropdownPopup.dispose()
    this._dropdownGridPopup.dispose()
    this._datePickerPopup.dispose()
    this._dropTreePopup.close()
    this._dropTreeGridPopup.close()
    this._activeSessionToken = null
  }

  private _openLookupPopup(
    rowIndex: number,
    colIndex: number,
    column: GridColumnDef<T>,
    editor: GridColumnEditorLookup,
  ): void {
    const row = this._getVisibleRows()[rowIndex]
    if (!row) return
    const token = this._beginPopupEditSession()
    const selectedValue = String(row[column.key] ?? '')
    const queryKeys = dedupeKeys([
      editor.valueKey,
      editor.labelKey,
      editor.metaKey,
      ...(editor.queryKeys ?? []),
    ])
    const resolveRows = (query: string) => {
      const processor = editor.queryProcessor ?? defaultLookupQueryProcessor<Record<string, any>>
      const currentRowIndex = this._resolveCommitRowIndex(row)
      return processor({
        query,
        rows: editor.rows,
        columns: editor.columns,
        valueKey: editor.valueKey,
        labelKey: editor.labelKey,
        queryKeys,
        metaKey: editor.metaKey,
        selectedValue,
        cell: {
          row,
          rowIndex: currentRowIndex,
          column,
          columnIndex: colIndex,
          value: row[column.key],
        },
      }).rows
    }
    this._dropdownGridPopup.open({
      columns: editor.columns,
      rows: resolveRows(''),
      valueKey: editor.valueKey,
      labelKey: editor.labelKey,
      selectedValue,
      anchor: { target: this._owner, data: { row: rowIndex, col: colIndex } },
      searchable: editor.searchable ?? false,
      searchBehavior: 'external',
      maxVisibleItems: 8,
      onSearchTextChange: value => {
        if (!this._isActiveSession(token)) return
        this._dropdownGridPopup.setRows(resolveRows(value))
      },
      onSelect: value => {
        if (!this._isActiveSession(token)) return false
        if (!this._commitVisibleValue(row, colIndex, column.key, value)) return false
        this._finishPopupEditSession(token)
        return true
      },
      onClose: () => { this._finishPopupEditSession(token) },
    })
  }

  private _openDropTreePopup(
    rowIndex: number,
    colIndex: number,
    column: GridColumnDef<T>,
    editor: GridColumnEditorDropTree,
  ): void {
    const row = this._getVisibleRows()[rowIndex]
    if (!row) return
    const token = this._beginPopupEditSession()
    const selectedValue = String(row[column.key] ?? '')
    const resolveRoots = (query: string) => {
      const processor = editor.queryProcessor ?? defaultDropTreeEditQueryProcessor(editor.queryTextBuilder)
      return processor({
        query,
        roots: editor.roots,
        selectedValue,
      })
    }
    this._dropTreePopup.open({
      anchor: { target: this._owner, data: { row: rowIndex, col: colIndex } },
      selectedValue,
      searchable: editor.searchable ?? false,
      maxVisibleItems: 10,
      initialQuery: '',
      resolveRoots,
      openExpandedKeys: resolveTreeExpandedKeys(editor, selectedValue),
      onSelect: node => {
        if (!this._isActiveSession(token)) return false
        if (!this._commitVisibleValue(row, colIndex, column.key, node.key)) return false
        this._finishPopupEditSession(token)
        return true
      },
      onClose: () => { this._finishPopupEditSession(token) },
    })
  }

  private _openDropTreeGridPopup(
    rowIndex: number,
    colIndex: number,
    column: GridColumnDef<T>,
    editor: GridColumnEditorDropTreeGrid,
  ): void {
    const row = this._getVisibleRows()[rowIndex]
    if (!row) return
    const token = this._beginPopupEditSession()
    const selectedValue = String(row[column.key] ?? '')
    const resolveRoots = (query: string) => {
      const processor = editor.queryProcessor ?? defaultDropTreeGridEditQueryProcessor(editor.queryTextBuilder)
      return processor({
        query,
        roots: editor.roots,
        columns: editor.columns as any,
        treeColumnKey: editor.treeColumnKey as any,
        labelKey: editor.labelKey,
        selectedValue,
      })
    }
    this._dropTreeGridPopup.open({
      columns: editor.columns as any,
      treeColumnKey: editor.treeColumnKey as any,
      selectedValue,
      anchor: { target: this._owner, data: { row: rowIndex, col: colIndex } },
      searchable: editor.searchable ?? false,
      maxVisibleItems: 10,
      initialQuery: '',
      resolveRoots,
      openExpandedKeys: resolveTreeGridExpandedKeys(editor, selectedValue),
      onSelect: node => {
        if (!this._isActiveSession(token)) return false
        if (!this._commitVisibleValue(row, colIndex, column.key, node.key)) return false
        this._finishPopupEditSession(token)
        return true
      },
      onClose: () => { this._finishPopupEditSession(token) },
    })
  }

  private _beginPopupEditSession(): number {
    this._closeOpenPopups()
    const token = this._nextSessionToken++
    this._activeSessionToken = token
    return token
  }

  private _isActiveSession(token: number): boolean {
    return this._activeSessionToken === token
  }

  private _commitVisibleValue(
    openedRow: T,
    colIndex: number,
    key: string,
    value: any,
  ): boolean {
    const rowIndex = this._resolveCommitRowIndex(openedRow)
    if (!this._structureEditing.canEditCell(rowIndex, colIndex)) return false
    return this._structureEditing.commitVisibleValue(rowIndex, key, value)
  }

  private _resolveCommitRowIndex(openedRow: T): number {
    const rows = this._getVisibleRows()
    const currentIndex = rows.indexOf(openedRow)
    if (currentIndex >= 0) return currentIndex
    return -1
  }

  private _finishPopupEditSession(token: number): void {
    if (!this._isActiveSession(token)) return
    this._activeSessionToken = null
    this._onEndEdit()
  }

  private _closeOpenPopups(): void {
    this._dropdownPopup.close()
    this._dropdownGridPopup.close()
    this._datePickerPopup.close()
    this._dropTreePopup.close()
    this._dropTreeGridPopup.close()
  }
}

function dedupeKeys(keys: Array<string | undefined>): string[] {
  const result: string[] = []
  for (const key of keys) {
    if (!key || result.includes(key)) continue
    result.push(key)
  }
  return result
}

function resolveTreeExpandedKeys(
  editor: GridColumnEditorDropTree,
  selectedValue: string,
): string[] {
  if (editor.expandAllOnOpen) return collectExpandableTreeKeys(editor.roots)
  if (typeof editor.expandedKeysOnOpen === 'function') {
    return dedupeKeys([
      ...editor.expandedKeysOnOpen({ roots: editor.roots, selectedValue }),
      ...collectTreeAncestorKeys(editor.roots, selectedValue),
    ])
  }
  if (editor.expandedKeysOnOpen) {
    return dedupeKeys([
      ...editor.expandedKeysOnOpen,
      ...collectTreeAncestorKeys(editor.roots, selectedValue),
    ])
  }
  return collectTreeAncestorKeys(editor.roots, selectedValue)
}

function resolveTreeGridExpandedKeys(
  editor: GridColumnEditorDropTreeGrid,
  selectedValue: string,
): string[] {
  if (editor.expandAllOnOpen) return collectExpandableTreeGridKeys(editor.roots)
  if (typeof editor.expandedKeysOnOpen === 'function') {
    return dedupeKeys([
      ...editor.expandedKeysOnOpen({ roots: editor.roots, selectedValue }),
      ...collectTreeGridAncestorKeys(editor.roots, selectedValue),
    ])
  }
  if (editor.expandedKeysOnOpen) {
    return dedupeKeys([
      ...editor.expandedKeysOnOpen,
      ...collectTreeGridAncestorKeys(editor.roots, selectedValue),
    ])
  }
  return collectTreeGridAncestorKeys(editor.roots, selectedValue)
}

function collectExpandableTreeKeys(roots: readonly any[]): string[] {
  const result: string[] = []
  const visit = (nodes: readonly any[]) => {
    for (const node of nodes) {
      if (!node.children || node.children.length === 0) continue
      result.push(String(node.key))
      visit(node.children)
    }
  }
  visit(roots)
  return result
}

function collectTreeAncestorKeys(roots: readonly any[], key: string): string[] {
  if (!key) return []
  const result: string[] = []
  const visit = (nodes: readonly any[], ancestors: string[]): boolean => {
    for (const node of nodes) {
      const nextAncestors = node.children && node.children.length > 0
        ? [...ancestors, String(node.key)]
        : ancestors
      if (String(node.key) === key) {
        result.push(...ancestors)
        return true
      }
      if (node.children && visit(node.children, nextAncestors)) return true
    }
    return false
  }
  visit(roots, [])
  return result
}

function collectExpandableTreeGridKeys(roots: readonly any[]): string[] {
  return collectExpandableTreeKeys(roots)
}

function collectTreeGridAncestorKeys(roots: readonly any[], key: string): string[] {
  return collectTreeAncestorKeys(roots, key)
}

const GRID_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:(?:T| )(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/

function resolveGridDatePopupValue(
  value: unknown,
  showTime: boolean,
): {
  selected: CalendarDate | null
  selectedTime: TimeParts | null
} {
  if (value instanceof Date) return gridDatePopupValueFromInstant(value, showTime)
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? gridDatePopupValueFromInstant(new Date(value), showTime)
      : { selected: null, selectedTime: null }
  }
  if (typeof value !== 'string') return { selected: null, selectedTime: null }

  const text = value.trim()
  const match = GRID_DATE_TIME_PATTERN.exec(text)
  if (!match) return { selected: null, selectedTime: null }
  const selected = parseISOCalendarDate(`${match[1]}-${match[2]}-${match[3]}`)
  if (!selected) return { selected: null, selectedTime: null }

  const hasTime = match[4] !== undefined
  const zone = match[8]
  if (hasTime && zone) {
    const instantText = text[10] === ' '
      ? `${text.slice(0, 10)}T${text.slice(11)}`
      : text
    const timestamp = Date.parse(instantText)
    return Number.isFinite(timestamp)
      ? gridDatePopupValueFromInstant(new Date(timestamp), showTime)
      : { selected: null, selectedTime: null }
  }

  if (!showTime) return { selected, selectedTime: null }
  if (!hasTime) {
    return {
      selected,
      selectedTime: { hour: 0, minute: 0, second: 0 },
    }
  }
  const selectedTime = parseTimeValue(
    `${match[4]}:${match[5]}:${match[6] ?? '00'}`,
  )
  return selectedTime
    ? { selected, selectedTime }
    : { selected: null, selectedTime: null }
}

function gridDatePopupValueFromInstant(
  value: Date,
  showTime: boolean,
): {
  selected: CalendarDate | null
  selectedTime: TimeParts | null
} {
  if (!Number.isFinite(value.getTime())) {
    return { selected: null, selectedTime: null }
  }
  return {
    selected: {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    },
    selectedTime: showTime
      ? {
          hour: value.getHours(),
          minute: value.getMinutes(),
          second: value.getSeconds(),
        }
      : null,
  }
}
