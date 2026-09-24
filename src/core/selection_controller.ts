export interface MoveDiscreteFocusOptions {
  extend?: boolean
  preserveSelection?: boolean
}

export interface ReplaceSelectedOptions {
  anchor?: number | null
  focus?: number | null
}

export class SelectionController {
  private _anchor: number | null
  private _focus: number | null
  private readonly _selectedItems = new Set<number>()

  constructor(opts?: { anchor?: number | null; focus?: number | null }) {
    this._anchor = opts?.anchor ?? null
    this._focus = opts?.focus ?? null
  }

  get anchor(): number | null { return this._anchor }
  get focus(): number | null { return this._focus }
  get start(): number {
    if (this._anchor === null || this._focus === null) return 0
    return Math.min(this._anchor, this._focus)
  }
  get end(): number {
    if (this._anchor === null || this._focus === null) return 0
    return Math.max(this._anchor, this._focus)
  }
  get hasRange(): boolean {
    return this._anchor !== null && this._focus !== null && this._anchor !== this._focus
  }
  get selectedItems(): Set<number> { return this._selectedItems }

  clearRange(value: number | null = null): void {
    this._anchor = value
    this._focus = value
  }

  collapse(index: number): void {
    this._anchor = index
    this._focus = index
  }

  setFocus(index: number | null): void {
    this._focus = index
    if (index === null) {
      if (this._selectedItems.size === 0) this._anchor = null
      return
    }
    if (this._anchor === null) this._anchor = index
  }

  setRange(anchor: number, focus: number): void {
    this._anchor = anchor
    this._focus = focus
  }

  setNormalizedRange(start: number, end: number): void {
    this._anchor = start
    this._focus = end
  }

  extendRange(index: number): void {
    if (this._anchor === null) this._anchor = this._focus ?? index
    this._focus = index
  }

  clampRange(min: number, max: number): void {
    if (this._anchor !== null) this._anchor = Math.max(min, Math.min(max, this._anchor))
    if (this._focus !== null) this._focus = Math.max(min, Math.min(max, this._focus))
  }

  clearSelected(opts?: ReplaceSelectedOptions): void {
    this._selectedItems.clear()
    this._anchor = opts?.anchor ?? null
    this._focus = opts?.focus ?? this._anchor
  }

  replaceSelected(indices: Iterable<number>, opts?: ReplaceSelectedOptions): void {
    this._selectedItems.clear()
    let last: number | null = null
    for (const index of indices) {
      this._selectedItems.add(index)
      last = index
    }
    const fallback = last
    this._focus = opts?.focus ?? (this._focus !== null && this._selectedItems.has(this._focus) ? this._focus : fallback)
    this._anchor = opts?.anchor ?? this._focus
    if (this._focus === null && this._selectedItems.size === 0) this._anchor = null
  }

  selectOnly(index: number): void {
    this._selectedItems.clear()
    this._selectedItems.add(index)
    this.collapse(index)
  }

  toggle(index: number): void {
    if (this._selectedItems.has(index)) this._selectedItems.delete(index)
    else this._selectedItems.add(index)
    this.collapse(index)
  }

  extendDiscreteRange(index: number): void {
    const anchor = this._anchor ?? this._focus ?? index
    this._anchor = anchor
    this._focus = index
    this._fillDiscreteRange(anchor, index)
  }

  selectAllDiscrete(count: number, opts?: { focus?: number | null }): void {
    if (count <= 0) {
      this.clearSelected()
      return
    }
    this._anchor = 0
    this._focus = opts?.focus ?? (count - 1)
    this._fillDiscreteRange(0, count - 1)
  }

  moveDiscreteFocus(delta: number, itemCount: number, opts?: MoveDiscreteFocusOptions): number | null {
    if (itemCount <= 0) {
      this.clearSelected()
      return null
    }
    const base = this._focus ?? -1
    const next = Math.max(0, Math.min(itemCount - 1, base + delta))
    if (opts?.extend) {
      this.extendDiscreteRange(next)
      return next
    }
    this._focus = next
    if (!opts?.preserveSelection) {
      this._selectedItems.clear()
      this._selectedItems.add(next)
      this._anchor = next
    } else if (this._anchor === null) {
      this._anchor = next
    }
    return next
  }

  clampDiscrete(maxExclusive: number): void {
    if (maxExclusive <= 0) {
      this.clearSelected()
      return
    }
    for (const index of [...this._selectedItems]) {
      if (index < 0 || index >= maxExclusive) this._selectedItems.delete(index)
    }
    if (this._focus !== null && (this._focus < 0 || this._focus >= maxExclusive)) {
      this._focus = maxExclusive - 1
    } else if (this._focus === null && this._selectedItems.size > 0) {
      this._focus = [...this._selectedItems].sort((a, b) => a - b)[0] ?? null
    }
    if (this._anchor !== null && (this._anchor < 0 || this._anchor >= maxExclusive)) {
      this._anchor = this._focus
    } else if (this._anchor === null && this._focus !== null) {
      this._anchor = this._focus
    }
  }

  private _fillDiscreteRange(a: number, b: number): void {
    const start = Math.min(a, b)
    const end = Math.max(a, b)
    this._selectedItems.clear()
    for (let index = start; index <= end; index++) this._selectedItems.add(index)
  }
}
