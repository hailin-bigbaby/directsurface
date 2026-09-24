// ScrollViewer: 可滚动容器
// 支持垂直/水平滚动、滚动条拖拽、鼠标滚轮、触摸滑动

import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import {
  hitTestScrollbarGeometry,
  paintHBar,
  paintVBar,
  resolveScrollbarGeometry,
  resolveScrollbarViewport,
  type ScrollbarGeometry,
  type ScrollbarViewportState,
} from '../rendering/scrollbar'
import { deriveScrollbarStyle } from '../theme/component_styles'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject, looseConstraints } from '../core/render_object'
import type { PointerEvent, WheelPointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import type { GestureArenaMember } from '../gestures/gesture_arena'
import { HitTestResult, isPrimaryPointerButton } from '../gestures/hit_test'
import { PendingPointerGesture } from '../gestures/pending_pointer_gesture'
import { pointerKey } from '../gestures/pointer_identity'
import { ScrollbarAxisController } from '../gestures/scrollbar_interaction_controller'
import { ScrollController } from '../virtualization/scroll_controller'
import { isScrollViewportClient } from '../core/scroll_viewport_client'

export type ScrollDirection = 'vertical' | 'horizontal' | 'both'
const DRAG_SLOP = 4

export class RenderScrollViewer extends RenderBox implements InteractiveRenderObject, GestureArenaMember {
  static override debugTypeName = 'RenderScrollViewer'
  readonly preventsPointerActivationOnAccept = true
  child?: RenderBox
  direction: ScrollDirection

  private _scrollX = new ScrollController({ axis: 'x' })
  private _scrollY = new ScrollController({ axis: 'y' })

  // 内容尺寸（布局后得到）
  private _contentWidth = 0
  private _contentHeight = 0
  private _viewport: ScrollbarViewportState = {
    width: 0,
    height: 0,
    showHBar: false,
    showVBar: false,
  }

  private readonly _vScrollbarController = new ScrollbarAxisController('vertical')
  private readonly _hScrollbarController = new ScrollbarAxisController('horizontal')
  private readonly _vScrollbar = this._vScrollbarController.state
  private readonly _hScrollbar = this._hScrollbarController.state

  private readonly _pendingGesture = new PendingPointerGesture()
  private _contentDragging = false
  private _contentDragStart?: Offset
  private _contentDragLast?: Offset
  private _contentDragStartScrollX = 0
  private _contentDragStartScrollY = 0

  constructor(opts: {
    direction?: ScrollDirection
    child?: RenderBox
  }) {
    super()
    this.direction = opts.direction ?? 'vertical'
    this.child = opts.child
    if (opts.child) opts.child.parent = this
  }

  setChild(child: RenderBox): void {
    if (this.child === child) return
    const previous = this.child
    if (previous) {
      previous.parent = undefined
      if (previous.owner) previous.detach()
    }
    if (this.owner && child.owner !== this.owner) child.attach(this.owner)
    if (this.child) this.child.parent = undefined
    this.child = child
    child.parent = this
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    if (this.child) visitor(this.child)
  }

  get scrollBarSize(): number { return deriveScrollbarStyle(this.currentTheme).gutterSize }

  get scrollX(): number { return this._scrollX.offset }
  set scrollX(value: number) {
    const before = this._scrollX.offset
    this._scrollX.setOffset(value, { viewportSize: this._viewW, contentSize: this._contentWidth })
    if (this._scrollX.offset === before) return
    this._syncScrollOffset()
  }

  get scrollY(): number { return this._scrollY.offset }
  set scrollY(value: number) {
    const before = this._scrollY.offset
    this._scrollY.setOffset(value, { viewportSize: this._viewH, contentSize: this._contentHeight })
    if (this._scrollY.offset === before) return
    this._syncScrollOffset()
  }

  revealDescendant(target: RenderObject, margin = 8): boolean {
    const local = target.offsetToAncestor(this)
    if (!local) return false

    const beforeX = this.scrollX
    const beforeY = this.scrollY
    const maxX = Math.max(margin, this._viewW - margin)
    const maxY = Math.max(margin, this._viewH - margin)
    const targetRight = local.x + target.size.width
    const targetBottom = local.y + target.size.height

    if (this.direction === 'horizontal' || this.direction === 'both') {
      if (local.x < margin) {
        this.scrollX += local.x - margin
      } else if (targetRight > maxX) {
        this.scrollX += targetRight - maxX
      }
    }

    if (this.direction === 'vertical' || this.direction === 'both') {
      if (local.y < margin) {
        this.scrollY += local.y - margin
      } else if (targetBottom > maxY) {
        this.scrollY += targetBottom - maxY
      }
    }

    return this.scrollX !== beforeX || this.scrollY !== beforeY
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const s = deriveScrollbarStyle(context.theme)
    const w = constraints.maxWidth === Infinity ? 300 : constraints.maxWidth
    const h = constraints.maxHeight === Infinity ? 200 : constraints.maxHeight
    this.size = { width: w, height: h }
    if (context.pass === 'measure') return

    if (!this.child) {
      this._contentWidth = 0
      this._contentHeight = 0
      this._viewport = this._resolveViewport(s.gutterSize)
      this._clampScroll()
      return
    }

    if (this.direction === 'vertical') {
      this._layoutVerticalChild(w, s.gutterSize, context)
    } else if (this.direction === 'horizontal') {
      this._layoutHorizontalChild(h, s.gutterSize, context)
    } else {
      this._layoutChild(Infinity, Infinity, context)
      this._viewport = this._resolveViewport(s.gutterSize)
    }

    this._clampScroll()
    this._positionChild()
    this._syncChildViewport()
  }

  private _layoutVerticalChild(width: number, scrollbarSize: number, context: LayoutContext): void {
    let reserveScrollbar = false
    const visitedStates = new Set<boolean>()
    for (;;) {
      visitedStates.add(reserveScrollbar)
      this._layoutChild(
        Math.max(0, width - (reserveScrollbar ? scrollbarSize : 0)),
        Infinity,
        context,
      )
      const nextReserveScrollbar = this._contentHeight > this.size.height
      if (nextReserveScrollbar === reserveScrollbar) {
        this._viewport = this._viewportForBars(false, reserveScrollbar, scrollbarSize)
        return
      }
      if (visitedStates.has(nextReserveScrollbar)) {
        this._viewport = this._viewportForBars(false, true, scrollbarSize)
        return
      }
      reserveScrollbar = nextReserveScrollbar
    }
  }

  private _layoutHorizontalChild(height: number, scrollbarSize: number, context: LayoutContext): void {
    let reserveScrollbar = false
    const visitedStates = new Set<boolean>()
    for (;;) {
      visitedStates.add(reserveScrollbar)
      this._layoutChild(
        Infinity,
        Math.max(0, height - (reserveScrollbar ? scrollbarSize : 0)),
        context,
      )
      const nextReserveScrollbar = this._contentWidth > this.size.width
      if (nextReserveScrollbar === reserveScrollbar) {
        this._viewport = this._viewportForBars(reserveScrollbar, false, scrollbarSize)
        return
      }
      if (visitedStates.has(nextReserveScrollbar)) {
        this._viewport = this._viewportForBars(true, false, scrollbarSize)
        return
      }
      reserveScrollbar = nextReserveScrollbar
    }
  }

  private _layoutChild(maxWidth: number, maxHeight: number, context: LayoutContext): void {
    if (!this.child) return
    this.child.layout({
      minWidth: 0,
      maxWidth,
      minHeight: 0,
      maxHeight,
    }, true, context)
    this._contentWidth = this.child.outerSize.width
    this._contentHeight = this.child.outerSize.height
  }

  private _resolveViewport(scrollbarSize = this.scrollBarSize): ScrollbarViewportState {
    return resolveScrollbarViewport({
      outerWidth: this.size.width,
      outerHeight: this.size.height,
      contentWidth: this._contentWidth,
      contentHeight: this._contentHeight,
      scrollbarSize,
      allowHorizontal: this.direction === 'horizontal' || this.direction === 'both',
      allowVertical: this.direction === 'vertical' || this.direction === 'both',
    })
  }

  private _viewportForBars(
    showHBar: boolean,
    showVBar: boolean,
    scrollbarSize: number,
  ): ScrollbarViewportState {
    return {
      width: Math.max(0, this.size.width - (showVBar ? scrollbarSize : 0)),
      height: Math.max(0, this.size.height - (showHBar ? scrollbarSize : 0)),
      showHBar,
      showVBar,
    }
  }

  private _clampScroll(): void {
    const allowHorizontal = this.direction === 'horizontal' || this.direction === 'both'
    const allowVertical = this.direction === 'vertical' || this.direction === 'both'
    this._scrollX.setOffset(allowHorizontal ? this.scrollX : 0, {
      viewportSize: this._viewW,
      contentSize: allowHorizontal ? this._contentWidth : 0,
    })
    this._scrollY.setOffset(allowVertical ? this.scrollY : 0, {
      viewportSize: this._viewH,
      contentSize: allowVertical ? this._contentHeight : 0,
    })
  }

  private get _viewW(): number {
    return this._viewport.width
  }

  private get _viewH(): number {
    return this._viewport.height
  }

  private _syncScrollOffset(): void {
    this._clampScroll()
    this._positionChild()
    this._syncChildViewport()
    this.markNeedsPaint()
  }

  private _positionChild(): void {
    if (!this.child) return
    this.child.positionInSlot(
      { x: -this.scrollX, y: -this.scrollY, width: this._contentWidth, height: this._contentHeight },
      'start',
      'start',
    )
  }

  private _syncChildViewport(): void {
    if (!isScrollViewportClient(this.child)) return
    this.child.setScrollViewport({
      viewWidth: this._viewW,
      viewHeight: this._viewH,
      scrollX: this.scrollX,
      scrollY: this.scrollY,
    })
  }

  get _showVBar(): boolean {
    return this._viewport.showVBar
  }

  get _showHBar(): boolean {
    return this._viewport.showHBar
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const s = deriveScrollbarStyle(context.theme)
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w, height: h } = this.size

    // 裁剪内容区域
    const clipW = w - (this._showVBar ? this.scrollBarSize : 0)
    const clipH = h - (this._showHBar ? this.scrollBarSize : 0)
    dl.pushClip(x, y, clipW, clipH)

    if (this.child) {
      this.child.paint(context, {
        x: offset.x + this.child.offset.x,
        y: offset.y + this.child.offset.y,
      })
    }

    dl.popClip()

    // 垂直滚动条
    if (this._showVBar) {
      this._paintVBar(dl, x, y, w, h, s)
    }

    // 水平滚动条
    if (this._showHBar) {
      this._paintHBar(dl, x, y, w, h, s)
    }
  }

  private _paintVBar(dl: DrawList, x: number, y: number, w: number, h: number, style: ReturnType<typeof deriveScrollbarStyle>): void {
    paintVBar({
      dl,
      style,
      trackX: x + w - this.scrollBarSize,
      trackY: y,
      trackW: this.scrollBarSize,
      trackH: h - (this._showHBar ? this.scrollBarSize : 0),
      viewSize: this._viewH,
      contentSize: this._contentHeight,
      scrollOffset: this.scrollY,
      state: this._vScrollbar,
      forceVisible: this._showVBar,
    })
  }

  private _paintHBar(dl: DrawList, x: number, y: number, w: number, h: number, style: ReturnType<typeof deriveScrollbarStyle>): void {
    paintHBar({
      dl,
      style,
      trackX: x,
      trackY: y + h - this.scrollBarSize,
      trackW: w - (this._showVBar ? this.scrollBarSize : 0),
      trackH: this.scrollBarSize,
      viewSize: this._viewW,
      contentSize: this._contentWidth,
      scrollOffset: this.scrollX,
      state: this._hScrollbar,
      forceVisible: this._showHBar,
    })
  }

  // ---- 命中测试辅助 ----

  private _inVBar(p: Offset): boolean {
    return this._showVBar && hitTestScrollbarGeometry(p, this._vScrollbarGeometry())
  }

  private _vScrollbarGeometry(): ScrollbarGeometry {
    const g = this.globalOffset
    const style = deriveScrollbarStyle(this.currentTheme)
    return resolveScrollbarGeometry({
      axis: 'vertical',
      trackRect: {
        x: g.x + this.size.width - style.gutterSize,
        y: g.y,
        width: style.gutterSize,
        height: this.size.height - (this._showHBar ? style.gutterSize : 0),
      },
      viewportSize: this._viewH,
      contentSize: this._contentHeight,
      scrollOffset: this.scrollY,
      visualThickness: style.thumbThickness,
      minThumbLength: style.minThumbLength,
      endInset: style.endInset,
    })
  }

  private _inHBar(p: Offset): boolean {
    return this._showHBar && hitTestScrollbarGeometry(p, this._hScrollbarGeometry())
  }

  private _hScrollbarGeometry(): ScrollbarGeometry {
    const g = this.globalOffset
    const style = deriveScrollbarStyle(this.currentTheme)
    return resolveScrollbarGeometry({
      axis: 'horizontal',
      trackRect: {
        x: g.x,
        y: g.y + this.size.height - style.gutterSize,
        width: this.size.width - (this._showVBar ? style.gutterSize : 0),
        height: style.gutterSize,
      },
      viewportSize: this._viewW,
      contentSize: this._contentWidth,
      scrollOffset: this.scrollX,
      visualThickness: style.thumbThickness,
      minThumbLength: style.minThumbLength,
      endInset: style.endInset,
    })
  }

  private _inViewport(point: Offset): boolean {
    const g = this.globalOffset
    return (
      point.x >= g.x &&
      point.x <= g.x + this._viewW &&
      point.y >= g.y &&
      point.y <= g.y + this._viewH
    )
  }

  isPointInContentViewport(point: Offset): boolean {
    return this._inViewport(point)
  }

  isPointInScrollbar(point: Offset): boolean {
    return this._inVBar(point) || this._inHBar(point)
  }

  override hitTestPath(point: Offset, result: HitTestResult): boolean {
    if (!this.hitTest(point)) return false

    const childResult = new HitTestResult()
    if (this.child && this._inViewport(point)) {
      this.child.hitTestPath(point, childResult)
    }

    const g = this.globalOffset
    result.add({
      target: this as unknown as any,
      localPosition: { x: point.x - g.x, y: point.y - g.y },
    })
    for (const entry of childResult.path) result.add(entry)
    return true
  }

  // ---- 指针事件 ----

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (!this.hitTest(e.position)) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    const vertical = this._showVBar
      ? this._vScrollbarController.beginPointer(e.position, this._vScrollbarGeometry(), pointerKey(e))
      : { handled: false, stateChanged: false, action: 'none' as const }
    const horizontal = !vertical.handled && this._showHBar
      ? this._hScrollbarController.beginPointer(e.position, this._hScrollbarGeometry(), pointerKey(e))
      : { handled: false, stateChanged: false, action: 'none' as const }
    if (vertical.handled) {
      const before = this.scrollY
      if (vertical.scrollOffset !== undefined) {
        this._scrollY.setOffset(vertical.scrollOffset, {
          viewportSize: this._viewH,
          contentSize: this._contentHeight,
        })
        this._syncScrollOffset()
      }
      if (vertical.dragStarted) this._pendingGesture.captureImmediately(e)
      if (vertical.stateChanged || before !== this.scrollY) this.markNeedsPaint()
    } else if (horizontal.handled) {
      const before = this.scrollX
      if (horizontal.scrollOffset !== undefined) {
        this._scrollX.setOffset(horizontal.scrollOffset, {
          viewportSize: this._viewW,
          contentSize: this._contentWidth,
        })
        this._syncScrollOffset()
      }
      if (horizontal.dragStarted) this._pendingGesture.captureImmediately(e)
      if (horizontal.stateChanged || before !== this.scrollX) this.markNeedsPaint()
    } else if (e.joinGestureArena && this._canDragContent()) {
      this._resetPendingGesture()
      this._contentDragStart = e.position
      this._contentDragLast = e.position
      this._contentDragStartScrollX = this.scrollX
      this._contentDragStartScrollY = this.scrollY
      this._pendingGesture.begin(e, this)
    }
  }

  onPointerMove(e: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    if (this._pendingGesture.isPending && !this._contentDragging) {
      this._contentDragLast = e.position
      this._resolveContentDragIntent(e.position)
    }

    if (this._contentDragging) {
      this._contentDragLast = e.position
      this._applyContentDrag(e.position)
      return
    }

    if (this._vScrollbar.dragging) {
      const result = this._vScrollbarController.updatePointer(e.position, this._vScrollbarGeometry(), pointerKey(e))
      this._scrollY.setOffset(result.scrollOffset ?? this.scrollY, {
        viewportSize: this._viewH,
        contentSize: this._contentHeight,
      })
      this._syncScrollOffset()
    } else if (this._hScrollbar.dragging) {
      const result = this._hScrollbarController.updatePointer(e.position, this._hScrollbarGeometry(), pointerKey(e))
      this._scrollX.setOffset(result.scrollOffset ?? this.scrollX, {
        viewportSize: this._viewW,
        contentSize: this._contentWidth,
      })
      this._syncScrollOffset()
    } else {
      const changedV = this._showVBar
        ? this._vScrollbarController.updateHover(e.position, this._vScrollbarGeometry())
        : this._vScrollbarController.clearHover()
      const changedH = this._showHBar
        ? this._hScrollbarController.updateHover(e.position, this._hScrollbarGeometry())
        : this._hScrollbarController.clearHover()
      if (changedV || changedH) this.markNeedsPaint()
    }
  }

  onPointerUp(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    const wasDragging = this._vScrollbar.dragging || this._hScrollbar.dragging
    const wasContentDragging = this._contentDragging
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => {
        this._vScrollbarController.endPointer(e.position, this._vScrollbarGeometry(), pointerKey(e))
        this._hScrollbarController.endPointer(e.position, this._hScrollbarGeometry(), pointerKey(e))
      },
      () => {
        this._contentDragging = false
        this._contentDragStart = undefined
        this._contentDragLast = undefined
      },
      () => {
        if (wasDragging || wasContentDragging) this.markNeedsPaint()
      },
    )
  }

  onPointerCancel(e: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(e)) return
    const hadState = this._vScrollbar.dragging || this._hScrollbar.dragging ||
      this._vScrollbar.hovered || this._hScrollbar.hovered || this._contentDragging
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => {
        this._vScrollbarController.cancelPointer(pointerKey(e))
        this._hScrollbarController.cancelPointer(pointerKey(e))
      },
      () => {
        this._contentDragging = false
        this._contentDragStart = undefined
        this._contentDragLast = undefined
      },
      () => { if (hadState) this.markNeedsPaint() },
    )
  }

  onPointerLeave(_e: PointerEvent): void {
    const changedV = this._vScrollbarController.clearHover()
    const changedH = this._hScrollbarController.clearHover()
    if (changedV || changedH) this.markNeedsPaint()
  }

  acceptGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.accept(pointerId, pointerType)) return
    this._contentDragging = true
    const pos = this._contentDragLast ?? this._contentDragStart
    if (pos) this._applyContentDrag(pos)
  }

  rejectGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.reject(pointerId, pointerType)) return
    this._contentDragging = false
    this._contentDragStart = undefined
    this._contentDragLast = undefined
  }

  private _canDragContent(): boolean {
    return ((this.direction === 'vertical' || this.direction === 'both') && this._contentHeight > this._viewH) ||
      ((this.direction === 'horizontal' || this.direction === 'both') && this._contentWidth > this._viewW)
  }

  private _resolveContentDragIntent(position: Offset): void {
    if (!this._pendingGesture.isPending || !this._contentDragStart) return
    const dx = position.x - this._contentDragStart.x
    const dy = position.y - this._contentDragStart.y
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)
    if (Math.max(ax, ay) < DRAG_SLOP) return

    if (this.direction === 'vertical') {
      this._pendingGesture.resolve(ay >= ax ? 'accepted' : 'rejected')
    } else if (this.direction === 'horizontal') {
      this._pendingGesture.resolve(ax >= ay ? 'accepted' : 'rejected')
    } else {
      this._pendingGesture.resolve('accepted')
    }
  }

  private _applyContentDrag(position: Offset): void {
    if (!this._contentDragStart) return
    const dx = position.x - this._contentDragStart.x
    const dy = position.y - this._contentDragStart.y
    if (this.direction === 'horizontal' || this.direction === 'both') {
      this._scrollX.setOffset(this._contentDragStartScrollX - dx, {
        viewportSize: this._viewW,
        contentSize: this._contentWidth,
      })
    }
    if (this.direction === 'vertical' || this.direction === 'both') {
      this._scrollY.setOffset(this._contentDragStartScrollY - dy, {
        viewportSize: this._viewH,
        contentSize: this._contentHeight,
      })
    }
    this._syncScrollOffset()
  }

  private _resetPendingGesture(): void {
    this._pendingGesture.resetPending()
    this._contentDragStart = undefined
    this._contentDragLast = undefined
  }

  // 滚轮事件
  onWheel(e: WheelPointerEvent): boolean {
    if (!this.hitTest(e.position)) return false
    const beforeX = this.scrollX
    const beforeY = this.scrollY
    const speed = 40
    if (this.direction === 'both') {
      if (e.deltaX !== 0) this._scrollX.scrollBy(e.deltaX > 0 ? speed : -speed, { viewportSize: this._viewW, contentSize: this._contentWidth })
      if (e.deltaY !== 0) this._scrollY.scrollBy(e.deltaY > 0 ? speed : -speed, { viewportSize: this._viewH, contentSize: this._contentHeight })
    } else if (this.direction === 'horizontal') {
      if (e.deltaX !== 0 || e.deltaY !== 0) {
        this._scrollX.scrollBy(e.deltaX !== 0 ? (e.deltaX > 0 ? speed : -speed) : (e.deltaY > 0 ? speed : -speed), { viewportSize: this._viewW, contentSize: this._contentWidth })
      }
    } else {
      if (e.deltaY !== 0) this._scrollY.scrollBy(e.deltaY > 0 ? speed : -speed, { viewportSize: this._viewH, contentSize: this._contentHeight })
    }
    this._clampScroll()
    if (this.scrollX === beforeX && this.scrollY === beforeY) return this._canContainWheel(e)
    this._syncScrollOffset()
    return true
  }

  private _canContainWheel(e: WheelPointerEvent): boolean {
    const canScrollX = this._contentWidth > this._viewW
    const canScrollY = this._contentHeight > this._viewH
    if (this.direction === 'horizontal') return canScrollX && (e.deltaX !== 0 || e.deltaY !== 0)
    if (this.direction === 'vertical') return canScrollY && e.deltaY !== 0
    return (canScrollX && e.deltaX !== 0) || (canScrollY && e.deltaY !== 0)
  }

  dispose(): void {
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => {
        this._vScrollbar.dragging = false
        this._hScrollbar.dragging = false
        this._vScrollbar.hovered = false
        this._hScrollbar.hovered = false
      },
      () => {
        this._contentDragging = false
        this._contentDragStart = undefined
        this._contentDragLast = undefined
      },
      () => super.dispose(),
      () => { this.child = undefined },
    )
  }
}
