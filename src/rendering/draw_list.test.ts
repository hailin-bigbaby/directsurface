import { afterEach, describe, expect, it, vi } from 'vitest'
import { rgba } from '../theme/theme'
import { PaintContext } from './paint_context'
import { DrawList } from './draw_list'

function createContext(scale = 1): {
  ctx: CanvasRenderingContext2D
  fillStyleSets: unknown[]
  strokeStyleSets: unknown[]
  fontSets: string[]
} {
  const fillStyleSets: unknown[] = []
  const strokeStyleSets: unknown[] = []
  const fontSets: string[] = []
  let fillStyle: unknown = ''
  let strokeStyle: unknown = ''
  let font = ''
  let textAlign: CanvasTextAlign = 'left'
  let textBaseline: CanvasTextBaseline = 'alphabetic'
  let lineWidth = 1
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(text => ({ width: String(text).length * 8 }) as TextMetrics),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    getTransform: vi.fn(() => ({ a: scale, d: scale })),
    createLinearGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    set fillStyle(value: unknown) {
      fillStyle = value
      fillStyleSets.push(value)
    },
    get fillStyle() { return fillStyle as string },
    set strokeStyle(value: unknown) {
      strokeStyle = value
      strokeStyleSets.push(value)
    },
    get strokeStyle() { return strokeStyle as string },
    set font(value: string) {
      font = value
      fontSets.push(value)
    },
    get font() { return font },
    set textAlign(value: CanvasTextAlign) { textAlign = value },
    get textAlign() { return textAlign },
    set textBaseline(value: CanvasTextBaseline) { textBaseline = value },
    get textBaseline() { return textBaseline },
    set lineWidth(value: number) { lineWidth = value },
    get lineWidth() { return lineWidth },
  } as unknown as CanvasRenderingContext2D
  return { ctx, fillStyleSets, strokeStyleSets, fontSets }
}

afterEach(() => {
  DrawList.setProfiling(false)
  DrawList.resetStats()
})

describe('DrawList state and cache protection', () => {
  it('repairs cached styles after another DrawList or raw canvas changes them', () => {
    const { ctx } = createContext()
    const a = new DrawList(new PaintContext(ctx))
    const b = new DrawList(new PaintContext(ctx))
    const red = rgba(255, 0, 0)
    const blue = rgba(0, 0, 255)
    a.fillRect(0, 0, 10, 10, red)
    b.fillRect(10, 0, 10, 10, blue)
    a.fillRect(20, 0, 10, 10, red)
    expect(ctx.fillStyle).toBe('rgba(255,0,0,1)')
    a.line(0, 0, 10, 0, red, 2)
    b.line(0, 2, 10, 2, blue, 4)
    a.line(0, 4, 10, 4, red, 2)
    expect(ctx.strokeStyle).toBe('rgba(255,0,0,1)')
    expect(ctx.lineWidth).toBe(2)
    a.fillText('A', 0, 0, red, 12, 'Arial', 'left', 'middle')
    ctx.font = '20px serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    a.fillText('B', 0, 0, red, 12, 'Arial', 'left', 'middle')
    expect(ctx.font).toBe('12px Arial')
    expect(ctx.textAlign).toBe('left')
    expect(ctx.textBaseline).toBe('middle')
  })

  it.each([0, -1, NaN, Infinity])('skips invalid stroke width %s without changing canvas state', width => {
    const { ctx } = createContext()
    const dl = new DrawList(new PaintContext(ctx))
    const color = rgba(0, 0, 0)
    ctx.lineWidth = 4
    dl.line(0, 0, 10, 0, color, width)
    dl.lineDashed(0, 0, 10, 0, color, width)
    dl.strokeRect(0, 0, 10, 10, color, width)
    dl.strokeRectDashed(0, 0, 10, 10, color, width)
    dl.strokeCircle(5, 5, 3, color, width)
    dl.strokePolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }], color, width)
    dl.drawCheckmark(0, 0, 10, color, width)
    expect(ctx.stroke).not.toHaveBeenCalled()
    expect(ctx.strokeRect).not.toHaveBeenCalled()
    expect(ctx.lineWidth).toBe(4)
  })

  it('caches simple drawing state and avoids save/restore for hot primitives', () => {
    const { ctx, fillStyleSets, fontSets } = createContext(1)
    const dl = new DrawList(new PaintContext(ctx))

    DrawList.setProfiling(true)
    dl.fillRect(0, 0, 10, 10, rgba(10, 20, 30))
    dl.fillRect(12, 0, 10, 10, rgba(10, 20, 30))
    dl.fillText('A', 2, 2, rgba(10, 20, 30), 13, 'Arial')
    dl.fillText('B', 4, 2, rgba(10, 20, 30), 13, 'Arial')

    expect(ctx.save).not.toHaveBeenCalled()
    expect(ctx.restore).not.toHaveBeenCalled()
    expect(fillStyleSets).toEqual(['rgba(10,20,30,1)'])
    expect(fontSets).toEqual(['13px Arial'])
    expect(DrawList.getStats()).toMatchObject({
      fillRect: 2,
      fillText: 2,
      fillStyleChanges: 1,
      fontChanges: 1,
      save: 0,
      restore: 0,
    })
  })

  it('bounds color and font strings, retains hot entries and regenerates evicted values', () => {
    type Cache = { entries: Map<string, string>; clear(): void }
    const caches = DrawList as unknown as { _colorCache: Cache; _fontCache: Cache }
    caches._colorCache.clear()
    caches._fontCache.clear()
    const { ctx } = createContext()
    const dl = new DrawList(new PaintContext(ctx))
    const color = rgba(10, 20, 30, 0.75)
    const hotColor = '10,20,30,0.75'
    const hotFont = '|600|13|Arial'
    const drawHot = () => dl.fillText('hot', 0, 0, color, 13, 'Arial', 'left', 'middle', 600)
    drawHot()
    for (let i = 0; i < 5000; i++) {
      dl.fillRect(0, 0, 1, 1, rgba(50, 60, 70, i / 5000))
      if (i < 512) dl.fillText('', 0, 0, color, 12, `CacheFont${i}`)
      if (i % 32 === 0) drawHot()
      expect(caches._colorCache.entries.size).toBeLessThanOrEqual(2048)
      expect(caches._fontCache.entries.size).toBeLessThanOrEqual(256)
    }
    expect(caches._colorCache.entries.size).toBe(2048)
    expect(caches._fontCache.entries.size).toBe(256)
    expect(caches._colorCache.entries.has(hotColor)).toBe(true)
    expect(caches._fontCache.entries.has(hotFont)).toBe(true)
    expect(caches._colorCache.entries.has('50,60,70,0')).toBe(false)
    expect(caches._fontCache.entries.has('||12|CacheFont0')).toBe(false)
    dl.fillRect(0, 0, 1, 1, rgba(50, 60, 70, 0))
    expect(ctx.fillStyle).toBe('rgba(50,60,70,0)')
    dl.fillText('restored', 0, 0, color, 12, 'CacheFont0')
    expect(ctx.font).toBe('12px CacheFont0')
    expect(caches._colorCache.entries.size).toBe(2048)
    expect(caches._fontCache.entries.size).toBe(256)
    caches._colorCache.clear()
    caches._fontCache.clear()
  })


  it('retains browser-normalized styles without redundant assignments', () => {
    const { ctx } = createContext()
    let actual = '#000000'
    const assign = vi.fn((value: string) => { actual = value === 'rgba(255,0,0,1)' ? '#ff0000' : value })
    Object.defineProperty(ctx, 'fillStyle', { get: () => actual, set: assign })
    const dl = new DrawList(new PaintContext(ctx))
    const red = rgba(255, 0, 0)
    dl.fillRect(0, 0, 1, 1, red)
    dl.fillRect(1, 0, 1, 1, red)
    expect(assign).toHaveBeenCalledTimes(1)
    ctx.fillStyle = '#00ff00'
    dl.fillRect(2, 0, 1, 1, red)
    expect(actual).toBe('#ff0000')
    expect(assign).toHaveBeenCalledTimes(3)
  })
})


describe("DrawList primitive pixel alignment", () => {
  it.each([0.5, 1, 1.25, 1.5, 2, -2])('reads one transform per aligned primitive at scale %s', scale => {
    const { ctx } = createContext(scale)
    const dl = new DrawList(new PaintContext(ctx))
    const color = rgba(1, 2, 3)
    for (const draw of [
      () => dl.fillRect(-2.3, 4.7, 8.4, 9.2, color),
      () => dl.strokeRect(-2.3, 4.7, 8.4, 9.2, color),
      () => dl.line(0, 10, 20, 10, color),
      () => dl.fillText('text', 1, 2, color, 12, 'Arial'),
    ]) {
      vi.mocked(ctx.getTransform).mockClear()
      draw()
      expect(ctx.getTransform).toHaveBeenCalledTimes(1)
    }
  })

  it('reads external transform changes instead of retaining an obsolete pixel grid', () => {
    const { ctx } = createContext()
    const dl = new DrawList(new PaintContext(ctx))
    const draw = () => dl.fillRect(0.3, 0.3, 3, 3, rgba(1, 2, 3))
    draw()
    expect(ctx.fillRect).toHaveBeenLastCalledWith(0, 0, 3, 3)
    vi.mocked(ctx.getTransform).mockReturnValue({ a: 2, d: 2, e: 0.5, f: 0.5 } as DOMMatrix)
    draw()
    expect(ctx.fillRect).toHaveBeenLastCalledWith(0.25, 0.25, 3, 3)
    vi.mocked(ctx.getTransform).mockReturnValue({ a: 1, d: 1 } as DOMMatrix)
    draw()
    expect(ctx.fillRect).toHaveBeenLastCalledWith(0, 0, 3, 3)
  })

  it('keeps continuous polygon vertices and diagonal line endpoints', () => {
    const { ctx } = createContext()
    const dl = new DrawList(new PaintContext(ctx))
    dl.line(0.2, 0.3, 8.7, 9.8, rgba(0, 0, 0))
    expect(ctx.moveTo).toHaveBeenLastCalledWith(0.2, 0.3)
    expect(ctx.lineTo).toHaveBeenLastCalledWith(8.7, 9.8)
    dl.strokePolygon([{ x: 0.2, y: 0.3 }, { x: 8.7, y: 9.8 }], rgba(0, 0, 0))
    expect(ctx.lineTo).toHaveBeenLastCalledWith(8.7, 9.8)
    expect(ctx.getTransform).not.toHaveBeenCalled()
  })


  it.each([
    [2, 1, 0.5, 0.25], [0.5, 0.5, 0.25, 0.5], [-2, -1.5, 40.25, 30.5],
    [1.25, 1.5, 0.25, 0.5],
  ])('aligns text and circle centers for scale (%s, %s) and translation (%s, %s)', (a, d, e, f) => {
    const { ctx } = createContext()
    vi.mocked(ctx.getTransform).mockReturnValue({ a, d, e, f } as DOMMatrix)
    const dl = new DrawList(new PaintContext(ctx))
    const x = (Math.round(10.3 * a + e) - e) / a
    const y = (Math.round(12.7 * d + f) - f) / d
    dl.fillText('Text', 10.3, 12.7, rgba(0, 0, 0), 12, 'Arial')
    expect(ctx.fillText).toHaveBeenLastCalledWith('Text', x, y)
    dl.fillCircle(10.3, 12.7, 4.3, rgba(0, 0, 0))
    expect(ctx.arc).toHaveBeenLastCalledWith(x, y, 4.3, 0, Math.PI * 2)
    dl.strokeCircle(10.3, 12.7, 4.3, rgba(0, 0, 0), 1)
    expect(ctx.arc).toHaveBeenLastCalledWith(x, y, 4.3, 0, Math.PI * 2)
  })

  it('uses independent axes for solid and dashed strokes', () => {
    const { ctx } = createContext()
    vi.mocked(ctx.getTransform).mockReturnValue({ a: 2, d: 1, e: 0.5, f: 0.25 } as DOMMatrix)
    const dl = new DrawList(new PaintContext(ctx))
    dl.line(4, 10, 28, 10, rgba(0, 0, 0), 1)
    expect(ctx.moveTo).toHaveBeenLastCalledWith(4.25, 10.25)
    expect(ctx.lineTo).toHaveBeenLastCalledWith(28.25, 10.25)
    dl.lineDashed(10, 4, 10, 28, rgba(0, 0, 0), 1)
    expect(ctx.moveTo).toHaveBeenLastCalledWith(10.25, 3.75)
    expect(ctx.lineTo).toHaveBeenLastCalledWith(10.25, 27.75)
  })

  it.each([
    { a: 0, b: 1, c: -1, d: 0, e: 20, f: 0 },
    { a: 1, b: 0.2, c: 0, d: 1, e: 0.25, f: 0.5 },
    { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 },
  ])('keeps rotated, skewed or singular geometry intact: %j', transform => {
    const { ctx } = createContext()
    vi.mocked(ctx.getTransform).mockReturnValue(transform as DOMMatrix)
    const dl = new DrawList(new PaintContext(ctx))
    dl.fillText('A', 0.2, 1.3, rgba(0, 0, 0), 12, 'Arial')
    expect(ctx.fillText).toHaveBeenLastCalledWith('A', 0.2, 1.3)
    dl.fillCircle(0.2, 1.3, 4.5, rgba(0, 0, 0))
    expect(ctx.arc).toHaveBeenLastCalledWith(0.2, 1.3, 4.5, 0, Math.PI * 2)
    dl.line(0.2, 1.3, 8.7, 1.3, rgba(0, 0, 0))
    expect(ctx.moveTo).toHaveBeenLastCalledWith(0.2, 1.3)
    expect(ctx.lineTo).toHaveBeenLastCalledWith(8.7, 1.3)
  })
})


describe('batched segments', () => {
  it('strokes independent segments once using one current transform', () => {
    const { ctx } = createContext(2)
    const dl = new DrawList(new PaintContext(ctx))
    dl.strokeSegments([{ x1: 0, y1: 2, x2: 10, y2: 2 }, { x1: 0, y1: 4, x2: 10, y2: 4 }], rgba(0, 0, 0), 0.5)
    expect(ctx.stroke).toHaveBeenCalledTimes(1)
    expect(ctx.getTransform).toHaveBeenCalledTimes(1)
    expect(ctx.moveTo).toHaveBeenNthCalledWith(1, 0, 2.25)
    expect(ctx.moveTo).toHaveBeenNthCalledWith(2, 0, 4.25)
    expect(ctx.lineTo).toHaveBeenCalledTimes(2)
  })

  it('does not stroke an empty or invalid-width batch', () => {
    const { ctx } = createContext()
    const dl = new DrawList(new PaintContext(ctx))
    dl.strokeSegments([], rgba(0, 0, 0))
    dl.strokeSegments([{ x1: 0, y1: 0, x2: 10, y2: 0 }], rgba(0, 0, 0), 0)
    expect(ctx.stroke).not.toHaveBeenCalled()
    expect(ctx.getTransform).not.toHaveBeenCalled()
  })

  it('skips non-finite segments rather than connecting them to the preceding path', () => {
    const { ctx } = createContext()
    const dl = new DrawList(new PaintContext(ctx))
    dl.strokeSegments([
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: NaN, y1: 0, x2: 20, y2: 20 },
      { x1: 0, y1: 0, x2: Infinity, y2: 20 },
    ], rgba(0, 0, 0))
    expect(ctx.moveTo).toHaveBeenCalledTimes(1)
    expect(ctx.lineTo).toHaveBeenCalledTimes(1)
    expect(ctx.stroke).toHaveBeenCalledTimes(1)
  })

})
