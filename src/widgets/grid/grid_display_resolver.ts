import { resolveBgColor, resolveTextColor, type GridCellStyleTokens } from '../../theme/component_styles'
import type { Color, ResolvedTheme } from '../../theme/theme'
import type {
  GridCellDisplayTextArgs,
  GridCellStyleArgs,
  GridCellStyleOverride,
  GridColumnDef,
  GridDataItem,
  GridRowStyleArgs,
  GridRowStyleOverride,
} from './grid_types'
import { resolveGridColumnEditor } from './grid_column_editor'
import type { GridLookupValueResolver } from './lookup_value_index'
import { normalizeTimeValue } from '../time_value'

export interface GridResolvedRowPresentation<T extends Record<string, any> = any> {
  args: GridRowStyleArgs<T>
  override: GridRowStyleOverride | null
  backgroundColor: Color | null
  textColor: Color
  borderColor: Color | null
  fontSize: number
  fontFamily: string
}

export interface GridResolvedCellPresentation<T extends Record<string, any> = any> {
  args: GridCellStyleArgs<T>
  displayText: string
  backgroundColor: Color | null
  textColor: Color
  borderColor: Color | null
  fontSize: number
  fontFamily: string
  align: 'left' | 'center' | 'right'
}

interface GridPresentationState {
  itemIndex: number
  selected: boolean
  hovered: boolean
  focused: boolean
  editing: boolean
}

export function defaultGridCellDisplayText<T extends Record<string, any> = any>(
  column: GridColumnDef<T>,
  row: T,
  rowIndex: number,
  lookupValues?: GridLookupValueResolver<T>,
): string {
  const value = (row as any)[column.key]
  if (column.type === 'custom') return column.render(value, row)
  const editor = resolveGridColumnEditor(column)
  if (editor?.kind === 'select') {
    const option = editor.options.find(entry => entry.value === value)
    return option ? option.label : String(value ?? '')
  }
  if (editor?.kind === 'lookup') {
    const match = lookupValues
      ? lookupValues.resolve(column, value)
      : editor.rows.find(entry => String(entry[editor.valueKey]) === String(value ?? ''))
    return match ? String(match[editor.labelKey] ?? '') : String(value ?? '')
  }
  if (editor?.kind === 'drop-tree') {
    const match = findTreeNodeByKey(editor.roots, String(value ?? ''))
    return match ? String(match.label ?? '') : String(value ?? '')
  }
  if (editor?.kind === 'drop-tree-grid') {
    const match = findTreeGridNodeByKey(editor.roots, String(value ?? ''))
    return match ? String(match.row[editor.labelKey] ?? '') : String(value ?? '')
  }
  if (editor?.kind === 'time') {
    return normalizeTimeValue(value, editor.precision ?? 'second') ?? String(value ?? '')
  }
  return String(value ?? '')
}

function findTreeNodeByKey<T = any>(
  roots: Array<{ key: string; label: string; children?: T[] }> | readonly any[],
  key: string,
): any | null {
  for (const node of roots as readonly any[]) {
    if (node.key === key) return node
    if (node.children) {
      const child = findTreeNodeByKey(node.children, key)
      if (child) return child
    }
  }
  return null
}

function findTreeGridNodeByKey<T = any>(
  roots: Array<{ key: string; row: Record<string, any>; children?: T[] }> | readonly any[],
  key: string,
): any | null {
  for (const node of roots as readonly any[]) {
    if (node.key === key) return node
    if (node.children) {
      const child = findTreeGridNodeByKey(node.children, key)
      if (child) return child
    }
  }
  return null
}

export function resolveGridRowPresentation<T extends Record<string, any> = any>(options: {
  item: GridDataItem<T>
  theme: ResolvedTheme
  tokens: GridCellStyleTokens
  state: GridPresentationState
  resolveRowStyle?: (args: GridRowStyleArgs<T>) => GridRowStyleOverride | null | undefined
}): GridResolvedRowPresentation<T> {
  const { item, theme, tokens, state } = options
  let backgroundColor: Color | null = null
  if (state.selected || state.hovered) {
    backgroundColor = resolveBgColor(tokens.rowBgState, {
      selected: state.selected,
      hovered: state.hovered,
      focused: state.focused,
    })
  }
  else if (item.dataRowIndex % 2 === 1) backgroundColor = tokens.stripeBg
  const baseArgs: GridRowStyleArgs<T> = {
    row: item.row,
    rowId: item.rowId,
    theme,
    backgroundColor: backgroundColor ?? tokens.windowBg,
    selected: state.selected,
    hovered: state.hovered,
    focused: state.focused,
    editing: state.editing,
  }
  const override = options.resolveRowStyle?.(baseArgs) ?? null
  const resolvedBackgroundColor = override?.backgroundColor ?? backgroundColor
  const args: GridRowStyleArgs<T> = {
    ...baseArgs,
    backgroundColor: resolvedBackgroundColor ?? tokens.windowBg,
  }
  const borderColor = state.focused && !state.editing
    ? resolveBgColor(tokens.rowBorderState, 'focused')
    : null
  return {
    args,
    override,
    backgroundColor: resolvedBackgroundColor,
    textColor: override?.textColor ?? resolveTextColor(tokens.cellTextState, {
      selected: state.selected,
      hovered: state.hovered,
      focused: state.focused,
    }),
    borderColor: override?.borderColor ?? borderColor,
    fontSize: override?.fontSize ?? tokens.fontSize,
    fontFamily: override?.fontFamily ?? tokens.fontFamily,
  }
}

export function resolveGridCellPresentation<T extends Record<string, any> = any>(options: {
  item: GridDataItem<T>
  theme: ResolvedTheme
  column: GridColumnDef<T>
  colIndex: number
  tokens: GridCellStyleTokens
  rowPresentation: GridResolvedRowPresentation<T>
  state: GridPresentationState
  cellError?: GridCellStyleArgs<T>['error']
  getCellDisplayText?: (args: GridCellDisplayTextArgs<T>) => string | null | undefined
  resolveCellStyle?: (args: GridCellStyleArgs<T>) => GridCellStyleOverride | null | undefined
  lookupValues?: GridLookupValueResolver<T>
}): GridResolvedCellPresentation<T> {
  const { item, column, colIndex, theme, tokens, rowPresentation, state } = options
  const value = (item.row as any)[column.key]
  const baseCellBackground = state.editing
    ? resolveBgColor(tokens.editBgState, 'focused')
    : rowPresentation.backgroundColor ?? tokens.windowBg
  const baseArgs: GridCellStyleArgs<T> = {
    ...rowPresentation.args,
    theme,
    backgroundColor: baseCellBackground,
    value,
    column,
    error: options.cellError ?? null,
    editing: state.editing,
  }
  const defaultDisplayText = defaultGridCellDisplayText(
    column,
    item.row,
    item.dataRowIndex,
    options.lookupValues,
  )
  const displayText = options.getCellDisplayText?.({
    ...baseArgs,
    defaultDisplayText,
  }) ?? defaultDisplayText
  const cellOverride = options.resolveCellStyle?.(baseArgs) ?? null

  let backgroundColor: Color | null = state.editing
    ? resolveBgColor(tokens.editBgState, 'focused')
    : null
  if (state.editing && rowPresentation.override?.backgroundColor !== undefined) {
    backgroundColor = rowPresentation.override.backgroundColor
  }
  if (cellOverride?.backgroundColor !== undefined) {
    backgroundColor = cellOverride.backgroundColor
  }
  const args: GridCellStyleArgs<T> = {
    ...baseArgs,
    backgroundColor: backgroundColor ?? rowPresentation.backgroundColor ?? tokens.windowBg,
  }

  let borderColor: Color | null = state.editing
    ? resolveBgColor(tokens.editBorderState, 'focused')
    : null
  if (state.editing && rowPresentation.override?.borderColor !== undefined) {
    borderColor = rowPresentation.override.borderColor
  }
  if (cellOverride?.borderColor !== undefined) {
    borderColor = cellOverride.borderColor
  }

  let textColor = rowPresentation.textColor
  if (column.type === 'custom' && column.renderColor && rowPresentation.override?.textColor === undefined) {
    textColor = column.renderColor(value, item.row, {
      theme,
      backgroundColor: args.backgroundColor,
      columnKey: column.key,
      columnIndex: colIndex,
      selected: state.selected,
      hovered: state.hovered,
      focused: state.focused,
      editing: state.editing,
    })
  }
  if (cellOverride?.textColor !== undefined) {
    textColor = cellOverride.textColor
  }

  return {
    args,
    displayText,
    backgroundColor,
    textColor,
    borderColor,
    fontSize: cellOverride?.fontSize ?? rowPresentation.fontSize,
    fontFamily: cellOverride?.fontFamily ?? rowPresentation.fontFamily,
    align: cellOverride?.align ?? column.align ?? 'left',
  }
}
