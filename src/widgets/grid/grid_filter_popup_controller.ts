import { PopupManager } from '../../core/popup_manager'
import type { GridFilterPopupDebugState, GridFilterRule } from './grid_types'
import {
  GridFilterPopup,
  resolveGridFilterPopupMinimumHeight,
  resolveGridFilterPopupPreferredHeight,
} from './popup/grid_filter_popup'
import type { GridDataModel } from './grid_data_model'
import type { GridColumnDef } from './grid_types'
import type { GridViewport } from './grid_viewport'
import { deriveGridFilterPopupStyle } from '../../theme/component_styles'

export interface GridFilterPopupControllerOptions<T extends Record<string, any>> {
  owner: object
  dataModel: GridDataModel<T>
  viewport: GridViewport<T>
  getGlobalOffset: () => { x: number; y: number }
  getColumns: () => Array<GridColumnDef<T>>
  onMarkNeedsPaint: () => void
}

export class GridFilterPopupController<T extends Record<string, any> = any> {
  private readonly _owner: GridFilterPopupControllerOptions<T>['owner']
  private readonly _dataModel: GridDataModel<T>
  private readonly _viewport: GridViewport<T>
  private readonly _getGlobalOffset: GridFilterPopupControllerOptions<T>['getGlobalOffset']
  private readonly _getColumns: GridFilterPopupControllerOptions<T>['getColumns']
  private readonly _onMarkNeedsPaint: GridFilterPopupControllerOptions<T>['onMarkNeedsPaint']

  private _filterPopupCol = -1
  private _filterPopup: GridFilterPopup | null = null

  constructor(options: GridFilterPopupControllerOptions<T>) {
    this._owner = options.owner
    this._dataModel = options.dataModel
    this._viewport = options.viewport
    this._getGlobalOffset = options.getGlobalOffset
    this._getColumns = options.getColumns
    this._onMarkNeedsPaint = options.onMarkNeedsPaint
  }

  get filterPopupColumn(): number { return this._filterPopupCol }

  debugState(): GridFilterPopupDebugState {
    const column = this._getColumns()[this._filterPopupCol]
    const rule = column ? this.currentRuleForColumn(column.key) : null
    return {
      visible: this._filterPopupCol >= 0,
      column: this._filterPopupCol,
      columnKey: column?.key,
      mode: this._filterPopup?.mode,
      operator: rule?.operator ?? this._filterPopup?.operator,
      value: rule?.value ?? this._filterPopup?.valueText,
      valueTo: rule?.valueTo,
      values: rule?.values ? [...rule.values] : undefined,
    }
  }

  openFilterPopup(colIndex: number, initialMode?: 'values' | 'condition'): void {
    const column = this._getColumns()[colIndex]
    if (!column?.filterable) return
    this.closeFilterPopup()
    this._filterPopupCol = colIndex
    const currentValue = this._dataModel.getFilterValue(column.key)
    const currentRule = this.currentRuleForColumn(column.key)
    const distinctValues = this._dataModel.distinctFilterValues(column.key)
    this._filterPopup = new GridFilterPopup({
      owner: this._owner,
      column,
      getLayout: popupContext => {
        if (this._filterPopupCol < 0) return { x: 0, y: 0, w: 0, h: 0 }
        const popupStyle = deriveGridFilterPopupStyle(popupContext.theme)
        const mode = this._filterPopup?.mode ?? initialMode ?? 'values'
        const preferredHeight = resolveGridFilterPopupPreferredHeight(
          popupStyle,
          mode,
          distinctValues.values.length,
        )
        const minimumHeight = resolveGridFilterPopupMinimumHeight(popupStyle, mode)
        return this._viewport.filterPopupLayout(
          this._getColumns(),
          this._getGlobalOffset(),
          this._filterPopupCol,
          popupContext.viewport,
          popupStyle,
          preferredHeight,
          minimumHeight,
        )
      },
      initialRule: currentRule,
      initialValue: currentValue,
      initialMode,
      values: distinctValues.values,
      valuesTruncated: distinctValues.truncated,
      onApply: rule => {
        this.applyRule(column.key, rule)
      },
      onInvalidate: () => {
        this._onMarkNeedsPaint()
        PopupManager.instance.requestPaint()
      },
      onRequestPaint: () => { PopupManager.instance.requestPaint() },
      onClose: () => {
        this._handleFilterPopupClosed()
      },
    })
    this._filterPopup.open()
  }

  closeFilterPopup(): void {
    if (this._filterPopupCol < 0 && !this._filterPopup) return
    const popup = this._filterPopup
    if (!popup) {
      this._handleFilterPopupClosed()
      return
    }
    popup.dismiss()
  }

  dispose(): void {
    this._filterPopup?.dispose()
    this._filterPopup = null
    this._filterPopupCol = -1
  }

  private _handleFilterPopupClosed(): void {
    this._filterPopup = null
    this._filterPopupCol = -1
    this._onMarkNeedsPaint()
    PopupManager.instance.requestPaint()
  }

  private currentRuleForColumn(key: string): GridFilterRule | null {
    return this._dataModel.filters.find(filter => filter.key === key) ?? null
  }

  private applyRule(key: string, rule: GridFilterRule | null): void {
    const next = this._dataModel.filters.filter(filter => filter.key !== key)
    if (rule) next.push(rule)
    this._dataModel.setFilterValue(key, '')
    this._dataModel.filters = next
  }
}
