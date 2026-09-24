import type { Offset, RenderObject } from './render_object'
import { PipelineOwner } from './render_object'
import {
  HitTestResult,
  sameHitTestEntryIdentity,
  type HitTestEntry,
  type PointerEvent,
  type WheelPointerEvent,
} from '../gestures/hit_test'
import {
  PointerDispatchSessions,
  type PointerDispatchDebugSnapshot,
  type PointerDispatchSession,
  type PointerSequenceToken,
} from '../gestures/pointer_dispatch_session'
import { PointerPathDispatcher } from '../gestures/pointer_path_dispatcher'
import { ActivationSequencer } from '../gestures/activation_sequencer'
import {
  pointerKey,
  type PointerIdentitySource,
  type PointerKey,
  type PointerType,
} from '../gestures/pointer_identity'
import { OverlayInvalidator } from './overlay_invalidator'
import type { PaintContext } from '../rendering/paint_context'
import type { ResolvedTheme } from '../theme/theme'

// Routes low-level pointer events into a popup-owned render subtree that is not mounted under the main scene roots.
export class PopupRenderHost {
  private static readonly ACTIVATION_PRESS_SLOP = 6

  private _root: RenderObject | null
  private readonly _owner: PipelineOwner
  private readonly _sessions = new PointerDispatchSessions()
  private readonly _pointerDispatcher = new PointerPathDispatcher(this._sessions)
  private readonly _activationSequencer = new ActivationSequencer()
  private readonly _terminatingPointers = new Set<PointerKey>()
  private readonly _hoverDispatchPointers = new Set<PointerKey>()
  private readonly _setCursor?: (cursor: string) => void
  private _cursor = 'default'
  private _lifecycleEpoch = 0
  private _resetting = false
  private _disposed = false

  constructor(
    root?: RenderObject | null,
    setCursor?: (cursor: string) => void,
  ) {
    this._setCursor = setCursor
    this._owner = new PipelineOwner({
      onNeedLayout: () => OverlayInvalidator.instance.requestPaint(),
      onNeedPaint: () => OverlayInvalidator.instance.requestPaint(),
      setCursor: cursor => this._syncCursor(cursor),
    })
    this._root = root ?? null
    this._root?.attach(this._owner)
  }

  get root(): RenderObject | null {
    return this._root
  }

  get hasActivePointerInteraction(): boolean {
    if (this._terminatingPointers.size > 0) return true
    return this._sessions.pointerIdentities().some(pointer =>
      this._sessions.hasActiveSequence(pointer) ||
      this._sessions.isTerminating(pointer) ||
      this._sessions.getCapture(pointer) !== undefined,
    )
  }

  setRoot(root: RenderObject | null): void {
    if (this._disposed) return
    if (this._root === root) return
    this.reset()
    this._root?.detach()
    this._root = root
    this._root?.attach(this._owner)
  }

  setTheme(theme: ResolvedTheme): void {
    this._owner.setTheme(theme)
  }

  handlePointerDown(event: PointerEvent): boolean {
    const key = pointerKey(event)
    if (this._terminatingPointers.has(key)) return true
    if (this._sessions.hasActiveSequence(event)) {
      const stalePosition = this._sessions.get(event)?.lastPosition ?? event.position
      this.handlePointerCancel({
        ...event,
        position: stalePosition,
        type: 'cancel',
        buttons: 0,
      })
    }
    this._sessions.rememberPointerEvent(event)
    this._sessions.beginActivationCandidate(
      event,
      event.position,
      event.clickCount,
    )
    const sequenceToken: PointerSequenceToken | undefined =
      this._sessions.sequenceToken(event)
    try {
      const captured = this._sessions.getCapture(event, sequenceToken)
      if (captured) {
        this._activationSequencer.cancel(event)
        this._sessions.setRoute(event, 'popup')
        this._pointerDispatcher.dispatchToCapturedTarget(captured, event)
        return true
      }

      const result = this._hitTest(event.position)
      if (!this._sessions.isTokenCurrent(sequenceToken)) return true
      if (result.isEmpty) {
        this._activationSequencer.cancel(event)
        this._pointerDispatcher.clearPointerReferences(event)
        this._sessions.endSequence(event)
        return false
      }

      this._sessions.setRoute(event, 'popup')
      this._sessions.setActivePath(event, result)
      this._breakActivationSequenceForNewPress(event, result)
      this._pointerDispatcher.dispatchToPath(result, event)
      if (this._sessions.isTokenCurrent(sequenceToken)) {
        this._sessions.gestureArena.close(event)
      }
      return true
    } catch (error) {
      if (this._sessions.isTokenCurrent(sequenceToken)) {
        try {
          this._activationSequencer.cancel(event)
        } catch {
          // The original dispatch failure remains authoritative.
        }
        try {
          this._pointerDispatcher.clearPointerReferences(event)
        } catch {
          // Continue sequence cleanup even if auxiliary reference cleanup fails.
        }
        try {
          this._sessions.endSequence(event)
        } catch {
          // The original dispatch failure remains authoritative.
        }
      }
      throw error
    }
  }

  flushAfterFullPaint(context: PaintContext): void {
    this._owner.clearLayoutRequests()
    this._owner.clearPaintRequests()
    if (this._owner.hasTransientPaint()) this._owner.flushTransientPaint(context)
    else this._owner.replayTransientPaint(context)
  }

  handlePointerMove(event: PointerEvent): boolean {
    const key = pointerKey(event)
    if (this._terminatingPointers.has(key) || this._sessions.isTerminating(event)) return true
    this._sessions.rememberPointerEvent(event)
    const captured = this._sessions.getCapture(event)
    if (captured) {
      this._sessions.setRoute(event, 'popup')
      this._pointerDispatcher.dispatchToCapturedTarget(captured, event)
      return true
    }

    const activePath = this._sessions.getActivePath(event)
    if (activePath && !activePath.isEmpty) {
      this._pointerDispatcher.dispatchToPath(activePath, event)
      return true
    }

    const result = this._hitTest(event.position)
    const hoverChanged = this._syncHoveredTargets(event, event.position, result)
    if (result.isEmpty) return hoverChanged

    this._pointerDispatcher.dispatchToPath(result, event)
    return true
  }

  handlePointerUp(event: PointerEvent): boolean {
    const key = pointerKey(event)
    if (this._terminatingPointers.has(key) || this._sessions.isTerminating(event)) return true
    this._sessions.rememberPointerEvent(event)
    const termination = this._sessions.beginTermination(event, 'up')
    if (!termination) {
      let failure: unknown
      try {
        this._activationSequencer.cancel(event)
      } catch (error) {
        failure = error
      }
      try {
        this._pointerDispatcher.clearPointerReferences(event)
      } catch (error) {
        failure ??= error
      }
      try {
        this._sessions.endSequence(event)
      } catch (error) {
        failure ??= error
      }
      if (failure !== undefined) throw failure
      return false
    }

    const sequenceToken = this._sessions.sequenceToken(event)
    const activePath = termination.activePath
    const captured = termination.capturedTarget
    const lifecycleEpoch = this._lifecycleEpoch
    this._terminatingPointers.add(key)
    let failure: unknown
    let failed = false
    try {
      const releasePath = this._hitTest(event.position)
      if (
        lifecycleEpoch !== this._lifecycleEpoch ||
        !this._sessions.isTokenCurrent(sequenceToken, true)
      ) {
        this._activationSequencer.cancel(event)
      } else if (captured) {
        this._pointerDispatcher.dispatchToCapturedTarget(captured, event)
      } else if (activePath) {
        this._pointerDispatcher.dispatchToPath(activePath, event)
      }
      if (
        lifecycleEpoch === this._lifecycleEpoch &&
        this._sessions.isTokenCurrent(sequenceToken, true)
      ) {
        this._completePointerActivation(
          event,
          termination.session,
          activePath,
          releasePath,
        )
      } else {
        this._activationSequencer.cancel(event)
      }
    } catch (error) {
      this._activationSequencer.cancel(event)
      failure = error
      failed = true
    } finally {
      try {
        this._pointerDispatcher.clearPointerReferences(event)
      } catch (error) {
        if (!failed) {
          failure = error
          failed = true
        }
      }
      try {
        this._sessions.finishTermination(termination)
      } catch (error) {
        if (!failed) {
          failure = error
          failed = true
        }
      }
      this._terminatingPointers.delete(key)
    }
    if (failed) throw failure
    return true
  }

  handlePointerCancel(event: PointerEvent): boolean {
    const key = pointerKey(event)
    if (this._terminatingPointers.has(key) || this._sessions.isTerminating(event)) return true
    this._sessions.rememberPointerEvent(event)
    this._activationSequencer.cancel(event)
    const termination = this._sessions.beginTermination(event, 'cancel')
    const captured = termination?.capturedTarget
    const activePath = termination?.activePath
    const hadHovered =
      ((termination?.session ?? this._sessions.get(event))?.hoverTargets.length ?? 0) > 0
    const handled = !!captured || (!!activePath && !activePath.isEmpty) || hadHovered

    if (!termination) {
      let failure: unknown
      try {
        if (hadHovered) this._clearHoveredTargets(event, event.position)
      } catch (error) {
        failure = error
      }
      try {
        this._pointerDispatcher.clearPointerReferences(event)
      } catch (error) {
        failure ??= error
      }
      try {
        this._sessions.endSequence(event)
      } catch (error) {
        failure ??= error
      }
      if (failure !== undefined) throw failure
      return false
    }

    this._terminatingPointers.add(key)
    let failure: unknown
    let failed = false
    try {
      if (captured) {
        this._pointerDispatcher.dispatchToCapturedTarget(captured, event)
      } else if (activePath && !activePath.isEmpty) {
        this._pointerDispatcher.dispatchToPath(activePath, event)
      }
    } catch (error) {
      failure = error
      failed = true
    }
    try {
      this._clearHoveredTargets(event, event.position)
    } catch (error) {
      if (!failed) {
        failure = error
        failed = true
      }
    }
    try {
      this._pointerDispatcher.clearPointerReferences(event)
    } catch (error) {
      if (!failed) {
        failure = error
        failed = true
      }
    }
    try {
      this._sessions.finishTermination(termination)
    } catch (error) {
      if (!failed) {
        failure = error
        failed = true
      }
    }
    this._terminatingPointers.delete(key)
    if (failed) throw failure
    return true
  }

  handlePointerLeave(event: PointerEvent): boolean {
    const key = pointerKey(event)
    if (
      this._terminatingPointers.has(key) ||
      this._hoverDispatchPointers.has(key)
    ) {
      return true
    }
    this._sessions.rememberPointerEvent(event)
    const hadHovered = (this._sessions.get(event)?.hoverTargets.length ?? 0) > 0
    this._clearHoveredTargets(event, event.position)
    return hadHovered
  }

  handleWheel(event: WheelPointerEvent): boolean {
    const key = pointerKey(event)
    if (this._terminatingPointers.has(key) || this._sessions.isTerminating(event)) return true
    this._sessions.rememberPosition(event, event.position)
    this._sessions.preventActivation(event)
    this._activationSequencer.cancel(event)
    const result = this._hitTest(event.position)
    for (let i = result.path.length - 1; i >= 0; i--) {
      const target = result.path[i]!.target
      if (typeof target.onWheel === 'function') {
        const consumed = target.onWheel(event)
        if (consumed !== false) return true
      }
    }
    return false
  }

  reset(): void {
    this._lifecycleEpoch += 1
    if (this._resetting) return
    this._resetting = true
    const pointerIdentities = this._sessions.pointerIdentities()
    let failure: unknown
    let failed = false
    try {
      for (const identity of pointerIdentities) {
        const key = pointerKey(identity)
        if (
          this._terminatingPointers.has(key) ||
          this._hoverDispatchPointers.has(key)
        ) {
          continue
        }
        const event: PointerEvent = {
          pointerId: identity.pointerId,
          pointerType: identity.pointerType,
          position: this._sessions.get(identity)?.lastPosition ?? { x: 0, y: 0 },
          type: 'cancel',
        }
        try {
          if (this._sessions.hasActiveSequence(identity)) this.handlePointerCancel(event)
          else this.handlePointerLeave({ ...event, type: 'move' })
        } catch (error) {
          if (!failed) {
            failure = error
            failed = true
          }
        }
      }
    } finally {
      try {
        this._sessions.clear()
      } catch (error) {
        if (!failed) {
          failure = error
          failed = true
        }
      }
      try {
        this._activationSequencer.reset()
      } catch (error) {
        if (!failed) {
          failure = error
          failed = true
        }
      }
      try {
        this._syncCursor('default')
      } catch (error) {
        if (!failed) {
          failure = error
          failed = true
        }
      } finally {
        this._resetting = false
      }
    }
    if (failed) throw failure
  }

  getDebugSnapshot(
    pointerId = 0,
    pointerType: PointerType = 'mouse',
  ): PointerDispatchDebugSnapshot {
    return this._sessions.debugSnapshot(pointerId, pointerType)
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    try {
      this.reset()
    } finally {
      this._root?.detach()
      this._root = null
    }
  }

  private _hitTest(position: Offset): HitTestResult {
    const result = new HitTestResult()
    this._root?.hitTestPath(position, result)
    return result
  }

  private _syncCursor(cursor: string): void {
    if (this._cursor === cursor) return
    this._cursor = cursor
    this._setCursor?.(cursor)
  }

  private _breakActivationSequenceForNewPress(
    pointer: PointerIdentitySource,
    path: HitTestResult,
  ): void {
    const next = this._activationEntry(path)
    const previous = this._activationSequencer.getLastActivation(pointer)
    if (
      previous &&
      (
        !next ||
        previous.scope.kind !== 'popup' ||
        previous.scope.target !== this ||
        previous.hit.target !== next.target ||
        !Object.is(previous.hit.key, next.key)
      )
    ) {
      this._activationSequencer.cancel(pointer)
    }
  }

  private _completePointerActivation(
    event: PointerEvent,
    session: PointerDispatchSession | undefined,
    downPath: HitTestResult | undefined,
    releasePath: HitTestResult,
  ): void {
    const downEntry = downPath ? this._activationEntry(downPath) : undefined
    const releaseEntry = this._activationEntry(releasePath)
    const clickSlopSquared = PopupRenderHost.ACTIVATION_PRESS_SLOP *
      PopupRenderHost.ACTIVATION_PRESS_SLOP
    if (
      !session ||
      session.routeScope !== 'popup' ||
      session.activationPrevented ||
      !session.activationDownPosition ||
      session.activationMaxDistanceSquared > clickSlopSquared ||
      !downPath ||
      !downEntry ||
      !sameHitTestEntryIdentity(downEntry, releaseEntry)
    ) {
      this._activationSequencer.cancel(event)
      return
    }

    const pointerType = event.pointerType ?? 'mouse'
    const button = event.button ?? 0
    const result = this._activationSequencer.recordActivation({
      pointerId: event.pointerId,
      pointerType,
      button,
      scope: { kind: 'popup', target: this },
      hit: { target: downEntry.target as object, key: downEntry.key },
      position: event.position,
      timestamp: event.timeStamp ?? this._now(),
      nativeClickCountHint: session.activationNativeClickCountHint,
    })

    if (typeof downEntry.target.onPointerActivate === 'function') {
      this._pointerDispatcher.dispatchActivationToPath(downPath, downEntry, {
        type: 'activate',
        pointerId: event.pointerId,
        pointerType,
        button,
        clickCount: result.clickCount,
        position: { ...event.position },
        downPosition: { ...session.activationDownPosition },
        timeStamp: event.timeStamp ?? this._now(),
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      })
      return
    }

    if (
      result.clickCount === 2 &&
      typeof downEntry.target.onDoubleClick === 'function'
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

  private _now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  private _syncHoveredTargets(
    pointer: PointerIdentitySource,
    position: Offset,
    result: HitTestResult,
  ): boolean {
    const key = pointerKey(pointer)
    if (this._hoverDispatchPointers.has(key)) return false
    this._hoverDispatchPointers.add(key)
    try {
      return this._sessions.syncHoverEntries(
        pointer,
        result.interactiveEntries(),
        position,
        (target, event) => target.onPointerLeave?.(event),
        (target, event) => target.onPointerEnter?.(event),
        this,
      )
    } finally {
      this._hoverDispatchPointers.delete(key)
    }
  }

  private _clearHoveredTargets(pointer: PointerIdentitySource, position: Offset): void {
    const key = pointerKey(pointer)
    if (this._hoverDispatchPointers.has(key)) return
    this._hoverDispatchPointers.add(key)
    try {
      this._sessions.clearHover(pointer, position, (target, event) => {
        target.onPointerLeave?.(event)
      })
    } finally {
      this._hoverDispatchPointers.delete(key)
    }
  }

}
