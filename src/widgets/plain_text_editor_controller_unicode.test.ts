import { describe, expect, it } from 'vitest'
import { PlainTextEditorController, snapColumnToGraphemeBoundary } from './plain_text_editor_controller'

describe('PlainTextEditorController grapheme editing', () => {
  it('snaps pointer-style UTF-16 columns to the nearest grapheme boundary', () => {
    expect(snapColumnToGraphemeBoundary('A😀B', 2)).toBe(1)
    expect(snapColumnToGraphemeBoundary('A👩‍💻B', 4)).toBe(6)
  })

  it.each([
    ['surrogate pair', '😀'],
    ['combining sequence', 'e\u0301'],
    ['emoji modifier', '👍🏽'],
    ['ZWJ sequence', '👩‍💻'],
    ['regional-indicator flag', '🇨🇳'],
  ])('moves across and deletes a complete %s', (_name, grapheme) => {
    const controller = new PlainTextEditorController({ value: `A${grapheme}B` })
    const graphemeStart = 1
    const graphemeEnd = graphemeStart + grapheme.length

    controller.setCursor({ line: 0, column: graphemeEnd })
    controller.moveCursorHorizontal(-1)
    expect(controller.cursor).toEqual({ line: 0, column: graphemeStart })

    controller.moveCursorHorizontal(1)
    expect(controller.cursor).toEqual({ line: 0, column: graphemeEnd })

    controller.deleteBackward()
    expect(controller.value).toBe('AB')
    expect(controller.undo()).toBe(true)
    expect(controller.value).toBe(`A${grapheme}B`)

    controller.setCursor({ line: 0, column: graphemeStart })
    controller.deleteForward()
    expect(controller.value).toBe('AB')
  })

  it('removes the whole grapheme when an external UTF-16 cursor bisects it', () => {
    const backward = new PlainTextEditorController({ value: 'A😀B' })
    backward.setCursor({ line: 0, column: 2 })
    backward.deleteBackward()
    expect(backward.value).toBe('AB')

    const forward = new PlainTextEditorController({ value: 'A😀B' })
    forward.setCursor({ line: 0, column: 2 })
    forward.deleteForward()
    expect(forward.value).toBe('AB')
  })

  it('keeps ZWJ and combining sequences atomic without Intl.Segmenter', () => {
    const segmenter = Intl.Segmenter
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    try {
      const graphemes = ['e\u0301', '👩‍💻', '🇨🇳']
      for (const grapheme of graphemes) {
        const controller = new PlainTextEditorController({ value: `A${grapheme}B` })
        controller.setCursor({ line: 0, column: 1 + grapheme.length })
        controller.deleteBackward()
        expect(controller.value).toBe('AB')
      }
    } finally {
      Object.defineProperty(Intl, 'Segmenter', {
        configurable: true,
        writable: true,
        value: segmenter,
      })
    }
  })
})

describe('PlainTextEditorController selection navigation', () => {
  it('collapses non-empty selections to the directional edge without moving farther', () => {
    const controller = new PlainTextEditorController({ value: 'alpha\nbeta\ngamma' })

    controller.setSelection({ line: 2, column: 2 }, { line: 0, column: 2 })
    controller.moveCursorHorizontal(-1)
    expect(controller.cursor).toEqual({ line: 0, column: 2 })
    expect(controller.hasSelection).toBe(false)

    controller.setSelection({ line: 2, column: 2 }, { line: 0, column: 2 })
    controller.moveCursorHorizontal(1)
    expect(controller.cursor).toEqual({ line: 2, column: 2 })
    expect(controller.hasSelection).toBe(false)

    controller.setSelection({ line: 2, column: 2 }, { line: 0, column: 2 })
    controller.moveCursorVertical(-1)
    expect(controller.cursor).toEqual({ line: 0, column: 2 })
    expect(controller.hasSelection).toBe(false)

    controller.setSelection({ line: 2, column: 2 }, { line: 0, column: 2 })
    controller.moveCursorVertical(1)
    expect(controller.cursor).toEqual({ line: 2, column: 2 })
    expect(controller.hasSelection).toBe(false)
  })

  it('retains the anchor while extending a selection by grapheme', () => {
    const controller = new PlainTextEditorController({ value: 'A👩‍💻B' })
    controller.setCursor({ line: 0, column: 1 })

    controller.moveCursorHorizontal(1, true)

    expect(controller.anchor).toEqual({ line: 0, column: 1 })
    expect(controller.cursor).toEqual({ line: 0, column: 6 })
    expect(controller.document.getText(controller.selection)).toBe('👩‍💻')
  })

  it('treats a collapsed range as an atomic horizontal position', () => {
    const controller = new PlainTextEditorController({
      value: '{\n  "hidden": true\n}\nafter',
      language: 'json',
    })
    expect(controller.toggleFold(0)).toBe(true)
    controller.setCursor({ line: 0, column: 1 })

    controller.moveCursorHorizontal(1)
    expect(controller.cursor).toEqual({ line: 3, column: 0 })
    expect(controller.toVisibleLine(controller.cursor.line)).not.toBeNull()

    controller.moveCursorHorizontal(-1)
    expect(controller.cursor).toEqual({ line: 0, column: 1 })
  })

  it('moves a caret inside a newly collapsed range to the visible fold start', () => {
    const controller = new PlainTextEditorController({
      value: '{\n  "hidden": true\n}\nafter',
      language: 'json',
    })
    controller.setCursor({ line: 1, column: 4 })

    expect(controller.toggleFold(0)).toBe(true)

    expect(controller.cursor).toEqual({ line: 0, column: 1 })
    expect(controller.toVisibleLine(controller.cursor.line)).toBe(0)
  })

  it('collapses a folded-content selection to a visible directional edge', () => {
    const createController = (): PlainTextEditorController => {
      const controller = new PlainTextEditorController({
        value: '{\n  "hidden": true\n}\nafter',
        language: 'json',
      })
      controller.toggleFold(0)
      controller.setSelection({ line: 0, column: 1 }, { line: 2, column: 1 })
      return controller
    }

    const right = createController()
    right.moveCursorHorizontal(1)
    expect(right.cursor).toEqual({ line: 3, column: 0 })
    expect(right.toVisibleLine(right.cursor.line)).not.toBeNull()

    const down = createController()
    down.moveCursorVertical(1)
    expect(down.cursor).toEqual({ line: 3, column: 0 })

    const left = createController()
    left.moveCursorHorizontal(-1)
    expect(left.cursor).toEqual({ line: 0, column: 1 })
  })
})

describe('PlainTextEditorController Unicode search coordinates', () => {
  it('maps lower-case expansions back to the original UTF-16 ranges', () => {
    const controller = new PlainTextEditorController({ value: 'İXİx' })

    const matches = controller.findMatchesInLine(0, 'x')

    expect(matches).toEqual([
      {
        start: { line: 0, column: 1 },
        end: { line: 0, column: 2 },
        text: 'X',
      },
      {
        start: { line: 0, column: 3 },
        end: { line: 0, column: 4 },
        text: 'x',
      },
    ])
    for (const match of matches) {
      expect(controller.document.getText(match)).toBe(match.text)
    }
  })

  it('returns the original character when the query matches its expanded fold', () => {
    const controller = new PlainTextEditorController({ value: 'İstanbul' })

    expect(controller.findNext('i', { from: { line: 0, column: 0 } })).toEqual({
      start: { line: 0, column: 0 },
      end: { line: 0, column: 1 },
      text: 'İ',
    })
  })

  it('keeps forward, backward, and wrapped searches in original coordinates', () => {
    const controller = new PlainTextEditorController({ value: 'İXİx' })

    expect(controller.findNext('x', { from: { line: 0, column: 2 } })?.start)
      .toEqual({ line: 0, column: 3 })
    expect(controller.findNext('x', {
      from: { line: 0, column: 4 },
      backwards: true,
    })?.start).toEqual({ line: 0, column: 3 })
    expect(controller.findNext('x', {
      from: { line: 0, column: 4 },
    })?.start).toEqual({ line: 0, column: 1 })
  })

  it('treats final and non-final Greek sigma as equal for case-insensitive search', () => {
    const controller = new PlainTextEditorController({ value: 'ΟΣ ος' })

    expect(controller.findMatchesInLine(0, 'ος').map(match => match.text)).toEqual(['ΟΣ', 'ος'])
  })
})

describe('PlainTextEditorController current-line input diffs', () => {
  it('reports and stores only the changed middle of the line', () => {
    const controller = new PlainTextEditorController({ value: 'alpha middle omega' })
    const edits: Array<{ start: number; end: number }> = []
    controller.onDocumentChange = change => {
      if (!change.result) return
      edits.push({
        start: change.result.oldRange.start.column,
        end: change.result.oldRange.end.column,
      })
    }
    controller.setCursor({ line: 0, column: 8 })

    controller.replaceCurrentLine('alpha changed omega', 13)

    expect(controller.value).toBe('alpha changed omega')
    expect(controller.cursor).toEqual({ line: 0, column: 13 })
    expect(edits).toEqual([{ start: 6, end: 12 }])
    expect(controller.undo()).toBe(true)
    expect(controller.value).toBe('alpha middle omega')
    expect(controller.cursor).toEqual({ line: 0, column: 8 })
  })

  it('preserves multi-line textarea cursor mapping with a minimal edit', () => {
    const controller = new PlainTextEditorController({ value: 'hello world' })
    let changedRange: { start: { line: number; column: number }; end: { line: number; column: number } } | undefined
    controller.onDocumentChange = change => {
      changedRange = change.result?.oldRange
    }
    controller.setCursor({ line: 0, column: 5 })

    controller.replaceCurrentLine('hello\ncanvas world', 12)

    expect(controller.value).toBe('hello\ncanvas world')
    expect(controller.cursor).toEqual({ line: 1, column: 6 })
    expect(changedRange).toEqual({
      start: { line: 0, column: 5 },
      end: { line: 0, column: 5 },
    })
    expect(controller.undo()).toBe(true)
    expect(controller.value).toBe('hello world')
  })

  it('keeps incremental line replacements as independent minimal undo steps', () => {
    const controller = new PlainTextEditorController({ value: 'abc' })
    const editRanges: Array<{ start: number; end: number }> = []
    controller.onDocumentChange = change => {
      if (change.result) {
        editRanges.push({
          start: change.result.oldRange.start.column,
          end: change.result.oldRange.end.column,
        })
      }
    }
    controller.setCursor({ line: 0, column: 2 })

    controller.replaceCurrentLine('abXc', 3)
    controller.replaceCurrentLine('abXYc', 4)

    expect(editRanges).toEqual([{ start: 2, end: 2 }, { start: 3, end: 3 }])
    expect(controller.undo()).toBe(true)
    expect(controller.value).toBe('abXc')
    expect(controller.undo()).toBe(true)
    expect(controller.value).toBe('abc')
  })
})
