import type { Offset } from '../core/render_object'
import type { PointerKey } from './pointer_identity'
import {
  ScrollbarState,
  scrollOffsetForScrollbarPointer,
  type ScrollbarAxis,
  type ScrollbarGeometry,
} from '../rendering/scrollbar'

export type ScrollbarPointerAction = 'none' | 'thumb-drag' | 'track'

export interface ScrollbarInteractionResult {
  handled: boolean
  stateChanged: boolean
  action: ScrollbarPointerAction
  scrollOffset?: number
  dragStarted?: boolean
  dragEnded?: boolean
  capturePointer?: boolean
  releasePointer?: boolean
}

export class ScrollbarAxisController {
  readonly state: ScrollbarState
  private _activePointerKey?: PointerKey

  constructor(readonly axis: ScrollbarAxis, state = new ScrollbarState()) {
    this.state = state
  }

  updateHover(point: Offset, geometry: ScrollbarGeometry): boolean {
    const hovered = geometry.maxScroll > 0 && pointInRect(point, geometry.hitRect)
    if (hovered === this.state.hovered) return false
    this.state.hovered = hovered
    return true
  }

  get activePointerKey(): PointerKey | undefined {
    return this._activePointerKey
  }

  ownsPointer(pointerKey: PointerKey): boolean {
    return this.state.dragging && (
      this._activePointerKey === undefined || this._activePointerKey === pointerKey
    )
  }

  beginPointer(
    point: Offset,
    geometry: ScrollbarGeometry,
    pointerKey?: PointerKey,
  ): ScrollbarInteractionResult {
    if (
      this.state.dragging &&
      this._activePointerKey !== undefined &&
      this._activePointerKey !== pointerKey
    ) {
      return { handled: false, stateChanged: false, action: 'none' }
    }
    if (geometry.maxScroll <= 0 || !pointInRect(point, geometry.hitRect)) {
      return { handled: false, stateChanged: false, action: 'none' }
    }
    const wasHovered = this.state.hovered
    this.state.hovered = true
    if (!pointInRect(point, geometry.thumbHitRect)) {
      this.state.dragging = false
      this._activePointerKey = undefined
      return {
        handled: true,
        stateChanged: !wasHovered,
        action: 'track',
        scrollOffset: scrollOffsetForScrollbarPointer(
          geometry,
          axisPosition(this.axis, point),
        ),
      }
    }
    const stateChanged = !wasHovered || !this.state.dragging
    this.state.dragging = true
    this._activePointerKey = pointerKey
    this.state.dragStartPos = axisPosition(this.axis, point)
    this.state.dragStartScroll = geometry.scrollOffset
    return {
      handled: true,
      stateChanged,
      action: 'thumb-drag',
      dragStarted: true,
      capturePointer: true,
    }
  }

  updatePointer(
    point: Offset,
    geometry: ScrollbarGeometry,
    pointerKey?: PointerKey,
  ): ScrollbarInteractionResult {
    if (!this._matchesActivePointer(pointerKey)) {
      return { handled: false, stateChanged: false, action: 'none' }
    }
    const delta = axisPosition(this.axis, point) - this.state.dragStartPos
    const scrollOffset = geometry.trackTravel <= 0
      ? this.state.dragStartScroll
      : clamp(
          this.state.dragStartScroll + (delta / geometry.trackTravel) * geometry.maxScroll,
          0,
          geometry.maxScroll,
        )
    return { handled: true, stateChanged: false, action: 'thumb-drag', scrollOffset }
  }

  endPointer(
    point?: Offset,
    geometry?: ScrollbarGeometry,
    pointerKey?: PointerKey,
  ): ScrollbarInteractionResult {
    if (this.state.dragging && !this._matchesActivePointer(pointerKey)) {
      return { handled: false, stateChanged: false, action: 'none' }
    }
    const wasDragging = this.state.dragging
    const wasHovered = this.state.hovered
    this.state.dragging = false
    this._activePointerKey = undefined
    if (point && geometry) {
      this.state.hovered = geometry.maxScroll > 0 && pointInRect(point, geometry.hitRect)
    }
    return {
      handled: wasDragging,
      stateChanged: wasDragging || wasHovered !== this.state.hovered,
      action: wasDragging ? 'thumb-drag' : 'none',
      dragEnded: wasDragging,
      releasePointer: wasDragging,
    }
  }

  cancelPointer(pointerKey?: PointerKey): boolean {
    if (this.state.dragging && !this._matchesActivePointer(pointerKey)) return false
    return this.reset()
  }

  clearHover(): boolean {
    if (!this.state.hovered) return false
    this.state.hovered = false
    return true
  }

  reset(): boolean {
    const changed = this.state.hovered || this.state.dragging
    this.state.hovered = false
    this.state.dragging = false
    this.state.dragStartPos = 0
    this.state.dragStartScroll = 0
    this._activePointerKey = undefined
    return changed
  }

  private _matchesActivePointer(pointerKey?: PointerKey): boolean {
    if (!this.state.dragging) return false
    return this._activePointerKey === undefined || this._activePointerKey === pointerKey
  }
}

function axisPosition(axis: ScrollbarAxis, point: Offset): number {
  return axis === 'vertical' ? point.y : point.x
}

function pointInRect(point: Offset, rect: { x: number; y: number; width: number; height: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= rect.x && point.x <= rect.x + rect.width &&
    point.y >= rect.y && point.y <= rect.y + rect.height
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}
