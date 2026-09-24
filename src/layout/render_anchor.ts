// RenderAnchor: 锚点定位布局
// 子元素通过 top/right/bottom/left/centerX/centerY 相对父容器绝对定位
// 类似 CSS position:absolute，适合覆盖层、浮动按钮等场景

import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { RenderBox, RenderPanel, type RenderPanelOptions } from './render_box'
import type { PaintContext } from '../rendering/paint_context'

export interface AnchorChildData {
  top?: number
  right?: number
  bottom?: number
  left?: number
  centerX?: boolean   // 水平居中（忽略 left/right）
  centerY?: boolean   // 垂直居中（忽略 top/bottom）
}

export interface AnchorOptions extends RenderPanelOptions {}

export class RenderAnchor extends RenderPanel {
  static override debugTypeName = 'RenderAnchor'
  children: RenderBox[] = []
  childData = new Map<RenderBox, AnchorChildData>()

  constructor(options: AnchorOptions = {}) {
    super(options)
  }

  addChild(child: RenderBox, anchor: AnchorChildData = {}): void {
    child.parent = this
    this.children.push(child)
    this.childData.set(child, anchor)
    this.markNeedsLayout()
  }

  clearChildren(): void {
    for (const child of this.children) {
      child.parent = undefined
      if (child.owner) child.detach()
    }
    this.children = []
    this.childData.clear()
    this.markNeedsLayout()
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      for (const c of this.children) visitor(c)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    for (const c of this.children) visitor(c)
  }

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    const contentConstraints = this.deflatePaddingConstraints(constraints)
    const w = contentConstraints.maxWidth === Infinity ? (contentConstraints.minWidth || 0) : contentConstraints.maxWidth
    const h = contentConstraints.maxHeight === Infinity ? (contentConstraints.minHeight || 0) : contentConstraints.maxHeight

    for (const child of this.children.filter(child => child.participatesInLayout)) {
      const a = this.childData.get(child) ?? {}

      // 确定子元素约束
      let childMaxW = Infinity
      let childMaxH = Infinity

      if (a.left !== undefined && a.right !== undefined) {
        childMaxW = Math.max(0, w - a.left - a.right)
      }

      if (a.top !== undefined && a.bottom !== undefined) {
        childMaxH = Math.max(0, h - a.top - a.bottom)
      }

      child.layout({
        minWidth: childMaxW === Infinity ? 0 : childMaxW,
        maxWidth: childMaxW === Infinity ? w || Infinity : childMaxW,
        minHeight: childMaxH === Infinity ? 0 : childMaxH,
        maxHeight: childMaxH === Infinity ? h || Infinity : childMaxH,
      }, true, _context)

      const cw = child.outerSize.width
      const ch = child.outerSize.height

      // 计算 X
      let x = 0
      if (a.centerX) {
        x = (w - cw) / 2
      } else if (a.left !== undefined) {
        x = a.left
      } else if (a.right !== undefined) {
        x = w - cw - a.right
      }

      // 计算 Y
      let y = 0
      if (a.centerY) {
        y = (h - ch) / 2
      } else if (a.top !== undefined) {
        y = a.top
      } else if (a.bottom !== undefined) {
        y = h - ch - a.bottom
      }

      child.positionInSlot({
        x: this.contentOffset.x + x,
        y: this.contentOffset.y + y,
        width: cw,
        height: ch,
      }, 'start', 'start')
    }

    this.size = this.inflatePaddingSize(constraints, { width: w, height: h })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    super.performPaint(context, offset)
  }
}

export class RenderCanvas extends RenderAnchor {
  static override debugTypeName = 'RenderCanvas'
}
