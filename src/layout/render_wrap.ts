// RenderWrapPanel: 流式换行布局
// 子元素超出主轴宽度时自动换行，类似 CSS flex-wrap

import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { RenderBox, RenderPanel, resolveChildLayout, type RenderPanelOptions } from './render_box'
import type { PaintContext } from '../rendering/paint_context'
import { deriveLayoutStyle } from '../theme/component_styles'

export type WrapAlignment = 'start' | 'end' | 'center' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly'
export type WrapCrossAlignment = 'start' | 'end' | 'center'

export interface WrapPanelOptions extends RenderPanelOptions {
  spacing?: number
  runSpacing?: number
  alignment?: WrapAlignment
  runAlignment?: WrapAlignment
  crossAxisAlignment?: WrapCrossAlignment
}

export class RenderWrapPanel extends RenderPanel {
  static override debugTypeName = 'RenderWrapPanel'
  children: RenderBox[] = []
  private _spacing?: number
  private _runSpacing?: number
  private _alignment: WrapAlignment
  private _runAlignment: WrapAlignment
  private _crossAxisAlignment: WrapCrossAlignment

  get spacing(): number { return this._spacing ?? 0 }
  set spacing(value: number) {
    if (this._spacing === value) return
    this._spacing = value
    this.markNeedsLayout()
  }

  get runSpacing(): number { return this._runSpacing ?? 0 }
  set runSpacing(value: number) {
    if (this._runSpacing === value) return
    this._runSpacing = value
    this.markNeedsLayout()
  }

  get alignment(): WrapAlignment { return this._alignment }
  set alignment(value: WrapAlignment) {
    if (this._alignment === value) return
    this._alignment = value
    this.markNeedsLayout()
  }

  get runAlignment(): WrapAlignment { return this._runAlignment }
  set runAlignment(value: WrapAlignment) {
    if (this._runAlignment === value) return
    this._runAlignment = value
    this.markNeedsLayout()
  }

  get crossAxisAlignment(): WrapCrossAlignment { return this._crossAxisAlignment }
  set crossAxisAlignment(value: WrapCrossAlignment) {
    if (this._crossAxisAlignment === value) return
    this._crossAxisAlignment = value
    this.markNeedsLayout()
  }

  constructor(opts: WrapPanelOptions = {}) {
    super(opts)
    this._spacing = opts.spacing
    this._runSpacing = opts.runSpacing
    this._alignment = opts.alignment ?? 'start'
    this._runAlignment = opts.runAlignment ?? 'start'
    this._crossAxisAlignment = opts.crossAxisAlignment ?? 'start'
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  addChild(child: RenderBox): void {
    child.parent = this
    this.children.push(child)
    this.markNeedsLayout()
  }

  clearChildren(): void {
    for (const child of this.children) {
      child.parent = undefined
      if (child.owner) child.detach()
    }
    this.children = []
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
    const layoutStyle = deriveLayoutStyle(context.theme)
    const spacing = this._spacing ?? layoutStyle.itemSpacing
    const runSpacing = this._runSpacing ?? layoutStyle.itemSpacing
    const maxW = contentConstraints.maxWidth === Infinity ? 0 : contentConstraints.maxWidth
    const visibleChildren = this.children.filter(child => child.participatesInLayout)

    // 先以 loose 约束布局所有子节点，得到自然尺寸
    for (const child of visibleChildren) {
      child.layout({ minWidth: 0, maxWidth: maxW || Infinity, minHeight: 0, maxHeight: Infinity }, true, context)
    }

    // 分行
    interface Run {
      children: RenderBox[]
      mainSize: number   // 行内所有子元素宽度之和（不含间距）
      crossSize: number  // 行高
    }

    const runs: Run[] = []
    let currentRun: Run = { children: [], mainSize: 0, crossSize: 0 }

    for (const child of visibleChildren) {
      const cw = child.outerSize.width
      const ch = child.outerSize.height
      const spacingBefore = currentRun.children.length > 0 ? spacing : 0

      if (currentRun.children.length > 0 && maxW > 0 &&
          currentRun.mainSize + spacingBefore + cw > maxW) {
        // 换行
        runs.push(currentRun)
        currentRun = { children: [child], mainSize: cw, crossSize: ch }
      } else {
        currentRun.children.push(child)
        currentRun.mainSize += spacingBefore + cw
        currentRun.crossSize = Math.max(currentRun.crossSize, ch)
      }
    }
    if (currentRun.children.length > 0) runs.push(currentRun)

    // 计算总高度
    const totalRunH = runs.reduce((s, r) => s + r.crossSize, 0)
    const totalSpacingH = Math.max(0, runs.length - 1) * runSpacing
    const totalH = totalRunH + totalSpacingH

    const naturalWidth = maxW || runs.reduce((max, run) => Math.max(max, run.mainSize), 0)
    this.size = this.inflatePaddingSize(constraints, {
      width: naturalWidth,
      height: totalH,
    })
    const contentSize = this.contentSize
    const contentOffset = this.contentOffset

    // 计算行的 Y 起始位置（runAlignment）
    const runYs = this._computePositions(runs.map(r => r.crossSize), runSpacing, contentSize.height, this._runAlignment)

    // 设置每个子节点的 offset
    for (let ri = 0; ri < runs.length; ri++) {
      const run = runs[ri]!
      const runY = runYs[ri]!
      const childXs = this._computePositions(
        run.children.map(c => c.outerSize.width),
        spacing,
        contentSize.width,
        this._alignment,
      )
      for (let ci = 0; ci < run.children.length; ci++) {
        const child = run.children[ci]!
        const childLayout = resolveChildLayout(
          child,
          {
            minWidth: child.outerSize.width,
            maxWidth: child.outerSize.width,
            minHeight: run.crossSize,
            maxHeight: run.crossSize,
          },
          'start',
          this._crossAxisAlignment,
        )
        child.layout(childLayout.constraints, true, context)
        child.positionInSlot({
          x: contentOffset.x + childXs[ci]!,
          y: contentOffset.y + runY,
          width: child.outerSize.width,
          height: run.crossSize,
        }, childLayout.horizontalAlignment, childLayout.verticalAlignment)
      }
    }
  }

  private _computePositions(
    sizes: number[], spacing: number, containerSize: number, alignment: WrapAlignment
  ): number[] {
    const n = sizes.length
    if (n === 0) return []
    const totalSize = sizes.reduce((s, v) => s + v, 0) + spacing * (n - 1)
    const extra = Math.max(0, containerSize - totalSize)
    const positions: number[] = new Array(n).fill(0)

    switch (alignment) {
      case 'start': {
        let pos = 0
        for (let i = 0; i < n; i++) { positions[i] = pos; pos += sizes[i]! + spacing }
        break
      }
      case 'end': {
        let pos = extra
        for (let i = 0; i < n; i++) { positions[i] = pos; pos += sizes[i]! + spacing }
        break
      }
      case 'center': {
        let pos = extra / 2
        for (let i = 0; i < n; i++) { positions[i] = pos; pos += sizes[i]! + spacing }
        break
      }
      case 'spaceBetween': {
        const gap = spacing + (n > 1 ? extra / (n - 1) : 0)
        let pos = 0
        for (let i = 0; i < n; i++) { positions[i] = pos; pos += sizes[i]! + gap }
        break
      }
      case 'spaceAround': {
        const distributedGap = extra / n
        const gap = spacing + distributedGap
        let pos = distributedGap / 2
        for (let i = 0; i < n; i++) { positions[i] = pos; pos += sizes[i]! + gap }
        break
      }
      case 'spaceEvenly': {
        const distributedGap = extra / (n + 1)
        const gap = spacing + distributedGap
        let pos = distributedGap
        for (let i = 0; i < n; i++) { positions[i] = pos; pos += sizes[i]! + gap }
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
