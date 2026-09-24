export interface ChartLegendItemLayout {
  index: number
  x: number
  y: number
  width: number
  height: number
}

export function normalizeVisibleIndexes(count: number, indexes?: readonly number[]): number[] {
  if (indexes === undefined) return allIndexes(count)
  const result: number[] = []
  const seen = new Set<number>()
  for (const index of indexes) {
    if (!Number.isInteger(index) || index < 0 || index >= count || seen.has(index)) continue
    seen.add(index)
    result.push(index)
  }
  return result.sort((a, b) => a - b)
}

export function visibleIndexesOverride(count: number, indexes?: readonly number[]): number[] | undefined {
  if (indexes === undefined) return undefined
  const normalized = normalizeVisibleIndexes(count, indexes)
  return normalized.length === count ? undefined : normalized
}

export function hiddenIndexes(count: number, visibleIndexes: readonly number[]): number[] {
  const visible = new Set(visibleIndexes)
  const result: number[] = []
  for (let index = 0; index < count; index += 1) {
    if (!visible.has(index)) result.push(index)
  }
  return result
}

export function isVisibleIndex(count: number, visibleIndexes: readonly number[], index: number): boolean {
  return index >= 0 && index < count && visibleIndexes.includes(index)
}

export function toggleVisibleIndex(count: number, visibleIndexes: readonly number[], index: number): number[] {
  if (index < 0 || index >= count) return [...visibleIndexes]
  return visibleIndexes.includes(index)
    ? visibleIndexes.filter(item => item !== index)
    : normalizeVisibleIndexes(count, [...visibleIndexes, index])
}

export function sameVisibleIndexes(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

export function firstChangedVisibleIndex(count: number, previous: readonly number[], next: readonly number[]): number {
  const previousSet = new Set(previous)
  const nextSet = new Set(next)
  for (let index = 0; index < count; index += 1) {
    if (previousSet.has(index) !== nextSet.has(index)) return index
  }
  return -1
}

export function hitLegendItem(
  items: readonly ChartLegendItemLayout[],
  position: { x: number; y: number },
  globalOffset: { x: number; y: number },
): number {
  const local = {
    x: position.x - globalOffset.x,
    y: position.y - globalOffset.y,
  }
  return items.find(item => (
    local.x >= item.x &&
    local.x <= item.x + item.width &&
    local.y >= item.y &&
    local.y <= item.y + item.height
  ))?.index ?? -1
}

function allIndexes(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_item, index) => index)
}
