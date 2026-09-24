import type { Offset } from '../../core/render_object'
import type {
  HitTestCoordinateSpace,
  HitTestEntry,
  HitTestTarget,
  PointerActivationEvent,
  PointerEvent,
} from '../../gestures/hit_test'
import type {
  GridCellInteractionHit,
  GridCellInteractionRole,
} from './grid_interaction_hit'

export type GridCellPointerHandler<T extends Record<string, any>> = (
  hit: GridCellInteractionHit<T>,
  event: PointerEvent,
) => void

export type GridCellActivationHandler<T extends Record<string, any>> = (
  hit: GridCellInteractionHit<T>,
  event: PointerActivationEvent,
) => void

export interface GridInteractionTargetCallbacks<
  T extends Record<string, any> = Record<string, any>,
> {
  onCellBodyDoubleActivate?: GridCellActivationHandler<T>
  onNumberStepperEnter?: GridCellPointerHandler<T>
  onNumberStepperLeave?: GridCellPointerHandler<T>
  onNumberStepperDown?: GridCellPointerHandler<T>
  onNumberStepperMove?: GridCellPointerHandler<T>
  onNumberStepperUp?: GridCellPointerHandler<T>
  onNumberStepperCancel?: GridCellPointerHandler<T>
  onNumberStepperActivate?: GridCellActivationHandler<T>
}

/**
 * Owns the lightweight hit-test targets used by one DataGrid instance.
 *
 * Targets are cached by column and interaction role only. Row identity and
 * row-specific context remain on each HitTestEntry, so virtualized data does
 * not make this registry grow with the number of rows visited.
 */
export class GridInteractionTargetRegistry<
  T extends Record<string, any> = Record<string, any>,
> {
  private readonly _targets = new Map<
    string,
    Map<GridCellInteractionRole, HitTestTarget>
  >()

  constructor(
    private readonly _callbacks: GridInteractionTargetCallbacks<T>,
  ) {}

  targetFor(columnKey: string, role: GridCellInteractionRole): HitTestTarget {
    let columnTargets = this._targets.get(columnKey)
    if (!columnTargets) {
      columnTargets = new Map()
      this._targets.set(columnKey, columnTargets)
    }

    let target = columnTargets.get(role)
    if (!target) {
      target = role === 'cell-body'
        ? this._createCellBodyTarget(columnKey)
        : this._createNumberStepperTarget(columnKey, role)
      columnTargets.set(role, target)
    }
    return target
  }

  targetForHit(hit: GridCellInteractionHit<T>): HitTestTarget {
    return this.targetFor(hit.columnKey, hit.role)
  }

  retainColumns(columnKeys: Iterable<string>): void {
    const retained = new Set(columnKeys)
    for (const columnKey of this._targets.keys()) {
      if (!retained.has(columnKey)) this._targets.delete(columnKey)
    }
  }

  clear(): void {
    this._targets.clear()
  }

  createHitTestEntry(
    hit: GridCellInteractionHit<T>,
    localPosition: Offset,
    coordinateSpace?: HitTestCoordinateSpace,
  ): HitTestEntry {
    return {
      target: this.targetForHit(hit),
      key: hit.interactionKey ?? hit.rowKey,
      data: hit,
      localPosition,
      coordinateSpace,
    }
  }

  private _createCellBodyTarget(columnKey: string): HitTestTarget {
    return {
      onPointerActivate: event => {
        if (event.clickCount !== 2) return
        const hit = this._activationHit(
          event,
          columnKey,
          'cell-body',
        )
        if (!hit) return
        event.stopPropagation()
        this._callbacks.onCellBodyDoubleActivate?.(hit, event)
      },
    }
  }

  private _createNumberStepperTarget(
    columnKey: string,
    role: Exclude<GridCellInteractionRole, 'cell-body'>,
  ): HitTestTarget {
    return {
      onPointerEnter: event => {
        this._forwardPointer(
          event,
          columnKey,
          role,
          this._callbacks.onNumberStepperEnter,
          false,
        )
      },
      onPointerLeave: event => {
        this._forwardPointer(
          event,
          columnKey,
          role,
          this._callbacks.onNumberStepperLeave,
          false,
        )
      },
      onPointerDown: event => {
        this._forwardPointer(
          event,
          columnKey,
          role,
          this._callbacks.onNumberStepperDown,
          true,
        )
      },
      onPointerMove: event => {
        this._forwardPointer(
          event,
          columnKey,
          role,
          this._callbacks.onNumberStepperMove,
          true,
        )
      },
      onPointerUp: event => {
        this._forwardPointer(
          event,
          columnKey,
          role,
          this._callbacks.onNumberStepperUp,
          true,
        )
      },
      onPointerCancel: event => {
        this._forwardPointer(
          event,
          columnKey,
          role,
          this._callbacks.onNumberStepperCancel,
          true,
        )
      },
      onPointerActivate: event => {
        event.stopPropagation()
        const hit = this._activationHit(event, columnKey, role)
        if (!hit) return
        this._callbacks.onNumberStepperActivate?.(hit, event)
      },
    }
  }

  private _forwardPointer(
    event: PointerEvent,
    columnKey: string,
    role: GridCellInteractionRole,
    handler: GridCellPointerHandler<T> | undefined,
    consume: boolean,
  ): void {
    if (consume) event.stopPropagation?.()
    const hit = this._entryHit(event.hitTestEntry, columnKey, role)
    if (!hit) return
    handler?.(hit, event)
  }

  private _activationHit(
    event: PointerActivationEvent,
    columnKey: string,
    role: GridCellInteractionRole,
  ): GridCellInteractionHit<T> | undefined {
    return this._entryHit(event.currentEntry, columnKey, role)
  }

  private _entryHit(
    entry: HitTestEntry | undefined,
    columnKey: string,
    role: GridCellInteractionRole,
  ): GridCellInteractionHit<T> | undefined {
    if (!entry?.data || typeof entry.data !== 'object') return undefined
    const hit = entry.data as Partial<GridCellInteractionHit<T>>
    if (hit.columnKey !== columnKey || hit.role !== role) return undefined
    return entry.data as GridCellInteractionHit<T>
  }
}
