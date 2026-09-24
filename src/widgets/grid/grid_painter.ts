import { DrawList } from '../../rendering/draw_list'
import { paintFrozenBoundary } from '../../rendering/frozen_boundary_painter'
import { ellipsizeText } from '../../core/text_overflow'
import type { PaintContext } from '../../rendering/paint_context'
import type { ResolvedTheme } from '../../theme/theme'
import { paintHBar, paintVBar } from '../../rendering/scrollbar'
import {
  paintSingleLineEditableText,
  resolveSingleLineTextOriginX,
} from '../../rendering/single_line_text_renderer'
import { resolveSingleLineEditableTextLayout } from '../../core/single_line_text_input'
import { paintSingleLineText } from '../../rendering/text_painter'
import {
  resolveBgColor,
  resolveTextColor,
  type ResolvedGridCellStyleTokens,
  type ScrollbarStyleTokens,
} from '../../theme/component_styles'
import type { Color } from '../../theme/theme'
import type {
  GridCellDisplayTextArgs,
  GridCellErrorState,
  GridCellRange,
  GridCellTextOverflow,
  GridCellStyleArgs,
  GridCellStyleOverride,
  GridColumnDef,
  GridDataState,
  GridFilterRule,
  GridGroupDef,
  GridGroupDisplayTextArgs,
  GridGroupItem,
  GridRowStyleArgs,
  GridRowStyleOverride,
  GridResolvedCellEditPolicy,
  GridSortState,
  GridSummaryCellDebugState,
  GridVisibleItem,
} from './grid_types'
import { GRID_COLUMN_RESIZE_HANDLE_SIZE, type GridViewport } from './grid_viewport'
import type { GridEditingController } from './grid_editing_controller'
import { resolveGridColumnEditorKind } from './grid_column_editor'
import { gridGroupBadgeLabel, resolveGridHeaderActionLayout } from './grid_header_actions'
import { paintIconGlyph } from '../icon'
import { paintNumberStepper } from '../number_stepper'
import {
  defaultGridCellDisplayText,
  resolveGridCellPresentation,
  resolveGridRowPresentation,
  type GridResolvedCellPresentation,
} from './grid_display_resolver'
import type { GridLookupValueResolver } from './lookup_value_index'

export interface GridPainterSnapshot<T extends Record<string, any>> {
  theme: ResolvedTheme
  columns: GridColumnDef<T>[]
  visibleItems: Array<GridVisibleItem<T>>
  viewport: GridViewport<T>
  selectedRows: Set<number>
  focused: boolean
  focusedItemIndex: number
  focusedColIndex: number
  hoveredItemIndex: number
  sortState: GridSortState
  sortable: boolean
  disabled: boolean
  groupBy: GridGroupDef<T>[]
  filterValues: ReadonlyMap<string, string>
  filters: GridFilterRule[]
  filterPopupColumn: number
  selectedRanges: GridCellRange[]
  currentCell: { row: number; col: number } | null
  dataState: GridDataState
  stateMessage: string
  summaryCells: GridSummaryCellDebugState[]
  footerHeight: number
  cellTextOverflow: GridCellTextOverflow
  editableState: GridEditingController<T>['state']
  editInput: GridEditingController<T>['input']
  gridTokens: ResolvedGridCellStyleTokens
  scrollbarTokens: ScrollbarStyleTokens
  getCellError?: (sourceRowIndex: number, key: string, rowIndex: number, colIndex: number) => GridCellErrorState | null
  getCellDisplayText?: (args: GridCellDisplayTextArgs<T>) => string | null | undefined
  getGroupDisplayText?: (args: GridGroupDisplayTextArgs<T>) => string | null | undefined
  resolveRowStyle?: (args: GridRowStyleArgs<T>) => GridRowStyleOverride | null | undefined
  resolveCellStyle?: (args: GridCellStyleArgs<T>) => GridCellStyleOverride | null | undefined
  getCellEditPolicy?: (rowIndex: number, colIndex: number) => GridResolvedCellEditPolicy
  lookupValues: GridLookupValueResolver<T>
  measureText: (text: string, fontSize: number, fontFamily: string) => number
}

export class GridPainter<T extends Record<string, any> = any> {
  paint(
    context: PaintContext,
    offset: { x: number; y: number },
    snapshot: GridPainterSnapshot<T>,
  ): void {
    const dl = new DrawList(context)
    const width = snapshot.viewport.size.width
    const height = snapshot.viewport.size.height
    const scrollbarWidth = snapshot.viewport.scrollbarWidth()
    const viewWidth = snapshot.viewport.viewWidth
    const bodyY = offset.y + snapshot.viewport.headerSectionHeight
    const bodyH = snapshot.viewport.viewHeight
    const footerY = bodyY + bodyH

    dl.fillRect(offset.x, offset.y, width, height, snapshot.gridTokens.windowBg, snapshot.gridTokens.frameRounding)
    dl.strokeRect(offset.x, offset.y, width, height, snapshot.gridTokens.windowBorder, 1, snapshot.gridTokens.frameRounding)

    this.paintHeader(context, dl, offset.x, offset.y, viewWidth, snapshot)
    if (snapshot.viewport.filterRowHeight > 0) {
      this.paintFilterRow(dl, offset.x, offset.y + snapshot.viewport.headerHeight, viewWidth, snapshot)
    }
    if (snapshot.dataState === 'ready') {
      dl.pushClip(offset.x, bodyY, viewWidth, bodyH)
      this.paintRows(context, dl, offset.x, viewWidth, bodyY, snapshot)
      dl.popClip()
    } else {
      this.paintStateLayer(dl, offset.x, bodyY, viewWidth, bodyH, snapshot)
    }
    if (snapshot.footerHeight > 0) {
      this.paintSummaryFooter(dl, offset.x, footerY, viewWidth, snapshot)
    }
    this.paintFrozenColumnBoundaries(dl, offset.x, offset.y, viewWidth, snapshot)
    this.paintColumnResizeAffordance(dl, offset.x, offset.y, viewWidth, snapshot)
    this.paintScrollbars(dl, offset.x, offset.y, bodyY, bodyH, scrollbarWidth, snapshot)
    if (snapshot.disabled) {
      dl.fillRect(
        offset.x,
        offset.y,
        width,
        height,
        snapshot.gridTokens.disabledOverlay,
        snapshot.gridTokens.frameRounding,
      )
    }
  }

  private paintHeader(
    context: PaintContext,
    dl: DrawList,
    x: number,
    y: number,
    viewWidth: number,
    snapshot: GridPainterSnapshot<T>,
  ): void {
    const tokens = snapshot.gridTokens
    const viewport = snapshot.viewport
    dl.fillRect(x, y, viewWidth, viewport.headerHeight, resolveBgColor(tokens.headerBgState, 'normal'), 0)

    for (let colIndex = 0; colIndex < snapshot.columns.length; colIndex++) {
      const column = snapshot.columns[colIndex]!
      const columnWidth = viewport.colWidths[colIndex]!
      const columnX = viewport.cellX(snapshot.columns, x, colIndex)
      const visibleCell = viewport.visibleCellRect(snapshot.columns, x, colIndex)
      const groupedByIndex = snapshot.groupBy.findIndex(group => group.key === column.key)
      const grouped = groupedByIndex >= 0
      const groupedDef = grouped ? snapshot.groupBy[groupedByIndex]! : null
      const isSortedColumn = !grouped && snapshot.sortState.key === column.key && !!snapshot.sortState.order
      const showActiveHeader = grouped || isSortedColumn
      const showSort = grouped || (!!column.sortable && (snapshot.sortable || isSortedColumn))
      const actions = resolveGridHeaderActionLayout({
        columnX,
        columnWidth,
        headerY: y,
        headerHeight: viewport.headerHeight,
        paddingH: tokens.paddingH,
        fontSize: tokens.fontSize,
        metrics: tokens.headerAction,
        showSort,
        showFilter: !!column.filterable,
        groupIndex: groupedByIndex,
      })

      if (visibleCell.w > 0) {
        const clipX = visibleCell.x
        const clipW = visibleCell.w
        dl.strokeRect(clipX, y, clipW, viewport.headerHeight, tokens.separator, 0.5, 0)
        dl.pushClip(clipX, y, clipW, viewport.headerHeight)
        const headerState = {
          disabled: snapshot.disabled,
          selected: showActiveHeader,
          hovered: !snapshot.disabled && viewport.hoveredHeaderCol === colIndex,
        }
        if (headerState.selected || headerState.hovered) {
          dl.fillRect(clipX, y, clipW, viewport.headerHeight, resolveBgColor(tokens.headerBgState, headerState), 0)
        }

        if (grouped && actions.groupBadgeRect) {
          const badgeText = gridGroupBadgeLabel(groupedByIndex)
          const badge = actions.groupBadgeRect
          dl.fillRect(badge.x, badge.y, badge.w, badge.h, tokens.groupBadgeBg, badge.h / 2)
          dl.fillText(
            badgeText,
            badge.x + badge.w / 2,
            y + viewport.headerHeight / 2,
            tokens.groupBadgeText,
            tokens.fontSize * 0.8,
            tokens.fontFamily,
            'center',
            'middle',
          )
        }

        const headerText = column.title
        const textClipW = Math.max(0, actions.titleRight - (columnX + tokens.paddingH))
        if (textClipW > 0) {
          dl.pushClip(columnX + tokens.paddingH, y, textClipW, viewport.headerHeight)
          paintSingleLineText(dl, {
            text: headerText,
            x: columnX + tokens.paddingH,
            y: y + viewport.headerHeight / 2,
            maxWidth: textClipW,
            color: resolveTextColor(tokens.headerTextState, headerState),
            fontSize: tokens.fontSize,
            fontFamily: tokens.fontFamily,
          })
          dl.popClip()
        }

        if (showSort && actions.sortRect) {
          const arrowX = actions.sortRect.x + actions.sortRect.w / 2
          const arrowY = y + viewport.headerHeight / 2
          const arrowColor = resolveTextColor(tokens.headerArrowText, headerState)
          const order = grouped ? groupedDef?.order ?? 'asc' : snapshot.sortState.order
          if (grouped || snapshot.sortState.key === column.key) {
            if (order === 'asc') this.drawArrow(dl, arrowX, arrowY, 'up', arrowColor)
            else if (order === 'desc') this.drawArrow(dl, arrowX, arrowY, 'down', arrowColor)
          } else if (column.sortable) {
            this.drawArrow(dl, arrowX, arrowY - 3, 'up', arrowColor)
            this.drawArrow(dl, arrowX, arrowY + 3, 'down', arrowColor)
          }
        }

        if (column.filterable && actions.filterRect) {
          const hasFilter = (snapshot.filterValues.has(column.key) && snapshot.filterValues.get(column.key) !== '') ||
            snapshot.filters.some(filter => filter.key === column.key)
          const filterPopupOpen = snapshot.filterPopupColumn === colIndex
          if (!snapshot.disabled && (viewport.hoveredFilterCol === colIndex || filterPopupOpen)) {
            dl.fillRect(
              actions.filterRect.x,
              actions.filterRect.y,
              actions.filterRect.w,
              actions.filterRect.h,
              resolveBgColor(tokens.headerBgState, filterPopupOpen ? 'selected' : 'hovered'),
              3,
            )
          }
          const filterColor = hasFilter
            ? resolveTextColor(tokens.headerArrowText, snapshot.disabled ? 'disabled' : 'selected')
            : resolveTextColor(tokens.headerArrowText, snapshot.disabled ? 'disabled' : 'normal')
          const iconSize = actions.iconSize
          paintIconGlyph(context, {
            name: hasFilter ? 'filter' : 'chevron-down',
            x: actions.filterRect.x + (actions.filterRect.w - iconSize) / 2,
            y: actions.filterRect.y + (actions.filterRect.h - iconSize) / 2,
            size: iconSize,
            color: filterColor,
          })
        }
        dl.popClip()
      }
    }

    dl.line(x, y + viewport.headerHeight, x + viewWidth, y + viewport.headerHeight, tokens.separator, 1)

    if (viewport.draggingCol >= 0 && viewport.dropTargetCol >= 0) {
      const dropX = viewport.cellX(snapshot.columns, x, viewport.dropTargetCol)
      const dropW = viewport.colWidths[viewport.dropTargetCol]!
      dl.line(dropX, y, dropX, y + viewport.headerHeight, tokens.resizeActiveColor, 2)
      dl.line(dropX + dropW, y, dropX + dropW, y + viewport.headerHeight, tokens.resizeActiveColor, 2)
    }
  }

  private paintColumnResizeAffordance(
    dl: DrawList,
    x: number,
    y: number,
    viewWidth: number,
    snapshot: GridPainterSnapshot<T>,
  ): void {
    const { viewport, gridTokens: tokens } = snapshot
    const colIndex = viewport.resizingCol >= 0 ? viewport.resizingCol : viewport.hoveredResizeCol
    if (snapshot.disabled || colIndex < 0 || colIndex >= snapshot.columns.length) return

    const active = viewport.resizingCol >= 0
    const columnX = viewport.cellX(snapshot.columns, x, colIndex)
    const columnWidth = viewport.colWidths[colIndex] ?? 0
    const guideX = active && viewport.resizeCurrentX !== 0
      ? viewport.resizeCurrentX
      : columnX + columnWidth
    const edgeX = Math.max(x, Math.min(x + viewWidth, guideX))
    const height = viewport.headerSectionHeight + viewport.viewHeight + snapshot.footerHeight
    const lineColor = active
      ? tokens.resizeActiveColor
      : { ...tokens.resizeActiveColor, a: Math.min(tokens.resizeActiveColor.a, 0.78) }
    const glowColor = active
      ? tokens.resizeGlow
      : { ...tokens.resizeGlow, a: Math.min(tokens.resizeGlow.a, 0.08) }

    dl.pushClip(x, y, viewWidth, height)
    dl.fillRect(
      edgeX - GRID_COLUMN_RESIZE_HANDLE_SIZE,
      y,
      GRID_COLUMN_RESIZE_HANDLE_SIZE * 2,
      height,
      glowColor,
      0,
    )
    dl.line(edgeX, y, edgeX, y + height, lineColor, active ? 2.5 : 2)
    dl.popClip()
  }

  private paintFilterRow(
    dl: DrawList,
    x: number,
    y: number,
    viewWidth: number,
    snapshot: GridPainterSnapshot<T>,
  ): void {
    const tokens = snapshot.gridTokens
    const viewport = snapshot.viewport
    const rowHeight = viewport.filterRowHeight
    dl.fillRect(x, y, viewWidth, rowHeight, resolveBgColor(tokens.headerBgState, 'normal'), 0)
    dl.line(x, y, x + viewWidth, y, tokens.separator, 1)

    for (let colIndex = 0; colIndex < snapshot.columns.length; colIndex++) {
      const column = snapshot.columns[colIndex]!
      const columnWidth = viewport.colWidths[colIndex]!
      const columnX = viewport.cellX(snapshot.columns, x, colIndex)
      const visibleCell = viewport.visibleCellRect(snapshot.columns, x, colIndex)
      if (visibleCell.w <= 0) continue

      const clipX = visibleCell.x
      const clipW = visibleCell.w
      dl.strokeRect(clipX, y, clipW, rowHeight, tokens.separator, 0.5, 0)
      if (!column.filterable || clipW <= 8) continue

      const inputX = columnX + 4
      const inputY = y + 4
      const inputW = Math.max(0, columnWidth - 8)
      const inputH = Math.max(0, rowHeight - 8)
      const fieldX = Math.max(clipX + 2, inputX)
      const fieldW = Math.min(inputW, clipX + clipW - fieldX - 2)
      if (fieldW <= 8 || inputH <= 8) continue

      const text = this.filterRowText(column, snapshot)
      const hasText = text.length > 0
      const textClipW = Math.max(0, fieldW - tokens.paddingH * 2)
      dl.fillRect(fieldX, inputY, fieldW, inputH, tokens.windowBg, 3)
      dl.strokeRect(fieldX, inputY, fieldW, inputH, tokens.separator, 1, 3)
      dl.pushClip(fieldX + tokens.paddingH, inputY, textClipW, inputH)
      paintSingleLineText(dl, {
        text: hasText ? text : 'Filter...',
        x: fieldX + tokens.paddingH,
        y: inputY + inputH / 2,
        maxWidth: textClipW,
        color: resolveTextColor(tokens.cellTextState, hasText ? 'normal' : 'disabled'),
        fontSize: Math.max(10, tokens.fontSize - 1),
        fontFamily: tokens.fontFamily,
      })
      dl.popClip()
    }
    dl.line(x, y + rowHeight, x + viewWidth, y + rowHeight, tokens.separator, 1)
  }

  private paintRows(
    context: PaintContext,
    dl: DrawList,
    x: number,
    viewWidth: number,
    bodyY: number,
    snapshot: GridPainterSnapshot<T>,
  ): void {
    const viewport = snapshot.viewport
    const tokens = snapshot.gridTokens
    const virtualRange = viewport.visibleVirtualRange(snapshot.visibleItems.length)
    if (virtualRange.startIndex < 0) return

    for (let itemIndex = virtualRange.startIndex; itemIndex <= virtualRange.endIndex; itemIndex++) {
      const item = snapshot.visibleItems[itemIndex]!
      const rowY = bodyY + itemIndex * viewport.rowHeight - viewport.scrollY
      if (item.kind === 'group') {
        this.paintGroupRow(dl, x, viewWidth, rowY, itemIndex, item, snapshot)
        continue
      }

      const isSelected = snapshot.selectedRows.has(item.dataRowIndex)
      const isHovered = snapshot.hoveredItemIndex === itemIndex
      const isFocused = snapshot.focused && snapshot.focusedItemIndex === itemIndex
      const rowPresentation = resolveGridRowPresentation({
        item,
        theme: snapshot.theme,
        tokens,
        state: {
          itemIndex,
          selected: isSelected,
          hovered: isHovered,
          focused: isFocused,
          editing: snapshot.editableState?.row === item.dataRowIndex,
        },
        resolveRowStyle: snapshot.resolveRowStyle,
      })
      if (rowPresentation.backgroundColor) {
        dl.fillRect(x, rowY, viewWidth, viewport.rowHeight, rowPresentation.backgroundColor, 0)
      }

      if (rowPresentation.borderColor) {
        dl.strokeRect(
          x + 1,
          rowY + 1,
          viewWidth - 2,
          viewport.rowHeight - 2,
          rowPresentation.borderColor,
          1,
          0,
        )
      }

      for (let colIndex = 0; colIndex < snapshot.columns.length; colIndex++) {
        const column = snapshot.columns[colIndex]!
        const columnWidth = viewport.colWidths[colIndex]!
        const columnX = viewport.cellX(snapshot.columns, x, colIndex)
        const isEditing = snapshot.editableState?.row === item.dataRowIndex && snapshot.editableState?.col === colIndex
        const isCellFocused = isFocused && snapshot.focusedColIndex === colIndex
        const isCellSelected = this.isCellSelected(item.dataRowIndex, colIndex, snapshot.selectedRanges)
        const visibleCell = viewport.visibleCellRect(snapshot.columns, x, colIndex)
        if (visibleCell.w <= 0) continue
        const cellError = snapshot.getCellError?.(item.sourceIndex, column.key, item.dataRowIndex, colIndex) ?? null
        const editPolicy = snapshot.getCellEditPolicy?.(item.dataRowIndex, colIndex)
        const cellPresentation = resolveGridCellPresentation({
          item,
          theme: snapshot.theme,
          column,
          colIndex,
          tokens,
          rowPresentation,
          cellError,
          state: {
            itemIndex,
            selected: isSelected,
            hovered: isHovered,
            focused: isFocused,
            editing: isEditing,
          },
          getCellDisplayText: snapshot.getCellDisplayText,
          resolveCellStyle: snapshot.resolveCellStyle,
          lookupValues: snapshot.lookupValues,
        })
        const clipX = visibleCell.x
        const clipW = visibleCell.w
        dl.strokeRect(clipX, rowY, clipW, viewport.rowHeight, tokens.separator, 0.5, 0)
        dl.pushClip(clipX + 1, rowY, Math.max(0, clipW - 2), viewport.rowHeight)
        if (isCellSelected && !isEditing) {
          dl.fillRect(columnX + 1, rowY + 1, columnWidth - 2, viewport.rowHeight - 2, tokens.selectionBg, 0)
        }
        if (isEditing) {
          this.paintEditCell(context, dl, column, columnX, rowY, columnWidth, snapshot, cellPresentation)
        } else {
          this.paintReadCell(dl, column, columnX, rowY, columnWidth, snapshot, cellPresentation)
        }
        if (editPolicy?.state === 'disabled') {
          dl.fillRect(
            columnX + 1,
            rowY + 1,
            columnWidth - 2,
            viewport.rowHeight - 2,
            tokens.disabledOverlay,
            0,
          )
        }
        dl.popClip()
        const borderX = clipX + 1
        const borderW = Math.max(0, clipW - 2)
        if (cellPresentation.borderColor && borderW > 0) {
          dl.strokeRect(
            borderX,
            rowY + 1,
            borderW,
            viewport.rowHeight - 2,
            cellPresentation.borderColor,
            isEditing ? 1.5 : 1,
            0,
          )
        }
        if (isCellFocused && !isEditing && borderW > 0) {
          dl.strokeRect(
            borderX,
            rowY + 1,
            borderW,
            viewport.rowHeight - 2,
            tokens.focusedRowBorder,
            1.5,
            0,
          )
        }
        if (cellError && borderW > 0) {
          dl.strokeRect(
            borderX,
            rowY + 1,
            borderW,
            viewport.rowHeight - 2,
            tokens.cellErrorBorder,
            1.5,
            0,
          )
        }
      }

      dl.line(x, rowY + viewport.rowHeight, x + viewWidth, rowY + viewport.rowHeight, tokens.rowSeparator, 0.5)
    }
  }

  private paintFrozenColumnBoundaries(
    dl: DrawList,
    x: number,
    y: number,
    viewWidth: number,
    snapshot: GridPainterSnapshot<T>,
  ): void {
    const viewport = snapshot.viewport
    const leftWidth = viewport.fixedRegionWidth(snapshot.columns)
    const rightWidth = viewport.rightFixedRegionWidth(snapshot.columns)
    const scrollableContentWidth = viewport.scrollableContentWidth(snapshot.columns)
    const scrollableViewWidth = viewport.scrollableViewWidth(snapshot.columns)
    if (scrollableContentWidth <= 0 || scrollableViewWidth <= 0) return

    const height = viewport.headerSectionHeight + viewport.viewHeight + viewport.footerHeight
    if (height <= 0) return
    const maxScrollX = Math.max(
      0,
      scrollableContentWidth - scrollableViewWidth,
    )
    dl.pushClip(x, y, viewWidth, height)
    if (leftWidth > 0 && leftWidth < viewWidth) {
      paintFrozenBoundary(dl, {
        side: 'right',
        x: x + leftWidth,
        y,
        length: height,
        active: viewport.scrollX > 0,
        lineColor: snapshot.theme.borderDataStrong,
        shadowColor: snapshot.theme.elevation.popupShadowColor,
      })
    }
    if (rightWidth > 0 && rightWidth < viewWidth) {
      paintFrozenBoundary(dl, {
        side: 'left',
        x: x + viewWidth - rightWidth,
        y,
        length: height,
        active: maxScrollX > 0 && viewport.scrollX < maxScrollX,
        lineColor: snapshot.theme.borderDataStrong,
        shadowColor: snapshot.theme.elevation.popupShadowColor,
      })
    }
    dl.popClip()
  }

  private paintGroupRow(
    dl: DrawList,
    x: number,
    viewWidth: number,
    rowY: number,
    itemIndex: number,
    item: GridGroupItem<T>,
    snapshot: GridPainterSnapshot<T>,
  ): void {
    const tokens = snapshot.gridTokens
    const viewport = snapshot.viewport
    const isHovered = snapshot.hoveredItemIndex === itemIndex
    const isFocused = snapshot.focusedItemIndex === itemIndex && !snapshot.editableState
    const state = isFocused ? 'focused' : isHovered ? 'hovered' : 'normal'
    dl.fillRect(x, rowY, viewWidth, viewport.rowHeight, resolveBgColor(tokens.groupRowBgState, state), 0)
    dl.strokeRect(x, rowY, viewWidth, viewport.rowHeight, tokens.separator, 0.5, 0)

    if (isFocused) {
      dl.strokeRect(
        x + 1,
        rowY + 1,
        viewWidth - 2,
        viewport.rowHeight - 2,
        resolveBgColor(tokens.groupRowBorderState, 'focused'),
        1,
        0,
      )
    }

    const column = snapshot.columns.find(entry => entry.key === item.groupKey)
    const groupValueText = this.formatGroupValue(column, item.groupValue, snapshot.lookupValues)
    const summarySuffix = item.summaryText ? `  ${item.summaryText}` : ''
    const defaultDisplayText = `${column?.title ?? item.groupKey}: ${groupValueText} (${item.childCount})${summarySuffix}`
    const label = snapshot.getGroupDisplayText?.({
      item,
      column,
      groupKey: item.groupKey,
      groupValue: item.groupValue,
      groupValueText,
      childCount: item.childCount,
      depth: item.depth,
      expanded: item.expanded,
      defaultDisplayText,
    }) ?? defaultDisplayText
    const metrics = this.groupRowMetrics(x, item.depth, tokens)

    if (item.expanded) this.drawDisclosureArrow(dl, metrics.arrowCenterX, rowY + viewport.rowHeight / 2, 'down', resolveTextColor(tokens.groupArrowText, state))
    else this.drawDisclosureArrow(dl, metrics.arrowCenterX, rowY + viewport.rowHeight / 2, 'right', resolveTextColor(tokens.groupArrowText, state))

    const labelMaxWidth = Math.max(0, x + viewWidth - metrics.labelX - tokens.paddingH)
    paintSingleLineText(dl, {
      text: label,
      x: metrics.labelX,
      y: rowY + viewport.rowHeight / 2,
      maxWidth: labelMaxWidth,
      color: resolveTextColor(tokens.groupRowTextState, state),
      fontSize: tokens.fontSize,
      fontFamily: tokens.fontFamily,
    })
    dl.line(x, rowY + viewport.rowHeight, x + viewWidth, rowY + viewport.rowHeight, tokens.rowSeparator, 0.5)
  }

  private paintReadCell(
    dl: DrawList,
    column: GridColumnDef<T>,
    columnX: number,
    rowY: number,
    columnWidth: number,
    snapshot: GridPainterSnapshot<T>,
    presentation: GridResolvedCellPresentation<T>,
  ): void {
    const value = presentation.args.value
    const tokens = snapshot.gridTokens
    const align = presentation.align
    let textX = columnX + tokens.paddingH
    if (align === 'center') textX = columnX + columnWidth / 2
    else if (align === 'right') textX = columnX + columnWidth - tokens.paddingH
    if (presentation.backgroundColor) {
      dl.fillRect(columnX + 1, rowY + 1, columnWidth - 2, snapshot.viewport.rowHeight - 2, presentation.backgroundColor, 0)
    }

    if (column.type === 'checkbox') {
      const boxSize = tokens.fontSize
      const boxX = columnX + (columnWidth - boxSize) / 2
      const boxY = rowY + (snapshot.viewport.rowHeight - boxSize) / 2
      dl.fillRect(boxX, boxY, boxSize, boxSize, tokens.checkboxBg, tokens.frameRounding)
      dl.strokeRect(boxX, boxY, boxSize, boxSize, tokens.checkboxBorder, 1, tokens.frameRounding)
      if (value) dl.drawCheckmark(boxX, boxY, boxSize, tokens.checkMark, 2)
      return
    }

    const paintText = this.resolvePaintText(
      presentation.displayText,
      this.resolveCellTextOverflow(column, snapshot),
      Math.max(0, columnWidth - tokens.paddingH * 2),
      presentation.fontSize,
      presentation.fontFamily,
      snapshot,
    )
    dl.fillText(
      paintText,
      textX,
      rowY + snapshot.viewport.rowHeight / 2,
      presentation.textColor,
      presentation.fontSize,
      presentation.fontFamily,
      align,
      'middle',
    )
  }

  private paintEditCell(
    context: PaintContext,
    dl: DrawList,
    column: GridColumnDef<T>,
    columnX: number,
    rowY: number,
    columnWidth: number,
    snapshot: GridPainterSnapshot<T>,
    presentation: GridResolvedCellPresentation<T>,
  ): void {
    const edit = snapshot.editableState
    if (!edit) return
    const editorKind = resolveGridColumnEditorKind(column)
    if (editorKind === 'checkbox') return
    const tokens = snapshot.gridTokens
    const input = snapshot.editInput
    if (presentation.backgroundColor) {
      dl.fillRect(
        columnX + 1,
        rowY + 1,
        columnWidth - 2,
        snapshot.viewport.rowHeight - 2,
        presentation.backgroundColor,
        0,
      )
    }
    if (editorKind === 'text' || editorKind === 'number' || editorKind === 'time') {
      const stepperWidth = editorKind === 'number'
        ? Math.min(tokens.numberStepper.width, Math.max(0, columnWidth - 2))
        : 0
      const displayText = edit.text
      const contentX = columnX + tokens.paddingH
      const contentWidth = Math.max(0, columnWidth - tokens.paddingH * 2 - stepperWidth)
      const textX = resolveSingleLineTextOriginX({
        contentX,
        contentWidth,
        textWidth: resolveSingleLineEditableTextLayout({
          controller: input,
          displayText,
          measureText: text => snapshot.measureText(
            text,
            presentation.fontSize,
            presentation.fontFamily,
          ),
        }).totalWidth,
        align: presentation.align,
      }) - input.scrollX
      if (stepperWidth > 0) {
        dl.pushClip(
          columnX + 1,
          rowY + 1,
          Math.max(0, columnWidth - stepperWidth - 2),
          snapshot.viewport.rowHeight - 2,
        )
      }
      paintSingleLineEditableText({
        dl,
        controller: input,
        displayText,
        measureText: text => snapshot.measureText(text, presentation.fontSize, presentation.fontFamily),
        fontSize: presentation.fontSize,
        fontFamily: presentation.fontFamily,
        textX,
        textY: rowY + snapshot.viewport.rowHeight / 2,
        lineTop: rowY + 4,
        lineBottom: rowY + snapshot.viewport.rowHeight - 4,
        textColor: presentation.textColor,
        selectionBg: tokens.selectionBg,
        caretColor: presentation.textColor,
        compositionTextColor: { ...presentation.textColor, a: 0.6 },
        compositionUnderlineColor: presentation.textColor,
      })
      if (stepperWidth > 0) {
        dl.popClip()
        paintNumberStepper(dl, {
          rect: {
            x: columnX + columnWidth - stepperWidth,
            y: rowY,
            w: stepperWidth,
            h: snapshot.viewport.rowHeight,
          },
          tokens: tokens.numberStepper,
          hovered: edit.numberStepperHovered,
          pressed: edit.numberStepperPressed,
        })
      }
      return
    }
    const align = presentation.align
    const arrowReserve = tokens.fontSize + 4
    let textX = columnX + tokens.paddingH
    if (align === 'center') textX = columnX + (columnWidth - arrowReserve) / 2
    else if (align === 'right') textX = columnX + columnWidth - tokens.paddingH - arrowReserve
    const paintText = this.resolvePaintText(
      presentation.displayText,
      this.resolveCellTextOverflow(column, snapshot),
      Math.max(0, columnWidth - tokens.paddingH * 2 - arrowReserve),
      presentation.fontSize,
      presentation.fontFamily,
      snapshot,
    )
    dl.fillText(
      paintText,
      textX,
      rowY + snapshot.viewport.rowHeight / 2,
      presentation.textColor,
      presentation.fontSize,
      presentation.fontFamily,
      align,
      'middle',
    )
    const iconSize = tokens.fontSize * 0.8
    const arrowX = columnX + columnWidth - tokens.paddingH - tokens.fontSize / 2
    paintIconGlyph(context, {
      name: 'chevron-down',
      x: arrowX - iconSize / 2,
      y: rowY + (snapshot.viewport.rowHeight - iconSize) / 2,
      size: iconSize,
      color: resolveTextColor(tokens.dropdownArrowText, 'normal'),
    })
  }

  private paintScrollbars(
    dl: DrawList,
    x: number,
    y: number,
    bodyY: number,
    bodyH: number,
    scrollbarWidth: number,
    snapshot: GridPainterSnapshot<T>,
  ): void {
    const viewport = snapshot.viewport
    paintVBar({
      dl,
      style: snapshot.scrollbarTokens,
      trackX: x + viewport.viewWidth,
      trackY: bodyY,
      trackW: scrollbarWidth,
      trackH: bodyH,
      viewSize: viewport.viewHeight,
      contentSize: viewport.totalContentHeight(snapshot.visibleItems.length),
      scrollOffset: viewport.scrollY,
      state: viewport.vScrollbar,
    })
    const scrollableViewWidth = viewport.scrollableViewWidth(snapshot.columns)
    if (scrollableViewWidth > 0) {
      paintHBar({
        dl,
        style: snapshot.scrollbarTokens,
        trackX: x + viewport.fixedRegionWidth(snapshot.columns),
        trackY: y + viewport.headerSectionHeight + viewport.viewHeight + viewport.footerHeight,
        trackW: scrollableViewWidth,
        trackH: scrollbarWidth,
        viewSize: scrollableViewWidth,
        contentSize: viewport.scrollableContentWidth(snapshot.columns),
        scrollOffset: viewport.scrollX,
        state: viewport.hScrollbar,
      })
    }
  }

  private paintStateLayer(
    dl: DrawList,
    x: number,
    y: number,
    width: number,
    height: number,
    snapshot: GridPainterSnapshot<T>,
  ): void {
    const tokens = snapshot.gridTokens
    dl.fillRect(x, y, width, height, tokens.windowBg, 0)
    const message = snapshot.stateMessage || this.defaultStateMessage(snapshot.dataState)
    dl.fillText(
      message,
      x + width / 2,
      y + height / 2,
      resolveTextColor(tokens.cellTextState, 'disabled'),
      tokens.fontSize,
      tokens.fontFamily,
      'center',
      'middle',
    )
  }

  private paintSummaryFooter(
    dl: DrawList,
    x: number,
    y: number,
    viewWidth: number,
    snapshot: GridPainterSnapshot<T>,
  ): void {
    const tokens = snapshot.gridTokens
    const viewport = snapshot.viewport
    dl.fillRect(x, y, viewWidth, snapshot.footerHeight, resolveBgColor(tokens.headerBgState, 'normal'), 0)
    dl.line(x, y, x + viewWidth, y, tokens.separator, 1)
    for (let colIndex = 0; colIndex < snapshot.columns.length; colIndex++) {
      const column = snapshot.columns[colIndex]!
      const columnWidth = viewport.colWidths[colIndex]!
      const columnX = viewport.cellX(snapshot.columns, x, colIndex)
      const visibleCell = viewport.visibleCellRect(snapshot.columns, x, colIndex)
      if (visibleCell.w <= 0) continue
      const clipX = visibleCell.x
      const clipW = visibleCell.w
      dl.strokeRect(clipX, y, clipW, snapshot.footerHeight, tokens.separator, 0.5, 0)

      const cell = snapshot.summaryCells.find(entry => entry.key === column.key)
      if (!cell && (snapshot.summaryCells.length === 0 || colIndex !== 0)) continue
      const text = cell?.text ?? 'Summary'
      const align = cell ? column.align ?? 'right' : 'left'
      const textX = align === 'right'
        ? columnX + columnWidth - tokens.paddingH
        : align === 'center'
          ? columnX + columnWidth / 2
          : columnX + tokens.paddingH
      const paintText = this.resolvePaintText(
        text,
        column.cellTextOverflow ?? snapshot.cellTextOverflow,
        Math.max(0, columnWidth - tokens.paddingH * 2),
        tokens.fontSize,
        tokens.fontFamily,
        snapshot,
      )
      dl.pushClip(clipX + 1, y, Math.max(0, clipW - 2), snapshot.footerHeight)
      dl.fillText(
        paintText,
        textX,
        y + snapshot.footerHeight / 2,
        resolveTextColor(tokens.cellTextState, 'normal'),
        tokens.fontSize,
        tokens.fontFamily,
        align,
        'middle',
      )
      dl.popClip()
    }
  }

  private resolveCellTextOverflow(column: GridColumnDef<T>, snapshot: GridPainterSnapshot<T>): GridCellTextOverflow {
    return column.cellTextOverflow ?? snapshot.cellTextOverflow
  }

  private resolvePaintText(
    text: string,
    overflow: GridCellTextOverflow,
    maxWidth: number,
    fontSize: number,
    fontFamily: string,
    snapshot: GridPainterSnapshot<T>,
  ): string {
    if (overflow !== 'ellipsis') return text
    return ellipsizeText(text, maxWidth, value => snapshot.measureText(value, fontSize, fontFamily))
  }

  private isCellSelected(row: number, col: number, ranges: GridCellRange[]): boolean {
    return ranges.some(range => {
      const startRow = Math.min(range.startRow, range.endRow)
      const endRow = Math.max(range.startRow, range.endRow)
      const startCol = Math.min(range.startCol, range.endCol)
      const endCol = Math.max(range.startCol, range.endCol)
      return row >= startRow && row <= endRow && col >= startCol && col <= endCol
    })
  }

  private defaultStateMessage(state: GridDataState): string {
    if (state === 'loading') return 'Loading...'
    if (state === 'error') return 'Unable to load data'
    if (state === 'empty') return 'No data'
    return ''
  }

  private filterRowText(column: GridColumnDef<T>, snapshot: GridPainterSnapshot<T>): string {
    const legacyValue = snapshot.filterValues.get(column.key)
    if (legacyValue) return legacyValue
    const rule = snapshot.filters.find(entry => entry.key === column.key)
    if (!rule) return ''
    if (rule.operator === 'empty') return 'Empty'
    if (rule.operator === 'notEmpty') return 'Not empty'
    if (rule.operator === 'between') return `${String(rule.value ?? '')}..${String(rule.valueTo ?? '')}`
    const value = String(rule.value ?? '')
    if (rule.operator === 'contains' || rule.operator === 'equals') return value
    return `${this.filterOperatorLabel(rule.operator)}: ${value}`
  }

  private filterOperatorLabel(operator: GridFilterRule['operator']): string {
    if (operator === 'startsWith') return 'Starts'
    if (operator === 'endsWith') return 'Ends'
    if (operator === 'gt') return '>'
    if (operator === 'gte') return '>='
    if (operator === 'lt') return '<'
    if (operator === 'lte') return '<='
    return operator
  }

  groupRowMetrics(
    originX: number,
    depth: number,
    tokens: ResolvedGridCellStyleTokens,
  ): { arrowCenterX: number; labelX: number } {
    const indent = depth * 16
    return {
      arrowCenterX: originX + tokens.paddingH + indent + 6,
      labelX: originX + tokens.paddingH + indent + 16,
    }
  }

  private formatGroupValue(
    column: GridColumnDef<T> | undefined,
    value: unknown,
    lookupValues: GridLookupValueResolver<T>,
  ): string {
    if (!column) return String(value ?? '')
    if (column.type === 'select') {
      const option = column.options.find(entry => entry.value === value)
      return option ? option.label : String(value ?? '')
    }
    if (column.type === 'select-grid') {
      const match = lookupValues.resolve(column, value)
      return match ? String(match[column.labelKey] ?? '') : String(value ?? '')
    }
    if (column.type === 'time') {
      return defaultGridCellDisplayText(
        column,
        { [column.key]: value } as T,
        0,
        lookupValues,
      )
    }
    return String(value ?? '')
  }

  private drawArrow(
    dl: DrawList,
    x: number,
    y: number,
    direction: 'up' | 'down',
    color: Color,
  ): void {
    const ctx = (dl as any).ctx as CanvasRenderingContext2D
    ctx.save()
    ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a})`
    ctx.beginPath()
    if (direction === 'up') {
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

  private drawDisclosureArrow(
    dl: DrawList,
    x: number,
    y: number,
    direction: 'down' | 'right',
    color: Color,
  ): void {
    const ctx = (dl as any).ctx as CanvasRenderingContext2D
    ctx.save()
    ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a})`
    ctx.beginPath()
    if (direction === 'down') {
      ctx.moveTo(x - 4, y - 2)
      ctx.lineTo(x + 4, y - 2)
      ctx.lineTo(x, y + 3)
    } else {
      ctx.moveTo(x - 2, y - 4)
      ctx.lineTo(x - 2, y + 4)
      ctx.lineTo(x + 3, y)
    }
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
}
