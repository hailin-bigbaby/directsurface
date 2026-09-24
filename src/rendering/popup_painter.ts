import { DrawList } from './draw_list'
import type { PopupStyleTokens } from '../theme/component_styles'

export function drawPopupPanel(
  dl: DrawList,
  x: number,
  y: number,
  w: number,
  h: number,
  style: PopupStyleTokens,
): void {
  dl.fillRect(x, y, w, h, style.bgColor, style.borderRadius)
  dl.strokeRect(x, y, w, h, style.borderColor, 1, style.borderRadius)
  dl.shadowBehind(
    x,
    y,
    w,
    h,
    style.shadowBlur,
    style.shadowColor,
    style.borderRadius,
    style.shadowOffsetX,
    style.shadowOffsetY,
  )
}
