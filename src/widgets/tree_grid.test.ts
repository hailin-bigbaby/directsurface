// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { PopupManager } from '../core/popup_manager'
import { RenderTreeGrid, type TreeGridNode } from './tree_grid'
import type { GridColumnDef } from './grid_view'

function inputElement(): HTMLTextAreaElement {
  const input = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement | null
  if (!input) throw new Error('Input composer not created')
  return input
}
afterEach(() => {
  PopupManager.disposeInstance()
  FocusManager.disposeInstance()
  InputComposer.disposeInstance()
  vi.restoreAllMocks()
})
interface DemoRow { name: string; code: string; category: string; count: number; active: boolean }
const columns: GridColumnDef<DemoRow>[] = [
  { type: 'text', key: 'name', title: 'Name', width: 120 },
  { type: 'text', key: 'code', title: 'Code', width: 100 },
  { type: 'text', key: 'category', title: 'Category', width: 120 },
]
function createRoots(): TreeGridNode<DemoRow>[] {
  return [{ key: 'root-a', row: { name: 'Alpha', code: 'A01', category: 'Group', count: 1, active: true } }]
}
function layout(grid: RenderTreeGrid<DemoRow>): void {
  grid.layout({ minWidth: 0, maxWidth: 480, minHeight: 0, maxHeight: 240 })
}

describe('TreeGrid column replacement', () => {
  it.each(['reorder', 'replace', 'remove'] as const)('cancels the old draft when columns %s', change => {
    const roots = createRoots()
    const before = { ...roots[0]!.row }
    const onCellChange = vi.fn()
    const grid = new RenderTreeGrid({ columns, roots, treeColumnKey: 'name', editable: true, onCellChange })
    layout(grid)
    expect(grid.beginEdit(0, 'code')).toBe(true)
    inputElement().value = 'pending-code'
    inputElement().dispatchEvent(new Event('input'))
    grid.columns = change === 'reorder'
      ? [columns[1]!, columns[0]!, ...columns.slice(2)]
      : change === 'replace'
        ? columns.map(column => ({ ...column }))
        : columns.filter(column => column.key !== 'code')
    expect(grid.editingCell).toBe(null)
    expect(InputComposer.instance.hasSession).toBe(false)
    grid.commitEdit()
    expect(roots[0]!.row).toEqual(before)
    expect(onCellChange).not.toHaveBeenCalled()
    expect(grid.beginEdit(0, 'name')).toBe(true)
    inputElement().value = 'new-name'
    inputElement().dispatchEvent(new Event('input'))
    grid.commitEdit()
    expect(roots[0]!.row.name).toBe('new-name')
    expect(roots[0]!.row.code).toBe(before.code)
    expect(onCellChange).toHaveBeenCalledOnce()
    grid.dispose()
  })

  it('closes a popup editor before replacing its columns', () => {
    const roots = createRoots()
    const popupColumns: GridColumnDef<DemoRow>[] = [columns[0]!, {
      type: 'text', key: 'category', title: 'Category', width: 120,
      editor: { kind: 'select', options: [{ value: 'Group', label: 'Group' }, { value: 'Item', label: 'Item' }] },
    }]
    const grid = new RenderTreeGrid({ columns: popupColumns, roots, treeColumnKey: 'name', editable: true })
    layout(grid)
    expect(grid.beginEdit(0, 'category')).toBe(true)
    const popup = PopupManager.instance.current!
    expect(PopupManager.instance.stack).toContain(popup)
    grid.columns = [popupColumns[1]!, popupColumns[0]!]
    expect(PopupManager.instance.stack).not.toContain(popup)
    expect(grid.editingCell).toBe(null)
    expect(roots[0]!.row.category).toBe('Group')
    grid.dispose()
  })
})
