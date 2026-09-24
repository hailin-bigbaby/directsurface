// Scrollbar: 可复用滚动条工具
// ScrollbarState  — 单条滚动条的交互状态（hover / dragging）
// ScrollbarPainter — 绘制 + 命中检测 + 拖拽计算，供各组件复用

import { DrawList } from './draw_list'
import type { ScrollbarStyleTokens } from '../theme/component_styles'
import type { Offset, Rect } from '../core/render_object'

// ---- 滚动条状态 ----

export class ScrollbarState {
  hovered = false
  dragging = false
  dragStartPos = 0      // 拖拽开始时的鼠标坐标（垂直条用 y，水平条用 x）
  dragStartScroll = 0   // 拖拽开始时的 scrollOffset
}

// ---- 滑块几何计算 ----

export type ScrollbarAxis = 'horizontal' | 'vertical'

export interface ScrollbarGeometryInput {
  axis: ScrollbarAxis
  trackRect: Rect
  viewportSize: number
  contentSize: number
  scrollOffset: number
  visualThickness: number
  minThumbLength: number
  endInset: number
}

export interface ScrollbarGeometryForStateInput {
  axis: ScrollbarAxis
  trackRect: Rect
  viewportSize: number
  contentSize: number
  scrollOffset: number
  style: ScrollbarStyleTokens
  state: ScrollbarState
}

export interface ScrollbarGeometry {
  axis: ScrollbarAxis
  trackRect: Rect
  hitRect: Rect
  thumbRect: Rect
  thumbHitRect: Rect
  viewportSize: number
  contentSize: number
  scrollOffset: number
  maxScroll: number
  trackTravel: number
  thumbTravelStart: number
}

export function resolveScrollbarGeometry(input: ScrollbarGeometryInput): ScrollbarGeometry {
  const axis = input.axis
  const trackRect = normalizeRect(input.trackRect)
  const viewportSize = finiteNonNegative(input.viewportSize)
  const contentSize = finiteNonNegative(input.contentSize)
  const maxScroll = Math.max(0, contentSize - viewportSize)
  const scrollOffset = Math.max(0, Math.min(maxScroll, finite(input.scrollOffset)))
  const axisStart = axis === 'vertical' ? trackRect.y : trackRect.x
  const axisLength = axis === 'vertical' ? trackRect.height : trackRect.width
  const crossStart = axis === 'vertical' ? trackRect.x : trackRect.y
  const crossLength = axis === 'vertical' ? trackRect.width : trackRect.height
  const requestedEndInset = Math.min(axisLength / 2, finiteNonNegative(input.endInset))
  const requestedMinThumbLength = finiteNonNegative(input.minThumbLength)
  const endInset = axisLength >= requestedMinThumbLength + requestedEndInset * 2
    ? requestedEndInset
    : 0
  const usableLength = Math.max(0, axisLength - endInset * 2)
  const minThumbLength = Math.min(usableLength, requestedMinThumbLength)
  const proportionalLength = contentSize <= 0 || contentSize <= viewportSize
    ? usableLength
    : usableLength * (viewportSize / contentSize)
  const thumbLength = Math.min(usableLength, Math.max(minThumbLength, proportionalLength))
  const trackTravel = Math.max(0, usableLength - thumbLength)
  const thumbTravelStart = axisStart + endInset
  const thumbStart = thumbTravelStart + (maxScroll > 0 ? (scrollOffset / maxScroll) * trackTravel : 0)
  const visualThickness = Math.min(crossLength, finiteNonNegative(input.visualThickness))
  const visualCrossStart = crossStart + (crossLength - visualThickness) / 2
  const thumbRect = axis === 'vertical'
    ? { x: visualCrossStart, y: thumbStart, width: visualThickness, height: thumbLength }
    : { x: thumbStart, y: visualCrossStart, width: thumbLength, height: visualThickness }
  const thumbHitRect = axis === 'vertical'
    ? { x: trackRect.x, y: thumbStart, width: trackRect.width, height: thumbLength }
    : { x: thumbStart, y: trackRect.y, width: thumbLength, height: trackRect.height }
  return {
    axis,
    trackRect,
    hitRect: { ...trackRect },
    thumbRect,
    thumbHitRect,
    viewportSize,
    contentSize,
    scrollOffset,
    maxScroll,
    trackTravel,
    thumbTravelStart,
  }
}

/** Resolves the exact geometry used by painting for the current interaction state. */
export function resolveScrollbarGeometryForState(
  input: ScrollbarGeometryForStateInput,
): ScrollbarGeometry {
  return resolveScrollbarGeometry({
    axis: input.axis,
    trackRect: input.trackRect,
    viewportSize: input.viewportSize,
    contentSize: input.contentSize,
    scrollOffset: input.scrollOffset,
    visualThickness: scrollbarVisualThickness(input.style, input.state),
    minThumbLength: input.style.minThumbLength,
    endInset: input.style.endInset,
  })
}

export function scrollOffsetForScrollbarPointer(
  geometry: ScrollbarGeometry,
  pointerPosition: number,
  centerThumb = true,
): number {
  if (geometry.maxScroll <= 0 || geometry.trackTravel <= 0) return 0
  const thumbLength = geometry.axis === 'vertical'
    ? geometry.thumbRect.height
    : geometry.thumbRect.width
  const desiredStart = finite(pointerPosition) - (centerThumb ? thumbLength / 2 : 0)
  const ratio = (desiredStart - geometry.thumbTravelStart) / geometry.trackTravel
  return Math.max(0, Math.min(geometry.maxScroll, ratio * geometry.maxScroll))
}

export function hitTestScrollbarGeometry(point: Offset, geometry: ScrollbarGeometry): boolean {
  return validPoint(point) && point.x >= geometry.hitRect.x &&
    point.x <= geometry.hitRect.x + geometry.hitRect.width &&
    point.y >= geometry.hitRect.y &&
    point.y <= geometry.hitRect.y + geometry.hitRect.height &&
    geometry.maxScroll > 0
}

export interface ScrollbarViewportInput {
  outerWidth: number
  outerHeight: number
  contentWidth: number
  contentHeight: number
  scrollbarSize: number
  allowHorizontal: boolean
  allowVertical: boolean
}

export interface ScrollbarViewportState {
  width: number
  height: number
  showHBar: boolean
  showVBar: boolean
}

export function resolveScrollbarViewport(input: ScrollbarViewportInput): ScrollbarViewportState {
  const outerWidth = finiteNonNegative(input.outerWidth)
  const outerHeight = finiteNonNegative(input.outerHeight)
  const contentWidth = finiteNonNegative(input.contentWidth)
  const contentHeight = finiteNonNegative(input.contentHeight)
  const scrollbarSize = finiteNonNegative(input.scrollbarSize)
  let showHBar = input.allowHorizontal && contentWidth > outerWidth
  let showVBar = input.allowVertical && contentHeight > outerHeight

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const width = Math.max(0, outerWidth - (showVBar ? scrollbarSize : 0))
    const height = Math.max(0, outerHeight - (showHBar ? scrollbarSize : 0))
    const nextShowHBar = input.allowHorizontal && contentWidth > width
    const nextShowVBar = input.allowVertical && contentHeight > height
    if (nextShowHBar === showHBar && nextShowVBar === showVBar) break
    showHBar = nextShowHBar
    showVBar = nextShowVBar
  }

  return {
    width: Math.max(0, outerWidth - (showVBar ? scrollbarSize : 0)),
    height: Math.max(0, outerHeight - (showHBar ? scrollbarSize : 0)),
    showHBar,
    showVBar,
  }
}

// ---- 绘制 ----

export interface PaintVBarOpts {
  dl: DrawList
  style: ScrollbarStyleTokens
  trackX: number
  trackY: number
  trackW: number
  trackH: number
  viewSize: number
  contentSize: number
  scrollOffset: number
  state: ScrollbarState
  forceVisible?: boolean
}

export function paintVBar(opts: PaintVBarOpts): void {
  const { dl, style: s, trackX, trackY, trackW, trackH,
          viewSize, contentSize, scrollOffset, state } = opts
  if (
    !validTrack(trackX, trackY, trackW, trackH) ||
    (!opts.forceVisible && !hasOverflow(viewSize, contentSize))
  ) return

  const geometry = resolveScrollbarGeometryForState({
    axis: 'vertical',
    trackRect: { x: trackX, y: trackY, width: trackW, height: trackH },
    viewportSize: viewSize,
    contentSize,
    scrollOffset,
    style: s,
    state,
  })
  const trackColor = state.dragging ? s.trackPressedBg
    : state.hovered ? s.trackHoveredBg
    : s.trackBg
  dl.fillRect(trackX, trackY, trackW, trackH, trackColor, s.trackRadius)

  const thumbColor = state.dragging ? s.thumbPressedBg
    : state.hovered ? s.thumbHoveredBg
    : s.thumbBg
  const thumb = geometry.thumbRect
  dl.fillRect(thumb.x, thumb.y, thumb.width, thumb.height, thumbColor, s.thumbRadius)
}

export interface PaintHBarOpts {
  dl: DrawList
  style: ScrollbarStyleTokens
  trackX: number
  trackY: number
  trackW: number
  trackH: number
  viewSize: number
  contentSize: number
  scrollOffset: number
  state: ScrollbarState
  forceVisible?: boolean
}

export function paintHBar(opts: PaintHBarOpts): void {
  const { dl, style: s, trackX, trackY, trackW, trackH,
          viewSize, contentSize, scrollOffset, state } = opts
  if (
    !validTrack(trackX, trackY, trackW, trackH) ||
    (!opts.forceVisible && !hasOverflow(viewSize, contentSize))
  ) return

  const geometry = resolveScrollbarGeometryForState({
    axis: 'horizontal',
    trackRect: { x: trackX, y: trackY, width: trackW, height: trackH },
    viewportSize: viewSize,
    contentSize,
    scrollOffset,
    style: s,
    state,
  })
  const trackColor = state.dragging ? s.trackPressedBg
    : state.hovered ? s.trackHoveredBg
    : s.trackBg
  dl.fillRect(trackX, trackY, trackW, trackH, trackColor, s.trackRadius)

  const thumbColor = state.dragging ? s.thumbPressedBg
    : state.hovered ? s.thumbHoveredBg
    : s.thumbBg
  const thumb = geometry.thumbRect
  dl.fillRect(thumb.x, thumb.y, thumb.width, thumb.height, thumbColor, s.thumbRadius)
}

function validPoint(point: Offset): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function scrollbarVisualThickness(style: ScrollbarStyleTokens, state: ScrollbarState): number {
  if (state.dragging) return style.thumbPressedThickness
  if (state.hovered) return style.thumbHoveredThickness
  return style.thumbThickness
}

function normalizeRect(rect: Rect): Rect {
  return {
    x: finite(rect.x),
    y: finite(rect.y),
    width: finiteNonNegative(rect.width),
    height: finiteNonNegative(rect.height),
  }
}

function validTrack(
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  return Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
}

function hasOverflow(viewSize: number, contentSize: number): boolean {
  const view = finiteNonNegative(viewSize)
  const content = finiteNonNegative(contentSize)
  return content > view
}

function finiteNonNegative(value: number): number {
  return Math.max(0, finite(value))
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}
