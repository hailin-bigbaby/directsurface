// Splitter: 可拖拽分割面板
// 水平（左右）或垂直（上下）分割，拖拽或键盘调整比例

import { DrawList } from '../rendering/draw_list'
import {
  deriveSplitterStyle,
  resolveBgColor,
  resolveTextColor,
} from '../theme/component_styles'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { HitTestResult, isPrimaryPointerButton, type HitTestTarget } from '../gestures/hit_test'
import { RenderBox } from '../layout/render_box'
import { FocusableControl, paintFocusRing, type ControlInteractionSnapshot } from './focusable_control'
import { assertFiniteNumber } from '../core/finite_geometry'

export type SplitDirection = 'horizontal' | 'vertical'

export class RenderSplitter extends FocusableControl implements InteractiveRenderObject {
  static override debugTypeName = 'RenderSplitter'
  first: RenderObject
  second: RenderObject
  direction: SplitDirection

  private _ratio = 0.5
  private _disabled: boolean
  private _minRatio = 0.1
  private _maxRatio = 0.9
  private _fixedSize = 0
  readonly splitterSize: number

  private _dragging = false
  private _dragStartPos = 0
  private _dragStartRatio = 0
  private _releasePointerCapture?: () => void
  private _onChange?: (ratio: number) => void
  private _disposeChildren = true
  private _disposed = false

  private get _hovered(): boolean {
    return this._interaction.isHovered
  }

  private set _hovered(value: boolean) {
    if (value) this._interaction.enterHover()
    else this._interaction.leaveHover()
  }

  constructor(opts: {
    first: RenderObject
    second: RenderObject
    direction?: SplitDirection
    ratio?: number
    disabled?: boolean
    minRatio?: number
    maxRatio?: number
    splitterSize?: number
    fixedSize?: number
    onChange?: (ratio: number) => void
  }) {
    super({ disabled: opts.disabled ?? false })
    this.first = opts.first
    this.second = opts.second
    this.direction = opts.direction ?? 'horizontal'
    this._disabled = opts.disabled ?? false
    this._minRatio = assertFiniteNumber(opts.minRatio ?? 0.1, 'Splitter minRatio')
    this._maxRatio = assertFiniteNumber(opts.maxRatio ?? 0.9, 'Splitter maxRatio')
    this.splitterSize = assertFiniteNumber(opts.splitterSize ?? 5, 'Splitter splitterSize')
    this._fixedSize = assertFiniteNumber(opts.fixedSize ?? 0, 'Splitter fixedSize')
    const ratio = assertFiniteNumber(opts.ratio ?? 0.5, 'Splitter ratio')
    this._ratio = Math.max(this._minRatio, Math.min(this._maxRatio, ratio))
    this._onChange = opts.onChange

    this.first.parent = this
    this.second.parent = this
  }

  get ratio(): number { return this._ratio }
  set ratio(value: number) {
    assertFiniteNumber(value, 'Splitter ratio')
    const clamped = Math.max(this.minRatio, Math.min(this.maxRatio, value))
    if (this._ratio === clamped) return
    this._ratio = clamped
    this.markNeedsLayout()
  }

  get minRatio(): number { return this._minRatio }
  set minRatio(value: number) {
    assertFiniteNumber(value, 'Splitter minRatio')
    if (this._minRatio === value) return
    this._minRatio = value
    this.markNeedsLayout()
  }

  get maxRatio(): number { return this._maxRatio }
  set maxRatio(value: number) {
    assertFiniteNumber(value, 'Splitter maxRatio')
    if (this._maxRatio === value) return
    this._maxRatio = value
    this.markNeedsLayout()
  }

  get fixedSize(): number { return this._fixedSize }
  set fixedSize(value: number) {
    assertFiniteNumber(value, 'Splitter fixedSize')
    if (this._fixedSize === value) return
    this._fixedSize = value
    this.markNeedsLayout()
  }

  get disabled(): boolean { return this._disabled }
  set disabled(value: boolean) {
    if (this._disabled === value) return
    this._disabled = value
    this.setDisabledState(value)
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    if (!this._disposeChildren) return
    visitor(this.first)
    visitor(this.second)
  }

  disposeKeepingChildren(): void {
    if (this._disposed) return
    if (this.first.parent === this) this.first.parent = undefined
    if (this.second.parent === this) this.second.parent = undefined
    this._disposeChildren = false
    this.dispose()
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const w = constraints.maxWidth === Infinity ? 400 : constraints.maxWidth
    const h = this.fixedSize > 0
      ? this.fixedSize
      : constraints.maxHeight === Infinity
        ? 300
        : constraints.maxHeight
    this.size = { width: w, height: h }

    if (this.direction === 'horizontal') {
      const firstW = Math.round((w - this.splitterSize) * this.ratio)
      const secondW = w - this.splitterSize - firstW

      this._layoutChildInSlot(this.first, { x: 0, y: 0, width: firstW, height: h }, context)
      this._layoutChildInSlot(this.second, { x: firstW + this.splitterSize, y: 0, width: secondW, height: h }, context)
    } else {
      const firstH = Math.round((h - this.splitterSize) * this.ratio)
      const secondH = h - this.splitterSize - firstH

      this._layoutChildInSlot(this.first, { x: 0, y: 0, width: w, height: firstH }, context)
      this._layoutChildInSlot(this.second, { x: 0, y: firstH + this.splitterSize, width: w, height: secondH }, context)
    }
  }

  private _layoutChildInSlot(child: RenderObject, slot: { x: number; y: number; width: number; height: number }, context: LayoutContext): void {
    if (!(child instanceof RenderBox)) {
      child.layout({ minWidth: 0, maxWidth: slot.width, minHeight: 0, maxHeight: slot.height }, true, context)
      child.offset = { x: slot.x, y: slot.y }
      return
    }
    const horizontalAlignment = child.resolveHorizontalAlignment('stretch')
    const verticalAlignment = child.resolveVerticalAlignment('stretch')
    child.layout({
      minWidth: horizontalAlignment === 'stretch' && child.width === undefined ? slot.width : 0,
      maxWidth: slot.width,
      minHeight: verticalAlignment === 'stretch' && child.height === undefined ? slot.height : 0,
      maxHeight: slot.height,
    }, true, context)
    child.positionInSlot(slot, horizontalAlignment, verticalAlignment)
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const s = deriveSplitterStyle(context.theme)
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w, height: h } = this.size
    const state = this.isDisabled
      ? 'disabled'
      : this._dragging
        ? 'pressed'
        : this._interaction.isHovered
          ? 'hovered'
          : 'normal'
    const splitterColor = resolveBgColor(s.barBg, state)
    const gripColor = resolveTextColor(s.gripText, state)

    this.first.paint(context, { x: x + this.first.offset.x, y: y + this.first.offset.y })
    this.second.paint(context, { x: x + this.second.offset.x, y: y + this.second.offset.y })

    if (this.direction === 'horizontal') {
      const sx = x + this.second.offset.x - this.splitterSize
      dl.fillRect(sx, y, this.splitterSize, h, splitterColor, 0)
      if (this.isFocused && !this.isDisabled) {
        paintFocusRing(dl, context.theme.focusBorder, sx - 1, y, this.splitterSize + 2, h, 0)
      }
      if (this._interaction.isHovered || this._dragging) {
        const cx = sx + this.splitterSize / 2
        for (let i = -1; i <= 1; i++) {
          dl.fillCircle(cx, y + h / 2 + i * 6, 2, gripColor)
        }
      }
    } else {
      const sy = y + this.second.offset.y - this.splitterSize
      dl.fillRect(x, sy, w, this.splitterSize, splitterColor, 0)
      if (this.isFocused && !this.isDisabled) {
        paintFocusRing(dl, context.theme.focusBorder, x, sy - 1, w, this.splitterSize + 2, 0)
      }
      if (this._interaction.isHovered || this._dragging) {
        const cy = sy + this.splitterSize / 2
        for (let i = -1; i <= 1; i++) {
          dl.fillCircle(x + w / 2 + i * 6, cy, 2, gripColor)
        }
      }
    }
  }

  private _inSplitter(p: Offset): boolean {
    const g = this.globalOffset
    if (this.direction === 'horizontal') {
      const sx = g.x + this.second.offset.x - this.splitterSize
      return p.x >= sx && p.x <= sx + this.splitterSize &&
        p.y >= g.y && p.y <= g.y + this.size.height
    }
    const sy = g.y + this.second.offset.y - this.splitterSize
    return p.y >= sy && p.y <= sy + this.splitterSize &&
      p.x >= g.x && p.x <= g.x + this.size.width
  }

  hitTest(point: Offset): boolean {
    const g = this.globalOffset
    return point.x >= g.x && point.x <= g.x + this.size.width &&
      point.y >= g.y && point.y <= g.y + this.size.height
  }

  override hitTestPath(point: Offset, result: HitTestResult): boolean {
    if (!this.hitTest(point)) return false

    const g = this.globalOffset
    result.add({
      target: this as unknown as HitTestTarget,
      localPosition: { x: point.x - g.x, y: point.y - g.y },
    })

    if (this._inSplitter(point)) return true

    const children = [this.second, this.first]
    for (const child of children) {
      child.prepareForRenderOrHitTest()
      const childResult = new HitTestResult()
      if (!child.hitTestPath(point, childResult)) continue
      for (const entry of childResult.path) result.add(entry)
      break
    }
    return true
  }

  onPointerDownCapture(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (!this._canBeginDrag(e)) return
    this._beginDrag(e)
    e.stopPropagation?.()
  }

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (!this._canBeginDrag(e)) return
    this._beginDrag(e)
  }

  onPointerMoveCapture(e: PointerEvent): void {
    this._updateHover(e)
  }

  onPointerMove(e: PointerEvent): void {
    if (this.isDisabled) return
    if (this._dragging) {
      const total = this.direction === 'horizontal'
        ? this.size.width - this.splitterSize
        : this.size.height - this.splitterSize
      const delta = this.direction === 'horizontal'
        ? e.position.x - this._dragStartPos
        : e.position.y - this._dragStartPos
      this.ratio = this._dragStartRatio + delta / total
      this._onChange?.(this.ratio)
      return
    }

    this._updateHover(e)
  }

  private _updateHover(e: PointerEvent): void {
    if (this.isDisabled || this._dragging) return
    const isHovered = this._inSplitter(e.position)
    const hoverChanged = isHovered
      ? this._interaction.enterHover()
      : this._interaction.leaveHover()
    if (hoverChanged) this.markNeedsPaint()
  }

  onPointerUp(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    const wasDragging = this._dragging
    this._dragging = false
    this._interaction.release()
    this._releaseCapture()
    if (wasDragging) {
      this._updateHover(e)
      this.markNeedsPaint()
    }
  }

  onPointerCancel(_e: PointerEvent): void {
    const hadState = this._dragging || this._interaction.isHovered || this._interaction.isPressed
    this._dragging = false
    this._interaction.release()
    this._interaction.leaveHover()
    this._releaseCapture()
    if (hadState) this.markNeedsPaint()
  }

  onPointerLeave(_e: PointerEvent): void {
    if (!this._interaction.leaveHover()) return
    this.markNeedsPaint()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isDisabled) return false
    const step = 0.02
    switch (event.key) {
      case 'Home':
        event.preventDefault()
        this._setRatio(this.minRatio)
        return true
      case 'End':
        event.preventDefault()
        this._setRatio(this.maxRatio)
        return true
      case 'ArrowLeft':
        if (this.direction !== 'horizontal') return false
        event.preventDefault()
        this._setRatio(this.ratio - step)
        return true
      case 'ArrowRight':
        if (this.direction !== 'horizontal') return false
        event.preventDefault()
        this._setRatio(this.ratio + step)
        return true
      case 'ArrowUp':
        if (this.direction !== 'vertical') return false
        event.preventDefault()
        this._setRatio(this.ratio - step)
        return true
      case 'ArrowDown':
        if (this.direction !== 'vertical') return false
        event.preventDefault()
        this._setRatio(this.ratio + step)
        return true
      default:
        return false
    }
  }

  private _setRatio(value: number): void {
    const before = this.ratio
    this.ratio = value
    if (before !== this.ratio) this._onChange?.(this.ratio)
  }

  private _releaseCapture(): void {
    this._releasePointerCapture?.()
    this._releasePointerCapture = undefined
  }

  private _canBeginDrag(e: PointerEvent): boolean {
    return !this.isDisabled && !this._dragging && this._inSplitter(e.position)
  }

  private _beginDrag(e: PointerEvent): void {
    this.requestFocus()
    e.setPointerCapture?.()
    this._releasePointerCapture = e.releasePointerCapture
    this._interaction.press()
    this._dragging = true
    this._dragStartPos = this.direction === 'horizontal' ? e.position.x : e.position.y
    this._dragStartRatio = this.ratio
    this.markNeedsPaint()
  }

  protected override onDisabledStateChanged(disabled: boolean, previous: ControlInteractionSnapshot): void {
    if (!disabled) return
    this._dragging = false
    if (previous.pressed) this._interaction.release()
    if (previous.hovered) this._interaction.leaveHover()
    this._releaseCapture()
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._releaseCapture()
    this._dragging = false
    super.dispose()
    this._onChange = undefined
  }
}
