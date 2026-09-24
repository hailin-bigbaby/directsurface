import type { DropdownOption } from '../dropdown'
import type { LookupEditQueryContext } from '../lookup_edit'
import { normalizeTimeValue, type TimePrecision } from '../time_value'
import type { TreeNode } from '../tree'
import type { TreeGridNode } from '../tree_grid'
import type {
  GridCellContext,
  GridColumnDef,
  GridEditorValidationMessages,
} from './grid_types'

export const DEFAULT_GRID_EDITOR_VALIDATION_MESSAGES: Readonly<GridEditorValidationMessages> = Object.freeze({
  invalidNumber: '请输入有效数字',
  invalidDate: '请输入有效日期',
  invalidTime: '请输入有效时间',
})

export function resolveGridEditorValidationMessages(
  messages?: Partial<GridEditorValidationMessages>,
): GridEditorValidationMessages {
  return {
    invalidNumber: resolveValidationMessage(
      messages?.invalidNumber,
      DEFAULT_GRID_EDITOR_VALIDATION_MESSAGES.invalidNumber,
    ),
    invalidDate: resolveValidationMessage(
      messages?.invalidDate,
      DEFAULT_GRID_EDITOR_VALIDATION_MESSAGES.invalidDate,
    ),
    invalidTime: resolveValidationMessage(
      messages?.invalidTime,
      DEFAULT_GRID_EDITOR_VALIDATION_MESSAGES.invalidTime,
    ),
  }
}

export interface GridLookupQueryContext<
  TOption extends Record<string, any> = Record<string, any>,
  TRow extends Record<string, any> = any,
> extends LookupEditQueryContext<TOption> {
  cell: GridCellContext<TRow, any>
}

export interface GridLookupQueryResult<T extends Record<string, any> = Record<string, any>> {
  rows: T[]
}

export type GridLookupQueryProcessor<
  TOption extends Record<string, any> = Record<string, any>,
  TRow extends Record<string, any> = any,
> = (context: GridLookupQueryContext<TOption, TRow>) => GridLookupQueryResult<TOption>

export interface GridDropTreeQueryContext<T = any> {
  query: string
  roots: readonly TreeNode<T>[]
  selectedValue: string
}

export type GridDropTreeQueryProcessor<T = any> =
  (context: GridDropTreeQueryContext<T>) => TreeNode<T>[]

export type GridDropTreeQueryTextBuilder<T = any> =
  (node: TreeNode<T>) => string[]

export interface GridDropTreeExpandOnOpenContext<T = any> {
  roots: readonly TreeNode<T>[]
  selectedValue: string
}

export type GridDropTreeExpandedKeysResolver<T = any> =
  (context: GridDropTreeExpandOnOpenContext<T>) => readonly string[]

export interface GridDropTreeGridQueryContext<T extends Record<string, any> = Record<string, any>> {
  query: string
  roots: readonly TreeGridNode<T>[]
  selectedValue: string
}

export type GridDropTreeGridQueryProcessor<T extends Record<string, any> = Record<string, any>> =
  (context: GridDropTreeGridQueryContext<T>) => TreeGridNode<T>[]

export type GridDropTreeGridQueryTextBuilder<T extends Record<string, any> = Record<string, any>> =
  (node: TreeGridNode<T>) => string[]

export interface GridDropTreeGridExpandOnOpenContext<T extends Record<string, any> = Record<string, any>> {
  roots: readonly TreeGridNode<T>[]
  selectedValue: string
}

export type GridDropTreeGridExpandedKeysResolver<T extends Record<string, any> = Record<string, any>> =
  (context: GridDropTreeGridExpandOnOpenContext<T>) => readonly string[]

export interface GridColumnEditorText {
  kind: 'text'
  placeholder?: string
}

export interface GridColumnEditorNumber {
  kind: 'number'
}

export interface GridColumnEditorCheckbox {
  kind: 'checkbox'
}

export interface GridColumnEditorSelect {
  kind: 'select'
  options: DropdownOption[]
  searchable?: boolean
}

export interface GridColumnEditorLookup<
  TOption extends Record<string, any> = Record<string, any>,
  TRow extends Record<string, any> = any,
> {
  kind: 'lookup'
  columns: Array<{ key: string; title: string; width?: number }>
  rows: TOption[]
  valueKey: string
  labelKey: string
  searchable?: boolean
  queryKeys?: string[]
  metaKey?: string
  queryProcessor?: GridLookupQueryProcessor<TOption, TRow>
}

export interface GridColumnEditorDate {
  kind: 'date'
  showTime?: boolean
  timePrecision?: TimePrecision
}

export interface GridColumnEditorTime {
  kind: 'time'
  precision?: TimePrecision
}

export interface GridColumnEditorDropTree<T = any> {
  kind: 'drop-tree'
  roots: TreeNode<T>[]
  searchable?: boolean
  expandAllOnOpen?: boolean
  expandedKeysOnOpen?: readonly string[] | GridDropTreeExpandedKeysResolver<T>
  queryTextBuilder?: GridDropTreeQueryTextBuilder<T>
  queryProcessor?: GridDropTreeQueryProcessor<T>
}

export interface GridColumnEditorDropTreeGrid<T extends Record<string, any> = Record<string, any>> {
  kind: 'drop-tree-grid'
  columns: Array<{ key: string; title: string; width?: number }>
  roots: TreeGridNode<T>[]
  treeColumnKey: string
  labelKey: string
  searchable?: boolean
  metaKey?: string
  metaFormatter?: (node: TreeGridNode<T>) => string
  expandAllOnOpen?: boolean
  expandedKeysOnOpen?: readonly string[] | GridDropTreeGridExpandedKeysResolver<T>
  queryTextBuilder?: GridDropTreeGridQueryTextBuilder<T>
  queryProcessor?: GridDropTreeGridQueryProcessor<T>
}

export type GridColumnEditorDef<
  TOption extends Record<string, any> = Record<string, any>,
  TRow extends Record<string, any> = any,
> =
  | GridColumnEditorText
  | GridColumnEditorNumber
  | GridColumnEditorCheckbox
  | GridColumnEditorSelect
  | GridColumnEditorLookup<TOption, TRow>
  | GridColumnEditorDate
  | GridColumnEditorTime
  | GridColumnEditorDropTree
  | GridColumnEditorDropTreeGrid

export type GridColumnEditorKind = GridColumnEditorDef['kind']

export function resolveGridColumnEditor<T extends Record<string, any> = Record<string, any>>(
  column: GridColumnDef<T>,
): GridColumnEditorDef<Record<string, any>, T> | null {
  if (column.editor) return column.editor
  if (column.type === 'text') {
    return {
      kind: 'text',
      placeholder: column.placeholder,
    }
  }
  if (column.type === 'number') return { kind: 'number' }
  if (column.type === 'checkbox') return { kind: 'checkbox' }
  if (column.type === 'select') {
    return {
      kind: 'select',
      options: column.options,
      searchable: column.searchable,
    }
  }
  if (column.type === 'select-grid') {
    return {
      kind: 'lookup',
      columns: column.columns,
      rows: column.rows,
      valueKey: column.valueKey,
      labelKey: column.labelKey,
      searchable: column.searchable,
    }
  }
  if (column.type === 'date') {
    return {
      kind: 'date',
      showTime: column.showTime,
      timePrecision: column.timePrecision,
    }
  }
  if (column.type === 'time') {
    return {
      kind: 'time',
      precision: column.precision,
    }
  }
  return null
}

export function resolveGridColumnEditorKind<T extends Record<string, any> = Record<string, any>>(
  column: GridColumnDef<T>,
): GridColumnEditorKind | null {
  return resolveGridColumnEditor(column)?.kind ?? null
}

export function isGridPopupEditor<T extends Record<string, any> = Record<string, any>>(
  column: GridColumnDef<T>,
): boolean {
  const kind = resolveGridColumnEditorKind(column)
  return kind === 'select' ||
    kind === 'lookup' ||
    kind === 'date' ||
    kind === 'drop-tree' ||
    kind === 'drop-tree-grid'
}

export function normalizeGridColumnValue<T extends Record<string, any> = Record<string, any>>(
  column: GridColumnDef<T>,
  value: any,
  originalValue?: any,
): any {
  const editorKind = resolveGridColumnEditorKind(column)
  if (editorKind === 'time') {
    if (value === null || value === undefined || String(value).trim() === '') return originalValue
    const editor = resolveGridColumnEditor(column)
    return normalizeTimeValue(
      String(value).trim(),
      editor?.kind === 'time' ? editor.precision ?? 'second' : 'second',
    ) ?? originalValue
  }
  if (editorKind !== 'number') return value
  if (value === null || value === undefined || String(value).trim() === '') return originalValue
  if (gridColumnValueValidationMessage(column, value)) return originalValue
  const parsed = Number(String(value).trim())
  return applyGridNumberConstraints(parsed, resolveGridNumberConstraints(column)) ?? originalValue
}

export interface GridNumberStepResult {
  value: number
  text: string
}

export interface ResolvedGridNumberConstraints {
  step: number
  min?: number
  max?: number
  decimals?: number
}

const MAX_GRID_NUMBER_DECIMALS = 100

export function resolveGridNumberConstraints<
  T extends Record<string, any> = Record<string, any>,
>(
  column: GridColumnDef<T>,
): ResolvedGridNumberConstraints {
  if (column.type !== 'number') return { step: 1 }

  const configuredStep = Number.isFinite(column.step) && column.step! > 0
    ? column.step!
    : 1
  let min = Number.isFinite(column.min) ? column.min : undefined
  let max = Number.isFinite(column.max) ? column.max : undefined
  if (min !== undefined && max !== undefined && min > max) {
    min = undefined
    max = undefined
  }
  const decimals = Number.isFinite(column.decimals)
    ? Math.min(
        MAX_GRID_NUMBER_DECIMALS,
        Math.max(0, Math.trunc(column.decimals!)),
      )
    : undefined
  const step = decimals === undefined
    ? configuredStep
    : normalizeGridNumberStep(configuredStep, decimals)

  return { step, min, max, decimals }
}

export function stepGridNumberValue<T extends Record<string, any> = Record<string, any>>(
  column: GridColumnDef<T>,
  value: unknown,
  direction: 1 | -1,
): GridNumberStepResult | null {
  if (resolveGridColumnEditorKind(column) !== 'number') return null
  const text = String(value ?? '').trim()
  if (text && gridColumnValueValidationMessage(column, text)) return null

  const current = text ? Number(text) : 0
  const constraints = resolveGridNumberConstraints(column)
  const step = constraints.step
  const precision = Math.max(decimalPlaces(current), decimalPlaces(step))
  const currentInteger = scaledDecimalInteger(current, precision)
  const stepInteger = scaledDecimalInteger(step, precision)
  const nextInteger = currentInteger + (direction === 1 ? stepInteger : -stepInteger)
  const rawNext = Number(`${nextInteger}e-${precision}`)
  const next = applyGridNumberConstraints(rawNext, constraints)
  if (next === null) return null
  return { value: next, text: String(next) }
}

export function gridColumnValueValidationMessage<T extends Record<string, any> = Record<string, any>>(
  column: GridColumnDef<T>,
  value: unknown,
  messages: Readonly<GridEditorValidationMessages> = DEFAULT_GRID_EDITOR_VALIDATION_MESSAGES,
): string | null {
  if (value === null || value === undefined || value === '') return null
  const editorKind = resolveGridColumnEditorKind(column)
  if (editorKind === 'number') {
    if (typeof value === 'number') return Number.isFinite(value) ? null : messages.invalidNumber
    const text = String(value).trim()
    const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
    if (!decimalPattern.test(text) || !Number.isFinite(Number(text))) return messages.invalidNumber
    return null
  }
  if (editorKind === 'date') {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? messages.invalidDate : null
    const text = String(value).trim()
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/)
    if (!match) return messages.invalidDate
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day ||
      Number.isNaN(Date.parse(text))
    ) {
      return messages.invalidDate
    }
  }
  if (editorKind === 'time') {
    return normalizeTimeValue(String(value).trim(), 'second')
      ? null
      : messages.invalidTime
  }
  return null
}

function resolveValidationMessage(value: string | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback
}

function decimalPlaces(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  const text = String(value).toLowerCase()
  const [coefficient, exponentText] = text.split('e')
  const fractionLength = coefficient?.split('.')[1]?.length ?? 0
  const exponent = exponentText ? Number(exponentText) : 0
  return Math.max(0, fractionLength - exponent)
}

function scaledDecimalInteger(value: number, precision: number): bigint {
  const text = String(Math.abs(value)).toLowerCase()
  const [coefficient = '0', exponentText] = text.split('e')
  const [whole = '0', fraction = ''] = coefficient.split('.')
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '') || '0'
  const exponent = exponentText ? Number(exponentText) : 0
  const trailingZeros = precision + exponent - fraction.length
  const scaled = BigInt(digits) * (10n ** BigInt(Math.max(0, trailingZeros)))
  return value < 0 ? -scaled : scaled
}

function applyGridNumberConstraints(
  value: number,
  constraints: ResolvedGridNumberConstraints,
): number | null {
  if (!Number.isFinite(value)) return null
  if (constraints.min !== undefined && value <= constraints.min) {
    return Object.is(constraints.min, -0) ? 0 : constraints.min
  }
  if (constraints.max !== undefined && value >= constraints.max) {
    return Object.is(constraints.max, -0) ? 0 : constraints.max
  }
  let normalized = constraints.decimals === undefined
    ? value
    : roundGridNumber(value, constraints.decimals)
  if (constraints.min !== undefined) normalized = Math.max(constraints.min, normalized)
  if (constraints.max !== undefined) normalized = Math.min(constraints.max, normalized)
  if (!Number.isFinite(normalized)) return null
  return Object.is(normalized, -0) ? 0 : normalized
}

function roundGridNumber(value: number, decimals: number): number {
  if (decimals === 0) return roundGridNumberTie(value)
  const scaled = shiftGridNumber(value, decimals)
  if (Number.isFinite(scaled)) {
    return shiftGridNumber(roundGridNumberTie(scaled), -decimals)
  }
  return Number(value.toFixed(decimals))
}

function roundGridNumberTie(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value))
}

function normalizeGridNumberStep(step: number, decimals: number): number {
  const rounded = Math.abs(roundGridNumber(step, decimals))
  if (Number.isFinite(rounded) && rounded > 0) return rounded
  return shiftGridNumber(1, -decimals)
}

function shiftGridNumber(value: number, decimalPlaces: number): number {
  const [coefficient, exponentText] = String(value).toLowerCase().split('e')
  const exponent = exponentText ? Number(exponentText) : 0
  return Number(`${coefficient}e${exponent + decimalPlaces}`)
}
