import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
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

describe('GridPanel placement and track regressions', () => {
  const bounds = { minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 120 }

  it('reserves the full span and also avoids later explicit placements', () => {
    for (const explicitFirst of [true, false]) {
      const grid = new RenderGridPanel({ columns: [gridPx(100), gridPx(100), gridPx(100)], rows: [gridPx(40), gridPx(40), gridPx(40)], columnGap: 0, rowGap: 0 })
      const occupied = new FixedBox(10, 10), automatic = new FixedBox(10, 10)
      if (explicitFirst) grid.addChild(occupied, { row: 0, column: 1, rowSpan: 2 })
      grid.addChild(automatic, { columnSpan: 2 })
      if (!explicitFirst) grid.addChild(occupied, { row: 0, column: 1, rowSpan: 2 })
      grid.layout(bounds)
      expect(automatic.offset).toEqual({ x: 0, y: 80 })
      grid.dispose()
    }
  })

  it('keeps an explicit column while searching for an unoccupied row', () => {
    const grid = new RenderGridPanel({ columns: [gridPx(100), gridPx(100)], rowGap: 0 })
    const occupied = new FixedBox(10, 20), automatic = new FixedBox(10, 20)
    grid.addChild(occupied, { row: 0, column: 1, rowSpan: 2 })
    grid.addChild(automatic, { column: 1 })
    grid.layout(bounds)
    expect(automatic.offset.y).toBeGreaterThanOrEqual(occupied.offset.y + occupied.size.height)
    grid.dispose()
  })

  it.each([false, true])('redistributes capped fraction tracks independently of their order (reverse: %s)', reverse => {
    const tracks = [gridFr(), gridFr(1, { max: 50 })]
    if (reverse) tracks.reverse()
    for (const axis of ['columns', 'rows'] as const) {
      const grid = new RenderGridPanel({ columns: [gridFr()], rows: [gridFr()], [axis]: tracks, columnGap: 0, rowGap: 0 })
      const first = new FixedBox(10, 10), second = new FixedBox(10, 10)
      grid.addChild(first); grid.addChild(second)
      grid.layout({ ...bounds, maxHeight: 300 })
      const sizes = [first, second].map(child => axis === 'columns' ? child.size.width : child.size.height)
      expect(sizes).toEqual(reverse ? [50, 250] : [250, 50])
      grid.dispose()
    }
  })

  it('redistributes multiple caps while retaining fraction weights', () => {
    const grid = new RenderGridPanel({ columns: [gridFr(1, { max: 30 }), gridFr(1, { max: 40 }), gridFr(2)], columnGap: 0 })
    const children = [new FixedBox(10, 10), new FixedBox(10, 10), new FixedBox(10, 10)]
    children.forEach(child => grid.addChild(child)); grid.layout(bounds)
    expect(children.map(child => child.size.width)).toEqual([30, 40, 230])
    grid.dispose()
  })

  it('counts fixed tracks and redistributes capped auto tracks in spanning measurements', () => {
    const fixed = new RenderGridPanel({ columns: [gridPx(100), gridAuto()], columnGap: 0 })
    fixed.addChild(new FixedBox(150, 20), { columnSpan: 2 })
    fixed.layout({ ...bounds, maxWidth: Infinity, maxHeight: Infinity })
    expect(fixed.size.width).toBe(150)
    fixed.dispose()
    const capped = new RenderGridPanel({ columns: [gridAuto({ max: 30 }), gridAuto()], columnGap: 0, rowGap: 0 })
    capped.addChild(new FixedBox(100, 20), { columnSpan: 2 })
    const a = new FixedBox(0, 10), b = new FixedBox(0, 10)
    capped.addChild(a, { row: 1, column: 0 }); capped.addChild(b, { row: 1, column: 1 })
    capped.layout({ ...bounds, maxWidth: Infinity, maxHeight: Infinity })
    expect([a.size.width, b.size.width]).toEqual([30, 70])
    capped.dispose()
  })

  it.each(['px', 'fr'] as const)('does not remeasure content through nested bounded %s tracks', type => {
    class CountedBox extends FixedBox {
      calls = 0
      override performLayout(c: BoxConstraints, context: LayoutContext): void { this.calls++; super.performLayout(c, context) }
    }
    const leaf = new CountedBox(20, 20)
    let root: RenderBox = leaf
    for (let depth = 0; depth < 8; depth++) {
      const track = () => type === 'px' ? gridPx(100) : gridFr()
      const grid = new RenderGridPanel({ columns: [track()], rows: [track()], columnGap: 0, rowGap: 0 })
      grid.addChild(root); root = grid
    }
    expect(root.measure({ ...bounds, maxWidth: 100, maxHeight: 100 })).toEqual({ width: 100, height: 100 })
    expect(leaf.calls).toBe(0)
    root.layout({ ...bounds, maxWidth: 100, maxHeight: 100 })
    expect(leaf.calls).toBe(1)
    root.dispose()
  })

  it('retains natural spanning content for zero-weight tracks in unbounded space', () => {
    const grid = new RenderGridPanel({ columns: [gridFr(0), gridFr(0)], columnGap: 0 })
    grid.addChild(new FixedBox(100, 20), { columnSpan: 2 })
    grid.layout({ ...bounds, maxWidth: Infinity, maxHeight: Infinity })
    expect(grid.size.width).toBe(100)
    grid.dispose()
  })

  it('preserves caps, total allocation and permutation symmetry for fraction tracks', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        weight: fc.integer({ min: 1, max: 5 }),
        min: fc.integer({ min: 0, max: 50 }),
        capacity: fc.integer({ min: 0, max: 100 }),
      }), { minLength: 1, maxLength: 6 }),
      fc.integer({ min: 0, max: 600 }),
      (specs, extra) => {
        const width = specs.reduce((sum, spec) => sum + spec.min, 0) + extra
        const allocate = (ordered: typeof specs): number[] => {
          const grid = new RenderGridPanel({
            columns: ordered.map(spec => gridFr(spec.weight, { min: spec.min, max: spec.min + spec.capacity })),
            rows: [gridPx(20)], columnGap: 0,
          })
          const children = ordered.map(() => new FixedBox(10, 10))
          children.forEach(child => grid.addChild(child))
          try {
            grid.layout({ ...bounds, maxWidth: width })
            return children.map(child => child.size.width)
          } finally { grid.dispose() }
        }
        const forward = allocate(specs), reverse = allocate([...specs].reverse()).reverse()
        const maximum = specs.reduce((sum, spec) => sum + spec.min + spec.capacity, 0)
        expect(forward.reduce((sum, size) => sum + size, 0)).toBeCloseTo(Math.min(width, maximum), 8)
        forward.forEach((size, index) => {
          expect(size).toBeGreaterThanOrEqual(specs[index]!.min - 1e-8)
          expect(size).toBeLessThanOrEqual(specs[index]!.min + specs[index]!.capacity + 1e-8)
          expect(size).toBeCloseTo(reverse[index]!, 8)
        })
      },
    ), { numRuns: 120, seed: 20261020 })
  })

  it('keeps automatic spans disjoint from all occupied cells in mixed layouts', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        explicit: fc.boolean(),
        row: fc.integer({ min: 0, max: 8 }),
        column: fc.integer({ min: 0, max: 3 }),
        rowSpan: fc.integer({ min: 1, max: 3 }),
        columnSpan: fc.integer({ min: 1, max: 3 }),
      }), { minLength: 2, maxLength: 12 }),
      specs => {
        const grid = new RenderGridPanel({
          columns: Array.from({ length: 4 }, () => gridPx(40)),
          rows: Array.from({ length: 60 }, () => gridPx(10)), columnGap: 0, rowGap: 0,
        })
        const children = specs.map(spec => {
          const child = new FixedBox(10, 10)
          grid.addChild(child, { rowSpan: spec.rowSpan, columnSpan: spec.columnSpan,
            ...(spec.explicit ? { row: spec.row, column: spec.column } : {}) })
          return child
        })
        try {
          grid.layout({ ...bounds, maxWidth: 160, maxHeight: 600 })
          children.forEach((a, index) => {
            if (specs[index]!.explicit) return
            children.forEach((b, other) => {
              if (other === index) return
              const overlap = a.offset.x < b.offset.x + b.size.width && a.offset.x + a.size.width > b.offset.x &&
                a.offset.y < b.offset.y + b.size.height && a.offset.y + a.size.height > b.offset.y
              expect(overlap).toBe(false)
            })
          })
        } finally { grid.dispose() }
      },
    ), { numRuns: 120, seed: 20261021 })
  })
})
