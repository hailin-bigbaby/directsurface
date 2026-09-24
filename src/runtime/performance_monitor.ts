import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { rgba } from '../theme/theme'
import { paintFramePerformanceTimelineChart } from '../widgets/charts/performance_timeline_chart'
import type { Offset } from '../core/render_object'
import type { PointerEvent } from '../gestures/hit_test'
import { pointerKey, type PointerKey } from '../gestures/pointer_identity'

export type PerformanceOverlayPosition = 'top-left' | 'top-right'

export interface RuntimeFramePerformanceSample {
  seq: number
  totalMs: number
  layoutMs: number
  paintMs: number
  contentPaintMs?: number
  transientPaintMs?: number
  compositeMs: number
  layoutNeeded: boolean
  rootCount: number
  layerCount: number
}

export interface RuntimePerformanceDebugState {
  visible: boolean
  minimized: boolean
  sampleCount: number
  latest?: RuntimeFramePerformanceSample
  averageTotalMs: number
  slowFrameCount: number
  bounds: RuntimePerformanceOverlayRect
  headerRect: RuntimePerformanceOverlayRect
  toggleButtonRect: RuntimePerformanceOverlayRect
}

export interface RuntimePerformanceMonitorOptions {
  enabled?: boolean
  visible?: boolean
  position?: PerformanceOverlayPosition
  maxSamples?: number
  slowFrameThresholdMs?: number
  onInvalidate?: () => void
}

export interface RuntimePerformanceOverlayRect {
  x: number
  y: number
  width: number
  height: number
}

interface RuntimePerformanceOverlayLayout {
  bounds: RuntimePerformanceOverlayRect
  headerRect: RuntimePerformanceOverlayRect
  toggleButtonRect: RuntimePerformanceOverlayRect
  chartRect: RuntimePerformanceOverlayRect
}

interface RuntimePerformanceViewport {
  x?: number
  y?: number
  width: number
  height: number
}

export class RuntimePerformanceMonitor {
  readonly preserveFocus = true

  private readonly _samples: RuntimeFramePerformanceSample[] = []
  private readonly _maxSamples: number
  private readonly _slowFrameThresholdMs: number
  private readonly _onInvalidate?: () => void
  private _enabled: boolean
  private _visible: boolean
  private _position: PerformanceOverlayPosition
  private _minimized = false
  private _viewport: RuntimePerformanceViewport = { width: 0, height: 0 }
  private _customOffset?: Offset
  private _dragging = false
  private _dragPointerKey?: PointerKey
  private _dragStartPointer?: Offset
  private _dragStartOffset?: Offset
  private _handledPointerDown?: { pointerKey: PointerKey; x: number; y: number }

  constructor(options: RuntimePerformanceMonitorOptions = {}) {
    this._visible = options.visible ?? false
    this._enabled = this._visible || (options.enabled ?? false)
    this._position = options.position ?? 'top-right'
    this._maxSamples = Math.max(10, options.maxSamples ?? 120)
    this._slowFrameThresholdMs = Math.max(1, options.slowFrameThresholdMs ?? 16.7)
    this._onInvalidate = options.onInvalidate
  }

  get enabled(): boolean {
    return this._enabled
  }

  set enabled(value: boolean) {
    this._enabled = value || this._visible
  }

  get visible(): boolean {
    return this._visible
  }

  set visible(value: boolean) {
    this._visible = value
    if (value) this._enabled = true
  }

  get minimized(): boolean {
    return this._minimized
  }

  set minimized(value: boolean) {
    if (this._minimized === value) return
    this._minimized = value
    this._customOffset = this._clampOffset(this._layout().bounds)
    this._invalidate()
  }

  get position(): PerformanceOverlayPosition {
    return this._position
  }

  set position(value: PerformanceOverlayPosition) {
    this._position = value
    this._customOffset = undefined
    this._invalidate()
  }

  setViewport(viewport: RuntimePerformanceViewport): void {
    this._viewport = {
      x: viewport.x ?? 0,
      y: viewport.y ?? 0,
      width: Math.max(0, viewport.width),
      height: Math.max(0, viewport.height),
    }
    if (this._customOffset) {
      this._customOffset = this._clampOffset(this._layout().bounds)
    }
  }

  recordFrame(sample: RuntimeFramePerformanceSample): void {
    this._samples.push(sample)
    if (this._samples.length > this._maxSamples) {
      this._samples.splice(0, this._samples.length - this._maxSamples)
    }
  }

  debugState(): RuntimePerformanceDebugState {
    const total = this._samples.reduce((sum, sample) => sum + sample.totalMs, 0)
    const layout = this._layout()
    return {
      visible: this._visible,
      minimized: this._minimized,
      sampleCount: this._samples.length,
      latest: this._samples.at(-1),
      averageTotalMs: this._samples.length > 0 ? total / this._samples.length : 0,
      slowFrameCount: this._samples.filter(sample => sample.totalMs >= this._slowFrameThresholdMs).length,
      bounds: layout.bounds,
      headerRect: layout.headerRect,
      toggleButtonRect: layout.toggleButtonRect,
    }
  }

  debugSamples(limit = this._maxSamples): RuntimeFramePerformanceSample[] {
    const normalizedLimit = Math.max(0, Math.floor(limit))
    if (normalizedLimit === 0) return []
    return this._samples.slice(-normalizedLimit).map(sample => ({ ...sample }))
  }

  hitTest(position: Offset): boolean {
    if (!this._visible) return false
    const layout = this._layout()
    if (this._minimized) return rectContains(layout.bounds, position)
    return rectContains(layout.headerRect, position) || rectContains(layout.toggleButtonRect, position)
  }

  onPointerDown(event: PointerEvent): boolean {
    if (!this._visible || event.button !== 0 && event.button !== undefined) return false
    if (this._dragPointerKey !== undefined) {
      this._rememberHandledPointerDown(event)
      return true
    }
    const layout = this._layout()
    if (rectContains(layout.toggleButtonRect, event.position)) {
      this._rememberHandledPointerDown(event)
      this.minimized = !this._minimized
      return true
    }
    const dragArea = this._minimized ? layout.bounds : layout.headerRect
    if (!rectContains(dragArea, event.position)) return false
    this._rememberHandledPointerDown(event)
    this._dragging = true
    this._dragPointerKey = pointerKey(event)
    this._dragStartPointer = event.position
    this._dragStartOffset = { x: layout.bounds.x, y: layout.bounds.y }
    return true
  }

  onPointerMove(event: PointerEvent): boolean {
    if (!this._dragging || !this._dragStartPointer || !this._dragStartOffset) return true
    if (this._dragPointerKey !== pointerKey(event)) return true
    const dx = event.position.x - this._dragStartPointer.x
    const dy = event.position.y - this._dragStartPointer.y
    const current = this._layout().bounds
    const next = this._clampOffset({
      ...current,
      x: this._dragStartOffset.x + dx,
      y: this._dragStartOffset.y + dy,
    })
    if (!this._customOffset || this._customOffset.x !== next.x || this._customOffset.y !== next.y) {
      this._customOffset = next
      this._invalidate()
    }
    return true
  }

  onPointerUp(event: PointerEvent): boolean {
    if (
      this._dragPointerKey !== undefined &&
      this._dragPointerKey !== pointerKey(event)
    ) {
      return true
    }
    this._endDrag()
    return true
  }

  onPointerCancel(event: PointerEvent): boolean {
    if (
      this._dragPointerKey !== undefined &&
      this._dragPointerKey !== pointerKey(event)
    ) {
      return true
    }
    this._endDrag()
    return true
  }

  consumeHandledPointerDown(event: PointerEvent): boolean {
    const handled = this._handledPointerDown
    if (!handled) return false
    const matches = handled.pointerKey === pointerKey(event) &&
      handled.x === event.position.x &&
      handled.y === event.position.y
    if (matches) this._handledPointerDown = undefined
    return matches
  }

  paint(context: PaintContext, viewport: RuntimePerformanceViewport): void {
    if (!this._visible) return

    this.setViewport(viewport)
    const dl = new DrawList(context)
    const layout = this._layout()
    const { x, y, width, height } = layout.bounds
    const latest = this._samples.at(-1)
    const state = this.debugState()
    const fontFamily = context.theme.fontFamily

    dl.fillRect(x, y, width, height, rgba(14, 18, 28, 0.72), 8)
    dl.strokeRect(x, y, width, height, rgba(255, 255, 255, 0.18), 1, 8)
    dl.fillText(this._minimized ? 'Perf' : 'Performance', x + 10, y + 15, rgba(255, 255, 255, 0.94), 12, fontFamily, 'left', 'middle', 600)

    const totalText = latest
      ? `${formatMs(latest.totalMs)}  avg ${formatMs(state.averageTotalMs)}`
      : 'waiting for frame'
    dl.fillText(totalText, layout.toggleButtonRect.x - 7, y + 15, rgba(255, 255, 255, 0.88), 11, fontFamily, 'right', 'middle')
    this._paintToggleButton(dl, context, layout.toggleButtonRect)

    if (this._minimized) return

    const detail = latest
      ? `layout ${formatMs(latest.layoutMs)}  main ${formatMs(latest.contentPaintMs ?? 0)}  transient ${formatMs(latest.transientPaintMs ?? 0)}`
      : 'layout / paint / composite'
    dl.fillText(detail, x + 10, y + 34, rgba(218, 226, 240, 0.9), 11, fontFamily, 'left', 'middle')
    dl.fillText(`slow ${state.slowFrameCount}/${state.sampleCount}`, x + width - 10, y + 34, rgba(218, 226, 240, 0.78), 11, fontFamily, 'right', 'middle')

    paintFramePerformanceTimelineChart(
      dl,
      context,
      layout.chartRect,
      this._samples,
      { frameBudgetMs: this._slowFrameThresholdMs, maxSamples: 80 },
    )

    const footer = latest
      ? `${latest.rootCount} roots  ${latest.layerCount} layers  #${latest.seq}`
      : 'no samples'
    dl.fillText(footer, x + 10, y + height - 12, rgba(218, 226, 240, 0.74), 10, fontFamily, 'left', 'middle')
  }

  private _paintToggleButton(
    dl: DrawList,
    context: PaintContext,
    rect: RuntimePerformanceOverlayRect,
  ): void {
    dl.fillRect(rect.x, rect.y, rect.width, rect.height, rgba(255, 255, 255, 0.08), 5)
    dl.strokeRect(rect.x, rect.y, rect.width, rect.height, rgba(255, 255, 255, 0.2), 1, 5)
    dl.fillText(
      this._minimized ? '+' : '-',
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rgba(255, 255, 255, 0.9),
      13,
      context.theme.fontFamily,
      'center',
      'middle',
      600,
    )
  }

  private _layout(): RuntimePerformanceOverlayLayout {
    const viewport = this._viewport
    const width = this._minimized
      ? Math.min(180, Math.max(132, viewport.width - 24))
      : Math.min(330, Math.max(220, viewport.width - 24))
    const height = this._minimized ? 34 : 154
    const defaultX = this._position === 'top-left'
      ? (viewport.x ?? 0) + 12
      : Math.max((viewport.x ?? 0) + 12, (viewport.x ?? 0) + viewport.width - width - 12)
    const defaultY = (viewport.y ?? 0) + 12
    const offset = this._customOffset
      ? this._clampOffset({ x: this._customOffset.x, y: this._customOffset.y, width, height })
      : { x: defaultX, y: defaultY }
    const bounds = { x: offset.x, y: offset.y, width, height }
    const headerRect = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: Math.min(34, bounds.height),
    }
    const toggleButtonRect = {
      x: bounds.x + bounds.width - 28,
      y: bounds.y + 6,
      width: 20,
      height: 20,
    }
    const chartRect = {
      x: bounds.x + 10,
      y: bounds.y + 50,
      width: bounds.width - 20,
      height: 72,
    }
    return { bounds, headerRect, toggleButtonRect, chartRect }
  }

  private _clampOffset(rect: RuntimePerformanceOverlayRect): Offset {
    const margin = 6
    const viewportX = this._viewport.x ?? 0
    const viewportY = this._viewport.y ?? 0
    const minX = viewportX + margin
    const minY = viewportY + margin
    const maxX = Math.max(minX, viewportX + this._viewport.width - rect.width - margin)
    const maxY = Math.max(minY, viewportY + this._viewport.height - rect.height - margin)
    return {
      x: clamp(rect.x, minX, maxX),
      y: clamp(rect.y, minY, maxY),
    }
  }

  private _endDrag(): void {
    this._dragging = false
    this._dragPointerKey = undefined
    this._dragStartPointer = undefined
    this._dragStartOffset = undefined
  }

  private _rememberHandledPointerDown(event: PointerEvent): void {
    this._handledPointerDown = {
      pointerKey: pointerKey(event),
      x: event.position.x,
      y: event.position.y,
    }
  }

  private _invalidate(): void {
    this._onInvalidate?.()
  }
}

function formatMs(value: number): string {
  return `${Math.round(value * 10) / 10}ms`
}

function rectContains(rect: RuntimePerformanceOverlayRect, position: Offset): boolean {
  return position.x >= rect.x &&
    position.x <= rect.x + rect.width &&
    position.y >= rect.y &&
    position.y <= rect.y + rect.height
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
