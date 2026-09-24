import type { Rect, Size } from './render_object'

export type AnchoredPopupPlacement =
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end'
  | 'left-start'
  | 'left-end'
  | 'right-start'
  | 'right-end'

export type AnchoredPopupOverflowPreference =
  | 'preferred'
  | 'largest-space'

export interface AnchoredPopupLayoutInput {
  anchorRect: Rect
  popupSize: Size
  viewportRect: Rect
  boundaryRect?: Rect
  preferredPlacement: AnchoredPopupPlacement
  fallbackPlacements?: readonly AnchoredPopupPlacement[]
  overflowPreference?: AnchoredPopupOverflowPreference
  gap?: number
  inset?: number
}

export interface AnchoredPopupLayoutResult {
  rect: Rect
  placement: AnchoredPopupPlacement
}

function finiteCoordinate(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function finiteNonNegative(value: number | undefined, fallback = 0): number {
  if (value === undefined) return fallback
  return Number.isFinite(value) ? Math.max(0, value) : fallback
}

function normalizeRect(rect: Rect): Rect {
  return {
    x: finiteCoordinate(rect.x),
    y: finiteCoordinate(rect.y),
    width: finiteNonNegative(rect.width),
    height: finiteNonNegative(rect.height),
  }
}

function intersectRects(first: Rect, second: Rect): Rect {
  const x = Math.max(first.x, second.x)
  const y = Math.max(first.y, second.y)
  const right = Math.min(first.x + first.width, second.x + second.width)
  const bottom = Math.min(first.y + first.height, second.y + second.height)
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, max), Math.max(min, value))
}

export function resolveAnchoredPopupRect(
  input: AnchoredPopupLayoutInput,
): AnchoredPopupLayoutResult | null {
  const anchor = normalizeRect(input.anchorRect)
  const popupSize = {
    width: finiteNonNegative(input.popupSize.width),
    height: finiteNonNegative(input.popupSize.height),
  }
  if (popupSize.width <= 0 || popupSize.height <= 0) return null

  const viewport = normalizeRect(input.viewportRect)
  const boundary = input.boundaryRect
    ? intersectRects(viewport, normalizeRect(input.boundaryRect))
    : viewport
  const inset = finiteNonNegative(input.inset)
  const effectiveBoundary = {
    x: boundary.x + inset,
    y: boundary.y + inset,
    width: Math.max(0, boundary.width - inset * 2),
    height: Math.max(0, boundary.height - inset * 2),
  }
  if (effectiveBoundary.width <= 0 || effectiveBoundary.height <= 0) return null

  const gap = finiteNonNegative(input.gap)
  const boundaryRight = effectiveBoundary.x + effectiveBoundary.width
  const boundaryBottom = effectiveBoundary.y + effectiveBoundary.height
  const placements = placementCandidates(input.preferredPlacement, input.fallbackPlacements)
  const fitted = placements.find(placement => fitsPrimaryAxis(
    placement,
    anchor,
    popupSize,
    effectiveBoundary,
    gap,
  ))
  const placement = fitted ?? (
    input.overflowPreference === 'largest-space'
      ? placementWithLargestSpace(placements, anchor, effectiveBoundary, gap)
      : placements[0]!
  )
  const raw = rawPopupPosition(placement, anchor, popupSize, gap)
  const maxX = Math.max(effectiveBoundary.x, boundaryRight - popupSize.width)
  const maxY = Math.max(effectiveBoundary.y, boundaryBottom - popupSize.height)

  return {
    rect: {
      x: clamp(raw.x, effectiveBoundary.x, maxX),
      y: clamp(raw.y, effectiveBoundary.y, maxY),
      width: popupSize.width,
      height: popupSize.height,
    },
    placement,
  }
}

function placementCandidates(
  preferred: AnchoredPopupPlacement,
  fallbacks: readonly AnchoredPopupPlacement[] | undefined,
): AnchoredPopupPlacement[] {
  const candidates = fallbacks === undefined
    ? [preferred, oppositePlacement(preferred)]
    : [preferred, ...fallbacks]
  return candidates.filter((placement, index) => candidates.indexOf(placement) === index)
}

function oppositePlacement(placement: AnchoredPopupPlacement): AnchoredPopupPlacement {
  const alignment = placement.endsWith('end') ? 'end' : 'start'
  if (placement.startsWith('top')) return `bottom-${alignment}`
  if (placement.startsWith('bottom')) return `top-${alignment}`
  if (placement.startsWith('left')) return `right-${alignment}`
  return `left-${alignment}`
}

function fitsPrimaryAxis(
  placement: AnchoredPopupPlacement,
  anchor: Rect,
  popupSize: Size,
  boundary: Rect,
  gap: number,
): boolean {
  const right = boundary.x + boundary.width
  const bottom = boundary.y + boundary.height
  if (placement.startsWith('top')) return anchor.y - gap - popupSize.height >= boundary.y
  if (placement.startsWith('bottom')) return anchor.y + anchor.height + gap + popupSize.height <= bottom
  if (placement.startsWith('left')) return anchor.x - gap - popupSize.width >= boundary.x
  return anchor.x + anchor.width + gap + popupSize.width <= right
}

function placementWithLargestSpace(
  placements: readonly AnchoredPopupPlacement[],
  anchor: Rect,
  boundary: Rect,
  gap: number,
): AnchoredPopupPlacement {
  let selected = placements[0]!
  let selectedSpace = availablePrimarySpace(selected, anchor, boundary, gap)
  for (const placement of placements.slice(1)) {
    const space = availablePrimarySpace(placement, anchor, boundary, gap)
    if (space <= selectedSpace) continue
    selected = placement
    selectedSpace = space
  }
  return selected
}

function availablePrimarySpace(
  placement: AnchoredPopupPlacement,
  anchor: Rect,
  boundary: Rect,
  gap: number,
): number {
  if (placement.startsWith('top')) return anchor.y - gap - boundary.y
  if (placement.startsWith('bottom')) return boundary.y + boundary.height - anchor.y - anchor.height - gap
  if (placement.startsWith('left')) return anchor.x - gap - boundary.x
  return boundary.x + boundary.width - anchor.x - anchor.width - gap
}

function rawPopupPosition(
  placement: AnchoredPopupPlacement,
  anchor: Rect,
  popupSize: Size,
  gap: number,
): { x: number; y: number } {
  const alignEnd = placement.endsWith('end')
  if (placement.startsWith('top') || placement.startsWith('bottom')) {
    return {
      x: alignEnd ? anchor.x + anchor.width - popupSize.width : anchor.x,
      y: placement.startsWith('top')
        ? anchor.y - popupSize.height - gap
        : anchor.y + anchor.height + gap,
    }
  }
  return {
    x: placement.startsWith('left')
      ? anchor.x - popupSize.width - gap
      : anchor.x + anchor.width + gap,
    y: alignEnd ? anchor.y + anchor.height - popupSize.height : anchor.y,
  }
}
