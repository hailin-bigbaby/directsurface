// Table: 虚拟滚动表格
// 只渲染可见行，支持列排序、行选中、行 hover

import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { hitTestScrollbarGeometry, paintHBar, paintVBar, resolveScrollbarGeometryForState, type ScrollbarGeometry } from '../rendering/scrollbar'
import { paintSingleLineText } from '../rendering/text_painter'
import {
  deriveScrollbarStyle,
  deriveTableRowStyle,
  resolveBgColor,
  resolveTextColor,
  type TableRowStyleTokens,
  type ScrollbarStyleTokens,
} from '../theme/component_styles'
import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import type { ResolvedTheme, Color } from '../theme/theme'
import type { PointerEvent, WheelPointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { pointerKey } from '../gestures/pointer_identity'
import { ScrollbarAxisController } from '../gestures/scrollbar_interaction_controller'
import { calcFixedVirtualRange } from '../virtualization/fixed_virtual_range'
import { ScrollController } from '../virtualization/scroll_controller'
import { FocusManager } from '../core/focus_manager'
import { TextMeasurer } from '../core/text_measurer'
import { ellipsizeText } from '../core/text_overflow'
import type { Focusable } from '../core/focus_manager'
import { SelectionController } from '../core/selection_controller'
import { ImGuiDarkTheme } from '../theme/default_theme'
import type { GridCellTextOverflow } from './grid/grid_types'

export interface TableColumn<T = any> {
  key: string
  title: string
  width?: number          // 固定宽度，不设则平均分配
  minWidth?: number
  align?: 'left' | 'center' | 'right'
  cellTextOverflow?: GridCellTextOverflow
  sortable?: boolean
  render?: (value: any, row: T, rowIndex: number) => string  // 自定义渲染文字
  renderColor?: (value: any, row: T, context: TableCellColorContext) => Color
}

export interface TableCellColorContext {
  theme: ResolvedTheme
  backgroundColor: Color
  rowIndex: number
  columnKey: string
  columnIndex: number
  selected: boolean
  hovered: boolean
  focused: boolean
}

export type SortOrder = 'asc' | 'desc' | null
export type TableSortOrder = SortOrder

export interface TableSortState {
  key: string
  order: TableSortOrder
}

export class RenderTable<T extends Record<string, any> = any> extends RenderBox implements InteractiveRenderObject, Focusable {
  rowHeight: number
  headerHeight: number
  selectedRows: Set<number>
  onRowClick?: (row: T, index: number) => void
  onSortChange?: (sort: TableSortState) => void

  private _columns: TableColumn<T>[]
  private _rows: T[]
  private _scroll = new ScrollController()
  private _hoveredRow = -1
  private _focusedRow = -1       // 键盘焦点行
  private _rowSelection = new SelectionController()
  private _sortState: TableSortState = { key: '', order: null }
  private readonly _vScrollbarController = new ScrollbarAxisController('vertical')
  private readonly _hScrollbarController = new ScrollbarAxisController('horizontal')
  private readonly _vScrollbar = this._vScrollbarController.state
  private readonly _hScrollbar = this._hScrollbarController.state
  private _colWidthsState: number[] = []
  private _resizingCol = -1
  private _resizeStartX = 0
  private _resizeStartW = 0
  private _resizeCurrentX = 0
  private _usesThemeRowHeight: boolean
  private _usesThemeHeaderHeight: boolean
  private _cellTextOverflow: GridCellTextOverflow

  constructor(opts: RenderBoxOptions & {
    columns: TableColumn<T>[]
    rows: T[]
    rowHeight?: number
    headerHeight?: number
    cellTextOverflow?: GridCellTextOverflow
    onRowClick?: (row: T, index: number) => void
    onSortChange?: (sort: TableSortState) => void
  }) {
    super(opts)
    this._columns = opts.columns
    this._rows = opts.rows
    this._usesThemeRowHeight = opts.rowHeight === undefined
    this._usesThemeHeaderHeight = opts.headerHeight === undefined
    const _defaultRowStyle = deriveTableRowStyle(ImGuiDarkTheme)
    this.rowHeight = opts.rowHeight ?? _defaultRowStyle.rowHeight
    this.headerHeight = opts.headerHeight ?? _defaultRowStyle.headerHeight
    this._cellTextOverflow = opts.cellTextOverflow ?? 'ellipsis'
    this.onRowClick = opts.onRowClick
    this.onSortChange = opts.onSortChange
    this.selectedRows = this._rowSelection.selectedItems
    FocusManager.instance.register(this)
  }

  get columns(): TableColumn<T>[] { return this._columns }
  set columns(columns: TableColumn<T>[]) {
    if (columns === this._columns) return
    this._columns = columns
    this._colWidthsState = []
    this._resizingCol = -1
    this._syncDataState()
    this.markNeedsPaint()
  }

  get rows(): T[] { return this._rows }
  set rows(rows: T[]) {
    if (rows === this._rows) return
    this._rows = rows
    this._syncDataState()
    this.markNeedsPaint()
  }

  get sortState(): TableSortState { return { ...this._sortState } }
  set sortState(sortState: TableSortState) {
    const normalized = this._normalizeSortState(sortState)
    if (normalized.key === this._sortState.key && normalized.order === this._sortState.order) return
    this._sortState = normalized
    this._syncDataState()
    this.markNeedsPaint()
  }

  get cellTextOverflow(): GridCellTextOverflow { return this._cellTextOverflow }
  set cellTextOverflow(value: GridCellTextOverflow) {
    const next = value === 'clip' ? 'clip' : 'ellipsis'
    if (next === this._cellTextOverflow) return
    this._cellTextOverflow = next
    this.markNeedsPaint()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  debugState(): {
    scrollX: number
    scrollY: number
    hoveredRow: number
    focusedRow: number
    sortState: TableSortState
    rowHeight: number
    headerHeight: number
    colWidths: number[]
  } {
    return {
      scrollX: this._scrollX,
      scrollY: this._scrollY,
      hoveredRow: this._hoveredRow,
      focusedRow: this._focusedRow,
      sortState: { ...this._sortState },
      rowHeight: this.rowHeight,
      headerHeight: this.headerHeight,
      colWidths: [...this._colWidths()],
    }
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    this._syncThemeMetrics(context.theme)
    this.size = constrainSize(constraints, {
      width: constraints.maxWidth === Infinity ? 400 : constraints.maxWidth,
      height: constraints.maxHeight === Infinity ? 300 : constraints.maxHeight,
    })
    if (context.pass === 'measure') return
    this._ensureColumnWidths()
    this._clampState()
  }

  // 计算每列实际宽度
  private _colWidths(): number[] {
    this._ensureColumnWidths()
    return this._colWidthsState
  }

  private _ensureColumnWidths(): void {
    if (this._colWidthsState.length === this.columns.length) return
    const scrollbarW = this._scrollbarWidth()
    const totalW = Math.max(0, this.size.width - scrollbarW)
    const fixed = this.columns.filter(c => c.width).reduce((s, c) => s + c.width!, 0)
    const flexCount = this.columns.filter(c => !c.width).length
    const flexW = flexCount > 0 ? Math.max(60, (totalW - fixed) / flexCount) : 0
    this._colWidthsState = this.columns.map(column => column.width ?? flexW)
  }

  private _visibleRows(): T[] {
    const { key, order } = this._sortState
    if (!key || !order) return this.rows

    return this.rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const cmp = this._compareValues(a.row[key], b.row[key])
        return cmp === 0 ? a.index - b.index : order === 'asc' ? cmp : -cmp
      })
      .map(item => item.row)
  }

  private _compareValues(a: unknown, b: unknown): number {
    if (a == null && b == null) return 0
    if (a == null) return -1
    if (b == null) return 1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
  }

  // 总内容高度
  private get _totalContentH(): number {
    return this._visibleRows().length * this.rowHeight
  }

  private get _totalContentW(): number {
    return this._colWidths().reduce((sum, width) => sum + width, 0)
  }

  private get _viewW(): number {
    return this.size.width - this._scrollbarWidth()
  }

  // 可视区域高度（减去表头和滚动条）
  private get _viewH(): number {
    return this.size.height - this.headerHeight - this._scrollbarWidth()
  }

  private get _scrollX(): number {
    return this._scroll.scrollX
  }

  private get _scrollY(): number {
    return this._scroll.offset
  }

  private _clampState(): void {
    this._scroll.setScrollX(this._scrollX, { viewportSize: this._viewW, contentSize: this._totalContentW })
    this._scroll.setOffset(this._scrollY, { viewportSize: this._viewH, contentSize: this._totalContentH })
    const rowCount = this._visibleRows().length
    if (this._hoveredRow >= rowCount) this._hoveredRow = -1
    if (this._focusedRow >= rowCount) this._focusedRow = rowCount - 1
    this._rowSelection.clampDiscrete(rowCount)
    if (this._focusedRow < 0 && this._rowSelection.focus !== null) this._focusedRow = this._rowSelection.focus
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w, height: h } = this.size
    const s = this._rowTokens(context.theme)
    const sb = this._scrollbarTokens(context.theme)
    const colWidths = this._colWidths()
    const scrollbarW = sb.gutterSize
    const viewW = this._viewW
    const bodyY = y + this.headerHeight
    const bodyH = this._viewH

    dl.fillRect(x, y, w, h, s.normalBg, s.frameRounding)
    dl.strokeRect(x, y, w, h, s.windowBorder, 1, s.frameRounding)

    dl.fillRect(x, y, viewW, this.headerHeight, resolveBgColor(s.headerBgState, 'normal'), 0)
    let colX = x - this._scrollX
    for (let ci = 0; ci < this.columns.length; ci++) {
      const col = this.columns[ci]!
      const cw = colWidths[ci]!
      const cellX = colX
      const isSortedColumn = this._sortState.key === col.key && !!this._sortState.order
      const headerState = isSortedColumn ? 'selected' : 'normal'

      if (cellX + cw > x && cellX < x + viewW) {
        const clipX = Math.max(x, cellX)
        const clipW = Math.max(0, Math.min(cellX + cw, x + viewW) - clipX)
        dl.strokeRect(clipX, y, clipW, this.headerHeight, s.cellSeparatorColor, 0.5, 0)
        dl.pushClip(clipX, y, clipW, this.headerHeight)

        if (isSortedColumn) {
          dl.fillRect(clipX, y, clipW, this.headerHeight, resolveBgColor(s.headerBgState, headerState), 0)
        }

        const textRightInset = col.sortable ? s.cellPaddingH + 18 : s.cellPaddingH
        const textClipW = Math.max(0, cw - s.cellPaddingH - textRightInset)
        if (textClipW > 0) {
          paintSingleLineText(dl, {
            text: col.title,
            x: cellX + s.cellPaddingH,
            y: y + this.headerHeight / 2,
            maxWidth: textClipW,
            color: resolveTextColor(s.headerTextState, headerState),
            fontSize: s.fontSize,
            fontFamily: s.fontFamily,
          })
        }

        if (col.sortable) {
          const arrowX = cellX + cw - s.cellPaddingH - 8
          const arrowY = y + this.headerHeight / 2
          const arrowColor = resolveTextColor(s.headerArrowText, isSortedColumn ? 'selected' : 'normal')
          if (this._sortState.key === col.key && this._sortState.order === 'asc') {
            this._drawArrow(dl, arrowX, arrowY, 'up', arrowColor)
          } else if (this._sortState.key === col.key && this._sortState.order === 'desc') {
            this._drawArrow(dl, arrowX, arrowY, 'down', arrowColor)
          } else {
            this._drawArrow(dl, arrowX, arrowY - 3, 'up', arrowColor)
            this._drawArrow(dl, arrowX, arrowY + 3, 'down', arrowColor)
          }
        }

        dl.popClip()

        if (this._resizingCol === ci) {
          const guideX = this._resizeCurrentX || cellX + cw
          const separatorX = Math.max(x, Math.min(x + viewW, guideX))
          dl.line(separatorX, y, separatorX, y + this.headerHeight, s.focusedBorder, 2)
        }
      }
      colX += cw
    }

    dl.line(x, y + this.headerHeight, x + viewW, y + this.headerHeight, s.rowSeparatorColor, 0.5)

    const visibleRows = this._visibleRows()
    dl.pushClip(x, bodyY, viewW, bodyH)
    const virtualRange = calcFixedVirtualRange({
      itemCount: visibleRows.length,
      itemSize: this.rowHeight,
      viewportSize: bodyH,
      scrollOffset: this._scrollY,
      overscan: 1,
    })

    if (virtualRange.startIndex >= 0) {
      for (let ri = virtualRange.startIndex; ri <= virtualRange.endIndex; ri++) {
        const row = visibleRows[ri]!
        const rowY = bodyY + ri * this.rowHeight - this._scrollY
        const isSelected = this.selectedRows.has(ri)
        const isHovered = this._hoveredRow === ri
        const rowState = { selected: isSelected, hovered: isHovered }
        let rowBg: Color | null = isSelected || isHovered
          ? resolveBgColor(s.rowBgState, rowState)
          : null
        if (rowBg === null && ri % 2 === 1) rowBg = s.stripeBg

        if (rowBg) dl.fillRect(x, rowY, viewW, this.rowHeight, rowBg, 0)
        if (this._focusedRow === ri) {
          dl.strokeRect(x + 1, rowY + 1, viewW - 2, this.rowHeight - 2, resolveBgColor(s.rowBorderState, 'focused'), 1, 0)
        }

        let cellX = x - this._scrollX
        for (let ci = 0; ci < this.columns.length; ci++) {
          const col = this.columns[ci]!
          const cw = colWidths[ci]!

          if (cellX + cw > x && cellX < x + viewW) {
            const clipX = Math.max(x, cellX)
            const clipW = Math.max(0, Math.min(cellX + cw, x + viewW) - clipX)
            dl.strokeRect(clipX, rowY, clipW, this.rowHeight, s.cellSeparatorColor, 0.5, 0)
            const contentX = clipX + 1
            const contentW = Math.max(0, clipW - 2)
            dl.pushClip(contentX, rowY, contentW, this.rowHeight)

            const rawVal = row[col.key]
            const text = col.render ? col.render(rawVal, row, ri) : String(rawVal ?? '')
            const color = col.renderColor
              ? col.renderColor(rawVal, row, {
                theme: context.theme,
                backgroundColor: rowBg ?? s.normalBg,
                rowIndex: ri,
                columnKey: col.key,
                columnIndex: ci,
                selected: isSelected,
                hovered: isHovered,
                focused: this._focusedRow === ri,
              })
              : resolveTextColor(s.rowTextState, rowState)

            const align = col.align ?? 'left'
            let textX = cellX + s.cellPaddingH
            if (align === 'center') textX = cellX + cw / 2
            else if (align === 'right') textX = cellX + cw - s.cellPaddingH

            const paintText = this._resolvePaintText(
              text,
              col.cellTextOverflow ?? this._cellTextOverflow,
              Math.max(0, cw - s.cellPaddingH * 2),
              s.fontSize,
              s.fontFamily,
            )
            dl.fillText(paintText, textX, rowY + this.rowHeight / 2, color, s.fontSize, s.fontFamily, align, 'middle')
            dl.popClip()
          }
          cellX += cw
        }

        dl.line(x, rowY + this.rowHeight, x + viewW, rowY + this.rowHeight, s.rowSeparatorColor, 0.5)
      }
    }

    dl.popClip()
    paintVBar({
      dl,
      style: sb,
      trackX: x + viewW,
      trackY: bodyY,
      trackW: scrollbarW,
      trackH: bodyH,
      viewSize: this._viewH,
      contentSize: this._totalContentH,
      scrollOffset: this._scrollY,
      state: this._vScrollbar,
    })
    paintHBar({
      dl,
      style: sb,
      trackX: x,
      trackY: bodyY + bodyH,
      trackW: viewW,
      trackH: scrollbarW,
      viewSize: this._viewW,
      contentSize: this._totalContentW,
      scrollOffset: this._scrollX,
      state: this._hScrollbar,
    })
  }

  private _drawArrow(dl: DrawList, x: number, y: number, dir: 'up' | 'down', color: Color): void {
    const ctx = (dl as any).ctx as CanvasRenderingContext2D
    ctx.save()
    ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a})`
    ctx.beginPath()
    if (dir === 'up') {
      ctx.moveTo(x, y - 3)
      ctx.lineTo(x - 4, y + 2)
      ctx.lineTo(x + 4, y + 2)
    } else {
      ctx.moveTo(x, y + 3)
      ctx.lineTo(x - 4, y - 2)
      ctx.lineTo(x + 4, y - 2)
    }
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // ---- 交互 ----

  private _rowAtPoint(point: Offset): number {
    const g = this.globalOffset
    const bodyY = g.y + this.headerHeight
    if (
      point.x < g.x ||
      point.x >= g.x + this._viewW ||
      point.y < bodyY ||
      point.y >= bodyY + this._viewH
    ) return -1
    const relY = point.y - bodyY + this._scrollY
    if (relY < 0) return -1
    const ri = Math.floor(relY / this.rowHeight)
    return ri < this._visibleRows().length ? ri : -1
  }

  private _inVScrollbar(p: Offset): boolean {
    return hitTestScrollbarGeometry(p, this._vScrollbarGeometry())
  }

  private _vScrollbarGeometry(): ScrollbarGeometry {
    const g = this.globalOffset
    const scrollbarW = this._scrollbarWidth()
    return resolveScrollbarGeometryForState({
      axis: 'vertical',
      trackRect: { x: g.x + this._viewW, y: g.y + this.headerHeight, width: scrollbarW, height: this._viewH },
      viewportSize: this._viewH,
      contentSize: this._totalContentH,
      scrollOffset: this._scrollY,
      style: deriveScrollbarStyle(this.currentTheme),
      state: this._vScrollbar,
    })
  }

  private _inHScrollbar(p: Offset): boolean {
    return hitTestScrollbarGeometry(p, this._hScrollbarGeometry())
  }

  private _hScrollbarGeometry(): ScrollbarGeometry {
    const g = this.globalOffset
    const scrollbarW = this._scrollbarWidth()
    return resolveScrollbarGeometryForState({
      axis: 'horizontal',
      trackRect: { x: g.x, y: g.y + this.headerHeight + this._viewH, width: this._viewW, height: scrollbarW },
      viewportSize: this._viewW,
      contentSize: this._totalContentW,
      scrollOffset: this._scrollX,
      style: deriveScrollbarStyle(this.currentTheme),
      state: this._hScrollbar,
    })
  }

  private _inHeader(p: Offset): boolean {
    const g = this.globalOffset
    return p.y >= g.y && p.y <= g.y + this.headerHeight &&
           p.x >= g.x && p.x <= g.x + this._viewW
  }

  private _resizeColAt(p: Offset): number {
    if (!this._inHeader(p)) return -1
    const g = this.globalOffset
    const threshold = 4
    const colWidths = this._colWidths()
    let separatorX = g.x - this._scrollX
    for (let index = 0; index < this.columns.length; index++) {
      separatorX += colWidths[index]!
      if (
        separatorX >= g.x &&
        separatorX <= g.x + this._viewW &&
        Math.abs(p.x - separatorX) <= threshold
      ) return index
    }
    return -1
  }

  private _colAtX(globalX: number): number {
    const g = this.globalOffset
    if (globalX >= g.x + this._viewW) return -1
    const colWidths = this._colWidths()
    let cx = g.x - this._scrollX
    for (let i = 0; i < this.columns.length; i++) {
      cx += colWidths[i]!
      if (globalX < cx) return i
    }
    return -1
  }

  private _cellText(row: T, rowIndex: number, column: TableColumn<T>): string {
    const rawVal = row[column.key]
    return column.render ? column.render(rawVal, row, rowIndex) : String(rawVal ?? '')
  }

  private _resolvePaintText(
    text: string,
    overflow: GridCellTextOverflow,
    maxWidth: number,
    fontSize: number,
    fontFamily: string,
  ): string {
    if (overflow !== 'ellipsis') return text
    return ellipsizeText(text, maxWidth, value => TextMeasurer.measureWidth(value, fontSize, fontFamily))
  }

  private _syncOverflowTooltip(position: Offset): void {
    this.tooltip = undefined
    const rowIndex = this._rowAtPoint(position)
    if (rowIndex < 0) return
    const colIndex = this._colAtX(position.x)
    const column = this.columns[colIndex]
    const row = this._visibleRows()[rowIndex]
    if (!column || !row) return

    const text = this._cellText(row, rowIndex, column)
    if (!text) return

    const s = this._rowTokens(this.currentTheme)
    const columnWidth = this._colWidths()[colIndex] ?? column.width ?? 0
    const availableWidth = Math.max(0, columnWidth - s.cellPaddingH * 2)
    if (TextMeasurer.measureWidth(text, s.fontSize, s.fontFamily) > availableWidth) {
      this.tooltip = text
    }
  }

  private _captureDrag(event: PointerEvent): void {
    event.stopPropagation?.()
    event.setPointerCapture?.()
  }

  private _hasCapturedDrag(): boolean {
    return this._resizingCol >= 0 || this._vScrollbar.dragging || this._hScrollbar.dragging
  }

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (!this.hitTest(e.position)) {
      FocusManager.instance.clearFocus()
      this._focusedRow = -1
      return
    }

    const key = pointerKey(e)
    const verticalResult = this._vScrollbarController.beginPointer(
      e.position,
      this._vScrollbarGeometry(),
      key,
    )
    if (verticalResult.handled) {
      e.stopPropagation?.()
      e.preventActivation?.()
      if (verticalResult.capturePointer) e.setPointerCapture?.()
      if (verticalResult.scrollOffset !== undefined) {
        this._scroll.setOffset(verticalResult.scrollOffset, {
          viewportSize: this._viewH,
          contentSize: this._totalContentH,
        })
      }
      this.markNeedsPaint()
      return
    }

    const horizontalResult = this._hScrollbarController.beginPointer(
      e.position,
      this._hScrollbarGeometry(),
      key,
    )
    if (horizontalResult.handled) {
      e.stopPropagation?.()
      e.preventActivation?.()
      if (horizontalResult.capturePointer) e.setPointerCapture?.()
      if (horizontalResult.scrollOffset !== undefined) {
        this._scroll.setScrollX(horizontalResult.scrollOffset, {
          viewportSize: this._viewW,
          contentSize: this._totalContentW,
        })
      }
      this.markNeedsPaint()
      return
    }

    const resizeCol = this._resizeColAt(e.position)
    if (resizeCol >= 0) {
      this._captureDrag(e)
      this._resizingCol = resizeCol
      this._resizeStartX = e.position.x
      this._resizeStartW = this._colWidths()[resizeCol]!
      this._resizeCurrentX = e.position.x
      return
    }

    if (this._inHeader(e.position)) {
      const ci = this._colAtX(e.position.x)
      if (ci >= 0 && this.columns[ci]?.sortable) {
        const col = this.columns[ci]!
        if (this._sortState.key === col.key) {
          this._sortState.order = this._sortState.order === 'asc' ? 'desc' : this._sortState.order === 'desc' ? null : 'asc'
        } else {
          this._sortState = { key: col.key, order: 'asc' }
        }
        this._clampState()
        this.onSortChange?.({ ...this._sortState })
        this.markNeedsPaint()
      }
      return
    }

    const ri = this._rowAtPoint(e.position)
    const visibleRows = this._visibleRows()
    if (ri >= 0) {
      if (e.shiftKey && this._rowSelection.anchor !== null) {
        this._rowSelection.extendDiscreteRange(ri)
      } else if (e.ctrlKey || e.metaKey) {
        this._rowSelection.toggle(ri)
      } else {
        this._rowSelection.selectOnly(ri)
      }
      this._focusedRow = ri
      this._rowSelection.setFocus(ri)
      this._scrollToRow(ri)
      this.onRowClick?.(visibleRows[ri]!, ri)
      FocusManager.instance.setFocus(this)
      this.markNeedsPaint()
    }
  }

  private _syncDataState(): void {
    this._sortState = this._normalizeSortState(this._sortState)
    this._clampState()
  }

  private _normalizeSortState(sortState: TableSortState): TableSortState {
    if (!sortState.key || !sortState.order) return { key: '', order: null }
    const column = this._columns.find(col => col.key === sortState.key)
    if (!column?.sortable) return { key: '', order: null }
    return { key: sortState.key, order: sortState.order }
  }

  setSelectedRows(rows: Iterable<number>): void {
    const nextRows = new Set<number>()
    const rowCount = this._visibleRows().length
    for (const row of rows) {
      if (row >= 0 && row < rowCount) nextRows.add(row)
    }
    const changed = nextRows.size !== this.selectedRows.size || [...nextRows].some(row => !this.selectedRows.has(row))
    if (!changed) return
    this._rowSelection.replaceSelected(nextRows)
    const nextRowList = [...nextRows]
    if (!nextRows.has(this._focusedRow)) this._focusedRow = nextRowList[0] ?? -1
    this.markNeedsPaint()
  }

  onPointerMove(e: PointerEvent): void {
    this.tooltip = undefined
    if (this._resizingCol >= 0) {
      e.stopPropagation?.()
      this._resizeCurrentX = e.position.x
      this.markNeedsPaint()
      return
    }

    if (this._vScrollbar.dragging) {
      const result = this._vScrollbarController.updatePointer(
        e.position,
        this._vScrollbarGeometry(),
        pointerKey(e),
      )
      if (!result.handled) return
      e.stopPropagation?.()
      this._scroll.setOffset(result.scrollOffset ?? this._scrollY, {
        viewportSize: this._viewH,
        contentSize: this._totalContentH,
      })
      this.markNeedsPaint()
      return
    }

    if (this._hScrollbar.dragging) {
      const result = this._hScrollbarController.updatePointer(
        e.position,
        this._hScrollbarGeometry(),
        pointerKey(e),
      )
      if (!result.handled) return
      e.stopPropagation?.()
      this._scroll.setScrollX(result.scrollOffset ?? this._scrollX, {
        viewportSize: this._viewW,
        contentSize: this._totalContentW,
      })
      this.markNeedsPaint()
      return
    }

    const verticalHoverChanged = this._vScrollbarController.updateHover(e.position, this._vScrollbarGeometry())
    const horizontalHoverChanged = this._hScrollbarController.updateHover(e.position, this._hScrollbarGeometry())
    if (verticalHoverChanged || horizontalHoverChanged) this.markNeedsPaint()

    const ri = this._rowAtPoint(e.position)
    if (ri !== this._hoveredRow) {
      this._hoveredRow = ri
      this.markNeedsPaint()
    }
    this._syncOverflowTooltip(e.position)
  }

  onPointerUp(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    const key = pointerKey(e)
    if ((this._vScrollbar.dragging && !this._vScrollbarController.ownsPointer(key)) ||
      (this._hScrollbar.dragging && !this._hScrollbarController.ownsPointer(key))) return
    const resizedCol = this._resizingCol
    if (this._hasCapturedDrag()) {
      e.stopPropagation?.()
      e.releasePointerCapture?.()
    }
    if (resizedCol >= 0) {
      const minWidth = this.columns[resizedCol]?.minWidth ?? 40
      this._colWidthsState[resizedCol] = Math.max(minWidth, this._resizeStartW + e.position.x - this._resizeStartX)
      this._clampState()
      this.markNeedsPaint()
    }
    this._resizingCol = -1
    this._resizeCurrentX = 0
    this._vScrollbarController.endPointer(e.position, this._vScrollbarGeometry(), key)
    this._hScrollbarController.endPointer(e.position, this._hScrollbarGeometry(), key)
  }

  onPointerCancel(e: PointerEvent): void {
    const key = pointerKey(e)
    if ((this._vScrollbar.dragging && !this._vScrollbarController.ownsPointer(key)) ||
      (this._hScrollbar.dragging && !this._hScrollbarController.ownsPointer(key))) return
    if (this._hasCapturedDrag()) {
      e.stopPropagation?.()
      e.releasePointerCapture?.()
    }
    this._resizingCol = -1
    this._resizeCurrentX = 0
    this._vScrollbarController.cancelPointer(key)
    this._hScrollbarController.cancelPointer(key)
    this._hoveredRow = -1
    this.tooltip = undefined
    this.markNeedsPaint()
  }

  onPointerLeave(_e: PointerEvent): void {
    const verticalHoverChanged = this._vScrollbarController.clearHover()
    const horizontalHoverChanged = this._hScrollbarController.clearHover()
    const hadHover = verticalHoverChanged || horizontalHoverChanged || this._hoveredRow !== -1
    this._hoveredRow = -1
    this.tooltip = undefined
    if (hadHover) this.markNeedsPaint()
  }

  // ---- Focusable ----
  get isFocused(): boolean { return this._focusedRow >= 0 }
  focusIn(): void { }
  focusOut(): void {
    this._focusedRow = -1
    this._rowSelection.clearRange(null)
    this.markNeedsPaint()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    const visibleRows = this._visibleRows()
    if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
      event.preventDefault()
      this._rowSelection.selectAllDiscrete(visibleRows.length, { focus: this._focusedRow >= 0 ? this._focusedRow : null })
      if (this._focusedRow < 0 && visibleRows.length > 0) this._focusedRow = this._rowSelection.focus ?? (visibleRows.length - 1)
      this.markNeedsPaint()
      return true
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false
    event.preventDefault()
    const dir = event.key === 'ArrowUp' ? -1 : 1
    const next = this._rowSelection.moveDiscreteFocus(dir, visibleRows.length, {
      extend: event.shiftKey,
      preserveSelection: event.ctrlKey || event.metaKey,
    })
    if (next === null || next === this._focusedRow) return true

    this._focusedRow = next
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
      this.onRowClick?.(visibleRows[next]!, next)
    }
    this._scrollToRow(next)
    this.markNeedsPaint()
    return true
  }

  private _scrollToRow(ri: number): void {
    this._scroll.scrollToIndex({
      itemCount: this._visibleRows().length,
      itemSize: this.rowHeight,
      viewportSize: this._viewH,
      index: ri,
      align: 'nearest',
    })
  }
  onWheel(e: WheelPointerEvent): boolean {
    if (!this.hitTest(e.position)) return false
    this.tooltip = undefined
    const canScrollX = this._totalContentW > this._viewW
    const canScrollY = this._totalContentH > this._viewH
    const beforeX = this._scroll.scrollX
    const beforeY = this._scroll.scrollY
    if (e.deltaX !== 0) {
      this._scroll.scrollByX(e.deltaX > 0 ? 60 : -60, { viewportSize: this._viewW, contentSize: this._totalContentW })
    }
    if (e.deltaY !== 0) {
      this._scroll.scrollBy(e.deltaY > 0 ? 60 : -60, { viewportSize: this._viewH, contentSize: this._totalContentH })
    }
    if (this._scroll.scrollX === beforeX && this._scroll.scrollY === beforeY) {
      return (e.deltaX !== 0 && canScrollX) || (e.deltaY !== 0 && canScrollY)
    }
    this.markNeedsPaint()
    return true
  }

  private _syncThemeMetrics(theme: ResolvedTheme): void {
    const s = this._rowTokens(theme)
    if (this._usesThemeRowHeight) this.rowHeight = s.rowHeight
    if (this._usesThemeHeaderHeight) this.headerHeight = s.headerHeight
  }

  private _rowTokens(theme: ResolvedTheme): TableRowStyleTokens {
    return deriveTableRowStyle(theme)
  }

  private _scrollbarTokens(theme: ResolvedTheme): ScrollbarStyleTokens {
    return deriveScrollbarStyle(theme)
  }

  private _scrollbarWidth(theme: ResolvedTheme = this.currentTheme): number {
    return this._scrollbarTokens(theme).gutterSize
  }

  dispose(): void {
    FocusManager.instance.unregister(this)
    this._vScrollbarController.reset()
    this._hScrollbarController.reset()
    this._hoveredRow = -1
    this._focusedRow = -1
    this._rowSelection.clearRange(null)
    super.dispose()
  }
}
