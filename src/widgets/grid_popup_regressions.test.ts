import { afterEach, describe, expect, it, vi } from 'vitest'
import { PopupManager } from '../core/popup_manager'
import { InputComposer } from '../core/input_composer'
import { FocusManager } from '../core/focus_manager'
import { GET_POPUP_ANCHOR_RECT } from '../core/popup_anchor'
import { TextMeasurer } from '../core/text_measurer'
import { DrawList } from '../rendering/draw_list'
import { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../theme/default_theme'
import { deriveGridFilterPopupStyle, deriveScrollbarStyle } from '../theme/component_styles'
import { RenderDataGrid, type GridColumnDef } from './grid_view'
import { GridDataModel } from './grid/grid_data_model'
import { DropdownGridPopup } from './grid/popup/dropdown_grid_popup'
import { GridFilterPopup, resolveGridFilterPopupLayout } from './grid/popup/grid_filter_popup'

interface RowData { id: number; name: string; qty: number; active: boolean }
const columns: GridColumnDef<RowData>[] = [
  { key: 'id', title: 'ID', type: 'number' },
  { key: 'name', title: 'Name', type: 'text' },
  { key: 'qty', title: 'Quantity', type: 'number' },
  { key: 'active', title: 'Active', type: 'checkbox' },
]
function staticAnchor(x: number, y: number, width: number, height: number) {
  return { [GET_POPUP_ANCHOR_RECT]: () => ({ x, y, width, height }) }
}
function popupContext() {
  return { theme: ImGuiDarkTheme, viewport: { width: 420, height: 320, dpr: 1 }, setCursor: () => {} }
}
function setPopupTestContext(theme = ImGuiDarkTheme, viewport = { width: 800, height: 520, dpr: 1 }) {
  PopupManager.instance.setContextProvider(() => ({ theme, viewport }))
}
function paintDropdownGridPopup(popup: DropdownGridPopup, theme = ImGuiLightTheme) {
  vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
  const ctx = {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    fill: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })), moveTo: vi.fn(), lineTo: vi.fn(), arc: vi.fn(), closePath: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  popup.paint(new PaintContext(ctx, theme))
}
afterEach(() => {
  PopupManager.disposeInstance()
  FocusManager.disposeInstance()
  InputComposer.instance.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Grid popup and clipboard regressions', () => {
  it('defers grouped row projection until an unfocused grid needs visible rows', () => {
    const ensureVisibleCaches = vi.spyOn(GridDataModel.prototype as any, 'ensureVisibleCaches')
    try {
      const grid = new RenderDataGrid<RowData>({
        columns,
        rows: [{ id: 1, name: 'A', qty: 1, active: true }],
        rowKey: 'id',
        groupBy: [{ key: 'active', order: 'asc' }],
      })

      expect(ensureVisibleCaches).not.toHaveBeenCalled()
      expect(grid.interaction.getSelectionState().focusedRow).toBe(-1)
      expect(grid.interaction.hoveredRow).toBe(-1)
      expect(grid.getSelectionState().focusedRow).toBeNull()
      expect(ensureVisibleCaches).not.toHaveBeenCalled()

      expect(grid.dataModel.visibleRows()).toHaveLength(1)
      expect(ensureVisibleCaches).toHaveBeenCalled()
      grid.dispose()
    } finally {
      ensureVisibleCaches.mockRestore()
    }
  })

  it('keeps the hovered row through popup repaint without changing the selected row', () => {
    setPopupTestContext(ImGuiLightTheme, { width: 800, height: 520, dpr: 1 })
    const popup = new DropdownGridPopup()
    popup.open({
      columns: [{ key: 'name', title: 'Name', width: 160 }],
      rows: [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
        { id: 'c', name: 'Gamma' },
      ],
      valueKey: 'id',
      labelKey: 'name',
      selectedValue: 'b',
      anchor: staticAnchor(30, 30, 180, 28),
      searchable: true,
      onSelect: vi.fn(),
      onClose: vi.fn(),
    })
    const layout = (popup as any)._layout(PopupManager.instance.context)
    const grid = (popup as any)._grid as RenderDataGrid<Record<string, any>>
    const x = layout.panelX + layout.popupStyle.padding + 20
    const rowY = layout.panelY + layout.popupStyle.padding + layout.searchH + layout.headerH + layout.itemH / 2
    const popupPaint = vi.spyOn(PopupManager.instance, 'requestPaint')

    popup.onPointerMove({ pointerId: 0, position: { x, y: rowY }, type: 'move' })
    expect(grid.debugState().hoveredRow).toBe(0)
    expect(popupPaint).toHaveBeenCalled()
    paintDropdownGridPopup(popup, ImGuiLightTheme)
    expect(grid.debugState().hoveredRow).toBe(0)

    const requestsBeforeMove = popupPaint.mock.calls.length
    popup.onPointerMove({ pointerId: 0, position: { x, y: rowY + layout.itemH * 2 }, type: 'move' })
    expect(popupPaint.mock.calls.length).toBeGreaterThan(requestsBeforeMove)
    paintDropdownGridPopup(popup, ImGuiLightTheme)
    expect(grid.debugState().hoveredRow).toBe(2)
    expect(popup.selectedValue).toBe('b')

    popup.searchText = 'Al'
    paintDropdownGridPopup(popup, ImGuiLightTheme)
    expect(grid.getVisibleRows()).toHaveLength(1)
    expect(grid.debugState().hoveredRow).toBe(-1)
    popup.dispose()
  })

  it('clips the footer to the rounded panel and restores its outline afterward', () => {
    PopupManager.instance.setContextProvider(popupContext)
    const bounds = { x: 10, y: 20, w: 300, h: 280 }
    const popup = new GridFilterPopup({
      owner: {},
      column: { key: 'name', title: '名称', type: 'text', filterable: true },
      getLayout: () => bounds,
      initialRule: null,
      initialValue: '',
      values: [{ key: 'a', value: 'a', text: 'Alpha', blank: false, count: 1 }],
      valuesTruncated: false,
      onApply: vi.fn(),
      onClose: vi.fn(),
      onInvalidate: vi.fn(),
      onRequestPaint: vi.fn(),
    })
    popup.open()
    const ctx = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      fill: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 10 })), moveTo: vi.fn(), lineTo: vi.fn(), arc: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    const roundedClip = vi.spyOn(DrawList.prototype, 'pushRoundedClip')
    const fillRect = vi.spyOn(DrawList.prototype, 'fillRect')
    const strokeRect = vi.spyOn(DrawList.prototype, 'strokeRect')

    popup.paint(new PaintContext(ctx, ImGuiDarkTheme))

    const footer = resolveGridFilterPopupLayout(
      bounds,
      deriveGridFilterPopupStyle(ImGuiDarkTheme),
      deriveScrollbarStyle(ImGuiDarkTheme).gutterSize,
    ).footer
    const footerPaint = fillRect.mock.calls.findIndex(call =>
      call[0] === footer.x && call[1] === footer.y && call[2] === footer.w && call[3] === footer.h
    )
    const panelClip = roundedClip.mock.calls.findIndex(call =>
      call[0] === bounds.x && call[1] === bounds.y && call[2] === bounds.w && call[3] === bounds.h && (call[4] ?? 0) > 0
    )
    const panelOutlines = strokeRect.mock.calls.map((call, index) => ({ call, index })).filter(({ call }) =>
      call[0] === bounds.x && call[1] === bounds.y && call[2] === bounds.w && call[3] === bounds.h && (call[6] ?? 0) > 0
    )
    expect(footerPaint).toBeGreaterThanOrEqual(0)
    expect(panelClip).toBeGreaterThanOrEqual(0)
    expect(roundedClip.mock.invocationCallOrder[panelClip]!).toBeLessThan(fillRect.mock.invocationCallOrder[footerPaint]!)
    expect(panelOutlines).toHaveLength(2)
    expect(strokeRect.mock.invocationCallOrder[panelOutlines[1]!.index]!).toBeGreaterThan(fillRect.mock.invocationCallOrder[footerPaint]!)
    popup.dispose()
  })


  it.each(['unavailable', 'denied', 'empty', 'text'] as const)('handles %s clipboard reads without corrupting selected rows', async mode => {
    const readText = vi.fn(() => mode === 'denied'
      ? Promise.reject(new Error('permission denied'))
      : Promise.resolve(mode === 'empty' ? '' : 'Name\nUpdated'))
    vi.stubGlobal('navigator', { clipboard: mode === 'unavailable' ? undefined : { readText } })
    const rows = [{ id: 1, name: 'Original', qty: 1, active: true }]
    const onCellChange = vi.fn()
    const grid = new RenderDataGrid<RowData>({ columns, rows, editable: true, onCellChange })
    grid.setSelectedRows([rows[0]!])
    expect(() => grid.interaction.pasteFromClipboard()).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(rows[0]!.name).toBe(mode === 'text' ? 'Updated' : 'Original')
    expect(onCellChange).toHaveBeenCalledTimes(mode === 'text' ? 1 : 0)
    grid.dispose()
  })
})
