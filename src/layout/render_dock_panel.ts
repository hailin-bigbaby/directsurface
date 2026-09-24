import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset, type Size } from '../core/render_object'
import { RenderBox, RenderPanel, resolveChildLayout, type RenderPanelOptions } from './render_box'
import type { PaintContext } from '../rendering/paint_context'

export type DockSide = 'left' | 'top' | 'right' | 'bottom' | 'fill'

export interface DockChildData {
  dock: DockSide
}

interface DockPlacement {
  child: RenderBox
  dock: DockSide
  x: number
  y: number
  width: number
  height: number
}

export interface DockPanelOptions extends RenderPanelOptions {
  fillChild?: RenderBox
}

export class RenderDockPanel extends RenderPanel {
  static override debugTypeName = 'RenderDockPanel'
  children: RenderBox[] = []
  childData = new Map<RenderBox, DockChildData>()
  private _fillChild?: RenderBox

  constructor(options: DockPanelOptions = {}) {
    super(options)
    if (options.fillChild) this.setFill(options.fillChild)
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  addChild(child: RenderBox, data: DockChildData): void {
    if (data.dock === 'fill') {
      this.setFill(child)
      return
    }
    child.parent = this
    this.children.push(child)
    this.childData.set(child, data)
    this.markNeedsLayout()
  }

  setFill(child?: RenderBox): void {
    if (this._fillChild === child) return
    if (this._fillChild) {
      this._fillChild.parent = undefined
      if (this._fillChild.owner) this._fillChild.detach()
    }
    this._fillChild = child
    if (child) {
      child.parent = this
      this.childData.set(child, { dock: 'fill' })
      if (this.owner && child.owner !== this.owner) child.attach(this.owner)
    }
    this.markNeedsLayout()
  }

  clearChildren(): void {
    for (const child of this.children) {
      child.parent = undefined
      if (child.owner) child.detach()
    }
    if (this._fillChild) {
      this._fillChild.parent = undefined
      if (this._fillChild.owner) this._fillChild.detach()
    }
    this.children = []
    this.childData.clear()
    this._fillChild = undefined
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      for (const child of this.children) visitor(child)
      if (this._fillChild) visitor(this._fillChild)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    for (const child of this.children) visitor(child)
    if (this._fillChild) visitor(this._fillChild)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const contentConstraints = this.deflatePaddingConstraints(constraints)
    const naturalSize = this._measureNaturalSize(contentConstraints, context)
    const width = contentConstraints.maxWidth === Infinity
      ? Math.max(contentConstraints.minWidth, naturalSize.width)
      : contentConstraints.maxWidth
    const height = contentConstraints.maxHeight === Infinity
      ? Math.max(contentConstraints.minHeight, naturalSize.height)
      : contentConstraints.maxHeight
    this.size = this.inflatePaddingSize(constraints, { width, height })

    let left = this.contentOffset.x
    let top = this.contentOffset.y
    let right = left + this.contentSize.width
    let bottom = top + this.contentSize.height
    const placements: DockPlacement[] = []

    for (const child of this.children.filter(child => child.participatesInLayout)) {
      const data = this.childData.get(child) ?? { dock: 'left' as DockSide }
      const available = this._availableSize(left, top, right, bottom)
      const childLayout = resolveChildLayout(
        child,
        this._constraintsFor(data, available),
        data.dock === 'top' || data.dock === 'bottom' ? 'stretch' : 'start',
        data.dock === 'left' || data.dock === 'right' ? 'stretch' : 'start',
      )
      child.layout(childLayout.constraints, true, context)
      let x = left
      let y = top
      let w = child.outerSize.width
      let h = child.outerSize.height

      switch (data.dock) {
        case 'left':
          h = available.height
          right = Math.max(left, right)
          left = Math.min(right, left + w)
          break
        case 'right':
          h = available.height
          x = Math.max(left, right - w)
          right = x
          break
        case 'top':
          w = available.width
          top = Math.min(bottom, top + h)
          break
        case 'bottom':
          w = available.width
          y = Math.max(top, bottom - h)
          bottom = y
          break
        default:
          break
      }
      placements.push({ child, dock: data.dock, x, y, width: w, height: h })
    }

    if (this._fillChild?.participatesInLayout) {
      const w = Math.max(0, right - left)
      const h = Math.max(0, bottom - top)
      const fillLayout = resolveChildLayout(
        this._fillChild,
        { minWidth: w, maxWidth: w, minHeight: h, maxHeight: h },
        'stretch',
        'stretch',
      )
      this._fillChild.layout(fillLayout.constraints, true, context)
      placements.push({ child: this._fillChild, dock: 'fill', x: left, y: top, width: w, height: h })
    }

    for (const placement of placements) {
      const horizontalAlignment = placement.dock === 'top' || placement.dock === 'bottom' || placement.dock === 'fill'
        ? placement.child.resolveHorizontalAlignment('stretch')
        : placement.child.resolveHorizontalAlignment('start')
      const verticalAlignment = placement.dock === 'left' || placement.dock === 'right' || placement.dock === 'fill'
        ? placement.child.resolveVerticalAlignment('stretch')
        : placement.child.resolveVerticalAlignment('start')
      placement.child.positionInSlot(placement, horizontalAlignment, verticalAlignment)
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    this.paintContentChildren(context, offset)
    this.paintAdornerChildren(context, offset)
  }

  private _availableSize(left: number, top: number, right: number, bottom: number): Size {
    return {
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    }
  }

  private _measureNaturalSize(constraints: BoxConstraints, context: LayoutContext): Size {
    if (constraints.maxWidth !== Infinity && constraints.maxHeight !== Infinity) {
      return { width: constraints.maxWidth, height: constraints.maxHeight }
    }
    if (constraints.maxWidth !== Infinity && constraints.maxHeight === Infinity) {
      return this._measureNaturalHeightForWidth(constraints.maxWidth, context)
    }

    let topHeight = 0
    let bottomHeight = 0
    let topWidth = 0
    let bottomWidth = 0
    let leftWidth = 0
    let rightWidth = 0
    let sideHeight = 0
    const finiteWidth = constraints.maxWidth !== Infinity
    const finiteHeight = constraints.maxHeight !== Infinity
    const looseMaxWidth = finiteWidth ? constraints.maxWidth : Infinity
    const looseMaxHeight = finiteHeight ? constraints.maxHeight : Infinity

    for (const child of this.children.filter(child => child.participatesInLayout)) {
      const data = this.childData.get(child) ?? { dock: 'left' as DockSide }
      if (data.dock === 'top' || data.dock === 'bottom') {
        const size = child.measureOuter({
          minWidth: 0,
          maxWidth: looseMaxWidth,
          minHeight: 0,
          maxHeight: looseMaxHeight,
        }, context)
        if (data.dock === 'top') {
          topHeight += size.height
          topWidth = Math.max(topWidth, size.width)
        } else {
          bottomHeight += size.height
          bottomWidth = Math.max(bottomWidth, size.width)
        }
      } else if (data.dock === 'left' || data.dock === 'right') {
        const size = child.measureOuter({
          minWidth: 0,
          maxWidth: looseMaxWidth,
          minHeight: 0,
          maxHeight: looseMaxHeight,
        }, context)
        if (data.dock === 'left') leftWidth += size.width
        else rightWidth += size.width
        sideHeight = Math.max(sideHeight, size.height)
      }
    }

    let fillWidth = 0
    let fillHeight = 0
    if (this._fillChild?.participatesInLayout) {
      const size = this._fillChild.measureOuter({
        minWidth: 0,
        maxWidth: looseMaxWidth,
        minHeight: 0,
        maxHeight: looseMaxHeight,
      }, context)
      fillWidth = size.width
      fillHeight = size.height
    }

    return {
      width: Math.max(topWidth, bottomWidth, leftWidth + fillWidth + rightWidth),
      height: topHeight + Math.max(sideHeight, fillHeight) + bottomHeight,
    }
  }

  private _measureNaturalHeightForWidth(width: number, context: LayoutContext): Size {
    let left = 0
    let right = width
    let topHeight = 0
    let bottomHeight = 0
    let bodyHeight = 0

    for (const child of this.children.filter(child => child.participatesInLayout)) {
      const data = this.childData.get(child) ?? { dock: 'left' as DockSide }
      const availableWidth = Math.max(0, right - left)
      if (data.dock === 'top' || data.dock === 'bottom') {
        const size = child.measureOuter({
          minWidth: availableWidth,
          maxWidth: availableWidth,
          minHeight: 0,
          maxHeight: Infinity,
        }, context)
        if (data.dock === 'top') topHeight += size.height
        else bottomHeight += size.height
        continue
      }

      if (data.dock === 'left' || data.dock === 'right') {
        const size = child.measureOuter({
          minWidth: 0,
          maxWidth: availableWidth,
          minHeight: 0,
          maxHeight: Infinity,
        }, context)
        const dockWidth = Math.min(availableWidth, size.width)
        if (data.dock === 'left') left = Math.min(right, left + dockWidth)
        else right = Math.max(left, right - dockWidth)
        bodyHeight = Math.max(bodyHeight, size.height)
      }
    }

    if (this._fillChild?.participatesInLayout) {
      const fillWidth = Math.max(0, right - left)
      const size = this._fillChild.measureOuter({
        minWidth: fillWidth,
        maxWidth: fillWidth,
        minHeight: 0,
        maxHeight: Infinity,
      }, context)
      bodyHeight = Math.max(bodyHeight, size.height)
    }

    return {
      width,
      height: topHeight + bodyHeight + bottomHeight,
    }
  }

  private _constraintsFor(data: DockChildData, available: Size): BoxConstraints {
    if (data.dock === 'left' || data.dock === 'right') {
      return {
        minWidth: 0,
        maxWidth: available.width,
        minHeight: available.height,
        maxHeight: available.height,
      }
    }
    if (data.dock === 'top' || data.dock === 'bottom') {
      return {
        minWidth: available.width,
        maxWidth: available.width,
        minHeight: 0,
        maxHeight: available.height,
      }
    }
    return {
      minWidth: available.width,
      maxWidth: available.width,
      minHeight: available.height,
      maxHeight: available.height,
    }
  }
}
