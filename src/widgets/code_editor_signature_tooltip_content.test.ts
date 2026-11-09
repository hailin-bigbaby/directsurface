import { describe, expect, it, vi } from 'vitest'
import type { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme } from '../theme/default_theme'
import type { CodeEditorSignatureHelp } from './code_editor'
import { RenderCodeEditorSignatureTooltipContent } from './code_editor_signature_tooltip_content'

function help(): CodeEditorSignatureHelp {
  return {
    signatures: [
      {
        label: 'substr(X, Y)',
        documentation: 'Returns a substring.',
        parameters: [{ label: 'X' }, { label: 'Y' }],
      },
      { label: 'substr(X, Y, Z)', parameters: [{ label: 'X' }, { label: 'Y' }, { label: 'Z' }] },
    ],
    activeSignature: 0,
    activeParameter: 1,
  }
}

describe('RenderCodeEditorSignatureTooltipContent', () => {
  it('lays out the active overload, parameter, docs, and adjacent overloads', () => {
    const content = new RenderCodeEditorSignatureTooltipContent(help())
    content.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 220 }, false, { theme: ImGuiDarkTheme })

    expect(content.size.width).toBeGreaterThan(0)
    expect(content.debugState().lines).toEqual(expect.arrayContaining([
      expect.stringContaining('substr(X, Y)'),
      'Parameter 2: Y',
      'Returns a substring.',
      'substr(X, Y, Z)',
    ]))
  })

  it('paints semantic lines without drawing a second popup shell', () => {
    const fillText = vi.fn()
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillText,
      set fillStyle(_value: unknown) {},
      get fillStyle() { return '' },
      font: '',
      textAlign: 'left' as CanvasTextAlign,
      textBaseline: 'middle' as CanvasTextBaseline,
    } as unknown as CanvasRenderingContext2D
    const content = new RenderCodeEditorSignatureTooltipContent(help())
    content.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 220 }, false, { theme: ImGuiDarkTheme })
    content.paint({ ctx, theme: ImGuiDarkTheme } as PaintContext, { x: 0, y: 0 })

    expect(fillText.mock.calls.length).toBe(content.debugState().lines.length)
    expect(ctx.fillRect).toBeUndefined()
    expect(ctx.strokeRect).toBeUndefined()
  })
})
