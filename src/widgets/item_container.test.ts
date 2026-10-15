import { describe, expect, it, vi } from 'vitest'
import type { BoxConstraints, LayoutContext, RenderObject } from '../core/render_object'
import { RenderBox } from '../layout/render_box'
import { PaintContext } from '../rendering/paint_context'
import { deriveItemContainerStyle } from '../theme/component_styles'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { colorToCSS, rgba } from '../theme/theme'
import { RenderItemContainer } from './item_container'

class FixedBox extends RenderBox {
  constructor(
    private readonly desiredWidth: number,
    private readonly desiredHeight: number,
  ) {
    super()
  }

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    this.size = {
      width: Math.max(constraints.minWidth, Math.min(constraints.maxWidth, this.desiredWidth)),
      height: Math.max(constraints.minHeight, Math.min(constraints.maxHeight, this.desiredHeight)),
    }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}
}

function createPaintContext(): {
  context: PaintContext
  fillStyles: string[]
  strokeStyles: string[]
  ctx: CanvasRenderingContext2D
  lineTo: ReturnType<typeof vi.fn>
  strokeRect: ReturnType<typeof vi.fn>
} {
  const fillStyles: string[] = []
  const strokeStyles: string[] = []
  const lineTo = vi.fn()
  const strokeRect = vi.fn()
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    roundRect: vi.fn(),
    moveTo: vi.fn(),
    lineTo,
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect,
    set fillStyle(value: string) { fillStyles.push(value) },
    get fillStyle() { return fillStyles[fillStyles.length - 1] ?? '' },
    set strokeStyle(value: string) { strokeStyles.push(value) },
    get strokeStyle() { return strokeStyles[strokeStyles.length - 1] ?? '' },
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, ImGuiDarkTheme), fillStyles, strokeStyles, ctx, lineTo, strokeRect }
}

describe('RenderItemContainer', () => {
  it('fills available width and lays out child with themed padding and min height', () => {
    const container = new RenderItemContainer({
      itemKey: 'a',
      item: { label: 'A' },
      index: 0,
      template: () => new FixedBox(40, 12),
    })

    container.layout({ minWidth: 0, maxWidth: 220, minHeight: 0, maxHeight: 100 }, false, { theme: ImGuiDarkTheme })

    const style = deriveItemContainerStyle(ImGuiDarkTheme)
    expect(container.size.width).toBe(220)
    expect(container.size.height).toBe(style.minHeight)
    expect(container.debugState().childOffset).toEqual({
      x: style.paddingX,
      y: (style.minHeight - 12) / 2,
    })
  })

  it('supports compact layout options for dense navigation rows', () => {
    const container = new RenderItemContainer({
      itemKey: 'a',
      item: { label: 'A' },
      index: 0,
      minHeight: 32,
      paddingY: 3,
      template: () => new FixedBox(40, 12),
    })

    container.layout({ minWidth: 0, maxWidth: 220, minHeight: 0, maxHeight: 100 }, false, { theme: ImGuiDarkTheme })

    const style = deriveItemContainerStyle(ImGuiDarkTheme)
    expect(container.size.height).toBe(32)
    expect(container.debugState().childOffset).toEqual({
      x: style.paddingX,
      y: 10,
    })
  })

  it('paints selected state with selected background border and accent stripe', () => {
    const container = new RenderItemContainer({
      itemKey: 'a',
      item: { label: 'A' },
      index: 0,
      template: () => new FixedBox(40, 12),
    })
    container.setVisualState({ selected: true })
    container.layout({ minWidth: 0, maxWidth: 220, minHeight: 0, maxHeight: 100 }, false, { theme: ImGuiDarkTheme })
    const painted = createPaintContext()

    container.paint(painted.context, { x: 0, y: 0 })

    const style = deriveItemContainerStyle(ImGuiDarkTheme)
    expect(painted.fillStyles).toContain(colorToCSS(style.background.selectedBg!))
    expect(painted.fillStyles).toContain(colorToCSS(style.accentColor))
    expect(painted.strokeStyles).toContain(colorToCSS(style.border.selectedBg!))
  })

  it('keeps the selected surface and paints an independent focus ring', () => {
    const container = new RenderItemContainer({
      itemKey: 'a',
      item: { label: 'A' },
      index: 0,
      template: () => new FixedBox(40, 12),
    })
    container.setVisualState({ selected: true, focused: true })
    container.layout({ minWidth: 0, maxWidth: 220, minHeight: 0, maxHeight: 100 }, false, { theme: ImGuiDarkTheme })
    const painted = createPaintContext()

    container.paint(painted.context, { x: 0, y: 0 })

    const style = deriveItemContainerStyle(ImGuiDarkTheme)
    expect(painted.fillStyles).toContain(colorToCSS(style.background.selectedBg!))
    expect(painted.strokeStyles).toContain(colorToCSS({
      ...style.focusColor,
      a: Math.min(0.84, Math.max(0.4, style.focusColor.a * 0.76)),
    }))
  })

  it('clips selected accent stripe to the rounded item shape', () => {
    const container = new RenderItemContainer({
      itemKey: 'a',
      item: { label: 'A' },
      index: 0,
      template: () => new FixedBox(40, 12),
    })
    container.setVisualState({ selected: true })
    container.layout({ minWidth: 0, maxWidth: 220, minHeight: 0, maxHeight: 100 }, false, { theme: ImGuiDarkTheme })
    const painted = createPaintContext()

    container.paint(painted.context, { x: 0, y: 0 })

    const style = deriveItemContainerStyle(ImGuiDarkTheme)
    expect(painted.ctx.clip).toHaveBeenCalledTimes(1)
    expect(painted.ctx.roundRect).toHaveBeenCalledWith(0, 0, 220, style.minHeight, style.borderRadius)
  })

  it('can hide the selected accent stripe for compact icon rails', () => {
    const container = new RenderItemContainer({
      itemKey: 'a',
      item: { label: 'A' },
      index: 0,
      showAccent: false,
      template: () => new FixedBox(40, 12),
    })
    container.setVisualState({ selected: true })
    container.layout({ minWidth: 0, maxWidth: 220, minHeight: 0, maxHeight: 100 }, false, { theme: ImGuiDarkTheme })
    const painted = createPaintContext()

    container.paint(painted.context, { x: 0, y: 0 })

    const style = deriveItemContainerStyle(ImGuiDarkTheme)
    expect(painted.fillStyles).toContain(colorToCSS(style.background.selectedBg!))
    expect(painted.fillStyles).not.toContain(colorToCSS(style.accentColor))
  })

  it('applies style overrides without replacing the whole appearance contract', () => {
    const transparent = rgba(0, 0, 0, 0)
    const container = new RenderItemContainer({
      itemKey: 'a',
      item: { label: 'A' },
      index: 0,
      style: {
        background: { normalBg: transparent },
        borderWidth: 0,
      },
      template: () => new FixedBox(40, 12),
    })
    container.layout({ minWidth: 0, maxWidth: 220, minHeight: 0, maxHeight: 100 }, false, { theme: ImGuiDarkTheme })
    const painted = createPaintContext()

    container.paint(painted.context, { x: 0, y: 0 })

    expect(painted.fillStyles).toContain(colorToCSS(transparent))
    expect(painted.strokeRect).not.toHaveBeenCalled()
  })

  it('can paint row appearance with a bottom separator instead of a full box border', () => {
    const container = new RenderItemContainer({
      itemKey: 'a',
      item: { label: 'A' },
      index: 0,
      appearance: 'row',
      template: () => new FixedBox(40, 12),
    })
    container.layout({ minWidth: 0, maxWidth: 220, minHeight: 0, maxHeight: 100 }, false, { theme: ImGuiDarkTheme })
    const painted = createPaintContext()

    container.paint(painted.context, { x: 0, y: 0 })

    const style = deriveItemContainerStyle(ImGuiDarkTheme, 'row')
    expect(style.borderPlacement).toBe('bottom')
    expect(painted.strokeRect).not.toHaveBeenCalled()
    expect(painted.fillStyles).toContain(colorToCSS(style.border.normalBg))
    expect(painted.ctx.fillRect).toHaveBeenCalledWith(0, container.size.height - 1, container.size.width, 1)
  })

  it('can update hover chrome without rebuilding nested content', () => {
    const renderedStates: boolean[] = []
    const container = new RenderItemContainer({
      itemKey: 'a',
      item: { label: 'A' },
      index: 0,
      appearance: 'row',
      template: (_item, state) => {
        renderedStates.push(state.hovered)
        return new FixedBox(40, 12)
      },
    })
    container.layout({ minWidth: 0, maxWidth: 220, minHeight: 0, maxHeight: 100 }, false, { theme: ImGuiDarkTheme })
    container.paint(createPaintContext().context, { x: 0, y: 0 })
    expect(container.needsPaint).toBe(false)

    container.setHoveredState(true, false)

    expect(container.debugState().hovered).toBe(true)
    expect(container.needsPaint).toBe(true)
    expect(renderedStates).toEqual([false])
    container.paint(createPaintContext().context, { x: 0, y: 0 })

    container.setHoveredState(false)

    expect(container.debugState().hovered).toBe(false)
    expect(container.needsPaint).toBe(true)
    expect(renderedStates.at(-1)).toBe(false)

    container.paint(createPaintContext().context, { x: 0, y: 0 })
    container.setHoveredState(true)

    expect(container.debugState().hovered).toBe(true)
    expect(container.needsPaint).toBe(true)
    expect(renderedStates.at(-1)).toBe(true)
  })

  it('can refresh hover-dependent nested content without changing visual state', () => {
    const renderedStates: boolean[] = []
    const container = new RenderItemContainer({
      itemKey: 'a',
      item: { label: 'A' },
      index: 0,
      template: (_item, state) => {
        renderedStates.push(state.hovered)
        return new FixedBox(40, 12)
      },
    })
    container.setHoveredState(true, false)
    expect(renderedStates).toEqual([false])

    container.refreshTemplate()

    expect(container.debugState().hovered).toBe(true)
    expect(renderedStates).toEqual([false, true])
  })
})
