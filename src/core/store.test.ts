import { describe, expect, it, vi } from 'vitest'
import { Store } from './store'

describe('Store', () => {
  it('notifies selector listeners only when the selected value changes', () => {
    const store = new Store({ count: 0, label: 'zero' })
    const listener = vi.fn()

    store.subscribeSelector(state => state.count, listener)

    store.setState({ label: 'same-count' })
    expect(listener).not.toHaveBeenCalled()

    store.setState({ count: 1 })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not retain an incomplete registration when the initial selector fails', () => {
    const store = new Store({ count: 0, label: 'zero' })
    const selectorError = new Error('selector failed')
    let shouldThrow = true
    const selector = (state: { count: number; label: string }): number => {
      if (shouldThrow) {
        shouldThrow = false
        throw selectorError
      }
      return state.count
    }

    expect(() => store.subscribeSelector(selector, vi.fn())).toThrow(
      selectorError,
    )

    const listener = vi.fn()
    store.subscribeSelector(selector, listener)
    store.setState({ label: 'updated' })

    expect(listener).not.toHaveBeenCalled()

    store.setState({ count: 1 })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps selector cache while listeners remain and clears it after the last unsubscribe', () => {
    const store = new Store({ count: 0 })
    const selector = (state: { count: number }) => state.count
    const first = vi.fn()
    const second = vi.fn()

    const unsubscribeFirst = store.subscribeSelector(selector, first)
    const unsubscribeSecond = store.subscribeSelector(selector, second)

    expect((store as any)._selectorListeners.get(selector)?.size).toBe(2)
    expect((store as any)._selectorCache.has(selector)).toBe(true)

    unsubscribeFirst()

    expect((store as any)._selectorListeners.get(selector)?.size).toBe(1)
    expect((store as any)._selectorCache.has(selector)).toBe(true)

    store.setState({ count: 1 })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)

    unsubscribeSecond()

    expect((store as any)._selectorListeners.has(selector)).toBe(false)
    expect((store as any)._selectorCache.has(selector)).toBe(false)
  })

  it('makes selector unsubscribe idempotent', () => {
    const store = new Store({ count: 0 })
    const selector = (state: { count: number }) => state.count
    const listener = vi.fn()
    const unsubscribe = store.subscribeSelector(selector, listener)

    unsubscribe()
    unsubscribe()
    store.setState({ count: 1 })

    expect(listener).not.toHaveBeenCalled()
    expect((store as any)._selectorListeners.has(selector)).toBe(false)
    expect((store as any)._selectorCache.has(selector)).toBe(false)
  })

  it('notifies once after a batch while exposing each intermediate state', () => {
    const store = new Store({ count: 0, label: 'zero' })
    const listener = vi.fn()
    const observed: number[] = []
    store.subscribe(listener)

    const result = store.batchUpdate(() => {
      store.setState({ count: 1 })
      observed.push(store.state.count)
      store.setState({ count: 2 })
      observed.push(store.state.count)
      return 'completed'
    })

    expect(result).toBe('completed')
    expect(observed).toEqual([1, 2])
    expect(store.state.count).toBe(2)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('uses observer snapshots and advances selector caches when a listener fails', () => {
    const store = new Store({ count: 0, label: 'zero' })
    const calls: string[] = []
    const firstError = new Error('first listener failed')
    const lateListener = vi.fn()
    const selectorListener = vi.fn(() => calls.push('selector'))
    const countSelector = (state: { count: number; label: string }) => state.count
    let unsubscribeSecond = (): void => {}

    const unsubscribeFirst = store.subscribe(() => {
      calls.push('first')
      unsubscribeSecond()
      store.subscribe(lateListener)
      throw firstError
    })
    unsubscribeSecond = store.subscribe(() => calls.push('second'))
    store.subscribeSelector(countSelector, selectorListener)

    expect(() => store.setState({ count: 1 })).toThrow(firstError)
    expect(calls).toEqual(['first', 'second', 'selector'])
    expect(lateListener).not.toHaveBeenCalled()
    expect(selectorListener).toHaveBeenCalledTimes(1)

    unsubscribeFirst()
    store.setState({ label: 'updated' })

    expect(selectorListener).toHaveBeenCalledTimes(1)
  })

  it('supports nested batches and flushes only at the outer boundary', () => {
    const store = new Store({ count: 0, label: 'zero' })
    const listener = vi.fn()
    store.subscribe(listener)

    store.batchUpdate(() => {
      store.setState({ count: 1 })
      store.batchUpdate(() => {
        store.setState({ label: 'one' })
        store.setState({ count: 2 })
      })
      expect(listener).not.toHaveBeenCalled()
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.state).toEqual({ count: 2, label: 'one' })
  })

  it('compares selector values only against the final batched state', () => {
    const store = new Store({ count: 0, label: 'zero' })
    const countSelector = (state: { count: number; label: string }) => state.count
    const labelSelector = (state: { count: number; label: string }) => state.label
    const countListener = vi.fn()
    const labelListener = vi.fn()
    store.subscribeSelector(countSelector, countListener)
    store.subscribeSelector(labelSelector, labelListener)

    store.batchUpdate(() => {
      store.setState({ count: 1 })
      store.setState({ count: 0 })
      store.setState({ label: 'updated' })
    })

    expect(countListener).not.toHaveBeenCalled()
    expect(labelListener).toHaveBeenCalledTimes(1)
  })

  it('restores batching after a callback throws and still flushes committed changes', () => {
    const store = new Store({ count: 0 })
    const listener = vi.fn()
    store.subscribe(listener)

    expect(() => {
      store.batchUpdate(() => {
        store.setState({ count: 1 })
        throw new Error('failed')
      })
    }).toThrow('failed')

    expect(store.state.count).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)

    store.setState({ count: 2 })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('preserves a batch callback failure when flushing listeners also fails', () => {
    const store = new Store({ count: 0 })
    const callbackError = new Error('batch callback failed')
    store.subscribe(() => {
      throw new Error('listener failed')
    })

    let thrown: unknown
    try {
      store.batchUpdate(() => {
        store.setState({ count: 1 })
        throw callbackError
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(callbackError)
    expect(store.state.count).toBe(1)
  })

  it('rejects native async batch callbacks before they can mutate state', () => {
    const store = new Store({ count: 0 })
    const listener = vi.fn()
    store.subscribe(listener)

    expect(() => store.batchUpdate(async () => {
      store.setState({ count: 1 })
    })).toThrow('Store.batchUpdate() callback must be synchronous.')

    expect(store.state.count).toBe(0)
    expect(listener).not.toHaveBeenCalled()

    store.setState({ count: 2 })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('consumes rejection from a non-async callback that returns a promise', async () => {
    const store = new Store({ count: 0 })
    const listener = vi.fn()
    store.subscribe(listener)

    expect(() => store.batchUpdate(() => {
      store.setState({ count: 1 })
      return Promise.reject(new Error('late batch failure'))
    })).toThrow('Store.batchUpdate() callback must be synchronous.')

    await Promise.resolve()
    expect(store.state.count).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('uses Object.is semantics for selector values', () => {
    const store = new Store({ value: Number.NaN })
    const selector = (state: { value: number }) => state.value
    const listener = vi.fn()
    store.subscribeSelector(selector, listener)

    store.setState({ value: 1 })
    store.setState({ value: Number.NaN })
    listener.mockClear()
    store.setState({ value: 0 })
    store.setState({ value: -0 })

    expect(listener).toHaveBeenCalledTimes(2)
  })
})
