// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnimationClock } from '../animation/animation_clock'
import { RenderButton } from '../widgets/button'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { FocusManager } from './focus_manager'
import { PopupManager, type PopupContext } from './popup_manager'
import { PopupRenderSurface } from './popup_render_surface'
import { PopoverPopup } from '../widgets/popover'
import { GET_POPUP_ANCHOR_RECT } from './popup_anchor'
import { OverlayInvalidator } from './overlay_invalidator'

function context(animationClock?: AnimationClock): PopupContext {
  return { animationClock, theme: ImGuiDarkTheme, viewport: { width: 200, height: 100, dpr: 1 } }
}
function scene() {
  const button = new RenderButton({ label: 'Loading', loading: true })
  const surface = new PopupRenderSurface(button, root => {
    root.layout({ minWidth: 100, maxWidth: 100, minHeight: 40, maxHeight: 40 })
  })
  return { button, surface }
}
afterEach(() => {
  PopupManager.disposeInstance()
  FocusManager.disposeInstance()
  OverlayInvalidator.disposeInstance()
})

describe('Popup animation context', () => {
  it('binds an existing subtree once and rebinds to a new clock without detaching its owner', () => {
    const first = new AnimationClock()
    const second = new AnimationClock()
    const { button, surface } = scene()
    const closed = vi.fn()
    const owned = { hitTest: () => false, close: closed }
    try {
      surface.hitTest({ x: 5, y: 5 }, context(first))
      const owner = button.owner
      PopupManager.instance.open(owned, { owner: button, interactionMode: 'passive' })
      surface.hitTest({ x: 5, y: 5 }, context(first))
      expect(first.subscriberCount).toBe(1)
      surface.hitTest({ x: 5, y: 5 }, context(second))
      expect(first.subscriberCount).toBe(0)
      expect(second.subscriberCount).toBe(1)
      expect(button.owner).toBe(owner)
      expect(closed).not.toHaveBeenCalled()
      expect(PopupManager.instance.stack).toContain(owned)
      surface.hitTest({ x: 5, y: 5 }, context())
      expect(second.subscriberCount).toBe(0)
    } finally { surface.dispose(); button.dispose(); first.dispose(); second.dispose() }
  })

  it('releases subscriptions while closed and restores them when the surface is reused', () => {
    const clock = new AnimationClock()
    const { button, surface } = scene()
    try {
      surface.hitTest({ x: 5, y: 5 }, context(clock))
      expect(clock.subscriberCount).toBe(1)
      surface.reset()
      expect(clock.subscriberCount).toBe(0)
      surface.hitTest({ x: 5, y: 5 }, context(clock))
      expect(clock.subscriberCount).toBe(1)
      surface.dispose()
      expect(clock.subscriberCount).toBe(0)
    } finally { surface.dispose(); button.dispose(); clock.dispose() }
  })

  it('uses the popup viewport to suspend offscreen descendant animation', () => {
    const clock = new AnimationClock()
    const { button, surface } = scene()
    try {
      surface.hitTest({ x: 5, y: 5 }, context(clock))
      expect(clock.hasActiveAnimations).toBe(true)
      surface.hitTest({ x: 5, y: 5 }, { ...context(clock), viewport: { x: 400, width: 200, height: 100, dpr: 1 } })
      expect(clock.hasActiveAnimations).toBe(false)
      surface.hitTest({ x: 5, y: 5 }, context(clock))
      expect(clock.hasActiveAnimations).toBe(true)
    } finally { surface.dispose(); button.dispose(); clock.dispose() }
  })
  it('unsubscribes when PopupManager directly removes a content surface', () => {
    const clock = new AnimationClock()
    const button = new RenderButton({ label: 'Loading', loading: true })
    const popup = new PopoverPopup({ anchor: { [GET_POPUP_ANCHOR_RECT]: () => ({ x: 0, y: 0, width: 10, height: 10 }) }, content: button })
    PopupManager.instance.setContextProvider(() => context(clock))
    try {
      popup.open()
      popup.hitTest({ x: 5, y: 30 }, context(clock))
      expect(clock.subscriberCount).toBe(1)
      PopupManager.instance.bringToFront(popup)
      expect(clock.subscriberCount).toBe(1)
      PopupManager.instance.dismiss(popup)
      expect(clock.subscriberCount).toBe(0)
    } finally { popup.disposePopup(); button.dispose(); clock.dispose() }
  })

})
