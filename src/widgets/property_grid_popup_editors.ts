import type { PopupAnchorTarget } from '../core/popup_anchor'
import type { Rect } from '../core/render_object'
import type { Color } from '../theme/theme'
import { formatISOCalendarDate, parseISOCalendarDate } from './calendar_date'
import { ColorPickerPopup } from './color_picker'
import { DatePickerPopup } from './date_picker'
import { DropdownPopup, type DropdownOption } from './dropdown'
import type { PropertyGridRow } from './property_grid'

export interface PropertyGridPopupEditingStateSnapshot {
  readonly rowId?: string
  readonly group: string
  readonly name: string
  readonly editor: 'enum' | 'color' | 'date'
  readonly errorText?: string
  readonly mode: 'popup'
}

interface PropertyGridPopupEditState {
  readonly sessionKey: object
  readonly rowKey: string
  row: PropertyGridRow
  readonly editor: 'enum' | 'color' | 'date'
  errorText?: string
}

export interface PropertyGridPopupEditorsOptions {
  owner: PopupAnchorTarget & object
  getRowByKey: (key: string) => PropertyGridRow | undefined
  getValueRect: (key: string) => Rect | undefined
  isValueRectVisible: (rect: Rect) => boolean
  commitValue: (row: PropertyGridRow, nextValue: unknown, displayValue?: unknown) => boolean
  moveByTab: (rowKey: string, direction: 1 | -1) => void
  markNeedsPaint: () => void
}

export class PropertyGridPopupEditors {
  private readonly _owner: PropertyGridPopupEditorsOptions['owner']
  private readonly _getRowByKey: PropertyGridPopupEditorsOptions['getRowByKey']
  private readonly _getValueRect: PropertyGridPopupEditorsOptions['getValueRect']
  private readonly _isValueRectVisible: PropertyGridPopupEditorsOptions['isValueRectVisible']
  private readonly _commitValue: PropertyGridPopupEditorsOptions['commitValue']
  private readonly _moveByTab: PropertyGridPopupEditorsOptions['moveByTab']
  private readonly _markNeedsPaint: PropertyGridPopupEditorsOptions['markNeedsPaint']
  private readonly _enumPopup = new DropdownPopup()
  private readonly _colorPopup = new ColorPickerPopup()
  private readonly _datePopup = new DatePickerPopup()
  private _state: PropertyGridPopupEditState | null = null

  constructor(options: PropertyGridPopupEditorsOptions) {
    this._owner = options.owner
    this._getRowByKey = options.getRowByKey
    this._getValueRect = options.getValueRect
    this._isValueRectVisible = options.isValueRectVisible
    this._commitValue = options.commitValue
    this._moveByTab = options.moveByTab
    this._markNeedsPaint = options.markNeedsPaint
  }

  get isEditing(): boolean { return this._state !== null }
  get state(): PropertyGridPopupEditState | null { return this._state }

  isEditingRow(row: PropertyGridRow | undefined): boolean {
    return !!row && this._state?.row === row
  }

  snapshot(): PropertyGridPopupEditingStateSnapshot | undefined {
    const state = this._state
    if (!state) return undefined
    return {
      rowId: state.row.id,
      group: state.row.group,
      name: state.row.name,
      editor: state.editor,
      errorText: state.errorText,
      mode: 'popup',
    }
  }

  beginEdit(rowKey: string, row: PropertyGridRow): boolean {
    const editor = row.editor ?? row.kind
    if (!row.editable || (editor !== 'enum' && editor !== 'color' && editor !== 'date')) return false
    const popupEditor: 'enum' | 'color' | 'date' = editor === 'enum'
      ? 'enum'
      : editor === 'color' ? 'color' : 'date'
    this.cancelEdit()
    const state: PropertyGridPopupEditState = {
      sessionKey: {},
      rowKey,
      row,
      editor: popupEditor,
    }
    this._state = state
    if (popupEditor === 'enum') return this._openEnum(state)
    if (popupEditor === 'color') return this._openColor(state)
    return this._openDate(state)
  }

  cancelEdit(): boolean {
    const state = this._state
    if (!state) return false
    this._state = null
    this._popupFor(state.editor).close()
    this._markNeedsPaint()
    return true
  }

  syncRows(): void {
    const state = this._state
    if (!state) return
    const row = this._getRowByKey(state.rowKey)
    if (!row?.editable || (row.editor ?? row.kind) !== state.editor) {
      this.cancelEdit()
      return
    }
    state.row = row
    const rect = this._getValueRect(state.rowKey)
    if (!rect || !this._isValueRectVisible(rect)) this.cancelEdit()
  }

  syncGeometry(): void {
    const state = this._state
    if (!state) return
    const rect = this._getValueRect(state.rowKey)
    if (!rect || !this._isValueRectVisible(rect)) this.cancelEdit()
  }

  dispose(): void {
    this._state = null
    this._enumPopup.dispose()
    this._colorPopup.dispose()
    this._datePopup.dispose()
  }

  private _openEnum(state: PropertyGridPopupEditState): boolean {
    const items = state.row.enumItems ?? []
    if (items.length === 0) {
      this._state = null
      return false
    }
    const options: DropdownOption[] = items.map((item, index) => ({
      value: enumToken(index),
      label: item.label,
    }))
    const selectedIndex = items.findIndex(item => propertyGridValueText(item.value) === state.row.value)
    this._enumPopup.open({
      options,
      selectedValue: selectedIndex >= 0 ? enumToken(selectedIndex) : '',
      anchor: this._anchor(state),
      searchable: options.length > 8,
      maxVisibleItems: 8,
      minPopupWidth: 160,
      clearable: state.row.clearable,
      onSelect: token => {
        const current = this._current(state.sessionKey)
        if (!current) return false
        const index = enumIndex(token)
        const item = index === undefined ? undefined : current.row.enumItems?.[index]
        if (!item) return false
        return this._commitCurrent(current, item.value, item.value)
      },
      onClear: state.row.clearable
        ? () => {
            const current = this._current(state.sessionKey)
            return current ? this._commitCurrent(current, '', '') : false
          }
        : undefined,
      onTab: direction => this._moveAfterTab(state.sessionKey, state.rowKey, direction),
      onClose: () => this._finish(state.sessionKey),
    })
    this._markNeedsPaint()
    return true
  }

  private _openColor(state: PropertyGridPopupEditState): boolean {
    const color = parsePropertyGridColor(state.row.value) ?? { r: 17, g: 24, b: 39, a: 1 }
    this._colorPopup.open({
      color,
      anchor: this._anchor(state),
      onConfirm: next => {
        const current = this._current(state.sessionKey)
        return current ? this._commitCurrent(current, colorToPropertyGridHex(next), colorToPropertyGridHex(next)) : false
      },
      onCancel: () => {},
      clearable: state.row.clearable,
      onClear: state.row.clearable
        ? () => {
            const current = this._current(state.sessionKey)
            return current ? this._commitCurrent(current, '', '') : false
          }
        : undefined,
      onTab: direction => this._moveAfterTab(state.sessionKey, state.rowKey, direction),
      onClose: () => this._finish(state.sessionKey),
    })
    this._markNeedsPaint()
    return true
  }

  private _openDate(state: PropertyGridPopupEditState): boolean {
    this._datePopup.open({
      anchor: this._anchor(state),
      selected: parseISOCalendarDate(state.row.value),
      onSelect: date => {
        const current = this._current(state.sessionKey)
        const value = formatISOCalendarDate(date)
        return current ? this._commitCurrent(current, value, value) : false
      },
      clearable: state.row.clearable,
      onClear: state.row.clearable
        ? () => {
            const current = this._current(state.sessionKey)
            return current ? this._commitCurrent(current, '', '') : false
          }
        : undefined,
      onTab: direction => this._moveAfterTab(state.sessionKey, state.rowKey, direction),
      onClose: () => this._finish(state.sessionKey),
    })
    this._markNeedsPaint()
    return true
  }

  private _commitCurrent(state: PropertyGridPopupEditState, nextValue: unknown, displayValue: unknown): boolean {
    const row = this._getRowByKey(state.rowKey)
    if (!row?.editable || (row.editor ?? row.kind) !== state.editor) return false
    state.row = row
    if (!this._commitValue(row, nextValue, displayValue)) {
      state.errorText = row.errorText?.trim() || '值未通过校验'
      this._markNeedsPaint()
      return false
    }
    state.errorText = undefined
    return true
  }

  private _current(sessionKey: object): PropertyGridPopupEditState | undefined {
    return this._state?.sessionKey === sessionKey ? this._state : undefined
  }

  private _finish(sessionKey: object): void {
    if (this._state?.sessionKey !== sessionKey) return
    this._state = null
    this._markNeedsPaint()
  }

  private _moveAfterTab(sessionKey: object, rowKey: string, direction: 1 | -1): void {
    if (this._state?.sessionKey === sessionKey) this._state = null
    this._moveByTab(rowKey, direction)
  }

  private _anchor(state: PropertyGridPopupEditState): { target: PopupAnchorTarget; data: { id: string; group: string; name: string; cell: 'value' } } {
    return {
      target: this._owner,
      data: { id: state.rowKey, group: state.row.group, name: state.row.name, cell: 'value' },
    }
  }

  private _popupFor(editor: PropertyGridPopupEditState['editor']): DropdownPopup | ColorPickerPopup | DatePickerPopup {
    if (editor === 'enum') return this._enumPopup
    if (editor === 'color') return this._colorPopup
    return this._datePopup
  }
}

function enumToken(index: number): string {
  return `property-grid-enum:${index}`
}

function enumIndex(token: string): number | undefined {
  const match = /^property-grid-enum:(\d+)$/.exec(token)
  if (!match) return undefined
  const index = Number(match[1])
  return Number.isInteger(index) ? index : undefined
}

function propertyGridValueText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parsePropertyGridColor(value: string): Color | undefined {
  const match = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(value.trim())
  if (!match) return undefined
  const hex = match[1]!
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  }
}

function colorToPropertyGridHex(color: Color): string {
  const hex = (value: number): string => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  const alpha = Math.max(0, Math.min(1, color.a))
  const base = `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`
  return alpha < 1 ? `${base}${hex(alpha * 255)}` : base
}
