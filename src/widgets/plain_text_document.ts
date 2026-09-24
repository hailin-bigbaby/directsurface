export interface TextPosition {
  line: number
  column: number
}

export interface TextRange {
  start: TextPosition
  end: TextPosition
}

export interface TextEditResult {
  oldRange: TextRange
  newRange: TextRange
  firstChangedLine: number
  oldLineCount: number
  newLineCount: number
}

export interface TextDocumentModel {
  readonly lineCount: number
  readonly version: number
  getLine(line: number): string
  getLineVersion(line: number): number
  getLineLength(line: number): number
  getText(range?: TextRange): string
  replaceRange(range: TextRange, text: string): TextEditResult
}

export class LineArrayTextDocument implements TextDocumentModel {
  private _lines: string[] = ['']
  private _lineVersions: number[] = [0]
  private _version = 0

  constructor(value = '') {
    this.setValue(value)
  }

  get lineCount(): number {
    return this._lines.length
  }

  get version(): number {
    return this._version
  }

  setValue(value: string): void {
    this._lines = normalizeLines(value)
    this._version++
    this._lineVersions = this._lines.map(() => this._version)
  }

  getLine(line: number): string {
    return this._lines[clampLine(line, this._lines.length)] ?? ''
  }

  getLineVersion(line: number): number {
    return this._lineVersions[clampLine(line, this._lineVersions.length)] ?? 0
  }

  getLineLength(line: number): number {
    return this.getLine(line).length
  }

  getText(range?: TextRange): string {
    if (!range) return this._lines.join('\n')
    const normalized = normalizeRange(
      clampPosition(range.start, this),
      clampPosition(range.end, this),
    )
    const { start, end } = normalized
    if (start.line === end.line) {
      return this.getLine(start.line).slice(start.column, end.column)
    }
    const parts: string[] = []
    parts.push(this.getLine(start.line).slice(start.column))
    for (let line = start.line + 1; line < end.line; line++) {
      parts.push(this.getLine(line))
    }
    parts.push(this.getLine(end.line).slice(0, end.column))
    return parts.join('\n')
  }

  replaceRange(range: TextRange, text: string): TextEditResult {
    const oldRange = normalizeRange(
      clampPosition(range.start, this),
      clampPosition(range.end, this),
    )
    const replacement = normalizeLines(text)
    const oldLineCount = oldRange.end.line - oldRange.start.line + 1
    const firstLine = this.getLine(oldRange.start.line)
    const lastLine = this.getLine(oldRange.end.line)
    const prefix = firstLine.slice(0, oldRange.start.column)
    const suffix = lastLine.slice(oldRange.end.column)
    const nextLines = [...replacement]
    nextLines[0] = prefix + (nextLines[0] ?? '')
    nextLines[nextLines.length - 1] = (nextLines[nextLines.length - 1] ?? '') + suffix

    this._version++
    this._lines = replaceArrayRange(this._lines, oldRange.start.line, oldLineCount, nextLines)
    this._lineVersions = replaceArrayRange(
      this._lineVersions,
      oldRange.start.line,
      oldLineCount,
      createLineVersions(nextLines.length, this._version),
    )
    if (this._lines.length === 0) {
      this._lines.push('')
      this._lineVersions.push(this._version)
    }

    const newEndLine = oldRange.start.line + nextLines.length - 1
    const newEndColumn = nextLines.length === 1
      ? oldRange.start.column + replacement[0]!.length
      : replacement[replacement.length - 1]!.length
    return {
      oldRange,
      newRange: {
        start: { ...oldRange.start },
        end: { line: newEndLine, column: newEndColumn },
      },
      firstChangedLine: oldRange.start.line,
      oldLineCount,
      newLineCount: nextLines.length,
    }
  }
}

export function positionEquals(a: TextPosition, b: TextPosition): boolean {
  return a.line === b.line && a.column === b.column
}

export function comparePositions(a: TextPosition, b: TextPosition): number {
  if (a.line !== b.line) return a.line - b.line
  return a.column - b.column
}

export function normalizeRange(a: TextPosition, b: TextPosition): TextRange {
  return comparePositions(a, b) <= 0
    ? { start: { ...a }, end: { ...b } }
    : { start: { ...b }, end: { ...a } }
}

export function clampPosition(position: TextPosition, document: TextDocumentModel): TextPosition {
  const line = clampLine(position.line, document.lineCount)
  const column = Math.max(0, Math.min(document.getLineLength(line), Math.floor(position.column)))
  return { line, column }
}

function normalizeLines(value: string): string[] {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  return lines.length > 0 ? lines : ['']
}

function clampLine(line: number, lineCount: number): number {
  return Math.max(0, Math.min(Math.max(0, lineCount - 1), Math.floor(line)))
}

function replaceArrayRange<T>(source: T[], start: number, deleteCount: number, items: T[]): T[] {
  if (start === 0 && deleteCount >= source.length) return items.slice()
  return source.slice(0, start).concat(items, source.slice(start + deleteCount))
}

function createLineVersions(count: number, version: number): number[] {
  const versions = new Array<number>(count)
  for (let i = 0; i < count; i += 1) versions[i] = version
  return versions
}
