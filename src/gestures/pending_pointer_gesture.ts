import type { GestureArenaEntry, GestureArenaMember, GestureDisposition } from './gesture_arena'
import type { PointerEvent } from './hit_test'
import {
  pointerKey,
  resolvePointerIdentity,
  type PointerIdentity,
  type PointerType,
} from './pointer_identity'

export interface PendingPointerGestureOptions {
  captureOnAccept?: boolean
}

export class PendingPointerGesture {
  private _entry?: GestureArenaEntry
  private _identity?: PointerIdentity
  private _joinState?: {
    generation: number
    disposition?: GestureDisposition
  }
  private _generation = 0
  private _setPointerCapture?: () => void
  private _pendingReleasePointerCapture?: () => void
  private _releasePointerCapture?: () => void
  private _captureOnAccept = true

  get pointerId(): number | undefined { return this._identity?.pointerId }
  get isPending(): boolean { return this._entry !== undefined }
  get hasOwner(): boolean { return this._identity !== undefined }

  owns(event: Pick<PointerEvent, 'pointerId' | 'pointerType'>): boolean {
    return !!this._identity && pointerKey(this._identity) === pointerKey(event)
  }

  begin(event: PointerEvent, member: GestureArenaMember, options: PendingPointerGestureOptions = {}): boolean {
    const identity = resolvePointerIdentity(event)
    if (this._identity && pointerKey(this._identity) !== pointerKey(identity)) {
      return false
    }
    const previousEntry = this._entry
    if (previousEntry) {
      try {
        previousEntry.resolve('rejected')
      } finally {
        if (this._entry === previousEntry) this.resetPending()
      }
      if (this._entry || this._identity) return false
    } else {
      this.resetPending()
    }

    const generation = ++this._generation
    const joinState: NonNullable<PendingPointerGesture['_joinState']> = {
      generation,
    }
    this._identity = identity
    this._setPointerCapture = event.setPointerCapture
    this._pendingReleasePointerCapture = event.releasePointerCapture
    this._captureOnAccept = options.captureOnAccept ?? true
    this._joinState = joinState

    let entry: GestureArenaEntry | undefined
    try {
      entry = event.joinGestureArena?.(member)
    } catch (error) {
      if (this._generation === generation) this.resetPending()
      throw error
    }
    if (
      this._generation !== generation ||
      this._joinState !== joinState
    ) {
      return joinState.disposition === 'accepted' &&
        this._generation === generation
    }
    this._joinState = undefined
    if (!entry) {
      this.resetPending()
      return false
    }
    this._entry = entry
    return true
  }

  captureImmediately(event: PointerEvent): void {
    if (this._identity && !this.owns(event)) return
    this._identity = resolvePointerIdentity(event)
    event.setPointerCapture?.()
    this._releasePointerCapture = event.releasePointerCapture
  }

  resolve(disposition: GestureDisposition): void {
    this._entry?.resolve(disposition)
  }

  /**
   * Completes a pointer sequence transactionally.
   *
   * Arena callbacks, capture release, and post-terminal component actions are
   * all attempted. Pending ownership and capture bookkeeping are cleared
   * before component actions run, and the first thrown error is rethrown last.
   */
  resolveTerminal(
    disposition: GestureDisposition,
    ...afterReset: Array<() => void>
  ): void {
    let firstError: unknown
    let hasError = false
    const attempt = (callback: () => void): void => {
      try {
        callback()
      } catch (error) {
        if (!hasError) {
          firstError = error
          hasError = true
        }
      }
    }

    attempt(() => this.resolve(disposition))
    attempt(() => this.releaseCapture())
    this.resetPending()
    for (const callback of afterReset) attempt(callback)
    if (hasError) throw firstError
  }

  accept(pointerId: number, pointerType: PointerType = 'mouse'): boolean {
    if (!this._identity || pointerKey(this._identity) !== pointerKey(pointerId, pointerType)) {
      return false
    }
    if (this._joinState?.generation === this._generation) {
      this._joinState.disposition = 'accepted'
      this._joinState = undefined
    }
    this._entry = undefined
    if (this._captureOnAccept) {
      this._setPointerCapture?.()
      this._releasePointerCapture = this._pendingReleasePointerCapture
      this._pendingReleasePointerCapture = undefined
    }
    return true
  }

  reject(pointerId: number, pointerType: PointerType = 'mouse'): boolean {
    if (!this._identity || pointerKey(this._identity) !== pointerKey(pointerId, pointerType)) {
      return false
    }
    this.resetPending()
    return true
  }

  resetPending(): void {
    this._generation++
    this._entry = undefined
    this._identity = undefined
    this._joinState = undefined
    this._setPointerCapture = undefined
    this._pendingReleasePointerCapture = undefined
    this._captureOnAccept = true
  }

  releaseCapture(): void {
    const releasePointerCapture = this._releasePointerCapture
    this._releasePointerCapture = undefined
    releasePointerCapture?.()
  }
}
