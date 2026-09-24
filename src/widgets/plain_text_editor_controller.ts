import {
  LineArrayTextDocument,
  clampPosition,
  normalizeRange,
  positionEquals,
  type TextDocumentModel,
  type TextEditResult,
  type TextPosition,
  type TextRange,
} from './plain_text_document'
import { FoldingModel } from './plain_text_folding'
import {
  tokenizerForLanguage,
  type TextToken,
  type TextTokenizer,
} from './plain_text_tokenizer'

export interface PlainTextEditorChange {
  revision: number
  document: TextDocumentModel
  result?: TextEditResult
  getValue(): string
}

export type PlainTextEditorChangeListener = (change: PlainTextEditorChange) => void

export interface PlainTextEditorControllerOptions {
  value?: string
  document?: TextDocumentModel
  language?: string
  onChange?: (value: string) => void
  onDocumentChange?: (change: PlainTextEditorChange) => void
}

export interface PlainTextSearchOptions {
  caseSensitive?: boolean
  startColumn?: number
  endColumn?: number
}

export interface PlainTextFindOptions extends PlainTextSearchOptions {
  from?: TextPosition
  backwards?: boolean
  wrap?: boolean
}

export interface PlainTextSearchMatch extends TextRange {
  text: string
}

export interface PlainTextEditorSelectionState {
  anchor: TextPosition
  cursor: TextPosition
}

export interface ReversibleTextEdit {
  range: TextRange
  oldText: string
  newText: string
  inverseRange: TextRange
}

export interface PlainTextEditorHistoryEntry {
  label?: string
  beforeSelection: PlainTextEditorSelectionState
  afterSelection: PlainTextEditorSelectionState
  edits: ReversibleTextEdit[]
}

interface ActiveEditTransaction {
  label?: string
  beforeSelection: PlainTextEditorSelectionState
  edits: ReversibleTextEdit[]
}

interface TokenCacheEntry {
  lineVersion: number
  tokens: TextToken[]
}

const DEFAULT_HISTORY_LIMIT = 200

export class PlainTextEditorController {
  readonly document: TextDocumentModel
  readonly folding = new FoldingModel()
  onChange?: (value: string) => void
  onDocumentChange?: (change: PlainTextEditorChange) => void

  private _cursor: TextPosition = { line: 0, column: 0 }
  private _anchor: TextPosition = { line: 0, column: 0 }
  private _tokenizer: TextTokenizer
  private readonly _tokenCache = new Map<number, TokenCacheEntry>()
  private _revision = 0
  private _undoStack: PlainTextEditorHistoryEntry[] = []
  private _redoStack: PlainTextEditorHistoryEntry[] = []
  private _historyLimit = DEFAULT_HISTORY_LIMIT
  private _historySuspended = false
  private _activeTransaction: ActiveEditTransaction | null = null
  private readonly _changeListeners = new Set<PlainTextEditorChangeListener>()

  constructor(options: PlainTextEditorControllerOptions = {}) {
    this.document = options.document ?? new LineArrayTextDocument(options.value ?? '')
    this._tokenizer = tokenizerForLanguage(options.language ?? 'plain')
    this.onChange = options.onChange
    this.onDocumentChange = options.onDocumentChange
  }

  get revision(): number {
    return this._revision
  }

  get value(): string {
    return this.document.getText()
  }

  subscribeChange(listener: PlainTextEditorChangeListener): () => void {
    this._changeListeners.add(listener)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this._changeListeners.delete(listener)
    }
  }

  set value(value: string) {
    this.setValue(value)
  }

  get cursor(): TextPosition {
    return { ...this._cursor }
  }

  get anchor(): TextPosition {
    return { ...this._anchor }
  }

  get selection(): TextRange {
    return normalizeRange(this._anchor, this._cursor)
  }

  get hasSelection(): boolean {
    return !positionEquals(this._anchor, this._cursor)
  }

  get language(): string {
    return this._tokenizer.languageId
  }

  get canUndo(): boolean {
    return this._undoStack.length > 0
  }

  get canRedo(): boolean {
    return this._redoStack.length > 0
  }

  setValue(value: string): void {
    if (!(this.document instanceof LineArrayTextDocument)) {
      this._historySuspended = true
      try {
        this._replaceRangeRaw({
          start: { line: 0, column: 0 },
          end: {
            line: Math.max(0, this.document.lineCount - 1),
            column: this.document.getLineLength(Math.max(0, this.document.lineCount - 1)),
          },
        }, value)
      } finally {
        this._historySuspended = false
      }
      this.clearHistory()
      return
    }
    this.document.setValue(value)
    this._cursor = { line: 0, column: 0 }
    this._anchor = { ...this._cursor }
    this.folding.clear()
    this._tokenCache.clear()
    this.clearHistory()
    this._changed()
  }

  setLanguage(language: string): void {
    const tokenizer = tokenizerForLanguage(language)
    if (tokenizer.languageId === this._tokenizer.languageId) return
    this._tokenizer = tokenizer
    this._tokenCache.clear()
    this._changed(false)
  }

  setTokenizer(tokenizer: TextTokenizer): void {
    if (tokenizer === this._tokenizer) return
    this._tokenizer = tokenizer
    this._tokenCache.clear()
    this._changed(false)
  }

  setCursor(position: TextPosition, extendSelection = false): void {
    const nextCursor = clampPosition(position, this.document)
    const nextAnchor = extendSelection ? this._anchor : nextCursor
    if (positionEquals(this._cursor, nextCursor) && positionEquals(this._anchor, nextAnchor)) return
    this._cursor = nextCursor
    if (!extendSelection) this._anchor = { ...this._cursor }
    this._changed(false)
  }

  setSelection(anchor: TextPosition, focus: TextPosition): void {
    const nextAnchor = clampPosition(anchor, this.document)
    const nextCursor = clampPosition(focus, this.document)
    if (positionEquals(this._anchor, nextAnchor) && positionEquals(this._cursor, nextCursor)) return
    this._anchor = nextAnchor
    this._cursor = nextCursor
    this._changed(false)
  }

  selectAll(): void {
    const lastLine = Math.max(0, this.document.lineCount - 1)
    this._anchor = { line: 0, column: 0 }
    this._cursor = { line: lastLine, column: this.document.getLineLength(lastLine) }
    this._changed(false)
  }

  replaceRange(range: TextRange, text: string): TextEditResult | null {
    return this._replaceRangeWithHistory(range, text)
  }

  replaceAllText(value: string, label = 'replace-all'): boolean {
    const diff = computeMinimalTextDiff(this.value, value)
    if (!diff) return false
    return this.runEditTransaction(label, () => {
      this.replaceRange(diff.range, diff.newText)
    })
  }

  runEditTransaction(label: string, action: () => void): boolean {
    if (this._activeTransaction) {
      const beforeCount = this._activeTransaction.edits.length
      action()
      return this._activeTransaction.edits.length > beforeCount
    }
    const transaction: ActiveEditTransaction = {
      label,
      beforeSelection: this._selectionState(),
      edits: [],
    }
    this._activeTransaction = transaction
    try {
      action()
    } finally {
      this._activeTransaction = null
    }
    if (transaction.edits.length === 0) return false
    this._pushHistory({
      label: transaction.label,
      beforeSelection: transaction.beforeSelection,
      afterSelection: this._selectionState(),
      edits: transaction.edits,
    })
    return true
  }

  undo(): boolean {
    const entry = this._undoStack.pop()
    if (!entry) return false
    this._historySuspended = true
    try {
      for (const edit of [...entry.edits].reverse()) {
        this._replaceRangeRaw(edit.inverseRange, edit.oldText)
      }
      this._restoreSelection(entry.beforeSelection)
    } finally {
      this._historySuspended = false
    }
    this._redoStack.push(entry)
    return true
  }

  redo(): boolean {
    const entry = this._redoStack.pop()
    if (!entry) return false
    this._historySuspended = true
    try {
      for (const edit of entry.edits) {
        this._replaceRangeRaw(edit.range, edit.newText)
      }
      this._restoreSelection(entry.afterSelection)
    } finally {
      this._historySuspended = false
    }
    this._undoStack.push(entry)
    return true
  }

  clearHistory(): void {
    this._undoStack = []
    this._redoStack = []
  }

  insertText(text: string): void {
    this.replaceRange(this.hasSelection ? this.selection : { start: this._cursor, end: this._cursor }, text)
  }

  indentSelectedLines(indentText: string): boolean {
    if (indentText.length === 0) return false
    const range = this._selectedLineRange()
    const selection = this._selectionState()
    return this.runEditTransaction('indent', () => {
      for (let line = range.endLine; line >= range.startLine; line -= 1) {
        this.replaceRange({ start: { line, column: 0 }, end: { line, column: 0 } }, indentText)
      }
      this._restoreSelection(adjustSelectionForLinePrefixEdit(selection, range.startLine, range.endLine, indentText.length))
    })
  }

  outdentSelectedLines(indentSize: number): boolean {
    const size = Math.max(1, Math.floor(indentSize))
    const range = this._selectedLineRange()
    const selection = this._selectionState()
    const removedByLine = new Map<number, number>()
    return this.runEditTransaction('outdent', () => {
      for (let line = range.endLine; line >= range.startLine; line -= 1) {
        const text = this.document.getLine(line)
        const removeCount = text.startsWith('\t') ? 1 : leadingSpacesToRemove(text, size)
        if (removeCount > 0) {
          removedByLine.set(line, removeCount)
          this.replaceRange({ start: { line, column: 0 }, end: { line, column: removeCount } }, '')
        }
      }
      this._restoreSelection(adjustSelectionForLinePrefixEdit(selection, range.startLine, range.endLine, line => -(removedByLine.get(line) ?? 0)))
    })
  }

  replaceCurrentLine(value: string, cursorColumn: number): void {
    const line = this._cursor.line
    const currentLine = this.document.getLine(line)
    const diff = computeMinimalTextDiff(currentLine, value)
    const selectionAfter = positionInReplacement(line, value, cursorColumn)
    if (!diff) {
      this.setCursor(selectionAfter)
      return
    }
    this.runEditTransaction('replace-line', () => {
      this._replaceRangeWithHistory({
        start: { line: line + diff.range.start.line, column: diff.range.start.column },
        end: { line: line + diff.range.end.line, column: diff.range.end.column },
      }, diff.newText, selectionAfter)
    })
  }

  deleteSelection(): boolean {
    if (!this.hasSelection) return false
    this.replaceRange(this.selection, '')
    return true
  }

  insertNewline(): void {
    this.insertText('\n')
  }

  deleteBackward(): void {
    if (this.deleteSelection()) return
    const cursor = this._cursor
    if (cursor.column > 0) {
      const lineText = this.document.getLine(cursor.line)
      const startColumn = previousGraphemeBoundary(lineText, cursor.column)
      const endColumn = isGraphemeBoundary(lineText, cursor.column)
        ? cursor.column
        : nextGraphemeBoundary(lineText, cursor.column)
      this.replaceRange({
        start: { line: cursor.line, column: startColumn },
        end: { line: cursor.line, column: endColumn },
      }, '')
      return
    }
    if (cursor.line <= 0) return
    this.replaceRange({
      start: { line: cursor.line - 1, column: this.document.getLineLength(cursor.line - 1) },
      end: cursor,
    }, '')
  }

  deleteForward(): void {
    if (this.deleteSelection()) return
    const cursor = this._cursor
    const lineLength = this.document.getLineLength(cursor.line)
    if (cursor.column < lineLength) {
      const lineText = this.document.getLine(cursor.line)
      const startColumn = isGraphemeBoundary(lineText, cursor.column)
        ? cursor.column
        : previousGraphemeBoundary(lineText, cursor.column)
      const endColumn = nextGraphemeBoundary(lineText, cursor.column)
      this.replaceRange({
        start: { line: cursor.line, column: startColumn },
        end: { line: cursor.line, column: endColumn },
      }, '')
      return
    }
    if (cursor.line >= this.document.lineCount - 1) return
    this.replaceRange({
      start: cursor,
      end: { line: cursor.line + 1, column: 0 },
    }, '')
  }

  moveCursorHorizontal(delta: number, extendSelection = false): void {
    if (!extendSelection && this.hasSelection && delta !== 0) {
      this.setCursor(this._visibleNavigationEdge(
        delta < 0 ? this.selection.start : this.selection.end,
        Math.sign(delta),
      ))
      return
    }
    if (delta !== 0 && this.toVisibleLine(this._cursor.line) === null) {
      this.setCursor(this._visibleNavigationEdge(this._cursor, Math.sign(delta)), extendSelection)
      return
    }
    let { line, column } = this._cursor
    const direction = Math.sign(delta)
    for (let remaining = Math.abs(Math.trunc(delta)); remaining > 0; remaining -= 1) {
      if (direction < 0) {
        const precedingFold = column === 0
          ? [...this.folding.effectiveCollapsedRanges]
              .reverse()
              .find(range => range.endLine + 1 === line)
          : undefined
        if (precedingFold) {
          line = precedingFold.startLine
          column = this.document.getLineLength(line)
          continue
        }
        if (column > 0) {
          column = previousGraphemeBoundary(this.document.getLine(line), column)
        } else if (line > 0) {
          line -= 1
          column = this.document.getLineLength(line)
        }
      } else if (direction > 0) {
        const lineText = this.document.getLine(line)
        const collapsedFold = column === lineText.length
          ? this.folding.effectiveCollapsedRanges.find(range => range.startLine === line)
          : undefined
        if (collapsedFold) {
          if (collapsedFold.endLine < this.document.lineCount - 1) {
            line = collapsedFold.endLine + 1
            column = 0
          }
          continue
        }
        if (column < lineText.length) {
          column = nextGraphemeBoundary(lineText, column)
        } else if (line < this.document.lineCount - 1) {
          line += 1
          column = 0
        }
      }
    }
    this.setCursor({ line, column }, extendSelection)
  }

  moveCursorVertical(delta: number, extendSelection = false): void {
    if (!extendSelection && this.hasSelection && delta !== 0) {
      this.setCursor(this._visibleNavigationEdge(
        delta < 0 ? this.selection.start : this.selection.end,
        Math.sign(delta),
      ))
      return
    }
    const direction = Math.sign(delta)
    const currentVisibleLine = this.toVisibleLine(this._cursor.line)
    let nextLine: number
    if (currentVisibleLine !== null) {
      const nextVisibleLine = Math.max(
        0,
        Math.min(this.getVisibleLineCount() - 1, currentVisibleLine + delta),
      )
      nextLine = this.toLogicalLine(nextVisibleLine)
    } else {
      const containingFold = this.folding.collapsedRanges.find(range =>
        this._cursor.line > range.startLine && this._cursor.line <= range.endLine,
      )
      if (!containingFold || direction <= 0) {
        nextLine = containingFold?.startLine ?? this._cursor.line
      } else {
        const foldVisibleLine = this.toVisibleLine(containingFold.startLine) ?? 0
        nextLine = this.toLogicalLine(Math.min(this.getVisibleLineCount() - 1, foldVisibleLine + 1))
      }
    }
    this.setCursor({
      line: nextLine,
      column: Math.min(this._cursor.column, this.document.getLineLength(nextLine)),
    }, extendSelection)
  }

  moveCursorToLineBoundary(boundary: 'start' | 'end', extendSelection = false): void {
    this.setCursor({
      line: this._cursor.line,
      column: boundary === 'start' ? 0 : this.document.getLineLength(this._cursor.line),
    }, extendSelection)
  }

  moveCursorToDocumentBoundary(boundary: 'start' | 'end', extendSelection = false): void {
    if (boundary === 'start') {
      this.setCursor({ line: 0, column: 0 }, extendSelection)
      return
    }
    const lastLine = Math.max(0, this.document.lineCount - 1)
    this.setCursor({
      line: lastLine,
      column: this.document.getLineLength(lastLine),
    }, extendSelection)
  }

  toggleFold(line: number): boolean {
    const wasCollapsed = this.folding.isCollapsedStart(line)
    const changed = this.folding.toggle(line, this.document)
    if (changed) {
      if (!wasCollapsed) {
        const collapsed = this.folding.effectiveCollapsedRanges.find(range => range.startLine === line)
        if (collapsed && this._cursor.line > collapsed.startLine && this._cursor.line <= collapsed.endLine) {
          this._cursor = {
            line: collapsed.startLine,
            column: this.document.getLineLength(collapsed.startLine),
          }
          this._anchor = { ...this._cursor }
        }
      }
      this._changed(false)
    }
    return changed
  }

  expandToLine(line: number): boolean {
    const changed = this.folding.expandToLine(line)
    if (changed) this._changed(false)
    return changed
  }

  getVisibleLineCount(): number {
    return this.folding.visibleLineCount(this.document)
  }

  toLogicalLine(visibleLine: number): number {
    return this.folding.toLogicalLine(visibleLine, this.document)
  }

  toVisibleLine(logicalLine: number): number | null {
    return this.folding.toVisibleLine(logicalLine)
  }

  getLineTokens(line: number): readonly TextToken[] {
    const lineVersion = this.document.getLineVersion(line)
    const cached = this._tokenCache.get(line)
    if (cached?.lineVersion === lineVersion) return cached.tokens
    const tokens = this._tokenizer.tokenizeLine({
      line: this.document.getLine(line),
      lineNumber: line,
    }).tokens
    this._tokenCache.set(line, { lineVersion, tokens })
    return tokens
  }

  findNext(query: string, options: PlainTextFindOptions = {}): PlainTextSearchMatch | null {
    if (query.length === 0 || this.document.lineCount <= 0) return null
    const from = clampPosition(options.from ?? this._cursor, this.document)
    return options.backwards
      ? this._findPrevious(query, from, options)
      : this._findNext(query, from, options)
  }

  findMatchesInLine(line: number, query: string, options: PlainTextSearchOptions = {}): PlainTextSearchMatch[] {
    if (query.length === 0) return []
    const lineIndex = Math.max(0, Math.min(this.document.lineCount - 1, Math.floor(line)))
    const text = this.document.getLine(lineIndex)
    const needle = normalizeSearchTextWithOffsets(query, options.caseSensitive).value
    const visibleStart = Math.max(0, Math.min(text.length, Math.floor(options.startColumn ?? 0)))
    const visibleEnd = Math.max(visibleStart, Math.min(text.length, Math.ceil(options.endColumn ?? text.length)))
    const source = normalizeSearchTextWithOffsets(text, options.caseSensitive)
    const matches: PlainTextSearchMatch[] = []
    let start = 0
    let lastRangeKey = ''
    while (start <= source.value.length - needle.length) {
      const localColumn = source.value.indexOf(needle, start)
      if (localColumn < 0) break
      start = localColumn + Math.max(1, needle.length)
      const range = originalRangeForNormalizedMatch(source, localColumn, needle.length)
      if (!range || range.end <= visibleStart || range.start >= visibleEnd) continue
      const rangeKey = `${range.start}:${range.end}`
      if (rangeKey === lastRangeKey) continue
      lastRangeKey = rangeKey
      matches.push({
        start: { line: lineIndex, column: range.start },
        end: { line: lineIndex, column: range.end },
        text: text.slice(range.start, range.end),
      })
    }
    return matches
  }

  private _invalidateAfterEdit(firstChangedLine: number): void {
    for (const line of [...this._tokenCache.keys()]) {
      if (line >= firstChangedLine) this._tokenCache.delete(line)
    }
    this.folding.invalidateFrom(firstChangedLine)
  }

  private _replaceRangeWithHistory(
    range: TextRange,
    newText: string,
    selectionAfter?: TextPosition,
  ): TextEditResult | null {
    const normalized = normalizeRange(
      clampPosition(range.start, this.document),
      clampPosition(range.end, this.document),
    )
    const oldText = positionEquals(normalized.start, normalized.end)
      ? ''
      : this.document.getText(normalized)
    if (oldText === newText) return null
    const beforeSelection = this._selectionState()
    const result = this._replaceRangeRaw(normalized, newText, selectionAfter)
    if (!this._historySuspended) {
      const edit: ReversibleTextEdit = {
        range: cloneRange(normalized),
        oldText,
        newText,
        inverseRange: cloneRange(result.newRange),
      }
      if (this._activeTransaction) {
        this._activeTransaction.edits.push(edit)
      } else {
        this._pushHistory({
          beforeSelection,
          afterSelection: this._selectionState(),
          edits: [edit],
        })
      }
    }
    return result
  }

  private _replaceRangeRaw(
    range: TextRange,
    text: string,
    selectionAfter?: TextPosition,
  ): TextEditResult {
    const result = this.document.replaceRange(range, text)
    this._cursor = selectionAfter
      ? clampPosition(selectionAfter, this.document)
      : { ...result.newRange.end }
    this._anchor = { ...this._cursor }
    this._invalidateAfterEdit(result.firstChangedLine)
    this._changed(true, result)
    return result
  }

  private _pushHistory(entry: PlainTextEditorHistoryEntry): void {
    if (entry.edits.length === 0) return
    this._undoStack.push(entry)
    if (this._undoStack.length > this._historyLimit) this._undoStack.shift()
    this._redoStack = []
  }

  private _selectionState(): PlainTextEditorSelectionState {
    return {
      anchor: { ...this._anchor },
      cursor: { ...this._cursor },
    }
  }

  private _restoreSelection(selection: PlainTextEditorSelectionState): void {
    this._anchor = clampPosition(selection.anchor, this.document)
    this._cursor = clampPosition(selection.cursor, this.document)
    this._changed(false)
  }

  private _selectedLineRange(): { startLine: number; endLine: number } {
    if (!this.hasSelection) return { startLine: this._cursor.line, endLine: this._cursor.line }
    const selection = this.selection
    const endLine = selection.end.column === 0 && selection.end.line > selection.start.line
      ? selection.end.line - 1
      : selection.end.line
    return {
      startLine: selection.start.line,
      endLine: Math.max(selection.start.line, endLine),
    }
  }

  private _visibleNavigationEdge(position: TextPosition, direction: number): TextPosition {
    const fold = this.folding.effectiveCollapsedRanges.find(range =>
      position.line > range.startLine && position.line <= range.endLine,
    )
    if (!fold) return { ...position }
    if (direction > 0 && fold.endLine < this.document.lineCount - 1) {
      return { line: fold.endLine + 1, column: 0 }
    }
    return {
      line: fold.startLine,
      column: this.document.getLineLength(fold.startLine),
    }
  }

  private _changed(notify = true, result?: TextEditResult): void {
    this._revision++
    const change: PlainTextEditorChange = {
      revision: this._revision,
      document: this.document,
      result,
      getValue: () => this.value,
    }
    for (const listener of [...this._changeListeners]) listener(change)
    if (!notify) return
    this.onDocumentChange?.(change)
    this.onChange?.(this.value)
  }

  private _findNext(query: string, from: TextPosition, options: PlainTextFindOptions): PlainTextSearchMatch | null {
    const match = this._scanForward(query, from.line, from.column, this.document.lineCount - 1, options)
    if (match || options.wrap === false) return match
    if (from.line === 0 && from.column === 0) return null
    return this._scanForward(query, 0, 0, from.line, options, { endColumn: from.column })
  }

  private _findPrevious(query: string, from: TextPosition, options: PlainTextFindOptions): PlainTextSearchMatch | null {
    const match = this._scanBackward(query, from.line, from.column, 0, options)
    if (match || options.wrap === false) return match
    const lastLine = this.document.lineCount - 1
    const lastColumn = this.document.getLineLength(lastLine) + 1
    if (from.line === lastLine && from.column >= lastColumn - 1) return null
    return this._scanBackward(query, lastLine, lastColumn, from.line, options, { endColumn: from.column })
  }

  private _scanForward(
    query: string,
    startLine: number,
    startColumn: number,
    endLine: number,
    options: PlainTextSearchOptions,
    limit?: { endColumn: number },
  ): PlainTextSearchMatch | null {
    const needle = normalizeSearchTextWithOffsets(query, options.caseSensitive).value
    for (let line = startLine; line <= endLine; line += 1) {
      const text = this.document.getLine(line)
      const source = normalizeSearchTextWithOffsets(text, options.caseSensitive)
      let normalizedColumn = normalizedOffsetAtOrAfter(source, line === startLine ? startColumn : 0)
      let range: { start: number; end: number } | null = null
      while (normalizedColumn <= source.value.length - needle.length) {
        const matchColumn = source.value.indexOf(needle, normalizedColumn)
        if (matchColumn < 0) break
        range = originalRangeForNormalizedMatch(source, matchColumn, needle.length)
        if (range && range.start >= (line === startLine ? startColumn : 0)) break
        normalizedColumn = matchColumn + Math.max(1, needle.length)
        range = null
      }
      if (!range) continue
      if (line === endLine && limit && range.start >= limit.endColumn) return null
      return {
        start: { line, column: range.start },
        end: { line, column: range.end },
        text: text.slice(range.start, range.end),
      }
    }
    return null
  }

  private _scanBackward(
    query: string,
    startLine: number,
    startColumn: number,
    endLine: number,
    options: PlainTextSearchOptions,
    limit?: { endColumn: number },
  ): PlainTextSearchMatch | null {
    const needle = normalizeSearchTextWithOffsets(query, options.caseSensitive).value
    for (let line = startLine; line >= endLine; line -= 1) {
      const text = this.document.getLine(line)
      const source = normalizeSearchTextWithOffsets(text, options.caseSensitive)
      const beforeColumn = line === startLine ? startColumn : text.length + 1
      let normalizedColumn = source.value.length - needle.length
      let range: { start: number; end: number } | null = null
      while (normalizedColumn >= 0) {
        const matchColumn = source.value.lastIndexOf(needle, normalizedColumn)
        if (matchColumn < 0) break
        range = originalRangeForNormalizedMatch(source, matchColumn, needle.length)
        if (range && range.start < beforeColumn) break
        normalizedColumn = matchColumn - 1
        range = null
      }
      if (!range) continue
      if (line === endLine && limit && range.start < limit.endColumn) return null
      return {
        start: { line, column: range.start },
        end: { line, column: range.end },
        text: text.slice(range.start, range.end),
      }
    }
    return null
  }
}

export function lineIntersectsSelection(line: number, range: TextRange): boolean {
  if (line < range.start.line || line > range.end.line) return false
  if (range.start.line === range.end.line) {
    return line === range.start.line && range.start.column < range.end.column
  }
  if (line === range.end.line) return range.end.column > 0
  return true
}

function positionInReplacement(startLine: number, text: string, offset: number): TextPosition {
  const clampedOffset = Math.max(0, Math.min(text.length, Math.floor(offset)))
  let line = startLine
  let column = 0
  for (let index = 0; index < clampedOffset; index += 1) {
    const ch = text[index]
    if (ch === '\r') {
      if (text[index + 1] === '\n' && index + 1 < clampedOffset) index += 1
      line += 1
      column = 0
    } else if (ch === '\n') {
      line += 1
      column = 0
    } else {
      column += 1
    }
  }
  return { line, column }
}

interface NormalizedSearchText {
  value: string
  originalStarts: number[]
  originalEnds: number[]
}

function normalizeSearchTextWithOffsets(text: string, caseSensitive?: boolean): NormalizedSearchText {
  const parts: string[] = []
  const originalStarts: number[] = []
  const originalEnds: number[] = []
  let offset = 0
  while (offset < text.length) {
    const codePoint = text.codePointAt(offset)!
    const character = String.fromCodePoint(codePoint)
    const end = offset + character.length
    const normalized = caseSensitive ? character : foldSearchCharacter(character)
    parts.push(normalized)
    for (let index = 0; index < normalized.length; index += 1) {
      originalStarts.push(offset)
      originalEnds.push(end)
    }
    offset = end
  }

  return { value: parts.join(''), originalStarts, originalEnds }
}

function foldSearchCharacter(character: string): string {
  return character.toLowerCase().replace(/\u03c2/g, '\u03c3')
}

function normalizedOffsetAtOrAfter(source: NormalizedSearchText, originalOffset: number): number {
  let low = 0
  let high = source.originalStarts.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (source.originalStarts[middle]! < originalOffset) low = middle + 1
    else high = middle
  }
  return low
}

function originalRangeForNormalizedMatch(
  source: NormalizedSearchText,
  normalizedStart: number,
  normalizedLength: number,
): { start: number; end: number } | null {
  if (normalizedLength <= 0 || normalizedStart < 0) return null
  const normalizedEnd = normalizedStart + normalizedLength - 1
  const start = source.originalStarts[normalizedStart]
  const end = source.originalEnds[normalizedEnd]
  if (start === undefined || end === undefined) return null
  return { start, end }
}

function previousGraphemeBoundary(text: string, offset: number): number {
  const clampedOffset = Math.max(0, Math.min(text.length, Math.floor(offset)))
  const boundaries = graphemeBoundaries(text)
  let previous = 0
  for (const boundary of boundaries) {
    if (boundary >= clampedOffset) break
    previous = boundary
  }
  return previous
}

function nextGraphemeBoundary(text: string, offset: number): number {
  const clampedOffset = Math.max(0, Math.min(text.length, Math.floor(offset)))
  for (const boundary of graphemeBoundaries(text)) {
    if (boundary > clampedOffset) return boundary
  }
  return text.length
}

function isGraphemeBoundary(text: string, offset: number): boolean {
  const clampedOffset = Math.max(0, Math.min(text.length, Math.floor(offset)))
  return graphemeBoundaries(text).includes(clampedOffset)
}

interface GraphemeSegmenter {
  segment(value: string): Iterable<{ index: number }>
}

type GraphemeSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' },
) => GraphemeSegmenter

let cachedSegmenterConstructor: GraphemeSegmenterConstructor | undefined
let cachedGraphemeSegmenter: GraphemeSegmenter | undefined

function graphemeBoundaries(text: string): number[] {
  const Segmenter = typeof Intl === 'undefined'
    ? undefined
    : (Intl as typeof Intl & {
      Segmenter?: GraphemeSegmenterConstructor
    }).Segmenter
  if (Segmenter) {
    if (cachedSegmenterConstructor !== Segmenter || !cachedGraphemeSegmenter) {
      cachedSegmenterConstructor = Segmenter
      cachedGraphemeSegmenter = new Segmenter(undefined, { granularity: 'grapheme' })
    }
    const boundaries = [0]
    const segments = cachedGraphemeSegmenter.segment(text)
    for (const segment of segments) {
      if (segment.index > 0) boundaries.push(segment.index)
    }
    if (boundaries[boundaries.length - 1] !== text.length) boundaries.push(text.length)
    return boundaries
  }
  return fallbackGraphemeBoundaries(text)
}

function fallbackGraphemeBoundaries(text: string): number[] {
  const boundaries = [0]
  let clusterStart = 0
  let offset = 0
  let previousCodePoint = -1
  let regionalIndicatorCount = 0
  while (offset < text.length) {
    const codePoint = text.codePointAt(offset)!
    const shouldJoin = offset > clusterStart && (
      (previousCodePoint === 0x0d && codePoint === 0x0a) ||
      codePoint === 0x200d ||
      previousCodePoint === 0x200d ||
      isGraphemeExtend(codePoint) ||
      (isRegionalIndicator(codePoint) && regionalIndicatorCount % 2 === 1)
    )
    if (!shouldJoin && offset > clusterStart) {
      boundaries.push(offset)
      clusterStart = offset
      regionalIndicatorCount = 0
    }
    if (isRegionalIndicator(codePoint)) regionalIndicatorCount += 1
    else if (!isGraphemeExtend(codePoint) && codePoint !== 0x200d) regionalIndicatorCount = 0
    previousCodePoint = codePoint
    offset += codePoint > 0xffff ? 2 : 1
  }
  if (boundaries[boundaries.length - 1] !== text.length) boundaries.push(text.length)
  return boundaries
}

function isGraphemeExtend(codePoint: number): boolean {
  return isCombiningMark(codePoint) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef) ||
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) ||
    (codePoint >= 0xe0020 && codePoint <= 0xe007f)
}

function isCombiningMark(codePoint: number): boolean {
  return /\p{Mark}/u.test(String.fromCodePoint(codePoint))
}

function isRegionalIndicator(codePoint: number): boolean {
  return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff
}

export function snapColumnToGraphemeBoundary(text: string, column: number): number {
  const clamped = Math.max(0, Math.min(text.length, Math.floor(column)))
  if (isGraphemeBoundary(text, clamped)) return clamped
  const previous = previousGraphemeBoundary(text, clamped)
  const next = nextGraphemeBoundary(text, clamped)
  return clamped - previous <= next - clamped ? previous : next
}

function leadingSpacesToRemove(text: string, size: number): number {
  let count = 0
  while (count < size && text[count] === ' ') count += 1
  return count
}

function cloneRange(range: TextRange): TextRange {
  return {
    start: { ...range.start },
    end: { ...range.end },
  }
}

function adjustSelectionForLinePrefixEdit(
  selection: PlainTextEditorSelectionState,
  startLine: number,
  endLine: number,
  columnDelta: number | ((line: number) => number),
): PlainTextEditorSelectionState {
  return {
    anchor: adjustPositionForLinePrefixEdit(selection.anchor, startLine, endLine, columnDelta),
    cursor: adjustPositionForLinePrefixEdit(selection.cursor, startLine, endLine, columnDelta),
  }
}

function adjustPositionForLinePrefixEdit(
  position: TextPosition,
  startLine: number,
  endLine: number,
  columnDelta: number | ((line: number) => number),
): TextPosition {
  if (position.line < startLine || position.line > endLine || position.column === 0) return { ...position }
  const delta = typeof columnDelta === 'function' ? columnDelta(position.line) : columnDelta
  return {
    line: position.line,
    column: Math.max(0, position.column + delta),
  }
}

function computeMinimalTextDiff(oldText: string, newText: string): { range: TextRange; newText: string } | null {
  if (oldText === newText) return null
  let prefix = 0
  const maxPrefix = Math.min(oldText.length, newText.length)
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix += 1

  let oldSuffix = oldText.length
  let newSuffix = newText.length
  while (
    oldSuffix > prefix &&
    newSuffix > prefix &&
    oldText[oldSuffix - 1] === newText[newSuffix - 1]
  ) {
    oldSuffix -= 1
    newSuffix -= 1
  }

  return {
    range: {
      start: offsetToPosition(oldText, prefix),
      end: offsetToPosition(oldText, oldSuffix),
    },
    newText: newText.slice(prefix, newSuffix),
  }
}

function offsetToPosition(text: string, offset: number): TextPosition {
  const clampedOffset = Math.max(0, Math.min(text.length, Math.floor(offset)))
  let line = 0
  let column = 0
  for (let index = 0; index < clampedOffset; index += 1) {
    const char = text[index]
    if (char === '\r') {
      if (text[index + 1] === '\n' && index + 1 < clampedOffset) index += 1
      line += 1
      column = 0
    } else if (char === '\n') {
      line += 1
      column = 0
    } else {
      column += 1
    }
  }
  return { line, column }
}
