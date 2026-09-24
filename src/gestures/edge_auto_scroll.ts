export interface EdgeAutoScrollPoint {
  x: number
  y: number
}

export interface EdgeAutoScrollBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface EdgeAutoScrollInput {
  position: EdgeAutoScrollPoint
  bounds: EdgeAutoScrollBounds
  edgeSizeX: number
  edgeSizeY: number
  maxStepX: number
  maxStepY: number
  minStep?: number
}

export interface EdgeAutoScrollDelta {
  x: number
  y: number
}

export interface EdgeAutoScrollTickScheduler {
  setInterval(callback: () => void, intervalMs: number): unknown
  clearInterval(handle: unknown): void
}

export interface EdgeAutoScrollDriverOptions {
  intervalMs: number
  onScroll: (
    delta: Readonly<EdgeAutoScrollDelta>,
    input: Readonly<EdgeAutoScrollInput>,
  ) => boolean
  scheduler?: EdgeAutoScrollTickScheduler
}

const ZERO_DELTA: Readonly<EdgeAutoScrollDelta> = Object.freeze({ x: 0, y: 0 })

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function resolveAxisDelta(
  value: number,
  min: number,
  max: number,
  edgeSize: number,
  maxStep: number,
  minStep: number,
): number {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    max <= min ||
    !isFinitePositive(edgeSize) ||
    !isFinitePositive(maxStep)
  ) {
    return 0
  }
  if (value < min) return -maxStep
  if (value > max) return maxStep

  const startDistance = value - min
  if (startDistance < edgeSize) {
    return -scaledStep(edgeSize - startDistance, edgeSize, maxStep, minStep)
  }
  const endDistance = max - value
  if (endDistance < edgeSize) {
    return scaledStep(edgeSize - endDistance, edgeSize, maxStep, minStep)
  }
  return 0
}

function scaledStep(
  distanceInsideEdge: number,
  edgeSize: number,
  maxStep: number,
  minStep: number,
): number {
  const ratio = Math.max(0, Math.min(1, distanceInsideEdge / edgeSize))
  return Math.min(maxStep, Math.max(Math.min(minStep, maxStep), Math.ceil(maxStep * ratio)))
}

export function resolveEdgeAutoScrollDelta(
  input: Readonly<EdgeAutoScrollInput>,
): Readonly<EdgeAutoScrollDelta> {
  const minStep = Number.isFinite(input.minStep)
    ? Math.max(0, input.minStep ?? 0)
    : 0
  const x = resolveAxisDelta(
    input.position.x,
    input.bounds.left,
    input.bounds.right,
    input.edgeSizeX,
    input.maxStepX,
    minStep,
  )
  const y = resolveAxisDelta(
    input.position.y,
    input.bounds.top,
    input.bounds.bottom,
    input.edgeSizeY,
    input.maxStepY,
    minStep,
  )
  return x === 0 && y === 0 ? ZERO_DELTA : Object.freeze({ x, y })
}

const defaultTickScheduler: EdgeAutoScrollTickScheduler = {
  setInterval(callback, intervalMs) {
    return setInterval(callback, intervalMs)
  },
  clearInterval(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>)
  },
}

export class EdgeAutoScrollDriver {
  private readonly _intervalMs: number
  private readonly _onScroll: EdgeAutoScrollDriverOptions['onScroll']
  private readonly _scheduler: EdgeAutoScrollTickScheduler
  private _input?: Readonly<EdgeAutoScrollInput>
  private _timer?: unknown
  private _disposed = false

  constructor(options: EdgeAutoScrollDriverOptions) {
    if (!isFinitePositive(options.intervalMs)) {
      throw new RangeError('Edge auto-scroll intervalMs must be a finite positive number.')
    }
    this._intervalMs = options.intervalMs
    this._onScroll = options.onScroll
    this._scheduler = options.scheduler ?? defaultTickScheduler
  }

  get isActive(): boolean {
    return this._timer !== undefined
  }

  update(input: Readonly<EdgeAutoScrollInput>): void {
    if (this._disposed) return
    this._input = {
      position: { ...input.position },
      bounds: { ...input.bounds },
      edgeSizeX: input.edgeSizeX,
      edgeSizeY: input.edgeSizeY,
      maxStepX: input.maxStepX,
      maxStepY: input.maxStepY,
      minStep: input.minStep,
    }
    const delta = resolveEdgeAutoScrollDelta(this._input)
    if (delta.x === 0 && delta.y === 0) {
      this.stop()
      return
    }
    if (this._timer !== undefined) return

    this._timer = this._scheduler.setInterval(
      () => this._tick(),
      this._intervalMs,
    )
    this._tick()
  }

  stop(): void {
    const timer = this._timer
    this._timer = undefined
    this._input = undefined
    if (timer !== undefined) this._scheduler.clearInterval(timer)
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this.stop()
  }

  private _tick(): void {
    const input = this._input
    if (!input || this._disposed) {
      this.stop()
      return
    }
    const delta = resolveEdgeAutoScrollDelta(input)
    if (delta.x === 0 && delta.y === 0) {
      this.stop()
      return
    }

    let moved = false
    try {
      moved = this._onScroll(delta, input)
    } catch (error) {
      this.stop()
      throw error
    }
    if (!moved) this.stop()
  }
}
