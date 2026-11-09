import { describe, expect, it, vi } from 'vitest'
import type { PointerEvent } from './hit_test'
import {
  DragRecognizer,
  LongPressRecognizer,
  TapRecognizer,
} from './recognizers'

function pointerEvent(
  type: PointerEvent['type'],
  pointerType: NonNullable<PointerEvent['pointerType']>,
  x: number,
  y = 0,
): PointerEvent {
  return {
    pointerId: 0,
    pointerType,
    type,
    position: { x, y },
    button: 0,
    buttons: type === 'up' || type === 'cancel' ? 0 : 1,
  }
}

describe('direct pointer recognizers', () => {
  it('keeps TapRecognizer owned by the first composite pointer until termination', () => {
    const onTapDown = vi.fn()
    const onTap = vi.fn()
    const recognizer = new TapRecognizer({ onTapDown, onTap })

    recognizer.handlePointerDown(pointerEvent('down', 'mouse', 1))
    recognizer.handlePointerDown(pointerEvent('down', 'touch', 2))
    recognizer.handlePointerUp(pointerEvent('up', 'touch', 2))

    expect(onTapDown).toHaveBeenCalledTimes(1)
    expect(onTapDown).toHaveBeenCalledWith({ x: 1, y: 0 })
    expect(onTap).not.toHaveBeenCalled()

    recognizer.handlePointerUp(pointerEvent('up', 'mouse', 1))

    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('does not let a throwing reentrant tap-down clear its replacement owner', () => {
    const failure = new Error('tap down failed')
    const onTap = vi.fn()
    let replace = true
    let recognizer!: TapRecognizer
    recognizer = new TapRecognizer({
      onTapDown: () => {
        if (!replace) return
        replace = false
        recognizer.handlePointerCancel(pointerEvent('cancel', 'mouse', 1))
        recognizer.handlePointerDown(pointerEvent('down', 'touch', 2))
        throw failure
      },
      onTap,
    })

    expect(() => {
      recognizer.handlePointerDown(pointerEvent('down', 'mouse', 1))
    }).toThrow(failure)
    recognizer.handlePointerUp(pointerEvent('up', 'touch', 2))

    expect(onTap).toHaveBeenCalledOnce()
  })

  it('keeps DragRecognizer owned by the first composite pointer until termination', () => {
    const onDragStart = vi.fn()
    const onDragUpdate = vi.fn()
    const onDragEnd = vi.fn()
    const recognizer = new DragRecognizer({
      onDragStart,
      onDragUpdate,
      onDragEnd,
    }, 1)

    recognizer.handlePointerDown(pointerEvent('down', 'mouse', 0))
    recognizer.handlePointerDown(pointerEvent('down', 'touch', 10))
    recognizer.handlePointerMove(pointerEvent('move', 'touch', 20))

    expect(onDragStart).not.toHaveBeenCalled()
    expect(onDragUpdate).not.toHaveBeenCalled()

    recognizer.handlePointerMove(pointerEvent('move', 'mouse', 2))
    recognizer.handlePointerUp(pointerEvent('up', 'touch', 20))

    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(onDragUpdate).toHaveBeenCalledTimes(1)
    expect(onDragEnd).not.toHaveBeenCalled()

    recognizer.handlePointerUp(pointerEvent('up', 'mouse', 2))

    expect(onDragEnd).toHaveBeenCalledTimes(1)
  })

  it('does not leave a second LongPressRecognizer timer for a competing pointer', () => {
    vi.useFakeTimers()
    try {
      const onLongPress = vi.fn()
      const recognizer = new LongPressRecognizer({ onLongPress }, 10)

      recognizer.handlePointerDown(pointerEvent('down', 'mouse', 1))
      recognizer.handlePointerDown(pointerEvent('down', 'touch', 2))
      vi.advanceTimersByTime(10)
      vi.advanceTimersByTime(100)

      expect(onLongPress).toHaveBeenCalledTimes(1)
      expect(onLongPress).toHaveBeenCalledWith({ x: 1, y: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reuses TapRecognizer after a terminal callback throws', () => {
    const failure = new Error('tap-up failed')
    let shouldThrow = true
    const onTapUp = vi.fn(() => {
      if (shouldThrow) throw failure
    })
    const onTap = vi.fn()
    const recognizer = new TapRecognizer({ onTapUp, onTap })

    recognizer.handlePointerDown(pointerEvent('down', 'mouse', 1))
    expect(() => {
      recognizer.handlePointerUp(pointerEvent('up', 'mouse', 1))
    }).toThrow(failure)

    shouldThrow = false
    recognizer.handlePointerDown(pointerEvent('down', 'touch', 2))
    recognizer.handlePointerUp(pointerEvent('up', 'touch', 2))

    expect(onTapUp).toHaveBeenCalledTimes(2)
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('reuses DragRecognizer after its terminal callback throws', () => {
    const failure = new Error('drag-end failed')
    let shouldThrow = true
    const onDragEnd = vi.fn(() => {
      if (shouldThrow) throw failure
    })
    const recognizer = new DragRecognizer({ onDragEnd }, 1)

    recognizer.handlePointerDown(pointerEvent('down', 'mouse', 0))
    recognizer.handlePointerMove(pointerEvent('move', 'mouse', 2))
    expect(() => {
      recognizer.handlePointerUp(pointerEvent('up', 'mouse', 2))
    }).toThrow(failure)

    shouldThrow = false
    recognizer.handlePointerDown(pointerEvent('down', 'touch', 10))
    recognizer.handlePointerMove(pointerEvent('move', 'touch', 12))
    recognizer.handlePointerUp(pointerEvent('up', 'touch', 12))

    expect(onDragEnd).toHaveBeenCalledTimes(2)
  })

  it('reuses DragRecognizer after its start callback throws', () => {
    const failure = new Error('drag-start failed')
    let shouldThrow = true
    const onDragStart = vi.fn(() => {
      if (shouldThrow) throw failure
    })
    const onDragUpdate = vi.fn()
    const recognizer = new DragRecognizer({
      onDragStart,
      onDragUpdate,
    }, 1)

    recognizer.handlePointerDown(pointerEvent('down', 'mouse', 0))
    expect(() => {
      recognizer.handlePointerMove(pointerEvent('move', 'mouse', 2))
    }).toThrow(failure)

    shouldThrow = false
    recognizer.handlePointerDown(pointerEvent('down', 'touch', 10))
    recognizer.handlePointerMove(pointerEvent('move', 'touch', 12))

    expect(onDragStart).toHaveBeenCalledTimes(2)
    expect(onDragUpdate).toHaveBeenCalledOnce()
  })

  it('reuses DragRecognizer after its update callback throws', () => {
    const failure = new Error('drag-update failed')
    let shouldThrow = true
    const onDragStart = vi.fn()
    const onDragUpdate = vi.fn(() => {
      if (shouldThrow) throw failure
    })
    const recognizer = new DragRecognizer({
      onDragStart,
      onDragUpdate,
    }, 1)

    recognizer.handlePointerDown(pointerEvent('down', 'mouse', 0))
    expect(() => {
      recognizer.handlePointerMove(pointerEvent('move', 'mouse', 2))
    }).toThrow(failure)

    shouldThrow = false
    recognizer.handlePointerDown(pointerEvent('down', 'touch', 10))
    recognizer.handlePointerMove(pointerEvent('move', 'touch', 12))

    expect(onDragStart).toHaveBeenCalledTimes(2)
    expect(onDragUpdate).toHaveBeenCalledTimes(2)
  })

  it('reuses LongPressRecognizer after its timer callback throws', () => {
    vi.useFakeTimers()
    try {
      const failure = new Error('long-press failed')
      let shouldThrow = true
      const onLongPress = vi.fn(() => {
        if (shouldThrow) throw failure
      })
      const recognizer = new LongPressRecognizer({ onLongPress }, 10)

      recognizer.handlePointerDown(pointerEvent('down', 'mouse', 1))
      expect(() => vi.advanceTimersByTime(10)).toThrow(failure)

      shouldThrow = false
      recognizer.handlePointerDown(pointerEvent('down', 'touch', 2))
      vi.advanceTimersByTime(10)

      expect(onLongPress).toHaveBeenCalledTimes(2)
      expect(onLongPress).toHaveBeenLastCalledWith({ x: 2, y: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears LongPressRecognizer ownership when cancellation throws', () => {
    vi.useFakeTimers()
    try {
      const failure = new Error('long-press cancel failed')
      let shouldThrow = true
      const onLongPress = vi.fn()
      const onLongPressCancel = vi.fn(() => {
        if (shouldThrow) throw failure
      })
      const recognizer = new LongPressRecognizer({
        onLongPress,
        onLongPressCancel,
      }, 10)

      recognizer.handlePointerDown(pointerEvent('down', 'mouse', 1))
      expect(() => {
        recognizer.handlePointerUp(pointerEvent('up', 'mouse', 1))
      }).toThrow(failure)

      shouldThrow = false
      recognizer.handlePointerDown(pointerEvent('down', 'touch', 2))
      recognizer.handlePointerUp(pointerEvent('up', 'touch', 2))
      vi.advanceTimersByTime(20)

      expect(onLongPressCancel).toHaveBeenCalledTimes(2)
      expect(onLongPress).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let a reentrant drag start continue the obsolete move frame', () => {
    const updates: Array<{ delta: number; position: number }> = []
    let nested = false
    let recognizer!: DragRecognizer
    recognizer = new DragRecognizer({
      onDragStart: () => {
        if (nested) return
        nested = true
        recognizer.handlePointerCancel(pointerEvent('cancel', 'mouse', 2))
        recognizer.handlePointerDown(pointerEvent('down', 'touch', 10))
        recognizer.handlePointerMove(pointerEvent('move', 'touch', 12))
      },
      onDragUpdate: (delta, position) => {
        updates.push({ delta: delta.x, position: position.x })
      },
    }, 1)

    recognizer.handlePointerDown(pointerEvent('down', 'mouse', 0))
    recognizer.handlePointerMove(pointerEvent('move', 'mouse', 2))

    expect(updates).toEqual([{ delta: 2, position: 12 }])
  })

  it('does not let an obsolete drag update overwrite a replacement pointer position', () => {
    const updates: number[] = []
    let replace = true
    let recognizer!: DragRecognizer
    recognizer = new DragRecognizer({
      onDragUpdate: delta => {
        updates.push(delta.x)
        if (!replace) return
        replace = false
        recognizer.handlePointerCancel(pointerEvent('cancel', 'mouse', 2))
        recognizer.handlePointerDown(pointerEvent('down', 'touch', 10))
      },
    }, 1)

    recognizer.handlePointerDown(pointerEvent('down', 'mouse', 0))
    recognizer.handlePointerMove(pointerEvent('move', 'mouse', 2))
    recognizer.handlePointerMove(pointerEvent('move', 'touch', 12))

    expect(updates).toEqual([2, 2])
  })

  it('does not continue an outer drag start after a nested move advances the frame', () => {
    const updates: number[] = []
    let nested = false
    let recognizer!: DragRecognizer
    recognizer = new DragRecognizer({
      onDragStart: () => {
        if (nested) return
        nested = true
        recognizer.handlePointerMove(pointerEvent('move', 'mouse', 4))
      },
      onDragUpdate: delta => updates.push(delta.x),
    }, 1)

    recognizer.handlePointerDown(pointerEvent('down', 'mouse', 0))
    recognizer.handlePointerMove(pointerEvent('move', 'mouse', 2))

    expect(updates).toEqual([4])
  })

  it('does not let an outer drag update rewind a nested move position', () => {
    const updates: number[] = []
    let nested = false
    let recognizer!: DragRecognizer
    recognizer = new DragRecognizer({
      onDragUpdate: delta => {
        updates.push(delta.x)
        if (nested) return
        nested = true
        recognizer.handlePointerMove(pointerEvent('move', 'mouse', 4))
      },
    }, 1)

    recognizer.handlePointerDown(pointerEvent('down', 'mouse', 0))
    recognizer.handlePointerMove(pointerEvent('move', 'mouse', 2))
    recognizer.handlePointerMove(pointerEvent('move', 'mouse', 5))

    expect(updates).toEqual([2, 4, 1])
  })
})
