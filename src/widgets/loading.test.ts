import { AnimationClock } from '../animation/animation_clock'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PipelineOwner, type BoxConstraints, type LayoutContext, type Offset, type RenderObject } from '../core/render_object'
import { HitTestResult } from '../gestures/hit_test'
import { RenderBox } from '../layout/render_box'
import { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { RenderLoadingHost } from './loading'

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 240,
  minHeight: 0,
  maxHeight: 120,
}

class PaintRecordingBox extends RenderBox {
  layoutCalls = 0
  paintCalls = 0
  disposed = false

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    this.layoutCalls += 1
    this.size = {
      width: constraints.maxWidth,
      height: constraints.maxHeight,
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    this.paintCalls += 1
    context.ctx.fillRect(offset.x, offset.y, this.size.width, this.size.height)
  }

  override dispose(): void {
    this.disposed = true
    super.dispose()
  }
}

function createRecordingPaintContext(): {
  context: PaintContext
  calls: string[]
} {
  const calls: string[] = []
  const ctx = {
    save: vi.fn(() => calls.push('save')),
    restore: vi.fn(() => calls.push('restore')),
    fillRect: vi.fn(() => calls.push('fillRect')),
    stroke: vi.fn(() => calls.push('stroke')),
    fillText: vi.fn((text: string) => calls.push(`fillText:${text}`)),
    measureText: vi.fn(() => ({ width: 10 })),
    beginPath: vi.fn(() => calls.push('beginPath')),
    rect: vi.fn(() => calls.push('rect')),
    clip: vi.fn(() => calls.push('clip')),
    arc: vi.fn(() => calls.push('arc')),
  } as unknown as CanvasRenderingContext2D
  return {
    context: new PaintContext(ctx, ImGuiDarkTheme),
    calls,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('RenderLoadingHost', () => {
  it('lays out and paints child without changing child geometry', () => {
    const child = new PaintRecordingBox()
    const host = new RenderLoadingHost({ child, loading: true, text: 'Loading...' })

    host.layout(constraints, false, { theme: ImGuiDarkTheme })
    const painted = createRecordingPaintContext()
    host.paint(painted.context, { x: 0, y: 0 })

    expect(host.size).toEqual({ width: 240, height: 120 })
    expect(child.size).toEqual({ width: 240, height: 120 })
    expect(child.offset).toEqual({ x: 0, y: 0 })
    expect(child.layoutCalls).toBe(1)
    expect(child.paintCalls).toBe(1)
  })

  it('detaches the previous child without disposing it when replacing content', () => {
    const owner = new PipelineOwner({}, ImGuiDarkTheme)
    const first = new PaintRecordingBox()
    const second = new PaintRecordingBox()
    const host = new RenderLoadingHost({ child: first })
    host.attach(owner)
    host.layout(constraints, false, { theme: ImGuiDarkTheme })

    host.setChild(second)

    expect(first.disposed).toBe(false)
    expect(first.parent).toBeUndefined()
    expect(first.owner).toBeUndefined()
    expect(second.parent).toBe(host)
    expect(second.owner).toBe(owner)
  })

  it('paints loading overlay above child content', () => {
    const child = new PaintRecordingBox()
    const host = new RenderLoadingHost({ child, loading: true, text: 'Loading...' })
    host.layout(constraints, false, { theme: ImGuiDarkTheme })

    const painted = createRecordingPaintContext()
    host.paint(painted.context, { x: 0, y: 0 })

    expect(painted.calls[0]).toBe('fillRect')
    expect(painted.calls.filter(call => call === 'fillRect')).toHaveLength(2)
    expect(painted.calls.indexOf('fillRect')).toBeLessThan(painted.calls.lastIndexOf('fillRect'))
    expect(painted.calls).toContain('fillText:Loading...')
  })

  it('clips loading overlay drawing to the host bounds', () => {
    const child = new PaintRecordingBox()
    const host = new RenderLoadingHost({ child, loading: true, text: 'Long loading text that should not escape' })
    host.layout({ minWidth: 0, maxWidth: 40, minHeight: 0, maxHeight: 30 }, false, { theme: ImGuiDarkTheme })

    const painted = createRecordingPaintContext()
    host.paint(painted.context, { x: 0, y: 0 })

    expect(painted.calls).toContain('clip')
    expect(painted.calls.indexOf('clip')).toBeLessThan(painted.calls.indexOf('fillText:Long loading text that should not escape'))
    expect(painted.calls.lastIndexOf('restore')).toBeGreaterThan(painted.calls.indexOf('fillText:Long loading text that should not escape'))
  })

  it('blocks child hit testing by default while loading', () => {
    const child = new PaintRecordingBox()
    const host = new RenderLoadingHost({ child, loading: true })
    host.layout(constraints, false, { theme: ImGuiDarkTheme })

    const result = new HitTestResult()
    expect(host.hitTestPath({ x: 10, y: 10 }, result)).toBe(true)

    expect(result.path.map(entry => entry.target)).toEqual([host])
  })

  it('allows child hit testing while loading when blockInput is false', () => {
    const child = new PaintRecordingBox()
    const host = new RenderLoadingHost({ child, loading: true, blockInput: false })
    host.layout(constraints, false, { theme: ImGuiDarkTheme })

    const result = new HitTestResult()
    expect(host.hitTestPath({ x: 10, y: 10 }, result)).toBe(true)

    expect(result.path.map(entry => entry.target)).toEqual([host, child])
  })

  it('marks paint on loading state changes and animation ticks', () => {
    vi.useFakeTimers()
    const onNeedPaint = vi.fn()
    const clock = new AnimationClock()
    const owner = new PipelineOwner({ onNeedPaint, animationClock: clock }, ImGuiDarkTheme)
    const host = new RenderLoadingHost({ child: new PaintRecordingBox() })
    host.attach(owner)
    host.layout(constraints, false, { theme: ImGuiDarkTheme })
    host.paint(createRecordingPaintContext().context, { x: 0, y: 0 })
    owner.clearPaintRequests()

    host.setLoading(true, 'Loading...')
    expect(onNeedPaint).toHaveBeenCalledTimes(1)

    host.paint(createRecordingPaintContext().context, { x: 0, y: 0 })
    owner.clearPaintRequests()
    onNeedPaint.mockClear()
    clock.tick(16)

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
  })
})
