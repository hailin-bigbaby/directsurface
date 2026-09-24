import { DisposableBag } from '../../../core/disposable'
import { PopupManager, clampRectToPopupViewport, type Popup, type PopupContext } from '../../../core/popup_manager'
import {
  ResizablePopupPanelShell,
  type PopupResizablePanelLayout,
} from '../../../core/popup_shell'
import {
  type PopupAnchor,
  resolvePopupAnchorRect,
  resolvePopupAnchorTarget,
} from '../../../core/popup_anchor'
import type { PaintContext } from '../../../rendering/paint_context'
import { DrawList } from '../../../rendering/draw_list'
import { drawPopupPanel } from '../../../rendering/popup_painter'
import { PopupRenderSurface } from '../../../core/popup_render_surface'
import type { PointerEvent as PopupPointerEvent, WheelPointerEvent as PopupWheelPointerEvent } from '../../../gestures/hit_test'
import { RenderDataGrid } from '../../grid_view'
import {
  deriveGridCellStyle,
  derivePopupStyle,
  deriveScrollbarStyle,
  deriveTextInputStyle,
  deriveWindowChromeStyle,
  resolveTextColor,
  type PopupStyleTokens,
  type TextInputStyleTokens,
} from '../../../theme/component_styles'
import type { ResolvedTheme } from '../../../theme/theme'
import { calcFixedVirtualRange, scrollToFixedIndex } from '../../../virtualization/fixed_virtual_range'
import type {
  GridColumnDef,
  GridDropdownGridPopupDebugState,
  GridEmbeddedPopupGrid,
  GridPopupAnchorData,
} from '../grid_types'
import { PopupTextInput } from '../../popup_text_input'

interface DropdownGridPopupLayout extends PopupResizablePanelLayout {
  anchorRect: { x: number; y: number; w: number; h: number }
  theme: ResolvedTheme
  popupStyle: PopupStyleTokens
  inputStyle: TextInputStyleTokens
  colWidths: number[]
  panelW: number
  panelH: number
  panelX: number
  panelY: number
  itemH: number
  headerH: number
  searchInputH: number
  searchH: number
  gridH: number
}

export interface DropdownGridPopupOptions {
  createEmbeddedGrid: () => GridEmbeddedPopupGrid
}

export interface DropdownGridPopupOpenOptions {
  columns: Array<{ key: string; title: string; width?: number }>
  rows: Array<Record<string, any>>
  valueKey: string
  labelKey: string
  selectedValue: string
  anchor: PopupAnchor<GridPopupAnchorData>
  searchable?: boolean
  searchBehavior?: 'internal' | 'external'
  searchText?: string
  maxVisibleItems?: number
  onSelect: (value: string, row: Record<string, any>) => boolean | void
  onSearchTextChange?: (value: string) => void
  onClose: () => void
}

export class DropdownGridPopup extends ResizablePopupPanelShell implements Popup {
  private static readonly MIN_PANEL_WIDTH = 200
  private static readonly MIN_FLEX_COL_WIDTH = 60
  private static readonly RESIZE_GRIP_SIZE = 16

  private readonly _createEmbeddedGrid: DropdownGridPopupOptions['createEmbeddedGrid']
  private _columns: Array<{ key: string; title: string; width?: number }> = []
  private _rows: Array<Record<string, any>> = []
  private _filteredRows: Array<Record<string, any>> = []
  private _valueKey = ''
  private _labelKey = ''
  private _selectedValue = ''
  private _keyboardIndex = -1
  private _searchText = ''
  private _searchable = false
  private _searchBehavior: 'internal' | 'external' = 'internal'
  private _scrollOffset = 0
  private _maxVisibleItems = 8
  private _anchor?: PopupAnchor<GridPopupAnchorData>
  private _grid: GridEmbeddedPopupGrid | null = null
  private readonly _gridSurface = new PopupRenderSurface(undefined, (root, popupContext) => {
    if (root !== this._grid) return
    this._syncGridLayout(this._layout(popupContext))
  })
  private _onSelect?: (value: string, row: Record<string, any>) => boolean | void
  private _onSearchTextChange?: (value: string) => void
  private _onClose?: () => void
  private readonly _searchInput = new PopupTextInput(() => PopupManager.instance.requestPaint())
  private readonly _disposables = new DisposableBag()

  constructor(options?: DropdownGridPopupOptions) {
    super()
    this._createEmbeddedGrid = options?.createEmbeddedGrid ?? (() => new RenderDataGrid<Record<string, any>>({
      columns: [],
      rows: [],
      editable: false,
      resizableColumns: false,
      sortable: false,
      reserveScrollbars: false,
    }) as GridEmbeddedPopupGrid)
  }

  get selectedValue(): string { return this._selectedValue }

  set selectedValue(value: string) {
    const nextValue = String(value ?? '')
    if (nextValue === this._selectedValue) return
    this._selectedValue = nextValue
    this._setKeyboardIndex(this._selectedIndex(), { allowNone: true })
    if (this.visible) this.requestPopupPaint()
  }

  get searchText(): string { return this._searchText }

  set searchText(value: string) {
    this._setSearchText(value, { syncInput: true, emit: false })
  }

  open(opts: DropdownGridPopupOpenOptions): void {
    if (this.popupOpen) this.close()
    this._searchInput.endSession()
    this._columns = opts.columns
    this._rows = opts.rows
    this._filteredRows = [...opts.rows]
    this._valueKey = opts.valueKey
    this._labelKey = opts.labelKey
    this._selectedValue = opts.selectedValue
    this._anchor = opts.anchor
    this._searchable = opts.searchable ?? false
    this._searchBehavior = opts.searchBehavior ?? 'internal'
    this._maxVisibleItems = opts.maxVisibleItems ?? 8
    this._onSelect = opts.onSelect
    this._onSearchTextChange = opts.onSearchTextChange
    this._onClose = opts.onClose
    this._searchText = ''
    this._keyboardIndex = this._selectedIndex()
    this._scrollOffset = 0
    this._grid = this._createEmbeddedGrid()
    this._grid.onRowClick = row => this._activateRow(row)
    this._grid.onRowActivate = row => this._activateRow(row)
    this._grid.onScrollChange = scrollY => this._syncScrollFromGrid(scrollY)
    this._gridSurface.setRoot(this._grid)
    this._scrollToKeyboard()
    this.openPopup({ owner: resolvePopupAnchorTarget(opts.anchor) })

    this._setSearchText(opts.searchText ?? '', { syncInput: false, emit: false })

    if (!this._searchable) {
      this.requestPopupPaint()
      return
    }

    this._searchInput.beginSession({
      value: this._searchText,
      placeholder: '搜索...',
      onInput: value => {
        if (!this._searchable) return
        this._setSearchText(value, { syncInput: false, emit: true })
      },
      onCompositionUpdate: () => {
        PopupManager.instance.requestPaint()
      },
      onCompositionEnd: value => {
        if (!this._searchable) return
        this._setSearchText(value, { syncInput: false, emit: true })
      },
      onKeyDown: e => {
        this._handleNavigationKey(e)
      },
    })

    this.requestPopupPaint()
  }

  setColumns(columns: Array<{ key: string; title: string; width?: number }>): void {
    if (columns === this._columns) return
    this._columns = columns
    if (this._searchBehavior === 'internal') this._applyFilterRows()
    else this._syncGrid()
    if (this.visible) this.requestPopupPaint()
  }

  setRows(rows: Array<Record<string, any>>): void {
    if (rows === this._rows) return
    this._rows = rows
    if (this._searchBehavior === 'external') {
      this._filteredRows = [...rows]
      this._syncGrid()
      this._setKeyboardIndex(this._selectedIndex(), { allowNone: true })
    } else {
      this._applyFilterRows()
    }
    if (this.visible) this.requestPopupPaint()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    return this._handleNavigationKey(event)
  }

  paint(context: PaintContext): void {
    if (!this.visible) return
    const layout = this._layout(PopupManager.instance.context)
    const dl = new DrawList(context)
    const px = layout.panelX
    const py = layout.panelY
    const pw = layout.panelW

    drawPopupPanel(dl, px, py, pw, layout.panelH, layout.popupStyle)

    let contentY = py + layout.popupStyle.padding
    if (this._searchable) {
      const sx = px + layout.popupStyle.padding
      const sw = pw - layout.popupStyle.padding * 2
      this._searchInput.paint(context, {
        x: sx,
        y: contentY,
        w: sw,
        h: layout.searchInputH,
      }, context.theme)
      contentY += layout.searchInputH + layout.popupStyle.padding
    }

    this._gridSurface.paint(context.setTheme(context.theme), PopupManager.instance.context)
    this._paintResizeGrip(dl, layout)
  }

  debugState(popupContext: PopupContext = PopupManager.instance.context): GridDropdownGridPopupDebugState {
    const layout = this._layout(popupContext)
    this._syncGridLayout(layout)
    const gridState = this._grid?.debugState()
    return {
      filteredRows: [...this._filteredRows],
      keyboardIndex: this._keyboardIndex,
      scrollOffset: this._scrollOffset,
      searchText: this._searchText,
      searchable: this._searchable,
      searchBehavior: this._searchBehavior,
      gridScrollY: gridState?.scrollY ?? 0,
      gridFocusedRow: gridState?.focusedRow ?? -1,
      gridSortState: gridState?.sortState ?? { key: '', order: null },
      selectedValue: this._selectedValue,
      panelX: layout.panelX,
      panelW: layout.panelW,
      panelH: layout.panelH,
      panelY: layout.panelY,
      anchorRect: { ...layout.anchorRect },
      resizeGripRect: { ...layout.resizeGripRect },
    }
  }

  dispose(): void {
    this.close()
    this._gridSurface.dispose()
    this._searchInput.dispose()
    this._disposables.dispose()
    this._onSelect = undefined
    this._onClose = undefined
  }

  protected override getResizablePanelLayout(
    popupContext: PopupContext = PopupManager.instance.context,
  ): PopupResizablePanelLayout {
    return this._layout(popupContext)
  }

  protected override getMinPanelWidth(layout: PopupResizablePanelLayout): number {
    const resolvedLayout = layout as DropdownGridPopupLayout
    const totalFixed = this._columns.reduce((sum, column) => sum + (column.width ?? 0), 0)
    const flexCount = this._columns.filter(column => !column.width).length
    const rowCount = Math.max(this._filteredRows.length, 1)
    const visibleCount = Math.max(1, Math.min(rowCount, this._maxVisibleItems))
    const verticalScrollbarW = rowCount > visibleCount ? deriveScrollbarStyle(resolvedLayout.theme).gutterSize : 0
    const minContentW = totalFixed +
      flexCount * DropdownGridPopup.MIN_FLEX_COL_WIDTH +
      verticalScrollbarW
    return Math.max(
      resolvedLayout.anchorRect.w,
      DropdownGridPopup.MIN_PANEL_WIDTH,
      minContentW + resolvedLayout.popupStyle.padding * 2,
    )
  }

  protected override getMinPanelHeight(layout: PopupResizablePanelLayout): number {
    const resolvedLayout = layout as DropdownGridPopupLayout
    return resolvedLayout.searchH +
      resolvedLayout.headerH +
      resolvedLayout.itemH +
      resolvedLayout.popupStyle.padding * 2
  }

  protected override onPanelResizeStart(
    event: PopupPointerEvent,
    popupContext: PopupContext,
    _layout: PopupResizablePanelLayout,
  ): void {
    this._gridSurface.handlePointerCancel({ ...event, type: 'cancel' }, popupContext)
  }

  protected override onPanelResizeGripHoverChanged(
    hovered: boolean,
    event: PopupPointerEvent,
    popupContext: PopupContext,
    _layout: PopupResizablePanelLayout,
  ): void {
    if (!hovered) return
    this._gridSurface.handlePointerCancel({ ...event, type: 'cancel' }, popupContext)
  }

  protected override onPanelPointerDown(
    event: PopupPointerEvent,
    popupContext: PopupContext,
    layout: PopupResizablePanelLayout,
  ): void {
    const resolvedLayout = layout as DropdownGridPopupLayout
    const point = event.position
    const searchY = resolvedLayout.panelY + resolvedLayout.popupStyle.padding
    const searchX = resolvedLayout.panelX + resolvedLayout.popupStyle.padding
    const searchW = resolvedLayout.panelW - resolvedLayout.popupStyle.padding * 2
    if (
      this._searchable &&
      this._searchInput.hitTest(point, { x: searchX, y: searchY, w: searchW, h: resolvedLayout.searchInputH })
    ) {
      this._gridSurface.handlePointerCancel({ ...event, type: 'cancel' }, popupContext)
      this._searchInput.handlePointerDown(point, {
        x: searchX,
        y: searchY,
        w: searchW,
        h: resolvedLayout.searchInputH,
      }, event.clickCount)
      return
    }
    const handled = this._gridSurface.handlePointerDown(event, popupContext)
    if (handled && this.visible && this._searchable) this._searchInput.focus()
  }

  protected override onPanelPointerMove(
    event: PopupPointerEvent,
    popupContext: PopupContext,
    _layout: PopupResizablePanelLayout,
  ): void {
    this._searchInput.handlePointerMove(event.position)
    this._gridSurface.handlePointerMove(event, popupContext)
  }

  protected override onPanelPointerUp(
    event: PopupPointerEvent,
    popupContext: PopupContext,
    _layout: PopupResizablePanelLayout,
  ): void {
    this._searchInput.handlePointerUp()
    this._gridSurface.handlePointerUp(event, popupContext)
  }

  protected override onPanelPointerCancel(
    event: PopupPointerEvent,
    popupContext: PopupContext,
    _layout: PopupResizablePanelLayout,
  ): void {
    this._searchInput.handlePointerCancel()
    this._gridSurface.handlePointerCancel(event, popupContext)
  }

  protected override onPanelWheel(
    event: PopupWheelPointerEvent,
    popupContext: PopupContext,
    _layout: PopupResizablePanelLayout,
  ): void {
    this._gridSurface.handleWheel(event, popupContext)
  }

  protected override onPopupClose(): void {
    super.onPopupClose()
    this._searchInput.endSession()
    this._onSearchTextChange = undefined
    this._searchBehavior = 'internal'
    this._onClose?.()
    this._gridSurface.setRoot(null)
    this._grid?.dispose()
    this._grid = null
  }

  private _syncGrid(colWidths?: number[]): void {
    if (!this._grid) return
    this._grid.columns = this._columns.map((col, index) => ({
      key: col.key,
      title: col.title,
      type: 'text',
      width: colWidths?.[index] ?? col.width,
      editable: false,
      sortable: false,
    }) as GridColumnDef<Record<string, any>>)
    this._grid.rows = this._filteredRows
  }

  private _syncGridLayout(layout: DropdownGridPopupLayout): void {
    if (!this._grid) return
    this._syncGrid(layout.colWidths)
    this._grid.rowHeight = layout.itemH
    this._grid.headerHeight = layout.headerH
    this._grid.offset = {
      x: layout.panelX + layout.popupStyle.padding,
      y: layout.panelY + layout.popupStyle.padding + layout.searchH,
    }
    this._grid.layout({
      minWidth: 0,
      maxWidth: layout.panelW - layout.popupStyle.padding * 2,
      minHeight: 0,
      maxHeight: layout.gridH,
    }, false, { theme: layout.theme })
    this._grid.focusRow(this._filteredRows[this._keyboardIndex] ?? null, { select: true, scroll: false })
  }

  private _layout(popupContext: PopupContext = PopupManager.instance.context): DropdownGridPopupLayout {
    const theme = popupContext.theme
    const popupStyle = derivePopupStyle(theme)
    const inputStyle = deriveTextInputStyle(theme)
    const gridStyle = deriveGridCellStyle(theme)
    const itemH = gridStyle.rowHeight
    const headerH = gridStyle.headerHeight
    const searchInputH = inputStyle.height
    const searchH = this._searchable ? searchInputH + popupStyle.padding : 0
    const anchorRect = resolvePopupAnchorRect(this._anchor as PopupAnchor<GridPopupAnchorData>)
    const totalFixed = this._columns.reduce((sum, column) => sum + (column.width ?? 0), 0)
    const flexCount = this._columns.filter(c => !c.width).length
    const rowCount = Math.max(this._filteredRows.length, 1)
    const naturalVisibleCount = Math.max(1, Math.min(rowCount, this._maxVisibleItems))
    const verticalScrollbarW = rowCount > naturalVisibleCount ? deriveScrollbarStyle(theme).gutterSize : 0
    const minContentW = totalFixed +
      flexCount * DropdownGridPopup.MIN_FLEX_COL_WIDTH +
      verticalScrollbarW
    const minPanelW = Math.max(
      anchorRect.w,
      DropdownGridPopup.MIN_PANEL_WIDTH,
      minContentW + popupStyle.padding * 2,
    )
    const requestedPanelW = this.panelWidthOverride ?? minPanelW
    const maxPanelW = Math.max(minPanelW, popupContext.viewport.width - 8)
    const panelW = Math.max(minPanelW, Math.min(requestedPanelW, maxPanelW))
    const contentW = Math.max(minContentW, panelW - popupStyle.padding * 2)
    const columnContentW = Math.max(totalFixed + flexCount * DropdownGridPopup.MIN_FLEX_COL_WIDTH, contentW - verticalScrollbarW)
    const flexW = flexCount > 0
      ? Math.max(DropdownGridPopup.MIN_FLEX_COL_WIDTH, (columnContentW - totalFixed) / flexCount)
      : 0
    const colWidths = this._columns.map(c => c.width ?? flexW)

    const minGridH = headerH + itemH
    const naturalGridH = headerH + naturalVisibleCount * itemH
    const minPanelH = searchH + minGridH + popupStyle.padding * 2
    const requestedPanelH = this.panelHeightOverride ?? (searchH + naturalGridH + popupStyle.padding * 2)
    const maxPanelH = Math.max(minPanelH, popupContext.viewport.height - 8)
    const panelH = Math.max(minPanelH, Math.min(requestedPanelH, maxPanelH))
    const gridH = Math.max(minGridH, panelH - searchH - popupStyle.padding * 2)

    let panelY = anchorRect.y + anchorRect.h + 2
    if (panelY + panelH > (popupContext.viewport.y ?? 0) + popupContext.viewport.height - 4) panelY = anchorRect.y - panelH - 4
    const panelRect = clampRectToPopupViewport({ x: anchorRect.x, y: panelY, width: panelW, height: panelH }, popupContext, 4)
    const panelX = panelRect.x
    panelY = panelRect.y

    return {
      anchorRect,
      theme,
      popupStyle,
      inputStyle,
      colWidths,
      panelW,
      panelH,
      panelX,
      panelY,
      itemH,
      headerH,
      searchInputH,
      searchH,
      gridH,
      resizeGripRect: this.createResizeGripRect(
        panelX,
        panelY,
        panelW,
        panelH,
        DropdownGridPopup.RESIZE_GRIP_SIZE,
      ),
    }
  }

  private _applyFilterRows(): void {
    const q = this._searchText.toLowerCase()
    this._filteredRows = q
      ? this._rows.filter(r =>
          this._columns.some(c => String(r[c.key] ?? '').toLowerCase().includes(q))
        )
      : [...this._rows]
    this._scrollOffset = 0
    this._setKeyboardIndex(this._selectedIndex(), { allowNone: true })
  }

  private _setSearchText(
    value: string,
    options: { syncInput: boolean; emit: boolean },
  ): void {
    const nextValue = String(value ?? '')
    const changed = nextValue !== this._searchText
    this._searchText = nextValue
    if (options.syncInput && this._searchInput.value !== nextValue) {
      this._searchInput.setValue(nextValue)
      this._searchInput.setSelection(nextValue.length, nextValue.length)
    }
    if (changed) {
      if (this._searchBehavior === 'internal') {
        this._applyFilterRows()
      }
      if (options.emit) this._onSearchTextChange?.(nextValue)
    }
    if (this.visible) this.requestPopupPaint()
  }

  private _handleNavigationKey(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    if (event.key === 'Tab') {
      this.close()
      return false
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
      return true
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this._setKeyboardIndex(this._keyboardIndex + 1)
      this.requestPopupPaint()
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      this._setKeyboardIndex(this._keyboardIndex - 1)
      this.requestPopupPaint()
      return true
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const row = this._filteredRows[this._keyboardIndex]
      if (row) this._select(row)
      return true
    }
    return false
  }

  private _selectedIndex(): number {
    return this._filteredRows.findIndex(r => String(r[this._valueKey] ?? '') === this._selectedValue)
  }

  private _setKeyboardIndex(index: number, opts: { allowNone?: boolean } = {}): void {
    if (this._filteredRows.length === 0 || (opts.allowNone && index < 0)) {
      this._keyboardIndex = -1
      this._scrollOffset = 0
      this._grid?.focusRow(null, { select: true, scroll: false })
      return
    }
    this._keyboardIndex = Math.max(0, Math.min(this._filteredRows.length - 1, Math.floor(index)))
    this._scrollToKeyboard()
  }

  private _scrollToKeyboard(): void {
    if (this._keyboardIndex < 0 || this._filteredRows.length === 0) {
      this._scrollOffset = 0
      this._grid?.focusRow(null, { select: true, scroll: false })
      return
    }
    const itemH = this._itemHeight()
    const visibleCount = Math.max(1, Math.min(this._filteredRows.length, this._maxVisibleItems))
    const scrollY = scrollToFixedIndex({
      itemCount: this._filteredRows.length,
      itemSize: itemH,
      viewportSize: visibleCount * itemH,
      currentOffset: this._scrollOffset * itemH,
      index: this._keyboardIndex,
      align: 'nearest',
    })
    const range = calcFixedVirtualRange({
      itemCount: this._filteredRows.length,
      itemSize: itemH,
      viewportSize: visibleCount * itemH,
      scrollOffset: scrollY,
      overscan: 0,
    })
    this._scrollOffset = Math.max(0, range.visibleStartIndex)
    this._grid?.focusRow(this._filteredRows[this._keyboardIndex] ?? null, { select: true })
  }

  private _syncScrollFromGrid(scrollY: number): void {
    const itemH = this._itemHeight()
    const range = calcFixedVirtualRange({
      itemCount: this._filteredRows.length,
      itemSize: itemH,
      viewportSize: Math.max(1, Math.min(this._filteredRows.length, this._maxVisibleItems)) * itemH,
      scrollOffset: scrollY,
      overscan: 0,
    })
    this._scrollOffset = Math.max(0, range.visibleStartIndex)
  }

  private _select(row: Record<string, any>): void {
    this._selectedValue = String(row[this._valueKey] ?? '')
    if (this._onSelect?.(this._selectedValue, row) === false) {
      PopupManager.instance.requestPaint()
      return
    }
    this.close()
  }

  private _activateRow(row: Record<string, any>): void {
    const index = this._filteredRows.indexOf(row)
    if (index >= 0) this._setKeyboardIndex(index)
    this._select(row)
  }

  private _itemHeight(theme: ResolvedTheme = PopupManager.instance.context.theme): number {
    return deriveTextInputStyle(theme).height
  }

  private _paintResizeGrip(dl: DrawList, layout: DropdownGridPopupLayout): void {
    const gripColor = resolveTextColor(
      deriveWindowChromeStyle(layout.theme).gripText,
      this.panelResizing ? 'pressed' : this.panelResizeGripHovered ? 'hovered' : 'normal',
    )
    const grip = layout.resizeGripRect
    const baseX = grip.x + grip.w - 2
    const baseY = grip.y + grip.h - 2
    const gap = 4
    const dotRadius = 1.5
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3 - i; j++) {
        dl.fillCircle(baseX - i * gap, baseY - j * gap, dotRadius, gripColor)
      }
    }
  }
}
