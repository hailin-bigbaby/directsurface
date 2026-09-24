import { TextMeasurer } from '../core/text_measurer'
import { wrapMeasuredTextLines } from '../rendering/text_block_layout'
import { fitSingleLineText } from '../rendering/text_painter'
import type {
  CodeEditorHover,
  CodeEditorHoverSectionKind,
  CodeEditorHoverSectionPriority,
} from './code_editor'

export interface CodeEditorHoverLayoutBounds {
  width: number
  height: number
}

export interface CodeEditorHoverTypography {
  fontFamily: string
  codeFontFamily?: string
  labelFontSize?: number
  bodyFontSize?: number
  lineHeight?: number
  measureText?: (text: string, fontSize: number, fontFamily: string, fontWeight?: string | number) => number
}

export type CodeEditorHoverLayoutLineKind = 'label' | 'detail' | 'type' | CodeEditorHoverSectionKind

export interface CodeEditorHoverLayoutLine {
  text: string
  kind: CodeEditorHoverLayoutLineKind
  fontSize: number
  fontFamily: string
  fontWeight?: string | number
}

export interface CodeEditorHoverLayout {
  width: number
  height: number
  lines: readonly CodeEditorHoverLayoutLine[]
  truncated: boolean
}

export interface CodeEditorInfoLayoutOptions {
  contentPadding?: number
  edgeGap?: number
  maxWidth?: number
}

const EDGE_GAP = 4
const MAX_WIDTH = 460
const PADDING = 8
const MAX_LINES = 12

export function layoutCodeEditorHover(
  hover: CodeEditorHover,
  bounds: CodeEditorHoverLayoutBounds,
  typography: CodeEditorHoverTypography,
  options: CodeEditorInfoLayoutOptions = {},
): CodeEditorHoverLayout | null {
  const contentPadding = nonNegative(options.contentPadding, PADDING)
  const edgeGap = nonNegative(options.edgeGap, EDGE_GAP)
  const maxWidth = nonNegativeOrInfinity(options.maxWidth, MAX_WIDTH)
  const availableWidth = Math.max(0, Math.min(maxWidth, finite(bounds.width) - edgeGap * 2))
  const availableHeight = Math.max(0, finite(bounds.height) - edgeGap * 2)
  if (availableWidth < contentPadding * 2 + 24) return null
  const labelFontSize = positive(typography.labelFontSize, 12)
  const bodyFontSize = positive(typography.bodyFontSize, 11)
  const lineHeight = positive(typography.lineHeight, 18)
  const lineCapacity = Math.min(MAX_LINES, Math.floor((availableHeight - contentPadding * 2) / lineHeight))
  if (lineCapacity < 1) return null
  const contentWidth = availableWidth - contentPadding * 2
  const codeFontFamily = typography.codeFontFamily ?? typography.fontFamily
  const measure = typography.measureText ?? ((text, fontSize, fontFamily, fontWeight) =>
    TextMeasurer.measureWidth(text, fontSize, fontFamily, fontWeight))
  const widthOf = (text: string, fontSize: number, fontFamily: string, fontWeight?: string | number) =>
    measure(text, fontSize, fontFamily, fontWeight)

  const label = fitSingleLineText(
    hover.label,
    contentWidth,
    labelFontSize,
    typography.fontFamily,
    600,
  )
  const header: CodeEditorHoverLayoutLine[] = [{
    text: label.text,
    kind: 'label',
    fontSize: labelFontSize,
    fontFamily: typography.fontFamily,
    fontWeight: 600,
  }]
  for (const [kind, value] of [['detail', hover.detail], ['type', hover.type]] as const) {
    if (!value) continue
    const wrapped = wrapMeasuredTextLines(
      value,
      contentWidth,
      text => widthOf(text, bodyFontSize, typography.fontFamily),
    )
    for (const text of wrapped.slice(0, 2)) {
      header.push({ text, kind, fontSize: bodyFontSize, fontFamily: typography.fontFamily })
    }
    if (wrapped.length > 2) header[header.length - 1] = ellipsized(header[header.length - 1]!, contentWidth, widthOf)
  }

  const sectionLines: Array<CodeEditorHoverLayoutLine & { priority: CodeEditorHoverSectionPriority }> = []
  for (const section of hover.sections ?? []) {
    const fontFamily = section.kind === 'code' ? codeFontFamily : typography.fontFamily
    for (const logicalLine of section.lines) {
      const wrapped = wrapMeasuredTextLines(
        logicalLine,
        contentWidth,
        text => widthOf(text, bodyFontSize, fontFamily),
      )
      for (const text of wrapped) {
        sectionLines.push({
          text,
          kind: section.kind,
          priority: section.priority ?? 'normal',
          fontSize: bodyFontSize,
          fontFamily,
        })
      }
    }
  }

  let truncated = label.text !== hover.label
  let lines: CodeEditorHoverLayoutLine[]
  if (header.length >= lineCapacity) {
    truncated ||= header.length > lineCapacity || sectionLines.length > 0
    lines = header.slice(0, lineCapacity)
  } else {
    const remaining = lineCapacity - header.length
    const retained = [...sectionLines]
    while (retained.length > remaining) {
      const optional = lastPriorityIndex(retained, 'optional')
      const normal = optional < 0 ? lastPriorityIndex(retained, 'normal') : -1
      const index = optional >= 0 ? optional : normal
      if (index < 0) break
      retained.splice(index, 1)
      truncated = true
    }
    if (retained.length > remaining) {
      retained.length = remaining
      truncated = true
    }
    lines = [...header, ...retained]
  }
  if (truncated && lines.length > 0) {
    lines[lines.length - 1] = ellipsized(lines[lines.length - 1]!, contentWidth, widthOf)
  }

  const measuredWidth = Math.max(24, ...lines.map(line =>
    widthOf(line.text, line.fontSize, line.fontFamily, line.fontWeight)))
  return {
    width: Math.min(availableWidth, Math.ceil(measuredWidth) + contentPadding * 2),
    height: Math.min(availableHeight, contentPadding * 2 + lines.length * lineHeight),
    lines,
    truncated,
  }
}

function lastPriorityIndex(
  lines: readonly { priority: CodeEditorHoverSectionPriority }[],
  priority: CodeEditorHoverSectionPriority,
): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]!.priority === priority) return index
  }
  return -1
}

function ellipsized(
  line: CodeEditorHoverLayoutLine,
  maxWidth: number,
  measure: (text: string, fontSize: number, fontFamily: string, fontWeight?: string | number) => number,
): CodeEditorHoverLayoutLine {
  const suffix = line.text.endsWith('…') ? line.text : `${line.text}…`
  const fitted = fitSingleLineText(suffix, maxWidth, line.fontSize, line.fontFamily, line.fontWeight)
  if (measure(fitted.text, line.fontSize, line.fontFamily, line.fontWeight) <= maxWidth) {
    return { ...line, text: fitted.text }
  }
  return line
}

function finite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegative(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback
}

function nonNegativeOrInfinity(value: number | undefined, fallback: number): number {
  if (value === Number.POSITIVE_INFINITY) return value
  return nonNegative(value, fallback)
}
