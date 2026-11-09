// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { MenuPopup } from './menu_popup'
import { PopupManager } from '../core/popup_manager'
import { FocusManager } from '../core/focus_manager'
import { ImGuiLightTheme } from '../theme/default_theme'
import type { WheelPointerEvent } from '../gestures/hit_test'

afterEach(() => { PopupManager.disposeInstance(); FocusManager.disposeInstance() })
it('keeps long menus inside a small viewport and reveals keyboard and wheel targets', () => {
  PopupManager.instance.setContextProvider(() => ({ theme: ImGuiLightTheme, viewport: { width: 140, height: 160, dpr: 1 } }))
  const selected = vi.fn()
  const menu = new MenuPopup({ items: Array.from({ length: 30 }, (_, i) => ({ key: String(i), label: `Action ${i}` })), onSelect: selected,
    bounds: () => ({ x: 0, y: 0, width: 140, height: 160 }) })
  menu.open()
  const layout = menu.debugState()
  expect(layout.menuWidth).toBeLessThanOrEqual(132); expect(layout.totalHeight).toBeLessThanOrEqual(152)
  expect(menu.itemRect('29')).toBeNull()
  menu.onKeyDown(new KeyboardEvent('keydown', { key: 'End' }))
  const last = menu.itemRect('29')!
  expect(last).not.toBeNull(); expect(last.y + last.height).toBeLessThanOrEqual(156)
  menu.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' })); expect(selected).toHaveBeenCalledWith('29')
  menu.onWheel({ deltaY: -10000 } as WheelPointerEvent)
  expect(menu.itemRect('0')).not.toBeNull(); expect(menu.itemRect('29')).toBeNull()
  menu.close()
})

it('allows a guarded selection to be rejected without changing the existing callback contract', () => {
  const selected = vi.fn(), request = vi.fn(() => false)
  PopupManager.instance.setContextProvider(() => ({ theme: ImGuiLightTheme, viewport: { width: 800, height: 600, dpr: 1 } }))
  const menu = new MenuPopup({ items: [{ key: 'mode', label: 'Mode', checked: 'mixed' }], onSelect: selected, onSelectRequest: request,
    bounds: () => ({ x: 0, y: 0, width: 800, height: 600 }) })
  menu.open(); menu.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
  expect(request).toHaveBeenCalledWith('mode', 'keyboard'); expect(selected).not.toHaveBeenCalled()
  request.mockReturnValue(true); menu.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
  expect(selected).toHaveBeenCalledOnce(); expect(selected).toHaveBeenCalledWith('mode'); menu.close()
})
