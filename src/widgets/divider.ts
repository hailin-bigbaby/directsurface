import { RenderBox } from '../layout/render_box'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { DrawList } from '../rendering/draw_list'
import { deriveDividerStyle } from '../theme/component_styles'
import { RenderObject, constrainSize } from '../core/render_object'

export type DividerAxis = 'horizontal' | 'vertical'

export class RenderDivider extends RenderBox {
  static override debugTypeName = 'RenderDivider'
  axis: DividerAxis
  extent?: number
  thickness?: number
  inset?: number

  constructor(options?: {
    axis?: DividerAxis
    extent?: number
    thickness?: number
    inset?: number
  }) {
    super()
    this.axis = options?.axis ?? 'horizontal'
    this.extent = options?.extent
    this.thickness = options?.thickness
    this.inset = options?.inset
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveDividerStyle(context.theme)
    const thickness = this.thickness ?? style.thickness
    if (this.axis === 'horizontal') {
      this.size = constrainSize(constraints, {
        width: this.extent ?? constraints.maxWidth,
        height: Math.max(thickness, style.inset * 2 + thickness),
      })
      return
    }

    this.size = constrainSize(constraints, {
      width: Math.max(thickness, style.inset * 2 + thickness),
      height: this.extent ?? constraints.maxHeight,
    })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveDividerStyle(context.theme)
    const dl = new DrawList(context)
    const thickness = this.thickness ?? style.thickness
    const inset = this.inset ?? style.inset

    if (this.axis === 'horizontal') {
      const lineY = offset.y + this.size.height / 2
      dl.line(
        offset.x + inset,
        lineY,
        offset.x + this.size.width - inset,
        lineY,
        style.color,
        thickness,
      )
      return
    }

    const lineX = offset.x + this.size.width / 2
    dl.line(
      lineX,
      offset.y + inset,
      lineX,
      offset.y + this.size.height - inset,
      style.color,
      thickness,
    )
  }
}
