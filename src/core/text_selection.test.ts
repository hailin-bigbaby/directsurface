import { describe, expect, it } from 'vitest'
import { hasUnpairedUtf16Surrogate, limitTextEdit, normalizeUtf16ScalarRange, resolveWordSelectionRange, utf16ScalarBoundary } from './text_selection'

describe('limited text edits', () => {
  it.each([
    ['ABCDE', 'ABxCDE', 3, 5, 'ABCDE', 2],
    ['ABCDE', 'ABxyzCDE', 5, 6, 'ABxCDE', 3],
    ['AAAA', 'AAAAA', 2, 4, 'AAAA', 1],
    ['ABCDE', 'AxyzDE', 4, 5, 'AxyDE', 3],
    ['AB', 'A😀B', 3, 3, 'AB', 1],
    ['AB', 'A😀xB', 4, 4, 'A😀B', 3],
    ['A😀B', 'Ax😀B', 2, 4, 'A😀B', 1],
    ['AB\nCDE', 'AxB\nCDE', 2, 6, 'AB\nCDE', 1],
  ] as const)('limits %s -> %s without deleting retained text', (before, next, caret, max, expected, expectedCaret) => {
    const result = limitTextEdit(before, next, caret, caret, max)
    expect(result).toEqual({ value: expected, selectionStart: expectedCaret, selectionEnd: expectedCaret })
    expect(hasUnpairedUtf16Surrogate(result.value)).toBe(false)
  })
})

describe('UTF-16 scalar boundaries', () => {
  it('preserves every complete boundary and expands only inside a valid pair', () => {
    const text = 'A😀中𠀀B'
    for (const index of [0, 1, 3, 4, 6, 7]) {
      expect(utf16ScalarBoundary(text, index)).toBe(index)
      expect(utf16ScalarBoundary(text, index, 'end')).toBe(index)
    }
    expect(normalizeUtf16ScalarRange(text, { start: 2, end: 5 })).toEqual({ start: 1, end: 6 })
    expect(normalizeUtf16ScalarRange(text, { start: 2, end: 2 })).toEqual({ start: 1, end: 1 })
    expect(hasUnpairedUtf16Surrogate(text)).toBe(false)
    for (const invalid of ['\ud800', '\udfff', 'A\ud800中', '\udc00\ud800']) {
      expect(hasUnpairedUtf16Surrogate(invalid)).toBe(true)
    }
  })
})

describe('resolveWordSelectionRange', () => {
  it('selects the contiguous word at the character index', () => {
    expect(resolveWordSelectionRange('alpha beta', 7)).toEqual({ start: 6, end: 10 })
    expect(resolveWordSelectionRange('月经史 规律', 5)).toEqual({ start: 4, end: 6 })
  })

  it('treats punctuation as a word boundary', () => {
    expect(resolveWordSelectionRange('10.00', 0)).toEqual({ start: 0, end: 2 })
    expect(resolveWordSelectionRange('10.00', 3)).toEqual({ start: 3, end: 5 })
    expect(resolveWordSelectionRange('10.00', 2)).toBeNull()
  })

  it('returns null for whitespace and out-of-range positions', () => {
    expect(resolveWordSelectionRange('alpha beta', 5)).toBeNull()
    expect(resolveWordSelectionRange('alpha', -1)).toBeNull()
    expect(resolveWordSelectionRange('alpha', 5)).toBeNull()
  })
})
