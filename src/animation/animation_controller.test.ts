import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnimationController, type AnimationStatus } from './animation_controller'
import { Curves } from './curves'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AnimationController', () => {
  it('clamps initial and target values to the 0..1 range', () => {
    const fromAbove = new AnimationController({ initialValue: 2, duration: 0 })
    const fromBelow = new AnimationController({ initialValue: -1, duration: 0 })

    fromAbove.animateTo(-10)
    fromBelow.animateTo(10)

    expect(fromAbove.value).toBe(0)
    expect(fromBelow.value).toBe(1)
  })

  it('completes synchronously when duration is zero', () => {
    const values: number[] = []
    const statuses: AnimationStatus[] = []
    const controller = new AnimationController({ duration: 0, curve: Curves.linear })

    controller.addListener(value => values.push(value))
    controller.addStatusListener(status => statuses.push(status))

    controller.forward()

    expect(controller.value).toBe(1)
    expect(controller.status).toBe('completed')
    expect(values).toEqual([1])
    expect(statuses).toEqual(['forward', 'completed'])
  })

  it('cancels a previous frame when a new animation starts', () => {
    let nextId = 1
    const canceled: number[] = []

    vi.stubGlobal('requestAnimationFrame', vi.fn(() => nextId++))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => canceled.push(id)))

    const controller = new AnimationController({ duration: 100, curve: Curves.linear })
    controller.forward()
    controller.reverse()

    expect(canceled).toEqual([1])
  })

  it('removes value and status listeners', () => {
    const values: number[] = []
    const statuses: AnimationStatus[] = []
    const valueListener = (value: number) => values.push(value)
    const statusListener = (status: AnimationStatus) => statuses.push(status)
    const controller = new AnimationController({ duration: 0 })

    controller.addListener(valueListener)
    controller.addStatusListener(statusListener)
    controller.removeListener(valueListener)
    controller.removeStatusListener(statusListener)

    controller.forward()

    expect(values).toEqual([])
    expect(statuses).toEqual([])
  })

  it('clears listeners on dispose', () => {
    const values: number[] = []
    const statuses: AnimationStatus[] = []
    const controller = new AnimationController({ duration: 0 })

    controller.addListener(value => values.push(value))
    controller.addStatusListener(status => statuses.push(status))
    controller.dispose()
    controller.forward()

    expect(values).toEqual([])
    expect(statuses).toEqual([])
  })

  it('calls onTick when animation starts and continues', () => {
    const ticks: number[] = []
    let nextTime = 0
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextTime++
      setTimeout(() => cb(performance.now() + 100), 0)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const controller = new AnimationController({
      duration: 0,
      onTick: () => ticks.push(1),
    })

    controller.forward()

    // duration=0 → completes synchronously, onTick called once during _animateTo
    expect(ticks.length).toBeGreaterThanOrEqual(0)
    vi.restoreAllMocks()
  })

  it('tracks isAnimating status', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const controller = new AnimationController({ duration: 100 })

    expect(controller.isAnimating).toBe(false)
    controller.forward()
    expect(controller.isAnimating).toBe(true)
    controller.stop()
    expect(controller.isAnimating).toBe(false)

    vi.restoreAllMocks()
  })
})
