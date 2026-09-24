import type { BoxConstraints, LayoutContext, Offset, RenderObject } from '../core/render_object'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { resolveThemeTypography } from '../theme/theme'
import { RenderBox } from '../layout/render_box'
import type { CodeEditorSignatureHelp } from './code_editor'
import {
  layoutCodeEditorSignatureHelp,
  type CodeEditorSignatureHelpLayout,
} from './code_editor_signature_help_layout'

const SIGNATURE_LINE_HEIGHT = 18

export interface CodeEditorSignatureTooltipContentDebugState {
  lines: readonly string[]
  truncated: boolean
}

export class RenderCodeEditorSignatureTooltipContent extends RenderBox {
  private readonly _help: CodeEditorSignatureHelp
  private _layout: CodeEditorSignatureHelpLayout | null = null

  constructor(help: CodeEditorSignatureHelp) {
    super()
    this._help = cloneSignatureHelp(help)
  }

  debugState(): CodeEditorSignatureTooltipContentDebugState {
    return {
      lines: this._layout?.lines.map(line => line.text) ?? [],
      truncated: this._layout?.truncated ?? false,
    }
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const typography = resolveThemeTypography(context.theme)
    this._layout = layoutCodeEditorSignatureHelp(
      this._help,
      { width: constraints.maxWidth, height: constraints.maxHeight },
      {
        fontFamily: context.theme.fontFamily,
        codeFontFamily: typography.monoFontFamily,
        lineHeight: SIGNATURE_LINE_HEIGHT,
      },
      {
        contentPadding: 0,
        edgeGap: 0,
        maxWidth: Number.POSITIVE_INFINITY,
      },
    )
    this.size = this._layout
      ? { width: this._layout.width, height: this._layout.height }
      : { width: 0, height: 0 }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    if (!this._layout) return
    const dl = new DrawList(context)
    const theme = context.theme
    for (let index = 0; index < this._layout.lines.length; index += 1) {
      const line = this._layout.lines[index]!
      const color = line.kind === 'active-signature'
        ? theme.textPrimary
        : line.kind === 'parameter'
          ? theme.textAccent
          : theme.textSecondary
      dl.fillText(
        line.text,
        offset.x,
        offset.y + index * SIGNATURE_LINE_HEIGHT + SIGNATURE_LINE_HEIGHT / 2,
        color,
        line.fontSize,
        line.fontFamily,
        'left',
        'middle',
        line.fontWeight,
      )
    }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}
}

function cloneSignatureHelp(help: CodeEditorSignatureHelp): CodeEditorSignatureHelp {
  return {
    signatures: help.signatures.map(signature => ({
      label: signature.label,
      documentation: signature.documentation,
      parameters: signature.parameters.map(parameter => ({
        label: parameter.label,
        documentation: parameter.documentation,
      })),
    })),
    activeSignature: help.activeSignature,
    activeParameter: help.activeParameter,
    range: help.range
      ? { start: { ...help.range.start }, end: { ...help.range.end } }
      : undefined,
  }
}
