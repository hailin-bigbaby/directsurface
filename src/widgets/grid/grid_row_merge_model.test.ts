import { describe, expect, it } from 'vitest'
import { GridDataModel } from './grid_data_model'
import { GridRowMergeModel } from './grid_row_merge_model'
import type { GridColumnDef, GridResolvedCellEditPolicy } from './grid_types'

interface Row { id: number; batch: string; group: string; note: string }

function harness(rows: Row[], mergeRows: GridColumnDef<Row>['mergeRows'] = true) {
  let columns: GridColumnDef<Row>[] = [
    { key: 'batch', title: 'Batch', type: 'text', mergeRows, sortable: true },
    { key: 'note', title: 'Note', type: 'text', sortable: true },
    { key: 'group', title: 'Group', type: 'text', sortable: true },
  ]
  const data = new GridDataModel({ columns, rows, rowKey: 'id', sortable: true })
  let validationRevision = 0
  const errors = new Set<number>()
  const policies = new Map<number, GridResolvedCellEditPolicy>()
  const model = new GridRowMergeModel(data, () => columns,
    row => policies.get(row) ?? { state: 'editable', tabStop: true },
    row => errors.has(row), () => validationRevision)
  return { data, model, errors, policies, setColumns: (next: GridColumnDef<Row>[]) => {
    columns = next
    data.columns = next
  }, bumpValidation: () => { validationRevision++ } }
}

describe('GridRowMergeModel', () => {
  it('uses full display projection, skips blanks, and changes after sort, filter and data edit', () => {
    const rows: Row[] = [
      { id: 1, batch: 'A', group: 'x', note: '1' },
      { id: 2, batch: 'A', group: 'x', note: '2' },
      { id: 3, batch: 'B', group: 'x', note: '3' },
      { id: 4, batch: 'A', group: 'x', note: '4' },
      { id: 5, batch: '', group: 'x', note: '5' },
      { id: 6, batch: '', group: 'x', note: '6' },
    ]
    const { data, model } = harness(rows)
    expect(model.runs('batch').map(run => [run.startItemIndex, run.endItemIndex])).toEqual([[0, 1]])
    data.setFilterValue('batch', 'A')
    expect(model.runs('batch').map(run => [run.startItemIndex, run.endItemIndex])).toEqual([[0, 2]])
    data.setFilterValue('batch', '')
    data.sortDescriptors = [{ key: 'batch', order: 'asc' }]
    expect(model.runs('batch').some(run => run.endItemIndex - run.startItemIndex === 2)).toBe(true)
    data.sortDescriptors = []
    data.setCellValue(2, 'batch', 'A')
    expect(model.runs('batch').map(run => [run.startItemIndex, run.endItemIndex])).toEqual([[0, 3]])
    model.dispose()
  })

  it('breaks on group paths, validation errors and distinct policy reasons', () => {
    const rows: Row[] = [1, 2, 3, 4].map(id => ({ id, batch: 'A', group: id < 3 ? 'x' : 'y', note: '' }))
    const { data, model, errors, policies, bumpValidation } = harness(rows)
    data.groupBy = [{ key: 'group' }]
    expect(model.runs('batch')).toHaveLength(2)
    data.groupBy = []
    errors.add(1)
    bumpValidation()
    expect(model.runs('batch').map(run => [run.anchorDataRowIndex, run.endDataRowIndex])).toEqual([[2, 3]])
    errors.clear()
    policies.set(1, { state: 'readonly', tabStop: true, reason: 'first' })
    policies.set(2, { state: 'readonly', tabStop: true, reason: 'second' })
    bumpValidation()
    expect(model.runs('batch')).toEqual([])
    policies.set(1, { state: 'editable', tabStop: false })
    policies.set(2, { state: 'editable', tabStop: false })
    bumpValidation()
    expect(model.runs('batch').map(run => [run.anchorDataRowIndex, run.endDataRowIndex])).toEqual([[1, 2]])
    model.dispose()
  })

  it('joins adjacent callback links and responds to column replacement and refresh', () => {
    const rows: Row[] = ['A', 'B', 'C'].map((batch, index) => ({ id: index, batch, group: '', note: '' }))
    const compare: GridColumnDef<Row>['mergeRows'] = ({ previousValue, currentValue }) =>
      Math.abs(String(previousValue).charCodeAt(0) - String(currentValue).charCodeAt(0)) === 1
    const { data, model, setColumns } = harness(rows, compare)
    expect(model.runs('batch')).toMatchObject([{ startItemIndex: 0, endItemIndex: 2 }])
    setColumns([{ key: 'batch', title: 'Batch', type: 'text', mergeRows: false }])
    expect(model.runs('batch')).toEqual([])
    setColumns([{ key: 'batch', title: 'Batch', type: 'text', mergeRows: true }])
    rows[1]!.batch = 'A'
    data.invalidateVisibleRows('cell')
    expect(model.runs('batch')).toMatchObject([{ startItemIndex: 0, endItemIndex: 1 }])
    model.dispose()
  })
})
