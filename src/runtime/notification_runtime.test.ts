// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventDispatcher } from '../gestures/recognizers'
import { FocusManager, FocusScope, FocusScopeType } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { OverlayInvalidator } from '../core/overlay_invalidator'
import { PopupManager } from '../core/popup_manager'
import { GET_POPUP_ANCHOR_RECT } from '../core/popup_anchor'
import { PipelineOwner, RenderObject } from '../core/render_object'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { RuntimeHost } from './runtime_host'
import { NotificationManager } from '../widgets/notification'
import { RenderText } from '../widgets/basic'
import { RenderButton } from '../widgets/button'
import { PopoverPopup } from '../widgets/popover'
import { AnimationClock } from '../animation/animation_clock'

class TestOffscreenCanvas {
  width: number
  height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  getContext(): CanvasRenderingContext2D {
    return createCanvasContext()
  }
}

function createCanvasContext(): CanvasRenderingContext2D {
  return {
    createLinearGradient: () => ({ addColorStop: () => {} }),
    globalAlpha: 1,
    beginPath: vi.fn(),
    closePath: vi.fn(),
    clearRect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    roundRect: vi.fn(),
    save: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    arc: vi.fn(),
    set fillStyle(_value: unknown) {},
    get fillStyle() { return '' },
    set strokeStyle(_value: unknown) {},
    get strokeStyle() { return '' },
    lineWidth: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  } as unknown as CanvasRenderingContext2D
}

class TestRoot extends RenderObject {
  performLayout(): void {}
  performPaint(): void {}
  visitChildren(): void {}
}

afterEach(() => {
  PopupManager.disposeInstance()
  FocusManager.instance.dispose()
  InputComposer.instance.dispose()
  OverlayInvalidator.disposeInstance()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
describe('Notification runtime regressions', () => {
  it.each([false, true])('settles frame scheduling after animation with persistentToast=%s', persistent => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const frames = new Map<number, FrameRequestCallback>()
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id })
    vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = () => createCanvasContext()
    const host = new RuntimeHost({ canvas, getViewportSize: () => ({ width: 800, height: 600 }) })
    const manager = new NotificationManager()
    try {
      if (persistent) manager.notify({ type: 'error', title: 'Persistent', duration: 0 })
      const pendingCounts: number[] = []
      for (let i = 0; i < 100; i++) {
        const batch = [...frames.values()]
        frames.clear()
        for (const frame of batch) frame(i * 16)
        pendingCounts.push(frames.size)
      }
      expect(frames.size).toBe(0)
    } finally { manager.dispose(); host.dispose() }
  })
  it.each([false, true])('uses the painted root capacity when activeRootChanges=%s', changed => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const firstRoot = new RenderText('large root')
    const secondRoot = new RenderText('small root')
    let activeRoot = firstRoot
    PopupManager.instance.setAnchorRootProvider(() => activeRoot)
    PopupManager.instance.setContextProvider(root => ({ theme: ImGuiDarkTheme,
      viewport: { width: 800, height: (root ?? activeRoot) === firstRoot ? 600 : 40, dpr: 1 } }))
    const manager = new NotificationManager()
    try {
      const first = manager.notify({ type: 'error', title: 'First', duration: 0 })
      if (changed) activeRoot = secondRoot
      const paintedHeight = PopupManager.instance.contextFor(manager).viewport.height
      const next = manager.notify({ type: 'error', title: 'Second', duration: 0 })
      expect(paintedHeight).toBe(600)
      expect(first.closed).toBe(false)
      expect(next.closed).toBe(false)
    } finally { manager.dispose(); firstRoot.dispose(); secondRoot.dispose() }
  })
  it.each([false, true])('pauses the timeout while hovered with dismissible=%s', dismissible => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport: { width: 800, height: 600, dpr: 1 } }))
    const manager = new NotificationManager()
    try {
      const handle = manager.notify({ type: 'info', title: 'Read me', duration: 100, dismissible })
      manager.hitTest({ x: 0, y: 0 }, PopupManager.instance.contextFor(manager))
      const card = (manager as any)._notificationSurface._cards[0]
      const point = { x: card.globalOffset.x + 40, y: card.globalOffset.y + 20 }
      const consumed = PopupManager.instance.handlePointerMove({ pointerId: 1, type: 'move', position: point })
      vi.advanceTimersByTime(1000)
      expect(handle.closed).toBe(false)
    } finally { manager.dispose() }
  })
})

describe('Popup animation inheritance', () => {
  it('a static popover using the same surface protocol settles without suppressing dirty requests', () => {
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    const frames = new Map<number, FrameRequestCallback>()
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id })
    vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
    const canvas = document.createElement('canvas')
    ;(canvas as any).getContext = () => createCanvasContext()
    const host = new RuntimeHost({ canvas, getViewportSize: () => ({ width: 800, height: 600 }) })
    const content = new RenderText('Static')
    const popup = new PopoverPopup({ anchor: { [GET_POPUP_ANCHOR_RECT]: () => ({ x: 20, y: 20, width: 80, height: 24 }) }, content })
    try {
      popup.open()
      for (let i = 0; i < 100; i++) {
        const batch = [...frames.values()]
        frames.clear()
        for (const frame of batch) frame(i * 16)
      }
      expect(frames.size).toBe(0)
    } finally { popup.disposePopup(); content.dispose(); host.dispose() }
  })
  it('forwards the host animation clock to a pending notification action', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const clock = new AnimationClock(vi.fn())
    PopupManager.instance.setContextProvider(() => ({ animationClock: clock, theme: ImGuiDarkTheme,
      viewport: { width: 800, height: 600, dpr: 1 } }))
    const normal = new RenderButton({ label: 'Normal', loading: true })
    normal.attach(new PipelineOwner({ animationClock: clock }))
    normal.layout({ minWidth: 100, maxWidth: 100, minHeight: 40, maxHeight: 40 })
    const manager = new NotificationManager()
    try {
      manager.notify({ type: 'error', title: 'Retry', action: { label: 'Retry', onInvoke: () => new Promise<void>(() => {}) } })
      manager.hitTest({ x: 0, y: 0 }, PopupManager.instance.contextFor(manager))
      const action = (manager as any)._notificationSurface._cards[0]._actionButton
      action.onClick()
      manager.hitTest({ x: 0, y: 0 }, PopupManager.instance.contextFor(manager))
      expect(action.loading).toBe(true)
      clock.tick(0)
      clock.tick(160)
      expect((normal as any)._spinAngle).toBeGreaterThan(0)
      expect(action._spinAngle).toBeGreaterThan(0)
    } finally { manager.dispose(); normal.dispose(); clock.dispose() }
  })
})

describe('Notification observation and ownership', () => {
  it('keeps its window anchor when switching between passive and actionable modes', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const firstRoot = new RenderText('First')
    const secondRoot = new RenderText('Second')
    let activeRoot = firstRoot
    PopupManager.instance.setAnchorRootProvider(() => activeRoot)
    PopupManager.instance.setContextProvider(root => ({ theme: ImGuiDarkTheme,
      viewport: { width: 800, height: (root ?? activeRoot) === firstRoot ? 600 : 40, dpr: 1 } }))
    const manager = new NotificationManager()
    const onClose = vi.fn()
    try {
      const item = manager.notify({ type: 'info', title: 'First', dismissible: false, duration: 0, onClose })
      activeRoot = secondRoot
      item.update({ dismissible: true })
      expect(PopupManager.instance.contextFor(manager).viewport.height).toBe(600)
      expect(item.closed).toBe(false)
      item.update({ dismissible: false })
      expect(PopupManager.instance.contextFor(manager).viewport.height).toBe(600)
      expect(PopupManager.instance.closeAnchoredTo(secondRoot)).toBe(false)
      expect(PopupManager.instance.closeAnchoredTo(firstRoot)).toBe(true)
      expect(item.closed).toBe(true)
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally { manager.dispose(); firstRoot.dispose(); secondRoot.dispose() }
  })

  it('observes passive toast hover without consuming clicks and resumes on canvas leave or window blur', () => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport: { width: 800, height: 600, dpr: 1 } }))
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) })
    const clicked = vi.fn()
    class Page extends TestRoot {
      size = { width: 800, height: 600 }
      onPointerDown = clicked
    }
    const root = new Page()
    const dispatcher = new EventDispatcher(canvas)
    dispatcher.addRoot(root)
    const manager = new NotificationManager()
    try {
      for (const end of ['mouseleave', 'blur']) {
        const handle = manager.notify({ type: 'info', title: 'Read', dismissible: false, duration: 100 })
        manager.hitTest({ x: 0, y: 0 }, PopupManager.instance.contextFor(manager))
        const card = (manager as any)._notificationSurface._cards[0]
        const pos = { clientX: card.globalOffset.x + 40, clientY: card.globalOffset.y + 20 }
        canvas.dispatchEvent(new MouseEvent('mousemove', pos))
        vi.advanceTimersByTime(1000)
        expect(handle.closed).toBe(false)
        canvas.dispatchEvent(new MouseEvent('mousedown', { ...pos, button: 0, buttons: 1 }))
        canvas.dispatchEvent(new MouseEvent('mouseup', { ...pos, button: 0, buttons: 0 }))
        expect(clicked).toHaveBeenCalled()
        if (end === 'mouseleave') canvas.dispatchEvent(new MouseEvent('mouseleave', pos))
        else window.dispatchEvent(new Event('blur'))
        vi.advanceTimersByTime(1000)
        expect(handle.closed).toBe(true)
      }
    } finally { manager.dispose(); dispatcher.dispose(); root.dispose() }
  })

  it('tracks independent hovering pointers and transfers hover pause when cards move', () => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport: { width: 800, height: 600, dpr: 1 } }))
    const manager = new NotificationManager()
    try {
      const first = manager.notify({ type: 'info', title: 'First', dismissible: false, duration: 100 })
      manager.hitTest({ x: 0, y: 0 }, PopupManager.instance.contextFor(manager))
      const card = (manager as any)._notificationSurface._cards[0]
      const pos = { x: card.globalOffset.x + 40, y: card.globalOffset.y + 20 }
      PopupManager.instance.handlePointerMove({ pointerId: 1, type: 'move', position: pos })
      PopupManager.instance.handlePointerMove({ pointerId: 2, pointerType: 'pen', type: 'move', position: pos })
      PopupManager.instance.handlePointerCancel({ pointerId: 1, type: 'cancel', position: pos })
      vi.advanceTimersByTime(1000)
      expect(first.closed).toBe(false)
      const next = manager.notify({ type: 'info', title: 'Next', dismissible: false, duration: 100 })
      manager.hitTest({ x: 0, y: 0 }, PopupManager.instance.contextFor(manager))
      vi.advanceTimersByTime(1000)
      expect(first.closed).toBe(true)
      expect(next.closed).toBe(false)
      PopupManager.instance.handlePointerCancel({ pointerId: 2, pointerType: 'pen', type: 'cancel', position: pos })
      vi.advanceTimersByTime(1000)
      expect(next.closed).toBe(true)
    } finally { manager.dispose() }
  })
})

describe('Notification modal observation boundary', () => {
  it('releases hover pause when a modal focus scope blocks pointer observation', () => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport: { width: 800, height: 600, dpr: 1 } }))
    const manager = new NotificationManager()
    const modalScope = new FocusScope(FocusScopeType.Modal)
    let previous: ReturnType<typeof FocusManager.instance.pushScope>
    let pushed = false
    try {
      const handle = manager.notify({ type: 'success', title: 'Saved', duration: 100 })
      manager.hitTest({ x: 0, y: 0 }, PopupManager.instance.contextFor(manager))
      const card = (manager as any)._notificationSurface._cards[0]
      const position = { x: card.globalOffset.x + 40, y: card.globalOffset.y + 20 }
      PopupManager.instance.handlePointerMove({ pointerId: 1, type: 'move', position })
      vi.advanceTimersByTime(500)
      expect(handle.closed).toBe(false)
      previous = FocusManager.instance.pushScope(modalScope)
      pushed = true
      expect(handle.closed).toBe(false)
      PopupManager.instance.handlePointerMove({ pointerId: 1, type: 'move', position })
      vi.advanceTimersByTime(1000)
      expect(handle.closed).toBe(true)
    } finally { if (pushed) FocusManager.instance.popScope(previous!, modalScope); manager.dispose() }
  })
})
