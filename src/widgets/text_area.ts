// TextArea: 多行文本输入框
// 支持自动折行（word wrap）、垂直滚动、光标定位、选区、键盘导航、IME 组字

import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import {
  paintVBar,
  resolveScrollbarGeometry,
  type ScrollbarGeometry,
} from '../rendering/scrollbar'
import type { BoxConstraints, LayoutContext, Offset, Rect } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import { runCleanupSteps } from '../core/disposable'
import { TextMeasurer } from '../core/text_measurer'
import type { PointerEvent, WheelPointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import type { GestureArenaMember } from '../gestures/gesture_arena'
import { PendingPointerGesture } from '../gestures/pending_pointer_gesture'
import { pointerKey } from '../gestures/pointer_identity'
import { ScrollbarAxisController } from '../gestures/scrollbar_interaction_controller'
import { FocusManager, type Focusable } from '../core/focus_manager'
import { SelectionController } from '../core/selection_controller'
import { resolveWordSelectionRange } from '../core/text_selection'
import { TextEditSession } from '../core/text_edit_session'
import { TextInputController } from '../core/text_input_controller'
import {
  deriveScrollbarStyle,
  deriveTextInputStyle,
  type ScrollbarStyleTokens,
  type TextInputStyleTokens,
} from '../theme/component_styles'
import {
  measureFormFieldHelperHeight,
  paintFormFieldShell,
  pointInFormFieldRect,
  resolveFormFieldPlaceholderColor,
  resolveFormFieldTextColor,
  type FormFieldStatus,
} from './form_field_shell'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorBlurListener,
  type ValueEditorValueChangeListener,
} from './value_editor'
import { paintIconGlyph } from './icon'

interface CursorPos { line: number; col: number }

// 视觉行：一个逻辑行可能折成多个视觉行
interface VLine {
  logicLine: number   // 来自哪个逻辑行
  startCol: number    // 在逻辑行中的起始列
  text: string        // 该视觉行的文本片段
}

const DRAG_SLOP = 4

export type TextAreaValueChangeReason =
  | 'input'
  | 'composition'
  | 'paste'
  | 'keyboard'
  | 'clear'

function cursorEq(a: CursorPos, b: CursorPos): boolean {
  return a.line === b.line && a.col === b.col
}

function cursorLt(a: CursorPos, b: CursorPos): boolean {
  return a.line < b.line || (a.line === b.line && a.col < b.col)
}

export class RenderTextArea extends RenderBox implements
  InteractiveRenderObject,
  Focusable,
  GestureArenaMember,
  ValueEditor<string, TextAreaValueChangeReason, undefined> {
  static override debugTypeName = 'RenderTextArea'
  readonly preventsPointerActivationOnAccept = true
  placeholder: string
  private _readonly: boolean
  onChange?: (value: string) => void
  onCommit?: (value: string) => void
  private _disabled: boolean
  private _status: FormFieldStatus
  private _helperText: string
  private _clearable: boolean
  private _maxLength: number | null

  private _lines: string[] = ['']
  private _focused = false
  private _hovered = false
  private _focusRegistered = false
  private _textInput = new TextInputController({ onInvalidate: () => this._invalidateCaret() })
  private _editSession = new TextEditSession({
    controller: this._textInput,
    isActive: () => this._focused,
    syncComposer: () => this._syncToComposer(),
    scrollToCursor: () => this._scrollToCursor(),
    updateComposerPosition: () => this._updateTextareaPos(),
    invalidate: () => {
      this.markNeedsPaint()
      this._invalidateCaret()
    },
  })
  private _cursor: CursorPos = { line: 0, col: 0 }
  private _selection = new SelectionController({ anchor: 0, focus: 0 })
  private _scrollY = 0
  private _dragging = false
  private _lastDragX = -1
  private _lastDragY = -1
  private readonly _scrollbarController = new ScrollbarAxisController('vertical')
  private readonly _pendingGesture = new PendingPointerGesture()
  private _dragStartPosition?: Offset
  private readonly _valueEditorEvents =
    new ValueEditorEventEmitter<string, TextAreaValueChangeReason, undefined>()

  // 视觉行缓存
  private _vlines: VLine[] = []
  private _vlinesWidth = -1
  private _vlinesCompositionKey = ''
  // 每个逻辑行的折行结果缓存；null 表示该行需要重新折行
  private _lineWraps: (VLine[] | null)[] = []
  // 每个逻辑行的起始 flat offset 缓存，与 _vlines 同步失效
  private _lineStartFlat: number[] = []
  private _lastCaretDirtyRect?: Rect

  constructor(opts: {
    value?: string
    placeholder?: string
    readonly?: boolean
    onChange?: (value: string) => void
    onCommit?: (value: string) => void
    disabled?: boolean
    status?: FormFieldStatus
    helperText?: string
    clearable?: boolean
    maxLength?: number
  }) {
    super()
    this.placeholder = opts.placeholder ?? ''
    this._readonly = opts.readonly ?? false
    this.onChange = opts.onChange
    this.onCommit = opts.onCommit
    this._disabled = opts.disabled ?? false
    this._status = opts.status ?? 'default'
    this._helperText = opts.helperText ?? ''
    this._clearable = opts.clearable ?? false
    this._maxLength = normalizeMaxLength(opts.maxLength)
    if (opts.value !== undefined) this._lines = normalizeTextLength(opts.value, this._maxLength).split('\n')
    this._syncFocusRegistration()
  }

  get value(): string { return this._lines.join('\n') }
  set value(v: string) {
    v = normalizeTextLength(v, this._maxLength)
    this._lines = v.split('\n')
    this._invalidateAllLines()
    this._clampCursor()
    this._selection.clampRange(0, this.value.length)
    this._clampScrollY()
    if (this._focused) {
      this._editSession.refresh({ syncComposer: true })
    }
    this.markNeedsPaint()
  }

  get disabled(): boolean { return this._disabled }
  set disabled(disabled: boolean) {
    if (this._disabled === disabled) return
    this._disabled = disabled
    runCleanupSteps([
      () => {
        if (!disabled) return
        this._hovered = false
        if (this._focused) this._blur()
        else this._resetPointerInteraction()
      },
      () => this._syncFocusRegistration(),
      () => this.markNeedsPaint(),
    ])
  }

  get readonly(): boolean { return this._readonly }
  set readonly(readonly: boolean) {
    if (this._readonly === readonly) return
    this._readonly = readonly
    if (readonly && this._focused) {
      const currentLine = this._lines[this._cursor.line] ?? ''
      const col = Math.min(this._cursor.col, currentLine.length)
      this._dragging = false
      this._scrollbarController.reset()
      this._pendingGesture.resolveTerminal(
        'rejected',
        () => { this._dragStartPosition = undefined },
        () => this._textInput.clearComposition(),
        () => {
          if (this._textInput.hasSession) {
            this._textInput.setComposerLineMode(currentLine, col)
            this._textInput.setSelection(col, col, {
              cursorPos: col,
              syncComposer: true,
            })
          }
        },
      )
    }
    this.markNeedsPaint()
  }

  get status(): FormFieldStatus { return this._status }
  set status(status: FormFieldStatus) {
    if (this._status === status) return
    this._status = status
    this.markNeedsPaint()
  }

  get helperText(): string { return this._helperText }
  set helperText(helperText: string) {
    if (this._helperText === helperText) return
    this._helperText = helperText
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get clearable(): boolean { return this._clearable }
  set clearable(clearable: boolean) {
    if (this._clearable === clearable) return
    this._clearable = clearable
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get maxLength(): number | null { return this._maxLength }
  set maxLength(maxLength: number | null) {
    const next = normalizeMaxLength(maxLength ?? undefined)
    if (this._maxLength === next) return
    this._maxLength = next
    this.value = this.value
    this.markNeedsPaint()
  }

  get isFocused(): boolean { return this._focused }
  focusIn(): void { this._focus() }
  focusOut(): void { this._blur() }

  getValue(): string { return this.value }
  setValue(value: string): void { this.value = value }
  subscribeValueChange(
    listener: ValueEditorValueChangeListener<string, TextAreaValueChangeReason, undefined>,
  ): () => void {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }
  subscribeBlur(listener: ValueEditorBlurListener): () => void {
    return this._valueEditorEvents.subscribeBlur(listener)
  }
  requestFocus(): void {
    if (typeof window === 'undefined') return
    FocusManager.instance.setFocus(this)
  }
  blur(): void {
    if (typeof window === 'undefined') return
    FocusManager.instance.clearFocusOf(this)
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const s = deriveTextInputStyle(context.theme)
    const helperHeight = measureFormFieldHelperHeight(s, this.helperText)
    const fieldHeight = constraints.maxHeight === Infinity
      ? s.fontSize * 6 + s.padding * 2
      : Math.max(s.height, constraints.maxHeight - helperHeight)
    this.size = {
      width: constraints.maxWidth === Infinity ? 300 : constraints.maxWidth,
      height: fieldHeight + helperHeight,
    }
    this._invalidateAllLines()  // 宽度可能变化，失效缓存
    if (context.pass === 'measure') return
    if (this._focused) {
      this._scrollToCursor()
      this._updateTextareaPos()
    } else {
      this._clampScrollY()
    }
  }

  private get _lineHeight(): number { return this._inputStyle().lineHeight }

  // 始终预留滚动条宽度，避免折行与滚动条显示之间的循环依赖
  private get _innerW(): number {
    const inputStyle = this._inputStyle()
    return this.size.width - inputStyle.padding * 2 - this._scrollbarStyle().gutterSize - this._clearReservedWidth(inputStyle)
  }

  private get _totalContentH(): number {
    return this._getVLines().length * this._lineHeight
  }

  private get _viewH(): number {
    return this._fieldHeight() - this._inputStyle().padding * 2
  }

  private get _maxScrollY(): number {
    return Math.max(0, this._totalContentH - this._viewH)
  }

  private get _needsScrollbar(): boolean {
    return this._totalContentH > this._viewH
  }

  private get _sbDragging(): boolean {
    return this._scrollbarController.state.dragging
  }

  private _scrollbarGeometry(origin: Offset = this.globalOffset): ScrollbarGeometry {
    const inputStyle = this._inputStyle()
    const scrollbarStyle = this._scrollbarStyle()
    const state = this._scrollbarController.state
    const visualThickness = state.dragging
      ? scrollbarStyle.thumbPressedThickness
      : state.hovered
        ? scrollbarStyle.thumbHoveredThickness
        : scrollbarStyle.thumbThickness
    return resolveScrollbarGeometry({
      axis: 'vertical',
      trackRect: {
        x: origin.x + this.size.width - scrollbarStyle.gutterSize,
        y: origin.y + inputStyle.padding,
        width: scrollbarStyle.gutterSize,
        height: this._fieldHeight(inputStyle) - inputStyle.padding * 2,
      },
      viewportSize: this._viewH,
      contentSize: this._totalContentH,
      scrollOffset: this._scrollY,
      visualThickness,
      minThumbLength: scrollbarStyle.minThumbLength,
      endInset: scrollbarStyle.endInset,
    })
  }

  private _setScrollbarOffset(scrollOffset: number): void {
    const next = Math.max(0, Math.min(this._maxScrollY, scrollOffset))
    if (next === this._scrollY) return
    this._scrollY = next
    if (this._focused) {
      this._editSession.refresh({ scrollToCursor: false })
    } else {
      this.markNeedsPaint()
    }
  }

  private _measureText(text: string): number {
    const inputStyle = this._inputStyle()
    return TextMeasurer.measureWidth(text, inputStyle.fontSize, inputStyle.fontFamily)
  }

  private _fieldHeight(style: TextInputStyleTokens = this._inputStyle()): number {
    const helperHeight = measureFormFieldHelperHeight(style, this.helperText)
    const current = this.size.height > 0 ? this.size.height - helperHeight : style.fontSize * 6 + style.padding * 2
    return Math.max(style.height, current)
  }

  private _showClearButton(): boolean {
    return this.clearable && !this.disabled && !this.readonly && this.value.length > 0
  }

  private _clearReservedWidth(style: TextInputStyleTokens = this._inputStyle()): number {
    if (!this._showClearButton()) return 0
    return Math.max(style.fontSize, style.lineHeight) + Math.max(4, Math.round(style.itemSpacing * 0.75))
  }

  private _clearButtonRect(origin: Offset = this.globalOffset): { x: number; y: number; w: number; h: number } | null {
    if (!this._showClearButton()) return null
    const style = this._inputStyle()
    const sbWidth = this._scrollbarStyle().gutterSize
    const size = Math.max(style.fontSize, style.lineHeight)
    return {
      x: origin.x + this.size.width - sbWidth - style.padding - size,
      y: origin.y + style.padding,
      w: size,
      h: size,
    }
  }

  // 把一个逻辑行按宽度折成若干视觉行片段
  private _wrapLine(logicLine: number, text: string): VLine[] {
    const maxW = this._innerW
    if (text === '') return [{ logicLine, startCol: 0, text: '' }]
    if (maxW <= 0) return [{ logicLine, startCol: 0, text }]

    const result: VLine[] = []
    let startCol = 0
    while (startCol < text.length) {
      let lo = 1, hi = text.length - startCol
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (this._measureText(text.slice(startCol, startCol + mid)) <= maxW) lo = mid
        else hi = mid - 1
      }
      result.push({ logicLine, startCol, text: text.slice(startCol, startCol + lo) })
      startCol += lo
    }
    return result
  }

  // 只失效单行折行缓存（按键修改当前行时用）
  private _invalidateLine(line: number): void {
    this._lineWraps[line] = null
    this._vlines = []
    this._vlinesCompositionKey = ''
  }

  // 失效所有折行缓存（宽度变化、整体赋值、换行/删行时用）
  private _invalidateAllLines(): void {
    this._lineWraps = []
    this._vlines = []
    this._vlinesCompositionKey = ''
  }

  private _getVLines(): VLine[] {
    const w = this._innerW
    const compositionKey = this._compositionLayoutKey()
    if (this._vlines.length > 0 && this._vlinesWidth === w && this._vlinesCompositionKey === compositionKey) return this._vlines
    // 宽度变化时清空所有行缓存
    if (this._vlinesWidth !== w) this._lineWraps = []
    this._vlinesWidth = w
    this._vlinesCompositionKey = compositionKey
    this._vlines = []
    this._lineStartFlat = []
    let flat = 0
    for (let i = 0; i < this._lines.length; i++) {
      this._lineStartFlat[i] = flat
      flat += (this._lines[i]?.length ?? 0) + 1
      const layoutText = this._lineTextForLayout(i)
      let segs: VLine[] | null | undefined
      if (this._isCompositionLine(i)) {
        segs = this._wrapLine(i, layoutText)
      } else {
        segs = this._lineWraps[i]
        if (!segs) {
          segs = this._wrapLine(i, layoutText)
          this._lineWraps[i] = segs
        }
      }
      for (const seg of segs) {
        this._vlines.push(seg)
      }
    }
    return this._vlines
  }

  // 逻辑光标 → 视觉行索引
  private _cursorToVLine(cursor: CursorPos): number {
    const vlines = this._getVLines()
    let best = 0
    const cursorCol = this._visualCursorCol(cursor)
    for (let vi = 0; vi < vlines.length; vi++) {
      const vl = vlines[vi]!
      if (vl.logicLine !== cursor.line) continue
      best = vi
      if (cursorCol <= vl.startCol + vl.text.length) break
    }
    return best
  }

  private _clampCursor(): void {
    this._cursor.line = Math.max(0, Math.min(this._lines.length - 1, this._cursor.line))
    const lineLen = this._lines[this._cursor.line]?.length ?? 0
    this._cursor.col = Math.max(0, Math.min(lineLen, this._cursor.col))
  }

  private _scrollToCursor(): void {
    const lh = this._lineHeight
    const vi = this._cursorToVLine(this._cursor)
    const cursorY = vi * lh
    if (cursorY - this._scrollY < 0) this._scrollY = cursorY
    if (cursorY + lh - this._scrollY > this._viewH) this._scrollY = cursorY + lh - this._viewH
    this._clampScrollY()
  }

  private _clampScrollY(): void {
    this._scrollY = Math.max(0, Math.min(this._maxScrollY, this._scrollY))
  }

  private _hitPos(localX: number, localY: number): CursorPos {
    const lh = this._lineHeight
    const vlines = this._getVLines()
    const vi = Math.max(0, Math.min(vlines.length - 1, Math.floor((localY + this._scrollY) / lh)))
    const vl = vlines[vi]!
    const col = vl.startCol + this._hitCol(vl.text, localX)
    return { line: vl.logicLine, col }
  }

  private _hitCharacterPos(localX: number, localY: number): CursorPos | null {
    if (localY < 0 || localY >= this._viewH) return null
    const vlines = this._getVLines()
    if (vlines.length === 0) return null
    const visualLine = Math.floor((localY + this._scrollY) / this._lineHeight)
    if (visualLine < 0 || visualLine >= vlines.length) return null
    const line = vlines[visualLine]!
    const text = line.text
    const totalWidth = this._measureText(text)
    if (text.length === 0 || localX < 0 || localX >= totalWidth) return null

    let low = 0
    let high = text.length - 1
    while (low < high) {
      const middle = (low + high) >> 1
      if (this._measureText(text.slice(0, middle + 1)) > localX) high = middle
      else low = middle + 1
    }
    return { line: line.logicLine, col: line.startCol + low }
  }

  private _hitCol(text: string, localX: number): number {
    if (localX <= 0) return 0
    const totalW = this._measureText(text)
    if (localX >= totalW) return text.length
    let lo = 0, hi = text.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this._measureText(text.slice(0, mid)) <= localX) lo = mid
      else hi = mid - 1
    }
    const wL = this._measureText(text.slice(0, lo))
    const wR = lo < text.length ? this._measureText(text.slice(0, lo + 1)) : wL
    return (localX - wL < wR - localX) ? lo : Math.min(lo + 1, text.length)
  }

  private _selRange(): { start: CursorPos; end: CursorPos } | null {
    if (!this._selection.hasRange) return null
    return {
      start: this._posFromFlat(this._selection.start),
      end: this._posFromFlat(this._selection.end),
    }
  }

  private _flatOffset(pos: CursorPos): number {
    let offset = 0
    for (let i = 0; i < pos.line; i++) offset += (this._lines[i]?.length ?? 0) + 1
    return offset + pos.col
  }

  private _syncToComposer(): void {
    const line = this._lines[this._cursor.line] ?? ''
    this._textInput.setComposerLineMode(line, this._cursor.col)
  }

  private _isCompositionLine(line: number): boolean {
    return this._textInput.composing && this._textInput.compositionText.length > 0 && line === this._cursor.line
  }

  private _compositionLayoutKey(): string {
    if (!this._textInput.composing || this._textInput.compositionText.length === 0) return ''
    return `${this._cursor.line}:${this._cursor.col}:${this._textInput.compositionText}`
  }

  private _lineTextForLayout(line: number): string {
    const value = this._lines[line] ?? ''
    if (!this._isCompositionLine(line)) return value
    const col = Math.max(0, Math.min(value.length, this._cursor.col))
    return value.slice(0, col) + this._textInput.compositionText + value.slice(col)
  }

  private _visualCursorCol(cursor: CursorPos): number {
    if (!this._isCompositionLine(cursor.line)) return cursor.col
    return cursor.col + this._textInput.compositionText.length
  }

  private _updateTextareaPos(): void {
    if (!this._focused) return

    const inputStyle = this._inputStyle()
    const vlines = this._getVLines()
    const vi = this._cursorToVLine(this._cursor)
    const vline = vlines[vi]
    if (!vline) return

    const visualCol = this._visualCursorCol(this._cursor)
    const localCol = Math.max(0, Math.min(vline.text.length, visualCol - vline.startCol))
    const g = this.globalOffset
    this._textInput.updateComposerPosition(
      g.x + inputStyle.padding + this._measureText(vline.text.slice(0, localCol)),
      g.y + inputStyle.padding + vi * this._lineHeight - this._scrollY,
    )
  }

  private _caretGeometry(origin: Offset = this.globalOffset): { x: number; y: number; height: number } | null {
    const inputStyle = this._inputStyle()
    const vlines = this._getVLines()
    const vi = this._cursorToVLine(this._cursor)
    const vline = vlines[vi]
    if (!vline) return null
    const visualCol = this._visualCursorCol(this._cursor)
    const localCol = Math.max(0, Math.min(vline.text.length, visualCol - vline.startCol))
    return {
      x: origin.x + inputStyle.padding + this._measureText(vline.text.slice(0, localCol)),
      y: origin.y + inputStyle.padding + vi * this._lineHeight - this._scrollY + 2,
      height: this._lineHeight - 4,
    }
  }

  private _caretDirtyRect(): Rect {
    const caret = this._caretGeometry()
    if (!caret) {
      return { x: this.globalOffset.x, y: this.globalOffset.y, width: 1, height: 1 }
    }
    return {
      x: Math.floor(caret.x - 3),
      y: Math.floor(caret.y - 2),
      width: 8,
      height: Math.ceil(caret.height + 4),
    }
  }

  private _invalidateCaret(): void {
    if (!this._focused || this.disabled) return
    const next = this._caretDirtyRect()
    this.markNeedsTransientPaint(this._lastCaretDirtyRect ? unionRect(this._lastCaretDirtyRect, next) : next)
    this._lastCaretDirtyRect = next
  }

  private _collapseSelectionAtCursor(): void {
    this._selection.collapse(this._flatOffset(this._cursor))
  }

  private _syncSelectionFromLineInput(): void {
    const lineBase = this._lineStartFlat[this._cursor.line] ?? this._flatOffset({ line: this._cursor.line, col: 0 })
    this._selection.setNormalizedRange(lineBase + this._textInput.selStart, lineBase + this._textInput.selEnd)
  }

  private _prepareSelectionReplacement(): boolean {
    if (!this._selection.hasRange) return false
    this._deleteSelectedRange({ notifyChange: false })
    return true
  }

  private _isPrintableInputKey(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false
    return e.key.length === 1
  }

  private _posFromFlat(flat: number): CursorPos {
    let remaining = flat
    for (let i = 0; i < this._lines.length; i++) {
      const len = this._lines[i]?.length ?? 0
      if (remaining <= len) return { line: i, col: remaining }
      remaining -= len + 1
    }
    const last = this._lines.length - 1
    return { line: last, col: this._lines[last]?.length ?? 0 }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w, height: h } = this.size
    const s = deriveTextInputStyle(context.theme)
    const sb = deriveScrollbarStyle(context.theme)
    const lh = this._lineHeight
    const fieldHeight = this._fieldHeight(s)
    const textColor = resolveFormFieldTextColor(s, this.disabled)
    const placeholderColor = resolveFormFieldPlaceholderColor(s, this.disabled)
    paintFormFieldShell(context, offset, w, fieldHeight, {
      focused: this._focused,
      hovered: this._hovered,
      disabled: this.disabled,
      status: this.status,
      helperText: this.helperText,
    })

    const px = s.padding
    const sbW = sb.gutterSize  // 始终预留，与 _innerW 一致
    const clearRect = this._clearButtonRect(offset)
    if (clearRect) {
      const iconSize = Math.min(s.fontSize, clearRect.w, clearRect.h)
      paintIconGlyph(context, {
        name: 'close',
        x: clearRect.x + (clearRect.w - iconSize) / 2,
        y: clearRect.y + (clearRect.h - iconSize) / 2,
        size: iconSize,
        color: placeholderColor,
      })
    }
    dl.pushClip(x + px, y + px, this._innerW, fieldHeight - px * 2)

    const textX = x + px
    const baseY = y + px - this._scrollY
    const vlines = this._getVLines()
    const sel = this._selRange()
    const selSFlat = sel ? this._flatOffset(sel.start) : 0
    const selEFlat = sel ? this._flatOffset(sel.end) : 0

    for (let vi = 0; vi < vlines.length; vi++) {
      const vl = vlines[vi]!
      const lineY = baseY + vi * lh
      if (lineY + lh < y + px || lineY > y + fieldHeight - px) continue

      const { logicLine, startCol, text } = vl
      const isLastVLineOfLogic = vi === vlines.length - 1 || vlines[vi + 1]!.logicLine !== logicLine
      const visualCursorCol = this._visualCursorCol(this._cursor)
      const isCursorVLine = this._focused && this._cursor.line === logicLine &&
        visualCursorCol >= startCol &&
        (isLastVLineOfLogic ? visualCursorCol <= startCol + text.length : visualCursorCol < startCol + text.length)

      // 选区背景
      if (sel) {
        const lineBase = this._lineStartFlat[logicLine] ?? 0
        const vlStart = lineBase + startCol
        const vlEnd = vlStart + text.length
        if (vlStart < selEFlat && vlEnd > selSFlat) {
          const selStart = Math.max(0, selSFlat - vlStart)
          const selEnd = Math.min(text.length, selEFlat - vlStart)
          const selX0 = textX + this._measureText(text.slice(0, selStart))
          const selX1 = textX + this._measureText(text.slice(0, selEnd))
          dl.fillRect(selX0, lineY, (selX1 - selX0) || 2, lh, s.selectionBg, 0)
        }
      }

      // 文字 + IME 组字
      const compositionStart = this._isCompositionLine(logicLine) ? this._cursor.col : -1
      const compositionEnd = compositionStart >= 0 ? compositionStart + this._textInput.compositionText.length : -1
      if (compositionStart >= 0 && startCol < compositionEnd && startCol + text.length > compositionStart) {
        const localStart = Math.max(0, compositionStart - startCol)
        const localEnd = Math.min(text.length, compositionEnd - startCol)
        const before = text.slice(0, localStart)
        const composing = text.slice(localStart, localEnd)
        const after = text.slice(localEnd)
        const beforeW = this._measureText(before)
        const composingW = this._measureText(composing)
        if (before) dl.fillText(before, textX, lineY + lh / 2, textColor, s.fontSize, s.fontFamily, 'left', 'middle')
        if (composing) {
          dl.fillText(composing, textX + beforeW, lineY + lh / 2, s.compositionText, s.fontSize, s.fontFamily, 'left', 'middle')
          dl.line(textX + beforeW, lineY + lh - 3, textX + beforeW + composingW, lineY + lh - 3, s.focusedBorder, 1.5)
        }
        if (after) dl.fillText(after, textX + beforeW + composingW, lineY + lh / 2, textColor, s.fontSize, s.fontFamily, 'left', 'middle')
      } else if (text.length > 0) {
        dl.fillText(text, textX, lineY + lh / 2, textColor, s.fontSize, s.fontFamily, 'left', 'middle')
      }
    }

    // placeholder
    if (this._shouldPaintPlaceholder()) {
      dl.fillText(this.placeholder, textX, y + px + lh / 2, placeholderColor, s.fontSize, s.fontFamily, 'left', 'middle')
    }

    dl.popClip()

    // 垂直滚动条（始终在 popClip 之后绘制，不受 clip 影响）
    if (this._needsScrollbar) {
      paintVBar({
        dl,
        style: sb,
        trackX: x + w - sbW,
        trackY: y + px,
        trackW: sbW,
        trackH: fieldHeight - px * 2,
        viewSize: this._viewH,
        contentSize: this._totalContentH,
        scrollOffset: this._scrollY,
        state: this._scrollbarController.state,
      })
    }
  }

  override performTransientPaint(context: PaintContext, offset: Offset): void {
    if (!this._focused || this.disabled || !this._textInput.cursorVisible) return
    const caret = this._caretGeometry(offset)
    if (!caret) return
    const dl = new DrawList(context)
    const style = deriveTextInputStyle(context.theme)
    const fieldHeight = this._fieldHeight(style)
    dl.pushClip(offset.x + style.padding, offset.y + style.padding, this._innerW, fieldHeight - style.padding * 2)
    dl.line(caret.x, caret.y, caret.x, caret.y + caret.height, style.caretColor, 1.5)
    dl.popClip()
  }

  private _inputStyle(): TextInputStyleTokens {
    return deriveTextInputStyle(this.currentTheme)
  }

  private _shouldPaintPlaceholder(): boolean {
    return this._lines.length === 1 &&
      this._lines[0] === '' &&
      this.placeholder.length > 0 &&
      (!this._textInput.composing || this._textInput.compositionText.length === 0)
  }

  private _scrollbarStyle(): ScrollbarStyleTokens {
    return deriveScrollbarStyle(this.currentTheme)
  }

  private _syncFocusRegistration(): void {
    if (typeof window === 'undefined') return
    if (this.disabled) {
      if (this._focusRegistered) {
        FocusManager.instance.unregister(this)
        this._focusRegistered = false
      }
      return
    }
    if (!this._focusRegistered) {
      FocusManager.instance.register(this)
      this._focusRegistered = true
    }
  }

  private _hitField(position: Offset): boolean {
    const g = this.globalOffset
    const fieldHeight = this._fieldHeight()
    return position.x >= g.x &&
      position.x <= g.x + this.size.width &&
      position.y >= g.y &&
      position.y <= g.y + fieldHeight
  }

  // ---- 焦点 ----

  private _focus(): void {
    if (this.disabled) return
    if (this._focused) return
    this._focused = true
    const currentLine = this._lines[this._cursor.line] ?? ''
    this._editSession.start({
      initialValue: currentLine,
      syncComposerOnStart: true,
      refreshOnStart: true,
      onInput: (lineValue, session) => {
        if (this._textInput.composing) return
        if (this.readonly) return
        const previousValue = this.value
        if (lineValue.includes('\n')) {
          // 粘贴多行
          const pastedLines = lineValue.split('\n')
          const { line } = this._cursor
          this._lines.splice(line, 1, ...pastedLines)
          this._invalidateAllLines()
          const newLine = line + pastedLines.length - 1
          const newCol = pastedLines[pastedLines.length - 1]!.length
          this._cursor = { line: newLine, col: newCol }
          this._textInput.setSelection(newCol, newCol, { cursorPos: newCol, syncComposer: false })
          this._textInput.setComposerLineMode(this._lines[newLine] ?? '', newCol)
        } else {
          this._lines[this._cursor.line] = lineValue
          this._invalidateLine(this._cursor.line)
          this._textInput.syncSelectionFromComposer({ ignoreComposing: true })
          this._cursor = { line: this._cursor.line, col: this._textInput.cursorPos }
        }
        this.value = this.value
        this._collapseSelectionAtCursor()
        this._publishUserValueChange(previousValue, 'input')
        session.refresh()
      },
      onCompositionStart: session => {
        if (this.readonly) return
        if (this._prepareSelectionReplacement()) {
          session.refresh({ syncComposer: true, resetBlink: true })
        }
      },
      onCompositionUpdate: (_compositionText, session) => {
        if (this.readonly) return
        this._invalidateLine(this._cursor.line)
        session.refresh()
      },
      onCompositionEnd: (lineValue, session) => {
        if (this.readonly) return
        const previousValue = this.value
        this._lines[this._cursor.line] = lineValue
        this._invalidateLine(this._cursor.line)
        this._textInput.syncSelectionFromComposer()
        this._cursor = { line: this._cursor.line, col: this._textInput.cursorPos }
        this.value = this.value
        this._collapseSelectionAtCursor()
        this._publishUserValueChange(previousValue, 'composition')
        session.refresh()
      },
      onKeyDown: (e, session) => {
        if (e.key === 'Escape') { e.preventDefault(); this._blur(); return }
        if ((e.key === 'Backspace' || e.key === 'Delete') && this._selection.hasRange) {
          e.preventDefault()
          if (!this.readonly) this._deleteSelectedRange()
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          if (!this.readonly) {
            this._prepareSelectionReplacement()
            this._insertNewline()
          }
          return
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
          e.preventDefault()
          const lastLine = this._lines.length - 1
          this._cursor = { line: lastLine, col: this._lines[lastLine]?.length ?? 0 }
          this._selection.setNormalizedRange(0, this.value.length)
          session.defer(() => {}, { syncComposer: true })
          return
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'x' || e.key === 'z')) {
          session.defer(() => {
            if (!this.readonly) {
              const previousValue = this.value
              const lineVal = this._textInput.composerValue
              this._lines[this._cursor.line] = lineVal
              this._invalidateLine(this._cursor.line)
              this._textInput.syncSelectionFromComposer({ ignoreComposing: true })
              this._cursor = { line: this._cursor.line, col: this._textInput.cursorPos }
              this._syncSelectionFromLineInput()
              this._publishUserValueChange(previousValue, 'keyboard')
            }
          })
          return
        }
        if (this._isPrintableInputKey(e) && this._prepareSelectionReplacement()) {
          session.refresh({ syncComposer: true, resetBlink: true })
          return
        }
        session.defer(() => {
          if (this.readonly) return
          if (this._textInput.composing) return
          const lineVal = this._textInput.composerValue
          this._lines[this._cursor.line] = lineVal
          this._invalidateLine(this._cursor.line)
          this._textInput.syncSelectionFromComposer({ ignoreComposing: true })
          this._cursor = { line: this._cursor.line, col: this._textInput.cursorPos }
          this._syncSelectionFromLineInput()
        })
      },
      onPaste: (event, session) => {
        if (this.readonly) return
        const text = this._clipboardText(event)
        if (text.length > 0) {
          event.preventDefault()
          const previousValue = this.value
          this._insertTextAtSelection(text)
          this._publishUserValueChange(previousValue, 'paste')
          session.refresh({ syncComposer: true, resetBlink: true })
          return
        }
        if (this._prepareSelectionReplacement()) {
          session.refresh({ syncComposer: true, resetBlink: true })
        }
      },
    })
    this.markNeedsPaint()
    this._invalidateCaret()
  }

  private _insertTextAtSelection(text: string): void {
    const value = this.value
    const textToInsert = text.replace(/\r\n?/g, '\n')
    const start = this._selection.hasRange ? this._selection.start : this._flatOffset(this._cursor)
    const end = this._selection.hasRange ? this._selection.end : start
    const nextValue = normalizeTextLength(
      value.slice(0, start) + textToInsert + value.slice(end),
      this._maxLength,
    )
    const cursorFlat = normalizeTextLength(value.slice(0, start) + textToInsert, this._maxLength).length
    this.value = nextValue
    this._cursor = this._posFromFlat(Math.min(cursorFlat, this.value.length))
    this._collapseSelectionAtCursor()
  }

  private _clipboardText(event: ClipboardEvent): string {
    return event.clipboardData?.getData('text/plain')
      ?? event.clipboardData?.getData('text')
      ?? ''
  }

  private _insertNewline(): void {
    const previousValue = this.value
    const { line, col } = this._cursor
    const current = this._lines[line] ?? ''
    const before = current.slice(0, col)
    const after = current.slice(col)
    this._lines.splice(line, 1, before, after)
    this._invalidateAllLines()
    this._cursor = { line: line + 1, col: 0 }
    this.value = this.value
    this._collapseSelectionAtCursor()
    this._publishUserValueChange(previousValue, 'keyboard')
    this._editSession.refresh({ syncComposer: true })
  }

  private _deleteSelectedRange(options: { notifyChange?: boolean } = {}): void {
    const sel = this._selRange()
    if (!sel) return

    const previousValue = this.value
    const { start, end } = sel
    let nextLines: string[]
    if (start.line === end.line) {
      const line = this._lines[start.line] ?? ''
      nextLines = [...this._lines]
      nextLines[start.line] = line.slice(0, start.col) + line.slice(end.col)
    } else {
      const merged =
        (this._lines[start.line] ?? '').slice(0, start.col) +
        (this._lines[end.line] ?? '').slice(end.col)
      nextLines = [...this._lines]
      nextLines.splice(start.line, end.line - start.line + 1, merged)
    }

    this._cursor = { ...start }
    this.value = nextLines.join('\n')
    this._cursor = { ...start }
    this._collapseSelectionAtCursor()
    if (options.notifyChange ?? true) {
      this._publishUserValueChange(previousValue, 'keyboard')
    }
    this._editSession.refresh({ syncComposer: true, resetBlink: true })
  }

  private _blur(): void {
    if (!this._focused) return
    this._focused = false
    this._dragging = false
    this._scrollbarController.reset()
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => { this._dragStartPosition = undefined },
      () => this._invalidateCaret(),
      () => this._clampScrollY(),
      () => this._editSession.end(),
      () => {
        if (!this.readonly) this.onCommit?.(this.value)
      },
      () => this._valueEditorEvents.emitBlur(),
      () => this.markNeedsPaint(),
    )
  }

  // ---- 指针事件 ----

  onPointerDown(e: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    if (!isPrimaryPointerButton(e)) return
    if (this.disabled || !this._hitField(e.position)) return
    if (pointInFormFieldRect(this._clearButtonRect(), e.position)) {
      this._clearValue()
      return
    }

    const scrollbarResult = this._scrollbarController.beginPointer(
      e.position,
      this._scrollbarGeometry(),
      pointerKey(e),
    )
    if (scrollbarResult.handled) {
      if (scrollbarResult.scrollOffset !== undefined) {
        this._setScrollbarOffset(scrollbarResult.scrollOffset)
      }
      if (scrollbarResult.dragStarted) this._pendingGesture.captureImmediately(e)
      if (scrollbarResult.stateChanged) this.markNeedsPaint()
      return
    }

    FocusManager.instance.setFocus(this)
    this._editSession.focusComposer()

    const padding = this._inputStyle().padding
    const localX = e.position.x - this.globalOffset.x - padding
    const localY = e.position.y - this.globalOffset.y - padding
    const pos = this._hitPos(localX, localY)
    this._cursor = pos
    this._selection.collapse(this._flatOffset(pos))
    this._textInput.setSelection(pos.col, pos.col, { cursorPos: pos.col, syncComposer: false })
    if (e.joinGestureArena) {
      this._resetPendingGesture()
      this._dragStartPosition = e.position
      this._pendingGesture.begin(e, this)
      this._dragging = false
    } else {
      this._dragging = true
    }
    this._lastDragX = e.position.x
    this._lastDragY = e.position.y
    this._editSession.refresh({ resetBlink: true, syncComposer: true })
  }

  onDoubleClick(position: Offset): void {
    if (this.disabled || !this._hitField(position)) return
    if (pointInFormFieldRect(this._clearButtonRect(), position)) return
    if (
      this._needsScrollbar &&
      position.x >= this.globalOffset.x + this.size.width - this._scrollbarStyle().gutterSize
    ) return

    const padding = this._inputStyle().padding
    const hit = this._hitCharacterPos(
      position.x - this.globalOffset.x - padding,
      position.y - this.globalOffset.y - padding,
    )
    if (!hit) return
    const line = this._lines[hit.line] ?? ''
    const range = resolveWordSelectionRange(line, hit.col)
    if (!range) return

    FocusManager.instance.setFocus(this)
    this._editSession.focusComposer()
    this._resetPointerInteraction()
    this._cursor = { line: hit.line, col: range.end }
    const lineStart = this._flatOffset({ line: hit.line, col: 0 })
    this._selection.setNormalizedRange(lineStart + range.start, lineStart + range.end)
    this._syncToComposer()
    this._textInput.setSelection(range.start, range.end, {
      cursorPos: range.end,
      syncComposer: true,
    })
    this._editSession.refresh({
      scrollToCursor: false,
      updateComposerPosition: true,
      resetBlink: true,
    })
    this.markNeedsPaint()
  }

  onPointerMove(e: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    const wasHovered = this._hovered
    this._hovered = !this.disabled && this._hitField(e.position)
    const scrollbarHoverChanged = this._scrollbarController.updateHover(
      e.position,
      this._scrollbarGeometry(),
    )
    if (this._hovered !== wasHovered || scrollbarHoverChanged) this.markNeedsPaint()

    if (this._sbDragging) {
      const result = this._scrollbarController.updatePointer(
        e.position,
        this._scrollbarGeometry(),
        pointerKey(e),
      )
      if (result.scrollOffset !== undefined) this._setScrollbarOffset(result.scrollOffset)
      return
    }

    if (this._pendingGesture.isPending && !this._dragging) {
      this._resolveSelectionIntent(e.position)
    }

    if (this._dragging && this._focused) {
      if (e.position.x === this._lastDragX && e.position.y === this._lastDragY) return
      this._updateDragSelection(e.position)
    }
  }

  onPointerUp(e: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    if (!isPrimaryPointerButton(e)) return
    const shouldRefresh = this._dragging && this._focused
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => {
        if (shouldRefresh) {
          this._editSession.refresh({
            syncComposer: true,
            scrollToCursor: false,
            invalidate: false,
          })
        }
      },
      () => {
        this._dragging = false
        this._dragStartPosition = undefined
        const result = this._scrollbarController.endPointer(
          e.position,
          this._scrollbarGeometry(),
          pointerKey(e),
        )
        if (result.stateChanged) this.markNeedsPaint()
      },
    )
  }

  onPointerCancel(e: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => { this._hovered = false },
      () => {
        this._dragging = false
        this._dragStartPosition = undefined
        this._scrollbarController.cancelPointer(pointerKey(e))
      },
      () => this.markNeedsPaint(),
    )
  }

  onPointerLeave(_e: PointerEvent): void {
    const scrollbarChanged = this._scrollbarController.clearHover()
    if (!this._hovered && !scrollbarChanged) return
    this._hovered = false
    this.markNeedsPaint()
  }

  acceptGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.accept(pointerId, pointerType)) return
    this._dragging = true
  }

  rejectGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.reject(pointerId, pointerType)) return
    this._dragging = false
    this._dragStartPosition = undefined
  }

  private _resolveSelectionIntent(position: Offset): void {
    if (!this._pendingGesture.isPending || !this._dragStartPosition) return
    const dx = position.x - this._dragStartPosition.x
    const dy = position.y - this._dragStartPosition.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_SLOP) return
    this._pendingGesture.resolve('accepted')
  }

  private _updateDragSelection(position: Offset): void {
    const padding = this._inputStyle().padding
    const localX = position.x - this.globalOffset.x - padding
    const localY = position.y - this.globalOffset.y - padding
    this._lastDragX = position.x
    this._lastDragY = position.y
    const pos = this._hitPos(localX, localY)
    this._cursor = pos
    this._selection.extendRange(this._flatOffset(pos))
    this._editSession.refresh()
  }

  private _resetPendingGesture(): void {
    this._pendingGesture.resetPending()
    this._dragStartPosition = undefined
  }

  private _resetPointerInteraction(): void {
    this._dragging = false
    this._scrollbarController.reset()
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => { this._dragStartPosition = undefined },
    )
  }

  onWheel(e: WheelPointerEvent): boolean | void {
    if (this.disabled || !this._hitField(e.position)) return false
    if (e.deltaY === 0) return false
    if (!this._focused || this._maxScrollY <= 0) return false
    const lh = this._lineHeight
    const nextScrollY = Math.max(0, Math.min(this._maxScrollY, this._scrollY + (e.deltaY > 0 ? lh : -lh)))
    if (nextScrollY === this._scrollY) return true
    this._scrollY = nextScrollY
    if (this._focused) this._editSession.refresh({
      scrollToCursor: false,
    })
    else this.markNeedsPaint()
    return true
  }

  dispose(): void {
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => this._blur(),
      () => {
        this._dragging = false
        this._scrollbarController.reset()
        this._dragStartPosition = undefined
      },
      () => this._textInput.dispose(),
      () => this._valueEditorEvents.dispose(),
      () => {
        if (this._focusRegistered && typeof window !== 'undefined') {
          FocusManager.instance.unregister(this)
          this._focusRegistered = false
        }
      },
      () => super.dispose(),
    )
  }

  private _clearValue(): void {
    if (!this._showClearButton()) return
    const previousValue = this.value
    FocusManager.instance.setFocus(this)
    this.value = ''
    this._cursor = { line: 0, col: 0 }
    this._selection.collapse(0)
    this._textInput.setSelection(0, 0, { cursorPos: 0, syncComposer: true })
    this._publishUserValueChange(previousValue, 'clear')
    this._editSession.refresh({ resetBlink: true, syncComposer: false })
  }

  private _publishUserValueChange(
    previousValue: string,
    reason: TextAreaValueChangeReason,
  ): void {
    const value = this.value
    runCleanupSteps([
      () => this.onChange?.(value),
      ...(
        value === previousValue
          ? []
          : [() => this._valueEditorEvents.emitValueChange({
              value,
              previousValue,
              reason,
            })]
      ),
    ])
  }
}

function normalizeMaxLength(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

function normalizeTextLength(value: string, maxLength: number | null): string {
  if (maxLength === null) return value
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}
