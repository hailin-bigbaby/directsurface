import { clampScrollOffset, type ScrollAlign } from './fixed_virtual_range'
import { PrefixSumIndex } from './prefix_sum_index'
import { normalizeVirtualSize, SizeCache } from './size_cache'

export interface VariableVirtualRange {
  startIndex: number
  endIndex: number
  visibleStartIndex: number
  visibleEndIndex: number
  leadingPadding: number
  trailingPadding: number
  totalSize: number
  scrollOffset: number
}

export interface VariableVirtualAnchor<K> {
  key: K
  index: number
  offsetWithinItem: number
}

function emptyRange(totalSize: number, scrollOffset: number): VariableVirtualRange {
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

export class VariableVirtualizer<K> {
  readonly sizeCache: SizeCache<K>
  private _prefixIndex: PrefixSumIndex
  private _keys: K[] = []

  constructor(opts: { estimatedItemSize: number }) {
    this.sizeCache = new SizeCache({ estimatedSize: opts.estimatedItemSize })
    this._prefixIndex = new PrefixSumIndex({ itemCount: 0 })
  }

  get prefixIndex(): PrefixSumIndex {
    return this._prefixIndex
  }

  get keys(): readonly K[] {
    return this._keys
  }

  get itemCount(): number {
    return this._keys.length
  }

  get totalSize(): number {
    return this.prefixIndex.total
  }

  setEstimatedItemSize(size: number): boolean {
    const next = normalizeVirtualSize(size)
    if (next === this.sizeCache.estimatedSize) return false
    const candidate = this._buildIndex(
      this._keys,
      key => this.sizeCache.hasMeasuredSize(key)
        ? this.sizeCache.getMeasuredSize(key) ?? 0
        : next,
    )
    this.sizeCache.setEstimatedSize(next)
    this._prefixIndex = candidate
    return true
  }

  syncItems(keys: readonly K[]): void {
    const nextKeys = [...keys]
    const candidate = this._buildIndex(
      nextKeys,
      key => this.sizeCache.getSizeForKey(key),
    )
    this._keys = nextKeys
    this.sizeCache.syncKeys(nextKeys)
    this._prefixIndex = candidate
  }

  getSize(index: number): number {
    return this.sizeCache.getSizeForIndex(index)
  }

  setMeasuredSize(key: K, size: number): boolean {
    const next = normalizeVirtualSize(size)
    if (
      this.sizeCache.hasMeasuredSize(key) &&
      this.sizeCache.getMeasuredSize(key) === next
    ) {
      return false
    }
    const index = this.sizeCache.getIndex(key)
    if (index >= 0) this.prefixIndex.setValue(index, next)
    this.sizeCache.setMeasuredSize(key, next)
    return true
  }

  setMeasuredSizeAt(index: number, size: number): boolean {
    const key = this.sizeCache.getKey(index)
    if (key === undefined) return false
    return this.setMeasuredSize(key, size)
  }

  invalidateKey(key: K): boolean {
    if (!this.sizeCache.hasMeasuredSize(key)) return false
    const index = this.sizeCache.getIndex(key)
    if (index >= 0) this.prefixIndex.setValue(index, this.sizeCache.estimatedSize)
    this.sizeCache.invalidateKey(key)
    return true
  }

  invalidateIndex(index: number): boolean {
    const key = this.sizeCache.getKey(index)
    if (key === undefined) return false
    return this.invalidateKey(key)
  }

  invalidateAll(): boolean {
    if (!this._keys.some(key => this.sizeCache.hasMeasuredSize(key))) {
      return this.sizeCache.invalidateAll()
    }
    const candidate = this._buildIndex(
      this._keys,
      () => this.sizeCache.estimatedSize,
    )
    this.sizeCache.invalidateAll()
    this._prefixIndex = candidate
    return true
  }

  captureAnchor(scrollOffset: number): VariableVirtualAnchor<K> | null {
    if (this._keys.length === 0) return null
    const clamped = clampScrollOffset(scrollOffset, 0, this.totalSize)
    const index = this.prefixIndex.findIndexAtOffset(clamped)
    if (index < 0) return null
    const key = this._keys[index]
    if (key === undefined) return null
    const itemStart = this.prefixIndex.offsetOf(index)
    return {
      key,
      index,
      offsetWithinItem: clamped - itemStart,
    }
  }

  preserveAnchor(anchor: VariableVirtualAnchor<K> | null, viewportSize: number): number {
    if (!anchor || this._keys.length === 0) return 0
    const fallbackIndex = Math.max(0, Math.min(this._keys.length - 1, anchor.index))
    const keyIndex = this.sizeCache.getIndex(anchor.key)
    const index = keyIndex >= 0 ? keyIndex : fallbackIndex
    const itemStart = this.prefixIndex.offsetOf(index)
    return clampScrollOffset(itemStart + anchor.offsetWithinItem, viewportSize, this.totalSize)
  }

  calcRange(opts: { viewportSize: number; scrollOffset: number; overscan?: number }): VariableVirtualRange {
    const viewportSize = Math.max(0, opts.viewportSize)
    const totalSize = this.totalSize
    const scrollOffset = clampScrollOffset(opts.scrollOffset, viewportSize, totalSize)

    if (this._keys.length === 0 || viewportSize <= 0 || totalSize <= 0) {
      return emptyRange(totalSize, scrollOffset)
    }

    const overscan = Math.max(0, Math.floor(opts.overscan ?? 0))
    const visibleStartIndex = this.prefixIndex.findIndexAtOffset(scrollOffset)
    const visibleEndIndex = this.prefixIndex.findIndexBeforeOffset(
      Math.max(scrollOffset, scrollOffset + viewportSize),
    )
    const startIndex = Math.max(0, visibleStartIndex - overscan)
    const endIndex = Math.min(this._keys.length - 1, visibleEndIndex + overscan)
    const leadingPadding = this.prefixIndex.offsetOf(startIndex)
    const trailingPadding = Math.max(0, totalSize - this.prefixIndex.offsetOf(endIndex + 1))

    return {
      startIndex,
      endIndex,
      visibleStartIndex,
      visibleEndIndex,
      leadingPadding,
      trailingPadding,
      totalSize,
      scrollOffset,
    }
  }

  scrollToIndex(opts: {
    index: number
    viewportSize: number
    currentOffset: number
    align?: ScrollAlign
  }): number {
    if (this._keys.length === 0 || opts.viewportSize <= 0) return 0
    const index = Math.max(0, Math.min(this._keys.length - 1, Math.floor(opts.index)))
    const align = opts.align ?? 'nearest'
    const itemStart = this.prefixIndex.offsetOf(index)
    const itemEnd = this.prefixIndex.offsetOf(index + 1)
    const currentOffset = clampScrollOffset(opts.currentOffset, opts.viewportSize, this.totalSize)
    const viewportEnd = currentOffset + opts.viewportSize
    const itemSize = itemEnd - itemStart

    let nextOffset = currentOffset
    if (align === 'start') {
      nextOffset = itemStart
    } else if (align === 'center') {
      nextOffset = itemStart - (opts.viewportSize - itemSize) / 2
    } else if (align === 'end') {
      nextOffset = itemEnd - opts.viewportSize
    } else if (itemStart < currentOffset) {
      nextOffset = itemStart
    } else if (itemEnd > viewportEnd) {
      nextOffset = itemEnd - opts.viewportSize
    }

    return clampScrollOffset(nextOffset, opts.viewportSize, this.totalSize)
  }

  private _buildIndex(
    keys: readonly K[],
    sizeForKey: (key: K) => number,
  ): PrefixSumIndex {
    const candidate = new PrefixSumIndex({ itemCount: keys.length })
    for (let index = 0; index < keys.length; index++) {
      candidate.setValue(index, sizeForKey(keys[index]!))
    }
    return candidate
  }
}
