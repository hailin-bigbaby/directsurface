import { describe, expect, it, vi } from 'vitest'
import { TextMeasurer } from '../core/text_measurer'
import type { CodeEditorSignatureHelp } from './code_editor'
import { layoutCodeEditorSignatureHelp } from './code_editor_signature_help_layout'

const typography = {
  fontFamily: 'sans',
  codeFontFamily: 'mono',
  lineHeight: 18,
  measureText: (text: string) => Array.from(text).length * 7,
}

function help(overrides: Partial<CodeEditorSignatureHelp> = {}): CodeEditorSignatureHelp {
  return {
    signatures: [{
      label: 'substr(X, Y [, Z])',
      documentation: 'The substr function returns a substring of the input value.',
      parameters: [{ label: 'X' }, { label: 'Y' }, { label: 'Z' }],
    }],
    activeSignature: 0,
    activeParameter: 1,
    ...overrides,
  }
}

describe('layoutCodeEditorSignatureHelp', () => {
  it('prioritizes the active signature, parameter, and measured documentation', () => {
    const measureText = vi.fn(typography.measureText)
    const layout = layoutCodeEditorSignatureHelp(
      help(),
      { width: 240, height: 220 },
      { ...typography, measureText },
    )!

    expect(layout.lines[0]).toMatchObject({
      kind: 'active-signature',
      text: expect.stringContaining('substr(X, Y [, Z])'),
      fontFamily: 'mono',
    })
    expect(layout.lines[1]).toMatchObject({ kind: 'parameter', text: 'Parameter 2: Y' })
    expect(layout.lines.filter(line => line.kind === 'documentation').length).toBeGreaterThan(1)
    expect(measureText).toHaveBeenCalled()
    expect(layout.width).toBeLessThanOrEqual(232)
  })

  it('keeps the active overload inside a three-entry adjacent window and shows the full count', () => {
    const signatures = Array.from({ length: 7 }, (_, index) => ({
      label: `fn(overload_${index + 1})`,
      parameters: [{ label: `value_${index + 1}` }],
    }))
    const middle = layoutCodeEditorSignatureHelp(help({ signatures, activeSignature: 3 }), {
      width: 400,
      height: 240,
    }, typography)!
    const tail = layoutCodeEditorSignatureHelp(help({ signatures, activeSignature: 6 }), {
      width: 400,
      height: 240,
    }, typography)!

    expect(middle.visibleOverloadIndexes).toEqual([2, 3, 4])
    expect(middle.lines[0]?.text).toContain('4/7')
    expect(middle.lines.some(line => line.overloadIndex === 3)).toBe(true)
    expect(tail.visibleOverloadIndexes).toEqual([4, 5, 6])
    expect(tail.lines[0]?.text).toContain('7/7')
  })

  it('does not bind a fixed-signature parameter over-count to the last parameter', () => {
    const layout = layoutCodeEditorSignatureHelp(help({ activeParameter: 8 }), {
      width: 320,
      height: 160,
    }, typography)!

    expect(layout.lines[1]).toMatchObject({ kind: 'parameter', text: 'Parameter 9' })
  })

  it('uses dynamic capacity, limits docs to three lines, and never exceeds eight lines', () => {
    const signatures = Array.from({ length: 5 }, (_, index) => ({
      label: `fn(${index})`,
      documentation: 'documentation '.repeat(30),
      parameters: [{ label: 'value' }],
    }))
    const large = layoutCodeEditorSignatureHelp(help({ signatures, activeSignature: 2 }), {
      width: 220,
      height: 400,
    }, typography)!
    const small = layoutCodeEditorSignatureHelp(help({ signatures, activeSignature: 2 }), {
      width: 180,
      height: 72,
    }, typography)!

    expect(large.lines.length).toBeLessThanOrEqual(8)
    expect(large.lines.filter(line => line.kind === 'documentation').length).toBeLessThanOrEqual(3)
    expect(small.lines.length).toBeLessThan(large.lines.length)
    expect(small.height).toBeLessThanOrEqual(64)
    expect(small.truncated).toBe(true)
  })

  it('fits long labels and rejects insufficient bounds', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(text).length * 7)
    const layout = layoutCodeEditorSignatureHelp(help({
      signatures: [{ label: 'very_long_function_name(' + 'argument,'.repeat(30) + ')', parameters: [] }],
    }), { width: 180, height: 120 }, typography)!

    expect(layout.lines[0]?.text.endsWith('...')).toBe(true)
    expect(layout.truncated).toBe(true)
    expect(layoutCodeEditorSignatureHelp(help(), { width: 30, height: 100 }, typography)).toBeNull()
    expect(layoutCodeEditorSignatureHelp(help(), { width: 200, height: 20 }, typography)).toBeNull()
  })

  it('supports content-only layout without duplicate padding or width limits', () => {
    const layout = layoutCodeEditorSignatureHelp(
      help({ signatures: [{ label: 'fn(value)', parameters: [{ label: 'value' }] }] }),
      { width: 720, height: 220 },
      typography,
      { contentPadding: 0, edgeGap: 0, maxWidth: Number.POSITIVE_INFINITY },
    )!

    expect(layout.height).toBe(layout.lines.length * 18)
    expect(layout.width).toBe(Math.max(...layout.lines.map(line => line.text.length * 7)))
  })
})
