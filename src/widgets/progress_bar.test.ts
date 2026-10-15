import { AnimationClock } from '../animation/animation_clock'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PipelineOwner, type BoxConstraints } from '../core/render_object'
import { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../theme/default_theme'
import { RenderProgressBar } from './progress_bar'
import { RenderScrollViewer } from './scroll_view'
import { RenderStackPanel } from '../layout/render_flex'
import { RenderText } from './basic'
import { RenderTabControl, RenderTabItem } from './tab_view'

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 200,
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
    createLinearGradient: vi.fn(() => gradient),
    rect: vi.fn(),
    clip: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  return new PaintContext(ctx)
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('RenderProgressBar lifecycle', () => {
  it('stops ticking outside a scroll viewport and resumes when scrolled back', () => {
    const clock = new AnimationClock()
    const progress = new RenderProgressBar({ value: -1 })
    const content = new RenderStackPanel({ orientation: 'vertical' })
    content.addChild(progress)
    const filler = new RenderText('content')
    filler.height = 400
    content.addChild(filler)
    const viewer = new RenderScrollViewer({ child: content })
    viewer.attach(new PipelineOwner({ animationClock: clock }))
    viewer.layout({ minWidth: 200, maxWidth: 200, minHeight: 80, maxHeight: 80 })
    expect(clock.hasActiveAnimations).toBe(true)
    const repaint = vi.spyOn(progress, 'markNeedsPaint')
    viewer.scrollY = 100
    repaint.mockClear()
    clock.tick(100)
    expect(clock.hasActiveAnimations).toBe(false)
    expect(repaint).not.toHaveBeenCalled()
    viewer.scrollY = 0
    clock.tick(200)
    expect(clock.hasActiveAnimations).toBe(true)
    expect(repaint).toHaveBeenCalled()
    viewer.dispose()
    expect(clock.subscriberCount).toBe(0)
  })

  it('pauses the animation in an inactive tab without depending on focusability', () => {
    const clock = new AnimationClock()
    const progress = new RenderProgressBar({ value: -1 })
    const tabs = new RenderTabControl({ activeKey: 'loading' })
    tabs.addChild(new RenderTabItem({ key: 'loading', title: 'Loading', content: progress }))
    tabs.addChild(new RenderTabItem({ key: 'other', title: 'Other', content: new RenderText('Other') }))
    tabs.attach(new PipelineOwner({ animationClock: clock }))
    tabs.layout({ minWidth: 200, maxWidth: 200, minHeight: 80, maxHeight: 80 })
    expect(clock.hasActiveAnimations).toBe(true)
    tabs.activeKey = 'other'
    tabs.layout({ minWidth: 200, maxWidth: 200, minHeight: 80, maxHeight: 80 })
    expect(clock.hasActiveAnimations).toBe(false)
    tabs.activeKey = 'loading'
    tabs.layout({ minWidth: 200, maxWidth: 200, minHeight: 80, maxHeight: 80 })
    expect(clock.hasActiveAnimations).toBe(true)
    tabs.dispose()
    expect(clock.subscriberCount).toBe(0)
  })
  it('starts constructor-requested animation on attach and preserves subpixel movement', () => {
    const clock = new AnimationClock()
    const progress = new RenderProgressBar({ value: -1 })
    expect(clock.subscriberCount).toBe(0)
    progress.attach(new PipelineOwner({ animationClock: clock }))
    progress.layout(constraints)
    expect(clock.subscriberCount).toBe(1)
    clock.tick(0)
    clock.tick(1000 / 120)
    const context = createPaintContext()
    progress.paint(context, { x: 0, y: 0 })
    const moving = vi.mocked(context.ctx.roundRect).mock.calls.find(call => call[2] === 70)!
    expect(moving[0]).toBeCloseTo(-70 + 270 / 96)
    expect(moving[0]).not.toBe(Math.round(Number(moving[0])))
    progress.dispose()
    expect(clock.subscriberCount).toBe(0)
  })

  it('pauses hidden content, rebinds on reattachment, and releases both owners', () => {
    const first = new AnimationClock()
    const second = new AnimationClock()
    const progress = new RenderProgressBar({ value: -1 })
    const owner = new PipelineOwner({ animationClock: first })
    progress.attach(owner)
    progress.layout(constraints)
    first.tick(0)
    first.tick(100)
    progress.visible = false
    expect(first.hasActiveAnimations).toBe(false)
    progress.visible = true
    progress.layout(constraints)
    expect(first.hasActiveAnimations).toBe(true)
    progress.attach(new PipelineOwner({ animationClock: second }))
    expect(first.subscriberCount).toBe(0)
    expect(second.subscriberCount).toBe(1)
    progress.detach()
    expect(second.subscriberCount).toBe(0)
    progress.attach(owner)
    expect(first.subscriberCount).toBe(1)
    progress.dispose()
    expect(first.subscriberCount).toBe(0)
  })
  it('registers indeterminate animation only once when attached', () => {
    vi.useFakeTimers()
    const clock = new AnimationClock()
    const progress = new RenderProgressBar({})
    progress.attach(new PipelineOwner({ animationClock: clock }))
    progress.layout(constraints)

    progress.startIndeterminate()
    progress.startIndeterminate()

    expect(progress.value).toBe(-1)
    expect(clock.subscriberCount).toBe(1)
    expect(vi.getTimerCount()).toBe(0)

    clock.tick(0)
    clock.tick(16)
    expect(progress.needsPaint).toBe(true)
  })

  it('stops indeterminate mode and clamps final values', () => {
    vi.useFakeTimers()
    const clock = new AnimationClock()
    const progress = new RenderProgressBar({})
    progress.attach(new PipelineOwner({ animationClock: clock }))
    progress.layout(constraints)

    progress.startIndeterminate()
    progress.setValue(2)

    expect(progress.value).toBe(1)
    expect(vi.getTimerCount()).toBe(0)

    progress.setValue(-1)
    expect(progress.value).toBe(-1)
    expect(clock.subscriberCount).toBe(1)
    expect(vi.getTimerCount()).toBe(0)

    progress.setValue(-0.1)
    expect(progress.value).toBe(-1)
    expect(clock.subscriberCount).toBe(1)
    expect(vi.getTimerCount()).toBe(0)

    progress.setValue(0.25)
    expect(progress.value).toBe(0.25)
    expect(clock.subscriberCount).toBe(0)
  })

  it('unregisters the indeterminate animation on dispose', () => {
    vi.useFakeTimers()
    const clock = new AnimationClock()
    const progress = new RenderProgressBar({})
    progress.attach(new PipelineOwner({ animationClock: clock }))
    progress.layout(constraints)

    progress.startIndeterminate()
    progress.dispose()

    expect(clock.subscriberCount).toBe(0)
  })

  it('refreshes theme-derived height from the owner theme during relayout', () => {
    const onNeedLayout = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout }, ImGuiDarkTheme)
    const progress = new RenderProgressBar({
      label: 'Loading',
    })

    progress.attach(owner)
    progress.layout(constraints)
    const beforeHeight = progress.height
    onNeedLayout.mockClear()

    owner.setTheme({ ...ImGuiLightTheme, fontSize: ImGuiLightTheme.fontSize + 2 })
    progress.markNeedsLayout()

    expect(onNeedLayout).toHaveBeenCalledTimes(1)
    expect(progress.needsLayout).toBe(true)
    owner.flushLayout()
    expect(progress.height).toBeGreaterThan(beforeHeight)
    expect(progress.needsLayout).toBe(false)
    expect(onNeedLayout).toHaveBeenCalledTimes(1)
  })

  it('preserves explicit height when the owner theme changes', () => {
    const onNeedLayout = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout }, ImGuiDarkTheme)
    const progress = new RenderProgressBar({
      label: 'Loading',
      height: 18,
    })

    progress.attach(owner)
    progress.layout(constraints)
    onNeedLayout.mockClear()

    owner.setTheme({ ...ImGuiLightTheme, fontSize: ImGuiLightTheme.fontSize + 2 })
    progress.markNeedsLayout()

    expect(progress.height).toBe(18)
    expect(onNeedLayout).toHaveBeenCalledTimes(1)
    owner.flushLayout()
    expect(progress.height).toBe(18)
  })
})
