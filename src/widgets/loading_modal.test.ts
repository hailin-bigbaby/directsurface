import { AnimationClock } from '../animation/animation_clock'
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { PopupManager } from '../core/popup_manager'
import { DrawList } from '../rendering/draw_list'
import { PaintContext } from '../rendering/paint_context'
import { deriveModalStyle } from '../theme/component_styles'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { RenderLoadingModal } from './loading_modal'

const viewport = { width: 640, height: 360, dpr: 1 }

function createPaintContext(): {
  context: PaintContext
  calls: string[]
} {
  const calls: string[] = []
  const gradient = {
    addColorStop: vi.fn(() => calls.push('addColorStop')),
  } as unknown as CanvasGradient
  const ctx = {
    save: vi.fn(() => calls.push('save')),
    restore: vi.fn(() => calls.push('restore')),
    fillRect: vi.fn(() => calls.push('fillRect')),
    strokeRect: vi.fn(() => calls.push('strokeRect')),
    fill: vi.fn(() => calls.push('fill')),
    stroke: vi.fn(() => calls.push('stroke')),
    fillText: vi.fn((text: string) => calls.push(`fillText:${text}`)),
    measureText: vi.fn(() => ({ width: 80 })),
    createLinearGradient: vi.fn(() => gradient),
    beginPath: vi.fn(() => calls.push('beginPath')),
    roundRect: vi.fn(() => calls.push('roundRect')),
    arc: vi.fn(() => calls.push('arc')),
    rect: vi.fn(() => calls.push('rect')),
    clip: vi.fn(() => calls.push('clip')),
    set fillStyle(_value: unknown) {},
    get fillStyle() { return '' },
    set strokeStyle(_value: unknown) {},
    get strokeStyle() { return '' },
    set shadowColor(_value: string) {},
    get shadowColor() { return '' },
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    lineWidth: 1,
    lineCap: 'butt' as CanvasLineCap,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D
  return {
    context: new PaintContext(ctx, ImGuiDarkTheme),
    calls,
  }
}

function pointerEvent(type: 'down' | 'move' | 'up' | 'cancel', x: number, y: number) {
  return { pointerId: 1, type, position: { x, y } }
}

function wheelEvent(x: number, y: number) {
  return { pointerId: 1, type: 'wheel' as const, position: { x, y }, deltaX: 0, deltaY: 1 }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  PopupManager.disposeInstance()
  FocusManager.disposeInstance()
})

describe('RenderLoadingModal', () => {
  it('paints a viewport mask, centered panel, spinner, and text', () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const modal = new RenderLoadingModal({ text: 'Loading remote module' })
    modal.show()

    const painted = createPaintContext()
    modal.paint(painted.context)

    expect(painted.calls).toContain('fillRect')
    expect(painted.calls.filter(call => call === 'fill').length).toBeGreaterThanOrEqual(2)
    expect(painted.calls).toContain('stroke')
    expect(painted.calls.filter(call => call === 'arc')).toHaveLength(2)
    expect(painted.calls).toContain('fillText:Loading remote module')

    modal.dispose()
  })

  it('paints the panel shadow from shared modal elevation tokens', () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const modal = new RenderLoadingModal({ text: 'Loading remote module' })
    const shadowSpy = vi.spyOn(DrawList.prototype, 'outerShadow')
    modal.show()

    modal.paint(createPaintContext().context)

    const style = deriveModalStyle(ImGuiDarkTheme)
    const call = shadowSpy.mock.calls.at(-1)
    expect(call?.[4]).toBe(style.shadowBlur)
    expect(call?.[5]).toEqual(style.shadowColor)
    expect(call?.[6]).toBe(style.borderRadius)
    expect(call?.[7]).toBe(style.shadowOffsetX)
    expect(call?.[8]).toBe(style.shadowOffsetY)

    modal.dispose()
  })

  it('clips long loading text to the modal indicator bounds', () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const modal = new RenderLoadingModal({
      text: 'Very long loading text that should stay inside the loading modal panel',
    })
    modal.show()

    const painted = createPaintContext()
    modal.paint(painted.context)

    const clipIndex = painted.calls.indexOf('clip')
    const textIndex = painted.calls.findIndex(call => call.startsWith('fillText:Very long loading text'))
    const restoreIndex = painted.calls.indexOf('restore', textIndex)

    expect(clipIndex).toBeGreaterThanOrEqual(0)
    expect(textIndex).toBeGreaterThan(clipIndex)
    expect(restoreIndex).toBeGreaterThan(textIndex)

    modal.dispose()
  })

  it('paints determinate progress when progress is set', () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const modal = new RenderLoadingModal({ text: 'Uploading', progress: 0.4 })
    modal.show()

    const painted = createPaintContext()
    modal.paint(painted.context)

    expect(modal.progress).toBe(0.4)
    expect(painted.calls).toContain('fillText:40%')
    expect(painted.calls).toContain('addColorStop')

    modal.setProgress(1.5)
    expect(modal.progress).toBe(1)

    modal.setProgress(undefined)
    expect(modal.progress).toBeUndefined()

    modal.dispose()
  })

  it('covers the full viewport for hit testing', () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const modal = new RenderLoadingModal()
    modal.show()

    expect(modal.hitTest({ x: 0, y: 0 }, PopupManager.instance.context)).toBe(true)
    expect(modal.hitTest({ x: 639, y: 359 }, PopupManager.instance.context)).toBe(true)
    expect(modal.hitTest({ x: 641, y: 20 }, PopupManager.instance.context)).toBe(false)

    modal.dispose()
  })

  it('blocks pointer and wheel routing through PopupManager', () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const modal = new RenderLoadingModal()
    modal.show()

    expect(PopupManager.instance.handlePointerDown(pointerEvent('down', 20, 20))).toBe(true)
    expect(PopupManager.instance.handleWheel(wheelEvent(20, 20))).toBe(true)
    expect(PopupManager.instance.stack).toContain(modal)

    modal.dispose()
  })

  it('consumes Escape without closing', () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const modal = new RenderLoadingModal()
    modal.show()

    const event = new KeyboardEvent('keydown', { key: 'Escape' })
    const preventDefault = vi.spyOn(event, 'preventDefault')

    expect(PopupManager.instance.handleKeyDown(event)).toBe(true)
    expect(preventDefault).toHaveBeenCalled()
    expect(PopupManager.instance.stack).toContain(modal)
    expect(modal.visible).toBe(true)

    modal.dispose()
  })

  it('programmatically closes and stops animation invalidation', () => {
    const clock = new AnimationClock()
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport, animationClock: clock }))
    const requestPaint = vi.spyOn(PopupManager.instance, 'requestPaint')
    const modal = new RenderLoadingModal()
    modal.show()
    requestPaint.mockClear()

    clock.tick(16)
    expect(requestPaint).toHaveBeenCalled()

    modal.close()
    requestPaint.mockClear()
    clock.tick(16)

    expect(requestPaint).not.toHaveBeenCalled()
    expect(PopupManager.instance.stack).not.toContain(modal)
    expect(modal.visible).toBe(false)
  })
})
