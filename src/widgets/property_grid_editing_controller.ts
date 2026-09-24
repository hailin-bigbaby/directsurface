import { FocusManager, type Focusable } from '../core/focus_manager'
import type { Offset, Rect } from '../core/render_object'
import {
  resolveSingleLineEditableTextLayout,
  SingleLineTextInput,
} from '../core/single_line_text_input'
import { TextEditSession, type TextEditSessionApi } from '../core/text_edit_session'
import { TextInputController } from '../core/text_input_controller'
import type { PointerEvent } from '../gestures/recognizers'
import { pointerKey, type PointerKey } from '../gestures/pointer_identity'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import {
  paintSingleLineEditableText,
  resolveSingleLineTextOriginX,
} from '../rendering/single_line_text_renderer'
import { deriveGridCellStyle } from '../theme/component_styles'
import { paintNumberStepper, resolveNumberStepperDirection } from './number_stepper'
import type { PropertyGridRow } from './property_grid'

export interface PropertyGridInlineEditState {
  readonly sessionKey: object
  readonly rowKey: string
  row: PropertyGridRow
  readonly editor: 'text' | 'number'
  readonly originalValue: string
  draftText: string
  dragging: boolean
  suspended: boolean
  errorText?: string
  numberStepperHovered: 'up' | 'down' | null
  numberStepperPressed: 'up' | 'down' | null
}

export interface PropertyGridInlineEditingStateSnapshot {
  readonly rowId?: string
  readonly group: string
  readonly name: string
  readonly editor: 'text' | 'number'
  readonly draftValue: string
  readonly errorText?: string
  readonly suspended: boolean
  readonly mode: 'inline'
}

export interface PropertyGridInlineEditingControllerOptions {
  owner: Focusable
  getRowByKey: (key: string) => PropertyGridRow | undefined
  getValueRect: (key: string) => Rect | undefined
  getTextMetrics: () => { fontSize: number; fontFamily: string; paddingH: number }
  getNumberStepperWidth: () => number
  measureText: (text: string, fontSize: number, fontFamily: string) => number
  commitValue: (row: PropertyGridRow, nextValue: unknown, displayValue?: unknown) => boolean
  reportError: (row: PropertyGridRow, message: string) => void
  moveByTab: (rowKey: string, direction: 1 | -1) => void
  markNeedsPaint: () => void
}

interface NumberStepperPress {
  readonly pointerKey: PointerKey
  readonly sessionKey: object
  readonly direction: 'up' | 'down'
  inside: boolean
}

const strictNumberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

export class PropertyGridInlineEditingController {
  private readonly _owner: Focusable
  private readonly _getRowByKey: PropertyGridInlineEditingControllerOptions['getRowByKey']
  private readonly _getValueRect: PropertyGridInlineEditingControllerOptions['getValueRect']
  private readonly _getTextMetrics: PropertyGridInlineEditingControllerOptions['getTextMetrics']
  private readonly _getNumberStepperWidth: PropertyGridInlineEditingControllerOptions['getNumberStepperWidth']
  private readonly _measureText: PropertyGridInlineEditingControllerOptions['measureText']
  private readonly _commitValue: PropertyGridInlineEditingControllerOptions['commitValue']
  private readonly _reportError: PropertyGridInlineEditingControllerOptions['reportError']
  private readonly _moveByTab: PropertyGridInlineEditingControllerOptions['moveByTab']
  private readonly _markNeedsPaint: PropertyGridInlineEditingControllerOptions['markNeedsPaint']
  private _state: PropertyGridInlineEditState | null = null
  private _stepperPress: NumberStepperPress | null = null

  readonly input = new TextInputController({ onInvalidate: () => this._markNeedsPaint() })
  readonly singleLineInput = new SingleLineTextInput({
    controller: this.input,
    getDisplayText: () => this._state?.draftText ?? '',
    measureText: text => this._measureDraft(text),
    getViewportWidth: () => this._textViewportWidth(),
    getTextOrigin: () => ({ x: this._textOriginX(), y: this._textOriginY() }),
  })
  readonly session = new TextEditSession({
    controller: this.input,
    isActive: () => !!this._state && !this._state.suspended,
    syncSelectionFromComposer: options => this.input.syncSelectionFromComposer(options),
    scrollToCursor: () => this.singleLineInput.scrollToCursor(),
    updateComposerPosition: () => this.singleLineInput.updateComposerPositionAt(this.input.cursorPos),
    invalidate: () => this._markNeedsPaint(),
  })

  constructor(options: PropertyGridInlineEditingControllerOptions) {
    this._owner = options.owner
    this._getRowByKey = options.getRowByKey
    this._getValueRect = options.getValueRect
    this._getTextMetrics = options.getTextMetrics
    this._getNumberStepperWidth = options.getNumberStepperWidth
    this._measureText = options.measureText
    this._commitValue = options.commitValue
    this._reportError = options.reportError
    this._moveByTab = options.moveByTab
    this._markNeedsPaint = options.markNeedsPaint
  }

  get state(): PropertyGridInlineEditState | null { return this._state }
  get isEditing(): boolean { return this._state !== null }
  get isComposing(): boolean { return this.input.composing }

  snapshot(): PropertyGridInlineEditingStateSnapshot | undefined {
    const state = this._state
    if (!state) return undefined
    return {
      rowId: state.row.id,
      group: state.row.group,
      name: state.row.name,
      editor: state.editor,
      draftValue: state.draftText,
      errorText: state.errorText,
      suspended: state.suspended,
      mode: 'inline',
    }
  }

  isEditingRow(row: PropertyGridRow | undefined): boolean {
    return !!row && this._state?.row === row
  }

  beginEdit(options: {
    rowKey: string
    row: PropertyGridRow
    selectAll?: boolean
    pointerX?: number
    selectWord?: boolean
  }): boolean {
    const editor = options.row.editor ?? options.row.kind
    if (!options.row.editable || (editor !== 'text' && editor !== 'number')) return false
    const inlineEditor: 'text' | 'number' = editor === 'number' ? 'number' : 'text'
    if (this._state?.rowKey === options.rowKey && this._state.editor === inlineEditor) {
      if (this._state.suspended) this.resume()
      this.session.focusComposer()
      this._applyInitialPointerSelection(options)
      return true
    }
    if (this._state && !this.commitEdit({ restoreFocus: false })) return false

    FocusManager.instance.clearFocus()
    const draftText = inlineEditor === 'number'
      ? stripPropertyGridUnit(options.row.value, options.row.unit)
      : options.row.value
    this._state = {
      sessionKey: {},
      rowKey: options.rowKey,
      row: options.row,
      editor: inlineEditor,
      originalValue: options.row.value,
      draftText,
      dragging: false,
      suspended: false,
      numberStepperHovered: null,
      numberStepperPressed: null,
    }
    this.input.setScrollX(0)
    this._startSession({ selectAll: options.selectAll ?? options.pointerX === undefined })
    this._applyInitialPointerSelection(options)
    this.refreshGeometry()
    FocusManager.instance.setFocus(this._owner)
    this._markNeedsPaint()
    return true
  }

  commitEdit(options: { restoreFocus?: boolean } = {}): boolean {
    const state = this._state
    if (!state) return true
    const currentRow = this._getRowByKey(state.rowKey)
    if (!currentRow?.editable || (currentRow.editor ?? currentRow.kind) !== state.editor) {
      this.endEdit({ restoreFocus: options.restoreFocus })
      return true
    }
    state.row = currentRow
    let nextValue: unknown = state.draftText
    let displayValue: unknown = state.draftText
    if (state.editor === 'number') {
      const normalized = normalizePropertyGridNumberDraft(state.draftText, currentRow)
      if (!normalized) {
        this._reject('请输入有效数字')
        return false
      }
      nextValue = normalized.value
      displayValue = normalized.text
    }
    if (!this._commitValue(currentRow, nextValue, displayValue)) {
      state.errorText = currentRow.errorText?.trim() || '值未通过校验'
      this._markNeedsPaint()
      if (!state.suspended) this.session.focusComposer()
      return false
    }
    this.endEdit({ restoreFocus: options.restoreFocus })
    return true
  }

  cancelEdit(options: { restoreFocus?: boolean } = {}): boolean {
    if (!this._state) return false
    this.endEdit({ restoreFocus: options.restoreFocus })
    return true
  }

  endEdit(options: { restoreFocus?: boolean } = {}): void {
    if (!this._state) return
    this._state = null
    this._stepperPress = null
    this.session.end()
    this.input.clearComposition()
    this.input.setScrollX(0)
    if (options.restoreFocus ?? true) FocusManager.instance.setFocus(this._owner)
    this._markNeedsPaint()
  }

  suspendAfterRejectedFocusOut(): void {
    const state = this._state
    if (!state || state.suspended) return
    state.suspended = true
    state.dragging = false
    state.numberStepperHovered = null
    state.numberStepperPressed = null
    this._stepperPress = null
    this.session.end()
    this._markNeedsPaint()
  }

  resume(): boolean {
    const state = this._state
    if (!state?.suspended) return false
    state.suspended = false
    this._startSession({
      selection: {
        start: this.input.selStart,
        end: this.input.selEnd,
        cursorPos: this.input.cursorPos,
      },
    })
    this.refreshGeometry()
    this._markNeedsPaint()
    return true
  }

  syncRows(): void {
    const state = this._state
    if (!state) return
    const row = this._getRowByKey(state.rowKey)
    if (!row?.editable || (row.editor ?? row.kind) !== state.editor) {
      this.cancelEdit({ restoreFocus: false })
      return
    }
    state.row = row
    if (row.errorText?.trim()) state.errorText = row.errorText.trim()
    this.refreshGeometry()
  }

  refreshGeometry(): void {
    if (!this._state || this._state.suspended) return
    this.singleLineInput.scrollToCursor()
    this.singleLineInput.updateComposerPositionAt(this.input.cursorPos)
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    const state = this._state
    if (!state || state.suspended) return false
    if (event.defaultPrevented) return true
    if (this.input.composing) return false
    if (event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      const rowKey = state.rowKey
      const direction = event.shiftKey ? -1 : 1
      if (!this.commitEdit()) return true
      this._moveByTab(rowKey, direction)
      return true
    }
    if (state.editor === 'number' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      event.stopPropagation()
      this.stepNumber(event.key === 'ArrowUp' ? 1 : -1)
      return true
    }
    return false
  }

  handlePointerDown(event: PointerEvent): boolean {
    const state = this._state
    if (!state || state.suspended) return false
    const rect = this._getValueRect(state.rowKey)
    if (!rect || !pointInRect(event.position, rect)) return false
    this.session.focusComposer()
    if (state.editor === 'number') {
      const direction = resolveNumberStepperDirection(
        event.position,
        toStepperRect(rect),
        this._numberStepperWidth(),
      )
      if (direction) {
        const key = pointerKey(event)
        this._stepperPress = {
          pointerKey: key,
          sessionKey: state.sessionKey,
          direction,
          inside: true,
        }
        state.numberStepperHovered = direction
        state.numberStepperPressed = direction
        event.setPointerCapture?.()
        event.preventActivation?.()
        this._markNeedsPaint()
        return true
      }
    }
    if ((event.clickCount ?? 1) >= 2) {
      this.singleLineInput.selectWordFromGlobal(event.position.x, { syncComposer: true })
      state.dragging = false
    } else {
      this.singleLineInput.setSelectionFromGlobal(event.position.x, { syncComposer: true })
      state.dragging = true
      event.setPointerCapture?.()
    }
    this.session.refresh({ resetBlink: true })
    return true
  }

  handlePointerMove(event: PointerEvent): boolean {
    const state = this._state
    if (!state || state.suspended) return false
    if (this._stepperPress) {
      if (this._stepperPress.pointerKey !== pointerKey(event)) return false
      const rect = this._getValueRect(state.rowKey)
      const hovered = rect
        ? resolveNumberStepperDirection(event.position, toStepperRect(rect), this._numberStepperWidth())
        : null
      this._stepperPress.inside = hovered === this._stepperPress.direction
      state.numberStepperHovered = hovered
      state.numberStepperPressed = this._stepperPress.inside ? this._stepperPress.direction : null
      this._markNeedsPaint()
      return true
    }
    if (!state.dragging) return false
    this.singleLineInput.setSelectionFromGlobal(event.position.x, {
      extend: true,
      syncComposer: true,
    })
    this.session.refresh()
    return true
  }

  handlePointerUp(event: PointerEvent): boolean {
    const state = this._state
    if (!state) return false
    if (this._stepperPress) {
      if (this._stepperPress.pointerKey !== pointerKey(event)) return false
      const press = this._stepperPress
      this._stepperPress = null
      state.numberStepperHovered = null
      state.numberStepperPressed = null
      event.releasePointerCapture?.()
      if (press.sessionKey === state.sessionKey && press.inside) {
        this.stepNumber(press.direction === 'up' ? 1 : -1)
      }
      this._markNeedsPaint()
      return true
    }
    if (!state.dragging) return false
    state.dragging = false
    event.releasePointerCapture?.()
    this._markNeedsPaint()
    return true
  }

  handlePointerCancel(event: PointerEvent): boolean {
    const state = this._state
    if (!state) return false
    const hadPointerState = !!this._stepperPress || state.dragging || !!state.numberStepperHovered || !!state.numberStepperPressed
    this._stepperPress = null
    state.dragging = false
    state.numberStepperHovered = null
    state.numberStepperPressed = null
    event.releasePointerCapture?.()
    if (hadPointerState) this._markNeedsPaint()
    return hadPointerState
  }

  clearPointerState(): void {
    const state = this._state
    if (!state) return
    const changed = !!this._stepperPress || state.dragging || !!state.numberStepperHovered || !!state.numberStepperPressed
    this._stepperPress = null
    state.dragging = false
    state.numberStepperHovered = null
    state.numberStepperPressed = null
    if (changed) this._markNeedsPaint()
  }

  stepNumber(direction: 1 | -1): boolean {
    const state = this._state
    if (!state || state.editor !== 'number') return false
    const current = parseStrictNumber(state.draftText)
    const original = parseStrictNumber(stripPropertyGridUnit(state.originalValue, state.row.unit))
    const base = current ?? original ?? 0
    const step = Number.isFinite(state.row.step) && state.row.step! > 0 ? state.row.step! : 1
    const decimals = resolvePropertyGridNumberDecimals(state.row, state.draftText)
    const next = clampNumber(roundNumber(base + direction * step, decimals), state.row.min, state.row.max)
    const text = formatNumberDraft(next, decimals)
    state.draftText = text
    state.errorText = undefined
    this.input.setComposerValue(text)
    this.input.setSelection(text.length, text.length, {
      cursorPos: text.length,
      syncComposer: true,
    })
    this.session.refresh({ resetBlink: true, syncSelectionFromComposer: false })
    return true
  }

  paint(context: PaintContext, dl: DrawList, rect: Rect): void {
    const state = this._state
    if (!state) return
    const theme = context.theme
    const editStyle = deriveGridCellStyle(theme)
    const metrics = this._getTextMetrics()
    const stepperWidth = state.editor === 'number' ? this._numberStepperWidth(context) : 0
    const textRect = {
      x: rect.x + metrics.paddingH,
      y: rect.y,
      width: Math.max(0, rect.width - metrics.paddingH * 2 - stepperWidth),
      height: rect.height,
    }
    dl.fillRect(rect.x + 1, rect.y + 3, Math.max(0, rect.width - 2), Math.max(0, rect.height - 6), editStyle.editBg, 3)
    dl.pushClip(textRect.x, rect.y + 2, textRect.width, Math.max(0, rect.height - 4))
    const layout = resolveSingleLineEditableTextLayout({
      controller: this.input,
      displayText: state.draftText,
      measureText: text => this._measureDraft(text),
    })
    const textX = resolveSingleLineTextOriginX({
      contentX: textRect.x,
      contentWidth: textRect.width,
      textWidth: layout.totalWidth,
      align: state.editor === 'number' ? 'right' : 'left',
    }) - this.input.scrollX
    paintSingleLineEditableText({
      dl,
      controller: this.input,
      displayText: state.draftText,
      measureText: text => this._measureDraft(text),
      fontSize: metrics.fontSize,
      fontFamily: metrics.fontFamily,
      textX,
      textY: rect.y + rect.height / 2,
      lineTop: rect.y + 6,
      lineBottom: rect.y + rect.height - 6,
      textColor: editStyle.text,
      selectionBg: editStyle.selectionBg,
      caretColor: editStyle.text,
      compositionTextColor: { ...editStyle.text, a: 0.6 },
      compositionUnderlineColor: editStyle.editBorder,
      showSelection: !state.suspended,
      showCaret: !state.suspended,
    })
    dl.popClip()
    if (stepperWidth > 0) {
      paintNumberStepper(dl, {
        rect: {
          x: rect.x + rect.width - stepperWidth,
          y: rect.y,
          w: stepperWidth,
          h: rect.height,
        },
        tokens: editStyle.numberStepper,
        hovered: state.numberStepperHovered,
        pressed: state.numberStepperPressed,
      })
    }
    dl.strokeRect(
      rect.x + 1,
      rect.y + 3,
      Math.max(0, rect.width - 2),
      Math.max(0, rect.height - 6),
      state.suspended ? theme.borderControl : editStyle.editBorder,
      1,
      3,
    )
  }

  dispose(): void {
    this.endEdit({ restoreFocus: false })
    this.input.dispose()
  }

  private _startSession(options: {
    selectAll?: boolean
    selection?: { start: number; end: number; cursorPos: number }
  }): void {
    const state = this._state
    if (!state) return
    const selection = options.selection ?? (options.selectAll
      ? { start: 0, end: state.draftText.length, cursorPos: state.draftText.length }
      : { start: state.draftText.length, end: state.draftText.length, cursorPos: state.draftText.length })
    this.session.start({
      initialValue: state.draftText,
      initialSelection: { ...selection, syncComposer: true },
      focusComposer: true,
      refreshOnStart: { scrollToCursor: true, updateComposerPosition: false },
      onInput: (value, session) => this._applyInput(value, session),
      onCompositionUpdate: (_text, session) => session.refresh({ resetBlink: true }),
      onCompositionEnd: (value, session) => this._applyInput(value, session),
      onPaste: (event, session) => {
        const text = event.clipboardData?.getData('text/plain')
        if (text === undefined) return
        event.preventDefault()
        this.input.syncSelectionFromComposer({ ignoreComposing: true })
        const normalized = normalizeSingleLineText(text)
        const next = state.draftText.slice(0, this.input.selStart) + normalized + state.draftText.slice(this.input.selEnd)
        const cursor = this.input.selStart + normalized.length
        state.draftText = next
        state.errorText = undefined
        this.input.setComposerValue(next)
        this.input.setSelection(cursor, cursor, { cursorPos: cursor, syncComposer: true })
        session.refresh({ syncSelectionFromComposer: false, resetBlink: true })
      },
      onKeyDown: (event, session) => {
        if (!this._state || this.input.composing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          this.commitEdit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          this.cancelEdit()
        } else if (event.key === 'Tab') {
          event.preventDefault()
          event.stopPropagation()
          const rowKey = this._state.rowKey
          const direction = event.shiftKey ? -1 : 1
          if (this.commitEdit()) this._moveByTab(rowKey, direction)
        } else if (this._state.editor === 'number' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault()
          event.stopPropagation()
          this.stepNumber(event.key === 'ArrowUp' ? 1 : -1)
        } else {
          session.defer(() => {}, {
            syncSelectionFromComposer: true,
            syncSelectionIgnoreComposing: true,
          })
        }
      },
    })
  }

  private _applyInput(value: string, session: TextEditSessionApi): void {
    const state = this._state
    if (!state) return
    const normalized = normalizeSingleLineText(value)
    state.draftText = normalized
    state.errorText = undefined
    if (normalized !== value) this.input.setComposerValue(normalized)
    session.refresh({
      syncSelectionFromComposer: true,
      syncSelectionIgnoreComposing: true,
      resetBlink: true,
    })
  }

  private _applyInitialPointerSelection(options: {
    pointerX?: number
    selectWord?: boolean
  }): void {
    if (options.pointerX === undefined || !this._state) return
    if (options.selectWord) {
      this.singleLineInput.selectWordFromGlobal(options.pointerX, { syncComposer: true })
    } else {
      this.singleLineInput.setSelectionFromGlobal(options.pointerX, { syncComposer: true })
    }
    this.session.refresh({ resetBlink: true })
  }

  private _reject(message: string): void {
    const state = this._state
    if (!state) return
    state.errorText = message
    this._reportError(state.row, message)
    this._markNeedsPaint()
    if (!state.suspended) this.session.focusComposer()
  }

  private _measureDraft(text: string): number {
    const metrics = this._getTextMetrics()
    return this._measureText(text, metrics.fontSize, metrics.fontFamily)
  }

  private _numberStepperWidth(context?: PaintContext): number {
    return context ? deriveGridCellStyle(context.theme).numberStepper.width : this._getNumberStepperWidth()
  }

  private _textViewportWidth(): number {
    const state = this._state
    if (!state) return 0
    const rect = this._getValueRect(state.rowKey)
    if (!rect) return 0
    const metrics = this._getTextMetrics()
    const stepperWidth = state.editor === 'number' ? this._numberStepperWidth() : 0
    return Math.max(0, rect.width - metrics.paddingH * 2 - stepperWidth)
  }

  private _textOriginX(): number {
    const state = this._state
    if (!state) return 0
    const rect = this._getValueRect(state.rowKey)
    if (!rect) return 0
    const metrics = this._getTextMetrics()
    const stepperWidth = state.editor === 'number' ? this._numberStepperWidth() : 0
    const contentX = rect.x + metrics.paddingH
    const contentWidth = Math.max(0, rect.width - metrics.paddingH * 2 - stepperWidth)
    const layout = resolveSingleLineEditableTextLayout({
      controller: this.input,
      displayText: state.draftText,
      measureText: text => this._measureDraft(text),
    })
    return resolveSingleLineTextOriginX({
      contentX,
      contentWidth,
      textWidth: layout.totalWidth,
      align: state.editor === 'number' ? 'right' : 'left',
    })
  }

  private _textOriginY(): number {
    const state = this._state
    if (!state) return 0
    const rect = this._getValueRect(state.rowKey)
    return rect ? rect.y + this._getTextMetrics().paddingH : 0
  }
}

export function stripPropertyGridUnit(value: string, unit: string | undefined): string {
  if (!unit) return value
  const trimmed = value.trim()
  return trimmed.toLowerCase().endsWith(unit.toLowerCase())
    ? trimmed.slice(0, -unit.length).trim()
    : value
}

export function normalizePropertyGridNumberDraft(
  draft: string,
  row: PropertyGridRow,
): { value: number; text: string } | undefined {
  const parsed = parseStrictNumber(stripPropertyGridUnit(draft, row.unit))
  if (parsed === undefined) return undefined
  const decimals = resolvePropertyGridNumberDecimals(row, draft)
  const value = clampNumber(roundNumber(parsed, decimals), row.min, row.max)
  return { value, text: formatNumberDraft(value, decimals) }
}

export function resolvePropertyGridNumberDecimals(row: PropertyGridRow, draft: string): number {
  if (Number.isFinite(row.decimals)) return Math.max(0, Math.min(12, Math.floor(row.decimals!)))
  return Math.max(decimalPlaces(row.step), decimalPlaces(parseStrictNumber(draft)))
}

function normalizeSingleLineText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\n/g, ' ')
}

function parseStrictNumber(value: string): number | undefined {
  const text = value.trim()
  if (!strictNumberPattern.test(text)) return undefined
  const number = Number(text)
  return Number.isFinite(number) ? number : undefined
}

function decimalPlaces(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0
  const text = String(value).toLowerCase()
  const [coefficient, exponentText] = text.split('e')
  const fractionLength = coefficient?.split('.')[1]?.length ?? 0
  const exponent = Number(exponentText ?? 0)
  return Math.max(0, Math.min(12, fractionLength - exponent))
}

function roundNumber(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function clampNumber(value: number, min: number | undefined, max: number | undefined): number {
  const lower = Number.isFinite(min) ? min! : -Infinity
  const upper = Number.isFinite(max) ? max! : Infinity
  return Math.max(lower, Math.min(upper, value))
}

function formatNumberDraft(value: number, decimals: number): string {
  if (decimals <= 0) return String(Math.round(value))
  return value.toFixed(decimals).replace(/(?:\.0+|(\.\d*?)0+)$/, '$1')
}

function toStepperRect(rect: Rect): { x: number; y: number; w: number; h: number } {
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
}

function pointInRect(point: Offset, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width &&
    point.y >= rect.y && point.y <= rect.y + rect.height
}
