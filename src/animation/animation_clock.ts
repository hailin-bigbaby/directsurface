export type AnimationTick = (elapsedMs: number) => void
export type AnimationRegistrar = (tick: AnimationTick) => () => void

interface AnimationEntry {
  tick: AnimationTick
  isActive: () => boolean
  elapsed: number
  lastTime?: number
}

/** Runtime-owned animation time. It never requests a browser frame itself. */
export class AnimationClock {
  private readonly _entries = new Set<AnimationEntry>()
  private _suspended = false
  private _disposed = false
  private _time = -Infinity

  constructor(private readonly _requestFrame: () => void = () => {}) {}

  get subscriberCount(): number { return this._entries.size }

  get hasActiveAnimations(): boolean {
    if (this._disposed || this._suspended) return false
    let active = false
    let failed = false
    let firstError: unknown
    for (const entry of [...this._entries]) {
      if (this._disposed || this._suspended) break
      if (!this._entries.has(entry)) continue
      try {
        if (entry.isActive()) active = true
        else entry.lastTime = undefined
      } catch (error) {
        this._entries.delete(entry)
        if (!failed) { failed = true; firstError = error }
      }
    }
    if (failed) throw firstError
    return active
  }

  subscribe(tick: AnimationTick, isActive: () => boolean = () => true): () => void {
    if (this._disposed) return () => {}
    const entry: AnimationEntry = { tick, isActive, elapsed: 0 }
    this._entries.add(entry)
    this._requestFrame()
    return () => { this._entries.delete(entry) }
  }

  setSuspended(suspended: boolean): void {
    if (this._suspended === suspended || this._disposed) return
    this._suspended = suspended
    for (const entry of this._entries) entry.lastTime = undefined
    // Re-evaluate activity inside the frame so predicate errors follow normal isolation.
    if (!suspended && this._entries.size > 0) this._requestFrame()
  }

  tick(timestamp: number): void {
    if (this._disposed || this._suspended || !Number.isFinite(timestamp)) return
    this._time = Math.max(this._time, timestamp)
    let failed = false
    let firstError: unknown
    // Changes made by callbacks take effect without running new subscriptions mid-frame.
    for (const entry of [...this._entries]) {
      if (this._disposed || this._suspended) break
      if (!this._entries.has(entry)) continue
      try {
        if (!entry.isActive()) {
          entry.lastTime = undefined
          continue
        }
        if (entry.lastTime !== undefined) entry.elapsed += this._time - entry.lastTime
        entry.lastTime = this._time
        entry.tick(entry.elapsed)
      } catch (error) {
        this._entries.delete(entry)
        if (!failed) { failed = true; firstError = error }
      }
    }
    if (failed) throw firstError
  }

  dispose(): void {
    this._disposed = true
    this._entries.clear()
  }
}
