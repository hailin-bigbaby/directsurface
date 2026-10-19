// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PopupManager, type Popup, type PopupPointerObservation } from './popup_manager'
import { FocusManager } from './focus_manager'
import { RenderText } from '../widgets/basic'
import { ImGuiDarkTheme } from '../theme/default_theme'

afterEach(() => {
  PopupManager.disposeInstance()
  FocusManager.disposeInstance()
  vi.restoreAllMocks()
})

describe('Popup pointer observation', () => {
  it('observes a passive overlay without providing input controls or consuming movement', () => {
    const observed = vi.fn((value: PopupPointerObservation) => { (value.position as { x: number }).x = 999 })
    const popup: Popup = { hitTest: () => true, close: vi.fn(), observePointer: observed }
    PopupManager.instance.open(popup, { interactionMode: 'passive' })
    const event = { pointerId: 1, type: 'move' as const, position: { x: 10, y: 10 }, stopPropagation: vi.fn() }
    expect(PopupManager.instance.handlePointerMove(event)).toBe(false)
    expect(event.position.x).toBe(10)
    expect(event.stopPropagation).not.toHaveBeenCalled()
    expect(Object.keys(observed.mock.calls[0]![0]).sort()).toEqual(['phase', 'pointerId', 'pointerType', 'position'])
    expect(PopupManager.instance.hasOpen).toBe(false)
  })

  it('bounds same-pointer reentry and still observes later independent moves', () => {
    const event = { pointerId: 1, type: 'move' as const, position: { x: 10, y: 10 } }
    const observed = vi.fn(() => PopupManager.instance.observePointer(event))
    const popup: Popup = { hitTest: () => false, close: vi.fn(), observePointer: observed }
    PopupManager.instance.open(popup, { interactionMode: 'passive' })
    PopupManager.instance.handlePointerMove(event)
    PopupManager.instance.handlePointerMove(event)
    expect(observed).toHaveBeenCalledTimes(2)
  })

  it('isolates observation errors without preventing other observers or routing', () => {
    const error = new Error('observer')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const observed = vi.fn()
    const first: Popup = { hitTest: () => false, close: vi.fn(), observePointer: () => { throw error } }
    const second: Popup = { hitTest: () => false, close: vi.fn(), observePointer: observed }
    PopupManager.instance.open(first, { interactionMode: 'passive' })
    PopupManager.instance.open(second, { interactionMode: 'passive' })
    expect(PopupManager.instance.handlePointerMove({ pointerId: 1, type: 'move', position: { x: 10, y: 10 } })).toBe(false)
    expect(observed).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith(expect.stringContaining('pointer observation'), error)
  })

  it('keeps root and explicit close policy when changing input mode in place', () => {
    const root = new RenderText('Root')
    const other = new RenderText('Other')
    let active = root
    const closed = vi.fn()
    const popup: Popup = { hitTest: () => false, close: closed }
    PopupManager.instance.setAnchorRootProvider(() => active)
    PopupManager.instance.setContextProvider(anchor => ({ theme: ImGuiDarkTheme,
      viewport: { width: anchor === root ? 800 : 100, height: 600, dpr: 1 } }))
    try {
      PopupManager.instance.open(popup, { interactionMode: 'passive', closeOnTransient: false })
      active = other
      expect(PopupManager.instance.updateInteractionMode(popup, 'nonmodal')).toBe(true)
      expect(PopupManager.instance.updateInteractionMode(popup, 'passive')).toBe(true)
      expect(PopupManager.instance.contextFor(popup).viewport.width).toBe(800)
      PopupManager.instance.closeTransient()
      expect(closed).not.toHaveBeenCalled()
      expect(PopupManager.instance.updateInteractionMode(popup, 'passive', { closeOnTransient: true })).toBe(true)
      PopupManager.instance.closeTransient()
      expect(closed).toHaveBeenCalledTimes(1)
    } finally { root.dispose(); other.dispose() }
  })
})
