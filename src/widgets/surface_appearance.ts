import type { DrawList } from '../rendering/draw_list'
import type { Color } from '../theme/theme'

export type SurfaceAppearance = 'framed' | 'flush'

export interface SurfaceFrameStyle {
  background: Color
  border: Color
  borderRadius: number
  borderWidth?: number
}

export interface SurfaceFrameRect {
  x: number
  y: number
  width: number
  height: number
}

export function paintSurfaceBackground(
  dl: DrawList,
  rect: SurfaceFrameRect,
  appearance: SurfaceAppearance,
  style: SurfaceFrameStyle,
): void {
  dl.fillRect(
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    style.background,
    appearance === 'framed' ? style.borderRadius : 0,
  )
}

export function pushSurfaceContentClip(
  dl: DrawList,
  rect: SurfaceFrameRect,
  appearance: SurfaceAppearance,
  borderRadius: number,
): void {
  if (appearance === 'framed' && borderRadius > 0) {
    dl.pushRoundedClip(rect.x, rect.y, rect.width, rect.height, borderRadius)
    return
  }
  dl.pushClip(rect.x, rect.y, rect.width, rect.height)
}

export function paintSurfaceBorder(
  dl: DrawList,
  rect: SurfaceFrameRect,
  appearance: SurfaceAppearance,
  style: SurfaceFrameStyle,
): void {
  if (appearance !== 'framed') return
  const borderWidth = Math.max(0, style.borderWidth ?? 1)
  if (borderWidth <= 0) return
  dl.strokeRect(
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    style.border,
    borderWidth,
    style.borderRadius,
  )
}
