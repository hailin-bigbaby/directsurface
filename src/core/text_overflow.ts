export function ellipsizeText(
  text: string,
  maxWidth: number,
  measureText: (text: string) => number,
): string {
  if (!text || maxWidth <= 0) return ''
  if (measureText(text) <= maxWidth) return text

  const ellipsis = '...'
  if (measureText(ellipsis) > maxWidth) return ''

  const chars = Array.from(text)
  let low = 0
  let high = chars.length
  let best = ''

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = `${chars.slice(0, mid).join('')}${ellipsis}`
    if (measureText(candidate) <= maxWidth) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return best
}
