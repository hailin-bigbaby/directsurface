import { describe, expect, it, vi } from 'vitest'
import { RenderSlider } from './slider'
import { PaintContext } from '../rendering/paint_context'
const constraints = { minWidth: 0, maxWidth: 240, minHeight: 0, maxHeight: 40 }
function createPaintContext(): PaintContext {
  const ctx = {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), arc: vi.fn(),
    fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), measureText: () => ({ width: 10 }),
  } as unknown as CanvasRenderingContext2D
  return new PaintContext(ctx)
}

describe('Slider numeric formatting', () => {
  it.each([
    [1e-7, '0.0000001'], [2.5e-7, '0.00000025'], [0.01, '0.01'],
  ] as const)('displays the actual keyboard step for %s', (step, expected) => {
    const slider = new RenderSlider({ value: 0, min: 0, max: 1, step })
    slider.layout({ ...constraints, maxWidth: 400 })
    slider.focusIn()
    slider.onKeyDown({ key: 'ArrowUp', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    expect(slider.value).toBe(step)
    const context = createPaintContext()
    slider.performPaint(context, { x: 0, y: 0 })
    expect(vi.mocked(context.ctx.fillText).mock.calls.map(call => call[0])).toContain(expected)
    slider.dispose()
  })

  it('caps fractional precision at the supported toFixed limit', () => {
    const slider = new RenderSlider({ value: Number.MIN_VALUE, step: Number.MIN_VALUE, min: 0, max: 1 })
    slider.layout({ ...constraints, maxWidth: 1200 })
    const context = createPaintContext()
    expect(() => slider.performPaint(context, { x: 0, y: 0 })).not.toThrow()
    const label = vi.mocked(context.ctx.fillText).mock.calls[0]![0]
    expect(label.split('.')[1]).toHaveLength(100)
    slider.dispose()
  })
})
