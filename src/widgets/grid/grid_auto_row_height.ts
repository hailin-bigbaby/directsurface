import type { GridViewport } from './grid_viewport'
import type { GridPainterSnapshot } from './grid_painter'
import type { GridRowMergeRun } from './grid_row_merge_model'
import { resolveGridCellPresentation, resolveGridRowPresentation } from './grid_display_resolver'
import { gridColumnAutoHeight, layoutGridCellText } from './grid_cell_text_layout'

interface HeightInteractionState {
  hovered: number
  focused: number
  focusedCol: number
  selected: Set<number>
  editing: number
}

/** Full projection measurement gives exact scroll extents. Interaction changes only
 * remeasure affected rows and redistribute heights within connected merge spans.
 */
export class GridAutoRowHeight<T extends Record<string, any>> {
  private _signature = ''
  private _stateSignature = ''
  private _state?: HeightInteractionState
  private _keys: string[] = []
  private _textMeasurementRevision = -1
  private _items?: GridPainterSnapshot<T>['visibleItems']
  private _theme?: GridPainterSnapshot<T>['theme']
  private _columns: GridPainterSnapshot<T>['columns'] = []
  private _baseHeights: number[] = []
  private _rowIndices = new Map<number, number>()
  private readonly _rowIdentities = new WeakMap<T, number>()
  private _nextRowIdentity = 0
  private readonly _textHeights = new Map<string, number>()
  private readonly _mergeHeights = new Map<GridRowMergeRun, { state: string; height: number }>()

  reset(viewport: GridViewport<T>): void {
    viewport.clearRowSizes()
    this._signature = ''
    this._stateSignature = ''
    this._state = undefined
    this._items = undefined
    this._columns = []
    this._keys = []
    this._baseHeights = []
    this._rowIndices.clear()
    this._textHeights.clear()
    this._mergeHeights.clear()
  }

  needsLayout(snapshot: GridPainterSnapshot<T>, revision: number, maxHeight: number): boolean {
    return this.needsFullMeasurement(snapshot, revision, maxHeight) ||
      this._stateSignature !== this.stateSignature(this.interactionState(snapshot))
  }

  private needsFullMeasurement(snapshot: GridPainterSnapshot<T>, revision: number, maxHeight: number): boolean {
    return this._signature !== this.signature(snapshot, revision, maxHeight) ||
      this._items !== snapshot.visibleItems || this._theme !== snapshot.theme ||
      snapshot.columns.length !== this._columns.length ||
      snapshot.columns.some((column, i) => column !== this._columns[i])
  }

  private signature(snapshot: GridPainterSnapshot<T>, revision: number, maxHeight: number): string {
    return JSON.stringify([
      revision, snapshot.textMeasurementRevision, snapshot.viewport.rowHeight, maxHeight, snapshot.autoRowHeight,
      snapshot.viewport.colWidths, snapshot.columns.map(column => [column.key, column.autoRowHeight, column.wrapText]),
    ])
  }

  private interactionState(snapshot: GridPainterSnapshot<T>): HeightInteractionState {
    const dynamic = !!(snapshot.resolveRowStyle || snapshot.resolveCellStyle || snapshot.getCellDisplayText)
    return {
      hovered: dynamic ? snapshot.hoveredItemIndex : -1,
      focused: dynamic && snapshot.focused ? snapshot.focusedItemIndex : -1,
      focusedCol: dynamic && snapshot.focused ? snapshot.focusedColIndex : -1,
      selected: dynamic ? new Set(snapshot.selectedRows) : new Set(),
      editing: snapshot.editableState?.row ?? -1,
    }
  }

  private stateSignature(state: HeightInteractionState): string {
    return JSON.stringify([state.hovered, state.focused, state.focusedCol, [...state.selected], state.editing])
  }

  private itemKeys(items: GridPainterSnapshot<T>['visibleItems']): string[] {
    const occurrences = new Map<string, number>()
    return items.map(item => {
      let identity: string
      if (item.kind === 'group') identity = `group:${item.pathKey}`
      else if (item.rowId !== null) identity = `row:${typeof item.rowId}:${item.rowId}`
      else {
        let id = this._rowIdentities.get(item.row)
        if (id === undefined) {
          id = this._nextRowIdentity++
          this._rowIdentities.set(item.row, id)
        }
        identity = `object:${id}`
      }
      const occurrence = occurrences.get(identity) ?? 0
      occurrences.set(identity, occurrence + 1)
      return JSON.stringify([identity, occurrence])
    })
  }

  private dirtyItems(next: HeightInteractionState): Set<number> {
    const previous = this._state!
    const dirty = new Set<number>()
    const addRow = (row: number) => {
      const index = this._rowIndices.get(row)
      if (index !== undefined) dirty.add(index)
    }
    if (previous.hovered !== next.hovered) {
      dirty.add(previous.hovered)
      dirty.add(next.hovered)
    }
    if (previous.focused !== next.focused || previous.focusedCol !== next.focusedCol) {
      dirty.add(previous.focused)
      dirty.add(next.focused)
    }
    if (previous.editing !== next.editing) {
      addRow(previous.editing)
      addRow(next.editing)
    }
    for (const row of previous.selected) if (!next.selected.has(row)) addRow(row)
    for (const row of next.selected) if (!previous.selected.has(row)) addRow(row)
    dirty.delete(-1)
    return dirty
  }

  /** Overlapping merge runs form a dependency region: recompute from base heights
   * so shrinking a cell cannot leave heights allocated by a previous layout behind.
   */
  private affectedRegions(dirty: Set<number>, snapshot: GridPainterSnapshot<T>, mergeColumns: number[]): Array<[number, number]> {
    const regions: Array<[number, number]> = []
    for (const index of [...dirty].sort((a, b) => a - b)) {
      const last = regions[regions.length - 1]
      if (last && index <= last[1]) continue
      let start = index
      let end = index
      let changed = true
      while (changed) {
        changed = false
        for (const col of mergeColumns) {
          for (const run of snapshot.rowMerges?.intersecting(start, end, snapshot.columns[col]!.key) ?? []) {
            if (run.startItemIndex < start || run.endItemIndex > end) {
              start = Math.min(start, run.startItemIndex)
              end = Math.max(end, run.endItemIndex)
              changed = true
            }
          }
        }
      }
      while (regions.length && regions[regions.length - 1]![1] >= start) {
        start = Math.min(start, regions.pop()![0])
      }
      regions.push([start, end])
    }
    return regions
  }

  sync(snapshot: GridPainterSnapshot<T>, revision: number, maxHeight: number): void {
    const { viewport, columns, visibleItems: items } = snapshot
    const autoColumns = columns.flatMap((column, index) => gridColumnAutoHeight(column, snapshot.autoRowHeight ?? false) ? [index] : [])
    const nextState = this.interactionState(snapshot)
    const full = this.needsFullMeasurement(snapshot, revision, maxHeight)
    if (!full && this._stateSignature === this.stateSignature(nextState)) return
    if (!autoColumns.length) {
      this.reset(viewport)
      this.remember(snapshot, revision, maxHeight, nextState)
      return
    }
    if (this._theme !== snapshot.theme || this._textMeasurementRevision !== snapshot.textMeasurementRevision) this._textHeights.clear()
    this._textMeasurementRevision = snapshot.textMeasurementRevision ?? 0
    const keys = full ? this.itemKeys(items) : this._keys
    if (full) {
      this._mergeHeights.clear()
      this._baseHeights = items.map(() => viewport.rowHeight)
      this._rowIndices.clear()
      items.forEach((item, index) => { if (item.kind === 'data') this._rowIndices.set(item.dataRowIndex, index) })
    }
    const dirty = full ? new Set(items.map((_, index) => index)) : this.dirtyItems(nextState)
    const mergeColumns = autoColumns.filter(col => columns[col]!.mergeRows)
    const regions: Array<[number, number]> = full
      ? items.length ? [[0, items.length - 1]] : []
      : this.affectedRegions(dirty, snapshot, mergeColumns)
    const cap = Math.max(viewport.rowHeight, maxHeight)
    const editingIndex = this._rowIndices.get(nextState.editing) ?? -1
    const oldEditingIndex = editingIndex >= 0 ? full ? this._keys.indexOf(keys[editingIndex]!) : editingIndex : -1
    const frozenHeight = oldEditingIndex >= 0 ? viewport.rowHeightAt(oldEditingIndex) : undefined
    const updates = new Map<number, number>()
    for (const index of dirty) {
      const item = items[index]
      if (!item || item.kind !== 'data') continue
      let height = viewport.rowHeight
      for (const col of autoColumns) {
        if (columns[col]!.mergeRows && snapshot.rowMerges?.runAt(index, columns[col]!.key)) continue
        height = Math.max(height, this.measure(snapshot, index, col))
      }
      this._baseHeights[index] = Math.min(cap, height)
    }
    for (const [start, end] of regions) {
      for (let i = start; i <= end; i++) updates.set(i, i === editingIndex && frozenHeight !== undefined ? frozenHeight : this._baseHeights[i]!)
      // Each region contains whole runs, processed in display-column order.
      for (const col of mergeColumns) {
        for (const run of snapshot.rowMerges?.intersecting(start, end, columns[col]!.key) ?? []) {
          let total = 0
          const available: number[] = []
          for (let i = run.startItemIndex; i <= run.endItemIndex; i++) {
            total += updates.get(i)!
            if (i !== editingIndex && updates.get(i)! < cap) available.push(i)
          }
          let deficit = Math.max(0, this.measure(snapshot, run.startItemIndex, col, run) - total)
          let remaining = available
          while (deficit > 0 && remaining.length) {
            const share = Math.ceil(deficit / remaining.length)
            for (const i of remaining) {
              const height = updates.get(i)!
              const added = Math.min(cap - height, share, deficit)
              updates.set(i, height + added)
              deficit -= added
            }
            remaining = remaining.filter(i => updates.get(i)! < cap)
          }
        }
      }
    }
    if (full) viewport.setRowSizes(keys, items.map((_, i) => updates.get(i)!))
    else viewport.updateRowSizes(updates)
    this._keys = keys
    this.remember(snapshot, revision, maxHeight, nextState)
  }

  private measure(snapshot: GridPainterSnapshot<T>, index: number, colIndex: number, run?: GridRowMergeRun): number {
    const item = snapshot.visibleItems[index]!
    if (item.kind !== 'data') return snapshot.viewport.rowHeight
    const state = {
      itemIndex: index,
      selected: run ? snapshot.isMergeFullySelected?.(run) ?? false : snapshot.selectedRows.has(item.dataRowIndex),
      hovered: !run && snapshot.hoveredItemIndex === index,
      focused: snapshot.focused && (run
        ? snapshot.focusedColIndex === colIndex && snapshot.focusedItemIndex >= run.startItemIndex && snapshot.focusedItemIndex <= run.endItemIndex
        : snapshot.focusedItemIndex === index),
      editing: false,
    }
    const stateKey = JSON.stringify(state)
    const cached = run ? this._mergeHeights.get(run) : undefined
    if (cached?.state === stateKey) return cached.height
    const tokens = snapshot.gridTokens
    const column = snapshot.columns[colIndex]!
    const rowPresentation = resolveGridRowPresentation({ item, theme: snapshot.theme, tokens, state, resolveRowStyle: snapshot.resolveRowStyle })
    const presentation = resolveGridCellPresentation({ item, column, colIndex, theme: snapshot.theme,
      tokens, rowPresentation, state,
      cellError: run ? null : snapshot.getCellError?.(item.sourceIndex, column.key, item.dataRowIndex, colIndex),
      getCellDisplayText: snapshot.getCellDisplayText, resolveCellStyle: snapshot.resolveCellStyle,
      lookupValues: snapshot.lookupValues })
    const width = snapshot.viewport.colWidths[colIndex] ?? 0
    const key = JSON.stringify([presentation.displayText, presentation.fontSize, presentation.fontFamily, width, tokens.paddingH])
    let height = this._textHeights.get(key)
    if (height === undefined) {
      height = Math.ceil(layoutGridCellText(presentation, width, Number.MAX_SAFE_INTEGER,
        tokens.paddingH, 'clip', snapshot.measureText).requiredHeight + 8)
      if (this._textHeights.size >= 4096) this._textHeights.delete(this._textHeights.keys().next().value!)
    } else this._textHeights.delete(key)
    this._textHeights.set(key, height)
    if (run) this._mergeHeights.set(run, { state: stateKey, height })
    return height
  }

  private remember(snapshot: GridPainterSnapshot<T>, revision: number, maxHeight: number, state: HeightInteractionState): void {
    this._signature = this.signature(snapshot, revision, maxHeight)
    this._stateSignature = this.stateSignature(state)
    this._state = state
    this._items = snapshot.visibleItems
    this._theme = snapshot.theme
    this._columns = [...snapshot.columns]
  }
}
