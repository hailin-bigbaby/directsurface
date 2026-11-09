import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from './focus_manager'
import { RenderObject, type BoxConstraints } from './render_object'
import { PopupRenderHost } from './popup_render_host'
import { HitTestResult, type PointerEvent, type WheelPointerEvent } from '../gestures/hit_test'
import type { GestureArenaMember } from '../gestures/gesture_arena'
import { RenderStackPanel } from '../layout/render_flex'
import { RenderSpacer } from '../layout/render_flex'
import { RenderButton } from '../widgets/button'
import { RenderText } from '../widgets/basic'
import { RenderIconButton } from '../widgets/icon_button'
import { RenderItemsControl } from '../widgets/items_control'
import { RenderScrollViewer } from '../widgets/scroll_view'

const unconstrained: BoxConstraints = {
  minWidth: 0,
  maxWidth: 9999,
  minHeight: 0,
  maxHeight: 9999,
}

const popupScrollConstraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 120,
  minHeight: 0,
  maxHeight: 80,
}

function pointerEvent(
  type: PointerEvent['type'],
  x: number,
  y: number,
  overrides: Partial<PointerEvent> = {},
): PointerEvent {
  return {
    pointerId: 0,
    position: { x, y },
    type,
    ...overrides,
  }
}

function wheelEvent(x: number, y: number, deltaY = 1, deltaX = 0): WheelPointerEvent {
  return {
    pointerId: 0,
    position: { x, y },
    type: 'wheel',
    deltaX,
    deltaY,
  }
}

function popupScrollButtonScene(onClick = vi.fn()): {
  host: PopupRenderHost
  scroll: RenderScrollViewer
  button: RenderButton
  onClick: ReturnType<typeof vi.fn>
} {
  const button = new RenderButton({ label: 'Select', onClick })
  const content = new RenderStackPanel({ orientation: 'vertical' })
  content.addChild(button)
  content.addChild(new RenderSpacer({ width: 90, height: 180 }))
  const scroll = new RenderScrollViewer({ child: content })
  scroll.layout(popupScrollConstraints)
  const host = new PopupRenderHost(scroll)
  return { host, scroll, button, onClick }
}

function stubAnimationFrames(): void {
  let nextFrameId = 1
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => nextFrameId++))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
}

class TestNode extends RenderObject {
  private readonly _children: TestNode[] = []
  onPointerLeave?: (event: PointerEvent) => void
  onPointerDown?: (event: PointerEvent) => void
  onPointerMove?: (event: PointerEvent) => void
  onPointerUp?: (event: PointerEvent) => void
  onPointerCancel?: (event: PointerEvent) => void
  onWheel?: (event: WheelPointerEvent) => boolean | void

  constructor(
    x: number,
    y: number,
    width: number,
    height: number,
    handlers: Partial<Pick<TestNode, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onPointerLeave' | 'onWheel'>> = {},
  ) {
    super()
    this.offset = { x, y }
    this.size = { width, height }
    Object.assign(this, handlers)
  }

  addChild(child: TestNode): void {
    child.parent = this
    this._children.push(child)
  }

  override performLayout(_constraints: BoxConstraints, _context: any): void {}
  override performPaint(_context: any, _offset: any): void {}
  override visitChildren(visitor: (child: RenderObject) => void): void {
    for (const child of this._children) visitor(child)
  }
}

class TransientNode extends TestNode {
  transientPaintCount = 0

  override performTransientPaint(_context: any, _offset: any): void {
    this.transientPaintCount += 1
  }
}

class CallbackHitTestNode extends TestNode {
  onHitTest?: () => void

  override hitTest(point: { x: number; y: number }): boolean {
    this.onHitTest?.()
    return super.hitTest(point)
  }
}

class SemanticHoverNode extends RenderObject {
  readonly onPointerEnter = vi.fn()
  readonly onPointerLeave = vi.fn()
  readonly onPointerActivate = vi.fn()

  override performLayout(_constraints: BoxConstraints, _context: any): void {}
  override performPaint(_context: any, _offset: any): void {}
  override visitChildren(_visitor: (child: RenderObject) => void): void {}

  override hitTestPath(point: { x: number; y: number }, result: HitTestResult): boolean {
    if (!this.hitTest(point)) return false
    const globalOffset = this.globalOffset
    const localPosition = {
      x: point.x - globalOffset.x,
      y: point.y - globalOffset.y,
    }
    result.add({
      target: this,
      localPosition,
      key: localPosition.x < this.size.width / 2 ? 'left' : 'right',
      coordinateSpace: this,
    })
    return true
  }
}

describe('PopupRenderHost', () => {
  afterEach(() => {
    FocusManager.disposeInstance()
    vi.unstubAllGlobals()
  })

  it('sends leave to hovered popup subtree targets when the pointer leaves the hosted tree', () => {
    const move = vi.fn()
    const leave = vi.fn()
    const root = new TestNode(0, 0, 100, 100)
    const child = new TestNode(10, 10, 30, 30, {
      onPointerMove: move,
      onPointerLeave: leave,
    })
    root.addChild(child)
    root.layout(unconstrained)
    const host = new PopupRenderHost(root)

    expect(host.handlePointerMove(pointerEvent('move', 20, 20))).toBe(true)
    expect(move).toHaveBeenCalledTimes(1)

    expect(host.handlePointerMove(pointerEvent('move', 120, 120))).toBe(true)
    expect(leave).toHaveBeenCalledTimes(1)
    expect(leave).toHaveBeenCalledWith(expect.objectContaining({
      pointerId: 0,
      position: { x: 120, y: 120 },
      type: 'move',
    }))
  })

  it('treats explicit hover leave separately from pointer cancel', () => {
    const leave = vi.fn()
    const cancel = vi.fn()
    const root = new TestNode(0, 0, 100, 100)
    const child = new TestNode(10, 10, 30, 30, {
      onPointerMove: vi.fn(),
      onPointerLeave: leave,
      onPointerCancel: cancel,
    })
    root.addChild(child)
    root.layout(unconstrained)
    const host = new PopupRenderHost(root)

    expect(host.handlePointerMove(pointerEvent('move', 20, 20))).toBe(true)
    expect(host.handlePointerLeave(pointerEvent('move', 120, 120))).toBe(true)

    expect(leave).toHaveBeenCalledWith(expect.objectContaining({
      pointerId: 0,
      position: { x: 120, y: 120 },
      type: 'move',
    }))
    expect(cancel).not.toHaveBeenCalled()
  })

  it('keeps routing captured pointer events to popup subtree targets outside hit bounds', () => {
    const down = vi.fn((event: PointerEvent) => event.setPointerCapture?.())
    const move = vi.fn()
    const up = vi.fn()
    const root = new TestNode(0, 0, 100, 100)
    const child = new TestNode(10, 10, 30, 30, {
      onPointerDown: down,
      onPointerMove: move,
      onPointerUp: up,
    })
    root.addChild(child)
    root.layout(unconstrained)
    const host = new PopupRenderHost(root)

    expect(host.handlePointerDown(pointerEvent('down', 20, 20))).toBe(true)
    expect(down).toHaveBeenCalledTimes(1)

    expect(host.handlePointerMove(pointerEvent('move', 150, 150))).toBe(true)
    expect(move).toHaveBeenCalledTimes(1)
    expect(move).toHaveBeenCalledWith(expect.objectContaining({
      pointerId: 0,
      position: { x: 150, y: 150 },
      type: 'move',
    }))

    expect(host.handlePointerUp(pointerEvent('up', 150, 150))).toBe(true)
    expect(up).toHaveBeenCalledTimes(1)
    expect(host.getDebugSnapshot(0).sequenceEnded).toBe(true)

    expect(host.handlePointerMove(pointerEvent('move', 150, 150))).toBe(false)
    expect(move).toHaveBeenCalledTimes(1)
  })

  it('reports active pointer interaction while a popup sequence owns capture', () => {
    const root = new TestNode(0, 0, 100, 100)
    const child = new TestNode(10, 10, 30, 30, {
      onPointerDown: event => event.setPointerCapture?.(),
    })
    root.addChild(child)
    root.layout(unconstrained)
    const host = new PopupRenderHost(root)

    expect(host.hasActivePointerInteraction).toBe(false)
    host.handlePointerDown(pointerEvent('down', 20, 20))
    expect(host.hasActivePointerInteraction).toBe(true)
    host.handlePointerUp(pointerEvent('up', 20, 20))
    expect(host.hasActivePointerInteraction).toBe(false)
  })

  it('cancels an active popup sequence and clears capture state', () => {
    const down = vi.fn((event: PointerEvent) => event.setPointerCapture?.())
    const cancel = vi.fn()
    const root = new TestNode(0, 0, 100, 100)
    const child = new TestNode(10, 10, 30, 30, {
      onPointerDown: down,
      onPointerCancel: cancel,
    })
    root.addChild(child)
    root.layout(unconstrained)
    const host = new PopupRenderHost(root)

    expect(host.handlePointerDown(pointerEvent('down', 20, 20))).toBe(true)
    expect(host.getDebugSnapshot(0).capturedTarget).toBe(child)

    expect(host.handlePointerCancel(pointerEvent('cancel', 150, 150))).toBe(true)

    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({
      pointerId: 0,
      position: { x: 150, y: 150 },
      type: 'cancel',
    }))
    const snapshot = host.getDebugSnapshot(0)
    expect(snapshot.activePath).toBeUndefined()
    expect(snapshot.capturedTarget).toBeUndefined()
    expect(snapshot.sequenceEnded).toBe(true)
  })

  it('does not redispatch cancel when reset runs from an up callback', () => {
    const cancel = vi.fn()
    let host: PopupRenderHost
    const up = vi.fn((event: PointerEvent) => {
      if (event.pointerId === 1) host.reset()
    })
    const root = new TestNode(0, 0, 100, 100)
    const child = new TestNode(10, 10, 30, 30, {
      onPointerUp: up,
      onPointerCancel: cancel,
    })
    root.addChild(child)
    root.layout(unconstrained)
    host = new PopupRenderHost(root)

    host.handlePointerDown(pointerEvent('down', 20, 20, { pointerId: 1 }))
    host.handlePointerDown(pointerEvent('down', 20, 20, { pointerId: 2 }))
    expect(host.handlePointerUp(pointerEvent('up', 20, 20, { pointerId: 1 }))).toBe(true)

    expect(up).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({
      pointerId: 2,
      type: 'cancel',
    }))
    expect(host.getDebugSnapshot(1).sequenceEnded).toBe(true)
    expect(host.getDebugSnapshot(2).sequenceEnded).toBe(true)
  })

  it('does not dispatch a stale up path when release hit testing resets the host', () => {
    const up = vi.fn()
    let host: PopupRenderHost
    let resetOnHit = false
    const root = new TestNode(0, 0, 100, 100)
    const child = new CallbackHitTestNode(10, 10, 30, 30, {
      onPointerUp: up,
    })
    child.onHitTest = () => {
      if (resetOnHit) host.reset()
    }
    root.addChild(child)
    root.layout(unconstrained)
    host = new PopupRenderHost(root)

    host.handlePointerDown(pointerEvent('down', 20, 20))
    resetOnHit = true

    expect(host.handlePointerUp(pointerEvent('up', 20, 20))).toBe(true)
    expect(up).not.toHaveBeenCalled()
    expect(host.getDebugSnapshot(0).sequenceEnded).toBe(true)
  })

  it('does not allow an up handler to acquire fresh pointer capture', () => {
    let capturedDuringUp = true
    const root = new TestNode(0, 0, 100, 100)
    const child = new TestNode(10, 10, 30, 30, {
      onPointerUp: event => {
        event.setPointerCapture?.()
        capturedDuringUp = event.hasPointerCapture?.() ?? false
      },
    })
    root.addChild(child)
    root.layout(unconstrained)
    const host = new PopupRenderHost(root)

    host.handlePointerDown(pointerEvent('down', 20, 20))
    host.handlePointerUp(pointerEvent('up', 20, 20))

    expect(capturedDuringUp).toBe(false)
    expect(host.getDebugSnapshot(0).sequenceEnded).toBe(true)
  })

  it('does not recursively cancel when reset runs from a cancel callback', () => {
    let host: PopupRenderHost
    const cancel = vi.fn(() => host.reset())
    const root = new TestNode(0, 0, 100, 100)
    const child = new TestNode(10, 10, 30, 30, { onPointerCancel: cancel })
    root.addChild(child)
    root.layout(unconstrained)
    host = new PopupRenderHost(root)

    host.handlePointerDown(pointerEvent('down', 20, 20))

    expect(host.handlePointerCancel(pointerEvent('cancel', 20, 20))).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(host.getDebugSnapshot(0).sequenceEnded).toBe(true)
  })

  it('does not recursively leave when reset runs from a leave callback', () => {
    let host: PopupRenderHost
    const leave = vi.fn(() => host.reset())
    const root = new TestNode(0, 0, 100, 100)
    const child = new TestNode(10, 10, 30, 30, {
      onPointerMove: vi.fn(),
      onPointerLeave: leave,
    })
    root.addChild(child)
    root.layout(unconstrained)
    host = new PopupRenderHost(root)

    host.handlePointerMove(pointerEvent('move', 20, 20))

    expect(host.handlePointerLeave(pointerEvent('move', 120, 120))).toBe(true)
    expect(leave).toHaveBeenCalledTimes(1)
    expect(host.getDebugSnapshot(0).hoverTargets).toEqual([])
  })

  it('cleans up a pointer sequence when an up callback throws', () => {
    const failure = new Error('up failed')
    const root = new TestNode(0, 0, 100, 100)
    const child = new TestNode(10, 10, 30, 30, {
      onPointerUp: () => { throw failure },
    })
    root.addChild(child)
    root.layout(unconstrained)
    const host = new PopupRenderHost(root)
    host.handlePointerDown(pointerEvent('down', 20, 20))

    expect(() => host.handlePointerUp(pointerEvent('up', 20, 20))).toThrow(failure)
    expect(host.getDebugSnapshot(0).sequenceEnded).toBe(true)
  })

  it('preserves a down dispatch error while completing arena and reference cleanup', () => {
    const dispatchFailure = new Error('down failed')
    const cleanupFailure = new Error('arena cleanup failed')
    const member: GestureArenaMember = {
      acceptGesture: vi.fn(),
      rejectGesture: vi.fn(() => { throw cleanupFailure }),
    }
    const root = new TestNode(0, 0, 100, 100)
    const child = new TestNode(10, 10, 30, 30, {
      onPointerDown: event => {
        event.joinGestureArena?.(member)
        throw dispatchFailure
      },
    })
    root.addChild(child)
    root.layout(unconstrained)
    const host = new PopupRenderHost(root)
    const clearReferences = vi.spyOn(
      (host as any)._pointerDispatcher,
      'clearPointerReferences',
    )

    expect(() => host.handlePointerDown(pointerEvent('down', 20, 20)))
      .toThrow(dispatchFailure)

    expect(clearReferences).toHaveBeenCalledWith(expect.objectContaining({
      pointerId: 0,
      type: 'down',
    }))
    expect(member.rejectGesture).toHaveBeenCalledWith(0)
    expect(host.getDebugSnapshot(0).sequenceEnded).toBe(true)
  })

  it('routes wheel to the deepest hosted target only when hit-tested', () => {
    const wheel = vi.fn()
    const rootWheel = vi.fn()
    const root = new TestNode(0, 0, 100, 100, { onWheel: rootWheel })
    const child = new TestNode(10, 10, 30, 30, { onWheel: wheel })
    root.addChild(child)
    root.layout(unconstrained)
    const host = new PopupRenderHost(root)

    expect(host.handleWheel(wheelEvent(20, 20))).toBe(true)
    expect(wheel).toHaveBeenCalledTimes(1)
    expect(rootWheel).not.toHaveBeenCalled()

    expect(host.handleWheel(wheelEvent(150, 150))).toBe(false)
    expect(wheel).toHaveBeenCalledTimes(1)
  })

  it('bubbles wheel to popup ancestors when the deepest target declines it', () => {
    const childWheel = vi.fn(() => false)
    const rootWheel = vi.fn(() => true)
    const root = new TestNode(0, 0, 100, 100, { onWheel: rootWheel })
    const child = new TestNode(10, 10, 30, 30, { onWheel: childWheel })
    root.addChild(child)
    root.layout(unconstrained)
    const host = new PopupRenderHost(root)

    expect(host.handleWheel(wheelEvent(20, 20))).toBe(true)
    expect(childWheel).toHaveBeenCalledTimes(1)
    expect(rootWheel).toHaveBeenCalledTimes(1)
  })

  it('selects a clickable item inside a scroll view hosted by a popup', () => {
    stubAnimationFrames()
    const { host, scroll, button, onClick } = popupScrollButtonScene()
    const x = button.globalOffset.x + button.size.width / 2
    const y = button.globalOffset.y + button.size.height / 2

    expect(host.handlePointerDown(pointerEvent('down', x, y))).toBe(true)
    expect(host.handlePointerUp(pointerEvent('up', x, y))).toBe(true)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(scroll.scrollY).toBe(0)
    expect((button as any)._interaction.isPressed).toBe(false)
    expect(host.getDebugSnapshot(0).activePath).toBeUndefined()
    expect(host.getDebugSnapshot(0).capturedTarget).toBeUndefined()
    expect(host.getDebugSnapshot(0).sequenceEnded).toBe(true)
  })

  it('lets popup scroll view content drag reject a nested selectable item', () => {
    stubAnimationFrames()
    const { host, scroll, button, onClick } = popupScrollButtonScene()
    const x = button.globalOffset.x + button.size.width / 2
    const y = button.globalOffset.y + button.size.height / 2

    expect(host.handlePointerDown(pointerEvent('down', x, y))).toBe(true)
    expect(host.handlePointerMove(pointerEvent('move', x + 1, y - 40))).toBe(true)
    const scrollAfterDrag = scroll.scrollY

    expect(scrollAfterDrag).toBeGreaterThan(0)
    expect(onClick).not.toHaveBeenCalled()
    expect((button as any)._interaction.isPressed).toBe(false)
    expect(host.getDebugSnapshot(0).capturedTarget).toBe(scroll)

    expect(host.handlePointerUp(pointerEvent('up', x + 1, y - 40))).toBe(true)
    expect(host.getDebugSnapshot(0).capturedTarget).toBeUndefined()
    expect(host.getDebugSnapshot(0).sequenceEnded).toBe(true)
    expect(host.handlePointerMove(pointerEvent('move', x + 1, y - 80))).toBe(false)

    expect(scroll.scrollY).toBe(scrollAfterDrag)
    expect(host.getDebugSnapshot(0).capturedTarget).toBeUndefined()
  })

  it('hovers popup-hosted item containers across text blank and nested action areas', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const rows = [{ key: 'a', label: 'Alpha' }]
    const items = new RenderItemsControl({
      items: rows,
      getKey: row => row.key,
      selectionMode: 'none',
      itemAppearance: 'row',
      itemTemplate: row => {
        const line = new RenderStackPanel({ orientation: 'horizontal', spacing: 8, crossAxisAlignment: 'center' })
        line.addChild(new RenderText(row.label), 1)
        line.addChild(new RenderIconButton({ icon: 'trash', size: 24, iconSize: 13 }))
        return line
      },
    })
    items.layout({ minWidth: 0, maxWidth: 220, minHeight: 0, maxHeight: 80 })
    const host = new PopupRenderHost(items)
    const container = items.debugContainers()[0]!
    const button = collectFirstIconButton(container)
    if (!button) throw new Error('nested icon button not found')

    expect(host.handlePointerMove(pointerEvent('move', 12, container.offset.y + 8))).toBe(true)
    expect(container.debugState().hovered).toBe(true)

    expect(host.handlePointerMove(pointerEvent('move', 180, container.offset.y + 8))).toBe(true)
    expect(container.debugState().hovered).toBe(true)

    const actionPoint = {
      x: button.globalOffset.x + Math.min(4, button.size.width / 2),
      y: button.globalOffset.y + Math.min(4, button.size.height / 2),
    }
    expect(host.handlePointerMove(pointerEvent('move', actionPoint.x, actionPoint.y))).toBe(true)
    expect(container.debugState().hovered).toBe(true)
  })

  it('transitions hover when one popup target exposes a different semantic region', () => {
    const node = new SemanticHoverNode()
    node.size = { width: 100, height: 40 }
    const host = new PopupRenderHost(node)

    expect(host.handlePointerMove(pointerEvent('move', 20, 10))).toBe(true)
    expect(node.onPointerEnter).toHaveBeenLastCalledWith(expect.objectContaining({
      localPosition: { x: 20, y: 10 },
      hitTestEntry: expect.objectContaining({ key: 'left' }),
    }))

    expect(host.handlePointerMove(pointerEvent('move', 80, 10))).toBe(true)
    expect(node.onPointerLeave).toHaveBeenCalledWith(expect.objectContaining({
      localPosition: { x: 80, y: 10 },
      hitTestEntry: expect.objectContaining({ key: 'left' }),
    }))
    expect(node.onPointerEnter).toHaveBeenLastCalledWith(expect.objectContaining({
      localPosition: { x: 80, y: 10 },
      hitTestEntry: expect.objectContaining({ key: 'right' }),
    }))
  })

  it('derives popup activation counts from stable semantic hit identities', () => {
    const node = new SemanticHoverNode()
    node.size = { width: 100, height: 40 }
    const host = new PopupRenderHost(node)

    expect(host.handlePointerDown(pointerEvent('down', 20, 10, {
      pointerType: 'mouse',
      clickCount: 1,
      timeStamp: 10,
    }))).toBe(true)
    expect(host.handlePointerUp(pointerEvent('up', 20, 10, {
      pointerType: 'mouse',
      timeStamp: 20,
    }))).toBe(true)
    expect(host.handlePointerDown(pointerEvent('down', 20, 10, {
      pointerType: 'mouse',
      clickCount: 2,
      timeStamp: 30,
    }))).toBe(true)
    expect(host.handlePointerUp(pointerEvent('up', 20, 10, {
      pointerType: 'mouse',
      timeStamp: 40,
    }))).toBe(true)

    expect(node.onPointerActivate.mock.calls.map(([event]) => ({
      clickCount: event.clickCount,
      key: event.targetEntry.key,
    }))).toEqual([
      { clickCount: 1, key: 'left' },
      { clickCount: 2, key: 'left' },
    ])
  })

  it('restarts popup activation when the semantic region changes', () => {
    const node = new SemanticHoverNode()
    node.size = { width: 100, height: 40 }
    const host = new PopupRenderHost(node)

    host.handlePointerDown(pointerEvent('down', 20, 10, {
      pointerType: 'mouse',
      clickCount: 1,
      timeStamp: 10,
    }))
    host.handlePointerUp(pointerEvent('up', 20, 10, {
      pointerType: 'mouse',
      timeStamp: 20,
    }))
    host.handlePointerDown(pointerEvent('down', 80, 10, {
      pointerType: 'mouse',
      clickCount: 2,
      timeStamp: 30,
    }))
    host.handlePointerUp(pointerEvent('up', 80, 10, {
      pointerType: 'mouse',
      timeStamp: 40,
    }))

    expect(node.onPointerActivate.mock.calls.map(([event]) => ({
      clickCount: event.clickCount,
      key: event.targetEntry.key,
    }))).toEqual([
      { clickCount: 1, key: 'left' },
      { clickCount: 1, key: 'right' },
    ])
  })

  it('bridges a popup legacy double-click once from completed pointer sequences', () => {
    const node = new TestNode(0, 0, 100, 40)
    const onDoubleClick = vi.fn()
    ;(node as TestNode & { onDoubleClick: typeof onDoubleClick }).onDoubleClick = onDoubleClick
    node.layout(unconstrained)
    const host = new PopupRenderHost(node)

    host.handlePointerDown(pointerEvent('down', 20, 10, {
      pointerType: 'mouse',
      clickCount: 1,
      timeStamp: 10,
    }))
    host.handlePointerUp(pointerEvent('up', 20, 10, {
      pointerType: 'mouse',
      timeStamp: 20,
    }))
    host.handlePointerDown(pointerEvent('down', 20, 10, {
      pointerType: 'mouse',
      clickCount: 2,
      timeStamp: 30,
    }))
    host.handlePointerUp(pointerEvent('up', 20, 10, {
      pointerType: 'mouse',
      timeStamp: 40,
    }))

    expect(onDoubleClick).toHaveBeenCalledOnce()
    expect(onDoubleClick).toHaveBeenCalledWith({ x: 20, y: 10 })
  })

  it('replays active transient paint after a popup full repaint', () => {
    const node = new TransientNode(0, 0, 100, 40)
    const host = new PopupRenderHost(node)
    const context = { ctx: {} as CanvasRenderingContext2D, setTheme: vi.fn() } as any

    node.markNeedsTransientPaint()
    host.paint(context)

    expect(node.transientPaintCount).toBe(1)

    host.paint(context)

    expect(node.transientPaintCount).toBe(2)
  })
})

function collectFirstIconButton(root: RenderObject): RenderIconButton | undefined {
  if (root instanceof RenderIconButton) return root
  let found: RenderIconButton | undefined
  root.visitChildren(child => {
    if (!found) found = collectFirstIconButton(child)
  })
  return found
}
