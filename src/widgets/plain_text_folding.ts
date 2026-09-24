import type { TextDocumentModel } from './plain_text_document'

export interface FoldRange {
  startLine: number
  endLine: number
}

export class FoldingModel {
  private _collapsed: FoldRange[] = []

  get collapsedRanges(): readonly FoldRange[] {
    return this._collapsed
  }

  get effectiveCollapsedRanges(): readonly FoldRange[] {
    const effective: FoldRange[] = []
    for (const range of this._collapsed) {
      const parent = effective[effective.length - 1]
      if (parent && range.startLine > parent.startLine && range.endLine <= parent.endLine) continue
      effective.push(range)
    }
    return effective
  }

  clear(): void {
    this._collapsed = []
  }

  isCollapsedStart(line: number): boolean {
    return this._collapsed.some(range => range.startLine === line)
  }

  isHidden(line: number): boolean {
    return this.effectiveCollapsedRanges.some(range => line > range.startLine && line <= range.endLine)
  }

  visibleLineCount(document: TextDocumentModel): number {
    let hidden = 0
    for (const range of this.effectiveCollapsedRanges) {
      const start = Math.max(0, Math.min(document.lineCount - 1, range.startLine))
      const end = Math.max(start, Math.min(document.lineCount - 1, range.endLine))
      hidden += end - start
    }
    return Math.max(1, document.lineCount - hidden)
  }

  toLogicalLine(visibleLine: number, document: TextDocumentModel): number {
    let logical = Math.max(0, Math.floor(visibleLine))
    for (const range of this.effectiveCollapsedRanges) {
      if (logical <= range.startLine) break
      logical += range.endLine - range.startLine
    }
    return Math.max(0, Math.min(document.lineCount - 1, logical))
  }

  toVisibleLine(logicalLine: number): number | null {
    let visible = Math.max(0, Math.floor(logicalLine))
    for (const range of this.effectiveCollapsedRanges) {
      if (logicalLine > range.startLine && logicalLine <= range.endLine) return null
      if (logicalLine > range.endLine) visible -= range.endLine - range.startLine
    }
    return visible
  }

  toggle(line: number, document: TextDocumentModel): boolean {
    const existingIndex = this._collapsed.findIndex(range => range.startLine === line)
    if (existingIndex >= 0) {
      this._collapsed.splice(existingIndex, 1)
      return true
    }
    const range = findJsonFoldRange(document, line)
    if (!range || range.endLine <= range.startLine) return false
    this._collapsed = this._collapsed
      .concat(range)
      .sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine)
    return true
  }

  expandToLine(line: number): boolean {
    const target = Math.max(0, Math.floor(line))
    const before = this._collapsed.length
    this._collapsed = this._collapsed.filter(range => target <= range.startLine || target > range.endLine)
    return this._collapsed.length !== before
  }

  invalidateFrom(line: number): void {
    this._collapsed = this._collapsed.filter(range => range.endLine < line)
  }
}

export function findJsonFoldRange(document: TextDocumentModel, line: number): FoldRange | null {
  const startLine = Math.max(0, Math.min(document.lineCount - 1, Math.floor(line)))
  const initialState = jsonFoldScanStateAtLine(document, startLine)
  const first = firstFoldOpen(document.getLine(startLine), { ...initialState })
  if (!first) return null
  const stack: Array<'{' | '['> = []
  const scanState: JsonFoldScanState = { ...initialState }
  for (let currentLine = startLine; currentLine < document.lineCount; currentLine++) {
    const text = document.getLine(currentLine)
    const startColumn = currentLine === startLine ? first.column : 0
    for (const token of scanJsonFoldChars(text, startColumn, scanState)) {
      if (token.char === '{' || token.char === '[') {
        stack.push(token.char)
        continue
      }
      const open = stack[stack.length - 1]
      if (!open || matchingClose(open) !== token.char) return null
      stack.pop()
      if (stack.length === 0 && currentLine > startLine) {
        return { startLine, endLine: currentLine }
      }
    }
  }
  return null
}

function firstFoldOpen(line: string, state: JsonFoldScanState): { column: number } | null {
  for (const item of scanJsonFoldChars(line, 0, state)) {
    if (item.char === '{' || item.char === '[') return { column: item.column }
  }
  return null
}

interface JsonFoldScanState {
  inBlockComment: boolean
}

interface JsonFoldStateCache {
  version: number
  lineStates: boolean[]
}

const jsonFoldStateCache = new WeakMap<TextDocumentModel, JsonFoldStateCache>()

function jsonFoldScanStateAtLine(document: TextDocumentModel, line: number): JsonFoldScanState {
  let cache = jsonFoldStateCache.get(document)
  if (!cache || cache.version !== document.version) {
    cache = { version: document.version, lineStates: [false] }
    jsonFoldStateCache.set(document, cache)
  }
  const state: JsonFoldScanState = {
    inBlockComment: cache.lineStates[cache.lineStates.length - 1] ?? false,
  }
  for (let currentLine = cache.lineStates.length - 1; currentLine < line; currentLine += 1) {
    for (const _token of scanJsonFoldChars(document.getLine(currentLine), 0, state)) {
      // Scanning prior lines only establishes block-comment state.
    }
    cache.lineStates.push(state.inBlockComment)
  }
  return { inBlockComment: cache.lineStates[line] ?? false }
}

function* scanJsonFoldChars(
  line: string,
  startColumn: number,
  state: JsonFoldScanState,
): Generator<{ char: '{' | '}' | '[' | ']'; column: number }> {
  let inString = false
  let escaped = false
  for (let column = Math.max(0, startColumn); column < line.length; column++) {
    const ch = line[column]!
    const next = line[column + 1]
    if (state.inBlockComment) {
      if (ch === '*' && next === '/') {
        state.inBlockComment = false
        column += 1
      }
      continue
    }
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '/' && next === '/') break
    if (ch === '/' && next === '*') {
      state.inBlockComment = true
      column += 1
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '}' || ch === '[' || ch === ']') {
      yield { char: ch, column }
    }
  }
}

function matchingClose(open: '{' | '['): '}' | ']' {
  return open === '{' ? '}' : ']'
}
