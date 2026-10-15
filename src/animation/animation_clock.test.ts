import { describe, expect, it, vi } from 'vitest'
import { AnimationClock } from './animation_clock'

describe('AnimationClock', () => {
  it('wakes on resume before evaluating potentially failing activity predicates', () => {
    const request = vi.fn()
    const clock = new AnimationClock(request)
    const healthy = vi.fn()
    clock.subscribe(vi.fn(), () => { throw new Error('activity failed') })
    clock.subscribe(healthy)
    clock.setSuspended(true)
    request.mockClear()
    expect(() => clock.setSuspended(false)).not.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
    expect(() => clock.tick(100)).toThrow('activity failed')
    expect(healthy).toHaveBeenCalledWith(0)
    expect(clock.subscriberCount).toBe(1)
  })
  it('isolates a failing activity predicate during sampling', () => {
    const clock = new AnimationClock()
    const good = vi.fn()
    clock.subscribe(vi.fn(), () => { throw new Error('visibility failed') })
    clock.subscribe(good)
    expect(() => clock.tick(0)).toThrow('visibility failed')
    expect(good).toHaveBeenCalledWith(0)
    expect(clock.subscriberCount).toBe(1)
    expect(clock.hasActiveAnimations).toBe(true)
  })

  it('removes a failing activity predicate when checking whether another frame is needed', () => {
    const clock = new AnimationClock()
    clock.subscribe(vi.fn(), () => { throw new Error('visibility failed') })
    clock.subscribe(vi.fn())
    expect(() => clock.hasActiveAnimations).toThrow('visibility failed')
    expect(clock.subscriberCount).toBe(1)
    expect(clock.hasActiveAnimations).toBe(true)
  })
  it.each([60, 120, 144])('uses elapsed time at %s Hz and catches up after a delayed frame', hz => {
    const clock = new AnimationClock()
    const samples: number[] = []
    clock.subscribe(t => samples.push(t))
    for (let i = 0; i <= hz; i++) clock.tick(i * 1000 / hz)
    expect(samples.at(-1)).toBeCloseTo(1000)
    expect(samples.every((time, i) => i === 0 || time > samples[i - 1]!)).toBe(true)
    clock.tick(1400)
    expect(samples.at(-1)).toBeCloseTo(1400)
  })

  it('pauses inactive subscriptions and resumes without including hidden time', () => {
    const clock = new AnimationClock()
    let active = true
    const tick = vi.fn()
    clock.subscribe(tick, () => active)
    clock.tick(0)
    clock.tick(20)
    active = false
    expect(clock.hasActiveAnimations).toBe(false)
    clock.tick(500)
    active = true
    clock.tick(1000)
    clock.tick(1020)
    expect(tick.mock.calls.map(call => call[0])).toEqual([0, 20, 20, 40])
  })

  it('wakes on resume and pauses all subscriptions while suspended', () => {
    const request = vi.fn()
    const clock = new AnimationClock(request)
    const tick = vi.fn()
    clock.subscribe(tick)
    clock.tick(10)
    clock.tick(30)
    clock.setSuspended(true)
    expect(clock.hasActiveAnimations).toBe(false)
    clock.tick(100)
    clock.setSuspended(false)
    clock.tick(1000)
    expect(request).toHaveBeenCalledTimes(2)
    expect(tick.mock.calls.map(call => call[0])).toEqual([0, 20, 20])
  })

  it('handles removal and addition during sampling without invoking stale callbacks', () => {
    const clock = new AnimationClock()
    const added = vi.fn()
    const removed = vi.fn()
    let remove = () => {}
    const first = clock.subscribe(() => { remove(); clock.subscribe(added); first() })
    remove = clock.subscribe(removed)
    clock.tick(0)
    expect(removed).not.toHaveBeenCalled()
    expect(added).not.toHaveBeenCalled()
    clock.tick(16)
    expect(added).toHaveBeenCalledWith(0)
  })

  it('removes failing subscriptions while sampling other animations', () => {
    const clock = new AnimationClock()
    const good = vi.fn()
    clock.subscribe(() => { throw new Error('animation failed') })
    clock.subscribe(good)
    expect(() => clock.tick(0)).toThrow('animation failed')
    expect(good).toHaveBeenCalledWith(0)
    expect(clock.subscriberCount).toBe(1)
    clock.dispose()
    clock.subscribe(good)
    clock.tick(16)
    expect(clock.hasActiveAnimations).toBe(false)
    expect(clock.subscriberCount).toBe(0)
    expect(good).toHaveBeenCalledTimes(1)
  })
})
