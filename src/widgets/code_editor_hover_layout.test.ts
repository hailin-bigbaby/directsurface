import { describe, expect, it, vi } from 'vitest'
import type { CodeEditorHover } from './code_editor'
import { layoutCodeEditorHover } from './code_editor_hover_layout'

const typography = {
  fontFamily: 'sans',
  codeFontFamily: 'mono',
  lineHeight: 18,
  measureText: (text: string) => Array.from(text).length * 7,
}

function hover(overrides: Partial<CodeEditorHover> = {}): CodeEditorHover {
  return {
    label: 'users',
    detail: 'table main.users',
    range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
    ...overrides,
  }
}

describe('layoutCodeEditorHover', () => {
  it('wraps structured sections with the shared measured text primitive', () => {
    const measureText = vi.fn(typography.measureText)
    const layout = layoutCodeEditorHover(hover({
      sections: [{
        kind: 'text',
        lines: ['This documentation sentence wraps across multiple measured lines.'],
      }],
    }), { width: 220, height: 300 }, { ...typography, measureText })!

    expect(layout.lines[0]).toMatchObject({ text: 'users', kind: 'label' })
    expect(layout.lines.filter(line => line.kind === 'text').length).toBeGreaterThan(1)
    expect(measureText).toHaveBeenCalled()
    expect(layout.width).toBeLessThanOrEqual(212)
    expect(layout.height).toBeLessThanOrEqual(292)
  })

  it('keeps provider order while dropping optional before normal and retaining required warnings', () => {
    const layout = layoutCodeEditorHover(hover({
      sections: [
        { kind: 'list', priority: 'normal', lines: ['column 1', 'column 2', 'column 3'] },
        { kind: 'warning', priority: 'required', lines: ['Schema snapshot is stale'] },
        { kind: 'reference', priority: 'optional', lines: ['SQLite docs', 'Index detail'] },
      ],
    }), { width: 320, height: 124 }, typography)!

    expect(layout.lines.map(line => line.text)).toEqual([
      'users',
      'table main.users',
      'column 1',
      'column 2',
      expect.stringContaining('Schema snapshot is stale'),
    ])
    expect(layout.lines.map(line => line.kind)).not.toContain('reference')
    expect(layout.truncated).toBe(true)
  })

  it('uses dynamic line capacity and never exceeds a small editor', () => {
    const large = layoutCodeEditorHover(hover({
      sections: [{ kind: 'list', lines: Array.from({ length: 20 }, (_, index) => `column ${index}`) }],
    }), { width: 500, height: 400 }, typography)!
    const small = layoutCodeEditorHover(hover({
      sections: [{ kind: 'list', lines: Array.from({ length: 20 }, (_, index) => `column ${index}`) }],
    }), { width: 180, height: 88 }, typography)!

    expect(large.lines).toHaveLength(12)
    expect(small.lines.length).toBeLessThan(large.lines.length)
    expect(small.height).toBeLessThanOrEqual(80)
    expect(small.truncated).toBe(true)
  })

  it('fits label to one line and limits detail and type to two lines each', () => {
    const layout = layoutCodeEditorHover(hover({
      label: 'very_long_relation_name_that_must_be_ellipsized',
      detail: 'detail '.repeat(20),
      type: 'struct<field_one:text,field_two:text,field_three:text>',
    }), { width: 190, height: 300 }, typography)!

    expect(layout.lines.filter(line => line.kind === 'label')).toHaveLength(1)
    expect(layout.lines.filter(line => line.kind === 'detail').length).toBeLessThanOrEqual(2)
    expect(layout.lines.filter(line => line.kind === 'type').length).toBeLessThanOrEqual(2)
    expect(layout.truncated).toBe(true)
  })

  it('preserves code styling metadata and rejects insufficient bounds', () => {
    const layout = layoutCodeEditorHover(hover({
      sections: [{ kind: 'code', lines: ['  CREATE VIEW v AS', '', '  SELECT 1'] }],
    }), { width: 320, height: 220 }, typography)!

    expect(layout.lines.filter(line => line.kind === 'code')).toEqual([
      expect.objectContaining({ text: '  CREATE VIEW v AS', fontFamily: 'mono' }),
      expect.objectContaining({ text: '', fontFamily: 'mono' }),
      expect.objectContaining({ text: '  SELECT 1', fontFamily: 'mono' }),
    ])
    expect(layoutCodeEditorHover(hover(), { width: 30, height: 100 }, typography)).toBeNull()
    expect(layoutCodeEditorHover(hover(), { width: 200, height: 20 }, typography)).toBeNull()
  })

  it('supports content-only layout without edge gap, padding, or a second width cap', () => {
    const layout = layoutCodeEditorHover(
      hover({ sections: [{ kind: 'text', lines: ['documentation'] }] }),
      { width: 720, height: 220 },
      typography,
      { contentPadding: 0, edgeGap: 0, maxWidth: Number.POSITIVE_INFINITY },
    )!

    expect(layout.width).toBe(Math.max(...layout.lines.map(line => line.text.length * 7)))
    expect(layout.height).toBe(layout.lines.length * 18)
  })
})
