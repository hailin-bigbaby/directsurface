import { ellipsizeText } from '../core/text_overflow'

export type TextBlockOverflow = 'clip' | 'ellipsis'
export type TextBlockFit = 'none' | 'shrink'

export interface TextBlockLayoutLine {
  text: string
  width: number
  x: number
  y: number
}

export interface TextBlockLayoutOptions {
  text: string
  width: number
  height: number
  fontSize: number
  lineHeightRatio: number
  padding?: number
  wrap?: boolean
  overflow?: TextBlockOverflow
  fit?: TextBlockFit
  align?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  measureText: (text: string, fontSize: number) => number
}

export interface TextBlockLayout {
  paintLines: TextBlockLayoutLine[]
  paintFontSize: number
  lineHeightPx: number
  requiredHeight: number
  truncated: boolean
}

interface MeasuredTextBlock {
  lines: string[]
  widths: number[]
  lineHeightPx: number
  requiredHeight: number
  fits: boolean
}

export function layoutTextBlock(options: TextBlockLayoutOptions): TextBlockLayout {
  const width = Math.max(0, finiteOr(options.width, 0))
  const height = Math.max(0, finiteOr(options.height, 0))
  const padding = Math.max(0, finiteOr(options.padding, 0))
  const baseFontSize = Math.max(1, finiteOr(options.fontSize, 1))
  const lineHeightRatio = Math.max(0.1, finiteOr(options.lineHeightRatio, 1))
  const contentWidth = Math.max(0, width - padding * 2)
  const contentHeight = Math.max(0, height - padding * 2)
  const wrap = options.wrap === true
  const overflow = options.overflow ?? 'ellipsis'
  const fit = options.fit ?? 'none'
  const shrinkFloor = Math.min(baseFontSize, Math.max(8, baseFontSize - 8))

  let paintFontSize = baseFontSize
  let measured = measureTextBlock(options.text, baseFontSize)
  if (fit === 'shrink' && !measured.fits) {
    for (let step = 1; step <= 8; step += 1) {
      const size = Math.max(shrinkFloor, baseFontSize - step)
      if (!(size < paintFontSize)) continue
      const candidate = measureTextBlock(options.text, size)
      paintFontSize = size
      measured = candidate
      if (candidate.fits) break
    }
    if (!measured.fits && paintFontSize > shrinkFloor) {
      paintFontSize = shrinkFloor
      measured = measureTextBlock(options.text, shrinkFloor)
    }
  }

  const fullLineCount = measured.lines.length
  const visibleLineCount = contentHeight >= measured.lineHeightPx
    ? Math.min(fullLineCount, Math.floor(contentHeight / measured.lineHeightPx))
    : height > 0 && fullLineCount > 0 ? 1 : 0
  const paintTexts = measured.lines.slice(0, visibleLineCount)
  const widthOverflow = measured.widths.some(lineWidth => lineWidth > contentWidth)
  const heightOverflow = measured.requiredHeight > height
  const truncated = widthOverflow || heightOverflow || visibleLineCount < fullLineCount

  if (overflow === 'ellipsis' && paintTexts.length > 0) {
    const lastIndex = paintTexts.length - 1
    const hiddenLines = visibleLineCount < fullLineCount
    const lastIsTruncated = hiddenLines
      || (measured.widths[lastIndex] ?? 0) > contentWidth
    if (lastIsTruncated) {
      const source = hiddenLines ? `${paintTexts[lastIndex] ?? ''}...` : paintTexts[lastIndex] ?? ''
      paintTexts[lastIndex] = ellipsizeText(
        source,
        contentWidth,
        text => options.measureText(text, paintFontSize),
      )
    }
  }

  const paintWidths = paintTexts.map(text => options.measureText(text, paintFontSize))
  const paintBlockHeight = paintTexts.length * measured.lineHeightPx
  const partiallyClippedLine = paintTexts.length === 1 && contentHeight < measured.lineHeightPx
  const blockTop = partiallyClippedLine
    ? options.verticalAlign === 'bottom'
      ? height - paintBlockHeight
      : options.verticalAlign === 'middle'
        ? (height - paintBlockHeight) / 2
        : 0
    : options.verticalAlign === 'bottom'
      ? Math.max(padding, height - padding - paintBlockHeight)
      : options.verticalAlign === 'middle'
        ? Math.max(padding, (height - paintBlockHeight) / 2)
        : padding
  const align = options.align ?? 'left'

  return {
    paintLines: paintTexts.map((text, index) => {
      const lineWidth = paintWidths[index] ?? 0
      return {
        text,
        width: lineWidth,
        x: align === 'right' ? width - padding : align === 'center' ? width / 2 : padding,
        y: blockTop + measured.lineHeightPx * index + measured.lineHeightPx / 2,
      }
    }),
    paintFontSize,
    lineHeightPx: measured.lineHeightPx,
    requiredHeight: measured.requiredHeight,
    truncated,
  }

  function measureTextBlock(text: string, fontSize: number): MeasuredTextBlock {
    const lines = wrap
      ? wrapMeasuredTextLines(text, contentWidth, value => options.measureText(value, fontSize))
      : [text]
    const widths = lines.map(line => options.measureText(line, fontSize))
    const lineHeightPx = fontSize * lineHeightRatio
    const requiredHeight = padding * 2 + lines.length * lineHeightPx
    return {
      lines,
      widths,
      lineHeightPx,
      requiredHeight,
      fits: requiredHeight <= height && widths.every(lineWidth => lineWidth <= contentWidth),
    }
  }
}

function normalizeMultilineText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** Shared measured wrapping primitive for components that compose their own line model. */
export function wrapMeasuredTextLines(
  text: string,
  maxWidth: number,
  measureText: (text: string) => number,
): string[] {
  const result: string[] = []
  for (const paragraph of normalizeMultilineText(text).split('\n')) {
    if (!paragraph) {
      result.push('')
      continue
    }
    result.push(...wrapParagraph(paragraph, maxWidth, measureText))
  }
  return result.length > 0 ? result : ['']
}

function wrapParagraph(paragraph: string, maxWidth: number, measureText: (text: string) => number): string[] {
  const characters = Array.from(paragraph)
  if (maxWidth <= 0) return characters.length > 0 ? characters : ['']
  const lines: string[] = []
  let start = 0
  while (start < characters.length) {
    const fittedEnd = largestFittingEnd(characters, start, maxWidth, measureText)
    if (fittedEnd >= characters.length) {
      lines.push(characters.slice(start).join(''))
      break
    }
    let end = Math.max(start + 1, fittedEnd)
    const whitespace = lastWhitespaceIndex(characters, start, end)
    if (whitespace > start) end = whitespace
    const line = characters.slice(start, end).join('').replace(/\s+$/u, '')
    lines.push(line)
    start = end
    while (start < characters.length && /\s/u.test(characters[start] ?? '')) start += 1
  }
  return lines.length > 0 ? lines : ['']
}

function largestFittingEnd(
  characters: string[],
  start: number,
  maxWidth: number,
  measureText: (text: string) => number,
): number {
  const firstEnd = Math.min(characters.length, start + 1)
  if (measureText(characters.slice(start, firstEnd).join('')) > maxWidth) return firstEnd
  if (firstEnd >= characters.length) return firstEnd

  let best = firstEnd
  let high = characters.length
  let span = 2
  while (best < characters.length) {
    const end = Math.min(characters.length, start + span)
    if (measureText(characters.slice(start, end).join('')) <= maxWidth) {
      best = end
      if (end >= characters.length) return end
      span *= 2
      continue
    }
    high = end - 1
    break
  }

  let low = best + 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = characters.slice(start, mid).join('')
    if (measureText(candidate) <= maxWidth) {
      best = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best
}

function lastWhitespaceIndex(characters: string[], start: number, end: number): number {
  for (let index = end - 1; index > start; index -= 1) {
    if (/\s/u.test(characters[index] ?? '')) return index
  }
  return -1
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
