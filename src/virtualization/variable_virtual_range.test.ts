import { describe, expect, it } from 'vitest'
import { VariableVirtualizer } from './variable_virtual_range'

describe('VariableVirtualizer', () => {
  it('calculates visible and overscan ranges from mixed measured and estimated sizes', () => {
    const virtualizer = new VariableVirtualizer<string>({ estimatedItemSize: 20 })
    virtualizer.syncItems(['a', 'b', 'c', 'd', 'e'])
    virtualizer.setMeasuredSize('b', 30)
    virtualizer.setMeasuredSize('c', 10)
    virtualizer.setMeasuredSize('d', 40)

    expect(virtualizer.calcRange({
      viewportSize: 50,
      scrollOffset: 25,
      overscan: 1,
    })).toEqual({
      startIndex: 0,
      endIndex: 4,
      visibleStartIndex: 1,
      visibleEndIndex: 3,
      leadingPadding: 0,
      trailingPadding: 0,
      totalSize: 120,
      scrollOffset: 25,
    })
  })

  it('preserves the first visible anchor across reorder and remeasurement', () => {
    const virtualizer = new VariableVirtualizer<string>({ estimatedItemSize: 20 })
    virtualizer.syncItems(['a', 'b', 'c', 'd'])
    virtualizer.setMeasuredSize('b', 50)
    virtualizer.setMeasuredSize('c', 30)

    const anchor = virtualizer.captureAnchor(35)
    expect(anchor).toEqual({ key: 'b', index: 1, offsetWithinItem: 15 })

    virtualizer.syncItems(['c', 'a', 'b', 'd'])
    virtualizer.setMeasuredSize('c', 60)

    expect(virtualizer.preserveAnchor(anchor, 40)).toBe(95)
  })

  it('invalidates cached sizes back to the estimate', () => {
    const virtualizer = new VariableVirtualizer<string>({ estimatedItemSize: 24 })
    virtualizer.syncItems(['a', 'b', 'c'])
    virtualizer.setMeasuredSize('b', 40)
    virtualizer.setMeasuredSize('c', 10)

    expect(virtualizer.totalSize).toBe(74)

    virtualizer.invalidateIndex(2)
    expect(virtualizer.totalSize).toBe(88)

    virtualizer.invalidateKey('b')
    expect(virtualizer.totalSize).toBe(72)

    virtualizer.setMeasuredSize('a', 60)
    virtualizer.invalidateAll()
    expect(virtualizer.totalSize).toBe(72)
  })

  it('scrolls to indices using variable item geometry', () => {
    const virtualizer = new VariableVirtualizer<string>({ estimatedItemSize: 20 })
    virtualizer.syncItems(['a', 'b', 'c', 'd'])
    virtualizer.setMeasuredSize('b', 50)
    virtualizer.setMeasuredSize('d', 10)

    expect(virtualizer.scrollToIndex({
      index: 2,
      viewportSize: 20,
      currentOffset: 0,
      align: 'start',
    })).toBe(70)

    expect(virtualizer.scrollToIndex({
      index: 3,
      viewportSize: 60,
      currentOffset: 0,
      align: 'nearest',
    })).toBe(40)
  })

  it('keeps an oversized visible item stable under repeated nearest reveal', () => {
    const v = new VariableVirtualizer<string>({ estimatedItemSize: 50 })
    v.syncItems(['a', 'b', 'c'])
    v.setMeasuredSize('b', 300)
    expect(v.scrollToIndex({ index: 1, viewportSize: 100, currentOffset: 100 })).toBe(100)
    expect(v.scrollToIndex({ index: 1, viewportSize: 20, currentOffset: 0 })).toBe(50)
    expect(v.scrollToIndex({ index: 1, viewportSize: 20, currentOffset: 380 })).toBe(330)
    expect(v.scrollToIndex({ index: 1, viewportSize: 100, currentOffset: 100, align: 'start' })).toBe(50)
    expect(v.scrollToIndex({ index: 1, viewportSize: 100, currentOffset: 100, align: 'end' })).toBe(250)
  })

  it('treats a viewport end on a row boundary as strictly exclusive', () => {
    const virtualizer = new VariableVirtualizer<string>({
      estimatedItemSize: 20,
    })
    virtualizer.syncItems(['a', 'b', 'c', 'd'])

    expect(virtualizer.calcRange({
      viewportSize: 40,
      scrollOffset: 0,
    })).toEqual({
      startIndex: 0,
      endIndex: 1,
      visibleStartIndex: 0,
      visibleEndIndex: 1,
      leadingPadding: 0,
      trailingPadding: 40,
      totalSize: 80,
      scrollOffset: 0,
    })
  })

  it('keeps sync and measured-size overflow failures atomic', () => {
    const syncVirtualizer = new VariableVirtualizer<string>({
      estimatedItemSize: Number.MAX_VALUE,
    })
    syncVirtualizer.syncItems(['a'])
    const prefixBeforeSync = syncVirtualizer.prefixIndex

    expect(() => syncVirtualizer.syncItems(['a', 'b'])).toThrow(
      new RangeError('PrefixSumIndex total size must be finite'),
    )
    expect(syncVirtualizer.keys).toEqual(['a'])
    expect(syncVirtualizer.sizeCache.itemCount).toBe(1)
    expect(syncVirtualizer.sizeCache.getIndex('b')).toBe(-1)
    expect(syncVirtualizer.prefixIndex).toBe(prefixBeforeSync)
    expect(syncVirtualizer.totalSize).toBe(Number.MAX_VALUE)

    const measuredVirtualizer = new VariableVirtualizer<string>({
      estimatedItemSize: 1,
    })
    measuredVirtualizer.syncItems(['a', 'b'])
    measuredVirtualizer.setMeasuredSize('a', Number.MAX_VALUE)
    const prefixBeforeMeasurement = measuredVirtualizer.prefixIndex

    expect(() => measuredVirtualizer.setMeasuredSize(
      'b',
      Number.MAX_VALUE,
    )).toThrow(
      new RangeError('PrefixSumIndex total size must be finite'),
    )
    expect(measuredVirtualizer.sizeCache.hasMeasuredSize('b')).toBe(false)
    expect(measuredVirtualizer.prefixIndex).toBe(prefixBeforeMeasurement)
    expect(measuredVirtualizer.prefixIndex.getValue(1)).toBe(1)
    expect(measuredVirtualizer.totalSize).toBe(Number.MAX_VALUE)
  })

  it('keeps estimate and invalidation overflow failures atomic', () => {
    const estimateVirtualizer = new VariableVirtualizer<string>({
      estimatedItemSize: 1,
    })
    estimateVirtualizer.syncItems(['a', 'b'])
    estimateVirtualizer.setMeasuredSize('a', Number.MAX_VALUE)
    const prefixBeforeEstimate = estimateVirtualizer.prefixIndex

    expect(() => estimateVirtualizer.setEstimatedItemSize(
      Number.MAX_VALUE,
    )).toThrow(
      new RangeError('PrefixSumIndex total size must be finite'),
    )
    expect(estimateVirtualizer.sizeCache.estimatedSize).toBe(1)
    expect(estimateVirtualizer.prefixIndex).toBe(prefixBeforeEstimate)
    expect(estimateVirtualizer.totalSize).toBe(Number.MAX_VALUE)

    const invalidateVirtualizer = new VariableVirtualizer<string>({
      estimatedItemSize: 1,
    })
    invalidateVirtualizer.syncItems(['a', 'b'])
    invalidateVirtualizer.setMeasuredSize('a', 1)
    invalidateVirtualizer.setMeasuredSize('b', 1)
    invalidateVirtualizer.setEstimatedItemSize(Number.MAX_VALUE)
    const prefixBeforeInvalidation = invalidateVirtualizer.prefixIndex

    expect(() => invalidateVirtualizer.invalidateAll()).toThrow(
      new RangeError('PrefixSumIndex total size must be finite'),
    )
    expect(invalidateVirtualizer.sizeCache.hasMeasuredSize('a')).toBe(true)
    expect(invalidateVirtualizer.sizeCache.hasMeasuredSize('b')).toBe(true)
    expect(invalidateVirtualizer.prefixIndex).toBe(prefixBeforeInvalidation)
    expect(invalidateVirtualizer.totalSize).toBe(2)
  })
})
