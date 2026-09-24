import { describe, expect, it } from 'vitest'
import { PipelineOwner, type BoxConstraints, type LayoutContext, type RenderLifecycleAware, type RenderLoadedContext, type RenderObject } from '../core/render_object'
import { RenderBox } from './render_box'
import { gridAuto, gridFr, gridPx, gridStar, RenderGridPanel } from './render_grid_panel'

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

class LoadedFixedBox extends FixedBox implements RenderLifecycleAware {
  readonly loadedContexts: RenderLoadedContext[] = []

  onLoaded(context: RenderLoadedContext): void {
    this.loadedContexts.push(context)
  }
}

class WidthSensitiveBox extends RenderBox {
  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? 260 : constraints.maxWidth
    const desiredHeight = constraints.maxWidth === Infinity || constraints.maxWidth >= 160 ? 24 : 76
    this.size = {
      width: Math.max(constraints.minWidth, Math.min(constraints.maxWidth, width)),
      height: Math.max(constraints.minHeight, Math.min(constraints.maxHeight, desiredHeight)),
    }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}
}

describe('RenderGridPanel', () => {
  it('resolves px auto and fr tracks across rows and columns', () => {
    const left = new FixedBox(40, 24)
    const label = new FixedBox(60, 30)
    const body = new FixedBox(60, 40)
    const grid = new RenderGridPanel({
      columns: [gridPx(80), gridAuto(), gridFr(1)],
      rows: [gridAuto(), gridFr(1)],
      columnGap: 10,
      rowGap: 6,
    })
    grid.addChild(left, { row: 0, column: 0 })
    grid.addChild(label, { row: 0, column: 1 })
    grid.addChild(body, { row: 1, column: 2 })

    grid.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 140 })

    expect(grid.size).toEqual({ width: 300, height: 140 })
    expect(left.offset).toEqual({ x: 0, y: 0 })
    expect(left.size).toEqual({ width: 80, height: 30 })
    expect(label.offset).toEqual({ x: 90, y: 0 })
    expect(label.size).toEqual({ width: 60, height: 30 })
    expect(body.offset.x).toBe(160)
    expect(body.size).toEqual({ width: 140, height: 104 })
  })

  it('supports cell alignment without stretching the child', () => {
    const child = new FixedBox(20, 10)
    const grid = new RenderGridPanel({
      columns: [gridPx(100)],
      rows: [gridPx(50)],
    })
    child.horizontalAlignment = 'end'
    child.verticalAlignment = 'center'
    grid.addChild(child, { row: 0, column: 0 })

    grid.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 50 })

    expect(child.size).toEqual({ width: 20, height: 10 })
    expect(child.offset).toEqual({ x: 80, y: 20 })
  })

  it('keeps fixed-size stretch children at the start of the cell', () => {
    const child = new FixedBox(20, 10)
    child.width = 20
    child.height = 10
    const grid = new RenderGridPanel({
      columns: [gridPx(100)],
      rows: [gridPx(50)],
    })
    grid.addChild(child)

    grid.layout({ minWidth: 100, maxWidth: 100, minHeight: 50, maxHeight: 50 })

    expect(child.size).toEqual({ width: 20, height: 10 })
    expect(child.offset).toEqual({ x: 0, y: 0 })
  })

  it('layers explicitly placed children in the same cell', () => {
    const backdrop = new FixedBox(20, 10)
    const content = new FixedBox(20, 10)
    content.horizontalAlignment = 'center'
    content.verticalAlignment = 'center'
    const grid = new RenderGridPanel({
      columns: [gridFr()],
      rows: [gridFr()],
    })
    grid.addChild(backdrop, { row: 0, column: 0 })
    grid.addChild(content, { row: 0, column: 0 })

    grid.layout({ minWidth: 100, maxWidth: 100, minHeight: 50, maxHeight: 50 })

    expect(backdrop.size).toEqual({ width: 100, height: 50 })
    expect(backdrop.offset).toEqual({ x: 0, y: 0 })
    expect(content.size).toEqual({ width: 20, height: 10 })
    expect(content.offset).toEqual({ x: 40, y: 20 })
  })

  it('treats fr max as the final track size cap', () => {
    const capped = new FixedBox(10, 10)
    const fluid = new FixedBox(10, 10)
    const grid = new RenderGridPanel({
      columns: [gridFr(1, { min: 20, max: 60 }), gridFr(1)],
      rows: [gridPx(20)],
      columnGap: 0,
    })
    grid.addChild(capped, { row: 0, column: 0 })
    grid.addChild(fluid, { row: 0, column: 1 })

    grid.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 20 })

    expect(capped.size.width).toBe(60)
    expect(fluid.offset.x).toBe(60)
    expect(fluid.size.width).toBe(140)
  })

  it('uses spanned children to grow auto tracks', () => {
    const child = new FixedBox(100, 20)
    const grid = new RenderGridPanel({
      columnDefinitions: [gridAuto(), gridAuto()],
      rowDefinitions: [gridAuto()],
      columnGap: 10,
    })
    grid.addChild(child, { row: 0, column: 0, columnSpan: 2 })

    grid.layout({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity })

    expect(grid.size.width).toBe(100)
    expect(child.size.width).toBe(100)
  })

  it('distributes star tracks against minimum constraints when max is unbounded', () => {
    const left = new FixedBox(10, 10)
    const right = new FixedBox(10, 10)
    const grid = new RenderGridPanel({
      columnDefinitions: [gridStar(1), gridStar(2)],
      rowDefinitions: [gridPx(20)],
      columnGap: 0,
    })
    grid.addChild(left, { row: 0, column: 0 })
    grid.addChild(right, { row: 0, column: 1 })

    grid.layout({ minWidth: 300, maxWidth: Infinity, minHeight: 0, maxHeight: 20 })

    expect(left.size.width).toBe(100)
    expect(right.offset.x).toBe(100)
    expect(right.size.width).toBe(200)
    expect(grid.size.width).toBe(300)
  })

  it('uses child natural size for star tracks when constraints are unbounded', () => {
    const child = new FixedBox(80, 20)
    const grid = new RenderGridPanel({
      columnDefinitions: [gridStar()],
      rowDefinitions: [gridAuto()],
    })
    grid.addChild(child, { row: 0, column: 0 })

    grid.layout({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity })

    expect(child.size.width).toBe(80)
    expect(grid.size.width).toBe(80)
  })

  it('measures auto rows with the resolved cell width', () => {
    const child = new WidthSensitiveBox()
    const grid = new RenderGridPanel({
      columnDefinitions: [gridStar()],
      rowDefinitions: [gridAuto()],
    })
    grid.addChild(child, { row: 0, column: 0 })

    grid.layout({ minWidth: 0, maxWidth: 120, minHeight: 0, maxHeight: Infinity })

    expect(grid.size.height).toBe(76)
    expect(child.size).toEqual({ width: 120, height: 76 })
  })

  it('does not fire child lifecycle during natural size measurement', () => {
    const owner = new PipelineOwner()
    const child = new LoadedFixedBox(80, 20)
    const grid = new RenderGridPanel({
      columnDefinitions: [gridAuto()],
      rowDefinitions: [gridAuto()],
    })
    grid.addChild(child)
    grid.attach(owner)

    grid.layout({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity })

    expect(child.loadedContexts).toHaveLength(1)
    expect(child.loadedContexts[0]?.constraints).toEqual({
      minWidth: 80,
      maxWidth: 80,
      minHeight: 20,
      maxHeight: 20,
    })
  })

  it('uses spanned children to grow star tracks under unbounded constraints', () => {
    const child = new FixedBox(100, 20)
    const grid = new RenderGridPanel({
      columnDefinitions: [gridStar(), gridStar()],
      rowDefinitions: [gridAuto()],
      columnGap: 0,
    })
    grid.addChild(child, { row: 0, column: 0, columnSpan: 2 })

    grid.layout({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity })

    expect(grid.size.width).toBe(100)
    expect(child.size.width).toBe(100)
  })
})
