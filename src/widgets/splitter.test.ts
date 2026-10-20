import { afterEach, describe, expect, it, vi } from 'vitest'
import { RenderObject, PipelineOwner, type BoxConstraints } from '../core/render_object'
import { EventDispatcher } from '../gestures/recognizers'
import { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../theme/default_theme'
import { deriveSplitterStyle, resolveBgColor, resolveTextColor } from '../theme/component_styles'
import { colorToCSS } from '../theme/theme'
import { RenderSpacer } from '../layout/render_flex'
import { RenderStackPanel } from '../layout/render_flex'
import { RenderScrollViewer } from './scroll_view'
import { RenderSplitter } from './splitter'

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 240,
  minHeight: 0,
  maxHeight: 120,
}

function createPaintContext(theme = ImGuiDarkTheme): PaintContext {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  return new PaintContext(ctx, theme)
}

function paintSplitter(splitter: RenderSplitter, theme = ImGuiDarkTheme): { fillStyles: string[] } {
  const fillStyles: string[] = []
  let fillStyle: unknown = ''
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(() => {
      if (typeof fillStyle === 'string' && fillStyle) fillStyles.push(fillStyle)
    }),
    stroke: vi.fn(),
    fillRect: vi.fn(() => {
      if (typeof fillStyle === 'string' && fillStyle) fillStyles.push(fillStyle)
    }),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    set fillStyle(value: unknown) { fillStyle = value },
    get fillStyle() { return fillStyle as string },
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  splitter.paint(new PaintContext(ctx, theme), { x: 0, y: 0 })
  return { fillStyles }
}

function createSplitter(): RenderSplitter {
  return new RenderSplitter({
    first: new RenderStackPanel({ orientation: 'vertical' }),
    second: new RenderStackPanel({ orientation: 'vertical' }),
    direction: 'horizontal',
    ratio: 0.5,
  })
}

function touchEvent(type: string, identifier: number, clientX: number, clientY: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'changedTouches', {
    value: [{ identifier, clientX, clientY }],
  })
  return event
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RenderSplitter runtime invalidation', () => {
  it('rejects non-finite constructor and mutable geometry values atomically', () => {
    const create = (patch: Partial<ConstructorParameters<typeof RenderSplitter>[0]>) =>
      new RenderSplitter({
        first: new RenderStackPanel({ orientation: 'vertical' }),
        second: new RenderStackPanel({ orientation: 'vertical' }),
        ...patch,
      })
    for (const patch of [
      { ratio: Number.NaN },
      { minRatio: Number.POSITIVE_INFINITY },
      { maxRatio: Number.NEGATIVE_INFINITY },
      { splitterSize: Number.NaN },
      { fixedSize: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => create(patch)).toThrow(RangeError)
    }

    const splitter = create({ ratio: 0.5, minRatio: 0.1, maxRatio: 0.9, fixedSize: 0 })
    expect(() => { splitter.ratio = Number.NaN }).toThrow(RangeError)
    expect(() => { splitter.minRatio = Number.POSITIVE_INFINITY }).toThrow(RangeError)
    expect(() => { splitter.maxRatio = Number.NEGATIVE_INFINITY }).toThrow(RangeError)
    expect(() => { splitter.fixedSize = Number.NaN }).toThrow(RangeError)
    expect(splitter).toMatchObject({ ratio: 0.5, minRatio: 0.1, maxRatio: 0.9, fixedSize: 0 })
    splitter.dispose()
  })

  it('schedules layout through PipelineOwner when ratio changes after attach', () => {
    const onNeedLayout = vi.fn()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout, onNeedPaint })
    const splitter = createSplitter()
    splitter.attach(owner)
    splitter.layout(constraints)

    splitter.ratio = 0.7

    expect(onNeedLayout).toHaveBeenCalledTimes(1)
    expect(onNeedPaint).not.toHaveBeenCalled()
    expect(splitter.needsLayout).toBe(true)
    splitter.dispose()
  })

  it('schedules hover paints through PipelineOwner without an onRepaint callback', () => {
    const onNeedLayout = vi.fn()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout, onNeedPaint })
    const splitter = createSplitter()
    splitter.attach(owner)
    splitter.layout(constraints)
    splitter.paint(createPaintContext(), { x: 0, y: 0 })

    splitter.onPointerMove({
      pointerId: 1,
      position: { x: splitter.second.offset.x - 1, y: 10 },
      type: 'move',
    })

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(onNeedLayout).not.toHaveBeenCalled()
    expect(splitter.needsPaint).toBe(true)
    splitter.dispose()
  })

  it('clears the bar hover before a child can stop pointer-move propagation', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 120, width: 240, height: 120, toJSON: () => ({}),
    })
    const splitter = createSplitter()
    const dispatcher = new EventDispatcher(canvas)
    ;(splitter.first as any).onPointerMove = (event: { stopPropagation?: () => void }) => {
      event.stopPropagation?.()
    }
    dispatcher.addRoot(splitter)
    splitter.layout(constraints)

    const splitterX = splitter.second.offset.x - 1
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: splitterX, clientY: 10, bubbles: true }))
    expect((splitter as any)._interaction.isHovered).toBe(true)

    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 10, bubbles: true }))
    expect((splitter as any)._interaction.isHovered).toBe(false)

    dispatcher.dispose()
    splitter.dispose()
  })

  it('schedules layout while dragging through PipelineOwner after attach', () => {
    const onNeedLayout = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout })
    const splitter = createSplitter()
    splitter.attach(owner)
    splitter.layout(constraints)

    const splitterX = splitter.second.offset.x - 1
    splitter.onPointerDown({
      pointerId: 1,
      position: { x: splitterX, y: 10 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    onNeedLayout.mockClear()

    splitter.onPointerMove({
      pointerId: 1,
      position: { x: splitterX + 20, y: 10 },
      type: 'move',
    })

    expect(onNeedLayout).toHaveBeenCalledTimes(1)
    expect(splitter.needsLayout).toBe(true)
    splitter.dispose()
  })

  it('treats the splitter bar as an exclusive drag handle', () => {
    const splitter = createSplitter()
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const joinGestureArena = vi.fn()
    splitter.layout(constraints)

    const splitterX = splitter.second.offset.x - 1
    splitter.onPointerDown({
      pointerId: 1,
      position: { x: splitterX, y: 10 },
      type: 'down',
      setPointerCapture,
      releasePointerCapture,
      joinGestureArena,
    })
    splitter.onPointerMove({
      pointerId: 1,
      position: { x: splitterX + 24, y: 10 },
      type: 'move',
    })
    const ratioAfterDrag = splitter.ratio
    splitter.onPointerUp({
      pointerId: 1,
      position: { x: splitterX + 24, y: 10 },
      type: 'up',
    })
    splitter.onPointerMove({
      pointerId: 1,
      position: { x: splitterX + 48, y: 10 },
      type: 'move',
    })

    expect(joinGestureArena).not.toHaveBeenCalled()
    expect(setPointerCapture).toHaveBeenCalledTimes(1)
    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
    expect(ratioAfterDrag).toBeGreaterThan(0.5)
    expect(splitter.ratio).toBe(ratioAfterDrag)

    splitter.dispose()
  })

  it('captures splitter-bar presses before an adjacent child scrollbar can drag', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 120, width: 240, height: 120, toJSON: () => ({}),
    })
    const scroll = new RenderScrollViewer({
      child: new RenderSpacer({ width: 180, height: 260 }),
    })
    const splitter = new RenderSplitter({
      first: scroll,
      second: new RenderStackPanel({ orientation: 'vertical' }),
      direction: 'horizontal',
      ratio: 0.5,
    })
    const dispatcher = new EventDispatcher(canvas)
    dispatcher.addRoot(splitter)
    splitter.layout(constraints)

    const splitterX = splitter.second.offset.x - splitter.splitterSize
    const hitTargets = dispatcher.debugHitTest({ x: splitterX, y: 20 }).path.map(entry => entry.target)
    expect(hitTargets).toEqual([splitter])
    const scrollTargets = dispatcher.debugHitTest({ x: splitterX - 1, y: 20 }).path.map(entry => entry.target)
    expect(scrollTargets).toContain(scroll)

    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: splitterX, clientY: 20, bubbles: true }))
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: splitterX + 24, clientY: 44, bubbles: true }))
    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: splitterX + 24, clientY: 44, bubbles: true }))
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: splitterX + 24, clientY: 80, bubbles: true }))

    expect(scroll.scrollY).toBe(0)
    expect(dispatcher.hasPointerCapture(0)).toBe(false)

    dispatcher.dispose()
    splitter.dispose()
  })

  it('marks dirty when not attached', () => {
    const splitter = createSplitter()
    splitter.layout(constraints)

    splitter.ratio = 0.6

    expect(splitter.needsLayout).toBe(true)
    splitter.dispose()
  })

  it('uses token-derived hover and pressed colors from the paint context', () => {
    const splitter = createSplitter()
    const style = deriveSplitterStyle(ImGuiLightTheme)
    splitter.layout(constraints)
    ;(splitter as any)._hovered = true

    let painted = paintSplitter(splitter, ImGuiLightTheme)
    expect(painted.fillStyles).toContain(colorToCSS(resolveBgColor(style.barBg, 'hovered')))
    expect(painted.fillStyles).toContain(colorToCSS(resolveTextColor(style.gripText, 'hovered')))

    ;(splitter as any)._dragging = true
    painted = paintSplitter(splitter, ImGuiLightTheme)
    expect(painted.fillStyles).toContain(colorToCSS(resolveBgColor(style.barBg, 'pressed')))
    expect(painted.fillStyles).toContain(colorToCSS(resolveTextColor(style.gripText, 'pressed')))

    splitter.dispose()
  })

  it('stops dragging after a window mouseup outside the canvas', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 120, width: 240, height: 120, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const splitter = createSplitter()
    dispatcher.addRoot(splitter)
    splitter.layout(constraints)

    const splitterX = splitter.second.offset.x - 1
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: splitterX, clientY: 10 }))
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: splitterX + 24, clientY: 10 }))
    const ratioAfterDrag = splitter.ratio

    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 360, clientY: 10 }))
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: splitterX + 48, clientY: 10 }))

    expect(splitter.ratio).toBe(ratioAfterDrag)
    expect(dispatcher.hasPointerCapture(0)).toBe(false)

    dispatcher.dispose()
    splitter.dispose()
  })

  it('clears hover when a drag is released outside the splitter', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 120, width: 240, height: 120, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const splitter = createSplitter()
    dispatcher.addRoot(splitter)
    splitter.layout(constraints)

    const splitterX = splitter.second.offset.x - 1
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: splitterX, clientY: 10 }))
    expect((splitter as any)._interaction.isHovered).toBe(true)

    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: splitterX, clientY: 10 }))
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: splitterX + 24, clientY: 160 }))
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: splitterX + 24, clientY: 160 }))

    expect((splitter as any)._interaction.isHovered).toBe(false)

    dispatcher.dispose()
    splitter.dispose()
  })

  it('clears capture and dragging on touchcancel', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 120, width: 240, height: 120, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const splitter = createSplitter()
    dispatcher.addRoot(splitter)
    splitter.layout(constraints)

    const splitterX = splitter.second.offset.x - 1
    canvas.dispatchEvent(touchEvent('touchstart', 5, splitterX, 10))
    expect(dispatcher.hasPointerCapture(5, 'touch')).toBe(true)

    canvas.dispatchEvent(touchEvent('touchmove', 5, splitterX + 24, 10))
    const ratioAfterDrag = splitter.ratio
    canvas.dispatchEvent(touchEvent('touchcancel', 5, splitterX + 24, 10))
    canvas.dispatchEvent(touchEvent('touchmove', 5, splitterX + 48, 10))

    expect(splitter.ratio).toBe(ratioAfterDrag)
    expect(dispatcher.hasPointerCapture(5, 'touch')).toBe(false)

    dispatcher.dispose()
    splitter.dispose()
  })

  it('adjusts ratio from keyboard arrows and Home/End', () => {
    const splitter = createSplitter()
    splitter.layout(constraints)
    splitter.focusIn()

    expect(splitter.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }))).toBe(true)
    expect(splitter.ratio).toBeGreaterThan(0.5)
    expect(splitter.onKeyDown(new KeyboardEvent('keydown', { key: 'Home' }))).toBe(true)
    expect(splitter.ratio).toBe(splitter.minRatio)
    expect(splitter.onKeyDown(new KeyboardEvent('keydown', { key: 'End' }))).toBe(true)
    expect(splitter.ratio).toBe(splitter.maxRatio)
  })
})

describe('Splitter bounded geometry', () => {
  it('keeps separator hit testing in its allocated slot when the second child has margins and alignment', () => {
    const second = new RenderSpacer({ width: 20, margin: { left: 20 }, horizontalAlignment: 'end' })
    const splitter = new RenderSplitter({ first: new RenderSpacer(), second, ratio: 0.5 })
    splitter.layout(constraints)
    const capture = vi.fn()
    const position = { x: 120, y: 60 }
    splitter.onPointerDown({ pointerId: 1, type: 'down', position, setPointerCapture: capture })
    expect(capture).toHaveBeenCalledOnce()
    splitter.onPointerUp({ pointerId: 1, type: 'up', position })
    splitter.dispose()
  })

  it('reclamps the current ratio when limits change without emitting a user action', () => {
    const onChange = vi.fn()
    const splitter = new RenderSplitter({ first: new RenderSpacer(), second: new RenderSpacer(), ratio: 0.8, onChange })
    splitter.maxRatio = 0.4
    expect(splitter.ratio).toBe(0.4)
    splitter.maxRatio = 0.9; splitter.minRatio = 0.6
    expect(splitter.ratio).toBe(0.6)
    expect(onChange).not.toHaveBeenCalled()
    splitter.dispose()
  })

  it.each(['horizontal', 'vertical'] as const)('keeps %s slots and input valid when smaller than the separator', direction => {
    class RawBox extends RenderObject {
      constraints?: BoxConstraints
      visitChildren(_visitor: (child: RenderObject) => void): void {}
      performLayout(c: BoxConstraints): void { this.constraints = c; this.size = { width: c.maxWidth, height: c.maxHeight } }
      performPaint(): void {}
    }
    for (const extent of [0, 2, 4.5, 5, 5.5, 100]) {
      const first = new RawBox(), second = new RawBox()
      const splitter = new RenderSplitter({ first, second, direction })
      splitter.layout({ minWidth: 0, maxWidth: direction === 'horizontal' ? extent : 100, minHeight: 0, maxHeight: direction === 'vertical' ? extent : 100 })
      for (const child of [first, second]) {
        expect(child.constraints!.maxWidth).toBeGreaterThanOrEqual(child.constraints!.minWidth)
        expect(child.constraints!.maxHeight).toBeGreaterThanOrEqual(child.constraints!.minHeight)
        expect(child.offset.x + child.size.width).toBeLessThanOrEqual(splitter.size.width)
        expect(child.offset.y + child.size.height).toBeLessThanOrEqual(splitter.size.height)
      }
      const position = direction === 'horizontal' ? { x: extent / 2, y: 50 } : { x: 50, y: extent / 2 }
      splitter.onPointerDown({ pointerId: 1, type: 'down', position })
      expect(() => splitter.onPointerMove({ pointerId: 1, type: 'move', position: { x: position.x + 10, y: position.y + 10 } })).not.toThrow()
      expect(Number.isFinite(splitter.ratio)).toBe(true)
      splitter.dispose()
    }
  })
})
