import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager, type Focusable } from './focus_manager'
import { PopupManager, type Popup } from './popup_manager'
import type { PointerEvent, WheelPointerEvent } from '../gestures/hit_test'
import type { BoxConstraints, LayoutContext, Offset, RenderObject } from './render_object'
import { RenderBox } from '../layout/render_box'

function makePopup(opts: {
  x: number
  y: number
  w: number
  h: number
  close?: () => void
  down?: (event: PointerEvent) => void
  move?: (event: PointerEvent) => void
  up?: (event: PointerEvent) => void
  cancel?: (event: PointerEvent) => void
  wheel?: (event: WheelPointerEvent) => boolean | void
  outside?: (event: PointerEvent) => boolean | void
  escape?: (event: KeyboardEvent) => boolean | void
  key?: (event: KeyboardEvent) => boolean | void
  focusRoots?: () => readonly RenderObject[]
}): Popup {
  return {
    hitTest: point =>
      point.x >= opts.x && point.x <= opts.x + opts.w &&
      point.y >= opts.y && point.y <= opts.y + opts.h,
    close: opts.close ?? vi.fn(),
    onPointerDown: opts.down,
    onPointerMove: opts.move,
    onPointerUp: opts.up,
    onPointerCancel: opts.cancel,
    onWheel: opts.wheel,
    onOutsidePointerDown: opts.outside,
    onEscape: opts.escape,
    onKeyDown: opts.key,
    focusRoots: opts.focusRoots,
  }
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

function focusable(): Focusable {
  let focused = false
  return {
    focusIn: vi.fn(() => { focused = true }),
    focusOut: vi.fn(() => { focused = false }),
    get isFocused() { return focused },
  }
}

class FocusNode extends RenderBox implements Focusable {
  children: FocusNode[] = []
  private _focused = false

  addChild(child: FocusNode): void {
    child.parent = this
    this.children.push(child)
  }

  get isFocused(): boolean { return this._focused }
  focusIn(): void { this._focused = true }
  focusOut(): void { this._focused = false }
  performLayout(_constraints: BoxConstraints, _context: LayoutContext): void { this.size = { width: 0, height: 0 } }
  performPaint(_context: any, _offset: Offset): void {}
  visitChildren(visitor: (child: RenderObject) => void): void {
    for (const child of this.children) visitor(child)
  }
}

class ThrowingFocusNode extends FocusNode {
  override focusOut(): void {
    throw new Error('focusOut failed')
  }
}

class ReopeningFocusNode extends FocusNode {
  constructor(private readonly _onFocusOut: () => void) {
    super()
  }

  override focusOut(): void {
    super.focusOut()
    this._onFocusOut()
  }
}

afterEach(() => {
  PopupManager.instance.dispose()
  FocusManager.disposeInstance()
  vi.restoreAllMocks()
})

describe('PopupManager stack routing', () => {
  it('keeps multiple popups and exposes the top as current', () => {
    const first = makePopup({ x: 0, y: 0, w: 10, h: 10 })
    const second = makePopup({ x: 20, y: 20, w: 10, h: 10 })

    PopupManager.instance.open(first)
    PopupManager.instance.open(second)

    expect(PopupManager.instance.stack).toEqual([first, second])
    expect(PopupManager.instance.current).toBe(second)
    expect(PopupManager.instance.hasOpen).toBe(true)
  })

  it('moves an already-open popup to the top when reopened', () => {
    const first = makePopup({ x: 0, y: 0, w: 10, h: 10 })
    const second = makePopup({ x: 20, y: 20, w: 10, h: 10 })

    PopupManager.instance.open(first)
    PopupManager.instance.open(second)
    PopupManager.instance.open(first)

    expect(PopupManager.instance.stack).toEqual([second, first])
    expect(PopupManager.instance.current).toBe(first)
  })

  it('can opt into the legacy close-existing behavior', () => {
    const closeFirst = vi.fn()
    const first = makePopup({ x: 0, y: 0, w: 10, h: 10, close: closeFirst })
    const second = makePopup({ x: 20, y: 20, w: 10, h: 10 })

    PopupManager.instance.open(first)
    PopupManager.instance.open(second, { closeExisting: true })

    expect(closeFirst).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.stack).toEqual([second])
  })

  it('keeps nonmodal overlays when closeExisting replaces transient popup content', () => {
    const closeNonmodal = vi.fn()
    const closePassive = vi.fn()
    const closePopup = vi.fn()
    const nonmodal = makePopup({ x: 0, y: 0, w: 10, h: 10, close: closeNonmodal })
    const passive = makePopup({ x: 20, y: 20, w: 10, h: 10, close: closePassive })
    const popup = makePopup({ x: 40, y: 40, w: 10, h: 10, close: closePopup })
    const modal = makePopup({ x: 60, y: 60, w: 10, h: 10 })

    PopupManager.instance.open(nonmodal, { interactionMode: 'nonmodal' })
    PopupManager.instance.open(passive, { interactionMode: 'passive' })
    PopupManager.instance.open(popup)
    PopupManager.instance.open(modal, { closeExisting: true })

    expect(closeNonmodal).not.toHaveBeenCalled()
    expect(closePassive).toHaveBeenCalledTimes(1)
    expect(closePopup).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.stack).toEqual([nonmodal, modal])
    expect(PopupManager.instance.current).toBe(modal)
  })

  it('keeps nonmodal overlays when closing transient popup content', () => {
    const closeNonmodal = vi.fn()
    const closePassive = vi.fn()
    const closePopup = vi.fn()
    const nonmodal = makePopup({ x: 0, y: 0, w: 10, h: 10, close: closeNonmodal })
    const passive = makePopup({ x: 20, y: 20, w: 10, h: 10, close: closePassive })
    const popup = makePopup({ x: 40, y: 40, w: 10, h: 10, close: closePopup })

    PopupManager.instance.open(nonmodal, { interactionMode: 'nonmodal' })
    PopupManager.instance.open(passive, { interactionMode: 'passive' })
    PopupManager.instance.open(popup)
    PopupManager.instance.closeTransient()

    expect(closeNonmodal).not.toHaveBeenCalled()
    expect(closePassive).toHaveBeenCalledTimes(1)
    expect(closePopup).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.stack).toEqual([nonmodal])
  })

  it('lets nonmodal overlays opt into transient closing', () => {
    const closeNonmodal = vi.fn()
    const nonmodal = makePopup({ x: 0, y: 0, w: 10, h: 10, close: closeNonmodal })

    PopupManager.instance.open(nonmodal, {
      interactionMode: 'nonmodal',
      closeOnTransient: true,
    })
    PopupManager.instance.closeTransient()

    expect(closeNonmodal).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.stack).toEqual([])
  })

  it('keeps persistent nonmodal overlays that opt into transient closing', () => {
    const closeNonmodal = vi.fn()
    const nonmodal = makePopup({ x: 0, y: 0, w: 10, h: 10, close: closeNonmodal })

    PopupManager.instance.open(nonmodal, {
      interactionMode: 'nonmodal',
      closeOnTransient: true,
      persistent: true,
    })
    PopupManager.instance.closeTransient()

    expect(closeNonmodal).not.toHaveBeenCalled()
    expect(PopupManager.instance.stack).toEqual([nonmodal])
  })

  it('keeps persistent popups above close-existing popups', () => {
    const closePersistent = vi.fn()
    const persistent = makePopup({ x: 0, y: 0, w: 100, h: 100, close: closePersistent })
    const modal = makePopup({ x: 20, y: 20, w: 40, h: 40 })

    PopupManager.instance.open(persistent, { persistent: true })
    PopupManager.instance.open(modal, { closeExisting: true })

    expect(closePersistent).not.toHaveBeenCalled()
    expect(PopupManager.instance.stack).toEqual([modal, persistent])
    expect(PopupManager.instance.current).toBe(persistent)
  })

  it('inserts regular popups below an open persistent popup', () => {
    const persistent = makePopup({ x: 0, y: 0, w: 100, h: 100 })
    const regular = makePopup({ x: 20, y: 20, w: 40, h: 40 })

    PopupManager.instance.open(persistent, { persistent: true })
    PopupManager.instance.open(regular)

    expect(PopupManager.instance.stack).toEqual([regular, persistent])
    expect(PopupManager.instance.current).toBe(persistent)
  })

  it('can close all popups owned by a detached owner', () => {
    const owner = {}
    const otherOwner = {}
    const closeFirst = vi.fn()
    const closeSecond = vi.fn()
    const closeOther = vi.fn()
    const first = makePopup({ x: 0, y: 0, w: 10, h: 10, close: closeFirst })
    const second = makePopup({ x: 20, y: 20, w: 10, h: 10, close: closeSecond })
    const other = makePopup({ x: 40, y: 40, w: 10, h: 10, close: closeOther })

    PopupManager.instance.open(first, { owner })
    PopupManager.instance.open(second, { owner, interactive: false })
    PopupManager.instance.open(other, { owner: otherOwner })

    expect(PopupManager.instance.closeOwnedBy(owner)).toBe(true)
    expect(closeFirst).toHaveBeenCalledTimes(1)
    expect(closeSecond).toHaveBeenCalledTimes(1)
    expect(closeOther).not.toHaveBeenCalled()
    expect(PopupManager.instance.stack).toEqual([other])
  })

  it('closes a batch of independent owned roots from one stack snapshot in reverse order', () => {
    const firstOwner = {}
    const secondOwner = {}
    const untouchedOwner = {}
    const order: string[] = []
    const first = makePopup({ x: 0, y: 0, w: 10, h: 10, close: () => order.push('first') })
    const second = makePopup({ x: 20, y: 20, w: 10, h: 10, close: () => order.push('second') })
    const untouched = makePopup({ x: 40, y: 40, w: 10, h: 10 })
    PopupManager.instance.open(first, { owner: firstOwner })
    PopupManager.instance.open(second, { owner: secondOwner })
    PopupManager.instance.open(untouched, { owner: untouchedOwner })

    expect(PopupManager.instance.closeOwnedByAny(new Set([firstOwner, secondOwner]))).toBe(true)

    expect(order).toEqual(['second', 'first'])
    expect(PopupManager.instance.stack).toEqual([untouched])
  })

  it('does not absorb a popup reopened by a batch close callback', () => {
    const owner = {}
    const reopened = makePopup({ x: 40, y: 40, w: 10, h: 10 })
    const first = makePopup({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      close: () => PopupManager.instance.open(reopened, { owner }),
    })
    PopupManager.instance.open(first, { owner })

    expect(PopupManager.instance.closeOwnedByAny(new Set([owner]))).toBe(true)

    expect(PopupManager.instance.stack).toEqual([reopened])
  })

  it('deduplicates overlapping owned popup subtrees and syncs the popup scope once', () => {
    const rootOwner = {}
    const childOwner = {}
    const closeRoot = vi.fn()
    const closeChild = vi.fn()
    const root = makePopup({ x: 0, y: 0, w: 20, h: 20, close: closeRoot })
    const child = makePopup({ x: 5, y: 5, w: 10, h: 10, close: closeChild })
    PopupManager.instance.open(root, { owner: rootOwner })
    PopupManager.instance.open(child, { owner: childOwner, parent: root })
    const manager = PopupManager.instance
    const sync = vi.spyOn(
      manager as unknown as { _syncPopupScope(): void },
      '_syncPopupScope',
    )
    sync.mockClear()

    expect(manager.closeOwnedByAny(new Set([rootOwner, childOwner]))).toBe(true)

    expect(closeChild).toHaveBeenCalledOnce()
    expect(closeRoot).toHaveBeenCalledOnce()
    expect(sync).toHaveBeenCalledOnce()
  })

  it('captures a stable anchor root and lets child popups inherit it', () => {
    const firstRoot = new FocusNode()
    const secondRoot = new FocusNode()
    const popup = makePopup({ x: 0, y: 0, w: 10, h: 10 })
    const child = makePopup({ x: 0, y: 0, w: 10, h: 10 })
    let activeRoot: RenderObject = firstRoot
    PopupManager.instance.setAnchorRootProvider(() => activeRoot)

    PopupManager.instance.open(popup)
    activeRoot = secondRoot
    PopupManager.instance.open(child, { parent: popup })

    expect(PopupManager.instance.activeAnchorRoot).toBe(firstRoot)

    PopupManager.instance.closeAll()
    PopupManager.instance.open(popup)

    expect(PopupManager.instance.activeAnchorRoot).toBe(secondRoot)
  })

  it('closes an anchored popup subtree when its render root is removed', () => {
    const anchoredRoot = new FocusNode()
    const otherRoot = new FocusNode()
    const closeRoot = vi.fn()
    const closeChild = vi.fn()
    const closeOther = vi.fn()
    const root = makePopup({ x: 0, y: 0, w: 10, h: 10, close: closeRoot })
    const child = makePopup({ x: 0, y: 0, w: 10, h: 10, close: closeChild })
    const other = makePopup({ x: 0, y: 0, w: 10, h: 10, close: closeOther })

    PopupManager.instance.open(root, { anchorRoot: anchoredRoot })
    PopupManager.instance.open(child, { parent: root })
    PopupManager.instance.open(other, { anchorRoot: otherRoot })

    expect(PopupManager.instance.closeAnchoredTo(anchoredRoot)).toBe(true)
    expect(closeChild).toHaveBeenCalledTimes(1)
    expect(closeRoot).toHaveBeenCalledTimes(1)
    expect(closeOther).not.toHaveBeenCalled()
    expect(PopupManager.instance.stack).toEqual([other])
  })

  it('inherits the executing popup anchor when a close callback opens another popup', () => {
    const anchoredRoot = new FocusNode()
    const otherRoot = new FocusNode()
    const closeReplacement = vi.fn()
    const replacement = makePopup({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      close: closeReplacement,
    })
    const first = makePopup({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      close: () => PopupManager.instance.open(replacement),
    })
    PopupManager.instance.setAnchorRootProvider(() => otherRoot)
    PopupManager.instance.open(first, { anchorRoot: anchoredRoot })

    expect(PopupManager.instance.closeAnchoredTo(anchoredRoot)).toBe(true)

    expect(closeReplacement).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.stack).toEqual([])
  })

  it('does not loop when an anchored popup reopens itself while closing', () => {
    const anchoredRoot = new FocusNode()
    const close = vi.fn(() => PopupManager.instance.open(popup))
    const popup = makePopup({ x: 0, y: 0, w: 10, h: 10, close })
    PopupManager.instance.open(popup, { anchorRoot: anchoredRoot })

    expect(PopupManager.instance.closeAnchoredTo(anchoredRoot)).toBe(true)

    expect(close).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.stack).toEqual([])
  })

  it('captures passive overlay anchors unless dynamic mode is requested', () => {
    const root = new FocusNode()
    let providedAnchor: RenderObject | undefined
    let providedMode: string | undefined
    PopupManager.instance.setAnchorRootProvider(() => root)
    PopupManager.instance.setContextProvider((anchorRoot, anchorMode) => {
      providedAnchor = anchorRoot
      providedMode = anchorMode
      return {
        theme: { label: 'theme' } as any,
        viewport: { width: 320, height: 180, dpr: 1 },
      }
    })
    const stable = makePopup({ x: 0, y: 0, w: 10, h: 10 })
    const dynamic = makePopup({ x: 0, y: 0, w: 10, h: 10 })

    PopupManager.instance.open(stable, { interactive: false })
    PopupManager.instance.contextFor(stable)
    expect(providedAnchor).toBe(root)
    expect(providedMode).toBe('stable')

    PopupManager.instance.open(dynamic, { anchorMode: 'dynamic', interactive: false })
    PopupManager.instance.contextFor(dynamic)
    expect(providedAnchor).toBeUndefined()
    expect(providedMode).toBe('dynamic')
  })

  it('continues closing and releases the popup focus scope when a close callback throws', () => {
    const previous = focusable()
    const closeHealthy = vi.fn()
    const closeFailure = vi.fn(() => { throw new Error('close failed') })
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const healthy = makePopup({ x: 0, y: 0, w: 10, h: 10, close: closeHealthy })
    const failing = makePopup({ x: 20, y: 20, w: 10, h: 10, close: closeFailure })
    FocusManager.instance.register(previous)
    FocusManager.instance.setFocus(previous)
    PopupManager.instance.open(healthy)
    PopupManager.instance.open(failing)

    expect(FocusManager.instance.scopeStack).toHaveLength(2)
    expect(() => PopupManager.instance.closeAll()).not.toThrow()

    expect(closeFailure).toHaveBeenCalledTimes(1)
    expect(closeHealthy).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.hasOpen).toBe(false)
    expect(FocusManager.instance.scopeStack).toHaveLength(1)
    expect(FocusManager.instance.current).toBe(previous)
    expect(errorLog).toHaveBeenCalledWith(
      'PopupManager popup close callback failed.',
      expect.any(Error),
    )
  })

  it('keeps nested popups in stack order and exposes the leaf as current', () => {
    const root = makePopup({ x: 0, y: 0, w: 100, h: 100 })
    const child = makePopup({ x: 40, y: 40, w: 40, h: 40 })

    PopupManager.instance.open(root)
    PopupManager.instance.open(child, { parent: root })

    expect(PopupManager.instance.stack).toEqual([root, child])
    expect(PopupManager.instance.current).toBe(child)
  })

  it('closes only the current popup subtree on closeTop', () => {
    const closeRoot = vi.fn()
    const closeChild = vi.fn()
    const root = makePopup({ x: 0, y: 0, w: 100, h: 100, close: closeRoot })
    const child = makePopup({ x: 40, y: 40, w: 40, h: 40, close: closeChild })

    PopupManager.instance.open(root)
    PopupManager.instance.open(child, { parent: root })

    expect(PopupManager.instance.closeTop()).toBe(true)
    expect(closeChild).toHaveBeenCalledTimes(1)
    expect(closeRoot).not.toHaveBeenCalled()
    expect(PopupManager.instance.stack).toEqual([root])
    expect(PopupManager.instance.current).toBe(root)
  })

  it('routes pointer down to the topmost hit popup', () => {
    const lowerDown = vi.fn()
    const upperDown = vi.fn()
    const lower = makePopup({ x: 0, y: 0, w: 30, h: 30, down: lowerDown })
    const upper = makePopup({ x: 10, y: 10, w: 30, h: 30, down: upperDown })

    PopupManager.instance.open(lower)
    PopupManager.instance.open(upper)

    expect(PopupManager.instance.handlePointerDown(pointerEvent('down', 15, 15))).toBe(true)
    expect(upperDown).toHaveBeenCalledTimes(1)
    expect(lowerDown).not.toHaveBeenCalled()
  })

  it('abandons a stale hit-test frame when the same pointer starts a nested sequence', () => {
    const manager = PopupManager.instance
    const down = vi.fn()
    const up = vi.fn()
    let nested = false
    const popup: Popup = {
      hitTest: () => {
        if (!nested) {
          nested = true
          expect(manager.handlePointerDown(
            pointerEvent('down', 10, 10, { pointerId: 4 }),
          )).toBe(true)
        }
        return true
      },
      close: vi.fn(),
      onPointerDown: down,
      onPointerUp: up,
    }
    manager.open(popup)

    expect(manager.handlePointerDown(
      pointerEvent('down', 10, 10, { pointerId: 4 }),
    )).toBe(true)
    manager.handlePointerUp(pointerEvent('up', 10, 10, { pointerId: 4 }))

    expect(down).toHaveBeenCalledOnce()
    expect(up).toHaveBeenCalledOnce()
  })

  it('blocks reentrant pointer move while a down is still resolving its owner', () => {
    const manager = PopupManager.instance
    const down = vi.fn()
    const move = vi.fn()
    let reentered = false
    const popup: Popup = {
      hitTest: () => {
        if (!reentered) {
          reentered = true
          expect(manager.handlePointerMove(
            pointerEvent('move', 10, 10, { pointerId: 6 }),
          )).toBe(true)
        }
        return true
      },
      close: vi.fn(),
      onPointerDown: down,
      onPointerMove: move,
    }
    manager.open(popup)

    expect(manager.handlePointerDown(
      pointerEvent('down', 10, 10, { pointerId: 6 }),
    )).toBe(true)

    expect(down).toHaveBeenCalledOnce()
    expect(move).not.toHaveBeenCalled()
  })

  it('terminates a pending down without dispatching an unmatched up', () => {
    const manager = PopupManager.instance
    const down = vi.fn()
    const up = vi.fn()
    let reentered = false
    const popup: Popup = {
      hitTest: () => {
        if (!reentered) {
          reentered = true
          manager.handlePointerUp(pointerEvent('up', 10, 10, { pointerId: 7 }))
        }
        return true
      },
      close: vi.fn(),
      onPointerDown: down,
      onPointerUp: up,
    }
    manager.open(popup)

    expect(manager.handlePointerDown(
      pointerEvent('down', 10, 10, { pointerId: 7 }),
    )).toBe(true)

    expect(down).not.toHaveBeenCalled()
    expect(up).not.toHaveBeenCalled()
  })

  it('terminates a pending down without dispatching an unmatched cancel', () => {
    const manager = PopupManager.instance
    const down = vi.fn()
    const cancel = vi.fn()
    let reentered = false
    const popup: Popup = {
      hitTest: () => {
        if (!reentered) {
          reentered = true
          expect(manager.handlePointerCancel(
            pointerEvent('cancel', 10, 10, { pointerId: 8 }),
          )).toBe(true)
        }
        return true
      },
      close: vi.fn(),
      onPointerDown: down,
      onPointerCancel: cancel,
    }
    manager.open(popup)

    expect(manager.handlePointerDown(
      pointerEvent('down', 10, 10, { pointerId: 8 }),
    )).toBe(true)

    expect(down).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('preserves a nested pointer generation when the stale down handler throws', () => {
    const manager = PopupManager.instance
    const move = vi.fn()
    let nested = false
    const popup: Popup = {
      hitTest: () => true,
      close: vi.fn(),
      onPointerDown: event => {
        if (nested) {
          event.setPointerCapture?.()
          return
        }
        nested = true
        manager.handlePointerDown(
          pointerEvent('down', 10, 10, { pointerId: 5 }),
        )
        throw new Error('outer down failed')
      },
      onPointerMove: move,
    }
    manager.setContextProvider(() => ({
      theme: {} as any,
      viewport: { width: 100, height: 100, dpr: 1 },
    }))
    manager.open(popup)

    expect(() => manager.handlePointerDown(
      pointerEvent('down', 10, 10, { pointerId: 5 }),
    )).toThrow('outer down failed')
    expect(manager.handlePointerMove(
      pointerEvent('move', 150, 150, { pointerId: 5 }),
    )).toBe(true)

    expect(move).toHaveBeenCalledOnce()
  })

  it('closes popups above the hit popup before routing to it', () => {
    const lowerDown = vi.fn()
    const closeUpper = vi.fn()
    const lower = makePopup({ x: 0, y: 0, w: 30, h: 30, down: lowerDown })
    const upper = makePopup({ x: 50, y: 50, w: 30, h: 30, close: closeUpper })

    PopupManager.instance.open(lower)
    PopupManager.instance.open(upper)

    expect(PopupManager.instance.handlePointerDown(pointerEvent('down', 5, 5))).toBe(true)
    expect(closeUpper).toHaveBeenCalledTimes(1)
    expect(lowerDown).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.stack).toEqual([lower])
  })

  it('does not penetrate a replacement popup opened while closing above the hit', () => {
    const manager = PopupManager.instance
    const lowerDown = vi.fn()
    const replacementUp = vi.fn()
    const lower = makePopup({ x: 0, y: 0, w: 30, h: 30, down: lowerDown })
    const replacement = makePopup({
      x: 0,
      y: 0,
      w: 30,
      h: 30,
      up: replacementUp,
    })
    const upper = makePopup({
      x: 50,
      y: 50,
      w: 30,
      h: 30,
      close: () => manager.open(replacement),
    })
    manager.open(lower)
    manager.open(upper)

    expect(manager.handlePointerDown(pointerEvent('down', 5, 5))).toBe(true)
    manager.handlePointerUp(pointerEvent('up', 5, 5))

    expect(lowerDown).not.toHaveBeenCalled()
    expect(replacementUp).not.toHaveBeenCalled()
    expect(manager.stack).toEqual([lower, replacement])
  })

  it('does not route a stale hit after closing a popup above removes it', () => {
    const lowerDown = vi.fn()
    let lower: Popup
    lower = makePopup({ x: 0, y: 0, w: 30, h: 30, down: lowerDown })
    const upper = makePopup({
      x: 50,
      y: 50,
      w: 30,
      h: 30,
      close: () => PopupManager.instance.dismiss(lower),
    })

    PopupManager.instance.open(lower)
    PopupManager.instance.open(upper)

    expect(PopupManager.instance.handlePointerDown(pointerEvent('down', 5, 5))).toBe(true)
    expect(lowerDown).not.toHaveBeenCalled()
    expect(PopupManager.instance.stack).toEqual([])
  })

  it('abandons hit traversal when a hit test removes the popup stack', () => {
    const manager = PopupManager.instance
    const lowerMove = vi.fn()
    const lower = makePopup({ x: 0, y: 0, w: 30, h: 30, move: lowerMove })
    const upper: Popup = {
      hitTest: () => {
        manager.closeAll()
        return false
      },
      close: vi.fn(),
    }

    manager.open(lower)
    manager.open(upper)

    expect(manager.handlePointerMove(pointerEvent('move', 10, 10))).toBe(true)
    expect(lowerMove).not.toHaveBeenCalled()
    expect(manager.stack).toEqual([])
  })

  it('does not dispatch to a popup removed by its own hit test', () => {
    const manager = PopupManager.instance
    const up = vi.fn()
    const wheel = vi.fn()
    let popup: Popup
    popup = {
      hitTest: () => {
        manager.dismiss(popup)
        return true
      },
      close: vi.fn(),
      onPointerUp: up,
      onWheel: wheel,
    }

    manager.open(popup)
    manager.handlePointerUp(pointerEvent('up', 10, 10))
    expect(up).not.toHaveBeenCalled()

    manager.open(popup)
    expect(manager.handleWheel(wheelEvent(10, 10))).toBe(true)
    expect(wheel).not.toHaveBeenCalled()
  })

  it('treats a stack-invalidated interactive probe as consumed', () => {
    const manager = PopupManager.instance
    let popup: Popup
    popup = {
      hitTest: () => {
        manager.dismiss(popup)
        return false
      },
      close: vi.fn(),
    }
    manager.open(popup)

    expect(manager.isInteractiveAt({ x: 10, y: 10 })).toBe(true)
    expect(manager.stack).toEqual([])
  })

  it('does not route a stale hit when the same popup object is reopened', () => {
    const lowerDown = vi.fn()
    const lower = makePopup({ x: 0, y: 0, w: 30, h: 30, down: lowerDown })
    const upper = makePopup({
      x: 50,
      y: 50,
      w: 30,
      h: 30,
      close: () => PopupManager.instance.open(lower),
    })

    PopupManager.instance.open(lower)
    PopupManager.instance.open(upper)

    expect(PopupManager.instance.handlePointerDown(pointerEvent('down', 5, 5))).toBe(true)
    expect(lowerDown).not.toHaveBeenCalled()
    expect(PopupManager.instance.stack).toEqual([lower])
  })

  it('closes nested descendant branches before routing to the hit ancestor popup', () => {
    const rootDown = vi.fn()
    const closeChild = vi.fn()
    const root = makePopup({ x: 0, y: 0, w: 100, h: 100, down: rootDown })
    const child = makePopup({ x: 40, y: 40, w: 40, h: 40, close: closeChild })

    PopupManager.instance.open(root)
    PopupManager.instance.open(child, { parent: root })

    expect(PopupManager.instance.handlePointerDown(pointerEvent('down', 10, 10))).toBe(true)
    expect(closeChild).toHaveBeenCalledTimes(1)
    expect(rootDown).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.stack).toEqual([root])
  })

  it('closes only the top popup for an outside pointer down', () => {
    const closeLower = vi.fn()
    const closeUpper = vi.fn()
    const lower = makePopup({ x: 0, y: 0, w: 30, h: 30, close: closeLower })
    const upper = makePopup({ x: 50, y: 50, w: 30, h: 30, close: closeUpper })

    PopupManager.instance.open(lower)
    PopupManager.instance.open(upper)

    expect(PopupManager.instance.handlePointerDown(pointerEvent('down', 100, 100))).toBe(false)
    expect(closeUpper).toHaveBeenCalledTimes(1)
    expect(closeLower).not.toHaveBeenCalled()
    expect(PopupManager.instance.stack).toEqual([lower])
  })

  it('closes the active root branch for a nested outside pointer down', () => {
    const closeRoot = vi.fn()
    const closeChild = vi.fn()
    const root = makePopup({ x: 0, y: 0, w: 100, h: 100, close: closeRoot })
    const child = makePopup({ x: 40, y: 40, w: 40, h: 40, close: closeChild })

    PopupManager.instance.open(root)
    PopupManager.instance.open(child, { parent: root })

    expect(PopupManager.instance.handlePointerDown(pointerEvent('down', 180, 180))).toBe(false)
    expect(closeChild).toHaveBeenCalledTimes(1)
    expect(closeRoot).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.stack).toEqual([])
  })

  it('runs the active leaf outside hook before closing ancestor popups', () => {
    const outsideLeaf = vi.fn()
    const closeRoot = vi.fn()
    const closeLeaf = vi.fn()
    const root = makePopup({ x: 0, y: 0, w: 100, h: 100, close: closeRoot })
    const leaf = makePopup({
      x: 40,
      y: 40,
      w: 40,
      h: 40,
      close: closeLeaf,
      outside: () => {
        outsideLeaf()
        return false
      },
    })

    PopupManager.instance.open(root)
    PopupManager.instance.open(leaf, { parent: root })

    expect(PopupManager.instance.handlePointerDown(pointerEvent('down', 180, 180))).toBe(false)
    expect(outsideLeaf).toHaveBeenCalledTimes(1)
    expect(closeLeaf).toHaveBeenCalledTimes(1)
    expect(closeRoot).toHaveBeenCalledTimes(1)
  })

  it('routes move, up, and wheel to the topmost hit popup', () => {
    const lowerMove = vi.fn()
    const lowerUp = vi.fn()
    const lowerWheel = vi.fn()
    const upperMove = vi.fn()
    const upperUp = vi.fn()
    const upperWheel = vi.fn()
    const lower = makePopup({
      x: 0, y: 0, w: 40, h: 40,
      move: lowerMove, up: lowerUp, wheel: lowerWheel,
    })
    const upper = makePopup({
      x: 10, y: 10, w: 40, h: 40,
      move: upperMove, up: upperUp, wheel: upperWheel,
    })

    PopupManager.instance.open(lower)
    PopupManager.instance.open(upper)

    PopupManager.instance.handlePointerMove(pointerEvent('move', 20, 20))
    PopupManager.instance.handlePointerUp(pointerEvent('up', 20, 20))
    expect(PopupManager.instance.handleWheel(wheelEvent(20, 20))).toBe(true)

    expect(upperMove).toHaveBeenCalledTimes(1)
    expect(upperUp).toHaveBeenCalledTimes(1)
    expect(upperWheel).toHaveBeenCalledTimes(1)
    expect(lowerMove).not.toHaveBeenCalled()
    expect(lowerUp).not.toHaveBeenCalled()
    expect(lowerWheel).not.toHaveBeenCalled()
  })

  it('keeps routing a captured popup pointer outside the viewport until release', () => {
    const move = vi.fn()
    const up = vi.fn()
    const popup = makePopup({
      x: 0,
      y: 0,
      w: 40,
      h: 40,
      down: event => event.setPointerCapture?.(),
      move,
      up,
    })
    PopupManager.instance.setContextProvider(() => ({
      theme: {} as any,
      viewport: { width: 100, height: 100, dpr: 1 },
    }))
    PopupManager.instance.open(popup)

    expect(PopupManager.instance.handlePointerDown(pointerEvent('down', 20, 20))).toBe(true)
    expect(PopupManager.instance.handlePointerMove(pointerEvent('move', 150, 150))).toBe(true)
    PopupManager.instance.handlePointerUp(pointerEvent('up', 150, 150))

    expect(move).toHaveBeenCalledTimes(1)
    expect(up).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.handlePointerMove(pointerEvent('move', 150, 150))).toBe(false)
  })

  it('does not redirect an ending pointer sequence to a replacement popup', () => {
    const replacementUp = vi.fn()
    const replacement = makePopup({
      x: 0,
      y: 0,
      w: 40,
      h: 40,
      up: replacementUp,
    })
    const original = makePopup({
      x: 0,
      y: 0,
      w: 40,
      h: 40,
      down: () => {
        PopupManager.instance.closeAll()
        PopupManager.instance.open(replacement)
      },
    })
    PopupManager.instance.open(original)

    expect(PopupManager.instance.handlePointerDown(pointerEvent('down', 20, 20))).toBe(true)
    PopupManager.instance.handlePointerUp(pointerEvent('up', 20, 20))

    expect(replacementUp).not.toHaveBeenCalled()
  })

  it('tombstones a same-pointer down attempted during terminal dispatch', () => {
    const manager = PopupManager.instance
    const up = vi.fn(() => {
      expect(manager.handlePointerDown(
        pointerEvent('down', 20, 20, { pointerId: 9 }),
      )).toBe(true)
    })
    const popup = makePopup({
      x: 0,
      y: 0,
      w: 40,
      h: 40,
      up,
    })
    manager.open(popup)
    manager.handlePointerDown(pointerEvent('down', 20, 20, { pointerId: 9 }))

    manager.handlePointerUp(pointerEvent('up', 20, 20, { pointerId: 9 }))
    manager.handlePointerUp(pointerEvent('up', 20, 20, { pointerId: 9 }))

    expect(up).toHaveBeenCalledOnce()
  })

  it('does not redirect a cancelled pointer sequence to a replacement popup', () => {
    const replacementCancel = vi.fn()
    const replacement = makePopup({
      x: 0,
      y: 0,
      w: 40,
      h: 40,
      cancel: replacementCancel,
    })
    const original = makePopup({
      x: 0,
      y: 0,
      w: 40,
      h: 40,
      down: () => {
        PopupManager.instance.closeAll()
        PopupManager.instance.open(replacement)
      },
    })
    PopupManager.instance.open(original)

    expect(PopupManager.instance.handlePointerDown(pointerEvent('down', 20, 20))).toBe(true)
    expect(PopupManager.instance.handlePointerCancel(pointerEvent('cancel', 20, 20))).toBe(true)
    expect(replacementCancel).not.toHaveBeenCalled()
  })

  it('tombstones an outside-down sequence when its hook opens a replacement popup', () => {
    const replacementUp = vi.fn()
    const replacementCancel = vi.fn()
    const replacement = makePopup({
      x: 10,
      y: 10,
      w: 40,
      h: 40,
      up: replacementUp,
      cancel: replacementCancel,
    })
    const original = makePopup({
      x: 0,
      y: 0,
      w: 5,
      h: 5,
      outside: () => {
        PopupManager.instance.open(replacement)
        return true
      },
    })
    PopupManager.instance.open(original)

    expect(PopupManager.instance.handlePointerDown(
      pointerEvent('down', 20, 20, { pointerId: 1 }),
    )).toBe(true)
    PopupManager.instance.handlePointerUp(pointerEvent('up', 20, 20, { pointerId: 1 }))

    PopupManager.instance.closeAll()
    PopupManager.instance.open(original)
    expect(PopupManager.instance.handlePointerDown(
      pointerEvent('down', 20, 20, { pointerId: 2 }),
    )).toBe(true)
    expect(PopupManager.instance.handlePointerCancel(
      pointerEvent('cancel', 20, 20, { pointerId: 2 }),
    )).toBe(true)

    expect(replacementUp).not.toHaveBeenCalled()
    expect(replacementCancel).not.toHaveBeenCalled()
  })

  it('tombstones every active pointer when its popup generation closes', () => {
    const replacementUp = vi.fn()
    const replacementCancel = vi.fn()
    const original = makePopup({ x: 0, y: 0, w: 40, h: 40 })
    const replacement = makePopup({
      x: 0,
      y: 0,
      w: 40,
      h: 40,
      up: replacementUp,
      cancel: replacementCancel,
    })
    PopupManager.instance.open(original)
    PopupManager.instance.handlePointerDown(pointerEvent('down', 20, 20, { pointerId: 1 }))
    PopupManager.instance.handlePointerDown(pointerEvent('down', 20, 20, { pointerId: 2 }))

    PopupManager.instance.closeAll()
    PopupManager.instance.open(replacement)
    PopupManager.instance.handlePointerUp(pointerEvent('up', 20, 20, { pointerId: 1 }))
    PopupManager.instance.handlePointerCancel(pointerEvent('cancel', 20, 20, { pointerId: 2 }))

    expect(replacementUp).not.toHaveBeenCalled()
    expect(replacementCancel).not.toHaveBeenCalled()
  })

  it('falls back to outer wheel handling when the hit popup declines wheel', () => {
    const wheel = vi.fn(() => false)
    const popup = makePopup({
      x: 0,
      y: 0,
      w: 40,
      h: 40,
      wheel,
    })

    PopupManager.instance.open(popup)

    expect(PopupManager.instance.handleWheel(wheelEvent(20, 20))).toBe(false)
    expect(wheel).toHaveBeenCalledTimes(1)
  })

  it('resets the cursor to default after routing popup pointer move when the popup does not own a cursor', () => {
    const calls: string[] = []
    const popup = makePopup({
      x: 0,
      y: 0,
      w: 40,
      h: 40,
      move: () => { calls.push('move') },
    })

    PopupManager.instance.setContextProvider(() => ({
      theme: { label: 'theme' } as any,
      viewport: { width: 320, height: 180, dpr: 1 },
      setCursor: cursor => { calls.push(cursor) },
    }))
    PopupManager.instance.open(popup)

    expect(PopupManager.instance.handlePointerMove(pointerEvent('move', 20, 20))).toBe(true)
    expect(calls).toEqual(['move', 'default'])
  })

  it('routes pointer cancel to the current interactive popup', () => {
    const lowerCancel = vi.fn()
    const upperCancel = vi.fn()
    const lower = makePopup({ x: 0, y: 0, w: 30, h: 30, cancel: lowerCancel })
    const upper = makePopup({ x: 10, y: 10, w: 30, h: 30, cancel: upperCancel })

    PopupManager.instance.open(lower)
    PopupManager.instance.open(upper)

    expect(PopupManager.instance.handlePointerCancel(pointerEvent('cancel', 200, 200))).toBe(true)
    expect(upperCancel).toHaveBeenCalledTimes(1)
    expect(lowerCancel).not.toHaveBeenCalled()
  })

  it('removes a popup from the middle of the stack when it closes itself', () => {
    const first = makePopup({ x: 0, y: 0, w: 10, h: 10 })
    const second = makePopup({ x: 20, y: 20, w: 10, h: 10 })
    const third = makePopup({ x: 40, y: 40, w: 10, h: 10 })

    PopupManager.instance.open(first)
    PopupManager.instance.open(second)
    PopupManager.instance.open(third)
    PopupManager.instance.dismiss(second)

    expect(PopupManager.instance.stack).toEqual([first, third])
    expect(PopupManager.instance.current).toBe(third)
  })

  it('closes descendants when a parent popup closes itself', () => {
    const closeChild = vi.fn()
    const root = makePopup({ x: 0, y: 0, w: 100, h: 100 })
    const child = makePopup({ x: 40, y: 40, w: 40, h: 40, close: closeChild })

    PopupManager.instance.open(root)
    PopupManager.instance.open(child, { parent: root })
    PopupManager.instance.dismiss(root)

    expect(closeChild).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.stack).toEqual([])
    expect(PopupManager.instance.current).toBe(null)
  })

  it('keeps passive overlays out of pointer routing', () => {
    const closeInteractive = vi.fn()
    const closePassive = vi.fn()
    const interactive = makePopup({ x: 0, y: 0, w: 30, h: 30, close: closeInteractive })
    const passive = makePopup({ x: 0, y: 0, w: 100, h: 100, close: closePassive })

    PopupManager.instance.open(interactive)
    PopupManager.instance.open(passive, { interactive: false })

    expect(PopupManager.instance.stack).toEqual([interactive, passive])
    expect(PopupManager.instance.top).toBe(passive)
    expect(PopupManager.instance.current).toBe(interactive)
    expect(PopupManager.instance.hasOpen).toBe(true)
    expect(PopupManager.instance.hasOverlays).toBe(true)

    expect(PopupManager.instance.handlePointerDown(pointerEvent('down', 80, 80))).toBe(false)
    expect(closeInteractive).toHaveBeenCalledTimes(1)
    expect(closePassive).not.toHaveBeenCalled()
    expect(PopupManager.instance.stack).toEqual([passive])
    expect(PopupManager.instance.current).toBe(null)
    expect(PopupManager.instance.hasOpen).toBe(false)
    expect(PopupManager.instance.hasOverlays).toBe(true)
  })

  it('routes nonmodal hits without making the overlay current or closing a popup below', () => {
    const closePopup = vi.fn()
    const down = vi.fn()
    const popup = makePopup({ x: 0, y: 0, w: 30, h: 30, close: closePopup })
    const nonmodal = makePopup({ x: 40, y: 40, w: 40, h: 40, down })

    PopupManager.instance.open(popup)
    PopupManager.instance.open(nonmodal, { interactionMode: 'nonmodal' })

    expect(PopupManager.instance.current).toBe(popup)
    expect(PopupManager.instance.handlePointerDown(pointerEvent('down', 50, 50))).toBe(true)
    expect(down).toHaveBeenCalledTimes(1)
    expect(closePopup).not.toHaveBeenCalled()
    expect(PopupManager.instance.current).toBe(popup)
  })

  it('notifies the previous nonmodal hover owner when the pointer moves outside it', () => {
    const move = vi.fn()
    const nonmodal = makePopup({ x: 40, y: 40, w: 40, h: 40, move })
    PopupManager.instance.open(nonmodal, { interactionMode: 'nonmodal' })

    expect(PopupManager.instance.handlePointerMove(pointerEvent('move', 50, 50))).toBe(true)
    expect(PopupManager.instance.handlePointerMove(pointerEvent('move', 10, 10))).toBe(false)

    expect(move).toHaveBeenCalledTimes(2)
    expect(move.mock.calls[1]?.[0].position).toEqual({ x: 10, y: 10 })
  })

  it('preserves hover cleanup when the same overlay is reopened with a passive mode', () => {
    const move = vi.fn()
    const overlay = makePopup({ x: 40, y: 40, w: 40, h: 40, move })
    PopupManager.instance.open(overlay, { interactionMode: 'nonmodal' })
    PopupManager.instance.handlePointerMove(pointerEvent('move', 50, 50))

    PopupManager.instance.open(overlay, { interactionMode: 'passive' })

    expect(PopupManager.instance.handlePointerMove(pointerEvent('move', 10, 10))).toBe(false)
    expect(move).toHaveBeenCalledTimes(2)
    expect(move.mock.calls[1]?.[0].position).toEqual({ x: 10, y: 10 })
  })

  it('rejects mixed legacy and new interaction options', () => {
    const existing = makePopup({ x: 0, y: 0, w: 10, h: 10 })
    const invalid = makePopup({ x: 0, y: 0, w: 10, h: 10 })
    PopupManager.instance.open(existing)
    expect(() => PopupManager.instance.open(invalid, {
      interactive: false,
      interactionMode: 'nonmodal',
    })).toThrow('cannot be used together')
    expect(PopupManager.instance.stack).toEqual([existing])
    expect(PopupManager.instance.current).toBe(existing)
  })

  it('closes owned popup subtrees even when descendants have different owners', () => {
    const rootOwner = {}
    const childOwner = {}
    const closeRoot = vi.fn()
    const closeChild = vi.fn()
    const root = makePopup({ x: 0, y: 0, w: 100, h: 100, close: closeRoot })
    const child = makePopup({ x: 40, y: 40, w: 40, h: 40, close: closeChild })

    PopupManager.instance.open(root, { owner: rootOwner })
    PopupManager.instance.open(child, { owner: childOwner, parent: root })

    expect(PopupManager.instance.closeOwnedBy(rootOwner)).toBe(true)
    expect(closeChild).toHaveBeenCalledTimes(1)
    expect(closeRoot).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.stack).toEqual([])
  })

  it('exposes popup context through the configured provider', () => {
    PopupManager.instance.setContextProvider(() => ({
      theme: { label: 'theme' } as any,
      viewport: { width: 320, height: 180, dpr: 2 },
    }))

    expect(PopupManager.instance.context).toMatchObject({
      theme: { label: 'theme' },
      viewport: { width: 320, height: 180, dpr: 2 },
    })
  })

  it('routes pointer interactions with the latest popup context snapshot', () => {
    let viewport = { width: 320, height: 180, dpr: 2 }
    const down = vi.fn()
    const popup = {
      ...makePopup({ x: 0, y: 0, w: 10, h: 10 }),
      onPointerDown: down,
    }
    PopupManager.instance.setContextProvider(() => ({
      theme: { label: 'theme' } as any,
      viewport,
    }))

    PopupManager.instance.open(popup)
    PopupManager.instance.handlePointerDown(pointerEvent('down', 5, 5))
    viewport = { width: 640, height: 360, dpr: 1 }
    PopupManager.instance.handlePointerDown(pointerEvent('down', 5, 5))

    expect(down).toHaveBeenNthCalledWith(1, expect.objectContaining({
      pointerId: 0,
      position: { x: 5, y: 5 },
      type: 'down',
    }), expect.objectContaining({
      viewport: { width: 320, height: 180, dpr: 2 },
    }))
    expect(down).toHaveBeenNthCalledWith(2, expect.objectContaining({
      pointerId: 0,
      position: { x: 5, y: 5 },
      type: 'down',
    }), expect.objectContaining({
      viewport: { width: 640, height: 360, dpr: 1 },
    }))
  })

  it('pushes a shared popup focus scope and restores focus after the last popup closes', () => {
    const previous = focusable()
    FocusManager.instance.register(previous)
    FocusManager.instance.setFocus(previous)
    const popup = makePopup({ x: 0, y: 0, w: 10, h: 10 })

    PopupManager.instance.open(popup)

    expect(FocusManager.instance.current).toBe(null)

    PopupManager.instance.closeTop()

    expect(FocusManager.instance.current).toBe(previous)
    expect(previous.isFocused).toBe(true)
  })

  it('syncs popup focus roots so Tab traversal stays inside popup render content', () => {
    const root = new FocusNode()
    const first = new FocusNode()
    const second = new FocusNode()
    root.addChild(first)
    root.addChild(second)
    FocusManager.instance.register(second)
    FocusManager.instance.register(first)
    const popup = makePopup({
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      focusRoots: () => [root],
    })

    PopupManager.instance.open(popup)

    expect(FocusManager.instance.handleKeyDownEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    }))).toBe(true)
    expect(FocusManager.instance.current).toBe(first)

    expect(FocusManager.instance.handleKeyDownEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    }))).toBe(true)
    expect(FocusManager.instance.current).toBe(second)
  })

  it('routes keydown to the top popup only', () => {
    const lowerKey = vi.fn(() => true)
    const upperKey = vi.fn(() => true)
    const lower = makePopup({ x: 0, y: 0, w: 10, h: 10, key: lowerKey })
    const upper = makePopup({ x: 20, y: 20, w: 10, h: 10, key: upperKey })

    PopupManager.instance.open(lower)
    PopupManager.instance.open(upper)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))

    expect(upperKey).toHaveBeenCalledTimes(1)
    expect(lowerKey).not.toHaveBeenCalled()
  })

  it('closes popups from the top down on Escape', () => {
    const closeLower = vi.fn()
    const closeUpper = vi.fn()
    const lower = makePopup({ x: 0, y: 0, w: 10, h: 10, close: closeLower })
    const upper = makePopup({ x: 20, y: 20, w: 10, h: 10, close: closeUpper })

    PopupManager.instance.open(lower)
    PopupManager.instance.open(upper)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(closeUpper).toHaveBeenCalledTimes(1)
    expect(closeLower).not.toHaveBeenCalled()
    expect(PopupManager.instance.current).toBe(lower)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(closeLower).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.current).toBe(null)
  })

  it('closes only the active leaf branch on Escape when popups are nested', () => {
    const closeRoot = vi.fn()
    const closeChild = vi.fn()
    const root = makePopup({ x: 0, y: 0, w: 100, h: 100, close: closeRoot })
    const child = makePopup({ x: 40, y: 40, w: 40, h: 40, close: closeChild })

    PopupManager.instance.open(root)
    PopupManager.instance.open(child, { parent: root })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(closeChild).toHaveBeenCalledTimes(1)
    expect(closeRoot).not.toHaveBeenCalled()
    expect(PopupManager.instance.current).toBe(root)
  })

  it('uses the outside-click hook before falling back to close', () => {
    const outside = vi.fn()
    const close = vi.fn()
    let popup: Popup
    popup = makePopup({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      close,
      outside: () => {
        outside()
        PopupManager.instance.dismiss(popup)
        return false
      },
    })

    PopupManager.instance.open(popup)

    expect(PopupManager.instance.handlePointerDown(pointerEvent('down', 20, 20))).toBe(false)
    expect(outside).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.current).toBe(null)
  })

  it('still closes the popup when outside-click hook returns false', () => {
    const close = vi.fn()
    const popup = makePopup({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      close,
      outside: () => false,
    })

    PopupManager.instance.open(popup)
    PopupManager.instance.handlePointerDown(pointerEvent('down', 30, 30))

    expect(close).toHaveBeenCalledTimes(1)
    expect(PopupManager.instance.current).toBe(null)
  })
})

describe('PopupManager paint invalidation', () => {
  it('uses a shared paint invalidator before the legacy fallback', () => {
    const fallback = vi.fn()
    const invalidator = vi.fn()

    PopupManager.instance.requestPaint(fallback)

    expect(fallback).toHaveBeenCalledTimes(1)

    PopupManager.instance.setPaintInvalidator(invalidator)
    PopupManager.instance.requestPaint(fallback)

    expect(invalidator).toHaveBeenCalledTimes(1)
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('suppresses repaint requests while disposing popups', () => {
    const fallback = vi.fn()
    const popup: Popup = {
      hitTest: () => true,
      close: () => PopupManager.instance.requestPaint(fallback),
    }

    PopupManager.instance.open(popup)
    PopupManager.instance.dispose()

    expect(fallback).not.toHaveBeenCalled()
  })

  it('drains popups opened by close callbacks during disposal', () => {
    const manager = PopupManager.instance
    const closeReplacement = vi.fn()
    const replacement = makePopup({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      close: closeReplacement,
    })
    const closeOriginal = vi.fn(() => {
      manager.open(replacement)
      manager.dispose()
    })
    const original = makePopup({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      close: closeOriginal,
    })
    manager.open(original)

    manager.dispose()
    manager.open(replacement)

    expect(closeOriginal).toHaveBeenCalledTimes(1)
    expect(closeReplacement).toHaveBeenCalledTimes(1)
    expect(manager.stack).toEqual([])
  })

  it('closes a new lifecycle when the same popup reopens once during disposal', () => {
    const manager = PopupManager.instance
    let visible = true
    let reopened = false
    const close = vi.fn(() => {
      visible = false
      if (reopened) return
      reopened = true
      visible = true
      manager.open(popup)
    })
    const popup = makePopup({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      close,
    })
    manager.open(popup)

    manager.dispose()

    expect(close).toHaveBeenCalledTimes(2)
    expect(visible).toBe(false)
    expect(manager.stack).toEqual([])
  })

  it('finishes disposal and releases the singleton when focus cleanup throws', () => {
    const manager = PopupManager.instance
    const focusRoot = new ThrowingFocusNode()
    const popup = makePopup({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      focusRoots: () => [focusRoot],
    })
    FocusManager.instance.register(focusRoot)
    manager.open(popup)
    FocusManager.instance.setFocus(focusRoot)

    expect(() => manager.dispose()).toThrow('focusOut failed')

    expect(FocusManager.instance.scopeStack).toHaveLength(1)
    expect(manager.stack).toEqual([])
    manager.open(popup)
    expect(manager.stack).toEqual([])
    expect(PopupManager.instance).not.toBe(manager)
  })

  it('drains a popup opened reentrantly while the old popup scope loses focus', () => {
    const manager = PopupManager.instance
    const closeReplacement = vi.fn()
    const replacement = makePopup({
      x: 20,
      y: 20,
      w: 10,
      h: 10,
      close: closeReplacement,
    })
    const focusRoot = new ReopeningFocusNode(() => manager.open(replacement))
    const original = makePopup({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      focusRoots: () => [focusRoot],
    })
    FocusManager.instance.register(focusRoot)
    manager.open(original)
    FocusManager.instance.setFocus(focusRoot)

    manager.dispose()

    expect(closeReplacement).toHaveBeenCalledOnce()
    expect(manager.stack).toEqual([])
    expect(FocusManager.instance.scopeStack).toHaveLength(1)
    expect(PopupManager.instance).not.toBe(manager)
  })
})
