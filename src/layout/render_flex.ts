// RenderStackPanel: Row / Column 布局
// 主轴分配空间（flex），交叉轴对齐

import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { RenderBox, RenderPanel, type RenderPanelOptions } from './render_box'
import type { PaintContext } from '../rendering/paint_context'
import { deriveLayoutStyle } from '../theme/component_styles'

export type Orientation = 'horizontal' | 'vertical'
export type MainAxisAlignment = 'start' | 'end' | 'center' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly'
export type CrossAxisAlignment = 'start' | 'end' | 'center' | 'stretch'

export interface StackPanelChildData {
  flex: number  // 0 = fixed size, >0 = flex factor
}

function hasFiniteExtent(value: number): boolean {
  return value !== Infinity
}

export interface StackPanelOptions extends RenderPanelOptions {
  orientation?: Orientation
  mainAxisAlignment?: MainAxisAlignment
  crossAxisAlignment?: CrossAxisAlignment
  spacing?: number
}

export class RenderStackPanel extends RenderPanel {
  static override debugTypeName = 'RenderStackPanel'
  children: RenderBox[] = []
  childFlexData = new Map<RenderBox, StackPanelChildData>()
  private _orientation: Orientation
  private _mainAxisAlignment: MainAxisAlignment
  private _crossAxisAlignment: CrossAxisAlignment
  private _spacing?: number

  get spacing(): number { return this._spacing ?? 0 }
  set spacing(value: number) {
    if (this._spacing === value) return
    this._spacing = value
    this.markNeedsLayout()
  }

  constructor(opts: StackPanelOptions = {}) {
    super(opts)
    this._orientation = opts.orientation ?? 'vertical'
    this._mainAxisAlignment = opts.mainAxisAlignment ?? 'start'
    this._crossAxisAlignment = opts.crossAxisAlignment ?? 'start'
    this._spacing = opts.spacing
  }

  get orientation(): Orientation { return this._orientation }
  set orientation(value: Orientation) {
    if (this._orientation === value) return
    this._orientation = value
    this.markNeedsLayout()
  }

  get mainAxisAlignment(): MainAxisAlignment { return this._mainAxisAlignment }
  set mainAxisAlignment(value: MainAxisAlignment) {
    if (this._mainAxisAlignment === value) return
    this._mainAxisAlignment = value
    this.markNeedsLayout()
  }

  get crossAxisAlignment(): CrossAxisAlignment { return this._crossAxisAlignment }
  set crossAxisAlignment(value: CrossAxisAlignment) {
    if (this._crossAxisAlignment === value) return
    this._crossAxisAlignment = value
    this.markNeedsLayout()
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  addChild(child: RenderBox, flex = 0): void {
    child.parent = this
    this.children.push(child)
    this.childFlexData.set(child, { flex })
    this.markNeedsLayout()
  }

  clearChildren(): void {
    for (const child of this.children) {
      child.parent = undefined
      if (child.owner) child.detach()
    }
    this.children = []
    this.childFlexData.clear()
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      for (const c of this.children) visitor(c)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    for (const c of this.children) visitor(c)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const contentConstraints = this.deflatePaddingConstraints(constraints)
    const spacing = this._spacing ?? deriveLayoutStyle(context.theme).itemSpacing
    const visibleChildren = this.children.filter(child => child.participatesInLayout)
    const isHorizontal = this._orientation === 'horizontal'
    const maxMain = isHorizontal ? contentConstraints.maxWidth : contentConstraints.maxHeight
    const maxCross = isHorizontal ? contentConstraints.maxHeight : contentConstraints.maxWidth

    const canAllocateFlex = hasFiniteExtent(maxMain)

    // 第一遍：布局固定子节点；主轴无界时 flex 子节点也按自然尺寸参与布局。
    let totalFixed = 0
    let totalFlex = 0
    const spacingTotal = Math.max(0, visibleChildren.length - 1) * spacing

    for (const child of visibleChildren) {
      const fd = this.childFlexData.get(child) ?? { flex: 0 }
      if (fd.flex === 0 || !canAllocateFlex) {
        const childConstraints = this._childConstraintsFor(child, 0, maxCross, isHorizontal, false)
        child.layout(childConstraints, true, context)
        totalFixed += isHorizontal ? child.outerSize.width : child.outerSize.height
      } else if (fd.flex > 0) {
        totalFlex += fd.flex
      }
    }

    // 第二遍：分配剩余空间给 flex 子节点
    if (canAllocateFlex && totalFlex > 0) {
      const remaining = Math.max(0, maxMain - totalFixed - spacingTotal)
      for (const child of visibleChildren) {
        const fd = this.childFlexData.get(child) ?? { flex: 0 }
        if (fd.flex > 0) {
          const allocated = (remaining * fd.flex) / totalFlex
          const childConstraints = this._childConstraintsFor(child, allocated, maxCross, isHorizontal, true)
          child.layout(childConstraints, true, context)
        }
      }
    }

    // 计算主轴总长度和交叉轴最大值
    let totalMain = spacingTotal
    let maxCrossActual = 0
    for (const child of visibleChildren) {
      totalMain += isHorizontal ? child.outerSize.width : child.outerSize.height
      maxCrossActual = Math.max(maxCrossActual, isHorizontal ? child.outerSize.height : child.outerSize.width)
    }

    const naturalSize = isHorizontal
      ? { width: totalMain, height: maxCrossActual }
      : { width: maxCrossActual, height: totalMain }
    this.size = this.inflatePaddingSize(constraints, naturalSize)
    const contentSize = this.contentSize
    const contentOffset = this.contentOffset
    const mainExtent = isHorizontal ? contentSize.width : contentSize.height
    const crossExtent = isHorizontal ? contentSize.height : contentSize.width

    // 主轴对齐：计算起始偏移和间距
    const positions = this._computeMainPositions(visibleChildren, totalMain, mainExtent, spacing)

    // 设置子节点偏移
    for (let i = 0; i < visibleChildren.length; i++) {
      const child = visibleChildren[i]!
      const mainPos = positions[i]!
      if (isHorizontal) {
        child.positionInSlot(
          { x: contentOffset.x + mainPos, y: contentOffset.y, width: child.outerSize.width, height: crossExtent },
          'start',
          child.resolveVerticalAlignment(this._crossAxisAlignment),
        )
      } else {
        child.positionInSlot(
          { x: contentOffset.x, y: contentOffset.y + mainPos, width: crossExtent, height: child.outerSize.height },
          child.resolveHorizontalAlignment(this._crossAxisAlignment),
          'start',
        )
      }
    }
  }

  private _childConstraintsFor(
    child: RenderBox,
    allocatedMain: number,
    maxCross: number,
    isHorizontal: boolean,
    tightMain: boolean,
  ): BoxConstraints {
    const crossAlignment = isHorizontal
      ? child.resolveVerticalAlignment(this._crossAxisAlignment)
      : child.resolveHorizontalAlignment(this._crossAxisAlignment)
    const hasExplicitCrossExtent = isHorizontal ? child.height !== undefined : child.width !== undefined
    const minCross = crossAlignment === 'stretch' && !hasExplicitCrossExtent && hasFiniteExtent(maxCross) ? maxCross : 0
    if (isHorizontal) {
      return {
        minWidth: tightMain ? allocatedMain : 0,
        maxWidth: tightMain ? allocatedMain : Infinity,
        minHeight: minCross,
        maxHeight: maxCross,
      }
    }
    return {
      minWidth: minCross,
      maxWidth: maxCross,
      minHeight: tightMain ? allocatedMain : 0,
      maxHeight: tightMain ? allocatedMain : Infinity,
    }
  }

  private _computeMainPositions(children: readonly RenderBox[], totalMain: number, maxMain: number, spacing: number): number[] {
    const n = children.length
    if (n === 0) return []
    const sizes = children.map(c =>
      this._orientation === 'horizontal' ? c.outerSize.width : c.outerSize.height
    )
    const positions: number[] = new Array(n).fill(0)
    const extra = Math.max(0, maxMain - totalMain)

    switch (this._mainAxisAlignment) {
      case 'start': {
        let pos = 0
        for (let i = 0; i < n; i++) {
          positions[i] = pos
          pos += sizes[i]! + spacing
        }
        break
      }
      case 'end': {
        let pos = extra
        for (let i = 0; i < n; i++) {
          positions[i] = pos
          pos += sizes[i]! + spacing
        }
        break
      }
      case 'center': {
        let pos = extra / 2
        for (let i = 0; i < n; i++) {
          positions[i] = pos
          pos += sizes[i]! + spacing
        }
        break
      }
      case 'spaceBetween': {
        const gap = spacing + (n > 1 ? extra / (n - 1) : 0)
        let pos = 0
        for (let i = 0; i < n; i++) {
          positions[i] = pos
          pos += sizes[i]! + gap
        }
        break
      }
      case 'spaceAround': {
        const distributedGap = extra / n
        const gap = spacing + distributedGap
        let pos = distributedGap / 2
        for (let i = 0; i < n; i++) {
          positions[i] = pos
          pos += sizes[i]! + gap
        }
        break
      }
      case 'spaceEvenly': {
        const distributedGap = extra / (n + 1)
        const gap = spacing + distributedGap
        let pos = distributedGap
        for (let i = 0; i < n; i++) {
          positions[i] = pos
          pos += sizes[i]! + gap
        }
        break
      }
    }
    return positions
  }

  performPaint(context: PaintContext, offset: Offset): void {
    this.paintContentChildren(context, offset)
    this.paintAdornerChildren(context, offset)
  }
}

export class RenderSpacer extends RenderBox {
  static override debugTypeName = 'RenderSpacer'
  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    this.size = constrainSize(constraints, { width: 0, height: 0 })
  }
}
