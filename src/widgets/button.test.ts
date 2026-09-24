import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../theme/default_theme'
import { PaintContext } from '../rendering/paint_context'
import { PipelineOwner, type BoxConstraints } from '../core/render_object'
import { FocusManager } from '../core/focus_manager'
import { GestureArenaManager, type GestureArenaMember } from '../gestures/gesture_arena'
import { RenderButton } from './button'
import { deriveButtonStyle } from '../theme/component_styles'
import { TextMeasurer } from '../core/text_measurer'

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 120,
  minHeight: 0,
  maxHeight: 40,
}

function createPaintContext(): PaintContext {
  const gradient = { addColorStop: vi.fn() }
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
    createLinearGradient: vi.fn(() => gradient),
  } as unknown as CanvasRenderingContext2D
  return new PaintContext(ctx)
}

function paintButtonBg(button: RenderButton): string {
  const gradient = { addColorStop: vi.fn() }
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
    createLinearGradient: vi.fn(() => gradient),
  } as unknown as CanvasRenderingContext2D
  button.performPaint(new PaintContext(ctx), { x: 0, y: 0 })
  return gradient.addColorStop.mock.calls[1]?.[1] as string
}

function paintButtonLineCount(button: RenderButton): number {
  const gradient = { addColorStop: vi.fn() }
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
    measureText: vi.fn(() => ({ width: 32 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
  }
  button.performPaint(new PaintContext(ctx as unknown as CanvasRenderingContext2D), { x: 0, y: 0 })
  return ctx.lineTo.mock.calls.length
}

function colorToCss(color: { r: number; g: number; b: number; a: number }): string {
  return `rgba(${color.r},${color.g},${color.b},${color.a})`
}

afterEach(() => {
  FocusManager.disposeInstance()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('RenderButton lifecycle', () => {
  it('unregisters and clears focus when hidden through RenderObject visibility', () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    const button = new RenderButton({ label: 'Save' })
    FocusManager.instance.setFocus(button)

    expect(FocusManager.instance.current).toBe(button)

    button.visible = false

    expect(FocusManager.instance.current).toBe(null)
    expect(FocusManager.instance.scopeStack[0]!.focusables).not.toContain(button)
  })

  it('starts and stops the loading spinner timer', () => {
    vi.useFakeTimers()
    const button = new RenderButton({ label: 'Save' })

    button.setLoading(true)
    button.setLoading(true)

    expect(button.loading).toBe(true)
    expect(vi.getTimerCount()).toBe(1)

    vi.advanceTimersByTime(16)

    button.setLoading(false)

    expect(button.loading).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the loading spinner on dispose', () => {
    vi.useFakeTimers()
    const button = new RenderButton({
      label: 'Save',
      loading: true,
    })

    expect(vi.getTimerCount()).toBe(1)

    button.dispose()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('schedules loading paints through PipelineOwner without an onRepaint callback', () => {
    vi.useFakeTimers()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedPaint })
    const button = new RenderButton({ label: 'Save' })
    button.attach(owner)
    button.layout(constraints)
    button.paint(createPaintContext(), { x: 0, y: 0 })

    button.setLoading(true)

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(button.needsPaint).toBe(true)

    button.paint(createPaintContext(), { x: 0, y: 0 })
    owner.clearPaintRequests()
    onNeedPaint.mockClear()
    vi.advanceTimersByTime(16)

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    button.dispose()
  })

  it('keeps the label visible while loading', () => {
    const gradient = { addColorStop: vi.fn() }
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
      arc: vi.fn(),
      createLinearGradient: vi.fn(() => gradient),
    } as unknown as CanvasRenderingContext2D
    const button = new RenderButton({
      label: 'Save',
      loading: true,
    })
    button.size = { width: 120, height: 40 }

    button.performPaint(new PaintContext(ctx), { x: 0, y: 0 })
    button.dispose()

    expect(ctx.arc).toHaveBeenCalled()
    expect(ctx.fillText).toHaveBeenCalledWith('Save', expect.any(Number), 20)
  })

  it('ellipsizes labels when painted in a narrow button', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => String(text).length * 8)
    const gradient = { addColorStop: vi.fn() }
    const fillText = vi.fn()
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText,
      measureText: vi.fn(() => ({ width: 8 })),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      createLinearGradient: vi.fn(() => gradient),
    } as unknown as CanvasRenderingContext2D
    const button = new RenderButton({ label: '超长业务操作按钮' })
    button.size = { width: 56, height: 32 }

    button.performPaint(new PaintContext(ctx, ImGuiDarkTheme), { x: 0, y: 0 })

    expect(String(fillText.mock.calls[0]?.[0])).toContain('...')
  })

  it('recomputes layout from the owner theme after a theme change', () => {
    const onNeedLayout = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout }, ImGuiDarkTheme)
    const button = new RenderButton({ label: 'Save' })
    button.attach(owner)
    button.layout(constraints)
    const beforeHeight = button.size.height
    onNeedLayout.mockClear()

    owner.setTheme({
      ...ImGuiLightTheme,
      fontSize: ImGuiLightTheme.fontSize + 2,
      controlHeight: ImGuiLightTheme.controlHeight + 4,
    })
    button.markNeedsLayout()

    expect(onNeedLayout).toHaveBeenCalledTimes(1)
    expect(button.needsLayout).toBe(true)
    owner.flushLayout()
    expect(button.size.height).toBeGreaterThan(beforeHeight)
    button.dispose()
  })

  it('cancels a pending press when disabled', () => {
    let nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => nextFrameId++))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const onClick = vi.fn()
    const button = new RenderButton({
      label: 'Save',
      onClick,
    })
    button.size = { width: 100, height: 40 }

    button.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })
    button.setDisabled(true)
    button.onPointerUp({ pointerId: 1, position: { x: 10, y: 10 }, type: 'up' })

    expect(button.disabled).toBe(true)
    expect(onClick).not.toHaveBeenCalled()
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })

  it('ignores pointer down outside its hit bounds', () => {
    const onClick = vi.fn()
    const button = new RenderButton({
      label: 'Save',
      onClick,
    })
    button.size = { width: 100, height: 40 }

    button.onPointerDown({ pointerId: 1, position: { x: 120, y: 10 }, type: 'down' })
    button.onPointerUp({ pointerId: 1, position: { x: 10, y: 10 }, type: 'up' })

    expect(onClick).not.toHaveBeenCalled()
    expect((button as any)._interaction.isPressed).toBe(false)
    button.dispose()
  })

  it('ignores secondary mouse button presses', () => {
    const onClick = vi.fn()
    const button = new RenderButton({
      label: 'Save',
      onClick,
    })
    button.size = { width: 100, height: 40 }

    button.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down', button: 2, buttons: 2 })
    button.onPointerUp({ pointerId: 1, position: { x: 10, y: 10 }, type: 'up', button: 2, buttons: 0 })

    expect(onClick).not.toHaveBeenCalled()
    expect((button as any)._interaction.isPressed).toBe(false)
    button.dispose()
  })

  it('uses distinct colors for pressed and released states immediately', () => {
    let nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => nextFrameId++))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const button = new RenderButton({ label: 'Save' })
    button.size = { width: 100, height: 40 }
    const style = deriveButtonStyle(ImGuiDarkTheme)

    button.onPointerMove({ pointerId: 1, position: { x: 10, y: 10 }, type: 'move' })
    expect(paintButtonBg(button)).toBe(colorToCss(style.hoveredBg))

    button.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })
    expect(paintButtonBg(button)).toBe(colorToCss(style.pressedBg))

    button.onPointerUp({ pointerId: 1, position: { x: 10, y: 10 }, type: 'up' })
    expect(paintButtonBg(button)).toBe(colorToCss(style.hoveredBg))
  })

  it('paints primary danger text and link variants from theme tokens', () => {
    const primary = new RenderButton({ label: 'Save', variant: 'primary' })
    primary.size = { width: 100, height: 40 }
    expect(paintButtonBg(primary)).toBe(colorToCss(deriveButtonStyle(ImGuiDarkTheme, 'primary').normalBg))

    const danger = new RenderButton({ label: 'Delete', variant: 'danger' })
    danger.size = { width: 100, height: 40 }
    expect(paintButtonBg(danger)).toBe(colorToCss(deriveButtonStyle(ImGuiDarkTheme, 'danger').normalBg))

    const text = new RenderButton({ label: 'Cancel', variant: 'text' })
    text.size = { width: 100, height: 40 }
    expect(paintButtonBg(text)).toBe(colorToCss(deriveButtonStyle(ImGuiDarkTheme, 'text').normalBg))

    const link = new RenderButton({ label: '查看详情', variant: 'link' })
    link.size = { width: 100, height: 40 }
    const linkStyle = deriveButtonStyle(ImGuiDarkTheme, 'link')
    expect(paintButtonBg(link)).toBe(colorToCss(linkStyle.normalBg))
    expect(linkStyle.borderWidth).toBe(0)
    expect(paintButtonLineCount(link)).toBeGreaterThan(0)
  })

  it('updates variant without changing button layout metrics', () => {
    const owner = new PipelineOwner({}, ImGuiDarkTheme)
    const button = new RenderButton({ label: 'Save' })
    button.attach(owner)
    button.layout(constraints)
    const size = { ...button.size }
    button.paint(createPaintContext(), { x: 0, y: 0 })

    button.variant = 'primary'

    expect(button.variant).toBe('primary')
    expect(button.needsPaint).toBe(true)
    expect(button.needsLayout).toBe(false)
    expect(button.size).toEqual(size)
    button.dispose()
  })

  it('clears pressed state when a scroll ancestor wins the gesture arena', () => {
    let nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => nextFrameId++))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const arena = new GestureArenaManager()
    const scrollMember: GestureArenaMember = {
      acceptGesture: vi.fn(),
      rejectGesture: vi.fn(),
    }
    const onClick = vi.fn()
    const button = new RenderButton({
      label: 'Save',
      onClick,
    })
    button.size = { width: 100, height: 40 }
    const style = deriveButtonStyle(ImGuiDarkTheme)

    button.onPointerMove({ pointerId: 1, position: { x: 10, y: 10 }, type: 'move' })
    button.onPointerDown({
      pointerId: 1,
      position: { x: 10, y: 10 },
      type: 'down',
      joinGestureArena: member => arena.add(1, member),
    })
    const scrollEntry = arena.add(1, scrollMember)
    arena.close(1)

    expect(paintButtonBg(button)).toBe(colorToCss(style.pressedBg))

    scrollEntry.resolve('accepted')

    expect(scrollMember.acceptGesture).toHaveBeenCalledWith(1)
    expect(paintButtonBg(button)).toBe(colorToCss(style.hoveredBg))

    button.onPointerUp({ pointerId: 1, position: { x: 10, y: 10 }, type: 'up' })

    expect(onClick).not.toHaveBeenCalled()
    expect(paintButtonBg(button)).toBe(colorToCss(style.hoveredBg))
  })

  it('completes click cleanup when an arena loser throws and accepts the next pointer type', () => {
    let nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => nextFrameId++))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const arena = new GestureArenaManager()
    const failure = new Error('arena loser failed')
    const loser: GestureArenaMember = {
      acceptGesture: vi.fn(),
      rejectGesture: vi.fn(() => {
        throw failure
      }),
    }
    const onClick = vi.fn()
    const button = new RenderButton({ label: 'Save', onClick })
    button.size = { width: 100, height: 40 }
    const touchIdentity = { pointerId: 0, pointerType: 'touch' as const }

    button.onPointerDown({
      ...touchIdentity,
      position: { x: 10, y: 10 },
      type: 'down',
      joinGestureArena: member => {
        const entry = arena.add(touchIdentity, member)
        arena.add(touchIdentity, loser)
        return entry
      },
    })

    expect(() => button.onPointerUp({
      ...touchIdentity,
      position: { x: 10, y: 10 },
      type: 'up',
    })).toThrow(failure)
    expect(onClick).toHaveBeenCalledOnce()
    expect((button as any)._pendingGesture.hasOwner).toBe(false)

    const mouseArena = new GestureArenaManager()
    const mouseIdentity = { pointerId: 0, pointerType: 'mouse' as const }
    button.onPointerDown({
      ...mouseIdentity,
      position: { x: 10, y: 10 },
      type: 'down',
      joinGestureArena: member => mouseArena.add(mouseIdentity, member),
    })
    button.onPointerUp({
      ...mouseIdentity,
      position: { x: 10, y: 10 },
      type: 'up',
    })

    expect(onClick).toHaveBeenCalledTimes(2)
    expect((button as any)._pendingGesture.hasOwner).toBe(false)
    button.dispose()
  })

  it('resets pressed state before running click callbacks', () => {
    let nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => nextFrameId++))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    let colorSeenInClick = ''
    const button = new RenderButton({
      label: 'Save',
      onClick: () => {
        colorSeenInClick = paintButtonBg(button)
      },
    })
    button.size = { width: 100, height: 40 }
    const style = deriveButtonStyle(ImGuiDarkTheme)

    button.onPointerMove({ pointerId: 1, position: { x: 10, y: 10 }, type: 'move' })
    button.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })
    button.onPointerUp({ pointerId: 1, position: { x: 10, y: 10 }, type: 'up' })

    expect(colorSeenInClick).toBe(colorToCss(style.hoveredBg))
  })

  it('treats pointer leave as hover exit without aborting a pending press', () => {
    const button = new RenderButton({ label: 'Save' })
    button.size = { width: 100, height: 40 }

    button.onPointerMove({ pointerId: 1, position: { x: 10, y: 10 }, type: 'move' })
    button.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })
    button.onPointerLeave({ pointerId: 1, position: { x: 140, y: 10 }, type: 'move' })

    expect((button as any)._interaction.isHovered).toBe(false)
    expect((button as any)._interaction.isPressed).toBe(true)

    button.onPointerCancel({ pointerId: 1, position: { x: 140, y: 10 }, type: 'cancel' })

    expect((button as any)._interaction.isPressed).toBe(false)
  })

  it('keeps a pending press after leave but does not click on outside up', () => {
    const onClick = vi.fn()
    const button = new RenderButton({ label: 'Save', onClick })
    button.size = { width: 100, height: 40 }

    button.onPointerMove({ pointerId: 1, position: { x: 10, y: 10 }, type: 'move' })
    button.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })
    button.onPointerLeave({ pointerId: 1, position: { x: 140, y: 10 }, type: 'move' })

    expect((button as any)._interaction.isPressed).toBe(true)

    button.onPointerUp({ pointerId: 1, position: { x: 140, y: 10 }, type: 'up' })

    expect(onClick).not.toHaveBeenCalled()
    expect((button as any)._interaction.isPressed).toBe(false)
  })

  it('fires clicks from Enter and ignores keyboard activation while disabled', () => {
    const onClick = vi.fn()
    const button = new RenderButton({ label: 'Save', onClick })
    const enter = { key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent
    const space = { key: ' ', preventDefault: vi.fn() } as unknown as KeyboardEvent

    expect(button.onKeyDown(enter)).toBe(true)
    expect(onClick).toHaveBeenCalledTimes(1)

    button.disabled = true
    expect(button.onKeyDown(space)).toBe(false)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

})
