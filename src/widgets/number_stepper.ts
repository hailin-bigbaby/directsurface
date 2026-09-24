import type { Offset } from '../core/render_object'
import { DrawList } from '../rendering/draw_list'
import {
  resolveBgColor,
  resolveTextColor,
  type InteractionState,
  type NumberStepperStyleTokens,
} from '../theme/component_styles'

export type NumberStepperDirection = 'up' | 'down'

export interface NumberStepperRect {
  x: number
  y: number
  w: number
  h: number
}

export function resolveNumberStepperWidth(
  hostWidth: number,
  configuredWidth: number | undefined,
): number {
  if (configuredWidth === undefined || !Number.isFinite(configuredWidth) || configuredWidth <= 0) return 0
  return Math.min(configuredWidth, Math.max(0, hostWidth - 2))
}

export function resolveNumberStepperDirection(
  position: Offset,
  rect: NumberStepperRect,
  configuredWidth: number | undefined,
): NumberStepperDirection | null {
  if (!pointInHalfOpenRect(position, rect)) return null
  const width = resolveNumberStepperWidth(rect.w, configuredWidth)
  if (width <= 0 || position.x < rect.x + rect.w - width) return null
  return position.y < rect.y + rect.h / 2 ? 'up' : 'down'
}

export function paintNumberStepper(
  dl: DrawList,
  opts: {
    rect: NumberStepperRect
    tokens: NumberStepperStyleTokens
    hovered?: NumberStepperDirection | null
    pressed?: NumberStepperDirection | null
    disabled?: boolean
  },
): void {
  const { rect, tokens } = opts
  if (rect.w <= 0 || rect.h <= 0) return
  const halfHeight = rect.h / 2
  const upperState = resolveState('up', opts)
  const lowerState = resolveState('down', opts)

  dl.fillRect(rect.x, rect.y + 1, rect.w - 1, Math.max(0, halfHeight - 1), resolveBgColor(tokens.background, upperState), 0)
  dl.fillRect(rect.x, rect.y + halfHeight, rect.w - 1, Math.max(0, halfHeight - 1), resolveBgColor(tokens.background, lowerState), 0)
  dl.line(rect.x, rect.y + 1, rect.x, rect.y + rect.h - 1, tokens.border, 1)
  dl.line(rect.x, rect.y + halfHeight, rect.x + rect.w - 1, rect.y + halfHeight, tokens.border, 1)

  const arrowSize = Math.max(0, Math.min(4, rect.w * 0.22, rect.h * 0.14))
  const centerX = rect.x + rect.w / 2
  const upperY = rect.y + halfHeight / 2
  const lowerY = rect.y + halfHeight + halfHeight / 2
  dl.fillPolygon([
    { x: centerX - arrowSize, y: upperY + arrowSize / 2 },
    { x: centerX + arrowSize, y: upperY + arrowSize / 2 },
    { x: centerX, y: upperY - arrowSize / 2 },
  ], resolveTextColor(tokens.arrowText, upperState))
  dl.fillPolygon([
    { x: centerX - arrowSize, y: lowerY - arrowSize / 2 },
    { x: centerX + arrowSize, y: lowerY - arrowSize / 2 },
    { x: centerX, y: lowerY + arrowSize / 2 },
  ], resolveTextColor(tokens.arrowText, lowerState))
}

function resolveState(
  direction: NumberStepperDirection,
  opts: {
    hovered?: NumberStepperDirection | null
    pressed?: NumberStepperDirection | null
    disabled?: boolean
  },
): InteractionState {
  if (opts.disabled) return 'disabled'
  if (opts.pressed === direction) return 'pressed'
  if (opts.hovered === direction) return 'hovered'
  return 'normal'
}

function pointInHalfOpenRect(position: Offset, rect: NumberStepperRect): boolean {
  return rect.w > 0 &&
    rect.h > 0 &&
    position.x >= rect.x &&
    position.x < rect.x + rect.w &&
    position.y >= rect.y &&
    position.y < rect.y + rect.h
}
