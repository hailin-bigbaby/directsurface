import { describe, expect, it, vi } from 'vitest'
import { ImGuiDarkTheme } from '../../theme/default_theme'
import { GridViewport } from './grid_viewport'
import { GridDataModel } from './grid_data_model'
import { GridEditingGeometryController } from './grid_editing_geometry_controller'
import type { EditState, GridColumnDef } from './grid_types'

interface RowData {
  id: number
  name: string
  due: string
}

function createHarness() {
  const columns: GridColumnDef<RowData>[] = [
    { key: 'id', title: 'ID', type: 'number', width: 60, fixed: true },
    { key: 'name', title: 'Name', type: 'text', width: 120, fixed: true },
    { key: 'due', title: 'Due', type: 'date', width: 100 },
  ]
  const dataModel = new GridDataModel<RowData>({
    columns,
    rows: [{ id: 1, name: 'Alpha', due: '2026-04-23' }],
  })
  const viewport = {
    editorRowBounds: GridViewport.prototype.editorRowBounds,
    headerSectionHeight: 20,
    viewWidth: 200,
    viewHeight: 40,
    cellGlobalRect: vi.fn(),
    visibleCellRect: vi.fn(),
  }
  viewport.cellGlobalRect.mockImplementation(
    (_columns: GridColumnDef<RowData>[], _offset: { x: number; y: number }, itemIndex: number, colIndex: number) => ({
      x: 20 + colIndex * 60,
      y: 30 + viewport.headerSectionHeight + itemIndex * 20,
      w: 60,
      h: 20,
    }),
  )
  viewport.visibleCellRect.mockImplementation(
    (_columns: GridColumnDef<RowData>[], _originX: number, colIndex: number) => ({
      x: 25 + colIndex * 60,
      w: 50,
    }),
  )
  const editing: {
    state: EditState | null
    cancelNumberStepperPress: any
    endEdit: any
    refreshOverlayPosition: any
  } = {
    state: null,
    cancelNumberStepperPress: vi.fn(),
    endEdit: vi.fn(),
    refreshOverlayPosition: vi.fn(),
  }
  const interaction = {
    focusedItemIndex: 0,
    hoveredItemIndex: 0,
  }
  const selectedRows = new Set<number>([0])

  const controller = new GridEditingGeometryController<RowData>({
    dataModel,
    viewport: viewport as any,
    editing: editing as any,
    interaction: interaction as any,
    getColumns: () => dataModel.columns,
    getGlobalOffset: () => ({ x: 20, y: 30 }),
    getCurrentTheme: () => ImGuiDarkTheme,
    getSelectedRows: () => selectedRows,
    getResolveRowStyle: () => undefined,
    getResolveCellStyle: () => undefined,
  })

  return {
    dataModel,
    viewport,
    editing,
    interaction,
    controller,
  }
}

describe('GridEditingGeometryController', () => {
  it('delegates cell rect lookup through the viewport coordinate model', () => {
    const harness = createHarness()

    expect(harness.controller.cellGlobalRect(0, 1)).toEqual({ x: 80, y: 50, w: 60, h: 20 })
    expect(harness.viewport.cellGlobalRect).toHaveBeenCalledWith(harness.dataModel.columns, { x: 20, y: 30 }, 0, 1)
  })

  it('combines the visible horizontal cell bounds with the row geometry', () => {
    const harness = createHarness()

    expect(harness.controller.cellVisibleGlobalRect(0, 1)).toEqual({ x: 85, y: 50, w: 50, h: 20 })
    expect(harness.viewport.visibleCellRect).toHaveBeenCalledWith(harness.dataModel.columns, 20, 1)
  })

  it('refreshes overlay position for visible text edits', () => {
    const harness = createHarness()
    harness.editing.state = {
      row: 0,
      col: 1,
      originalValue: 'Alpha',
      text: 'Alpha',
      dragging: false,
    }

    harness.controller.syncEditingViewportState()

    expect(harness.editing.cancelNumberStepperPress).toHaveBeenCalledWith(true)
    expect(harness.editing.refreshOverlayPosition).toHaveBeenCalledTimes(1)
    expect(harness.editing.endEdit).not.toHaveBeenCalled()
  })

  it('keeps popup editors visible when a filter row shifts the body origin', () => {
    const harness = createHarness()
    harness.viewport.headerSectionHeight = 44
    harness.viewport.viewHeight = 20
    harness.editing.state = {
      row: 0,
      col: 2,
      originalValue: '2026-04-23',
      text: '',
      dragging: false,
    }

    harness.controller.syncEditingViewportState()

    expect(harness.editing.refreshOverlayPosition).toHaveBeenCalledTimes(1)
    expect(harness.editing.endEdit).not.toHaveBeenCalled()
  })

  it('closes popup editors when their editing cell scrolls out of view', () => {
    const harness = createHarness()
    harness.editing.state = {
      row: 0,
      col: 2,
      originalValue: '2026-04-23',
      text: '',
      dragging: false,
    }
    harness.viewport.cellGlobalRect.mockReturnValue({ x: 500, y: 500, w: 60, h: 20 })

    harness.controller.syncEditingViewportState()

    expect(harness.editing.endEdit).toHaveBeenCalledTimes(1)
    expect(harness.editing.refreshOverlayPosition).not.toHaveBeenCalled()
  })
})
