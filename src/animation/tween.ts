// Tween: 在两个值之间插值

import { lerpColor, type Color } from '../theme/theme'

export interface Animatable<T> {
  lerp(t: number): T
}

export class Tween<T> implements Animatable<T> {
  begin: T
  end: T
  private _lerp: (a: T, b: T, t: number) => T

  constructor(begin: T, end: T, lerp: (a: T, b: T, t: number) => T) {
    this.begin = begin
    this.end = end
    this._lerp = lerp
  }

  lerp(t: number): T {
    return this._lerp(this.begin, this.end, t)
  }
}

export function NumberTween(begin: number, end: number): Tween<number> {
  return new Tween(begin, end, (a, b, t) => a + (b - a) * t)
}

export function ColorTween(begin: Color, end: Color): Tween<Color> {
  return new Tween(begin, end, (a, b, t) => lerpColor(a, b, t))
}

export interface OffsetValue { x: number; y: number }
export function OffsetTween(begin: OffsetValue, end: OffsetValue): Tween<OffsetValue> {
  return new Tween(begin, end, (a, b, t) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  }))
}
