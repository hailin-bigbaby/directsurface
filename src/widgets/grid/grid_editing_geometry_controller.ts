import {
  deriveGridCellStyle,
  type ResolvedGridCellStyleTokens,
} from '../../theme/component_styles'
import type { ResolvedTheme } from '../../theme/theme'
import { isGridPopupEditor } from './grid_column_editor'
import {
  resolveGridCellPresentation,
  resolveGridRowPresentation,
} from './grid_display_resolver'
import type { GridDataModel } from './grid_data_model'
import type { GridEditingController } from './grid_editing_controller'
import type { GridInteractionController } from './grid_interaction_controller'
import type {
  GridCellStyleArgs,
  GridCellStyleOverride,
  GridColumnDef,
  GridRowStyleArgs,
  GridRowStyleOverride,
} from './grid_types'
import type { GridViewport } from './grid_viewport'

export interface GridEditingGeometryControllerOptions<T extends Record<string, any>> {
  dataModel: GridDataModel<T>
  viewport: GridViewport<T>
  editing: GridEditingController<T>
  interaction: GridInteractionController<T>
  getColumns: () => GridColumnDef<T>[]
  getGlobalOffset: () => { x: number; y: number }
  getCurrentTheme: () => ResolvedTheme
  getSelectedRows: () => Set<number>
  getResolveRowStyle: () => ((args: GridRowStyleArgs<T>) => GridRowStyleOverride | null | undefined) | undefined
  getResolveCellStyle: () => ((args: GridCellStyleArgs<T>) => GridCellStyleOverride | null | undefined) | undefined
}

export class GridEditingGeometryController<T extends Record<string, any> = any> {
  private readonly _dataModel: GridDataModel<T>
  private readonly _viewport: GridViewport<T>
  private readonly _editing: GridEditingController<T>
  private readonly _interaction: GridInteractionController<T>
  private readonly _getColumns: GridEditingGeometryControllerOptions<T>['getColumns']
  private readonly _getGlobalOffset: GridEditingGeometryControllerOptions<T>['getGlobalOffset']
  private readonly _getCurrentTheme: GridEditingGeometryControllerOptions<T>['getCurrentTheme']
  private readonly _getSelectedRows: GridEditingGeometryControllerOptions<T>['getSelectedRows']
  private readonly _getResolveRowStyle: GridEditingGeometryControllerOptions<T>['getResolveRowStyle']
  private readonly _getResolveCellStyle: GridEditingGeometryControllerOptions<T>['getResolveCellStyle']

  constructor(options: GridEditingGeometryControllerOptions<T>) {
    this._dataModel = options.dataModel
    this._viewport = options.viewport
    this._editing = options.editing
    this._interaction = options.interaction
    this._getColumns = options.getColumns
    this._getGlobalOffset = options.getGlobalOffset
    this._getCurrentTheme = options.getCurrentTheme
    this._getSelectedRows = options.getSelectedRows
    this._getResolveRowStyle = options.getResolveRowStyle
    this._getResolveCellStyle = options.getResolveCellStyle
  }

  editTextMetrics(rowIndex: number, colIndex: number): {
    paddingH: number
    fontSize: number
    fontFamily: string
    numberStepperWidth: number
    align: 'left' | 'center' | 'right'
  } {
    const tokens = this._gridTokens()
    const itemIndex = this._dataModel.visibleItemIndexForVisibleRow(rowIndex)
    const item = this._dataModel.visibleItemAt(itemIndex)
    const columns = this._getColumns()
    const column = columns[colIndex]
    if (!item || item.kind !== 'data' || !column) {
      return {
        paddingH: tokens.paddingH,
        fontSize: tokens.fontSize,
        fontFamily: tokens.fontFamily,
        numberStepperWidth: tokens.numberStepper.width,
        align: column?.align ?? 'left',
      }
    }

    const selectedRows = this._getSelectedRows()
    const resolveRowStyle = this._getResolveRowStyle()
    const resolveCellStyle = this._getResolveCellStyle()
    const rowPresentation = resolveGridRowPresentation({
      item,
      theme: this._getCurrentTheme(),
      tokens,
      state: {
        itemIndex,
        selected: selectedRows.has(rowIndex),
        hovered: this._interaction.hoveredItemIndex === itemIndex,
        focused: this._interaction.focusedItemIndex === itemIndex,
        editing: true,
      },
      resolveRowStyle,
    })
    const cellPresentation = resolveGridCellPresentation({
      item,
      theme: this._getCurrentTheme(),
      column,
      colIndex,
      tokens,
      rowPresentation,
      state: {
        itemIndex,
        selected: selectedRows.has(rowIndex),
        hovered: this._interaction.hoveredItemIndex === itemIndex,
        focused: this._interaction.focusedItemIndex === itemIndex,
        editing: true,
      },
      resolveCellStyle,
      lookupValues: this._dataModel.lookupValues,
    })
    return {
      paddingH: tokens.paddingH,
      fontSize: cellPresentation.fontSize,
      fontFamily: cellPresentation.fontFamily,
      numberStepperWidth: tokens.numberStepper.width,
      align: cellPresentation.align,
    }
  }

  cellGlobalRect(rowIndex: number, colIndex: number): { x: number; y: number; w: number; h: number } {
    const itemIndex = this._dataModel.visibleItemIndexForVisibleRow(rowIndex)
    return this._viewport.cellGlobalRect(this._getColumns(), this._getGlobalOffset(), itemIndex, colIndex)
  }

  cellVisibleGlobalRect(rowIndex: number, colIndex: number): { x: number; y: number; w: number; h: number } {
    const rect = this.cellGlobalRect(rowIndex, colIndex)
    const visibleRect = this._viewport.visibleCellRect(
      this._getColumns(),
      this._getGlobalOffset().x,
      colIndex,
    )
    return { ...rect, x: visibleRect.x, w: visibleRect.w }
  }

  syncEditingViewportState(): void {
    const edit = this._editing.state
    if (!edit) return
    this._editing.cancelNumberStepperPress(true)
    if (this._isPopupEditColumn(edit.col) && !this._isEditCellVisible(edit.row, edit.col)) {
      this._editing.endEdit()
      return
    }
    this._editing.refreshOverlayPosition()
  }

  private _isPopupEditColumn(colIndex: number): boolean {
    const column = this._getColumns()[colIndex]
    return !!column && isGridPopupEditor(column)
  }

  private _isEditCellVisible(rowIndex: number, colIndex: number): boolean {
    const columns = this._getColumns()
    if (rowIndex < 0 || rowIndex >= this._dataModel.visibleRowCount()) return false
    if (colIndex < 0 || colIndex >= columns.length) return false
    const rect = this.cellGlobalRect(rowIndex, colIndex)
    if (rect.w <= 0 || rect.h <= 0) return false
    const globalOffset = this._getGlobalOffset()
    const bodyX = globalOffset.x
    const bodyY = globalOffset.y + this._viewport.headerSectionHeight
    const bodyRight = bodyX + this._viewport.viewWidth
    const bodyBottom = bodyY + this._viewport.viewHeight
    return (
      rect.x < bodyRight &&
      rect.x + rect.w > bodyX &&
      rect.y < bodyBottom &&
      rect.y + rect.h > bodyY
    )
  }

  private _gridTokens(theme: ResolvedTheme = this._getCurrentTheme()): ResolvedGridCellStyleTokens {
    return deriveGridCellStyle(theme)
  }
}
