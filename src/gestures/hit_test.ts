// HitTest: Canvas 命中测试与事件分发路径
// 路径顺序：祖先在前，叶节点（最深命中）在后
// 对应 DOM 事件 capture 阶段顺序；bubble 是其反序

import type { Offset } from '../core/render_object'
import type { GestureArenaEntry, GestureArenaManager, GestureArenaMember } from './gesture_arena'
import type { PointerType } from './pointer_identity'

export type { PointerType } from './pointer_identity'

// ---- HitTestEntry: 命中路径中的单个节点 ----

export interface HitTestGlobalToLocalSpace {
  globalToLocal(position: Offset): Offset
}

export interface HitTestGlobalOffsetSpace {
  readonly globalOffset: Offset
}

/**
 * Resolves a current global pointer position into an entry's coordinate
 * system. A live coordinate space prevents move/up/cancel from reusing the
 * local position captured at pointer down.
 */
export type HitTestCoordinateSpace =
  | HitTestGlobalToLocalSpace
  | HitTestGlobalOffsetSpace
  | ((position: Offset) => Offset)

export interface HitTestEntry {
  target: HitTestTarget
  localPosition: Offset
  /** Stable semantic identity within a target. */
  key?: unknown
  /** Optional component-owned context associated with this hit. */
  data?: unknown
  /** Coordinate space used to resolve later events in the pointer sequence. */
  coordinateSpace?: HitTestCoordinateSpace
}

export function sameHitTestEntryIdentity(
  left: Pick<HitTestEntry, 'target' | 'key'> | undefined,
  right: Pick<HitTestEntry, 'target' | 'key'> | undefined,
): boolean {
  return left !== undefined &&
    right !== undefined &&
    left.target === right.target &&
    Object.is(left.key, right.key)
}

export function resolveHitTestLocalPosition(entry: HitTestEntry, globalPosition: Offset): Offset {
  const coordinateSpace = entry.coordinateSpace ?? entry.target
  if (typeof coordinateSpace === 'function') {
    const local = coordinateSpace(globalPosition)
    return { x: local.x, y: local.y }
  }

  if (coordinateSpace && typeof coordinateSpace === 'object') {
    const globalToLocal = (coordinateSpace as Partial<HitTestGlobalToLocalSpace>).globalToLocal
    if (typeof globalToLocal === 'function') {
      const local = globalToLocal.call(coordinateSpace, globalPosition)
      return { x: local.x, y: local.y }
    }

    const globalOffset = (coordinateSpace as Partial<HitTestGlobalOffsetSpace>).globalOffset
    if (
      globalOffset &&
      typeof globalOffset.x === 'number' &&
      typeof globalOffset.y === 'number'
    ) {
      return {
        x: globalPosition.x - globalOffset.x,
        y: globalPosition.y - globalOffset.y,
      }
    }
  }

  return { x: entry.localPosition.x, y: entry.localPosition.y }
}

// ---- HitTestTarget: 参与命中测试与事件分发的节点接口 ----
// RenderObject 默认实现 hitTestPath，InteractiveRenderObject 实现事件回调
export interface HitTestTarget {
  readonly preservesCurrentFocusOnPointerDown?: boolean
  onPointerEnter?(event: PointerEvent): void
  onPointerLeave?(event: PointerEvent): void
  onPointerDownCapture?(event: PointerEvent): void
  onPointerMoveCapture?(event: PointerEvent): void
  onPointerUpCapture?(event: PointerEvent): void
  onPointerCancelCapture?(event: PointerEvent): void
  onPointerDown?(event: PointerEvent): void
  onPointerMove?(event: PointerEvent): void
  onPointerUp?(event: PointerEvent): void
  onPointerCancel?(event: PointerEvent): void
  onPointerActivateCapture?(event: PointerActivationEvent): void
  onPointerActivate?(event: PointerActivationEvent): void
  onWheel?(event: WheelPointerEvent): boolean | void
  onKeyDown?(event: KeyboardEvent): boolean | void
  onContextMenu?(position: Offset): boolean | void
  onDoubleClick?(position: Offset): void
}

// ---- PointerEvent: 指针事件 ----

export interface PointerEvent {
  pointerId: number
  position: Offset
  type: 'down' | 'move' | 'up' | 'cancel'
  button?: number
  buttons?: number
  pointerType?: PointerType
  clickCount?: number
  timeStamp?: number
  phase?: DispatchPhase
  localPosition?: Offset
  path?: HitTestResult
  hitTestEntry?: HitTestEntry
  ctrlKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  stopPropagation?(): void
  /** Prevent this pointer sequence from producing a semantic activation. */
  preventActivation?(): void
  setPointerCapture?(): void
  releasePointerCapture?(): void
  hasPointerCapture?(): boolean
  gestureArena?: GestureArenaManager
  joinGestureArena?(member: GestureArenaMember): GestureArenaEntry
}

/**
 * A successful pointer activation derived from one completed down/up
 * sequence. Unlike the browser's canvas-level click count, `clickCount` is
 * scoped to one logical hit-test identity.
 */
export interface PointerActivationEvent {
  readonly type: 'activate'
  readonly pointerId: number
  readonly pointerType: PointerType
  readonly button: number
  readonly clickCount: number
  readonly position: Offset
  readonly downPosition: Offset
  readonly timeStamp: number
  readonly ctrlKey?: boolean
  readonly shiftKey?: boolean
  readonly metaKey?: boolean
  readonly altKey?: boolean
  readonly phase: DispatchPhase
  readonly localPosition: Offset
  readonly path: HitTestResult
  readonly targetEntry: HitTestEntry
  readonly currentEntry: HitTestEntry
  stopPropagation(): void
}

export function isPrimaryPointerButton(event: PointerEvent): boolean {
  return event.button === undefined || event.button === 0
}

// ---- WheelPointerEvent: 滚轮事件 ----

export interface WheelPointerEvent {
  pointerId: number
  pointerType?: PointerType
  position: Offset
  type: 'wheel'
  deltaX: number
  deltaY: number
  ctrlKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

// ---- 事件分发阶段 ----

export enum DispatchPhase {
  Capture = 'capture',
  Target = 'target',
  Bubble = 'bubble',
}

// ---- 分发事件：携带路径和阶段信息 ----

export interface DispatchEvent {
  readonly path: HitTestResult
  readonly phase: DispatchPhase
  readonly localPosition: Offset
  stopPropagation(): void
}

// ---- HitTestResult: 命中路径收集器 ----

export class HitTestResult {
  private _path: HitTestEntry[] = []
  private _legacyPropagationStopped = false
  private _sealed = false

  get path(): HitTestEntry[] {
    return [...this._path]
  }

  get length(): number {
    return this._path.length
  }

  add(entry: HitTestEntry): void {
    if (this._sealed) throw new Error('Cannot mutate a sealed hit-test path')
    this._path.push(entry)
  }

  truncate(length: number): void {
    if (this._sealed) throw new Error('Cannot mutate a sealed hit-test path')
    if (!Number.isInteger(length) || length < 0 || length > this._path.length) {
      throw new RangeError('Hit-test path length is out of range')
    }
    this._path.length = length
  }

  snapshot(): HitTestResult {
    const result = new HitTestResult()
    result._path = [...this._path]
    result._sealed = true
    return result
  }

  seal(): this {
    this._sealed = true
    return this
  }

  /** 最近的祖先（path[0]），即离根最近的命中节点 */
  get first(): HitTestEntry | undefined {
    return this._path.length > 0 ? this._path[0] : undefined
  }

  /** 最深命中目标（path 最后一项），即最深的叶节点 */
  get deepest(): HitTestEntry | undefined {
    return this._path.length > 0 ? this._path[this._path.length - 1] : undefined
  }

  /** 命中路径是否为空 */
  get isEmpty(): boolean {
    return this._path.length === 0
  }

  /** 命中路径中是否包含某个 target */
  contains(target: HitTestTarget): boolean {
    return this._path.some(e => e.target === target)
  }

  /** 命中路径中所有交互式 target（有事件回调的） */
  interactiveTargets(): HitTestTarget[] {
    return this.interactiveEntries().map(entry => entry.target)
  }

  /** Interactive entries, retaining semantic key/data/coordinate-space identity. */
  interactiveEntries(): HitTestEntry[] {
    return this._path.filter(entry => {
      const target = entry.target
      return typeof target.onPointerEnter === 'function' ||
             typeof target.onPointerLeave === 'function' ||
             typeof target.onPointerDownCapture === 'function' ||
             typeof target.onPointerMoveCapture === 'function' ||
             typeof target.onPointerUpCapture === 'function' ||
             typeof target.onPointerCancelCapture === 'function' ||
             typeof target.onPointerDown === 'function' ||
             typeof target.onPointerMove === 'function' ||
             typeof target.onPointerUp === 'function' ||
             typeof target.onPointerCancel === 'function'
    })
  }

  /** Copy the ancestor-to-target portion of this path, preserving entry metadata. */
  through(entry: HitTestEntry): HitTestResult {
    const exactIndex = this._path.indexOf(entry)
    const identityIndex = exactIndex >= 0
      ? exactIndex
      : this._path.findIndex(candidate => sameHitTestEntryIdentity(candidate, entry))
    const result = new HitTestResult()
    if (identityIndex < 0) {
      result.add(entry)
      return result
    }
    for (let index = 0; index <= identityIndex; index++) {
      result.add(this._path[index]!)
    }
    return result
  }

  /**
   * @deprecated PointerPathDispatcher owns propagation state per dispatch
   * frame. This method remains for source compatibility with external callers.
   */
  createDispatchEvent(phase: DispatchPhase, localPosition: Offset): DispatchEvent {
    return {
      path: this,
      phase,
      localPosition,
      stopPropagation: () => { this._legacyPropagationStopped = true },
    }
  }

  /** @deprecated See createDispatchEvent(). */
  get propagationStopped(): boolean {
    return this._legacyPropagationStopped
  }

  /** @deprecated See createDispatchEvent(). */
  resetPropagation(): void {
    this._legacyPropagationStopped = false
  }

}
