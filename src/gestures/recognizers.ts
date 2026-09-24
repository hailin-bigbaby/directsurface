// EventDispatcher: 基于 HitTestResult 路径的事件分发
// 事件流：DOM event → normalize → 命中测试 → overlay 优先 → path dispatch
// 路径收集替代旧的 _collectInteractive 扁平遍历，支持 capture/bubble 语义

import { RenderObject, type Offset } from '../core/render_object'
import { DisposableBag } from '../core/disposable'
import { FocusManager } from '../core/focus_manager'
import { TooltipService } from '../widgets/tooltip'
import {
  PointerDispatchSessions,
  type PointerDispatchDebugSnapshot,
  type PointerDispatchSession,
  type PointerSequenceToken,
} from './pointer_dispatch_session'
import { PointerPathDispatcher } from './pointer_path_dispatcher'
import { PointerRouteArbiter, type PointerRouteInterceptor } from './pointer_route_arbiter'
import { ActivationSequencer } from './activation_sequencer'
import {
  HitTestResult,
  sameHitTestEntryIdentity,
  type HitTestEntry,
  type HitTestTarget,
  type PointerEvent,
} from './hit_test'
import {
  pointerKey,
  type PointerIdentity,
  type PointerIdentitySource,
  type PointerKey,
  type PointerType,
} from './pointer_identity'

// ---- PointerEvent / WheelPointerEvent: 从 hit_test.ts 重导出 ----

export type { PointerEvent, WheelPointerEvent, HitTestTarget, HitTestEntry } from './hit_test'
export type { PointerDispatchDebugSnapshot } from './pointer_dispatch_session'
export type DebugPointerMoveListener = (position: Offset) => void

export interface EventDispatcherOptions {
  onPointerDownDispatchComplete?: (event: import('./hit_test').PointerEvent) => void
}

// ---- InteractiveRenderObject: 向后兼容接口 ----
// 组件通过此接口声明自己参与指针事件分发
// EventDispatcher 通过 hitTestPath 收集路径，再筛选有回调的 target

export interface InteractiveRenderObject extends HitTestTarget {
  hitTest(point: Offset): boolean
  onPointerEnter?(e: import('./hit_test').PointerEvent): void
  onPointerLeave?(e: import('./hit_test').PointerEvent): void
  onPointerDownCapture?(e: import('./hit_test').PointerEvent): void
  onPointerMoveCapture?(e: import('./hit_test').PointerEvent): void
  onPointerUpCapture?(e: import('./hit_test').PointerEvent): void
  onPointerCancelCapture?(e: import('./hit_test').PointerEvent): void
  onPointerDown?(e: import('./hit_test').PointerEvent): void
  onPointerMove?(e: import('./hit_test').PointerEvent): void
  onPointerUp?(e: import('./hit_test').PointerEvent): void
  onPointerCancel?(e: import('./hit_test').PointerEvent): void
}

// ---- TapRecognizer / DragRecognizer / LongPressRecognizer ----
// 保留供组件直接使用，后续会由 GestureArena 替代

export interface TapCallbacks {
  onTap?: () => void
  onTapDown?: (pos: Offset) => void
  onTapUp?: (pos: Offset) => void
  onTapCancel?: () => void
}

export class TapRecognizer {
  private _downPos?: Offset
  private _pointerKey?: PointerKey
  private _generation = 0
  private _terminating = false
  private _callbacks: TapCallbacks

  constructor(callbacks: TapCallbacks) {
    this._callbacks = callbacks
  }

  handlePointerDown(e: import('./hit_test').PointerEvent): void {
    if (this._pointerKey !== undefined || this._terminating) return
    const ownerKey = pointerKey(e)
    this._pointerKey = ownerKey
    const generation = ++this._generation
    this._downPos = e.position
    try {
      this._callbacks.onTapDown?.(e.position)
    } catch (error) {
      if (
        this._pointerKey === ownerKey &&
        this._generation === generation
      ) {
        this._reset()
      }
      throw error
    }
  }

  handlePointerUp(e: import('./hit_test').PointerEvent): void {
    if (pointerKey(e) !== this._pointerKey || this._terminating) return
    this._terminating = true
    try {
      this._callbacks.onTapUp?.(e.position)
      this._callbacks.onTap?.()
    } finally {
      this._reset()
      this._terminating = false
    }
  }

  handlePointerCancel(e: import('./hit_test').PointerEvent): void {
    if (pointerKey(e) !== this._pointerKey || this._terminating) return
    this._terminating = true
    try {
      this._callbacks.onTapCancel?.()
    } finally {
      this._reset()
      this._terminating = false
    }
  }

  private _reset(): void {
    this._generation++
    this._pointerKey = undefined
    this._downPos = undefined
  }
}

export interface DragCallbacks {
  onDragStart?: (pos: Offset) => void
  onDragUpdate?: (delta: Offset, pos: Offset) => void
  onDragEnd?: (pos: Offset) => void
}

export class DragRecognizer {
  private _pointerKey?: PointerKey
  private _generation = 0
  private _moveFrameGeneration = 0
  private _lastPos?: Offset
  private _dragging = false
  private _terminating = false
  private _callbacks: DragCallbacks
  readonly slop: number

  constructor(callbacks: DragCallbacks, slop = 4) {
    this._callbacks = callbacks
    this.slop = slop
  }

  handlePointerDown(e: import('./hit_test').PointerEvent): void {
    if (this._pointerKey !== undefined || this._terminating) return
    this._pointerKey = pointerKey(e)
    this._generation++
    this._lastPos = e.position
    this._dragging = false
  }

  handlePointerMove(e: import('./hit_test').PointerEvent): void {
    if (pointerKey(e) !== this._pointerKey || !this._lastPos) return
    const ownerKey = this._pointerKey
    const generation = this._generation
    const moveFrameGeneration = ++this._moveFrameGeneration
    const isMoveFrameCurrent = (): boolean =>
      this._isOwnerCurrent(ownerKey, generation) &&
      this._moveFrameGeneration === moveFrameGeneration
    try {
      const dx = e.position.x - this._lastPos.x
      const dy = e.position.y - this._lastPos.y
      if (!this._dragging) {
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist >= this.slop) {
          this._dragging = true
          this._callbacks.onDragStart?.(this._lastPos)
          if (!isMoveFrameCurrent()) return
        }
      }
      if (this._dragging) {
        this._callbacks.onDragUpdate?.({ x: dx, y: dy }, e.position)
        if (!isMoveFrameCurrent()) return
        this._lastPos = e.position
      }
    } catch (error) {
      if (isMoveFrameCurrent()) this._reset()
      throw error
    }
  }

  handlePointerUp(e: import('./hit_test').PointerEvent): void {
    if (pointerKey(e) !== this._pointerKey || this._terminating) return
    this._terminating = true
    try {
      if (this._dragging) {
        this._callbacks.onDragEnd?.(e.position)
      }
    } finally {
      this._reset()
      this._terminating = false
    }
  }

  handlePointerCancel(e: import('./hit_test').PointerEvent): void {
    if (pointerKey(e) !== this._pointerKey || this._terminating) return
    this._reset()
  }

  private _reset(): void {
    this._generation++
    this._pointerKey = undefined
    this._lastPos = undefined
    this._dragging = false
  }

  private _isOwnerCurrent(
    ownerKey: PointerKey,
    generation: number,
  ): boolean {
    return this._pointerKey === ownerKey &&
      this._generation === generation
  }
}

export interface LongPressCallbacks {
  onLongPress?: (pos: Offset) => void
  onLongPressCancel?: () => void
}

export class LongPressRecognizer {
  private _pointerKey?: PointerKey
  private _timer?: ReturnType<typeof setTimeout>
  private _terminating = false
  private _callbacks: LongPressCallbacks
  readonly duration: number

  constructor(callbacks: LongPressCallbacks, duration = 500) {
    this._callbacks = callbacks
    this.duration = duration
  }

  handlePointerDown(e: import('./hit_test').PointerEvent): void {
    if (this._pointerKey !== undefined || this._terminating) return
    const ownerKey = pointerKey(e)
    this._pointerKey = ownerKey
    const timer = setTimeout(() => {
      if (this._pointerKey !== ownerKey || this._timer !== timer) return
      this._timer = undefined
      this._terminating = true
      try {
        this._callbacks.onLongPress?.(e.position)
      } finally {
        this._reset()
        this._terminating = false
      }
    }, this.duration)
    this._timer = timer
  }

  handlePointerUp(e: import('./hit_test').PointerEvent): void {
    if (pointerKey(e) !== this._pointerKey || this._terminating) return
    this._cancel()
  }

  handlePointerMove(e: import('./hit_test').PointerEvent): void {
    if (pointerKey(e) !== this._pointerKey || this._terminating) return
    this._cancel()
  }

  handlePointerCancel(e: import('./hit_test').PointerEvent): void {
    if (pointerKey(e) !== this._pointerKey || this._terminating) return
    this._cancel()
  }

  private _cancel(): void {
    const timer = this._timer
    if (timer !== undefined) {
      clearTimeout(timer)
      this._timer = undefined
    }
    this._terminating = true
    try {
      if (timer !== undefined) this._callbacks.onLongPressCancel?.()
    } finally {
      this._reset()
      this._terminating = false
    }
  }

  private _reset(): void {
    if (this._timer !== undefined) clearTimeout(this._timer)
    this._pointerKey = undefined
    this._timer = undefined
  }
}

// ---- EventDispatcher: 基于 HitTestResult 路径的事件分发 ----

export class EventDispatcher {
  private static readonly ACTIVATION_PRESS_SLOP = 6

  private canvas: HTMLCanvasElement
  private roots: RenderObject[] = []
  private disposables = new DisposableBag()
  private sessions = new PointerDispatchSessions()
  private pointerDispatcher = new PointerPathDispatcher(this.sessions)
  private routeArbiter = new PointerRouteArbiter(() => this._interceptors)
  private activationSequencer = new ActivationSequencer()
  private nativeDoubleClickSuppression?: { position: Offset; timestamp: number }
  private debugPointerMoveListeners = new Set<DebugPointerMoveListener>()
  private debugIgnoredRoots = new Set<RenderObject>()
  private popupAnchorRoot: RenderObject | null = null
  private rootGeneration = 0
  private wheelFrameGeneration = 0
  private disposed = false

  constructor(canvas: HTMLCanvasElement, private readonly options: EventDispatcherOptions = {}) {
    this.canvas = canvas
    FocusManager.instance.setRootResolver(() => this.roots)
    this._bindEvents()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.rootGeneration++
    this.wheelFrameGeneration++
    let firstError: unknown
    const attempt = (callback: () => void): void => {
      try {
        callback()
      } catch (error) {
        firstError ??= error
      }
    }

    attempt(() => this.disposables.dispose())
    attempt(() => this._cancelPointerSessionsForDispose())
    const terminatingPointers = this.sessions.pointerIdentities()
      .filter(identity => this.sessions.isTerminating(identity))
    attempt(() => this.sessions.clear(true))
    attempt(() => {
      if (terminatingPointers.length === 0) {
        this.pointerDispatcher.clearReferences()
      } else {
        this.pointerDispatcher.retainPointerReferences(terminatingPointers)
      }
    })
    attempt(() => this.activationSequencer.reset())
    this.nativeDoubleClickSuppression = undefined
    const activeRoot = FocusManager.instance.activeRoot
    if (activeRoot && this.roots.includes(activeRoot)) {
      attempt(() => FocusManager.instance.setActiveRoot(null))
    }
    this.roots = []
    this.popupAnchorRoot = null
    attempt(() => FocusManager.instance.setRootResolver(undefined))
    this._interceptors = []
    this.debugPointerMoveListeners.clear()
    this.debugIgnoredRoots.clear()
    this._onContextMenu = undefined
    this._onDoubleClick = undefined

    if (firstError !== undefined) throw firstError
  }

  addRoot(root: RenderObject): void {
    if (this.disposed || this.roots.includes(root)) return
    this.roots.push(root)
    this.rootGeneration++
  }

  removeRoot(root: RenderObject): void {
    if (!this.roots.includes(root)) return
    this.roots = this.roots.filter(r => r !== root)
    this.rootGeneration++
    if (this.popupAnchorRoot === root) this.popupAnchorRoot = null
    if (FocusManager.instance.activeRoot === root) FocusManager.instance.setActiveRoot(null)
    this.debugIgnoredRoots.delete(root)
    this.activationSequencer.invalidateScope({ kind: 'main', target: root })
    this._cancelPointerSessionsForRoot(root)
  }

  private _interceptors: PointerRouteInterceptor[] = []

  addInterceptor(interceptor: PointerRouteInterceptor): void {
    if (this.disposed) return
    this._interceptors.push(interceptor)
  }

  removeInterceptor(interceptor: PointerRouteInterceptor): void {
    this._interceptors = this._interceptors.filter(i => i !== interceptor)
  }

  private _listen<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.disposables.listen(this.canvas, type, listener, options)
  }

  private _listenWindow<K extends keyof WindowEventMap>(
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.disposables.listen(window, type, listener, options)
  }

  bringToFront(root: RenderObject): void {
    if (this.disposed) return
    const idx = this.roots.indexOf(root)
    if (idx >= 0 && idx < this.roots.length - 1) {
      this.roots.splice(idx, 1)
      this.roots.push(root)
      this.rootGeneration++
    }
  }

  getRoots(): RenderObject[] {
    return [...this.roots]
  }

  setRootOrder(roots: readonly RenderObject[]): void {
    if (this.disposed) return
    if (
      roots.length !== this.roots.length ||
      new Set(roots).size !== roots.length ||
      roots.some(root => !this.roots.includes(root))
    ) {
      throw new Error('Root order must contain every mounted root exactly once')
    }
    if (roots.every((root, index) => this.roots[index] === root)) return
    this.roots = [...roots]
    this.rootGeneration++
  }

  private _clearHoveredTargets(pointer: PointerIdentitySource, pos: Offset): void {
    let firstError: unknown
    try {
      this.sessions.clearHover(pointer, pos, (target, event) => {
        target.onPointerLeave?.(event)
      })
    } catch (error) {
      firstError = error
    }
    try {
      TooltipService.currentOrNull?.hide()
    } catch (error) {
      firstError ??= error
    }
    if (firstError !== undefined) throw firstError
  }

  // ---- Pointer Capture API ----

  /** 捕获指定 pointer 的所有后续事件到指定 target。
   *  组件在 onPointerDown 中调用此方法请求捕获，
   *  捕获期间 move/up/cancel 事件直接发给 capturedTarget，
   *  不再进行命中测试。 */
  setPointerCapture(
    pointerId: number,
    target: HitTestTarget,
    pointerType?: PointerType,
  ): void {
    if (this.disposed) return
    this.sessions.setCapture(
      this._resolveLegacyPointerIdentity(pointerId, pointerType),
      target,
    )
  }

  /** 释放指定 pointer 的捕获。
   *  组件在 onPointerUp 或 dispose 中调用此方法释放捕获。 */
  releasePointerCapture(pointerId: number, pointerType?: PointerType): void {
    this.sessions.releaseCapture(
      this._resolveLegacyPointerIdentity(pointerId, pointerType),
    )
  }

  /** 查询指定 pointer 是否已被捕获 */
  hasPointerCapture(pointerId: number, pointerType?: PointerType): boolean {
    return this.sessions.getCapture(
      this._resolveLegacyPointerIdentity(pointerId, pointerType),
    ) !== undefined
  }

  /** 获取指定 pointer 的捕获目标 */
  getPointerCapture(
    pointerId: number,
    pointerType?: PointerType,
  ): HitTestTarget | undefined {
    return this.sessions.getCapture(
      this._resolveLegacyPointerIdentity(pointerId, pointerType),
    )
  }

  getDebugSnapshot(
    pointerId = 0,
    pointerType?: PointerType,
  ): PointerDispatchDebugSnapshot {
    return this.sessions.debugSnapshot(
      this._resolveLegacyPointerIdentity(pointerId, pointerType),
    )
  }

  private _resolveLegacyPointerIdentity(
    pointerId: number,
    pointerType?: PointerType,
  ): PointerIdentity {
    if (pointerType) return { pointerId, pointerType }
    const matches = this.sessions.pointerIdentities()
      .filter(identity => identity.pointerId === pointerId)
    const sequenced = matches.filter(identity => {
      const phase = this.sessions.get(identity)?.sequencePhase
      return phase !== undefined && phase !== 'ended'
    })
    if (sequenced.length === 1) return sequenced[0]!
    const captured = matches.filter(identity =>
      this.sessions.getCapture(identity) !== undefined
    )
    if (captured.length === 1) return captured[0]!
    if (matches.length === 1) return matches[0]!
    return { pointerId, pointerType: 'mouse' }
  }

  getPopupAnchorRoot(): RenderObject | null {
    return this.popupAnchorRoot
  }

  debugHitTest(position: Offset): HitTestResult {
    return this._hitTest(position, this.debugIgnoredRoots)
  }

  isDebugHitTestIgnored(position: Offset): boolean {
    for (let i = this.roots.length - 1; i >= 0; i--) {
      const root = this.roots[i]!
      const result = new HitTestResult()
      if (!root.hitTestPath(position, result)) continue
      return this.debugIgnoredRoots.has(root)
    }
    return false
  }

  setDebugHitTestIgnoredRoot(root: RenderObject, ignored: boolean): void {
    if (this.disposed) return
    if (ignored) {
      this.debugIgnoredRoots.add(root)
      return
    }
    this.debugIgnoredRoots.delete(root)
  }

  addDebugPointerMoveListener(listener: DebugPointerMoveListener): () => void {
    if (this.disposed) return () => {}
    this.debugPointerMoveListeners.add(listener)
    return () => {
      this.debugPointerMoveListeners.delete(listener)
    }
  }

  // ---- 命中测试：构建 HitTestResult 路径 ----

  private _hitTest(pos: Offset, ignoredRoots?: ReadonlySet<RenderObject>): HitTestResult {
    const result = new HitTestResult()
    // 逆序遍历根节点（最顶层优先），只返回第一个有命中的根节点的路径
    for (let i = this.roots.length - 1; i >= 0; i--) {
      const root = this.roots[i]!
      if (ignoredRoots?.has(root)) {
        const ignoredResult = new HitTestResult()
        if (root.hitTestPath(pos, ignoredResult)) return result
        continue
      }
      const savedLen = result.length
      if (root.hitTestPath(pos, result)) {
        return result
      }
      // 此根节点没有命中，回退路径
      result.truncate(savedLen)
    }
    return result
  }

  // ---- 路径式事件分发 ----

  private _syncHoveredTargets(
    pointer: PointerIdentitySource,
    pos: Offset,
    result: HitTestResult,
  ): void {
    this.sessions.syncHoverEntries(
      pointer,
      result.interactiveEntries(),
      pos,
      (target, event) => target.onPointerLeave?.(event),
      (target, event) => target.onPointerEnter?.(event),
      this._rootFromResult(result),
    )
  }

  private _setPopupAnchorRoot(result: HitTestResult): void {
    this.popupAnchorRoot = this._rootFromResult(result)
  }

  private _setFocusActiveRoot(result: HitTestResult): void {
    FocusManager.instance.setActiveRoot(this._rootFromResult(result))
  }

  private _rootFromResult(result: HitTestResult): RenderObject | null {
    return result.first?.target instanceof RenderObject
      ? result.first.target
      : null
  }

  private _cancelPointerSessionsForRoot(root: RenderObject): void {
    let firstError: unknown
    for (const identity of this.sessions.pointerIdentities()) {
      const session = this.sessions.get(identity)
      if (!session) continue
      const ownsActiveSequence =
        session.activePath?.first?.target === root ||
        session.capturedPath?.first?.target === root ||
        (
          !!session.capturedTarget &&
          this._targetBelongsToRoot(session.capturedTarget, root)
        )
      const ownsHover = session.hoverEntries.some(entry =>
        this._targetBelongsToRoot(entry.target, root)
      ) || session.hoverOwner === root
      try {
        if (ownsActiveSequence && !this.sessions.isTerminating(identity)) {
          this._handlePointerCancel({
            pointerId: identity.pointerId,
            position: session.lastPosition ?? { x: 0, y: 0 },
            type: 'cancel',
            button: session.button ?? 0,
            buttons: 0,
            pointerType: identity.pointerType,
            timeStamp: this._now(),
          }, true)
        } else if (ownsHover) {
          this._clearHoveredTargets(
            identity,
            session.lastPosition ?? { x: 0, y: 0 },
          )
        }
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError !== undefined) throw firstError
  }

  private _cancelPointerSessionsForDispose(): void {
    let firstError: unknown
    for (const identity of this.sessions.pointerIdentities()) {
      const session = this.sessions.get(identity)
      if (!session) continue
      try {
        if (
          this.sessions.hasActiveSequence(identity) &&
          !this.sessions.isTerminating(identity)
        ) {
          this._handlePointerCancel({
            pointerId: identity.pointerId,
            position: session.lastPosition ?? { x: 0, y: 0 },
            type: 'cancel',
            button: session.button ?? 0,
            buttons: 0,
            pointerType: identity.pointerType,
            timeStamp: this._now(),
          }, true, true)
        } else if (session.hoverEntries.length > 0) {
          this._clearHoveredTargets(
            identity,
            session.lastPosition ?? { x: 0, y: 0 },
          )
        }
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError !== undefined) throw firstError
  }

  private _targetBelongsToRoot(target: HitTestTarget, root: RenderObject): boolean {
    if (!(target instanceof RenderObject)) return false
    let current: RenderObject | undefined = target
    while (current) {
      if (current === root) return true
      current = current.parent
    }
    return false
  }

  private _updateFocusForPath(result: HitTestResult): void {
    if (result.path.some(entry => entry.target.preservesCurrentFocusOnPointerDown === true)) return
    const currentFocus = FocusManager.instance.current as HitTestTarget | null
    const retainsCurrentFocus = currentFocus
      ? result.path.some(entry => entry.target === currentFocus)
      : false
    if (currentFocus && !retainsCurrentFocus) FocusManager.instance.clearFocus()
    const hasFocusable = result.path.some(e => 'focusIn' in e.target)
    if (!hasFocusable) FocusManager.instance.clearFocus()
  }

  private _updateTooltip(result: HitTestResult, pos: Offset): void {
    let tooltipEntry: import('./hit_test').HitTestEntry | undefined
    for (let i = result.path.length - 1; i >= 0; i--) {
      const entry = result.path[i]!
      if ((entry.target as any).tooltip) {
        tooltipEntry = entry
        break
      }
    }
    const tooltipService = TooltipService.currentOrNull
    if (!tooltipService) return
    if (tooltipEntry) {
      tooltipService.show(
        (tooltipEntry.target as any).tooltip,
        pos,
        (tooltipEntry.target as any).tooltipDelay as number | undefined,
      )
      tooltipService.updatePos(pos)
      return
    }
    tooltipService.hide()
  }

  private _handlePointerDown(pe: import('./hit_test').PointerEvent): void {
    if (this.disposed) return
    if (this.sessions.isTerminating(pe)) return
    if (this.sessions.hasActiveSequence(pe)) {
      const stalePosition = this.sessions.get(pe)?.lastPosition ?? pe.position
      this._handlePointerCancel({
        ...pe,
        position: stalePosition,
        type: 'cancel',
        buttons: 0,
      }, true)
    }
    if (this.disposed) return
    if (this.sessions.isTerminating(pe)) return
    this.sessions.rememberPointerEvent(pe)
    this.sessions.beginActivationCandidate(pe, pe.position, pe.clickCount)
    const sequenceToken: PointerSequenceToken | undefined =
      this.sessions.sequenceToken(pe)
    const frameToken = this.sessions.beginDispatchFrame(pe)
    const isDownFrameCurrent = (): boolean =>
      this.sessions.isDispatchFrameCurrent(frameToken) &&
      this.sessions.isTokenCurrent(sequenceToken)
    const abortDownSequence = (): void => {
      if (
        !this.sessions.isTokenCurrent(sequenceToken) ||
        this.sessions.isTerminating(pe)
      ) {
        return
      }
      this.activationSequencer.cancel(pe)
      if (this.sessions.hasActiveSequence(pe)) {
        this._handlePointerCancel({
          ...pe,
          type: 'cancel',
          buttons: 0,
        }, true, this.disposed)
        return
      }
      this.sessions.endSequence(pe)
      this.pointerDispatcher.clearPointerReferences(pe)
    }
    try {
      const route = this.routeArbiter.routePointerDown(pe, selected => {
        if (isDownFrameCurrent()) {
          this.sessions.setRoute(pe, selected.scope, selected.target)
        }
      })
      if (!isDownFrameCurrent()) {
        abortDownSequence()
        return
      }
      if (route.consumed) {
        if (
          (pe.pointerType ?? 'mouse') === 'mouse' &&
          (pe.clickCount ?? 0) >= 2
        ) {
          this._armNativeDoubleClickSuppression(
            pe.position,
            pe.timeStamp ?? this._now(),
          )
        }
        this.activationSequencer.cancel(pe)
        return
      }
      this.sessions.setRoute(pe, 'main')

      const hitRootGeneration = this.rootGeneration
      const result = this._hitTest(pe.position)
      if (
        !isDownFrameCurrent() ||
        this.rootGeneration !== hitRootGeneration
      ) {
        abortDownSequence()
        return
      }
      this._setPopupAnchorRoot(result)
      this._setFocusActiveRoot(result)
      if (!isDownFrameCurrent()) {
        abortDownSequence()
        return
      }

      const captured = this.sessions.getCapture(pe)
      if (captured) {
        this.activationSequencer.cancel(pe)
        this.pointerDispatcher.dispatchToCapturedTarget(captured, pe)
        if (isDownFrameCurrent()) {
          this.sessions.gestureArena.close(pe)
        } else {
          abortDownSequence()
        }
        return
      }

      this.sessions.setActivePath(pe, result)
      this._breakActivationSequenceForNewPress(pe, result)
      this._updateFocusForPath(result)
      if (!isDownFrameCurrent()) {
        abortDownSequence()
        return
      }
      this.pointerDispatcher.dispatchToPath(result, pe)
      if (isDownFrameCurrent()) {
        this.sessions.gestureArena.close(pe)
      } else {
        abortDownSequence()
      }
    } catch (error) {
      if (!this.sessions.isTokenCurrent(sequenceToken)) throw error
      let cleanupError: unknown
      try {
        this.activationSequencer.cancel(pe)
      } catch (caught) {
        cleanupError ??= caught
      }
      if (
        this.sessions.isTokenCurrent(sequenceToken) &&
        this.sessions.hasActiveSequence(pe) &&
        !this.sessions.isTerminating(pe)
      ) {
        try {
          this._handlePointerCancel({
            ...pe,
            type: 'cancel',
            buttons: 0,
          }, true, this.disposed)
        } catch (caught) {
          cleanupError ??= caught
        }
      }
      if (this.sessions.isTokenCurrent(sequenceToken)) {
        try {
          this.pointerDispatcher.clearPointerReferences(pe)
        } catch (caught) {
          cleanupError ??= caught
        }
        try {
          this.sessions.endSequence(pe)
        } catch (caught) {
          cleanupError ??= caught
        }
      }
      void cleanupError
      throw error
    }
  }

  private _handlePointerMove(pe: import('./hit_test').PointerEvent): void {
    if (this.disposed) return
    if (this.sessions.isTerminating(pe)) return
    const moveSession = this.sessions.rememberPointerEvent(pe)
    const sequenceToken = this.sessions.sequenceToken(pe)
    const frameToken = this.sessions.beginDispatchFrame(pe)
    const isMoveFrameCurrent = (): boolean =>
      this.sessions.isDispatchFrameCurrent(frameToken) &&
      (
        sequenceToken
          ? this.sessions.isTokenCurrent(sequenceToken)
          : this.sessions.get(pe) === moveSession
      )
    try {
      this._emitDebugPointerMove(pe.position)
      if (!isMoveFrameCurrent()) return
      const session = moveSession

      const captured = this.sessions.getCapture(pe)
      if (captured) {
        this.pointerDispatcher.dispatchToCapturedTarget(captured, pe)
        return
      }

      const route = this.routeArbiter.routePointerMove(pe, session)
      if (!isMoveFrameCurrent()) return
      if (route.consumed) {
        if (session?.routeScope) this.sessions.setRoute(pe, route.scope, route.target)
        this._clearHoveredTargets(pe, pe.position)
        return
      }

      const activePath = this.sessions.getActivePath(pe)
      if (activePath && !activePath.isEmpty) {
        if (session?.routeScope) this.sessions.setRoute(pe, 'main')
        this.pointerDispatcher.dispatchToPath(activePath, pe)
        return
      }

      const hitRootGeneration = this.rootGeneration
      const result = this._hitTest(pe.position)
      if (
        !isMoveFrameCurrent() ||
        this.rootGeneration !== hitRootGeneration
      ) {
        return
      }
      this._setPopupAnchorRoot(result)
      if (!isMoveFrameCurrent()) return

    // 普通 hover 路径下先把 cursor 复位到默认值，
    // 再让命中的组件覆盖它；否则上一次组件留下的 resize/drag cursor
    // 会在空白区域继续残留。
      this.canvas.style.cursor = 'default'

      const expectedHoverGeneration = moveSession.hoverGeneration + 1
      this._syncHoveredTargets(pe, pe.position, result)
      if (
        !isMoveFrameCurrent() ||
        moveSession.hoverGeneration !== expectedHoverGeneration ||
        this.rootGeneration !== hitRootGeneration
      ) {
        return
      }
      this.pointerDispatcher.dispatchToPath(result, pe)
      if (!isMoveFrameCurrent()) return
      this._updateTooltip(result, pe.position)
    } catch (error) {
      if (
        sequenceToken &&
        this.sessions.isTokenCurrent(sequenceToken) &&
        !this.sessions.isTerminating(pe)
      ) {
        try {
          this.activationSequencer.cancel(pe)
          this._handlePointerCancel({
            ...pe,
            type: 'cancel',
            buttons: 0,
          }, true, this.disposed)
        } catch {
          // Preserve the move failure after best-effort terminal cleanup.
        }
      }
      throw error
    }
  }

  private _handlePointerUp(pe: import('./hit_test').PointerEvent): void {
    if (this.disposed) return
    if (this.sessions.isTerminating(pe)) return
    this.sessions.rememberPointerEvent(pe)
    const termination = this.sessions.beginTermination(pe, 'up')
    const frameToken = this.sessions.beginDispatchFrame(pe)
    const isFrameCurrent = (): boolean =>
      this.sessions.isDispatchFrameCurrent(frameToken)
    if (!termination) {
      const session = this.sessions.get(pe)
      const generation = session?.sequenceGeneration
      const ownsSession = (): boolean =>
        isFrameCurrent() &&
        this.sessions.get(pe) === session &&
        session?.sequenceGeneration === generation
      let failure: unknown
      let failed = false
      try {
        this.routeArbiter.routePointerUp(pe, session)
      } catch (error) {
        failure = error
        failed = true
      }
      if (ownsSession()) {
        try {
          this.pointerDispatcher.clearPointerReferences(pe)
        } catch (error) {
          if (!failed) {
            failure = error
            failed = true
          }
        }
        try {
          this.sessions.endSequence(pe)
        } catch (error) {
          if (!failed) {
            failure = error
            failed = true
          }
        }
      }
      if (failed) this.activationSequencer.cancel(pe)
      if (failed) throw failure
      return
    }
    let failure: unknown
    let failed = false
    const recordFailure = (error: unknown): void => {
      if (!failed) failure = error
      failed = true
    }
    let releasePath: HitTestResult | undefined
    if (termination.routeScope === 'main' && isFrameCurrent()) {
      const hitRootGeneration = this.rootGeneration
      try {
        const candidate = this._hitTest(pe.position)
        if (
          isFrameCurrent() &&
          this.rootGeneration === hitRootGeneration
        ) {
          releasePath = candidate
        }
      } catch (error) {
        recordFailure(error)
      }
    }
    if (!this.disposed && isFrameCurrent()) {
      try {
        this.routeArbiter.routePointerUp(pe, termination.session)
      } catch (error) {
        recordFailure(error)
      }
    }
    if (isFrameCurrent()) {
      try {
        if (termination.capturedTarget) {
          this.pointerDispatcher.dispatchToCapturedTarget(termination.capturedTarget, pe)
        } else if (termination.activePath && !termination.activePath.isEmpty) {
          this.pointerDispatcher.dispatchToPath(termination.activePath, pe)
        }
      } catch (error) {
        recordFailure(error)
      }
    }
    if (!failed && !this.disposed && isFrameCurrent()) {
      try {
        this._completePointerActivation(
          pe,
          termination.session,
          termination.activePath,
          releasePath,
        )
      } catch (error) {
        recordFailure(error)
      }
    }
    if (this.disposed && isFrameCurrent()) {
      try {
        this._clearHoveredTargets(pe, pe.position)
      } catch (error) {
        recordFailure(error)
      }
    }
    if (failed) {
      try {
        this.activationSequencer.cancel(pe)
      } catch (error) {
        recordFailure(error)
      }
    }
    try {
      this.sessions.finishTermination(termination)
    } catch (error) {
      recordFailure(error)
    }
    try {
      this.pointerDispatcher.clearPointerReferences(termination.identity)
    } catch (error) {
      recordFailure(error)
    }
    if (failed) {
      try {
        this.activationSequencer.cancel(pe)
      } catch (error) {
        recordFailure(error)
      }
      throw failure
    }
  }

  private _handlePointerCancel(
    pe: import('./hit_test').PointerEvent,
    clearHover = true,
    allowDisposed = false,
  ): void {
    if (this.disposed && !allowDisposed) return
    if (this.sessions.isTerminating(pe)) return
    this.sessions.rememberPointerEvent(pe)
    this.activationSequencer.cancel(pe)
    const termination = this.sessions.beginTermination(pe, 'cancel')
    const frameToken = this.sessions.beginDispatchFrame(pe)
    const isFrameCurrent = (): boolean =>
      this.sessions.isDispatchFrameCurrent(frameToken)
    if (!termination) {
      const session = this.sessions.get(pe)
      const generation = session?.sequenceGeneration
      const ownsSession = (): boolean =>
        isFrameCurrent() &&
        this.sessions.get(pe) === session &&
        session?.sequenceGeneration === generation
      let failure: unknown
      let failed = false
      try {
        this.routeArbiter.routePointerCancel(pe, session)
      } catch (error) {
        failure = error
        failed = true
      }
      if (clearHover && ownsSession()) {
        try {
          this._clearHoveredTargets(pe, pe.position)
        } catch (error) {
          if (!failed) {
            failure = error
            failed = true
          }
        }
      }
      if (ownsSession()) {
        try {
          this.pointerDispatcher.clearPointerReferences(pe)
        } catch (error) {
          if (!failed) {
            failure = error
            failed = true
          }
        }
        try {
          this.sessions.endSequence(pe)
        } catch (error) {
          if (!failed) {
            failure = error
            failed = true
          }
        }
      }
      if (failed) throw failure
      return
    }
    let failure: unknown
    let failed = false
    const recordFailure = (error: unknown): void => {
      if (!failed) failure = error
      failed = true
    }
    if ((!this.disposed || allowDisposed) && isFrameCurrent()) {
      try {
        this.routeArbiter.routePointerCancel(pe, termination.session)
      } catch (error) {
        recordFailure(error)
      }
    }
    if (isFrameCurrent()) {
      try {
        if (termination.capturedTarget) {
          this.pointerDispatcher.dispatchToCapturedTarget(termination.capturedTarget, pe)
        } else if (termination.activePath && !termination.activePath.isEmpty) {
          this.pointerDispatcher.dispatchToPath(termination.activePath, pe)
        }
      } catch (error) {
        recordFailure(error)
      }
    }
    if (clearHover && isFrameCurrent()) {
      try {
        this._clearHoveredTargets(pe, pe.position)
      } catch (error) {
        recordFailure(error)
      }
    }
    try {
      this.sessions.finishTermination(termination)
    } catch (error) {
      recordFailure(error)
    }
    try {
      this.pointerDispatcher.clearPointerReferences(termination.identity)
    } catch (error) {
      recordFailure(error)
    }
    if (failed) throw failure
  }

  private _cancelPointerSequencesFromWindow(): void {
    let firstError: unknown
    let failed = false
    for (const identity of this.sessions.pointerIdentities()) {
      const session = this.sessions.get(identity)
      if (!session || this.sessions.isTerminating(identity)) continue
      try {
        if (this.sessions.hasActiveSequence(identity)) {
          this._handlePointerCancel({
            pointerId: identity.pointerId,
            position: session.lastPosition ?? { x: 0, y: 0 },
            type: 'cancel',
            button: session.button ?? 0,
            buttons: 0,
            pointerType: identity.pointerType,
            timeStamp: this._now(),
          }, true)
        } else if (session.hoverEntries.length > 0) {
          this._clearHoveredTargets(
            identity,
            session.lastPosition ?? { x: 0, y: 0 },
          )
        }
      } catch (error) {
        if (!failed) firstError = error
        failed = true
      }
    }
    if (failed) throw firstError
  }

  private _dispatchChangedTouches(
    event: TouchEvent,
    type: 'down' | 'move' | 'up' | 'cancel',
  ): void {
    let firstError: unknown
    let failed = false
    for (const touch of Array.from(event.changedTouches)) {
      const pe: import('./hit_test').PointerEvent = {
        pointerId: touch.identifier,
        position: this._getCanvasPos(touch),
        type,
        button: 0,
        buttons: type === 'down' || type === 'move' ? 1 : 0,
        pointerType: 'touch',
        timeStamp: event.timeStamp,
      }
      try {
        switch (type) {
          case 'down':
            this._handlePointerDown(pe)
            this._notifyPointerDownDispatchComplete(pe)
            break
          case 'move':
            this._handlePointerMove(pe)
            break
          case 'up':
            this._handlePointerUp(pe)
            break
          case 'cancel':
            this._handlePointerCancel(pe, true)
            break
        }
      } catch (error) {
        if (!failed) firstError = error
        failed = true
      }
    }
    if (failed) throw firstError
  }

  private _breakActivationSequenceForNewPress(
    pointer: PointerIdentitySource,
    path: HitTestResult,
  ): void {
    const next = this._activationEntry(path)
    const root = this._rootFromResult(path)
    const previous = this.activationSequencer.getLastActivation(pointer)
    if (!previous) return
    if (
      !next ||
      previous.scope.kind !== 'main' ||
      previous.scope.target !== root ||
      previous.hit.target !== next.target ||
      !Object.is(previous.hit.key, next.key)
    ) {
      this.activationSequencer.cancel(pointer)
    }
  }

  private _completePointerActivation(
    event: PointerEvent,
    session: PointerDispatchSession | undefined,
    downPath: HitTestResult | undefined,
    releasePath: HitTestResult | undefined,
  ): void {
    const downEntry = downPath ? this._activationEntry(downPath) : undefined
    const nativeClickCountHint = session?.activationNativeClickCountHint
    const timestamp = event.timeStamp ?? this._now()

    if (
      downEntry &&
      (event.pointerType ?? 'mouse') === 'mouse' &&
      (nativeClickCountHint ?? 0) >= 2
    ) {
      this._armNativeDoubleClickSuppression(event.position, timestamp)
    }

    const releaseEntry = releasePath ? this._activationEntry(releasePath) : undefined
    const clickSlopSquared = EventDispatcher.ACTIVATION_PRESS_SLOP *
      EventDispatcher.ACTIVATION_PRESS_SLOP
    if (
      !session ||
      session.routeScope !== 'main' ||
      session.activationPrevented ||
      !session.activationDownPosition ||
      session.activationMaxDistanceSquared > clickSlopSquared ||
      !downPath ||
      !downEntry ||
      !sameHitTestEntryIdentity(downEntry, releaseEntry)
    ) {
      this.activationSequencer.cancel(event)
      return
    }

    const pointerType = event.pointerType ?? 'mouse'
    const button = event.button ?? 0
    const root = this._rootFromResult(downPath)
    if (root && !this.roots.includes(root)) {
      this.activationSequencer.cancel(event)
      return
    }
    const result = this.activationSequencer.recordActivation({
      pointerId: event.pointerId,
      pointerType,
      button,
      scope: { kind: 'main', target: root ?? undefined },
      hit: { target: downEntry.target as object, key: downEntry.key },
      position: event.position,
      timestamp,
      nativeClickCountHint,
    })

    if (pointerType === 'mouse' && result.clickCount >= 2) {
      this._armNativeDoubleClickSuppression(event.position, timestamp)
    }

    if (typeof downEntry.target.onPointerActivate === 'function') {
      this.pointerDispatcher.dispatchActivationToPath(downPath, downEntry, {
        type: 'activate',
        pointerId: event.pointerId,
        pointerType,
        button,
        clickCount: result.clickCount,
        position: { ...event.position },
        downPosition: { ...session.activationDownPosition },
        timeStamp: timestamp,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      })
      return
    }

    if (
      result.clickCount === 2 &&
      typeof downEntry.target.onDoubleClick === 'function' &&
      !this.routeArbiter.routePoint(event.position, { notify: false })
    ) {
      downEntry.target.onDoubleClick(event.position)
    }
  }

  private _activationEntry(path: HitTestResult): HitTestEntry | undefined {
    for (let index = path.path.length - 1; index >= 0; index--) {
      const entry = path.path[index]!
      if (
        typeof entry.target.onPointerActivate === 'function' ||
        typeof entry.target.onDoubleClick === 'function'
      ) {
        return entry
      }
    }
    return undefined
  }

  private _armNativeDoubleClickSuppression(position: Offset, timestamp: number): void {
    this.nativeDoubleClickSuppression = {
      position: { x: position.x, y: position.y },
      timestamp,
    }
  }

  private _consumeNativeDoubleClick(position: Offset, timestamp: number): boolean {
    const suppression = this.nativeDoubleClickSuppression
    this.nativeDoubleClickSuppression = undefined
    if (!suppression) return false
    const elapsed = timestamp - suppression.timestamp
    if (elapsed < 0 || elapsed > this.activationSequencer.maxIntervalMs) return false
    const dx = position.x - suppression.position.x
    const dy = position.y - suppression.position.y
    return dx * dx + dy * dy <=
      this.activationSequencer.maxDistance * this.activationSequencer.maxDistance
  }

  private _now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  // ---- 坐标换算 ----

  private _getCanvasPos(e: MouseEvent | Touch): Offset {
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }

  private _emitDebugPointerMove(position: Offset): void {
    for (const listener of this.debugPointerMoveListeners) listener(position)
  }

  private _notifyPointerDownDispatchComplete(event: import('./hit_test').PointerEvent): void {
    if (this.disposed) return
    this.options.onPointerDownDispatchComplete?.(event)
  }

// ---- 事件绑定 ----

  private _bindEvents(): void {
    // ---- Mouse ----
    this._listen('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      if (e.detail <= 1) this.nativeDoubleClickSuppression = undefined
      const pos = this._getCanvasPos(e)
      const pe: import('./hit_test').PointerEvent = {
        pointerId: 0, position: pos, type: 'down',
        button: e.button, buttons: e.buttons, pointerType: 'mouse',
        clickCount: e.detail,
        timeStamp: e.timeStamp,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey, altKey: e.altKey,
      }
      this._handlePointerDown(pe)
      this._notifyPointerDownDispatchComplete(pe)
    })

    this._listen('mousemove', (e) => {
      const pos = this._getCanvasPos(e)
      const pe: import('./hit_test').PointerEvent = {
        pointerId: 0, position: pos, type: 'move',
        button: e.button, buttons: e.buttons, pointerType: 'mouse',
        timeStamp: e.timeStamp,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey, altKey: e.altKey,
      }
      this._handlePointerMove(pe)
    })

    this._listenWindow('mousemove', (e) => {
      if (e.target === this.canvas) return
      if (!this.sessions.hasActiveSequence(0)) return
      const pos = this._getCanvasPos(e)
      const pe: import('./hit_test').PointerEvent = {
        pointerId: 0, position: pos, type: 'move',
        button: e.button, buttons: e.buttons, pointerType: 'mouse',
        timeStamp: e.timeStamp,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey, altKey: e.altKey,
      }
      this._handlePointerMove(pe)
    })

    this._listen('mouseup', (e) => {
      if (e.button !== 0) return
      const pos = this._getCanvasPos(e)
      const pe: import('./hit_test').PointerEvent = {
        pointerId: 0, position: pos, type: 'up',
        button: e.button, buttons: e.buttons, pointerType: 'mouse',
        timeStamp: e.timeStamp,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey, altKey: e.altKey,
      }
      this._handlePointerUp(pe)
    })

    this._listenWindow('mouseup', (e) => {
      if (e.target === this.canvas) return
      if (!this.sessions.hasActiveSequence(0)) return
      if (e.button !== 0) return
      const pos = this._getCanvasPos(e)
      const pe: import('./hit_test').PointerEvent = {
        pointerId: 0, position: pos, type: 'up',
        button: e.button, buttons: e.buttons, pointerType: 'mouse',
        timeStamp: e.timeStamp,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey, altKey: e.altKey,
      }
      this._handlePointerUp(pe)
    })

    this._listen('mouseleave', (e) => {
      if (this.sessions.isTerminating(0)) return
      const pos = this._getCanvasPos(e)
      if (this.sessions.hasActiveSequence(0)) {
        this.sessions.rememberPosition(0, pos)
        this._clearHoveredTargets(0, pos)
        return
      }
      this.routeArbiter.routePointerMove({
        pointerId: 0, position: pos, type: 'move',
        button: e.button, buttons: e.buttons, pointerType: 'mouse',
      }, this.sessions.get(0))
      this._clearHoveredTargets(0, pos)
    })

    this._listenWindow('blur', () => {
      this._cancelPointerSequencesFromWindow()
    })

    // 滚轮事件
    this._listen('wheel', (e) => {
      e.preventDefault()
      if (this.sessions.isTerminating(0)) return
      const wheelFrame = ++this.wheelFrameGeneration
      const isWheelFrameCurrent = (): boolean =>
        !this.disposed && this.wheelFrameGeneration === wheelFrame
      this.sessions.preventActivation(0)
      this.activationSequencer.cancel(0)
      const pos = this._getCanvasPos(e)
      const we: import('./hit_test').WheelPointerEvent = {
        pointerId: 0, position: pos, type: 'wheel',
        deltaX: e.deltaX, deltaY: e.deltaY,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey, altKey: e.altKey,
      }
      TooltipService.currentOrNull?.hide()
      if (this.routeArbiter.routeWheel(we)) return
      if (!isWheelFrameCurrent()) return

      const hitRootGeneration = this.rootGeneration
      const result = this._hitTest(pos)
      if (
        !isWheelFrameCurrent() ||
        this.rootGeneration !== hitRootGeneration
      ) {
        return
      }
      this._setPopupAnchorRoot(result)
      if (!isWheelFrameCurrent()) return

      for (let i = result.path.length - 1; i >= 0; i--) {
        const target = result.path[i]!.target
        if (typeof (target as any).onWheel === 'function') {
          const consumed = (target as any).onWheel(we)
          if (!isWheelFrameCurrent()) return
          if (consumed !== false) break
        }
      }
    }, { passive: false })

    // ---- Touch ----
    this._listen('touchstart', (e) => {
      e.preventDefault()
      this._dispatchChangedTouches(e, 'down')
    }, { passive: false })

    this._listen('touchmove', (e) => {
      e.preventDefault()
      this._dispatchChangedTouches(e, 'move')
    }, { passive: false })

    this._listen('touchend', (e) => {
      this._dispatchChangedTouches(e, 'up')
    })

    this._listen('touchcancel', (e) => {
      this._dispatchChangedTouches(e, 'cancel')
    })

    // ---- Keyboard ----
    // keydown 事件由 FocusManager 通过 FocusScope 栈分发
    // FocusManager 使用 useCapture=true 监听 window keydown，
    // 优先于这里默认监听器的执行
    this._listen('keydown', (_e: KeyboardEvent) => {
      // keydown 已由 FocusManager 处理，此处不需要额外分发
    })

    // ---- ContextMenu (右键菜单) ----
    this._listen('contextmenu', (e) => {
      this.handleContextMenuEvent(e)
    })

    // ---- Double Click ----
    this._listen('dblclick', (e) => {
      e.preventDefault()
      const pos = this._getCanvasPos(e)
      if (this._consumeNativeDoubleClick(pos, e.timeStamp)) return
      if (this.routeArbiter.routePoint(pos, { notify: false })) return
      const result = this._hitTest(pos)
      this._setPopupAnchorRoot(result)
      this._setFocusActiveRoot(result)
      // A typed logical target owns double-click semantics through the
      // ActivationSequencer. Never let a raw canvas dblclick fall through to
      // one of its legacy ancestors.
      if (result.path.some(entry => typeof entry.target.onPointerActivate === 'function')) return
      // 从最深目标开始，找第一个实现 onDoubleClick 的
      for (let i = result.path.length - 1; i >= 0; i--) {
        const target = result.path[i]!.target
        if (typeof target.onDoubleClick === 'function') {
          target.onDoubleClick(pos)
          return
        }
      }
      // 没有命中处理 dblclick 的目标，触发全局 dblclick 回调
      if (this._onDoubleClick) this._onDoubleClick(pos)
    })
  }

  // ---- 全局 contextmenu 回调 ----
  // 未被命中路径中的 target 消费时触发

  private _onContextMenu?: (position: Offset) => void
  private _onDoubleClick?: (position: Offset) => void

  /** 注册全局 contextmenu 回调（右键菜单） */
  setOnContextMenu(handler: (position: Offset) => void): void {
    if (this.disposed) return
    this._onContextMenu = handler
  }

  handleContextMenuEvent(event: MouseEvent): void {
    if (this.disposed) return
    event.preventDefault()
    const pos = this._getCanvasPos(event)
    this._dispatchContextMenu(pos)
  }

  private _dispatchContextMenu(pos: Offset): void {
    if (this.routeArbiter.routePoint(pos)) return
    const result = this._hitTest(pos)
    this._setPopupAnchorRoot(result)
    this._setFocusActiveRoot(result)
    // 从最深目标开始，找第一个实现并处理 onContextMenu 的目标
    for (let i = result.path.length - 1; i >= 0; i--) {
      const target = result.path[i]!.target
      if (typeof (target as any).onContextMenu === 'function') {
        const handled = (target as any).onContextMenu(pos)
        if (handled !== false) return
      }
    }
    // 没有命中处理 contextmenu 的目标，触发全局 contextmenu 事件
    if (this._onContextMenu) this._onContextMenu(pos)
  }

  /** 注册全局 dblclick 回调（双击事件） */
  setOnDoubleClick(handler: (position: Offset) => void): void {
    if (this.disposed) return
    this._onDoubleClick = handler
  }
}
