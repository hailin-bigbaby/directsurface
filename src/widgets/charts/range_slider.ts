import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../../core/render_object'
import type { GestureArenaMember } from '../../gestures/gesture_arena'
import { PendingPointerGesture } from '../../gestures/pending_pointer_gesture'
import type { InteractiveRenderObject, PointerEvent } from '../../gestures/recognizers'
import { isPrimaryPointerButton } from '../../gestures/hit_test'
import type { RenderBoxOptions } from '../../layout/render_box'
import { DrawList } from '../../rendering/draw_list'
import type { PaintContext } from '../../rendering/paint_context'
import { colorToCSS } from '../../theme/theme'
import { FocusableControl, paintFocusRing } from '../focusable_control'
import { chartColor, withAlpha } from './chart_palette'
import { isChartReady, paintChartState, resolveChartState } from './chart_state'
import {
  clampChartDomain,
  collectYValues,
  createLinearScale,
  normalizeLinearDomain,
  sanitizeChartDomain,
} from './chart_scale'
import {
  cloneChartSeries,
  createChartSeriesDatums,
  decimateMinMaxDatums,
  resolveChartAxisType,
  resolveFullChartXDomain,
} from './chart_data'
import type {
  ChartAxisType,
  ChartDataState,
  ChartDomain,
  ChartPlotRect,
  ChartSeries,
  ChartStateDebugState,
  ChartViewportChangeEvent,
  ChartViewportChangeReason,
} from './chart_types'

const DRAG_SLOP = 4
const HANDLE_HIT_WIDTH = 12
const HANDLE_WIDTH = 6

type RangeSliderInteraction = 'none' | 'leftHandle' | 'rightHandle' | 'window'
type RangeSliderHitTarget = RangeSliderInteraction | 'track'

export interface RenderChartRangeSliderOptions extends RenderBoxOptions {
  series: ChartSeries[]
  viewport?: ChartDomain
  fullDomain?: ChartDomain
  xAxisType?: ChartAxisType
  minSpan?: number
  maxSpan?: number
  showPreview?: boolean
  dataState?: ChartDataState
  emptyMessage?: string
  loadingMessage?: string
  errorMessage?: string
  onViewportChange?: (event: ChartViewportChangeEvent) => void
}

export interface ChartRangeSliderDebugState {
  fullDomain: ChartDomain
  viewport: ChartDomain
  track: ChartPlotRect
  leftHandleX: number
  rightHandleX: number
  previewPoints: Array<{ x: number; y: number; value: number }>
  interaction: RangeSliderInteraction
  state: ChartStateDebugState
}

interface PreviewLayoutPoint {
  x: number
  y: number
  value: number
}

interface PreviewSeriesLayout {
  seriesIndex: number
  points: PreviewLayoutPoint[]
}

export class RenderChartRangeSlider extends FocusableControl implements InteractiveRenderObject, GestureArenaMember {
  static override debugTypeName = 'RenderChartRangeSlider'
  readonly preventsPointerActivationOnAccept = true
  series: ChartSeries[]
  xAxisType: ChartAxisType
  minSpan?: number
  maxSpan?: number
  showPreview: boolean
  dataState?: ChartDataState
  emptyMessage?: string
  loadingMessage?: string
  errorMessage?: string
  onViewportChange?: (event: ChartViewportChangeEvent) => void

  private _explicitFullDomain?: ChartDomain
  private _fullDomain: ChartDomain = { min: 0, max: 1 }
  private _viewport: ChartDomain = { min: 0, max: 1 }
  private _track: ChartPlotRect = { x: 0, y: 0, width: 0, height: 0 }
  private _previewSeries: PreviewSeriesLayout[] = []
  private _resolvedAxisType: ChartAxisType = 'linear'
  private readonly _pendingGesture = new PendingPointerGesture()
  private _dragging = false
  private _dragStart?: Offset
  private _lastPointerPosition?: Offset
  private _dragStartViewport?: ChartDomain
  private _pressedTarget: RangeSliderHitTarget = 'none'
  private _interactionTarget: RangeSliderInteraction = 'none'
  private _trackJumped = false

  constructor(options: RenderChartRangeSliderOptions) {
    super({ ...options, height: options.height ?? 64 })
    this.series = cloneChartSeries(options.series)
    this.xAxisType = options.xAxisType ?? 'auto'
    this.minSpan = options.minSpan
    this.maxSpan = options.maxSpan
    this.showPreview = options.showPreview ?? true
    this.dataState = options.dataState
    this.emptyMessage = options.emptyMessage
    this.loadingMessage = options.loadingMessage
    this.errorMessage = options.errorMessage
    this.onViewportChange = options.onViewportChange
    this._explicitFullDomain = options.fullDomain ? { ...options.fullDomain } : undefined
    this._fullDomain = this._resolveFullDomain()
    this._viewport = options.viewport
      ? this._clampViewport(options.viewport)
      : { ...this._fullDomain }
  }

  setSeries(series: ChartSeries[]): void {
    this.series = cloneChartSeries(series)
    this._fullDomain = this._resolveFullDomain()
    this._viewport = this._clampViewport(this._viewport)
    this.markNeedsLayout()
  }

  setViewport(viewport: ChartDomain, reason: ChartViewportChangeReason = 'api'): void {
    this._setViewport(viewport, reason)
  }

  setFullDomain(domain?: ChartDomain): void {
    this._explicitFullDomain = domain ? { ...domain } : undefined
    const previousViewport = { ...this._viewport }
    this._fullDomain = this._resolveFullDomain()
    this._viewport = this._clampViewport(this._viewport)
    if (!sameDomain(previousViewport, this._viewport)) this._notifyViewportChange('api')
    this.markNeedsLayout()
  }

  getViewport(): ChartDomain {
    return { ...this._viewport }
  }

  getFullDomain(): ChartDomain {
    this._fullDomain = this._resolveFullDomain()
    return { ...this._fullDomain }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? 260 : constraints.maxWidth
    this.size = constrainSize(constraints, { width, height: this.height ?? 64 })
    const insetX = this.size.width < 48 ? 4 : 10
    const insetY = this.size.height < 34 ? 6 : 10
    this._track = {
      x: insetX,
      y: insetY,
      width: Math.max(20, this.size.width - insetX * 2),
      height: Math.max(16, this.size.height - insetY * 2),
    }
    this._computeLayout()
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const track = this._offsetTrack(offset)
    const theme = context.theme
    const leftX = offset.x + this._domainToX(this._viewport.min)
    const rightX = offset.x + this._domainToX(this._viewport.max)

    dl.fillRect(track.x, track.y, track.width, track.height, withAlpha(theme.surfaceControl, 0.95), 4)
    dl.strokeRect(track.x, track.y, track.width, track.height, theme.borderSubtle, 1, 4)
    const state = this._chartState()
    if (!isChartReady(state)) {
      paintChartState(dl, context, track, state)
      if (this.isFocused && !this.isDisabled) {
        paintFocusRing(dl, theme.focusBorder, offset.x, offset.y, this.size.width, this.size.height, 5)
      }
      return
    }
    if (this.showPreview) this._paintPreview(context, offset)

    const mask = withAlpha(theme.surfacePanel, 0.58)
    if (leftX > track.x) dl.fillRect(track.x, track.y, leftX - track.x, track.height, mask, 4)
    if (rightX < track.x + track.width) dl.fillRect(rightX, track.y, track.x + track.width - rightX, track.height, mask, 4)

    const selectedWidth = Math.max(0, rightX - leftX)
    if (selectedWidth > 0) {
      dl.fillRect(leftX, track.y, selectedWidth, track.height, withAlpha(theme.selectionStrong, 0.72), 3)
      dl.strokeRect(leftX, track.y, selectedWidth, track.height, withAlpha(theme.accentPrimary, 0.82), 1, 3)
    }

    this._paintHandle(dl, context, leftX, track.y, track.height, this._interactionTarget === 'leftHandle')
    this._paintHandle(dl, context, rightX, track.y, track.height, this._interactionTarget === 'rightHandle')

    if (this.isFocused && !this.isDisabled) {
      paintFocusRing(dl, theme.focusBorder, offset.x, offset.y, this.size.width, this.size.height, 5)
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    if (!isPrimaryPointerButton(event)) return
    if (this.isDisabled || !this.hitTest(event.position)) return
    if (!isChartReady(this._chartState())) return
    const local = this._toLocal(event.position)
    const target = this._hitTarget(local)
    if (target === 'none') return
    this.requestFocus()
    this._resetPointerState()
    this._pressedTarget = target
    this._dragStart = event.position
    this._lastPointerPosition = event.position
    this._dragStartViewport = this.getViewport()
    this._trackJumped = false

    if (event.joinGestureArena) {
      this._pendingGesture.begin(event, this)
      return
    }

    this._pendingGesture.captureImmediately(event)
    this._beginAcceptedInteraction(event.position)
  }

  onPointerMove(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    if (this.isDisabled) return
    if (!isChartReady(this._chartState())) {
      if (this._interaction.leaveHover()) this.markNeedsPaint()
      return
    }
    const isHovered = this.hitTest(event.position) && this._hitTarget(this._toLocal(event.position)) !== 'none'
    const hoverChanged = isHovered
      ? this._interaction.enterHover()
      : this._interaction.leaveHover()
    if (hoverChanged) this.markNeedsPaint()

    if (this._pendingGesture.isPending && !this._dragging) {
      this._lastPointerPosition = event.position
      this._resolveDragIntent(event.position)
      return
    }

    if (!this._dragging) return
    this._lastPointerPosition = event.position
    this._applyDrag(event.position)
  }

  onPointerUp(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    if (!isPrimaryPointerButton(event)) return
    this._lastPointerPosition = event.position
    const shouldAccept = this._pendingGesture.isPending && !this._dragging
    this._pendingGesture.resolveTerminal(
      shouldAccept ? 'accepted' : 'rejected',
      () => { this._interaction.release() },
      () => this._resetPointerState(),
      () => this.markNeedsPaint(),
    )
  }

  onPointerCancel(event: PointerEvent): void {
    if (this._pendingGesture.hasOwner && !this._pendingGesture.owns(event)) return
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => { this._interaction.release() },
      () => { this._interaction.leaveHover() },
      () => this._resetPointerState(),
      () => this.markNeedsPaint(),
    )
  }

  onPointerLeave(_event: PointerEvent): void {
    if (!this._interaction.leaveHover()) return
    this.markNeedsPaint()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isDisabled) return false
    if (!isChartReady(this._chartState())) return false
    const span = this._viewport.max - this._viewport.min
    if (span <= 0) return false
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        this._setViewport({
          min: this._viewport.min - span * 0.1,
          max: this._viewport.max - span * 0.1,
        }, 'rangePan')
        return true
      case 'ArrowRight':
        event.preventDefault()
        this._setViewport({
          min: this._viewport.min + span * 0.1,
          max: this._viewport.max + span * 0.1,
        }, 'rangePan')
        return true
      case 'Home':
        event.preventDefault()
        this._setViewport({
          min: this._fullDomain.min,
          max: this._fullDomain.min + span,
        }, 'rangeJump')
        return true
      case 'End':
        event.preventDefault()
        this._setViewport({
          min: this._fullDomain.max - span,
          max: this._fullDomain.max,
        }, 'rangeJump')
        return true
      default:
        return false
    }
  }

  acceptGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.accept(pointerId, pointerType)) return
    const position = this._lastPointerPosition ?? this._dragStart
    if (!position) return
    this._beginAcceptedInteraction(position)
  }

  rejectGesture(pointerId: number, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse'): void {
    if (!this._pendingGesture.reject(pointerId, pointerType)) return
    this._interaction.release()
    this._resetPointerState()
    this.markNeedsPaint()
  }

  debugState(): ChartRangeSliderDebugState {
    return {
      fullDomain: { ...this._fullDomain },
      viewport: { ...this._viewport },
      track: { ...this._track },
      leftHandleX: this._domainToX(this._viewport.min),
      rightHandleX: this._domainToX(this._viewport.max),
      previewPoints: this._previewSeries.flatMap(series => series.points.map(point => ({ ...point }))),
      interaction: this._interactionTarget,
      state: this._chartState(),
    }
  }

  dispose(): void {
    this._pendingGesture.resolveTerminal(
      'rejected',
      () => this._resetPointerState(),
      () => { this.onViewportChange = undefined },
      () => super.dispose(),
    )
  }

  private _computeLayout(): void {
    this._resolvedAxisType = resolveChartAxisType(this.series, this.xAxisType)
    this._fullDomain = this._resolveFullDomain()
    this._viewport = this._clampViewport(this._viewport)
    this._previewSeries = this.showPreview ? this._createPreviewSeries() : []
  }

  private _createPreviewSeries(): PreviewSeriesLayout[] {
    const yDomain = normalizeLinearDomain(collectYValues(this.series), { paddingRatio: 0.1 })
    const xScale = createLinearScale(this._fullDomain.min, this._fullDomain.max, this._track.x, this._track.x + this._track.width)
    const yScale = createLinearScale(yDomain.min, yDomain.max, this._track.y + this._track.height - 4, this._track.y + 4)
    const limit = Math.max(8, Math.floor(this._track.width * 2))
    const bucketCount = Math.max(1, Math.floor(this._track.width))

    return this.series.map((series, seriesIndex) => {
      const datums = createChartSeriesDatums(series, seriesIndex)
      const previewDatums = datums.length > limit
        ? decimateMinMaxDatums(datums, this._fullDomain, bucketCount)
        : datums
      return {
        seriesIndex,
        points: previewDatums.map(datum => ({
          x: xScale.map(datum.xValue),
          y: yScale.map(datum.yValue),
          value: datum.yValue,
        })),
      }
    })
  }

  private _chartState(): ChartStateDebugState {
    return resolveChartState(
      this,
      this.series.some((series, seriesIndex) => createChartSeriesDatums(series, seriesIndex).length > 0),
    )
  }

  private _paintPreview(context: PaintContext, offset: Offset): void {
    const ctx = context.ctx
    const absoluteTrack = this._offsetTrack(offset)
    ctx.save()
    ctx.beginPath()
    ctx.rect(absoluteTrack.x, absoluteTrack.y, absoluteTrack.width, absoluteTrack.height)
    ctx.clip()
    for (const series of this._previewSeries) {
      if (series.points.length === 0) continue
      const color = chartColor(context.theme, series.seriesIndex, this.series[series.seriesIndex]?.color)
      ctx.beginPath()
      series.points.forEach((point, index) => {
        const x = offset.x + point.x
        const y = offset.y + point.y
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.strokeStyle = colorToCSS(withAlpha(color, 0.82))
      ctx.lineWidth = 1.4
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke()
    }
    ctx.restore()
  }

  private _paintHandle(
    dl: DrawList,
    context: PaintContext,
    centerX: number,
    trackY: number,
    trackHeight: number,
    active: boolean,
  ): void {
    const theme = context.theme
    const handleX = centerX - HANDLE_WIDTH / 2
    const handleY = trackY - 4
    const handleHeight = trackHeight + 8
    const bg = active ? theme.accentPrimaryHover : theme.accentPrimary
    dl.fillRect(handleX, handleY, HANDLE_WIDTH, handleHeight, bg, 3)
    dl.strokeRect(handleX, handleY, HANDLE_WIDTH, handleHeight, withAlpha(theme.surfacePanel, 0.75), 1, 3)
    const gripColor = withAlpha(theme.textOnAccent, 0.72)
    dl.line(centerX, handleY + 8, centerX, handleY + handleHeight - 8, gripColor, 1)
  }

  private _beginAcceptedInteraction(position: Offset): void {
    const target = this._pressedTarget
    if (target === 'track') {
      this._interaction.press()
      this._jumpTo(position)
      this._trackJumped = true
      this._interaction.release()
      this.markNeedsPaint()
      return
    }
    if (target === 'none') return
    this._dragging = true
    this._interactionTarget = target
    this._interaction.press()
    this._applyDrag(position)
    this.markNeedsPaint()
  }

  private _resolveDragIntent(position: Offset): void {
    if (!this._dragStart) return
    const dx = position.x - this._dragStart.x
    const dy = position.y - this._dragStart.y
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)
    if (Math.max(ax, ay) < DRAG_SLOP) return
    this._pendingGesture.resolve(ax >= ay ? 'accepted' : 'rejected')
  }

  private _applyDrag(position: Offset): void {
    if (!this._dragStart || !this._dragStartViewport || this._track.width <= 0) return
    const local = this._toLocal(position)
    if (this._interactionTarget === 'leftHandle') {
      this._resizeLeft(this._xToDomain(local.x))
    } else if (this._interactionTarget === 'rightHandle') {
      this._resizeRight(this._xToDomain(local.x))
    } else if (this._interactionTarget === 'window') {
      const dx = position.x - this._dragStart.x
      const fullSpan = this._fullDomain.max - this._fullDomain.min
      const delta = (dx / this._track.width) * fullSpan
      this._setViewport({
        min: this._dragStartViewport.min + delta,
        max: this._dragStartViewport.max + delta,
      }, 'rangePan')
    }
  }

  private _resizeLeft(value: number): void {
    if (!this._dragStartViewport) return
    const { minSpan, maxSpan } = this._effectiveSpanBounds()
    const max = this._dragStartViewport.max
    let min = Math.min(value, max - minSpan)
    min = Math.max(this._fullDomain.min, min)
    if (max - min > maxSpan) min = max - maxSpan
    this._setViewport({ min, max }, 'rangeResize')
  }

  private _resizeRight(value: number): void {
    if (!this._dragStartViewport) return
    const { minSpan, maxSpan } = this._effectiveSpanBounds()
    const min = this._dragStartViewport.min
    let max = Math.max(value, min + minSpan)
    max = Math.min(this._fullDomain.max, max)
    if (max - min > maxSpan) max = min + maxSpan
    this._setViewport({ min, max }, 'rangeResize')
  }

  private _jumpTo(position: Offset): void {
    if (this._trackJumped) return
    const span = this._viewport.max - this._viewport.min
    const center = this._xToDomain(this._toLocal(position).x)
    this._setViewport({
      min: center - span / 2,
      max: center + span / 2,
    }, 'rangeJump')
  }

  private _setViewport(viewport: ChartDomain, reason: ChartViewportChangeReason): boolean {
    this._fullDomain = this._resolveFullDomain()
    const next = this._clampViewport(viewport)
    if (sameDomain(this._viewport, next)) return false
    this._viewport = next
    this._notifyViewportChange(reason)
    this.markNeedsLayout()
    return true
  }

  private _resolveFullDomain(): ChartDomain {
    const autoDomain = resolveFullChartXDomain(this.series)
    return this._explicitFullDomain
      ? sanitizeChartDomain(this._explicitFullDomain, autoDomain)
      : autoDomain
  }

  private _clampViewport(viewport: ChartDomain): ChartDomain {
    return clampChartDomain(viewport, this._fullDomain, {
      minSpan: this.minSpan,
      maxSpan: this.maxSpan,
    })
  }

  private _effectiveSpanBounds(): { minSpan: number; maxSpan: number } {
    const fullSpan = Math.max(Number.EPSILON, this._fullDomain.max - this._fullDomain.min)
    const minSpan = Math.min(fullSpan, Math.max(Number.EPSILON, this.minSpan ?? fullSpan / 10000, 1))
    const maxSpan = Math.min(fullSpan, Math.max(minSpan, this.maxSpan ?? fullSpan))
    return { minSpan, maxSpan }
  }

  private _notifyViewportChange(reason: ChartViewportChangeReason): void {
    this.onViewportChange?.({
      viewport: { ...this._viewport },
      fullDomain: { ...this._fullDomain },
      reason,
    })
  }

  private _hitTarget(local: Offset): RangeSliderHitTarget {
    if (!this._isInTrackBand(local)) return 'none'
    const leftX = this._domainToX(this._viewport.min)
    const rightX = this._domainToX(this._viewport.max)
    const leftDistance = Math.abs(local.x - leftX)
    const rightDistance = Math.abs(local.x - rightX)
    if (Math.min(leftDistance, rightDistance) <= HANDLE_HIT_WIDTH) {
      return leftDistance <= rightDistance ? 'leftHandle' : 'rightHandle'
    }
    if (local.x >= leftX && local.x <= rightX) return 'window'
    if (local.x >= this._track.x && local.x <= this._track.x + this._track.width) return 'track'
    return 'none'
  }

  private _isInTrackBand(local: Offset): boolean {
    return local.y >= this._track.y - 8 &&
      local.y <= this._track.y + this._track.height + 8 &&
      local.x >= this._track.x - HANDLE_HIT_WIDTH &&
      local.x <= this._track.x + this._track.width + HANDLE_HIT_WIDTH
  }

  private _domainToX(value: number): number {
    const span = this._fullDomain.max - this._fullDomain.min
    const ratio = span === 0 ? 0 : (value - this._fullDomain.min) / span
    return this._track.x + clamp01(ratio) * this._track.width
  }

  private _xToDomain(x: number): number {
    const ratio = clamp01((x - this._track.x) / Math.max(1, this._track.width))
    return this._fullDomain.min + ratio * (this._fullDomain.max - this._fullDomain.min)
  }

  private _offsetTrack(offset: Offset): ChartPlotRect {
    return {
      x: offset.x + this._track.x,
      y: offset.y + this._track.y,
      width: this._track.width,
      height: this._track.height,
    }
  }

  private _toLocal(position: Offset): Offset {
    return {
      x: position.x - this.globalOffset.x,
      y: position.y - this.globalOffset.y,
    }
  }

  private _resetPointerState(): void {
    this._pendingGesture.resetPending()
    this._dragging = false
    this._dragStart = undefined
    this._lastPointerPosition = undefined
    this._dragStartViewport = undefined
    this._pressedTarget = 'none'
    this._interactionTarget = 'none'
    this._trackJumped = false
  }

}

function sameDomain(a: ChartDomain, b: ChartDomain): boolean {
  return Math.abs(a.min - b.min) < 1e-6 && Math.abs(a.max - b.max) < 1e-6
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
