/** Small bounded LRU for derived rendering data. */
export class BoundedCache<K, V> {
  private readonly entries = new Map<K, V>()

  constructor(private readonly capacity: number) {}

  get(key: K): V | undefined {
    const value = this.entries.get(key)
    if (value !== undefined) {
      this.entries.delete(key)
      this.entries.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    if (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!)
  }

  clear(): void { this.entries.clear() }
}
