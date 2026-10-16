import { describe, expect, it } from 'vitest'
import { BoundedCache } from './bounded_cache'

describe('bounded rendering cache', () => {
  it('evicts the least recently used entry without discarding hot entries', () => {
    const cache = new BoundedCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)
    cache.set('c', 3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    cache.set('a', 4)
    expect(cache.get('c')).toBe(3)
    expect(cache.get('a')).toBe(4)
    cache.clear()
    expect(cache.get('a')).toBeUndefined()
  })
})
