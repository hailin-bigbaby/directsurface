import type { Offset } from '../../core/render_object'
import {
  resolveNumberStepperDirection as resolveSharedNumberStepperDirection,
  resolveNumberStepperWidth as resolveSharedNumberStepperWidth,
} from '../number_stepper'
import type { GridRowId } from './grid_types'

export type GridCellInteractionRole =
  | 'cell-body'
  | 'number-stepper-increase'
  | 'number-stepper-decrease'

export type GridInteractionRowKey = GridRowId | object

export interface GridInteractionRect {
  x: number
  y: number
  w: number
  h: number
}

export interface GridCellInteractionContext<T extends Record<string, any> = Record<string, any>> {
  rect: GridInteractionRect
  row: T
  rowId: GridRowId | null
  interactionKey?: GridInteractionRowKey
  sourceRowIndex: number
  visibleItemIndex: number
  visibleRowIndex: number
  columnIndex: number
  columnKey: string
  numberStepperWidth?: number
}

export interface GridCellInteractionHit<T extends Record<string, any> = Record<string, any>> {
  role: GridCellInteractionRole
  rowKey: GridInteractionRowKey
  interactionKey?: GridInteractionRowKey
  row: T
  rowId: GridRowId | null
  sourceRowIndex: number
  visibleItemIndex: number
  visibleRowIndex: number
  columnIndex: number
  columnKey: string
  cellRect: GridInteractionRect
  regionRect: GridInteractionRect
}

/**
 * Resolves the logical interaction inside a data cell.
 *
 * The returned `rowKey` is suitable for a virtual hit-test entry when the
 * corresponding target is stable per column and role. A configured row id is
 * preferred so identity survives sorting, filtering and row replacement.
 * Without a row id, the row object reference is the safest available identity.
 */
export function resolveGridCellInteractionHit<T extends Record<string, any>>(
  position: Offset,
  context: GridCellInteractionContext<T>,
): GridCellInteractionHit<T> | null {
  if (!pointInHalfOpenRect(position, context.rect)) return null

  const stepperWidth = resolveNumberStepperWidth(context.rect, context.numberStepperWidth)
  const stepperDirection = resolveNumberStepperDirection(
    position,
    context.rect,
    context.numberStepperWidth,
  )
  if (stepperDirection) {
    const stepperX = context.rect.x + context.rect.w - stepperWidth
    const halfHeight = context.rect.h / 2
    const increase = stepperDirection === 'up'
    return createHit(
      context,
      increase ? 'number-stepper-increase' : 'number-stepper-decrease',
      {
        x: stepperX,
        y: increase ? context.rect.y : context.rect.y + halfHeight,
        w: stepperWidth,
        h: increase ? halfHeight : context.rect.h - halfHeight,
      },
    )
  }

  return createHit(context, 'cell-body', {
    ...context.rect,
    w: context.rect.w - stepperWidth,
  })
}

export function sameGridCellInteraction(
  first: GridCellInteractionHit | null | undefined,
  second: GridCellInteractionHit | null | undefined,
): boolean {
  return !!first &&
    !!second &&
    first.role === second.role &&
    first.columnKey === second.columnKey &&
    Object.is(
      first.interactionKey ?? first.rowKey,
      second.interactionKey ?? second.rowKey,
    )
}

export function resolveNumberStepperWidth(rect: GridInteractionRect, configuredWidth: number | undefined): number {
  return resolveSharedNumberStepperWidth(rect.w, configuredWidth)
}

export function resolveNumberStepperDirection(
  position: Offset,
  rect: GridInteractionRect,
  configuredWidth: number | undefined,
): 'up' | 'down' | null {
  return resolveSharedNumberStepperDirection(position, rect, configuredWidth)
}

function createHit<T extends Record<string, any>>(
  context: GridCellInteractionContext<T>,
  role: GridCellInteractionRole,
  regionRect: GridInteractionRect,
): GridCellInteractionHit<T> {
  return {
    role,
    rowKey: context.rowId ?? context.row,
    interactionKey: context.interactionKey ?? context.rowId ?? context.row,
    row: context.row,
    rowId: context.rowId,
    sourceRowIndex: context.sourceRowIndex,
    visibleItemIndex: context.visibleItemIndex,
    visibleRowIndex: context.visibleRowIndex,
    columnIndex: context.columnIndex,
    columnKey: context.columnKey,
    cellRect: { ...context.rect },
    regionRect,
  }
}

function pointInHalfOpenRect(position: Offset, rect: GridInteractionRect): boolean {
  return rect.w > 0 &&
    rect.h > 0 &&
    position.x >= rect.x &&
    position.x < rect.x + rect.w &&
    position.y >= rect.y &&
    position.y < rect.y + rect.h
}
