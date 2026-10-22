import { describe, expect, it, vi } from 'vitest'
import { PipelineOwner, type BoxConstraints, type LayoutContext, type RenderObject } from '../core/render_object'
import { RenderBox } from '../layout/render_box'
import { RenderSpacer } from '../layout/render_flex'
import { PaintContext } from '../rendering/paint_context'
import { deriveBorderStyle } from '../theme/component_styles'
import { ImGuiLightTheme } from '../theme/default_theme'
import { colorToCSS } from '../theme/theme'
import { RenderBorder } from './border'

class FixedBox extends RenderBox {
  constructor(
    private readonly desiredWidth: number,
    private readonly desiredHeight: number,
  ) {
    super()
  }

  performLayout(_constraints: BoxConstraints, _context: LayoutContext): void {
    this.size = { width: this.desiredWidth, height: this.desiredHeight }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}
}

function createPaintContext(): {
  context: PaintContext
  fillStyles: string[]
  strokeStyles: string[]
  ctx: CanvasRenderingContext2D
} {
  const fillStyles: string[] = []
  const strokeStyles: string[] = []
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    set fillStyle(value: string) { fillStyles.push(value) },
    get fillStyle() { return fillStyles[fillStyles.length - 1] ?? '' },
    set strokeStyle(value: string) { strokeStyles.push(value) },
    get strokeStyle() { return strokeStyles[strokeStyles.length - 1] ?? '' },
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, ImGuiLightTheme), fillStyles, strokeStyles, ctx }
}

describe('RenderBorder', () => {
  it('uses native padding and preserves child margin', () => {
    const child = new RenderSpacer({ width: 40, height: 20 })
    child.margin = 4
    const border = new RenderBorder({
      padding: { horizontal: 10, vertical: 6 },
      child,
    })

    border.layout({ minWidth: 0, maxWidth: 400, minHeight: 0, maxHeight: 200 })

    expect(border.size).toEqual({ width: 68, height: 40 })
    expect(child.offset).toEqual({ x: 14, y: 10 })
  })

  it('honors explicit child size and alignment inside a tight border', () => {
    const child = new RenderSpacer({
      width: 40,
      height: 20,
      horizontalAlignment: 'center',
      verticalAlignment: 'end',
    })
    const border = new RenderBorder({ child })

    border.layout({ minWidth: 200, maxWidth: 200, minHeight: 100, maxHeight: 100 })

    expect(child.size).toEqual({ width: 40, height: 20 })
    expect(child.offset).toEqual({ x: 80, y: 80 })
  })

  it('lays out child with padding and min size', () => {
    const child = new FixedBox(80, 20)
    const border = new RenderBorder({
      padding: { horizontal: 8, vertical: 6 },
      minWidth: 120,
      minHeight: 48,
      child,
    })

    border.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 100 }, false, { theme: ImGuiLightTheme })

    expect(child.offset).toEqual({ x: 8, y: 6 })
    expect(border.size).toEqual({ width: 120, height: 48 })
  })

  it('paints selected background and left accent stripe', () => {
    const border = new RenderBorder({
      background: 'selected',
      minWidth: 120,
      minHeight: 44,
      accentSide: 'left',
      accentWidth: 4,
    })
    border.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 100 }, false, { theme: ImGuiLightTheme })
    const painted = createPaintContext()

    border.paint(painted.context, { x: 0, y: 0 })

    const style = deriveBorderStyle(ImGuiLightTheme, 'selected')
    expect(painted.fillStyles).toContain(colorToCSS(style.backgroundColor))
    expect(painted.fillStyles).toContain(colorToCSS(style.accentColor))
    expect(painted.strokeStyles).toContain(colorToCSS(style.borderColor))
  })

  it('clips accent stripe to the rounded border shape', () => {
    const border = new RenderBorder({
      background: 'selected',
      minWidth: 120,
      minHeight: 44,
      cornerRadius: 8,
      accentSide: 'top',
      accentWidth: 4,
    })
    border.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 100 }, false, { theme: ImGuiLightTheme })
    const painted = createPaintContext()

    border.paint(painted.context, { x: 0, y: 0 })

    expect(painted.ctx.clip).toHaveBeenCalledTimes(2)
    expect(painted.ctx.roundRect).toHaveBeenCalledWith(1, 1, 118, 42, 7)
    expect(painted.ctx.roundRect).toHaveBeenCalledWith(0, 0, 120, 44, 8)
  })

  it('derives primary and muted backgrounds from theme tokens', () => {
    const primary = deriveBorderStyle(ImGuiLightTheme, 'primary')
    const muted = deriveBorderStyle(ImGuiLightTheme, 'muted')

    expect(primary.backgroundColor).toEqual(ImGuiLightTheme.accentPrimary)
    expect(primary.accentColor).toEqual(ImGuiLightTheme.textOnAccent)
    expect(muted.backgroundColor).toEqual(ImGuiLightTheme.surfaceDataHeader)
    expect(muted.borderColor).toEqual(ImGuiLightTheme.borderSubtle)
  })

  it('supports explicit background and border colors without bypassing layout behavior', () => {
    const background = { r: 12, g: 34, b: 56, a: 0.4 }
    const borderColor = { r: 78, g: 90, b: 123, a: 0.8 }
    const border = new RenderBorder({
      background,
      borderColor,
      borderWidth: 2,
      cornerRadius: 5,
      minWidth: 120,
      minHeight: 44,
    })
    border.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 100 }, false, { theme: ImGuiLightTheme })
    const painted = createPaintContext()

    border.paint(painted.context, { x: 0, y: 0 })

    expect(painted.fillStyles).toContain(colorToCSS(background))
    expect(painted.strokeStyles).toContain(colorToCSS(borderColor))
  })

  it('marks paint dirty when visual properties change', () => {
    const border = new RenderBorder({ minWidth: 120, minHeight: 44 })
    border.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 100 }, false, { theme: ImGuiLightTheme })
    border.paint(createPaintContext().context, { x: 0, y: 0 })

    expect(border.needsPaint).toBe(false)

    border.background = 'muted'

    expect(border.needsPaint).toBe(true)
  })

  it('normalizes invalid visual dimensions', () => {
    const border = new RenderBorder({ borderWidth: -2, cornerRadius: Number.NaN, accentWidth: -4 })

    expect(border.borderWidth).toBe(0)
    expect(border.cornerRadius).toBe(0)
    expect(border.accentWidth).toBe(0)

    border.borderWidth = Number.POSITIVE_INFINITY
    border.cornerRadius = -8
    border.accentWidth = Number.NaN

    expect(border.borderWidth).toBe(0)
    expect(border.cornerRadius).toBe(0)
    expect(border.accentWidth).toBe(0)
  })

  it('replaces an attached child through the managed lifecycle', () => {
    const owner = new PipelineOwner()
    const first = new FixedBox(80, 20)
    const second = new FixedBox(60, 18)
    const border = new RenderBorder({ child: first })
    border.attach(owner)

    expect(first.owner).toBe(owner)

    border.setChild(second)

    expect(first.parent).toBeUndefined()
    expect(first.owner).toBeUndefined()
    expect(second.parent).toBe(border)
    expect(second.owner).toBe(owner)
    expect(border.needsLayout).toBe(true)
  })
})


describe('Border content and adorners', () => {
  it('paints the frame after clipped content and before un-clipped adorners', () => {
    const order: string[] = []
    const child = new FixedBox(80, 30)
    const adorner = new FixedBox(80, 30)
    vi.spyOn(child, 'performPaint').mockImplementation(() => { order.push('child') })
    vi.spyOn(adorner, 'performPaint').mockImplementation(() => { order.push('adorner') })
    const border = new RenderBorder({ child, padding: 0, cornerRadius: 0, borderWidth: 2 })
    border.addAdorner(adorner)
    border.layout({ minWidth: 80, maxWidth: 80, minHeight: 30, maxHeight: 30 })
    const painted = createPaintContext()
    vi.mocked(painted.ctx.clip).mockImplementation(() => { order.push('clip') })
    vi.mocked(painted.ctx.restore).mockImplementation(() => { order.push('restore') })
    vi.mocked(painted.ctx.strokeRect).mockImplementation(() => { order.push('frame') })
    border.paint(painted.context, { x: 0, y: 0 })
    expect(order).toEqual(['clip', 'child', 'restore', 'frame', 'adorner'])
    expect(child.offset).toEqual({ x: 0, y: 0 })
    border.dispose()
  })

  it('preserves borderless content painting without adding a clip', () => {
    const border = new RenderBorder({ child: new FixedBox(80, 30), borderWidth: 0 })
    border.layout({ minWidth: 80, maxWidth: 80, minHeight: 30, maxHeight: 30 })
    const painted = createPaintContext()
    border.paint(painted.context, { x: 0, y: 0 })
    expect(painted.ctx.clip).not.toHaveBeenCalled()
    expect(painted.strokeStyles).toEqual([])
    border.dispose()
  })
})
