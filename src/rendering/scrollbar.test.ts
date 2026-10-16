import { describe, expect, it, vi } from 'vitest'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { deriveScrollbarStyle } from '../theme/component_styles'
import { ScrollbarAxisController } from '../gestures/scrollbar_interaction_controller'
import {
  paintHBar,
  paintVBar,
  resolveScrollbarGeometryForState,
} from './scrollbar'

describe('scrollbar geometry', () => {
  it.each(['vertical', 'horizontal'] as const)('paints distinct %s hover feedback without changing hit geometry', axis => {
    const controller = new ScrollbarAxisController(axis)
    const style = deriveScrollbarStyle(ImGuiDarkTheme)
    const fillRect = vi.fn()
    const trackRect = axis === 'vertical'
      ? { x: 88, y: 0, width: 12, height: 100 }
      : { x: 0, y: 88, width: 100, height: 12 }
    const geometry = (scrollOffset = 0) => resolveScrollbarGeometryForState({
      axis, trackRect, viewportSize: 100, contentSize: 300, scrollOffset, style, state: controller.state,
    })
    const paint = (scrollOffset = 0) => {
      fillRect.mockClear()
      const painter = axis === 'vertical' ? paintVBar : paintHBar
      painter({
        dl: { fillRect } as never, style, trackX: trackRect.x, trackY: trackRect.y,
        trackW: trackRect.width, trackH: trackRect.height,
        viewSize: 100, contentSize: 300, scrollOffset, state: controller.state,
      })
      return fillRect.mock.calls.map(call => call[4])
    }
    const point = (along: number, across = 89) => axis === 'vertical'
      ? { x: across, y: along } : { x: along, y: across }
    const idle = geometry()
    expect(paint()).toEqual([style.trackBg, style.thumbBg])
    controller.updateHover(point(90), geometry())
    expect(paint()).toEqual([style.trackHoveredBg, style.thumbBg])
    const trackHover = geometry()
    expect(trackHover.hitRect).toEqual(idle.hitRect)
    expect(trackHover.thumbHitRect).toEqual(idle.thumbHitRect)
    expect(trackHover.trackTravel).toBe(idle.trackTravel)
    expect(axis === 'vertical' ? trackHover.thumbRect.width : trackHover.thumbRect.height)
      .toBe(style.thumbHoveredThickness)

    controller.updateHover(point(20), geometry())
    expect(paint()).toEqual([style.trackHoveredBg, style.thumbHoveredBg])
    expect(geometry()).toEqual(trackHover)
    expect(paint(200)).toEqual([style.trackHoveredBg, style.thumbBg])
    controller.beginPointer(point(20), geometry())
    controller.updatePointer(point(90, 50), geometry())
    controller.clearHover()
    expect(paint()).toEqual([style.trackPressedBg, style.thumbPressedBg])
    controller.endPointer(point(90), geometry())
    expect(paint()).toEqual([style.trackHoveredBg, style.thumbBg])

    const jump = controller.beginPointer(point(90), geometry())
    expect(jump.action).toBe('track')
    expect(jump.capturePointer).toBeUndefined()
    expect(controller.state.dragging).toBe(false)
    expect(paint(jump.scrollOffset)).toEqual([style.trackHoveredBg, style.thumbHoveredBg])
    controller.cancelPointer()
    expect(paint()).toEqual([style.trackBg, style.thumbBg])
  })
})
