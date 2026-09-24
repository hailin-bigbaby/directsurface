import { FocusManager, type Focusable } from '../core/focus_manager'
import type { CopyableSelection } from '../core/clipboard'
import { TextEditSession, type TextEditSessionApi } from '../core/text_edit_session'
import { TextInputController } from '../core/text_input_controller'
import { TextMeasurer } from '../core/text_measurer'
import type { BoxConstraints, LayoutContext, Offset, Rect, RenderObject } from '../core/render_object'
import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { resolveWordSelectionRange } from '../core/text_selection'
import {
  hitTestScrollbarGeometry,
  paintHBar,
  paintVBar,
  resolveScrollbarGeometry,
  resolveScrollbarViewport,
  type ScrollbarGeometry,
} from '../rendering/scrollbar'
import { deriveScrollbarStyle } from '../theme/component_styles'
import {
  resolveThemeEditor,
  resolveThemeSyntax,
  resolveThemeTypography,
  type Color,
  type ThemeSyntaxTokens,
} from '../theme/theme'
import { clampScrollOffset, calcFixedVirtualRange } from '../virtualization/fixed_virtual_range'
import type { PointerEvent, WheelPointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { pointerKey } from '../gestures/pointer_identity'
import { ScrollbarAxisController } from '../gestures/scrollbar_interaction_controller'
import { EdgeAutoScrollDriver, type EdgeAutoScrollInput } from '../gestures/edge_auto_scroll'
import {
  PlainTextEditorController,
  lineIntersectsSelection,
  snapColumnToGraphemeBoundary,
  type PlainTextEditorChange,
  type PlainTextSearchMatch,
} from './plain_text_editor_controller'
import {
  normalizeRange,
  positionEquals,
  type TextDocumentModel,
  type TextEditResult,
  type TextPosition,
  type TextRange,
} from './plain_text_document'
import { PlainTextLineWidthIndex } from './plain_text_line_width_index'
import { findJsonFoldRange, type FoldRange } from './plain_text_folding'
import type { TextToken } from './plain_text_tokenizer'
import { paintIconGlyph } from './icon'
import {
  paintSurfaceBackground,
  paintSurfaceBorder,
  pushSurfaceContentClip,
  type SurfaceAppearance,
} from './surface_appearance'

export type PlainTextEditorDecorationKind = 'error' | 'warning' | 'info' | 'highlight'

export interface PlainTextEditorDecoration {
  range: TextRange
  kind?: PlainTextEditorDecorationKind
  message?: string
}

export interface PlainTextEditorLineTokenProviderInput {
  line: number
  lineText: string
  document: TextDocumentModel
  documentVersion: number
}

export type PlainTextEditorLineTokenProvider = (input: PlainTextEditorLineTokenProviderInput) => TextToken[] | null | undefined

export interface RenderPlainTextEditorOptions {
  controller?: PlainTextEditorController
  value?: string
  language?: string
  readonly?: boolean
  showLineNumbers?: boolean
  folding?: boolean
  showIndentGuides?: boolean
  tabSize?: number
  fontSize?: number
  fontFamily?: string
  lineHeight?: number
  /** Controls whether the editor owns its outer frame. @default 'framed' */
  appearance?: SurfaceAppearance
  decorations?: PlainTextEditorDecoration[]
  lineTokenProvider?: PlainTextEditorLineTokenProvider
  onChange?: (value: string) => void
  onDocumentChange?: (change: PlainTextEditorChange) => void
}

interface LineWidthCacheEntry {
  version: number
  compositionKey: string
  width: number
}

const DEFAULT_WIDTH = 480
const DEFAULT_HEIGHT = 320
const OVERSCAN_LINES = 8
const LONG_LINE_EXACT_LIMIT = 2048
const LONG_LINE_TOKEN_LIMIT = 4096
const EXACT_LINE_WIDTH_INDEX_LIMIT = 4096
const MAX_LINE_WIDTH_REFINEMENTS_PER_LAYOUT = 32
const FOLD_MARKER_LANE_WIDTH = 18
const FOLD_MARKER_SIZE = 14
const SELECTION_AUTO_SCROLL_EDGE = 32
const SELECTION_AUTO_SCROLL_INTERVAL = 32
interface FoldMarkerRect {
  x: number
  y: number
  size: number
}

interface ColumnRange {
  start: number
  end: number
  includesLineBreak: boolean
}

export class RenderPlainTextEditor extends RenderBox implements InteractiveRenderObject, Focusable, CopyableSelection {
  static override debugTypeName = 'RenderPlainTextEditor'
  readonly controller: PlainTextEditorController
  readonly ownsController: boolean
  readonly lineWidthCache = new Map<number, LineWidthCacheEntry>()

  readonly textInput = new TextInputController({ onInvalidate: () => this._invalidateCaret() })

  readonly editSession = new TextEditSession({
    controller: this.textInput,
    isActive: () => this._focused,
    syncComposer: () => this._syncComposer(),
    scrollToCursor: () => this._scrollToCursor(),
    updateComposerPosition: () => this._updateComposerPosition(),
    invalidate: () => {
      this.markNeedsPaint()
      this._invalidateCaret()
    },
  })

  showLineNumbers: boolean
  folding: boolean
  showIndentGuides: boolean
  tabSize: number
  fontSize?: number
  fontFamily?: string
  lineHeight?: number

  private _focused = false
  private _hovered = false
  private _focusRegistered = false
  private _readonly: boolean
  private _appearance: SurfaceAppearance
  private _scrollX = 0
  private _scrollY = 0
  private _contentWidth = 0
  private _observedDocumentVersion = -1
  private readonly _lineWidthIndex = new PlainTextLineWidthIndex()
  private _extentDocumentVersion = -1
  private _extentMetricKey = ''
  private _extentApproximate = false
  private _extentFontSize = 0
  private _extentFontFamily = ''
  private readonly _extentGlyphWidthCache = new Map<string, number>()
  private readonly _extentExactWidthCache = new Map<number, LineWidthCacheEntry>()
  private _foldingSignature = ''
  private readonly _foldRangeCache = new Map<number, { version: number; range: FoldRange | null }>()
  private _unsubscribeControllerChange: () => void = () => {}
  private readonly _vScrollbarController = new ScrollbarAxisController('vertical')
  private readonly _hScrollbarController = new ScrollbarAxisController('horizontal')
  private readonly _selectionAutoScroll = new EdgeAutoScrollDriver({
    intervalMs: SELECTION_AUTO_SCROLL_INTERVAL,
    onScroll: (delta, input) => this._tickSelectionAutoScroll(delta, input),
  })
  private readonly _vScrollbar = this._vScrollbarController.state
  private readonly _hScrollbar = this._hScrollbarController.state
  private _draggingSelection = false
  private _draggingVBar = false
  private _draggingHBar = false
  private _lastPaintedLineCount = 0
  private _deferComposerFocusOnStart = false
  private _composerSyncDirty = false
  private _composerMutationDepth = 0
  private _searchQuery = ''
  private _searchCaseSensitive = false
  private _activeSearchMatch: PlainTextSearchMatch | null = null
  private _lastCaretDirtyRect?: Rect
  private _decorations: PlainTextEditorDecoration[]
  private _lineTokenProvider?: PlainTextEditorLineTokenProvider

  constructor(options: RenderPlainTextEditorOptions = {}) {
    super()
    this.controller = options.controller ?? new PlainTextEditorController({
      value: options.value,
      language: options.language,
      onChange: options.onChange,
      onDocumentChange: options.onDocumentChange,
    })
    this.ownsController = !options.controller
    if (options.controller && options.onChange) options.controller.onChange = options.onChange
    if (options.controller && options.onDocumentChange) options.controller.onDocumentChange = options.onDocumentChange
    if (options.language) this.controller.setLanguage(options.language)
    this._readonly = options.readonly ?? false
    this._appearance = options.appearance ?? 'framed'
    this.showLineNumbers = options.showLineNumbers ?? true
    this.folding = options.folding ?? true
    this.showIndentGuides = options.showIndentGuides ?? true
    this.tabSize = Math.max(1, Math.floor(options.tabSize ?? 4))
    this.fontSize = options.fontSize
    this.fontFamily = options.fontFamily
    this.lineHeight = options.lineHeight
    this._decorations = normalizeDecorations(options.decorations ?? [])
    this._lineTokenProvider = options.lineTokenProvider
    this._observedDocumentVersion = this.controller.document.version
    this._unsubscribeControllerChange = this.controller.subscribeChange(change => {
      this._handleControllerChange(change.result)
    })
    this._syncFocusRegistration()
  }

  get value(): string {
    return this.controller.value
  }

  set value(value: string) {
    this.controller.value = value
    this._afterDocumentChanged()
  }

  get scrollX(): number {
    return this._scrollX
  }

  get appearance(): SurfaceAppearance { return this._appearance }
  set appearance(value: SurfaceAppearance) {
    if (value === this._appearance) return
    this._appearance = value
    this.markNeedsPaint()
  }

  set scrollX(value: number) {
    const next = clampScrollOffset(value, this._viewW, this._contentW)
    if (next === this._scrollX) return
    this._scrollX = next
    this.markNeedsPaint()
  }

  get scrollY(): number {
    return this._scrollY
  }

  protected get hasActivePointerEdit(): boolean {
    return this._draggingSelection || this._draggingVBar || this._draggingHBar
  }

  set scrollY(value: number) {
    const next = clampScrollOffset(value, this._viewH, this._contentH)
    if (next === this._scrollY) return
    this._scrollY = next
    this.markNeedsPaint()
  }

  get isFocused(): boolean {
    return this._focused
  }

  get readonly(): boolean {
    return this._readonly
  }

  set readonly(readonly: boolean) {
    if (this._readonly === readonly) return
    this._readonly = readonly
    if (this._focused) this.textInput.setComposerReadOnly(readonly)
    if (readonly) {
      this._draggingSelection = false
      this._selectionAutoScroll.stop()
      this.textInput.clearComposition()
    }
    if (this._focused) {
      this._syncComposer()
      this.editSession.refresh({
        syncComposer: false,
        scrollToCursor: false,
        updateComposerPosition: true,
        resetBlink: true,
      })
    }
    this.markNeedsPaint()
  }

  get searchQuery(): string {
    return this._searchQuery
  }

  get activeSearchMatch(): PlainTextSearchMatch | null {
    return this._activeSearchMatch ? cloneSearchMatch(this._activeSearchMatch) : null
  }

  get decorations(): PlainTextEditorDecoration[] {
    return cloneDecorations(this._decorations)
  }

  focusIn(): void {
    if (typeof window !== 'undefined' && this._focusRegistered && FocusManager.instance.current !== this) {
      FocusManager.instance.setFocus(this)
      return
    }
    this._focus()
  }

  focusOut(): void {
    this._blur()
  }

  getCopyText(): string | null {
    if (!this.controller.hasSelection) return null
    return this.controller.document.getText(this.controller.selection)
  }

  debugState(): { paintedLineCount: number; visibleLineCount: number; totalLineCount: number; decorationCount: number } {
    return {
      paintedLineCount: this._lastPaintedLineCount,
      visibleLineCount: this.controller.getVisibleLineCount(),
      totalLineCount: this.controller.document.lineCount,
      decorationCount: this._decorations.length,
    }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  setDecorations(decorations: PlainTextEditorDecoration[]): void {
    this._decorations = normalizeDecorations(decorations)
    this.markNeedsPaint()
  }

  setLineTokenProvider(provider?: PlainTextEditorLineTokenProvider): void {
    if (this._lineTokenProvider === provider) return
    this._lineTokenProvider = provider
    this.markNeedsPaint()
  }

  setSearchQuery(query: string, options?: { caseSensitive?: boolean }): void {
    const nextCaseSensitive = options?.caseSensitive ?? this._searchCaseSensitive
    if (this._searchQuery === query && this._searchCaseSensitive === nextCaseSensitive) return
    this._searchQuery = query
    this._searchCaseSensitive = nextCaseSensitive
    this._activeSearchMatch = null
    this.markNeedsPaint()
  }

  findNextSearchMatch(options?: { backwards?: boolean }): PlainTextSearchMatch | null {
    if (this._searchQuery.length === 0) return null
    const match = this.controller.findNext(this._searchQuery, {
      from: this._searchStartPosition(options?.backwards === true),
      backwards: options?.backwards,
      caseSensitive: this._searchCaseSensitive,
      wrap: true,
    })
    if (!match) {
      this._activeSearchMatch = null
      this.markNeedsPaint()
      return null
    }
    this._activateSearchMatch(match)
    return cloneSearchMatch(match)
  }

  goToLine(lineNumber: number, column = 0): TextPosition {
    const line = Math.max(0, Math.min(this.controller.document.lineCount - 1, Math.floor(lineNumber) - 1))
    const position = {
      line,
      column: Math.max(0, Math.min(this.controller.document.getLineLength(line), Math.floor(column))),
    }
    this.revealPosition(position)
    return this.controller.cursor
  }

  revealPosition(position: TextPosition, options?: { selectionEnd?: TextPosition }): void {
    this.controller.expandToLine(position.line)
    if (options?.selectionEnd) this.controller.setSelection(position, options.selectionEnd)
    else this.controller.setCursor(position)
    this._activeSearchMatch = null
    this._scrollToCursor()
    if (this._focused) this._syncComposer()
    this.markNeedsPaint()
  }

  globalPointToPosition(position: Offset): TextPosition {
    return this._hitPosition(position)
  }

  positionToGlobalRect(position: TextPosition, context?: PaintContext): Rect | null {
    const line = Math.max(0, Math.min(this.controller.document.lineCount - 1, Math.floor(position.line)))
    const clamped = {
      line,
      column: Math.max(0, Math.min(this.controller.document.getLineLength(line), Math.floor(position.column))),
    }
    const visibleLine = this.controller.toVisibleLine(clamped.line)
    if (visibleLine === null) return null
    const lineText = this._lineTextForPaint(clamped.line)
    const lineHeight = this._lineHeight(context)
    const g = this.globalOffset
    return {
      x: g.x + this._gutterWidth(context) + this._foldLaneWidth() - this._scrollX +
        this._measureTextPrefix(lineText, clamped.column, context),
      y: g.y + visibleLine * lineHeight - this._scrollY,
      width: 1,
      height: lineHeight,
    }
  }

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    this.size = {
      width: constraints.maxWidth === Infinity ? DEFAULT_WIDTH : constraints.maxWidth,
      height: constraints.maxHeight === Infinity ? DEFAULT_HEIGHT : constraints.maxHeight,
    }
    if (_context.pass === 'measure') return
    this._syncContentWidth()
    this._clampScroll()
    if (this._focused) this._updateComposerPosition()
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const theme = context.theme
    const fontSize = this._fontSize(context)
    const fontFamily = this._fontFamily(context)
    const lineHeight = this._lineHeight(context)
    const scrollbarStyle = deriveScrollbarStyle(theme)
    const syntax = resolveThemeSyntax(theme)
    const gutterWidth = this._gutterWidth(context)
    const range = calcFixedVirtualRange({
      itemCount: this.controller.getVisibleLineCount(),
      itemSize: lineHeight,
      viewportSize: this._viewH,
      scrollOffset: this._scrollY,
      overscan: OVERSCAN_LINES,
    })
    const x = offset.x
    const y = offset.y
    const frame = { x, y, width: this.size.width, height: this.size.height }
    const frameStyle = {
      background: theme.surfacePanel,
      border: this._focused ? theme.focusBorder : theme.borderPanel,
      borderRadius: theme.frameRounding,
    }

    paintSurfaceBackground(dl, frame, this._appearance, frameStyle)
    pushSurfaceContentClip(dl, frame, this._appearance, frameStyle.borderRadius)
    dl.fillRect(x, y, gutterWidth, this._viewH, theme.surfaceDataHeader, 0)
    dl.line(x + gutterWidth - 0.5, y, x + gutterWidth - 0.5, y + this._viewH, theme.borderSubtle, 1)

    this._lastPaintedLineCount = 0
    dl.pushClip(x, y, gutterWidth, this._viewH)
    for (let visibleLine = range.startIndex; visibleLine <= range.endIndex && visibleLine >= 0; visibleLine++) {
      const logicalLine = this.controller.toLogicalLine(visibleLine)
      const rowY = y + visibleLine * lineHeight - range.scrollOffset
      this._paintGutterLine({
        context,
        dl,
        x,
        y: rowY,
        gutterWidth,
        lineHeight,
        fontSize,
        fontFamily,
        logicalLine,
      })
    }
    dl.popClip()
    dl.pushClip(x + gutterWidth, y, Math.max(0, this._viewW - gutterWidth), this._viewH)
    for (let visibleLine = range.startIndex; visibleLine <= range.endIndex && visibleLine >= 0; visibleLine++) {
      const logicalLine = this.controller.toLogicalLine(visibleLine)
      const rowY = y + visibleLine * lineHeight - range.scrollOffset
      this._paintLine({
        context,
        dl,
        x,
        y: rowY,
        gutterWidth,
        lineHeight,
        fontSize,
        fontFamily,
        syntax,
        visibleLine,
        logicalLine,
      })
      this._lastPaintedLineCount++
    }
    dl.popClip()
    if (this._showVBar) {
      paintVBar({
        dl,
        style: scrollbarStyle,
        trackX: x + this.size.width - this._scrollbarSize,
        trackY: y,
        trackW: this._scrollbarSize,
        trackH: this.size.height - (this._showHBar ? this._scrollbarSize : 0),
        viewSize: this._viewH,
        contentSize: this._contentH,
        scrollOffset: this._scrollY,
        state: this._vScrollbar,
      })
    }
    if (this._showHBar) {
      paintHBar({
        dl,
        style: scrollbarStyle,
        trackX: x,
        trackY: y + this.size.height - this._scrollbarSize,
        trackW: this.size.width - (this._showVBar ? this._scrollbarSize : 0),
        trackH: this._scrollbarSize,
        viewSize: this._viewW,
        contentSize: this._contentW,
        scrollOffset: this._scrollX,
        state: this._hScrollbar,
      })
    }
    dl.popClip()
    paintSurfaceBorder(dl, frame, this._appearance, frameStyle)
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event) || !this.hitTest(event.position)) return
    this._selectionAutoScroll.stop()
    const vertical = this._showVBar
      ? this._vScrollbarController.beginPointer(event.position, this._vScrollbarGeometry(), pointerKey(event))
      : { handled: false, stateChanged: false, action: 'none' as const }
    const horizontal = !vertical.handled && this._showHBar
      ? this._hScrollbarController.beginPointer(event.position, this._hScrollbarGeometry(), pointerKey(event))
      : { handled: false, stateChanged: false, action: 'none' as const }
    if (vertical.handled) {
      if (vertical.scrollOffset !== undefined) this._scrollY = vertical.scrollOffset
      this._draggingVBar = vertical.dragStarted === true
      if (this._draggingVBar) event.setPointerCapture?.()
      this.markNeedsPaint()
      return
    }
    if (horizontal.handled) {
      if (horizontal.scrollOffset !== undefined) this._scrollX = horizontal.scrollOffset
      this._draggingHBar = horizontal.dragStarted === true
      if (this._draggingHBar) event.setPointerCapture?.()
      this.markNeedsPaint()
      return
    }
    const hit = this._hitPosition(event.position)
    const isFoldHit = this.folding && this._hitFoldToggle(event.position, hit.line)
    if (isFoldHit) {
      FocusManager.instance.setFocus(this)
      this.editSession.focusComposer()
      this.controller.toggleFold(hit.line)
      this._clampScroll()
      this.markNeedsPaint()
      return
    }
    const wasFocused = this._focused
    const foldedSelection = this._foldedSelectionAt(event.position, hit)
    if (foldedSelection && event.shiftKey !== true) {
      this.controller.setSelection(foldedSelection.end, foldedSelection.start)
    } else {
      this.controller.setCursor(foldedSelection?.end ?? hit, event.shiftKey === true)
    }
    this._deferComposerFocusOnStart = !wasFocused
    FocusManager.instance.setFocus(this)
    this._draggingSelection = true
    event.setPointerCapture?.()
    this.textInput.resetBlink()
    this.markNeedsPaint()
    if (wasFocused) {
      this._syncComposer()
      this.editSession.refresh({
        syncComposer: false,
        scrollToCursor: false,
        updateComposerPosition: true,
        resetBlink: true,
      })
    } else {
      this._deferComposerSync()
    }
  }

  onPointerMove(event: PointerEvent): void {
    const wasHovered = this._hovered
    this._hovered = this.hitTest(event.position)
    if (wasHovered !== this._hovered) this.markNeedsPaint()

    if (this._draggingVBar) {
      this._selectionAutoScroll.stop()
      const result = this._vScrollbarController.updatePointer(event.position, this._vScrollbarGeometry(), pointerKey(event))
      this._scrollY = result.scrollOffset ?? this._scrollY
      this.markNeedsPaint()
      return
    }
    if (this._draggingHBar) {
      this._selectionAutoScroll.stop()
      const result = this._hScrollbarController.updatePointer(event.position, this._hScrollbarGeometry(), pointerKey(event))
      this._scrollX = result.scrollOffset ?? this._scrollX
      this.markNeedsPaint()
      return
    }
    const changedV = this._showVBar
      ? this._vScrollbarController.updateHover(event.position, this._vScrollbarGeometry())
      : this._vScrollbarController.clearHover()
    const changedH = this._showHBar
      ? this._hScrollbarController.updateHover(event.position, this._hScrollbarGeometry())
      : this._hScrollbarController.clearHover()
    if (changedV || changedH) this.markNeedsPaint()
    if (!this._draggingSelection || !this._focused) return
    this._extendPointerSelection(event.position)
    this._updateSelectionAutoScroll(event.position)
  }

  onPointerUp(event: PointerEvent): void {
    const key = pointerKey(event)
    if ((this._draggingVBar && !this._vScrollbarController.ownsPointer(key)) ||
      (this._draggingHBar && !this._hScrollbarController.ownsPointer(key))) return
    const syncSelection = this._draggingSelection && this._focused
    this._selectionAutoScroll.stop()
    this._draggingSelection = false
    this._draggingVBar = false
    this._draggingHBar = false
    this._vScrollbarController.endPointer(event.position, this._vScrollbarGeometry(), key)
    this._hScrollbarController.endPointer(event.position, this._hScrollbarGeometry(), key)
    event.releasePointerCapture?.()
    if (syncSelection) {
      this._syncComposer()
      this.editSession.refresh({
        syncComposer: false,
        scrollToCursor: false,
        updateComposerPosition: true,
        resetBlink: true,
      })
    }
    this.markNeedsPaint()
  }

  onDoubleClick(position: Offset): void {
    const hit = this.hitDoubleClickTextPosition(position)
    if (!hit) return
    const range = this._jsonTokenSelectionAt(hit) ?? this._wordSelectionAt(hit)
    if (!range) return
    FocusManager.instance.setFocus(this)
    this.controller.setSelection(range.start, range.end)
    this._draggingSelection = false
    this.textInput.resetBlink()
    this._syncTextInputSelection()
    this.editSession.refresh({
      syncComposer: false,
      scrollToCursor: false,
      updateComposerPosition: true,
      resetBlink: true,
    })
    this.markNeedsPaint()
  }

  onPointerCancel(event: PointerEvent): void {
    this.onPointerUp(event)
  }

  onPointerLeave(_event: PointerEvent): void {
    const changedV = this._vScrollbarController.clearHover()
    const changedH = this._hScrollbarController.clearHover()
    if (!this._hovered && !changedV && !changedH) return
    this._hovered = false
    this.markNeedsPaint()
  }

  private _extendPointerSelection(position: Offset): void {
    const rawHit = this._hitPosition(position)
    const hit = this._foldedSelectionAt(position, rawHit)?.end ?? rawHit
    const before = this.controller.cursor
    this.controller.setCursor(hit, true)
    if (!positionEquals(before, hit)) this.markNeedsPaint()
  }

  private _updateSelectionAutoScroll(position: Offset): void {
    if (!this._draggingSelection || !this._focused) {
      this._selectionAutoScroll.stop()
      return
    }
    this._selectionAutoScroll.update(this._selectionAutoScrollInput(position))
  }

  private _selectionAutoScrollInput(position: Offset): EdgeAutoScrollInput {
    const bounds = this._selectionViewportBounds()
    const edgeX = Math.min(SELECTION_AUTO_SCROLL_EDGE, Math.max(0, (bounds.right - bounds.left) / 2))
    const edgeY = Math.min(SELECTION_AUTO_SCROLL_EDGE, Math.max(0, (bounds.bottom - bounds.top) / 2))
    return {
      position: { ...position },
      bounds,
      edgeSizeX: edgeX,
      edgeSizeY: edgeY,
      maxStepX: Math.max(8, this._lineHeight() * 2),
      maxStepY: Math.max(8, this._lineHeight()),
      minStep: 4,
    }
  }

  private _selectionViewportBounds(): { left: number; top: number; right: number; bottom: number } {
    const g = this.globalOffset
    return {
      left: g.x + this._gutterWidth() + this._foldLaneWidth(),
      top: g.y,
      right: g.x + this._viewW,
      bottom: g.y + this._viewH,
    }
  }

  private _tickSelectionAutoScroll(
    delta: Readonly<{ x: number; y: number }>,
    input: Readonly<EdgeAutoScrollInput>,
  ): boolean {
    if (!this._draggingSelection || !this._focused) return false
    const beforeX = this._scrollX
    const beforeY = this._scrollY
    this._scrollX = clampScrollOffset(beforeX + delta.x, this._viewW, this._contentW)
    this._scrollY = clampScrollOffset(beforeY + delta.y, this._viewH, this._contentH)
    const changed = this._scrollX !== beforeX || this._scrollY !== beforeY
    const bounds = input.bounds
    const clampedPosition = {
      x: Math.max(bounds.left, Math.min(bounds.right - 1, input.position.x)),
      y: Math.max(bounds.top, Math.min(bounds.bottom - 1, input.position.y)),
    }
    this._extendPointerSelection(clampedPosition)
    if (changed) this.markNeedsPaint()
    return changed
  }

  onWheel(event: WheelPointerEvent): boolean {
    if (!this.hitTest(event.position)) return false
    if (event.deltaX === 0 && event.deltaY === 0) return false
    const beforeX = this._scrollX
    const beforeY = this._scrollY
    const lineHeight = this._lineHeight()
    const horizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
    if (horizontal) {
      this._scrollX = clampScrollOffset(this._scrollX + Math.sign(event.deltaX || event.deltaY) * lineHeight * 3, this._viewW, this._contentW)
    } else {
      this._scrollY = clampScrollOffset(this._scrollY + Math.sign(event.deltaY) * lineHeight * 3, this._viewH, this._contentH)
    }
    if (this._scrollX === beforeX && this._scrollY === beforeY) return horizontal ? this._showHBar : this._showVBar
    this.markNeedsPaint()
    return true
  }

  override dispose(): void {
    this._blur()
    this._selectionAutoScroll.dispose()
    this._unsubscribeControllerChange()
    this._unsubscribeControllerChange = () => {}
    this.textInput.dispose()
    if (this._focusRegistered && typeof window !== 'undefined') {
      FocusManager.instance.unregister(this)
      this._focusRegistered = false
    }
    this.lineWidthCache.clear()
    super.dispose()
  }

  protected override onVisibilityChanged(_visible: boolean): void {
    if (!this.visible) this._clearInteractionState()
    this._syncFocusRegistration()
  }

  private _paintGutterLine(options: {
    context: PaintContext
    dl: DrawList
    x: number
    y: number
    gutterWidth: number
    lineHeight: number
    fontSize: number
    fontFamily: string
    logicalLine: number
  }): void {
    const { context, dl, x, y, gutterWidth, lineHeight, fontSize, fontFamily, logicalLine } = options
    const centerY = y + lineHeight / 2
    if (this.showLineNumbers) {
      dl.fillText(String(logicalLine + 1), x + gutterWidth - 12, centerY, context.theme.textSecondary, fontSize, fontFamily, 'right', 'middle')
    }
  }

  private _paintLine(options: {
    context: PaintContext
    dl: DrawList
    x: number
    y: number
    gutterWidth: number
    lineHeight: number
    fontSize: number
    fontFamily: string
    syntax: ThemeSyntaxTokens
    visibleLine: number
    logicalLine: number
  }): void {
    const { context, dl, x, y, gutterWidth, lineHeight, fontSize, fontFamily, syntax, logicalLine } = options
    const theme = context.theme
    const lineText = this._lineTextForPaint(logicalLine)
    const centerY = y + lineHeight / 2
    const textX = x + gutterWidth + this._foldLaneWidth() - this._scrollX
    const selectionRange = this._selectionColumnRangeForLine(logicalLine, lineText)
    if (logicalLine === this.controller.cursor.line && this._focused) {
      dl.fillRect(x + gutterWidth, y, this._viewW - gutterWidth, lineHeight, theme.stateHoverOverlay, 0)
    }
    if (this.showIndentGuides) this._paintIndentGuides(dl, context, logicalLine, textX, y, lineHeight)
    if (this.folding) this._paintFoldMarker(dl, context, logicalLine, textX, y, lineHeight)
    this._paintSelectionForLine(dl, context, logicalLine, textX, y, lineHeight, lineText)
    this._paintSearchMatchesForLine(dl, context, logicalLine, textX, y, lineHeight)
    this._paintTokens(dl, context, logicalLine, lineText, textX, centerY, fontSize, fontFamily, syntax, selectionRange)
    this._paintDecorationsForLine(dl, context, logicalLine, lineText, textX, y, lineHeight)
  }

  private _paintIndentGuides(
    dl: DrawList,
    context: PaintContext,
    line: number,
    textX: number,
    y: number,
    lineHeight: number,
  ): void {
    const level = this._indentLevel(this.controller.document.getLine(line))
    if (level <= 0) return
    const step = this._indentStep(context)
    const color = context.theme.borderSubtle
    const contentLeft = textX + this._scrollX
    const contentRight = contentLeft + Math.max(0, this._viewW - this._gutterWidth(context))
    for (let guide = 1; guide <= level; guide += 1) {
      const guideX = textX + guide * step - 0.5
      if (guideX < contentLeft || guideX > contentRight) continue
      dl.line(guideX, y, guideX, y + lineHeight, color, 1)
    }
  }

  private _paintTokens(
    dl: DrawList,
    context: PaintContext,
    line: number,
    text: string,
    textX: number,
    textY: number,
    fontSize: number,
    fontFamily: string,
    syntax: ThemeSyntaxTokens,
    selectionRange: ColumnRange | null,
  ): void {
    if (text.length > LONG_LINE_TOKEN_LIMIT) {
      const window = this._visibleColumnWindow(text, context)
      this._paintTextRange(dl, context, text, window.startColumn, window.startColumn + window.text.length, textX, textY, context.theme.textPrimary, fontSize, fontFamily, selectionRange)
      return
    }
    if (text !== this.controller.document.getLine(line)) {
      this._paintTextRange(dl, context, text, 0, text.length, textX, textY, context.theme.textPrimary, fontSize, fontFamily, selectionRange)
      return
    }
    const tokens = this._lineTokenProvider?.({
      line,
      lineText: text,
      document: this.controller.document,
      documentVersion: this.controller.document.version,
    }) ?? this.controller.getLineTokens(line)
    if (tokens.length === 0) {
      this._paintTextRange(dl, context, text, 0, text.length, textX, textY, context.theme.textPrimary, fontSize, fontFamily, selectionRange)
      return
    }
    let cursor = 0
    for (const token of tokens) {
      if (token.startColumn > cursor) {
        this._paintTextRange(dl, context, text, cursor, token.startColumn, textX, textY, context.theme.textPrimary, fontSize, fontFamily, selectionRange)
      }
      this._paintTextRange(dl, context, text, token.startColumn, token.endColumn, textX, textY, this._tokenColor(token.type, context, syntax), fontSize, fontFamily, selectionRange)
      cursor = token.endColumn
    }
    if (cursor < text.length) {
      this._paintTextRange(dl, context, text, cursor, text.length, textX, textY, context.theme.textPrimary, fontSize, fontFamily, selectionRange)
    }
  }

  private _paintDecorationsForLine(
    dl: DrawList,
    context: PaintContext,
    line: number,
    lineText: string,
    textX: number,
    y: number,
    lineHeight: number,
  ): void {
    if (this._decorations.length === 0) return
    for (const decoration of this._decorations) {
      if (!lineIntersectsSelection(line, decoration.range)) continue
      const startColumn = line === decoration.range.start.line ? decoration.range.start.column : 0
      const endColumn = line === decoration.range.end.line ? decoration.range.end.column : lineText.length
      if (endColumn <= startColumn) continue
      const clampedStart = Math.max(0, Math.min(lineText.length, startColumn))
      const clampedEnd = Math.max(0, Math.min(lineText.length, endColumn))
      if (clampedEnd <= clampedStart) continue
      const x0 = textX + this._measureTextPrefix(lineText, clampedStart, context)
      const x1 = textX + this._measureTextPrefix(lineText, clampedEnd, context)
      const underlineY = y + lineHeight - 4
      this._paintDecorationUnderline(dl, x0, underlineY, Math.max(4, x1 - x0), this._decorationColor(decoration.kind, context))
    }
  }

  private _paintDecorationUnderline(dl: DrawList, x: number, y: number, width: number, color: Color): void {
    const step = 4
    let currentX = x
    let up = true
    while (currentX < x + width) {
      const nextX = Math.min(x + width, currentX + step)
      dl.line(currentX, y + (up ? 0 : 2), nextX, y + (up ? 2 : 0), color, 1)
      currentX = nextX
      up = !up
    }
  }

  private _decorationColor(kind: PlainTextEditorDecorationKind | undefined, context: PaintContext): Color {
    if (kind === 'warning') return context.theme.accentWarning
    if (kind === 'info') return context.theme.textAccent
    if (kind === 'highlight') return context.theme.focusBorder
    return context.theme.accentDanger
  }

  private _paintTextRange(
    dl: DrawList,
    context: PaintContext,
    text: string,
    rangeStart: number,
    rangeEnd: number,
    textX: number,
    textY: number,
    color: Color,
    fontSize: number,
    fontFamily: string,
    selectionRange: ColumnRange | null,
  ): void {
    if (rangeEnd <= rangeStart) return
    const selectedStart = selectionRange ? Math.max(rangeStart, selectionRange.start) : rangeEnd
    const selectedEnd = selectionRange ? Math.min(rangeEnd, selectionRange.end) : rangeStart
    if (!selectionRange || selectedEnd <= selectedStart) {
      this._paintTextSegment(dl, context, text, rangeStart, rangeEnd, textX, textY, color, fontSize, fontFamily)
      return
    }
    this._paintTextSegment(dl, context, text, rangeStart, selectedStart, textX, textY, color, fontSize, fontFamily)
    const editorTheme = resolveThemeEditor(context.theme)
    this._paintTextSegment(dl, context, text, selectedStart, selectedEnd, textX, textY, editorTheme.selectionText, fontSize, fontFamily)
    this._paintTextSegment(dl, context, text, selectedEnd, rangeEnd, textX, textY, color, fontSize, fontFamily)
  }

  private _paintTextSegment(
    dl: DrawList,
    context: PaintContext,
    text: string,
    start: number,
    end: number,
    textX: number,
    textY: number,
    color: Color,
    fontSize: number,
    fontFamily: string,
  ): void {
    if (end <= start) return
    const visualStartColumn = this._visualColumnAt(text, start)
    const displayText = this._expandTabs(text.slice(start, end), visualStartColumn).text
    dl.fillText(
      displayText,
      textX + this._measureTextPrefix(text, start, context),
      textY,
      color,
      fontSize,
      fontFamily,
      'left',
      'middle',
    )
  }

  private _paintSelectionForLine(
    dl: DrawList,
    context: PaintContext,
    line: number,
    textX: number,
    y: number,
    lineHeight: number,
    lineText: string,
  ): void {
    const selectionRange = this._selectionColumnRangeForLine(line, lineText)
    if (!selectionRange) return
    const x0 = textX + this._measureTextPrefix(lineText, selectionRange.start, context)
    const x1 = textX + this._measureTextPrefix(lineText, selectionRange.end, context)
    const lineBreakWidth = selectionRange.includesLineBreak ? Math.max(4, this._charWidth(context) * 0.5) : 0
    dl.fillRect(x0, y + 2, Math.max(4, x1 - x0 + lineBreakWidth), lineHeight - 4, resolveThemeEditor(context.theme).selectionBg, 2)
  }

  private _selectionColumnRangeForLine(line: number, lineText: string): ColumnRange | null {
    if (!this.controller.hasSelection) return null
    const range = this.controller.selection
    if (!lineIntersectsSelection(line, range)) return null
    const startColumn = line === range.start.line ? range.start.column : 0
    const endColumn = line === range.end.line ? range.end.column : lineText.length
    const includesLineBreak = line < range.end.line
    if (endColumn < startColumn || (endColumn === startColumn && !includesLineBreak)) return null
    return {
      start: Math.max(0, Math.min(lineText.length, startColumn)),
      end: Math.max(0, Math.min(lineText.length, endColumn)),
      includesLineBreak,
    }
  }

  private _paintSearchMatchesForLine(
    dl: DrawList,
    context: PaintContext,
    line: number,
    textX: number,
    y: number,
    lineHeight: number,
  ): void {
    if (this._searchQuery.length === 0) return
    const editorTheme = resolveThemeEditor(context.theme)
    const lineText = this.controller.document.getLine(line)
    const visibleColumns = this._visibleColumnBounds(context)
    const matches = this.controller.findMatchesInLine(line, this._searchQuery, {
      caseSensitive: this._searchCaseSensitive,
      startColumn: visibleColumns.start,
      endColumn: visibleColumns.end,
    })
    for (const match of matches) {
      const x0 = textX + this._measureTextPrefix(lineText, match.start.column, context)
      const x1 = textX + this._measureTextPrefix(lineText, match.end.column, context)
      const active = this._activeSearchMatch ? sameRange(match, this._activeSearchMatch) : false
      dl.fillRect(
        x0,
        y + 2,
        Math.max(4, x1 - x0),
        lineHeight - 4,
        active ? editorTheme.searchActiveMatchBg : editorTheme.searchMatchBg,
        2,
      )
      if (active) {
        dl.strokeRect(x0, y + 2, Math.max(4, x1 - x0), lineHeight - 4, editorTheme.searchActiveMatchBorder, 1, 2)
      }
    }
  }

  private _caretGeometry(origin: Offset = this.globalOffset, context?: PaintContext): { x: number; y: number; height: number } | null {
    const visibleLine = this.controller.toVisibleLine(this.controller.cursor.line)
    if (visibleLine === null) return null
    const lineText = this._lineTextForPaint(this.controller.cursor.line)
    const lineHeight = this._lineHeight(context)
    return {
      x: origin.x + this._gutterWidth(context) + this._foldLaneWidth() - this._scrollX +
        this._measureTextPrefix(lineText, this._visualCursorColumn(), context),
      y: origin.y + visibleLine * lineHeight - this._scrollY + 3,
      height: lineHeight - 6,
    }
  }

  private _caretDirtyRect(): Rect {
    const caret = this._caretGeometry()
    if (!caret) return { x: this.globalOffset.x, y: this.globalOffset.y, width: 1, height: 1 }
    return {
      x: Math.floor(caret.x - 3),
      y: Math.floor(caret.y - 3),
      width: 8,
      height: Math.ceil(caret.height + 6),
    }
  }

  private _invalidateCaret(): void {
    if (!this._focused) return
    const next = this._caretDirtyRect()
    this.markNeedsTransientPaint(this._lastCaretDirtyRect ? unionRect(this._lastCaretDirtyRect, next) : next)
    this._lastCaretDirtyRect = next
  }

  override performTransientPaint(context: PaintContext, offset: Offset): void {
    if (!this._focused || !this.textInput.cursorVisible) return
    const caret = this._caretGeometry(offset, context)
    if (!caret) return
    const dl = new DrawList(context)
    const gutterWidth = this._gutterWidth(context)
    dl.pushClip(offset.x + gutterWidth, offset.y, Math.max(0, this._viewW - gutterWidth), this._viewH)
    dl.line(caret.x, caret.y, caret.x, caret.y + caret.height, context.theme.focusBorder, 1.5)
    dl.popClip()
  }

  private _paintFoldMarker(
    dl: DrawList,
    context: PaintContext,
    line: number,
    textX: number,
    y: number,
    lineHeight: number,
  ): void {
    const hasFold = this.controller.folding.isCollapsedStart(line) || this._lineCanFold(line)
    if (!hasFold) return
    const rect = this._foldMarkerRectAt(line, textX, y, lineHeight, context)
    paintIconGlyph(context, {
      name: this.controller.folding.isCollapsedStart(line) ? 'chevron-right' : 'chevron-down',
      x: rect.x,
      y: rect.y,
      size: rect.size,
      color: context.theme.textSecondary,
    })
  }

  private _focus(): void {
    if (this._focused) return
    this._focused = true
    const deferComposerFocus = this._deferComposerFocusOnStart
    this._deferComposerFocusOnStart = false
    const cursor = this.controller.cursor
    this.editSession.start({
      initialValue: this.controller.document.getLine(this.controller.cursor.line),
      initialSelection: {
        start: cursor.column,
        end: cursor.column,
        cursorPos: cursor.column,
        syncComposer: true,
      },
      syncComposerOnStart: false,
      focusComposer: !deferComposerFocus,
      refreshOnStart: deferComposerFocus ? false : true,
      onInput: (lineValue, session) => {
        if (this.textInput.composing || this._discardStaleComposerValue(session)) return
        this._runComposerMutation(() => {
          const scrollToCursor = this._isCursorVisibleInViewport()
          this.textInput.syncSelectionFromComposer({ ignoreComposing: true })
          this.controller.replaceCurrentLine(lineValue, this.textInput.cursorPos)
          this._afterDocumentChanged()
          session.refresh({ syncComposer: true, scrollToCursor })
        })
      },
      onCompositionStart: session => {
        if (this.readonly) {
          this.textInput.clearComposition()
          this._syncComposer()
          return
        }
        this._runComposerMutation(() => {
          this._ensureComposerSynced()
          if (this._prepareSelectionReplacement()) {
            session.refresh({ syncComposer: true, resetBlink: true })
          }
          this.onEditorCompositionStart()
        })
      },
      onCompositionUpdate: (_text, session) => {
        session.refresh({ scrollToCursor: true })
      },
      onCompositionEnd: (lineValue, session) => {
        if (this._discardStaleComposerValue(session)) return
        this._runComposerMutation(() => {
          const scrollToCursor = this._isCursorVisibleInViewport()
          this.textInput.syncSelectionFromComposer()
          this.controller.replaceCurrentLine(lineValue, this.textInput.cursorPos)
          this._afterDocumentChanged()
          session.refresh({ syncComposer: true, scrollToCursor })
        })
      },
      onKeyDown: (event, session) => this._runComposerMutation(() => this._handleKeyDown(event, session)),
      onPaste: (event, session) => {
        event.preventDefault()
        if (this.readonly) {
          this._syncComposer()
          return
        }
        this._runComposerMutation(() => {
          const text = this._clipboardText(event)
          if (text.length === 0) {
            this._syncComposer()
            return
          }
          const scrollToCursor = this._isCursorVisibleInViewport()
          this.controller.insertText(text)
          this._afterDocumentChanged()
          session.refresh({ syncComposer: true, resetBlink: true, scrollToCursor })
        })
      },
    })
    this.textInput.setComposerReadOnly(this.readonly)
    this.markNeedsPaint()
    this._invalidateCaret()
  }

  private _blur(): void {
    if (!this._focused) return
    this._selectionAutoScroll.stop()
    this._draggingSelection = false
    this._invalidateCaret()
    this._focused = false
    this.editSession.end()
    this.markNeedsPaint()
  }

  protected onEditorKeyDown(_event: KeyboardEvent, _session: TextEditSessionApi): boolean {
    return false
  }

  protected onEditorCompositionStart(): void {}

  onKeyDown(event: KeyboardEvent): boolean {
    if (this._handleUndoRedoKey(event)) return true
    if (event.key !== 'Tab') return false
    this._ensureComposerSynced()
    if (this.onEditorKeyDown(event, this._keyboardSessionApi())) {
      this.editSession.refresh({ syncComposer: true, resetBlink: true })
      return true
    }
    return this._handleIndentKey(event)
  }

  private _handleKeyDown(event: KeyboardEvent, session: TextEditSessionApi): void {
    this._ensureComposerSynced()
    if (this.onEditorKeyDown(event, session)) {
      session.refresh({ syncComposer: true, resetBlink: true })
      return
    }
    if (this._handleUndoRedoKey(event)) {
      session.refresh({ syncComposer: true, resetBlink: true })
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this._blur()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      this.controller.selectAll()
      this._syncTextInputSelection()
      session.refresh({ syncComposer: true })
      return
    }
    if (event.key === 'Tab') {
      if (this._handleIndentKey(event)) {
        session.refresh({ syncComposer: true, resetBlink: true })
      }
      return
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault()
      this.controller.moveCursorToDocumentBoundary(event.key === 'Home' ? 'start' : 'end', event.shiftKey)
      this._syncTextInputSelection()
      session.refresh({ syncComposer: true, resetBlink: true })
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      this.controller.moveCursorToLineBoundary(event.key === 'Home' ? 'start' : 'end', event.shiftKey)
      this._syncTextInputSelection()
      session.refresh({ syncComposer: true, resetBlink: true })
      return
    }
    if (event.metaKey && !event.ctrlKey && !event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      this.controller.moveCursorToLineBoundary(event.key === 'ArrowLeft' ? 'start' : 'end', event.shiftKey)
      this._syncTextInputSelection()
      session.refresh({ syncComposer: true, resetBlink: true })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (!this.readonly) this.controller.insertNewline()
      this._afterDocumentChanged()
      session.refresh({ syncComposer: true, resetBlink: true })
      return
    }
    if (event.key === 'Backspace') {
      event.preventDefault()
      if (!this.readonly) this.controller.deleteBackward()
      this._afterDocumentChanged()
      session.refresh({ syncComposer: true, resetBlink: true })
      return
    }
    if (event.key === 'Delete') {
      event.preventDefault()
      if (!this.readonly) this.controller.deleteForward()
      this._afterDocumentChanged()
      session.refresh({ syncComposer: true, resetBlink: true })
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      this.controller.moveCursorHorizontal(-1, event.shiftKey)
      this._syncTextInputSelection()
      session.refresh({ syncComposer: true, resetBlink: true })
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      this.controller.moveCursorHorizontal(1, event.shiftKey)
      this._syncTextInputSelection()
      session.refresh({ syncComposer: true, resetBlink: true })
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      this.controller.moveCursorVertical(event.key === 'ArrowUp' ? -1 : 1, event.shiftKey)
      this._syncTextInputSelection()
      session.refresh({ syncComposer: true, resetBlink: true })
      return
    }
    if (this._isPrintableInputKey(event) && this._prepareSelectionReplacement()) {
      session.refresh({ syncComposer: true, resetBlink: true })
    }
  }

  private _handleIndentKey(event: KeyboardEvent): boolean {
    if (event.key !== 'Tab') return false
    if (event.ctrlKey || event.metaKey || event.altKey || this.readonly) return false
    event.preventDefault()
    const changed = event.shiftKey
      ? this.controller.outdentSelectedLines(this.tabSize)
      : this.controller.indentSelectedLines(' '.repeat(this.tabSize))
    if (changed) this._afterDocumentChanged()
    this._syncTextInputSelection()
    this.editSession.refresh({ syncComposer: true, resetBlink: true })
    return true
  }

  private _handleUndoRedoKey(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase()
    const undo = (event.ctrlKey || event.metaKey) && !event.altKey && key === 'z' && !event.shiftKey
    const redo = ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'z' && event.shiftKey)
      || (event.ctrlKey && !event.metaKey && !event.altKey && key === 'y')
    if (!undo && !redo) return false
    event.preventDefault()
    if (this.readonly) return true
    const changed = undo ? this.controller.undo() : this.controller.redo()
    if (changed) this._afterDocumentChanged()
    this._syncTextInputSelection()
    this.editSession.refresh({ syncComposer: true, resetBlink: true })
    return true
  }

  private _keyboardSessionApi(): TextEditSessionApi {
    return {
      controller: this.textInput,
      focusComposer: () => this.editSession.focusComposer(),
      refresh: opts => this.editSession.refresh(opts),
      defer: (task, opts) => this.editSession.defer(task, opts),
    }
  }

  protected _afterDocumentChanged(): void {
    this.lineWidthCache.clear()
    this._clampScroll()
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  private _handleControllerChange(result?: TextEditResult): void {
    this._handleComposerControllerChange()
    const document = this.controller.document
    const actualDocumentChanged = document.version !== this._observedDocumentVersion
    if (actualDocumentChanged) {
      this._observedDocumentVersion = document.version
      this._activeSearchMatch = null
      this._foldRangeCache.clear()
    }
    const documentChanged = document.version !== this._extentDocumentVersion
    const foldingSignature = this._currentFoldingSignature()
    const foldingChanged = foldingSignature !== this._foldingSignature
    if (documentChanged) {
      this.lineWidthCache.clear()
      this._extentExactWidthCache.clear()
      const approximate = document.lineCount > EXACT_LINE_WIDTH_INDEX_LIMIT
      const canApplyIncrementally = !!result &&
        this._extentMetricKey.length > 0 &&
        this._extentApproximate === approximate &&
        this._lineWidthIndex.lineCount - result.oldLineCount + result.newLineCount === document.lineCount
      if (canApplyIncrementally) {
        const widths = new Array<number>(result.newLineCount)
        for (let offset = 0; offset < result.newLineCount; offset += 1) {
          widths[offset] = this._measureIndexedLine(result.firstChangedLine + offset)
        }
        this._lineWidthIndex.splice(result.firstChangedLine, result.oldLineCount, widths)
        this._extentDocumentVersion = document.version
      } else {
        this._extentDocumentVersion = -1
      }
    }
    if (!documentChanged && !foldingChanged) {
      this.markNeedsPaint()
      if (this._focused) this._updateComposerPosition()
      return
    }
    this._foldingSignature = foldingSignature
    if (this._extentDocumentVersion === document.version) this._refreshContentWidthFromIndex()
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  private _syncContentWidth(): void {
    this._ensureLineWidthIndex()
    this._refreshContentWidthFromIndex()
    this._foldingSignature = this._currentFoldingSignature()
  }

  private _refreshContentWidthFromIndex(): void {
    const effectiveRanges = this.controller.folding.effectiveCollapsedRanges
    const hiddenRanges = effectiveRanges.map(range => ({
      startLine: range.startLine + 1,
      endLine: range.endLine,
    }))
    let maxLineWidth = this._resolveIndexedMaxWidth(hiddenRanges)
    for (const range of effectiveRanges) {
      maxLineWidth = Math.max(maxLineWidth, this._measureExactText(this._lineTextForPaint(range.startLine)))
    }
    this._contentWidth = Math.max(
      0,
      maxLineWidth + this._gutterWidth() + this._foldLaneWidth() + 24,
    )
  }

  private _ensureLineWidthIndex(): void {
    const fontSize = this._fontSize()
    const fontFamily = this._fontFamily()
    const approximate = this.controller.document.lineCount > EXACT_LINE_WIDTH_INDEX_LIMIT
    const metricKey = `${fontSize}|${fontFamily}|${this.tabSize}|${approximate ? 'bounded' : 'exact'}`
    const document = this.controller.document
    if (
      metricKey === this._extentMetricKey &&
      document.version === this._extentDocumentVersion &&
      this._lineWidthIndex.lineCount === document.lineCount
    ) return

    if (metricKey !== this._extentMetricKey) {
      this.lineWidthCache.clear()
      this._extentExactWidthCache.clear()
      this._extentGlyphWidthCache.clear()
    }
    this._extentMetricKey = metricKey
    this._extentApproximate = approximate
    this._extentFontSize = fontSize
    this._extentFontFamily = fontFamily
    this._lineWidthIndex.rebuild(document.lineCount, line => this._measureIndexedLine(line))
    this._extentDocumentVersion = document.version
  }

  private _measureIndexedLine(line: number): number {
    const document = this.controller.document
    if (!this._extentApproximate) return this._measureExactDocumentLine(line)
    return this._measureTextUpperBound(document.getLine(line))
  }

  private _resolveIndexedMaxWidth(hiddenRanges: readonly { startLine: number; endLine: number }[]): number {
    if (!this._extentApproximate) return this._lineWidthIndex.maxWidth(hiddenRanges)
    let exactMax = 0
    for (let attempt = 0; attempt < MAX_LINE_WIDTH_REFINEMENTS_PER_LAYOUT; attempt += 1) {
      const candidate = this._lineWidthIndex.maxEntry(hiddenRanges)
      if (!candidate || candidate.width <= exactMax) return exactMax
      const exactWidth = this._measureExactDocumentLine(candidate.line)
      this._lineWidthIndex.setWidth(candidate.line, exactWidth)
      exactMax = Math.max(exactMax, exactWidth)
      if (exactWidth >= candidate.width) return exactMax
    }
    return Math.max(exactMax, this._lineWidthIndex.maxWidth(hiddenRanges))
  }

  private _measureExactDocumentLine(line: number): number {
    const document = this.controller.document
    const version = document.getLineVersion(line)
    const cached = this._extentExactWidthCache.get(line)
    if (cached?.version === version) return cached.width
    const width = this._measureExactText(document.getLine(line))
    this._extentExactWidthCache.set(line, { version, compositionKey: '', width })
    return width
  }

  private _measureExactText(text: string): number {
    return TextMeasurer.measureWidth(this._expandTabs(text).text, this._extentFontSize, this._extentFontFamily)
  }

  private _measureTextUpperBound(text: string): number {
    let width = 0
    for (const glyph of text) {
      let glyphWidth = this._extentGlyphWidthCache.get(glyph)
      if (glyphWidth === undefined) {
        glyphWidth = glyph === '\t'
          ? Math.max(
              TextMeasurer.measureWidth(glyph, this._extentFontSize, this._extentFontFamily),
              TextMeasurer.measureWidth(' '.repeat(this.tabSize), this._extentFontSize, this._extentFontFamily),
            )
          : TextMeasurer.measureWidth(glyph, this._extentFontSize, this._extentFontFamily)
        this._extentGlyphWidthCache.set(glyph, glyphWidth)
      }
      // Summed glyph advances plus one em per glyph deliberately overestimate
      // contextual shaping while keeping measurement proportional to unique glyphs.
      width += glyphWidth + this._extentFontSize
    }
    return width
  }

  private _currentFoldingSignature(): string {
    return this.controller.folding.collapsedRanges
      .map(range => `${range.startLine}:${range.endLine}`)
      .join('|')
  }

  private _prepareSelectionReplacement(): boolean {
    if (!this.controller.hasSelection || this.readonly) return false
    this.controller.deleteSelection()
    this._afterDocumentChanged()
    return true
  }

  private _searchStartPosition(backwards: boolean): TextPosition {
    if (!this._activeSearchMatch) return this.controller.cursor
    return backwards ? this._activeSearchMatch.start : this._activeSearchMatch.end
  }

  private _activateSearchMatch(match: PlainTextSearchMatch): void {
    this._activeSearchMatch = cloneSearchMatch(match)
    this.controller.expandToLine(match.start.line)
    this.controller.setSelection(match.start, match.end)
    this._scrollToCursor()
    if (this._focused) this._syncComposer()
    this.markNeedsPaint()
  }

  private _clipboardText(event: ClipboardEvent): string {
    return event.clipboardData?.getData('text/plain')
      ?? event.clipboardData?.getData('text')
      ?? ''
  }

  private _syncComposer(): void {
    const cursor = this.controller.cursor
    this.textInput.setComposerLineMode(this.controller.document.getLine(cursor.line), cursor.column)
    this._syncTextInputSelection()
    this._composerSyncDirty = false
  }

  private _deferComposerSync(): void {
    requestAnimationFrame(() => {
      if (!this._focused) return
      setTimeout(() => {
        if (!this._focused) return
        this.editSession.focusComposer()
        this.editSession.refresh({
          syncComposer: false,
          scrollToCursor: false,
          updateComposerPosition: true,
          invalidate: false,
        })
      }, 0)
    })
  }

  private _ensureComposerSynced(): void {
    if (!this._focused || !this._composerSyncDirty) return
    this._syncComposer()
  }

  private _handleComposerControllerChange(): void {
    if (!this._focused) return
    if (this._composerMutationDepth > 0 || this._draggingSelection || this.textInput.composing) {
      this._composerSyncDirty = true
      return
    }
    this._syncComposer()
  }

  private _runComposerMutation<T>(action: () => T): T {
    this._composerMutationDepth += 1
    try {
      return action()
    } finally {
      this._composerMutationDepth -= 1
    }
  }

  private _discardStaleComposerValue(session: TextEditSessionApi): boolean {
    if (!this.readonly && !this._composerSyncDirty) return false
    this._syncComposer()
    session.refresh({
      syncComposer: false,
      scrollToCursor: false,
      updateComposerPosition: true,
      resetBlink: true,
    })
    return true
  }

  private _syncTextInputSelection(): void {
    const cursor = this.controller.cursor
    const selection = this.controller.selection
    if (selection.start.line === cursor.line && selection.end.line === cursor.line) {
      this.textInput.setSelection(selection.start.column, selection.end.column, {
        cursorPos: cursor.column,
        syncComposer: true,
      })
      return
    }
    this.textInput.setSelection(cursor.column, cursor.column, {
      cursorPos: cursor.column,
      syncComposer: true,
    })
  }

  private _scrollToCursor(): void {
    const visibleLine = this.controller.toVisibleLine(this.controller.cursor.line)
    if (visibleLine === null) return
    const lineHeight = this._lineHeight()
    const lineTop = visibleLine * lineHeight
    if (lineTop < this._scrollY) this._scrollY = lineTop
    else if (lineTop + lineHeight > this._scrollY + this._viewH) this._scrollY = lineTop + lineHeight - this._viewH
    const caretX = this._measureTextPrefix(this._lineTextForPaint(this.controller.cursor.line), this._visualCursorColumn()) + this._gutterWidth() + this._foldLaneWidth()
    if (caretX < this._scrollX + this._gutterWidth()) this._scrollX = Math.max(0, caretX - this._gutterWidth())
    else if (caretX > this._scrollX + this._viewW - 24) this._scrollX = caretX - this._viewW + 24
    this._clampScroll()
  }

  private _isCursorVisibleInViewport(): boolean {
    const visibleLine = this.controller.toVisibleLine(this.controller.cursor.line)
    if (visibleLine === null) return false
    const lineHeight = this._lineHeight()
    const lineTop = visibleLine * lineHeight
    return lineTop >= this._scrollY && lineTop + lineHeight <= this._scrollY + this._viewH
  }

  private _updateComposerPosition(): void {
    if (!this._focused) return
    const visibleLine = this.controller.toVisibleLine(this.controller.cursor.line)
    if (visibleLine === null) return
    const lineText = this._lineTextForPaint(this.controller.cursor.line)
    const g = this.globalOffset
    this.textInput.updateComposerPosition(
      g.x + this._gutterWidth() + this._foldLaneWidth() - this._scrollX + this._measureTextPrefix(lineText, this._visualCursorColumn()),
      g.y + visibleLine * this._lineHeight() - this._scrollY,
    )
  }

  private _hitPosition(position: Offset): TextPosition {
    const g = this.globalOffset
    const localY = Math.max(0, position.y - g.y)
    const visibleLine = Math.max(0, Math.floor((localY + this._scrollY) / this._lineHeight()))
    const line = this.controller.toLogicalLine(visibleLine)
    const text = this.controller.document.getLine(line)
    const localX = Math.max(0, position.x - g.x - this._gutterWidth() - this._foldLaneWidth() + this._scrollX)
    return { line, column: this._hitColumn(text, localX) }
  }

  private _foldedSelectionAt(position: Offset, hit: TextPosition): TextRange | null {
    const range = this.controller.folding.effectiveCollapsedRanges.find(item => item.startLine === hit.line)
    if (!range) return null
    const lineText = this.controller.document.getLine(hit.line)
    const g = this.globalOffset
    const localX = position.x - g.x - this._gutterWidth() - this._foldLaneWidth() + this._scrollX
    const placeholderStart = this._measureText(lineText)
    const placeholderEnd = this._measureText(`${lineText} ...`)
    if (localX < placeholderStart || localX > placeholderEnd) return null
    return {
      start: { line: range.startLine, column: lineText.length },
      end: {
        line: range.endLine,
        column: this.controller.document.getLineLength(range.endLine),
      },
    }
  }

  private _hitCharacterPosition(position: Offset): TextPosition | null {
    const g = this.globalOffset
    const localY = position.y - g.y
    const visibleLine = Math.floor((localY + this._scrollY) / this._lineHeight())
    if (visibleLine < 0 || visibleLine >= this.controller.getVisibleLineCount()) return null

    const line = this.controller.toLogicalLine(visibleLine)
    const text = this.controller.document.getLine(line)
    const localX = position.x - g.x - this._gutterWidth() - this._foldLaneWidth() + this._scrollX
    if (text.length === 0 || localX < 0) return null

    if (text.length > LONG_LINE_EXACT_LIMIT) {
      const column = this._modelColumnForVisualColumn(text, Math.floor(localX / this._charWidth()))
      return column < text.length
        ? { line, column: snapColumnToGraphemeBoundary(text, column) }
        : null
    }

    if (localX >= this._measureText(text)) return null
    let low = 0
    let high = text.length - 1
    while (low < high) {
      const middle = (low + high) >> 1
      if (this._measureText(text.slice(0, middle + 1)) > localX) high = middle
      else low = middle + 1
    }
    return { line, column: snapColumnToGraphemeBoundary(text, low) }
  }

  private _hitColumn(text: string, localX: number): number {
    if (localX <= 0) return 0
    if (text.length > LONG_LINE_EXACT_LIMIT) {
      return snapColumnToGraphemeBoundary(
        text,
        this._modelColumnForVisualColumn(text, Math.round(localX / this._charWidth())),
      )
    }
    const total = this._measureText(text)
    if (localX >= total) return text.length
    let lo = 0
    let hi = text.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this._measureText(text.slice(0, mid)) <= localX) lo = mid
      else hi = mid - 1
    }
    const leftWidth = this._measureText(text.slice(0, lo))
    const rightWidth = lo < text.length ? this._measureText(text.slice(0, lo + 1)) : leftWidth
    const column = localX - leftWidth < rightWidth - localX ? lo : Math.min(lo + 1, text.length)
    return snapColumnToGraphemeBoundary(text, column)
  }

  private _hitFoldToggle(position: Offset, line: number): boolean {
    const rect = this._foldMarkerRectForLine(line)
    if (!rect) return false
    return (
      position.x >= rect.x
      && position.x <= rect.x + rect.size
      && position.y >= rect.y
      && position.y <= rect.y + rect.size
    )
  }

  private _lineCanFold(line: number): boolean {
    const text = this.controller.document.getLine(line)
    if (!text.includes('{') && !text.includes('[')) return false
    const version = this.controller.document.version
    const cached = this._foldRangeCache.get(line)
    if (cached?.version === version) return cached.range !== null
    const range = findJsonFoldRange(this.controller.document, line)
    this._foldRangeCache.set(line, { version, range })
    return range !== null
  }

  protected hitDoubleClickTextPosition(position: Offset): TextPosition | null {
    if (!this.hitTest(position) || this._inVBar(position) || this._inHBar(position)) return null
    return this._hitCharacterPosition(position)
  }

  private _jsonTokenSelectionAt(hit: TextPosition): { start: TextPosition; end: TextPosition } | null {
    if (this.controller.language !== 'json') return null
    const text = this.controller.document.getLine(hit.line)
    const token = this.controller.getLineTokens(hit.line).find(item =>
      isSelectableJsonToken(item.type) &&
      hit.column >= item.startColumn &&
      hit.column < item.endColumn,
    )
    if (!token) return null
    let startColumn = token.startColumn
    let endColumn = token.endColumn
    if ((token.type === 'property' || token.type === 'string') && text[token.startColumn] === '"') {
      startColumn = Math.min(token.endColumn, token.startColumn + 1)
      endColumn = text[token.endColumn - 1] === '"' ? Math.max(startColumn, token.endColumn - 1) : token.endColumn
    }
    return {
      start: { line: hit.line, column: startColumn },
      end: { line: hit.line, column: endColumn },
    }
  }

  private _wordSelectionAt(hit: TextPosition): { start: TextPosition; end: TextPosition } | null {
    const text = this.controller.document.getLine(hit.line)
    const range = resolveWordSelectionRange(text, hit.column)
    if (!range) return null
    return {
      start: { line: hit.line, column: range.start },
      end: { line: hit.line, column: range.end },
    }
  }

  private _indentLevel(text: string): number {
    let columns = 0
    for (const ch of text) {
      if (ch === ' ') {
        columns += 1
      } else if (ch === '\t') {
        columns += this.tabSize
      } else {
        break
      }
    }
    return Math.floor(columns / this.tabSize)
  }

  private _indentStep(context?: PaintContext): number {
    return Math.max(1, this._measureText(' '.repeat(this.tabSize), context))
  }

  private _lineTextForPaint(line: number): string {
    const text = this.controller.document.getLine(line)
    if (this.textInput.composing && line === this.controller.cursor.line) {
      const column = Math.max(0, Math.min(text.length, this.controller.cursor.column))
      return text.slice(0, column) + this.textInput.compositionText + text.slice(column)
    }
    return this.controller.folding.isCollapsedStart(line) ? `${text} ...` : text
  }

  private _visualCursorColumn(): number {
    if (!this.textInput.composing) return this.controller.cursor.column
    return this.controller.cursor.column + this.textInput.compositionText.length
  }

  private _measureLine(line: number, context?: PaintContext): number {
    const version = this.controller.document.getLineVersion(line)
    const compositionKey = this._lineCompositionKey(line)
    const cached = this.lineWidthCache.get(line)
    if (cached?.version === version && cached.compositionKey === compositionKey) return cached.width
    const width = this._measureText(this._lineTextForPaint(line), context)
    this.lineWidthCache.set(line, { version, compositionKey, width })
    return width
  }

  private _lineCompositionKey(line: number): string {
    if (!this.textInput.composing || line !== this.controller.cursor.line) return ''
    return `${this.controller.cursor.column}:${this.textInput.compositionText}`
  }

  private _measureText(text: string, context?: PaintContext): number {
    const expanded = this._expandTabs(text)
    if (text.length > LONG_LINE_EXACT_LIMIT) return expanded.columns * this._charWidth(context)
    return TextMeasurer.measureWidth(expanded.text, this._fontSize(context), this._fontFamily(context))
  }

  private _measureTextPrefix(text: string, column: number, context?: PaintContext): number {
    const clamped = Math.max(0, Math.min(text.length, Math.floor(column)))
    if (clamped === 0) return 0
    const prefix = text.slice(0, clamped)
    if (text.length > LONG_LINE_EXACT_LIMIT) return this._expandTabs(prefix).columns * this._charWidth(context)
    return this._measureText(prefix, context)
  }

  private _visualColumnAt(text: string, modelColumn: number): number {
    const clamped = Math.max(0, Math.min(text.length, Math.floor(modelColumn)))
    return this._expandTabs(text.slice(0, clamped)).columns
  }

  private _expandTabs(text: string, initialColumn = 0): { text: string; columns: number } {
    if (!text.includes('\t')) {
      return { text, columns: initialColumn + [...text].length }
    }
    const output: string[] = []
    let columns = initialColumn
    for (const character of text) {
      if (character === '\t') {
        const spaces = this.tabSize - (columns % this.tabSize || 0)
        output.push(' '.repeat(spaces))
        columns += spaces
      } else {
        output.push(character)
        columns += 1
      }
    }
    return { text: output.join(''), columns }
  }

  private _modelColumnForVisualColumn(text: string, targetColumn: number): number {
    const target = Math.max(0, Math.floor(targetColumn))
    let visualColumn = 0
    let modelColumn = 0
    for (const character of text) {
      const nextVisualColumn = character === '\t'
        ? visualColumn + this.tabSize - (visualColumn % this.tabSize || 0)
        : visualColumn + 1
      if (target < nextVisualColumn) return modelColumn
      visualColumn = nextVisualColumn
      modelColumn += character.length
    }
    return text.length
  }

  private _charWidth(context?: PaintContext): number {
    return Math.max(1, TextMeasurer.measureWidth('M', this._fontSize(context), this._fontFamily(context)))
  }

  private _visibleColumnWindow(text: string, context?: PaintContext): { startColumn: number; text: string } {
    const bounds = this._visibleColumnBounds(context)
    return {
      startColumn: bounds.start,
      text: text.slice(bounds.start, Math.min(text.length, bounds.end)),
    }
  }

  private _visibleColumnBounds(context?: PaintContext): { start: number; end: number } {
    const charWidth = this._charWidth(context)
    const contentWidth = Math.max(0, this._viewW - this._gutterWidth(context) - this._foldLaneWidth())
    const startColumn = Math.max(0, Math.floor(this._scrollX / charWidth) - 4)
    const visibleColumns = Math.ceil(contentWidth / charWidth) + 8
    return { start: startColumn, end: startColumn + visibleColumns }
  }

  private _tokenColor(type: string, context: PaintContext, syntax: ThemeSyntaxTokens): Color {
    const theme = context.theme
    if (type === 'property') return theme.textAccent
    if (type === 'string') return syntax.string
    if (type === 'number') return syntax.number
    if (type === 'keyword') return syntax.function
    if (type === 'comment') return syntax.meta
    if (type === 'variable') return theme.textAccent
    if (type === 'operator') return theme.textSecondary
    if (type === 'punctuation') return theme.textSecondary
    if (type === 'field') return theme.textAccent
    if (type === 'action') return theme.accentDanger
    if (type === 'dataset') return theme.accentSuccess
    if (type === 'rule') return theme.accentWarning
    if (type === 'quantity') return theme.accentWarning
    if (type === 'log-error') return theme.accentDanger
    if (type === 'log-warn') return theme.accentWarning
    if (type === 'log-info') return theme.textAccent
    if (type === 'log-debug') return theme.textSecondary
    if (type === 'log-number') return theme.textSecondary
    if (type === 'log-value') return theme.textPrimary
    return theme.textPrimary
  }

  private _clampScroll(): void {
    this._scrollX = clampScrollOffset(this._scrollX, this._viewW, this._contentW)
    this._scrollY = clampScrollOffset(this._scrollY, this._viewH, this._contentH)
  }

  private _foldLaneWidth(): number {
    return this.folding ? FOLD_MARKER_LANE_WIDTH : 0
  }

  private _foldMarkerRectForLine(line: number, context?: PaintContext): FoldMarkerRect | null {
    if (!this.folding || (!this._lineCanFold(line) && !this.controller.folding.isCollapsedStart(line))) return null
    const visibleLine = this.controller.toVisibleLine(line)
    if (visibleLine === null) return null
    const g = this.globalOffset
    const lineHeight = this._lineHeight(context)
    const textX = g.x + this._gutterWidth(context) + this._foldLaneWidth() - this._scrollX
    const y = g.y + visibleLine * lineHeight - this._scrollY
    return this._foldMarkerRectAt(line, textX, y, lineHeight, context)
  }

  private _foldMarkerRectAt(
    line: number,
    textX: number,
    y: number,
    lineHeight: number,
    context?: PaintContext,
  ): FoldMarkerRect {
    const level = this._indentLevel(this.controller.document.getLine(line))
    const indentX = textX + level * this._indentStep(context)
    const centerX = indentX - FOLD_MARKER_SIZE / 2
    return {
      x: centerX - FOLD_MARKER_SIZE / 2,
      y: y + (lineHeight - FOLD_MARKER_SIZE) / 2,
      size: FOLD_MARKER_SIZE,
    }
  }

  private get _contentH(): number {
    return this.controller.getVisibleLineCount() * this._lineHeight()
  }

  private get _contentW(): number {
    return Math.max(0, this._contentWidth, this._compositionContentWidth())
  }

  private get _showVBar(): boolean {
    return this._viewport.showVBar
  }

  private get _showHBar(): boolean {
    return this._viewport.showHBar
  }

  private get _viewW(): number {
    return this._viewport.width
  }

  private get _viewH(): number {
    return this._viewport.height
  }

  private get _viewport(): ReturnType<typeof resolveScrollbarViewport> {
    return resolveScrollbarViewport({
      outerWidth: this.size.width,
      outerHeight: this.size.height,
      contentWidth: this._contentW,
      contentHeight: this._contentH,
      scrollbarSize: this._scrollbarSize,
      allowHorizontal: true,
      allowVertical: true,
    })
  }

  private _compositionContentWidth(): number {
    if (!this.textInput.composing) return 0
    const line = this.controller.cursor.line
    if (this.controller.toVisibleLine(line) === null) return 0
    return this._measureLine(line) + this._gutterWidth() + this._foldLaneWidth() + 24
  }

  private get _scrollbarSize(): number {
    return deriveScrollbarStyle(this.currentTheme).gutterSize
  }

  private _inVBar(position: Offset): boolean {
    return this._showVBar && hitTestScrollbarGeometry(position, this._vScrollbarGeometry())
  }

  private _vScrollbarGeometry(): ScrollbarGeometry {
    const g = this.globalOffset
    const style = deriveScrollbarStyle(this.currentTheme)
    return resolveScrollbarGeometry({
      axis: 'vertical',
      trackRect: {
        x: g.x + this.size.width - style.gutterSize,
        y: g.y,
        width: style.gutterSize,
        height: this.size.height - (this._showHBar ? style.gutterSize : 0),
      },
      viewportSize: this._viewH,
      contentSize: this._contentH,
      scrollOffset: this._scrollY,
      visualThickness: style.thumbThickness,
      minThumbLength: style.minThumbLength,
      endInset: style.endInset,
    })
  }

  private _inHBar(position: Offset): boolean {
    return this._showHBar && hitTestScrollbarGeometry(position, this._hScrollbarGeometry())
  }

  private _hScrollbarGeometry(): ScrollbarGeometry {
    const g = this.globalOffset
    const style = deriveScrollbarStyle(this.currentTheme)
    return resolveScrollbarGeometry({
      axis: 'horizontal',
      trackRect: {
        x: g.x,
        y: g.y + this.size.height - style.gutterSize,
        width: this.size.width - (this._showVBar ? style.gutterSize : 0),
        height: style.gutterSize,
      },
      viewportSize: this._viewW,
      contentSize: this._contentW,
      scrollOffset: this._scrollX,
      visualThickness: style.thumbThickness,
      minThumbLength: style.minThumbLength,
      endInset: style.endInset,
    })
  }

  private _fontSize(context?: PaintContext): number {
    return this.fontSize ?? context?.theme.fontSize ?? this.currentTheme.fontSize
  }

  private _fontFamily(context?: PaintContext): string {
    const theme = context?.theme ?? this.currentTheme
    return this.fontFamily ?? resolveThemeTypography(theme).monoFontFamily
  }

  private _lineHeight(context?: PaintContext): number {
    return this.lineHeight ?? Math.ceil(this._fontSize(context) * 1.55)
  }

  private _gutterWidth(context?: PaintContext): number {
    if (!this.showLineNumbers && !this.folding) return 12
    const digits = String(this.controller.document.lineCount).length
    return Math.max(44, 22 + digits * this._fontSize(context) * 0.62)
  }

  private _syncFocusRegistration(): void {
    if (typeof window === 'undefined') return
    if (!this.visible) {
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

  private _clearInteractionState(): void {
    this._selectionAutoScroll.stop()
    if (typeof window !== 'undefined' && FocusManager.instance.current === this) {
      FocusManager.instance.clearFocusOf(this)
    } else if (this._focused) {
      this._blur()
    }
    this._hovered = false
    this._draggingSelection = false
    this._draggingVBar = false
    this._draggingHBar = false
    this._vScrollbarController.reset()
    this._hScrollbarController.reset()
    this.textInput.clearComposition()
  }

  private _isPrintableInputKey(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false
    return event.key.length === 1
  }
}

function cloneSearchMatch(match: PlainTextSearchMatch): PlainTextSearchMatch {
  return {
    start: { ...match.start },
    end: { ...match.end },
    text: match.text,
  }
}

function normalizeDecorations(decorations: PlainTextEditorDecoration[]): PlainTextEditorDecoration[] {
  return decorations.map(decoration => ({
    ...decoration,
    range: normalizeRange(decoration.range.start, decoration.range.end),
  }))
}

function cloneDecorations(decorations: PlainTextEditorDecoration[]): PlainTextEditorDecoration[] {
  return decorations.map(decoration => ({
    ...decoration,
    range: {
      start: { ...decoration.range.start },
      end: { ...decoration.range.end },
    },
  }))
}

function sameRange(a: TextRange, b: TextRange): boolean {
  return a.start.line === b.start.line &&
    a.start.column === b.start.column &&
    a.end.line === b.end.line &&
    a.end.column === b.end.column
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}

function isSelectableJsonToken(type: string): boolean {
  return type === 'property' ||
    type === 'string' ||
    type === 'number' ||
    type === 'keyword'
}
