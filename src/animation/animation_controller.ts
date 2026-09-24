// AnimationController: 0→1 时间驱动动画值
// 由 Ticker（rAF）推进，支持正向/反向/循环
// 动画开始/进行时自动通知 onTick 回调请求下一帧

import type { CurveFunction } from './curves'
import { Curves } from './curves'

export type AnimationStatus = 'idle' | 'forward' | 'reverse' | 'completed' | 'dismissed'

export type AnimationListener = (value: number) => void
export type StatusListener = (status: AnimationStatus) => void

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function statusForValue(value: number): AnimationStatus {
  if (value === 1) return 'completed'
  if (value === 0) return 'dismissed'
  return 'idle'
}

export class AnimationController {
  private _value: number
  private _status: AnimationStatus = 'idle'
  private _duration: number  // ms
  private _curve: CurveFunction
  private _startTime?: number
  private _startValue?: number
  private _targetValue?: number
  private _rafId?: number
  private _listeners: AnimationListener[] = []
  private _statusListeners: StatusListener[] = []
  // 动画开始/进行时通知外部请求刷新帧
  private _onTick?: () => void

  constructor(opts: {
    initialValue?: number
    duration?: number
    curve?: CurveFunction
    onTick?: () => void
  } = {}) {
    this._value = clamp01(opts.initialValue ?? 0)
    this._duration = opts.duration ?? 300
    this._curve = opts.curve ?? Curves.easeInOut
    this._onTick = opts.onTick
  }

  get value(): number { return this._value }
  get status(): AnimationStatus { return this._status }
  get isAnimating(): boolean { return this._rafId !== undefined }
  get duration(): number { return this._duration }

  set duration(value: number) {
    this._duration = Math.max(0, value)
  }

  addListener(fn: AnimationListener): void { this._listeners.push(fn) }
  removeListener(fn: AnimationListener): void {
    this._listeners = this._listeners.filter(l => l !== fn)
  }

  addStatusListener(fn: StatusListener): void { this._statusListeners.push(fn) }
  removeStatusListener(fn: StatusListener): void {
    this._statusListeners = this._statusListeners.filter(l => l !== fn)
  }

  forward(): void { this._animateTo(1, 'forward') }
  reverse(): void { this._animateTo(0, 'reverse') }

  animateTo(target: number): void {
    const clampedTarget = clamp01(target)
    this._animateTo(clampedTarget, clampedTarget > this._value ? 'forward' : 'reverse')
  }

  stop(): void {
    this._cancelTick()
    this._setStatus('idle')
  }

  resetValue(value: number): void {
    this._cancelTick()
    this._value = clamp01(value)
    this._setStatus(statusForValue(this._value))
    this._notifyListeners()
  }

  dispose(): void {
    this.stop()
    this._listeners = []
    this._statusListeners = []
    this._onTick = undefined
  }

  private _animateTo(target: number, status: AnimationStatus): void {
    target = clamp01(target)
    if (this._value === target) {
      this._cancelTick()
      this._setStatus(statusForValue(target))
      return
    }
    this._cancelTick()
    this._targetValue = target
    this._startValue = this._value
    this._startTime = undefined
    this._setStatus(status)

    if (this._duration <= 0) {
      this._value = target
      this._notifyListeners()
      this._setStatus(statusForValue(target))
      return
    }

    this._tick()
  }

  private _tick(): void {
    this._onTick?.()
    const rafId = requestAnimationFrame((now) => {
      if (this._rafId !== rafId) return
      if (this._startTime === undefined) this._startTime = now

      const elapsed = now - this._startTime
      const rawT = Math.min(elapsed / this._duration, 1)
      const curvedT = this._curve(rawT)

      const start = this._startValue!
      const end = this._targetValue!
      this._value = start + (end - start) * curvedT

      this._notifyListeners()

      if (rawT < 1) {
        this._onTick?.()
        this._tick()
      } else {
        this._value = end
        this._rafId = undefined
        this._notifyListeners()
        this._setStatus(statusForValue(end))
      }
    })
    this._rafId = rafId
  }

  private _cancelTick(): void {
    if (this._rafId === undefined) return
    cancelAnimationFrame(this._rafId)
    this._rafId = undefined
  }

  private _setStatus(status: AnimationStatus): void {
    if (this._status === status) return
    this._status = status
    for (const fn of this._statusListeners) fn(status)
  }

  private _notifyListeners(): void {
    for (const fn of this._listeners) fn(this._value)
  }
}
