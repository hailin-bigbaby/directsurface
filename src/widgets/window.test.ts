import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { looseConstraints, PipelineOwner, type BoxConstraints } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import { EventDispatcher } from '../gestures/recognizers'
import { RenderStackPanel } from '../layout/render_flex'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../theme/default_theme'
import { deriveWindowChromeStyle, resolveBgColor, resolveTextColor } from '../theme/component_styles'
import { colorToCSS } from '../theme/theme'
import { PaintContext } from '../rendering/paint_context'
import { RenderText } from './basic'
import { RenderWindow } from './window'
import { RenderBox } from '../layout/render_box'
import { RenderSpacer } from '../layout/render_flex'
import { RenderScrollViewer } from './scroll_view'
import { RenderTextArea } from './text_area'
import { RenderTextBox } from './text_field'

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 400,
  minHeight: 0,
  maxHeight: 300,
}

function createPaintContext(): PaintContext {
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
    rect: vi.fn(),
    clip: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  return new PaintContext(ctx)
}

function paintWindow(win: RenderWindow): {
  fillStyles: string[]
  strokeStyles: string[]
  shadowFills: Array<{
    fillStyle: string
    shadowColor: string
    shadowBlur: number
    shadowOffsetX: number
    shadowOffsetY: number
  }>
} {
  const fillStyles: string[] = []
  const strokeStyles: string[] = []
  const shadowFills: Array<{
    fillStyle: string
    shadowColor: string
    shadowBlur: number
    shadowOffsetX: number
    shadowOffsetY: number
  }> = []
  let fillStyle: unknown = ''
  let strokeStyle: unknown = ''
  let shadowColor = ''
  let shadowBlur = 0
  let shadowOffsetX = 0
  let shadowOffsetY = 0
  const recordShadowFill = () => {
    if (typeof fillStyle !== 'string' || !fillStyle || shadowBlur <= 0) return
    shadowFills.push({ fillStyle, shadowColor, shadowBlur, shadowOffsetX, shadowOffsetY })
  }
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(() => {
      if (typeof fillStyle === 'string' && fillStyle) fillStyles.push(fillStyle)
      recordShadowFill()
    }),
    stroke: vi.fn(() => {
      if (typeof strokeStyle === 'string' && strokeStyle) strokeStyles.push(strokeStyle)
    }),
    fillRect: vi.fn(() => {
      if (typeof fillStyle === 'string' && fillStyle) fillStyles.push(fillStyle)
      recordShadowFill()
    }),
    strokeRect: vi.fn(() => {
      if (typeof strokeStyle === 'string' && strokeStyle) strokeStyles.push(strokeStyle)
    }),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    set fillStyle(value: unknown) { fillStyle = value },
    get fillStyle() { return fillStyle as string },
    set strokeStyle(value: unknown) { strokeStyle = value },
    get strokeStyle() { return strokeStyle as string },
    lineWidth: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    set shadowColor(value: string) { shadowColor = value },
    get shadowColor() { return shadowColor },
    set shadowBlur(value: number) { shadowBlur = value },
    get shadowBlur() { return shadowBlur },
    set shadowOffsetX(value: number) { shadowOffsetX = value },
    get shadowOffsetX() { return shadowOffsetX },
    set shadowOffsetY(value: number) { shadowOffsetY = value },
    get shadowOffsetY() { return shadowOffsetY },
  } as unknown as CanvasRenderingContext2D
  win.paint(new PaintContext(ctx), { x: 0, y: 0 })
  return { fillStyles, strokeStyles, shadowFills }
}

class FillBox extends RenderBox {
  constructor(private readonly _color: string) {
    super()
  }

  visitChildren(): void {}

  performLayout(constraints: BoxConstraints): void {
    this.size = {
      width: constraints.maxWidth,
      height: constraints.maxHeight,
    }
  }

  performPaint(context: PaintContext, offset: { x: number; y: number }): void {
    context.ctx.fillStyle = this._color
    context.ctx.fillRect(offset.x, offset.y, this.size.width, this.size.height)
  }
}

class FixedWindowBox extends RenderBox {
  constructor(private readonly desiredHeight: number) {
    super()
  }

  visitChildren(): void {}

  performLayout(constraints: BoxConstraints): void {
    this.size = {
      width: constraints.maxWidth,
      height: Math.max(constraints.minHeight, Math.min(constraints.maxHeight, this.desiredHeight)),
    }
  }
}

function attachOwner(win: RenderWindow, options: {
  onNeedLayout?: () => void
  onNeedPaint?: () => void
  setCursor?: (cursor: string) => void
  activateWindow?: (target: RenderWindow) => void
} = {}) {
  const setCursor = vi.fn((cursor: string) => options.setCursor?.(cursor))
  const activateWindow = vi.fn((target: RenderWindow) => options.activateWindow?.(target))
  const owner = new PipelineOwner({
    onNeedLayout: options.onNeedLayout,
    onNeedPaint: options.onNeedPaint,
    setCursor,
    activateWindow: target => {
      if (target instanceof RenderWindow) activateWindow(target)
    },
  })
  win.attach(owner)
  return { owner, setCursor, activateWindow }
}

function createWindowScrollTextFieldScene(): {
  canvas: HTMLCanvasElement
  dispatcher: EventDispatcher
  win: RenderWindow
  scroll: RenderScrollViewer
  field: RenderTextBox
} {
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON: () => ({}),
  })
  const field = new RenderTextBox({ value: 'abcdef' })
  const content = new RenderStackPanel({ orientation: 'vertical' })
  content.addChild(field)
  content.addChild(new RenderSpacer({ width: 240, height: 260 }))
  const scroll = new RenderScrollViewer({ child: content })
  const win = new RenderWindow({
    title: 'Window',
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    contentPadding: 0,
    contentSpacing: 0,
  })
  win.setChildren([scroll])
  win.layout(constraints)
  const dispatcher = new EventDispatcher(canvas)
  dispatcher.addRoot(win)
  return { canvas, dispatcher, win, scroll, field }
}

function createWindowScrollTextAreaScene(): {
  canvas: HTMLCanvasElement
  dispatcher: EventDispatcher
  win: RenderWindow
  scroll: RenderScrollViewer
  area: RenderTextArea
} {
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON: () => ({}),
  })
  const area = new RenderTextArea({ value: 'first line\nsecond line\nthird line' })
  const content = new RenderStackPanel({ orientation: 'vertical' })
  content.addChild(area)
  content.addChild(new RenderSpacer({ width: 240, height: 260 }))
  const scroll = new RenderScrollViewer({ child: content })
  const win = new RenderWindow({
    title: 'Window',
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    contentPadding: 0,
    contentSpacing: 0,
  })
  win.setChildren([scroll])
  win.layout(constraints)
  const dispatcher = new EventDispatcher(canvas)
  dispatcher.addRoot(win)
  return { canvas, dispatcher, win, scroll, area }
}

describe('RenderWindow pointer capture', () => {
  it('rejects non-finite public geometry before changing window state', () => {
    expect(() => new RenderWindow({ title: 'Bad X', x: Number.NaN })).toThrow(RangeError)
    expect(() => new RenderWindow({ title: 'Bad Y', y: Number.POSITIVE_INFINITY })).toThrow(RangeError)
    expect(() => new RenderWindow({ title: 'Bad width', width: Number.NaN })).toThrow(RangeError)
    expect(() => new RenderWindow({ title: 'Bad inset', autoResizeInset: Number.NEGATIVE_INFINITY })).toThrow(RangeError)

    const window = new RenderWindow({ title: 'Finite', x: 20, y: 30, width: 320, height: 240 })
    expect(() => { window.windowX = Number.NaN }).toThrow(RangeError)
    expect(() => { window.windowY = Number.POSITIVE_INFINITY }).toThrow(RangeError)
    expect(() => { window.windowWidth = Number.NEGATIVE_INFINITY }).toThrow(RangeError)
    expect(() => { window.windowHeight = Number.NaN }).toThrow(RangeError)
    expect(() => window.setHostManagedBounds({
      x: 0, y: 0, width: Number.NaN, height: 100,
    })).toThrow(RangeError)
    expect({
      x: window.windowX,
      y: window.windowY,
      width: window.windowWidth,
      height: window.windowHeight,
    }).toEqual({ x: 20, y: 30, width: 320, height: 240 })
    window.dispose()
  })

  it('captures pointer while dragging the title bar and releases on pointer up', () => {
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })

    win.onPointerDown({
      pointerId: 1,
      position: { x: 40, y: 10 },
      type: 'down',
      setPointerCapture,
      releasePointerCapture,
    })
    win.onPointerMove({ pointerId: 1, position: { x: 60, y: 30 }, type: 'move' })
    win.onPointerUp({ pointerId: 1, position: { x: 60, y: 30 }, type: 'up' })

    expect(setPointerCapture).toHaveBeenCalledTimes(1)
    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
    expect(win.windowX).toBe(20)
    expect(win.windowY).toBe(20)
  })

  it('treats the title bar as an exclusive drag handle', () => {
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const joinGestureArena = vi.fn()
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })

    win.onPointerDown({
      pointerId: 1,
      position: { x: 40, y: 10 },
      type: 'down',
      setPointerCapture,
      releasePointerCapture,
      joinGestureArena,
    })
    win.onPointerMove({ pointerId: 1, position: { x: 60, y: 30 }, type: 'move' })
    const positionAfterDrag = { x: win.windowX, y: win.windowY }
    win.onPointerUp({ pointerId: 1, position: { x: 60, y: 30 }, type: 'up' })
    win.onPointerMove({ pointerId: 1, position: { x: 100, y: 70 }, type: 'move' })

    expect(joinGestureArena).not.toHaveBeenCalled()
    expect(setPointerCapture).toHaveBeenCalledTimes(1)
    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
    expect(positionAfterDrag).toEqual({ x: 20, y: 20 })
    expect({ x: win.windowX, y: win.windowY }).toEqual(positionAfterDrag)
    win.dispose()
  })

  it('schedules paint through PipelineOwner while dragging after attach', () => {
    const onNeedLayout = vi.fn()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout, onNeedPaint })
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })
    win.attach(owner)
    win.layout(constraints)
    win.paint(createPaintContext(), { x: 0, y: 0 })

    win.onPointerDown({
      pointerId: 1,
      position: { x: 40, y: 10 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    onNeedLayout.mockClear()
    onNeedPaint.mockClear()

    win.onPointerMove({ pointerId: 1, position: { x: 60, y: 30 }, type: 'move' })

    expect(onNeedLayout).not.toHaveBeenCalled()
    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(win.needsLayout).toBe(false)
    expect(win.needsPaint).toBe(true)
    win.dispose()
  })

  it('invalidates every visual position covered by consecutive window drag moves', () => {
    const owner = new PipelineOwner()
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })
    win.attach(owner)
    win.layout(constraints)
    FocusManager.instance.setFocus(win)
    win.paint(createPaintContext(), win.globalOffset)
    owner.clearPaintRequests()

    win.onPointerDown({
      pointerId: 1,
      position: { x: 40, y: 10 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    win.onPointerMove({ pointerId: 1, position: { x: 60, y: 30 }, type: 'move' })
    win.onPointerMove({ pointerId: 1, position: { x: 90, y: 50 }, type: 'move' })

    const damage = owner.getDirtyPaintRectInSubtree(win)
    expect(damage).toBeDefined()
    expect(damage!.x).toBeLessThan(0)
    expect(damage!.y).toBeLessThan(0)
    expect(damage!.x + damage!.width).toBeGreaterThan(350)
    expect(damage!.y + damage!.height).toBeGreaterThan(240)
    expect(win.needsLayout).toBe(false)

    win.onPointerUp({ pointerId: 1, position: { x: 90, y: 50 }, type: 'up' })
    FocusManager.disposeInstance()
    win.dispose()
  })

  it('schedules layout through PipelineOwner while resizing after attach', () => {
    const onNeedLayout = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout })
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })
    win.attach(owner)
    win.layout(constraints)

    win.onPointerDown({
      pointerId: 1,
      position: { x: 298, y: 100 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    onNeedLayout.mockClear()

    win.onPointerMove({ pointerId: 1, position: { x: 320, y: 100 }, type: 'move' })

    expect(onNeedLayout).toHaveBeenCalledTimes(1)
    expect(win.needsLayout).toBe(true)
    expect(win.windowWidth).toBeGreaterThan(300)
    win.dispose()
  })

  it('treats resize edges as exclusive drag handles', () => {
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const joinGestureArena = vi.fn()
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })

    win.onPointerDown({
      pointerId: 1,
      position: { x: 298, y: 100 },
      type: 'down',
      setPointerCapture,
      releasePointerCapture,
      joinGestureArena,
    })
    win.onPointerMove({ pointerId: 1, position: { x: 320, y: 100 }, type: 'move' })
    const widthAfterResize = win.windowWidth
    win.onPointerCancel({ pointerId: 1, position: { x: 320, y: 100 }, type: 'cancel' })
    win.onPointerMove({ pointerId: 1, position: { x: 360, y: 100 }, type: 'move' })

    expect(joinGestureArena).not.toHaveBeenCalled()
    expect(setPointerCapture).toHaveBeenCalledTimes(1)
    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
    expect(widthAfterResize).toBeGreaterThan(300)
    expect(win.windowWidth).toBe(widthAfterResize)
    win.dispose()
  })

  it('starts edge resize even when the pointer path ends in a content child', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      contentPadding: 0,
      contentSpacing: 0,
    })
    const child = new RenderText('Child')
    win.setChildren([child])
    win.layout(constraints)

    win.onPointerDown({
      pointerId: 1,
      position: { x: 298, y: 198 },
      type: 'down',
      path: {
        path: [
          { target: win as any, localPosition: { x: 298, y: 198 } },
          { target: child as any, localPosition: { x: 298, y: 198 - win.TITLE_HEIGHT } },
        ],
        get deepest() { return this.path[this.path.length - 1] },
        isEmpty: false,
        propagationStopped: false,
        add() {},
        resetPropagation() {},
        interactiveTargets() { return [] },
        createDispatchEvent() { return { stopPropagation() {} } as any },
      } as any,
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })

    win.onPointerMove({ pointerId: 1, position: { x: 320, y: 220 }, type: 'move' })

    expect(win.windowWidth).toBeGreaterThan(300)
    expect(win.windowHeight).toBeGreaterThan(200)
    win.dispose()
  })

  it('focuses a text field nested inside a scroll view inside a window', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const { canvas, dispatcher, win, scroll, field } = createWindowScrollTextFieldScene()
    const x = field.globalOffset.x + 16
    const y = field.globalOffset.y + 10

    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }))
    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }))

    expect(win.isFocused).toBe(true)
    expect(field.isFocused).toBe(true)
    expect(InputComposer.instance.hasSession).toBe(true)
    expect(scroll.scrollY).toBe(0)
    expect(dispatcher.hasPointerCapture(0)).toBe(false)

    dispatcher.dispose()
    win.dispose()
    FocusManager.disposeInstance()
    InputComposer.instance.dispose()
  })

  it('lets a nested text field own horizontal selection drag without scrolling the parent', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const { canvas, dispatcher, win, scroll, field } = createWindowScrollTextFieldScene()
    const startX = field.globalOffset.x + 16
    const y = field.globalOffset.y + 10

    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: startX, clientY: y, bubbles: true }))
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: startX + 56, clientY: y + 1, bubbles: true }))

    expect(field.isFocused).toBe(true)
    expect((field as any)._dragging).toBe(true)
    expect(scroll.scrollY).toBe(0)
    expect(dispatcher.hasPointerCapture(0)).toBe(true)

    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: startX + 56, clientY: y + 1, bubbles: true }))
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: startX + 90, clientY: y + 1, bubbles: true }))

    expect((field as any)._dragging).toBe(false)
    expect(scroll.scrollY).toBe(0)
    expect(dispatcher.hasPointerCapture(0)).toBe(false)

    dispatcher.dispose()
    win.dispose()
    FocusManager.disposeInstance()
    InputComposer.instance.dispose()
  })

  it('lets the parent scroll view own vertical drag over a nested text field', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const { canvas, dispatcher, win, scroll, field } = createWindowScrollTextFieldScene()
    const startX = field.globalOffset.x + 16
    const startY = field.globalOffset.y + 10

    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: startX, clientY: startY, bubbles: true }))
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: startX + 1, clientY: startY - 50, bubbles: true }))
    const scrollAfterDrag = scroll.scrollY

    expect(field.isFocused).toBe(true)
    expect((field as any)._dragging).toBe(false)
    expect(scrollAfterDrag).toBeGreaterThan(0)
    expect(dispatcher.hasPointerCapture(0)).toBe(true)

    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: startX + 1, clientY: startY - 50, bubbles: true }))
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: startX + 1, clientY: startY - 80, bubbles: true }))

    expect(field.isFocused).toBe(true)
    expect(scroll.scrollY).toBe(scrollAfterDrag)
    expect(dispatcher.hasPointerCapture(0)).toBe(false)

    dispatcher.dispose()
    win.dispose()
    FocusManager.disposeInstance()
    InputComposer.instance.dispose()
  })

  it('focuses a text area nested inside a scroll view inside a window', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const { canvas, dispatcher, win, scroll, area } = createWindowScrollTextAreaScene()
    const x = area.globalOffset.x + 16
    const y = area.globalOffset.y + 10

    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }))
    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }))

    expect(win.isFocused).toBe(true)
    expect(area.isFocused).toBe(true)
    expect(InputComposer.instance.hasSession).toBe(true)
    expect(scroll.scrollY).toBe(0)
    expect(dispatcher.hasPointerCapture(0)).toBe(false)

    dispatcher.dispose()
    win.dispose()
    FocusManager.disposeInstance()
    InputComposer.instance.dispose()
  })

  it('lets a nested text area own selection drag without scrolling the parent', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const { canvas, dispatcher, win, scroll, area } = createWindowScrollTextAreaScene()
    const startX = area.globalOffset.x + 16
    const startY = area.globalOffset.y + 10

    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: startX, clientY: startY, bubbles: true }))
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: startX + 48, clientY: startY + 24, bubbles: true }))

    expect(area.isFocused).toBe(true)
    expect((area as any)._dragging).toBe(true)
    expect(scroll.scrollY).toBe(0)
    expect(dispatcher.hasPointerCapture(0)).toBe(true)

    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: startX + 48, clientY: startY + 24, bubbles: true }))
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: startX + 80, clientY: startY + 32, bubbles: true }))

    expect((area as any)._dragging).toBe(false)
    expect(scroll.scrollY).toBe(0)
    expect(dispatcher.hasPointerCapture(0)).toBe(false)

    dispatcher.dispose()
    win.dispose()
    FocusManager.disposeInstance()
    InputComposer.instance.dispose()
  })

  it('clears nested text area selection drag on window blur without ending editing', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const { canvas, dispatcher, win, scroll, area } = createWindowScrollTextAreaScene()
    const startX = area.globalOffset.x + 16
    const startY = area.globalOffset.y + 10

    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: startX, clientY: startY, bubbles: true }))
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: startX + 48, clientY: startY + 24, bubbles: true }))

    expect((area as any)._dragging).toBe(true)
    expect(dispatcher.hasPointerCapture(0)).toBe(true)

    canvas.dispatchEvent(new MouseEvent('mouseleave', { clientX: startX + 48, clientY: startY + 24, bubbles: true }))
    expect((area as any)._dragging).toBe(true)
    expect(dispatcher.hasPointerCapture(0)).toBe(true)

    window.dispatchEvent(new Event('blur'))
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: startX + 80, clientY: startY + 32, bubbles: true }))

    expect((area as any)._dragging).toBe(false)
    expect(area.isFocused).toBe(true)
    expect(InputComposer.instance.hasSession).toBe(true)
    expect(scroll.scrollY).toBe(0)
    expect(dispatcher.hasPointerCapture(0)).toBe(false)

    dispatcher.dispose()
    win.dispose()
    FocusManager.disposeInstance()
    InputComposer.instance.dispose()
  })

  it('schedules focus paints through PipelineOwner without an onRepaint callback', () => {
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedPaint })
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })
    win.attach(owner)
    win.layout(constraints)
    win.paint(createPaintContext(), { x: 0, y: 0 })

    win.focusIn()

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(win.needsPaint).toBe(true)
    win.dispose()
  })

  it('marks dirty when not attached', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })

    win.focusIn()

    expect(win.needsPaint).toBe(true)
    win.dispose()
  })

  it('recomputes layout from the owner theme after a theme change', () => {
    const onNeedLayout = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout }, ImGuiDarkTheme)
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })
    const child = new RenderText('Child')
    win.addChild(child)
    win.attach(owner)
    win.layout(constraints)
    const beforeTitleHeight = win.TITLE_HEIGHT
    onNeedLayout.mockClear()

    owner.setTheme({
      ...ImGuiLightTheme,
      fontSize: ImGuiLightTheme.fontSize + 2,
      panelHeaderHeight: ImGuiLightTheme.panelHeaderHeight + 4,
    })
    win.markNeedsLayout()

    expect(onNeedLayout).toHaveBeenCalledTimes(1)
    expect(win.needsLayout).toBe(true)
    owner.flushLayout()
    expect(win.TITLE_HEIGHT).toBeGreaterThan(beforeTitleHeight)
    expect(child.parent).toBe(win)
    win.dispose()
  })

  it('keeps child relationships when replacing children', () => {
    const child = new RenderText('Child')
    const win = new RenderWindow({
      title: 'Window',
      width: 300,
      height: 200,
    })
    win.addChild(child)
    expect(child.parent).toBe(win)
    win.dispose()
  })

  it('disposes child render objects and clears the child list on dispose', () => {
    const child = new RenderText('Child')
    const disposeSpy = vi.spyOn(child, 'dispose')
    const win = new RenderWindow({
      title: 'Window',
      width: 300,
      height: 200,
    })

    win.addChild(child)
    win.dispose()

    expect(disposeSpy).toHaveBeenCalledTimes(1)
    expect(win.children).toEqual([])
    expect(child.parent).toBeUndefined()
  })

  it('uses token-derived focused chrome and resize-grip colors while painting', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })
    const style = deriveWindowChromeStyle(ImGuiDarkTheme)
    win.layout(constraints)
    win.focusIn()
    ;(win as any)._resizing = 'se'

    const painted = paintWindow(win)

    expect(win.TITLE_HEIGHT).toBe(style.titleHeight)
    expect(painted.fillStyles).toContain(colorToCSS(resolveBgColor(style.titleBg, 'focused')))
    expect(painted.fillStyles).toContain(colorToCSS(resolveTextColor(style.gripText, 'pressed')))
    expect(painted.strokeStyles).toContain(colorToCSS(resolveTextColor(style.controlText, 'focused')))

    win.dispose()
  })

  it('casts a token-derived drop shadow before painting the window surface', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })
    const style = deriveWindowChromeStyle(ImGuiDarkTheme)
    win.layout(constraints)

    const painted = paintWindow(win)

    expect(painted.shadowFills[0]).toEqual({
      fillStyle: 'rgba(0,0,0,1)',
      shadowColor: colorToCSS(style.shadowColor),
      shadowBlur: style.shadowBlur,
      shadowOffsetX: style.shadowOffsetX,
      shadowOffsetY: style.shadowOffsetY,
    })
    expect(painted.fillStyles.indexOf('rgba(0,0,0,1)')).toBeLessThan(
      painted.fillStyles.indexOf(colorToCSS(style.windowBg)),
    )

    win.dispose()
  })

  it('uses warning theme tokens for the attention flash', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })
    const style = deriveWindowChromeStyle(ImGuiDarkTheme)
    win.layout(constraints)
    win.requestAttentionFlash()

    const painted = paintWindow(win)

    expect(painted.fillStyles).toContain(colorToCSS(style.attentionFill))
    expect(painted.fillStyles).toContain(colorToCSS(style.attentionTitleFill))
    expect(painted.strokeStyles).toContain(colorToCSS(style.attentionBorder))

    win.dispose()
  })

  it('paints the resize grip above content children', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      contentPadding: 0,
      contentSpacing: 0,
    })
    const style = deriveWindowChromeStyle(ImGuiDarkTheme)
    const child = new FillBox('rgba(1,2,3,1)')
    win.setChildren([child])
    win.layout(constraints)
    win.focusIn()
    ;(win as any)._resizing = 'se'

    const painted = paintWindow(win)

    expect(painted.fillStyles[painted.fillStyles.length - 1]).toBe(
      colorToCSS(resolveTextColor(style.gripText, 'pressed')),
    )
    win.dispose()
  })

  it('can auto-resize to canvas with an inset and keep maximized windows synced', () => {
    const win = new RenderWindow({
      title: 'Window',
      width: 320,
      height: 240,
      autoResizeInset: 20,
    })
    const { owner } = attachOwner(win)

    win.layout(looseConstraints(640, 480))

    expect(win.windowX).toBe(20)
    expect(win.windowY).toBe(20)
    expect(win.windowWidth).toBe(600)
    expect(win.windowHeight).toBe(440)

    win.layout(looseConstraints(800, 600))

    expect(win.windowX).toBe(20)
    expect(win.windowY).toBe(20)
    expect(win.windowWidth).toBe(760)
    expect(win.windowHeight).toBe(560)

    const buttonSize = win.TITLE_HEIGHT * 0.6
    const buttonMargin = (win.TITLE_HEIGHT - buttonSize) / 2
    const closeButtonX = win.windowX + win.windowWidth - buttonSize - buttonMargin
    const maxButtonX = closeButtonX - buttonSize - buttonMargin
    const buttonY = win.windowY + buttonMargin

    win.onPointerDown({
      pointerId: 1,
      position: {
        x: maxButtonX + buttonSize / 2,
        y: buttonY + buttonSize / 2,
      },
      type: 'down',
    })

    expect(win.windowX).toBe(0)
    expect(win.windowY).toBe(0)

    win.layout(looseConstraints(900, 700))

    expect(win.windowWidth).toBe(900)
    expect(win.windowHeight).toBe(700)
    win.detach()
    owner.forget(win)
    win.dispose()
  })

  it('does not enter maximized mode for zero-inset auto-resize windows', () => {
    const win = new RenderWindow({
      title: 'Window',
      width: 320,
      height: 240,
      autoResizeInset: 0,
    })
    win.layout(looseConstraints(640, 480))

    const buttonSize = win.TITLE_HEIGHT * 0.6
    const buttonMargin = (win.TITLE_HEIGHT - buttonSize) / 2
    const closeButtonX = win.windowX + win.windowWidth - buttonSize - buttonMargin
    const maxButtonX = closeButtonX - buttonSize - buttonMargin
    const buttonY = win.windowY + buttonMargin

    win.onPointerDown({
      pointerId: 1,
      position: { x: maxButtonX + buttonSize / 2, y: buttonY + buttonSize / 2 },
      type: 'down',
    })

    expect((win as any)._maximized).toBe(false)
    expect(win.windowWidth).toBe(640)
    expect(win.windowHeight).toBe(480)

    win.onPointerDown({
      pointerId: 2,
      position: { x: 1, y: 1 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    expect((win as any)._resizing).toBe('nw')

    win.dispose()
    FocusManager.disposeInstance()
  })

  it('keeps maximized windows active when a descendant is clicked', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      contentPadding: 0,
      contentSpacing: 0,
    })
    const child = new RenderText('Child')
    const { activateWindow } = attachOwner(win)
    win.setChildren([child])
    win.layout(constraints)
    ;(win as any)._maximized = true
    win.focusOut()

    win.onPointerDown({
      pointerId: 1,
      position: { x: 20, y: win.TITLE_HEIGHT + 20 },
      type: 'down',
      path: {
        path: [
          { target: win as any, localPosition: { x: 20, y: win.TITLE_HEIGHT + 20 } },
          { target: child as any, localPosition: { x: 20, y: 20 } },
        ],
        get deepest() { return this.path[this.path.length - 1] },
        isEmpty: false,
        propagationStopped: false,
        add() {},
        resetPropagation() {},
        interactiveTargets() { return [] },
        createDispatchEvent() { return { stopPropagation() {} } as any },
      } as any,
    })

    expect(win.isFocused).toBe(true)
    expect(activateWindow).toHaveBeenCalledTimes(1)

    win.dispose()
  })

  it('stops viewport auto-resize after a manual edge resize', () => {
    const win = new RenderWindow({
      title: 'Window',
      width: 320,
      height: 240,
      autoResizeInset: 0,
    })

    win.layout(looseConstraints(640, 480))

    expect(win.windowWidth).toBe(640)
    expect(win.windowHeight).toBe(480)

    win.onPointerDown({
      pointerId: 1,
      position: { x: 639, y: 200 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    win.onPointerMove({ pointerId: 1, position: { x: 520, y: 200 }, type: 'move' })
    win.onPointerUp({ pointerId: 1, position: { x: 520, y: 200 }, type: 'up' })

    expect(win.windowWidth).toBe(521)

    win.layout(looseConstraints(800, 600))

    expect(win.windowWidth).toBe(521)
    expect(win.windowHeight).toBe(480)

    win.dispose()
    FocusManager.disposeInstance()
  })

  it('implements Focusable: isFocused reflects focus state', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })

    expect(win.isFocused).toBe(false)

    win.focusIn()
    expect(win.isFocused).toBe(true)

    win.focusOut()
    expect(win.isFocused).toBe(false)

    win.dispose()
  })

  it('requests owner activation when focusIn is invoked', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })
    const { activateWindow } = attachOwner(win)

    win.focusIn()
    expect(activateWindow).toHaveBeenCalledTimes(1)

    win.focusIn()
    expect(activateWindow).toHaveBeenCalledTimes(2)

    win.dispose()
  })

  it('onPointerDown calls FocusManager.setFocus which triggers owner activation', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })
    const { activateWindow } = attachOwner(win)
    FocusManager.instance.register(win)

    win.onPointerDown({
      pointerId: 1,
      position: { x: 40, y: 10 },
      type: 'down',
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })

    expect(win.isFocused).toBe(true)
    expect(activateWindow).toHaveBeenCalledTimes(1)

    FocusManager.disposeInstance()
  })

  it('stops requesting owner activation after detach', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })
    const { owner, activateWindow } = attachOwner(win)
    win.focusIn()
    expect(activateWindow).toHaveBeenCalledTimes(1)

    win.detach()
    owner.forget(win)
    win.focusIn()
    expect(activateWindow).toHaveBeenCalledTimes(1)

    win.dispose()
  })

  it('clears owner activation hooks in dispose', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })
    const { activateWindow } = attachOwner(win)
    win.dispose()
    win.focusIn()
    expect(activateWindow).toHaveBeenCalledTimes(0)
  })

  it('updates FocusManager current when setFocus is called', () => {
    afterEach(() => { FocusManager.disposeInstance() })

    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })

    FocusManager.instance.register(win)

    expect(FocusManager.instance.current).toBeNull()

    FocusManager.instance.setFocus(win)

    expect(win.isFocused).toBe(true)
    expect(FocusManager.instance.current).toBe(win)

    FocusManager.instance.clearFocus()

    expect(win.isFocused).toBe(false)

    FocusManager.instance.unregister(win)
  })

  it('focusIn does not re-enter FocusManager setFocus', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })
    const { activateWindow } = attachOwner(win)

    FocusManager.instance.register(win)
    FocusManager.instance.setFocus(win)

    expect(activateWindow).toHaveBeenCalledTimes(1)

    FocusManager.disposeInstance()
  })
})

describe('RenderWindow content padding override', () => {
  it('supports overriding content padding per window', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 320,
      height: 220,
      contentPadding: 0,
    })
    const content = new RenderText('Content')

    win.setChildren([content])
    win.layout(constraints)

    expect(content.offset.x).toBe(0)
    expect(content.offset.y).toBe(win.TITLE_HEIGHT)
  })

  it('supports overriding content spacing per window', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 320,
      height: 220,
      contentPadding: 0,
      contentSpacing: 0,
    })
    const first = new RenderText('First')
    const second = new RenderText('Second')

    win.setChildren([first, second])
    win.layout(constraints)

    expect(first.offset.y).toBe(win.TITLE_HEIGHT)
    expect(second.offset.y).toBe(first.offset.y + first.size.height)
  })

  it('skips invisible content children when stacking window content', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 320,
      height: 120,
      contentPadding: 0,
      contentSpacing: 5,
    })
    const first = new FixedWindowBox(20)
    const hidden = new FixedWindowBox(40)
    const second = new FixedWindowBox(20)
    hidden.visible = false

    win.setChildren([first, hidden, second])
    win.layout(constraints)

    expect(first.offset.y).toBe(win.TITLE_HEIGHT)
    expect(second.offset.y).toBe(win.TITLE_HEIGHT + first.size.height + 5)
    expect(second.size.height).toBe(20)
    expect(hidden.size).toEqual({ width: 0, height: 0 })
  })

  it('keeps fixed-height content at natural height instead of stretching the last child', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      contentPadding: 0,
      contentSpacing: 5,
    })
    const first = new FixedWindowBox(20)
    const second = new FixedWindowBox(30)

    win.setChildren([first, second])
    win.layout(constraints)

    expect(win.size.height).toBe(180)
    expect(first.size.height).toBe(20)
    expect(second.size.height).toBe(30)
    expect(second.offset.y).toBe(win.TITLE_HEIGHT + 25)
  })

  it('supports content-sized floating windows', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      minHeight: 0,
      heightSizing: 'content',
      contentPadding: 0,
      contentSpacing: 5,
    })
    const first = new FixedWindowBox(20)
    const second = new FixedWindowBox(30)

    win.setChildren([first, second])
    win.layout(constraints)

    expect(win.heightSizing).toBe('content')
    expect(win.size.height).toBe(win.TITLE_HEIGHT + 20 + 5 + 30)
    expect(win.windowHeight).toBe(win.size.height)
  })

  it('clamps content-sized floating windows to maxHeight', () => {
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 320,
      minHeight: 0,
      heightSizing: 'content',
      maxHeight: 90,
      contentPadding: 0,
      contentSpacing: 5,
    })
    const first = new FixedWindowBox(60)
    const second = new FixedWindowBox(60)

    win.setChildren([first, second])
    win.layout(constraints)

    expect(win.size.height).toBe(90)
    expect(first.size.height).toBe(60)
    expect(second.size.height).toBe(Math.max(0, 90 - win.TITLE_HEIGHT - 60 - 5))
  })

  it('uses the common box width and height as its single size source', () => {
    const win = new RenderWindow({
      title: 'Window',
      width: 500,
      maxWidth: 360,
      height: 240,
    })

    expect(win.width).toBe(360)
    expect(win.windowWidth).toBe(360)
    expect(win.height).toBe(240)
    expect(win.windowHeight).toBe(240)

    win.windowWidth = 340
    win.height = 220
    expect(win.width).toBe(340)
    expect(win.windowHeight).toBe(220)

    win.setWindowBounds({ width: 480, height: 210 })
    expect(win.width).toBe(360)
    expect(win.windowWidth).toBe(360)
    expect(win.height).toBe(210)

    win.layout(looseConstraints(800, 600))
    expect(win.size).toEqual({ width: 360, height: 210 })
    expect(win.needsLayout).toBe(false)
  })
})

describe('RenderWindow chrome options', () => {
  it('lays out and paints chrome-free windows as frameless content hosts', () => {
    const win = new RenderWindow({
      title: 'App Root',
      chrome: 'none',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })
    const child = new FillBox('rgba(1,2,3,1)')
    win.setChildren([child])

    win.layout(constraints)

    expect(win.chrome).toBe('none')
    expect(win.draggable).toBe(false)
    expect(win.borderStyle).toBe('fixed')
    expect(win.showCloseButton).toBe(false)
    expect(win.showMaximizeButton).toBe(false)
    expect(child.offset).toEqual({ x: 0, y: 0 })
    expect(child.size).toEqual({ width: 300, height: 200 })

    const paintContext = createPaintContext()
    win.paint(paintContext, { x: 0, y: 0 })
    expect(paintContext.ctx.fillText).not.toHaveBeenCalled()
    expect(paintContext.ctx.strokeRect).not.toHaveBeenCalled()

    const painted = paintWindow(win)
    expect(painted.shadowFills).toEqual([])
    win.dispose()
  })

  it('does not run title-bar operations when chrome is disabled', () => {
    const onClose = vi.fn()
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const win = new RenderWindow({
      title: 'App Root',
      chrome: 'none',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      onClose,
    })

    win.layout(constraints)
    win.onPointerDown({
      pointerId: 1,
      position: { x: 288, y: 10 },
      type: 'down',
      setPointerCapture,
      releasePointerCapture,
    })
    win.onPointerMove({ pointerId: 1, position: { x: 340, y: 40 }, type: 'move' })
    win.onPointerDown({
      pointerId: 2,
      position: { x: 299, y: 100 },
      type: 'down',
      setPointerCapture,
      releasePointerCapture,
    })
    win.onPointerMove({ pointerId: 2, position: { x: 340, y: 120 }, type: 'move' })

    expect(onClose).not.toHaveBeenCalled()
    expect(setPointerCapture).not.toHaveBeenCalled()
    expect(releasePointerCapture).not.toHaveBeenCalled()
    expect(win.windowX).toBe(0)
    expect(win.windowY).toBe(0)
    expect(win.windowWidth).toBe(300)
    expect(win.windowHeight).toBe(200)
    win.dispose()
  })

  it('can disable standard chrome operations independently', () => {
    const onClose = vi.fn()
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const win = new RenderWindow({
      title: 'Window',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      draggable: false,
      borderStyle: 'fixed',
      showCloseButton: false,
      showMaximizeButton: false,
      onClose,
    })

    win.layout(constraints)
    win.onPointerDown({
      pointerId: 1,
      position: { x: 288, y: 10 },
      type: 'down',
      setPointerCapture,
      releasePointerCapture,
    })
    win.onPointerMove({ pointerId: 1, position: { x: 340, y: 40 }, type: 'move' })
    win.onPointerDown({
      pointerId: 2,
      position: { x: 299, y: 100 },
      type: 'down',
      setPointerCapture,
      releasePointerCapture,
    })
    win.onPointerMove({ pointerId: 2, position: { x: 340, y: 120 }, type: 'move' })

    expect(win.chrome).toBe('standard')
    expect(onClose).not.toHaveBeenCalled()
    expect(setPointerCapture).not.toHaveBeenCalled()
    expect(releasePointerCapture).not.toHaveBeenCalled()
    expect(win.windowX).toBe(0)
    expect(win.windowY).toBe(0)
    expect(win.windowWidth).toBe(300)
    expect(win.windowHeight).toBe(200)
    win.dispose()
  })
})

describe('RenderWindow owned windows', () => {
  it('tracks owned windows separately from render children', () => {
    const owner = new RenderWindow({
      title: 'Owner',
      width: 300,
      height: 200,
    })
    const owned = new RenderWindow({
      title: 'Owned',
      width: 200,
      height: 120,
    })

    owner.addOwnedWindow(owned)

    expect(owner.getOwnedWindows()).toEqual([owned])
    expect(owned.ownerWindow).toBe(owner)
    expect(owner.children).toEqual([])

    owner.dispose()
  })

  it('reparents owned windows and preserves the latest ordering', () => {
    const firstOwner = new RenderWindow({
      title: 'First Owner',
      width: 300,
      height: 200,
    })
    const secondOwner = new RenderWindow({
      title: 'Second Owner',
      width: 300,
      height: 200,
    })
    const firstOwned = new RenderWindow({
      title: 'First Owned',
      width: 200,
      height: 120,
    })
    const secondOwned = new RenderWindow({
      title: 'Second Owned',
      width: 200,
      height: 120,
    })

    firstOwner.addOwnedWindow(firstOwned)
    firstOwner.setOwnedWindows([secondOwned, firstOwned])
    secondOwner.addOwnedWindow(firstOwned)

    expect(firstOwner.getOwnedWindows()).toEqual([secondOwned])
    expect(secondOwner.getOwnedWindows()).toEqual([firstOwned])
    expect(firstOwned.ownerWindow).toBe(secondOwner)

    firstOwner.dispose()
    secondOwner.dispose()
  })

  it('rejects ownership cycles', () => {
    const mainWindow = new RenderWindow({
      title: 'Main',
      width: 300,
      height: 200,
    })
    const childWindow = new RenderWindow({
      title: 'Child',
      width: 200,
      height: 120,
    })

    mainWindow.addOwnedWindow(childWindow)

    expect(() => childWindow.addOwnedWindow(mainWindow)).toThrow('ownership cannot contain cycles')

    mainWindow.dispose()
  })

  it('dispose() cascades through owned windows', () => {
    const owner = new RenderWindow({
      title: 'Owner',
      width: 300,
      height: 200,
    })
    const owned = new RenderWindow({
      title: 'Owned',
      width: 200,
      height: 120,
    })
    const disposeSpy = vi.spyOn(owned, 'dispose')
    owner.addOwnedWindow(owned)

    owner.dispose()

    expect(disposeSpy).toHaveBeenCalledTimes(1)
    expect(owner.getOwnedWindows()).toEqual([])
    expect(owned.ownerWindow).toBeUndefined()
  })

  it('removes itself from the owner when directly disposed', () => {
    const owner = new RenderWindow({
      title: 'Owner',
      width: 300,
      height: 200,
    })
    const owned = new RenderWindow({
      title: 'Owned',
      width: 200,
      height: 120,
    })

    owner.addOwnedWindow(owned)
    owned.dispose()

    expect(owner.getOwnedWindows()).toEqual([])
    expect(owned.ownerWindow).toBeUndefined()
  })
})

describe('RenderWindow managed resources', () => {
  it('manage() registers a dispose callback that is called on dispose', () => {
    const win = new RenderWindow({
      title: 'Window',
      width: 300,
      height: 200,
    })
    const disposeFn = vi.fn()
    win.manage(disposeFn)

    expect(disposeFn).not.toHaveBeenCalled()
    win.dispose()
    expect(disposeFn).toHaveBeenCalledTimes(1)
  })

  it('manage() returns a remover that can cancel the dispose callback', () => {
    const win = new RenderWindow({
      title: 'Window',
      width: 300,
      height: 200,
    })
    const disposeFn = vi.fn()
    const remove = win.manage(disposeFn)

    remove()
    win.dispose()

    expect(disposeFn).not.toHaveBeenCalled()
  })

  it('manageDisposable() registers a disposable that is disposed on dispose', () => {
    const win = new RenderWindow({
      title: 'Window',
      width: 300,
      height: 200,
    })
    const disposable = { dispose: vi.fn() }
    win.manageDisposable(disposable)

    expect(disposable.dispose).not.toHaveBeenCalled()
    win.dispose()
    expect(disposable.dispose).toHaveBeenCalledTimes(1)
  })

  it('dispose() cleans up managed resources before children', () => {
    const order: string[] = []
    const win = new RenderWindow({
      title: 'Window',
      width: 300,
      height: 200,
    })
    const child = new RenderText('Child')
    vi.spyOn(child, 'dispose').mockImplementation(() => {
      order.push('child')
    })
    win.addChild(child)
    win.manage(() => order.push('managed'))

    win.dispose()

    expect(order).toEqual(['managed', 'child'])
  })

  it('dispose() clears all managed resources even if one throws', () => {
    const win = new RenderWindow({
      title: 'Window',
      width: 300,
      height: 200,
    })
    const dispose1 = vi.fn(() => { throw new Error('test error') })
    const dispose2 = vi.fn()
    win.manage(dispose1)
    win.manage(dispose2)
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => win.dispose()).not.toThrow()
    expect(dispose1).toHaveBeenCalledTimes(1)
    expect(dispose2).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledTimes(1)
    expect(win.disposed).toBe(true)
    expect(() => win.dispose()).not.toThrow()
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('continues owned-window and child cleanup after independent failures', () => {
    const owner = new RenderWindow({ title: 'Owner' })
    const firstOwned = new RenderWindow({ title: 'First owned' })
    const secondOwned = new RenderWindow({ title: 'Second owned' })
    const firstChild = new RenderText('first')
    const secondChild = new RenderText('second')
    owner.addOwnedWindow(firstOwned)
    owner.addOwnedWindow(secondOwned)
    owner.setChildren([firstChild, secondChild])
    vi.spyOn(firstOwned, 'dispose').mockImplementation(() => { throw new Error('owned failed') })
    const secondOwnedDispose = vi.spyOn(secondOwned, 'dispose')
    vi.spyOn(firstChild, 'dispose').mockImplementation(() => { throw new Error('child failed') })
    const secondChildDispose = vi.spyOn(secondChild, 'dispose')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => owner.dispose()).not.toThrow()
    expect(secondOwnedDispose).toHaveBeenCalledTimes(1)
    expect(secondChildDispose).toHaveBeenCalledTimes(1)
    expect(owner.getOwnedWindows()).toEqual([])
    expect(owner.children).toEqual([])
    expect(firstOwned.ownerWindow).toBeUndefined()
    expect(secondOwned.ownerWindow).toBeUndefined()
    expect(report).toHaveBeenCalledTimes(2)
  })

  it('close() disposes the window when no close handler is installed', () => {
    const win = new RenderWindow({
      title: 'Window',
      width: 300,
      height: 200,
    })

    win.close()

    expect(win.disposed).toBe(true)
  })
})
