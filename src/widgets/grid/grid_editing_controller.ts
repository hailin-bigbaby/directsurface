import { FocusManager, type Focusable } from '../../core/focus_manager'
import { PopupManager } from '../../core/popup_manager'
import type { Offset } from '../../core/render_object'
import {
  resolveSingleLineEditableTextLayout,
  SingleLineTextInput,
} from '../../core/single_line_text_input'
import { TextEditSession } from '../../core/text_edit_session'
import { TextInputController } from '../../core/text_input_controller'
import { resolveSingleLineTextOriginX } from '../../rendering/single_line_text_renderer'
import {
  pointerKey,
  type PointerKey,
  type PointerType,
} from '../../gestures/pointer_identity'
import type { GridCellPopupEditors } from './grid_cell_popup_editors'
import { resolveGridColumnEditorKind, stepGridNumberValue } from './grid_column_editor'
import { resolveNumberStepperDirection } from './grid_interaction_hit'
import type { EditState, GridColumnDef, GridRowId } from './grid_types'
import type { GridEditableStructure } from './grid_structure_edit_controller'

export interface GridPointerIdentity {
  pointerId: number
  pointerType?: PointerType
}

const DEFAULT_GRID_POINTER_IDENTITY: GridPointerIdentity = {
  pointerId: 0,
  pointerType: 'mouse',
}

type NumberStepperDirection = 'up' | 'down'

interface NumberStepperPress {
  direction: NumberStepperDirection
  editSessionKey: object
  inside: boolean
}

interface NumberStepperHover {
  direction: NumberStepperDirection
  editSessionKey: object
}

export interface GridEditingControllerOptions<T extends Record<string, any>> {
  owner: object
  focusableOwner: Focusable
  structureEditing: GridEditableStructure<T>
  cellPopupEditors: GridCellPopupEditors<T>
  editable: () => boolean
  getColumns: () => GridColumnDef<T>[]
  getVisibleRows: () => T[]
  getVisibleRowId: (row: number) => GridRowId | null
  getVisibleRowIndexForRowId: (rowId: GridRowId) => number
  getEditTextMetrics: (row: number, col: number) => {
    paddingH: number
    fontSize: number
    fontFamily: string
    numberStepperWidth: number
    align?: 'left' | 'center' | 'right'
  }
  measureText: (text: string, fontSize: number, fontFamily: string) => number
  getCellGlobalRect: (row: number, col: number) => { x: number; y: number; w: number; h: number }
  getCellEditRect?: (row: number, col: number) => { x: number; y: number; w: number; h: number }
  onMarkNeedsPaint: () => void
  onRevealCell: (row: number, col: number) => void
  onRevealCaret?: (
    row: number,
    col: number,
    columnOffsetX: number,
    insets: { start: number; end: number },
  ) => boolean
  onFocusedCellChange: (row: number, col: number) => void
}

export class GridEditingController<T extends Record<string, any> = any> {
  private readonly _owner: object
  private readonly _focusableOwner: Focusable
  private readonly _structureEditing: GridEditableStructure<T>
  private readonly _cellPopupEditors: GridCellPopupEditors<T>
  private readonly _editable: GridEditingControllerOptions<T>['editable']
  private readonly _getColumns: GridEditingControllerOptions<T>['getColumns']
  private readonly _getVisibleRows: GridEditingControllerOptions<T>['getVisibleRows']
  private readonly _getVisibleRowId: GridEditingControllerOptions<T>['getVisibleRowId']
  private readonly _getVisibleRowIndexForRowId: GridEditingControllerOptions<T>['getVisibleRowIndexForRowId']
  private readonly _getEditTextMetrics: GridEditingControllerOptions<T>['getEditTextMetrics']
  private readonly _measureText: GridEditingControllerOptions<T>['measureText']
  private readonly _getCellGlobalRect: GridEditingControllerOptions<T>['getCellGlobalRect']
  private readonly _getCellEditRect: NonNullable<GridEditingControllerOptions<T>['getCellEditRect']>
  private readonly _onMarkNeedsPaint: GridEditingControllerOptions<T>['onMarkNeedsPaint']
  private readonly _onRevealCell: GridEditingControllerOptions<T>['onRevealCell']
  private readonly _onRevealCaret: NonNullable<GridEditingControllerOptions<T>['onRevealCaret']>
  private readonly _onFocusedCellChange: GridEditingControllerOptions<T>['onFocusedCellChange']

  private _edit: EditState | null = null
  private _editSessionKey: object | null = null
  private readonly _numberStepperPresses = new Map<PointerKey, NumberStepperPress>()
  private readonly _numberStepperHovers = new Map<PointerKey, NumberStepperHover>()
  readonly input = new TextInputController({ onInvalidate: () => this._onMarkNeedsPaint() })
  readonly singleLineInput = new SingleLineTextInput({
    controller: this.input,
    getDisplayText: () => this._edit?.text ?? '',
    measureText: text => {
      if (!this._edit) return 0
      const metrics = this._getEditTextMetrics(this._edit.row, this._edit.col)
      return this._measureText(text, metrics.fontSize, metrics.fontFamily)
    },
    getViewportWidth: () => {
      if (!this._edit) return 0
      const metrics = this._getEditTextMetrics(this._edit.row, this._edit.col)
      const column = this._getColumns()[this._edit.col]
      const stepperWidth = column && resolveGridColumnEditorKind(column) === 'number'
        ? metrics.numberStepperWidth
        : 0
      return Math.max(
        0,
        this._getCellEditRect(this._edit.row, this._edit.col).w - metrics.paddingH * 2 - stepperWidth,
      )
    },
    getViewportOffsetX: () => {
      if (!this._edit) return 0
      const editRect = this._getCellEditRect(this._edit.row, this._edit.col)
      return Math.max(0, editRect.x - this.activeTextOriginX())
    },
    getTextOrigin: () => {
      if (!this._edit) return { x: 0, y: 0 }
      const rect = this._getCellGlobalRect(this._edit.row, this._edit.col)
      const metrics = this._getEditTextMetrics(this._edit.row, this._edit.col)
      return { x: this.activeTextOriginX(), y: rect.y + metrics.paddingH }
    },
  })
  readonly session = new TextEditSession({
    controller: this.input,
    isActive: () => this._edit !== null,
    syncSelectionFromComposer: opts => this.input.syncSelectionFromComposer(opts),
    scrollToCursor: () => this.scrollActiveTextCaretIntoView(),
    updateComposerPosition: () => this.singleLineInput.updateComposerPositionAt(this.input.cursorPos),
    invalidate: () => this._onMarkNeedsPaint(),
  })

  constructor(options: GridEditingControllerOptions<T>) {
    this._owner = options.owner
    this._focusableOwner = options.focusableOwner
    this._structureEditing = options.structureEditing
    this._cellPopupEditors = options.cellPopupEditors
    this._editable = options.editable
    this._getColumns = options.getColumns
    this._getVisibleRows = options.getVisibleRows
    this._getVisibleRowId = options.getVisibleRowId
    this._getVisibleRowIndexForRowId = options.getVisibleRowIndexForRowId
    this._getEditTextMetrics = options.getEditTextMetrics
    this._measureText = options.measureText
    this._getCellGlobalRect = options.getCellGlobalRect
    this._getCellEditRect = options.getCellEditRect ?? options.getCellGlobalRect
    this._onMarkNeedsPaint = options.onMarkNeedsPaint
    this._onRevealCell = options.onRevealCell
    this._onRevealCaret = options.onRevealCaret ?? (() => false)
    this._onFocusedCellChange = options.onFocusedCellChange
  }

  get state(): EditState | null { return this._edit }
  get editSessionKey(): object | null { return this._editSessionKey }

  get editingCell(): { row: number; col: number; key: string; text: string } | null {
    if (!this._edit) return null
    const column = this._getColumns()[this._edit.col]
    return {
      row: this._edit.row,
      col: this._edit.col,
      key: column?.key ?? '',
      text: this._edit.text,
    }
  }

  beginEdit(rowIndex: number, colIndex: number): boolean {
    const visibleRows = this._getVisibleRows()
    if (rowIndex < 0 || rowIndex >= visibleRows.length) return false
    if (colIndex < 0 || colIndex >= this._getColumns().length) return false
    return this.startEdit(rowIndex, colIndex)
  }

  commitEdit(): boolean {
    if (!this._edit) return true
    const { row, col, text } = this._edit
    if (!this._structureEditing.canEditCell(row, col)) {
      this.endEdit()
      return true
    }
    const column = this._getColumns()[col]
    const visibleRow = this._getVisibleRows()[row]
    if (
      column &&
      visibleRow &&
      resolveGridColumnEditorKind(column) !== 'checkbox' &&
      resolveGridColumnEditorKind(column) !== 'select' &&
      resolveGridColumnEditorKind(column) !== 'lookup' &&
      resolveGridColumnEditorKind(column) !== 'date' &&
      resolveGridColumnEditorKind(column) !== 'drop-tree' &&
      resolveGridColumnEditorKind(column) !== 'drop-tree-grid'
    ) {
      this._structureEditing.commitVisibleCell(row, col, text, this._edit.originalValue)
      if (this._structureEditing.cellError(row, col)) {
        this.refreshActiveTextPresentation()
        this._onMarkNeedsPaint()
        return false
      }
    }
    this.endEdit()
    return true
  }

  cancelEdit(): void {
    this.endEdit()
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this._edit) return false
    if (event.defaultPrevented) return true
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && this.isEditingNumber() && !this.input.composing) {
      event.preventDefault()
      this.stepNumberEdit(event.key === 'ArrowUp' ? 1 : -1)
      return true
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      this.commitEditAndMoveByTab(event.shiftKey)
      return true
    }
    return false
  }

  endEdit(options: { restoreFocus?: boolean } = {}): void {
    if (!this._edit) return
    this.clearNumberStepperTracking()
    this._editSessionKey = null
    this._edit = null
    this.session.end()
    PopupManager.instance.closeOwnedBy(this._owner)
    if (options.restoreFocus ?? true) {
      FocusManager.instance.setFocus(this._focusableOwner)
    }
    this._onMarkNeedsPaint()
  }

  handleVisibleRowsChanged(visibleCount: number, allowEndEdit = true): boolean {
    if (this._edit?.rowRef) {
      const nextRow = this._getVisibleRows().indexOf(this._edit.rowRef as T)
      if (nextRow >= 0) {
        this._edit.row = nextRow
        return false
      }
      if (this._edit.rowId === undefined || this._edit.rowId === null) {
        if (allowEndEdit) {
          this.endEdit()
          return true
        }
        return false
      }
    }
    if (this._edit?.rowId !== undefined && this._edit.rowId !== null) {
      const nextRow = this._getVisibleRowIndexForRowId(this._edit.rowId)
      if (nextRow >= 0) {
        this._edit.row = nextRow
        return false
      }
      if (allowEndEdit) {
        this.endEdit()
        return true
      }
      return false
    }
    if (allowEndEdit && this._edit && (visibleCount === 0 || this._edit.row >= visibleCount)) {
      this.endEdit()
      return true
    }
    return false
  }

  handlePointerDownInEditingCell(
    globalX: number,
    globalY: number,
    pointer: GridPointerIdentity = DEFAULT_GRID_POINTER_IDENTITY,
  ): boolean {
    if (!this._edit) return false
    const column = this._getColumns()[this._edit.col]
    const editorKind = column ? resolveGridColumnEditorKind(column) : null
    if (!column || (editorKind !== 'text' && editorKind !== 'number' && editorKind !== 'time')) return false
    if (editorKind === 'number') {
      const direction = this.numberStepperHit(globalX, globalY)
      if (direction) {
        return this.beginNumberStepperPress(direction, pointer)
      }
    }
    this.session.focusComposer()
    this.singleLineInput.setSelectionFromGlobal(globalX, { syncComposer: true })
    this._edit.dragging = true
    this.session.refresh({ resetBlink: true })
    return true
  }

  selectWordAt(globalX: number, globalY: number): boolean {
    if (!this._edit) return false
    const column = this._getColumns()[this._edit.col]
    const editorKind = column ? resolveGridColumnEditorKind(column) : null
    if (!column || (editorKind !== 'text' && editorKind !== 'number' && editorKind !== 'time')) {
      return false
    }
    const rect = this._getCellEditRect(this._edit.row, this._edit.col)
    if (
      globalX < rect.x || globalX > rect.x + rect.w ||
      globalY < rect.y || globalY > rect.y + rect.h ||
      (editorKind === 'number' && this.numberStepperHit(globalX, globalY))
    ) return false

    this.session.focusComposer()
    this._edit.dragging = false
    const range = this.singleLineInput.selectWordFromGlobal(globalX, {
      syncComposer: true,
    })
    if (!range) return false
    this.session.refresh({
      scrollToCursor: false,
      updateComposerPosition: true,
      resetBlink: true,
    })
    return true
  }

  handlePointerMove(
    globalX: number,
    globalY: number,
    pointer: GridPointerIdentity = DEFAULT_GRID_POINTER_IDENTITY,
  ): boolean {
    if (!this._edit) return false
    const column = this._getColumns()[this._edit.col]
    const editorKind = column ? resolveGridColumnEditorKind(column) : null
    if (!column || (editorKind !== 'text' && editorKind !== 'number' && editorKind !== 'time')) return false
    if (this._edit.dragging) {
      this.singleLineInput.setSelectionFromGlobal(globalX, {
        extend: true,
        syncComposer: true,
      })
      this.session.refresh()
      return true
    }
    if (editorKind !== 'number') return false
    return this.updateNumberStepperPointer(globalX, globalY, pointer)
  }

  stopDrag(): void {
    if (!this._edit) return
    this._edit.dragging = false
  }

  clearPointerState(): boolean {
    if (!this._edit) return false
    const changed = !!this._edit.numberStepperHovered || !!this._edit.numberStepperPressed || this._edit.dragging
    this.clearNumberStepperTracking()
    this._edit.numberStepperHovered = null
    this._edit.numberStepperPressed = null
    this._edit.dragging = false
    if (changed) this._onMarkNeedsPaint()
    return changed
  }

  clearNumberStepperPointerState(): boolean {
    if (!this._edit) return false
    const changed = !!this._edit.numberStepperHovered || !!this._edit.numberStepperPressed
    this.clearNumberStepperTracking()
    this._edit.numberStepperHovered = null
    this._edit.numberStepperPressed = null
    if (changed) this._onMarkNeedsPaint()
    return changed
  }

  beginNumberStepperPress(
    direction: NumberStepperDirection,
    pointer: GridPointerIdentity,
  ): boolean {
    if (!this._edit || !this._editSessionKey || !this.isEditingNumber()) return false
    const pointerKey = numberStepperPointerKey(pointer)
    this._numberStepperPresses.delete(pointerKey)
    this._numberStepperPresses.set(pointerKey, {
      direction,
      editSessionKey: this._editSessionKey,
      inside: true,
    })
    this.setNumberStepperHover(pointerKey, direction)
    const changed = this.syncNumberStepperVisualState()
    this.session.focusComposer()
    if (changed) this._onMarkNeedsPaint()
    return true
  }

  updateNumberStepperPointer(
    globalX: number,
    globalY: number,
    pointer: GridPointerIdentity,
  ): boolean {
    if (!this._edit || !this._editSessionKey || !this.isEditingNumber()) return false
    const pointerKey = numberStepperPointerKey(pointer)
    const hovered = this.numberStepperHit(globalX, globalY)
    const press = this._numberStepperPresses.get(pointerKey)
    if (press && press.editSessionKey !== this._editSessionKey) {
      this._numberStepperPresses.delete(pointerKey)
    } else if (press) {
      press.inside = hovered === press.direction
    }
    this.setNumberStepperHover(pointerKey, hovered)
    if (this.syncNumberStepperVisualState()) this._onMarkNeedsPaint()
    return hovered !== null || this._numberStepperPresses.has(pointerKey)
  }

  finishNumberStepperPress(
    globalX: number,
    globalY: number,
    activate: boolean,
    pointer: GridPointerIdentity,
  ): boolean {
    const pointerKey = numberStepperPointerKey(pointer)
    const press = this._numberStepperPresses.get(pointerKey)
    this._numberStepperPresses.delete(pointerKey)
    if (!this._edit || !this._editSessionKey || !press) {
      this._numberStepperHovers.delete(pointerKey)
      if (this.syncNumberStepperVisualState()) this._onMarkNeedsPaint()
      return false
    }
    const hovered = this.numberStepperHit(globalX, globalY)
    const eligible =
      press.editSessionKey === this._editSessionKey &&
      hovered === press.direction
    if (pointer.pointerType === 'touch') {
      this._numberStepperHovers.delete(pointerKey)
    } else {
      this.setNumberStepperHover(pointerKey, hovered)
    }
    if (this.syncNumberStepperVisualState()) this._onMarkNeedsPaint()
    if (!eligible) return false
    if (activate) {
      this.session.focusComposer()
      return this.stepNumberEdit(press.direction === 'up' ? 1 : -1)
    }
    return true
  }

  cancelNumberStepperPress(
    clearHover = false,
    pointer?: GridPointerIdentity,
  ): boolean {
    if (!this._edit) return false
    if (pointer) {
      const pointerKey = numberStepperPointerKey(pointer)
      this._numberStepperPresses.delete(pointerKey)
      if (clearHover) this._numberStepperHovers.delete(pointerKey)
    } else {
      this._numberStepperPresses.clear()
      if (clearHover) this._numberStepperHovers.clear()
    }
    const changed = this.syncNumberStepperVisualState()
    if (changed) this._onMarkNeedsPaint()
    return changed
  }

  setNumberStepperHovered(
    direction: NumberStepperDirection | null,
    pointer: GridPointerIdentity,
  ): void {
    if (!this._edit || !this._editSessionKey) return
    this.setNumberStepperHover(numberStepperPointerKey(pointer), direction)
    if (this.syncNumberStepperVisualState()) this._onMarkNeedsPaint()
  }

  clearNumberStepperHover(pointer?: GridPointerIdentity): boolean {
    if (!this._edit) return false
    if (pointer) {
      const pointerKey = numberStepperPointerKey(pointer)
      this._numberStepperHovers.delete(pointerKey)
      const press = this._numberStepperPresses.get(pointerKey)
      if (press) press.inside = false
    } else {
      this._numberStepperHovers.clear()
      for (const press of this._numberStepperPresses.values()) press.inside = false
    }
    const changed = this.syncNumberStepperVisualState()
    if (changed) this._onMarkNeedsPaint()
    return changed
  }

  numberStepperDirectionAt(position: Offset): 'up' | 'down' | null {
    return this.numberStepperHit(position.x, position.y)
  }

  activateNumberStepper(
    direction: NumberStepperDirection,
  ): boolean {
    if (!this._editSessionKey || !this.isEditingNumber()) return false
    this.session.focusComposer()
    return this.stepNumberEdit(direction === 'up' ? 1 : -1)
  }

  refreshOverlayPosition(): void {
    if (!this._edit) return
    const column = this._getColumns()[this._edit.col]
    const editorKind = column ? resolveGridColumnEditorKind(column) : null
    if (editorKind === 'text' || editorKind === 'number' || editorKind === 'time') {
      this.scrollActiveTextCaretIntoView()
      this.singleLineInput.updateComposerPositionAt(this.input.cursorPos)
    }
  }

  refreshActiveTextPresentation(): void {
    if (!this._edit) return
    const column = this._getColumns()[this._edit.col]
    const editorKind = column ? resolveGridColumnEditorKind(column) : null
    if (editorKind !== 'text' && editorKind !== 'number' && editorKind !== 'time') return
    this.session.refresh({
      scrollToCursor: true,
      updateComposerPosition: true,
      invalidate: false,
    })
  }

  startEdit(rowIndex: number, colIndex: number): boolean {
    if (!this._editable()) return false
    const requestedRow = this._getVisibleRows()[rowIndex]
    const requestedColumn = this._getColumns()[colIndex]
    if (!requestedRow || !requestedColumn) return false
    if (!this._structureEditing.canEditCell(rowIndex, colIndex)) return false
    const requestedRowId = this._getVisibleRowId(rowIndex)

    if (this.commitEdit() === false) return false

    const rows = this._getVisibleRows()
    const columns = this._getColumns()
    const rowRefIndex = rows.indexOf(requestedRow)
    const resolvedRowIndex = rowRefIndex >= 0
      ? rowRefIndex
      : requestedRowId !== null ? this._getVisibleRowIndexForRowId(requestedRowId) : -1
    const resolvedColIndex = columns.findIndex(column => column.key === requestedColumn.key)
    if (resolvedRowIndex < 0 || resolvedColIndex < 0) return false
    if (!this._structureEditing.canEditCell(resolvedRowIndex, resolvedColIndex)) return false

    rowIndex = resolvedRowIndex
    colIndex = resolvedColIndex
    const row = rows[rowIndex]
    const column = columns[colIndex]
    if (!row || !column) return false
    this._onRevealCell(rowIndex, colIndex)
    const rawValue = row[column.key]
    const editorKind = resolveGridColumnEditorKind(column)

    if (editorKind === 'checkbox') {
      this._onFocusedCellChange(rowIndex, colIndex)
      const changed = this._structureEditing.commitVisibleValue(rowIndex, column.key, !rawValue)
      this._onMarkNeedsPaint()
      return changed
    }

    if (
      editorKind === 'select' ||
      editorKind === 'lookup' ||
      editorKind === 'date' ||
      editorKind === 'drop-tree' ||
      editorKind === 'drop-tree-grid'
    ) {
      this._onFocusedCellChange(rowIndex, colIndex)
      this._edit = { row: rowIndex, col: colIndex, rowRef: row, originalValue: rawValue, text: '', dragging: false, rowId: this._getVisibleRowId(rowIndex) }
      this._editSessionKey = {}
      this._cellPopupEditors.openColumnEditorPopup(rowIndex, colIndex, column)
      this._onMarkNeedsPaint()
      return true
    }

    const initialText = editorKind === 'number'
      ? String(rawValue ?? 0)
      : editorKind === 'time'
        ? String(this._structureEditing.normalizeValue(column, rawValue, rawValue) ?? '')
        : String(rawValue ?? '')
    this._edit = {
      row: rowIndex,
      col: colIndex,
      rowRef: row,
      originalValue: rawValue,
      text: initialText,
      dragging: false,
      rowId: this._getVisibleRowId(rowIndex),
    }
    this._editSessionKey = {}
    this._onFocusedCellChange(rowIndex, colIndex)

    FocusManager.instance.clearFocus()
    this.input.setScrollX(0)
    this.session.start({
      initialValue: initialText,
      initialSelection: {
        start: 0,
        end: initialText.length,
        cursorPos: initialText.length,
        syncComposer: true,
      },
      focusComposer: true,
      refreshOnStart: {
        scrollToCursor: true,
        updateComposerPosition: false,
      },
      onInput: (value, session) => {
        if (!this._edit) return
        this._edit.text = value
        session.refresh({
          syncSelectionFromComposer: true,
          syncSelectionIgnoreComposing: true,
        })
      },
      onCompositionUpdate: (_text, session) => {
        if (!this._edit) return
        session.refresh({ resetBlink: true })
      },
      onCompositionEnd: (value, session) => {
        if (!this._edit) return
        this._edit.text = value
        session.refresh({
          syncSelectionFromComposer: true,
          syncSelectionIgnoreComposing: true,
        })
      },
      onKeyDown: (event, session) => {
        if (!this._edit) return
        if (event.key === 'Enter') {
          event.preventDefault()
          this.commitEdit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          this.cancelEdit()
        } else if (event.key === 'Tab') {
          event.preventDefault()
          this.commitEditAndMoveByTab(event.shiftKey)
        } else if (
          (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
          this.isEditingNumber() &&
          !this.input.composing
        ) {
          event.preventDefault()
          this.stepNumberEdit(event.key === 'ArrowUp' ? 1 : -1)
        } else {
          session.defer(() => {
            if (this.input.composing) return
          }, {
            syncSelectionFromComposer: true,
            syncSelectionIgnoreComposing: true,
          })
        }
      },
    })
    this.singleLineInput.updateComposerPositionAt(this.input.cursorPos)
    FocusManager.instance.setFocus(this._focusableOwner)
    return true
  }

  private isEditingNumber(): boolean {
    if (!this._edit) return false
    const column = this._getColumns()[this._edit.col]
    return !!column && resolveGridColumnEditorKind(column) === 'number'
  }

  private stepNumberEdit(direction: 1 | -1): boolean {
    if (!this._edit) return false
    const column = this._getColumns()[this._edit.col]
    if (!column) return false
    const result = stepGridNumberValue(column, this._edit.text, direction)
    if (!result) return false
    this._edit.text = result.text
    this.input.setComposerValue(result.text)
    this.input.setSelection(result.text.length, result.text.length, {
      cursorPos: result.text.length,
      syncComposer: true,
    })
    this.session.refresh({ resetBlink: true })
    return true
  }

  private clearNumberStepperTracking(): void {
    this._numberStepperPresses.clear()
    this._numberStepperHovers.clear()
  }

  private setNumberStepperHover(
    pointerKey: PointerKey,
    direction: NumberStepperDirection | null,
  ): void {
    this._numberStepperHovers.delete(pointerKey)
    if (!direction || !this._editSessionKey) return
    this._numberStepperHovers.set(pointerKey, {
      direction,
      editSessionKey: this._editSessionKey,
    })
  }

  private scrollActiveTextCaretIntoView(): void {
    if (!this._edit) return
    const column = this._getColumns()[this._edit.col]
    if (!column) return
    const editorKind = resolveGridColumnEditorKind(column)
    if (editorKind !== 'text' && editorKind !== 'number' && editorKind !== 'time') return

    const result = this.singleLineInput.scrollToCursor()
    const metrics = this._getEditTextMetrics(this._edit.row, this._edit.col)
    const textLayout = resolveSingleLineEditableTextLayout({
      controller: this.input,
      displayText: this._edit.text,
      measureText: text => this._measureText(text, metrics.fontSize, metrics.fontFamily),
    })
    const cursorOffsetX = textLayout.caretOffset
    const stepperWidth = editorKind === 'number' ? metrics.numberStepperWidth : 0
    const cellRect = this._getCellGlobalRect(this._edit.row, this._edit.col)
    const editRect = this._getCellEditRect(this._edit.row, this._edit.col)
    const caretOffsetX = this.activeTextOriginX() - cellRect.x + cursorOffsetX - this.input.scrollX
    const caretX = cellRect.x + caretOffsetX
    const caretInsideVisibleRect = editRect.w > 0 &&
      caretX >= editRect.x &&
      caretX < editRect.x + editRect.w
    if (
      result.unrevealedLeft <= 0 &&
      result.unrevealedRight <= 0 &&
      caretInsideVisibleRect
    ) return

    const changed = this._onRevealCaret(
      this._edit.row,
      this._edit.col,
      caretOffsetX,
      {
        start: metrics.paddingH + 4,
        end: metrics.paddingH + stepperWidth + 2,
      },
    )
    if (changed) this.singleLineInput.scrollToCursor()
  }

  private activeTextOriginX(): number {
    if (!this._edit) return 0
    const metrics = this._getEditTextMetrics(this._edit.row, this._edit.col)
    const rect = this._getCellGlobalRect(this._edit.row, this._edit.col)
    const column = this._getColumns()[this._edit.col]
    const stepperWidth = column && resolveGridColumnEditorKind(column) === 'number'
      ? metrics.numberStepperWidth
      : 0
    return resolveSingleLineTextOriginX({
      contentX: rect.x + metrics.paddingH,
      contentWidth: Math.max(0, rect.w - metrics.paddingH * 2 - stepperWidth),
      textWidth: resolveSingleLineEditableTextLayout({
        controller: this.input,
        displayText: this._edit.text,
        measureText: text => this._measureText(text, metrics.fontSize, metrics.fontFamily),
      }).totalWidth,
      align: metrics.align ?? 'left',
    })
  }

  private syncNumberStepperVisualState(): boolean {
    if (!this._edit) return false
    let hovered: NumberStepperDirection | null = null
    let pressed: NumberStepperDirection | null = null

    for (const [pointerKey, hover] of this._numberStepperHovers) {
      if (hover.editSessionKey !== this._editSessionKey) {
        this._numberStepperHovers.delete(pointerKey)
        continue
      }
      hovered = hover.direction
    }
    for (const [pointerKey, press] of this._numberStepperPresses) {
      if (press.editSessionKey !== this._editSessionKey) {
        this._numberStepperPresses.delete(pointerKey)
        continue
      }
      if (press.inside) pressed = press.direction
    }

    const changed =
      this._edit.numberStepperHovered !== hovered ||
      this._edit.numberStepperPressed !== pressed
    this._edit.numberStepperHovered = hovered
    this._edit.numberStepperPressed = pressed
    return changed
  }

  private numberStepperHit(globalX: number, globalY: number): 'up' | 'down' | null {
    if (!this._edit || !this.isEditingNumber()) return null
    const rect = this._getCellGlobalRect(this._edit.row, this._edit.col)
    const metrics = this._getEditTextMetrics(this._edit.row, this._edit.col)
    return resolveNumberStepperDirection(
      { x: globalX, y: globalY },
      rect,
      metrics.numberStepperWidth,
    )
  }

  private commitEditAndMoveByTab(shiftKey: boolean): void {
    if (!this._edit) return
    const { row, col } = this._edit
    if (!this.commitEdit()) return
    if (shiftKey) this.moveToPrevTabStop(row, col)
    else this.moveToNextTabStop(row, col)
  }

  private moveToNextTabStop(rowIndex: number, colIndex: number): void {
    const columns = this._getColumns()
    for (let index = colIndex + 1; index < columns.length; index++) {
      if (!this._structureEditing.isCellTabStop(rowIndex, index)) continue
      this.focusTabStop(rowIndex, index)
      return
    }
    const rows = this._getVisibleRows()
    for (let nextRow = rowIndex + 1; nextRow < rows.length; nextRow++) {
      for (let index = 0; index < columns.length; index++) {
        if (!this._structureEditing.isCellTabStop(nextRow, index)) continue
        this.focusTabStop(nextRow, index)
        return
      }
    }
  }

  private moveToPrevTabStop(rowIndex: number, colIndex: number): void {
    const columns = this._getColumns()
    for (let index = colIndex - 1; index >= 0; index--) {
      if (!this._structureEditing.isCellTabStop(rowIndex, index)) continue
      this.focusTabStop(rowIndex, index)
      return
    }
    for (let previousRow = rowIndex - 1; previousRow >= 0; previousRow--) {
      for (let index = columns.length - 1; index >= 0; index--) {
        if (!this._structureEditing.isCellTabStop(previousRow, index)) continue
        this.focusTabStop(previousRow, index)
        return
      }
    }
  }

  private focusTabStop(rowIndex: number, colIndex: number): void {
    this._onRevealCell(rowIndex, colIndex)
    this._onFocusedCellChange(rowIndex, colIndex)
    if (this._structureEditing.canEditCell(rowIndex, colIndex)) this.startEdit(rowIndex, colIndex)
  }

  dispose(): void {
    this.endEdit({ restoreFocus: false })
    this.input.dispose()
  }
}

function numberStepperPointerKey(pointer: GridPointerIdentity): PointerKey {
  return pointerKey(pointer)
}
