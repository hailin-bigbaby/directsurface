import type { Offset } from '../core/render_object'
import {
  acceptGestureMember,
  GestureArenaEntry,
  GestureArenaManager,
  rejectGestureMember,
  type GestureArenaMember,
  type GestureArenaState,
  type GestureDisposition,
} from './gesture_arena'
import {
  resolveHitTestLocalPosition,
  sameHitTestEntryIdentity,
  type HitTestEntry,
  type HitTestResult,
  type HitTestTarget,
  type PointerEvent,
} from './hit_test'
import {
  pointerKey,
  resolvePointerIdentity,
  type PointerIdentity,
  type PointerIdentitySource,
  type PointerKey,
} from './pointer_identity'

export type RouteScope = 'main' | 'popup' | 'interceptor'
export type PointerSequencePhase = 'active' | 'ending-up' | 'ending-cancel' | 'ended'
export type PointerTerminationKind = 'up' | 'cancel'

const globalCoordinateSpace = (position: Offset): Offset => position

export interface PointerDispatchSession {
  readonly identity: PointerIdentity
  routeScope?: RouteScope
  routeTarget?: unknown
  activePath?: HitTestResult
  defaultOwner?: HitTestTarget
  defaultOwnerEntry?: HitTestEntry
  capturedTarget?: HitTestTarget
  capturedEntry?: HitTestEntry
  capturedPath?: HitTestResult
  gestureArena?: GestureArenaState
  hoverTargets: HitTestTarget[]
  hoverEntries: HitTestEntry[]
  hoverOwner?: unknown
  activationDownPosition?: Offset
  activationNativeClickCountHint?: number
  activationMaxDistanceSquared: number
  activationPrevented: boolean
  lastPosition?: Offset
  pointerType?: PointerEvent['pointerType']
  button?: number
  buttons?: number
  timeStamp?: number
  sequencePhase: PointerSequencePhase
  sequenceGeneration: number
  eventFrameGeneration: number
  hoverGeneration: number
  sequenceEnded: boolean
}

export interface PointerTerminationSnapshot {
  readonly identity: PointerIdentity
  readonly pointerId: number
  readonly kind: PointerTerminationKind
  readonly generation: number
  readonly session: PointerDispatchSession
  readonly routeScope?: RouteScope
  readonly routeTarget?: unknown
  readonly activePath?: HitTestResult
  readonly defaultOwner?: HitTestTarget
  readonly defaultOwnerEntry?: HitTestEntry
  readonly capturedTarget?: HitTestTarget
  readonly capturedEntry?: HitTestEntry
  readonly capturedPath?: HitTestResult
}

export interface PointerSequenceToken {
  readonly identity: PointerIdentity
  readonly generation: number
  readonly session: PointerDispatchSession
}

export interface PointerDispatchFrameToken extends PointerSequenceToken {
  readonly phase: PointerSequencePhase
  readonly eventFrameGeneration: number
}

export interface PointerDispatchDebugSnapshot {
  readonly routeScope?: RouteScope
  readonly routeTarget?: unknown
  readonly hitPath?: readonly HitTestTarget[]
  readonly activePath?: readonly HitTestTarget[]
  readonly defaultOwner?: HitTestTarget
  readonly defaultOwnerEntry?: HitTestEntry
  readonly capturedTarget?: HitTestTarget
  readonly capturedEntry?: HitTestEntry
  readonly capturedPath?: readonly HitTestEntry[]
  readonly gestureArenaMembers: readonly GestureArenaMember[]
  readonly hoverTargets: readonly HitTestTarget[]
  readonly hoverEntries: readonly HitTestEntry[]
  readonly hoverOwner?: unknown
  readonly activationDownPosition?: Offset
  readonly activationNativeClickCountHint?: number
  readonly activationMaxDistanceSquared: number
  readonly activationPrevented: boolean
  readonly lastPosition?: Offset
  readonly pointerType?: PointerEvent['pointerType']
  readonly button?: number
  readonly buttons?: number
  readonly timeStamp?: number
  readonly sequencePhase: PointerSequencePhase
  readonly sequenceGeneration: number
  readonly eventFrameGeneration: number
  readonly sequenceEnded: boolean
}

export class PointerDispatchSessions {
  private readonly _sessions = new Map<PointerKey, PointerDispatchSession>()
  readonly gestureArena = new PointerSessionGestureArenaManager(this)

  get(pointer: PointerIdentitySource): PointerDispatchSession | undefined {
    return this._sessions.get(pointerKey(pointer))
  }

  has(pointer: PointerIdentitySource): boolean {
    return this._sessions.has(pointerKey(pointer))
  }

  rememberPosition(pointer: PointerIdentitySource, position: Offset): PointerDispatchSession {
    const session = this._getOrCreate(pointer)
    session.lastPosition = { x: position.x, y: position.y }
    if (session.activationDownPosition) {
      const dx = position.x - session.activationDownPosition.x
      const dy = position.y - session.activationDownPosition.y
      session.activationMaxDistanceSquared = Math.max(
        session.activationMaxDistanceSquared,
        dx * dx + dy * dy,
      )
    }
    return session
  }

  rememberPointerEvent(event: PointerEvent): PointerDispatchSession {
    const session = this.rememberPosition(event, event.position)
    if (event.button !== undefined) session.button = event.button
    if (event.buttons !== undefined) session.buttons = event.buttons
    if (event.timeStamp !== undefined) session.timeStamp = event.timeStamp
    return session
  }

  beginActivationCandidate(
    pointer: PointerIdentitySource,
    position: Offset,
    nativeClickCountHint?: number,
  ): PointerDispatchSession {
    const session = this._getOrCreate(pointer)
    if (
      session.sequencePhase === 'active' &&
      !this.hasActiveSequence(pointer)
    ) {
      session.sequenceGeneration++
    }
    if (!this._activateSequence(session)) return session
    session.activationDownPosition = { x: position.x, y: position.y }
    session.activationNativeClickCountHint = nativeClickCountHint
    session.activationMaxDistanceSquared = 0
    session.activationPrevented = false
    session.sequenceEnded = false
    return session
  }

  preventActivation(
    pointer: PointerIdentitySource,
    token?: PointerSequenceToken,
  ): void {
    const session = token
      ? this._sessionForToken(pointer, token, false)
      : this.get(pointer)
    if (session && session.sequencePhase !== 'ended') {
      session.activationPrevented = true
    }
  }

  joinGestureArena(
    pointer: PointerIdentitySource,
    member: GestureArenaMember,
    token?: PointerSequenceToken,
  ): GestureArenaEntry {
    const identity = resolvePointerIdentity(pointer)
    if (token && !this._sessionForToken(identity, token, true)) {
      rejectGestureMember(member, identity)
      return new GestureArenaEntry(this.gestureArena, identity, member, true)
    }
    return this.gestureArena.add(identity, member)
  }

  rejectGestureArenaMember(
    pointer: PointerIdentitySource,
    member: GestureArenaMember,
  ): GestureArenaEntry {
    const identity = resolvePointerIdentity(pointer)
    rejectGestureMember(member, identity)
    return new GestureArenaEntry(this.gestureArena, identity, member, true)
  }

  setRoute(
    pointer: PointerIdentitySource,
    routeScope: RouteScope | undefined,
    routeTarget?: unknown,
  ): PointerDispatchSession {
    const session = this._getOrCreate(pointer)
    if (routeScope && !this._activateSequence(session)) return session
    session.routeScope = routeScope
    session.routeTarget = routeTarget
    return session
  }

  setActivePath(
    pointer: PointerIdentitySource,
    path: HitTestResult | undefined,
  ): PointerDispatchSession {
    const session = this._getOrCreate(pointer)
    if (path && !this._activateSequence(session)) return session
    session.activePath = path?.seal()
    session.defaultOwnerEntry = session.activePath?.deepest
    session.defaultOwner = session.defaultOwnerEntry?.target
    return session
  }

  clearActivePath(pointer: PointerIdentitySource): void {
    const session = this.get(pointer)
    if (!session) return
    session.activePath = undefined
    session.defaultOwner = undefined
    session.defaultOwnerEntry = undefined
  }

  getActivePath(pointer: PointerIdentitySource): HitTestResult | undefined {
    return this.get(pointer)?.activePath
  }

  setCapture(
    pointer: PointerIdentitySource,
    target: HitTestTarget,
    path?: HitTestResult,
    entry?: HitTestEntry,
    token?: PointerSequenceToken,
  ): PointerDispatchSession | undefined {
    const session = token
      ? this._sessionForToken(pointer, token, true)
      : this._getOrCreate(pointer)
    if (!session || !this._activateSequence(session)) return session
    const resolvedEntry = entry ?? (path
      ? [...path.path].reverse().find(candidate => candidate.target === target)
      : undefined)
    session.capturedTarget = target
    session.capturedEntry = resolvedEntry
    session.capturedPath = resolvedEntry && path
      ? path.through(resolvedEntry).snapshot()
      : undefined
    return session
  }

  getCapture(
    pointer: PointerIdentitySource,
    token?: PointerSequenceToken,
  ): HitTestTarget | undefined {
    const session = token
      ? this._sessionForToken(pointer, token, false)
      : this.get(pointer)
    return session?.capturedTarget
  }

  getCaptureEntry(
    pointer: PointerIdentitySource,
    token?: PointerSequenceToken,
  ): HitTestEntry | undefined {
    const session = token
      ? this._sessionForToken(pointer, token, false)
      : this.get(pointer)
    return session?.capturedEntry
  }

  getCapturePath(
    pointer: PointerIdentitySource,
    token?: PointerSequenceToken,
  ): HitTestResult | undefined {
    const session = token
      ? this._sessionForToken(pointer, token, false)
      : this.get(pointer)
    return session?.capturedPath
  }

  hasActiveSequence(pointer: PointerIdentitySource): boolean {
    const session = this.get(pointer)
    return !!session && session.sequencePhase === 'active' && (
      !!session.activePath ||
      !!session.capturedTarget ||
      !!session.capturedPath ||
      !!session.routeScope ||
      !!session.activationDownPosition ||
      !!session.gestureArena
    )
  }

  isTerminating(pointer: PointerIdentitySource): boolean {
    const phase = this.get(pointer)?.sequencePhase
    return phase === 'ending-up' || phase === 'ending-cancel'
  }

  beginTermination(
    pointer: PointerIdentitySource,
    kind: PointerTerminationKind,
  ): PointerTerminationSnapshot | undefined {
    const session = this.get(pointer)
    if (!session || session.sequencePhase !== 'active' || !this.hasActiveSequence(pointer)) {
      return undefined
    }
    session.sequencePhase = kind === 'up' ? 'ending-up' : 'ending-cancel'
    return {
      identity: session.identity,
      pointerId: session.identity.pointerId,
      kind,
      generation: session.sequenceGeneration,
      session,
      routeScope: session.routeScope,
      routeTarget: session.routeTarget,
      activePath: session.activePath,
      defaultOwner: session.defaultOwner,
      defaultOwnerEntry: session.defaultOwnerEntry,
      capturedTarget: session.capturedTarget,
      capturedEntry: session.capturedEntry,
      capturedPath: session.capturedPath,
    }
  }

  finishTermination(termination: PointerTerminationSnapshot): void {
    const key = pointerKey(termination.identity)
    const session = this._sessions.get(key)
    const expectedPhase = termination.kind === 'up' ? 'ending-up' : 'ending-cancel'
    if (
      session !== termination.session ||
      session.sequenceGeneration !== termination.generation ||
      session.sequencePhase !== expectedPhase
    ) {
      return
    }
    this._clearSequenceState(session, false)
    try {
      this.gestureArena.cancel(termination.identity)
    } finally {
      session.sequencePhase = 'ended'
      session.sequenceEnded = true
      this._deleteIfIdle(termination.identity, session)
    }
  }

  releaseCapture(
    pointer: PointerIdentitySource,
    token?: PointerSequenceToken,
  ): void {
    const session = token
      ? this._sessionForToken(pointer, token, false)
      : this.get(pointer)
    if (!session) return
    session.capturedTarget = undefined
    session.capturedEntry = undefined
    session.capturedPath = undefined
  }

  syncHover(
    pointer: PointerIdentitySource,
    nextTargets: HitTestTarget[],
    position: Offset,
    dispatchLeave: (target: HitTestTarget, event: PointerEvent) => void,
    dispatchEnter?: (target: HitTestTarget, event: PointerEvent) => void,
  ): boolean {
    return this.syncHoverEntries(
      pointer,
      nextTargets.map(target => ({
        target,
        localPosition: position,
        coordinateSpace: globalCoordinateSpace,
      })),
      position,
      dispatchLeave,
      dispatchEnter,
    )
  }

  syncHoverEntries(
    pointer: PointerIdentitySource,
    nextEntries: readonly HitTestEntry[],
    position: Offset,
    dispatchLeave: (target: HitTestTarget, event: PointerEvent) => void,
    dispatchEnter?: (target: HitTestTarget, event: PointerEvent) => void,
    owner?: unknown,
  ): boolean {
    const session = this._getOrCreate(pointer)
    const prevEntries = [...session.hoverEntries]
    let changed = prevEntries.length !== nextEntries.length
    const transitionGeneration = ++session.hoverGeneration
    const sequenceGeneration = session.sequenceGeneration
    const sequencePhase = session.sequencePhase
    const eventFrameGeneration = session.eventFrameGeneration
    const isTransitionCurrent = (): boolean =>
      this.get(session.identity) === session &&
      session.hoverGeneration === transitionGeneration &&
      session.sequenceGeneration === sequenceGeneration &&
      session.sequencePhase === sequencePhase &&
      session.eventFrameGeneration === eventFrameGeneration
    session.hoverEntries = [...nextEntries]
    session.hoverTargets = nextEntries.map(entry => entry.target)
    session.hoverOwner = nextEntries.length > 0 ? owner : undefined
    let firstError: unknown
    let invalidated = false
    for (const entry of prevEntries) {
      if (!nextEntries.some(candidate => sameHitTestEntryIdentity(candidate, entry))) {
        changed = true
        const event = this._hoverEvent(session.identity, position, entry)
        if (!isTransitionCurrent()) {
          invalidated = true
          break
        }
        try {
          dispatchLeave(entry.target, event)
        } catch (error) {
          firstError ??= error
        }
        if (!isTransitionCurrent()) {
          invalidated = true
          break
        }
      }
    }
    if (!invalidated && dispatchEnter) {
      for (const entry of nextEntries) {
        if (!prevEntries.some(candidate => sameHitTestEntryIdentity(candidate, entry))) {
          changed = true
          const event = this._hoverEvent(session.identity, position, entry)
          if (!isTransitionCurrent()) break
          try {
            dispatchEnter(entry.target, event)
          } catch (error) {
            firstError ??= error
          }
          if (!isTransitionCurrent()) {
            break
          }
        }
      }
    }
    if (firstError !== undefined) throw firstError
    return changed
  }

  clearHover(
    pointer: PointerIdentitySource,
    position: Offset,
    dispatchLeave: (target: HitTestTarget, event: PointerEvent) => void,
  ): void {
    const identity = resolvePointerIdentity(pointer)
    const session = this.get(identity)
    if (!session || session.hoverEntries.length === 0) return
    const entries = [...session.hoverEntries]
    const transitionGeneration = ++session.hoverGeneration
    const sequenceGeneration = session.sequenceGeneration
    const sequencePhase = session.sequencePhase
    const eventFrameGeneration = session.eventFrameGeneration
    const isTransitionCurrent = (): boolean =>
      this.get(identity) === session &&
      session.hoverGeneration === transitionGeneration &&
      session.sequenceGeneration === sequenceGeneration &&
      session.sequencePhase === sequencePhase &&
      session.eventFrameGeneration === eventFrameGeneration
    session.hoverTargets = []
    session.hoverEntries = []
    session.hoverOwner = undefined
    let firstError: unknown
    try {
      for (const entry of entries) {
        const event = this._hoverEvent(identity, position, entry)
        if (!isTransitionCurrent()) break
        try {
          dispatchLeave(entry.target, event)
        } catch (error) {
          firstError ??= error
        }
        if (!isTransitionCurrent()) {
          break
        }
      }
    } finally {
      if (isTransitionCurrent()) {
        this._deleteIfIdle(identity, session)
      }
    }
    if (firstError !== undefined) throw firstError
  }

  takeHoverEntries(pointer: PointerIdentitySource): HitTestEntry[] {
    const session = this.get(pointer)
    if (!session || session.hoverEntries.length === 0) return []
    const entries = [...session.hoverEntries]
    session.hoverGeneration++
    session.hoverTargets = []
    session.hoverEntries = []
    session.hoverOwner = undefined
    this._deleteIfIdle(session.identity, session)
    return entries
  }

  endSequence(pointer: PointerIdentitySource): void {
    const termination = this.beginTermination(pointer, 'cancel')
    if (termination) {
      this.finishTermination(termination)
      return
    }
    const session = this.get(pointer)
    if (!session || this.isTerminating(pointer)) return
    this._clearSequenceState(session)
    try {
      this.gestureArena.cancel(session.identity)
    } finally {
      this._deleteIfIdle(session.identity, session)
    }
  }

  resetSequence(pointer: PointerIdentitySource): void {
    const session = this.get(pointer)
    if (!session) return
    this._clearSequenceState(session)
    this.gestureArena.cancel(session.identity)
  }

  delete(pointer: PointerIdentitySource): void {
    const identity = resolvePointerIdentity(pointer)
    const key = pointerKey(identity)
    const session = this._sessions.get(key)
    try {
      this.gestureArena.cancel(identity)
    } finally {
      if (!session || this._sessions.get(key) === session) {
        this._sessions.delete(key)
      }
    }
  }

  clear(preserveTerminating = false): void {
    let firstError: unknown
    for (const session of [...this._sessions.values()]) {
      if (
        preserveTerminating &&
        (
          session.sequencePhase === 'ending-up' ||
          session.sequencePhase === 'ending-cancel'
        )
      ) {
        continue
      }
      try {
        this.gestureArena.cancel(session.identity)
      } catch (error) {
        firstError ??= error
      } finally {
        const key = pointerKey(session.identity)
        if (this._sessions.get(key) === session) {
          this._sessions.delete(key)
        }
      }
    }
    if (firstError !== undefined) throw firstError
  }

  pointerIds(): number[] {
    return [...this._sessions.values()].map(session => session.identity.pointerId)
  }

  pointerIdentities(): PointerIdentity[] {
    return [...this._sessions.values()].map(session => ({ ...session.identity }))
  }

  debugSnapshot(
    pointer: PointerIdentitySource,
    pointerType?: PointerEvent['pointerType'],
  ): PointerDispatchDebugSnapshot {
    const identity = typeof pointer === 'number'
      ? resolvePointerIdentity(pointer, pointerType ?? 'mouse')
      : resolvePointerIdentity(pointer)
    const session = this.get(identity)
    if (!session) {
      return {
        routeScope: undefined,
        routeTarget: undefined,
        hitPath: undefined,
        activePath: undefined,
        defaultOwner: undefined,
        defaultOwnerEntry: undefined,
        capturedTarget: undefined,
        capturedEntry: undefined,
        capturedPath: undefined,
        gestureArenaMembers: [],
        hoverTargets: [],
        hoverEntries: [],
        hoverOwner: undefined,
        activationDownPosition: undefined,
        activationNativeClickCountHint: undefined,
        activationMaxDistanceSquared: 0,
        activationPrevented: false,
        lastPosition: undefined,
        pointerType: undefined,
        button: undefined,
        buttons: undefined,
        timeStamp: undefined,
        sequencePhase: 'ended',
        sequenceGeneration: 0,
        eventFrameGeneration: 0,
        sequenceEnded: true,
      }
    }
    const activeTargets = session.activePath?.path.map(entry => entry.target)
    return {
      routeScope: session.routeScope,
      routeTarget: session.routeTarget,
      hitPath: activeTargets,
      activePath: activeTargets,
      defaultOwner: session.defaultOwner,
      defaultOwnerEntry: session.defaultOwnerEntry,
      capturedTarget: session.capturedTarget,
      capturedEntry: session.capturedEntry,
      capturedPath: session.capturedPath
        ? [...session.capturedPath.path]
        : undefined,
      gestureArenaMembers: [...(session.gestureArena?.members ?? [])],
      hoverTargets: [...session.hoverTargets],
      hoverEntries: [...session.hoverEntries],
      hoverOwner: session.hoverOwner,
      activationDownPosition: session.activationDownPosition
        ? { ...session.activationDownPosition }
        : undefined,
      activationNativeClickCountHint: session.activationNativeClickCountHint,
      activationMaxDistanceSquared: session.activationMaxDistanceSquared,
      activationPrevented: session.activationPrevented,
      lastPosition: session.lastPosition ? { ...session.lastPosition } : undefined,
      pointerType: session.pointerType,
      button: session.button,
      buttons: session.buttons,
      timeStamp: session.timeStamp,
      sequencePhase: session.sequencePhase,
      sequenceGeneration: session.sequenceGeneration,
      eventFrameGeneration: session.eventFrameGeneration,
      sequenceEnded: session.sequenceEnded,
    }
  }

  ensure(pointer: PointerIdentitySource): PointerDispatchSession {
    const session = this._getOrCreate(pointer)
    this._activateSequence(session)
    return session
  }

  sequenceToken(pointer: PointerIdentitySource): PointerSequenceToken | undefined {
    const session = this.get(pointer)
    if (!session || session.sequencePhase === 'ended') return undefined
    return {
      identity: session.identity,
      generation: session.sequenceGeneration,
      session,
    }
  }

  dispatchFrameToken(
    pointer: PointerIdentitySource,
  ): PointerDispatchFrameToken | undefined {
    const session = this.get(pointer)
    if (!session) return undefined
    return {
      identity: session.identity,
      generation: session.sequenceGeneration,
      phase: session.sequencePhase,
      eventFrameGeneration: session.eventFrameGeneration,
      session,
    }
  }

  beginDispatchFrame(
    pointer: PointerIdentitySource,
  ): PointerDispatchFrameToken {
    const session = this._getOrCreate(pointer)
    session.eventFrameGeneration++
    return {
      identity: session.identity,
      generation: session.sequenceGeneration,
      phase: session.sequencePhase,
      eventFrameGeneration: session.eventFrameGeneration,
      session,
    }
  }

  isDispatchFrameCurrent(
    token: PointerDispatchFrameToken | undefined,
  ): boolean {
    if (!token) return true
    const session = this.get(token.identity)
    return !!session &&
      session === token.session &&
      session.sequenceGeneration === token.generation &&
      session.sequencePhase === token.phase &&
      session.eventFrameGeneration === token.eventFrameGeneration
  }

  isTokenCurrent(
    token: PointerSequenceToken | undefined,
    allowEnding = false,
  ): boolean {
    if (!token) return true
    const session = this.get(token.identity)
    if (
      !session ||
      session !== token.session ||
      session.sequenceGeneration !== token.generation
    ) {
      return false
    }
    if (session.sequencePhase === 'active') return true
    return allowEnding && (
      session.sequencePhase === 'ending-up' ||
      session.sequencePhase === 'ending-cancel'
    )
  }

  private _getOrCreate(pointer: PointerIdentitySource): PointerDispatchSession {
    const identity = resolvePointerIdentity(pointer)
    const key = pointerKey(identity)
    let session = this._sessions.get(key)
    if (!session) {
      session = {
        identity,
        hoverTargets: [],
        hoverEntries: [],
        activationMaxDistanceSquared: 0,
        activationPrevented: false,
        sequencePhase: 'ended',
        sequenceGeneration: 0,
        eventFrameGeneration: 0,
        hoverGeneration: 0,
        sequenceEnded: true,
        pointerType: identity.pointerType,
      }
      this._sessions.set(key, session)
    }
    return session
  }

  private _deleteIfIdle(pointer: PointerIdentitySource, session: PointerDispatchSession): void {
    if (session.hoverEntries.length > 0) return
    if (session.sequencePhase !== 'ended') return
    this._sessions.delete(pointerKey(pointer))
  }

  private _activateSequence(session: PointerDispatchSession): boolean {
    if (session.sequencePhase === 'ending-up' || session.sequencePhase === 'ending-cancel') {
      return false
    }
    if (session.sequencePhase !== 'active') {
      session.sequenceGeneration++
      session.sequencePhase = 'active'
    }
    session.sequenceEnded = false
    return true
  }

  private _clearSequenceState(
    session: PointerDispatchSession,
    finishSequence = true,
  ): void {
    session.activePath = undefined
    session.defaultOwner = undefined
    session.defaultOwnerEntry = undefined
    session.capturedTarget = undefined
    session.capturedEntry = undefined
    session.capturedPath = undefined
    session.routeScope = undefined
    session.routeTarget = undefined
    session.activationDownPosition = undefined
    session.activationNativeClickCountHint = undefined
    session.activationMaxDistanceSquared = 0
    session.activationPrevented = false
    if (session.hoverEntries.length === 0) {
      session.lastPosition = undefined
      session.button = undefined
      session.buttons = undefined
      session.timeStamp = undefined
    }
    if (finishSequence) {
      session.sequencePhase = 'ended'
      session.sequenceEnded = true
    }
  }

  private _hoverEvent(
    identity: PointerIdentity,
    position: Offset,
    entry: HitTestEntry,
  ): PointerEvent {
    return {
      pointerId: identity.pointerId,
      pointerType: identity.pointerType,
      position,
      type: 'move',
      localPosition: resolveHitTestLocalPosition(entry, position),
      hitTestEntry: entry,
    }
  }

  private _sessionForToken(
    pointer: PointerIdentitySource,
    token: PointerSequenceToken,
    requireActive: boolean,
  ): PointerDispatchSession | undefined {
    const identity = resolvePointerIdentity(pointer)
    if (pointerKey(identity) !== pointerKey(token.identity)) return undefined
    const session = this.get(identity)
    if (
      !session ||
      session !== token.session ||
      session.sequenceGeneration !== token.generation ||
      (requireActive && session.sequencePhase !== 'active')
    ) {
      return undefined
    }
    return session
  }
}

class PointerSessionGestureArenaManager extends GestureArenaManager {
  constructor(private readonly _sessions: PointerDispatchSessions) {
    super()
  }

  override add(
    pointer: PointerIdentitySource,
    member: GestureArenaMember,
  ): GestureArenaEntry {
    const identity = resolvePointerIdentity(pointer)
    if (this._sessions.isTerminating(identity)) {
      rejectGestureMember(member, identity)
      return new GestureArenaEntry(this, identity, member, true)
    }
    const session = this._sessions.ensure(identity)
    let arena = session.gestureArena
    if (!arena) {
      arena = { identity, members: [], isOpen: true }
      session.gestureArena = arena
    }
    session.sequenceEnded = false
    if (!arena.isOpen) {
      rejectGestureMember(member, identity)
      return new GestureArenaEntry(this, identity, member, true)
    }
    if (arena.members.includes(member)) {
      return new GestureArenaEntry(this, identity, member)
    }
    arena.members.push(member)
    return new GestureArenaEntry(this, identity, member)
  }

  override close(pointer: PointerIdentitySource): void {
    const session = this._sessions.get(pointer)
    const arena = session?.gestureArena
    if (!session || !arena) return
    arena.isOpen = false
    if (arena.members.length === 0) session.gestureArena = undefined
  }

  override resolve(
    pointer: PointerIdentitySource,
    member: GestureArenaMember,
    disposition: GestureDisposition,
  ): void {
    const session = this._sessions.get(pointer)
    const arena = session?.gestureArena
    if (!session || !arena || !arena.members.includes(member)) return

    if (disposition === 'accepted') {
      if (member.preventsPointerActivationOnAccept === true) {
        session.activationPrevented = true
      }
      session.gestureArena = undefined
      let firstError: unknown
      for (const competitor of arena.members) {
        if (competitor === member) continue
        try {
          rejectGestureMember(competitor, arena.identity)
        } catch (error) {
          firstError ??= error
        }
      }
      try {
        acceptGestureMember(member, arena.identity)
      } catch (error) {
        firstError ??= error
      }
      if (firstError !== undefined) throw firstError
      return
    }

    arena.members = arena.members.filter(candidate => candidate !== member)
    try {
      rejectGestureMember(member, arena.identity)
    } finally {
      if (
        arena.members.length === 0 &&
        session.gestureArena === arena
      ) {
        session.gestureArena = undefined
      }
    }
  }

  override sweep(pointer: PointerIdentitySource): void {
    const session = this._sessions.get(pointer)
    const arena = session?.gestureArena
    if (!session || !arena) return
    session.gestureArena = undefined
    notifyGestureMembers(
      arena.members,
      member => rejectGestureMember(member, arena.identity),
    )
  }

  override cancel(pointer: PointerIdentitySource): void {
    const session = this._sessions.get(pointer)
    const arena = session?.gestureArena
    if (!session || !arena) return
    session.gestureArena = undefined
    notifyGestureMembers(
      arena.members,
      member => rejectGestureMember(member, arena.identity),
    )
  }

  override clear(): void {
    let firstError: unknown
    for (const identity of this._sessions.pointerIdentities()) {
      try {
        this.cancel(identity)
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError !== undefined) throw firstError
  }

  override has(pointer: PointerIdentitySource): boolean {
    return this._sessions.get(pointer)?.gestureArena !== undefined
  }

  override members(pointer: PointerIdentitySource): readonly GestureArenaMember[] {
    return [...(this._sessions.get(pointer)?.gestureArena?.members ?? [])]
  }
}

function notifyGestureMembers(
  members: readonly GestureArenaMember[],
  notify: (member: GestureArenaMember) => void,
): void {
  let firstError: unknown
  for (const member of members) {
    try {
      notify(member)
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== undefined) throw firstError
}
