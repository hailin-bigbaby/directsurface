import { clampScrollOffset, scrollToFixedIndex, type ScrollAlign } from './fixed_virtual_range'

export interface ScrollBounds {
  viewportSize: number
  contentSize: number
}

export type ScrollAxis = 'x' | 'y'

export interface ScrollToIndexBounds {
  itemCount: number
  itemSize: number
  viewportSize: number
  index: number
  align?: ScrollAlign
}

export interface ScrollControllerOptions {
  axis?: ScrollAxis
  initialOffset?: number
  initialScrollX?: number
  initialScrollY?: number
  onChange?: (offset: number) => void
}

export class ScrollController {
  private readonly _axis: ScrollAxis
  private _scrollX = 0
  private _scrollY = 0
  onChange?: (offset: number) => void

  constructor(opts: ScrollControllerOptions = {}) {
    this._axis = opts.axis ?? 'y'
    this._scrollX = finiteNonNegative(opts.initialScrollX ?? (this._axis === 'x' ? opts.initialOffset ?? 0 : 0))
    this._scrollY = finiteNonNegative(opts.initialScrollY ?? (this._axis === 'y' ? opts.initialOffset ?? 0 : 0))
    this.onChange = opts.onChange
  }

  get axis(): ScrollAxis {
    return this._axis
  }

  get offset(): number {
    return this._getAxisOffset(this._axis)
  }

  get scrollX(): number {
    return this._scrollX
  }

  get scrollY(): number {
    return this._scrollY
  }

  setOffset(offset: number, bounds: ScrollBounds): number {
    return this._setAxisOffset(this._axis, offset, bounds)
  }

  setScrollX(offset: number, bounds: ScrollBounds): number {
    return this._setAxisOffset('x', offset, bounds)
  }

  setScrollY(offset: number, bounds: ScrollBounds): number {
    return this._setAxisOffset('y', offset, bounds)
  }

  scrollBy(delta: number, bounds: ScrollBounds): number {
    return this.setOffset(this.offset + delta, bounds)
  }

  scrollByX(delta: number, bounds: ScrollBounds): number {
    return this.setScrollX(this._scrollX + delta, bounds)
  }

  scrollByY(delta: number, bounds: ScrollBounds): number {
    return this.setScrollY(this._scrollY + delta, bounds)
  }

  scrollToIndex(input: ScrollToIndexBounds): number {
    return this._commitAxis(this._axis, scrollToFixedIndex({
      itemCount: input.itemCount,
      itemSize: input.itemSize,
      viewportSize: input.viewportSize,
      currentOffset: this.offset,
      index: input.index,
      align: input.align,
    }))
  }

  private _getAxisOffset(axis: ScrollAxis): number {
    return axis === 'x' ? this._scrollX : this._scrollY
  }

  private _setAxisOffset(axis: ScrollAxis, offset: number, bounds: ScrollBounds): number {
    return this._commitAxis(axis, clampScrollOffset(offset, bounds.viewportSize, bounds.contentSize))
  }

  private _commitAxis(axis: ScrollAxis, offset: number): number {
    if (axis === 'x') {
      if (offset === this._scrollX) return this._scrollX
      this._scrollX = offset
    } else {
      if (offset === this._scrollY) return this._scrollY
      this._scrollY = offset
    }
    if (axis === this._axis) this.onChange?.(offset)
    return offset
  }
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}
