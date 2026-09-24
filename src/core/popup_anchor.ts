import type { Rect } from './render_object'

export const GET_POPUP_ANCHOR_RECT = Symbol('getPopupAnchorRect')

export interface PopupAnchorTarget<TAnchor = unknown> {
  [GET_POPUP_ANCHOR_RECT](anchor?: TAnchor): Rect
}

export interface PopupAnchorPlacement<TAnchor = unknown> {
  target: PopupAnchorTarget<TAnchor>
  data?: TAnchor
}

export type PopupAnchor<TAnchor = unknown> =
  | PopupAnchorTarget<TAnchor>
  | PopupAnchorPlacement<TAnchor>

function resolvePopupAnchorSource<TAnchor>(
  anchor?: PopupAnchor<TAnchor> | null,
): { target: PopupAnchorTarget<TAnchor>; data?: TAnchor } | null {
  if (!anchor) return null
  if (typeof anchor === 'object' && anchor !== null && 'target' in anchor) {
    return {
      target: anchor.target,
      data: anchor.data,
    }
  }
  return { target: anchor }
}

export function resolvePopupAnchorTarget<TAnchor>(
  anchor?: PopupAnchor<TAnchor> | null,
): PopupAnchorTarget<TAnchor> | undefined {
  return resolvePopupAnchorSource(anchor)?.target
}

export function resolvePopupAnchorRect<TAnchor>(
  anchor?: PopupAnchor<TAnchor> | null,
): { x: number; y: number; w: number; h: number } {
  const source = resolvePopupAnchorSource(anchor)
  if (!source) return { x: 0, y: 0, w: 0, h: 0 }
  const rect = source.target[GET_POPUP_ANCHOR_RECT](source.data)
  return {
    x: rect.x,
    y: rect.y,
    w: rect.width,
    h: rect.height,
  }
}
