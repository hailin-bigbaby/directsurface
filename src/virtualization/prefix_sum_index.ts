import { normalizeVirtualSize } from './size_cache'

const NON_FINITE_TOTAL_MESSAGE =
  'PrefixSumIndex total size must be finite'

export class PrefixSumIndex {
  private _values: number[] = []
  private _tree: number[] = [0]

  constructor(opts: { itemCount: number; initialValue?: number }) {
    this.reset(opts.itemCount, opts.initialValue ?? 0)
  }

  get itemCount(): number {
    return this._values.length
  }

  get total(): number {
    return this.prefixSum(this._values.length)
  }

  reset(itemCount: number, initialValue = 0): void {
    const count = Math.max(0, Math.floor(itemCount))
    const value = normalizeVirtualSize(initialValue)
    assertFiniteTotal(count * value)
    const values = Array.from({ length: count }, () => value)
    const tree = Array.from({ length: count + 1 }, () => 0)
    for (let index = 0; index < count; index++) {
      addToTree(tree, index, value)
    }
    this._values = values
    this._tree = tree
  }

  getValue(index: number): number {
    if (index < 0 || index >= this._values.length) return 0
    return this._values[index] ?? 0
  }

  setValue(index: number, value: number): boolean {
    if (index < 0 || index >= this._values.length) return false
    const next = normalizeVirtualSize(value)
    const prev = this._values[index] ?? 0
    if (prev === next) return false
    assertFiniteTotal(this.total - prev + next)
    const updates = collectTreeUpdates(this._tree, index, next - prev)
    this._values[index] = next
    for (const update of updates) {
      this._tree[update.index] = update.value
    }
    return true
  }

  prefixSum(endExclusive: number): number {
    let index = Math.max(0, Math.min(this._values.length, Math.floor(endExclusive)))
    let total = 0
    while (index > 0) {
      total += this._tree[index] ?? 0
      index -= index & -index
    }
    return total
  }

  rangeSum(start: number, endExclusive: number): number {
    const from = Math.max(0, Math.min(this._values.length, Math.floor(start)))
    const to = Math.max(from, Math.min(this._values.length, Math.floor(endExclusive)))
    return this.prefixSum(to) - this.prefixSum(from)
  }

  offsetOf(index: number): number {
    return this.prefixSum(index)
  }

  findIndexAtOffset(offset: number): number {
    if (this._values.length === 0) return -1
    const total = this.total
    if (total <= 0) return 0
    const target = Math.max(0, Math.min(offset, total - Number.EPSILON))
    let treeIndex = 0
    let accumulated = 0
    let bit = 1
    while ((bit << 1) <= this._values.length) bit <<= 1
    while (bit > 0) {
      const next = treeIndex + bit
      if (next <= this._values.length && accumulated + (this._tree[next] ?? 0) <= target) {
        accumulated += this._tree[next] ?? 0
        treeIndex = next
      }
      bit >>= 1
    }
    return Math.min(treeIndex, this._values.length - 1)
  }

  findIndexBeforeOffset(endExclusive: number): number {
    if (
      this._values.length === 0 ||
      Number.isNaN(endExclusive) ||
      endExclusive <= 0
    ) {
      return -1
    }
    const total = this.total
    if (total <= 0) return -1
    const target = endExclusive === Number.POSITIVE_INFINITY
      ? total
      : Math.min(endExclusive, total)
    let treeIndex = 0
    let accumulated = 0
    let bit = 1
    while ((bit << 1) <= this._values.length) bit <<= 1
    while (bit > 0) {
      const next = treeIndex + bit
      const nextTotal = accumulated + (this._tree[next] ?? 0)
      if (next <= this._values.length && nextTotal < target) {
        accumulated = nextTotal
        treeIndex = next
      }
      bit >>= 1
    }
    return Math.min(treeIndex, this._values.length - 1)
  }
}

interface TreeUpdate {
  readonly index: number
  readonly value: number
}

function assertFiniteTotal(total: number): void {
  if (!Number.isFinite(total)) {
    throw new RangeError(NON_FINITE_TOTAL_MESSAGE)
  }
}

function addToTree(
  tree: number[],
  index: number,
  delta: number,
): void {
  let treeIndex = index + 1
  while (treeIndex < tree.length) {
    const next = (tree[treeIndex] ?? 0) + delta
    assertFiniteTotal(next)
    tree[treeIndex] = next
    treeIndex += treeIndex & -treeIndex
  }
}

function collectTreeUpdates(
  tree: readonly number[],
  index: number,
  delta: number,
): readonly TreeUpdate[] {
  const updates: TreeUpdate[] = []
  let treeIndex = index + 1
  while (treeIndex < tree.length) {
    const next = (tree[treeIndex] ?? 0) + delta
    if (!Number.isFinite(next) || next < 0) {
      throw new RangeError(NON_FINITE_TOTAL_MESSAGE)
    }
    updates.push({ index: treeIndex, value: next })
    treeIndex += treeIndex & -treeIndex
  }
  return updates
}
