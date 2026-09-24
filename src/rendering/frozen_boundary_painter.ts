import type { Color } from '../theme/theme'
import type { DrawList } from './draw_list'

export type FrozenBoundaryShadowSide = 'bottom' | 'left' | 'right'

export interface FrozenBoundaryPaintOptions {
  side: FrozenBoundaryShadowSide
  x: number
  y: number
  length: number
  active: boolean
  lineColor: Color
  shadowColor: Color
}

export function paintFrozenBoundary(
  dl: DrawList,
  options: FrozenBoundaryPaintOptions,
): void {
  if (options.length <= 0) return

  const { side, x, y, length, lineColor, shadowColor } = options
  if (side === 'bottom') dl.line(x, y, x + length, y, lineColor, 2)
  else dl.line(x, y, x, y + length, lineColor, 2)

  const alphas = options.active
    ? [0.14, 0.085, 0.045, 0.02]
    : [0.075, 0.04, 0.018]
  for (let index = 0; index < alphas.length; index++) {
    const color = { ...shadowColor, a: alphas[index]! }
    if (side === 'bottom') {
      dl.fillRect(x, y + index + 1, length, 1, color, 0)
    } else if (side === 'right') {
      dl.fillRect(x + index + 1, y, 1, length, color, 0)
    } else {
      dl.fillRect(x - index - 1, y, 1, length, color, 0)
    }
  }
}
