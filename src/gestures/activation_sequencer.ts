import {
  pointerKey,
  type PointerIdentitySource,
  type PointerKey,
  type PointerType,
} from './pointer_identity'

export type ActivationPointerType = PointerType

/**
 * Identifies the routing layer that owned an activation.
 *
 * `kind` normally maps to main, popup, or interceptor. `target` and `key`
 * distinguish owners within the same kind without coupling this state machine
 * to the runtime routing implementation.
 */
export interface ActivationScopeIdentity {
  readonly kind: string
  readonly target?: unknown
  readonly key?: unknown
}

/**
 * Identifies a semantic hit inside a render target.
 *
 * The target must be stable. The optional key lets a single render target,
 * such as a data grid, expose many logical interaction regions without
 * allocating one target object per cell.
 */
export interface HitIdentity {
  readonly target: object
  readonly key?: unknown
}

export interface ActivationPoint {
  readonly x: number
  readonly y: number
}

export interface ActivationRecord {
  readonly pointerId: number
  readonly pointerType: ActivationPointerType
  readonly button: number
  readonly scope: ActivationScopeIdentity
  readonly hit: HitIdentity
  readonly position: ActivationPoint
  readonly timestamp: number
  /**
   * Optional browser click count carried by the completed pointer sequence.
   * It is treated only as a hint and never establishes logical continuity.
   */
  readonly nativeClickCountHint?: number
}

export interface ActivationResult {
  readonly clickCount: number
  readonly continuedSequence: boolean
  readonly acceptedNativeClickCountHint: boolean
}

export interface ActivationSequenceSnapshot extends ActivationRecord {
  readonly clickCount: number
}

export interface ActivationSequencerOptions {
  /** Maximum time between two successful activations in one sequence. */
  readonly maxIntervalMs?: number
  /** Maximum distance between two successful activations in one sequence. */
  readonly maxDistance?: number
}

interface StoredActivation extends ActivationSequenceSnapshot {}

const DEFAULT_MAX_INTERVAL_MS = 500
const DEFAULT_MAX_DISTANCE = 4

/**
 * Tracks successful activations and assigns framework-level click counts.
 *
 * The sequencer does not decide whether a down/up pair is a successful
 * activation. The caller records only completed, uncancelled activations after
 * gesture ownership has been resolved.
 */
export class ActivationSequencer {
  readonly maxIntervalMs: number
  readonly maxDistance: number

  private readonly _lastByPointer = new Map<PointerKey, StoredActivation>()
  private readonly _expiryTimers = new Map<PointerKey, ReturnType<typeof setTimeout>>()

  constructor(options: ActivationSequencerOptions = {}) {
    this.maxIntervalMs = validateNonNegativeFinite(
      options.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS,
      'maxIntervalMs',
    )
    this.maxDistance = validateNonNegativeFinite(
      options.maxDistance ?? DEFAULT_MAX_DISTANCE,
      'maxDistance',
    )
  }

  recordActivation(record: ActivationRecord): ActivationResult {
    validateRecord(record)
    this._pruneExpired(record.timestamp)

    const key = pointerKey(record)
    const previous = this._lastByPointer.get(key)
    const continuedSequence = previous !== undefined && this._continues(previous, record)
    let clickCount = continuedSequence
      ? safeIncrement(previous.clickCount)
      : 1
    let acceptedNativeClickCountHint = false

    const nativeHint = normalizeNativeClickCount(record.nativeClickCountHint)
    if (record.pointerType === 'mouse' && continuedSequence && nativeHint !== undefined) {
      if (nativeHint === 1 || nativeHint === clickCount) {
        clickCount = nativeHint
        acceptedNativeClickCountHint = true
      }
    }

    const stored = copyRecord(record, clickCount)
    this._lastByPointer.set(key, stored)
    this._scheduleExpiry(key, stored)
    return {
      clickCount,
      continuedSequence,
      acceptedNativeClickCountHint,
    }
  }

  getLastActivation(
    pointer: PointerIdentitySource,
    pointerType: PointerType = 'mouse',
  ): ActivationSequenceSnapshot | undefined {
    const stored = this._lastByPointer.get(pointerKey(pointer, pointerType))
    return stored ? copySnapshot(stored) : undefined
  }

  /**
   * Breaks the pending multi-click sequence for a cancelled pointer.
   */
  cancel(
    pointer: PointerIdentitySource,
    pointerType: PointerType = 'mouse',
  ): void {
    const key = pointerKey(pointer, pointerType)
    this._lastByPointer.delete(key)
    this._clearExpiry(key)
  }

  /**
   * Invalidates one semantic hit, for example when a virtual cell disappears.
   */
  invalidateHit(hit: HitIdentity): void {
    for (const [key, stored] of this._lastByPointer) {
      if (sameHitIdentity(stored.hit, hit)) {
        this._lastByPointer.delete(key)
        this._clearExpiry(key)
      }
    }
  }

  /**
   * Invalidates every logical region owned by a target.
   */
  invalidateTarget(target: object): void {
    for (const [key, stored] of this._lastByPointer) {
      if (stored.hit.target === target) {
        this._lastByPointer.delete(key)
        this._clearExpiry(key)
      }
    }
  }

  /**
   * Invalidates activations owned by a routing scope that has been removed.
   */
  invalidateScope(scope: ActivationScopeIdentity): void {
    for (const [key, stored] of this._lastByPointer) {
      if (sameScopeIdentity(stored.scope, scope)) {
        this._lastByPointer.delete(key)
        this._clearExpiry(key)
      }
    }
  }

  reset(): void {
    this._lastByPointer.clear()
    for (const timer of this._expiryTimers.values()) clearTimeout(timer)
    this._expiryTimers.clear()
  }

  private _continues(previous: StoredActivation, record: ActivationRecord): boolean {
    if (previous.pointerType !== record.pointerType) return false
    if (previous.button !== record.button) return false
    if (!sameScopeIdentity(previous.scope, record.scope)) return false
    if (!sameHitIdentity(previous.hit, record.hit)) return false

    const elapsed = record.timestamp - previous.timestamp
    if (elapsed < 0 || elapsed > this.maxIntervalMs) return false

    const dx = record.position.x - previous.position.x
    const dy = record.position.y - previous.position.y
    return dx * dx + dy * dy <= this.maxDistance * this.maxDistance
  }

  private _pruneExpired(timestamp: number): void {
    for (const [key, stored] of this._lastByPointer) {
      const elapsed = timestamp - stored.timestamp
      if (elapsed < 0 || elapsed > this.maxIntervalMs) {
        this._lastByPointer.delete(key)
        this._clearExpiry(key)
      }
    }
  }

  private _scheduleExpiry(key: PointerKey, stored: StoredActivation): void {
    this._clearExpiry(key)
    const timer = setTimeout(() => {
      if (this._lastByPointer.get(key) === stored) {
        this._lastByPointer.delete(key)
      }
      this._expiryTimers.delete(key)
    }, this.maxIntervalMs + 1)
    this._expiryTimers.set(key, timer)
  }

  private _clearExpiry(key: PointerKey): void {
    const timer = this._expiryTimers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    this._expiryTimers.delete(key)
  }
}

export function sameHitIdentity(a: HitIdentity, b: HitIdentity): boolean {
  return a.target === b.target && Object.is(a.key, b.key)
}

export function sameScopeIdentity(a: ActivationScopeIdentity, b: ActivationScopeIdentity): boolean {
  return a.kind === b.kind
    && Object.is(a.target, b.target)
    && Object.is(a.key, b.key)
}

function copyRecord(record: ActivationRecord, clickCount: number): StoredActivation {
  return {
    pointerId: record.pointerId,
    pointerType: record.pointerType,
    button: record.button,
    scope: {
      kind: record.scope.kind,
      target: record.scope.target,
      key: record.scope.key,
    },
    hit: {
      target: record.hit.target,
      key: record.hit.key,
    },
    position: {
      x: record.position.x,
      y: record.position.y,
    },
    timestamp: record.timestamp,
    nativeClickCountHint: record.nativeClickCountHint,
    clickCount,
  }
}

function copySnapshot(snapshot: StoredActivation): ActivationSequenceSnapshot {
  return copyRecord(snapshot, snapshot.clickCount)
}

function safeIncrement(value: number): number {
  return value < Number.MAX_SAFE_INTEGER ? value + 1 : 1
}

function normalizeNativeClickCount(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) return undefined
  return value
}

function validateRecord(record: ActivationRecord): void {
  if (!Number.isSafeInteger(record.pointerId)) {
    throw new TypeError('pointerId must be a safe integer')
  }
  if (!Number.isSafeInteger(record.button)) {
    throw new TypeError('button must be a safe integer')
  }
  if (!record.scope.kind) {
    throw new TypeError('scope.kind must not be empty')
  }
  if (!record.hit.target || (typeof record.hit.target !== 'object' && typeof record.hit.target !== 'function')) {
    throw new TypeError('hit.target must be an object')
  }
  if (!Number.isFinite(record.position.x) || !Number.isFinite(record.position.y)) {
    throw new TypeError('position must contain finite coordinates')
  }
  if (!Number.isFinite(record.timestamp)) {
    throw new TypeError('timestamp must be finite')
  }
}

function validateNonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number`)
  }
  return value
}
