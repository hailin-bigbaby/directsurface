// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import type { BoxConstraints } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { colorToCSS, createTheme, rgba, type ResolvedTheme } from '../theme/theme'
import { LineArrayTextDocument } from './plain_text_document'
import { PlainTextEditorController, lineIntersectsSelection } from './plain_text_editor_controller'
import { RenderPlainTextEditor } from './plain_text_editor'

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 320,
  minHeight: 0,
  maxHeight: 120,
}

afterEach(() => {
  FocusManager.instance.dispose()
  InputComposer.instance.dispose()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function inputElement(): HTMLTextAreaElement {
  const ta = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement | null
  if (!ta) throw new Error('InputComposer textarea was not created')
  return ta
}

function createPaintContext(theme: ResolvedTheme = ImGuiDarkTheme) {
  const rect = vi.fn()
  const lineTo = vi.fn()
  const translate = vi.fn()
  const fillTextStyles: string[] = []
  const fillStyles: string[] = []
  const strokeStyles: string[] = []
  let fillStyle = ''
  let strokeStyle = ''
  let font = ''
  let textAlign: CanvasTextAlign = 'left'
  let textBaseline: CanvasTextBaseline = 'alphabetic'
  const fillText = vi.fn()
  const captureStrokeStyle = (): void => {
    if (strokeStyle) strokeStyles.push(strokeStyle)
  }
  const stroke = vi.fn(captureStrokeStyle)
  const strokeRect = vi.fn(captureStrokeStyle)
  fillText.mockImplementation(() => {
    fillTextStyles.push(fillStyle)
  })
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect,
    clip: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(() => {
      fillStyles.push(fillStyle)
    }),
    stroke,
    fillRect: vi.fn(),
    strokeRect,
    fillText,
    measureText: vi.fn(text => ({ width: String(text).length * 8 }) as TextMetrics),
    moveTo: vi.fn(),
    lineTo,
    translate,
    scale: vi.fn(),
    arc: vi.fn(),
    setLineDash: vi.fn(),
    set fillStyle(value: string) { fillStyle = value },
    get fillStyle() { return fillStyle },
    set strokeStyle(value: string) { strokeStyle = value },
    get strokeStyle() { return strokeStyle },
    set font(value: string) { font = value },
    get font() { return font },
    set textAlign(value: CanvasTextAlign) { textAlign = value },
    get textAlign() { return textAlign },
    set textBaseline(value: CanvasTextBaseline) { textBaseline = value },
    get textBaseline() { return textBaseline },
    lineWidth: 1,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, theme), fillText, fillTextStyles, fillStyles, strokeStyles, strokeRect, rect, lineTo, translate }
}

describe('LineArrayTextDocument', () => {
  it('replaces ranges without rebuilding unrelated line versions', () => {
    const doc = new LineArrayTextDocument('alpha\nbeta\ngamma')
    const beforeFirst = doc.getLineVersion(0)
    const beforeSecond = doc.getLineVersion(1)
    const beforeThird = doc.getLineVersion(2)

    const result = doc.replaceRange({
      start: { line: 1, column: 1 },
      end: { line: 1, column: 3 },
    }, 'EE')

    expect(doc.getText()).toBe('alpha\nbEEa\ngamma')
    expect(result.newRange.end).toEqual({ line: 1, column: 3 })
    expect(doc.getLineVersion(0)).toBe(beforeFirst)
    expect(doc.getLineVersion(1)).toBeGreaterThan(beforeSecond)
    expect(doc.getLineVersion(2)).toBe(beforeThird)
  })

  it('replaces very large pasted text without spreading lines into the call stack', () => {
    const lineCount = 150_000
    const doc = new LineArrayTextDocument('before\nafter')
    const largeText = Array.from({ length: lineCount }, (_, index) => `{"line":${index}}`).join('\n')

    const result = doc.replaceRange({
      start: { line: 0, column: 0 },
      end: { line: 0, column: 6 },
    }, largeText)

    expect(doc.lineCount).toBe(lineCount + 1)
    expect(doc.getLine(0)).toBe('{"line":0}')
    expect(doc.getLine(lineCount - 1)).toBe(`{"line":${lineCount - 1}}`)
    expect(doc.getLine(lineCount)).toBe('after')
    expect(result.newRange.end).toEqual({ line: lineCount - 1, column: `{"line":${lineCount - 1}}`.length })
  })
})

describe('PlainTextEditorController folding', () => {
  it('collapses json blocks through visible-to-logical line mapping', () => {
    const controller = new PlainTextEditorController({
      value: '{\n  "items": [\n    1\n  ]\n}\nlast',
      language: 'json',
    })

    expect(controller.toggleFold(1)).toBe(true)
    expect(controller.getVisibleLineCount()).toBe(4)
    expect(controller.toLogicalLine(2)).toBe(4)
    expect(controller.toVisibleLine(3)).toBe(null)
  })

  it('moves vertical selections across collapsed blocks by visible line', () => {
    const controller = new PlainTextEditorController({
      value: '{\n  "hidden": true\n}\nafter',
      language: 'json',
    })
    expect(controller.toggleFold(0)).toBe(true)
    controller.setCursor({ line: 0, column: 0 })

    controller.moveCursorVertical(1, true)

    expect(controller.cursor).toEqual({ line: 3, column: 0 })
    expect(controller.document.getText(controller.selection)).toBe('{\n  "hidden": true\n}\n')

    controller.moveCursorVertical(-1)
    expect(controller.cursor).toEqual({ line: 0, column: 0 })
  })

  it('maps current-line replacement cursor offsets across pasted newlines', () => {
    const controller = new PlainTextEditorController({
      value: 'hello world',
    })
    controller.setCursor({ line: 0, column: 5 })

    controller.replaceCurrentLine('hello\ncanvas world', 12)

    expect(controller.value).toBe('hello\ncanvas world')
    expect(controller.cursor).toEqual({ line: 1, column: 6 })
  })

  it('notifies current-line replacement after restoring the composer cursor', () => {
    const onDocumentChange = vi.fn()
    const controller = new PlainTextEditorController({
      value: 'SELECT  from users as u;',
      onDocumentChange,
    })
    controller.setCursor({ line: 0, column: 7 })

    controller.replaceCurrentLine('SELECT u. from users as u;', 9)

    expect(controller.cursor).toEqual({ line: 0, column: 9 })
    expect(onDocumentChange).toHaveBeenCalledTimes(1)
    expect(onDocumentChange.mock.calls[0]![0].result).toBeDefined()
    expect(controller.canUndo).toBe(true)
    expect(controller.undo()).toBe(true)
    expect(controller.value).toBe('SELECT  from users as u;')
    expect(controller.cursor).toEqual({ line: 0, column: 7 })
  })

  it('can notify edits without serializing the full document value', () => {
    const controller = new PlainTextEditorController({
      value: 'alpha\nbeta',
    })
    const getText = vi.spyOn(controller.document, 'getText')
    const onDocumentChange = vi.fn()
    controller.onDocumentChange = onDocumentChange

    controller.setCursor({ line: 0, column: 5 })
    controller.insertText('!')

    expect(onDocumentChange).toHaveBeenCalledTimes(1)
    expect(onDocumentChange.mock.calls[0]![0].revision).toBe(controller.revision)
    expect(onDocumentChange.mock.calls[0]![0].result.newRange.end).toEqual({ line: 0, column: 6 })
    expect(getText).not.toHaveBeenCalled()
  })

  it('supports independent controller change subscriptions', () => {
    const onDocumentChange = vi.fn()
    const listener = vi.fn()
    const controller = new PlainTextEditorController({ value: 'alpha', onDocumentChange })
    const unsubscribe = controller.subscribeChange(listener)

    controller.setCursor({ line: 0, column: 2 })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(onDocumentChange).not.toHaveBeenCalled()

    controller.insertText('!')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(onDocumentChange).toHaveBeenCalledTimes(1)

    unsubscribe()
    unsubscribe()
    controller.setCursor({ line: 0, column: 0 })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('finds text forward and backward without building a full match list', () => {
    const controller = new PlainTextEditorController({
      value: 'alpha\nxNeedle\nneedle\nomega',
    })

    expect(controller.findNext('needle', { from: { line: 0, column: 0 } })?.start)
      .toEqual({ line: 1, column: 1 })
    expect(controller.findNext('Needle', {
      from: { line: 0, column: 0 },
      caseSensitive: true,
    })?.start).toEqual({ line: 1, column: 1 })
    expect(controller.findNext('Needle', {
      from: { line: 2, column: 0 },
      backwards: true,
      caseSensitive: true,
    })?.start).toEqual({ line: 1, column: 1 })
    expect(controller.findMatchesInLine(2, 'needle')).toHaveLength(1)
    expect(controller.findMatchesInLine(1, 'Needle', { startColumn: 0, endColumn: 2 }))
      .toHaveLength(1)
    expect(controller.findMatchesInLine(1, 'Needle', { startColumn: 8, endColumn: 12 }))
      .toHaveLength(0)
  })
})

describe('lineIntersectsSelection', () => {
  it('treats multi-line selections as half-open ranges', () => {
    const range = {
      start: { line: 0, column: 2 },
      end: { line: 1, column: 0 },
    }

    expect(lineIntersectsSelection(0, range)).toBe(true)
    expect(lineIntersectsSelection(1, range)).toBe(false)
  })
})

describe('PlainTextEditorController history', () => {
  it('undoes and redoes inserted text', () => {
    const controller = new PlainTextEditorController({ value: 'ab' })
    controller.setCursor({ line: 0, column: 1 })

    controller.insertText('X')

    expect(controller.value).toBe('aXb')
    expect(controller.canUndo).toBe(true)
    expect(controller.undo()).toBe(true)
    expect(controller.value).toBe('ab')
    expect(controller.cursor).toEqual({ line: 0, column: 1 })
    expect(controller.redo()).toBe(true)
    expect(controller.value).toBe('aXb')
    expect(controller.cursor).toEqual({ line: 0, column: 2 })
  })

  it('undoes deletions and restores the previous cursor', () => {
    const controller = new PlainTextEditorController({ value: 'abc' })
    controller.setCursor({ line: 0, column: 2 })

    controller.deleteBackward()

    expect(controller.value).toBe('ac')
    expect(controller.undo()).toBe(true)
    expect(controller.value).toBe('abc')
    expect(controller.cursor).toEqual({ line: 0, column: 2 })
  })

  it('keeps multiline indent as one undo step', () => {
    const controller = new PlainTextEditorController({ value: 'alpha\nbeta\ngamma' })
    controller.setSelection({ line: 0, column: 1 }, { line: 2, column: 0 })

    expect(controller.indentSelectedLines('  ')).toBe(true)

    expect(controller.value).toBe('  alpha\n  beta\ngamma')
    expect(controller.undo()).toBe(true)
    expect(controller.value).toBe('alpha\nbeta\ngamma')
    expect(controller.redo()).toBe(true)
    expect(controller.value).toBe('  alpha\n  beta\ngamma')
    expect(controller.selection).toEqual({
      start: { line: 0, column: 3 },
      end: { line: 2, column: 0 },
    })
  })

  it('keeps multiline outdent as one undo step', () => {
    const controller = new PlainTextEditorController({ value: '    alpha\n  beta\n\tgamma' })
    controller.selectAll()

    expect(controller.outdentSelectedLines(2)).toBe(true)

    expect(controller.value).toBe('  alpha\nbeta\ngamma')
    expect(controller.undo()).toBe(true)
    expect(controller.value).toBe('    alpha\n  beta\n\tgamma')
    expect(controller.redo()).toBe(true)
    expect(controller.value).toBe('  alpha\nbeta\ngamma')
  })

  it('clears history when replacing the loaded value', () => {
    const controller = new PlainTextEditorController({ value: 'old' })
    controller.insertText('!')
    expect(controller.canUndo).toBe(true)

    controller.setValue('new')

    expect(controller.value).toBe('new')
    expect(controller.canUndo).toBe(false)
    expect(controller.undo()).toBe(false)
  })

  it('records replaceAllText as an undoable minimal replacement', () => {
    const controller = new PlainTextEditorController({ value: '规则  A\n结尾' })
    controller.setCursor({ line: 0, column: 2 })

    expect(controller.replaceAllText('规则 A\n结尾', 'format')).toBe(true)

    expect(controller.value).toBe('规则 A\n结尾')
    expect(controller.undo()).toBe(true)
    expect(controller.value).toBe('规则  A\n结尾')
    expect(controller.cursor).toEqual({ line: 0, column: 2 })
  })
})

describe('RenderPlainTextEditor', () => {
  it('owns a framed surface by default and can switch to flush without changing layout', () => {
    const editor = new RenderPlainTextEditor({ value: 'alpha' })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    const beforeSize = { ...editor.size }
    const framed = createPaintContext()

    editor.performPaint(framed.context, { x: 0, y: 0 })

    expect(editor.appearance).toBe('framed')
    expect(framed.strokeStyles.at(-1)).toBe(colorToCSS(ImGuiDarkTheme.borderPanel))

    editor.appearance = 'flush'
    const flush = createPaintContext()
    editor.performPaint(flush.context, { x: 0, y: 0 })

    expect(flush.strokeStyles).not.toContain(colorToCSS(ImGuiDarkTheme.borderPanel))
    expect(editor.size).toEqual(beforeSize)
    editor.dispose()
  })

  it('uses the focus border for a focused framed surface', () => {
    const editor = new RenderPlainTextEditor({ value: 'alpha' })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    ;(editor as any)._focused = true
    const painted = createPaintContext()

    editor.performPaint(painted.context, { x: 0, y: 0 })

    expect(painted.strokeStyles.at(-1)).toBe(colorToCSS(ImGuiDarkTheme.focusBorder))
    editor.dispose()
  })

  it('does not create a horizontal scrollbar for vertically overflowing short lines', () => {
    const editor = new RenderPlainTextEditor({
      value: Array.from({ length: 100 }, (_, index) => `row ${index}`).join('\n'),
      folding: false,
      showLineNumbers: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })

    expect((editor as any)._showVBar).toBe(true)
    expect((editor as any)._showHBar).toBe(false)
    expect((editor as any)._viewH).toBe(constraints.maxHeight)
    expect((editor as any)._viewW).toBe(constraints.maxWidth - ImGuiDarkTheme.scrollbarSize)
    editor.dispose()
  })

  it('repaints for external controller language and cursor changes', () => {
    const controller = new PlainTextEditorController({ value: 'alpha\nbeta' })
    const editor = new RenderPlainTextEditor({ controller })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    const markNeedsPaint = vi.spyOn(editor, 'markNeedsPaint')

    controller.setLanguage('json')
    controller.setCursor({ line: 1, column: 2 })

    expect(markNeedsPaint).toHaveBeenCalledTimes(2)
    editor.dispose()
  })

  it('synchronizes the focused composer after external cursor and selection changes', () => {
    const controller = new PlainTextEditorController({ value: 'alpha\nbeta' })
    const editor = new RenderPlainTextEditor({ controller, folding: false })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.focusIn()
    const ta = inputElement()

    controller.setCursor({ line: 1, column: 2 })

    expect(ta.value).toBe('beta')
    expect(ta.selectionStart).toBe(2)
    expect(ta.selectionEnd).toBe(2)

    controller.setSelection({ line: 1, column: 1 }, { line: 1, column: 3 })

    expect(ta.value).toBe('beta')
    expect(ta.selectionStart).toBe(1)
    expect(ta.selectionEnd).toBe(3)

    ta.value = 'bXta'
    ta.setSelectionRange(2, 2)
    ta.dispatchEvent(new Event('input'))

    expect(controller.value).toBe('alpha\nbXta')
    expect(controller.cursor).toEqual({ line: 1, column: 2 })
    editor.dispose()
  })

  it('synchronizes external value, edits, undo, and redo before the next input', () => {
    const controller = new PlainTextEditorController({ value: 'alpha\nbeta' })
    const editor = new RenderPlainTextEditor({ controller, folding: false })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.focusIn()
    const ta = inputElement()

    controller.value = 'first\nsecond'
    expect(ta.value).toBe('first')
    expect(ta.selectionStart).toBe(0)

    controller.setCursor({ line: 1, column: 3 })
    controller.insertText('!')
    expect(ta.value).toBe('sec!ond')
    expect(ta.selectionStart).toBe(4)

    expect(controller.undo()).toBe(true)
    expect(ta.value).toBe('second')
    expect(ta.selectionStart).toBe(3)

    expect(controller.redo()).toBe(true)
    expect(ta.value).toBe('sec!ond')
    expect(ta.selectionStart).toBe(4)

    controller.replaceRange({
      start: { line: 1, column: 0 },
      end: { line: 1, column: 7 },
    }, 'updated')
    expect(ta.value).toBe('updated')
    expect(ta.selectionStart).toBe(7)

    ta.value = 'updated!'
    ta.setSelectionRange(8, 8)
    ta.dispatchEvent(new Event('input'))
    expect(controller.value).toBe('first\nupdated!')

    editor.dispose()
  })

  it('discards an IME commit made stale by an external controller change', () => {
    const controller = new PlainTextEditorController({ value: 'alpha\nbeta' })
    const editor = new RenderPlainTextEditor({ controller, folding: false })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    controller.setCursor({ line: 0, column: 2 })
    editor.focusIn()
    const ta = inputElement()

    ta.dispatchEvent(new CompositionEvent('compositionstart'))
    controller.setCursor({ line: 1, column: 2 })
    ta.value = 'al中pha'
    ta.setSelectionRange(3, 3)
    ta.dispatchEvent(new CompositionEvent('compositionend', { data: '中' }))

    expect(controller.value).toBe('alpha\nbeta')
    expect(controller.cursor).toEqual({ line: 1, column: 2 })
    expect(ta.value).toBe('beta')
    expect(ta.selectionStart).toBe(2)
    editor.dispose()
  })

  it('activates search matches, expands folded lines, and supports line jumps', () => {
    const editor = new RenderPlainTextEditor({
      value: '{\n    "needle": true\n}\nlast',
      language: 'json',
      lineHeight: 16,
      fontSize: 12,
      folding: true,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.toggleFold(0)
    expect(editor.controller.toVisibleLine(1)).toBeNull()

    editor.setSearchQuery('needle')
    const match = editor.findNextSearchMatch()

    expect(match?.start).toEqual({ line: 1, column: 5 })
    expect(editor.activeSearchMatch?.text).toBe('needle')
    expect(editor.controller.selection).toEqual({
      start: { line: 1, column: 5 },
      end: { line: 1, column: 11 },
    })
    expect(editor.controller.toVisibleLine(1)).not.toBeNull()

    const position = editor.goToLine(4)
    expect(position).toEqual({ line: 3, column: 0 })
    expect(editor.activeSearchMatch).toBeNull()

    editor.dispose()
  })

  it('splits selected text into inverted foreground segments', () => {
    const theme = createTheme(ImGuiDarkTheme, {
      editor: {
        selectionBg: rgba(12, 34, 56),
        selectionText: rgba(210, 220, 230),
      },
    })
    const editor = new RenderPlainTextEditor({
      value: 'abcde',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })
    const painted = createPaintContext(theme)

    editor.controller.setSelection({ line: 0, column: 1 }, { line: 0, column: 3 })
    editor.layout(constraints, false, { theme })
    editor.performPaint(painted.context, { x: 0, y: 0 })

    const texts = painted.fillText.mock.calls.map(call => call[0])
    expect(texts).toContain('a')
    expect(texts).toContain('bc')
    expect(texts).toContain('de')
    expect(texts).not.toContain('abcde')
    const selectedTextIndex = painted.fillText.mock.calls.findIndex(call => call[0] === 'bc')
    expect(painted.fillTextStyles[selectedTextIndex]).toBe(colorToCSS(rgba(210, 220, 230)))
    expect(painted.fillStyles).toContain(colorToCSS(rgba(12, 34, 56)))

    editor.dispose()
  })

  it('uses an external line token provider when painting code-like text', () => {
    const editor = new RenderPlainTextEditor({
      value: 'abc def',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
      lineTokenProvider: () => [
        { startColumn: 0, endColumn: 3, type: 'keyword' },
      ],
    })
    const painted = createPaintContext()

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.performPaint(painted.context, { x: 0, y: 0 })

    const texts = painted.fillText.mock.calls.map(call => call[0])
    expect(texts).toContain('abc')
    expect(texts).toContain(' def')
    expect(texts).not.toContain('abc def')

    editor.dispose()
  })

  it('paints range decorations as editor-owned underlines', () => {
    const editor = new RenderPlainTextEditor({
      value: 'abc def',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
      decorations: [{
        range: { start: { line: 0, column: 0 }, end: { line: 0, column: 3 } },
        kind: 'error',
        message: 'Invalid token',
      }],
    })
    const painted = createPaintContext()

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.performPaint(painted.context, { x: 0, y: 0 })

    expect(editor.debugState().decorationCount).toBe(1)
    expect(painted.lineTo).toHaveBeenCalled()

    editor.dispose()
  })

  it('selects a whole json property or string value on double click', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const editor = new RenderPlainTextEditor({
      value: '{\n    "patientName": "张三",\n    "age": 42\n}',
      language: 'json',
      lineHeight: 16,
      fontSize: 12,
      folding: true,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    const gutterWidth = (editor as any)._gutterWidth()
    const foldLaneWidth = (editor as any)._foldLaneWidth()

    editor.onDoubleClick({
      x: gutterWidth + foldLaneWidth + 8 * 8,
      y: 16 + 8,
    })
    expect(editor.controller.selection).toEqual({
      start: { line: 1, column: 5 },
      end: { line: 1, column: 16 },
    })

    editor.onDoubleClick({
      x: gutterWidth + foldLaneWidth + 8 * 21,
      y: 16 + 8,
    })
    expect(editor.controller.selection).toEqual({
      start: { line: 1, column: 20 },
      end: { line: 1, column: 22 },
    })

    editor.onDoubleClick({
      x: gutterWidth + foldLaneWidth + 8 * 12,
      y: 32 + 8,
    })
    expect(editor.controller.selection).toEqual({
      start: { line: 2, column: 11 },
      end: { line: 2, column: 13 },
    })

    editor.dispose()
  })

  it('selects a word on double click when no language token applies', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const editor = new RenderPlainTextEditor({
      value: 'alpha beta',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.onDoubleClick({
      x: (editor as any)._gutterWidth() + (editor as any)._foldLaneWidth() + 8 * 7,
      y: 8,
    })

    expect(editor.controller.selection).toEqual({
      start: { line: 0, column: 6 },
      end: { line: 0, column: 10 },
    })

    editor.dispose()
  })

  it('does not select a word when double clicking editor whitespace', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const editor = new RenderPlainTextEditor({
      value: 'alpha beta',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    const textX = (editor as any)._gutterWidth() + (editor as any)._foldLaneWidth()

    editor.onDoubleClick({ x: textX + 8 * 12, y: 8 })
    expect(editor.controller.hasSelection).toBe(false)

    editor.onDoubleClick({ x: textX + 8 * 2, y: 48 })
    expect(editor.controller.hasSelection).toBe(false)

    editor.dispose()
  })

  it('does not select a json token when double clicking token boundary punctuation', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const editor = new RenderPlainTextEditor({
      value: '{\n    "age": 42,\n    "name": "张三"\n}',
      language: 'json',
      lineHeight: 16,
      fontSize: 12,
      folding: true,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    const gutterWidth = (editor as any)._gutterWidth()
    const foldLaneWidth = (editor as any)._foldLaneWidth()

    editor.onDoubleClick({
      x: gutterWidth + foldLaneWidth + 8 * 9,
      y: 16 + 8,
    })
    expect(editor.controller.hasSelection).toBe(false)

    editor.onDoubleClick({
      x: gutterWidth + foldLaneWidth + 8 * 13,
      y: 16 + 8,
    })
    expect(editor.controller.hasSelection).toBe(false)

    editor.dispose()
  })

  it('paints only the visible virtual line window for large documents', () => {
    const lines = Array.from({ length: 100_000 }, (_, index) => `line ${index + 1}`)
    const editor = new RenderPlainTextEditor({
      value: lines.join('\n'),
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })
    const painted = createPaintContext()

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.performPaint(painted.context, { x: 0, y: 0 })

    expect(editor.debugState().totalLineCount).toBe(100_000)
    expect(editor.debugState().paintedLineCount).toBeLessThan(40)
    expect(painted.fillText.mock.calls.some(call => call[0] === 'line 1')).toBe(true)
    expect(painted.fillText.mock.calls.some(call => call[0] === 'line 100000')).toBe(false)

    editor.dispose()
  })

  it('exposes horizontal overflow from the longest offscreen line before paint', () => {
    const lines = Array.from({ length: 80 }, (_, index) => index === 60 ? 'W'.repeat(120) : `line ${index}`)
    const editor = new RenderPlainTextEditor({
      value: lines.join('\n'),
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    const consumed = editor.onWheel({
      pointerId: 0,
      position: { x: 40, y: 20 },
      type: 'wheel',
      deltaX: 1,
      deltaY: 0,
    })

    expect(consumed).toBe(true)
    expect(editor.scrollX).toBeGreaterThan(0)
    editor.dispose()
  })

  it('shrinks horizontal extent after the widest line becomes short', () => {
    const controller = new PlainTextEditorController({ value: `short\n${'W'.repeat(120)}\nlast` })
    const editor = new RenderPlainTextEditor({
      controller,
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.scrollX = 1_000
    expect(editor.scrollX).toBeGreaterThan(0)
    controller.replaceRange({ start: { line: 1, column: 0 }, end: { line: 1, column: 120 } }, 'brief')
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })

    expect(editor.scrollX).toBe(0)
    expect(editor.onWheel({
      pointerId: 0,
      position: { x: 40, y: 20 },
      type: 'wheel',
      deltaX: 1,
      deltaY: 0,
    })).toBe(false)
    editor.dispose()
  })

  it('reveals a newly widened caret line without waiting for paint or another layout', () => {
    const controller = new PlainTextEditorController({ value: 'short' })
    const editor = new RenderPlainTextEditor({ controller, folding: false, fontSize: 12 })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })

    controller.replaceRange({ start: { line: 0, column: 5 }, end: { line: 0, column: 5 } }, 'W'.repeat(120))
    editor.revealPosition({ line: 0, column: 125 })

    expect(editor.scrollX).toBeGreaterThan(0)
    editor.dispose()
  })

  it('removes folded hidden lines from horizontal extent', () => {
    const controller = new PlainTextEditorController({
      value: `{\n  "value": "${'W'.repeat(120)}"\n}\nlast`,
      language: 'json',
    })
    const editor = new RenderPlainTextEditor({ controller, folding: true, fontSize: 12 })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    expect(editor.onWheel({
      pointerId: 0,
      position: { x: 40, y: 20 },
      type: 'wheel',
      deltaX: 1,
      deltaY: 0,
    })).toBe(true)
    expect(controller.toggleFold(0)).toBe(true)
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.scrollX = 0

    expect(editor.onWheel({
      pointerId: 0,
      position: { x: 40, y: 20 },
      type: 'wheel',
      deltaX: 1,
      deltaY: 0,
    })).toBe(false)
    editor.dispose()
  })

  it('keeps large-document width indexing free of per-line text measurement', () => {
    const lines = Array.from({ length: 100_000 }, (_, index) => index === 90_000 ? 'W'.repeat(200) : `line ${index}`)
    const editor = new RenderPlainTextEditor({
      value: lines.join('\n'),
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })
    const measureWidth = vi.spyOn(TextMeasurer, 'measureWidth')

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })

    expect(measureWidth.mock.calls.length).toBeLessThan(20)
    expect(editor.onWheel({
      pointerId: 0,
      position: { x: 40, y: 20 },
      type: 'wheel',
      deltaX: 1,
      deltaY: 0,
    })).toBe(true)
    editor.dispose()
  })

  it('measures a small-document long line exactly, including wide glyphs and tabs', () => {
    const longLine = `${'a'.repeat(2_050)}💉\t`
    const expandedLongLine = `${'a'.repeat(2_050)}💉 `
    const measureWidth = vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => {
      if (text === expandedLongLine) return 12_000
      return Array.from(text).length * 6
    })
    const editor = new RenderPlainTextEditor({ value: longLine, fontSize: 12, folding: false })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.scrollX = Number.POSITIVE_INFINITY

    expect(measureWidth).toHaveBeenCalledWith(expandedLongLine, 12, expect.any(String))
    expect((editor as any)._contentWidth).toBeGreaterThanOrEqual(12_000)
    expect(editor.scrollX).toBeGreaterThanOrEqual(12_000 - constraints.maxWidth)
    editor.dispose()
  })

  it('keeps a shorter offscreen wide-glyph line reachable in a large document', () => {
    const wideLine = '💉'.repeat(50)
    const narrowLongLine = 'i'.repeat(240)
    const lines = Array.from({ length: 5_000 }, (_, index) => {
      if (index === 4_200) return narrowLongLine
      if (index === 4_800) return wideLine
      return `line ${index}`
    })
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => {
      if (text === wideLine) return 2_000
      if (text === narrowLongLine) return 480
      if (text === '💉') return 40
      if (text === 'i') return 2
      return Array.from(text).length * 6
    })
    const editor = new RenderPlainTextEditor({
      value: lines.join('\n'),
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.scrollX = Number.POSITIVE_INFINITY

    expect((editor as any)._contentWidth).toBeGreaterThanOrEqual(2_000)
    expect(editor.scrollX).toBeGreaterThanOrEqual(2_000 - constraints.maxWidth)
    editor.dispose()
  })

  it('does not mutate horizontal extent during paint', () => {
    const editor = new RenderPlainTextEditor({
      value: `short\n${'W'.repeat(120)}`,
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })
    const painted = createPaintContext()

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    const beforeWidth = (editor as any)._contentWidth
    const beforeScrollX = editor.scrollX
    editor.performPaint(painted.context, { x: 0, y: 0 })

    expect((editor as any)._contentWidth).toBe(beforeWidth)
    expect(editor.scrollX).toBe(beforeScrollX)
    editor.dispose()
  })

  it('keeps paint bounded after scrolling deep into the document', () => {
    const lines = Array.from({ length: 100_000 }, (_, index) => `row-${index}`)
    const editor = new RenderPlainTextEditor({
      value: lines.join('\n'),
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })
    const painted = createPaintContext()

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.scrollY = 50_000 * 16
    editor.performPaint(painted.context, { x: 0, y: 0 })

    expect(editor.debugState().paintedLineCount).toBeLessThan(40)
    expect(painted.fillText.mock.calls.some(call => call[0] === 'row-50000')).toBe(true)
    expect(painted.fillText.mock.calls.some(call => call[0] === 'row-0')).toBe(false)

    editor.dispose()
  })

  it('contains wheel events at scroll boundaries when the document overflows', () => {
    const editor = new RenderPlainTextEditor({
      value: Array.from({ length: 120 }, (_, index) => `line ${index}`).join('\n'),
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    const topConsumed = editor.onWheel({
      pointerId: 0,
      position: { x: 40, y: 20 },
      type: 'wheel',
      deltaX: 0,
      deltaY: -1,
    })
    expect(topConsumed).toBe(true)
    expect(editor.scrollY).toBe(0)

    editor.scrollY = 1_000_000
    const bottom = editor.scrollY
    const bottomConsumed = editor.onWheel({
      pointerId: 0,
      position: { x: 40, y: 20 },
      type: 'wheel',
      deltaX: 0,
      deltaY: 1,
    })

    expect(bottomConsumed).toBe(true)
    expect(editor.scrollY).toBe(bottom)

    editor.dispose()
  })

  it('keeps vertical scroll stable when typing with the cursor already visible after scrolling down', () => {
    const lines = Array.from({ length: 120 }, (_, index) => `line ${index}`)
    const editor = new RenderPlainTextEditor({
      value: lines.join('\n'),
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.revealPosition({ line: 64, column: lines[64]!.length })
    editor.focusIn()
    const before = editor.scrollY
    const ta = inputElement()
    ta.value = `${lines[64]}x`
    ta.setSelectionRange(ta.value.length, ta.value.length)
    ta.dispatchEvent(new Event('input'))

    expect(editor.value.split('\n')[64]).toBe(`${lines[64]}x`)
    expect(editor.scrollY).toBe(before)

    editor.dispose()
  })

  it('syncs the hidden textarea immediately when clicking a new visible line in a focused scrolled editor', () => {
    const lines = Array.from({ length: 120 }, (_, index) => `line ${index}`)
    const editor = new RenderPlainTextEditor({
      value: lines.join('\n'),
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.focusIn()
    editor.scrollY = 60 * 16
    editor.onPointerDown({
      pointerId: 1,
      position: { x: 90, y: 4 * 16 + 8 },
      type: 'down',
      setPointerCapture: vi.fn(),
    })
    const before = editor.scrollY
    const ta = inputElement()
    expect(ta.value).toBe(lines[64])

    ta.value = `${lines[64]}x`
    ta.setSelectionRange(ta.value.length, ta.value.length)
    ta.dispatchEvent(new Event('input'))

    expect(editor.value.split('\n')[64]).toBe(`${lines[64]}x`)
    expect(editor.scrollY).toBe(before)

    editor.dispose()
  })

  it('keeps the document cursor unchanged when typing after manually scrolling it out of view', () => {
    const lines = Array.from({ length: 120 }, (_, index) => `line ${index}`)
    const editor = new RenderPlainTextEditor({
      value: lines.join('\n'),
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.focusIn()
    const consumed = editor.onWheel({
      pointerId: 0,
      position: { x: 40, y: 20 },
      type: 'wheel',
      deltaX: 0,
      deltaY: 1,
    })
    const before = editor.scrollY
    const line = editor.controller.cursor.line
    const ta = inputElement()

    expect(consumed).toBe(true)
    expect(before).toBeGreaterThan(0)
    expect(line).toBe(0)
    expect(ta.value).toBe(lines[line])

    ta.value = `${lines[line]}x`
    ta.setSelectionRange(ta.value.length, ta.value.length)
    ta.dispatchEvent(new Event('input'))

    expect(editor.value.split('\n')[line]).toBe(`${lines[line]}x`)
    expect(editor.scrollY).toBe(before)

    editor.dispose()
  })

  it('preserves scroll when typing while the document cursor is outside the current viewport', () => {
    const lines = Array.from({ length: 120 }, (_, index) => `line ${index}`)
    const editor = new RenderPlainTextEditor({
      value: lines.join('\n'),
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.focusIn()
    editor.scrollY = 60 * 16
    const before = editor.scrollY
    const ta = inputElement()
    expect(editor.controller.cursor.line).toBe(0)
    expect(ta.value).toBe(lines[0])

    ta.value = `${lines[0]}x`
    ta.setSelectionRange(ta.value.length, ta.value.length)
    ta.dispatchEvent(new Event('input'))

    expect(editor.value.split('\n')[0]).toBe(`${lines[0]}x`)
    expect(editor.scrollY).toBe(before)

    editor.dispose()
  })

  it('does not let measure layout clamp the real vertical scroll state', () => {
    const lines = Array.from({ length: 14 }, (_, index) => `line ${index}`)
    const editor = new RenderPlainTextEditor({
      value: lines.join('\n'),
      lineHeight: 21,
      fontSize: 13,
      folding: false,
    })

    editor.layout(
      { minWidth: 0, maxWidth: 696, minHeight: 0, maxHeight: 184 },
      false,
      { theme: ImGuiDarkTheme },
    )
    editor.scrollY = 100
    const before = editor.scrollY

    editor.measure(
      { minWidth: 0, maxWidth: 400, minHeight: 0, maxHeight: 308 },
      { theme: ImGuiDarkTheme },
    )

    expect(editor.scrollY).toBe(before)

    editor.dispose()
  })

  it('paints a visible slice for very long lines', () => {
    const editor = new RenderPlainTextEditor({
      value: 'a'.repeat(100_000),
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })
    const painted = createPaintContext()

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.performPaint(painted.context, { x: 0, y: 0 })

    const paintedText = painted.fillText.mock.calls
      .map(call => String(call[0]))
      .filter(text => text.startsWith('a'))
    expect(paintedText.length).toBeGreaterThan(0)
    expect(Math.max(...paintedText.map(text => text.length))).toBeLessThan(80)

    editor.dispose()
  })

  it('uses constant-time hit testing for very long lines', () => {
    const editor = new RenderPlainTextEditor({
      value: 'a'.repeat(100_000),
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })
    const measureWidth = vi.spyOn(TextMeasurer, 'measureWidth')

    const column = (editor as any)._hitColumn('a'.repeat(100_000), 1200)

    expect(column).toBeGreaterThan(0)
    expect(measureWidth.mock.calls.some(call => String(call[0]).length > 1000)).toBe(false)

    editor.dispose()
  })

  it('clips scrolled text to the content lane instead of painting over line numbers', () => {
    const editor = new RenderPlainTextEditor({
      value: '0123456789abcdefghijklmnopqrstuvwxyz',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })
    const painted = createPaintContext()

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.scrollX = 80
    editor.performPaint(painted.context, { x: 0, y: 0 })

    const gutterWidth = (editor as any)._gutterWidth(painted.context)
    expect(painted.rect.mock.calls.some(call => call[0] === gutterWidth && call[2] === editor.size.width - gutterWidth)).toBe(true)
    expect(painted.fillText.mock.calls.some(call => call[0] === '1')).toBe(true)

    editor.dispose()
  })

  it('clips overscanned gutter rows to the editor viewport', () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index}`)
    const editor = new RenderPlainTextEditor({
      value: lines.join('\n'),
      lineHeight: 16,
      fontSize: 12,
      folding: true,
    })
    const painted = createPaintContext()

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.scrollY = 12 * 16
    const expectedClipHeight = (editor as any)._viewH
    editor.performPaint(painted.context, { x: 0, y: 0 })

    const gutterWidth = (editor as any)._gutterWidth(painted.context)
    expect(painted.rect.mock.calls.some(call =>
      Math.abs(call[0]) < 0.1
      && Math.abs(call[2] - gutterWidth) < 1
      && Math.abs(call[3] - expectedClipHeight) < 0.1,
    )).toBe(true)

    editor.dispose()
  })

  it('does not sync the hidden textarea selection on every drag move', () => {
    const editor = new RenderPlainTextEditor({
      value: 'abcdef',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.onPointerDown({
      pointerId: 1,
      position: { x: 80, y: 8 },
      type: 'down',
      setPointerCapture: vi.fn(),
    })
    const ta = inputElement()
    const setSelectionRange = vi.spyOn(ta, 'setSelectionRange')
    editor.onPointerMove({
      pointerId: 1,
      position: { x: 120, y: 8 },
      type: 'move',
    })

    expect(setSelectionRange).not.toHaveBeenCalled()

    editor.onPointerUp({
      pointerId: 1,
      position: { x: 120, y: 8 },
      type: 'up',
      releasePointerCapture: vi.fn(),
    })
    expect(setSelectionRange).toHaveBeenCalled()

    editor.dispose()
  })

  it('defers hidden textarea focus on first pointer click so caret paint is not blocked', () => {
    const deferredFrames: FrameRequestCallback[] = []
    const deferredTimers: Array<() => void> = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      deferredFrames.push(cb)
      return 1
    })
    vi.stubGlobal('setTimeout', (cb: () => void) => {
      deferredTimers.push(cb)
      return 1
    })
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus')
    const editor = new RenderPlainTextEditor({
      value: 'abcdef',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.onPointerDown({
      pointerId: 1,
      position: { x: 80, y: 8 },
      type: 'down',
      setPointerCapture: vi.fn(),
    })

    expect(editor.isFocused).toBe(true)
    expect(focus).not.toHaveBeenCalled()

    expect(deferredFrames).toHaveLength(1)
    deferredFrames[0]!(0)
    expect(focus).not.toHaveBeenCalled()
    expect(deferredTimers.length).toBeGreaterThanOrEqual(1)
    deferredTimers[deferredTimers.length - 1]!()
    expect(focus).toHaveBeenCalledTimes(1)

    editor.dispose()
  })

  it('paints indentation guide lines in the editor content area', () => {
    const editor = new RenderPlainTextEditor({
      value: '{\n    "a": {\n        "b": 1\n    }\n}',
      language: 'json',
      lineHeight: 16,
      fontSize: 12,
      folding: true,
    })
    const painted = createPaintContext()

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.performPaint(painted.context, { x: 0, y: 0 })

    const gutterWidth = (editor as any)._gutterWidth(painted.context)
    const guideLines = painted.lineTo.mock.calls.filter(call => call[0] > gutterWidth)
    expect(guideLines.length).toBeGreaterThanOrEqual(3)

    editor.dispose()
  })

  it('paints fold markers at their indentation level instead of the line-number gutter', () => {
    class MockPath2D {
      constructor(readonly data: string) {}
    }
    vi.stubGlobal('Path2D', MockPath2D)
    const editor = new RenderPlainTextEditor({
      value: '{\n    "a": {\n        "b": 1\n    }\n}',
      language: 'json',
      lineHeight: 16,
      fontSize: 12,
      folding: true,
    })
    const painted = createPaintContext()

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.performPaint(painted.context, { x: 0, y: 0 })

    const gutterWidth = (editor as any)._gutterWidth(painted.context)
    const markers = painted.translate.mock.calls.map(call => Number(call[0]))
    expect(markers.length).toBeGreaterThanOrEqual(2)
    const rootMarkerX = markers[0]!
    const nestedMarkerX = markers[1]!
    expect(rootMarkerX).toBeGreaterThan(gutterWidth)
    expect(nestedMarkerX).toBeGreaterThan(rootMarkerX)

    editor.dispose()
  })

  it('toggles folding only from the fold marker at the current indent level', () => {
    const editor = new RenderPlainTextEditor({
      value: '{\n    "a": {\n        "b": 1\n    }\n}',
      language: 'json',
      lineHeight: 16,
      fontSize: 12,
      folding: true,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    const before = editor.controller.getVisibleLineCount()
    editor.onPointerDown({
      pointerId: 1,
      position: { x: 12, y: 24 },
      type: 'down',
      setPointerCapture: vi.fn(),
    })
    expect(editor.controller.getVisibleLineCount()).toBe(before)

    const marker = (editor as any)._foldMarkerRectForLine(1)
    editor.onPointerDown({
      pointerId: 1,
      position: { x: marker.x + marker.size / 2, y: marker.y + marker.size / 2 },
      type: 'down',
      setPointerCapture: vi.fn(),
    })
    expect(editor.controller.getVisibleLineCount()).toBeLessThan(before)

    editor.dispose()
  })

  it('selects the hidden fold range from its painted placeholder', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const editor = new RenderPlainTextEditor({
      value: '{\n  "hidden": true\n}\nafter',
      language: 'json',
      lineHeight: 16,
      fontSize: 12,
      folding: true,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    expect(editor.controller.toggleFold(0)).toBe(true)
    const textX = (editor as any)._gutterWidth() + (editor as any)._foldLaneWidth()
    editor.onPointerDown({
      pointerId: 1,
      position: { x: textX + 8 * 3, y: 8 },
      type: 'down',
      setPointerCapture: vi.fn(),
    })

    expect(editor.controller.selection).toEqual({
      start: { line: 0, column: 1 },
      end: { line: 2, column: 1 },
    })
    expect(editor.getCopyText()).toBe('\n  "hidden": true\n}')

    editor.dispose()
  })

  it('commits pasted multiline textarea values and keeps the cursor on the pasted line', () => {
    const editor = new RenderPlainTextEditor({
      value: 'hello world',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: 5 })
    editor.focusIn()
    const ta = inputElement()
    ta.value = 'hello\ncanvas world'
    ta.setSelectionRange(12, 12)
    ta.dispatchEvent(new Event('input'))

    expect(editor.value).toBe('hello\ncanvas world')
    expect(editor.controller.cursor).toEqual({ line: 1, column: 6 })

    editor.dispose()
  })

  it('handles large clipboard paste without storing the full paste in the hidden textarea', () => {
    const editor = new RenderPlainTextEditor({
      value: 'hello world',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })
    const largeText = Array.from({ length: 50_000 }, (_, index) => `line-${index}`).join('\n')

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: 5 })
    editor.focusIn()
    const ta = inputElement()
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        getData: (type: string) => type === 'text/plain' || type === 'text' ? largeText : '',
      },
    })

    ta.dispatchEvent(paste)

    expect(paste.defaultPrevented).toBe(true)
    expect(editor.controller.document.lineCount).toBe(50_000)
    expect(editor.controller.document.getLine(0)).toBe('helloline-0')
    expect(editor.controller.document.getLine(49_999)).toBe('line-49999 world')
    expect(editor.controller.cursor).toEqual({ line: 49_999, column: 'line-49999'.length })
    expect(ta.value).toBe('line-49999 world')

    editor.dispose()
  })

  it('keeps an empty clipboard paste as a no-op for text, selection, and history', () => {
    const editor = new RenderPlainTextEditor({
      value: 'alpha',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setSelection({ line: 0, column: 1 }, { line: 0, column: 4 })
    editor.focusIn()
    const beforeRevision = editor.controller.revision
    const beforeSelection = editor.controller.selection
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => '' },
    })

    inputElement().dispatchEvent(paste)

    expect(paste.defaultPrevented).toBe(true)
    expect(editor.value).toBe('alpha')
    expect(editor.controller.selection).toEqual(beforeSelection)
    expect(editor.controller.revision).toBe(beforeRevision)
    expect(editor.controller.canUndo).toBe(false)
    editor.dispose()
  })

  it('replaces multiline selections before printable input reaches the hidden textarea', () => {
    const editor = new RenderPlainTextEditor({
      value: 'abc\ndef',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setSelection({ line: 0, column: 1 }, { line: 1, column: 2 })
    editor.focusIn()
    const ta = inputElement()
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z' }))

    expect(editor.value).toBe('af')
    expect(ta.value).toBe('af')

    ta.value = 'aZf'
    ta.setSelectionRange(2, 2)
    ta.dispatchEvent(new Event('input'))

    expect(editor.value).toBe('aZf')
    expect(editor.controller.cursor).toEqual({ line: 0, column: 2 })

    editor.dispose()
  })

  it('moves to line and document boundaries from keyboard shortcuts', () => {
    const editor = new RenderPlainTextEditor({
      value: 'alpha\nbeta gamma\nomega',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 1, column: 4 })
    editor.focusIn()
    const ta = inputElement()

    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }))
    expect(editor.controller.cursor).toEqual({ line: 1, column: 0 })

    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
    expect(editor.controller.cursor).toEqual({ line: 1, column: 'beta gamma'.length })

    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(editor.controller.cursor).toEqual({ line: 0, column: 0 })

    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(editor.controller.cursor).toEqual({ line: 2, column: 'omega'.length })

    editor.dispose()
  })

  it('extends selections when moving to line boundaries', () => {
    const editor = new RenderPlainTextEditor({
      value: 'alpha\nbeta gamma',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 1, column: 4 })
    editor.focusIn()
    const ta = inputElement()

    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', shiftKey: true, bubbles: true, cancelable: true }))
    expect(editor.controller.selection).toEqual({
      start: { line: 1, column: 4 },
      end: { line: 1, column: 'beta gamma'.length },
    })

    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', shiftKey: true, bubbles: true, cancelable: true }))
    expect(editor.controller.selection).toEqual({
      start: { line: 1, column: 0 },
      end: { line: 1, column: 4 },
    })

    editor.dispose()
  })

  it('supports macOS command arrow line boundary shortcuts', () => {
    const editor = new RenderPlainTextEditor({
      value: 'alpha\nbeta gamma',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 1, column: 4 })
    editor.focusIn()
    const ta = inputElement()

    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', metaKey: true, bubbles: true, cancelable: true }))
    expect(editor.controller.cursor).toEqual({ line: 1, column: 'beta gamma'.length })

    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', metaKey: true, bubbles: true, cancelable: true }))
    expect(editor.controller.cursor).toEqual({ line: 1, column: 0 })

    editor.dispose()
  })

  it('indents the current line with Tab', () => {
    const editor = new RenderPlainTextEditor({
      value: 'alpha',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
      tabSize: 2,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: 2 })
    editor.focusIn()
    const ta = inputElement()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })

    ta.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(editor.value).toBe('  alpha')
    expect(editor.controller.cursor).toEqual({ line: 0, column: 4 })

    editor.dispose()
  })

  it('handles undo and redo keyboard shortcuts', () => {
    const editor = new RenderPlainTextEditor({
      value: 'alpha',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: 5 })
    editor.controller.insertText('!')
    editor.focusIn()
    const ta = inputElement()

    const undoEvent = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    ta.dispatchEvent(undoEvent)
    expect(undoEvent.defaultPrevented).toBe(true)
    expect(editor.value).toBe('alpha')

    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    expect(editor.value).toBe('alpha!')

    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(editor.value).toBe('alpha!')

    editor.dispose()
  })

  it('consumes undo shortcuts in readonly mode without modifying text', () => {
    const editor = new RenderPlainTextEditor({
      value: 'alpha',
      readonly: true,
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.focusIn()
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })

    inputElement().dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(editor.value).toBe('alpha')

    editor.dispose()
  })

  it('indents selected lines without including the next line when selection ends at column zero', () => {
    const editor = new RenderPlainTextEditor({
      value: 'alpha\nbeta\ngamma',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
      tabSize: 2,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setSelection({ line: 0, column: 1 }, { line: 2, column: 0 })
    editor.focusIn()
    const ta = inputElement()

    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))

    expect(editor.value).toBe('  alpha\n  beta\ngamma')
    expect(editor.controller.selection).toEqual({
      start: { line: 0, column: 3 },
      end: { line: 2, column: 0 },
    })

    editor.dispose()
  })

  it('outdents selected lines with Shift+Tab', () => {
    const editor = new RenderPlainTextEditor({
      value: '    alpha\n  beta\n\tgamma',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
      tabSize: 2,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.selectAll()
    editor.focusIn()
    const ta = inputElement()
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })

    ta.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(editor.value).toBe('  alpha\nbeta\ngamma')
    expect(editor.controller.selection).toEqual({
      start: { line: 0, column: 0 },
      end: { line: 2, column: 'gamma'.length },
    })

    editor.dispose()
  })

  it('previews and commits IME composition at the document cursor', () => {
    const editor = new RenderPlainTextEditor({
      value: 'ab',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })
    const painted = createPaintContext()

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: 1 })
    editor.focusIn()
    const ta = inputElement()
    ta.dispatchEvent(new CompositionEvent('compositionstart'))
    ta.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'zhong' }))
    editor.performPaint(painted.context, { x: 0, y: 0 })

    expect(painted.fillText.mock.calls.some(call => call[0] === 'azhongb')).toBe(true)
    expect(editor.value).toBe('ab')

    ta.value = 'a中b'
    ta.setSelectionRange(2, 2)
    ta.dispatchEvent(new CompositionEvent('compositionend', { data: '中' }))

    expect(editor.value).toBe('a中b')
    expect(editor.controller.cursor).toEqual({ line: 0, column: 2 })

    editor.dispose()
  })

  it('moves the hidden IME composer to the visual composition caret', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const editor = new RenderPlainTextEditor({
      value: 'ab',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: 1 })
    editor.focusIn()
    const ta = inputElement()
    ta.dispatchEvent(new CompositionEvent('compositionstart'))
    ta.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'zhong' }))

    const gutterWidth = (editor as any)._gutterWidth()
    const foldLaneWidth = (editor as any)._foldLaneWidth()
    expect(Number.parseFloat(ta.style.left)).toBe(gutterWidth + foldLaneWidth + 'azhong'.length * 8)

    editor.dispose()
  })

  it('copies selections and keeps dynamic readonly view-only', () => {
    const editor = new RenderPlainTextEditor({
      value: 'alpha\nbeta',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setSelection({ line: 0, column: 1 }, { line: 1, column: 2 })
    expect(editor.getCopyText()).toBe('lpha\nbe')
    editor.controller.setCursor({ line: 0, column: 2 })

    editor.focusIn()
    const ta = inputElement()
    ta.dispatchEvent(new CompositionEvent('compositionstart'))
    expect(editor.textInput.composing).toBe(true)

    editor.readonly = true

    expect(editor.textInput.composing).toBe(false)
    expect(ta.readOnly).toBe(true)
    ta.value = 'changed'
    ta.setSelectionRange(7, 7)
    ta.dispatchEvent(new Event('input'))
    expect(editor.value).toBe('alpha\nbeta')
    expect(ta.value).toBe('alpha')
    expect(editor.getCopyText()).toBeNull()

    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => 'leaked' },
    })
    ta.dispatchEvent(paste)
    expect(paste.defaultPrevented).toBe(true)
    expect(editor.value).toBe('alpha\nbeta')

    editor.readonly = false
    expect(ta.readOnly).toBe(false)
    expect(ta.value).toBe('alpha')
    ta.value = 'alXpha'
    ta.setSelectionRange(3, 3)
    ta.dispatchEvent(new Event('input'))
    expect(editor.value).toBe('alXpha\nbeta')

    editor.dispose()
  })

  it('keeps pointer selections scrolling while the pointer stays near the viewport edge', () => {
    vi.useFakeTimers()
    try {
      const editor = new RenderPlainTextEditor({
        value: Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n'),
        lineHeight: 16,
        fontSize: 12,
        folding: false,
      })
      editor.layout(constraints, false, { theme: ImGuiDarkTheme })
      editor.focusIn()
      const textX = (editor as any)._gutterWidth() + 8
      editor.onPointerDown({
        pointerId: 1,
        position: { x: textX, y: 8 },
        type: 'down',
        setPointerCapture: vi.fn(),
      })

      editor.onPointerMove({
        pointerId: 1,
        position: { x: textX, y: constraints.maxHeight - 1 },
        type: 'move',
      })
      const firstScrollY = editor.scrollY
      expect(firstScrollY).toBeGreaterThan(0)

      vi.advanceTimersByTime(64)
      expect(editor.scrollY).toBeGreaterThan(firstScrollY)
      expect(editor.controller.selection.end.line).toBeGreaterThan(0)

      editor.onPointerUp({
        pointerId: 1,
        position: { x: textX, y: constraints.maxHeight - 1 },
        type: 'up',
        releasePointerCapture: vi.fn(),
      })
      const stoppedAt = editor.scrollY
      vi.advanceTimersByTime(64)
      expect(editor.scrollY).toBe(stoppedAt)
      editor.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('draws a visible selection block for a selected line break', () => {
    const editor = new RenderPlainTextEditor({ value: 'a\nb', folding: false })
    editor.controller.setSelection({ line: 0, column: 1 }, { line: 1, column: 0 })

    expect((editor as any)._selectionColumnRangeForLine(0, 'a')).toEqual({
      start: 1,
      end: 1,
      includesLineBreak: true,
    })
    expect((editor as any)._selectionColumnRangeForLine(1, 'b')).toBeNull()
    editor.dispose()
  })

  it('uses tabSize for existing tab width, hit testing, and painted text', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const narrow = new RenderPlainTextEditor({ value: '\tX', tabSize: 2, folding: false })
    const wide = new RenderPlainTextEditor({ value: '\tX', tabSize: 8, folding: false })
    const painted = createPaintContext()

    expect((narrow as any)._measureLine(0)).toBe(24)
    expect((wide as any)._measureLine(0)).toBe(72)
    narrow.layout(constraints, false, { theme: ImGuiDarkTheme })
    narrow.performPaint(painted.context, { x: 0, y: 0 })
    expect(painted.fillText.mock.calls.map(call => call[0])).toContain('  X')
    expect((narrow as any)._hitColumn('\tX', 15)).toBe(1)

    narrow.dispose()
    wide.dispose()
  })

  it('invalidates the active search match when the document changes', () => {
    const editor = new RenderPlainTextEditor({ value: 'before\nneedle', folding: false })
    editor.setSearchQuery('needle')
    expect(editor.findNextSearchMatch()?.text).toBe('needle')
    expect(editor.activeSearchMatch).not.toBeNull()

    editor.controller.replaceRange({
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
    }, '\n')

    expect(editor.activeSearchMatch).toBeNull()
    editor.dispose()
  })

  it('leaves focus order and clears transient interaction when hidden', () => {
    const editor = new RenderPlainTextEditor({
      value: 'alpha\nbeta',
      lineHeight: 16,
      fontSize: 12,
      folding: false,
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    FocusManager.instance.setFocus(editor)
    editor.onPointerDown({
      pointerId: 1,
      position: { x: 60, y: 8 },
      type: 'down',
      setPointerCapture: vi.fn(),
    })

    editor.visible = false

    expect(editor.isFocused).toBe(false)
    expect(FocusManager.instance.current).toBeNull()
    expect(FocusManager.instance.scopeStack[0]!.focusables).not.toContain(editor)

    editor.visible = true

    expect(FocusManager.instance.scopeStack[0]!.focusables).toContain(editor)

    editor.dispose()
  })
})

it('paints background range decorations without turning them into diagnostic underlines',()=>{
 const editor=new RenderPlainTextEditor({value:'abc',folding:false,showIndentGuides:false,showLineNumbers:false,decorations:[{range:{start:{line:0,column:0},end:{line:0,column:3}},kind:'info',appearance:'background'}]})
 const painted=createPaintContext(),fills:string[]=[];vi.mocked(painted.context.ctx.fillRect).mockImplementation(()=>{fills.push(painted.context.ctx.fillStyle as string)});editor.layout(constraints,false,{theme:ImGuiDarkTheme});editor.performPaint(painted.context,{x:0,y:0})
 expect(fills).toContain(colorToCSS({...ImGuiDarkTheme.textAccent,a:.14}));expect(painted.strokeStyles).not.toContain(colorToCSS(ImGuiDarkTheme.textAccent));expect(editor.value).toBe('abc');editor.dispose()
})
