export type PointerType = 'mouse' | 'touch' | 'pen'

export interface PointerIdentity {
  readonly pointerId: number
  readonly pointerType: PointerType
}

export type PointerIdentitySource =
  | number
  | {
      readonly pointerId: number
      readonly pointerType?: PointerType
    }

declare const pointerKeyBrand: unique symbol

/**
 * Stable internal identity for one pointer source.
 *
 * Public events keep their native numeric pointerId. Internal routing must
 * additionally include the pointer type because mouse and touch may both use
 * the same numeric id.
 */
export type PointerKey = string & {
  readonly [pointerKeyBrand]: true
}

export function resolvePointerIdentity(
  source: PointerIdentitySource,
  pointerType: PointerType = 'mouse',
): PointerIdentity {
  if (typeof source === 'number') {
    return { pointerId: source, pointerType }
  }
  return {
    pointerId: source.pointerId,
    pointerType: source.pointerType ?? pointerType,
  }
}

export function pointerKey(
  source: PointerIdentitySource,
  pointerType: PointerType = 'mouse',
): PointerKey {
  const identity = resolvePointerIdentity(source, pointerType)
  return `${identity.pointerType}:${identity.pointerId}` as PointerKey
}
