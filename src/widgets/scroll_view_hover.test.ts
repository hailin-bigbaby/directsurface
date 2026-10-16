import { describe, expect, it, vi } from 'vitest'
import type { BoxConstraints } from '../core/render_object'
import { RenderBox } from '../layout/render_box'
import { RenderScrollViewer } from './scroll_view'

class TestBox extends RenderBox {
  constructor(private readonly desiredWidth: number, private readonly desiredHeight: number) {
    super()
  }

  visitChildren(): void {}

  performLayout(_constraints: BoxConstraints): void {
    this.size = { width: this.desiredWidth, height: this.desiredHeight }
  }

  performPaint(): void {}
}

function layout(view: RenderScrollViewer): void {
  view.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 100 })
}

describe('ScrollViewer hover feedback', () => {
  it.each(['vertical', 'horizontal'] as const)('repaints %s thumb hover transitions without relayout or scrolling', direction => {
    const child = new TestBox(direction === 'vertical' ? 80 : 300, direction === 'vertical' ? 300 : 80)
    const view = new RenderScrollViewer({ child, direction })
    layout(view)
    const childSize = { ...child.size }
    const childOffset = { ...child.offset }
    const paint = vi.spyOn(view, 'markNeedsPaint')
    const relayout = vi.spyOn(view, 'markNeedsLayout')
    for (const along of [90, 10, 90]) {
      paint.mockClear()
      view.onPointerMove({
        pointerId: 0, type: 'move',
        position: direction === 'vertical' ? { x: 95, y: along } : { x: along, y: 95 },
      })
      expect(paint).toHaveBeenCalledTimes(1)
      expect(relayout).not.toHaveBeenCalled()
      expect(view.scrollX).toBe(0)
      expect(view.scrollY).toBe(0)
      expect(child.size).toEqual(childSize)
      expect(child.offset).toEqual(childOffset)
    }
    view.dispose()
  })
})
