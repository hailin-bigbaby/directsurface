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
import { RenderDropCheckTreeEdit } from './drop_check_tree_edit'

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 220,
  minHeight: 0,
  maxHeight: 40,
}

const layoutContext: LayoutContext = { theme: ImGuiDarkTheme }

const teamRoots: TreeNode<{ py?: string }>[] = [
  {
    key: 'team-product',
    label: '产品团队',
    selectable: false,
    checkable: false,
    data: { py: 'cptd' },
    children: [
      { key: 'team-design', label: '设计组', data: { py: 'sjz' } },
      { key: 'team-quality', label: '测试组', data: { py: 'csz' } },
    ],
  },
  {
    key: 'team-engineering',
    label: '技术团队',
    selectable: false,
    checkable: false,
    data: { py: 'jstd' },
    children: [
      { key: 'team-platform', label: '平台组', data: { py: 'ptz' } },
      { key: 'team-operations', label: '运维小组', data: { py: 'ywxz' } },
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

function createDropCheckTree(checkedKeys: readonly string[] = []): RenderDropCheckTreeEdit<any> {
  const field = new RenderDropCheckTreeEdit({
    roots: teamRoots,
    checkedKeys,
    placeholder: '检索适用团队范围',
    searchable: true,
    clearable: true,
    queryTextBuilder: node => [node.key, node.label, node.data?.py ?? ''],
  })
  field.performLayout(constraints, layoutContext)
  return field
}

function paintField(field: RenderDropCheckTreeEdit<any>): string[] {
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

describe('RenderDropCheckTreeEdit', () => {
  it('implements the array value editor contract with copied values and logical blur', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const valueChange = vi.fn()
    const blur = vi.fn()
    const field = new RenderDropCheckTreeEdit({
      roots: teamRoots,
      checkedKeys: ['team-design'],
      onChange,
    })
    field.performLayout(constraints, layoutContext)
    field.subscribeValueChange(valueChange)
    field.subscribeBlur(blur)

    const modelValue = ['team-platform']
    field.setValue(modelValue)
    modelValue.push('team-operations')

    expect(field.getValue()).toEqual(['team-platform'])
    expect(onChange).not.toHaveBeenCalled()
    expect(valueChange).not.toHaveBeenCalled()

    field.requestFocus()
    field.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
    const popup = PopupManager.instance.current as any
    const selectedNodes = [teamRoots[0]!.children![0]!]
    popup._onCheck(['team-design'], selectedNodes)

    expect(valueChange).toHaveBeenCalledWith({
      value: ['team-design'],
      previousValue: ['team-platform'],
      reason: 'selection',
      detail: selectedNodes,
    })
    expect(onChange).toHaveBeenCalledOnce()
    expect(blur).not.toHaveBeenCalled()

    field.blur()
    field.blur()

    expect(blur).toHaveBeenCalledOnce()
    field.dispose()
  })

  it.each(['disabled', 'readonly'] as const)(
    'publishes one logical blur when an open check tree editor becomes %s',
    state => {
      setPopupTestContext()
      const blur = vi.fn()
      const field = createDropCheckTree()
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
    const field = createDropCheckTree()

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
    const field = createDropCheckTree()
    FocusManager.instance.setFocus(field)

    const consumed = field.onKeyDown(new KeyboardEvent('keydown', {
      key: '测',
      bubbles: true,
      cancelable: true,
    }))

    expect(consumed).toBe(true)
    const popup = PopupManager.instance.current as any
    expect(popup).not.toBe(null)
    expect(popup.searchText).toBe('测')
    expect(popup.filteredRoots.map((node: TreeNode<any>) => node.label)).toEqual(['产品团队'])
    expect(popup.filteredRoots[0]?.children?.map((node: TreeNode<any>) => node.label)).toEqual(['测试组'])
    expect(paintField(field)).toContain('测')
  })

  it('does not execute the query processor from debugState', () => {
    setPopupTestContext()
    const queryProcessor = vi.fn(() => [teamRoots[1]!])
    const field = new RenderDropCheckTreeEdit({
      roots: teamRoots,
      searchable: true,
      queryProcessor,
    })
    field.performLayout(constraints, layoutContext)

    expect(field.debugState().filteredCount).toBe(6)
    expect(queryProcessor).not.toHaveBeenCalled()

    FocusManager.instance.setFocus(field)
    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '组',
      bubbles: true,
      cancelable: true,
    }))
    expect(queryProcessor).toHaveBeenCalled()

    queryProcessor.mockClear()
    expect(field.debugState().filteredCount).toBe(3)
    expect(queryProcessor).not.toHaveBeenCalled()
  })

  it('closes query presentation on Escape Tab disabled and exposes checked debug state', () => {
    setPopupTestContext()
    const field = createDropCheckTree(['team-design'])
    FocusManager.instance.setFocus(field)

    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '运',
      bubbles: true,
      cancelable: true,
    }))

    expect(field.debugState()).toMatchObject({
      popupVisible: true,
      queryText: '运',
      showQueryInField: true,
      displayText: '运',
      checkedKeys: ['team-design'],
      checkedLabel: '设计组',
      filteredCount: 2,
    })
    expect(field.debugState().expandedKeys).toContain('team-engineering')

    expect(field.onKeyDown(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))).toBe(false)
    expect(field.debugState()).toMatchObject({
      popupVisible: false,
      queryText: '',
      showQueryInField: false,
      displayText: '设计组',
    })

    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '运',
      bubbles: true,
      cancelable: true,
    }))
    field.disabled = true

    expect(field.debugState()).toMatchObject({
      popupVisible: false,
      queryText: '',
      showQueryInField: false,
      disabled: true,
      checkedKeys: ['team-design'],
      checkedLabel: '设计组',
    })
  })

  it('commits checked leaf nodes through tree keyboard interaction and updates the summary', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const field = new RenderDropCheckTreeEdit({
      roots: teamRoots,
      searchable: false,
      clearable: true,
      expandAllOnOpen: true,
      onChange,
    })
    field.performLayout(constraints, layoutContext)

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    expect(popup).not.toBe(null)

    FocusManager.instance.setFocus(popup._tree)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))

    expect(field.checkedKeys).toEqual(['team-design'])
    expect(onChange).toHaveBeenCalledWith(
      ['team-design'],
      [expect.objectContaining({ key: 'team-design', label: '设计组' })],
    )
    expect(paintField(field)).toContain('设计组')
  })

  it('does not grow collapsed parent rows when checking the parent checkbox', () => {
    setPopupTestContext()
    const field = new RenderDropCheckTreeEdit({
      roots: [{
        key: 'support',
        label: '支撑团队',
        children: [
          { key: 'testing', label: '检测组' },
          { key: 'analysis', label: '分析组' },
        ],
      }],
      searchable: false,
    })
    field.performLayout(constraints, layoutContext)

    field.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })

    const popup = PopupManager.instance.current as any
    popup.paint(createTextRecordingPaintContext().context)
    const beforeLayout = popup._layout(PopupManager.instance.context)
    const tree = popup._tree as any
    const rowLayout = tree._rowLayout(tree._flatNodes[0], beforeLayout.treeRect.x, beforeLayout.treeRect.y, ImGuiDarkTheme)
    const checkboxRect = rowLayout.checkboxRect
    expect(checkboxRect).not.toBe(null)

    popup.onPointerDown({
      pointerId: 0,
      position: {
        x: checkboxRect.x + checkboxRect.w / 2,
        y: checkboxRect.y + checkboxRect.h / 2,
      },
      type: 'down',
    })

    const afterLayout = popup._layout(PopupManager.instance.context)
    expect(field.checkedKeys).toEqual(['testing', 'analysis'])
    expect(tree.expandedKeys).toEqual([])
    expect(afterLayout.panelH).toBe(beforeLayout.panelH)
    expect(afterLayout.treeRect.h).toBe(beforeLayout.treeRect.h)
  })

  it('consumes wheel inside the popup even when the tree itself does not overflow', () => {
    setPopupTestContext()
    const field = createDropCheckTree()

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

  it('clears checked keys from the trigger clear affordance', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const field = new RenderDropCheckTreeEdit({
      roots: teamRoots,
      checkedKeys: ['team-design', 'team-quality'],
      clearable: true,
      onChange,
    })
    field.performLayout(constraints, layoutContext)
    const clearRect = (field as any)._triggerLayout().clearRect as { x: number; y: number; w: number; h: number }

    field.onPointerDown({
      pointerId: 0,
      position: { x: clearRect.x + clearRect.w / 2, y: clearRect.y + clearRect.h / 2 },
      type: 'down',
    })

    expect(field.checkedKeys).toEqual([])
    expect(onChange).toHaveBeenCalledWith([], [])
  })

  it('syncs popup roots after rebinding while preserving checked keys', () => {
    setPopupTestContext()
    const field = createDropCheckTree(['team-design'])
    FocusManager.instance.setFocus(field)

    field.onKeyDown(new KeyboardEvent('keydown', {
      key: '组',
      bubbles: true,
      cancelable: true,
    }))

    const popup = PopupManager.instance.current as any
    field.roots = [
      {
        key: 'team-support',
        label: '支撑平台',
        data: { py: 'zcpt' },
        children: [
          { key: 'team-archive', label: '档案组', data: { py: 'daz' } },
        ],
      },
    ]

    expect(field.checkedKeys).toEqual(['team-design'])
    expect(popup._tree.roots.map((node: TreeNode<any>) => node.label)).toEqual(['支撑平台'])
    expect(field.debugState().filteredCount).toBe(2)
  })

  it('does not open when readonly', () => {
    setPopupTestContext()
    const field = new RenderDropCheckTreeEdit({
      roots: teamRoots,
      checkedKeys: ['team-design'],
      readonly: true,
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

  it('supports expandAllOnOpen and custom expandedKeysOnOpen strategies', () => {
    setPopupTestContext()
    const expandAllField = new RenderDropCheckTreeEdit({
      roots: teamRoots,
      searchable: false,
      expandAllOnOpen: true,
    })
    expandAllField.performLayout(constraints, layoutContext)
    expandAllField.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })
    let popup = PopupManager.instance.current as any
    expect(popup._tree.expandedKeys).toEqual(['team-product', 'team-engineering'])
    popup.close()

    const customField = new RenderDropCheckTreeEdit({
      roots: teamRoots,
      searchable: false,
      checkedKeys: ['team-platform'],
      expandedKeysOnOpen: ['team-product'],
    })
    customField.performLayout(constraints, layoutContext)
    customField.onPointerDown({
      pointerId: 0,
      position: { x: 8, y: 8 },
      type: 'down',
    })
    popup = PopupManager.instance.current as any
    expect(popup._tree.expandedKeys).toEqual(['team-product', 'team-engineering'])
  })

  it('exposes full checked labels in tooltip when the trigger summary is abbreviated or clipped', () => {
    const measureWidth = vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => String(text).length * 8)
    const field = new RenderDropCheckTreeEdit({
      roots: teamRoots,
      checkedKeys: ['team-design', 'team-quality', 'team-platform'],
      maxSummaryItems: 2,
    })
    field.performLayout({
      minWidth: 0,
      maxWidth: 72,
      minHeight: 0,
      maxHeight: 40,
    }, layoutContext)

    field.performPaint(createTextRecordingPaintContext().context, { x: 0, y: 0 })
    expect(field.tooltip).toBe('设计组、测试组、平台组')
    expect(paintField(field).some(text => text.includes('...'))).toBe(true)

    field.performLayout({
      minWidth: 0,
      maxWidth: 280,
      minHeight: 0,
      maxHeight: 40,
    }, layoutContext)
    field.performPaint(createTextRecordingPaintContext().context, { x: 0, y: 0 })
    expect(field.tooltip).toBe('设计组、测试组、平台组')

    measureWidth.mockRestore()
  })
})
