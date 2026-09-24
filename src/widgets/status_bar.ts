import type { BoxConstraints, LayoutContext, Offset, Rect, RenderObject } from '../core/render_object'
import { constrainSize } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import {
  deriveStatusBarStyle,
  type BadgeStatus,
  type BadgeAppearance,
  type StatusBarStyleTokens,
  type StatusBarTextTone,
} from '../theme/component_styles'
import { measureBadgeLayout, paintBadge } from './badge'

export type StatusBarAlign = 'left' | 'right'

interface StatusBarItemBase {
  id: string
  visible?: boolean
}

export interface StatusBarTextItem extends StatusBarItemBase {
  kind: 'text'
  text: string
  tone?: StatusBarTextTone
}

export interface StatusBarBadgeItem extends StatusBarItemBase {
  kind: 'badge'
  value?: string | number
  status?: BadgeStatus
  appearance?: BadgeAppearance
  dot?: boolean
  max?: number
}

export interface StatusBarSeparatorItem extends StatusBarItemBase {
  kind: 'separator'
}

export interface StatusBarCustomItem extends StatusBarItemBase {
  kind: 'custom'
  child: RenderBox
}

export type StatusBarItem =
  | StatusBarTextItem
  | StatusBarBadgeItem
  | StatusBarSeparatorItem
  | StatusBarCustomItem

export interface StatusBarGroup {
  id: string
  align: StatusBarAlign
  visible?: boolean
  items: StatusBarItem[]
}

interface MeasuredStatusBarItem {
  item: StatusBarItem
  width: number
  height: number
}

interface MeasuredStatusBarGroup {
  group: StatusBarGroup
  items: MeasuredStatusBarItem[]
  width: number
  height: number
}

interface StatusBarItemLayout {
  id: string
  groupId: string
  item: StatusBarItem
  rect: Rect
}

export class RenderStatusBar extends RenderBox {
  static override debugTypeName = 'RenderStatusBar'
  private _groups: StatusBarGroup[] = []
  private _itemLayouts: StatusBarItemLayout[] = []
  private _customChildren = new Set<RenderBox>()

  constructor(options?: { groups?: StatusBarGroup[] }) {
    super()
    if (options?.groups) {
      this._groups = [...options.groups]
      this._reconcileCustomChildren()
    }
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  get groups(): readonly StatusBarGroup[] {
    return this._groups
  }

  addGroup(group: StatusBarGroup): void {
    this._groups.push(group)
    this._reconcileCustomChildren()
    this.markNeedsLayout()
  }

  removeGroup(id: string): void {
    const next = this._groups.filter(group => group.id !== id)
    if (next.length === this._groups.length) return
    this._groups = next
    this._reconcileCustomChildren()
    this.markNeedsLayout()
  }

  setGroups(groups: StatusBarGroup[]): void {
    this._groups = [...groups]
    this._reconcileCustomChildren()
    this.markNeedsLayout()
  }

  clearGroups(): void {
    if (this._groups.length === 0) return
    this._groups = []
    this._reconcileCustomChildren()
    this.markNeedsLayout()
  }

  itemRect(id: string): Rect | null {
    const layout = this._itemLayouts.find(item => item.id === id)
    return layout ? { ...layout.rect } : null
  }

  debugState(): {
    visibleLeftGroupIds: string[]
    visibleRightGroupIds: string[]
    visibleItemIds: string[]
  } {
    const visibleLeftGroupIds = this._visibleGroups('left').map(group => group.id)
    const visibleRightGroupIds = this._visibleGroups('right').map(group => group.id)
    return {
      visibleLeftGroupIds,
      visibleRightGroupIds,
      visibleItemIds: this._itemLayouts.map(item => item.id),
    }
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      for (const child of this._customChildren) visitor(child)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    for (const child of this._customChildren) visitor(child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveStatusBarStyle(context.theme)
    const contentHeight = Math.max(0, style.height - style.paddingY * 2)
    const leftGroups = this._measureGroups('left', context, style)
    const rightGroups = this._measureGroups('right', context, style)
    this.size = constrainSize(constraints, {
      width: constraints.maxWidth === Infinity
        ? this._slotWidth(leftGroups, style) +
          this._slotWidth(rightGroups, style) +
          (leftGroups.length > 0 && rightGroups.length > 0 ? style.sectionGap : 0) +
          style.paddingX * 2
        : constraints.maxWidth,
      height: style.height,
    })
    this._fitGroupsToAvailableWidth(leftGroups, rightGroups, style)
    const naturalContentWidth = this._slotWidth(leftGroups, style) +
      this._slotWidth(rightGroups, style) +
      (leftGroups.length > 0 && rightGroups.length > 0 ? style.sectionGap : 0)
    const desiredWidth = naturalContentWidth + style.paddingX * 2
    if (constraints.maxWidth === Infinity) this.size.width = desiredWidth
    this._positionItems(leftGroups, rightGroups, style)
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveStatusBarStyle(context.theme)
    const dl = new DrawList(context)
    dl.fillRect(
      offset.x,
      offset.y,
      this.size.width,
      this.size.height,
      style.backgroundBottom,
      0,
    )
    dl.fillRectGradient(
      offset.x,
      offset.y,
      this.size.width,
      this.size.height,
      style.backgroundTop,
      style.backgroundBottom,
      0,
    )
    if (style.borderWidth > 0) {
      dl.line(offset.x, offset.y + 0.5, offset.x + this.size.width, offset.y + 0.5, style.topBorder, style.borderWidth)
      dl.line(
        offset.x,
        offset.y + this.size.height - 0.5,
        offset.x + this.size.width,
        offset.y + this.size.height - 0.5,
        style.bottomBorder,
        style.borderWidth,
      )
      dl.strokeRect(
        offset.x,
        offset.y,
        this.size.width,
        this.size.height,
        style.topBorder,
        1,
        0,
      )
    }

    for (const layout of this._itemLayouts) {
      const x = offset.x + layout.rect.x
      const y = offset.y + layout.rect.y
      switch (layout.item.kind) {
        case 'separator': {
          const lineX = Math.round(x + layout.rect.width / 2)
          const lineY = y + style.separatorInset
          const lineHeight = Math.max(0, layout.rect.height - style.separatorInset * 2)
          if (lineHeight > 0) dl.fillRect(lineX, lineY, 1, lineHeight, style.separatorColor)
          break
        }
        case 'text':
          if (layout.rect.width <= 0) break
          dl.pushClip(x, y, layout.rect.width, layout.rect.height)
          dl.fillText(
            layout.item.text,
            x,
            y + layout.rect.height / 2,
            style.textColors[layout.item.tone ?? 'secondary'],
            style.fontSize,
            style.fontFamily,
            'left',
            'middle',
          )
          dl.popClip()
          break
        case 'badge':
          paintBadge(context, {
            value: layout.item.value,
            status: layout.item.status,
            appearance: layout.item.appearance,
            dot: layout.item.dot,
            max: layout.item.max,
            compact: true,
            rect: { x, y, width: layout.rect.width, height: layout.rect.height },
          })
          break
        case 'custom':
          layout.item.child.paint(context, { x, y })
          break
      }
    }
    this.paintAdornerChildren(context, offset)
  }

  dispose(): void {
    for (const child of this._customChildren) {
      child.parent = undefined
      child.dispose()
    }
    this._customChildren.clear()
    super.dispose()
  }

  private _visibleGroups(align: StatusBarAlign): StatusBarGroup[] {
    return this._groups.filter(group => group.align === align && group.visible !== false)
  }

  private _visibleItems(group: StatusBarGroup): StatusBarItem[] {
    return group.items.filter(item => item.visible !== false)
  }

  private _measureGroups(
    align: StatusBarAlign,
    context: LayoutContext,
    style: StatusBarStyleTokens,
  ): MeasuredStatusBarGroup[] {
    return this._visibleGroups(align)
      .map(group => {
        const measuredItems = this._visibleItems(group).map(item => this._measureItem(item, context, style))
        const width = measuredItems.reduce((sum, item, index) => sum + item.width + (index > 0 ? style.itemGap : 0), 0)
        const height = Math.max(...measuredItems.map(item => item.height), 0)
        return { group, items: measuredItems, width, height }
      })
      .filter(group => group.items.length > 0)
  }

  private _measureItem(
    item: StatusBarItem,
    context: LayoutContext,
    style: StatusBarStyleTokens,
  ): MeasuredStatusBarItem {
    switch (item.kind) {
      case 'separator':
        return {
          item,
          width: style.separatorWidth,
          height: Math.max(10, style.height - 4),
        }
      case 'badge': {
        const metrics = measureBadgeLayout(context.theme, item.value, {
          status: item.status,
          appearance: item.appearance,
          dot: item.dot,
          max: item.max,
          compact: true,
        })
        return { item, width: metrics.width, height: metrics.height }
      }
      case 'custom':
        item.child.layout({
          minWidth: 0,
          maxWidth: Infinity,
          minHeight: 0,
          maxHeight: Math.max(0, style.height - style.paddingY * 2),
        }, true, context)
        return {
          item,
          width: item.child.outerSize.width,
          height: item.child.outerSize.height,
        }
      case 'text':
      default:
        return {
          item,
          width: Math.ceil(TextMeasurer.measureWidth(item.text, style.fontSize, style.fontFamily)),
          height: style.fontSize + 2,
        }
    }
  }

  private _slotWidth(groups: MeasuredStatusBarGroup[], style: StatusBarStyleTokens): number {
    return groups.reduce((sum, group, index) => sum + group.width + (index > 0 ? style.sectionGap : 0), 0)
  }

  private _fitGroupsToAvailableWidth(
    leftGroups: MeasuredStatusBarGroup[],
    rightGroups: MeasuredStatusBarGroup[],
    style: StatusBarStyleTokens,
  ): void {
    const rightWidth = this._slotWidth(rightGroups, style)
    const gap = leftGroups.length > 0 && rightGroups.length > 0 ? style.sectionGap : 0
    const maxLeftWidth = Math.max(0, this.size.width - style.paddingX * 2 - rightWidth - gap)
    this._shrinkTextItems(leftGroups, maxLeftWidth, style)
  }

  private _shrinkTextItems(
    groups: MeasuredStatusBarGroup[],
    maxWidth: number,
    style: StatusBarStyleTokens,
  ): void {
    let width = this._slotWidth(groups, style)
    let excess = width - maxWidth
    if (excess <= 0) return

    const textItems = groups
      .flatMap(group => group.items.map(item => ({ group, item })))
      .filter(entry => entry.item.item.kind === 'text')
      .sort((a, b) => b.item.width - a.item.width)

    for (const entry of textItems) {
      if (excess <= 0) break
      const shrink = Math.min(entry.item.width, excess)
      if (shrink <= 0) continue
      entry.item.width -= shrink
      entry.group.width -= shrink
      width -= shrink
      excess -= shrink
    }
  }

  private _positionItems(
    leftGroups: MeasuredStatusBarGroup[],
    rightGroups: MeasuredStatusBarGroup[],
    style: StatusBarStyleTokens,
  ): void {
    this._itemLayouts = []
    const contentHeight = this.size.height - style.paddingY * 2
    let leftCursor = style.paddingX
    for (const group of leftGroups) {
      leftCursor = this._positionGroup(group, leftCursor, contentHeight, style)
      leftCursor += style.sectionGap
    }
    let rightCursor = this.size.width - style.paddingX
    for (const group of [...rightGroups].reverse()) {
      const groupStart = rightCursor - group.width
      this._positionGroup(group, groupStart, contentHeight, style)
      rightCursor = groupStart - style.sectionGap
    }
  }

  private _positionGroup(
    group: MeasuredStatusBarGroup,
    startX: number,
    _contentHeight: number,
    style: StatusBarStyleTokens,
  ): number {
    let cursor = startX
    for (const measured of group.items) {
      const y = Math.max(0, Math.round((this.size.height - measured.height) / 2) + 1)
      const rect = {
        x: cursor,
        y,
        width: measured.width,
        height: measured.height,
      }
      this._itemLayouts.push({
        id: measured.item.id,
        groupId: group.group.id,
        item: measured.item,
        rect,
      })
      if (measured.item.kind === 'custom') {
        measured.item.child.positionInSlot(
          rect,
          measured.item.child.resolveHorizontalAlignment('start'),
          measured.item.child.resolveVerticalAlignment('center'),
        )
      }
      cursor += measured.width + style.itemGap
    }
    return cursor - (group.items.length > 0 ? style.itemGap : 0)
  }

  private _reconcileCustomChildren(): void {
    const next = new Set<RenderBox>()
    for (const group of this._groups) {
      if (group.visible === false) continue
      for (const item of group.items) {
        if (item.visible === false) continue
        if (item.kind !== 'custom') continue
        next.add(item.child)
      }
    }
    for (const child of this._customChildren) {
      if (!next.has(child)) child.parent = undefined
    }
    for (const child of next) child.parent = this
    this._customChildren = next
  }
}
