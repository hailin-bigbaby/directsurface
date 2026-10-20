import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset, type Size } from '../core/render_object'
import { RenderBox, RenderPanel, type RenderPanelOptions } from './render_box'
import type { PaintContext } from '../rendering/paint_context'
import { deriveLayoutStyle } from '../theme/component_styles'

export type GridPanelTrack =
  | { type: 'px'; value: number }
  | { type: 'fr'; value: number; min?: number; max?: number }
  | { type: 'auto'; min?: number; max?: number }

export interface GridPanelChildData {
  row?: number
  column?: number
  rowSpan?: number
  columnSpan?: number
}

interface GridPanelPlacement {
  row: number
  column: number
  rowSpan: number
  columnSpan: number
}

export function gridPx(value: number): GridPanelTrack {
  return { type: 'px', value }
}

export function gridFr(value = 1, options: { min?: number; max?: number } = {}): GridPanelTrack {
  return { type: 'fr', value, ...options }
}

export function gridStar(value = 1, options: { min?: number; max?: number } = {}): GridPanelTrack {
  return gridFr(value, options)
}

export function gridAuto(options: { min?: number; max?: number } = {}): GridPanelTrack {
  return { type: 'auto', ...options }
}

export interface GridPanelOptions extends RenderPanelOptions {
  columns?: GridPanelTrack[]
  columnDefinitions?: GridPanelTrack[]
  rows?: GridPanelTrack[]
  rowDefinitions?: GridPanelTrack[]
  columnGap?: number
  rowGap?: number
}

export class RenderGridPanel extends RenderPanel {
  static override debugTypeName = 'RenderGridPanel'
  children: RenderBox[] = []
  childData = new Map<RenderBox, GridPanelChildData>()
  columns: GridPanelTrack[]
  rows: GridPanelTrack[]
  private _columnGap?: number
  private _rowGap?: number

  constructor(options: GridPanelOptions = {}) {
    super(options)
    this.columns = options.columns ?? options.columnDefinitions ?? []
    this.rows = options.rows ?? options.rowDefinitions ?? []
    this._columnGap = options.columnGap
    this._rowGap = options.rowGap
  }

  get columnGap(): number { return this._columnGap ?? 0 }
  set columnGap(value: number) {
    this._columnGap = value
    this.markNeedsLayout()
  }

  get rowGap(): number { return this._rowGap ?? 0 }
  set rowGap(value: number) {
    this._rowGap = value
    this.markNeedsLayout()
  }

  setColumnDefinitions(columns: GridPanelTrack[]): void {
    this.columns = columns
    this.markNeedsLayout()
  }

  setRowDefinitions(rows: GridPanelTrack[]): void {
    this.rows = rows
    this.markNeedsLayout()
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  addChild(child: RenderBox, data: GridPanelChildData = {}): void {
    child.parent = this
    this.children.push(child)
    this.childData.set(child, data)
    this.markNeedsLayout()
  }

  clearChildren(): void {
    for (const child of this.children) {
      child.parent = undefined
      if (child.owner) child.detach()
    }
    this.children = []
    this.childData.clear()
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      for (const child of this.children) visitor(child)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    for (const child of this.children) visitor(child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const contentConstraints = this.deflatePaddingConstraints(constraints)
    const layoutStyle = deriveLayoutStyle(context.theme)
    const columnGap = this._columnGap ?? layoutStyle.itemSpacing
    const rowGap = this._rowGap ?? layoutStyle.itemSpacing
    const visibleChildren = this.children.filter(child => child.participatesInLayout)
    const columnTracks = this.columns.length > 0 ? this.columns : [gridFr()]
    const columnCount = columnTracks.length
    const placements = this._resolvePlacements(columnCount, visibleChildren)
    const rowCount = Math.max(this.rows.length, placements.reduce((max, placement) => Math.max(max, placement.row + placement.rowSpan), 0))
    const rowTracks = Array.from({ length: rowCount }, (_, index) => this.rows[index] ?? gridAuto())

    const availableWidth = this._availableTrackSize(contentConstraints.minWidth, contentConstraints.maxWidth)
    const availableHeight = this._availableTrackSize(contentConstraints.minHeight, contentConstraints.maxHeight)
    const naturalSizes = visibleChildren.map((child, index) =>
      this._needsNaturalSize(columnTracks, placements[index]!, 'column', availableWidth)
        ? child.measureOuter({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity }, context)
        : { width: 0, height: 0 })
    const columnWidths = this._resolveTracks({
      tracks: columnTracks,
      availableSize: availableWidth,
      gap: columnGap,
      naturalSizes: this._naturalTrackSizes(columnTracks, placements, naturalSizes, 'column', columnGap),
    })
    const widthConstrainedSizes = this._measureSizesForColumns(
      visibleChildren, columnWidths, placements, columnGap, context, rowTracks, availableHeight)
    const rowHeights = this._resolveTracks({
      tracks: rowTracks,
      availableSize: availableHeight,
      gap: rowGap,
      naturalSizes: this._naturalTrackSizes(rowTracks, placements, widthConstrainedSizes, 'row', rowGap),
    })

    this.size = this.inflatePaddingSize(constraints, {
      width: this._totalExtent(columnWidths, columnGap),
      height: this._totalExtent(rowHeights, rowGap),
    })
    if (context.pass === 'measure') return

    const columnOffsets = this._offsets(columnWidths, columnGap)
    const rowOffsets = this._offsets(rowHeights, rowGap)

    for (let index = 0; index < visibleChildren.length; index += 1) {
      const child = visibleChildren[index]!
      const placement = placements[index]!
      const cellWidth = this._spanExtent(columnWidths, placement.column, placement.columnSpan, columnGap)
      const cellHeight = this._spanExtent(rowHeights, placement.row, placement.rowSpan, rowGap)
      const horizontalAlignment = child.resolveHorizontalAlignment('stretch')
      const verticalAlignment = child.resolveVerticalAlignment('stretch')
      child.layout({
        minWidth: horizontalAlignment === 'stretch' && child.width === undefined ? cellWidth : 0,
        maxWidth: cellWidth,
        minHeight: verticalAlignment === 'stretch' && child.height === undefined ? cellHeight : 0,
        maxHeight: cellHeight,
      }, true, context)
      child.positionInSlot({
        x: this.contentOffset.x + columnOffsets[placement.column]!,
        y: this.contentOffset.y + rowOffsets[placement.row]!,
        width: cellWidth,
        height: cellHeight,
      }, horizontalAlignment, verticalAlignment)
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    this.paintContentChildren(context, offset)
    this.paintAdornerChildren(context, offset)
  }

  private _resolvePlacements(columnCount: number, children: readonly RenderBox[]): GridPanelPlacement[] {
    const occupied: boolean[][] = []
    const placements: GridPanelPlacement[] = []
    const occupy = (placement: GridPanelPlacement): void => {
      for (let row = placement.row; row < placement.row + placement.rowSpan; row += 1) {
        occupied[row] ??= []
        for (let column = placement.column; column < placement.column + placement.columnSpan; column += 1) {
          occupied[row]![column] = true
        }
      }
    }
    const fits = (row: number, column: number, rowSpan: number, columnSpan: number): boolean => {
      if (column + columnSpan > columnCount) return false
      for (let r = row; r < row + rowSpan; r += 1) {
        for (let c = column; c < column + columnSpan; c += 1) {
          if (occupied[r]?.[c]) return false
        }
      }
      return true
    }
    const indexValue = (value: number | undefined): number | undefined =>
      value !== undefined && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined
    const requested = children.map(child => {
      const data = this.childData.get(child) ?? {}
      const columnSpan = Math.max(1, Math.min(indexValue(data.columnSpan) ?? 1, columnCount))
      const rowSpan = Math.max(1, indexValue(data.rowSpan) ?? 1)
      const column = indexValue(data.column)
      return { row: indexValue(data.row), column: column === undefined ? undefined : Math.min(column, columnCount - columnSpan),
        rowSpan, columnSpan }
    })
    // Explicit placements may overlap intentionally; automatic items must avoid
    // all reserved cells, including explicit items added later.
    for (const data of requested) {
      if (data.row !== undefined && data.column !== undefined) occupy({ ...data, row: data.row, column: data.column })
    }
    let cursorRow = 0
    let cursorColumn = 0
    for (const data of requested) {
      const { rowSpan, columnSpan } = data
      let row = data.row
      let column = data.column
      if (row === undefined || column === undefined) {
        row = row ?? cursorRow
        column = column ?? (data.row === undefined ? cursorColumn : 0)
        while (!fits(row, column, rowSpan, columnSpan)) {
          if (data.column !== undefined) {
            row += 1
          } else {
            column += 1
            if (column + columnSpan > columnCount) { column = 0; row += 1 }
          }
        }
      }
      const placement = { row, column, rowSpan, columnSpan }
      placements.push(placement)
      occupy(placement)
      cursorRow = placement.row
      cursorColumn = placement.column + columnSpan
      if (cursorColumn >= columnCount) {
        cursorColumn = 0
        cursorRow = placement.row + 1
      }
    }
    return placements
  }

  private _needsNaturalSize(tracks: GridPanelTrack[], placement: GridPanelPlacement, axis: 'row' | 'column', available: number): boolean {
    const start = axis === 'column' ? placement.column : placement.row
    const span = axis === 'column' ? placement.columnSpan : placement.rowSpan
    return tracks.slice(start, start + span).some(track => track.type === 'auto' || (track.type === 'fr' && available === Infinity))
  }

  private _measureSizesForColumns(
    children: readonly RenderBox[],
    columnWidths: number[],
    placements: GridPanelPlacement[],
    columnGap: number,
    context: LayoutContext,
    rowTracks: GridPanelTrack[],
    availableHeight: number,
  ): Size[] {
    return children.map((child, index) => {
      const placement = placements[index]!
      if (!this._needsNaturalSize(rowTracks, placement, 'row', availableHeight)) return { width: 0, height: 0 }
      const cellWidth = this._spanExtent(columnWidths, placement.column, placement.columnSpan, columnGap)
      const horizontalAlignment = child.resolveHorizontalAlignment('stretch')
      return child.measureOuter({
        minWidth: horizontalAlignment === 'stretch' && child.width === undefined ? cellWidth : 0,
        maxWidth: cellWidth,
        minHeight: 0,
        maxHeight: Infinity,
      }, context)
    })
  }

  private _naturalTrackSizes(
    tracks: GridPanelTrack[],
    placements: GridPanelPlacement[],
    naturalSizes: Size[],
    axis: 'column' | 'row',
    gap: number,
  ): number[] {
    const count = tracks.length
    const sizes = tracks.map(track => track.type === 'px' ? track.value : this._clamp(0, track.min, track.max))
    // Establish single-track requirements before distributing spanning content.
    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index]!
      const span = axis === 'column' ? placement.columnSpan : placement.rowSpan
      const trackIndex = axis === 'column' ? placement.column : placement.row
      const naturalSize = axis === 'column' ? naturalSizes[index]!.width : naturalSizes[index]!.height
      if (span === 1) {
        const track = tracks[trackIndex]!
        if (track.type !== 'px') sizes[trackIndex] = this._clamp(Math.max(sizes[trackIndex]!, naturalSize), track.min, track.max)
      }
    }
    const spanning = placements.map((placement, index) => ({ placement, index }))
      .filter(({ placement }) => (axis === 'column' ? placement.columnSpan : placement.rowSpan) > 1)
      .sort((a, b) => (axis === 'column' ? a.placement.columnSpan - b.placement.columnSpan : a.placement.rowSpan - b.placement.rowSpan))
    for (const { placement, index } of spanning) {
      const span = axis === 'column' ? placement.columnSpan : placement.rowSpan
      const trackIndex = axis === 'column' ? placement.column : placement.row
      const naturalSize = axis === 'column' ? naturalSizes[index]!.width : naturalSizes[index]!.height
      const end = Math.min(count, trackIndex + span)
      const current = this._spanExtent(sizes, trackIndex, end - trackIndex, gap)
      const deficit = naturalSize - current
      if (deficit <= 0) continue
      const autoIndexes: number[] = []
      const frIndexes: number[] = []
      for (let track = trackIndex; track < end; track += 1) {
        if (tracks[track]?.type === 'auto') autoIndexes.push(track)
        else if (tracks[track]?.type === 'fr') frIndexes.push(track)
      }
      const remaining = this._distributeSpace(sizes, tracks, autoIndexes, deficit)
      this._distributeSpace(sizes, tracks, frIndexes, remaining, true)
    }
    return sizes
  }

  private _resolveTracks(options: {
    tracks: GridPanelTrack[]
    availableSize: number
    gap: number
    naturalSizes: number[]
  }): number[] {
    const { tracks, availableSize, gap, naturalSizes } = options
    const sizes = tracks.map((track, index) => {
      if (track.type === 'px') return track.value
      if (track.type === 'auto') return this._clamp(naturalSizes[index] ?? 0, track.min, track.max)
      return track.min ?? 0
    })
    if (availableSize === Infinity) {
      return tracks.map((track, index) => {
        if (track.type === 'px') return track.value
        return this._clamp(naturalSizes[index] ?? 0, track.min, track.max)
      })
    }
    const gapTotal = Math.max(0, tracks.length - 1) * gap
    const used = sizes.reduce((sum, size) => sum + size, 0)
    const remaining = Math.max(0, availableSize - gapTotal - used)
    const frIndexes = tracks
      .map((track, index) => ({ track, index }))
      .filter(entry => entry.track.type === 'fr')
      .map(entry => entry.index)
    this._distributeSpace(sizes, tracks, frIndexes, remaining)
    return sizes
  }

  private _distributeSpace(sizes: number[], tracks: GridPanelTrack[], indexes: number[], remaining: number, natural = false): number {
    const equalWeights = natural && indexes.every(index => {
      const track = tracks[index]!
      return track.type === 'fr' && track.value <= 0
    })
    const weight = (index: number): number => {
      const track = tracks[index]!
      return track.type === 'fr' && !equalWeights ? Math.max(0, track.value) : 1
    }
    const capacity = (index: number): number => {
      const track = tracks[index]!
      return track.type === 'px' ? 0 : Math.max(0, (track.max ?? Infinity) - sizes[index]!)
    }
    let active = indexes.filter(index => weight(index) > 0 && capacity(index) > 0)
    while (remaining > 0 && active.length > 0) {
      const totalWeight = active.reduce((sum, index) => sum + weight(index), 0)
      const capped = active.filter(index => remaining * weight(index) / totalWeight >= capacity(index))
      if (capped.length === 0) {
        for (const index of active) sizes[index]! += remaining * weight(index) / totalWeight
        return 0
      }
      for (const index of capped) {
        const extra = capacity(index)
        sizes[index]! += extra
        remaining = Math.max(0, remaining - extra)
      }
      const frozen = new Set(capped)
      active = active.filter(index => !frozen.has(index))
    }
    return remaining
  }

  private _offsets(sizes: number[], gap: number): number[] {
    const offsets: number[] = []
    let cursor = 0
    for (let index = 0; index < sizes.length; index += 1) {
      offsets.push(cursor)
      cursor += sizes[index]! + (index < sizes.length - 1 ? gap : 0)
    }
    return offsets
  }

  private _spanExtent(sizes: number[], start: number, span: number, gap: number): number {
    let extent = 0
    for (let index = start; index < start + span; index += 1) {
      extent += sizes[index] ?? 0
      if (index < start + span - 1) extent += gap
    }
    return extent
  }

  private _totalExtent(sizes: number[], gap: number): number {
    return sizes.reduce((sum, size) => sum + size, 0) + Math.max(0, sizes.length - 1) * gap
  }

  private _clamp(value: number, min?: number, max?: number): number {
    return Math.max(min ?? 0, Math.min(max ?? Infinity, value))
  }

  private _availableTrackSize(min: number, max: number): number {
    if (max !== Infinity) return max
    return min > 0 ? min : Infinity
  }
}
