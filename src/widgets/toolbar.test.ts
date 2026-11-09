import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { TextMeasurer } from '../core/text_measurer'
import { PopupManager } from '../core/popup_manager'
import { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { colorToCSS } from '../theme/theme'
import { deriveToolbarStyle } from '../theme/component_styles'
import { RenderToolbar } from './toolbar'
import { RenderWindow } from './window'

const originalWindow = globalThis.window
if (typeof globalThis.window === 'undefined') {
  ;(globalThis as unknown as { window: Window }).window = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as Window
}

function createPaintContext(): {
  context: PaintContext
  fill: ReturnType<typeof vi.fn>
  stroke: ReturnType<typeof vi.fn>
  strokeStyles: string[]
  textPaints: Array<{ text: string; color: string }>
  calls: string[]
} {
  const calls: string[] = []
  const fill = vi.fn()
  const stroke = vi.fn()
  const strokeStyles: string[] = []
  const textPaints: Array<{ text: string; color: string }> = []
  let currentFillStyle = ''
  const gradient = { addColorStop: vi.fn() }
  const ctx = {
    save: vi.fn(() => calls.push('save')),
    restore: vi.fn(() => calls.push('restore')),
    beginPath: vi.fn(() => calls.push('beginPath')),
    roundRect: vi.fn(),
    rect: vi.fn(() => calls.push('rect')),
    clip: vi.fn(() => calls.push('clip')),
    fill,
    stroke,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn((text: string) => textPaints.push({ text, color: currentFillStyle })),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    set fillStyle(value: unknown) { currentFillStyle = String(value) },
    get fillStyle() { return currentFillStyle },
    set strokeStyle(value: unknown) { strokeStyles.push(String(value)) },
    get strokeStyle() { return strokeStyles.at(-1) ?? '' },
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, ImGuiDarkTheme), fill, stroke, strokeStyles, textPaints, calls }
}

describe('RenderToolbar', () => {
  afterEach(() => {
    PopupManager.disposeInstance()
    vi.restoreAllMocks()
  })

  afterAll(() => {
    if (typeof originalWindow === 'undefined') {
      delete (globalThis as { window?: Window }).window
    }
  })

  it('overflows leading commands before trailing commands', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(label => label.length * 10)
    const toolbar = new RenderToolbar({
      groups: [
        {
          id: 'file',
          slot: 'leading',
          items: [{ id: 'new', kind: 'button', label: '新建文档', icon: 'plus' }],
        },
        {
          id: 'edit',
          slot: 'leading',
          items: [{ id: 'replace', kind: 'button', label: '批量替换内容', icon: 'refresh' }],
        },
        {
          id: 'status',
          slot: 'trailing',
          items: [{ id: 'notify', kind: 'button', label: '通知', icon: 'bell' }],
        },
      ],
    })

    toolbar.layout({ minWidth: 0, maxWidth: 180, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })

    const state = toolbar.debugState()
    expect(state.visibleLeadingGroupIds).toEqual(['file'])
    expect(state.visibleTrailingGroupIds).toEqual(['status'])
    expect(state.overflowGroupIds).toEqual(['edit'])
  })

  it('activates button and toggle items through pointer interaction', () => {
    const onClick = vi.fn()
    const onChange = vi.fn()
    const toolbar = new RenderToolbar({
      groups: [
        {
          id: 'actions',
          slot: 'leading',
          items: [
            { id: 'save', kind: 'button', label: '保存', icon: 'copy', onClick },
            { id: 'compact', kind: 'toggle', label: '紧凑', icon: 'check', checked: false, onChange },
          ],
        },
      ],
    })

    toolbar.layout({ minWidth: 0, maxWidth: 240, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const saveRect = toolbar.itemRect('save')!
    const toggleRect = toolbar.itemRect('compact')!

    toolbar.onPointerDown({ pointerId: 1, position: { x: saveRect.x + 8, y: saveRect.y + 8 }, type: 'down' })
    toolbar.onPointerUp({ pointerId: 1, position: { x: saveRect.x + 8, y: saveRect.y + 8 }, type: 'up' })
    toolbar.onPointerDown({ pointerId: 1, position: { x: toggleRect.x + 8, y: toggleRect.y + 8 }, type: 'down' })
    toolbar.onPointerUp({ pointerId: 1, position: { x: toggleRect.x + 8, y: toggleRect.y + 8 }, type: 'up' })

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('uses compact square hit targets for icon-only toolbar buttons', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(label => label.length * 10)
    const toolbar = new RenderToolbar({
      groups: [
        {
          id: 'paragraph',
          slot: 'leading',
          items: [
            { id: 'indent', kind: 'button', label: '增加缩进', icon: 'indent-increase', showLabel: false },
            { id: 'labeled', kind: 'button', label: '增加缩进', icon: 'indent-increase' },
          ],
        },
      ],
    })

    toolbar.layout({ minWidth: 0, maxWidth: 240, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })

    const iconOnlyRect = toolbar.itemRect('indent')!
    const labeledRect = toolbar.itemRect('labeled')!
    expect(iconOnlyRect.width).toBeLessThan(labeledRect.width)
    expect(iconOnlyRect.width).toBe(iconOnlyRect.height)
  })

  it('exposes hovered icon-only item labels through the toolbar tooltip', () => {
    const toolbar = new RenderToolbar({
      groups: [
        {
          id: 'paragraph',
          slot: 'leading',
          items: [
            { id: 'indent', kind: 'button', label: '增加缩进', icon: 'indent-increase', showLabel: false },
            { id: 'plain', kind: 'button', label: '普通按钮' },
          ],
        },
      ],
    })
    toolbar.layout({ minWidth: 0, maxWidth: 240, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const iconRect = toolbar.itemRect('indent')!
    const plainRect = toolbar.itemRect('plain')!

    toolbar.onPointerMove({ pointerId: 1, position: { x: iconRect.x + 4, y: iconRect.y + 4 }, type: 'move' })
    expect(toolbar.tooltip).toBe('增加缩进')
    expect(toolbar.tooltipDelay).toBe(250)

    toolbar.onPointerMove({ pointerId: 1, position: { x: plainRect.x + 4, y: plainRect.y + 4 }, type: 'move' })
    expect(toolbar.tooltip).toBeUndefined()
  })

  it('keeps toolbar tooltip in sync when groups are rebuilt under hover', () => {
    const toolbar = new RenderToolbar({
      groups: [
        {
          id: 'paragraph',
          slot: 'leading',
          items: [
            { id: 'indent', kind: 'button', label: '增加缩进', icon: 'indent-increase', showLabel: false },
          ],
        },
      ],
    })
    toolbar.layout({ minWidth: 0, maxWidth: 120, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const rect = toolbar.itemRect('indent')!

    toolbar.onPointerMove({ pointerId: 1, position: { x: rect.x + 4, y: rect.y + 4 }, type: 'move' })
    expect(toolbar.tooltip).toBe('增加缩进')

    toolbar.setGroups([
      {
        id: 'paragraph',
        slot: 'leading',
        items: [
          { id: 'indent', kind: 'button', label: '减少缩进', icon: 'indent-decrease', showLabel: false },
        ],
      },
    ])
    toolbar.layout({ minWidth: 0, maxWidth: 120, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    toolbar.onPointerMove({ pointerId: 1, position: { x: rect.x + 4, y: rect.y + 4 }, type: 'move' })

    expect(toolbar.tooltip).toBe('减少缩进')
  })

  it('clears a hovered item tooltip when groups are rebuilt without that item', () => {
    const toolbar = new RenderToolbar({
      groups: [
        {
          id: 'paragraph',
          slot: 'leading',
          items: [
            { id: 'indent', kind: 'button', label: '增加缩进', icon: 'indent-increase', showLabel: false },
          ],
        },
      ],
    })
    toolbar.layout({ minWidth: 0, maxWidth: 120, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const rect = toolbar.itemRect('indent')!

    toolbar.onPointerMove({ pointerId: 1, position: { x: rect.x + 4, y: rect.y + 4 }, type: 'move' })
    expect(toolbar.tooltip).toBe('增加缩进')

    toolbar.setGroups([])

    expect(toolbar.tooltip).toBeUndefined()
    expect(toolbar.tooltipDelay).toBeUndefined()
  })

  it('keeps disabled items inert', () => {
    const onClick = vi.fn()
    const toolbar = new RenderToolbar({
      groups: [
        {
          id: 'actions',
          slot: 'leading',
          items: [
            { id: 'disabled-save', kind: 'button', label: '保存', icon: 'copy', disabled: true, onClick },
          ],
        },
      ],
    })

    toolbar.layout({ minWidth: 0, maxWidth: 180, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const rect = toolbar.itemRect('disabled-save')!

    toolbar.onPointerDown({ pointerId: 1, position: { x: rect.x + 8, y: rect.y + 8 }, type: 'down' })
    toolbar.onPointerUp({ pointerId: 1, position: { x: rect.x + 8, y: rect.y + 8 }, type: 'up' })

    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps overflow affordance inside the toolbar when width is extremely narrow', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(label => label.length * 12)
    const toolbar = new RenderToolbar({
      groups: [
        {
          id: 'file',
          slot: 'leading',
          items: [{ id: 'new', kind: 'button', label: '新建长文档', icon: 'plus' }],
        },
        {
          id: 'status',
          slot: 'trailing',
          items: [{ id: 'notify', kind: 'button', label: '通知消息', icon: 'bell' }],
        },
      ],
    })

    toolbar.layout({ minWidth: 0, maxWidth: 44, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const overflowRect = toolbar.itemRect('__toolbar_overflow__')!

    expect(overflowRect.x).toBeGreaterThanOrEqual(0)
    expect(overflowRect.width).toBeGreaterThanOrEqual(0)
    expect(overflowRect.x + overflowRect.width).toBeLessThanOrEqual(toolbar.size.width)

    const painted = createPaintContext()
    toolbar.paint(painted.context, { x: 0, y: 0 })
    expect(painted.calls).toContain('clip')
  })

  it('paints overflow focus and disabled text with the shared interaction recipe', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(label => label.length * 12)
    const toolbar = new RenderToolbar({
      groups: [
        {
          id: 'file',
          slot: 'leading',
          items: [{ id: 'new', kind: 'button', label: '新建长文档', icon: 'plus' }],
        },
        {
          id: 'status',
          slot: 'trailing',
          items: [{ id: 'notify', kind: 'button', label: '通知消息', icon: 'bell' }],
        },
      ],
    })
    const style = deriveToolbarStyle(ImGuiDarkTheme)

    toolbar.layout({ minWidth: 0, maxWidth: 44, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    toolbar.focusIn()
    toolbar.onKeyDown({ key: 'End', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    const focused = createPaintContext()
    toolbar.paint(focused.context, { x: 0, y: 0 })

    expect(focused.strokeStyles).toContain(colorToCSS({
      ...style.focusedBorder,
      a: Math.min(0.84, Math.max(0.4, style.focusedBorder.a * 0.76)),
    }))

    toolbar.disabled = true
    const disabled = createPaintContext()
    toolbar.paint(disabled.context, { x: 0, y: 0 })

    expect(disabled.textPaints).toContainEqual({
      text: style.overflowLabel,
      color: colorToCSS(style.itemText.disabledText!),
    })
  })

  it('toggles dropdown menus from the same toolbar item', () => {
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 800, height: 600, dpr: 1 },
    }))
    const toolbar = new RenderToolbar({
      groups: [
        {
          id: 'menus',
          slot: 'leading',
          items: [
            {
              id: 'more',
              kind: 'dropdown',
              label: '更多',
              icon: 'window',
              items: [{ key: 'inspect', label: '检查器' }],
            },
          ],
        },
      ],
    })

    toolbar.layout({ minWidth: 0, maxWidth: 180, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const rect = toolbar.itemRect('more')!

    toolbar.onPointerDown({ pointerId: 1, position: { x: rect.x + 8, y: rect.y + 8 }, type: 'down' })
    toolbar.onPointerUp({ pointerId: 1, position: { x: rect.x + 8, y: rect.y + 8 }, type: 'up' })

    expect(PopupManager.instance.hasOverlays).toBe(true)
    expect(toolbar.debugState().openItemId).toBe('more')

    ;((toolbar as any)._popupProxy as { onPointerDown?: (event: { pointerId: number; position: { x: number; y: number }; type: string }) => void }).onPointerDown?.({
      pointerId: 1,
      position: { x: rect.x + 8, y: rect.y + 8 },
      type: 'down',
    })

    expect(PopupManager.instance.hasOverlays).toBe(false)
    expect(toolbar.debugState().openItemId).toBe('')
  })

  it('clears focus pointer and menu state when disabled dynamically', () => {
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 800, height: 600, dpr: 1 },
    }))
    const onClick = vi.fn()
    const toolbar = new RenderToolbar({
      groups: [
        {
          id: 'actions',
          slot: 'leading',
          items: [
            { id: 'save', kind: 'button', label: '保存', icon: 'copy', onClick },
            {
              id: 'more',
              kind: 'dropdown',
              label: '更多',
              icon: 'window',
              items: [{ key: 'inspect', label: '检查器' }],
            },
          ],
        },
      ],
    })

    toolbar.layout({ minWidth: 0, maxWidth: 240, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const saveRect = toolbar.itemRect('save')!
    const menuRect = toolbar.itemRect('more')!

    toolbar.focusIn()
    toolbar.onPointerDown({ pointerId: 1, position: { x: menuRect.x + 8, y: menuRect.y + 8 }, type: 'down' })
    toolbar.onPointerUp({ pointerId: 1, position: { x: menuRect.x + 8, y: menuRect.y + 8 }, type: 'up' })
    toolbar.onPointerMove({ pointerId: 2, position: { x: saveRect.x + 8, y: saveRect.y + 8 }, type: 'move' })
    toolbar.onPointerDown({ pointerId: 2, position: { x: saveRect.x + 8, y: saveRect.y + 8 }, type: 'down' })

    expect(toolbar.isFocused).toBe(true)
    expect(toolbar.debugState().openItemId).toBe('more')
    expect((toolbar as any)._hoveredItemId).toBe('save')
    expect((toolbar as any)._pressedItemId).toBe('save')
    expect(PopupManager.instance.hasOverlays).toBe(true)

    toolbar.disabled = true

    expect(toolbar.isFocused).toBe(false)
    expect(toolbar.debugState().openItemId).toBe('')
    expect((toolbar as any)._hoveredItemId).toBe('')
    expect((toolbar as any)._pressedItemId).toBe('')
    expect((toolbar as any)._keyboardItemId).toBe('')
    expect(PopupManager.instance.hasOverlays).toBe(false)

    toolbar.onPointerMove({ pointerId: 2, position: { x: saveRect.x + 8, y: saveRect.y + 8 }, type: 'move' })
    toolbar.onPointerUp({ pointerId: 2, position: { x: saveRect.x + 8, y: saveRect.y + 8 }, type: 'up' })

    const enter = { key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent

    expect(toolbar.onKeyDown(enter)).toBe(false)
    expect((toolbar as any)._hoveredItemId).toBe('')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('routes overflow submenu item selections to the original dropdown handler', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(label => label.length * 10)
    const onInsert = vi.fn()
    const toolbar = new RenderToolbar({
      groups: [
        {
          id: 'document',
          slot: 'leading',
          items: [
            { id: 'doc', kind: 'dropdown', label: '文档', items: [{ key: 'reload', label: '重新载入示例' }] },
          ],
        },
        {
          id: 'insert',
          slot: 'leading',
          items: [
            {
              id: 'insert-menu',
              kind: 'dropdown',
              label: '插入',
              items: [
                { key: 'insert:table-2x2', label: '插入 2 x 2 表格' },
                { key: 'insert:table-3x3', label: '插入 3 x 3 表格' },
              ],
              onSelect: onInsert,
            },
          ],
        },
      ],
    })

    toolbar.layout({ minWidth: 0, maxWidth: 44, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const overflowLayout = (toolbar as any)._resolvedLayout.itemLayouts.find((item: { id: string }) => item.id === '__toolbar_overflow__')
    const menuSpec = (toolbar as any)._menuSpecForLayout(overflowLayout)

    menuSpec.onSelect('insert:table-2x2')

    expect(onInsert).toHaveBeenCalledWith('insert:table-2x2')
  })

  it('right-aligns dropdown popup to a trailing toolbar item when it would overflow', () => {
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 420, height: 600, dpr: 1 },
    }))
    const toolbar = new RenderToolbar({
      groups: [
        {
          id: 'settings',
          slot: 'trailing',
          items: [
            {
              id: 'mode',
              kind: 'dropdown',
              label: '设计模式',
              items: [{ key: 'design', label: '设计模式' }],
            },
          ],
        },
      ],
    })

    toolbar.offset = { x: 20, y: 30 }
    toolbar.layout({ minWidth: 380, maxWidth: 380, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const rect = toolbar.itemRect('mode')!

    toolbar.onPointerDown({ pointerId: 1, position: { x: 20 + rect.x + 8, y: 30 + rect.y + 8 }, type: 'down' })
    toolbar.onPointerUp({ pointerId: 1, position: { x: 20 + rect.x + 8, y: 30 + rect.y + 8 }, type: 'up' })

    const popupLayout = (toolbar as any)._rootPopup._layout(PopupManager.instance.context)
    const itemGlobalRight = 20 + rect.x + rect.width

    expect(popupLayout.pos.x + popupLayout.menuWidth).toBeCloseTo(itemGlobalRight)
    expect(popupLayout.pos.y).toBeCloseTo(30 + rect.y + rect.height)
  })

  it('anchors later toolbar dropdowns to their item instead of clamping to an ancestor window', () => {
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 900, height: 600, dpr: 1 },
    }))
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(label => label.length * 10)
    const hostWindow = new RenderWindow({ title: 'host', x: 20, y: 20, width: 320, height: 180 })
    const toolbar = new RenderToolbar({
      groups: [
        {
          id: 'document',
          slot: 'leading',
          items: [
            { id: 'doc', kind: 'dropdown', label: '文档', items: [{ key: 'reload', label: '重新载入示例' }] },
            { id: 'undo', kind: 'button', label: '撤销' },
            { id: 'redo', kind: 'button', label: '重做' },
          ],
        },
        {
          id: 'format',
          slot: 'leading',
          items: [
            { id: 'font', kind: 'dropdown', label: '宋体', items: [{ key: 'font', label: '宋体' }] },
            { id: 'size', kind: 'dropdown', label: '14', items: [{ key: 'size', label: '14' }] },
            { id: 'color', kind: 'dropdown', label: '颜色', items: [{ key: 'red', label: '红色' }] },
          ],
        },
        {
          id: 'insert',
          slot: 'leading',
          items: [
            { id: 'paragraph', kind: 'dropdown', label: '段落', items: [{ key: 'align', label: '左对齐' }] },
            { id: 'insert-menu', kind: 'dropdown', label: '插入', items: [{ key: 'table', label: '插入表格' }] },
            { id: 'border-menu', kind: 'dropdown', label: '表格边框', items: [{ key: 'all', label: '全部框线' }] },
          ],
        },
      ],
    })
    toolbar.parent = hostWindow
    toolbar.offset = { x: 0, y: 0 }
    toolbar.layout({ minWidth: 0, maxWidth: 720, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const paragraphRect = toolbar.itemRect('paragraph')!

    toolbar.onPointerDown({ pointerId: 1, position: { x: 20 + paragraphRect.x + 8, y: 20 + paragraphRect.y + 8 }, type: 'down' })
    toolbar.onPointerUp({ pointerId: 1, position: { x: 20 + paragraphRect.x + 8, y: 20 + paragraphRect.y + 8 }, type: 'up' })

    const popupLayout = (toolbar as any)._rootPopup._layout(PopupManager.instance.context)
    const windowClampedX = hostWindow.globalOffset.x + hostWindow.windowWidth - popupLayout.menuWidth - 4
    expect(popupLayout.pos.x).toBeCloseTo(20 + paragraphRect.x)
    expect(popupLayout.pos.x).toBeGreaterThan(windowClampedX)
  })

  it('paints toolbar chrome and item content', () => {
    const toolbar = new RenderToolbar({
      groups: [
        {
          id: 'actions',
          slot: 'leading',
          items: [{ id: 'save', kind: 'button', label: '保存', icon: 'copy' }],
        },
      ],
    })
    toolbar.layout({ minWidth: 0, maxWidth: 220, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const painted = createPaintContext()

    toolbar.paint(painted.context, { x: 0, y: 0 })

    expect(painted.fill).toHaveBeenCalled()
    expect(painted.stroke).toHaveBeenCalled()
  })

  it('preserves checked hover and press flags without decorating disabled selections', () => {
    const toolbar = new RenderToolbar({
      groups: [{
        id: 'view',
        slot: 'leading',
        items: [
          { id: 'checked', kind: 'toggle', label: 'Checked', checked: true },
          { id: 'disabled', kind: 'toggle', label: 'Disabled', checked: true, disabled: true },
        ],
      }],
    })
    toolbar.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const checkedRect = toolbar.itemRect('checked')!
    const point = { x: checkedRect.x + 4, y: checkedRect.y + 4 }
    toolbar.onPointerMove({ pointerId: 1, position: point, type: 'move' })
    let layout = (toolbar as any)._resolvedLayout.itemLayouts.find((entry: { id: string }) => entry.id === 'checked')

    expect((toolbar as any)._itemState(layout)).toMatchObject({ selected: true, hovered: true })

    toolbar.onPointerDown({ pointerId: 1, position: point, type: 'down' })
    expect((toolbar as any)._itemState(layout)).toMatchObject({ selected: true, pressed: true })
    toolbar.onPointerCancel({ pointerId: 1, position: point, type: 'cancel' })

    layout = (toolbar as any)._resolvedLayout.itemLayouts.find((entry: { id: string }) => entry.id === 'disabled')
    expect((toolbar as any)._itemState(layout)).toMatchObject({ disabled: true, selected: true })
    const disabledOnly = new RenderToolbar({
      groups: [{
        id: 'view',
        slot: 'leading',
        items: [{ id: 'disabled', kind: 'toggle', label: 'Disabled', checked: true, disabled: true }],
      }],
    })
    disabledOnly.layout({ minWidth: 0, maxWidth: 160, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    const painted = createPaintContext()
    disabledOnly.paint(painted.context, { x: 0, y: 0 })
    const style = deriveToolbarStyle(ImGuiDarkTheme)
    expect(painted.strokeStyles).not.toContain(colorToCSS(style.selectedBorder))
    expect(painted.strokeStyles).not.toContain(colorToCSS(style.pressedBorder))
  })
})

describe('item-based overflow contract', () => {
  const layout = (toolbar: RenderToolbar, width: number) => toolbar.layout({ minWidth: width, maxWidth: width, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
  const buttons = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `b${i}`, kind: 'button' as const, label: `Button ${i}` }))
  it('retains fitting commands from a single group at the exact overflow threshold', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(label => label.length * 10)
    const toolbar = new RenderToolbar({ groups: [{ id: 'view', slot: 'leading', items: buttons(8) }] })
    layout(toolbar, 2000)
    const style = deriveToolbarStyle(ImGuiDarkTheme), w = toolbar.itemRect('b0')!.width
    const boundary = style.padding * 2 + w * 2 + style.itemSpacing + style.sectionGap + (toolbar as any)._overflowButtonWidth(style)
    layout(toolbar, boundary)
    expect(toolbar.itemRect('b0')).not.toBeNull(); expect(toolbar.itemRect('b1')).not.toBeNull(); expect(toolbar.itemRect('b2')).toBeNull()
    expect((toolbar as any)._resolvedLayout.overflowEntries.map((e: any) => e.item.id)).toEqual(['b2', 'b3', 'b4', 'b5', 'b6', 'b7'])
    layout(toolbar, boundary - 1); expect(toolbar.itemRect('b1')).toBeNull()
    layout(toolbar, 2000); expect(toolbar.itemRect('__toolbar_overflow__')).toBeNull(); expect(toolbar.itemRect('b7')).not.toBeNull()
    toolbar.dispose()
  })
  it('preserves explicit indivisible groups', () => {
    const toolbar = new RenderToolbar({ groups: [{ id: 'atomic', slot: 'leading', overflow: 'group', items: buttons(8) }] })
    layout(toolbar, 300); expect(toolbar.itemRect('b0')).toBeNull(); expect((toolbar as any)._resolvedLayout.overflowEntries).toHaveLength(8); toolbar.dispose()
  })
  it('does not make normal siblings disappear because one command is oversized', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(label => label.length * 10)
    const toolbar = new RenderToolbar({ groups: [{ id: 'view', slot: 'leading', items: [{ id: 'huge', kind: 'button', label: 'X'.repeat(100) }, { id: 'a', kind: 'button', label: 'A' }, { id: 'b', kind: 'button', label: 'B' }] }] })
    layout(toolbar, 220); expect(toolbar.itemRect('huge')).toBeNull(); expect(toolbar.itemRect('a')).not.toBeNull(); expect(toolbar.itemRect('b')).not.toBeNull(); toolbar.dispose()
  })
  it('builds overflow from original group order and never displays internal group ids', () => {
    const toolbar = new RenderToolbar({ groups: [{ id: 'internal-one', slot: 'leading', items: buttons(3) }, { id: 'internal-two', label: '显示名称', slot: 'leading', items: buttons(3).map(i => ({ ...i, id: `x${i.id}` })) }] })
    layout(toolbar, 30)
    const state = (toolbar as any)._resolvedLayout
    expect(state.overflowEntries.map((e: any) => e.item.id)).toEqual(['b0', 'b1', 'b2', 'xb0', 'xb1', 'xb2'])
    const menu = (toolbar as any)._menuSpecForLayout(state.itemLayouts.find((i: any) => i.overflowButton)).items
    expect(menu.some((i: any) => i.label === 'internal-one')).toBe(false); expect(menu.some((i: any) => i.label === '显示名称')).toBe(true); toolbar.dispose()
  })
  it('normalizes separators on both sides without losing or duplicating commands', () => {
    const toolbar = new RenderToolbar({ groups: [{ id: 'g', slot: 'leading', items: [{ id: 's0', kind: 'separator' }, ...buttons(4), { id: 's1', kind: 'separator' }, { id: 's2', kind: 'separator' }, ...buttons(4).map(i => ({ ...i, id: `x${i.id}` })), { id: 's3', kind: 'separator' }] }] })
    layout(toolbar, 380)
    const state = (toolbar as any)._resolvedLayout, visible = state.visibleLeading.flatMap((g: any) => g.items.map((i: any) => i.item)), overflow = state.overflowEntries.map((e: any) => e.item)
    for (const entries of [visible, overflow]) {
      expect(entries[0]?.kind).not.toBe('separator'); expect(entries.at(-1)?.kind).not.toBe('separator')
      expect(entries.some((e: any, i: number) => e.kind === 'separator' && entries[i + 1]?.kind === 'separator')).toBe(false)
    }
    const ids = [...visible, ...overflow].filter(i => i.kind !== 'separator').map(i => i.id)
    expect(new Set(ids).size).toBe(8); expect(ids).toHaveLength(8); toolbar.dispose()
  })
  it('moves hidden keyboard focus to overflow and clears a press when geometry changes', () => {
    const toolbar = new RenderToolbar({ groups: [{ id: 'view', slot: 'leading', items: buttons(8) }] })
    layout(toolbar, 2000); (toolbar as any)._keyboardItemId = 'b7'; (toolbar as any)._pressedItemId = 'b7'
    layout(toolbar, 250); expect((toolbar as any)._keyboardItemId).toBe('__toolbar_overflow__'); expect((toolbar as any)._pressedItemId).toBe('')
    layout(toolbar, 2000); expect(toolbar.itemRect((toolbar as any)._keyboardItemId)).not.toBeNull(); toolbar.dispose()
  })
})
