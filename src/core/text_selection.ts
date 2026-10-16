export interface TextSelectionRange {
  start: number
  end: number
}

/** UTF-16 offsets remain code units; only boundaries inside a valid pair move. */
export function utf16ScalarBoundary(text: string, index: number, edge: 'start' | 'end' = 'start'): number {
  const offset = Math.max(0, Math.min(text.length, index))
  const previous = text.charCodeAt(offset - 1)
  const next = text.charCodeAt(offset)
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? offset + (edge === 'start' ? -1 : 1)
    : offset
}

export function normalizeUtf16ScalarRange(text: string, range: TextSelectionRange): TextSelectionRange {
  const start = utf16ScalarBoundary(text, range.start)
  return { start, end: range.start === range.end ? start : utf16ScalarBoundary(text, range.end, 'end') }
}

/** Limit the replacement, keeping unchanged text after the native edit caret. */
export function limitTextEdit(
  previous: string,
  value: string,
  selectionStart: number,
  selectionEnd: number,
  maxLength: number | null,
): { value: string; selectionStart: number; selectionEnd: number } {
  if (maxLength === null || value.length <= maxLength) return { value, selectionStart, selectionEnd }
  let suffix = 0
  const suffixLimit = Math.min(previous.length, value.length - selectionEnd)
  while (suffix < suffixLimit && previous[previous.length - suffix - 1] === value[value.length - suffix - 1]) suffix++
  suffix = Math.min(
    previous.length - utf16ScalarBoundary(previous, previous.length - suffix, 'end'),
    value.length - utf16ScalarBoundary(value, value.length - suffix, 'end'),
  )
  let prefix = 0
  while (prefix < previous.length - suffix && prefix < value.length - suffix && previous[prefix] === value[prefix]) prefix++
  prefix = utf16ScalarBoundary(value, prefix)
  const replacement = value.slice(prefix, value.length - suffix)
  const accepted = utf16ScalarBoundary(replacement, Math.max(0, maxLength - prefix - suffix))
  const removed = replacement.length - accepted
  const mapPosition = (position: number) => position <= prefix + accepted
    ? position
    : position < value.length - suffix ? prefix + accepted : position - removed
  return {
    value: value.slice(0, prefix) + replacement.slice(0, accepted) + value.slice(value.length - suffix),
    selectionStart: mapPosition(selectionStart),
    selectionEnd: mapPosition(selectionEnd),
  }
}

export function hasUnpairedUtf16Surrogate(text: string): boolean {
  for (let index = 0; index < text.length; ++index) {
    const unit = text.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true
  }
  return false
}

const WORD_CHARACTER = /^[\p{L}\p{N}_]$/u

function isWordCharacter(value: string): boolean {
  return WORD_CHARACTER.test(value)
}

export function resolveWordSelectionRange(
  text: string,
  characterIndex: number,
): TextSelectionRange | null {
  if (!Number.isInteger(characterIndex) || characterIndex < 0 || characterIndex >= text.length) {
    return null
  }
  if (!isWordCharacter(text[characterIndex] ?? '')) return null

  let start = characterIndex
  let end = characterIndex + 1
  while (start > 0 && isWordCharacter(text[start - 1] ?? '')) start--
  while (end < text.length && isWordCharacter(text[end] ?? '')) end++
  return { start, end }
}
