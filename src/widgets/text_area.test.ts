// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { PopupManager } from '../core/popup_manager'
import { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { RenderTextArea } from './text_area'

const constraints = { minWidth: 0, maxWidth: 240, minHeight: 0, maxHeight: 120 }
function inputElement(): HTMLTextAreaElement {
  const input = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement | null
  if (!input) throw new Error('Input composer not created')
  return input
}
function pasteEvent(text: string): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } })
  return event
}
afterEach(() => {
  PopupManager.disposeInstance()
  FocusManager.disposeInstance()
  InputComposer.disposeInstance()
  vi.restoreAllMocks()
})
function createTextRecordingPaintContext() {
  const fillText = vi.fn()
  const ctx = {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    fillText, measureText: (text: string) => ({ width: text.length * 8 }),
    moveTo: vi.fn(), lineTo: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, ImGuiDarkTheme), fillText }
}

describe('TextArea input preservation', () => {
  it.each([
    ['😀', 0, ''], ['😀', 1, ''], ['😀', 2, '😀'],
    ['A😀B', 2, 'A'], ['😀AB', 3, '😀A'], ['AB😀', 3, 'AB'],
  ] as const)('does not split a surrogate pair when limiting %s to %s', (value, maxLength, expected) => {
    const area = new RenderTextArea({ value, maxLength })
    expect(area.value).toBe(expected)
    area.maxLength = null
    area.value = value
    area.maxLength = maxLength
    expect(area.value).toBe(expected)
    area.value = value
    expect(area.value).toBe(expected)
    area.dispose()
  })

  it.each([
    ['ABCDE', 5, 2, 2, 'x', 'ABCDE', 2],
    ['ABCDE', 6, 2, 2, 'XYZ', 'ABXCDE', 3],
    ['ABCDE', 5, 1, 3, 'xyz', 'AxyDE', 3],
    ['AB\nCD\nEF', 8, 1, 5, 'XYZLONG', 'AXYZL\nEF', 5],
    ['AB', 3, 1, 1, '😀', 'AB', 1],
    ['AB', 4, 1, 1, '😀Z', 'A😀B', 3],
    ['A😀B', 4, 2, 3, 'XYZ', 'AXYB', 3],
    ['AAAA', 4, 1, 1, 'A', 'AAAA', 1],
    ['', 0, 0, 0, 'X', '', 0],
  ] as const)('preserves nonselected content when pasting into %s', (value, maxLength, start, end, paste, expected, caret) => {
    const onChange = vi.fn()
    const listener = vi.fn()
    const area = new RenderTextArea({ value, maxLength, onChange })
    area.subscribeValueChange(listener)
    ;(area as any)._cursor = (area as any)._posFromFlat(start)
    ;(area as any)._selection.setNormalizedRange(start, end)
    area.focusIn()
    const ta = inputElement()
    ta.dispatchEvent(pasteEvent(paste))
    expect(area.value).toBe(expected)
    expect((area as any)._selection.start).toBe(caret)
    expect((area as any)._selection.end).toBe(caret)
    expect(onChange).toHaveBeenCalledTimes(expected === value ? 0 : 1)
    expect(listener).toHaveBeenCalledTimes(expected === value ? 0 : 1)
    area.dispose()
  })

  it.each(['input', 'composition'] as const)('preserves following lines on over-limit native %s', source => {
    const area = new RenderTextArea({ value: 'AB\nCDE', maxLength: 7 })
    ;(area as any)._cursor = { line: 0, col: 1 }
    ;(area as any)._selection.collapse(1)
    area.focusIn()
    const ta = inputElement()
    if (source === 'composition') ta.dispatchEvent(new CompositionEvent('compositionstart'))
    ta.value = 'AXYZB'
    ta.setSelectionRange(4, 4)
    ta.dispatchEvent(source === 'input' ? new Event('input') : new CompositionEvent('compositionend', { data: 'XYZ' }))
    expect(area.value).toBe('AXB\nCDE')
    expect(ta.value).toBe('AXB')
    expect(ta.selectionStart).toBe(2)
    expect((area as any)._selection.start).toBe(2)
    area.dispose()
  })

  it('rejects an overflowing newline and allows replacement without losing the suffix', () => {
    const onChange = vi.fn()
    const area = new RenderTextArea({ value: 'ABCDE', maxLength: 5, onChange })
    ;(area as any)._cursor = { line: 0, col: 2 }
    ;(area as any)._selection.collapse(2)
    area.focusIn()
    const ta = inputElement()
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(area.value).toBe('ABCDE')
    expect(ta.selectionStart).toBe(2)
    expect(onChange).not.toHaveBeenCalled()
    ;(area as any)._selection.setNormalizedRange(2, 3)
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(area.value).toBe('AB\nDE')
    expect(ta.value).toBe('DE')
    expect(ta.selectionStart).toBe(0)
    expect(onChange).toHaveBeenCalledOnce()
    area.dispose()
  })

  it('repaints a changed placeholder without changing value, layout, or focus', () => {
    const onChange = vi.fn()
    const area = new RenderTextArea({ placeholder: '旧提示', onChange })
    area.layout(constraints)
    area.focusIn()
    const repaint = vi.spyOn(area, 'markNeedsPaint')
    const relayout = vi.spyOn(area, 'markNeedsLayout')
    area.placeholder = '新提示'
    expect(repaint).toHaveBeenCalledOnce()
    expect(relayout).not.toHaveBeenCalled()
    expect(area.isFocused).toBe(true)
    expect(area.value).toBe('')
    expect(onChange).not.toHaveBeenCalled()
    const painted = createTextRecordingPaintContext()
    area.performPaint(painted.context, { x: 0, y: 0 })
    expect(painted.fillText.mock.calls.map(call => call[0])).toContain('新提示')
    expect(painted.fillText.mock.calls.map(call => call[0])).not.toContain('旧提示')
    repaint.mockClear()
    area.placeholder = '新提示'
    expect(repaint).not.toHaveBeenCalled()
    area.dispose()
  })
})
