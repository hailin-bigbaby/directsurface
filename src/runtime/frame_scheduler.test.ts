import { describe, expect, it, vi } from 'vitest'
import { FrameScheduler, type RequestFrame } from './frame_scheduler'

describe('FrameScheduler', () => {
  it('ignores stale canceled callbacks and rejects requests after disposal', () => {
    const callbacks: FrameRequestCallback[] = []
    const render = vi.fn()
    const request = vi.fn((callback: FrameRequestCallback) => callbacks.push(callback))
    const scheduler = new FrameScheduler(render, request, vi.fn())
    scheduler.scheduleFrame()
    scheduler.cancelFrame()
    scheduler.scheduleFrame()
    callbacks[0]!(10)
    expect(render).not.toHaveBeenCalled()
    expect(scheduler.frameScheduled).toBe(true)
    scheduler.dispose()
    callbacks[1]!(20)
    scheduler.scheduleFrame()
    expect(render).not.toHaveBeenCalled()
    expect(scheduler.frameScheduled).toBe(false)
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('coalesces frame requests and runs the frame callback once', () => {
    let callback: FrameRequestCallback | undefined
    const onFrame = vi.fn()
    const requestFrame: RequestFrame = vi.fn((cb) => {
      callback = cb
      return 1
    })

    const scheduler = new FrameScheduler(onFrame, requestFrame)

    scheduler.scheduleFrame()
    scheduler.scheduleFrame()

    expect(requestFrame).toHaveBeenCalledTimes(1)
    expect(scheduler.frameScheduled).toBe(true)

    callback?.(123.5)

    expect(onFrame).toHaveBeenCalledTimes(1)
    expect(onFrame).toHaveBeenCalledWith(123.5)
    expect(scheduler.frameScheduled).toBe(false)
  })

  it('tracks layout invalidation until consumed', () => {
    const scheduler = new FrameScheduler(vi.fn(), vi.fn(() => 1))

    expect(scheduler.layoutNeeded).toBe(true)
    expect(scheduler.consumeLayoutNeeded()).toBe(true)
    expect(scheduler.consumeLayoutNeeded()).toBe(false)

    scheduler.scheduleLayout()

    expect(scheduler.layoutNeeded).toBe(true)
    expect(scheduler.consumeLayoutNeeded()).toBe(true)
  })

  it('can mark layout for the current frame without scheduling another frame', () => {
    const requestFrame = vi.fn(() => 1)
    const scheduler = new FrameScheduler(vi.fn(), requestFrame)
    scheduler.consumeLayoutNeeded()

    scheduler.markLayoutNeeded()

    expect(scheduler.layoutNeeded).toBe(true)
    expect(requestFrame).not.toHaveBeenCalled()
  })

  it('cancels a pending frame when disposed', () => {
    const cancelFrame = vi.fn()
    const scheduler = new FrameScheduler(vi.fn(), vi.fn(() => 7), cancelFrame)

    scheduler.scheduleFrame()
    scheduler.dispose()

    expect(cancelFrame).toHaveBeenCalledWith(7)
    expect(scheduler.frameScheduled).toBe(false)
  })

  it('can cancel a pending frame without disposing', () => {
    const cancelFrame = vi.fn()
    const scheduler = new FrameScheduler(vi.fn(), vi.fn(() => 9), cancelFrame)

    scheduler.scheduleFrame()
    scheduler.cancelFrame()

    expect(cancelFrame).toHaveBeenCalledWith(9)
    expect(scheduler.frameScheduled).toBe(false)
  })
})
