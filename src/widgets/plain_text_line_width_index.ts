export interface HiddenLineRange {
  startLine: number
  endLine: number
}

export interface LineWidthEntry {
  line: number
  width: number
}

interface WidthBlock {
  values: number[]
  max: number
}

const DEFAULT_BLOCK_SIZE = 256

export class PlainTextLineWidthIndex {
  private _blocks: WidthBlock[] = []
  private _lineCount = 0

  constructor(private readonly _blockSize = DEFAULT_BLOCK_SIZE) {}

  get lineCount(): number {
    return this._lineCount
  }

  rebuild(lineCount: number, widthAt: (line: number) => number): void {
    const count = Math.max(0, Math.floor(lineCount))
    const blocks: WidthBlock[] = []
    for (let start = 0; start < count; start += this._blockSize) {
      const end = Math.min(count, start + this._blockSize)
      const values = new Array<number>(end - start)
      for (let line = start; line < end; line += 1) {
        values[line - start] = normalizeWidth(widthAt(line))
      }
      blocks.push(createBlock(values))
    }
    this._blocks = blocks
    this._lineCount = count
  }

  splice(startLine: number, oldLineCount: number, newWidths: readonly number[]): void {
    const start = Math.max(0, Math.min(this._lineCount, Math.floor(startLine)))
    let remaining = Math.max(0, Math.min(this._lineCount - start, Math.floor(oldLineCount)))
    while (remaining > 0 && this._blocks.length > 0) {
      const position = this._locate(start)
      const block = this._blocks[position.blockIndex]!
      const removed = Math.min(remaining, block.values.length - position.offset)
      block.values.splice(position.offset, removed)
      remaining -= removed
      this._lineCount -= removed
      if (block.values.length === 0) this._blocks.splice(position.blockIndex, 1)
      else block.max = maxWidth(block.values)
    }

    if (newWidths.length > 0) {
      const values = Array.from(newWidths, normalizeWidth)
      const position = this._locate(start)
      const before = this._blocks.slice(0, position.blockIndex)
      const after = this._blocks.slice(position.blockIndex + (this._blocks.length > 0 ? 1 : 0))
      const existing = this._blocks[position.blockIndex]?.values ?? []
      const replacementValues = existing.slice(0, position.offset)
        .concat(values, existing.slice(position.offset))
      this._blocks = before.concat(createBlocks(replacementValues, this._blockSize), after)
      this._lineCount += values.length
    }

    this._mergeSmallBlocks()
  }

  setWidth(line: number, width: number): void {
    if (!Number.isInteger(line) || line < 0 || line >= this._lineCount) return
    const position = this._locate(line)
    const block = this._blocks[position.blockIndex]
    if (!block || position.offset >= block.values.length) return
    block.values[position.offset] = normalizeWidth(width)
    block.max = maxWidth(block.values)
  }

  maxWidth(hiddenRanges: readonly HiddenLineRange[] = []): number {
    if (this._blocks.length === 0) return 0
    if (hiddenRanges.length === 0) {
      let result = 0
      for (const block of this._blocks) result = Math.max(result, block.max)
      return result
    }

    const ranges = normalizeRanges(hiddenRanges, this._lineCount)
    if (ranges.length === 0) return this.maxWidth()
    let result = 0
    let blockStart = 0
    let rangeIndex = 0
    for (const block of this._blocks) {
      const blockEnd = blockStart + block.values.length - 1
      while (rangeIndex < ranges.length && ranges[rangeIndex]!.endLine < blockStart) rangeIndex += 1
      const range = ranges[rangeIndex]
      if (range && range.startLine <= blockStart && range.endLine >= blockEnd) {
        blockStart = blockEnd + 1
        continue
      }
      if (!range || range.startLine > blockEnd) {
        result = Math.max(result, block.max)
      } else {
        let localRangeIndex = rangeIndex
        for (let offset = 0; offset < block.values.length; offset += 1) {
          const line = blockStart + offset
          while (localRangeIndex < ranges.length && ranges[localRangeIndex]!.endLine < line) {
            localRangeIndex += 1
          }
          const localRange = ranges[localRangeIndex]
          const hidden = !!localRange && line >= localRange.startLine && line <= localRange.endLine
          if (!hidden) result = Math.max(result, block.values[offset]!)
        }
        rangeIndex = localRangeIndex
      }
      blockStart = blockEnd + 1
    }
    return result
  }

  maxEntry(hiddenRanges: readonly HiddenLineRange[] = []): LineWidthEntry | null {
    if (this._blocks.length === 0) return null
    const ranges = normalizeRanges(hiddenRanges, this._lineCount)
    let result: LineWidthEntry | null = null
    let blockStart = 0
    let rangeIndex = 0
    for (const block of this._blocks) {
      const blockEnd = blockStart + block.values.length - 1
      while (rangeIndex < ranges.length && ranges[rangeIndex]!.endLine < blockStart) rangeIndex += 1
      const range = ranges[rangeIndex]
      if (range && range.startLine <= blockStart && range.endLine >= blockEnd) {
        blockStart = blockEnd + 1
        continue
      }
      if (!range || range.startLine > blockEnd) {
        if (!result || block.max > result.width) {
          const offset = block.values.indexOf(block.max)
          result = { line: blockStart + offset, width: block.max }
        }
      } else {
        let localRangeIndex = rangeIndex
        for (let offset = 0; offset < block.values.length; offset += 1) {
          const line = blockStart + offset
          while (localRangeIndex < ranges.length && ranges[localRangeIndex]!.endLine < line) {
            localRangeIndex += 1
          }
          const localRange = ranges[localRangeIndex]
          const hidden = !!localRange && line >= localRange.startLine && line <= localRange.endLine
          const width = block.values[offset]!
          if (!hidden && (!result || width > result.width)) result = { line, width }
        }
        rangeIndex = localRangeIndex
      }
      blockStart = blockEnd + 1
    }
    return result
  }

  private _locate(line: number): { blockIndex: number; offset: number } {
    if (this._blocks.length === 0) return { blockIndex: 0, offset: 0 }
    let remaining = Math.max(0, Math.min(this._lineCount, line))
    for (let blockIndex = 0; blockIndex < this._blocks.length; blockIndex += 1) {
      const length = this._blocks[blockIndex]!.values.length
      if (remaining < length) return { blockIndex, offset: remaining }
      remaining -= length
    }
    const blockIndex = this._blocks.length - 1
    return { blockIndex, offset: this._blocks[blockIndex]!.values.length }
  }

  private _mergeSmallBlocks(): void {
    for (let index = 0; index < this._blocks.length - 1;) {
      const current = this._blocks[index]!
      const next = this._blocks[index + 1]!
      if (current.values.length + next.values.length > this._blockSize) {
        index += 1
        continue
      }
      current.values = current.values.concat(next.values)
      current.max = Math.max(current.max, next.max)
      this._blocks.splice(index + 1, 1)
    }
  }
}

function createBlocks(values: readonly number[], blockSize: number): WidthBlock[] {
  const blocks: WidthBlock[] = []
  for (let start = 0; start < values.length; start += blockSize) {
    blocks.push(createBlock(values.slice(start, start + blockSize)))
  }
  return blocks
}

function createBlock(values: number[]): WidthBlock {
  return { values, max: maxWidth(values) }
}

function maxWidth(values: readonly number[]): number {
  let result = 0
  for (const value of values) result = Math.max(result, normalizeWidth(value))
  return result
}

function normalizeWidth(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function normalizeRanges(ranges: readonly HiddenLineRange[], lineCount: number): HiddenLineRange[] {
  const normalized = ranges
    .map(range => ({
      startLine: Math.max(0, Math.min(lineCount - 1, Math.floor(range.startLine))),
      endLine: Math.max(0, Math.min(lineCount - 1, Math.floor(range.endLine))),
    }))
    .filter(range => range.endLine >= range.startLine)
    .sort((a, b) => a.startLine - b.startLine)
  const merged: HiddenLineRange[] = []
  for (const range of normalized) {
    const previous = merged.at(-1)
    if (!previous || range.startLine > previous.endLine + 1) {
      merged.push({ ...range })
    } else {
      previous.endLine = Math.max(previous.endLine, range.endLine)
    }
  }
  return merged
}
