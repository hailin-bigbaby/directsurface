import { TextMeasurer } from '../core/text_measurer'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import { FocusManager, type Focusable } from '../core/focus_manager'
import { RenderBox, resolveChildLayout } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import { deriveEntryGridStyle } from '../theme/component_styles'
import type { PaintContext } from '../rendering/paint_context'
import { RenderFormField } from './form_field'

export interface EntryGridTrackOptions {
  min?: number
  max?: number
  grow?: number
  shrink?: number
}

export type EntryGridTrack =
  | ({ type: 'px'; value: number } & EntryGridTrackOptions)
  | ({ type: 'fr'; value: number } & EntryGridTrackOptions)
  | ({ type: 'auto' } & EntryGridTrackOptions)

export function px(value: number, options: EntryGridTrackOptions = {}): EntryGridTrack {
  return { type: 'px', value, ...options }
}
export function fr(value: number, options: EntryGridTrackOptions = {}): EntryGridTrack {
  return { type: 'fr', value, ...options }
}
export function auto(options: EntryGridTrackOptions = {}): EntryGridTrack {
  return { type: 'auto', ...options }
}

export function labelTrack(options: EntryGridTrackOptions = {}): EntryGridTrack {
  return auto({ min: 56, shrink: 1, ...options })
}

export function fieldTrack(flex = 1, options: EntryGridTrackOptions = {}): EntryGridTrack {
  return fr(flex, { min: 96, shrink: flex, ...options })
}

export function wideFieldTrack(flex = 2, options: EntryGridTrackOptions = {}): EntryGridTrack {
  return fr(flex, { min: 128, shrink: flex, ...options })
}

export function unitTrack(options: EntryGridTrackOptions = {}): EntryGridTrack {
  return auto({ min: 24, max: 72, shrink: 0, ...options })
}

export function metaTrack(options: EntryGridTrackOptions = {}): EntryGridTrack {
  return auto({ min: 40, max: 120, shrink: 1, ...options })
}

export interface EntryGridChildData {
  columnSpan?: number
  rowSpan?: number
}

export type EntryGridValidationPresentation = 'none' | 'row-feedback'
export type EntryGridEnterNavigation = 'none' | 'next-focusable'

interface EntryGridPlacement {
  row: number
  col: number
  columnSpan: number
  rowSpan: number
}

type EntryGridFeedbackTone = 'error' | 'warning'

interface EntryGridFeedbackEntry {
  row: number
  label: string
  message: string
  tone: EntryGridFeedbackTone
  x: number
  width: number
  height: number
  lines: string[]
}

interface EntryGridFeedbackBlockLayout extends EntryGridFeedbackEntry {
  y: number
}

export class RenderEntryGrid extends RenderBox {
  static override debugTypeName = 'RenderEntryGrid'
  private readonly _children: RenderBox[] = []
  private readonly _childData = new Map<RenderBox, Readonly<EntryGridChildData>>()
  private _columns: readonly Readonly<EntryGridTrack>[]
  private _columnGap?: number
  private _rowGap?: number
  private _validationPresentation: EntryGridValidationPresentation
  private _enterNavigation: EntryGridEnterNavigation
  private _feedbackLayouts = new Map<number, EntryGridFeedbackBlockLayout[]>()

  constructor(opts: {
    columns: readonly EntryGridTrack[]
    columnGap?: number
    rowGap?: number
    validationPresentation?: EntryGridValidationPresentation
    enterNavigation?: EntryGridEnterNavigation
  }) {
    super()
    this._columns = this._normalizeColumns(opts.columns)
    this._columnGap = opts.columnGap
    this._rowGap = opts.rowGap
    this._validationPresentation = opts.validationPresentation ?? 'none'
    this._enterNavigation = opts.enterNavigation ?? 'none'
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  get children(): readonly RenderBox[] { return this._children }
  get childData(): ReadonlyMap<RenderBox, Readonly<EntryGridChildData>> { return this._childData }
  get columns(): readonly Readonly<EntryGridTrack>[] { return this._columns }

  get columnGap(): number | undefined { return this._columnGap }
  set columnGap(value: number | undefined) {
    if (this._columnGap === value) return
    this._columnGap = value
    this.markNeedsLayout()
  }

  get rowGap(): number | undefined { return this._rowGap }
  set rowGap(value: number | undefined) {
    if (this._rowGap === value) return
    this._rowGap = value
    this.markNeedsLayout()
  }

  get validationPresentation(): EntryGridValidationPresentation { return this._validationPresentation }
  set validationPresentation(value: EntryGridValidationPresentation) {
    if (this._validationPresentation === value) return
    this._validationPresentation = value
    this._syncValidationPresentationOverrides()
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get enterNavigation(): EntryGridEnterNavigation { return this._enterNavigation }
  set enterNavigation(value: EntryGridEnterNavigation) {
    if (this._enterNavigation === value) return
    this._enterNavigation = value
  }

  addChild(child: RenderBox, data: EntryGridChildData = {}): void {
    this.insertChild(this._children.length, child, data)
  }

  insertChild(index: number, child: RenderBox, data: EntryGridChildData = {}): void {
    this._assertInsertionIndex(index)
    this._assertCanAdopt(child)
    this._adopt(child)
    this._children.splice(index, 0, child)
    this._childData.set(child, this._normalizeChildData(data))
    this._syncValidationPresentationOverride(child)
    this.markNeedsLayout()
  }

  removeChild(child: RenderBox): boolean {
    const index = this._children.indexOf(child)
    if (index < 0) return false
    this._children.splice(index, 1)
    this._childData.delete(child)
    this._release(child)
    this.markNeedsLayout()
    return true
  }

  moveChild(child: RenderBox, targetIndex: number): boolean {
    const currentIndex = this._children.indexOf(child)
    if (currentIndex < 0) return false
    this._assertExistingIndex(targetIndex)
    if (currentIndex === targetIndex) return true
    this._children.splice(currentIndex, 1)
    this._children.splice(targetIndex, 0, child)
    this.markNeedsLayout()
    return true
  }

  replaceChild(
    current: RenderBox,
    next: RenderBox,
    data: EntryGridChildData = this._childData.get(current) ?? {},
  ): boolean {
    const index = this._children.indexOf(current)
    if (index < 0) return false
    if (current === next) return this.setChildData(current, data)
    this._assertCanAdopt(next)
    this._adopt(next)
    this._children[index] = next
    this._childData.delete(current)
    this._childData.set(next, this._normalizeChildData(data))
    this._syncValidationPresentationOverride(next)
    this._release(current)
    this.markNeedsLayout()
    return true
  }

  setChildData(child: RenderBox, data: EntryGridChildData): boolean {
    if (!this._childData.has(child)) return false
    this._childData.set(child, this._normalizeChildData(data))
    this.markNeedsLayout()
    return true
  }

  getChildData(child: RenderBox): Readonly<EntryGridChildData> | undefined {
    return this._childData.get(child)
  }

  clearChildren(): void {
    if (this._children.length === 0) return
    const children = [...this._children]
    this._children.length = 0
    this._childData.clear()
    for (const child of children) this._release(child)
    this.markNeedsLayout()
  }

  setColumns(columns: readonly EntryGridTrack[]): void {
    this._columns = this._normalizeColumns(columns)
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      for (const child of this._children) visitor(child)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    for (const child of this._children) visitor(child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    this._syncValidationPresentationOverrides()
    const style = deriveEntryGridStyle(context.theme)
    const columnGap = this._columnGap ?? style.columnGap
    const rowGap = this._rowGap ?? style.rowGap
    const columnCount = this._columns.length
    const containerWidth = constraints.maxWidth === Infinity ? 0 : constraints.maxWidth
    const visibleChildren = this._children.filter(child => child.participatesInLayout)
    const placements = this._resolvePlacements(columnCount, visibleChildren)
    const columnWidths = this._resolveColumns(visibleChildren, containerWidth, columnGap, placements, context)

    const columnOffsets: number[] = []
    let cursorX = 0
    for (let index = 0; index < columnCount; index += 1) {
      columnOffsets.push(cursorX)
      cursorX += (columnWidths[index] ?? 0) + (index < columnCount - 1 ? columnGap : 0)
    }

    const rowHeights: number[] = []
    for (let index = 0; index < visibleChildren.length; index += 1) {
      const child = visibleChildren[index]!
      const placement = placements[index]!
      const childWidth = this._spanExtent(columnWidths, placement.col, placement.columnSpan, columnGap)
      const childLayout = resolveChildLayout(
        child,
        { minWidth: childWidth, maxWidth: childWidth, minHeight: 0, maxHeight: Infinity },
        'stretch',
        placement.rowSpan > 1 ? 'start' : 'center',
      )
      child.layout(childLayout.constraints, true, context)

      if (placement.rowSpan === 1) {
        rowHeights[placement.row] = Math.max(rowHeights[placement.row] ?? 0, child.outerSize.height)
        continue
      }

      const currentSpanHeight = this._spanExtent(rowHeights, placement.row, placement.rowSpan, rowGap)
      if (currentSpanHeight >= child.outerSize.height) continue
      const missing = child.outerSize.height - currentSpanHeight
      const increment = missing / placement.rowSpan
      for (let rowIndex = 0; rowIndex < placement.rowSpan; rowIndex += 1) {
        const row = placement.row + rowIndex
        rowHeights[row] = (rowHeights[row] ?? 0) + increment
      }
    }

    const rowOffsets: number[] = []
    let cursorY = 0
    const feedbackLayouts = new Map<number, EntryGridFeedbackBlockLayout[]>()
    const feedbackEntriesByRow = this._validationPresentation === 'row-feedback'
      ? this._collectRowFeedback(visibleChildren, placements, columnOffsets, columnWidths, columnGap, style, context)
      : new Map<number, EntryGridFeedbackEntry[]>()
    for (let index = 0; index < rowHeights.length; index += 1) {
      rowOffsets.push(cursorY)
      cursorY += rowHeights[index] ?? 0
      const rowFeedbackLayouts = this._layoutRowFeedback(
        feedbackEntriesByRow.get(index) ?? [],
        style,
        cursorY + style.feedbackGap,
      )
      if (rowFeedbackLayouts.length > 0) {
        feedbackLayouts.set(index, rowFeedbackLayouts)
        const feedbackHeight = this._measureFeedbackHeight(rowFeedbackLayouts)
        cursorY += style.feedbackGap + feedbackHeight
      }
      if (index < rowHeights.length - 1) cursorY += rowGap
    }
    this._feedbackLayouts = feedbackLayouts

    for (let index = 0; index < visibleChildren.length; index += 1) {
      const child = visibleChildren[index]!
      const placement = placements[index]!
      const spanHeight = this._spanExtent(rowHeights, placement.row, placement.rowSpan, rowGap)
      const childWidth = this._spanExtent(columnWidths, placement.col, placement.columnSpan, columnGap)
      const childLayout = resolveChildLayout(
        child,
        { minWidth: childWidth, maxWidth: childWidth, minHeight: spanHeight, maxHeight: spanHeight },
        'stretch',
        placement.rowSpan > 1 ? 'start' : 'center',
      )
      child.layout(childLayout.constraints, true, context)
      child.positionInSlot({
        x: columnOffsets[placement.col] ?? 0,
        y: rowOffsets[placement.row] ?? 0,
        width: childWidth,
        height: spanHeight,
      }, childLayout.horizontalAlignment, childLayout.verticalAlignment)
    }

    const totalHeight = rowOffsets.length > 0
      ? cursorY
      : 0

    this.size = {
      width: Math.max(containerWidth, cursorX),
      height: totalHeight,
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    super.performPaint(context, offset)
    if (this._feedbackLayouts.size > 0) this._paintFeedback(context, offset)
  }

  handleUnhandledEnterFromDescendant(target: Focusable, event: KeyboardEvent): boolean {
    if (this._enterNavigation === 'none') return false
    if (event.ctrlKey || event.metaKey || event.altKey) return false
    const dir: 1 | -1 = event.shiftKey ? -1 : 1
    return FocusManager.instance.moveFocusFrom(target, dir, { withinRoot: this, wrap: false })
  }

  private _resolvePlacements(columnCount: number, children: readonly RenderBox[]): EntryGridPlacement[] {
    const occupied: boolean[][] = []
    const placements: EntryGridPlacement[] = []
    let cursorRow = 0
    let cursorCol = 0

    const isOccupied = (row: number, col: number): boolean => occupied[row]?.[col] ?? false
    const markOccupied = (row: number, col: number): void => {
      if (!occupied[row]) occupied[row] = []
      occupied[row]![col] = true
    }
    const canPlace = (row: number, col: number, columnSpan: number, rowSpan: number): boolean => {
      if (col + columnSpan > columnCount) return false
      for (let rowIndex = 0; rowIndex < rowSpan; rowIndex += 1) {
        for (let colIndex = 0; colIndex < columnSpan; colIndex += 1) {
          if (isOccupied(row + rowIndex, col + colIndex)) return false
        }
      }
      return true
    }

    for (const child of children) {
      const data = this._childData.get(child) ?? {}
      const columnSpan = Math.max(1, Math.min(data.columnSpan ?? 1, columnCount))
      const rowSpan = Math.max(1, data.rowSpan ?? 1)

      while (!canPlace(cursorRow, cursorCol, columnSpan, rowSpan)) {
        cursorCol += 1
        if (cursorCol >= columnCount) {
          cursorCol = 0
          cursorRow += 1
        }
      }

      placements.push({ row: cursorRow, col: cursorCol, columnSpan, rowSpan })
      for (let rowIndex = 0; rowIndex < rowSpan; rowIndex += 1) {
        for (let colIndex = 0; colIndex < columnSpan; colIndex += 1) {
          markOccupied(cursorRow + rowIndex, cursorCol + colIndex)
        }
      }

      cursorCol += 1
      if (cursorCol >= columnCount) {
        cursorCol = 0
        cursorRow += 1
      }
    }

    return placements
  }

  private _resolveColumns(
    children: readonly RenderBox[],
    containerWidth: number,
    columnGap: number,
    placements: EntryGridPlacement[],
    context: LayoutContext,
  ): number[] {
    const totalGap = Math.max(0, this._columns.length - 1) * columnGap
    const widths = new Array(this._columns.length).fill(0)
    const naturalWidths = new Array(this._columns.length).fill(0)
    const minWidthHints = new Array(this._columns.length).fill(0)
    const minWidths = new Array(this._columns.length).fill(0)
    const maxWidths = new Array(this._columns.length).fill(Infinity)

    for (let index = 0; index < this._columns.length; index += 1) {
      const track = this._columns[index]!
      if (track.type === 'px') naturalWidths[index] = track.value
    }

    for (let index = 0; index < children.length; index += 1) {
      const placement = placements[index]!
      if (placement.columnSpan !== 1) continue
      const child = children[index]!
      const size = child.measure({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity }, context)
      const naturalWidth = size.width
      const minWidthHint = child.getMinLayoutWidthHint() ?? 0
      const track = this._columns[placement.col]!
      if (track.type === 'auto' || track.type === 'fr') {
        naturalWidths[placement.col] = Math.max(naturalWidths[placement.col] ?? 0, naturalWidth)
        minWidthHints[placement.col] = Math.max(minWidthHints[placement.col] ?? 0, minWidthHint)
      }
    }

    for (let index = 0; index < this._columns.length; index += 1) {
      const track = this._columns[index]!
      const naturalWidth = naturalWidths[index] ?? 0
      const minWidthHint = minWidthHints[index] ?? 0
      minWidths[index] = this._resolveTrackMin(track, naturalWidth, minWidthHint)
      maxWidths[index] = this._resolveTrackMax(track, naturalWidth)
      widths[index] = this._resolveTrackBase(track, naturalWidth, minWidths[index]!, maxWidths[index]!)
    }

    const baseTotal = widths.reduce((sum, width) => sum + width, 0)
    const growTotal = this._columns.reduce((sum, track) => sum + this._growFactor(track), 0)
    const extra = Math.max(0, containerWidth - totalGap - baseTotal)
    if (extra > 0 && growTotal > 0) {
      for (let index = 0; index < this._columns.length; index += 1) {
        const grow = this._growFactor(this._columns[index]!)
        if (grow <= 0) continue
        widths[index] = Math.min(
          maxWidths[index]!,
          widths[index]! + (grow / growTotal) * extra,
        )
      }
    }

    let total = widths.reduce((sum, width) => sum + width, 0) + totalGap
    let deficit = Math.max(0, total - containerWidth)
    while (deficit > 0.001) {
      const shrinkable = this._columns
        .map((track, index) => ({
          index,
          shrink: this._shrinkFactor(track),
          capacity: Math.max(0, (widths[index] ?? 0) - (minWidths[index] ?? 0)),
        }))
        .filter(item => item.shrink > 0 && item.capacity > 0)

      if (shrinkable.length === 0) break

      const shrinkTotal = shrinkable.reduce((sum, item) => sum + item.shrink, 0)
      let consumed = 0
      for (const item of shrinkable) {
        const share = deficit * (item.shrink / shrinkTotal)
        const delta = Math.min(item.capacity, share)
        widths[item.index] = (widths[item.index] ?? 0) - delta
        consumed += delta
      }
      if (consumed <= 0.001) break

      total = widths.reduce((sum, width) => sum + width, 0) + totalGap
      deficit = Math.max(0, total - containerWidth)
    }

    return widths
  }

  private _resolveTrackMin(track: EntryGridTrack, naturalWidth: number, minWidthHint: number): number {
    if (track.min !== undefined) return Math.max(track.min, minWidthHint)
    if (track.type === 'px') return track.value
    if (track.type === 'auto') return Math.max(naturalWidth, minWidthHint)
    return Math.max(0, minWidthHint)
  }

  private _resolveTrackMax(track: EntryGridTrack, naturalWidth: number): number {
    if (track.max !== undefined) return track.max
    if (track.type === 'px') return track.value
    if (track.type === 'auto') return naturalWidth
    return Infinity
  }

  private _resolveTrackBase(track: EntryGridTrack, naturalWidth: number, min: number, max: number): number {
    const preferred = track.type === 'px'
      ? track.value
      : track.type === 'auto'
        ? naturalWidth
        : min
    return Math.min(max, Math.max(min, preferred))
  }

  private _growFactor(track: EntryGridTrack): number {
    if (track.type === 'fr') return track.grow ?? track.value
    return track.grow ?? 0
  }

  private _shrinkFactor(track: EntryGridTrack): number {
    if (track.type === 'fr') return track.shrink ?? track.value
    return track.shrink ?? 0
  }

  private _spanExtent(values: number[], start: number, span: number, gap: number): number {
    let total = 0
    for (let index = 0; index < span; index += 1) {
      total += values[start + index] ?? 0
      if (index < span - 1) total += gap
    }
    return total
  }

  private _collectRowFeedback(
    children: readonly RenderBox[],
    placements: EntryGridPlacement[],
    columnOffsets: number[],
    columnWidths: number[],
    columnGap: number,
    style: ReturnType<typeof deriveEntryGridStyle>,
    context: LayoutContext,
  ): Map<number, EntryGridFeedbackEntry[]> {
    const entries = new Map<number, EntryGridFeedbackEntry[]>()
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]
      if (!(child instanceof RenderFormField)) continue
      if (!child.message) continue
      if (child.status !== 'error' && child.status !== 'warning') continue
      const placement = placements[index]
      if (!placement) continue
      const targetRow = placement.row + placement.rowSpan - 1
      const spanWidth = this._spanExtent(columnWidths, placement.col, placement.columnSpan, columnGap)
      const spanX = columnOffsets[placement.col] ?? 0
      const rawEditorInsetX = child.child ? child.child.offset.x : 0
      const editorInsetX = Number.isFinite(rawEditorInsetX)
        ? Math.max(0, Math.min(spanWidth, rawEditorInsetX))
        : 0
      const editorWidth = Math.max(0, spanWidth - editorInsetX)
      const minReadableContentWidth = Math.max(
        TextMeasurer.measureWidth('W', style.feedbackFontSize, context.theme.fontFamily),
        TextMeasurer.measureWidth('国', style.feedbackFontSize, context.theme.fontFamily),
      )
      const useEditorLane = editorWidth - style.feedbackPaddingX * 2 >= minReadableContentWidth
      const x = spanX + (useEditorLane ? editorInsetX : 0)
      const width = useEditorLane ? editorWidth : Math.max(0, spanWidth)
      const text = `${child.label}: ${child.message}`
      const lines = this._wrapFeedbackLines(
        text,
        Math.max(0, width - style.feedbackPaddingX * 2),
        style.feedbackFontSize,
        context.theme.fontFamily,
      )
      const height = Math.max(
        style.feedbackLineHeight + style.feedbackPaddingY * 2,
        lines.length * style.feedbackLineHeight + style.feedbackPaddingY * 2,
      )
      const rowEntries = entries.get(targetRow) ?? []
      rowEntries.push({
        row: targetRow,
        label: child.label,
        message: child.message,
        tone: child.status,
        x,
        width,
        height,
        lines,
      })
      entries.set(targetRow, rowEntries)
    }
    return entries
  }

  private _layoutRowFeedback(
    entries: EntryGridFeedbackEntry[],
    style: ReturnType<typeof deriveEntryGridStyle>,
    startY: number,
  ): EntryGridFeedbackBlockLayout[] {
    if (entries.length === 0) return []
    const laneEntries: Array<EntryGridFeedbackEntry[]> = []
    const laneHeights: number[] = []
    const sortedEntries = [...entries].sort((a, b) => a.x - b.x)
    for (const entry of sortedEntries) {
      let laneIndex = 0
      while (laneIndex < laneEntries.length) {
        const conflict = laneEntries[laneIndex]!.some(candidate =>
          !(entry.x >= candidate.x + candidate.width + style.feedbackItemGap ||
            candidate.x >= entry.x + entry.width + style.feedbackItemGap))
        if (!conflict) break
        laneIndex += 1
      }
      if (!laneEntries[laneIndex]) {
        laneEntries[laneIndex] = []
        laneHeights[laneIndex] = 0
      }
      laneEntries[laneIndex]!.push(entry)
      laneHeights[laneIndex] = Math.max(laneHeights[laneIndex] ?? 0, entry.height)
    }
    const layouts: EntryGridFeedbackBlockLayout[] = []
    let laneY = startY
    for (let laneIndex = 0; laneIndex < laneEntries.length; laneIndex += 1) {
      const entriesInLane = laneEntries[laneIndex] ?? []
      for (const entry of entriesInLane) {
        layouts.push({
          ...entry,
          y: laneY,
        })
      }
      laneY += (laneHeights[laneIndex] ?? 0) + style.feedbackItemGap
    }
    return layouts
  }

  private _measureFeedbackHeight(layouts: EntryGridFeedbackBlockLayout[]): number {
      if (layouts.length === 0) return 0
    let minY = layouts[0]!.y
    let maxY = layouts[0]!.y + layouts[0]!.height
    for (const layout of layouts) {
      minY = Math.min(minY, layout.y)
      maxY = Math.max(maxY, layout.y + layout.height)
    }
    return maxY - minY
  }

  private _paintFeedback(context: PaintContext, offset: Offset): void {
    const style = deriveEntryGridStyle(context.theme)
    const dl = new DrawList(context)
    for (const layouts of this._feedbackLayouts.values()) {
      for (const layout of layouts) {
        const colors = layout.tone === 'error'
          ? {
              bg: style.feedbackColors.errorBg,
              border: style.feedbackColors.errorBorder,
              text: style.feedbackColors.errorText,
            }
          : {
              bg: style.feedbackColors.warningBg,
              border: style.feedbackColors.warningBorder,
              text: style.feedbackColors.warningText,
            }
        dl.fillRect(
          offset.x + layout.x,
          offset.y + layout.y,
          layout.width,
          layout.height,
          colors.bg,
          style.feedbackRadius,
        )
        dl.strokeRect(
          offset.x + layout.x,
          offset.y + layout.y,
          layout.width,
          layout.height,
          colors.border,
          1,
          style.feedbackRadius,
        )
        dl.pushClip(
          offset.x + layout.x,
          offset.y + layout.y,
          layout.width,
          layout.height,
        )
        try {
          dl.fillText(
            layout.lines[0] ?? '',
            offset.x + layout.x + style.feedbackPaddingX,
            offset.y + layout.y + style.feedbackPaddingY + style.feedbackLineHeight / 2,
            colors.text,
            style.feedbackFontSize,
            context.theme.fontFamily,
            'left',
            'middle',
          )
          for (let index = 1; index < layout.lines.length; index += 1) {
            dl.fillText(
              layout.lines[index] ?? '',
              offset.x + layout.x + style.feedbackPaddingX,
              offset.y + layout.y + style.feedbackPaddingY + style.feedbackLineHeight / 2 + style.feedbackLineHeight * index,
              colors.text,
              style.feedbackFontSize,
              context.theme.fontFamily,
              'left',
              'middle',
            )
          }
        } finally {
          dl.popClip()
        }
      }
    }
  }

  private _wrapFeedbackLines(
    text: string,
    maxWidth: number,
    fontSize: number,
    fontFamily: string,
  ): string[] {
    if (!Number.isFinite(maxWidth) || maxWidth <= 0) return [text]
    const lines: string[] = []
    let current = ''
    for (const char of text) {
      const next = current + char
      if (current && TextMeasurer.measureWidth(next, fontSize, fontFamily) > maxWidth) {
        lines.push(current)
        current = char === ' ' ? '' : char
      } else {
        current = next
      }
    }
    if (current) lines.push(current)
    return lines.length > 0 ? lines : ['']
  }

  private _assertCanAdopt(child: RenderBox): void {
    if (this._children.includes(child) || child.parent === this) {
      throw new Error('RenderEntryGrid cannot contain the same child more than once')
    }
    if (child.parent !== undefined) {
      throw new Error('RenderEntryGrid cannot adopt a child that already has a parent')
    }
    if (child.owner !== undefined) {
      throw new Error('RenderEntryGrid cannot adopt a child that is already attached to a render tree')
    }
  }

  private _adopt(child: RenderBox): void {
    child.parent = this
    try {
      if (this.owner && !child.owner) child.attach(this.owner)
    } catch (error) {
      child.parent = undefined
      throw error
    }
  }

  private _release(child: RenderBox): void {
    if (child instanceof RenderFormField) {
      child.setParentValidationDisplayOverride(undefined, { markNeedsLayout: false })
      child.releaseExternalAdorners()
    }
    if (child.owner) child.detach()
    child.parent = undefined
  }

  private _assertInsertionIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index > this._children.length) {
      throw new RangeError(`EntryGrid insertion index ${index} is outside 0..${this._children.length}`)
    }
  }

  private _assertExistingIndex(index: number): void {
    const maxIndex = this._children.length - 1
    if (!Number.isInteger(index) || index < 0 || index > maxIndex) {
      throw new RangeError(`EntryGrid target index ${index} is outside 0..${maxIndex}`)
    }
  }

  private _normalizeChildData(data: EntryGridChildData): Readonly<EntryGridChildData> {
    const columnSpan = this._normalizePositiveInteger(data.columnSpan)
    const rowSpan = this._normalizePositiveInteger(data.rowSpan)
    return Object.freeze({
      ...(columnSpan === undefined ? {} : { columnSpan }),
      ...(rowSpan === undefined ? {} : { rowSpan }),
    })
  }

  private _normalizePositiveInteger(value: number | undefined): number | undefined {
    if (value === undefined) return undefined
    if (!Number.isFinite(value)) return 1
    return Math.max(1, Math.floor(value))
  }

  private _normalizeColumns(columns: readonly EntryGridTrack[]): readonly Readonly<EntryGridTrack>[] {
    if (columns.length === 0) throw new Error('RenderEntryGrid requires at least one column track')
    return Object.freeze(columns.map(track => Object.freeze({ ...track })))
  }

  private _syncValidationPresentationOverrides(): void {
    for (const child of this._children) this._syncValidationPresentationOverride(child)
  }

  private _syncValidationPresentationOverride(child: RenderBox): void {
    if (!(child instanceof RenderFormField)) return
    child.setParentValidationDisplayOverride(
      this._validationPresentation === 'row-feedback' ? 'status-only' : undefined,
      { markNeedsLayout: false },
    )
  }
}
