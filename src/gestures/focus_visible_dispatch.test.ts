import { afterEach, describe, expect, it } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { EventDispatcher } from './recognizers'

afterEach(() => FocusManager.disposeInstance())

describe('pointer focus visibility routing', () => {
  it.each(['mouse', 'touch'])('records %s input before overlay interception on a detached canvas', kind => {
    const canvas = document.createElement('canvas')
    const dispatcher = new EventDispatcher(canvas)
    const manager = FocusManager.instance
    manager.handleKeyDownEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    const modes: string[] = []
    dispatcher.addInterceptor({ hitTest: () => true,
      onPointerDown: () => { modes.push(manager.inputModality) }, onPointerMove: () => {},
    })
    try {
      if (kind === 'mouse') canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 10, clientY: 10 }))
      else {
        const event = new Event('touchstart', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'changedTouches', { value: [{ identifier: 1, clientX: 10, clientY: 10 }] })
        canvas.dispatchEvent(event)
      }
      expect(modes).toEqual(['pointer'])
    } finally { dispatcher.dispose() }
  })
})
