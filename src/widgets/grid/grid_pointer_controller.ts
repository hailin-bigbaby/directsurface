import { FocusManager, type Focusable } from '../../core/focus_manager'
import type { Offset } from '../../core/render_object'
import type { PointerEvent, WheelPointerEvent } from '../../gestures/recognizers'
import { isPrimaryPointerButton } from '../../gestures/hit_test'
import { ScrollbarAxisController } from '../../gestures/scrollbar_interaction_controller'
import { pointerKey, type PointerKey } from '../../gestures/pointer_identity'
import {
  EdgeAutoScrollDriver,
  type EdgeAutoScrollInput,
} from '../../gestures/edge_auto_scroll'
import type { GridDataModel } from './grid_data_model'
import type { GridEditingController } from './grid_editing_controller'
import type { GridFilterPopupController } from './grid_filter_popup_controller'
import type { GridInteractionController } from './grid_interaction_controller'
import type { GridColumnDef, GridGroupItem, GridVisibleItem } from './grid_types'
import { GRID_COLUMN_RESIZE_HANDLE_SIZE, type GridViewport } from './grid_viewport'
import type { GridHeaderActionStyleTokens } from '../../theme/component_styles'

export interface GridPointerControllerOptions<T extends Record<string, any>> {
  focusableOwner: Focusable
  dataModel: GridDataModel<T>
  viewport: GridViewport<T>
  editing: GridEditingController<T>
  interaction: GridInteractionController<T>
  filterPopupController: GridFilterPopupController<T>
  hitTest: (position: Offset) => boolean
  getGlobalOffset: () => Offset
  getColumns: () => GridColumnDef<T>[]
  canResizeColumns: () => boolean
  canAutoFitColumns: () => boolean
  canRangeSelectionAutoScroll: () => boolean
  canReorderColumns: () => boolean
  canSortColumns: () => boolean
  getHeaderActionStyle: () => { paddingH: number; fontSize: number; metrics: GridHeaderActionStyleTokens }
  isInGroupToggleHitBox: (item: GridGroupItem<T>, position: Offset) => boolean
  onMoveColumn: (fromIndex: number, toIndex: number) => void
  onResizeColumn: (colIndex: number, width: number) => void
  onAutoFitColumn: (colIndex: number) => void
  onToggleSortAt: (globalX: number, additive?: boolean) => void
  onToggleGroup: (pathKey: string) => boolean
  onSyncEditingViewportState: () => void
  onInteractionStateChange?: () => void
  onSetCursor: (cursor: string) => void
  onMarkNeedsPaint: () => void
}

type GridPointerOwnerMode = 'drag' | 'number-stepper'

export class GridPointerController<T extends Record<string, any> = any> {
  private static readonly RANGE_AUTO_SCROLL_EDGE = 28
  private static readonly RANGE_AUTO_SCROLL_INTERVAL = 32
  private static readonly RANGE_AUTO_SCROLL_MAX_X_STEP = 48

  private readonly _focusableOwner: Focusable
  private readonly _dataModel: GridDataModel<T>
  private readonly _viewport: GridViewport<T>
  private readonly _editing: GridEditingController<T>
  private readonly _interaction: GridInteractionController<T>
  private readonly _filterPopupController: GridFilterPopupController<T>
  private readonly _hitTest: GridPointerControllerOptions<T>['hitTest']
  private readonly _getGlobalOffset: GridPointerControllerOptions<T>['getGlobalOffset']
  private readonly _getColumns: GridPointerControllerOptions<T>['getColumns']
  private readonly _canResizeColumns: GridPointerControllerOptions<T>['canResizeColumns']
  private readonly _canAutoFitColumns: GridPointerControllerOptions<T>['canAutoFitColumns']
  private readonly _canRangeSelectionAutoScroll: GridPointerControllerOptions<T>['canRangeSelectionAutoScroll']
  private readonly _canReorderColumns: GridPointerControllerOptions<T>['canReorderColumns']
  private readonly _canSortColumns: GridPointerControllerOptions<T>['canSortColumns']
  private readonly _getHeaderActionStyle: GridPointerControllerOptions<T>['getHeaderActionStyle']
  private readonly _isInGroupToggleHitBox: GridPointerControllerOptions<T>['isInGroupToggleHitBox']
  private readonly _onMoveColumn: GridPointerControllerOptions<T>['onMoveColumn']
  private readonly _onResizeColumn: GridPointerControllerOptions<T>['onResizeColumn']
  private readonly _onAutoFitColumn: GridPointerControllerOptions<T>['onAutoFitColumn']
  private readonly _onToggleSortAt: GridPointerControllerOptions<T>['onToggleSortAt']
  private readonly _onToggleGroup: GridPointerControllerOptions<T>['onToggleGroup']
  private readonly _onSyncEditingViewportState: GridPointerControllerOptions<T>['onSyncEditingViewportState']
  private readonly _onInteractionStateChange: () => void
  private readonly _onSetCursor: GridPointerControllerOptions<T>['onSetCursor']
  private readonly _onMarkNeedsPaint: GridPointerControllerOptions<T>['onMarkNeedsPaint']
  private readonly _rangeAutoScrollDriver: EdgeAutoScrollDriver
  private readonly _vScrollbarController: ScrollbarAxisController
  private readonly _hScrollbarController: ScrollbarAxisController
  private _dragPointerKey?: PointerKey
  private _pointerOwnerMode?: GridPointerOwnerMode
  private _releasePointerCapture?: () => void

  constructor(options: GridPointerControllerOptions<T>) {
    this._focusableOwner = options.focusableOwner
    this._dataModel = options.dataModel
    this._viewport = options.viewport
    this._vScrollbarController = options.viewport.vScrollbarController ??
      new ScrollbarAxisController('vertical', options.viewport.vScrollbar)
    this._hScrollbarController = options.viewport.hScrollbarController ??
      new ScrollbarAxisController('horizontal', options.viewport.hScrollbar)
    this._editing = options.editing
    this._interaction = options.interaction
    this._filterPopupController = options.filterPopupController
    this._hitTest = options.hitTest
    this._getGlobalOffset = options.getGlobalOffset
    this._getColumns = options.getColumns
    this._canResizeColumns = options.canResizeColumns
    this._canAutoFitColumns = options.canAutoFitColumns
    this._canRangeSelectionAutoScroll = options.canRangeSelectionAutoScroll
    this._canReorderColumns = options.canReorderColumns
    this._canSortColumns = options.canSortColumns
    this._getHeaderActionStyle = options.getHeaderActionStyle
    this._isInGroupToggleHitBox = options.isInGroupToggleHitBox
    this._onMoveColumn = options.onMoveColumn
    this._onResizeColumn = options.onResizeColumn
    this._onAutoFitColumn = options.onAutoFitColumn
    this._onToggleSortAt = options.onToggleSortAt
    this._onToggleGroup = options.onToggleGroup
    this._onSyncEditingViewportState = options.onSyncEditingViewportState
    this._onInteractionStateChange = options.onInteractionStateChange ?? (() => {})
    this._onSetCursor = options.onSetCursor
    this._onMarkNeedsPaint = options.onMarkNeedsPaint
    this._rangeAutoScrollDriver = new EdgeAutoScrollDriver({
      intervalMs: GridPointerController.RANGE_AUTO_SCROLL_INTERVAL,
      onScroll: (delta, input) => this._tickRangeAutoScroll(
        delta,
        input.position,
      ),
    })
  }

  hasForeignPointerOwner(
    event: Pick<PointerEvent, 'pointerId' | 'pointerType'>,
  ): boolean {
    return this._dragPointerKey !== undefined &&
      this._dragPointerKey !== pointerKey(event)
  }

  hasPointerOwner(): boolean {
    return this._dragPointerKey !== undefined
  }

  acceptsNumberStepperPointer(
    event: Pick<PointerEvent, 'pointerId' | 'pointerType' | 'preventActivation'>,
  ): boolean {
    const accepted = this._dragPointerKey === undefined ||
      (
        this._dragPointerKey === pointerKey(event) &&
        this._pointerOwnerMode === 'number-stepper'
      )
    if (!accepted) event.preventActivation?.()
    return accepted
  }

  beginNumberStepperPointer(event: PointerEvent): boolean {
    if (!this._claimPointerOwner(event, 'number-stepper')) {
      event.preventActivation?.()
      return false
    }
    return true
  }

  ownsNumberStepperPointer(
    event: Pick<PointerEvent, 'pointerId' | 'pointerType'>,
  ): boolean {
    return this._dragPointerKey === pointerKey(event) &&
      this._pointerOwnerMode === 'number-stepper'
  }

  endNumberStepperPointer(event?: PointerEvent): boolean {
    return this._releasePointerOwner(event, 'number-stepper')
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (
      this.hasForeignPointerOwner(event) ||
      this._pointerOwnerMode === 'number-stepper'
    ) {
      event.preventActivation?.()
      return
    }
    if (!this._hitTest(event.position)) {
      if (this._editing.commitEdit() === false) return
      FocusManager.instance.clearFocus()
      return
    }

    const columns = this._getColumns()
    const globalOffset = this._getGlobalOffset()
    const visibleItemCount = this._dataModel.visibleItemCount()
    const resizeCol = this._viewport.resizeColAt(
      event.position,
      globalOffset,
      columns,
      this._canResizeColumns(),
    )
    if (this._canResizeColumns() && resizeCol >= 0) {
      if (!this._captureDrag(event)) return
      this._viewport.hoveredResizeCol = resizeCol
      this._viewport.resizingCol = resizeCol
      this._viewport.resizeStartX = event.position.x
      this._viewport.resizeStartW = this._viewport.colWidths[resizeCol]!
      this._viewport.resizeCurrentX = event.position.x
      this._onSetCursor('col-resize')
      this._onMarkNeedsPaint()
      return
    }

    if (this._viewport.hoveredResizeCol >= 0) {
      this._viewport.hoveredResizeCol = -1
      this._onMarkNeedsPaint()
    }
    this._onSetCursor('default')

    const key = pointerKey(event)
    const verticalResult = this._vScrollbarController.beginPointer(
      event.position,
      this._viewport.vScrollbarGeometry(globalOffset, visibleItemCount),
      key,
    )
    if (verticalResult.handled) {
      event.stopPropagation?.()
      if (verticalResult.dragStarted && !this._captureDrag(event)) {
        this._vScrollbarController.cancelPointer(key)
        return
      }
      if (verticalResult.scrollOffset !== undefined) {
        this._viewport.setScrollY(visibleItemCount, verticalResult.scrollOffset)
        this._onSyncEditingViewportState()
      }
      this._onMarkNeedsPaint()
      return
    }

    const horizontalResult = this._hScrollbarController.beginPointer(
      event.position,
      this._viewport.hScrollbarGeometry(globalOffset, columns),
      key,
    )
    if (horizontalResult.handled) {
      event.stopPropagation?.()
      if (horizontalResult.dragStarted && !this._captureDrag(event)) {
        this._hScrollbarController.cancelPointer(key)
        return
      }
      if (horizontalResult.scrollOffset !== undefined) {
        this._viewport.setScrollX(columns, horizontalResult.scrollOffset)
        this._onSyncEditingViewportState()
      }
      this._onMarkNeedsPaint()
      return
    }

    const filterRowCol = this._viewport.filterRowColAt(event.position, globalOffset, columns)
    if (filterRowCol >= 0) {
      if (this._editing.commitEdit() === false) return
      if (columns[filterRowCol]?.filterable) {
        this._filterPopupController.openFilterPopup(filterRowCol, 'condition')
      }
      return
    }

    const headerActionStyle = this._getHeaderActionStyle()
    const filterCol = this._viewport.filterIconAt(
      event.position,
      globalOffset,
      columns,
      {
        sortable: this._canSortColumns(),
        sortState: this._dataModel.sortState,
        groupBy: this._dataModel.groupBy,
        paddingH: headerActionStyle.paddingH,
        fontSize: headerActionStyle.fontSize,
        metrics: headerActionStyle.metrics,
      },
    )
    if (filterCol >= 0) {
      if (this._editing.commitEdit() === false) return
      this._filterPopupController.openFilterPopup(filterCol)
      return
    }

    if (this._viewport.inHeader(event.position, globalOffset)) {
      if (this._canReorderColumns()) {
        const colIndex = this._viewport.colAtX(event.position.x, globalOffset, columns)
        if (this._viewport.normalizeColumnMoveTarget(columns, colIndex, colIndex) >= 0) {
          if (!this._captureDrag(event)) return
          this._viewport.draggingCol = colIndex
          this._viewport.dragColStartX = event.position.x
          this._viewport.dropTargetCol = colIndex
          return
        }
      }
      this._onToggleSortAt(event.position.x, event.shiftKey)
      return
    }

    const itemIndex = this._viewport.rowAtY(event.position.y, globalOffset, visibleItemCount)
    if (itemIndex < 0) return
    const item = this._dataModel.visibleItemAt(itemIndex)
    if (!item) return
    const colIndex = this._viewport.colAtX(event.position.x, globalOffset, columns)

    if (item.kind === 'group') {
      if (this._editing.commitEdit() === false) return
      if (this._isInGroupToggleHitBox(item, event.position)) {
        this._onToggleGroup(item.pathKey)
      } else {
        this._interaction.focusedItemIndex = itemIndex
        this._onMarkNeedsPaint()
      }
      FocusManager.instance.setFocus(this._focusableOwner)
      return
    }

    const editingNumberStepper = this._editing.numberStepperDirectionAt(event.position)
    if (
      this._editing.state &&
      this._editing.state.row === item.dataRowIndex &&
      this._editing.state.col === colIndex
    ) {
      if (editingNumberStepper) {
        if (!this.beginNumberStepperPointer(event)) return
        let handled = false
        let firstError: unknown
        let hasError = false
        try {
          handled = this._editing.handlePointerDownInEditingCell(
            event.position.x,
            event.position.y,
            event,
          )
        } catch (error) {
          firstError = error
          hasError = true
        }
        if (!handled) {
          try {
            this.endNumberStepperPointer(event)
          } catch (error) {
            if (!hasError) {
              firstError = error
              hasError = true
            }
          }
        }
        if (hasError) throw firstError
        if (handled) return
      } else if (
        this._editing.handlePointerDownInEditingCell(
          event.position.x,
          event.position.y,
          event,
        )
      ) {
        this._captureDrag(event)
        return
      }
    }

    if (this._editing.commitEdit() === false) return
    this._interaction.handleItemPointerDown(itemIndex, {
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      colIndex,
    })
    if (this._interaction.beginPointerRangeSelection(itemIndex, colIndex)) {
      if (!this._captureDrag(event)) {
        this._interaction.endPointerRangeSelection()
        return
      }
    }
    FocusManager.instance.setFocus(this._focusableOwner)
  }

  onPointerMove(event: PointerEvent): void {
    if (this.hasForeignPointerOwner(event)) {
      return
    }
    const columns = this._getColumns()
    const globalOffset = this._getGlobalOffset()
    if (this._viewport.draggingCol >= 0) {
      event.stopPropagation?.()
      const targetCol = this._viewport.normalizeColumnMoveTarget(
        columns,
        this._viewport.draggingCol,
        this._viewport.colAtX(event.position.x, globalOffset, columns),
      )
      if (targetCol >= 0 && targetCol !== this._viewport.dropTargetCol) {
        this._viewport.dropTargetCol = targetCol
        this._onMarkNeedsPaint()
      }
      return
    }

    if (this._viewport.resizingCol >= 0) {
      event.stopPropagation?.()
      this._viewport.resizeCurrentX = event.position.x
      this._onSetCursor('col-resize')
      this._onMarkNeedsPaint()
      return
    }

    if (this._viewport.vScrollbar.dragging) {
      event.stopPropagation?.()
      const visibleItemCount = this._dataModel.visibleItemCount()
      const result = this._vScrollbarController.updatePointer(
        event.position,
        this._viewport.vScrollbarGeometry(globalOffset, visibleItemCount),
        pointerKey(event),
      )
      if (result.scrollOffset !== undefined) {
        this._viewport.setScrollY(visibleItemCount, result.scrollOffset)
      }
      this._onSyncEditingViewportState()
      this._onMarkNeedsPaint()
      return
    }

    if (this._viewport.hScrollbar.dragging) {
      event.stopPropagation?.()
      const result = this._hScrollbarController.updatePointer(
        event.position,
        this._viewport.hScrollbarGeometry(globalOffset, columns),
        pointerKey(event),
      )
      if (result.scrollOffset !== undefined) {
        this._viewport.setScrollX(columns, result.scrollOffset)
      }
      this._onSyncEditingViewportState()
      this._onMarkNeedsPaint()
      return
    }

    if (this._interaction.isPointerRangeSelecting) {
      event.stopPropagation?.()
      this._handlePointerRangeSelectionMove(event.position)
      return
    }

    const hoveredResizeCol = this._viewport.resizeColAt(
      event.position,
      globalOffset,
      columns,
      this._canResizeColumns(),
    )
    this._onSetCursor(hoveredResizeCol >= 0 ? 'col-resize' : 'default')
    if (hoveredResizeCol !== this._viewport.hoveredResizeCol) {
      this._viewport.hoveredResizeCol = hoveredResizeCol
      this._onMarkNeedsPaint()
    }

    const headerActionStyle = this._getHeaderActionStyle()
    const hoveredFilterCol = this._viewport.filterIconAt(
      event.position,
      globalOffset,
      columns,
      {
        sortable: this._canSortColumns(),
        sortState: this._dataModel.sortState,
        groupBy: this._dataModel.groupBy,
        paddingH: headerActionStyle.paddingH,
        fontSize: headerActionStyle.fontSize,
        metrics: headerActionStyle.metrics,
      },
    )
    const hoveredHeaderCol = this._viewport.inHeader(event.position, globalOffset)
      ? this._viewport.colAtX(event.position.x, globalOffset, columns)
      : -1
    if (
      hoveredFilterCol !== this._viewport.hoveredFilterCol ||
      hoveredHeaderCol !== this._viewport.hoveredHeaderCol
    ) {
      this._viewport.hoveredFilterCol = hoveredFilterCol
      this._viewport.hoveredHeaderCol = hoveredHeaderCol
      this._onMarkNeedsPaint()
    }

    const visibleItemCount = this._dataModel.visibleItemCount()
    if (this._vScrollbarController.updateHover(
      event.position,
      this._viewport.vScrollbarGeometry(globalOffset, visibleItemCount),
    )) {
      this._onMarkNeedsPaint()
    }

    if (this._hScrollbarController.updateHover(
      event.position,
      this._viewport.hScrollbarGeometry(globalOffset, columns),
    )) {
      this._onMarkNeedsPaint()
    }

    const hoveredItemIndex = this._viewport.rowAtY(event.position.y, globalOffset, this._dataModel.visibleItemCount())
    if (this._editing.handlePointerMove(event.position.x, event.position.y, event)) return
    this._interaction.setHoveredItem(hoveredItemIndex)
  }

  onPointerUp(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this.hasForeignPointerOwner(event)) {
      return
    }
    const hadPointerInteraction = this._hasCapturedDrag()
    const draggingCol = this._viewport.draggingCol
    const dropTargetCol = this._viewport.dropTargetCol
    const resizedCol = this._viewport.resizingCol
    let columnAction:
      | { kind: 'sort'; x: number; additive?: boolean }
      | { kind: 'move'; fromIndex: number; toIndex: number }
      | undefined
    let resizeAction: { colIndex: number; width: number } | undefined
    let keepResizeHover = false

    let firstError: unknown
    let hasError = false
    const attempt = (callback: () => void): void => {
      try {
        callback()
      } catch (error) {
        if (!hasError) {
          firstError = error
          hasError = true
        }
      }
    }

    attempt(() => {
      if (draggingCol < 0) return
      const dragDistance = Math.abs(event.position.x - this._viewport.dragColStartX)
      if (dragDistance < 5 && dropTargetCol >= 0) {
        columnAction = {
          kind: 'sort',
          x: event.position.x,
          additive: event.shiftKey,
        }
      } else if (dropTargetCol >= 0 && draggingCol !== dropTargetCol) {
        columnAction = {
          kind: 'move',
          fromIndex: draggingCol,
          toIndex: dropTargetCol,
        }
      }
    })
    attempt(() => {
      if (resizedCol < 0) return
      const column = this._getColumns()[resizedCol]
      const minWidth = column?.minWidth ?? 40
      const width = Math.max(minWidth, this._viewport.resizeStartW + event.position.x - this._viewport.resizeStartX)
      const committedGuideX = this._viewport.resizeStartX + width - this._viewport.resizeStartW
      keepResizeHover =
        Math.abs(event.position.x - committedGuideX) <= GRID_COLUMN_RESIZE_HANDLE_SIZE &&
        this._canResizeColumns() &&
        !!column &&
        (column.widthMode ?? 'interactive') !== 'fixed'
      resizeAction = { colIndex: resizedCol, width }
    })

    // Clear ownership and transient state before notifying callbacks. A
    // callback may throw, but the completed sequence must never remain active.
    this._viewport.draggingCol = -1
    this._viewport.dropTargetCol = -1
    this._viewport.resizingCol = -1
    this._viewport.resizeCurrentX = 0
    if (resizedCol >= 0) {
      this._viewport.hoveredResizeCol = -1
    }
    const globalOffset = this._getGlobalOffset()
    const columns = this._getColumns()
    this._vScrollbarController.endPointer(
      event.position,
      this._viewport.vScrollbarGeometry(globalOffset, this._dataModel.visibleItemCount()),
      pointerKey(event),
    )
    this._hScrollbarController.endPointer(
      event.position,
      this._viewport.hScrollbarGeometry(globalOffset, columns),
      pointerKey(event),
    )
    attempt(() => this._stopRangeAutoScroll())
    attempt(() => this._releasePointerOwner(event))
    attempt(() => this._interaction.endPointerRangeSelection())
    attempt(() => {
      this._editing.finishNumberStepperPress?.(
        event.position.x,
        event.position.y,
        true,
        event,
      )
    })
    attempt(() => this._editing.stopDrag())

    const resolvedColumnAction = columnAction
    if (resolvedColumnAction?.kind === 'sort') {
      attempt(() => this._onToggleSortAt(
        resolvedColumnAction.x,
        resolvedColumnAction.additive,
      ))
    } else if (resolvedColumnAction?.kind === 'move') {
      attempt(() => this._onMoveColumn(
        resolvedColumnAction.fromIndex,
        resolvedColumnAction.toIndex,
      ))
    }
    const resolvedResizeAction = resizeAction
    if (resolvedResizeAction) {
      attempt(() => this._onResizeColumn(
        resolvedResizeAction.colIndex,
        resolvedResizeAction.width,
      ))
    }
    if (resizedCol >= 0) {
      this._viewport.hoveredResizeCol = keepResizeHover ? resizedCol : -1
      attempt(() => this._onSetCursor(
        keepResizeHover ? 'col-resize' : 'default',
      ))
    }
    if (hadPointerInteraction) {
      attempt(() => this._onMarkNeedsPaint())
    }
    if (hasError) throw firstError
  }

  onPointerCancel(event?: PointerEvent): void {
    if (event && this.hasForeignPointerOwner(event)) {
      return
    }
    let firstError: unknown
    let hasError = false
    const attempt = (callback: () => void): void => {
      try {
        callback()
      } catch (error) {
        if (!hasError) {
          firstError = error
          hasError = true
        }
      }
    }

    this._viewport.draggingCol = -1
    this._viewport.dropTargetCol = -1
    this._viewport.resizingCol = -1
    this._viewport.resizeCurrentX = 0
    this._viewport.hoveredResizeCol = -1
    const key = event ? pointerKey(event) : undefined
    this._vScrollbarController.cancelPointer(key)
    this._hScrollbarController.cancelPointer(key)
    this._viewport.hoveredHeaderCol = -1
    this._viewport.hoveredFilterCol = -1
    attempt(() => this._stopRangeAutoScroll())
    attempt(() => this._releasePointerOwner(event))
    attempt(() => this._interaction.endPointerRangeSelection())
    if (event) {
      attempt(() => this._editing.cancelNumberStepperPress(true, event))
      attempt(() => this._editing.stopDrag())
    } else {
      attempt(() => this._editing.clearPointerState())
    }
    attempt(() => this._interaction.clearPointerState())
    attempt(() => this._onSetCursor('default'))
    attempt(() => this._onMarkNeedsPaint())
    if (hasError) throw firstError
  }

  onPointerLeave(event?: PointerEvent): void {
    if (
      this._dragPointerKey !== undefined &&
      (!event || this.hasForeignPointerOwner(event))
    ) {
      return
    }
    if (this._interaction.isPointerRangeSelecting) {
      if (event) this._handlePointerRangeSelectionMove(event.position)
      return
    }
    const hadEditingHover = this._editing.clearNumberStepperHover
      ? this._editing.clearNumberStepperHover(event)
      : this._editing.clearNumberStepperPointerState()
    const hadHover = hadEditingHover ||
      this._viewport.vScrollbar.hovered ||
      this._viewport.hScrollbar.hovered ||
      this._viewport.hoveredResizeCol >= 0 ||
      this._viewport.hoveredHeaderCol >= 0 ||
      this._viewport.hoveredFilterCol >= 0 ||
      this._interaction.hoveredItemIndex >= 0
    this._vScrollbarController.clearHover()
    this._hScrollbarController.clearHover()
    this._viewport.hoveredResizeCol = -1
    this._viewport.hoveredHeaderCol = -1
    this._viewport.hoveredFilterCol = -1
    this._interaction.endPointerRangeSelection()
    this._interaction.clearPointerState()
    if (this._viewport.resizingCol < 0) this._onSetCursor('default')
    if (hadHover) this._onMarkNeedsPaint()
  }

  dispose(): void {
    this._releasePointerOwner()
    this._vScrollbarController.reset()
    this._hScrollbarController.reset()
    this._rangeAutoScrollDriver.dispose()
    this._onSetCursor('default')
  }

  cancelTransientInteraction(): void {
    this._releasePointerOwner()
    this._viewport.draggingCol = -1
    this._viewport.dropTargetCol = -1
    this._viewport.resizingCol = -1
    this._viewport.resizeCurrentX = 0
    this._viewport.hoveredResizeCol = -1
    this._vScrollbarController.reset()
    this._hScrollbarController.reset()
    this._viewport.hoveredHeaderCol = -1
    this._viewport.hoveredFilterCol = -1
    this._stopRangeAutoScroll()
    this._interaction.endPointerRangeSelection()
    this._interaction.clearPointerState()
    this._editing.stopDrag()
    this._onSetCursor('default')
    this._onMarkNeedsPaint()
  }

  cancelColumnResize(): void {
    if (this._viewport.resizingCol < 0 && this._viewport.hoveredResizeCol < 0) return
    if (this._viewport.resizingCol >= 0) this._releaseCapturedDrag()
    this._viewport.resizingCol = -1
    this._viewport.resizeCurrentX = 0
    this._viewport.hoveredResizeCol = -1
    this._onSetCursor('default')
    this._onMarkNeedsPaint()
  }

  stopRangeAutoScroll(): void {
    this._stopRangeAutoScroll()
  }

  onDoubleClick(position: Offset): void {
    if (!this._hitTest(position)) return
    const globalOffset = this._getGlobalOffset()
    if (this._viewport.inHeader(position, globalOffset)) {
      if (!this._canAutoFitColumns()) return
      const resizeCol = this._viewport.resizeColAt(
        position,
        globalOffset,
        this._getColumns(),
        this._canResizeColumns(),
      )
      if (resizeCol >= 0) {
        if (this._editing.commitEdit() === false) return
        this._onAutoFitColumn(resizeCol)
      }
      return
    }
    const itemIndex = this._viewport.rowAtY(position.y, globalOffset, this._dataModel.visibleItemCount())
    const item = this._dataModel.visibleItemAt(itemIndex)
    if (!item) return
    if (item.kind === 'group') {
      this._onToggleGroup(item.pathKey)
      return
    }
    const colIndex = this._viewport.colAtX(position.x, globalOffset, this._getColumns())
    if (colIndex >= 0) {
      this._interaction.focusCell(item.dataRowIndex, colIndex, { select: true, scroll: true })
      this._interaction.activateItem(itemIndex, colIndex)
      if (this._editing.startEdit(item.dataRowIndex, colIndex)) {
        this._editing.selectWordAt(position.x, position.y)
      }
    }
  }

  onWheel(event: WheelPointerEvent): boolean {
    if (!this._hitTest(event.position)) return false
    const columns = this._getColumns()
    const visibleItemCount = this._dataModel.visibleItemCount()
    const canScrollX = this._viewport.canScrollX(columns)
    const canScrollY = this._viewport.canScrollY(visibleItemCount)
    const beforeX = this._viewport.scrollX
    const beforeY = this._viewport.scrollY
    if (event.deltaX !== 0) {
      this._viewport.setScrollX(columns, this._viewport.scrollX + (event.deltaX > 0 ? 60 : -60))
    }
    if (event.deltaY !== 0) {
      this._viewport.setScrollY(
        visibleItemCount,
        this._viewport.scrollY + (event.deltaY > 0 ? 60 : -60),
      )
    }
    if (this._viewport.scrollX === beforeX && this._viewport.scrollY === beforeY) {
      return (event.deltaX !== 0 && canScrollX) || (event.deltaY !== 0 && canScrollY)
    }
    this._onSyncEditingViewportState()
    this._onMarkNeedsPaint()
    return true
  }

  private _captureDrag(event: PointerEvent): boolean {
    return this._claimPointerOwner(event, 'drag')
  }

  private _claimPointerOwner(
    event: PointerEvent,
    mode: GridPointerOwnerMode,
  ): boolean {
    const key = pointerKey(event)
    if (this._dragPointerKey !== undefined) {
      return this._dragPointerKey === key &&
        this._pointerOwnerMode === mode
    }
    event.stopPropagation?.()
    event.setPointerCapture?.()
    this._dragPointerKey = key
    this._pointerOwnerMode = mode
    this._releasePointerCapture = event.releasePointerCapture
    return true
  }

  private _releaseCapturedDrag(event?: PointerEvent): boolean {
    return this._releasePointerOwner(event, 'drag')
  }

  private _releasePointerOwner(
    event?: PointerEvent,
    expectedMode?: GridPointerOwnerMode,
  ): boolean {
    if (
      event &&
      this.hasForeignPointerOwner(event)
    ) {
      return false
    }
    if (
      expectedMode !== undefined &&
      this._dragPointerKey !== undefined &&
      this._pointerOwnerMode !== expectedMode
    ) {
      return false
    }
    const hadOwner = this._dragPointerKey !== undefined
    const releasePointerCapture = this._releasePointerCapture
    this._dragPointerKey = undefined
    this._pointerOwnerMode = undefined
    this._releasePointerCapture = undefined
    if (hadOwner) {
      let firstError: unknown
      let hasError = false
      try {
        event?.stopPropagation?.()
      } catch (error) {
        firstError = error
        hasError = true
      }
      try {
        releasePointerCapture?.()
      } catch (error) {
        if (!hasError) {
          firstError = error
          hasError = true
        }
      }
      if (hasError) throw firstError
    }
    return hadOwner
  }

  private _hasCapturedDrag(): boolean {
    return this._dragPointerKey !== undefined ||
      this._viewport.draggingCol >= 0 ||
      this._viewport.resizingCol >= 0 ||
      this._viewport.vScrollbar.dragging ||
      this._viewport.hScrollbar.dragging ||
      this._interaction.isPointerRangeSelecting
  }

  private _handlePointerRangeSelectionMove(position: Offset): void {
    this._updateRangeAutoScroll(position)
    this._updatePointerRangeSelectionAt(position)
  }

  private _updatePointerRangeSelectionAt(position: Offset): boolean {
    const columns = this._getColumns()
    const globalOffset = this._getGlobalOffset()
    const clamped = this._clampRangePointerPosition(position, globalOffset)
    return this._interaction.updatePointerRangeSelection(
      this._viewport.rowAtY(clamped.y, globalOffset, this._dataModel.visibleItemCount()),
      this._viewport.colAtX(clamped.x, globalOffset, columns),
    )
  }

  private _updateRangeAutoScroll(position: Offset): void {
    if (!this._canRangeSelectionAutoScroll()) {
      this._stopRangeAutoScroll()
      return
    }
    this._rangeAutoScrollDriver.update(this._rangeAutoScrollInput(position))
  }

  private _tickRangeAutoScroll(
    delta: Readonly<{ x: number; y: number }>,
    position: Readonly<Offset>,
  ): boolean {
    if (
      !this._interaction.isPointerRangeSelecting ||
      !this._canRangeSelectionAutoScroll()
    ) {
      return false
    }

    const columns = this._getColumns()
    const beforeX = this._viewport.scrollX
    const beforeY = this._viewport.scrollY
    if (delta.x !== 0) this._viewport.setScrollX(columns, beforeX + delta.x)
    if (delta.y !== 0) {
      this._viewport.setScrollY(
        this._dataModel.visibleItemCount(),
        beforeY + delta.y,
      )
    }

    const changed = this._viewport.scrollX !== beforeX || this._viewport.scrollY !== beforeY
    this._updatePointerRangeSelectionAt(position)
    this._onInteractionStateChange()
    if (!changed) return false
    this._onSyncEditingViewportState()
    this._onMarkNeedsPaint()
    return true
  }

  private _rangeAutoScrollInput(position: Readonly<Offset>): EdgeAutoScrollInput {
    const globalOffset = this._getGlobalOffset()
    const bodyTop = globalOffset.y + this._viewport.headerSectionHeight
    const bodyBottom = bodyTop + this._viewport.viewHeight
    const bodyLeft = globalOffset.x
    const bodyRight = globalOffset.x + this._viewport.viewWidth
    const edge = Math.max(
      GridPointerController.RANGE_AUTO_SCROLL_EDGE,
      Math.min(48, this._viewport.rowHeight),
    )
    return {
      position: { ...position },
      bounds: {
        left: bodyLeft,
        top: bodyTop,
        right: bodyRight,
        bottom: bodyBottom,
      },
      edgeSizeX: edge,
      edgeSizeY: edge,
      maxStepX: GridPointerController.RANGE_AUTO_SCROLL_MAX_X_STEP,
      maxStepY: Math.max(8, this._viewport.rowHeight),
      minStep: 4,
    }
  }

  private _clampRangePointerPosition(position: Offset, globalOffset: Offset): Offset {
    const bodyTop = globalOffset.y + this._viewport.headerSectionHeight
    const bodyBottom = bodyTop + this._viewport.viewHeight
    const bodyLeft = globalOffset.x
    const bodyRight = globalOffset.x + this._viewport.viewWidth
    return {
      x: Math.max(bodyLeft, Math.min(bodyRight - 1, position.x)),
      y: Math.max(bodyTop, Math.min(bodyBottom - 1, position.y)),
    }
  }

  private _stopRangeAutoScroll(): void {
    this._rangeAutoScrollDriver.stop()
  }
}
