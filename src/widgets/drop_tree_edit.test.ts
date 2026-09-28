// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoxConstraints, LayoutContext } from '../core/render_object'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { PopupManager } from '../core/popup_manager'
import { TextMeasurer } from '../core/text_measurer'
import { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme } from '../theme/default_theme'
import type { TreeNode } from './tree'
import { RenderDropTreeEdit } from './drop_tree_edit'

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 220,
  minHeight: 0,
  maxHeight: 40,
}

const layoutContext: LayoutContext = { theme: ImGuiDarkTheme }

const departmentRoots: TreeNode<{ py?: string }>[] = [
  {
    key: 'dept-internal',
    label: '内科系统',
    selectable: false,
    data: { py: 'nkxt' },
    children: [
      { key: 'dept-cardiology', label: '心内科', data: { py: 'xnk' } },
      { key: 'dept-respiratory', label: '呼吸科', data: { py: 'hxk' } },
    ],
  },
  {
    key: 'dept-surgery',
    label: '外科系统',
    selectable: false,
    data: { py: 'wkxt' },
    children: [
      { key: 'dept-general-surgery', label: '普外科', data: { py: 'pwk' } },
      { key: 'dept-neurosurgery', label: '神经外科', data: { py: 'sjwk' } },
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
    viewport: { width: 640, height: 480, dpr: 1 },
  }))
}

function createDropTree(value = ''): RenderDropTreeEdit<any> {
  const field = new RenderDropTreeEdit({
    roots: departmentRoots,
    value,
    placeholder: '检索科室目录',
    searchable: true,
    clearable: true,
    queryTextBuilder: node => [node.key, node.label, node.data?.py ?? ''],
  })
  field.performLayout(constraints, layoutContext)
  return field
}

function paintField(field: RenderDropTreeEdit<any>): string[] {
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

describe('RenderDropTreeEdit', () => {
  it('implements the value editor contract without blurring during popup selection', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const valueChange = vi.fn()
    const blur = vi.fn()
    const field = new RenderDropTreeEdit({
      roots: departmentRoots,
      value: 'dept-cardiology',
      onChange,
    })
    field.performLayout(constraints, layoutContext)
    field.subscribeValueChange(valueChange)
    field.subscribeBlur(blur)

    field.setValue('dept-general-surgery')

    expect(field.getValue()).toBe('dept-general-surgery')
    expect(onChange).not.toHaveBeenCalled()
    expect(valueChange).not.toHaveBeenCalled()

    field.requestFocus()
    field.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
    const popup = PopupManager.instance.current as any
    popup._select(departmentRoots[0]!.children![1]!)

    expect(valueChange).toHaveBeenCalledWith({
      value: 'dept-respiratory',
      previousValue: 'dept-general-surgery',
      reason: 'selection',
      detail: departmentRoots[0]!.children![1]!,
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
    const field = new RenderDropTreeEdit({
      roots: departmentRoots,
      value: 'dept-cardiology',
      onChange,
    })
    field.performLayout(constraints, layoutContext)
    field.subscribeValueChange(valueChange)

    field.requestFocus()
    field.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
    const popup = PopupManager.instance.current as any
    popup._select(departmentRoots[0]!.children![0]!)

    expect(onChange).toHaveBeenCalledOnce()
    expect(valueChange).not.toHaveBeenCalled()
    expect(field.getValue()).toBe('dept-cardiology')
    expect(field.debugState().popupVisible).toBe(false)
    expect(field.isFocused).toBe(true)

    field.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
    popup._select(departmentRoots[0]!.children![1]!)

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(valueChange).toHaveBeenCalledOnce()
    expect(valueChange).toHaveBeenCalledWith({
      value: 'dept-respiratory',
      previousValue: 'dept-cardiology',
      reason: 'selection',
      detail: departmentRoots[0]!.children![1]!,
    })
    field.dispose()
  })

  it.each(['disabled', 'readonly'] as const)(
    'publishes one logical blur when an open tree editor becomes %s',
    state => {
      setPopupTestContext()
      const blur = vi.fn()
      const field = createDropTree()
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
    const field = createDropTree()

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
    const field = createDropTree()
    FocusManager.instance.setFocus(field)

    const consumed = field.onKeyDown(new KeyboardEvent('keydown', {
      key: '呼',
      bubbles: true,
      cancelable: true,
    }))

    expect(consumed).toBe(true)
    const popup = PopupManager.instance.current as any
    expect(popup).not.toBe(null)
    expect(popup.searchText).toBe('呼')
    expect(popup.filteredRoots.map((node: TreeNode<any>) => node.label)).toEqual(['内科系统'])
    expect(popup.filteredRoots[0]?.children?.map((node: TreeNode<any>) => node.label)).toEqual(['呼吸科'])
    expect(paintField(field)).toContain('呼')
  })

  it('closes query presentation on Escape Tab disabled and exposes expanded debug state', () => {
    setPopupTestContext()
    const field = createDropTree('dept-cardiology')
    FocusManager.instance.setFocus(field)

    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '神',
      bubbles: true,
      cancelable: true,
    }))

    expect(field.debugState()).toMatchObject({
      popupVisible: true,
      queryText: '神',
      showQueryInField: true,
      displayText: '神',
      value: 'dept-cardiology',
      filteredCount: 2,
    })
    expect(field.debugState().expandedKeys).toContain('dept-surgery')

    expect(field.onKeyDown(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))).toBe(false)
    expect(field.debugState()).toMatchObject({
      popupVisible: false,
      queryText: '',
      showQueryInField: false,
      displayText: '心内科',
    })

    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '神',
      bubbles: true,
      cancelable: true,
    }))
    field.disabled = true

    expect(field.debugState()).toMatchObject({
      popupVisible: false,
      queryText: '',
      showQueryInField: false,
      disabled: true,
      value: 'dept-cardiology',
    })
  })

  it('uses custom queryProcessor to control filtered tree order', () => {
    setPopupTestContext()
    const queryProcessor = vi.fn(() => [departmentRoots[1]!, departmentRoots[0]!])
    const field = new RenderDropTreeEdit({
      roots: departmentRoots,
      searchable: true,
      queryProcessor,
    })
    field.performLayout(constraints, layoutContext)
    FocusManager.instance.setFocus(field)

    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '科',
      bubbles: true,
      cancelable: true,
    }))

    const popup = PopupManager.instance.current as any
    expect(queryProcessor).toHaveBeenCalled()
    expect(popup.filteredRoots.map((node: TreeNode<any>) => node.label)).toEqual(['外科系统', '内科系统'])
  })

  it('does not execute the query processor from debugState', () => {
    setPopupTestContext()
    const queryProcessor = vi.fn(() => [departmentRoots[1]!])
    const field = new RenderDropTreeEdit({
      roots: departmentRoots,
      searchable: true,
      queryProcessor,
    })
    field.performLayout(constraints, layoutContext)

    expect(field.debugState().filteredCount).toBe(6)
    expect(queryProcessor).not.toHaveBeenCalled()

    FocusManager.instance.setFocus(field)
    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '科',
      bubbles: true,
      cancelable: true,
    }))
    expect(queryProcessor).toHaveBeenCalled()

    queryProcessor.mockClear()
    expect(field.debugState().filteredCount).toBe(3)
    expect(queryProcessor).not.toHaveBeenCalled()
  })

  it('commits selection and renders the selected node label', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const field = new RenderDropTreeEdit({
      roots: departmentRoots,
      onChange,
      clearable: true,
    })
    field.performLayout(constraints, layoutContext)
    FocusManager.instance.setFocus(field)

    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '呼',
      bubbles: true,
      cancelable: true,
    }))
    const popup = PopupManager.instance.current as any
    popup._select({ key: 'dept-respiratory', label: '呼吸科', data: { py: 'hxk' } })

    expect(field.value).toBe('dept-respiratory')
    expect(onChange).toHaveBeenCalledWith(
      'dept-respiratory',
      expect.objectContaining({ key: 'dept-respiratory', label: '呼吸科' }),
    )
    expect(paintField(field)).toContain('呼吸科')
  })

  it('consumes wheel inside the popup even when the tree itself does not overflow', () => {
    setPopupTestContext()
    const field = createDropTree()

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    const layout = popup._layout(PopupManager.instance.context)
    expect(PopupManager.instance.handleWheel({
      pointerId: 0,
      position: {
        x: layout.treeRect.x + 8,
        y: layout.treeRect.y + 8,
      },
      type: 'wheel',
      deltaX: 0,
      deltaY: 120,
    })).toBe(true)
  })

  it('centers the no-match hint inside the tree viewport', () => {
    setPopupTestContext()
    const field = createDropTree()
    FocusManager.instance.setFocus(field)
    field.onKeyDown(new KeyboardEvent('keydown', { key: '无', cancelable: true }))

    const popup = PopupManager.instance.current as any
    expect(popup.filteredRoots).toHaveLength(0)
    const painted = createTextRecordingPaintContext()
    popup.paint(painted.context)
    const layout = popup._layout(PopupManager.instance.context)
    const hint = painted.fillText.mock.calls.find(call => call[0] === '无匹配节点')

    expect(hint).toBeDefined()
    expect(Math.abs(hint![1] - (layout.treeRect.x + layout.treeRect.w / 2))).toBeLessThanOrEqual(0.5)
    expect(Math.abs(hint![2] - (layout.treeRect.y + layout.treeRect.h / 2))).toBeLessThanOrEqual(0.5)
  })

  it('syncs popup tree roots when the external roots change while open', () => {
    setPopupTestContext()
    const field = createDropTree()
    FocusManager.instance.setFocus(field)

    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '科',
      bubbles: true,
      cancelable: true,
    }))

    const popup = PopupManager.instance.current as any
    expect(popup._tree.roots.map((node: TreeNode<any>) => node.label)).toEqual(['内科系统', '外科系统'])

    field.roots = [
      {
        key: 'dept-support',
        label: '支撑平台',
        data: { py: 'zcpt' },
        children: [
          { key: 'dept-medical-record', label: '病案科', data: { py: 'bak' } },
        ],
      },
    ]

    expect(field.value).toBe('')
    expect(popup._tree.roots.map((node: TreeNode<any>) => node.label)).toEqual(['支撑平台'])
    expect(field.debugState().filteredCount).toBe(2)
  })

  it('syncs popup tree selection when the external value changes while open', () => {
    setPopupTestContext()
    const field = createDropTree('dept-cardiology')
    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    expect(popup.selectedValue).toBe('dept-cardiology')
    expect(popup._tree.selectedKey).toBe('dept-cardiology')

    field.value = 'dept-neurosurgery'

    expect(popup.selectedValue).toBe('dept-neurosurgery')
    expect(popup._tree.selectedKey).toBe('dept-neurosurgery')
  })

  it('reveals the current selection inside the popup viewport when opened', () => {
    setPopupTestContext()
    const roots = Array.from({ length: 16 }, (_, index) => ({
      key: `dept-${index}`,
      label: `科室 ${index}`,
    }))
    const field = new RenderDropTreeEdit({
      roots,
      value: 'dept-12',
    })
    field.performLayout(constraints, layoutContext)

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    const painted = createTextRecordingPaintContext()
    popup.paint(painted.context)

    expect(popup._tree.debugState().scrollY).toBeGreaterThan(0)
  })

  it('restores the selected label after closing an uncommitted query', () => {
    setPopupTestContext()
    const field = createDropTree('dept-cardiology')
    FocusManager.instance.setFocus(field)

    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '神',
      bubbles: true,
      cancelable: true,
    }))
    expect(paintField(field)).toContain('神')

    const popup = PopupManager.instance.current as any
    popup.close()

    expect(paintField(field)).toContain('心内科')
    expect(paintField(field)).not.toContain('神')
  })

  it('does not persist search-expanded branches into the normal expanded state', () => {
    setPopupTestContext()
    const field = createDropTree()

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    let popup = PopupManager.instance.current as any
    popup._tree.expandedKeys = ['dept-internal']
    popup.close()

    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '科',
      bubbles: true,
      cancelable: true,
    }))

    popup = PopupManager.instance.current as any
    expect(popup._tree.expandedKeys).toEqual(['dept-internal', 'dept-surgery'])
    popup.close()

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    popup = PopupManager.instance.current as any
    expect(popup._tree.expandedKeys).toEqual(['dept-internal'])
  })

  it('can expand specific branches on open through business-provided keys', () => {
    setPopupTestContext()
    const field = new RenderDropTreeEdit({
      roots: departmentRoots,
      expandedKeysOnOpen: ['dept-surgery'],
    })
    field.performLayout(constraints, layoutContext)

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    expect(popup._tree.expandedKeys).toEqual(['dept-surgery'])
  })

  it('can expand all branches on open when configured', () => {
    setPopupTestContext()
    const field = new RenderDropTreeEdit({
      roots: departmentRoots,
      expandAllOnOpen: true,
    })
    field.performLayout(constraints, layoutContext)

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    expect(popup._tree.expandedKeys).toEqual(['dept-internal', 'dept-surgery'])
  })

  it('does not commit category nodes and only leaf nodes become selected values', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const field = new RenderDropTreeEdit({
      roots: departmentRoots,
      onChange,
    })
    field.performLayout(constraints, layoutContext)

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    popup._select({ key: 'dept-internal', label: '内科系统', selectable: false })

    expect(field.value).toBe('')
    expect(onChange).not.toHaveBeenCalled()

    popup._select({ key: 'dept-cardiology', label: '心内科' })

    expect(field.value).toBe('dept-cardiology')
    expect(onChange).toHaveBeenCalledWith('dept-cardiology', expect.objectContaining({ key: 'dept-cardiology' }))
  })

  it('ellipsizes selected trigger text when width is constrained', () => {
    const measureWidth = vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => String(text).length * 8)
    const field = new RenderDropTreeEdit({
      roots: [
        {
          key: 'root',
          label: '目录',
          selectable: false,
          children: [{ key: 'long', label: '非常长的业务科室名称' }],
        },
      ],
      value: 'long',
    })
    field.performLayout({
      minWidth: 0,
      maxWidth: 72,
      minHeight: 0,
      maxHeight: 40,
    }, layoutContext)

    expect(paintField(field).some(text => text.includes('...'))).toBe(true)

    measureWidth.mockRestore()
  })

  it('does not open popup when readonly and unregisters from focus order', () => {
    setPopupTestContext()
    const field = new RenderDropTreeEdit({
      roots: departmentRoots,
      value: 'dept-cardiology',
      readonly: true,
      clearable: true,
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
    expect(field.isFocused).toBe(false)

    const consumed = field.onKeyDown(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    }))
    expect(consumed).toBe(false)
    expect(PopupManager.instance.current).toBe(null)
    expect(field.value).toBe('dept-cardiology')
    expect(FocusManager.instance.scopeStack[0]?.focusables.includes(field)).toBe(false)
  })
})
