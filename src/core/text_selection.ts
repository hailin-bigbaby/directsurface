export interface TextSelectionRange {
  start: number
  end: number
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
