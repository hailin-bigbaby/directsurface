import { describe, expect, it, vi } from 'vitest'
import type { Rect } from '../core/render_object'
import { DrawList } from '../rendering/draw_list'
import { PaintContext } from '../rendering/paint_context'
import { deriveDockWorkbenchStyle } from '../theme/component_styles'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { RenderText } from './basic'
import { DockWorkbenchManager, RenderDockWorkbench } from './dock_workbench'

function paintBottomTab(title: string) {
  const manager = new DockWorkbenchManager()
  manager.openTool({ itemId: 'activity', title, region: 'bottom', content: new RenderText(title) })
  const workbench = new RenderDockWorkbench({ manager })
  workbench.layout({ minWidth: 0, maxWidth: 900, minHeight: 0, maxHeight: 540 })
  manager.autoHideItem('activity')
  workbench.layout({ minWidth: 0, maxWidth: 900, minHeight: 0, maxHeight: 540 })

  const ctx = {
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
  return { ctx, rect, label }
}

describe('RenderDockWorkbench bottom auto-hide tabs', () => {
  it('allocates measured width for Chinese labels', () => {
    const { ctx, rect, label } = paintBottomTab('活动记录')
    const inset = deriveDockWorkbenchStyle(ImGuiDarkTheme).autoHideBottomTextInset
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
