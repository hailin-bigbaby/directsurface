export function normalizeVirtualSize(size: number): number {
  return Number.isFinite(size) && size > 0 ? size : 0
}

export class SizeCache<K> {
  private _estimatedSize: number
  private _keys: K[] = []
  private _indexByKey = new Map<K, number>()
  private _measuredSizes = new Map<K, number>()

  constructor(opts: { estimatedSize: number }) {
    this._estimatedSize = normalizeVirtualSize(opts.estimatedSize)
  }

  get estimatedSize(): number {
    return this._estimatedSize
  }

  get itemCount(): number {
    return this._keys.length
  }

  setEstimatedSize(size: number): boolean {
    const next = normalizeVirtualSize(size)
    if (next === this._estimatedSize) return false
    this._estimatedSize = next
    return true
  }

  syncKeys(keys: readonly K[]): void {
    this._keys = [...keys]
    this._indexByKey.clear()
    for (let index = 0; index < this._keys.length; index++) {
      this._indexByKey.set(this._keys[index]!, index)
    }
  }

  getKey(index: number): K | undefined {
    if (index < 0 || index >= this._keys.length) return undefined
    return this._keys[index]
  }

  getIndex(key: K): number {
    return this._indexByKey.get(key) ?? -1
  }

  hasMeasuredSize(key: K): boolean {
    return this._measuredSizes.has(key)
  }

  getMeasuredSize(key: K): number | undefined {
    return this._measuredSizes.get(key)
  }

  getSizeForKey(key: K): number {
    return this._measuredSizes.get(key) ?? this._estimatedSize
  }

  getSizeForIndex(index: number): number {
    const key = this.getKey(index)
    return key === undefined ? this._estimatedSize : this.getSizeForKey(key)
  }

  setMeasuredSize(key: K, size: number): boolean {
    const next = normalizeVirtualSize(size)
    if (this._measuredSizes.get(key) === next) return false
    this._measuredSizes.set(key, next)
    return true
  }

  setMeasuredSizeAt(index: number, size: number): boolean {
    const key = this.getKey(index)
    if (key === undefined) return false
    return this.setMeasuredSize(key, size)
  }

  invalidateKey(key: K): boolean {
    return this._measuredSizes.delete(key)
  }

  invalidateIndex(index: number): boolean {
    const key = this.getKey(index)
    if (key === undefined) return false
    return this.invalidateKey(key)
  }

  invalidateAll(): boolean {
    if (this._measuredSizes.size === 0) return false
    this._measuredSizes.clear()
    return true
  }

  sizes(): number[] {
    return this._keys.map((_, index) => this.getSizeForIndex(index))
  }
}
