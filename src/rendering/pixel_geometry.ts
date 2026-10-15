// Pixel alignment is performed in device space, including the current translation.
// Rotated/skewed geometry is left intact instead of changing its shape by rounding vertices.
interface PixelAxis {
  scale: number
  translation: number
}

interface PixelAxes {
  x: PixelAxis
  y: PixelAxis
}

function pixelAxes(ctx: CanvasRenderingContext2D): PixelAxes | null {
  const transform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : undefined
  const a = transform?.a ?? 1
  const d = transform?.d ?? 1
  const e = transform?.e ?? 0
  const f = transform?.f ?? 0
  if ((transform?.b ?? 0) !== 0 || (transform?.c ?? 0) !== 0
    || ![a, d, e, f].every(Number.isFinite) || a === 0 || d === 0) return null
  return { x: { scale: a, translation: e }, y: { scale: d, translation: f } }
}

function snap(value: number, axis: PixelAxis, phase = 0): number {
  return (Math.round(value * axis.scale + axis.translation - phase) + phase - axis.translation) / axis.scale
}

function strokePhase(width: number, axis: PixelAxis): number {
  const physicalWidth = width * Math.abs(axis.scale)
  return physicalWidth <= 1 || Math.round(physicalWidth) % 2 === 1 ? 0.5 : 0
}

export function snapPointToPixels(ctx: CanvasRenderingContext2D, x: number, y: number): { x: number; y: number } {
  const axes = pixelAxes(ctx)
  return axes ? { x: snap(x, axes.x), y: snap(y, axes.y) } : { x, y }
}

export function snapRectToPixels(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const axes = pixelAxes(ctx)
  if (!axes) return { x, y, w: Math.max(0, w), h: Math.max(0, h) }
  const left = snap(x, axes.x)
  const top = snap(y, axes.y)
  return { x: left, y: top, w: Math.max(0, snap(x + w, axes.x) - left), h: Math.max(0, snap(y + h, axes.y) - top) }
}

export function snapStrokeRectToPixels(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, width: number) {
  const axes = pixelAxes(ctx)
  if (!axes) return { x, y, w: Math.max(0, w), h: Math.max(0, h) }
  // The rectangle describes the outer bounds. Inset by half the actual stroke,
  // not just its odd/even pixel phase, so viewport clips cannot cut an edge in half.
  const insetX = width / 2
  const insetY = width / 2
  const left = snap(x, axes.x) + insetX
  const top = snap(y, axes.y) + insetY
  return {
    x: left, y: top,
    w: Math.max(0, snap(x + w, axes.x) - insetX - left),
    h: Math.max(0, snap(y + h, axes.y) - insetY - top),
  }
}

export function createLinePixelSnapper(ctx: CanvasRenderingContext2D, width: number) {
  const axes = pixelAxes(ctx)
  return (x1: number, y1: number, x2: number, y2: number) => {
    if (!axes || (x1 !== x2 && y1 !== y2)) return { x1, y1, x2, y2 }
    if (x1 === x2) {
      const x = snap(x1, axes.x, strokePhase(width, axes.x))
      return { x1: x, y1: snap(y1, axes.y), x2: x, y2: snap(y2, axes.y) }
    }
    const y = snap(y1, axes.y, strokePhase(width, axes.y))
    return { x1: snap(x1, axes.x), y1: y, x2: snap(x2, axes.x), y2: y }
  }
}

export function snapLineToPixels(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width: number) {
  if (x1 !== x2 && y1 !== y2) return { x1, y1, x2, y2 }
  return createLinePixelSnapper(ctx, width)(x1, y1, x2, y2)
}
