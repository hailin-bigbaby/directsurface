import { describe, expect, it } from 'vitest'
import type { BoxConstraints, LayoutContext, RenderObject } from '../core/render_object'
import { RenderBox, RenderVisibility } from './render_box'
import { RenderDockPanel } from './render_dock_panel'
import { RenderStackPanel, RenderSpacer, type MainAxisAlignment } from './render_flex'
import { gridFr, RenderGridPanel } from './render_grid_panel'

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

describe('RenderStackPanel', () => {
  it('lets flexible children occupy their allocated main-axis space', () => {
    const leading = new FixedBox(30, 20)
    const middle = new RenderStackPanel({ orientation: 'vertical', spacing: 2 })
    const middleText = new FixedBox(40, 12)
    const trailing = new FixedBox(20, 18)
    middle.addChild(middleText)

    const row = new RenderStackPanel({ orientation: 'horizontal', spacing: 5, crossAxisAlignment: 'center' })
    row.addChild(leading)
    row.addChild(middle, 1)
    row.addChild(trailing)

    row.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 60 })

    expect(row.size.width).toBe(200)
    expect(middle.size.width).toBe(140)
    expect(trailing.offset.x + trailing.size.width).toBe(200)
  })

  it('uses parent-owned flex data for spacer and content distribution', () => {
    const left = new FixedBox(30, 20)
    const spacer = new RenderSpacer()
    const contentChild = new FixedBox(40, 20)
    const right = new FixedBox(20, 20)

    const row = new RenderStackPanel({ orientation: 'horizontal', spacing: 5 })
    row.addChild(left)
    row.addChild(spacer, 1)
    row.addChild(contentChild, 2)
    row.addChild(right)

    row.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 60 })

    expect(spacer.size.width).toBeCloseTo(45)
    expect(contentChild.size.width).toBeCloseTo(90)
    expect(right.offset.x + right.size.width).toBe(200)
  })

  it('lays out flex children naturally when the main axis is unbounded', () => {
    const left = new FixedBox(30, 20)
    const flexible = new FixedBox(40, 20)
    const row = new RenderStackPanel({ orientation: 'horizontal', spacing: 5 })
    row.addChild(left)
    row.addChild(flexible, 1)

    row.layout({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: 60 })

    expect(flexible.size.width).toBe(40)
    expect(row.size.width).toBe(75)
  })

  it('measures non-flex grid children at their natural main-axis size', () => {
    const header = new FixedBox(80, 20)
    const gridContent = new FixedBox(40, 30)
    const grid = new RenderGridPanel({
      columns: [gridFr()],
      rows: [gridFr()],
    })
    grid.addChild(gridContent)
    const footer = new FixedBox(80, 10)
    const column = new RenderStackPanel({ orientation: 'vertical', spacing: 0 })
    column.addChild(header)
    column.addChild(grid)
    column.addChild(footer)

    column.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 200 })

    expect(grid.size.height).toBe(30)
    expect(footer.offset.y).toBe(50)
    expect(column.size.height).toBe(60)
  })

  it('measures non-flex dock children at their natural main-axis size', () => {
    const dock = new RenderDockPanel()
    const toolbar = new FixedBox(80, 20)
    const content = new FixedBox(80, 30)
    dock.addChild(toolbar, { dock: 'top' })
    dock.setFill(content)
    const footer = new FixedBox(80, 10)
    const column = new RenderStackPanel({ orientation: 'vertical', spacing: 0 })
    column.addChild(dock)
    column.addChild(footer)

    column.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 200 })

    expect(dock.size.height).toBe(50)
    expect(footer.offset.y).toBe(50)
    expect(column.size.height).toBe(60)
  })

  it('measures horizontal non-flex grid children at their natural main-axis size', () => {
    const leading = new FixedBox(20, 20)
    const gridContent = new FixedBox(40, 20)
    const grid = new RenderGridPanel({
      columns: [gridFr()],
      rows: [gridFr()],
    })
    grid.addChild(gridContent)
    const trailing = new FixedBox(10, 20)
    const row = new RenderStackPanel({ orientation: 'horizontal', spacing: 0 })
    row.addChild(leading)
    row.addChild(grid)
    row.addChild(trailing)

    row.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 50 })

    expect(grid.size.width).toBe(40)
    expect(trailing.offset.x).toBe(60)
    expect(row.size.width).toBe(70)
  })

  it('allocates flex space after nested non-flex panels take their natural size', () => {
    const header = new FixedBox(80, 20)
    const gridContent = new FixedBox(40, 30)
    const grid = new RenderGridPanel({
      columns: [gridFr()],
      rows: [gridFr()],
    })
    grid.addChild(gridContent)
    const flexible = new FixedBox(80, 10)
    const column = new RenderStackPanel({ orientation: 'vertical', spacing: 5 })
    column.addChild(header)
    column.addChild(grid)
    column.addChild(flexible, 1)

    column.layout({ minWidth: 0, maxWidth: 100, minHeight: 200, maxHeight: 200 })

    expect(grid.size.height).toBe(30)
    expect(flexible.offset.y).toBe(60)
    expect(flexible.size.height).toBe(140)
    expect(column.size.height).toBe(200)
  })

  it('stretches children across the cross axis when requested', () => {
    const child = new FixedBox(30, 20)
    const row = new RenderStackPanel({ orientation: 'horizontal', crossAxisAlignment: 'stretch' })
    row.addChild(child)

    row.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 60 })

    expect(child.size.height).toBe(60)
    expect(row.size.height).toBe(60)
  })

  it('lets explicit child alignment override the panel cross-axis fallback', () => {
    const child = new FixedBox(30, 20)
    child.verticalAlignment = 'center'
    const row = new RenderStackPanel({ orientation: 'horizontal', crossAxisAlignment: 'stretch' })
    row.addChild(child)

    row.layout({ minWidth: 0, maxWidth: 100, minHeight: 60, maxHeight: 60 })

    expect(child.size.height).toBe(20)
    expect(child.offset.y).toBe(20)
  })

  it('distributes main-axis space only when the panel receives extra space', () => {
    const tightFirst = new FixedBox(20, 10)
    const tightSecond = new FixedBox(20, 10)
    const tight = new RenderStackPanel({
      orientation: 'horizontal',
      spacing: 0,
      mainAxisAlignment: 'center',
    })
    tight.addChild(tightFirst)
    tight.addChild(tightSecond)
    tight.layout({ minWidth: 100, maxWidth: 100, minHeight: 0, maxHeight: 20 })

    const looseFirst = new FixedBox(20, 10)
    const looseSecond = new FixedBox(20, 10)
    const loose = new RenderStackPanel({
      orientation: 'horizontal',
      spacing: 0,
      mainAxisAlignment: 'center',
    })
    loose.addChild(looseFirst)
    loose.addChild(looseSecond)
    loose.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 20 })

    expect(tightFirst.offset.x).toBe(30)
    expect(tightSecond.offset.x).toBe(50)
    expect(loose.size.width).toBe(40)
    expect(looseFirst.offset.x).toBe(0)
    expect(looseSecond.offset.x).toBe(20)
  })

  it('does not create negative alignment gaps when content overflows', () => {
    const first = new FixedBox(80, 20)
    const second = new FixedBox(80, 20)
    const row = new RenderStackPanel({
      orientation: 'horizontal',
      mainAxisAlignment: 'spaceBetween',
      spacing: 0,
    })
    row.addChild(first)
    row.addChild(second)

    row.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 40 })

    expect(first.offset.x).toBe(0)
    expect(second.offset.x).toBe(80)
  })

  it('skips invisible children without reserving spacing', () => {
    const first = new FixedBox(20, 10)
    const hidden = new FixedBox(100, 10)
    const second = new FixedBox(30, 10)
    hidden.visible = false
    const row = new RenderStackPanel({ orientation: 'horizontal', spacing: 8 })
    row.addChild(first)
    row.addChild(hidden)
    row.addChild(second)

    row.layout({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: 40 })

    expect(row.size.width).toBe(58)
    expect(second.offset.x).toBe(28)
    expect(hidden.size).toEqual({ width: 0, height: 0 })
  })

  it('removes collapsed children and their adjacent spacing from layout', () => {
    const first = new FixedBox(20, 10)
    const collapsed = new RenderVisibility({ mode: 'collapsed', child: new FixedBox(100, 10) })
    const second = new FixedBox(30, 10)
    const row = new RenderStackPanel({ orientation: 'horizontal', spacing: 8 })
    row.addChild(first)
    row.addChild(collapsed)
    row.addChild(second)

    row.layout({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: 40 })

    expect(row.size.width).toBe(58)
    expect(second.offset.x).toBe(28)
    expect(collapsed.participatesInLayout).toBe(false)
  })

  it('keeps configured spacing when distributing extra main-axis space', () => {
    const cases: Array<[MainAxisAlignment, number]> = [
      ['spaceBetween', 80],
      ['spaceAround', 67.5],
      ['spaceEvenly', 63.333333333333336],
    ]

    for (const [alignment, expectedSecondX] of cases) {
      const first = new FixedBox(20, 10)
      const second = new FixedBox(20, 10)
      const row = new RenderStackPanel({
        orientation: 'horizontal',
        mainAxisAlignment: alignment,
        spacing: 10,
      })
      row.addChild(first)
      row.addChild(second)

      row.layout({ minWidth: 100, maxWidth: 100, minHeight: 0, maxHeight: 40 })

      expect(first.offset.x).toBeGreaterThanOrEqual(0)
      expect(second.offset.x).toBeCloseTo(expectedSecondX)
    }
  })

  it('invalidates layout when alignment changes', () => {
    const row = new RenderStackPanel({ orientation: 'horizontal' })
    row.addChild(new FixedBox(20, 10))
    row.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 40 })

    expect(row.needsLayout).toBe(false)

    row.mainAxisAlignment = 'center'
    expect(row.needsLayout).toBe(true)

    row.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 40 })
    row.crossAxisAlignment = 'stretch'
    expect(row.needsLayout).toBe(true)
  })
})
