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

    const naturalSizes = this._measureNaturalSizes(context)
    const columnWidths = this._resolveTracks({
      tracks: columnTracks,
      availableSize: this._availableTrackSize(contentConstraints.minWidth, contentConstraints.maxWidth),
      gap: columnGap,
      naturalSizes: this._naturalTrackSizes(columnTracks, placements, naturalSizes, 'column', columnGap),
    })
    const widthConstrainedSizes = this._measureSizesForColumns(visibleChildren, columnWidths, placements, columnGap, context)
    const rowHeights = this._resolveTracks({
      tracks: rowTracks,
      availableSize: this._availableTrackSize(contentConstraints.minHeight, contentConstraints.maxHeight),
      gap: rowGap,
      naturalSizes: this._naturalTrackSizes(rowTracks, placements, widthConstrainedSizes, 'row', rowGap),
    })

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

    const naturalWidth = this._totalExtent(columnWidths, columnGap)
    const naturalHeight = this._totalExtent(rowHeights, rowGap)
    this.size = this.inflatePaddingSize(constraints, { width: naturalWidth, height: naturalHeight })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    this.paintContentChildren(context, offset)
    this.paintAdornerChildren(context, offset)
  }

  private _resolvePlacements(columnCount: number, children: readonly RenderBox[]): GridPanelPlacement[] {
    const occupied: boolean[][] = []
    const placements: GridPanelPlacement[] = []
    const isOccupied = (row: number, column: number): boolean => occupied[row]?.[column] ?? false
    const occupy = (placement: GridPanelPlacement): void => {
      for (let row = placement.row; row < placement.row + placement.rowSpan; row += 1) {
        occupied[row] ??= []
        for (let column = placement.column; column < placement.column + placement.columnSpan; column += 1) {
          occupied[row]![column] = true
        }
      }
    }
    let cursorRow = 0
    let cursorColumn = 0
    const nextFree = (): void => {
      while (isOccupied(cursorRow, cursorColumn) || cursorColumn >= columnCount) {
        cursorColumn += 1
        if (cursorColumn >= columnCount) {
          cursorColumn = 0
          cursorRow += 1
        }
      }
    }

    for (const child of children) {
      const data = this.childData.get(child) ?? {}
      const columnSpan = Math.max(1, Math.min(data.columnSpan ?? 1, columnCount))
      const rowSpan = Math.max(1, data.rowSpan ?? 1)
      let row = data.row
      let column = data.column
      if (row === undefined || column === undefined) {
        nextFree()
        while (cursorColumn + columnSpan > columnCount) {
          cursorColumn = 0
          cursorRow += 1
          nextFree()
        }
        row = row ?? cursorRow
        column = column ?? cursorColumn
      }
      const placement = {
        row: Math.max(0, row),
        column: Math.max(0, Math.min(column, columnCount - columnSpan)),
        rowSpan,
        columnSpan,
      }
      placements.push(placement)
      occupy(placement)
      cursorColumn = placement.column + columnSpan
      if (cursorColumn >= columnCount) {
        cursorColumn = 0
        cursorRow = placement.row + 1
      }
    }
    return placements
  }

  private _measureNaturalSizes(context: LayoutContext): Size[] {
    return this.children.filter(child => child.participatesInLayout).map(child => {
      return child.measureOuter({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity }, context)
    })
  }

  private _measureSizesForColumns(
    children: readonly RenderBox[],
    columnWidths: number[],
    placements: GridPanelPlacement[],
    columnGap: number,
    context: LayoutContext,
  ): Size[] {
    return children.map((child, index) => {
      const placement = placements[index]!
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
    const sizes = new Array(count).fill(0)
    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index]!
      const span = axis === 'column' ? placement.columnSpan : placement.rowSpan
      const trackIndex = axis === 'column' ? placement.column : placement.row
      const naturalSize = axis === 'column' ? naturalSizes[index]!.width : naturalSizes[index]!.height
      if (span === 1) {
        sizes[trackIndex] = Math.max(sizes[trackIndex] ?? 0, naturalSize)
        continue
      }
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
      const growIndexes = autoIndexes.length > 0 ? autoIndexes : frIndexes
      if (growIndexes.length === 0) continue
      const frTotal = growIndexes.reduce((sum, growIndex) => {
        const track = tracks[growIndex]
        return track?.type === 'fr' ? sum + Math.max(0, track.value) : sum
      }, 0)
      const equalShare = deficit / growIndexes.length
      for (const growIndex of growIndexes) {
        const track = tracks[growIndex]
        const share = track?.type === 'fr' && frTotal > 0
          ? deficit * Math.max(0, track.value) / frTotal
          : equalShare
        sizes[growIndex] = (sizes[growIndex] ?? 0) + share
      }
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
    let remaining = Math.max(0, availableSize - gapTotal - used)
    const frTracks = tracks
      .map((track, index) => ({ track, index }))
      .filter(entry => entry.track.type === 'fr') as Array<{ track: Extract<GridPanelTrack, { type: 'fr' }>; index: number }>
    let frTotal = frTracks.reduce((sum, entry) => sum + entry.track.value, 0)
    for (const entry of frTracks) {
      if (frTotal <= 0) break
      const currentSize = sizes[entry.index] ?? 0
      const share = remaining * entry.track.value / frTotal
      const maxExtra = entry.track.max === undefined ? undefined : Math.max(0, entry.track.max - currentSize)
      const capped = this._clamp(share, 0, maxExtra)
      sizes[entry.index] = (sizes[entry.index] ?? 0) + capped
      remaining -= capped
      frTotal -= entry.track.value
    }
    return sizes
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
