import { describe, expect, it } from 'vitest'
import { PipelineOwner, type RenderLoadedContext, type BoxConstraints, type LayoutContext, type RenderObject } from '../core/render_object'
import { RenderBox, RenderVisibility } from './render_box'
import { RenderAdaptiveGridPanel } from './render_adaptive_grid_panel'

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

describe('RenderAdaptiveGridPanel', () => {
  it('reduces columns when the available width is narrow', () => {
    const grid = new RenderAdaptiveGridPanel({ minColumnWidth: 100, maxColumns: 4, columnGap: 10, rowGap: 6 })
    const first = new FixedBox(20, 20)
    const second = new FixedBox(20, 30)
    const third = new FixedBox(20, 10)
    grid.addChild(first)
    grid.addChild(second)
    grid.addChild(third)

    grid.layout({ minWidth: 0, maxWidth: 210, minHeight: 0, maxHeight: Infinity })

    expect(first.size).toEqual({ width: 100, height: 20 })
    expect(second.offset).toEqual({ x: 110, y: 0 })
    expect(third.offset).toEqual({ x: 0, y: 36 })
    expect(grid.size).toEqual({ width: 210, height: 46 })
  })

  it('honors maxColumns when more columns could fit', () => {
    const grid = new RenderAdaptiveGridPanel({ minColumnWidth: 80, maxColumns: 3, columnGap: 10, rowGap: 6 })
    const children = [new FixedBox(1, 10), new FixedBox(1, 10), new FixedBox(1, 10), new FixedBox(1, 10)]
    for (const child of children) grid.addChild(child)

    grid.layout({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: Infinity })

    expect(children[0]?.size.width).toBe(160)
    expect(children[1]?.offset.x).toBe(170)
    expect(children[2]?.offset.x).toBe(340)
    expect(children[3]?.offset).toEqual({ x: 0, y: 16 })
  })

  it('clamps columnSpan to the active column count', () => {
    const grid = new RenderAdaptiveGridPanel({ minColumnWidth: 90, maxColumns: 4, columnGap: 10, rowGap: 4 })
    const wide = new FixedBox(1, 20)
    const next = new FixedBox(1, 12)
    grid.addChild(wide, { columnSpan: 4 })
    grid.addChild(next)

    grid.layout({ minWidth: 0, maxWidth: 190, minHeight: 0, maxHeight: Infinity })

    expect(wide.size.width).toBe(190)
    expect(next.size.width).toBe(90)
    expect(next.offset).toEqual({ x: 0, y: 24 })
  })

  it('does not reserve a grid cell for collapsed children', () => {
    const grid = new RenderAdaptiveGridPanel({ minColumnWidth: 100, maxColumns: 2, columnGap: 10, rowGap: 6 })
    const first = new FixedBox(20, 20)
    const collapsed = new RenderVisibility({ mode: 'collapsed', child: new FixedBox(20, 20) })
    const second = new FixedBox(20, 20)
    grid.addChild(first)
    grid.addChild(collapsed)
    grid.addChild(second)

    grid.layout({ minWidth: 0, maxWidth: 210, minHeight: 0, maxHeight: Infinity })

    expect(second.offset).toEqual({ x: 110, y: 0 })
    expect(grid.size.height).toBe(20)
  })

  it('uses gaps, offsets, and constrained size consistently', () => {
    const grid = new RenderAdaptiveGridPanel({ minColumnWidth: 100, minColumns: 2, maxColumns: 3, columnGap: 12, rowGap: 8 })
    const first = new FixedBox(1, 16)
    const second = new FixedBox(1, 24)
    const third = new FixedBox(1, 20)
    grid.addChild(first)
    grid.addChild(second, { columnSpan: 2 })
    grid.addChild(third)

    grid.layout({ minWidth: 0, maxWidth: 324, minHeight: 0, maxHeight: 80 })

    expect(first.size).toEqual({ width: 100, height: 16 })
    expect(second.size).toEqual({ width: 212, height: 24 })
    expect(second.offset).toEqual({ x: 112, y: 0 })
    expect(third.offset).toEqual({ x: 0, y: 32 })
    expect(grid.size).toEqual({ width: 324, height: 52 })
  })

  it('lets child alignment override adaptive cell defaults', () => {
    const grid = new RenderAdaptiveGridPanel({ minColumnWidth: 100, maxColumns: 2, columnGap: 10 })
    const aligned = new FixedBox(20, 10)
    aligned.horizontalAlignment = 'center'
    aligned.verticalAlignment = 'end'
    const tall = new FixedBox(20, 30)
    grid.addChild(aligned)
    grid.addChild(tall)

    grid.layout({ minWidth: 0, maxWidth: 210, minHeight: 0, maxHeight: Infinity })

    expect(aligned.size).toEqual({ width: 20, height: 10 })
    expect(aligned.offset).toEqual({ x: 40, y: 20 })
  })

  it('invalidates layout when responsive options change', () => {
    const grid = new RenderAdaptiveGridPanel({ minColumnWidth: 100, minColumns: 1, maxColumns: 3 })
    grid.addChild(new FixedBox(1, 10))
    grid.layout({ minWidth: 0, maxWidth: 320, minHeight: 0, maxHeight: Infinity })

    expect(grid.needsLayout).toBe(false)

    grid.minColumnWidth = 120
    expect(grid.needsLayout).toBe(true)

    grid.layout({ minWidth: 0, maxWidth: 320, minHeight: 0, maxHeight: Infinity })
    grid.minColumns = 2
    expect(grid.needsLayout).toBe(true)

    grid.layout({ minWidth: 0, maxWidth: 320, minHeight: 0, maxHeight: Infinity })
    grid.maxColumns = 4
    expect(grid.needsLayout).toBe(true)
  })
})

describe('two-phase layout lifecycle', () => {
  it('measures without loading children and commits stretched geometry once', () => {
    const contexts: RenderLoadedContext[] = []
    class LoadedBox extends FixedBox { onLoaded(context: RenderLoadedContext): void { contexts.push(context) } }
    const panel = new RenderAdaptiveGridPanel({ minColumnWidth: 100, maxColumns: 2, columnGap: 0, rowGap: 0 })
    const child = new LoadedBox(20, 10)
    child.verticalAlignment = 'stretch'
    panel.addChild(child); panel.addChild(new FixedBox(20, 80))
    panel.attach(new PipelineOwner())
    const constraints = { minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: Infinity }
    expect(panel.measure(constraints).height).toBe(80)
    expect(contexts).toHaveLength(0)
    panel.layout(constraints)
    expect(child.size.height).toBe(80)
    expect(contexts.map(context => context.size.height)).toEqual([80])
    panel.layout({ ...constraints, maxWidth: 100 })
    expect(contexts).toHaveLength(1)
    panel.dispose()
  })
})
