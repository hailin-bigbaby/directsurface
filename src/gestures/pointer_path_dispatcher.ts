import { dispatchPointerListeners, pointerWindowPath, pointerTargetPath } from './pointer_event_listeners'
import type { GestureArenaMember } from './gesture_arena'
import {
  DispatchPhase,
  resolveHitTestLocalPosition,
  sameHitTestEntryIdentity,
  type HitTestEntry,
  type HitTestResult,
  type HitTestTarget,
  type PointerActivationEvent,
  type PointerEvent,
} from './hit_test'
import type {
  PointerDispatchSessions,
  PointerSequenceToken,
} from './pointer_dispatch_session'
import {
  pointerKey,
  type PointerIdentitySource,
  type PointerKey,
} from './pointer_identity'

type PointerBubbleHandlerName = 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
type PointerCaptureHandlerName = 'onPointerDownCapture' | 'onPointerMoveCapture' | 'onPointerUpCapture' | 'onPointerCancelCapture'
type PointerActivationPayload = Omit<
  PointerActivationEvent,
  'phase' | 'localPosition' | 'path' | 'targetEntry' | 'currentEntry' | 'stopPropagation'
>

export class PointerPathDispatcher {
  private readonly _entryReferencePositions = new Map<
    PointerKey,
    WeakMap<
      HitTestEntry,
      { globalPosition: { x: number; y: number }; localPosition: { x: number; y: number } }
    >
  >()

  constructor(private readonly _sessions: PointerDispatchSessions) {}

  dispatchToCapturedTarget(target: HitTestTarget, event: PointerEvent): void {
    const sequenceToken = this._sequenceTokenForDispatch(event)
    const frameToken = this._sessions.dispatchFrameToken(event)
    const allowEnding = event.type === 'up' || event.type === 'cancel'
    const isFrameCurrent = (): boolean =>
      this._sessions.isDispatchFrameCurrent(frameToken) &&
      this._sessions.isTokenCurrent(sequenceToken, allowEnding)
    const capturedPath = this._sessions.getCapturePath(event, sequenceToken)
    const capturedEntry = this._sessions.getCaptureEntry(event, sequenceToken)
    if (!isFrameCurrent()) return
    const entry = capturedEntry ?? capturedPath?.path.find(item => item.target === target)
    const path = capturedPath && entry
      ? capturedPath.through(entry)
      : pointerTargetPath(target, entry ?? { target, localPosition: this._resolveTargetLocalPosition(target, event.position) })
    this.dispatchToPath(path, event)
  }

  dispatchToPath(result: HitTestResult, event: PointerEvent): void {
    const path = pointerWindowPath(result)
    const sequenceToken = this._sequenceTokenForDispatch(event)
    const frameToken = this._sessions.dispatchFrameToken(event)
    const isCurrent = (): boolean => this._sessions.isDispatchFrameCurrent(frameToken) &&
      this._sessions.isTokenCurrent(sequenceToken, event.type === 'up' || event.type === 'cancel')
    if (event.type === 'down') {
      for (const entry of path.path) {
        this._resolveLocalPosition(entry, event.position, true, event)
        if (!isCurrent()) return
      }
    }
    let outcome
    try {
      outcome = dispatchPointerListeners(path, `pointer${event.type}`, event, {
        isCurrent,
        localPosition: entry => this._resolveLocalPosition(entry, event.position, false, event),
        controls: entry => ({
          preventActivation: () => {
            if (sequenceToken) this._sessions.preventActivation(event, sequenceToken)
          },
          setPointerCapture: () => {
            if (sequenceToken) this._sessions.setCapture(event, entry.target, path, entry, sequenceToken)
          },
          releasePointerCapture: () => {
            if (sequenceToken) this._sessions.releaseCapture(event, sequenceToken)
          },
          hasPointerCapture: () => {
            const captured = this._sessions.getCaptureEntry(event, sequenceToken)
            return captured ? sameHitTestEntryIdentity(captured, entry)
              : this._sessions.getCapture(event, sequenceToken) === entry.target
          },
        }),
      })
    } catch (error) {
      // Terminal observer failures must not strand a pressed control or a drag.
      if ((event.type === 'up' || event.type === 'cancel') && isCurrent()) {
        try { this._dispatchDefaultToPath(path, { ...event, type: 'cancel' }) } catch { /* Preserve listener failure. */ }
      }
      throw error
    }
    if (!isCurrent()) return
    if (outcome.invalidated) {
      // A hidden/reparented path still owns control state from down. Cancel that
      // state before dropping the route; do not affect a newer reentrant frame.
      if (sequenceToken) this._sessions.preventActivation(event, sequenceToken)
      const termination = this._sessions.beginTermination(event, 'cancel')
      try {
        this._dispatchDefaultToPath(path, { ...event, type: 'cancel' })
      } finally {
        if (termination) {
          if (this._sessions.isTokenCurrent(sequenceToken, true)) this.clearPointerReferences(event)
          this._sessions.finishTermination(termination)
        }
      }
      return
    }
    if (outcome.defaultPrevented && event.type !== 'cancel') {
      if (event.type !== 'down') this._dispatchDefaultToPath(path, { ...event, type: 'cancel' })
      return
    }
    this._dispatchDefaultToPath(path, event)
  }

  dispatchHover(target: HitTestTarget, event: PointerEvent, type: 'pointerenter' | 'pointerleave'): void {
    const session = this._sessions.get(event)
    const generation = session?.hoverGeneration
    const frame = this._sessions.dispatchFrameToken(event)
    const isCurrent = (): boolean => this._sessions.isDispatchFrameCurrent(frame) &&
      this._sessions.get(event) === session && session?.hoverGeneration === generation
    let outcome
    try {
      outcome = dispatchPointerListeners(pointerTargetPath(target, event.hitTestEntry), type, event, { isCurrent })
    } catch (error) {
      if (type === 'pointerleave' && isCurrent()) {
        try { target.onPointerLeave?.(event) } catch { /* Preserve listener failure. */ }
      }
      throw error
    }
    if (!isCurrent()) return
    // A hidden/reparented target still needs its terminal hover cleanup. Only a
    // newer hover transition may supersede this leave, not path invalidation.
    if (type === 'pointerleave') target.onPointerLeave?.(event)
    else if (!outcome.invalidated && !outcome.defaultPrevented) target.onPointerEnter?.(event)
  }

  private _dispatchDefaultToPath(result: HitTestResult, event: PointerEvent): void {
    const dispatchPath = pointerWindowPath(result)
    const entries = dispatchPath.path
    if (entries.length === 0) return
    const sequenceToken = this._sequenceTokenForDispatch(event)
    const frameToken = this._sessions.dispatchFrameToken(event)
    const allowEnding = event.type === 'up' || event.type === 'cancel'
    const aggregateErrors = allowEnding
    let propagationStopped = false
    let firstError: unknown
    const isFrameCurrent = (): boolean =>
      this._sessions.isDispatchFrameCurrent(frameToken) &&
      this._sessions.isTokenCurrent(sequenceToken, allowEnding)
    const finish = (): void => {
      if (firstError !== undefined) throw firstError
    }

    if (event.type === 'down') {
      for (const entry of entries) {
        this._resolveLocalPosition(entry, event.position, true, event)
        if (!isFrameCurrent()) return
      }
    }

    const captureHandler = this._pointerCaptureHandlerName(event.type)
    const bubbleHandler = this._pointerBubbleHandlerName(event.type)
    const dispatch = (
      entry: HitTestEntry,
      phase: DispatchPhase,
      handlerName: PointerBubbleHandlerName | PointerCaptureHandlerName,
    ): boolean => {
      try {
        const handler = entry.target[handlerName]
        if (typeof handler !== 'function') {
          return isFrameCurrent()
        }
        const localPosition = this._resolveLocalPosition(
          entry,
          event.position,
          event.type === 'down',
          event,
        )
        if (!isFrameCurrent()) return false
        handler.call(entry.target, {
          ...event,
          phase,
          localPosition,
          path: dispatchPath,
          hitTestEntry: entry,
          stopPropagation: () => { propagationStopped = true },
          preventActivation: () => {
            if (sequenceToken) {
              this._sessions.preventActivation(event, sequenceToken)
            }
          },
          setPointerCapture: () => {
            if (sequenceToken) {
              this._sessions.setCapture(
                event,
                entry.target,
                dispatchPath,
                entry,
                sequenceToken,
              )
            }
          },
          releasePointerCapture: () => {
            if (sequenceToken) {
              this._sessions.releaseCapture(event, sequenceToken)
            }
          },
          hasPointerCapture: () => {
            if (!sequenceToken) return false
            const capturedEntry = this._sessions.getCaptureEntry(event, sequenceToken)
            if (capturedEntry) return sameHitTestEntryIdentity(capturedEntry, entry)
            return this._sessions.getCapture(event, sequenceToken) === entry.target
          },
          gestureArena: this._sessions.gestureArena,
          joinGestureArena: (member: GestureArenaMember) => sequenceToken
            ? this._sessions.joinGestureArena(event, member, sequenceToken)
            : this._sessions.rejectGestureArenaMember(event, member),
        })
      } catch (error) {
        if (!aggregateErrors) throw error
        firstError ??= error
      }
      return isFrameCurrent()
    }

    for (let i = 0; i < entries.length - 1; i++) {
      if (!dispatch(entries[i]!, DispatchPhase.Capture, captureHandler)) {
        finish()
        return
      }
      if (propagationStopped) {
        finish()
        return
      }
    }

    if (!dispatch(entries[entries.length - 1]!, DispatchPhase.Target, bubbleHandler)) {
      finish()
      return
    }
    if (propagationStopped) {
      finish()
      return
    }

    for (let i = entries.length - 2; i >= 0; i--) {
      if (!dispatch(entries[i]!, DispatchPhase.Bubble, bubbleHandler)) {
        finish()
        return
      }
      if (propagationStopped) {
        finish()
        return
      }
    }
    finish()
  }

  private _pointerBubbleHandlerName(type: PointerEvent['type']): PointerBubbleHandlerName {
    switch (type) {
      case 'down': return 'onPointerDown'
      case 'move': return 'onPointerMove'
      case 'up': return 'onPointerUp'
      case 'cancel': return 'onPointerCancel'
    }
  }

  private _pointerCaptureHandlerName(type: PointerEvent['type']): PointerCaptureHandlerName {
    switch (type) {
      case 'down': return 'onPointerDownCapture'
      case 'move': return 'onPointerMoveCapture'
      case 'up': return 'onPointerUpCapture'
      case 'cancel': return 'onPointerCancelCapture'
    }
  }

  dispatchActivationToPath(
    result: HitTestResult,
    targetEntry: HitTestEntry,
    event: PointerActivationPayload,
  ): void {
    const route = pointerWindowPath(result.through(targetEntry))
    const entries = route.path
    if (entries.length === 0) return
    const resolvedTargetEntry = entries[entries.length - 1]!
    const sequenceToken = this._sessions.sequenceToken(event)
    const frameToken = this._sessions.dispatchFrameToken(event)
    let propagationStopped = false
    const isFrameCurrent = (): boolean =>
      this._sessions.isDispatchFrameCurrent(frameToken) &&
      this._sessions.isTokenCurrent(sequenceToken, true)

    const observed = dispatchPointerListeners(route, 'pointeractivate', event, { isCurrent: isFrameCurrent })
    if (observed.invalidated || observed.defaultPrevented || !isFrameCurrent()) return
    if (event.clickCount === 2) {
      const doubleClick = dispatchPointerListeners(route, 'dblclick', event, { isCurrent: isFrameCurrent })
      if (doubleClick.invalidated || doubleClick.defaultPrevented || !isFrameCurrent()) return
    }
    if (typeof resolvedTargetEntry.target.onPointerActivate !== 'function') {
      if (event.clickCount === 2) resolvedTargetEntry.target.onDoubleClick?.(event.position)
      return
    }

    const dispatch = (
      entry: HitTestEntry,
      phase: DispatchPhase,
      capture: boolean,
    ): boolean => {
      const handler = capture
        ? entry.target.onPointerActivateCapture
        : entry.target.onPointerActivate
      if (!isFrameCurrent()) return false
      if (typeof handler !== 'function') {
        return isFrameCurrent()
      }
      const localPosition = this._resolveLocalPosition(
        entry,
        event.position,
        false,
        event,
      )
      if (!isFrameCurrent()) return false
      handler.call(entry.target, {
        ...event,
        phase,
        localPosition,
        path: route,
        targetEntry: resolvedTargetEntry,
        currentEntry: entry,
        stopPropagation: () => { propagationStopped = true },
      })
      return isFrameCurrent()
    }

    for (let index = 0; index < entries.length - 1; index++) {
      if (!dispatch(entries[index]!, DispatchPhase.Capture, true)) return
      if (propagationStopped) return
    }

    if (!dispatch(resolvedTargetEntry, DispatchPhase.Target, false)) return
    if (propagationStopped) return

    for (let index = entries.length - 2; index >= 0; index--) {
      if (!dispatch(entries[index]!, DispatchPhase.Bubble, false)) return
      if (propagationStopped) return
    }
  }

  private _resolveLocalPosition(
    entry: HitTestEntry,
    globalPosition: { x: number; y: number },
    resetReference: boolean,
    pointer: PointerIdentitySource,
  ): { x: number; y: number } {
    if (this._hasLiveCoordinateSpace(entry)) {
      return resolveHitTestLocalPosition(entry, globalPosition)
    }

    const key = pointerKey(pointer)
    let references = this._entryReferencePositions.get(key)
    if (!references) {
      references = new WeakMap()
      this._entryReferencePositions.set(key, references)
    }
    let reference = resetReference ? undefined : references.get(entry)
    if (!reference) {
      reference = {
        globalPosition: { x: globalPosition.x, y: globalPosition.y },
        localPosition: { x: entry.localPosition.x, y: entry.localPosition.y },
      }
      references.set(entry, reference)
    }
    return {
      x: reference.localPosition.x + globalPosition.x - reference.globalPosition.x,
      y: reference.localPosition.y + globalPosition.y - reference.globalPosition.y,
    }
  }

  clearPointerReferences(pointer: PointerIdentitySource): void {
    this._entryReferencePositions.delete(pointerKey(pointer))
  }

  clearReferences(): void {
    this._entryReferencePositions.clear()
  }

  retainPointerReferences(pointers: readonly PointerIdentitySource[]): void {
    const retained = new Set(pointers.map(pointer => pointerKey(pointer)))
    for (const key of this._entryReferencePositions.keys()) {
      if (!retained.has(key)) this._entryReferencePositions.delete(key)
    }
  }

  private _sequenceTokenForDispatch(event: PointerEvent): PointerSequenceToken | undefined {
    const existing = this._sessions.sequenceToken(event)
    if (existing || event.type !== 'down') return existing
    this._sessions.ensure(event)
    return this._sessions.sequenceToken(event)
  }

  private _resolveTargetLocalPosition(
    target: HitTestTarget,
    globalPosition: { x: number; y: number },
  ): { x: number; y: number } {
    const entry: HitTestEntry = {
      target,
      localPosition: globalPosition,
    }
    return resolveHitTestLocalPosition(entry, globalPosition)
  }

  private _hasLiveCoordinateSpace(entry: HitTestEntry): boolean {
    const coordinateSpace = entry.coordinateSpace ?? entry.target
    if (typeof coordinateSpace === 'function') return true
    if (!coordinateSpace || typeof coordinateSpace !== 'object') return false
    if (typeof (coordinateSpace as { globalToLocal?: unknown }).globalToLocal === 'function') return true
    const globalOffset = (coordinateSpace as { globalOffset?: { x?: unknown; y?: unknown } }).globalOffset
    return typeof globalOffset?.x === 'number' && typeof globalOffset.y === 'number'
  }
}
