import { describe, expect, it, vi } from 'vitest'
import type { Rect } from '../core/render_object'
import { DrawList } from '../rendering/draw_list'
import { PaintContext } from '../rendering/paint_context'
import { deriveDockWorkbenchStyle } from '../theme/component_styles'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { RenderText } from './basic'
import { DockWorkbenchManager, RenderDockWorkbench, type DockWorkbenchEvent } from './dock_workbench'

function paintBottomTab(title: string) {
  const manager = new DockWorkbenchManager()
  manager.openTool({ itemId: 'activity', title, region: 'bottom', content: new RenderText(title) })
  const workbench = new RenderDockWorkbench({ manager })
  workbench.layout({ minWidth: 0, maxWidth: 900, minHeight: 0, maxHeight: 540 })
  manager.autoHideItem('activity')
  workbench.layout({ minWidth: 0, maxWidth: 900, minHeight: 0, maxHeight: 540 })

  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((value: string) => ({
      width: [...value].reduce((width, char) => width + (/[\u3400-\u9fff]/.test(char) ? 16 : 8), 0),
    }) as TextMetrics),
  } as unknown as CanvasRenderingContext2D
  const context = new PaintContext(ctx)
  const view = workbench as any
  view._paintBottomAutoHideTabs(context, new DrawList(context), { x: 0, y: 0 }, manager.autoHideItems)
  const rect = view._autoHideTabRects.get('activity') as Rect
  const label = vi.mocked(ctx.fillText).mock.calls.at(-1)?.[0] as string
  workbench.dispose()
  manager.dispose()
  return { ctx, rect, label }
}

describe('RenderDockWorkbench bottom auto-hide tabs', () => {
  it('allocates measured width for Chinese labels', () => {
    const { ctx, rect, label } = paintBottomTab('活动记录')
    const inset = deriveDockWorkbenchStyle(ImGuiDarkTheme).autoHideBottomTextInset
    expect(ctx.clip).toHaveBeenCalledOnce()
    expect(ctx.restore).toHaveBeenCalledOnce()
    expect(label).toBe('活动记录')
    expect(rect.width).toBeGreaterThanOrEqual(ctx.measureText(label).width + inset * 2)
  })

  it('ellipsizes a long label inside its maximum width', () => {
    const { ctx, rect, label } = paintBottomTab('活动记录与项目操作日志')
    const style = deriveDockWorkbenchStyle(ImGuiDarkTheme)
    expect(rect.width).toBeLessThanOrEqual(style.autoHideSideTabMaxSize)
    expect(label).toContain('...')
    expect(ctx.measureText(label).width).toBeLessThanOrEqual(rect.width - style.autoHideBottomTextInset * 2)
  })
})

describe('document activation guard', () => {
  it('cancels API activation and selection without changing the selected document', () => {
    const manager = new DockWorkbenchManager()
    manager.openDocument({ itemId: 'a', title: 'A', content: new RenderText('Document') })
    manager.openDocument({ itemId: 'b', title: 'B', content: new RenderText('Document') })
    const events: DockWorkbenchEvent[] = []
    manager.subscribeEvent(event => events.push(event))
    const unsubscribe = manager.subscribeBeforeEvent(event => event.type !== 'before-item-activate')
    expect(manager.activateItem('a')).toBe(false)
    expect(manager.selectDockedItemTab('a')).toBe(false)
    expect(events).toEqual([])
    const center = manager.regions.center
    expect(center?.type === 'tabs' && center.activeItem?.title).toBe('B')
    unsubscribe()
    expect(manager.activateItem('a')).toBe(true)
    manager.dispose()
  })
})

describe('auto-hide outside-click ownership', () => {
  for (const ending of ['up', 'cancel'] as const) {
    it(`does not intercept ${ending} when the overlay appeared after a descendant pressed`, () => {
      const manager = new DockWorkbenchManager()
      manager.openDocument({ itemId: 'order', title: 'Order', content: new RenderText('Content') })
      manager.openTool({ itemId: 'validation', title: 'Validation', region: 'bottom', content: new RenderText('Content') })
      const workbench = new RenderDockWorkbench({ manager })
      manager.autoHideItem('validation')
      workbench.layout({ minWidth: 900, maxWidth: 900, minHeight: 540, maxHeight: 540 })
      const position = { x: 700, y: 20 }
      const stopDown = vi.fn()
      workbench.onPointerDownCapture({ pointerId: 1, type: 'down', position, stopPropagation: stopDown })
      expect(stopDown).not.toHaveBeenCalled()
      manager.showAutoHideItem('validation')
      workbench.layout({ minWidth: 900, maxWidth: 900, minHeight: 540, maxHeight: 540 })
      const stopEnd = vi.fn()
      const event = { pointerId: 1, type: ending, position, stopPropagation: stopEnd }
      if (ending === 'up') workbench.onPointerUpCapture(event)
      else workbench.onPointerCancelCapture(event)
      expect(stopEnd).not.toHaveBeenCalled()
      expect(manager.activeAutoHideItemId).toBe('validation')
      workbench.dispose(); manager.dispose()
    })
  }
})


it('only consumes the matching terminal event for an outside-dismiss press', () => {
  const manager = new DockWorkbenchManager()
  manager.openDocument({ itemId: 'order', title: 'Order', content: new RenderText('Content') })
  manager.openTool({ itemId: 'validation', title: 'Validation', region: 'bottom', content: new RenderText('Content') })
  const workbench = new RenderDockWorkbench({ manager })
  manager.autoHideItem('validation'); manager.showAutoHideItem('validation')
  workbench.layout({ minWidth: 900, maxWidth: 900, minHeight: 540, maxHeight: 540 })
  const position = { x: 700, y: 20 }
  workbench.onPointerDownCapture({ pointerId: 1, type: 'down', position })
  const otherStop = vi.fn()
  workbench.onPointerUpCapture({ pointerId: 2, type: 'up', position, stopPropagation: otherStop })
  expect(otherStop).not.toHaveBeenCalled()
  expect(manager.activeAutoHideItemId).toBe('validation')
  const ownedStop = vi.fn()
  workbench.onPointerCancelCapture({ pointerId: 1, type: 'cancel', position, stopPropagation: ownedStop })
  expect(ownedStop).toHaveBeenCalledOnce()
  expect(manager.activeAutoHideItemId).toBe('validation')
  workbench.dispose(); manager.dispose()
})


it('does not reuse an outside-dismiss press for a new pointer sequence', () => {
  const manager = new DockWorkbenchManager()
  manager.openDocument({ itemId: 'order', title: 'Order', content: new RenderText('Content') })
  manager.openTool({ itemId: 'validation', title: 'Validation', region: 'bottom', content: new RenderText('Content') })
  const workbench = new RenderDockWorkbench({ manager })
  manager.autoHideItem('validation'); manager.showAutoHideItem('validation')
  workbench.layout({ minWidth: 900, maxWidth: 900, minHeight: 540, maxHeight: 540 })
  const position = { x: 700, y: 20 }
  workbench.onPointerDownCapture({ pointerId: 1, type: 'down', position })
  manager.hideAutoHideItem()
  workbench.onPointerDownCapture({ pointerId: 1, type: 'down', position })
  manager.showAutoHideItem('validation')
  const stopUp = vi.fn()
  workbench.onPointerUpCapture({ pointerId: 1, type: 'up', position, stopPropagation: stopUp })
  expect(stopUp).not.toHaveBeenCalled()
  workbench.dispose(); manager.dispose()
})
