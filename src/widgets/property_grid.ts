import { FocusManager, type Focusable } from '../core/focus_manager'
import { RenderBox } from '../layout/render_box'
import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset, type PipelineOwner, type Rect } from '../core/render_object'
import type { PaintContext } from '../rendering/paint_context'
import { DrawList } from '../rendering/draw_list'
import { TextMeasurer } from '../core/text_measurer'
import { ellipsizeText } from '../core/text_overflow'
import type { Color } from '../theme/theme'
import { GET_POPUP_ANCHOR_RECT } from '../core/popup_anchor'
import type { InteractiveRenderObject, PointerEvent, WheelPointerEvent } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { pointerKey } from '../gestures/pointer_identity'
import { ScrollbarAxisController } from '../gestures/scrollbar_interaction_controller'
import { hitTestScrollbarGeometry, paintVBar, resolveScrollbarGeometryForState, type ScrollbarGeometry } from '../rendering/scrollbar'
import { deriveGridCellStyle, deriveScrollbarStyle } from '../theme/component_styles'
import { ScrollController } from '../virtualization/scroll_controller'
import { paintIconGlyph, type IconName } from './icon'
import {
  PropertyGridInlineEditingController,
} from './property_grid_editing_controller'
import {
  PropertyGridPopupEditors,
} from './property_grid_popup_editors'

const PROPERTY_GRID_FONT_SIZE = 12
const PROPERTY_GRID_FONT_FAMILY = 'Arial, "Microsoft YaHei", sans-serif'
const PROPERTY_GRID_MIN_NAME_COLUMN_WIDTH = 72
const PROPERTY_GRID_MIN_VALUE_COLUMN_WIDTH = 72
const PROPERTY_GRID_COLUMN_DIVIDER_HIT_WIDTH = 8
const PROPERTY_GRID_DESCRIPTION_PADDING = 8
const PROPERTY_GRID_DESCRIPTION_GAP = 4
const PROPERTY_GRID_DESCRIPTION_DIVIDER_HEIGHT = 6
const PROPERTY_GRID_DESCRIPTION_DIVIDER_HIT_HEIGHT = 8
const PROPERTY_GRID_MIN_ROWS_VIEW_HEIGHT = 72

export interface PropertyGridRow {
  readonly id?: string
  readonly group: string
  readonly name: string
  readonly propPath?: string
  readonly label?: string
  readonly value: string
  readonly kind?: PropertyGridEditorKind
  readonly editor?: PropertyGridEditorKind
  readonly editable?: boolean
  readonly description?: string
  readonly status?: 'default' | 'warning' | 'error'
  readonly errorText?: string
  readonly enumItems?: readonly PropertyGridEnumItem[]
  readonly unit?: string
  readonly step?: number
  readonly min?: number
  readonly max?: number
  readonly decimals?: number
  readonly clearable?: boolean
}

export interface PropertyGridEnumItem {
  readonly label: string
  readonly value: unknown
}

export type PropertyGridEditorKind = 'text' | 'number' | 'boolean' | 'enum' | 'color' | 'date' | 'json' | 'expression' | 'image-source' | 'options' | 'text-style' | (string & {})
export interface PropertyGridRowAnchor {
  readonly id?: string
  readonly group: string
  readonly name: string
  readonly cell?: 'row' | 'value'
}

export interface PropertyGridRowHit {
  readonly row: PropertyGridRow
  readonly rect: Rect
}

export type PropertyGridValueCommitRequest = (row: PropertyGridRow, nextValue: unknown) => boolean | void
export interface PropertyGridValueCommitOptions {
  readonly onCommit?: PropertyGridValueCommitRequest
  readonly displayValue?: unknown
}

export interface PropertyGridEditContext {
  readonly grid: RenderPropertyGrid
  readonly row: PropertyGridRow
  readonly editor: PropertyGridEditorKind | undefined
  commit: (nextValue: unknown, options?: PropertyGridValueCommitOptions) => boolean
  updateDisplayValue: (value: unknown) => boolean
  setError: (message: string) => void
}

export type PropertyGridEditorResult = boolean | void
export type PropertyGridEditorHandler = (context: PropertyGridEditContext) => PropertyGridEditorResult
export type PropertyGridEditRequest = (row: PropertyGridRow, context: PropertyGridEditContext) => PropertyGridEditorResult
export type PropertyGridSelectionChangeRequest = (row: PropertyGridRow | undefined) => void
export type PropertyGridEditErrorRequest = (row: PropertyGridRow, message: string) => void
export interface PropertyGridEditingState {
  readonly rowId?: string
  readonly group: string
  readonly name: string
  readonly editor: PropertyGridEditorKind
  readonly mode: 'inline' | 'popup'
  readonly draftValue?: string
  readonly errorText?: string
  readonly suspended?: boolean
}

export interface RenderPropertyGridOptions {
  rows?: readonly PropertyGridRow[]
  emptyText?: string
  rowHeight?: number
  groupHeight?: number
  nameColumnWidth?: number
  showDescriptionPanel?: boolean
  descriptionEmptyText?: string
  selectedRowId?: string
  onSelectedRowChange?: PropertyGridSelectionChangeRequest
  onEditRequested?: PropertyGridEditRequest
  onValueCommit?: PropertyGridValueCommitRequest
  onEditError?: PropertyGridEditErrorRequest
  editorHandlers?: Readonly<Record<string, PropertyGridEditorHandler | undefined>>
}

interface PaintRow {
  readonly type: 'group' | 'property'
  readonly group: string
  readonly key?: string
  readonly name?: string
  readonly value?: string
  readonly row?: PropertyGridRow
}

interface PropertyGridDescriptionLayout {
  readonly titleLines: string[]
  readonly descriptionLines: string[]
  readonly errorLines: string[]
  readonly lineHeight: number
  readonly contentHeight: number
}

export class RenderPropertyGrid extends RenderBox implements InteractiveRenderObject, Focusable {
  static override debugTypeName = 'RenderPropertyGrid'

  tooltip = ''
  tooltipDelay = 350

  private _rows: PropertyGridRow[]
  private _paintRows: PaintRow[] = []
  private _emptyText: string
  private _rowHeight: number
  private _groupHeight: number
  private _nameColumnWidth: number
  private _showDescriptionPanel: boolean
  private _descriptionEmptyText: string
  private _onEditRequested?: PropertyGridEditRequest
  private _onValueCommit?: PropertyGridValueCommitRequest
  private _onSelectedRowChange?: PropertyGridSelectionChangeRequest
  private _onEditError?: PropertyGridEditErrorRequest
  private _editorHandlers: Readonly<Record<string, PropertyGridEditorHandler | undefined>>
  private readonly _inlineEditing: PropertyGridInlineEditingController
  private readonly _popupEditors: PropertyGridPopupEditors
  private _hoveredIndex = -1
  private _selectedRowId?: string
  private _focused = false
  private readonly _scrollY = new ScrollController({ axis: 'y' })
  private readonly _vScrollbarController = new ScrollbarAxisController('vertical')
  private readonly _vScrollbar = this._vScrollbarController.state
  private _contentHeight = 0
  private _columnDividerHovered = false
  private _columnDividerDragging = false
  private _columnResizeStartPointerX = 0
  private _columnResizeStartWidth = 0
  private readonly _descriptionScrollY = new ScrollController({ axis: 'y' })
  private readonly _descriptionVScrollbarController = new ScrollbarAxisController('vertical')
  private readonly _descriptionVScrollbar = this._descriptionVScrollbarController.state
  private _descriptionPanelHeight = 0
  private _descriptionContentHeight = 0
  private _descriptionHeightOverride?: number
  private _descriptionDividerHovered = false
  private _descriptionDividerDragging = false
  private _descriptionResizeStartPointerY = 0
  private _descriptionResizeStartHeight = 0

  constructor(options: RenderPropertyGridOptions = {}) {
    super()
    this._rows = [...(options.rows ?? [])]
    this._emptyText = options.emptyText ?? '未选择节点'
    this._rowHeight = options.rowHeight ?? 26
    this._groupHeight = options.groupHeight ?? 24
    this._nameColumnWidth = options.nameColumnWidth ?? 112
    this._showDescriptionPanel = options.showDescriptionPanel ?? false
    this._descriptionEmptyText = options.descriptionEmptyText ?? '选择属性查看说明'
    this._selectedRowId = options.selectedRowId
    this._onSelectedRowChange = options.onSelectedRowChange
    this._onEditRequested = options.onEditRequested
    this._onValueCommit = options.onValueCommit
    this._onEditError = options.onEditError
    this._editorHandlers = options.editorHandlers ?? {}
    this._rebuildPaintRows()
    this._inlineEditing = new PropertyGridInlineEditingController({
      owner: this,
      getRowByKey: key => this._rowByKey(key),
      getValueRect: key => this._rowRectByKey(key, 'value'),
      getTextMetrics: () => ({
        fontSize: PROPERTY_GRID_FONT_SIZE,
        fontFamily: PROPERTY_GRID_FONT_FAMILY,
        paddingH: 8,
      }),
      getNumberStepperWidth: () => deriveGridCellStyle(this.currentTheme).numberStepper.width,
      measureText: (text, fontSize, fontFamily) => TextMeasurer.measureWidth(text, fontSize, fontFamily),
      commitValue: (row, nextValue, displayValue) => this._commitRowValue(row, nextValue, { displayValue }),
      reportError: (row, message) => this._onEditError?.(row, message),
      moveByTab: (rowKey, direction) => this._moveEditSelectionFrom(rowKey, direction),
      markNeedsPaint: () => this.markNeedsPaint(),
    })
    this._popupEditors = new PropertyGridPopupEditors({
      owner: this,
      getRowByKey: key => this._rowByKey(key),
      getValueRect: key => this._rowRectByKey(key, 'value'),
      isValueRectVisible: rect => this._isValueRectVisible(rect),
      commitValue: (row, nextValue, displayValue) => this._commitRowValue(row, nextValue, { displayValue }),
      moveByTab: (rowKey, direction) => this._moveEditSelectionFrom(rowKey, direction),
      markNeedsPaint: () => this.markNeedsPaint(),
    })
  }

  get rows(): readonly PropertyGridRow[] { return this._rows }
  set rows(rows: readonly PropertyGridRow[]) {
    this._rows = [...rows]
    this.tooltip = ''
    this._rebuildPaintRows()
    this._inlineEditing.syncRows()
    this._popupEditors.syncRows()
    if (this._selectedRowId && !this._rowByKey(this._selectedRowId)) this._selectedRowId = undefined
    this._resetDescriptionScroll()
    this.markNeedsLayout()
  }

  get emptyText(): string { return this._emptyText }
  set emptyText(value: string) {
    if (this._emptyText === value) return
    this._emptyText = value
    this.markNeedsPaint()
  }

  get nameColumnWidth(): number { return this._nameColumnWidth }
  set nameColumnWidth(value: number) {
    const next = Number.isFinite(value) ? Math.max(0, value) : 0
    if (this._nameColumnWidth === next) return
    this._nameColumnWidth = next
    this._inlineEditing.refreshGeometry()
    this._popupEditors.syncGeometry()
    this.markNeedsPaint()
  }

  get showDescriptionPanel(): boolean { return this._showDescriptionPanel }
  set showDescriptionPanel(value: boolean) {
    if (this._showDescriptionPanel === value) return
    this._showDescriptionPanel = value
    this._resetDescriptionScroll()
    this.markNeedsLayout()
  }

  get descriptionEmptyText(): string { return this._descriptionEmptyText }
  set descriptionEmptyText(value: string) {
    if (this._descriptionEmptyText === value) return
    this._descriptionEmptyText = value
    this.markNeedsLayout()
  }

  get descriptionPanelHeight(): number { return this._descriptionPanelHeight }
  get descriptionContentHeight(): number { return this._descriptionContentHeight }
  get descriptionScrollY(): number { return this._descriptionScrollY.offset }
  get maxDescriptionScrollY(): number {
    return Math.max(0, this._descriptionContentHeight - this._descriptionPanelHeight)
  }

  resetDescriptionPanelHeight(): void {
    if (this._descriptionHeightOverride === undefined) return
    this._descriptionHeightOverride = undefined
    this.markNeedsLayout()
  }

  get onEditRequested(): PropertyGridEditRequest | undefined { return this._onEditRequested }
  set onEditRequested(value: PropertyGridEditRequest | undefined) { this._onEditRequested = value }

  get onValueCommit(): PropertyGridValueCommitRequest | undefined { return this._onValueCommit }
  set onValueCommit(value: PropertyGridValueCommitRequest | undefined) { this._onValueCommit = value }

  get onEditError(): PropertyGridEditErrorRequest | undefined { return this._onEditError }
  set onEditError(value: PropertyGridEditErrorRequest | undefined) { this._onEditError = value }

  get editorHandlers(): Readonly<Record<string, PropertyGridEditorHandler | undefined>> { return this._editorHandlers }
  set editorHandlers(value: Readonly<Record<string, PropertyGridEditorHandler | undefined>>) { this._editorHandlers = value }

  get onSelectedRowChange(): PropertyGridSelectionChangeRequest | undefined { return this._onSelectedRowChange }
  set onSelectedRowChange(value: PropertyGridSelectionChangeRequest | undefined) { this._onSelectedRowChange = value }

  get selectedRowId(): string | undefined { return this._selectedRowId }
  set selectedRowId(value: string | undefined) {
    const next = value && this._rowByKey(value) ? value : undefined
    if (this._selectedRowId === next) return
    this._selectedRowId = next
    this._resetDescriptionScroll()
    this.markNeedsLayout()
  }

  get selectedRow(): PropertyGridRow | undefined {
    return this._selectedRowId ? this._rowByKey(this._selectedRowId) : undefined
  }

  get isEditing(): boolean { return this._inlineEditing.isEditing || this._popupEditors.isEditing }
  get editingState(): PropertyGridEditingState | undefined {
    return this._inlineEditing.snapshot() ?? this._popupEditors.snapshot()
  }

  get scrollY(): number { return this._scrollY.offset }
  set scrollY(value: number) {
    const before = this._scrollY.offset
    this._scrollY.setOffset(value, { viewportSize: this._viewHeight, contentSize: this._contentHeight })
    if (this._scrollY.offset === before) return
    this._inlineEditing.refreshGeometry()
    this._popupEditors.syncGeometry()
    this.markNeedsPaint()
  }

  get contentHeight(): number { return this._contentHeight }

  get maxScrollY(): number {
    return Math.max(0, this._contentHeight - this._viewHeight)
  }

  get isFocused(): boolean { return this._focused }

  focusIn(): void {
    if (this._focused) return
    this._focused = true
    this._inlineEditing.resume()
    this.markNeedsPaint()
  }

  focusOut(): void {
    if (!this._focused) return
    if (this._inlineEditing.isEditing && !this._inlineEditing.commitEdit({ restoreFocus: false })) {
      this._inlineEditing.suspendAfterRejectedFocusOut()
    }
    this._focused = false
    this.markNeedsPaint()
  }

  shouldIgnoreKeyDown(_event: KeyboardEvent): boolean {
    return this._inlineEditing.isComposing
  }

  override attach(owner: PipelineOwner): void {
    super.attach(owner)
    if (typeof window !== 'undefined') FocusManager.instance.register(this)
  }

  override dispose(): void {
    this.tooltip = ''
    this._inlineEditing.dispose()
    this._popupEditors.dispose()
    this._vScrollbarController.reset()
    this._descriptionVScrollbarController.reset()
    if (typeof window !== 'undefined') FocusManager.instance.unregister(this)
    super.dispose()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  requestEdit(group: string, name: string): boolean {
    const row = this._rows.find(item => item.group === group && item.name === name)
    if (!row?.editable) return false
    return this._requestEdit(row, { selectAll: true })
  }

  commitEdit(): boolean {
    if (this._popupEditors.isEditing) return false
    return this._inlineEditing.commitEdit()
  }

  cancelEdit(): boolean {
    return this._inlineEditing.cancelEdit() || this._popupEditors.cancelEdit()
  }

  activateValue(group: string, name: string): boolean {
    const row = this._rows.find(item => item.group === group && item.name === name)
    return row ? this._activateInteractiveRow(row) : false
  }

  rowRect(group: string, name: string, cell: 'row' | 'value' = 'row'): Rect | undefined {
    return this._rowRect(group, name, cell)
  }

  rowRectById(id: string, cell: 'row' | 'value' = 'row'): Rect | undefined {
    return this._rowRectByKey(id, cell)
  }

  rowAtPosition(position: Offset): PropertyGridRowHit | undefined {
    const contentWidth = this._contentWidth()
    if (position.x < this.globalOffset.x || position.x > this.globalOffset.x + contentWidth) return undefined
    if (position.y < this.globalOffset.y || position.y > this.globalOffset.y + this._viewHeight) return undefined
    const index = this._paintRowIndexAt(position.y)
    const row = index >= 0 ? this._paintRows[index]?.row : undefined
    if (!row) return undefined
    const rect = this._rowRectAtIndex(index, 'row')
    return rect && pointInRect(position, rect) ? { row, rect } : undefined
  }

  updateValue(group: string, name: string, value: unknown): boolean {
    const index = this._rows.findIndex(item => item.group === group && item.name === name)
    if (index < 0) return false
    return this._updateRowValue(this._rows[index]!, value)
  }

  commitValue(
    group: string,
    name: string,
    nextValue: unknown,
    options: { onCommit?: PropertyGridValueCommitRequest; displayValue?: unknown } = {},
  ): boolean {
    const row = this._rows.find(item => item.group === group && item.name === name)
    if (!row?.editable) return false
    return this._commitRowValue(row, nextValue, options)
  }

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    const naturalHeight = this._paintRows.reduce((height, row) => {
      return height + (row.type === 'group' ? this._groupHeight : this._rowHeight)
    }, this._rows.length ? 0 : this._rowHeight)
    this._contentHeight = naturalHeight
    const width = constraints.maxWidth === Infinity ? 320 : constraints.maxWidth
    const desiredDescriptionHeight = this._showDescriptionPanel
      ? this._measureDescriptionContentHeight(Math.max(0, width - PROPERTY_GRID_DESCRIPTION_PADDING * 2))
      : 0
    const descriptionReservation = this._showDescriptionPanel
      ? PROPERTY_GRID_DESCRIPTION_DIVIDER_HEIGHT + (this._descriptionHeightOverride ?? desiredDescriptionHeight)
      : 0
    this.size = constrainSize(constraints, {
      width,
      height: naturalHeight + descriptionReservation,
    })
    this._resolveDescriptionLayout(desiredDescriptionHeight)
    this._clampScroll()
    if (this._selectedRowId) this._scrollRowIntoView(this._selectedRowId)
    this._inlineEditing.refreshGeometry()
    this._popupEditors.syncGeometry()
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const theme = context.theme
    const fontSize = PROPERTY_GRID_FONT_SIZE
    const fontFamily = PROPERTY_GRID_FONT_FAMILY
    dl.fillRect(offset.x, offset.y, this.size.width, this.size.height, theme.surfacePanel)
    dl.strokeRect(offset.x, offset.y, this.size.width, this.size.height, theme.borderPanel, 1)
    const scrollbarStyle = deriveScrollbarStyle(theme)
    const contentWidth = this._contentWidth(scrollbarStyle)

    if (this._paintRows.length === 0) {
      dl.fillText(
        fitText(this._emptyText, Math.max(0, contentWidth - 16), fontSize, fontFamily),
        offset.x + 8,
        offset.y + Math.min(this._rowHeight, this._viewHeight) / 2,
        theme.textSecondary,
        fontSize,
        fontFamily,
      )
    } else {
      dl.pushClip(offset.x, offset.y, contentWidth, this._viewHeight)
      let y = offset.y - this.scrollY
      for (let rowIndex = 0; rowIndex < this._paintRows.length; rowIndex += 1) {
        const row = this._paintRows[rowIndex]!
        const h = row.type === 'group' ? this._groupHeight : this._rowHeight
        if (y > offset.y + this._viewHeight) break
        if (y + h < offset.y) {
          y += h
          continue
        }
        if (row.type === 'group') {
          dl.fillRect(offset.x, y, contentWidth, h, theme.surfaceDataHeader)
          dl.fillText(row.group, offset.x + 8, y + h / 2, theme.textAccent, fontSize, fontFamily, 'left', 'middle', 600)
        } else {
          const rowKey = row.key
          if (rowKey && rowKey === this._selectedRowId) {
            dl.fillRect(offset.x, y, contentWidth, h, this._focused ? theme.selectionMuted : theme.surfaceControlHover)
          }
          if (rowIndex === this._hoveredIndex) {
            dl.fillRect(offset.x, y, contentWidth, h, theme.surfaceControlHover)
          }
          dl.strokeRect(offset.x, y, contentWidth, h, theme.borderSubtle, 1)
          const nameWidth = this._resolvedNameColumnWidth(contentWidth)
          dl.fillRect(offset.x, y, nameWidth, h, theme.surfaceControl)
          dl.fillText(
            fitText(row.row?.label ?? row.name ?? '', Math.max(0, nameWidth - 12), fontSize, fontFamily),
            offset.x + 8,
            y + h / 2,
            theme.textSecondary,
            fontSize,
            fontFamily,
          )
          const editingError = (this._inlineEditing.isEditingRow(row.row) && !!this._inlineEditing.state?.errorText) ||
            (this._popupEditors.isEditingRow(row.row) && !!this._popupEditors.state?.errorText)
          if (row.row?.status === 'error' || editingError) {
            dl.strokeRect(offset.x + 1, y + 1, contentWidth - 2, h - 2, theme.accentDanger, 1, 2)
          } else if (row.row?.status === 'warning') {
            dl.strokeRect(offset.x + 1, y + 1, contentWidth - 2, h - 2, theme.accentWarning, 1, 2)
          } else if (rowKey && rowKey === this._selectedRowId) {
            dl.strokeRect(offset.x + 1, y + 1, contentWidth - 2, h - 2, this._focused ? theme.accentPrimary : theme.borderControl, 1, 2)
          }
          const valueX = offset.x + nameWidth + 8
          const valueWidth = Math.max(0, contentWidth - nameWidth - 16)
          this._paintValueCell(context, dl, row.row, row.value ?? '', valueX, y, valueWidth, h, fontSize, fontFamily)
          if (row.row?.editable && !this._inlineEditing.isEditingRow(row.row) && !this._popupEditors.isEditingRow(row.row)) {
            const iconSize = Math.min(fontSize, h - 8)
            paintIconGlyph(context, {
              name: editIndicatorIcon(row.row),
              x: offset.x + contentWidth - 14 - iconSize / 2,
              y: y + (h - iconSize) / 2,
              size: iconSize,
              color: theme.textSecondary,
            })
          }
        }
        y += h
      }
      const dividerX = offset.x + this._resolvedNameColumnWidth(contentWidth)
      const dividerColor = this._columnDividerDragging
        ? theme.accentPrimary
        : this._columnDividerHovered
          ? theme.borderControlHover
          : theme.borderSubtle
      dl.line(
        dividerX,
        offset.y,
        dividerX,
        offset.y + this._viewHeight,
        dividerColor,
        this._columnDividerDragging ? 2 : 1,
      )
      dl.popClip()
    }
    if (this._showVBar) {
      paintVBar({
        dl,
        style: scrollbarStyle,
        trackX: offset.x + contentWidth,
        trackY: offset.y,
        trackW: scrollbarStyle.gutterSize,
        trackH: this._viewHeight,
        viewSize: this._viewHeight,
        contentSize: this._contentHeight,
        scrollOffset: this.scrollY,
        state: this._vScrollbar,
      })
    }
    if (this._showDescriptionPanel) this._paintDescriptionPanel(dl, theme, offset, scrollbarStyle)
    this._inlineEditing.refreshGeometry()
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (!this.hitTest(event.position)) return
    if (typeof window !== 'undefined') FocusManager.instance.setFocus(this)
    this.tooltip = ''
    const key = pointerKey(event)
    const descriptionScrollbarResult = this._descriptionVScrollbarController.beginPointer(
      event.position,
      this._descriptionScrollbarGeometry(),
      key,
    )
    if (descriptionScrollbarResult.handled) {
      this._descriptionDividerHovered = false
      event.stopPropagation?.()
      event.preventActivation?.()
      if (descriptionScrollbarResult.capturePointer) event.setPointerCapture?.()
      if (descriptionScrollbarResult.scrollOffset !== undefined) {
        this._descriptionScrollY.setOffset(descriptionScrollbarResult.scrollOffset, {
          viewportSize: this._descriptionPanelHeight,
          contentSize: this._descriptionContentHeight,
        })
      }
      this.markNeedsPaint()
      return
    }
    if (this._isDescriptionDividerPosition(event.position)) {
      if ((event.clickCount ?? 1) >= 2) {
        this.resetDescriptionPanelHeight()
        event.stopPropagation?.()
        return
      }
      this._hoveredIndex = -1
      this._descriptionDividerDragging = true
      this._descriptionResizeStartPointerY = event.position.y
      this._descriptionResizeStartHeight = this._descriptionPanelHeight
      this.owner?.setCursor('row-resize')
      event.stopPropagation?.()
      event.setPointerCapture?.()
      this.markNeedsPaint()
      return
    }
    if (this._inDescriptionPanel(event.position)) {
      event.stopPropagation?.()
      return
    }
    const scrollbarResult = this._vScrollbarController.beginPointer(
      event.position,
      this._scrollbarGeometry(),
      key,
    )
    if (scrollbarResult.handled) {
      this._columnDividerHovered = false
      event.stopPropagation?.()
      event.preventActivation?.()
      if (scrollbarResult.capturePointer) event.setPointerCapture?.()
      if (scrollbarResult.scrollOffset !== undefined) {
        this._scrollY.setOffset(scrollbarResult.scrollOffset, {
          viewportSize: this._viewHeight,
          contentSize: this._contentHeight,
        })
        this._inlineEditing.refreshGeometry()
        this._popupEditors.syncGeometry()
      }
      this.markNeedsPaint()
      return
    }
    if (this._isColumnDividerPosition(event.position)) {
      this._inlineEditing.clearPointerState()
      this._hoveredIndex = -1
      this._columnDividerDragging = true
      this._columnResizeStartPointerX = event.position.x
      this._columnResizeStartWidth = this._resolvedNameColumnWidth()
      this.owner?.setCursor('col-resize')
      event.stopPropagation?.()
      event.setPointerCapture?.()
      this.markNeedsPaint()
      return
    }
    const index = this._paintRowIndexAt(event.position.y)
    if (index < 0) return
    const paintRow = this._paintRows[index]
    if (!paintRow?.row || !paintRow.key) return
    const clickedValueCell = this._isValueCellPosition(event.position)
    const activeEdit = this._inlineEditing.state
    if (activeEdit?.rowKey === paintRow.key && clickedValueCell && this._inlineEditing.handlePointerDown(event)) {
      event.stopPropagation?.()
      return
    }
    if (activeEdit && activeEdit.rowKey !== paintRow.key && !this._inlineEditing.commitEdit()) {
      event.stopPropagation?.()
      event.preventActivation?.()
      return
    }
    this._selectRow(paintRow.row)
    if (!paintRow.row.editable) {
      event.stopPropagation?.()
      return
    }
    if (!clickedValueCell) {
      event.stopPropagation?.()
      return
    }
    if ((event.clickCount ?? 1) === 1 && clickedValueCell && this._shouldRequestPopupEdit(paintRow.row)) {
      this._requestEdit(paintRow.row, { pointerX: event.position.x })
      event.stopPropagation?.()
      return
    }
    if ((event.clickCount ?? 1) >= 2 || (clickedValueCell && this._shouldRequestValueEdit(paintRow.row))) {
      this._requestEdit(paintRow.row, {
        pointerX: event.position.x,
        selectWord: (event.clickCount ?? 1) >= 2,
      })
      event.stopPropagation?.()
      return
    }
    if (this._activateInteractiveRow(paintRow.row)) {
      event.stopPropagation?.()
      return
    }
    event.stopPropagation?.()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this._inlineEditing.isEditing) return this._inlineEditing.handleKeyDown(event)
    if (event.key === 'ArrowDown') {
      const moved = this._moveSelection(1)
      if (!moved) return false
      event.preventDefault()
      return true
    }
    if (event.key === 'ArrowUp') {
      const moved = this._moveSelection(-1)
      if (!moved) return false
      event.preventDefault()
      return true
    }
    if (event.key === 'Enter' || event.key === 'F2') {
      const row = this.selectedRow
      if (!row?.editable) return false
      if (!this._editRow(row)) return false
      event.preventDefault()
      return true
    }
    if (event.key === ' ') {
      const row = this.selectedRow
      if (!row?.editable) return false
      const handled = this._activateInteractiveRow(row) || this._requestEdit(row)
      if (!handled) return false
      event.preventDefault()
      return true
    }
    return false
  }

  onPointerMove(event: PointerEvent): void {
    if (this._inlineEditing.handlePointerMove(event)) {
      event.stopPropagation?.()
      return
    }
    if (this._descriptionDividerDragging) {
      const nextHeight = this._descriptionResizeStartHeight - (event.position.y - this._descriptionResizeStartPointerY)
      this._descriptionHeightOverride = this._clampDescriptionPanelHeight(nextHeight)
      this._descriptionPanelHeight = this._descriptionHeightOverride
      this._clampDescriptionScroll()
      this._clampScroll()
      if (this._selectedRowId) this._scrollRowIntoView(this._selectedRowId)
      this.tooltip = ''
      this.owner?.setCursor('row-resize')
      event.stopPropagation?.()
      this.markNeedsPaint()
      return
    }
    if (this._descriptionVScrollbar.dragging) {
      const result = this._descriptionVScrollbarController.updatePointer(
        event.position,
        this._descriptionScrollbarGeometry(),
        pointerKey(event),
      )
      if (!result.handled) return
      this._descriptionScrollY.setOffset(result.scrollOffset ?? this.descriptionScrollY, {
        viewportSize: this._descriptionPanelHeight,
        contentSize: this._descriptionContentHeight,
      })
      event.stopPropagation?.()
      this.markNeedsPaint()
      return
    }
    if (this._columnDividerDragging) {
      const contentWidth = this._contentWidth()
      const nextWidth = this._columnResizeStartWidth + event.position.x - this._columnResizeStartPointerX
      const resolvedWidth = this._clampNameColumnWidth(nextWidth, contentWidth)
      const widthChanged = resolvedWidth !== this._nameColumnWidth
      this._nameColumnWidth = resolvedWidth
      this._inlineEditing.refreshGeometry()
      this._popupEditors.syncGeometry()
      this.tooltip = ''
      this.owner?.setCursor('col-resize')
      event.stopPropagation?.()
      if (widthChanged) this.markNeedsPaint()
      return
    }
    if (this._vScrollbar.dragging) {
      const result = this._vScrollbarController.updatePointer(
        event.position,
        this._scrollbarGeometry(),
        pointerKey(event),
      )
      if (!result.handled) return
      this._scrollY.setOffset(result.scrollOffset ?? this.scrollY, {
        viewportSize: this._viewHeight,
        contentSize: this._contentHeight,
      })
      this._inlineEditing.refreshGeometry()
      this._popupEditors.syncGeometry()
      event.stopPropagation?.()
      this.markNeedsPaint()
      return
    }
    if (this._descriptionVScrollbarController.updateHover(event.position, this._descriptionScrollbarGeometry())) this.markNeedsPaint()
    const hoveredDescriptionScrollbar = this._descriptionVScrollbar.hovered
    const hoveredDescriptionDivider = this._isDescriptionDividerPosition(event.position)
    if (hoveredDescriptionDivider !== this._descriptionDividerHovered) {
      this._descriptionDividerHovered = hoveredDescriptionDivider
      if (!hoveredDescriptionDivider) this.owner?.setCursor('default')
      this.markNeedsPaint()
    }
    if (hoveredDescriptionScrollbar || hoveredDescriptionDivider || this._inDescriptionPanel(event.position)) {
      this.tooltip = ''
      this._columnDividerHovered = false
      if (this._vScrollbarController.clearHover()) this.markNeedsPaint()
      if (hoveredDescriptionDivider) this.owner?.setCursor('row-resize')
      if (this._hoveredIndex >= 0) {
        this._hoveredIndex = -1
        this.markNeedsPaint()
      }
      return
    }
    if (this._vScrollbarController.updateHover(event.position, this._scrollbarGeometry())) this.markNeedsPaint()
    const hoveredScrollbar = this._vScrollbar.hovered
    if (hoveredScrollbar) {
      this.tooltip = ''
      if (this._columnDividerHovered) {
        this._columnDividerHovered = false
        this.markNeedsPaint()
      }
      if (this._hoveredIndex >= 0) {
        this._hoveredIndex = -1
        this.markNeedsPaint()
      }
      return
    }
    const hoveredDivider = this._isColumnDividerPosition(event.position)
    if (hoveredDivider !== this._columnDividerHovered) {
      this._columnDividerHovered = hoveredDivider
      if (!hoveredDivider) this.owner?.setCursor('default')
      this.markNeedsPaint()
    }
    if (hoveredDivider) {
      this.tooltip = ''
      this.owner?.setCursor('col-resize')
      if (this._hoveredIndex >= 0) {
        this._hoveredIndex = -1
        this.markNeedsPaint()
      }
      return
    }
    const index = this.hitTest(event.position) ? this._paintRowIndexAt(event.position.y) : -1
    this._syncOverflowTooltip(index, event.position)
    if (index !== this._hoveredIndex) {
      this._hoveredIndex = index
      this.markNeedsPaint()
    }
  }

  onPointerUp(event: PointerEvent): void {
    if (this._inlineEditing.handlePointerUp(event)) {
      event.stopPropagation?.()
      return
    }
    const key = pointerKey(event)
    if ((this._vScrollbar.dragging && !this._vScrollbarController.ownsPointer(key)) ||
      (this._descriptionVScrollbar.dragging && !this._descriptionVScrollbarController.ownsPointer(key))) return
    const scrollbarResult = this._vScrollbarController.endPointer(event.position, this._scrollbarGeometry(), key)
    const descriptionScrollbarResult = this._descriptionVScrollbarController.endPointer(
      event.position,
      this._descriptionScrollbarGeometry(),
      key,
    )
    const wasDragging = !!scrollbarResult.dragEnded || this._columnDividerDragging
      || !!descriptionScrollbarResult.dragEnded || this._descriptionDividerDragging
    this._columnDividerDragging = false
    this._descriptionDividerDragging = false
    if (!wasDragging) return
    this._columnDividerHovered = this._isColumnDividerPosition(event.position)
    this._descriptionDividerHovered = this._isDescriptionDividerPosition(event.position)
    this.owner?.setCursor(this._descriptionDividerHovered ? 'row-resize' : this._columnDividerHovered ? 'col-resize' : 'default')
    event.stopPropagation?.()
    event.releasePointerCapture?.()
    this.markNeedsPaint()
  }

  onPointerCancel(event: PointerEvent): void {
    if (this._inlineEditing.handlePointerCancel(event)) {
      event.stopPropagation?.()
      return
    }
    const key = pointerKey(event)
    if ((this._vScrollbar.dragging && !this._vScrollbarController.ownsPointer(key)) ||
      (this._descriptionVScrollbar.dragging && !this._descriptionVScrollbarController.ownsPointer(key))) return
    const hadState = this._hoveredIndex >= 0 || this._vScrollbar.dragging || this._vScrollbar.hovered
      || this._columnDividerDragging || this._columnDividerHovered
      || this._descriptionVScrollbar.dragging || this._descriptionVScrollbar.hovered
      || this._descriptionDividerDragging || this._descriptionDividerHovered
    this._vScrollbarController.cancelPointer(key)
    this._columnDividerDragging = false
    this._columnDividerHovered = false
    this._descriptionVScrollbarController.cancelPointer(key)
    this._descriptionDividerDragging = false
    this._descriptionDividerHovered = false
    this._hoveredIndex = -1
    this.tooltip = ''
    this.owner?.setCursor('default')
    event.releasePointerCapture?.()
    if (hadState) this.markNeedsPaint()
  }

  onPointerLeave(_event: PointerEvent): void {
    const hadState = this._hoveredIndex >= 0 || this._vScrollbar.hovered || this._columnDividerHovered
      || this._descriptionVScrollbar.hovered || this._descriptionDividerHovered
    this._hoveredIndex = -1
    this._vScrollbarController.clearHover()
    if (!this._columnDividerDragging) this._columnDividerHovered = false
    this._descriptionVScrollbarController.clearHover()
    if (!this._descriptionDividerDragging) this._descriptionDividerHovered = false
    this.tooltip = ''
    if (!this._columnDividerDragging && !this._descriptionDividerDragging) this.owner?.setCursor('default')
    if (hadState) this.markNeedsPaint()
  }

  onWheel(event: WheelPointerEvent): boolean {
    if (!this.hitTest(event.position) || event.deltaY === 0) return false
    if (this._isDescriptionDividerPosition(event.position)) return false
    if (this._inDescriptionPanel(event.position)) {
      const scrollable = this._descriptionContentHeight > this._descriptionPanelHeight
      const before = this.descriptionScrollY
      this._descriptionScrollY.scrollBy(event.deltaY > 0 ? 40 : -40, {
        viewportSize: this._descriptionPanelHeight,
        contentSize: this._descriptionContentHeight,
      })
      if (this.descriptionScrollY === before) return scrollable
      this.markNeedsPaint()
      return true
    }
    const scrollable = this._contentHeight > this._viewHeight
    const before = this.scrollY
    this._scrollY.scrollBy(event.deltaY > 0 ? 40 : -40, { viewportSize: this._viewHeight, contentSize: this._contentHeight })
    if (this.scrollY === before) return scrollable
    this._inlineEditing.refreshGeometry()
    this._popupEditors.syncGeometry()
    this.markNeedsPaint()
    return true
  }

  private _paintValueCell(
    context: PaintContext,
    dl: DrawList,
    row: PropertyGridRow | undefined,
    value: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fontSize: number,
    fontFamily: string,
  ): void {
    const theme = context.theme
    const editor = row?.editor ?? row?.kind
    if (this._inlineEditing.isEditingRow(row)) {
      this._inlineEditing.paint(context, dl, {
        x: x - 8,
        y,
        width: width + 16,
        height,
      })
      return
    }
    if (row?.editable) dl.fillRect(x - 4, y + 4, Math.max(0, width - 12), height - 8, theme.fieldBg, 3)
    if (editor === 'boolean') {
      const state = readBooleanState(value)
      const checked = state === 'true'
      const mixed = state === 'mixed'
      const boxSize = 12
      const boxY = y + (height - boxSize) / 2
      dl.fillRect(x, boxY, boxSize, boxSize, checked ? theme.accentPrimary : theme.surfaceControl, 2)
      dl.strokeRect(x, boxY, boxSize, boxSize, checked ? theme.accentPrimaryHover : theme.borderControl, 1, 2)
      if (checked) {
        const iconSize = boxSize - 2
        paintIconGlyph(context, {
          name: 'check',
          x: x + (boxSize - iconSize) / 2,
          y: boxY + (boxSize - iconSize) / 2,
          size: iconSize,
          color: theme.textOnAccent,
        })
      }
      if (mixed) dl.fillRect(x + 3, boxY + boxSize / 2 - 1, boxSize - 6, 2, theme.accentPrimary, 1)
      dl.fillText(state, x + boxSize + 7, y + height / 2, row?.editable ? theme.textAccent : theme.textPrimary, fontSize, fontFamily)
      return
    }
    const swatch = parseHexColor(value)
    const textX = swatch ? x + 20 : x
    if (swatch) {
      dl.fillRect(x, y + 7, 13, height - 14, swatch, 2)
      dl.strokeRect(x, y + 7, 13, height - 14, theme.borderControl, 1, 2)
    }
    const display = propertyGridDisplayValue(row, value)
    const textColor = row?.status === 'error'
      ? theme.accentDanger
      : row?.status === 'warning'
        ? theme.accentWarning
        : row?.editable ? theme.textAccent : theme.textPrimary
    dl.fillText(
      fitText(display, Math.max(0, width - (textX - x) - 16), fontSize, fontFamily),
      textX,
      y + height / 2,
      textColor,
      fontSize,
      fontFamily,
    )
  }

  private _paintDescriptionPanel(
    dl: DrawList,
    theme: PaintContext['theme'],
    offset: Offset,
    scrollbarStyle: ReturnType<typeof deriveScrollbarStyle>,
  ): void {
    const dividerY = offset.y + this._viewHeight + PROPERTY_GRID_DESCRIPTION_DIVIDER_HEIGHT / 2
    const dividerColor = this._descriptionDividerDragging
      ? theme.accentPrimary
      : this._descriptionDividerHovered
        ? theme.borderControlHover
        : theme.borderSubtle
    dl.line(offset.x, dividerY, offset.x + this.size.width, dividerY, dividerColor, this._descriptionDividerDragging ? 2 : 1)

    const panelTop = offset.y + this._viewHeight + PROPERTY_GRID_DESCRIPTION_DIVIDER_HEIGHT
    dl.fillRect(offset.x, panelTop, this.size.width, this._descriptionPanelHeight, theme.surfacePanel)
    const showScrollbar = this._descriptionContentHeight > this._descriptionPanelHeight
    const scrollbarWidth = showScrollbar ? scrollbarStyle.gutterSize : 0
    const textWidth = Math.max(0, this.size.width - PROPERTY_GRID_DESCRIPTION_PADDING * 2 - scrollbarWidth)
    const layout = this._descriptionLayout(textWidth)
    const row = this.selectedRow
    let y = panelTop + PROPERTY_GRID_DESCRIPTION_PADDING - this.descriptionScrollY

    dl.pushClip(offset.x, panelTop, Math.max(0, this.size.width - scrollbarWidth), this._descriptionPanelHeight)
    for (const line of layout.titleLines) {
      dl.fillText(
        line,
        offset.x + PROPERTY_GRID_DESCRIPTION_PADDING,
        y + layout.lineHeight / 2,
        theme.textAccent,
        PROPERTY_GRID_FONT_SIZE,
        PROPERTY_GRID_FONT_FAMILY,
        'left',
        'middle',
        600,
      )
      y += layout.lineHeight
    }
    y += PROPERTY_GRID_DESCRIPTION_GAP
    for (const line of layout.descriptionLines) {
      dl.fillText(
        line,
        offset.x + PROPERTY_GRID_DESCRIPTION_PADDING,
        y + layout.lineHeight / 2,
        theme.textSecondary,
        PROPERTY_GRID_FONT_SIZE,
        PROPERTY_GRID_FONT_FAMILY,
      )
      y += layout.lineHeight
    }
    if (layout.errorLines.length > 0) {
      y += PROPERTY_GRID_DESCRIPTION_GAP
      const errorColor = row?.status === 'warning' ? theme.accentWarning : theme.accentDanger
      for (const line of layout.errorLines) {
        dl.fillText(
          line,
          offset.x + PROPERTY_GRID_DESCRIPTION_PADDING,
          y + layout.lineHeight / 2,
          errorColor,
          PROPERTY_GRID_FONT_SIZE,
          PROPERTY_GRID_FONT_FAMILY,
        )
        y += layout.lineHeight
      }
    }
    dl.popClip()

    if (showScrollbar) {
      paintVBar({
        dl,
        style: scrollbarStyle,
        trackX: offset.x + this.size.width - scrollbarStyle.gutterSize,
        trackY: panelTop,
        trackW: scrollbarStyle.gutterSize,
        trackH: this._descriptionPanelHeight,
        viewSize: this._descriptionPanelHeight,
        contentSize: this._descriptionContentHeight,
        scrollOffset: this.descriptionScrollY,
        state: this._descriptionVScrollbar,
      })
    }
  }

  private _descriptionLayout(textWidth: number): PropertyGridDescriptionLayout {
    const row = this.selectedRow
    const title = row ? row.label ?? row.name : '属性说明'
    const description = row?.description?.trim() || this._descriptionEmptyText
    const errorText = row?.errorText?.trim() ?? ''
    const lineHeight = Math.ceil(TextMeasurer.lineHeight(PROPERTY_GRID_FONT_SIZE)) + 2
    const titleLines = wrapPropertyGridText(title, textWidth, PROPERTY_GRID_FONT_SIZE, PROPERTY_GRID_FONT_FAMILY)
    const descriptionLines = wrapPropertyGridText(description, textWidth, PROPERTY_GRID_FONT_SIZE, PROPERTY_GRID_FONT_FAMILY)
    const errorLines = errorText
      ? wrapPropertyGridText(errorText, textWidth, PROPERTY_GRID_FONT_SIZE, PROPERTY_GRID_FONT_FAMILY)
      : []
    const contentHeight = PROPERTY_GRID_DESCRIPTION_PADDING * 2
      + Math.max(1, titleLines.length) * lineHeight
      + PROPERTY_GRID_DESCRIPTION_GAP
      + Math.max(1, descriptionLines.length) * lineHeight
      + (errorLines.length > 0 ? PROPERTY_GRID_DESCRIPTION_GAP + errorLines.length * lineHeight : 0)
    return { titleLines, descriptionLines, errorLines, lineHeight, contentHeight }
  }

  private _measureDescriptionContentHeight(textWidth: number): number {
    return this._descriptionLayout(textWidth).contentHeight
  }

  private _resolveDescriptionLayout(desiredHeight: number): void {
    if (!this._showDescriptionPanel) {
      this._descriptionPanelHeight = 0
      this._descriptionContentHeight = 0
      this._resetDescriptionScroll()
      return
    }
    const scrollbarWidth = deriveScrollbarStyle(this.currentTheme).gutterSize
    const fullTextWidth = Math.max(0, this.size.width - PROPERTY_GRID_DESCRIPTION_PADDING * 2)
    const maximumPanelHeight = this._maximumDescriptionPanelHeight()
    let contentHeight = this._measureDescriptionContentHeight(fullTextWidth)
    let panelHeight = this._clampDescriptionPanelHeight(this._descriptionHeightOverride ?? Math.max(desiredHeight, contentHeight))
    if (contentHeight > panelHeight) {
      contentHeight = this._measureDescriptionContentHeight(Math.max(0, fullTextWidth - scrollbarWidth))
      if (this._descriptionHeightOverride === undefined) panelHeight = Math.min(contentHeight, maximumPanelHeight)
    }
    this._descriptionPanelHeight = panelHeight
    this._descriptionContentHeight = contentHeight
    this._clampDescriptionScroll()
  }

  private _maximumDescriptionPanelHeight(): number {
    const minimumRowsHeight = Math.min(PROPERTY_GRID_MIN_ROWS_VIEW_HEIGHT, this._contentHeight)
    return Math.max(0, this.size.height - PROPERTY_GRID_DESCRIPTION_DIVIDER_HEIGHT - minimumRowsHeight)
  }

  private _clampDescriptionPanelHeight(height: number): number {
    const maximum = this._maximumDescriptionPanelHeight()
    const minimum = Math.min(36, maximum)
    return Math.max(minimum, Math.min(maximum, Number.isFinite(height) ? height : minimum))
  }

  private _resetDescriptionScroll(): void {
    this._descriptionScrollY.setOffset(0, { viewportSize: 0, contentSize: 0 })
  }

  private _clampDescriptionScroll(): void {
    this._descriptionScrollY.setOffset(this.descriptionScrollY, {
      viewportSize: this._descriptionPanelHeight,
      contentSize: this._descriptionContentHeight,
    })
  }

  private _activateInteractiveRow(row: PropertyGridRow): boolean {
    if (!row.editable) return false
    const editor = row.editor ?? row.kind
    if (editor === 'boolean') {
      const next = readBooleanState(row.value) !== 'true'
      return this._commitRowValue(row, next, { displayValue: next })
    }
    if (editor !== 'enum' || !row.enumItems?.length) return false
    const currentIndex = row.enumItems.findIndex(item => String(item.value) === row.value)
    const next = row.enumItems[(currentIndex + 1 + row.enumItems.length) % row.enumItems.length]!
    return this._commitRowValue(row, next.value, { displayValue: next.value })
  }

  private _shouldRequestPopupEdit(row: PropertyGridRow): boolean {
    if (!this._canRequestEdit(row)) return false
    const editor = row.editor ?? row.kind
    return editor === 'enum' || editor === 'color' || editor === 'date'
  }

  private _shouldRequestValueEdit(row: PropertyGridRow): boolean {
    if (!this._canRequestEdit(row)) return false
    const editor = row.editor ?? row.kind
    return editor !== 'boolean'
  }

  private _editRow(row: PropertyGridRow): boolean {
    if (!row.editable) return false
    if (this._shouldRequestPopupEdit(row) || this._shouldRequestValueEdit(row)) {
      return this._requestEdit(row)
    }
    return this._activateInteractiveRow(row)
  }

  private _requestEdit(row: PropertyGridRow, options: {
    selectAll?: boolean
    pointerX?: number
    selectWord?: boolean
  } = {}): boolean {
    if (!row.editable) return false
    const context = this._createEditContext(row)
    const editor = context.editor
    const handler = editor ? this._editorHandlers[editor] : undefined
    if (handler && handler(context) !== false) return true
    const defaultHandler = defaultPropertyGridEditorHandler(editor)
    if (defaultHandler && defaultHandler(context) !== false) return true
    if (this._onEditRequested && this._onEditRequested(row, context) !== false) return true
    return this._openBuiltInEditor(row, options)
  }

  private _canRequestEdit(row: PropertyGridRow): boolean {
    if (!row.editable) return false
    const editor = row.editor ?? row.kind
    return !!(
      this._onEditRequested ||
      (editor && (
        this._editorHandlers[editor] ||
        defaultPropertyGridEditorHandler(editor) ||
        isBuiltInPropertyGridEditor(editor)
      ))
    )
  }

  private _openBuiltInEditor(row: PropertyGridRow, options: {
    selectAll?: boolean
    pointerX?: number
    selectWord?: boolean
  }): boolean {
    const editor = row.editor ?? row.kind
    if (editor === 'boolean') return this._activateInteractiveRow(row)
    const rowKey = this._keyForRow(row)
    if (!rowKey) return false
    if (editor === 'enum' || editor === 'color' || editor === 'date') {
      if (!this._inlineEditing.commitEdit()) return false
      return this._popupEditors.beginEdit(rowKey, row)
    }
    if (editor !== 'text' && editor !== 'number') return false
    this._popupEditors.cancelEdit()
    return this._inlineEditing.beginEdit({
      rowKey,
      row,
      selectAll: options.selectAll,
      pointerX: options.pointerX,
      selectWord: options.selectWord,
    })
  }

  private _createEditContext(row: PropertyGridRow): PropertyGridEditContext {
    return {
      grid: this,
      row,
      editor: row.editor ?? row.kind,
      commit: (nextValue, options) => this._commitRowValue(row, nextValue, options),
      updateDisplayValue: value => this._updateRowValue(row, value),
      setError: message => {
        this._onEditError?.(row, message)
      },
    }
  }

  private _selectRow(row: PropertyGridRow | undefined): boolean {
    const key = row ? this._keyForRow(row) : undefined
    if (this._selectedRowId === key) return false
    this._selectedRowId = key
    this._onSelectedRowChange?.(row)
    if (key) this._scrollRowIntoView(key)
    this._resetDescriptionScroll()
    this.markNeedsLayout()
    return true
  }

  private _moveSelection(direction: 1 | -1): boolean {
    const rows = this._propertyPaintRows()
    if (rows.length === 0) return false
    let index = this._selectedRowId ? rows.findIndex(row => row.key === this._selectedRowId) : -1
    index = index < 0
      ? direction > 0 ? 0 : rows.length - 1
      : Math.min(rows.length - 1, Math.max(0, index + direction))
    const row = rows[index]?.row
    return row ? this._selectRow(row) : false
  }

  private _moveEditSelectionFrom(rowKey: string, direction: 1 | -1): void {
    const rows = this._propertyPaintRows()
    const start = rows.findIndex(row => row.key === rowKey)
    if (start < 0) return
    for (let index = start + direction; index >= 0 && index < rows.length; index += direction) {
      const candidate = rows[index]
      const row = candidate?.row
      if (!candidate?.key || !row?.editable || !this._canRequestEdit(row)) continue
      this._selectRow(row)
      if ((row.editor ?? row.kind) !== 'boolean') this._requestEdit(row, { selectAll: true })
      return
    }
  }

  private _scrollRowIntoView(key: string): void {
    const index = this._rowIndexForKey(key)
    if (index < 0) return
    const rect = this._rowRectAtIndex(index, 'row')
    if (!rect) return
    if (rect.y < this.globalOffset.y) {
      this.scrollY += rect.y - this.globalOffset.y
    } else if (rect.y + rect.height > this.globalOffset.y + this._viewHeight) {
      this.scrollY += rect.y + rect.height - (this.globalOffset.y + this._viewHeight)
    }
  }

  private _updateRowValue(row: PropertyGridRow, value: unknown): boolean {
    const index = this._rows.indexOf(row)
    if (index < 0) return false
    const nextRow = {
      ...row,
      value: formatPropertyGridValue(value),
    }
    this._rows = [
      ...this._rows.slice(0, index),
      nextRow,
      ...this._rows.slice(index + 1),
    ]
    const selectedKey = this._selectedRowId
    this._rebuildPaintRows()
    this._inlineEditing.syncRows()
    this._popupEditors.syncRows()
    if (selectedKey && this._rowByKey(selectedKey)) this._selectedRowId = selectedKey
    this.markNeedsLayout()
    this.markNeedsPaint()
    return true
  }

  private _commitRowValue(
    row: PropertyGridRow,
    nextValue: unknown,
    options: PropertyGridValueCommitOptions = {},
  ): boolean {
    if (!row.editable) return false
    const commit = options.onCommit ?? this._onValueCommit
    if (commit && commit(row, nextValue) === false) return false
    if (this._updateRowValue(row, options.displayValue ?? nextValue)) return true
    return true
  }

  private _isValueCellPosition(position: Offset): boolean {
    if (position.y > this.globalOffset.y + this._viewHeight) return false
    const contentWidth = this._contentWidth()
    const nameWidth = this._resolvedNameColumnWidth(contentWidth)
    return position.x >= this.globalOffset.x + nameWidth
  }

  private _isValueRectVisible(rect: Rect): boolean {
    const left = this.globalOffset.x
    const top = this.globalOffset.y
    const right = left + this._contentWidth()
    const bottom = top + this._viewHeight
    return rect.width > 0 && rect.height > 0 &&
      rect.x < right && rect.x + rect.width > left &&
      rect.y < bottom && rect.y + rect.height > top
  }

  private _syncOverflowTooltip(index: number, position: Offset): void {
    const paintRow = index >= 0 ? this._paintRows[index] : undefined
    const row = paintRow?.row
    if (!row) {
      this.tooltip = ''
      return
    }
    const contentWidth = this._contentWidth()
    const nameWidth = this._resolvedNameColumnWidth(contentWidth)
    const inNameCell = position.x < this.globalOffset.x + nameWidth
    if (inNameCell) {
      const label = row.label ?? row.name
      this.tooltip = this._textOverflows(label, Math.max(0, nameWidth - 12)) ? label : ''
      return
    }
    const display = propertyGridDisplayValue(row)
    const editor = row.editor ?? row.kind
    const leadingWidth = editor === 'boolean' ? 19 : parseHexColor(row.value) ? 20 : 0
    const valueWidth = Math.max(0, contentWidth - nameWidth - 16)
    const availableWidth = Math.max(0, valueWidth - leadingWidth - 16)
    this.tooltip = this._textOverflows(display, availableWidth) ? display : ''
  }

  private _textOverflows(text: string, availableWidth: number): boolean {
    return !!text && TextMeasurer.measureWidth(text, PROPERTY_GRID_FONT_SIZE, PROPERTY_GRID_FONT_FAMILY) > availableWidth
  }

  private _isColumnDividerPosition(position: Offset): boolean {
    if (this._paintRows.length === 0 || !this.hitTest(position) || this._inScrollbar(position)) return false
    if (position.y > this.globalOffset.y + this._viewHeight) return false
    const dividerX = this.globalOffset.x + this._resolvedNameColumnWidth()
    return Math.abs(position.x - dividerX) <= PROPERTY_GRID_COLUMN_DIVIDER_HIT_WIDTH / 2
  }

  private _isDescriptionDividerPosition(position: Offset): boolean {
    if (!this._showDescriptionPanel || !this.hitTest(position)) return false
    const dividerY = this.globalOffset.y + this._viewHeight + PROPERTY_GRID_DESCRIPTION_DIVIDER_HEIGHT / 2
    return Math.abs(position.y - dividerY) <= PROPERTY_GRID_DESCRIPTION_DIVIDER_HIT_HEIGHT / 2
  }

  private _inDescriptionPanel(position: Offset): boolean {
    if (!this._showDescriptionPanel || !this.hitTest(position)) return false
    const top = this.globalOffset.y + this._viewHeight + PROPERTY_GRID_DESCRIPTION_DIVIDER_HEIGHT
    return position.y >= top && position.y <= top + this._descriptionPanelHeight
  }

  private _inDescriptionScrollbar(position: Offset): boolean {
    return this._inDescriptionPanel(position) &&
      hitTestScrollbarGeometry(position, this._descriptionScrollbarGeometry())
  }

  private _descriptionScrollbarGeometry(): ScrollbarGeometry {
    const style = deriveScrollbarStyle(this.currentTheme)
    const g = this.globalOffset
    const top = g.y + this._viewHeight + PROPERTY_GRID_DESCRIPTION_DIVIDER_HEIGHT
    return resolveScrollbarGeometryForState({
      axis: 'vertical',
      trackRect: { x: g.x + this.size.width - style.gutterSize, y: top, width: style.gutterSize, height: this._descriptionPanelHeight },
      viewportSize: this._descriptionPanelHeight,
      contentSize: this._descriptionContentHeight,
      scrollOffset: this.descriptionScrollY,
      style,
      state: this._descriptionVScrollbar,
    })
  }

  private _resolvedNameColumnWidth(contentWidth = this._contentWidth()): number {
    return this._clampNameColumnWidth(this._nameColumnWidth, contentWidth)
  }

  private _clampNameColumnWidth(width: number, contentWidth: number): number {
    const maxWidth = Math.max(0, contentWidth - PROPERTY_GRID_MIN_VALUE_COLUMN_WIDTH)
    const minWidth = Math.min(PROPERTY_GRID_MIN_NAME_COLUMN_WIDTH, maxWidth)
    return Math.max(minWidth, Math.min(maxWidth, width))
  }

  private _keyForRow(row: PropertyGridRow): string | undefined {
    return this._paintRows.find(paintRow => paintRow.row === row)?.key
  }

  private _rowByKey(key: string): PropertyGridRow | undefined {
    return this._paintRows.find(paintRow => paintRow.key === key)?.row
  }

  private _rowIndexForKey(key: string): number {
    return this._paintRows.findIndex(paintRow => paintRow.key === key)
  }

  private _propertyPaintRows(): PaintRow[] {
    return this._paintRows.filter(row => !!row.row)
  }

  private _rowRect(group: string, name: string, cell: 'row' | 'value'): Rect | undefined {
    const index = this._paintRows.findIndex(paintRow => paintRow.row?.group === group && paintRow.row.name === name)
    return index >= 0 ? this._rowRectAtIndex(index, cell) : undefined
  }

  private _rowRectByKey(key: string, cell: 'row' | 'value'): Rect | undefined {
    const index = this._rowIndexForKey(key)
    return index >= 0 ? this._rowRectAtIndex(index, cell) : undefined
  }

  private _rowRectAtIndex(index: number, cell: 'row' | 'value'): Rect | undefined {
    const contentWidth = this._contentWidth()
    let y = this.globalOffset.y - this.scrollY
    for (let i = 0; i < this._paintRows.length; i += 1) {
      const paintRow = this._paintRows[i]!
      const height = paintRow.type === 'group' ? this._groupHeight : this._rowHeight
      if (i === index) {
        if (cell === 'value') {
          const nameWidth = this._resolvedNameColumnWidth(contentWidth)
          return {
            x: this.globalOffset.x + nameWidth,
            y,
            width: Math.max(0, contentWidth - nameWidth),
            height,
          }
        }
        return { x: this.globalOffset.x, y, width: contentWidth, height }
      }
      y += height
    }
    return undefined
  }

  [GET_POPUP_ANCHOR_RECT](anchor?: PropertyGridRowAnchor): Rect {
    if (anchor) {
      const rect = anchor.id
        ? this._rowRectByKey(anchor.id, anchor.cell ?? 'row')
        : this._rowRect(anchor.group, anchor.name, anchor.cell ?? 'row')
      if (rect) return rect
    }
    return { x: this.globalOffset.x, y: this.globalOffset.y, width: this.size.width, height: this.size.height }
  }

  private _rebuildPaintRows(): void {
    const paintRows: PaintRow[] = []
    const keyCounts = new Map<string, number>()
    let activeGroup = ''
    for (const row of this._rows) {
      if (row.group !== activeGroup) {
        activeGroup = row.group
        paintRows.push({ type: 'group', group: activeGroup })
      }
      const baseKey = row.id ?? row.propPath ?? `${row.group}\u0000${row.name}`
      const count = keyCounts.get(baseKey) ?? 0
      keyCounts.set(baseKey, count + 1)
      paintRows.push({
        type: 'property',
        group: row.group,
        key: count === 0 ? baseKey : `${baseKey}\u0000${count}`,
        name: row.name,
        value: row.value,
        row,
      })
    }
    this._paintRows = paintRows
  }

  private _paintRowIndexAt(globalY: number): number {
    if (globalY < this.globalOffset.y || globalY > this.globalOffset.y + this._viewHeight) return -1
    let y = this.globalOffset.y - this.scrollY
    for (let i = 0; i < this._paintRows.length; i++) {
      const row = this._paintRows[i]!
      const h = row.type === 'group' ? this._groupHeight : this._rowHeight
      if (globalY >= y && globalY <= y + h) return i
      y += h
    }
    return -1
  }

  private _clampScroll(): void {
    this._scrollY.setOffset(this.scrollY, { viewportSize: this._viewHeight, contentSize: this._contentHeight })
  }

  private _contentWidth(style = deriveScrollbarStyle(this.currentTheme)): number {
    return Math.max(0, this.size.width - (this._showVBar ? style.gutterSize : 0))
  }

  private _inScrollbar(point: Offset): boolean {
    return hitTestScrollbarGeometry(point, this._scrollbarGeometry())
  }

  private _scrollbarGeometry(): ScrollbarGeometry {
    const style = deriveScrollbarStyle(this.currentTheme)
    const g = this.globalOffset
    return resolveScrollbarGeometryForState({
      axis: 'vertical',
      trackRect: { x: g.x + this.size.width - style.gutterSize, y: g.y, width: style.gutterSize, height: this._viewHeight },
      viewportSize: this._viewHeight,
      contentSize: this._contentHeight,
      scrollOffset: this.scrollY,
      style,
      state: this._vScrollbar,
    })
  }

  private get _showVBar(): boolean {
    return this._contentHeight > this._viewHeight
  }

  private get _viewHeight(): number {
    if (!this._showDescriptionPanel) return this.size.height
    return Math.max(0, this.size.height - PROPERTY_GRID_DESCRIPTION_DIVIDER_HEIGHT - this._descriptionPanelHeight)
  }
}

function wrapPropertyGridText(text: string, maxWidth: number, fontSize: number, fontFamily: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (!normalized) return ['']
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return normalized.split('\n')
  const measure = (value: string) => TextMeasurer.measureWidth(value, fontSize, fontFamily)
  const lines: string[] = []
  for (const paragraph of normalized.split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    const tokens = paragraph.match(/\s+|[A-Za-z0-9_./:@#%+~-]+|./gu) ?? []
    let line = ''
    let pendingSpace = ''
    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        if (line) pendingSpace = ' '
        continue
      }
      const candidate = line ? `${line}${pendingSpace}${token}` : token
      pendingSpace = ''
      if (measure(candidate) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) {
        lines.push(line)
        line = ''
      }
      if (measure(token) <= maxWidth) {
        line = token
        continue
      }
      let fragment = ''
      for (const char of token) {
        const next = fragment + char
        if (fragment && measure(next) > maxWidth) {
          lines.push(fragment)
          fragment = char
        } else {
          fragment = next
        }
      }
      line = fragment
    }
    lines.push(line)
  }
  return lines.length > 0 ? lines : ['']
}

function pointInRect(point: Offset, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}

function fitText(text: string, width: number, fontSize: number, fontFamily: string): string {
  return ellipsizeText(text, width, value => TextMeasurer.measureWidth(value, fontSize, fontFamily))
}

function editIndicatorIcon(row: PropertyGridRow): IconName {
  const editor = row.editor ?? row.kind ?? 'text'
  if (editor === 'boolean') return 'checkbox-checked'
  if (editor === 'enum') return 'chevron-down'
  return 'more-horizontal'
}

function defaultPropertyGridEditorHandler(editor: PropertyGridEditorKind | undefined): PropertyGridEditorHandler | undefined {
  if (editor === 'image-source') return openImageSourceFilePicker
  return undefined
}

function isBuiltInPropertyGridEditor(editor: PropertyGridEditorKind | undefined): boolean {
  return editor === 'text' || editor === 'number' || editor === 'boolean' ||
    editor === 'enum' || editor === 'color' || editor === 'date'
}

function openImageSourceFilePicker(context: PropertyGridEditContext): boolean {
  if (typeof document === 'undefined' || !document.body || typeof FileReader === 'undefined') {
    context.setError(`${context.row.group}.${context.row.name} requires a browser file picker.`)
    return false
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.style.display = 'none'
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    input.remove()
  }
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    cleanup()
    if (!file) return
    void readImageFileAsBase64DataUri(file)
      .then(source => {
        if (!isImageBase64DataUri(source)) {
          context.setError(`${context.row.group}.${context.row.name} must be a base64 image data URI.`)
          return
        }
        context.commit(source)
      })
      .catch(error => {
        context.setError(error instanceof Error ? error.message : String(error))
      })
  }, { once: true })
  input.addEventListener('cancel', cleanup, { once: true })
  document.body.appendChild(input)
  input.click()
  return true
}

function readImageFileAsBase64DataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        resolve(result)
        return
      }
      reject(new Error('Image source could not be read as a base64 data URI.'))
    }
    reader.onerror = () => reject(new Error('Image source could not be read as a base64 data URI.'))
    reader.readAsDataURL(file)
  })
}

function isImageBase64DataUri(value: string): boolean {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value)
}

function formattedDisplayValue(row: PropertyGridRow | undefined, value: string): string {
  if (!row?.unit || value.trim().endsWith(row.unit)) return value
  if (!Number.isFinite(Number(value))) return value
  return `${value} ${row.unit}`
}

function enumDisplayValue(row: PropertyGridRow | undefined, value: string): string {
  const item = row?.enumItems?.find(option => String(option.value) === value)
  return item ? item.label : value
}

function propertyGridDisplayValue(row: PropertyGridRow | undefined, value = row?.value ?? ''): string {
  const editor = row?.editor ?? row?.kind
  if (editor === 'boolean') return readBooleanState(value)
  return editor === 'enum' ? enumDisplayValue(row, value) : formattedDisplayValue(row, value)
}

function readBooleanState(value: unknown): 'true' | 'false' | 'mixed' {
  if (value === 'mixed') return 'mixed'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const text = String(value).trim().toLowerCase()
  if (text === 'mixed') return 'mixed'
  return text === 'true' || text === '1' || text === 'yes' || text === 'on' ? 'true' : 'false'
}

function parseHexColor(value: string): Color | undefined {
  const text = value.trim()
  const match = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(text)
  if (!match) return undefined
  const hex = match[1]!
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  }
}

function formatPropertyGridValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
