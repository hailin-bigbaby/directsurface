export type ScrollAlign = 'start' | 'center' | 'end' | 'nearest'

export interface FixedVirtualRangeInput {
  itemCount: number
  itemSize: number
  viewportSize: number
  scrollOffset: number
  overscan?: number
}

export interface FixedVirtualRange {
  startIndex: number
  endIndex: number
  visibleStartIndex: number
  visibleEndIndex: number
  leadingPadding: number
  trailingPadding: number
  totalSize: number
  scrollOffset: number
}

export interface ScrollToFixedIndexInput {
  itemCount: number
  itemSize: number
  viewportSize: number
  currentOffset: number
  index: number
  align?: ScrollAlign
}

function emptyRange(totalSize: number, scrollOffset: number): FixedVirtualRange {
  return {
    startIndex: -1,
    endIndex: -1,
    visibleStartIndex: -1,
    visibleEndIndex: -1,
    leadingPadding: 0,
    trailingPadding: 0,
    totalSize,
    scrollOffset,
  }
}

export function clampScrollOffset(
  scrollOffset: number,
  viewportSize: number,
  contentSize: number,
): number {
  const viewport = finiteNonNegative(viewportSize)
  const content = finiteNonNegative(contentSize)
  const maxScroll = Math.max(0, content - viewport)
  const offset = scrollOffset === Number.POSITIVE_INFINITY
    ? maxScroll
    : finiteNonNegative(scrollOffset)
  return Math.max(0, Math.min(maxScroll, offset))
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function calcFixedVirtualRange(input: FixedVirtualRangeInput): FixedVirtualRange {
  const itemCount = Math.max(0, Math.floor(input.itemCount))
  const itemSize = input.itemSize
  const viewportSize = Math.max(0, input.viewportSize)
  const totalSize = itemCount * Math.max(0, itemSize)
  const scrollOffset = clampScrollOffset(input.scrollOffset, viewportSize, totalSize)

  if (itemCount === 0 || itemSize <= 0 || viewportSize <= 0) {
    return emptyRange(totalSize, scrollOffset)
  }

  const overscan = Math.max(0, Math.floor(input.overscan ?? 0))
  const visibleStartIndex = Math.max(0, Math.min(itemCount - 1, Math.floor(scrollOffset / itemSize)))
  const visibleEndIndex = Math.max(
    visibleStartIndex,
    Math.min(itemCount - 1, Math.ceil((scrollOffset + viewportSize) / itemSize) - 1),
  )
  const startIndex = Math.max(0, visibleStartIndex - overscan)
  const endIndex = Math.min(itemCount - 1, visibleEndIndex + overscan)

  return {
    startIndex,
    endIndex,
    visibleStartIndex,
    visibleEndIndex,
    leadingPadding: startIndex * itemSize,
    trailingPadding: Math.max(0, totalSize - (endIndex + 1) * itemSize),
    totalSize,
    scrollOffset,
  }
}

export function scrollToFixedIndex(input: ScrollToFixedIndexInput): number {
  const itemCount = Math.max(0, Math.floor(input.itemCount))
  const itemSize = input.itemSize
  const viewportSize = Math.max(0, input.viewportSize)
  const totalSize = itemCount * Math.max(0, itemSize)

  if (itemCount === 0 || itemSize <= 0 || viewportSize <= 0) {
    return 0
  }

  const index = Math.max(0, Math.min(itemCount - 1, Math.floor(input.index)))
  const align = input.align ?? 'nearest'
  const itemStart = index * itemSize
  const itemEnd = itemStart + itemSize
  const currentOffset = clampScrollOffset(input.currentOffset, viewportSize, totalSize)
  const viewportEnd = currentOffset + viewportSize

  let nextOffset = currentOffset
  if (align === 'start') {
    nextOffset = itemStart
  } else if (align === 'center') {
    nextOffset = itemStart - (viewportSize - itemSize) / 2
  } else if (align === 'end') {
    nextOffset = itemEnd - viewportSize
  } else if (itemStart < currentOffset) {
    nextOffset = itemStart
  } else if (itemEnd > viewportEnd) {
    nextOffset = itemEnd - viewportSize
  }

  return clampScrollOffset(nextOffset, viewportSize, totalSize)
}
