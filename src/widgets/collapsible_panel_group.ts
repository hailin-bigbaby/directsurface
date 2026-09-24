import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject, constrainSize } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import { HitTestResult, isPrimaryPointerButton, type HitTestTarget } from '../gestures/hit_test'
import type { InteractiveRenderObject, PointerEvent } from '../gestures/recognizers'
import { RenderBox, resolveChildLayout, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { lerpColor } from '../theme/theme'
import { paintIconGlyph } from './icon'

export interface CollapsiblePanelSection {
  key: string
  title: string
  child: RenderBox
  expanded?: boolean
  flex?: number
}

export interface CollapsiblePanelExpandedChange {
  key: string
  expanded: boolean
}

export interface RenderCollapsiblePanelGroupOptions extends RenderBoxOptions {
  sections: readonly CollapsiblePanelSection[]
  headerHeight?: number
  spacing?: number
  resizeHandleSize?: number
  minContentHeight?: number
  onExpandedChange?: (event: CollapsiblePanelExpandedChange) => void
}

export interface CollapsiblePanelGroupDebugSection {
  key: string
  title: string
  expanded: boolean
  flex: number
  headerY: number
  contentY: number
  contentHeight: number
}

export interface CollapsiblePanelGroupResizeHandleDebugState {
  index: number
  beforeKey: string
  afterKey: string
  y: number
  height: number
}

interface InternalSection {
  key: string
  title: string
  child: RenderBox
  expanded: boolean
  flex: number
  headerY: number
  contentY: number
  contentHeight: number
}

interface ResizeHandle {
  beforeKey: string
  afterKey: string
  y: number
  height: number
}

function ellipsize(text: string, width: number, fontSize: number, fontFamily: string): string {
  if (TextMeasurer.measureWidth(text, fontSize, fontFamily) <= width) return text
  const suffix = '...'
  if (TextMeasurer.measureWidth(suffix, fontSize, fontFamily) > width) return ''
  const chars = Array.from(text)
  while (chars.length > 0 && TextMeasurer.measureWidth(`${chars.join('')}${suffix}`, fontSize, fontFamily) > width) {
    chars.pop()
  }
  return `${chars.join('')}${suffix}`
}

export class RenderCollapsiblePanelGroup extends RenderBox implements InteractiveRenderObject {
  static override debugTypeName = 'RenderCollapsiblePanelGroup'
  onExpandedChange?: (event: CollapsiblePanelExpandedChange) => void

  private _sections: InternalSection[] = []
  private _headerHeight: number
  private _spacing: number
  private _resizeHandleSize: number
  private _minContentHeight: number
  private _hoverKey = ''
  private _pressedKey = ''
  private _resizeHandles: ResizeHandle[] = []
  private _hoverResizeIndex = -1
  private _dragResizeIndex = -1
  private _dragStartY = 0
  private _dragStartBeforeHeight = 0
  private _dragStartAfterHeight = 0
  private _dragStartBeforeFlex = 1
  private _dragStartAfterFlex = 1
  private _releasePointerCapture?: () => void

  constructor(options: RenderCollapsiblePanelGroupOptions) {
    super(options)
    this._headerHeight = options.headerHeight ?? 28
    this._spacing = options.spacing ?? 0
    this._resizeHandleSize = Math.max(4, options.resizeHandleSize ?? 6)
    this._minContentHeight = Math.max(0, options.minContentHeight ?? 48)
    this.onExpandedChange = options.onExpandedChange
    this.setSections(options.sections)
  }

  get sections(): readonly CollapsiblePanelGroupDebugSection[] {
    return this.debugState().sections
  }

  get headerHeight(): number {
    return this._headerHeight
  }

  set headerHeight(value: number) {
    const next = Math.max(20, value)
    if (this._headerHeight === next) return
    this._headerHeight = next
    this.markNeedsLayout()
  }

  get spacing(): number {
    return this._spacing
  }

  set spacing(value: number) {
    const next = Math.max(0, value)
    if (this._spacing === next) return
    this._spacing = next
    this.markNeedsLayout()
  }

  setSections(sections: readonly CollapsiblePanelSection[]): void {
    this._releaseCapture()
    for (const section of this._sections) {
      section.child.parent = undefined
      if (section.child.owner) section.child.detach()
    }
    this._sections = sections.map(section => {
      section.child.parent = this
      if (this.owner && section.child.owner !== this.owner) section.child.attach(this.owner)
      return {
        key: section.key,
        title: section.title,
        child: section.child,
        expanded: section.expanded ?? true,
        flex: Math.max(0, section.flex ?? 1),
        headerY: 0,
        contentY: 0,
        contentHeight: 0,
      }
    })
    this._hoverKey = ''
    this._pressedKey = ''
    this._hoverResizeIndex = -1
    this._dragResizeIndex = -1
    this._resizeHandles = []
    this._syncCursor()
    this.markNeedsLayout()
  }

  isSectionExpanded(key: string): boolean {
    return this._sections.find(section => section.key === key)?.expanded ?? false
  }

  setSectionExpanded(key: string, expanded: boolean): void {
    const section = this._sections.find(item => item.key === key)
    if (!section || section.expanded === expanded) return
    section.expanded = expanded
    if (!expanded && this._hoverKey === key) this._hoverKey = ''
    if (!expanded && this._pressedKey === key) this._pressedKey = ''
    if (!expanded) {
      this._hoverResizeIndex = -1
      this._endResize(false)
    }
    this.onExpandedChange?.({ key, expanded })
    this.markNeedsLayout()
  }

  toggleSection(key: string): void {
    const section = this._sections.find(item => item.key === key)
    if (!section) return
    this.setSectionExpanded(key, !section.expanded)
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      for (const section of this._sections) visitor(section.child)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    for (const section of this._sections) {
      if (section.expanded) visitor(section.child)
    }
  }

  override isFocusChildActive(child: RenderObject): boolean {
    const section = this._sections.find(item => item.child === child)
    if (section) return section.expanded && child.visible
    return super.isFocusChildActive(child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const maxWidth = constraints.maxWidth === Infinity ? 320 : constraints.maxWidth
    const finiteHeight = constraints.maxHeight !== Infinity
    const spacingTotal = Math.max(0, this._sections.length - 1) * this._spacing
    const totalHeaderHeight = this._sections.length * this._headerHeight
    let availableContentHeight = finiteHeight
      ? Math.max(0, constraints.maxHeight - totalHeaderHeight - spacingTotal)
      : Infinity

    let fixedHeight = 0
    let totalFlex = 0
    for (const section of this._sections) {
      section.contentY = 0
      section.contentHeight = 0
    }
    const expanded = this._sections.filter(section => section.expanded)
    for (const section of expanded) {
      if (!finiteHeight || section.flex <= 0) {
        const childLayout = resolveChildLayout(section.child, {
          minWidth: maxWidth,
          maxWidth,
          minHeight: 0,
          maxHeight: finiteHeight ? availableContentHeight : Infinity,
        }, 'start', 'start')
        section.child.layout(childLayout.constraints, true, context)
        section.contentHeight = section.child.outerSize.height
        fixedHeight += section.contentHeight
      } else {
        totalFlex += section.flex
      }
    }

    if (finiteHeight) {
      availableContentHeight = Math.max(0, availableContentHeight - fixedHeight)
    }

    for (const section of expanded) {
      if (finiteHeight && section.flex > 0) {
        const height = totalFlex > 0 ? availableContentHeight * section.flex / totalFlex : 0
        const childLayout = resolveChildLayout(section.child, {
          minWidth: maxWidth,
          maxWidth,
          minHeight: height,
          maxHeight: height,
        }, 'start', 'stretch')
        section.child.layout(childLayout.constraints, true, context)
        section.contentHeight = section.child.outerSize.height
      }
    }

    let y = 0
    let maxChildWidth = 0
    for (let index = 0; index < this._sections.length; index += 1) {
      const section = this._sections[index]!
      section.headerY = y
      y += this._headerHeight
      section.contentY = y
      if (section.expanded) {
        section.child.positionInSlot(
          { x: 0, y, width: maxWidth, height: section.contentHeight },
          section.child.resolveHorizontalAlignment('start'),
          section.child.resolveVerticalAlignment('start'),
        )
        y += section.contentHeight
        maxChildWidth = Math.max(maxChildWidth, section.child.outerSize.width)
      }
      if (index < this._sections.length - 1) y += this._spacing
    }

    this.size = constrainSize(constraints, {
      width: Math.max(maxChildWidth, maxWidth === Infinity ? 0 : maxWidth),
      height: y,
    })
    this._syncResizeHandles()
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const theme = context.theme
    const dl = new DrawList(context)
    dl.fillRect(offset.x, offset.y, this.size.width, this.size.height, theme.surfacePanel, 0)
    for (const section of this._sections) {
      const headerY = offset.y + section.headerY
      const hovered = this._hoverKey === section.key
      const pressed = this._pressedKey === section.key
      const baseBg = lerpColor(theme.surfaceDataHeader, theme.surfaceNav, 0.34)
      dl.fillRect(offset.x, headerY, this.size.width, this._headerHeight, baseBg, 0)
      if (pressed || hovered) {
        dl.fillRect(
          offset.x,
          headerY,
          this.size.width,
          this._headerHeight,
          pressed ? theme.statePressedOverlay : theme.stateHoverOverlay,
          0,
        )
      }
      dl.fillRect(offset.x, headerY, 3, this._headerHeight, section.expanded ? theme.accentPrimary : theme.borderDataStrong, 0)
      dl.line(offset.x, headerY, offset.x + this.size.width, headerY, theme.borderDataStrong, 1)
      dl.line(offset.x, headerY + this._headerHeight, offset.x + this.size.width, headerY + this._headerHeight, theme.borderDataStrong, 1)
      const iconSize = Math.max(10, theme.fontSize * 0.86)
      paintIconGlyph(context, {
        name: section.expanded ? 'chevron-down' : 'chevron-right',
        x: offset.x + 8,
        y: headerY + (this._headerHeight - iconSize) / 2,
        size: iconSize,
        color: theme.textSecondary,
      })
      const textX = offset.x + 8 + iconSize + 6
      const textWidth = Math.max(0, this.size.width - (textX - offset.x) - 8)
      dl.pushClip(textX, headerY, textWidth, this._headerHeight)
      dl.fillText(
        ellipsize(section.title, textWidth, theme.fontSize, theme.fontFamily),
        textX,
        headerY + this._headerHeight / 2,
        theme.textPrimary,
        theme.fontSize,
        theme.fontFamily,
        'left',
        'middle',
        700,
      )
      dl.popClip()
      if (section.expanded && section.contentHeight > 0) {
        dl.line(offset.x, offset.y + section.contentY, offset.x + this.size.width, offset.y + section.contentY, theme.borderSubtle, 1)
      }
    }
    for (let index = 0; index < this._resizeHandles.length; index += 1) {
      const handle = this._resizeHandles[index]!
      const active = index === this._dragResizeIndex || index === this._hoverResizeIndex
      const y = offset.y + handle.y
      const lineY = y + handle.height / 2
      if (active) dl.fillRect(offset.x, y, this.size.width, handle.height, theme.stateHoverOverlay, 0)
      dl.line(offset.x, lineY, offset.x + this.size.width, lineY, active ? theme.accentPrimary : theme.borderSubtle, active ? 2 : 1)
    }
    super.performPaint(context, offset)
  }

  override hitTestPath(point: Offset, result: HitTestResult): boolean {
    if (!this.hitTest(point)) return false
    const g = this.globalOffset
    result.add({
      target: this as unknown as HitTestTarget,
      localPosition: { x: point.x - g.x, y: point.y - g.y },
    })

    if (this._resizeHandleAt(point) >= 0 || this._headerKeyAt(point)) return true

    const children: RenderObject[] = []
    this.visitContentChildren(child => children.push(child))
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index]!
      child.prepareForRenderOrHitTest()
      const childResult = new HitTestResult()
      if (!child.hitTestPath(point, childResult)) continue
      for (const entry of childResult.path) result.add(entry)
      break
    }
    return true
  }

  onPointerMove(event: PointerEvent): void {
    if (this._dragResizeIndex >= 0) {
      this._updateResize(event.position.y)
      return
    }
    const resizeIndex = this._resizeHandleAt(event.position)
    const key = resizeIndex >= 0 ? '' : this._headerKeyAt(event.position)
    if (this._hoverKey === key && this._hoverResizeIndex === resizeIndex) return
    this._hoverKey = key
    this._hoverResizeIndex = resizeIndex
    this._syncCursor()
    this.markNeedsPaint()
  }

  onPointerDownCapture(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    const resizeIndex = this._resizeHandleAt(event.position)
    if (resizeIndex < 0) return
    this._beginResize(resizeIndex, event)
    event.stopPropagation?.()
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    const resizeIndex = this._resizeHandleAt(event.position)
    if (resizeIndex >= 0) {
      this._beginResize(resizeIndex, event)
      event.stopPropagation?.()
      return
    }
    const key = this._headerKeyAt(event.position)
    if (!key) return
    this._pressedKey = key
    this.markNeedsPaint()
  }

  onPointerUp(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this._dragResizeIndex >= 0) {
      this._endResize()
      return
    }
    const key = this._headerKeyAt(event.position)
    const pressedKey = this._pressedKey
    this._pressedKey = ''
    if (pressedKey && pressedKey === key) this.toggleSection(key)
    this.markNeedsPaint()
  }

  onPointerLeave(_event: PointerEvent): void {
    if (this._dragResizeIndex >= 0) return
    if (!this._hoverKey && !this._pressedKey && this._hoverResizeIndex < 0) return
    this._hoverKey = ''
    this._pressedKey = ''
    this._hoverResizeIndex = -1
    this._syncCursor()
    this.markNeedsPaint()
  }

  onPointerCancel(_event: PointerEvent): void {
    const hadState = Boolean(this._pressedKey) || this._dragResizeIndex >= 0 || this._hoverResizeIndex >= 0
    this._pressedKey = ''
    this._hoverResizeIndex = -1
    this._endResize(false)
    this._syncCursor()
    if (hadState) this.markNeedsPaint()
  }

  debugState(): {
    sections: CollapsiblePanelGroupDebugSection[]
    resizeHandles: CollapsiblePanelGroupResizeHandleDebugState[]
    hoverKey: string
    pressedKey: string
    hoverResizeIndex: number
    dragResizeIndex: number
  } {
    return {
      sections: this._sections.map(section => ({
        key: section.key,
        title: section.title,
        expanded: section.expanded,
        flex: section.flex,
        headerY: section.headerY,
        contentY: section.contentY,
        contentHeight: section.contentHeight,
      })),
      resizeHandles: this._resizeHandles.map((handle, index) => ({ index, ...handle })),
      hoverKey: this._hoverKey,
      pressedKey: this._pressedKey,
      hoverResizeIndex: this._hoverResizeIndex,
      dragResizeIndex: this._dragResizeIndex,
    }
  }

  private _headerKeyAt(point: Offset): string {
    if (!this.hitTest(point)) return ''
    const localY = point.y - this.globalOffset.y
    for (const section of this._sections) {
      if (localY >= section.headerY && localY <= section.headerY + this._headerHeight) return section.key
    }
    return ''
  }

  private _syncResizeHandles(): void {
    this._resizeHandles = []
    for (let index = 0; index < this._sections.length - 1; index += 1) {
      const before = this._sections[index]!
      const after = this._sections[index + 1]!
      if (!before.expanded || !after.expanded) continue
      if (before.flex <= 0 || after.flex <= 0) continue
      this._resizeHandles.push({
        beforeKey: before.key,
        afterKey: after.key,
        y: after.headerY - this._resizeHandleSize / 2,
        height: this._resizeHandleSize,
      })
    }
    if (this._hoverResizeIndex >= this._resizeHandles.length) this._hoverResizeIndex = -1
    if (this._dragResizeIndex >= this._resizeHandles.length) this._dragResizeIndex = -1
  }

  private _resizeHandleAt(point: Offset): number {
    if (!this.hitTest(point)) return -1
    const localY = point.y - this.globalOffset.y
    for (let index = 0; index < this._resizeHandles.length; index += 1) {
      const handle = this._resizeHandles[index]!
      if (localY >= handle.y && localY <= handle.y + handle.height) return index
    }
    return -1
  }

  private _beginResize(index: number, event: PointerEvent): void {
    if (this._dragResizeIndex === index) return
    const handle = this._resizeHandles[index]
    if (!handle) return
    const before = this._sections.find(section => section.key === handle.beforeKey)
    const after = this._sections.find(section => section.key === handle.afterKey)
    if (!before || !after) return
    this._dragResizeIndex = index
    this._hoverResizeIndex = index
    this._hoverKey = ''
    this._pressedKey = ''
    this._dragStartY = event.position.y
    this._dragStartBeforeHeight = before.contentHeight
    this._dragStartAfterHeight = after.contentHeight
    this._dragStartBeforeFlex = before.flex
    this._dragStartAfterFlex = after.flex
    event.setPointerCapture?.()
    this._releasePointerCapture = event.releasePointerCapture
    this._syncCursor()
    this.markNeedsPaint()
  }

  private _updateResize(pointerY: number): void {
    const handle = this._resizeHandles[this._dragResizeIndex]
    if (!handle) return
    const before = this._sections.find(section => section.key === handle.beforeKey)
    const after = this._sections.find(section => section.key === handle.afterKey)
    if (!before || !after) return

    const totalHeight = this._dragStartBeforeHeight + this._dragStartAfterHeight
    if (totalHeight <= 0) return
    const minHeight = Math.min(this._minContentHeight, totalHeight / 2)
    const delta = pointerY - this._dragStartY
    const beforeHeight = Math.max(minHeight, Math.min(totalHeight - minHeight, this._dragStartBeforeHeight + delta))
    const totalFlex = this._dragStartBeforeFlex + this._dragStartAfterFlex
    if (totalFlex <= 0) return
    before.flex = totalFlex * beforeHeight / totalHeight
    after.flex = totalFlex - before.flex
    this.markNeedsLayout()
  }

  private _endResize(markPaint = true): void {
    const wasDragging = this._dragResizeIndex >= 0
    this._dragResizeIndex = -1
    this._releaseCapture()
    this._syncCursor()
    if (markPaint && wasDragging) this.markNeedsPaint()
  }

  private _releaseCapture(): void {
    this._releasePointerCapture?.()
    this._releasePointerCapture = undefined
  }

  private _syncCursor(): void {
    if (!this.owner) return
    this.owner.setCursor(this._dragResizeIndex >= 0 || this._hoverResizeIndex >= 0 ? 'row-resize' : 'default')
  }

  override dispose(): void {
    this._releaseCapture()
    this._hoverResizeIndex = -1
    this._dragResizeIndex = -1
    this._syncCursor()
    super.dispose()
  }
}
