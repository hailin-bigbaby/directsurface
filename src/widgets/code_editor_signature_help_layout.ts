import { TextMeasurer } from '../core/text_measurer'
import { wrapMeasuredTextLines } from '../rendering/text_block_layout'
import { fitSingleLineText } from '../rendering/text_painter'
import type { CodeEditorSignatureHelp } from './code_editor'
import type { CodeEditorInfoLayoutOptions } from './code_editor_hover_layout'

export interface CodeEditorSignatureHelpLayoutBounds {
  width: number
  height: number
}

export interface CodeEditorSignatureHelpTypography {
  fontFamily: string
  codeFontFamily?: string
  signatureFontSize?: number
  bodyFontSize?: number
  lineHeight?: number
  measureText?: (text: string, fontSize: number, fontFamily: string, fontWeight?: string | number) => number
}

export type CodeEditorSignatureHelpLayoutLineKind =
  | 'active-signature'
  | 'signature'
  | 'parameter'
  | 'documentation'

export interface CodeEditorSignatureHelpLayoutLine {
  text: string
  kind: CodeEditorSignatureHelpLayoutLineKind
  fontSize: number
  fontFamily: string
  fontWeight?: string | number
  overloadIndex?: number
}

export interface CodeEditorSignatureHelpLayout {
  width: number
  height: number
  lines: readonly CodeEditorSignatureHelpLayoutLine[]
  truncated: boolean
  activeSignature: number
  overloadCount: number
  visibleOverloadIndexes: readonly number[]
}

const EDGE_GAP = 4
const MAX_WIDTH = 460
const PADDING = 8
const MAX_LINES = 8
const MAX_OVERLOADS = 3
const MAX_DOCUMENTATION_LINES = 3

export function layoutCodeEditorSignatureHelp(
  help: CodeEditorSignatureHelp,
  bounds: CodeEditorSignatureHelpLayoutBounds,
  typography: CodeEditorSignatureHelpTypography,
  options: CodeEditorInfoLayoutOptions = {},
): CodeEditorSignatureHelpLayout | null {
  if (help.signatures.length === 0) return null
  const contentPadding = nonNegative(options.contentPadding, PADDING)
  const edgeGap = nonNegative(options.edgeGap, EDGE_GAP)
  const maxWidth = nonNegativeOrInfinity(options.maxWidth, MAX_WIDTH)
  const availableWidth = Math.max(0, Math.min(maxWidth, finite(bounds.width) - edgeGap * 2))
  const availableHeight = Math.max(0, finite(bounds.height) - edgeGap * 2)
  if (availableWidth < contentPadding * 2 + 24) return null
  const signatureFontSize = positive(typography.signatureFontSize, 12)
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

  const activeSignature = Math.max(0, Math.min(help.signatures.length - 1, Math.trunc(help.activeSignature)))
  const signature = help.signatures[activeSignature]!
  const activeParameter = Math.max(0, Math.trunc(help.activeParameter))
  const activeParameterInfo = signature.parameters[activeParameter]
  const overloadIndexes = overloadWindow(help.signatures.length, activeSignature)
  let truncated = overloadIndexes.length < help.signatures.length

  const activeLabelSource = `${signature.label}    ${activeSignature + 1}/${help.signatures.length}`
  const activeLabel = fitSingleLineText(
    activeLabelSource,
    contentWidth,
    signatureFontSize,
    codeFontFamily,
    600,
  )
  truncated ||= activeLabel.text !== activeLabelSource
  const lines: CodeEditorSignatureHelpLayoutLine[] = [{
    text: activeLabel.text,
    kind: 'active-signature',
    fontSize: signatureFontSize,
    fontFamily: codeFontFamily,
    fontWeight: 600,
    overloadIndex: activeSignature,
  }]

  if (lines.length < lineCapacity) {
    const source = activeParameterInfo
      ? `Parameter ${activeParameter + 1}: ${activeParameterInfo.label}`
      : `Parameter ${activeParameter + 1}`
    const parameter = fitSingleLineText(source, contentWidth, bodyFontSize, typography.fontFamily, 600)
    truncated ||= parameter.text !== source
    lines.push({
      text: parameter.text,
      kind: 'parameter',
      fontSize: bodyFontSize,
      fontFamily: typography.fontFamily,
      fontWeight: 600,
    })
  } else {
    truncated = true
  }

  const documentation = signature.documentation?.trim()
  if (documentation) {
    const wrapped = wrapMeasuredTextLines(
      documentation,
      contentWidth,
      text => widthOf(text, bodyFontSize, typography.fontFamily),
    )
    const documentationCapacity = Math.min(
      MAX_DOCUMENTATION_LINES,
      Math.max(0, lineCapacity - lines.length),
    )
    const retained = wrapped.slice(0, documentationCapacity)
    truncated ||= retained.length < wrapped.length
    for (let index = 0; index < retained.length; index += 1) {
      let text = retained[index]!
      if (index === retained.length - 1 && retained.length < wrapped.length) {
        text = fitSingleLineText(`${text}…`, contentWidth, bodyFontSize, typography.fontFamily).text
      }
      lines.push({
        text,
        kind: 'documentation',
        fontSize: bodyFontSize,
        fontFamily: typography.fontFamily,
      })
    }
  }

  for (const index of overloadIndexes) {
    if (index === activeSignature) continue
    if (lines.length >= lineCapacity) {
      truncated = true
      break
    }
    const source = help.signatures[index]!.label
    const fitted = fitSingleLineText(source, contentWidth, bodyFontSize, codeFontFamily)
    truncated ||= fitted.text !== source
    lines.push({
      text: fitted.text,
      kind: 'signature',
      fontSize: bodyFontSize,
      fontFamily: codeFontFamily,
      overloadIndex: index,
    })
  }

  const measuredWidth = Math.max(24, ...lines.map(line =>
    widthOf(line.text, line.fontSize, line.fontFamily, line.fontWeight)))
  return {
    width: Math.min(availableWidth, Math.ceil(measuredWidth) + contentPadding * 2),
    height: Math.min(availableHeight, contentPadding * 2 + lines.length * lineHeight),
    lines,
    truncated,
    activeSignature,
    overloadCount: help.signatures.length,
    visibleOverloadIndexes: overloadIndexes,
  }
}

function overloadWindow(count: number, active: number): number[] {
  if (count <= MAX_OVERLOADS) return Array.from({ length: count }, (_, index) => index)
  const start = active <= 1
    ? 0
    : active >= count - 2
      ? count - MAX_OVERLOADS
      : active - 1
  return Array.from({ length: MAX_OVERLOADS }, (_, index) => start + index)
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
