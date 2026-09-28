// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoxConstraints, LayoutContext } from '../core/render_object'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { PopupManager } from '../core/popup_manager'
import { TextMeasurer } from '../core/text_measurer'
import { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme } from '../theme/default_theme'
import type { GridColumnDef } from './grid/grid_types'
import type { TreeGridNode } from './tree_grid'
import { RenderDropTreeGridEdit } from './drop_tree_grid_edit'

interface DirectoryRow {
  name: string
  code: string
  category: string
  py?: string
}

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 220,
  minHeight: 0,
  maxHeight: 40,
}

const narrowConstraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 120,
  minHeight: 0,
  maxHeight: 40,
}

const layoutContext: LayoutContext = { theme: ImGuiDarkTheme }

const columns: GridColumnDef<DirectoryRow>[] = [
  { type: 'text', key: 'name', title: '名称', width: 180, fixed: true },
  { type: 'text', key: 'code', title: '编码', width: 100 },
  { type: 'text', key: 'category', title: '类别', width: 100 },
]

const roots: TreeGridNode<DirectoryRow>[] = [
  {
    key: 'diag-root',
    row: { name: '诊断目录', code: 'DX', category: '目录', py: 'zdml' },
    selectable: false,
    children: [
      {
        key: 'diag-resp',
        row: { name: '呼吸系统', code: 'DX-RESP', category: '分类', py: 'hxxt' },
        selectable: false,
        children: [
          { key: 'diag-cold', row: { name: '上呼吸道感染', code: 'J06.9', category: '诊断', py: 'shxdgr' } },
          { key: 'diag-bronch', row: { name: '急性支气管炎', code: 'J20.900', category: '诊断', py: 'jxzqgy' } },
        ],
      },
      {
        key: 'diag-cardio',
        row: { name: '循环系统', code: 'DX-CARD', category: '分类', py: 'xhxt' },
        selectable: false,
        children: [
          { key: 'diag-hyp', row: { name: '高血压病', code: 'I10.x00', category: '诊断', py: 'gxyb' } },
        ],
      },
    ],
  },
]

function createTextRecordingPaintContext(theme = ImGuiDarkTheme): { context: PaintContext; fillText: ReturnType<typeof vi.fn> } {
  const fillText = vi.fn()
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText,
    measureText: vi.fn(text => ({ width: String(text).length * 8 }) as TextMetrics),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    set fillStyle(_value: unknown) {},
    get fillStyle() { return '' },
    set strokeStyle(_value: unknown) {},
    get strokeStyle() { return '' },
    lineWidth: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, theme), fillText }
}

function setPopupTestContext(): void {
  PopupManager.instance.setContextProvider(() => ({
    theme: ImGuiDarkTheme,
    viewport: { width: 800, height: 520, dpr: 1 },
  }))
}

function createDropTreeGrid(value = ''): RenderDropTreeGridEdit<DirectoryRow> {
  const field = new RenderDropTreeGridEdit<DirectoryRow>({
    columns,
    roots,
    treeColumnKey: 'name',
    labelKey: 'name',
    value,
    placeholder: '检索诊断目录',
    searchable: true,
    clearable: true,
    queryTextBuilder: node => [node.key, node.row.name, node.row.code, node.row.py ?? ''],
    metaKey: 'code',
  })
  field.performLayout(constraints, layoutContext)
  return field
}

function paintField(field: RenderDropTreeGridEdit<DirectoryRow>): string[] {
  const painted = createTextRecordingPaintContext()
  field.performPaint(painted.context, { x: 0, y: 0 })
  return painted.fillText.mock.calls.map(call => String(call[0]))
}

afterEach(() => {
  PopupManager.instance.dispose()
  FocusManager.instance.dispose()
  InputComposer.instance.dispose()
  vi.restoreAllMocks()
})

describe('RenderDropTreeGridEdit', () => {
  it('implements the value editor contract without blurring during popup selection', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const valueChange = vi.fn()
    const blur = vi.fn()
    const field = new RenderDropTreeGridEdit<DirectoryRow>({
      columns,
      roots,
      treeColumnKey: 'name',
      labelKey: 'name',
      value: 'diag-hyp',
      onChange,
    })
    field.performLayout(constraints, layoutContext)
    field.subscribeValueChange(valueChange)
    field.subscribeBlur(blur)

    field.setValue('diag-diabetes')

    expect(field.getValue()).toBe('diag-diabetes')
    expect(onChange).not.toHaveBeenCalled()
    expect(valueChange).not.toHaveBeenCalled()

    field.requestFocus()
    field.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
    const popup = PopupManager.instance.current as any
    const selectedNode = { key: 'diag-hyp', row: { name: '高血压病', code: 'I10.x00', category: '诊断' } }
    popup._select(selectedNode)

    expect(valueChange).toHaveBeenCalledWith({
      value: 'diag-hyp',
      previousValue: 'diag-diabetes',
      reason: 'selection',
      detail: selectedNode,
    })
    expect(onChange).toHaveBeenCalledOnce()
    expect(blur).not.toHaveBeenCalled()

    field.blur()
    field.blur()

    expect(blur).toHaveBeenCalledOnce()
    field.dispose()
  })

  it('keeps legacy selection while suppressing unchanged formal value events', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const valueChange = vi.fn()
    const field = new RenderDropTreeGridEdit<DirectoryRow>({
      columns,
      roots,
      treeColumnKey: 'name',
      labelKey: 'name',
      value: 'diag-hyp',
      onChange,
    })
    field.performLayout(constraints, layoutContext)
    field.subscribeValueChange(valueChange)

    field.requestFocus()
    field.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
    const popup = PopupManager.instance.current as any
    const currentNode = roots[0]!.children![1]!.children![0]!
    popup._select(currentNode)

    expect(onChange).toHaveBeenCalledOnce()
    expect(valueChange).not.toHaveBeenCalled()
    expect(field.getValue()).toBe('diag-hyp')
    expect(field.debugState().popupVisible).toBe(false)
    expect(field.isFocused).toBe(true)

    field.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
    const nextNode = roots[0]!.children![0]!.children![0]!
    popup._select(nextNode)

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(valueChange).toHaveBeenCalledOnce()
    expect(valueChange).toHaveBeenCalledWith({
      value: 'diag-cold',
      previousValue: 'diag-hyp',
      reason: 'selection',
      detail: nextNode,
    })
    field.dispose()
  })

  it.each(['disabled', 'readonly'] as const)(
    'publishes one logical blur when an open tree grid editor becomes %s',
    state => {
      setPopupTestContext()
      const blur = vi.fn()
      const field = createDropTreeGrid()
      field.subscribeBlur(blur)

      field.requestFocus()
      field.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
      expect(field.debugState().popupVisible).toBe(true)

      field[state] = true
      field[state] = true

      expect(field.isFocused).toBe(false)
      expect(field.debugState().popupVisible).toBe(false)
      expect(blur).toHaveBeenCalledOnce()
      field.dispose()
    },
  )

  it('toggles popup when clicking the trigger', () => {
    setPopupTestContext()
    const field = createDropTreeGrid()

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    expect(PopupManager.instance.current).not.toBe(null)

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    expect(PopupManager.instance.current).toBe(null)
  })

  it('opens with typed query and filters tree roots through the default processor', () => {
    setPopupTestContext()
    const field = createDropTreeGrid()
    FocusManager.instance.setFocus(field)

    const consumed = field.onKeyDown(new KeyboardEvent('keydown', {
      key: '高',
      bubbles: true,
      cancelable: true,
    }))

    expect(consumed).toBe(true)
    const popup = PopupManager.instance.current as any
    expect(popup).not.toBe(null)
    expect(popup.searchText).toBe('高')
    expect(popup.filteredRoots.map((node: TreeGridNode<DirectoryRow>) => node.row.name)).toEqual(['诊断目录'])
    expect(popup.filteredRoots[0]?.children?.map((node: TreeGridNode<DirectoryRow>) => node.row.name)).toEqual(['循环系统'])
    expect(paintField(field)).toContain('高')
  })

  it('closes query presentation on Escape Tab disabled and exposes expanded debug state', () => {
    setPopupTestContext()
    const field = createDropTreeGrid('diag-cold')
    FocusManager.instance.setFocus(field)

    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '高',
      bubbles: true,
      cancelable: true,
    }))

    expect(field.debugState()).toMatchObject({
      popupVisible: true,
      queryText: '高',
      showQueryInField: true,
      displayText: '高',
      value: 'diag-cold',
      selectedLabel: '上呼吸道感染',
      filteredCount: 3,
    })
    expect(field.debugState().expandedKeys).toEqual(['diag-root', 'diag-cardio'])

    expect(field.onKeyDown(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))).toBe(false)
    expect(field.debugState()).toMatchObject({
      popupVisible: false,
      queryText: '',
      showQueryInField: false,
      displayText: '上呼吸道感染',
    })

    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '高',
      bubbles: true,
      cancelable: true,
    }))
    field.disabled = true

    expect(field.debugState()).toMatchObject({
      popupVisible: false,
      queryText: '',
      showQueryInField: false,
      disabled: true,
      value: 'diag-cold',
    })
  })

  it('uses custom queryProcessor to control filtered tree order', () => {
    setPopupTestContext()
    const queryProcessor = vi.fn(() => [
      {
        ...roots[0]!,
        children: [roots[0]!.children![1]!, roots[0]!.children![0]!],
      },
    ])
    const field = new RenderDropTreeGridEdit<DirectoryRow>({
      columns,
      roots,
      treeColumnKey: 'name',
      labelKey: 'name',
      searchable: true,
      queryProcessor,
    })
    field.performLayout(constraints, layoutContext)
    FocusManager.instance.setFocus(field)

    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '诊',
      bubbles: true,
      cancelable: true,
    }))

    const popup = PopupManager.instance.current as any
    expect(queryProcessor).toHaveBeenCalled()
    expect(popup.filteredRoots[0]?.children?.map((node: TreeGridNode<DirectoryRow>) => node.row.name)).toEqual(['循环系统', '呼吸系统'])
  })

  it('does not execute the query processor from debugState', () => {
    setPopupTestContext()
    const queryProcessor = vi.fn(() => [{
      ...roots[0]!,
      children: [roots[0]!.children![1]!],
    }])
    const field = new RenderDropTreeGridEdit<DirectoryRow>({
      columns,
      roots,
      treeColumnKey: 'name',
      labelKey: 'name',
      searchable: true,
      queryProcessor,
    })
    field.performLayout(constraints, layoutContext)

    expect(field.debugState().filteredCount).toBe(6)
    expect(queryProcessor).not.toHaveBeenCalled()

    FocusManager.instance.setFocus(field)
    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '诊',
      bubbles: true,
      cancelable: true,
    }))
    expect(queryProcessor).toHaveBeenCalled()

    queryProcessor.mockClear()
    expect(field.debugState().filteredCount).toBe(3)
    expect(queryProcessor).not.toHaveBeenCalled()
  })

  it('commits selection and renders the selected label with meta text', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const field = new RenderDropTreeGridEdit<DirectoryRow>({
      columns,
      roots,
      treeColumnKey: 'name',
      labelKey: 'name',
      onChange,
      clearable: true,
      metaKey: 'code',
    })
    field.performLayout(constraints, layoutContext)
    FocusManager.instance.setFocus(field)

    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '高',
      bubbles: true,
      cancelable: true,
    }))
    const popup = PopupManager.instance.current as any
    popup._select({ key: 'diag-hyp', row: { name: '高血压病', code: 'I10.x00', category: '诊断' } })

    expect(field.value).toBe('diag-hyp')
    expect(onChange).toHaveBeenCalledWith(
      'diag-hyp',
      expect.objectContaining({ key: 'diag-hyp' }),
    )
    expect(paintField(field)).toContain('高血压病')
    expect(paintField(field)).toContain('I10.x00')
  })

  it('syncs popup grid roots when the external roots change while open', () => {
    setPopupTestContext()
    const field = createDropTreeGrid()
    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    expect(popup._grid.roots[0]?.row.name).toBe('诊断目录')

    field.roots = [
      {
        key: 'exam-root',
        row: { name: '检查目录', code: 'EX', category: '目录', py: 'jcml' },
        selectable: false,
        children: [
          { key: 'exam-ct', row: { name: '头颅 CT', code: 'IMG301', category: '项目', py: 'tlct' } },
        ],
      },
    ]

    expect(popup._grid.roots[0]?.row.name).toBe('检查目录')
    expect(field.value).toBe('')
  })

  it('refreshes filtered tree grid roots and columns when rebound while open', () => {
    setPopupTestContext()
    const field = createDropTreeGrid('diag-cold')
    FocusManager.instance.setFocus(field)

    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '头',
      bubbles: true,
      cancelable: true,
    }))

    const popup = PopupManager.instance.current as any
    field.columns = [
      { type: 'text', key: 'category', title: '分类', width: 100 },
      { type: 'text', key: 'name', title: '名称', width: 180 },
    ]
    field.roots = [
      {
        key: 'exam-root',
        row: { name: '检查目录', code: 'EX', category: '目录', py: 'jcml' },
        selectable: false,
        children: [
          { key: 'exam-head-ct', row: { name: '头颅 CT', code: 'IMG301', category: '项目', py: 'tlct' } },
        ],
      },
    ]

    expect(field.value).toBe('diag-cold')
    expect(popup.columns.map((column: GridColumnDef<DirectoryRow>) => column.key)).toEqual(['category', 'name'])
    expect(popup._grid.roots[0]?.children?.map((node: TreeGridNode<DirectoryRow>) => node.row.name)).toEqual(['头颅 CT'])
    expect(field.debugState().filteredCount).toBe(2)
  })

  it('syncs popup selection when the external value changes while open', () => {
    setPopupTestContext()
    const field = createDropTreeGrid('diag-cold')
    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    expect(popup.selectedValue).toBe('diag-cold')
    expect(popup._grid.selectedKey).toBe('diag-cold')

    field.value = 'diag-hyp'

    expect(popup.selectedValue).toBe('diag-hyp')
    expect(popup._grid.selectedKey).toBe('diag-hyp')
  })

  it('clears tree grid hover when the pointer moves into the search box', () => {
    setPopupTestContext()
    const field = createDropTreeGrid()
    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    popup.paint(createTextRecordingPaintContext().context)
    const layout = popup._layout()
    popup._grid._hoveredItemIndex = 2

    popup.onPanelPointerMove({
      pointerId: 0,
      position: {
        x: layout.searchRect.x + 12,
        y: layout.searchRect.y + 12,
      },
      type: 'move',
    }, PopupManager.instance.context, layout)

    expect(popup._grid._hoveredItemIndex).toBe(-1)
  })

  it('centers the no-match hint inside the body below the column header', () => {
    setPopupTestContext()
    const field = createDropTreeGrid()
    FocusManager.instance.setFocus(field)
    field.onKeyDown(new KeyboardEvent('keydown', { key: '无', cancelable: true }))

    const popup = PopupManager.instance.current as any
    expect(popup.filteredRoots).toHaveLength(0)
    const painted = createTextRecordingPaintContext()
    popup.paint(painted.context)
    const layout = popup._layout()
    const hint = painted.fillText.mock.calls.find(call => call[0] === '无匹配节点')

    expect(hint).toBeDefined()
    expect(Math.abs(hint![1] - (layout.gridRect.x + layout.gridRect.w / 2))).toBeLessThanOrEqual(0.5)
    expect(Math.abs(hint![2] - (layout.gridRect.y + layout.headerH + (layout.gridRect.h - layout.headerH) / 2))).toBeLessThanOrEqual(0.5)
    expect(hint![2]).toBeGreaterThan(layout.gridRect.y + layout.headerH)
  })

  it('reveals the current selection inside the popup viewport when opened', () => {
    setPopupTestContext()
    const manyRoots: TreeGridNode<DirectoryRow>[] = [
      {
        key: 'root',
        row: { name: '目录', code: 'ROOT', category: '目录' },
        selectable: false,
        children: Array.from({ length: 18 }, (_, index) => ({
          key: `node-${index}`,
          row: { name: `项目 ${index}`, code: `CODE-${index}`, category: '项目' },
        })),
      },
    ]
    const field = new RenderDropTreeGridEdit<DirectoryRow>({
      columns,
      roots: manyRoots,
      treeColumnKey: 'name',
      labelKey: 'name',
      value: 'node-15',
      expandAllOnOpen: true,
    })
    field.performLayout(constraints, layoutContext)

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    popup.paint(createTextRecordingPaintContext().context)
    expect(popup._grid.debugState().scrollY).toBeGreaterThan(0)
  })

  it('sizes the default popup wide enough to show all configured columns without manual resize', () => {
    setPopupTestContext()
    const field = createDropTreeGrid()

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    const layout = popup._layout()
    const totalColumnWidth = columns.reduce((sum, column) => sum + (column.width ?? 0), 0)

    expect(layout.gridRect.w).toBeGreaterThanOrEqual(totalColumnWidth)
  })

  it('does not reserve scrollbar gutters when all expanded popup rows are visible', () => {
    setPopupTestContext()
    const field = new RenderDropTreeGridEdit<DirectoryRow>({
      columns,
      roots,
      treeColumnKey: 'name',
      labelKey: 'name',
      searchable: true,
      expandedKeysOnOpen: ['diag-root', 'diag-resp', 'diag-cardio'],
    })
    field.performLayout(constraints, layoutContext)

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    popup.paint(createTextRecordingPaintContext().context)
    const grid = popup._grid as any
    const viewport = grid._viewport
    const visibleCount = grid.debugState().visibleKeys.length

    expect(viewport.viewWidth).toBe(viewport.size.width)
    expect(viewport.viewHeight).toBe(viewport.size.height - viewport.headerHeight)
    expect(viewport.totalContentHeight(visibleCount)).toBe(viewport.viewHeight)
  })

  it('merges expandedKeysOnOpen with the selected path', () => {
    setPopupTestContext()
    const field = new RenderDropTreeGridEdit<DirectoryRow>({
      columns,
      roots,
      treeColumnKey: 'name',
      labelKey: 'name',
      value: 'diag-hyp',
      expandedKeysOnOpen: ['diag-root'],
    })
    field.performLayout(constraints, layoutContext)

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    expect(popup._grid.expandedKeys).toContain('diag-root')
    expect(popup._grid.expandedKeys).toContain('diag-cardio')
  })

  it('syncs runtime columns and tree column changes into the open popup', () => {
    setPopupTestContext()
    const field = createDropTreeGrid()
    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    const nextColumns: GridColumnDef<DirectoryRow>[] = [
      { type: 'text', key: 'category', title: '类别', width: 96 },
      { type: 'text', key: 'name', title: '名称', width: 180 },
    ]

    field.columns = nextColumns

    expect(popup.columns).toBe(nextColumns)
    expect(popup._grid.columns).toBe(nextColumns)

    field.treeColumnKey = 'category'

    expect(popup.treeColumnKey).toBe('category')
    expect(popup._grid.treeColumnKey).toBe('category')

    field.columns = [
      { type: 'text', key: 'code', title: '编码', width: 120 },
    ]

    expect(field.treeColumnKey).toBe('code')
    expect(popup.treeColumnKey).toBe('code')
    expect(popup._grid.treeColumnKey).toBe('code')
  })

  it('shows the full selected text in tooltip when the trigger text is clipped', () => {
    setPopupTestContext()
    const measureWidth = vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => String(text).length * 8)
    const field = new RenderDropTreeGridEdit<DirectoryRow>({
      columns,
      roots,
      treeColumnKey: 'name',
      labelKey: 'name',
      value: 'diag-cold',
      metaKey: 'code',
    })
    field.performLayout(narrowConstraints, layoutContext)

    const painted = paintField(field)

    expect(field.tooltip).toBe('上呼吸道感染  J06.9')
    expect(painted.some(text => text.includes('...'))).toBe(true)

    measureWidth.mockRestore()
  })

  it('keeps readonly instances inert and out of the focus chain', () => {
    setPopupTestContext()
    const field = new RenderDropTreeGridEdit<DirectoryRow>({
      columns,
      roots,
      treeColumnKey: 'name',
      labelKey: 'name',
      readonly: true,
      value: 'diag-hyp',
    })
    field.performLayout(constraints, layoutContext)

    field.focusIn()
    expect(field.isFocused).toBe(false)

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    expect(PopupManager.instance.current).toBe(null)
    expect(FocusManager.instance.current).not.toBe(field)
    expect(FocusManager.instance.scopeStack[0]?.focusables.includes(field)).toBe(false)
  })
})
