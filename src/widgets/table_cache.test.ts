import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { TextMeasurer } from '../core/text_measurer'
import { RenderTable, type TableColumn } from './table'

interface RowData { id: number; name: string }
const columns: TableColumn<RowData>[] = [
  { key: 'id', title: 'ID', width: 50, sortable: true },
  { key: 'name', title: 'Name', sortable: true },
]
afterEach(() => { FocusManager.disposeInstance(); vi.restoreAllMocks() })

describe('Table derived caches', () => {
  it('reuses sorted rows and detects in-place values, ordering, length and source changes', () => {
    const data = [{ id: 3, name: 'c' }, { id: 1, name: 'a' }, { id: 1, name: 'b' }]
    const table = new RenderTable<RowData>({ columns, rows: data })
    table.sortState = { key: 'id', order: 'asc' }
    const internal = table as unknown as { _visibleRows(): RowData[]; _compareValues(a: unknown, b: unknown): number }
    const comparisons = vi.spyOn(internal, '_compareValues')
    expect(internal._visibleRows().map(row => row.name)).toEqual(['a', 'b', 'c'])
    comparisons.mockClear()
    expect(internal._visibleRows().map(row => row.name)).toEqual(['a', 'b', 'c'])
    expect(comparisons).not.toHaveBeenCalled()
    data[0]!.id = 0
    expect(internal._visibleRows().map(row => row.name)).toEqual(['c', 'a', 'b'])
    data.reverse()
    expect(internal._visibleRows().map(row => row.name)).toEqual(['c', 'b', 'a'])
    data.push({ id: -1, name: 'd' })
    expect(internal._visibleRows()[0]!.name).toBe('d')
    table.sortState = { key: 'id', order: 'desc' }
    expect(internal._visibleRows().map(row => row.name)).toEqual(['b', 'a', 'c', 'd'])
    table.rows = [{ id: 4, name: 'replacement' }]
    expect(internal._visibleRows().map(row => row.name)).toEqual(['replacement'])
    table.sortState = { key: '', order: null }
    expect(internal._visibleRows()).toBe(table.rows)
    table.dispose()
  })


  it('invalidates for sort keys, replaced row objects and removed rows while preserving source order', () => {
    const rows = [{ id: 2, name: 'Alpha' }, { id: 1, name: 'Zulu' }]
    const table = new RenderTable<RowData>({ columns, rows })
    const visible = () => (table as unknown as { _visibleRows(): RowData[] })._visibleRows()
    table.sortState = { key: 'id', order: 'asc' }
    expect(visible().map(row => row.name)).toEqual(['Zulu', 'Alpha'])
    expect(rows.map(row => row.name)).toEqual(['Alpha', 'Zulu'])
    table.sortState = { key: 'name', order: 'asc' }
    expect(visible().map(row => row.name)).toEqual(['Alpha', 'Zulu'])
    rows[0] = { id: 3, name: 'Alpha' }
    expect(visible()[0]).toBe(rows[0])
    rows.shift()
    expect(visible()).toEqual([rows[0]])
    table.rows = []
    expect(visible()).toEqual([])
    table.dispose()
  })

  it('preserves null and natural string ordering and detects mutable string values', () => {
    let text = 'item10'
    const mutable = { toString: () => text }
    const rows = [{ value: mutable }, { value: 'item2' }, { value: null }, { value: undefined }]
    const table = new RenderTable({ columns: [{ key: 'value', title: 'Value', sortable: true }], rows })
    table.sortState = { key: 'value', order: 'asc' }
    const visible = () => (table as unknown as { _visibleRows(): typeof rows })._visibleRows()
    expect(visible()).toEqual([rows[2], rows[3], rows[1], rows[0]])
    text = 'item1'
    expect(visible()).toEqual([rows[2], rows[3], rows[0], rows[1]])
    table.dispose()
  })

  it('does not sort for row counts and releases cached rows on disposal', () => {
    const table = new RenderTable<RowData>({ columns, rows: [{ id: 2, name: 'B' }, { id: 1, name: 'A' }] })
    table.sortState = { key: 'id', order: 'asc' }
    const internal = table as unknown as { _visibleRows(): RowData[]; _sortedRowsCache?: unknown }
    const visible = vi.spyOn(internal, '_visibleRows')
    table.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 120 })
    table.setSelectedRows([0, 1])
    expect(visible).not.toHaveBeenCalled()
    internal._visibleRows()
    expect(internal._sortedRowsCache).toBeDefined()
    table.dispose()
    expect(internal._sortedRowsCache).toBeUndefined()
  })

  it('reuses fitted cell text and preserves clip behavior', () => {
    const table = new RenderTable<RowData>({ columns, rows: [] })
    TextMeasurer.clearCache()
    const measure = vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const internal = table as unknown as {
      _resolvePaintText(text: string, overflow: 'ellipsis' | 'clip', maxWidth: number, fontSize: number, fontFamily: string): string
    }
    expect(internal._resolvePaintText('abcdef', 'ellipsis', 40, 12, 'Arial')).toBe('ab...')
    measure.mockClear()
    expect(internal._resolvePaintText('abcdef', 'ellipsis', 40, 12, 'Arial')).toBe('ab...')
    expect(measure).not.toHaveBeenCalled()
    expect(internal._resolvePaintText('abcdef', 'clip', 40, 12, 'Arial')).toBe('abcdef')
    table.dispose()
  })
})
