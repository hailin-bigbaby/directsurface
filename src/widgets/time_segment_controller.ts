import {
  formatTimeValue,
  normalizeTimeParts,
  parseTimeValue,
  stepTimePart,
  type TimeParts,
  type TimePrecision,
  type TimeSegment,
} from './time_value'

export type TimeSegmentChangeReason =
  | 'input'
  | 'step'
  | 'selection'
  | 'clear'
  | 'precision-reconcile'

export interface TimeSegmentChange {
  value: string
  previousValue: string
  reason: TimeSegmentChangeReason
  segment?: TimeSegment
  direction?: 1 | -1
}

export interface TimeSegmentControllerOptions {
  value?: string
  precision?: TimePrecision
  hourStep?: number
  minuteStep?: number
  secondStep?: number
  onChange?: (change: TimeSegmentChange) => void
  invalidate?: () => void
}

export class TimeSegmentController {
  private _precision: TimePrecision
  private _parts: TimeParts = { hour: 0, minute: 0, second: 0 }
  private _hasValue = false
  private _activeSegment: TimeSegment | null = null
  private _inputBuffer = ''
  private _inputFresh = true
  private _hourStep: number
  private _minuteStep: number
  private _secondStep: number
  private readonly _onChange?: (change: TimeSegmentChange) => void
  private readonly _invalidate: () => void

  constructor(options: TimeSegmentControllerOptions = {}) {
    this._precision = options.precision ?? 'second'
    this._hourStep = positiveInteger(options.hourStep)
    this._minuteStep = positiveInteger(options.minuteStep)
    this._secondStep = positiveInteger(options.secondStep)
    this._onChange = options.onChange
    this._invalidate = options.invalidate ?? (() => {})
    this.reset(options.value ?? '')
  }

  get precision(): TimePrecision { return this._precision }
  set precision(value: TimePrecision) {
    if (value === this._precision) return
    const previousValue = this.value
    this._precision = value
    if (value === 'minute') {
      this._parts.second = 0
      if (this._activeSegment === 'second') this._activeSegment = 'minute'
    }
    this._clearInput()
    const next = this.value
    if (next !== previousValue) {
      this._onChange?.({
        value: next,
        previousValue,
        reason: 'precision-reconcile',
      })
    }
    this._invalidate()
  }

  get value(): string {
    return this._hasValue ? formatTimeValue(this._parts, this._precision) : ''
  }

  get parts(): TimeParts | null {
    return this._hasValue ? { ...this._parts } : null
  }

  get displayParts(): TimeParts { return { ...this._parts } }

  get activeSegment(): TimeSegment | null { return this._activeSegment }
  get inputBuffer(): string { return this._inputBuffer }
  get inputFresh(): boolean { return this._inputFresh }
  get segments(): readonly TimeSegment[] {
    return this._precision === 'second'
      ? ['hour', 'minute', 'second']
      : ['hour', 'minute']
  }

  setSteps(options: {
    hourStep?: number
    minuteStep?: number
    secondStep?: number
  }): void {
    if (options.hourStep !== undefined) this._hourStep = positiveInteger(options.hourStep)
    if (options.minuteStep !== undefined) this._minuteStep = positiveInteger(options.minuteStep)
    if (options.secondStep !== undefined) this._secondStep = positiveInteger(options.secondStep)
  }

  reset(value: string, fallback: TimeParts = { hour: 0, minute: 0, second: 0 }): void {
    const parsed = parseTimeValue(value)
    this._parts = normalizeTimeParts(parsed ?? fallback)
    if (this._precision === 'minute') this._parts.second = 0
    this._hasValue = parsed !== null
    this._activeSegment = null
    this._clearInput()
    this._invalidate()
  }

  setValue(value: string): boolean {
    const parsed = parseTimeValue(value)
    if (!parsed) return false
    const next = normalizeTimeParts(parsed)
    if (this._precision === 'minute') next.second = 0
    const previousValue = this.value
    this._parts = next
    this._hasValue = true
    this._clearInput()
    if (this.value === previousValue) {
      this._invalidate()
      return true
    }
    this._invalidate()
    return true
  }

  clear(notify = true): void {
    const previousValue = this.value
    this._hasValue = false
    this._activeSegment = null
    this._clearInput()
    if (notify && previousValue !== '') {
      this._onChange?.({ value: '', previousValue, reason: 'clear' })
    }
    this._invalidate()
  }

  activate(segment: TimeSegment): boolean {
    if (!this.segments.includes(segment)) return false
    this._activeSegment = segment
    this._clearInput()
    this._invalidate()
    return true
  }

  deactivate(): void {
    if (this._activeSegment === null && this._inputFresh) return
    this._activeSegment = null
    this._clearInput()
    this._invalidate()
  }

  commitPending(): void {
    if (!this._activeSegment || this._inputFresh || this._inputBuffer === '') return
    this.select(this._activeSegment, Number(this._inputBuffer), 'input')
    this._clearInput()
  }

  cancelPending(): void {
    this._clearInput()
    this._invalidate()
  }

  select(
    segment: TimeSegment,
    value: number,
    reason: TimeSegmentChangeReason = 'selection',
  ): void {
    if (!this.segments.includes(segment) || !Number.isFinite(value)) return
    const previousValue = this.value
    this._ensureValue()
    const max = segment === 'hour' ? 23 : 59
    this._parts[segment] = Math.max(0, Math.min(max, Math.trunc(value)))
    if (this._precision === 'minute') this._parts.second = 0
    this._clearInput()
    this._emit(previousValue, reason, segment)
  }

  step(segment: TimeSegment, direction: 1 | -1): void {
    if (!this.segments.includes(segment)) return
    const previousValue = this.value
    this._ensureValue()
    this._parts = stepTimePart(
      this._parts,
      segment,
      direction,
      this._stepFor(segment),
    )
    if (this._precision === 'minute') this._parts.second = 0
    this._clearInput()
    this._emit(previousValue, 'step', segment, direction)
  }

  moveActive(direction: 1 | -1): boolean {
    if (!this._activeSegment) return false
    const index = this.segments.indexOf(this._activeSegment)
    const next = this.segments[index + direction]
    if (!next) return false
    this.activate(next)
    return true
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    let segment = this._activeSegment
    if (!segment) {
      if (isDigit(event.key)) {
        this.activate('hour')
        segment = 'hour'
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        this.activate('hour')
        return true
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        this.activate('hour')
        this.step('hour', event.key === 'ArrowUp' ? 1 : -1)
        return true
      } else {
        return false
      }
    }

    if (isDigit(event.key)) {
      event.preventDefault()
      if (this._inputFresh) {
        this._inputBuffer = ''
        this._inputFresh = false
      }
      this._inputBuffer += event.key
      const firstDigitLimit = segment === 'hour' ? 2 : 5
      if (
        this._inputBuffer.length >= 2 ||
        (this._inputBuffer.length === 1 && Number(this._inputBuffer) > firstDigitLimit)
      ) {
        this.select(segment, Number(this._inputBuffer), 'input')
        if (!this.moveActive(1)) this.deactivate()
      } else {
        this._invalidate()
      }
      return true
    }

    if (event.key === 'Backspace') {
      event.preventDefault()
      if (this._inputFresh) {
        this._inputBuffer = ''
        this._inputFresh = false
      }
      this._inputBuffer = this._inputBuffer.slice(0, -1)
      this._invalidate()
      return true
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      this.commitPending()
      this.step(segment, event.key === 'ArrowUp' ? 1 : -1)
      return true
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      this.commitPending()
      this.moveActive(event.key === 'ArrowRight' ? 1 : -1)
      return true
    }

    if (event.key === 'Tab') {
      this.commitPending()
      const moved = this.moveActive(event.shiftKey ? -1 : 1)
      if (moved) event.preventDefault()
      else this.deactivate()
      return moved
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      this.commitPending()
      this.deactivate()
      return true
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      this.cancelPending()
      this.deactivate()
      return true
    }
    return false
  }

  private _ensureValue(): void {
    if (this._hasValue) return
    this._parts = { hour: 0, minute: 0, second: 0 }
    this._hasValue = true
  }

  private _emit(
    previousValue: string,
    reason: TimeSegmentChangeReason,
    segment?: TimeSegment,
    direction?: 1 | -1,
  ): void {
    const value = this.value
    if (value !== previousValue) {
      this._onChange?.({ value, previousValue, reason, segment, direction })
    }
    this._invalidate()
  }

  private _stepFor(segment: TimeSegment): number {
    if (segment === 'hour') return this._hourStep
    if (segment === 'minute') return this._minuteStep
    return this._secondStep
  }

  private _clearInput(): void {
    this._inputBuffer = ''
    this._inputFresh = true
  }
}

function positiveInteger(value: number | undefined): number {
  if (!Number.isFinite(value) || value! <= 0) return 1
  return Math.max(1, Math.trunc(value!))
}

function isDigit(value: string): boolean {
  return value >= '0' && value <= '9'
}
