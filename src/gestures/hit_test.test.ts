import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DispatchPhase,
  HitTestResult,
  resolveHitTestLocalPosition,
  sameHitTestEntryIdentity,
} from './hit_test'
import { PopupManager } from '../core/popup_manager'
import { EventDispatcher } from './recognizers'
import { RenderObject, type Offset, type BoxConstraints, type Size } from '../core/render_object'
import type { PaintContext } from '../rendering/paint_context'
import type { HitTestTarget } from './hit_test'

// ---- 测试辅助 ----

class TestRenderObject extends RenderObject {
  children: TestRenderObject[] = []
  private _hitTestOverride?: (point: Offset) => boolean

  constructor(opts?: {
    width?: number
    height?: number
    hitTestOverride?: (point: Offset) => boolean
  }) {
    super()
    if (opts?.width && opts?.height) {
      this.size = { width: opts.width, height: opts.height }
    }
    this._hitTestOverride = opts?.hitTestOverride
  }

  addChild(child: TestRenderObject): void {
    child.parent = this
    this.children.push(child)
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    for (const child of this.children) visitor(child)
  }

  performLayout(constraints: BoxConstraints): void {
    this.size = this.size.width > 0 ? this.size : { width: constraints.maxWidth, height: constraints.maxHeight }
    for (const child of this.children) child.layout(constraints)
  }

  performPaint(_context: PaintContext, _offset: Offset): void {}

  hitTest(point: Offset): boolean {
    if (this._hitTestOverride) return this._hitTestOverride(point)
    return super.hitTest(point)
  }
}

// ---- HitTestResult 测试 ----

describe('HitTestResult', () => {
  it('collects entries in path order (ancestor first, leaf last)', () => {
    const result = new HitTestResult()
    const targetA = {} as HitTestTarget
    const targetB = {} as HitTestTarget
    const targetC = {} as HitTestTarget

    result.add({ target: targetA, localPosition: { x: 0, y: 0 } })
    result.add({ target: targetB, localPosition: { x: 10, y: 10 } })
    result.add({ target: targetC, localPosition: { x: 20, y: 20 } })

    expect(result.path.length).toBe(3)
    expect(result.path[0]!.target).toBe(targetA)
    expect(result.path[1]!.target).toBe(targetB)
    expect(result.path[2]!.target).toBe(targetC)
  })

  it('returns first as nearest ancestor', () => {
    const result = new HitTestResult()
    const target = {} as HitTestTarget
    result.add({ target, localPosition: { x: 0, y: 0 } })
    expect(result.first!.target).toBe(target)
  })

  it('returns deepest as leaf node', () => {
    const result = new HitTestResult()
    const targetA = {} as HitTestTarget
    const targetB = {} as HitTestTarget
    result.add({ target: targetA, localPosition: { x: 0, y: 0 } })
    result.add({ target: targetB, localPosition: { x: 10, y: 10 } })
    expect(result.deepest!.target).toBe(targetB)
  })

  it('returns undefined first/deepest for empty result', () => {
    const result = new HitTestResult()
    expect(result.first).toBeUndefined()
    expect(result.deepest).toBeUndefined()
    expect(result.isEmpty).toBe(true)
  })

  it('interactiveTargets filters targets with pointer callbacks', () => {
    const result = new HitTestResult()
    const passive = {} as HitTestTarget
    const active = { onPointerDown: vi.fn() } as unknown as HitTestTarget
    result.add({ target: passive, localPosition: { x: 0, y: 0 } })
    result.add({ target: active, localPosition: { x: 10, y: 10 } })

    const interactive = result.interactiveTargets()
    expect(interactive).toHaveLength(1)
    expect(interactive[0]).toBe(active)
  })

  it('contains checks target membership', () => {
    const result = new HitTestResult()
    const targetA = {} as HitTestTarget
    const targetB = {} as HitTestTarget
    result.add({ target: targetA, localPosition: { x: 0, y: 0 } })

    expect(result.contains(targetA)).toBe(true)
    expect(result.contains(targetB)).toBe(false)
  })

  it('compares semantic identity by target and Object.is key', () => {
    const target = {} as HitTestTarget
    const otherTarget = {} as HitTestTarget

    expect(sameHitTestEntryIdentity(
      { target, key: 'stepper-up' },
      { target, key: 'stepper-up' },
    )).toBe(true)
    expect(sameHitTestEntryIdentity(
      { target, key: Number.NaN },
      { target, key: Number.NaN },
    )).toBe(true)
    expect(sameHitTestEntryIdentity(
      { target, key: 'stepper-up' },
      { target, key: 'stepper-down' },
    )).toBe(false)
    expect(sameHitTestEntryIdentity(
      { target, key: 'stepper-up' },
      { target: otherTarget, key: 'stepper-up' },
    )).toBe(false)
  })

  it('retains semantic metadata when selecting interactive entries and path prefixes', () => {
    const root = { onPointerDown: vi.fn() } as HitTestTarget
    const region = { onPointerDown: vi.fn() } as HitTestTarget
    const data = { row: 3 }
    const result = new HitTestResult()
    const rootEntry = { target: root, localPosition: { x: 5, y: 6 } }
    const regionEntry = {
      target: region,
      localPosition: { x: 1, y: 2 },
      key: 'increase',
      data,
    }
    result.add(rootEntry)
    result.add(regionEntry)

    expect(result.interactiveEntries()).toEqual([rootEntry, regionEntry])
    expect(result.through(regionEntry).path).toEqual([rootEntry, regionEntry])
    expect(result.interactiveTargets()).toEqual([root, region])
  })

  it('resolves current local positions through live coordinate spaces', () => {
    const target = {} as HitTestTarget
    const offsetSpace = { globalOffset: { x: 10, y: 20 } }
    const entry = {
      target,
      localPosition: { x: 0, y: 0 },
      coordinateSpace: offsetSpace,
    }

    expect(resolveHitTestLocalPosition(entry, { x: 25, y: 45 })).toEqual({ x: 15, y: 25 })

    offsetSpace.globalOffset = { x: 20, y: 30 }
    expect(resolveHitTestLocalPosition(entry, { x: 25, y: 45 })).toEqual({ x: 5, y: 15 })
  })

  it('retains the legacy propagation helpers without coupling routed dispatches to them', () => {
    const result = new HitTestResult()
    const event = result.createDispatchEvent(DispatchPhase.Bubble, { x: 0, y: 0 })

    expect(result.propagationStopped).toBe(false)
    event.stopPropagation()
    expect(result.propagationStopped).toBe(true)
    result.resetPropagation()
    expect(result.propagationStopped).toBe(false)
  })
})

// ---- RenderObject hitTestPath 测试 ----

describe('RenderObject.hitTestPath', () => {
  it('collects path from root to leaf on hit', () => {
    const root = new TestRenderObject({ width: 200, height: 200 })
    root.offset = { x: 0, y: 0 }
    root.size = { width: 200, height: 200 }
    root.performLayout = () => {}
    const child = new TestRenderObject({ width: 50, height: 50 })
    child.offset = { x: 10, y: 10 }
    child.size = { width: 50, height: 50 }
    child.parent = root
    root.children = [child]

    const result = new HitTestResult()
    const hit = root.hitTestPath({ x: 30, y: 30 }, result)

    expect(hit).toBe(true)
    expect(result.path.map(e => e.target)).toEqual([
      root as unknown as HitTestTarget,
      child as unknown as HitTestTarget,
    ])
  })

  it('returns empty result for miss', () => {
    const root = new TestRenderObject({ width: 100, height: 100 })
    root.offset = { x: 0, y: 0 }
    root.size = { width: 100, height: 100 }

    const result = new HitTestResult()
    const hit = root.hitTestPath({ x: 200, y: 200 }, result)

    expect(hit).toBe(false)
    expect(result.isEmpty).toBe(true)
  })

  it('prefers later children (reverse order) for hit testing', () => {
    const root = new TestRenderObject({ width: 200, height: 200 })
    root.offset = { x: 0, y: 0 }
    root.size = { width: 200, height: 200 }

    const childA = new TestRenderObject({ width: 50, height: 50 })
    childA.offset = { x: 10, y: 10 }
    childA.size = { width: 50, height: 50 }
    childA.parent = root

    const childB = new TestRenderObject({ width: 50, height: 50 })
    childB.offset = { x: 10, y: 10 }
    childB.size = { width: 50, height: 50 }
    childB.parent = root

    root.children = [childA, childB]

    // Point inside both children — last child (childB) should be deepest
    const result = new HitTestResult()
    root.hitTestPath({ x: 30, y: 30 }, result)

    // childB should be in the path (as it's visited in reverse order)
    const targets = result.path.map(e => e.target)
    expect(targets).toContain(childB as unknown as HitTestTarget)
  })

  it('keeps only the topmost sibling branch in the hit path', () => {
    const root = new TestRenderObject({ width: 200, height: 200 })
    root.offset = { x: 0, y: 0 }
    root.size = { width: 200, height: 200 }

    const lower = new TestRenderObject({ width: 80, height: 80 })
    lower.offset = { x: 10, y: 10 }
    lower.size = { width: 80, height: 80 }
    lower.parent = root

    const upper = new TestRenderObject({ width: 80, height: 80 })
    upper.offset = { x: 10, y: 10 }
    upper.size = { width: 80, height: 80 }
    upper.parent = root

    const upperLeaf = new TestRenderObject({ width: 20, height: 20 })
    upperLeaf.offset = { x: 5, y: 5 }
    upperLeaf.size = { width: 20, height: 20 }
    upperLeaf.parent = upper
    upper.children = [upperLeaf]
    root.children = [lower, upper]

    const result = new HitTestResult()
    const hit = root.hitTestPath({ x: 20, y: 20 }, result)

    expect(hit).toBe(true)
    expect(result.path.map(entry => entry.target)).toEqual([
      root as unknown as HitTestTarget,
      upper as unknown as HitTestTarget,
      upperLeaf as unknown as HitTestTarget,
    ])
  })

  it('stops sibling search after the frontmost child hits', () => {
    const lowerHit = vi.fn(() => true)
    const upperHit = vi.fn(() => true)
    const root = new TestRenderObject({ width: 200, height: 200 })
    root.offset = { x: 0, y: 0 }
    root.size = { width: 200, height: 200 }

    const lower = new TestRenderObject({ width: 80, height: 80, hitTestOverride: lowerHit })
    lower.offset = { x: 10, y: 10 }
    lower.size = { width: 80, height: 80 }
    lower.parent = root

    const upper = new TestRenderObject({ width: 80, height: 80, hitTestOverride: upperHit })
    upper.offset = { x: 10, y: 10 }
    upper.size = { width: 80, height: 80 }
    upper.parent = root

    root.children = [lower, upper]

    const result = new HitTestResult()
    const hit = root.hitTestPath({ x: 20, y: 20 }, result)

    expect(hit).toBe(true)
    expect(upperHit).toHaveBeenCalledTimes(1)
    expect(lowerHit).not.toHaveBeenCalled()
    expect(result.deepest?.target).toBe(upper as unknown as HitTestTarget)
  })
})

// ---- EventDispatcher lifecycle 测试 ----

describe('EventDispatcher lifecycle', () => {
  afterEach(() => {
    PopupManager.instance.dispose()
    vi.restoreAllMocks()
  })

  it('removes canvas listeners when disposed', () => {
    const canvas = document.createElement('canvas')
    const addSpy = vi.spyOn(canvas, 'addEventListener')
    const removeSpy = vi.spyOn(canvas, 'removeEventListener')

    const dispatcher = new EventDispatcher(canvas)
    expect(addSpy).toHaveBeenCalled()

    dispatcher.dispose()
    expect(removeSpy).toHaveBeenCalledTimes(addSpy.mock.calls.length)
  })

  it('routes wheel events to an open popup before render roots', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const popup = {
      hitTest: vi.fn(() => true),
      close: vi.fn(),
      onWheel: vi.fn(),
    }

    PopupManager.instance.open(popup)
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 1, deltaY: 2, clientX: 10, clientY: 20 }))

    expect(popup.onWheel).toHaveBeenCalledWith(
      expect.objectContaining({
        deltaX: 1,
        deltaY: 2,
        position: { x: 10, y: 20 },
      }),
      expect.objectContaining({
        viewport: expect.objectContaining({ width: 9999, height: 9999, dpr: 1 }),
      }),
    )

    dispatcher.dispose()
  })
})
