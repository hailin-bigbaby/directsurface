import {
  resolveScrollbarGeometryForState,
  type ScrollbarGeometry,
} from '../../rendering/scrollbar'
import { ScrollbarAxisController } from '../../gestures/scrollbar_interaction_controller'
import { constrainSize, type Offset, type BoxConstraints } from '../../core/render_object'
import type { ResolvedTheme } from '../../theme/theme'
import {
  deriveGridCellStyle,
  deriveScrollbarStyle,
  type GridFilterPopupStyleTokens,
  type GridHeaderActionStyleTokens,
  type ScrollbarStyleTokens,
} from '../../theme/component_styles'
import { calcFixedVirtualRange, scrollToFixedIndex } from '../../virtualization/fixed_virtual_range'
import { ScrollController } from '../../virtualization/scroll_controller'
import { ImGuiDarkTheme } from '../../theme/default_theme'
import { clampRectToPopupViewport, type PopupViewport } from '../../core/popup_manager'
import {
  gridHeaderActionRectContains,
  intersectGridHeaderActionRect,
  resolveGridHeaderActionLayout,
} from './grid_header_actions'
import type { GridColumnDef, GridGroupDef, GridSortState } from './grid_types'

export interface GridColumnSizingOptions<T extends Record<string, any> = any> {
  preferredWidth?: (column: GridColumnDef<T>, colIndex: number) => number
}

export const GRID_COLUMN_RESIZE_HANDLE_SIZE = 4

export class GridViewport<T extends Record<string, any> = any> {
  rowHeight: number
  headerHeight: number
  filterRowHeight: number
  footerHeight: number
  readonly vScrollbarController = new ScrollbarAxisController('vertical')
  readonly hScrollbarController = new ScrollbarAxisController('horizontal')
  readonly vScrollbar = this.vScrollbarController.state
  readonly hScrollbar = this.hScrollbarController.state

  resizingCol = -1
  resizeStartX = 0
  resizeStartW = 0
  resizeCurrentX = 0
  hoveredResizeCol = -1
  hoveredHeaderCol = -1
  hoveredFilterCol = -1

  draggingCol = -1
  dragColStartX = 0
  dropTargetCol = -1

  private readonly _scroll = new ScrollController()
  private _colWidths: number[] = []
  private _size = { width: 600, height: 400 }
  private _usesThemeRowHeight: boolean
  private _usesThemeHeaderHeight: boolean
  private _scrollbarWidth: number
  private _scrollbarStyle: ScrollbarStyleTokens
  private _reserveScrollbars: boolean
  private _lastColumns: GridColumnDef<T>[] = []
  private _lastVisibleRowCount = 0

  onScrollChange?: (scrollY: number) => void

  constructor(options: {
    rowHeight?: number
    headerHeight?: number
    filterRowHeight?: number
    reserveScrollbars?: boolean
    onScrollChange?: (scrollY: number) => void
    footerHeight?: number
  }) {
    const defaultStyle = deriveGridCellStyle(ImGuiDarkTheme)
    this._usesThemeRowHeight = options.rowHeight === undefined
    this._usesThemeHeaderHeight = options.headerHeight === undefined
    this.rowHeight = options.rowHeight ?? defaultStyle.rowHeight
    this.headerHeight = options.headerHeight ?? defaultStyle.headerHeight
    this._scrollbarStyle = deriveScrollbarStyle(ImGuiDarkTheme)
    this._scrollbarWidth = this._scrollbarStyle.gutterSize
    this.filterRowHeight = options.filterRowHeight ?? 0
    this.footerHeight = options.footerHeight ?? 0
    this._reserveScrollbars = options.reserveScrollbars ?? true
    this.onScrollChange = options.onScrollChange
  }

  get size(): { width: number; height: number } { return { ...this._size } }
  get colWidths(): number[] { return this._colWidths }
  get scrollX(): number { return this._scroll.scrollX }
  get scrollY(): number { return this._scroll.offset }
  get reserveScrollbars(): boolean { return this._reserveScrollbars }
  set reserveScrollbars(value: boolean) { this._reserveScrollbars = value }

  get viewWidth(): number {
    const reservation = this._effectiveScrollbarReservation()
    return Math.max(0, this._size.width - (reservation.vertical ? this.scrollbarWidth() : 0))
  }

  get viewHeight(): number {
    const reservation = this._effectiveScrollbarReservation()
    return Math.max(0, this._size.height - this.headerSectionHeight - this.footerHeight - (reservation.horizontal ? this.scrollbarWidth() : 0))
  }

  get headerSectionHeight(): number {
    return this.headerHeight + this.filterRowHeight
  }

  syncThemeMetrics(theme: ResolvedTheme): void {
    const tokens = deriveGridCellStyle(theme)
    if (this._usesThemeRowHeight) this.rowHeight = tokens.rowHeight
    if (this._usesThemeHeaderHeight) this.headerHeight = tokens.headerHeight
    this._scrollbarStyle = deriveScrollbarStyle(theme)
    this._scrollbarWidth = this._scrollbarStyle.gutterSize
  }

  setRowHeight(value: number): boolean {
    const next = Math.max(1, Number.isFinite(value) ? value : this.rowHeight)
    if (!this._usesThemeRowHeight && next === this.rowHeight) return false
    this._usesThemeRowHeight = false
    this.rowHeight = next
    return true
  }

  setHeaderHeight(value: number): boolean {
    const next = Math.max(1, Number.isFinite(value) ? value : this.headerHeight)
    if (!this._usesThemeHeaderHeight && next === this.headerHeight) return false
    this._usesThemeHeaderHeight = false
    this.headerHeight = next
    return true
  }

  performLayout(
    constraints: BoxConstraints,
    theme: ResolvedTheme,
    columns: GridColumnDef<T>[],
    sizing: GridColumnSizingOptions<T> = {},
  ): { width: number; height: number } {
    this.syncThemeMetrics(theme)
    this._size = constrainSize(constraints, {
      width: constraints.maxWidth === Infinity ? 600 : constraints.maxWidth,
      height: constraints.maxHeight === Infinity ? 400 : constraints.maxHeight,
    })
    this._lastColumns = columns
    this.initColumnWidths(columns, theme, sizing)
    return this._size
  }

  resetColumnWidths(): void {
    this._colWidths = []
  }

  initColumnWidths(
    columns: GridColumnDef<T>[],
    theme: ResolvedTheme,
    sizing: GridColumnSizingOptions<T> = {},
  ): void {
    const totalWidth = this._size.width - (this._reserveScrollbars ? this.scrollbarWidth() : 0)
    const fixed = columns.filter(column => column.width).reduce((sum, column) => sum + (column.width ?? 0), 0)
    const flexCount = columns.filter(column => !column.width).length
    const flexWidth = flexCount > 0 ? Math.max(60, (totalWidth - fixed) / flexCount) : 0
    const nextWidths = this._colWidths.length === columns.length
      ? [...this._colWidths]
      : columns.map(() => 0)
    const stretchColumns: number[] = []

    const preferredWidth = (column: GridColumnDef<T>, colIndex: number): number => {
      const measured = sizing.preferredWidth?.(column, colIndex)
      if (measured !== undefined && Number.isFinite(measured)) {
        return Math.max(this.columnMinWidth(column), measured)
      }
      return Math.max(this.columnMinWidth(column), column.width ?? flexWidth)
    }

    if (this._colWidths.length !== columns.length) {
      for (let index = 0; index < columns.length; index++) {
        const column = columns[index]!
        const mode = column.widthMode ?? 'interactive'
        if (mode === 'stretch') {
          stretchColumns.push(index)
          nextWidths[index] = this.columnMinWidth(column)
        } else if (mode === 'autoContent') {
          nextWidths[index] = preferredWidth(column, index)
        } else {
          nextWidths[index] = Math.max(this.columnMinWidth(column), column.width ?? flexWidth)
        }
      }
      this._colWidths = this.applyStretchColumnWidths(columns, nextWidths, stretchColumns, totalWidth)
      return
    }
    for (let index = 0; index < columns.length; index++) {
      const column = columns[index]!
      const mode = column.widthMode ?? 'interactive'
      if (mode === 'stretch') {
        stretchColumns.push(index)
        nextWidths[index] = Math.max(this.columnMinWidth(column), nextWidths[index] ?? column.width ?? flexWidth)
      } else if (mode === 'autoContent') {
        nextWidths[index] = preferredWidth(column, index)
      } else if (column.width !== undefined) {
        nextWidths[index] = Math.max(this.columnMinWidth(column), column.width)
      }
    }
    this._colWidths = this.applyStretchColumnWidths(columns, nextWidths, stretchColumns, totalWidth)
  }

  totalContentHeight(visibleRowCount: number): number {
    return visibleRowCount * this.rowHeight
  }

  totalContentWidth(): number {
    return this._colWidths.reduce((sum, width) => sum + width, 0)
  }

  fixedColumnCount(columns: GridColumnDef<T>[]): number {
    let count = 0
    while (count < columns.length && this.isLeftPinned(columns[count])) count++
    return count
  }

  rightFixedColumnCount(columns: GridColumnDef<T>[]): number {
    let count = 0
    let index = columns.length - 1
    while (index >= 0 && columns[index]?.pinned === 'right') {
      count++
      index--
    }
    return count
  }

  fixedContentWidth(columns: GridColumnDef<T>[]): number {
    let width = 0
    const fixedCount = this.fixedColumnCount(columns)
    for (let index = 0; index < fixedCount; index++) {
      width += this._colWidths[index] ?? 0
    }
    return width
  }

  fixedRegionWidth(columns: GridColumnDef<T>[]): number {
    return Math.min(this.fixedContentWidth(columns), this.viewWidth)
  }

  rightFixedContentWidth(columns: GridColumnDef<T>[]): number {
    let width = 0
    const rightCount = this.rightFixedColumnCount(columns)
    for (let index = columns.length - rightCount; index < columns.length; index++) {
      width += this._colWidths[index] ?? 0
    }
    return width
  }

  rightFixedRegionWidth(columns: GridColumnDef<T>[]): number {
    return Math.min(
      this.rightFixedContentWidth(columns),
      Math.max(0, this.viewWidth - this.fixedRegionWidth(columns)),
    )
  }

  scrollableContentWidth(columns: GridColumnDef<T>[]): number {
    return Math.max(0, this.totalContentWidth() - this.fixedContentWidth(columns) - this.rightFixedContentWidth(columns))
  }

  scrollableViewWidth(columns: GridColumnDef<T>[]): number {
    return Math.max(0, this.viewWidth - this.fixedRegionWidth(columns) - this.rightFixedRegionWidth(columns))
  }

  canScrollX(columns: GridColumnDef<T>[]): boolean {
    return this.scrollableContentWidth(columns) > this.scrollableViewWidth(columns)
  }

  canScrollY(visibleRowCount: number): boolean {
    return this.totalContentHeight(visibleRowCount) > this.viewHeight
  }

  isFixedColumn(columns: GridColumnDef<T>[], colIndex: number): boolean {
    return this.isLeftFixedColumn(columns, colIndex) || this.isRightFixedColumn(columns, colIndex)
  }

  isLeftFixedColumn(columns: GridColumnDef<T>[], colIndex: number): boolean {
    return colIndex >= 0 && colIndex < this.fixedColumnCount(columns)
  }

  isRightFixedColumn(columns: GridColumnDef<T>[], colIndex: number): boolean {
    return colIndex >= Math.max(0, columns.length - this.rightFixedColumnCount(columns)) &&
      colIndex < columns.length
  }

  colX(colIndex: number): number {
    let x = 0
    for (let index = 0; index < colIndex; index++) x += this._colWidths[index]!
    return x
  }

  columnRegion(
    columns: GridColumnDef<T>[],
    colIndex: number,
    originX: number,
  ): { x: number; w: number } {
    if (this.isLeftFixedColumn(columns, colIndex)) {
      return { x: originX, w: this.fixedRegionWidth(columns) }
    }
    if (this.isRightFixedColumn(columns, colIndex)) {
      const rightWidth = this.rightFixedRegionWidth(columns)
      return { x: originX + this.viewWidth - rightWidth, w: rightWidth }
    }
    return {
      x: originX + this.fixedRegionWidth(columns),
      w: this.scrollableViewWidth(columns),
    }
  }

  visibleCellRect(
    columns: GridColumnDef<T>[],
    originX: number,
    colIndex: number,
  ): { x: number; w: number } {
    const columnX = this.cellX(columns, originX, colIndex)
    const columnWidth = this._colWidths[colIndex] ?? 0
    const region = this.columnRegion(columns, colIndex, originX)
    const x = Math.max(region.x, columnX)
    const right = Math.min(columnX + columnWidth, region.x + region.w)
    return {
      x,
      w: Math.max(0, right - x),
    }
  }

  cellX(columns: GridColumnDef<T>[], originX: number, colIndex: number): number {
    if (this.isLeftFixedColumn(columns, colIndex)) return originX + this.colX(colIndex)
    if (this.isRightFixedColumn(columns, colIndex)) {
      const rightStart = columns.length - this.rightFixedColumnCount(columns)
      let localX = 0
      for (let index = rightStart; index < colIndex; index++) localX += this._colWidths[index] ?? 0
      return originX + this.viewWidth - this.rightFixedRegionWidth(columns) + localX
    }
    return (
      originX +
      this.fixedRegionWidth(columns) +
      (this.colX(colIndex) - this.fixedContentWidth(columns)) -
      this.scrollX
    )
  }

  cellGlobalRect(
    columns: GridColumnDef<T>[],
    globalOffset: Offset,
    rowIndex: number,
    colIndex: number,
  ): { x: number; y: number; w: number; h: number } {
    return {
      x: this.cellX(columns, globalOffset.x, colIndex),
      y: globalOffset.y + this.headerSectionHeight + rowIndex * this.rowHeight - this.scrollY,
      w: this._colWidths[colIndex] ?? 0,
      h: this.rowHeight,
    }
  }

  setScrollX(columns: GridColumnDef<T>[], scrollX: number): void {
    const viewportSize = this.scrollableViewWidth(columns)
    const contentSize = this.scrollableContentWidth(columns)
    if (viewportSize <= 0 || contentSize <= viewportSize) {
      this._scroll.setScrollX(0, { viewportSize: 0, contentSize: 0 })
      return
    }
    this._scroll.setScrollX(scrollX, { viewportSize, contentSize })
  }

  setScrollY(visibleRowCount: number, scrollY: number): void {
    this._lastVisibleRowCount = visibleRowCount
    const before = this.scrollY
    const next = this._scroll.setOffset(scrollY, {
      viewportSize: this.viewHeight,
      contentSize: this.totalContentHeight(visibleRowCount),
    })
    if (next !== before) this.onScrollChange?.(next)
  }

  clampScrollOffsets(columns: GridColumnDef<T>[], visibleRowCount: number): void {
    this._lastColumns = columns
    this._lastVisibleRowCount = visibleRowCount
    this.setScrollX(columns, this.scrollX)
    this.setScrollY(visibleRowCount, this.scrollY)
  }

  rowAtY(globalY: number, globalOffset: Offset, visibleRowCount: number): number {
    const bodyY = globalOffset.y + this.headerSectionHeight
    if (globalY < bodyY || globalY >= bodyY + this.viewHeight) return -1
    const relativeY = globalY - bodyY + this.scrollY
    const rowIndex = Math.floor(relativeY / this.rowHeight)
    return rowIndex < visibleRowCount ? rowIndex : -1
  }

  colAtX(globalX: number, globalOffset: Offset, columns: GridColumnDef<T>[]): number {
    if (globalX < globalOffset.x || globalX >= globalOffset.x + this.viewWidth) return -1

    const fixedCount = this.fixedColumnCount(columns)
    const fixedWidth = this.fixedRegionWidth(columns)
    if (globalX < globalOffset.x + fixedWidth) {
      let currentX = globalOffset.x
      for (let index = 0; index < fixedCount; index++) {
        currentX += this._colWidths[index]!
        if (globalX < currentX) return index
      }
      return fixedCount > 0 ? fixedCount - 1 : -1
    }

    const rightWidth = this.rightFixedRegionWidth(columns)
    const rightStartX = globalOffset.x + this.viewWidth - rightWidth
    if (rightWidth > 0 && globalX >= rightStartX) {
      let currentX = rightStartX
      const rightStart = columns.length - this.rightFixedColumnCount(columns)
      for (let index = rightStart; index < columns.length; index++) {
        currentX += this._colWidths[index]!
        if (globalX < currentX) return index
      }
      return columns.length - 1
    }

    let currentX = globalOffset.x + fixedWidth - this.scrollX
    const rightStart = columns.length - this.rightFixedColumnCount(columns)
    for (let index = fixedCount; index < rightStart; index++) {
      currentX += this._colWidths[index]!
      if (globalX < currentX) return index
    }
    return -1
  }

  inHeader(position: Offset, globalOffset: Offset): boolean {
    return (
      position.y >= globalOffset.y &&
      position.y <= globalOffset.y + this.headerHeight &&
      position.x >= globalOffset.x &&
      position.x <= globalOffset.x + this.viewWidth
    )
  }

  inFilterRow(position: Offset, globalOffset: Offset): boolean {
    return this.filterRowHeight > 0 &&
      position.y >= globalOffset.y + this.headerHeight &&
      position.y <= globalOffset.y + this.headerSectionHeight &&
      position.x >= globalOffset.x &&
      position.x <= globalOffset.x + this.viewWidth
  }

  filterRowColAt(position: Offset, globalOffset: Offset, columns: GridColumnDef<T>[]): number {
    if (!this.inFilterRow(position, globalOffset)) return -1
    return this.colAtX(position.x, globalOffset, columns)
  }

  filterIconAt(
    position: Offset,
    globalOffset: Offset,
    columns: GridColumnDef<T>[],
    options: {
      sortable: boolean
      sortState: GridSortState
      groupBy: GridGroupDef<T>[]
      paddingH: number
      fontSize: number
      metrics: GridHeaderActionStyleTokens
    },
  ): number {
    if (!this.inHeader(position, globalOffset)) return -1
    for (let index = 0; index < columns.length; index++) {
      const column = columns[index]
      if (!column?.filterable) continue
      const columnWidth = this._colWidths[index] ?? 0
      const columnX = this.cellX(columns, globalOffset.x, index)
      const groupIndex = options.groupBy.findIndex(group => group.key === column.key)
      const activeSort = options.sortState.key === column.key && !!options.sortState.order
      const layout = resolveGridHeaderActionLayout({
        columnX,
        columnWidth,
        headerY: globalOffset.y,
        headerHeight: this.headerHeight,
        paddingH: options.paddingH,
        fontSize: options.fontSize,
        metrics: options.metrics,
        showSort: groupIndex >= 0 || (!!column.sortable && (options.sortable || activeSort)),
        showFilter: true,
        groupIndex,
      })
      if (!layout.filterRect) continue
      const visibleCell = this.visibleCellRect(columns, globalOffset.x, index)
      const hitRect = intersectGridHeaderActionRect(layout.filterRect, {
        x: visibleCell.x,
        y: globalOffset.y,
        w: visibleCell.w,
        h: this.headerHeight,
      })
      if (hitRect && gridHeaderActionRectContains(hitRect, position)) return index
    }
    return -1
  }

  filterPopupLayout(
    columns: GridColumnDef<T>[],
    globalOffset: Offset,
    colIndex: number,
    viewport: PopupViewport,
    style: GridFilterPopupStyleTokens,
    preferredHeight: number,
    minimumHeight: number,
  ): { x: number; y: number; w: number; h: number } {
    const columnWidth = this._colWidths[colIndex] ?? 0
    const columnX = this.cellX(columns, globalOffset.x, colIndex)
    const viewportW = Math.max(0, viewport.width - style.viewportMargin * 2)
    const viewportH = Math.max(0, viewport.height - style.viewportMargin * 2)
    const popupW = Math.min(
      viewportW,
      Math.max(style.minWidth, Math.min(style.maxWidth, style.preferredWidth)),
    )
    const preferredPopupH = Math.min(
      viewportH,
      Math.max(style.minHeight, Math.min(style.maxHeight, preferredHeight)),
    )
    const popupX = columnX + columnWidth - popupW
    const viewportY = viewport.y ?? 0
    const viewportTop = viewportY + style.viewportMargin
    const viewportBottom = viewportY + viewport.height - style.viewportMargin
    const belowY = globalOffset.y + this.headerSectionHeight + style.anchorGap
    const aboveBottom = globalOffset.y - style.anchorGap
    const availableBelow = Math.max(0, viewportBottom - belowY)
    const availableAbove = Math.max(0, aboveBottom - viewportTop)
    const minimumUsableHeight = Math.min(minimumHeight, preferredPopupH)
    const placeBelow = availableBelow >= minimumUsableHeight || availableBelow >= availableAbove
    const popupH = Math.min(
      preferredPopupH,
      placeBelow ? availableBelow : availableAbove,
    )
    const popupY = placeBelow ? belowY : aboveBottom - popupH

    const popupRect = clampRectToPopupViewport(
      { x: popupX, y: popupY, width: popupW, height: popupH },
      viewport,
      style.viewportMargin,
    )

    return {
      x: popupRect.x,
      y: popupRect.y,
      w: popupW,
      h: popupH,
    }
  }

  inVScrollbar(position: Offset, globalOffset: Offset, visibleRowCount: number): boolean {
    const geometry = this.vScrollbarGeometry(globalOffset, visibleRowCount)
    return geometry.maxScroll > 0 && pointInRect(position, geometry.hitRect)
  }

  inHScrollbar(position: Offset, globalOffset: Offset, columns: GridColumnDef<T>[]): boolean {
    const geometry = this.hScrollbarGeometry(globalOffset, columns)
    return geometry.maxScroll > 0 && pointInRect(position, geometry.hitRect)
  }

  vScrollbarGeometry(globalOffset: Offset, visibleRowCount: number): ScrollbarGeometry {
    return resolveScrollbarGeometryForState({
      axis: 'vertical',
      trackRect: {
        x: globalOffset.x + this.viewWidth,
        y: globalOffset.y + this.headerSectionHeight,
        width: this.scrollbarWidth(),
        height: this.viewHeight,
      },
      viewportSize: this.viewHeight,
      contentSize: this.totalContentHeight(visibleRowCount),
      scrollOffset: this.scrollY,
      style: this._scrollbarStyle,
      state: this.vScrollbar,
    })
  }

  hScrollbarGeometry(globalOffset: Offset, columns: GridColumnDef<T>[]): ScrollbarGeometry {
    const scrollableViewWidth = this.scrollableViewWidth(columns)
    return resolveScrollbarGeometryForState({
      axis: 'horizontal',
      trackRect: {
        x: globalOffset.x + this.fixedRegionWidth(columns),
        y: globalOffset.y + this.headerSectionHeight + this.viewHeight + this.footerHeight,
        width: scrollableViewWidth,
        height: this.scrollbarWidth(),
      },
      viewportSize: scrollableViewWidth,
      contentSize: this.scrollableContentWidth(columns),
      scrollOffset: this.scrollX,
      style: this._scrollbarStyle,
      state: this.hScrollbar,
    })
  }

  resizeColAt(
    position: Offset,
    globalOffset: Offset,
    columns: GridColumnDef<T>[],
    resizableColumns: boolean,
  ): number {
    if (!resizableColumns) return -1
    if (!this.inHeader(position, globalOffset)) return -1
    for (let index = 0; index < columns.length; index++) {
      if ((columns[index]?.widthMode ?? 'interactive') === 'fixed') continue
      const separatorX = this.cellX(columns, globalOffset.x, index) + (this._colWidths[index] ?? 0)
      if (
        separatorX >= globalOffset.x &&
        separatorX <= globalOffset.x + this.viewWidth &&
        Math.abs(position.x - separatorX) <= GRID_COLUMN_RESIZE_HANDLE_SIZE
      ) {
        return index
      }
    }
    return -1
  }

  scrollToRow(visibleRowCount: number, rowIndex: number): void {
    this._lastVisibleRowCount = visibleRowCount
    this.setScrollY(
      visibleRowCount,
      scrollToFixedIndex({
        itemCount: visibleRowCount,
        itemSize: this.rowHeight,
        viewportSize: this.viewHeight,
        currentOffset: this.scrollY,
        index: rowIndex,
        align: 'nearest',
      }),
    )
  }

  scrollToColumn(columns: GridColumnDef<T>[], colIndex: number): boolean {
    if (colIndex < 0 || colIndex >= columns.length) return false
    if (this.isFixedColumn(columns, colIndex)) return false

    const viewportSize = this.scrollableViewWidth(columns)
    const columnWidth = this._colWidths[colIndex] ?? 0
    if (viewportSize <= 0 || columnWidth <= 0) return false

    const itemStart = this.colX(colIndex) - this.fixedContentWidth(columns)
    const itemEnd = itemStart + columnWidth
    const viewportStart = this.scrollX
    const viewportEnd = viewportStart + viewportSize
    let nextScrollX = viewportStart

    if (columnWidth > viewportSize) {
      if (itemEnd <= viewportStart) nextScrollX = itemEnd - viewportSize
      else if (itemStart >= viewportEnd) nextScrollX = itemStart
      else return false
    } else if (itemStart < viewportStart) {
      nextScrollX = itemStart
    } else if (itemEnd > viewportEnd) {
      nextScrollX = itemEnd - viewportSize
    } else {
      return false
    }

    this.setScrollX(columns, nextScrollX)
    return this.scrollX !== viewportStart
  }

  scrollToColumnPoint(
    columns: GridColumnDef<T>[],
    colIndex: number,
    columnOffsetX: number,
    insets: { start: number; end: number } = { start: 0, end: 0 },
  ): boolean {
    if (colIndex < 0 || colIndex >= columns.length) return false
    if (this.isFixedColumn(columns, colIndex)) return false

    const viewportSize = this.scrollableViewWidth(columns)
    const columnWidth = this._colWidths[colIndex] ?? 0
    if (viewportSize <= 0 || columnWidth <= 0) return false

    const startInset = Math.max(0, Math.min(viewportSize, insets.start))
    const endInset = Math.max(0, Math.min(viewportSize - startInset, insets.end))
    const pointOffsetX = Math.max(0, Math.min(columnWidth, columnOffsetX))
    const pointX = this.colX(colIndex) - this.fixedContentWidth(columns) + pointOffsetX
    const viewportStart = this.scrollX
    const visibleStart = viewportStart + startInset
    const visibleEnd = viewportStart + viewportSize - endInset
    let nextScrollX = viewportStart

    if (pointX < visibleStart) nextScrollX = pointX - startInset
    else if (pointX > visibleEnd) nextScrollX = pointX - viewportSize + endInset
    else return false

    this.setScrollX(columns, nextScrollX)
    return this.scrollX !== viewportStart
  }

  visibleVirtualRange(visibleRowCount: number) {
    this._lastVisibleRowCount = visibleRowCount
    return calcFixedVirtualRange({
      itemCount: visibleRowCount,
      itemSize: this.rowHeight,
      viewportSize: this.viewHeight,
      scrollOffset: this.scrollY,
      overscan: 1,
    })
  }

  normalizeColumnMoveTarget(
    columns: GridColumnDef<T>[],
    fromIndex: number,
    toIndex: number,
  ): number {
    if (fromIndex < 0 || fromIndex >= columns.length) return -1
    if (toIndex < 0 || toIndex >= columns.length) return -1
    const leftCount = this.fixedColumnCount(columns)
    const rightStart = columns.length - this.rightFixedColumnCount(columns)
    if (this.isLeftFixedColumn(columns, fromIndex)) return -1
    if (this.isRightFixedColumn(columns, fromIndex)) return -1
    return Math.max(leftCount, Math.min(Math.max(leftCount, rightStart - 1), toIndex))
  }

  scrollbarWidth(theme?: ResolvedTheme): number {
    return theme ? deriveScrollbarStyle(theme).gutterSize : this._scrollbarWidth
  }

  private _effectiveScrollbarReservation(
    columns: GridColumnDef<T>[] = this._lastColumns,
    visibleRowCount = this._lastVisibleRowCount,
  ): { vertical: boolean; horizontal: boolean } {
    if (this._reserveScrollbars) return { vertical: true, horizontal: true }
    const scrollbarWidth = this.scrollbarWidth()
    let vertical = false
    let horizontal = false
    for (let index = 0; index < 3; index++) {
      const viewWidth = Math.max(0, this._size.width - (vertical ? scrollbarWidth : 0))
      const viewHeight = Math.max(0, this._size.height - this.headerSectionHeight - this.footerHeight - (horizontal ? scrollbarWidth : 0))
      const nextHorizontal = this.totalContentWidth() > viewWidth
      const nextVertical = this.totalContentHeight(visibleRowCount) > viewHeight
      if (nextVertical === vertical && nextHorizontal === horizontal) break
      vertical = nextVertical
      horizontal = nextHorizontal
    }
    if (columns.length === 0 && this.totalContentWidth() === 0) horizontal = false
    return { vertical, horizontal }
  }

  private isLeftPinned(column: GridColumnDef<T> | undefined): boolean {
    return column?.fixed === true || column?.pinned === 'left'
  }

  private columnMinWidth(column: GridColumnDef<T>): number {
    return column.minWidth ?? (column.type === 'checkbox' ? 52 : 40)
  }

  private applyStretchColumnWidths(
    columns: GridColumnDef<T>[],
    widths: number[],
    stretchColumns: number[],
    totalWidth: number,
  ): number[] {
    if (stretchColumns.length === 0) return widths
    const stretchSet = new Set(stretchColumns)
    const nonStretchWidth = widths.reduce((sum, width, index) =>
      stretchSet.has(index) ? sum : sum + width, 0)
    const remaining = Math.max(0, totalWidth - nonStretchWidth)
    const perColumn = remaining / stretchColumns.length
    for (const index of stretchColumns) {
      const column = columns[index]
      if (!column) continue
      widths[index] = Math.max(this.columnMinWidth(column), column.width ?? 0, perColumn)
    }
    return widths
  }
}

function pointInRect(point: Offset, rect: { x: number; y: number; width: number; height: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width &&
    point.y >= rect.y && point.y <= rect.y + rect.height
}
