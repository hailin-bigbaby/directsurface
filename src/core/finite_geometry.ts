import type { Offset, Rect } from './render_object'

export function assertFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`)
  return value
}

export function assertFiniteOptionalNumber(value: number | undefined, label: string): number | undefined {
  if (value !== undefined) assertFiniteNumber(value, label)
  return value
}

export function assertFiniteOffset(offset: Offset, label: string): void {
  assertFiniteNumber(offset.x, `${label} x`)
  assertFiniteNumber(offset.y, `${label} y`)
}

export function isFiniteRect(rect: Rect | undefined): boolean {
  return rect === undefined ||
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
}

export function assertFiniteRectPatch(rect: Partial<Rect> | undefined, label: string): void {
  if (!rect) return
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = rect[key]
    if (value !== undefined) assertFiniteNumber(value, `${label} ${key}`)
  }
}
