import { describe, expect, it, vi } from 'vitest'
import { DispatchPhase, HitTestResult, type HitTestTarget, type PointerEvent } from './hit_test'
import { PointerDispatchSessions } from './pointer_dispatch_session'
import { PointerPathDispatcher } from './pointer_path_dispatcher'

function pointerEvent(
  type: PointerEvent['type'],
  x: number,
  y: number,
): PointerEvent {
  return {
    pointerId: 1,
    position: { x, y },
    type,
    button: 0,
    pointerType: 'mouse',
  }
}

describe('PointerPathDispatcher', () => {
  it('recomputes local positions from the current global position and live coordinate space', () => {
    const sessions = new PointerDispatchSessions()
    const dispatcher = new PointerPathDispatcher(sessions)
    const coordinateSpace = { globalOffset: { x: 10, y: 20 } }
    const target: HitTestTarget = {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onPointerCancel: vi.fn(),
    }
    const entry = {
      target,
      localPosition: { x: 5, y: 5 },
      coordinateSpace,
    }
    const path = new HitTestResult()
    path.add(entry)

    dispatcher.dispatchToPath(path, pointerEvent('down', 15, 25))
    coordinateSpace.globalOffset = { x: 20, y: 30 }
    dispatcher.dispatchToPath(path, pointerEvent('move', 35, 50))
    dispatcher.dispatchToPath(path, pointerEvent('up', 40, 55))
    dispatcher.dispatchToPath(path, pointerEvent('cancel', 45, 60))

    expect(target.onPointerMove).toHaveBeenCalledWith(expect.objectContaining({
      localPosition: { x: 15, y: 20 },
      hitTestEntry: entry,
    }))
    expect(target.onPointerUp).toHaveBeenCalledWith(expect.objectContaining({
      localPosition: { x: 20, y: 25 },
    }))
    expect(target.onPointerCancel).toHaveBeenCalledWith(expect.objectContaining({
      localPosition: { x: 25, y: 30 },
    }))
  })

  it('keeps legacy entries moving relative to their pointer-down local position', () => {
    const sessions = new PointerDispatchSessions()
    const dispatcher = new PointerPathDispatcher(sessions)
    const target: HitTestTarget = {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
    }
    const path = new HitTestResult()
    path.add({ target, localPosition: { x: 2, y: 3 } })

    dispatcher.dispatchToPath(path, pointerEvent('down', 12, 13))
    dispatcher.dispatchToPath(path, pointerEvent('move', 20, 30))

    expect(target.onPointerDown).toHaveBeenCalledWith(expect.objectContaining({
      localPosition: { x: 2, y: 3 },
    }))
    expect(target.onPointerMove).toHaveBeenCalledWith(expect.objectContaining({
      localPosition: { x: 10, y: 20 },
    }))
  })

  it('anchors legacy local coordinates on down even when the entry has no down handler', () => {
    const sessions = new PointerDispatchSessions()
    const dispatcher = new PointerPathDispatcher(sessions)
    const target: HitTestTarget = {
      onPointerMove: vi.fn(),
    }
    const path = new HitTestResult()
    path.add({ target, localPosition: { x: 2, y: 3 } })

    dispatcher.dispatchToPath(path, pointerEvent('down', 12, 13))
    dispatcher.dispatchToPath(path, pointerEvent('move', 20, 30))

    expect(target.onPointerMove).toHaveBeenCalledWith(expect.objectContaining({
      localPosition: { x: 10, y: 20 },
    }))
  })

  it('keeps legacy coordinate references isolated between pointers', () => {
    const sessions = new PointerDispatchSessions()
    const dispatcher = new PointerPathDispatcher(sessions)
    const moves: Array<{ pointerId: number; x: number; y: number }> = []
    const target: HitTestTarget = {
      onPointerMove: event => moves.push({
        pointerId: event.pointerId,
        x: event.localPosition!.x,
        y: event.localPosition!.y,
      }),
    }
    const path = new HitTestResult()
    path.add({ target, localPosition: { x: 2, y: 3 } })

    dispatcher.dispatchToPath(path, {
      ...pointerEvent('down', 12, 13),
      pointerId: 1,
    })
    dispatcher.dispatchToPath(path, {
      ...pointerEvent('down', 102, 103),
      pointerId: 2,
    })
    dispatcher.dispatchToPath(path, {
      ...pointerEvent('move', 20, 30),
      pointerId: 1,
    })

    expect(moves).toEqual([{ pointerId: 1, x: 10, y: 20 }])
  })

  it('captures the full ancestor path and preserves semantic entry identity', () => {
    const sessions = new PointerDispatchSessions()
    const dispatcher = new PointerPathDispatcher(sessions)
    const calls: string[] = []
    const root: HitTestTarget = {
      onPointerDownCapture: event => calls.push(`root-down:${event.phase}`),
      onPointerMoveCapture: event => calls.push(`root-move:${event.localPosition?.x}`),
    }
    const child: HitTestTarget = {
      onPointerDown: event => {
        calls.push(`child-down:${event.phase}`)
        event.setPointerCapture?.()
      },
      onPointerMove: event => calls.push(`child-move:${event.localPosition?.x}`),
    }
    const rootEntry = {
      target: root,
      localPosition: { x: 20, y: 20 },
      coordinateSpace: { globalOffset: { x: 0, y: 0 } },
    }
    const childEntry = {
      target: child,
      localPosition: { x: 10, y: 10 },
      key: 'stepper-up',
      coordinateSpace: { globalOffset: { x: 10, y: 10 } },
    }
    const path = new HitTestResult()
    path.add(rootEntry)
    path.add(childEntry)

    dispatcher.dispatchToPath(path, pointerEvent('down', 20, 20))

    expect(sessions.getCaptureEntry(1)).toBe(childEntry)
    expect(sessions.getCapturePath(1)?.path).toEqual([rootEntry, childEntry])

    dispatcher.dispatchToCapturedTarget(child, pointerEvent('move', 40, 40))

    expect(calls).toEqual([
      `root-down:${DispatchPhase.Capture}`,
      `child-down:${DispatchPhase.Target}`,
      'root-move:40',
      'child-move:30',
    ])
  })

  it('keeps an outer stopPropagation decision across a nested dispatch', () => {
    const sessions = new PointerDispatchSessions()
    const dispatcher = new PointerPathDispatcher(sessions)
    const rootDown = vi.fn()
    const root: HitTestTarget = { onPointerDown: rootDown }
    const child: HitTestTarget = {
      onPointerDown: event => {
        event.stopPropagation?.()
        dispatcher.dispatchToPath(path, pointerEvent('move', 2, 2))
      },
      onPointerMove: vi.fn(),
    }
    const path = new HitTestResult()
    path.add({ target: root, localPosition: { x: 1, y: 1 } })
    path.add({ target: child, localPosition: { x: 1, y: 1 } })

    dispatcher.dispatchToPath(path, pointerEvent('down', 1, 1))

    expect(rootDown).not.toHaveBeenCalled()
  })

  it('does not let a nested stopPropagation truncate its outer dispatch', () => {
    const sessions = new PointerDispatchSessions()
    const dispatcher = new PointerPathDispatcher(sessions)
    const rootDown = vi.fn()
    const root: HitTestTarget = { onPointerDown: rootDown }
    const child: HitTestTarget = {
      onPointerDown: () => {
        dispatcher.dispatchToPath(path, pointerEvent('move', 2, 2))
      },
      onPointerMove: event => event.stopPropagation?.(),
    }
    const path = new HitTestResult()
    path.add({ target: root, localPosition: { x: 1, y: 1 } })
    path.add({ target: child, localPosition: { x: 1, y: 1 } })

    dispatcher.dispatchToPath(path, pointerEvent('down', 1, 1))

    expect(rootDown).toHaveBeenCalledTimes(1)
  })

  it('keeps activation propagation frames isolated across nested dispatches', () => {
    const sessions = new PointerDispatchSessions()
    const dispatcher = new PointerPathDispatcher(sessions)
    const rootClicks: number[] = []
    const root: HitTestTarget = {
      onPointerActivate: event => rootClicks.push(event.clickCount),
    }
    const child: HitTestTarget = {
      onPointerActivate: event => {
        if (event.clickCount !== 1) return
        event.stopPropagation()
        dispatcher.dispatchActivationToPath(path, childEntry, activationEvent(2))
      },
    }
    const childEntry = { target: child, localPosition: { x: 1, y: 1 } }
    const path = new HitTestResult()
    path.add({ target: root, localPosition: { x: 1, y: 1 } })
    path.add(childEntry)

    dispatcher.dispatchActivationToPath(path, childEntry, activationEvent(1))

    expect(rootClicks).toEqual([2])
  })

  it('does not let nested activation propagation stop its outer frame', () => {
    const sessions = new PointerDispatchSessions()
    const dispatcher = new PointerPathDispatcher(sessions)
    const rootClicks: number[] = []
    const root: HitTestTarget = {
      onPointerActivate: event => rootClicks.push(event.clickCount),
    }
    const child: HitTestTarget = {
      onPointerActivate: event => {
        if (event.clickCount === 1) {
          dispatcher.dispatchActivationToPath(path, childEntry, activationEvent(2))
        } else {
          event.stopPropagation()
        }
      },
    }
    const childEntry = { target: child, localPosition: { x: 1, y: 1 } }
    const path = new HitTestResult()
    path.add({ target: root, localPosition: { x: 1, y: 1 } })
    path.add(childEntry)

    dispatcher.dispatchActivationToPath(path, childEntry, activationEvent(1))

    expect(rootClicks).toEqual([1])
  })

  it('aborts an obsolete path after a handler replaces the pointer sequence', () => {
    const sessions = new PointerDispatchSessions()
    const dispatcher = new PointerPathDispatcher(sessions)
    const childDown = vi.fn()
    const root: HitTestTarget = {
      onPointerDownCapture: event => {
        sessions.delete(event)
        sessions.ensure(event)
      },
    }
    const child: HitTestTarget = { onPointerDown: childDown }
    const path = new HitTestResult()
    path.add({ target: root, localPosition: { x: 1, y: 1 } })
    path.add({ target: child, localPosition: { x: 1, y: 1 } })

    dispatcher.dispatchToPath(path, pointerEvent('down', 1, 1))

    expect(childDown).not.toHaveBeenCalled()
    expect(sessions.hasActiveSequence(1)).toBe(false)
    expect(sessions.debugSnapshot(1).sequencePhase).toBe('active')
  })

  it('aborts a hover-only move path immediately after a handler starts a sequence', () => {
    const sessions = new PointerDispatchSessions()
    const dispatcher = new PointerPathDispatcher(sessions)
    const childMove = vi.fn()
    const rootBubble = vi.fn()
    const root: HitTestTarget = {
      onPointerMoveCapture: event => {
        sessions.beginActivationCandidate(event, event.position)
      },
      onPointerMove: rootBubble,
    }
    const child: HitTestTarget = { onPointerMove: childMove }
    const path = new HitTestResult()
    path.add({ target: root, localPosition: { x: 1, y: 1 } })
    path.add({ target: child, localPosition: { x: 1, y: 1 } })
    const event = pointerEvent('move', 1, 1)
    sessions.rememberPointerEvent(event)

    dispatcher.dispatchToPath(path, event)

    expect(childMove).not.toHaveBeenCalled()
    expect(rootBubble).not.toHaveBeenCalled()
    expect(sessions.hasActiveSequence(event)).toBe(true)
  })

  it('binds hover-only capabilities so they cannot mutate a later sequence', () => {
    const sessions = new PointerDispatchSessions()
    const dispatcher = new PointerPathDispatcher(sessions)
    let retainedEvent!: PointerEvent
    const hoverTarget: HitTestTarget = {
      onPointerMove: event => { retainedEvent = event },
    }
    const path = new HitTestResult()
    path.add({
      target: hoverTarget,
      localPosition: { x: 1, y: 1 },
    })
    const hoverEvent = pointerEvent('move', 1, 1)
    sessions.rememberPointerEvent(hoverEvent)
    sessions.beginDispatchFrame(hoverEvent)
    dispatcher.dispatchToPath(path, hoverEvent)

    const downEvent = pointerEvent('down', 2, 2)
    const capturedTarget: HitTestTarget = {}
    sessions.beginActivationCandidate(downEvent, downEvent.position)
    sessions.setCapture(downEvent, capturedTarget)
    const rejectedMember = {
      acceptGesture: vi.fn(),
      rejectGesture: vi.fn(),
    }

    retainedEvent.preventActivation?.()
    retainedEvent.releasePointerCapture?.()
    retainedEvent.joinGestureArena?.(rejectedMember)

    expect(sessions.debugSnapshot(downEvent).activationPrevented).toBe(false)
    expect(sessions.getCapture(downEvent)).toBe(capturedTarget)
    expect(rejectedMember.rejectGesture).toHaveBeenCalledWith(1)
    expect(sessions.debugSnapshot(downEvent).gestureArenaMembers).toEqual([])
  })
})

function activationEvent(clickCount: number) {
  return {
    type: 'activate' as const,
    pointerId: 1,
    pointerType: 'mouse' as const,
    button: 0,
    clickCount,
    position: { x: 1, y: 1 },
    downPosition: { x: 1, y: 1 },
    timeStamp: clickCount,
  }
}
