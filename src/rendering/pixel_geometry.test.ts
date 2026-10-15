import { describe, expect, it, vi } from 'vitest'
import { snapLineToPixels, snapPointToPixels, snapRectToPixels, snapStrokeRectToPixels } from './pixel_geometry'

function context(a = 1, d = a, e = 0, f = 0, b = 0, c = 0): CanvasRenderingContext2D {
  return { getTransform: vi.fn(() => ({ a, b, c, d, e, f })) } as unknown as CanvasRenderingContext2D
}

describe('device pixel geometry', () => {
  it.each([
    [0.5, 10.5], [1, 10.5], [1.25, 10.5], [1.5, 10], [2, 10], [3, 10.5],
  ])('centers a %s pixel horizontal stroke symmetrically', (width, y) => {
    expect(snapLineToPixels(context(), 4, 10, 28, 10, width)).toEqual({ x1: 4, y1: y, x2: 28, y2: y })
  })

  it('includes translations in both stroke centers and endpoints', () => {
    expect(snapLineToPixels(context(1, 1, 0.25, 0.5), 4, 10, 28, 10, 1))
      .toEqual({ x1: 3.75, y1: 10, x2: 27.75, y2: 10 })
    expect(snapLineToPixels(context(1, 1, 0.5, 0.25), 10, 4, 10, 28, 1))
      .toEqual({ x1: 10, y1: 3.75, x2: 10, y2: 27.75 })
  })

  it('uses the scale normal to the stroke for nonuniform transforms', () => {
    expect(snapLineToPixels(context(2, 1), 4, 10, 28, 10, 1).y1).toBe(10.5)
    expect(snapLineToPixels(context(1, 2), 10, 4, 10, 28, 1).x1).toBe(10.5)
    expect(snapLineToPixels(context(2, 1), 10, 4, 10, 28, 1).x1).toBe(10)
  })

  it('handles zoom below one and reflected axes in device space', () => {
    expect(snapLineToPixels(context(0.5), 4, 10, 28, 10, 1).y1).toBe(11)
    const ctx = context(-2, -2, 0.25, 0.5)
    const line = snapLineToPixels(ctx, 10, 4, 10, 28, 0.5)
    expect(line.x1 * -2 + 0.25).toBe(-19.5)
    expect(line.y1 * -2 + 0.5).toBe(-7)
    expect(line.y2 * -2 + 0.5).toBe(-55)
  })

  it('aligns filled and outlined bounds without dropping fractional translations', () => {
    const ctx = context(2, 1, 0.5, 0.25)
    expect(snapRectToPixels(ctx, 0.3, 0.3, 3, 3)).toEqual({ x: 0.25, y: 0.75, w: 3, h: 3 })
    expect(snapStrokeRectToPixels(ctx, 0, 0, 10, 10, 1)).toEqual({ x: 0.75, y: 0.25, w: 9, h: 9 })
    expect(snapPointToPixels(ctx, 0.3, 0.3)).toEqual({ x: 0.25, y: 0.75 })
  })

  it.each([0.5, 1, 1.25, 1.5, 2, 3, -2])('keeps the entire outline within snapped bounds at scale %s', scale => {
    const ctx = context(scale, scale, 0.25, 0.5)
    const bounds = snapRectToPixels(ctx, 4, 6, 40, 30)
    for (const width of [0.5, 1, 2, 3]) {
      const stroke = snapStrokeRectToPixels(ctx, 4, 6, 40, 30, width)
      expect(stroke.x - width / 2).toBeCloseTo(bounds.x)
      expect(stroke.y - width / 2).toBeCloseTo(bounds.y)
      expect(stroke.x + stroke.w + width / 2).toBeCloseTo(bounds.x + bounds.w)
      expect(stroke.y + stroke.h + width / 2).toBeCloseTo(bounds.y + bounds.h)
    }
  })

  it('preserves diagonal, rotated, skewed and singular geometry', () => {
    const expected = { x1: 0.2, y1: 1.3, x2: 8.7, y2: 9.8 }
    expect(snapLineToPixels(context(), 0.2, 1.3, 8.7, 9.8, 1)).toEqual(expected)
    for (const ctx of [context(0, 0, 0, 0, 1, -1), context(1, 1, 0, 0, 0.2), context(0)]) {
      expect(snapLineToPixels(ctx, 0.2, 1.3, 8.7, 1.3, 1)).toEqual({ ...expected, y2: 1.3 })
      expect(snapRectToPixels(ctx, 0.2, 1.3, 8.7, 9.8)).toEqual({ x: 0.2, y: 1.3, w: 8.7, h: 9.8 })
    }
  })
})
